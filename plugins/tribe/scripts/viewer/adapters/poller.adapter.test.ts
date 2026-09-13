// adapters/poller.adapter.test.ts — Task 19. The poller OBSERVES and EMITS; it decides nothing
// (`pure-core.md`). Every branch exercised here is a call into `core/tail.ts` / `core/window.ts` /
// `core/normalize.ts` / `core/pair.ts` / `core/sse.ts`, and each assertion checks the adapter
// FORWARDS what core returned (a window from `findWindow`, a patch from `pair`, a reset from
// `advanceTail`) rather than re-deriving it.
//
// The clock and the scheduler are INJECTED (spec §4: this adapter is the package's only clock
// owner), so every tick is driven deterministically — no real timer, no wall-clock read. The
// filesystem is an in-memory fake so a test can grow, rotate (new inode), truncate (same inode,
// smaller), or delete the "file" between ticks by mutating a byte buffer, exactly the shapes
// spec §6.1 must detect.
import { describe, expect, test } from 'bun:test';
import { createPoller, type PollerMeta } from './poller.adapter.ts';
import { decodeFrame, type DecodedFrame } from '../core/sse.ts';
import type { FileObservation, RenderNode, SessionSummary } from '../core/model.ts';

const encoder = new TextEncoder();
function bytes(s: string): Uint8Array {
  return encoder.encode(s);
}

// --- Row builders: the exact shapes the normalizer classifies (spec §7). -----------------------
function textRow(text: string, uuid: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp: 't',
    message: { role: 'assistant', model: 'm', content: [{ type: 'text', text }] },
  });
}
function toolUseRow(id: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: id,
    timestamp: 't',
    message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'true' } }] },
  });
}
function toolResultRow(id: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: `r-${id}`,
    timestamp: 't',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }] },
  });
}

function baseSummary(): SessionSummary {
  return {
    id: 'sess',
    projectDir: 'proj',
    title: 't',
    titleSource: 'session-id',
    sizeBytes: 0,
    mtimeIso: '2026-01-01T00:00:00.000Z',
    live: true,
    subagentCount: 0,
    badges: [],
    projects: ['proj'],
  };
}

const PATH = '/root/projects/proj/sess.jsonl';

interface Fake {
  io: { statFile(p: string): FileObservation | null; readRange(p: string, s: number, e: number): Uint8Array; readMeta(): PollerMeta };
  set(s: string | Uint8Array): void;
  append(s: string): void;
  rotate(s: string | Uint8Array): void; // new inode (replacement)
  truncate(s: string | Uint8Array): void; // same inode, smaller
  remove(): void;
  setMeta(m: PollerMeta): void;
  size(): number;
}

function makeFake(): Fake {
  let content: Uint8Array = new Uint8Array(0);
  let inode = 1;
  let present = true;
  let meta: PollerMeta = { session: baseSummary(), agents: [], badges: [], live: true };
  return {
    io: {
      statFile() {
        if (!present) return null;
        return { sizeBytes: content.length, mtimeMs: 1000, inode, birthtimeMs: 500 };
      },
      readRange(_p, s, e) {
        return content.subarray(s, e);
      },
      readMeta() {
        return meta;
      },
    },
    set(s) {
      content = typeof s === 'string' ? bytes(s) : s;
    },
    append(s) {
      const add = bytes(s);
      const merged = new Uint8Array(content.length + add.length);
      merged.set(content, 0);
      merged.set(add, content.length);
      content = merged;
    },
    rotate(s) {
      content = typeof s === 'string' ? bytes(s) : s;
      inode += 1;
    },
    truncate(s) {
      content = typeof s === 'string' ? bytes(s) : s;
    },
    remove() {
      present = false;
    },
    setMeta(m) {
      meta = m;
    },
    size() {
      return content.length;
    },
  };
}

interface Controllable {
  schedule: (fn: () => void, ms: number) => { stop: () => void };
  now: () => number;
  tick(): void;
  advance(ms: number): void;
}

function makeControllable(): Controllable {
  let fn: (() => void) | null = null;
  let clockMs = 0;
  return {
    schedule(f) {
      fn = f;
      return { stop: () => (fn = null) };
    },
    now: () => clockMs,
    tick() {
      if (fn !== null) fn();
    },
    advance(ms) {
      clockMs += ms;
    },
  };
}

interface Sink {
  emit: (s: string) => void;
  frames(): DecodedFrame[];
  raw: string[];
  clear(): void;
}
function makeSink(): Sink {
  const raw: string[] = [];
  return {
    emit: (s) => raw.push(s),
    frames: () => raw.map((r) => decodeFrame(r)),
    raw,
    clear: () => (raw.length = 0),
  };
}

interface StartOpts {
  intervalMs?: number;
  generation?: string;
  limit?: number;
  onClose?: () => void;
}
function start(fake: Fake, ctrl: Controllable, sink: Sink, opts: StartOpts = {}): { stop: () => void } {
  return createPoller({
    io: fake.io,
    path: PATH,
    intervalMs: opts.intervalMs ?? 250,
    generation: opts.generation ?? 'G1',
    emit: sink.emit,
    now: ctrl.now,
    schedule: ctrl.schedule,
    limit: opts.limit,
    onClose: opts.onClose,
  });
}

// Text of every 'assistant'/'prompt' node in a rows frame, in order.
function textsIn(frame: DecodedFrame): string[] {
  if (frame.event !== 'rows') return [];
  const out: string[] = [];
  for (const node of frame.data.nodes as RenderNode[]) {
    if (node.k === 'assistant') out.push(node.body.map((t) => (t.t === 'text' ? t.v : '')).join(''));
  }
  return out;
}

describe('createPoller — hello + the initial window (D30/D31)', () => {
  test('the window comes from findWindow and the tail is seeded so a file NOT ending in \\n continues its partial row, never re-reading the window or emitting `unreadable`', () => {
    const fake = makeFake();
    const head = `${textRow('one', 'u1')}\n${textRow('two', 'u2')}\n`;
    const third = textRow('three', 'u3');
    // Two COMPLETE rows, then the FIRST 20 bytes of a third row — a writer mid-append, no newline
    // yet. The carry bytes are the third row's OWN prefix, exactly as a real appending writer
    // leaves them on disk (`fixtures-mirror-reality.md`): completion appends the rest, never a
    // rewrite of the partial region.
    fake.set(`${head}${third.slice(0, 20)}`);

    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink);

    const frames = sink.frames();
    expect(frames[0]!.event).toBe('hello');
    const rows = frames.filter((f) => f.event === 'rows');
    // The window is the TWO complete rows; the partial third is carry, never a row.
    const windowTexts = rows.flatMap(textsIn);
    expect(windowTexts).toEqual(['one', 'two']);
    // A partial row must NOT surface as an `unreadable` node (spec §6.3 — 0 parse failures oracle).
    for (const f of rows) {
      for (const n of f.data.nodes as RenderNode[]) expect(n.k).not.toBe('unreadable');
    }

    // Now the writer completes the third row (appends its remaining bytes + the newline). The next
    // tick continues the carry — it must NOT re-read rows one/two, and `three` appears exactly once.
    sink.clear();
    fake.set(`${head}${third}\n`);
    ctrl.tick();

    const tickTexts = sink.frames().filter((f) => f.event === 'rows').flatMap(textsIn);
    expect(tickTexts).toEqual(['three']);
  });
});

describe('createPoller — growth ticks', () => {
  test('a tick that finds growth emits one rows frame; a tick with no growth emits nothing', () => {
    const fake = makeFake();
    fake.set(`${textRow('first', 'u1')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink);
    sink.clear();

    fake.append(`${textRow('second', 'u2')}\n`);
    ctrl.tick();
    const grew = sink.frames();
    expect(grew.filter((f) => f.event === 'rows')).toHaveLength(1);
    expect(grew.filter((f) => f.event === 'rows').flatMap(textsIn)).toEqual(['second']);

    sink.clear();
    ctrl.tick(); // no growth, clock unchanged (no ping)
    expect(sink.raw).toEqual([]);
  });

  test('a tool_use on tick 1 and its tool_result on tick 3 emits a `patch` frame on tick 3 and no new row (spec §6.4)', () => {
    const fake = makeFake();
    fake.set(`${textRow('intro', 'u0')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink);
    sink.clear();

    // tick 1: the call
    fake.append(`${toolUseRow('toolu_live')}\n`);
    ctrl.tick();
    const t1 = sink.frames();
    const t1rows = t1.filter((f) => f.event === 'rows');
    expect(t1rows).toHaveLength(1);
    const toolNode = (t1rows[0]!.data.nodes as RenderNode[]).find((n) => n.k === 'tool');
    expect(toolNode).toBeDefined();
    expect((toolNode as Extract<RenderNode, { k: 'tool' }>).state).toBe('pending');
    expect(t1.some((f) => f.event === 'patch')).toBe(false);

    // tick 2: nothing changes
    sink.clear();
    ctrl.tick();
    expect(sink.raw).toEqual([]);

    // tick 3: the result — a patch, and NO new row.
    fake.append(`${toolResultRow('toolu_live')}\n`);
    ctrl.tick();
    const t3 = sink.frames();
    expect(t3.filter((f) => f.event === 'rows')).toHaveLength(0);
    const patchFrames = t3.filter((f) => f.event === 'patch');
    expect(patchFrames).toHaveLength(1);
    const patches = patchFrames[0]!.data.patches as Array<{ op: string; id: string }>;
    expect(patches).toHaveLength(1);
    expect(patches[0]!.op).toBe('result');
    expect(patches[0]!.id).toBe((toolNode as RenderNode).id); // the ALREADY-sent node's id
  });
});

describe('createPoller — reset triggers (spec §6.1)', () => {
  function manyRows(prefix: string, n: number): string {
    let out = '';
    for (let i = 0; i < n; i++) out += `${textRow(`${prefix}${i}`, `${prefix}-${i}`)}\n`;
    return out;
  }

  test('a truncation emits reset{reason:"truncated"} then the normal tail window (from the tail anchor, NOT byte 0), exactly once', () => {
    const fake = makeFake();
    fake.set(manyRows('big', 40));
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink, { limit: 2 });
    sink.clear();

    // Same inode, strictly smaller — but still large enough that the 2-node window starts > 0.
    fake.truncate(manyRows('post', 6));
    ctrl.tick();

    const frames = sink.frames();
    const resets = frames.filter((f) => f.event === 'reset');
    expect(resets).toHaveLength(1);
    expect(resets[0]!.data.reason).toBe('truncated');
    const rows = frames.filter((f) => f.event === 'rows');
    expect(rows.length).toBeGreaterThan(0);
    // The window follows the reset, and it starts at the tail anchor — never byte 0 (§6.1).
    expect((rows[0]!.data as { from: number }).from).toBeGreaterThan(0);
    // The reset window is delivered exactly once — no second reset, no double window.
    const helloAfter = frames.filter((f) => f.event === 'hello');
    expect(helloAfter).toHaveLength(0);
  });

  test('a same-size replacement (different content, different inode) emits reset{reason:"rotated"} — size alone cannot see it, the inode can', () => {
    const fake = makeFake();
    const original = manyRows('aaa', 12);
    fake.set(original);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink, { limit: 3 });
    sink.clear();

    // A different file of the SAME byte length — only the inode differs.
    const replacement = manyRows('bbb', 12);
    expect(bytes(replacement).length).toBe(bytes(original).length);
    fake.rotate(replacement);
    ctrl.tick();

    const frames = sink.frames();
    const resets = frames.filter((f) => f.event === 'reset');
    expect(resets).toHaveLength(1);
    expect(resets[0]!.data.reason).toBe('rotated');
    // The window that follows is the NEW file's content, never the old.
    const windowTexts = frames.filter((f) => f.event === 'rows').flatMap(textsIn);
    expect(windowTexts.every((t) => t.startsWith('bbb'))).toBe(true);
    expect(windowTexts.some((t) => t.startsWith('aaa'))).toBe(false);
  });

  test('a LARGER replacement (different inode) also emits reset{reason:"rotated"}', () => {
    const fake = makeFake();
    fake.set(manyRows('aaa', 8));
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink, { limit: 3 });
    sink.clear();

    fake.rotate(manyRows('bbb', 40)); // strictly larger, new inode
    ctrl.tick();

    const resets = sink.frames().filter((f) => f.event === 'reset');
    expect(resets).toHaveLength(1);
    expect(resets[0]!.data.reason).toBe('rotated');
  });
});

describe('createPoller — meta, gone, ping', () => {
  test('a new agent sidecar appearing mid-stream emits a `meta` frame carrying the new agent, no reconnect (spec §6.2)', () => {
    const fake = makeFake();
    fake.set(`${textRow('x', 'u1')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink);
    sink.clear();

    fake.setMeta({
      session: baseSummary(),
      agents: [
        {
          id: 'a1',
          parentId: null,
          depth: 1,
          agentType: null,
          label: 'agent a1',
          toolUseId: null,
          model: null,
          sizeBytes: 0,
          mtimeIso: null,
          birthtimeIso: null,
          live: true,
        },
      ],
      badges: [],
      live: true,
    });
    ctrl.tick();

    const metaFrames = sink.frames().filter((f) => f.event === 'meta');
    expect(metaFrames).toHaveLength(1);
    expect((metaFrames[0]!.data.agents as Array<{ id: string }>).map((a) => a.id)).toContain('a1');
    // No new hello — the stream stays open (D12: a mid-stream change is a meta frame, not a reconnect).
    expect(sink.frames().some((f) => f.event === 'hello')).toBe(false);
  });

  test('a deletion emits `gone`', () => {
    const fake = makeFake();
    fake.set(`${textRow('x', 'u1')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink);
    sink.clear();

    fake.remove();
    ctrl.tick();

    const gone = sink.frames().filter((f) => f.event === 'gone');
    expect(gone).toHaveLength(1);
    expect(gone[0]!.data.reason).toBe('deleted');
  });

  test('a deletion is TERMINAL: it emits `gone`, then invokes onClose EXACTLY once so serve.ts can close the stream and release the slot (I1)', () => {
    const fake = makeFake();
    fake.set(`${textRow('x', 'u1')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    let closeCount = 0;
    start(fake, ctrl, sink, { onClose: () => (closeCount += 1) });
    sink.clear();

    fake.remove();
    ctrl.tick();

    // The contracted terminal frame is still emitted...
    expect(sink.frames().filter((f) => f.event === 'gone')).toHaveLength(1);
    // ...and the terminal callback fires exactly once, so the 8-stream slot is not leaked.
    expect(closeCount).toBe(1);

    // A further tick must NOT invoke onClose again (the loop is stopped; release stays once-only).
    ctrl.tick();
    expect(closeCount).toBe(1);
  });

  test('a filesystem error mid-stream is TERMINAL: the poll loop stops and onClose fires exactly once (I1, fail-closed lifecycle)', () => {
    // A poller io whose stat throws an errno error on the tick after connect — the shape a mid-stream
    // read failure takes. Before the fix, the poller swallowed it and stopped, but never signalled
    // serve.ts, so the stream's slot was consumed forever.
    let statCalls = 0;
    const throwingIo: Fake['io'] = {
      statFile(_p: string) {
        statCalls += 1;
        if (statCalls === 1) return { sizeBytes: 0, mtimeMs: 1000, inode: 1, birthtimeMs: 500 };
        const err = new Error('EIO: i/o error') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      },
      readRange() {
        return new Uint8Array(0);
      },
      readMeta(): PollerMeta {
        return { session: baseSummary(), agents: [], badges: [], live: true };
      },
    };
    const ctrl = makeControllable();
    const sink = makeSink();
    let closeCount = 0;
    createPoller({ io: throwingIo, path: PATH, intervalMs: 250, generation: 'G1', emit: sink.emit, now: ctrl.now, schedule: ctrl.schedule, onClose: () => (closeCount += 1) });

    ctrl.tick(); // the stat now throws
    expect(closeCount).toBe(1);
    ctrl.tick(); // stopped — no second close
    expect(closeCount).toBe(1);
  });

  test('`ping` fires at 15 s of elapsed clock', () => {
    const fake = makeFake();
    fake.set(`${textRow('x', 'u1')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink, { intervalMs: 5000 });
    sink.clear();

    ctrl.advance(5000);
    ctrl.tick();
    expect(sink.frames().some((f) => f.event === 'ping')).toBe(false); // only 5 s elapsed

    ctrl.advance(10_000); // now 15 s total
    ctrl.tick();
    const pings = sink.frames().filter((f) => f.event === 'ping');
    expect(pings).toHaveLength(1);
    expect(typeof pings[0]!.data.t).toBe('string');
  });
});

describe('createPoller — frame ids and generation (D12)', () => {
  test('every frame id is the next per-stream sequence number, incrementing by one across frame types, and hello carries the injected generation', () => {
    const fake = makeFake();
    fake.set(`${textRow('a', 'u1')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink, { generation: 'GEN-42' });

    // Drive a mix of frame types: a growth tick (rows), then a patch tick.
    fake.append(`${toolUseRow('t1')}\n`);
    ctrl.tick();
    fake.append(`${toolResultRow('t1')}\n`);
    ctrl.tick();
    ctrl.advance(15_000);
    ctrl.tick(); // a ping

    const frames = sink.frames();
    expect(frames[0]!.event).toBe('hello');
    expect((frames[0]!.data as { generation: string }).generation).toBe('GEN-42');
    // ids are 1,2,3,… contiguous, regardless of event kind, and never a byte offset.
    expect(frames.map((f) => f.id)).toEqual(frames.map((_f, i) => i + 1));
  });
});

describe('createPoller — frame batching (spec §6.2, §6.5)', () => {
  // ~1.4 KiB per row keeps each node well under the 64 KiB node cap while a modest row count still
  // encodes past the 1 MiB frame cap — the realistic catch-up shape.
  function bigRow(i: number): string {
    return textRow(`row-${i}-${'x'.repeat(1400)}`, `u-${i}`);
  }
  const FRAME_CAP = 1024 * 1024;

  test('a single tick whose nodes exceed 1 MiB encoded is split into several rows frames, each under the cap, every node present exactly once and in order', () => {
    const fake = makeFake();
    fake.set(`${textRow('seed', 'seed')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink);
    sink.clear();

    const COUNT = 1200; // ~1.7 MiB of nodes — comfortably over one 1 MiB frame, under the 4 MiB read
    let batch = '';
    for (let i = 0; i < COUNT; i++) batch += `${bigRow(i)}\n`;
    fake.append(batch);
    ctrl.tick();

    const rowsFrames = sink.raw.map((r) => decodeFrame(r)).filter((f) => f.event === 'rows');
    expect(rowsFrames.length).toBeGreaterThan(1); // it was split
    // Every emitted rows frame's ENCODED bytes are within the cap.
    for (const r of sink.raw) {
      const f = decodeFrame(r);
      if (f.event === 'rows') expect(bytes(r).length).toBeLessThanOrEqual(FRAME_CAP);
    }
    // Every appended row present exactly once, in order.
    const ids: number[] = [];
    for (const f of rowsFrames) for (const n of f.data.nodes as RenderNode[]) ids.push(n.at);
    expect(ids).toEqual([...ids].sort((a, b) => a - b)); // ascending byte offsets == file order
    const texts = rowsFrames.flatMap(textsIn);
    expect(texts).toHaveLength(COUNT);
    expect(new Set(texts).size).toBe(COUNT); // no duplicates
    expect(texts[0]).toContain('row-0-');
    expect(texts[COUNT - 1]).toContain(`row-${COUNT - 1}-`);
  });

  test('a delta larger than the 4 MiB per-tick read cap is delivered across two ticks with no byte lost or duplicated', () => {
    const fake = makeFake();
    fake.set(`${textRow('seed', 'seed')}\n`);
    const ctrl = makeControllable();
    const sink = makeSink();
    start(fake, ctrl, sink);
    sink.clear();

    // ~4.6 MiB of rows: strictly more than one 4 MiB read, so it MUST span two ticks.
    const COUNT = 3300;
    let batch = '';
    for (let i = 0; i < COUNT; i++) batch += `${bigRow(i)}\n`;
    expect(bytes(batch).length).toBeGreaterThan(4 * 1024 * 1024);
    fake.append(batch);

    ctrl.tick();
    const afterFirst = sink.raw.map((r) => decodeFrame(r)).filter((f) => f.event === 'rows').flatMap(textsIn).length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterFirst).toBeLessThan(COUNT); // the 4 MiB cap held some back

    ctrl.tick(); // the remainder

    const texts = sink.raw.map((r) => decodeFrame(r)).filter((f) => f.event === 'rows').flatMap(textsIn);
    expect(texts).toHaveLength(COUNT); // nothing lost
    expect(new Set(texts).size).toBe(COUNT); // nothing duplicated
    // Still in file order across the two ticks.
    for (let i = 0; i < COUNT; i++) expect(texts[i]).toContain(`row-${i}-`);
  });
});
