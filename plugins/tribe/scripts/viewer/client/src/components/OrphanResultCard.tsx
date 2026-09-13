// client/src/components/OrphanResultCard.tsx — k=orphan_result (spec §7.5, §8.1). A tool result
// whose call is above the current window. This is NOT an error — loading earlier history re-pairs
// it into a complete `tool` card (D27) — so it renders with the `warn` token, never `error`, and
// carries no `data-error-token`. Its own expansion address is `resultAnchor`, never the node's own
// `at`+`i` (D19: those two coincide for this kind, but the field exists so the same expansion code
// path serves both `tool` and `orphan_result`).
import { useState } from 'react';
import type { RenderNode } from '../../../core/model.ts';
import { blockUrl } from './ImageCard.tsx';

export interface OrphanResultCardProps {
  node: Extract<RenderNode, { k: 'orphan_result' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function OrphanResultCard({ node, sessionId, agentId }: OrphanResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [block, setBlock] = useState<unknown>(null);

  async function expand(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (block === null) {
      const res = await fetch(blockUrl({ sessionId, agentId, at: node.resultAnchor.at, i: node.resultAnchor.i }));
      const body = (await res.json()) as { block: unknown };
      setBlock(body.block);
    }
    setExpanded(true);
  }

  return (
    <div className="orphan-result" style={{ color: 'var(--warn)', borderColor: 'var(--rule)' }}>
      <button type="button" data-testid="orphan-expand" onClick={expand} style={{ color: 'var(--warn)' }}>
        tool result — call is above the window
      </button>
      {expanded && block !== null && (
        <pre className="orphan-result__body" style={{ fontFamily: 'var(--font-mono)' }}>{JSON.stringify(block)}</pre>
      )}
    </div>
  );
}
