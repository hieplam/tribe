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

/** Splits `nodes` into as many `rows` frames as it takes so that no single encoded frame exceeds
 * `maxBytes` (spec §6.2, §14). Every node appears exactly once, in the order given. There is no
 * "oversized node" branch: D15 (task 9) bounds every node at 64 KiB upstream, so a node larger
 * than the frame cap cannot occur here — this function only ever needs to decide how many nodes
 * fit together, never what to do with one that alone exceeds the cap. `from`/`to` are dummy
 * bounds (0) for measurement purposes only; the caller fills in the real window bounds when it
 * actually emits each batch as a frame. */
export function batchFrames(nodes: RenderNode[], maxBytes: number): RenderNode[][] {
  if (nodes.length === 0) return [];

  const encoder = new TextEncoder();
  const frameBytes = (batch: RenderNode[]): number =>
    encoder.encode(encodeFrame({ event: 'rows', data: { nodes: batch, from: 0, to: 0 } }, 1)).length;

  const batches: RenderNode[][] = [];
  let current: RenderNode[] = [];

  for (const node of nodes) {
    const candidate = [...current, node];
    if (current.length > 0 && frameBytes(candidate) > maxBytes) {
      batches.push(current);
      current = [node];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);

  return batches;
}
