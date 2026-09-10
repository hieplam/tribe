// Per-card work: escalate/ship a card, run its executor session (with the D4 resume-with-
// fallback matrix), and REVERT_AND_REDO. Every world-touching effect goes through the
// injected `LoopIO`/`SessionIO` seams — this module never imports a world-touching module
// itself.
import type { Card, CampaignState, ResolvedConfig } from '../types.ts';
import type { LoopIO } from '../../ports/ports.ts';
import { verifyShipped } from '../verify.ts';
import type { VerifyConfig, VerifyPointId, VerifyResult } from '../verify.ts';
import { runSession } from '../session.ts';
import type { RunSessionConfig, SessionIO, SessionResult } from '../session.ts';
import { executorBrief, reportPathFor } from '../brief.ts';
import type { BriefCard, BriefState } from '../brief.ts';
import type { CardPhase } from './phase.ts';
import { buildStateDigest, findWorktreePathForBranch } from './phase.ts';
import { persistLocalState } from './commit-guard.ts';
import { answersPathOf, escalationPathOf } from '../paths.ts';
import { decideResidueHeal, type HealAction } from '../residue.ts';
import { WORKTREE_STILL_PRESENT_DETAIL } from '../verify.ts';

export type CardOutcome =
  | { kind: 'shipped'; cardId: string }
  | {
      kind: 'escalated';
      cardId: string;
      escalationPath: string;
      reason: string;
    }
  | {
      /** D5′ park-and-continue (spec §O4): the card already carries an UNANSWERED escalation
       * file from a PRIOR run (`deriveCardPhase`'s `escalation_pending` short-circuit) — no
       * new work happens for it this pass; it is simply parked and the loop moves on. Kept as
       * its own `CardOutcome` kind rather than folded into `escalated` because, unlike
       * `escalated`, nothing is written this pass: the escalation file and `card.status`
       * already carry the escalation from whenever it first fired, possibly runs ago. */
      kind: 'escalation_pending';
      cardId: string;
      escalationPath: string;
    }
  | {
      /** P1 fix-list: `retryable` is `true` only when the session ended with outcome
       * `'error'` ("ended without a terminal SHIPPED/NEEDS_DIRECTION line" — exactly the
       * wait-trap the ×4 incident hit) and `false` for `'timeout'` (a timed-out session was
       * aborted deliberately; retrying it risks racing a still-running process). Read by
       * `run-loop.ts`'s bounded auto-retry loop. */
      kind: 'stopped';
      cardId: string;
      reason: string;
      retryable: boolean;
    };

/** The per-card working set threaded through every card-scoped function. `card` is
 * deliberately NOT a member: it is always derived as `ctx.state.cards[ctx.cardId]` at point
 * of use, so the invariant "card IS the state entry" holds by construction (a separately
 * threaded `card` invites a `{...card}` copy that silently never persists). */
export interface CardCtx {
  cardId: string;
  state: CampaignState;
  resolved: ResolvedConfig;
  io: LoopIO;
}

// ---------------------------------------------------------------------------------------
// P12 follow-up hardening (panel finding, `--max-concurrent N > 1`): a 3-lens adversarial
// review of the pool (run-loop.ts's `runPassPool`) proved the pool's OWN safety argument only
// covers the shared in-memory `CampaignState` object — it never addressed the filesystem/git
// layer. Under N > 1, more than one card's turn can be mid-flight at once, and three functions
// below mutate git's shared, repo-wide bookkeeping (`.git/worktrees/`, `.git/refs/heads/`)
// against the SAME `resolved.repoRoot`: `git worktree add/remove`, `git branch -D`, and a
// `git worktree list --porcelain` snapshot that can go stale the instant another card's
// `git worktree remove` runs before this card acts on what it read. Git's own locking mostly
// prevents outright corruption, but a lock-contention failure surfaces as an ordinary non-zero
// exit — exactly the shape this module already treats as a real git-state problem elsewhere
// (see `gatherWorktreeResidueFacts`'s own `exitCode === 0` comment) — so left unserialized, a
// transient race could misfire as a false residue-heal refusal or a spurious REVERT_AND_REDO
// failure.
//
// `serializeRepoGitMutation` queues exactly these three functions relative to EACH OTHER,
// across every card — nothing else in this module needs it: every other git call here is
// either read-only against GitHub (`recordBranchFromPr`) or scoped to a path/branch no other
// card can also be touching (`recordBaseSha`'s `rev-parse` reads a ref, it doesn't mutate
// worktree/branch bookkeeping).
//
// A promise-chain queue is enough — NOT a real OS-level lock — because JS is single-threaded:
// the only thing that can interleave two "logically atomic" async call sequences is an `await`
// inside one of them yielding to the event loop mid-way, which is exactly what queuing behind
// one shared "last enqueued" promise prevents. At `--max-concurrent 1` this is a permanent
// no-op by construction (there is only ever one caller in flight, so a fresh `enqueue` never
// has anything queued ahead of it to wait on) — deliberately always-on rather than branching on
// `maxConcurrent`, so there is no separate N=1/N>1 code path to keep in sync or regress.
let repoGitMutationQueue: Promise<unknown> = Promise.resolve();

function serializeRepoGitMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = repoGitMutationQueue.then(fn, fn);
  // However `fn` settles, the QUEUE ITSELF must keep moving — a rejected `fn` still resolves
  // the queue's own chained value (swallowed here) so the NEXT caller isn't wedged behind a
  // permanently-rejected promise; the rejection still reaches whoever awaited `run` (this
  // function's own return value) unchanged.
  repoGitMutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Gathers the facts `decideResidueHeal` needs about worktree residue — ONLY when the
 * failing point's detail actually names a worktree problem (`"worktree still present"`);
 * an absent worktree needs no `git status`/`git merge-base` probe at all. Reuses
 * `findWorktreePathForBranch` (the same `git worktree list --porcelain` parser
 * `performRevertAndRedo` uses) rather than re-deriving worktree discovery. */
function gatherWorktreeResidueFacts(
  ctx: CardCtx,
  branch: string,
  worktreeDetail: string,
): Promise<{ worktreePath: string | null; worktreeStatusClean: boolean; tipIsAncestorOfBase: boolean }> {
  return serializeRepoGitMutation(() => gatherWorktreeResidueFactsImpl(ctx, branch, worktreeDetail));
}

async function gatherWorktreeResidueFactsImpl(
  ctx: CardCtx,
  branch: string,
  worktreeDetail: string,
): Promise<{ worktreePath: string | null; worktreeStatusClean: boolean; tipIsAncestorOfBase: boolean }> {
  if (!worktreeDetail.includes(WORKTREE_STILL_PRESENT_DETAIL)) {
    return { worktreePath: null, worktreeStatusClean: false, tipIsAncestorOfBase: false };
  }

  const { resolved, io } = ctx;
  const worktreeList = await io.exec(['git', 'worktree', 'list', '--porcelain'], { cwd: resolved.repoRoot });
  const worktreePath = findWorktreePathForBranch(worktreeList.stdout, branch);
  if (!worktreePath) {
    return { worktreePath: null, worktreeStatusClean: false, tipIsAncestorOfBase: false };
  }

  const status = await io.exec(['git', 'status', '--porcelain'], { cwd: worktreePath });
  // P4 audit fix-round (blocker, scout): a failed `git status --porcelain` (locked index,
  // transient error) presents as empty stdout — `exitCode === 0` is required too, exactly like
  // every other exec consumer in this module (the ancestor check below, `recordBaseSha`,
  // `recordBranchFromPr`), so a failed probe is never wrongly treated as "clean".
  const worktreeStatusClean = status.exitCode === 0 && status.stdout.trim().length === 0;

  const ancestor = await io.exec(
    ['git', 'merge-base', '--is-ancestor', branch, `${resolved.remote}/${resolved.baseBranch}`],
    { cwd: resolved.repoRoot },
  );
  const tipIsAncestorOfBase = ancestor.exitCode === 0;

  return { worktreePath, worktreeStatusClean, tipIsAncestorOfBase };
}

/** Executes the `HealAction`s `decideResidueHeal` proved safe, and returns ONLY the actions
 * that actually SUCCEEDED (checked by `exitCode`, never assumed) — `appendHealedDetail` must
 * never label an attempted-but-failed action as healed (P4 audit fix-round, should-fix:
 * a network blip/race that leaves the residue in place must not make the report claim
 * otherwise). Both recipes are the ones `performRevertAndRedo` already established for
 * REVERT_AND_REDO — reused, not duplicated — EXCEPT `remove_worktree` deliberately omits
 * `--force`: unlike REVERT_AND_REDO's "start over unconditionally", this residue was already
 * proven to carry no uncommitted work (spec §"worktree residue: safe only when ... `git status
 * --porcelain` is EMPTY"), so a plain `git worktree remove` is both sufficient and the more
 * conservative choice — the moment that changes underneath us (a stray write between the probe
 * and the remove), the plain form fails loudly instead of silently discarding it. P4 audit
 * fix-round (blocker): that "fails loudly" guarantee was previously undermined by running
 * `git branch -D` UNCONDITIONALLY even when the `worktree remove` was refused — a refused
 * (dirty) removal now short-circuits the branch delete entirely, so a dirty worktree is never
 * left orphaned with no branch pointing at it. */
function executeHealActions(ctx: CardCtx, actions: HealAction[]): Promise<HealAction[]> {
  return serializeRepoGitMutation(() => executeHealActionsImpl(ctx, actions));
}

async function executeHealActionsImpl(ctx: CardCtx, actions: HealAction[]): Promise<HealAction[]> {
  const { resolved, io } = ctx;
  const succeeded: HealAction[] = [];
  for (const action of actions) {
    if (action.kind === 'delete_remote_branch') {
      const result = await io.exec(
        ['git', 'push', resolved.remote, '--delete', action.branch],
        { cwd: resolved.repoRoot },
      );
      if (result.exitCode === 0) succeeded.push(action);
    } else {
      const removeResult = await io.exec(['git', 'worktree', 'remove', action.path], {
        cwd: resolved.repoRoot,
      });
      if (removeResult.exitCode !== 0) continue; // refused — do NOT touch the branch ref.
      const branchResult = await io.exec(['git', 'branch', '-D', action.branch], {
        cwd: resolved.repoRoot,
      });
      if (branchResult.exitCode === 0) succeeded.push(action);
    }
  }
  return succeeded;
}

/** Appends `(healed: <kind>, <kind>, ...)` to the `worktreeAndBranchGone` point's detail —
 * the ONLY place residue healing is recorded, so a report built from this result (whether it
 * ships or still needs to escalate on a DIFFERENT point) shows the heal instead of silently
 * passing over it. A no-op (returns `result` unchanged) when nothing was healed. */
function appendHealedDetail(result: VerifyResult, actions: HealAction[]): VerifyResult {
  if (actions.length === 0) return result;
  const suffix = ` (healed: ${actions.map((a) => a.kind).join(', ')})`;
  return {
    ...result,
    points: result.points.map((p) =>
      p.id === 'worktreeAndBranchGone' ? { ...p, detail: `${p.detail}${suffix}` } : p,
    ),
  };
}

/** The P4 fix-list wiring: between a first FAILED verify and the retry, heal whatever
 * residue `decideResidueHeal` proves safe (spec: only when the `merged` point PASSED and
 * `worktreeAndBranchGone` is the failing point), then re-verify. This is the ONE helper used
 * at both of `actOnCard`'s verify call sites — never duplicated. Heal is skipped entirely
 * (falling through to a plain retry, exactly today's D3/D5 "one more attempt" behavior)
 * whenever the safety conditions don't hold: an unmerged PR, a dirty worktree, or a
 * non-ancestor branch tip all leave `decideResidueHeal` returning `[]`, and the existing
 * escalation flow runs unchanged. */
export async function healSafeResidue(
  ctx: CardCtx,
  firstResult: VerifyResult,
  verifyConfig: VerifyConfig,
): Promise<VerifyResult> {
  const { state, cardId, io } = ctx;
  const card = state.cards[cardId];

  const mergedPoint = firstResult.points.find((p) => p.id === 'merged');
  const worktreePoint = firstResult.points.find((p) => p.id === 'worktreeAndBranchGone');

  let healedActions: HealAction[] = [];
  if (mergedPoint?.passed && worktreePoint && !worktreePoint.passed && card.branch) {
    const facts = await gatherWorktreeResidueFacts(ctx, card.branch, worktreePoint.detail);
    const actions = decideResidueHeal({
      mergedPassed: mergedPoint.passed,
      detail: worktreePoint.detail,
      branch: card.branch,
      ...facts,
    });
    healedActions = await executeHealActions(ctx, actions);
  }

  const retry = await verifyShipped(card, verifyConfig, io, cardId);
  return appendHealedDetail(retry, healedActions);
}

/** `actOnCard`'s two verify call sites both need exactly this: verify once, and only on
 * failure fall through to `healSafeResidue`'s heal-then-retry (which itself degrades to a
 * plain retry when nothing is provably safe to heal — see that function's doc comment).
 * Kept as its own tiny wrapper so neither call site repeats the `first.shipped` branch. Takes
 * only `ctx` — no separately threaded `card` — per `CardCtx`'s own doc comment: `card` is
 * always derived as `ctx.state.cards[ctx.cardId]` at point of use (P4 audit fix-round,
 * should-fix: this was the one function in the file that violated that invariant). */
async function verifyThenHealIfNeeded(ctx: CardCtx, verifyConfig: VerifyConfig): Promise<VerifyResult> {
  const card = ctx.state.cards[ctx.cardId];
  const first = await verifyShipped(card, verifyConfig, ctx.io, ctx.cardId);
  if (first.shipped) return first;
  return healSafeResidue(ctx, first, verifyConfig);
}

/** Extracts the merge sha `checkMerged`'s point recorded in its `detail` string —
 * `VerifyResult` doesn't surface it as its own field, and verify.ts must not be rewritten to
 * add one. */
export function extractMergeSha(result: VerifyResult): string | null {
  const mergedPoint = result.points.find((p) => p.id === 'merged');
  if (!mergedPoint) return null;
  const match = /merge_commit_sha=([0-9a-f]+)/.exec(mergedPoint.detail);
  return match ? (match[1] as string) : null;
}

/** P4 audit fix-round (blocker, skinnerA): reads back the `(healed: <kind>, <kind>, ...)`
 * suffix `appendHealedDetail` wrote onto the `worktreeAndBranchGone` point's detail — same
 * regex-extraction idiom as `extractMergeSha` above, for the same reason (`VerifyResult`
 * carries no dedicated field, and verify.ts must not be rewritten to add one). This is what
 * lets `shipCard` persist the heal onto `card.healedResidue`, which is the ONLY way a heal
 * that happened during THIS card's ship reaches `campaign-report.json`/`.md` — the actual
 * spec acceptance criterion ("report notes the heal"). Returns `[]` when nothing was healed. */
export function extractHealedKinds(result: VerifyResult): string[] {
  const worktreePoint = result.points.find((p) => p.id === 'worktreeAndBranchGone');
  if (!worktreePoint) return [];
  const match = /\(healed: ([^)]+)\)/.exec(worktreePoint.detail);
  if (!match) return [];
  return (match[1] as string)
    .split(',')
    .map((kind) => kind.trim())
    .filter((kind) => kind.length > 0);
}

export function formatVerifyFailure(result: VerifyResult): string {
  return result.points
    .filter((p) => !p.passed)
    .map((p) => `- ${p.id}: ${p.detail}`)
    .join('\n');
}

/** P5 audit fix-round (blocker, skinnerB): `VERIFY_FAILURE_BULLETS` is now typed
 * `Record<VerifyPointId, string>` (was `Record<string, string>` keyed by only 3 of
 * `verify.ts`'s 5 real point ids) so the compiler — not a reviewer — refuses to let this map
 * fall out of sync with `VerifyPointId` again: adding/removing a point id in `verify.ts`
 * forces a matching edit here. This closes the "zero bullets, worse than the pre-P5 generic
 * fallback" gap for `merged`/`mergeShaAncestorOfMaster`, which `checkMerged`/`checkAncestor`
 * (verify.ts) produce for real and which the original P5 implementation had no bullet for at
 * all. `worktreeAndBranchGone` is handled separately in `escalationOptionsSection` (its
 * instruction depends on whether `merged` ALSO failed — see that function's comment) so it is
 * NOT a static string here. */
const VERIFY_FAILURE_BULLETS: Record<Exclude<VerifyPointId, 'worktreeAndBranchGone'>, string> = {
  merged:
    '- merged: the PR is not merged yet. Merge it (or find out what is blocking review/CI) ' +
    'and re-run.',
  mergeShaAncestorOfMaster:
    '- mergeShaAncestorOfMaster: the merge commit is not (yet) an ancestor of the base ' +
    "branch. Wait for it to propagate, or check whether the base branch moved/was rewritten, " +
    'then re-run.',
  checksGreen: '- checksGreen: master/CI is genuinely red — fix master first (own PR), then re-run.',
  schemaGuard:
    '- schemaGuard: the plan file lacks `allowsSchemaChange: true` front-matter, or the ' +
    "card's baseSha is stale. Designed change → land a PR adding the front-matter to the " +
    'plan. Stale base → correct `baseSha` in the campaign state (see P11).',
  gapGateStamped:
    '- gapGateStamped: the merged PR body carries no valid `gap-gate v1` stamp for this card. ' +
    'Run `bun plugins/tribe/scripts/gaps/gap-gate.ts` on the card branch, paste its ' +
    '`<card>-gap-gate.md` into the PR body as the `## Harness gaps` section, and re-run.',
  ledgerCommitted:
    '- ledgerCommitted: the stamp says ids were minted, but the base branch has no ' +
    '`.tribe/harness-gaps.jsonl` carrying them. Commit the gate\'s ledger append on the card ' +
    'branch (trailer `Tribe-Milestone: gap-gate`) so it rides the PR, then re-run.',
};

/** P5 audit fix-round (blocker, skinnerB): `worktreeAndBranchGone`'s bullet used to fire from
 * an unqualified substring match on `detail`, so it printed unconditional "delete it by hand"
 * instructions even when `merged` itself had failed (the branch/worktree are naturally still
 * present because the PR simply hasn't merged yet — deleting them would discard open,
 * un-merged work) and even when `merged` passed but `residue.ts`'s `decideResidueHeal` had
 * already refused to auto-heal because the worktree was dirty or its tip wasn't an ancestor
 * of base (deleting by hand risks the same data loss the auto-heal path was built to avoid).
 * Mirrors `decideResidueHeal`'s own `mergedPassed` gate (residue.ts:46) instead of duplicating
 * a third independent copy of "is this safe" logic. */
function worktreeAndBranchGoneBullet(mergedFailed: boolean): string {
  if (mergedFailed) {
    return (
      '- worktreeAndBranchGone: expected while the PR above is unmerged — a leftover ' +
      'worktree/branch on an unmerged PR is not residue. Merge the PR first (see the `merged` ' +
      'bullet); do not delete anything yet.'
    );
  }
  return (
    '- worktreeAndBranchGone: the runner only auto-deletes this when the worktree is clean ' +
    'and its tip is merged into the base branch (see `residue.ts`). Check for uncommitted or ' +
    'unmerged work FIRST, then delete the leftover remote branch / worktree by hand.'
  );
}

/** P5 audit fix-round (should-fix, scout): reads the typed `VerifyResult.failedPoints` the
 * caller already computed (verify.ts:53-56, documented as existing precisely "to feed the
 * escalation file directly") instead of re-deriving which points failed by substring-matching
 * the flattened `detail` string — the fragility that let the two blocker findings above ship
 * with no type-level guard against it. `failedPoints` is `[]` for every reason other than
 * `verify_failed_twice` (nothing to render from it). */
function escalationOptionsSection(
  reason: string,
  resolved: ResolvedConfig,
  failedPoints: VerifyPointId[],
): string[] {
  if (reason === 'verify_failed_twice') {
    const mergedFailed = failedPoints.includes('merged');
    const bullets = failedPoints.map((id) =>
      id === 'worktreeAndBranchGone' ? worktreeAndBranchGoneBullet(mergedFailed) : VERIFY_FAILURE_BULLETS[id],
    );
    return [
      '## How to unblock (a ruling alone CANNOT clear this)',
      'This is a mechanical verify failure: the runner re-checks the WORLD, not answers.md.',
      'Fix the failing condition, then re-run with `--include-escalated`:',
      ...bullets,
    ];
  }
  // needs_direction / planning_needed (and any other answerable reason): a human judgment is
  // the unblock, so the ruling path leads.
  return [
    '## Options',
    `- Append a ruling to \`${answersPathOf(resolved.homeDir)}\` and re-run with \`--include-escalated\`.`,
    "- If the question is owner-only (see the campaign's ownerOnlyEscalations), park it for " +
      'the owner instead.',
  ];
}

export function buildEscalationMarkdown(
  cardId: string,
  reason: string,
  detail: string,
  resolved: ResolvedConfig,
  failedPoints: VerifyPointId[] = [],
): string {
  return [
    `# Escalation: ${cardId}`,
    '',
    `**Reason:** ${reason}`,
    '',
    '## Context',
    detail,
    '',
    ...escalationOptionsSection(reason, resolved, failedPoints),
    '',
  ].join('\n');
}

export async function escalateCard(
  ctx: CardCtx,
  reason: string,
  detail: string,
  failedPoints: VerifyPointId[] = [],
): Promise<CardOutcome> {
  const { cardId, state, resolved, io } = ctx;
  const escalationPath = escalationPathOf(resolved.homeDir, cardId);
  const markdown = buildEscalationMarkdown(cardId, reason, detail, resolved, failedPoints);
  // D5: the local escalation file + exit code stand alone — write it FIRST, unconditionally.
  io.writeFile(escalationPath, markdown);

  const card = state.cards[cardId];
  if (card) {
    card.status = 'escalated';
    card.updatedAt = io.now();
  }
  persistLocalState(state, resolved, io);

  return { kind: 'escalated', cardId, escalationPath, reason };
}

export async function shipCard(ctx: CardCtx, verifyResult: VerifyResult): Promise<CardOutcome> {
  const { cardId, state, resolved, io } = ctx;
  const card = state.cards[cardId];
  card.status = 'shipped';
  card.mergeSha = extractMergeSha(verifyResult) ?? card.mergeSha;
  // P4 audit fix-round (blocker, skinnerA): persist the heal onto the CARD, since `CardOutcome`
  // (`shipped`) never carries anything beyond `{ kind, cardId }` and report.ts builds its
  // report ENTIRELY from `CampaignState` (Warchief ruling 1) — never from `CardOutcome[]`. This
  // is the only path by which "healed: <kind>" reaches campaign-report.json/.md.
  const healedKinds = extractHealedKinds(verifyResult);
  if (healedKinds.length > 0) {
    card.healedResidue = healedKinds;
  }
  card.updatedAt = io.now();
  persistLocalState(state, resolved, io);

  // P6 (fix-list): a shipped card must never re-park on a leftover escalation file — archive
  // it (never delete: the ruling trail stays inspectable) rather than leave it to short-circuit
  // `deriveCardPhase` on some future flag-less re-trigger (spec: "answered/shipped escalations
  // stop haunting re-triggers").
  const escalationPath = escalationPathOf(resolved.homeDir, cardId);
  if (io.fileExists(escalationPath)) {
    io.renameFile(escalationPath, `${escalationPath}.resolved-shipped`);
  }

  return { kind: 'shipped', cardId };
}

export function toBriefCard(cardId: string, card: Card): BriefCard {
  return { id: cardId, spec: card.spec, plan: card.plan };
}

export function toBriefState(state: CampaignState): BriefState {
  return {
    campaign: state.campaign,
    mergePolicy: state.mergePolicy,
    ownerOnlyEscalations: state.ownerOnlyEscalations,
  };
}

export const CONTINUE_PR_OPEN_PROMPT =
  "Resume this card: check the open PR's CI status and complete the merge sequence if green, " +
  'then report the terminal SHIPPED/NEEDS_DIRECTION line.';
export const CONTINUE_BRANCH_PROMPT =
  'Resume this card from your existing branch/worktree: continue implementing the plan, then ' +
  'report the terminal SHIPPED/NEEDS_DIRECTION line.';
// P1 audit fix-round (blocker, skinnerB): the `session_only` resume reason — no branch or PR
// was ever recorded locally, so (unlike CONTINUE_PR_OPEN_PROMPT/CONTINUE_BRANCH_PROMPT) this
// prompt cannot assume either exists; it tells the resumed session to check for itself before
// assuming a clean slate.
export const CONTINUE_UNKNOWN_STATE_PROMPT =
  'Resume this card: no branch or PR was ever recorded for it locally (the previous attempt ' +
  'ended its turn before reporting one), so first check what you already did — `git status`, ' +
  '`git branch`, `gh pr list --head <branch>` — before continuing; do not assume a clean ' +
  'slate. Then continue implementing the plan and report the terminal SHIPPED/NEEDS_DIRECTION ' +
  'line.';

export function buildSessionIOForCard(ctx: CardCtx): SessionIO {
  const { cardId, state, resolved, io } = ctx;
  const card = state.cards[cardId];
  return {
    spawnSession: (params) => io.spawnSession(params),
    appendLog: (path, line) => io.appendLog(path, line),
    onSessionStart: (sessionId) => {
      // Crash-safe: written the instant the SDK assigns the id, before anything else (§D1/§D4).
      card.sessionId = sessionId;
      card.status = 'running';
      card.updatedAt = io.now();
      persistLocalState(state, resolved, io);
    },
    // P2 fix-list card: the pre-merge check gate's exec seam — reuses LoopIO's own `exec`,
    // scoped to this card's repo root.
    execInRepo: (argv) => io.exec(argv, { cwd: resolved.repoRoot }),
  };
}

export function sessionConfigFor(cardId: string, resolved: ResolvedConfig): RunSessionConfig {
  return {
    repoRoot: resolved.repoRoot,
    model: resolved.model,
    sessionTimeoutMs: resolved.sessionTimeoutMs,
    logsDir: resolved.logsDir,
    card: cardId,
  };
}

/** REVERT_AND_REDO: delete the stale worktree + branch (local and remote) so a fresh session
 * starts from a clean slate — the doctrine B5's executor proved (spec §D4). Serialized against
 * every other card's own worktree/branch mutation (`serializeRepoGitMutation`, above this
 * file's `gatherWorktreeResidueFacts`) — see that helper's doc comment. */
export function performRevertAndRedo(ctx: CardCtx): Promise<void> {
  return serializeRepoGitMutation(() => performRevertAndRedoImpl(ctx));
}

async function performRevertAndRedoImpl(ctx: CardCtx): Promise<void> {
  const { cardId, state, resolved, io } = ctx;
  const card = state.cards[cardId];
  const branch = card.branch;
  if (!branch) return;

  const worktreeList = await io.exec(['git', 'worktree', 'list', '--porcelain'], {
    cwd: resolved.repoRoot,
  });
  const worktreePath = findWorktreePathForBranch(worktreeList.stdout, branch);
  if (worktreePath) {
    await io.exec(['git', 'worktree', 'remove', '--force', worktreePath], { cwd: resolved.repoRoot });
  }
  await io.exec(['git', 'branch', '-D', branch], { cwd: resolved.repoRoot });

  const remote = await io.exec(['git', 'ls-remote', '--heads', resolved.remote, branch], {
    cwd: resolved.repoRoot,
  });
  if (remote.stdout.trim().length > 0) {
    await io.exec(['git', 'push', resolved.remote, '--delete', branch], { cwd: resolved.repoRoot });
  }
}

/** Runs the executor session for one card's phase, implementing the D4 resume-with-fallback:
 * a `resume` phase attempts `runSession({resume: sessionId})` — with the prompt selected by
 * `phase.reason` (`pr_open` / `branch_no_pr` / the P1-fix-round `session_only`, for a card with
 * no recorded branch/PR but a recorded sessionId) — and if (and only if) that surfaces a typed
 * `error` outcome (a failed resume attempt: no transcript, SDK error — never on `timeout`,
 * which means the prior session may still be running), it falls back to a fresh session
 * carrying a state digest. `revert_and_redo` and a blind `fresh` (no digest) just spawn fresh
 * with the plain brief; a `fresh` phase carrying a digest (F8: open PR, no sessionId) spawns
 * fresh too, but with that digest prepended — never blind. */
export async function runCardSession(ctx: CardCtx, phase: CardPhase): Promise<SessionResult> {
  const { cardId, state, resolved } = ctx;
  const card = state.cards[cardId];
  const sessionConfig = sessionConfigFor(cardId, resolved);

  if (phase.kind === 'resume') {
    const prompt =
      phase.reason === 'pr_open'
        ? CONTINUE_PR_OPEN_PROMPT
        : phase.reason === 'session_only'
          ? CONTINUE_UNKNOWN_STATE_PROMPT
          : CONTINUE_BRANCH_PROMPT;
    const resumeIO = buildSessionIOForCard(ctx);
    const resumeResult = await runSession(
      { brief: prompt, resume: phase.sessionId },
      sessionConfig,
      resumeIO,
    );
    if (resumeResult.outcome !== 'error') {
      return resumeResult;
    }

    const digest = buildStateDigest(cardId, card, resumeResult.finalText);
    const brief = executorBrief(
      toBriefCard(cardId, card),
      toBriefState(state),
      `${digest}\n\n---\n\n${resolved.answersContent}`,
      resolved.briefTemplate,
      reportPathFor(resolved.homeDir, cardId),
      ctx.state.campaign,
    );
    const freshIO = buildSessionIOForCard(ctx);
    return runSession({ brief }, sessionConfig, freshIO);
  }

  // F8: a `fresh` phase carrying a digest (open PR, no sessionId — see `deriveCardPhase`) must
  // not spawn blind either; compose it the same way the resume-failure fallback above does.
  const answersContent =
    phase.kind === 'fresh' && phase.digest
      ? `${phase.digest}\n\n---\n\n${resolved.answersContent}`
      : resolved.answersContent;
  const brief = executorBrief(
    toBriefCard(cardId, card),
    toBriefState(state),
    answersContent,
    resolved.briefTemplate,
    reportPathFor(resolved.homeDir, cardId),
    ctx.state.campaign,
  );
  const freshIO = buildSessionIOForCard(ctx);
  return runSession({ brief }, sessionConfig, freshIO);
}

/** Records the commit the card's work is being cut from, BEFORE its session spawns — the
 * schemaGuard check diffs `baseSha..<remote>/<baseBranch>`, so a card that never recorded one
 * can never be verified. Crash-safe (persisted immediately).
 *
 * P11 fix-list (ruling R3: a stale base is worse than no base): idempotent for every
 * resume-class phase (`resume`, and `fresh` carrying an F8 digest) — those genuinely started
 * from the base they already recorded, so it is kept unchanged, exactly as before. A BLIND
 * fresh (`phase.kind === 'fresh'` with no digest — no session, no PR, no worktree trace at
 * all: no prior world exists for this card) is the one case that now RE-STAMPS any
 * pre-existing `baseSha`: by construction such a card can only be carrying a stale or
 * hand-authored base (the B13 incident's exact shape — a card hand-reset to `staged` that
 * kept its old campaign-start `baseSha`, which then diffed schemaGuard from before a designed
 * change and tripped a false positive). See also `state.ts`'s `loadState`, which normalizes
 * the same invariant from the other direction (a hand-edited `staged`+`sessionId: null` card
 * caught at load time, before it ever reaches this function). */
export async function recordBaseSha(ctx: CardCtx, phase: CardPhase): Promise<void> {
  const { cardId, state, resolved, io } = ctx;
  const card = state.cards[cardId];
  const blindFresh = phase.kind === 'fresh' && !phase.digest;
  if (card.baseSha && !blindFresh) return;

  const result = await io.exec(['git', 'rev-parse', `${resolved.remote}/${resolved.baseBranch}`], {
    cwd: resolved.repoRoot,
  });
  const sha = result.stdout.trim();
  if (result.exitCode !== 0 || sha.length === 0) return;

  card.baseSha = sha;
  card.updatedAt = io.now();
  persistLocalState(state, resolved, io);
}

/** Records the card's branch by asking its PR what it was — the only authority on the name,
 * since the executor session picks the branch itself and never reports it back.
 *
 * Without this, `verifyShipped`'s worktreeAndBranchGone check has nothing to check and the
 * card escalates `verify_failed_twice` even though its PR merged cleanly (observed for real on
 * campaign least-effort-5's C1, PR #144). Best-effort by design: a failed lookup leaves
 * `branch` null exactly as before, so this can only ever add information, never break a card
 * that would otherwise have shipped. */
export async function recordBranchFromPr(ctx: CardCtx): Promise<void> {
  const { cardId, state, resolved, io } = ctx;
  const card = state.cards[cardId];
  if (card.branch || card.pr == null) return;

  const result = await io.exec(['gh', 'pr', 'view', String(card.pr), '--json', 'headRefName'], {
    cwd: resolved.repoRoot,
  });
  if (result.exitCode !== 0) return;

  let headRefName: unknown;
  try {
    headRefName = (JSON.parse(result.stdout) as { headRefName?: unknown }).headRefName;
  } catch {
    return;
  }
  if (typeof headRefName !== 'string' || headRefName.length === 0) return;

  card.branch = headRefName;
  card.updatedAt = io.now();
  persistLocalState(state, resolved, io);
}

export async function actOnCard(ctx: CardCtx, phase: CardPhase): Promise<CardOutcome> {
  const { cardId, state, resolved, io } = ctx;
  const card = state.cards[cardId];

  if (phase.kind === 'verify_only') {
    card.pr = phase.pr;
    await recordBranchFromPr(ctx);
    const verifyConfig: VerifyConfig = {
      repoRoot: resolved.repoRoot,
      remote: resolved.remote,
      baseBranch: resolved.baseBranch,
      schemaLockPaths: state.schemaLockPaths,
      docsOnlyPaths: state.docsOnlyPaths,
    };
    const result = await verifyThenHealIfNeeded(ctx, verifyConfig);
    if (result.shipped) {
      return shipCard(ctx, result);
    }
    return escalateCard(ctx, 'verify_failed_twice', formatVerifyFailure(result), result.failedPoints);
  }

  if (phase.kind === 'revert_and_redo') {
    await performRevertAndRedo(ctx);
  }

  await recordBaseSha(ctx, phase);
  const sessionResult = await runCardSession(ctx, phase);

  if (sessionResult.outcome === 'shipped') {
    card.pr = sessionResult.pr ?? card.pr;
    await recordBranchFromPr(ctx);
    const verifyConfig: VerifyConfig = {
      repoRoot: resolved.repoRoot,
      remote: resolved.remote,
      baseBranch: resolved.baseBranch,
      schemaLockPaths: state.schemaLockPaths,
      docsOnlyPaths: state.docsOnlyPaths,
    };
    const result = await verifyThenHealIfNeeded(ctx, verifyConfig);
    if (result.shipped) {
      return shipCard(ctx, result);
    }
    return escalateCard(ctx, 'verify_failed_twice', formatVerifyFailure(result), result.failedPoints);
  }

  if (sessionResult.outcome === 'needs_direction') {
    return escalateCard(ctx, 'needs_direction', sessionResult.finalText);
  }

  // 'error' or 'timeout' with no further D4 fallback available (a fresh/revert_and_redo
  // session, or a resume's own fresh-with-digest fallback, itself errored/timed out): not a
  // human-decision escalation — the card's branch/sessionId are already recorded locally
  // (write locality), so simply stop this run; the next start's D4 derivation resumes it.
  return {
    kind: 'stopped',
    cardId,
    reason: `session ended with outcome "${sessionResult.outcome}": ${sessionResult.finalText}`,
    retryable: sessionResult.outcome === 'error',
  };
}
