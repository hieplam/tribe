// e2e/live-tail.e2e.test.ts — G2, spec §16.3 (E2). The ONE proof that the live tail actually
// follows within budget, measured from a clock the TEST owns — never a transcript row's
// `timestamp` field (the model's clock, which can precede the write by seconds) and never a file
// mtime. Opt-in behind `TRIBE_VIEWER_E2E=1` (`test.skipIf(!ENABLED)`, the pattern `perf.test.ts`
// uses) so a plain `bun test` never spawns a session or spends a token.
//
// EDGE code, outside the D16 wall (see `dom-kinds.e2e.test.ts`'s header for the same note): this
// file spawns real `serve.ts` child processes, drives real headless Chromium via `playwright-core`,
// and does its own raw `node:fs` writes to synthesize a live-growing transcript
// (`fixtures-mirror-reality.md`: a real user's writer is exactly what this test IS). None of that
// is reachable from `core/**`/`adapters/**`/`serve.ts`/`client/src/**`.
//
// The client behaviour under test (follow-the-tail, reconnect, `ConnectionNote`, the `__viewer*`
// hooks) was already built by the R13-R15 fix round. This file authors ONLY the proof against that
// already-shipped system — nothing here changes client code.
//
// --- Two corrections to the task brief, made here rather than silently, per this file's own
// obligation to "author the test correctly against the existing system" -----------------------
//
// (1) NAMING: the brief's own "gotcha" note says spec §16.3's `[data-testid="follow-pill"]` was
// renamed to `new-below-pill` in the built client. That is only HALF right. Two DISTINCT pills
// exist in the tree today:
//   - `client/src/components/FollowTail.tsx` renders `data-testid="follow-pill"` and IS mounted by
//     `RowList` exactly where spec §8.3 describes it: "A user scroll that leaves the 32 px band
//     sets `following = false` and shows the `<FollowTail>` pill" — spec's OWN words name the
//     component that carries this exact testid. This file uses `follow-pill` for every §8.3 scroll
//     assertion, because that is the real, wired element §8.3 is about.
//   - `client/src/components/NewBelowPill.tsx` renders `data-testid="new-below-pill"` and is a
//     SEPARATE affordance `SessionView` mounts for §6.3's cap-eviction case ("N new below" while
//     capped with follow off). This file uses `new-below-pill` ONLY for that scenario (the
//     >2,000-node window test below), which is what it actually proves.
// Neither element is invented; both exist, wired, in the tree today (verified by reading
// `RowList.tsx` and `SessionView.tsx` before writing a single assertion here).
//
// (2) ZERO-WRITE SCOPE: the brief says the fixture digest "covers the whole copy EXCEPT
// `<session-live>.jsonl`". This suite's FULL scenario list (also named in the same brief) needs a
// mid-stream subagent, an append to an EXISTING subagent's own sidecar, and a same-size rotation of
// the >2,000-node session (`session-4`) — none of which are `<session-live>.jsonl`. The digest below
// excludes the exact, closed, enumerated set of paths this suite intentionally writes (all in the
// MAIN copy only) rather than a single hard-coded name — the SAME zero-write claim (G4: no
// INCIDENTAL write anywhere else in the copy), just scoped to what this fuller scenario list
// actually touches. The two >2,000-node/rotation scenarios run against their OWN dedicated,
// UNDIGESTED writable copies (mirroring `perf.test.ts`'s own writable-copy precedent, which takes no
// digest at all for the section of that suite that intentionally appends).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildHomeA, PROJECT_A_DIR, SESSION_4_ID, SESSION_LIVE_ID } from '../fixtures/build.ts';
import { resolveChromiumExecutable } from './browser.ts';

const ENABLED = process.env.TRIBE_VIEWER_E2E === '1';
const SERVE_TS = join(import.meta.dir, '..', 'serve.ts');
const OUTPUT_DIR = join(import.meta.dir, 'output');
const LATENCY_JSON_PATH = join(OUTPUT_DIR, 'latency.json');
const LATENCY_BUDGET_MS = 1000;
const WINDOW_CAP = 2000; // client/src/rowStore.ts's own constant, mirrored here for the assertion

const EXISTING_SUBAGENT_ID = 'e2eexist01';
const NEW_SUBAGENT_ID = 'e2enewsub01';

// -------------------------------------------------------------------------------------------
// Small shared helpers (the same bounded-deadline / spawn / hash shapes `dom-kinds.e2e.test.ts`
// and `perf.test.ts` already use).
// -------------------------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function irregularDelayMs(): number {
  // 40 samples must land at IRREGULAR intervals (spec §16.3) so the 250ms poll tick is sometimes
  // hit, sometimes missed — never a fixed cadence that would only ever exercise one phase of it.
  return 50 + Math.floor(Math.random() * 850);
}

async function waitFor<T>(fn: () => Promise<T | null> | T | null, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== null && v !== undefined && v !== false) return v as T;
    last = v;
    await sleep(100);
  }
  throw new Error(`${label}: timed out after ${timeoutMs}ms (last observed: ${JSON.stringify(last)})`);
}

/** F51 — measured PER ROW, never per frame: polls for THIS row's own `[data-row-id]`, never "any
 * new row" or a count delta. A batched frame carrying several rows still measures each one's own
 * true arrival instant, because the wait target is that row's specific id. */
async function waitForRowArrivalMs(page: Page, id: string, deadlineMs: number): Promise<number> {
  const sel = `[data-row-id="${id}"]`;
  const deadline = performance.now() + deadlineMs;
  for (;;) {
    if ((await page.$(sel)) !== null) return performance.now();
    if (performance.now() >= deadline) {
      throw new Error(`row ${id} never appeared in the DOM within ${deadlineMs}ms (per-row wait — F51)`);
    }
    await sleep(10);
  }
}

function findFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('ok') });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error('Bun.serve({ port: 0 }) did not report a bound port');
  return port;
}

interface ViewerHandle {
  proc: ChildProcess;
  port: number;
  stop(): Promise<void>;
}

async function spawnViewer(env: Record<string, string | undefined>): Promise<ViewerHandle> {
  const port = findFreePort();
  const fullEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined) fullEnv[k] = v;
  }
  const proc = spawn('bun', [SERVE_TS, '--port', String(port)], { env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
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

  return { proc, port, stop };
}

async function captureScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    await page.screenshot({ path: join(OUTPUT_DIR, name), fullPage: true });
  } catch (e) {
    console.error(`live-tail: screenshot ${name} could not be captured: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A digest of an entire tree, EXCLUDING an explicit, closed set of relative paths — the same
 * "whole tree, byte-identical" proof `dom-kinds.e2e.test.ts` uses for G4, adapted so this suite's
 * OWN intentional writes (enumerated below, not guessed at) do not fail the proof that nothing
 * ELSE in the copy was touched. */
function hashTreeExcluding(root: string, excludedRelPaths: ReadonlySet<string>): string {
  const entries: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      if (excludedRelPaths.has(relPath)) continue;
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

async function rowCount(page: Page): Promise<number> {
  return page.$$eval('[data-row-id]', (els) => els.length);
}

async function rowIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-row-id]', (els) => els.map((e) => e.getAttribute('data-row-id') ?? ''));
}

/** Reads `window.__viewerGeneration` (spec §8.4) via `globalThis`, never a literal `window` TYPE
 * name (this file's tsconfig carries no DOM lib — see `scrollTopOf`'s own note). */
async function viewerGeneration(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (globalThis as unknown as { __viewerGeneration?: string }).__viewerGeneration);
}

/** `window.__viewerEventSource.close()` — a deterministic drop, not a race with a network-level
 * kill (spec §8.4 step 1). */
async function closeViewerEventSource(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as unknown as { __viewerEventSource: { close: () => void } }).__viewerEventSource.close());
}

/** `window.__viewerReconnect()` — opens a new stream by the same path the production `error`
 * handler uses (spec §8.4 step 2). */
async function reconnectViewer(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as unknown as { __viewerReconnect: () => void }).__viewerReconnect());
}

async function scrollTopOf(page: Page): Promise<number> {
  // No `as HTMLElement` cast: this package's root tsconfig has no DOM lib (client/src is the
  // only place that does), so a literal `HTMLElement`/`window` type name does not resolve here —
  // the callback parameter's structural (untyped) shape is enough for `.scrollTop`.
  return page.$eval('[data-scroll="rows"]', (el) => el.scrollTop);
}

/** The SAME `atBottom` predicate `client/src/components/RowList.tsx#isAtBottom` uses (spec §8.3):
 * `scrollHeight - scrollTop - clientHeight <= 32`, read from the real DOM element — never
 * inferred from React state. */
async function isAtBottomOf(page: Page): Promise<boolean> {
  return page.$eval('[data-scroll="rows"]', (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 32);
}

// -------------------------------------------------------------------------------------------
// The controlled writer (spec §16.3 step 2): a SYNCHRONOUS append whose own `performance.now()`,
// read the instant `writeSync` RETURNS, is the latency clock — never a row's `timestamp` field,
// never a file mtime. `RowAnchor.id` is `${byteOffsetWrittenAt}:0` (core/model.ts), computable
// BEFORE the write because this writer is the tree's only writer for the path it owns.
// -------------------------------------------------------------------------------------------

class ControlledWriter {
  private cursor: number;
  private readonly fd: number;

  constructor(private readonly path: string) {
    this.cursor = statSync(path).size;
    this.fd = openSync(path, 'a');
  }

  writeRow(obj: unknown): { id: string; writeCompletedMs: number } {
    const buf = Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8');
    const offset = this.cursor;
    writeSync(this.fd, buf);
    const writeCompletedMs = performance.now(); // the instant writeSync RETURNS — the test's own clock
    this.cursor += buf.length;
    return { id: `${offset}:0`, writeCompletedMs };
  }

  close(): void {
    closeSync(this.fd);
  }
}

let uuidCounter = 0;
function nextUuid(prefix: string): string {
  uuidCounter += 1;
  return `${prefix}-${uuidCounter}`;
}

function assistantTextRow(sessionId: string, text: string): unknown {
  return {
    type: 'assistant',
    uuid: nextUuid('e2e-row'),
    sessionId,
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', model: 'claude-e2e', content: [{ type: 'text', text }] },
  };
}

function toolUseRow(sessionId: string, toolUseId: string, command: string): unknown {
  return {
    type: 'assistant',
    uuid: nextUuid('e2e-row'),
    sessionId,
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', model: 'claude-e2e', content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command } }] },
  };
}

function toolResultRow(sessionId: string, toolUseId: string, content: string): unknown {
  return {
    type: 'user',
    uuid: nextUuid('e2e-row'),
    sessionId,
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: false }] },
  };
}

function subagentSeedContent(agentId: string, sessionId: string): string {
  const u1 = nextUuid(`e2e-agent-${agentId}`);
  const u2 = nextUuid(`e2e-agent-${agentId}`);
  const rows = [
    { type: 'user', uuid: u1, sessionId, isSidechain: true, agentId, timestamp: new Date().toISOString(), message: { role: 'user', content: `E2E subagent ${agentId} task.` } },
    { type: 'assistant', uuid: u2, parentUuid: u1, sessionId, isSidechain: true, agentId, timestamp: new Date().toISOString(), message: { role: 'assistant', model: 'claude-e2e', content: [{ type: 'text', text: `E2E subagent ${agentId} response.` }] } },
  ];
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function subagentMetaContent(): string {
  return JSON.stringify({ agentType: 'general-purpose', description: 'E2E subagent', spawnDepth: 1, toolUseId: null, parentAgentId: null, model: 'claude-e2e' }) + '\n';
}

// -------------------------------------------------------------------------------------------

let browser: Browser | null = null;

beforeAll(async () => {
  // Guarded on ENABLED (unlike dom-kinds.e2e.test.ts's unconditional launch): this suite is
  // opt-in (spec §16.3), so a plain `bun test` must not even require Chromium to be installed.
  if (!ENABLED) return;
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
});

afterAll(async () => {
  if (browser) await browser.close();
});

describe('live-tail.e2e — G2, spec §16.3', () => {
  test.skipIf(!ENABLED)(
    'the writer\'s own clock, subagents, scroll, patch, reconnect (D12), the >2,000-node window, and rotation',
    async () => {
      if (browser === null) throw new Error('browser was not launched (ENABLED guard bug)');
      const b = browser;
      const samples: Array<{ case: string; id: string; sampleMs: number }> = [];

      // =========================================================================================
      // MAIN COPY — session-live.jsonl + its own subagents. This is the ONE copy the zero-write
      // digest below covers (spec §16.2/G4's proof, scoped to this suite's own enumerated writes).
      // =========================================================================================
      const mainRoot = mkdtempSync(join(tmpdir(), 'vc-live-tail-'));
      buildHomeA(mainRoot);

      const projADir = join(mainRoot, 'cfg', 'projects', PROJECT_A_DIR);
      const sessionLivePath = join(projADir, `${SESSION_LIVE_ID}.jsonl`);
      const subagentsDir = join(projADir, SESSION_LIVE_ID, 'subagents');
      const existingAgentJsonl = join(subagentsDir, `agent-${EXISTING_SUBAGENT_ID}.jsonl`);
      const existingAgentMeta = join(subagentsDir, `agent-${EXISTING_SUBAGENT_ID}.meta.json`);
      const newAgentJsonl = join(subagentsDir, `agent-${NEW_SUBAGENT_ID}.jsonl`);
      const newAgentMeta = join(subagentsDir, `agent-${NEW_SUBAGENT_ID}.meta.json`);

      // Pre-seed the "existing, already-open" subagent BEFORE the zero-write baseline is taken —
      // this is fixture setup, not a write this suite's writer performs during the run.
      mkdirSync(subagentsDir, { recursive: true });
      writeFileSync(existingAgentJsonl, subagentSeedContent(EXISTING_SUBAGENT_ID, SESSION_LIVE_ID));
      writeFileSync(existingAgentMeta, subagentMetaContent());

      const relOf = (abs: string) => abs.slice(mainRoot.length + 1);
      const excludedPaths = new Set<string>([
        relOf(sessionLivePath),
        relOf(existingAgentJsonl), // appended once (subagent-append case)
        relOf(newAgentJsonl), // created mid-stream (subagent-appearing case)
        relOf(newAgentMeta),
      ]);
      const hashBefore = hashTreeExcluding(mainRoot, excludedPaths);

      const viewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(mainRoot, 'cfg'), HOME: mainRoot });
      const page = await b.newPage();
      await page.setViewportSize({ width: 900, height: 500 });

      try {
        await page.goto(`http://127.0.0.1:${viewer.port}/s/${SESSION_LIVE_ID}`);
        await waitFor(
          () => page.$$eval('[data-scroll="rows"] .row', (els) => (els.length >= 2 ? els.length : null)),
          15_000,
          'session-live initial rows never rendered',
        );
        await waitFor(() => page.$(`[data-agent-tab="${EXISTING_SUBAGENT_ID}"]`), 15_000, 'the pre-seeded subagent tab never appeared');

        // =======================================================================================
        // PHASE 1 — 40 samples, irregular intervals, worst ≤ 1000 ms (spec §16.3 steps 2-4).
        // =======================================================================================
        const writer = new ControlledWriter(sessionLivePath);
        for (let i = 0; i < 40; i++) {
          await sleep(irregularDelayMs());
          const { id, writeCompletedMs } = writer.writeRow(assistantTextRow(SESSION_LIVE_ID, `latency sample ${i}`));
          const arrivalMs = await waitForRowArrivalMs(page, id, 5000);
          samples.push({ case: 'tail', id, sampleMs: arrivalMs - writeCompletedMs });
        }

        // =======================================================================================
        // PHASE 2 — the subagent case G2 names explicitly: append to an EXISTING, already-open
        // agent-*.jsonl tab, measured the same way.
        // =======================================================================================
        await page.click(`[data-agent-tab="${EXISTING_SUBAGENT_ID}"]`);
        await waitFor(() => (page.url().endsWith(`/a/${EXISTING_SUBAGENT_ID}`) ? true : null), 10_000, 'URL never switched to the subagent tab');
        await waitFor(
          () => page.$$eval('[data-scroll="rows"] .row', (els) => (els.length >= 2 ? els.length : null)),
          15_000,
          "the pre-seeded subagent's own rows never rendered",
        );
        const subWriter = new ControlledWriter(existingAgentJsonl);
        {
          const { id, writeCompletedMs } = subWriter.writeRow({
            type: 'assistant',
            uuid: nextUuid(`e2e-agent-${EXISTING_SUBAGENT_ID}`),
            sessionId: SESSION_LIVE_ID,
            isSidechain: true,
            agentId: EXISTING_SUBAGENT_ID,
            timestamp: new Date().toISOString(),
            message: { role: 'assistant', model: 'claude-e2e', content: [{ type: 'text', text: 'subagent append sample' }] },
          });
          const arrivalMs = await waitForRowArrivalMs(page, id, 5000);
          samples.push({ case: 'subagent-append', id, sampleMs: arrivalMs - writeCompletedMs });
        }

        // Back to the parent tab for everything below.
        await page.click('[data-agent-tab=""]');
        await waitFor(() => (page.url().endsWith(`/s/${SESSION_LIVE_ID}`) ? true : null), 10_000, 'URL never switched back to the parent tab');
        await waitFor(
          () => page.$$eval('[data-scroll="rows"] .row', (els) => (els.length >= 2 ? els.length : null)),
          15_000,
          "the parent's own rows never re-rendered",
        );

        // =======================================================================================
        // PHASE 3 — a subagent APPEARING mid-stream: a brand-new agent-*.jsonl + .meta.json while
        // the PARENT stream is open. A new tab element with no reload — proved by an in-page JS
        // marker that only a real reload would clear.
        // =======================================================================================
        await page.evaluate(() => {
          // `globalThis`, never `window`: this file's tsconfig carries no DOM lib, so `window` does
          // not resolve as a TYPE name here — `globalThis` is the same object in a real browser and
          // needs no DOM lib to type-check.
          (globalThis as unknown as { __e2eNoReloadMarker?: string }).__e2eNoReloadMarker = 'still-alive';
        });
        writeFileSync(newAgentJsonl, subagentSeedContent(NEW_SUBAGENT_ID, SESSION_LIVE_ID));
        writeFileSync(newAgentMeta, subagentMetaContent());
        await waitFor(() => page.$(`[data-agent-tab="${NEW_SUBAGENT_ID}"]`), 5000, 'the mid-stream subagent tab never appeared');
        const markerSurvived = await page.evaluate(() => (globalThis as unknown as { __e2eNoReloadMarker?: string }).__e2eNoReloadMarker);
        expect(markerSurvived).toBe('still-alive'); // a real reload would have cleared this in-memory global

        // =======================================================================================
        // PHASE 4 — scroll assertions of spec §8.3, on real `scrollTop` (never inferred state).
        // =======================================================================================
        // (a) while following: append, second reading > first, atBottom holds.
        const beforeFollow = await scrollTopOf(page);
        {
          const { id, writeCompletedMs } = writer.writeRow(assistantTextRow(SESSION_LIVE_ID, 'scroll-follow marker'));
          const arrivalMs = await waitForRowArrivalMs(page, id, 5000);
          samples.push({ case: 'scroll-follow', id, sampleMs: arrivalMs - writeCompletedMs });
        }
        const afterFollow = await scrollTopOf(page);
        expect(afterFollow).toBeGreaterThan(beforeFollow);
        expect(await isAtBottomOf(page)).toBe(true);
        await captureScreenshot(page, 'after-live-following.png');

        // (b) scroll up 400px, out of the 32px band: the follow-pill (FollowTail, real testid
        // "follow-pill") appears, and a NEW row does NOT move the viewport.
        await page.$eval('[data-scroll="rows"]', (el) => {
          el.scrollTop = Math.max(0, el.scrollTop - 400);
        });
        await waitFor(() => page.$('[data-testid="follow-pill"]'), 5000, 'the follow-pill never appeared after scrolling up');
        const readingBeforeScrolledAppend = await scrollTopOf(page);
        {
          const { id, writeCompletedMs } = writer.writeRow(assistantTextRow(SESSION_LIVE_ID, 'scroll-away marker'));
          const arrivalMs = await waitForRowArrivalMs(page, id, 5000);
          samples.push({ case: 'scroll-away', id, sampleMs: arrivalMs - writeCompletedMs });
        }
        const readingAfterScrolledAppend = await scrollTopOf(page);
        expect(readingAfterScrolledAppend).toBe(readingBeforeScrolledAppend); // byte-identical (spec §8.3)
        expect(await page.$('[data-testid="follow-pill"]')).not.toBeNull();
        await captureScreenshot(page, 'after-live-scrolled.png');

        // (c) click the pill: scrollTop returns to the bottom band, following resumes on the next
        // append.
        await page.click('[data-testid="follow-pill"]');
        await waitFor(async () => ((await isAtBottomOf(page)) ? true : null), 5000, 'scrollTop never returned to the bottom band after clicking the follow-pill');
        const beforeResume = await scrollTopOf(page);
        {
          const { id, writeCompletedMs } = writer.writeRow(assistantTextRow(SESSION_LIVE_ID, 'resume marker'));
          const arrivalMs = await waitForRowArrivalMs(page, id, 5000);
          samples.push({ case: 'resume', id, sampleMs: arrivalMs - writeCompletedMs });
        }
        const afterResume = await scrollTopOf(page);
        expect(afterResume).toBeGreaterThanOrEqual(beforeResume); // following resumed: it advances (or was already exactly at the edge)
        expect(await isAtBottomOf(page)).toBe(true);
        await captureScreenshot(page, 'after-resume.png');

        // =======================================================================================
        // PHASE 5 — the patch case (spec §6.4): tool_use -> pending card -> (a later tick) ->
        // tool_result -> the card gains its result AND the row count is unchanged.
        // =======================================================================================
        const toolUseIdPatch = 'toolu_e2e_patch01';
        const patchUse = writer.writeRow(toolUseRow(SESSION_LIVE_ID, toolUseIdPatch, 'echo patch-case'));
        await waitFor(() => page.$(`[data-row-id="${patchUse.id}"][data-state="pending"]`), 5000, 'the patch-case tool_use never rendered pending');
        const countBeforePatch = await rowCount(page);
        await sleep(400); // ensure the result lands on a LATER poll tick, not the same one
        writer.writeRow(toolResultRow(SESSION_LIVE_ID, toolUseIdPatch, 'patch-case-result-marker'));
        await waitFor(() => page.$(`[data-row-id="${patchUse.id}"][data-state="ok"]`), 5000, 'the patch-case tool never gained its result');
        const patchedText = await page.$eval(`[data-row-id="${patchUse.id}"]`, (el) => el.textContent ?? '');
        expect(patchedText).toContain('patch-case-result-marker');
        const countAfterPatch = await rowCount(page);
        expect(countAfterPatch).toBe(countBeforePatch); // a patch replaces in place; it adds NO node

        // =======================================================================================
        // PHASE 6 — reconnect BETWEEN a row and its patch (D12). The single most important
        // assertion in this file: the reconnecting client re-reads the window and re-pairs the
        // call with its result before either reaches the wire, so the card arrives complete, ONCE.
        // =======================================================================================
        const g0 = await viewerGeneration(page);
        const toolUseIdReconnectA = 'toolu_e2e_reconnect_a';
        const reconnectAUse = writer.writeRow(toolUseRow(SESSION_LIVE_ID, toolUseIdReconnectA, 'echo reconnect-a'));
        await waitFor(() => page.$(`[data-row-id="${reconnectAUse.id}"][data-state="pending"]`), 5000, 'reconnect-A tool_use never rendered pending');

        await closeViewerEventSource(page);
        writer.writeRow(toolResultRow(SESSION_LIVE_ID, toolUseIdReconnectA, 'reconnect-a-result-marker')); // written WHILE disconnected
        await reconnectViewer(page);
        await waitFor(async () => {
          const g = await viewerGeneration(page);
          return g !== undefined && g !== g0 ? g : null;
        }, 10_000, 'window.__viewerGeneration never changed after __viewerReconnect()');

        await waitFor(() => page.$(`[data-row-id="${reconnectAUse.id}"][data-state="ok"]`), 10_000, 'reconnect-A tool never completed after reconnect');
        const reconnectAText = await page.$eval(`[data-row-id="${reconnectAUse.id}"]`, (el) => el.textContent ?? '');
        expect(reconnectAText).toContain('reconnect-a-result-marker');
        expect(await page.$$eval(`[data-row-id="${reconnectAUse.id}"]`, (els) => els.length)).toBe(1); // exactly once
        {
          const ids = await rowIds(page);
          expect(new Set(ids).size).toBe(ids.length); // no duplicate id ANYWHERE in the window
        }

        // =======================================================================================
        // PHASE 7 — reconnect BETWEEN a call and its result: drop the connection after the
        // tool_use row and before the tool_result exists at all; reconnect; THEN write the
        // result. The card must complete, never orphan.
        // =======================================================================================
        const g1 = await viewerGeneration(page);
        const toolUseIdReconnectB = 'toolu_e2e_reconnect_b';
        const reconnectBUse = writer.writeRow(toolUseRow(SESSION_LIVE_ID, toolUseIdReconnectB, 'echo reconnect-b'));
        await waitFor(() => page.$(`[data-row-id="${reconnectBUse.id}"][data-state="pending"]`), 5000, 'reconnect-B tool_use never rendered pending');

        await closeViewerEventSource(page);
        await reconnectViewer(page);
        await waitFor(async () => {
          const g = await viewerGeneration(page);
          return g !== undefined && g !== g1 ? g : null;
        }, 10_000, 'window.__viewerGeneration never changed after the second __viewerReconnect()');
        await waitFor(() => page.$(`[data-row-id="${reconnectBUse.id}"][data-state="pending"]`), 10_000, 'reconnect-B card was lost across the reconnect (orphaned)');

        writer.writeRow(toolResultRow(SESSION_LIVE_ID, toolUseIdReconnectB, 'reconnect-b-result-marker')); // written AFTER the reconnect completed
        await waitFor(() => page.$(`[data-row-id="${reconnectBUse.id}"][data-state="ok"]`), 5000, 'reconnect-B tool never completed rather than orphaning');
        const reconnectBText = await page.$eval(`[data-row-id="${reconnectBUse.id}"]`, (el) => el.textContent ?? '');
        expect(reconnectBText).toContain('reconnect-b-result-marker');
        {
          const ids = await rowIds(page);
          expect(new Set(ids).size).toBe(ids.length);
        }

        writer.close();
        subWriter.close();
      } finally {
        await page.close();
        await viewer.stop();
        const hashAfter = hashTreeExcluding(mainRoot, excludedPaths);
        rmSync(mainRoot, { recursive: true, force: true });
        // G4's zero-write claim, scoped to this suite's own enumerated writes (see the file header
        // note above): every OTHER file in the copy is byte-identical before and after.
        expect(hashAfter).toBe(hashBefore);
      }

      // Write latency.json now — every sample, whatever the outcome, never clamped or discarded.
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const worstMs = Math.max(...samples.map((s) => s.sampleMs));
      writeFileSync(
        LATENCY_JSON_PATH,
        `${JSON.stringify({ measuredAt: new Date().toISOString(), budgetMs: LATENCY_BUDGET_MS, sampleCount: samples.length, worstMs, samples }, null, 2)}\n`,
      );
      // The real assertion: never widened to make a slow run pass (this task's own brief).
      expect(worstMs).toBeLessThanOrEqual(LATENCY_BUDGET_MS);

      // =========================================================================================
      // DEDICATED COPY D — the >2,000-node window (task 1's fourth fixture session, session-4) and
      // its eviction/"N new below" behaviour. No digest: like `perf.test.ts`'s own writable-copy
      // section, this copy exists ONLY to be written to, so a zero-write proof would prove nothing.
      // =========================================================================================
      const windowRoot = mkdtempSync(join(tmpdir(), 'vc-live-tail-window-'));
      buildHomeA(windowRoot);
      const windowViewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(windowRoot, 'cfg'), HOME: windowRoot });
      const windowPage = await b.newPage();
      await windowPage.setViewportSize({ width: 900, height: 500 });
      try {
        await windowPage.goto(`http://127.0.0.1:${windowViewer.port}/s/${SESSION_4_ID}`);
        await waitFor(() => windowPage.$$eval('[data-row-id]', (els) => (els.length > 0 ? els.length : null)), 15_000, 'session-4 initial window never rendered');
        expect(await windowPage.$('[data-testid="load-earlier"]')).not.toBeNull();

        // 5 back-fills: 500 initial + 5*500 = 3000 requested against ~2600 real nodes — enough to
        // both cross the 2,000 cap (evicting from the tail) AND exhaust all remaining history (the
        // load-earlier button disappears once truncatedBefore is genuinely false). The ROW COUNT
        // alone is not a valid "this click did something" signal once the cap is reached (it stays
        // pinned at 2000 from click 3 onward even though the window keeps moving earlier) — the
        // HEAD id (the window's own earliest node) strictly decreases in byte offset on every
        // successful back-fill, capped or not, so that is what each click's completion is proved by.
        for (let i = 0; i < 5; i++) {
          const idsBefore = await rowIds(windowPage);
          const headBefore = idsBefore[0];
          await windowPage.click('[data-testid="load-earlier"]');
          await waitFor(async () => {
            const ids = await rowIds(windowPage);
            return ids.length > 0 && ids[0] !== headBefore ? ids[0] : null;
          }, 10_000, `load-earlier click ${i + 1} never moved the window's earliest node`);
        }
        expect(await rowCount(windowPage)).toBe(WINDOW_CAP);
        const windowText = await windowPage.$eval('[data-scroll="rows"]', (el) => el.textContent ?? '');
        expect(windowText).toContain('double-block filler row 1'); // the true earliest content on disk, now within the head-kept window
        expect(await windowPage.$('[data-testid="load-earlier"]')).toBeNull(); // all history exhausted

        // "The follow pill is off": append ONE more row directly to session-4.jsonl; since the
        // store is at the cap with follow off, it is COUNTED, not appended (§6.3) — proved by the
        // new-below-pill appearing while the row count stays exactly at the cap.
        const session4Path = join(windowRoot, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.jsonl`);
        const session4Writer = new ControlledWriter(session4Path);
        session4Writer.writeRow(assistantTextRow(SESSION_4_ID, 'session4 live append marker'));
        session4Writer.close();
        await waitFor(() => windowPage.$('[data-testid="new-below-pill"]'), 5000, 'the new-below-pill never appeared after the append past the cap');
        expect(await rowCount(windowPage)).toBe(WINDOW_CAP); // still capped — the append was COUNTED, not rendered

        // "Scroll to the bottom" (the app's actual affordance for it once counted, R14.5c): click
        // the pill — the tail window reloads and following resumes.
        await windowPage.click('[data-testid="new-below-pill"]');
        await waitFor(() => windowPage.$('[data-testid="new-below-pill"]').then((el) => (el === null ? true : null)), 10_000, 'the new-below-pill never cleared after being clicked');
        const reloadedText = await windowPage.$eval('[data-scroll="rows"]', (el) => el.textContent ?? '');
        expect(reloadedText).toContain('session4 live append marker'); // the fresh tail window includes the just-appended row
        expect(await rowCount(windowPage)).toBeLessThan(WINDOW_CAP); // a genuine reload, not a bigger merged window
      } finally {
        await windowPage.close();
        await windowViewer.stop();
        rmSync(windowRoot, { recursive: true, force: true });
      }

      // =========================================================================================
      // DEDICATED COPY E — rotation (spec §6.1/B12): a SAME-SIZE, different-content replacement of
      // session-4.jsonl (via `<SESSION_4_ID>.rotated`, task 1's own sibling fixture built for
      // exactly this) while connected. Its own fresh, untouched copy so the rotated sibling's size
      // matches the CURRENT file's size exactly (the window test's copy above already appended a
      // row, so it could not be reused here without breaking the "same size" precondition).
      // =========================================================================================
      const rotateRoot = mkdtempSync(join(tmpdir(), 'vc-live-tail-rotate-'));
      buildHomeA(rotateRoot);
      const rotateViewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(rotateRoot, 'cfg'), HOME: rotateRoot });
      const rotatePage = await b.newPage();
      try {
        await rotatePage.goto(`http://127.0.0.1:${rotateViewer.port}/s/${SESSION_4_ID}`);
        await waitFor(() => rotatePage.$$eval('[data-row-id]', (els) => (els.length > 0 ? els.length : null)), 15_000, 'session-4 initial window never rendered (rotation copy)');
        const idsBefore = new Set(await rowIds(rotatePage));
        expect(idsBefore.size).toBeGreaterThan(0);

        const session4PathE = join(rotateRoot, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.jsonl`);
        const rotatedFixturePath = join(rotateRoot, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.rotated`);
        const beforeSize = statSync(session4PathE).size;
        const rotatedBytes = readFileSync(rotatedFixturePath);
        expect(rotatedBytes.length).toBe(beforeSize); // the precondition this scenario claims to test

        // A RENAME-based replace (never an in-place overwrite): this is what gives the replacement
        // a genuinely NEW inode, which is the exact signal `core/tail.ts#advanceTail` uses to
        // detect rotation even when the size does not change.
        const tmpRotated = join(tmpdir(), `vc-live-tail-rotated-${randomUUID()}.jsonl`);
        writeFileSync(tmpRotated, rotatedBytes);
        renameSync(tmpRotated, session4PathE);

        await waitFor(async () => {
          const idsAfter = await rowIds(rotatePage);
          const overlap = idsAfter.some((id) => idsBefore.has(id));
          const text = await rotatePage.$eval('[data-scroll="rows"]', (el) => el.textContent ?? '');
          return !overlap && idsAfter.length > 0 && text.includes('double-block filler row 1') ? true : null;
        }, 10_000, 'rotation never cleared and re-rendered the TAIL window of the new file');

        const countAfterRotation = await rowCount(rotatePage);
        expect(countAfterRotation).toBeGreaterThan(0);
        expect(countAfterRotation).toBeLessThan(2600); // a WINDOWED re-render, never the whole file
      } finally {
        await rotatePage.close();
        await rotateViewer.stop();
        rmSync(rotateRoot, { recursive: true, force: true });
      }

      // =========================================================================================
      // REALISM CHECK — a real `claude -p` Haiku 4.5 session, run alongside as a realism check
      // ONLY (spec §16.3's closing paragraph, D32c: against the REAL config dir, no digest). NO
      // assertion above depends on its content, and its own absence (no credentials, no network,
      // account limit, missing binary) must NEVER fail this suite — gated end-to-end in its own
      // try/catch, after every measured assertion has already passed.
      // =========================================================================================
      const realHome = process.env.HOME;
      if (realHome === undefined || realHome === '') {
        console.warn('live-tail.e2e: realism check SKIPPED — no real HOME in this environment');
      } else {
        let realismViewer: ViewerHandle | null = null;
        let realismPage: Page | null = null;
        const haikuCwd = mkdtempSync(join(tmpdir(), 'vc-live-tail-haiku-'));
        try {
          const sessionId = randomUUID();
          execFileSync(
            'claude',
            ['-p', 'Reply with one short sentence only. Do not use any tools.', '--model', 'claude-haiku-4-5-20251001', '--session-id', sessionId, '--permission-mode', 'bypassPermissions'],
            { cwd: haikuCwd, timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] },
          );
          realismViewer = await spawnViewer({ CLAUDE_CONFIG_DIR: undefined, HOME: realHome });
          realismPage = await b.newPage();
          await realismPage.goto(`http://127.0.0.1:${realismViewer.port}/s/${sessionId}`);
          await waitFor(() => realismPage!.$$eval('[data-row-id]', (els) => (els.length > 0 ? els.length : null)), 15_000, 'the real Haiku session never rendered any row');
          console.log(`live-tail.e2e: realism check PASSED — real session ${sessionId} rendered`);
        } catch (e) {
          // Tolerated by design (spec §16.3, this task's brief): credentials/quota/network are not
          // guaranteed in a headless run. Every measured assertion above has ALREADY passed.
          console.warn(`live-tail.e2e: realism check SKIPPED — ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          await realismPage?.close();
          await realismViewer?.stop();
          rmSync(haikuCwd, { recursive: true, force: true });
        }
      }
    },
    580_000,
  );
});
