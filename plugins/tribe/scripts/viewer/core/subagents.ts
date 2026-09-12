/**
 * core/subagents.ts — the subagent tree (spec §4 `Agent`, §5.5). Carried over from
 * `core/live/processes.ts` per spec §11.2: the tree construction and the `reachesRoot` cycle
 * guard (F34/F36) are kept verbatim in shape; `status`/`ProcessNode` are DROPPED -- that concept
 * does not exist on `Agent`.
 *
 * PURE (`pure-core.md`): takes already-read sidecar entries and already-taken stats; nothing
 * here touches the filesystem, spawns a process, or reads the clock (`nowIso` arrives as an
 * argument). Liveness is delegated to `core/liveness.ts#isLive` (D2) rather than reimplemented.
 *
 * `meta.json` is untrusted input (spec §5.5): `toolUseId`, `description`, `agentType`, `model`
 * are rendered as text only; `parentAgentId` is used ONLY as a same-batch lookup key. NONE of
 * them is ever joined into a path -- the only path-forming value is `agentId`, captured by the
 * adapter's `readdir` regex before this module ever sees it (verify by construction: no
 * string in this file is passed to a path-joining function, because none is imported).
 */
import { isLive } from './liveness.ts';
import type { Agent } from './model.ts';

export interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  parentAgentId?: string;
  spawnDepth?: number;
  model?: string;
}

export interface SubagentEntry {
  agentId: string;
  meta: SubagentMeta | null;
  sizeBytes: number;
  mtimeIso: string | null;
  birthtimeIso: string | null;
  /** The same sidecar's size at the previous scan, or `null` when there is none yet (first scan,
   * or the caller does not track it) -- passed straight through to `isLive`'s "grew" half. */
  previousSizeBytes: number | null;
}

export interface DeriveAgentsInput {
  subagents: SubagentEntry[];
  nowIso: string;
}

function compareEntries(a: SubagentEntry, b: SubagentEntry): number {
  const aKey = a.birthtimeIso ?? '';
  const bKey = b.birthtimeIso ?? '';
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
}

export function deriveAgents(input: DeriveAgentsInput): Agent[] {
  const knownAgentIds = new Set(input.subagents.map((entry) => entry.agentId));

  // Named-parent lookup restricted to references that resolve inside the SAME batch: an entry
  // whose parentAgentId is absent or names an id not present here gets parentId null
  // immediately (the orphan case, F34). Used below to detect cycles of ANY length, not just the
  // 1-node self-reference.
  const namedParentOf = new Map<string, string>();
  for (const entry of input.subagents) {
    const named = entry.meta?.parentAgentId;
    if (named && knownAgentIds.has(named)) namedParentOf.set(entry.agentId, named);
  }

  // Walk the named-parent chain from `agentId` toward the root. A chain that terminates
  // (reaches an id with no further named parent) reaches the root. A chain that revisits an id
  // it has already seen is a cycle of some length N >= 1 (self-reference included) and can never
  // reach the root, no matter how many nodes it involves (F36). The `visited` set bounds the
  // walk to at most `knownAgentIds.size + 1` steps even on malformed input, so this can never
  // loop forever.
  function reachesRoot(agentId: string): boolean {
    const visited = new Set<string>([agentId]);
    let current = namedParentOf.get(agentId);
    while (current !== undefined) {
      if (visited.has(current)) return false;
      visited.add(current);
      current = namedParentOf.get(current);
    }
    return true;
  }

  return [...input.subagents]
    .sort(compareEntries)
    .map((entry) => {
      const meta = entry.meta;
      // A subagent whose parentAgentId does not name another entry in the SAME batch, or whose
      // named-parent chain loops back on itself instead of reaching the root -- a 1-node
      // self-reference or a cycle of any length among several sidecars -- gets parentId null.
      // This closes the missing-parent and every-length cycle cases (F34, F36).
      const namedParentId = namedParentOf.get(entry.agentId);
      const parentId = namedParentId && reachesRoot(entry.agentId) ? namedParentId : null;

      const live = entry.mtimeIso !== null && isLive({
        sizeBytes: entry.sizeBytes,
        previousSizeBytes: entry.previousSizeBytes,
        mtimeIso: entry.mtimeIso,
        nowIso: input.nowIso,
      });

      const agent: Agent = {
        id: entry.agentId,
        parentId,
        depth: meta?.spawnDepth ?? 1,
        agentType: meta?.agentType ?? null,
        label: meta?.description ?? `agent ${entry.agentId}`,
        toolUseId: meta?.toolUseId ?? null,
        model: meta?.model ?? null,
        sizeBytes: entry.sizeBytes,
        mtimeIso: entry.mtimeIso,
        birthtimeIso: entry.birthtimeIso,
        live,
      };
      return agent;
    });
}
