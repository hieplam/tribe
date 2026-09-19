// client/src/components/RawCard.tsx — k=raw (spec §7.1, §8.1). The open-world fallback for a row
// or block shape the ladder does not otherwise render: it is never dropped, only collapsed. Renders
// with the row type visible so a reader can see SOMETHING was here rather than a silent gap; the
// `oversized` variant shows its human label. When the row is `expandable`, its full JSON is fetched
// on demand at the row's own `at`+`i` via `/api/block` (§7), never rendered inline.
import type { RenderNode } from '../../../core/model.ts';
import { BlockExpander } from './BlockExpander.tsx';

export interface RawCardProps {
  node: Extract<RenderNode, { k: 'raw' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function RawCard({ node, sessionId, agentId }: RawCardProps) {
  return (
    <div className="raw">
      <span className="raw__type">{node.rowType}</span>
      {node.text !== null && <span className="raw__note">{node.text}</span>}
      {node.expandable && <BlockExpander at={node.at} i={node.i} sessionId={sessionId} agentId={agentId} />}
    </div>
  );
}
