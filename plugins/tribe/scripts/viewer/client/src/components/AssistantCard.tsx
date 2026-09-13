// client/src/components/AssistantCard.tsx — k=assistant (spec §8.1). Body tokens only; the model
// label, when present, is shown small.
import type { RenderNode } from '../../../core/model.ts';
import { Markdown } from './Markdown.tsx';

export function AssistantCard({ node }: { node: Extract<RenderNode, { k: 'assistant' }> }) {
  return (
    <div className="assistant" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <Markdown tokens={node.body} />
      {node.model !== null && (
        <span className="assistant__model" style={{ color: 'var(--ink-soft)' }}>{node.model}</span>
      )}
    </div>
  );
}
