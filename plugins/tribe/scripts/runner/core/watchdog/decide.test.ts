import { describe, expect, test } from 'bun:test';
import { decide, MAX_QUOTA_WAIT_MS, overloadBackoffSeconds } from './decide.ts';
import { TERMINAL_REASONS, type WatchdogObservation } from './model.ts';

const NOW = 1_800_000_000_000; // fixed clock, ms
const FUTURE_RESET_S = Math.floor(NOW / 1000) + 600;

const LIMITS = {
  stallMinutes: 30, maxQuotaWaits: 6, maxOverloadBackoffs: 5,
  maxCrashRelaunches: 1, quotaGraceSeconds: 30,
};
const ZERO = {
  quotaWaits: 0, overloadBackoffs: 0, crashRelaunches: 0, lockRelaunches: 0, fallbackUsed: false,
};

function obs(over: Partial<WatchdogObservation> = {}): WatchdogObservation {
  return {
    nowMs: NOW,
    mode: 'follow',
    stopFilePresent: false,
    lockHolder: null,
    run: {
      runId: '2026-09-03T00-00-00-000Z-aaaa',
      runnerPid: 4242,
      alive: false,
      endedAt: '2026-09-03T00:10:00.000Z',
      newestLogPath: '/h/.tribe/k/campaigns/c/runs/r/logs/card-sid.log',
      newestLogMtimeMs: NOW - 1000,
    },
    lastExitCode: 3,
    crashSuspected: false,
    quota: null,
    overload: null,
    counters: { ...ZERO },
    limits: { ...LIMITS },
    fallbackModel: null,
    pendingWait: null,
    ...over,
  };
}

/** One-line encoding of an action, so 40 expectations stay readable. */
function encode(a: ReturnType<typeof decide>): string {
  switch (a.kind) {
    case 'exit': return `exit:${a.status}:${a.reason}`;
    case 'relaunch': return `relaunch:${a.cause}${a.model ? `:${a.model}` : ''}`;
    case 'wait_until': return `wait_until:${a.cause}:${a.untilMs}`;
    case 'attach': return `attach:${a.runnerPid}`;
    case 'stall': return `stall:${a.exit.status}:${a.exit.reason}`;
    case 'launch': return 'launch';
  }
}

const QUOTA_WAIT = `wait_until:quota:${(FUTURE_RESET_S + 30) * 1000}`;
const OVERLOAD_WAIT = `wait_until:overload:${NOW + 30_000}`;

// The oracle, transcribed: every exit code x quota x 529 x STOP. `q`/`o`/`s` present = 1.
const TABLE: Array<[code: number, q: 0 | 1, o: 0 | 1, s: 0 | 1, want: string]> = [
  [0, 0, 0, 0, 'exit:done:runner_done'],
  [0, 0, 0, 1, 'exit:done:runner_done'],
  [0, 0, 1, 0, 'exit:done:runner_done'],
  [0, 0, 1, 1, 'exit:done:runner_done'],
  [0, 1, 0, 0, 'exit:done:runner_done'],
  [0, 1, 0, 1, 'exit:done:runner_done'],
  [0, 1, 1, 0, 'exit:done:runner_done'],
  [0, 1, 1, 1, 'exit:done:runner_done'],

  [1, 0, 0, 0, 'relaunch:lock_free'],
  [1, 0, 0, 1, 'exit:done:stop_requested'],
  [1, 0, 1, 0, 'relaunch:lock_free'],
  [1, 0, 1, 1, 'exit:done:stop_requested'],
  [1, 1, 0, 0, 'relaunch:lock_free'],
  [1, 1, 0, 1, 'exit:done:stop_requested'],
  [1, 1, 1, 0, 'relaunch:lock_free'],
  [1, 1, 1, 1, 'exit:done:stop_requested'],

  [2, 0, 0, 0, 'exit:needs_human:escalations_pending'],
  [2, 0, 0, 1, 'exit:needs_human:escalations_pending'],
  [2, 0, 1, 0, 'exit:needs_human:escalations_pending'],
  [2, 0, 1, 1, 'exit:needs_human:escalations_pending'],
  [2, 1, 0, 0, 'exit:needs_human:escalations_pending'],
  [2, 1, 0, 1, 'exit:needs_human:escalations_pending'],
  [2, 1, 1, 0, 'exit:needs_human:escalations_pending'],
  [2, 1, 1, 1, 'exit:needs_human:escalations_pending'],

  [3, 0, 0, 0, 'relaunch:crash'],
  [3, 0, 0, 1, 'exit:done:stop_requested'],
  [3, 0, 1, 0, OVERLOAD_WAIT],
  [3, 0, 1, 1, 'exit:done:stop_requested'],
  [3, 1, 0, 0, QUOTA_WAIT],
  [3, 1, 0, 1, 'exit:done:stop_requested'],
  [3, 1, 1, 0, QUOTA_WAIT],
  [3, 1, 1, 1, 'exit:done:stop_requested'],

  [4, 0, 0, 0, 'exit:needs_human:error'],
  [4, 0, 0, 1, 'exit:needs_human:error'],
  [4, 0, 1, 0, 'exit:needs_human:error'],
  [4, 0, 1, 1, 'exit:needs_human:error'],
  [4, 1, 0, 0, 'exit:needs_human:error'],
  [4, 1, 0, 1, 'exit:needs_human:error'],
  [4, 1, 1, 0, 'exit:needs_human:error'],
  [4, 1, 1, 1, 'exit:needs_human:error'],
];

describe('decide — the frozen action table, every row', () => {
  test('the table covers 5 exit codes x quota x overload x STOP', () => {
    expect(TABLE.length).toBe(40);
  });

  for (const [code, q, o, s, want] of TABLE) {
    test(`exit ${code} quota=${q} overload=${o} stop=${s} -> ${want}`, () => {
      const action = decide(
        obs({
          lastExitCode: code,
          quota: q ? { resetsAtEpochS: FUTURE_RESET_S } : null,
          overload: o ? { apiErrorStatus: 529 } : null,
          stopFilePresent: s === 1,
        }),
      );
      expect(encode(action)).toBe(want);
    });
  }
});

describe('decide — quota reset validity (W-P2, spec section 7)', () => {
  test('a reset already in the past is no signal: the crash path takes it', () => {
    const action = decide(
      obs({ lastExitCode: 3, quota: { resetsAtEpochS: Math.floor(NOW / 1000) - 10 } }),
    );
    expect(encode(action)).toBe('relaunch:crash');
  });
  test('the grace period is applied to the reset instant', () => {
    const action = decide(
      obs({
        lastExitCode: 3,
        quota: { resetsAtEpochS: FUTURE_RESET_S },
        limits: { ...LIMITS, quotaGraceSeconds: 90 },
      }),
    );
    expect(encode(action)).toBe(`wait_until:quota:${(FUTURE_RESET_S + 90) * 1000}`);
  });
});

describe('decide — a crash with no exit code to read (W-P6)', () => {
  test('dead pid plus unfinalized run.json takes the exit-3 branch', () => {
    const action = decide(obs({ lastExitCode: null, crashSuspected: true }));
    expect(encode(action)).toBe('relaunch:crash');
  });
  test('and honours a quota signal the same way', () => {
    const action = decide(
      obs({ lastExitCode: null, crashSuspected: true, quota: { resetsAtEpochS: FUTURE_RESET_S } }),
    );
    expect(encode(action)).toBe(QUOTA_WAIT);
  });
});

describe('overloadBackoffSeconds — the frozen schedule (spec section 8)', () => {
  test('30, 60, 120, 240, 480 and then clamped at 480', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(overloadBackoffSeconds)).toEqual([
      30, 60, 120, 240, 480, 480, 480,
    ]);
  });

  // G1 (group-B audit round 1): the table lookup must be TOTAL — a fractional, NaN, negative
  // or out-of-range counter is a legally constructible `WatchdogCounters.overloadBackoffs`
  // value (it is a plain `number`), and must never resolve to `undefined`.
  test('a fractional attempt saturates to a defined second count, never undefined', () => {
    expect(overloadBackoffSeconds(2.5)).toBe(240);
  });
  test('a NaN attempt saturates to a defined second count, never undefined', () => {
    expect(overloadBackoffSeconds(Number.NaN)).toBe(30);
  });
  test('a negative attempt clamps to the first entry', () => {
    expect(overloadBackoffSeconds(-1)).toBe(30);
  });
  test('an out-of-range attempt clamps to the last (saturation) entry', () => {
    expect(overloadBackoffSeconds(100)).toBe(480);
  });
});

const STALE_MS = NOW - 31 * 60 * 1000;

describe('decide — a live runner (follow mode)', () => {
  const alive = (over: Partial<WatchdogObservation> = {}) =>
    obs({
      lastExitCode: null,
      run: {
        runId: 'r', runnerPid: 4242, alive: true, endedAt: null,
        newestLogPath: '/h/logs/card-sid.log', newestLogMtimeMs: NOW - 1000,
      },
      ...over,
    });

  test('a fresh live runner is attached to, never relaunched', () => {
    expect(encode(decide(alive()))).toBe('attach:4242');
  });

  test('a stalled live runner reports the log and exits needs_human in follow mode', () => {
    const action = decide(
      alive({
        run: {
          runId: 'r', runnerPid: 4242, alive: true, endedAt: null,
          newestLogPath: '/h/logs/card-sid.log', newestLogMtimeMs: STALE_MS,
        },
      }),
    );
    expect(encode(action)).toBe('stall:needs_human:stalled');
    expect(action.kind === 'stall' && action.logPath).toBe('/h/logs/card-sid.log');
    expect(action.kind === 'stall' && action.lastMtimeMs).toBe(STALE_MS);
  });

  test('a live runner with no log yet is starting, not stalled', () => {
    const action = decide(
      alive({
        run: {
          runId: 'r', runnerPid: 4242, alive: true, endedAt: null,
          newestLogPath: null, newestLogMtimeMs: null,
        },
      }),
    );
    expect(encode(action)).toBe('attach:4242');
  });

  test('a STOP file never terminates a live runner (G4: never kills)', () => {
    expect(encode(decide(alive({ stopFilePresent: true })))).toBe('attach:4242');
  });

  // G3 (group-B audit round 1, class `agreed`): decide()'s stall check must delegate to
  // select.ts's `isStale` rather than duplicate its `>` — a mutation to `>=` in a scratch
  // copy left all pre-existing rows green, so the exact boundary is pinned here.
  test('exactly at the stall threshold is NOT stale yet (boundary, G3)', () => {
    const action = decide(
      alive({
        run: {
          runId: 'r', runnerPid: 4242, alive: true, endedAt: null,
          newestLogPath: '/h/logs/card-sid.log',
          newestLogMtimeMs: NOW - LIMITS.stallMinutes * 60_000,
        },
      }),
    );
    expect(encode(action)).toBe('attach:4242');
  });

  test('one millisecond past the stall threshold IS stale (boundary, G3)', () => {
    const action = decide(
      alive({
        run: {
          runId: 'r', runnerPid: 4242, alive: true, endedAt: null,
          newestLogPath: '/h/logs/card-sid.log',
          newestLogMtimeMs: NOW - LIMITS.stallMinutes * 60_000 - 1,
        },
      }),
    );
    expect(encode(action)).toBe('stall:needs_human:stalled');
  });

  // G2 (group-B audit round 1): `runnerPid: null` is a legally constructible
  // `WatchdogRunObservation` for an adopted live run — decide() must pass that unknown
  // through honestly, never fabricate pid 0 (a real, meaningful target on POSIX) and never
  // fall through to launch/relaunch (spec 2.1: a live runner is ALWAYS attach).
  test('a live runner with an unknown pid attaches with runnerPid null, never pid 0', () => {
    const action = decide(
      alive({
        run: {
          runId: 'r', runnerPid: null, alive: true, endedAt: null,
          newestLogPath: '/h/logs/card-sid.log', newestLogMtimeMs: NOW - 1000,
        },
      }),
    );
    expect(action.kind).toBe('attach');
    expect(action.kind === 'attach' && action.runnerPid).toBe(null);
  });
});

describe('decide — caps', () => {
  test('quota waits over cap park for a human', () => {
    const action = decide(
      obs({
        lastExitCode: 3,
        quota: { resetsAtEpochS: FUTURE_RESET_S },
        counters: { ...ZERO, quotaWaits: 6 },
      }),
    );
    expect(encode(action)).toBe('exit:needs_human:quota_cap');
  });

  test('overload backoffs over cap park for a human when no fallback model is configured', () => {
    const action = decide(
      obs({
        lastExitCode: 3, overload: { apiErrorStatus: 529 },
        counters: { ...ZERO, overloadBackoffs: 5 },
      }),
    );
    expect(encode(action)).toBe('exit:needs_human:overloaded');
  });

  test('over cap with --fallback-model, it relaunches once on that tier', () => {
    const action = decide(
      obs({
        lastExitCode: 3, overload: { apiErrorStatus: 529 },
        counters: { ...ZERO, overloadBackoffs: 5 }, fallbackModel: 'sonnet',
      }),
    );
    expect(encode(action)).toBe('relaunch:overload:sonnet');
  });

  test('the fallback is used at most once', () => {
    const action = decide(
      obs({
        lastExitCode: 3, overload: { apiErrorStatus: 529 },
        counters: { ...ZERO, overloadBackoffs: 5, fallbackUsed: true }, fallbackModel: 'sonnet',
      }),
    );
    expect(encode(action)).toBe('exit:needs_human:overloaded');
  });

  test('a second crash relaunch is refused (max 1, D74-5)', () => {
    const action = decide(obs({ lastExitCode: 3, counters: { ...ZERO, crashRelaunches: 1 } }));
    expect(encode(action)).toBe('exit:needs_human:session_incomplete');
  });

  test('a repeated lock conflict parks rather than looping', () => {
    const action = decide(obs({ lastExitCode: 1, counters: { ...ZERO, lockRelaunches: 1 } }));
    expect(encode(action)).toBe('exit:needs_human:lock_conflict');
  });
});

// G4 (group-B audit round 1): spec §2.1's "Runner exited 1 (lock held by a live process) |
// attach if the holder is alive, else relaunch" row's `alive` arm is implemented, but was
// never exercised under `lastExitCode: 1` — the only lockHolder alive/dead cases in this
// file were under `lastExitCode: null` (the "nothing has run yet" branch).
describe('decide — exit 1, lock held by a live process (spec section 2.1, G4)', () => {
  test('holder alive under exit 1 attaches on the holder\'s pid', () => {
    const action = decide(
      obs({ lastExitCode: 1, lockHolder: { pid: 555, alive: true } }),
    );
    expect(encode(action)).toBe('attach:555');
  });
  test('holder dead under exit 1 relaunches (lock_free)', () => {
    const action = decide(
      obs({ lastExitCode: 1, lockHolder: { pid: 555, alive: false } }),
    );
    expect(encode(action)).toBe('relaunch:lock_free');
  });
});

describe('decide — adopt, never duplicate (D74-7)', () => {
  test('a live lock holder is adopted instead of launching', () => {
    const action = decide(
      obs({ run: null, lastExitCode: null, lockHolder: { pid: 777, alive: true } }),
    );
    expect(encode(action)).toBe('attach:777');
  });
  test('a dead lock holder does not block a launch', () => {
    const action = decide(
      obs({ run: null, lastExitCode: null, lockHolder: { pid: 777, alive: false } }),
    );
    expect(encode(action)).toBe('launch');
  });
  test('STOP before anything started means done, with nothing launched', () => {
    const action = decide(obs({ run: null, lastExitCode: null, stopFilePresent: true }));
    expect(encode(action)).toBe('exit:done:stop_requested');
  });
});

// W-P5: a tick observes and acts AT MOST ONCE — it never sleeps.
const ONCE_TABLE: Array<[name: string, over: Partial<WatchdogObservation>, want: string]> = [
  ['exit 3 + quota', { lastExitCode: 3, quota: { resetsAtEpochS: FUTURE_RESET_S } },
    'exit:running:quota_wait_pending'],
  ['exit 3 + quota + STOP',
    { lastExitCode: 3, quota: { resetsAtEpochS: FUTURE_RESET_S }, stopFilePresent: true },
    'exit:done:stop_requested'],
  ['exit 3 + 529', { lastExitCode: 3, overload: { apiErrorStatus: 529 } },
    'exit:running:overload_backoff_pending'],
  ['exit 3 + 529 + STOP',
    { lastExitCode: 3, overload: { apiErrorStatus: 529 }, stopFilePresent: true },
    'exit:done:stop_requested'],
  ['exit 3 + quota + 529',
    { lastExitCode: 3, quota: { resetsAtEpochS: FUTURE_RESET_S }, overload: { apiErrorStatus: 529 } },
    'exit:running:quota_wait_pending'],
  ['exit 3, no signal', { lastExitCode: 3 }, 'relaunch:crash'],
  ['exit 3, no signal + STOP', { lastExitCode: 3, stopFilePresent: true },
    'exit:done:stop_requested'],
  ['exit 0', { lastExitCode: 0 }, 'exit:done:runner_done'],
  ['exit 2', { lastExitCode: 2 }, 'exit:needs_human:escalations_pending'],
  ['alive, fresh log', {
    lastExitCode: null,
    run: { runId: 'r', runnerPid: 42, alive: true, endedAt: null,
           newestLogPath: '/h/l.log', newestLogMtimeMs: NOW - 1000 },
  }, 'exit:running:runner_alive'],
  ['alive, stale log', {
    lastExitCode: null,
    run: { runId: 'r', runnerPid: 42, alive: true, endedAt: null,
           newestLogPath: '/h/l.log', newestLogMtimeMs: STALE_MS },
  }, 'stall:running:stalled'],
  ['nothing running', { run: null, lastExitCode: null }, 'launch'],
];

describe('decide — --once mode never sleeps (W-P5)', () => {
  for (const [name, over, want] of ONCE_TABLE) {
    test(`once: ${name} -> ${want}`, () => {
      expect(encode(decide(obs({ mode: 'once', ...over })))).toBe(want);
    });
  }
});

// C3 (group-C audit round 1, class `critical`): W-P5 / spec §9 amendment 5 — "--once never
// sleeps: it records nextWakeAt and exits 11 with reason quota_wait_pending /
// overload_backoff_pending." The exit action used to carry no wake time at all, so
// status.json's nextWakeAt stayed `null` on the one path cron/launchd has no other way to
// learn when to come back (spec §8). The exit code and reason (frozen, already correct) must
// stay byte-identical to ONCE_TABLE's rows above — only the new `nextWakeAtMs` field is
// exercised here.
describe('decide — C3: --once pending exits carry the same wake instant --follow would have waited until', () => {
  test('once: exit 3 + quota -> exit:running:quota_wait_pending with nextWakeAtMs = (resetsAt + grace) * 1000', () => {
    const action = decide(obs({
      mode: 'once', lastExitCode: 3, quota: { resetsAtEpochS: FUTURE_RESET_S },
    }));
    if (action.kind !== 'exit') throw new Error(`expected an exit action, got ${action.kind}`);
    expect(action.status).toBe('running');
    expect(action.reason).toBe('quota_wait_pending');
    expect(action.nextWakeAtMs).toBe((FUTURE_RESET_S + LIMITS.quotaGraceSeconds) * 1000);
  });

  test('once: exit 3 + 529 -> exit:running:overload_backoff_pending with nextWakeAtMs = the backoff deadline', () => {
    const action = decide(obs({
      mode: 'once', lastExitCode: 3, overload: { apiErrorStatus: 529 },
    }));
    if (action.kind !== 'exit') throw new Error(`expected an exit action, got ${action.kind}`);
    expect(action.status).toBe('running');
    expect(action.reason).toBe('overload_backoff_pending');
    expect(action.nextWakeAtMs).toBe(NOW + overloadBackoffSeconds(ZERO.overloadBackoffs) * 1000);
  });

  test('the untilMs a --follow wait_until would have used is IDENTICAL to the once-mode nextWakeAtMs (same observation, quota)', () => {
    const followAction = decide(obs({
      mode: 'follow', lastExitCode: 3, quota: { resetsAtEpochS: FUTURE_RESET_S },
    }));
    const onceAction = decide(obs({
      mode: 'once', lastExitCode: 3, quota: { resetsAtEpochS: FUTURE_RESET_S },
    }));
    if (followAction.kind !== 'wait_until') throw new Error('expected wait_until');
    if (onceAction.kind !== 'exit') throw new Error('expected exit');
    expect(onceAction.nextWakeAtMs).toBe(followAction.untilMs);
  });

  test('the untilMs a --follow wait_until would have used is IDENTICAL to the once-mode nextWakeAtMs (same observation, overload)', () => {
    const followAction = decide(obs({
      mode: 'follow', lastExitCode: 3, overload: { apiErrorStatus: 529 },
    }));
    const onceAction = decide(obs({
      mode: 'once', lastExitCode: 3, overload: { apiErrorStatus: 529 },
    }));
    if (followAction.kind !== 'wait_until') throw new Error('expected wait_until');
    if (onceAction.kind !== 'exit') throw new Error('expected exit');
    expect(onceAction.nextWakeAtMs).toBe(followAction.untilMs);
  });
});

// FIX F-C1 (audit round, final): "overloadBackoffs=0..4 -> wait_until; overloadBackoffs=5 ->
// exit needs_human:overloaded. Not one relaunch." The overload branch had NO time decay of its
// own (unlike quota, whose resetsAt eventually passes) so every re-observation of the same
// dead runner's still-529 log re-entered the wait branch and ordered ANOTHER, longer wait
// instead of ever retrying. `pendingWait` (model.ts) is the explicit "has the ordered backoff
// already elapsed" signal the finding calls for.
describe('decide — FIX F-C1: a served overload wait relaunches instead of waiting again', () => {
  test('a served overload wait relaunches with cause overload, never a second wait for the same 529', () => {
    const action = decide(obs({
      lastExitCode: 3, overload: { apiErrorStatus: 529 },
      counters: { ...ZERO, overloadBackoffs: 1 },
      pendingWait: { cause: 'overload', untilMs: NOW },
    }));
    expect(encode(action)).toBe('relaunch:overload');
  });

  test('a served overload wait relaunches even once the counter has JUST reached the cap — the ' +
    'wait that reached it is still honoured; only the NEXT fresh occurrence hits the cap', () => {
    const action = decide(obs({
      lastExitCode: 3, overload: { apiErrorStatus: 529 },
      counters: { ...ZERO, overloadBackoffs: 5 },
      pendingWait: { cause: 'overload', untilMs: NOW },
    }));
    expect(encode(action)).toBe('relaunch:overload');
  });

  test('STOP still wins over a served overload-wait relaunch', () => {
    const action = decide(obs({
      lastExitCode: 3, overload: { apiErrorStatus: 529 }, stopFilePresent: true,
      counters: { ...ZERO, overloadBackoffs: 1 },
      pendingWait: { cause: 'overload', untilMs: NOW },
    }));
    expect(encode(action)).toBe('exit:done:stop_requested');
  });

  test('a pendingWait not yet due (nowMs < untilMs) is never treated as served', () => {
    const action = decide(obs({
      lastExitCode: 3, overload: { apiErrorStatus: 529 },
      counters: { ...ZERO, overloadBackoffs: 0 },
      pendingWait: { cause: 'overload', untilMs: NOW + 1000 },
    }));
    expect(encode(action)).toBe(OVERLOAD_WAIT);
  });

  test('a pending QUOTA wait never satisfies an overload serve (cause must match)', () => {
    const action = decide(obs({
      lastExitCode: 3, overload: { apiErrorStatus: 529 },
      counters: { ...ZERO, overloadBackoffs: 0 },
      pendingWait: { cause: 'quota', untilMs: NOW },
    }));
    expect(encode(action)).toBe(OVERLOAD_WAIT);
  });
});

// FIX F-C2 (audit round, final): a completed quota recovery used to fall through to the
// generic crash-relaunch branch once `resetsAt` decayed into the past, mislabelling the
// relaunch `cause: 'crash'` and draining `maxCrashRelaunches` (budget 1) for a recovery that
// was never a crash — starving a LATER genuine crash of its one relaunch.
describe('decide — FIX F-C2: a served quota wait relaunches as cause quota, never crash', () => {
  test('a served quota wait relaunches with cause quota once the reset has passed', () => {
    const action = decide(obs({
      lastExitCode: 3, quota: { resetsAtEpochS: Math.floor(NOW / 1000) - 10 },
      pendingWait: { cause: 'quota', untilMs: NOW },
    }));
    expect(encode(action)).toBe('relaunch:quota');
  });

  test('a served quota-wait relaunch never consumes the crash budget: it still fires with the ' +
    'crash budget already exhausted', () => {
    const action = decide(obs({
      lastExitCode: 3, quota: { resetsAtEpochS: Math.floor(NOW / 1000) - 10 },
      pendingWait: { cause: 'quota', untilMs: NOW },
      counters: { ...ZERO, crashRelaunches: 1 },
    }));
    expect(encode(action)).toBe('relaunch:quota');
  });

  test('STOP still wins over a served quota-wait relaunch', () => {
    const action = decide(obs({
      lastExitCode: 3, quota: { resetsAtEpochS: Math.floor(NOW / 1000) - 10 },
      pendingWait: { cause: 'quota', untilMs: NOW }, stopFilePresent: true,
    }));
    expect(encode(action)).toBe('exit:done:stop_requested');
  });

  test('a stale reset with no wait ever ordered still takes the plain crash path (unchanged)', () => {
    const action = decide(
      obs({ lastExitCode: 3, quota: { resetsAtEpochS: Math.floor(NOW / 1000) - 10 } }),
    );
    expect(encode(action)).toBe('relaunch:crash');
  });
});

// FIX F-C3 (audit round, final): sections 3 (exit 1, lock refused) and 5 (nothing run yet) both
// did a bare `if (o.lockHolder?.alive) return attach` with no mode check, so `--once` slept on
// a foreign live lock exactly like `--follow` — violating W-P5 ("--once never sleeps"). Section
// 1 (a live runner of our own) already guarded this correctly; sections 3 and 5 now match it.
describe('decide — FIX F-C3: --once never attaches to a foreign live lock holder (W-P5)', () => {
  test('once: exit 1, lock held by a live process -> exit running runner_alive, never attach', () => {
    const action = decide(
      obs({ mode: 'once', lastExitCode: 1, lockHolder: { pid: 777, alive: true } }),
    );
    expect(encode(action)).toBe('exit:running:runner_alive');
  });

  test('once: nothing has run yet, but a live lock holder exists -> exit running runner_alive, never attach', () => {
    const action = decide(
      obs({ mode: 'once', run: null, lastExitCode: null, lockHolder: { pid: 777, alive: true } }),
    );
    expect(encode(action)).toBe('exit:running:runner_alive');
  });

  test('follow mode is unaffected: exit 1, lock held by a live process still attaches', () => {
    const action = decide(
      obs({ mode: 'follow', lastExitCode: 1, lockHolder: { pid: 777, alive: true } }),
    );
    expect(encode(action)).toBe('attach:777');
  });

  test('follow mode is unaffected: nothing run yet, live lock holder still attaches', () => {
    const action = decide(
      obs({ mode: 'follow', run: null, lastExitCode: null, lockHolder: { pid: 777, alive: true } }),
    );
    expect(encode(action)).toBe('attach:777');
  });
});

// FIX S3 (audit round, final): `resetsAtEpochS` is untrusted log content validated only by
// `Number.isFinite` — a corrupted value (e.g. a millisecond-scale number landing in a field
// documented as seconds) must not compute a decades-long wait. The deadline is now clamped to
// `nowMs + MAX_QUOTA_WAIT_MS`, a named constant beside `OVERLOAD_BACKOFF_SECONDS`.
describe('decide — FIX S3: a corrupt/huge resetsAtEpochS clamps to a bounded wait', () => {
  test('an absurdly large resetsAtEpochS clamps the wait to MAX_QUOTA_WAIT_MS, never decades', () => {
    const hugeResetsAtEpochS = FUTURE_RESET_S * 1000; // e.g. ms mistakenly landed in the s field
    const action = decide(obs({ lastExitCode: 3, quota: { resetsAtEpochS: hugeResetsAtEpochS } }));
    if (action.kind !== 'wait_until') throw new Error(`expected wait_until, got ${action.kind}`);
    expect(action.untilMs).toBe(NOW + MAX_QUOTA_WAIT_MS);
  });

  test('a normal, near-term reset is NOT clamped (still exact grace-adjusted math)', () => {
    const action = decide(obs({ lastExitCode: 3, quota: { resetsAtEpochS: FUTURE_RESET_S } }));
    expect(encode(action)).toBe(QUOTA_WAIT);
  });
});

test('the watchdog vocabulary has no rulings reason any more: the runner never exits 5', () => {
  expect(TERMINAL_REASONS.filter((reason) => reason.includes('rulings'))).toEqual([]);
});
