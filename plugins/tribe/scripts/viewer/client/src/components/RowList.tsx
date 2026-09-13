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
import { ChipRow } from './ChipRow.tsx';
import { Divider } from './Divider.tsx';
import { ErrorCard } from './ErrorCard.tsx';
import { FollowTail } from './FollowTail.tsx';
import { PromptCard } from './PromptCard.tsx';
import { ThinkingCard } from './ThinkingCard.tsx';
import { ToolCard } from './ToolCard.tsx';

/** The single predicate that decides "the viewport is at the bottom" (spec §8.3). The 32-pixel
 * band absorbs sub-pixel rounding and the last row's own height. */
export function isAtBottom(m: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= 32;
}

/** Dispatch one node to its card. The kinds this task owns render their real card; the five kinds
 * task 25 enriches (orphan_result, image, attachment, raw, unreadable) render a minimal inline
 * body here — the `data-kind`/`data-row-id` wrapper (added by `RowList`) is what §16.2's coverage
 * proof and §12.6 require of EVERY kind, so none may be absent. */
function CardBody({ node }: { node: RenderNode }): ReactElement {
  switch (node.k) {
    case 'prompt':
      return <PromptCard node={node} />;
    case 'assistant':
      return <AssistantCard node={node} />;
    case 'thinking':
      return <ThinkingCard node={node} />;
    case 'tool':
      return <ToolCard node={node} />;
    case 'chip':
      return <ChipRow node={node} />;
    case 'divider':
      return <Divider node={node} />;
    case 'error':
      return <ErrorCard node={node} />;
    case 'orphan_result':
      return <span className="orphan-result" style={{ color: 'var(--warn)' }}>tool result — call is above the window</span>;
    case 'image':
      return <span className="image" style={{ color: 'var(--ink-soft)' }}>image ({node.mediaType})</span>;
    case 'attachment':
      return <span className="attachment" style={{ color: 'var(--ink-soft)' }}>{node.label}</span>;
    case 'raw':
      return <span className="raw" style={{ color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>{node.text ?? node.rowType}</span>;
    case 'unreadable':
      return <span className="unreadable" style={{ color: 'var(--warn)' }}>{node.count} unreadable row(s)</span>;
  }
}

function Row({ node }: { node: RenderNode }) {
  return (
    <div
      className="row"
      data-kind={node.k}
      data-row-id={node.id}
      data-state={node.k === 'tool' ? node.state : undefined}
    >
      <CardBody node={node} />
    </div>
  );
}

export function RowList({ nodes }: { nodes: readonly RenderNode[] }) {
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
    scrollToBottom();
  }

  return (
    <>
      <div ref={ref} data-scroll="rows" className="rows" onScroll={onScroll} style={{ overflowY: 'auto' }}>
        {nodes.map((node) => (
          <Row key={node.id} node={node} />
        ))}
      </div>
      {!following && <FollowTail onResume={resume} />}
    </>
  );
}
