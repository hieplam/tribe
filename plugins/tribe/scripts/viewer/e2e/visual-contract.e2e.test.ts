// e2e/visual-contract.e2e.test.ts — V2's visual contract for the SESSION-LIST screen (plan
// Task 3), proved in a real browser against the real server. The oracle is preview.html §C: this
// file asserts the COMPUTED styles of the list shell, sidebar, project rows, session rows, the
// campaign badge, the status dots, the filter box and the "show older" link against the RESOLVED
// sea-salt token values — never a hard-coded colour or size, so the assertion tracks the tokens.
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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildHomeB, PROJECT_A_DIR } from '../fixtures/build.ts';
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

describe('visual-contract.e2e — the session-list screen matches preview.html §C (plan Task 3, V2)', () => {
  let homeDir: string;
  let viewer: ViewerHandle;
  // ONE page for the whole suite, navigated with `goto` per test — opening a fresh page/tab per
  // test was observed to destabilise headless Chrome on this machine (dangling tabs on a slow
  // wait, then "browser has been closed"). Tests run sequentially, so a shared page is safe.
  let page: Page;

  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'vc-visual-contract-'));
    buildHomeB(homeDir); // homeA + the .tribe campaign tree, so session-1 carries a badge
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
});
