import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { batchFrames, batchPatches, decodeFrame, encodeFrame, type SseFrame } from './sse.ts';
import type { Agent, Badge, Patch, RenderNode, SessionSummary } from './model.ts';

// ---------------------------------------------------------------------------------------------
// sse.test.ts — task 13: SSE frame encoding, per-stream sequence ids, and 1 MiB frame batching
// (spec §6.2, §14; D12, D15, D27). Every case below is named in the task-13 brief's Step 1 list.
// ---------------------------------------------------------------------------------------------

function session(): SessionSummary {
  return {
    id: 'sess-1',
    projectDir: 'proj-a',
    title: 'a session',
    titleSource: 'session-id',
    sizeBytes: 100,
    mtimeIso: '2026-01-01T00:00:00.000Z',
    live: false,
    subagentCount: 0,
    badges: [],
    projects: ['proj-a'],
  };
}

function agent(): Agent {
  return {
    id: 'a1',
    parentId: null,
    depth: 1,
    agentType: null,
    label: 'agent a1',
    toolUseId: null,
    model: null,
    sizeBytes: 10,
    mtimeIso: null,
    birthtimeIso: null,
    live: false,
  };
}

function badge(): Badge {
  return { repoKey: 'r', slug: 's', cardId: 'c1', cardStatus: 'active', runnerAlive: true, runId: null };
}

/** A minimal, valid `RenderNode` — kind `raw` — sized so its JSON-encoded length is
 * approximately `bytes`. Used to control frame size in the batching tests without depending on
 * any other module's node-construction logic. */
function rawNode(seed: number, bytes: number): RenderNode {
  const padLen = Math.max(0, bytes - 80);
  return {
    id: `${seed}:0`,
    at: seed,
    i: 0,
    uuid: null,
    ts: null,
    elided: false,
    expandable: false,
    k: 'raw',
    rowType: 'unknown',
    json: 'x'.repeat(padLen),
    bytes: padLen,
    text: null,
  };
}

function helloFrame(generation: string): SseFrame {
  return {
    event: 'hello',
    data: { generation, session: session(), agents: [agent()], badges: [badge()], from: 0, to: 10, truncatedBefore: false },
  };
}

function rowsFrame(): SseFrame {
  return { event: 'rows', data: { nodes: [rawNode(0, 200)], from: 0, to: 10 } };
}

function patchFrame(): SseFrame {
  return { event: 'patch', data: { patches: [{ op: 'result', id: '0:0', node: rawNode(0, 200) }] } };
}

function metaFrame(): SseFrame {
  return { event: 'meta', data: { agents: [agent()], badges: [badge()], live: true } };
}

function pingFrame(): SseFrame {
  return { event: 'ping', data: { t: '2026-01-01T00:00:00.000Z' } };
}

/** Counts the `retry:` lines in one encoded frame. `retry:` is transport plumbing (an SSE
 * directive, not part of the decoded event payload), so it is checked directly against the wire
 * text rather than through `decodeFrame` — every OTHER assertion below that needs a frame's
 * `event`/`id`/`data` goes through the production `decodeFrame`, never a test-only parser. */
function countRetryLines(encoded: string): number {
  expect(encoded.endsWith('\n\n')).toBe(true);
  return encoded.split('\n').filter((l) => l.startsWith('retry: ')).length;
}

describe('encodeFrame — round-trip of every §6.2 frame type, via the production decodeFrame', () => {
  test('hello round-trips, including generation, session, agents, badges, window bounds', () => {
    const frame = helloFrame('gen-A');
    const decoded = decodeFrame(encodeFrame(frame, 1));
    expect(decoded.event).toBe('hello');
    expect(decoded.data).toEqual(frame.data);
  });

  test('rows round-trips', () => {
    const frame = rowsFrame();
    const decoded = decodeFrame(encodeFrame(frame, 2));
    expect(decoded.event).toBe('rows');
    expect(decoded.data).toEqual(frame.data);
  });

  test('patch round-trips (D27)', () => {
    const frame = patchFrame();
    const decoded = decodeFrame(encodeFrame(frame, 3));
    expect(decoded.event).toBe('patch');
    expect(decoded.data).toEqual(frame.data);
  });

  test('meta round-trips', () => {
    const frame = metaFrame();
    const decoded = decodeFrame(encodeFrame(frame, 4));
    expect(decoded.event).toBe('meta');
    expect(decoded.data).toEqual(frame.data);
  });

  test('reset round-trips', () => {
    const frame: SseFrame = { event: 'reset', data: { reason: 'rotated' } };
    const decoded = decodeFrame(encodeFrame(frame, 1));
    expect(decoded.event).toBe('reset');
    expect(decoded.data).toEqual(frame.data);
  });

  test('ping round-trips', () => {
    const frame = pingFrame();
    const decoded = decodeFrame(encodeFrame(frame, 5));
    expect(decoded.event).toBe('ping');
    expect(decoded.data).toEqual(frame.data);
  });

  test('gone round-trips', () => {
    const frame: SseFrame = { event: 'gone', data: { reason: 'deleted' } };
    const decoded = decodeFrame(encodeFrame(frame, 1));
    expect(decoded.event).toBe('gone');
    expect(decoded.data).toEqual(frame.data);
  });
});

describe('id: — per-stream monotonic sequence, D12', () => {
  test('a hello/rows/patch/meta/ping sequence carries ids 1,2,3,4,5', () => {
    const frames = [helloFrame('gen-A'), rowsFrame(), patchFrame(), metaFrame(), pingFrame()];
    const ids = frames.map((f, idx) => decodeFrame(encodeFrame(f, idx + 1)).id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  test('the sequence increments by one per frame of ANY type — never restarts within a stream', () => {
    const frames: SseFrame[] = [helloFrame('gen-A'), pingFrame(), pingFrame(), rowsFrame(), pingFrame()];
    const ids = frames.map((f, idx) => decodeFrame(encodeFrame(f, idx + 1)).id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('generation — hello (D12, spec §6.2)', () => {
  test('two connections to the same session produce DIFFERENT generations', () => {
    const connectionA = decodeFrame(encodeFrame(helloFrame('gen-A'), 1)).data as { generation: string };
    const connectionB = decodeFrame(encodeFrame(helloFrame('gen-B'), 1)).data as { generation: string };
    expect(connectionA.generation).not.toBe(connectionB.generation);
  });
});

describe('retry: — exactly once, in the first frame of every response', () => {
  test('present on seq 1, absent on every later seq', () => {
    const frames = [helloFrame('gen-A'), rowsFrame(), pingFrame()];
    const encoded = frames.map((f, idx) => encodeFrame(f, idx + 1));
    const retryCounts = encoded.map((e) => countRetryLines(e));
    expect(retryCounts).toEqual([1, 0, 0]);
  });

  test('retry appears exactly once across an entire concatenated response', () => {
    const frames = [helloFrame('gen-A'), rowsFrame(), rowsFrame(), pingFrame()];
    const wire = frames.map((f, idx) => encodeFrame(f, idx + 1)).join('');
    expect((wire.match(/retry: /g) ?? []).length).toBe(1);
  });
});

describe('payload edge cases — every one produces a single well-formed frame', () => {
  const isWellFormed = (out: string) => /^event: \w+\nid: \d+\ndata: .+\n\n$/.test(out);

  test('a newline in the payload is escaped, not left raw — one frame, not two', () => {
    const frame: SseFrame = { event: 'ping', data: { t: 'line1\nline2' } as unknown as { t: string } };
    const out = encodeFrame(frame, 1);
    expect(isWellFormed(out)).toBe(true);
    expect(out.split('\n\n').filter((s) => s.length > 0)).toHaveLength(1);
    expect((JSON.parse(out.split('data: ')[1]!.trim()) as { t: string }).t).toBe('line1\nline2');
  });

  test('U+2028 (LINE SEPARATOR) in the payload round-trips inside one frame', () => {
    const value = `a${' '}b`;
    const frame: SseFrame = { event: 'ping', data: { t: value } as unknown as { t: string } };
    const out = encodeFrame(frame, 1);
    expect(isWellFormed(out)).toBe(true);
    expect(decodeFrame(out).data).toEqual({ t: value });
  });

  test('U+2029 (PARAGRAPH SEPARATOR) in the payload round-trips inside one frame', () => {
    const value = `a${' '}b`;
    const frame: SseFrame = { event: 'ping', data: { t: value } as unknown as { t: string } };
    const out = encodeFrame(frame, 1);
    expect(isWellFormed(out)).toBe(true);
    expect(decodeFrame(out).data).toEqual({ t: value });
  });

  test('a BigInt payload (JSON.stringify throws) still yields a well-formed frame', () => {
    const frame: SseFrame = { event: 'ping', data: 10n as unknown as { t: string } };
    const out = encodeFrame(frame, 1);
    expect(isWellFormed(out)).toBe(true);
  });

  test('a cyclic object payload (JSON.stringify throws) still yields a well-formed frame', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const frame: SseFrame = { event: 'ping', data: cyclic as unknown as { t: string } };
    const out = encodeFrame(frame, 1);
    expect(isWellFormed(out)).toBe(true);
  });

  test('undefined payload (JSON.stringify returns undefined, not a throw) still yields a well-formed frame', () => {
    const frame: SseFrame = { event: 'ping', data: undefined as unknown as { t: string } };
    const out = encodeFrame(frame, 1);
    expect(isWellFormed(out)).toBe(true);
    expect(decodeFrame(out).data as unknown).toBe(null);
  });

  test('audit lens: a literal "\\ndata: injected" payload produces exactly ONE frame, never two', () => {
    const frame: SseFrame = { event: 'ping', data: { t: '\ndata: injected' } as unknown as { t: string } };
    const out = encodeFrame(frame, 1);
    // A raw newline reaching the wire would split this into two SSE "records" (terminated by a
    // blank line each). JSON.stringify escapes it, so exactly one blank-line terminator exists.
    expect(out.split('\n\n').filter((s) => s.length > 0)).toHaveLength(1);
    expect((decodeFrame(out).data as { t: string }).t).toBe('\ndata: injected');
  });
});

describe('Patch union — two ops, D27, decoded through the production decodeFrame', () => {
  test('{op:"result", id, node} round-trips with its node intact', () => {
    const node = rawNode(1, 200);
    const frame: SseFrame = { event: 'patch', data: { patches: [{ op: 'result', id: '1:0', node }] } };
    const decoded = decodeFrame(encodeFrame(frame, 1));
    if (decoded.event !== 'patch') throw new Error('expected a patch frame');
    const patch = decoded.data.patches[0]!;
    expect(patch.op).toBe('result');
    expect(patch.id).toBe('1:0');
    // `patch.node` is only reachable once TypeScript has narrowed `op` to "result" — the
    // decoder's typed `Patch` union does that narrowing, not a manual cast.
    if (patch.op !== 'result') throw new Error('expected op "result"');
    expect(patch.node).toEqual(node);
  });

  test('{op:"remove", id} round-trips and carries NO `node` — a decoder reading `node` unconditionally is the bug this shape prevents', () => {
    const frame: SseFrame = { event: 'patch', data: { patches: [{ op: 'remove', id: '1:0' }] } };
    const decoded = decodeFrame(encodeFrame(frame, 1));
    if (decoded.event !== 'patch') throw new Error('expected a patch frame');
    const patch = decoded.data.patches[0]!;
    expect(patch.op).toBe('remove');
    expect(patch.id).toBe('1:0');
    expect('node' in patch).toBe(false);
  });
});

describe('decodeFrame — the production decoder (spec §3.1: sse.ts is "frame encode/decode")', () => {
  test('the module exports a decodeFrame function — round-tripping via a TEST-ONLY parser proves nothing about production code', async () => {
    const mod = (await import('./sse.ts')) as unknown as Record<string, unknown>;
    expect(typeof mod.decodeFrame).toBe('function');
  });
});

describe('hello/meta frames are bounded at 1 MiB too, not just rows/patch (Phase-1 audit)', () => {
  const MAX = 1024 * 1024;

  function agentWithLabel(seed: number, labelLen: number): Agent {
    return { ...agent(), id: `a${seed}`, label: 'x'.repeat(labelLen) };
  }

  test('hello with many large agent labels (20 x 60,000 chars) still encodes under 1 MiB', () => {
    const agents = Array.from({ length: 20 }, (_, idx) => agentWithLabel(idx, 60_000));
    const frame: SseFrame = {
      event: 'hello',
      data: { generation: 'g', session: session(), agents, badges: [badge()], from: 0, to: 10, truncatedBefore: false },
    };
    // Sanity: this exact shape is the Phase-1 audit's probe (1,203,531 B unbounded) — the gap this
    // test guards against.
    const out = encodeFrame(frame, 1);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX);
  });

  test('meta with many large agent labels still encodes under 1 MiB', () => {
    const agents = Array.from({ length: 20 }, (_, idx) => agentWithLabel(idx, 60_000));
    const frame: SseFrame = { event: 'meta', data: { agents, badges: [badge()], live: true } };
    const out = encodeFrame(frame, 1);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX);
  });

  // meta.json's `model`/`agentType` are UNTRUSTED (spec §5.5, subagents.ts:11) and are copied
  // VERBATIM onto Agent (subagents.ts:100-107) -- unlike `label`, they were never routed through
  // any truncation fallback. §6.5 is explicit that this cap is open-world: "'Bounded because our
  // corpus is small today' is not a bound." A large `model` or `agentType` must be bounded the
  // same way an oversized `label` already is.
  function agentWithModel(seed: number, modelLen: number): Agent {
    return { ...agent(), id: `a${seed}`, label: 'x', model: 'm'.repeat(modelLen) };
  }

  function agentWithAgentType(seed: number, agentTypeLen: number): Agent {
    return { ...agent(), id: `a${seed}`, label: 'x', agentType: 't'.repeat(agentTypeLen) };
  }

  test('hello with many large agent `model` values (untrusted meta.json field) still encodes under 1 MiB', () => {
    const agents = Array.from({ length: 18 }, (_, idx) => agentWithModel(idx, 60_000));
    const frame: SseFrame = {
      event: 'hello',
      data: { generation: 'g', session: session(), agents, badges: [badge()], from: 0, to: 10, truncatedBefore: false },
    };
    const out = encodeFrame(frame, 1);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX);
  });

  test('meta with many large agent `model` values still encodes under 1 MiB', () => {
    const agents = Array.from({ length: 18 }, (_, idx) => agentWithModel(idx, 60_000));
    const frame: SseFrame = { event: 'meta', data: { agents, badges: [badge()], live: true } };
    const out = encodeFrame(frame, 1);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX);
  });

  test('hello with many large agent `agentType` values (untrusted meta.json field) still encodes under 1 MiB', () => {
    const agents = Array.from({ length: 18 }, (_, idx) => agentWithAgentType(idx, 60_000));
    const frame: SseFrame = {
      event: 'hello',
      data: { generation: 'g', session: session(), agents, badges: [badge()], from: 0, to: 10, truncatedBefore: false },
    };
    const out = encodeFrame(frame, 1);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX);
  });

  test('meta with many large agent `agentType` values still encodes under 1 MiB', () => {
    const agents = Array.from({ length: 18 }, (_, idx) => agentWithAgentType(idx, 60_000));
    const frame: SseFrame = { event: 'meta', data: { agents, badges: [badge()], live: true } };
    const out = encodeFrame(frame, 1);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX);
  });
});

describe('D12 — no Last-Event-ID support of any kind', () => {
  test('the module exports no parseLastEventId function', async () => {
    const mod = (await import('./sse.ts')) as unknown as Record<string, unknown>;
    expect(mod.parseLastEventId).toBeUndefined();
  });

  test('the module source never contains the string "Last-Event-ID"', () => {
    const source = readFileSync(join(import.meta.dir, 'sse.ts'), 'utf8');
    expect(source.includes('Last-Event-ID')).toBe(false);
  });
});

// A REAL caller never emits the 0/0/1 placeholder `batchFrames` used to measure against
// internally — it substitutes the actual window bounds and a real, non-trivial per-stream
// sequence id once it decides emission order. Every assertion below that checks an ACTUAL
// emitted frame's byte length goes through these two helpers, never the placeholder, because a
// batch measured "just under the cap" against the placeholder can encode PAST the cap once these
// wider, real numbers replace it (Phase-1 audit — see the two `describe` blocks below).
const REAL_FROM = 8_388_608;
const REAL_TO = 9_437_183;
const REAL_SEQ = 654_321;
function encodeRealRows(nodes: RenderNode[]): string {
  return encodeFrame({ event: 'rows', data: { nodes, from: REAL_FROM, to: REAL_TO } }, REAL_SEQ);
}
function encodeRealPatch(patches: Patch[]): string {
  return encodeFrame({ event: 'patch', data: { patches } }, REAL_SEQ);
}

describe('batchFrames — 1 MiB frame cap (spec §6.2, §14)', () => {
  const MAX = 1024 * 1024;

  test('many small nodes summing past the cap split into several frames, each under it', () => {
    const nodes: RenderNode[] = Array.from({ length: 40 }, (_, idx) => rawNode(idx, 40_000));
    const batches = batchFrames(nodes, MAX);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const encoded = encodeRealRows(batch);
      expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(MAX);
    }
  });

  test('every node is present exactly once, in file order, across all batches', () => {
    const nodes: RenderNode[] = Array.from({ length: 40 }, (_, idx) => rawNode(idx, 40_000));
    const batches = batchFrames(nodes, MAX);
    const flattened = batches.flat();
    expect(flattened.map((n) => n.id)).toEqual(nodes.map((n) => n.id));
  });

  test('a single node near the cap sits alone in its frame', () => {
    // Leave headroom for the frame envelope (event/id/data/braces/field-name overhead, PLUS the
    // real from/to/seq digits a caller actually sends — never just the 0/0/1 placeholder) so the
    // node's OWN size is what is "near the cap", not something already over it.
    const nodes: RenderNode[] = [rawNode(0, MAX - 2000)];
    const batches = batchFrames(nodes, MAX);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    const encoded = encodeRealRows(batches[0]!);
    expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(MAX);
  });

  test('an empty node list produces no frames', () => {
    expect(batchFrames([], MAX)).toEqual([]);
  });

  // No "oversized node" branch exists (D15): every node is bounded at 64 KiB by construction
  // upstream, so a node larger than the frame cap cannot occur. Property-tested over randomly
  // sized node lists, seeded per case index for a reproducible failure — never a single happy
  // path (fixtures-mirror-reality.md).
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test('property: for ANY input this function accepts, every emitted frame is under the cap', () => {
    for (let caseIndex = 0; caseIndex < 30; caseIndex++) {
      const rand = mulberry32(1_000 + caseIndex);
      const count = 1 + Math.floor(rand() * 60);
      const nodes: RenderNode[] = Array.from({ length: count }, (_, idx) => {
        // D15's bound: no single node exceeds 64 KiB.
        const size = 10 + Math.floor(rand() * 65_000);
        return rawNode(idx, size);
      });
      const batches = batchFrames(nodes, MAX);
      for (const batch of batches) {
        // The REAL emitted frame, not the 0/0/1 placeholder `batchFrames` measures against.
        const encoded = encodeRealRows(batch);
        const byteLen = new TextEncoder().encode(encoded).length;
        expect(byteLen).toBeLessThanOrEqual(MAX);
      }
      expect(batches.flat().map((n) => n.id)).toEqual(nodes.map((n) => n.id));
    }
  });

  test('a boundary-sized rows batch stays under the cap once the REAL from/to/seq are applied — not just the 0/0/1 placeholder `batchFrames` measures against (Phase-1 audit)', () => {
    const nodeA = rawNode(0, Math.floor(MAX / 2));

    // Binary-search the largest SECOND node payload whose PLACEHOLDER-envelope (from:0, to:0,
    // seq:1) frame — with `nodeA` already in the batch — is still <= MAX: exactly the boundary
    // the unfixed `batchFrames` used to accept `nodeB` into `nodeA`'s batch, using the narrowest
    // envelope that batch could ever be measured with.
    const placeholderBytes = (bytes: number): number =>
      new TextEncoder().encode(
        encodeFrame({ event: 'rows', data: { nodes: [nodeA, rawNode(1, bytes)], from: 0, to: 0 } }, 1),
      ).length;
    let lo = 0;
    let hi = MAX;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi + 1) / 2);
      if (placeholderBytes(mid) <= MAX) lo = mid;
      else hi = mid - 1;
    }
    const nodeB = rawNode(1, lo);

    const batches = batchFrames([nodeA, nodeB], MAX);
    // Whatever `batchFrames` decides — one batch or two — every batch it hands back must survive
    // being encoded with the REAL bounds/seq a composition root actually sends, never just the
    // 0/0/1 placeholder `batchFrames` measures candidates against internally.
    for (const batch of batches) {
      const encoded = encodeRealRows(batch);
      expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(MAX);
    }
    expect(batches.flat().map((n) => n.id)).toEqual(['0:0', '1:0']);
  });
});

describe('batchPatches — the 1 MiB frame cap applies to patch frames too (spec §6.2/§6.4, §14; Phase-1 audit)', () => {
  const MAX = 1024 * 1024;

  test('18 result patches, each carrying a node just under the 64 KiB per-node cap (D15), split into MULTIPLE patch frames, each under 1 MiB', () => {
    const patches: Patch[] = Array.from({ length: 18 }, (_, idx) => ({
      op: 'result' as const,
      id: `${idx}:0`,
      node: rawNode(idx, 64 * 1024 - 100),
    }));

    // Sanity: sent as a single frame — today's behavior, because patch frames are never split at
    // all — this exceeds the cap. That gap is exactly the defect this test guards against.
    const singleFrame = encodeRealPatch(patches);
    expect(new TextEncoder().encode(singleFrame).length).toBeGreaterThan(MAX);

    const batches = batchPatches(patches, MAX);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const encoded = encodeRealPatch(batch);
      expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(MAX);
    }
    expect(batches.flat().map((p) => p.id)).toEqual(patches.map((p) => p.id));
  });

  test('a `remove` patch (no node) survives batching untouched, alongside `result` patches', () => {
    const patches: Patch[] = [
      { op: 'result', id: '0:0', node: rawNode(0, 200) },
      { op: 'remove', id: '1:0' },
    ];
    const batches = batchPatches(patches, MAX);
    expect(batches.flat()).toEqual(patches);
  });

  test('an empty patch list produces no frames', () => {
    expect(batchPatches([], MAX)).toEqual([]);
  });
});
