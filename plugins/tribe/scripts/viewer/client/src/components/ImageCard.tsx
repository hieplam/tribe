// client/src/components/ImageCard.tsx — k=image (spec §7.2, §8.1). An image node holds only
// `mediaType` + `bytes`; the base64 payload is fetched lazily, on expand, at the node's OWN
// `at`+`i` (RowAnchor) — never a uuid, because 14,032 measured `attachment` rows and every image
// row can carry none (spec §4). Collapsed by default: nothing is fetched until the user asks.
import { useState } from 'react';
import type { RenderNode } from '../../../core/model.ts';

/** `GET /api/block?session=&agent=&at=&i=` (spec §4) — the ONE address every elided payload uses,
 * shared by every expandable card in this file family (`ToolCard`, `OrphanResultCard`,
 * `AttachmentStrip` all import this rather than re-deriving the query string). Pure string math;
 * the fetch itself is the caller's side effect (`pure-core.md`). */
export function blockUrl(params: { sessionId?: string; agentId?: string | null; at: number; i: number }): string {
  const qs = new URLSearchParams();
  if (params.sessionId !== undefined) qs.set('session', params.sessionId);
  if (params.agentId !== undefined && params.agentId !== null) qs.set('agent', params.agentId);
  qs.set('at', String(params.at));
  qs.set('i', String(params.i));
  return `/api/block?${qs.toString()}`;
}

/** The shape `serve.ts#blockAt` returns for an `image` content block — the same Anthropic block
 * the row itself carries (`core/normalize.ts`'s `image` case), read back whole on expand. */
interface ImageBlock {
  source?: { media_type?: string; data?: string };
}

export interface ImageCardProps {
  node: Extract<RenderNode, { k: 'image' }>;
  sessionId?: string;
  agentId?: string | null;
}

export function ImageCard({ node, sessionId, agentId }: ImageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  async function expand(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (src === null) {
      const res = await fetch(blockUrl({ sessionId, agentId, at: node.at, i: node.i }));
      const body = (await res.json()) as { block: ImageBlock };
      const mediaType = body.block.source?.media_type ?? node.mediaType;
      const data = body.block.source?.data ?? '';
      setSrc(`data:${mediaType};base64,${data}`);
    }
    setExpanded(true);
  }

  return (
    <div className="image" style={{ color: 'var(--ink-soft)', borderColor: 'var(--rule)' }}>
      {!expanded && (
        <button type="button" data-testid="image-expand" onClick={expand} style={{ color: 'var(--ink-soft)' }}>
          image ({node.mediaType})
        </button>
      )}
      {expanded && src !== null && <img className="image__full" src={src} alt={node.mediaType} />}
    </div>
  );
}
