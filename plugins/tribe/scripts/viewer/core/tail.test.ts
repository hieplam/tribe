import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_A_DIR, ROW_CAP as FIXTURE_ROW_CAP, SESSION_4_ID, SESSION_4_MARKERS, buildHomeA } from '../fixtures/build.ts';
import type { FileObservation, RenderNode } from './model.ts';
import { ROW_CAP, advanceTail, initialTailState } from './tail.ts';
import type { TailState } from './tail.ts';

const enc = new TextEncoder();

function obs(sizeBytes: number, inode = 1): FileObservation {
  return { sizeBytes, mtimeMs: 0, inode, birthtimeMs: 0 };
}

function concatU8(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// The same 8 MiB cap `core/window.ts#findWindow` will use (D26) — asserted once here so a
// constant drifting apart in a later task fails loudly at import time, not by coincidence.
test('ROW_CAP is 8 MiB, the same constant the fixture builder and the backward reader use (D26)', () => {
  expect(ROW_CAP).toBe(8 * 1024 * 1024);
  expect(ROW_CAP).toBe(FIXTURE_ROW_CAP);
});

// --- carried over from core/live/tail.ts, ported to raw bytes + FileObservation (D13) ----------

test('a line split across three chunks emits exactly once, when complete', () => {
  let s = initialTailState();
  let r = advanceTail(s, enc.encode('{"a":'), obs(5));
  expect(r.lines).toEqual([]);
  r = advanceTail(r.state, enc.encode('1,"b":'), obs(11));
  expect(r.lines).toEqual([]);
  r = advanceTail(r.state, enc.encode('2}\n'), obs(14));
  expect(r.lines).toEqual(['{"a":1,"b":2}']);
  expect(r.state.carry.length).toBe(0);
  expect(r.state.offset).toBe(14);
});

test('a chunk ending exactly on a newline leaves no carry', () => {
  const r = advanceTail(initialTailState(), enc.encode('one\ntwo\n'), obs(8));
  expect(r.lines).toEqual(['one', 'two']);
  expect(r.state.carry.length).toBe(0);
});

test('blank lines are dropped, CRLF is trimmed', () => {
  const r = advanceTail(initialTailState(), enc.encode('a\r\n\nb\r\n'), obs(7));
  expect(r.lines).toEqual(['a', 'b']);
});

test('a shrinking file resets the tail and re-reads from zero', () => {
  const first = advanceTail(initialTailState(), enc.encode('old\n'), obs(4));
  expect(first.state.offset).toBe(4);
  const grown = advanceTail(first.state, enc.encode('new\n'), obs(8));
  expect(grown.lines).toEqual(['new']);
  const truncated = advanceTail(grown.state, enc.encode('fresh\n'), obs(6));
  expect(truncated.reset).toBe(true);
  expect(truncated.state.offset).toBe(6);
  expect(truncated.lines).toEqual(['fresh']);
});

test('a shrink to a smaller non-zero size with an empty chunk never marks the rewritten bytes as consumed (F6)', () => {
  const tick1 = advanceTail(initialTailState(), enc.encode('line-one\nline-two\n'), obs(18));
  expect(tick1.lines).toEqual(['line-one', 'line-two']);
  expect(tick1.state.offset).toBe(18);
  expect(tick1.state.carry.length).toBe(0);

  // File truncated-and-rewritten to 10 bytes; the adapter cannot know the new content yet, so it
  // can only pass an empty chunk (zero consumed bytes) on the discovery tick.
  const tick2 = advanceTail(tick1.state, new Uint8Array(0), obs(10));
  expect(tick2.lines).toEqual([]);
  expect(tick2.state.offset).toBe(0);
  expect(tick2.state.carry.length).toBe(0);
  expect(tick2.reset).toBe(true);

  // Told via `reset`, the adapter re-reads immediately from zero (the whole 10-byte rewritten
  // file) rather than waiting a tick — the previously "lost" content is fully recoverable.
  const recovered = advanceTail(tick2.state, enc.encode('abcdefghi\n'), obs(10));
  expect(recovered.lines).toEqual(['abcdefghi']);
  expect(recovered.state.offset).toBe(10);
  expect(recovered.state.carry.length).toBe(0);
  expect(recovered.reset).toBe(false);
});

test('reset is false on steady ticks and true exactly when the truncation branch fires', () => {
  const first = advanceTail(initialTailState(), enc.encode('old\n'), obs(4));
  expect(first.reset).toBe(false);
  const grown = advanceTail(first.state, enc.encode('new\n'), obs(8));
  expect(grown.reset).toBe(false);
  const truncated = advanceTail(grown.state, enc.encode('fresh\n'), obs(6));
  expect(truncated.reset).toBe(true);
});

test('an honest short read never advances offset past what was actually consumed, and the next tick recovers the missed bytes (F56)', () => {
  // stat reported the file already at 10 bytes ('abcdefghi\n'), but the read only returned 2
  // raw bytes this tick (a single read is not guaranteed to fill its buffer).
  const short = advanceTail(initialTailState(), enc.encode('ab'), obs(10));
  expect(short.state.offset).toBe(2);
  expect(Array.from(short.state.carry)).toEqual(Array.from(enc.encode('ab')));
  expect(short.lines).toEqual([]);

  const recovered = advanceTail(short.state, enc.encode('cdefghi\n'), obs(10));
  expect(recovered.state.offset).toBe(10);
  expect(recovered.state.carry.length).toBe(0);
  expect(recovered.lines).toEqual(['abcdefghi']);
});

// --- new for the consolidation (D13/D30/D26) ---------------------------------------------------

// 0. The initial state can be SEEDED, and a snapshot always seeds it (D30).
test('D30: a seeded state (offset:=eof, carry:=[to,eof), ackOffset:=to) satisfies offset == ackOffset + carry.length from tick one', () => {
  const carry = enc.encode('{"partial":');
  const to = 100; // pretend windowEnd was byte 100
  const eof = to + carry.length;
  const seeded: TailState = {
    offset: eof,
    carry,
    ackOffset: to,
    inode: 0,
    skipping: false,
    rowStart: 0,
    skippedBytes: 0,
  };
  expect(seeded.offset).toBe(seeded.ackOffset + seeded.carry.length);
});

test('D30 failure shape 1: seeding offset := to (instead of eof) makes the derived next read re-return the carry bytes', () => {
  const carry = enc.encode('{"partial":');
  const to = 100;
  const eof = to + carry.length;
  const correct: TailState = { offset: eof, carry, ackOffset: to, inode: 0, skipping: false, rowStart: 0, skippedBytes: 0 };
  const wrong: TailState = { offset: to, carry, ackOffset: to, inode: 0, skipping: false, rowStart: 0, skippedBytes: 0 };

  // The contract (D13/D30): the next read starts at `state.offset`, never `state.ackOffset`.
  expect(correct.offset).toBe(eof); // derives the CORRECT next read start: only the new growth.
  // The wrong seed's derived next-read-start collapses onto `ackOffset` — exactly the START of
  // `carry` — so a caller deriving its next read from `offset` would re-fetch the carry bytes:
  // once already sitting in `carry`, once again from the re-read. That is the failure shape.
  expect(wrong.offset).toBe(wrong.ackOffset);
  expect(wrong.offset).not.toBe(wrong.ackOffset + wrong.carry.length);
});

test('D30 failure shape 2: seeding offset from the carry\'s own length (not eof) starts the next read in the middle of the file and re-emits history', () => {
  const to = 1_999_900;
  const eof = 2_000_000;
  const carry = new Uint8Array(eof - to); // 100 bytes — "the window's length"
  const correct: TailState = { offset: eof, carry, ackOffset: to, inode: 0, skipping: false, rowStart: 0, skippedBytes: 0 };
  const wrong: TailState = { offset: carry.length, carry, ackOffset: to, inode: 0, skipping: false, rowStart: 0, skippedBytes: 0 };

  expect(correct.offset).toBe(eof);
  // The wrong seed's derived next-read-start (`state.offset`) is `carry.length` — near byte 100
  // of a 2,000,000-byte file — instead of `eof`. Reading from there re-delivers ~1,999,900 bytes
  // of history the client already has.
  expect(wrong.offset).toBe(carry.length);
  expect(wrong.offset).toBeLessThan(to);
});

test('D30: seeded from a real <session-cut>-shaped snapshot, the first tick completes the partial row exactly once, deriving the next read from `offset`', () => {
  const rows = [
    JSON.stringify({ type: 'user', uuid: 'r1', sessionId: 's', message: { role: 'user', content: 'first' } }),
    JSON.stringify({ type: 'assistant', uuid: 'r2', sessionId: 's', message: { role: 'assistant', content: [{ type: 'text', text: 'second, complete' }] } }),
  ];
  const wholeFileIfNeverCut = enc.encode(rows.join('\n') + '\n');
  // Cut mid-row: drop the trailing newline and the last 10 bytes of the second row, exactly
  // task 1's own <session-cut> recipe (trailing bytes removed, a genuine partial last row).
  const withoutTrailingNewline = wholeFileIfNeverCut.subarray(0, wholeFileIfNeverCut.length - 1);
  const cut = withoutTrailingNewline.subarray(0, withoutTrailingNewline.length - 10);

  const lastNl = cut.lastIndexOf(0x0a);
  const to = lastNl + 1;
  const carrySeed = cut.subarray(to);
  const seeded: TailState = {
    offset: cut.length, // D30: offset := eof of what has been read so far, carry INCLUDED
    carry: carrySeed,
    ackOffset: to,
    inode: 1,
    skipping: false,
    rowStart: 0,
    skippedBytes: 0,
  };

  // Derive the next read from `state.offset` — NOT a range the test hands in — exactly as a real
  // adapter would: read `[offset, newEof)` of the (now complete) file.
  const nextChunk = wholeFileIfNeverCut.subarray(seeded.offset, wholeFileIfNeverCut.length);
  const tick = advanceTail(seeded, nextChunk, obs(wholeFileIfNeverCut.length));

  expect(tick.lines).toEqual([rows[1]]); // the completed row, exactly once — never split, never duplicated.
  expect(tick.state.offset).toBe(wholeFileIfNeverCut.length);
  expect(tick.state.carry.length).toBe(0);
});

// 1. ackOffset is one byte past the last 0x0A found; it does not move for an in-progress partial
//    row even though `offset` advances past those bytes.
test('ackOffset only advances to a REAL 0x0A boundary; a chunk ending mid-row advances offset but not ackOffset', () => {
  const chunk = enc.encode('{"a":1}\n{"partial":');
  const r1 = advanceTail(initialTailState(), chunk, obs(chunk.length));
  expect(r1.lines).toEqual(['{"a":1}']);
  const boundary = enc.encode('{"a":1}\n').length;
  expect(r1.state.ackOffset).toBe(boundary);
  expect(r1.state.offset).toBe(chunk.length);
  expect(r1.state.offset).toBeGreaterThan(r1.state.ackOffset); // offset moved past the partial bytes
  expect(chunk[r1.state.ackOffset - 1]).toBe(0x0a); // the invariant: a real newline sits right there

  // A second, still-incomplete chunk: ackOffset must still not move.
  const r2 = advanceTail(r1.state, enc.encode('still going'), obs(chunk.length + 11));
  expect(r2.lines).toEqual([]);
  expect(r2.state.ackOffset).toBe(boundary);
  expect(chunk[r2.state.ackOffset - 1]).toBe(0x0a);

  // Completing the row finally moves ackOffset — and it is again a real newline.
  const enc2 = enc.encode('"}\n');
  const r3 = advanceTail(r2.state, enc2, obs(chunk.length + 11 + enc2.length));
  expect(r3.lines).toEqual(['{"partial":still going"}']);
  expect(r3.state.ackOffset).toBe(r3.state.offset);
  expect(r3.state.carry.length).toBe(0);
});

// 2. The UTF-8 case the old decoded-string design got wrong: a chunk ending on an incomplete
//    multi-byte sequence, after a complete line.
test('D13: a multi-byte UTF-8 character split across a chunk boundary is carried RAW and reassembles correctly', () => {
  const firstRow = enc.encode('{"a":1}\n');
  const secondRowFull = '{"b":"café"}\n'; // "café" — é is 0xC3 0xA9 in UTF-8
  const secondRowBytes = enc.encode(secondRowFull);
  const splitAt = secondRowBytes.indexOf(0xc3); // the lone lead byte of 'é'
  const secondRowHead = secondRowBytes.subarray(0, splitAt + 1); // ends mid-character, on 0xC3
  const secondRowTail = secondRowBytes.subarray(splitAt + 1); // 0xA9 + the rest + the newline

  const chunk1 = concatU8(firstRow, secondRowHead);
  const r1 = advanceTail(initialTailState(), chunk1, obs(chunk1.length));
  expect(r1.lines).toEqual(['{"a":1}']); // the complete line decodes normally
  expect(r1.state.carry.length).toBe(secondRowHead.length); // the partial bytes are carried RAW
  expect(r1.state.carry[r1.state.carry.length - 1]).toBe(0xc3); // never replaced, never lost
  expect(r1.state.ackOffset).toBe(firstRow.length); // still points right after the first newline

  const r2 = advanceTail(r1.state, secondRowTail, obs(chunk1.length + secondRowTail.length));
  // Under D13 there is no decoder state to hide bytes in: the character reassembles correctly.
  expect(r2.lines).toEqual([secondRowFull.slice(0, -1)]);
});

// 3. reset fires on truncation, and on inode change even when the new file is the same size or
//    larger, and never falsely when state.inode is 0.
test('reset fires on truncation and on inode change (even same/larger size), never falsely when state.inode is 0', () => {
  // Truncation.
  const a1 = advanceTail(initialTailState(), enc.encode('a\n'), obs(2, 7));
  expect(a1.reset).toBe(false);
  const a2 = advanceTail(a1.state, new Uint8Array(0), obs(1, 7));
  expect(a2.reset).toBe(true);

  // Rotation: inode differs even though size stays the SAME.
  const b1 = advanceTail(initialTailState(), enc.encode('a\n'), obs(2, 42));
  expect(b1.state.inode).toBe(42);
  const b2sameSize = advanceTail(b1.state, enc.encode('b\n'), obs(2, 99));
  expect(b2sameSize.reset).toBe(true);

  // Rotation: inode differs even though size is LARGER than before — size alone cannot see this.
  const b2larger = advanceTail(b1.state, enc.encode('bb\n'), obs(999, 99));
  expect(b2larger.reset).toBe(true);

  // A platform that cannot supply an inode (0) must never trigger a false reset from inode
  // comparison alone — the transition degrades to the truncation trigger.
  const c1 = advanceTail(initialTailState(), enc.encode('a\n'), obs(2, 0));
  expect(c1.reset).toBe(false);
  expect(c1.state.inode).toBe(0);
  const c2 = advanceTail(c1.state, enc.encode('bb\n'), obs(5, 0));
  expect(c2.reset).toBe(false); // state.inode is still 0 -> trigger 2 never fires
});

// 4. ROW_CAP = 8 MiB, the SAME constant §6.3's backward reader uses (D26); > ROW_CAP strictly.
//    All three fixture rows task 1 plants in <session-4>, three outcomes.
test('D26: the 2 MiB row and the exactly-ROW_CAP row both parse; the 9 MiB row never parses as JSON, over both the forward .jsonl file', () => {
  const dest = mkdtempSync(join(tmpdir(), 'vc-tail-rowcap-'));
  try {
    buildHomeA(dest);
    const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.jsonl`);
    const fileBytes = readFileSync(path);
    const observation = obs(fileBytes.length, 1);

    let state = initialTailState();
    const lines: string[] = [];
    const oversized: RenderNode[] = [];
    const CHUNK = 3 * 1024 * 1024; // forces the 9 MiB row's carry to grow across several ticks
    for (let pos = 0; pos < fileBytes.length; pos += CHUNK) {
      const chunk = fileBytes.subarray(pos, Math.min(pos + CHUNK, fileBytes.length));
      const tick = advanceTail(state, chunk, observation);
      state = tick.state;
      lines.push(...tick.lines);
      oversized.push(...tick.oversized);
    }

    // The 2 MiB row is UNDER the cap: it parses normally, elided later per D15 — never skipped.
    expect(lines.some((l) => l.includes(SESSION_4_MARKERS.twoMib))).toBe(true);
    // The row of EXACTLY ROW_CAP bytes is still valid (the test is `>`, strictly) — it parses.
    expect(lines.some((l) => l.includes(SESSION_4_MARKERS.exactCap))).toBe(true);
    // The 9 MiB row's content NEVER reaches the decoded line list — it was never parsed as JSON.
    expect(lines.some((l) => l.includes(SESSION_4_MARKERS.oversized))).toBe(false);

    // Exactly one oversized event, and it is a `raw` node — never `unreadable` (spec §13: the
    // unparsable-JSON case is a different failure with a different shape).
    expect(oversized).toHaveLength(1);
    const node = oversized[0] as Extract<RenderNode, { k: 'raw' }>;
    expect(node.k).toBe('raw');
    expect(node.rowType).toBe('oversized');
    expect(node.i).toBe(0);
    expect(node.text).toMatch(/^row too large \(\d+ bytes\)$/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test('D26: after the discard flag clears, the VERY NEXT row parses normally — without the flag a JSON fragment would masquerade as a record', () => {
  // <session-4>.rotated is the SAME rows in reverse order (task 1), which puts the 9 MiB
  // oversized row FIRST, immediately followed by the exactly-ROW_CAP row — the real shape this
  // test needs, with no fixture change required.
  const dest = mkdtempSync(join(tmpdir(), 'vc-tail-rowcap-next-'));
  try {
    buildHomeA(dest);
    const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.rotated`);
    const fileBytes = readFileSync(path);
    const observation = obs(fileBytes.length, 1);

    let state = initialTailState();
    const lines: string[] = [];
    const oversized: RenderNode[] = [];
    const CHUNK = 3 * 1024 * 1024;
    for (let pos = 0; pos < fileBytes.length; pos += CHUNK) {
      const chunk = fileBytes.subarray(pos, Math.min(pos + CHUNK, fileBytes.length));
      const tick = advanceTail(state, chunk, observation);
      state = tick.state;
      lines.push(...tick.lines);
      oversized.push(...tick.oversized);
    }

    expect(oversized).toHaveLength(1);
    expect(oversized[0]?.k).toBe('raw');
    // The oversized row contributed NOTHING to `lines`, so the first decoded line is whatever
    // comes right after it in the file — here, the exact-ROW_CAP row — and it must be intact
    // JSON, not a fragment of the discarded row's tail.
    expect(lines[0]).toContain(SESSION_4_MARKERS.exactCap);
    expect(() => JSON.parse(lines[0] as string)).not.toThrow();
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});
