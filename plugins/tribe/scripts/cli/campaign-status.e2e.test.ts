// The command as a user types it: bare `tribe` on PATH via a symlink, HOME = a bare fixture
// (so ~/.tribe starts empty), cwd = a real git repo or a subdirectory of it.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TRIBE_BIN = join(import.meta.dir, 'bin', 'tribe');
let root: string; let repo: string; let campaigns: string; let env: Record<string, string>;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tribe-status-e2e-')));
  mkdirSync(join(root, 'bin')); symlinkSync(TRIBE_BIN, join(root, 'bin', 'tribe'));
  repo = join(root, 'repo'); mkdirSync(join(repo, 'sub'), { recursive: true });
  Bun.spawnSync(['git', 'init', '-q', repo], { timeout: 5000 });
  // Same key rule as tribe-home.sh: the main worktree's physical path with every / turned into -.
  campaigns = join(root, 'home', '.tribe', repo.replaceAll('/', '-'), 'campaigns');
  mkdirSync(join(root, 'home'));
  env = { ...(process.env as Record<string, string>), PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: join(root, 'home') };
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[], cwd = repo) {
  const r = Bun.spawnSync(['tribe', 'campaign', 'status', ...args], { cwd, env, timeout: 10_000 });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}
function campaign(name: string, state: string, status: string | null, mtimeSec: number) {
  const d = join(campaigns, name); mkdirSync(join(d, 'supervisor'), { recursive: true });
  writeFileSync(join(d, 'campaign-state.json'), state); utimesSync(join(d, 'campaign-state.json'), mtimeSec, mtimeSec);
  if (status !== null) { writeFileSync(join(d, 'supervisor', 'status.json'), status); utimesSync(join(d, 'supervisor', 'status.json'), mtimeSec, mtimeSec); }
}
const STATE = (seq: string[]) => JSON.stringify({ v: 1, campaign: 'x', sequence: seq,
  cards: Object.fromEntries(seq.map((id, i) => [id, { status: i === 0 ? 'shipped' : 'staged', pr: i === 0 ? 11 : null, dependsOn: i === 0 ? null : [seq[0]] }])) });
const STATUS = (msAgo: number, terminal: boolean) => JSON.stringify({ state: terminal ? 'terminal' : 'running_watchdog',
  updatedAt: new Date(Date.now() - msAgo).toISOString(), lastAction: 'spawn_session',
  currentSession: terminal ? null : { kind: 'ruling', cardId: 'b', sessionId: 'sess-1' },
  terminal: terminal ? { status: 'done', reason: 'campaign_closed' } : null });

test('bare ~/.tribe: one-line refusal, exit 1, no stack trace (G3, empty fixture)', () => {
  const r = run([]);
  expect(r.code).toBe(1); expect(r.out).toBe('');
  expect(r.err).toBe(`tribe: no campaigns under ${join(root, 'home', '.tribe', repo.replaceAll('/', '-'))}/campaigns\n`);
});

test('campaigns path is a file: one-line refusal, exit 1', () => {
  mkdirSync(join(campaigns, '..'), { recursive: true });
  writeFileSync(campaigns, 'not a directory');
  try {
    const r = run([]);
    expect(r.code).toBe(1); expect(r.out).toBe('');
    expect(r.err).toBe(`tribe: ${campaigns} is not a directory\n`);
  } finally { rmSync(campaigns); }
});

test('outside a git repo: refusal, exit 1', () => {
  const r = run([], root);
  expect(r.code).toBe(1); expect(r.err).toBe(`tribe: not inside a git repository (${root})\n`);
});

test('by name, from a repo subdirectory: G1 + G2 lines (running campaign)', () => {
  campaign('live', STATE(['a', 'b']), STATUS(90_000, false), 2_000_000_000);
  const r = run(['live'], join(repo, 'sub'));
  expect(r.code).toBe(0); expect(r.err).toBe('');
  expect(r.out).toBe([
    'campaign live — running_watchdog', 'cards: 1/2 shipped',
    // `b` depends only on `a`, and `a` has shipped, so nothing is outstanding: spec line 53,
    // `waiting on: <unshipped dependsOn ids | —>`. Same shape as this task's own Done command,
    // which requires the real `rdo-cleanup` (dependsOn a shipped card) to print `waiting on: —`.
    '  a  shipped  tasks 0/0  PR #11  waiting on: —', '  b  staged  tasks 0/0  PR —  waiting on: —',
    'session: ruling b sess-1', 'last action: spawn_session (1m ago)', ''].join('\n'));
});

test('no name, from a subdirectory: picks the newest by mtime (D1, Q2)', () => {
  campaign('older', STATE(['a']), STATUS(0, true), 1_000_000_000);
  const r = run([], join(repo, 'sub'));
  expect(r.code).toBe(0); expect(r.out.split('\n')[0]).toBe('campaign live — running_watchdog');
});

test('unknown name: refusal, exit 1', () => {
  const r = run(['nope']);
  expect(r.code).toBe(1); expect(r.err).toEndWith(`/campaigns\n`); expect(r.err).toStartWith('tribe: no campaign named "nope" under ');
});

test('corrupt campaign-state.json: one-line refusal, exit 1, no stack trace (G3)', () => {
  campaign('broken', '{ not json', null, 1_000);
  const r = run(['broken']);
  expect(r.code).toBe(1);
  expect(r.err).toBe(`tribe: cannot read ${join(campaigns, 'broken', 'campaign-state.json')}: not valid JSON\n`);
  expect(r.err).not.toMatch(/\n\s+at /);
});

test('corrupt status.json: refusal, exit 1 (Q4)', () => {
  campaign('badsup', STATE(['a']), '[]', 1_000);
  const r = run(['badsup']);
  expect(r.code).toBe(1);
  expect(r.err).toBe(`tribe: ${join(campaigns, 'badsup', 'supervisor', 'status.json')} is not a supervisor status: expected a JSON object\n`);
});

test('FIFO state and supervisor files refuse without blocking', () => {
  for (const target of ['campaign-state.json', 'supervisor/status.json']) {
    const name = target.startsWith('supervisor') ? 'fifo-supervisor' : 'fifo-state';
    campaign(name, STATE(['a']), STATUS(0, false), 1_000);
    const path = join(campaigns, name, target);
    rmSync(path);
    const made = Bun.spawnSync(['mkfifo', path], { timeout: 2_000 });
    expect(made.exitCode).toBe(0);
    const r = run([name]);
    expect(r.code).toBe(1); expect(r.out).toBe('');
    expect(r.err).toBe(`tribe: cannot read ${path}: is not a regular file\n`);
  }
});

test('stale non-terminal: stuck warning (G4, D4)', () => {
  campaign('stuck', STATE(['a']), STATUS(11 * 60_000 + 5_000, false), 1_000);
  const r = run(['stuck']);
  expect(r.code).toBe(0);
  expect(r.out.trimEnd().split('\n').at(-1)).toBe('WARNING: possibly stuck — supervisor not updated for 11m');
});

test('--watch re-renders and Ctrl-C stops it (D3)', async () => {
  const p = Bun.spawn(['tribe', 'campaign', 'status', 'live', '--watch'], { cwd: repo, env, stdout: 'pipe' });
  await Bun.sleep(4_500);
  p.kill('SIGINT');
  let timedOut = false;
  const fallback = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, 2_000);
  const code = await p.exited;
  clearTimeout(fallback);
  const out = await new Response(p.stdout).text();
  expect((out.match(/^cards: 1\/2 shipped$/gm) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(timedOut).toBe(false);
  expect(code === 130 || p.signalCode === 'SIGINT').toBe(true);
}, 10_000);
