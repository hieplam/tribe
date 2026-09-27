import { expect, test } from 'bun:test';
import { buildRealIo } from './run-io.adapter.ts';

test('exec kills a child when its timeout expires', async () => {
  const io = buildRealIo({ homeDir: '/tmp' });
  const started = performance.now();
  const result = await io.exec(['sleep', '5'], { timeoutMs: 200 });

  expect(performance.now() - started).toBeLessThan(1_000);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toMatch(/timed out/i);
});
