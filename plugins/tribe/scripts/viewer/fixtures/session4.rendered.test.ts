import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHomeA, PROJECT_A_DIR, SESSION_4_ID } from './build.ts';
import { parseRecordLines } from '../core/records.ts';
import { normalize, countCandidates, type RowInput } from '../core/normalize.ts';
import { pair, createPairState } from '../core/pair.ts';

// ---------------------------------------------------------------------------------------------
// fixtures/session4.rendered.test.ts — D22: "Task 1 asserts only what a fixture builder can know
// without production code … the >= 2,300 RENDERED count is asserted in Task 9 (pairing) by a
// fixtures/session4.rendered.test.ts that runs the REAL normalizer + pairer over the fixture."
//
// This test runs the REAL `core/normalize.ts` and `core/pair.ts` — never a reimplementation — over
// task-1's <session-4> fixture (2,400 rows / 2,600 candidate blocks, D20/D21/D22/D26) and asserts
// the post-pairing rendered node count is >= 2,300, above the 2,000-node client cap (spec §6.5) —
// which is what makes tasks 24/31's eviction and "N new below" assertions reachable at all.
//
// session-4 carries NO tool_use/tool_result blocks (it exists to exercise the window boundary and
// the byte-size caps, not pairing), so nothing pairs here: the post-pairing count equals the
// pre-pairing candidate count exactly. That is itself a real assertion of D21's "agrees with the
// emitted node count when nothing pairs" property, over the full fixture rather than a synthetic
// case.
// ---------------------------------------------------------------------------------------------

const cleanups: string[] = [];
afterAll(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

/** Reads session-4's real bytes off disk and turns them into `RowInput[]`, exactly the shape a
 * reader hands the normalizer: `at` is the TRUE byte offset of each row's first byte, walked over
 * the raw file content — not reconstructed from anything the normalizer or pairer computed. */
function loadSession4(): RowInput[] {
  const dest = mkdtempSync(join(tmpdir(), 'vc-session4-rendered-'));
  cleanups.push(dest);
  buildHomeA(dest);
  const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.jsonl`);
  const raw = readFileSync(path, 'utf8');

  const inputs: RowInput[] = [];
  let offset = 0;
  for (const line of raw.split('\n')) {
    if (line.length > 0) {
      const { records } = parseRecordLines([line]);
      if (records.length > 0) inputs.push({ at: offset, record: records[0]! });
    }
    offset += Buffer.byteLength(line, 'utf8') + 1;
  }
  return inputs;
}

describe('session-4 rendered node count (D22) — real normalize.ts + pair.ts, no reimplementation', () => {
  test('the pre-pairing candidate count is exactly 2,600 (task 1’s measured fixture claim)', () => {
    const inputs = loadSession4();
    expect(inputs).toHaveLength(2400);
    expect(countCandidates(inputs)).toBe(2600);
  });

  test('the post-pairing rendered node count is >= 2,300 — above the 2,000-node client cap', () => {
    const inputs = loadSession4();
    const candidates = normalize(inputs);
    const { nodes, patches } = pair(candidates, createPairState());

    // session-4 has no tool calls at all, so nothing pairs: no patches, and the rendered count
    // equals the pre-pairing candidate count exactly (D21's "agrees when nothing pairs").
    expect(patches).toEqual([]);
    expect(nodes.length).toBe(candidates.length);
    expect(nodes.length).toBeGreaterThanOrEqual(2300);

    // No emitted node — including the 2 MiB / exact-ROW_CAP text rows — exceeds the 64 KiB
    // per-node cap (D15), which is the precondition the frame budget (spec §14) relies on.
    for (const node of nodes) {
      expect(new TextEncoder().encode(JSON.stringify(node)).length).toBeLessThan(64 * 1024);
    }
  });
});
