// D3 replay (six points): SHIPPED verification, as code.
//
// Every point is generic (D4): nothing here reads a PR body, a gap-gate stamp or a gap
// ledger — a plain PR from any executor can pass it.
//
// verifyShipped() is the acceptance gate for a card the executor claims is `SHIPPED
// <pr> <sha>` — that line is a signal only (design spec §D3); this module independently
// replays all six checks against reality. Every world-touching operation (gh/git
// invocations, reading the card's plan file) goes through the injected `io` seam below —
// this module never imports `child_process`, `fs`, or performs network I/O itself.
import { join } from 'node:path';
import type { Card } from './types.ts';
import type { ExecOptions, ExecResult, VerifyIO } from '../ports/ports.ts';

export type { ExecResult, VerifyIO };

/** Everything verify.ts needs from campaign config — deliberately a narrow, LOCAL type
 * (not `CampaignState`). `schemaLockPaths`/`docsOnlyPaths` are campaign config carried by the
 * caller from `CampaignState.schemaLockPaths`/`CampaignState.docsOnlyPaths` — never hardcoded
 * here (stateless-capability wall). */
export interface VerifyConfig {
  /** Target repo root; `cwd` for every `exec` call (an input, per spec §2). */
  repoRoot: string;
  /** The git remote this repo's canonical upstream/PR-target actually is (resolved once,
   * `ResolvedConfig.remote` — never re-hardcoded here). */
  remote: string;
  /** The branch every check below diffs/merge-bases against (`ResolvedConfig.baseBranch`). */
  baseBranch: string;
  schemaLockPaths: string[];
  /** Path prefixes that count as "docs-only" for the D6 flake waiver — campaign config
   * carried by the caller from `CampaignState.docsOnlyPaths`, never hardcoded here
   * (stateless-capability wall). An EMPTY list fails closed: nothing counts as docs-only, so
   * a code diff never auto-waives (see `isDocsOnlyDiff`). */
  docsOnlyPaths: string[];
}

/** The D3 points (five generic ones plus D4's localBaseSynced), each independently reported (never short-circuited) so a failed
 * `verifyShipped` names EVERY failing point, not just the first. */
export type VerifyPointId =
  | 'merged'
  | 'mergeShaAncestorOfMaster'
  | 'checksGreen'
  | 'worktreeAndBranchGone'
  | 'schemaGuard'
  | 'localBaseSynced';

export interface VerifyPointResult {
  id: VerifyPointId;
  passed: boolean;
  detail: string;
}

export interface VerifyResult {
  /** True iff every point passed. */
  shipped: boolean;
  points: VerifyPointResult[];
  /** Convenience projection of `points` — every failed point's id, in point order. Feeds
   * the escalation file (spec §D5) directly; a reader never has to scan `points` to find
   * out what broke. */
  failedPoints: VerifyPointId[];
}

/** A single PR check as read from `gh pr checks --json name,bucket,description`.
 * `bucket` mirrors gh's own pass/fail/pending/skipping/cancel vocabulary. */
interface PrCheck {
  name: string;
  bucket: string;
  description?: string;
}

/** Runs one exec call; a rejected `io.exec` (network blip, missing binary) is folded into
 * a synthetic non-zero result rather than propagating — every check function reports a
 * failed point instead of throwing (non-negotiable: a failed check is a reportable
 * outcome, never an exception). */
async function run(io: VerifyIO, cwd: string, cmd: string[], options?: ExecOptions): Promise<ExecResult> {
  try {
    return await io.exec(cmd, { cwd, ...options });
  } catch (err) {
    return { stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1 };
  }
}

async function checkMerged(
  card: Card,
  config: VerifyConfig,
  io: VerifyIO,
): Promise<{ point: VerifyPointResult; mergeSha: string | null }> {
  if (card.pr == null) {
    return {
      point: {
        id: 'merged',
        passed: false,
        detail: 'card.pr is not set; cannot query gh api repos/{owner}/{repo}/pulls/<pr>',
      },
      mergeSha: null,
    };
  }

  // F4: `gh api pulls/<pr>` resolves against the API ROOT, not the current repo, and 404s
  // (verified against the real CLI). `{owner}`/`{repo}` are gh's OWN literal placeholders —
  // gh substitutes them from the repo in `cwd` itself; passed through literally here, never
  // interpolated with a repo name (that would violate the stateless-capability wall).
  const apiPath = `repos/{owner}/{repo}/pulls/${card.pr}`;
  const result = await run(io, config.repoRoot, ['gh', 'api', apiPath]);
  if (result.exitCode !== 0) {
    return {
      point: {
        id: 'merged',
        passed: false,
        detail: `gh api ${apiPath} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
      },
      mergeSha: null,
    };
  }

  let parsed: { merged?: unknown; merge_commit_sha?: unknown };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return {
      point: {
        id: 'merged',
        passed: false,
        detail: `gh api ${apiPath} returned non-JSON output`,
      },
      mergeSha: null,
    };
  }

  const merged = parsed.merged === true;
  const mergeSha = typeof parsed.merge_commit_sha === 'string' ? parsed.merge_commit_sha : null;
  return {
    point: {
      id: 'merged',
      passed: merged,
      detail: merged
        ? `PR #${card.pr} is merged (merge_commit_sha=${mergeSha ?? 'unknown'})`
        : `PR #${card.pr} is not merged (gh api ${apiPath} reported merged=${String(parsed.merged)})`,
    },
    mergeSha,
  };
}

async function checkAncestor(
  mergeSha: string | null,
  config: VerifyConfig,
  io: VerifyIO,
): Promise<VerifyPointResult> {
  if (!mergeSha) {
    return {
      id: 'mergeShaAncestorOfMaster',
      passed: false,
      detail: 'no merge sha available (point 1 did not report one); cannot check ancestry',
    };
  }

  const target = `${config.remote}/${config.baseBranch}`;
  const result = await run(io, config.repoRoot, ['git', 'merge-base', '--is-ancestor', mergeSha, target]);
  const passed = result.exitCode === 0;
  return {
    id: 'mergeShaAncestorOfMaster',
    passed,
    detail: passed
      ? `${mergeSha} is an ancestor of ${target}`
      : `${mergeSha} is NOT an ancestor of ${target} (git merge-base --is-ancestor exit ${result.exitCode})`,
  };
}

/** D6: a failing check is a waivable flake iff it is the ONLY failing check, its name
 * matches the SonarCloud advisory signature, and its description carries the bootstrap
 * "504" signature. `checkChecksGreen` additionally requires a docs-only diff before
 * treating it as waived — a code diff never auto-waives, even when the check itself
 * matches this signature. */
function isSonar504Signature(check: PrCheck): boolean {
  return /sonarcloud/i.test(check.name) && /504/.test(check.description ?? '');
}

/** F1: the docs-only path set is campaign config (`config.docsOnlyPaths`), never a hardcoded
 * `docs/` prefix — that would bake the TARGET repo's directory layout into a capability that
 * must work against ANY repo (stateless-capability wall). An EMPTY `docsOnlyPaths` fails
 * closed: nothing counts as docs-only, so a code diff never auto-waives — the opposite
 * default (empty ⇒ everything docs-only) would auto-waive every code diff, which D6 forbids
 * absolutely. */
async function isDocsOnlyDiff(baseSha: string | null, config: VerifyConfig, io: VerifyIO): Promise<boolean> {
  if (!baseSha) return false;
  if (config.docsOnlyPaths.length === 0) return false;
  const result = await run(io, config.repoRoot, [
    'git',
    'diff',
    '--name-only',
    `${baseSha}..${config.remote}/${config.baseBranch}`,
  ]);
  if (result.exitCode !== 0) return false;
  const files = result.stdout
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  return files.length > 0 && files.every((f) => config.docsOnlyPaths.some((prefix) => f.startsWith(prefix)));
}

async function checkChecksGreen(card: Card, config: VerifyConfig, io: VerifyIO): Promise<VerifyPointResult> {
  if (card.pr == null) {
    return { id: 'checksGreen', passed: false, detail: 'card.pr is not set; cannot query gh pr checks' };
  }

  const result = await run(io, config.repoRoot, [
    'gh',
    'pr',
    'checks',
    String(card.pr),
    '--json',
    'name,bucket,description',
  ]);
  if (result.exitCode !== 0) {
    return {
      id: 'checksGreen',
      passed: false,
      detail: `gh pr checks ${card.pr} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    };
  }

  let checks: PrCheck[];
  try {
    checks = JSON.parse(result.stdout);
  } catch {
    return { id: 'checksGreen', passed: false, detail: `gh pr checks ${card.pr} returned non-JSON output` };
  }

  // F2: align with github.ts's `isNotPassing` — gh's `skipping` bucket (a routine
  // path-filtered check) is non-blocking, not a failure. Two modules disagreeing on this same
  // gh vocabulary would make verify.ts escalate healthy cards that github.ts would happily
  // merge.
  const failing = checks.filter((c) => c.bucket !== 'pass' && c.bucket !== 'skipping');
  if (failing.length === 0) {
    return { id: 'checksGreen', passed: true, detail: `all ${checks.length} check(s) concluded success` };
  }

  if (failing.length === 1 && isSonar504Signature(failing[0])) {
    const docsOnly = await isDocsOnlyDiff(card.baseSha, config, io);
    if (docsOnly) {
      return {
        id: 'checksGreen',
        passed: true,
        detail: `waived: only failing check "${failing[0].name}" matches the SonarCloud-504 bootstrap signature and the diff is docs-only`,
      };
    }
    return {
      id: 'checksGreen',
      passed: false,
      detail: `"${failing[0].name}" matches the SonarCloud-504 signature but the diff is NOT docs-only — D6 never auto-waives a code diff`,
    };
  }

  return {
    id: 'checksGreen',
    passed: false,
    detail: `${failing.length} check(s) not successful: ${failing.map((c) => c.name).join(', ')}`,
  };
}

// P4 audit fix-round (should-fix, scout): the residue-safety contract between this module and
// `residue.ts`/`core/loop/card-actions.ts` was three independent string-literal copies of the
// same two phrases — rewording one silently broke the heal decision with no compile/test
// failure pointing at the cause. Exported as the single shared source of truth; every producer
// AND consumer imports these instead of re-typing the literal.
export const WORKTREE_STILL_PRESENT_DETAIL = 'worktree still present';
export const REMOTE_BRANCH_STILL_PRESENT_DETAIL = 'remote branch still present';

async function checkWorktreeAndBranchGone(
  card: Card,
  config: VerifyConfig,
  io: VerifyIO,
): Promise<VerifyPointResult> {
  if (!card.branch) {
    return {
      id: 'worktreeAndBranchGone',
      passed: false,
      detail: 'card.branch is not set; cannot check worktree/branch state',
    };
  }

  const worktreeResult = await run(io, config.repoRoot, ['git', 'worktree', 'list', '--porcelain']);
  const worktreeStillExists = worktreeResult.stdout
    .split('\n')
    .some((line) => line.trim() === `branch refs/heads/${card.branch}`);

  const remoteResult = await run(io, config.repoRoot, ['git', 'ls-remote', '--heads', config.remote, card.branch]);
  const remoteStillExists = remoteResult.stdout.trim().length > 0;

  if (!worktreeStillExists && !remoteStillExists) {
    return {
      id: 'worktreeAndBranchGone',
      passed: true,
      detail: `worktree for ${card.branch} is gone and ${config.remote}/${card.branch} is deleted`,
    };
  }

  const problems: string[] = [];
  if (worktreeStillExists) problems.push(WORKTREE_STILL_PRESENT_DETAIL);
  if (remoteStillExists) problems.push(REMOTE_BRANCH_STILL_PRESENT_DETAIL);
  return {
    id: 'worktreeAndBranchGone',
    passed: false,
    detail: `${card.branch}: ${problems.join(' and ')}`,
  };
}

/** Minimal YAML front-matter reader: only extracts the boolean `allowsSchemaChange` key
 * from a leading `---`-delimited block. Binding convention (spec §D3 point 6): absent
 * front-matter OR absent key ⇒ `false` (guard enforced). Everything else in the front
 * matter, and everything after the closing `---`, is ignored — this is not a general YAML
 * parser, just the one flag D3 needs. */
export function readAllowsSchemaChange(planContent: string): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(planContent);
  if (!match) return false;
  const frontMatter = match[1] ?? '';
  const keyMatch = /^allowsSchemaChange:\s*(true|false)\s*$/m.exec(frontMatter);
  if (!keyMatch) return false;
  return keyMatch[1] === 'true';
}

/** The schema guard's oracle (spec §2.1): the card branch's OWN commits. After a regular merge
 * that set is exactly the three-dot diff between the merge commit's two parents — `merge-base(p1,
 * p2)` is the last base-branch commit the branch absorbed, so every base-side change is excluded
 * by construction while all branch-authored work (including a sub-branch the card merged in) is
 * included. PURE: the caller reads the parents, this decides (`pure-core.md`). */
export type SchemaGuardRange =
  | { kind: 'range'; from: string; to: string }
  | { kind: 'refuse'; detail: string };

export function schemaGuardRange(input: {
  mergeSha: string | null;
  /** The merge commit's parents as the edge observed them, or `null` when the edge could not
   * observe them at all (the `git rev-list` lookup itself failed). That distinction is load-
   * bearing: an unreadable parent list reported as an empty one refuses with "has 0 parent(s)",
   * which is a false statement about the commit and hides a broken repository behind a message
   * about merge policy. */
  parents: string[] | null;
}): SchemaGuardRange {
  if (input.mergeSha === null) {
    return { kind: 'refuse', detail: 'the merge commit sha is unknown, so the card branch own commits cannot be identified' };
  }
  if (input.parents === null) {
    return {
      kind: 'refuse',
      detail: `the parents of merge commit ${input.mergeSha} could not be read, so the card branch own commits cannot be identified`,
    };
  }
  if (input.parents.length !== 2) {
    return {
      kind: 'refuse',
      detail: `the merge commit ${input.mergeSha} has ${input.parents.length} parent(s), not 2; `
        + 'only a regular merge leaves the two-parent anchor this guard needs (never squash, never rebase-merge)',
    };
  }
  return { kind: 'range', from: input.parents[0] as string, to: input.parents[1] as string };
}

async function checkSchemaGuard(
  card: Card,
  config: VerifyConfig,
  io: VerifyIO,
  mergeSha: string | null,
): Promise<VerifyPointResult> {
  if (config.schemaLockPaths.length === 0) {
    return { id: 'schemaGuard', passed: true, detail: 'no schema-lock paths configured; guard is a no-op' };
  }

  if (!card.baseSha) {
    return {
      id: 'schemaGuard',
      passed: false,
      detail: 'card.baseSha is not set; cannot evaluate the schema guard',
    };
  }

  // C1 (HARDENING-BACKLOG): this point runs AFTER the merge, and a card is permitted to delete
  // its own planning docs as part of its work (T26's release commit removed docs/plans/). A
  // plan that is gone by now is therefore a guard INPUT — it simply grants no waiver — never
  // an ENOENT thrown out of verifyShipped, which left T26 `running` although it had merged.
  // The pre-flight read (`nextCard`'s PLANNING_NEEDED check) still requires the file.
  let allowsSchemaChange = false;
  let planGone = false;
  if (card.plan) {
    const resolvedPlanPath = join(config.repoRoot, card.plan);
    if (io.fileExists(resolvedPlanPath)) {
      const planContent = await io.readFile(resolvedPlanPath);
      allowsSchemaChange = readAllowsSchemaChange(planContent);
    } else {
      planGone = true;
    }
  }

  // With no merge sha there is nothing to look up: `git rev-list --parents -n 1 null` would
  // spend a subprocess on the literal string "null" and log a nonsense command. A failed
  // lookup yields `null` parents, never `[]` — see `schemaGuardRange`.
  let parents: string[] | null = null;
  if (mergeSha !== null) {
    const parentsResult = await run(io, config.repoRoot, ['git', 'rev-list', '--parents', '-n', '1', mergeSha]);
    if (parentsResult.exitCode === 0) {
      parents = parentsResult.stdout.trim().split(/\s+/).slice(1);
    }
  }
  const range = schemaGuardRange({ mergeSha, parents });
  if (range.kind === 'refuse') {
    return { id: 'schemaGuard', passed: false, detail: `cannot evaluate the schema guard: ${range.detail}` };
  }

  const result = await run(io, config.repoRoot, [
    'git',
    'diff',
    `${range.from}...${range.to}`,
    '--',
    ...config.schemaLockPaths,
  ]);
  // A failed diff leaves stdout EMPTY and writes to stderr, so an unchecked exit code reads
  // "the diff ran and found nothing" — the guard would pass a check that never ran. The
  // three-dot form makes this reachable: it requires a merge base and git refuses outright
  // when the two parents share none (`fatal: <A>...<B>: no merge base`, exit 128). Under-
  // checking is a BUG and failing closed on an undecidable range is BY DESIGN (spec §2.1),
  // so this refuses. `run()` also folds a thrown `io.exec` into `exitCode: 1`, so one check
  // covers a non-zero git exit and a spawn failure alike.
  if (result.exitCode !== 0) {
    return {
      id: 'schemaGuard',
      passed: false,
      detail:
        `cannot evaluate the schema guard: git diff ${range.from}...${range.to} failed with exit code ` +
        `${result.exitCode}: ${result.stderr.trim() || '(no stderr)'}`,
    };
  }

  const diffIsEmpty = result.stdout.trim().length === 0;

  if (diffIsEmpty) {
    return { id: 'schemaGuard', passed: true, detail: `no diff on schema-lock paths in ${range.from}...${range.to}` };
  }

  if (allowsSchemaChange) {
    return {
      id: 'schemaGuard',
      passed: true,
      detail: `schema-lock paths changed in ${range.from}...${range.to}, but the plan's front-matter declares allowsSchemaChange: true`,
    };
  }

  const planNote = planGone
    ? ` (the plan ${card.plan} is no longer on disk — the card may have deleted it — so no allowsSchemaChange waiver could be read)`
    : '';
  return {
    id: 'schemaGuard',
    passed: false,
    detail: `schema-lock paths (${config.schemaLockPaths.join(', ')}) changed in ${range.from}...${range.to} and allowsSchemaChange is not true${planNote}`,
  };
}

/** D4 (card runner-driver-only): "the feature is merged and local master has the latest". Race-free
 * form of "local == remote": the merge commit is IN the local base branch, and the local base has no
 * commit the remote lacks. Strict equality would fail whenever a concurrent card merged after this
 * card's own sync (`--max-concurrent > 1`) — spec §4.7. */
async function checkLocalBaseSynced(mergeSha: string | null, config: VerifyConfig, io: VerifyIO): Promise<VerifyPointResult> {
  const id = 'localBaseSynced' as const;
  if (!mergeSha) return { id, passed: false, detail: 'no merge sha available (point 1 did not report one); cannot check the local base' };
  const remoteBase = `${config.remote}/${config.baseBranch}`;
  const fetched = await run(io, config.repoRoot, ['git', 'fetch', config.remote, config.baseBranch], { timeoutMs: 120_000 });
  if (fetched.exitCode !== 0) return { id, passed: false, detail: `git fetch ${config.remote} ${config.baseBranch} failed (exit ${fetched.exitCode}); cannot compare the local base` };
  const contains = await run(io, config.repoRoot, ['git', 'merge-base', '--is-ancestor', mergeSha, config.baseBranch]);
  if (contains.exitCode !== 0) {
    return { id, passed: false, detail: `local ${config.baseBranch} does not contain merge ${mergeSha}; fast-forward it to ${remoteBase}` };
  }
  const notAhead = await run(io, config.repoRoot, ['git', 'merge-base', '--is-ancestor', config.baseBranch, remoteBase]);
  if (notAhead.exitCode !== 0) {
    return { id, passed: false, detail: `local ${config.baseBranch} has commits ${remoteBase} lacks (diverged); it is never healed automatically` };
  }
  return { id, passed: true, detail: `local ${config.baseBranch} contains ${mergeSha} and is not ahead of ${remoteBase}` };
}

/** The D3 six-point replay, as code. The executor's `SHIPPED <pr> <sha>` line is a signal
 * only (spec §D3) — this is the acceptance. Every point is checked and reported
 * independently; a failure at one point never short-circuits the rest, so a failed result
 * names EVERY failing point (it feeds the escalation file a human reads). Never throws on
 * a verification failure — a failed check is a normal, reportable outcome. */
export async function verifyShipped(card: Card, config: VerifyConfig, io: VerifyIO, cardId: string): Promise<VerifyResult> {
  void cardId; // kept in the signature: Task 2.11's doneAtHead point and the replay tool pass it
  const merged = await checkMerged(card, config, io);
  const ancestor = await checkAncestor(merged.mergeSha, config, io);
  const checks = await checkChecksGreen(card, config, io);
  const worktree = await checkWorktreeAndBranchGone(card, config, io);
  const schema = await checkSchemaGuard(card, config, io, merged.mergeSha);
  const localBase = await checkLocalBaseSynced(merged.mergeSha, config, io);
  const points: VerifyPointResult[] = [merged.point, ancestor, checks, worktree, schema, localBase];
  const failedPoints = points.filter((p) => !p.passed).map((p) => p.id);
  return { shipped: failedPoints.length === 0, points, failedPoints };
}
