/**
 * core/pair.ts — tool pairing, orphans, and the cross-tick patch (spec §6.4, §6.5, §7.5; D19, D21,
 * D27, D28). This module is the SECOND stage of the pipeline, run AFTER `core/normalize.ts`:
 * `normalize()` still emits the PRE-PAIRING candidates (unchanged from task 8) — a `tool_use` block
 * always becomes a `tool` node in `state: 'pending'`, and a `tool_result` block always becomes an
 * `orphan_result` node (spec §7.5: never a drop). `pair()` walks that candidate list and resolves
 * each `orphan_result` candidate against a bounded pending map, exactly as spec §7.5 describes:
 *
 *   - Its id IS in the map → the call is already known (this pass, or a PRIOR call to `pair()` —
 *     the map is carried in `PairState`, spec §6.4 point 1). The candidate produces NO node; it
 *     produces a `{op:'result'}` Patch (§4/§6.4) whose `id` is the call's own `RowAnchor.id` and
 *     whose `node` is the COMPLETE replacement `tool` node (`state`, `result`, `resultAnchor` set).
 *     This is uniform across "historical" (one big call, e.g. the initial window) and "live"
 *     (separate calls, one per SSE tick) — the map does not know or care which; that is exactly
 *     what makes it a single implementation for both (§6.4's closing point).
 *   - Its id is NOT in the map (the call is before the window, or its entry was evicted) → the
 *     candidate survives unchanged as an `orphan_result` node — never dropped (B1's other half).
 *
 * PURE core (`pure-core.md`): no filesystem, no clock, no network. `PairState` is the ONLY thing
 * carried across calls, and it is exactly what spec §6.5 bounds: a `Map<tool_use_id, …>` capped at
 * 512 entries, oldest evicted first — "nothing else is retained; nodes are NOT buffered
 * server-side" (§6.5). The map's VALUE carries just enough of the call's own fields (name, input,
 * agentId, its own anchors) to reconstruct the complete replacement node later WITHOUT re-reading
 * anything — there is nothing else to re-read from (no I/O in this module at all).
 *
 * Single forward pass, one bounded map, no backward scan, no second pass (spec §7.5, plan Task 9
 * step 2).
 */
import type { Anchor, Patch, RenderNode } from './model.ts';
import { NODE_CAP, utf8Bytes } from './normalize.ts';

/** spec §6.5 — the pending tool map's bound. Past it, the OLDEST entry is evicted; its eventual
 * result renders as an `orphan_result` rather than growing the map without limit. */
const PENDING_CAP = 512;

/** Exactly the fields needed to rebuild the COMPLETE replacement `tool` node once its result
 * arrives — a prior call's `nodes` are not retained anywhere (§6.5), so this map's values are the
 * only memory of the call across ticks. `elided` is the CALL's own input-elision flag (D15),
 * carried so the completed node's outer `Sized` can OR it with the result's own elision (D19: both
 * halves can be elided independently; the outer flag is true when EITHER is). */
interface PendingCall {
  rowAnchorId: string;
  at: number;
  i: number;
  uuid: string | null;
  ts: string | null;
  name: string;
  input: unknown;
  toolUseId: string;
  agentId: string | null;
  call: Anchor;
  elided: boolean;
}

/** The stream's normalize state (spec §6.4 point 1, §6.5): a bounded pending map, carried across
 * ticks by the caller. `createPairState()` is the only constructor — callers never build the map
 * shape themselves, so the bound lives in exactly one place. */
export interface PairState {
  pending: Map<string, PendingCall>;
}

export function createPairState(): PairState {
  return { pending: new Map() };
}

export interface PairResult {
  /** Genuinely new/surviving nodes for this call — `tool` (still pending or newly seen),
   * `orphan_result` (unpaired), and everything pairing does not touch, unchanged. A successfully
   * paired `tool_result` candidate contributes NOTHING here — its outcome is a Patch (D21: this is
   * exactly why the post-pairing count can be LOWER than the pre-pairing candidate count). */
  nodes: RenderNode[];
  /** `{op:'result'}` patches for every candidate that found its call in the pending map — spec
   * §6.4's live case and §7.5's "historical is one pass, the same map either way" case are the
   * SAME code path here; only the caller decides whether to apply a patch immediately (an initial
   * window build) or send it over the wire (a live tick, §6.4 point 3). */
  patches: Patch[];
}

/**
 * Runs the candidate list (spec-ordered, exactly as `normalize()` emitted it) through the pending
 * map, resolving pairs and evicting the oldest entry past `PENDING_CAP`.
 *
 * `taskAgentIds` (spec §7.5's closing paragraph): a `Task` tool_use whose `id` is a key here gets
 * `agentId` set to the mapped value. This is a pure INPUT the caller supplies (`pure-core.md`) —
 * subagent discovery (task 11) is what builds the map; this module never looks anything up itself.
 */
export function pair(
  candidates: RenderNode[],
  state: PairState,
  taskAgentIds: ReadonlyMap<string, string> = new Map(),
): PairResult {
  const nodes: RenderNode[] = [];
  const patches: Patch[] = [];

  for (const candidate of candidates) {
    if (candidate.k === 'tool') {
      const node = withAgentId(candidate, taskAgentIds);
      nodes.push(node);
      if (node.toolUseId !== null) {
        state.pending.set(node.toolUseId, {
          rowAnchorId: node.id,
          at: node.at,
          i: node.i,
          uuid: node.uuid,
          ts: node.ts,
          name: node.name,
          input: node.input,
          toolUseId: node.toolUseId,
          agentId: node.agentId,
          call: node.call,
          elided: node.elided,
        });
        evictOldest(state.pending);
      }
      continue;
    }

    if (candidate.k === 'orphan_result') {
      const pending = state.pending.get(candidate.toolUseId);
      if (pending === undefined) {
        // Not in the map: the call is before the window, or its entry was evicted. Never dropped
        // (spec §7.5) — the candidate survives exactly as `normalize()` built it.
        nodes.push(candidate);
      } else {
        state.pending.delete(candidate.toolUseId);
        patches.push({ op: 'result', id: pending.rowAnchorId, node: buildCompletedTool(pending, candidate) });
      }
      continue;
    }

    nodes.push(candidate);
  }

  return { nodes, patches };
}

/** spec §7.5's closing paragraph: a `Task` call whose id matches a sidecar's `toolUseId` renders
 * with `agentId` set. `taskAgentIds` is keyed by the CALL's own `toolUseId`. */
function withAgentId(node: Extract<RenderNode, { k: 'tool' }>, taskAgentIds: ReadonlyMap<string, string>): Extract<RenderNode, { k: 'tool' }> {
  if (node.name !== 'Task' || node.toolUseId === null) return node;
  const agentId = taskAgentIds.get(node.toolUseId);
  if (agentId === undefined) return node;
  return { ...node, agentId };
}

/** spec §6.5 — evict the OLDEST entry (Map iteration order is insertion order in JS, which is
 * exactly FIFO here) once the map exceeds its bound. A `while` (not `if`) so shrinking the bound
 * later, or a caller inserting several entries between calls, can never leave it over-full. */
function evictOldest(pending: Map<string, PendingCall>): void {
  while (pending.size > PENDING_CAP) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) return;
    pending.delete(oldest);
  }
}

/**
 * spec §6.4 point 2 / D19: the COMPLETE replacement `tool` node — `state`, `result` and
 * `resultAnchor` all set, never a delta. `elided`/`expandable` (D15) are true when EITHER half is:
 * the call's own (recorded when it was first seen) OR the result's own (`ToolResult.elided`, set
 * only on the `text` variant — images/refs carry only counts, and a `spill`'s preview is bounded to
 * `PREVIEW_CAP` at its source in `parseSpill`, so no non-text variant needs a per-node elide here).
 */
function buildCompletedTool(pending: PendingCall, orphan: Extract<RenderNode, { k: 'orphan_result' }>): RenderNode {
  const resultElided = orphan.result.r === 'text' && orphan.result.elided;
  const isError = orphan.result.r === 'text' && orphan.result.isError;
  const elided = pending.elided || resultElided;
  const node: Extract<RenderNode, { k: 'tool' }> = {
    id: pending.rowAnchorId,
    at: pending.at,
    i: pending.i,
    uuid: pending.uuid,
    ts: pending.ts,
    elided,
    expandable: elided,
    k: 'tool',
    name: pending.name,
    input: pending.input,
    state: isError ? 'error' : 'ok',
    result: orphan.result,
    toolUseId: pending.toolUseId,
    agentId: pending.agentId,
    call: pending.call,
    resultAnchor: orphan.resultAnchor,
  };
  return fitCompletedTool(node);
}

/**
 * D15/D19: a tool card has two payloads but NO size exemption. `normalize()` caps the call's `input`
 * and the result's body EACH as a standalone node, so neither may cross 64 KiB alone — yet a call
 * and a result that are each just under the cap combine here into one node WELL over it (Sol: a
 * ~40 KiB input + ~40 KiB result → an 80,321-byte node marked `elided:false`). The whole COMPLETED
 * node is therefore measured against the same `NODE_CAP` the normalizer uses, and shrunk in the D19
 * order until it fits: first drop the call's `input` entirely (it is fetchable at `call`/`/api/block`,
 * exactly as `elideInput` drops an oversized input), then, only if the result body alone still
 * overflows, truncate that body to a token prefix (fetchable at `resultAnchor`). Both payloads keep
 * their own address, so nothing is lost — only relocated behind an expand.
 */
function fitCompletedTool(node: Extract<RenderNode, { k: 'tool' }>): RenderNode {
  if (utf8Bytes(JSON.stringify(node)) <= NODE_CAP) return node;

  // 1. Drop the call's input payload entirely (D19: expandable via `call`), mirroring `elideInput`.
  let fitted: Extract<RenderNode, { k: 'tool' }> = { ...node, input: null, elided: true, expandable: true };
  if (utf8Bytes(JSON.stringify(fitted)) <= NODE_CAP) return fitted;

  // 2. The result body alone still overflows: shrink its token prefix until the WHOLE node fits.
  // (Non-text results never reach here: images/refs are bounded counts, and a `spill`'s preview is
  // already bounded to `PREVIEW_CAP` at its source in `parseSpill`, so the whole node fits once the
  // input is dropped in step 1 above.)
  if (fitted.result !== null && fitted.result.r === 'text') {
    const textResult = fitted.result; // narrowed to the `text` variant; kept as the reduction base.
    let body = textResult.body;
    while (body.length > 0 && utf8Bytes(JSON.stringify(fitted)) > NODE_CAP) {
      body = body.slice(0, Math.floor(body.length / 2));
      fitted = { ...fitted, result: { ...textResult, body, elided: true } };
    }
  }
  return fitted;
}
