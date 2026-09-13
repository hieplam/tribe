// client/src/rowStore.test.ts — the window store contract (spec §6.3, §6.4, §8.4). The store is
// the SINGLE owner of row identity, dedupe, and eviction; it holds ONE contiguous window
// [first,last] in byte offsets, never a sparse set of ranges. These are the invariants that fail
// silently, so each is asserted directly, and `isContiguous` is re-checked after EVERY operation.
//
// Pure by construction: no fetch, no DOM. The two operations that need the network (`loadEarlier`,
// `reloadTail`) take an INJECTED `FetchRows` seam (`pure-core.md`), so a fake records the request
// it was handed and returns the page under test.
import { describe, expect, test } from 'bun:test';
import type { Patch, RenderNode } from '../../core/model.ts';
import {
  createRowStore,
  isContiguous,
  orphanToolUseIds,
  WINDOW_CAP,
  type FetchRows,
  type RowsPage,
} from './rowStore.ts';

// --- node fixtures -------------------------------------------------------------------------
// `id` is ALWAYS `${at}:${i}` (spec §4), so identity is a pure function of the bytes on disk.

function assistantNode(at: number, i = 0): RenderNode {
  return {
    id: `${at}:${i}`, at, i, uuid: null, ts: null, elided: false, expandable: false,
    k: 'assistant', body: [{ t: 'text', v: `row@${at}` }], model: null,
  };
}

function orphanNode(at: number, toolUseId: string): RenderNode {
  return {
    id: `${at}:0`, at, i: 0, uuid: null, ts: null, elided: false, expandable: false,
    k: 'orphan_result', toolUseId, resultAnchor: { at, i: 0 },
    result: { r: 'text', body: [{ t: 'text', v: 'ok' }], isError: false, elided: false },
  };
}

function toolNode(at: number, toolUseId: string, state: 'pending' | 'ok' | 'error' = 'ok'): RenderNode {
  return {
    id: `${at}:0`, at, i: 0, uuid: null, ts: null, elided: false, expandable: false,
    k: 'tool', name: 'Bash', input: { cmd: 'ls' }, state, toolUseId, agentId: null,
    call: { at, i: 0 },
    resultAnchor: state === 'pending' ? null : { at, i: 0 },
    result: state === 'pending' ? null
      : { r: 'text', body: [{ t: 'text', v: 'out' }], isError: state === 'error', elided: false },
  };
}

function page(nodes: RenderNode[], patches: Patch[] = []): RowsPage {
  const from = nodes.length ? nodes[0]!.at : 0;
  const to = nodes.length ? nodes[nodes.length - 1]!.at + 100 : 0;
  return { nodes, patches, from, to, truncatedBefore: from > 0 };
}

/** A fake `FetchRows` that records the request it received and returns a fixed page. */
function fakeFetch(result: RowsPage): { fetch: FetchRows; calls: Array<{ before: number | null; orphans: string[] }> } {
  const calls: Array<{ before: number | null; orphans: string[] }> = [];
  const fetch: FetchRows = async (req) => {
    calls.push(req);
    return result;
  };
  return { fetch, calls };
}

/** Seed a following window under one generation. */
function seeded(generation = 'gen-1', nodes = [assistantNode(1000), assistantNode(1100)]): ReturnType<typeof createRowStore> {
  const store = createRowStore();
  store.hello({ generation, from: nodes[0]!.at, to: nodes[nodes.length - 1]!.at + 100, truncatedBefore: nodes[0]!.at > 0 });
  store.applyRows({ nodes, from: nodes[0]!.at, to: nodes[nodes.length - 1]!.at + 100 });
  return store;
}

describe('rowStore — one contiguous window, keyed by RowAnchor.id', () => {
  test('applyRows appends new-id nodes in file order and stays contiguous', () => {
    const store = seeded();
    expect(store.getSnapshot().nodes.map((n) => n.id)).toEqual(['1000:0', '1100:0']);
    store.applyRows({ nodes: [assistantNode(1200)], from: 1200, to: 1300 });
    expect(store.getSnapshot().nodes.map((n) => n.id)).toEqual(['1000:0', '1100:0', '1200:0']);
    expect(isContiguous(store.getSnapshot().nodes)).toBe(true);
  });

  test('a rows node whose id is already present is IGNORED, not appended (D12 overlap dropped)', () => {
    const store = seeded();
    const before = store.getSnapshot().nodes.length;
    // The reconnect-overlap case: the new window re-delivers a node the store already holds.
    store.applyRows({ nodes: [assistantNode(1100), assistantNode(1200)], from: 1100, to: 1300 });
    const snap = store.getSnapshot();
    // Only the genuinely new node (1200:0) was added; 1100:0 was NOT duplicated.
    expect(snap.nodes.map((n) => n.id)).toEqual(['1000:0', '1100:0', '1200:0']);
    expect(snap.nodes.length).toBe(before + 1);
    expect(isContiguous(snap.nodes)).toBe(true);
  });

  test('patch result REPLACES the node at its id in place — position preserved, count unchanged', () => {
    const store = seeded('gen-1', [assistantNode(1000), toolNode(1100, 'tu-1', 'pending'), assistantNode(1200)]);
    const before = store.getSnapshot();
    expect((before.nodes[1] as { state: string }).state).toBe('pending');
    store.applyPatches([{ op: 'result', id: '1100:0', node: toolNode(1100, 'tu-1', 'ok') }]);
    const after = store.getSnapshot();
    expect(after.nodes.length).toBe(before.nodes.length); // count unchanged
    expect(after.nodes.map((n) => n.id)).toEqual(['1000:0', '1100:0', '1200:0']); // position preserved
    expect((after.nodes[1] as { state: string }).state).toBe('ok'); // replaced in place
    expect(isContiguous(after.nodes)).toBe(true);
  });

  test('patch remove DELETES the node at its id and nothing replaces it', () => {
    const store = seeded('gen-1', [assistantNode(1000), orphanNode(1100, 'tu-1'), assistantNode(1200)]);
    store.applyPatches([{ op: 'remove', id: '1100:0' }]);
    const after = store.getSnapshot();
    expect(after.nodes.map((n) => n.id)).toEqual(['1000:0', '1200:0']);
    expect(isContiguous(after.nodes)).toBe(true);
  });

  test('a patch (result OR remove) for an id OUTSIDE the window is dropped silently', () => {
    const store = seeded();
    const before = store.getSnapshot().nodes;
    store.applyPatches([
      { op: 'result', id: '9999:0', node: toolNode(9999, 'tu-x', 'ok') },
      { op: 'remove', id: '8888:0' },
    ]);
    const after = store.getSnapshot().nodes;
    expect(after.map((n) => n.id)).toEqual(before.map((n) => n.id)); // unchanged, no throw
    expect(isContiguous(after)).toBe(true);
  });

  test('back-fill PREPENDS: nodes go on the front, first moves back, order preserved', async () => {
    const store = seeded('gen-1', [assistantNode(1000), assistantNode(1100)]);
    expect(store.getSnapshot().first).toBe(1000);
    const backfill = page([assistantNode(800), assistantNode(900)]);
    const { fetch } = fakeFetch(backfill);
    await store.loadEarlier(fetch);
    const snap = store.getSnapshot();
    expect(snap.nodes.map((n) => n.id)).toEqual(['800:0', '900:0', '1000:0', '1100:0']);
    expect(snap.first).toBe(800); // first moved backwards to the back-filled from
    expect(isContiguous(snap.nodes)).toBe(true);
  });

  test('load earlier requests before=<first> and sends orphans=<tool_use_ids> for every orphan_result in the window (D27)', async () => {
    // The window holds one orphan_result (tu-1) and one ordinary node. "Load earlier" must send the
    // orphan's tool_use_id so the server can re-pair it; the returned patch REMOVES the orphan while
    // the paired tool card arrives in `nodes` at the CALL's earlier anchor.
    const store = seeded('gen-1', [orphanNode(1000, 'tu-1'), assistantNode(1100)]);
    const backfill = page(
      [assistantNode(700), toolNode(800, 'tu-1', 'ok'), assistantNode(900)],
      [{ op: 'remove', id: '1000:0' }],
    );
    const { fetch, calls } = fakeFetch(backfill);
    await store.loadEarlier(fetch);
    // the request carried before=first and the orphan's id
    expect(calls).toEqual([{ before: 1000, orphans: ['tu-1'] }]);
    const snap = store.getSnapshot();
    // orphan is GONE; the tool card is present at the earlier call anchor (800:0), not the result's
    expect(snap.nodes.map((n) => n.id)).toEqual(['700:0', '800:0', '900:0', '1100:0']);
    expect(snap.nodes.find((n) => n.id === '1000:0')).toBeUndefined();
    const tool = snap.nodes.find((n) => n.k === 'tool');
    expect(tool?.id).toBe('800:0'); // the tool card's id IS its own call anchor (identity rule §4)
    // no node ended up with an id that is not its own anchor
    for (const n of snap.nodes) expect(n.id).toBe(`${n.at}:${n.i}`);
    expect(isContiguous(snap.nodes)).toBe(true);
  });

  test('an orphan whose call is still further back SURVIVES and is re-sent on the next back-fill (D27)', async () => {
    const store = seeded('gen-1', [orphanNode(1000, 'tu-deep'), assistantNode(1100)]);
    // The back-fill did NOT reach tu-deep's call: no remove patch, orphan stays.
    const first = page([assistantNode(700), assistantNode(900)]);
    const back1 = fakeFetch(first);
    await store.loadEarlier(back1.fetch);
    expect(back1.calls[0]).toEqual({ before: 1000, orphans: ['tu-deep'] });
    const mid = store.getSnapshot();
    expect(mid.nodes.some((n) => n.id === '1000:0')).toBe(true); // orphan survived
    // The NEXT back-fill re-sends the still-unpaired orphan.
    const second = page([assistantNode(500), assistantNode(600)]);
    const back2 = fakeFetch(second);
    await store.loadEarlier(back2.fetch);
    expect(back2.calls[0]).toEqual({ before: 700, orphans: ['tu-deep'] });
    expect(isContiguous(store.getSnapshot().nodes)).toBe(true);
  });

  test('at the 2,000-node cap eviction is from the TAIL and following switches off in the same operation; oldest back-filled node survives', async () => {
    // Fill the window to just under the cap by following.
    const initial: RenderNode[] = [];
    for (let k = 0; k < WINDOW_CAP - 1; k++) initial.push(assistantNode(100000 + k));
    const store = createRowStore();
    store.hello({ generation: 'gen-1', from: initial[0]!.at, to: initial[initial.length - 1]!.at + 100, truncatedBefore: true });
    store.applyRows({ nodes: initial, from: initial[0]!.at, to: initial[initial.length - 1]!.at + 100 });
    expect(store.getSnapshot().nodes.length).toBe(WINDOW_CAP - 1);
    expect(store.getSnapshot().following).toBe(true);

    // Back-fill 5 older nodes: total exceeds the cap by 4, so 4 are evicted from the TAIL and
    // following turns off. The oldest back-filled node (the head) must survive.
    const older = [assistantNode(10), assistantNode(20), assistantNode(30), assistantNode(40), assistantNode(50)];
    const { fetch } = fakeFetch(page(older));
    await store.loadEarlier(fetch);
    const snap = store.getSnapshot();
    expect(snap.nodes.length).toBe(WINDOW_CAP);            // capped
    expect(snap.following).toBe(false);                    // follow switched off in the same op
    expect(snap.nodes[0]!.id).toBe('10:0');                // oldest back-filled node survives (head kept)
    // the four newest tail nodes were the ones evicted
    expect(snap.nodes[snap.nodes.length - 1]!.at).toBe(100000 + (WINDOW_CAP - 1) - 1 - 4);
    expect(isContiguous(snap.nodes)).toBe(true);
  });

  test('while at the cap with follow OFF, an incoming rows frame is COUNTED, NOT APPENDED', async () => {
    const initial: RenderNode[] = [];
    for (let k = 0; k < WINDOW_CAP - 1; k++) initial.push(assistantNode(100000 + k));
    const store = createRowStore();
    store.hello({ generation: 'gen-1', from: initial[0]!.at, to: 0, truncatedBefore: true });
    store.applyRows({ nodes: initial, from: initial[0]!.at, to: initial[initial.length - 1]!.at + 100 });
    const older = [assistantNode(10), assistantNode(20), assistantNode(30), assistantNode(40), assistantNode(50)];
    await store.loadEarlier(fakeFetch(page(older)).fetch);
    expect(store.getSnapshot().following).toBe(false);
    expect(store.getSnapshot().nodes.length).toBe(WINDOW_CAP);
    expect(store.getSnapshot().newBelow).toBe(0);

    // An incoming live frame while at the cap with follow off: counted, node count unchanged.
    store.applyRows({ nodes: [assistantNode(200000), assistantNode(200001)], from: 200000, to: 200101 });
    const snap = store.getSnapshot();
    expect(snap.nodes.length).toBe(WINDOW_CAP);   // NOT appended
    expect(snap.newBelow).toBe(2);                // counter incremented by the two new nodes
    expect(isContiguous(snap.nodes)).toBe(true);
  });

  test('reloadTail (pill click / scroll-to-bottom) refetches with no before, replaces contents, re-enables following, zeroes the counter', async () => {
    // Get into follow-off + newBelow>0.
    const initial: RenderNode[] = [];
    for (let k = 0; k < WINDOW_CAP - 1; k++) initial.push(assistantNode(100000 + k));
    const store = createRowStore();
    store.hello({ generation: 'gen-1', from: initial[0]!.at, to: 0, truncatedBefore: true });
    store.applyRows({ nodes: initial, from: initial[0]!.at, to: 0 });
    await store.loadEarlier(fakeFetch(page([assistantNode(10), assistantNode(20), assistantNode(30), assistantNode(40), assistantNode(50)])).fetch);
    store.applyRows({ nodes: [assistantNode(200000)], from: 200000, to: 200100 });
    expect(store.getSnapshot().newBelow).toBe(1);
    expect(store.getSnapshot().following).toBe(false);

    const tail = page([assistantNode(300000), assistantNode(300100)]);
    const { fetch, calls } = fakeFetch(tail);
    await store.reloadTail(fetch);
    expect(calls).toEqual([{ before: null, orphans: [] }]); // fresh tail fetch, no `before`
    const snap = store.getSnapshot();
    expect(snap.nodes.map((n) => n.id)).toEqual(['300000:0', '300100:0']); // contents replaced
    expect(snap.following).toBe(true); // following re-enabled
    expect(snap.newBelow).toBe(0);     // counter zeroed
    expect(isContiguous(snap.nodes)).toBe(true);
  });

  test('the store CLEARS on reset then applies the following window (§6.1)', () => {
    const store = seeded('gen-1', [assistantNode(1000), assistantNode(1100)]);
    store.reset();
    expect(store.getSnapshot().nodes.length).toBe(0);
    expect(store.getSnapshot().following).toBe(true);
    store.applyRows({ nodes: [assistantNode(5000), assistantNode(5100)], from: 5000, to: 5200 });
    expect(store.getSnapshot().nodes.map((n) => n.id)).toEqual(['5000:0', '5100:0']);
    expect(isContiguous(store.getSnapshot().nodes)).toBe(true);
  });

  test('the store CLEARS when hello carries a DIFFERENT generation, then holds the new snapshot even with the SAME ids (§6.2, D12)', () => {
    // Hold a window under generation A whose ids are 1000:0 and 1100:0.
    const store = seeded('gen-A', [assistantNode(1000), assistantNode(1100)]);
    // A reconnect delivers generation B with the SAME ids but DIFFERENT content — a merge would keep
    // the stale A content; the store must end holding B's nodes.
    const bNodes = [
      { ...assistantNode(1000), body: [{ t: 'text' as const, v: 'FROM-B' }] },
      { ...assistantNode(1100), body: [{ t: 'text' as const, v: 'FROM-B' }] },
    ];
    store.hello({ generation: 'gen-B', from: 1000, to: 1200, truncatedBefore: false });
    store.applyRows({ nodes: bNodes, from: 1000, to: 1200 });
    const snap = store.getSnapshot();
    expect(snap.nodes.length).toBe(2); // NOT 4 — the overlap was not merged onto stale content
    expect((snap.nodes[0] as { body: Array<{ v: string }> }).body[0]!.v).toBe('FROM-B');
    expect(snap.generation).toBe('gen-B');
    expect(isContiguous(snap.nodes)).toBe(true);
  });

  test('orphanToolUseIds returns the tool_use_id of every orphan_result node, in order', () => {
    const nodes = [orphanNode(100, 'a'), assistantNode(200), orphanNode(300, 'b')];
    expect(orphanToolUseIds(nodes)).toEqual(['a', 'b']);
  });

  test('isContiguous rejects a duplicate id and an out-of-order pair', () => {
    expect(isContiguous([assistantNode(100), assistantNode(200)])).toBe(true);
    expect(isContiguous([assistantNode(100), assistantNode(100)])).toBe(false); // duplicate id
    expect(isContiguous([assistantNode(200), assistantNode(100)])).toBe(false); // out of file order
  });

  test('subscribe fires on mutation and unsubscribes cleanly', () => {
    const store = createRowStore();
    let fired = 0;
    const unsub = store.subscribe(() => { fired++; });
    store.hello({ generation: 'g', from: 0, to: 0, truncatedBefore: false });
    store.applyRows({ nodes: [assistantNode(1)], from: 1, to: 2 });
    expect(fired).toBeGreaterThan(0);
    const at = fired;
    unsub();
    store.applyRows({ nodes: [assistantNode(3)], from: 3, to: 4 });
    expect(fired).toBe(at);
  });
});
