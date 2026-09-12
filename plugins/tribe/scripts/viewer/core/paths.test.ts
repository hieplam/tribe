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
