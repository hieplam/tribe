// client/src/components/ToolCard.tsx — k=tool (spec §8.1, §7.5). One card holds BOTH halves of a
// tool call: the call (name + input) and, once paired, its result attached below. A pending card
// shows the call with no result. An error result renders with the error token so a reader can spot
// a failure without expanding.
//
// D19 — a tool card has TWO expansions, at TWO different addresses: the input expands through the
// node's own `call` anchor, the result through `resultAnchor` — never the node's own `at`+`i` for
// the result half, because the result physically lives in a later row. A pending card has
// `resultAnchor: null`, so it offers no result expansion at all. A `spill` result is the one
// exception to the block address: it fetches `/api/spill?name=` instead, because its full body
// lives in a `tool-results/` file, not a row block.
//
// A `Task` tool whose node carries `agentId` (set when its `id` matches a sidecar's `toolUseId`,
// spec §7.5) renders a link to that subagent's tab (spec §8.1) — the same `/s/<id>/a/<agentId>`
// address `AgentTabs` itself navigates to.
import { useState } from 'react';
import type { RenderNode, ToolResult } from '../../../core/model.ts';
import { navigate, type HistoryLike } from '../routes.ts';
import { blockUrl } from './ImageCard.tsx';
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

/** `GET /api/spill?session=&agent=&name=` (spec §3.2) — the one result shape whose full body is
 * NOT at `/api/block`: a `<persisted-output>` spill lives in a `tool-results/` file, addressed by
 * `name`, never by anchor. */
export function spillUrl(params: { sessionId?: string; agentId?: string | null; name: string }): string {
  const qs = new URLSearchParams();
  if (params.sessionId !== undefined) qs.set('session', params.sessionId);
  if (params.agentId !== undefined && params.agentId !== null) qs.set('agent', params.agentId);
  qs.set('name', params.name);
  return `/api/spill?${qs.toString()}`;
}

export interface ToolCardProps {
  node: Extract<RenderNode, { k: 'tool' }>;
  sessionId?: string;
  agentId?: string | null;
  history?: HistoryLike;
}

export function ToolCard({ node, sessionId, agentId, history }: ToolCardProps) {
  const isError = node.state === 'error' || (node.result?.r === 'text' && node.result.isError);

  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputBlock, setInputBlock] = useState<unknown>(null);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [resultBlock, setResultBlock] = useState<unknown>(null);
  const [resultText, setResultText] = useState<string | null>(null);

  async function expandInput(): Promise<void> {
    if (inputExpanded) {
      setInputExpanded(false);
      return;
    }
    if (inputBlock === null) {
      const res = await fetch(blockUrl({ sessionId, agentId, at: node.call.at, i: node.call.i }));
      const body = (await res.json()) as { block: unknown };
      setInputBlock(body.block);
    }
    setInputExpanded(true);
  }

  async function expandResult(): Promise<void> {
    if (node.resultAnchor === null || node.result === null) return;
    if (resultExpanded) {
      setResultExpanded(false);
      return;
    }
    if (node.result.r === 'spill') {
      if (resultText === null) {
        const res = await fetch(spillUrl({ sessionId, agentId, name: node.result.name }));
        setResultText(await res.text());
      }
    } else if (resultBlock === null) {
      const res = await fetch(blockUrl({ sessionId, agentId, at: node.resultAnchor.at, i: node.resultAnchor.i }));
      const body = (await res.json()) as { block: unknown };
      setResultBlock(body.block);
    }
    setResultExpanded(true);
  }

  function goToAgent(): void {
    if (node.agentId === null || sessionId === undefined) return;
    const h = history ?? window.history;
    navigate(h, { kind: 'session_agent', sessionId, agentId: node.agentId });
  }

  return (
    <div className="tool" style={{ background: 'var(--surface)', borderColor: isError ? 'var(--error)' : 'var(--rule)' }}>
      <div className="tool__call" style={{ color: 'var(--ink)' }}>
        <span className="tool__name">{node.name}</span>
        {node.agentId !== null && (
          <button
            type="button"
            data-agent-link={node.agentId}
            onClick={goToAgent}
            style={{ color: 'var(--accent)' }}
          >
            view subagent
          </button>
        )}
        {node.expandable && (
          <button type="button" data-testid="tool-expand-input" onClick={expandInput} style={{ color: 'var(--ink-soft)' }}>
            {inputExpanded ? 'hide input' : 'expand input'}
          </button>
        )}
      </div>
      {inputExpanded && inputBlock !== null && (
        <pre className="tool__input" style={{ fontFamily: 'var(--font-mono)' }}>{JSON.stringify(inputBlock)}</pre>
      )}
      {node.result !== null && (
        <>
          <div
            data-error-token={isError ? '' : undefined}
            className="tool__result"
            style={{ color: isError ? 'var(--error)' : 'var(--ink-soft)' }}
          >
            <ResultBody result={node.result} />
          </div>
          {node.resultAnchor !== null && (
            <button type="button" data-testid="tool-expand-result" onClick={expandResult} style={{ color: 'var(--ink-soft)' }}>
              {resultExpanded ? 'hide result' : 'expand result'}
            </button>
          )}
          {resultExpanded && resultText !== null && (
            <pre className="tool__spill-full" style={{ fontFamily: 'var(--font-mono)' }}>{resultText}</pre>
          )}
          {resultExpanded && resultBlock !== null && (
            <pre className="tool__result-full" style={{ fontFamily: 'var(--font-mono)' }}>{JSON.stringify(resultBlock)}</pre>
          )}
        </>
      )}
    </div>
  );
}
