// The one named parser for a caught filesystem error's `code` (`rule-one-parser-per-edge-shape`,
// spec §5(a)/§5(b)). Fourteen call sites across cli/main.ts, adapters/cut.ts and three adapters
// narrowed `err.code` two different ways — a guarded `'code' in err` check (G-004's fingerprint,
// 2 sites) and a bare `(err as { code?: string }).code` cast (12 sites, no narrowing at all, which
// throws when `err` is `null`/`undefined`). `errorCode` replaces both with one narrowing that never
// throws, and — the ONE intended behavioural difference (spec §5) — returns `null` where the bare
// cast would have thrown reading `.code` off `null`/`undefined`.
import { expect, test } from 'bun:test';
import { errorCode } from './errno.ts';

test('a real Error carrying a string code returns that code', () => {
  const err = Object.assign(new Error('boom'), { code: 'ENOENT' });
  expect(errorCode(err)).toBe('ENOENT');
});

test('null returns null, never throws (the named behavioural improvement)', () => {
  expect(errorCode(null)).toBeNull();
});

test('undefined returns null, never throws (the named behavioural improvement)', () => {
  expect(errorCode(undefined)).toBeNull();
});

test('a plain object with no code property returns null', () => {
  expect(errorCode({ message: 'no code here' })).toBeNull();
});

test('a string thrown as the error returns null', () => {
  expect(errorCode('just a string')).toBeNull();
});

test('a number thrown as the error returns null', () => {
  expect(errorCode(42)).toBeNull();
});
