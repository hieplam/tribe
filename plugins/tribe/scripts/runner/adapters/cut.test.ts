import { expect, test } from 'bun:test';
import { mkdtempSync, appendFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureAtCut, validateBaselineFile, verifyBaseline } from './cut.ts';

test('a transcript that GROWS still verifies byte-identically at its recorded cut', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    const row = (id: string) => JSON.stringify({
      type: 'assistant', isSidechain: false,
      message: { id, usage: { input_tokens: 1, cache_read_input_tokens: 2,
                              cache_creation_input_tokens: 0, output_tokens: 3 } },
    }) + '\n';
    writeFileSync(p, row('a') + row('b'));
    const first = measureAtCut(p, null);
    expect(first.cut.bytes).toBeGreaterThan(0);

    appendFileSync(p, row('c') + row('d'));           // the session kept running

    const again = measureAtCut(p, first.cut.bytes);
    expect(again.metrics).toEqual(first.metrics);      // the pinned numbers did not move
    expect(again.cut.sha256).toBe(first.cut.sha256);
    expect(verifyBaseline([{ sessionId: 's', path: p, ...first }])[0].status).toBe('verified');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a rewritten prefix is reported, never silently re-baselined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    writeFileSync(p, 'AAAA\n');
    const pinned = measureAtCut(p, null);
    writeFileSync(p, 'BBBB\nmore\n');                  // history rewritten
    const [r] = verifyBaseline([{ sessionId: 's', path: p, ...pinned }]);
    expect(r.status).toBe('prefix_mismatch');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file shorter than the cut is truncated, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    writeFileSync(p, 'AAAA\nBBBB\n');
    const pinned = measureAtCut(p, null);
    writeFileSync(p, 'AA');
    expect(verifyBaseline([{ sessionId: 's', path: p, ...pinned }])[0].status).toBe('truncated');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing file is absent, not a throw', () => {
  expect(verifyBaseline([{ sessionId: 's', path: '/nope/nope.jsonl',
    cut: { lines: 1, bytes: 1, sha256: 'x' }, metrics: {} as never }])[0].status).toBe('absent');
});

// Fix 3: --verify must prove the NUMBERS, not just the bytes — a hash match alone cannot
// catch a hand-edited metrics field (spec §15's --verify table: "metrics compared field by
// field").
test('a tampered metric (bytes/hash unchanged) is metrics_mismatch, not verified', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    const row = (id: string) => JSON.stringify({
      type: 'assistant', isSidechain: false,
      message: { id, usage: { input_tokens: 1, cache_read_input_tokens: 2,
                              cache_creation_input_tokens: 0, output_tokens: 3 } },
    }) + '\n';
    writeFileSync(p, row('a') + row('b'));
    const { cut, metrics } = measureAtCut(p, null);
    const tampered = { ...metrics, turns: metrics.turns + 1 }; // the hash still matches
    const [r] = verifyBaseline([{ sessionId: 's', path: p, cut, metrics: tampered }]);
    expect(r.status).toBe('metrics_mismatch');
    expect(r.detail).toContain('turns');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A `sessionId:''` field (accumulate()'s neutral default — see model.ts doc comment) must
// never itself trigger metrics_mismatch: it is a label the edge fills in later, not a
// measurement (Fix 3 brief: "excluding the identity field sessionId").
test('an entry whose recorded metrics.sessionId differs from the re-measured default still verifies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    writeFileSync(p, `${JSON.stringify({ type: 'assistant', message: { id: 'a' } })}\n`);
    const { cut, metrics } = measureAtCut(p, null);
    const entry = { sessionId: 'real-session-id', path: p, cut, metrics: { ...metrics, sessionId: 'real-session-id' } };
    expect(verifyBaseline([entry])[0].status).toBe('verified');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Fix 4: no stack trace on ANY input to --verify. An existing DIRECTORY at entry.path makes
// the real openSync/readSync throw EISDIR mid-verify — this must degrade to a typed status,
// never propagate.
test('an entry.path that is an existing DIRECTORY is unreadable, not a throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const subdir = join(dir, 'a-directory');
    mkdirSync(subdir);
    const [r] = verifyBaseline([{ sessionId: 's', path: subdir,
      cut: { lines: 1, bytes: 1, sha256: '0'.repeat(64) }, metrics: {} as never }]);
    expect(r.status).toBe('unreadable');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Fix 4: validateBaselineFile — a pure, exported, unit-tested validator. Table format per
// `readable-code.md` (name each case, branch on the name).
const VALID_ENTRY = {
  sessionId: 's1',
  path: '/tmp/s1.jsonl',
  cut: { lines: 10, bytes: 100, sha256: '0'.repeat(64) },
  metrics: {},
};
function validBaselineFile(overrides: Record<string, unknown> = {}) {
  return { v: 1, tool: 'transcript-metrics', generatedAt: 'x', sessions: [VALID_ENTRY], ...overrides };
}

test('validateBaselineFile accepts a well-formed file', () => {
  const got = validateBaselineFile(validBaselineFile());
  expect('entries' in got).toBe(true);
  if ('entries' in got) expect(got.entries).toHaveLength(1);
});

test('validateBaselineFile refuses a non-object', () => {
  for (const bad of [null, 42, 'x', [], true]) {
    const got = validateBaselineFile(bad);
    expect('error' in got).toBe(true);
  }
});

test('validateBaselineFile refuses v !== 1', () => {
  const got = validateBaselineFile(validBaselineFile({ v: 2 }));
  expect('error' in got).toBe(true);
});

test('validateBaselineFile refuses a tool that is not a non-empty string', () => {
  for (const bad of [123, '', null, undefined]) {
    const got = validateBaselineFile(validBaselineFile({ tool: bad }));
    expect('error' in got).toBe(true);
  }
});

test('validateBaselineFile refuses a sessions that is not a non-empty array', () => {
  for (const bad of [[], 'nope', null, {}]) {
    const got = validateBaselineFile(validBaselineFile({ sessions: bad }));
    expect('error' in got).toBe(true);
  }
});

test('validateBaselineFile refuses an entry missing a string sessionId', () => {
  const got = validateBaselineFile(validBaselineFile({ sessions: [{ ...VALID_ENTRY, sessionId: 42 }] }));
  expect('error' in got).toBe(true);
});

test('validateBaselineFile refuses an entry missing a string path', () => {
  const got = validateBaselineFile(validBaselineFile({ sessions: [{ ...VALID_ENTRY, path: null }] }));
  expect('error' in got).toBe(true);
});

test('validateBaselineFile refuses a cut whose lines/bytes are not positive integers', () => {
  for (const bad of [0, -1, 1.5, 'x', null]) {
    const got = validateBaselineFile(validBaselineFile({
      sessions: [{ ...VALID_ENTRY, cut: { ...VALID_ENTRY.cut, lines: bad } }],
    }));
    expect('error' in got).toBe(true);
  }
});

test('validateBaselineFile refuses a sha256 that is not 64 lowercase hex characters', () => {
  for (const bad of ['', 'F'.repeat(64), '0'.repeat(63), 'zz'.repeat(32), 123]) {
    const got = validateBaselineFile(validBaselineFile({
      sessions: [{ ...VALID_ENTRY, cut: { ...VALID_ENTRY.cut, sha256: bad } }],
    }));
    expect('error' in got).toBe(true);
  }
});
