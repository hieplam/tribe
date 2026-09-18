// e2e/dom-kinds.e2e.test.ts — G1 (list + render every kind) and G4 (zero writes), spec §16.2.
//
// EDGE code, outside the D16 wall (structure.test.ts's `walk()` never enters `e2e/`, matching
// harness.ts's own precedent): this file spawns a real `serve.ts` child process, drives a real
// headless Chromium via `playwright-core` (`e2e/browser.ts`), and reads/hashes a real `mkdtemp`
// fixture tree. None of that is reachable from `core/**`/`adapters/**`/`serve.ts`/`client/src/**`.
//
// Root resolution the PRODUCTION way (D32b): the server under test is started with
// `CLAUDE_CONFIG_DIR=<homeA>/cfg` and `HOME=<homeA>` — the exact variable Claude Code itself
// honours — never a test-only path. `homeA` has NO `.tribe` at all (G1's precondition, spec
// §16.2's table).
//
// Fail-closed, never skip (spec §16.0): if no browser resolves, `beforeAll` throws
// `resolveChromiumExecutable()`'s one-line remedy and every test in this file reports that
// failure — there is no `test.skipIf` anywhere below.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import {
  buildEmptyProject,
  buildEmptyProjectsRoot,
  buildHomeA,
  buildHomeWithoutClaude,
  PROJECT_A_DIR,
  PROJECT_B_DIR,
  PROJECT_C_DIR,
  SESSION_1_ID,
  SESSION_2_ID,
  SESSION_3_ID,
  SESSION_4_ID,
  SESSION_CUT_ID,
  SESSION_LIVE_ID,
  SUBAGENT_IDS,
} from '../fixtures/build.ts';
import { RENDER_NODE_KINDS } from '../core/model.ts';
import { resolveChromiumExecutable } from './browser.ts';

const SERVE_TS = join(import.meta.dir, '..', 'serve.ts');
const OUTPUT_DIR = join(import.meta.dir, 'output');

// The exact literal fixtures/build.ts encodes into session-1's base64 image block
// (`Buffer.from('FIXTURE-PNG-BYTES-0123456789').toString('base64')`) — reproduced here (never
// imported: build.ts exports no constant for it) so the expand test can assert the DECODED byte
// length is the one the fixture actually wrote, not merely "some non-empty string".
const FIXTURE_IMAGE_RAW_BYTES = Buffer.byteLength('FIXTURE-PNG-BYTES-0123456789', 'utf8');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A bounded deadline loop (carried over from the old harness's proven pattern) — never an
 * unbounded wait, never a library `timeout` option this machine's Bun/Chrome combination has been
 * observed to ignore. */
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

/** An OS-assigned free TCP port, found by asking Bun to bind port 0 and reading back what it
 * chose, then releasing it immediately — `serve.ts`'s own `--port` parser refuses `0` (spec §13:
 * the valid range is 1-65535), so this is the only way to get an ephemeral port for a `bun
 * serve.ts --port <n>` child process. */
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

/** Spawns the REAL `serve.ts` (never a stub) with the given environment and polls its `/healthz`
 * until it answers — the same readiness signal `harness.ts` used, now against the new v2 body
 * (spec §10.4). Captures stderr so a boot failure's message travels into the thrown error rather
 * than being silently lost. */
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

/** A single digest of an ENTIRE directory tree (D16/G4) — every regular file's content, every
 * symlink's OWN target string (never dereferenced: a hostile/escaping link, like the fixture's own
 * `escaping.txt`, must never have its target's bytes read by the very proof that is supposed to
 * catch an unwanted read), sorted by path so the digest is order-independent. Two calls bracketing
 * a suite that is claimed to write nothing must produce the identical string. */
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

async function captureScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    await page.screenshot({ path: join(OUTPUT_DIR, name), fullPage: true });
  } catch (e) {
    // "a screenshot that cannot be captured is recorded, never faked" — logged, never thrown, and
    // never a placeholder file left behind in its place.
    console.error(`dom-kinds: screenshot ${name} could not be captured: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let browser: Browser;

beforeAll(async () => {
  // Fail CLOSED (spec §16.0): no `test.skipIf` anywhere in this file. If no browser resolves,
  // this throws with the one-line remedy and every test below reports that failure.
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
});

afterAll(async () => {
  await browser.close();
});

describe('dom-kinds.e2e — homeA, /s/<session-1> (G1 layers 1-3, G4)', () => {
  let homeDir: string;
  let viewer: ViewerHandle;
  let page: Page;
  let hashBefore: string;

  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'vc-dom-kinds-'));
    buildHomeA(homeDir);
    hashBefore = hashTree(homeDir); // taken BEFORE the server/browser ever touch homeA
    viewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(homeDir, 'cfg'), HOME: homeDir });
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${viewer.port}/s/${SESSION_1_ID}`);
    await waitFor(
      () => page.$$eval('[data-scroll="rows"] .row', (els) => (els.length > 0 ? els.length : null)),
      15_000,
      'session-1 rows never rendered',
    );
    await captureScreenshot(page, 'session-1.png');
  }, 30_000);

  afterAll(async () => {
    await page.close();
    await viewer.stop();
    const hashAfter = hashTree(homeDir);
    rmSync(homeDir, { recursive: true, force: true });
    // D16/G4: the whole homeA tree is byte-identical before and after this ENTIRE suite touched
    // it — asserted in afterAll (not a test) so it runs exactly once regardless of which tests
    // above passed, and the mkdtemp is still removed even if this assertion itself fails.
    expect(hashAfter).toBe(hashBefore);
  });

  // ---------------------------------------------------------------------------------------------
  // Layer 1 — kind coverage, driven by the RUNTIME witness (never the erased TS union).
  // ---------------------------------------------------------------------------------------------
  describe('layer 1: every RENDER_NODE_KINDS witness entry renders at least one [data-kind]', () => {
    for (const kind of Object.keys(RENDER_NODE_KINDS)) {
      test(`kind coverage: ${kind}`, async () => {
        // `RENDER_NODE_KINDS`' keys are plain identifiers (no quote/bracket characters), so a raw
        // attribute-selector interpolation is safe here without a CSS.escape (a browser-only API
        // this Node-side template string has no access to).
        const count = await page.$$eval(`[data-kind="${kind}"]`, (els) => els.length);
        expect(count).toBeGreaterThanOrEqual(1);
      });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Layer 2 — one assertion per distinguishable input shape (spec §16.2's table).
  // ---------------------------------------------------------------------------------------------
  describe('layer 2: distinguishable input shapes', () => {
    test('string prompt renders the fixture text verbatim', async () => {
      const texts = await page.$$eval('[data-kind="prompt"]', (els) => els.map((e) => e.textContent ?? ''));
      expect(texts.some((t) => t.includes('Build the widget exporter fixture.'))).toBe(true);
    });

    test('array-form prompt renders its text block (the B2 case)', async () => {
      const texts = await page.$$eval('[data-kind="prompt"]', (els) => els.map((e) => e.textContent ?? ''));
      expect(texts.some((t) => t.includes('Array-form prompt: please add tests too.'))).toBe(true);
    });

    test('tool_use with no result is [data-state="pending"]', async () => {
      const count = await page.$$eval('[data-kind="tool"][data-state="pending"]', (els) => els.length);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('tool_use paired ok is [data-state="ok"] and shows the result text', async () => {
      const texts = await page.$$eval('[data-kind="tool"][data-state="ok"]', (els) => els.map((e) => e.textContent ?? ''));
      expect(texts.some((t) => t.includes('Fixture repo'))).toBe(true);
    });

    test('tool_result is_error:true is [data-state="error"] with the error token present', async () => {
      const errorCards = await page.$$eval('[data-kind="tool"][data-state="error"]', (els) =>
        els.map((e) => ({ text: e.textContent ?? '', hasToken: e.querySelector('[data-error-token]') !== null })),
      );
      expect(errorCards.some((c) => c.hasToken && c.text.includes('command failed'))).toBe(true);
    });

    test('a tool_result whose call precedes the window is an orphan_result', async () => {
      const count = await page.$$eval('[data-kind="orphan_result"]', (els) => els.length);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    test('MIXED row (D28): the tool card gains its result AND the text block survives as a visible prompt', async () => {
      const toolCards = await page.$$eval('[data-kind="tool"]', (els) =>
        els.map((e) => ({ state: e.getAttribute('data-state'), text: e.textContent ?? '' })),
      );
      const mixedCard = toolCards.find((c) => c.text.includes('exporter.ts written'));
      expect(mixedCard).toBeDefined();
      expect(mixedCard?.state).toBe('ok');

      const promptTexts = await page.$$eval('[data-kind="prompt"]', (els) => els.map((e) => e.textContent ?? ''));
      expect(promptTexts.some((t) => t.includes('Also, please keep the exporter under 200 lines.'))).toBe(true);
    });

    test('an empty thinking block is silent; only the non-empty one renders', async () => {
      // Session-1 has exactly two thinking BLOCKS: row 2 (non-empty) and row 3 (thinking: "",
      // the row's ONLY block). If the empty one wrongly rendered a node, this count would be 2.
      const thinkingTexts = await page.$$eval('[data-kind="thinking"]', (els) => els.map((e) => e.textContent ?? ''));
      expect(thinkingTexts).toHaveLength(1);
      expect(thinkingTexts[0]).toContain('Let me look at the repo layout first.');
    });

    test('image: zero byte-requests before expand, exactly ONE on expand, then a data: <img> of the expected length', async () => {
      const blockRequests: string[] = [];
      const onRequest = (req: import('playwright-core').Request) => {
        if (req.url().includes('/api/block')) blockRequests.push(req.url());
      };
      page.on('request', onRequest);
      try {
        expect(blockRequests.length).toBe(0);

        const expandButton = page.locator('[data-kind="image"] [data-testid="image-expand"]');
        await expandButton.click();
        const img = await waitFor(
          () => page.$('[data-kind="image"] img.image__full'),
          10_000,
          'expanded <img> never appeared',
        );
        expect(blockRequests.length).toBe(1);
        expect(blockRequests[0]).toContain('/api/block');
        expect(blockRequests[0]).toMatch(/[?&]at=/);
        expect(blockRequests[0]).toMatch(/[?&]i=/);

        const src = await img.getAttribute('src');
        expect(src).toBeTruthy();
        expect(src!.startsWith('data:')).toBe(true);
        const base64 = src!.slice(src!.indexOf(',') + 1);
        expect(Buffer.byteLength(base64, 'base64')).toBe(FIXTURE_IMAGE_RAW_BYTES);
      } finally {
        page.off('request', onRequest);
      }
    });

    test('compaction (isCompactSummary) renders one divider labelled "context compacted"', async () => {
      const labels = await page.$$eval('[data-kind="divider"]', (els) => els.map((e) => e.textContent ?? ''));
      expect(labels.some((l) => l.includes('context compacted'))).toBe(true);
    });

    test('a <persisted-output> spill: /api/spill is not called before expand, then exactly the expanded content', async () => {
      const spillRequests: string[] = [];
      const onRequest = (req: import('playwright-core').Request) => {
        if (req.url().includes('/api/spill')) spillRequests.push(req.url());
      };
      page.on('request', onRequest);
      try {
        expect(spillRequests.length).toBe(0);

        const toolCards = page.locator('[data-kind="tool"]');
        const count = await toolCards.count();
        let spillCard: import('playwright-core').Locator | null = null;
        for (let i = 0; i < count; i++) {
          const text = await toolCards.nth(i).textContent();
          if (text?.includes('output spilled to a file')) {
            spillCard = toolCards.nth(i);
            break;
          }
        }
        expect(spillCard).not.toBeNull();
        await spillCard!.locator('[data-testid="tool-expand-result"]').click();
        await waitFor(() => (spillRequests.length > 0 ? true : null), 10_000, '/api/spill was never called');
        expect(spillRequests.length).toBe(1);
        expect(spillRequests[0]).toContain('name=');

        const full = await spillCard!.locator('pre.tool__spill-full').textContent();
        expect(full).toContain('=== fixture spill preview ===');
      } finally {
        page.off('request', onRequest);
      }
    });

    test('an unknown row type renders as a collapsed raw card carrying its rowType', async () => {
      const rowTypes = await page.$$eval('[data-kind="raw"] .raw__type', (els) => els.map((e) => e.textContent ?? ''));
      expect(rowTypes).toContain('totally-invented-fixture-row-type');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Subagent tab navigation.
  // ---------------------------------------------------------------------------------------------
  test('clicking a subagent tab navigates and renders that agent\'s nodes', async () => {
    const tab = page.locator('[data-agent-tab]:not([data-agent-tab=""])').first();
    const agentId = await tab.getAttribute('data-agent-tab');
    expect(agentId).toBeTruthy();
    await tab.click();
    await waitFor(() => (page.url().endsWith(`/a/${agentId}`) ? true : null), 10_000, 'URL never updated to the agent tab');
    // The PARENT stream's rows are already non-empty at click time, so "rows.length > 0" is a
    // false-positive wait here — poll for the agent's OWN expected text instead, which can only
    // be true once its stream has actually replaced the parent's window.
    const expectedText = `Fixture subagent ${agentId} response.`;
    await waitFor(
      () =>
        page
          .$$eval('[data-kind="assistant"]', (els) => els.map((e) => e.textContent ?? ''))
          .then((texts) => (texts.some((t) => t.includes(expectedText)) ? true : null)),
      10_000,
      `agent ${agentId}'s own rows never rendered`,
    );
  });

  // ---------------------------------------------------------------------------------------------
  // Layer 3 — "lists every session", asserted as a SET, both directions (D10's 30-day window).
  // The exact ids compared against are the ones `fixtures/build.ts` itself wrote (imported
  // constants), never a hard-coded count — so this stays correct even if a later task adds a
  // fixture session (spec §16.2's own stated intent for this proof).
  // ---------------------------------------------------------------------------------------------
  describe('layer 3: session listing is exactly the fixture-written set, in both directions', () => {
    const DEFAULT_IDS = [SESSION_1_ID, SESSION_LIVE_ID, SESSION_CUT_ID, SESSION_4_ID, SESSION_2_ID].sort();
    const ALL_IDS = [...DEFAULT_IDS, SESSION_3_ID].sort();

    /** Every session id the SAME wire contract the client itself consumes reports — fetched
     * through the page's own `fetch` (the real browser hitting the real server), never a
     * Node-side bypass. This is what makes "the rendered set" checkable byte-exactly: the
     * fixture's ids collide on their first 8 hex characters (all four proj-A sessions share
     * `a0000000`), so the DOM's own truncated `.session-row__id` text cannot disambiguate them —
     * the wire data that PRODUCES the render, read through the browser, is the byte-exact source
     * of truth for which set actually reached the page. */
    async function sessionIdsViaWire(all: boolean): Promise<string[]> {
      return page.evaluate(async (allParam) => {
        const projectsRes = await fetch(`/api/projects${allParam ? '?all=1' : ''}`);
        const projects = (await projectsRes.json()) as { projects: { dir: string }[] };
        const ids: string[] = [];
        for (const p of projects.projects) {
          const sessionsRes = await fetch(`/api/sessions?project=${encodeURIComponent(p.dir)}`);
          const sessions = (await sessionsRes.json()) as { sessions: { id: string }[] };
          ids.push(...sessions.sessions.map((s) => s.id));
        }
        return ids;
      }, all);
    }

    test('default view: exactly the sessions inside D10\'s 30-day window, proj-C absent', async () => {
      const listPage = await browser.newPage();
      try {
        await listPage.goto(`http://127.0.0.1:${viewer.port}/`);
        await waitFor(
          () => listPage.$$eval('.session-row', (els) => (els.length > 0 ? els.length : null)),
          15_000,
          'default session list never rendered',
        );
        const domCount = await listPage.$$eval('.session-row', (els) => els.length);
        expect(domCount).toBe(DEFAULT_IDS.length);

        const ids = (await sessionIdsViaWire(false)).sort();
        expect(new Set(ids)).toEqual(new Set(DEFAULT_IDS));
        expect(ids).not.toContain(SESSION_3_ID);
        await captureScreenshot(listPage, 'list-default.png');
      } finally {
        await listPage.close();
      }
    });

    test('clicking "show N older projects" reveals every session, proj-C included', async () => {
      const listPage = await browser.newPage();
      try {
        await listPage.goto(`http://127.0.0.1:${viewer.port}/`);
        await waitFor(
          () => listPage.$$eval('.session-row', (els) => (els.length > 0 ? els.length : null)),
          15_000,
          'default session list never rendered',
        );
        await listPage.click('a[href="?all=1"]');
        await waitFor(
          () => listPage.$$eval('.session-row', (els, n) => (els.length >= n ? els.length : null), ALL_IDS.length),
          15_000,
          'the older-projects click never revealed every session',
        );
        const domCount = await listPage.$$eval('.session-row', (els) => els.length);
        expect(domCount).toBe(ALL_IDS.length);

        const ids = (await sessionIdsViaWire(true)).sort();
        expect(new Set(ids)).toEqual(new Set(ALL_IDS));
        await captureScreenshot(listPage, 'list-all-via-click.png');
      } finally {
        await listPage.close();
      }
    });

    test('?all=1 directly reveals every session, proj-C included', async () => {
      const listPage = await browser.newPage();
      try {
        await listPage.goto(`http://127.0.0.1:${viewer.port}/?all=1`);
        await waitFor(
          () => listPage.$$eval('.session-row', (els, n) => (els.length >= n ? els.length : null), ALL_IDS.length),
          15_000,
          '?all=1 never rendered every session',
        );
        const domCount = await listPage.$$eval('.session-row', (els) => els.length);
        expect(domCount).toBe(ALL_IDS.length);

        const ids = (await sessionIdsViaWire(true)).sort();
        expect(new Set(ids)).toEqual(new Set(ALL_IDS));
      } finally {
        await listPage.close();
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The three empty shapes (task 1) — each its OWN mkdtemp directory, never a variant of homeA.
// ---------------------------------------------------------------------------------------------
describe('dom-kinds.e2e — the three empty shapes render "no sessions" rather than an error or a blank pane', () => {
  const cases: { name: string; build: (dest: string) => void; env: (dest: string) => Record<string, string | undefined> }[] = [
    {
      name: 'empty project (a project dir with zero sessions)',
      build: buildEmptyProject,
      env: (dest) => ({ CLAUDE_CONFIG_DIR: join(dest, 'cfg'), HOME: dest }),
    },
    {
      name: 'empty projects root (cfg/projects exists, holds nothing)',
      build: buildEmptyProjectsRoot,
      env: (dest) => ({ CLAUDE_CONFIG_DIR: join(dest, 'cfg'), HOME: dest }),
    },
    {
      name: 'no .claude at all (CLAUDE_CONFIG_DIR unset, HOME has no .claude)',
      build: buildHomeWithoutClaude,
      env: (dest) => ({ CLAUDE_CONFIG_DIR: undefined, HOME: dest }),
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const dest = mkdtempSync(join(tmpdir(), 'vc-dom-kinds-empty-'));
      let viewer: ViewerHandle | null = null;
      let page: Page | null = null;
      try {
        c.build(dest);
        // `spawnViewer` spreads `process.env` first, then this — an explicit `undefined` here
        // (the "no .claude at all" case) overrides and then DROPS any inherited
        // `CLAUDE_CONFIG_DIR` from this very process, never leaving it to leak through (G1's
        // actual precondition per the task brief and audit lens).
        viewer = await spawnViewer(c.env(dest));
        page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${viewer.port}/`);
        await waitFor(
          () => page!.$eval('body', (b) => (/no session/i.test(b.textContent ?? '') ? true : null)),
          15_000,
          'the empty shape never rendered a "no sessions" note',
        );
        const bodyText = await page.textContent('body');
        expect(bodyText ?? '').toMatch(/no session/i);
        // Fails closed, never silently: no error page, no blank pane.
        expect((await page.$('[data-testid="load-error"]')) === null).toBe(true);
      } finally {
        await page?.close();
        await viewer?.stop();
        rmSync(dest, { recursive: true, force: true });
      }
    }, 30_000);
  }
});
