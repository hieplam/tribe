// client/src/components/PromptCard.tsx — k=prompt (spec §8.1). Renders the prompt body as tokens
// (never an HTML string) and lifts each inline `Chip` out into its own element carrying its `kind`
// as a data attribute (§7.6). A chip with `detail: null` renders no detail line — the label is the
// whole of it.
import type { Chip, RenderNode } from '../../../core/model.ts';
import { Markdown } from './Markdown.tsx';

function ChipMarker({ chip }: { chip: Chip }) {
  return (
    <span
      data-chip-kind={chip.kind}
      style={{ background: 'var(--badge-bg)', color: 'var(--ink-soft)', borderRadius: 'var(--badge-radius)' }}
    >
      <span data-chip-label>{chip.label}</span>
      {chip.detail !== null && <span data-chip-detail style={{ color: 'var(--ink-soft)' }}>{chip.detail}</span>}
    </span>
  );
}

export function PromptCard({ node }: { node: Extract<RenderNode, { k: 'prompt' }> }) {
  return (
    <div className="prompt" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
      {node.chips.length > 0 && (
        <div className="prompt__chips">
          {node.chips.map((chip, i) => (
            <ChipMarker key={i} chip={chip} />
          ))}
        </div>
      )}
      <Markdown tokens={node.body} />
    </div>
  );
}
