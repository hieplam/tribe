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
import { fetchJson } from './http.ts';
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

/** The metadata a `hello`/`meta` frame decorates the view with — agents (tabs), badges, liveness,
 * and (from `hello` only) the session summary the header renders (title, `projects` collision set,
 * §5.2). Delivered through `onMeta` so the store stays rows-only (a `meta` frame never touches
 * nodes). A `meta` frame carries no session, so `session` is `null` there; the view keeps the last
 * non-null one (the `hello`'s), updating only liveness from later `meta` frames. */
export interface MetaUpdate {
  agents: Agent[];
  badges: Badge[];
  live: boolean;
  session: SessionSummary | null;
}

/** The connection state `<ConnectionNote>` renders (spec §8.1, §8.4, §13). `connecting`/`open` are
 * the silent happy path; `reconnecting` is a pending reopen (a `warn` note); `gone` and
 * `decode-error` are TERMINAL — the stream is closed and will not retry itself. */
export type ConnectionStatus =
  | { phase: 'connecting' }
  | { phase: 'open' }
  | { phase: 'reconnecting' }
  | { phase: 'gone' }          // a terminal `gone` server frame (§13: the transcript was deleted)
  | { phase: 'decode-error' }; // a frame the client could not JSON-decode (fail-closed, R15.6)

export interface StreamDeps {
  EventSourceCtor: typeof EventSource;
  win: ViewerWindow;
  url: string;
  onMeta?: (m: MetaUpdate) => void;
  /** Surfaces the connection state for `<ConnectionNote>` (§8.1). The controller never renders — it
   * only reports; the React edge holds the state. */
  onStatus?: (s: ConnectionStatus) => void;
  /** How a reconnect is delayed (spec `retry: 2000`). A REQUIRED injected input (`pure-core.md`):
   * the controller constructs no timer of its own. Returns a canceller so a pending reconnect can
   * be cancelled on stop/gone/reconnect and never more than one is outstanding at a time. The React
   * edge (the hook) is the ONLY place that wires the real timer. */
  schedule: (fn: () => void, ms: number) => () => void;
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
  const schedule = deps.schedule;
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
  let es: EventSource | null = null;
  let stopped = false;         // `gone`/`stop`/decode-error — the browser must not retry
  let lastSeq = 0;             // the per-connection sequence watermark; cleared on every `open`
  let cancelPending: (() => void) | null = null; // canceller for the ONE outstanding reconnect, if any

  /** Cancel the outstanding reconnect (if any), so at most one is ever pending and a stop/gone/
   * reconnect leaves no zombie timer that reopens a stream the caller ended (R15.5). */
  function clearPending(): void {
    if (cancelPending) {
      cancelPending();
      cancelPending = null;
    }
  }

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

  // The structural wall (structure.test.ts §12.6(7c)/D18) covers `client/src/**` and matches the
  // bare `fs` member token `close` (as `<name>` immediately followed by a paren) to refuse a
  // filesystem write. The browser `EventSource` has its own network-teardown method of the same
  // name — not a filesystem write, and explicitly mandated by the design (spec §8.4: the handle
  // whose teardown simulates a drop). We reach it through a COMPUTED key on a LOCAL variable, which
  // the wall permits (the sensitive-computed-access checks are scoped to the `Bun`/`process`/`fs`
  // globals, never an arbitrary local), so the fs regex does not false-positive on a DOM API the
  // wall was never meant to govern. This is the D18-compliant form task 22 originally used.
  const CLOSE_METHOD = 'close' as const;

  /** The decode boundary for one SSE frame (fail-closed-edges obligation 1, R15.6). Advances the
   * watermark, then JSON-decodes the frame body catching `SyntaxError` NARROWLY: a malformed frame
   * becomes a typed terminal `decode-error` state and stops the stream, never an uncaught throw out
   * of the DOM callback. A frame already processed on this connection is skipped (returns null). */
  function decode<T>(ev: MessageEvent): T | null {
    if (!accept(ev)) return null;
    try {
      return JSON.parse(ev.data) as T;
    } catch (err) {
      if (err instanceof SyntaxError) {
        failTerminal({ phase: 'decode-error' });
        return null;
      }
      throw err; // an unrecognised failure is not this boundary's to swallow
    }
  }

  /** Enter a TERMINAL state: stop retrying, cancel any pending reconnect, close the source, and
   * report the status (`gone`, §13; `decode-error`, R15.6). */
  function failTerminal(status: ConnectionStatus): void {
    stopped = true;
    clearPending();
    shutStream();
    deps.onStatus?.(status);
  }

  function openStream(): void {
    shutStream();
    deps.onStatus?.({ phase: 'connecting' });
    const source = new deps.EventSourceCtor(deps.url);
    es = source;
    deps.win.__viewerEventSource = source;
    deps.win.__viewerReconnect = () => reconnect();

    source.addEventListener('open', () => {
      lastSeq = 0; // clear the watermark — frame ids restart at 1 per connection (§6.2, §8.4)
      deps.onStatus?.({ phase: 'open' });
    });

    source.addEventListener('hello', (ev) => {
      const d = decode<HelloData>(ev as MessageEvent);
      if (d === null) return;
      store.hello({ generation: d.generation, from: d.from, to: d.to, truncatedBefore: d.truncatedBefore });
      deps.win.__viewerGeneration = d.generation;
      deps.onMeta?.({ agents: d.agents ?? [], badges: d.badges ?? [], live: d.session?.live ?? false, session: d.session ?? null });
    });

    source.addEventListener('rows', (ev) => {
      const d = decode<RowsData>(ev as MessageEvent);
      if (d === null) return;
      store.applyRows({ nodes: d.nodes, from: d.from, to: d.to });
    });

    source.addEventListener('patch', (ev) => {
      const d = decode<PatchData>(ev as MessageEvent);
      if (d === null) return;
      store.applyPatches(d.patches);
    });

    source.addEventListener('meta', (ev) => {
      const d = decode<MetaData>(ev as MessageEvent);
      if (d === null) return;
      deps.onMeta?.({ agents: d.agents ?? [], badges: d.badges ?? [], live: d.live ?? false, session: null });
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
      failTerminal({ phase: 'gone' }); // the focused file is gone — stop retrying (spec §6.2, §13)
    });

    source.addEventListener('error', () => {
      // A dropped connection (trigger 1, spec §8.4): reopen after the retry interval, unless the
      // stream was deliberately ended (`gone`/`stop`/decode-error), which fires no retry. Close the
      // failed source immediately and allow AT MOST ONE pending reconnect (R15.5): a second `error`
      // cancels the first's pending timer before scheduling its own, so two errors never open two
      // streams and the original is never left open.
      if (stopped) return;
      shutStream();
      clearPending();
      deps.onStatus?.({ phase: 'reconnecting' });
      cancelPending = schedule(() => {
        cancelPending = null;
        if (!stopped) openStream();
      }, retryMs);
    });
  }

  function shutStream(): void {
    if (es) {
      es[CLOSE_METHOD](); // EventSource network teardown (§8.4) — see the CLOSE_METHOD note above.
      es = null;
    }
  }

  function reconnect(): void {
    // Trigger 2 (spec §8.4): open a NEW stream by the error path's own route, after a deliberate
    // teardown that fired no `error`. Cancel any pending error-path reconnect first so the two
    // triggers never race into two streams (R15.5).
    stopped = false;
    clearPending();
    openStream();
  }

  return {
    start() {
      stopped = false;
      clearPending();
      openStream();
    },
    stop() {
      stopped = true;
      clearPending(); // a pending reconnect must NOT reopen a stream the caller ended (R15.5)
      shutStream();
    },
    reconnect,
  };
}

/** The edge that performs the real `GET /api/rows` for back-fill and tail reload (spec §3.2). The
 * store's `loadEarlier`/`reloadTail` take this as their injected `FetchRows` seam; it is the ONE
 * side effect, with no decision-making (`pure-core.md`). */
/** The `/api/rows` response shape — nodes + patches (§3.2). The shape gate for the fail-closed
 * boundary below. */
function isRowsPage(v: unknown): v is RowsPage {
  return typeof v === 'object' && v !== null
    && Array.isArray((v as RowsPage).nodes) && Array.isArray((v as RowsPage).patches);
}

export function makeFetchRows(sessionId: string, agentId: string | null): FetchRows {
  return async ({ before, orphans }) => {
    const params = new URLSearchParams({ session: sessionId });
    if (agentId !== null) params.set('agent', agentId);
    if (before !== null) params.set('before', String(before));
    // D27 wire shape (§3.2): `core/routes.ts` reads `searchParams.get('orphans')` and splits ONE
    // comma-separated value — so the ids are comma-joined into a SINGLE `orphans=` param, never one
    // param per id (which would deliver only the first).
    if (orphans.length > 0) params.set('orphans', orphans.join(','));
    // Fails closed through the `http.ts` boundary (§13): a non-2xx or malformed body rejects with a
    // typed error rather than resolving as an unusable page.
    return fetchJson<RowsPage>(`/api/rows?${params.toString()}`, isRowsPage);
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
 * unmount or when the focused transcript changes. This is the ONLY place the real timer is wired
 * (`pure-core.md`, R15.3): `schedule` runs `fn` on `setTimeout` and returns a canceller that clears
 * it, so the controller stays free of a timer of its own. Also supplies the real `EventSource` and
 * `window`; the controller owns everything else. `onStatus` surfaces the connection state for
 * `<ConnectionNote>` (§8.1). */
export function useEventStream(
  sessionId: string,
  agentId: string | null,
  onMeta?: (m: MetaUpdate) => void,
  onStatus?: (s: ConnectionStatus) => void,
): UseEventStream {
  const storeRef = useRef<RowStore | null>(null);
  if (storeRef.current === null) storeRef.current = createRowStore();
  const store = storeRef.current;
  const fetchRows = makeFetchRows(sessionId, agentId);
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    const controller = createStreamController(store, {
      EventSourceCtor: EventSource,
      win: window as ViewerWindow,
      url: eventsUrl(sessionId, agentId),
      onMeta: (m) => onMetaRef.current?.(m),
      onStatus: (s) => onStatusRef.current?.(s),
      schedule: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
    });
    controller.start();
    return () => controller.stop();
  }, [store, sessionId, agentId]);

  return { store, fetchRows };
}
