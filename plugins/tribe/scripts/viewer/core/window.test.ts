import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completeLines, candidatesFromRows, findWindow, orphanPatches, type ReadBack } from './window.ts';
import { ROW_CAP } from './tail.ts';
import { buildHomeA, PROJECT_A_DIR, SESSION_4_ID, SESSION_CUT_ID, SESSION_4_MARKERS } from '../fixtures/build.ts';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// completeLines — unchanged from task 5 (§5.3 bounded head/tail reads).
// ---------------------------------------------------------------------------------------------

test('returns only whole lines; a trailing partial line (no terminating 0x0A) is dropped', () => {
  const bytes = enc.encode('one\ntwo\nthre'); // "thre" never sees a 0x0A
  expect(completeLines(bytes, false)).toEqual(['one', 'two']);
});

test('dropLeadingPartial discards the bytes before the first 0x0A', () => {
  const bytes = enc.encode('lea\ntwo\nthree\n'); // "lea" pretends to be a mid-row read start
  expect(completeLines(bytes, true)).toEqual(['two', 'three']);
  // without the flag, the same bytes keep the leading segment.
  expect(completeLines(bytes, false)).toEqual(['lea', 'two', 'three']);
});

test('a buffer whose boundary lands EXACTLY on a 0x0A drops nothing', () => {
  const bytes = enc.encode('one\ntwo\n'); // ends exactly on a 0x0A — no partial trailing segment
  expect(completeLines(bytes, false)).toEqual(['one', 'two']);
  // even with dropLeadingPartial, only the FIRST segment is affected — the exact boundary at the
  // end still drops nothing extra.
  expect(completeLines(bytes, true)).toEqual(['two']);
});

test('a buffer with no 0x0A at all returns no lines, however dropLeadingPartial is set', () => {
  const bytes = enc.encode('no newline anywhere in here');
  expect(completeLines(bytes, false)).toEqual([]);
  expect(completeLines(bytes, true)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// findWindow (task 18, D20/D21/D26/D30/D31) — unit-tested with an IN-MEMORY readBack over real
// fixture bytes (the 2 MiB row, the 9 MiB row, the exactly-ROW_CAP row, the cut-mid-row file), per
// the brief: "Unit-test it in core/window.test.ts with an in-memory readBack over fixture bytes."
// ---------------------------------------------------------------------------------------------

const cleanups: string[] = [];
afterAll(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

function readFixtureBytes(relPath: string): Uint8Array {
  const dest = mkdtempSync(join(tmpdir(), 'vc-window-test-'));
  cleanups.push(dest);
  buildHomeA(dest);
  const buf = readFileSync(join(dest, relPath));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** An IN-MEMORY readBack: slices an already-in-memory buffer, no repeated disk I/O per call — the
 * bytes themselves are real fixture content read once off disk (`fixtures-mirror-reality.md`). */
function inMemoryReadBack(buffer: Uint8Array): ReadBack {
  return (end, len) => buffer.subarray(end - len, end);
}

function decodeMarkerText(rowBytes: Uint8Array): string | null {
  if (rowBytes.length === 0 || rowBytes[0] !== 0x00) return null;
  return new TextDecoder('utf-8').decode(rowBytes.subarray(1));
}

describe('findWindow — session-4 (2,400 rows, D20/D21/D22/D26 fixture)', () => {
  const session4Path = `cfg/projects/${PROJECT_A_DIR}/${SESSION_4_ID}.jsonl`;

  function loadSession4() {
    const buffer = readFixtureBytes(session4Path);
    return { buffer, readBack: inMemoryReadBack(buffer) };
  }

  test('the file ends cleanly on a 0x0A: to === eof, carrySeed is empty', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);
    expect(result.to).toBe(buffer.length);
    expect(result.carrySeed.length).toBe(0);
  });

  test('truncatedBefore is true — 2,400 rows for a 500-node limit definitely leaves rows before `from`', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);
    expect(result.truncatedBefore).toBe(true);
    expect(result.from).toBeGreaterThan(0);
  });

  test('`from` always lands on a real row start: the byte immediately before it is 0x0A', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);
    expect(buffer[result.from - 1]).toBe(0x0a);
  });

  test('a row of exactly ROW_CAP bytes parses (is NOT oversized) — retained as a normal row', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);
    const found = result.rows.some((r) => decodeMarkerText(r) === null && new TextDecoder().decode(r).includes(SESSION_4_MARKERS.exactCap));
    expect(found).toBe(true);
  });

  test('the 2 MiB row parses (is NOT oversized) — retained as a normal row, window on either side intact', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);
    const found = result.rows.some((r) => decodeMarkerText(r) === null && new TextDecoder().decode(r).includes(SESSION_4_MARKERS.twoMib));
    expect(found).toBe(true);
  });

  test('the 9 MiB row is OVER the cap — exactly one raw/oversized node, anchored at the row\'s true start', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);

    // Ground truth, computed independently of findWindow: scan the raw buffer for the newline
    // immediately BEFORE the oversized row's own marker text, then walk backward to the preceding
    // 0x0A — that IS the row's true start, by definition.
    const text = new TextDecoder().decode(buffer);
    const markerIdx = text.indexOf(SESSION_4_MARKERS.oversized);
    expect(markerIdx).toBeGreaterThan(-1);
    const trueStart = buffer.lastIndexOf(0x0a, markerIdx) + 1; // one past the preceding 0x0A (or 0)

    const oversizedEntries = result.rows
      .map((r) => decodeMarkerText(r))
      .filter((t): t is string => t !== null)
      .map((t) => JSON.parse(t) as { k: string; rowType: string; at: number; i: number; text: string | null; bytes: number });

    expect(oversizedEntries).toHaveLength(1);
    const node = oversizedEntries[0]!;
    expect(node.k).toBe('raw');
    expect(node.rowType).toBe('oversized');
    expect(node.i).toBe(0);
    expect(node.at).toBe(trueStart);
    expect(node.text).toBe(`row too large (${node.bytes} bytes)`);

    // The window on either side is intact: the exact-cap and 2 MiB rows are both still present,
    // and the oversized row's own real content never appears as a retained (parseable) row.
    const normalRowTexts = result.rows.filter((r) => decodeMarkerText(r) === null).map((r) => new TextDecoder().decode(r));
    expect(normalRowTexts.some((t) => t.includes(SESSION_4_MARKERS.exactCap))).toBe(true);
    expect(normalRowTexts.some((t) => t.includes(SESSION_4_MARKERS.oversized))).toBe(false);
  });

  test('a 500-node window\'s row count is LOWER than its node count (the four-block row proves node-counting, not row-counting)', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);
    const candidates = candidatesFromRows(result.rows, result.from);
    expect(candidates.length).toBeGreaterThanOrEqual(500);
    // A row-counting implementation would treat "500 nodes" as "500 rows" (1:1). The four-block
    // row alone contributes 4 candidates for the price of ONE retained row, so the window's row
    // count is strictly below its own candidate count — the one assertion a row-counting
    // implementation cannot satisfy (it has no notion under which rows < nodes).
    expect(result.rows.length).toBeLessThan(candidates.length);
  });

  test('D20 whole-row trim: the four-block row straddling the boundary is retained WHOLE, and `before=from` back-fills with no block missing at the seam', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 500);

    const fourBlockIdx = result.rows.findIndex((r) => decodeMarkerText(r) === null && new TextDecoder().decode(r).includes(SESSION_4_MARKERS.fourBlock));
    expect(fourBlockIdx).toBeGreaterThan(-1);
    const parsed = JSON.parse(new TextDecoder().decode(result.rows[fourBlockIdx]!)) as { message: { content: unknown[] } };
    expect(parsed.message.content).toHaveLength(4); // the WHOLE row, never split mid-block

    // Back-fill: `before = result.from` must return a range CONTIGUOUS with (immediately
    // preceding) the current window — no row, and therefore no block, missing at the seam.
    const before = findWindow(readBack, result.from, 500);
    expect(before.to).toBe(result.from);
    if (before.rows.length > 0) {
      const lastRowOfBefore = before.rows[before.rows.length - 1]!;
      const markerBefore = decodeMarkerText(lastRowOfBefore);
      const lastRowLength = markerBefore !== null ? (JSON.parse(markerBefore) as { bytes: number }).bytes : lastRowOfBefore.length + 1;
      const lastRowStart = before.to - lastRowLength;
      // The last row of the earlier window ends exactly where the current window's first row
      // begins — contiguous, nothing missing between them.
      expect(lastRowStart + lastRowLength).toBe(result.from);
    }
  });

  test('truncatedBefore is defined as "any row precedes `from`", not "BOF was not reached": a limit that reaches BOF exactly at the crossing row still leaves nothing before `from` — false, correctly', () => {
    const { buffer, readBack } = loadSession4();
    // 2,600 pre-pairing candidates total (D22). limit=2600 makes the walk consume EVERY row in
    // the file (BOF genuinely reached) with total candidates landing EXACTLY at the limit — the
    // whole file is the window, so nothing precedes `from`, and `from` is 0. A "BOF was not
    // reached" reading and the spec's own "does anything precede `from`" reading agree here, but
    // only the spec's own definition is asserted directly — `truncatedBefore` tracks `from`, never
    // a scan-internal "did we hit BOF" flag.
    const result = findWindow(readBack, buffer.length, 2600);
    expect(result.from).toBe(0);
    expect(result.truncatedBefore).toBe(false);
    expect(candidatesFromRows(result.rows, result.from).length).toBe(2600);
  });

  test('the limit is clamp-free at the algorithm level: a tiny limit still returns a real, contiguous window', () => {
    const { buffer, readBack } = loadSession4();
    const result = findWindow(readBack, buffer.length, 1);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    expect(buffer[result.from - 1]).toBe(0x0a);
  });
});

// ---------------------------------------------------------------------------------------------
// Bounded windowing (spec §6.5 "rows of any size"; D26 scan-past-cap-but-don't-retain). A single
// degenerate row larger than ROW_CAP with no terminating newline must not make findWindow allocate
// a buffer proportional to the FILE SIZE — neither the backward newline scan nor the retained
// carrySeed may grow past a fixed bound. `fixtures-mirror-reality.md`: this is the shape a writer
// mid-append leaves on disk when one row is pathologically large.
// ---------------------------------------------------------------------------------------------
describe('findWindow — a >ROW_CAP row with no newline is bounded (spec §6.5, D26)', () => {
  /** A readBack over a virtual file of `fileLen` bytes, none of them 0x0A, that records the LARGEST
   * single `len` it is ever asked for — the memory footprint of one allocation. It fills a real
   * buffer of exactly the requested length, so the newline scan sees genuine (newline-free) bytes,
   * but never materializes the whole virtual file at once. */
  function boundedProbe(fileLen: number): { readBack: ReadBack; maxLen: () => number } {
    let maxLen = 0;
    const readBack: ReadBack = (end, len) => {
      maxLen = Math.max(maxLen, len);
      // A real buffer of the requested size, all 'a' (0x61) — never a 0x0A anywhere.
      return new Uint8Array(len).fill(0x61);
    };
    return { readBack, maxLen: () => maxLen };
  }

  test('no single read exceeds ROW_CAP, the retained carrySeed is capped at ROW_CAP, and the window is sane (to=0, no rows)', () => {
    const fileLen = ROW_CAP + 1024 * 1024; // 9 MiB: strictly larger than the cap
    const { readBack, maxLen } = boundedProbe(fileLen);
    const result = findWindow(readBack, fileLen, 500);

    // The whole point: no allocation is proportional to the file. Every single read is at most
    // ROW_CAP, which is INDEPENDENT of fileLen — a 900 MiB file would read no more per call.
    expect(maxLen()).toBeLessThanOrEqual(ROW_CAP);
    expect(maxLen()).toBeLessThan(fileLen); // proves it never read the whole file in one buffer

    // A sane window over a single unterminated giant row: no complete row, so `to` is 0, nothing is
    // retained as a row, and the carry — the forward tail — is bounded to at most ROW_CAP.
    expect(result.to).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.truncatedBefore).toBe(false);
    expect(result.carrySeed.length).toBeLessThanOrEqual(ROW_CAP);
  });
});

describe('findWindow — <session-cut> (D30: a file that does not end in 0x0A)', () => {
  const sessionCutPath = `cfg/projects/${PROJECT_A_DIR}/${SESSION_CUT_ID}.jsonl`;

  test('to < eof; carrySeed is exactly the trailing partial bytes; the partial row is never parsed', () => {
    const buffer = readFixtureBytes(sessionCutPath);
    const readBack = inMemoryReadBack(buffer);
    const result = findWindow(readBack, buffer.length, 500);

    expect(result.to).toBeLessThan(buffer.length);
    expect(result.carrySeed).toEqual(buffer.subarray(result.to, buffer.length));
    // No `unreadable` node anywhere: findWindow never attempts to parse the carry as a row, and
    // every retained row candidate is either a normal (parseable) row or an oversized marker —
    // never an `unreadable` kind (that kind does not even exist in this module's output).
    const candidates = candidatesFromRows(result.rows, result.from);
    expect(candidates.every((n) => n.k !== 'unreadable')).toBe(true);
    // Every retained row is a genuinely COMPLETE row: decoding + JSON.parse succeeds for each one
    // that is not the oversized marker shape.
    for (const rowBytes of result.rows) {
      if (rowBytes.length > 0 && rowBytes[0] === 0x00) continue; // the oversized marker shape
      expect(() => JSON.parse(new TextDecoder().decode(rowBytes))).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// candidatesFromRows / orphanPatches — small, targeted unit checks (the HTTP-level D27 proof lives
// in serve.reads.test.ts; these pin the pure decision in isolation).
// ---------------------------------------------------------------------------------------------

describe('candidatesFromRows', () => {
  test('decodes a plain row back into its normalizer candidates, anchored at the given offset', () => {
    const row = JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      timestamp: 't',
      message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'hi' }] },
    });
    const rowBytes = new TextEncoder().encode(row);
    const candidates = candidatesFromRows([rowBytes], 42);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.at).toBe(42);
    expect(candidates[0]!.i).toBe(0);
  });

  // spec §13 / D26: a COMPLETE row that fails to parse must become exactly one `unreadable` node
  // anchored at ITS OWN offset — never a silent drop (the oracle, spec §0: under-rendering is a
  // bug). This is distinct from an oversized row (-> `raw`/`oversized`, tested elsewhere) and from
  // a genuinely-partial trailing row (D30, never even reaches `candidatesFromRows`).
  test('a complete row that fails to parse (unparsable JSON) becomes exactly one unreadable node, anchored at its own offset — never a silent drop', () => {
    const goodRow = JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      timestamp: 't',
      message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'hi' }] },
    });
    const malformedRow = '{ not json';
    const rows = [new TextEncoder().encode(goodRow), new TextEncoder().encode(malformedRow)];
    const candidates = candidatesFromRows(rows, 100);

    expect(candidates).toHaveLength(2); // the malformed row is NEVER silently dropped
    expect(candidates[0]!.k).toBe('assistant');
    expect(candidates[1]!.k).toBe('unreadable');
    expect((candidates[1] as { k: 'unreadable'; count: number }).count).toBe(1);
    // Anchored at the MALFORMED row's own offset (after the first row + its stripped \n), not the
    // preceding row's offset and not offset 0.
    expect(candidates[1]!.at).toBe(100 + goodRow.length + 1);
    expect(candidates[1]!.i).toBe(0);
  });

  // The pre-pairing candidate count `findWindow` uses to decide the window boundary (D21,
  // `countCandidatesForRowText`) already counts an unparsable row as exactly 1 (matching "rung 1's
  // eventual single `unreadable` node"). This pins that the ACTUAL emitted node count, once the
  // window is built end to end, matches that count exactly — no drift between the boundary
  // decision and what is actually rendered.
  test('findWindow + candidatesFromRows over a file whose last complete row is unparsable: exactly one unreadable node is emitted, matching the boundary\'s own candidate count', () => {
    const goodLine = JSON.stringify({
      type: 'assistant',
      uuid: 'a',
      timestamp: 't',
      message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'row 1' }] },
    });
    const malformedLine = '{ this is not valid json at all';
    const buffer = new TextEncoder().encode([goodLine, malformedLine].join('\n') + '\n');
    const readBack: ReadBack = (end, len) => buffer.subarray(end - len, end);

    const result = findWindow(readBack, buffer.length, 10);
    const candidates = candidatesFromRows(result.rows, result.from);

    expect(candidates).toHaveLength(2); // one real node + one unreadable node — no silent drop
    const unreadable = candidates.filter((n) => n.k === 'unreadable');
    expect(unreadable).toHaveLength(1);
    expect((unreadable[0] as { count: number }).count).toBe(1);
  });
});

describe('orphanPatches (D27)', () => {
  function toolUseRowBytes(id: string): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({ type: 'assistant', uuid: 'u', timestamp: 't', message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] } }),
    );
  }

  function toolResultRowText(id: string): string {
    return JSON.stringify({ type: 'user', uuid: 'u2', timestamp: 't', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }] } });
  }

  test('call-in-range: yields a remove patch for the orphan\'s own row-anchor id', () => {
    const callRowBytes = toolUseRowBytes('toolu_x');
    const windowNodes = candidatesFromRows([callRowBytes], 0);
    expect(windowNodes).toHaveLength(1);
    expect(windowNodes[0]!.k).toBe('tool');

    const resultText = toolResultRowText('toolu_x');
    const tailBytes = new TextEncoder().encode(`${resultText}\n`);
    const patches = orphanPatches(tailBytes, 1000, windowNodes, ['toolu_x']);
    expect(patches).toEqual([{ op: 'remove', id: '1000:0' }]);
  });

  test('call-further-back (never held in this window): yields no patch, stays an orphan', () => {
    const windowNodes: never[] = [];
    const tailBytes = new TextEncoder().encode(`${toolResultRowText('toolu_missing')}\n`);
    expect(orphanPatches(tailBytes, 1000, windowNodes, ['toolu_missing'])).toEqual([]);
  });

  test('absent/empty orphans: patches: []', () => {
    const windowNodes = candidatesFromRows([toolUseRowBytes('toolu_y')], 0);
    expect(orphanPatches(new Uint8Array(0), 0, windowNodes, [])).toEqual([]);
  });

  test('an id the client never held (no matching call in range) is ignored, not an error', () => {
    const windowNodes = candidatesFromRows([toolUseRowBytes('toolu_real')], 0);
    const tailBytes = new TextEncoder().encode(`${toolResultRowText('toolu_real')}\n`);
    expect(orphanPatches(tailBytes, 1000, windowNodes, ['toolu_never_held'])).toEqual([]);
  });
});
