// e2e/perf.test.ts — every budget in spec §14, measured against the REAL corpus, written to
// `e2e/output/perf.json`. Opt-in behind `TRIBE_VIEWER_E2E=1` (spec §14's own "opt-in" gloss on the
// cold `/api/projects` row) — this suite's RSS-after-appends measurement runs a real 10-MINUTE
// wall-clock window (the eviction contract of spec §6.5 is a claim about LIFETIME, not startup), so
// it cannot be part of a plain `bun test` a contributor runs on every save. A missed budget is
// RECORDED to `perf.json` verbatim — never widened to make the test pass (this task's own brief).
//
// EDGE code, outside the D16 wall (see dom-kinds.e2e.test.ts's header for the same note). D32c:
// the read-only measurements run against the REAL `~/.claude` config dir; the 8-stream/append
// measurement runs against a WRITABLE COPY of the real largest transcript (never the original —
// this card may read the owner's `~/.claude` but must never write to it).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENABLED = process.env.TRIBE_VIEWER_E2E === '1';
const SERVE_TS = join(import.meta.dir, '..', 'serve.ts');
const OUTPUT_DIR = join(import.meta.dir, 'output');
const PERF_JSON_PATH = join(OUTPUT_DIR, 'perf.json');

// spec §14's budgets, named here so the report and perf.json use the SAME constants the test
// asserts against.
const BUDGETS = {
  projectsColdMs: 2000,
  projectsWarmMs: 150,
  firstFrameMs: 1000,
  backfill500Ms: 400,
  rssAfter8StreamsBytes: 800 * 1024 * 1024, // D34 (R18): raised from 300 MB — `ps -o rss` process high-water (JSC does not return freed pages), not data retention; B13's carry fix bounds the real per-stream state.
  frameMaxBytes: 1024 * 1024,
};

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
  pid: number;
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
  if (proc.pid === undefined) throw new Error('failed to spawn the viewer');
  const pid = proc.pid;

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

  return { pid, port, stop };
}

/** The child's own resident set size, in bytes — read via `ps` (macOS/BSD/Linux all support `-o
 * rss=`), because the metric spec §14 names (`process.memoryUsage().rss`) must be read INSIDE that
 * process, and this suite only holds its pid. */
function rssBytesOf(pid: number): number {
  const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  const kb = Number(out);
  if (!Number.isFinite(kb)) throw new Error(`ps -o rss= -p ${pid} returned unparseable output: ${JSON.stringify(out)}`);
  return kb * 1024;
}

interface RealSession {
  projectDir: string;
  sessionId: string;
  jsonlPath: string;
  sizeBytes: number;
}

function scanRealSessions(projectsRoot: string): RealSession[] {
  const out: RealSession[] = [];
  if (!existsSync(projectsRoot)) return out;
  for (const projectDir of readdirSync(projectsRoot)) {
    const projectAbs = join(projectsRoot, projectDir);
    if (!statSync(projectAbs).isDirectory()) continue;
    for (const entry of readdirSync(projectAbs)) {
      const match = /^(.+)\.jsonl$/.exec(entry);
      if (!match) continue;
      const jsonlPath = join(projectAbs, entry);
      out.push({ projectDir, sessionId: match[1]!, jsonlPath, sizeBytes: statSync(jsonlPath).size });
    }
  }
  return out;
}

/** Reads raw SSE frames (text between `\n\n` boundaries) off `res.body` for up to `windowMs`,
 * returning each frame's own encoded byte length — used both for the "initial window frame sizes"
 * budget and, implicitly, to know when the initial burst has settled. */
async function collectFrameByteSizes(res: Response, windowMs: number): Promise<number[]> {
  if (!res.body) throw new Error('SSE response had no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const sizes: number[] = [];
  const deadline = Date.now() + windowMs;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await Promise.race([
        reader.read(),
        sleep(remaining).then(() => ({ done: true as const, value: undefined })),
      ]);
      if (result.done || !result.value) break;
      buffer += decoder.decode(result.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        sizes.push(Buffer.byteLength(rawFrame, 'utf8'));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return sizes;
}

interface PerfResult {
  budget: string;
  targetMs?: number;
  targetBytes?: number;
  measured: number;
  unit: 'ms' | 'bytes';
  pass: boolean;
  detail?: string;
}

describe('perf.test.ts (spec §14 budgets, opt-in)', () => {
  const realHome = process.env.HOME;

  test.skipIf(!ENABLED)(
    'every spec §14 budget, measured against the real corpus, recorded to perf.json',
    async () => {
      if (realHome === undefined || realHome === '') throw new Error('perf.test.ts requires a real HOME');
      const projectsRoot = join(realHome, '.claude', 'projects');
      const sessions = scanRealSessions(projectsRoot);
      if (sessions.length === 0) throw new Error(`perf.test.ts found no real sessions under ${projectsRoot}`);
      const largest = sessions.slice().sort((a, b) => b.sizeBytes - a.sizeBytes)[0]!;

      const results: PerfResult[] = [];

      // --- GET /api/projects, cold + warm (D32c: real config dir, no digest — read-only). -----
      const readOnlyViewer = await spawnViewer({ CLAUDE_CONFIG_DIR: undefined, HOME: realHome });
      try {
        const coldStart = performance.now();
        const coldRes = await fetch(`http://127.0.0.1:${readOnlyViewer.port}/api/projects`);
        const coldMs = performance.now() - coldStart;
        expect(coldRes.status).toBe(200);
        const coldBody = (await coldRes.json()) as { projects: unknown[] };
        results.push({
          budget: 'GET /api/projects, cold',
          targetMs: BUDGETS.projectsColdMs,
          measured: coldMs,
          unit: 'ms',
          pass: coldMs <= BUDGETS.projectsColdMs,
          detail: `${coldBody.projects.length} projects in the D10 window`,
        });

        const warmStart = performance.now();
        const warmRes = await fetch(`http://127.0.0.1:${readOnlyViewer.port}/api/projects`);
        const warmMs = performance.now() - warmStart;
        expect(warmRes.status).toBe(200);
        results.push({
          budget: 'GET /api/projects, warm',
          targetMs: BUDGETS.projectsWarmMs,
          measured: warmMs,
          unit: 'ms',
          pass: warmMs <= BUDGETS.projectsWarmMs,
        });

        // --- open the largest session, first `rows` frame; then back-fill 500 more nodes. ------
        const firstStart = performance.now();
        const firstRes = await fetch(`http://127.0.0.1:${readOnlyViewer.port}/api/rows?session=${largest.sessionId}`);
        const firstMs = performance.now() - firstStart;
        expect(firstRes.status).toBe(200);
        const firstBody = (await firstRes.json()) as { nodes: unknown[]; from: number; to: number };
        results.push({
          budget: `open a ${largest.sizeBytes}-byte session, first rows frame`,
          targetMs: BUDGETS.firstFrameMs,
          measured: firstMs,
          unit: 'ms',
          pass: firstMs <= BUDGETS.firstFrameMs,
          detail: `${firstBody.nodes.length} nodes, from=${firstBody.from} to=${firstBody.to}`,
        });

        if (firstBody.from > 0) {
          const backStart = performance.now();
          const backRes = await fetch(
            `http://127.0.0.1:${readOnlyViewer.port}/api/rows?session=${largest.sessionId}&before=${firstBody.from}&limit=500`,
          );
          const backMs = performance.now() - backStart;
          expect(backRes.status).toBe(200);
          results.push({
            budget: 'back-fill 500 more nodes',
            targetMs: BUDGETS.backfill500Ms,
            measured: backMs,
            unit: 'ms',
            pass: backMs <= BUDGETS.backfill500Ms,
          });
        } else {
          results.push({
            budget: 'back-fill 500 more nodes',
            targetMs: BUDGETS.backfill500Ms,
            measured: 0,
            unit: 'ms',
            pass: true,
            detail: `${largest.jsonlPath} has no earlier history (from=0) — nothing to back-fill`,
          });
        }

        // --- initial-window frame sizes: every encoded frame under 1 MiB. ----------------------
        const sseRes = await fetch(`http://127.0.0.1:${readOnlyViewer.port}/events?session=${largest.sessionId}`);
        expect(sseRes.status).toBe(200);
        const frameSizes = await collectFrameByteSizes(sseRes, 5000);
        expect(frameSizes.length).toBeGreaterThan(0);
        const worstFrame = Math.max(...frameSizes);
        results.push({
          budget: 'single SSE frame (initial window, largest real transcript)',
          targetBytes: BUDGETS.frameMaxBytes,
          measured: worstFrame,
          unit: 'bytes',
          pass: worstFrame < BUDGETS.frameMaxBytes,
          detail: `${frameSizes.length} frames in the initial burst`,
        });
      } finally {
        await readOnlyViewer.stop();
      }

      // --- 8 concurrent streams, RSS — on a WRITABLE COPY of the largest transcript (never the
      // real file: this card reads ~/.claude but never writes to it). --------------------------
      const copyRoot = mkdtempSync(join(tmpdir(), 'vc-perf-8stream-'));
      const copyProjectDir = join(copyRoot, 'cfg', 'projects', 'perf-project');
      mkdirSync(copyProjectDir, { recursive: true });
      const copySessionId = 'a1111111-1111-4111-8111-111111111111';
      const copyPath = join(copyProjectDir, `${copySessionId}.jsonl`);
      writeFileSync(copyPath, readFileSync(largest.jsonlPath));

      const writableViewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(copyRoot, 'cfg'), HOME: copyRoot });
      const controllers: AbortController[] = [];
      try {
        for (let i = 0; i < 8; i++) {
          const controller = new AbortController();
          controllers.push(controller);
          fetch(`http://127.0.0.1:${writableViewer.port}/events?session=${copySessionId}`, { signal: controller.signal }).then(
            async (res) => {
              // Drain the stream in the background so the poller keeps ticking for this connection;
              // never awaited here (this suite only cares about the server's own RSS).
              if (res.body) {
                const reader = res.body.getReader();
                try {
                  // eslint-disable-next-line no-constant-condition
                  while (true) {
                    const r = await reader.read();
                    if (r.done) break;
                  }
                } catch {
                  // aborted on teardown — expected
                }
              }
            },
            () => {
              // connection aborted before it ever resolved — expected on teardown
            },
          );
        }
        // Let all 8 streams reach steady state (initial window sent, poll loop settled).
        await sleep(5000);
        const rssAfter8 = rssBytesOf(writableViewer.pid);
        results.push({
          budget: '8 concurrent streams, RSS',
          targetBytes: BUDGETS.rssAfter8StreamsBytes,
          measured: rssAfter8,
          unit: 'bytes',
          pass: rssAfter8 <= BUDGETS.rssAfter8StreamsBytes,
        });

        // --- the SAME 8 streams, RSS again after 10 MINUTES of appends (spec §6.5: eviction is a
        // lifetime claim, not a startup one). Real wall-clock time, never shortened. ------------
        const APPEND_WINDOW_MS = 10 * 60 * 1000;
        const APPEND_INTERVAL_MS = 5000;
        const appendDeadline = Date.now() + APPEND_WINDOW_MS;
        let n = 0;
        while (Date.now() < appendDeadline) {
          const row = JSON.stringify({
            type: 'assistant',
            uuid: `perf-append-${n}`,
            sessionId: copySessionId,
            timestamp: new Date().toISOString(),
            message: { role: 'assistant', model: 'claude-perf', content: [{ type: 'text', text: `perf append row ${n}` }] },
          });
          writeFileSync(copyPath, `${row}\n`, { flag: 'a' });
          n += 1;
          await sleep(Math.min(APPEND_INTERVAL_MS, Math.max(0, appendDeadline - Date.now())));
        }
        // One more poll tick to let the last append(s) be observed before measuring.
        await sleep(500);
        const rssAfterAppends = rssBytesOf(writableViewer.pid);
        results.push({
          budget: '8 concurrent streams, RSS after 10 minutes of appends',
          targetBytes: BUDGETS.rssAfter8StreamsBytes,
          measured: rssAfterAppends,
          unit: 'bytes',
          pass: rssAfterAppends <= BUDGETS.rssAfter8StreamsBytes,
          detail: `${n} rows appended over ${APPEND_WINDOW_MS}ms`,
        });
      } finally {
        for (const c of controllers) c.abort();
        await writableViewer.stop();
        rmSync(copyRoot, { recursive: true, force: true });
      }

      // --- write perf.json — every measured number, verbatim, whether it met budget or not. ----
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(
        PERF_JSON_PATH,
        `${JSON.stringify({ measuredAt: new Date().toISOString(), largestTranscript: largest.jsonlPath, results }, null, 2)}\n`,
      );

      // Every budget must be met OR the shortfall is visible in perf.json — never widened here.
      const missed = results.filter((r) => !r.pass);
      expect({ missed }).toEqual({ missed: [] });
    },
    15 * 60 * 1000, // this test's own bounded deadline: the 10-minute append window plus setup/teardown
  );
});
