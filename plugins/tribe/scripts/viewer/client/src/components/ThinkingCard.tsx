// client/src/components/ThinkingCard.tsx — k=thinking, collapsed by default (spec §8.1). Uses the
// native <details> element so no JS state is needed for the toggle.
import type { RenderNode } from '../../../core/model.ts';
import { BlockExpander } from './BlockExpander.tsx';
import { Markdown } from './Markdown.tsx';

export interface ThinkingCardProps {
  node: Extract<RenderNode, { k: 'thinking' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function ThinkingCard({ node, sessionId, agentId }: ThinkingCardProps) {
  return (
    <details className="thinking" style={{ color: 'var(--ink-soft)', borderColor: 'var(--rule)' }}>
      <summary>thinking</summary>
      <Markdown tokens={node.body} />
      {node.expandable && <BlockExpander at={node.at} i={node.i} sessionId={sessionId} agentId={agentId} />}
    </details>
  );
}
