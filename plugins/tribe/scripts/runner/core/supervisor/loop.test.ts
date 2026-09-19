// Tests for loop.ts (Task 14, spec §4.2): the observe -> decide -> record-intent -> perform ->
// persist -> publish tick, driven end to end through a FULLY SCRIPTED fake `SupervisorLoopSeam`
// — no real fs, no real spawn, no real SDK. Every fixture lives under a throwaway, never-real
// `HOME` string; nothing here touches `~/.tribe/-Users-hip-repo-tribe/campaigns/`.
import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runSupervisor, type SupervisorLoopConfig, type SupervisorLoopSeam, type SupervisorTerminal } from './loop.ts';
import type { OneShotSpawnParams } from './session.ts';
import type { SessionMessage } from '../session.ts';
import type { WatchdogHandle } from '../../ports/ports.ts';
import type { SupervisorLimits } from './model.ts';

const HOME = '/h/.tribe/k/campaigns/c';
const REPO = '/repo';

const LIMITS: SupervisorLimits = {
  maxRulingRounds: 2, maxRatifyRounds: 2, maxSpawns: 8, maxWatchdogRuns: 20, sessionRetries: 1,
};

function baseConfig(overrides: Partial<SupervisorLoopConfig> = {}): SupervisorLoopConfig {
  return {
    repoRoot: REPO,
    model: 'claude-fixture',
    watchdogModel: null,
    campaign: 'c',
    limits: LIMITS,
    sessionTimeoutSeconds: 1800,
    pollSeconds: 30,
    watchdogCommand: ['bun', '/abs/run.ts'],
    rerunCommand: 'bun run.ts supervise --repo /repo --campaign c --model claude-fixture',
    ...overrides,
  };
}

interface ScriptedWatchdogRun {
  reason: string;
  exitCode: number;
  /** Overwrites `campaign-report.json` the moment this run's `waitFor()` resolves — simulating
   * the runner (the watchdog's own child) having produced a fresh report before exiting. */
  report?: Record<string, unknown>;
}

interface ScriptedSession {
  /** Mutates the virtual filesystem as the session's own tool calls would — invoked while the
   * message stream is being consumed, before the terminal `result` message. */
  effect?: () => void;
  subtype?: 'success' | 'error';
}

function fakeSeam(opts: {
  watchdogRuns?: ScriptedWatchdogRun[];
  sessions?: ScriptedSession[];
  initialFiles?: Record<string, string>;
  gitStatus?: string;
}) {
  const files = new Map<string, string>(Object.entries(opts.initialFiles ?? {}));
  const writes: string[] = []; // every writeFileAtomic/appendFile/renameIfPresent(to) target
  const callLog: string[] = []; // 'events' | 'effect', in order — proves step-4-before-step-5
  const statusHistory: string[] = []; // every status.json body, in publish order
  const deadPids = new Set<number>();
  let nextPid = 5000;
  let nowMs = 1_800_000_000_000;
  const watchdogQueue = [...(opts.watchdogRuns ?? [])];
  const sessionQueue = [...(opts.sessions ?? [])];
  let sessionCounter = 0;
  const watchdogStatusPath = join(HOME, 'watchdog', 'status.json');
  const statusPath = join(HOME, 'supervisor', 'status.json');

  function listEntries(dirPath: string): Array<{ name: string; mtimeMs: number; isDir: boolean }> {
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const seen = new Map<string, boolean>();
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (!seen.has(name)) seen.set(name, slash !== -1);
    }
    return [...seen.entries()].map(([name, isDir]) => ({ name, mtimeMs: nowMs, isDir }));
  }

  const io: SupervisorLoopSeam = {
    now: () => new Date(nowMs).toISOString(),
    nowMs: () => nowMs,
    isProcessAlive: (pid) => !deadPids.has(pid),
    currentPid: () => 1,
    appendFile: (p, content) => {
      files.set(p, `${files.get(p) ?? ''}${content}`);
      writes.push(p);
      if (p.endsWith('events.jsonl')) callLog.push('events');
    },
    writeFileAtomic: (p, content) => {
      files.set(p, content);
      writes.push(p);
      if (p === statusPath) statusHistory.push(content);
    },
    readFileOrEmpty: (p) => files.get(p) ?? '',
    renameIfPresent: (from, to) => {
      if (!files.has(from)) return;
      files.set(to, files.get(from) as string);
      files.delete(from);
      writes.push(to);
      callLog.push('effect');
    },
    listEntries,
    spawnWatchdog: (_argv, _opts): WatchdogHandle => {
      const pid = nextPid++;
      // A freshly spawned watchdog is alive with no terminal yet — visible to the very next
      // observe() (P4 adoption), mirroring a real child process's own first status.json write.
      files.set(watchdogStatusPath, JSON.stringify({ pid, terminal: null }));
      callLog.push('effect');
      return {
        pid,
        waitFor: async (_waitMs) => {
          const run = watchdogQueue.shift();
          if (run === undefined) throw new Error('fakeSeam: no scripted watchdog run left');
          files.set(watchdogStatusPath, JSON.stringify({
            pid, terminal: { status: 'terminal', reason: run.reason, exitCode: run.exitCode },
          }));
          if (run.report !== undefined) {
            files.set(join(HOME, 'campaign-report.json'), JSON.stringify(run.report));
          }
          deadPids.add(pid);
          return run.exitCode;
        },
      };
    },
    resolveTribeHome: async () => ({ ok: true, home: HOME }),
    gitStatusPorcelain: async () => opts.gitStatus ?? '',
    realpath: (p) => p,
    spawnSession: (params: OneShotSpawnParams): AsyncIterable<SessionMessage> => {
      callLog.push('effect');
      async function* gen(): AsyncGenerator<SessionMessage> {
        const sessionId = `sess-${++sessionCounter}`;
        yield { type: 'system', subtype: 'init', session_id: sessionId };
        const script = sessionQueue.shift();
        script?.effect?.();
        yield {
          type: 'result',
          subtype: script?.subtype ?? 'success',
          session_id: sessionId,
          result: 'done',
          usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 },
          total_cost_usd: 0.01,
          permission_denials: [],
        };
      }
      void params;
      return gen();
    },
    onSessionStart: () => {},
    appendLog: (p, line) => {
      files.set(p, `${files.get(p) ?? ''}${line}\n`);
      writes.push(p);
    },
  };

  return { io, files, writes, callLog, statusHistory };
}

/** Every write this loop performs must land in one of S-P5's three locations. */
function assertWriteSurface(writes: string[]): void {
  for (const path of writes) {
    const inSupervisorDir = path.startsWith(join(HOME, 'supervisor') + '/') || path === join(HOME, 'supervisor');
    const isNeedsOwner = path === join(HOME, 'NEEDS_OWNER.md');
    const isEscalationRename = path.startsWith(join(HOME, 'escalations') + '/') && path.includes('.resolved-');
    expect({ path, allowed: inSupervisorDir || isNeedsOwner || isEscalationRename }).toEqual({ path, allowed: true });
  }
}

const RULING_CONTENT = '## R1\n\nratified-as: operational\n';

function escalationFile(reason: string): string {
  return `**Reason:** ${reason}\n\n## Context\nSomething needs a call.\n`;
}

function reportEscalated(): Record<string, unknown> {
  return {
    run: { reason: 'escalations_pending', unratifiedRulings: [] },
    cards: { c1: { outcome: 'escalated', escalationFile: 'escalations/c1.md', question: 'q', autoAnswerRounds: 0 } },
    pending: [],
    stats: { shipped: 0, escalated: 1, blocked: 0, notReached: 0 },
  };
}

function reportShipped(): Record<string, unknown> {
  return {
    run: { reason: 'runner_done', unratifiedRulings: [] },
    cards: { c1: { outcome: 'shipped', pr: 1, mergeSha: 'abc' } },
    pending: [],
    stats: { shipped: 1, escalated: 0, blocked: 0, notReached: 0 },
  };
}

describe('runSupervisor — the happy path', () => {
  let seam: ReturnType<typeof fakeSeam>;
  let result: SupervisorTerminal;
  let stateAtRulingSpawnTime: string | undefined;

  beforeAll(async () => {
    seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('planning_needed'),
        [join(HOME, 'campaign-state.json')]: JSON.stringify({ ownerOnlyEscalations: [] }),
      },
      watchdogRuns: [
        { reason: 'escalations_pending', exitCode: 12, report: reportEscalated() },
        { reason: 'runner_done', exitCode: 0, report: reportShipped() },
      ],
      sessions: [
        {
          effect: () => {
            // Snapshot state.json at the exact moment the ruling session is "spawned" (this
            // effect runs while `spawnSession` is being consumed) — proves S-P6's ordering.
            stateAtRulingSpawnTime = seam.files.get(join(HOME, 'supervisor', 'state.json'));
            seam.files.set(join(HOME, 'answers.md'), RULING_CONTENT);
          },
        },
        { effect: () => { seam.files.set(join(HOME, 'supervisor', 'final-report.md'), '# Final Report\n\nShipped c1.\n'); } },
      ],
    });
    result = await runSupervisor(baseConfig(), HOME, seam.io);
  });

  test('reaches exit 0, done, campaign_closed', () => {
    expect(result).toEqual({
      exitCode: 0, kind: 'done', reason: 'campaign_closed', statusPath: join(HOME, 'supervisor', 'status.json'),
    });
  });

  test('every effect (spawn/rename) is immediately preceded by an events.jsonl record', () => {
    expect(seam.callLog.length).toBeGreaterThan(0);
    for (let i = 0; i < seam.callLog.length; i++) {
      if (seam.callLog[i] === 'effect') {
        expect(seam.callLog[i - 1]).toBe('events');
      }
    }
  });

  test('events.jsonl records every action kind the happy path takes, in order', () => {
    const lines = (seam.files.get(join(HOME, 'supervisor', 'events.jsonl')) ?? '').trim().split('\n');
    const kinds = lines.map((l) => (JSON.parse(l) as { action: string }).action);
    expect(kinds).toEqual([
      'run_watchdog', 'await_watchdog',
      'spawn_session', 'archive_escalation',
      'run_watchdog', 'await_watchdog',
      'spawn_session', 'exit',
    ]);
  });

  test('the ruling round for c1 is already durable on disk before the ruling session spawns', () => {
    expect(stateAtRulingSpawnTime).toBeDefined();
    const parsed = JSON.parse(stateAtRulingSpawnTime as string) as { rulingRounds: Record<string, number> };
    expect(parsed.rulingRounds['c1']).toBe(1);
  });

  test('the escalation file is archived with the landed ruling id', () => {
    expect(seam.files.has(join(HOME, 'escalations', 'c1.md'))).toBe(false);
    expect(seam.files.get(join(HOME, 'escalations', 'c1.md.resolved-R1'))).toBeDefined();
  });

  test('status.json is published within the first tick, terminal null', () => {
    expect(seam.statusHistory.length).toBeGreaterThan(1);
    const first = JSON.parse(seam.statusHistory[0] as string) as { terminal: unknown; state: string };
    expect(first.terminal).toBeNull();
    expect(first.state).toBe('observing');
  });

  test('the write surface touched by the whole run is exactly S-P5\'s three locations', () => {
    assertWriteSurface(seam.writes);
  });

  test('answers.md and campaign-state.json are never written by the supervisor', () => {
    expect(seam.writes).not.toContain(join(HOME, 'answers.md'));
    expect(seam.writes).not.toContain(join(HOME, 'campaign-state.json'));
    expect(seam.writes.some((w) => w.startsWith(join(HOME, 'watchdog')))).toBe(false);
    expect(seam.writes.some((w) => w.startsWith(join(HOME, 'runs')))).toBe(false);
  });
});

describe('runSupervisor — STOP file honoured immediately', () => {
  test('exits done/stop_requested with no watchdog ever spawned', async () => {
    const seam = fakeSeam({ initialFiles: { [join(HOME, 'STOP')]: '' } });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result).toEqual({
      exitCode: 0, kind: 'done', reason: 'stop_requested', statusPath: join(HOME, 'supervisor', 'status.json'),
    });
    expect(seam.writes.some((w) => w.includes('watchdog-stdout'))).toBe(false);
  });
});

describe('runSupervisor — a live foreign supervisor refuses (P1, exit 21)', () => {
  test('never writes anything — a second supervisor never starts', async () => {
    const seam = fakeSeam({
      initialFiles: { [join(HOME, 'supervisor', '.supervisor.lock')]: JSON.stringify({ pid: 4242 }) },
    });
    // pid 4242 was never added to `deadPids`, so `isProcessAlive` reports it alive.
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result).toEqual({
      exitCode: 21, kind: 'already_running',
      reason: 'a live supervisor (pid 4242) already holds this campaign\'s lock',
      statusPath: null,
    });
    expect(seam.writes).toEqual([]);
  });
});

describe('runSupervisor — an owner-only escalation parks (exit 20)', () => {
  test('writes NEEDS_OWNER.md and never spawns a ruling session', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('data_shape_change'),
        [join(HOME, 'campaign-state.json')]: JSON.stringify({ ownerOnlyEscalations: ['data_shape_change'] }),
      },
      watchdogRuns: [{ reason: 'escalations_pending', exitCode: 12, report: reportEscalated() }],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result.exitCode).toBe(20);
    expect(result.kind).toBe('needs_owner');
    const needsOwner = seam.files.get(join(HOME, 'NEEDS_OWNER.md'));
    expect(needsOwner).toBeDefined();
    expect(needsOwner as string).toContain('owner_only');
    assertWriteSurface(seam.writes);
  });
});

describe('runSupervisor — a failed ruling retries exactly once, then parks (exit 20)', () => {
  test('two spawn_session attempts, then ruling_failed', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('planning_needed'),
        [join(HOME, 'campaign-state.json')]: JSON.stringify({ ownerOnlyEscalations: [] }),
      },
      watchdogRuns: [{ reason: 'escalations_pending', exitCode: 12, report: reportEscalated() }],
      // Neither scripted session touches answers.md — every attempt fails its postcondition.
      sessions: [{}, {}],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result).toEqual({
      exitCode: 20, kind: 'needs_owner', reason: 'ruling_failed',
      statusPath: join(HOME, 'supervisor', 'status.json'),
    });
    const events = (seam.files.get(join(HOME, 'supervisor', 'events.jsonl')) ?? '').trim().split('\n');
    const spawnCount = events.filter((l) => (JSON.parse(l) as { action: string }).action === 'spawn_session').length;
    expect(spawnCount).toBe(2);
    const needsOwner = seam.files.get(join(HOME, 'NEEDS_OWNER.md')) as string;
    expect(needsOwner).toContain('ruling_failed');
  });
});
