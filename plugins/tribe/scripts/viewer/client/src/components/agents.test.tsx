// client/src/components/agents.test.tsx — subagent tabs, expansion, attachments and raw cards
// (plan Task 25; spec §4, §7.2, §7.3, §7.5, §8.1, D19). Registers a real DOM the same way
// session.test.tsx does — happy-dom must be registered BEFORE `react-dom/client` is evaluated, so
// the import is dynamic, guarded against double-registration because `bun test` runs every file in
// one process.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!(globalThis as { happyDOM?: unknown }).happyDOM) {
  GlobalRegistrator.register({ url: 'http://localhost/' });
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
const { createRoot } = await import('react-dom/client');
import type { MdToken, RenderNode, Agent } from '../../../core/model.ts';
import { AgentTabs, treeOrder } from './AgentTabs.tsx';
import { AssistantCard } from './AssistantCard.tsx';
import { AttachmentStrip, groupAttachments, type AttachmentNode } from './AttachmentStrip.tsx';
import { BlockExpander } from './BlockExpander.tsx';
import { ImageCard } from './ImageCard.tsx';
import { NewBelowPill } from './NewBelowPill.tsx';
import { OrphanResultCard } from './OrphanResultCard.tsx';
import { RawCard } from './RawCard.tsx';
import { ToolCard } from './ToolCard.tsx';
import { UnreadableNote } from './UnreadableNote.tsx';

function renderInto(node: ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

function cleanup(container: HTMLDivElement, root: Root): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

/** Waits for one macrotask, which is always AFTER every microtask a mocked `fetch` chain queues —
 * so this reliably flushes both `await fetch(...)` and `await res.json()`/`.text()` regardless of
 * how many microtask ticks the chain needs, without hard-coding that count. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function clickAndFlush(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
    await flush();
  });
}

// --- a recording, scriptable fake `fetch` --------------------------------------------------
interface FetchCall {
  url: string;
}

function installFetch(handler: (url: string) => Response): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    return handler(url);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

let activeFetch: { calls: FetchCall[]; restore: () => void } | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  activeFetch?.restore();
  activeFetch = null;
});

const BASE = { uuid: null, ts: null, elided: false, expandable: false } as const;
const TEXT = [{ t: 'text', v: 'preview text' } as const];

function toolNode(overrides: Partial<Extract<RenderNode, { k: 'tool' }>> = {}): Extract<RenderNode, { k: 'tool' }> {
  return {
    ...BASE,
    id: '1000:0',
    at: 1000,
    i: 0,
    k: 'tool',
    name: 'Bash',
    input: { cmd: 'ls' },
    state: 'ok',
    toolUseId: 'tu-1',
    agentId: null,
    call: { at: 1000, i: 0 },
    resultAnchor: { at: 2000, i: 0 },
    result: { r: 'text', body: [...TEXT], isError: false, elided: false },
    ...overrides,
  };
}

// --- AgentTabs (spec §8.1) ------------------------------------------------------------------

function agent(id: string, parentId: string | null, depth: number, label: string): Agent {
  return {
    id, parentId, depth, agentType: null, label, toolUseId: null, model: null,
    sizeBytes: 0, mtimeIso: null, birthtimeIso: null, live: false,
  };
}

describe('AgentTabs — tree order, depth indentation, navigation (spec §8.1)', () => {
  test('renders from Agent[] in TREE order (parent before children), not the array order given', () => {
    // deriveAgents sorts by birth time, NOT tree order (core/subagents.ts) — deliberately out of
    // tree order here: root-1's second child appears before its first child, and the grandchild
    // (of the first child) is listed before its own parent.
    const agents: Agent[] = [
      agent('grandchild', 'child-1', 3, 'grandchild'),
      agent('child-2', 'root-1', 2, 'child-2'),
      agent('root-1', null, 1, 'root-1'),
      agent('child-1', 'root-1', 2, 'child-1'),
    ];
    expect(treeOrder(agents).map((a) => a.id)).toEqual(['root-1', 'child-2', 'child-1', 'grandchild']);

    const { container, root } = renderInto(
      <AgentTabs sessionId="sess-1" agents={agents} activeAgentId={null} />,
    );
    const tabs = Array.from(container.querySelectorAll('[data-agent-tab]:not([data-agent-tab=""])'));
    expect(tabs.map((t) => t.getAttribute('data-agent-tab'))).toEqual(['root-1', 'child-2', 'child-1', 'grandchild']);
    // depth indentation: each tab carries its own depth, so a reader (and this test) can tell a
    // grandchild tab from a root tab without parsing computed CSS.
    expect(tabs.map((t) => t.getAttribute('data-depth'))).toEqual(['1', '2', '2', '3']);
    cleanup(container, root);
  });

  test('a tab with a dead parentId reference still renders exactly once (defensive, never dropped)', () => {
    const agents: Agent[] = [agent('orphan', 'no-such-parent', 2, 'orphan')];
    expect(treeOrder(agents).map((a) => a.id)).toEqual(['orphan']);
  });

  test('selecting a tab navigates to /s/<id>/a/<agentId> and calls onSelect (opens a new stream)', () => {
    const agents: Agent[] = [agent('agent-1', null, 1, 'agent-1')];
    const pushes: Array<[unknown, string, unknown]> = [];
    const history = { pushState: (data: unknown, title: string, url?: unknown) => pushes.push([data, title, url]) };
    const selected: Array<string | null> = [];
    const { container, root } = renderInto(
      <AgentTabs
        sessionId="sess-1"
        agents={agents}
        activeAgentId={null}
        onSelect={(id) => selected.push(id)}
        history={history}
      />,
    );
    const tab = container.querySelector('[data-agent-tab="agent-1"]') as HTMLElement;
    act(() => {
      tab.click();
    });
    expect(pushes).toHaveLength(1);
    expect(String(pushes[0]![2])).toBe('/s/sess-1/a/agent-1');
    expect(selected).toEqual(['agent-1']); // the "opens a new stream" signal
    cleanup(container, root);
  });

  test('selecting the "parent" tab navigates to /s/<id> with no agent segment', () => {
    const pushes: string[] = [];
    const history = { pushState: (_d: unknown, _t: string, url?: unknown) => pushes.push(String(url)) };
    const { container, root } = renderInto(
      <AgentTabs sessionId="sess-1" agents={[]} activeAgentId="agent-1" history={history} />,
    );
    const parentTab = container.querySelector('[data-agent-tab=""]') as HTMLElement;
    act(() => {
      parentTab.click();
    });
    expect(pushes).toEqual(['/s/sess-1']);
    cleanup(container, root);
  });
});

// --- ToolCard whose node carries an agentId links to that tab (spec §7.5, §8.1) -------------

describe('ToolCard — a Task tool card with agentId links to that subagent tab', () => {
  test('a tool node with agentId set renders a link that navigates to /s/<id>/a/<agentId>', () => {
    const node = toolNode({ name: 'Task', agentId: 'agent-9', state: 'ok' });
    const pushes: string[] = [];
    const history = { pushState: (_d: unknown, _t: string, url?: unknown) => pushes.push(String(url)) };
    const { container, root } = renderInto(<ToolCard node={node} sessionId="sess-1" history={history} />);
    const link = container.querySelector('[data-agent-link="agent-9"]') as HTMLElement;
    expect(link).not.toBeNull();
    act(() => {
      link.click();
    });
    expect(pushes).toEqual(['/s/sess-1/a/agent-9']);
    cleanup(container, root);
  });

  test('a tool node with agentId: null renders no such link', () => {
    const node = toolNode({ agentId: null });
    const { container, root } = renderInto(<ToolCard node={node} sessionId="sess-1" />);
    expect(container.querySelector('[data-agent-link]')).toBeNull();
    cleanup(container, root);
  });

  test('the subagent link switches the stream via onSelect (not only pushState), so the parent stream is replaced (R14.8)', () => {
    const node = toolNode({ name: 'Task', agentId: 'agent-9', state: 'ok' });
    const pushes: string[] = [];
    const history = { pushState: (_d: unknown, _t: string, url?: unknown) => pushes.push(String(url)) };
    const selected: Array<string | null> = [];
    const { container, root } = renderInto(
      <ToolCard node={node} sessionId="sess-1" history={history} onSelectAgent={(id) => selected.push(id)} />,
    );
    const link = container.querySelector('[data-agent-link="agent-9"]') as HTMLElement;
    act(() => {
      link.click();
    });
    expect(pushes).toEqual(['/s/sess-1/a/agent-9']); // URL still updated
    expect(selected).toEqual(['agent-9']);           // AND the stream-switch signal fired (was missing)
    cleanup(container, root);
  });
});

// --- ToolCard — two expansions, two addresses (D19) ------------------------------------------

describe('ToolCard — two expansions, two addresses (D19)', () => {
  test('the input expands via `call`; the result expands via `resultAnchor` — never each other\'s address', async () => {
    const node = toolNode({ expandable: true, call: { at: 1000, i: 0 }, resultAnchor: { at: 5000, i: 2 } });
    activeFetch = installFetch((url) => {
      if (url.includes('at=1000')) return new Response(JSON.stringify({ block: { input: 'full' } }));
      if (url.includes('at=5000')) return new Response(JSON.stringify({ block: { output: 'full' } }));
      throw new Error(`unexpected fetch: ${url}`);
    });
    const { container, root } = renderInto(<ToolCard node={node} sessionId="sess-1" />);
    expect(activeFetch.calls).toHaveLength(0); // nothing fetched before expand

    const inputBtn = container.querySelector('[data-testid="tool-expand-input"]') as HTMLElement;
    await clickAndFlush(inputBtn);
    expect(activeFetch.calls).toHaveLength(1);
    expect(activeFetch.calls[0]!.url).toContain('at=1000');
    expect(activeFetch.calls[0]!.url).toContain('i=0');
    expect(activeFetch.calls[0]!.url).not.toContain('at=5000');

    const resultBtn = container.querySelector('[data-testid="tool-expand-result"]') as HTMLElement;
    await clickAndFlush(resultBtn);
    expect(activeFetch.calls).toHaveLength(2);
    expect(activeFetch.calls[1]!.url).toContain('at=5000');
    expect(activeFetch.calls[1]!.url).toContain('i=2');
    cleanup(container, root);
  });

  test('a PENDING card (resultAnchor: null) offers no result expansion at all', () => {
    const node = toolNode({ state: 'pending', result: null, resultAnchor: null, expandable: true });
    const { container, root } = renderInto(<ToolCard node={node} sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="tool-expand-result"]')).toBeNull();
    cleanup(container, root);
  });

  test('a spill result fetches /api/spill ONLY on expand, and shows the preview before that', async () => {
    const node = toolNode({
      result: { r: 'spill', name: 'toolresult-1.txt', note: 'persisted output', previewBody: [...TEXT] },
      resultAnchor: { at: 5000, i: 0 },
    });
    activeFetch = installFetch((url) => {
      expect(url).toContain('/api/spill');
      expect(url).toContain('name=toolresult-1.txt');
      return new Response('the full spilled body', { headers: { 'content-type': 'text/plain' } });
    });
    const { container, root } = renderInto(<ToolCard node={node} sessionId="sess-1" />);
    expect(container.textContent).toContain('preview text'); // the preview, shown with no fetch
    expect(activeFetch.calls).toHaveLength(0);

    const resultBtn = container.querySelector('[data-testid="tool-expand-result"]') as HTMLElement;
    await clickAndFlush(resultBtn);
    expect(activeFetch.calls).toHaveLength(1);
    expect(activeFetch.calls[0]!.url).toContain('/api/spill');
    expect(container.textContent).toContain('the full spilled body');
    cleanup(container, root);
  });
});

// --- OrphanResultCard (spec §7.5) ------------------------------------------------------------

describe('OrphanResultCard — expands via resultAnchor, labelled honestly (not an error)', () => {
  function orphanNode(): Extract<RenderNode, { k: 'orphan_result' }> {
    return {
      ...BASE,
      id: '5000:0',
      at: 5000,
      i: 0,
      k: 'orphan_result',
      toolUseId: 'tu-9',
      result: { r: 'text', body: [...TEXT], isError: false, elided: false },
      resultAnchor: { at: 5000, i: 0 },
    };
  }

  test('renders the label "call is above the window" and carries no error-style token', () => {
    const { container, root } = renderInto(<OrphanResultCard node={orphanNode()} sessionId="sess-1" />);
    expect(container.textContent).toContain('call is above the window');
    expect(container.querySelector('[data-error-token]')).toBeNull();
    cleanup(container, root);
  });

  test('fetches /api/block?at=&i= at its OWN resultAnchor, only on expand', async () => {
    const node = orphanNode();
    activeFetch = installFetch((url) => {
      expect(url).toContain(`at=${node.resultAnchor.at}`);
      expect(url).toContain(`i=${node.resultAnchor.i}`);
      return new Response(JSON.stringify({ block: { tool_use_id: 'tu-9' } }));
    });
    const { container, root } = renderInto(<OrphanResultCard node={node} sessionId="sess-1" />);
    expect(activeFetch.calls).toHaveLength(0);
    const btn = container.querySelector('[data-testid="orphan-expand"]') as HTMLElement;
    await clickAndFlush(btn);
    expect(activeFetch.calls).toHaveLength(1);
    cleanup(container, root);
  });
});

// --- ImageCard — lazy fetch at the node's own at+i, never a uuid (spec §7.2) -----------------

describe('ImageCard — fetches /api/block?at=&i= only on expand, addressed by the node\'s own anchor', () => {
  function imageNode(): Extract<RenderNode, { k: 'image' }> {
    // an attachment/image row has no message.content of its own, so `i` is 0 (spec §7.2/§7.3) —
    // and there is no `uuid` field on this node's identity anywhere in the fetch it triggers.
    return { ...BASE, id: '3000:0', at: 3000, i: 0, expandable: true, k: 'image', mediaType: 'image/png', bytes: 6 };
  }

  test('issues ZERO requests before expand', () => {
    const node = imageNode();
    activeFetch = installFetch(() => new Response(JSON.stringify({ block: { source: { media_type: 'image/png', data: 'AAAA' } } })));
    const { container, root } = renderInto(<ImageCard node={node} sessionId="sess-1" />);
    expect(activeFetch.calls).toHaveLength(0);
    expect(container.querySelector('img')).toBeNull();
    cleanup(container, root);
  });

  test('on expand: exactly ONE request, addressed by at=3000&i=0 (never a uuid), then an <img> with a data: src', async () => {
    const node = imageNode();
    activeFetch = installFetch((url) => {
      expect(url).not.toContain('uuid');
      return new Response(JSON.stringify({ block: { source: { media_type: 'image/png', data: 'AAAA' } } }));
    });
    const { container, root } = renderInto(<ImageCard node={node} sessionId="sess-1" agentId={null} />);
    const btn = container.querySelector('[data-testid="image-expand"]') as HTMLElement;
    await clickAndFlush(btn);
    expect(activeFetch.calls).toHaveLength(1);
    expect(activeFetch.calls[0]!.url).toContain('at=3000');
    expect(activeFetch.calls[0]!.url).toContain('i=0');
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    // clicking again does not re-fetch (cached after the first expand)
    const stillNode = container.querySelector('[data-testid="image-expand"]');
    expect(stillNode).toBeNull(); // the button is replaced by the <img> once expanded
    cleanup(container, root);
  });

  // Item A+E (phase-3 audit fix): the error note must reflect only the MOST RECENT attempt — a
  // successful retry must clear a stale "could not load…" note, never leave it stuck forever.
  test('a first expand REJECTS -> expand-error shown; a second attempt RESOLVES -> the note is gone and the <img> shows (Item A+E)', async () => {
    const node = imageNode();
    let attempt = 0;
    activeFetch = installFetch(() => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return new Response(JSON.stringify({ block: { source: { media_type: 'image/png', data: 'BBBB' } } }));
    });
    const { container, root } = renderInto(<ImageCard node={node} sessionId="sess-1" />);
    const btn = () => container.querySelector('[data-testid="image-expand"]') as HTMLElement;

    await clickAndFlush(btn());
    expect(container.querySelector('[data-testid="expand-error"]')).not.toBeNull(); // (a) first attempt failed
    expect(container.querySelector('img')).toBeNull();
    expect(btn()).not.toBeNull(); // still collapsed — the retry affordance is still there

    await clickAndFlush(btn()); // (b) a second attempt — same button, this time it resolves
    expect(container.querySelector('[data-testid="expand-error"]')).toBeNull(); // stale note is GONE
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('data:image/png;base64,BBBB');
    expect(activeFetch.calls).toHaveLength(2); // exactly one request per attempt — never more
    cleanup(container, root);
  });
});

// --- BlockExpander — the shared /api/block affordance (Item A+E, phase-3 audit fix) -----------

describe('BlockExpander — the error note reflects only the MOST RECENT attempt; `loaded` (not the payload) gates refetch', () => {
  test('(a) a first fetch REJECTS -> expand-error shown; (b) a second attempt RESOLVES -> the note is gone and the payload shows', async () => {
    let attempt = 0;
    activeFetch = installFetch(() => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return new Response(JSON.stringify({ block: { full: 'payload after retry' } }));
    });
    const { container, root } = renderInto(<BlockExpander at={70} i={0} sessionId="sess-1" />);
    const btn = container.querySelector('[data-testid="block-expand"]') as HTMLElement;

    await clickAndFlush(btn);
    expect(container.querySelector('[data-testid="expand-error"]')).not.toBeNull(); // (a)
    expect(container.textContent).not.toContain('payload after retry');
    expect(btn.textContent).toBe('expand'); // still collapsed, button unchanged

    await clickAndFlush(btn); // (b) retry — same toggle, still collapsed, this attempt resolves
    expect(container.querySelector('[data-testid="expand-error"]')).toBeNull(); // stale note is GONE
    expect(container.textContent).toContain('payload after retry');
    expect(activeFetch.calls).toHaveLength(2); // one request per attempt
    cleanup(container, root);
  });

  test('(c) a resolved-null payload does not re-issue a fetch on a second expand toggle', async () => {
    activeFetch = installFetch(() => new Response(JSON.stringify({ block: null })));
    const { container, root } = renderInto(<BlockExpander at={80} i={0} sessionId="sess-1" />);
    const btn = container.querySelector('[data-testid="block-expand"]') as HTMLElement;

    await clickAndFlush(btn); // expand: fetches once, resolves to a legitimately-null payload
    expect(activeFetch.calls).toHaveLength(1);
    expect(container.querySelector('[data-testid="expand-error"]')).toBeNull(); // a null payload is NOT a failure

    await clickAndFlush(btn); // collapse
    await clickAndFlush(btn); // expand again — already loaded, must NOT refetch
    expect(activeFetch.calls).toHaveLength(1); // no second request issued
    cleanup(container, root);
  });
});

// --- AttachmentStrip — consecutive attachment nodes collapse into one strip (spec §7.3) -------

function attachmentNode(id: string, at: number, label: string, expandable: boolean): AttachmentNode {
  return { ...BASE, id, at, i: 0, expandable, k: 'attachment', label, detail: null };
}

describe('AttachmentStrip — consecutive attachment nodes collapse into ONE strip', () => {
  test('groupAttachments collapses only the CONSECUTIVE runs, leaving other kinds standalone', () => {
    const prompt: RenderNode = { ...BASE, id: '1:0', at: 1, i: 0, k: 'prompt', body: [...TEXT], chips: [] };
    const assistant: RenderNode = { ...BASE, id: '2:0', at: 2, i: 0, k: 'assistant', body: [...TEXT], model: null };
    const a1 = attachmentNode('10:0', 10, 'file-a.txt', true);
    const a2 = attachmentNode('11:0', 11, 'file-b.txt', true);
    const a3 = attachmentNode('20:0', 20, 'file-c.txt', true);
    const grouped = groupAttachments([prompt, a1, a2, assistant, a3]);
    expect(grouped).toEqual([prompt, [a1, a2], assistant, [a3]]);
  });

  test('each entry expands the same way — fetches /api/block?at=&i= at its OWN anchor, only on expand', async () => {
    const a1 = attachmentNode('10:0', 10, 'file-a.txt', true);
    const a2 = attachmentNode('11:0', 11, 'file-b.txt', true);
    activeFetch = installFetch((url) => {
      expect(url).toContain('at=11');
      return new Response(JSON.stringify({ block: { type: 'attachment' } }));
    });
    const { container, root } = renderInto(<AttachmentStrip nodes={[a1, a2]} sessionId="sess-1" />);
    expect(activeFetch.calls).toHaveLength(0);
    const entries = container.querySelectorAll('[data-testid="attachment-expand"]');
    expect(entries).toHaveLength(2);
    await clickAndFlush(entries[1] as HTMLElement);
    expect(activeFetch.calls).toHaveLength(1);
    cleanup(container, root);
  });

  test('an attachment node with expandable: false renders NO affordance (not one that returns nothing)', () => {
    const a = attachmentNode('30:0', 30, 'just-a-label', false);
    const { container, root } = renderInto(<AttachmentStrip nodes={[a]} sessionId="sess-1" />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('just-a-label');
    cleanup(container, root);
  });
});

// --- RawCard, UnreadableNote, NewBelowPill ----------------------------------------------------

describe('RawCard — collapsed, with the row type visible', () => {
  test('renders the rowType and never the raw json inline', () => {
    const node: Extract<RenderNode, { k: 'raw' }> = {
      ...BASE, id: '40:0', at: 40, i: 0, k: 'raw', rowType: 'summary', json: '{"secret":"nope"}', bytes: 20, text: null,
    };
    const { container, root } = renderInto(<RawCard node={node} />);
    expect(container.textContent).toContain('summary');
    expect(container.textContent).not.toContain('secret');
    cleanup(container, root);
  });

  test('when expandable, an affordance fetches the FULL block at the row\'s own at+i, only on expand (§7.1, R14.6)', async () => {
    const node: Extract<RenderNode, { k: 'raw' }> = {
      ...BASE, id: '40:0', at: 40, i: 0, expandable: true, k: 'raw', rowType: 'summary', json: '{}', bytes: 20, text: null,
    };
    activeFetch = installFetch((url) => {
      expect(url).toContain('at=40');
      expect(url).toContain('i=0');
      return new Response(JSON.stringify({ block: { full: 'expanded-raw' } }));
    });
    const { container, root } = renderInto(<RawCard node={node} sessionId="sess-1" />);
    expect(activeFetch.calls).toHaveLength(0);                       // collapsed by default, no fetch
    const btn = container.querySelector('[data-testid="block-expand"]') as HTMLElement;
    expect(btn).not.toBeNull();
    await clickAndFlush(btn);
    expect(activeFetch.calls).toHaveLength(1);
    expect(container.textContent).toContain('expanded-raw');        // the full block, shown on expand
    cleanup(container, root);
  });

  test('a NON-expandable raw card offers no expand affordance', () => {
    const node: Extract<RenderNode, { k: 'raw' }> = {
      ...BASE, id: '41:0', at: 41, i: 0, expandable: false, k: 'raw', rowType: 'summary', json: '{}', bytes: 20, text: null,
    };
    const { container, root } = renderInto(<RawCard node={node} sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="block-expand"]')).toBeNull();
    cleanup(container, root);
  });
});

describe('body cards expose /api/block expansion when expandable (§7, R14.6)', () => {
  const TOKENS: MdToken[] = [{ t: 'text', v: 'body preview' }];
  test('an EXPANDABLE AssistantCard fetches its full block at at+i on expand; a non-expandable one has no affordance', async () => {
    const expandable: Extract<RenderNode, { k: 'assistant' }> = {
      ...BASE, id: '70:0', at: 70, i: 0, expandable: true, k: 'assistant', body: TOKENS, model: null,
    };
    activeFetch = installFetch((url) => {
      expect(url).toContain('at=70');
      return new Response(JSON.stringify({ block: { text: 'full assistant body' } }));
    });
    const { container, root } = renderInto(<AssistantCard node={expandable} sessionId="sess-1" />);
    const btn = container.querySelector('[data-testid="block-expand"]') as HTMLElement;
    expect(btn).not.toBeNull();
    await clickAndFlush(btn);
    expect(activeFetch.calls).toHaveLength(1);
    expect(container.textContent).toContain('full assistant body');
    cleanup(container, root);

    const plain: Extract<RenderNode, { k: 'assistant' }> = { ...expandable, expandable: false };
    const r2 = renderInto(<AssistantCard node={plain} sessionId="sess-1" />);
    expect(r2.container.querySelector('[data-testid="block-expand"]')).toBeNull();
    cleanup(r2.container, r2.root);
  });
});

describe('UnreadableNote — shows the count', () => {
  test('renders the count of unreadable rows', () => {
    const node: Extract<RenderNode, { k: 'unreadable' }> = { ...BASE, id: '50:0', at: 50, i: 0, k: 'unreadable', count: 4 };
    const { container, root } = renderInto(<UnreadableNote node={node} />);
    expect(container.textContent).toContain('4');
    cleanup(container, root);
  });
});

describe('NewBelowPill — renders the count and fires its click handler', () => {
  test('shows the count and calls onClick', () => {
    let clicked = 0;
    const { container, root } = renderInto(<NewBelowPill count={7} onClick={() => (clicked += 1)} />);
    const pill = container.querySelector('[data-testid="new-below-pill"]') as HTMLElement;
    expect(pill.textContent).toContain('7');
    act(() => {
      pill.click();
    });
    expect(clicked).toBe(1);
    cleanup(container, root);
  });
});
