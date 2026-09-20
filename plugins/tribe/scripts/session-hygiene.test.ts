// session-hygiene.test.ts — edge-boundary tests for the impure CLI wrapper (fail-closed-edges.md):
//
//   F2 proves `countFileOrNull` no longer disguises a PURE-core failure as an unreadable file —
//   the catch must be scoped to the file read only.
//   F3 proves `main()` turns any escaping error into a clean `session-hygiene: <message>` refusal
//   with a non-zero exit, instead of letting a raw stack trace reach the user.
//
// The mocked tests below use `mock.module` on the shared core path
// (`runner/core/metrics/session-hygiene.ts`) to force a synthetic, non-I/O failure — the real
// pure core never throws for malformed text, so a module mock is the only way to exercise this
// boundary. Bun's module mocks are PROCESS-WIDE and are NOT undone by `mock.restore()` (only spy
// mocks are), so:
//   - the mocked tests are declared LAST, after every test that needs the real core;
//   - this file must be run in its own `bun test` invocation, never combined in one process with
//     `runner/core/metrics/session-hygiene.test.ts` (which asserts the real core's regex
//     behaviour) or any other suite that imports that same core module.
import { expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countFileOrNull, main } from './session-hygiene.ts';

function makeRealLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-hygiene-edge-'));
  writeFileSync(join(dir, 'a.log'), 'hello');
  return dir;
}

test('F2 — a real I/O failure is still reported and skipped, never thrown', () => {
  const missing = join(tmpdir(), 'session-hygiene-does-not-exist-' + Date.now(), 'nope.log');
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(countFileOrNull(missing)).toBeNull();
    const messages = errorSpy.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes('skipping unreadable file'))).toBe(true);
  } finally {
    errorSpy.mockRestore();
  }
});

test('F3 — a genuine measurement run still exits 0 (unaffected by the new error boundary)', () => {
  const dir = makeRealLogDir();
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__process_exit_${code}__`);
  }) as never);
  try {
    expect(() => main(['--root', dir])).toThrow('__process_exit_0__');
  } finally {
    exitSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- mocked pure-core failure: PROCESS-WIDE module mock, keep these tests LAST in this file ---

test('F2 — a core failure surfaces as itself, not mislabeled "skipping unreadable file"', async () => {
  await mock.module('./runner/core/metrics/session-hygiene.ts', () => ({
    countSessionHygiene: () => {
      throw new TypeError('core exploded (not an I/O error)');
    },
  }));
  const { countFileOrNull: mockedCountFileOrNull } = await import('./session-hygiene.ts');
  const dir = makeRealLogDir();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    let thrown: unknown;
    try {
      mockedCountFileOrNull(join(dir, 'a.log'));
    } catch (err) {
      thrown = err;
    }
    // The pure core's own failure must propagate as ITSELF — the "skipping unreadable file"
    // refusal is reserved for genuine I/O failures, never a relabeling of a core bug.
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe('core exploded (not an I/O error)');
    const messages = errorSpy.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes('skipping unreadable file'))).toBe(false);
  } finally {
    errorSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F3 — main() turns an escaping core failure into a clean refusal, never a raw stack trace', async () => {
  // Reuses the core mock the previous test registered (module mocks are process-wide in Bun).
  const { main: mockedMain } = await import('./session-hygiene.ts');
  const dir = makeRealLogDir();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__process_exit_${code}__`);
  }) as never);
  try {
    let escaped: unknown;
    try {
      mockedMain(['--root', dir]);
    } catch (err) {
      escaped = err;
    }
    // The ONLY thing allowed to unwind out of main() is our test's own process.exit stub — a raw
    // TypeError from the core reaching here would be the bug (a traceback escaping a user CLI).
    expect(escaped).toBeInstanceOf(Error);
    const exitMessage = (escaped as Error).message;
    expect(exitMessage.startsWith('__process_exit_')).toBe(true);
    expect(exitMessage).not.toBe('__process_exit_0__'); // a genuine failure must not exit 0
    expect(errorSpy.mock.calls.length).toBe(1);
    const [reported] = errorSpy.mock.calls[0]!;
    expect(typeof reported).toBe('string');
    expect(reported as string).toMatch(/^session-hygiene: /);
    expect((reported as string).includes('\n')).toBe(false); // one clean line, not a stack trace
  } finally {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
