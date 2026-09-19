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
import { fetchJson, fetchText, isBlockResponse } from '../http.ts';
import { navigate, type HistoryLike } from '../routes.ts';
import { blockUrl } from './ImageCard.tsx';
import { Markdown } from './Markdown.tsx';

function ResultBody({ result }: { result: ToolResult }) {
  switch (result.r) {
    case 'text':
      return <Markdown tokens={result.body} />;
    case 'spill':
      return (
        <span className="tool__spill">
          {result.note} <Markdown tokens={result.previewBody} />
        </span>
      );
    case 'images':
      return <span className="tool__images">{result.count} image(s)</span>;
    case 'refs':
      return <span className="tool__refs">{result.count} reference(s)</span>;
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

/** The input keys whose value best summarises a call, most telling first (a Bash `command`, a
 * Read's `file_path`, a Grep's `pattern`…). */
const ARG_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'] as const;

/** The one-line argument shown after a tool's name (preview §D `.arg`), or null when the input holds
 * nothing to summarise — a completed call's over-cap input arrives as `null` (D15), and its full
 * payload stays behind "expand input". Never throws: a non-object input is just null. */
export function toolArg(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (typeof input !== 'object' || input === null) return null;
  const fields = input as Record<string, unknown>;
  for (const key of ARG_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

export interface ToolCardProps {
  node: Extract<RenderNode, { k: 'tool' }>;
  sessionId?: string;
  agentId?: string | null;
  history?: HistoryLike;
  /** Switch the open stream to the subagent — the SAME signal `AgentTabs` fires on a tab select.
   * Without it, the link only pushed the URL and `App` (which listens to `popstate`, not
   * `pushState`) never re-pointed the stream, so the parent stream stayed active (R14.8). */
  onSelectAgent?: (agentId: string) => void;
}

export function ToolCard({ node, sessionId, agentId, history, onSelectAgent }: ToolCardProps) {
  const isError = node.state === 'error' || (node.result?.r === 'text' && node.result.isError);
  // The outcome the header shows: an ok-state call whose result text is flagged an error reads as an error.
  const outcome = isError ? 'error' : node.state;
  const arg = toolArg(node.input);

  const [inputExpanded, setInputExpanded] = useState(false);
  const [inputBlock, setInputBlock] = useState<unknown>(null);
  // `inputLoaded`/`resultLoaded` — not `inputBlock === null`/`resultBlock === null` — are the
  // "already fetched?" gates (Item A+E, phase-3 audit fix): a legitimately-null payload must not
  // be indistinguishable from "never fetched".
  const [inputLoaded, setInputLoaded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [resultBlock, setResultBlock] = useState<unknown>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [resultLoaded, setResultLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  async function expandInput(): Promise<void> {
    if (inputExpanded) {
      setInputExpanded(false);
      return;
    }
    if (!inputLoaded) {
      // Reset BEFORE awaiting: the error note must reflect only the MOST RECENT attempt.
      setFailed(false);
      // Fail closed (fail-closed-edges): a failed expand shows a note, never an unhandled rejection.
      try {
        const body = await fetchJson(blockUrl({ sessionId, agentId, at: node.call.at, i: node.call.i }), isBlockResponse);
        setInputBlock(body.block);
        setInputLoaded(true);
      } catch {
        setFailed(true);
        return;
      }
    }
    setInputExpanded(true);
  }

  async function expandResult(): Promise<void> {
    if (node.resultAnchor === null || node.result === null) return;
    if (resultExpanded) {
      setResultExpanded(false);
      return;
    }
    if (!resultLoaded) {
      // Reset BEFORE awaiting: the error note must reflect only the MOST RECENT attempt.
      setFailed(false);
      try {
        if (node.result.r === 'spill') {
          setResultText(await fetchText(spillUrl({ sessionId, agentId, name: node.result.name })));
        } else {
          const body = await fetchJson(blockUrl({ sessionId, agentId, at: node.resultAnchor.at, i: node.resultAnchor.i }), isBlockResponse);
          setResultBlock(body.block);
        }
        setResultLoaded(true);
      } catch {
        setFailed(true);
        return;
      }
    }
    setResultExpanded(true);
  }

  function goToAgent(): void {
    if (node.agentId === null || sessionId === undefined) return;
    const h = history ?? window.history;
    navigate(h, { kind: 'session_agent', sessionId, agentId: node.agentId });
    // Switch the stream too — the same `onSelect` path `AgentTabs` uses. A bare `pushState` left
    // the parent stream active because `App` only listens to `popstate` (R14.8).
    onSelectAgent?.(node.agentId);
  }

  return (
    <div className="tool">
      <div className="tool__call">
        {/* The caret shows whether the result body below is open: a pending call has none yet. */}
        <span className="tool__caret" aria-hidden="true">{node.result !== null ? '▾' : '▸'}</span>
        <span className="tool__name">{node.name}</span>
        {arg !== null && <span className="tool__arg">{arg}</span>}
        {node.agentId !== null && (
          <button
            type="button"
            className="btn tool__agent-link"
            data-agent-link={node.agentId}
            onClick={goToAgent}
          >
            view subagent
          </button>
        )}
        {node.expandable && (
          <button type="button" className="btn" data-testid="tool-expand-input" onClick={expandInput}>
            {inputExpanded ? 'hide input' : 'expand input'}
          </button>
        )}
        <span className="tool__outcome" data-outcome={outcome}>
          {outcome === 'pending' ? 'running' : outcome === 'error' ? '✗ error' : '✓ ok'}
        </span>
      </div>
      {failed && <span className="expand-error" data-testid="expand-error">could not load payload</span>}
      {inputExpanded && inputLoaded && (
        <pre className="tool__input">{JSON.stringify(inputBlock)}</pre>
      )}
      {node.result !== null && (
        <>
          <div
            data-error-token={isError ? '' : undefined}
            className="tool__result"
          >
            <ResultBody result={node.result} />
          </div>
          {node.resultAnchor !== null && (
            <button type="button" className="btn" data-testid="tool-expand-result" onClick={expandResult}>
              {resultExpanded ? 'hide result' : 'expand result'}
            </button>
          )}
          {resultExpanded && resultLoaded && resultText !== null && (
            <pre className="tool__spill-full">{resultText}</pre>
          )}
          {resultExpanded && resultLoaded && resultBlock !== null && (
            <pre className="tool__result-full">{JSON.stringify(resultBlock)}</pre>
          )}
        </>
      )}
    </div>
  );
}
