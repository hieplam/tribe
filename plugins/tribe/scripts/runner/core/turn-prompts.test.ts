import { describe, expect, test } from 'bun:test';
import { countTribeMentions } from '../../tests/runner-driver-only/tribe-lexicon.ts';
import { deliverTurnPrompt, doneFailedTurnPrompt, progressDigestLines, protocolErrorTurnPrompt, taskTurnPrompt } from './turn-prompts.ts';

const task = { id: 'T2', heading: 'Task 2: `mathx.Max`', doneCommands: ['go build ./...', 'go test ./...'] };

describe('turn prompts', () => {
  test('task turn: machine-readable first line, the task, its Done commands, the terminal line', () => {
    const p = taskTurnPrompt({ task, planPath: 'docs/plans/p.md' });
    expect(p.split('\n')[0]).toBe('## This turn: task T2 — Task 2: `mathx.Max`');
    for (const s of ['docs/plans/p.md', '    go build ./...', '    go test ./...', '`TASK_DONE T2 <branch>`']) expect(p).toContain(s);
  });
  test('done-failed turn: command, exit, output tails, not-run list, attempt counter', () => {
    const p = doneFailedTurnPrompt({ task, branch: 'b', sha: 'abc1234', failed: { command: 'go test ./...', exitCode: 1, timedOut: false, durationMs: 2100, stdoutTail: 'FAIL x', stderrTail: '' }, notRun: ['go vet ./...'], attempt: 1, max: 3 });
    expect(p.split('\n')[0]).toBe('## This turn: task T2 again — its Done commands failed');
    for (const s of ['$ go test ./...', 'exit 1', 'FAIL x', 'not run: go vet ./...', 'attempt 1 of 3', '`TASK_DONE T2 b`']) expect(p).toContain(s);
  });
  test('protocol-error turn names the reason, then repeats the step (task or deliver)', () => {
    const p = protocolErrorTurnPrompt({ reason: 'the runner asked for task T2; you reported T3', stepPrompt: taskTurnPrompt({ task, planPath: 'docs/plans/p.md' }), attempt: 2, max: 3 });
    expect(p.split('\n')[0]).toBe('## This turn: task T2 — the runner could not accept your last turn');
    for (const s of ['you reported T3', 'attempt 2 of 3', '`TASK_DONE T2 <branch>`']) expect(p).toContain(s);
    const d = protocolErrorTurnPrompt({ reason: 'x', stepPrompt: deliverTurnPrompt({ branch: 'b', sha: 's', baseBranch: 'master', remote: 'origin', repoRoot: '/r', lastTaskId: 'T4' }), attempt: 1, max: 3 });
    expect(d.split('\n')[0]).toBe('## This turn: deliver — the runner could not accept your last turn');
    expect(d).toContain('SHIPPED <pr> <merge-sha>');
  });
  test('deliver turn: the D4 sequence and both exits', () => {
    const p = deliverTurnPrompt({ branch: 'b', sha: 'abc1234', baseBranch: 'master', remote: 'origin', repoRoot: '/r', lastTaskId: 'T4' });
    expect(p.split('\n')[0]).toBe('## This turn: deliver');
    for (const s of ['gh pr checks', 'gh pr merge --merge', 'git push origin --delete b', 'git worktree remove', 'git -C /r merge --ff-only origin/master', 'SHIPPED <pr> <merge-sha>', '`TASK_DONE T4 b`']) expect(p).toContain(s);
  });
  test('progress digest names passed tasks, the commit, the branch and the next step', () => {
    const lines = progressDigestLines({ tasks: [{ id: 'T1', heading: 'a', passedSha: 'abc' }, { id: 'T2', heading: 'b' }], branch: 'feat/x', doneSha: undefined });
    expect(lines.join('\n')).toContain('- passed: T1 at abc');
    expect(lines.join('\n')).toContain('- next: task T2');
    expect(lines.join('\n')).toContain('feat/x');
  });
  test('no turn prompt carries the Tribe way of working', () => {
    const all = [taskTurnPrompt({ task, planPath: 'p' }), deliverTurnPrompt({ branch: 'b', sha: 's', baseBranch: 'master', remote: 'origin', repoRoot: '/r', lastTaskId: 'T4' })].join('\n');
    expect(countTribeMentions(all)).toEqual([]);
  });
});
