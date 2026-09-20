import { expect, test } from 'bun:test';
import {
  parkStillHolds, staleTerminalRetriggerAvailable, terminalContradiction, terminalReasonForRunReason,
} from './truth.ts';
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

test('NO candidate is alive or finalised -> null (a dead pid with no finish record proves nothing)', () => {
  // Run A is inconclusive here too. Under B-F4's fix the terminal's OWN run is a candidate
  // ALWAYS, not merely as a fallback when no newer run exists, so a finalised run A would itself
  // be a contradiction — which is what the `terminal OWN run finalised ...` case above pins. This
  // test's own subject is unchanged: an inconclusive run proves nothing, whichever run it is.
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', pid: 999999, endedAt: null, alive: false }),
      run({ runId: 'B', pid: 999998, endedAt: null, alive: false }),
    ],
  });
  expect(terminalContradiction(o)).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// B-F4: the question is asked over EVERY candidate run, never over the newest one alone.
//
// A killed relaunch leaves a run directory behind with a dead pid and no `endedAt` — an
// INCONCLUSIVE record. Asking only the newest run therefore let such a record MASK a genuinely
// alive run sitting behind it, and the supervisor parked a campaign whose runner was alive: the
// first sentence of the Oracle ("parking when the disk says the park is false = bug"). The
// recorded incident home carries THREE run directories, so this shape is normal, not exotic.
// ---------------------------------------------------------------------------------------------

test('an INCONCLUSIVE newest run must not mask a genuinely ALIVE one: A (the terminal own run), '
  + 'B alive, C newer still with a dead pid and no endedAt -> newer_run_alive for B', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', pid: 999999, endedAt: null, alive: false }),
      run({ runId: 'B', pid: 7777, endedAt: null, alive: true }),
      run({ runId: 'C', pid: 999998, endedAt: null, alive: false }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({ kind: 'newer_run_alive', runId: 'B' });
});

test('LIVENESS WINS over a newer FINALISED run: a live runner is the strongest contradiction '
  + 'there is, whatever a later run record says', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: null, alive: false }),
      run({ runId: 'B', pid: 7777, endedAt: null, alive: true }),
      run({ runId: 'C', endedAt: '2026-01-03T00:00:00.000Z', exitCode: 2, reason: 'escalations_pending' }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({ kind: 'newer_run_alive', runId: 'B' });
});

test('several FINALISED candidates and none alive -> the NEWEST finalised run wins', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 10, reason: 'error' }),
      run({ runId: 'B', endedAt: '2026-01-02T00:00:00.000Z', exitCode: 2, reason: 'escalations_pending' }),
      run({ runId: 'C', endedAt: '2026-01-03T00:00:00.000Z', exitCode: 0, reason: 'done' }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({
    kind: 'run_finalised', runId: 'C', exitCode: 0, reason: 'done',
  });
});

test('the terminal OWN run finalised while a newer run is inconclusive -> run_finalised for the '
  + 'terminal own run (the own run is always a candidate, not just a fallback)', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 2, reason: 'escalations_pending' }),
      run({ runId: 'C', pid: 999998, endedAt: null, alive: false }),
    ],
  });
  expect(terminalContradiction(o)).toEqual({
    kind: 'run_finalised', runId: 'A', exitCode: 2, reason: 'escalations_pending',
  });
});

test('runs OLDER than the terminal are never candidates, however alive they are', () => {
  const o = base({
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'B',
    runs: [
      run({ runId: 'A', pid: 7777, endedAt: null, alive: true }),
      run({ runId: 'B', pid: 999999, endedAt: null, alive: false }),
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

// ---------------------------------------------------------------------------------------------
// B-F3: superseding is legitimate only while the contradiction is ACTIONABLE.
//
// `parkStillHolds` used to ask only "does the disk contradict the terminal?", knowing nothing
// about the re-observation budget `decide()` bounds the G2 action with. So once that budget was
// spent the supervisor superseded the park, re-derived the very same `stalled` reason on the next
// tick (the budget being gone), and re-parked with a brand-new identical `NEEDS_OWNER.md` — on
// every restart, forever, accumulating `.superseded-<ts>` files and `park_superseded` events that
// read as "the campaign continued" when nothing was investigated.
//
// When the machine has exhausted its own remedies a human genuinely IS required: that is the
// Oracle's second half ("refusing to resume while a park is still TRUE = by design").
// ---------------------------------------------------------------------------------------------

/** A stalled park contradicted by a newer ALIVE run — the shape that must NOT churn. */
const stalledParkWithLiveRun = (state: Partial<SupervisorObservation['state']> = {}) => base({
  parkedTerminal: { reason: 'stalled', atMs: 1 },
  lastWatchdog: terminal('stalled'),
  watchdogRunId: 'A',
  runs: [
    run({ runId: 'A', pid: 999999, endedAt: null, alive: false }),
    run({ runId: 'B', pid: 7777, endedAt: null, alive: true }),
  ],
  state: {
    rulingRounds: {}, ratifyRounds: 0, spawns: 0, watchdogRuns: 0, seenEscalations: {},
    closingVerified: false, retriggers: {}, ...state,
  },
});

test('newer_run_alive with the one-shot stale_terminal retrigger SPENT -> the park STILL HOLDS '
  + '(superseding it would churn: supersede -> re-derive stalled -> re-park, forever)', () => {
  expect(parkStillHolds(stalledParkWithLiveRun({ retriggers: { stale_terminal: 1 } }))).toBe(true);
});

test('newer_run_alive with the watchdog-run cap REACHED -> the park STILL HOLDS', () => {
  // `limits.maxWatchdogRuns` is 20 in `base()`; decide()'s G2 guard is `watchdogRuns < max`.
  expect(parkStillHolds(stalledParkWithLiveRun({ watchdogRuns: 20 }))).toBe(true);
});

test('newer_run_alive with the bound UNSPENT -> the park is superseded (the G2 remedy is still '
  + 'available, so the contradiction is actionable)', () => {
  expect(parkStillHolds(stalledParkWithLiveRun())).toBe(false);
});

test('run_finalised is ALWAYS actionable — it changes the effective terminal reason, so it is '
  + 'superseded even with every re-observation budget spent', () => {
  const o = base({
    parkedTerminal: { reason: 'stalled', atMs: 1 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'A',
    runs: [
      run({ runId: 'A', pid: 999999, endedAt: null, alive: false }),
      run({
        runId: 'B', endedAt: '2026-01-02T00:00:00.000Z', exitCode: 2, reason: 'escalations_pending',
      }),
    ],
    state: {
      rulingRounds: {}, ratifyRounds: 0, spawns: 0, watchdogRuns: 20, seenEscalations: {},
      closingVerified: false, retriggers: { stale_terminal: 1 },
    },
  });
  expect(parkStillHolds(o)).toBe(false);
});

// `staleTerminalRetriggerAvailable` is the SINGLE spelling of decide()'s G2 bound — the row
// itself and `parkStillHolds` both read it, so the condition can never drift apart in two places.
test('staleTerminalRetriggerAvailable mirrors decide()\'s G2 guard exactly', () => {
  expect(staleTerminalRetriggerAvailable(stalledParkWithLiveRun())).toBe(true);
  expect(staleTerminalRetriggerAvailable(stalledParkWithLiveRun({ retriggers: { stale_terminal: 1 } }))).toBe(false);
  expect(staleTerminalRetriggerAvailable(stalledParkWithLiveRun({ watchdogRuns: 20 }))).toBe(false);
  expect(staleTerminalRetriggerAvailable(stalledParkWithLiveRun({ watchdogRuns: 19 }))).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// terminalReasonForRunReason — the two vocabularies are NOT the same vocabulary (fix B-F1).
// `run.json`'s `reason` is `core/report.ts#ExitReason`; decide()'s rows are keyed on the
// WATCHDOG's terminal-reason vocabulary. They differ on the success value (`done` vs
// `runner_done`), so a finished-successfully run substituted raw fell past every row into the
// residual `park('error')` backstop. The translation is explicit, total, and fails CLOSED.
// ---------------------------------------------------------------------------------------------

test('the success value is TRANSLATED: run reason `done` -> terminal reason `runner_done`', () => {
  expect(terminalReasonForRunReason('done')).toBe('runner_done');
});

test('every ExitReason spelled identically in both vocabularies maps to itself', () => {
  // This list is `core/report.ts#ExitReason` minus `done`, read off the type itself.
  for (const shared of ['stop_requested', 'escalations_pending', 'session_incomplete',
    'error', 'rulings_unratified']) {
    expect(terminalReasonForRunReason(shared)).toBe(shared);
  }
});

test('an UNRECOGNISED run reason makes no substitution (null) — fail closed, never passed '
  + 'through: a silent pass-through is exactly what caused B-F1', () => {
  expect(terminalReasonForRunReason('runner_done')).toBeNull();
  expect(terminalReasonForRunReason('stalled')).toBeNull();
  expect(terminalReasonForRunReason('')).toBeNull();
  expect(terminalReasonForRunReason('DONE')).toBeNull();
  expect(terminalReasonForRunReason('some_future_reason')).toBeNull();
});

test('a run carrying no reason at all -> null (no substitution)', () => {
  expect(terminalReasonForRunReason(null)).toBeNull();
});
