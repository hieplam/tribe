// Tests for loop.ts (Task 14, spec §4.2): the observe -> decide -> record-intent -> perform ->
// persist -> publish tick, driven end to end through a FULLY SCRIPTED fake `SupervisorLoopSeam`
// — no real fs, no real spawn, no real SDK. Every fixture lives under a throwaway, never-real
// `HOME` string; nothing here touches `~/.tribe/-Users-hip-repo-tribe/campaigns/`.
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOneShotPrompt, extractRulingBlockVerbatim, observe, parseCampaignReportFacts,
  readGapGateOpenIds, readParkedTerminal, runSupervisor, supervisorPathsOf,
  type SupervisorLoopConfig, type SupervisorLoopSeam, type SupervisorTerminal,
} from './loop.ts';
import { CLOSING_TEMPLATE_PATH, RATIFY_TEMPLATE_PATH, RULING_TEMPLATE_PATH } from './brief.ts';
import { zeroState } from './state.ts';
import type { OneShotSessionOptions, OneShotSpawnParams } from './session.ts';
import type { SessionMessage } from '../session.ts';
import type { WatchdogHandle } from '../../ports/ports.ts';
import type { SupervisorLimits, SupervisorState } from './model.ts';

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
  /** The run this terminal is ABOUT — `watchdog/status.json`'s own `runId` field, which a REAL
   * watchdog always publishes alongside its terminal (`fixtures-mirror-reality.md`). Left
   * `undefined` by every scenario that does not read it; set when a test needs the published
   * terminal to stay attributable to a specific run in `runs/` (Task 8's stale-terminal
   * retrigger). */
  runId?: string;
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
            pid,
            ...(run.runId === undefined ? {} : { runId: run.runId }),
            terminal: { status: 'terminal', reason: run.reason, exitCode: run.exitCode },
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
    // Task 8 (spec §2.2): superseding a falsified park RENAMES the park document — never
    // deletes it — so the audit trail survives. The marker is the same document under its
    // archived name, so it is the same S-P5 surface entry, not a new one.
    const isNeedsOwnerSuperseded = path.startsWith(join(HOME, 'NEEDS_OWNER.md') + '.superseded-');
    const isEscalationRename = path.startsWith(join(HOME, 'escalations') + '/') && path.includes('.resolved-');
    expect({
      path,
      allowed: inSupervisorDir || isNeedsOwner || isNeedsOwnerSuperseded || isEscalationRename,
    }).toEqual({ path, allowed: true });
  }
}

const RULING_CONTENT = '## R1\n\nratified-as: operational\n';

function escalationFile(reason: string): string {
  return `**Reason:** ${reason}\n\n## Context\nSomething needs a call.\n`;
}

/** A schema-VALID `campaign-state.json` fixture (Task 16): `core/state.ts`'s `CampaignStateSchema`
 * declares every one of these top-level fields with no `.optional()`, so a real campaign-state.json
 * always carries all of them. Every fixture in this file used to write only `{ ownerOnlyEscalations
 * }` — the convenient shape, not the real one (`fixtures-mirror-reality.md`) — which happened to
 * work against the old per-field readers but would silently read as "absent" against a
 * schema-checked one. */
function campaignStateFixture(ownerOnlyEscalations: string[] = [], cards: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1, campaign: 'c', mergePolicy: 'merge', sequence: [], schemaLockPaths: [], docsOnlyPaths: [],
    ownerOnlyEscalations, cards,
  });
}

/** A schema-valid `cards.<id>` entry (`core/state.ts`'s `CardSchema`) — every field below is
 * required (but nullable) at the schema level. */
function cardFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'escalated', spec: null, plan: null, branch: null, baseSha: null,
    pr: null, mergeSha: null, sessionId: null, updatedAt: null, ...overrides,
  };
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
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(),
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
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(['data_shape_change']),
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

describe('runSupervisor — Task 16 (spec §5(c)): campaign-state.json is read through its own '
  + 'schema, WHOLE-document, never per-field', () => {
  test('a non-string entry in ownerOnlyEscalations rejects the WHOLE document — a card\'s '
    + 'otherwise-valid spec/plan become unavailable too, and the escalation reason that a '
    + 'per-field reader would still have matched no longer parks owner-only', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('data_shape_change'),
        [join(HOME, 'campaign-state.json')]: JSON.stringify({
          v: 1, campaign: 'c', mergePolicy: 'merge', sequence: [], schemaLockPaths: [], docsOnlyPaths: [],
          // A per-field reader would `.filter(isString)` this down to ['data_shape_change'] and
          // still park owner-only. A whole-document schema read must refuse the array — and
          // therefore the whole document — instead.
          ownerOnlyEscalations: ['data_shape_change', 42],
          cards: { c1: cardFixture({ spec: 'docs/spec-c1.md', plan: 'docs/plan-c1.md' }) },
        }),
      },
      watchdogRuns: [
        { reason: 'escalations_pending', exitCode: 12, report: reportEscalated() },
        { reason: 'runner_done', exitCode: 0, report: reportShipped() },
      ],
      sessions: [
        { effect: () => { seam.files.set(join(HOME, 'answers.md'), RULING_CONTENT); } },
        { effect: () => {
          seam.files.set(join(HOME, 'supervisor', 'final-report.md'), '# Final Report\n\nShipped c1.\n');
          seam.files.set(join(HOME, 'supervisor', 'verdicts', 'c1.json'), '{"card":"c1","verdict":"PASS"}\n');
        } },
      ],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    // Never parked owner-only — the malformed document reads as absent, never a half-accepted
    // ownerOnlyEscalations list.
    expect(result.kind).toBe('done');

    // The card's otherwise-valid spec/plan are ALSO unavailable — proof the whole document was
    // rejected, not just the field that was actually malformed (`readCardSpecPlan` is poisoned
    // by the SAME parse failure `readOwnerOnlyEscalations` hit, because both now read one shared
    // schema-checked value).
    const rulingPrompt = seam.spawnedPrompts[0] as string;
    expect(rulingPrompt).toContain('- Spec: (missing)');
    expect(rulingPrompt).toContain('- Plan: (missing)');
    expect(rulingPrompt).not.toContain('docs/spec-c1.md');
  });

  test('a non-string cards.<id>.spec rejects the WHOLE document — a perfectly valid '
    + 'ownerOnlyEscalations entry that would otherwise match this escalation\'s reason no '
    + 'longer parks owner-only', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('data_shape_change'),
        [join(HOME, 'campaign-state.json')]: JSON.stringify({
          v: 1, campaign: 'c', mergePolicy: 'merge', sequence: [], schemaLockPaths: [], docsOnlyPaths: [],
          // This field alone is perfectly schema-valid and WOULD match the escalation's reason.
          ownerOnlyEscalations: ['data_shape_change'],
          // ...but this sibling field is not (`spec` must be `string | null`) — a per-field
          // reader wouldn't care, since it never looks at `cards` to decide ownerOnlyEscalations.
          cards: { c1: cardFixture({ spec: 42 }) },
        }),
      },
      watchdogRuns: [{ reason: 'escalations_pending', exitCode: 12, report: reportEscalated() }],
      // Neither scripted session touches answers.md — the ruling is attempted (never an
      // owner-only park) and then fails its postcondition twice, exactly like the clean
      // empty-ownerOnlyEscalations case in the next describe block.
      sessions: [{}, {}],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result.reason).toBe('ruling_failed');
    expect(result.reason).not.toBe('owner_only');
    expect(seam.spawnedPrompts.length).toBe(2);
  });
});

describe('runSupervisor — Task 16: campaign-state.json malformed/absent never throws, and '
  + 'reads as empty', () => {
  test('invalid JSON text is treated as absent — the tick loop never throws', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('data_shape_change'),
        [join(HOME, 'campaign-state.json')]: '{ this is not valid json',
      },
      watchdogRuns: [{ reason: 'escalations_pending', exitCode: 12, report: reportEscalated() }],
      sessions: [{}, {}],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result.reason).toBe('ruling_failed');
  });

  test('an absent campaign-state.json (never written) reads the same as an empty one', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('data_shape_change'),
        // No campaign-state.json entry at all.
      },
      watchdogRuns: [{ reason: 'escalations_pending', exitCode: 12, report: reportEscalated() }],
      sessions: [{}, {}],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result.reason).toBe('ruling_failed');
  });
});

describe('runSupervisor — a failed ruling retries exactly once, then parks (exit 20)', () => {
  test('two spawn_session attempts, then ruling_failed', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'escalations', 'c1.md')]: escalationFile('planning_needed'),
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(),
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
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(),
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
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(['data_shape_change']),
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
  } as unknown as Parameters<typeof buildOneShotPrompt>[2];

  // The closing branch consults only `observation.report.cards`' keys (one gap-gate lookup per
  // card id) — the rest of SupervisorObservation is irrelevant to this path.
  const closingObservation = {
    report: { cards: { c1: { outcome: 'shipped' } } },
  } as unknown as Parameters<typeof buildOneShotPrompt>[3];

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
      seam.io, HOME, closingPaths, closingObservation, closingAction, '',
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

/** A never-touched-yet `LoopState` — no in-flight watchdog spawn, no pending session verdict. */
function freshLoopState(
  priorParkedTerminal: { reason: string; atMs: number } | null = null,
): Parameters<typeof observe>[4] {
  return {
    watchdogHandle: null, watchdogOwnedExitCode: null, watchdogRunAttempt: 0,
    lastSessionOutcome: null, landedThisRun: [], priorParkedTerminal,
  };
}

/** Task 4 (spec §2.2, card `supervisor-park-truth`): `observe()` reads `<home>/runs/`,
 * `watchdog/status.json`'s own `runId`, and `supervisor/status.json`'s `terminal` (only when
 * `NEEDS_OWNER.md` is present) into three new typed fields. `decide()` is untouched by this
 * task, so these tests exercise `observe()` directly. */
describe('observe(): the runs directory as typed facts (Task 4, spec §2.2)', () => {
  const RUN_OLD = '2026-01-01T00-00-00-000Z-aaaa';
  const RUN_NEW = '2026-02-02T00-00-00-000Z-bbbb';
  const RUN_MALFORMED = '2026-03-03T00-00-00-000Z-cccc';

  function runsObservation(files: Record<string, string>) {
    const seam = fakeSeam({ initialFiles: files });
    const paths = supervisorPathsOf(HOME);
    // Task 8: the prior park is read by the EDGE once at startup — BEFORE this invocation's own
    // first `publish()` overwrites `status.json`'s `terminal` with `null` — and handed to
    // `observe()` through the loop state. This helper composes the two exactly as
    // `runSupervisor` does, so these Task 4 assertions still pin the same disk fact.
    return observe(
      baseConfig(), HOME, seam.io, paths,
      freshLoopState(readParkedTerminal(seam.io, paths.status)), zeroState(), null,
    );
  }

  test('a finished run (endedAt set) is dropped from `runs`, sorted ascending, and a malformed '
    + 'run.json is dropped entirely rather than throwing', () => {
    // Inserted UNSORTED (malformed first, then the newer run, then the older one) to prove
    // `observe()` sorts — a fixture that happened to already be in order would prove nothing.
    const o = runsObservation({
      [join(HOME, 'runs', RUN_MALFORMED, 'run.json')]: '{not json',
      [join(HOME, 'runs', RUN_NEW, 'run.json')]: JSON.stringify({
        pid: 5001, endedAt: null, exitCode: null, reason: null,
      }),
      // pid 4242 is never added to `deadPids`, so `isProcessAlive` would report it ALIVE — this
      // run must still read `alive: false` because `endedAt` is set (endedAt always wins).
      [join(HOME, 'runs', RUN_OLD, 'run.json')]: JSON.stringify({
        pid: 4242, endedAt: '2026-01-01T01:00:00.000Z', exitCode: 2, reason: 'escalations_pending',
      }),
    });

    expect(o.runs.map((r) => r.runId)).toEqual([RUN_OLD, RUN_NEW]);
    expect(o.runs[0]).toEqual({
      runId: RUN_OLD, pid: 4242, alive: false,
      endedAt: '2026-01-01T01:00:00.000Z', exitCode: 2, reason: 'escalations_pending',
    });
    expect(o.runs[1]).toEqual({
      runId: RUN_NEW, pid: 5001, alive: true, endedAt: null, exitCode: null, reason: null,
    });
  });

  test('an empty `runs/` directory reads as `[]`, never a throw', () => {
    const o = runsObservation({});
    expect(o.runs).toEqual([]);
  });

  test('`watchdogRunId` is read off `watchdog/status.json`\'s own `runId`', () => {
    const o = runsObservation({
      [join(HOME, 'watchdog', 'status.json')]: JSON.stringify({
        pid: 999, runId: RUN_NEW, terminal: { status: 'terminal', reason: 'stalled', exitCode: 10 },
      }),
    });
    expect(o.watchdogRunId).toBe(RUN_NEW);
  });

  test('`watchdogRunId` is `null` when `watchdog/status.json` is absent', () => {
    const o = runsObservation({});
    expect(o.watchdogRunId).toBeNull();
  });

  test('`parkedTerminal` is `null` when `NEEDS_OWNER.md` is absent, even with a terminal parked '
    + 'on `supervisor/status.json`', () => {
    const o = runsObservation({
      [join(HOME, 'supervisor', 'status.json')]: JSON.stringify({
        updatedAt: '2026-02-02T00:00:00.000Z',
        terminal: { status: 'needs_owner', reason: 'stalled', exitCode: 20 },
      }),
    });
    expect(o.parkedTerminal).toBeNull();
  });

  test('`parkedTerminal` reflects `supervisor/status.json`\'s terminal when `NEEDS_OWNER.md` is '
    + 'present', () => {
    const o = runsObservation({
      [join(HOME, 'NEEDS_OWNER.md')]: '# needs owner\n',
      [join(HOME, 'supervisor', 'status.json')]: JSON.stringify({
        updatedAt: '2026-02-02T00:00:00.000Z',
        terminal: { status: 'needs_owner', reason: 'stalled', exitCode: 20 },
      }),
    });
    expect(o.parkedTerminal).toEqual({ reason: 'stalled', atMs: Date.parse('2026-02-02T00:00:00.000Z') });
  });
});

// ---------------------------------------------------------------------------------------
// Task 8 (spec §2.2, card `supervisor-park-truth`): performing the supersede AT THE EDGE.
//
// ORACLE (the card's, verbatim): "Parking when the disk says the park is false = bug. Refusing
// to resume while a park is still TRUE = by design." Both directions are driven below through
// the REAL `runSupervisor` over the fake seam, from the RECORDED 2026-09-19 shape (spec §1.2):
// a watchdog terminal `stalled` about run A, while run B — newer — carried the campaign on.
// ---------------------------------------------------------------------------------------

const RUN_A = '2026-09-19T19-29-58-328Z-dcb2'; // the run the watchdog's stall is ABOUT
const RUN_B = '2026-09-19T20-30-30-069Z-6185'; // the NEWER run that really carried the campaign
const PARK_AT = '2026-09-19T20:30:30.010Z';    // when the PREVIOUS invocation parked

/** The park document a previous invocation left behind, and the `supervisor/status.json` it
 * published alongside it — the two artifacts a restart finds on disk. `runB` selects the
 * ORACLE's direction: `'alive'` means the disk has falsified the park (superseding is
 * mandatory), `null` means nothing contradicts it (refusing is BY DESIGN).
 *
 * A `STOP` file is seeded so the tick AFTER a supersede has an observable, terminating outcome:
 * reaching `exit(stop_requested)` is how "the loop CONTINUED — never exit 20" is proven. P2 is
 * evaluated before P3, so the STOP file can never pre-empt the park decision under test. */
function parkedSeam(
  runB: 'alive' | null,
  persistedState: Partial<SupervisorState> = {},
): ReturnType<typeof fakeSeam> {
  const initialFiles: Record<string, string> = {
    [join(HOME, 'STOP')]: '',
    // What the PREVIOUS invocation's own counters were when it parked. Defaults to the zero
    // state (which `parseState` also reads an ABSENT file as), so every existing caller is
    // unaffected; B-F3's churn probe below seeds a SPENT re-observation budget.
    [join(HOME, 'supervisor', 'state.json')]: JSON.stringify({ v: 1, ...zeroState(), ...persistedState }),
    [join(HOME, 'NEEDS_OWNER.md')]: '# Campaign needs the owner: c\n\n**Park reason:** stalled\n',
    [join(HOME, 'campaign-state.json')]: campaignStateFixture(),
    // What the PREVIOUS invocation published when it parked (spec §13's own shape, verbatim).
    [join(HOME, 'supervisor', 'status.json')]: JSON.stringify({
      v: 1, pid: 21744, home: HOME, campaign: 'c', startedAt: PARK_AT, updatedAt: PARK_AT,
      state: 'terminal', lastAction: 'park:stalled',
      watchdog: { pid: 999997, lastTerminalReason: 'stalled' }, currentSession: null,
      counters: { watchdogRuns: 1, spawns: 0, rulingRounds: {}, ratifyRounds: 0, failures: 0 },
      terminal: { status: 'needs_owner', reason: 'stalled', exitCode: 20 },
    }),
    [join(HOME, 'watchdog', 'status.json')]: JSON.stringify({
      v: 1, pid: 999997, runId: RUN_A,
      terminal: { status: 'needs_human', reason: 'stalled', exitCode: 10 },
    }),
    [join(HOME, 'runs', RUN_A, 'run.json')]: JSON.stringify({
      v: 1, runId: RUN_A, pid: 999999, startedAt: '2026-09-19T19:29:58.328Z',
      endedAt: null, exitCode: null, reason: null,
    }),
  };
  if (runB === 'alive') {
    initialFiles[join(HOME, 'runs', RUN_B, 'run.json')] = JSON.stringify({
      v: 1, runId: RUN_B, pid: 7777, startedAt: '2026-09-19T20:30:30.074Z',
      endedAt: null, exitCode: null, reason: null,
    });
  }
  // Run A's runner and the watchdog that reported on it are both long gone — the recorded shape.
  // Only run B's pid is alive, and only when this fixture says so.
  return fakeSeam({ initialFiles, initialDeadPids: [999997, 999999] });
}

function eventLines(seam: ReturnType<typeof fakeSeam>): Array<Record<string, unknown>> {
  const raw = seam.files.get(join(HOME, 'supervisor', 'events.jsonl')) ?? '';
  return raw.trim() === ''
    ? []
    : raw.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
}

function lastStatus(seam: ReturnType<typeof fakeSeam>): Record<string, any> {
  return JSON.parse(seam.statusHistory[seam.statusHistory.length - 1] as string) as Record<string, any>;
}

describe('runSupervisor — Task 8 (G3): a park the disk has already falsified is superseded, and '
  + 'the campaign continues', () => {
  let seam: ReturnType<typeof fakeSeam>;
  let result: SupervisorTerminal;

  beforeAll(async () => {
    seam = parkedSeam('alive');
    result = await runSupervisor(baseConfig(), HOME, seam.io);
  });

  test('the loop CONTINUES past the superseded park into a following tick — never exit 20', () => {
    expect(result).toEqual({
      exitCode: 0, kind: 'done', reason: 'stop_requested', statusPath: join(HOME, 'supervisor', 'status.json'),
    });
  });

  test('decide() sees the park a PREVIOUS run recorded: this invocation\'s own start publish '
    + 'must not erase status.json\'s `terminal` before the first observe() can read it', () => {
    // The recorded INTENT is decide()'s own verdict, written before the action is performed.
    // `park` here would mean `parkedTerminal` arrived as null — the defect this pins.
    expect(eventLines(seam).map((e) => e['action'])).toEqual(['supersede_park', 'park_superseded', 'exit']);
  });

  test('NEEDS_OWNER.md is RENAMED, never deleted — exactly one .superseded-<ts> marker, carrying '
    + 'the original document\'s bytes', () => {
    expect(seam.files.has(join(HOME, 'NEEDS_OWNER.md'))).toBe(false);
    const markers = [...seam.files.keys()].filter((k) => k.startsWith(`${join(HOME, 'NEEDS_OWNER.md')}.superseded-`));
    expect(markers.length).toBe(1);
    expect(seam.files.get(markers[0] as string)).toContain('**Park reason:** stalled');
  });

  test('a park_superseded event carries the prior park\'s reason and the superseding disk fact', () => {
    const event = eventLines(seam).find((e) => e['action'] === 'park_superseded');
    expect(event).toBeDefined();
    const detail = (event as Record<string, unknown>)['detail'] as Record<string, unknown>;
    expect(detail['priorReason']).toBe('stalled');
    expect(detail['supersededBy']).toEqual({ kind: 'newer_run_alive', runId: RUN_B });
  });

  test('the supersession is counted in the supervisor\'s OWN artifact (status.json counters)', () => {
    expect(lastStatus(seam)['counters']['staleTerminals']).toBe(1);
  });

  test('the write surface stays S-P5\'s — the marker is the park document itself, renamed', () => {
    assertWriteSurface(seam.writes);
  });
});

describe('runSupervisor — Task 8, the Oracle\'s OTHER direction: a park that is STILL TRUE is '
  + 'obeyed', () => {
  test('nothing on disk contradicts the terminal, so the supervisor refuses to resume (exit 20), '
    + 'leaves NEEDS_OWNER.md exactly where the owner must find it, and supersedes nothing', async () => {
    const seam = parkedSeam(null);
    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result.exitCode).toBe(20);
    expect(result.kind).toBe('needs_owner');
    expect(result.reason).toBe('resume_blocked');
    expect(seam.files.has(join(HOME, 'NEEDS_OWNER.md'))).toBe(true);
    expect([...seam.files.keys()].filter((k) => k.includes('.superseded-'))).toEqual([]);
    expect(eventLines(seam).map((e) => e['action'])).toEqual(['park']);
    expect(lastStatus(seam)['counters']['staleTerminals']).toBe(0);
  });
});

describe('runSupervisor — Task 8 (G2): the stale-terminal retrigger is CREDITED, so the second '
  + 'contradiction does not re-trigger', () => {
  test('a contradicted terminal re-runs the watchdog exactly ONCE; when the same contradiction '
    + 'is still there afterwards the one-shot bound is spent and the original park stands', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(),
        [join(HOME, 'watchdog', 'status.json')]: JSON.stringify({
          v: 1, pid: 999997, runId: RUN_A,
          terminal: { status: 'needs_human', reason: 'stalled', exitCode: 10 },
        }),
        [join(HOME, 'runs', RUN_A, 'run.json')]: JSON.stringify({
          v: 1, runId: RUN_A, pid: 999999, endedAt: null, exitCode: null, reason: null,
        }),
        [join(HOME, 'runs', RUN_B, 'run.json')]: JSON.stringify({
          v: 1, runId: RUN_B, pid: 7777, endedAt: null, exitCode: null, reason: null,
        }),
      },
      initialDeadPids: [999997, 999999],
      // The re-triggered child publishes the SAME stale terminal about the SAME run A — run B is
      // still alive, so the contradiction is still there on the tick after it exits. Exactly ONE
      // run is scripted: a second spawn is a test failure by construction (the seam refuses to
      // serve a run it was never given), which is precisely the un-credited-retrigger defect.
      watchdogRuns: [{ reason: 'stalled', exitCode: 10, runId: RUN_A }],
    });

    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    expect(result.exitCode).toBe(20);
    expect(result.reason).toBe('stalled');
    expect(seam.spawnWatchdogCalls).toBe(1);
    expect(eventLines(seam).map((e) => e['action'])).toEqual(['run_watchdog', 'await_watchdog', 'park']);
    const state = JSON.parse(seam.files.get(join(HOME, 'supervisor', 'state.json')) as string) as {
      retriggers: Record<string, number>;
    };
    expect(state.retriggers['stale_terminal']).toBe(1);
    // B-F2: the card requires G2's re-observation to be "counted in `counters`" (spec §2.2), and
    // `state.retriggers` is the PERSISTED budget, not the PUBLISHED counter. The assertions above
    // (spawn calls, events, retriggers) all passed while `supervisor/status.json`'s
    // `counters.staleTerminals` still read 0 — which is exactly why this shipped uncounted.
    expect(lastStatus(seam)['counters']['staleTerminals']).toBe(1);
  });
});

describe('runSupervisor — B-F3: a SPENT re-observation budget must not turn supersede into '
  + 'infinite churn', () => {
  test('with the one-shot stale_terminal retrigger already spent and the contradiction unchanged, '
    + 'the park is OBEYED — not superseded, then re-derived, then re-parked forever', async () => {
    const seam = parkedSeam('alive', { retriggers: { stale_terminal: 1 } });
    // No STOP file for this probe: the churn is only observable if the tick AFTER a supersede is
    // allowed to reach its own decision. With STOP present, `exit(stop_requested)` would pre-empt
    // the re-park and hide exactly the loop under test.
    seam.files.delete(join(HOME, 'STOP'));

    const result = await runSupervisor(baseConfig(), HOME, seam.io);

    // The Oracle's second half: the machine has exhausted its own remedies (the watchdog cannot be
    // re-triggered again), so a human genuinely is required and the park stands.
    expect(result.exitCode).toBe(20);
    expect(result.reason).toBe('resume_blocked');
    // The churn signature, all four parts absent: no archived park document, no park_superseded
    // event, no re-derived `stalled` park, and no watchdog spawned to justify any of it.
    expect([...seam.files.keys()].filter((k) => k.includes('.superseded-'))).toEqual([]);
    expect(eventLines(seam).map((e) => e['action'])).toEqual(['park']);
    expect(seam.files.has(join(HOME, 'NEEDS_OWNER.md'))).toBe(true);
    expect(seam.spawnWatchdogCalls).toBe(0);
    expect(lastStatus(seam)['counters']['staleTerminals']).toBe(0);
  });
});

describe('runSupervisor — B-F5: the stale-terminal budget is spent only by the decision that '
  + 'actually asked for the stale-terminal re-trigger', () => {
  test('V7 (a verified ratify) also returns run_watchdog; when a contradiction happens to be '
    + 'independently true on that same tick, the campaign\'s one-shot stale_terminal budget must '
    + 'NOT be consumed by it', async () => {
    const seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(),
        [join(HOME, 'answers.md')]: '## R1\n\nratified-as: pending\n\nSome earlier context.\n',
        // Run A: started, never finalised, pid long dead — INCONCLUSIVE, so nothing contradicts
        // the terminal on the tick that spawns the ratify session.
        [join(HOME, 'runs', RUN_A, 'run.json')]: JSON.stringify({
          v: 1, runId: RUN_A, pid: 999999, endedAt: null, exitCode: null, reason: null,
        }),
      },
      initialDeadPids: [999999],
      watchdogRuns: [
        // Run 1's terminal is about run A, so `watchdogRunId` is populated from here on.
        { reason: 'rulings_unratified', exitCode: 11, runId: RUN_A },
        // Run 2 is the watchdog V7 asks for; it carries no runId, so no contradiction can be
        // derived afterwards and the scenario terminates deterministically.
        { reason: 'stop_requested', exitCode: 0 },
      ],
      sessions: [
        {
          effect: () => {
            seam.files.set(join(HOME, 'answers.md'), '## R1\n\nratified-as: operational\n\nSome earlier context.\n');
            // While the ratify session ran, a NEWER run started and is alive — a contradiction
            // that is independently true and has nothing to do with V7's re-trigger.
            seam.files.set(join(HOME, 'runs', RUN_B, 'run.json'), JSON.stringify({
              v: 1, runId: RUN_B, pid: 7777, endedAt: null, exitCode: null, reason: null,
            }));
          },
        },
      ],
    });

    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result.reason).toBe('stop_requested');
    const kinds = eventLines(seam).map((e) => e['action']);
    // The second `run_watchdog` is V7's, produced by the post-session row — not the G2 row.
    expect(kinds).toEqual([
      'run_watchdog', 'await_watchdog', 'spawn_session', 'run_watchdog', 'await_watchdog', 'exit',
    ]);

    const state = JSON.parse(seam.files.get(join(HOME, 'supervisor', 'state.json')) as string) as {
      retriggers: Record<string, number>;
    };
    // The budget bounds ONE action: re-running the watchdog BECAUSE a newer run is alive. V7's
    // re-trigger is a different action for a different reason, so it may not spend it — nor may it
    // be counted as a stale-terminal re-observation.
    expect(state.retriggers['stale_terminal'] ?? 0).toBe(0);
    expect(lastStatus(seam)['counters']['staleTerminals']).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// F-F1: a REFUSAL to resume must not destroy the park's own recorded condition.
//
// Refusing to resume an existing park is not a NEW park about a NEW condition — it is a refusal
// to resume the existing one. `supervisor/status.json`'s `terminal.reason` is the only typed
// record of what the park was ABOUT (`parkedTerminal`, spec §2.2), and it is exactly what a
// later restart re-checks against the disk. Publishing the refusal's own `resume_blocked` over
// it destroyed that record: `resume_blocked` is not a runner-liveness claim, so `parkStillHolds`
// answered `true` for ever after and G3 could only ever fire when the FIRST restart already saw
// the contradiction.
//
// The recorded incident's own shape is the opposite: the owner restarts, it refuses, and only
// LATER does a newer run go live. This drives that sequence through the REAL `runSupervisor`
// three times over one persistent fake disk — park, refusal restart, contradiction appears,
// restart again — which is the sequence the single-restart probes above cannot reach.
// ---------------------------------------------------------------------------------------
describe('runSupervisor — F-F1: a contradiction that appears AFTER a refusal restart still '
  + 'supersedes the park', () => {
  let seam: ReturnType<typeof fakeSeam>;
  let parkRun: SupervisorTerminal;
  let refusalRun: SupervisorTerminal;
  let statusAfterRefusal: Record<string, any>;
  let supersedeRun: SupervisorTerminal;
  // Snapshots taken INSIDE `beforeAll`, at the moment each restart returns: one seam serves all
  // three invocations, so reading the live disk from a test body would read the END state and
  // silently attribute restart 3's writes to restart 2.
  let refusalEvents: Array<Record<string, unknown>> = [];
  let supersedeEvents: Array<Record<string, unknown>> = [];
  let needsOwnerAfterPark = false;
  let needsOwnerAfterRefusal = false;
  let markersAfterRefusal: string[] = [];

  beforeAll(async () => {
    // One seam, three invocations: the files map IS the campaign home, surviving each restart
    // exactly as a real one on disk does. `currentPid` is this process for all three, so the
    // supervisor lock is reclaimed as its own (`readForeignLock` ignores our own pid) rather
    // than refused — the same thing a real restart of a dead supervisor does.
    seam = fakeSeam({
      initialFiles: {
        [join(HOME, 'campaign-state.json')]: campaignStateFixture(),
        // Run A: started, never finalised, its pid long gone — INCONCLUSIVE, so nothing
        // contradicts the watchdog's terminal while restart 1 is deciding.
        [join(HOME, 'runs', RUN_A, 'run.json')]: JSON.stringify({
          v: 1, runId: RUN_A, pid: 999999, startedAt: '2026-09-19T19:29:58.328Z',
          endedAt: null, exitCode: null, reason: null,
        }),
      },
      initialDeadPids: [999999],
      watchdogRuns: [{ reason: 'stalled', exitCode: 10, runId: RUN_A }],
    });

    // Restart 1 — the campaign parks for real. The park is TRUE when it is written.
    parkRun = await runSupervisor(baseConfig(), HOME, seam.io);
    needsOwnerAfterPark = seam.files.has(join(HOME, 'NEEDS_OWNER.md'));
    const eventsBeforeRefusal = eventLines(seam).length;

    // Restart 2 — the owner restarts with the world UNCHANGED. The park still holds, so refusing
    // is BY DESIGN (the Oracle's second half). This is the invocation that destroyed the record.
    refusalRun = await runSupervisor(baseConfig(), HOME, seam.io);
    statusAfterRefusal = lastStatus(seam);
    refusalEvents = eventLines(seam).slice(eventsBeforeRefusal);
    needsOwnerAfterRefusal = seam.files.has(join(HOME, 'NEEDS_OWNER.md'));
    markersAfterRefusal = [...seam.files.keys()].filter((k) => k.includes('.superseded-'));

    // ONLY NOW does the world move on: the newer run B is alive, falsifying the park's stated
    // condition — the recorded incident's own ordering (spec §1.2).
    seam.files.set(join(HOME, 'runs', RUN_B, 'run.json'), JSON.stringify({
      v: 1, runId: RUN_B, pid: 7777, startedAt: '2026-09-19T20:30:30.074Z',
      endedAt: null, exitCode: null, reason: null,
    }));
    // Seeded here, never earlier: a STOP file gives the tick AFTER the supersede an observable,
    // terminating outcome, and P2 is evaluated before P3 so it can never pre-empt the decision
    // under test. Before restart 3 it would have short-circuited restarts 1 and 2 instead.
    seam.files.set(join(HOME, 'STOP'), '');
    const eventsBeforeSupersede = eventLines(seam).length;

    // Restart 3 — the contradiction appeared AFTER a refusal. The park must still be superseded.
    supersedeRun = await runSupervisor(baseConfig(), HOME, seam.io);
    supersedeEvents = eventLines(seam).slice(eventsBeforeSupersede);
  });

  test('restart 1 parks `stalled` — the precondition, and a park that is TRUE when written', () => {
    expect(parkRun.exitCode).toBe(20);
    expect(parkRun.reason).toBe('stalled');
    expect(needsOwnerAfterPark).toBe(true);
  });

  test('restart 2 refuses to resume: exit 20, a refusal recorded in events.jsonl, and '
    + 'NEEDS_OWNER.md left exactly where the owner must find it', () => {
    expect(refusalRun.exitCode).toBe(20);
    expect(refusalRun.reason).toBe('resume_blocked');
    expect(refusalEvents.map((e) => e['action'])).toEqual(['park']);
    // The recorded intent is decide()'s own verdict: a refusal (`resume_blocked`) that names the
    // condition it is refusing to resume, so events.jsonl carries the whole story too.
    expect(refusalEvents[0]?.['detail']).toEqual({
      kind: 'park', reason: 'resume_blocked', detail: expect.any(String), recordedReason: 'stalled',
    });
    expect(needsOwnerAfterRefusal).toBe(true);
    expect(markersAfterRefusal).toEqual([]);
  });

  test('the refusal leaves the park\'s ORIGINALLY recorded condition standing in status.json — '
    + 'a refusal is not a new park about a new condition', () => {
    expect(statusAfterRefusal['terminal'])
      .toEqual({ status: 'needs_owner', reason: 'stalled', exitCode: 20 });
  });

  test('restart 3 SUPERSEDES the park the disk has now falsified, and the campaign continues', () => {
    expect(supersedeEvents.map((e) => e['action']))
      .toEqual(['supersede_park', 'park_superseded', 'exit']);
    const event = supersedeEvents.find((e) => e['action'] === 'park_superseded') as Record<string, unknown>;
    const detail = event['detail'] as Record<string, unknown>;
    // The prior reason is the park's OWN condition — never the refusal that was layered over it.
    expect(detail['priorReason']).toBe('stalled');
    expect(detail['supersededBy']).toEqual({ kind: 'newer_run_alive', runId: RUN_B });
    expect(seam.files.has(join(HOME, 'NEEDS_OWNER.md'))).toBe(false);
    expect([...seam.files.keys()].filter((k) => k.startsWith(`${join(HOME, 'NEEDS_OWNER.md')}.superseded-`)).length)
      .toBe(1);
    expect(supersedeRun).toEqual({
      exitCode: 0, kind: 'done', reason: 'stop_requested', statusPath: join(HOME, 'supervisor', 'status.json'),
    });
  });

  test('the write surface stays S-P5\'s across all three restarts', () => {
    assertWriteSurface(seam.writes);
  });
});
