// client/src/components/AgentTabs.tsx — "parent" + one tab per Agent (spec §8.1). `deriveAgents`
// (core/subagents.ts) sorts its output by birth time, NOT tree order, so this component computes
// tree order itself — a pure data transformation (`pure-core.md`) — before rendering: each agent
// under its parent, depth-first, siblings kept in the order the caller supplied them. Selecting a
// tab navigates to `/s/<id>/a/<agentId>` (reusing `client/src/routes.ts`'s own address, never a
// second copy of that string) and calls `onSelect`, which is what the session view uses to open a
// new stream for the newly-selected agent.
import type { Agent } from '../../../core/model.ts';
import { navigate, type HistoryLike } from '../routes.ts';

/** Depth-first tree order from `parentId`, preserving each parent's children in the order `agents`
 * already lists them. An agent whose `parentId` never resolves to another entry in `agents` (dead
 * reference, foreign array) still renders exactly once, appended after every resolved node, rather
 * than being silently dropped. */
export function treeOrder(agents: readonly Agent[]): Agent[] {
  const byParent = new Map<string | null, Agent[]>();
  for (const a of agents) {
    const siblings = byParent.get(a.parentId) ?? [];
    siblings.push(a);
    byParent.set(a.parentId, siblings);
  }
  const out: Agent[] = [];
  const visit = (parentId: string | null): void => {
    for (const a of byParent.get(parentId) ?? []) {
      out.push(a);
      visit(a.id);
    }
  };
  visit(null);
  const seen = new Set(out.map((a) => a.id));
  for (const a of agents) {
    if (!seen.has(a.id)) out.push(a);
  }
  return out;
}

export interface AgentTabsProps {
  sessionId: string;
  agents: readonly Agent[];
  activeAgentId: string | null;
  onSelect?: (agentId: string | null) => void;
  history?: HistoryLike;
}

export function AgentTabs({ sessionId, agents, activeAgentId, onSelect, history }: AgentTabsProps) {
  const ordered = treeOrder(agents);

  function select(agentId: string | null): void {
    const h = history ?? window.history;
    navigate(h, agentId === null ? { kind: 'session', sessionId } : { kind: 'session_agent', sessionId, agentId });
    onSelect?.(agentId);
  }

  return (
    <div className="agent-tabs">
      <button
        type="button"
        className="agent-tabs__tab"
        data-agent-tab=""
        data-active={activeAgentId === null}
        onClick={() => select(null)}
      >
        parent
      </button>
      {ordered.map((a) => (
        <button
          key={a.id}
          type="button"
          className="agent-tabs__tab"
          data-agent-tab={a.id}
          data-depth={a.depth}
          data-active={activeAgentId === a.id}
          onClick={() => select(a.id)}
          style={{ paddingLeft: `calc(var(--space-12) * ${a.depth + 1})` }} // one step in per nesting level, past the base tab padding
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
