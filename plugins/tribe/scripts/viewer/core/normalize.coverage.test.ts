import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHomeA, PROJECT_A_DIR, SESSION_1_ID, TOOL_USE_IDS } from '../fixtures/build.ts';
import { parseRecordLines, type TranscriptRecord } from './records.ts';
import { normalize, type RowInput } from './normalize.ts';
import { pair, createPairState } from './pair.ts';
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
// PART 2 (D28, task 9): pairing now exists (`core/pair.ts`). A `tool_result` block's outcome is
// determined by an INDEPENDENT forward-pass oracle (`seenCalls`, below) that tracks — in file
// order, exactly the shape `core/pair.ts`'s own bounded map tracks — which `tool_use` ids have
// already been seen. A `tool_result` whose id IS in `seenCalls` resolves to a `Patch` (no node of
// its own at that row); one that is NOT resolves to a surviving `orphan_result` node, exactly as
// part 1 asserted. This is a second, independently-authored statement of the ladder, not a call
// into `pair.ts` to check itself — the real `normalize()` + `pair()` pipeline is exercised
// separately, below, and its `nodes`/`patches` are compared against this oracle's expectations.
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

/** The EXPECTED outcome for one row, computed straight from the spec table — the oracle side.
 * `seenCalls` is mutated IN FILE ORDER as rows are classified (the caller must call this once per
 * row, in order): a `tool_use` block's id is added the moment it is seen; a `tool_result` block
 * checks membership BEFORE returning. This is an independent, minimal forward-pass tracker — not
 * a second implementation of `core/pair.ts` (no elision, no eviction, no agentId, no cross-tick
 * state) — exactly enough to state the D28 ladder's outcome for THIS fixture. */
function expectedFor(rec: TranscriptRecord, seenCalls: Set<string>): { kinds: string[]; note: string } {
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
    // Classification is TOTAL (D23/D28): a message row whose `message`/`content` is malformed
    // (absent, or neither a string nor an array) is NOT one of bucket E's silent cases — it renders
    // a visible `raw` fallback (bucket D). Silence is reserved STRICTLY for a `thinking` block whose
    // text is "" (asserted at the block rung below). An empty ARRAY is well-formed and yields no
    // node — the loop runs zero times — which is distinct from the malformed shape here.
    if (!Array.isArray(content)) return { kinds: ['raw'], note: 'malformed message (absent/non-array content) -> raw fallback (bucket D)' };
    const kinds: string[] = [];
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      switch (b.type) {
        case 'text':
          kinds.push(t === 'user' ? 'prompt' : 'assistant');
          break;
        case 'thinking':
          // Block rung (D28): the ONLY silent block is a `thinking` whose text is EXACTLY "" (§7.2
          // named exception). A non-empty string thinking is a `thinking` node; a MISSING or
          // non-string `thinking` value is malformed and renders a visible `raw` fallback — never
          // silent. Pinning this is the point: an oracle that dropped non-string thinking (as an
          // earlier draft did) could not catch the implementation's silent drop.
          if (b.thinking === '') break;
          kinds.push(typeof b.thinking === 'string' ? 'thinking' : 'raw');
          break;
        case 'tool_use':
          kinds.push('tool');
          if (typeof b.id === 'string') seenCalls.add(b.id);
          break;
        case 'tool_result': {
          // PAIRABLE (D28): a Patch when the call is already in pairing state (seenCalls), else a
          // surviving orphan_result node (spec §7.5, never a drop). A paired result contributes NO
          // node at its own row — that is exactly why it is absent from `kinds` here.
          const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
          if (!seenCalls.has(toolUseId)) kinds.push('orphan_result');
          break;
        }
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

  test('EVERY row that reaches the normalizer+pair pipeline is classified to exactly its spec §7.1/§7.5 outcome — 0 unaccounted, 0 mismatched', () => {
    const { inputs } = loadSession1();
    const candidates = normalize(inputs);
    const { nodes, patches } = pair(candidates, createPairState());

    // Group POST-PAIRING nodes by their row's byte offset (spec §4: a node's `at` is its row's
    // offset). A paired tool_result contributes NOTHING here — its outcome is a Patch, checked
    // separately below — which is exactly the D21 "post-pairing count may be lower" property.
    const byAt = new Map<number, RenderNode[]>();
    for (const n of nodes) {
      const bucket = byAt.get(n.at) ?? [];
      bucket.push(n);
      byAt.set(n.at, bucket);
    }

    const mismatches: string[] = [];
    let unaccounted = 0; // rows expected to emit >=1 node that produced NONE (silently dropped)
    const seenCalls = new Set<string>(); // the independent oracle's own forward-pass tracker.
    let expectedPairs = 0;

    for (const { at, record } of inputs) {
      // A pairing happens at this row iff a `tool_result` block's call is ALREADY in `seenCalls`
      // — checked BEFORE `expectedFor` runs (it only ever ADDS `tool_use` ids, never removes),
      // exactly mirroring the same-pass forward semantics `core/pair.ts` implements.
      const obj = JSON.parse(record.raw) as Record<string, unknown>;
      const content = (obj.message as Record<string, unknown> | undefined)?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          const block = b as Record<string, unknown> | null;
          if (block !== null && block.type === 'tool_result') {
            const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
            if (seenCalls.has(toolUseId)) expectedPairs += 1;
          }
        }
      }

      const expected = expectedFor(record, seenCalls);
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
    // D28: every pairable block resolves to a Patch (call in pairing state) or a surviving
    // orphan_result (asserted above via `kinds`) — never both, never neither.
    expect(patches).toHaveLength(expectedPairs);
    for (const patch of patches) {
      expect(patch.op).toBe('result');
    }
  });

  test('malformed message/block shapes are classified TOTAL — a visible raw fallback, silence ONLY for thinking==="" (D23/D28, spec §7.1 D/E)', () => {
    // These shapes are absent from the on-disk fixture (a well-formed corpus carries none), so the
    // fixture-driven proof above cannot exercise them — "a coverage test that classifies every
    // fixture row proves nothing about a shape the fixture lacks" (spec §7.1). Feed them straight to
    // the real `normalize()` and require the SAME independent oracle (`expectedFor`) that classifies
    // the fixture to AGREE with the implementation, so the total-classification contract is pinned
    // rather than the buggy silent-drop behavior an earlier oracle draft repeated.
    const synth = (at: number, row: Record<string, unknown>): { input: RowInput; record: TranscriptRecord } => {
      const record: TranscriptRecord = { type: row.type as string, raw: JSON.stringify(row) };
      if ('message' in row) record.message = row.message;
      return { input: { at, record }, record };
    };

    const rows: Record<string, unknown>[] = [
      { type: 'user', message: { role: 'user' } }, // content ABSENT
      { type: 'assistant', message: { role: 'assistant', content: 42 } }, // content non-array/non-string
      { type: 'user' }, // message field ABSENT entirely
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', signature: 's' }] } }, // thinking MISSING
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 7 }] } }, // thinking NON-string
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] } }, // the ONE silent case
      { type: 'user', message: { role: 'user', content: [] } }, // well-formed empty array — legitimately silent
    ];

    rows.forEach((row, idx) => {
      const { input, record } = synth(idx * 1000, row);
      const actual: string[] = normalize([input]).map((n) => n.k);
      const expected = expectedFor(record, new Set<string>());
      expect({ shape: idx, kinds: actual }).toEqual({ shape: idx, kinds: expected.kinds });
    });

    // Belt-and-braces: the ONLY silent shape among the above is the exactly-"" thinking (and the
    // well-formed empty array). Every other malformed shape produced a visible node.
    const visibleCounts = rows.map((row, idx) => normalize([synth(idx * 1000, row).input]).length);
    expect(visibleCounts).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });

  test('D28 mixed row: one row, a tool_result block that PAIRS (a Patch) and a text block that survives as a prompt', () => {
    // The block IS the unit (D28). The fixture's mixed user row (the shape at
    // agent-a09522dcffd66dd8a.jsonl:33) carries BOTH a `tool_result` and a `text` block. A per-row
    // rule would call the row one thing and drop the other — and the dropped one is the text (B2).
    const { inputs } = loadSession1();
    const candidates = normalize(inputs);
    const { nodes, patches } = pair(candidates, createPairState());

    const mixedRow = inputs.find(({ record }) => {
      const obj = JSON.parse(record.raw) as Record<string, unknown>;
      const content = (obj.message as Record<string, unknown> | undefined)?.content;
      if (!Array.isArray(content)) return false;
      const types = content.map((b) => (b as Record<string, unknown>)?.type);
      return types.includes('tool_result') && types.includes('text');
    });
    expect(mixedRow).toBeDefined();

    // The mixed row's tool_result pairs with TOOL_USE_IDS.mixed's call, which the fixture places
    // EARLIER in the same file (spec §7.5): the call resolves BEFORE it is ever emitted (this
    // pass), so it becomes a Patch — the row's own post-pairing nodes hold ONLY the surviving text.
    const rowNodes = nodes.filter((n) => n.at === mixedRow!.at).sort((a, b) => a.i - b.i);
    expect(rowNodes).toHaveLength(1);
    const survivor = rowNodes[0]!;
    expect(survivor.k).toBe('prompt');
    expect(survivor.i).toBe(1); // block 0 (the tool_result) contributed no node — it is the patch.

    const callNode = candidates.find((n) => n.k === 'tool' && n.toolUseId === TOOL_USE_IDS.mixed);
    expect(callNode).toBeDefined();
    const patch = patches.find((p) => p.op === 'result' && p.id === callNode!.id);
    expect(patch).toBeDefined();
    if (patch === undefined || patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.toolUseId).toBe(TOOL_USE_IDS.mixed);
    expect(patch.node.resultAnchor).toEqual({ at: mixedRow!.at, i: 0 });
  });
});
