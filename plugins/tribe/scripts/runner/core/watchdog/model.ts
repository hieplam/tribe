// ---------------------------------------------------------------------------------------
// Campaign watchdog (card i74, spec docs/superpowers/specs/2026-09-02-mechanical-heartbeat-design.md).
// The watchdog's own vocabulary. It deliberately does NOT live in core/types.ts: that file is
// one of this campaign's schemaLockPaths, and nothing in ports/ports.ts needs these types
// (every WatchdogIO member is primitive-typed, or uses LockInfo/RunnerHandle, both declared in
// ports/ports.ts itself). Like core/types.ts, this module imports nothing local.
// ---------------------------------------------------------------------------------------

export const WATCHDOG_EXIT_DONE = 0;
export const WATCHDOG_EXIT_USAGE = 1;
export const WATCHDOG_EXIT_NEEDS_HUMAN = 10;
export const WATCHDOG_EXIT_RUNNING = 11;

export type WatchdogMode = 'once' | 'follow';

/** Every reason a watchdog pass can end on — the `reason` of an `exit` action (and the `stalled`
 * of a `stall` action), written to `status.json.terminal.reason`. */
export const TERMINAL_REASONS = [
  'runner_done', 'escalations_pending', 'error', 'session_incomplete',
  'stop_requested', 'runner_alive', 'lock_conflict', 'quota_cap', 'quota_wait_pending',
  'overloaded', 'overload_backoff_pending', 'stalled', 'permanent_api_error',
] as const;

export interface WatchdogConfig {
  repoRoot: string;
  model: string;
  /** Exactly as typed on the command line — relative or absolute. Resolved and contained by
   * `core/watchdog/args.ts`'s `resolveHomeArg`/`containHome` at the edge (Task 2). */
  rawHome: string;
  mode: WatchdogMode;
  stallMinutes: number;
  maxQuotaWaits: number;
  maxOverloadBackoffs: number;
  maxCrashRelaunches: number;
  quotaGraceSeconds: number;
  pollSeconds: number;
  fallbackModel: string | null;
  /** The runner's own optional flags, forwarded verbatim in argv order. */
  passthrough: string[];
}

export interface WatchdogCounters {
  quotaWaits: number;
  overloadBackoffs: number;
  crashRelaunches: number;
  lockRelaunches: number;
  fallbackUsed: boolean;
}

export interface WatchdogLimits {
  stallMinutes: number;
  maxQuotaWaits: number;
  maxOverloadBackoffs: number;
  maxCrashRelaunches: number;
  quotaGraceSeconds: number;
}

/** One observed runner pass — from a child the watchdog owns, or from an adopted run.json.
 * C1 (group-C audit round 1, class `critical`): `runId` widened to `string | null` — a child
 * the watchdog owns but whose `runs/<id>/` directory a real OS process has not yet had real
 * wall-clock time to create is still a LIVE runner (`observe()`, `core/watchdog/watch-loop.ts`);
 * its id is simply not yet knowable. `decide()` never reads `runId` itself (only
 * `alive`/`runnerPid`), so this widening changes no decision logic — only what an
 * owned-but-not-yet-visible child is allowed to report as `null` rather than being discarded
 * into `run: null` entirely (which `decide()` reads as "nothing has run yet" and re-launches). */
export interface WatchdogRunObservation {
  runId: string | null;
  runnerPid: number | null;
  alive: boolean;
  endedAt: string | null;
  newestLogPath: string | null;
  newestLogMtimeMs: number | null;
  /** FIX F-C5 (audit round 2): the `nowMs` at which THIS invocation first observed this run
   * alive with `newestLogMtimeMs === null` (i.e. no log line at all) — the fallback silence-clock
   * `isStale()` (`select.ts`) uses in that case, so a run that dies before writing its first log
   * line still converges to `stalled` instead of attaching forever (a reviewer reproduced the
   * unbounded runaway: it ran until `RangeError: Out of memory`). Deliberately NOT the record's
   * own `startedAt` — see `watch-loop.ts`'s `LoopState.noLogSince` for why. `null` whenever this
   * run currently has a log line (real or none-yet-observed-as-persistently-silent). Optional so
   * no existing `decide.test.ts` fixture needs to set it; `isStale()`'s own 3-arg call sites
   * (including its own "never stale" test) are unaffected either way. */
  noLogSinceMs?: number | null;
}

export interface WatchdogObservation {
  nowMs: number;
  mode: WatchdogMode;
  stopFilePresent: boolean;
  lockHolder: { pid: number; alive: boolean } | null;
  run: WatchdogRunObservation | null;
  /** W-P6: the child's real status when owned, else the finalized run.json exitCode. */
  lastExitCode: number | null;
  /** Run present, not alive, run.json never finalized — a crash with no code to read. */
  crashSuspected: boolean;
  /** FIX F-C4 (audit round 2, CRITICAL): whether `lastExitCode` (when 1 or 3) is evidence THIS
   * invocation actually experienced the event — captured directly (an owned child's real exit),
   * independently confirmed via a dead pid THIS tick (`crashSuspected`), or read from a record
   * whose `runId` this invocation actually tracked. Gates ONLY the two "no other signal" plain
   * relaunch fallbacks (`decide()` section 3's `lock_free`, section 4's `crash`) — every
   * quota/overload signal-bearing branch stays self-correcting regardless of provenance, exactly
   * as before, because the cross-invocation `--once` `quota_wait_pending`/
   * `overload_backoff_pending` recheck (spec §9.5) depends on that. Optional and defaults to
   * `true` when omitted, so every pre-existing `decide.test.ts` fixture (all of which predate
   * this concept and always describe a genuine this-tick event, including the frozen 48-row
   * action table) is unaffected — `watch-loop.ts` is the only caller that ever sets it
   * explicitly, and it is the only place an unprovenanced read was ever unsafe (see its own
   * comment on `recordExitCodeSelfCorrects`). */
  lastExitCodeProvenanced?: boolean;
  /** W-P2: already validated as a FUTURE reset by the edge's clock-free parser + decide(). */
  quota: { resetsAtEpochS: number } | null;
  overload: { apiErrorStatus: number } | null;
  /** The run's last session ended on an allowlisted permanent API error (`../api-error.ts`).
   * Optional so every existing `decide.test.ts` fixture stays as written; absent = none. */
  permanentApiError?: { status: number | null; code: string } | null;
  counters: WatchdogCounters;
  limits: WatchdogLimits;
  fallbackModel: string | null;
  /** FIX F-C1/F-C2 (audit round, final): the deadline of the most recently ORDERED
   * `wait_until`, carried forward by the loop until it is consumed by a relaunch — so
   * `decide()` can tell "the ordered backoff/quota wait has already been served; retry now"
   * from "a fresh instance of this same still-present log signal", rather than inferring it
   * from decayed state (the quota case) or never detecting it at all (the overload case, which
   * has no time-based decay of its own). `null` whenever no wait is currently outstanding —
   * cleared the moment any new attempt (launch or relaunch) is spawned. */
  pendingWait: { cause: 'quota' | 'overload'; untilMs: number } | null;
}

export type WatchdogAction =
  | { kind: 'launch' }
  /** G2 (group-B audit round 1): `number | null` because a live run's own pid is legally
   * unknown (`WatchdogRunObservation.runnerPid: number | null`) — never fabricate a pid 0. */
  | { kind: 'attach'; runnerPid: number | null }
  | { kind: 'wait_until'; untilMs: number; cause: 'quota' | 'overload' }
  | { kind: 'relaunch'; cause: 'quota' | 'overload' | 'crash' | 'lock_free'; model: string | null }
  | {
      kind: 'stall';
      logPath: string | null;
      lastMtimeMs: number | null;
      exit: { status: 'needs_human' | 'running'; reason: 'stalled' };
    }
  | {
      kind: 'exit';
      status: 'done' | 'needs_human' | 'running';
      reason: string;
      /** C3 (group-C audit round 1): W-P5 / spec §9.5 — `--once` never sleeps, but its
       * quota/overload pending exits must still carry the wake instant `--follow` would have
       * waited until, so `status.json.nextWakeAt` is populated on the one path cron/launchd
       * has no other way to learn when to come back. `undefined` (never set) on every other
       * exit reason — never a fabricated value. */
      nextWakeAtMs?: number;
      /** Set only on `permanent_api_error`: the `api_error_code` the session ended on. */
      apiErrorCode?: string;
    };

export interface WatchdogStatus {
  v: 1;
  mode: WatchdogMode;
  pid: number;
  home: string;
  startedAt: string;
  updatedAt: string;
  state: string;
  lastAction: string;
  runId: string | null;
  runnerPid: number | null;
  runnerCommand: string[] | null;
  counters: WatchdogCounters;
  nextWakeAt: string | null;
  stall: { logPath: string; lastMtime: string } | null;
  terminal: { status: string; reason: string; exitCode: number; apiErrorCode?: string } | null;
}

export interface WatchdogEvent {
  at: string;
  action: string;
  detail: Record<string, unknown>;
}
