import { expect, test } from 'bun:test';
import { decide } from './decide.ts';
import type { EscalationFact, ParkReason, SupervisorObservation } from './model.ts';

const base = (over: Partial<SupervisorObservation> = {}): SupervisorObservation => ({
  nowMs: 1_000_000, stopFilePresent: false, needsOwnerPresent: false,
  supervisorLock: null, watchdogLive: null, lastWatchdog: null, report: null,
  escalations: [], ownerOnlyEscalations: [], unratifiedRulings: [], parkMarkers: [],
  state: { rulingRounds: {}, ratifyRounds: 0, spawns: 0, watchdogRuns: 0, seenEscalations: {},
           closingVerified: false, retriggers: {} },
  limits: { maxRulingRounds: 2, maxRatifyRounds: 2, maxSpawns: 8, maxWatchdogRuns: 20,
            sessionRetries: 1 },
  lastSessionOutcome: null,
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
  expect(a).toEqual({ kind: 'run_watchdog', cards: ['c1', 'c2'], includeEscalated: false });
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
  expect(a).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false });
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
// Main rows 24-26: no terminal published, or a usage-error exit
// ---------------------------------------------------------------------------------------------

test('row 24: the watchdog child exited without a terminal — one bounded retrigger', () => {
  const a = decide(base({ lastWatchdog: { terminal: null, ownedExitCode: null } }));
  expect(a).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false });
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
  expect(decide(base())).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false });
});

test('row 28: an unrecognised terminal reason once the watchdog-run cap is spent parks, never guesses', () => {
  const a = decide(base({
    lastWatchdog: terminal('some_reason_no_row_recognises'),
    state: { ...base().state, watchdogRuns: 20 },
  }));
  expect(a).toEqual({ kind: 'park', reason: 'watchdog_run_cap', detail: expect.any(String) });
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

test('an outcome outside V1-V5 (ratified/closed) falls through to the ordinary rows, not swallowed', () => {
  const a = decide(base({
    lastSessionOutcome: { kind: 'ratify', cardId: null, outcome: 'ratified' },
  }));
  // With no watchdog fact at all, the ordinary rows land on row 27 — proof the post-session
  // block did not silently produce a wrong action for an outcome it does not own.
  expect(a).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false });
});

// ---------------------------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------------------------

test('the function is pure: the same observation decides the same action every time', () => {
  const o = base({ lastWatchdog: terminal('quota_cap') });
  expect(decide(o)).toEqual(decide(o));
  expect(decide(o)).toEqual(decide(structuredClone(o)));
});
