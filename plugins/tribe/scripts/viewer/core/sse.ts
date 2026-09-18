// core/sse.ts — task 13: SSE frame encode/decode, per-stream sequence ids, and 1 MiB frame
// batching (spec §3.1, §6.2, §14; D12, D15, D27). Pure module: `generation` and `seq` arrive as
// arguments from the caller; nothing here reads the clock, the filesystem, the network, or
// ambient env (`pure-core.md`). D12: the server ignores the reconnecting browser's resume header
// entirely, so this module carries no support for reading or parsing it — not even a stub.
// `encodeFrame` bounds every emitted frame type at 1 MiB: `rows`/`patch` via the `batchFrames`/
// `batchPatches` splitters below, `hello`/`meta` via a label/model/agentType-truncation fallback
// inside `encodeFrame` itself (see `FRAME_MAX_BYTES`'s doc). `decodeFrame` is the production
// counterpart.

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

const wireEncoder = new TextEncoder();

/** Byte length of a string once written to the wire (UTF-8) — the same unit the 1 MiB cap is
 * measured in. */
function encodedByteLength(s: string): number {
  return wireEncoder.encode(s).length;
}

/** The 1 MiB SSE frame cap (spec §6.2, §14). `rows`/`patch` reach it via splitting
 * (`batchFrames`/`batchPatches` below) because they carry an array the caller controls the size
 * of. `hello` and `meta` cannot be split the same way — `hello` is emitted exactly once per
 * connection and `meta` is a single point-in-time snapshot, so there is no "next frame" to
 * overflow into. The fields on both that can grow without bound are `Agent.label`,
 * `Agent.model`, and `Agent.agentType` — all three are copied verbatim from `meta.json`, which
 * spec §5.5 / `subagents.ts:11` declare UNTRUSTED input, so none of them can be assumed short
 * (Phase-1 audit's probe: 20 agents x 60,000-char labels => 1,203,531 B unbounded; the final
 * audit's probe: 18 agents x 60,000-byte `model` => 1,083,118 B, identical overflow via
 * `agentType`). An oversized `hello`/`meta` is bounded by truncating all three fields on every
 * agent to a shared budget, halved until the actual encoded frame fits — the same
 * halve-until-it-fits shape `normalize.ts`'s `elideToFit` uses for a single node, generalized
 * here to the three variable-length untrusted string fields both frame kinds carry. */
const FRAME_MAX_BYTES = 1024 * 1024;

/** Truncates one string field to at most `budget` UTF-16 code units — the SAME `.slice(0,
 * budget)` truncation the `label` path always used, now shared across `label`, `model`, and
 * `agentType` instead of hand-rolled per field. A `null` field (an absent `model`/`agentType`,
 * per spec §5.5's `meta.json` shape) passes through untouched: `null` cannot overflow the frame.
 *
 * `value` is UNTRUSTED (spec §5.5), so it can legally contain an astral character (outside the
 * BMP), which is encoded as a UTF-16 surrogate PAIR — two code units. `.slice(0, budget)` is a
 * code-UNIT cut, so a `budget` landing between the two halves of a pair would leave a lone high
 * surrogate dangling at the end of the result. This never splits a surrogate pair: a prefix slice
 * of a well-formed string can only ever leave a dangling HIGH surrogate (0xD800-0xDBFF) at the
 * very end — never a low one, since a low surrogate can only appear paired right after a high one
 * that survived the same cut — so checking just the last code unit is sufficient (mirrors
 * `normalize.ts`'s `truncateUtf8`, which gives the same guarantee for its byte-budget cut). The
 * budget stays measured in code units, exactly as before: `encodeFrame`'s halve-until-it-fits
 * fallback still terminates, since dropping at most one extra code unit cannot turn a
 * strictly-decreasing halving sequence into a non-terminating one. */
function truncateField(value: string, budget: number): string {
  if (value.length <= budget) return value;
  const sliced = value.slice(0, budget);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) return sliced.slice(0, -1);
  return sliced;
}

function boundAgentFields<T extends { agents: Agent[] }>(data: T, budget: number): T {
  if (budget < 0) return data;
  return {
    ...data,
    agents: data.agents.map((a) => ({
      ...a,
      label: truncateField(a.label, budget),
      model: a.model === null ? null : truncateField(a.model, budget),
      agentType: a.agentType === null ? null : truncateField(a.agentType, budget),
    })),
  };
}

/** Builds the wire text for one frame with `data` already resolved — shared by the fast path
 * (unbounded `frame.data`) and the fallback path (a `hello`/`meta` payload with truncated agent
 * label/model/agentType fields) so both go through identical envelope logic
 * (`retry:`/`event:`/`id:` lines). */
function frameText(event: SseFrame['event'], seq: number, data: unknown): string {
  const lines: string[] = [];
  if (event === 'hello' && seq === 1) lines.push(`retry: ${RETRY_MS}`);
  lines.push(`event: ${event}`);
  lines.push(`id: ${seq}`);
  lines.push(`data: ${serializePayload(data)}`);
  return `${lines.join('\n')}\n\n`;
}

/** Encodes one `SseFrame` as an SSE wire record: an optional leading `retry:` line, then
 * `event:`, `id:`, and `data:` lines, terminated by the blank line that closes an SSE record.
 * `seq` is the caller-owned per-stream monotonic sequence number (D12) — this module never
 * generates or tracks it itself. `retry:` is written once, in the first frame of every response
 * (spec §6.2) — `hello` is always that first frame ("once, on connect"), so the gate is the
 * frame's own event kind together with `seq === 1`, never a bare seq check that would also fire
 * on an out-of-band `rows`/`ping` frame someone happens to encode at seq 1.
 *
 * `hello`/`meta` additionally never exceed `FRAME_MAX_BYTES`: the common case (label/model/
 * agentType all well under the cap) pays only the one extra length check below; only an
 * oversized frame pays for the field-truncation fallback. */
export function encodeFrame(frame: SseFrame, seq: number): string {
  const unbounded = frameText(frame.event, seq, frame.data);
  if (frame.event !== 'hello' && frame.event !== 'meta') return unbounded;
  if (encodedByteLength(unbounded) <= FRAME_MAX_BYTES) return unbounded;

  const data = frame.data as { agents: Agent[] };
  let budget = Math.max(0, ...data.agents.map((a) => Math.max(a.label.length, a.model?.length ?? 0, a.agentType?.length ?? 0)));
  let candidate = unbounded;
  while (encodedByteLength(candidate) > FRAME_MAX_BYTES && budget > 0) {
    budget = Math.floor(budget / 2);
    candidate = frameText(frame.event, seq, boundAgentFields(data, budget));
  }
  return candidate;
}

/** One decoded SSE frame: the typed `event`/`data` pair plus the wire's `id:` sequence number.
 * `SseFrame`'s discriminated union is preserved — narrowing on `.event` narrows `.data` exactly as
 * it does for an `SseFrame`, so a caller reading a `patch` frame's `remove` op still cannot reach
 * a `node` field that was never on the wire. */
export type DecodedFrame = SseFrame & { id: number };

/** Parses one encoded SSE record — the exact text `encodeFrame` produces — back into its typed
 * `event`/`id`/`data`. This is the production counterpart `encodeFrame` never had (spec §3.1 lists
 * `sse.ts` as "frame encode/decode"); it round-trips every frame type, including `patch`'s two ops
 * (`{op:"result",...,node}` vs `{op:"remove",id}` — `JSON.parse` never fabricates an absent key, so
 * a `remove` decoded here carries no `node`, exactly as encoded). It never reads or references the
 * browser's reconnect-resume header (D12: the server ignores it) — this decodes the module's OWN
 * frame text, not a request header. Malformed input (missing `event:`/`id:`/`data:` lines) fails
 * closed with a clear error rather than returning a partially-populated frame. */
export function decodeFrame(encoded: string): DecodedFrame {
  const body = encoded.endsWith('\n\n') ? encoded.slice(0, -2) : encoded;
  const lines = body.split('\n');
  const eventLine = lines.find((l) => l.startsWith('event: '));
  const idLine = lines.find((l) => l.startsWith('id: '));
  const dataLine = lines.find((l) => l.startsWith('data: '));
  if (eventLine === undefined || idLine === undefined || dataLine === undefined) {
    throw new Error(`malformed SSE frame: missing event:/id:/data: line in ${JSON.stringify(encoded)}`);
  }
  const event = eventLine.slice('event: '.length) as SseFrame['event'];
  const id = Number(idLine.slice('id: '.length));
  const data = JSON.parse(dataLine.slice('data: '.length)) as unknown;
  return { event, data, id } as DecodedFrame;
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
