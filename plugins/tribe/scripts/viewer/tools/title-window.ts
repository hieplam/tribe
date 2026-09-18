/**
 * tools/title-window.ts — a read-only corpus measurement for spec §5.3's assumption, NOT runtime
 * code (D18): `tools/` sits outside the D16 purity wall, is never imported by any file under
 * `core/`, `adapters/`, `serve.ts` or `client/src/**`, and touches the filesystem freely — that is
 * exactly what a one-off measurement script is for.
 *
 * It reads every real session file under the resolved projects root twice: once through the
 * bounded head+tail WINDOW spec §5.3 proposes for production, and once as the WHOLE file (the
 * baseline nothing can disagree with, short of a bug in the resolver itself). Both reads go
 * through the same pure `core/title.ts#resolveTitle` — this measures the WINDOW's fidelity, not a
 * second title implementation that could quietly drift from the real one.
 *
 * Usage:
 *   bun tools/title-window.ts --head <bytes> --tail <bytes>
 *
 * Prints `matched/total` — the number of session files where the windowed title agrees with the
 * whole-file title, out of every session file found. The acceptance threshold (spec §5.3) is
 * >= 180/181 measured at spec-writing time; this script re-measures against whatever is on disk
 * right now (the corpus is live and grows — plan.md "Global Constraints").
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { completeLines } from '../core/window.ts';
import { resolveTitle } from '../core/title.ts';

function parseArgs(argv: string[]): { head: number; tail: number } {
  let head = 65536;
  let tail = 262144;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--head' && i + 1 < argv.length) {
      head = Number(argv[++i]);
    } else if (argv[i] === '--tail' && i + 1 < argv.length) {
      tail = Number(argv[++i]);
    }
  }
  if (!Number.isFinite(head) || head <= 0) throw new Error(`--head must be a positive number, got ${head}`);
  if (!Number.isFinite(tail) || tail <= 0) throw new Error(`--tail must be a positive number, got ${tail}`);
  return { head, tail };
}

function resolveProjectsRoot(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const home = process.env.HOME ?? '';
  const base = configDir && configDir.length > 0 ? configDir : join(home, '.claude');
  return join(base, 'projects');
}

/** Direct `*.jsonl` children of each project directory — the session files. Subagent transcripts
 * live one level deeper, under `<projectDir>/<sessionId>/subagents/`, so this listing already
 * excludes them without any extra filter. */
function listSessionFiles(projectsRoot: string): string[] {
  const out: string[] = [];
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot);
  } catch {
    return out;
  }
  for (const projectDir of projectDirs) {
    const projectPath = join(projectsRoot, projectDir);
    if (!statSync(projectPath).isDirectory()) continue;
    for (const entry of readdirSync(projectPath)) {
      if (!entry.endsWith('.jsonl')) continue;
      const entryPath = join(projectPath, entry);
      if (statSync(entryPath).isFile()) out.push(entryPath);
    }
  }
  return out;
}

function sessionIdOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.slice(0, -'.jsonl'.length);
}

function measureOne(path: string, headBytes: number, tailBytes: number): boolean {
  const bytes = readFileSync(path);
  const sessionId = sessionIdOf(path);

  const whole = completeLines(bytes, false);
  const wholeTitle = resolveTitle(whole, whole, sessionId);

  const head = completeLines(bytes.subarray(0, Math.min(headBytes, bytes.length)), false);
  const tailStart = Math.max(0, bytes.length - tailBytes);
  const tail = completeLines(bytes.subarray(tailStart, bytes.length), true);
  const windowedTitle = resolveTitle(head, tail, sessionId);

  return windowedTitle.title === wholeTitle.title && windowedTitle.titleSource === wholeTitle.titleSource;
}

function main(): void {
  const { head, tail } = parseArgs(process.argv.slice(2));
  const projectsRoot = resolveProjectsRoot();
  const files = listSessionFiles(projectsRoot);

  let matched = 0;
  for (const file of files) {
    try {
      if (measureOne(file, head, tail)) matched += 1;
    } catch (err) {
      // A file that cannot even be read/stat'd is not a match — it counts against the total, the
      // same as a genuine title disagreement would.
      console.error(`skipping ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`${matched}/${files.length}`);
}

main();
