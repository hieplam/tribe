// session-hygiene.ts — the thin impure edge (pure-core.md) for the session-hygiene ratchet (card
// runner-session-user-settings, G2/G4). It walks a directory tree, reads every `*.log`/`*.jsonl`
// file it finds, and hands each file's text to the PURE `countSessionHygiene` core
// (`core/metrics/session-hygiene.ts`) — every counting decision lives there; this file only does
// I/O and accumulation.
//
//   bun session-hygiene.ts --root <dir> [--json]
//
// This is a MEASUREMENT, not a gate: a genuine measurement run always exits 0, and the counts it
// finds never change that. A single unreadable file, or an unreadable SUBdirectory mid-walk,
// never costs the whole run — it is skipped with a warning to stderr and the walk continues
// (fail-closed-edges.md obligation 1: catch narrowly, never bare, never let a traceback escape).
// The root itself being unreadable is different: that is a usage error (a typo'd --root must not
// read as a clean, empty scan), so it refuses with a non-zero exit and prints no report.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countSessionHygiene, type SessionHygieneCounts } from './runner/core/metrics/session-hygiene.ts';
import { errorCode } from './runner/core/errno.ts';

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

/** Every `*.log`/`*.jsonl` file under `root`, recursively. A directory this process cannot read
 * (permission denied, or removed mid-walk) is skipped with a warning rather than aborting the
 * whole walk — the same fail-closed discipline as the per-file read below. Symlinked directories
 * are not descended into (`dirent.isDirectory()` is false for a symlink), which also avoids
 * symlink cycles.
 *
 * The root itself failing is a DIFFERENT case from a subdirectory failing mid-walk (see the catch
 * below): a subdirectory failure is a legitimate partial failure (skip and continue), but the root
 * not existing/being readable at all is a usage error that must refuse the whole run, before any
 * report is printed — a typo'd --root must never look like a clean, empty scan. */
function walkLogFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const isRoot = dir === root;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (errorCode(err) === null) throw err;
      const message = err instanceof Error ? err.message : String(err);
      // The root itself is a usage error (a typo'd --root must not read as a clean, empty scan —
      // see G2): refuse up front instead of silently reporting 0. A SUBdirectory failing mid-walk
      // (permission denied, removed mid-run) is a legitimate partial failure: warn and continue.
      if (isRoot) throw new SessionHygieneError(`root ${root} is not readable: ${message}`);
      console.error(`session-hygiene: skipping unreadable directory ${dir}: ${message}`);
      continue;
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

/** The pure counting core, as a seam (pure-core.md): production call sites rely on the default
 * (the real `countSessionHygiene`) and never pass this explicitly. A test hands in its own
 * function directly to exercise the core-failure boundary — no process-wide module mock, so this
 * file's tests cannot leak into any other suite that imports the same core. */
type CountFn = (text: string) => SessionHygieneCounts;

/** Reads one log file and counts it, or `null` when the file cannot be READ — logging a warning
 * to stderr rather than throwing, so one bad file never costs the whole measurement
 * (fail-closed-edges.md obligation 1). The catch is scoped to `readFileSync` ONLY: a failure from
 * the pure core is a different kind of problem (a bug, not an unreadable file) and must propagate
 * as itself rather than be relabeled "skipping unreadable file" — `main()`'s boundary is what
 * turns it into a clean refusal. */
export function countFileOrNull(path: string, count: CountFn = countSessionHygiene): SessionHygieneCounts | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`session-hygiene: skipping unreadable file ${path}: ${message}`);
    return null;
  }
  return count(text);
}

function accumulate(root: string, count: CountFn = countSessionHygiene): SessionHygieneCounts {
  const totals: SessionHygieneCounts = { unknownSkills: {}, filesystemWideScans: 0 };
  for (const path of walkLogFiles(root)) {
    const counts = countFileOrNull(path, count);
    if (counts === null) continue;
    totals.filesystemWideScans += counts.filesystemWideScans;
    for (const [name, c] of Object.entries(counts.unknownSkills)) {
      totals.unknownSkills[name] = (totals.unknownSkills[name] ?? 0) + c;
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

export function main(argv: readonly string[] = Bun.argv.slice(2), count: CountFn = countSessionHygiene): void {
  const options = parseArgsOrExit(argv);
  // A boundary around the actual measurement: anything that escapes `accumulate` (a walk error
  // that isn't a filesystem errno, or — see countFileOrNull above — a pure-core bug) must become
  // the same clean `session-hygiene: <message>` refusal the rest of this file already produces,
  // never a raw stack trace reaching a user-facing CLI (fail-closed-edges.md).
  let counts: SessionHygieneCounts;
  try {
    counts = accumulate(options.root, count);
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
