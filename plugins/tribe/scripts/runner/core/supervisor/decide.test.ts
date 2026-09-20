import { expect, test } from 'bun:test';
import { decide } from './decide.ts';
import type { EscalationFact, ParkReason, SupervisorObservation } from './model.ts';

const base = (over: Partial<SupervisorObservation> = {}): SupervisorObservation => ({
  nowMs: 1_000_000, stopFilePresent: false, needsOwnerPresent: false,
  supervisorLock: null, watchdogLive: null, lastWatchdog: null, report: null,
  escalations: [], ownerOnlyEscalations: [], unratifiedRulings: [], parkMarkers: [],
  // Task 4 (spec §2.2, card `supervisor-park-truth`): observation-only fields `decide()` does
  // not read yet (Tasks 5-7 do) — defaulted here purely so this fixture keeps compiling against
  // `SupervisorObservation`'s three new required fields; every existing row below is unaffected.
  runs: [], watchdogRunId: null, parkedTerminal: null,
  state: { rulingRounds: {}, ratifyRounds: 0, spawns: 0, watchdogRuns: 0, seenEscalations: {},
           closingVerified: false, retriggers: {} },
  limits: { maxRulingRounds: 2, maxRatifyRounds: 2, maxSpawns: 8, maxWatchdogRuns: 20,
            sessionRetries: 1 },
  lastSessionOutcome: null,
  // R11 (Task 20): the composition root resolved the verify-shipped plugin dir and it exists —
  // the ordinary case every OTHER test in this file relies on, so it defaults to available here
  // rather than forcing every existing `runner_done` fixture to opt in.
  verifyShippedPluginAvailable: true,
  ...over,
});

const terminal = (reason: string) => ({ terminal: { status: 'needs_human', reason, exitCode: 10 }, ownedExitCode: 10 });

/** Every `EscalationFact` a test builds states only its own differences from a fully answered,
 * never-ruled, fresh card — `landedRulingId: null` by default (row 5's own facts set it). */
const escalation = (over: Partial<EscalationFact> & { cardId: string }): EscalationFact => ({
  filePresent: true, contentSha256: 'h0', reason: 'needs_direction', autoAnswerRounds: 0,
  landedRulingId: null,
  ...over,
});

// ---------------------------------------------------------------------------------------------
// Pre-loop rows P1-P4
// ---------------------------------------------------------------------------------------------

test('P1: a live foreign supervisor is refused, never duplicated', () => {
  expect(decide(base({ supervisorLock: { pid: 42, alive: true } })))
    .toEqual({ kind: 'park', reason: 'resume_blocked', detail: expect.any(String) });
});

test('P2: an existing NEEDS_OWNER.md blocks resume', () => {
  expect(decide(base({ needsOwnerPresent: true })).kind).toBe('park');
});

// Task 6 (spec §2.2/§3.4 row P2, card `supervisor-park-truth`, G3): a park whose stated
// condition the disk has already falsified is SUPERSEDED, not obeyed; a park that still holds
// refuses byte-for-byte as before.

test('P2: a park whose condition the disk has already falsified is SUPERSEDED, not obeyed', () => {
  const stale = base({
    needsOwnerPresent: true,
    parkedTerminal: { reason: 'stalled', atMs: 1_000 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'run-0001',
    // A newer run than the one the terminal is about is alive: parkStillHolds(o) === false.
    runs: [{ runId: 'run-0002', pid: 99, alive: true, endedAt: null, exitCode: null, reason: null }],
  });
  expect(decide(stale)).toEqual({
    kind: 'supersede_park',
    priorReason: 'stalled',
    detail: 'the park condition no longer holds on disk; re-observing and continuing',
  });
});

test('P2: a park that STILL holds refuses exactly as before, message unchanged', () => {
  const stillTrue = base({
    needsOwnerPresent: true,
    parkedTerminal: { reason: 'stalled', atMs: 1_000 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'run-0001',
    // No disk evidence contradicts the terminal: parkStillHolds(o) === true.
    runs: [],
  });
  expect(decide(stillTrue)).toEqual({
    kind: 'park',
    reason: 'resume_blocked',
    detail: 'NEEDS_OWNER.md is present; resume is blocked until the owner deletes it',
  });
});

// B-F3: superseding is legitimate only while the contradiction is ACTIONABLE. With the G2
// re-observation budget spent, superseding this park would rename NEEDS_OWNER.md, let the next
// tick re-derive the same `stalled` reason (the budget being gone) and re-park — forever.
test('P2: a stale-looking park whose re-observation budget is SPENT is OBEYED, not superseded — '
  + 'the machine has no remedy left, so a human genuinely is required', () => {
  const spent = base({
    needsOwnerPresent: true,
    parkedTerminal: { reason: 'stalled', atMs: 1_000 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'run-0001',
    runs: [{ runId: 'run-0002', pid: 99, alive: true, endedAt: null, exitCode: null, reason: null }],
    state: { ...base().state, retriggers: { stale_terminal: 1 } },
  });
  expect(decide(spent)).toEqual({
    kind: 'park',
    reason: 'resume_blocked',
    detail: 'NEEDS_OWNER.md is present; resume is blocked until the owner deletes it',
  });
});

test('P2: a park contradicted by a FINALISED run is superseded even with every budget spent — '
  + 'a finalised run changes the effective terminal reason, so the next tick decides differently', () => {
  const finalised = base({
    needsOwnerPresent: true,
    parkedTerminal: { reason: 'stalled', atMs: 1_000 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'run-0001',
    runs: [{
      runId: 'run-0002', pid: 99, alive: false,
      endedAt: '2026-09-19T22:48:45.898Z', exitCode: 2, reason: 'escalations_pending',
    }],
    state: { ...base().state, watchdogRuns: 20, retriggers: { stale_terminal: 1 } },
  });
  expect(decide(finalised).kind).toBe('supersede_park');
});

test('P1 still beats P2 even when the park is stale: a live foreign supervisor wins', () => {
  const staleButForeignLockHeld = base({
    supervisorLock: { pid: 42, alive: true },
    needsOwnerPresent: true,
    parkedTerminal: { reason: 'stalled', atMs: 1_000 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'run-0001',
    runs: [{ runId: 'run-0002', pid: 99, alive: true, endedAt: null, exitCode: null, reason: null }],
  });
  expect(decide(staleButForeignLockHeld)).toEqual({
    kind: 'park',
    reason: 'resume_blocked',
    detail: 'a live supervisor (pid 42) already holds this campaign\'s lock',
  });
});

test('P3 is unaffected: a STOP file is still honoured immediately when NEEDS_OWNER.md is absent, '
  + 'even though the disk carries a stale-park-shaped set of facts', () => {
  const staleParkFactsButNoParkFile = base({
    stopFilePresent: true,
    parkedTerminal: { reason: 'stalled', atMs: 1_000 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'run-0001',
    runs: [{ runId: 'run-0002', pid: 99, alive: true, endedAt: null, exitCode: null, reason: null }],
  });
  expect(decide(staleParkFactsButNoParkFile)).toEqual({ kind: 'exit', status: 'done', reason: 'stop_requested' });
});

test('P4 is unaffected: a live watchdog is still adopted when NEEDS_OWNER.md is absent, '
  + 'even though the disk carries a stale-park-shaped set of facts', () => {
  const staleParkFactsButNoParkFile = base({
    watchdogLive: { pid: 7, alive: true },
    parkedTerminal: { reason: 'stalled', atMs: 1_000 },
    lastWatchdog: terminal('stalled'),
    watchdogRunId: 'run-0001',
    runs: [{ runId: 'run-0002', pid: 99, alive: true, endedAt: null, exitCode: null, reason: null }],
  });
  expect(decide(staleParkFactsButNoParkFile)).toEqual({ kind: 'await_watchdog', pid: 7 });
});

test('P3: a STOP file is honoured immediately, before any watchdog fact is even consulted', () => {
  expect(decide(base({ stopFilePresent: true, lastWatchdog: terminal('escalations_pending') })))
    .toEqual({ kind: 'exit', status: 'done', reason: 'stop_requested' });
});

test('P4: a live watchdog is adopted, never a second one spawned', () => {
  expect(decide(base({ watchdogLive: { pid: 7, alive: true } })))
    .toEqual({ kind: 'await_watchdog', pid: 7 });
});

// ---------------------------------------------------------------------------------------------
// Main rows 1-4: runner_done / stop_requested
// ---------------------------------------------------------------------------------------------

test('rows 1-3: runner_done closes, ratifies, or closes-out', () => {
  expect(decide(base({ lastWatchdog: { terminal: { status: 'done', reason: 'runner_done', exitCode: 0 }, ownedExitCode: 0 },
    state: { ...base().state, closingVerified: true } })))
    .toEqual({ kind: 'exit', status: 'done', reason: 'campaign_closed' });
  expect(decide(base({ lastWatchdog: { terminal: { status: 'done', reason: 'runner_done', exitCode: 0 }, ownedExitCode: 0 },
    unratifiedRulings: ['R7'] })))
    .toEqual({ kind: 'spawn_session', session: 'ratify', cardId: null });
  expect(decide(base({ lastWatchdog: { terminal: { status: 'done', reason: 'runner_done', exitCode: 0 }, ownedExitCode: 0 } })))
    .toEqual({ kind: 'spawn_session', session: 'closing', cardId: null });
});

// R11 (Task 20, spec §5.4 item 4): fail-closed park. A `closing` spawn without the
// verify-shipped plugin dir cannot verify any card, so row 3 must never fire in that case.
test('row 3 (R11): runner_done with the verify-shipped plugin dir UNAVAILABLE parks '
  + 'closing_failed instead of spawning closing', () => {
  expect(decide(base({
    lastWatchdog: { terminal: { status: 'done', reason: 'runner_done', exitCode: 0 }, ownedExitCode: 0 },
    verifyShippedPluginAvailable: false,
  })))
    .toEqual({ kind: 'park', reason: 'closing_failed', detail: expect.any(String) });
});

test('row 4: a watchdog-reported stop_requested exits done, same as P3', () => {
  expect(decide(base({ lastWatchdog: terminal('stop_requested') })))
    .toEqual({ kind: 'exit', status: 'done', reason: 'stop_requested' });
});

// ---------------------------------------------------------------------------------------------
// Main rows 5-12: escalations_pending
// ---------------------------------------------------------------------------------------------

test('row 5: crash recovery — a landed, un-archived ruling archives rather than re-ruling', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    // R(card) was already incremented before the (now-orphaned) spawn, per §4.3 — this alone
    // must NOT be read as "needs a fresh ruling" (row 12) now that the ruling has landed.
    state: { ...base().state, rulingRounds: { c1: 1 } },
    escalations: [escalation({ cardId: 'c1', landedRulingId: 'R9' })],
  }));
  expect(a).toEqual({ kind: 'archive_escalation', cardId: 'c1', rulingId: 'R9' });
});

test('row 6: every escalated card answered this round re-triggers the watchdog', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    escalations: [escalation({ cardId: 'c1', filePresent: false })],
    report: {
      run: { reason: 'escalations_pending', unratifiedRulings: [] },
      pending: [],
      cards: { c2: { outcome: 'not_reached', escalationFile: null, question: null, autoAnswerRounds: null } },
      stats: { shipped: 0, escalated: 1, blocked: 0, notReached: 1 },
    },
  }));
  expect(a).toEqual({ kind: 'run_watchdog', cards: ['c1', 'c2'], includeEscalated: false, retrigger: null });
});

test('row 7: the next unanswered card carries a park marker a session already wrote', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    escalations: [escalation({ cardId: 'c1' })],
    parkMarkers: [{ v: 1, kind: 'too_hard', cardId: 'c1', trigger: 'x', note: 'genuinely undecidable' }],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'too_hard', detail: expect.any(String) });
});

test('row 8: an owner-only trigger parks and never spawns', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    ownerOnlyEscalations: ['data-shape-change'],
    escalations: [escalation({ cardId: 'c1', reason: 'data-shape-change' })],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'owner_only', detail: expect.any(String) });
});

test('row 9: the same escalation content after a ruling parks, never re-spawns', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    state: { ...base().state, seenEscalations: { c1: ['h1'] }, rulingRounds: { c1: 1 } },
    escalations: [escalation({ cardId: 'c1', contentSha256: 'h1' })],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'repeat_escalation', detail: expect.any(String) });
});

test('row 10: W7 refuses the third ruling round on one card', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    state: { ...base().state, rulingRounds: { c1: 2 } },
    escalations: [escalation({ cardId: 'c1', contentSha256: 'h1' })],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'w7_cap', detail: expect.any(String) });
});

test('row 8 outranks row 10: owner-only wins over a spent W7 budget', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    ownerOnlyEscalations: ['privacy'],
    state: { ...base().state, rulingRounds: { c1: 2 } },
    escalations: [escalation({ cardId: 'c1', contentSha256: 'h1', reason: 'privacy' })],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'owner_only', detail: expect.any(String) });
});

test('row 11: the total spawn budget is spent', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    state: { ...base().state, spawns: 8 },
    escalations: [escalation({ cardId: 'c1', contentSha256: 'h1' })],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'spawn_cap', detail: expect.any(String) });
});

test('row 12: a fresh answerable escalation spawns exactly one ruling session', () => {
  expect(decide(base({
    lastWatchdog: terminal('escalations_pending'),
    escalations: [escalation({ cardId: 'c1', contentSha256: 'h1' })],
  }))).toEqual({ kind: 'spawn_session', session: 'ruling', cardId: 'c1' });
});

// ---------------------------------------------------------------------------------------------
// Main rows 13-15: rulings_unratified
// ---------------------------------------------------------------------------------------------

test('row 13: the ratify-round cap refuses another ratify attempt', () => {
  const a = decide(base({
    lastWatchdog: terminal('rulings_unratified'),
    state: { ...base().state, ratifyRounds: 2 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'ratify_cap', detail: expect.any(String) });
});

test('row 14: the total spawn budget also caps a ratify attempt', () => {
  const a = decide(base({
    lastWatchdog: terminal('rulings_unratified'),
    state: { ...base().state, spawns: 8 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'spawn_cap', detail: expect.any(String) });
});

test('row 15: rulings_unratified otherwise spawns a ratify session', () => {
  const a = decide(base({ lastWatchdog: terminal('rulings_unratified') }));
  expect(a).toEqual({ kind: 'spawn_session', session: 'ratify', cardId: null });
});

// ---------------------------------------------------------------------------------------------
// Main rows 16-17: session_incomplete
// ---------------------------------------------------------------------------------------------

test('row 16: session_incomplete retriggers the watchdog once, within budget', () => {
  const a = decide(base({ lastWatchdog: terminal('session_incomplete') }));
  expect(a).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: null });
});

test('row 17: session_incomplete parks once the one-shot retrigger is already spent', () => {
  const a = decide(base({
    lastWatchdog: terminal('session_incomplete'),
    state: { ...base().state, retriggers: { session_incomplete: 1 } },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'session_incomplete', detail: expect.any(String) });
});

test('row 17: session_incomplete also parks once the watchdog-run cap is spent', () => {
  const a = decide(base({
    lastWatchdog: terminal('session_incomplete'),
    state: { ...base().state, watchdogRuns: 20 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'session_incomplete', detail: expect.any(String) });
});

// ---------------------------------------------------------------------------------------------
// Main rows 18-23
// ---------------------------------------------------------------------------------------------

test('rows 18-22 each map to their own distinct park reason', () => {
  const reasons: ParkReason[] = ['quota_cap', 'overloaded', 'stalled', 'lock_conflict', 'error'];
  for (const r of reasons) {
    expect(decide(base({ lastWatchdog: terminal(r) })))
      .toEqual({ kind: 'park', reason: r, detail: expect.any(String) });
  }
});

test('row 23: a --once-only reason is a contract violation and parks, never guesses', () => {
  for (const r of ['runner_alive', 'quota_wait_pending', 'overload_backoff_pending', 'launched', 'relaunched']) {
    expect(decide(base({ lastWatchdog: terminal(r) })))
      .toEqual({ kind: 'park', reason: 'unexpected_running', detail: expect.any(String) });
  }
});

// ---------------------------------------------------------------------------------------------
// Task 7 (spec §2.2 edit 2, card `supervisor-park-truth`, G2/G5): the watchdog's terminal is an
// INPUT, not a fact. When the runs directory contradicts it, the contradiction wins — but only
// then. Oracle: "Parking when the disk says the park is false = bug. Refusing to resume while a
// park is still TRUE = by design."
//
// The two run ids below are the ones actually recorded in the incident (spec §1.2): the watchdog
// published `stalled` about run A at 20:30:30Z while run B — carrying the very pid the watchdog's
// own status named as alive — had just started and went on to finish `escalations_pending`.
// ---------------------------------------------------------------------------------------------

const RUN_A = '2026-09-19T19-29-58-328Z-dcb2';
const RUN_B = '2026-09-19T20-30-30-069Z-6185';

/** The recorded shape: terminal `stalled` about run A, a strictly NEWER run B alive. */
const staleStalledTerminal = (over: Partial<SupervisorObservation> = {}) => base({
  lastWatchdog: terminal('stalled'),
  watchdogRunId: RUN_A,
  runs: [{ runId: RUN_B, pid: 21744, alive: true, endedAt: null, exitCode: null, reason: null }],
  ...over,
});

test('G2: the recorded shape — terminal `stalled` while a NEWER run is alive — re-triggers the '
  + 'watchdog instead of parking stalled', () => {
  expect(decide(staleStalledTerminal()))
    .toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: 'stale_terminal' });
});

test('G2 is BOUNDED: with the one-shot stale_terminal retrigger already spent, the original '
  + 'terminal\'s park stands', () => {
  expect(decide(staleStalledTerminal({
    state: { ...base().state, retriggers: { stale_terminal: 1 } },
  }))).toEqual({ kind: 'park', reason: 'stalled', detail: 'the watchdog observed a stalled runner' });
});

test('G2 is BOUNDED: with the watchdog-run cap spent, the original terminal\'s park stands', () => {
  expect(decide(staleStalledTerminal({
    state: { ...base().state, watchdogRuns: 20 },
  }))).toEqual({ kind: 'park', reason: 'stalled', detail: 'the watchdog observed a stalled runner' });
});

test('G5: a run that finalised `escalations_pending` while nobody watched routes into the '
  + 'escalation rows (5-12), never into the stale terminal\'s park', () => {
  const a = decide(staleStalledTerminal({
    runs: [{
      runId: RUN_B, pid: 21744, alive: false,
      endedAt: '2026-09-19T22:48:45.898Z', exitCode: 2, reason: 'escalations_pending',
    }],
    escalations: [escalation({ cardId: 'c1', contentSha256: 'h1' })],
  }));
  // Row 12 — the effective reason became the RUN's own, so the ordinary escalation rows decided.
  expect(a).toEqual({ kind: 'spawn_session', session: 'ruling', cardId: 'c1' });
});

test('G5 (fix B-F1): a run that finalised SUCCESSFULLY while nobody watched routes into rows '
  + '1-3 (runner_done) and NEVER parks `error`. `run.json` says `done`; decide()\'s rows are '
  + 'keyed on the watchdog vocabulary\'s `runner_done`, so the raw reason fell past every row '
  + 'into the residual backstop.', () => {
  const finishedClean = (over: Partial<SupervisorObservation> = {}) => staleStalledTerminal({
    runs: [{
      runId: RUN_B, pid: 21744, alive: false,
      endedAt: '2026-09-19T22:48:45.898Z', exitCode: 0, reason: 'done',
    }],
    ...over,
  });
  // Row 3: nothing closing-verified yet, no unratified rulings -> the closing session.
  expect(decide(finishedClean()))
    .toEqual({ kind: 'spawn_session', session: 'closing', cardId: null });
  // Row 1: the campaign is already closing-verified -> it closes.
  expect(decide(finishedClean({ state: { ...base().state, closingVerified: true } })))
    .toEqual({ kind: 'exit', status: 'done', reason: 'campaign_closed' });
  // Row 2: unratified rulings are ratified first.
  expect(decide(finishedClean({ unratifiedRulings: ['R1'] })))
    .toEqual({ kind: 'spawn_session', session: 'ratify', cardId: null });
});

test('fix B-F1: an UNRECOGNISED run reason is never passed through — the watchdog\'s own '
  + 'terminal stands, so an unknown run reason can never decide anything', () => {
  const a = decide(staleStalledTerminal({
    runs: [{
      runId: RUN_B, pid: 21744, alive: false,
      endedAt: '2026-09-19T22:48:45.898Z', exitCode: 7, reason: 'a_reason_from_the_future',
    }],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'stalled', detail: 'the watchdog observed a stalled runner' });
});

test('G5: a finalised run carrying NO reason of its own leaves the terminal\'s reason in force', () => {
  const a = decide(staleStalledTerminal({
    runs: [{
      runId: RUN_B, pid: 21744, alive: false,
      endedAt: '2026-09-19T22:48:45.898Z', exitCode: 2, reason: null,
    }],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'stalled', detail: 'the watchdog observed a stalled runner' });
});

// REGRESSION (mandatory): with NO contradiction on the disk, every terminal-reason row decides
// byte-identically to today — details asserted verbatim, not `expect.any(String)`. A supervisor
// that simply stopped parking would be a worse bug than the one this card fixes.
test('rows 18-22 are byte-identical when the disk does NOT contradict the terminal', () => {
  const expected: Array<[ParkReason, string]> = [
    ['quota_cap', 'the watchdog exhausted its quota-wait budget'],
    ['overloaded', 'the watchdog exhausted its overload-backoff budget'],
    ['stalled', 'the watchdog observed a stalled runner'],
    ['lock_conflict', 'the watchdog could not resolve a lock conflict'],
    ['error', 'the watchdog reported an unrecoverable error'],
  ];
  // Four shapes that each carry NO contradiction, for four different reasons.
  const noContradiction: Array<[string, Partial<SupervisorObservation>]> = [
    ['no runs observed at all', { watchdogRunId: RUN_A, runs: [] }],
    ['the watchdog never said which run it was about', {
      watchdogRunId: null,
      runs: [{ runId: RUN_B, pid: 21744, alive: true, endedAt: null, exitCode: null, reason: null }],
    }],
    ['only an OLDER run exists', {
      watchdogRunId: RUN_B,
      runs: [{ runId: RUN_A, pid: 21744, alive: true, endedAt: null, exitCode: null, reason: null }],
    }],
    ['the newer run is neither alive nor finalised', {
      watchdogRunId: RUN_A,
      runs: [{ runId: RUN_B, pid: 21744, alive: false, endedAt: null, exitCode: null, reason: null }],
    }],
  ];
  for (const [reason, detail] of expected) {
    for (const [, facts] of noContradiction) {
      expect(decide(base({ lastWatchdog: terminal(reason), ...facts })))
        .toEqual({ kind: 'park', reason, detail });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Main rows 24-26: no terminal published, or a usage-error exit
// ---------------------------------------------------------------------------------------------

test('row 24: the watchdog child exited without a terminal — one bounded retrigger', () => {
  const a = decide(base({ lastWatchdog: { terminal: null, ownedExitCode: null } }));
  expect(a).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: null });
});

test('row 25: no terminal, retrigger already spent — parks, never loops forever', () => {
  const a = decide(base({
    lastWatchdog: { terminal: null, ownedExitCode: null },
    state: { ...base().state, retriggers: { watchdog_no_terminal: 1 } },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'watchdog_no_terminal', detail: expect.any(String) });
});

test('row 26: the watchdog child itself exited with a usage error', () => {
  // Row 26 is reachable only once a terminal WAS published (rows 24-25 already resolve the
  // `terminal === null` case first, per the table's own order) with a reason none of rows 1-23
  // recognise — the "raw usage exit code" signal is what still lets decide() fail closed rather
  // than falling through to row 28's blunter cap check.
  const a = decide(base({
    lastWatchdog: { terminal: { status: 'error', reason: 'unrecognised', exitCode: 1 }, ownedExitCode: 1 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'watchdog_usage', detail: expect.any(String) });
});

// ---------------------------------------------------------------------------------------------
// Main row 27-28
// ---------------------------------------------------------------------------------------------

test('row 27: nothing has run yet this invocation', () => {
  expect(decide(base())).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: null });
});

// F1 fix: row 28 (§3.4: `watchdogRuns >= maxWatchdogRuns` -> `park(watchdog_run_cap)`) is a
// STANDALONE guard, keyed only on the run-cap knob — never conflated with an unrecognised
// terminal reason, which is a different failure (the residual backstop parks `error`, honestly).
test('row 28: the watchdog-run cap fires for its own true cause, even paired with an unrecognised reason', () => {
  const a = decide(base({
    lastWatchdog: terminal('some_reason_no_row_recognises'),
    state: { ...base().state, watchdogRuns: 20 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'watchdog_run_cap', detail: expect.any(String) });
});

test('row 28 is not reached under the cap: an unrecognised reason parks error, not watchdog_run_cap', () => {
  const a = decide(base({
    lastWatchdog: terminal('some_reason_no_row_recognises'),
    state: { ...base().state, watchdogRuns: 19 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'error', detail: expect.any(String) });
});

// ---------------------------------------------------------------------------------------------
// Post-session rows V1-V5
// ---------------------------------------------------------------------------------------------

test('V1: a rewritten ruling trail parks and is never retried, whatever the retry budget says', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ruling', cardId: 'c1', outcome: 'history_rewritten' },
    limits: { ...base().limits, sessionRetries: 3 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'history_rewritten', detail: expect.any(String) });
});

test('V2: an out-of-scope ratify edit parks and is never retried', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ratify', cardId: null, outcome: 'ratify_out_of_scope' },
    limits: { ...base().limits, sessionRetries: 3 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'ratify_out_of_scope', detail: expect.any(String) });
});

test('V3: a verified ruling is archived by the supervisor, not re-decided as a fresh escalation', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ruling', cardId: 'c1', outcome: 'ruled', rulingId: 'R9' },
  }));
  expect(a).toEqual({ kind: 'archive_escalation', cardId: 'c1', rulingId: 'R9' });
});

test('V4: a valid park marker the session wrote is relayed as the supervisor\'s own park', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ruling', cardId: 'c1', outcome: 'parked', parkMarkerKind: 'owner_only' },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'owner_only', detail: expect.any(String) });
});

test('V5: a failed attempt retries once, within the session-retry budget', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ruling', cardId: 'c1', outcome: 'failed' },
    state: { ...base().state, retriggers: { 'ruling:c1': 0 } },
    limits: { ...base().limits, sessionRetries: 1 },
  }));
  expect(a).toEqual({ kind: 'spawn_session', session: 'ruling', cardId: 'c1' });
});

test('V5/V6: a failed attempt parks once its retry budget is exhausted, keyed per session kind', () => {
  const ruling = decide(base({
    lastSessionOutcome: { kind: 'ruling', cardId: 'c1', outcome: 'timeout' },
    state: { ...base().state, retriggers: { 'ruling:c1': 1 } },
    limits: { ...base().limits, sessionRetries: 1 },
  }));
  expect(ruling).toEqual({ kind: 'park', reason: 'ruling_failed', detail: expect.any(String) });

  const ratify = decide(base({
    lastSessionOutcome: { kind: 'ratify', cardId: null, outcome: 'failed' },
    state: { ...base().state, retriggers: { 'ratify:null': 1 } },
    limits: { ...base().limits, sessionRetries: 1 },
  }));
  expect(ratify).toEqual({ kind: 'park', reason: 'ratify_failed', detail: expect.any(String) });

  const closing = decide(base({
    lastSessionOutcome: { kind: 'closing', cardId: null, outcome: 'failed' },
    state: { ...base().state, retriggers: { 'closing:null': 1 } },
    limits: { ...base().limits, sessionRetries: 1 },
  }));
  expect(closing).toEqual({ kind: 'park', reason: 'closing_failed', detail: expect.any(String) });
});

test('V7: the unratified list reached empty re-triggers the watchdog on the same scope — proven '
  + 'against a stale watchdog fact that would decide DIFFERENTLY if this fell through', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ratify', cardId: null, outcome: 'ratified' },
    // A stale `rulings_unratified` terminal reason: if V7 did not own this outcome and it fell
    // through to the ordinary rows, row 15 would spawn ANOTHER ratify session forever. Getting
    // `run_watchdog` here instead is proof V7 fired, not proof of a fallthrough coincidence.
    lastWatchdog: terminal('rulings_unratified'),
  }));
  // The exact literal decide.ts already uses for rows 16/24 — "same scope" resolves to the base
  // scope, never a card-scoped re-run.
  expect(a).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: null });
});

test('V8: the final report exists and nothing is unratified — the campaign closes', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'closing', cardId: null, outcome: 'closed' },
  }));
  expect(a).toEqual({ kind: 'exit', status: 'done', reason: 'campaign_closed' });
});

test('a malformed outcome (a "ruled" verdict missing its rulingId) is a contract violation by '
  + 'the layer below and falls through to the ordinary rows, never swallowed', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ruling', cardId: 'c1', outcome: 'ruled', rulingId: null },
  }));
  // With no watchdog fact at all, the ordinary rows land on row 27 — proof the post-session
  // block did not silently produce a wrong action for an outcome it does not own. This is now
  // the ONLY class of outcome that reaches this fallthrough: V7/V8 own 'ratified'/'closed'.
  expect(a).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: null });
});

// ---------------------------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------------------------

test('the function is pure: the same observation decides the same action every time', () => {
  const o = base({ lastWatchdog: terminal('quota_cap') });
  expect(decide(o)).toEqual(decide(o));
  expect(decide(o)).toEqual(decide(structuredClone(o)));
});
