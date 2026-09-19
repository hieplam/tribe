// e2e/navigation.e2e.test.ts — a person can click their way from the list to a session's detail.
//
// The shape a real user produces: open `/`, click a project in the left sidebar, click a session in
// the list, read the transcript; then press Back. Every step is a real mouse click in a real
// headless Chromium against the real `serve.ts` — no `page.goto` to a deep link, because a deep link
// is exactly the path that kept working while every click did nothing.
//
// Test data (fixtures-mirror-reality.md): a sandbox `HOME` built from nothing, holding copies of two
// REAL transcripts from this machine's `~/.claude/projects` — the corpus shape, not a hand-authored
// row. Root resolution is the production default (`CLAUDE_CONFIG_DIR` unset, `HOME` = the sandbox),
// so the viewer reads `<sandbox>/.claude/projects` exactly as it reads a user's own home. The real
// corpus is only read, never written; the sandbox is removed in `afterAll`.
//
// Fail-closed, never skip: no Chromium or no pair of copyable transcripts throws in `beforeAll`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { resolveChromiumExecutable } from './browser.ts';

const SERVE_TS = join(import.meta.dir, '..', 'serve.ts');
const REAL_PROJECTS_ROOT = join(homedir(), '.claude', 'projects');

// Small enough to render fast, large enough to hold a real conversation.
const MIN_TRANSCRIPT_BYTES = 20 * 1024;
const MAX_TRANSCRIPT_BYTES = 1024 * 1024;
const SESSION_FILE = /^[0-9a-fA-F-]{8,64}\.jsonl$/;

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

interface TranscriptPick {
  projectDir: string;
  sessionIds: [string, string];
}

/** The first real project (sorted by name) holding two top-level transcripts inside the size band,
 * and the two smallest of them. Deterministic on a given machine; throws, never skips, when the
 * corpus has no such pair. */
function pickRealTranscripts(): TranscriptPick {
  const projectDirs = readdirSync(REAL_PROJECTS_ROOT).sort();
  for (const projectDir of projectDirs) {
    const dirPath = join(REAL_PROJECTS_ROOT, projectDir);
    if (!statSync(dirPath).isDirectory()) continue;
    const candidates = readdirSync(dirPath)
      .filter((name) => SESSION_FILE.test(name))
      .map((name) => ({ name, size: statSync(join(dirPath, name)).size }))
      .filter((f) => f.size >= MIN_TRANSCRIPT_BYTES && f.size <= MAX_TRANSCRIPT_BYTES)
      .sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
    if (candidates.length >= 2) {
      const ids = candidates.slice(0, 2).map((f) => f.name.replace(/\.jsonl$/, ''));
      return { projectDir, sessionIds: [ids[0]!, ids[1]!] };
    }
  }
  throw new Error(`no project under ${REAL_PROJECTS_ROOT} holds two transcripts of ${MIN_TRANSCRIPT_BYTES}-${MAX_TRANSCRIPT_BYTES} B to copy`);
}

/** A sandbox `HOME` with `.claude/projects/<projectDir>/` holding copies of the picked transcripts
 * and nothing else — no `.tribe`, no subagent sidecars. */
function buildSandboxHome(pick: TranscriptPick): string {
  const home = mkdtempSync(join(tmpdir(), 'viewer-nav-home-'));
  const projectPath = join(home, '.claude', 'projects', pick.projectDir);
  mkdirSync(projectPath, { recursive: true });
  for (const id of pick.sessionIds) {
    copyFileSync(join(REAL_PROJECTS_ROOT, pick.projectDir, `${id}.jsonl`), join(projectPath, `${id}.jsonl`));
  }
  return home;
}

interface ViewerHandle {
  port: number;
  stop(): Promise<void>;
}

async function spawnViewer(home: string): Promise<ViewerHandle> {
  const port = findFreePort();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'CLAUDE_CONFIG_DIR') env[k] = v;
  }
  env.HOME = home;
  const proc: ChildProcess = spawn('bun', [SERVE_TS, '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
        return res.ok ? true : null;
      } catch {
        return null;
      }
    },
    20_000,
    `viewer on port ${port} never answered /healthz`,
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

let pick: TranscriptPick;
let home: string;
let viewer: ViewerHandle;
let browser: Browser;

beforeAll(async () => {
  const executablePath = resolveChromiumExecutable();
  pick = pickRealTranscripts();
  home = buildSandboxHome(pick);
  viewer = await spawnViewer(home);
  browser = await chromium.launch({ executablePath, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await viewer?.stop();
  if (home) rmSync(home, { recursive: true, force: true });
});

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/** The session detail is on screen: its header, and at least one transcript row from `/events`. */
async function expectSessionDetail(page: Page): Promise<void> {
  await page.waitForSelector('.session-view .session-header', { timeout: 10_000 });
  await page.waitForSelector('.session-view .rows .row', { timeout: 15_000 });
}

describe('navigation — click from the list to a session and back', () => {
  test('sidebar project click → session list → session click → detail → Back', async () => {
    const page = await browser.newPage();
    try {
      const base = `http://127.0.0.1:${viewer.port}`;
      await page.goto(`${base}/`);

      // Left pane: the one sandbox project.
      const projectRow = page.locator('.sidebar .project-row').first();
      await projectRow.waitFor({ timeout: 10_000 });
      await projectRow.click();
      await waitFor(() => (pathOf(page) === `/p/${encodeURIComponent(pick.projectDir)}` ? true : null), 5_000, 'URL after project click');
      await waitFor(async () => ((await page.locator('.session-list .session-row').count()) === 2 ? true : null), 10_000, 'two session rows for the project');

      // Main pane: click the first picked session by its short id.
      const [target] = pick.sessionIds;
      const sessionRow = page.locator('.session-list .session-row', { hasText: target.slice(0, 8) });
      await sessionRow.click();
      await waitFor(() => (pathOf(page) === `/s/${target}` ? true : null), 5_000, 'URL after session click');
      await expectSessionDetail(page);

      // Browser Back returns to the project's list.
      await page.goBack();
      await waitFor(() => (pathOf(page) === `/p/${encodeURIComponent(pick.projectDir)}` ? true : null), 5_000, 'URL after Back');
      await page.locator('.session-list .session-row').first().waitFor({ timeout: 10_000 });
    } finally {
      await page.close();
    }
  }, 60_000);

  test('a session row on the aggregate `/` list opens that session', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${viewer.port}/`);
      const [, second] = pick.sessionIds;
      const sessionRow = page.locator('.session-list .session-row', { hasText: second.slice(0, 8) });
      await sessionRow.waitFor({ timeout: 10_000 });
      await sessionRow.click();
      await waitFor(() => (pathOf(page) === `/s/${second}` ? true : null), 5_000, 'URL after session click');
      await expectSessionDetail(page);
    } finally {
      await page.close();
    }
  }, 60_000);

  // The whole row highlights on hover, so a person clicks anywhere on it — not only on the title
  // text. Each point below is inside the row's padding, outside every text span.
  test('clicking anywhere on a session row in the project list opens that session', async () => {
    const page = await browser.newPage();
    try {
      const projectPath = `/p/${encodeURIComponent(pick.projectDir)}`;
      await page.goto(`http://127.0.0.1:${viewer.port}${projectPath}`);
      const [target] = pick.sessionIds;
      const sessionRow = page.locator('.session-list .session-row', { hasText: target.slice(0, 8) });
      await sessionRow.waitFor({ timeout: 10_000 });

      const box = await sessionRow.boundingBox();
      if (box === null) throw new Error('session row has no bounding box');
      const edgePoints = [
        { name: 'top-left corner', x: box.x + 4, y: box.y + 4 },
        { name: 'bottom-right corner', x: box.x + box.width - 4, y: box.y + box.height - 4 },
      ];
      for (const point of edgePoints) {
        await page.mouse.click(point.x, point.y);
        await waitFor(() => (pathOf(page) === `/s/${target}` ? true : null), 5_000, `URL after clicking the row's ${point.name}`);
        await expectSessionDetail(page);
        await page.goBack();
        await waitFor(() => (pathOf(page) === projectPath ? true : null), 5_000, 'URL after Back');
        await sessionRow.waitFor({ timeout: 10_000 });
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  test('a session row is a real link, so a modified click can open it in a new tab', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${viewer.port}/`);
      const [target] = pick.sessionIds;
      const link = page.locator('.session-list .session-row a', { hasText: target.slice(0, 8) });
      await link.waitFor({ timeout: 10_000 });
      expect(await link.getAttribute('href')).toBe(`/s/${target}`);
      const projectLink = page.locator('.sidebar a.project-row').first();
      expect(await projectLink.getAttribute('href')).toBe(`/p/${encodeURIComponent(pick.projectDir)}`);
    } finally {
      await page.close();
    }
  }, 30_000);
});
