// Tests for state.ts (Task 10, plan §Task 10 Step 1): an absent state file parses to the zero
// state; an unknown-version file is a typed refusal (never a throw); applying a `ruling` outcome
// increments that card's round and appends the content hash; serialize -> parse round-trips
// byte-identically. `state.ts` parses, applies one outcome, and serializes — it never decides
// anything (that is `decide.ts`).
import { describe, expect, test } from 'bun:test';
import {
  CURRENT_SUPERVISOR_STATE_VERSION,
  applyRulingOutcome,
  parseState,
  serializeState,
  zeroState,
} from './state.ts';
import type { SupervisorState } from './model.ts';

describe('zeroState', () => {
  test('every counter starts at zero/empty', () => {
    expect(zeroState()).toEqual({
      rulingRounds: {},
      ratifyRounds: 0,
      spawns: 0,
      watchdogRuns: 0,
      seenEscalations: {},
      closingVerified: false,
      retriggers: {},
    });
  });
});

describe('parseState — an absent state file parses to the zero state', () => {
  test('raw === null (the file does not exist yet) parses to zeroState()', () => {
    const result = parseState(null);
    expect(result).toEqual({ kind: 'ok', state: zeroState() });
  });
});

describe('parseState — an unknown version is a TYPED REFUSAL, never a throw', () => {
  test('a v2 file is refused with the observed version, not thrown', () => {
    let threw = false;
    let result: ReturnType<typeof parseState> | undefined;
    try {
      result = parseState({ v: 2, rulingRounds: {}, ratifyRounds: 0, spawns: 0, watchdogRuns: 0,
        seenEscalations: {}, closingVerified: false, retriggers: {} });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toEqual({ kind: 'unsupported_version', version: 2 });
  });

  test('a file with no v field at all is refused the same way', () => {
    const result = parseState({ rulingRounds: {} });
    expect(result).toEqual({ kind: 'unsupported_version', version: undefined });
  });
});

describe('parseState — a well-formed v1 file loads its counters', () => {
  test('every field is read back exactly', () => {
    const raw = {
      v: 1,
      rulingRounds: { c1: 1 },
      ratifyRounds: 1,
      spawns: 3,
      watchdogRuns: 2,
      seenEscalations: { c1: ['h1'] },
      closingVerified: false,
      retriggers: { 'ruling:c1': 1 },
    };
    const result = parseState(raw);
    expect(result).toEqual({
      kind: 'ok',
      state: {
        rulingRounds: { c1: 1 },
        ratifyRounds: 1,
        spawns: 3,
        watchdogRuns: 2,
        seenEscalations: { c1: ['h1'] },
        closingVerified: false,
        retriggers: { 'ruling:c1': 1 },
      },
    });
  });
});

describe('applyRulingOutcome — applying a ruling outcome increments that round and appends the hash', () => {
  test('a fresh card: rulingRounds goes 0 -> 1, seenEscalations gains the hash', () => {
    const next = applyRulingOutcome(zeroState(), 'c1', 'sha-abc');
    expect(next.rulingRounds).toEqual({ c1: 1 });
    expect(next.seenEscalations).toEqual({ c1: ['sha-abc'] });
  });

  test('a second round on the same card: increments again and appends the second hash', () => {
    const first = applyRulingOutcome(zeroState(), 'c1', 'sha-abc');
    const second = applyRulingOutcome(first, 'c1', 'sha-def');
    expect(second.rulingRounds).toEqual({ c1: 2 });
    expect(second.seenEscalations).toEqual({ c1: ['sha-abc', 'sha-def'] });
  });

  test('does not mutate the input state', () => {
    const before = zeroState();
    const snapshot: SupervisorState = { ...before, rulingRounds: { ...before.rulingRounds } };
    applyRulingOutcome(before, 'c1', 'sha-abc');
    expect(before).toEqual(snapshot);
  });

  test('a different card is tracked independently', () => {
    const first = applyRulingOutcome(zeroState(), 'c1', 'sha-abc');
    const withC2 = applyRulingOutcome(first, 'c2', 'sha-xyz');
    expect(withC2.rulingRounds).toEqual({ c1: 1, c2: 1 });
    expect(withC2.seenEscalations).toEqual({ c1: ['sha-abc'], c2: ['sha-xyz'] });
  });
});

describe('serializeState / parseState round-trip — byte-identical', () => {
  test('serialize(parse(x).state) reparsed equals the original state exactly', () => {
    const state: SupervisorState = {
      rulingRounds: { c1: 1, c2: 2 },
      ratifyRounds: 1,
      spawns: 4,
      watchdogRuns: 3,
      seenEscalations: { c1: ['h1', 'h2'] },
      closingVerified: true,
      retriggers: { watchdog_no_terminal: 1 },
    };
    const serialized = serializeState(state);
    expect(serialized.endsWith('\n')).toBe(true);

    const reparsed = parseState(JSON.parse(serialized));
    expect(reparsed).toEqual({ kind: 'ok', state });
  });

  test('serializing twice in a row produces byte-identical output (no clock, no randomness)', () => {
    const state = zeroState();
    expect(serializeState(state)).toBe(serializeState(state));
  });

  test('CURRENT_SUPERVISOR_STATE_VERSION is stamped on serialize and accepted on parse', () => {
    const serialized = serializeState(zeroState());
    const raw = JSON.parse(serialized);
    expect(raw.v).toBe(CURRENT_SUPERVISOR_STATE_VERSION);
    expect(parseState(raw).kind).toBe('ok');
  });
});
