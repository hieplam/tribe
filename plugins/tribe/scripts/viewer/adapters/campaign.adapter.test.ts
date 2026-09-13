// adapters/campaign.adapter.test.ts — spec §9 (the campaign badge algorithm and its containment),
// D6/D8 (the only two `~/.tribe` file reads), D14 (resolved containment), `fail-closed-edges`
// obligation 1 (the two-outcome rule), `pure-core.md` (the adapter obeys `core/cache.ts`, decides
// nothing itself).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBadgeIndex } from '../core/badge.ts';
import {
  MALFORMED_STATE,
  discoverCampaignCandidates,
  processAlive,
  readSelectedCampaigns,
  type CampaignSelector,
} from './campaign.adapter.ts';

const ADAPTER_SOURCE = readFileSync(join(import.meta.dir, 'campaign.adapter.ts'), 'utf8');

/** `mkdtemp` on macOS hands back a path under `/var/folders/...`, itself a symlink to
 * `/private/var/folders/...` — the SAME class of trap `fixtures-mirror-reality.md` and task 15's
 * `readonly.test.ts` both call out. `realpathSync` here mirrors what `serve.ts`'s own D32
 * resolution will do to the real `~/.tribe`: the root every containment check judges against MUST
 * already be resolved, or every ordinary, non-symlinked fixture would spuriously "escape" it. */
function makeTribeRoot(): { root: string; cleanup: () => void } {
  const raw = mkdtempSync(join(tmpdir(), 'tribe-viewer-badge-'));
  const root = realpathSync(raw);
  return { root, cleanup: () => rmSync(raw, { recursive: true, force: true }) };
}

function writeCampaign(
  root: string,
  repoKey: string,
  slug: string,
  opts: { state?: unknown; stateRaw?: string; runs?: Array<{ runId: string; record: Record<string, unknown> }>; noRunsDir?: boolean } = {},
): string {
  const campaignDir = join(root, repoKey, 'campaigns', slug);
  mkdirSync(campaignDir, { recursive: true });
  if (opts.stateRaw !== undefined) {
    writeFileSync(join(campaignDir, 'campaign-state.json'), opts.stateRaw);
  } else if (opts.state !== undefined) {
    writeFileSync(join(campaignDir, 'campaign-state.json'), JSON.stringify(opts.state));
  }
  if (!opts.noRunsDir) {
    const runsDir = join(campaignDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    for (const { runId, record } of opts.runs ?? []) {
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'run.json'), JSON.stringify(record));
    }
  }
  return campaignDir;
}

function withCapturedStderr<T>(fn: () => T): { result: T; lines: string[] } {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    return { result: fn(), lines };
  } finally {
    console.error = original;
  }
}

describe('discoverCampaignCandidates — the fixed-depth walk finds campaigns (spec §9 steps 1-2)', () => {
  test('two repoKeys, several slugs each; stray non-directory entries at both levels are skipped', () => {
    const { root, cleanup } = makeTribeRoot();
    try {
      writeCampaign(root, 'repo-a', 'slug-1', { state: { sequence: [], cards: {} } });
      writeCampaign(root, 'repo-a', 'slug-2', { state: { sequence: [], cards: {} } });
      writeCampaign(root, 'repo-b', 'slug-1', { state: { sequence: [], cards: {} } });
      writeFileSync(join(root, 'stray-file.txt'), 'not a repo key');
      writeFileSync(join(root, 'repo-a', 'campaigns', 'stray-file.txt'), 'not a slug');

      const entries = discoverCampaignCandidates(root);
      const identities = entries.map((e) => `${e.repoKey}/${e.slug}`).sort();
      expect(identities).toEqual(['repo-a/slug-1', 'repo-a/slug-2', 'repo-b/slug-1']);
      for (const e of entries) expect(typeof e.mtimeMs).toBe('number');
    } finally {
      cleanup();
    }
  });

  test('a nonexistent tribe root yields [], never a throw', () => {
    expect(discoverCampaignCandidates('/nonexistent/tribe/root/path')).toEqual([]);
  });

  test('a repoKey that is a symlink OUT of the tribe root contributes no candidate (D14, plan task 16): discovery contains before it stats/lists', () => {
    const { root, cleanup } = makeTribeRoot();
    const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-discover-'));
    try {
      // A legitimate, contained campaign — proof the containment check is not merely refusing all.
      writeCampaign(root, 'real-repo', 'real-slug', { state: { sequence: [], cards: {} } });

      // A hostile repoKey symlink whose target (with its own campaigns/<slug>) lives OUTSIDE the
      // tribe root. Before the fix, discovery statSync/listDirOrEmpty'd through the symlink and
      // leaked the out-of-root directory entry + its mtime as a candidate.
      mkdirSync(join(outside, 'campaigns', 'leaked-slug'), { recursive: true });
      symlinkSync(outside, join(root, 'evil-repo'));

      const entries = discoverCampaignCandidates(root);
      const identities = entries.map((e) => `${e.repoKey}/${e.slug}`).sort();
      expect(identities).toEqual(['real-repo/real-slug']); // the escaping repoKey contributes nothing
      expect(identities).not.toContain('evil-repo/leaked-slug');
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a campaigns/<slug> that is a symlink OUT of the tribe root contributes no candidate (D14): each level is contained', () => {
    const { root, cleanup } = makeTribeRoot();
    const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-discover-slug-'));
    try {
      writeCampaign(root, 'repo', 'contained-slug', { state: { sequence: [], cards: {} } });
      // An escaping <slug> under a legitimate, contained campaigns/ directory.
      mkdirSync(outside, { recursive: true });
      mkdirSync(join(root, 'repo', 'campaigns'), { recursive: true });
      symlinkSync(outside, join(root, 'repo', 'campaigns', 'escaping-slug'));

      const entries = discoverCampaignCandidates(root);
      const identities = entries.map((e) => `${e.repoKey}/${e.slug}`).sort();
      expect(identities).toEqual(['repo/contained-slug']);
      expect(identities).not.toContain('repo/escaping-slug');
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('readSelectedCampaigns — reads exactly what the selection names (spec §9 steps 3-4), and nothing else', () => {
  test('a campaign with no runs/ directory yields runnerAlive: false end-to-end through core/badge.ts', () => {
    const { root, cleanup } = makeTribeRoot();
    try {
      const sessionId = 'a0000000-0000-4000-8000-000000000001';
      writeCampaign(root, 'repo', 'no-runs', {
        state: { sequence: ['C1'], cards: { C1: { status: 'running', sessionId } } },
        noRunsDir: true,
      });
      const selection: CampaignSelector[] = [{ repoKey: 'repo', slug: 'no-runs' }];
      const { scans, skippedBadges } = readSelectedCampaigns(root, selection, 0);
      expect(skippedBadges).toBe(0);
      expect(scans).toEqual([{ repoKey: 'repo', slug: 'no-runs', state: { sequence: ['C1'], cards: { C1: { status: 'running', sessionId } } }, runs: [] }]);

      const { index } = buildBadgeIndex(scans, () => true);
      const badge = index.get(sessionId)![0]!;
      expect(badge.runnerAlive).toBe(false);
      expect(badge.runId).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('two-outcome rule: a malformed campaign-state.json and an absent one are reported as two DIFFERENT results', () => {
    const { root, cleanup } = makeTribeRoot();
    try {
      writeCampaign(root, 'repo', 'malformed', { stateRaw: '{ this is not valid json !!!' });
      writeCampaign(root, 'repo', 'absent', {}); // no campaign-state.json written at all

      const selection: CampaignSelector[] = [
        { repoKey: 'repo', slug: 'malformed' },
        { repoKey: 'repo', slug: 'absent' },
      ];
      const { scans, skippedBadges } = readSelectedCampaigns(root, selection, 0);
      expect(skippedBadges).toBe(0); // neither outcome is a security refusal

      const malformed = scans.find((s) => s.slug === 'malformed')!;
      const absent = scans.find((s) => s.slug === 'absent')!;
      expect(malformed.state).toBe(MALFORMED_STATE);
      expect(absent.state).toBeNull();
      expect(malformed.state).not.toBe(absent.state); // two DIFFERENT results, never one catch-all

      // Both are malformed/absent, therefore contribute no badge downstream — but never throw.
      expect(() => buildBadgeIndex(scans, () => false)).not.toThrow();
    } finally {
      cleanup();
    }
  });

  test('hands it a selection of two out of five fixture campaigns: the other three are never opened', () => {
    const { root, cleanup } = makeTribeRoot();
    const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-'));
    try {
      writeCampaign(root, 'repo', 'selected-1', { state: { sequence: [], cards: {} } });
      writeCampaign(root, 'repo', 'selected-2', { state: { sequence: [], cards: {} } });

      // Three UNSELECTED campaigns, each with campaign-state.json symlinked OUTSIDE the tribe
      // root. If the adapter ever touched one of these (a bug: reading beyond the selection),
      // the escape would be refused-and-counted — so `skippedBadges === 0` below is proof none
      // of the three was ever opened, not merely that they don't appear in `scans`.
      for (const slug of ['unselected-1', 'unselected-2', 'unselected-3']) {
        const outsideFile = join(outside, `${slug}.json`);
        writeFileSync(outsideFile, JSON.stringify({ sequence: [], cards: {}, marker: 'NEVER-OPENED' }));
        const campaignDir = join(root, 'repo', 'campaigns', slug);
        mkdirSync(campaignDir, { recursive: true });
        symlinkSync(outsideFile, join(campaignDir, 'campaign-state.json'));
      }

      const selection: CampaignSelector[] = [
        { repoKey: 'repo', slug: 'selected-1' },
        { repoKey: 'repo', slug: 'selected-2' },
      ];
      const { result, lines } = withCapturedStderr(() => readSelectedCampaigns(root, selection, 0));
      expect(result.scans.map((s) => s.slug).sort()).toEqual(['selected-1', 'selected-2']);
      expect(result.skippedBadges).toBe(0);
      expect(lines).toEqual([]);
    } finally {
      cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('an ordinary, non-symlinked campaign is read in full — the containment check is not merely refusing everything', () => {
    const { root, cleanup } = makeTribeRoot();
    try {
      const sessionId = 'b0000000-0000-4000-8000-000000000002';
      writeCampaign(root, 'repo', 'ordinary', {
        state: { sequence: ['C1'], cards: { C1: { status: 'running', sessionId } } },
        runs: [{ runId: 'run-1', record: { runId: 'run-1', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, pid: process.pid } }],
      });
      const selection: CampaignSelector[] = [{ repoKey: 'repo', slug: 'ordinary' }];
      const { scans, skippedBadges } = readSelectedCampaigns(root, selection, 0);
      expect(skippedBadges).toBe(0);
      expect(scans).toHaveLength(1);
      expect(scans[0]!.runs).toHaveLength(1);

      const { index } = buildBadgeIndex(scans, (pid) => pid === process.pid);
      const badge = index.get(sessionId)![0]!;
      expect(badge.runnerAlive).toBe(true);
      expect(badge.runId).toBe('run-1');
    } finally {
      cleanup();
    }
  });

  describe('resolved containment — the three DIRECTORY shapes (spec §9, D14): refused and counted BEFORE campaign-state.json is opened', () => {
    test('a repoKey directory that is a symlink to somewhere outside the tribe root is refused', () => {
      const { root, cleanup } = makeTribeRoot();
      const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-repokey-'));
      try {
        mkdirSync(join(outside, 'campaigns', 'evil-slug'), { recursive: true });
        writeFileSync(join(outside, 'campaigns', 'evil-slug', 'campaign-state.json'), JSON.stringify({ marker: 'NEVER-OPENED' }));
        symlinkSync(outside, join(root, 'evil-repo'));

        const selection: CampaignSelector[] = [{ repoKey: 'evil-repo', slug: 'evil-slug' }];
        const { result, lines } = withCapturedStderr(() => readSelectedCampaigns(root, selection, 0));
        expect(result.scans).toEqual([]);
        expect(result.skippedBadges).toBe(1);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(join(root, 'evil-repo'));
      } finally {
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    });

    test('a campaigns/<slug> directory that is a symlink to somewhere outside the tribe root is refused', () => {
      const { root, cleanup } = makeTribeRoot();
      const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-slug-'));
      try {
        writeFileSync(join(outside, 'campaign-state.json'), JSON.stringify({ marker: 'NEVER-OPENED' }));
        mkdirSync(join(root, 'repo', 'campaigns'), { recursive: true });
        symlinkSync(outside, join(root, 'repo', 'campaigns', 'evil-slug'));

        const selection: CampaignSelector[] = [{ repoKey: 'repo', slug: 'evil-slug' }];
        const { result, lines } = withCapturedStderr(() => readSelectedCampaigns(root, selection, 0));
        expect(result.scans).toEqual([]);
        expect(result.skippedBadges).toBe(1);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(join(root, 'repo', 'campaigns', 'evil-slug'));
      } finally {
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    });

    test('a runs/<runId> directory that is a symlink to somewhere outside the tribe root is refused; the campaign itself is still read', () => {
      const { root, cleanup } = makeTribeRoot();
      const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-run-'));
      try {
        writeFileSync(join(outside, 'run.json'), JSON.stringify({ runId: 'evil-run', startedAt: '2099-01-01T00:00:00.000Z', endedAt: null, pid: 999999999 }));
        const campaignDir = writeCampaign(root, 'repo', 'has-evil-run', { state: { sequence: [], cards: {} } });
        symlinkSync(outside, join(campaignDir, 'runs', 'evil-run'));

        const selection: CampaignSelector[] = [{ repoKey: 'repo', slug: 'has-evil-run' }];
        const { result, lines } = withCapturedStderr(() => readSelectedCampaigns(root, selection, 0));
        expect(result.skippedBadges).toBe(1);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(join(campaignDir, 'runs', 'evil-run'));

        const scan = result.scans.find((s) => s.slug === 'has-evil-run')!;
        expect(scan).toBeDefined();
        expect(scan.runs).toEqual([]); // the escaping run's content never entered the runs array
      } finally {
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('resolved containment — the two FILE shapes (spec §9, D14): refused, no badge, counted, one stderr line, never a crash', () => {
    test('a campaign-state.json that is itself a symlink outside the tribe root is refused', () => {
      const { root, cleanup } = makeTribeRoot();
      const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-state-'));
      try {
        const outsideFile = join(outside, 'fake-state.json');
        writeFileSync(outsideFile, JSON.stringify({ sequence: ['C1'], cards: { C1: { status: 'running', sessionId: 'x' } }, marker: 'NEVER-OPENED' }));
        const campaignDir = join(root, 'repo', 'campaigns', 'evil-state');
        mkdirSync(campaignDir, { recursive: true });
        mkdirSync(join(campaignDir, 'runs'), { recursive: true });
        symlinkSync(outsideFile, join(campaignDir, 'campaign-state.json'));

        const selection: CampaignSelector[] = [{ repoKey: 'repo', slug: 'evil-state' }];
        const { result, lines } = withCapturedStderr(() => readSelectedCampaigns(root, selection, 0));
        expect(result.skippedBadges).toBe(1);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(join(campaignDir, 'campaign-state.json'));

        const scan = result.scans.find((s) => s.slug === 'evil-state')!;
        expect(scan).toBeDefined();
        expect(scan.state).toBeNull(); // never read the outside content; no badge from this campaign
        expect(() => buildBadgeIndex(result.scans, () => false)).not.toThrow();
      } finally {
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    });

    test('a run.json that is itself a symlink outside the tribe root is refused; the campaign itself is still read', () => {
      const { root, cleanup } = makeTribeRoot();
      const outside = mkdtempSync(join(tmpdir(), 'tribe-viewer-outside-runjson-'));
      try {
        const outsideFile = join(outside, 'fake-run.json');
        writeFileSync(outsideFile, JSON.stringify({ runId: 'evil', startedAt: '2099-01-01T00:00:00.000Z', endedAt: null, pid: 999999999 }));
        const campaignDir = writeCampaign(root, 'repo', 'evil-run-file', { state: { sequence: [], cards: {} } });
        const runDir = join(campaignDir, 'runs', 'run-1');
        mkdirSync(runDir, { recursive: true });
        symlinkSync(outsideFile, join(runDir, 'run.json'));

        const selection: CampaignSelector[] = [{ repoKey: 'repo', slug: 'evil-run-file' }];
        const { result, lines } = withCapturedStderr(() => readSelectedCampaigns(root, selection, 0));
        expect(result.skippedBadges).toBe(1);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(join(runDir, 'run.json'));

        const scan = result.scans.find((s) => s.slug === 'evil-run-file')!;
        expect(scan).toBeDefined();
        expect(scan.runs).toEqual([]); // the escaping run.json's content never entered the runs array
      } finally {
        cleanup();
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('the whole-scan cache (spec §9: "cached for 5 s"; `pure-core.md`: the adapter obeys core/cache.ts, decides nothing itself)', () => {
    test('a repeat call inside the 5 s window returns the SAME result even though the underlying file changed; past the window, a fresh scan is served', () => {
      const { root, cleanup } = makeTribeRoot();
      try {
        const sessionIdV1 = 'a0000000-0000-4000-8000-000000000001';
        const campaignDir = writeCampaign(root, 'repo', 'camp', {
          state: { sequence: ['C1'], cards: { C1: { status: 'running', sessionId: sessionIdV1 } } },
        });
        const selection: CampaignSelector[] = [{ repoKey: 'repo', slug: 'camp' }];

        const first = readSelectedCampaigns(root, selection, 0);
        expect((first.scans[0]!.state as { cards: { C1: { sessionId: string } } }).cards.C1.sessionId).toBe(sessionIdV1);

        // Mutate the on-disk state to a DIFFERENT valid sessionId — a fresh scan would see this.
        const sessionIdV2 = 'b0000000-0000-4000-8000-000000000002';
        writeFileSync(
          join(campaignDir, 'campaign-state.json'),
          JSON.stringify({ sequence: ['C1'], cards: { C1: { status: 'running', sessionId: sessionIdV2 } } }),
        );

        // Inside the 5 s window: the cached (stale-on-disk) result is served unchanged.
        const withinWindow = readSelectedCampaigns(root, selection, 4999);
        expect((withinWindow.scans[0]!.state as { cards: { C1: { sessionId: string } } }).cards.C1.sessionId).toBe(sessionIdV1);

        // At/past the 5 s expiry: a fresh scan is served, reflecting the on-disk change.
        const pastWindow = readSelectedCampaigns(root, selection, 5000);
        expect((pastWindow.scans[0]!.state as { cards: { C1: { sessionId: string } } }).cards.C1.sessionId).toBe(sessionIdV2);
      } finally {
        cleanup();
      }
    });
  });
});

describe('processAlive — the ONE process.kill(pid, 0) call site (spec §9)', () => {
  test('EPERM (pid exists, signalling forbidden) is reported ALIVE; a genuinely dead pid is reported not alive', () => {
    let sawEPERM = false;
    try {
      process.kill(1, 0);
    } catch (err) {
      const code: string = (err as NodeJS.ErrnoException).code ?? '';
      sawEPERM = code === 'EPERM';
      expect(['EPERM', 'ESRCH']).toContain(code);
    }
    expect(sawEPERM).toBe(true);

    expect(processAlive(999999)).toBe(false);
    expect(processAlive(1)).toBe(true);
  });
});

describe('D6 — the source-level boundary: the module never names logsDir or statePath', () => {
  test('the adapter source contains neither identifier anywhere', () => {
    expect(ADAPTER_SOURCE.includes('logsDir')).toBe(false);
    expect(ADAPTER_SOURCE.includes('statePath')).toBe(false);
  });
});
