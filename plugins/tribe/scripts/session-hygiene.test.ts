// session-hygiene.test.ts — edge-boundary tests for the impure CLI wrapper (fail-closed-edges.md):
//
//   F2 proves `countFileOrNull` no longer disguises a PURE-core failure as an unreadable file —
//   the catch must be scoped to the file read only.
//   F3 proves `main()` turns any escaping error into a clean `session-hygiene: <message>` refusal
//   with a non-zero exit, instead of letting a raw stack trace reach the user.
//
// The core-failure tests below hand a throwing fake DIRECTLY to `countFileOrNull`/`main` as their
// injected `count` seam (pure-core.md: "a dependency may enter core logic only through an
// abstraction the caller supplies") — the real pure core never throws for malformed text, so a
// fake is the only way to exercise this boundary. This file mocks no module: Bun's module mocks
// are process-wide and are not undone by `mock.restore()`, so mocking the shared core module here
// would leak into every other suite in the process that imports it. An injected function leaks
// nothing — it lives only in this test's own call.
import { expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countFileOrNull, main } from './session-hygiene.ts';

function makeRealLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-hygiene-edge-'));
  writeFileSync(join(dir, 'a.log'), 'hello');
  return dir;
}

const throwingCount = (): never => {
  throw new TypeError('core exploded (not an I/O error)');
};

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

test('F2 — a core failure surfaces as itself, not mislabeled "skipping unreadable file"', () => {
  const dir = makeRealLogDir();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    let thrown: unknown;
    try {
      countFileOrNull(join(dir, 'a.log'), throwingCount);
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

test('G2 — a nonexistent --root refuses with a non-zero exit and prints no report (text mode)', () => {
  const missingRoot = join(tmpdir(), 'session-hygiene-nonexistent-root-' + Date.now());
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__process_exit_${code}__`);
  }) as never);
  try {
    expect(() => main(['--root', missingRoot])).toThrow(/^__process_exit_(?!0__)/);
    // A typo'd root must not look like a clean, empty scan (G2): no report body at all.
    expect(logSpy.mock.calls.length).toBe(0);
    const messages = errorSpy.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.startsWith('session-hygiene: ') && !m.includes('\n'))).toBe(true);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  }
});

test('G2 — a nonexistent --root refuses with a non-zero exit and prints no report (--json mode)', () => {
  const missingRoot = join(tmpdir(), 'session-hygiene-nonexistent-root-json-' + Date.now());
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__process_exit_${code}__`);
  }) as never);
  try {
    expect(() => main(['--root', missingRoot, '--json'])).toThrow(/^__process_exit_(?!0__)/);
    // Even in --json mode, a bad root must not print a JSON payload that reads as "0 -> 0, clean".
    expect(logSpy.mock.calls.length).toBe(0);
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  }
});

test('F3 — main() turns an escaping core failure into a clean refusal, never a raw stack trace', () => {
  const dir = makeRealLogDir();
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__process_exit_${code}__`);
  }) as never);
  try {
    let escaped: unknown;
    try {
      main(['--root', dir], throwingCount);
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
