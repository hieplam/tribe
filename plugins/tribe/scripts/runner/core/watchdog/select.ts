/** Pure selection and path math for the watchdog. No fs: the edge lists directories and hands
 * the entries in (structure.test.ts bans `node:fs` anywhere in core/**). */
import { join } from 'node:path';

/** Run ids are `<iso-with-separators-mapped>-<hex>` (`core/run-record.ts`'s generateRunId), so
 * lexicographic max is chronological max — no per-candidate file read. */
export function newestRunId(runIds: string[]): string | null {
  let newest: string | null = null;
  for (const id of runIds) if (newest === null || id > newest) newest = id;
  return newest;
}

/**
 * D2 (card watchdog-stall-after-quota-relaunch): the stall verdict only ever concerns the run
 * the watchdog is supervising RIGHT NOW. While this invocation owns a live child, any run
 * directory that already existed at the instant that child was spawned belongs to an EARLIER
 * run — the child's own directory does not exist yet, because a real forked process needs real
 * wall-clock time to create it (63-170 ms in the three recorded field sequences). Judging the
 * new runner against that earlier run's hours-old log is the whole defect: 11 of 11 recorded
 * `stall` events were false, each fired 1-20 ms after a launch/relaunch.
 *
 * FIX F1 (fix round 1): the first version of this predicate (`isOwnRunVisible`, now deleted)
 * answered "is MY run visible yet" by ORDERING — "is the newest id on disk greater than the
 * single id that predated the spawn". That is wrong whenever some OTHER, unrelated directory
 * already on disk (e.g. an earlier run, never deleted) sorts LEXICOGRAPHICALLY HIGHER than the
 * new child's own run id: the newest-on-disk id then stays pinned at that old value FOREVER —
 * not just for the 63-170 ms startup race this predicate was built for — and a genuinely
 * healthy, continuously-logging runner reads as "alive with no log" for its entire run, until
 * `noLogSince` fires a false `stall` after exactly `--stall-minutes`. Comparing by IDENTITY
 * (set difference) instead of ORDER fixes this and is immune to it BY CONSTRUCTION: it asks
 * "which ids on disk are NOT one of the ones that predated the spawn", never "is the newest
 * thing on disk newer than one particular id" — so it cannot be misled by any other id on disk,
 * however that id happens to sort, and needs no assumption about clock skew, NTP corrections or
 * drift between hosts sharing one campaign home.
 *
 * Returns the newest id among `runIds` that is NOT in `excluded` — `null` when every id on disk
 * is excluded (the honest "my directory has not appeared yet" state, which the caller already
 * handles by treating a `null` runId as not-yet-visible).
 */
export function newestRunIdExcluding(
  runIds: readonly string[],
  excluded: ReadonlySet<string>,
): string | null {
  let newest: string | null = null;
  for (const id of runIds) {
    if (excluded.has(id)) continue;
    if (newest === null || id > newest) newest = id;
  }
  return newest;
}

export interface LogEntry { name: string; mtimeMs: number }

/** Greatest mtime; ties broken by name so the choice is deterministic under a coarse clock. */
export function newestLog(entries: LogEntry[]): LogEntry | null {
  let newest: LogEntry | null = null;
  for (const entry of entries) {
    if (newest === null || entry.mtimeMs > newest.mtimeMs
      || (entry.mtimeMs === newest.mtimeMs && entry.name > newest.name)) newest = entry;
  }
  return newest;
}

/**
 * FIX F-C5 (audit round 2): `mtimeMs === null` used to mean "never stale" UNCONDITIONALLY — a
 * run that dies before writing its first log line had no bound at all, only the false comfort
 * of a `--stall-minutes` timeout measured against a signal that never existed (a reviewer
 * reproduced the runaway: it ran until `RangeError: Out of memory`). `sinceMs` is an optional
 * fallback silence-clock, used ONLY when no finer-grained `mtimeMs` signal exists yet — the
 * caller (`decide.ts`) feeds it `WatchdogRunObservation.noLogSinceMs`: THIS invocation's own
 * "first observed alive with no log" instant, never the run record's own `startedAt` (see that
 * field's doc comment in `model.ts` for why an external, unvalidated timestamp is the wrong
 * clock here). `sinceMs === null` (every 3-arg call site, including this file's own "never
 * stale" test) preserves the old behaviour exactly.
 */
export function isStale(
  nowMs: number,
  mtimeMs: number | null,
  stallMinutes: number,
  sinceMs: number | null = null,
): boolean {
  if (mtimeMs !== null) return nowMs - mtimeMs > stallMinutes * 60_000;
  if (sinceMs === null) return false; // a pass that has not written its first log is starting
  return nowMs - sinceMs > stallMinutes * 60_000;
}

export interface WatchdogPaths {
  dir: string;
  status: string;
  events: string;
  runnerStdout(attempt: number): string;
}

/** W-P9 / spec §7: every path the watchdog writes is under `<home>/watchdog/`. Nothing else in
 * the campaign home is ever written by this process. */
export function watchdogPathsOf(homeDir: string): WatchdogPaths {
  const dir = join(homeDir, 'watchdog');
  return {
    dir,
    status: join(dir, 'status.json'),
    events: join(dir, 'events.jsonl'),
    runnerStdout: (attempt: number) => join(dir, 'runner-stdout', `attempt-${attempt}.log`),
  };
}
