// client/src/useEventStream.test.ts — the SSE stream controller (spec §6.2, §8.4). The controller
// is framework-free and takes every world dependency as an injected seam (`pure-core.md`): the
// `EventSource` CONSTRUCTOR, the `window`-like object the three `__viewer*` members live on, and
// the reconnect scheduler. That is what lets these run against a FAKE EventSource with no browser.
//
// The three `window` members ship in the PRODUCTION build (D25) — they must NOT be gated on
// `import.meta.env.DEV`; task 31 serves the real fixed dist/ and calls them. The source-scan tests
// below enforce that mechanically, alongside the "never reads Last-Event-ID" rule (D12).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { Agent, Badge, RenderNode } from '../../core/model.ts';
import { createRowStore } from './rowStore.ts';
import { createStreamController, makeFetchRows, type ConnectionStatus, type ViewerWindow } from './useEventStream.ts';

// --- fake EventSource ----------------------------------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: (ev: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== cb);
  }
  close(): void {
    this.closed = true;
  }
  // --- test drivers (a real EventSource fires these from the network) ---
  fireOpen(): void {
    for (const cb of this.listeners['open'] || []) cb({});
  }
  fireError(): void {
    for (const cb of this.listeners['error'] || []) cb({});
  }
  emit(type: string, data: unknown, id?: string): void {
    const ev = { data: JSON.stringify(data), lastEventId: id ?? '' };
    for (const cb of this.listeners[type] || []) cb(ev);
  }
  /** Deliver a frame whose `data` is a RAW string (not JSON-encoded) — the shape a malformed
   * server frame has on the wire, used to prove the decode boundary catches `JSON.parse` (R15.6). */
  emitRaw(type: string, raw: string, id?: string): void {
    const ev = { data: raw, lastEventId: id ?? '' };
    for (const cb of this.listeners[type] || []) cb(ev);
  }
}

function freshWindow(): ViewerWindow {
  return {} as ViewerWindow;
}

/** Build a controller wired to a fresh fake-EventSource universe. `schedule` runs synchronously so
 * a reconnect completes within the test rather than on a real 2 s timer. */
function harness() {
  FakeEventSource.instances = [];
  const store = createRowStore();
  const win = freshWindow();
  const metas: Array<{ agents: Agent[]; badges: Badge[]; live: boolean }> = [];
  const statuses: ConnectionStatus[] = [];
  const controller = createStreamController(store, {
    EventSourceCtor: FakeEventSource as unknown as typeof EventSource,
    win,
    url: '/events?session=abc',
    onMeta: (m) => metas.push(m),
    onStatus: (s) => statuses.push(s),
    schedule: (fn) => { fn(); return () => {}; },
  });
  return { store, win, metas, statuses, controller, current: () => FakeEventSource.instances[FakeEventSource.instances.length - 1]! };
}

/** A scheduler whose pending reconnects are fired (or cancelled) under the test's control — the
 * synchronous `harness()` scheduler masks the R15.5 lifecycle (a fired reconnect hides whether a
 * second was queued or the failed source was left open). */
function controllableSchedule() {
  const pending: Array<{ fn: () => void; cancelled: boolean }> = [];
  const schedule = (fn: () => void): (() => void) => {
    const entry = { fn, cancelled: false };
    pending.push(entry);
    return () => { entry.cancelled = true; };
  };
  return {
    schedule,
    activeCount: () => pending.filter((e) => !e.cancelled).length,
    runAll: () => { for (const e of pending) if (!e.cancelled) e.fn(); },
  };
}

function node(at: number): RenderNode {
  return {
    id: `${at}:0`, at, i: 0, uuid: null, ts: null, elided: false, expandable: false,
    k: 'assistant', body: [{ t: 'text', v: `n${at}` }], model: null,
  };
}

function toolPending(at: number, toolUseId: string): RenderNode {
  return {
    id: `${at}:0`, at, i: 0, uuid: null, ts: null, elided: false, expandable: false,
    k: 'tool', name: 'Bash', input: {}, state: 'pending', result: null, toolUseId,
    agentId: null, call: { at, i: 0 }, resultAnchor: null,
  };
}
function toolOk(at: number, toolUseId: string): RenderNode {
  return {
    id: `${at}:0`, at, i: 0, uuid: null, ts: null, elided: false, expandable: false,
    k: 'tool', name: 'Bash', input: {}, state: 'ok', toolUseId, agentId: null,
    call: { at, i: 0 }, resultAnchor: { at, i: 0 },
    result: { r: 'text', body: [{ t: 'text', v: 'out' }], isError: false, elided: false },
  };
}

const HELLO = { generation: 'gen-1', session: {}, agents: [], badges: [], from: 1000, to: 1200, truncatedBefore: false };

describe('useEventStream — the SSE stream controller (spec §6.2, §8.4)', () => {
  test('hello then rows populates the store; a second rows frame appends', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    es.emit('rows', { nodes: [node(1000), node(1100)], from: 1000, to: 1200 }, '2');
    expect(h.store.getSnapshot().nodes.map((n) => n.id)).toEqual(['1000:0', '1100:0']);
    es.emit('rows', { nodes: [node(1200)], from: 1200, to: 1300 }, '3');
    expect(h.store.getSnapshot().nodes.map((n) => n.id)).toEqual(['1000:0', '1100:0', '1200:0']);
    expect(h.win.__viewerGeneration).toBe('gen-1');
  });

  test('a patch frame routes to the store patch path (replace in place)', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    es.emit('rows', { nodes: [toolPending(1000, 'tu-1')], from: 1000, to: 1100 }, '2');
    expect((h.store.getSnapshot().nodes[0] as { state: string }).state).toBe('pending');
    es.emit('patch', { patches: [{ op: 'result', id: '1000:0', node: toolOk(1000, 'tu-1') }] }, '3');
    const snap = h.store.getSnapshot();
    expect(snap.nodes.length).toBe(1);
    expect((snap.nodes[0] as { state: string }).state).toBe('ok');
  });

  test('meta updates the agent tabs WITHOUT touching nodes', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    es.emit('rows', { nodes: [node(1000)], from: 1000, to: 1100 }, '2');
    const before = h.store.getSnapshot().nodes.length;
    const agents: Agent[] = [{
      id: 'a1', parentId: null, depth: 1, agentType: null, label: 'agent a1',
      toolUseId: null, model: null, sizeBytes: 10, mtimeIso: null, birthtimeIso: null, live: true,
    }];
    es.emit('meta', { agents, badges: [], live: true }, '3');
    expect(h.store.getSnapshot().nodes.length).toBe(before); // nodes untouched
    expect(h.metas[h.metas.length - 1]!.agents.map((a) => a.id)).toEqual(['a1']);
  });

  test('reset clears then re-populates', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    es.emit('rows', { nodes: [node(1000), node(1100)], from: 1000, to: 1200 }, '2');
    es.emit('reset', { reason: 'rotated' }, '3');
    expect(h.store.getSnapshot().nodes.length).toBe(0);
    es.emit('rows', { nodes: [node(5000)], from: 5000, to: 5100 }, '4');
    expect(h.store.getSnapshot().nodes.map((n) => n.id)).toEqual(['5000:0']);
  });

  test('gone stops reconnecting: a following error opens no new stream', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    es.emit('gone', { reason: 'deleted' }, '2');
    const count = FakeEventSource.instances.length;
    es.fireError(); // after `gone`, the client must NOT retry
    expect(FakeEventSource.instances.length).toBe(count);
  });

  test('the error handler reopens a dropped stream unaided (trigger 1)', () => {
    const h = harness();
    h.controller.start();
    const es1 = h.current();
    es1.fireOpen();
    es1.emit('hello', HELLO, '1');
    es1.emit('rows', { nodes: [node(1000)], from: 1000, to: 1100 }, '2');
    const before = FakeEventSource.instances.length;
    es1.fireError(); // a dropped connection — the browser fires `error`
    expect(FakeEventSource.instances.length).toBe(before + 1); // reopened unaided
    const es2 = h.current();
    es2.fireOpen();
    es2.emit('hello', { ...HELLO, generation: 'gen-2' }, '1');
    es2.emit('rows', { nodes: [node(2000)], from: 2000, to: 2100 }, '2');
    expect(h.store.getSnapshot().nodes.map((n) => n.id)).toEqual(['2000:0']);
  });

  test('__viewerReconnect() opens a new stream after an explicit close() (trigger 2)', () => {
    const h = harness();
    h.controller.start();
    const es1 = h.current();
    es1.fireOpen();
    es1.emit('hello', HELLO, '1');
    const before = FakeEventSource.instances.length;
    es1.close(); // deliberate — no `error` fires, the browser never retries a close()
    expect(typeof h.win.__viewerReconnect).toBe('function');
    h.win.__viewerReconnect!();
    expect(FakeEventSource.instances.length).toBe(before + 1);
    expect(es1.closed).toBe(true);
  });

  test('a dropped connection processes a FRESH hello+window, DISCARDING the previous window (D12) with no duplicate card', () => {
    const h = harness();
    h.controller.start();
    const es1 = h.current();
    es1.fireOpen();
    es1.emit('hello', { ...HELLO, generation: 'gen-A' }, '1');
    es1.emit('rows', { nodes: [node(1000), node(1100)], from: 1000, to: 1200 }, '2');
    expect(h.store.getSnapshot().nodes.length).toBe(2);
    es1.fireError();
    const es2 = h.current();
    es2.fireOpen();
    // the reconnect re-reads a window that OVERLAPS (same ids) but under a NEW generation
    es2.emit('hello', { ...HELLO, generation: 'gen-B' }, '1');
    es2.emit('rows', { nodes: [node(1000), node(1100)], from: 1000, to: 1200 }, '2');
    // the store discarded the stale window (generation changed) and deduped the overlap: still 2.
    expect(h.store.getSnapshot().nodes.length).toBe(2);
    expect(h.store.getSnapshot().generation).toBe('gen-B');
  });

  test('the sequence watermark is CLEARED on every open — a fresh hello with id 1 after a reconnect is PROCESSED, not discarded', () => {
    const h = harness();
    h.controller.start();
    const es1 = h.current();
    es1.fireOpen();
    // process ids 1..5 on the first connection
    es1.emit('hello', { ...HELLO, generation: 'gen-A' }, '1');
    es1.emit('rows', { nodes: [node(1000)], from: 1000, to: 1100 }, '2');
    es1.emit('rows', { nodes: [node(1100)], from: 1100, to: 1200 }, '3');
    es1.emit('meta', { agents: [], badges: [], live: true }, '4');
    es1.emit('ping', { t: '2026-09-13T00:00:00.000Z' }, '5');
    es1.fireError();
    const es2 = h.current();
    es2.fireOpen(); // clears the watermark
    // frame ids restart at 1 per connection (§6.2); this must be processed, not swallowed
    es2.emit('hello', { ...HELLO, generation: 'gen-B' }, '1');
    es2.emit('rows', { nodes: [node(9000)], from: 9000, to: 9100 }, '2');
    expect(h.store.getSnapshot().nodes.map((n) => n.id)).toEqual(['9000:0']);
  });

  test('within a connection a duplicate frame id is ignored (sequence dedupe)', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    es.emit('rows', { nodes: [node(1000)], from: 1000, to: 1100 }, '2');
    es.emit('rows', { nodes: [node(1100)], from: 1100, to: 1200 }, '2'); // replayed id 2 — ignored
    expect(h.store.getSnapshot().nodes.map((n) => n.id)).toEqual(['1000:0']);
  });

  test('all three __viewer* members are present after start (D25 — shipped, not dev-gated)', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    expect(h.win.__viewerEventSource).toBeDefined();
    expect(typeof h.win.__viewerReconnect).toBe('function');
    expect(h.win.__viewerGeneration).toBe('gen-1');
  });

  test('the hook never mentions Last-Event-ID (D12: the server ignores it, the client never sets it)', () => {
    const src = readFileSync(join(import.meta.dir, 'useEventStream.ts'), 'utf8');
    expect(src.includes('Last-Event-ID')).toBe(false);
    expect(src.toLowerCase().includes('lasteventid')).toBe(true); // it DOES read ev.lastEventId — the frame seq, not the header
  });

  test('the three __viewer* members are NOT gated on import.meta.env.DEV (D25 — they ship in prod)', () => {
    const src = readFileSync(join(import.meta.dir, 'useEventStream.ts'), 'utf8');
    expect(src.includes('import.meta.env')).toBe(false);
  });

  test('makeFetchRows comma-joins orphan ids into ONE orphans= param (D27 wire shape §3.2)', async () => {
    // core/routes.ts reads searchParams.get('orphans') and splits ONE comma-separated value, so a
    // client appending orphans=a&orphans=b would deliver only 'a'. The client must comma-join.
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ nodes: [], patches: [], from: 0, to: 0, truncatedBefore: false }));
    }) as typeof fetch;
    try {
      const fetchRows = makeFetchRows('sess-1', null);
      await fetchRows({ before: 1000, orphans: ['tu-a', 'tu-b'] });
    } finally {
      globalThis.fetch = original;
    }
    const url = calls[0]!;
    expect(url.match(/orphans=/g)?.length).toBe(1);       // exactly ONE orphans= param, never one-per-id
    expect(decodeURIComponent(url.split('orphans=')[1]!)).toBe('tu-a,tu-b'); // the comma-joined value
  });

  test('createStreamController constructs NO timer of its own — the scheduler is a REQUIRED input (R15.3, pure-core)', () => {
    const src = readFileSync(join(import.meta.dir, 'useEventStream.ts'), 'utf8');
    const start = src.indexOf('export function createStreamController');
    const afterFn = src.indexOf('\nexport function', start + 1);
    const controllerSrc = src.slice(start, afterFn === -1 ? undefined : afterFn);
    expect(controllerSrc.includes('setTimeout')).toBe(false);     // no timer built inside the controller
    expect(controllerSrc.includes('deps.schedule ??')).toBe(false); // no default fallback for the injected scheduler
  });

  test('two errors schedule AT MOST ONE reconnect, and the failed source is closed immediately (R15.5)', () => {
    FakeEventSource.instances = [];
    const store = createRowStore();
    const sched = controllableSchedule();
    const controller = createStreamController(store, {
      EventSourceCtor: FakeEventSource as unknown as typeof EventSource,
      win: freshWindow(),
      url: '/events?session=abc',
      schedule: sched.schedule,
    });
    controller.start();
    const es1 = FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
    es1.fireOpen();
    es1.fireError();
    expect(es1.closed).toBe(true);            // the failed source is closed immediately, not left open
    es1.fireError();                          // a SECOND error before the first reconnect fires
    expect(sched.activeCount()).toBe(1);      // at most ONE pending reconnect (the first is cancelled)
    const before = FakeEventSource.instances.length;
    sched.runAll();                           // fire the pending reconnect
    expect(FakeEventSource.instances.length).toBe(before + 1); // exactly one new stream opened
  });

  test('stop() cancels a pending reconnect (a scheduled reopen never fires after stop, R15.5)', () => {
    FakeEventSource.instances = [];
    const store = createRowStore();
    const sched = controllableSchedule();
    const controller = createStreamController(store, {
      EventSourceCtor: FakeEventSource as unknown as typeof EventSource,
      win: freshWindow(),
      url: '/events?session=abc',
      schedule: sched.schedule,
    });
    controller.start();
    const es1 = FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
    es1.fireOpen();
    es1.fireError();                          // schedules a reconnect
    controller.stop();                        // must cancel it
    expect(sched.activeCount()).toBe(0);
    const before = FakeEventSource.instances.length;
    sched.runAll();
    expect(FakeEventSource.instances.length).toBe(before); // no reopen after stop
  });

  test('a malformed frame does not throw out of the callback — it reaches a typed decode-error terminal state and stops (R15.6)', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    // emit a `rows` frame whose data is NOT valid JSON — an unguarded JSON.parse would throw out of
    // the callback with no typed state. The decode boundary must catch it (SyntaxError, narrowly).
    let threw = false;
    try {
      es.emitRaw('rows', '{ this is : not json');
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(h.statuses[h.statuses.length - 1]).toEqual({ phase: 'decode-error' });
    // terminal: a following error must NOT reopen
    const count = FakeEventSource.instances.length;
    es.fireError();
    expect(FakeEventSource.instances.length).toBe(count);
  });

  test('a `gone` frame surfaces a terminal gone status (R15.2, §13)', () => {
    const h = harness();
    h.controller.start();
    const es = h.current();
    es.fireOpen();
    es.emit('hello', HELLO, '1');
    es.emit('gone', { reason: 'deleted' }, '2');
    expect(h.statuses[h.statuses.length - 1]).toEqual({ phase: 'gone' });
  });

  test('makeFetchRows omits orphans= entirely when there are none', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ nodes: [], patches: [], from: 0, to: 0, truncatedBefore: false }));
    }) as typeof fetch;
    try {
      await makeFetchRows('sess-1', null)({ before: null, orphans: [] });
    } finally {
      globalThis.fetch = original;
    }
    expect(calls[0]!.includes('orphans=')).toBe(false);
  });
});
