import { describe, expect, test } from 'bun:test';
import { driveCardTurns, type TurnDeps } from './turns.ts';
import type { SessionResult } from '../session.ts';
import type { DoneRunVerdict } from '../done.ts';
import type { Card } from '../types.ts';

const tasks = [
  { id: 'T1', heading: 'Task 1: a', doneCommands: ['go build ./...'] },
  { id: 'T2', heading: 'Task 2: b', doneCommands: ['go test ./...'] },
];
function card(): Card {
  return { status: 'running', spec: 's', plan: 'p', branch: null, baseSha: 'base', pr: null, mergeSha: null,
    sessionId: 'sess', updatedAt: null, tasks: [{ id: 'T1', heading: 'Task 1: a' }, { id: 'T2', heading: 'Task 2: b' }] };
}
const pass: DoneRunVerdict = { passed: true, failed: null, notRun: [] };
const fail: DoneRunVerdict = { passed: false, notRun: [], failed: { planned: { command: 'go test ./...', tasks: ['T2'] },
  result: { command: 'go test ./...', exitCode: 1, timedOut: false, durationMs: 1, stdoutTail: 'FAIL', stderrTail: '' } } };

function harness(turns: SessionResult[], verdicts: DoneRunVerdict[] = [], accept: Array<{ ok: true; tip: string } | { ok: false; reason: string }> = []) {
  const c = card();
  const prompts: string[] = [];
  const events: string[] = [];
  const deps: TurnDeps = {
    runTurn: async (prompt, first) => { prompts.push(prompt); events.push(first ? 'turn:first' : 'turn'); const next = turns.shift(); if (!next) throw new Error('unscripted turn'); return next; },
    acceptTaskDone: async (branch) => accept.shift() ?? { ok: true, tip: `tip-of-${branch}` },
    runDone: async (planned, sha, stepTaskId, attempt) => { events.push(`done:${stepTaskId}:${planned.map((p) => p.command).join('+')}:${sha}:${attempt}`); return { kind: 'verdict', verdict: verdicts.shift() ?? pass }; },
    recordBranch: (branch) => { c.branch ??= branch; },
    recordPass: (i, sha, branch) => { events.push(`pass:${i}:${sha}`); c.tasks = c.tasks.map((t, j) => (j <= i ? { ...t, passedSha: sha } : t)); if (i === c.tasks.length - 1) c.doneSha = sha; c.branch ??= branch; },
    clearFinalPass: () => { delete c.doneSha; delete c.tasks[c.tasks.length - 1]?.passedSha; },
    finishShipped: async (r) => { events.push(`shipped:${r.pr}`); return { kind: 'shipped', cardId: 'C1' }; },
    escalate: async (reason, detail) => { events.push(`escalate:${reason}`); return { kind: 'escalated', cardId: 'C1', escalationPath: '/e', reason: `${reason}|${detail}` }; },
  };
  return { c, deps, prompts, events };
}
const taskDone = (taskId: string, branch = 'b'): SessionResult => ({ outcome: 'task_done', finalText: '', taskId, branch });
const shipped: SessionResult = { outcome: 'shipped', finalText: '', pr: 7, sha: 'm' };

describe('driveCardTurns — spec §4.4', () => {
  test('happy path: T1, T2 (cumulative Done), deliver, shipped', async () => {
    const h = harness([taskDone('T1'), taskDone('T2'), shipped]);
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('shipped');
    expect(h.events).toEqual([
      'turn:first', 'done:T1:go build ./...:tip-of-b:1', 'pass:0:tip-of-b',
      'turn', 'done:T2:go build ./...+go test ./...:tip-of-b:1', 'pass:1:tip-of-b',
      'turn', 'shipped:7',
    ]);
    expect(h.prompts[0]?.split('\n')[0]).toBe('## This turn: task T1 — Task 1: a');
    expect(h.prompts[2]?.split('\n')[0]).toBe('## This turn: deliver');
  });
  test('a failing Done run re-prompts with the failure; three failures escalate done_failed', async () => {
    const h = harness([taskDone('T1'), taskDone('T1'), taskDone('T1')], [fail, fail, fail]);
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('escalated');
    expect(h.events.filter((e) => e.startsWith('escalate'))).toEqual(['escalate:done_failed']);
    expect(h.prompts[1]?.split('\n')[0]).toBe('## This turn: task T1 again — its Done commands failed');
    expect(h.c.tasks[0]?.passedSha).toBeUndefined();
  });
  test('a pass resets the budget: fail, pass, then the next task starts at attempt 1', async () => {
    const h = harness([taskDone('T1'), taskDone('T1'), taskDone('T2'), shipped], [fail, pass, pass]);
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.events.filter((e) => e.startsWith('done:'))).toEqual([
      'done:T1:go build ./...:tip-of-b:1', 'done:T1:go build ./...:tip-of-b:2', 'done:T2:go build ./...+go test ./...:tip-of-b:1',
    ]);
  });
  test('SHIPPED before every task passed is refused; it never reaches finishShipped', async () => {
    const h = harness([shipped, shipped, shipped]);
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('escalated');
    expect(h.events).not.toContain('shipped:7');
    expect(h.prompts[1]).toContain('SHIPPED arrived before every task passed its Done commands');
  });
  test('the wrong task id, or a branch the runner cannot accept, is a protocol error', async () => {
    const h = harness([taskDone('T2'), taskDone('T1'), taskDone('T1'), taskDone('T2'), shipped], [], [{ ok: false, reason: 'branch b does not exist' }]);
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.prompts[1]).toContain('the runner asked for task T1; you reported T2');
    expect(h.prompts[2]).toContain('branch b does not exist');
  });
  test('during delivery, TASK_DONE of the last task re-runs every Done command, then delivers again', async () => {
    const h = harness([taskDone('T1'), taskDone('T2'), taskDone('T2', 'b'), shipped]);
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.events.filter((e) => e.startsWith('done:T2'))).toHaveLength(2);
    expect(h.events.at(-1)).toBe('shipped:7');
  });
  test('during delivery, a passing TASK_DONE re-check still spends the budget: 3 re-checks without SHIPPED escalate', async () => {
    const h = harness([taskDone('T2'), taskDone('T2'), taskDone('T2')]);
    h.c.tasks = h.c.tasks.map((t) => ({ ...t, passedSha: 'x' }));
    h.c.doneSha = 'x';
    h.c.branch = 'b';
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('escalated');
    expect(h.events.filter((e) => e.startsWith('turn'))).toHaveLength(3);
    expect(h.events.filter((e) => e.startsWith('pass:1:'))).toHaveLength(3);
    expect(h.events.filter((e) => e.startsWith('escalate'))).toEqual(['escalate:done_failed']);
    expect(h.events).not.toContain('shipped:7');
    const reason = out.kind === 'escalated' ? out.reason : '';
    expect(reason).toStartWith('done_failed|delivery: 3 turns the runner could not accept. Last: ');
    expect(reason).toContain('tip-of-b passed');
    expect(reason).toContain('TASK_DONE instead of SHIPPED');
  });
  test('NEEDS_DIRECTION escalates; error and timeout stop (retryable only for error)', async () => {
    const nd = harness([{ outcome: 'needs_direction', finalText: 'NEEDS_DIRECTION: which?' }]);
    expect((await driveCardTurns({ cardId: 'C1', card: nd.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, nd.deps)).kind).toBe('escalated');
    const er = harness([{ outcome: 'error', finalText: 'x' }]);
    expect(await driveCardTurns({ cardId: 'C1', card: er.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, er.deps)).toMatchObject({ kind: 'stopped', retryable: true });
    const to = harness([{ outcome: 'timeout', finalText: 'x' }]);
    expect(await driveCardTurns({ cardId: 'C1', card: to.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, to.deps)).toMatchObject({ kind: 'stopped', retryable: false });
  });
  test('a card resumed with every task passed goes straight to delivery', async () => {
    const h = harness([shipped], [pass]);
    h.c.tasks = h.c.tasks.map((t) => ({ ...t, passedSha: 'x' }));
    h.c.doneSha = 'x';
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.prompts[0]?.split('\n')[0]).toBe('## This turn: deliver');
  });
  test('an accepted branch is recorded before a failing Done run and NEEDS_DIRECTION', async () => {
    const h = harness([taskDone('T1'), { outcome: 'needs_direction', finalText: 'NEEDS_DIRECTION: help' }], [fail]);
    const runDone = h.deps.runDone;
    h.deps.runDone = (...args) => {
      expect(h.c.branch).toBe('b');
      return runDone(...args);
    };
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('escalated');
    expect(h.c.branch).toBe('b');
  });
  test('a deliver-ready card re-runs the full current Done set at doneSha before delivery', async () => {
    const h = harness([shipped], [pass]);
    h.c.tasks = h.c.tasks.map((t) => ({ ...t, passedSha: 'old-sha' }));
    h.c.doneSha = 'old-sha';
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.events.filter((e) => e.startsWith('done:'))).toEqual(['done:T2:go build ./...+go test ./...:old-sha:1']);
    expect(h.prompts[0]?.split('\n')[0]).toBe('## This turn: deliver');
  });
  test('a failing delivery-entry re-check clears final progress and opens a done-failed turn', async () => {
    const h = harness([{ outcome: 'needs_direction', finalText: 'NEEDS_DIRECTION: help' }], [fail]);
    h.c.branch = 'b';
    h.c.tasks = h.c.tasks.map((t) => ({ ...t, passedSha: 'old-sha' }));
    h.c.doneSha = 'old-sha';
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.c.doneSha).toBeUndefined();
    expect(h.c.tasks[0]?.passedSha).toBe('old-sha');
    expect(h.c.tasks[1]?.passedSha).toBeUndefined();
    expect(h.prompts[0]?.split('\n')[0]).toBe('## This turn: task T2 again — its Done commands failed');
    expect(h.prompts[0]).toContain('attempt 1 of 3');
  });
  test('passing the last task inside this call does not re-run Done on delivery entry', async () => {
    const h = harness([taskDone('T2'), shipped], [pass]);
    h.c.tasks[0]!.passedSha = 'prior';
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.events.filter((e) => e.startsWith('done:'))).toHaveLength(1);
    expect(h.prompts[1]?.split('\n')[0]).toBe('## This turn: deliver');
  });
});
