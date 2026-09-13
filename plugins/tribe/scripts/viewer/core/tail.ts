/**
 * Pure tail state machine over RAW BYTES (spec §6.1). D13 naming: `advanceTail` takes the raw
 * `Uint8Array` chunk and a `FileObservation` (spec §4) — never an already-decoded string. It
 * scans the raw bytes for the LAST `0x0A` itself, carries the undecided remainder as raw bytes
 * (never a decoded string), and decodes only complete lines. The adapter performs `stat` and
 * "read bytes [a, b)" and nothing else (`pure-core.md`) — no decoding, no branching, ever.
 *
 * Why raw bytes, not a decoded string plus a byte count (the design this replaces): the earlier
 * design derived `ackOffset = offset - byteLengthOf(carry)` from a decoded STRING. That formula
 * is wrong the moment a streaming `TextDecoder` withholds an incomplete UTF-8 sequence — the
 * withheld bytes are in neither the returned string nor the carry, so the derived offset can land
 * mid-character rather than after a real newline (F44). Under D13 there is no decoder state to
 * hide bytes in: `ackOffset` is simply "one past the last `0x0A` I found", which is what makes
 * the multi-byte-boundary case below correct by construction. A signature that accepts an
 * already-decoded string here is wrong, whatever it then computes.
 *
 * `advanceTail` never advances `offset` past what was actually read: the new offset is always
 * `base.offset + chunk.length` — `chunk` IS raw bytes, so its `.length` already IS a byte count,
 * removing the decoded-character-count-vs-byte-count ambiguity D13 exists to kill — and never
 * `fileSize`/`obs.sizeBytes` (the file may have grown since the read, or the read itself may have
 * returned fewer bytes than were available: a single read is not guaranteed to fill its buffer).
 * Trusting `obs.sizeBytes` instead of the real read length would mark unread bytes "consumed" and
 * silently lose them forever (F56) — `obs.sizeBytes` is used ONLY to detect a shrink/rotate,
 * never to compute the new offset.
 */
import type { FileObservation, RenderNode } from './model.ts';

/** D26 — the SAME row cap `core/window.ts#findWindow` (the backward reader) uses. One row cap,
 * both readers, one `raw` node for a row past it (spec §6.3). */
export const ROW_CAP = 8 * 1024 * 1024;

const NEWLINE = 0x0a;
const decoder = new TextDecoder('utf-8');

export interface TailState {
  /** Every byte read so far, including whatever currently sits in `carry`. */
  offset: number;
  /** Raw, undecided bytes since the last confirmed `0x0A` — never a decoded string (D13). */
  carry: Uint8Array;
  /** One byte past the last `0x0A` this machine has actually found. Always a real line boundary
   * in the file: `file[ackOffset - 1] === 0x0A` holds for every state this machine passes
   * through (excluding the initial state, where it is 0 and no row has been confirmed yet). */
  ackOffset: number;
  /** The inode this state was last observed against; 0 means "never observed" — a platform that
   * cannot supply one also reports 0 here, forever, which correctly disables the rotation trigger
   * (spec §6.1) rather than firing it falsely. */
  inode: number;
  /** The spec §6.1 discard state machine (D26): true while a row longer than `ROW_CAP` is being
   * dropped byte-by-byte until its terminating `0x0A` is found. */
  skipping: boolean;
  /** Valid while `skipping` — the true byte offset the oversized row began at. */
  rowStart: number;
  /** Valid while `skipping` — bytes discarded so far for the row currently being dropped. */
  skippedBytes: number;
}

export function initialTailState(): TailState {
  return {
    offset: 0,
    carry: new Uint8Array(0),
    ackOffset: 0,
    inode: 0,
    skipping: false,
    rowStart: 0,
    skippedBytes: 0,
  };
}

export interface TailTick {
  state: TailState;
  /** Complete, decoded JSON-line candidates this tick, in file order. */
  lines: string[];
  /** Zero or more `{k:'raw', rowType:'oversized', ...}` nodes this tick's discard machine
   * completed (spec §6.1). It is a `raw` node, never `unreadable` — `unreadable` is the
   * unparsable-JSON case (spec §13), a different failure with a different shape. */
  oversized: RenderNode[];
  reset: boolean;
  /** WHICH of §6.1's two triggers fired, or `null` on a non-reset tick. `advanceTail` already
   * distinguishes these to decide `reset`; returning the reason keeps the poller from re-deriving
   * it from the same inputs (`pure-core.md`: the adapter forwards, it does not decide). A truncation
   * (a shrink past the last read offset) takes precedence over a rotation when both are observable. */
  resetReason: 'truncated' | 'rotated' | null;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function oversizedNode(rowStart: number, bytes: number): RenderNode {
  return {
    k: 'raw',
    id: `${rowStart}:0`,
    at: rowStart,
    i: 0,
    uuid: null,
    ts: null,
    elided: false,
    expandable: false,
    rowType: 'oversized',
    json: '',
    bytes,
    text: `row too large (${bytes} bytes)`,
  };
}

export function advanceTail(state: TailState, chunk: Uint8Array, obs: FileObservation): TailTick {
  const truncated = obs.sizeBytes < state.offset;
  // Trigger 2 (rotation) fires even when the replacement is the same size or larger — size alone
  // cannot see that case. `state.inode !== 0` guards a platform that cannot supply one: it always
  // degrades to the truncation trigger, never a false reset (spec §6.1).
  const rotated = state.inode !== 0 && obs.inode !== state.inode;
  const reset = truncated || rotated;
  // Truncation takes precedence when both are observable — a shrink past the last read offset is the
  // stronger, size-visible signal, matching the poller's own prior re-derivation (§6.1).
  const resetReason: 'truncated' | 'rotated' | null = truncated ? 'truncated' : rotated ? 'rotated' : null;

  const base = reset
    ? { offset: 0, carry: new Uint8Array(0), ackOffset: 0, skipping: false, rowStart: 0, skippedBytes: 0 }
    : state;

  const combined = concatBytes(base.carry, chunk);
  // combined[0] sits at this absolute file offset. `base.offset - base.carry.length` is the one
  // formula correct in BOTH regimes: for a non-skipping base it equals `base.ackOffset` (that is
  // §6.1's invariant `offset == ackOffset + carry.length`), and for a SKIPPING base — where the
  // carry is forced empty (see finalCarry) while `offset` races ahead of the pinned `ackOffset` —
  // it equals `base.offset`, the true position of the new chunk's first byte. Using `base.ackOffset`
  // here silently anchored the terminating-newline of a chunk-spanning oversized row to a stale
  // offset, corrupting `ackOffset` (and every byte anchor after it) once the discard flag cleared.
  const absBase = base.offset - base.carry.length;

  const lines: string[] = [];
  const oversized: RenderNode[] = [];
  let skipping = base.skipping;
  let rowStart = base.rowStart;
  let skippedBytes = base.skippedBytes;
  let ackOffset = base.ackOffset;
  let idx = 0;

  for (;;) {
    let nl = -1;
    for (let i = idx; i < combined.length; i++) {
      if (combined[i] === NEWLINE) { nl = i; break; }
    }

    if (nl === -1) {
      const remaining = combined.subarray(idx);
      if (skipping) {
        // Still no terminator for the row being discarded — keep counting, keep dropping.
        skippedBytes += remaining.length;
      } else if (remaining.length > ROW_CAP) {
        // The growing, still-unterminated row just crossed the cap: enter the discard machine.
        // `ackOffset` stays pinned — it is still one past the last REAL `0x0A` found, not this.
        skipping = true;
        rowStart = absBase + idx;
        skippedBytes = remaining.length;
      }
      break;
    }

    const rowBytes = combined.subarray(idx, nl);
    const rowStartAbs = absBase + idx;

    if (skipping) {
      skippedBytes += rowBytes.length + 1; // + the terminating 0x0A itself
      oversized.push(oversizedNode(rowStart, skippedBytes));
      skipping = false;
      skippedBytes = 0;
      ackOffset = rowStartAbs + rowBytes.length + 1;
      idx = nl + 1;
      continue;
    }

    if (rowBytes.length > ROW_CAP) {
      // The whole oversized row (and its terminator) arrived within one chunk — no multi-tick
      // growth was needed to discover it. Same outcome, same shape, one raw node.
      oversized.push(oversizedNode(rowStartAbs, rowBytes.length + 1));
      ackOffset = rowStartAbs + rowBytes.length + 1;
      idx = nl + 1;
      continue;
    }

    // A normal, complete row. CRLF is trimmed and a blank line contributes nothing to `lines` —
    // carried over from the pre-consolidation reader — but the newline scan above (which decides
    // `ackOffset`/`offset`) never depends on either, so the byte accounting stays exact either way.
    const text = decoder.decode(rowBytes).replace(/\r$/, '');
    if (text.length > 0) lines.push(text);
    ackOffset = rowStartAbs + rowBytes.length + 1;
    idx = nl + 1;
  }

  const finalCarry = skipping ? new Uint8Array(0) : combined.subarray(idx);
  const offset = base.offset + chunk.length;

  const newState: TailState = {
    offset,
    carry: finalCarry,
    ackOffset,
    inode: obs.inode,
    skipping,
    rowStart,
    skippedBytes,
  };

  return { state: newState, lines, oversized, reset, resetReason };
}
