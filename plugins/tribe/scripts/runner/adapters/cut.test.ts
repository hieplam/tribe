import { expect, test } from 'bun:test';
import { mkdtempSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureAtCut, verifyBaseline } from './cut.ts';

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
