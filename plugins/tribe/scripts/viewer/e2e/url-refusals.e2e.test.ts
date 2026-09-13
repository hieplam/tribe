// e2e/url-refusals.e2e.test.ts — the URL matrix of spec §16.2, driven over real HTTP against a
// real `serve.ts` child process (never a browser: this suite is about server status codes and
// bodies, not what a human sees — that is dom-kinds.e2e.test.ts's job).
//
// EDGE code, outside the D16 wall (`e2e/` — see dom-kinds.e2e.test.ts's header for the same note).
// Root resolution the PRODUCTION way (D32b): `CLAUDE_CONFIG_DIR=<homeA>/cfg`, `HOME=<homeA>`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHomeA, PROJECT_A_DIR, PROJECT_B_DIR, SESSION_1_ID, SESSION_2_ID, SUBAGENT_IDS } from '../fixtures/build.ts';

const SERVE_TS = join(import.meta.dir, '..', 'serve.ts');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T | null> | T | null, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== null && v !== undefined && v !== false) return v as T;
    last = v;
    await sleep(150);
  }
  throw new Error(`${label}: timed out after ${timeoutMs}ms (last observed: ${JSON.stringify(last)})`);
}

function findFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error('Bun.serve({ port: 0 }) did not report a bound port');
  return port;
}

interface ViewerHandle {
  port: number;
  stop(): Promise<void>;
}

async function spawnViewer(env: Record<string, string | undefined>): Promise<ViewerHandle> {
  const port = findFreePort();
  const fullEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined) fullEnv[k] = v;
  }
  const proc: ChildProcess = spawn('bun', [SERVE_TS, '--port', String(port)], { env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrBuf = '';
  proc.stderr?.on('data', (c) => (stderrBuf += c.toString()));
  let exited = false;
  proc.on('exit', () => {
    exited = true;
  });

  await waitFor(
    async () => {
      if (exited) throw new Error(`viewer process exited before becoming healthy; stderr:\n${stderrBuf}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return null;
        const body = (await res.json()) as { ok?: boolean; viewer?: string; v?: number };
        return body.ok === true && body.viewer === 'tribe-viewer' && body.v === 2 ? true : null;
      } catch {
        return null;
      }
    },
    20_000,
    `viewer on port ${port} never answered a healthy /healthz`,
  );

  async function stop(): Promise<void> {
    if (exited) return;
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!exited) proc.kill('SIGKILL');
        resolve();
      }, 3000);
    });
  }

  return { port, stop };
}

function hashTree(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        entries.push(`L ${relPath} -> ${readlinkSync(abs)}`);
      } else if (st.isDirectory()) {
        walk(abs, relPath);
      } else {
        const digest = createHash('sha256').update(readFileSync(abs)).digest('hex');
        entries.push(`F ${relPath} ${digest} ${st.size}`);
      }
    }
  };
  walk(root, '');
  return createHash('sha256').update(entries.sort().join('\n')).digest('hex');
}

describe('url-refusals.e2e (spec §16.2 URL matrix, over real HTTP)', () => {
  let homeDir: string;
  let viewer: ViewerHandle;
  let hashBefore: string;

  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'vc-url-refusals-'));
    buildHomeA(homeDir);
    hashBefore = hashTree(homeDir);
    viewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(homeDir, 'cfg'), HOME: homeDir });
  }, 30_000);

  afterAll(async () => {
    await viewer.stop();
    const hashAfter = hashTree(homeDir);
    rmSync(homeDir, { recursive: true, force: true });
    expect(hashAfter).toBe(hashBefore); // D16/G4 — nothing in this suite writes to homeA
  });

  function url(path: string): string {
    return `http://127.0.0.1:${viewer.port}${path}`;
  }

  test('a valid session id: /s/<id> renders the shell (200) and /api/session/<id> resolves it', async () => {
    const shellRes = await fetch(url(`/s/${SESSION_1_ID}`));
    expect(shellRes.status).toBe(200);
    const apiRes = await fetch(url(`/api/session/${SESSION_1_ID}`));
    expect(apiRes.status).toBe(200);
    const body = (await apiRes.json()) as { session: { id: string } };
    expect(body.session.id).toBe(SESSION_1_ID);
  });

  test('an id belonging to the OTHER project renders 200 — sessionId resolves globally (§5.2), no project in the URL', async () => {
    const shellRes = await fetch(url(`/s/${SESSION_2_ID}`));
    expect(shellRes.status).toBe(200);
    const apiRes = await fetch(url(`/api/session/${SESSION_2_ID}`));
    expect(apiRes.status).toBe(200);
    const body = (await apiRes.json()) as { session: { id: string; projectDir: string } };
    expect(body.session.id).toBe(SESSION_2_ID);
    expect(body.session.projectDir).toBe(PROJECT_B_DIR);
  });

  test('an absent id: /s/<id> still returns the index shell (client-routed, §3.2); /api/session/<id> is what 404s', async () => {
    const absentId = 'deadbeef-dead-4dea-8dea-deadbeefdead';
    const shellRes = await fetch(url(`/s/${absentId}`));
    expect(shellRes.status).toBe(200);
    const apiRes = await fetch(url(`/api/session/${absentId}`));
    expect(apiRes.status).toBe(404);
  });

  // ".." as the id, over a REAL request. Both the WHATWG URL parser and Bun's own HTTP layer
  // collapse "/api/session/.." to "/api/" BEFORE core/routes.ts ever sees a pathname (verified
  // empirically: a raw-socket request with the literal request-line path collapses identically;
  // new URL("http://x/api/session/..").pathname is "/api/"). core/routes.test.ts's own unit test
  // for the SAME literal string documents this exact fact and expects `not_found` at "/api/", not
  // `bad_request` — there is no session-id branch left standing to refuse. Still SAFE either way
  // (no path is ever joined), just a DIFFERENT status than the spec §16.2 table's "400" gloss
  // names, because no real HTTP caller can ever deliver an un-normalized ".." segment to this
  // parser (fixtures-mirror-reality: assert what a real caller can actually produce).
  test('".." as the id over a real request: collapses to /api/ before routing, so the safe outcome is 404 (not 400)', async () => {
    const res = await fetch(url('/api/session/..'));
    expect(res.status).toBe(404); // collapses to GET /api/, which is a plain JSON 404 (not the shell)
    const body = (await res.json()) as { error: string; path: string };
    expect(body.path).toBe('/api/');
  });

  test('a percent-encoded "/": 400', async () => {
    const res = await fetch(url('/api/session/a%2Fb'));
    expect(res.status).toBe(400);
  });

  test('a double-encoded "..%2f": 400', async () => {
    // The literal `../` double-percent-encoded: `%` itself percent-encoded (`%25`) around the
    // already-encoded `..%2f`. One `decodeURIComponent` pass (what `core/routes.ts#safeDecode`
    // performs) yields `..%2f` verbatim — a literal `%` character, which the session-id charset
    // (`^[0-9a-fA-F-]{8,64}$`) refuses either way.
    const res = await fetch(url('/api/session/..%252f'));
    expect(res.status).toBe(400);
  });

  test('a NUL byte in the id: 400', async () => {
    const res = await fetch(url('/api/session/%00'));
    expect(res.status).toBe(400);
  });

  test('/api/spill?name=escaping.txt is refused (400/403) — resolves outside the projects root', async () => {
    const res = await fetch(url(`/api/spill?session=${SESSION_1_ID}&name=escaping.txt`));
    expect([400, 403]).toContain(res.status);
  });

  test('/api/spill?name=in-session.txt is served (200) — resolves inside the session', async () => {
    const res = await fetch(url(`/api/spill?session=${SESSION_1_ID}&name=in-session.txt`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  test('the sibling-session sidecar is served (200) — D14\'s root is the PROJECTS directory', async () => {
    const res = await fetch(url(`/api/rows?session=${SESSION_1_ID}&agent=${SUBAGENT_IDS.sibling}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: { k: string }[] };
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  test('there is no /p/<project>/s/<id> nested route — /p/ and /s/ are siblings (§3.2)', async () => {
    // Not a hostile shape, just a shape that does not exist: the server never probes the
    // filesystem to decide, so an extra path segment under /p/ is STILL client-routed (the shell),
    // per §3.2's closing rule ("everything else under /p/ or /s/ ... is still client-routed").
    const res = await fetch(url(`/p/${PROJECT_A_DIR}/s/${SESSION_1_ID}`));
    expect(res.status).toBe(200);
  });
});
