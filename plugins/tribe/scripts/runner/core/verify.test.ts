// Tests for verify.ts (Task 3): the D3 five-point SHIPPED replay. Every gh/git call is
// mocked through the injected `io.exec`/`io.readFile` seams — these tests never invoke a
// real binary. Fixture values are deliberately neutral (no repo names, no campaign-specific
// values) — the stateless-capability wall.
import { describe, expect, test } from 'bun:test';
import { parseGapGateStamp, readAllowsSchemaChange, verifyShipped } from './verify.ts';
import type { ExecResult, VerifyConfig, VerifyIO } from './verify.ts';
import type { Card } from './types.ts';

function fixtureCard(overrides: Partial<Card> = {}): Card {
  return {
    status: 'running',
    spec: 'docs/superpowers/specs/2026-01-01-c1-spec.md',
    plan: 'docs/superpowers/plans/2026-01-01-c1-plan.md',
    branch: 'feat/c1-widget',
    baseSha: 'base0001',
    pr: 42,
    mergeSha: null,
    sessionId: 'sess-c1',
    updatedAt: null,
    ...overrides,
  };
}

function fixtureConfig(overrides: Partial<VerifyConfig> = {}): VerifyConfig {
  return {
    repoRoot: '/repo',
    remote: 'origin',
    baseBranch: 'master',
    schemaLockPaths: ['packages/app/src/domain/sample-types.ts'],
    docsOnlyPaths: ['docs/'],
    ...overrides,
  };
}

interface MockOptions {
  merged?: boolean;
  mergeSha?: string | null;
  ancestorExitCode?: number;
  checks?: Array<{ name: string; bucket: string; description?: string }>;
  docsOnlyDiffFiles?: string[];
  worktreeStillExists?: boolean;
  remoteStillExists?: boolean;
  schemaDiffStdout?: string;
  planContent?: string;
  /** When false, the card's plan path is reported absent (`fileExists` → false) and any
   * `readFile` of it throws ENOENT — the shape a card leaves behind when its own merge
   * deleted its planning docs (C1). Defaults to present. */
  planExists?: boolean;
  prBody?: string;
  ledgerAtBase?: string;
}

function ok(stdout: string): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function buildIo(opts: MockOptions = {}): VerifyIO {
  const merged = opts.merged ?? true;
  const mergeSha = opts.mergeSha === undefined ? 'mergesha1' : opts.mergeSha;
  const ancestorExitCode = opts.ancestorExitCode ?? 0;
  const checks = opts.checks ?? [{ name: 'ci', bucket: 'pass' }];
  const docsOnlyDiffFiles = opts.docsOnlyDiffFiles ?? ['docs/note.md'];
  const worktreeStillExists = opts.worktreeStillExists ?? false;
  const remoteStillExists = opts.remoteStillExists ?? false;
  const schemaDiffStdout = opts.schemaDiffStdout ?? '';
  const planContent = opts.planContent ?? '# plan\n\nno front matter here.\n';
  const planExists = opts.planExists ?? true;
  const prBody =
    opts.prBody ??
    '## Harness gaps\n\n<!-- gap-gate v1 card=C1 base=base0001 head=head0001 minted=none matched=none debt-delta=0 ledger=none -->\n';
  const ledgerAtBase = opts.ledgerAtBase ?? '';

  return {
    fileExists(): boolean {
      return planExists;
    },
    async exec(cmd: string[]): Promise<ExecResult> {
      const [bin, ...rest] = cmd;
      if (bin === 'gh' && rest[0] === 'api') {
        return ok(JSON.stringify({ merged, merge_commit_sha: mergeSha }));
      }
      if (bin === 'git' && rest[0] === 'merge-base') {
        // rest = ['merge-base', '--is-ancestor', <sha>, <target>]; only the MERGE sha is governed
        // by ancestorExitCode — the stamp's base/head shas are ancestors unless a test says
        // otherwise, so an unrelated ancestry failure never bleeds into the stamp point.
        return { stdout: '', stderr: '', exitCode: rest[2] === mergeSha ? ancestorExitCode : 0 };
      }
      if (bin === 'gh' && rest[0] === 'pr' && rest[1] === 'view') {
        return ok(JSON.stringify({ body: prBody }));
      }
      if (bin === 'git' && rest[0] === 'show') {
        return ledgerAtBase.length > 0
          ? ok(ledgerAtBase)
          : { stdout: '', stderr: 'fatal: path does not exist', exitCode: 128 };
      }
      if (bin === 'gh' && rest[0] === 'pr' && rest[1] === 'checks') {
        return ok(JSON.stringify(checks));
      }
      if (bin === 'git' && rest[0] === 'worktree') {
        return ok(
          worktreeStillExists
            ? `worktree /repo\nHEAD abc\nbranch refs/heads/${fixtureCard().branch}\n`
            : `worktree /repo\nHEAD abc\nbranch refs/heads/master\n`,
        );
      }
      if (bin === 'git' && rest[0] === 'ls-remote') {
        return ok(remoteStillExists ? `abc123\trefs/heads/${rest[rest.length - 1]}\n` : '');
      }
      if (bin === 'git' && rest[0] === 'diff' && rest.includes('--name-only')) {
        return ok(docsOnlyDiffFiles.map((f) => `${f}\n`).join(''));
      }
      if (bin === 'git' && rest[0] === 'diff') {
        return ok(schemaDiffStdout);
      }
      throw new Error(`unmocked exec call: ${cmd.join(' ')}`);
    },
    readFile(resolvedPath: string): string {
      if (!planExists) {
        const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return planContent;
    },
  };
}

/** Wraps `buildIo` to also record every `cmd` array `exec` was invoked with, in order —
 * lets a test assert the LITERAL command string issued, not just the mocked outcome. */
function buildIoRecordingCalls(opts: MockOptions = {}): { io: VerifyIO; calls: string[][] } {
  const calls: string[][] = [];
  const base = buildIo(opts);
  return {
    calls,
    io: {
      ...base,
      async exec(cmd: string[], options?: { cwd?: string }) {
        calls.push(cmd);
        return base.exec(cmd, options);
      },
    },
  };
}

describe('verifyShipped — happy path', () => {
  test('all seven points pass', async () => {
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo(), 'C1');
    expect(result.shipped).toBe(true);
    expect(result.failedPoints).toEqual([]);
    expect(result.points).toHaveLength(7);
    expect(result.points.every((p) => p.passed)).toBe(true);
  });
});

describe('verifyShipped — point 3: checks green + D6 flake classification', () => {
  test('a real red check (non-sonar) fails checksGreen', async () => {
    const io = buildIo({ checks: [{ name: 'unit-tests', bucket: 'fail' }] });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toContain('checksGreen');
  });

  test('sonar-504 signature + docs-only diff is classified as a waivable flake (passes)', async () => {
    const io = buildIo({
      checks: [{ name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'bootstrap failed: HTTP 504' }],
      docsOnlyDiffFiles: ['docs/superpowers/plans/2026-01-01-c1-plan.md'],
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    const point = result.points.find((p) => p.id === 'checksGreen');
    expect(point?.passed).toBe(true);
    expect(point?.detail).toMatch(/waived/i);
  });

  test('sonar-504 signature on a CODE diff is NOT waivable (D6: code PRs never auto-waive)', async () => {
    const io = buildIo({
      checks: [{ name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'bootstrap failed: HTTP 504' }],
      docsOnlyDiffFiles: ['packages/app/src/domain/sample-types.ts'],
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toContain('checksGreen');
  });
});

describe('verifyShipped — point 4: worktree/branch cleanup', () => {
  test('a still-present worktree fails worktreeAndBranchGone', async () => {
    const io = buildIo({ worktreeStillExists: true });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.failedPoints).toContain('worktreeAndBranchGone');
  });

  test('a still-present remote branch fails worktreeAndBranchGone', async () => {
    const io = buildIo({ remoteStillExists: true });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.failedPoints).toContain('worktreeAndBranchGone');
  });
});

describe('verifyShipped — point 5: schema guard', () => {
  test('a non-empty schema-lock diff with no allow flag fails schemaGuard', async () => {
    const io = buildIo({ schemaDiffStdout: 'diff --git a/packages/app/src/domain/sample-types.ts ...\n' });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toContain('schemaGuard');
  });

  test('missing front-matter defaults allowsSchemaChange to false (guard stays enforced)', async () => {
    const io = buildIo({
      schemaDiffStdout: 'diff --git a/packages/app/src/domain/sample-types.ts ...\n',
      planContent: '# c1 plan\n\nNo YAML front matter block at all.\n',
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.failedPoints).toContain('schemaGuard');
  });

  // C1 (HARDENING-BACKLOG): a card is permitted to delete its own planning docs as part of
  // its work (T26's release commit removed docs/plans/), so at verify time the plan path can
  // legitimately be gone. That must never throw out of verifyShipped — the merge already
  // happened and the card would otherwise be left `running` forever.
  test('plan file gone at verify time with an empty schema-lock diff passes without throwing', async () => {
    const io = buildIo({ planExists: false, schemaDiffStdout: '' });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.shipped).toBe(true);
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(true);
  });

  test('plan file gone at verify time with a non-empty schema-lock diff fails closed and names the missing plan', async () => {
    const io = buildIo({
      planExists: false,
      schemaDiffStdout: 'diff --git a/packages/app/src/domain/sample-types.ts ...\n',
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toContain('schemaGuard');
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.detail).toContain(fixtureCard().plan as string);
    expect(point?.detail).toContain('no longer on disk');
  });

  test('front-matter allowsSchemaChange: true waives a non-empty schema-lock diff', async () => {
    const io = buildIo({
      schemaDiffStdout: 'diff --git a/packages/app/src/domain/sample-types.ts ...\n',
      planContent: '---\nallowsSchemaChange: true\n---\n\n# c1 plan\n',
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(true);
  });
});

describe('readAllowsSchemaChange', () => {
  test('returns false when there is no front-matter block', () => {
    expect(readAllowsSchemaChange('# just a plan\n')).toBe(false);
  });

  test('returns false when front-matter exists but the key is absent', () => {
    expect(readAllowsSchemaChange('---\nsomeOtherKey: true\n---\n# plan\n')).toBe(false);
  });

  test('returns true only when the key is explicitly true', () => {
    expect(readAllowsSchemaChange('---\nallowsSchemaChange: true\n---\n# plan\n')).toBe(true);
    expect(readAllowsSchemaChange('---\nallowsSchemaChange: false\n---\n# plan\n')).toBe(false);
  });
});

describe('verifyShipped — multi-failure reporting', () => {
  test('every failed point is named, not just the first', async () => {
    const io = buildIo({
      checks: [{ name: 'unit-tests', bucket: 'fail' }], // real red check -> point 3 fails
      schemaDiffStdout: 'diff --git a/packages/app/src/domain/sample-types.ts ...\n', // point 5 fails
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toEqual(expect.arrayContaining(['checksGreen', 'schemaGuard']));
    // points 1, 2, 4 are untouched by these mocks and should still pass.
    expect(result.points.find((p) => p.id === 'merged')?.passed).toBe(true);
    expect(result.points.find((p) => p.id === 'mergeShaAncestorOfMaster')?.passed).toBe(true);
    expect(result.points.find((p) => p.id === 'worktreeAndBranchGone')?.passed).toBe(true);
  });
});

describe('verifyShipped — never throws', () => {
  test('an exec rejection is reported as a failed point, not a thrown error', async () => {
    const io = buildIo();
    const failingIo: VerifyIO = {
      ...io,
      async exec(cmd: string[]) {
        if (cmd[0] === 'gh' && cmd[1] === 'api') {
          throw new Error('network blip');
        }
        return io.exec(cmd);
      },
    };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), failingIo, 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toContain('merged');
  });
});

// F4 (3-fix): `gh api pulls/<pr>` resolves against the API root, not the current repo, and
// 404s against the real CLI (gh 2.92.0) — verified by the Warchief against a live PR. The
// correct call is `gh api repos/{owner}/{repo}/pulls/<pr>`, where `{owner}`/`{repo}` are gh's
// OWN literal placeholders (substituted by gh itself from the repo in cwd) — never an
// interpolated repo name, which would violate the stateless-capability wall.
describe('verifyShipped — point 1: the real gh api path (F4)', () => {
  test('checkMerged calls gh api against repos/{owner}/{repo}/pulls/<pr>, never bare pulls/<pr>', async () => {
    const { io, calls } = buildIoRecordingCalls();
    await verifyShipped(fixtureCard({ pr: 42 }), fixtureConfig(), io, 'C1');

    const apiCall = calls.find((cmd) => cmd[0] === 'gh' && cmd[1] === 'api');
    expect(apiCall).toEqual(['gh', 'api', 'repos/{owner}/{repo}/pulls/42']);
  });
});

// F2 (3-fix): github.ts treats gh's `skipping` bucket as non-blocking
// (`bucket !== 'pass' && bucket !== 'skipping'`); verify.ts's checkChecksGreen instead failed
// on ANY non-'pass' bucket, so a routine path-filtered `skipping` check (common on scoped
// workflows) would escalate an otherwise healthy card. Warchief ruling: align verify.ts to
// github.ts — skipped is non-blocking.
describe('verifyShipped — point 3: the skipping bucket is non-blocking (F2)', () => {
  test('a check with bucket "skipping" does not fail checksGreen', async () => {
    const io = buildIo({
      checks: [
        { name: 'unit-tests', bucket: 'pass' },
        { name: 'path-filtered-e2e', bucket: 'skipping' },
      ],
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    const point = result.points.find((p) => p.id === 'checksGreen');
    expect(point?.passed).toBe(true);
  });
});

// F1 (3-fix): isDocsOnlyDiff hardcoded the `docs/` prefix — a stateless-wall violation (the
// TARGET repo's directory layout baked into a capability that must work against ANY repo).
// The docs-only path set is now campaign config (`VerifyConfig.docsOnlyPaths`), threaded
// exactly like `schemaLockPaths` already is.
describe('verifyShipped — point 3: docs-only paths are config, not hardcoded (F1)', () => {
  test('a non-"docs/" prefix configured as docsOnlyPaths still waives a matching sonar-504 diff', async () => {
    const io = buildIo({
      checks: [{ name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'bootstrap failed: HTTP 504' }],
      docsOnlyDiffFiles: ['notes/release-notes.md'],
    });
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig({ docsOnlyPaths: ['notes/'] }),
      io,
      'C1',
    );
    const point = result.points.find((p) => p.id === 'checksGreen');
    expect(point?.passed).toBe(true);
    expect(point?.detail).toMatch(/waived/i);
  });

  test('the exact same diff is NOT waived when docsOnlyPaths does not cover it (hardcoded "docs/" must not leak through)', async () => {
    const io = buildIo({
      checks: [{ name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'bootstrap failed: HTTP 504' }],
      docsOnlyDiffFiles: ['notes/release-notes.md'],
    });
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig({ docsOnlyPaths: ['docs/'] }),
      io,
      'C1',
    );
    const point = result.points.find((p) => p.id === 'checksGreen');
    expect(point?.passed).toBe(false);
  });

  test('an EMPTY docsOnlyPaths list fails closed — nothing counts as docs-only, so a code diff never auto-waives', async () => {
    const io = buildIo({
      checks: [{ name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'bootstrap failed: HTTP 504' }],
      docsOnlyDiffFiles: ['docs/note.md'],
    });
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig({ docsOnlyPaths: [] }),
      io,
      'C1',
    );
    const point = result.points.find((p) => p.id === 'checksGreen');
    expect(point?.passed).toBe(false);
    expect(point?.detail).toMatch(/not docs-only/i);
  });
});

describe('verifyShipped — remote/baseBranch are threaded, never hardcoded', () => {
  test('checkAncestor queries <remote>/<baseBranch>, not a hardcoded origin/master', async () => {
    const { io, calls } = buildIoRecordingCalls();
    await verifyShipped(fixtureCard(), fixtureConfig({ remote: 'upstream', baseBranch: 'main' }), io, 'C1');
    const ancestorCall = calls.find((c) => c[1] === 'merge-base');
    expect(ancestorCall).toEqual(['git', 'merge-base', '--is-ancestor', 'mergesha1', 'upstream/main']);
  });

  test('checkWorktreeAndBranchGone queries ls-remote against the resolved remote', async () => {
    const { io, calls } = buildIoRecordingCalls();
    await verifyShipped(fixtureCard(), fixtureConfig({ remote: 'upstream' }), io, 'C1');
    const lsRemoteCall = calls.find((c) => c[1] === 'ls-remote');
    expect(lsRemoteCall).toEqual(['git', 'ls-remote', '--heads', 'upstream', fixtureCard().branch as string]);
  });

  test('isDocsOnlyDiff diffs against <remote>/<baseBranch>', async () => {
    // isDocsOnlyDiff is only invoked from checkChecksGreen's sonar-504 branch (see verify.ts);
    // `checks` must carry that failing signature or the diff call this test asserts on never fires.
    const { io, calls } = buildIoRecordingCalls({
      checks: [{ name: 'SonarCloud Code Analysis', bucket: 'fail', description: 'bootstrap failed: HTTP 504' }],
      docsOnlyDiffFiles: ['docs/note.md'],
    });
    await verifyShipped(fixtureCard(), fixtureConfig({ remote: 'upstream', baseBranch: 'main' }), io, 'C1');
    const diffCall = calls.find((c) => c[0] === 'git' && c[1] === 'diff' && c.includes('--name-only'));
    expect(diffCall).toContain('base0001..upstream/main');
  });

  test('checkSchemaGuard diffs against <remote>/<baseBranch>', async () => {
    const { io, calls } = buildIoRecordingCalls();
    await verifyShipped(fixtureCard(), fixtureConfig({ remote: 'upstream', baseBranch: 'main' }), io, 'C1');
    const diffCall = calls.find(
      (c) => c[0] === 'git' && c[1] === 'diff' && c[2] === 'base0001..upstream/main',
    );
    expect(diffCall).toBeDefined();
  });

  test('checkWorktreeAndBranchGone passing-case detail reflects the resolved remote, not a hardcoded "origin"', async () => {
    const io = buildIo(); // worktree gone, remote branch gone -> passing case
    const result = await verifyShipped(fixtureCard(), fixtureConfig({ remote: 'upstream' }), io, 'C1');
    const point = result.points.find((p) => p.id === 'worktreeAndBranchGone');
    expect(point?.passed).toBe(true);
    expect(point?.detail).toContain(`upstream/${fixtureCard().branch}`);
    expect(point?.detail).not.toContain('origin/');
  });

  test('checkSchemaGuard failing-case (missing baseSha) detail reflects the resolved remote/baseBranch, not hardcoded "origin/master"', async () => {
    const io = buildIo();
    const result = await verifyShipped(
      fixtureCard({ baseSha: null }),
      fixtureConfig({ remote: 'upstream', baseBranch: 'main' }),
      io,
      'C1',
    );
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(false);
    expect(point?.detail).toContain('baseSha..upstream/main');
    expect(point?.detail).not.toContain('origin/master');
  });
});

describe('gapGateStamped (spec §3, card goal G4)', () => {
  const STAMP =
    '<!-- gap-gate v1 card=C1 base=base0001 head=head0001 minted=G-001 matched=none debt-delta=0 ledger=none -->';

  test('a PR body carrying a matching stamp passes the point', async () => {
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig(),
      buildIo({ prBody: `text\n${STAMP}\n`, ledgerAtBase: '{"id":"G-001","event":"opened"}\n' }),
      'C1',
    );
    const point = result.points.find((p) => p.id === 'gapGateStamped');
    expect(point?.passed).toBe(true);
  });

  test('a PR body with no stamp fails the point, and the card is not shipped', async () => {
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: '## Why\n\nno stamp here\n' }), 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toContain('gapGateStamped');
    expect(result.points.find((p) => p.id === 'gapGateStamped')?.detail).toContain('no `gap-gate v1` stamp');
  });

  test("a stamp for a DIFFERENT card fails the point (a copied PR body is not this card's proof)", async () => {
    const other = STAMP.replace('card=C1', 'card=C9');
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: other }), 'C1');
    expect(result.failedPoints).toContain('gapGateStamped');
  });

  test('a stamp whose base sha is not an ancestor of the base branch fails the point', async () => {
    const io = buildIo({ prBody: STAMP });
    const spy: string[][] = [];
    const wrapped = {
      ...io,
      async exec(cmd: string[], o?: { cwd?: string }) {
        spy.push(cmd);
        if (cmd[0] === 'git' && cmd[1] === 'merge-base' && cmd[3] === 'base0001') {
          return { stdout: '', stderr: '', exitCode: 1 };
        }
        return io.exec(cmd, o);
      },
    };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
    expect(result.failedPoints).toContain('gapGateStamped');
    expect(spy.some((c) => c[1] === 'merge-base' && c[3] === 'base0001')).toBe(true);
  });

  test('every point is still reported even when this one fails (never short-circuited)', async () => {
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: 'nothing' }), 'C1');
    expect(result.points.map((p) => p.id)).toEqual([
      'merged',
      'mergeShaAncestorOfMaster',
      'checksGreen',
      'worktreeAndBranchGone',
      'schemaGuard',
      'gapGateStamped',
      'ledgerCommitted',
    ]);
  });
});

describe('ledgerCommitted (spec §3, ledger policy A)', () => {
  const STAMP =
    '<!-- gap-gate v1 card=C1 base=base0001 head=head0001 minted=G-004,G-005 matched=none debt-delta=0 ledger=none -->';

  test('passes when the merged base tree carries every id the stamp says was minted', async () => {
    const ledger = '{"id":"G-004","event":"opened"}\n{"id":"G-005","event":"opened"}\n';
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: STAMP, ledgerAtBase: ledger }), 'C1');
    expect(result.points.find((p) => p.id === 'ledgerCommitted')?.passed).toBe(true);
  });

  test('fails, naming the missing id, when the ledger was never committed', async () => {
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig(),
      buildIo({ prBody: STAMP, ledgerAtBase: '{"id":"G-004","event":"opened"}\n' }),
      'C1',
    );
    expect(result.failedPoints).toContain('ledgerCommitted');
    expect(result.points.find((p) => p.id === 'ledgerCommitted')?.detail).toContain('G-005');
  });

  test('a stamp that minted nothing needs no ledger at all', async () => {
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo(), 'C1');
    expect(result.points.find((p) => p.id === 'ledgerCommitted')?.passed).toBe(true);
  });

  test('the ledger path is campaign config, defaulting to the capability constant', async () => {
    const io = buildIo({ prBody: STAMP, ledgerAtBase: '{"id":"G-004"}{"id":"G-005"}' });
    const seen: string[][] = [];
    const wrapped = {
      ...io,
      async exec(cmd: string[], o?: { cwd?: string }) {
        seen.push(cmd);
        return io.exec(cmd, o);
      },
    };
    await verifyShipped(fixtureCard(), fixtureConfig({ gapLedgerPath: 'ops/gaps.jsonl' }), wrapped, 'C1');
    expect(seen.some((c) => c[0] === 'git' && c[1] === 'show' && c[2] === 'origin/master:ops/gaps.jsonl')).toBe(true);
  });
});

describe('parseGapGateStamp', () => {
  test('reads the canonical stamp of the gap gate', () => {
    const parsed = parseGapGateStamp(
      '<!-- gap-gate v1 card=gap-gate-scripts base=aaaa111 head=bbbb222 minted=G-004,G-005 matched=G-001 debt-delta=0 ledger=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->',
    );
    expect(parsed).toEqual({
      card: 'gap-gate-scripts',
      base: 'aaaa111',
      head: 'bbbb222',
      minted: ['G-004', 'G-005'],
      matched: ['G-001'],
    });
  });

  test('none means an empty list; a truncated stamp is not a stamp', () => {
    expect(parseGapGateStamp('<!-- gap-gate v1 card=C1 base=a head=b minted=none matched=none debt-delta=0 ledger=none -->')?.minted).toEqual([]);
    expect(parseGapGateStamp('<!-- gap-gate v1 card=C1 base=a -->')).toBeNull();
  });
});
