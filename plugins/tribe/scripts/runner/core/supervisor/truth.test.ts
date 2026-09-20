import { expect, test } from 'bun:test';
import { parkStillHolds, terminalContradiction } from './truth.ts';
import type { RunFact, SupervisorObservation } from './model.ts';

/** Every field `terminalContradiction`/`parkStillHolds` could read, defaulted to the
 * "nothing interesting happened" case; each test states only its own differences. Mirrors
 * `decide.test.ts`'s own `base()` fixture shape. */
const base = (over: Partial<SupervisorObservation> = {}): SupervisorObservation => ({
  nowMs: 1_000_000, stopFilePresent: false, needsOwnerPresent: false,
  supervisorLock: null, watchdogLive: null, lastWatchdog: null, report: null,
  escalations: [], ownerOnlyEscalations: [], unratifiedRulings: [], parkMarkers: [],
  runs: [], watchdogRunId: null, parkedTerminal: null,
  state: { rulingRounds: {}, ratifyRounds: 0, spawns: 0, watchdogRuns: 0, seenEscalations: {},
           closingVerified: false, retriggers: {} },
  limits: { maxRulingRounds: 2, maxRatifyRounds: 2, maxSpawns: 8, maxWatchdogRuns: 20,
            sessionRetries: 1 },
  lastSessionOutcome: null,
  verifyShippedPluginAvailable: true,
  ...over,
});

const terminal = (reason: string) =>
  ({ terminal: { status: 'needs_human', reason, exitCode: 10 }, ownedExitCode: 10 });

const run = (over: Partial<RunFact> & { runId: string }): RunFact => ({
  pid: null, alive: false, endedAt: null, exitCode: null, reason: null,
  ...over,
});

// ---------------------------------------------------------------------------------------------
// terminalContradiction
// ---------------------------------------------------------------------------------------------

test('no terminal published -> null (nothing to contradict)', () => {
  expect(terminalContradiction(base({ lastWatchdog: null, watchdogRunId: 'A' }))).toBeNull();
});

test('watchdogRunId === null -> null (fail closed, no idea what the terminal is about)', () => {
  expect(terminalContradiction(base({ lastWatchdog: terminal('stalled'), watchdogRunId: null })))
    .toBeNull();
});

test('terminal published, but runs is empty -> null', () => {
  expect(terminalContradiction(base({ lastWatchdog: terminal('stalled'), watchdogRunId: 'A', runs: [] })))
    .toBeNull();
});

test('terminal published, only an OLDER run on disk -> null', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'B',
    runs: [run({ runId: 'A', endedAt: null, alive: true })],
  });
  expect(terminalContradiction(o)).toBeNull();
});

test('a NEWER run is alive -> newer_run_alive', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 10 }),
      run({ runId: 'B', endedAt: null, alive: true, pid: 99 }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({ kind: 'newer_run_alive', runId: 'B' });
});

test('a NEWER run has finalised -> run_finalised', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 10 }),
      run({ runId: 'B', endedAt: '2026-01-02T00:00:00.000Z', exitCode: 2, reason: 'escalations_pending' }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({
    kind: 'run_finalised', runId: 'B', exitCode: 2, reason: 'escalations_pending',
  });
});

test('a NEWER run is neither alive nor finalised -> null (a dead pid with no finish record proves nothing)', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 10 }),
      run({ runId: 'B', endedAt: null, alive: false }),
    ],
  });
  expect(terminalContradiction(o)).toBeNull();
});

test('no run newer than the terminal, but the terminal own run has since finalised -> run_finalised', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 2, reason: 'escalations_pending' })],
  });
  expect(terminalContradiction(o)).toEqual({
    kind: 'run_finalised', runId: 'A', exitCode: 2, reason: 'escalations_pending',
  });
});

test('the recorded shape (spec §1.2): stalled about run A, a newer run B ALIVE', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: '2026-09-19T19-29-58-328Z-dcb2',
    runs: [
      run({ runId: '2026-09-19T19-29-58-328Z-dcb2', pid: 21744, endedAt: null, alive: false }),
      run({ runId: '2026-09-19T20-30-30-069Z-6185', pid: 21744, endedAt: null, alive: true }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({
    kind: 'newer_run_alive', runId: '2026-09-19T20-30-30-069Z-6185',
  });
});

test('the recorded shape (spec §1.2), run B later finalised exit 2 escalations_pending', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: '2026-09-19T19-29-58-328Z-dcb2',
    runs: [
      run({ runId: '2026-09-19T19-29-58-328Z-dcb2', pid: 21744, endedAt: null, alive: false }),
      run({
        runId: '2026-09-19T20-30-30-069Z-6185', pid: 21744,
        endedAt: '2026-09-19T22:48:45.898Z', exitCode: 2, reason: 'escalations_pending',
      }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({
    kind: 'run_finalised', runId: '2026-09-19T20-30-30-069Z-6185', exitCode: 2, reason: 'escalations_pending',
  });
});

// ---------------------------------------------------------------------------------------------
// parkStillHolds
// ---------------------------------------------------------------------------------------------

test('no park recorded -> holds true', () => {
  expect(parkStillHolds(base({ parkedTerminal: null }))).toBe(true);
});

test('a park whose reason is NOT a runner-liveness claim -> holds true, even with a contradiction present', () => {
  const o = base({
    parkedTerminal: { reason: 'quota_cap', atMs: 1 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 10 }),
      run({ runId: 'B', endedAt: null, alive: true }),
    ],
  });
  expect(parkStillHolds(o)).toBe(true);
});

test('stalled park, but NO contradiction on disk (dead pid, no record of finishing) -> holds true', () => {
  const o = base({
    parkedTerminal: { reason: 'stalled', atMs: 1 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [run({ runId: 'A', endedAt: null, alive: false })],
  });
  expect(parkStillHolds(o)).toBe(true);
});

test('stalled park WITH a contradiction on disk -> superseded (false)', () => {
  const o = base({
    parkedTerminal: { reason: 'stalled', atMs: 1 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 10 }),
      run({ runId: 'B', endedAt: null, alive: true }),
    ],
  });
  expect(parkStillHolds(o)).toBe(false);
});
