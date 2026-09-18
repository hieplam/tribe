import { classifyTrigger, isToolResultCarrier, userText } from './classify.ts';
import type { ClassMetrics, SessionMetrics, TokenSums, TriggerClass } from './model.ts';

/**
 * Pure turn accumulator for the context ratchet (spec §15, card `## Measure first`).
 *
 * Walks already-parsed transcript rows in order, holding the current trigger class and
 * a set of seen `message.id`s per lead/sidechain group. No clock, no fs, no throw — the
 * reading edge (Task 3) is the only thing that touches the outside world.
 *
 * Fields this function has no basis to fill (`sessionId`, `lines` beyond the row count,
 * `skippedLines`, `skippedReasons`, `firstAt`, `lastAt`) are edge-level facts about the raw
 * file this pure reducer never sees; they are left at their neutral defaults for the edge
 * to overwrite.
 */

const ALL_CLASSES: TriggerClass[] = ['human', 'monitor-event', 'monitor-expiry', 'task-notification'];

function zeroTokens(): TokenSums {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

function addTokens(a: TokenSums, b: TokenSums): TokenSums {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

function sumTokens(t: TokenSums): number {
  return t.input + t.cacheRead + t.cacheWrite + t.output;
}

function emptyPerClass(): Record<TriggerClass, ClassMetrics> {
  const out = {} as Record<TriggerClass, ClassMetrics>;
  for (const cls of ALL_CLASSES) out[cls] = { turns: 0, tokens: zeroTokens() };
  return out;
}

function usageOf(message: unknown): Record<string, unknown> {
  if (message === null || typeof message !== 'object') return {};
  const usage = (message as { usage?: unknown }).usage;
  return usage !== null && typeof usage === 'object' ? (usage as Record<string, unknown>) : {};
}

function numField(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' ? value : 0;
}

function messageIdOf(message: unknown): string | undefined {
  if (message === null || typeof message !== 'object') return undefined;
  const id = (message as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function countMonitorArms(message: unknown): number {
  if (message === null || typeof message !== 'object') return 0;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return 0;
  let arms = 0;
  for (const block of content) {
    if (block !== null && typeof block === 'object'
      && (block as { type?: unknown }).type === 'tool_use'
      && (block as { name?: unknown }).name === 'Monitor') {
      arms++;
    }
  }
  return arms;
}

export function accumulate(rows: unknown[]): SessionMetrics {
  let currentClass: TriggerClass = 'human';
  const leadSeen = new Set<string>();
  const sidechainSeen = new Set<string>();
  const perClass = emptyPerClass();

  let turns = 0;
  let tokens = zeroTokens();
  let firstContext = 0;
  let lastContext = 0;
  let maxContext = 0;
  let sawFirstTurn = false;
  let monitorArms = 0;
  let monitorExpiries = 0;
  let sidechainTurns = 0;
  let sidechainTokens = zeroTokens();

  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const type = (row as { type?: unknown }).type;
    const isSidechain = (row as { isSidechain?: unknown }).isSidechain === true;
    const message = (row as { message?: unknown }).message;

    if (type === 'user') {
      if (isToolResultCarrier(message)) continue; // never changes the trigger class
      currentClass = classifyTrigger(userText(message));
      if (currentClass === 'monitor-expiry') monitorExpiries++;
      continue;
    }

    if (type !== 'assistant') continue;

    const id = messageIdOf(message);
    const seen = isSidechain ? sidechainSeen : leadSeen;
    if (id !== undefined) {
      if (seen.has(id)) continue; // duplicate transcript line for the same API message
      seen.add(id);
    }

    monitorArms += countMonitorArms(message);

    const usage = usageOf(message);
    const t: TokenSums = {
      input: numField(usage, 'input_tokens'),
      cacheRead: numField(usage, 'cache_read_input_tokens'),
      cacheWrite: numField(usage, 'cache_creation_input_tokens'),
      output: numField(usage, 'output_tokens'),
    };
    const context = t.input + t.cacheRead + t.cacheWrite;

    if (isSidechain) {
      sidechainTurns++;
      sidechainTokens = addTokens(sidechainTokens, t);
      continue; // sidechain (subagent) turns are excluded from lead totals
    }

    turns++;
    tokens = addTokens(tokens, t);
    perClass[currentClass].turns++;
    perClass[currentClass].tokens = addTokens(perClass[currentClass].tokens, t);

    if (!sawFirstTurn) {
      firstContext = context;
      sawFirstTurn = true;
    }
    lastContext = context;
    if (context > maxContext) maxContext = context;
  }

  const totalTokens = sumTokens(tokens);
  const monitorTokens = sumTokens(perClass['monitor-event'].tokens) + sumTokens(perClass['monitor-expiry'].tokens);
  const babysittingShare = totalTokens > 0 ? monitorTokens / totalTokens : 0;

  return {
    sessionId: '',
    lines: rows.length,
    skippedLines: 0,
    skippedReasons: [],
    turns,
    tokens,
    perClass,
    firstContext,
    lastContext,
    maxContext,
    monitorArms,
    monitorExpiries,
    firstAt: '',
    lastAt: '',
    babysittingShare,
    sidechain: { turns: sidechainTurns, tokens: sidechainTokens },
  };
}
