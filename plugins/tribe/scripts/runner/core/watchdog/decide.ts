/**
 * The watchdog's PURE decision core (D74-3): `(observation) -> action`. No clock, no fs, no
 * spawn, no throw — every world fact arrives on the observation, so the whole action table is
 * exercised as data (`decide.test.ts`, 40 rows).
 *
 * Precedence (W-P1): a terminal runner exit (0/2/4) answers first — it is more informative
 * than `stop_requested`. STOP then suppresses everything that would START work (launch,
 * relaunch, wait). Within exit 3, a rejected quota signal outranks an overload signal: a quota
 * wall has a known reset instant, a 529 is transient.
 */
import type { WatchdogAction, WatchdogObservation } from './model.ts';
// G3 (group-B audit round 1, class `agreed`): delegate to select.ts's isStale rather than
// duplicate its `>` inline — a sibling module inside core/watchdog/, so this keeps the core
// pure and breaks no layering rule.
import { isStale } from './select.ts';

/** Spec §8, verbatim: 30 s, 60 s, 120 s, 240 s, 480 s, then clamped. */
const OVERLOAD_BACKOFF_SECONDS = [30, 60, 120, 240, 480];

/** FIX S3 (audit round, final): `resetsAtEpochS` is untrusted log content, validated only by
 * `Number.isFinite` before it reaches here — a corrupted or hostile value (a millisecond-scale
 * timestamp landing in a field documented as seconds; `+058647-09-15…` was the reproduction)
 * must never compute an unbounded wait. Real account-limit windows are hours
 * (`rate_limit_info.rateLimitType`, e.g. `five_hour`); a week is a generous outer bound that
 * still rejects a decades-long bogus deadline. */
export const MAX_QUOTA_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

/** Total over every `number` (G1, group-B audit round 1): a fractional, `NaN`, negative or
 * out-of-range attempt must still land on a defined entry, never `undefined` — a non-finite
 * attempt saturates to the first entry, everything else rounds to its nearest index and clamps
 * into range (the table's last entry is the natural saturation point). */
export function overloadBackoffSeconds(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? attempt : 0;
  const index = Math.min(Math.max(Math.round(safeAttempt), 0), OVERLOAD_BACKOFF_SECONDS.length - 1);
  return OVERLOAD_BACKOFF_SECONDS[index] as number;
}

const STOP: WatchdogAction = { kind: 'exit', status: 'done', reason: 'stop_requested' };

export function decide(o: WatchdogObservation): WatchdogAction {
  // --- 1. A live runner: never launch a second one (D74-7). Stall is the only thing that can
  // end the wait, and it NEVER kills the runner (card G4: the runner's own --session-timeout
  // owns that) — it reports, and in follow mode hands the decision to a human.
  if (o.run?.alive) {
    const mtime = o.run.newestLogMtimeMs;
    // FIX F-C5: falls back to this invocation's own "alive with no log" clock when no log has
    // ever been written (`mtime === null`) — otherwise this branch attaches forever.
    const stalled = isStale(o.nowMs, mtime, o.limits.stallMinutes, o.run.noLogSinceMs ?? null);
    if (stalled) {
      return {
        kind: 'stall',
        logPath: o.run.newestLogPath,
        lastMtimeMs: mtime,
        exit: { status: o.mode === 'once' ? 'running' : 'needs_human', reason: 'stalled' },
      };
    }
    if (o.mode === 'once') return { kind: 'exit', status: 'running', reason: 'runner_alive' };
    return { kind: 'attach', runnerPid: o.run.runnerPid };
  }

  // --- 2. Terminal runner outcomes (W-P1: these outrank a STOP file).
  switch (o.lastExitCode) {
    case 0: return { kind: 'exit', status: 'done', reason: 'runner_done' };
    case 2: return { kind: 'exit', status: 'needs_human', reason: 'escalations_pending' };
    case 4: return { kind: 'exit', status: 'needs_human', reason: 'error' };
    default: break;
  }

  // --- 3. Exit 1: the single-instance lock refused the start.
  if (o.lastExitCode === 1) {
    // FIX F-C3: mirrors section 1's mode guard — a foreign live holder is exactly the "a
    // runner is alive" case W-P5 forbids `--once` from sleeping on (spec 2.1 Never).
    if (o.lockHolder?.alive) {
      if (o.mode === 'once') return { kind: 'exit', status: 'running', reason: 'runner_alive' };
      return { kind: 'attach', runnerPid: o.lockHolder.pid };
    }
    // FIX F-C4: with no live foreign holder to explain it, an exit-1 record is otherwise "no
    // other signal" — spending the lockRelaunches budget on it requires THIS invocation to have
    // actually tracked the event (`lastExitCodeProvenanced`; defaults to `true` when the caller
    // never sets it — see `model.ts`). An unprovenanced record falls through to section 5's
    // fresh launch instead, exactly as if `lastExitCode` were `null`.
    if (o.lastExitCodeProvenanced ?? true) {
      if (o.stopFilePresent) return STOP;
      if (o.counters.lockRelaunches >= 1) {
        return { kind: 'exit', status: 'needs_human', reason: 'lock_conflict' };
      }
      return { kind: 'relaunch', cause: 'lock_free', model: null };
    }
  }

  // --- 4. Exit 3, an unknown runner exit, or a crash with no code to read (W-P6):
  // the recoverable deaths. Unknown exits must spend the same bounded crash budget as exit 3.
  const isUnknownExit = o.lastExitCode !== null && ![0, 1, 2, 3, 4].includes(o.lastExitCode);
  if (o.lastExitCode === 3 || isUnknownExit || (o.lastExitCode === null && o.crashSuspected)) {
    // A permanent API error (card runner-model-support, G3): no relaunch can succeed, so the
    // watchdog stops on the first occurrence — before quota, overload, crash budget and STOP,
    // because it is a terminal fact about the run, not a request to start work (W-P1). Only a run
    // THIS invocation tracked counts: an older run's log, read again after the owner fixed the
    // cause and relaunched, must launch a fresh runner instead (`lastExitCodeProvenanced`).
    const permanent = o.permanentApiError ?? null;
    if (permanent !== null && (o.lastExitCodeProvenanced ?? true)) {
      return { kind: 'exit', status: 'needs_human', reason: 'permanent_api_error', apiErrorCode: permanent.code };
    }
    // W-P2: a missing or already-elapsed reset is NOT a quota signal (spec §7).
    // FIX S3: clamp the computed deadline — untrusted log content must never produce an
    // unbounded wait (`MAX_QUOTA_WAIT_MS`, defined above beside `OVERLOAD_BACKOFF_SECONDS`).
    const quotaUntilMs = o.quota === null
      ? null
      : Math.min((o.quota.resetsAtEpochS + o.limits.quotaGraceSeconds) * 1000, o.nowMs + MAX_QUOTA_WAIT_MS);
    const quotaIsFuture = quotaUntilMs !== null && o.quota !== null
      && o.quota.resetsAtEpochS * 1000 > o.nowMs;

    if (quotaIsFuture) {
      if (o.stopFilePresent) return STOP;
      if (o.counters.quotaWaits >= o.limits.maxQuotaWaits) {
        return { kind: 'exit', status: 'needs_human', reason: 'quota_cap' };
      }
      if (o.mode === 'once') {
        // C3: the SAME instant a --follow wait_until would have used (quotaUntilMs is
        // computed once above, from this same observation) — never recomputed differently.
        return {
          kind: 'exit', status: 'running', reason: 'quota_wait_pending',
          nextWakeAtMs: quotaUntilMs as number,
        };
      }
      return { kind: 'wait_until', untilMs: quotaUntilMs as number, cause: 'quota' };
    }

    // FIX F-C2: the quota deadline decayed into the past (or was never future), but if a
    // quota wait was ORDERED and its own deadline has now been served, this is a quota
    // recovery continuing — never the generic crash path (which mislabels it `cause: crash`
    // and drains the independent crash budget for a run that never crashed).
    const servedQuotaWait = o.quota !== null && o.pendingWait !== null
      && o.pendingWait.cause === 'quota' && o.nowMs >= o.pendingWait.untilMs;
    if (servedQuotaWait) {
      if (o.stopFilePresent) return STOP;
      return { kind: 'relaunch', cause: 'quota', model: null };
    }

    if (o.overload !== null) {
      if (o.stopFilePresent) return STOP;
      // FIX F-C1: the overload signal has no time-based decay of its own (a dead runner's log
      // never changes), so without this check every re-observation of the SAME still-529 log
      // re-entered this branch and ordered ANOTHER, longer wait — never a relaunch. Once the
      // wait we ordered has been served, retry now; the counter bumped when the wait was
      // ordered already makes the schedule escalate on the NEXT fresh occurrence.
      const servedOverloadWait = o.pendingWait !== null && o.pendingWait.cause === 'overload'
        && o.nowMs >= o.pendingWait.untilMs;
      if (servedOverloadWait) {
        return { kind: 'relaunch', cause: 'overload', model: null };
      }
      if (o.counters.overloadBackoffs >= o.limits.maxOverloadBackoffs) {
        if (o.fallbackModel !== null && !o.counters.fallbackUsed) {
          return { kind: 'relaunch', cause: 'overload', model: o.fallbackModel };
        }
        return { kind: 'exit', status: 'needs_human', reason: 'overloaded' };
      }
      // C3: computed BEFORE the mode branch so once-mode's `nextWakeAtMs` and follow-mode's
      // `wait_until.untilMs` are provably the same instant — never two separate calculations
      // that could drift apart.
      const seconds = overloadBackoffSeconds(o.counters.overloadBackoffs);
      const overloadUntilMs = o.nowMs + seconds * 1000;
      if (o.mode === 'once') {
        return {
          kind: 'exit', status: 'running', reason: 'overload_backoff_pending',
          nextWakeAtMs: overloadUntilMs,
        };
      }
      return { kind: 'wait_until', untilMs: overloadUntilMs, cause: 'overload' };
    }

    // FIX F-C4: with no quota/overload signal at all, this is otherwise "no other signal" — the
    // plain crash fallback below may only spend the crashRelaunches budget when THIS invocation
    // actually tracked the event (`lastExitCodeProvenanced`; `true` when omitted — see
    // `model.ts`). This is always true for the genuine `crashSuspected` case (a dead pid
    // confirmed THIS tick), so it changes nothing there. An unprovenanced record falls through
    // to section 5's fresh launch instead, exactly as if `lastExitCode` were `null`.
    if (o.lastExitCodeProvenanced ?? true) {
      if (o.stopFilePresent) return STOP;
      if (o.counters.crashRelaunches >= o.limits.maxCrashRelaunches) {
        return { kind: 'exit', status: 'needs_human', reason: 'session_incomplete' };
      }
      return { kind: 'relaunch', cause: 'crash', model: null };
    }
  }

  // --- 5. Nothing has run yet this invocation.
  // FIX F-C3: same mode guard as sections 1 and 3 — see their comments.
  if (o.lockHolder?.alive) {
    if (o.mode === 'once') return { kind: 'exit', status: 'running', reason: 'runner_alive' };
    return { kind: 'attach', runnerPid: o.lockHolder.pid };
  }
  if (o.stopFilePresent) return STOP;
  return { kind: 'launch' };
}
