// D3 five-point SHIPPED verification, as code (Task 3).
//
// verifyShipped() is the acceptance gate for a card the executor claims is `SHIPPED
// <pr> <sha>` — that line is a signal only (design spec §D3); this module independently
// replays all five checks against reality. Every world-touching operation (gh/git
// invocations, reading the card's plan file) goes through the injected `io` seam below —
// this module never imports `child_process`, `fs`, or performs network I/O itself.
import { join } from 'node:path';
import type { Card } from './types.ts';
import type { ExecResult, VerifyIO } from '../ports/ports.ts';

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
  /** Where ledger policy A (spec §4) keeps the gap registry inside the target repo. Campaign
   * config, carried by the caller; defaults to the capability's own constant. */
  gapLedgerPath?: string;
}

/** The D3 five points, each independently reported (never short-circuited) so a failed
 * `verifyShipped` names EVERY failing point, not just the first. */
export type VerifyPointId =
  | 'merged'
  | 'mergeShaAncestorOfMaster'
  | 'checksGreen'
  | 'worktreeAndBranchGone'
  | 'schemaGuard'
  | 'gapGateStamped'
  | 'ledgerCommitted';

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
async function run(io: VerifyIO, cwd: string, cmd: string[]): Promise<ExecResult> {
  try {
    return await io.exec(cmd, { cwd });
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

async function checkSchemaGuard(card: Card, config: VerifyConfig, io: VerifyIO): Promise<VerifyPointResult> {
  if (config.schemaLockPaths.length === 0) {
    return { id: 'schemaGuard', passed: true, detail: 'no schema-lock paths configured; guard is a no-op' };
  }

  if (!card.baseSha) {
    return {
      id: 'schemaGuard',
      passed: false,
      detail: `card.baseSha is not set; cannot diff baseSha..${config.remote}/${config.baseBranch} for the schema guard`,
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

  const result = await run(io, config.repoRoot, [
    'git',
    'diff',
    `${card.baseSha}..${config.remote}/${config.baseBranch}`,
    '--',
    ...config.schemaLockPaths,
  ]);
  const diffIsEmpty = result.stdout.trim().length === 0;

  if (diffIsEmpty) {
    return { id: 'schemaGuard', passed: true, detail: `no diff on schema-lock paths since ${card.baseSha}` };
  }

  if (allowsSchemaChange) {
    return {
      id: 'schemaGuard',
      passed: true,
      detail: `schema-lock paths changed since ${card.baseSha}, but the plan's front-matter declares allowsSchemaChange: true`,
    };
  }

  const planNote = planGone
    ? ` (the plan ${card.plan} is no longer on disk — the card may have deleted it — so no allowsSchemaChange waiver could be read)`
    : '';
  return {
    id: 'schemaGuard',
    passed: false,
    detail: `schema-lock paths (${config.schemaLockPaths.join(', ')}) changed since ${card.baseSha} and allowsSchemaChange is not true${planNote}`,
  };
}

/** The tribe's own artifact path under ledger policy A (spec §4) — NOT the target repo's
 * layout, which is what the stateless-capability wall forbids hardcoding. */
export const GAP_LEDGER_PATH = '.tribe/harness-gaps.jsonl';

/** Third reader of the `gap-gate v1` wire format (writer: scripts/gaps/gap-stamp.ts; other
 * reader: verify-shipped.sh). Keep this regex byte-identical to those two. The lazy `\S+?` on
 * `ledger` is load-bearing: a greedy match swallows a `-->` written with no space before it. */
const GAP_GATE_STAMP_RE =
  /<!--\s*gap-gate v1\s+card=(\S+)\s+base=(\S+)\s+head=(\S+)\s+minted=(\S+)\s+matched=(\S+)\s+debt-delta=(-?\d+)\s+ledger=(\S+?)\s*-->/;

export interface GapGateStamp {
  card: string;
  base: string;
  head: string;
  minted: string[];
  matched: string[];
}

export function parseGapGateStamp(text: string): GapGateStamp | null {
  const m = GAP_GATE_STAMP_RE.exec(text);
  if (!m) return null;
  const list = (v: string): string[] => (v === 'none' ? [] : v.split(',').filter((s) => s.length > 0));
  return { card: m[1]!, base: m[2]!, head: m[3]!, minted: list(m[4]!), matched: list(m[5]!) };
}

/** D3 point 6 (spec §3): the merged PR's body carries a `gap-gate v1` stamp whose `card=` is
 * THIS card and whose base/head shas are commits of the merged branch. A PR opened by a session
 * that bypassed the Warchief (leak L4) has no stamp, so it cannot record `shipped`. */
async function checkGapGateStamped(
  cardId: string,
  card: Card,
  config: VerifyConfig,
  io: VerifyIO,
): Promise<{ point: VerifyPointResult; stamp: GapGateStamp | null }> {
  const fail = (detail: string): { point: VerifyPointResult; stamp: null } => ({
    point: { id: 'gapGateStamped', passed: false, detail },
    stamp: null,
  });
  if (card.pr == null) return fail('card.pr is not set; cannot read the PR body');

  const result = await run(io, config.repoRoot, ['gh', 'pr', 'view', String(card.pr), '--json', 'body']);
  if (result.exitCode !== 0) {
    return fail(`gh pr view ${card.pr} --json body failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  let body: string;
  try {
    body = String((JSON.parse(result.stdout) as { body?: unknown }).body ?? '');
  } catch {
    return fail(`gh pr view ${card.pr} --json body returned non-JSON output`);
  }

  const stamp = parseGapGateStamp(body);
  if (!stamp) {
    return fail(
      `PR #${card.pr} body carries no \`gap-gate v1\` stamp — the harness-gap gate never ran for this PR`,
    );
  }
  if (stamp.card !== cardId) {
    return fail(`PR #${card.pr} body carries a gap-gate stamp for card=${stamp.card}, not ${cardId}`);
  }

  const target = `${config.remote}/${config.baseBranch}`;
  for (const sha of [stamp.base, stamp.head]) {
    const ancestry = await run(io, config.repoRoot, ['git', 'merge-base', '--is-ancestor', sha, target]);
    if (ancestry.exitCode !== 0) {
      return fail(`gap-gate stamp names ${sha}, which is not a commit of ${target} (exit ${ancestry.exitCode})`);
    }
  }

  return {
    point: {
      id: 'gapGateStamped',
      passed: true,
      detail: `PR #${card.pr} carries a gap-gate v1 stamp for ${cardId} (minted=${stamp.minted.join(',') || 'none'})`,
    },
    stamp,
  };
}

/** D3 point 7 (spec §3, ledger policy A): every id the stamp says was minted is present in the
 * ledger as committed on the merged base branch — the check that the append actually rode the PR
 * instead of dying with the worktree (leak L5). */
async function checkLedgerCommitted(
  stamp: GapGateStamp | null,
  config: VerifyConfig,
  io: VerifyIO,
): Promise<VerifyPointResult> {
  if (!stamp) {
    return { id: 'ledgerCommitted', passed: false, detail: 'no gap-gate stamp available (point 6 did not report one)' };
  }
  if (stamp.minted.length === 0) {
    return { id: 'ledgerCommitted', passed: true, detail: 'the stamp minted no ids; there is nothing to commit' };
  }

  const path = config.gapLedgerPath ?? GAP_LEDGER_PATH;
  const ref = `${config.remote}/${config.baseBranch}:${path}`;
  const result = await run(io, config.repoRoot, ['git', 'show', ref]);
  if (result.exitCode !== 0) {
    return {
      id: 'ledgerCommitted',
      passed: false,
      detail: `${ref} does not exist, but the stamp minted ${stamp.minted.join(',')} — the ledger append never landed`,
    };
  }
  const missing = stamp.minted.filter((id) => !result.stdout.includes(`"id":"${id}"`));
  if (missing.length > 0) {
    return { id: 'ledgerCommitted', passed: false, detail: `${ref} is missing minted id(s): ${missing.join(', ')}` };
  }
  return { id: 'ledgerCommitted', passed: true, detail: `${ref} carries every minted id (${stamp.minted.join(',')})` };
}

/** The D3 five-point replay, as code. The executor's `SHIPPED <pr> <sha>` line is a signal
 * only (spec §D3) — this is the acceptance. Every point is checked and reported
 * independently; a failure at one point never short-circuits the rest, so a failed result
 * names EVERY failing point (it feeds the escalation file a human reads). Never throws on
 * a verification failure — a failed check is a normal, reportable outcome. */
export async function verifyShipped(
  card: Card,
  config: VerifyConfig,
  io: VerifyIO,
  cardId: string,
): Promise<VerifyResult> {
  const merged = await checkMerged(card, config, io);
  const ancestor = await checkAncestor(merged.mergeSha, config, io);
  const checks = await checkChecksGreen(card, config, io);
  const worktree = await checkWorktreeAndBranchGone(card, config, io);
  const schema = await checkSchemaGuard(card, config, io);
  const gapGate = await checkGapGateStamped(cardId, card, config, io);
  const ledger = await checkLedgerCommitted(gapGate.stamp, config, io);
  const points: VerifyPointResult[] = [
    merged.point,
    ancestor,
    checks,
    worktree,
    schema,
    gapGate.point,
    ledger,
  ];
  const failedPoints = points.filter((p) => !p.passed).map((p) => p.id);
  return { shipped: failedPoints.length === 0, points, failedPoints };
}
