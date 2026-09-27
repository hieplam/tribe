// The pass + entry: derive-and-act until `done`, honoring STOP and the `--max-cards` budget,
// tied together with the §D2 lock.
import { join } from 'node:path';
import type { CampaignState, CardResult, NextCardResult, ResolvedConfig, ResolvedTask, RunLoopConfig } from '../types.ts';
import { EXIT_ESCALATED, EXIT_LOCKED, EXIT_OK, EXIT_RULINGS_UNRATIFIED, EXIT_SESSION_INCOMPLETE } from '../types.ts';
import { loadState, nextCard } from '../state.ts';
import { BRIEF_TEMPLATE_PATH } from '../brief.ts';
import { campaignStatePathOf, answersPathOf, planPathWithinRepo } from '../paths.ts';
import { buildRunRecord, reportsDirOf, runDirOf, runRecordPathOf, serializeRunRecord } from '../run-record.ts';
import { unratifiedRulingIds } from '../rulings.ts';
import { resolveTaskIndex, TaskIndexError, type TaskIndexIssue } from '../plan-index.ts';
import type { LoopIO, StateIO } from '../../ports/ports.ts';
import { acquireLock, isStopRequested, releaseLock, stopFilePathOf } from './lock.ts';
import { deriveCardPhase, derivePhaseConfigOf, type CardPhase } from './phase.ts';
import { persistLocalState } from './commit-guard.ts';
import { actOnCard, escalateCard, type CardCtx, type CardOutcome } from './card-actions.ts';

export interface DryRunPlan {
  cardId: string | null;
  phase: CardPhase | null;
  done?: boolean;
  /** `note` (C2) is present only when the main checkout is not on the base branch — the
   * one condition that makes "missing spec, plan" misleading; see `checkoutMismatchNote`. */
  planningNeeded?: { cardId: string; missing: Array<'spec' | 'plan'>; note?: string };
}

/** Pure (C2, HARDENING-BACKLOG). `nextCard` resolves a card's `spec`/`plan` against `--repo`'s
 * WORKING TREE, so a main checkout parked on some other ref — T27's `--adopt` run left it in
 * detached HEAD at a release tag where docs/specs/ did not exist — makes every card read as
 * "missing spec, plan" and the campaign stalls on an error that names the wrong cause. This
 * turns `git rev-parse --abbrev-ref HEAD`'s output (`HEAD` when detached, else the branch
 * name) plus the resolved base branch into the one sentence the operator needs, or `null`
 * when the checkout is on the base branch (or unknown — an empty output says nothing rather
 * than guessing). The working-tree read itself is deliberately kept: switching the pre-flight
 * check to `<remote>/<base>` would make a locally authored, not-yet-pushed plan fail
 * pre-flight, a behaviour change a bug fix should not carry. */
export function checkoutMismatchNote(headRef: string, baseBranch: string, repoRoot: string): string | null {
  const ref = headRef.trim();
  if (ref === '' || ref === baseBranch) return null;
  const where = ref === 'HEAD' ? 'is in detached HEAD' : `is checked out at ${ref}`;
  return (
    `${repoRoot} ${where}, not ${baseBranch}; spec/plan paths are resolved against that working ` +
    `tree, so files present on ${baseBranch} still read as missing. Restore it ` +
    `(git -C ${repoRoot} checkout ${baseBranch}) before re-triggering.`
  );
}

/** Impure edge for `checkoutMismatchNote`: one read-only `git rev-parse`, through the io
 * seam. A failed query yields no note — the plain "missing" detail is still correct. */
async function checkoutNoteFor(io: LoopIO, repoRoot: string, baseBranch: string): Promise<string | null> {
  const head = await io.exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
  if (head.exitCode !== 0) return null;
  return checkoutMismatchNote(head.stdout, baseBranch, repoRoot);
}

/** The `planning_needed` escalation detail, with the C2 checkout note appended when it
 * applies. Shared by the serial pass, the N>1 pool, and `--dry-run` so all three name the
 * same cause the same way. */
async function planningNeededDetail(
  io: LoopIO,
  repoRoot: string,
  baseBranch: string,
  missing: Array<'spec' | 'plan'>,
): Promise<{ detail: string; note: string | null }> {
  const note = await checkoutNoteFor(io, repoRoot, baseBranch);
  const base = `Missing on disk: ${missing.join(', ')}`;
  return { detail: note ? `${base}. ${note}` : base, note };
}

export interface LoopResult {
  exitCode: number;
  processed: CardOutcome[];
  message?: string;
  dryRunPlan?: DryRunPlan;
  /** Harness-gap-wiring PR C: set only when the pass would otherwise have concluded `done` but
   * `answers.md` still carries ≥1 unratified ruling (`core/rulings.ts`) — see `runLoop`'s
   * post-`runPass` check, below. */
  unratifiedRulings?: string[];
}

/** D5′ park-and-continue (spec §O4/§2 wall reads): a single pass can now end with a MIX of
 * outcomes — some cards shipped, some escalated (new this pass or still pending from a prior
 * one), some merely `stopped` (a session error/timeout with no further D4 fallback). This
 * precedence turns that mix into the ONE exit code the caller (Stage C, or a human running the
 * CLI by hand) reads. An escalation always needs a human ruling, so it outranks a `stopped`
 * card — which is "safe to retry, no judgment needed" — even when other cards in the same pass
 * shipped cleanly (design note: an escalation is the thing needing a human; session-incomplete
 * merely resumes next run). `EXIT_OK` only when every attempted card shipped, or none were
 * attempted at all (e.g. the campaign was already fully `done`). */
function computeExitCode(processed: CardOutcome[]): number {
  if (processed.some((o) => o.kind === 'escalated' || o.kind === 'escalation_pending')) {
    return EXIT_ESCALATED;
  }
  if (processed.some((o) => o.kind === 'stopped')) {
    return EXIT_SESSION_INCOMPLETE;
  }
  return EXIT_OK;
}

/** Derives the target repo's base branch from `<remote>/HEAD` rather than hardcoding
 * `master`/`main` (stateless-capability wall: no campaign/repo value baked in). Verified
 * against the real CLI: `git symbolic-ref --short refs/remotes/<remote>/HEAD` -> `<remote>/master`
 * (see the task-6 report's transcript). Falls back to `master` only if the query itself
 * fails (e.g. `<remote>/HEAD` was never set) — a protocol-level default, not a campaign value. */
export async function resolveBaseBranch(
  io: { exec: LoopIO['exec'] },
  repoRoot: string,
  remote: string,
): Promise<string> {
  const result = await io.exec(['git', 'symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    return 'master';
  }
  const trimmed = result.stdout.trim();
  const prefix = `${remote}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed || 'master';
}

/** D5′ park-and-continue (Warchief ruling W-F2): `attempted` excludes any card id already
 * attempted THIS pass from the candidate sequence, independent of `card.status`. This is what
 * makes the park-and-continue loop's termination argument STRUCTURAL rather than incidental —
 * every pass attempts each card at most once (the sequence handed to `nextCard` strictly
 * shrinks every iteration, bounded by `state.sequence.length`), so a pass is guaranteed to
 * reach `done` without ever depending on a status mutation "eventually" excluding a card.
 *
 * Without this, two real triggers loop forever once `break` becomes `continue`: (1) an already
 * `escalated` card is excluded by `nextCard` ONLY when `includeEscalated` is false — Stage C's
 * own re-trigger shape (`--cards <answered> --include-escalated`, spec §O6) sets it true, so a
 * card that escalates AGAIN this pass would be re-selected every tick; (2) a card with a
 * pending PRIOR-run escalation file is never excluded by `card.status` at all — the file, not
 * the status, is what `deriveCardPhase` keys on (see `CardOutcome`'s `escalation_pending`
 * doc). Both cases are exercised in loop.test.ts's "W-F2" and "escalation_pending" suites. */
function filteredNextCard(
  state: CampaignState,
  config: RunLoopConfig,
  io: LoopIO,
  attempted: ReadonlySet<string> = new Set(),
): NextCardResult {
  const sequence = requestedSequence(state, config).filter((id) => !attempted.has(id));
  const view: CampaignState = { ...state, sequence };
  const stateIO: StateIO = {
    repoRoot: config.repoRoot,
    homeDir: config.homeDir,
    fileExists: (p) => io.fileExists(p),
  };
  return nextCard(view, stateIO, { includeEscalated: config.includeEscalated });
}

/** The card ids this run may touch: the state's sequence, narrowed by `--cards` when given. */
function requestedSequence(state: CampaignState, config: RunLoopConfig): string[] {
  const hasCardsFilter = config.cardsFilter !== undefined && config.cardsFilter.length > 0;
  return hasCardsFilter ? state.sequence.filter((id) => config.cardsFilter?.includes(id)) : state.sequence;
}

/** D1: "Refs are validated at load; a dangling ref refuses the run." Resolves the task index of
 * every card this run may touch against its plan, and throws ONE `TaskIndexError` naming every
 * issue — before any lock-held work, session, or write. Two kinds of card are skipped on purpose:
 * a `shipped` card (its plan may be gone after the merge), and a card whose plan is not on disk
 * (that is the `planning_needed` escalation `nextCard` already raises, not a ref problem). */
async function resolveTaskIndexes(
  state: CampaignState,
  config: RunLoopConfig,
  io: LoopIO,
): Promise<Record<string, ResolvedTask[]>> {
  const taskIndex: Record<string, ResolvedTask[]> = {};
  const issues: TaskIndexIssue[] = [];
  for (const cardId of requestedSequence(state, config)) {
    const card = state.cards[cardId];
    if (!card || card.status === 'shipped') continue;
    if (!card.plan) continue;
    let planPath: string | null;
    try {
      planPath = planPathWithinRepo(config.repoRoot, card.plan, io.canonicalPath);
    } catch {
      planPath = null; // an unresolvable path cannot be proven inside the repo
    }
    if (planPath === null) {
      for (const task of card.tasks) issues.push({ cardId, taskId: task.id, heading: task.heading, problem: 'plan_outside_repo' });
      continue;
    }
    if (!io.fileExists(planPath)) continue;
    const resolution = resolveTaskIndex(cardId, card.tasks, String(await io.readFile(planPath)));
    taskIndex[cardId] = resolution.tasks;
    issues.push(...resolution.issues);
  }
  if (issues.length > 0) throw new TaskIndexError(issues);
  return taskIndex;
}

async function runDryRun(config: RunLoopConfig, io: LoopIO): Promise<LoopResult> {
  // P11 audit fix: `--dry-run` is a diagnostic tool (see this function's zero-side-effects
  // doc comment on `runLoop`) — exactly what an operator reaches for to inspect a suspected
  // R3 stale-baseSha incident (the B13 shape) WITHOUT touching state. It must still surface
  // the warning, same as the two other `loadState` call sites (run-loop.ts's runLoop,
  // cli/main.ts) — state.ts stays pure; this is still just the edge printing it.
  const state = await loadState(
    () => io.readFile(campaignStatePathOf(config.homeDir)),
    (warning) => console.error(`[tribe-runner] ${warning}`),
  );
  await resolveTaskIndexes(state, config, io);
  const nc = filteredNextCard(state, config, io);

  if (nc.kind === 'done') {
    return { exitCode: EXIT_OK, processed: [], dryRunPlan: { cardId: null, phase: null, done: true } };
  }
  if (nc.kind === 'planning_needed') {
    // C2: read-only `git` queries only — the zero-side-effects guarantee holds.
    const baseBranch = await resolveBaseBranch(io, config.repoRoot, config.remote);
    const { note } = await planningNeededDetail(io, config.repoRoot, baseBranch, nc.missing);
    return {
      exitCode: EXIT_OK,
      processed: [],
      dryRunPlan: {
        cardId: nc.cardId,
        phase: null,
        planningNeeded: { cardId: nc.cardId, missing: nc.missing, ...(note ? { note } : {}) },
      },
    };
  }

  const phase = await deriveCardPhase(nc.cardId, nc.card, derivePhaseConfigOf(config), io);
  return { exitCode: EXIT_OK, processed: [], dryRunPlan: { cardId: nc.cardId, phase } };
}

/** STOP honored before any work: a present STOP file ends the run cleanly, before the lock's
 * critical section does anything. */
function startupStopResult(config: RunLoopConfig, io: LoopIO): LoopResult | null {
  if (!isStopRequested(stopFilePathOf(config), io)) return null;
  return {
    exitCode: EXIT_OK,
    processed: [],
    message: 'STOP file present; exiting cleanly before processing any card.',
  };
}

/** Loads everything `RunLoopConfig` doesn't carry: the base branch (from origin/HEAD), the
 * committed --answers rulings, and the committed brief template — all through the io seam.
 * The task index is the one exception: it needs the loaded state, so `runLoop` adds it. */
async function resolveRunContext(config: RunLoopConfig, io: LoopIO): Promise<Omit<ResolvedConfig, 'taskIndex'>> {
  const baseBranch = await resolveBaseBranch(io, config.repoRoot, config.remote);
  const answersContent = String(await io.readFile(answersPathOf(config.homeDir)));
  const briefTemplate = String(await io.readFile(BRIEF_TEMPLATE_PATH));
  return { ...config, baseBranch, answersContent, briefTemplate };
}

/** A single card's phase-derive → (park on `escalation_pending`) → `actOnCard`-with-bounded-
 * retry turn — extracted out of `runPass`'s while-loop body so the N=1 serial pass and the
 * N>1 concurrent pool (`runPassPool`, below) share EXACTLY one implementation of this logic.
 * A behavior fixed here is fixed identically for both; there is no second copy that could
 * silently drift. `worked` mirrors `runPass`'s own attempted/worked split (see that function's
 * doc comment): `false` only for `escalation_pending` (nothing done this pass, no budget
 * spent), `true` for every other outcome (`shipped`/`escalated`/`stopped` — real work
 * happened, even a `stopped` session that ran out of retries). */
async function runCardTurn(ctx: CardCtx, nc: CardResult): Promise<{ outcome: CardOutcome; worked: boolean }> {
  const phase = await deriveCardPhase(nc.cardId, nc.card, derivePhaseConfigOf(ctx.resolved), ctx.io);

  if (phase.kind === 'escalation_pending') {
    return {
      outcome: { kind: 'escalation_pending', cardId: nc.cardId, escalationPath: phase.escalationPath },
      worked: false,
    };
  }

  let outcome = await actOnCard(ctx, phase);
  let retries = 0;
  while (outcome.kind === 'stopped' && outcome.retryable && retries < 2) {
    retries += 1;
    const retryPhase = await deriveCardPhase(nc.cardId, nc.card, derivePhaseConfigOf(ctx.resolved), ctx.io);
    if (retryPhase.kind === 'escalation_pending') break;
    outcome = await actOnCard(ctx, retryPhase);
  }
  return { outcome, worked: true };
}

/** One D5′ park-and-continue pass over the campaign: derive-and-act until `done`, STOP, or
 * the --max-cards budget is spent. `reachedDone` records WHICH of the three ended the pass:
 * true only when `filteredNextCard` itself returned `{ kind: 'done' }` (no progressable card
 * remains) — a mid-pass STOP and a spent budget both leave it false, because cards may remain
 * genuinely unattempted on those paths. `computeExitCode` cannot tell these apart (all three
 * can be `EXIT_OK`), and the rulings gate below must fire only on genuine done. */
async function runPass(
  state: CampaignState,
  resolved: ResolvedConfig,
  io: LoopIO,
): Promise<LoopResult & { reachedDone: boolean }> {
  const processed: CardOutcome[] = [];
  // Warchief audit fix (Task 2): `attempted` and the `--max-cards` BUDGET are two different
  // questions, and conflating them was a bug. `attempted` answers ONLY "have I already
  // selected this card id this pass?" — every selected card, unconditionally, is what keeps
  // `filteredNextCard`'s termination argument structural (see that function's own doc
  // comment). `worked` answers "how much of the operator's requested budget have I actually
  // spent?" — plan: "--max-cards counts attempted cards (shipped + escalated)", i.e. cards
  // where something was actually DONE this pass. A card parked on a PRIOR run's escalation
  // file (`escalation_pending`) writes nothing and decides nothing this pass — exactly like
  // a `blocked` card `nextCard` itself skips — so it must not consume budget either; only
  // `planning_needed` (a genuine new escalation is written) and the generic `actOnCard`
  // outcomes (`shipped`/`escalated`/`stopped` — real work happened) increment `worked`.
  const attempted = new Set<string>();
  let worked = 0;
  const limit = resolved.maxCards ?? Infinity;

  // D5′ park-and-continue: loop until either no progressable card remains (`done`) or the
  // `--max-cards` budget (`worked`, above) is spent. `attempted` alone bounds how many times
  // the loop can tick even when `worked` never reaches `limit` (e.g. every remaining card is
  // `escalation_pending`) — see `filteredNextCard`'s doc comment (Warchief ruling W-F2) for
  // why that must be structural, not incidental.
  let reachedDone = false;
  while (worked < limit) {
    if (isStopRequested(stopFilePathOf(resolved), io)) {
      break;
    }

    const nc = filteredNextCard(state, resolved, io, attempted);
    if (nc.kind === 'done') {
      reachedDone = true;
      break;
    }

    const ctx: CardCtx = { cardId: nc.cardId, state, resolved, io };

    if (nc.kind === 'planning_needed') {
      attempted.add(nc.cardId);
      const { detail } = await planningNeededDetail(io, resolved.repoRoot, resolved.baseBranch, nc.missing);
      const outcome = await escalateCard(ctx, 'planning_needed', detail);
      processed.push(outcome);
      worked += 1;
      continue;
    }

    // P1 fix-list "wait-aware liveness" (containment layer): a `stopped` outcome whose
    // session ended with `error` (never `timeout`) is exactly what a human re-trigger fixed
    // on 08-08 — the card's sessionId is already recorded locally (written by `onSessionStart`
    // the instant the SDK assigns it, before the session can even reach a PR/branch), so
    // re-deriving the phase naturally takes the D4 resume path: `pr_open`/`branch_no_pr` when
    // a branch was already known, or the P1 audit fix-round's `session_only` reason
    // (`phase.ts`) when it wasn't — never a blind second `fresh` spawn on top of possibly-
    // still-open work. Bounded to 2 retries per card per pass so a persistently-erroring card
    // still surfaces as `stopped` rather than looping forever. (`escalation_pending` — D5′: an
    // unanswered escalation from a PRIOR run — is also handled inside `runCardTurn`; nothing
    // to do this pass but park it and move to the next card.)
    const { outcome, worked: didWork } = await runCardTurn(ctx, nc);
    attempted.add(nc.cardId);
    processed.push(outcome);
    if (didWork) worked += 1;
    // D5′: `escalated`/`stopped` no longer `break` the pass — the next tick naturally
    // re-derives the next progressable card (excluding this one, now `attempted`) via
    // `filteredNextCard`/`nextCard`'s own blocked-cascade reconciliation (W6).
  }

  return { exitCode: computeExitCode(processed), processed, reachedDone };
}

/** P12 follow-up (`--max-concurrent N`, N > 1): the SAME per-card turn (`runCardTurn`) as the
 * N=1 serial `runPass` above, but up to `maxConcurrent` cards run their turns concurrently —
 * cooperatively, via JS's single-threaded event loop (never true parallel execution: every
 * synchronous span still runs to completion with no other worker's code interleaved inside
 * it). `runLoop` routes N=1 to `runPass` unconditionally (see that call site) — this function
 * is never invoked, let alone tested, for the default width, so N=1 cannot regress through it.
 *
 * Safety argument (P12 follow-up brief: "either serialize state mutations ... or prove
 * per-card field disjointness"):
 *
 * 1. Selection never double-hands a card. `filteredNextCard`/`nextCard` (`state.ts`) are
 *    SYNCHRONOUS — and MUTATING (`nextCard` calls `reconcileBlockedStatuses`, which flips
 *    `card.status` between `'blocked'`/`'staged'` in place on every call — never "pure" in the
 *    no-side-effects sense, just synchronous and side-effect-free w.r.t. the OUTSIDE world) — no
 *    `await` sits between reading a freshly-selected `nc.cardId` and `attempted.add(nc.cardId)`
 *    below, so two fill iterations can never observe the same unclaimed card. Nor can this
 *    in-place reconciliation itself race: it only ever flips a card TO `blocked` when it
 *    (transitively) depends on one that's `escalated`/already-blocked, and TO `staged` when it
 *    no longer does — an in-flight (claimed but unshipped) card is neither, so it is never a
 *    target these mutations touch while a worker holds it. `attempted` is claimed at SELECTION
 *    time here — unlike `runPass`'s N=1 loop, which can safely claim after the fact because it
 *    never selects a second card until the first is fully done — the one deliberate behavioral
 *    difference from `runPass`, required for concurrency to be safe at all.
 * 2. `dependsOn` still orders correctly with NO extra bookkeeping. `nextCard` already treats
 *    any non-`shipped` status — including a claimed-but-still-`staged`/`running` in-flight
 *    card — as "not shipped", so a dependent card is never selected while its dependency is
 *    mid-flight, exactly like an ordinary not-yet-selected `staged` dependency behaves today.
 * 3. Two in-flight cards never touch the same mutable sub-object. `state.cards[cardId]` is a
 *    distinct object per card id, and point 1 guarantees no two workers ever share a `cardId`
 *    — so every `card.status = ...`/`card.pr = ...`-style mutation `card-actions.ts` makes is
 *    disjoint across concurrently-running workers by construction.
 * 4. `persistLocalState` writes are never torn or regressed. `commit-guard.ts`'s
 *    `persistLocalState` synchronously serializes and writes the WHOLE `state` object (never a
 *    per-card patch), and every mutation site in `card-actions.ts` calls it in the SAME
 *    synchronous span as the mutation (no `await` in between) — JS run-to-completion semantics
 *    make each mutate-then-flush pair atomic. `state` is one shared object, never copied per
 *    card, so the strict total order JS's single thread imposes on these atomic spans makes
 *    the writes that actually reach disk MONOTONIC: whichever flush lands last always includes
 *    every mutation any worker had applied by that point, in flight or finished — never a lost
 *    update, regardless of which worker happened to finish first.
 * 5. (P12 follow-up hardening) The FILESYSTEM/git layer, which points 1-4 above deliberately do
 *    not cover, is handled separately: `card-actions.ts`'s `serializeRepoGitMutation` queues
 *    every runner-side `git worktree`/`branch -D` mutation (`performRevertAndRedo`,
 *    `executeHealActions`, `gatherWorktreeResidueFacts`) behind one promise chain so two cards'
 *    calls into git's shared, repo-wide bookkeeping never interleave — see that helper's own
 *    doc comment for why a promise queue is enough (no real OS lock needed) and what it does
 *    NOT cover (an executor session's own git commands, which this queue cannot reach).
 * 6. (P12 follow-up hardening) One card's turn throwing an uncaught exception can never abort
 *    the whole pass or abandon other in-flight cards: `launch`'s `.catch` converts it to a
 *    `stopped`/non-retryable `CardOutcome` for THAT card only, and `.finally` unconditionally
 *    clears its `active` slot — see `launch`, below.
 *
 * Budget bookkeeping (`--max-cards`, `worked`) is necessarily OPTIMISTIC under concurrency: the
 * fill loop cannot know whether a freshly-claimed card will turn out to be real work or an
 * `escalation_pending` park (that only resolves once `runCardTurn` itself runs), so it treats
 * every in-flight claim as a potential unit of budget (`worked + active.size < limit`) — this
 * can never OVERSHOOT the limit (a park simply leaves `worked` short of the number of workers
 * launched, self-correcting on the next fill tick) but a batch can undershoot by up to
 * `maxConcurrent - 1` cards' worth of parks before the budget is recognized as spent.
 *
 * NOT solved here (documented limitations — the runner README and SKILL.md carry the same
 * notes):
 * - Two cards that both merge to the SAME base branch can still race at the actual `gh pr
 *   merge` step — git itself is what serializes (or rejects/re-queues) that, not this pool.
 * - Each card's OWN executor session runs its own git commands (worktree add, checkout,
 *   commit, push, ...) with `cwd: resolved.repoRoot` too (`session.ts`'s pinned SDK options) —
 *   point 5 above serializes only the RUNNER's own git calls; it cannot reach into a session's
 *   independently-spawned process. Git's own locking mostly prevents outright corruption there,
 *   but a lock-contention failure can surface as an ordinary non-zero exit from a git command —
 *   read that as transient contention, not repo corruption, and retry rather than escalate on
 *   sight. Re-plumbing every session to its own isolated `cwd` is real future hardening, out of
 *   scope for this pass.
 * `N > 1` bounds WIDTH only; it is never an ordering promise beyond what `dependsOn` declares. */
async function runPassPool(
  state: CampaignState,
  resolved: ResolvedConfig,
  io: LoopIO,
  maxConcurrent: number,
): Promise<LoopResult & { reachedDone: boolean }> {
  const processed: CardOutcome[] = [];
  const attempted = new Set<string>();
  let worked = 0;
  let reachedDone = false;
  const limit = resolved.maxCards ?? Infinity;
  const active = new Set<Promise<void>>();

  const launch = (nc: CardResult): void => {
    const ctx: CardCtx = { cardId: nc.cardId, state, resolved, io };
    const task: Promise<void> = runCardTurn(ctx, nc)
      // Panel finding #2 (P12 follow-up hardening): an uncaught exception from ANYWHERE in a
      // card's turn (deriveCardPhase, actOnCard, or anything either calls) must be contained to
      // THIS card — never left to reject `task` and blow up the awaited `Promise.race(active)`
      // below, which would abort the whole pool pass and abandon every OTHER card still
      // in-flight mid-session. Converted to the same `stopped` shape a session ending with
      // outcome `'error'` already produces; `retryable: false` because a thrown exception (as
      // opposed to a typed `SessionResult`) leaves no known-safe state to resume from — treated
      // as the SAFER, non-retryable case, exactly like `CardOutcome.stopped`'s own doc comment
      // already distinguishes `'error'`/retryable from `'timeout'`/not.
      .catch((err: unknown): { outcome: CardOutcome; worked: boolean } => ({
        outcome: {
          kind: 'stopped',
          cardId: nc.cardId,
          reason: `card turn threw: ${err instanceof Error ? err.message : String(err)}`,
          retryable: false,
        },
        worked: true,
      }))
      .then((result) => {
        processed.push(result.outcome);
        if (result.worked) worked += 1;
      })
      // ALWAYS runs, whether the turn shipped, escalated, parked, or (now) threw — a card can
      // never wedge a permanent slot in `active` and starve the pool of capacity.
      .finally(() => {
        active.delete(task);
      });
    active.add(task);
  };

  for (;;) {
    if (!isStopRequested(stopFilePathOf(resolved), io)) {
      // Top up to `maxConcurrent` in-flight workers, never claiming past the (optimistic)
      // --max-cards budget — see this function's own doc comment.
      while (active.size < maxConcurrent && worked + active.size < limit) {
        const nc = filteredNextCard(state, resolved, io, attempted);
        if (nc.kind === 'done') {
          // Genuinely done only when nothing is still in flight to possibly unblock a later
          // card (e.g. by shipping a dependency) — see point 2 of the doc comment above.
          if (active.size === 0) reachedDone = true;
          break;
        }
        if (nc.kind === 'planning_needed') {
          attempted.add(nc.cardId);
          const ctx: CardCtx = { cardId: nc.cardId, state, resolved, io };
          const { detail } = await planningNeededDetail(io, resolved.repoRoot, resolved.baseBranch, nc.missing);
          const outcome = await escalateCard(ctx, 'planning_needed', detail);
          processed.push(outcome);
          worked += 1;
          continue;
        }
        attempted.add(nc.cardId); // Claim BEFORE any await below — see point 1 of the doc comment.
        launch(nc);
      }
    }

    if (active.size === 0) break;
    await Promise.race(active);
  }

  return { exitCode: computeExitCode(processed), processed, reachedDone };
}

/** Harness-gap-wiring PR C (spec: outstanding-17 postmortem — a ruling that captured a durable
 * convention was never ratified into the target repo's governance files because nothing gated
 * on it): the mechanical gate. Pure — takes the pass's own result and the `answers.md` content
 * `resolveRunContext` already read once through the injected `io` seam (`resolved.answersContent`
 * — no second read here) and decides whether to override an `EXIT_OK` ("done") into
 * `EXIT_RULINGS_UNRATIFIED`. `reachedDone` (runPass) must be true as well as `EXIT_OK`:
 * `computeExitCode` returns `EXIT_OK` equally for genuine done, a mid-pass STOP, and a spent
 * `--max-cards` budget, and gating the latter two would flip "partial progress, come back
 * later" into a rulings failure while cards remain genuinely unattempted (3-lens review,
 * contract lens). Every other exit code (an escalation, a stopped session) passes
 * through UNCHANGED — the brief is explicit that this gate fires only on the path that would
 * otherwise conclude `done`. Mirrors `debt-count.ts`'s own framing of its diff-mode gate: "exit
 * code is a gate, not a report." */
function applyRulingsGate(
  result: LoopResult,
  answersContent: string,
  reachedDone: boolean,
): LoopResult {
  if (!reachedDone || result.exitCode !== EXIT_OK) return result;

  const unratified = unratifiedRulingIds(answersContent);
  if (unratified.length === 0) return result;

  return {
    ...result,
    exitCode: EXIT_RULINGS_UNRATIFIED,
    unratifiedRulings: unratified,
    message:
      `${unratified.length} ruling(s) in answers.md are not yet ratified: ${unratified.join(', ')}. ` +
      'Add a `ratified-as:` line to each block (see the runner README), then re-run.',
  };
}

/** The main loop, spec §D2/§D4/§D5′ tied together: acquire the single-instance lock → STOP-file
 * check → repeatedly derive-and-act on the next card, PARKING
 * (never exiting) on an escalation or a `stopped` session — D5′'s amendment of the original
 * exit-on-escalation D5. The pass stops only when no progressable card remains (`done`) or the
 * `--max-cards` budget is spent — counted by cards actually WORKED this pass (`shipped` /
 * `escalated` / `stopped`), never by a card merely PARKED on a prior run's escalation file
 * (Warchief audit fix: dedup/termination and the operator's work budget are different
 * questions — see the `attempted`/`worked` split at this function's loop, below). A STOP file
 * is still honored between cards (finishes the in-flight card only, never aborts one mid-flight).
 * `--dry-run` short-circuits to `runDryRun` before any of this (no lock, no writes, no session —
 * see `runDryRun`'s own doc comment for why that is zero side effects BY CONSTRUCTION, not
 * merely by intent). */
export async function runLoop(config: RunLoopConfig, io: LoopIO): Promise<LoopResult> {
  if (config.dryRun) {
    return runDryRun(config, io);
  }

  const lockResult = acquireLock(io);
  if (!lockResult.ok) {
    return { exitCode: EXIT_LOCKED, processed: [], message: lockResult.reason };
  }

  try {
    // Spec §4/§5.2: the run record is written the moment the lock is held — never on a
    // refused start, never on --dry-run (which returned above, before the lock). Failures
    // are swallowed: observability exhaust must never kill a campaign run (spec §9); the
    // record's absence is itself the viewer-visible signal.
    try {
      io.ensureDir(runDirOf(config.homeDir, config.runId));
      io.ensureDir(reportsDirOf(config.homeDir));
      io.writeFileAtomic(
        runRecordPathOf(config.homeDir, config.runId),
        serializeRunRecord(buildRunRecord(config, io)),
      );
    } catch {
      // See comment above.
    }

    const stopped = startupStopResult(config, io);
    if (stopped) return stopped;

    const context = await resolveRunContext(config, io);

    // P11 fix-list: surfaces `loadState`'s R3-invariant normalization warnings at the edge —
    // state.ts stays pure (it only computes the warning strings; it never imports `console`
    // itself), this is the one place a real run actually prints them.
    const state = await loadState(
      () => io.readFile(campaignStatePathOf(config.homeDir)),
      (warning) => console.error(`[tribe-runner] ${warning}`),
    );
    const resolved: ResolvedConfig = { ...context, taskIndex: await resolveTaskIndexes(state, config, io) };
    // P12 follow-up: N=1 (omitted or explicit) always takes the ORIGINAL `runPass` code path
    // — never `runPassPool`, even with maxConcurrent read as `?? 1` — so the default behavior
    // this whole runner shipped with cannot regress through the new pool path. Only N > 1
    // routes to `runPassPool`; see that function's own doc comment for the concurrency-safety
    // argument.
    const maxConcurrent = resolved.maxConcurrent ?? 1;
    const result =
      maxConcurrent > 1 ? await runPassPool(state, resolved, io, maxConcurrent) : await runPass(state, resolved, io);
    // W-F5 (Warchief fix): `nextCard`'s `reconcileBlockedStatuses` (state.ts) can mark a card
    // `blocked` IN MEMORY on the very tick that also discovers `done` (no further progressable
    // card) — that tick never reaches `actOnCard`/`escalateCard`/`shipCard`, so the mutation
    // would otherwise never be flushed via `persistLocalState`, and the file on disk would keep
    // reporting that card's stale pre-reconciliation status (e.g. `staged`) forever, even though
    // it is genuinely blocked behind an unanswered escalation. One `persistLocalState` call
    // here, on every normal (non-dry-run, non-locked) return, closes that gap for good — state
    // was definitely loaded and may have been mutated by this point, and `serializeState`'s
    // byte-identical round-trip means a pass with no reconciliation to flush just rewrites the
    // same bytes (harmless, no spurious diff).
    persistLocalState(state, resolved, io);
    // Harness-gap-wiring PR C: gate the genuinely-done exit on `answers.md`'s unratified
    // rulings — see `applyRulingsGate`'s own doc comment. A no-op for every other exit code
    // and for EXIT_OK passes that ended on STOP or a spent --max-cards budget.
    const { reachedDone, ...loopResult } = result;
    return applyRulingsGate(loopResult, resolved.answersContent, reachedDone);
  } finally {
    releaseLock(io);
  }
}
