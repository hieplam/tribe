/** Pure shaping of the watchdog's two artifacts and its stdout line. Timestamps arrive as
 * arguments (ISO strings or epoch ms) — this module never reads a clock. */
import {
  WATCHDOG_EXIT_DONE, WATCHDOG_EXIT_NEEDS_HUMAN, WATCHDOG_EXIT_RUNNING,
  type WatchdogAction, type WatchdogCounters, type WatchdogEvent, type WatchdogMode,
  type WatchdogStatus,
} from './model.ts';

/** G1 (group-B audit round 1): a millisecond value arriving from `decide.ts` is not
 * guaranteed finite by the type system alone — surface a non-finite value as a clearly
 * invalid marker rather than letting `new Date(x).toISOString()` throw an uncaught
 * `RangeError`, which would defeat the whole point of a process meant to survive crashes. */
function isoOrInvalid(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '(invalid-timestamp)';
}

export function exitCodeOf(action: Extract<WatchdogAction, { kind: 'exit' }>): number {
  switch (action.status) {
    case 'done': return WATCHDOG_EXIT_DONE;
    case 'needs_human': return WATCHDOG_EXIT_NEEDS_HUMAN;
    case 'running': return WATCHDOG_EXIT_RUNNING;
  }
}

export interface BuildStatusInput {
  config: { mode: WatchdogMode };
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
  nextWakeAtMs: number | null;
  stall: { logPath: string; lastMtimeMs: number } | null;
  terminal: { status: string; reason: string; exitCode: number; apiErrorCode?: string } | null;
}

export function buildStatus(input: BuildStatusInput): WatchdogStatus {
  return {
    v: 1,
    mode: input.config.mode,
    pid: input.pid,
    home: input.home,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    state: input.state,
    lastAction: input.lastAction,
    runId: input.runId,
    runnerPid: input.runnerPid,
    runnerCommand: input.runnerCommand,
    counters: { ...input.counters },
    nextWakeAt: input.nextWakeAtMs === null ? null : isoOrInvalid(input.nextWakeAtMs),
    stall: input.stall === null
      ? null
      : { logPath: input.stall.logPath, lastMtime: isoOrInvalid(input.stall.lastMtimeMs) },
    terminal: input.terminal,
  };
}

export function serializeStatus(status: WatchdogStatus): string {
  return `${JSON.stringify(status, null, 2)}\n`;
}

export function serializeEvent(event: WatchdogEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Spec §2.1: "Stdout: one human line per action". */
export function actionLine(action: WatchdogAction): string {
  switch (action.kind) {
    case 'launch':
      return 'launch: starting the campaign runner';
    case 'attach':
      return `attach: runner pid ${action.runnerPid} is already live — waiting on it`;
    case 'wait_until': {
      const until = isoOrInvalid(action.untilMs);
      return action.cause === 'quota'
        ? `quota_wait: account limit — waiting until ${until}`
        : `overload_backoff: upstream overloaded — waiting until ${until}`;
    }
    case 'relaunch':
      return action.model === null
        ? `relaunch: cause ${action.cause}`
        : `relaunch: cause ${action.cause} on fallback model ${action.model}`;
    case 'stall':
      return `stall: no log activity in ${action.logPath ?? '(no log yet)'} since ` +
        `${isoOrInvalid(action.lastMtimeMs ?? 0)}`;
    case 'exit':
      return `exit: ${action.status}:${action.reason}`;
  }
}
