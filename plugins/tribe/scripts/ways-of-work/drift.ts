// drift.ts — the thin impure edge of the ways-of-work drift counter (card
// ways-of-work-consolidation, G1). It lists the repo's tracked files with git, reads each one, and
// hands the texts to the PURE `findPlaces` (drift-core.ts), where every decision lives.
//
//   bun plugins/tribe/scripts/ways-of-work/drift.ts --repo <dir> [--also <file>]... [--json] [--verbose]
//
// This is a MEASUREMENT, not a gate: a completed scan exits 0 whatever it counts. Usage errors, a
// failed `git ls-files`, and an unreadable `--also` file refuse with a message and exit 2
// (fail-closed-edges.md): a scan that silently read nothing must never look like a clean one.
// `--also` adds a file outside the repo — the installed ~/.claude/CLAUDE.md, whose text comes from
// the plugin's claude-md snippet — scanned whole, never allowlisted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPlaces, renderReport, type DriftPolicy, type FileText } from './drift-core.ts';

/** The one definition, and the paths never scanned. The allowlist is the card's G1 row (history
 * and evidence) plus two data kinds: eval rubrics, which must state the behavior they grade, and
 * this counter's own signals and fixtures. */
export const POLICY: DriftPolicy = {
  canonicalPath: 'plugins/tribe/agents/shaman.md',
  canonicalHeading: 'Ways of work',
  allowPrefixes: [
    'docs/tribe/planning/',
    'docs/superpowers/',
    '.c3/adr/',
    '.c3/changes/',
    'archive/',
    'scripts/evals/baselines/',
    'plugins/tribe/evals/',
    'plugins/tribe/scripts/ways-of-work/',
  ],
};

class DriftUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriftUsageError';
  }
}

interface Options {
  repo: string;
  also: string[];
  json: boolean;
  verbose: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { repo: '', also: [], json: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--json') options.json = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--repo' || arg === '--also') {
      const value = argv[i + 1];
      // A flag whose value is missing, or is itself a flag, refuses rather than consuming it.
      if (value === undefined || value.startsWith('--')) throw new DriftUsageError(`${arg} needs a value`);
      if (arg === '--repo') options.repo = value;
      else options.also.push(value);
      i++;
    } else throw new DriftUsageError(`unknown argument: ${arg}`);
  }
  if (options.repo === '') throw new DriftUsageError('usage: drift.ts --repo <dir> [--also <file>]... [--json] [--verbose]');
  return options;
}

/** Tracked files of the repo, via `git ls-files -z`. Bounded, and isolated from host git config. */
function trackedFiles(repo: string): string[] {
  const proc = Bun.spawnSync(['git', '-C', repo, 'ls-files', '-z'], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  if (proc.exitCode !== 0) throw new DriftUsageError(`git ls-files failed in ${repo}: ${proc.stderr.toString().trim()}`);
  return proc.stdout.toString().split('\0').filter((p) => p !== '');
}

/** A tracked file's text, or null when it is binary or cannot be read (deleted in the working tree,
 * permission denied). Skipped files are named on stderr, never silently dropped. */
function readText(path: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    console.error(`drift: skipped ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (bytes.includes(0)) return null; // binary: no prose rules live here
  return bytes.toString('utf8');
}

export function main(argv: readonly string[] = Bun.argv.slice(2)): number {
  let options: Options;
  let files: FileText[];
  try {
    options = parseArgs(argv);
    files = [];
    for (const path of trackedFiles(options.repo)) {
      const text = readText(join(options.repo, path));
      if (text !== null) files.push({ path, text });
    }
    for (const path of options.also) {
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch (err) {
        throw new DriftUsageError(`--also ${path} is unreadable: ${err instanceof Error ? err.message : String(err)}`);
      }
      files.push({ path, text });
    }
  } catch (err) {
    if (err instanceof DriftUsageError) {
      console.error(`drift: ${err.message}`);
      return 2;
    }
    throw err;
  }
  const report = findPlaces(files, POLICY);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(renderReport(report));
    if (options.verbose) for (const place of report.places) for (const hit of place.hits) console.log(`  ${place.path}:${hit.line} [${hit.signal}] ${hit.text}`);
  }
  return 0;
}

if (import.meta.main) process.exit(main());
