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
