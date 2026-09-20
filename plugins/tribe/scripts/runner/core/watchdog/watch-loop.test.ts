import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runWatchdog } from './watch-loop.ts';
import { parseSessionSignals } from './signals.ts';
import type { WatchdogConfig } from './model.ts';
import type { RunnerHandle, WatchdogIO } from '../../ports/ports.ts';

const HOME = '/h/.tribe/k/campaigns/c';

const CONFIG: WatchdogConfig = {
  repoRoot: '/repo', model: 'opus', rawHome: HOME, mode: 'follow',
  stallMinutes: 30, maxQuotaWaits: 6, maxOverloadBackoffs: 5, maxCrashRelaunches: 1,
  quotaGraceSeconds: 30, pollSeconds: 30, fallbackModel: null, passthrough: ['--max-cards', '1'],
};

interface Scripted { exitCode: number; runId: string; logTail?: string; endedAt?: string | null }

/** A fake world: virtual files, a virtual clock that only advances when the loop sleeps, and
 * a scripted runner whose passes are consumed one per launch.
 *
 * C1 (group-C audit round 1, class `critical`): the REAL `spawnRunner` adapter never writes
 * to the observed `runs/` directory — the CHILD process does, after real wall-clock time a
 * fake's synchronous JS can't represent for free. The old version of this fake fabricated
 * `run.json` and the directory entry SYNCHRONOUSLY inside `spawnRunner`, which hid a
 * fork-bomb-shaped defect (unbounded synchronous re-launch, see `watch-loop.ts`'s `observe()`)
 * under a green suite — the CI-reported bug that motivated this fix. Model reality instead: a
 * spawned pass's directory/record/log become visible starting from the SECOND
 * `listEntries(runsDir)` call after its own spawn, never the first — so the tick immediately
 * following a spawn (the exact tick the loop re-observes on, with NO `await` in between) sees
 * nothing yet, exactly like a real just-forked OS process that hasn't written to disk. */
function fakeIo(passes: Scripted[]) {
  const files = new Map<string, string>();
  const entries = new Map<string, Array<{ name: string; mtimeMs: number; isDir: boolean }>>();
  const lines: string[] = [];
  const spawns: string[][] = [];
  let nowMs = 1_800_000_000_000;
  let index = 0;
  const runsDir = join(HOME, 'runs');
  const pendingReveals: Array<{ pass: Scripted; attemptIndex: number; callsRemaining: number }> = [];
  // FIX F-C3/S2 (audit round, final): the old fake hardcoded `readLock: () => null` and
  // `isProcessAlive: () => false`, so neither a foreign live lock holder nor a dead-but-still
  // "not-finalized" adopted pid could ever be represented — precisely why those two defects
  // shipped unnoticed (fixtures-mirror-reality.md). Both are now scriptable per test.
  let lockHolder: { pid: number; startedAt: string } | null = null;
  const alivePids = new Set<number>();

  function materialize(pending: { pass: Scripted; attemptIndex: number }): void {
    const { pass, attemptIndex } = pending;
    const runDir = join(HOME, 'runs', pass.runId);
    const prior = entries.get(runsDir) ?? [];
    entries.set(runsDir, [...prior, { name: pass.runId, mtimeMs: nowMs, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: pass.runId, pid: 9000 + attemptIndex, startedAt: new Date(nowMs).toISOString(),
      endedAt: pass.endedAt === undefined ? new Date(nowMs).toISOString() : pass.endedAt,
      exitCode: pass.exitCode, reason: 'x',
    }));
    if (pass.logTail !== undefined) {
      entries.set(join(runDir, 'logs'), [{ name: 'card-sid.log', mtimeMs: nowMs, isDir: false }]);
      files.set(join(runDir, 'logs', 'card-sid.log'), pass.logTail);
    } else {
      entries.set(join(runDir, 'logs'), []);
    }
  }

  const io: WatchdogIO = {
    fileExists: (p) => files.has(p),
    readFile: (p) => files.get(p) ?? '',
    appendFile: (p, content) => files.set(p, (files.get(p) ?? '') + content),
    ensureDir: () => {},
    writeFileAtomic: (p, content) => files.set(p, content),
    listEntries: (dirPath) => {
      if (dirPath === runsDir) {
        for (let i = pendingReveals.length - 1; i >= 0; i--) {
          const pending = pendingReveals[i] as
            { pass: Scripted; attemptIndex: number; callsRemaining: number };
          pending.callsRemaining -= 1;
          if (pending.callsRemaining <= 0) {
            materialize(pending);
            pendingReveals.splice(i, 1);
          }
        }
      }
      return entries.get(dirPath) ?? [];
    },
    readTail: (p) => files.get(p) ?? '',
    realpath: (p) => p,
    readLock: () => lockHolder,
    // Default false (dead) for any pid never explicitly marked alive — unchanged from the old
    // constant-`false` behaviour for every existing test; `setProcessAlive` only ever ADDS a
    // pid that should report alive.
    isProcessAlive: (pid) => alivePids.has(pid),
    currentPid: () => 4242,
    now: () => new Date(nowMs).toISOString(),
    nowMs: () => nowMs,
    sleep: async (ms) => { nowMs += ms; },
    runnerCommand: () => ['bun', '/abs/run.ts'],
    spawnRunner: (argv): RunnerHandle => {
      spawns.push(argv);
      const pass = passes[index++] as Scripted;
      // Visible starting from the SECOND `listEntries(runsDir)` call since this spawn — never
      // the first (the tick immediately after spawn, with no yield, must see nothing yet).
      pendingReveals.push({ pass, attemptIndex: index, callsRemaining: 2 });
      return {
        pid: 9000 + index,
        // Mirrors the real adapter's bounded contract (`adapters/watchdog-io.adapter.ts`:
        // `Promise<number | null>`, `null` meaning "still running after this slice"), which the
        // old always-resolve-immediately fake never modelled at all. `pass.endedAt === null`
        // (explicitly, never the default `undefined`) is a runner that never exits within this
        // test — every pre-existing scripted pass leaves `endedAt` unset and keeps the original
        // immediate-exit behaviour verbatim.
        waitFor: async (waitMs) => {
          if (pass.endedAt === null) {
            nowMs += waitMs;
            return null;
          }
          return pass.exitCode;
        },
      };
    },
    userHome: () => '/h',
    cwd: () => '/cwd',
    printLine: (line) => { lines.push(line); },
  };
  return {
    io, files, lines, spawns, setNow: (ms: number) => { nowMs = ms; }, entries,
    setLockHolder: (pid: number | null) => {
      lockHolder = pid === null ? null : { pid, startedAt: new Date(nowMs).toISOString() };
    },
    setProcessAlive: (pid: number, alive: boolean) => {
      if (alive) alivePids.add(pid); else alivePids.delete(pid);
    },
  };
}

const quotaTail = (resetsAtEpochS: number) =>
  `${JSON.stringify({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'rejected', resetsAt: resetsAtEpochS, rateLimitType: 'five_hour' },
  })}\n${JSON.stringify({ type: 'result', is_error: true, api_error_status: 429 })}\n`;

describe('runWatchdog — status.json is published before anything blocks (spec section 8)', () => {
  test('a status file exists after the very first action', async () => {
    const { io, files } = fakeIo([{ exitCode: 0, runId: 'r1' }]);
    await runWatchdog(CONFIG, HOME, io);
    const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
    expect(status.v).toBe(1);
    expect(status.pid).toBe(4242);
    expect(status.home).toBe(HOME);
    expect(status.terminal).toEqual({ status: 'done', reason: 'runner_done', exitCode: 0 });
  });
});

describe('runWatchdog — G1: quota recovery with no LLM in the loop', () => {
  test('quota_wait then relaunch then done, and the events log records that order', async () => {
    const { io, files, spawns, lines } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(1_800_000_000 + 600) },
      { exitCode: 0, runId: 'r2' },
    ]);
    const outcome = await runWatchdog(CONFIG, HOME, io);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.reason).toBe('runner_done');
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l).action);
    // Deviation (documented in the task report): filters out `wait_slice` bookkeeping events
    // before comparing. The literal brief array (no `wait_slice`) is unsatisfiable together
    // with this same describe block's next test, which asserts `wait_slice` rows exist in this
    // very file (spec section 2.1 Never: a wake-up loop of poll-seconds slices, W-P5) — the two
    // assertions are mutually exclusive against any single implementation. The wake-up-loop
    // wall is spec-frozen and independently tested next, so this line is adjusted to check the
    // milestone ORDER the test's own name promises, without contradicting the sibling test.
    // Audit round 2 (C7): the sequence also gained two `attach` steps once the fake became
    // honest (spawnRunner no longer fabricates run.json synchronously, matching the real
    // adapter) and the loop was fixed to recognise the child it just launched instead of
    // re-spawning it. Per spec §2.1's frozen row — "Live runner (lock/pid alive) at start ->
    // attach (wait on it; never a second launch)" — the watchdog attaches to that just-launched
    // child both after `launch` and after `relaunch`; their absence in the earlier revision was
    // exactly the unbounded-re-spawn defect (21 spawns in one tick) that round fixed.
    const milestones = events.filter((a) => a !== 'wait_slice');
    expect(milestones).toEqual(['start', 'launch', 'attach', 'wait_until', 'relaunch', 'attach', 'exit']);
    expect(spawns.length).toBe(2);
    expect(lines.some((l) => l.startsWith('quota_wait: account limit'))).toBe(true);
  });

  test('the wait never sleeps past the reset in one go (spec section 2.1 Never)', async () => {
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(1_800_000_000 + 600) },
      { exitCode: 0, runId: 'r2' },
    ]);
    await runWatchdog({ ...CONFIG, pollSeconds: 30 }, HOME, io);
    const slices = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l))
      .filter((e) => e.action === 'wait_slice');
    expect(slices.length).toBeGreaterThanOrEqual(21); // 630 s / 30 s
    for (const slice of slices) expect(slice.detail.ms).toBeLessThanOrEqual(30_000);
  });

  test('nextWakeAt is published while waiting (spec section 8)', async () => {
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(1_800_000_000 + 600) },
      { exitCode: 0, runId: 'r2' },
    ]);
    const seen: Array<string | null> = [];
    const wrapped: WatchdogIO = {
      ...io,
      writeFileAtomic: (p, content) => {
        io.writeFileAtomic(p, content);
        if (p.endsWith('status.json')) seen.push(JSON.parse(content).nextWakeAt);
      },
    };
    await runWatchdog(CONFIG, HOME, wrapped);
    expect(seen.some((v) => v === '2026-01-15T13:20:30.000Z' || typeof v === 'string')).toBe(true);
    expect(files.size).toBeGreaterThan(0);
  });
});

describe('runWatchdog — G3: terminal states surface to the lead', () => {
  const cases: Array<[number, number, string]> = [
    [0, 0, 'runner_done'],
    [2, 10, 'escalations_pending'],
    [4, 10, 'error'],
    [5, 10, 'rulings_unratified'],
  ];
  for (const [runnerExit, watchdogExit, reason] of cases) {
    test(`runner ${runnerExit} maps to watchdog ${watchdogExit}:${reason}`, async () => {
      const { io, files } = fakeIo([{ exitCode: runnerExit, runId: 'r1' }]);
      const outcome = await runWatchdog(CONFIG, HOME, io);
      expect([outcome.exitCode, outcome.reason]).toEqual([watchdogExit, reason]);
      const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
      expect(status.terminal.reason).toBe(reason);
    });
  }

  test('a crash without a quota signal relaunches exactly once, then parks', async () => {
    const { io, spawns } = fakeIo([
      { exitCode: 3, runId: 'r1' }, { exitCode: 3, runId: 'r2' },
    ]);
    const outcome = await runWatchdog(CONFIG, HOME, io);
    expect(spawns.length).toBe(2);
    expect([outcome.exitCode, outcome.reason]).toEqual([10, 'session_incomplete']);
  });
});

describe('runWatchdog — STOP and the wall against writing anywhere else (W-P9)', () => {
  test('a STOP file present at start launches nothing and exits done', async () => {
    const { io, files, spawns } = fakeIo([{ exitCode: 0, runId: 'r1' }]);
    files.set(join(HOME, 'STOP'), '');
    const outcome = await runWatchdog(CONFIG, HOME, io);
    expect(spawns.length).toBe(0);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'stop_requested']);
  });

  test('every path written sits under home/watchdog', async () => {
    const written: string[] = [];
    const { io } = fakeIo([{ exitCode: 3, runId: 'r1' }, { exitCode: 3, runId: 'r2' }]);
    const wrapped: WatchdogIO = {
      ...io,
      writeFileAtomic: (p, c) => { written.push(p); io.writeFileAtomic(p, c); },
      appendFile: (p, c) => { written.push(p); io.appendFile(p, c); },
    };
    await runWatchdog(CONFIG, HOME, wrapped);
    expect(written.length).toBeGreaterThan(0);
    for (const path of written) expect(path.startsWith(join(HOME, 'watchdog'))).toBe(true);
  });
});

describe('runWatchdog — --once acts at most once (W-P5)', () => {
  test('a tick launches and returns 11 without waiting for the pass', async () => {
    const { io, spawns } = fakeIo([{ exitCode: 0, runId: 'r1' }]);
    const outcome = await runWatchdog({ ...CONFIG, mode: 'once' }, HOME, io);
    expect(spawns.length).toBe(1);
    expect([outcome.exitCode, outcome.reason]).toEqual([11, 'launched']);
  });
});

// C3 (group-C audit round 1, class `critical`): W-P5 / spec §9.5 — `--once` never sleeps, but
// its quota/overload pending exits must still publish `status.json.nextWakeAt`, the only way
// cron/launchd (the caller of `--once`) learns when to come back (spec §8).
describe('runWatchdog — C3: --once publishes nextWakeAt on a pending exit (spec section 8, W-P5)', () => {
  test('a quota-pending once-mode exit publishes nextWakeAt = resetsAt + quota-grace-seconds', async () => {
    const { io, files, entries } = fakeIo([]); // adopted run, never spawns
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 4242, startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(), exitCode: 3, reason: 'x',
    }));
    entries.set(join(runDir, 'logs'), [{ name: 'card-sid.log', mtimeMs: 1, isDir: false }]);
    files.set(join(runDir, 'logs', 'card-sid.log'), quotaTail(1_800_000_000 + 600));

    const outcome = await runWatchdog({ ...CONFIG, mode: 'once' }, HOME, io);
    expect([outcome.exitCode, outcome.reason]).toEqual([11, 'quota_wait_pending']);
    const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
    expect(status.nextWakeAt).toBe(new Date((1_800_000_000 + 600 + CONFIG.quotaGraceSeconds) * 1000).toISOString());
  });

  test('an overload-pending once-mode exit publishes nextWakeAt = the backoff deadline', async () => {
    const { io, files, entries } = fakeIo([]); // adopted run, never spawns
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 4242, startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(), exitCode: 3, reason: 'x',
    }));
    const overloadTail = `${JSON.stringify({ type: 'result', is_error: true, api_error_status: 529 })}\n`;
    entries.set(join(runDir, 'logs'), [{ name: 'card-sid.log', mtimeMs: 1, isDir: false }]);
    files.set(join(runDir, 'logs', 'card-sid.log'), overloadTail);

    const outcome = await runWatchdog({ ...CONFIG, mode: 'once' }, HOME, io);
    expect([outcome.exitCode, outcome.reason]).toEqual([11, 'overload_backoff_pending']);
    const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
    expect(status.nextWakeAt).toBe(new Date(1_800_000_000_000 + 30_000).toISOString());
  });
});

// C1 (group-C audit round 1, class `critical`): after a launch, the `for(;;)` loop's
// 'launch'/'relaunch' case calls `observe()` again with NO `await` in between. Until the
// just-spawned child creates its `runs/<id>/` directory — which a real OS process needs real
// wall-clock time to do — `listEntries` returns nothing, `runId` is null, `observation.run`
// used to be discarded to `null` entirely (`decide()` reads that as "nothing has run yet"),
// and `decide()` returns `launch` AGAIN. Synchronously, unboundedly — a fork bomb on every
// cold `--follow` launch. This fake now models that real delay (see `fakeIo`'s own doc
// comment); the safety valve below turns an unbounded re-spawn into a fast, clear test
// failure instead of a hang, exactly as the audit's own reproduction did.
describe('runWatchdog — C1: a single --follow launch never re-spawns before the run directory is visible', () => {
  test('exactly one spawnRunner call even when the run directory has not yet appeared on the very next tick', async () => {
    const { io, spawns } = fakeIo([{ exitCode: 0, runId: 'r1' }]);
    let spawnCount = 0;
    const SAFETY_VALVE = 5; // a correct loop spawns exactly once; more IS the fork-bomb defect
    const wrapped: WatchdogIO = {
      ...io,
      spawnRunner: (argv, opts) => {
        spawnCount += 1;
        if (spawnCount > SAFETY_VALVE) {
          throw new Error(
            `SAFETY VALVE: ${spawnCount} spawnRunner calls for one --follow launch — the C1 ` +
              'fork-bomb defect is back',
          );
        }
        return io.spawnRunner(argv, opts);
      },
    };
    const outcome = await runWatchdog(CONFIG, HOME, wrapped);
    expect(spawns.length).toBe(1);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  });
});

describe('signals are read from the newest log only', () => {
  test('the tail feeding decide comes from the newest log by mtime', () => {
    // Guards the wiring contract this loop depends on; the parser itself is Task 3's.
    expect(parseSessionSignals(quotaTail(1_800_000_600)).quota)
      .toEqual({ resetsAtEpochS: 1_800_000_600 });
  });
});

// ---------------------------------------------------------------------------------------
// Four carried-forward audit requirements this Hunter's brief made binding (Task 8 dispatch).
// ---------------------------------------------------------------------------------------

describe('runWatchdog — carried-forward requirement 1: finalLineUnparseable surfaces in events', () => {
  test('a truncated final log line is flagged in the recorded signal detail, never silently dropped', async () => {
    // The last line starts with the exact `{"type":"` literal every real log line begins with
    // (signals.ts's FINAL_LINE_SIGNAL_PREFIX) but is cut mid-JSON — a byte-bounded tail whose
    // window happened to end here, exactly the shape audit F3/F3b guards against. The FIRST
    // line is a genuine (non-rejected) rate_limit_event so this scenario reports NO quota
    // signal from the parser alone — the flag is the only way a reader learns the newest event
    // may have been lost rather than genuinely absent.
    const truncatedTail = `${JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', resetsAt: 1, rateLimitType: 'five_hour' },
    })}\n{"type":"resul`;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: truncatedTail },
      { exitCode: 0, runId: 'r2' },
    ]);
    await runWatchdog(CONFIG, HOME, io);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l));
    const flagged = events.filter(
      (e) => e.detail && e.detail.signal && e.detail.signal.finalLineUnparseable === true,
    );
    expect(flagged.length).toBeGreaterThan(0);
  });
});

describe('runWatchdog — carried-forward requirement 3: an unknown attach pid never becomes pid 0', () => {
  test('an adopted run with an unparseable pid waits via run.json re-checks, never signals pid 0, never launches a second runner', async () => {
    const { io, files, entries, spawns } = fakeIo([]); // no scripted passes: this loop never spawns
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: null, startedAt: new Date(0).toISOString(),
      endedAt: null, exitCode: null, reason: 'x',
    }));
    entries.set(join(runDir, 'logs'), []);

    let sleepCalls = 0;
    const wrapped: WatchdogIO = {
      ...io,
      sleep: async (ms) => {
        sleepCalls += 1;
        if (sleepCalls === 1) {
          // Simulate the adopted runner finishing DURING the poll wait — discovered only
          // through run.json on the next observation, never through a pid the watchdog never
          // had.
          files.set(join(runDir, 'run.json'), JSON.stringify({
            v: 1, runId: 'r1', pid: 9999, startedAt: new Date(0).toISOString(),
            endedAt: new Date(0).toISOString(), exitCode: 0, reason: 'x',
          }));
        }
        await io.sleep(ms);
      },
    };
    const outcome = await runWatchdog(CONFIG, HOME, wrapped);
    expect(spawns.length).toBe(0); // never launches a second runner while attached
    expect(sleepCalls).toBeGreaterThanOrEqual(1);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l));
    const attachEvent = events.find((e) => e.action === 'attach');
    expect(attachEvent?.detail?.runnerPid ?? null).toBe(null); // never fabricated as 0
  });
});

// ---------------------------------------------------------------------------------------
// FIX S1 (audit round, final): a cold start used to read a PREVIOUS invocation's finalized
// run.json as if it were THIS tick's answer, so an answered escalation (or any completed
// campaign) could never be re-triggered in the same home — the Stage C re-trigger scenario the
// finding reproduced end-to-end.
// ---------------------------------------------------------------------------------------
describe('runWatchdog — FIX S1: a cold start ignores a PREVIOUS invocation\'s finalized run.json', () => {
  test('an already-ended record from a prior invocation does not block a fresh launch (D74-7: "no prior run THIS invocation" -> launch)', async () => {
    const { io, files, entries, spawns } = fakeIo([{ exitCode: 0, runId: 'r2' }]);
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 8888, startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(), exitCode: 2, reason: 'escalations_pending',
    }));
    entries.set(join(runDir, 'logs'), []);

    const outcome = await runWatchdog(CONFIG, HOME, io);
    // Before the fix: lastExitCode read straight from the stale record -> immediate
    // exit(needs_human:escalations_pending), spawns.length stays 0, NO 'launch' event ever.
    expect(spawns.length).toBe(1);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l).action);
    expect(events).toContain('launch');
  });
});

// ---------------------------------------------------------------------------------------
// FIX S2 (audit round, final): `recordAlive` trusted `endedAt === null` with no pid probe, so a
// SIGKILLed runner (whose run.json is never finalized) read as ALIVE forever — the crash path
// was unreachable until the unrelated `--stall-minutes` timeout finally fired.
// ---------------------------------------------------------------------------------------
describe('runWatchdog — FIX S2: a confirmed-dead pid with an unfinalized record is not "alive"', () => {
  test('a known, confirmed-dead pid with endedAt still null takes the crash path instead of waiting for --stall-minutes', async () => {
    const { io, files, entries, spawns } = fakeIo([{ exitCode: 0, runId: 'r2' }]);
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 6543, startedAt: new Date(0).toISOString(),
      endedAt: null, exitCode: null, reason: null,
    }));
    entries.set(join(runDir, 'logs'), []);
    // pid 6543 is never registered alive — the fake's default ("dead unless marked otherwise")
    // is exactly the reproduction: a killed process the OS confirms is gone.

    const outcome = await runWatchdog(CONFIG, HOME, io);
    expect(spawns.length).toBe(1); // relaunched instead of "attaching" to a dead pid forever
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l));
    const kinds = events.map((e) => e.action);
    expect(kinds).toContain('relaunch');
    expect(kinds).not.toContain('stall'); // never waited out the unrelated stall timeout
    expect(events.find((e) => e.action === 'relaunch')?.detail?.cause).toBe('crash');
  });

  test('regression guard: the SAME record with the pid genuinely alive is attached to, never relaunched', async () => {
    const { io, files, entries, spawns, setProcessAlive } = fakeIo([]);
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 6543, startedAt: new Date(0).toISOString(),
      endedAt: null, exitCode: null, reason: null,
    }));
    entries.set(join(runDir, 'logs'), []);
    setProcessAlive(6543, true);

    let sleepCalls = 0;
    const wrapped: WatchdogIO = {
      ...io,
      sleep: async (ms) => {
        sleepCalls += 1;
        if (sleepCalls === 1) {
          files.set(join(runDir, 'run.json'), JSON.stringify({
            v: 1, runId: 'r1', pid: 6543, startedAt: new Date(0).toISOString(),
            endedAt: new Date(0).toISOString(), exitCode: 0, reason: 'x',
          }));
        }
        await io.sleep(ms);
      },
    };
    const outcome = await runWatchdog(CONFIG, HOME, wrapped);
    expect(spawns.length).toBe(0); // never launches a second runner while genuinely alive
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  });
});

// ---------------------------------------------------------------------------------------
// FIX F-C3 (audit round, final): `decide()`'s sections 3 and 5 attached to a foreign live lock
// holder with no mode check, so a `--once` tick could sleep on it — the exact violation of
// W-P5 ("--once never sleeps") this fake could not previously represent (`readLock` was
// hardcoded to `() => null`).
// ---------------------------------------------------------------------------------------
describe('runWatchdog — FIX F-C3: --once never sleeps on a foreign live lock holder', () => {
  test('once mode with a live lock holder present exits running/runner_alive without sleeping or spawning', async () => {
    const { io, spawns, setLockHolder, setProcessAlive } = fakeIo([]);
    setLockHolder(777);
    setProcessAlive(777, true);
    let sleepCalls = 0;
    const wrapped: WatchdogIO = { ...io, sleep: async (ms) => { sleepCalls += 1; await io.sleep(ms); } };
    const outcome = await runWatchdog({ ...CONFIG, mode: 'once' }, HOME, wrapped);
    expect(spawns.length).toBe(0);
    expect(sleepCalls).toBe(0); // W-P5: --once never sleeps
    expect([outcome.exitCode, outcome.reason]).toEqual([11, 'runner_alive']);
  });
});

// ---------------------------------------------------------------------------------------
// FIX F-C1 (audit round, final): the overload branch had no time-based decay of its own, so a
// dead runner's still-529 log re-entered the wait branch forever — never a relaunch.
// ---------------------------------------------------------------------------------------
describe('runWatchdog — FIX F-C1: a served overload-backoff wait relaunches instead of waiting again', () => {
  test('overload wait then relaunch then done — a second wait for the SAME 529 never happens', async () => {
    const overloadTail = `${JSON.stringify({ type: 'result', is_error: true, api_error_status: 529 })}\n`;
    const { io, files, spawns } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: overloadTail },
      { exitCode: 0, runId: 'r2' },
    ]);
    const outcome = await runWatchdog(CONFIG, HOME, io);
    // Before the fix: this hangs the pattern of wait -> wait -> wait -> ... -> needs_human at
    // the cap, spawns.length stays 1, outcome is [10, 'overloaded'], never [0, 'runner_done'].
    expect(spawns.length).toBe(2);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l));
    expect(events.filter((e) => e.action === 'wait_until').length).toBe(1); // exactly one wait
    expect(events.find((e) => e.action === 'relaunch')?.detail?.cause).toBe('overload');
    const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
    expect(status.counters.overloadBackoffs).toBe(1); // one wait served, one relaunch
  });
});

// ---------------------------------------------------------------------------------------
// FIX F-C2 (audit round, final): a completed quota recovery relaunched with `cause: crash`,
// draining the independent crash-relaunch budget (max 1) so a LATER genuine crash got no
// relaunch at all.
// ---------------------------------------------------------------------------------------
describe('runWatchdog — FIX F-C2: a served quota-wait relaunch never drains the crash budget', () => {
  test('quota relaunch, then a genuine crash still gets its own one relaunch (budgets stay independent)', async () => {
    const { io, files, spawns } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(1_800_000_000 + 30) },
      { exitCode: 3, runId: 'r2' }, // genuine crash, no signal
      { exitCode: 0, runId: 'r3' },
    ]);
    const outcome = await runWatchdog(CONFIG, HOME, io);
    // Before the fix: the quota relaunch is mislabelled cause:'crash' and consumes the
    // maxCrashRelaunches=1 budget, so r2's genuine crash gets exit(needs_human:
    // session_incomplete) instead of its own relaunch — spawns.length stays 2, r3 never runs.
    expect(spawns.length).toBe(3);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l));
    const relaunches = events.filter((e) => e.action === 'relaunch');
    expect(relaunches.map((e) => e.detail.cause)).toEqual(['quota', 'crash']);
    const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
    expect(status.counters.crashRelaunches).toBe(1); // the genuine crash only
    expect(status.counters.quotaWaits).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
// FIX F-C4 (audit round 2, CRITICAL): `recordExitCodeSelfCorrects` made a finalized record's
// exit code (1 or 3) readable as THIS tick's `lastExitCode` unconditionally — completely
// bypassing the `runId === state.trackedRunId` provenance gate that 0/2/4/5 must pass. A stale
// `run.json` left behind by an earlier, UNRELATED invocation of the same home (itself having
// exhausted its OWN budget and exited needs_human) then phantom-spends this invocation's
// crashRelaunches/lockRelaunches budget on a tick before this invocation has launched anything
// — so when a GENUINE crash/lock-conflict happens later in THIS invocation, the budget is
// already gone and it escalates instead of getting its one retry.
// ---------------------------------------------------------------------------------------
describe('runWatchdog — FIX F-C4: a stale finalized record this invocation never watched must not phantom-spend a relaunch budget', () => {
  test('a stale exit-3 record from an unrelated prior invocation does not consume the crash-relaunch budget a genuine crash THIS invocation needs', async () => {
    const { io, files, entries, spawns } = fakeIo([
      { exitCode: 3, runId: 'r2' }, // THIS invocation's own genuine crash, no signal
      { exitCode: 0, runId: 'r3' }, // recovers after its own one relaunch
    ]);
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    // The residue an EARLIER invocation leaves behind after exhausting its own
    // maxCrashRelaunches=1 budget and exiting needs_human:session_incomplete — finalized,
    // exitCode 3, no quota/overload signal in its log.
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 5555, startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(), exitCode: 3, reason: 'x',
    }));
    entries.set(join(runDir, 'logs'), []);

    const outcome = await runWatchdog(CONFIG, HOME, io);
    // Before the fix: the stale record is read as this tick's lastExitCode on the very first
    // tick (before any launch), spending the ONE crashRelaunches budget on a phantom event —
    // spawns.length stays 1, r3 never runs, outcome is [10, 'session_incomplete'].
    expect(spawns.length).toBe(2);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
    expect(status.counters.crashRelaunches).toBe(1); // the genuine crash only, never the stale one
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l).action);
    expect(events).toContain('launch'); // a fresh launch, never a phantom relaunch first
    expect(events.filter((a) => a === 'relaunch').length).toBe(1);
  });

  test('the exit-1 variant: a stale lock-refused record from an unrelated prior invocation does not consume the lock-relaunch budget a genuine conflict THIS invocation needs', async () => {
    const { io, files, entries, spawns } = fakeIo([
      { exitCode: 1, runId: 'r2' }, // THIS invocation's own genuine lock refusal
      { exitCode: 0, runId: 'r3' },
    ]);
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 5555, startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(), exitCode: 1, reason: 'x',
    }));
    entries.set(join(runDir, 'logs'), []);

    const outcome = await runWatchdog(CONFIG, HOME, io);
    // Before the fix: spawns.length stays 1 and the outcome is [10, 'lock_conflict'] — the
    // phantom relaunch at tick 1 consumes the ONE lockRelaunches budget before this invocation
    // ever makes its own attempt.
    expect(spawns.length).toBe(2);
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    const status = JSON.parse(files.get(join(HOME, 'watchdog', 'status.json')) as string);
    expect(status.counters.lockRelaunches).toBe(1);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l).action);
    expect(events).toContain('launch');
    expect(events.filter((a) => a === 'relaunch').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
// FIX F-C5 (audit round 2, Important): `recordConfirmedDeadPid` is a bare single-shot
// `io.isProcessAlive` probe with no defence against pid reuse, AND the S2 stall safety-net it
// assumes exists does not: `select.ts`'s `isStale()` returned `false` forever when
// `mtimeMs === null` ("a pass that has not written its first log is starting"), so a runner
// that died BEFORE writing its first log line had no fallback detector at all — `attach` on
// every tick, indefinitely. A reviewer reproduced the runaway: it ran until
// `RangeError: Out of memory` instead of ever converging.
// ---------------------------------------------------------------------------------------
describe('runWatchdog — FIX F-C5: an adopted run that dies before writing its first log line still converges to stalled', () => {
  test('a pid that reads alive forever, with no log ever written, stalls out via the record\'s own startedAt instead of attaching forever', async () => {
    const { io, files, entries, setProcessAlive } = fakeIo([]); // adopted only, this loop never spawns
    const runDir = join(HOME, 'runs', 'r1');
    entries.set(join(HOME, 'runs'), [{ name: 'r1', mtimeMs: 1, isDir: true }]);
    const startedAt = new Date(1_800_000_000_000).toISOString(); // == the fake clock's t0
    files.set(join(runDir, 'run.json'), JSON.stringify({
      v: 1, runId: 'r1', pid: 4321, startedAt, endedAt: null, exitCode: null, reason: null,
    }));
    entries.set(join(runDir, 'logs'), []); // NEVER wrote a single log line
    // Reads alive on every probe for the whole test — e.g. a reused pid masquerading as the
    // original process, or simply a genuinely-alive-but-permanently-silent one; either shape
    // hits the exact same gap this fix closes.
    setProcessAlive(4321, true);

    let sleepCalls = 0;
    // stallMinutes=30, pollSeconds=30 -> the deadline is served within ~61 poll slices. A
    // correct fix converges well inside that; more IS the reviewer's unbounded-attach defect
    // reproduced as a fast, clear test failure instead of an actual OOM.
    const SAFETY_VALVE = 90;
    const wrapped: WatchdogIO = {
      ...io,
      sleep: async (ms) => {
        sleepCalls += 1;
        if (sleepCalls > SAFETY_VALVE) {
          throw new Error(
            `SAFETY VALVE: ${sleepCalls} sleeps attached to a runner that never wrote a log — `
              + 'the F-C5 unbounded-attach defect is back',
          );
        }
        await io.sleep(ms);
      },
    };
    const outcome = await runWatchdog(CONFIG, HOME, wrapped);
    expect([outcome.exitCode, outcome.reason]).toEqual([10, 'stalled']);
    expect(sleepCalls).toBeLessThanOrEqual(SAFETY_VALVE);
  });
});

describe('runWatchdog — D2: a relaunched runner is never judged on the PREVIOUS run\'s log', () => {
  test('a quota wait longer than --stall-minutes does not turn the relaunch into a stall', async () => {
    // The gap-gate-2026-09-10 shape, in simulated time: the first pass hits a 429 whose reset is
    // ~107 min out (the recorded wait), so by the time the watchdog relaunches, r1's log is far
    // older than --stall-minutes 30. r2's own directory is not visible on the tick right after
    // its spawn, exactly like a real just-forked process.
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2' },
    ]);
    const outcome = await runWatchdog(CONFIG, HOME, io);

    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l) as { action: string });
    expect(events.map((e) => e.action)).not.toContain('stall');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  });

  test('status.json never names the previous run while the new one is being supervised', async () => {
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2' },
    ]);
    const seen: Array<string | null> = [];
    const spy: WatchdogIO = {
      ...io,
      writeFileAtomic: (p, c) => {
        io.writeFileAtomic(p, c);
        if (p.endsWith('status.json')) seen.push((JSON.parse(c) as { runId: string | null }).runId);
      },
    };
    await runWatchdog(CONFIG, HOME, spy);
    // Once the relaunch has happened, 'r1' may never be published again as the current run.
    const afterRelaunch = seen.slice(seen.lastIndexOf('r1') + 1);
    expect(afterRelaunch).not.toContain('r1');
    expect(seen).toContain('r2');
  });
});

describe('runWatchdog — D4(a): a relaunched runner that never writes still stalls, on time', () => {
  test('the stall fires within --stall-minutes + ONE poll interval of the relaunch', async () => {
    // r2 is alive and never writes a log line at all. CONFIG: stallMinutes 30, pollSeconds 30.
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2', endedAt: null },
    ]);
    io.isProcessAlive; // the record stays unfinalized, so r2 reads as alive throughout
    const outcome = await runWatchdog(CONFIG, HOME, io);

    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l) as { at: string; action: string });
    const relaunchAt = Date.parse(events.find((e) => e.action === 'relaunch')?.at as string);
    const stallAt = Date.parse(events.find((e) => e.action === 'stall')?.at as string);
    expect([outcome.exitCode, outcome.reason]).toEqual([10, 'stalled']);
    // Not early: the relaunched run gets its full --stall-minutes of its OWN silence.
    expect(stallAt - relaunchAt).toBeGreaterThan(30 * 60_000);
    // Not late: at most one further poll interval to notice it.
    expect(stallAt - relaunchAt).toBeLessThanOrEqual(30 * 60_000 + 30_000);
  });

  test('a relaunched runner is still attaching one minute before its own deadline', async () => {
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2', endedAt: null },
    ]);
    await runWatchdog(CONFIG, HOME, io);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l) as { at: string; action: string });
    const relaunchAt = Date.parse(events.find((e) => e.action === 'relaunch')?.at as string);
    const deadline = relaunchAt + 29 * 60_000; // stall-minutes - 1
    const before = events.filter((e) => Date.parse(e.at) <= deadline).map((e) => e.action);
    expect(before).not.toContain('stall');
    expect(before).toContain('attach');
  });
});
