import { expect, test } from 'bun:test';
import type { ProbeSignal } from '../../runner/ports/ports.ts';
import { MAX_PORT_ATTEMPTS, runViewer, type StartResult, type ViewerIo } from './viewer.ts';

const viewerBody: ProbeSignal = { kind: 'responded', body: { ok: true, viewer: 'tribe-viewer', v: 2 } };
const otherService: ProbeSignal = { kind: 'responded', body: { hello: 'world' } };
const nothing: ProbeSignal = { kind: 'no-response' };

/** A scripted world: `probes` answers each port, `starts` answers each spawn in order. */
function fakeIo(
  probes: Record<number, ProbeSignal>,
  starts: Array<{ started: StartResult; exitCode: number }> = [],
  lan: string[] = ['192.168.1.20'],
) {
  const calls = {
    spawned: [] as number[],
    spawnHosts: [] as string[],
    probeHosts: [] as string[],
    opened: [] as string[],
    logs: [] as string[],
    warns: [] as string[],
  };
  const io: ViewerIo = {
    probe: async (port, host) => {
      calls.probeHosts.push(host);
      return probes[port] ?? nothing;
    },
    lanAddresses: () => lan,
    start: (port, bindHost, probeHost) => {
      calls.spawned.push(port);
      calls.spawnHosts.push(`${bindHost}>${probeHost}`);
      const next = starts.shift();
      if (!next) throw new Error(`unexpected spawn on ${port}`);
      return { started: Promise.resolve(next.started), exited: Promise.resolve(next.exitCode) };
    },
    openUrl: (url) => calls.opened.push(url),
    log: (m) => calls.logs.push(m),
    warn: (m) => calls.warns.push(m),
  };
  return { io, calls };
}

const opts = { port: 4321, open: true, strictPort: false, host: '127.0.0.1' };

test('a free port spawns the viewer, opens the browser once it answers, and returns its exit code', async () => {
  const { io, calls } = fakeIo({}, [{ started: { kind: 'ready' }, exitCode: 0 }]);
  expect(await runViewer(opts, io)).toBe(0);
  expect(calls.spawned).toEqual([4321]);
  expect(calls.opened).toEqual(['http://127.0.0.1:4321/']);
});

test('--no-open never opens the browser', async () => {
  const { io, calls } = fakeIo({}, [{ started: { kind: 'ready' }, exitCode: 0 }]);
  await runViewer({ ...opts, open: false }, io);
  expect(calls.opened).toEqual([]);
});

test('a tribe viewer already on the port is reused: no spawn, browser opened, exit 0', async () => {
  const { io, calls } = fakeIo({ 4321: viewerBody });
  expect(await runViewer(opts, io)).toBe(0);
  expect(calls.spawned).toEqual([]);
  expect(calls.opened).toEqual(['http://127.0.0.1:4321/']);
  expect(calls.logs.join('\n')).toContain('already running');
});

test('a port held by another service is skipped for the next one', async () => {
  const { io, calls } = fakeIo({ 4321: otherService, 4322: { kind: 'unparseable' } }, [
    { started: { kind: 'ready' }, exitCode: 0 },
  ]);
  await runViewer(opts, io);
  expect(calls.spawned).toEqual([4323]);
  expect(calls.opened).toEqual(['http://127.0.0.1:4323/']);
});

test('a port that refuses the bind (viewer exit 1) is skipped for the next one', async () => {
  const { io, calls } = fakeIo({}, [
    { started: { kind: 'exited', code: 1 }, exitCode: 1 },
    { started: { kind: 'ready' }, exitCode: 0 },
  ]);
  await runViewer(opts, io);
  expect(calls.spawned).toEqual([4321, 4322]);
});

test('--strict-port refuses with exit 1 instead of moving to another port', async () => {
  const { io, calls } = fakeIo({ 4321: otherService });
  expect(await runViewer({ ...opts, strictPort: true }, io)).toBe(1);
  expect(calls.spawned).toEqual([]);
  expect(calls.warns.join('\n')).toContain('4321');
});

test(`gives up with exit 1 after ${MAX_PORT_ATTEMPTS} occupied ports`, async () => {
  const probes: Record<number, ProbeSignal> = {};
  for (let p = 4321; p < 4321 + MAX_PORT_ATTEMPTS; p += 1) probes[p] = otherService;
  const { io, calls } = fakeIo(probes);
  expect(await runViewer(opts, io)).toBe(1);
  expect(calls.warns.at(-1)).toContain(`4321-${4321 + MAX_PORT_ATTEMPTS - 1}`);
});

test('never walks past port 65535', async () => {
  const { io, calls } = fakeIo({ 65535: otherService });
  expect(await runViewer({ ...opts, port: 65535 }, io)).toBe(1);
  expect(calls.spawned).toEqual([]);
});

test('any other viewer refusal (exit 2) is passed through, not retried', async () => {
  const { io, calls } = fakeIo({}, [{ started: { kind: 'exited', code: 2 }, exitCode: 2 }]);
  expect(await runViewer(opts, io)).toBe(2);
  expect(calls.spawned).toEqual([4321]);
  expect(calls.opened).toEqual([]);
});

test('a viewer that never answers in time is left running, with no browser and a warning', async () => {
  const { io, calls } = fakeIo({}, [{ started: { kind: 'timeout' }, exitCode: 0 }]);
  expect(await runViewer(opts, io)).toBe(0);
  expect(calls.opened).toEqual([]);
  expect(calls.warns.join('\n')).toContain('did not answer');
});

test('--remote binds 0.0.0.0, checks the port through the LAN address, and opens the local URL', async () => {
  const { io, calls } = fakeIo({}, [{ started: { kind: 'ready' }, exitCode: 0 }]);
  await runViewer({ ...opts, host: '0.0.0.0' }, io);
  // Through the LAN address: a localhost-only viewer on the port must NOT count as reusable,
  // because the other devices could not reach it.
  expect(calls.probeHosts).toEqual(['192.168.1.20']);
  expect(calls.spawnHosts).toEqual(['0.0.0.0>192.168.1.20']);
  expect(calls.opened).toEqual(['http://127.0.0.1:4321/']);
});

test('--remote on a machine with no LAN address still starts, checking through loopback', async () => {
  const { io, calls } = fakeIo({}, [{ started: { kind: 'ready' }, exitCode: 0 }], []);
  await runViewer({ ...opts, host: '0.0.0.0' }, io);
  expect(calls.probeHosts).toEqual(['127.0.0.1']);
});

test('--host <LAN address> probes and opens that address (it does not answer on 127.0.0.1)', async () => {
  const { io, calls } = fakeIo({}, [{ started: { kind: 'ready' }, exitCode: 0 }]);
  await runViewer({ ...opts, host: '192.168.1.20' }, io);
  expect(calls.probeHosts).toEqual(['192.168.1.20']);
  expect(calls.opened).toEqual(['http://192.168.1.20:4321/']);
});

test('--host localhost is probed as 127.0.0.1', async () => {
  const { io, calls } = fakeIo({ 4321: viewerBody });
  await runViewer({ ...opts, host: 'localhost' }, io);
  expect(calls.probeHosts).toEqual(['127.0.0.1']);
});
