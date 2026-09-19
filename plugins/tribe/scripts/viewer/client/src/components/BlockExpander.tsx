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
  // `loaded` — not `block === null` — is the "already fetched?" gate: a legitimately-null payload
  // must not be indistinguishable from "never fetched" (Item A+E, phase-3 audit fix).
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!loaded) {
      // Reset BEFORE awaiting: the error note must reflect only the MOST RECENT attempt, so a
      // retry that is about to succeed must not still show the prior attempt's stale note.
      setFailed(false);
      try {
        const body = await fetchJson(blockUrl({ sessionId, agentId, at, i }), isBlockResponse);
        setBlock(body.block);
        setLoaded(true);
      } catch {
        setFailed(true);
        return;
      }
    }
    setExpanded(true);
  }

  return (
    <>
      <button type="button" className="btn" data-testid="block-expand" onClick={toggle}>
        {expanded ? 'hide' : 'expand'}
      </button>
      {failed && <span className="expand-error" data-testid="expand-error">could not load the full payload</span>}
      {expanded && loaded && (
        <pre className="block-expander__body">{JSON.stringify(block)}</pre>
      )}
    </>
  );
}
