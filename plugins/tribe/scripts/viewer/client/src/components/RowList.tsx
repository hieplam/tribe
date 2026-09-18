// client/src/components/RowList.tsx — the windowed RenderNode list and the follow-the-tail scroll
// container (spec §8.1, §8.3, §12.6). Every rendered row carries `data-kind` and `data-row-id`; a
// tool row also carries `data-state`; the container carries `data-scroll="rows"`. These are the
// addresses the DOM e2e proofs assert against, so they are contract, not scaffolding.
//
// Follow-the-tail (§8.3), one rule, no heuristics: while the viewport is within the 32-pixel bottom
// band, every new-rows render scrolls to the new bottom. A user scroll that leaves the band stops
// following and shows the pill; clicking it resumes. New rows arriving while not following never
// move the viewport — the list grows below the fold.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { RenderNode } from '../../../core/model.ts';
import { AssistantCard } from './AssistantCard.tsx';
import { AttachmentStrip, groupAttachments } from './AttachmentStrip.tsx';
import { ChipRow } from './ChipRow.tsx';
import { Divider } from './Divider.tsx';
import { ErrorCard } from './ErrorCard.tsx';
import { FollowTail } from './FollowTail.tsx';
import { ImageCard } from './ImageCard.tsx';
import { OrphanResultCard } from './OrphanResultCard.tsx';
import { PromptCard } from './PromptCard.tsx';
import { RawCard } from './RawCard.tsx';
import { ThinkingCard } from './ThinkingCard.tsx';
import { ToolCard } from './ToolCard.tsx';
import { UnreadableNote } from './UnreadableNote.tsx';

/** The single predicate that decides "the viewport is at the bottom" (spec §8.3). The 32-pixel
 * band absorbs sub-pixel rounding and the last row's own height. */
export function isAtBottom(m: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= 32;
}

/** Dispatch one node to its REAL card. Every one of the twelve kinds mounts its dedicated
 * component — the five expandable kinds (orphan_result, image, attachment, raw, unreadable) take
 * `sessionId`/`agentId` so their lazy `/api/block`/`/api/spill` expand-fetch is session-scoped
 * (§4). The `data-kind`/`data-row-id` wrapper (added by `Row`) is what §16.2's coverage proof and
 * §12.6 require of every kind. */
function CardBody({ node, sessionId, agentId, onSelectAgent }: { node: RenderNode; sessionId: string; agentId: string | null; onSelectAgent?: (agentId: string) => void }): ReactElement {
  switch (node.k) {
    case 'prompt':
      return <PromptCard node={node} sessionId={sessionId} agentId={agentId} />;
    case 'assistant':
      return <AssistantCard node={node} sessionId={sessionId} agentId={agentId} />;
    case 'thinking':
      return <ThinkingCard node={node} sessionId={sessionId} agentId={agentId} />;
    case 'tool':
      return <ToolCard node={node} sessionId={sessionId} agentId={agentId} onSelectAgent={onSelectAgent} />;
    case 'chip':
      return <ChipRow node={node} />;
    case 'divider':
      return <Divider node={node} />;
    case 'error':
      return <ErrorCard node={node} sessionId={sessionId} agentId={agentId} />;
    case 'orphan_result':
      return <OrphanResultCard node={node} sessionId={sessionId} agentId={agentId} />;
    case 'image':
      return <ImageCard node={node} sessionId={sessionId} agentId={agentId} />;
    case 'attachment':
      // Unreachable in practice: `RowList` runs `groupAttachments` first, which wraps EVERY
      // attachment node (even a lone one) into the array branch rendered as an `<AttachmentStrip>`,
      // so no attachment node ever reaches `CardBody`. Kept only for the switch's exhaustiveness
      // over the `RenderNode` union.
      return <AttachmentStrip nodes={[node]} sessionId={sessionId} agentId={agentId} />;
    case 'raw':
      return <RawCard node={node} />;
    case 'unreadable':
      return <UnreadableNote node={node} />;
  }
}

function Row({ node, sessionId, agentId, onSelectAgent }: { node: RenderNode; sessionId: string; agentId: string | null; onSelectAgent?: (agentId: string) => void }) {
  return (
    <div
      className="row"
      data-kind={node.k}
      data-row-id={node.id}
      data-state={node.k === 'tool' ? node.state : undefined}
    >
      <CardBody node={node} sessionId={sessionId} agentId={agentId} onSelectAgent={onSelectAgent} />
    </div>
  );
}

export interface RowListProps {
  nodes: readonly RenderNode[];
  sessionId: string;
  agentId: string | null;
  /** The store's "N new below" count (§6.3): while > 0 the store holds rows it COUNTED but did not
   * append (at the cap, follow off). A local scroll cannot reveal them, so scroll-to-bottom must
   * reload the tail instead (R14.5c). */
  newBelow?: number;
  /** Fetch a fresh tail window (`store.reloadTail`), wired from `SessionView` (R14.5c). */
  onReloadTail?: () => void;
  /** Switch the open stream to a subagent (the ToolCard subagent link, R14.8). */
  onSelectAgent?: (agentId: string) => void;
}

export function RowList({ nodes, sessionId, agentId, newBelow = 0, onReloadTail, onSelectAgent }: RowListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(following);
  followingRef.current = following;

  function scrollToBottom(): void {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // On every new-rows render, follow to the bottom iff we are following (§8.3).
  useEffect(() => {
    if (followingRef.current) scrollToBottom();
  }, [nodes]);

  function onScroll(): void {
    const el = ref.current;
    if (!el) return;
    setFollowing(isAtBottom({ scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight }));
  }

  function resume(): void {
    setFollowing(true);
    // If the store COUNTED rows below the window (§6.3 cap, follow off), a local scroll cannot show
    // them — reload the tail so they actually arrive (R14.5c). Otherwise just scroll to the bottom.
    if (newBelow > 0 && onReloadTail) {
      onReloadTail();
    } else {
      scrollToBottom();
    }
  }

  return (
    <>
      <div ref={ref} data-scroll="rows" className="rows" onScroll={onScroll} style={{ overflowY: 'auto' }}>
        {groupAttachments(nodes).map((item) =>
          Array.isArray(item) ? (
            // A run of consecutive attachment nodes → ONE strip (spec §8.1). The row wrapper keeps
            // the §16.2 coverage/addressing contract: `data-kind="attachment"` and a `data-row-id`
            // of the run's first node, so every rendered row stays addressable.
            <div key={item[0]!.id} className="row" data-kind="attachment" data-row-id={item[0]!.id}>
              <AttachmentStrip nodes={item} sessionId={sessionId} agentId={agentId} />
            </div>
          ) : (
            <Row key={item.id} node={item} sessionId={sessionId} agentId={agentId} onSelectAgent={onSelectAgent} />
          ),
        )}
      </div>
      {!following && <FollowTail onResume={resume} />}
    </>
  );
}
