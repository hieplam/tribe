// The supervisor's own persisted counters (`<home>/supervisor/state.json`, spec §4/§7/§11).
// Pure module: no `fs`, no `child_process`, no clock, no throw for malformed input. The caller
// (a later task's `SupervisorIO`) reads the file and hands its already-parsed JSON in here — or
// `null` when the file does not exist yet, which parses to the zero state exactly the same way
// `campaign-state.json` does not exist before a campaign's first tick.
//
// Deliberately DOES NOT mirror `core/state.ts`'s throw-based refusal (`UnsupportedStateVersionError`
// etc.): an unknown version here is a TYPED RESULT to route on (Task 10's own oracle), not an
// exception for a caller to catch. `decide.ts` never sees a raw state file — only the loop's edge
// (a later task) reads one, and it can route `{ kind: 'unsupported_version' }` to a park exactly
// like any other typed disk fact, with no try/catch needed at all.
import type { SupervisorState } from './model.ts';

/** The only major version this module understands today (mirrors `core/state.ts`'s
 * `CURRENT_STATE_VERSION` naming). */
export const CURRENT_SUPERVISOR_STATE_VERSION = 1;

/** Spec §4/§7: every counter starts at zero, every map empty — the state a campaign has before
 * its first tick, and what an absent `<home>/supervisor/state.json` parses to. */
export function zeroState(): SupervisorState {
  return {
    rulingRounds: {},
    ratifyRounds: 0,
    spawns: 0,
    watchdogRuns: 0,
    seenEscalations: {},
    closingVerified: false,
    retriggers: {},
  };
}

export type ParseStateResult =
  | { kind: 'ok'; state: SupervisorState }
  | { kind: 'unsupported_version'; version: unknown };

/** `raw` is the already-parsed file contents (`JSON.parse`'d by the caller — this module never
 * touches `fs`), or `null` when the file is absent. An absent file parses to `zeroState()`; a
 * file whose `v` is not `CURRENT_SUPERVISOR_STATE_VERSION` (including a missing `v` field) is a
 * typed refusal, never thrown — see the module doc comment for why this differs from
 * `core/state.ts`'s throw-based `parseState`. A well-formed v1 file is read back field-by-field
 * (no unknown-field passthrough is needed: unlike `campaign-state.json`, nothing else ever
 * hand-authors this file, so there is no forward-compat surface to preserve). */
export function parseState(raw: unknown): ParseStateResult {
  if (raw === null) return { kind: 'ok', state: zeroState() };

  const version = (raw as { v?: unknown } | null)?.v;
  if (version !== CURRENT_SUPERVISOR_STATE_VERSION) {
    return { kind: 'unsupported_version', version };
  }

  const obj = raw as Partial<SupervisorState>;
  return {
    kind: 'ok',
    state: {
      rulingRounds: { ...(obj.rulingRounds ?? {}) },
      ratifyRounds: obj.ratifyRounds ?? 0,
      spawns: obj.spawns ?? 0,
      watchdogRuns: obj.watchdogRuns ?? 0,
      seenEscalations: { ...(obj.seenEscalations ?? {}) },
      closingVerified: obj.closingVerified ?? false,
      retriggers: { ...(obj.retriggers ?? {}) },
    },
  };
}

/** Spec §8's repeat-escalation breaker + §7 (W7 made mechanical): the ONE outcome this module
 * knows how to apply today — a `ruling` session about to be spawned for `cardId` (S-P6: the round
 * increments BEFORE the spawn, so a crash over-counts rather than under-counts — see
 * `core/supervisor/decide.ts`'s row 9/10 reads of these exact two fields). Returns a NEW state
 * (the input is never mutated, matching `core/state.ts`'s `resetCard` precedent) with:
 *  - `rulingRounds[cardId]` incremented by one (absent -> 1), and
 *  - `escalationSha256` appended to `seenEscalations[cardId]` (absent -> `[hash]`).
 * `state.ts` applies exactly this one typed transform and nothing else — it never decides
 * WHETHER a ruling should be spawned (that is `decide.ts`'s row 9/10/12, §3.4). */
export function applyRulingOutcome(
  state: SupervisorState,
  cardId: string,
  escalationSha256: string,
): SupervisorState {
  const priorRound = state.rulingRounds[cardId] ?? 0;
  const priorSeen = state.seenEscalations[cardId] ?? [];
  return {
    ...state,
    rulingRounds: { ...state.rulingRounds, [cardId]: priorRound + 1 },
    seenEscalations: { ...state.seenEscalations, [cardId]: [...priorSeen, escalationSha256] },
  };
}

/** Serializes state back to the exact JSON shape `parseState` reads, stamped with the current
 * version — mirrors `core/state.ts`'s `serializeState` (two-space indent, trailing newline). */
export function serializeState(state: SupervisorState): string {
  return `${JSON.stringify({ v: CURRENT_SUPERVISOR_STATE_VERSION, ...state }, null, 2)}\n`;
}
