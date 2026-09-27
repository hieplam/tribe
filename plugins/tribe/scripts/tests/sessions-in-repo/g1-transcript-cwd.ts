// g1-transcript-cwd.ts — G1 measurement tool (card supervisor-sessions-in-repo, spec §5).
// EDGE: every read is from disk (session logs, SDK transcripts, the ledger) or argv; the tool
// never crashes on hostile input — a missing argument or an unreadable home is a typed refusal
// (fail-closed-edges.md). Nothing below constructs a filesystem path from file CONTENT: the
// session id that names a transcript file comes from a `.log` FILENAME (a directory listing),
// never from a value read out of a file's bytes.
import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';

const TRANSCRIPT_HEAD_BYTES = 64 * 1024;

interface Args {
  home: string;
  repo: string;
  projects: string;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Args {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const home = valueOf('--home');
  const repo = valueOf('--repo');
  if (!home || !repo) {
    throw new UsageError(
      'usage: g1-transcript-cwd.ts --home <campaign home> --repo <repo root> [--projects <dir>]',
    );
  }
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const projects =
    valueOf('--projects') ?? join(configDir && configDir.length > 0 ? configDir : join(homedir(), '.claude'), 'projects');
  return { home, repo, projects };
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Parse each line of `text` as JSON; a malformed line is skipped, never thrown. */
function parseJsonLines(text: string): unknown[] {
  const rows: unknown[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // malformed line: skip
    }
  }
  return rows;
}

/** The first `maxBytes` bytes of a file, decoded as UTF-8 (a trailing partial line, if any, is
 * malformed JSON and gets skipped by parseJsonLines — that is the intended behaviour, not a bug). */
function readHeadBytes(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

/** The session log's own recorded cwd: the first row with type 'system'/subtype 'init'. */
function logCwd(logPath: string): string | null {
  const rows = parseJsonLines(readFileSync(logPath, 'utf8'));
  for (const row of rows) {
    if (isRecord(row) && row.type === 'system' && row.subtype === 'init' && typeof row.cwd === 'string') {
      return row.cwd;
    }
  }
  return null;
}

/** The SDK transcript's cwd: the first `"cwd"` field found within the first 64 KiB. */
function transcriptCwd(transcriptPath: string): string | null {
  const rows = parseJsonLines(readHeadBytes(transcriptPath, TRANSCRIPT_HEAD_BYTES));
  for (const row of rows) {
    if (isRecord(row) && typeof row.cwd === 'string') return row.cwd;
  }
  return null;
}

/** `<projectsRoot>/*<sessionId>.jsonl`, found by a two-level readdirSync — never a path built
 * from file content: `sessionId` is the caller's `.log` filename, `projectsRoot` is an argv value. */
function findTranscriptPath(projectsRoot: string, sessionId: string): string | null {
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }
  const target = `${sessionId}.jsonl`;
  for (const dirName of projectDirs) {
    const dirPath = join(projectsRoot, dirName);
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }
    if (files.includes(target)) return join(dirPath, target);
  }
  return null;
}

/** The session kind, from any ledger row that carries this sessionId and a kind; `?` when none does. */
function kindOf(ledgerPath: string, sessionId: string): string {
  let rows: unknown[];
  try {
    rows = parseJsonLines(readFileSync(ledgerPath, 'utf8'));
  } catch {
    return '?';
  }
  for (const row of rows) {
    if (isRecord(row) && row.sessionId === sessionId && typeof row.kind === 'string') return row.kind;
  }
  return '?';
}

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const sessionsDir = join(args.home, 'supervisor', 'sessions');
  let ids: string[];
  try {
    ids = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.log') && f !== 'unattributed.log')
      .map((f) => f.slice(0, -'.log'.length))
      .sort();
  } catch (err) {
    process.stderr.write(`unreadable home: cannot read ${sessionsDir}: ${(err as Error).message}\n`);
    return 2;
  }

  const repoReal = realpathOrSelf(args.repo);
  const ledgerPath = join(args.home, 'supervisor', 'ledger.jsonl');
  const kinds = new Set<string>();
  let passed = 0;

  for (const id of ids) {
    const log = logCwd(join(sessionsDir, `${id}.log`));
    const transcriptPath = findTranscriptPath(args.projects, id);
    const transcript = transcriptPath ? transcriptCwd(transcriptPath) : null;
    const kind = kindOf(ledgerPath, id);
    kinds.add(kind);

    const pass = log !== null && transcript !== null && realpathOrSelf(log) === repoReal && realpathOrSelf(transcript) === repoReal;
    if (pass) passed += 1;
    console.log(`${id} ${kind} log=${log ?? '?'} transcript=${transcript ?? '?'} ${pass ? 'PASS' : 'FAIL'}`);
  }

  console.log(`G1 ${passed}/${ids.length} kinds=${[...kinds].sort().join(',')}`);
  return 0;
}

process.exit(main());
