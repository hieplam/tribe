import { describe, expect, test } from 'bun:test';
import { normalize, countCandidates, type RowInput } from './normalize.ts';
import { pair, createPairState, type PairState } from './pair.ts';
import type { RenderNode } from './model.ts';
import type { TranscriptRecord } from './records.ts';

// ---------------------------------------------------------------------------------------------
// pair.test.ts — task 9: tool pairing, orphans, elision (spec §6.4, §6.5, §7.5; D15, D19, D21,
// D27, D28). Every case below is named in the task-9 brief's Step 1 list. `pair()` is the SECOND
// stage: it consumes `normalize()`'s PRE-PAIRING candidates (unchanged from task 8) and resolves
// them against a bounded, cross-call pending map.
// ---------------------------------------------------------------------------------------------

function rec(obj: Record<string, unknown>): TranscriptRecord {
  const raw = JSON.stringify(obj);
  const record: TranscriptRecord = { type: obj.type as string, raw };
  if (typeof obj.uuid === 'string') record.uuid = obj.uuid;
  if (typeof obj.timestamp === 'string') record.timestamp = obj.timestamp;
  if ('message' in obj) record.message = obj.message;
  if (typeof obj.apiErrorStatus === 'number') record.apiErrorStatus = obj.apiErrorStatus;
  return record;
}

function input(at: number, obj: Record<string, unknown>): RowInput {
  return { at, record: rec(obj) };
}

function toolUseRow(at: number, id: string, name: string, toolInput: unknown, uuid = 'u'): RowInput {
  return input(at, { type: 'assistant', uuid, timestamp: 't', message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'tool_use', id, name, input: toolInput }] } });
}

function toolResultRow(at: number, toolUseId: string, content: unknown, isError = false, uuid = 'u'): RowInput {
  return input(at, { type: 'user', uuid, timestamp: 't', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] } });
}

/** normalize() + pair() over ONE fresh state, in one call — the "historical" shape (spec §6.4: one
 * window, one forward pass). */
function normalizeAndPair(rows: RowInput[], state: PairState = createPairState(), taskAgentIds?: ReadonlyMap<string, string>) {
  return pair(normalize(rows), state, taskAgentIds);
}

function toolNode(nodes: RenderNode[]): Extract<RenderNode, { k: 'tool' }> {
  const found = nodes.find((n) => n.k === 'tool');
  if (found === undefined || found.k !== 'tool') throw new Error('expected a tool node');
  return found;
}

describe('pair — a call and its result, in order (spec §7.5)', () => {
  test('the result completes the call via a Patch; no separate node for the result block', () => {
    const { nodes, patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_1', 'Bash', { command: 'ls' }),
      toolResultRow(100, 'toolu_1', 'file1\nfile2'),
    ]);

    // Exactly one NODE — the call, still 'pending' (spec §6.4: the tool node is completed via a
    // Patch, never mutated in the returned `nodes`).
    expect(nodes).toHaveLength(1);
    const call = toolNode(nodes);
    expect(call.state).toBe('pending');
    expect(call.result).toBeNull();

    // Exactly one Patch, targeting the call's own RowAnchor.id, carrying the COMPLETE node.
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.op).toBe('result');
    if (patch.op !== 'result') throw new Error('unreachable');
    expect(patch.id).toBe(call.id);
    expect(patch.node.k).toBe('tool');
    if (patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.state).toBe('ok');
    expect(patch.node.result).not.toBeNull();
    expect(patch.node.resultAnchor).toEqual({ at: 100, i: 0 });
    expect(patch.node.call).toEqual({ at: 0, i: 0 }); // D19: the call's OWN address, unchanged.
  });
});

describe('pair — a result whose call is outside the window (B1’s other half)', () => {
  test('renders an orphan_result node AT THE RESULT’S OWN file position — never dropped', () => {
    const { nodes, patches } = normalizeAndPair([toolResultRow(500, 'toolu_before_window', 'orphaned output')]);
    expect(patches).toEqual([]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('orphan_result');
    if (node.k !== 'orphan_result') throw new Error('unreachable');
    expect(node.toolUseId).toBe('toolu_before_window');
    expect(node.at).toBe(500); // the RESULT's own row offset, not the (unknown) call's.
    expect(node.resultAnchor).toEqual({ at: 500, i: 0 });
  });
});

describe('pair — a call with no result stays pending', () => {
  test('the tool node is untouched; no patch is ever produced for it', () => {
    const { nodes, patches } = normalizeAndPair([toolUseRow(0, 'toolu_lonely', 'Bash', { command: 'true' })]);
    expect(nodes).toHaveLength(1);
    expect(toolNode(nodes).state).toBe('pending');
    expect(patches).toEqual([]);
  });
});

describe('pair — two calls with the same id', () => {
  test('a later result pairs with the MOST RECENT call (last write wins on the pending map)', () => {
    const { nodes, patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_dup', 'Bash', { command: 'first' }),
      toolUseRow(100, 'toolu_dup', 'Bash', { command: 'second' }),
      toolResultRow(200, 'toolu_dup', 'second output'),
    ]);
    expect(nodes).toHaveLength(2); // both calls are still nodes; only the result became a patch.
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    if (patch.op !== 'result') throw new Error('unreachable');
    // The patch targets the SECOND call's row (at:100) — its input, "second" — never the first.
    expect(patch.id).toBe('100:0');
    if (patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.input).toEqual({ command: 'second' });
  });
});

describe('pair — a result with is_error sets state:error', () => {
  test('the completed replacement node carries state:"error" and isError:true on its result', () => {
    const { patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_err', 'Bash', { command: 'false' }),
      toolResultRow(100, 'toolu_err', 'boom', true),
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.state).toBe('error');
    if (patch.node.result === null || patch.node.result.r !== 'text') throw new Error('unreachable');
    expect(patch.node.result.isError).toBe(true);
  });
});

describe('pair — a Task call whose id matches a sidecar toolUseId (spec §7.5 closing paragraph)', () => {
  test('sets agentId on the call node when the id is in the supplied map', () => {
    const taskAgentIds = new Map([['toolu_task_1', 'agent-child-01']]);
    const { nodes } = normalizeAndPair(
      [toolUseRow(0, 'toolu_task_1', 'Task', { description: 'spawn a subagent' })],
      createPairState(),
      taskAgentIds,
    );
    expect(toolNode(nodes).agentId).toBe('agent-child-01');
  });

  test('a Task call whose id is NOT in the map stays agentId:null', () => {
    const { nodes } = normalizeAndPair(
      [toolUseRow(0, 'toolu_task_2', 'Task', {})],
      createPairState(),
      new Map([['some-other-id', 'agent-x']]),
    );
    expect(toolNode(nodes).agentId).toBeNull();
  });

  test('a non-Task call is never assigned agentId, even if its id is in the map', () => {
    const { nodes } = normalizeAndPair(
      [toolUseRow(0, 'toolu_bash', 'Bash', {})],
      createPairState(),
      new Map([['toolu_bash', 'agent-x']]),
    );
    expect(toolNode(nodes).agentId).toBeNull();
  });
});

describe('pair — D15: tool input over 64 KiB is elided, with no full payload in the node', () => {
  test('a >64 KiB tool input is dropped to null; elided/expandable are true; the node stays <64 KiB', () => {
    const hugeInput = { command: 'x'.repeat(70 * 1024) };
    const { nodes } = normalizeAndPair([toolUseRow(0, 'toolu_bigin', 'Bash', hugeInput)]);
    const call = toolNode(nodes);
    expect(call.elided).toBe(true);
    expect(call.expandable).toBe(true);
    expect(call.input).toBeNull(); // no full payload in the node.
    const encoded = new TextEncoder().encode(JSON.stringify(call)).length;
    expect(encoded).toBeLessThan(64 * 1024);
  });

  test('a small tool input is NOT elided', () => {
    const { nodes } = normalizeAndPair([toolUseRow(0, 'toolu_smallin', 'Bash', { command: 'ls' })]);
    const call = toolNode(nodes);
    expect(call.elided).toBe(false);
    expect(call.expandable).toBe(false);
    expect(call.input).toEqual({ command: 'ls' });
  });
});

describe('pair — D15/D19: a result over 64 KiB elides the ToolResult itself', () => {
  test('the ToolResult carries its OWN elided flag; the completed node’s outer flags are also true', () => {
    const hugeOutput = 'y'.repeat(70 * 1024);
    const { patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_bigout', 'Bash', { command: 'cat huge.log' }),
      toolResultRow(100, 'toolu_bigout', hugeOutput),
    ]);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.elided).toBe(true);
    expect(patch.node.expandable).toBe(true);
    const result = patch.node.result;
    if (result === null || result.r !== 'text') throw new Error('unreachable');
    expect(result.elided).toBe(true); // the RESULT half's OWN flag (§4).
    const encoded = new TextEncoder().encode(JSON.stringify(patch.node)).length;
    expect(encoded).toBeLessThan(64 * 1024);
    expect(JSON.stringify(patch.node)).not.toContain(hugeOutput); // no full payload survives.
  });

  test('an orphan_result whose own result is oversized also carries the elided flag', () => {
    const hugeOutput = 'z'.repeat(70 * 1024);
    const { nodes } = normalizeAndPair([toolResultRow(0, 'toolu_no_call', hugeOutput)]);
    const node = nodes[0]!;
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    expect(node.elided).toBe(true);
    expect(node.expandable).toBe(true);
    if (node.result.r !== 'text') throw new Error('unreachable');
    expect(node.result.elided).toBe(true);
  });

  test('a small result is NOT elided', () => {
    const { patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_smallout', 'Bash', { command: 'ls' }),
      toolResultRow(100, 'toolu_smallout', 'file1'),
    ]);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.elided).toBe(false);
    expect(patch.node.expandable).toBe(false);
  });
});

describe('pair — D15/D19: the WHOLE completed tool node is capped, even when NEITHER half alone crosses 64 KiB', () => {
  const enc = (s: string): number => new TextEncoder().encode(s).length;

  test('a ~40 KiB input paired with a ~40 KiB result — each under the cap alone — is capped as ONE node (was 80,321 B, pairedElided:false)', () => {
    // Sol's probe: neither the call node (40 KiB input) nor the orphan_result (40 KiB result) trips
    // its own elision, so pairing combined them into an 80,321-byte `tool` node with `elided:false`.
    // D19 gives a tool card two payloads but NO size exemption — the COMPLETE node must be ≤ 65,536 B.
    const input40k = { command: 'x'.repeat(40000) };
    const result40k = 'y'.repeat(40000);
    const { patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_bothmid', 'Bash', input40k),
      toolResultRow(100, 'toolu_bothmid', result40k),
    ]);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(enc(JSON.stringify(patch.node))).toBeLessThanOrEqual(64 * 1024);
    expect(patch.node.elided).toBe(true);
    expect(patch.node.expandable).toBe(true);
  });

  test('a NEAR-cap input paired with a NEAR-cap result stays ≤ 64 KiB (boundary regression)', () => {
    const nearCap = 63 * 1024;
    const { patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_nearcap', 'Bash', { command: 'x'.repeat(nearCap) }),
      toolResultRow(100, 'toolu_nearcap', 'y'.repeat(nearCap)),
    ]);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(enc(JSON.stringify(patch.node))).toBeLessThanOrEqual(64 * 1024);
    expect(patch.node.elided).toBe(true);
  });

  test('a small call paired with a small result is NOT elided (the cap bites only at the boundary)', () => {
    const { patches } = normalizeAndPair([
      toolUseRow(0, 'toolu_bothsmall', 'Bash', { command: 'ls' }),
      toolResultRow(100, 'toolu_bothsmall', 'file1\nfile2'),
    ]);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.elided).toBe(false);
    expect(patch.node.input).toEqual({ command: 'ls' }); // small input is preserved whole.
    expect(enc(JSON.stringify(patch.node))).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('pair — D19: two anchors, call and resultAnchor', () => {
  test('a paired node’s resultAnchor.at is greater than its call.at (the result is a later row)', () => {
    const { patches } = normalizeAndPair([
      toolUseRow(10, 'toolu_anchors', 'Read', { file_path: '/x' }),
      toolResultRow(200, 'toolu_anchors', 'contents'),
    ]);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.call).toEqual({ at: 10, i: 0 });
    expect(patch.node.resultAnchor).toEqual({ at: 200, i: 0 });
    expect(patch.node.resultAnchor!.at).toBeGreaterThan(patch.node.call.at);
  });

  test('both halves elided at once yields two DISTINCT addresses (one for each 64 KiB payload)', () => {
    const hugeInput = { command: 'x'.repeat(70 * 1024) };
    const hugeOutput = 'y'.repeat(70 * 1024);
    const { patches } = normalizeAndPair([
      toolUseRow(10, 'toolu_bothbig', 'Bash', hugeInput),
      toolResultRow(9999, 'toolu_bothbig', hugeOutput),
    ]);
    const patch = patches[0]!;
    if (patch.op !== 'result' || patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.elided).toBe(true);
    expect(patch.node.input).toBeNull();
    if (patch.node.result === null || patch.node.result.r !== 'text') throw new Error('unreachable');
    expect(patch.node.result.elided).toBe(true);
    // Two distinct addresses — call vs resultAnchor — each independently fetchable.
    expect(patch.node.call).not.toEqual(patch.node.resultAnchor);
    expect(patch.node.call).toEqual({ at: 10, i: 0 });
    expect(patch.node.resultAnchor).toEqual({ at: 9999, i: 0 });
  });

  test('an orphan_result carries resultAnchor and no call field', () => {
    const { nodes } = normalizeAndPair([toolResultRow(0, 'toolu_orphan_anchor', 'output')]);
    const node = nodes[0]!;
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    expect(node.resultAnchor).toEqual({ at: 0, i: 0 });
    expect('call' in node).toBe(false);
  });
});

describe('pair — D21: pre-pairing candidate count vs post-pairing rendered count', () => {
  test('agrees with the emitted node count when nothing pairs', () => {
    const rows = [toolResultRow(0, 'toolu_nomatch', 'nothing to pair with')];
    const pre = countCandidates(rows);
    const { nodes } = normalizeAndPair(rows);
    expect(pre).toBe(1);
    expect(nodes.length).toBe(pre);
  });

  test('is GREATER than the post-pairing rendered count when a result pairs into its call', () => {
    const rows = [toolUseRow(0, 'toolu_pairs', 'Bash', { command: 'ls' }), toolResultRow(100, 'toolu_pairs', 'ok')];
    const pre = countCandidates(rows); // 2 candidates: the call, and the result.
    const { nodes } = normalizeAndPair(rows); // 1 node: the result became a Patch, not a node.
    expect(pre).toBe(2);
    expect(nodes.length).toBe(1);
    expect(pre).toBeGreaterThan(nodes.length);
  });
});

describe('pair — cross-tick: the live half of B1 (spec §6.4)', () => {
  test('tool_use on tick 1, tool_result on tick 2: no new node on tick 2, exactly one Patch', () => {
    const state = createPairState();
    const tick1 = normalizeAndPair([toolUseRow(0, 'toolu_tick', 'Bash', { command: 'ls' })], state);
    expect(tick1.nodes).toHaveLength(1);
    expect(tick1.patches).toEqual([]);
    const tick1Id = toolNode(tick1.nodes).id;

    const tick2 = normalizeAndPair([toolResultRow(1000, 'toolu_tick', 'file1\nfile2')], state);
    expect(tick2.nodes).toEqual([]); // NO new node.
    expect(tick2.patches).toHaveLength(1);
    const patch = tick2.patches[0]!;
    expect(patch.op).toBe('result');
    if (patch.op !== 'result') throw new Error('unreachable');
    expect(patch.id).toBe(tick1Id); // the id of the ALREADY-SENT tick-1 node.
    if (patch.node.k !== 'tool') throw new Error('unreachable');
    expect(patch.node.state).toBe('ok'); // COMPLETE, not a delta.
    expect(patch.node.result).not.toBeNull();
  });

  test('a disconnect between rows and patch is harmless: reconnect re-derives the SAME RowAnchor.id', () => {
    // D12/§6.4: RowAnchor.id is derived from byte offset + block index, never a counter, so a
    // completely FRESH state re-deriving the same rows produces the identical id — streaming,
    // back-fill, or a re-read after reset all agree (spec §6.4 closing paragraph).
    const streamed = normalizeAndPair([toolUseRow(42, 'toolu_reconnect', 'Bash', {})], createPairState());
    const reread = normalizeAndPair([toolUseRow(42, 'toolu_reconnect', 'Bash', {})], createPairState());
    expect(toolNode(reread.nodes).id).toBe(toolNode(streamed.nodes).id);
    expect(toolNode(reread.nodes).id).toBe('42:0');
  });
});

describe('pair — RowAnchor.id derives from byte offset + block index, never a counter', () => {
  test('the SAME rows fed as one batch or as N single-row calls produce the SAME ids', () => {
    const rows = [
      toolUseRow(0, 'toolu_a', 'Bash', {}),
      toolUseRow(500, 'toolu_b', 'Read', {}),
      toolResultRow(1000, 'toolu_a', 'a-out'),
    ];
    const oneBatch = normalizeAndPair(rows, createPairState());

    const perRow = createPairState();
    const perRowNodes: RenderNode[] = [];
    const perRowPatches: (typeof oneBatch)['patches'] = [];
    for (const row of rows) {
      const tick = normalizeAndPair([row], perRow);
      perRowNodes.push(...tick.nodes);
      perRowPatches.push(...tick.patches);
    }

    expect(perRowNodes.map((n) => n.id)).toEqual(oneBatch.nodes.map((n) => n.id));
    expect(perRowPatches.map((p) => p.id)).toEqual(oneBatch.patches.map((p) => p.id));
  });
});

describe('pair — the pending map evicts at 512 entries, oldest first (spec §6.5)', () => {
  test('the 513th call evicts the 1st; that evicted call’s late result renders as an orphan_result', () => {
    const state = createPairState();
    const rows: RowInput[] = [];
    for (let n = 0; n < 513; n++) {
      rows.push(toolUseRow(n * 100, `toolu_evict_${n}`, 'Bash', { n }));
    }
    const first = normalizeAndPair(rows, state);
    expect(first.nodes).toHaveLength(513); // every call still emits its own pending node.

    // toolu_evict_0 was the OLDEST insertion and should now be evicted.
    const late = normalizeAndPair([toolResultRow(999999, 'toolu_evict_0', 'too late')], state);
    expect(late.patches).toEqual([]);
    expect(late.nodes).toHaveLength(1);
    expect(late.nodes[0]!.k).toBe('orphan_result');

    // toolu_evict_512 (the most recent) is still live and pairs normally.
    const onTime = normalizeAndPair([toolResultRow(999998, 'toolu_evict_512', 'right on time')], state);
    expect(onTime.nodes).toEqual([]);
    expect(onTime.patches).toHaveLength(1);
  });
});

describe('pair — the raw node’s text field (spec §4): non-null ONLY for rowType:"oversized"', () => {
  test('an ordinary raw card (unknown row type) carries text:null, content in json', () => {
    const { nodes } = normalizeAndPair([input(0, { type: 'a-future-row-type', anything: true })]);
    const node = nodes[0]!;
    if (node.k !== 'raw') throw new Error('expected raw');
    expect(node.text).toBeNull();
    expect(node.json.length).toBeGreaterThan(0);
  });

  test('an unparsable row is NOT a raw card — it is the separate unreadable kind, carrying a count and no text (§13)', () => {
    // §13 / D26: an unparsable line is dropped by records.ts before it ever reaches normalize()/
    // pair() — this is asserted at that boundary (normalize.coverage.test.ts, rung 1), not
    // reimplemented here. This test instead proves `unreadable` is a distinct RenderNode kind that
    // carries `count` and NOT `text`, so a future refactor cannot quietly merge it into `raw`.
    const unreadable: RenderNode = { k: 'unreadable', count: 1, id: '0:0', at: 0, i: 0, uuid: null, ts: null, elided: false, expandable: false };
    expect('text' in unreadable).toBe(false);
    expect(unreadable.count).toBe(1);
  });
});

describe('pair — D15: prompt/assistant/thinking/error/raw bodies over 64 KiB are elided (never dropped)', () => {
  test('an oversized assistant text block becomes ONE node under 64 KiB, elided+expandable', () => {
    const huge = 'a'.repeat(200 * 1024);
    const { nodes } = normalizeAndPair([
      input(0, { type: 'assistant', uuid: 'u', timestamp: 't', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: huge }] } }),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('assistant');
    expect(node.elided).toBe(true);
    expect(node.expandable).toBe(true);
    const encoded = new TextEncoder().encode(JSON.stringify(node)).length;
    expect(encoded).toBeLessThan(64 * 1024);
  });

  test('an oversized prompt is elided the same way', () => {
    const huge = 'p'.repeat(200 * 1024);
    const { nodes } = normalizeAndPair([
      input(0, { type: 'user', uuid: 'u', timestamp: 't', message: { role: 'user', content: [{ type: 'text', text: huge }] } }),
    ]);
    const node = nodes[0]!;
    expect(node.k).toBe('prompt');
    expect(node.elided).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(node)).length).toBeLessThan(64 * 1024);
  });

  test('an oversized thinking block is elided the same way', () => {
    const huge = 't'.repeat(200 * 1024);
    const { nodes } = normalizeAndPair([
      input(0, { type: 'assistant', uuid: 'u', timestamp: 't', message: { role: 'assistant', model: 'm', content: [{ type: 'thinking', thinking: huge, signature: 's' }] } }),
    ]);
    const node = nodes[0]!;
    expect(node.k).toBe('thinking');
    expect(node.elided).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(node)).length).toBeLessThan(64 * 1024);
  });

  test('an oversized error body is elided the same way', () => {
    const huge = 'e'.repeat(200 * 1024);
    const { nodes } = normalizeAndPair([
      input(0, { type: 'assistant', uuid: 'u', timestamp: 't', apiErrorStatus: 500, message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: huge }] } }),
    ]);
    const node = nodes[0]!;
    expect(node.k).toBe('error');
    expect(node.elided).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(node)).length).toBeLessThan(64 * 1024);
  });

  test('a raw card over the JSON cap is elided the same way', () => {
    const raw = { type: 'a-future-row-type', blob: 'r'.repeat(200 * 1024) };
    const { nodes } = normalizeAndPair([input(0, raw)]);
    const node = nodes[0]!;
    if (node.k !== 'raw') throw new Error('expected raw');
    expect(node.elided).toBe(true);
    expect(node.expandable).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(node)).length).toBeLessThan(64 * 1024);
  });

  test('after this task, no emitted node of ANY kind exceeds 64 KiB across a mixed batch', () => {
    const hugeText = 'm'.repeat(300 * 1024);
    const { nodes, patches } = normalizeAndPair([
      input(0, { type: 'user', uuid: 'u', timestamp: 't', message: { role: 'user', content: [{ type: 'text', text: hugeText }] } }),
      toolUseRow(1000, 'toolu_mix', 'Bash', { command: hugeText }),
      toolResultRow(2000, 'toolu_mix', hugeText),
      input(3000, { type: 'unknown-mixed-row', blob: hugeText }),
    ]);
    const all = [...nodes, ...patches.map((p) => (p.op === 'result' ? p.node : null)).filter((n): n is RenderNode => n !== null)];
    for (const n of all) {
      expect(new TextEncoder().encode(JSON.stringify(n)).length).toBeLessThan(64 * 1024);
    }
  });
});
