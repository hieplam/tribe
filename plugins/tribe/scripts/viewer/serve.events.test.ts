// serve.events.test.ts — Task 19's HTTP integration proof for `GET /events` (spec §3.2, §6.2;
// D12). Boots the REAL `serve.ts` as a separate process (the pattern serve.reads.test.ts /
// serve.api.test.ts established) against a small hand-built session fixture on disk
// (`fixtures-mirror-reality.md`: real bytes, not a mock), then connects a real SSE client over
// `fetch` and reads the wire frames.
//
// D12 is what these prove end-to-end: a reconnect is a FRESH snapshot — the server ignores the
// browser's `Last-Event-ID`, mints a NEW `generation`, and rebuilds pairing from the file, so a
// tool_use/tool_result pair arrives already paired rather than as an orphan. Plus the §6.2 stream
// cap: the 9th concurrent stream gets 503, and a closed connection releases its slot.
import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVE_TS = join(import.meta.dir, 'serve.ts');

// A clean paired-tool session: a text row, a tool_use, its matching tool_result, a closing text
// row — all inside the default window, so on connect the forward pass pairs the call with its
// result and the tool card is delivered already complete (state "ok"), with no orphan_result.
const PAIRED_SESSION_ID = 'feedface-2222-4000-8000-000000000001';
const PAIRED_PROJECT_DIR = '-Users-fixture-repo-events';
const PAIRED_TOOL_USE_ID = 'toolu_events_paired';

function buildPairedFixture(root: string): void {
  const rows: unknown[] = [
    { type: 'assistant', uuid: 'ev-1', timestamp: 't0', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'before the call' }] } },
    { type: 'assistant', uuid: 'ev-2', timestamp: 't1', message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: PAIRED_TOOL_USE_ID, name: 'Bash', input: { command: 'echo hi' } }] } },
    { type: 'user', uuid: 'ev-3', timestamp: 't2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: PAIRED_TOOL_USE_ID, content: 'hi', is_error: false }] } },
    { type: 'assistant', uuid: 'ev-4', timestamp: 't3', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'after the result' }] } },
  ];
  const dir = join(root, 'cfg', 'projects', PAIRED_PROJECT_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${PAIRED_SESSION_ID}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ---------------------------------------------------------------------------------------------
// Server lifecycle (the serve.reads.test.ts pattern).
// ---------------------------------------------------------------------------------------------
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

/** A real OS-assigned free port on `127.0.0.1`, released immediately before the real server binds
 * it. Task 20's `serve.ts` now REFUSES `--port 0` (spec §13), so this replaces the `--port 0`
 * shortcut this helper used before that validation existed — same test intent, same assertions. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not determine a free port'));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(env: Record<string, string | undefined>): Promise<RunningServer> {
  const freePort = await getFreePort();
  const child = spawn('bun', ['run', SERVE_TS, '--port', String(freePort)], {
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
  const dir = mkdtempSync(join(tmpdir(), 'tribe-viewer-events-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function startFixtureServer(): Promise<RunningServer> {
  const root = tmpRoot();
  buildPairedFixture(root);
  return startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
}

// ---------------------------------------------------------------------------------------------
// A minimal SSE client over fetch: reads frames until `count` are seen or a timeout, then the
// caller aborts to close the connection (releasing the server's stream slot).
// ---------------------------------------------------------------------------------------------
interface WireFrame {
  event: string;
  id: number;
  data: Record<string, unknown>;
}

function parseRecord(record: string): WireFrame {
  const lines = record.split('\n');
  const event = lines.find((l) => l.startsWith('event: '))!.slice('event: '.length);
  const id = Number(lines.find((l) => l.startsWith('id: '))!.slice('id: '.length));
  const dataLine = lines.find((l) => l.startsWith('data: '))!.slice('data: '.length);
  return { event, id, data: JSON.parse(dataLine) as Record<string, unknown> };
}

interface OpenConnection {
  status: number;
  frames: WireFrame[];
  close(): void;
}

async function openStream(
  port: number,
  path: string,
  wantFrames: number,
  headers: Record<string, string> = {},
): Promise<OpenConnection> {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal, headers });
  const close = () => controller.abort();
  cleanups.push(close);
  if (res.status !== 200) {
    // A refusal (503, 404, 400) has a non-stream body; drain it so the socket is released.
    await res.text().catch(() => undefined);
    return { status: res.status, frames: [], close };
  }
  const frames: WireFrame[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + 5000;
  while (frames.length < wantFrames && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const record = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (record.trim().length > 0) frames.push(parseRecord(record));
    }
  }
  reader.releaseLock();
  return { status: res.status, frames, close };
}

const EVENTS = `/events?session=${PAIRED_SESSION_ID}`;

describe('GET /events — hello then rows (spec §6.2)', () => {
  test('a real connection receives `hello` (generation + window bounds) followed by `rows`, and the tool pair arrives ALREADY PAIRED, not as an orphan (D12)', async () => {
    const server = await startFixtureServer();
    const conn = await openStream(server.port, EVENTS, 2);
    conn.close();

    expect(conn.status).toBe(200);
    expect(conn.frames[0]!.event).toBe('hello');
    expect(typeof conn.frames[0]!.data.generation).toBe('string');
    expect(typeof conn.frames[0]!.data.from).toBe('number');
    expect(typeof conn.frames[0]!.data.to).toBe('number');
    expect(conn.frames[0]!.id).toBe(1);

    const rows = conn.frames.filter((f) => f.event === 'rows');
    expect(rows.length).toBeGreaterThan(0);
    const nodes = rows.flatMap((f) => f.data.nodes as Array<{ k: string; state?: string; toolUseId?: string }>);
    const tool = nodes.find((n) => n.k === 'tool');
    expect(tool).toBeDefined();
    expect(tool!.state).toBe('ok'); // paired in-window, not pending
    expect(nodes.some((n) => n.k === 'orphan_result')).toBe(false); // never an orphan
  });
});

describe('GET /events — reconnect is a fresh snapshot (D12)', () => {
  test('the server IGNORES `Last-Event-ID` and replies with a NEW generation plus the current window', async () => {
    const server = await startFixtureServer();

    const first = await openStream(server.port, EVENTS, 2);
    const gen1 = first.frames[0]!.data.generation as string;
    first.close();

    // The browser sends the last id it saw; the server must discard it and still send hello+window.
    const second = await openStream(server.port, EVENTS, 2, { 'Last-Event-ID': '999' });
    const gen2 = second.frames[0]!.data.generation as string;
    second.close();

    expect(second.frames[0]!.event).toBe('hello');
    expect(second.frames[0]!.id).toBe(1); // a fresh sequence, never resumed from 999
    expect(gen2).not.toBe(gen1); // a fresh generation per connection
    // The pair is re-paired from the file: still already-paired, still no orphan.
    const nodes = second.frames.filter((f) => f.event === 'rows').flatMap((f) => f.data.nodes as Array<{ k: string; state?: string }>);
    expect(nodes.find((n) => n.k === 'tool')!.state).toBe('ok');
    expect(nodes.some((n) => n.k === 'orphan_result')).toBe(false);
  });
});

describe('GET /events — the §6.2 stream cap of 8', () => {
  test('the 9th concurrent stream gets 503 with the body "too many live streams"', async () => {
    const server = await startFixtureServer();

    const held: OpenConnection[] = [];
    for (let i = 0; i < 8; i++) {
      const conn = await openStream(server.port, EVENTS, 1); // read hello to guarantee the slot is live
      expect(conn.status).toBe(200);
      held.push(conn);
    }

    const ninth = await fetch(`http://127.0.0.1:${server.port}${EVENTS}`);
    const body = await ninth.text();
    expect(ninth.status).toBe(503);
    expect(body).toBe('too many live streams');

    for (const c of held) c.close();
  });

  test('closing a connection releases its slot — proven by opening, closing and reopening 9 times', async () => {
    const server = await startFixtureServer();

    for (let i = 0; i < 9; i++) {
      const conn = await openStream(server.port, EVENTS, 1);
      expect(conn.status).toBe(200); // if a closed connection leaked its slot, iteration 9 would 503
      expect(conn.frames[0]!.event).toBe('hello');
      conn.close();
      // Give the server's stream cancel a moment to fire before the next open.
      await new Promise((r) => setTimeout(r, 60));
    }
  });
});
