// Tests for loop.ts (Task 14, spec §4.2): the observe -> decide -> record-intent -> perform ->
// persist -> publish tick, driven end to end through a FULLY SCRIPTED fake `SupervisorLoopSeam`
// — no real fs, no real spawn, no real SDK. Every fixture lives under a throwaway, never-real
// `HOME` string; nothing here touches `~/.tribe/-Users-hip-repo-tribe/campaigns/`.
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOneShotPrompt, extractRulingBlockVerbatim, parseCampaignReportFacts, readGapGateOpenIds,
  runSupervisor,
  type SupervisorLoopConfig, type SupervisorLoopSeam, type SupervisorTerminal,
} from './loop.ts';
import { CLOSING_TEMPLATE_PATH, RATIFY_TEMPLATE_PATH, RULING_TEMPLATE_PATH } from './brief.ts';
import type { OneShotSessionOptions, OneShotSpawnParams } from './session.ts';
import type { SessionMessage } from '../session.ts';
import type { WatchdogHandle } from '../../ports/ports.ts';
import type { SupervisorLimits } from './model.ts';

const HOME = '/h/.tribe/k/campaigns/c';
const REPO = '/repo';

/** The REAL committed brief templates (Task 9), read off the actual filesystem once — a fake
 * seam that served its OWN stand-in template text would prove nothing about the real brief
 * rendering correctly (`fixtures-mirror-reality.md`). Every `fakeSeam` below serves these at
 * their real, absolute `*_TEMPLATE_PATH` so `renderBrief` sees exactly what a real spawn would. */
const REAL_TEMPLATES: Record<string, string> = {
  [RULING_TEMPLATE_PATH]: readFileSync(RULING_TEMPLATE_PATH, 'utf8'),
  [RATIFY_TEMPLATE_PATH]: readFileSync(RATIFY_TEMPLATE_PATH, 'utf8'),
  [CLOSING_TEMPLATE_PATH]: readFileSync(CLOSING_TEMPLATE_PATH, 'utf8'),
};

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
    sessionMaxTurns: 60,
    pollSeconds: 30,
    watchdogCommand: ['bun', '/abs/run.ts'],
    rerunCommand: 'bun run.ts supervise --repo /repo --campaign c --model claude-fixture',
    // R11 (Task 20): available by default — the ordinary case every OTHER test in this file
    // relies on, so it defaults to available here rather than forcing every existing
    // `runner_done` fixture to opt in (mirrors decide.test.ts's own `base()` default).
    verifyShippedPluginDir: '/abs/plugins/verify-shipped',
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
  /** Fix 1 regression harness ONLY (busy-spawn, skinner audit): bounds a deliberately-unfixed
   * `decide()`/`observe()` loop so a RED run against the pre-fix code terminates instead of
   * spinning forever. `spawnWatchdog` never writes `status.json` synchronously (a real child
   * does not — `fixtures-mirror-reality.md`); when this is set, the Nth spawn's status finally
   * appears on disk (mirroring the real child EVENTUALLY managing to publish), which is what
   * lets an un-fixed loop stop respawning after exactly N attempts instead of never. Left
   * `undefined` for every ordinary scenario — none of them need it against the FIXED loop.ts.
   */
  rescueWatchdogStatusAfterSpawns?: number;
  /** F1 (skinner audit): pids that `isProcessAlive` must report DEAD from the outset — lets a
   * test seed a genuinely-dead foreign lock so the reclaim path can be exercised. */
  initialDeadPids?: number[];
}) {
  const files = new Map<string, string>([...Object.entries(REAL_TEMPLATES), ...Object.entries(opts.initialFiles ?? {})]);
  const writes: string[] = []; // every writeFileAtomic/appendFile/renameIfPresent(to) target
  const createFileExclusiveCalls: string[] = []; // every createFileExclusive path, in order
  const callLog: string[] = []; // 'events' | 'effect', in order — proves step-4-before-step-5
  const statusHistory: string[] = []; // every status.json body, in publish order
  const deadPids = new Set<number>(opts.initialDeadPids ?? []);
  let nextPid = 5000;
  let nowMs = 1_800_000_000_000;
  const watchdogQueue = [...(opts.watchdogRuns ?? [])];
  const sessionQueue = [...(opts.sessions ?? [])];
  const spawnedPrompts: string[] = []; // one entry per spawnSession call, in order — the RENDERED brief
  const spawnedOptions: OneShotSessionOptions[] = []; // one entry per spawnSession call, in order
  let spawnWatchdogCalls = 0; // total spawnWatchdog invocations this seam has served
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
    // Honest mirror of the real adapter's O_EXCL create (`fixtures-mirror-reality.md`): creates
    // only when the path is absent, returns `true` then, `false` when it already exists. Recorded
    // in its OWN log (never `writes`) so a fresh atomic-create acquire stays distinguishable from
    // a `writeFileAtomic` reclaim.
    createFileExclusive: (p, content) => {
      createFileExclusiveCalls.push(p);
      if (files.has(p)) return false;
      files.set(p, content);
      return true;
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
      spawnWatchdogCalls += 1;
      // Fix 1 (skinner audit, `fixtures-mirror-reality.md`): a REAL watchdog child does NOT
      // write `status.json` synchronously inside the spawn call — it writes it later,
      // asynchronously, after it actually starts. This fake reproduces that shape: nothing is
      // written here. `status.json` only appears once `waitFor` below resolves (the loop's own
      // NEXT await), or — only for the dedicated Fix-1 regression test — once
      // `rescueWatchdogStatusAfterSpawns` spawns have happened (simulating the real child
      // eventually managing to publish, bounding what would otherwise be a genuinely infinite
      // busy-spawn loop against un-fixed code).
      if (opts.rescueWatchdogStatusAfterSpawns !== undefined && spawnWatchdogCalls >= opts.rescueWatchdogStatusAfterSpawns) {
        files.set(watchdogStatusPath, JSON.stringify({ pid, terminal: null }));
      }
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
      spawnedPrompts.push(params.prompt);
      spawnedOptions.push(params.options);
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
      return gen();
    },
    onSessionStart: () => {},
    appendLog: (p, line) => {
      files.set(p, `${files.get(p) ?? ''}${line}\n`);
      writes.push(p);
    },
  };

  return {
    io, files, writes, createFileExclusiveCalls, callLog, statusHistory, spawnedPrompts, spawnedOptions,
    get spawnWatchdogCalls(): number { return spawnWatchdogCalls; },
  };
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
        { effect: () => {
          // A real closing session writes final-report.md AND has verify-shipped write one
          // verdict file per shipped card (spec §4b, Task 10) — the postcondition reads the
          // verdict FILE, not the prose. c1 is the only shipped card in reportShipped().
          seam.files.set(join(HOME, 'supervisor', 'final-report.md'), '# Final Report\n\nShipped c1.\n');
          seam.files.set(join(HOME, 'supervisor', 'verdicts', 'c1.json'), '{"card":"c1","verdict":"PASS"}\n');
        } },
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

  test('the ruling session\'s prompt is the REAL rendered brief, not a placeholder — it carries '
    + 'the escalation content the loop already read off disk', () => {
    expect(seam.spawnedPrompts.length).toBeGreaterThan(0);
    const rulingPrompt = seam.spawnedPrompts[0] as string;
    expect(rulingPrompt).not.toContain('placeholder');
    expect(rulingPrompt).toContain('Something needs a call.'); // escalationFile('planning_needed')'s own body
    expect(rulingPrompt).toContain('c1');
  });

  test('the closing session\'s verdict is durably recorded (state.json closingVerified) before '
    + 'the process exits — carried out by the loop even though decide() now owns the V8 action', () => {
    const finalState = seam.files.get(join(HOME, 'supervisor', 'state.json'));
    expect(finalState).toBeDefined();
    const parsed = JSON.parse(finalState as string) as { closingVerified: boolean };
    expect(parsed.closingVerified).toBe(true);
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

describe('runSupervisor — F1 (skinner audit, spec §9): the lock is acquired by an atomic '
  + 'exclusive create, and a dead lock is still reclaimed', () => {
  const LOCK = join(HOME, 'supervisor', '.supervisor.lock');

  test('a fresh home (no lock) acquires via the exclusive-create primitive, NOT writeFileAtomic', async () => {
    // STOP present so the run terminates the moment after the lock is acquired — this test is
    // only about which primitive won the lock, not the tick loop.
    const seam = fakeSeam({ initialFiles: { [join(HOME, 'STOP')]: '' } });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result.exitCode).toBe(0); // acquired, then STOP exit
    expect(seam.createFileExclusiveCalls).toContain(LOCK); // the atomic create is what ran
    expect(seam.writes).not.toContain(LOCK); // the reclaim (writeFileAtomic) path was NOT taken
  });

  test('a LIVE foreign pid still refuses, exit 21 — the create loses and the live holder wins', async () => {
    const seam = fakeSeam({
      initialFiles: { [LOCK]: JSON.stringify({ pid: 4242 }) },
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result).toEqual({
      exitCode: 21, kind: 'already_running',
      reason: 'a live supervisor (pid 4242) already holds this campaign\'s lock',
      statusPath: null,
    });
    expect(seam.createFileExclusiveCalls).toContain(LOCK); // the atomic create was tried and lost
    expect(seam.writes).not.toContain(LOCK); // never reclaimed a live lock
  });

  test('a DEAD foreign pid is reclaimed via writeFileAtomic, and the run proceeds (acquires ok)', async () => {
    const seam = fakeSeam({
      initialFiles: { [LOCK]: JSON.stringify({ pid: 4242 }), [join(HOME, 'STOP')]: '' },
      initialDeadPids: [4242],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result.exitCode).toBe(0); // acquired (reclaimed a dead lock), then STOP exit — never refused
    expect(seam.createFileExclusiveCalls).toContain(LOCK); // the atomic create was tried (lost — the file existed)
    expect(seam.writes).toContain(LOCK); // the reclaim went through writeFileAtomic (O_EXCL alone cannot reclaim)
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

describe('runSupervisor — a verified ratify (V7) drives run_watchdog via decide(), never a '
  + 'loop-owned special case', () => {
  test('spawn_session(ratify) -> [outcome: ratified] -> run_watchdog, with the real brief '
    + 'carrying the unratified block\'s own verbatim text', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'answers.md')]: '## R1\n\nratified-as: pending\n\nSome earlier context.\n',
      },
      watchdogRuns: [
        { reason: 'rulings_unratified', exitCode: 11 },
        { reason: 'stop_requested', exitCode: 0 },
      ],
      sessions: [
        { effect: () => { seam.files.set(join(HOME, 'answers.md'), '## R1\n\nratified-as: operational\n\nSome earlier context.\n'); } },
      ],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result).toEqual({
      exitCode: 0, kind: 'done', reason: 'stop_requested', statusPath: join(HOME, 'supervisor', 'status.json'),
    });

    const events = (seam.files.get(join(HOME, 'supervisor', 'events.jsonl')) ?? '').trim().split('\n');
    const kinds = events.map((l) => (JSON.parse(l) as { action: string }).action);
    // The SECOND `run_watchdog` is V7's action, produced by decide() re-entered with
    // `lastSessionOutcome.outcome === 'ratified'` — not a branch this loop computes itself.
    expect(kinds).toEqual([
      'run_watchdog', 'await_watchdog', 'spawn_session', 'run_watchdog', 'await_watchdog', 'exit',
    ]);

    expect(seam.spawnedPrompts.length).toBe(1);
    const ratifyPrompt = seam.spawnedPrompts[0] as string;
    expect(ratifyPrompt).not.toContain('placeholder');
    // The unratified block's own verbatim text (heading + body), read off `answers.md` BEFORE
    // the session ran — proof the brief carries the real block, not a description of it.
    expect(ratifyPrompt).toContain('## R1');
    expect(ratifyPrompt).toContain('Some earlier context.');
  });
});

describe('runSupervisor — Fix 1 (Blocker, skinner audit): the busy-spawn guard', () => {
  test('spawnWatchdog is called exactly once for a single logical watchdog run, and the loop '
    + 'transitions to await_watchdog — even though status.json has not been published yet on '
    + 'the very next tick (a real child publishes it ASYNCHRONOUSLY, never synchronously inside '
    + 'the spawn call — fixtures-mirror-reality.md). `rescueWatchdogStatusAfterSpawns` bounds '
    + 'what would otherwise be a genuinely infinite busy-spawn loop against un-fixed code (a '
    + 'disk-only liveness check never sees a live child until this rescue write lands) — against '
    + 'the FIXED loop.ts the rescue never even matters, because the in-flight spawn handle this '
    + 'loop itself holds is recognised as live on the very next tick.', async () => {
    const seam = fakeSeam({
      watchdogRuns: [{ reason: 'stop_requested', exitCode: 0 }],
      rescueWatchdogStatusAfterSpawns: 3,
    });

    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result).toEqual({
      exitCode: 0, kind: 'done', reason: 'stop_requested', statusPath: join(HOME, 'supervisor', 'status.json'),
    });
    // The defect: `observe()` read `watchdogLive` from disk ONLY, so the tick immediately after
    // a spawn (before a real child has had a chance to publish `status.json`) saw `null` and
    // `decide()`'s row 27 (`lastWatchdog === null`) re-issued `run_watchdog` — a SECOND (then
    // THIRD, ...) spawn, while the first child was already alive and in flight the whole time.
    expect(seam.spawnWatchdogCalls).toBe(1);
    const events = (seam.files.get(join(HOME, 'supervisor', 'events.jsonl')) ?? '').trim().split('\n');
    const kinds = events.map((l) => (JSON.parse(l) as { action: string }).action);
    expect(kinds).toEqual(['run_watchdog', 'await_watchdog', 'exit']);
  });
});

describe('runSupervisor — Fix 2 (skinner audit): sessionMaxTurns reaches buildOneShotOptions', () => {
  test('the configured --session-max-turns value flows into every one-shot session actually spawned', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('planning_needed'),
        [join(HOME, 'campaign-state.json')]: JSON.stringify({ ownerOnlyEscalations: [] }),
      },
      watchdogRuns: [
        { reason: 'escalations_pending', exitCode: 12, report: reportEscalated() },
        { reason: 'runner_done', exitCode: 0, report: reportShipped() },
      ],
      sessions: [
        { effect: () => { seam.files.set(join(HOME, 'answers.md'), RULING_CONTENT); } },
        { effect: () => {
          // A real closing session writes final-report.md AND has verify-shipped write one
          // verdict file per shipped card (spec §4b, Task 10) — the postcondition reads the
          // verdict FILE, not the prose. c1 is the only shipped card in reportShipped().
          seam.files.set(join(HOME, 'supervisor', 'final-report.md'), '# Final Report\n\nShipped c1.\n');
          seam.files.set(join(HOME, 'supervisor', 'verdicts', 'c1.json'), '{"card":"c1","verdict":"PASS"}\n');
        } },
      ],
    });
    const result = await runSupervisor(baseConfig({ sessionMaxTurns: 17 }), HOME, seam.io);

    expect(result.kind).toBe('done');
    expect(seam.spawnedOptions.length).toBe(2); // ruling, then closing
    for (const options of seam.spawnedOptions) {
      expect(options.maxTurns).toBe(17);
    }
  });
});

describe('runSupervisor — Fix 3 (skinner audit): status.json carries the watchdog\'s own last '
  + 'terminal reason', () => {
  test('after a watchdog run reports a terminal reason, the next published status.json is not '
    + 'left with lastTerminalReason: null', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('data_shape_change'),
        [join(HOME, 'campaign-state.json')]: JSON.stringify({ ownerOnlyEscalations: ['data_shape_change'] }),
      },
      watchdogRuns: [{ reason: 'escalations_pending', exitCode: 12, report: reportEscalated() }],
    });
    await runSupervisor(baseConfig(), HOME, seam.io);

    const last = JSON.parse(seam.statusHistory[seam.statusHistory.length - 1] as string) as {
      watchdog: { lastTerminalReason: string | null };
    };
    expect(last.watchdog.lastTerminalReason).toBe('escalations_pending');
  });
});

describe('runSupervisor — R11 (Task 20, spec §5.4 item 4): verifyShippedPluginDir threads into '
  + 'observe() and the closing one-shot config', () => {
  test('a configured verifyShippedPluginDir flows through observe() as available=true and into '
    + 'the closing spawn\'s own OneShotSessionOptions.plugins', async () => {
    const seam = fakeSeam({
      watchdogRuns: [{ reason: 'runner_done', exitCode: 0, report: reportShipped() }],
      sessions: [
        { effect: () => {
          // A real closing session writes final-report.md AND has verify-shipped write one
          // verdict file per shipped card (spec §4b, Task 10) — the postcondition reads the
          // verdict FILE, not the prose. c1 is the only shipped card in reportShipped().
          seam.files.set(join(HOME, 'supervisor', 'final-report.md'), '# Final Report\n\nShipped c1.\n');
          seam.files.set(join(HOME, 'supervisor', 'verdicts', 'c1.json'), '{"card":"c1","verdict":"PASS"}\n');
        } },
      ],
    });
    const result = await runSupervisor(
      baseConfig({ verifyShippedPluginDir: '/abs/plugins/verify-shipped' }), HOME, seam.io,
    );

    expect(result.kind).toBe('done');
    expect(seam.spawnedOptions.length).toBe(1); // closing only — no escalation, nothing to ratify
    expect(seam.spawnedOptions[0]?.plugins).toEqual([{ type: 'local', path: '/abs/plugins/verify-shipped' }]);
  });

  test('verifyShippedPluginDir: null flows through observe() as available=false — the closing '
    + 'spawn never happens, and decide()\'s R11 guard parks closing_failed instead (exit 20)', async () => {
    const seam = fakeSeam({
      watchdogRuns: [{ reason: 'runner_done', exitCode: 0, report: reportShipped() }],
    });
    const result = await runSupervisor(baseConfig({ verifyShippedPluginDir: null }), HOME, seam.io);

    expect(result).toEqual({
      exitCode: 20, kind: 'needs_owner', reason: 'closing_failed',
      statusPath: join(HOME, 'supervisor', 'status.json'),
    });
    expect(seam.spawnedOptions.length).toBe(0); // never spawned — decide() fails closed first
  });
});

describe('extractRulingBlockVerbatim — the ratify brief\'s verbatim-block extractor', () => {
  const answers = [
    '## R1 — first ruling',
    '',
    'ratified-as: operational',
    '',
    'Body of R1, with a blank line above.',
    '## R2 — second ruling',
    'ratified-as: pending',
    'Body of R2.',
    '',
  ].join('\n');

  test('returns the heading line through the line before the next heading, verbatim', () => {
    const block = extractRulingBlockVerbatim(answers, 'R1 — first ruling');
    expect(block).toBe([
      '## R1 — first ruling',
      '',
      'ratified-as: operational',
      '',
      'Body of R1, with a blank line above.',
    ].join('\n'));
  });

  test('the last block in the file runs through to EOF', () => {
    const block = extractRulingBlockVerbatim(answers, 'R2 — second ruling');
    expect(block).toBe([
      '## R2 — second ruling',
      'ratified-as: pending',
      'Body of R2.',
      '',
    ].join('\n'));
  });

  test('an id with no matching "## " heading fails closed to null, never a throw or a guess', () => {
    expect(extractRulingBlockVerbatim(answers, 'R99 — does not exist')).toBeNull();
    expect(extractRulingBlockVerbatim('', 'R1')).toBeNull();
  });
});

describe('G5 (spec §6): the closing brief reads gap-gate results from the CAMPAIGN home', () => {
  // The base tribe home the (now-removed) `io.resolveTribeHome` call would return — a DIFFERENT
  // directory than the campaign-nested `HOME`. The gate always writes under the campaign home
  // (its Tracker inputs live there), so a reader that follows `resolveTribeHome` looks in a place
  // the gate never wrote to. A decoy report is planted there to prove that path is NOT consulted:
  // one path, no silent fallback (over-checking by design — spec §6 fix item 1).
  const BASE_HOME = '/h/.tribe/k';
  const CAMPAIGN_OPEN_ID = 'HG-c1-from-campaign-home';
  const BASE_DECOY_OPEN_ID = 'HG-c1-from-BASE-home-decoy';

  // Only `.campaignReport`/`.finalReport`/`.verdictsDir` are read by the closing branch; built the
  // SAME way `supervisorPathsOf` builds them. `SupervisorPaths` is private to loop.ts, named here
  // via the exported `buildOneShotPrompt`'s own signature rather than by re-exporting the type.
  const closingPaths = {
    campaignReport: join(HOME, 'campaign-report.json'),
    finalReport: join(HOME, 'supervisor', 'final-report.md'),
    verdictsDir: join(HOME, 'supervisor', 'verdicts'),
  } as unknown as Parameters<typeof buildOneShotPrompt>[3];

  // The closing branch consults only `observation.report.cards`' keys (one gap-gate lookup per
  // card id) — the rest of SupervisorObservation is irrelevant to this path.
  const closingObservation = {
    report: { cards: { c1: { outcome: 'shipped' } } },
  } as unknown as Parameters<typeof buildOneShotPrompt>[4];

  const closingAction = { session: 'closing' as const, cardId: null };

  function seamWithSplitHomes() {
    const seam = fakeSeam({
      initialFiles: {
        // The real writer's location: the gate writes under the CAMPAIGN home's reports/.
        [join(HOME, 'reports', 'c1-gap-gate.json')]: JSON.stringify({ open_ids: [CAMPAIGN_OPEN_ID] }),
        // The decoy: a stale report under the BASE tribe home. If the reader follows
        // resolveTribeHome, it finds THIS instead — the exact defect.
        [join(BASE_HOME, 'reports', 'c1-gap-gate.json')]: JSON.stringify({ open_ids: [BASE_DECOY_OPEN_ID] }),
      },
    });
    // Force the base tribe home to differ from the campaign home — the campaign case, where the
    // defect manifests. (The default fakeSeam returns HOME, hiding the bug.)
    seam.io.resolveTribeHome = async () => ({ ok: true, home: BASE_HOME });
    return seam;
  }

  test('buildOneShotPrompt renders the closing brief with the CAMPAIGN-home report\'s open ids, '
    + 'never the base-home decoy (the real defect site: which home the reader is handed)', async () => {
    const seam = seamWithSplitHomes();
    const prompt = await buildOneShotPrompt(
      seam.io, baseConfig(), HOME, closingPaths, closingObservation, closingAction, '',
    );
    expect(prompt).toContain(CAMPAIGN_OPEN_ID);
    expect(prompt).not.toContain(BASE_DECOY_OPEN_ID);
  });

  test('readGapGateOpenIds reads under the home it is GIVEN — the campaign home\'s reports/', () => {
    const seam = seamWithSplitHomes();
    expect(readGapGateOpenIds(seam.io, HOME, 'c1')).toEqual([CAMPAIGN_OPEN_ID]);
    // A card with no report reads as zero open ids (fail-closed: never shipped, gate never ran).
    expect(readGapGateOpenIds(seam.io, HOME, 'no-such-card')).toEqual([]);
  });
});

describe('parseCampaignReportFacts — F2 (fail-closed-edges obligation 1): a malformed per-card '
  + 'entry is skipped, never a TypeError', () => {
  // A syntactically valid report whose `run.reason` is present (so the cards loop is reached) but
  // whose one card entry is `null` — the shape that made `entry['outcome']` throw
  // `TypeError: Cannot read properties of null` before the fix.
  test('a null card entry is skipped, not thrown on', () => {
    const raw = JSON.stringify({ run: { reason: 'x' }, cards: { c1: null } });
    const facts = parseCampaignReportFacts(raw);
    expect(facts).not.toBeNull();
    expect(Object.keys((facts as { cards: Record<string, unknown> }).cards)).not.toContain('c1');
  });

  test('a non-object card entry (a number) is skipped, not thrown on', () => {
    const raw = JSON.stringify({ run: { reason: 'x' }, cards: { c1: 42 } });
    const facts = parseCampaignReportFacts(raw);
    expect(facts).not.toBeNull();
    expect(Object.keys((facts as { cards: Record<string, unknown> }).cards)).not.toContain('c1');
  });

  test('a well-formed sibling entry still parses when a malformed entry sits beside it', () => {
    const raw = JSON.stringify({ run: { reason: 'x' }, cards: { bad: null, c2: { outcome: 'shipped' } } });
    const facts = parseCampaignReportFacts(raw);
    const cards = (facts as { cards: Record<string, { outcome: string }> }).cards;
    expect(Object.keys(cards)).toEqual(['c2']);
    expect(cards['c2']?.outcome).toBe('shipped');
  });
});
