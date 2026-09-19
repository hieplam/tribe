// client/src/components/ChipRow.tsx — k=chip (spec §8.1, §7.6). A top-level inline marker lifted
// out of the transcript (a slash command, a system reminder, a local-command stdout, an IDE
// context). A chip with `detail: null` renders no detail line — the label is the whole of it. A
// chip carrying an `href` renders a safe anchor, gated exactly as `Markdown` gates its links, with
// `rel="noopener noreferrer"` per §12.5; a `javascript:`/`data:` href is refused.
import type { RenderNode } from '../../../core/model.ts';
import { safeHref } from './Markdown.tsx';

export function ChipRow({ node }: { node: Extract<RenderNode, { k: 'chip' }> }) {
  const href = node.href === null ? null : safeHref(node.href);
  return (
    <div className="chip">
      {href !== null ? (
        <a data-chip-label href={href} rel="noopener noreferrer">{node.label}</a>
      ) : (
        <span data-chip-label>{node.label}</span>
      )}
      {node.detail !== null && <span data-chip-detail>{node.detail}</span>}
    </div>
  );
}
