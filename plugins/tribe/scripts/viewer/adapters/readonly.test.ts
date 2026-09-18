import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fsAdapter from './fs.adapter.ts';
import { isContainedResolved } from '../core/paths.ts';

// spec §2 (G4), §12.6 (7)/(D16), §12.2 (D14), `fail-closed-edges` obligation 1. This file asserts
// PROPERTIES of the adapter layer, not its implementation — it never reaches into `fs.adapter.ts`
// internals, only its exported surface and its raw source text.

const ADAPTER_SOURCE = readFileSync(join(import.meta.dir, 'fs.adapter.ts'), 'utf8');

describe('1. no write-capable export; the adapter satisfies the D16 allowlist', () => {
  const WRITE_CAPABLE_NAMES = [
    'writeFileSync', 'writeFile', 'write', 'writeSync', 'appendFile', 'appendFileSync',
    'copyFile', 'copyFileSync', 'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync',
    'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'rename', 'renameSync',
    'mkdir', 'mkdirSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'symlink', 'symlinkSync',
    'link', 'linkSync', 'utimes', 'utimesSync', 'createWriteStream',
  ];

  test('the exported surface contains no write-capable function', () => {
    const exported = Object.keys(fsAdapter);
    expect(exported.length).toBeGreaterThan(0);
    for (const name of WRITE_CAPABLE_NAMES) expect(exported).not.toContain(name);
  });

  test('the source names none of the write primitives the D16 allowlist forbids', () => {
    // The exact forbidden set spec §12.6(7c)/D16 names by example. Matched as a CALL SITE (a
    // name immediately followed by `(`), never a bare substring — so prose that merely mentions
    // one of these words (e.g. "truncated", "copying") in a doc comment is never a false alarm;
    // only an actual invocation is.
    const forbidden: Array<[string, RegExp]> = [
      ['Bun.write(...)', /\bBun\.write\s*\(/],
      ['createWriteStream(...)', /\bcreateWriteStream\s*\(/],
      ['copyFile(Sync)?(...)', /\bcopyFile(Sync)?\s*\(/],
      ['truncate(Sync)?(...)', /\btruncate(Sync)?\s*\(/],
      ["import from 'fs/promises'", /['"](node:)?fs\/promises['"]/],
    ];
    for (const [label, re] of forbidden) {
      expect({ label, present: re.test(ADAPTER_SOURCE) }).toEqual({ label, present: false });
    }
  });

  test('every node:fs import member is inside the D16 read allowlist', () => {
    const ALLOWED = new Set(['readFileSync', 'openSync', 'readSync', 'closeSync', 'statSync', 'lstatSync', 'readdirSync', 'realpathSync']);
    const m = ADAPTER_SOURCE.match(/import\s*\{([^}]*)\}\s*from\s*['"]node:fs['"]/);
    expect(m).not.toBeNull();
    const names = m![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(ALLOWED.has(name)).toBe(true);
  });

  test("openSync, when it appears, is only ever called with the literal read-only flag 'r'", () => {
    const calls = [...ADAPTER_SOURCE.matchAll(/openSync\(([^)]*)\)/g)];
    expect(calls.length).toBeGreaterThan(0); // the wall has something real to check here
    for (const call of calls) expect(call[1]).toMatch(/['"]r['"]/);
  });
});

describe("2. narrow catches are distinguishable — malformed content vs unreadable (fail-closed-edges obligation 1)", () => {
  // Neither outcome may come from a single `catch {}` wrapping both a file read AND a content
  // parse: `readTextCapped` only ever fails for a genuine filesystem problem (missing/unreadable),
  // never for the SHAPE of what it read, so a caller's own `JSON.parse` failure is always a
  // separately-observable outcome.
  let dir: string;

  test('a malformed-JSON file yields the "malformed" outcome (a SyntaxError from JSON.parse), reading succeeds', () => {
    dir = mkdtempSync(join(tmpdir(), 'readonly-catch-'));
    const malformedPath = join(dir, 'malformed.json');
    writeFileSync(malformedPath, '{ this is not valid json');
    const text = fsAdapter.readTextCapped(malformedPath, 4096);
    expect(text).not.toBeNull(); // the READ succeeded — the file is not "absent"
    let outcome: 'malformed' | 'ok' = 'ok';
    try {
      JSON.parse(text!);
    } catch (err) {
      expect(err).toBeInstanceOf(SyntaxError);
      outcome = 'malformed';
    }
    expect(outcome).toBe('malformed');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing file yields the "absent" outcome — distinct from "malformed", never collapsed together', () => {
    dir = mkdtempSync(join(tmpdir(), 'readonly-catch-'));
    const missingPath = join(dir, 'does-not-exist.json');
    expect(fsAdapter.readTextCapped(missingPath, 4096)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('an unreadable file (EACCES, chmod 000) ALSO yields "absent" — same outcome as ENOENT, never "malformed"', () => {
    dir = mkdtempSync(join(tmpdir(), 'readonly-catch-'));
    const unreadablePath = join(dir, 'locked.json');
    writeFileSync(unreadablePath, '{"valid": true}');
    chmodSync(unreadablePath, 0o000);
    try {
      // Root (and some CI sandboxes) can bypass file-mode permission checks entirely, in which
      // case EACCES never fires. Skip loudly rather than pass silently (anti-goal 5).
      const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
      if (isRoot) {
        console.warn('skipping EACCES case: running as root, chmod 000 is not enforced');
        return;
      }
      expect(fsAdapter.readTextCapped(unreadablePath, 4096)).toBeNull();
    } finally {
      chmodSync(unreadablePath, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('"malformed" and "absent" are two DIFFERENT results, not one catch-all', () => {
    dir = mkdtempSync(join(tmpdir(), 'readonly-catch-'));
    const malformedPath = join(dir, 'malformed.json');
    writeFileSync(malformedPath, 'not json at all {{{');
    const malformedRead = fsAdapter.readTextCapped(malformedPath, 4096);
    const absentRead = fsAdapter.readTextCapped(join(dir, 'nope.json'), 4096);
    // The malformed file's read succeeds (a string comes back); the absent one is null. If a
    // single `catch {}` swallowed both, these would be indistinguishable (both null).
    expect(typeof malformedRead).toBe('string');
    expect(absentRead).toBeNull();
    expect(malformedRead).not.toBe(absentRead);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('3. the three D14 symlink shapes, judged against the RESOLVED projects root — passed in, never re-derived', () => {
  // A local fixture (mkdtemp), not `serve.ts`'s own resolution of `CLAUDE_CONFIG_DIR`/`HOME`
  // (D32) — that resolution is `serve.ts`'s job (a later task). Here the resolved root is simply
  // handed in as a plain value, exactly as `isContainedResolved`'s contract requires.
  let tmp: string;
  let projectsRoot: string; // the RESOLVED root — never the session directory (D14)
  let sessionADir: string;
  let subagentsA: string;
  let sessionBSubagentsDir: string;
  let outsideDir: string;

  const cleanup: string[] = [];

  function setup() {
    tmp = mkdtempSync(join(tmpdir(), 'readonly-symlinks-'));
    cleanup.push(tmp);
    mkdirSync(join(tmp, 'projects'), { recursive: true });
    projectsRoot = realpathSync(join(tmp, 'projects'));

    sessionADir = join(projectsRoot, 'proj-A', 'session-A');
    subagentsA = join(sessionADir, 'subagents');
    mkdirSync(subagentsA, { recursive: true });

    sessionBSubagentsDir = join(projectsRoot, 'proj-B', 'session-B', 'subagents');
    mkdirSync(sessionBSubagentsDir, { recursive: true });
    writeFileSync(join(sessionBSubagentsDir, 'agent-sibling.jsonl'), 'sibling-content\n');

    outsideDir = mkdtempSync(join(tmpdir(), 'readonly-outside-'));
    cleanup.push(outsideDir);
    writeFileSync(join(outsideDir, 'evil.jsonl'), 'evil-content\n');
  }

  function teardown() {
    for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
  }

  /** Stands in for the routing decision a later task's composition root makes: resolve, then
   * check containment against the resolved root — never the session directory. Returns whether a
   * read would be SERVED, and whether a read was even ATTEMPTED (the broken case must refuse
   * BEFORE any read is attempted). */
  function decide(linkPath: string): { served: boolean; attemptedRead: boolean; content?: string } {
    const resolved = fsAdapter.realpathOrNull(linkPath);
    if (resolved === null) {
      // Broken symlink: refused without ever attempting a read.
      return { served: false, attemptedRead: false };
    }
    if (!isContainedResolved(projectsRoot, resolved)) {
      return { served: false, attemptedRead: false };
    }
    const content = Buffer.from(fsAdapter.readRange(resolved, 0, 4096)).toString('utf8');
    return { served: true, attemptedRead: true, content };
  }

  test('the sibling-session sidecar (real shape Claude Code writes) resolves INSIDE the root and IS served', () => {
    setup();
    try {
      const link = join(subagentsA, 'agent-sibling.jsonl');
      symlinkSync(join(sessionBSubagentsDir, 'agent-sibling.jsonl'), link);
      const result = decide(link);
      expect(result.served).toBe(true);
      expect(result.attemptedRead).toBe(true);
      expect(result.content).toBe('sibling-content\n');
      // A SESSION-rooted check (root = sessionADir, not projectsRoot) would have refused this —
      // proving the root really is what decides the outcome here, not merely a permissive check.
      const resolved = fsAdapter.realpathOrNull(link)!;
      expect(isContainedResolved(sessionADir, resolved)).toBe(false);
      expect(isContainedResolved(projectsRoot, resolved)).toBe(true);
    } finally {
      teardown();
    }
  });

  test('a symlink resolving OUTSIDE the projects root is refused', () => {
    setup();
    try {
      const link = join(subagentsA, 'escaping.jsonl');
      symlinkSync(join(outsideDir, 'evil.jsonl'), link);
      const result = decide(link);
      expect(result.served).toBe(false);
      expect(result.attemptedRead).toBe(false);
    } finally {
      teardown();
    }
  });

  test('a broken symlink is refused WITHOUT a read — realpathOrNull already returns null, so containment is never even checked', () => {
    setup();
    try {
      const link = join(subagentsA, 'broken.jsonl');
      symlinkSync(join(subagentsA, 'does-not-exist.jsonl'), link);
      expect(fsAdapter.realpathOrNull(link)).toBeNull();
      const result = decide(link);
      expect(result.served).toBe(false);
      expect(result.attemptedRead).toBe(false);
      expect(result.content).toBeUndefined();
    } finally {
      teardown();
    }
  });

  test('an ordinary, non-symlinked file inside the root is served — the check is not merely refusing everything', () => {
    setup();
    try {
      const ordinary = join(subagentsA, 'agent-ordinary.jsonl');
      writeFileSync(ordinary, 'ordinary-content\n');
      const result = decide(ordinary);
      expect(result.served).toBe(true);
      expect(result.content).toBe('ordinary-content\n');
    } finally {
      teardown();
    }
  });
});
