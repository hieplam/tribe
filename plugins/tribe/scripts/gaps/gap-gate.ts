// gap-gate.ts — the ONE pre-PR harness-gap gate (card C1, spec §2). Same shape as pre-gate.sh:
// one invocation before any PR is opened, red/green exit code, one Markdown report, one JSON
// summary.
//
//   bun gap-gate.ts --repo <target-repo> --home <tribe-home> --card <card-slug> --base <sha>
//                   [--head HEAD] [--pr <n>] [--registry .tribe/harness-gaps.jsonl] [--out <dir>]
//
// IMPURE EDGE ONLY (pure-core.md): the glob, the git call, the ledger read/append (through
// reconcile()), the file writes. Every decision — parsing, dedup, stamp text, section text —
// lives in the pure modules gap-candidates.ts and gap-stamp.ts and is merely called from here.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dedupeCandidates, parseTrackerReport, type ParsedCandidate, type UnparsedBlock } from './gap-candidates.ts';
import { diffDebt, type DiffEntry } from './debt-count.ts';
import { validateFingerprint } from './fingerprint.ts';
import { formatStamp, renderGapSection } from './gap-stamp.ts';
import { GapReconcileError, reconcile, resolveRegistryPath, type Candidate } from './gap-reconcile.ts';
import { LedgerError } from './ledger.ts';

/** Every setup failure of this gate, as ONE typed refusal: `main` prints it as a single stderr
 * line and exits 2, never a stack trace (fail-closed-edges obligation 1, spec §2 step 7). */
export class GapGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GapGateError';
  }
}

export interface GateOptions {
  repo: string;
  home: string;
  card: string;
  base: string;
  head?: string;
  pr?: number;
  registry?: string;
  out?: string;
}

export interface GateSummary {
  card: string;
  base: string;
  head: string;
  pr: number;
  reports: string[];
  candidates: ParsedCandidate[];
  unparsed: UnparsedBlock[];
  changed_files: string[];
  matched: string[];
  minted: string[];
  suppressed_count: number;
  flagged: string[];
  open_ids: string[];
  debt_delta: number;
  debt_entries: DiffEntry[];
  ledger: string;
  stamp: string;
  verdict: 'pass' | 'fail';
  exit: 0 | 1;
}

const DEFAULT_REGISTRY = '.tribe/harness-gaps.jsonl';

/** Step 1 (spec §2): glob `<home>/reports/tracker-<card>-*.md`. Zero files is a RED GATE, never
 * an empty set — that is what makes skipping the Tracker loud instead of silent (leak L1). */
function collectReports(home: string, card: string): Array<{ path: string; name: string; round: string }> {
  const dir = join(home, 'reports');
  const missing = new GapGateError(
    `no Tracker report for card ${card}: step 6.0b never ran, or the report path was wrong`,
  );
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw missing;
  }
  const prefix = `tracker-${card}-`;
  const found = names.filter((n) => n.startsWith(prefix) && n.endsWith('.md')).sort();
  if (found.length === 0) throw missing;
  return found.map((name) => ({ path: join(dir, name), name, round: name.slice(prefix.length, -3) }));
}

/** Step 3: the changed files, read from git at the edge (the pure core never shells out).
 * Host git config is neutralised and the child is bounded (fail-closed-edges obligations 2, 3). */
async function changedFiles(repo: string, base: string, head: string): Promise<string[]> {
  const proc = Bun.spawn(['git', '-C', repo, 'diff', '--name-only', `${base}...${head}`], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new GapGateError(
      `git diff --name-only ${base}...${head} failed in ${repo}: ${stderr.trim() || `exit ${code}`}`,
    );
  }
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Resolves `ref` to a concrete commit sha at the edge — a symbolic ref (`HEAD`, a branch name)
 * is never allowed to leak into the stamp (contract F1, spec §3: base/head are COMMITS of the
 * merged branch, not a ref the post-merge runner re-resolves at verify time). Bounded and
 * git-config-isolated like `changedFiles` (fail-closed-edges obligations 2, 3). */
async function resolveSha(repo: string, ref: string): Promise<string> {
  const proc = Bun.spawn(['git', '-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new GapGateError(`cannot resolve ${ref} to a commit in ${repo}: ${err.trim() || `exit ${code}`}`);
  }
  return out.trim();
}

function ledgerDigest(resolvedRegistry: string): string {
  if (!existsSync(resolvedRegistry)) return 'none';
  return createHash('sha256').update(readFileSync(resolvedRegistry)).digest('hex');
}

function toCandidate(parsed: ParsedCandidate, pr: number): Candidate {
  return {
    category: parsed.category,
    paths: parsed.paths,
    fingerprint: parsed.fingerprint,
    hits: parsed.hits,
    description: parsed.description,
    pr,
  };
}

/** Steps 1-7 of spec §2, in order. Every step's result is in the returned summary. */
export async function runGate(options: GateOptions): Promise<GateSummary> {
  const head = options.head ?? 'HEAD';
  const pr = options.pr ?? 0;
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const out = options.out ?? join(options.home, 'reports');

  // 1. Collect.
  const reports = collectReports(options.home, options.card);

  // 2. Parse (pure).
  const allCandidates: ParsedCandidate[] = [];
  const unparsed: UnparsedBlock[] = [];
  for (const report of reports) {
    let text: string;
    try {
      text = readFileSync(report.path, 'utf8');
    } catch (err) {
      throw new GapGateError(
        `Tracker report is unreadable: ${report.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const result = parseTrackerReport(text, report.name, report.round);
    allCandidates.push(...result.candidates);
    unparsed.push(...result.unparsed);
  }
  const candidates = dedupeCandidates(allCandidates, reports.map((r) => r.round));

  // 2b. Resolve base/head to concrete commit shas BEFORE the diff and the stamp — the stamp
  // freezes `head=<sha>`/`base=<sha>` (contract F1), never a symbolic ref like the literal
  // `HEAD` a post-merge runner would re-resolve at verify time instead of the gated commit.
  const baseSha = await resolveSha(options.repo, options.base);
  const headSha = await resolveSha(options.repo, head);

  // 3. Changed files.
  const changed = await changedFiles(options.repo, baseSha, headSha);

  // 4. Reconcile — but a candidate whose fingerprint would never be executable is flagged and
  // withheld first (plan F3), so an unusable fingerprint is never frozen into the ledger.
  const flagged: string[] = [];
  const safe: ParsedCandidate[] = [];
  for (const candidate of candidates) {
    const validation = validateFingerprint(candidate.fingerprint);
    if (validation.valid) safe.push(candidate);
    else flagged.push(`candidate: ${validation.reason} (fingerprint: ${candidate.fingerprint})`);
  }

  const resolvedRegistry = resolveRegistryPath(registry, options.repo);
  const result = await reconcile({
    registryPath: registry,
    repo: options.repo,
    changedFiles: changed,
    candidates: safe.map((c) => toCandidate(c, pr)),
  });
  flagged.push(...result.flagged);

  // 5. Debt burn-down — the gate is now the one place this runs (spec §2 step 5, CU-3 §4).
  let debtEntries: DiffEntry[];
  try {
    debtEntries = (await diffDebt(options.repo, options.base, head)).entries;
  } catch (err) {
    throw new GapGateError(
      `debt burn-down failed for ${options.base}..${head}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const debtDelta = debtEntries.reduce((sum, entry) => sum + entry.delta, 0);

  // 6. Report (pure rendering).
  const openIds = [...new Set([...result.matched, ...result.minted])].sort();
  const stamp = formatStamp({
    card: options.card,
    base: baseSha,
    head: headSha,
    minted: result.minted,
    matched: result.matched,
    debtDelta,
    ledger: ledgerDigest(resolvedRegistry),
  });

  // 7. Exit.
  const red = debtEntries.some((entry) => entry.delta > 0) || flagged.length > 0;
  const summary: GateSummary = {
    card: options.card,
    base: baseSha,
    head: headSha,
    pr,
    reports: reports.map((r) => r.name),
    candidates,
    unparsed,
    changed_files: changed,
    matched: result.matched,
    minted: result.minted,
    suppressed_count: result.suppressed_count,
    flagged,
    open_ids: openIds,
    debt_delta: debtDelta,
    debt_entries: debtEntries,
    ledger: ledgerDigest(resolvedRegistry),
    stamp,
    verdict: red ? 'fail' : 'pass',
    exit: red ? 1 : 0,
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, `${options.card}-gap-gate.md`),
    renderGapSection({
      matched: result.matched,
      minted: result.minted,
      suppressedCount: result.suppressed_count,
      flagged,
      openIds,
      unparsed: unparsed.map((u) => ({ file: u.file, line: u.line, reason: u.reason })),
      debtDelta,
      stamp,
    }),
  );
  writeFileSync(join(out, `${options.card}-gap-gate.json`), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function parseArgs(argv: readonly string[]): GateOptions {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const repo = get('--repo');
  const home = get('--home');
  const card = get('--card');
  const base = get('--base');
  if (!repo || !home || !card || !base) {
    throw new GapGateError(
      'usage: gap-gate.ts --repo <target-repo> --home <tribe-home> --card <slug> --base <sha> [--head HEAD] [--pr <n>] [--registry <path>] [--out <dir>]',
    );
  }
  const prRaw = get('--pr');
  const pr = prRaw === undefined ? undefined : Number(prRaw);
  if (pr !== undefined && !Number.isInteger(pr)) throw new GapGateError(`--pr is not an integer: ${prRaw}`);
  const head = get('--head');
  const registry = get('--registry');
  const out = get('--out');
  return {
    repo,
    home,
    card,
    base,
    ...(head === undefined ? {} : { head }),
    ...(pr === undefined ? {} : { pr }),
    ...(registry === undefined ? {} : { registry }),
    ...(out === undefined ? {} : { out }),
  };
}

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
  try {
    const summary = await runGate(parseArgs(argv));
    console.log(JSON.stringify(summary));
    process.exit(summary.exit);
  } catch (err) {
    const message =
      err instanceof GapGateError || err instanceof GapReconcileError || err instanceof LedgerError
        ? err.message
        : `unexpected failure: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`gap-gate: ${message}`);
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
