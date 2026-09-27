// Per-card work: escalate/ship a card, drive its plan through the turn loop (`turns.ts`, with
// the D4 resume-with-fallback matrix on the first turn), and REVERT_AND_REDO. Every world-touching effect goes through the
// injected `LoopIO`/`SessionIO` seams — this module never imports a world-touching module
// itself.
import type { Card, CampaignState, ResolvedConfig } from '../types.ts';
import type { LoopIO } from '../../ports/ports.ts';
import { LOCAL_GIT_QUERY_TIMEOUT_MS, REMOTE_OR_HOOK_GIT_TIMEOUT_MS, verifyShipped } from '../verify.ts';
import type { VerifyConfig, VerifyPointId, VerifyResult } from '../verify.ts';
import { runSession } from '../session.ts';
import type { RunSessionConfig, SessionIO, SessionResult } from '../session.ts';
import { executorBrief } from '../brief.ts';
import type { BriefCard, BriefState } from '../brief.ts';
import type { CardPhase } from './phase.ts';
import { buildStateDigest, findWorktreePathForBranch } from './phase.ts';
import { persistLocalState } from './commit-guard.ts';
import { answersPathOf, doneWorktreePathOf, escalationPathOf, supervisorLedgerPathOf } from '../paths.ts';
import { doneRecordPathOf } from '../run-record.ts';
import { applyPass, doneRows, judgeDoneRun, tailOf, type DoneCommandResult, type DoneRunVerdict } from '../done.ts';
import type { PlannedCommand } from '../plan-index.ts';
import { driveCardTurns, type TurnDeps } from './turns.ts';
import { decideBaseSyncHeal, decideResidueHeal, type HealAction } from '../residue.ts';
import { WORKTREE_STILL_PRESENT_DETAIL } from '../verify.ts';
import { sessionUrlFor } from '../viewer-launch.ts';

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
// `serializeRepoGitMutation` queues exactly these three functions (plus the D4 base
// fast-forward, `fastForwardBaseIfSafe`, which moves `--repo`'s checked-out branch) relative to EACH OTHER,
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

/** D4 safe heal (card runner-driver-only, spec §4.7): a session that merged but did not
 * fast-forward the runner's own base checkout should not cost an escalation. Fast-forwards
 * `--repo`'s base branch only when `decideBaseSyncHeal` proves it can lose nothing; returns
 * whether the fast-forward actually succeeded. Probes and merge run as one serialized step so
 * another card's git mutation cannot change the checkout between the proof and the merge. */
function fastForwardBaseIfSafe(ctx: CardCtx, firstResult: VerifyResult): Promise<boolean> {
  const mergedPassed = firstResult.points.find((p) => p.id === 'merged')?.passed === true;
  const localBaseFailed = firstResult.points.find((p) => p.id === 'localBaseSynced')?.passed === false;
  if (!mergedPassed || !localBaseFailed) return Promise.resolve(false);
  return serializeRepoGitMutation(async () => {
    const { resolved, io } = ctx;
    const queryInRepo = { cwd: resolved.repoRoot, timeoutMs: LOCAL_GIT_QUERY_TIMEOUT_MS };
    const mergeInRepo = { cwd: resolved.repoRoot, timeoutMs: REMOTE_OR_HOOK_GIT_TIMEOUT_MS };
    const remoteBase = `${resolved.remote}/${resolved.baseBranch}`;
    // Every fact requires exit 0: a failed probe presents as empty stdout and must never read
    // as "on base" or "clean".
    const head = await io.exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], queryInRepo);
    const status = await io.exec(['git', 'status', '--porcelain'], queryInRepo);
    const ancestor = await io.exec(['git', 'merge-base', '--is-ancestor', resolved.baseBranch, remoteBase], queryInRepo);
    const actions = decideBaseSyncHeal({
      mergedPassed,
      localBaseFailed,
      checkoutOnBase: head.exitCode === 0 && head.stdout.trim() === resolved.baseBranch,
      checkoutClean: status.exitCode === 0 && status.stdout.trim().length === 0,
      localIsAncestorOfRemote: ancestor.exitCode === 0,
    });
    if (actions.length === 0) return false;
    const merged = await io.exec(['git', 'merge', '--ff-only', remoteBase], mergeInRepo);
    return merged.exitCode === 0;
  });
}

/** Appends `(healed: fast_forward_base)` to the `localBaseSynced` point's detail — the
 * `appendHealedDetail` idiom for the D4 point. A no-op when nothing was healed. */
function appendBaseSyncHealedDetail(result: VerifyResult, healed: boolean): VerifyResult {
  if (!healed) return result;
  return {
    ...result,
    points: result.points.map((p) =>
      p.id === 'localBaseSynced' ? { ...p, detail: `${p.detail} (healed: fast_forward_base)` } : p,
    ),
  };
}

/** The P4 fix-list wiring: between a first FAILED verify and the retry, heal whatever
 * residue `decideResidueHeal` proves safe (spec: only when the `merged` point PASSED and
 * `worktreeAndBranchGone` is the failing point) and the D4 base fast-forward
 * `fastForwardBaseIfSafe` proves safe, then re-verify. This is the ONE helper used
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
  const baseFastForwarded = await fastForwardBaseIfSafe(ctx, firstResult);

  const retry = await verifyShipped(card, verifyConfig, io, cardId);
  return appendBaseSyncHealedDetail(appendHealedDetail(retry, healedActions), baseFastForwarded);
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
  localBaseSynced:
    "- localBaseSynced: the local base branch in the runner's checkout does not have this merge yet " +
    '(or has diverged). Fast-forward it (git merge --ff-only <remote>/<base>) with a clean checkout, ' +
    'then re-run.',
  doneAtHead:
    '- doneAtHead: the PR merged a commit the runner never ran the Done commands on. Revert or verify by hand, re-run the Done commands, and record a ruling before re-running.',
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
  if (reason === 'done_failed') {
    return [
      '## Options',
      `- The work is not done yet: a ruling that clarifies the task helps the next attempt — append it to \`${answersPathOf(resolved.homeDir)}\` and re-run with \`--include-escalated\`.`,
      '- A Done command in the plan is wrong: fix the plan on the base branch through a PR, then re-run with `--include-escalated`.',
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
  return { id: cardId, spec: card.spec, plan: card.plan, tasks: card.tasks };
}

export function toBriefState(state: CampaignState): BriefState {
  return {
    campaign: state.campaign,
    mergePolicy: state.mergePolicy,
    ownerOnlyEscalations: state.ownerOnlyEscalations,
  };
}

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
      // Task 27 (spec §10.2 line 2): printed the instant the SDK assigns a session id — this
      // callback already runs at exactly that moment. `viewerBaseUrl` is null under
      // --no-viewer/--dry-run/a missing entry/a stale port (cli/main.ts's `announceViewer`),
      // so this stays silent rather than print a URL nothing can serve.
      if (resolved.viewerBaseUrl != null) {
        io.printLine(`card ${cardId}: ${sessionUrlFor(resolved.viewerBaseUrl, sessionId)}`);
      }
    },
    // P2 fix-list card: the pre-merge check gate's exec seam — reuses LoopIO's own `exec`,
    // scoped to this card's repo root; both gh calls it makes reach the network, so bounded.
    execInRepo: (argv) => io.exec(argv, { cwd: resolved.repoRoot, timeoutMs: REMOTE_OR_HOOK_GIT_TIMEOUT_MS }),
    // Read at hook time: recordPass moves card.doneSha as later Done runs pass.
    currentDoneSha: () => card.doneSha ?? null,
  };
}

export function sessionConfigFor(cardId: string, resolved: ResolvedConfig): RunSessionConfig {
  return {
    repoRoot: resolved.repoRoot,
    model: resolved.model,
    sessionTimeoutMs: resolved.sessionTimeoutMs,
    logsDir: resolved.logsDir,
    card: cardId,
    // Written whether or not a supervisor ever runs — a watchdog-only campaign gets the
    // session tree too (spec §4.4, D4).
    ledgerPath: supervisorLedgerPathOf(resolved.homeDir),
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

/** Every effect `driveCardTurns` needs, bound to this card. The first turn implements the D4
 * resume-with-fallback: a `resume` phase resumes the recorded session with the turn prompt, and
 * only a typed `error` (a failed resume: no transcript, SDK error — never `timeout`, which means
 * the prior session may still be running) falls back to a fresh session carrying a state digest.
 * A fresh or revert_and_redo first turn spawns fresh; a `fresh` phase carrying a digest (F8: an
 * open PR, no sessionId) prepends that digest — never blind. Later turns resume the session. */
function turnDepsFor(ctx: CardCtx, phase: CardPhase): TurnDeps {
  const { cardId, state, resolved, io } = ctx;
  const sessionConfig = sessionConfigFor(cardId, resolved);
  const freshBrief = (answersContent: string, prompt: string): string =>
    `${executorBrief(toBriefCard(cardId, state.cards[cardId]), toBriefState(state), answersContent, resolved.briefTemplate, resolved.homeDir, state.campaign,
      { repoRoot: resolved.repoRoot, baseBranch: resolved.baseBranch, remote: resolved.remote })}\n\n${prompt}`;
  const inRepo = { cwd: resolved.repoRoot, timeoutMs: LOCAL_GIT_QUERY_TIMEOUT_MS };

  return {
    async runTurn(prompt, first) {
      if (!first) {
        return runSession({ brief: prompt, resume: state.cards[cardId].sessionId ?? undefined }, sessionConfig, buildSessionIOForCard(ctx));
      }
      if (phase.kind === 'resume') {
        const resumed = await runSession({ brief: prompt, resume: phase.sessionId }, sessionConfig, buildSessionIOForCard(ctx));
        if (resumed.outcome !== 'error') return resumed;
        const digest = buildStateDigest(cardId, state.cards[cardId], resumed.finalText);
        return runSession({ brief: freshBrief(`${digest}\n\n---\n\n${resolved.answersContent}`, prompt) }, sessionConfig, buildSessionIOForCard(ctx));
      }
      const answersContent =
        phase.kind === 'fresh' && phase.digest ? `${phase.digest}\n\n---\n\n${resolved.answersContent}` : resolved.answersContent;
      return runSession({ brief: freshBrief(answersContent, prompt) }, sessionConfig, buildSessionIOForCard(ctx));
    },

    async acceptTaskDone(branch) {
      // The branch name reaches git argv: refuse anything git could read as an option or a second word.
      if (branch === '' || /\s/.test(branch) || branch.startsWith('-')) {
        return { ok: false, reason: `"${branch}" is not a branch name` };
      }
      const tipResult = await io.exec(['git', 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], inRepo);
      const tip = tipResult.stdout.trim();
      if (tipResult.exitCode !== 0 || tip.length === 0) return { ok: false, reason: `branch ${branch} does not exist in the repo` };
      const card = state.cards[cardId];
      if (card.branch !== null && card.branch !== branch) return { ok: false, reason: `the card's branch is ${card.branch}` };
      if (card.baseSha === null) return { ok: false, reason: 'no base commit recorded' };
      const descends = await io.exec(['git', 'merge-base', '--is-ancestor', card.baseSha, tip], inRepo);
      if (descends.exitCode !== 0) return { ok: false, reason: `tip ${tip} does not descend from the card's base ${card.baseSha}` };
      return { ok: true, tip };
    },

    async runDone(planned, sha, stepTaskId, attempt) {
      let path: string;
      try {
        path = doneWorktreePathOf(resolved.homeDir, cardId);
      } catch (err) {
        // The containment guard refused this card id: nothing is created or deleted.
        return { kind: 'infrastructure', reason: (err as Error).message };
      }
      const added = await serializeRepoGitMutation(async () => {
        await io.exec(['git', 'worktree', 'remove', '--force', path], inRepo); // absent is fine
        if (io.fileExists(path)) io.removeTree(path);
        await io.exec(['git', 'worktree', 'prune'], inRepo);
        return io.exec(['git', 'worktree', 'add', '--detach', '--force', path, sha], { cwd: resolved.repoRoot, timeoutMs: REMOTE_OR_HOOK_GIT_TIMEOUT_MS });
      });
      if (added.exitCode !== 0) {
        return { kind: 'infrastructure', reason: `git worktree add ${path} ${sha} failed: ${added.stderr.trim()}` };
      }

      const card = state.cards[cardId];
      const env = {
        RUNNER_CAMPAIGN_HOME: resolved.homeDir, RUNNER_CARD_ID: cardId, RUNNER_TASK_ID: stepTaskId,
        RUNNER_BASE_SHA: card.baseSha ?? '', RUNNER_REPO: resolved.repoRoot,
      };
      const results: DoneCommandResult[] = [];
      let verdict: DoneRunVerdict;
      try {
        for (const { command } of planned) {
          const run = await io.runShell(command, { cwd: path, env, timeoutMs: DONE_COMMAND_TIMEOUT_MS });
          results.push({
            command, exitCode: run.exitCode, timedOut: run.timedOut, durationMs: run.durationMs,
            stdoutTail: tailOf(run.stdout), stderrTail: tailOf(run.stderr),
          });
          if (run.exitCode !== 0 || run.timedOut) break;
        }
        verdict = judgeDoneRun(planned, results);
        const recordPath = doneRecordPathOf(resolved.homeDir, resolved.runId);
        for (const row of doneRows({ at: io.now(), cardId, stepTask: stepTaskId, attempt, sha, planned, results, verdict })) {
          io.appendLog(recordPath, JSON.stringify(row));
        }
      } finally {
        await serializeRepoGitMutation(() => io.exec(['git', 'worktree', 'remove', '--force', path], inRepo));
      }
      return { kind: 'verdict', verdict };
    },

    recordPass(throughIndex, sha, branch) {
      const card = state.cards[cardId];
      const passed = applyPass(card.tasks, throughIndex, sha);
      card.tasks = passed.tasks;
      if (passed.doneSha !== null) card.doneSha = passed.doneSha;
      else delete card.doneSha;
      card.branch ??= branch;
      card.updatedAt = io.now();
      persistLocalState(state, resolved, io);
    },

    async finishShipped(result) {
      const card = state.cards[cardId];
      card.pr = result.pr ?? card.pr;
      await recordBranchFromPr(ctx);
      const verified = await verifyThenHealIfNeeded(ctx, verifyConfigOf(ctx));
      if (verified.shipped) return shipCard(ctx, verified);
      return escalateCard(ctx, 'verify_failed_twice', formatVerifyFailure(verified), verified.failedPoints);
    },

    escalate: (reason, detail) => escalateCard(ctx, reason, detail),
  };
}

/** One Done command's wall-clock bound (spec §4.5): a hung command costs the attempt, not the run. */
const DONE_COMMAND_TIMEOUT_MS = 600_000;

function verifyConfigOf(ctx: CardCtx): VerifyConfig {
  const { state, resolved } = ctx;
  return {
    repoRoot: resolved.repoRoot,
    remote: resolved.remote,
    baseBranch: resolved.baseBranch,
    schemaLockPaths: state.schemaLockPaths,
    docsOnlyPaths: state.docsOnlyPaths,
  };
}

/** REVERT_AND_REDO starts the card over, so the recorded Done progress goes with the branch. */
function clearProgress(ctx: CardCtx): void {
  const { cardId, state, resolved, io } = ctx;
  const card = state.cards[cardId];
  card.tasks = card.tasks.map(({ passedSha: _cleared, ...task }) => task);
  delete card.doneSha;
  card.updatedAt = io.now();
  persistLocalState(state, resolved, io);
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
  const { cardId, state, resolved } = ctx;
  const card = state.cards[cardId];

  if (phase.kind === 'verify_only') {
    card.pr = phase.pr;
    await recordBranchFromPr(ctx);
    const result = await verifyThenHealIfNeeded(ctx, verifyConfigOf(ctx));
    if (result.shipped) {
      return shipCard(ctx, result);
    }
    return escalateCard(ctx, 'verify_failed_twice', formatVerifyFailure(result), result.failedPoints);
  }

  // A card whose plan was missing at load has no task index and never gets here (`nextCard`
  // escalates `planning_needed` first); defended anyway, before anything destructive runs.
  const tasks = resolved.taskIndex[cardId] ?? [];
  if (tasks.length === 0) {
    return escalateCard(ctx, 'planning_needed', 'no resolved task index for this card');
  }

  if (phase.kind === 'revert_and_redo') {
    await performRevertAndRedo(ctx);
    clearProgress(ctx);
  }

  await recordBaseSha(ctx, phase);
  return driveCardTurns(
    {
      cardId,
      card,
      tasks,
      planPath: card.plan ?? '(missing)',
      delivery: { baseBranch: resolved.baseBranch, remote: resolved.remote, repoRoot: resolved.repoRoot },
    },
    turnDepsFor(ctx, phase),
  );
}
