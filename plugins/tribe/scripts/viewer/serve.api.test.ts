// serve.api.test.ts — boots the REAL `serve.ts` (a genuinely separate process, `bun run serve.ts`,
// never an in-process import — the file's whole point this task is that it must actually BOOT) against
// the task-1 fixture (`fixtures/build.ts`), with `HOME`/`CLAUDE_CONFIG_DIR` pointed at it (D32b): the
// `.claude` side is reached via `CLAUDE_CONFIG_DIR=<root>/cfg`, the production resolution mechanism
// Claude Code itself honours, never a test-only shortcut; `HOME` is faked only for `homeB`'s `.tribe`.
import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEmptyProjectsRoot,
  buildHomeA,
  buildHomeB,
  buildHomeWithoutClaude,
  CAMPAIGN_SLUG,
  PROJECT_A_DIR,
  PROJECT_B_DIR,
  PROJECT_C_DIR,
  REPO_KEY_A,
  REPO_KEY_B,
  SESSION_1_ID,
  SESSION_3_ID,
} from './fixtures/build.ts';

const SERVE_TS = join(import.meta.dir, 'serve.ts');

interface RunningServer {
  port: number;
  stop(): void;
}

function waitForPort(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`server never printed its port; stdout so far: ${buffer}`)), timeoutMs);
    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}); stdout: ${buffer}`));
    });
  });
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

/** Spawns the REAL `serve.ts` as a genuinely separate process (`bun run serve.ts --port 0`), with
 * `env` overriding exactly `HOME`/`CLAUDE_CONFIG_DIR` on top of the current environment (never the
 * whole `.env` — this repo's own toolchain-discipline rule). Waits for its real startup line. */
async function startServer(env: Record<string, string | undefined>): Promise<RunningServer> {
  const child = spawn('bun', ['run', SERVE_TS, '--port', '0'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrBuf = '';
  child.stderr?.on('data', (c) => (stderrBuf += c.toString()));
  const port = await waitForPort(child, 10_000).catch((e) => {
    child.kill('SIGKILL');
    throw new Error(`${e instanceof Error ? e.message : String(e)}; stderr: ${stderrBuf}`);
  });
  const stop = () => child.kill('SIGKILL');
  cleanups.push(stop);
  return { port, stop };
}

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tribe-viewer-serve-api-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown; rawText: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const rawText = await res.text();
  return { status: res.status, body: rawText.length > 0 ? JSON.parse(rawText) : null, rawText };
}

describe('serve.ts — /api/projects, /api/sessions, /api/session/<id> (real server, task-1 fixture)', () => {
  test('a bare HOME with no `.claude` at all: /api/projects is an empty list, HTTP 200, never an error', async () => {
    const root = tmpRoot();
    buildHomeWithoutClaude(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: undefined });
    const { status, body } = await getJson(server.port, '/api/projects');
    expect(status).toBe(200);
    expect(body).toEqual({ projects: [], olderCount: 0, skippedBadges: 0 });
  });

  test('an existing but EMPTY projects root: /api/projects is an empty list, HTTP 200, never an error', async () => {
    const root = tmpRoot();
    buildEmptyProjectsRoot(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, body } = await getJson(server.port, '/api/projects');
    expect(status).toBe(200);
    expect(body).toEqual({ projects: [], olderCount: 0, skippedBadges: 0 });
  });

  test('/api/projects (default, no ?all=1): 2 projects (D10 30-day window), olderCount: 1', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, body } = (await getJson(server.port, '/api/projects')) as {
      status: number;
      body: { projects: Array<{ dir: string }>; olderCount: number; skippedBadges: number };
    };
    expect(status).toBe(200);
    expect(body.projects.map((p) => p.dir).sort()).toEqual([PROJECT_A_DIR, PROJECT_B_DIR].sort());
    expect(body.olderCount).toBe(1);
  });

  test('/api/projects?all=1: 3 projects, olderCount: 0 — the 90-day-old project is included', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, body } = (await getJson(server.port, '/api/projects?all=1')) as {
      status: number;
      body: { projects: Array<{ dir: string }>; olderCount: number };
    };
    expect(status).toBe(200);
    expect(body.projects.map((p) => p.dir).sort()).toEqual([PROJECT_A_DIR, PROJECT_B_DIR, PROJECT_C_DIR].sort());
    expect(body.olderCount).toBe(0);
  });

  test('the 90-day-old project\'s own /api/sessions URL lists ALL of its sessions (D10: sessions are never filtered)', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, body } = (await getJson(server.port, `/api/sessions?project=${PROJECT_C_DIR}`)) as {
      status: number;
      body: { project: { dir: string; sessionCount: number }; sessions: Array<{ id: string }> };
    };
    expect(status).toBe(200);
    expect(body.project.dir).toBe(PROJECT_C_DIR);
    expect(body.project.sessionCount).toBe(1);
    expect(body.sessions.map((s) => s.id)).toEqual([SESSION_3_ID]);
  });

  test('/api/sessions?project=<unknown> is a 404, one-line body', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, rawText } = await getJson(server.port, '/api/sessions?project=totally-unknown-project-dir');
    expect(status).toBe(404);
    expect(rawText.includes('\n')).toBe(false);
  });

  test('/api/session/<unknown id> is a 404 with a one-line body naming the id (spec §5.2\'s exact message)', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const unknownId = 'deadbeef-0000-4000-8000-000000000099';
    const { status, body, rawText } = (await getJson(server.port, `/api/session/${unknownId}`)) as {
      status: number;
      body: { error: string };
      rawText: string;
    };
    expect(status).toBe(404);
    expect(rawText.includes('\n')).toBe(false);
    expect(body.error).toBe(`no session ${unknownId} under ~/.claude/projects`);
  });

  test('/api/session/<id> for a real session returns {session, subagents, badges} with the right shape', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, body } = (await getJson(server.port, `/api/session/${SESSION_1_ID}`)) as {
      status: number;
      body: { session: { id: string; projectDir: string; projects: string[] }; subagents: unknown[]; badges: unknown[] };
    };
    expect(status).toBe(200);
    expect(body.session.id).toBe(SESSION_1_ID);
    expect(body.session.projectDir).toBe(PROJECT_A_DIR);
    expect(body.session.projects).toEqual([PROJECT_A_DIR]); // the ordinary case (spec §5.2)
    expect(Array.isArray(body.subagents)).toBe(true);
    expect(Array.isArray(body.badges)).toBe(true);
    // session-1's fixture subagent tree (task 11): 5 real sidecars (root/child/orphan/cycleA/
    // cycleB) PLUS the sibling-session symlink (task 4/15/30's D14 case) that ALSO lives inside
    // session-1's own subagents/ directory, pointing at session-2's real sidecar — spec §12.2
    // requires this one be ACCEPTED (a real shape Claude Code itself writes), so it counts too.
    expect(body.subagents.length).toBe(6);
  });

  test('a session claimed by two campaigns (homeB\'s fixture) carries BOTH badges on /api/session (spec §9)', async () => {
    const root = tmpRoot();
    buildHomeB(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, body } = (await getJson(server.port, `/api/session/${SESSION_1_ID}`)) as {
      status: number;
      body: { badges: Array<{ repoKey: string; slug: string }> };
    };
    expect(status).toBe(200);
    expect(body.badges.length).toBe(2);
    expect(body.badges.map((b) => b.repoKey).sort()).toEqual([REPO_KEY_A, REPO_KEY_B].sort());
    for (const badge of body.badges) expect(badge.slug).toBe(CAMPAIGN_SLUG);
  });

  test('any path outside the three routes is a flat one-line JSON 404 (this task\'s scope fence — Task 20 owns the shell/healthz/asset table)', async () => {
    const root = tmpRoot();
    buildHomeA(root);
    const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
    const { status, rawText } = await getJson(server.port, '/nonsense');
    expect(status).toBe(404);
    expect(rawText.includes('\n')).toBe(false);
  });
});
