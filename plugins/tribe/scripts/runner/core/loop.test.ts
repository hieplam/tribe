// Tests for loop.ts (Task 6): the §D4 resume matrix, the single-instance lock, the STOP
// file, escalation, and `--dry-run`'s zero-side-effects guarantee.
//
// NEVER hits a real binary or the SDK: every test drives a fully mocked `LoopIO`. Fixture
// values are deliberately neutral (no repo names, no absolute paths, no campaign values) —
// the stateless-capability wall.
import { describe, expect, mock, test } from 'bun:test';
import {
  acquireLock,
  checkoutMismatchNote,
  deriveCardPhase,
  extractMergeSha,
  isStopRequested,
  liveLockHolder,
  releaseLock,
  resolveBaseBranch,
  runLoop,
  type DerivePhaseConfig,
  type DerivePhaseIO,
  type ExecResult,
  type LockIO,
  type LockInfo,
  type LoopIO,
  type RunLoopConfig,
} from './loop.ts';
import { EXIT_ESCALATED, EXIT_LOCKED, EXIT_OK, EXIT_RULINGS_UNRATIFIED, EXIT_SESSION_INCOMPLETE } from './types.ts';
import { BRIEF_TEMPLATE_PATH } from './brief.ts';
import { answersPathOf, campaignStatePathOf, escalationPathOf } from './paths.ts';
import type { Card, CampaignState, ResolvedConfig } from './types.ts';
import type { SessionMessage, SpawnSessionParams } from './session.ts';
import { verifyShipped } from './verify.ts';
import type { VerifyConfig, VerifyResult } from './verify.ts';
// P4 fix-list item: `healSafeResidue` is the ONE helper `actOnCard`'s two verify call sites
// use to self-heal safe residue between a first failed verify and the retry — exercised
// directly here (same `CardCtx` shape `runPass` builds) so the healed retry detail is
// observable, which `CardOutcome`'s `shipped` variant deliberately does not carry.
import {
  healSafeResidue,
  CONTINUE_UNKNOWN_STATE_PROMPT,
  recordBaseSha,
  shipCard,
  escalateCard,
  performRevertAndRedo,
} from './loop/card-actions.ts';
import type { CardCtx } from './loop/card-actions.ts';
// P4 audit fix-round: proving the "report notes the heal" acceptance criterion at the ONLY
// artifact an orchestrating session actually reads (report.ts), not just at healSafeResidue's
// in-memory VerifyResult.
import { buildCampaignReport, renderReportMarkdown } from './report.ts';

// ---------------------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------------------

function ok(stdout = ''): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}
function fail(stderr = 'command failed'): ExecResult {
  return { stdout: '', stderr, exitCode: 1 };
}

function fixtureCard(overrides: Partial<Card> = {}): Card {
  return {
    status: 'staged',
    spec: 'docs/specs/c1.md',
    plan: 'docs/plans/c1.md',
    branch: 'feat/c1-widget',
    baseSha: null,
    pr: null,
    mergeSha: null,
    sessionId: null,
    updatedAt: null,
    ...overrides,
  };
}

function fixtureState(overrides: Partial<CampaignState> = {}): CampaignState {
  return {
    v: 1,
    campaign: 'sample-campaign',
    mergePolicy: 'merge',
    sequence: ['C1', 'C2'],
    schemaLockPaths: [],
    docsOnlyPaths: ['docs/'],
    ownerOnlyEscalations: [],
    cards: {
      C1: fixtureCard(),
      C2: fixtureCard({ branch: 'feat/c2-widget' }),
    },
    ...overrides,
  };
}

// ===========================================================================================
// deriveCardPhase — the §D4 reality table
// ===========================================================================================

describe('deriveCardPhase — §D4 reality table', () => {
  const baseConfig: DerivePhaseConfig = {
    repoRoot: '/sample-repo',
    homeDir: '/th',
    includeEscalated: false,
    remote: 'origin',
  };

  function ioWith(handlers: {
    prView?: ExecResult;
    worktreeList?: ExecResult;
    lsRemote?: ExecResult;
    fileExists?: boolean;
  }): DerivePhaseIO {
    return {
      exec: mock(async (cmd: string[]) => {
        if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') {
          return handlers.prView ?? fail('no pull requests found for branch');
        }
        if (cmd[0] === 'git' && cmd[1] === 'worktree') {
          return handlers.worktreeList ?? ok('');
        }
        if (cmd[0] === 'git' && cmd[1] === 'ls-remote') {
          return handlers.lsRemote ?? ok('');
        }
        throw new Error(`unexpected exec: ${cmd.join(' ')}`);
      }),
      fileExists: mock(() => handlers.fileExists ?? false),
    };
  }

  test('no trace (card.branch null) -> fresh', async () => {
    const io = ioWith({});
    const phase = await deriveCardPhase('C1', fixtureCard({ branch: null }), baseConfig, io);
    expect(phase).toEqual({ kind: 'fresh' });
  });

  test('PR merged, state not yet shipped -> verify_only, no session', async () => {
    const io = ioWith({ prView: ok(JSON.stringify({ number: 42, state: 'MERGED' })) });
    const phase = await deriveCardPhase('C1', fixtureCard(), baseConfig, io);
    expect(phase).toEqual({ kind: 'verify_only', pr: 42 });
  });

  test('PR open, sessionId recorded -> resume with reason pr_open', async () => {
    const io = ioWith({ prView: ok(JSON.stringify({ number: 7, state: 'OPEN' })) });
    const phase = await deriveCardPhase('C1', fixtureCard({ sessionId: 'sess-1' }), baseConfig, io);
    expect(phase).toEqual({ kind: 'resume', sessionId: 'sess-1', reason: 'pr_open', pr: 7 });
  });

  test('PR open, no sessionId recorded -> fresh WITH a digest naming the open PR (F8, not blind)', async () => {
    // F8: there IS a trace here (an open PR on GitHub) even though nothing is resumable —
    // a blind `{ kind: 'fresh' }` (no digest) would spawn an executor that doesn't know the
    // PR exists and would rebuild the card, opening a SECOND PR. The fix must carry a digest
    // naming PR #7 so the executor is told to continue it instead.
    const io = ioWith({ prView: ok(JSON.stringify({ number: 7, state: 'OPEN' })) });
    const phase = await deriveCardPhase('C1', fixtureCard({ sessionId: null }), baseConfig, io);
    expect(phase.kind).toBe('fresh');
    if (phase.kind === 'fresh') {
      expect(phase.digest).toBeDefined();
      expect(phase.digest).toContain('7');
    }
  });

  test('genuine no-trace (card.branch null, no sessionId either) still yields a plain blind fresh — no bogus digest', async () => {
    const io = ioWith({});
    const phase = await deriveCardPhase('C1', fixtureCard({ branch: null }), baseConfig, io);
    expect(phase).toEqual({ kind: 'fresh' });
    if (phase.kind === 'fresh') {
      expect(phase.digest).toBeUndefined();
    }
  });

  // P1 audit fix-round (blocker, skinnerB): the exact incident shape — an executor "opens its
  // PR ... then ends its turn" with no terminal line — leaves `card.branch`/`card.pr` null
  // (session.ts's `parseResultMessage` never populates `pr` on an `'error'` outcome, and
  // `card-actions.ts`'s `recordBranchFromPr` is gated on `card.pr`), even though
  // `onSessionStart` DID record `card.sessionId` the instant the SDK assigned it. Before this
  // fix, `!card.branch` short-circuited straight to a blind `{ kind: 'fresh' }` here, silently
  // discarding that sessionId and risking a duplicate PR/worktree on the very retry the P1
  // spec exists to make safe. It must instead resume the one thing that DOES know what
  // happened: the prior SDK session itself.
  test('no branch/PR recorded, but sessionId IS recorded (P1 incident shape: session opened a PR then errored before reporting) -> resume with reason session_only', async () => {
    const io = ioWith({});
    const phase = await deriveCardPhase(
      'C1',
      fixtureCard({ branch: null, sessionId: 'sess-c1-try1' }),
      baseConfig,
      io,
    );
    expect(phase).toEqual({ kind: 'resume', sessionId: 'sess-c1-try1', reason: 'session_only' });
  });

  test('branch/worktree exist (worktree present), sessionId recorded -> resume with reason branch_no_pr', async () => {
    const io = ioWith({
      worktreeList: ok('worktree /w/c1\nHEAD abc\nbranch refs/heads/feat/c1-widget\n'),
    });
    const phase = await deriveCardPhase('C1', fixtureCard({ sessionId: 'sess-2' }), baseConfig, io);
    expect(phase).toEqual({ kind: 'resume', sessionId: 'sess-2', reason: 'branch_no_pr' });
  });

  test('branch/worktree exist (remote only), no sessionId -> REVERT_AND_REDO', async () => {
    const io = ioWith({ lsRemote: ok('abc123\trefs/heads/feat/c1-widget\n') });
    const phase = await deriveCardPhase('C1', fixtureCard({ sessionId: null }), baseConfig, io);
    expect(phase).toEqual({ kind: 'revert_and_redo' });
  });

  test('branchOrWorktreeExists ls-remotes the resolved remote, not a hardcoded "origin"', async () => {
    const calls: string[][] = [];
    const io: DerivePhaseIO = {
      exec: mock(async (cmd: string[]) => {
        calls.push(cmd);
        if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') {
          return fail('no pull requests found for branch');
        }
        if (cmd[0] === 'git' && cmd[1] === 'worktree') return ok('');
        if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('abc123\trefs/heads/feat/c1-widget\n');
        throw new Error(`unexpected exec: ${cmd.join(' ')}`);
      }),
      fileExists: mock(() => false),
    };
    const phase = await deriveCardPhase(
      'C1',
      fixtureCard({ sessionId: null }),
      { ...baseConfig, remote: 'upstream' },
      io,
    );
    expect(phase).toEqual({ kind: 'revert_and_redo' });
    const lsRemoteCall = calls.find((c) => c[1] === 'ls-remote');
    expect(lsRemoteCall).toEqual(['git', 'ls-remote', '--heads', 'upstream', 'feat/c1-widget']);
  });

  test('escalation file exists for the card -> EXIT: answer pending', async () => {
    const io = ioWith({ fileExists: true });
    const phase = await deriveCardPhase('C1', fixtureCard(), baseConfig, io);
    expect(phase.kind).toBe('escalation_pending');
    if (phase.kind === 'escalation_pending') {
      expect(phase.escalationPath).toContain('C1.md');
    }
  });

  test('--include-escalated bypasses the escalation-file short-circuit', async () => {
    const io = ioWith({ fileExists: true });
    const phase = await deriveCardPhase(
      'C1',
      fixtureCard({ branch: null }),
      { ...baseConfig, includeEscalated: true },
      io,
    );
    expect(phase).toEqual({ kind: 'fresh' });
  });
});

// ===========================================================================================
// Lock: acquireLock / releaseLock
// ===========================================================================================

describe('acquireLock / releaseLock — §D2 single-instance lock', () => {
  function lockIo(existing: LockInfo | null, alive: boolean): LockIO & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      readLock: () => existing,
      writeLock: (info) => {
        calls.push(`writeLock:${info.pid}:${info.startedAt}`);
      },
      removeLock: () => calls.push('removeLock'),
      isProcessAlive: (pid) => {
        calls.push(`isProcessAlive:${pid}`);
        return alive;
      },
      currentPid: () => 999,
      now: () => '2026-07-16T00:00:00Z',
    };
  }

  test('no existing lock -> acquired, lock written with pid + start time', () => {
    const io = lockIo(null, false);
    const result = acquireLock(io);
    expect(result.ok).toBe(true);
    expect(io.calls).toEqual(['writeLock:999:2026-07-16T00:00:00Z']);
  });

  test('existing lock held by a LIVE pid -> refused, lock is NOT overwritten', () => {
    const io = lockIo({ pid: 123, startedAt: '2026-07-15T00:00:00Z' }, true);
    const result = acquireLock(io);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('123');
      expect(result.heldBy.pid).toBe(123);
    }
    expect(io.calls).toEqual(['isProcessAlive:123']);
  });

  test('existing lock held by a DEAD pid -> reclaimed, never wedges the runner', () => {
    const io = lockIo({ pid: 123, startedAt: '2026-07-15T00:00:00Z' }, false);
    const result = acquireLock(io);
    expect(result.ok).toBe(true);
    expect(io.calls).toEqual(['isProcessAlive:123', 'writeLock:999:2026-07-16T00:00:00Z']);
  });

  test('releaseLock removes the lock file', () => {
    const calls: string[] = [];
    releaseLock({ removeLock: () => calls.push('removed') });
    expect(calls).toEqual(['removed']);
  });
});

// P11 fix-list follow-up: `liveLockHolder` is the read-only half of `acquireLock` extracted so
// the `reset-card` CLI subcommand can ask "is a pass currently mid-flight on this campaign?"
// WITHOUT claiming the lock itself (unlike `acquireLock`, it never calls `writeLock`).
describe('liveLockHolder — the read-only lock check reset-card needs (P11 follow-up)', () => {
  test('no existing lock -> null, writeLock never called', () => {
    const io = { readLock: () => null, isProcessAlive: () => true };
    expect(liveLockHolder(io)).toBeNull();
  });

  test('existing lock held by a LIVE pid -> returns it verbatim', () => {
    const lock = { pid: 123, startedAt: '2026-07-15T00:00:00Z' };
    const io = { readLock: () => lock, isProcessAlive: (pid: number) => pid === 123 };
    expect(liveLockHolder(io)).toEqual(lock);
  });

  test('existing lock held by a DEAD pid -> null (dead-process debris, not a live claim)', () => {
    const io = { readLock: () => ({ pid: 123, startedAt: '2026-07-15T00:00:00Z' }), isProcessAlive: () => false };
    expect(liveLockHolder(io)).toBeNull();
  });

  test('acquireLock refuses using the exact same liveness check (no drift between the two)', () => {
    const lock = { pid: 123, startedAt: '2026-07-15T00:00:00Z' };
    const io: LockIO = {
      readLock: () => lock,
      writeLock: () => {},
      removeLock: () => {},
      isProcessAlive: (pid) => pid === 123,
      currentPid: () => 999,
      now: () => '2026-07-16T00:00:00Z',
    };
    const acquireResult = acquireLock(io);
    const held = liveLockHolder(io);
    expect(acquireResult.ok).toBe(false);
    expect(held).not.toBeNull();
    if (!acquireResult.ok && held) {
      expect(acquireResult.heldBy).toEqual(held);
    }
  });
});

// ===========================================================================================
// STOP file
// ===========================================================================================

describe('isStopRequested', () => {
  test('true when the STOP file exists', () => {
    expect(isStopRequested('/state/STOP', { fileExists: () => true })).toBe(true);
  });
  test('false when it does not', () => {
    expect(isStopRequested('/state/STOP', { fileExists: () => false })).toBe(false);
  });
});

// ===========================================================================================
// resolveBaseBranch
// ===========================================================================================

describe('resolveBaseBranch', () => {
  test('strips the "origin/" prefix from <remote>/HEAD', async () => {
    const calls: string[][] = [];
    const io = {
      exec: mock(async (cmd: string[]) => {
        calls.push(cmd);
        return ok('upstream/master\n');
      }),
    };
    expect(await resolveBaseBranch(io, '/repo', 'upstream')).toBe('master');
    expect(calls[0]).toEqual(['git', 'symbolic-ref', '--short', 'refs/remotes/upstream/HEAD']);
  });

  test('falls back to "master" when the query fails', async () => {
    const io = { exec: mock(async () => fail('no such ref')) };
    expect(await resolveBaseBranch(io, '/repo', 'origin')).toBe('master');
  });
});

// ===========================================================================================
// checkoutMismatchNote — C2 (HARDENING-BACKLOG): `nextCard` resolves a card's spec/plan
// against `--repo`'s WORKING TREE, so a main checkout left in detached HEAD (T27's `--adopt`
// run left it on a release tag where docs/specs/ did not exist) makes every card read as
// "missing spec, plan". The pure note names the real cause so the escalation is actionable.
// ===========================================================================================

describe('checkoutMismatchNote', () => {
  test('detached HEAD names the detached state, the base branch, and the restore command', () => {
    const note = checkoutMismatchNote('HEAD', 'master', '/repo');
    expect(note).toContain('detached HEAD');
    expect(note).toContain('master');
    expect(note).toContain('git -C /repo checkout master');
  });

  test('a different branch names that branch and the base branch', () => {
    const note = checkoutMismatchNote('feat/other', 'master', '/repo');
    expect(note).toContain('feat/other');
    expect(note).toContain('not master');
    expect(note).toContain('git -C /repo checkout master');
  });

  test('on the base branch there is nothing to say', () => {
    expect(checkoutMismatchNote('master\n', 'master', '/repo')).toBeNull();
  });

  test('an unknown ref (empty output) stays silent rather than guessing', () => {
    expect(checkoutMismatchNote('', 'master', '/repo')).toBeNull();
    expect(checkoutMismatchNote('   \n', 'master', '/repo')).toBeNull();
  });
});

// ===========================================================================================
// extractMergeSha
// ===========================================================================================

describe('extractMergeSha', () => {
  function verifyResult(mergedDetail: string, shipped = true): VerifyResult {
    return {
      shipped,
      points: [{ id: 'merged', passed: true, detail: mergedDetail }],
      failedPoints: [],
    };
  }
  test('extracts the sha from the merged point detail', () => {
    expect(extractMergeSha(verifyResult('PR #1 is merged (merge_commit_sha=abc1234)'))).toBe('abc1234');
  });
  test('null when no merged point is present', () => {
    expect(extractMergeSha({ shipped: false, points: [], failedPoints: [] })).toBeNull();
  });
});

// ===========================================================================================
// runLoop — full integration, mocked LoopIO throughout
// ===========================================================================================

async function* messages(list: SessionMessage[]): AsyncGenerator<SessionMessage> {
  for (const m of list) yield m;
}

function shippedMessages(pr: number, sha: string, sessionId: string): SessionMessage[] {
  return [
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'result', subtype: 'success', result: `All done.\nSHIPPED ${pr} ${sha}`, session_id: sessionId },
  ];
}

function needsDirectionMessages(sessionId: string): SessionMessage[] {
  return [
    { type: 'system', subtype: 'init', session_id: sessionId },
    {
      type: 'result',
      subtype: 'success',
      result: 'NEEDS_DIRECTION: which schema-lock path applies?',
      session_id: sessionId,
    },
  ];
}

/** A `result` message carrying neither a `SHIPPED` nor a `NEEDS_DIRECTION` terminal line —
 * `parseResultMessage` (session.ts) classifies this outcome `'error'`, exactly the "ended the
 * turn without reporting" shape the P1 fix-list's bounded auto-retry targets. */
function errorMessages(sessionId: string): SessionMessage[] {
  return [
    { type: 'system', subtype: 'init', session_id: sessionId },
    {
      type: 'result',
      subtype: 'success',
      result: 'armed a Monitor and ended the turn without a terminal line',
      session_id: sessionId,
    },
  ];
}

interface MockLoopIoOptions {
  stateJson: string;
  answers?: string;
  /** The campaign home the state/answers fixtures are keyed under — must match whatever
   * `homeDir` the config passed to `runLoop` carries (default: `baseLoopConfig`'s own default,
   * `/th`). Only tests that override `homeDir` on the config need to pass this too. */
  homeDir?: string;
  execHandlers?: Array<(cmd: string[]) => ExecResult | null>;
  spawnQueue?: Array<(params: SpawnSessionParams) => AsyncIterable<SessionMessage>>;
  lock?: LockInfo | null;
  processAlive?: boolean;
  stopFile?: boolean;
  escalationFiles?: Set<string>;
  /** When true, every card's spec/plan path is treated as MISSING on disk (drives the
   * PLANNING_NEEDED trigger) — off by default so unrelated tests aren't spuriously escalated. */
  missingSpecPlan?: boolean;
  /** Maps a PR number (as it appears in `gh pr view <pr> --json body`) to the card id whose
   * gap-gate stamp `checkGapGateStamped` should see in that PR's body — defaults to 'C1' when
   * a test never sets this. Only used by the shared `gh pr view ... body` handler installed at
   * the top of the exec mock below (verify.ts's D3 point 6, called on every ship path). */
  prToCard?: Record<string, string>;
}

interface MockLoopIoResult {
  io: LoopIO;
  calls: string[][];
  writtenFiles: Map<string, string>;
  spawnBriefs: string[];
  lockCalls: string[];
  ensuredDirs: string[];
  atomicWrites: Array<{ path: string; content: string }>;
  renameCalls: Array<{ from: string; to: string }>;
}

function buildMockLoopIo(opts: MockLoopIoOptions): MockLoopIoResult {
  const calls: string[][] = [];
  const homeDir = opts.homeDir ?? '/th';
  const writtenFiles = new Map<string, string>();
  writtenFiles.set(campaignStatePathOf(homeDir), opts.stateJson);
  if (opts.answers !== undefined) writtenFiles.set(answersPathOf(homeDir), opts.answers);
  const spawnBriefs: string[] = [];
  const lockCalls: string[] = [];
  const ensuredDirs: string[] = [];
  const atomicWrites: Array<{ path: string; content: string }> = [];
  const renameCalls: Array<{ from: string; to: string }> = [];
  let lock = opts.lock ?? null;
  const spawnQueue = [...(opts.spawnQueue ?? [])];
  const escalationFiles = new Set(opts.escalationFiles ?? []);

  const execHandlers = opts.execHandlers ?? [];

  const exec = mock(async (cmd: string[]): Promise<ExecResult> => {
    calls.push(cmd);
    if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view' && cmd.includes('body')) {
      // CU-4: checkGapGateStamped reads `gh pr view <pr> --json body` on every ship path and
      // asserts stamp.card === cardId. Resolve the verifying card from THIS mock's own persisted
      // campaign state (writeFile keeps writtenFiles current, and recordBranchFromPr persists
      // card.pr before verify), so a valid stamp is served for whatever card owns this PR —
      // C1, C2, B, C, any of them — with no per-test wiring.
      let stampCard = opts.prToCard?.[cmd[3] as string];
      if (stampCard === undefined) {
        try {
          const persisted = JSON.parse(writtenFiles.get(campaignStatePathOf(homeDir)) ?? '{}') as {
            cards?: Record<string, { pr?: number | null }>;
          };
          for (const [id, c] of Object.entries(persisted.cards ?? {})) {
            if (c?.pr != null && String(c.pr) === cmd[3]) {
              stampCard = id;
              break;
            }
          }
        } catch {
          /* fall through to the default */
        }
      }
      stampCard = stampCard ?? 'C1';
      return ok(
        JSON.stringify({
          body: `<!-- gap-gate v1 card=${stampCard} base=b0 head=h0 minted=none matched=none debt-delta=0 ledger=none -->`,
        }),
      );
    }
    for (const handler of execHandlers) {
      const result = handler(cmd);
      if (result) return result;
    }
    // Default fallbacks for common read-only/mutating calls not explicitly scripted.
    if (cmd[0] === 'git' && cmd[1] === 'symbolic-ref') return ok('origin/master\n');
    // C2: the main checkout's current ref — on the base branch unless a test scripts a
    // detached HEAD / other branch via `execHandlers`.
    if (cmd[0] === 'git' && cmd[1] === 'rev-parse' && cmd.includes('--abbrev-ref')) return ok('master\n');
    if (cmd[0] === 'git' && cmd[1] === 'rev-parse') return ok('basesha0\n');
    if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') return fail('no pull requests found');
    if (cmd[0] === 'git' && cmd[1] === 'worktree') return ok('');
    if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('');
    if (cmd[0] === 'git' && (cmd[1] === 'branch' || cmd[1] === 'push')) return ok('');
    throw new Error(`unscripted exec call: ${cmd.join(' ')}`);
  });

  const io: LoopIO = {
    exec,
    sleep: mock(async () => {}),
    fileExists: mock((p: string) => {
      if (p.includes('/escalations/')) {
        const cardMatch = /([^/]+)\.md$/.exec(p);
        return !!cardMatch && escalationFiles.has(cardMatch[1] as string);
      }
      if (p.endsWith('STOP')) return opts.stopFile ?? false;
      // Every card's fixture spec/plan path is treated as present on disk by default (so
      // `nextCard`'s PLANNING_NEEDED detection doesn't spuriously fire in tests that aren't
      // about that trigger) — tests targeting PLANNING_NEEDED explicitly opt out via
      // `opts.missingSpecPlan`.
      if (opts.missingSpecPlan) return false;
      return true;
    }),
    readFile: mock((p: string) => {
      if (p === BRIEF_TEMPLATE_PATH) return '# Executor brief for {{CARD_ID}}\n{{ANSWERS_CONTENT}}';
      const content = writtenFiles.get(p);
      if (content === undefined) throw new Error(`readFile: no fixture for ${p}`);
      return content;
    }),
    writeFile: mock((p: string, content: string) => {
      writtenFiles.set(p, content);
    }),
    // P6 (fix-list): records every rename (archive) so tests can assert `shipCard` archived
    // a leftover escalation file — and mutates `escalationFiles` so a subsequent `fileExists`
    // check on the ORIGINAL path reflects the file having moved away (the archived name never
    // matches the `/escalations/<cardId>.md` pattern `fileExists` above keys on, since it no
    // longer ends in `.md`).
    renameFile: mock((from: string, to: string) => {
      renameCalls.push({ from, to });
      const cardMatch = /([^/]+)\.md$/.exec(from);
      if (cardMatch) escalationFiles.delete(cardMatch[1] as string);
    }),
    readLock: mock(() => lock),
    writeLock: mock((info: LockInfo) => {
      lockCalls.push(`write:${info.pid}`);
      lock = info;
    }),
    removeLock: mock(() => {
      lockCalls.push('remove');
      lock = null;
    }),
    isProcessAlive: mock(() => opts.processAlive ?? false),
    currentPid: mock(() => 4242),
    now: mock(() => '2026-07-16T12:00:00Z'),
    spawnSession: mock((params: SpawnSessionParams) => {
      spawnBriefs.push(params.prompt);
      const next = spawnQueue.shift();
      if (!next) throw new Error('spawnSession called more times than scripted');
      return next(params);
    }),
    appendLog: mock(() => {}),
    ensureDir: mock((p: string) => {
      ensuredDirs.push(p);
    }),
    writeFileAtomic: mock((p: string, content: string) => {
      atomicWrites.push({ path: p, content });
    }),
  };

  return { io, calls, writtenFiles, spawnBriefs, lockCalls, ensuredDirs, atomicWrites, renameCalls };
}

function baseLoopConfig(overrides: Partial<RunLoopConfig> = {}): RunLoopConfig {
  return {
    repoRoot: '/repo',
    logsDir: '/logs',
    homeDir: '/th',
    runId: 'fixture-run',
    argv: [],
    model: 'fixture-model',
    includeEscalated: false,
    dryRun: false,
    remote: 'origin',
    ...overrides,
  };
}

function stateJsonWithTwoFreshCards(): string {
  return JSON.stringify(
    fixtureState({
      cards: {
        // A pre-assigned branch (Stage-A staging data) with no PR/worktree/remote trace yet
        // still derives to `fresh` — `card.branch === null` is reserved for the "genuinely no
        // trace at all" case; verify.ts's worktree/branch-gone check requires branch to be set.
        C1: fixtureCard({ branch: 'feat/c1-widget' }),
        C2: fixtureCard({ branch: 'feat/c2-widget', spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    }),
  );
}

// ===========================================================================================
// C1 (HARDENING-BACKLOG): a card whose own merge deletes its plan file must still finalise.
// T26's release commit removed docs/specs/ and docs/plans/; the runner merged the PR, then
// crashed with ENOENT re-reading docs/plans/T26.plan.md for the D3 point-6 schema guard,
// leaving the card `running` although the work had merged. Pre-flight (nextCard) still sees
// the plan; only the post-merge verify read finds it gone.
// ===========================================================================================

describe('runLoop — C1: a card whose merge removed its own plan path finalises cleanly', () => {
  test('is recorded shipped, not crashed, when the plan is gone at verify time', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      schemaLockPaths: ['packages/app/src/domain/'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget' }) },
    });
    let merged = false;
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'api') {
            merged = true;
            return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          }
          if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok('deadbee parent1 parent2');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/926\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [() => messages(shippedMessages(926, 'aaaaaaa', 'sess-c1'))],
    });
    // The plan exists at pre-flight and vanishes with the merge — exactly T26's shape. The
    // mock's default `readFile` already throws for any un-fixtured path, so a post-merge read
    // of the plan is the ENOENT the real fs would raise.
    const planPath = '/repo/docs/plans/c1.md';
    const baseFileExists = io.fileExists;
    io.fileExists = ((p: string) => (merged && p === planPath ? false : baseFileExists(p))) as LoopIO['fileExists'];

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed[0]).toMatchObject({ kind: 'shipped', cardId: 'C1' });
    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.status).toBe('shipped');
    expect(finalState.cards.C1.mergeSha).toBe('deadbee');
  });
});

// ===========================================================================================
// C2 (HARDENING-BACKLOG): a stray detached HEAD in the main checkout must be NAMED in the
// planning_needed escalation (and the --dry-run plan), not reported as a bare "missing
// spec, plan".
// ===========================================================================================

describe('runLoop — C2: planning_needed names a detached / off-base checkout', () => {
  const detachedHandler = (cmd: string[]) => {
    if (cmd[0] === 'git' && cmd[1] === 'rev-parse' && cmd.includes('--abbrev-ref')) return ok('HEAD\n');
    return null;
  };

  test('the escalation file says the checkout is detached and how to restore it', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      missingSpecPlan: true,
      execHandlers: [detachedHandler],
      spawnQueue: [],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1', reason: 'planning_needed' });
    const escalationContent = writtenFiles.get('/th/escalations/C1.md') as string;
    expect(escalationContent).toContain('Missing on disk: spec, plan');
    expect(escalationContent).toContain('detached HEAD');
    expect(escalationContent).toContain('git -C /repo checkout master');
  });

  test('on the base branch the escalation carries no checkout note', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      missingSpecPlan: true,
      spawnQueue: [],
    });

    await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    const escalationContent = writtenFiles.get('/th/escalations/C1.md') as string;
    expect(escalationContent).toContain('Missing on disk: spec, plan');
    expect(escalationContent).not.toContain('detached HEAD');
    expect(escalationContent).not.toContain('checkout master');
  });

  test('--dry-run surfaces the same note in planningNeeded, still writing nothing', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, atomicWrites, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      missingSpecPlan: true,
      execHandlers: [detachedHandler],
      spawnQueue: [],
    });

    const result = await runLoop(baseLoopConfig({ dryRun: true }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.dryRunPlan?.planningNeeded).toMatchObject({ cardId: 'C1', missing: ['spec', 'plan'] });
    expect(result.dryRunPlan?.planningNeeded?.note).toContain('detached HEAD');
    expect(atomicWrites).toHaveLength(0);
    expect(writtenFiles.has('/th/escalations/C1.md')).toBe(false);
  });
});

describe('runLoop — full happy path over two cards', () => {
  test('two fresh cards both ship: verify passes, state committed, exit 0', async () => {
    const { io, calls, writtenFiles, spawnBriefs } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      prToCard: { '1': 'C1', '2': 'C2' },
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok('deadbee parent1 parent2');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/900\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [
        () => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1')),
        () => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2')),
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 2 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]).toMatchObject({ kind: 'shipped', cardId: 'C1' });
    expect(result.processed[1]).toMatchObject({ kind: 'shipped', cardId: 'C2' });
    expect(spawnBriefs).toHaveLength(2);

    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.status).toBe('shipped');
    expect(finalState.cards.C2.status).toBe('shipped');
    expect(finalState.cards.C1.mergeSha).toBe('deadbee');

    // Lock acquired then released.
    expect(calls.some(() => true)).toBe(true);
  });
});

describe('runLoop — records branch + baseSha (handoff Fix 5)', () => {
  // Regression guard for a REAL campaign failure (least-effort-5, 2026-07-24): card C1's work
  // merged cleanly as PR #144, but `branch`/`baseSha` were never written to state.json, so
  // verifyShipped could not run its worktreeAndBranchGone or schemaGuard checks and escalated
  // `verify_failed_twice` on an already-shipped card. A false escalation costs a whole card's
  // session AND one of the two auto-answer rounds the campaign is allowed.
  test('a shipped card records the branch (from its PR) and the baseSha it was cut from', async () => {
    // branch: null is what the runner README prescribes at Stage-A authoring time ("null at
    // authoring time — this is exactly what makes the D4 resume matrix classify a freshly-
    // authored card `fresh`"), and it is what campaign least-effort-5's real state.json had.
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } })),
      answers: '# answers\n(none yet)\n',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'git' && cmd[1] === 'rev-parse') return ok('base15ha\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') return ok(JSON.stringify({ headRefName: 'feature/RecordedBranch' }));
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok('deadbee parent1 parent2');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'worktree') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('');
          if (cmd[0] === 'git') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr') return ok('https://example.invalid/o/r/pull/900\n');
          return null;
        },
      ],
      spawnQueue: [() => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1'))],
    });

    await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.baseSha).toBe('base15ha');
    expect(finalState.cards.C1.branch).toBe('feature/RecordedBranch');
  });
});

describe('runLoop — recordBaseSha rev-parses the resolved <remote>/<baseBranch>', () => {
  test('rev-parse targets "upstream/main", not "origin/main"', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '# answers\n(none yet)\n',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'git' && cmd[1] === 'symbolic-ref') return ok('upstream/main\n');
          if (cmd[0] === 'git' && cmd[1] === 'rev-parse') return ok('base15ha\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') return ok(JSON.stringify({ headRefName: 'feature/RecordedBranch' }));
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok('deadbee parent1 parent2');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'worktree') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('');
          if (cmd[0] === 'git') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr') return ok('https://example.invalid/o/r/pull/900\n');
          return null;
        },
      ],
      spawnQueue: [() => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1'))],
    });

    await runLoop(baseLoopConfig({ maxCards: 1, remote: 'upstream' }), io);

    const revParseCall = calls.find((c) => c[0] === 'git' && c[1] === 'rev-parse');
    expect(revParseCall).toEqual(['git', 'rev-parse', 'upstream/main']);
  });
});

// P11 fix-list: `recordBaseSha` now learns the phase — a BLIND-FRESH spawn (no prior world at
// all: no session, no PR, no digest) re-stamps any pre-existing `baseSha`, because a card with
// no world can only be carrying a stale/hand-authored one (ruling R3: a stale base is worse
// than no base — see the incident this fix-list item closes). Resume/fresh-with-digest phases
// keep the existing base unchanged: the card genuinely started from it. Exercised by calling
// `recordBaseSha` directly (same `CardCtx` shape `runPass` builds, the same pattern
// `healSafeResidue`'s tests above already use) rather than through the full `runLoop`, so this
// stays isolated from `state.ts`'s OWN separate load-time normalization of the impossible
// `staged`+`sessionId: null`+`baseSha` combo (tested independently in `state.test.ts`) — a
// fresh-with-digest card is, by definition, `sessionId: null` too, so routing it through
// `loadState` first would strip its `baseSha` before `recordBaseSha` ever saw it, conflating
// the two layers this fix-list item deliberately keeps separate.
describe('recordBaseSha — learns the phase (P11, ruling R3)', () => {
  function ctxFor(card: Card, execHandlers: Array<(cmd: string[]) => ExecResult | null> = []): {
    ctx: CardCtx;
    calls: string[][];
  } {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: card } });
    const { io, calls } = buildMockLoopIo({ stateJson: JSON.stringify(state), execHandlers });
    const resolved: ResolvedConfig = {
      ...baseLoopConfig(),
      baseBranch: 'master',
      answersContent: '',
      briefTemplate: '',
    };
    return { ctx: { cardId: 'C1', state, resolved, io }, calls };
  }

  test('blind fresh (phase.kind "fresh", no digest) + a stale pre-existing baseSha -> overwritten with the current rev-parse result', async () => {
    const card = fixtureCard({ branch: null, sessionId: null, baseSha: 'stale-hand-reset-sha' });
    const { ctx, calls } = ctxFor(card, [
      (cmd) => (cmd[0] === 'git' && cmd[1] === 'rev-parse' ? ok('freshbase01\n') : null),
    ]);

    await recordBaseSha(ctx, { kind: 'fresh' });

    expect(ctx.state.cards.C1?.baseSha).toBe('freshbase01');
    expect(calls).toContainEqual(['git', 'rev-parse', 'origin/master']);
  });

  test('fresh-with-digest (F8: open PR, no sessionId recorded) + an existing baseSha -> kept, not overwritten (no rev-parse call at all)', async () => {
    const card = fixtureCard({ sessionId: null, baseSha: 'existing-base-abc' });
    const { ctx, calls } = ctxFor(card);

    await recordBaseSha(ctx, { kind: 'fresh', digest: '## Crash-recovery digest for C1\n...' });

    expect(ctx.state.cards.C1?.baseSha).toBe('existing-base-abc');
    expect(calls.find((c) => c[0] === 'git' && c[1] === 'rev-parse')).toBeUndefined();
  });

  test('resume phase (PR open, sessionId recorded) + an existing baseSha -> kept, not overwritten (no rev-parse call at all)', async () => {
    const card = fixtureCard({ sessionId: 'sess-old', baseSha: 'existing-base-xyz' });
    const { ctx, calls } = ctxFor(card);

    await recordBaseSha(ctx, { kind: 'resume', sessionId: 'sess-old', reason: 'pr_open', pr: 7 });

    expect(ctx.state.cards.C1?.baseSha).toBe('existing-base-xyz');
    expect(calls.find((c) => c[0] === 'git' && c[1] === 'rev-parse')).toBeUndefined();
  });
});

describe('runLoop — REVERT_AND_REDO ls-removes/deletes the resolved remote', () => {
  test('both the phase-derivation ls-remote AND the delete-push target config.remote, not "origin"', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', sessionId: null }) },
    });
    const { io, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('abc123\trefs/heads/feat/c1-widget\n');
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/911\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [() => messages(needsDirectionMessages('sess-revert'))],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1, remote: 'upstream' }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    const lsRemoteCalls = calls.filter((c) => c[1] === 'ls-remote');
    expect(lsRemoteCalls.length).toBeGreaterThan(0);
    for (const c of lsRemoteCalls) {
      expect(c).toEqual(['git', 'ls-remote', '--heads', 'upstream', 'feat/c1-widget']);
    }
    const pushDeleteCall = calls.find((c) => c[0] === 'git' && c[1] === 'push' && c.includes('--delete'));
    expect(pushDeleteCall).toEqual(['git', 'push', 'upstream', '--delete', 'feat/c1-widget']);
  });
});

describe('runLoop — crash-resume: verify_only phase (PR merged, not yet shipped)', () => {
  test('no session is spawned; verify runs and records shipped', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', pr: null }) },
    });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') return ok(JSON.stringify({ number: 55, state: 'MERGED' }));
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'cafefee' }));
          if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok('cafefee p1 p2');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/901\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed).toEqual([
      { kind: 'shipped', cardId: 'C1' },
    ]);
    expect(io.spawnSession).not.toHaveBeenCalled();
    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.status).toBe('shipped');
  });
});

describe('runLoop — resume-probe failure -> fresh-with-digest', () => {
  test('resume attempt errors, falls back to a fresh session carrying a digest', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', sessionId: 'sess-old' }) },
    });
    const { io, spawnBriefs } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: 'ANSWERS-CONTENT',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') return ok(JSON.stringify({ number: 8, state: 'OPEN' }));
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'f00dfee' }));
          if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok('f00dfee p1 p2');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/902\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [
        () => {
          throw new Error('no transcript found for session sess-old');
        },
        () => messages(shippedMessages(3, 'aaaaaaa', 'sess-new')),
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(spawnBriefs).toHaveLength(2);
    // First attempt is the resume continuation prompt (short); second is a FULL fresh brief
    // carrying the crash-recovery digest (never the raw continuation prompt).
    expect(spawnBriefs[1]).toContain('Crash-recovery digest for C1');
    expect(result.processed).toEqual([
      { kind: 'shipped', cardId: 'C1' },
    ]);
  });
});

describe('runLoop — F8: open PR with no sessionId spawns fresh WITH a digest, never blind', () => {
  test('a single session is spawned, briefed with the open PR number — no duplicate PR is possible', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', sessionId: null }) },
    });
    const { io, spawnBriefs } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: 'ANSWERS-CONTENT',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') return ok(JSON.stringify({ number: 9, state: 'OPEN' }));
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'ab00001' }));
          if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok('ab00001 p1 p2');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/906\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [() => messages(shippedMessages(9, 'ab00001', 'sess-new-c1'))],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    // Exactly ONE session is spawned for this card — the fix must not itself introduce a
    // resume attempt; it is the fresh session's own brief that must carry the digest.
    expect(spawnBriefs).toHaveLength(1);
    expect(spawnBriefs[0]).toContain('Crash-recovery digest for C1');
    // The executor is NOT spawned blind: the brief names the open PR's number, so it inspects
    // and continues PR #9 instead of rebuilding the card and opening a second one (F8).
    expect(spawnBriefs[0]).toContain('9');
    expect(result.processed).toEqual([
      { kind: 'shipped', cardId: 'C1' },
    ]);
  });
});

describe('runLoop — STOP file', () => {
  test('STOP present at startup: exits cleanly, no card processed, no session spawned', async () => {
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '',
      stopFile: true,
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 2 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed).toEqual([]);
    expect(io.spawnSession).not.toHaveBeenCalled();
  });
});

describe('runLoop — run record write (Task 2, spec §4/§5.2)', () => {
  test('run record is written after lock acquisition, into <home>/runs/<runId>/run.json', async () => {
    const { io, ensuredDirs, atomicWrites } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '',
      stopFile: true,
    });

    await runLoop(baseLoopConfig({ homeDir: '/th/campaigns/camp', runId: 'r-1' }), io);

    expect(ensuredDirs).toContain('/th/campaigns/camp/runs/r-1');
    expect(ensuredDirs).toContain('/th/campaigns/camp/reports');
    const write = atomicWrites.find((w) => w.path === '/th/campaigns/camp/runs/r-1/run.json');
    expect(write).toBeDefined();
    const record = JSON.parse(write!.content);
    expect(record.runId).toBe('r-1');
    expect(record.endedAt).toBeNull();
  });

  test('EXIT_LOCKED writes no run record (refused start creates no artifacts)', async () => {
    const { io, atomicWrites } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '',
      lock: { pid: 111, startedAt: '2026-07-15T00:00:00Z' },
      processAlive: true,
    });

    const result = await runLoop(baseLoopConfig({ homeDir: '/th/campaigns/camp', runId: 'r-1' }), io);

    expect(result.exitCode).toBe(EXIT_LOCKED);
    expect(atomicWrites).toHaveLength(0);
  });

  test('--dry-run writes no run record and creates no directories', async () => {
    const { io, ensuredDirs, atomicWrites } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '',
      homeDir: '/th/campaigns/camp',
    });

    await runLoop(baseLoopConfig({ dryRun: true, homeDir: '/th/campaigns/camp', runId: 'r-1' }), io);

    expect(atomicWrites).toHaveLength(0);
    expect(ensuredDirs).toHaveLength(0);
  });

  test('a run-record write failure does not kill the pass', async () => {
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '',
      stopFile: true,
    });
    io.writeFileAtomic = (() => {
      throw new Error('disk full');
    }) as LoopIO['writeFileAtomic'];

    const result = await runLoop(baseLoopConfig({ homeDir: '/th', runId: 'r-1' }), io);

    expect(result.exitCode).toBe(EXIT_OK); // the run still completes normally
  });
});

describe('runLoop — lock contention', () => {
  test('a live lock holder refuses the new start; no card is processed', async () => {
    const { io, lockCalls } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '',
      lock: { pid: 111, startedAt: '2026-07-15T00:00:00Z' },
      processAlive: true,
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 2 }), io);

    expect(result.exitCode).toBe(EXIT_LOCKED);
    expect(result.processed).toEqual([]);
    expect(io.spawnSession).not.toHaveBeenCalled();
    // The live lock is never overwritten.
    expect(lockCalls).toEqual([]);
  });
});

describe('runLoop — escalation flow', () => {
  test('NEEDS_DIRECTION -> escalation file written, card marked escalated, exit 2', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/903\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [() => messages(needsDirectionMessages('sess-nd'))],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1' });
    const escalationContent = writtenFiles.get('/th/escalations/C1.md');
    expect(escalationContent).toBeDefined();
    expect(escalationContent).toContain('NEEDS_DIRECTION');
    // Task 3 Step 6: the "Options" line must point the human at the REAL answers.md location
    // under --home, not the deleted repo-relative --answers path (live evidence, kanna
    // campaign: it used to print "docs/tribe/planning/kanna-session-import/answers.md", a path
    // that no longer exists once state moves out of the repo).
    expect(escalationContent).toContain('Append a ruling to `/th/answers.md`');
    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.status).toBe('escalated');
  });

  test('PLANNING_NEEDED: next card is missing its spec/plan on disk -> escalated, exit 2, no session spawned', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      missingSpecPlan: true,
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/905\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1', reason: 'planning_needed' });
    expect(io.spawnSession).not.toHaveBeenCalled();
    const escalationContent = writtenFiles.get('/th/escalations/C1.md');
    expect(escalationContent).toContain('spec');
    expect(escalationContent).toContain('plan');
    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.status).toBe('escalated');
  });

});

describe('runLoop — double verify-fail -> escalation', () => {
  test('verifyShipped fails twice for the same card -> escalated, exit 2', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget' }) },
    });
    let apiCalls = 0;
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view') return ok(JSON.stringify({ number: 12, state: 'MERGED' }));
          if (cmd[0] === 'gh' && cmd[1] === 'api') {
            apiCalls += 1;
            return ok(JSON.stringify({ merged: false }));
          }
          if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/904\n');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
          return null;
        },
      ],
      spawnQueue: [],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1', reason: 'verify_failed_twice' });
    // verifyShipped's `merged` check (gh api) was attempted exactly twice — the D5 "fails
    // twice" trigger, never escalating on a single (possibly transient) failure.
    expect(apiCalls).toBe(2);
  });
});

// ===========================================================================================
// P4 fix-list item: verify self-heals safe residue instead of escalating
// (docs/tribe/fixlists/2026-08-08-outstanding-17/P4-self-heal-safe-residue.md)
// ===========================================================================================

describe('runLoop — self-heals safe residue between the first failed verify and the retry (P4)', () => {
  test('merged PR + only remote-branch residue -> deletes the branch, ships, no escalation', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', pr: null }) },
    });
    let branchDeleted = false;
    const { io, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view' && cmd[3] === 'feat/c1-widget') {
            return ok(JSON.stringify({ number: 12, state: 'MERGED' }));
          }
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') {
            return branchDeleted ? ok('') : ok('abc123\trefs/heads/feat/c1-widget\n');
          }
          if (cmd[0] === 'git' && cmd[1] === 'push' && cmd[2] === 'origin' && cmd[3] === '--delete') {
            branchDeleted = true;
            return ok('');
          }
          return null;
        },
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    // The heal exec fired.
    expect(calls).toContainEqual(['git', 'push', 'origin', '--delete', 'feat/c1-widget']);
    // The card shipped, not escalated.
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed[0]).toEqual({ kind: 'shipped', cardId: 'C1' });
  });

  test('dirty worktree residue -> no heal exec, escalates as today', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', pr: null }) },
    });
    const worktreePorcelain = [
      'worktree /repo/.worktrees/c1',
      'HEAD abcdef0123456789abcdef0123456789abcdef01',
      'branch refs/heads/feat/c1-widget',
    ].join('\n');
    const { io, calls, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view' && cmd[3] === 'feat/c1-widget') {
            return ok(JSON.stringify({ number: 12, state: 'MERGED' }));
          }
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list') return ok(worktreePorcelain);
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('');
          // The worktree is DIRTY — `git status --porcelain` reports a pending change.
          if (cmd[0] === 'git' && cmd[1] === 'status') return ok(' M some-file.txt\n');
          return null;
        },
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    // No heal exec fired — neither recipe was invoked.
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'push' && c[2] === 'origin' && c[3] === '--delete')).toBe(
      false,
    );
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'worktree' && c[2] === 'remove')).toBe(false);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'branch' && c[2] === '-D')).toBe(false);
    // Escalates exactly as before P4.
    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1', reason: 'verify_failed_twice' });
    const escalationOutcome = result.processed[0] as { escalationPath: string };
    const escalationMarkdown = writtenFiles.get(escalationOutcome.escalationPath) ?? '';
    expect(escalationMarkdown).not.toContain('healed:');
    expect(escalationMarkdown).toContain('worktree still present');
  });

  test('healSafeResidue: merged + remote-branch residue -> retry result detail records "healed: delete_remote_branch"', async () => {
    const card = fixtureCard({ branch: 'feat/c1-widget', pr: 12 });
    const state = fixtureState({ sequence: ['C1'], cards: { C1: card } });
    let branchDeleted = false;
    const { io, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') {
            return branchDeleted ? ok('') : ok('abc123\trefs/heads/feat/c1-widget\n');
          }
          if (cmd[0] === 'git' && cmd[1] === 'push' && cmd[2] === 'origin' && cmd[3] === '--delete') {
            branchDeleted = true;
            return ok('');
          }
          return null;
        },
      ],
    });

    const resolved: ResolvedConfig = {
      ...baseLoopConfig(),
      baseBranch: 'master',
      answersContent: '',
      briefTemplate: '',
    };
    const verifyConfig: VerifyConfig = {
      repoRoot: resolved.repoRoot,
      remote: resolved.remote,
      baseBranch: resolved.baseBranch,
      schemaLockPaths: [],
      docsOnlyPaths: ['docs/'],
    };
    const ctx: CardCtx = { cardId: 'C1', state, resolved, io };

    const first = await verifyShipped(card, verifyConfig, io, 'C1');
    expect(first.shipped).toBe(false);

    const healed = await healSafeResidue(ctx, first, verifyConfig);

    expect(healed.shipped).toBe(true);
    expect(calls).toContainEqual(['git', 'push', 'origin', '--delete', 'feat/c1-widget']);
    const worktreePoint = healed.points.find((p) => p.id === 'worktreeAndBranchGone');
    expect(worktreePoint?.detail).toContain('healed:');
    expect(worktreePoint?.detail).toContain('delete_remote_branch');
  });

  // P4 audit fix-round (blocker, skinnerA): the acceptance criterion is literally "report notes
  // the heal" — proved here at the report.ts level (the ONLY artifact a human/orchestrating
  // session reads), not just at healSafeResidue's in-memory VerifyResult.
  test('report notes the heal: buildCampaignReport surfaces healed residue for the primary ship-without-escalation scenario', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', pr: null }) },
    });
    let branchDeleted = false;
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view' && cmd[3] === 'feat/c1-widget') {
            return ok(JSON.stringify({ number: 12, state: 'MERGED' }));
          }
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') {
            return branchDeleted ? ok('') : ok('abc123\trefs/heads/feat/c1-widget\n');
          }
          if (cmd[0] === 'git' && cmd[1] === 'push' && cmd[2] === 'origin' && cmd[3] === '--delete') {
            branchDeleted = true;
            return ok('');
          }
          return null;
        },
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);
    expect(result.exitCode).toBe(EXIT_OK);

    const finalState = JSON.parse(writtenFiles.get(campaignStatePathOf('/th')) as string) as CampaignState;
    const report = await buildCampaignReport(
      finalState,
      { startedAt: 't0', endedAt: 't1', exitCode: EXIT_OK, reason: 'done' },
      { homeDir: '/th' },
      { fileExists: () => false, readFile: async () => '' },
    );

    const shippedEntry = report.cards.C1 as { outcome: string; healedResidue?: string[] };
    expect(shippedEntry.outcome).toBe('shipped');
    // Spec (P4-self-heal-safe-residue.md): "...verify passes on retry, NO escalation, report
    // notes the heal." Before this fix, `shipCard` discarded the VerifyResult entirely and
    // `CardOutcome`/`Card`/`CardReportEntry` had no field to carry it — this assertion is the
    // exact gap made observable at the ONLY artifact an orchestrating session reads.
    expect(shippedEntry.healedResidue).toEqual(['delete_remote_branch']);
    expect(renderReportMarkdown(report)).toContain('Healed residue: delete_remote_branch');
  });

  // P4 audit fix-round (should-fix, skinnerB): a heal action whose exec actually FAILS must
  // never be labeled "(healed: ...)" — that would contradict the spec's intent that the report
  // show what was ACTUALLY healed "instead of silently passing".
  test('heal exec fails -> retry detail does NOT claim it was healed', async () => {
    const card = fixtureCard({ branch: 'feat/c1-widget', pr: 12 });
    const state = fixtureState({ sequence: ['C1'], cards: { C1: card } });
    const { io, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list') return ok('');
          // Remote branch is (and stays) present — the delete never actually lands.
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('abc123\trefs/heads/feat/c1-widget\n');
          if (cmd[0] === 'git' && cmd[1] === 'push' && cmd[2] === 'origin' && cmd[3] === '--delete') {
            return fail('network blip: could not delete ref');
          }
          return null;
        },
      ],
    });

    const resolved: ResolvedConfig = {
      ...baseLoopConfig(),
      baseBranch: 'master',
      answersContent: '',
      briefTemplate: '',
    };
    const verifyConfig: VerifyConfig = {
      repoRoot: resolved.repoRoot,
      remote: resolved.remote,
      baseBranch: resolved.baseBranch,
      schemaLockPaths: [],
      docsOnlyPaths: ['docs/'],
    };
    const ctx: CardCtx = { cardId: 'C1', state, resolved, io };

    const first = await verifyShipped(card, verifyConfig, io, 'C1');
    expect(first.shipped).toBe(false);

    const healed = await healSafeResidue(ctx, first, verifyConfig);

    // The exec was attempted...
    expect(calls).toContainEqual(['git', 'push', 'origin', '--delete', 'feat/c1-widget']);
    // ...but since it failed and the branch is still there on retry, the result must still
    // show NOT shipped, and its detail must NOT self-contradictorily claim a heal happened.
    expect(healed.shipped).toBe(false);
    const worktreePoint = healed.points.find((p) => p.id === 'worktreeAndBranchGone');
    expect(worktreePoint?.detail).not.toContain('healed:');
  });

  // P4 audit fix-round (blocker, scout): `git branch -D` must never run when the preceding
  // `git worktree remove` (no --force) was refused — otherwise the local branch ref gets
  // force-deleted while the (still dirty/refused) worktree directory is orphaned with nothing
  // pointing at it.
  test('worktree remove refused -> branch -D is never called', async () => {
    const card = fixtureCard({ branch: 'feat/c1-widget', pr: 12 });
    const state = fixtureState({ sequence: ['C1'], cards: { C1: card } });
    const worktreePorcelain = [
      'worktree /repo/.worktrees/c1',
      'HEAD abcdef0123456789abcdef0123456789abcdef01',
      'branch refs/heads/feat/c1-widget',
    ].join('\n');
    const { io, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list') return ok(worktreePorcelain);
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('');
          // Clean + ancestor, so decideResidueHeal DOES propose remove_worktree...
          if (cmd[0] === 'git' && cmd[1] === 'status') return ok('');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          // ...but the actual removal is refused (e.g. a stray write raced the probe).
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'remove') {
            return fail('fatal: working tree is dirty, use --force');
          }
          return null;
        },
      ],
    });

    const resolved: ResolvedConfig = {
      ...baseLoopConfig(),
      baseBranch: 'master',
      answersContent: '',
      briefTemplate: '',
    };
    const verifyConfig: VerifyConfig = {
      repoRoot: resolved.repoRoot,
      remote: resolved.remote,
      baseBranch: resolved.baseBranch,
      schemaLockPaths: [],
      docsOnlyPaths: ['docs/'],
    };
    const ctx: CardCtx = { cardId: 'C1', state, resolved, io };

    const first = await verifyShipped(card, verifyConfig, io, 'C1');
    expect(first.shipped).toBe(false);
    const worktreeFirstPoint = first.points.find((p) => p.id === 'worktreeAndBranchGone');
    expect(worktreeFirstPoint?.detail).toContain('worktree still present');

    await healSafeResidue(ctx, first, verifyConfig);

    expect(calls).toContainEqual(['git', 'worktree', 'remove', '/repo/.worktrees/c1']);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'branch' && c[2] === '-D')).toBe(false);
  });

  // P4 audit fix-round (blocker, scout): `worktreeStatusClean` must be derived from `git status
  // --porcelain`'s EXIT CODE, not stdout content alone — a failed/errored status call (locked
  // index, transient error) presents as empty stdout and must NOT be treated as "clean".
  test('git status --porcelain fails (non-zero exit, empty stdout) -> treated as dirty, no heal', async () => {
    const card = fixtureCard({ branch: 'feat/c1-widget', pr: 12 });
    const state = fixtureState({ sequence: ['C1'], cards: { C1: card } });
    const worktreePorcelain = [
      'worktree /repo/.worktrees/c1',
      'HEAD abcdef0123456789abcdef0123456789abcdef01',
      'branch refs/heads/feat/c1-widget',
    ].join('\n');
    const { io, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        (cmd) => {
          if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: 'deadbee' }));
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
          if (cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list') return ok(worktreePorcelain);
          if (cmd[0] === 'git' && cmd[1] === 'ls-remote') return ok('');
          // `git status --porcelain` FAILS (locked index) — stdout is empty, exitCode is 1.
          if (cmd[0] === 'git' && cmd[1] === 'status') return fail('fatal: Unable to read current working directory');
          if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
          return null;
        },
      ],
    });

    const resolved: ResolvedConfig = {
      ...baseLoopConfig(),
      baseBranch: 'master',
      answersContent: '',
      briefTemplate: '',
    };
    const verifyConfig: VerifyConfig = {
      repoRoot: resolved.repoRoot,
      remote: resolved.remote,
      baseBranch: resolved.baseBranch,
      schemaLockPaths: [],
      docsOnlyPaths: ['docs/'],
    };
    const ctx: CardCtx = { cardId: 'C1', state, resolved, io };

    const first = await verifyShipped(card, verifyConfig, io, 'C1');
    expect(first.shipped).toBe(false);

    await healSafeResidue(ctx, first, verifyConfig);

    // A failed `git status --porcelain` must never be read as "clean" -> no removal attempted.
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'worktree' && c[2] === 'remove')).toBe(false);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'branch' && c[2] === '-D')).toBe(false);
  });
});

// ===========================================================================================
// P6 (fix-list): shipCard archives a leftover escalation file on ship — "answered/shipped
// escalations stop haunting re-triggers".
// ===========================================================================================

describe('shipCard — archives a leftover escalation file on ship (P6)', () => {
  test('card ships while an escalation file exists -> renameFile is called with the escalation ' +
    'path and its `.resolved-shipped` twin', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget' }) },
    });
    const { io, renameCalls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      escalationFiles: new Set(['C1']),
    });
    const resolved: ResolvedConfig = { ...baseLoopConfig(), baseBranch: 'master', answersContent: '', briefTemplate: '' };
    const ctx: CardCtx = { cardId: 'C1', state, resolved, io };
    const escalationPath = escalationPathOf('/th', 'C1');

    const outcome = await shipCard(ctx, { shipped: true, points: [], failedPoints: [] });

    expect(outcome).toEqual({ kind: 'shipped', cardId: 'C1' });
    expect(renameCalls).toEqual([{ from: escalationPath, to: `${escalationPath}.resolved-shipped` }]);
  });

  test('card ships with no escalation file -> renameFile is never called', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget' }) },
    });
    const { io, renameCalls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      // No escalation file for C1 this time.
    });
    const resolved: ResolvedConfig = { ...baseLoopConfig(), baseBranch: 'master', answersContent: '', briefTemplate: '' };
    const ctx: CardCtx = { cardId: 'C1', state, resolved, io };

    await shipCard(ctx, { shipped: true, points: [], failedPoints: [] });

    expect(renameCalls).toEqual([]);
  });

  test('escalated/stopped outcomes never rename anything — only shipCard archives', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget' }) },
    });
    const { io, renameCalls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      escalationFiles: new Set(['C1']),
    });
    const resolved: ResolvedConfig = { ...baseLoopConfig(), baseBranch: 'master', answersContent: '', briefTemplate: '' };
    const ctx: CardCtx = { cardId: 'C1', state, resolved, io };

    // `escalateCard` runs the OTHER outcome branch — it must never touch `renameFile`
    // (archiving is exclusively a ship-time action; an escalation WRITES the file, it never
    // removes/renames one).
    const outcome = await escalateCard(ctx, 'needs_direction', 'some detail');

    expect(outcome.kind).toBe('escalated');
    expect(renameCalls).toEqual([]);
  });

  test('B14 regression (ship-time archiving): an escalated card with an unresolved escalation ' +
    'file ships under --include-escalated, and shipCard archives the file as part of that run', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      // A pre-assigned branch (not `branch: null`) so a plain fresh ship needs no `gh pr view`
      // branch-discovery round trip — the same "pre-assigned branch, no PR/worktree trace yet"
      // convention several other park-and-continue fixtures above already use.
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', status: 'escalated' }) },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      escalationFiles: new Set(['C1']),
      execHandlers: cleanCommitAndVerifyHandlers('deadb14e'),
      spawnQueue: [() => messages(shippedMessages(14, 'deadb14e', 'sess-b14'))],
    });
    const escalationPath = escalationPathOf('/th', 'C1');

    const firstRun = await runLoop(baseLoopConfig({ includeEscalated: true }), io);
    expect(firstRun.processed).toEqual([{ kind: 'shipped', cardId: 'C1' }]);
    // `shipCard` must have archived the leftover escalation file as part of this very run —
    // directly, mechanically verified (this is the ONE assertion the P6 audit round confirmed
    // is non-hollow: it fails if the rename call is ever removed from `shipCard`).
    expect(io.fileExists(escalationPath)).toBe(false);

    // P6 audit fix-round (should-fix, skinnerA + scout): a flag-less second run on this now-
    // `shipped` card reaching `done` proves NOTHING about the archiving above — `nextCard`
    // already excludes any `status === 'shipped'` card unconditionally (`core/state.ts`), with
    // or without the escalation file being archived. That is deliberately NOT asserted here
    // anymore (a prior version of this test claimed the second run "reaches done ... because
    // the file was archived", which was never true — see the SKILL-side regression test below
    // for the actual, previously-unproven claim P6's Decision #2 makes: a flag-less re-trigger
    // proceeding BECAUSE the file was archived, for a card that never shipped).
  });

  test('B14 regression (skill-side ritual): a card STAYS `escalated` (never ships) — the ' +
    'human ruling ritual archives the escalation file directly (the SKILL.md `mv` step, ' +
    'independent of shipCard) — and a SECOND, flag-less run proceeds to attempt the card ' +
    'instead of silently skipping it, exactly what P6 Decision #2 promises', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget', status: 'escalated' }) },
    });
    const { io, renameCalls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      escalationFiles: new Set(['C1']),
      execHandlers: cleanCommitAndVerifyHandlers('deadb14e'),
      spawnQueue: [() => messages(shippedMessages(14, 'deadb14e', 'sess-b14'))],
    });
    const escalationPath = escalationPathOf('/th', 'C1');

    // A flag-less run while the escalation is still UNANSWERED silently skips C1 — it is the
    // ONLY card in `sequence`, `card.status === 'escalated'`, and `--include-escalated` is
    // absent, so `nextCard` excludes it before `deriveCardPhase` (or any session) ever runs.
    // This IS the original B14 incident's own shape: the run reports `done`/`EXIT_OK` with
    // nothing processed, not a visible escalation — "a wasted cycle", not a loud failure.
    const parkedRun = await runLoop(baseLoopConfig({ includeEscalated: false }), io);
    expect(parkedRun.processed).toEqual([]);
    expect(parkedRun.exitCode).toBe(EXIT_OK);
    expect(io.spawnSession).not.toHaveBeenCalled();

    // The Shaman rules on it: the SKILL.md ritual appends the ruling to answers.md and
    // archives the escalation file — `io.renameFile` directly, WITHOUT ever going through
    // `shipCard` (the card never shipped; only the file moved). `card.status` stays exactly
    // `'escalated'` — nothing in the skill flow ever touches it.
    io.renameFile(escalationPath, `${escalationPath}.resolved-R1`);
    expect(renameCalls).toEqual([{ from: escalationPath, to: `${escalationPath}.resolved-R1` }]);

    // A SECOND, flag-less run must now proceed to actually attempt (and, here, ship) the
    // card — NOT silently skip it again. Before the P6 audit fix, `nextCard`'s own
    // `card.status === 'escalated'` gate (independent of `deriveCardPhase`'s file check) kept
    // excluding this card forever, no matter what the file said — this assertion is the one
    // that is FALSE without the `nextCard` fix (see `core/state.test.ts`'s companion
    // unit-level reproduction of the same defect).
    const secondRun = await runLoop(baseLoopConfig({ includeEscalated: false }), io);
    expect(secondRun.processed).toEqual([{ kind: 'shipped', cardId: 'C1' }]);
    expect(secondRun.exitCode).toBe(EXIT_OK);
  });
});

describe('runLoop — --dry-run: zero side effects', () => {
  function noMutationIo(base: LoopIO): LoopIO {
    const forbid = (name: string) => () => {
      throw new Error(`dry-run must never call ${name}`);
    };
    return {
      ...base,
      writeFile: forbid('writeFile') as LoopIO['writeFile'],
      writeLock: forbid('writeLock') as LoopIO['writeLock'],
      removeLock: forbid('removeLock') as LoopIO['removeLock'],
      spawnSession: forbid('spawnSession') as LoopIO['spawnSession'],
      appendLog: forbid('appendLog') as LoopIO['appendLog'],
      exec: mock(async (cmd: string[]) => {
        const mutating = [
          ['git', 'push'],
          ['git', 'commit'],
          ['git', 'checkout', '-B'],
          ['gh', 'pr', 'create'],
          ['gh', 'pr', 'merge'],
          ['git', 'worktree', 'remove'],
          ['git', 'branch', '-D'],
        ];
        if (mutating.some((m) => m.every((tok, i) => cmd[i] === tok))) {
          throw new Error(`dry-run must never issue a mutating exec call: ${cmd.join(' ')}`);
        }
        return base.exec(cmd);
      }) as LoopIO['exec'],
    };
  }

  test('derives the phase for the next card with NO mutating call anywhere', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: null }) },
    });
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state), answers: '' });
    const guarded = noMutationIo(io);

    const result = await runLoop(baseLoopConfig({ dryRun: true }), guarded);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.dryRunPlan).toEqual({ cardId: 'C1', phase: { kind: 'fresh' } });
  });

  test('acceptance #1 fixture: next card derives to fresh with zero side effects', async () => {
    const state = fixtureState({
      sequence: ['B3'],
      cards: { B3: fixtureCard({ branch: null, spec: 'docs/specs/b3.md', plan: 'docs/plans/b3.md' }) },
    });
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state), answers: '' });
    const guarded = noMutationIo(io);

    const result = await runLoop(baseLoopConfig({ dryRun: true }), guarded);

    expect(result.dryRunPlan?.cardId).toBe('B3');
    expect(result.dryRunPlan?.phase).toEqual({ kind: 'fresh' });
  });

  // Audit fix (P11 fix round, skinnerA/skinnerB/scout): `runDryRun`'s own `loadState` call was
  // the ONE call site left without the `onWarning` callback, so an operator diagnosing a
  // suspected R3 stale-baseSha incident (the B13 shape) via `--dry-run` got zero warning —
  // unlike a real run (run-loop.ts's runPass path) or `cli/main.ts`'s report path, both of
  // which print the warning today. Reproduces the exact B13 combo (`staged` + `sessionId: null`
  // + a stale `baseSha`) through `--dry-run` and asserts the warning reaches `console.error`.
  test('surfaces the R3 stale-baseSha warning even on --dry-run (no writes, still a warning)', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: null, baseSha: 'stale-hand-reset-sha' }) },
    });
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state), answers: '' });
    const guarded = noMutationIo(io);

    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
    try {
      const result = await runLoop(baseLoopConfig({ dryRun: true }), guarded);
      expect(result.exitCode).toBe(EXIT_OK);
      expect(errors.some((line) => line.includes('C1: cleared stale baseSha on staged card (R3 invariant)'))).toBe(
        true,
      );
    } finally {
      console.error = originalConsoleError;
    }
  });
});

describe('runLoop — session error/timeout without a resume attempt: stops for external retry', () => {
  test('a fresh session that errors exhausts its 2 bounded auto-retries, then stops this run', async () => {
    // P1 fix-list: a lone `error` outcome is now `retryable`, so this scenario needs the SDK
    // to keep failing across every attempt (1 original + 2 retries = 3) to still reach
    // `stopped` — see the "bounded auto-retry" describe block below for the retry-succeeds
    // and timeout-never-retries counterparts.
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, spawnBriefs } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      spawnQueue: [
        () => {
          throw new Error('sdk crashed');
        },
        () => {
          throw new Error('sdk crashed again');
        },
        () => {
          throw new Error('sdk crashed a third time');
        },
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_SESSION_INCOMPLETE);
    expect(result.processed[0]).toMatchObject({ kind: 'stopped', cardId: 'C1', retryable: true });
    expect(spawnBriefs).toHaveLength(3);
  });
});

describe('runLoop — bounded auto-retry (P1 fix-list, spec "wait-aware liveness")', () => {
  test('(a) session ends "error" once then ships on retry: retry takes the D4 RESUME path (not a second blind fresh), outcome shipped, exactly 2 sessions spawned', async () => {
    // A genuinely fresh card (branch: null) — the P1 incident's own shape: the executor opens
    // its PR then ends its turn before ever reporting SHIPPED, so `card.pr`/`card.branch` are
    // never recorded (session.ts's `parseResultMessage` never sets `pr` on an `'error'`
    // outcome) even though `onSessionStart` DID record `card.sessionId` the instant attempt 1
    // started. P1 audit fix-round (blocker/should-fix, skinnerB + scout): this is the exact
    // scenario the earlier version of this test failed to exercise — it pre-set `card.branch`
    // to satisfy the post-ship verify point, which incidentally made the retry ALSO derive to
    // a blind `fresh` (the mocked `gh pr view` has no handler here either), so the "retry
    // succeeds" assertion below passed for the wrong reason. `gh pr view <pr> --json
    // headRefName` is now mocked so `recordBranchFromPr` can discover the branch AFTER shipping
    // — the same way it would for real.
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, spawnBriefs, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: [
        ...cleanCommitAndVerifyHandlers('aaaaaaa'),
        (cmd) =>
          cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view'
            ? ok(JSON.stringify({ headRefName: 'feat/c1-widget' }))
            : null,
      ],
      spawnQueue: [
        () => messages(errorMessages('sess-c1-try1')),
        () => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1-try2')),
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'shipped', cardId: 'C1' });
    expect(spawnBriefs).toHaveLength(2);
    // The proof this test exists for (P1 audit fix-round, finding 2): the retry did NOT spawn
    // a second blind fresh session carrying the plain executor-brief template — it sent the
    // literal `session_only` resume prompt, with `resume: 'sess-c1-try1'` set on the SDK call
    // (verified indirectly: only the resume path ever sends this exact literal string; a fresh
    // spawn always renders through `executorBrief`'s template).
    expect(spawnBriefs[1]).toBe(CONTINUE_UNKNOWN_STATE_PROMPT);
    expect(spawnBriefs[1]).not.toContain('{{CARD_ID}}');

    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.status).toBe('shipped');
    expect(finalState.cards.C1.branch).toBe('feat/c1-widget');
  });

  test('(b) session ends "error" every time it is tried: still bounded to exactly 2 retries, exit EXIT_SESSION_INCOMPLETE', async () => {
    // P1 audit fix-round (blocker/should-fix, skinnerB + scout): now that a genuinely fresh
    // card (branch: null) whose session recorded a sessionId before erroring takes the D4
    // RESUME path on retry (`phase.ts`'s `session_only` reason), each of the 2 bounded retries
    // costs UP TO TWO underlying SDK spawns — the resume attempt itself, and (only when THAT
    // also surfaces `'error'`) `runCardSession`'s own pre-existing resume-failure fallback to
    // one fresh-with-digest spawn (card-actions.ts, unchanged by this fix-round). Worst case,
    // every one of those 5 spawns (1 initial fresh + 2 retries x [resume attempt + fresh
    // fallback]) errors — this is exactly that worst case, proving the run-loop's own retry
    // counter (`retries < 2`) still bounds it, independent of how many spawns each retry costs.
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, spawnBriefs } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      spawnQueue: [
        () => messages(errorMessages('sess-c1-try1')), // initial blind fresh
        () => messages(errorMessages('sess-c1-try2')), // retry 1: resume attempt
        () => messages(errorMessages('sess-c1-try3')), // retry 1: resume-failure fresh fallback
        () => messages(errorMessages('sess-c1-try4')), // retry 2: resume attempt
        () => messages(errorMessages('sess-c1-try5')), // retry 2: resume-failure fresh fallback
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.exitCode).toBe(EXIT_SESSION_INCOMPLETE);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'stopped', cardId: 'C1', retryable: true });
    expect(spawnBriefs).toHaveLength(5);
    // Retries 1 and 2 both actually took the resume path (the literal prompt, not a rendered
    // executor-brief template) before falling back — the same proof point as test (a) above.
    expect(spawnBriefs[1]).toBe(CONTINUE_UNKNOWN_STATE_PROMPT);
    expect(spawnBriefs[3]).toBe(CONTINUE_UNKNOWN_STATE_PROMPT);
  });

  test('(c) session outcome "timeout": no retry, exactly 1 attempt', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: null }) } });
    const { io, spawnBriefs } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      spawnQueue: [
        () =>
          (async function* () {
            yield { type: 'system', subtype: 'init', session_id: 'sess-c1-try1' } as SessionMessage;
            await new Promise(() => {}); // hang forever — only the wall-clock timeout resolves.
          })(),
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1, sessionTimeoutMs: 20 }), io);

    expect(result.exitCode).toBe(EXIT_SESSION_INCOMPLETE);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'stopped', cardId: 'C1', retryable: false });
    expect(spawnBriefs).toHaveLength(1);
  });
});

// ===========================================================================================
// Task 2 — D5′ park-and-continue (spec §O4, plan Task 2, Warchief ruling W-F2)
// ===========================================================================================

/** Shared boilerplate for a card whose PR (create OR merge) goes through the executor session's
 * gh/git call sequence cleanly: fetch/checkout -B/add/commit/push/create/checks/merge/pull all
 * succeed. Reused verbatim across the park-and-continue tests below — none of them are testing
 * that sequence or `verify.ts` themselves (already covered elsewhere in this file). */
function cleanCommitAndVerifyHandlers(mergeSha: string): Array<(cmd: string[]) => ExecResult | null> {
  return [
    (cmd) => {
      if (cmd[0] === 'gh' && cmd[1] === 'api') return ok(JSON.stringify({ merged: true, merge_commit_sha: mergeSha }));
      if (cmd[0] === 'git' && cmd[1] === 'rev-list') return ok(`${mergeSha} p1 p2`);
      if (cmd[0] === 'git' && cmd[1] === 'merge-base') return ok('');
      if (cmd[0] === 'git' && cmd[1] === 'diff') return ok('');
      if (cmd[0] === 'git' && cmd[1] === 'fetch') return ok('');
      if (cmd[0] === 'git' && cmd[1] === 'checkout') return ok('');
      if (cmd[0] === 'git' && cmd[1] === 'add') return ok('');
      if (cmd[0] === 'git' && cmd[1] === 'commit') return ok('');
      if (cmd[0] === 'git' && cmd[1] === 'push') return ok('');
      if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create') return ok('https://example.invalid/o/r/pull/990\n');
      if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks') return ok(JSON.stringify([{ name: 'ci', bucket: 'pass' }]));
      if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return ok('');
      if (cmd[0] === 'git' && cmd[1] === 'pull') return ok('');
      return null;
    },
  ];
}

describe('runLoop — D5′: escalate-then-continue ordering', () => {
  test('C1 escalates (NEEDS_DIRECTION); the pass continues to independent C2, which still ships', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: null }),
        // A branch that IS set to ship — `checkWorktreeAndBranchGone` (D3 point 5) requires
        // `card.branch` to be non-null to pass, exactly `stateJsonWithTwoFreshCards`'s own
        // "pre-assigned branch, no PR/worktree trace yet" convention above.
        C2: fixtureCard({ branch: 'feat/c2-widget', spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('c2000001'),
      prToCard: { '2': 'C2' },
      spawnQueue: [
        () => messages(needsDirectionMessages('sess-c1')),
        () => messages(shippedMessages(2, 'c2000001', 'sess-c2')),
      ],
    });

    const result = await runLoop(baseLoopConfig(), io);

    // An escalation is present, so the pass-level exit code is ESCALATED even though C2
    // shipped (design note: an escalation always needs a human; that outranks a clean ship).
    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1' });
    expect(result.processed[1]).toMatchObject({ kind: 'shipped', cardId: 'C2' });

    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.C1.status).toBe('escalated');
    expect(finalState.cards.C2.status).toBe('shipped');
  });
});

describe('runLoop — D5′: all cards parked, nothing ships', () => {
  test('two independent cards both escalate; the pass reaches done and exits ESCALATED', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: null }),
        C2: fixtureCard({ branch: null, spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('unused'),
      spawnQueue: [
        () => messages(needsDirectionMessages('sess-c1')),
        () => messages(needsDirectionMessages('sess-c2')),
      ],
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed).toHaveLength(2);
    expect(result.processed.every((o) => o.kind === 'escalated')).toBe(true);
    expect(result.processed.map((o) => o.cardId)).toEqual(['C1', 'C2']);
  });
});

describe('runLoop — D5′: blocked cascade (W6)', () => {
  test('A escalates; B (dependsOn A) becomes blocked and is never attempted; C (independent) still ships', async () => {
    const state = fixtureState({
      sequence: ['A', 'B', 'C'],
      cards: {
        A: fixtureCard({ branch: null }),
        B: fixtureCard({
          branch: null,
          spec: 'docs/specs/b.md',
          plan: 'docs/plans/b.md',
          dependsOn: ['A'],
        }),
        C: fixtureCard({ branch: 'feat/c-widget', spec: 'docs/specs/c.md', plan: 'docs/plans/c.md' }),
      },
    });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('c3000001'),
      prToCard: { '3': 'C' },
      spawnQueue: [
        () => messages(needsDirectionMessages('sess-a')),
        () => messages(shippedMessages(3, 'c3000001', 'sess-c')),
      ],
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    // B is never in `processed` at all — it was skipped by `nextCard` (blocked), never
    // `attempted`, so no session was ever spawned for it and no escalation file exists for it.
    expect(result.processed.map((o) => o.cardId)).toEqual(['A', 'C']);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'A' });
    expect(result.processed[1]).toMatchObject({ kind: 'shipped', cardId: 'C' });

    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.A.status).toBe('escalated');
    expect(finalState.cards.B.status).toBe('blocked');
    expect(finalState.cards.C.status).toBe('shipped');
    expect(writtenFiles.has('/th/escalations/B.md')).toBe(false);
  });
});

describe('runLoop — W-F5: a last-tick blocked reconciliation must be PERSISTED, not left in memory', () => {
  test('A (missing spec/plan) escalates via PLANNING_NEEDED on the ONLY tick; B (dependsOn A) is ' +
    'reconciled to blocked on the very next tick, which discovers `done` and never processes ' +
    'another card — the state written through the io seam must still record B as "blocked", not ' +
    'the stale "staged" the file would carry if the reconciliation only ever lived in memory. ' +
    'Deliberately TWO cards only (no third independent card whose own persist would flush this ' +
    'one for free) — exactly W-F5\'s reproduction shape.', async () => {
    const state = fixtureState({
      sequence: ['A', 'B'],
      cards: {
        A: fixtureCard({ branch: null, spec: null, plan: null }),
        B: fixtureCard({ branch: null, dependsOn: ['A'] }),
      },
    });
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('unused'),
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'A', reason: 'planning_needed' });
    // No session was ever spawned for B — it was never attempted, only reconciled to blocked.
    expect(io.spawnSession).not.toHaveBeenCalled();

    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    expect(finalState.cards.A.status).toBe('escalated');
    expect(finalState.cards.B.status).toBe('blocked');
  });
});

describe('runLoop — D5′: escalation_pending phase (prior-run escalation file) parks and continues', () => {
  test('C1 has an unanswered escalation file from a previous run; the pass parks it and still ships independent C2', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        // Only the escalation FILE (not `card.status`) marks C1 pending — exactly
        // `deriveCardPhase`'s `escalation_pending` short-circuit.
        C1: fixtureCard({ branch: null }),
        C2: fixtureCard({ branch: 'feat/c2-widget', spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      escalationFiles: new Set(['C1']),
      execHandlers: cleanCommitAndVerifyHandlers('abc0002'),
      prToCard: { '2': 'C2' },
      spawnQueue: [() => messages(shippedMessages(2, 'abc0002', 'sess-c2'))],
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed).toEqual([
      { kind: 'escalation_pending', cardId: 'C1', escalationPath: expect.stringContaining('C1.md') },
      { kind: 'shipped', cardId: 'C2' },
    ]);
    // No session was ever spawned for the parked card C1 — only C2's.
    expect(io.spawnSession).toHaveBeenCalledTimes(1);
  });
});

describe('runLoop — D5′ W-F2: --include-escalated never re-selects the same card twice in one pass', () => {
  test('C1 (already escalated) escalates AGAIN this pass under --include-escalated; the pass still ' +
    'reaches and ships the independent C2 — proving each card is attempted at most once per pass, ' +
    'not merely bounded by --max-cards', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        // Exactly Stage C's re-trigger shape (spec §O6): `--cards <answered> --include-escalated`
        // against a card that was already `escalated` from a prior run.
        C1: fixtureCard({ branch: null, status: 'escalated' }),
        C2: fixtureCard({ branch: 'feat/c2-widget', spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('deadc2c2'),
      prToCard: { '2': 'C2' },
      // Only ONE spawnSession call is scripted for C1. If `nextCard` ever re-selected C1 a
      // second time (the W-F2 bug: an `escalated` card is excluded only when
      // `includeEscalated` is false, and C1 sits BEFORE C2 in `sequence`), this queue would
      // be exhausted before C2 is ever reached, and the mock's "spawnSession called more
      // times than scripted" guard would fire — or, since a `stopped` outcome also parks
      // rather than exits under D5′, the pass would re-select C1 forever with no `--max-cards`
      // set to bound it. This test deliberately omits `--max-cards`: the plan explicitly
      // forbids relying on it to bound this case (that would hide the very bug this test
      // exists to catch — see `filteredNextCard`'s `attempted`-set doc comment).
      spawnQueue: [
        () => messages(needsDirectionMessages('sess-c1-again')),
        () => messages(shippedMessages(2, 'deadc2c2', 'sess-c2')),
      ],
    });

    const result = await runLoop(baseLoopConfig({ includeEscalated: true }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1' });
    expect(result.processed[1]).toMatchObject({ kind: 'shipped', cardId: 'C2' });
    // C1 was attempted EXACTLY once this pass, never re-selected after its own re-escalation.
    expect(io.spawnSession).toHaveBeenCalledTimes(2);
  });
});

describe('runLoop — D5′: --max-cards counts ATTEMPTED cards (shipped + escalated), park-and-continue included', () => {
  test('max-cards 1: C1 escalates and consumes the whole budget; independent C2 is never attempted', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: null }),
        C2: fixtureCard({ branch: null, spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('unused'),
      spawnQueue: [() => messages(needsDirectionMessages('sess-c1'))],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1' });
    expect(io.spawnSession).toHaveBeenCalledTimes(1);
  });
});

describe('runLoop — D5′ Warchief audit fix: --max-cards budgets only cards actually WORKED, not merely selected', () => {
  test('max-cards 1: A parks on a PRIOR-run escalation file (no work done this pass, consumes no budget); ' +
    'B — the one card actually worked — still ships in the same pass', async () => {
    // The bug this guards: `attempted` (dedup/termination) and the `--max-cards` BUDGET are
    // different questions. Plan line: "--max-cards counts attempted cards (shipped +
    // escalated)" — a card merely PARKED on a stale escalation file (nothing written this
    // pass) must not consume budget any more than a `blocked` card does. Before this fix,
    // `attempted.size` alone gated the loop, so `--max-cards 1` would exit after parking A
    // and B — genuinely progressable, staged, no escalation of its own — would never even be
    // attempted this pass, even though zero real work happened.
    const state = fixtureState({
      sequence: ['A', 'B'],
      cards: {
        // Only the escalation FILE (not `card.status`) marks A pending — the
        // `escalation_pending` phase, exactly like the dedicated test above for that path.
        A: fixtureCard({ branch: null }),
        B: fixtureCard({ branch: 'feat/b-widget', spec: 'docs/specs/b.md', plan: 'docs/plans/b.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      escalationFiles: new Set(['A']),
      execHandlers: cleanCommitAndVerifyHandlers('bbb0001'),
      prToCard: { '5': 'B' },
      spawnQueue: [() => messages(shippedMessages(5, 'bbb0001', 'sess-b'))],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.processed).toEqual([
      { kind: 'escalation_pending', cardId: 'A', escalationPath: expect.stringContaining('A.md') },
      { kind: 'shipped', cardId: 'B' },
    ]);
    // B's session was in fact spawned this pass — the budget did not stop it.
    expect(io.spawnSession).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================================
// P12 follow-up — `--max-concurrent N`: bounded card parallelism
// ===========================================================================================

/** Polls a synchronous condition by yielding to the microtask queue — used to observe
 * in-flight pool state (e.g. "both sessions have started") without a real timer. Bounded so a
 * genuine bug (the condition never becomes true) fails the test instead of hanging it. */
async function waitForCondition(check: () => boolean, maxTicks = 500): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('condition not met within the microtask budget');
}

describe('runLoop — --max-concurrent N (P12 follow-up: bounded card parallelism)', () => {
  test('N=1 (explicit) is byte-identical to the pre-existing default (omitted) serial pass', async () => {
    const { io: ioDefault } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      prToCard: { '2': 'C2' },
      spawnQueue: [
        () => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1')),
        () => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2')),
      ],
    });
    const withoutFlag = await runLoop(baseLoopConfig({ maxCards: 2 }), ioDefault);

    const { io: ioExplicit } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      prToCard: { '2': 'C2' },
      spawnQueue: [
        () => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1')),
        () => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2')),
      ],
    });
    const withFlag = await runLoop(baseLoopConfig({ maxCards: 2, maxConcurrent: 1 }), ioExplicit);

    expect(withFlag.exitCode).toBe(withoutFlag.exitCode);
    expect(withFlag.processed).toEqual(withoutFlag.processed);
    expect(withFlag.processed[0]).toMatchObject({ kind: 'shipped', cardId: 'C1' });
    expect(withFlag.processed[1]).toMatchObject({ kind: 'shipped', cardId: 'C2' });
  });

  test('N=2: two independent cards genuinely overlap in flight — both spawnSession calls fire before either session resolves', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const spawnedFor: string[] = [];

    function gatedShippedSession(label: string, pr: number, sha: string, sessionId: string) {
      return async function* (): AsyncGenerator<SessionMessage> {
        spawnedFor.push(label);
        yield { type: 'system', subtype: 'init', session_id: sessionId };
        // Held open until the test has already proven BOTH sessions started — if the pool
        // were secretly serial, C2's generator would never even be entered while C1 is
        // parked here, since C1's `runSession` call wouldn't have returned yet.
        await gate;
        yield { type: 'result', subtype: 'success', result: `All done.\nSHIPPED ${pr} ${sha}`, session_id: sessionId };
      };
    }

    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      spawnQueue: [
        () => gatedShippedSession('C1', 1, 'aaaaaaa', 'sess-c1')(),
        () => gatedShippedSession('C2', 2, 'bbbbbbb', 'sess-c2')(),
      ],
    });

    const runPromise = runLoop(baseLoopConfig({ maxCards: 2, maxConcurrent: 2 }), io);

    await waitForCondition(() => spawnedFor.length === 2);
    expect([...spawnedFor].sort()).toEqual(['C1', 'C2']);

    releaseGate();
    const result = await runPromise;

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed).toHaveLength(2);
    expect(result.processed.map((o) => o.cardId).sort()).toEqual(['C1', 'C2']);
  });

  test('dependsOn still orders correctly under N=2: the dependent card never starts before its dependency ships', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const spawnedFor: string[] = [];

    function gatedShippedSession(label: string, pr: number, sha: string, sessionId: string) {
      return async function* (): AsyncGenerator<SessionMessage> {
        spawnedFor.push(label);
        yield { type: 'system', subtype: 'init', session_id: sessionId };
        await gate;
        yield { type: 'result', subtype: 'success', result: `All done.\nSHIPPED ${pr} ${sha}`, session_id: sessionId };
      };
    }

    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: 'feat/c1-widget' }),
        C2: fixtureCard({
          branch: 'feat/c2-widget',
          spec: 'docs/specs/c2.md',
          plan: 'docs/plans/c2.md',
          dependsOn: ['C1'],
        }),
      },
    });

    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      prToCard: { '2': 'C2' },
      spawnQueue: [
        () => gatedShippedSession('C1', 1, 'aaaaaaa', 'sess-c1')(),
        () => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2')),
      ],
    });

    const runPromise = runLoop(baseLoopConfig({ maxCards: 2, maxConcurrent: 2 }), io);

    // Give the pool every chance it would need to (wrongly) start C2 concurrently with C1 —
    // several dozen microtask-queue drains, all while C1 (its declared dependency) sits
    // unshipped behind `gate`.
    await waitForCondition(() => spawnedFor.length >= 1);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(spawnedFor).toEqual(['C1']);

    releaseGate();
    const result = await runPromise;

    expect(result.exitCode).toBe(EXIT_OK);
    // C2 ships too, via the plain (non-gated) spawn queued for it — `spawnedFor` only ever
    // records the gated generator's own entries (C1), so the session COUNT is what proves C2
    // was actually reached after C1 shipped.
    expect(io.spawnSession).toHaveBeenCalledTimes(2);
    expect(result.processed.map((o) => o.cardId)).toEqual(['C1', 'C2']);
  });

  test('never hands the same card to two workers: 5 available slots, 2 independent cards -> exactly 2 sessions spawned', async () => {
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      spawnQueue: [
        () => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1')),
        () => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2')),
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 5, maxConcurrent: 5 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(io.spawnSession).toHaveBeenCalledTimes(2);
    expect(result.processed.map((o) => o.cardId).sort()).toEqual(['C1', 'C2']);
  });

  test('--max-cards budget is never overshot under concurrency: max-concurrent 3, max-cards 1, two independent cards -> only one worked', async () => {
    const { io, writtenFiles } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      spawnQueue: [() => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1'))],
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 1, maxConcurrent: 3 }), io);

    expect(result.processed).toHaveLength(1);
    expect(io.spawnSession).toHaveBeenCalledTimes(1);
    const finalState = JSON.parse(writtenFiles.get('/th/campaign-state.json') as string);
    // C2 was never even claimed this pass — still exactly as staged as before the run.
    expect(finalState.cards.C2.status).toBe('staged');
  });

  test('STOP file present at startup: N>1 spawns nothing, same contract as N=1', async () => {
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '',
      stopFile: true,
    });

    const result = await runLoop(baseLoopConfig({ maxCards: 2, maxConcurrent: 4 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.processed).toEqual([]);
    expect(io.spawnSession).not.toHaveBeenCalled();
  });

  test('escalation_pending under N>1 parks without consuming a session — independent card still ships', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        // Only the escalation FILE (not `card.status`) marks C1 pending — exactly
        // `deriveCardPhase`'s `escalation_pending` short-circuit, same fixture shape as the
        // dedicated N=1 test above.
        C1: fixtureCard({ branch: null }),
        C2: fixtureCard({ branch: 'feat/c2-widget', spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      escalationFiles: new Set(['C1']),
      execHandlers: cleanCommitAndVerifyHandlers('abc0002'),
      prToCard: { '2': 'C2' },
      spawnQueue: [() => messages(shippedMessages(2, 'abc0002', 'sess-c2'))],
    });

    const result = await runLoop(baseLoopConfig({ maxConcurrent: 3 }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed).toEqual(
      expect.arrayContaining([
        { kind: 'escalation_pending', cardId: 'C1', escalationPath: expect.stringContaining('C1.md') },
        { kind: 'shipped', cardId: 'C2' },
      ]),
    );
    // No session was ever spawned for the parked card C1 — only C2's, same as the N=1 test.
    expect(io.spawnSession).toHaveBeenCalledTimes(1);
  });

  test('planning_needed under N>1 is handled without spawning a session for that card — independent card still ships', async () => {
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      prToCard: { '2': 'C2' },
      spawnQueue: [() => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2'))],
    });
    // C1's spec/plan (fixtureCard's defaults: docs/specs/c1.md, docs/plans/c1.md) are the only
    // ones treated as missing — C2's own (docs/specs/c2.md, docs/plans/c2.md) still resolve.
    const realFileExists = io.fileExists;
    io.fileExists = ((p: string) =>
      p.includes('docs/specs/c1.md') || p.includes('docs/plans/c1.md') ? false : realFileExists(p)) as LoopIO['fileExists'];

    const result = await runLoop(baseLoopConfig({ maxConcurrent: 3 }), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'escalated', cardId: 'C1', reason: 'planning_needed' }),
        expect.objectContaining({ kind: 'shipped', cardId: 'C2' }),
      ]),
    );
    expect(io.spawnSession).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================================
// P12 follow-up hardening — panel findings from the --max-concurrent review
// ===========================================================================================

describe('serializeRepoGitMutation (card-actions.ts) — runner-side git worktree/branch ' +
  'mutations serialize across concurrent cards (panel finding #1)', () => {
  test('two concurrent performRevertAndRedo calls (different cards) never interleave their exec calls', async () => {
    const callOrder: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const state = fixtureState({
      sequence: ['A', 'B'],
      cards: {
        A: fixtureCard({ branch: 'feat/a-widget' }),
        B: fixtureCard({ branch: 'feat/b-widget' }),
      },
    });
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state) });

    // Every default-fallback command in buildMockLoopIo resolves near-instantly (no real
    // delay) — wrap `exec` to (a) record every call's argv, in order, and (b) hold the FIRST
    // "git worktree list" call open on `gateA` until the test proves the SECOND card's calls
    // haven't started. Whichever card's `performRevertAndRedo` the mutex lets run first will be
    // the one that hits this gate (see below: it's launched first, so it's A's).
    const realExec = io.exec;
    let gated = false;
    io.exec = (async (cmd: string[], opts?: { cwd?: string }) => {
      callOrder.push(cmd.join(' '));
      const isFirstWorktreeList = !gated && cmd[0] === 'git' && cmd[1] === 'worktree' && cmd[2] === 'list';
      if (isFirstWorktreeList) {
        gated = true;
        await gateA;
      }
      return realExec(cmd, opts);
    }) as LoopIO['exec'];

    const resolved: ResolvedConfig = { ...baseLoopConfig(), baseBranch: 'master', answersContent: '', briefTemplate: '' };
    const ctxA: CardCtx = { cardId: 'A', state, resolved, io };
    const ctxB: CardCtx = { cardId: 'B', state, resolved, io };

    // Fired back-to-back, unawaited — exactly how `runPassPool` would launch two cards'
    // `runCardTurn`s concurrently.
    const pA = performRevertAndRedo(ctxA);
    const pB = performRevertAndRedo(ctxB);

    await waitForCondition(() => callOrder.length >= 1);
    // Give B's call every chance it would need to (wrongly) start while A is gated mid-call.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(callOrder).toEqual(['git worktree list --porcelain']); // only A's first call fired.

    releaseA();
    await Promise.all([pA, pB]);

    // A's entire 3-call sequence completes before B's even begins — no interleaving.
    expect(callOrder).toEqual([
      'git worktree list --porcelain',
      'git branch -D feat/a-widget',
      'git ls-remote --heads origin feat/a-widget',
      'git worktree list --porcelain',
      'git branch -D feat/b-widget',
      'git ls-remote --heads origin feat/b-widget',
    ]);
  });

  test('--max-concurrent 1 (today\'s only caller today) is unaffected: the queue is a permanent no-op with one card in flight', async () => {
    // Regression guard for the "always-on, no branching on maxConcurrent" design choice — a
    // single card's own performRevertAndRedo must behave exactly as before this hardening PR:
    // no extra await, no change to call order or count.
    const state = fixtureState({ sequence: ['A'], cards: { A: fixtureCard({ branch: 'feat/a-widget' }) } });
    const { io, calls } = buildMockLoopIo({ stateJson: JSON.stringify(state) });
    const resolved: ResolvedConfig = { ...baseLoopConfig(), baseBranch: 'master', answersContent: '', briefTemplate: '' };

    await performRevertAndRedo({ cardId: 'A', state, resolved, io });

    expect(calls.map((c) => c.join(' '))).toEqual([
      'git worktree list --porcelain',
      'git branch -D feat/a-widget',
      'git ls-remote --heads origin feat/a-widget',
    ]);
  });
});

describe('runPassPool — panel finding #2: one card\'s thrown exception must not abort the pass or abandon siblings', () => {
  test('a card whose turn throws mid-pool is reported stopped/non-retryable; the other card still ships; the pass ends cleanly', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: 'feat/c1-widget' }),
        C2: fixtureCard({ branch: 'feat/c2-widget', spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '# answers\n(none yet)\n',
      execHandlers: [
        ...cleanCommitAndVerifyHandlers('deadbee'),
        (cmd) => {
          // C1's very first phase-derive call throws — simulating an unexpected exception deep
          // in a card's turn (e.g. a thrown error the SDK/exec layer doesn't itself convert to
          // a typed result).
          if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'view' && cmd[3] === 'feat/c1-widget') {
            throw new Error('simulated unexpected exception mid-turn');
          }
          return null;
        },
      ],
      prToCard: { '2': 'C2' },
      spawnQueue: [() => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2'))],
    });

    const result = await runLoop(baseLoopConfig({ maxConcurrent: 2 }), io);

    // The pass ends cleanly (no uncaught rejection out of runLoop) with BOTH cards accounted
    // for — C2 was never abandoned mid-flight because of C1's crash.
    expect(result.processed).toHaveLength(2);
    const c1 = result.processed.find((o) => o.cardId === 'C1');
    const c2 = result.processed.find((o) => o.cardId === 'C2');
    expect(c1).toMatchObject({ kind: 'stopped', cardId: 'C1', retryable: false });
    expect((c1 as { reason: string }).reason).toContain('simulated unexpected exception mid-turn');
    expect(c2).toMatchObject({ kind: 'shipped', cardId: 'C2' });
    expect(result.exitCode).toBe(EXIT_SESSION_INCOMPLETE);
  });
});

describe('runPassPool — panel findings #3/#4: rulings gate and mid-pass STOP under N>1', () => {
  test('genuine done with an unratified ruling -> EXIT_RULINGS_UNRATIFIED through the pool path (N=2)', async () => {
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '## Some ruling\nBody text, no ratified-as line.\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      spawnQueue: [
        () => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1')),
        () => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2')),
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxConcurrent: 2 }), io);

    expect(result.processed).toHaveLength(2);
    expect(result.exitCode).toBe(EXIT_RULINGS_UNRATIFIED);
  });

  test('a card still in flight when nextCard first reports done does NOT wrongly gate on rulings (companion case)', async () => {
    // maxConcurrent 2 but only ONE card is ever selectable (C2's spec/plan are missing, so it
    // resolves as PLANNING_NEEDED the very first time it's picked, not a live in-flight worker)
    // — this test's real point is `reachedDone`'s own two-part condition (`nc.kind === 'done'`
    // AND `active.size === 0`): it must still end up EXIT_OK/gated exactly like the N=1 path
    // once every card is genuinely accounted for, never fire the rulings gate a tick early
    // while something was still active. Covered end-to-end via the single-card overlap case
    // above; this test pins the OK case (no unratified ruling) so a regression that starts
    // gating early would flip this from EXIT_OK to EXIT_RULINGS_UNRATIFIED and fail loudly.
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      spawnQueue: [
        () => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1')),
        () => messages(shippedMessages(2, 'bbbbbbb', 'sess-c2')),
      ],
    });

    const result = await runLoop(baseLoopConfig({ maxConcurrent: 2 }), io);

    expect(result.exitCode).toBe(EXIT_OK);
  });

  test('STOP armed while N=2 workers are mid-flight: both in-flight cards drain to completion, no third card is claimed, reachedDone stays false', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const spawnedFor: string[] = [];

    function gatedShippedSession(label: string, pr: number, sha: string, sessionId: string) {
      return async function* (): AsyncGenerator<SessionMessage> {
        spawnedFor.push(label);
        yield { type: 'system', subtype: 'init', session_id: sessionId };
        await gate;
        yield { type: 'result', subtype: 'success', result: `All done.\nSHIPPED ${pr} ${sha}`, session_id: sessionId };
      };
    }

    // A third, independent card — must NEVER be claimed once STOP is armed, even though the
    // pool has spare capacity (maxConcurrent 2, only 2 workers active) once C1/C2 drain.
    const state = fixtureState({
      sequence: ['C1', 'C2', 'C3'],
      cards: {
        C1: fixtureCard({ branch: 'feat/c1-widget' }),
        C2: fixtureCard({ branch: 'feat/c2-widget', spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
        C3: fixtureCard({ branch: 'feat/c3-widget', spec: 'docs/specs/c3.md', plan: 'docs/plans/c3.md' }),
      },
    });

    let stopArmed = false;
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '# answers\n(none yet)\n',
      execHandlers: cleanCommitAndVerifyHandlers('deadbee'),
      spawnQueue: [
        () => gatedShippedSession('C1', 1, 'aaaaaaa', 'sess-c1')(),
        () => gatedShippedSession('C2', 2, 'bbbbbbb', 'sess-c2')(),
        () => messages(shippedMessages(3, 'ccccccc', 'sess-c3')),
      ],
    });
    const realFileExists = io.fileExists;
    io.fileExists = ((p: string) => (p.endsWith('STOP') ? stopArmed : realFileExists(p))) as LoopIO['fileExists'];

    const runPromise = runLoop(baseLoopConfig({ maxConcurrent: 2 }), io);

    // Both C1 and C2 start (maxConcurrent 2, both independent, both fit) — THEN arm STOP while
    // they're still gated mid-session, before releasing them.
    await waitForCondition(() => spawnedFor.length === 2);
    stopArmed = true;
    for (let i = 0; i < 50; i++) await Promise.resolve(); // give the pool every chance to (wrongly) claim C3 anyway.
    expect(io.spawnSession).toHaveBeenCalledTimes(2); // C3 never claimed.

    releaseGate();
    const result = await runPromise;

    // Both in-flight cards drained to completion; C3 was never even attempted; the pass did
    // NOT reach genuine `done` (STOP truncated it), so the rulings gate never fires either.
    expect(result.processed).toHaveLength(2);
    expect(result.processed.map((o) => o.cardId).sort()).toEqual(['C1', 'C2']);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(io.spawnSession).toHaveBeenCalledTimes(2);
  });
});

describe('runLoop — D5′: exit-code precedence (escalation outranks session-incomplete)', () => {
  test('one card escalates and another stops (session error); exit code is ESCALATED, not SESSION_INCOMPLETE', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: null }),
        C2: fixtureCard({ branch: null, spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('unused'),
      spawnQueue: [
        () => messages(needsDirectionMessages('sess-c1')),
        () => {
          throw new Error('sdk crashed for c2');
        },
      ],
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.processed).toHaveLength(2);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1' });
    expect(result.processed[1]).toMatchObject({ kind: 'stopped', cardId: 'C2' });
    expect(result.exitCode).toBe(EXIT_ESCALATED);
  });
});

describe('runLoop — D5′: STOP file created mid-pass finishes the in-flight card only', () => {
  test('the owner drops STOP while C1 is in flight; C1 finishes and ships, C2 is never started', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: 'feat/c1-widget' }),
        C2: fixtureCard({ branch: null, spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers: '',
      execHandlers: cleanCommitAndVerifyHandlers('aaaaaaa'),
      spawnQueue: [() => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1'))],
    });

    let stopArmed = false;
    const baseFileExists = io.fileExists as unknown as (p: string) => boolean;
    io.fileExists = mock((p: string) => {
      if (p.endsWith('STOP')) return stopArmed;
      return baseFileExists(p);
    });
    const baseSpawnSession = io.spawnSession;
    io.spawnSession = mock((params) => {
      // Simulate the owner creating the STOP file WHILE C1's session is in flight — the
      // in-flight card must still finish (D2's STOP contract), and the NEXT card must never
      // start.
      stopArmed = true;
      return baseSpawnSession(params);
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'shipped', cardId: 'C1' });
    expect(io.spawnSession).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(EXIT_OK);
  });
});

// ===========================================================================================
// runLoop — harness-gap-wiring PR C: the campaign-level rulings gate. Postmortem
// (outstanding-17): a ruling that captured a durable convention was never ratified into the
// target repo's governance files because nothing gated on it. This gate fires ONLY on the
// path that would otherwise conclude `done` (every requested card resolved) — an
// `escalations_pending`/`session_incomplete`/`stop_requested` exit is unchanged.
// ===========================================================================================

describe('runLoop — rulings gate (fires only on the would-be-done path)', () => {
  function fullyShippedState(): CampaignState {
    return fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ status: 'shipped', pr: 41, mergeSha: 'deadbee' }) },
    });
  }

  test('an unratified ruling in answers.md blocks the would-be-done exit', async () => {
    const answers = ['## R1 — Some convention', '', 'ratified-as: pending', ''].join('\n');
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(fullyShippedState()), answers });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_RULINGS_UNRATIFIED);
    expect(result.unratifiedRulings).toEqual(['R1 — Some convention']);
    expect(result.message).toBeDefined();
    expect(result.message as string).toContain('R1 — Some convention');
  });

  test('every ruling ratified -> normal EXIT_OK/done, no unratifiedRulings field', async () => {
    const answers = ['## R1 — Some convention', '', 'ratified-as: operational', ''].join('\n');
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(fullyShippedState()), answers });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.unratifiedRulings).toBeUndefined();
  });

  test('answers.md with no rulings at all -> unaffected (regression: existing happy-path shape)', async () => {
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(fullyShippedState()),
      answers: '# answers\n(none yet)\n',
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.unratifiedRulings).toBeUndefined();
  });

  test('an escalating pass is NOT gated by an unratified ruling — gate fires only on would-be-done', async () => {
    const state = fixtureState({
      sequence: ['C1'],
      cards: { C1: fixtureCard({ branch: 'feat/c1-widget' }) },
    });
    const answers = ['## R1 — Some convention', '', 'ratified-as: pending', ''].join('\n');
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers,
      spawnQueue: [() => messages(needsDirectionMessages('sess-c1'))],
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.exitCode).toBe(EXIT_ESCALATED);
    expect(result.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'C1' });
    expect(result.unratifiedRulings).toBeUndefined();
  });

  // Regression (3-lens review, contract lens): `computeExitCode` returns `EXIT_OK` whenever
  // nothing in `processed` escalated or stopped — that is ALSO true when the pass broke out
  // early (a mid-pass STOP, or the `--max-cards` budget) with cards still genuinely unattempted,
  // not just when `filteredNextCard` actually returned `{ kind: 'done' }`. The gate must fire
  // ONLY on the latter (brief: "all requested cards resolved") — these two tests reproduce the
  // exact scenario the review caught (an unratified ruling present, but the pass never reached
  // genuine done) and assert the gate stays quiet.
  test('a mid-pass STOP with a card still unattempted is NOT gated, even with an unratified ruling', async () => {
    const state = fixtureState({
      sequence: ['C1', 'C2'],
      cards: {
        C1: fixtureCard({ branch: 'feat/c1-widget' }),
        C2: fixtureCard({ branch: null, spec: 'docs/specs/c2.md', plan: 'docs/plans/c2.md' }),
      },
    });
    const answers = ['## R1 — Some convention', '', 'ratified-as: pending', ''].join('\n');
    const { io } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      answers,
      execHandlers: cleanCommitAndVerifyHandlers('aaaaaaa'),
      spawnQueue: [() => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1'))],
    });

    let stopArmed = false;
    const baseFileExists = io.fileExists as unknown as (p: string) => boolean;
    io.fileExists = mock((p: string) => {
      if (p.endsWith('STOP')) return stopArmed;
      return baseFileExists(p);
    });
    const baseSpawnSession = io.spawnSession;
    io.spawnSession = mock((params) => {
      // The owner drops STOP while C1's session is in flight — C1 still finishes and ships
      // (D2's STOP contract), but C2 must never even be attempted this pass.
      stopArmed = true;
      return baseSpawnSession(params);
    });

    const result = await runLoop(baseLoopConfig(), io);

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'shipped', cardId: 'C1' });
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.unratifiedRulings).toBeUndefined();
  });

  test('a --max-cards budget exhaustion with a card still unattempted is NOT gated, even with an unratified ruling', async () => {
    const answers = ['## R1 — Some convention', '', 'ratified-as: pending', ''].join('\n');
    const { io } = buildMockLoopIo({
      stateJson: stateJsonWithTwoFreshCards(),
      answers,
      execHandlers: cleanCommitAndVerifyHandlers('aaaaaaa'),
      spawnQueue: [() => messages(shippedMessages(1, 'aaaaaaa', 'sess-c1'))],
    });

    // maxCards: 1 — only C1 (of C1/C2) is ever worked; C2 stays 'staged', genuinely unattempted.
    const result = await runLoop(baseLoopConfig({ maxCards: 1 }), io);

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ kind: 'shipped', cardId: 'C1' });
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.unratifiedRulings).toBeUndefined();
  });
});
