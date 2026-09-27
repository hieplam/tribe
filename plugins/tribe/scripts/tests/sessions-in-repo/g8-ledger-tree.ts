// g8-ledger-tree.ts — G8's oracle (card supervisor-sessions-in-repo, spec §4.4 and §5 row G8).
//
// G8 asks: can the campaign's session tree be redrawn from `supervisor/ledger.jsonl` alone? This
// tool answers it by scoring a CLAIMED tree (the ledger's rows, or an LLM's drawing of them)
// against the TRUTH on disk (the session log filenames and the SDK's `subagents/*.meta.json`).
//
// Shape (pure-core.md): `scoreTree`, `treeFromLedgerLines` and `treeFromLlmText` are PURE — they
// take text and return data, touch no disk, no clock, no global. `truthFromDisk` and `main` are
// the thin impure EDGE.
//
// Containment (fail-closed-edges.md, obligation 4): every filesystem path below is built from
// argv plus names returned by `readdirSync`. NOTHING here opens a path taken from a file's
// CONTENT — `parentAgentId`, read out of a meta file, is used only as a Map value.
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A session tree: every session's id, plus `child -> parent` for each non-root. Roots (a session
 *  started by a process, not by another session) simply have no entry in `edges`. */
export interface Tree {
  sessions: Set<string>;
  edges: Map<string, string>;
}

export interface Score {
  /** `truth.sessions.size` — the denominator for `present`. */
  total: number;
  /** How many of the truth's sessions the claimed tree names. */
  present: number;
  /** `truth.edges.size` — the denominator for `edgesCorrect`. */
  edgesTotal: number;
  /** How many of the truth's edges the claimed tree gets EXACTLY right. */
  edgesCorrect: number;
  /** Claimed ids the truth does not know (hallucinated, or a session outside this campaign). */
  extra: string[];
  /** Truth ids the claimed tree never names. */
  missing: string[];
  /** Diagnostics only — never counted. Each truth edge the claim gets wrong, plus each claimed
   *  edge hung off a session the truth knows as a root. */
  wrongEdges: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---------------------------------------------------------------------------- pure core

/**
 * PURE. Score `claimed` against `truth`.
 *
 * An edge counts only on an EXACT parent match. That is the whole point of the comparator: a
 * depth-2 subagent whose claimed parent is the root — the shape a writer that records ids but no
 * real parents produces — is a WRONG edge here, never a correct one (spec §5, G8's "a writer that
 * records ids but no parents scores edgesCorrect = 0").
 */
export function scoreTree(truth: Tree, claimed: Tree): Score {
  const missing: string[] = [];
  let present = 0;
  for (const id of truth.sessions) {
    if (claimed.sessions.has(id)) present += 1;
    else missing.push(id);
  }

  const extra: string[] = [];
  for (const id of claimed.sessions) {
    if (!truth.sessions.has(id)) extra.push(id);
  }

  let edgesCorrect = 0;
  const wrongEdges: string[] = [];
  for (const [child, parent] of truth.edges) {
    const claimedParent = claimed.edges.get(child);
    if (claimedParent === parent) edgesCorrect += 1;
    else wrongEdges.push(`${child} claimed=${claimedParent ?? 'none'} truth=${parent}`);
  }
  for (const [child, claimedParent] of claimed.edges) {
    // The truth knows this session, and knows it as a root: the claim invented a parent for it.
    if (truth.sessions.has(child) && !truth.edges.has(child)) {
      wrongEdges.push(`${child} claimed=${claimedParent} truth=root`);
    }
  }

  return {
    total: truth.sessions.size,
    present,
    edgesTotal: truth.edges.size,
    edgesCorrect,
    extra: extra.sort(),
    missing: missing.sort(),
    wrongEdges: wrongEdges.sort(),
  };
}

/**
 * PURE. The tree the ledger claims, one JSON object per line.
 *
 * Only a `event: "spawn"` row claims a parent. A legacy row (no `event` at all) and an end row
 * (`event: "end"`) prove the session existed but carry no parent information, so each contributes
 * a session and NEVER an edge (spec §4.4: "Legacy rows without `event` are read as end rows").
 * A row whose `sessionId` is null — today's attribution gap — and a malformed line are skipped;
 * this function never throws.
 */
export function treeFromLedgerLines(lines: string[]): Tree {
  const sessions = new Set<string>();
  const edges = new Map<string, string>();

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // malformed line: skipped, exactly as the viewer and the writers do
    }
    if (!isRecord(row)) continue;
    if (typeof row.sessionId !== 'string' || row.sessionId.length === 0) continue;
    const sessionId = row.sessionId;
    sessions.add(sessionId);
    if (row.event !== 'spawn') continue;
    // `parentSessionId: null` means a root — and it also means `parentUnresolved: true`, the row
    // that refuses to guess. Either way: no edge, which is what the score should see.
    if (typeof row.parentSessionId === 'string' && row.parentSessionId.length > 0) {
      edges.set(sessionId, row.parentSessionId);
    }
  }
  return { sessions, edges };
}

const ROOT_LINE = /^ROOT\s+(\S+)$/;
const EDGE_LINE = /^EDGE\s+(\S+)\s+(\S+)$/;

/**
 * PURE. The tree an LLM drew: `ROOT <id>` and `EDGE <child> <parent>` lines; every other line
 * (prose, preamble, blank) is ignored.
 *
 * An `EDGE` line's parent is a REFERENCE, not a declaration, so it is never added to `sessions`:
 * whether it names a real session is judged by the edge comparison in `scoreTree`. That keeps a
 * placeholder token (`none`, `null`, `-`) from being credited as a session or counted as `extra`.
 */
export function treeFromLlmText(text: string): Tree {
  const sessions = new Set<string>();
  const edges = new Map<string, string>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const root = ROOT_LINE.exec(line);
    if (root) {
      sessions.add(root[1] as string);
      continue;
    }
    const edge = EDGE_LINE.exec(line);
    if (!edge) continue;
    const child = edge[1] as string;
    sessions.add(child);
    edges.set(child, edge[2] as string);
  }
  return { sessions, edges };
}

// ---------------------------------------------------------------------------- impure edge

/** Both `<card>-<uuid>.log` (an executor run log) and `<uuid>.log` (a supervisor session log).
 *  `unattributed.log` does not match, so it needs no special case. */
const SESSION_LOG = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.log$/;
/** `agent-<agentId>.meta.json`; the agent id comes from this FILENAME, never from file content. */
const AGENT_META = /^agent-([0-9A-Za-z_-]+)\.meta\.json$/;

/** A directory listing, or `[]` when the directory is absent or unreadable. */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * The parent this subagent really had: `parentAgentId` when its meta file records one (a subagent
 * spawned by another subagent, depth >= 2), else the root session whose transcript folder holds it
 * (depth 1). An unreadable or malformed meta file still yields the root — the FILE's existence is
 * the evidence that the session ran, and losing it would make the truth too small.
 */
function parentOfSubagent(metaPath: string, rootSessionId: string): string {
  let raw: string;
  try {
    raw = readFileSync(metaPath, 'utf8');
  } catch {
    return rootSessionId;
  }
  let meta: unknown;
  try {
    meta = JSON.parse(raw);
  } catch {
    return rootSessionId; // narrow: JSON.parse on a string throws only SyntaxError
  }
  if (isRecord(meta) && typeof meta.parentAgentId === 'string' && meta.parentAgentId.length > 0) {
    return meta.parentAgentId;
  }
  return rootSessionId;
}

/**
 * EDGE. The truth: every session this campaign really ran, and who really spawned it.
 *
 * Roots are the session log FILENAMES under `<home>/runs/*​/logs/` (executors) and
 * `<home>/supervisor/sessions/` (ruling/ratify/closing). Subagents are the SDK's own record,
 * `<projects>/*​/<root>/subagents/agent-<id>.meta.json` — scanned only under folders named by a
 * root this campaign owns, so another campaign's subagents can never leak into the denominator.
 */
export function truthFromDisk(home: string, projectsRoot: string): Tree {
  const sessions = new Set<string>();
  const edges = new Map<string, string>();

  const addRoot = (fileName: string): void => {
    const match = SESSION_LOG.exec(fileName);
    if (match) sessions.add(match[1] as string);
  };
  const runsDir = join(home, 'runs');
  for (const run of listDir(runsDir)) {
    for (const file of listDir(join(runsDir, run, 'logs'))) addRoot(file);
  }
  for (const file of listDir(join(home, 'supervisor', 'sessions'))) addRoot(file);

  const roots = new Set(sessions);
  for (const project of listDir(projectsRoot)) {
    const projectDir = join(projectsRoot, project);
    for (const entry of listDir(projectDir)) {
      if (!roots.has(entry)) continue;
      const subagentsDir = join(projectDir, entry, 'subagents');
      for (const file of listDir(subagentsDir)) {
        const match = AGENT_META.exec(file);
        if (!match) continue;
        const agentId = match[1] as string;
        sessions.add(agentId);
        edges.set(agentId, parentOfSubagent(join(subagentsDir, file), entry));
      }
    }
  }
  return { sessions, edges };
}

class UsageError extends Error {}

interface Args {
  home: string;
  projects: string;
  llm: string | null;
}

/** A flag whose value is missing refuses, and never swallows the next flag as its value
 *  (fail-closed-edges.md, obligation 1). */
function valueOf(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

function parseArgs(argv: string[]): Args {
  const home = valueOf(argv, '--home');
  if (!home) throw new UsageError('usage: g8-ledger-tree.ts --home <campaign home> [--projects <dir>] [--llm <file>]');
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const claudeDir = configDir && configDir.length > 0 ? configDir : join(homedir(), '.claude');
  return { home, projects: valueOf(argv, '--projects') ?? join(claudeDir, 'projects'), llm: valueOf(argv, '--llm') ?? null };
}

function readTextOrRefuse(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new UsageError(`unreadable ${what}: ${path}: ${(err as Error).message}`);
  }
}

function main(argv: string[]): number {
  let args: Args;
  let ledgerText: string;
  let llmText: string | null;
  try {
    args = parseArgs(argv);
    // A missing ledger is a refusal, not a score of zero: scoring a file that is not there would
    // print a measurement nobody made.
    ledgerText = readTextOrRefuse(join(args.home, 'supervisor', 'ledger.jsonl'), 'ledger');
    llmText = args.llm === null ? null : readTextOrRefuse(args.llm, 'LLM output');
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const truth = truthFromDisk(args.home, args.projects);
  console.log(
    JSON.stringify({
      truth: { sessions: truth.sessions.size, edges: truth.edges.size },
      ledger: scoreTree(truth, treeFromLedgerLines(ledgerText.split('\n'))),
      llm: llmText === null ? null : scoreTree(truth, treeFromLlmText(llmText)),
    }),
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
