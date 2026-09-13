// client/src/components/ErrorCard.tsx — k=error (spec §8.1, §4). An API-shaped error row: the
// status (when the transcript carried one) and the body, rendered with the error token so it is
// visibly a failure, not ordinary content.
import type { RenderNode } from '../../../core/model.ts';
import { Markdown } from './Markdown.tsx';

export function ErrorCard({ node }: { node: Extract<RenderNode, { k: 'error' }> }) {
  return (
    <div data-error-token className="error" style={{ background: 'var(--surface)', color: 'var(--error)' }}>
      {node.status !== null && <span className="error__status">{node.status}</span>}
      <Markdown tokens={node.body} />
    </div>
  );
}
