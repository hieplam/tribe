// client/src/components/PromptCard.tsx — k=prompt (spec §8.1). Renders the prompt body as tokens
// (never an HTML string) and lifts each inline `Chip` out into its own element carrying its `kind`
// as a data attribute (§7.6). A chip with `detail: null` renders no detail line — the label is the
// whole of it.
import type { Chip, RenderNode } from '../../../core/model.ts';
import { BlockExpander } from './BlockExpander.tsx';
import { Markdown } from './Markdown.tsx';

function ChipMarker({ chip }: { chip: Chip }) {
  return (
    <span className="chip" data-chip-kind={chip.kind}>
      <span data-chip-label>{chip.label}</span>
      {chip.detail !== null && <span data-chip-detail>{chip.detail}</span>}
    </span>
  );
}

export interface PromptCardProps {
  node: Extract<RenderNode, { k: 'prompt' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function PromptCard({ node, sessionId, agentId }: PromptCardProps) {
  return (
    <div className="prompt">
      <div className="prompt__role">you</div>
      {node.chips.length > 0 && (
        <div className="prompt__chips">
          {node.chips.map((chip, i) => (
            <ChipMarker key={i} chip={chip} />
          ))}
        </div>
      )}
      <Markdown tokens={node.body} />
      {node.expandable && <BlockExpander at={node.at} i={node.i} sessionId={sessionId} agentId={agentId} />}
    </div>
  );
}
