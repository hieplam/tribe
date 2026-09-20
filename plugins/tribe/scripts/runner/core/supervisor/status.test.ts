// Tests for status.ts (Task 10, plan §Task 10 Step 1): `exitCodeOf` maps all four terminal
// shapes; `buildStatus` fills every field of spec §13; `renderNeedsOwner` produces a document
// containing the reason, the campaign home, the ledger lines, and a re-run command — and a
// table-driven case asserts EVERY ParkReason value (all 22 — model.ts's own count, spec §6.2)
// renders a non-empty "what unblocks it" instruction.
import { describe, expect, test } from 'bun:test';
import {
  buildStatus,
  exitCodeOf,
  renderNeedsOwner,
  serializeStatus,
} from './status.ts';
import {
  SUPERVISOR_EXIT_DONE,
  SUPERVISOR_EXIT_NEEDS_OWNER,
  SUPERVISOR_EXIT_RUNNING,
  SUPERVISOR_EXIT_USAGE,
  type ParkReason,
} from './model.ts';
import type { SupervisorStatus } from './model.ts';

// spec §6.2's frozen union, verbatim from model.ts — the table-driven test below iterates
// EXACTLY this list, never a hand-shortened one, so a future addition to `ParkReason` that
// forgets a sentence-table entry fails `tsc`, not this list going stale silently.
const ALL_PARK_REASONS: ParkReason[] = [
  'owner_only', 'too_hard', 'w7_cap', 'ratify_cap', 'spawn_cap', 'watchdog_run_cap',
  'repeat_escalation', 'ruling_failed', 'ratify_failed', 'closing_failed', 'session_incomplete',
  'quota_cap', 'overloaded', 'stalled', 'lock_conflict', 'error', 'unexpected_running',
  'watchdog_no_terminal', 'watchdog_usage', 'resume_blocked', 'history_rewritten',
  'ratify_out_of_scope',
];

describe('exitCodeOf — the frozen exit codes (spec §10), all four terminal shapes', () => {
  test('done 0, usage 1, needs_owner 20, already_running 21', () => {
    expect(exitCodeOf('done')).toBe(SUPERVISOR_EXIT_DONE);
    expect(exitCodeOf('usage')).toBe(SUPERVISOR_EXIT_USAGE);
    expect(exitCodeOf('needs_owner')).toBe(SUPERVISOR_EXIT_NEEDS_OWNER);
    expect(exitCodeOf('already_running')).toBe(SUPERVISOR_EXIT_RUNNING);
  });
});

function statusInput(over: Partial<Parameters<typeof buildStatus>[0]> = {}) {
  return {
    pid: 4242,
    home: '/h/.tribe/k/campaigns/c',
    campaign: 'c',
    startedAtMs: Date.parse('2026-09-18T10:00:00.000Z'),
    updatedAtMs: Date.parse('2026-09-18T10:05:00.000Z'),
    state: 'observing' as const,
    lastAction: 'run_watchdog',
    watchdog: { pid: null, lastTerminalReason: null },
    currentSession: null,
    counters: {
      watchdogRuns: 0, spawns: 0, rulingRounds: {}, ratifyRounds: 0, failures: 0, staleTerminals: 0,
    },
    terminal: null,
    ...over,
  };
}

describe('buildStatus — fills every field of spec §13', () => {
  test('an observing status with no session and no terminal', () => {
    const status = buildStatus(statusInput());
    expect(status).toEqual({
      v: 1,
      pid: 4242,
      home: '/h/.tribe/k/campaigns/c',
      campaign: 'c',
      startedAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:05:00.000Z',
      state: 'observing',
      lastAction: 'run_watchdog',
      watchdog: { pid: null, lastTerminalReason: null },
      currentSession: null,
      counters: {
        watchdogRuns: 0, spawns: 0, rulingRounds: {}, ratifyRounds: 0, failures: 0, staleTerminals: 0,
      },
      terminal: null,
    });
  });

  test('a session_ruling status with a live watchdog and non-zero counters', () => {
    const status: SupervisorStatus = buildStatus(statusInput({
      state: 'session_ruling',
      lastAction: 'spawn_session:ruling',
      watchdog: { pid: 555, lastTerminalReason: 'escalations_pending' },
      currentSession: { kind: 'ruling', cardId: 'c1', sessionId: 'sess-1' },
      counters: {
        watchdogRuns: 2, spawns: 1, rulingRounds: { c1: 1 }, ratifyRounds: 0, failures: 0, staleTerminals: 0,
      },
    }));
    expect(status.watchdog).toEqual({ pid: 555, lastTerminalReason: 'escalations_pending' });
    expect(status.currentSession).toEqual({ kind: 'ruling', cardId: 'c1', sessionId: 'sess-1' });
    expect(status.counters.rulingRounds).toEqual({ c1: 1 });
  });

  test('a terminal needs_owner status carries the reason and exit code', () => {
    const status = buildStatus(statusInput({
      state: 'terminal',
      terminal: { status: 'needs_owner', reason: 'w7_cap', exitCode: SUPERVISOR_EXIT_NEEDS_OWNER },
    }));
    expect(status.terminal).toEqual({
      status: 'needs_owner', reason: 'w7_cap', exitCode: SUPERVISOR_EXIT_NEEDS_OWNER,
    });
  });

  // G1-equivalent (watchdog/status.ts's own audit finding): a non-finite ms timestamp must never
  // throw `new Date(NaN).toISOString()`'s uncaught RangeError — this module never reads a clock,
  // it only shapes whatever ms value it is handed.
  test('a non-finite startedAtMs/updatedAtMs renders as invalid, not a thrown RangeError', () => {
    let threw = false;
    let status: SupervisorStatus | undefined;
    try {
      status = buildStatus(statusInput({ startedAtMs: Number.NaN, updatedAtMs: Number.NaN }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(status?.startedAt).toBe('(invalid-timestamp)');
    expect(status?.updatedAt).toBe('(invalid-timestamp)');
  });

  test('serializeStatus ends with a newline and reparses to the same state field', () => {
    const status = buildStatus(statusInput());
    const serialized = serializeStatus(status);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(JSON.parse(serialized).state).toBe('observing');
  });
});

function needsOwnerInput(over: Partial<Parameters<typeof renderNeedsOwner>[0]> = {}) {
  return {
    campaignSlug: 'viewer-consolidation',
    campaignHome: '/h/.tribe/k/campaigns/viewer-consolidation',
    reason: 'owner_only' as ParkReason,
    atMs: Date.parse('2026-09-18T15:00:00.000Z'),
    cardId: 'c1' as string | null,
    question: { reasonLine: '**Reason:** data-shape-change', context: '## Context\nSome context.' } as
      { reasonLine: string; context: string } | null,
    rulingRoundsUsed: [{ cardId: 'c1', used: 1, max: 2 }],
    spawnsUsed: { used: 3, max: 8 },
    rulingsLandedThisRun: ['R16', 'R18'],
    watchdogRuns: 2,
    lastWatchdogTerminalReason: 'escalations_pending',
    ledgerLines: ['{"at":"2026-09-18T14:55:00Z","kind":"ruling","verdict":"parked"}'],
    rerunCommand:
      'bun plugins/tribe/scripts/runner/run.ts supervise --repo /repo --campaign viewer-consolidation --model sonnet',
    ...over,
  };
}

describe('renderNeedsOwner — the format (spec §11)', () => {
  test('the document contains the reason, the campaign home, the ledger lines, and the re-run command', () => {
    const input = needsOwnerInput();
    const doc = renderNeedsOwner(input);

    expect(doc).toContain('# Campaign needs the owner: viewer-consolidation');
    expect(doc).toContain('**Park reason:** owner_only');
    expect(doc).toContain(`**Supervisor exit:** ${SUPERVISOR_EXIT_NEEDS_OWNER}`);
    expect(doc).toContain('**Campaign home:** /h/.tribe/k/campaigns/viewer-consolidation');
    expect(doc).toContain('## What happened');
    expect(doc).toContain('## The question (when a card is parked)');
    expect(doc).toContain('**Reason:** data-shape-change');
    expect(doc).toContain('## Context\nSome context.');
    expect(doc).toContain('## What I already did');
    expect(doc).toContain('c1 1/2');
    expect(doc).toContain('3/8');
    expect(doc).toContain('R16, R18');
    expect(doc).toContain('## What unblocks it');
    expect(doc).toContain(input.rerunCommand);
    expect(doc).toContain('## Ledger');
    expect(doc).toContain(input.ledgerLines[0] as string);
  });

  test('atMs renders as ISO, never the raw millisecond number', () => {
    const doc = renderNeedsOwner(needsOwnerInput());
    expect(doc).toContain('**At:** 2026-09-18T15:00:00.000Z');
  });

  // Same non-finite-ms guard as buildStatus's — this module never reads a clock either.
  test('a non-finite atMs renders as invalid, not a thrown RangeError', () => {
    let threw = false;
    let doc = '';
    try {
      doc = renderNeedsOwner(needsOwnerInput({ atMs: Number.NaN }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(doc).toContain('**At:** (invalid-timestamp)');
  });

  test('a park with no specific card (question === null) still renders a coherent document', () => {
    const doc = renderNeedsOwner(needsOwnerInput({
      reason: 'quota_cap', cardId: null, question: null, rulingsLandedThisRun: [],
    }));
    expect(doc).toContain('**Park reason:** quota_cap');
    expect(doc).not.toContain('undefined');
    expect(doc).not.toContain('null');
  });

  // brief-contracts.md / the card oracle: the sentence table is FROZEN and keyed by ParkReason;
  // a missing entry is a type error (adjudication rule REFUTED in advance: no generic fallback).
  // This table-driven case is the mechanical proof that every one of the 22 values (model.ts's
  // own union) renders a real, non-empty "what unblocks it" instruction naming the re-run command.
  describe('every ParkReason renders a non-empty "what unblocks it" instruction', () => {
    for (const reason of ALL_PARK_REASONS) {
      test(reason, () => {
        const doc = renderNeedsOwner(needsOwnerInput({ reason }));
        const marker = '## What unblocks it\n';
        const start = doc.indexOf(marker) + marker.length;
        const end = doc.indexOf('\n\n## Ledger');
        expect(start).toBeGreaterThan(marker.length - 1);
        expect(end).toBeGreaterThan(start);
        const instruction = doc.slice(start, end).trim();
        expect(instruction.length).toBeGreaterThan(0);
        expect(instruction).toContain(needsOwnerInput().rerunCommand);
      });
    }

    test('all 22 values are covered by this table (model.ts is the source of truth)', () => {
      expect(ALL_PARK_REASONS.length).toBe(22);
    });
  });
});
