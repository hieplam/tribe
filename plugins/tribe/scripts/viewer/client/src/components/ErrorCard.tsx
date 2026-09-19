// client/src/components/ErrorCard.tsx — k=error (spec §8.1, §4). An API-shaped error row: the
// status (when the transcript carried one) and the body, rendered with the error token so it is
// visibly a failure, not ordinary content.
import type { RenderNode } from '../../../core/model.ts';
import { BlockExpander } from './BlockExpander.tsx';
import { Markdown } from './Markdown.tsx';

export interface ErrorCardProps {
  node: Extract<RenderNode, { k: 'error' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function ErrorCard({ node, sessionId, agentId }: ErrorCardProps) {
  return (
    <div data-error-token className="error">
      {node.status !== null && <span className="error__status">{node.status}</span>}
      <Markdown tokens={node.body} />
      {node.expandable && <BlockExpander at={node.at} i={node.i} sessionId={sessionId} agentId={agentId} />}
    </div>
  );
}
