import { expect, test } from 'bun:test';
import { containedJoin, sanitizeProjectDirName, subagentsDirOf, toolResultsDirOf, transcriptPathOf } from './paths.ts';

// --- sanitizeProjectDirName — carried over UNCHANGED from core/live/paths.test.ts. The encoding
// is ported from Claude Code's own and must not drift. ---

test('encodes a real repo path exactly as Claude Code does (verified on disk)', () => {
  expect(sanitizeProjectDirName('/Users/hip/repo/wiki-harness')).toBe('-Users-hip-repo-wiki-harness');
  expect(sanitizeProjectDirName('/Users/hip/repo/todd-skills')).toBe('-Users-hip-repo-todd-skills');
});

test('a path longer than 200 sanitized chars is truncated and hash-suffixed', () => {
  const long = `/Users/hip/${'a'.repeat(300)}`;
  const out = sanitizeProjectDirName(long);
  expect(out.length).toBeGreaterThan(200);
  expect(out.slice(0, 200)).toBe(long.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200));
  expect(out[200]).toBe('-');
  expect(sanitizeProjectDirName(long)).toBe(out);
});

// The hash enters through a caller-supplied SEAM (pure-core.md): given its inputs the core is
// deterministic, and the INJECTED hasher — not any ambient global — decides the >200-char suffix.
test('sanitizeProjectDirName takes the hash through an injected seam — the seam decides the suffix', () => {
  const long = `/Users/hip/${'a'.repeat(300)}`;
  const prefix = long.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200);
  const out = sanitizeProjectDirName(long, () => 'STUBHASH');
  expect(out).toBe(`${prefix}-STUBHASH`);
  // deterministic: same inputs (same seam) → identical output
  expect(sanitizeProjectDirName(long, () => 'STUBHASH')).toBe(out);
  // a DIFFERENT injected hasher yields a DIFFERENT suffix — proving the seam, not a global, decides it
  expect(sanitizeProjectDirName(long, () => 'OTHER')).toBe(`${prefix}-OTHER`);
});

// --- fixed-layout helpers (spec line ~402, §7.6) ---

test('builds the transcript and subagent locations from a session id', () => {
  const dir = '/home/.claude/projects/-Users-hip-repo-wiki-harness';
  expect(transcriptPathOf(dir, 'abc-123')).toBe(`${dir}/abc-123.jsonl`);
  expect(subagentsDirOf(dir, 'abc-123')).toBe(`${dir}/abc-123/subagents`);
});

test('builds the tool-results spill directory from a session id (spec §7.6, <persisted-output>)', () => {
  const dir = '/home/.claude/projects/-Users-hip-repo-wiki-harness';
  expect(toolResultsDirOf(dir, 'abc-123')).toBe(`${dir}/abc-123/tool-results`);
});

// --- fixed-layout helpers route the sessionId through `containedJoin` (spec §12.2:
// "everything path-shaped goes through it"). A hostile sessionId must be REFUSED (`null`) — never
// an escaping path, never a partial path, never a throw — mirroring `containedJoin`'s contract. ---

const PROJECT_DIR = '/home/.claude/projects/-Users-hip-repo-wiki-harness';

// The exact Sol probe: a raw `join` returned `/etc/passwd.jsonl`, escaping the root. Now refused.
test('transcriptPathOf refuses a sessionId that escapes the root (the Sol probe)', () => {
  expect(transcriptPathOf('/safe/project', '../../../../etc/passwd')).toBeNull();
});

const HOSTILE_SESSION_IDS: Array<[string, string]> = [
  ['a parent-traversal payload', '../../etc/passwd'],
  ['a slash-bearing id', 'a/b'],
  ['exactly ".."', '..'],
  ['an empty id', ''],
  ['an id carrying a NUL byte', 'a\x00b'],
];

for (const [label, sessionId] of HOSTILE_SESSION_IDS) {
  test(`transcriptPathOf refuses ${label}`, () => {
    expect(transcriptPathOf(PROJECT_DIR, sessionId)).toBeNull();
  });
  test(`subagentsDirOf refuses ${label}`, () => {
    expect(subagentsDirOf(PROJECT_DIR, sessionId)).toBeNull();
  });
  test(`toolResultsDirOf refuses ${label}`, () => {
    expect(toolResultsDirOf(PROJECT_DIR, sessionId)).toBeNull();
  });
}

test('a safe sessionId still yields the correct contained paths from all three helpers', () => {
  expect(transcriptPathOf(PROJECT_DIR, 'abc-123')).toBe(`${PROJECT_DIR}/abc-123.jsonl`);
  expect(subagentsDirOf(PROJECT_DIR, 'abc-123')).toBe(`${PROJECT_DIR}/abc-123/subagents`);
  expect(toolResultsDirOf(PROJECT_DIR, 'abc-123')).toBe(`${PROJECT_DIR}/abc-123/tool-results`);
});

// --- containedJoin — the LEXICAL stage (spec §12.2). Pure string math: no filesystem access, no
// symlink following. Every case below returns `null` — never a throw, never a partial path. ---

const ROOT = '/home/.claude/projects/-Users-hip-repo-wiki-harness';

test('refuses an empty segment', () => {
  expect(containedJoin(ROOT, '')).toBeNull();
});

test('refuses a segment that is exactly "."', () => {
  expect(containedJoin(ROOT, '.')).toBeNull();
});

test('refuses a segment that is exactly ".."', () => {
  expect(containedJoin(ROOT, '..')).toBeNull();
});

test('refuses a segment containing a forward slash', () => {
  expect(containedJoin(ROOT, 'a/b')).toBeNull();
});

test('refuses a segment containing a backslash', () => {
  expect(containedJoin(ROOT, 'a\\b')).toBeNull();
});

test('refuses a segment containing a NUL byte', () => {
  expect(containedJoin(ROOT, 'a\x00b')).toBeNull();
});

test('refuses an absolute segment', () => {
  expect(containedJoin(ROOT, '/etc/passwd')).toBeNull();
});

test('refuses a multi-segment call that would resolve back inside root through a harmless "."', () => {
  // `resolve(ROOT, 'a', '.', 'b')` collapses to a path safely inside root, but the exact-match
  // "." segment is refused UNCONDITIONALLY. A design that checks only the final resolved path
  // would let this through — that is exactly the mistake obligation 4 exists to prevent.
  expect(containedJoin(ROOT, 'a', '.', 'b')).toBeNull();
});

test('refuses a 300-character segment (over the 255-byte single POSIX path-component limit)', () => {
  expect(containedJoin(ROOT, 'a'.repeat(300))).toBeNull();
});

test('accepts an ordinary segment and returns the joined path — a check that refuses everything proves nothing', () => {
  expect(containedJoin(ROOT, 'abc-123.jsonl')).toBe(`${ROOT}/abc-123.jsonl`);
});
