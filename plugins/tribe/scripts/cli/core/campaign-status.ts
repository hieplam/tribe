// core/campaign-status.ts — what `tribe campaign status` knows: how to read a campaign's two
// state files leniently, which campaign "latest" means, and the exact lines the user sees.
// Pure: no filesystem, no clock, no argv. Every outside fact — the files, the current time —
// arrives as an input, so the whole render runs in tests from literals (pure-core.md).

/** A parse either yields a value or refuses with the reason the CLI prints verbatim. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface StatusCard {
  status: string;
  pr: number | null;
  dependsOn: string[];
  /** Task entries whose `passedSha` is a non-empty string, of all entries the file records. */
  tasksPassed: number;
  tasksTotal: number;
}

export interface StatusState {
  campaign: string;
  sequence: string[];
  cards: Record<string, StatusCard>;
}

export interface StatusSupervisor {
  state: string;
  updatedAt: string;
  lastAction: string;
  currentSession: { kind: string; cardId: string | null; sessionId: string | null } | null;
  terminal: { status: string; reason: string } | null;
}

/** D4: a running supervisor quiet for longer than this is reported as possibly stuck. */
export const STALE_AFTER_MS = 600_000;

/** Q5: `--watch` re-renders on this fixed interval; there is no flag to change it. */
export const WATCH_INTERVAL_MS = 2_000;

const EM_DASH = '—';

/** Q1: lenient on purpose. Any `v` is accepted, unknown fields are ignored, and every field the
 * real files leave out or set to null gets its empty meaning — an absent `dependsOn` is no
 * dependencies, an absent `pr` is no PR. Only a field present with the wrong TYPE refuses,
 * because then the file says something this command cannot honestly render. */
export function parseCampaignState(raw: unknown): Parsed<StatusState> {
  const root = asObject(raw);
  if (root === null) return refuse('expected a JSON object');
  if (typeof root.campaign !== 'string') return refuse('campaign must be a string');
  if (!isStringArray(root.sequence)) return refuse('sequence must be an array of strings');
  const rawCards = asObject(root.cards);
  if (rawCards === null) return refuse('cards must be an object');

  const cards: Record<string, StatusCard> = {};
  for (const [id, rawCard] of Object.entries(rawCards)) {
    const card = asObject(rawCard);
    if (card === null) return refuse(`cards.${id} must be an object`);
    if (typeof card.status !== 'string') return refuse(`cards.${id}.status must be a string`);

    const pr = card.pr ?? null;
    if (pr !== null && typeof pr !== 'number') return refuse(`cards.${id}.pr must be a number or null`);

    const dependsOn = card.dependsOn ?? [];
    if (!isStringArray(dependsOn)) return refuse(`cards.${id}.dependsOn must be an array of strings`);

    const tasks = card.tasks ?? [];
    if (!Array.isArray(tasks)) return refuse(`cards.${id}.tasks must be an array or null`);

    cards[id] = {
      status: card.status,
      pr,
      dependsOn,
      tasksPassed: tasks.filter(isPassedTask).length,
      tasksTotal: tasks.length,
    };
  }

  return { ok: true, value: { campaign: root.campaign, sequence: root.sequence, cards } };
}

/** D2: a task counts as passed only once the runner has recorded the sha whose Done commands
 * passed. An entry with no `passedSha`, a null or empty one, or a null entry, counts in n only. */
function isPassedTask(entry: unknown): boolean {
  const task = asObject(entry);
  return task !== null && typeof task.passedSha === 'string' && task.passedSha !== '';
}

/** `supervisor/status.json`. `currentSession` and `terminal` are absent for most of a campaign's
 * life, and absent means the same as null here: no session running, not finished. */
export function parseSupervisorStatus(raw: unknown): Parsed<StatusSupervisor> {
  const root = asObject(raw);
  if (root === null) return refuse('expected a JSON object');
  if (typeof root.state !== 'string') return refuse('state must be a string');
  if (typeof root.lastAction !== 'string') return refuse('lastAction must be a string');
  if (typeof root.updatedAt !== 'string' || Number.isNaN(Date.parse(root.updatedAt))) {
    return refuse('updatedAt must be an ISO timestamp');
  }

  let currentSession: StatusSupervisor['currentSession'] = null;
  if ((root.currentSession ?? null) !== null) {
    const session = asObject(root.currentSession);
    if (session === null) return refuse('currentSession must be an object or null');
    if (typeof session.kind !== 'string') return refuse('currentSession.kind must be a string');
    const cardId = session.cardId ?? null;
    const sessionId = session.sessionId ?? null;
    if (cardId !== null && typeof cardId !== 'string') return refuse('currentSession.cardId must be a string or null');
    if (sessionId !== null && typeof sessionId !== 'string') return refuse('currentSession.sessionId must be a string or null');
    currentSession = { kind: session.kind, cardId, sessionId };
  }

  let terminal: StatusSupervisor['terminal'] = null;
  if ((root.terminal ?? null) !== null) {
    const done = asObject(root.terminal);
    if (done === null) return refuse('terminal must be an object or null');
    if (typeof done.status !== 'string') return refuse('terminal.status must be a string');
    if (typeof done.reason !== 'string') return refuse('terminal.reason must be a string');
    terminal = { status: done.status, reason: done.reason };
  }

  return { ok: true, value: { state: root.state, updatedAt: root.updatedAt, lastAction: root.lastAction, currentSession, terminal } };
}

/** Q2: with no name given, "the campaign I am working on" is the most recently updated one;
 * two updated in the same millisecond are settled by name so the answer is never arbitrary. */
export function pickLatest(campaigns: { name: string; updatedMs: number }[]): string | null {
  const ranked = [...campaigns].sort((a, b) => (b.updatedMs - a.updatedMs) || a.name.localeCompare(b.name));
  return ranked[0]?.name ?? null;
}

/** Floors to one unit, the way a person reads a duration: 59s, 1m, 59m, 1h. A negative age
 * (a state file written by a clock ahead of this one) reads as 0s rather than as the future. */
export function formatAge(ms: number): string {
  const age = Math.max(0, ms);
  if (age < 60_000) return `${Math.floor(age / 1_000)}s`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  return `${Math.floor(age / 3_600_000)}h`;
}

/** G1/G2/G4: the exact lines printed, in order. `supervisor` is null when the campaign has a
 * state file but no supervisor has run yet — the cards still render (Q4). */
export function renderStatus(input: {
  name: string;
  state: StatusState;
  supervisor: StatusSupervisor | null;
  nowMs: number;
}): string[] {
  const { name, state, supervisor, nowMs } = input;
  const ids = cardOrder(state);
  const shipped = ids.filter((id) => state.cards[id]?.status === 'shipped').length;

  const lines = [header(name, supervisor), `cards: ${shipped}/${ids.length} shipped`];
  for (const id of ids) {
    const card = state.cards[id];
    if (card === undefined) continue;
    const pr = card.pr === null ? `PR ${EM_DASH}` : `PR #${card.pr}`;
    // Waiting on the dependencies that have NOT shipped; a dependency this file never declares
    // as a card has not shipped either, so it is listed too.
    const waitingOn = card.dependsOn.filter((dep) => state.cards[dep]?.status !== 'shipped');
    const waiting = waitingOn.length === 0 ? EM_DASH : waitingOn.join(', ');
    lines.push(`  ${id}  ${card.status}  tasks ${card.tasksPassed}/${card.tasksTotal}  ${pr}  waiting on: ${waiting}`);
  }

  if (supervisor === null) return lines;

  const session = supervisor.currentSession;
  if (session !== null) {
    lines.push(`session: ${session.kind} ${session.cardId ?? '-'} ${session.sessionId ?? '-'}`);
  }

  const age = nowMs - Date.parse(supervisor.updatedAt);
  lines.push(`last action: ${supervisor.lastAction} (${formatAge(age)} ago)`);

  // D4: only a campaign still meant to be moving can be stuck. A finished one is quiet by design,
  // whether it says so in `state` or by carrying a `terminal` verdict.
  const stillRunning = supervisor.state !== 'terminal' && supervisor.terminal === null;
  if (stillRunning && age > STALE_AFTER_MS) {
    lines.push(`WARNING: possibly stuck ${EM_DASH} supervisor not updated for ${formatAge(age)}`);
  }

  return lines;
}

function header(name: string, supervisor: StatusSupervisor | null): string {
  if (supervisor === null) return `campaign ${name} ${EM_DASH} supervisor: not started`;
  const verdict = supervisor.terminal === null ? '' : ` (${supervisor.terminal.status}: ${supervisor.terminal.reason})`;
  return `campaign ${name} ${EM_DASH} ${supervisor.state}${verdict}`;
}

/** The planned order first, then every card the sequence does not mention, sorted, so a card
 * added out of band is still shown and the order never depends on JSON key order. */
function cardOrder(state: StatusState): string[] {
  const inSequence = state.sequence.filter((id) => id in state.cards);
  const rest = Object.keys(state.cards).filter((id) => !inSequence.includes(id)).sort();
  return [...inSequence, ...rest];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function refuse(reason: string): Parsed<never> {
  return { ok: false, reason };
}
