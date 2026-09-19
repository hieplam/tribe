// client/src/components/AttachmentStrip.tsx — consecutive k=attachment nodes, collapsed into one
// strip (spec §7.3, §8.1). 14,032 measured `attachment` rows carry no uuid, so every entry expands
// at its OWN `at`+`i` exactly like every other elided payload (D19's "no exception" clause). An
// entry whose row carried no payload worth showing (`expandable: false`) renders no affordance at
// all — never a button that would return nothing on click.
import { useState } from 'react';
import type { RenderNode } from '../../../core/model.ts';
import { fetchJson, isBlockResponse } from '../http.ts';
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
  // `loaded` — not `block === null` — is the "already fetched?" gate (Item A+E, phase-3 audit fix).
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  async function expand(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!loaded) {
      // Reset BEFORE awaiting: the error note must reflect only the MOST RECENT attempt.
      setFailed(false);
      // Fail closed (fail-closed-edges): a failed expand shows a note, never an unhandled rejection.
      try {
        const body = await fetchJson(blockUrl({ sessionId, agentId, at: node.at, i: node.i }), isBlockResponse);
        setBlock(body.block);
        setLoaded(true);
      } catch {
        setFailed(true);
        return;
      }
    }
    setExpanded(true);
  }

  // Each inner entry carries its OWN `data-row-id` (§12.6.6): the strip wrapper carries the run's
  // first id, but every entry is an addressable row in its own right.
  return (
    <div className="attachment-strip__entry" data-row-id={node.id} data-attachment-label={node.label}>
      {node.expandable ? (
        <button type="button" className="btn" data-testid="attachment-expand" onClick={expand}>
          {node.label}
        </button>
      ) : (
        <span>{node.label}</span>
      )}
      {failed && <span className="expand-error" data-testid="expand-error">could not load attachment</span>}
      {expanded && loaded && (
        <pre className="attachment-strip__body">{JSON.stringify(block)}</pre>
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
    <div className="attachment-strip">
      <span className="attachment-strip__count">{nodes.length} attachment{nodes.length === 1 ? '' : 's'}</span>
      {nodes.map((n) => (
        <AttachmentEntry key={n.id} node={n} sessionId={sessionId} agentId={agentId} />
      ))}
    </div>
  );
}
