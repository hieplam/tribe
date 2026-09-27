// core/ledger.ts — the campaign's session tree, as rows (card supervisor-sessions-in-repo, spec §4.4).
// PURE: messages and the clock value come in as arguments; writing a row is the caller's appendLog.
import type { SessionMessage } from './session.ts';

export type SpawnKind = 'executor' | 'ruling' | 'ratify' | 'closing' | 'subagent';
export interface SpawnRow {
  at: string; event: 'spawn'; kind: SpawnKind;
  sessionId: string;              // this session's own id: SDK session_id, or a subagent's agent id
  parentSessionId: string | null; // null = a root: started by a process, not by a session
  parentUnresolved?: true;        // the spawning Agent call never appeared in the stream
  rootSessionId: string;          // whose transcript folder holds it
  agentType: string | null; cardId: string | null; resumed?: boolean;
}
export interface SpawnTracker {
  rootSessionId: string; cardId: string | null;
  callerOfToolUse: Readonly<Record<string, string | null>>; // Agent tool_use id -> the tool_use id of the subagent that issued it (null = main thread)
  agentOfToolUse: Readonly<Record<string, string>>;          // Agent tool_use id -> the agent id it started
}

/** The tool names that start a subagent session. Both spellings appear in real streams. */
const AGENT_TOOL_NAMES = ['Agent', 'Task'];

/** The only `task_type` that is a session. `local_bash` (and any other type) is a task the model
 * runs inside an existing session, so it gets no row — over-filtering a non-agent task is by
 * design (plan Oracle); dropping a `local_agent` is a bug. */
const AGENT_TASK_TYPE = 'local_agent';

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function emptySpawnTracker(rootSessionId: string, cardId: string | null): SpawnTracker {
  return { rootSessionId, cardId, callerOfToolUse: {}, agentOfToolUse: {} };
}

/** The row for a session a PROCESS started (executor, ruling, ratify, closing): it has no parent
 * session and is its own root. `resumed` is written only when the caller supplies it, so a
 * first-run row carries no `resumed` key at all. */
export function rootSpawnRow(params: {
  kind: SpawnKind; sessionId: string; cardId: string | null; at: string; resumed?: boolean;
}): SpawnRow {
  return {
    at: params.at,
    event: 'spawn',
    kind: params.kind,
    sessionId: params.sessionId,
    parentSessionId: null,
    rootSessionId: params.sessionId,
    agentType: null,
    cardId: params.cardId,
    ...(params.resumed === undefined ? {} : { resumed: params.resumed }),
  };
}

/** Every `Agent`/`Task` call in one assistant message: its `tool_use` id -> the tool_use id of the
 * subagent that issued it, `null` when the main thread issued it.
 *
 * This is the ONLY place the parent edge exists at depth >= 2 (spec §3.1 M1, MEASURED): the
 * `SubagentStart` hook's payload carries no parent agent id, and the on-disk `meta.json` that does
 * is absent while the hook runs. So the edge is read off the message stream, here. */
function agentCallsIn(message: SessionMessage): Record<string, string | null> {
  const body = message.message;
  if (!isRecord(body)) return {};
  const content = body.content;
  if (!Array.isArray(content)) return {};
  const issuer = stringOrNull(message.parent_tool_use_id); // absent or null = the main thread
  const calls: Record<string, string | null> = {};
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (stringOrNull(block.type) !== 'tool_use') continue;
    const toolName = stringOrNull(block.name);
    if (toolName === null || !AGENT_TOOL_NAMES.includes(toolName)) continue;
    const toolUseId = stringOrNull(block.id);
    if (toolUseId === null) continue;
    calls[toolUseId] = issuer;
  }
  return calls;
}

/** Reduces ONE SDK message into the next tracker plus the rows it produced (none, or one subagent
 * row). Returns new objects — the caller's tracker is never mutated, so a replay of the same
 * message twice from the same tracker yields the same answer. */
export function observeSpawns(
  tracker: SpawnTracker,
  message: SessionMessage,
  at: string,
): { tracker: SpawnTracker; rows: SpawnRow[] } {
  const next: SpawnTracker = {
    rootSessionId: tracker.rootSessionId,
    cardId: tracker.cardId,
    callerOfToolUse: { ...tracker.callerOfToolUse },
    agentOfToolUse: { ...tracker.agentOfToolUse },
  };

  if (message.type === 'assistant') {
    // An Agent call only records WHO called it; the session it starts appears later, as task_started.
    next.callerOfToolUse = { ...tracker.callerOfToolUse, ...agentCallsIn(message) };
    return { tracker: next, rows: [] };
  }

  const isTaskStarted = message.type === 'system' && message.subtype === 'task_started';
  if (!isTaskStarted) return { tracker: next, rows: [] };
  if (stringOrNull(message.task_type) !== AGENT_TASK_TYPE) return { tracker: next, rows: [] };

  const agentId = stringOrNull(message.task_id);       // the new session's own id
  const toolUseId = stringOrNull(message.tool_use_id); // the Agent call that started it
  if (agentId === null || toolUseId === null) return { tracker: next, rows: [] };
  next.agentOfToolUse = { ...tracker.agentOfToolUse, [toolUseId]: agentId };

  // The Agent call is known only if its assistant message came earlier in THIS stream; a resumed
  // or truncated stream can start after it, which is what `parentUnresolved` records.
  const callHasBeenSeen = Object.hasOwn(tracker.callerOfToolUse, toolUseId);
  const callerToolUse = callHasBeenSeen ? tracker.callerOfToolUse[toolUseId] : undefined;
  const issuedByMainThread = callHasBeenSeen && callerToolUse === null;
  const spawningAgentId =
    typeof callerToolUse === 'string' && Object.hasOwn(tracker.agentOfToolUse, callerToolUse)
      ? tracker.agentOfToolUse[callerToolUse]
      : null; // the caller's own agent id, when its own task_started came earlier in the stream
  const spawnDepth = typeof message.spawn_depth === 'number' ? message.spawn_depth : null;

  let parentSessionId: string | null;
  let parentUnresolved = false;
  if (issuedByMainThread) {
    parentSessionId = tracker.rootSessionId;
  } else if (spawningAgentId !== null) {
    parentSessionId = spawningAgentId;
  } else if (spawnDepth === 1) {
    // Depth 1 has only one possible parent — the root — so this is derived, not guessed.
    parentSessionId = tracker.rootSessionId;
  } else {
    parentSessionId = null;
    parentUnresolved = true; // deeper than 1 and the caller is unknown: a parent is NEVER guessed.
  }

  const row: SpawnRow = {
    at,
    event: 'spawn',
    kind: 'subagent',
    sessionId: agentId,
    parentSessionId,
    ...(parentUnresolved ? { parentUnresolved: true as const } : {}),
    rootSessionId: tracker.rootSessionId,
    agentType: stringOrNull(message.subagent_type),
    cardId: tracker.cardId,
  };
  return { tracker: next, rows: [row] };
}
