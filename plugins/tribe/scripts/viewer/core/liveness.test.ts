import { expect, test } from 'bun:test';
import { isLive } from './liveness.ts';

// spec §5.4 (D2), verbatim:
//   live = (sizeBytes grew since the previous scan) || (now - mtime <= 10 min)
// No pid, no campaign state, no lock file. Pure: takes size, the previous scan's size (or null on
// the first scan), an mtime and a `nowIso` — never stats anything itself.

const NOW = '2026-09-12T12:00:00.000Z';

test('grew since the previous scan, but mtime is well outside the 10 minute window — still live', () => {
  const result = isLive({
    sizeBytes: 2000,
    previousSizeBytes: 1000,
    mtimeIso: '2026-09-12T09:00:00.000Z', // 3 hours before NOW
    nowIso: NOW,
  });
  expect(result).toBe(true);
});

test('did not grow, but mtime is within the 10 minute window — live', () => {
  const result = isLive({
    sizeBytes: 1000,
    previousSizeBytes: 1000,
    mtimeIso: '2026-09-12T11:55:00.000Z', // 5 minutes before NOW
    nowIso: NOW,
  });
  expect(result).toBe(true);
});

test('exactly 10 minutes since mtime — the boundary is inclusive (<=)', () => {
  const result = isLive({
    sizeBytes: 1000,
    previousSizeBytes: 1000,
    mtimeIso: '2026-09-12T11:50:00.000Z', // exactly 10 minutes before NOW
    nowIso: NOW,
  });
  expect(result).toBe(true);
});

test('neither grew nor within the mtime window — not live', () => {
  const result = isLive({
    sizeBytes: 1000,
    previousSizeBytes: 1000,
    mtimeIso: '2026-09-12T09:00:00.000Z', // 3 hours before NOW
    nowIso: NOW,
  });
  expect(result).toBe(false);
});

test('the first scan: previousSizeBytes is null, so only the mtime half can fire', () => {
  // mtime outside the window -> not live, since "grew" cannot be evaluated without a previous size
  // and must not default to true.
  expect(
    isLive({ sizeBytes: 5000, previousSizeBytes: null, mtimeIso: '2026-09-12T09:00:00.000Z', nowIso: NOW }),
  ).toBe(false);

  // mtime within the window -> live, via the mtime half alone.
  expect(
    isLive({ sizeBytes: 5000, previousSizeBytes: null, mtimeIso: '2026-09-12T11:58:00.000Z', nowIso: NOW }),
  ).toBe(true);
});

test('shrinking (truncation/rotation) does not itself count as growth', () => {
  const result = isLive({
    sizeBytes: 500,
    previousSizeBytes: 1000,
    mtimeIso: '2026-09-12T09:00:00.000Z',
    nowIso: NOW,
  });
  expect(result).toBe(false);
});
