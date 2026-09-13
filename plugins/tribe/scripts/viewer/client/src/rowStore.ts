// client/src/rowStore.ts — the client's window store (spec §6.3, §6.4, §8.4). The SINGLE owner of
// row identity, dedupe, and eviction: components read from it and never keep their own copy of a
// row. It holds ONE contiguous window `[first, last]` in byte offsets, keyed by `RowAnchor.id`,
// in file order — never a sparse set of ranges. That one invariant is what makes back-fill,
// eviction, and dedupe consistent without a merge algorithm.
//
// `pure-core.md`: the two operations that need the network (`loadEarlier`, `reloadTail`) do NOT
// reach for `fetch` — they take an injected `FetchRows` seam, so the store's identity/eviction
// logic stays a pure function of its inputs and is unit-testable with a fake. The composition
// root wires the real fetch (`client/src/useEventStream.ts#fetchRowsPage`).
//
// Type-only import: `client/src/**` never VALUE-imports from `core/` (§12.6.1); these interfaces
// are erased at compile time.
import type { Patch, RenderNode } from '../../core/model.ts';

/** The client window bound (spec §6.5). Past it, back-fill evicts from the TAIL and turns
 * follow-live off (§6.3) — head eviction would delete the history the user just requested. */
export const WINDOW_CAP = 2000;

/** The wire shape of `GET /api/rows` (serve.ts) — the initial/tail window and back-fill both
 * return it. `patches` carries the D27 orphan-repair removals a back-fill produces (§6.4). */
export interface RowsPage {
  nodes: RenderNode[];
  patches: Patch[];
  from: number;
  to: number;
  truncatedBefore: boolean;
}

/** The one world-contact `loadEarlier`/`reloadTail` need, injected (`pure-core.md`). `before: null`
 * is the fresh tail window (equivalent to `hello`); a byte offset is a ranged back-fill. `orphans`
 * carries the `tool_use_id` of every `orphan_result` currently held, so the server can re-pair them
 * (D27). */
export type FetchRows = (req: { before: number | null; orphans: string[] }) => Promise<RowsPage>;

/** The immutable view components render from. Referentially stable while nothing changes, so
 * `useSyncExternalStore` does not tear. */
export interface StoreSnapshot {
  generation: string | null;
  nodes: readonly RenderNode[];
  first: number;          // byte offset: start of the window (the `before` a back-fill passes back)
  last: number;           // byte offset: end of the window
  following: boolean;     // true => append live rows at the tail; false => reading history
  newBelow: number;       // "N new below" count while at the cap with follow off (§6.3)
  truncatedBefore: boolean; // more history precedes `first`
}

export interface RowStore {
  getSnapshot(): StoreSnapshot;
  subscribe(cb: () => void): () => void;
  /** `hello` (spec §6.2): adopt the connection's generation. If it DIFFERS from the one held, the
   * window it belonged to has been discarded — clear the store, then let the following `rows`
   * frame apply the new snapshot (D12). */
  hello(h: { generation: string; from: number; to: number; truncatedBefore: boolean }): void;
  /** `rows` (spec §6.2): append every node whose id is not already present. An id already held is
   * ignored, not appended (the reconnect overlap, D12). While at the cap with follow off, the
   * frame is COUNTED, not appended (§6.3). */
  applyRows(r: { nodes: RenderNode[]; from: number; to: number }): void;
  /** `patch` (spec §6.4): `result` replaces the node at `id` in place; `remove` deletes it. A
   * patch of either op naming an id outside the window is dropped silently. */
  applyPatches(patches: Patch[]): void;
  /** `reset` (spec §6.1): clear and await the following window. */
  reset(): void;
  /** "Load earlier" (spec §6.3): a ranged back-fill before `first`, sending the held orphans; the
   * returned nodes are PREPENDED and the returned patches applied through the same patch path. */
  loadEarlier(fetchRows: FetchRows): Promise<void>;
  /** "N new below" pill / scroll-to-bottom (spec §6.3): a fresh tail fetch that REPLACES the
   * window, re-enables following, and zeroes the counter. */
  reloadTail(fetchRows: FetchRows): Promise<void>;
}

/** The `tool_use_id` of every `orphan_result` currently held, in file order — the ids "load
 * earlier" sends so the server can re-pair them (D27). */
export function orphanToolUseIds(nodes: readonly RenderNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) if (n.k === 'orphan_result') ids.push(n.toolUseId);
  return ids;
}

/** The window is one contiguous range iff its nodes are in non-decreasing `(at, i)` file order with
 * no repeated id. This is the invariant every operation preserves; a duplicate id (a merged
 * overlap) or an out-of-order pair (a disjoint range spliced in) both fail it. */
export function isContiguous(nodes: readonly RenderNode[]): boolean {
  const seen = new Set<string>();
  let prevAt = -Infinity;
  let prevI = -Infinity;
  for (const n of nodes) {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    if (n.at < prevAt || (n.at === prevAt && n.i < prevI)) return false;
    prevAt = n.at;
    prevI = n.i;
  }
  return true;
}

const EMPTY: StoreSnapshot = {
  generation: null,
  nodes: [],
  first: 0,
  last: 0,
  following: true,
  newBelow: 0,
  truncatedBefore: false,
};

export function createRowStore(): RowStore {
  let state: StoreSnapshot = EMPTY;
  const subscribers = new Set<() => void>();

  function commit(next: StoreSnapshot): void {
    state = next;
    for (const cb of subscribers) cb();
  }

  function idSet(nodes: readonly RenderNode[]): Set<string> {
    return new Set(nodes.map((n) => n.id));
  }

  function hello(h: { generation: string; from: number; to: number; truncatedBefore: boolean }): void {
    if (h.generation === state.generation) {
      // Same connection re-announcing (does not happen across reconnects, where the generation is
      // always fresh) — adopt the bounds without discarding the window.
      commit({ ...state, first: h.from, last: h.to, truncatedBefore: h.truncatedBefore });
      return;
    }
    // A new generation: the previous window has been discarded (D12). Clear, then the following
    // `rows` frame applies the snapshot.
    commit({
      generation: h.generation,
      nodes: [],
      first: h.from,
      last: h.to,
      following: true,
      newBelow: 0,
      truncatedBefore: h.truncatedBefore,
    });
  }

  function applyRows(r: { nodes: RenderNode[]; from: number; to: number }): void {
    const present = idSet(state.nodes);
    const fresh = r.nodes.filter((n) => !present.has(n.id));

    // At the cap with follow off, an incoming frame is COUNTED, not appended (§6.3): appending
    // while the tail is frozen would put a hole in the middle of the window.
    if (!state.following && state.nodes.length >= WINDOW_CAP) {
      if (fresh.length === 0) return;
      commit({ ...state, newBelow: state.newBelow + fresh.length });
      return;
    }

    if (fresh.length === 0) return;
    const nodes = state.nodes.concat(fresh);
    const first = state.nodes.length === 0 ? r.from : state.first;
    commit({ ...state, nodes, first, last: r.to });
  }

  function applyPatches(patches: Patch[]): void {
    if (patches.length === 0) return;
    let nodes = state.nodes;
    let changed = false;
    for (const p of patches) {
      const idx = nodes.findIndex((n) => n.id === p.id);
      if (idx === -1) continue; // a patch for an id outside the window is dropped silently (§6.4)
      if (!changed) {
        nodes = nodes.slice();
        changed = true;
      }
      if (p.op === 'result') {
        nodes[idx] = p.node; // replace in place, position preserved
      } else {
        nodes.splice(idx, 1); // remove; nothing takes its place (§7.5)
      }
    }
    if (changed) commit({ ...state, nodes });
  }

  function reset(): void {
    commit({ ...EMPTY, generation: state.generation });
  }

  /** Prepend a back-filled page, apply its orphan-repair patches, then enforce the cap from the
   * TAIL (§6.3). The oldest back-filled node (the head) always survives. */
  function prependPage(pageResult: RowsPage): void {
    const present = idSet(state.nodes);
    const fresh = pageResult.nodes.filter((n) => !present.has(n.id));
    let nodes = fresh.concat(state.nodes);

    // Orphan repair (D27): the returned `remove` patches delete an `orphan_result` the store holds
    // (its paired tool card arrived in `nodes` at the call's earlier anchor); `result` patches
    // replace in place — the SAME path live patches use.
    for (const p of pageResult.patches) {
      const idx = nodes.findIndex((n) => n.id === p.id);
      if (idx === -1) continue;
      if (p.op === 'result') nodes[idx] = p.node;
      else nodes.splice(idx, 1);
    }

    let following = state.following;
    let last = state.last;
    if (nodes.length > WINDOW_CAP) {
      nodes = nodes.slice(0, WINDOW_CAP); // keep the HEAD (oldest requested history), evict the TAIL
      following = false;                  // ...and turn follow-live off in the same operation (§6.3)
      last = nodes[nodes.length - 1]!.at;
    }
    commit({ ...state, nodes, first: pageResult.from, last, following, truncatedBefore: pageResult.truncatedBefore });
  }

  async function loadEarlier(fetchRows: FetchRows): Promise<void> {
    const before = state.first;
    const orphans = orphanToolUseIds(state.nodes);
    const pageResult = await fetchRows({ before, orphans });
    prependPage(pageResult);
  }

  async function reloadTail(fetchRows: FetchRows): Promise<void> {
    const pageResult = await fetchRows({ before: null, orphans: [] });
    commit({
      ...state,
      nodes: pageResult.nodes.slice(),
      first: pageResult.from,
      last: pageResult.to,
      following: true,
      newBelow: 0,
      truncatedBefore: pageResult.truncatedBefore,
    });
  }

  return {
    getSnapshot: () => state,
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    hello,
    applyRows,
    applyPatches,
    reset,
    loadEarlier,
    reloadTail,
  };
}
