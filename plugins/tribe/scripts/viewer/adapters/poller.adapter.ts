// adapters/poller.adapter.ts — Task 19. ONE poll loop per open SSE stream, and the package's ONLY
// clock owner (spec §4, §6). This file OBSERVES and EMITS; it DECIDES nothing (`pure-core.md`):
//
//   - which bytes form complete rows, where a live tail stands, and whether the file rotated or
//     truncated  ->  `core/tail.ts#advanceTail` (pure, over raw bytes, D13);
//   - what the initial/reset window is  ->  `core/window.ts#findWindow` — the SAME function
//     `/api/rows` uses (D31), never a second implementation;
//   - what a row becomes, and how a `tool_use` pairs with its later `tool_result`  ->
//     `core/normalize.ts` + `core/pair.ts` (§6.4);
//   - how a frame is encoded, sequence-numbered and split at the 1 MiB cap  ->  `core/sse.ts`.
//
// Everything world-touching arrives through the injected `io` (stat / ranged read / a meta
// snapshot), and the clock (`now`) and scheduler (`schedule`) are injected too — so this file
// names no `node:fs` / `node:child_process` / `node:net` import of its own, and a test drives it
// with a controllable tick instead of a real timer. D12: a reconnect is a fresh snapshot handled
// entirely in `serve.ts` (a new poller, a new `generation`); this loop carries no resume state and
// never reads `Last-Event-ID`.
import { advanceTail, type TailState } from '../core/tail.ts';
import { candidatesFromRows, findWindow, type FindWindowResult, type ReadBack } from '../core/window.ts';
import { createPairState, pair, type PairState } from '../core/pair.ts';
import { batchFrames, batchPatches, encodeFrame, type SseFrame } from '../core/sse.ts';
import type { Agent, Badge, FileObservation, Patch, RenderNode, SessionSummary } from '../core/model.ts';

/** Poll interval (spec §6.2): 250 ms leaves room within G2's 1 s budget for parse + transport. */
export const POLL_INTERVAL_MS = 250;
/** Per-tick read cap (spec §6.2/§6.5): the remainder arrives next tick, losslessly, because the
 * tail advances only by bytes actually consumed. */
const TICK_READ_CAP = 4 * 1024 * 1024;
/** 1 MiB SSE frame cap (spec §6.2/§6.5). `core/sse.ts` bounds each node at 64 KiB (D15), so a
 * `rows`/`patch` frame is bounded by splitting alone — no oversized-node branch. */
const FRAME_MAX_BYTES = 1024 * 1024;
/** Keep-alive interval (spec §6.2). */
const PING_INTERVAL_MS = 15_000;
/** The initial/reset window is the last 500 pre-pairing candidate nodes (spec §6.3, D21). */
const DEFAULT_WINDOW_LIMIT = 500;

const EMPTY = new Uint8Array(0);

/** The point-in-time metadata that decorates a focused session view (spec §6.2). The poller reads
 * one of these on connect (for `hello`) and once per tick (to detect a change — a new sidecar, a
 * badge, a liveness flip — and forward it as a `meta` frame). It is supplied by the composition
 * root (`serve.ts`), which owns the scan; this file only compares and forwards. */
export interface PollerMeta {
  session: SessionSummary;
  agents: Agent[];
  badges: Badge[];
  live: boolean;
}

/** The injected world contact — every read the poller makes, and nothing else. `serve.ts` wires
 * the real `fs.adapter` reads and the real scan behind it; a test supplies an in-memory fake. */
export interface PollerIo {
  stat(path: string): FileObservation | null;
  readRange(path: string, start: number, end: number): Uint8Array;
  readMeta(): PollerMeta;
}

export interface CreatePollerInput {
  io: PollerIo;
  /** The resolved, contained transcript file this stream tails (`serve.ts` resolves it once). */
  path: string;
  intervalMs: number;
  /** Minted fresh per connection by the composition root (D12); carried verbatim onto `hello`. */
  generation: string;
  /** Receives each already-encoded SSE wire record. `serve.ts` enqueues it onto the response. */
  emit: (encoded: string) => void;
  /** Injected clock (epoch ms). Defaults to the real one — this adapter is the only clock owner. */
  now?: () => number;
  /** Injected scheduler. Defaults to `setInterval`; a test captures the callback to tick by hand. */
  schedule?: (fn: () => void, ms: number) => { stop: () => void };
  /** Window node limit (spec §6.3); defaults to 500. */
  limit?: number;
}

function defaultSchedule(fn: () => void, ms: number): { stop: () => void } {
  const handle = setInterval(fn, ms);
  return { stop: () => clearInterval(handle) };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Splits a byte buffer that ENDS exactly at a `0x0A` (the confirmed-rows range `advanceTail`
 * marked complete this tick) into one `Uint8Array` per row, each excluding its terminating
 * newline — the forward-order shape `core/window.ts#candidatesFromRows` consumes. There is no
 * trailing partial segment by construction: the range ends on a newline, so the loop's `start`
 * lands exactly at `buf.length`. */
function splitRows(buf: Uint8Array): Uint8Array[] {
  const rows: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      rows.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  return rows;
}

/** The `{agents, badges, live}` fingerprint used to detect a meta change across ticks — NOT the
 * session summary, whose `sizeBytes`/`mtime` change on every growth tick and would otherwise emit
 * a `meta` frame every 250 ms. Only the three fields the `meta` frame actually carries (spec §6.2)
 * decide whether it fires. */
function metaKey(meta: PollerMeta): string {
  return JSON.stringify({ agents: meta.agents, badges: meta.badges, live: meta.live });
}

export function createPoller(input: CreatePollerInput): { stop: () => void } {
  const { io, path, intervalMs, generation, emit } = input;
  const now = input.now ?? (() => Date.now());
  const schedule = input.schedule ?? defaultSchedule;
  const limit = input.limit ?? DEFAULT_WINDOW_LIMIT;

  const readBack: ReadBack = (end, len) => io.readRange(path, end - len, end);

  // Per-stream state — all bounded (spec §6.5): the tail carry (<= ROW_CAP), one pending-tool map
  // (<= 512 in core/pair.ts), a sequence counter, and a meta fingerprint. Nothing here grows with
  // the transcript's total size (D7).
  let state: TailState = { offset: 0, carry: EMPTY, ackOffset: 0, inode: 0, skipping: false, rowStart: 0, skippedBytes: 0 };
  let pairState: PairState = createPairState();
  let seq = 0;
  let lastMetaKey = '';
  let lastPingAtMs = now();
  let stopped = false;
  let scheduled: { stop: () => void } | null = null;

  function stopInternal(): void {
    if (stopped) return;
    stopped = true;
    scheduled?.stop();
  }

  function emitFrame(frame: SseFrame): void {
    seq += 1;
    emit(encodeFrame(frame, seq));
  }

  /** `rows`/`patch` are the only variable-length frames; both are split so no encoded frame
   * exceeds the 1 MiB cap (spec §6.2), each batch carrying its own incrementing `id:`. */
  function emitRows(nodes: RenderNode[], from: number, to: number): void {
    for (const batch of batchFrames(nodes, FRAME_MAX_BYTES)) {
      emitFrame({ event: 'rows', data: { nodes: batch, from, to } });
    }
  }
  function emitPatches(patches: Patch[]): void {
    for (const batch of batchPatches(patches, FRAME_MAX_BYTES)) {
      emitFrame({ event: 'patch', data: { patches: batch } });
    }
  }

  /** Seeds the forward tail from `findWindow`'s result (D30): `ackOffset := to`, `carry :=
   * carrySeed`, `offset := eof` — so the invariant `offset == ackOffset + carry.length` holds from
   * tick one and the next read starts at `eof`, never re-reading the carry. */
  function seedFromWindow(obs: FileObservation): FindWindowResult {
    const win = findWindow(readBack, obs.sizeBytes, limit);
    state = { offset: obs.sizeBytes, carry: win.carrySeed, ackOffset: win.to, inode: obs.inode, skipping: false, rowStart: 0, skippedBytes: 0 };
    return win;
  }

  /** The window's display nodes, with each in-window `tool_use`/`tool_result` pair already merged
   * into one complete `tool` node — the SAME outcome `/api/rows` produces (D31). Crucially it runs
   * over the PERSISTENT `pairState`, so a `tool_use` whose result is NOT yet in the window stays in
   * the pending map and its later live result becomes a `patch` (§6.4). */
  function buildWindowNodes(win: FindWindowResult): RenderNode[] {
    const candidates = candidatesFromRows(win.rows, win.from);
    const { nodes, patches } = pair(candidates, pairState);
    const indexById = new Map<string, number>();
    nodes.forEach((n, i) => indexById.set(n.id, i));
    const merged = nodes.slice();
    for (const patch of patches) {
      if (patch.op !== 'result') continue;
      const idx = indexById.get(patch.id);
      if (idx !== undefined) merged[idx] = patch.node;
    }
    return merged;
  }

  function maybeMeta(): void {
    const meta = io.readMeta();
    const key = metaKey(meta);
    if (key === lastMetaKey) return;
    lastMetaKey = key;
    emitFrame({ event: 'meta', data: { agents: meta.agents, badges: meta.badges, live: meta.live } });
  }

  function maybePing(): void {
    const t = now();
    if (t - lastPingAtMs < PING_INTERVAL_MS) return;
    lastPingAtMs = t;
    emitFrame({ event: 'ping', data: { t: new Date(t).toISOString() } });
  }

  function runConnect(): void {
    const obs = io.stat(path);
    if (obs === null) {
      emitFrame({ event: 'gone', data: { reason: 'deleted' } });
      stopInternal();
      return;
    }
    const win = seedFromWindow(obs);
    const meta = io.readMeta();
    lastMetaKey = metaKey(meta);
    const windowNodes = buildWindowNodes(win);
    emitFrame({
      event: 'hello',
      data: { generation, session: meta.session, agents: meta.agents, badges: meta.badges, from: win.from, to: win.to, truncatedBefore: win.truncatedBefore },
    });
    emitRows(windowNodes, win.from, win.to);
    lastPingAtMs = now();
  }

  function handleReset(obs: FileObservation, prevOffset: number): void {
    // `advanceTail` already decided a reset fired (spec §6.1's two triggers); it does not expose
    // WHICH, so the reason is re-derived from the same inputs it used: a shrink past the last read
    // offset is a truncation, otherwise (same/larger size with a changed inode) a rotation.
    const reason: 'truncated' | 'rotated' = obs.sizeBytes < prevOffset ? 'truncated' : 'rotated';
    emitFrame({ event: 'reset', data: { reason } });
    // Drop tail + pairing state and stream the NORMAL tail window of the file as it now is (spec
    // §6.1) — never the file from byte 0.
    pairState = createPairState();
    const win = seedFromWindow(obs);
    emitRows(buildWindowNodes(win), win.from, win.to);
  }

  function runTick(): void {
    const obs = io.stat(path);
    if (obs === null) {
      emitFrame({ event: 'gone', data: { reason: 'deleted' } });
      stopInternal();
      return;
    }

    const prevOffset = state.offset;
    const prevCarry = state.carry;
    const readEnd = Math.min(obs.sizeBytes, prevOffset + TICK_READ_CAP);
    const chunk = readEnd > prevOffset ? io.readRange(path, prevOffset, readEnd) : EMPTY;

    const tick = advanceTail(state, chunk, obs);
    state = tick.state;

    if (tick.reset) {
      handleReset(obs, prevOffset);
      maybeMeta();
      maybePing();
      return;
    }

    // The rows `advanceTail` confirmed complete this tick occupy `[absBase, ackOffset)`, where
    // `absBase` is where `combined` (the carry re-joined with the new bytes) begins in the file —
    // exactly `advanceTail`'s own internal accounting. Re-deciding the row boundaries would be
    // deciding; instead the confirmed bytes are handed to `candidatesFromRows`, which walks the
    // offsets and normalizes each row (`pure-core.md`). An oversized row `advanceTail` already
    // discarded surfaces through `tick.oversized`, carrying its own true anchor.
    const absBase = prevOffset - prevCarry.length;
    const confirmedLen = state.ackOffset - absBase;
    let newNodes: RenderNode[] = [];
    if (confirmedLen > 0) {
      const confirmed = concatBytes(prevCarry, chunk).subarray(0, confirmedLen);
      let off = absBase;
      for (const rowBytes of splitRows(confirmed)) {
        for (const node of candidatesFromRows([rowBytes], off)) newNodes.push(node);
        off += rowBytes.length + 1;
      }
    }
    if (tick.oversized.length > 0) {
      newNodes = [...tick.oversized, ...newNodes].sort((a, b) => a.at - b.at || a.i - b.i);
    }

    if (newNodes.length > 0) {
      const { nodes, patches } = pair(newNodes, pairState);
      // Order matters (spec §6.4 point 3): the `patch` follows the `rows` frame, because a patch
      // may target a node emitted in the same tick.
      if (nodes.length > 0) emitRows(nodes, absBase, state.ackOffset);
      if (patches.length > 0) emitPatches(patches);
    }

    maybeMeta();
    maybePing();
  }

  function runTickGuarded(): void {
    try {
      runTick();
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      // A live poll loop that throws (an unexpected read failure) must neither spin every
      // `intervalMs` nor leak a traceback into the event loop (`fail-closed-edges`): stop the
      // stream. The SSE client reconnects on its own `retry:` and gets a fresh snapshot (D12).
      stopInternal();
    }
  }

  try {
    runConnect();
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    stopInternal();
  }
  if (!stopped) scheduled = schedule(runTickGuarded, intervalMs);

  return { stop: stopInternal };
}
