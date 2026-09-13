// e2e/served-build.e2e.test.ts — G6 (spec §16.5): the served build IS the built build. The server
// serves its FIXED dist/ and gains no --dist flag (an overridable asset root is a security surface
// for a read-only viewer), so the only honest way to prove "served == built" is: move any existing
// dist/ aside, run the real build, hash every produced file, start the real server, fetch every
// asset a real browser would load, hash each response body, and compare — restoring the prior
// dist/ in a `finally` so a failing assertion can never leave the tree half-built.
//
// EDGE code, outside the D16 wall (see dom-kinds.e2e.test.ts's header for the same note).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHomeA } from '../fixtures/build.ts';

const VIEWER_DIR = join(import.meta.dir, '..');
const SERVE_TS = join(VIEWER_DIR, 'serve.ts');
const DIST_DIR = join(VIEWER_DIR, 'dist');

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

/** Every `dist/`-relative file this test cares about hashing, walked directly from disk (index.html
 * plus every file under assets/). Returns `relPath -> sha256 hex`. */
function hashDistFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      if (lstatSync(abs).isDirectory()) {
        walk(abs, relPath);
      } else {
        out.set(relPath, createHash('sha256').update(readFileSync(abs)).digest('hex'));
      }
    }
  };
  walk(DIST_DIR, '');
  return out;
}

/** Every `/assets/<name>` path the built `index.html` itself references, via a `src="..."` or
 * `href="..."` attribute — the exact set a real browser loading the page would fetch. */
function assetPathsReferencedBy(html: string): string[] {
  const out = new Set<string>();
  const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.add(m[1]!);
  return [...out];
}

describe('served-build.e2e (G6, spec §16.5): the server serves exactly its fixed dist/', () => {
  let backupDir: string | null = null;
  let hadOriginalDist: boolean;
  let homeDir: string;
  let hashBefore: string;
  let viewer: ViewerHandle;
  let distFileHashes: Map<string, string>;
  let indexHtml: string;

  beforeAll(async () => {
    // Step 1: move any existing dist/ aside.
    hadOriginalDist = existsSync(DIST_DIR);
    if (hadOriginalDist) {
      backupDir = mkdtempSync(join(tmpdir(), 'vc-dist-backup-')) + '-dist';
      renameSync(DIST_DIR, backupDir);
    }

    // Step 2: `bun run build` into the real dist/.
    execFileSync('bun', ['run', 'build'], { cwd: VIEWER_DIR, stdio: 'pipe' });
    if (!existsSync(join(DIST_DIR, 'index.html'))) {
      throw new Error('bun run build did not produce dist/index.html');
    }

    // Step 3: hash every produced file.
    distFileHashes = hashDistFiles();
    indexHtml = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');

    // Step 4: start the server on an ephemeral port, against homeA (spec §16.2's digest table
    // names this suite as one of the four that run on homeA and must write nothing to it).
    homeDir = mkdtempSync(join(tmpdir(), 'vc-served-build-'));
    buildHomeA(homeDir);
    hashBefore = hashTree(homeDir);
    viewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(homeDir, 'cfg'), HOME: homeDir });
  }, 120_000);

  afterAll(async () => {
    await viewer.stop();
    const hashAfter = hashTree(homeDir);
    rmSync(homeDir, { recursive: true, force: true });

    // Restore the prior dist/ (or remove the one this test built, if there was none) — ALWAYS,
    // even if an assertion above already failed.
    rmSync(DIST_DIR, { recursive: true, force: true });
    if (hadOriginalDist && backupDir !== null) {
      renameSync(backupDir, DIST_DIR);
    } else if (backupDir !== null) {
      rmSync(backupDir, { recursive: true, force: true });
    }

    expect(hashAfter).toBe(hashBefore); // D16/G4 — nothing in this suite writes to homeA
  });

  test('GET / body hashes identical to dist/index.html', async () => {
    const res = await fetch(`http://127.0.0.1:${viewer.port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    const hash = createHash('sha256').update(body).digest('hex');
    expect(hash).toBe(createHash('sha256').update(indexHtml).digest('hex'));
  });

  test('GET /index.html body hashes identical to dist/index.html (named because §16.5 hashes it)', async () => {
    const res = await fetch(`http://127.0.0.1:${viewer.port}/index.html`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(createHash('sha256').update(body).digest('hex')).toBe(
      createHash('sha256').update(indexHtml).digest('hex'),
    );
  });

  test('every asset index.html references hashes identical to the file bun run build produced', async () => {
    const assetPaths = assetPathsReferencedBy(indexHtml);
    expect(assetPaths.length).toBeGreaterThan(0); // the build must actually reference something

    for (const assetPath of assetPaths) {
      const name = assetPath.replace(/^\/assets\//, '');
      const expectedHash = distFileHashes.get(`assets/${name}`);
      if (expectedHash === undefined) throw new Error(`dist/assets/${name} was referenced by index.html but never hashed`);

      const res = await fetch(`http://127.0.0.1:${viewer.port}${assetPath}`);
      expect(res.status).toBe(200);
      const body = Buffer.from(await res.arrayBuffer());
      const actualHash = createHash('sha256').update(body).digest('hex');
      expect(actualHash).toBe(expectedHash);
    }
  });
});
