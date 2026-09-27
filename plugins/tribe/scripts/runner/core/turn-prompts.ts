// core/turn-prompts.ts — every prompt the runner sends between turns (card runner-driver-only, spec
// §4.4). PURE: facts in, text out. The first line of every prompt is machine-readable
// (`## This turn: task <id> …` / `## This turn: deliver`) — tests and doubles key on it.
import type { ResolvedTask } from './plan-index.ts';
import type { TaskRef } from './types.ts';

function commandBlock(commands: readonly string[]): string {
  return commands.map((c) => `    ${c}`).join('\n');
}

export function taskTurnPrompt(p: { task: ResolvedTask; planPath: string }): string {
  return [
    `## This turn: task ${p.task.id} — ${p.task.heading}`,
    '',
    `Do task ${p.task.id} of the plan (${p.planPath}, section "${p.task.heading}"), the way the plan says, and commit it on your card branch.`,
    'The runner will then run these Done commands itself, from a clean checkout of your branch tip, together with the Done commands of every task before this one:',
    '',
    commandBlock(p.task.doneCommands),
    '',
    `End your turn with \`TASK_DONE ${p.task.id} <branch>\`.`,
  ].join('\n');
}

export function doneFailedTurnPrompt(p: {
  task: ResolvedTask; branch: string; sha: string;
  failed: { command: string; exitCode: number; timedOut: boolean; durationMs: number; stdoutTail: string; stderrTail: string };
  notRun: readonly string[]; attempt: number; max: number;
}): string {
  const outcome = p.failed.timedOut ? 'timed out' : `exit ${p.failed.exitCode}`;
  return [
    `## This turn: task ${p.task.id} again — its Done commands failed`,
    '',
    `The runner checked out ${p.sha} (branch ${p.branch}) and ran the Done commands. This one failed:`,
    '',
    `    $ ${p.failed.command}`,
    `    ${outcome} after ${(p.failed.durationMs / 1000).toFixed(1)}s`,
    '',
    '--- stdout (last lines) ---',
    p.failed.stdoutTail || '(empty)',
    '--- stderr (last lines) ---',
    p.failed.stderrTail || '(empty)',
    '',
    p.notRun.length > 0 ? `not run: ${p.notRun.join(' | ')}` : 'every other command ran and passed.',
    '',
    `This was attempt ${p.attempt} of ${p.max} for task ${p.task.id}. Fix it, commit, and end your turn with \`TASK_DONE ${p.task.id} ${p.branch}\`.`,
  ].join('\n');
}

/** Wraps the step's own prompt: the machine-readable first line keeps the step (`task <id>` or
 * `deliver`), then the reason, then the step's instructions again. */
export function protocolErrorTurnPrompt(p: { reason: string; stepPrompt: string; attempt: number; max: number }): string {
  const [first, ...rest] = p.stepPrompt.split('\n');
  const step = /^## This turn: (task \S+|deliver)/.exec(first ?? '')?.[1] ?? 'deliver';
  return [
    `## This turn: ${step} — the runner could not accept your last turn`,
    '',
    `Why: ${p.reason}.`,
    `This was attempt ${p.attempt} of ${p.max} for this step.`,
    ...rest,
  ].join('\n');
}

export function deliverTurnPrompt(p: { branch: string; sha: string; baseBranch: string; remote: string; repoRoot: string; lastTaskId: string }): string {
  return [
    '## This turn: deliver',
    '',
    `Every task passed its Done commands at ${p.sha} on ${p.branch}. Deliver the card now:`,
    `1. push ${p.branch} and open (or reuse) its PR against ${p.baseBranch};`,
    `2. wait in the foreground until every check concludes green: \`gh pr checks <pr> --watch\` (timeout: 600000), re-run if 10 minutes is not enough;`,
    '3. merge with `gh pr merge --merge`;',
    `4. delete the remote branch (\`git push ${p.remote} --delete ${p.branch}\`) and remove your worktree (\`git worktree remove <path>\`);`,
    `5. fast-forward the local base: \`git -C ${p.repoRoot} merge --ff-only ${p.remote}/${p.baseBranch}\`.`,
    '',
    'Then end your turn with `SHIPPED <pr> <merge-sha>`.',
    `If you change any code during delivery, commit and push it, and end your turn with \`TASK_DONE ${p.lastTaskId} ${p.branch}\` instead: the runner re-runs the Done commands and the merge gate only accepts the commit they passed on.`,
  ].join('\n');
}

/** Lines for the fresh-with-digest fallback (spec §4.4 item 9). */
export function progressDigestLines(card: { tasks: readonly TaskRef[]; branch: string | null; doneSha: string | undefined }): string[] {
  const passed = card.tasks.filter((t) => t.passedSha !== undefined);
  const next = card.tasks.find((t) => t.passedSha === undefined);
  return [
    'Task progress (the runner ran these Done commands itself):',
    ...(passed.length > 0 ? passed.map((t) => `- passed: ${t.id} at ${t.passedSha as string}`) : ['- passed: none yet']),
    `- branch: ${card.branch ?? '(none recorded)'}`,
    next ? `- next: task ${next.id} — ${next.heading}` : card.doneSha ? '- next: deliver' : '- next: the last task again',
  ];
}
