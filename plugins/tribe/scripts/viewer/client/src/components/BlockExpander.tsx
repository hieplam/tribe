// client/src/components/BlockExpander.tsx — the shared "expand the full payload at /api/block"
// affordance (spec §7: "every expandable payload uses /api/block", D19). The body cards
// (Prompt/Assistant/Thinking/Error/Raw) render a truncated PREVIEW; when the node is `expandable`
// its full block lives at the node's own `at`+`i` and is fetched lazily, on expand — never before.
//
// Fails closed (fail-closed-edges): the fetch goes through the ONE `http.ts` boundary and its
// rejection is caught into a visible note, never an unhandled rejection escaping the click handler.
import { useState } from 'react';
import { fetchJson, isBlockResponse } from '../http.ts';
import { blockUrl } from './ImageCard.tsx';

export interface BlockExpanderProps {
  at: number;
  i: number;
  sessionId?: string;
  agentId?: string | null;
}

export function BlockExpander({ at, i, sessionId, agentId }: BlockExpanderProps) {
  const [expanded, setExpanded] = useState(false);
  const [block, setBlock] = useState<unknown>(null);
  const [failed, setFailed] = useState(false);

  async function toggle(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (block === null) {
      try {
        const body = await fetchJson(blockUrl({ sessionId, agentId, at, i }), isBlockResponse);
        setBlock(body.block);
      } catch {
        setFailed(true);
        return;
      }
    }
    setExpanded(true);
  }

  return (
    <>
      <button type="button" data-testid="block-expand" onClick={toggle} style={{ color: 'var(--ink-soft)' }}>
        {expanded ? 'hide' : 'expand'}
      </button>
      {failed && <span data-testid="expand-error" style={{ color: 'var(--warn)' }}>could not load the full payload</span>}
      {expanded && block !== null && (
        <pre className="block-expander__body" style={{ fontFamily: 'var(--font-mono)' }}>{JSON.stringify(block)}</pre>
      )}
    </>
  );
}
