import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShellBounded } from './run-io.adapter.ts';

describe('runShellBounded (the Done edge)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rdo-done-'));
  test('exit code, cwd, env and both output streams', async () => {
    const r = await runShellBounded('echo "$RUNNER_CARD_ID in $(pwd)"; echo oops >&2; exit 3', { cwd, env: { RUNNER_CARD_ID: 'C1' }, timeoutMs: 10_000 });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toBe(`C1 in ${realpathSync(cwd)}\n`); // `pwd` resolves /var -> /private/var on macOS
    expect(r.stderr).toBe('oops\n');
  });
  test('a command past its timeout is killed and reported, never awaited forever', async () => {
    const started = Date.now();
    const r = await runShellBounded('sleep 30', { cwd, env: {}, timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
  test('a missing binary is a non-zero exit, not a throw', async () => {
    const r = await runShellBounded('definitely-not-a-binary-xyz', { cwd, env: {}, timeoutMs: 10_000 });
    expect(r.exitCode).toBe(127);
  });
});
