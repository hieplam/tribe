// core/loop/turns.ts — the runner drives ONE card's plan, turn by turn (card runner-driver-only,
// spec §4.4). Every effect (a session turn, git, a Done run, a state write, an escalation) arrives
// through `TurnDeps`; this module only decides what the next turn is and what a turn's answer means.
import type { Card } from '../types.ts';
import type { SessionResult } from '../session.ts';
import type { CardOutcome } from './card-actions.ts';
import { doneCommandsThrough, type PlannedCommand, type ResolvedTask } from '../plan-index.ts';
import { MAX_STEP_ATTEMPTS, nextStep, type DoneRunVerdict, type Step } from '../done.ts';
import { deliverTurnPrompt, doneFailedTurnPrompt, protocolErrorTurnPrompt, taskTurnPrompt } from '../turn-prompts.ts';

export interface TurnDeps {
  /** One session turn. `first` = the card's first turn in this call (the caller composes the full
   * brief or resumes the recorded session); later turns resume the same session. */
  runTurn(prompt: string, first: boolean): Promise<SessionResult>;
  /** Trust the disk: the branch exists, descends from the card's base, and (once known) is the card's branch. */
  acceptTaskDone(branch: string): Promise<{ ok: true; tip: string } | { ok: false; reason: string }>;
  /** Runs `planned` at `sha` in a scratch checkout, stops at the first failure, appends the rows. A
   * failure of the runner's OWN checkout is `infrastructure` — never charged to the session. */
  runDone(planned: PlannedCommand[], sha: string, stepTaskId: string, attempt: number):
    Promise<{ kind: 'verdict'; verdict: DoneRunVerdict } | { kind: 'infrastructure'; reason: string }>;
  /** Persist the first accepted branch before its Done run can fail. */
  recordBranch(branch: string): void;
  /** Tasks 0..throughIndex passed at `sha` on `branch`: record and persist. */
  recordPass(throughIndex: number, sha: string, branch: string): void;
  /** A stale deliver-entry Done run failed: clear and persist the last task's pass and doneSha. */
  clearFinalPass(): void;
  /** SHIPPED at the deliver step: the existing D4 verify, then ship or escalate. */
  finishShipped(result: SessionResult): Promise<CardOutcome>;
  escalate(reason: string, detail: string): Promise<CardOutcome>;
}

export interface DriveInput {
  cardId: string;
  /** The LIVE state entry — `recordPass` mutates it; `nextStep` reads it every turn. */
  card: Card;
  tasks: readonly ResolvedTask[];
  planPath: string;
  delivery: { baseBranch: string; remote: string; repoRoot: string };
}

function stepPrompt(step: Step, input: DriveInput): string {
  if (step.kind === 'deliver') {
    const last = input.tasks[input.tasks.length - 1] as ResolvedTask;
    return deliverTurnPrompt({
      branch: input.card.branch ?? '(your card branch)', sha: input.card.doneSha ?? '(unknown)',
      baseBranch: input.delivery.baseBranch, remote: input.delivery.remote, repoRoot: input.delivery.repoRoot, lastTaskId: last.id,
    });
  }
  return taskTurnPrompt({ task: input.tasks[step.index] as ResolvedTask, planPath: input.planPath });
}

export async function driveCardTurns(input: DriveInput, deps: TurnDeps): Promise<CardOutcome> {
  let attempts = 0;
  let override: string | null = null;
  let lastProblem = '';
  let first = true;
  if (nextStep(input.card).kind === 'deliver') {
    const last = input.tasks[input.tasks.length - 1] as ResolvedTask;
    const sha = input.card.doneSha as string;
    const run = await deps.runDone(doneCommandsThrough(input.tasks, input.tasks.length - 1), sha, last.id, 1);
    if (run.kind === 'infrastructure') {
      return { kind: 'stopped', cardId: input.cardId, reason: `the runner could not run the Done commands: ${run.reason}`, retryable: false };
    }
    if (!run.verdict.passed) {
      deps.clearFinalPass();
      attempts = 1;
      const failed = run.verdict.failed;
      lastProblem = failed
        ? `\`${failed.result.command}\` ${failed.result.timedOut ? 'timed out' : `exited ${failed.result.exitCode}`} at ${sha}\n${failed.result.stdoutTail}\n${failed.result.stderrTail}`
        : `the Done run at ${sha} did not complete`;
      override = failed
        ? doneFailedTurnPrompt({ task: last, branch: input.card.branch ?? '(your card branch)', sha, failed: failed.result, notRun: run.verdict.notRun.map((n) => n.command), attempt: 1, max: MAX_STEP_ATTEMPTS })
        : protocolErrorTurnPrompt({ reason: lastProblem, stepPrompt: taskTurnPrompt({ task: last, planPath: input.planPath }), attempt: 1, max: MAX_STEP_ATTEMPTS });
    }
  }
  for (;;) {
    const step = nextStep(input.card);
    const plain = stepPrompt(step, input);
    const prompt = override ?? plain;
    override = null;
    const result = await deps.runTurn(prompt, first);
    first = false;

    if (result.outcome === 'error' || result.outcome === 'timeout') {
      return {
        kind: 'stopped', cardId: input.cardId,
        reason: `session ended with outcome "${result.outcome}": ${result.finalText}`,
        retryable: result.outcome === 'error',
      };
    }
    if (result.outcome === 'needs_direction') return deps.escalate('needs_direction', result.finalText);

    // A turn the runner cannot accept costs one attempt of THIS step; the fourth escalates.
    const refuse = (reason: string): boolean => {
      attempts += 1;
      lastProblem = reason;
      override = protocolErrorTurnPrompt({ reason, stepPrompt: plain, attempt: attempts, max: MAX_STEP_ATTEMPTS });
      return attempts >= MAX_STEP_ATTEMPTS;
    };
    // During delivery every turn that does not end in an accepted SHIPPED spends one attempt — a
    // passing TASK_DONE re-check included — so a session that never delivers cannot loop forever.
    const delivering = step.kind === 'deliver';
    const stepName = delivering ? 'delivery' : `task ${step.taskId}`;
    const budgetSpent = () => deps.escalate('done_failed',
      `${stepName}: ${MAX_STEP_ATTEMPTS} turns the runner could not accept. Last: ${lastProblem}`);

    if (result.outcome === 'shipped') {
      if (delivering) return deps.finishShipped(result);
      const pending = input.card.tasks.filter((t) => t.passedSha === undefined).map((t) => t.id).join(', ');
      if (refuse(`SHIPPED arrived before every task passed its Done commands (${pending || 'the last Done run'} remaining)`)) return budgetSpent();
      continue;
    }

    // outcome === 'task_done': at a task step it must name that task; during delivery, the last task
    // (re-verify after a code change — spec §4.4 item 2).
    const expectedIndex = step.kind === 'task' ? step.index : input.tasks.length - 1;
    const expected = input.tasks[expectedIndex] as ResolvedTask;
    if (result.taskId !== expected.id) {
      if (refuse(`the runner asked for task ${expected.id}; you reported ${String(result.taskId)}`)) return budgetSpent();
      continue;
    }
    const branch = result.branch as string;
    const accepted = await deps.acceptTaskDone(branch);
    if (!accepted.ok) {
      if (refuse(accepted.reason)) return budgetSpent();
      continue;
    }
    if (input.card.branch === null) deps.recordBranch(branch);
    const planned = doneCommandsThrough(input.tasks, expectedIndex);
    const run = await deps.runDone(planned, accepted.tip, expected.id, attempts + 1);
    if (run.kind === 'infrastructure') {
      return { kind: 'stopped', cardId: input.cardId, reason: `the runner could not run the Done commands: ${run.reason}`, retryable: false };
    }
    if (run.verdict.passed) {
      deps.recordPass(expectedIndex, accepted.tip, branch);
      if (!delivering) {
        attempts = 0;
        continue;
      }
      attempts += 1;
      lastProblem = `the Done re-check at ${accepted.tip} passed, but the turn ended with TASK_DONE instead of SHIPPED`;
      if (attempts >= MAX_STEP_ATTEMPTS) return budgetSpent();
      continue; // the next deliver prompt carries the new doneSha
    }
    attempts += 1;
    const failed = run.verdict.failed;
    lastProblem = failed
      ? `\`${failed.result.command}\` ${failed.result.timedOut ? 'timed out' : `exited ${failed.result.exitCode}`} at ${accepted.tip}\n${failed.result.stdoutTail}\n${failed.result.stderrTail}`
      : `the Done run at ${accepted.tip} did not complete`;
    if (attempts >= MAX_STEP_ATTEMPTS) {
      if (delivering) return budgetSpent();
      return deps.escalate('done_failed', `task ${expected.id} (${expected.heading}) did not pass its Done commands after ${MAX_STEP_ATTEMPTS} attempts. Last: ${lastProblem}`);
    }
    override = failed
      ? doneFailedTurnPrompt({ task: expected, branch, sha: accepted.tip, failed: failed.result, notRun: run.verdict.notRun.map((n) => n.command), attempt: attempts, max: MAX_STEP_ATTEMPTS })
      : protocolErrorTurnPrompt({ reason: lastProblem, stepPrompt: plain, attempt: attempts, max: MAX_STEP_ATTEMPTS });
  }
}
