// e2e/visual-contract.e2e.test.ts — V2's visual contract for the SESSION-LIST screen (plan
// Task 3) and the SESSION VIEW (plan Task 4), proved in a real browser against the real server. The
// oracle is preview.html §C (list) and §D (session): this file asserts the COMPUTED styles of the
// list shell, sidebar, project rows, session rows, the campaign badge, the status dots, the filter
// box and the "show older" link — then the session header, agent tabs, transcript rows (prompt,
// assistant, thinking, tool cards, orphan/error/raw/unreadable, chips, dividers), markdown, the
// follow pill and the buttons — against the RESOLVED sea-salt token values, never a hard-coded
// colour or size, so the assertion tracks the tokens.
//
// EDGE code, outside the D16 wall (structure.test.ts's `walk()` never enters `e2e/`): this file
// spawns a real `serve.ts` child, drives a real headless Chromium, and reads a real `mkdtemp`
// fixture. Started exactly like `dom-kinds.e2e.test.ts` (free port, healthy `/healthz`, killed in
// `finally`), and it FAILS CLOSED — no `test.skipIf`: if no browser resolves, `beforeAll` throws
// the one-line remedy and every test reports it (spec §16.0).
//
// The fixture is `buildHomeB` (= `buildHomeA` + the `.tribe` campaign tree), because a campaign
// badge only renders when a session carries one, and `buildHomeA` deliberately has no `.tribe`.
// Everything the list screen shows is present in `buildHomeB`: a live project (proj-A), an idle
// one revealed by `?all=1` (proj-C, 90 days old), a badge on session-1, and the older-projects
// affordance on the default `/`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildHomeB, PROJECT_A_DIR, SESSION_1_ID, SESSION_4_ID } from '../fixtures/build.ts';
import { resolveChromiumExecutable } from './browser.ts';

const SERVE_TS = join(import.meta.dir, '..', 'serve.ts');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A bounded deadline loop (the proven `dom-kinds` pattern) — never an unbounded wait. */
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

/** An OS-assigned free TCP port — `serve.ts`'s own parser refuses `0`, so this is the only way to
 * get an ephemeral port for the child. */
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

/** Spawns the REAL `serve.ts` with the given environment and polls its v2 `/healthz` until it
 * answers (the same readiness signal `dom-kinds` uses). Captures stderr so a boot failure travels
 * into the thrown error. */
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

// ---- in-page style probes -----------------------------------------------------------------
// Every colour comparison is normalised through the SAME probe element: assign the expression
// (`var(--surface)` or an already-computed `rgb(...)`) to a span's `color`, read back
// `getComputedStyle().color`. Two expressions that resolve to the same colour then compare as
// equal strings regardless of how each was originally written (hex token vs computed rgb).

/** The canonical `rgb(...)`/`rgba(...)` a colour expression resolves to in the live page. */
async function canonColor(page: Page, expr: string): Promise<string> {
  return page.evaluate((e) => {
    const probe = document.createElement('span');
    probe.style.color = e;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, expr);
}

/** One computed CSS property (by its CSS name, e.g. `border-bottom-color`) of the first element
 * matching `selector`. */
async function cssProp(page: Page, selector: string, prop: string): Promise<string> {
  return page.$eval(
    selector,
    (el, p) => getComputedStyle(el as Element).getPropertyValue(p as string),
    prop,
  );
}

/** The pixel value a size token (e.g. `--size-16`) resolves to, read as a probe's `font-size`. */
async function tokenPx(page: Page, sizeVar: string): Promise<number> {
  return page.evaluate((v) => {
    const probe = document.createElement('span');
    probe.style.fontSize = `var(${v})`;
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return px;
  }, sizeVar);
}

/** The line-height px a `--size-*` × `--leading-*` pair resolves to (a probe with both applied). */
async function tokenLineHeightPx(page: Page, sizeVar: string, leadingVar: string): Promise<number> {
  return page.evaluate(
    ([sz, ld]) => {
      const probe = document.createElement('span');
      probe.style.fontSize = `var(${sz})`;
      probe.style.lineHeight = `var(${ld})`;
      document.body.appendChild(probe);
      const px = parseFloat(getComputedStyle(probe).lineHeight);
      probe.remove();
      return px;
    },
    [sizeVar, leadingVar] as const,
  );
}

/** The canonical `box-shadow` string a token expression resolves to (e.g. `var(--focus-ring)`). */
async function canonShadow(page: Page, expr: string): Promise<string> {
  return page.evaluate((e) => {
    const probe = document.createElement('span');
    probe.style.boxShadow = e;
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).boxShadow;
    probe.remove();
    return v;
  }, expr);
}

/** The first font family named by a token (e.g. `--font-mono` -> `ui-monospace`), lower-cased. */
async function firstFamily(page: Page, fontVar: string): Promise<string> {
  return page.evaluate((v) => {
    const stack = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    return stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
  }, fontVar);
}

interface Box {
  left: number;
  right: number;
  top: number;
  width: number;
  height: number;
}

async function box(page: Page, selector: string): Promise<Box> {
  return page.$eval(selector, (el) => {
    const r = (el as Element).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
  });
}

let browser: Browser;

beforeAll(async () => {
  // Fail CLOSED (spec §16.0): no `test.skipIf`. If no browser resolves, this throws the one-line
  // remedy and every test below reports that failure. Launched like the other always-on browser
  // suites (dom-kinds, real-transcript).
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
});

// Deliberately NO top-level `afterAll(browser.close())`. `bun test` runs the test FILES
// concurrently in one process, and playwright-core serves every `chromium.launch()` in that
// process over one shared driver transport; whichever file calls `browser.close()` first tears
// that transport down and takes every OTHER file's browser with it ("Target page, context or
// browser has been closed"). This file's tests are the fastest of the browser suites, so its close
// reliably fired mid-run of `dom-kinds.e2e` and failed it. Proven: omitting the close makes the
// pair pass; a settle delay after the close does not. The browser is reaped when the test process
// exits (bun reports it as "killed N dangling processes"), so nothing is left running past the run.
// The shared page and the spawned `serve.ts` ARE still closed explicitly in the describe's afterAll.

/** Closes `p` if it is still open, swallowing the "already closed" error a concurrently-running
 * suite's transport teardown can raise — this file must fail on a real style regression, never on
 * a cross-file browser teardown it does not own. */
async function closeQuietly(p: Page | undefined): Promise<void> {
  if (!p) return;
  try {
    await p.close();
  } catch {
    // the page's browser was already torn down by another concurrently-running suite — nothing to do
  }
}

/** The session whose assistant text carries every markdown token the session view styles (fenced
 * code, inline code, a link) — `buildHomeB` has none, and the shared fixture is not edited here
 * because other suites pin its row counts. Written before the viewer boots, into the project the
 * fixture already uses, so the server discovers it like any other session. */
const MD_SESSION_ID = 'a0000000-0000-4000-8000-0000000000e1';
function writeMarkdownSession(homeDir: string): void {
  const projectDir = join(homeDir, 'cfg', 'projects', PROJECT_A_DIR);
  mkdirSync(projectDir, { recursive: true });
  const text = 'Run `bun test` then read [the docs](https://example.com/docs).\n\n```ts\nconst answer = 42;\n```';
  const rows = [
    { type: 'user', uuid: 'vc-md-1', sessionId: MD_SESSION_ID, cwd: '/Users/fixture/repo-alpha', timestamp: '2026-09-06T09:00:00.000Z', message: { role: 'user', content: 'Show me some markdown.' } },
    { type: 'assistant', uuid: 'vc-md-2', parentUuid: 'vc-md-1', sessionId: MD_SESSION_ID, timestamp: '2026-09-06T09:00:01.000Z', message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text }] } },
  ];
  writeFileSync(join(projectDir, `${MD_SESSION_ID}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

describe('visual-contract.e2e — the list (§C) and session (§D) screens match preview.html (plan Tasks 3-4, V2)', () => {
  let homeDir: string;
  let viewer: ViewerHandle;
  // ONE page for the whole suite, navigated with `goto` per test — opening a fresh page/tab per
  // test was observed to destabilise headless Chrome on this machine (dangling tabs on a slow
  // wait, then "browser has been closed"). Tests run sequentially, so a shared page is safe.
  let page: Page;

  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'vc-visual-contract-'));
    buildHomeB(homeDir); // homeA + the .tribe campaign tree, so session-1 carries a badge
    writeMarkdownSession(homeDir); // the one row shape no shared fixture has: fenced/inline code + a link
    viewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(homeDir, 'cfg'), HOME: homeDir });
    page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
  }, 30_000);

  afterAll(async () => {
    await closeQuietly(page); // never `browser.close()` here — see the module-level note above
    await viewer.stop();
    rmSync(homeDir, { recursive: true, force: true });
  });

  /** Navigates the shared page to `path` and waits for the sidebar's project rows (present on
   * every route). Returns once at least `minRows` `.session-row`s have rendered too when asked. */
  async function openList(path: string, waitForRows = false): Promise<void> {
    await page.goto(`http://127.0.0.1:${viewer.port}${path}`);
    await waitFor(
      () => page.$$eval('.project-row', (els) => (els.length > 0 ? els.length : null)),
      15_000,
      `${path}: project rows never rendered`,
    );
    if (waitForRows) {
      await waitFor(() => page.$$eval('.session-row', (e) => (e.length > 0 ? e.length : null)), 15_000, `${path}: rows`);
    }
  }

  // The `/` default list carries almost everything preview §C shows — the two-column shell, the
  // sidebar, project rows, session rows, a live dot, a badge (session-1 via the .tribe tree), the
  // filter box and the "show older" link (proj-C is out of the 30-day window). All of it is
  // asserted against ONE page load rather than reloading per assertion: fewer navigations keep this
  // browser-heavy file's CPU footprint small, which matters when `bun test` runs the whole e2e set
  // back to back on a busy machine.
  test('the / list screen matches preview §C: shell, sidebar, project/session rows, badge, live dot, filter, older-link', async () => {
    await openList('/', true);

    // two-column layout: sidebar left of main, same top, on --surface with a --rule right border.
    const sidebar = await box(page, '.sidebar');
    const main = await box(page, '.app-main');
    expect(sidebar.left).toBeLessThan(main.left);
    expect(sidebar.right).toBeLessThanOrEqual(main.left + 2);
    expect(Math.abs(sidebar.top - main.top)).toBeLessThanOrEqual(6);
    expect(await cssProp(page, '.sidebar', 'background-color')).toBe(await canonColor(page, 'var(--surface)'));
    expect(parseFloat(await cssProp(page, '.sidebar', 'border-right-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.sidebar', 'border-right-color')).toBe(await canonColor(page, 'var(--rule)'));

    const mono = await firstFamily(page, '--font-mono');

    // project rows: no bullet, name in the mono font, count a separate box right of the name.
    expect(await cssProp(page, '.project-list', 'list-style-type')).toBe('none');
    expect((await cssProp(page, '.project-row__label', 'font-family')).toLowerCase()).toContain(mono);
    const label = await box(page, '.project-row .project-row__label');
    const count = await box(page, '.project-row .project-row__count');
    expect(count.left).toBeGreaterThanOrEqual(label.right - 2);

    // session rows: bottom rule, title at --size-16, age in mono --size-12 --ink-soft, metadata separated.
    expect(parseFloat(await cssProp(page, '.session-row', 'border-bottom-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.session-row', 'border-bottom-color')).toBe(await canonColor(page, 'var(--rule)'));
    expect(parseFloat(await cssProp(page, '.session-row__title', 'font-size'))).toBeCloseTo(await tokenPx(page, '--size-16'), 0);
    expect((await cssProp(page, '.session-row__age', 'font-family')).toLowerCase()).toContain(mono);
    expect(parseFloat(await cssProp(page, '.session-row__age', 'font-size'))).toBeCloseTo(await tokenPx(page, '--size-12'), 0);
    expect(await cssProp(page, '.session-row__age', 'color')).toBe(await canonColor(page, 'var(--ink-soft)'));
    expect(await page.$eval('.session-row', (el) => el.textContent ?? '')).toContain('·'); // preview's middot metadata

    // campaign badge (session-1 via the .tribe tree): --badge-bg / --badge-ink / --badge-radius, mono, parts separated.
    await waitFor(() => page.$$eval('.campaign-badge', (e) => (e.length > 0 ? e.length : null)), 15_000, 'badge');
    expect(await cssProp(page, '.campaign-badge', 'background-color')).toBe(await canonColor(page, 'var(--badge-bg)'));
    expect(await cssProp(page, '.campaign-badge', 'color')).toBe(await canonColor(page, 'var(--badge-ink)'));
    expect(parseFloat(await cssProp(page, '.campaign-badge', 'border-top-left-radius'))).toBeCloseTo(await tokenPx(page, '--badge-radius'), 0);
    expect((await cssProp(page, '.campaign-badge', 'font-family')).toLowerCase()).toContain(mono);
    expect(await page.$eval('.campaign-badge', (el) => el.textContent ?? '')).toContain('·');

    // live dot: a filled --live circle (width === height, radius ≥ half, non-trivial size).
    const liveBox = await box(page, '.live-dot');
    expect(liveBox.width).toBeGreaterThan(4); // a real dot, not a 0×0 unstyled span
    expect(liveBox.width).toBeCloseTo(liveBox.height, 0);
    expect(parseFloat(await cssProp(page, '.live-dot', 'border-top-left-radius'))).toBeGreaterThanOrEqual(liveBox.width / 2 - 1);
    expect(await cssProp(page, '.live-dot', 'background-color')).toBe(await canonColor(page, 'var(--live)'));

    // the filter input is bordered in --rule; the "show older" link is in --accent.
    expect(parseFloat(await cssProp(page, '.campaign-filter', 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.campaign-filter', 'border-top-color')).toBe(await canonColor(page, 'var(--rule)'));
    await waitFor(() => page.$$eval('.show-older-projects a', (e) => (e.length > 0 ? e.length : null)), 15_000, 'show-older link');
    expect(await cssProp(page, '.show-older-projects a', 'color')).toBe(await canonColor(page, 'var(--accent)'));
  }, 30_000);

  test('an idle project (revealed by ?all=1) shows a hollow --rule-bordered circle, never a fill', async () => {
    // proj-C's only session is 90 days old, so it is idle and only appears once ?all=1 reveals it.
    await openList('/?all=1');
    await waitFor(() => page.$$eval('.idle-dot', (e) => (e.length > 0 ? e.length : null)), 15_000, 'idle dot');
    const idleBox = await box(page, '.idle-dot');
    expect(idleBox.width).toBeGreaterThan(4);
    expect(idleBox.width).toBeCloseTo(idleBox.height, 0);
    expect(parseFloat(await cssProp(page, '.idle-dot', 'border-top-left-radius'))).toBeGreaterThanOrEqual(idleBox.width / 2 - 1);
    const idleBg = await cssProp(page, '.idle-dot', 'background-color');
    expect(idleBg).not.toBe(await canonColor(page, 'var(--live)')); // never the live fill
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(idleBg); // no fill
    expect(parseFloat(await cssProp(page, '.idle-dot', 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.idle-dot', 'border-top-color')).toBe(await canonColor(page, 'var(--rule)'));
  }, 30_000);

  test('the active project (on /p/<dir>) carries the accent inset stroke', async () => {
    await page.goto(`http://127.0.0.1:${viewer.port}/p/${PROJECT_A_DIR}`);
    await waitFor(
      () => page.$$eval('.project-row--active', (e) => (e.length > 0 ? e.length : null)),
      15_000,
      'active project row never rendered',
    );
    const shadow = await cssProp(page, '.project-row--active', 'box-shadow');
    const accent = await canonColor(page, 'var(--accent)');
    // preview §C `.proj.on`: box-shadow: inset var(--card-stroke) 0 0 var(--accent).
    expect(shadow).not.toBe('none');
    expect(shadow).toContain(accent); // the accent colour is present in the shadow
    expect(shadow).toContain('inset'); // and it is an inset stroke, not a drop shadow
  }, 30_000);

  // ==== the session view (plan Task 4) — preview.html §D ==========================================

  /** Navigates the shared page to a session and waits for its rows AND the agent tabs (the tabs
   * arrive with the stream's meta frame, after the first rows). */
  async function openSession(id: string, waitForTabs = false): Promise<void> {
    await page.goto(`http://127.0.0.1:${viewer.port}/s/${id}`);
    await waitFor(() => page.$$eval('[data-row-id]', (e) => (e.length > 0 ? e.length : null)), 15_000, `/s/${id}: rows never rendered`);
    if (waitForTabs) {
      await waitFor(() => page.$$eval('.agent-tabs__tab', (e) => (e.length > 1 ? e.length : null)), 15_000, `/s/${id}: agent tabs never rendered`);
    }
  }

  test('the session header, agent tabs and live pill match preview §D', async () => {
    await openSession(SESSION_1_ID, true);
    const mono = await firstFamily(page, '--font-mono');
    const rule = await canonColor(page, 'var(--rule)');
    const accent = await canonColor(page, 'var(--accent)');

    // header strip: --surface ground, --rule bottom hairline, semi-bold title.
    expect(await cssProp(page, '.session-header', 'background-color')).toBe(await canonColor(page, 'var(--surface)'));
    expect(parseFloat(await cssProp(page, '.session-header', 'border-bottom-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.session-header', 'border-bottom-color')).toBe(rule);
    expect(parseInt(await cssProp(page, '.session-header__title', 'font-weight'), 10)).toBeGreaterThanOrEqual(600);

    // the live indicator is a pill: --accent or --live stroke, fully rounded (radius ≥ half its height).
    const liveColours = [accent, await canonColor(page, 'var(--live)')];
    await waitFor(() => page.$$eval('.session-header__live', (e) => (e.length > 0 ? e.length : null)), 15_000, 'live indicator');
    const pill = await box(page, '.session-header__live');
    expect(pill.width).toBeGreaterThan(0);
    expect(parseFloat(await cssProp(page, '.session-header__live', 'border-top-width'))).toBeGreaterThan(0);
    expect(liveColours).toContain(await cssProp(page, '.session-header__live', 'border-top-color'));
    expect(parseFloat(await cssProp(page, '.session-header__live', 'border-top-left-radius'))).toBeGreaterThanOrEqual(pill.height / 2);

    // agent tabs: mono --size-12; inactive --ink-soft; the active tab underlined in --accent.
    expect((await cssProp(page, '.agent-tabs__tab', 'font-family')).toLowerCase()).toContain(mono);
    expect(parseFloat(await cssProp(page, '.agent-tabs__tab', 'font-size'))).toBeCloseTo(await tokenPx(page, '--size-12'), 0);
    expect(await cssProp(page, '.agent-tabs__tab[data-active="false"]', 'color')).toBe(await canonColor(page, 'var(--ink-soft)'));
    expect(parseFloat(await cssProp(page, '.agent-tabs__tab[data-active="true"]', 'border-bottom-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.agent-tabs__tab[data-active="true"]', 'border-bottom-color')).toBe(accent);
    expect(await cssProp(page, '.agent-tabs', 'border-bottom-color')).toBe(rule);
  }, 30_000);

  test('the transcript rows — prompt, assistant, thinking, tool cards and every other kind — match preview §D', async () => {
    await openSession(SESSION_1_ID);
    const mono = await firstFamily(page, '--font-mono');
    const rule = await canonColor(page, 'var(--rule)');
    const inkSoft = await canonColor(page, 'var(--ink-soft)');
    const surface = await canonColor(page, 'var(--surface)');
    const px = (n: string) => tokenPx(page, n);

    // prompt: a "YOU"-style role label (uppercase, mono 12, --accent); the body mono --size-14, loose leading.
    expect(await cssProp(page, '[data-kind="prompt"] .prompt__role', 'text-transform')).toBe('uppercase');
    expect((await cssProp(page, '[data-kind="prompt"] .prompt__role', 'font-family')).toLowerCase()).toContain(mono);
    expect(parseFloat(await cssProp(page, '[data-kind="prompt"] .prompt__role', 'font-size'))).toBeCloseTo(await px('--size-12'), 0);
    expect(await cssProp(page, '[data-kind="prompt"] .prompt__role', 'color')).toBe(await canonColor(page, 'var(--accent)'));
    expect((await cssProp(page, '[data-kind="prompt"] .md', 'font-family')).toLowerCase()).toContain(mono);
    expect(parseFloat(await cssProp(page, '[data-kind="prompt"] .md', 'font-size'))).toBeCloseTo(await px('--size-14'), 0);
    expect(parseFloat(await cssProp(page, '[data-kind="prompt"] .md', 'line-height'))).toBeCloseTo(await tokenLineHeightPx(page, '--size-14', '--leading-loose'), 0);
    expect(await cssProp(page, '[data-kind="assistant"] .assistant__role', 'color')).toBe(inkSoft);
    expect(await cssProp(page, '[data-kind="assistant"] .assistant__role', 'text-transform')).toBe('uppercase');

    // thinking: italic, --ink-soft, a --rule left stroke.
    expect(await cssProp(page, '[data-kind="thinking"] .thinking', 'font-style')).toBe('italic');
    expect(await cssProp(page, '[data-kind="thinking"] .thinking', 'color')).toBe(inkSoft);
    expect(parseFloat(await cssProp(page, '[data-kind="thinking"] .thinking', 'border-left-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '[data-kind="thinking"] .thinking', 'border-left-color')).toBe(rule);

    // tool card: --rule border, --surface ground, --radius-4; header mono --size-13 with a bold name.
    const tool = '[data-kind="tool"][data-state="ok"]';
    expect(await cssProp(page, `${tool} .tool`, 'border-top-color')).toBe(rule);
    expect(parseFloat(await cssProp(page, `${tool} .tool`, 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, `${tool} .tool`, 'background-color')).toBe(surface);
    expect(parseFloat(await cssProp(page, `${tool} .tool`, 'border-top-left-radius'))).toBeCloseTo(await px('--radius-4'), 0);
    expect((await cssProp(page, `${tool} .tool__call`, 'font-family')).toLowerCase()).toContain(mono);
    expect(parseFloat(await cssProp(page, `${tool} .tool__call`, 'font-size'))).toBeCloseTo(await px('--size-13'), 0);
    expect(parseInt(await cssProp(page, `${tool} .tool__name`, 'font-weight'), 10)).toBeGreaterThanOrEqual(600);
    // the head is one row: name, then the outcome to its right.
    const name = await box(page, `${tool} .tool__name`);
    const outcome = await box(page, `${tool} .tool__outcome`);
    expect(outcome.left).toBeGreaterThan(name.right);
    expect(Math.abs(outcome.top - name.top)).toBeLessThanOrEqual(name.height);
    // outcome colour: ok → --live, error → --error, pending → --warn.
    expect(await cssProp(page, `${tool} .tool__outcome`, 'color')).toBe(await canonColor(page, 'var(--live)'));
    expect(await cssProp(page, '[data-kind="tool"][data-state="error"] .tool__outcome', 'color')).toBe(await canonColor(page, 'var(--error)'));
    expect(await cssProp(page, '[data-kind="tool"][data-state="pending"] .tool__outcome', 'color')).toBe(await canonColor(page, 'var(--warn)'));
    // the result body: --surface-raised with a --rule top rule.
    expect(await cssProp(page, `${tool} .tool__result`, 'background-color')).toBe(await canonColor(page, 'var(--surface-raised)'));
    expect(parseFloat(await cssProp(page, `${tool} .tool__result`, 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, `${tool} .tool__result`, 'border-top-color')).toBe(rule);

    // orphan result: a --warn stroke. error card: --error stroke and text.
    expect(parseFloat(await cssProp(page, '.orphan-result', 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.orphan-result', 'border-top-color')).toBe(await canonColor(page, 'var(--warn)'));
    expect(parseFloat(await cssProp(page, '[data-kind="error"] .error', 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '[data-kind="error"] .error', 'border-top-color')).toBe(await canonColor(page, 'var(--error)'));
    expect(await cssProp(page, '[data-kind="error"] .error', 'color')).toBe(await canonColor(page, 'var(--error)'));

    // raw card and unreadable note: --ink-soft mono, bordered.
    for (const sel of ['[data-kind="raw"] .raw', '[data-kind="unreadable"] .unreadable']) {
      expect(await cssProp(page, sel, 'color')).toBe(inkSoft);
      expect((await cssProp(page, sel, 'font-family')).toLowerCase()).toContain(mono);
      expect(parseFloat(await cssProp(page, sel, 'border-top-width'))).toBeGreaterThan(0);
    }

    // chip row chips: the `.tag` shape — mono 12, --rule border, --radius-4.
    expect((await cssProp(page, '[data-kind="chip"] .chip', 'font-family')).toLowerCase()).toContain(mono);
    expect(parseFloat(await cssProp(page, '[data-kind="chip"] .chip', 'font-size'))).toBeCloseTo(await px('--size-12'), 0);
    expect(await cssProp(page, '[data-kind="chip"] .chip', 'border-top-color')).toBe(rule);
    expect(parseFloat(await cssProp(page, '[data-kind="chip"] .chip', 'border-top-width'))).toBeGreaterThan(0);

    // divider: a --rule hairline either side of an --ink-soft label.
    expect(await cssProp(page, '[data-kind="divider"] .divider', 'color')).toBe(inkSoft);
    const hairline = await page.$eval('[data-kind="divider"] .divider', (el) => {
      const cs = getComputedStyle(el, '::before');
      return { w: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), c: cs.borderTopColor };
    });
    expect(hairline.w).toBeGreaterThan(0);
    expect(hairline.c).toBe(rule);
  }, 30_000);

  test('markdown: inline code is mono, a fenced block sits on --surface in a --rule border, links are --accent', async () => {
    await openSession(MD_SESSION_ID);
    const mono = await firstFamily(page, '--font-mono');
    await waitFor(() => page.$$eval('.md pre', (e) => (e.length > 0 ? e.length : null)), 15_000, 'a fenced code block');
    expect((await cssProp(page, '.md > code', 'font-family')).toLowerCase()).toContain(mono);
    expect(await cssProp(page, '.md pre', 'background-color')).toBe(await canonColor(page, 'var(--surface)'));
    expect(parseFloat(await cssProp(page, '.md pre', 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '.md pre', 'border-top-color')).toBe(await canonColor(page, 'var(--rule)'));
    expect((await cssProp(page, '.md pre', 'font-family')).toLowerCase()).toContain(mono);
    expect(await cssProp(page, '.md a', 'color')).toBe(await canonColor(page, 'var(--accent)'));
  }, 30_000);

  test('the follow pill floats over the row list bottom-right, in the .pill shape, once the reader scrolls up', async () => {
    await openSession(SESSION_1_ID);
    const rowsBefore = await box(page, '[data-scroll="rows"]');
    await page.$eval('[data-scroll="rows"]', (el) => {
      (el as HTMLElement).scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => page.$('[data-testid="follow-pill"]'), 10_000, 'the follow pill never appeared after scrolling up');
    const rows = await box(page, '[data-scroll="rows"]');
    const pill = await box(page, '[data-testid="follow-pill"]');
    expect(Math.abs(rows.height - rowsBefore.height)).toBeLessThanOrEqual(1); // over the list, not in the flow
    expect(await cssProp(page, '[data-testid="follow-pill"]', 'position')).toBe('absolute');
    expect(pill.right).toBeLessThanOrEqual(rows.right + 1);
    expect(pill.right).toBeGreaterThan(rows.right - rows.width / 4); // right side
    expect(pill.top).toBeGreaterThan(rows.top + rows.height / 2); // bottom half
    expect(pill.top + pill.height).toBeLessThanOrEqual(rows.top + rows.height + 1);
    expect(await cssProp(page, '[data-testid="follow-pill"]', 'color')).toBe(await canonColor(page, 'var(--accent)'));
    expect(parseFloat(await cssProp(page, '[data-testid="follow-pill"]', 'border-top-width'))).toBeGreaterThan(0);
    expect(await cssProp(page, '[data-testid="follow-pill"]', 'border-top-color')).toBe(await canonColor(page, 'var(--accent)'));
    expect(parseFloat(await cssProp(page, '[data-testid="follow-pill"]', 'border-top-left-radius'))).toBeGreaterThanOrEqual(pill.height / 2);
    expect((await cssProp(page, '[data-testid="follow-pill"]', 'font-family')).toLowerCase()).toContain(await firstFamily(page, '--font-mono'));
  }, 30_000);

  test('buttons are not browser-default: load-earlier and every expander carry a token stroke and show --focus-ring on focus', async () => {
    await openSession(SESSION_4_ID); // truncated history: load-earlier + block-expand buttons
    await waitFor(() => page.$('[data-testid="load-earlier"]'), 15_000, 'load-earlier never rendered');
    const accent = await canonColor(page, 'var(--accent)');
    const focusRing = await canonShadow(page, 'var(--focus-ring)');
    expect(focusRing).not.toBe('none');

    // load earlier: a secondary button — --accent text on --surface-raised with an --accent stroke.
    expect(await cssProp(page, '[data-testid="load-earlier"]', 'color')).toBe(accent);
    expect(await cssProp(page, '[data-testid="load-earlier"]', 'border-top-color')).toBe(accent);
    expect(parseFloat(await cssProp(page, '[data-testid="load-earlier"]', 'border-top-width'))).toBeGreaterThan(0);

    // every button on the page: pointer cursor, a token font (never the browser's system default), and
    // either an --accent stroke or a ghost (transparent) one — never the grey default border.
    const transparent = ['rgba(0, 0, 0, 0)', 'transparent'];
    const buttons = await page.$$eval('button', (els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return { id: el.getAttribute('data-testid') ?? el.className, cursor: cs.cursor, family: cs.fontFamily.toLowerCase(), stroke: cs.borderTopColor };
      }),
    );
    expect(buttons.length).toBeGreaterThan(1);
    const families = [(await firstFamily(page, '--font-mono')), (await firstFamily(page, '--font-sans'))];
    for (const b of buttons) {
      expect(`${b.id}: ${b.cursor}`).toBe(`${b.id}: pointer`);
      expect(families.some((f) => b.family.includes(f))).toBe(true);
      expect(`${b.id}: ${[accent, ...transparent].includes(b.stroke)}`).toBe(`${b.id}: true`);
    }

    // focus-visible (keyboard focus): the token focus ring, not the browser outline.
    for (const sel of ['[data-testid="load-earlier"]', '[data-testid="block-expand"]']) {
      await page.focus(sel);
      expect(await cssProp(page, sel, 'box-shadow')).toBe(focusRing);
    }
  }, 30_000);
});
