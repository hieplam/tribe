// e2e/real-transcript.e2e.test.ts — spec §16.2's closing paragraph: the SAME DOM assertions
// dom-kinds.e2e.test.ts proves against a synthetic fixture, run READ-ONLY against the largest real
// transcript on this machine (13 MB per spec §14's measured ceiling) and one real session with
// subagents. The point is realism a synthetic fixture cannot buy: a hand-authored row is exactly
// as well-formed as its author remembered to make it, and the corpus is not.
//
// Root resolution the PRODUCTION way (D32c): the REAL config dir — `CLAUDE_CONFIG_DIR` explicitly
// UNSET, `HOME` the real one — never a fixture. This suite is genuinely READ-ONLY against the
// owner's own `~/.claude`, so its zero-write proof is SCOPED (not a whole-tree digest, which would
// be hundreds of MB and re-hashed on every run): exactly the files this suite opens are hashed
// before and after, byte-identical.
//
// EDGE code, outside the D16 wall (see dom-kinds.e2e.test.ts's header for the same note). Runs
// under a PLAIN `bun test` (no env var) per this task's brief — it spawns no campaign and spends no
// token, only reads real files already on disk.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { resolveChromiumExecutable } from './browser.ts';

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

/** Digest of one file OR one whole directory tree, read-only. Symlinks report their OWN target
 * string, never dereferenced (matching dom-kinds.e2e.test.ts's `hashTree`). Used here to scope the
 * zero-write proof to EXACTLY the real files this suite opens, never the whole (hundreds-of-MB)
 * `~/.claude` tree (D32c). */
function hashPath(path: string): string {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return `L -> ${readlinkSync(path)}`;
  if (st.isFile()) return createHash('sha256').update(readFileSync(path)).digest('hex');
  const entries: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      const s = lstatSync(abs);
      if (s.isSymbolicLink()) entries.push(`L ${relPath} -> ${readlinkSync(abs)}`);
      else if (s.isDirectory()) walk(abs, relPath);
      else entries.push(`F ${relPath} ${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
    }
  };
  walk(path, '');
  return createHash('sha256').update(entries.sort().join('\n')).digest('hex');
}

interface RealSession {
  projectDir: string;
  sessionId: string;
  jsonlPath: string;
  sizeBytes: number;
  sidecarDir: string; // <projectDir>/<sessionId>/ — subagents/, tool-results/
  subagentCount: number;
}

/** Scans the REAL `~/.claude/projects` tree (never a fixture) for every session, read-only —
 * `readdirSync`/`statSync` only, exactly what a real user's viewer scan does (spec §5.1), just run
 * here directly rather than through the server, since this function's only job is to pick the two
 * real targets the DOM assertions below open. */
function scanRealSessions(projectsRoot: string): RealSession[] {
  const out: RealSession[] = [];
  if (!existsSync(projectsRoot)) return out;
  for (const projectDir of readdirSync(projectsRoot)) {
    const projectAbs = join(projectsRoot, projectDir);
    if (!statSync(projectAbs).isDirectory()) continue;
    for (const entry of readdirSync(projectAbs)) {
      const match = /^(.+)\.jsonl$/.exec(entry);
      if (!match) continue;
      const sessionId = match[1]!;
      const jsonlPath = join(projectAbs, entry);
      const sizeBytes = statSync(jsonlPath).size;
      const sidecarDir = join(projectAbs, sessionId);
      const subagentsDir = join(sidecarDir, 'subagents');
      const subagentCount = existsSync(subagentsDir)
        ? readdirSync(subagentsDir).filter((n) => /^agent-.+\.jsonl$/.test(n)).length
        : 0;
      out.push({ projectDir, sessionId, jsonlPath, sizeBytes, sidecarDir, subagentCount });
    }
  }
  return out;
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
});

afterAll(async () => {
  await browser.close();
});

describe('real-transcript.e2e (read-only against the real ~/.claude corpus)', () => {
  const realHome = process.env.HOME;
  if (realHome === undefined || realHome === '') {
    throw new Error('real-transcript.e2e.test.ts requires a real HOME to find the real ~/.claude corpus');
  }
  const projectsRoot = join(realHome, '.claude', 'projects');
  const sessions = scanRealSessions(projectsRoot);
  if (sessions.length === 0) {
    throw new Error(
      `real-transcript.e2e.test.ts found no real sessions under ${projectsRoot} — this suite proves ` +
        'realism against the machine\'s own corpus and has nothing to run against here.',
    );
  }

  const largest = sessions.slice().sort((a, b) => b.sizeBytes - a.sizeBytes)[0]!;
  const withSubagents = sessions.slice().sort((a, b) => b.subagentCount - a.subagentCount)[0]!;

  let viewer: ViewerHandle;
  let hashes: { path: string; before: string }[];

  beforeAll(async () => {
    const scoped = new Set<string>([largest.jsonlPath, withSubagents.jsonlPath]);
    if (existsSync(withSubagents.sidecarDir)) scoped.add(withSubagents.sidecarDir);
    if (existsSync(largest.sidecarDir)) scoped.add(largest.sidecarDir);
    hashes = [...scoped].map((path) => ({ path, before: hashPath(path) }));

    // D32c: the REAL config dir — CLAUDE_CONFIG_DIR explicitly unset, real HOME.
    viewer = await spawnViewer({ CLAUDE_CONFIG_DIR: undefined, HOME: realHome });
  }, 30_000);

  afterAll(async () => {
    await viewer.stop();
    for (const { path, before } of hashes) {
      expect(hashPath(path)).toBe(before); // zero-write, scoped to exactly what this suite opened
    }
  });

  test(`the largest real transcript (${largest.sizeBytes} bytes) opens and renders rows`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${viewer.port}/s/${largest.sessionId}`);
      const count = await waitFor(
        () => page.$$eval('[data-scroll="rows"] .row', (els) => (els.length > 0 ? els.length : null)),
        30_000,
        `the largest real transcript (${largest.jsonlPath}) never rendered any rows`,
      );
      expect(count).toBeGreaterThan(0);

      // Every rendered node still carries the §16.0 contract attributes over REAL data, not just
      // the synthetic fixture: data-kind and a data-row-id shaped like "<digits>:<digits>".
      const anchors = await page.$$eval('[data-scroll="rows"] .row', (els) =>
        els.map((e) => ({ kind: e.getAttribute('data-kind'), rowId: e.getAttribute('data-row-id') })),
      );
      for (const a of anchors) {
        expect(a.kind).not.toBeNull();
        expect(a.rowId).toMatch(/^\d+:\d+$/);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  test(`a real session with subagents (${withSubagents.subagentCount} sidecars) renders its tabs and each agent's nodes`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${viewer.port}/s/${withSubagents.sessionId}`);
      await waitFor(
        () => page.$$eval('[data-scroll="rows"] .row', (els) => (els.length > 0 ? els.length : null)),
        30_000,
        'the real subagent session never rendered any parent rows',
      );
      const tabCount = await page.$$eval('[data-agent-tab]:not([data-agent-tab=""])', (els) => els.length);
      expect(tabCount).toBeGreaterThan(0);

      const tab = page.locator('[data-agent-tab]:not([data-agent-tab=""])').first();
      const agentId = await tab.getAttribute('data-agent-tab');
      await tab.click();
      await waitFor(() => (page.url().endsWith(`/a/${agentId}`) ? true : null), 15_000, 'URL never updated to the agent tab');
      await waitFor(
        () => page.$$eval('[data-scroll="rows"] .row', (els) => (els.length > 0 ? els.length : null)),
        15_000,
        `agent ${agentId}'s own rows never rendered`,
      );
    } finally {
      await page.close();
    }
  }, 60_000);
});
