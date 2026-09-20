import { describe, expect, test } from 'bun:test';
import { countFalseStalls } from './replay.ts';

/** The recorded field shape: a stall 2 ms after a quota relaunch (campaign supervisor-hardening,
 * 2026-09-19T20:30:30.004Z -> .006Z). Numbers only; no owner content. */
const RECORDED_FALSE_STALL = [
  { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
  { at: '2026-09-19T20:30:30.006Z', action: 'stall' },
];

describe('countFalseStalls — the D5 ratchet', () => {
  test('flags a stall that follows a relaunch inside the window', () => {
    const hits = countFalseStalls(RECORDED_FALSE_STALL);
    expect(hits.length).toBe(1);
    expect(hits[0]?.afterAction).toBe('relaunch');
    expect(hits[0]?.gapMs).toBe(2);
  });

  test('flags a stall that follows an initial launch (the 2026-09-17 shape)', () => {
    expect(countFalseStalls([
      { at: '2026-09-17T14:41:33.853Z', action: 'launch' },
      { at: '2026-09-17T14:41:33.856Z', action: 'stall' },
    ]).length).toBe(1);
  });

  test('does NOT flag a stall well outside the window', () => {
    expect(countFalseStalls([
      { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
      { at: '2026-09-19T21:30:30.004Z', action: 'stall' },
    ])).toEqual([]);
  });

  test('does NOT flag a stall with no preceding launch at all', () => {
    expect(countFalseStalls([{ at: '2026-09-19T20:30:30.004Z', action: 'stall' }])).toEqual([]);
  });

  test('an event stream with no stall at all is clean', () => {
    expect(countFalseStalls([
      { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
      { at: '2026-09-19T20:30:31.000Z', action: 'attach' },
      { at: '2026-09-19T22:47:00.000Z', action: 'exit' },
    ])).toEqual([]);
  });

  test('fails closed: an unparseable timestamp is reported, never silently cleared', () => {
    expect(countFalseStalls([
      { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
      { at: 'not-a-timestamp', action: 'stall' },
    ]).length).toBe(1);
  });

  test('the window is a parameter, and the boundary is inclusive', () => {
    const events = [
      { at: '2026-09-19T20:00:00.000Z', action: 'relaunch' },
      { at: '2026-09-19T20:01:00.000Z', action: 'stall' },
    ];
    expect(countFalseStalls(events, 60_000).length).toBe(1);
    expect(countFalseStalls(events, 59_999)).toEqual([]);
  });
});
