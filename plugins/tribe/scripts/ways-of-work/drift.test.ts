// drift.test.ts — the ways-of-work drift counter (card ways-of-work-consolidation, G1).
// Oracle: the card's G1 row. A restating line the counter misses is a bug; a pointer it lists is
// fixed by rewording the pointer, never by weakening a signal.
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPlaces, renderReport, SIGNALS, type DriftPolicy } from './drift-core.ts';
import { main, parseArgs } from './drift.ts';

const POLICY: DriftPolicy = {
  canonicalPath: 'agents/shaman.md',
  canonicalHeading: 'Ways of work',
  allowPrefixes: ['docs/history/'],
};

const signalOf = (line: string): string[] => SIGNALS.filter((s) => s.pattern.test(line)).map((s) => s.name);

test('each signal catches the rule sentence it names', () => {
  expect(signalOf('`Executor: single-agent` only when the plan has at most 2 tasks')).toContain('task-limit');
  expect(signalOf('a minimal code change (roughly 50 changed lines outside tests)')).toContain('line-limit');
  expect(signalOf('one review, at most one fix round, PR, merge')).toContain('fix-round-cap');
  expect(signalOf('up to 2 fix rounds, then escalate')).toContain('fix-round-cap');
  expect(signalOf('Otherwise one fresh implementer subagent per task, in order.')).toContain('implementer-rule');
  expect(signalOf('Give each task to one `general-purpose` subagent')).toContain('implementer-rule');
  expect(signalOf('never the tribe loop unless the owner explicitly asks for it')).toContain('owner-must-ask');
  expect(signalOf('**Tribe (only when the owner asks for it).**')).toContain('owner-must-ask');
  expect(signalOf('chooses the plan style — simple by default')).toContain('plan-style');
  expect(signalOf('## How to work (Tribe style)')).toContain('plan-style');
  expect(signalOf('A bug could pass every Verify block we can write in advance')).toContain('rubric');
  expect(signalOf('pick the lighter mode and write down what would justify the heavier one')).toContain('rubric');
});

test('a pointer to the canonical section states no rule', () => {
  expect(signalOf('The ways of work are defined once, in the "Ways of work" section of agents/shaman.md.')).toEqual([]);
  expect(signalOf('Executor: `single-agent`, `subagent-per-task` or `tribe` — the mode the Shaman chose.')).toEqual([]);
  expect(signalOf('The Warchief audit is capped at 3 fix-rounds (Method step 6).')).toEqual([]);
  expect(signalOf('~50 lines of prompt removed')).toEqual([]);
});

test('a live file that restates a rule is one place, with its hit lines', () => {
  const report = findPlaces([{ path: 'README.md', text: 'intro\none review, at most one fix round\n' }], POLICY);
  expect(report.count).toBe(1);
  expect(report.places[0]).toEqual({
    path: 'README.md',
    canonical: false,
    hits: [{ line: 2, signal: 'fix-round-cap', text: 'one review, at most one fix round' }],
  });
});

test('an allowlisted path is never scanned', () => {
  const report = findPlaces([{ path: 'docs/history/old-plan.md', text: 'at most 2 tasks\n' }], POLICY);
  expect(report).toEqual({ count: 0, places: [] });
});

test('the canonical section is the one allowed place; the rest of its file is a second place', () => {
  const text = [
    '# Shaman',
    'Mode 1: one review, at most one fix round.',
    '## Ways of work',
    '| `single-agent` | At most 2 tasks |',
    '### The blocks',
    '- at most 2 fix rounds',
    '## Anti-goals',
    'nothing here',
  ].join('\n');
  const report = findPlaces([{ path: 'agents/shaman.md', text }], POLICY);
  expect(report.count).toBe(2);
  expect(report.places.map((p) => [p.path, p.canonical, p.hits.map((h) => h.line)])).toEqual([
    ['agents/shaman.md#Ways of work', true, [4, 6]],
    ['agents/shaman.md', false, [2]],
  ]);
});

test('a heading inside a fence neither opens nor closes the canonical section', () => {
  const text = ['## Ways of work', '```markdown', '## Not a heading', '```', 'at most 2 tasks', '## Next'].join('\n');
  const report = findPlaces([{ path: 'agents/shaman.md', text }], POLICY);
  expect(report.places.map((p) => [p.path, p.canonical])).toEqual([['agents/shaman.md#Ways of work', true]]);
});

test('a canonical file with no such section counts whole, as a restating place', () => {
  const report = findPlaces([{ path: 'agents/shaman.md', text: 'at most 2 tasks\n' }], POLICY);
  expect(report.places.map((p) => [p.path, p.canonical])).toEqual([['agents/shaman.md', false]]);
});

test('the report lists each place, then the count', () => {
  const report = findPlaces(
    [
      { path: 'agents/shaman.md', text: '## Ways of work\nat most 2 tasks\n' },
      { path: 'b.md', text: 'at most 2 tasks\nsimple style\n' },
    ],
    POLICY,
  );
  expect(renderReport(report)).toBe(
    ['canonical  agents/shaman.md#Ways of work (1 line)', 'restates   b.md (2 lines)', 'ways-of-work definitions: 2'].join('\n'),
  );
});

test('a flag with no value, or an unknown flag, refuses', () => {
  expect(() => parseArgs(['--repo'])).toThrow('--repo needs a value');
  expect(() => parseArgs(['--repo', '--json'])).toThrow('--repo needs a value');
  expect(() => parseArgs(['--repo', '.', '--nope'])).toThrow('unknown argument: --nope');
  expect(() => parseArgs([])).toThrow('usage:');
});

let dir = '';
let logs: string[] = [];
const lastLine = (): string | undefined => logs.join('\n').split('\n').at(-1);
let errors: string[] = [];
const cwd = process.cwd();
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wow-drift-'));
  logs = [];
  errors = [];
  spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
  spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.join(' ')));
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

// A repo shaped like this one: the canonical file at its real path, one restating README, and an
// untracked file that must not be scanned (only tracked files are live).
function gitRepo(): string {
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'plugins', 'tribe', 'agents'), { recursive: true });
  writeFileSync(join(repo, 'plugins', 'tribe', 'agents', 'shaman.md'), '## Ways of work\nat most 2 tasks\n');
  writeFileSync(join(repo, 'README.md'), 'simple style\n');
  writeFileSync(join(repo, 'untracked.md'), 'at most 2 tasks\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  for (const args of [['init', '-q'], ['add', 'plugins/tribe/agents/shaman.md', 'README.md']]) {
    const r = Bun.spawnSync(['git', '-C', repo, ...args], { env, timeout: 30_000 });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
  }
  return repo;
}

test('main scans only tracked files, given an absolute --repo', () => {
  const repo = gitRepo();
  expect(main(['--repo', repo])).toBe(0);
  expect(logs.join('\n')).toBe(
    [
      'restates   README.md (1 line)',
      'canonical  plugins/tribe/agents/shaman.md#Ways of work (1 line)',
      'ways-of-work definitions: 2',
    ].join('\n'),
  );
});

test('main works the same with a relative --repo, the way a person types it', () => {
  const repo = gitRepo();
  process.chdir(dir);
  expect(main(['--repo', 'repo'])).toBe(0);
  expect(lastLine()).toBe('ways-of-work definitions: 2');
});

test('--also adds a file outside the repo, scanned whole', () => {
  const repo = gitRepo();
  const installed = join(dir, 'CLAUDE.md');
  writeFileSync(installed, 'one review, at most one fix round\n');
  expect(main(['--repo', repo, '--also', installed])).toBe(0);
  expect(lastLine()).toBe('ways-of-work definitions: 3');
});

test('a directory that is not a git repo refuses with exit 2, printing no report', () => {
  expect(main(['--repo', dir])).toBe(2);
  expect(logs).toEqual([]);
  expect(errors.join('\n')).toContain('drift: git ls-files failed');
});

test('an unreadable --also file refuses with exit 2', () => {
  const repo = gitRepo();
  expect(main(['--repo', repo, '--also', join(dir, 'missing.md')])).toBe(2);
  expect(errors.join('\n')).toContain('--also');
});

// --- Card ways-of-work-review-fixes (G1): the harness default, who executes, the verdict rule ---
// Oracle: that card's G1 row. Every restating sentence below was live on master @ b90f1c4 and went
// uncounted; every pointer below is the rewording that replaces one of them.

test('the harness, who-executes and verdict signals catch the rule sentences they name', () => {
  const cases: [string, string][] = [
    ['Every approved plan, in every mode, runs through the campaign harness', 'harness-default'],
    ['the campaign harness every approved plan runs through by default, including ONE approved card', 'harness-default'],
    ['a one-card campaign, the default for every way of work', 'harness-default'],
    ['one consolidated report; the default harness for every approved plan', 'harness-default'],
    ['execution follows the block exactly, driven by the campaign harness unless the owner said not to', 'harness-off'],
    ['only when the owner says not to use the harness does it brief', 'harness-off'],
    ['a harness that cannot run blocks the card — never fall back on your own', 'harness-off'],
    ["| No harness, the owner's explicit words only — Mode 1, the owner delegates |", 'harness-off'],
    ["it brief the owner's new session via SendMessage", 'who-executes'],
    ['drive the work from its own session on delegation', 'who-executes'],
    ['or dispatch a full-build Warchief for `tribe`', 'who-executes'],
    ["| the runner's executor session builds inline |", 'who-executes'],
    ['building a `single-agent` plan inline when the owner delegated it', 'who-executes'],
    ['- In this campaign the executor session is the Warchief the block names.', 'who-executes'],
    ["then run the card's own post-merge steps yourself", 'who-executes'],
    ['beyond a delegated no-harness `single-agent` plan', 'who-executes'],
    ['and a Mode 1 `tribe` card run without the campaign harness', 'who-executes'],
    ['| `single-agent` | At most 2 build tasks, roughly 50 changed lines |', 'task-limit'],
    ['3 to about 8 build tasks done in order', 'task-limit'],
    ['ends with `REVIEW: FAIL` when any finding is Should-fix or worse', 'review-verdict'],
    ['a `REVIEW: PASS` that lists a Should-fix finding counts as `REVIEW: FAIL`', 'review-verdict'],
    ['a failure the base branch does not have is at least Should-fix', 'review-verdict'],
  ];
  for (const [line, signal] of cases) expect([line, signalOf(line)]).toEqual([line, expect.arrayContaining([signal])]);
});

test('a pointer to "Ways of work", and a harness that is not the campaign harness, state no rule', () => {
  const pointers = [
    'execute the approved card on the path "Who executes, on each path" in "Ways of work" names, as "The campaign harness" there describes',
    'This step is the no-harness path of "Who executes, on each path" in "Ways of work".',
    'Where that table names a full-build `warchief` instead, it runs under the Shaman ⇄ Warchief contract',
    'the campaign harness of the "Ways of work" section of `agents/shaman.md`, for ONE approved card too',
    '**Scope: Modes 2–3, and every full-build Warchief "Ways of work" has you dispatch in Mode 1.**',
    'on the one path where "Who executes, on each path" in "Ways of work" names your own session as a `single-agent` plan\'s builder',
    'the harness-gap gate runs by default on every PR',
    'resolves to the eval harness default (no `--model` flag passed)',
    'One file that renders correctly with no local build step: inline the CSS and JS',
    '**Should-fix** — the validator does not mirror the runner',
    'D18 is a settled decision that outranks any Should-fix to the contrary',
  ];
  for (const line of pointers) expect([line, signalOf(line)]).toEqual([line, []]);
});

test('a rule sentence wrapped across two lines is caught, on the line it starts on', () => {
  const text = ['intro', 'when the owner delegated the plan and said not to', 'use the campaign harness, you write it', 'end'].join('\n');
  const report = findPlaces([{ path: 'README.md', text }], POLICY);
  expect(report.places[0]?.hits.map((h) => [h.line, h.signal])).toEqual([[2, 'harness-off']]);
});

test('a rule sentence wholly on the next line is that line\'s hit, never counted twice', () => {
  const report = findPlaces([{ path: 'README.md', text: 'intro\na harness that cannot run blocks the card\n' }], POLICY);
  expect(report.places[0]?.hits.map((h) => [h.line, h.signal])).toEqual([[2, 'harness-off']]);
});

test('the join never crosses the canonical section boundary', () => {
  const text = ['## Ways of work', 'this applies to every approved plan', '## The harness', 'nothing'].join('\n');
  const report = findPlaces([{ path: 'agents/shaman.md', text }], POLICY);
  expect(report).toEqual({ count: 0, places: [] });
});
