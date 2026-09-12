/**
 * core/window.ts — pure line-boundary decisions over raw bytes (spec §5.3), never I/O. This
 * module owns "which bytes form complete lines" so the adapter performs only `stat` and "read
 * bytes [a, b)" and decides nothing (`pure-core.md`). §5.3's bounded head/tail reads both use
 * `completeLines` to decide what to keep without ever guessing at a line that is not wholly
 * present in the buffer.
 */

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
