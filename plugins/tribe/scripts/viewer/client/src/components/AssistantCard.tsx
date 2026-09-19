// client/src/components/AssistantCard.tsx — k=assistant (spec §8.1). Body tokens only; the model
// label, when present, is shown small.
import type { RenderNode } from '../../../core/model.ts';
import { BlockExpander } from './BlockExpander.tsx';
import { Markdown } from './Markdown.tsx';

export interface AssistantCardProps {
  node: Extract<RenderNode, { k: 'assistant' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function AssistantCard({ node, sessionId, agentId }: AssistantCardProps) {
  return (
    <div className="assistant">
      <div className="assistant__role">
        claude
        {node.model !== null && <span className="assistant__model"> · {node.model}</span>}
      </div>
      <Markdown tokens={node.body} />
      {node.expandable && <BlockExpander at={node.at} i={node.i} sessionId={sessionId} agentId={agentId} />}
    </div>
  );
}
