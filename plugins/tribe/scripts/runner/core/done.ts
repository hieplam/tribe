// core/done.ts — the runner's Done-run decisions (card runner-driver-only, D2/G4, spec §4.4-§4.5).
// PURE: results of commands arrive as arguments; spawning them is `DonePort` (adapters).
import type { TaskRef } from './types.ts';
import type { PlannedCommand } from './plan-index.ts';

/** Three unaccepted turns per step (failed Done runs and protocol errors both count), then the card
 * escalates `done_failed` (spec §4.4 item 6). A constant, not a flag. */
export const MAX_STEP_ATTEMPTS = 3;

export type Step = { kind: 'task'; index: number; taskId: string } | { kind: 'deliver' };

/** The first task with no `passedSha`; `deliver` only when every task passed AND `doneSha` is set.
 * Every task passed with no `doneSha` cannot be produced by `applyPass`; if a hand edit makes it,
 * the last task is redone rather than delivering unverified work. */
export function nextStep(card: { tasks: readonly TaskRef[]; doneSha?: string }): Step {
  const index = card.tasks.findIndex((task) => task.passedSha === undefined);
  if (index >= 0) return { kind: 'task', index, taskId: (card.tasks[index] as TaskRef).id };
  if (card.doneSha !== undefined) return { kind: 'deliver' };
  const last = card.tasks.length - 1;
  return { kind: 'task', index: last, taskId: (card.tasks[last] as TaskRef).id };
}

export interface DoneCommandResult {
  command: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
}

export interface DoneRunVerdict {
  passed: boolean;
  failed: { planned: PlannedCommand; result: DoneCommandResult } | null;
  notRun: PlannedCommand[];
}

/** `results` are in plan order and stop at the first non-zero exit. A run is passed only when every
 * planned command ran and exited 0 — fewer results with no failure is NOT a pass (fail closed). */
export function judgeDoneRun(planned: readonly PlannedCommand[], results: readonly DoneCommandResult[]): DoneRunVerdict {
  const failedAt = results.findIndex((r) => r.exitCode !== 0 || r.timedOut);
  if (failedAt >= 0) {
    return {
      passed: false,
      failed: { planned: planned[failedAt] as PlannedCommand, result: results[failedAt] as DoneCommandResult },
      notRun: planned.slice(failedAt + 1),
    };
  }
  if (results.length < planned.length) return { passed: false, failed: null, notRun: planned.slice(results.length) };
  return { passed: true, failed: null, notRun: [] };
}

export type DoneRow =
  | ({ at: string; cardId: string; stepTask: string; attempt: number; sha: string; kind: 'command'; tasks: string[] } & DoneCommandResult)
  | { at: string; cardId: string; stepTask: string; attempt: number; sha: string; kind: 'done_run'; passed: boolean; failedCommand: string | null; notRun: string[] };

/** One row per executed command, then one summary row — the G4 record (`runs/<runId>/done.jsonl`). */
export function doneRows(p: {
  at: string; cardId: string; stepTask: string; attempt: number; sha: string;
  planned: readonly PlannedCommand[]; results: readonly DoneCommandResult[]; verdict: DoneRunVerdict;
}): DoneRow[] {
  const head = { at: p.at, cardId: p.cardId, stepTask: p.stepTask, attempt: p.attempt, sha: p.sha };
  const rows: DoneRow[] = p.results.map((r, i) => ({
    ...head, kind: 'command', command: r.command, tasks: [...(p.planned[i] as PlannedCommand).tasks],
    exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs, stdoutTail: r.stdoutTail, stderrTail: r.stderrTail,
  }));
  rows.push({
    ...head, kind: 'done_run', passed: p.verdict.passed,
    failedCommand: p.verdict.failed?.result.command ?? null, notRun: p.verdict.notRun.map((n) => n.command),
  });
  return rows;
}

/** A passing Done run through task `throughIndex` at `sha` passes every task 0..throughIndex (their
 * Done commands all ran green at that commit); `doneSha` is set only when the last task passed. */
export function applyPass(tasks: readonly TaskRef[], throughIndex: number, sha: string): { tasks: TaskRef[]; doneSha: string | null } {
  const next = tasks.map((task, i) => (i <= throughIndex ? { ...task, passedSha: sha } : { ...task }));
  return { tasks: next, doneSha: throughIndex === tasks.length - 1 ? sha : null };
}

/** The last 60 lines, capped at 4000 characters — what a done-failed turn and a row carry. */
export function tailOf(text: string): string {
  const lines = text.split('\n');
  const kept = lines.slice(Math.max(0, lines.length - 60)).join('\n');
  return kept.length > 4000 ? kept.slice(kept.length - 4000) : kept;
}
