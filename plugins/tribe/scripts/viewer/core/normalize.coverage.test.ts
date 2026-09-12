import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHomeA, PROJECT_A_DIR, SESSION_1_ID, TOOL_USE_IDS } from '../fixtures/build.ts';
import { parseRecordLines, type TranscriptRecord } from './records.ts';
import { normalize, type RowInput } from './normalize.ts';
import type { RenderNode } from './model.ts';

// ---------------------------------------------------------------------------------------------
// normalize.coverage.test.ts — the MECHANICAL proof of spec §7.1 (D23 precedence ladder, at the
// D28 granularity). It loads the task-1 fixture from disk, classifies EVERY row (and every block
// inside a message row) by the ladder, and asserts the normalizer's actual output matches the
// EXPECTED classification for every one of them. Under-rendering (a row on disk the normalizer
// drops silently) is a bug per the oracle (spec §0); over-rendering an unknown row as a raw card
// is by design. A mismatch is reported BY ROW TYPE AND BYTE OFFSET — never a bare count — because
// "one row was classified wrong" is a failure you can only stare at (spec §7.1).
//
// The expected classification below is transcribed from spec §7.1 / §7.4 (the oracle for this
// test), NOT copied out of normalize.ts: the whole point is that an independent statement of the
// ladder agrees with the implementation over the fixture.
//
// PART 1 of the coverage proof (D28): pairing does not exist until task 9, so a `tool_result`
// block asserts only that it is PAIRABLE — which in part-1 form is an `orphan_result` node (a
// result with no call in pairing state, spec §7.5, never a drop). Task 9 extends this same test so
// each pairable block resolves to a `Patch` or a surviving `orphan_result`. No pairing here.
//
// Rung 1 (unparsable / oversized) is the BYTE reader's contract (D26, §13): the malformed line the
// fixture carries never reaches the normalizer — `parseRecordLines` drops it and it is accounted
// for below as `skipped`. Rows longer than ROW_CAP are the reader's `raw oversized` node (task 5 /
// 18), so the "every kind" session used here carries none. This test proves rungs 2, 4, 5 and the
// block-level outcomes over rows that actually reach the pure normalizer.
// ---------------------------------------------------------------------------------------------

const TITLE_SOURCE_TYPES = ['last-prompt', 'ai-title', 'custom-title'];
const METADATA_CHIP_TYPES = [
  'queue-operation',
  'mode',
  'permission-mode',
  'pr-link',
  'frame-link',
  'agent-name',
  'cost-state',
  'relocated',
];

/** The EXPECTED outcome for one row, computed straight from the spec table — the oracle side. */
function expectedFor(rec: TranscriptRecord): { kinds: string[]; note: string } {
  const obj = JSON.parse(rec.raw) as Record<string, unknown>;
  const t = rec.type;

  // Rung 2: title-source rows fold into the session title (§5.3) — no node of their own.
  if (TITLE_SOURCE_TYPES.includes(t)) return { kinds: [], note: 'rung 2: folded (title source)' };

  // Message rows (bucket A): descend to block level (D28), unless the row is a whole-row special.
  if (t === 'user' || t === 'assistant') {
    if (obj.isCompactSummary === true) return { kinds: ['divider'], note: 'compaction divider (§7.4)' };
    if (typeof obj.apiErrorStatus === 'number') return { kinds: ['error'], note: 'apiErrorStatus error node' };
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === 'string') {
      return { kinds: [t === 'user' ? 'prompt' : 'assistant'], note: 'bare-string content' };
    }
    if (!Array.isArray(content)) return { kinds: [], note: 'no content array' };
    const kinds: string[] = [];
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      switch (b.type) {
        case 'text':
          kinds.push(t === 'user' ? 'prompt' : 'assistant');
          break;
        case 'thinking':
          // Block rung: an empty `thinking` is the ONE silent block type (§7.2 named exception).
          if (typeof b.thinking === 'string' && b.thinking !== '') kinds.push('thinking');
          break;
        case 'tool_use':
          kinds.push('tool');
          break;
        case 'tool_result':
          // PAIRABLE (D28); part-1 form is orphan_result (spec §7.5). Task 9 makes it a Patch.
          kinds.push('orphan_result');
          break;
        case 'image':
          kinds.push('image');
          break;
        default:
          kinds.push(`UNEXPECTED_BLOCK:${String(b.type)}`);
      }
    }
    return { kinds, note: kinds.length === 0 ? 'rung 5: bucket E (all blocks silent)' : 'bucket A blocks' };
  }

  // Rung 4 (bucket C): attachment.
  if (t === 'attachment') return { kinds: ['attachment'], note: 'rung 4: attachment' };

  // Rung 4 (bucket B): system, per subtype (§7.4).
  if (t === 'system') {
    const st = obj.subtype;
    if (st === 'turn_duration' || st === 'compact_boundary') return { kinds: ['divider'], note: 'system divider' };
    if (typeof st === 'string') return { kinds: ['chip'], note: `system chip (${st})` };
    return { kinds: ['raw'], note: 'system without subtype -> raw' };
  }

  // Rung 4 (bucket B): named metadata chips.
  if (METADATA_CHIP_TYPES.includes(t)) return { kinds: ['chip'], note: `rung 4: ${t} chip` };

  // Rung 4 (bucket D): everything else — the open-world raw card (§7.1 anything-else row).
  return { kinds: ['raw'], note: 'rung 4: open-world raw (bucket D)' };
}

function loadSession1(): { inputs: RowInput[]; skipped: number } {
  const dest = mkdtempSync(join(tmpdir(), 'vc-normalize-coverage-'));
  cleanups.push(dest);
  buildHomeA(dest);
  const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_1_ID}.jsonl`);
  const raw = readFileSync(path, 'utf8');

  // Byte offsets: `at` is the offset of each row's FIRST byte (spec §4). Walk the raw bytes so the
  // offset is the true on-disk address, exactly what the reader would hand the normalizer.
  const inputs: RowInput[] = [];
  let skipped = 0;
  let offset = 0;
  for (const line of raw.split('\n')) {
    if (line.length > 0) {
      const { records } = parseRecordLines([line]);
      if (records.length === 0) skipped += 1;
      else inputs.push({ at: offset, record: records[0]! });
    }
    offset += Buffer.byteLength(line, 'utf8') + 1;
  }
  return { inputs, skipped };
}

const cleanups: string[] = [];
afterAll(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

describe('normalize coverage — every fixture row/block classified by the D23/D28 ladder (spec §7.1)', () => {
  test('the deliberate malformed line is a rung-1 unparsable row, dropped by the reader (not the normalizer)', () => {
    const { skipped } = loadSession1();
    // §13 / D26: an unparsable line becomes the reader's `unreadable` node; the normalizer never
    // sees it. Accounting for it here keeps rung 1 honest without pretending the pure core does it.
    expect(skipped).toBe(1);
  });

  test('EVERY row that reaches the normalizer is classified to exactly its spec §7.1 outcome — 0 unaccounted, 0 mismatched', () => {
    const { inputs } = loadSession1();
    const nodes = normalize(inputs);

    // Group emitted nodes by their row's byte offset (spec §4: a node's `at` is its row's offset).
    const byAt = new Map<number, RenderNode[]>();
    for (const n of nodes) {
      const bucket = byAt.get(n.at) ?? [];
      bucket.push(n);
      byAt.set(n.at, bucket);
    }

    const mismatches: string[] = [];
    let unaccounted = 0; // rows expected to emit >=1 node that produced NONE (silently dropped)

    for (const { at, record } of inputs) {
      const expected = expectedFor(record);
      const actualNodes = (byAt.get(at) ?? []).slice().sort((a, b) => a.i - b.i);
      const actualKinds = actualNodes.map((n) => n.k);

      if (expected.kinds.length > 0 && actualKinds.length === 0) unaccounted += 1;

      if (JSON.stringify(actualKinds) !== JSON.stringify(expected.kinds)) {
        mismatches.push(
          `row type=${record.type} at=${at} (${expected.note}): expected [${expected.kinds.join(', ')}] but got [${actualKinds.join(', ')}]`,
        );
      }
    }

    // Reported by row type AND byte offset — never a bare count (spec §7.1).
    expect({ unaccounted, mismatches }).toEqual({ unaccounted: 0, mismatches: [] });
  });

  test('D28 mixed row: one row, a tool_result block that is PAIRABLE and a text block that is a prompt', () => {
    // The block IS the unit (D28). The fixture's mixed user row (the shape at
    // agent-a09522dcffd66dd8a.jsonl:33) carries BOTH a `tool_result` and a `text` block. A per-row
    // rule would call the row one thing and drop the other — and the dropped one is the text (B2).
    const { inputs } = loadSession1();
    const nodes = normalize(inputs);

    const mixedRow = inputs.find(({ record }) => {
      const obj = JSON.parse(record.raw) as Record<string, unknown>;
      const content = (obj.message as Record<string, unknown> | undefined)?.content;
      if (!Array.isArray(content)) return false;
      const types = content.map((b) => (b as Record<string, unknown>)?.type);
      return types.includes('tool_result') && types.includes('text');
    });
    expect(mixedRow).toBeDefined();

    const rowNodes = nodes.filter((n) => n.at === mixedRow!.at).sort((a, b) => a.i - b.i);
    expect(rowNodes).toHaveLength(2);

    // Block 0: the tool_result — PAIRABLE. In part 1 that property manifests as an `orphan_result`
    // node (no pairing state yet, spec §7.5). This task ASSERTS pairable and STOPS: task 9 turns it
    // into a Patch. `orphan_result` carrying the mixed tool_use_id is the pre-pairing witness.
    const first = rowNodes[0]!;
    expect(first.k).toBe('orphan_result');
    if (first.k !== 'orphan_result') throw new Error('unreachable');
    expect(first.toolUseId).toBe(TOOL_USE_IDS.mixed);

    // Block 1: the text — a surviving prompt node from the SAME row (B2 fixed).
    const second = rowNodes[1]!;
    expect(second.k).toBe('prompt');
    expect(second.i).toBe(1);
  });
});
