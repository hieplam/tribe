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
// The cast goes through `unknown` because a refusal has no `value`: `expect` above is what
// proves this parse is the ok branch, and tsc cannot see that (plan's helper, tsc-clean form).
function ok<T>(p: { ok: boolean }): T { expect(p.ok).toBe(true); return (p as unknown as { value: T }).value; }
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

test('sequence refuses an id without an own card', () => {
  expect(parseCampaignState({ campaign: 'x', sequence: ['toString'], cards: {} }))
    .toEqual({ ok: false, reason: 'sequence.toString has no card' });
});

test('inherited card names do not satisfy dependencies', () => {
  const s = ok<StatusState>(parseCampaignState({ campaign: 'x', sequence: ['a'], cards: {
    a: { status: 'staged', dependsOn: ['toString'] },
  } }));
  expect(renderStatus({ name: 'x', state: s, supervisor: null, nowMs: NOW })[2])
    .toBe('  a  staged  tasks 0/0  PR —  waiting on: toString');
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
