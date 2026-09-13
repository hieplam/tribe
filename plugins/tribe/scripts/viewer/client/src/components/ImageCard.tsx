// client/src/components/ImageCard.tsx — k=image (spec §7.2, §8.1). An image node holds only
// `mediaType` + `bytes`; the base64 payload is fetched lazily, on expand, at the node's OWN
// `at`+`i` (RowAnchor) — never a uuid, because 14,032 measured `attachment` rows and every image
// row can carry none (spec §4). Collapsed by default: nothing is fetched until the user asks.
import { useState } from 'react';
import type { RenderNode } from '../../../core/model.ts';
import { fetchJson, isBlockResponse } from '../http.ts';

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
  // `loaded` — not `src === null` — is the "already fetched?" gate (Item A+E, phase-3 audit fix).
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  async function expand(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!loaded) {
      // Reset BEFORE awaiting: the error note must reflect only the MOST RECENT attempt, so a
      // retry that is about to succeed must not still show the prior attempt's stale note.
      setFailed(false);
      // Fail closed (fail-closed-edges): the expand-fetch rejection must NOT escape this click
      // handler as an unhandled rejection — a failure shows a note, the card keeps its affordance.
      try {
        const body = await fetchJson(blockUrl({ sessionId, agentId, at: node.at, i: node.i }), isBlockResponse);
        const block = body.block as ImageBlock;
        const mediaType = block.source?.media_type ?? node.mediaType;
        const data = block.source?.data ?? '';
        setSrc(`data:${mediaType};base64,${data}`);
        setLoaded(true);
      } catch {
        setFailed(true);
        return;
      }
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
      {failed && <span data-testid="expand-error" style={{ color: 'var(--warn)' }}>could not load image</span>}
      {expanded && loaded && src !== null && <img className="image__full" src={src} alt={node.mediaType} />}
    </div>
  );
}
