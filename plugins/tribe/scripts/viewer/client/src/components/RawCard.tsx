// client/src/components/RawCard.tsx — k=raw (spec §7.1, §8.1). The open-world fallback for a row
// or block shape the ladder does not otherwise render: it is never dropped, only collapsed. Renders
// with the row type visible so a reader can see SOMETHING was here rather than a silent gap.
import type { RenderNode } from '../../../core/model.ts';

export function RawCard({ node }: { node: Extract<RenderNode, { k: 'raw' }> }) {
  return (
    <div className="raw" style={{ color: 'var(--ink-soft)', borderColor: 'var(--rule)' }}>
      <span className="raw__type" style={{ fontFamily: 'var(--font-mono)' }}>{node.rowType}</span>
    </div>
  );
}
