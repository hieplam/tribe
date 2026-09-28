// §D4 — the resume matrix, derived from reality, never from the state file.
import type { Card, RunLoopConfig } from '../types.ts';
import type { DerivePhaseIO } from '../../ports/ports.ts';
import { escalationPathOf } from '../paths.ts';
import { progressDigestLines } from '../turn-prompts.ts';

/** The five §D4 outcomes, plus the escalation-file short-circuit. `deriveCardPhase` never
 * itself attempts a resume or spawns anything — it only classifies reality; the loop's own
 * "act" step does the attempting (so a resume-probe failure can fall back to fresh, per the
 * spec note "resumability is probed by attempting the resume ... there is no session-listing
 * API — never list"). */
export type CardPhase =
  | { kind: 'verify_only'; pr: number }
  // P1 audit fix-round (blocker, skinnerB): `'session_only'` covers a `card.branch === null`
  // card that DOES carry a recorded `sessionId` — the exact incident shape (a session opened
  // a PR/branch, then ended its turn with no terminal line before `card.pr`/`card.branch`
  // were ever written back). Never carries `pr`: we have no PR number to attach, only a
  // session to resume.
  | { kind: 'resume'; sessionId: string; reason: 'pr_open' | 'branch_no_pr' | 'session_only'; pr?: number }
  | { kind: 'revert_and_redo' }
  // F8: `digest` is present exactly when there IS a trace worth telling the executor about
  // (an open PR with no recorded sessionId) but nothing is resumable — the genuine
  // "no trace at all, no sessionId either" case (see `card.branch === null` below) leaves it
  // undefined, so a fresh session there stays a plain blind fresh, unchanged.
  | { kind: 'fresh'; digest?: string }
  | { kind: 'escalation_pending'; escalationPath: string };

export interface DerivePhaseConfig {
  /** Target repo root; cwd for every gh/git call (an input, per spec §2). */
  repoRoot: string;
  /** `--home` — the escalation file for a card lives at `escalationPathOf(homeDir, cardId)`
   * (Task 3, spec §4). */
  homeDir: string;
  /** `--include-escalated`: bypasses the escalation-file short-circuit — the human has
   * already ruled and is deliberately forcing a retry of a previously escalated card. */
  includeEscalated: boolean;
  /** The git remote to query for branch existence (`RunLoopConfig.remote`) — never hardcode
   * `'origin'` here. */
  remote: string;
}

interface PrLookup {
  kind: 'found' | 'not_found';
  number?: number;
  state?: string;
}

/** `gh pr view <branch> --json number,state` (verified against the real CLI: exit 0 + JSON
 * when a PR exists for the branch; exit 1 + a stderr message, empty stdout, when none does —
 * see the task-6 report's transcript). A non-zero exit (including a genuine gh/network
 * failure) is folded into `not_found` — the safe direction for this capability's v1 scope,
 * matching verify.ts's own precedent of folding a rejected/failed call into a reportable
 * "did not find what we were checking for" outcome rather than throwing. */
async function queryPrForBranch(
  branch: string,
  repoRoot: string,
  io: DerivePhaseIO,
): Promise<PrLookup> {
  const result = await io.exec(['gh', 'pr', 'view', branch, '--json', 'number,state'], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    return { kind: 'not_found' };
  }
  try {
    const parsed = JSON.parse(result.stdout) as { number?: unknown; state?: unknown };
    return {
      kind: 'found',
      number: typeof parsed.number === 'number' ? parsed.number : undefined,
      state: typeof parsed.state === 'string' ? parsed.state : undefined,
    };
  } catch {
    return { kind: 'not_found' };
  }
}

/** Reused, verified real commands (`git worktree list --porcelain`, `git ls-remote --heads`)
 * — same detection verify.ts's own `checkWorktreeAndBranchGone` uses, duplicated locally
 * (verify.ts's helper is not exported and this module must not rewrite verify.ts's logic). */
async function branchOrWorktreeExists(
  branch: string,
  config: DerivePhaseConfig,
  io: DerivePhaseIO,
): Promise<boolean> {
  const worktreeResult = await io.exec(['git', 'worktree', 'list', '--porcelain'], {
    cwd: config.repoRoot,
  });
  const worktreeExists = worktreeResult.stdout
    .split('\n')
    .some((line) => line.trim() === `branch refs/heads/${branch}`);

  const remoteResult = await io.exec(['git', 'ls-remote', '--heads', config.remote, branch], {
    cwd: config.repoRoot,
  });
  const remoteExists = remoteResult.stdout.trim().length > 0;

  return worktreeExists || remoteExists;
}

/** Finds the worktree path for `branch` from `git worktree list --porcelain` output — used by
 * REVERT_AND_REDO to know what to `git worktree remove`. Porcelain output is a blank-line
 * separated sequence of blocks, each starting `worktree <path>`. */
export function findWorktreePathForBranch(porcelain: string, branch: string): string | null {
  const blocks = porcelain.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const worktreeLine = lines.find((l) => l.startsWith('worktree '));
    const hasBranch = lines.some((l) => l.trim() === `branch refs/heads/${branch}`);
    if (worktreeLine && hasBranch) {
      return worktreeLine.slice('worktree '.length).trim();
    }
  }
  return null;
}

/** Built ONLY for the D4 "resume attempt failed" fallback: a fresh session has no prior
 * context, so it needs a digest of what's known instead of starting blind. Composed into the
 * existing `executorBrief(card, state, answersContent)` API's `answersContent` param — never
 * a rewrite of brief.ts. Exported: used here by F8 (an open PR with no recorded sessionId) and
 * by `core/loop/card-actions.ts`'s resume-failure fallback. */
export function buildStateDigest(cardId: string, card: Card, resumeFailureReason: string): string {
  return [
    `## Crash-recovery digest for ${cardId}`,
    `A previous session (session id: ${card.sessionId ?? '(unknown)'}) could not be resumed:`,
    `> ${resumeFailureReason}`,
    '',
    'Known state before this fresh session started:',
    `- status: ${card.status}`,
    `- branch: ${card.branch ?? '(none recorded)'}`,
    `- pr: ${card.pr ?? '(none recorded)'}`,
    `- baseSha: ${card.baseSha ?? '(none recorded)'}`,
    '',
    ...progressDigestLines({ tasks: card.tasks, branch: card.branch, doneSha: card.doneSha }),
    '',
    `Inspect the branch/worktree/PR state for ${cardId} before starting fresh work — do not ` +
      'assume a clean slate.',
  ].join('\n');
}

/** The §D4 reality table, implemented exactly: escalation file (unless `--include-escalated`)
 * short-circuits everything; otherwise PR state (merged/open/absent) plus branch/worktree
 * presence plus a recorded `sessionId` determine the phase. Never trusts `card.status` — every
 * branch here is driven by a gh/git query or an fs check, per the design's iron rule ("the
 * file is data, gh/git is authority"). */
export async function deriveCardPhase(
  cardId: string,
  card: Card,
  config: DerivePhaseConfig,
  io: DerivePhaseIO,
): Promise<CardPhase> {
  if (!config.includeEscalated) {
    const escalationPath = escalationPathOf(config.homeDir, cardId);
    if (io.fileExists(escalationPath)) {
      return { kind: 'escalation_pending', escalationPath };
    }
  }

  if (!card.branch) {
    // P1 audit fix-round (blocker, skinnerB): a session that opened a PR/branch and then
    // errored before its outcome ever reached `'shipped'` (session.ts's `parseResultMessage`
    // never populates `pr` on an `'error'` outcome, so `card-actions.ts`'s
    // `recordBranchFromPr` — gated on `card.pr` — never ran) leaves `card.branch`/`card.pr`
    // null even though `onSessionStart` DID record `card.sessionId` the instant the SDK
    // assigned it. That is the P1 incident's own shape ("opens its PR ... then ends its
    // turn"). A blind `{ kind: 'fresh' }` here would spawn a second, ignorant session on top
    // of that possibly-still-open PR — exactly the duplicate-PR hazard F8 (below) exists to
    // prevent for the branch-known case. We cannot query gh for a branch we were never told,
    // but we CAN resume the one thing that does know what happened: the prior SDK session
    // itself, by its recorded id.
    if (card.sessionId) {
      return { kind: 'resume', sessionId: card.sessionId, reason: 'session_only' };
    }
    return { kind: 'fresh' };
  }

  const pr = await queryPrForBranch(card.branch, config.repoRoot, io);

  if (pr.kind === 'found' && pr.state === 'MERGED' && pr.number !== undefined) {
    return { kind: 'verify_only', pr: pr.number };
  }

  if (pr.kind === 'found' && pr.state === 'OPEN') {
    if (card.sessionId) {
      return { kind: 'resume', sessionId: card.sessionId, reason: 'pr_open', pr: pr.number };
    }
    // F8: an open PR with no recorded sessionId has nothing to resume — but there IS a trace
    // (an open PR on GitHub), so this is NOT "same as no trace". A blind `{ kind: 'fresh' }`
    // here spawns an executor with no idea the PR exists; it rebuilds the card and opens a
    // SECOND PR (violates acceptance #3: no duplicate PRs on resume). Reuse the same
    // `buildStateDigest` the resume-failure fallback already uses, so the fresh session is
    // told the PR number and instructed to continue it, not duplicate it.
    const reason =
      pr.number !== undefined
        ? `no sessionId was ever recorded for this card, but PR #${pr.number} is already OPEN ` +
          `on GitHub for branch "${card.branch}" — do not open a second PR; inspect and ` +
          'continue the existing one.'
        : `no sessionId was ever recorded for this card, and an OPEN PR was found for branch ` +
          `"${card.branch}" (its number could not be read) — do not open a second PR; inspect ` +
          'and continue the existing one.';
    return { kind: 'fresh', digest: buildStateDigest(cardId, card, reason) };
  }

  const exists = await branchOrWorktreeExists(card.branch, config, io);
  if (exists) {
    if (card.sessionId) {
      return { kind: 'resume', sessionId: card.sessionId, reason: 'branch_no_pr' };
    }
    return { kind: 'revert_and_redo' };
  }

  return { kind: 'fresh' };
}

/** Projects the orchestrator's full `RunLoopConfig` (or a `ResolvedConfig`, which extends it)
 * down to exactly what `deriveCardPhase` needs. */
export function derivePhaseConfigOf(config: RunLoopConfig): DerivePhaseConfig {
  return {
    repoRoot: config.repoRoot,
    homeDir: config.homeDir,
    includeEscalated: config.includeEscalated,
    remote: config.remote,
  };
}
