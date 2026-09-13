/**
 * core/window.ts — pure line-boundary decisions over raw bytes (spec §5.3, §6.3), never I/O. This
 * module owns "which bytes form complete lines" so the adapter performs only `stat` and "read
 * bytes [a, b)" and decides nothing (`pure-core.md`). §5.3's bounded head/tail reads both use
 * `completeLines` to decide what to keep without ever guessing at a line that is not wholly
 * present in the buffer.
 *
 * `findWindow` (task 18, D31) is the backward one-row-at-a-time newline walk of spec §6.3/D26/D30
 * that finds the last ~`limit` pre-pairing candidate nodes' worth of whole rows, counting from the
 * end of the file backward, with the read injected — the ONLY world contact — so the decision
 * procedure (doubling newline search, the oversized branch, candidate accumulation, the whole-row
 * trim) is unit-testable over an in-memory buffer rather than graded Blocker/Should-fix by
 * `pure-core.md` for needing a live filesystem. `hello` (task 19) and `/api/rows` (task 18, this
 * file's caller in `serve.ts`) both call this SAME function — one implementation, two entry points.
 */
import { ROW_CAP } from './tail.ts';
import { countCandidates, normalize, type RowInput } from './normalize.ts';
import { parseRecordLines } from './records.ts';
import type { Patch, RenderNode } from './model.ts';
import { createPairState, pair } from './pair.ts';

const decoder = new TextDecoder('utf-8');

/**
 * Splits `bytes` on `0x0A` — raw bytes, never a decoded string first, the same discipline
 * `core/tail.ts#advanceTail` uses (D13) — and returns only WHOLE lines.
 *
 * Any bytes after the LAST `0x0A` are an incomplete trailing line: there is no way to know they
 * are complete without a following byte, so they are always dropped, never returned. When
 * `dropLeadingPartial` is true, the bytes before the FIRST `0x0A` are ALSO dropped — spec §5.3's
 * tail read starts at an arbitrary byte offset, so its first segment is very often a partial row
 * cut from the middle; the head read starts at byte 0, where the first segment is always whole,
 * so it passes `false`. A buffer with no `0x0A` at all has zero confirmed complete lines, however
 * `dropLeadingPartial` is set.
 */
export function completeLines(bytes: Uint8Array, dropLeadingPartial: boolean): string[] {
  const lines: string[] = [];
  let start = 0;
  let sawFirstBoundary = false;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    const dropThisSegment = !sawFirstBoundary && dropLeadingPartial;
    if (!dropThisSegment) lines.push(decoder.decode(bytes.subarray(start, i)));
    start = i + 1;
    sawFirstBoundary = true;
  }
  // Bytes from `start` to the end (if any) are the trailing partial line — never returned.
  return lines;
}

// ---------------------------------------------------------------------------------------------
// D31/D26/D30/D20/D21 — the backward window reader.
// ---------------------------------------------------------------------------------------------

/** Injected: the ONLY world contact `findWindow` makes. Returns the `len` bytes ending at `end`
 * (i.e. `[end - len, end)`), exactly as read from the real file — the adapter's job; this module
 * decides nothing about HOW those bytes are fetched. */
export type ReadBack = (end: number, len: number) => Uint8Array;

export interface FindWindowResult {
  /** Retained rows, in FILE order (oldest first). A normal row is its own raw bytes, `[start,
   * end)`, excluding the terminating `0x0A`. An OVERSIZED row (D26) retains NOTHING of its own
   * bytes — instead this entry carries the complete, already-built `raw`/`oversized` `RenderNode`
   * (spec §4), NUL-prefixed and JSON-encoded (`encodeOversizedMarker`/`decodeOversizedMarker`
   * below), so the one node D26 requires still travels through this single return shape without
   * ever retaining the oversized row's real content. `candidatesFromRows` is the one place that
   * decodes either shape back out. */
  rows: Uint8Array[];
  /** The first retained row's byte offset (D20) — the boundary a `before` back-fill passes back. */
  from: number;
  /** One past the last COMPLETE row (D30) — never EOF. */
  to: number;
  /** True iff any row precedes `from` (D20) — NOT "BOF was not reached". */
  truncatedBefore: boolean;
  /** `[to, eof)` — the file's genuinely-partial tail row, if any (D30). Never parsed as a row. */
  carrySeed: Uint8Array;
}

// The backward newline scan walks the file in FIXED chunks of this size rather than one
// ever-doubling slice: a row with no `0x0A` for millions of bytes must never make a single read
// (and thus a single `Buffer.alloc` in the adapter) grow to the whole file (spec §6.5 "rows of any
// size"). The result is identical — the largest offset `< end` carrying a `0x0A` — only the memory
// footprint per read is now bounded and independent of the remaining transcript size.
const SCAN_CHUNK = 256 * 1024; // 256 KiB per backward step.
const OVERSIZED_MARKER_BYTE = 0x00; // never the first byte of real transcript JSONL (always `{`).

function encodeOversizedMarker(node: RenderNode): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(node));
  const out = new Uint8Array(json.length + 1);
  out[0] = OVERSIZED_MARKER_BYTE;
  out.set(json, 1);
  return out;
}

/** `null` for anything that is not a marker this module itself produced — a real transcript row's
 * first byte is always `{` (never NUL), so this can never misfire on genuine content. Narrow catch
 * (`fail-closed-edges` obligation 1): a malformed marker degrades to "not a marker" rather than
 * throwing, though in practice only this module ever writes the NUL prefix. */
function decodeOversizedMarker(bytes: Uint8Array): Extract<RenderNode, { k: 'raw' }> | null {
  if (bytes.length === 0 || bytes[0] !== OVERSIZED_MARKER_BYTE) return null;
  try {
    return JSON.parse(decoder.decode(bytes.subarray(1))) as Extract<RenderNode, { k: 'raw' }>;
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

function buildOversizedNode(at: number, bytes: number): RenderNode {
  return {
    id: `${at}:0`,
    at,
    i: 0,
    uuid: null,
    ts: null,
    elided: false,
    expandable: false,
    k: 'raw',
    rowType: 'oversized',
    json: '',
    bytes,
    text: `row too large (${bytes} bytes)`,
  };
}

/** Finds the largest offset `k < end` with `byte[k] === 0x0A`, by walking backward from `end` in
 * FIXED `SCAN_CHUNK`-sized slices until found or BOF. `null` means there is no such byte (BOF
 * reached with nothing found) — the caller's own row/BOF decision, never this function's. Bytes
 * past `ROW_CAP` are still SCANNED (to find the boundary) but each read allocates at most one
 * `SCAN_CHUNK`, so the memory footprint is independent of how far back the newline is (spec §6.5):
 * the cap bounds what is KEPT, and the chunk bounds what is scanned per read (D26). */
function findNewlineBackward(readBack: ReadBack, end: number): number | null {
  let hi = end;
  while (hi > 0) {
    const lo = Math.max(0, hi - SCAN_CHUNK);
    const buf = readBack(hi, hi - lo); // the slice [lo, hi), read as bytes ending at `hi`.
    const idx = buf.lastIndexOf(0x0a);
    if (idx !== -1) return lo + idx;
    hi = lo;
  }
  return null;
}

/** D21's pre-pairing candidate count for ONE already-read row's text. An unparsable row (never
 * exercised by this task's fixtures — every planted row is valid JSON) is conservatively counted
 * as one candidate, matching rung 1's eventual single `unreadable` node (spec §13) rather than
 * silently undercounting the boundary. */
function countCandidatesForRowText(text: string): number {
  const { records } = parseRecordLines([text]);
  if (records.length !== 1) return 1;
  return countCandidates([{ record: records[0]!, at: 0 }]);
}

/**
 * The backward one-row-at-a-time newline walk (spec §6.3, D20/D21/D26/D30/D31). PURE: `readBack`
 * is the only world contact. See the module doc comment above for the two-entry-point contract
 * (`hello` + `/api/rows`) this single function serves.
 */
export function findWindow(readBack: ReadBack, eof: number, limit: number): FindWindowResult {
  // D30: the file may end mid-row. `to` is one past the LAST `0x0A`, never EOF; `[to, eof)` is the
  // forward tail's carry, never parsed as a row here. The carry is BOUNDED at `ROW_CAP` (spec §6.5):
  // a partial trailing row larger than the cap is already an oversized row-in-progress, so only its
  // last `ROW_CAP` bytes are retained — the poller seeds its forward tail with `ackOffset := eof -
  // carrySeed.length` (never a bare `to`), which keeps §6.1's `offset == ackOffset + carry.length`
  // invariant exact whether the carry was capped or not (for the common small carry, `eof -
  // carrySeed.length` is exactly `to`). Reading only the last `ROW_CAP` bytes keeps the allocation
  // independent of how large the unterminated row is.
  const lastNl = findNewlineBackward(readBack, eof);
  const to = lastNl === null ? 0 : lastNl + 1;
  const carryLen = eof - to;
  const carrySeed = carryLen > 0 ? readBack(eof, Math.min(carryLen, ROW_CAP)) : new Uint8Array(0);

  interface Entry {
    at: number;
    bytes: Uint8Array;
    count: number;
  }
  const collected: Entry[] = []; // discovered newest-first (walking backward from `to`)
  let anchor = to;
  let candidates = 0;

  while (candidates < limit && anchor > 0) {
    // The previous row ENDS at anchor-1 (its own terminating 0x0A); find where it STARTS.
    const end = anchor - 1;
    const nl = findNewlineBackward(readBack, end);
    const start = nl === null ? 0 : nl + 1;
    const rowLength = end - start; // content length, excluding the terminating 0x0A at `end`.

    // D26: strictly greater — a row of EXACTLY ROW_CAP is valid and must parse.
    if (rowLength > ROW_CAP) {
      const bytesIncludingNewline = rowLength + 1;
      const node = buildOversizedNode(start, bytesIncludingNewline);
      collected.push({ at: start, bytes: encodeOversizedMarker(node), count: 1 });
      candidates += 1;
      anchor = start;
      continue;
    }

    const rowBytes = readBack(end, rowLength);
    const count = countCandidatesForRowText(decoder.decode(rowBytes));
    collected.push({ at: start, bytes: rowBytes, count });
    candidates += count;
    anchor = start;
  }

  // D20: whole-row trim — drop the largest prefix of whole rows that still leaves >= limit
  // candidates; the window may exceed `limit` by at most one row's worth of nodes.
  const fileOrder = collected.slice().reverse();
  let total = candidates;
  let dropCount = 0;
  while (dropCount < fileOrder.length && total - fileOrder[dropCount]!.count >= limit) {
    total -= fileOrder[dropCount]!.count;
    dropCount += 1;
  }
  const trimmed = fileOrder.slice(dropCount);
  const from = trimmed.length > 0 ? trimmed[0]!.at : to;
  // D20: true iff ANY row precedes `from` — not "BOF not reached". Covers both "the scan stopped
  // at `limit` with more before it" and "the scan reached BOF but the trim discarded a prefix".
  const truncatedBefore = from > 0;

  return { rows: trimmed.map((e) => e.bytes), from, to, truncatedBefore, carrySeed };
}

/**
 * `findWindow`'s `rows` (raw bytes, oversized rows NUL-marked) -> the pre-pairing candidate
 * `RenderNode[]`, in file order — the OTHER half of D31's "read-and-decide" that stays pure. Row
 * offsets are reconstructed by walking `rows` sequentially from `from` (each normal row's own byte
 * length + 1 for its stripped terminator; each oversized marker's embedded `bytes` field, which
 * already includes the terminator) — the same "walk raw bytes, accumulate offsets" discipline
 * `fixtures/session4.rendered.test.ts` uses to build `RowInput[]` from a real file.
 */
export function candidatesFromRows(rows: Uint8Array[], from: number): RenderNode[] {
  const out: RenderNode[] = [];
  let offset = from;
  for (const rowBytes of rows) {
    const marker = decodeOversizedMarker(rowBytes);
    if (marker !== null) {
      out.push(marker);
      offset += marker.bytes;
      continue;
    }
    const text = decoder.decode(rowBytes);
    const { records } = parseRecordLines([text]);
    if (records.length === 1) {
      out.push(...normalize([{ record: records[0]!, at: offset }]));
    }
    offset += rowBytes.length + 1;
  }
  return out;
}

/**
 * Runs a FRESH `pair()` over `candidates` (spec §6.3: "pairing runs after the trim, over retained
 * rows only") and merges every resulting `{op:'result'}` patch back into `nodes` in place, so a
 * freshly-built window (nothing yet rendered client-side) reports each in-window call+result pair
 * as ONE already-complete `tool` node rather than a pending node plus a wire patch the client never
 * asked to apply — patches are reserved for D27's orphans wire operation (`orphanPatches` below).
 */
export function applyInWindowPairing(candidates: RenderNode[]): RenderNode[] {
  const { nodes, patches } = pair(candidates, createPairState());
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

/** Every complete row in `bytes` (which begins at file offset `startOffset`), decoded with its own
 * byte offset — the forward counterpart of the offset-walk `candidatesFromRows` does backward,
 * used by `orphanPatches` to scan the range the client already holds for a specific orphan's
 * result row. A trailing partial segment (no `0x0A`) is dropped, exactly like `completeLines`. */
function splitCompleteRowsWithOffsets(bytes: Uint8Array, startOffset: number): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let start = 0;
  let at = startOffset;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    out.push({ text: decoder.decode(bytes.subarray(start, i)), at });
    at += i - start + 1;
    start = i + 1;
  }
  return out;
}

/**
 * D27 — the orphans wire operation. `tailBytes` is `[tailOffset, eof)`, already read by the caller
 * (the range the client currently holds, which our OWN back-filled `[from, to)` window can never
 * include by construction). For every `orphanToolUseIds` entry whose CALL landed in `windowNodes`
 * as a still-`'pending'` `tool` node (i.e. its result is NOT in our own window — exactly the orphan
 * condition), this scans `tailBytes` forward for the matching `orphan_result` candidate and, when
 * found, emits `{op:'remove', id: <that candidate's own RowAnchor.id>}` — never `{op:'result'}`,
 * because a node's id IS its own anchor (D27/§4): the orphan is anchored at the RESULT's row, the
 * newly-arrived call at the CALL's row, and the two can never share an id. The pending call node
 * itself needs no further action here — it already "arrives in nodes like any other back-filled
 * node" simply by being part of `windowNodes`. An id whose call is not in `windowNodes` (still
 * further back, or never held) is silently skipped — never an error.
 */
export function orphanPatches(
  tailBytes: Uint8Array,
  tailOffset: number,
  windowNodes: readonly RenderNode[],
  orphanToolUseIds: readonly string[],
): Patch[] {
  if (orphanToolUseIds.length === 0) return [];
  const wanted = new Set(orphanToolUseIds);
  const callsInRange = new Set<string>();
  for (const node of windowNodes) {
    if (node.k === 'tool' && node.state === 'pending' && node.toolUseId !== null && wanted.has(node.toolUseId)) {
      callsInRange.add(node.toolUseId);
    }
  }
  if (callsInRange.size === 0) return [];

  const idByToolUseId = new Map<string, string>();
  for (const { text, at } of splitCompleteRowsWithOffsets(tailBytes, tailOffset)) {
    const { records } = parseRecordLines([text]);
    if (records.length !== 1) continue;
    for (const node of normalize([{ record: records[0]!, at }])) {
      if (node.k === 'orphan_result' && callsInRange.has(node.toolUseId) && !idByToolUseId.has(node.toolUseId)) {
        idByToolUseId.set(node.toolUseId, node.id);
      }
    }
  }

  const patches: Patch[] = [];
  for (const toolUseId of callsInRange) {
    const id = idByToolUseId.get(toolUseId);
    if (id !== undefined) patches.push({ op: 'remove', id });
  }
  return patches;
}
