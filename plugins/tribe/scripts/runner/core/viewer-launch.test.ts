import { expect, test } from 'bun:test';
import { campaignKeyOf, decideViewerLaunch, sessionUrlFor, viewerRootUrl } from './viewer-launch.ts';
import type { ProbeSignal } from '../ports/ports.ts';

const home = '/Users/hip/.tribe/-Users-hip-repo-x/campaigns/my-campaign';
const noResponse: ProbeSignal = { kind: 'no-response' };
const base = {
  dryRun: false,
  disabled: false,
  port: 4321,
  homeDir: home,
  entryPath: '/p/viewer/serve.ts',
  entryExists: true,
  probe: noResponse,
};

test('the campaign key derives from --home alone, with nothing persisted (card D5)', () => {
  expect(campaignKeyOf(home)).toEqual({ repoKey: '-Users-hip-repo-x', slug: 'my-campaign' });
});

// spec §9/§10.2: a campaign is identified by the PAIR, never the slug alone.
test('viewerRootUrl builds the exact pair URL (spec §10.2)', () => {
  expect(viewerRootUrl(4321, 'my-repo', 'my-slug')).toBe('http://127.0.0.1:4321/?campaign=my-repo/my-slug');
});

test('viewerRootUrl percent-encodes each half independently, leaving the "/" between them literal (F40)', () => {
  const url = viewerRootUrl(4321, 'a&evil=1', 'my slug');
  expect(url).toBe('http://127.0.0.1:4321/?campaign=a%26evil%3D1/my%20slug');
  // The literal '/' is still the pair separator the client parses on, not part of either half.
  const [repoKeyPart, slugPart] = url.split('?campaign=')[1]!.split('/');
  expect(decodeURIComponent(repoKeyPart as string)).toBe('a&evil=1');
  expect(decodeURIComponent(slugPart as string)).toBe('my slug');
});

test('viewerRootUrl percent-encodes non-ASCII characters in either half', () => {
  const url = viewerRootUrl(4321, 'répo', 'slüg');
  expect(url).toBe(`http://127.0.0.1:4321/?campaign=${encodeURIComponent('répo')}/${encodeURIComponent('slüg')}`);
});

test('sessionUrlFor is the base origin plus /s/<id>, ignoring the base\'s own query string', () => {
  expect(sessionUrlFor('http://127.0.0.1:4321/?campaign=my-repo/my-slug', 'd7d21837-6f4e-4b1a-9a02-2b6e4c1f8e55')).toBe(
    'http://127.0.0.1:4321/s/d7d21837-6f4e-4b1a-9a02-2b6e4c1f8e55',
  );
});

test('a dry run never spawns and never probes', () => {
  expect(decideViewerLaunch({ ...base, dryRun: true }).kind).toBe('skip');
});

test('--no-viewer and a missing entry both degrade to skip with a reason', () => {
  expect(decideViewerLaunch({ ...base, disabled: true }).kind).toBe('skip');
  const missing = decideViewerLaunch({ ...base, entryExists: false });
  expect(missing.kind).toBe('skip');
  expect(missing.note).toContain('serve.ts');
});

// spec §10.4 outcome 1: a v2 body -> reuse.
test('probe outcome 1: a v2 body ("tribe-viewer", v:2) is reused', () => {
  const probe: ProbeSignal = { kind: 'responded', body: { ok: true, viewer: 'tribe-viewer', v: 2 } };
  const d = decideViewerLaunch({ ...base, probe });
  expect(d.kind).toBe('reuse');
  expect(d.url).toBe(viewerRootUrl(4321, '-Users-hip-repo-x', 'my-campaign'));
});

// The accept condition is a FLOOR, not an equality — a future v3 viewer stays reusable.
test('probe outcome 1 (floor): a v3 body is still reused', () => {
  const probe: ProbeSignal = { kind: 'responded', body: { ok: true, viewer: 'tribe-viewer', v: 3 } };
  expect(decideViewerLaunch({ ...base, probe }).kind).toBe('reuse');
});

// spec §10.4 outcome 2: nothing listening -> spawn. Argv never carries --tribe-root (both
// roots now resolve from HOME inside the viewer itself, §5/§12.3).
test('probe outcome 2: no-response spawns bun against the sibling entry, with no --tribe-root', () => {
  const d = decideViewerLaunch({ ...base, probe: noResponse });
  expect(d.kind).toBe('spawn');
  expect(d.argv).toEqual(['bun', '/p/viewer/serve.ts', '--port', '4321']);
  expect(d.argv).not.toContain('--tribe-root');
});

// spec §10.4 outcome 3, sub-case a: the old pre-consolidation v1 body.
test('probe outcome 3a: a v1 body ("tribe-live-viewer") is neither reused nor spawned', () => {
  const probe: ProbeSignal = { kind: 'responded', body: { ok: true, viewer: 'tribe-live-viewer', v: 1 } };
  const d = decideViewerLaunch({ ...base, probe });
  expect(d.kind).toBe('stale');
  expect(d.url).toBeNull();
  expect(d.argv).toBeNull();
  expect(d.note).toBe('stale viewer on port 4321, stop it or pass --viewer-port <n> (needs v2, got v1)');
});

// spec §10.4 outcome 3, sub-case b: a non-JSON / unparseable body.
test('probe outcome 3b: an unparseable body is neither reused nor spawned', () => {
  const probe: ProbeSignal = { kind: 'unparseable' };
  const d = decideViewerLaunch({ ...base, probe });
  expect(d.kind).toBe('stale');
  expect(d.url).toBeNull();
  expect(d.note).toBe('stale viewer on port 4321, stop it or pass --viewer-port <n> (needs v2, got v1)');
});

// spec §10.4 outcome 3, sub-case c: a 200 from something unrelated (no viewer/v fields at all).
test('probe outcome 3c: an unrelated 200 body is neither reused nor spawned', () => {
  const probe: ProbeSignal = { kind: 'responded', body: { ok: true, someOtherService: true } };
  const d = decideViewerLaunch({ ...base, probe });
  expect(d.kind).toBe('stale');
  expect(d.url).toBeNull();
  expect(d.note).toBe('stale viewer on port 4321, stop it or pass --viewer-port <n> (needs v2, got v1)');
});
