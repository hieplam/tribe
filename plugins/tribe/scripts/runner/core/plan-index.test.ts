import { describe, expect, test } from 'bun:test';
import { doneCommandsThrough, resolveTaskIndex, type TaskIndexProblem, type TaskRef } from './plan-index.ts';

const PLAN = [
  '# Plan',
  '',
  '### Task 1: `mathx.Sum`',
  '',
  '```go',
  '### Task 9: not a heading, inside a fence',
  '```',
  '',
  '#### Done',
  '',
  '```bash',
  '# comments and blank lines are skipped',
  'go build ./...',
  '',
  'go test ./...',
  '```',
  '',
  '### Task 2: `mathx.Max`',
  '',
  '#### Done',
  '',
  '````bash',
  'go build ./...',
  "go test -run '^TestMax$' -v ./mathx | grep -q -- '--- PASS: TestMax'",
  '````',
  '',
].join('\n');

const refs = (...headings: string[]): TaskRef[] => headings.map((heading, i) => ({ id: `T${i + 1}`, heading }));

describe('resolveTaskIndex — spec §4.3', () => {
  test('resolves each task and reads its Done commands; comments, blanks and fenced headings ignored', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: `mathx.Sum`', 'Task 2: `mathx.Max`'), PLAN);
    expect(r.issues).toEqual([]);
    expect(r.tasks).toEqual([
      { id: 'T1', heading: 'Task 1: `mathx.Sum`', doneCommands: ['go build ./...', 'go test ./...'] },
      { id: 'T2', heading: 'Task 2: `mathx.Max`', doneCommands: ['go build ./...', "go test -run '^TestMax$' -v ./mathx | grep -q -- '--- PASS: TestMax'"] },
    ]);
  });
  test('a heading that exists only inside a fence is dangling', () => {
    const r = resolveTaskIndex('C1', refs('Task 9: not a heading, inside a fence'), PLAN);
    expect(r.issues.map((i) => i.problem)).toEqual(['dangling_heading']);
  });
  test('a heading that does not exist is dangling, and every issue is collected (never first-fail)', () => {
    const r = resolveTaskIndex('C1', refs('Task 7: nowhere', 'Task 1: `mathx.Sum`', 'Task 8: nowhere'), PLAN);
    expect(r.issues.map((i) => `${i.taskId}:${i.problem}`)).toEqual(['T1:dangling_heading', 'T3:dangling_heading']);
  });
  test('a duplicated heading is refused', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x\n#### Done\n```\ntrue\n```\n### Task 1: x\n');
    expect(r.issues.map((i) => i.problem)).toEqual(['duplicate_heading']);
  });
  test('missing Done, two Done sections, no block, empty block, continuation — each refused by name', () => {
    const cases: Array<[string, TaskIndexProblem]> = [
      ['### Task 1: x\nno done here\n', 'missing_done'],
      ['### Task 1: x\n#### Done\n```\ntrue\n```\n#### done\n```\ntrue\n```\n', 'ambiguous_done'],
      ['### Task 1: x\n#### Done\nrun the tests\n### Task 2: y\n', 'missing_done_block'],
      ['### Task 1: x\n#### Done\n```bash\n# only a comment\n\n```\n', 'empty_done'],
      ['### Task 1: x\n#### Done\n```bash\ngo test \\\n  ./...\n```\n', 'continuation_not_supported'],
    ];
    for (const [plan, problem] of cases) {
      expect(resolveTaskIndex('C1', refs('Task 1: x'), plan).issues.map((i) => i.problem)).toEqual([problem]);
    }
  });
  test("a Done heading of the SAME level ends the task: it is not the task's Done section", () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x\n### Done\n```\ntrue\n```\n');
    expect(r.issues.map((i) => i.problem)).toEqual(['missing_done']);
  });
  test('the next task heading bounds a Done block: a block after it is not borrowed', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x\n#### Done\n### Task 2: y\n```\ntrue\n```\n');
    expect(r.issues.map((i) => i.problem)).toEqual(['missing_done_block']);
  });
  test('closing hashes and trailing spaces are not part of the heading text', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x ###  \n#### Done\n```\ntrue\n```\n');
    expect(r.issues).toEqual([]);
  });
});

describe('doneCommandsThrough — cumulative, deduplicated by exact text, plan order', () => {
  test('tasks 1..k, first occurrence wins, each command lists every task that asks for it', () => {
    const { tasks } = resolveTaskIndex('C1', refs('Task 1: `mathx.Sum`', 'Task 2: `mathx.Max`'), PLAN);
    expect(doneCommandsThrough(tasks, 1)).toEqual([
      { command: 'go build ./...', tasks: ['T1', 'T2'] },
      { command: 'go test ./...', tasks: ['T1'] },
      { command: "go test -run '^TestMax$' -v ./mathx | grep -q -- '--- PASS: TestMax'", tasks: ['T2'] },
    ]);
    expect(doneCommandsThrough(tasks, 0).map((c) => c.command)).toEqual(['go build ./...', 'go test ./...']);
  });
});
