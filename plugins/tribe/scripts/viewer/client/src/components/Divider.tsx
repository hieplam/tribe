// client/src/components/Divider.tsx — k=divider (spec §8.1). A labelled rule between sections.
import type { RenderNode } from '../../../core/model.ts';

export function Divider({ node }: { node: Extract<RenderNode, { k: 'divider' }> }) {
  return (
    <div className="divider" style={{ color: 'var(--ink-soft)', borderColor: 'var(--rule)' }}>
      {node.label}
    </div>
  );
}
