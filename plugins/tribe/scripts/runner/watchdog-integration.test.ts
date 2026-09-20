/**
 * Integration: the REAL edge (real fs, real processes, real sleeps, real pid probes) with only
 * the runner's IDENTITY swapped for the double. The pure core is already covered by table
 * tests; this proves the WIRING — the class of defect the runner README calls out ("Mocked
 * tests validate logic, not invocations").
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWatchdog } from './core/watchdog/watch-loop.ts';
import { buildWatchdogIo, withHome } from './adapters/watchdog-io.adapter.ts';
import type { WatchdogConfig } from './core/watchdog/model.ts';
import type { WatchdogIO } from './ports/ports.ts';

const DOUBLE = join(import.meta.dir, 'fixtures', 'watchdog', 'runner-double.sh');

interface Harness { home: string; statePath: string; io: WatchdogIO; lines: string[] }

function harness(plan: string, extraEnv: Record<string, string> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'wd-int-'));
  const home = join(root, '.tribe', 'k', 'campaigns', 'c');
  mkdirSync(home, { recursive: true });
  // A VALID minimal state (runner README "State file schema" — every required top-level key
  // present), even though only `fileExists` is consulted on this path: a fixture that could
  // not survive the real loader is a fixture that lies (fixtures-mirror-reality).
  writeFileSync(join(home, 'campaign-state.json'), JSON.stringify({
    v: 1, campaign: 'watchdog-int', mergePolicy: 'regular-merge-only', sequence: [],
    schemaLockPaths: [], docsOnlyPaths: [], ownerOnlyEscalations: [], cards: {},
  }));
  writeFileSync(join(home, 'answers.md'), '');
  const statePath = join(root, 'double-attempts');
  const lines: string[] = [];
  const base = buildWatchdogIo();
  const io: WatchdogIO = {
    ...withHome(base, home),
    printLine: (line) => { lines.push(line); },
    runnerCommand: () => ['bash', DOUBLE],
    spawnRunner: (argv, opts) => base.spawnRunner(argv, {
      ...opts,
      // The double is scripted by env; nothing about the watchdog's own argv changes.
      env: { ...process.env, DOUBLE_PLAN: plan, DOUBLE_STATE: statePath, ...extraEnv },
    } as Parameters<WatchdogIO['spawnRunner']>[1]),
  };
  return { home, statePath, io, lines };
}

const config = (over: Partial<WatchdogConfig> = {}): WatchdogConfig => ({
  repoRoot: process.cwd(), model: 'test-model', rawHome: 'x', mode: 'follow',
  stallMinutes: 30, maxQuotaWaits: 6, maxOverloadBackoffs: 5, maxCrashRelaunches: 1,
  quotaGraceSeconds: 1, pollSeconds: 1, fallbackModel: null, passthrough: [],
  ...over,
});

const events = (home: string) =>
  readFileSync(join(home, 'watchdog', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line) as { action: string; detail: Record<string, unknown> });
const status = (home: string) =>
  JSON.parse(readFileSync(join(home, 'watchdog', 'status.json'), 'utf8'));

describe('G1 — quota recovery without an LLM', () => {
  test('waits for the real reset instant, relaunches, and reaches done', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 3;
    const h = harness('3:quota 0:none', { DOUBLE_RESET_S: String(resetAt) });
    const started = Date.now();
    const outcome = await runWatchdog(config(), h.home, h.io);
    const finished = Date.now();

    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    // Audit round 2 (C7, commit 99dfa5f): the sequence gained two `attach` steps once the
    // fake/real adapter stopped fabricating run.json synchronously inside spawnRunner and the
    // loop was fixed to recognise the child it just launched instead of re-spawning it. Per
    // spec §2.1's frozen row — "Live runner (lock/pid alive) at start -> attach (wait on it;
    // never a second launch)" — the watchdog attaches to that just-launched child both after
    // `launch` and after `relaunch`. The brief's original expectation
    // (`['start','launch','wait_until','relaunch','exit']`) predates that fix; this is the
    // observed-correct sequence against the REAL adapter and a REAL child process.
    expect(events(h.home).map((e) => e.action).filter((a) => a !== 'wait_slice'))
      .toEqual(['start', 'launch', 'attach', 'wait_until', 'relaunch', 'attach', 'exit']);

    // Dead time after the reset is under the card's 60 s bar (grace 1 s + one 1 s slice here).
    expect(finished - (resetAt + 1) * 1000).toBeLessThan(60_000);
    expect(finished - started).toBeGreaterThanOrEqual(2_000);

    // No claude process is spawned by the watchdog itself: the double is the ONLY program it
    // ran, and status.json records exactly what that was.
    expect(status(h.home).runnerCommand.slice(0, 2)).toEqual(['bash', DOUBLE]);
    expect(readFileSync(h.statePath, 'utf8')).toBe('2');
  }, 60_000);

  test('the quota wait publishes nextWakeAt while it waits', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 3;
    const h = harness('3:quota 0:none', { DOUBLE_RESET_S: String(resetAt) });
    const seen: Array<string | null> = [];
    const spy: WatchdogIO = {
      ...h.io,
      writeFileAtomic: (p, c) => {
        h.io.writeFileAtomic(p, c);
        if (p.endsWith('status.json')) seen.push(JSON.parse(c).nextWakeAt);
      },
    };
    await runWatchdog(config(), h.home, spy);
    expect(seen.filter((v) => v !== null).length).toBeGreaterThan(0);
    expect(seen.filter((v) => v !== null)[0]).toBe(new Date((resetAt + 1) * 1000).toISOString());
  }, 60_000);
});

describe('G3 — every terminal state surfaces to the lead', () => {
  const cases: Array<[plan: string, exitCode: number, reason: string]> = [
    ['0:none', 0, 'runner_done'],
    ['2:none', 10, 'escalations_pending'],
    ['5:none', 10, 'rulings_unratified'],
    ['4:none', 10, 'error'],
    ['3:none 3:none', 10, 'session_incomplete'],
    ['3:overload 3:overload 3:overload 3:overload 3:overload 3:overload', 10, 'overloaded'],
  ];
  for (const [plan, exitCode, reason] of cases) {
    test(`plan "${plan}" ends ${exitCode}:${reason}`, async () => {
      const h = harness(plan);
      const outcome = await runWatchdog(
        config({ maxOverloadBackoffs: 2, quotaGraceSeconds: 1 }), h.home, h.io,
      );
      expect([outcome.exitCode, outcome.reason]).toEqual([exitCode, reason]);
      expect(status(h.home).terminal).toEqual({ status: outcome.status, reason, exitCode });
    }, 120_000);
  }

  test('--fallback-model relaunches once on the cheaper tier instead of parking', async () => {
    // FIX F-C1 (audit round, final): this plan is restored to the brief's ORIGINAL 4-entry
    // design (`'3:overload 3:overload 3:overload 0:none'`). It had been shortened to 2
    // entries as a workaround for the exact defect F-C1 fixes: an overload death used to never
    // relaunch at all, so ALL of `maxOverloadBackoffs`'s waits played out back-to-back against
    // the SAME still-overloaded run.json from the FIRST double process, with the fallback
    // relaunch the only second spawn ever made. Now each served backoff wait relaunches
    // immediately (`decide.ts`'s new `pendingWait`-served check), so reaching the cap
    // genuinely takes 3 separate `3:overload` double invocations — one per wait — before the
    // 3rd overload finally trips `maxOverloadBackoffs: 2` and relaunches on the fallback tier;
    // the 4th (final) entry is that fallback-tier invocation succeeding.
    const h = harness('3:overload 3:overload 3:overload 0:none');
    const outcome = await runWatchdog(
      config({ maxOverloadBackoffs: 2, fallbackModel: 'test-fallback' }), h.home, h.io,
    );
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    expect(status(h.home).counters.fallbackUsed).toBe(true);
    expect(status(h.home).runnerCommand).toContain('test-fallback');
  }, 120_000);
});

describe('G2 — skip when alive (D74-7 adopt, never duplicate)', () => {
  test('a --once tick against a live runner reports running and launches nothing', async () => {
    const h = harness('0:none:6');
    // Start a pass and leave it running: a --follow watchdog owns the child, so we launch the
    // double directly, exactly as the real runner would have been launched by hand.
    const base = buildWatchdogIo();
    const handle = base.spawnRunner(['bash', DOUBLE, '--home', h.home], {
      cwd: process.cwd(),
      stdoutPath: join(h.home, 'watchdog', 'manual.log'),
      env: { ...process.env, DOUBLE_PLAN: '0:none:6', DOUBLE_STATE: h.statePath },
    } as Parameters<WatchdogIO['spawnRunner']>[1]);

    // Wait for the in-flight run record to appear (poll — there is no `timeout` binary here).
    for (let i = 0; i < 100 && !existsSync(join(h.home, 'runs')); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    writeFileSync(join(h.home, '.runner.lock'), JSON.stringify({
      pid: handle.pid, startedAt: new Date().toISOString(),
    }));

    const outcome = await runWatchdog(config({ mode: 'once' }), h.home, h.io);
    expect([outcome.exitCode, outcome.reason]).toEqual([11, 'runner_alive']);
    expect(events(h.home).map((e) => e.action)).not.toContain('launch');
    expect(readFileSync(h.statePath, 'utf8')).toBe('1'); // the double ran exactly once
    expect(status(h.home).runnerPid).toBe(handle.pid);
    await handle.waitFor(30_000);
  }, 60_000);

  test('a --follow watchdog started while a runner is live adopts it instead of relaunching', async () => {
    const h = harness('0:none:4');
    const base = buildWatchdogIo();
    const handle = base.spawnRunner(['bash', DOUBLE, '--home', h.home], {
      cwd: process.cwd(),
      stdoutPath: join(h.home, 'watchdog', 'manual.log'),
      env: { ...process.env, DOUBLE_PLAN: '0:none:4', DOUBLE_STATE: h.statePath },
    } as Parameters<WatchdogIO['spawnRunner']>[1]);
    for (let i = 0; i < 100 && !existsSync(join(h.home, 'runs')); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    writeFileSync(join(h.home, '.runner.lock'), JSON.stringify({
      pid: handle.pid, startedAt: new Date().toISOString(),
    }));

    const outcome = await runWatchdog(config(), h.home, h.io);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const actions = events(h.home).map((e) => e.action);
    expect(actions).toContain('attach');
    expect(actions).not.toContain('launch');
    expect(readFileSync(h.statePath, 'utf8')).toBe('1');
  }, 60_000);
});

describe('G4 — stall detection from log mtime, never a kill', () => {
  test('a live runner whose newest log has not changed past the threshold parks for a human', async () => {
    // Deviation from the brief (reported to the Warchief): the brief's literal plan
    // '0:none:8' selects runner-double.sh's `none` fixture, which — unlike `quota`/`overload`
    // — writes NO session log at all (`none)     : ;;`), so `newestLogMtimeMs` stays `null`
    // for the run's whole life and `isStale()` (core/watchdog/select.ts) never fires BY DESIGN
    // ("a pass that has not written its first log is starting"). The stall wall can only be
    // exercised against a fixture that actually writes a log file to back-date. `overload` is
    // the double's other zero-config fixture (no DOUBLE_RESET_S substitution needed to make
    // sense), and its content is never even read for this decision — decide() checks
    // `o.run.alive` and the log's mtime alone, before it ever inspects quota/overload signals
    // (core/watchdog/decide.ts's stall branch runs before the exit-code switch).
    const h = harness('0:overload:8', { DOUBLE_STALE_S: String(45 * 60) });
    const outcome = await runWatchdog(config({ stallMinutes: 30 }), h.home, h.io);

    expect([outcome.exitCode, outcome.reason]).toEqual([10, 'stalled']);
    const stallEvent = events(h.home).find((e) => e.action === 'stall');
    expect(String(stallEvent?.detail.logPath)).toContain('/logs/i-card-0000-1.log');
    expect(typeof stallEvent?.detail.lastMtimeMs).toBe('number');

    const published = status(h.home);
    expect(published.stall.logPath).toContain('/logs/i-card-0000-1.log');
    expect(published.terminal).toEqual({ status: 'needs_human', reason: 'stalled', exitCode: 10 });

    // Never kills: the runner it left behind is still alive right after the watchdog exited.
    expect(buildWatchdogIo().isProcessAlive(published.runnerPid)).toBe(true);
  }, 60_000);

  test('a fresh log keeps the wait going — no false stall', async () => {
    const h = harness('0:none:3');
    const outcome = await runWatchdog(config({ stallMinutes: 30 }), h.home, h.io);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    expect(events(h.home).map((e) => e.action)).not.toContain('stall');
  }, 60_000);
});

describe('W-P9 — the watchdog writes nothing outside home/watchdog', () => {
  test('after a full quota-recovery run, the only new home paths are the runner_s own', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 2;
    const h = harness('3:quota 0:none', { DOUBLE_RESET_S: String(resetAt) });
    const written: string[] = [];
    const spy: WatchdogIO = {
      ...h.io,
      writeFileAtomic: (p, c) => { written.push(p); h.io.writeFileAtomic(p, c); },
      appendFile: (p, c) => { written.push(p); h.io.appendFile(p, c); },
    };
    await runWatchdog(config(), h.home, spy);
    expect(written.length).toBeGreaterThan(3);
    for (const path of written) {
      expect(path.startsWith(join(h.home, 'watchdog'))).toBe(true);
    }
    // And nothing the runner owns was touched by the watchdog: `harness()` pre-creates an
    // EMPTY answers.md as part of a valid minimal state (a file every real campaign home
    // already has), so "does not exist" can never hold here — the correct proof that the
    // watchdog never wrote to it is that its content is still the empty string it started as.
    expect(readFileSync(join(h.home, 'answers.md'), 'utf8')).toBe('');
    expect(JSON.parse(readFileSync(join(h.home, 'campaign-state.json'), 'utf8')).sequence)
      .toEqual([]);
  }, 60_000);
});

/** A finished previous run whose session log is `ageSeconds` old — the stale sibling directory
 * every recorded false stall was judged against. Written directly, never by the double, because
 * in the field it was left behind by an earlier watchdog invocation (or an earlier day). */
function seedStaleRun(home: string, runId: string, ageSeconds: number): void {
  const runDir = join(home, 'runs', runId);
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({
    v: 1, runId, pid: 999_999, startedAt: '2026-09-19T05:00:30.073Z',
    repo: '/repo', statePath: '', answersPath: '', escalationsDir: '', logsDir: '', argv: [],
    endedAt: '2026-09-19T05:05:50.000Z', exitCode: 0, reason: 'done',
  }));
  const logPath = join(runDir, 'logs', 'prev-card-prev-session.log');
  writeFileSync(logPath, '{"type":"assistant"}\n');
  const when = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(logPath, when, when);
}

const actionsOf = (home: string) =>
  events(home).map((e) => e.action).filter((a) => a !== 'wait_slice');

describe('D1/D2 — no launch path is judged on a run directory that predates its spawn', () => {
  test('R3 initial launch over a stale previous run directory', async () => {
    const h = harness('0:none', { DOUBLE_RUNDIR_DELAY_S: '2' });
    seedStaleRun(h.home, '2026-09-19T05-00-30-073Z-8df1', 7200);
    const outcome = await runWatchdog(config(), h.home, h.io);
    expect(actionsOf(h.home)).not.toContain('stall');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  }, 60_000);

  test('R1 quota relaunch over a stale previous run directory', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 3;
    const h = harness('3:quota 0:none', {
      DOUBLE_RESET_S: String(resetAt), DOUBLE_STALE_S: '7200', DOUBLE_RUNDIR_DELAY_S: '2',
    });
    const outcome = await runWatchdog(config(), h.home, h.io);
    const actions = actionsOf(h.home);
    expect(actions).not.toContain('stall');
    expect(actions).toContain('relaunch');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  }, 60_000);

  test('R2 a NON-quota relaunch over a stale previous run directory', async () => {
    // A 429 whose reset is already in the PAST is not a quota signal (decide.ts, W-P2) and 429
    // is deliberately not an overload status (signals.ts:37-38), so this exit-3 pass takes the
    // plain crash-relaunch path — the same defect on a non-quota cause (recorded twice as
    // `relaunch:crash`), with no extra fixture needed.
    const pastReset = Math.floor(Date.now() / 1000) - 3600;
    const h = harness('3:quota 0:none', {
      DOUBLE_RESET_S: String(pastReset), DOUBLE_STALE_S: '7200', DOUBLE_RUNDIR_DELAY_S: '2',
    });
    const outcome = await runWatchdog(config(), h.home, h.io);
    const actions = actionsOf(h.home);
    expect(actions).not.toContain('stall');
    const relaunch = events(h.home).find((e) => e.action === 'relaunch');
    expect(relaunch?.detail.cause).toBe('crash');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  }, 60_000);
});
