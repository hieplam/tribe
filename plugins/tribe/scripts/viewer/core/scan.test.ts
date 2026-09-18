import { describe, expect, test } from 'bun:test';
import type { Badge } from './model.ts';
import { buildScanIndex, partitionProjects, sessionCacheKey, type ScannedSessionInput } from './scan.ts';

const NOW_ISO = '2026-09-13T00:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

const userRow = (cwd: string | undefined, text: string) =>
  JSON.stringify({ type: 'user', ...(cwd ? { cwd } : {}), message: { role: 'user', content: text } });

function session(overrides: Partial<ScannedSessionInput> & { id: string; projectDir: string }): ScannedSessionInput {
  return {
    sizeBytes: 100,
    mtimeIso: NOW_ISO,
    headLines: [],
    tailLines: [],
    previousSizeBytes: null,
    subagentCount: 0,
    ...overrides,
  };
}

describe('buildScanIndex — ordering (spec §5.1)', () => {
  test('projects are ordered by newestMtimeIso descending', () => {
    const sessions: ScannedSessionInput[] = [
      session({ id: 's-old', projectDir: 'proj-old', mtimeIso: '2026-01-01T00:00:00.000Z' }),
      session({ id: 's-new', projectDir: 'proj-new', mtimeIso: '2026-09-01T00:00:00.000Z' }),
      session({ id: 's-mid', projectDir: 'proj-mid', mtimeIso: '2026-05-01T00:00:00.000Z' }),
    ];
    const index = buildScanIndex(['proj-old', 'proj-new', 'proj-mid'], sessions, new Map(), NOW_ISO);
    expect(index.projects.map((p) => p.dir)).toEqual(['proj-new', 'proj-mid', 'proj-old']);
  });

  test('sessions within a project are ordered mtimeIso descending', () => {
    const sessions: ScannedSessionInput[] = [
      session({ id: 's1', projectDir: 'proj-a', mtimeIso: '2026-01-01T00:00:00.000Z' }),
      session({ id: 's2', projectDir: 'proj-a', mtimeIso: '2026-06-01T00:00:00.000Z' }),
      session({ id: 's3', projectDir: 'proj-a', mtimeIso: '2026-03-01T00:00:00.000Z' }),
    ];
    const index = buildScanIndex(['proj-a'], sessions, new Map(), NOW_ISO);
    expect(index.sessionsByProject.get('proj-a')!.map((s) => s.id)).toEqual(['s2', 's3', 's1']);
  });

  test('a project directory with zero session files still appears, with sessionCount 0', () => {
    const index = buildScanIndex(['proj-empty'], [], new Map(), NOW_ISO);
    expect(index.projects).toEqual([{ dir: 'proj-empty', cwd: null, sessionCount: 0, newestMtimeIso: null, live: false }]);
    expect(index.sessionsByProject.get('proj-empty')).toEqual([]);
  });

  test('project cwd is the first non-null cwd seen across its sessions, in input order', () => {
    const sessions: ScannedSessionInput[] = [
      session({ id: 's1', projectDir: 'proj-a', headLines: [userRow(undefined, 'hi')] }),
      session({ id: 's2', projectDir: 'proj-a', headLines: [userRow('/Users/example/repo', 'hi')] }),
      session({ id: 's3', projectDir: 'proj-a', headLines: [userRow('/Users/example/other', 'hi')] }),
    ];
    const index = buildScanIndex(['proj-a'], sessions, new Map(), NOW_ISO);
    expect(index.projects[0]!.cwd).toBe('/Users/example/repo');
  });

  test('project.live is true when ANY of its sessions is live', () => {
    const sessions: ScannedSessionInput[] = [
      session({ id: 's1', projectDir: 'proj-a', mtimeIso: '2020-01-01T00:00:00.000Z', previousSizeBytes: 100, sizeBytes: 100 }),
      session({ id: 's2', projectDir: 'proj-a', mtimeIso: NOW_ISO, previousSizeBytes: 100, sizeBytes: 100 }),
    ];
    const index = buildScanIndex(['proj-a'], sessions, new Map(), NOW_ISO);
    expect(index.projects[0]!.live).toBe(true);
  });
});

describe('buildScanIndex — duplicate session id across projects (spec §5.2)', () => {
  test('an ordinary session (one project) has projects.length === 1', () => {
    const index = buildScanIndex(['proj-a'], [session({ id: 's1', projectDir: 'proj-a' })], new Map(), NOW_ISO);
    expect(index.sessionsByProject.get('proj-a')![0]!.projects).toEqual(['proj-a']);
  });

  test('the SAME session id under two project directories yields projects: string[] of length 2 on BOTH copies', () => {
    const sessions: ScannedSessionInput[] = [
      session({ id: 'dup-1', projectDir: 'proj-a', mtimeIso: '2026-01-01T00:00:00.000Z' }),
      session({ id: 'dup-1', projectDir: 'proj-b', mtimeIso: '2026-06-01T00:00:00.000Z' }),
    ];
    const index = buildScanIndex(['proj-a', 'proj-b'], sessions, new Map(), NOW_ISO);
    const copyInA = index.sessionsByProject.get('proj-a')!.find((s) => s.id === 'dup-1')!;
    const copyInB = index.sessionsByProject.get('proj-b')!.find((s) => s.id === 'dup-1')!;
    expect(copyInA.projects).toEqual(['proj-a', 'proj-b']);
    expect(copyInB.projects).toEqual(['proj-a', 'proj-b']);
  });

  test('the canonical sessionIndex entry resolves to the NEWEST-by-mtime copy (spec §5.2)', () => {
    const sessions: ScannedSessionInput[] = [
      session({ id: 'dup-1', projectDir: 'proj-old', mtimeIso: '2026-01-01T00:00:00.000Z', sizeBytes: 111 }),
      session({ id: 'dup-1', projectDir: 'proj-new', mtimeIso: '2026-06-01T00:00:00.000Z', sizeBytes: 222 }),
    ];
    const index = buildScanIndex(['proj-old', 'proj-new'], sessions, new Map(), NOW_ISO);
    const canonical = index.sessionIndex.get('dup-1')!;
    expect(canonical.projectDir).toBe('proj-new');
    expect(canonical.sizeBytes).toBe(222);
    expect(canonical.projects).toEqual(['proj-new', 'proj-old']); // still lists BOTH, sorted
  });
});

describe('buildScanIndex — badges (spec §9 wiring onto SessionSummary)', () => {
  test('a session with no badge entry gets badges: []', () => {
    const index = buildScanIndex(['proj-a'], [session({ id: 's1', projectDir: 'proj-a' })], new Map(), NOW_ISO);
    expect(index.sessionsByProject.get('proj-a')![0]!.badges).toEqual([]);
  });

  test('a session claimed by two campaigns carries BOTH badges (never drops one, spec §9)', () => {
    const badges: Badge[] = [
      { repoKey: 'repo-a', slug: 'fixture', cardId: 'C1', cardStatus: 'shipped', runnerAlive: false, runId: null },
      { repoKey: 'repo-b', slug: 'fixture', cardId: 'C1', cardStatus: 'shipped', runnerAlive: true, runId: 'r1' },
    ];
    const badgesBySessionId = new Map([['s1', badges]]);
    const index = buildScanIndex(['proj-a'], [session({ id: 's1', projectDir: 'proj-a' })], badgesBySessionId, NOW_ISO);
    expect(index.sessionsByProject.get('proj-a')![0]!.badges).toEqual(badges);
  });
});

describe('sessionCacheKey — spec §5.3 identity (both size AND mtime, plus inode)', () => {
  test('the exact format is path:sizeBytes:mtimeMs:inode', () => {
    expect(sessionCacheKey('/a/b.jsonl', { sizeBytes: 10, mtimeMs: 123, inode: 7 })).toBe('/a/b.jsonl:10:123:7');
  });

  test('same size, DIFFERENT mtime -> different key (a size-only key would collide and serve a stale title)', () => {
    const a = sessionCacheKey('/a/b.jsonl', { sizeBytes: 10, mtimeMs: 100, inode: 7 });
    const b = sessionCacheKey('/a/b.jsonl', { sizeBytes: 10, mtimeMs: 200, inode: 7 });
    expect(a).not.toBe(b);
  });

  test('same size AND mtime, different inode -> different key (a rewritten file reusing the same size+mtime)', () => {
    const a = sessionCacheKey('/a/b.jsonl', { sizeBytes: 10, mtimeMs: 100, inode: 7 });
    const b = sessionCacheKey('/a/b.jsonl', { sizeBytes: 10, mtimeMs: 100, inode: 8 });
    expect(a).not.toBe(b);
  });

  test('every field identical -> the same key (a genuine cache hit)', () => {
    const a = sessionCacheKey('/a/b.jsonl', { sizeBytes: 10, mtimeMs: 100, inode: 7 });
    const b = sessionCacheKey('/a/b.jsonl', { sizeBytes: 10, mtimeMs: 100, inode: 7 });
    expect(a).toBe(b);
  });
});

describe('partitionProjects — D10, spec §5.6', () => {
  const projectAt = (dir: string, daysAgo: number) => ({
    dir,
    cwd: null,
    sessionCount: 1,
    newestMtimeIso: new Date(NOW_MS - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    live: false,
  });

  test('a project whose newest session is 29 days old is recent', () => {
    const { recent, older } = partitionProjects([projectAt('p29', 29)], NOW_MS);
    expect(recent.map((p) => p.dir)).toEqual(['p29']);
    expect(older).toEqual([]);
  });

  test('a project whose newest session is 31 days old is older', () => {
    const { recent, older } = partitionProjects([projectAt('p31', 31)], NOW_MS);
    expect(recent).toEqual([]);
    expect(older.map((p) => p.dir)).toEqual(['p31']);
  });

  test('exactly 30 days is recent (the window is inclusive, "within 30 days")', () => {
    const { recent, older } = partitionProjects([projectAt('p30', 30)], NOW_MS);
    expect(recent.map((p) => p.dir)).toEqual(['p30']);
    expect(older).toEqual([]);
  });

  test('a project with no sessions at all (newestMtimeIso null) partitions as older', () => {
    const empty = { dir: 'p-empty', cwd: null, sessionCount: 0, newestMtimeIso: null, live: false };
    const { recent, older } = partitionProjects([empty], NOW_MS);
    expect(recent).toEqual([]);
    expect(older).toEqual([empty]);
  });

  test('the boundary is evaluated against the supplied nowMs, never Date.now() — a far-future nowMs makes a fresh project "older"', () => {
    const project = projectAt('p-fresh', 1); // 1 day old relative to NOW_MS
    const farFutureMs = NOW_MS + 365 * 24 * 60 * 60 * 1000;
    const { recent, older } = partitionProjects([project], farFutureMs);
    expect(recent).toEqual([]);
    expect(older).toEqual([project]);
  });

  test('sessions are never partitioned — only projects (D10 explicit)', () => {
    // A project 90 days old is "older", but partitionProjects only ever touches the Project list;
    // it has no session-shaped input at all, so there is no code path by which a session could be
    // excluded from a project's own session list. Documented via the type signature: this
    // function's parameter and return types are `Project[]`, never `SessionSummary[]`.
    const oldProject = projectAt('p-old', 90);
    const { older } = partitionProjects([oldProject], NOW_MS);
    expect(older[0]).toEqual(oldProject);
    expect(oldProject.sessionCount).toBe(1); // the session inside it was never touched by this call
  });

  test('respects a custom windowDays', () => {
    const { recent, older } = partitionProjects([projectAt('p10', 10)], NOW_MS, 7);
    expect(recent).toEqual([]);
    expect(older.map((p) => p.dir)).toEqual(['p10']);
  });
});
