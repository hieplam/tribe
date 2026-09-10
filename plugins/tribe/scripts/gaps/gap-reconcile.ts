// gap-reconcile.ts — deterministic reconciliation CLI (Task 2, spec §3 "Gap registry &
// reconciliation"). Sole writer of `.tribe/harness-gaps.jsonl`: matches by EXECUTING each open
// entry's frozen fingerprint (never by comparing prose/regex — spec §3's non-determinism
// rationale), mints ids for genuinely new candidates, and never touches a `ruled` id.
//
// CLI contract:
//   bun gap-reconcile.ts --registry <path> --changed-files <comma-list> --candidates <json-file>
//
// IO (fs reads/writes, `grep` execution via Bun.spawn) lives here, never in ledger.ts — ledger.ts
// stays a pure module (parse/fold/mint/serialize only). Fingerprint tokenization/validation is
// its own pure module (`fingerprint.ts`) shared with `gap-rule.ts`/`debt-tree.ts`.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import {
  foldToLatestStatus,
  mintNextId,
  parseLedger,
  serializeEvent,
  LedgerError,
  type GapEvent,
  type OpenedEvent,
  type SeenEvent,
} from './ledger.ts';
import { validateFingerprint } from './fingerprint.ts';
import { anyPathOverlap, pathsOverlap } from './paths.ts';

/** Every external-input failure this CLI can meet, as ONE typed refusal (card C1,
 * fail-closed-edges obligations 1 and 4). `main` converts it to a single stderr line + exit 2;
 * it never reaches a user as a stack trace. */
export class GapReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GapReconcileError';
  }
}

/** Resolves the registry path for a run. WITHOUT `repo` the path is used exactly as given —
 * today's behaviour, unchanged, which is what keeps every pre-existing caller and test working.
 * WITH `repo` (spec §2 step 4: "the registry path resolved against --repo") a relative path is
 * joined onto the repo root and the result must stay inside it — an escaping path is refused
 * before anything is opened or appended (fail-closed-edges obligation 4). */
export function resolveRegistryPath(registryPath: string, repo?: string): string {
  if (repo === undefined) return registryPath;
  const root = resolve(repo);
  const full = isAbsolute(registryPath) ? resolve(registryPath) : resolve(root, registryPath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new GapReconcileError(`registry path escapes --repo (${root}): ${registryPath}`);
  }
  return full;
}

/** Tracker's report candidate, already extracted into structured form by Warchief (spec §3):
 * `{category, paths, fingerprint, hits, description}`. `pr` is not part of that canonical
 * shape, but `opened`/`seen` events require a PR number — if the caller happens to attach one
 * to a candidate, it is used (uniformly, for this whole reconciliation run); otherwise `0`. */
export interface Candidate {
  category: string;
  paths: string[];
  fingerprint: string;
  hits: number;
  description: string;
  pr?: number;
}

/** Spec §3 output shape: matched (reused) ids, minted (newly opened) ids, how many relevant
 * entries were suppressed because they are already `ruled`, and rejected-fingerprint reports. */
export interface ReconcileResult {
  matched: string[];
  minted: string[];
  suppressed_count: number;
  flagged: string[];
}

/** Rebuilds a fingerprint's argv "restricted to the changed files" (spec §3): keeps the
 * original flags and search pattern, but replaces whatever target path(s) the fingerprint was
 * originally authored against with `targets` (the changed files overlapping this entry's
 * paths) — reconciliation never greps the whole tree. */
function buildRestrictedArgv(tokens: readonly string[], targets: readonly string[]): string[] {
  const rest = tokens.slice(1);
  const flags: string[] = [];
  let idx = 0;
  while (idx < rest.length && rest[idx]!.startsWith('-')) {
    flags.push(rest[idx]!);
    idx++;
  }
  const pattern = rest[idx] ?? '';
  return ['grep', ...flags, pattern, ...targets];
}

/** Runs a validated grep argv directly via `Bun.spawn` (no shell — argv only, never a
 * string-interpolated shell command). "Fires" = grep's own matching exit code (0 = match
 * found); `hits` = number of non-empty output lines, used for `hits_now`. */
async function runGrep(argv: readonly string[], cwd?: string): Promise<{ fired: boolean; hits: number }> {
  const proc = Bun.spawn(argv as string[], {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const hits = stdout.split('\n').filter((line) => line.length > 0).length;
  return { fired: exitCode === 0, hits };
}

/** Runs the full spec §3 reconciliation algorithm against a real registry file and a real
 * fixture repo tree (fingerprints are executed for real, via `grep`). Sole writer of the
 * registry: every appended event is written with `appendFileSync` only — pre-existing bytes
 * are never rewritten, reordered, or reformatted (the append-only invariant, spec §6a
 * scenario 7). */
export async function reconcile(options: {
  registryPath: string;
  changedFiles: readonly string[];
  candidates: readonly Candidate[];
  /** Target repo root (spec §2 step 4). Absent = today's behaviour: paths as given, grep in the
   * shell's own cwd. */
  repo?: string;
}): Promise<ReconcileResult> {
  const { registryPath, changedFiles, candidates, repo } = options;
  const resolvedRegistry = resolveRegistryPath(registryPath, repo);

  let registryText = '';
  if (existsSync(resolvedRegistry)) {
    try {
      registryText = readFileSync(resolvedRegistry, 'utf8');
    } catch (err) {
      throw new GapReconcileError(
        `registry is unreadable: ${resolvedRegistry}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const events = parseLedger(registryText);

  // Every id's `opened` event carries its frozen identity (paths/category/fingerprint) — the
  // latest event per id (which may be a `seen` or `ruled` event, lacking those fields) only
  // tells us its current status.
  const openedById = new Map<string, OpenedEvent>();
  for (const event of events) {
    if (event.event === 'opened') {
      openedById.set(event.id, event);
    }
  }
  const latestById = foldToLatestStatus(events);

  // mintNextId must count ALL ids ever minted, including ruled ones (plan Task 1 minting
  // rule) — openedById already holds every id that ever had an `opened` event, regardless of
  // its current status, so this is the complete population.
  const allIds: string[] = [...openedById.keys()];

  const currentPr = candidates.find((c) => typeof c.pr === 'number')?.pr ?? 0;

  const matched: string[] = [];
  const flagged: string[] = [];
  const appended: GapEvent[] = [];
  const firedEntries: OpenedEvent[] = [];
  let suppressedCount = 0;

  for (const [id, entry] of openedById) {
    const latest = latestById.get(id);
    if (latest && latest.event === 'ruled') {
      // Suppressed (spec §3 step 4): never matched, never re-opened, never reported — it does
      // not participate below at all, even to be flagged. Still countable as "relevant but
      // ruled" if it would otherwise have been in scope for this diff.
      if (anyPathOverlap(entry.paths, changedFiles)) {
        suppressedCount++;
      }
      continue;
    }

    const overlappingChanged = changedFiles.filter((f) => entry.paths.some((p) => pathsOverlap(p, f)));
    if (overlappingChanged.length === 0) continue; // spec §6a scenario 8: out of scope, never even validated

    const validation = validateFingerprint(entry.fingerprint);
    if (!validation.valid) {
      flagged.push(`${id}: ${validation.reason} (fingerprint: ${entry.fingerprint})`);
      continue; // spec §6a scenario 9: rejected fingerprints are never executed
    }

    const argv = buildRestrictedArgv(validation.tokens!, overlappingChanged);
    const { fired, hits } = await runGrep(argv, repo);
    if (fired) {
      const seenEvent: SeenEvent = { id, event: 'seen', pr: currentPr, hits_now: hits };
      appended.push(seenEvent);
      matched.push(id);
      firedEntries.push(entry);
    }
  }

  const minted: string[] = [];
  for (const candidate of candidates) {
    // A candidate is "left unmatched" (spec §3 step 3) only if no open entry that just fired
    // already represents it. Matching here is by category + path overlap (both frozen at
    // `opened` time) — never by comparing the candidate's own drifting prose/fingerprint
    // against the stored one (spec §6a scenario 3).
    const alreadyRepresented = firedEntries.some(
      (entry) => entry.category === candidate.category && anyPathOverlap(entry.paths, candidate.paths),
    );
    if (alreadyRepresented) continue;

    const nextId = mintNextId(allIds);
    const openedEvent: OpenedEvent = {
      id: nextId,
      event: 'opened',
      category: candidate.category,
      paths: candidate.paths,
      fingerprint: candidate.fingerprint,
      hits_at_detection: candidate.hits,
      first_seen_pr: currentPr,
    };
    appended.push(openedEvent);
    minted.push(nextId);
    allIds.push(nextId);
    openedById.set(nextId, openedEvent);
  }

  if (appended.length > 0) {
    mkdirSync(dirname(resolvedRegistry), { recursive: true });
    appendFileSync(resolvedRegistry, appended.map(serializeEvent).join(''));
  }

  return { matched, minted, suppressed_count: suppressedCount, flagged };
}

function parseArgs(argv: readonly string[]): {
  registry: string;
  changedFiles: string[];
  candidatesPath: string;
  repo?: string;
} {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0) return undefined;
    const value = argv[idx + 1];
    // fail-closed-edges: a flag whose value is missing or is itself another flag token (`--x`) is
    // treated as absent, so the required-flag guard refuses instead of silently consuming the next
    // flag's name (which would thread e.g. `--home` into `git -C`).
    if (value === undefined || value.startsWith('--')) return undefined;
    return value;
  };
  const registry = get('--registry');
  const changedFilesArg = get('--changed-files');
  const candidatesPath = get('--candidates');
  const repo = get('--repo');
  if (!registry || !changedFilesArg || !candidatesPath) {
    throw new GapReconcileError(
      'Usage: gap-reconcile.ts --registry <path> --changed-files <comma-list> --candidates <json-file> [--repo <target-repo>]',
    );
  }
  const changedFiles = changedFilesArg
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { registry, changedFiles, candidatesPath, ...(repo === undefined ? {} : { repo }) };
}

/** CLI entrypoint: parses argv, reads the candidates JSON file, reconciles, and prints the
 * spec §3 output object as a single JSON line on stdout. */
export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
  try {
    const { registry, changedFiles, candidatesPath, repo } = parseArgs(argv);
    let candidates: unknown;
    try {
      candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
    } catch (err) {
      throw new GapReconcileError(
        `candidates file is unreadable or not JSON: ${candidatesPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!Array.isArray(candidates)) {
      throw new GapReconcileError(`candidates file is not a JSON array: ${candidatesPath}`);
    }
    const result = await reconcile({
      registryPath: registry,
      changedFiles,
      candidates: candidates as Candidate[],
      ...(repo === undefined ? {} : { repo }),
    });
    console.log(JSON.stringify(result));
  } catch (err) {
    const message =
      err instanceof GapReconcileError || err instanceof LedgerError
        ? err.message
        : `unexpected failure: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`gap-reconcile: ${message}`);
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
