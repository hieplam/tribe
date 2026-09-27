// Tests for card-actions.ts's buildEscalationMarkdown (P5 fix-list: escalation files must say
// what actually unblocks them — a reason-specific "## Options" / "How to unblock" block instead
// of the old generic list that presented the ruling path first for every reason, including
// mechanical verify failures a ruling can never clear) and (Task 27, spec §10.2)
// buildSessionIOForCard's onSessionStart, which prints the per-card session line the instant
// the SDK assigns a session id.
import { describe, expect, mock, test } from 'bun:test';
import { buildEscalationMarkdown, buildSessionIOForCard, healSafeResidue, sessionConfigFor } from './card-actions.ts';
import type { CardCtx } from './card-actions.ts';
import type { CampaignState, Card, ResolvedConfig } from '../types.ts';
import type { LoopIO } from '../../ports/ports.ts';
import { verifyShipped } from '../verify.ts';
import type { VerifyConfig, VerifyPointId } from '../verify.ts';

function fixtureResolved(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    repoRoot: '/repo',
    logsDir: '/repo/logs',
    homeDir: '/th',
    runId: 'r-1',
    argv: [],
    model: 'test-model',
    includeEscalated: false,
    dryRun: false,
    remote: 'origin',
    baseBranch: 'main',
    answersContent: '',
    briefTemplate: '',
    ...overrides,
  };
}

function fixtureCard(overrides: Partial<Card> = {}): Card {
  return {
    status: 'staged',
    spec: null,
    plan: null,
    branch: null,
    baseSha: null,
    pr: null,
    mergeSha: null,
    sessionId: null,
    updatedAt: null,
    ...overrides,
  };
}

function fixtureIo(overrides: Partial<LoopIO> = {}): LoopIO {
  return {
    exec: mock(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    sleep: mock(async () => {}),
    fileExists: mock(() => true),
    readFile: mock(() => ''),
    writeFile: mock(() => {}),
    renameFile: mock(() => {}),
    appendLog: mock(() => {}),
    readLock: mock(() => null),
    writeLock: mock(() => {}),
    removeLock: mock(() => {}),
    isProcessAlive: mock(() => false),
    currentPid: mock(() => 1),
    now: mock(() => '2026-09-13T00:00:00Z'),
    spawnSession: mock(async function* () {}),
    ensureDir: mock(() => {}),
    writeFileAtomic: mock(() => {}),
    printLine: mock(() => {}),
    ...overrides,
  };
}

function fixtureCtx(overrides: { resolved?: Partial<ResolvedConfig>; io?: Partial<LoopIO> } = {}): CardCtx {
  const state: CampaignState = {
    v: 1,
    campaign: 'test',
    mergePolicy: 'merge',
    sequence: ['C1'],
    schemaLockPaths: [],
    docsOnlyPaths: [],
    ownerOnlyEscalations: [],
    cards: { C1: fixtureCard() },
  };
  return {
    cardId: 'C1',
    state,
    resolved: fixtureResolved(overrides.resolved),
    io: fixtureIo(overrides.io),
  };
}

describe('sessionConfigFor — ledgerPath (Task 9, spec §4.4)', () => {
  test('sets ledgerPath from resolved.homeDir via supervisorLedgerPathOf', () => {
    const config = sessionConfigFor('C1', fixtureResolved({ homeDir: '/th' }));
    expect(config.ledgerPath).toBe('/th/supervisor/ledger.jsonl');
  });
});

describe('buildEscalationMarkdown — P5 reason-specific Options', () => {
  test('needs_direction leads with the ruling path, not the verify-failure block', () => {
    const markdown = buildEscalationMarkdown('C1', 'needs_direction', 'What should we do?', fixtureResolved());
    expect(markdown).toContain('Append a ruling');
    expect(markdown).not.toContain('CANNOT clear');
  });

  test('planning_needed also leads with the ruling path', () => {
    const markdown = buildEscalationMarkdown('C1', 'planning_needed', 'Missing on disk: spec, plan', fixtureResolved());
    expect(markdown).toContain('Append a ruling');
    expect(markdown).not.toContain('CANNOT clear');
  });

  // Deliberately generic marker text (not the spec's own bullet wording) so these tests can
  // only pass by the implementation ADDING the reason-specific unblock bullet text — never by
  // the `## Context` section trivially echoing the raw `detail` string back.
  test('verify_failed_twice with only schemaGuard failing renders only the schemaGuard bullet', () => {
    const detail = '- schemaGuard: SOME_FAILURE_MARKER_A';
    const failedPoints: VerifyPointId[] = ['schemaGuard'];
    const markdown = buildEscalationMarkdown('C1', 'verify_failed_twice', detail, fixtureResolved(), failedPoints);
    expect(markdown).toContain('CANNOT clear');
    expect(markdown).toContain('allowsSchemaChange');
    expect(markdown).not.toContain('master/CI is genuinely red');
    expect(markdown).not.toContain('delete the leftover remote branch');
  });

  test('verify_failed_twice with two failing ids renders both bullets', () => {
    const detail = ['- schemaGuard: SOME_FAILURE_MARKER_A', '- checksGreen: SOME_FAILURE_MARKER_B'].join('\n');
    const failedPoints: VerifyPointId[] = ['schemaGuard', 'checksGreen'];
    const markdown = buildEscalationMarkdown('C1', 'verify_failed_twice', detail, fixtureResolved(), failedPoints);
    expect(markdown).toContain('CANNOT clear');
    expect(markdown).toContain('allowsSchemaChange');
    expect(markdown).toContain('master/CI is genuinely red');
    expect(markdown).not.toContain('delete the leftover remote branch');
  });

  // P5 audit fix-round (blocker, skinnerB): reproduces the "zero bullets" defect for verify.ts's
  // OWN real point ids ('merged'/'mergeShaAncestorOfMaster') that the original P5
  // implementation's 3-entry map never covered — the exact scenario
  // `core/loop.test.ts:1023 'verifyShipped fails twice for the same card -> escalated'` drives
  // end-to-end (merged=false). Before the fix, the "How to unblock" header was followed by NO
  // bullets at all for this input.
  test('verify_failed_twice with merged failing renders the merged bullet, not zero bullets', () => {
    const detail = '- merged: PR #7 is not merged (gh api reported merged=false)';
    const failedPoints: VerifyPointId[] = ['merged'];
    const markdown = buildEscalationMarkdown('C1', 'verify_failed_twice', detail, fixtureResolved(), failedPoints);
    expect(markdown).toContain('CANNOT clear');
    expect(markdown).toContain('- merged: the PR is not merged yet');
    // The "How to unblock" block must contain more than just the two static intro lines.
    const unblockSection = markdown.split('## How to unblock')[1] ?? '';
    expect(unblockSection.trim().split('\n').length).toBeGreaterThan(3);
  });

  test('verify_failed_twice with mergeShaAncestorOfMaster failing renders that bullet, not zero bullets', () => {
    const detail =
      '- mergeShaAncestorOfMaster: abc123 is NOT an ancestor of origin/master (git merge-base --is-ancestor exit 1)';
    const failedPoints: VerifyPointId[] = ['mergeShaAncestorOfMaster'];
    const markdown = buildEscalationMarkdown('C1', 'verify_failed_twice', detail, fixtureResolved(), failedPoints);
    expect(markdown).toContain('CANNOT clear');
    expect(markdown).toContain('- mergeShaAncestorOfMaster: the merge commit is not');
    const unblockSection = markdown.split('## How to unblock')[1] ?? '';
    expect(unblockSection.trim().split('\n').length).toBeGreaterThan(3);
  });

  // P5 audit fix-round (blocker, skinnerB): worktreeAndBranchGone must NOT give unqualified
  // "delete it by hand" instructions when `merged` also failed (the PR simply hasn't merged
  // yet, so the branch/worktree being present is expected, not residue) — contradicts P4's
  // `decideResidueHeal` (residue.ts:46), which never even considers cleanup unless `merged`
  // passed.
  test('verify_failed_twice with merged AND worktreeAndBranchGone failing (unmerged PR) does not tell the reader to delete anything', () => {
    const detail = [
      '- merged: PR #7 is not merged (gh api reported merged=false)',
      '- worktreeAndBranchGone: my-branch: worktree still present and remote branch still present',
    ].join('\n');
    const failedPoints: VerifyPointId[] = ['merged', 'worktreeAndBranchGone'];
    const markdown = buildEscalationMarkdown('C1', 'verify_failed_twice', detail, fixtureResolved(), failedPoints);
    expect(markdown).not.toContain('delete the leftover remote branch / worktree by hand');
    expect(markdown).toContain('Merge the PR first');
  });

  // P5 audit fix-round (blocker, skinnerB): when `merged` PASSED (not in failedPoints) but
  // worktreeAndBranchGone still failed — the P4 "heal refused, worktree dirty" case — the
  // instruction must caveat checking for uncommitted/unmerged work before deleting anything by
  // hand, never an unqualified "delete it by hand".
  test('verify_failed_twice with only worktreeAndBranchGone failing (merged passed) caveats checking for uncommitted work first', () => {
    const detail = '- worktreeAndBranchGone: my-branch: worktree still present and remote branch still present';
    const failedPoints: VerifyPointId[] = ['worktreeAndBranchGone'];
    const markdown = buildEscalationMarkdown('C1', 'verify_failed_twice', detail, fixtureResolved(), failedPoints);
    expect(markdown).toContain('Check for uncommitted or unmerged work FIRST');
    expect(markdown).toContain('delete the leftover remote branch / worktree by hand');
  });
});

// Task 27 (spec §10.2 line 2): buildSessionIOForCard's onSessionStart prints the per-card
// session line the instant the SDK assigns a session id — the exact moment this callback
// already runs at — and stays silent when the viewer isn't up to serve one.
describe('buildSessionIOForCard — onSessionStart printLine (Task 27, spec §10.2)', () => {
  test('prints "card <id>: <base>/s/<sessionId>" exactly once when viewerBaseUrl is set', () => {
    const ctx = fixtureCtx({ resolved: { viewerBaseUrl: 'http://127.0.0.1:4321/?campaign=my-repo/my-slug' } });
    const sessionIO = buildSessionIOForCard(ctx);

    sessionIO.onSessionStart('d7d21837-6f4e-4b1a-9a02-2b6e4c1f8e55');

    expect(ctx.io.printLine).toHaveBeenCalledTimes(1);
    expect(ctx.io.printLine).toHaveBeenCalledWith('card C1: http://127.0.0.1:4321/s/d7d21837-6f4e-4b1a-9a02-2b6e4c1f8e55');
  });

  test('prints nothing when viewerBaseUrl is null (--no-viewer/--dry-run/skip/stale)', () => {
    const ctx = fixtureCtx({ resolved: { viewerBaseUrl: null } });
    const sessionIO = buildSessionIOForCard(ctx);

    sessionIO.onSessionStart('d7d21837-6f4e-4b1a-9a02-2b6e4c1f8e55');

    expect(ctx.io.printLine).not.toHaveBeenCalled();
  });

  test('still updates the card and persists state regardless of the printLine call', () => {
    const ctx = fixtureCtx({ resolved: { viewerBaseUrl: null } });
    const sessionIO = buildSessionIOForCard(ctx);

    sessionIO.onSessionStart('some-session-id');

    expect(ctx.state.cards.C1?.sessionId).toBe('some-session-id');
    expect(ctx.state.cards.C1?.status).toBe('running');
    expect(ctx.io.writeFile).toHaveBeenCalledTimes(1);
  });
});

describe('healSafeResidue — D4 safe fast-forward of the local base (Task 1.6)', () => {
  test('only localBaseSynced fails, checkout on base, clean, strictly behind -> ff-only merge, retry ships', async () => {
    let fastForwarded = false;
    const calls: string[][] = [];
    const ok = (stdout = '') => ({ stdout, stderr: '', exitCode: 0 });
    const exec = mock(async (cmd: string[]) => {
      calls.push(cmd);
      const [bin, ...rest] = cmd;
      if (bin === 'gh' && rest[0] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
      if (bin === 'gh' && rest[0] === 'pr' && rest[1] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
      if (bin === 'git' && rest[0] === 'merge-base' && rest[2] === 'deadbee' && rest[3] === 'master') {
        // The local base lacks the merge until the heal fast-forwards it.
        return { stdout: '', stderr: '', exitCode: fastForwarded ? 0 : 1 };
      }
      if (bin === 'git' && rest[0] === 'rev-parse' && rest[1] === '--abbrev-ref') return ok('master\n');
      if (bin === 'git' && rest[0] === 'merge' && rest[1] === '--ff-only') {
        fastForwarded = true;
        return ok('');
      }
      // git fetch, worktree list, ls-remote, status --porcelain, the other merge-base probes:
      // all succeed with empty output (nothing left over, checkout clean, local behind remote).
      return ok('');
    });
    const ctx = fixtureCtx({ resolved: { baseBranch: 'master' }, io: { exec } });
    ctx.state.cards.C1 = fixtureCard({ branch: 'feat/c1-widget', pr: 12 });
    const verifyConfig: VerifyConfig = {
      repoRoot: '/repo',
      remote: 'origin',
      baseBranch: 'master',
      schemaLockPaths: [],
      docsOnlyPaths: [],
    };

    const first = await verifyShipped(ctx.state.cards.C1, verifyConfig, ctx.io, 'C1');
    expect(first.failedPoints).toEqual(['localBaseSynced']);

    const healed = await healSafeResidue(ctx, first, verifyConfig);

    expect(calls).toContainEqual(['git', 'merge', '--ff-only', 'origin/master']);
    expect(healed.shipped).toBe(true);
    expect(healed.points.find((p) => p.id === 'localBaseSynced')?.detail).toContain('(healed: fast_forward_base)');
  });

  test('checkout dirty -> no merge is attempted and the retry still fails', async () => {
    const calls: string[][] = [];
    const ok = (stdout = '') => ({ stdout, stderr: '', exitCode: 0 });
    const exec = mock(async (cmd: string[]) => {
      calls.push(cmd);
      const [bin, ...rest] = cmd;
      if (bin === 'gh' && rest[0] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
      if (bin === 'gh' && rest[0] === 'pr' && rest[1] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
      if (bin === 'git' && rest[0] === 'merge-base' && rest[2] === 'deadbee' && rest[3] === 'master') {
        return { stdout: '', stderr: '', exitCode: 1 };
      }
      if (bin === 'git' && rest[0] === 'rev-parse' && rest[1] === '--abbrev-ref') return ok('master\n');
      if (bin === 'git' && rest[0] === 'status') return ok(' M owner-file.txt\n');
      return ok('');
    });
    const ctx = fixtureCtx({ resolved: { baseBranch: 'master' }, io: { exec } });
    ctx.state.cards.C1 = fixtureCard({ branch: 'feat/c1-widget', pr: 12 });
    const verifyConfig: VerifyConfig = {
      repoRoot: '/repo',
      remote: 'origin',
      baseBranch: 'master',
      schemaLockPaths: [],
      docsOnlyPaths: [],
    };

    const first = await verifyShipped(ctx.state.cards.C1, verifyConfig, ctx.io, 'C1');
    const healed = await healSafeResidue(ctx, first, verifyConfig);

    expect(calls.some((c) => c[0] === 'git' && c[1] === 'merge' && c[2] === '--ff-only')).toBe(false);
    expect(healed.shipped).toBe(false);
    expect(healed.points.find((p) => p.id === 'localBaseSynced')?.detail).not.toContain('healed:');
  });
});
