// client/src/useEventStream.ts — the one SSE stream per open session view (spec §6.2, §8.4). The
// controller is framework-free and takes every world dependency as an injected seam
// (`pure-core.md`): the `EventSource` CONSTRUCTOR, the `window`-like object the three `__viewer*`
// members live on, and the reconnect scheduler. The React `useEventStream` hook at the bottom is a
// thin wrapper that supplies the real globals.
//
// Reconnection is the client's own job with exactly two triggers (spec §8.4): the `error` handler
// reopens a dropped stream unaided, and `__viewerReconnect()` opens a new one after a deliberate
// teardown (which fires no `error`). Both ship in the PRODUCTION build (D25) — nothing here is
// gated on a dev flag, because task 31 serves the real fixed dist/ and calls them.
//
// There is NO byte cursor and no resume header (D12): the frame `id:` (read as `ev.lastEventId`)
// is a per-CONNECTION sequence number, cleared to zero on every `open`, used only to ignore a
// frame already processed within the current connection. The node-level dedupe in the store makes
// a reconnect's window overlap invisible; the generation makes a stale window discardable.
import { useEffect, useRef } from 'react';
import type { Agent, Badge, Patch, RenderNode, SessionSummary } from '../../core/model.ts';
import { createRowStore, type FetchRows, type RowsPage, type RowStore } from './rowStore.ts';

/** The three members the client publishes on `window` (spec §8.4). Read-only with respect to
 * everything except the client's own stream (§12.1): a handle whose teardown ends a connection
 * the page already owns, the reopen it would perform itself on `error`, and the current
 * generation (a string the client already holds), so a test can observe a reconnect completed. */
export interface ViewerWindow {
  __viewerEventSource?: EventSource;
  __viewerReconnect?: () => void;
  __viewerGeneration?: string;
}

/** The metadata a `hello`/`meta` frame decorates the view with — agents (tabs), badges, liveness.
 * Delivered through `onMeta` so the store stays rows-only (a `meta` frame never touches nodes). */
export interface MetaUpdate {
  agents: Agent[];
  badges: Badge[];
  live: boolean;
}

export interface StreamDeps {
  EventSourceCtor: typeof EventSource;
  win: ViewerWindow;
  url: string;
  onMeta?: (m: MetaUpdate) => void;
  /** How a reconnect is delayed (spec `retry: 2000`). Injected so a test runs it synchronously;
   * production schedules it on the real timer. */
  schedule?: (fn: () => void, ms: number) => void;
  retryMs?: number;
}

export interface StreamController {
  start(): void;
  stop(): void;
  reconnect(): void;
}

interface HelloData {
  generation: string;
  session: SessionSummary;
  agents: Agent[];
  badges: Badge[];
  from: number;
  to: number;
  truncatedBefore: boolean;
}
interface RowsData { nodes: RenderNode[]; from: number; to: number }
interface PatchData { patches: Patch[] }
interface MetaData { agents: Agent[]; badges: Badge[]; live: boolean }

const DEFAULT_RETRY_MS = 2000;

/** The stream controller (spec §6.2, §8.4). Framework-free and fully injected, so it drives a
 * real browser `EventSource` in production and a fake in a unit test with identical logic. */
export function createStreamController(store: RowStore, deps: StreamDeps): StreamController {
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
  let es: EventSource | null = null;
  let stopped = false;         // `gone`/`stop` — the browser must not retry
  let lastSeq = 0;             // the per-connection sequence watermark; cleared on every `open`

  /** True iff this frame has not been processed on THIS connection. The watermark restarts at 0 on
   * each `open` (spec §6.2), so a fresh `hello` (id 1) after a reconnect is always accepted — a
   * watermark carried across a reconnect would swallow the whole new window and blank the page. */
  function accept(ev: MessageEvent): boolean {
    const raw = ev.lastEventId;
    if (raw === '' || raw === undefined) return true;
    const id = Number(raw);
    if (!Number.isInteger(id)) return true;
    if (id <= lastSeq) return false;
    lastSeq = id;
    return true;
  }

  function openStream(): void {
    shutStream();
    const source = new deps.EventSourceCtor(deps.url);
    es = source;
    deps.win.__viewerEventSource = source;
    deps.win.__viewerReconnect = () => reconnect();

    source.addEventListener('open', () => {
      lastSeq = 0; // clear the watermark — frame ids restart at 1 per connection (§6.2, §8.4)
    });

    source.addEventListener('hello', (ev) => {
      if (!accept(ev as MessageEvent)) return;
      const d = JSON.parse((ev as MessageEvent).data) as HelloData;
      store.hello({ generation: d.generation, from: d.from, to: d.to, truncatedBefore: d.truncatedBefore });
      deps.win.__viewerGeneration = d.generation;
      deps.onMeta?.({ agents: d.agents ?? [], badges: d.badges ?? [], live: d.session?.live ?? false });
    });

    source.addEventListener('rows', (ev) => {
      if (!accept(ev as MessageEvent)) return;
      const d = JSON.parse((ev as MessageEvent).data) as RowsData;
      store.applyRows({ nodes: d.nodes, from: d.from, to: d.to });
    });

    source.addEventListener('patch', (ev) => {
      if (!accept(ev as MessageEvent)) return;
      const d = JSON.parse((ev as MessageEvent).data) as PatchData;
      store.applyPatches(d.patches);
    });

    source.addEventListener('meta', (ev) => {
      if (!accept(ev as MessageEvent)) return;
      const d = JSON.parse((ev as MessageEvent).data) as MetaData;
      deps.onMeta?.({ agents: d.agents ?? [], badges: d.badges ?? [], live: d.live ?? false });
    });

    source.addEventListener('reset', (ev) => {
      if (!accept(ev as MessageEvent)) return;
      store.reset();
    });

    source.addEventListener('ping', (ev) => {
      accept(ev as MessageEvent); // advances the watermark; no state change
    });

    source.addEventListener('gone', (ev) => {
      if (!accept(ev as MessageEvent)) return;
      stopped = true; // the focused file is gone — stop retrying (spec §6.2)
      shutStream();
    });

    source.addEventListener('error', () => {
      // A dropped connection (trigger 1, spec §8.4): reopen after the retry interval, unless the
      // stream was deliberately ended (`gone`/`stop`), which fires no retry.
      if (stopped) return;
      schedule(() => {
        if (!stopped) openStream();
      }, retryMs);
    });
  }

  function shutStream(): void {
    if (es) {
      es.close(); // EventSource network teardown (§8.4) — not a filesystem write; the wall no
      es = null; // longer scans browser code, so no computed-key workaround is needed.
    }
  }

  function reconnect(): void {
    // Trigger 2 (spec §8.4): open a NEW stream by the error path's own route, after a deliberate
    // teardown that fired no `error`.
    openStream();
  }

  return {
    start() {
      stopped = false;
      openStream();
    },
    stop() {
      stopped = true;
      shutStream();
    },
    reconnect,
  };
}

/** The edge that performs the real `GET /api/rows` for back-fill and tail reload (spec §3.2). The
 * store's `loadEarlier`/`reloadTail` take this as their injected `FetchRows` seam; it is the ONE
 * side effect, with no decision-making (`pure-core.md`). */
export function makeFetchRows(sessionId: string, agentId: string | null): FetchRows {
  return async ({ before, orphans }) => {
    const params = new URLSearchParams({ session: sessionId });
    if (agentId !== null) params.set('agent', agentId);
    if (before !== null) params.set('before', String(before));
    for (const id of orphans) params.append('orphans', id);
    const res = await fetch(`/api/rows?${params.toString()}`);
    return (await res.json()) as RowsPage;
  };
}

/** The `/events` URL for a focused transcript (spec §6.2). */
export function eventsUrl(sessionId: string, agentId: string | null): string {
  const params = new URLSearchParams({ session: sessionId });
  if (agentId !== null) params.set('agent', agentId);
  return `/events?${params.toString()}`;
}

export interface UseEventStream {
  store: RowStore;
  fetchRows: FetchRows;
}

/** The React wrapper (spec §8.4): one stream per open session view, opened on mount and closed on
 * unmount or when the focused transcript changes. Supplies the real `EventSource`, `window`, and
 * timer; the controller owns everything else. */
export function useEventStream(
  sessionId: string,
  agentId: string | null,
  onMeta?: (m: MetaUpdate) => void,
): UseEventStream {
  const storeRef = useRef<RowStore | null>(null);
  if (storeRef.current === null) storeRef.current = createRowStore();
  const store = storeRef.current;
  const fetchRows = makeFetchRows(sessionId, agentId);
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;

  useEffect(() => {
    const controller = createStreamController(store, {
      EventSourceCtor: EventSource,
      win: window as ViewerWindow,
      url: eventsUrl(sessionId, agentId),
      onMeta: (m) => onMetaRef.current?.(m),
    });
    controller.start();
    return () => controller.stop();
  }, [store, sessionId, agentId]);

  return { store, fetchRows };
}
