// tribe.e2e.test.ts — the `tribe` command as a user runs it: a bare `tribe` found on PATH
// through a symlink (what ./install.sh creates), typed from an unrelated working directory,
// against the real viewer. The unit tests in core/ cover the decisions; this covers the wiring.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

const TRIBE_BIN = join(import.meta.dir, 'bin', 'tribe');
let root: string;
let env: Record<string, string>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tribe-cli-e2e-'));
  mkdirSync(join(root, 'bin'));
  symlinkSync(TRIBE_BIN, join(root, 'bin', 'tribe'));
  mkdirSync(join(root, 'home', '.claude', 'projects'), { recursive: true });
  mkdirSync(join(root, 'somewhere'));
  // HOME points at an empty fixture so the viewer never reads the real ~/.claude.
  env = { ...(process.env as Record<string, string>), PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: join(root, 'home') };
  delete env.CLAUDE_CONFIG_DIR;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function freePort(): number {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const port = probe.port as number;
  probe.stop(true);
  return port;
}

function runTribe(args: string[]) {
  return Bun.spawn(['tribe', ...args], { cwd: join(root, 'somewhere'), env, stdout: 'pipe', stderr: 'pipe' });
}

/** Stops `tribe` the way a user does (Ctrl-C), so it takes its viewer child down with it. A
 * SIGKILL cannot be forwarded and would orphan the viewer; it is only the fallback. */
async function stopTribe(child: ReturnType<typeof runTribe>): Promise<void> {
  child.kill('SIGINT');
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
  if (!exited) child.kill('SIGKILL');
}

/** Reads the child's stdout until `needle` appears; fails the test after 15 s. */
async function waitForOutput(stream: ReadableStream<Uint8Array>, needle: string): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const deadline = Date.now() + 15_000;
  while (!seen.includes(needle)) {
    if (Date.now() > deadline) throw new Error(`never printed ${JSON.stringify(needle)}; got: ${seen}`);
    const { value, done } = await reader.read();
    if (done) throw new Error(`exited before printing ${JSON.stringify(needle)}; got: ${seen}`);
    seen += decoder.decode(value);
  }
  reader.releaseLock();
  return seen;
}

test('bare `tribe` starts the viewer, a second `tribe` reuses it, Ctrl-C stops it cleanly', async () => {
  const port = freePort();
  const first = runTribe(['--no-open', '--port', String(port)]);
  try {
    await waitForOutput(first.stdout, `http://127.0.0.1:${port}`);
    const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
    expect(health).toEqual({ ok: true, viewer: 'tribe-viewer', v: 2 });

    const second = runTribe(['--no-open', '--port', String(port)]);
    expect(await second.exited).toBe(0);
    expect(await new Response(second.stdout).text()).toContain('already running');

    first.kill('SIGINT');
    expect(await first.exited).toBe(0);
  } finally {
    first.kill('SIGKILL');
  }
}, 30_000);

test('`tribe` moves to the next port when another service holds the requested one', async () => {
  const blocker = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ hello: 'world' }) });
  const taken = blocker.port as number;
  const child = runTribe(['--no-open', '--port', String(taken)]);
  try {
    const out = await waitForOutput(child.stdout, 'tribe viewer: http://127.0.0.1:');
    expect(out).toContain(`port ${taken} is in use, trying ${taken + 1}`);
    child.kill('SIGINT');
    expect(await child.exited).toBe(0);
  } finally {
    child.kill('SIGKILL');
    blocker.stop(true);
  }
}, 30_000);

test('`tribe --strict-port` refuses a taken port with exit 1', async () => {
  const blocker = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ hello: 'world' }) });
  try {
    const child = runTribe(['--no-open', '--strict-port', '--port', String(blocker.port)]);
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain(`port ${blocker.port} is in use`);
  } finally {
    blocker.stop(true);
  }
}, 30_000);

const lanAddress = Object.values(networkInterfaces())
  .flatMap((list) => list ?? [])
  .find((a) => a.family === 'IPv4' && !a.internal)?.address;

test('`tribe --remote` is reachable from the network, and a localhost-only viewer on the port is not mistaken for it', async () => {
  if (lanAddress === undefined) {
    console.error('SKIP (loudly): this machine has no non-loopback IPv4 interface to test against');
    return;
  }
  const port = freePort();
  const localOnly = runTribe(['--no-open', '--port', String(port)]);
  let remote: ReturnType<typeof runTribe> | undefined;
  try {
    await waitForOutput(localOnly.stdout, `http://127.0.0.1:${port}`);
    // Other devices cannot reach the localhost-only viewer...
    await expect(fetch(`http://${lanAddress}:${port}/healthz`)).rejects.toThrow();

    // ...so `tribe --remote` must start a network-reachable one rather than "reuse" it.
    remote = runTribe(['--no-open', '--remote', '--port', String(port)]);
    const out = await waitForOutput(remote.stdout, 'no password');
    expect(out).toContain(`on your network at http://${lanAddress}:`);
    const url = /on your network at (http:\/\/[^\s]+)/.exec(out)![1]!;
    const health = await fetch(`${url}/healthz`);
    expect(await health.json()).toEqual({ ok: true, viewer: 'tribe-viewer', v: 2 });

    // A second `tribe --remote` on the same port reuses the network viewer.
    const again = runTribe(['--no-open', '--remote', '--port', String(new URL(url).port)]);
    expect(await again.exited).toBe(0);
    expect(await new Response(again.stdout).text()).toContain('already running');
  } finally {
    await stopTribe(localOnly);
    if (remote !== undefined) await stopTribe(remote);
  }
}, 30_000);
