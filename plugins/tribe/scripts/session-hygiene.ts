// session-hygiene.ts — the thin impure edge (pure-core.md) for the session-hygiene ratchet (card
// runner-session-user-settings, G2/G4). It walks a directory tree, reads every `*.log`/`*.jsonl`
// file it finds, and hands each file's text to the PURE `countSessionHygiene` core
// (`core/metrics/session-hygiene.ts`) — every counting decision lives there; this file only does
// I/O and accumulation.
//
//   bun session-hygiene.ts --root <dir> [--json]
//
// This is a MEASUREMENT, not a gate: it always exits 0. A single unreadable file never costs the
// whole run — it is skipped with a warning to stderr and the walk continues
// (fail-closed-edges.md obligation 1: catch narrowly, never bare, never let a traceback escape).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countSessionHygiene, type SessionHygieneCounts } from './runner/core/metrics/session-hygiene.ts';

const LOG_EXTENSIONS = ['.log', '.jsonl'];

class SessionHygieneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionHygieneError';
  }
}

interface Options {
  root: string;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0) return undefined;
    const value = argv[idx + 1];
    // A flag whose value is missing or is itself another flag token (`--x`) reads as absent, so
    // the required-flag guard below refuses instead of silently consuming the next argv token.
    if (value === undefined || value.startsWith('--')) return undefined;
    return value;
  };
  const root = get('--root');
  if (root === undefined) {
    throw new SessionHygieneError('usage: session-hygiene.ts --root <dir> [--json]');
  }
  return { root, json: argv.includes('--json') };
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** Every `*.log`/`*.jsonl` file under `root`, recursively. A directory this process cannot read
 * (permission denied, or removed mid-walk) is skipped with a warning rather than aborting the
 * whole walk — the same fail-closed discipline as the per-file read below. Symlinked directories
 * are not descended into (`dirent.isDirectory()` is false for a symlink), which also avoids
 * symlink cycles. */
function walkLogFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (isErrnoException(err)) {
        console.error(`session-hygiene: skipping unreadable directory ${dir}: ${err.message}`);
        continue;
      }
      throw err;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && LOG_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

/** Reads one log file and counts it, or `null` when the file cannot be READ — logging a warning
 * to stderr rather than throwing, so one bad file never costs the whole measurement
 * (fail-closed-edges.md obligation 1). The catch is scoped to `readFileSync` ONLY: a failure from
 * the pure core is a different kind of problem (a bug, not an unreadable file) and must propagate
 * as itself rather than be relabeled "skipping unreadable file" — `main()`'s boundary is what
 * turns it into a clean refusal. */
export function countFileOrNull(path: string): SessionHygieneCounts | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`session-hygiene: skipping unreadable file ${path}: ${message}`);
    return null;
  }
  return countSessionHygiene(text);
}

function accumulate(root: string): SessionHygieneCounts {
  const totals: SessionHygieneCounts = { unknownSkills: {}, filesystemWideScans: 0 };
  for (const path of walkLogFiles(root)) {
    const counts = countFileOrNull(path);
    if (counts === null) continue;
    totals.filesystemWideScans += counts.filesystemWideScans;
    for (const [name, count] of Object.entries(counts.unknownSkills)) {
      totals.unknownSkills[name] = (totals.unknownSkills[name] ?? 0) + count;
    }
  }
  return totals;
}

function totalUnknownSkills(counts: SessionHygieneCounts): number {
  return Object.values(counts.unknownSkills).reduce((sum, n) => sum + n, 0);
}

function printReport(root: string, counts: SessionHygieneCounts, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ root, ...counts, totalUnknownSkills: totalUnknownSkills(counts) }, null, 2));
    return;
  }
  console.log(`session-hygiene report for ${root}`);
  const names = Object.keys(counts.unknownSkills).sort((a, b) => counts.unknownSkills[b]! - counts.unknownSkills[a]!);
  for (const name of names) {
    console.log(`Unknown skill: ${name}: ${counts.unknownSkills[name]}`);
  }
  console.log(`total unknown skills: ${totalUnknownSkills(counts)}`);
  console.log(`filesystem-wide scans: ${counts.filesystemWideScans}`);
}

function parseArgsOrExit(argv: readonly string[]): Options {
  try {
    return parseArgs(argv);
  } catch (err) {
    console.error(`session-hygiene: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export function main(argv: readonly string[] = Bun.argv.slice(2)): void {
  const options = parseArgsOrExit(argv);
  // A boundary around the actual measurement: anything that escapes `accumulate` (a walk error
  // that isn't a filesystem errno, or — see countFileOrNull above — a pure-core bug) must become
  // the same clean `session-hygiene: <message>` refusal the rest of this file already produces,
  // never a raw stack trace reaching a user-facing CLI (fail-closed-edges.md).
  let counts: SessionHygieneCounts;
  try {
    counts = accumulate(options.root);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`session-hygiene: ${message}`);
    process.exit(1);
  }
  printReport(options.root, counts, options.json);
  process.exit(0); // measurement, not a gate — the counts found never change the exit code
}

if (import.meta.main) {
  main();
}
