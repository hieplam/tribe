// client/src/components/ToolCard.tsx — k=tool (spec §8.1, §7.5). One card holds BOTH halves of a
// tool call: the call (name + input) and, once paired, its result attached below. A pending card
// shows the call with no result. An error result renders with the error token so a reader can spot
// a failure without expanding. (The two lazy-fetch EXPANSIONS — input via `call`, result via
// `resultAnchor`, D19 — are task 25; this card renders the inline preview the wire already carries.)
import type { RenderNode, ToolResult } from '../../../core/model.ts';
import { Markdown } from './Markdown.tsx';

function ResultBody({ result }: { result: ToolResult }) {
  switch (result.r) {
    case 'text':
      return <Markdown tokens={result.body} />;
    case 'spill':
      return (
        <span className="tool__spill" style={{ color: 'var(--ink-soft)' }}>
          {result.note} <Markdown tokens={result.previewBody} />
        </span>
      );
    case 'images':
      return <span className="tool__images" style={{ color: 'var(--ink-soft)' }}>{result.count} image(s)</span>;
    case 'refs':
      return <span className="tool__refs" style={{ color: 'var(--ink-soft)' }}>{result.count} reference(s)</span>;
  }
}

export function ToolCard({ node }: { node: Extract<RenderNode, { k: 'tool' }> }) {
  const isError = node.state === 'error' || (node.result?.r === 'text' && node.result.isError);
  return (
    <div className="tool" style={{ background: 'var(--surface)', borderColor: isError ? 'var(--error)' : 'var(--rule)' }}>
      <div className="tool__call" style={{ color: 'var(--ink)' }}>
        <span className="tool__name">{node.name}</span>
      </div>
      {node.result !== null && (
        isError ? (
          <div data-error-token className="tool__result" style={{ color: 'var(--error)' }}>
            <ResultBody result={node.result} />
          </div>
        ) : (
          <div className="tool__result" style={{ color: 'var(--ink-soft)' }}>
            <ResultBody result={node.result} />
          </div>
        )
      )}
    </div>
  );
}
