// client/src/components/AttachmentStrip.tsx — consecutive k=attachment nodes, collapsed into one
// strip (spec §7.3, §8.1). 14,032 measured `attachment` rows carry no uuid, so every entry expands
// at its OWN `at`+`i` exactly like every other elided payload (D19's "no exception" clause). An
// entry whose row carried no payload worth showing (`expandable: false`) renders no affordance at
// all — never a button that would return nothing on click.
import { useState } from 'react';
import type { RenderNode } from '../../../core/model.ts';
import { blockUrl } from './ImageCard.tsx';

export type AttachmentNode = Extract<RenderNode, { k: 'attachment' }>;

/** Groups a node list into runs of consecutive `attachment` nodes vs. everything else, so a caller
 * can render one `<AttachmentStrip>` per run instead of one row per node. Pure — a data
 * transformation, no side effect (`pure-core.md`). Wired into the live row list by
 * `client/src/components/RowList.tsx` (the phase-3 assembly): each returned run becomes one strip. */
export function groupAttachments(nodes: readonly RenderNode[]): (RenderNode | AttachmentNode[])[] {
  const out: (RenderNode | AttachmentNode[])[] = [];
  let run: AttachmentNode[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      out.push(run);
      run = [];
    }
  };
  for (const n of nodes) {
    if (n.k === 'attachment') {
      run.push(n);
    } else {
      flush();
      out.push(n);
    }
  }
  flush();
  return out;
}

function AttachmentEntry({ node, sessionId, agentId }: { node: AttachmentNode; sessionId?: string; agentId?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [block, setBlock] = useState<unknown>(null);

  async function expand(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (block === null) {
      const res = await fetch(blockUrl({ sessionId, agentId, at: node.at, i: node.i }));
      const body = (await res.json()) as { block: unknown };
      setBlock(body.block);
    }
    setExpanded(true);
  }

  return (
    <div className="attachment-strip__entry" data-attachment-label={node.label}>
      {node.expandable ? (
        <button type="button" data-testid="attachment-expand" onClick={expand} style={{ color: 'var(--ink-soft)' }}>
          {node.label}
        </button>
      ) : (
        <span style={{ color: 'var(--ink-soft)' }}>{node.label}</span>
      )}
      {expanded && block !== null && (
        <pre className="attachment-strip__body" style={{ fontFamily: 'var(--font-mono)' }}>{JSON.stringify(block)}</pre>
      )}
    </div>
  );
}

export interface AttachmentStripProps {
  nodes: readonly AttachmentNode[];
  sessionId?: string;
  agentId?: string | null;
}

export function AttachmentStrip({ nodes, sessionId, agentId }: AttachmentStripProps) {
  return (
    <div className="attachment-strip" style={{ color: 'var(--ink-soft)', borderColor: 'var(--rule)' }}>
      <span className="attachment-strip__count">{nodes.length} attachment{nodes.length === 1 ? '' : 's'}</span>
      {nodes.map((n) => (
        <AttachmentEntry key={n.id} node={n} sessionId={sessionId} agentId={agentId} />
      ))}
    </div>
  );
}
