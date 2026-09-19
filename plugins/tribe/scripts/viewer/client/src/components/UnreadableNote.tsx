// client/src/components/UnreadableNote.tsx — k=unreadable (spec §13, §8.1). A row (or a run of
// them) that could not be parsed at all: counted, never dropped silently (§0: under-rendering is a
// bug).
import type { RenderNode } from '../../../core/model.ts';

export function UnreadableNote({ node }: { node: Extract<RenderNode, { k: 'unreadable' }> }) {
  return (
    <div className="unreadable">
      {node.count} unreadable row(s)
    </div>
  );
}
