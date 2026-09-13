// serve.reads.test.ts — task 18's HTTP integration proof for `/api/rows`, `/api/block`,
// `/api/spill` (spec §3.2, §6.3, §7.6). Boots the REAL `serve.ts` as a genuinely separate process
// (the same pattern `serve.api.test.ts` established), against the task-1 fixture PLUS a small,
// hand-built session file this task plants itself for the scenarios the shared fixture cannot
// express (D27's orphans wire operation; a uuid-less, extra-content attachment row) —
// `core/window.test.ts` is the unit proof of `findWindow` itself; this file is the integration
// proof that `serve.ts` composes it correctly, end to end, over real bytes on disk.
import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHomeA, PROJECT_A_DIR, SESSION_1_ID, SESSION_4_ID, SPILL_FILE_NAME } from './fixtures/build.ts';

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
  const dir = mkdtempSync(join(tmpdir(), 'tribe-viewer-serve-reads-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown; rawText: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const rawText = await res.text();
  return { status: res.status, body: rawText.length > 0 ? JSON.parse(rawText) : null, rawText };
}

async function getText(port: number, path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, text: await res.text() };
}

interface RowAnchorLike { id: string; at: number; i: number; uuid: string | null; k: string }
interface RowsResponse { nodes: RowAnchorLike[]; patches: Array<{ op: string; id: string; node?: unknown }>; from: number; to: number; truncatedBefore: boolean }

// ---------------------------------------------------------------------------------------------
// A small, hand-built session file this task plants itself (`fixtures-mirror-reality.md`: a real
// file on disk, not a mock) — for the two scenarios the shared task-1 fixture cannot express:
// D27's orphans wire operation (a call and its result separated by enough filler rows that a
// small-limit back-fill reaches one without the other), and a uuid-less attachment row carrying
// EXTRA content beyond `rendered` (so it is genuinely `expandable`, proving the `at`+`i` addressing
// choice rather than coincidentally matching a row that also happens to carry a uuid).
// ---------------------------------------------------------------------------------------------
const BLOCK_SESSION_ID = 'deadbeef-1111-4000-8000-000000000001';
const BLOCK_PROJECT_DIR = '-Users-fixture-repo-blocktest';
const ORPHAN_TOOL_USE_ID = 'toolu_serve_reads_orphan';

function buildBlockAndOrphanFixture(root: string): void {
  const rows: unknown[] = [];
  // row0: a tool_use call with a moderately-sized, structured input — the "valid at+i returns the
  // full (untruncated) payload" proof.
  rows.push({
    type: 'assistant', uuid: 'blk-1', timestamp: 't0',
    message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_block_test', name: 'Write', input: { path: '/tmp/x', detail: 'y'.repeat(200) } }] },
  });
  // row1: an attachment row with NO uuid field at all, and content BEYOND `rendered` (so
  // `expandable: true`) — the uuid-less-expansion proof.
  rows.push({ type: 'attachment', timestamp: 't1', attachment: { type: 'custom-thing', extra: { a: 1, b: 2 } } });
  // row2: the orphan's CALL.
  rows.push({
    type: 'assistant', uuid: 'blk-2', timestamp: 't2',
    message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: ORPHAN_TOOL_USE_ID, name: 'Bash', input: { command: 'true' } }] },
  });
  // rows3-10: 8 single-candidate filler rows.
  for (let i = 0; i < 8; i++) {
    rows.push({ type: 'assistant', uuid: `blk-filler-${i}`, timestamp: `t3-${i}`, message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: `filler ${i}` }] } });
  }
  // row11: the orphan's RESULT — the last row in the file.
  rows.push({
    type: 'user', uuid: 'blk-3', timestamp: 't11',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: ORPHAN_TOOL_USE_ID, content: 'orphan result text', is_error: false }] },
  });

  const content = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const path = join(root, 'cfg', 'projects', BLOCK_PROJECT_DIR, `${BLOCK_SESSION_ID}.jsonl`);
  mkdirSync(join(root, 'cfg', 'projects', BLOCK_PROJECT_DIR), { recursive: true });
  writeFileSync(path, content);
}

async function startFullFixtureServer(): Promise<{ server: RunningServer; root: string }> {
  const root = tmpRoot();
  buildHomeA(root);
  buildBlockAndOrphanFixture(root);
  const server = await startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
  return { server, root };
}

// ---------------------------------------------------------------------------------------------
// /api/rows — the tail window, back-fill contiguity, the clamp, and D27's orphans/patches.
// ---------------------------------------------------------------------------------------------

describe('/api/rows — tail window, back-fill, limit (spec §3.2, §6.3)', () => {
  test('omitting `before` returns the TAIL window: from/to/truncatedBefore are present and the window holds >= the default 500 candidates worth of nodes', async () => {
    const { server } = await startFullFixtureServer();
    const { status, body } = (await getJson(server.port, `/api/rows?session=${SESSION_4_ID}`)) as { status: number; body: RowsResponse };
    expect(status).toBe(200);
    expect(body.truncatedBefore).toBe(true); // 2,400-row session-4, default limit 500
    expect(typeof body.from).toBe('number');
    expect(typeof body.to).toBe('number');
    expect(body.nodes.length).toBeGreaterThanOrEqual(500);
    expect(body.patches).toEqual([]);
  });

  test('a larger-than-max `limit` is CLAMPED to 2,000, never refused', async () => {
    const { server } = await startFullFixtureServer();
    // session-4 carries 2,600 pre-pairing candidates total (D22). Clamped to 2,000, the window
    // still cannot hold the whole file — truncatedBefore stays true. An UNCLAMPED 99999 would fit
    // the entire file (2,600 < 99999) and report truncatedBefore: false — the observable
    // difference between "clamped" and "refused/unclamped".
    const { status, body } = (await getJson(server.port, `/api/rows?session=${SESSION_4_ID}&limit=99999`)) as { status: number; body: RowsResponse };
    expect(status).toBe(200);
    expect(body.truncatedBefore).toBe(true);
  });

  test('`from` round-trips as the next `before` with no row lost at the seam', async () => {
    const { server } = await startFullFixtureServer();
    const tail = (await getJson(server.port, `/api/rows?session=${SESSION_4_ID}&limit=500`)).body as RowsResponse;
    const before = (await getJson(server.port, `/api/rows?session=${SESSION_4_ID}&before=${tail.from}&limit=500`)).body as RowsResponse;
    expect(before.to).toBe(tail.from); // contiguous: the earlier window ends exactly where the later one begins
  });

  test('a `before` past EOF is refused with 400', async () => {
    const { server } = await startFullFixtureServer();
    const { status } = await getJson(server.port, `/api/rows?session=${SESSION_4_ID}&before=999999999`);
    expect(status).toBe(400);
  });

  test('a negative `before` is refused with 400', async () => {
    const { server } = await startFullFixtureServer();
    const { status } = await getJson(server.port, `/api/rows?session=${SESSION_4_ID}&before=-1`);
    expect(status).toBe(400);
  });

  describe('orphans= / patches (D27)', () => {
    test('call-in-range: yields a `remove` patch for the orphan\'s own row-anchor id, and a tool node at the CALL\'s anchor arrives in `nodes`', async () => {
      const { server } = await startFullFixtureServer();
      // 1) The tail window (limit=1) holds only the RESULT row — an orphan_result, since its call
      //    (row2) is not in range.
      const tail = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=1`)).body as RowsResponse;
      const orphanNode = tail.nodes.find((n) => n.k === 'orphan_result');
      expect(orphanNode).toBeDefined();

      // 2) "Load earlier" with `orphans=<toolUseId>` (plus one the client never held) — the call
      //    is in the returned range this time.
      const back = (await getJson(
        server.port,
        `/api/rows?session=${BLOCK_SESSION_ID}&before=${tail.from}&limit=9&orphans=${ORPHAN_TOOL_USE_ID},toolu_never_held`,
      )).body as RowsResponse;

      const callNode = back.nodes.find((n) => n.k === 'tool');
      expect(callNode).toBeDefined();
      expect(back.patches).toEqual([{ op: 'remove', id: orphanNode!.id }]);
    });

    test('call-further-back: with a limit too small to reach the call, no patch is emitted and the orphan is untouched', async () => {
      const { server } = await startFullFixtureServer();
      const tail = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=1`)).body as RowsResponse;
      const back = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&before=${tail.from}&limit=1&orphans=${ORPHAN_TOOL_USE_ID}`)).body as RowsResponse;
      expect(back.patches).toEqual([]);
      expect(back.nodes.some((n) => n.k === 'tool')).toBe(false);
    });

    test('absent orphans yields patches: []', async () => {
      const { server } = await startFullFixtureServer();
      const { body } = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=1`)) as { body: RowsResponse };
      expect(body.patches).toEqual([]);
    });

    test('empty orphans= yields patches: []', async () => {
      const { server } = await startFullFixtureServer();
      const { body } = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=1&orphans=`)) as { body: RowsResponse };
      expect(body.patches).toEqual([]);
    });

    test('an id the client never held is ignored, not an error', async () => {
      const { server } = await startFullFixtureServer();
      const tail = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=1`)).body as RowsResponse;
      const { status, body } = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&before=${tail.from}&limit=9&orphans=toolu_totally_unknown`)) as {
        status: number;
        body: RowsResponse;
      };
      expect(status).toBe(200);
      expect(body.patches).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// /api/block — addressed by `at` + `i`, never a uuid (spec §3.2, §4, §7.3).
// ---------------------------------------------------------------------------------------------

describe('/api/block — at + i, never uuid', () => {
  test('a valid at+i returns the full (untruncated) payload', async () => {
    const { server } = await startFullFixtureServer();
    const rows = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=100`)).body as RowsResponse;
    const callNode = rows.nodes.find((n) => n.k === 'tool') as (RowAnchorLike & { call: { at: number; i: number } }) | undefined;
    expect(callNode).toBeDefined();
    const { status, body } = (await getJson(server.port, `/api/block?session=${BLOCK_SESSION_ID}&at=${callNode!.call.at}&i=${callNode!.call.i}`)) as {
      status: number;
      body: { block: { type: string; id: string; input: { path: string; detail: string } } };
    };
    expect(status).toBe(200);
    expect(body.block.input.detail).toBe('y'.repeat(200)); // the FULL input, never elided
  });

  test('an `at` that is not a row boundary 404s', async () => {
    const { server } = await startFullFixtureServer();
    const rows = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=100`)).body as RowsResponse;
    const callNode = rows.nodes.find((n) => n.k === 'tool') as (RowAnchorLike & { call: { at: number; i: number } }) | undefined;
    const { status } = await getJson(server.port, `/api/block?session=${BLOCK_SESSION_ID}&at=${callNode!.call.at + 3}&i=0`);
    expect(status).toBe(404);
  });

  test('an `i` past the row\'s block count 404s', async () => {
    const { server } = await startFullFixtureServer();
    const rows = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=100`)).body as RowsResponse;
    const callNode = rows.nodes.find((n) => n.k === 'tool') as (RowAnchorLike & { call: { at: number; i: number } }) | undefined;
    const { status } = await getJson(server.port, `/api/block?session=${BLOCK_SESSION_ID}&at=${callNode!.call.at}&i=7`);
    expect(status).toBe(404);
  });

  test('an attachment row with NO uuid expands successfully — the case that proves the addressing choice', async () => {
    const { server } = await startFullFixtureServer();
    const rows = (await getJson(server.port, `/api/rows?session=${BLOCK_SESSION_ID}&limit=100`)).body as RowsResponse;
    const attachmentNode = rows.nodes.find((n) => n.k === 'attachment');
    expect(attachmentNode).toBeDefined();
    expect(attachmentNode!.uuid).toBeNull(); // genuinely uuid-less, not merely untested
    const { status, body } = (await getJson(server.port, `/api/block?session=${BLOCK_SESSION_ID}&at=${attachmentNode!.at}&i=${attachmentNode!.i}`)) as {
      status: number;
      body: { block: { type: string; extra: { a: number; b: number } } };
    };
    expect(status).toBe(200);
    expect(body.block.extra).toEqual({ a: 1, b: 2 });
  });
});

// ---------------------------------------------------------------------------------------------
// C1 — subagents-directory / sidecar containment (D14, fail-closed obligation 4): a symlinked
// `<session>/subagents` (or a symlink LOOP) must never be listed or read THROUGH — its outside
// content never surfaces, and a loop never throws a traceback through the HTTP handler.
// ---------------------------------------------------------------------------------------------
const ESCAPE_SESSION_ID = 'cabba9e5-1111-4000-8000-000000000001';
const LOOP_SESSION_ID = 'cabba9e5-2222-4000-8000-000000000002';
const CONTAINMENT_PROJECT_DIR = '-Users-fixture-repo-containment';
const OUTSIDE_LEAK_MARKER = 'OUTSIDE-SUBAGENT-LEAK-MARKER';

function buildSubagentContainmentFixture(root: string): void {
  const projectDir = join(root, 'cfg', 'projects', CONTAINMENT_PROJECT_DIR);
  mkdirSync(projectDir, { recursive: true });

  const transcript = (id: string): string =>
    JSON.stringify({ type: 'assistant', uuid: `${id}-r1`, timestamp: 't0', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'hello' }] } }) + '\n';

  // Session 1: its `<session>/subagents` is a symlink to an OUTSIDE directory (outside cfg/projects,
  // inside the fixture root) that holds a real-looking agent sidecar with a recognizable marker.
  writeFileSync(join(projectDir, `${ESCAPE_SESSION_ID}.jsonl`), transcript(ESCAPE_SESSION_ID));
  const outsideSubagents = join(root, 'outside-subagents');
  mkdirSync(outsideSubagents, { recursive: true });
  writeFileSync(join(outsideSubagents, 'agent-leak.jsonl'), transcript('leak'));
  writeFileSync(join(outsideSubagents, 'agent-leak.meta.json'), JSON.stringify({ label: OUTSIDE_LEAK_MARKER, agentType: OUTSIDE_LEAK_MARKER }));
  const escapeSessionDir = join(projectDir, ESCAPE_SESSION_ID);
  mkdirSync(escapeSessionDir, { recursive: true });
  symlinkSync(outsideSubagents, join(escapeSessionDir, 'subagents'));

  // Session 2: its `<session>/subagents` is a self-referential symlink LOOP — resolving it raises
  // ELOOP. The request must degrade to an empty subagents list, never a thrown traceback.
  writeFileSync(join(projectDir, `${LOOP_SESSION_ID}.jsonl`), transcript(LOOP_SESSION_ID));
  const loopSessionDir = join(projectDir, LOOP_SESSION_ID);
  mkdirSync(loopSessionDir, { recursive: true });
  symlinkSync('subagents', join(loopSessionDir, 'subagents')); // relative self-link -> ELOOP
}

async function startContainmentServer(): Promise<RunningServer> {
  const root = tmpRoot();
  buildHomeA(root);
  buildSubagentContainmentFixture(root);
  return startServer({ HOME: root, CLAUDE_CONFIG_DIR: join(root, 'cfg') });
}

describe('C1 — a symlinked <session>/subagents directory or sidecar is contained before it is read', () => {
  test('an escaping subagents symlink: subagentCount is 0, subagents is [], and no outside content surfaces', async () => {
    const server = await startContainmentServer();
    const { status, body, rawText } = await getJson(server.port, `/api/session/${ESCAPE_SESSION_ID}`);
    expect(status).toBe(200);
    const b = body as { session: { subagentCount: number }; subagents: unknown[] };
    expect(b.session.subagentCount).toBe(0); // the out-of-root agent-leak.jsonl is never counted
    expect(b.subagents).toEqual([]); // and its sidecar is never read
    expect(rawText).not.toContain(OUTSIDE_LEAK_MARKER); // the outside meta content never leaks out
  });

  test('a symlink LOOP under the session dir: the request returns 200 with an empty subagents list, NOT a thrown ELOOP (fail-closed)', async () => {
    const server = await startContainmentServer();
    const { status, body } = await getJson(server.port, `/api/session/${LOOP_SESSION_ID}`);
    expect(status).toBe(200); // never a 500 crash from a rethrown ELOOP
    const b = body as { session: { subagentCount: number }; subagents: unknown[] };
    expect(b.session.subagentCount).toBe(0);
    expect(b.subagents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// /api/spill — a contained, capped read (spec §3.2, §7.6, D14).
// ---------------------------------------------------------------------------------------------

describe('/api/spill — contained, capped (spec §7.6)', () => {
  test('returns the fixture\'s real spill file', async () => {
    const { server } = await startFullFixtureServer();
    const { status, text } = await getText(server.port, `/api/spill?session=${SESSION_1_ID}&name=${SPILL_FILE_NAME}`);
    expect(status).toBe(200);
    expect(text).toContain('fixture spill preview');
  });

  test('refuses a name with a slash (400 — routes.ts\'s own charset gate)', async () => {
    const { server } = await startFullFixtureServer();
    const { status } = await getJson(server.port, `/api/spill?session=${SESSION_1_ID}&name=sub/dir.txt`);
    expect(status).toBe(400);
  });

  test('refuses `../etc/passwd` (400)', async () => {
    const { server } = await startFullFixtureServer();
    const { status } = await getJson(server.port, `/api/spill?session=${SESSION_1_ID}&name=${encodeURIComponent('../etc/passwd')}`);
    expect(status).toBe(400);
  });

  test('refuses a name failing the charset (400)', async () => {
    const { server } = await startFullFixtureServer();
    const { status } = await getJson(server.port, `/api/spill?session=${SESSION_1_ID}&name=${encodeURIComponent('bad name!!!')}`);
    expect(status).toBe(400);
  });

  test('a shape-valid name that resolves OUTSIDE the projects root (the fixture\'s own escaping symlink, D14) is refused with 400 (R8)', async () => {
    const { server } = await startFullFixtureServer();
    const { status, body } = await getJson(server.port, `/api/spill?session=${SESSION_1_ID}&name=escaping.txt`);
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('spill name refused');
  });

  test('a charset-valid name too long for a single path component (>255 chars) is refused with 400 — the lexical containment branch, never a 404 (R8)', async () => {
    const { server } = await startFullFixtureServer();
    const tooLongName = `${'a'.repeat(256)}.txt`;
    const { status, body } = await getJson(server.port, `/api/spill?session=${SESSION_1_ID}&name=${tooLongName}`);
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('spill name refused');
  });

  test('caps the read at 2 MiB', async () => {
    const { server, root } = await startFullFixtureServer();
    const toolResultsDir = join(root, 'cfg', 'projects', PROJECT_A_DIR, SESSION_1_ID, 'tool-results');
    writeFileSync(join(toolResultsDir, 'biglocal.txt'), 'z'.repeat(3 * 1024 * 1024));
    const { status, text } = await getText(server.port, `/api/spill?session=${SESSION_1_ID}&name=biglocal.txt`);
    expect(status).toBe(200);
    expect(text.length).toBe(2 * 1024 * 1024);
  });
});
