// client/src/components/ThinkingCard.tsx — k=thinking, collapsed by default (spec §8.1). Uses the
// native <details> element so no JS state is needed for the toggle.
import type { RenderNode } from '../../../core/model.ts';
import { Markdown } from './Markdown.tsx';

export function ThinkingCard({ node }: { node: Extract<RenderNode, { k: 'thinking' }> }) {
  return (
    <details className="thinking" style={{ color: 'var(--ink-soft)', borderColor: 'var(--rule)' }}>
      <summary>thinking</summary>
      <Markdown tokens={node.body} />
    </details>
  );
}
