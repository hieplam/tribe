// serve.security.test.ts — Task 20's proof of the composition root: strict argument parsing, the
// `Host`/`Origin` gate, CSP + `nosniff`, the `dist/` allowlist and its fail-closed boot, D32a's
// `CLAUDE_CONFIG_DIR` resolution/validation, the v2 `/healthz` body, and the one routing rule for
// a path outside spec §3.2's table. Every case boots the REAL `serve.ts` as a genuinely separate
// process (the pattern `serve.api.test.ts` established) — never an in-process import.
//
// Oracle: this task's plan text (Task 20) plus spec §3.2, §10.4, §12, §13 are the contract.
// Under-checking (missing a real case) is a bug; over-checking (a stricter assertion than the
// spec requires) is by design and should be read as hardening, not a defect.
//
// Deviation, recorded here rather than only in the report so it travels with the diff (`the-brief-
// is-the-contract`): spec §13 requires `--port 0` to be REFUSED (grouped with `--port abc`/`--port
// 70000` under the same message) — a deliberate break from `Bun.serve`'s own "0 means OS-assigned
// ephemeral port" convention, because the runner integration (§10.1) needs a STABLE, known port
// across restarts. `serve.api.test.ts`, `serve.reads.test.ts`, and `serve.events.test.ts` (tasks
// 17-19, written before this validation existed) all spawned the real server with `--port 0` to
// get a free port from the OS; this task updates their three `startServer` helpers to discover a
// free port via `node:net` and pass it explicitly instead — the same test intent (an ephemeral
// port, chosen by the OS, for test isolation), the same assertions, only the plumbing that used to
// exploit the now-refused `0` changed.
import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHomeA, PROJECT_A_DIR, SESSION_1_ID } from './fixtures/build.ts';

const SERVE_TS = join(import.meta.dir, 'serve.ts');
const DIST_DIR = join(import.meta.dir, 'dist');
// A valid-shaped (matches `^[0-9a-fA-F-]{8,64}$`) but non-existent session id — spec §3.2's
// closing rule contrasts `/s/<id>` (always the shell, by prefix) with `/api/session/<id>` (a real
// 404 when the id is well-formed but absent). The literal string "does-not-exist" would instead
// fail `core/routes.ts`'s session-id CHARSET check and come back `400`, not `404` — asserting that
// literal here would test the wrong thing (routes.test.ts already covers the shape-refusal path).
const VALID_MISSING_SESSION = 'deadbeef-0000-4000-8000-000000000099';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tribe-viewer-security-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A real OS-assigned free port on `127.0.0.1`, released immediately before the real server binds
 * it — the ephemeral-port discovery this task's three sibling test files now use in place of the
 * `--port 0` shortcut spec §13 refuses (see the module doc comment above). */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not determine a free port'));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
  });
}

interface RunningServer {
  port: number;
  projectsRoot: string;
  stop(): void;
}

function waitForStartupLine(child: ChildProcess, timeoutMs: number): Promise<{ port: number; projectsRoot: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`server never printed its startup line; stdout so far: ${buffer}`)), timeoutMs);
    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:(\d+) \(projects root: ([^)]+)\)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve({ port: Number(match[1]), projectsRoot: match[2]! });
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}); stdout: ${buffer}`));
    });
  });
}

/** Spawns the REAL `serve.ts`, always with an explicit, OS-assigned port (never the now-refused
 * `--port 0`), waiting for its real startup line. `env` overrides exactly the given keys on top of
 * the current environment (never a whole `.env` file — this repo's own toolchain-discipline rule). */
async function startServer(env: Record<string, string | undefined>, extraArgs: string[] = []): Promise<RunningServer> {
  const port = await getFreePort();
  const child = spawn('bun', ['run', SERVE_TS, '--port', String(port), ...extraArgs], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrBuf = '';
  child.stderr?.on('data', (c) => (stderrBuf += c.toString()));
  const { projectsRoot } = await waitForStartupLine(child, 10_000).catch((e) => {
    child.kill('SIGKILL');
    throw new Error(`${e instanceof Error ? e.message : String(e)}; stderr: ${stderrBuf}`);
  });
  const stop = () => child.kill('SIGKILL');
  cleanups.push(stop);
  return { port, projectsRoot, stop };
}

/** Spawns `serve.ts` expecting it to REFUSE and exit before ever printing a startup line — the
 * argument-parsing / `CLAUDE_CONFIG_DIR` / port-in-use failure table (spec §13). Collects stderr
 * and the exit code; never waits past `timeoutMs` (`fail-closed-edges`: a hung child is exactly
 * the failure mode a bounded wait exists to catch). */
function runToExit(env: Record<string, string | undefined>, args: string[], timeoutMs = 8000): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', SERVE_TS, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr?.on('data', (c) => (stderr += c.toString()));
    child.stdout?.on('data', (c) => (stdout += c.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`process did not exit within ${timeoutMs}ms; stdout: ${stdout}; stderr: ${stderr}`));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
  });
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw HTTP request with fully controlled headers — including `Host`, which the Fetch API
 * forbids overriding but `node:http` does not, since the test controls both the TCP destination
 * (`127.0.0.1`) and the header value independently. This is how the `Host`/`Origin` gate (spec
 * §12.5) is actually exercised: a DNS-rebinding attacker controls the `Host` HEADER, not which IP
 * the socket connects to. */
function rawRequest(port: number, path: string, headers: Record<string, string>): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`request to ${path} timed out`)));
    req.end();
  });
}

describe('argument parsing (spec §13) — one stderr line, the stated exit code, never a stack trace', () => {
  test('--port abc: refused, exit 2, exact message', async () => {
    const { code, stderr, stdout } = await runToExit({}, ['--port', 'abc']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe('viewer: --port expects an integer 1-65535, got "abc"');
    expect(stderr.includes('at ')).toBe(false); // no stack trace frame
    expect(stdout).toBe('');
  });

  test('--port 0: refused, exit 2 (today: Bun.serve silently picks a random port, B14)', async () => {
    const { code, stderr } = await runToExit({}, ['--port', '0']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe('viewer: --port expects an integer 1-65535, got "0"');
  });

  test('--port 70000: refused, exit 2 (above the 1-65535 range)', async () => {
    const { code, stderr } = await runToExit({}, ['--port', '70000']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe('viewer: --port expects an integer 1-65535, got "70000"');
  });

  test('an unknown flag: refused, exit 2, naming it', async () => {
    const { code, stderr } = await runToExit({}, ['--bogus', 'x']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe('viewer: unknown flag --bogus');
  });

  test('--port with a following flag instead of a value: refused, never consumes the next flag as its value', async () => {
    // The exact class of bug fail-closed-edges obligation 1 names: `--card --base <sha>` reading
    // `--base` as the card's name (campaign gap-gate-2026-09-10). `--port --host` must be a
    // MISSING value for --port, never `--port` silently taking "--host" as its argument.
    const { code, stderr } = await runToExit({}, ['--port', '--host']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe('viewer: --port expects an integer 1-65535, got "--host"');
  });

  test('--port with no value at all (end of argv): refused, exit 2', async () => {
    const { code, stderr } = await runToExit({}, ['--port']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe('viewer: --port expects an integer 1-65535, got ""');
  });
});

describe('port already in use (spec §13)', () => {
  test('a second server on the same port refuses, exit 1, one stderr line, never a stack trace', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const first = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { code, stderr, stdout } = await runToExit({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') }, ['--port', String(first.port)]);
    expect(code).toBe(1);
    expect(stderr.trim()).toBe(`viewer: port ${first.port} is already in use`);
    expect(stderr.includes('at ')).toBe(false);
    expect(stdout).toBe('');
  });
});

describe('dist/index.html missing (spec §10.3/§13) — fail-closed startup, never a blank page', () => {
  test('serve.ts refuses to start, exit 2, exact message, when dist/index.html is absent', async () => {
    // The real, shared `dist/` (no `--dist` override exists — an overridable asset root is a
    // security surface for a read-only viewer, spec §16.5) is moved aside and restored in a
    // `finally`, exactly the reversible technique spec §16.5's own E4 test uses for the same
    // directory later in this plan — never left half-built even if an assertion below fails.
    const backup = `${DIST_DIR}.bak-security-test`;
    renameSync(DIST_DIR, backup);
    try {
      const root = tmpRoot();
      buildHomeA(root);
      const { code, stderr } = await runToExit({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') }, ['--port', '4321']);
      expect(code).toBe(2);
      expect(stderr.trim()).toBe('viewer: client not built — run ./install.sh (or: cd plugins/tribe/scripts/viewer && bun run build)');
    } finally {
      renameSync(backup, DIST_DIR);
    }
  });
});

describe('CLAUDE_CONFIG_DIR (D32a)', () => {
  test('set and non-empty: that root is used and printed on the startup line', async () => {
    const root = tmpRoot();
    buildHomeA(root); // creates <root>/cfg/projects/...
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    expect(server.projectsRoot.endsWith('/cfg/projects')).toBe(true);
    const res = await rawRequest(server.port, '/api/projects', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(200);
  });

  test('unset: ~/.claude/projects is used and printed on the startup line', async () => {
    const root = tmpRoot();
    mkdirSync(join(root, '.claude', 'projects'), { recursive: true });
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: undefined });
    expect(server.projectsRoot.endsWith('/.claude/projects')).toBe(true);
  });

  test('set but empty string: treated as unset — ~/.claude/projects is used, never the empty value', async () => {
    const root = tmpRoot();
    mkdirSync(join(root, '.claude', 'projects'), { recursive: true });
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: '' });
    expect(server.projectsRoot.endsWith('/.claude/projects')).toBe(true);
  });

  test('set to a path that does not exist: typed refusal, exit 2, never a silent fall back to ~/.claude', async () => {
    const root = tmpRoot();
    const missing = join(root, 'does-not-exist-xyz');
    const { code, stderr } = await runToExit({ HOME: root, CLAUDE_CONFIG_DIR: missing }, ['--port', '4321']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe(`viewer: CLAUDE_CONFIG_DIR=${missing} is not a readable directory`);
  });

  test('set to a path that is a FILE, not a directory: typed refusal, exit 2', async () => {
    const root = tmpRoot();
    const filePath = join(root, 'a-file-not-a-directory');
    writeFileSync(filePath, 'not a directory');
    const { code, stderr } = await runToExit({ HOME: root, CLAUDE_CONFIG_DIR: filePath }, ['--port', '4321']);
    expect(code).toBe(2);
    expect(stderr.trim()).toBe(`viewer: CLAUDE_CONFIG_DIR=${filePath} is not a readable directory`);
  });

  test('set to a directory with no read permission: typed refusal, exit 2 (never silently "empty")', async () => {
    const root = tmpRoot();
    const noPerm = join(root, 'no-permission');
    mkdirSync(noPerm);
    chmodSync(noPerm, 0o000);
    try {
      const { code, stderr } = await runToExit({ HOME: root, CLAUDE_CONFIG_DIR: noPerm }, ['--port', '4321']);
      expect(code).toBe(2);
      expect(stderr.trim()).toBe(`viewer: CLAUDE_CONFIG_DIR=${noPerm} is not a readable directory`);
    } finally {
      chmodSync(noPerm, 0o755); // restore before the afterEach rmSync cleans up the tmp root
    }
  });
});

describe('Host/Origin (spec §12.5, DNS rebinding, B16) — before routing', () => {
  test('a spoofed Host header (evil.example.com) is refused with 403', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: 'evil.example.com' });
    expect(res.status).toBe(403);
  });

  test('a valid Host but a mismatched Origin is refused with 403', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `127.0.0.1:${server.port}`, origin: 'http://evil.example.com' });
    expect(res.status).toBe(403);
  });

  test('Host: 127.0.0.1:PORT is accepted', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(200);
  });

  test('Host: localhost:PORT is accepted', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `localhost:${server.port}` });
    expect(res.status).toBe(200);
  });

  test('a matching Origin alongside a valid Host is accepted', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `127.0.0.1:${server.port}`, origin: `http://127.0.0.1:${server.port}` });
    expect(res.status).toBe(200);
  });
});

describe('CSP + nosniff (spec §12.5)', () => {
  test('the SPA shell carries the exact CSP header, and nosniff', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('nosniff is present on a JSON API response too (spec §12.5: "on every response")', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `127.0.0.1:${server.port}` });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('nosniff is present on a 403 refusal too', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: 'evil.example.com' });
    expect(res.status).toBe(403);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('/assets/<unknown> (spec §12.4)', () => {
  test('an unknown asset name is a flat JSON 404, not a path join, never a crash', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/assets/does-not-exist.js', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'asset not found' });
  });
});

describe('unlisted-path routing (spec §3.2 closing rule)', () => {
  test('/, /index.html, /p/<dir>, /s/<id> — the SPA shell, 200, by PREFIX not by existence', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    for (const path of ['/', '/index.html', `/p/${PROJECT_A_DIR}`, `/s/${SESSION_1_ID}`]) {
      const res = await rawRequest(server.port, path, { host: `127.0.0.1:${server.port}` });
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      expect(res.body.includes('tribe-viewer-shell-placeholder')).toBe(true);
    }
  });

  test('/s/does-not-exist is STILL the shell (client-routed by prefix; the client renders "no session with that id")', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/s/does-not-exist', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(200);
    expect(res.body.includes('tribe-viewer-shell-placeholder')).toBe(true);
  });

  test('/api/session/<valid-shaped-but-missing-id> is a 404 — the contrast with /s/<id> above', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, `/api/session/${VALID_MISSING_SESSION}`, { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(404);
  });

  test('/nonsense and /api/nonsense are flat JSON 404s carrying the path (§3.2)', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    for (const path of ['/nonsense', '/api/nonsense']) {
      const res = await rawRequest(server.port, path, { host: `127.0.0.1:${server.port}` });
      expect({ path, status: res.status, body: JSON.parse(res.body) }).toEqual({ path, status: 404, body: { error: 'not found', path } });
    }
  });
});

describe('/healthz — spec §10.4 (the stale-viewer defect)', () => {
  test('returns exactly {"ok":true,"viewer":"tribe-viewer","v":2}', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true,"viewer":"tribe-viewer","v":2}');
  });

  test('never produces the old v1 body — a future refactor cannot quietly restore it', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `127.0.0.1:${server.port}` });
    expect(res.body).not.toBe('{"ok":true,"viewer":"tribe-live-viewer","v":1}');
  });
});

describe('read-only and local (spec §12.1) — loopback asserted TWO ways', () => {
  test('the configured hostname is exactly 127.0.0.1 (from the startup line)', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const res = await rawRequest(server.port, '/healthz', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(200); // reachable on the loopback address itself
  });

  test('a socket to the machine\'s own non-loopback address on the same port is refused (ECONNREFUSED) — a server bound to 0.0.0.0 would pass the Host check above and fail this one', async () => {
    const nonLoopback = Object.values(networkInterfaces())
      .flat()
      .find((a) => a !== undefined && a.family === 'IPv4' && !a.internal)?.address;
    if (nonLoopback === undefined) {
      console.error('SKIP (loudly): this machine has no non-loopback IPv4 interface to test against');
      return;
    }
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    await expect(
      new Promise<void>((resolve, reject) => {
        const req = httpRequest({ host: nonLoopback, port: server.port, path: '/healthz', timeout: 3000 }, () => resolve());
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timed out instead of refusing — expected ECONNREFUSED')));
        req.end();
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('the idle-timeout regression (F55, folded in from the deleted idle-timeout.integration.test.ts)', () => {
  test(
    'a real /events stream on the real serve.ts stays open past Bun\'s ~10s default idle timeout, observed by a genuinely separate curl-shaped client',
    async () => {
      // Unlike the deleted standalone-script version (which reconstructed only the `Bun.serve`
      // call shape from `core/live/model.ts`'s `SSE_IDLE_TIMEOUT_SECONDS`), this spawns the REAL
      // `serve.ts` end to end: its own `idleTimeout: 255` literal is what is under test, and the
      // poller's real 15s ping (spec §6.2) is the "still alive" marker — a real session file, a
      // real scan, a real poll tick, exactly what a browser's EventSource experiences.
      const root = tmpRoot();
      buildHomeA(root);
      const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
      const out = await new Promise<string>((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port: server.port, path: `/events?session=${SESSION_1_ID}`, timeout: 20_000 },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            // Stop reading (and resolve) as soon as the 15s ping has arrived — no need to hold the
            // connection open the full 20s once the assertion's evidence has appeared.
            res.on('data', () => {
              if (body.includes('event: ping')) {
                res.destroy();
                resolve(body);
              }
            });
            res.on('end', () => resolve(body));
            res.on('error', () => resolve(body));
          },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error(`no ping within 20s; this is the F55 regression`)));
        req.end();
      });
      // If Bun's own ~10s idle-timeout default had fired (as it does with no `idleTimeout` option
      // set — this repo's own F55 finding reproduced that by hand with this exact shape), the
      // connection would have closed at ~10s, before the poller's first 15s ping ever fires.
      expect(out).toContain('event: ping');
    },
    25_000,
  );
});
