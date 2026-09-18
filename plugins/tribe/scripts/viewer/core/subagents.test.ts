import { expect, test } from 'bun:test';
import { deriveAgents } from './subagents.ts';

const nowIso = '2026-09-02T10:00:05.000Z';
const base = { nowIso };

// spec §5.5: 453 of 813 measured `.meta.json` sidecars carry no `parentAgentId` at all -- the
// common case, and absence means "hangs off the session", never an error. In the `Agent[]`
// contract that is `parentId: null` (spec §4): "from .meta.json parentAgentId, when it resolves
// in the same batch" -- there is no session node in this model to point at instead.
test('a sidecar with no parentAgentId gets parentId null (453/813 measured, the common case)', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      {
        agentId: 'a1',
        meta: { agentType: 'tribe:hunter', description: 'Implement T20', toolUseId: 'toolu_9', spawnDepth: 1, model: 'claude-sonnet-5' },
        sizeBytes: 4,
        mtimeIso: '2026-09-02T10:00:04.000Z',
        birthtimeIso: '2026-09-02T10:00:01.000Z',
        previousSizeBytes: null,
      },
    ],
  });
  expect(agents).toHaveLength(1);
  expect(agents[0]!.id).toBe('a1');
  expect(agents[0]!.parentId).toBeNull();
  expect(agents[0]!.agentType).toBe('tribe:hunter');
  expect(agents[0]!.label).toBe('Implement T20');
  expect(agents[0]!.depth).toBe(1);
  expect(agents[0]!.model).toBe('claude-sonnet-5');
});

test('a deeper agent hangs off its parentAgentId, not off null', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'w1', meta: { agentType: 'warchief', spawnDepth: 1 }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
      { agentId: 'h1', meta: { agentType: 'hunter', parentAgentId: 'w1', spawnDepth: 2 }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
    ],
  });
  const deep = agents.find((a) => a.id === 'h1')!;
  expect(deep.parentId).toBe('w1');
  expect(deep.depth).toBe(2);
});

// Replaces the old `processes.test.ts` "an unreadable sidecar still yields a visible entry"
// case with the exact shape this task adds: a sidecar whose `.meta.json` is missing entirely
// (`meta: null`) never drops the entry -- it degrades to nulls and a generic label.
test('a sidecar whose .meta.json is missing entirely still yields an agent', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'x9', meta: null, sizeBytes: 3, mtimeIso: nowIso, birthtimeIso: null, previousSizeBytes: null },
    ],
  });
  expect(agents).toHaveLength(1);
  expect(agents[0]!.agentType).toBeNull();
  expect(agents[0]!.label).toBe('agent x9');
  expect(agents[0]!.toolUseId).toBeNull();
  expect(agents[0]!.model).toBeNull();
  expect(agents[0]!.depth).toBe(1);
  expect(agents[0]!.parentId).toBeNull();
});

// F34: a subagent naming a parentAgentId that is not present in the SAME batch -- the ordinary
// race of discovering a child before its parent -- gets parentId null instead of a dangling id.
test('F34: an orphaned parentAgentId resolves to parentId null', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'orphan', meta: { agentType: 'x', parentAgentId: 'ghost', spawnDepth: 2 }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
    ],
  });
  const orphan = agents.find((a) => a.id === 'orphan')!;
  expect(orphan.parentId).toBeNull();
});

// F34: a sidecar naming itself as its own parent (a 1-node cycle) must not produce a
// self-referential parentId.
test('F34: a self-referential parentAgentId resolves to parentId null', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'a1', meta: { agentType: 'x', parentAgentId: 'a1', spawnDepth: 1 }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
    ],
  });
  const a1 = agents.find((a) => a.id === 'a1')!;
  expect(a1.parentId).not.toBe(a1.id);
  expect(a1.parentId).toBeNull();
});

// F36: two sidecars naming each other as parent both pass the knownAgentIds check individually
// and form a 2-node cycle that is unreachable from the root -- a consumer walking parent
// pointers infinite-loops, and one building a tree from the root silently drops both nodes.
// Both must resolve to parentId null instead, same as the 1-node self-cycle case above.
test('F36: a mutual 2-node parentAgentId cycle resolves both nodes to parentId null', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'a1', meta: { agentType: 'x', parentAgentId: 'b1', spawnDepth: 2 }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
      { agentId: 'b1', meta: { agentType: 'x', parentAgentId: 'a1', spawnDepth: 2 }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
    ],
  });
  const a1 = agents.find((a) => a.id === 'a1')!;
  const b1 = agents.find((a) => a.id === 'b1')!;
  expect(a1.parentId).toBeNull();
  expect(b1.parentId).toBeNull();
});

// spec §5.5: "Order: by birthtimeIso, then agentId." Fed out of order and with a tie, on
// purpose -- a sort that happened to match input order would pass a same-order fixture for the
// wrong reason.
test('agents are ordered by birthtimeIso, then agentId on a tie', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'b', meta: null, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: '2026-09-02T09:00:02.000Z', previousSizeBytes: null },
      { agentId: 'z', meta: null, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: '2026-09-02T09:00:01.000Z', previousSizeBytes: null },
      { agentId: 'a', meta: null, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: '2026-09-02T09:00:01.000Z', previousSizeBytes: null },
    ],
  });
  expect(agents.map((a) => a.id)).toEqual(['a', 'z', 'b']);
});

// spec §5.5: measured 811 of 813 `.meta.json` sidecars carry `toolUseId`; the other 2 do not,
// and absence is not an error -- it is `toolUseId: null`, never a missing field or a throw.
test('toolUseId is carried when present and null when absent (811/813 measured)', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'has', meta: { toolUseId: 'toolu_1' }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
      { agentId: 'none', meta: { agentType: 'x' }, sizeBytes: 1, mtimeIso: nowIso, birthtimeIso: nowIso, previousSizeBytes: null },
    ],
  });
  expect(agents.find((a) => a.id === 'has')!.toolUseId).toBe('toolu_1');
  expect(agents.find((a) => a.id === 'none')!.toolUseId).toBeNull();
});

// The `live` field is real, not a stub: it must go through the wiring, not be hardcoded. Reuses
// `core/liveness.ts#isLive` (D2), whose own rule table is proven in `liveness.test.ts` -- this
// only proves `subagents.ts` actually calls it with the entry's own mtime, and that a missing
// mtime (no stat at all) degrades to not-live rather than throwing.
test('live is derived from mtime recency, and a missing mtime is never live', () => {
  const agents = deriveAgents({
    ...base,
    subagents: [
      { agentId: 'recent', meta: null, sizeBytes: 1, mtimeIso: '2026-09-02T10:00:04.000Z', birthtimeIso: null, previousSizeBytes: null },
      { agentId: 'stale', meta: null, sizeBytes: 1, mtimeIso: '2026-09-02T09:00:00.000Z', birthtimeIso: null, previousSizeBytes: null },
      { agentId: 'gone', meta: null, sizeBytes: 0, mtimeIso: null, birthtimeIso: null, previousSizeBytes: null },
    ],
  });
  expect(agents.find((a) => a.id === 'recent')!.live).toBe(true);
  expect(agents.find((a) => a.id === 'stale')!.live).toBe(false);
  expect(agents.find((a) => a.id === 'gone')!.live).toBe(false);
});
