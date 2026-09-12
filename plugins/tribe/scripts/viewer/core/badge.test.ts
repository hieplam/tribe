// core/badge.test.ts — spec §9 (campaign badge), closes B3 (state-file path traversal).
import { describe, expect, test } from 'bun:test';
import { buildBadgeIndex, selectCampaigns, type CampaignScan } from './badge.ts';

const alwaysAlive = () => true;
const neverAlive = () => false;

function scan(repoKey: string, slug: string, state: unknown, runs: readonly unknown[] = []): CampaignScan {
  return { repoKey, slug, state, runs };
}

describe('buildBadgeIndex', () => {
  test('a well-formed state file indexes every card with a valid session id', () => {
    const state = {
      sequence: ['C1', 'C2'],
      cards: {
        C1: { status: 'running', sessionId: 'a0000000-0000-4000-8000-000000000001' },
        C2: { status: 'merged', sessionId: 'b0000000-0000-4000-8000-000000000002' },
      },
    };
    const { index, skippedBadges } = buildBadgeIndex([scan('repoA', 'slug1', state)], alwaysAlive);
    expect(index.get('a0000000-0000-4000-8000-000000000001')).toEqual([
      { repoKey: 'repoA', slug: 'slug1', cardId: 'C1', cardStatus: 'running', runnerAlive: false, runId: null },
    ]);
    expect(index.get('b0000000-0000-4000-8000-000000000002')).toEqual([
      { repoKey: 'repoA', slug: 'slug1', cardId: 'C2', cardStatus: 'merged', runnerAlive: false, runId: null },
    ]);
    expect(skippedBadges).toBe(0);
  });

  test('a card with a null sessionId is skipped: no entry, not counted in skipped', () => {
    const state = {
      sequence: ['C1'],
      cards: { C1: { status: 'staged', sessionId: null } },
    };
    const { index, skippedBadges } = buildBadgeIndex([scan('repoA', 'slug1', state)], alwaysAlive);
    expect(index.size).toBe(0);
    expect(skippedBadges).toBe(0);
  });

  test('a sessionId failing the id charset is dropped AND counted in skipped', () => {
    const state = {
      sequence: ['C1'],
      cards: { C1: { status: 'running', sessionId: 'not-hex-!!' } },
    };
    const { index, skippedBadges } = buildBadgeIndex([scan('repoA', 'slug1', state)], alwaysAlive);
    expect(index.size).toBe(0);
    expect(skippedBadges).toBe(1);
  });

  // B3: the security case, named explicitly by the plan/spec.
  test('B3: a sessionId of ../../../etc/passwd indexes NOTHING and is counted in skipped', () => {
    const state = {
      sequence: ['C1'],
      cards: { C1: { status: 'running', sessionId: '../../../etc/passwd' } },
    };
    const { index, skippedBadges } = buildBadgeIndex([scan('repoA', 'slug1', state)], alwaysAlive);
    expect(index.size).toBe(0);
    expect(index.has('../../../etc/passwd')).toBe(false);
    expect(skippedBadges).toBe(1);
  });

  test('a malformed state file (not an object) contributes nothing and does not throw', () => {
    expect(() => buildBadgeIndex([scan('repoA', 'slug1', 'not json')], alwaysAlive)).not.toThrow();
    const { index, skippedBadges } = buildBadgeIndex([scan('repoA', 'slug1', 'not json')], alwaysAlive);
    expect(index.size).toBe(0);
    expect(skippedBadges).toBe(0);
  });

  test('a malformed state file (missing sequence/cards) contributes nothing and does not throw', () => {
    const cases: unknown[] = [null, {}, { sequence: 'nope', cards: {} }, { sequence: [], cards: null }, 42, []];
    for (const bad of cases) {
      expect(() => buildBadgeIndex([scan('repoA', 'slug1', bad)], alwaysAlive)).not.toThrow();
      const { index, skippedBadges } = buildBadgeIndex([scan('repoA', 'slug1', bad)], alwaysAlive);
      expect(index.size).toBe(0);
      expect(skippedBadges).toBe(0);
    }
  });

  test('runnerAlive is true only when endedAt is null AND the injected pid probe says alive', () => {
    const state = {
      sequence: ['C1'],
      cards: { C1: { status: 'running', sessionId: 'a0000000-0000-4000-8000-000000000001' } },
    };
    const runningRun = { runId: 'r1', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, pid: 123 };
    const endedRun = { runId: 'r1', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T01:00:00.000Z', pid: 123 };

    const aliveResult = buildBadgeIndex([scan('repoA', 'slug1', state, [runningRun])], alwaysAlive);
    expect(aliveResult.index.get('a0000000-0000-4000-8000-000000000001')![0]!.runnerAlive).toBe(true);

    const notAliveProbe = buildBadgeIndex([scan('repoA', 'slug1', state, [runningRun])], neverAlive);
    expect(notAliveProbe.index.get('a0000000-0000-4000-8000-000000000001')![0]!.runnerAlive).toBe(false);

    const endedResult = buildBadgeIndex([scan('repoA', 'slug1', state, [endedRun])], alwaysAlive);
    expect(endedResult.index.get('a0000000-0000-4000-8000-000000000001')![0]!.runnerAlive).toBe(false);
  });

  test('the latest run is chosen by startedAt, not array order', () => {
    const state = {
      sequence: ['C1'],
      cards: { C1: { status: 'running', sessionId: 'a0000000-0000-4000-8000-000000000001' } },
    };
    const older = { runId: 'old', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T01:00:00.000Z', pid: 1 };
    const newer = { runId: 'new', startedAt: '2026-06-01T00:00:00.000Z', endedAt: null, pid: 999 };

    const result = buildBadgeIndex([scan('repoA', 'slug1', state, [older, newer])], alwaysAlive);
    const badge = result.index.get('a0000000-0000-4000-8000-000000000001')![0]!;
    expect(badge.runId).toBe('new');
    expect(badge.runnerAlive).toBe(true);

    // Order in the array must not matter — reversed input yields the same answer.
    const reversed = buildBadgeIndex([scan('repoA', 'slug1', state, [newer, older])], alwaysAlive);
    expect(reversed.index.get('a0000000-0000-4000-8000-000000000001')![0]!.runId).toBe('new');
  });

  test('a run entry that is malformed (not an object, or missing startedAt) never wins latest and never throws', () => {
    const state = {
      sequence: ['C1'],
      cards: { C1: { status: 'running', sessionId: 'a0000000-0000-4000-8000-000000000001' } },
    };
    const good = { runId: 'good', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, pid: 5 };
    const runs = [null, 'garbage', { runId: 'bad', endedAt: null, pid: 5 }, good];
    expect(() => buildBadgeIndex([scan('repoA', 'slug1', state, runs)], alwaysAlive)).not.toThrow();
    const { index } = buildBadgeIndex([scan('repoA', 'slug1', state, runs)], alwaysAlive);
    expect(index.get('a0000000-0000-4000-8000-000000000001')![0]!.runId).toBe('good');
  });

  // Identity (measured, spec §9): 2 of 17 real slugs collide across repo keys; 6 session ids
  // appear under both. A Map<sessionId, Badge> would silently drop one; this proves it doesn't.
  test('one session id claimed by two campaigns yields TWO badges, neither overwriting the other, in either scan order', () => {
    const sharedSession = 'a0000000-0000-4000-8000-000000000001';
    const stateA = { sequence: ['C1'], cards: { C1: { status: 'running', sessionId: sharedSession } } };
    const stateB = { sequence: ['C9'], cards: { C9: { status: 'merged', sessionId: sharedSession } } };

    const forward = buildBadgeIndex(
      [scan('repoA', 'shared-slug', stateA), scan('repoB', 'shared-slug', stateB)],
      alwaysAlive,
    );
    const badgesForward = forward.index.get(sharedSession)!;
    expect(badgesForward).toHaveLength(2);
    expect(badgesForward.map((b) => b.repoKey).sort()).toEqual(['repoA', 'repoB']);

    // Reversed scan order must produce the same two badges — neither can overwrite the other.
    const backward = buildBadgeIndex(
      [scan('repoB', 'shared-slug', stateB), scan('repoA', 'shared-slug', stateA)],
      alwaysAlive,
    );
    const badgesBackward = backward.index.get(sharedSession)!;
    expect(badgesBackward).toHaveLength(2);
    expect(badgesBackward.map((b) => b.repoKey).sort()).toEqual(['repoA', 'repoB']);
  });

  test('a campaign is identified by (repoKey, slug): filtering by <repoKeyA>/<slug> returns A only; a bare slug matches nothing', () => {
    const sharedSession = 'a0000000-0000-4000-8000-000000000001';
    const stateA = { sequence: ['C1'], cards: { C1: { status: 'running', sessionId: sharedSession } } };
    const stateB = { sequence: ['C9'], cards: { C9: { status: 'merged', sessionId: sharedSession } } };

    const { index } = buildBadgeIndex(
      [scan('repoA', 'shared-slug', stateA), scan('repoB', 'shared-slug', stateB)],
      alwaysAlive,
    );
    const badges = index.get(sharedSession)!;

    const filteredByPair = badges.filter((b) => `${b.repoKey}/${b.slug}` === 'repoA/shared-slug');
    expect(filteredByPair).toHaveLength(1);
    expect(filteredByPair[0]!.cardId).toBe('C1');

    const filteredByBareSlug = badges.filter((b) => `${b.repoKey}/${b.slug}` === 'shared-slug');
    expect(filteredByBareSlug).toHaveLength(0);
  });

  test('no repo key is excluded, including a .migrated-* one', () => {
    const state = {
      sequence: ['C1'],
      cards: { C1: { status: 'running', sessionId: 'a0000000-0000-4000-8000-000000000001' } },
    };
    const migratedRepoKey = '-Users-hip-repo-todd-skills.migrated-1788705562';
    const { index, skippedBadges } = buildBadgeIndex([scan(migratedRepoKey, 'slug1', state)], alwaysAlive);
    expect(index.get('a0000000-0000-4000-8000-000000000001')).toEqual([
      { repoKey: migratedRepoKey, slug: 'slug1', cardId: 'C1', cardStatus: 'running', runnerAlive: false, runId: null },
    ]);
    expect(skippedBadges).toBe(0);
  });
});

describe('selectCampaigns', () => {
  test('picks the newest campaigns/<slug> mtime first, up to the cap', () => {
    const entries = [
      { repoKey: 'r', slug: 'old', mtimeMs: 100 },
      { repoKey: 'r', slug: 'newest', mtimeMs: 300 },
      { repoKey: 'r', slug: 'mid', mtimeMs: 200 },
    ];
    expect(selectCampaigns(entries, 2)).toEqual([
      { repoKey: 'r', slug: 'newest', mtimeMs: 300 },
      { repoKey: 'r', slug: 'mid', mtimeMs: 200 },
    ]);
  });

  test('ties on mtime are broken by name, deterministically', () => {
    const entries = [
      { repoKey: 'r', slug: 'zebra', mtimeMs: 100 },
      { repoKey: 'r', slug: 'alpha', mtimeMs: 100 },
    ];
    const result = selectCampaigns(entries, 10);
    expect(result.map((e) => e.slug)).toEqual(['alpha', 'zebra']);
  });

  test('is deterministic over the supplied listing regardless of input order', () => {
    const entries = [
      { repoKey: 'r', slug: 'a', mtimeMs: 5 },
      { repoKey: 'r', slug: 'b', mtimeMs: 10 },
      { repoKey: 'r', slug: 'c', mtimeMs: 1 },
    ];
    const shuffled = [entries[2]!, entries[0]!, entries[1]!];
    expect(selectCampaigns(entries, 200)).toEqual(selectCampaigns(shuffled, 200));
  });

  test('cap of 0 admits nothing; a cap larger than the listing admits everything', () => {
    const entries = [
      { repoKey: 'r', slug: 'a', mtimeMs: 5 },
      { repoKey: 'r', slug: 'b', mtimeMs: 10 },
    ];
    expect(selectCampaigns(entries, 0)).toEqual([]);
    expect(selectCampaigns(entries, 200)).toHaveLength(2);
  });
});
