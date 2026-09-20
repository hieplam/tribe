import { describe, expect, test } from 'bun:test';
import { isOwnRunVisible, isStale, newestLog, newestRunId, watchdogPathsOf } from './select.ts';

describe('newestRunId', () => {
  test('run ids are ISO-prefixed, so lexicographic max is chronological max', () => {
    expect(newestRunId([
      '2026-09-02T19-06-46-423Z-7bb7',
      '2026-09-03T00-19-29-351Z-bc5c',
      '2026-09-02T23-41-49-682Z-95ee',
    ])).toBe('2026-09-03T00-19-29-351Z-bc5c');
  });
  test('no runs yields null', () => {
    expect(newestRunId([])).toBe(null);
  });
});

describe('newestLog', () => {
  test('picks the greatest mtime, tie-broken by name for determinism', () => {
    expect(newestLog([
      { name: 'a-1.log', mtimeMs: 10 },
      { name: 'b-2.log', mtimeMs: 30 },
      { name: 'c-3.log', mtimeMs: 30 },
    ])).toEqual({ name: 'c-3.log', mtimeMs: 30 });
  });
  test('an empty logs dir yields null', () => {
    expect(newestLog([])).toBe(null);
  });
});

describe('isStale', () => {
  test('strictly greater than the threshold is stale', () => {
    const now = 1_000 * 60 * 60;
    expect(isStale(now, now - 30 * 60_000, 30)).toBe(false);
    expect(isStale(now, now - 30 * 60_000 - 1, 30)).toBe(true);
  });
  test('a run with no log yet is never stale', () => {
    expect(isStale(1_000, null, 30)).toBe(false);
  });

  // FIX F-C5 (audit round 2): `mtimeMs === null` used to mean "never stale" UNCONDITIONALLY —
  // a run that dies before writing its first log line had no bound at all (a reviewer
  // reproduced the runaway attach loop until `RangeError: Out of memory`). The 4th argument
  // lets a caller supply the record's own `startedAt` as a fallback silence-clock.
  describe('FIX F-C5: a defined answer when no log line has ever been written', () => {
    test('with no fallback clock supplied, stays never-stale (3-arg call sites unchanged)', () => {
      const now = 1_000 * 60 * 60;
      expect(isStale(now, null, 30, null)).toBe(false);
    });
    test('past the threshold since startedAt, with no log ever written, IS stale', () => {
      const now = 1_000 * 60 * 60;
      const startedAtMs = now - 31 * 60_000;
      expect(isStale(now, null, 30, startedAtMs)).toBe(true);
    });
    test('within the threshold since startedAt, with no log ever written, is not yet stale', () => {
      const now = 1_000 * 60 * 60;
      const startedAtMs = now - 29 * 60_000;
      expect(isStale(now, null, 30, startedAtMs)).toBe(false);
    });
  });
});

describe('isOwnRunVisible — D2: only a directory newer than everything present at spawn is ours', () => {
  const cases: Array<[newest: string | null, prior: string | null, want: boolean, why: string]> = [
    [null, null, false, 'nothing on disk yet, nothing before: our run is not visible'],
    [null, 'r1', false, 'nothing on disk at all'],
    ['r1', null, true, 'nothing preceded this child, so the one directory present is its own'],
    ['r1', 'r1', false, 'the newest directory is the SAME one that predated the spawn'],
    ['r1', 'r2', false, 'the newest directory is OLDER than what predated the spawn'],
    ['r2', 'r1', true, 'a strictly newer directory appeared after the spawn'],
    ['2026-09-19T20-30-30-069Z-6185', '2026-09-19T19-29-58-328Z-dcb2', true,
      'the recorded supervisor-hardening pair: the new run dir is newer than the old one'],
    ['2026-09-19T19-29-58-328Z-dcb2', '2026-09-19T19-29-58-328Z-dcb2', false,
      'the recorded supervisor-hardening old run, still the newest 2 ms after the relaunch'],
  ];
  for (const [newest, prior, want, why] of cases) {
    test(`newest=${String(newest)} prior=${String(prior)} -> ${want} (${why})`, () => {
      expect(isOwnRunVisible(newest, prior)).toBe(want);
    });
  }
});

describe('watchdogPathsOf (W-P9: the watchdog writes only under home/watchdog)', () => {
  test('every output path sits under the watchdog directory', () => {
    const p = watchdogPathsOf('/h/.tribe/k/campaigns/c');
    expect(p.dir).toBe('/h/.tribe/k/campaigns/c/watchdog');
    expect(p.status).toBe('/h/.tribe/k/campaigns/c/watchdog/status.json');
    expect(p.events).toBe('/h/.tribe/k/campaigns/c/watchdog/events.jsonl');
    expect(p.runnerStdout(3)).toBe(
      '/h/.tribe/k/campaigns/c/watchdog/runner-stdout/attempt-3.log',
    );
    for (const value of [p.status, p.events, p.runnerStdout(0)]) {
      expect(value.startsWith(`${p.dir}/`)).toBe(true);
    }
  });
});
