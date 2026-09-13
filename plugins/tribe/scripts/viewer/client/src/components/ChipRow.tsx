// client/src/components/ChipRow.tsx — k=chip (spec §8.1, §7.6). A top-level inline marker lifted
// out of the transcript (a slash command, a system reminder, a local-command stdout, an IDE
// context). A chip with `detail: null` renders no detail line — the label is the whole of it.
import type { RenderNode } from '../../../core/model.ts';

export function ChipRow({ node }: { node: Extract<RenderNode, { k: 'chip' }> }) {
  return (
    <div className="chip" style={{ background: 'var(--badge-bg)', color: 'var(--ink-soft)', borderRadius: 'var(--badge-radius)' }}>
      <span data-chip-label>{node.label}</span>
      {node.detail !== null && <span data-chip-detail style={{ color: 'var(--ink-soft)' }}>{node.detail}</span>}
    </div>
  );
}
