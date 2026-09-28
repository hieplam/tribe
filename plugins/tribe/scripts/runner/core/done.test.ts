import { describe, expect, test } from 'bun:test';
import { MAX_STEP_ATTEMPTS, applyPass, doneRows, judgeDoneRun, nextStep, tailOf, type DoneCommandResult } from './done.ts';
import type { PlannedCommand } from './plan-index.ts';

const t = (id: string, passedSha?: string) => ({ id, heading: `Task ${id}`, ...(passedSha ? { passedSha } : {}) });
const res = (command: string, exitCode: number): DoneCommandResult =>
  ({ command, exitCode, timedOut: false, durationMs: 5, stdoutTail: 'out', stderrTail: 'err' });
const planned: PlannedCommand[] = [
  { command: 'go build ./...', tasks: ['T1', 'T2'] },
  { command: 'go test ./...', tasks: ['T2'] },
];

describe('nextStep', () => {
  test('the first task with no passedSha', () => {
    expect(nextStep({ tasks: [t('T1', 'a'), t('T2'), t('T3')] })).toEqual({ kind: 'task', index: 1, taskId: 'T2' });
  });
  test('deliver once every task passed AND doneSha is set', () => {
    expect(nextStep({ tasks: [t('T1', 'a')], doneSha: 'a' })).toEqual({ kind: 'deliver' });
  });
  test('every task passed but no doneSha (inconsistent) -> redo the last task, never deliver', () => {
    expect(nextStep({ tasks: [t('T1', 'a'), t('T2', 'a')] })).toEqual({ kind: 'task', index: 1, taskId: 'T2' });
  });
});

describe('judgeDoneRun', () => {
  test('all exit 0 -> passed', () => {
    expect(judgeDoneRun(planned, [res('go build ./...', 0), res('go test ./...', 0)])).toEqual({ passed: true, failed: null, notRun: [] });
  });
  test('the first non-zero stops the run; the rest are not run', () => {
    const v = judgeDoneRun(planned, [res('go build ./...', 2)]);
    expect(v.passed).toBe(false);
    expect(v.failed?.result.exitCode).toBe(2);
    expect(v.notRun.map((p) => p.command)).toEqual(['go test ./...']);
  });
  test('fewer results than planned without a failure is not a pass (fail closed)', () => {
    expect(judgeDoneRun(planned, [res('go build ./...', 0)]).passed).toBe(false);
  });
});

describe('doneRows (G4 record)', () => {
  test('one row per executed command plus one summary row', () => {
    const results = [res('go build ./...', 0), res('go test ./...', 1)];
    const rows = doneRows({ at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', planned, results, verdict: judgeDoneRun(planned, results) });
    expect(rows).toEqual([
      { at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', kind: 'command', command: 'go build ./...', tasks: ['T1', 'T2'], exitCode: 0, timedOut: false, durationMs: 5, stdoutTail: 'out', stderrTail: 'err' },
      { at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', kind: 'command', command: 'go test ./...', tasks: ['T2'], exitCode: 1, timedOut: false, durationMs: 5, stdoutTail: 'out', stderrTail: 'err' },
      { at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', kind: 'done_run', passed: false, failedCommand: 'go test ./...', notRun: [] },
    ]);
  });
});

describe('applyPass', () => {
  test('tasks 0..k get passedSha; doneSha only when k is the last task', () => {
    expect(applyPass([t('T1'), t('T2'), t('T3')], 1, 'x')).toEqual({ tasks: [t('T1', 'x'), t('T2', 'x'), t('T3')], doneSha: null });
    expect(applyPass([t('T1', 'x'), t('T2', 'x'), t('T3')], 2, 'y')).toEqual({ tasks: [t('T1', 'y'), t('T2', 'y'), t('T3', 'y')], doneSha: 'y' });
  });
});

test('the step budget is three unaccepted turns', () => {
  expect(MAX_STEP_ATTEMPTS).toBe(3);
});

test('tailOf keeps the last 60 lines and at most 4000 characters', () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  expect(tailOf(long).split('\n')[0]).toBe('line 40');
  expect(tailOf('x'.repeat(9000)).length).toBe(4000);
});
