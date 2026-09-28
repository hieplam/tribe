import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRealIo } from './run-io.adapter.ts';

test('exec kills a child when its timeout expires', async () => {
  const io = buildRealIo({ homeDir: '/tmp' });
  const started = performance.now();
  const result = await io.exec(['sleep', '5'], { timeoutMs: 200 });

  expect(performance.now() - started).toBeLessThan(1_000);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toMatch(/timed out/i);
});

test('removeTree refuses a symlinked Done directory and preserves its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdo-done-link-'));
  const home = join(root, 'home');
  const outside = join(root, 'outside');
  mkdirSync(home);
  mkdirSync(join(outside, 'C1'), { recursive: true });
  writeFileSync(join(outside, 'C1', 'keep.txt'), 'keep');
  symlinkSync(outside, join(home, 'done'));

  expect(() => buildRealIo({ homeDir: home }).removeTree(join(home, 'done', 'C1'))).toThrow();
  expect(existsSync(join(outside, 'C1', 'keep.txt'))).toBe(true);
});
