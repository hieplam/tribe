// core/sse.ts — task 13: SSE frame encoding, per-stream sequence ids, and 1 MiB frame batching
// (spec §6.2, §14; D12, D15, D27). Pure module: `generation` and `seq` arrive as arguments from
// the caller; nothing here reads the clock, the filesystem, the network, or ambient env
// (`pure-core.md`). D12: the server ignores the reconnecting browser's resume header entirely,
// so this module carries no support for reading or parsing it — not even a stub.

import type { Agent, Badge, Patch, RenderNode, SessionSummary } from './model.ts';

const RETRY_MS = 2000;

/** Matches the two Unicode line/paragraph separators JSON.stringify leaves unescaped verbatim. */
const UNICODE_LINE_TERMINATORS = /[\u2028\u2029]/g;

/** One SSE frame of the §6.2 wire contract. Discriminated on `event`. */
export type SseFrame =
  | {
      event: 'hello';
      data: {
        generation: string;
        session: SessionSummary;
        agents: Agent[];
        badges: Badge[];
        from: number;
        to: number;
        truncatedBefore: boolean;
      };
    }
  | { event: 'rows'; data: { nodes: RenderNode[]; from: number; to: number } }
  | { event: 'patch'; data: { patches: Patch[] } }
  | { event: 'meta'; data: { agents: Agent[]; badges: Badge[]; live: boolean } }
  | { event: 'reset'; data: { reason: 'truncated' | 'rotated' } }
  | { event: 'ping'; data: { t: string } }
  | { event: 'gone'; data: { reason: 'deleted' } };

export type { Patch };

/** Serializes `data` to a single-line JSON string. `JSON.stringify` escapes a raw newline inside
 * a string value as `\n`, so it never produces a literal blank-line sequence on the wire — but it
 * leaves U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) unescaped verbatim, and both are
 * treated as line terminators by other tooling (including a JS regex's `.`), so they are escaped
 * here explicitly. Some payloads cannot be serialized at all (a BigInt, a cyclic object) —
 * `JSON.stringify` throws a `TypeError` for both — and `undefined` serializes to `undefined` (not
 * a string) rather than throwing. Both edge cases fall back to the JSON literal `null` so the
 * frame stays well-formed (fail-closed-edges obligation 1: catch the specific exception the input
 * can raise, never a bare catch). */
function serializePayload(data: unknown): string {
  try {
    const json = JSON.stringify(data);
    if (json === undefined) return 'null';
    return json.replace(UNICODE_LINE_TERMINATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
  } catch (err) {
    if (err instanceof TypeError) return 'null';
    throw err;
  }
}

/** Encodes one `SseFrame` as an SSE wire record: an optional leading `retry:` line, then
 * `event:`, `id:`, and `data:` lines, terminated by the blank line that closes an SSE record.
 * `seq` is the caller-owned per-stream monotonic sequence number (D12) — this module never
 * generates or tracks it itself. `retry:` is written once, in the first frame of every response
 * (spec §6.2) — `hello` is always that first frame ("once, on connect"), so the gate is the
 * frame's own event kind together with `seq === 1`, never a bare seq check that would also fire
 * on an out-of-band `rows`/`ping` frame someone happens to encode at seq 1. */
export function encodeFrame(frame: SseFrame, seq: number): string {
  const lines: string[] = [];
  if (frame.event === 'hello' && seq === 1) lines.push(`retry: ${RETRY_MS}`);
  lines.push(`event: ${frame.event}`);
  lines.push(`id: ${seq}`);
  lines.push(`data: ${serializePayload(frame.data)}`);
  return `${lines.join('\n')}\n\n`;
}

/** The largest value `seq`, `from`, or `to` can validly take on the wire — beyond
 * `Number.MAX_SAFE_INTEGER` a JS number can no longer address a distinct integer. Measuring a
 * candidate batch's encoded size against THIS, rather than against a `0`/`1` placeholder, is what
 * makes the bound below hold for whatever real, wider `seq`/`from`/`to` the composition root
 * substitutes once it decides emission order — not just the narrowest envelope a test happened to
 * measure with. A placeholder envelope (`from:0, to:0, seq:1`) undercounts a real frame's bytes by
 * up to 45 (three numeric fields, each up to 15 digits wider than its 1-digit placeholder), and a
 * batch measured "just under the cap" against it can encode past the cap once the real numbers
 * replace it — the Phase-1 audit's exact finding (measured 1,048,576; real-envelope encode
 * 1,048,593). */
const MEASURE_MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Splits `items` into as many frames as it takes so that no candidate batch, once turned into an
 * encoded frame by `frameBytesFor`, exceeds `maxBytes`. Shared by `batchFrames` and
 * `batchPatches` — both are "keep adding until the next item would tip the encoded frame over the
 * cap", differing only in what they batch and how they build the candidate frame. */
function batchBySize<T>(items: T[], maxBytes: number, frameBytesFor: (batch: T[]) => number): T[][] {
  if (items.length === 0) return [];

  const batches: T[][] = [];
  let current: T[] = [];

  for (const item of items) {
    const candidate = [...current, item];
    if (current.length > 0 && frameBytesFor(candidate) > maxBytes) {
      batches.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);

  return batches;
}

/** Splits `nodes` into as many `rows` frames as it takes so that no single encoded frame exceeds
 * `maxBytes` (spec §6.2, §14). Every node appears exactly once, in the order given. There is no
 * "oversized node" branch: D15 (task 9) bounds every node at 64 KiB upstream, so a node larger
 * than the frame cap cannot occur here — this function only ever needs to decide how many nodes
 * fit together, never what to do with one that alone exceeds the cap. Measured against
 * `MEASURE_MAX_SAFE`'s worst-case `from`/`to`/`seq`, never a `0`/`0`/`1` placeholder (see
 * `MEASURE_MAX_SAFE`'s doc) — the caller still fills in the real window bounds and a real
 * sequence id when it actually emits each batch as a frame; this only changes what the batching
 * DECISION is measured against, not what gets encoded. */
export function batchFrames(nodes: RenderNode[], maxBytes: number): RenderNode[][] {
  const encoder = new TextEncoder();
  const frameBytesFor = (batch: RenderNode[]): number =>
    encoder.encode(
      encodeFrame(
        { event: 'rows', data: { nodes: batch, from: MEASURE_MAX_SAFE, to: MEASURE_MAX_SAFE } },
        MEASURE_MAX_SAFE,
      ),
    ).length;
  return batchBySize(nodes, maxBytes, frameBytesFor);
}

/** Splits `patches` into as many `patch` frames as it takes so that no single encoded frame
 * exceeds `maxBytes` (spec §6.2/§6.4, §14). A `patch` frame carries a node array too — an
 * `{op:"result"}` patch's `node` is a full `RenderNode`, bounded at 64 KiB by D15 exactly like a
 * `rows` node — so it needs the identical batching guarantee `batchFrames` gives `rows`. Before
 * this function existed, patch frames were never split at all: 18 sub-64-KiB result patches sent
 * as one frame encoded to 1,083,232 bytes (the Phase-1 audit's second finding). Every patch
 * appears exactly once, in the order given. There is no "oversized patch" branch for the same
 * reason `batchFrames` has none: D15 bounds the one variable-size part (`node`) upstream. */
export function batchPatches(patches: Patch[], maxBytes: number): Patch[][] {
  const encoder = new TextEncoder();
  const frameBytesFor = (batch: Patch[]): number =>
    encoder.encode(encodeFrame({ event: 'patch', data: { patches: batch } }, MEASURE_MAX_SAFE)).length;
  return batchBySize(patches, maxBytes, frameBytesFor);
}
