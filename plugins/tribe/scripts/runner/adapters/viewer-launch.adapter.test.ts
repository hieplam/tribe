// adapters/viewer-launch.adapter.test.ts — the production ViewerPort's two world-touching
// facts, tested against real (but local, bounded) I/O: a real detached spawn of a
// nonexistent binary (F38 regression: an unlistened spawn 'error' must never take down the
// parent; F49 regression: that same spawn error must now be REPORTED, not swallowed), and a
// real local Bun.serve fake for the reuse probe (spec §10.4 / Task 27: the probe must report a
// typed `ProbeSignal`, never a bare accept/reject boolean, so `core/viewer-launch.ts` alone
// decides reuse/spawn/stale).
import { expect, test } from 'bun:test';
import { buildViewerPort, launchViewer } from './viewer-launch.adapter.ts';

// F38 — the most important test in this file. Before the fix, a detached spawn of a
// nonexistent binary emits an unlistened 'error' event on a later tick; Node/Bun treat an
// unlistened 'error' as an uncaught exception and kill the whole process. This spawns a
// real child (subprocess, not `bun -e` — spawnDetached itself must be exercised) and proves
// THIS process is still alive well after the async 'error' would have fired.
test('spawnDetached against a nonexistent binary does not kill the parent process (F38)', async () => {
  const port = buildViewerPort();

  expect(() => {
    port.spawnDetached(['/nonexistent/binary/for/sure/f38', '--port', '4321']);
  }).not.toThrow();

  // The spawn 'error' (ENOENT) fires asynchronously, on a later tick than the synchronous
  // call above — give it room to fire and (pre-fix) crash the process before this test's
  // assertion below ever runs.
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Reaching this line at all is the proof: an unhandled 'error' event would have thrown
  // an uncaught exception and torn down the whole bun test process before this point.
  expect(true).toBe(true);
});

// F49 — before the fix, the spawn 'error' handler was `() => {}`: a silent no-op. A viewer
// start failure (bun unresolvable, ENOENT, EACCES, fd exhaustion) was therefore never
// reported anywhere, contradicting the README/C3 docs' own claim that it "is logged to
// stderr". This proves the handler now emits exactly one stderr line for a real spawn
// error, and still never throws (the F38 guarantee must hold together with the new report).
test('spawnDetached against a nonexistent binary reports exactly one stderr line and does not throw (F49)', async () => {
  const port = buildViewerPort();
  const calls: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    expect(() => {
      port.spawnDetached(['/definitely-not-a-real-binary-xyz', '--port', '4321']);
    }).not.toThrow();

    // The spawn 'error' (ENOENT) fires asynchronously — give it room to fire before
    // asserting on what it produced.
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    console.error = originalConsoleError;
  }

  expect(calls.length).toBe(1);
  expect(String(calls[0]?.[0])).toMatch(/^campaign viewer: failed to start/);
});

test('probeViewer against a fake serving the new v2 identity ("tribe-viewer") reports "responded" with the body (spec §10.4)', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/healthz') {
        return Response.json({ ok: true, viewer: 'tribe-viewer', v: 2 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const port = buildViewerPort();
    expect(await port.probeViewer(server.port!)).toEqual({
      kind: 'responded',
      body: { ok: true, viewer: 'tribe-viewer', v: 2 },
    });
  } finally {
    server.stop(true);
  }
});

test('probeViewer against a fake serving the OLD v1 identity ("tribe-live-viewer") still reports "responded" — classification is core\'s job, not the adapter\'s', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/healthz') {
        return Response.json({ ok: true, viewer: 'tribe-live-viewer', v: 1 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const port = buildViewerPort();
    expect(await port.probeViewer(server.port!)).toEqual({
      kind: 'responded',
      body: { ok: true, viewer: 'tribe-live-viewer', v: 1 },
    });
  } finally {
    server.stop(true);
  }
});

test('probeViewer against a 200 with a wrong/absent identity marker reports "responded" with that body', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/healthz') {
        return Response.json({ ok: true, someOtherService: true });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const port = buildViewerPort();
    expect(await port.probeViewer(server.port!)).toEqual({
      kind: 'responded',
      body: { ok: true, someOtherService: true },
    });
  } finally {
    server.stop(true);
  }
});

test('probeViewer against a 200 with a non-JSON body reports "unparseable", never throws (fail-closed-edges.md)', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/healthz') {
        return new Response('plain text, not json', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const port = buildViewerPort();
    await expect(port.probeViewer(server.port!)).resolves.toEqual({ kind: 'unparseable' });
  } finally {
    server.stop(true);
  }
});

test('probeViewer against an unreachable port reports "no-response", never throws', async () => {
  const port = buildViewerPort();
  // Port 1 is a privileged, essentially-never-listening port on any dev machine — a stable
  // "nothing here" target without needing to pre-bind-then-close a port ourselves.
  await expect(port.probeViewer(1)).resolves.toEqual({ kind: 'no-response' });
});

// --- launchViewer, wired end-to-end against a REAL fake server (Task 27 audit lens / R4
// ruling: "an adapter test that a v1 body is rejected and a v2 body accepted" — a mocked
// probe alone cannot show the actual defect spec §10.4 exists to close). `entryPath` is this
// very test file (always exists on disk), so `existsSync` never short-circuits the probe.

test('launchViewer against a real v2 viewer REUSES it (spec §10.4 outcome 1)', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/healthz') {
        return Response.json({ ok: true, viewer: 'tribe-viewer', v: 2 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const decision = await launchViewer(
      { dryRun: false, disabled: false, port: server.port!, homeDir: '/x/.tribe/-Users-hip-repo-x/campaigns/my-campaign' },
      buildViewerPort(),
      import.meta.path,
    );
    expect(decision.kind).toBe('reuse');
    expect(decision.url).toBe(`http://127.0.0.1:${server.port}/?campaign=-Users-hip-repo-x/my-campaign`);
    expect(decision.note).toBeNull();
  } finally {
    server.stop(true);
  }
});

test('launchViewer against a real v1 (pre-consolidation) viewer REJECTS it — neither reuse nor spawn (spec §10.4 outcome 3)', async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/healthz') {
        return Response.json({ ok: true, viewer: 'tribe-live-viewer', v: 1 });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const decision = await launchViewer(
      { dryRun: false, disabled: false, port: server.port!, homeDir: '/x/.tribe/-Users-hip-repo-x/campaigns/my-campaign' },
      buildViewerPort(),
      import.meta.path,
    );
    expect(decision.kind).toBe('stale');
    expect(decision.url).toBeNull();
    expect(decision.argv).toBeNull();
    expect(decision.note).toBe(`stale viewer on port ${server.port}, stop it or pass --viewer-port <n> (needs v2, got v1)`);
  } finally {
    server.stop(true);
  }
});
