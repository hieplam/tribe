// Tests for verify.ts (Task 3): the D3 five-point SHIPPED replay. Every gh/git call is
// mocked through the injected `io.exec`/`io.readFile` seams — these tests never invoke a
// real binary. Fixture values are deliberately neutral (no repo names, no campaign-specific
// values) — the stateless-capability wall.
//
// ONE deliberate exception, at the bottom of this file: the schema-guard oracle block builds
// REAL git repositories in temp dirs and lets the `io.exec` seam shell out to real git. A
// mocked diff can only ever replay the range the guard already asks for, so it cannot tell a
// right range from a wrong one — only real git commit topology can. `gh` stays mocked there.
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGapGateStamp, readAllowsSchemaChange, schemaGuardRange, verifyShipped } from './verify.ts';
import type { ExecResult, VerifyConfig, VerifyIO, VerifyPointResult } from './verify.ts';
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
  /** The merge commit's two parents, as `git rev-list --parents -n 1 <mergeSha>` would report
   * them (schema guard's new oracle, spec §2.1) — a realistic two-parent line by default. */
  mergeParents?: [string, string];
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
  const mergeParents = opts.mergeParents ?? ['parent0001', 'parent0002'];
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
      if (bin === 'git' && rest[0] === 'rev-list') {
        // Schema guard's oracle (spec §2.1): `git rev-list --parents -n 1 <mergeSha>` reports
        // `<mergeSha> <parent1> <parent2>` on one line for a regular two-parent merge.
        return ok(`${mergeSha} ${mergeParents[0]} ${mergeParents[1]}\n`);
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

  // A card with no recorded base sha cannot be reasoned about at all; the guard refuses
  // rather than reporting a verdict it has not earned.
  test('a card with no baseSha fails the guard closed and says so', async () => {
    const result = await verifyShipped(fixtureCard({ baseSha: null }), fixtureConfig(), buildIo(), 'C1');
    expect(result.failedPoints).toContain('schemaGuard');
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(false);
    expect(point?.detail).toContain('baseSha');
  });
});

// The guard's own failure modes. Every one of these ends in `passed: false`: the Oracle
// (spec §2.1) makes under-checking a BUG and failing closed on an undecidable range BY
// DESIGN, so "the check could not run" must never be reported as "nothing changed".
describe('verifyShipped — point 5: the schema guard fails CLOSED, never open', () => {
  /** Replaces one git subcommand's result, leaving every other mocked call intact. */
  function withGitFailure(
    opts: MockOptions,
    match: (cmd: string[]) => boolean,
    failure: ExecResult,
  ): { io: VerifyIO; calls: string[][] } {
    const { io: base, calls } = buildIoRecordingCalls(opts);
    return {
      calls,
      io: {
        ...base,
        async exec(cmd: string[], options?: { cwd?: string }): Promise<ExecResult> {
          if (match(cmd)) {
            calls.push(cmd);
            return failure;
          }
          return base.exec(cmd, options);
        },
      },
    };
  }

  const isSchemaDiff = (cmd: string[]): boolean =>
    cmd[0] === 'git' && cmd[1] === 'diff' && !cmd.includes('--name-only');

  // The three-dot form REQUIRES a merge base; real git refuses outright when there is none
  // (`git diff <A>...<B> -- .` -> exit 128, EMPTY stdout, "fatal: <A>...<B>: no merge base").
  // Reading that empty stdout as "no locked-path change" would pass the guard on a diff that
  // never ran — the exact under-check the Oracle forbids.
  test('a non-zero exit from the schema-lock diff fails the guard and names the exit code and stderr', async () => {
    const { io } = withGitFailure({}, isSchemaDiff, {
      stdout: '',
      stderr: 'fatal: parent0001...parent0002: no merge base',
      exitCode: 128,
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(false);
    expect(result.failedPoints).toContain('schemaGuard');
    expect(point?.detail).toContain('128');
    expect(point?.detail).toContain('no merge base');
    // And it is not mistakable for the genuine-empty-diff verdict.
    expect(point?.detail).not.toContain('no diff on schema-lock paths');
  });

  // `run()` folds a THROWN io.exec into `{ exitCode: 1 }`, so the same exit-code check covers
  // an adapter that throws as well as a git that exits non-zero.
  test('an exec that throws on the schema-lock diff also fails the guard closed', async () => {
    const base = buildIo();
    const io: VerifyIO = {
      ...base,
      async exec(cmd: string[], options?: { cwd?: string }): Promise<ExecResult> {
        if (isSchemaDiff(cmd)) throw new Error('spawn git ENOENT');
        return base.exec(cmd, options);
      },
    };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(false);
    expect(point?.detail).toContain('spawn git ENOENT');
  });

  // A failed parent lookup leaves NO parents. Reporting that as "has 0 parent(s), not 2" is a
  // lie about the commit: it is indistinguishable from a real parentless commit, and A-F1
  // shows what a mis-described failure costs.
  test('a failed parent lookup refuses as a LOOKUP failure, not as a 0-parent commit', async () => {
    const { io } = withGitFailure({}, (cmd) => cmd[0] === 'git' && cmd[1] === 'rev-list', {
      stdout: '',
      stderr: 'fatal: bad object mergesha1',
      exitCode: 128,
    });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(false);
    expect(point?.detail).not.toContain('0 parent(s)');
    expect(point?.detail).toContain('could not be read');
  });

  // With no merge sha there is nothing to look the parents of UP: issuing
  // `git rev-list --parents -n 1 null` spends a subprocess on the literal string "null" and
  // puts a nonsense command in the trace the next debugger reads.
  test('no merge sha means no parent-lookup subprocess is spawned at all', async () => {
    const { io, calls } = buildIoRecordingCalls({ mergeSha: null });
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
    const revListCalls = calls.filter((c) => c[0] === 'git' && c[1] === 'rev-list');
    expect(revListCalls).toEqual([]);
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(false);
  });
});

// Spec §4 item 1, verbatim: "`schemaGuardRange` both directions and every refusal".
describe('schemaGuardRange (pure)', () => {
  test('a regular two-parent merge yields first-parent...second-parent', () => {
    expect(schemaGuardRange({ mergeSha: 'merge01', parents: ['p1', 'p2'] })).toEqual({
      kind: 'range',
      from: 'p1',
      to: 'p2',
    });
  });

  test('refuses when the merge sha is unknown', () => {
    const range = schemaGuardRange({ mergeSha: null, parents: [] });
    expect(range.kind).toBe('refuse');
    if (range.kind !== 'refuse') throw new Error('unreachable');
    expect(range.detail).toContain('merge commit sha is unknown');
  });

  // A squash merge, a rebase merge and a fast-forward all land as ONE parent — no two-parent
  // anchor, so the branch's own commits cannot be identified. Failing closed here is BY
  // DESIGN, and the campaign's mergePolicy means it cannot fire on a compliant card.
  test('refuses a one-parent commit (squash / rebase-merge / fast-forward) and names the count', () => {
    const range = schemaGuardRange({ mergeSha: 'merge01', parents: ['p1'] });
    expect(range.kind).toBe('refuse');
    if (range.kind !== 'refuse') throw new Error('unreachable');
    expect(range.detail).toContain('merge01');
    expect(range.detail).toContain('1 parent(s), not 2');
  });

  test('refuses an octopus merge, naming the real parent count', () => {
    const range = schemaGuardRange({ mergeSha: 'merge01', parents: ['p1', 'p2', 'p3'] });
    expect(range.kind).toBe('refuse');
    if (range.kind !== 'refuse') throw new Error('unreachable');
    expect(range.detail).toContain('3 parent(s), not 2');
  });

  // `null` parents means the EDGE could not read them. That is a different fact from a
  // commit that genuinely has none, and the refusal must not conflate the two.
  test('refuses an unreadable parent list distinctly from a real parent count', () => {
    const range = schemaGuardRange({ mergeSha: 'merge01', parents: null });
    expect(range.kind).toBe('refuse');
    if (range.kind !== 'refuse') throw new Error('unreachable');
    expect(range.detail).toContain('could not be read');
    expect(range.detail).not.toContain('0 parent(s)');
  });

  test('is pure: the same input gives the same answer every time', () => {
    const input = { mergeSha: 'merge01', parents: ['p1', 'p2'] };
    expect(schemaGuardRange(input)).toEqual(schemaGuardRange(input));
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

  // Superseded (Task 2, schema guard's real oracle, spec §2.1): the guard used to diff
  // `baseSha..<remote>/<baseBranch>`, which is exactly the false-positive range the card
  // eliminates. The oracle is now the card branch's OWN commits — the three-dot range between
  // the merge commit's two parents — and <remote>/<baseBranch> plays no part in it at all.
  test('checkSchemaGuard diffs the merge commit two parents (mergeSha rev-list), never <remote>/<baseBranch>', async () => {
    const { io, calls } = buildIoRecordingCalls({ mergeParents: ['parent0001', 'parent0002'] });
    await verifyShipped(fixtureCard(), fixtureConfig({ remote: 'upstream', baseBranch: 'main' }), io, 'C1');
    const diffCall = calls.find(
      (c) => c[0] === 'git' && c[1] === 'diff' && c[2] === 'parent0001...parent0002',
    );
    expect(diffCall).toBeDefined();
    expect(diffCall).not.toContain('base0001..upstream/main');
    expect(diffCall?.join(' ')).not.toContain('upstream/main');
  });

  test('checkWorktreeAndBranchGone passing-case detail reflects the resolved remote, not a hardcoded "origin"', async () => {
    const io = buildIo(); // worktree gone, remote branch gone -> passing case
    const result = await verifyShipped(fixtureCard(), fixtureConfig({ remote: 'upstream' }), io, 'C1');
    const point = result.points.find((p) => p.id === 'worktreeAndBranchGone');
    expect(point?.passed).toBe(true);
    expect(point?.detail).toContain(`upstream/${fixtureCard().branch}`);
    expect(point?.detail).not.toContain('origin/');
  });

  // Superseded (Task 2): this used to pin the failing detail naming the OLD
  // `baseSha..<remote>/<baseBranch>` range. The guard's failing detail now names the range it
  // actually diffed — the merge commit's two parents — and never <remote>/<baseBranch> at all.
  test('checkSchemaGuard failing-case detail names the range actually diffed (mergeSha rev-list parents), never <remote>/<baseBranch>', async () => {
    const io = buildIo({
      schemaDiffStdout: 'diff --git a/packages/app/src/domain/sample-types.ts ...\n',
      mergeParents: ['parent0001', 'parent0002'],
    });
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig({ remote: 'upstream', baseBranch: 'main' }),
      io,
      'C1',
    );
    const point = result.points.find((p) => p.id === 'schemaGuard');
    expect(point?.passed).toBe(false);
    expect(point?.detail).toContain('parent0001...parent0002');
    expect(point?.detail).not.toContain('upstream/main');
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

  test('a stamp naming the Tribe-Card slug of the merged commits passes (runner id differs)', async () => {
    const slugStamp = STAMP.replace('card=C1', 'card=gap-gate-wiring');
    const io = buildIo({ prBody: slugStamp, ledgerAtBase: '{"id":"G-001","event":"opened"}\n' });
    const wrapped = { ...io, async exec(cmd: string[], o?: { cwd?: string }) {
      if (cmd[0] === 'git' && cmd[1] === 'log') return { stdout: 'gap-gate-wiring\ngap-gate-wiring\n', stderr: '', exitCode: 0 };
      return io.exec(cmd, o);
    } };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
    expect(result.points.find((p) => p.id === 'gapGateStamped')?.passed).toBe(true);
  });

  test('a stamp naming a slug that NO merged commit carries still fails', async () => {
    const slugStamp = STAMP.replace('card=C1', 'card=some-other-card');
    const io = buildIo({ prBody: slugStamp });
    const wrapped = { ...io, async exec(cmd: string[], o?: { cwd?: string }) {
      if (cmd[0] === 'git' && cmd[1] === 'log') return { stdout: 'gap-gate-wiring\n', stderr: '', exitCode: 0 };
      return io.exec(cmd, o);
    } };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
    expect(result.failedPoints).toContain('gapGateStamped');
    expect(result.points.find((p) => p.id === 'gapGateStamped')?.detail).toContain('some-other-card');
  });

  test('a git log that FAILS but emits partial matching stdout does NOT pass (fail closed)', async () => {
    const slugStamp = STAMP.replace('card=C1', 'card=gap-gate-wiring');
    const io = buildIo({ prBody: slugStamp });
    const wrapped = { ...io, async exec(cmd: string[], o?: { cwd?: string }) {
      if (cmd[0] === 'git' && cmd[1] === 'log') return { stdout: 'gap-gate-wiring\n', stderr: 'fatal: bad revision', exitCode: 128 };
      return io.exec(cmd, o);
    } };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
    expect(result.failedPoints).toContain('gapGateStamped');
  });

  test('a differing stamp card with a null merge sha fails clearly and never attempts git log', async () => {
    const slugStamp = STAMP.replace('card=C1', 'card=gap-gate-wiring');
    let logCalls = 0;
    const io = buildIo({ prBody: slugStamp, mergeSha: null });
    const wrapped = { ...io, async exec(cmd: string[], o?: { cwd?: string }) {
      if (cmd[0] === 'git' && cmd[1] === 'log') { logCalls++; return { stdout: 'gap-gate-wiring\n', stderr: '', exitCode: 0 }; }
      return io.exec(cmd, o);
    } };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
    expect(result.failedPoints).toContain('gapGateStamped');
    expect(result.points.find((p) => p.id === 'gapGateStamped')?.detail).toContain('not C1');
    expect(logCalls).toBe(0);
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

// =======================================================================================
// The schema guard's oracle, against REAL git (see this file's header note).
//
// Oracle (spec §2.1, card verbatim): the guard's subject is the card branch's OWN commits —
// never `baseSha..<remote>/<baseBranch>`, never `baseSha...mergeSha`. Under-checking (letting
// a branch-authored locked-path change through) is a BUG; over-checking / failing closed on
// an undecidable range is BY DESIGN.
// =======================================================================================

/** Host git config neutralised (`fail-closed-edges.md` obligation 2: an unusual-but-legal
 * host setting — commit.gpgsign, a global hooks path, a template dir — must not be able to
 * change this test's verdict) and identity supplied so `git commit` works on any machine. */
const GIT_TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t.test',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t.test',
};

/** Every call bounded (`fail-closed-edges.md` obligation 3) — a hung git is indistinguishable
 * from a broken one. Throws on non-zero exit: fixture construction must never half-succeed. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, env: GIT_TEST_ENV });
}

/** The same call as `git()`, but shaped as the `VerifyIO.exec` seam's `ExecResult` — a
 * non-zero git exit is a reportable outcome here, not a throw (that is exactly what the
 * production `run()` wrapper does with the real adapter). */
function gitExec(cwd: string, args: string[]): ExecResult {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: GIT_TEST_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
  }
}

function commitFile(repo: string, rel: string, body: string, msg: string): void {
  const abs = join(repo, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
  git(repo, 'add', rel);
  git(repo, 'commit', '-q', '-m', msg);
}

interface RepoFixture {
  repo: string;
  baseSha: string;
  mergeSha: string;
}

/** Owns the temp directory's WHOLE lifecycle. The path is captured before any fallible work
 * and released in a `finally` that runs whether `build` or `body` throws — `git()` uses
 * `execFileSync`, which throws on any non-zero git exit, so a directory that is created
 * first and handed back last leaks on every construction failure. `build` is injected so
 * that property is itself testable. */
async function withRepo(
  build: (repo: string) => { baseSha: string; mergeSha: string },
  body: (fixture: RepoFixture) => Promise<void>,
): Promise<void> {
  const repo = mkdtempSync(join(tmpdir(), 'guard-'));
  try {
    await body({ repo, ...build(repo) });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

/** `branchTouchesLockedPath` selects the DIRECTION under test. Both directions contain a
 * MASTER-side locked-path commit that the card branch absorbed by merging master in — that
 * is the recorded shape of the false positive (spec §1.1), and it is what makes the two
 * directions distinguishable only by which commits the guard diffs.
 *
 * Builds inside an ALREADY-CREATED `repo` (see `withRepo`) and returns the card's `baseSha`
 * and the merge commit sha. */
function buildRepo(repo: string, branchTouchesLockedPath: boolean): { baseSha: string; mergeSha: string } {
  git(repo, 'init', '-q', '-b', 'master');
  commitFile(repo, 'README.md', 'base\n', 'init');
  const baseSha = git(repo, 'rev-parse', 'HEAD').trim();

  git(repo, 'checkout', '-q', '-b', 'card');
  commitFile(repo, 'src/feature.ts', 'export const a = 1;\n', 'card work');
  if (branchTouchesLockedPath) {
    // A DIFFERENT file under the locked prefix than the master-side commit below. Both
    // branches creating the same path is an add/add conflict, which would abort the merge
    // and destroy the fixture before the guard ever ran; what the oracle cares about is
    // "a commit authored on the card branch touched a locked PATH", which this is.
    commitFile(repo, 'locked/card-schema.ts', 'export type Y = 2;\n', 'card edits a locked path');
  }

  git(repo, 'checkout', '-q', 'master');
  commitFile(repo, 'locked/schema.ts', 'export type X = 1;\n', 'master-side locked-path change');

  git(repo, 'checkout', '-q', 'card');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge master into card', 'master');

  git(repo, 'checkout', '-q', 'master');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'card');
  const mergeSha = git(repo, 'rev-parse', 'HEAD').trim();

  // The guard resolves `<remote>/<baseBranch>`; a real card repo always has that
  // remote-tracking ref, pointing at master with the card's merge already in it. Created as
  // a bare ref with NO remote URL, so nothing in this test can reach the network.
  git(repo, 'update-ref', 'refs/remotes/origin/master', 'master');
  return { baseSha, mergeSha };
}

/** Drives the real `checkSchemaGuard` — which is module-private — through `verifyShipped`'s
 * own seam, and returns the `schemaGuard` point. `gh` is stubbed (the PR is merged, with
 * `merge_commit_sha = mergeSha`); every `git` call goes to REAL git in the temp repo. */
async function runGuard(opts: {
  repo: string;
  baseSha: string;
  mergeSha: string;
  lockedPaths: string[];
}): Promise<VerifyPointResult> {
  const card = fixtureCard({
    branch: 'card',
    baseSha: opts.baseSha,
    // No plan on disk: the `allowsSchemaChange` waiver is a separate, already-covered path,
    // and a waiver would mask the very verdict these two tests measure.
    plan: null,
  });
  const config = fixtureConfig({ repoRoot: opts.repo, schemaLockPaths: opts.lockedPaths });
  const io: VerifyIO = {
    fileExists(): boolean {
      return false;
    },
    readFile(): string {
      throw new Error('no plan file in this fixture; readFile must not be reached');
    },
    async exec(cmd: string[], options?: { cwd?: string }): Promise<ExecResult> {
      const [bin, ...rest] = cmd;
      if (bin === 'git') return gitExec(options?.cwd ?? opts.repo, rest);
      if (bin === 'gh' && rest[0] === 'api') {
        return { stdout: JSON.stringify({ merged: true, merge_commit_sha: opts.mergeSha }), stderr: '', exitCode: 0 };
      }
      if (bin === 'gh' && rest[0] === 'pr' && rest[1] === 'checks') {
        return { stdout: JSON.stringify([{ name: 'ci', bucket: 'pass' }]), stderr: '', exitCode: 0 };
      }
      if (bin === 'gh' && rest[0] === 'pr' && rest[1] === 'view') {
        return { stdout: JSON.stringify({ body: '' }), stderr: '', exitCode: 0 };
      }
      throw new Error(`unmocked exec call: ${cmd.join(' ')}`);
    },
  };
  const result = await verifyShipped(card, config, io, 'C1');
  const point = result.points.find((p) => p.id === 'schemaGuard');
  if (!point) throw new Error('verifyShipped reported no schemaGuard point');
  return point;
}

describe('checkSchemaGuard: the oracle is the card branch OWN commits', () => {
  test('PASSES when only MASTER touched a locked path while the card was in flight', async () => {
    await withRepo(
      (repo) => buildRepo(repo, false),
      async ({ repo, baseSha, mergeSha }) => {
        const result = await runGuard({ repo, baseSha, mergeSha, lockedPaths: ['locked/'] });
        expect(result.passed).toBe(true);
      },
    );
  });

  test('FAILS when the card branch OWN commit touched a locked path', async () => {
    await withRepo(
      (repo) => buildRepo(repo, true),
      async ({ repo, baseSha, mergeSha }) => {
        const result = await runGuard({ repo, baseSha, mergeSha, lockedPaths: ['locked/'] });
        expect(result.passed).toBe(false);
        // Fails for the RIGHT reason: the verdict names the locked prefix, not some unrelated
        // breakage (a missing ref, an unresolvable range) that also yields `passed: false`.
        expect(result.detail).toContain('locked/');
      },
    );
  });

  // The fixture's own contract. `git()` throws on any non-zero exit, so the construction of
  // these repositories is fallible; a temp directory created before that work and released
  // only by the caller survives every failure, and a test run that fails leaves litter in
  // the system temp dir forever.
  test('the temp repository is released even when its construction throws', async () => {
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('guard-')));
    let bodyRan = false;
    await expect(
      withRepo(
        (repo) => {
          git(repo, 'init', '-q', '-b', 'master');
          return { baseSha: git(repo, 'rev-parse', 'HEAD').trim(), mergeSha: '' }; // throws: no commits yet
        },
        async () => {
          bodyRan = true;
        },
      ),
    ).rejects.toThrow();
    expect(bodyRan).toBe(false);
    const leaked = readdirSync(tmpdir())
      .filter((n) => n.startsWith('guard-') && !before.has(n))
      .map((n) => join(tmpdir(), n))
      .filter((p) => existsSync(p));
    expect(leaked).toEqual([]);
  });

  test('the temp repository is released even when the test body throws', async () => {
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('guard-')));
    await expect(
      withRepo(
        (repo) => buildRepo(repo, false),
        async () => {
          throw new Error('body failed');
        },
      ),
    ).rejects.toThrow('body failed');
    const leaked = readdirSync(tmpdir())
      .filter((n) => n.startsWith('guard-') && !before.has(n))
      .map((n) => join(tmpdir(), n))
      .filter((p) => existsSync(p));
    expect(leaked).toEqual([]);
  });
});
