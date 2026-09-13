import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listDirOrEmpty,
  readHead,
  readRange,
  readTail,
  readTextCapped,
  realpathOrNull,
  statOrNull,
} from './fs.adapter.ts';
import { buildHomeA, PROJECT_A_DIR, SESSION_1_ID, SESSION_2_ID, PROJECT_B_DIR, SUBAGENT_IDS } from '../fixtures/build.ts';

// Against the task-1 fixture (`fixtures/build.ts`), built fresh from an empty `mkdtemp`
// (`fixtures-mirror-reality.md` obligation 2) — never hand-typed strings standing in for a real
// tree.
let home: string;
let sessionPath: string;
let subagentsDir: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'fs-adapter-'));
  buildHomeA(home);
  sessionPath = join(home, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_1_ID}.jsonl`);
  subagentsDir = join(home, 'cfg', 'projects', PROJECT_A_DIR, SESSION_1_ID, 'subagents');
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('statOrNull', () => {
  test('a missing file returns null', () => {
    expect(statOrNull(join(home, 'nope.jsonl'))).toBeNull();
  });

  test('a real file returns a FileObservation whose inode is genuinely st.ino (task 19 depends on this)', () => {
    const real = statSync(sessionPath);
    const obs = statOrNull(sessionPath);
    expect(obs).not.toBeNull();
    expect(obs!.inode).toBe(real.ino);
    expect(obs!.sizeBytes).toBe(real.size);
    expect(obs!.mtimeMs).toBe(real.mtimeMs);
    expect(obs!.birthtimeMs).toBe(real.birthtimeMs);
  });
});

describe('listDirOrEmpty', () => {
  test('a missing directory returns []', () => {
    expect(listDirOrEmpty(join(home, 'no-such-dir'))).toEqual([]);
  });

  test('a real directory lists its real entries (the fixture subagents dir)', () => {
    const names = listDirOrEmpty(subagentsDir);
    expect(names).toContain(`agent-${SUBAGENT_IDS.root}.jsonl`);
    expect(names).toContain(`agent-${SUBAGENT_IDS.root}.meta.json`);
    // The sibling-session symlink (D14) is a real directory entry too — readdir never resolves it.
    expect(names).toContain(`agent-${SUBAGENT_IDS.sibling}.jsonl`);
  });
});

describe('readRange', () => {
  test('returns exactly the requested bytes, as a Uint8Array, matching a whole-file read', () => {
    const whole = readFileSync(sessionPath);
    const chunk = readRange(sessionPath, 0, whole.length);
    expect(chunk).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(chunk).equals(whole)).toBe(true);
  });

  test('returns exactly a MIDDLE slice, not just a prefix', () => {
    const whole = readFileSync(sessionPath);
    const start = 10;
    const end = Math.min(whole.length, start + 37);
    const chunk = readRange(sessionPath, start, end);
    expect(Buffer.from(chunk).equals(whole.subarray(start, end))).toBe(true);
  });

  test('throws on a genuine read failure (load-bearing: the poller turns this into an error frame)', () => {
    expect(() => readRange(join(home, 'nope.jsonl'), 0, 10)).toThrow();
  });
});

describe('readHead / readTail — raw byte ranges, no line-boundary decision (that is core/window.ts)', () => {
  test('readHead returns exactly the first N bytes of the real file', () => {
    const whole = readFileSync(sessionPath);
    const n = 25;
    const head = readHead(sessionPath, n);
    expect(Buffer.from(head).equals(whole.subarray(0, n))).toBe(true);
  });

  test('readTail returns exactly the last N bytes of the real file', () => {
    const whole = readFileSync(sessionPath);
    const n = 40;
    const tail = readTail(sessionPath, n);
    expect(Buffer.from(tail).equals(whole.subarray(whole.length - n))).toBe(true);
  });

  test('readHead/readTail never split a line themselves — a boundary landing mid-line comes back mid-line, raw', () => {
    // A head/tail window is not guaranteed to land on a newline; proving it comes back exactly as
    // requested (not trimmed to the last complete line) is what proves no line-boundary decision
    // happened here — that decision belongs to core/window.ts#completeLines.
    const whole = readFileSync(sessionPath);
    const n = 33; // a size not chosen to land on a newline
    const head = readHead(sessionPath, n);
    expect(head.length).toBe(n);
    expect(Buffer.from(head).equals(whole.subarray(0, n))).toBe(true);
  });
});

describe('readTextCapped', () => {
  test('refuses (null) a file whose size exceeds the cap, without returning a truncated prefix', () => {
    const metaPath = join(subagentsDir, `agent-${SUBAGENT_IDS.root}.meta.json`);
    const size = statSync(metaPath).size;
    expect(readTextCapped(metaPath, size - 1)).toBeNull();
  });

  test('returns the full decoded text when the file is within the cap', () => {
    const metaPath = join(subagentsDir, `agent-${SUBAGENT_IDS.root}.meta.json`);
    const expected = readFileSync(metaPath, 'utf8');
    expect(readTextCapped(metaPath, expected.length + 1024)).toBe(expected);
  });

  test('a missing file returns null, not a throw', () => {
    expect(readTextCapped(join(home, 'nope.json'), 4096)).toBeNull();
  });
});

describe('realpathOrNull', () => {
  test('resolves a real (non-symlink) file to itself', () => {
    expect(realpathOrNull(sessionPath)).toBe(realpathSync(sessionPath));
  });

  test('resolves a symlink to its real target — the sibling-session sidecar (D14)', () => {
    const linkPath = join(subagentsDir, `agent-${SUBAGENT_IDS.sibling}.jsonl`);
    const resolved = realpathOrNull(linkPath);
    expect(resolved).not.toBeNull();
    expect(resolved).toContain(PROJECT_B_DIR);
    expect(resolved).toContain(SESSION_2_ID);
  });

  test('returns null for a broken symlink', () => {
    const brokenDir = mkdtempSync(join(tmpdir(), 'fs-adapter-broken-'));
    const brokenLink = join(brokenDir, 'broken.jsonl');
    symlinkSync(join(brokenDir, 'does-not-exist.jsonl'), brokenLink);
    try {
      expect(realpathOrNull(brokenLink)).toBeNull();
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });

  test('FAILS CLOSED on a symlink LOOP (ELOOP): returns null, never a thrown traceback through the HTTP handler (C1, fail-closed obligation 1)', () => {
    const loopDir = mkdtempSync(join(tmpdir(), 'fs-adapter-loop-'));
    const a = join(loopDir, 'a');
    const b = join(loopDir, 'b');
    // a -> b -> a: resolving either raises ELOOP. Before the fix, realpathOrNull rethrew ELOOP (only
    // ENOENT/EACCES were caught), so a hostile symlink loop crashed the request with a stack trace
    // instead of degrading to "not a real target".
    symlinkSync(b, a);
    symlinkSync(a, b);
    try {
      expect(realpathOrNull(a)).toBeNull();
    } finally {
      rmSync(loopDir, { recursive: true, force: true });
    }
  });

  test('FAILS CLOSED when a path component is not a directory (ENOTDIR): returns null, never throws', () => {
    const notDirRoot = mkdtempSync(join(tmpdir(), 'fs-adapter-notdir-'));
    const file = join(notDirRoot, 'a-file');
    writeFileSync(file, 'x');
    // Treating the file as a directory prefix — realpath raises ENOTDIR, which must degrade to null.
    const throughFile = join(file, 'child.jsonl');
    try {
      expect(realpathOrNull(throughFile)).toBeNull();
    } finally {
      rmSync(notDirRoot, { recursive: true, force: true });
    }
  });
});

describe('D13 — the adapter decodes nothing on the transcript byte-range path', () => {
  const source = readFileSync(join(import.meta.dir, 'fs.adapter.ts'), 'utf8');

  test('no TextDecoder anywhere in the module', () => {
    expect(source.includes('TextDecoder')).toBe(false);
  });

  test('readRange/readHead/readTail bodies never decode (no readFileSync, no "utf8")', () => {
    for (const name of ['readRange', 'readHead', 'readTail']) {
      const body = functionBody(source, name);
      expect(body).not.toBeNull();
      expect(body!.includes('readFileSync')).toBe(false);
      expect(body!.includes("'utf8'")).toBe(false);
    }
  });
});

/** Slices out one top-level `export function <name>(...) { ... }` body from `source`, from its
 * `export function <name>` marker up to the next `export function`/`export const` at column 0, or
 * EOF. Good enough for this file's flat shape; not a general parser. */
function functionBody(source: string, name: string): string | null {
  const marker = `export function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const rest = source.slice(start + marker.length);
  const nextExportMatch = rest.match(/\n(export (function|const))/);
  const end = nextExportMatch ? start + marker.length + nextExportMatch.index! : source.length;
  return source.slice(start, end);
}
