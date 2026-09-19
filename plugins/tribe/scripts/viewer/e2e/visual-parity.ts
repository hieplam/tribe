// e2e/visual-parity.ts — V2(b)'s visual-evidence capture tool (a SCRIPT, not a test; named
// without `.test.` so `bun test` never picks it up). Run it to produce the before/after side-by-side
// screenshot set the owner compares against the sea-salt reference (preview.html §C/§D).
//
// EDGE code, outside the D16 wall (same as the rest of `e2e/`): it spawns a real `serve.ts` child,
// drives a real headless Chromium, builds a `mkdtemp` fixture home from nothing (`buildHomeA`), and
// reads `preview.html` over `file://`. The one piece of pure logic — assembling the comparison
// index.html (`renderIndexHtml`) — is exported and unit-tested in `visual-parity.render.test.ts`;
// everything else is proved by running the script itself.
//
// Fails CLOSED (fail-closed-edges): a missing browser or a missing `dist/` refuses with one line and
// a non-zero exit, never a stack trace; every spawned server is killed in `finally`; the optional
// `--session` path starts a SECOND server against the owner's real HOME read-only and never writes.
//
// Usage (from V = plugins/tribe/scripts/viewer):
//   bun run build
//   bun e2e/visual-parity.ts --out ../../../../docs/tribe/planning/viewer-visual-parity/evidence/before
//   bun e2e/visual-parity.ts --out <dir> --session <session-id>   # + the owner's real session
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildHomeA, PROJECT_A_DIR, SESSION_1_ID } from '../fixtures/build.ts';
import { resolveChromiumExecutable } from './browser.ts';

// ---------------------------------------------------------------------------------------------
// PURE CORE — the comparison index.html. No I/O; everything it needs arrives as arguments.
// ---------------------------------------------------------------------------------------------

/** One captured pair: a live screenshot and, when the preview shows the same surface, its
 * reference screenshot. `refPng` is null for a live screen the preview does not depict (e.g. the
 * project page) — the row still renders, saying so, rather than fabricating a reference. */
export interface CaptureRow {
  caption: string;
  livePng: string | null;
  refPng: string | null;
}

/** All the rows captured under one `prefers-color-scheme`. */
export interface SchemeBlock {
  scheme: string;
  rows: CaptureRow[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A minimal, self-contained HTML page laying every scheme's rows out as [live | reference]
 * pairs with captions. Images are referenced RELATIVELY (bare filenames), so the page works from
 * whatever directory it is committed into. This file lives outside `client/`, so the tokens-only
 * literal ban does not apply; it is deliberately plain. */
export function renderIndexHtml(blocks: SchemeBlock[]): string {
  const cell = (png: string | null, absentNote: string): string => {
    if (png === null) return `<td class="cell"><span class="absent">${escapeHtml(absentNote)}</span></td>`;
    return `<td class="cell"><img src="${escapeHtml(png)}" alt=""></td>`;
  };
  const rowHtml = (row: CaptureRow): string =>
    `<tr>` +
    `<th class="caption">${escapeHtml(row.caption)}</th>` +
    cell(row.livePng, 'not captured') +
    cell(row.refPng, 'no preview reference') +
    `</tr>`;
  const blockHtml = (block: SchemeBlock): string =>
    `<h2>${escapeHtml(block.scheme)}</h2>` +
    `<table><thead><tr><th></th><th>live (before)</th><th>preview reference</th></tr></thead>` +
    `<tbody>${block.rows.map(rowHtml).join('')}</tbody></table>`;
  return (
    `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">` +
    `<title>Viewer visual parity — BEFORE</title>` +
    `<style>body{font-family:system-ui,sans-serif;margin:2rem;background:#111;color:#eee}` +
    `table{border-collapse:collapse;margin-bottom:2rem;width:100%}` +
    `th,td{border:1px solid #444;padding:8px;vertical-align:top;text-align:left}` +
    `img{max-width:100%;height:auto;display:block}` +
    `.caption{width:12ch}.absent{color:#888;font-style:italic}</style></head><body>` +
    `<h1>Viewer visual parity — BEFORE (today's unstyled UI vs. the sea-salt reference)</h1>` +
    blocks.map(blockHtml).join('\n') +
    `</body></html>\n`
  );
}

// ---------------------------------------------------------------------------------------------
// EDGE — server lifecycle. Copied from `e2e/dom-kinds.e2e.test.ts` (free port, wait for a healthy
// /healthz, kill in finally) so the script starts the REAL serve.ts exactly as the proofs do.
// ---------------------------------------------------------------------------------------------

const SERVE_TS = join(import.meta.dir, '..', 'serve.ts');
const DIST_INDEX = join(import.meta.dir, '..', 'dist', 'index.html');
// e2e/ -> viewer -> scripts -> tribe -> plugins -> repo root.
const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..', '..');
const PREVIEW_HTML = join(REPO_ROOT, 'docs/tribe/planning/viewer-consolidation/design/sea-salt/preview.html');

const SCHEMES = ['light', 'dark'] as const;

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

// ---------------------------------------------------------------------------------------------
// EDGE — capture helpers.
// ---------------------------------------------------------------------------------------------

/** Full-page screenshot of a live viewer URL, returned as the bare filename it was written under
 * (so the index.html references it relatively). */
async function shootLive(page: Page, base: string, url: string, outDir: string, name: string): Promise<string> {
  await page.goto(`${base}${url}`);
  // Give the React client a moment to render its rows before the shot; a bounded wait, never a
  // fixed sleep that either flakes or wastes time.
  await waitFor(() => page.$eval('body', (b) => ((b.textContent ?? '').trim().length > 0 ? true : null)), 15_000, `${url} never rendered any body text`);
  await sleep(400);
  await page.screenshot({ path: join(outDir, name), fullPage: true });
  return name;
}

/** Element screenshot of one preview `.screen`, selected by the section whose kicker text begins
 * with the given letter (e.g. "c."/"d." — case-insensitive; the preview labels its sections
 * lowercase). The preview page honours `prefers-color-scheme`, so it is captured per scheme too. */
async function shootPreviewScreen(page: Page, letter: string, outDir: string, name: string): Promise<string> {
  await page.goto(`file://${PREVIEW_HTML}`);
  const prefix = letter.toLowerCase();
  const sections = page.locator('section');
  const count = await sections.count();
  for (let i = 0; i < count; i++) {
    const section = sections.nth(i);
    const kicker = ((await section.locator('.kicker').textContent()) ?? '').trim().toLowerCase();
    if (kicker.startsWith(prefix)) {
      await section.locator('.screen').screenshot({ path: join(outDir, name) });
      return name;
    }
  }
  throw new Error(`preview section headed "${letter}" with a .screen never found`);
}

/** The first tool card that carries an expand affordance, clicked. Returns true if one was found
 * and expanded, false if the session has no expandable tool card. */
async function expandFirstToolCard(page: Page): Promise<boolean> {
  const button = page.locator('[data-kind="tool"] button[data-testid^="tool-expand"]').first();
  if ((await button.count()) === 0) return false;
  await button.click();
  await sleep(400);
  return true;
}

// ---------------------------------------------------------------------------------------------
// EDGE — argument parsing. Fails closed (fail-closed-edges obligation 1): a flag whose value is
// missing refuses, and never silently swallows the next flag as its value.
// ---------------------------------------------------------------------------------------------

interface Args {
  outDir: string;
  session: string | null;
}

class ArgError extends Error {}

function parseArgs(argv: string[]): Args {
  let outDir: string | null = null;
  let session: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' || arg === '--session') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new ArgError(`${arg} needs a value`);
      }
      if (arg === '--out') outDir = value;
      else session = value;
      i++;
    } else {
      throw new ArgError(`unknown argument: ${arg}`);
    }
  }
  if (outDir === null) throw new ArgError('--out <dir> is required');
  return { outDir: resolve(outDir), session };
}

// ---------------------------------------------------------------------------------------------
// EDGE — the run.
// ---------------------------------------------------------------------------------------------

async function run(args: Args): Promise<void> {
  if (!existsSync(DIST_INDEX)) {
    throw new ArgError(`no built client at ${DIST_INDEX} — run \`bun run build\` first`);
  }
  const executablePath = resolveChromiumExecutable(); // throws a one-line remedy if missing

  mkdirSync(args.outDir, { recursive: true });
  const homeDir = mkdtempSync(join(tmpdir(), 'vc-visual-parity-'));
  buildHomeA(homeDir);

  let browser: Browser | null = null;
  let viewer: ViewerHandle | null = null;
  let realViewer: ViewerHandle | null = null;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    viewer = await spawnViewer({ CLAUDE_CONFIG_DIR: join(homeDir, 'cfg'), HOME: homeDir });
    const base = `http://127.0.0.1:${viewer.port}`;

    if (args.session !== null) {
      // The owner's real session lives under the real ~/.claude/projects; a second server started
      // against the REAL HOME serves it read-only (the viewer never writes, by construction).
      realViewer = await spawnViewer({});
    }

    const blocks: SchemeBlock[] = [];
    for (const scheme of SCHEMES) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.emulateMedia({ colorScheme: scheme });
      try {
        const rows: CaptureRow[] = [];

        // All LIVE captures first — each `shootPreviewScreen` navigates the page to `file://` for
        // the reference shot, so the session's tool card must be expanded and shot BEFORE we leave
        // the session page for the preview. Reference (preview) shots come last, per scheme.
        const listPng = await shootLive(page, base, '/', args.outDir, `live-list-${scheme}.png`);
        const projectPng = await shootLive(page, base, `/p/${PROJECT_A_DIR}`, args.outDir, `live-project-${scheme}.png`);
        const sessionPng = await shootLive(page, base, `/s/${SESSION_1_ID}`, args.outDir, `live-session-${scheme}.png`);

        let expandedPng: string | null = null;
        if (await expandFirstToolCard(page)) {
          expandedPng = `live-session-expanded-${scheme}.png`;
          await page.screenshot({ path: join(args.outDir, expandedPng), fullPage: true });
        }

        let realPng: string | null = null;
        if (realViewer !== null && args.session !== null) {
          realPng = `real-session-${scheme}.png`;
          await shootLive(page, `http://127.0.0.1:${realViewer.port}`, `/s/${args.session}`, args.outDir, realPng);
        }

        // Reference shots (these navigate the page away from the live server).
        const refC = await shootPreviewScreen(page, 'c.', args.outDir, `ref-c-${scheme}.png`);
        const refD = await shootPreviewScreen(page, 'd.', args.outDir, `ref-d-${scheme}.png`);

        rows.push({ caption: 'Session list', livePng: listPng, refPng: refC });
        rows.push({ caption: 'Project page', livePng: projectPng, refPng: null });
        rows.push({ caption: 'One session', livePng: sessionPng, refPng: refD });
        if (expandedPng !== null) rows.push({ caption: 'One session — tool card expanded', livePng: expandedPng, refPng: refD });
        if (realPng !== null) rows.push({ caption: "Owner's real session", livePng: realPng, refPng: refD });

        blocks.push({ scheme, rows });
      } finally {
        await page.close();
      }
    }

    writeFileSync(join(args.outDir, 'index.html'), renderIndexHtml(blocks));
    console.log(`visual-parity: wrote before-set to ${args.outDir}`);
  } finally {
    await viewer?.stop();
    await realViewer?.stop();
    await browser?.close();
    rmSync(homeDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  run(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
    // Fail closed: one line, never a stack trace, for the two operator-facing refusals (bad args,
    // missing dist, missing browser) and for any runtime failure alike.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`visual-parity: ${message}`);
    process.exit(1);
  });
}
