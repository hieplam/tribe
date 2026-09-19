// client/src/components/OrphanResultCard.tsx — k=orphan_result (spec §7.5, §8.1). A tool result
// whose call is above the current window. This is NOT an error — loading earlier history re-pairs
// it into a complete `tool` card (D27) — so it renders with the `warn` token, never `error`, and
// carries no `data-error-token`. Its own expansion address is `resultAnchor`, never the node's own
// `at`+`i` (D19: those two coincide for this kind, but the field exists so the same expansion code
// path serves both `tool` and `orphan_result`).
import { useState } from 'react';
import type { RenderNode } from '../../../core/model.ts';
import { fetchJson, isBlockResponse } from '../http.ts';
import { blockUrl } from './ImageCard.tsx';

export interface OrphanResultCardProps {
  node: Extract<RenderNode, { k: 'orphan_result' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function OrphanResultCard({ node, sessionId, agentId }: OrphanResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [block, setBlock] = useState<unknown>(null);
  // `loaded` — not `block === null` — is the "already fetched?" gate (Item A+E, phase-3 audit fix).
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  async function expand(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!loaded) {
      // Reset BEFORE awaiting: the error note must reflect only the MOST RECENT attempt.
      setFailed(false);
      // Fail closed (fail-closed-edges): a failed expand shows a note, never an unhandled rejection.
      try {
        const body = await fetchJson(blockUrl({ sessionId, agentId, at: node.resultAnchor.at, i: node.resultAnchor.i }), isBlockResponse);
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
    <div className="orphan-result">
      <button type="button" className="btn" data-testid="orphan-expand" onClick={expand}>
        tool result — call is above the window
      </button>
      {failed && <span className="expand-error" data-testid="expand-error">could not load result</span>}
      {expanded && loaded && (
        <pre className="orphan-result__body">{JSON.stringify(block)}</pre>
      )}
    </div>
  );
}
