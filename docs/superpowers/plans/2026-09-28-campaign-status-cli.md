# Plan — `tribe campaign status` (card campaign-status-cli), rev 3

Spec: `~/.tribe/-Users-hiep-repo-tribe/cards/campaign-status-cli/spec.md`. Contract: the card
`~/.tribe/-Users-hiep-repo-tribe/cards/campaign-status-cli.md` (D1–D4, G1–G4, rulings Q1–Q6).
One PR, branch `feat/campaign-status-cli` from master `a203aef`. Paths below are relative to
`plugins/tribe/scripts/cli/` unless they start with `/`, `~` or `docs/`.

Rev 2 changes: Task 0 records the ratchet baseline before any code; every test is written in
full; every task ends in its own Verify block (Goal / Red / Green / Stub check / User-level);
goal → task → verify table at the end.
Rev 3 (owner amendment to D2, card "Owner rulings"): each card line also shows `tasks k/n` —
k = task entries with a non-empty string `passedSha`, n = number of task entries. Display only;
the runner is untouched. Missing or `null` `tasks` → `tasks 0/0` (chosen because that is exactly what
the file records: no task index; all 4 local v1 campaigns have `"tasks": null`). Plan-review-2 rulings
R1–R3 applied as accepted (Tasks 3/4 separate, evidence summaries committed, real clock).

## How to work

- Do the tasks in order. Give each task to one `general-purpose` subagent; the subagent
  writes the test, writes the code, runs the task's Done commands, and commits.
- Every task ends with a **Done** section: shell commands, one per line. The task is done
  when every command exits 0 when run from a clean checkout of the task's commit — the
  runner runs them itself.
- Work on a branch in a separate git worktree.

Standing rules for every task:

- The task's own **Verify** block is its oracle: observe its Red before implementing and its
  Green after, exactly as written. Never weaken a written assertion; if a Verify line cannot be
  met as written, escalate instead of changing it.
- Paths below are relative to `plugins/tribe/scripts/cli/` unless they start with `/`, `~`,
  `docs/` or `plugins/`.
- The `tribe` on PATH runs the main checkout, not your worktree. In every User-level check from
  Task 1 on, run `bun tribe/scripts/cli/main.ts …` from `<task worktree>/plugins` where the check
  says `tribe …`. Task 0 alone uses the installed `tribe`, because it measures master.

## Global Constraints
- Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).
- Read-only: nothing writes under `~/.tribe`. No edits in `runner/` or `viewer/` (imports only).
- Every commit carries the trailers `Tribe-Card: campaign-status-cli` and `Tribe-Task: N/5` (N = task number; Task 0 uses `0/5`)
  in one final paragraph.
- Regression guard at the end of every task (in addition to its own Verify):
  `cd plugins/tribe/scripts/cli && bunx tsc --noEmit && bun test` exits 0.

## Fixed interfaces (every task uses these exact names and strings)

`core/campaign-status.ts`:
```ts
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };
export interface StatusCard { status: string; pr: number | null; dependsOn: string[]; tasksPassed: number; tasksTotal: number; }
export interface StatusState { campaign: string; sequence: string[]; cards: Record<string, StatusCard>; }
export interface StatusSupervisor {
  state: string; updatedAt: string; lastAction: string;
  currentSession: { kind: string; cardId: string | null; sessionId: string | null } | null;
  terminal: { status: string; reason: string } | null;
}
export const STALE_AFTER_MS = 600_000;   // D4: 10 minutes
export const WATCH_INTERVAL_MS = 2_000;  // Q5: fixed 2 s
export function parseCampaignState(raw: unknown): Parsed<StatusState>;
export function parseSupervisorStatus(raw: unknown): Parsed<StatusSupervisor>;
export function pickLatest(c: { name: string; updatedMs: number }[]): string | null;
export function formatAge(ms: number): string;          // <60 s "Ns", <60 min "Nm", else "Nh" (floor)
export function renderStatus(i: { name: string; state: StatusState; supervisor: StatusSupervisor | null; nowMs: number }): string[];
export type ReadJson = { kind: 'ok'; value: unknown } | { kind: 'missing' } | { kind: 'unreadable'; reason: string };
export interface CampaignStatusIo {
  home(): Parsed<string>;                                   // tribe home of the cwd's repo
  listCampaigns(home: string): { name: string; updatedMs: number }[];  // dirs under <home>/campaigns; [] if absent
  readJson(path: string): ReadJson;
  now(): number;
  print(lines: string[]): void;
  printErr(line: string): void;
  clear(): void;
  sleep(ms: number): Promise<'continue' | 'stop'>;          // real adapter always 'continue'; Ctrl-C kills the process
}
export async function runCampaignStatus(cmd: { name: string | null; watch: boolean }, io: CampaignStatusIo): Promise<number>;
```
Lenient reader (Q1): accepts any `v`; `dependsOn` absent or `null` → `[]` (the real
`post-rdo-followups` file has `"dependsOn": null`); `pr` absent → `null`; extra fields ignored.
Tasks (D2 as amended): `tasks` absent or `null` → `tasksPassed 0, tasksTotal 0`; an array → `tasksTotal` =
its length, `tasksPassed` = entries that are objects whose `passedSha` is a non-empty string (an entry
without `passedSha`, with `passedSha: null`/`""`, or a `null` entry counts toward n only). Real on-disk
entry shape: `{ id, heading, passedSha }`. `tasks` of any other type → refusal `cards.<id>.tasks must be an array or null`.
`status` must be a string, `pr` a number or null, `sequence` a string array, `cards` an object.
Supervisor: `state`, `lastAction` strings; `updatedAt` a string that `Date.parse` accepts;
`currentSession`, `terminal` object or null (absent → null).

Exact output lines (G1/G2/D4):
```
campaign <name> — <supervisor.state>[ (<terminal.status>: <terminal.reason>)]   | campaign <name> — supervisor: not started
cards: <shipped>/<total> shipped
  <id>  <status>  tasks <k>/<n>  PR #<pr>|PR —  waiting on: <comma-joined unshipped dependsOn>|—
session: <kind> <cardId|-> <sessionId|->                     (only when currentSession)
last action: <lastAction> (<age> ago)                         (only when supervisor)
WARNING: possibly stuck — supervisor not updated for <age>    (supervisor, state !== 'terminal', terminal null, age > STALE_AFTER_MS)
```
Card order: `sequence` first, then any other card ids sorted ascending.

Exact refusal lines (G3, Q3, Q4) — each one stderr line, exit 1:
```
tribe: not inside a git repository (<cwd>)
tribe: no campaigns under <home>/campaigns
tribe: no campaign named "<name>" under <home>/campaigns
tribe: cannot read <dir>/campaign-state.json: missing
tribe: cannot read <file>: <reason>                    (reason from readJson, e.g. "not valid JSON")
tribe: <file> is not a campaign state: <reason>
tribe: <file> is not a supervisor status: <reason>
```
A missing `supervisor/status.json` is not a refusal: render with `supervisor: not started`.
Bad arguments stay exit 2 via the existing `refuse` path in `main.ts`.

---

## Task 0 — record the ratchet baseline on master (no code)
Files: `docs/superpowers/evidence/2026-09-28-campaign-status-cli/baseline.md` (summary only).

Run on master `a203aef`, from `/tmp`:
```sh
tribe campaign status post-rdo-followups; echo "exit=$?"
C=~/.tribe/-Users-hiep-repo-tribe/campaigns/post-rdo-followups
time ( jq '{sequence, cards: (.cards|map_values({status,pr,dependsOn}))}' $C/campaign-state.json; \
       jq '{state,lastAction,updatedAt,currentSession,terminal}' $C/supervisor/status.json )
```
Record in `baseline.md`: the two literal output lines, the jq recipe, and the count
"today: 0 tribe commands answer it; 2 jq commands over 2 files (plus knowing the repo-key path)".

### Verify
- Goal: Ratchet baseline (card "Ratchet"), measured BEFORE building.
- Red: not applicable (no code); the measurement itself is the artifact.
- Green (expected): first command prints exactly `tribe: unknown option campaign (see tribe --help)` and
  `exit=2` (observed by the planner on 2026-09-28 against `/Users/hiep/.local/bin/tribe`).
  `git show --stat HEAD` lists only `baseline.md`.
- Stub check: an empty `baseline.md` fails because Task 5's Green compares against its recorded
  line `exit=2` and its command count; a missing line leaves no before value.

- [ ] **Step 1: Commit** — one commit with trailers `Tribe-Card: campaign-status-cli` / `Tribe-Task: 0/5`.

### Done

```bash
grep -qF 'tribe: unknown option campaign (see tribe --help)' docs/superpowers/evidence/2026-09-28-campaign-status-cli/baseline.md
grep -qF 'exit=2' docs/superpowers/evidence/2026-09-28-campaign-status-cli/baseline.md
```

## Task 1 — parse `campaign status [<name>] [--watch]`
Files: `core/args.ts`, `core/args.test.ts`, `main.ts`.

Tests (append to `core/args.test.ts`):
```ts
test('campaign status parses optional name and --watch (D1, D3)', () => {
  expect(parseArgs(['campaign', 'status'])).toEqual({ kind: 'campaign-status', name: null, watch: false });
  expect(parseArgs(['campaign', 'status', 'post-rdo-followups']))
    .toEqual({ kind: 'campaign-status', name: 'post-rdo-followups', watch: false });
  expect(parseArgs(['campaign', 'status', '--watch', 'c1']))
    .toEqual({ kind: 'campaign-status', name: 'c1', watch: true });
});
test('campaign refuses bad shapes with one message (Q3: exit 2 path)', () => {
  expect(parseArgs(['campaign'])).toEqual({ kind: 'refuse', message: 'tribe: campaign expects a subcommand: status (see tribe --help)' });
  expect(parseArgs(['campaign', 'list'])).toEqual({ kind: 'refuse', message: 'tribe: campaign expects a subcommand: status (see tribe --help)' });
  expect(parseArgs(['campaign', 'status', 'a', 'b'])).toEqual({ kind: 'refuse', message: 'tribe: campaign status takes at most one name, got "b"' });
  expect(parseArgs(['campaign', 'status', '../x'])).toEqual({ kind: 'refuse', message: 'tribe: invalid campaign name "../x"' });
  expect(parseArgs(['campaign', 'status', '..'])).toEqual({ kind: 'refuse', message: 'tribe: invalid campaign name ".."' });
  expect(parseArgs(['campaign', 'status', '--port', '1'])).toEqual({ kind: 'refuse', message: 'tribe: unknown option --port for campaign status (see tribe --help)' });
});
test('help lists the campaign status command', () => {
  expect(HELP).toContain('tribe campaign status [<name>] [--watch]');
});
```
Implementation: add `| { kind: 'campaign-status'; name: string | null; watch: boolean }` to
`Command`; in `parseArgs`, after help/version, `if (args[0] === 'campaign') return parseCampaign(args.slice(1));`.
Name rule: `/^[A-Za-z0-9._-]+$/` and not `.` / `..` (fail-closed-edges §4, checked before any path exists).
Add to `HELP` under Usage: `  tribe campaign status [<name>] [--watch]   card progress of a campaign (default: latest; --watch refreshes every 2 s)`.
`main.ts`: temporary branch so types narrow (replaced in Task 4):
```ts
if (command.kind === 'campaign-status') { console.error('tribe: campaign status not wired yet'); process.exit(1); }
```

### Verify
- Goal: D1 (name optional), D3 (`--watch` flag), Q3 (bad args exit 2).
- Red: `bun test core/args.test.ts` before implementing → fails `campaign status parses…` with
  `Expected: {"kind":"campaign-status",…}` / `Received: {"kind":"refuse","message":"tribe: unknown option campaign (see tribe --help)"}`.
- Green (expected): `bun test core/args.test.ts` → `0 fail`, the three new test names listed as pass.
  `bun main.ts campaign list; echo $?` prints `tribe: campaign expects a subcommand: status (see tribe --help)` and `2`.
- Stub check: a stub returning `refuse` for everything fails the first test; one accepting any
  token as a name fails the `../x` and `a b` refusal assertions.

- [ ] **Step 1: Commit** — one commit with trailers `Tribe-Card: campaign-status-cli` / `Tribe-Task: 1/5`.

### Done

```bash
cd plugins/tribe/scripts/cli && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/viewer && bun install --frozen-lockfile && bun run build
cd plugins/tribe/scripts/cli && bun test core/args.test.ts
cd plugins/tribe/scripts/cli && out="$(bun main.ts campaign list 2>&1)"; test $? -eq 2 && test "$out" = 'tribe: campaign expects a subcommand: status (see tribe --help)'
cd plugins/tribe/scripts/cli && bunx tsc --noEmit
cd plugins/tribe/scripts/cli && bun test
test -z "$(git diff --name-only "$RUNNER_BASE_SHA" HEAD -- plugins/tribe/scripts/runner plugins/tribe/scripts/viewer)"
```

## Task 2 — pure core: lenient parsers, pickLatest, formatAge, renderStatus
Files: `core/campaign-status.ts`, `core/campaign-status.test.ts`.

```ts
import { expect, test } from 'bun:test';
import { formatAge, parseCampaignState, parseSupervisorStatus, pickLatest, renderStatus,
  type StatusState, type StatusSupervisor } from './campaign-status.ts';

const NOW = Date.parse('2026-09-28T15:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const RAW_STATE = { v: 1, campaign: 'c', sequence: ['a', 'b'], extra: true, cards: {
  // `a` carries the real on-disk task shape {id, heading, passedSha}: 1 passed of 4.
  a: { status: 'shipped', pr: 7, dependsOn: null, sessionId: 's1', updatedAt: null, tasks: [
    { id: 'T1', heading: 'Task 1 — parse', passedSha: '53b4b4e7eab3b6023feec2af2880bb23382366b1' },
    { id: 'T2', heading: 'Task 2 — render', passedSha: '' },
    { id: 'T3', heading: 'Task 3 — flow' },
    null ] },
  b: { status: 'staged', pr: null, dependsOn: ['a', 'x'], sessionId: null, updatedAt: null, tasks: null },
  x: { status: 'running', sessionId: 's2', updatedAt: null } } };
const RUNNING = { state: 'running_watchdog', updatedAt: iso(120_000), lastAction: 'spawn_session',
  currentSession: { kind: 'ruling', cardId: 'x', sessionId: 's9' }, terminal: null };
function ok<T>(p: { ok: boolean }): T { expect(p.ok).toBe(true); return (p as { value: T }).value; }
const state = () => ok<StatusState>(parseCampaignState(RAW_STATE));
const sup = (o: object = {}) => ok<StatusSupervisor>(parseSupervisorStatus({ ...RUNNING, ...o }));

test('lenient reader: v1 accepted, null/absent dependsOn → [], absent pr → null (Q1)', () => {
  const s = state();
  expect(s.cards.a).toEqual({ status: 'shipped', pr: 7, dependsOn: [], tasksPassed: 1, tasksTotal: 4 });
  expect(s.cards.b).toEqual({ status: 'staged', pr: null, dependsOn: ['a', 'x'], tasksPassed: 0, tasksTotal: 0 });
  expect(s.cards.x).toEqual({ status: 'running', pr: null, dependsOn: [], tasksPassed: 0, tasksTotal: 0 });
  expect(ok<StatusState>(parseCampaignState({ ...RAW_STATE, v: 2 })).campaign).toBe('c');
});

test('G1 + G2: header, N/M shipped, per-card line, session, last action age', () => {
  expect(renderStatus({ name: 'c', state: state(), supervisor: sup(), nowMs: NOW })).toEqual([
    'campaign c — running_watchdog',
    'cards: 1/3 shipped',
    '  a  shipped  tasks 1/4  PR #7  waiting on: —',
    '  b  staged  tasks 0/0  PR —  waiting on: x',
    '  x  running  tasks 0/0  PR —  waiting on: —',
    'session: ruling x s9',
    'last action: spawn_session (2m ago)',
  ]);
});

test('G4 / D4: non-terminal older than 10 min warns; exactly 10 min does not', () => {
  const stale = renderStatus({ name: 'c', state: state(), supervisor: sup({ updatedAt: iso(11 * 60_000) }), nowMs: NOW });
  expect(stale.at(-1)).toBe('WARNING: possibly stuck — supervisor not updated for 11m');
  const edge = renderStatus({ name: 'c', state: state(), supervisor: sup({ updatedAt: iso(10 * 60_000) }), nowMs: NOW });
  expect(edge.some((l) => l.startsWith('WARNING'))).toBe(false);
});

test('terminal campaign never warns and shows its terminal reason', () => {
  const lines = renderStatus({ name: 'c', state: state(), nowMs: NOW, supervisor: sup({
    state: 'terminal', updatedAt: iso(3 * 3_600_000), lastAction: 'exit:campaign_closed', currentSession: null,
    terminal: { status: 'done', reason: 'campaign_closed', exitCode: 0 } }) });
  expect(lines[0]).toBe('campaign c — terminal (done: campaign_closed)');
  expect(lines).toContain('last action: exit:campaign_closed (3h ago)');
  expect(lines.some((l) => l.startsWith('WARNING') || l.startsWith('session:'))).toBe(false);
});

test('no supervisor file: cards still render, header says not started, no age lines', () => {
  expect(renderStatus({ name: 'c', state: state(), supervisor: null, nowMs: NOW })).toEqual([
    'campaign c — supervisor: not started',
    'cards: 1/3 shipped',
    '  a  shipped  tasks 1/4  PR #7  waiting on: —',
    '  b  staged  tasks 0/0  PR —  waiting on: x',
    '  x  running  tasks 0/0  PR —  waiting on: —',
  ]);
});

test('D2 tasks k/n: all passed, none passed, empty array, refusal on a wrong type', () => {
  const card = (tasks: unknown) => ({ campaign: 'c', sequence: ['a'], cards: { a: { status: 'running', pr: null, tasks } } });
  const line = (tasks: unknown) => renderStatus({ name: 'c', state: ok<StatusState>(parseCampaignState(card(tasks))), supervisor: null, nowMs: NOW })[2];
  expect(line([{ id: 'T1', heading: 'h', passedSha: 'abc' }, { id: 'T2', heading: 'h', passedSha: 'def' }]))
    .toBe('  a  running  tasks 2/2  PR —  waiting on: —');
  expect(line([{ id: 'T1', heading: 'h', passedSha: null }])).toBe('  a  running  tasks 0/1  PR —  waiting on: —');
  expect(line([])).toBe('  a  running  tasks 0/0  PR —  waiting on: —');
  expect(parseCampaignState(card('T1'))).toEqual({ ok: false, reason: 'cards.a.tasks must be an array or null' });
});

test('cards outside sequence render after it, sorted', () => {
  const s = ok<StatusState>(parseCampaignState({ campaign: 'c', sequence: ['z'], cards: {
    z: { status: 'staged', pr: null }, b: { status: 'staged', pr: null }, a: { status: 'staged', pr: null } } }));
  expect(renderStatus({ name: 'c', state: s, supervisor: null, nowMs: NOW }).slice(2).map((l) => l.trim().split(' ')[0]))
    .toEqual(['z', 'a', 'b']);
});

test('parsers refuse wrong shapes with a reason (G3)', () => {
  expect(parseCampaignState([])).toEqual({ ok: false, reason: 'expected a JSON object' });
  expect(parseCampaignState({ campaign: 'c', sequence: [], cards: { a: { status: 1 } } }))
    .toEqual({ ok: false, reason: 'cards.a.status must be a string' });
  expect(parseCampaignState({ campaign: 'c', cards: {} })).toEqual({ ok: false, reason: 'sequence must be an array of strings' });
  expect(parseSupervisorStatus({ state: 'x', lastAction: 'y' })).toEqual({ ok: false, reason: 'updatedAt must be an ISO timestamp' });
  expect(parseSupervisorStatus({ ...RUNNING, updatedAt: 'yesterday' })).toEqual({ ok: false, reason: 'updatedAt must be an ISO timestamp' });
});

test('pickLatest (Q2): newest wins, tie by name ascending, empty → null', () => {
  expect(pickLatest([{ name: 'b', updatedMs: 1 }, { name: 'a', updatedMs: 2 }])).toBe('a');
  expect(pickLatest([{ name: 'b', updatedMs: 2 }, { name: 'a', updatedMs: 2 }])).toBe('a');
  expect(pickLatest([])).toBeNull();
});

test('formatAge floors to s / m / h', () => {
  expect([formatAge(59_999), formatAge(60_000), formatAge(3_599_999), formatAge(3_600_000)])
    .toEqual(['59s', '1m', '59m', '1h']);
});
```
Implementation per "Fixed interfaces". No imports of `fs`, `process`, `Date.now`. Validation is
hand-written (no zod dependency added to the CLI package). Reason strings are exactly the ones in the tests.

### Verify
- Goal: G1 (fields), G2 (session + age), G4/D4 (stale rule), D2 as amended (tasks k/n), Q1 (lenient), Q2 (pickLatest).
- Red: `bun test core/campaign-status.test.ts` before the module exists → `error: Cannot find module './campaign-status.ts'`, exit 1.
- Green (expected): `bun test core/campaign-status.test.ts` → `10 pass`, `0 fail`, exit 0.
- Stub check: a `renderStatus` returning `[]` fails the two `toEqual` line lists; one that always
  prints the WARNING fails the 10-minute-edge and terminal tests; a strict parser fails the Q1 test;
  a hard-coded `tasks 0/0` (or counting every entry as passed) fails `tasks 1/4` and `tasks 0/1`.

- [ ] **Step 1: Commit** — one commit with trailers `Tribe-Card: campaign-status-cli` / `Tribe-Task: 2/5`.

### Done

```bash
cd plugins/tribe/scripts/cli && bun test core/campaign-status.test.ts
! grep -nE "from '(node:)?(fs|path|child_process|os)'|Date\.now|process\." plugins/tribe/scripts/cli/core/campaign-status.ts
```

## Task 3 — flow `runCampaignStatus` over the injected `CampaignStatusIo`
Files: `core/campaign-status.ts` (add flow), `core/campaign-status.flow.test.ts`.

```ts
import { expect, test } from 'bun:test';
import { runCampaignStatus, type CampaignStatusIo, type ReadJson } from './campaign-status.ts';

const HOME = '/h/.tribe/k';
const NOW = Date.parse('2026-09-28T15:00:00.000Z');
const STATE = { v: 1, campaign: 'c1', sequence: ['a'], cards: { a: { status: 'shipped', pr: 3, dependsOn: null } } };
const SUP = { state: 'terminal', updatedAt: '2026-09-28T14:59:00.000Z', lastAction: 'exit:campaign_closed',
  currentSession: null, terminal: { status: 'done', reason: 'campaign_closed' } };

function fakeIo(o: { home?: CampaignStatusIo['home']; campaigns?: { name: string; updatedMs: number }[];
  files?: Record<string, ReadJson>; stopAfter?: number }) {
  const out: string[][] = []; const err: string[] = []; let clears = 0; let sleeps = 0;
  const io: CampaignStatusIo = {
    home: o.home ?? (() => ({ ok: true, value: HOME })),
    listCampaigns: () => o.campaigns ?? [],
    readJson: (p) => o.files?.[p] ?? { kind: 'missing' },
    now: () => NOW,
    print: (lines) => { out.push(lines); },
    printErr: (l) => { err.push(l); },
    clear: () => { clears += 1; },
    sleep: async () => { sleeps += 1; return sleeps >= (o.stopAfter ?? 1) ? 'stop' : 'continue'; },
  };
  return { io, out, err, clears: () => clears, sleeps: () => sleeps };
}
const dir = (n: string) => `${HOME}/campaigns/${n}`;
const both = (n: string, s: ReadJson = { kind: 'ok', value: SUP }) => ({
  [`${dir(n)}/campaign-state.json`]: { kind: 'ok', value: STATE } as ReadJson, [`${dir(n)}/supervisor/status.json`]: s });

test('not a git repo → the home refusal line, exit 1', async () => {
  const f = fakeIo({ home: () => ({ ok: false, reason: 'tribe: not inside a git repository (/tmp/x)' }) });
  expect(await runCampaignStatus({ name: null, watch: false }, f.io)).toBe(1);
  expect(f.err).toEqual(['tribe: not inside a git repository (/tmp/x)']);
});

test('no name + no campaigns → one-line refusal, exit 1 (G3)', async () => {
  const f = fakeIo({});
  expect(await runCampaignStatus({ name: null, watch: false }, f.io)).toBe(1);
  expect(f.err).toEqual([`tribe: no campaigns under ${HOME}/campaigns`]); expect(f.out).toEqual([]);
});

test('unknown name → refusal naming it, exit 1 (G3)', async () => {
  const f = fakeIo({ campaigns: [{ name: 'c1', updatedMs: 1 }] });
  expect(await runCampaignStatus({ name: 'nope', watch: false }, f.io)).toBe(1);
  expect(f.err).toEqual([`tribe: no campaign named "nope" under ${HOME}/campaigns`]);
});

test('no name renders the most recently updated campaign (D1, Q2)', async () => {
  const f = fakeIo({ campaigns: [{ name: 'old', updatedMs: 1 }, { name: 'c1', updatedMs: 9 }], files: both('c1') });
  expect(await runCampaignStatus({ name: null, watch: false }, f.io)).toBe(0);
  expect(f.out[0]?.[0]).toBe('campaign c1 — terminal (done: campaign_closed)');
  expect(f.err).toEqual([]);
});

test('missing campaign-state.json → refusal, exit 1', async () => {
  const f = fakeIo({ campaigns: [{ name: 'c1', updatedMs: 1 }] });
  expect(await runCampaignStatus({ name: 'c1', watch: false }, f.io)).toBe(1);
  expect(f.err).toEqual([`tribe: cannot read ${dir('c1')}/campaign-state.json: missing`]);
});

test('corrupt campaign-state.json → refusal carrying the reader reason, exit 1 (G3)', async () => {
  const f = fakeIo({ campaigns: [{ name: 'c1', updatedMs: 1 }],
    files: { [`${dir('c1')}/campaign-state.json`]: { kind: 'unreadable', reason: 'not valid JSON' } } });
  expect(await runCampaignStatus({ name: 'c1', watch: false }, f.io)).toBe(1);
  expect(f.err).toEqual([`tribe: cannot read ${dir('c1')}/campaign-state.json: not valid JSON`]);
});

test('wrong-shape status.json → refusal, exit 1 (Q4)', async () => {
  const f = fakeIo({ campaigns: [{ name: 'c1', updatedMs: 1 }], files: both('c1', { kind: 'ok', value: { state: 1 } }) });
  expect(await runCampaignStatus({ name: 'c1', watch: false }, f.io)).toBe(1);
  expect(f.err[0]).toStartWith(`tribe: ${dir('c1')}/supervisor/status.json is not a supervisor status: `);
  expect(f.err).toHaveLength(1);
});

test('missing status.json → renders with supervisor: not started, exit 0', async () => {
  const f = fakeIo({ campaigns: [{ name: 'c1', updatedMs: 1 }], files: both('c1', { kind: 'missing' }) });
  expect(await runCampaignStatus({ name: 'c1', watch: false }, f.io)).toBe(0);
  expect(f.out[0]?.[0]).toBe('campaign c1 — supervisor: not started');
});

test('--watch clears and re-renders every 2 s until sleep says stop (D3, Q5)', async () => {
  const f = fakeIo({ campaigns: [{ name: 'c1', updatedMs: 1 }], files: both('c1'), stopAfter: 3 });
  const sleptWith: number[] = []; const sleep = f.io.sleep;
  f.io.sleep = (ms) => { sleptWith.push(ms); return sleep(ms); };
  expect(await runCampaignStatus({ name: 'c1', watch: true }, f.io)).toBe(0);
  expect(f.out).toHaveLength(3); expect(f.clears()).toBe(3); expect(sleptWith).toEqual([2000, 2000, 2000]);
});

test('one-shot never clears or sleeps', async () => {
  const f = fakeIo({ campaigns: [{ name: 'c1', updatedMs: 1 }], files: both('c1') });
  await runCampaignStatus({ name: 'c1', watch: false }, f.io);
  expect([f.clears(), f.sleeps()]).toEqual([0, 0]);
});
```
Implementation: `runCampaignStatus` resolves home → lists → picks name → per render: read + parse
both files, `renderStatus`, `print`. Watch: `do { clear(); render-or-refuse; } while (await sleep(WATCH_INTERVAL_MS) === 'continue')`;
a refusal inside watch prints and returns 1.

### Verify
- Goal: G3 (refusals), D1/Q2 (default = latest), D3/Q5 (watch at 2 s), Q3 (exit 1), Q4 (refuse corrupt status).
- Red: `bun test core/campaign-status.flow.test.ts` before adding the flow →
  `SyntaxError: Export named 'runCampaignStatus' not found in module`, exit 1.
- Green (expected): `bun test core/campaign-status.flow.test.ts` → `10 pass`, `0 fail`, exit 0.
- Stub check: a `runCampaignStatus` that returns 0 and prints nothing fails every refusal test
  (expects exit 1 plus an exact stderr line) and the D1 test (expects the header line).
- User-level: not wired yet by design. From `<task worktree>/plugins`:
  `tribe campaign status post-rdo-followups; echo $?` and `tribe campaign status; echo $?` both print
  `tribe: campaign status not wired yet` and `1` (the Task 1 stub). Task 4 replaces it.

- [ ] **Step 1: Commit** — one commit with trailers `Tribe-Card: campaign-status-cli` / `Tribe-Task: 3/5`.

### Done

```bash
cd plugins/tribe/scripts/cli && bun test core/campaign-status.flow.test.ts
```

## Task 4 — adapter + `main.ts` wiring, proven by an E2E on a bare `~/.tribe`
Files: `adapters/campaign-status.adapter.ts`, `main.ts`, `campaign-status.e2e.test.ts`.

E2E test (write first; it is Red against the Task 1 stub):
```ts
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
    '  a  shipped  tasks 0/0  PR #11  waiting on: —', '  b  staged  tasks 0/0  PR —  waiting on: a',
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
  const code = await p.exited;
  const out = await new Response(p.stdout).text();
  expect((out.match(/^cards: 1\/2 shipped$/gm) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(code === 130 || p.signalCode === 'SIGINT').toBe(true);
}, 10_000);
```
Adapter `buildCampaignStatusIo(cwd)`:
- `home()`: `Bun.spawnSync(['bash', join(import.meta.dir, '..', '..', 'tribe-home.sh')], { cwd, env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'}, timeout: 5000 })`;
  exit 0 → trimmed stdout; else `{ ok: false, reason: 'tribe: not inside a git repository (<cwd>)' }`.
- `listCampaigns(home)`: `readdirSync(join(home,'campaigns'), { withFileTypes: true })` directories only;
  `ENOENT` → `[]`; `updatedMs` = max `mtimeMs` of `campaign-state.json` and `supervisor/status.json`, each
  `ENOENT` ignored, both missing → 0.
- `readJson(path)`: `readFileSync` + `JSON.parse`; `ENOENT` → `missing`; `EACCES`/`EISDIR` → `unreadable` with
  reason `permission denied` / `is a directory`; `SyntaxError` → `unreadable`, reason `not valid JSON`.
  Any other error rethrows (not swallowed).
- `now = Date.now`, `print = lines => console.log(lines.join('\n'))`, `printErr = console.error`,
  `clear = () => process.stdout.write('\x1b[2J\x1b[H')`, `sleep = async ms => { await Bun.sleep(ms); return 'continue'; }`.
- `main.ts`: replace the Task 1 stub with
  `process.exit(await runCampaignStatus(command, buildCampaignStatusIo(process.cwd())));`.

### Verify
- Goal: G1, G2, G3, G4 end to end through the real binary; D1, D3; empty-fixture rule (bare home) and relative/no-name invocation.
- Red: `bun test campaign-status.e2e.test.ts` before the adapter/wiring → the first test fails with
  `Expected: "tribe: no campaigns under …/campaigns\n"` / `Received: "tribe: campaign status not wired yet\n"`;
  all non-refusal tests fail on `expect(r.code).toBe(0)` with `Received: 1`.
- Green (expected): `bun test campaign-status.e2e.test.ts` → `9 pass`, `0 fail`, exit 0.
- Stub check: the Task 1 stub (and any implementation that does not read the files) fails the
  exact-output test for `live` and the stale WARNING test; an implementation that ignores `HOME`
  would read the real `~/.tribe` and fail the bare-home refusal.
- User-level (real terminal, installed `tribe` on PATH = this checkout):
  - `cd <task worktree>/plugins && tribe campaign status post-rdo-followups; echo $?` →
    ```
    campaign post-rdo-followups — terminal (done: campaign_closed)
    cards: 2/2 shipped
      fu-closing-dismiss  shipped  tasks 1/1  PR #190  waiting on: —
      rdo-cleanup  shipped  tasks 3/3  PR #191  waiting on: —
    last action: exit:campaign_closed (<age> ago)
    0
    ```
  - `cd <task worktree>/plugins && tribe campaign status; echo $?` → the campaign whose two files are
    newest by mtime (today `post-rdo-followups`, mtime 1790606546), same shape, `0`.
  - `cd /tmp && tribe campaign status; echo $?` → `tribe: not inside a git repository (/private/tmp)` then `1`
    (macOS: `/tmp` is a symlink and `process.cwd()` returns `/private/tmp`).

- [ ] **Step 1: Commit** — one commit with trailers `Tribe-Card: campaign-status-cli` / `Tribe-Task: 4/5`.

### Done

```bash
cd plugins/tribe/scripts/cli && bun test campaign-status.e2e.test.ts
cd plugins && bun tribe/scripts/cli/main.ts campaign status post-rdo-followups | grep -qxF '  rdo-cleanup  shipped  tasks 3/3  PR #191  waiting on: —'
root="$PWD"; cd /tmp && out="$(bun "$root/plugins/tribe/scripts/cli/main.ts" campaign status 2>&1)"; test $? -eq 1 && test "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 1
```

## Task 5 — README + after-evidence against the Task 0 baseline
Files: `README.md` (Usage line; a "`tribe campaign status`" section with the post-rdo-followups sample,
the stuck rule, exit codes 0/1/2; Layout rows for `core/campaign-status.ts` and
`adapters/campaign-status.adapter.ts`), `package.json` description ("starts the session viewer and
shows campaign status"), `docs/superpowers/evidence/2026-09-28-campaign-status-cli/after.md` (summary only).

Commands whose summarised output goes into `after.md`:
```sh
cd <task worktree>/plugins
tribe campaign status post-rdo-followups; echo "exit=$?"
C=~/.tribe/-Users-hiep-repo-tribe/campaigns/post-rdo-followups
jq -r '.sequence[] as $id | .cards[$id] as $c | "\($id) \($c.status) \($c.pr) \($c.dependsOn) \([($c.tasks // [])[] | select((.passedSha? // "") != "")] | length)/\(($c.tasks // []) | length)"' $C/campaign-state.json
jq -r '"\(.state) \(.lastAction) \(.terminal.status):\(.terminal.reason)"' $C/supervisor/status.json
time tribe campaign status post-rdo-followups >/dev/null
tribe campaign status fu-supervisor-settings; echo "exit=$?"     # a v1 campaign (Q1)
```

### Verify
- Goal: Ratchet (before → after on the same command), G1 and D2 (tasks k/n) field-for-field on the real campaign, Q1 on a real v1 campaign, card "Do: update the CLI README".
- Red: `grep -c 'tribe campaign status' README.md` before editing → `0`.
- Green (expected):
  - `grep -c 'tribe campaign status' README.md` → at least `2` (Usage + section).
  - First command prints the five lines shown in Task 4's User-level block and `exit=0`; the jq lines print
    `fu-closing-dismiss shipped 190 null 1/1`, `rdo-cleanup shipped 191 ["fu-closing-dismiss"] 3/3`,
    `terminal exit:campaign_closed done:campaign_closed` — each value appears on the matching `tribe` line.
  - `time` reports `real` under `1.00s`.
  - `fu-supervisor-settings` prints a `campaign fu-supervisor-settings — …` header, card lines with `tasks 0/0`
    (its `tasks` are `null` on disk), and `exit=0` (not a v1 refusal).
  - `after.md` states: before (Task 0) `tribe: unknown option campaign …`, `exit=2`, 2 jq commands over 2 files →
    after 1 command, `exit=0`, measured `real` time.
- Stub check: a README without the section fails the grep; evidence that omits the jq comparison leaves the
  G1 oracle ("output compared to its files") unrun, so the Verify cannot be marked done.
- User-level: `tribe --help` includes `tribe campaign status [<name>] [--watch]`, exit 0;
  `tribe campaign status --port 1; echo $?` → `tribe: unknown option --port for campaign status (see tribe --help)` and `2`.

- [ ] **Step 1: Commit** — one commit with trailers `Tribe-Card: campaign-status-cli` / `Tribe-Task: 5/5`.

### Done

```bash
test "$(grep -c 'tribe campaign status' plugins/tribe/scripts/cli/README.md)" -ge 2
grep -qF 'exit=0' docs/superpowers/evidence/2026-09-28-campaign-status-cli/after.md
cd plugins && bun tribe/scripts/cli/main.ts campaign status fu-supervisor-settings | grep -qF 'tasks 0/0'
cd plugins && python3 -c "import subprocess,time,sys; t=time.time(); subprocess.run(['bun','tribe/scripts/cli/main.ts','campaign','status','post-rdo-followups'],check=True,capture_output=True,timeout=10); sys.exit(0 if time.time()-t < 1 else 1)"
```

---

## Goal → task → verify

| Card item | Proven in | Oracle (Verify line) |
| --- | --- | --- |
| G1 name, run state, N/M shipped, per-card status/PR/waiting-on | Task 2, Task 4, Task 5 | Task 2 exact line list; Task 4 `live` exact stdout; Task 5 real campaign vs jq |
| G2 current session + last action age | Task 2, Task 4 | `session: ruling b sess-1`, `last action: spawn_session (1m ago)` |
| G3 missing/corrupt/unknown → one line, non-zero, no traceback | Task 3, Task 4 | bare-home, unknown-name, corrupt-JSON E2E: exact stderr, exit 1, no `at ` frame |
| G4 stale > 10 min non-terminal → warning | Task 2, Task 4 | 11 min warns, 10 min and terminal do not; E2E `stuck` last line |
| D1 optional name, default most recent | Task 1, Task 3, Task 4 | parse `name: null`; flow picks `c1`; E2E no-name picks `live` from `repo/sub` |
| D2 (amended) card level + `tasks k/n` per card, display only | Task 2, Task 4, Task 5 | Task 2 `tasks 1/4` / `2/2` / `0/1` / `0/0` + wrong-type refusal; Task 4 `live` lines `tasks 0/0`; Task 5 real `tasks 1/1`, `tasks 3/3` vs jq; runner untouched (`git diff --stat master -- plugins/tribe/scripts/runner` empty) |
| D3 one-shot + `--watch` until Ctrl-C | Task 1, Task 3, Task 4 | 3 renders at 2000 ms; E2E ≥ 2 renders then SIGINT exit |
| D4 stale = not terminal and supervisor `updatedAt` > 10 min | Task 2 | `STALE_AFTER_MS = 600_000`, edge test at exactly 10 min |
| Q1 lenient reader, v1 shown | Task 2, Task 5 | v1 parse test; real `fu-supervisor-settings` renders |
| Q2 newest mtime | Task 2, Task 4 | `pickLatest`; E2E `utimesSync` fixtures |
| Q3 exit 2 bad args / 1 campaign errors | Task 1, Task 3, Task 5 | `campaign list` → 2; refusals → 1 |
| Q4 corrupt status.json refused | Task 3, Task 4 | `badsup` E2E exact stderr |
| Q5 fixed 2 s | Task 3 | `sleptWith` = `[2000, 2000, 2000]` |
| Q6 Way of work governs | Global Constraints | quoted Way of work |
| Ratchet < 1 s, 1 command vs 0 | Task 0 → Task 5 | baseline.md vs after.md, `time` |
| Empty-implementation test | every task | each Verify's Stub check |

