// client/src/components/session.test.tsx — the session view render contract (spec §4, §7.6, §8.3,
// §12.6). Registers a real DOM the same way list.test.tsx does — and for the same reason: happy-dom
// must be registered BEFORE `react-dom/client` is evaluated, so the import is dynamic (see
// list.test.tsx's header for the full failure this avoids).
import { GlobalRegistrator } from '@happy-dom/global-registrator';
// Guard against double-registration: `bun test` runs every file in one process, and list.test.tsx
// (alphabetically first) may already have registered happy-dom — a second `register()` throws
// "already registered". Register only if no DOM is present yet.
if (!(globalThis as { happyDOM?: unknown }).happyDOM) {
  GlobalRegistrator.register({ url: 'http://localhost/' });
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeEach, describe, expect, test } from 'bun:test';
import { act, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
const { createRoot } = await import('react-dom/client');
import { RENDER_NODE_KINDS, type MdToken, type RenderNode } from '../../../core/model.ts';
import { ChipRow } from './ChipRow.tsx';
import { ErrorCard } from './ErrorCard.tsx';
import { Markdown } from './Markdown.tsx';
import { PromptCard } from './PromptCard.tsx';
import { isAtBottom, RowList } from './RowList.tsx';
import { ToolCard } from './ToolCard.tsx';

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

beforeEach(() => {
  document.body.innerHTML = '';
});

// --- a valid node of every RenderNode kind (§4) --------------------------------------------
const BASE = { uuid: null, ts: null, elided: false, expandable: false } as const;
const TEXT: MdToken[] = [{ t: 'text', v: 'hello world' }];

function nodeOfKind(k: RenderNode['k'], at: number): RenderNode {
  const id = `${at}:0`;
  const anchor = { id, at, i: 0, ...BASE };
  switch (k) {
    case 'prompt': return { ...anchor, k, body: TEXT, chips: [] };
    case 'assistant': return { ...anchor, k, body: TEXT, model: 'claude' };
    case 'thinking': return { ...anchor, k, body: TEXT };
    case 'tool': return { ...anchor, k, name: 'Bash', input: { cmd: 'ls' }, state: 'ok', toolUseId: 'tu-1', agentId: null, call: { at, i: 0 }, resultAnchor: { at, i: 0 }, result: { r: 'text', body: TEXT, isError: false, elided: false } };
    case 'orphan_result': return { ...anchor, k, toolUseId: 'tu-9', resultAnchor: { at, i: 0 }, result: { r: 'text', body: TEXT, isError: false, elided: false } };
    case 'image': return { ...anchor, k, mediaType: 'image/png', bytes: 1024 };
    case 'attachment': return { ...anchor, k, label: 'file.txt', detail: null };
    case 'chip': return { ...anchor, k, label: '/compact', detail: null, href: null };
    case 'divider': return { ...anchor, k, label: 'session start' };
    case 'error': return { ...anchor, k, status: 500, body: TEXT };
    case 'raw': return { ...anchor, k, rowType: 'summary', json: '{"x":1}', bytes: 8, text: null };
    case 'unreadable': return { ...anchor, k, count: 3 };
  }
}

describe('session view — one node per kind, the DOM contract, follow-the-tail', () => {
  test('RowList renders one element per RenderNode kind (§4), each carrying data-kind and data-row-id (§12.6)', () => {
    const kinds = Object.keys(RENDER_NODE_KINDS) as RenderNode['k'][];
    const nodes = kinds.map((k, idx) => nodeOfKind(k, 1000 + idx * 100));
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    for (const k of kinds) {
      const el = container.querySelector(`[data-kind="${k}"]`);
      expect({ kind: k, present: el !== null }).toEqual({ kind: k, present: true });
      expect(el!.getAttribute('data-row-id')).toBeTruthy();
    }
    cleanup(container, root);
  });

  test('the row list carries data-scroll="rows" (§12.6 — the scroll address the DOM proofs use)', () => {
    const { container, root } = renderInto(<RowList nodes={[nodeOfKind('assistant', 1000)]} sessionId="sess-1" agentId={null} />);
    expect(container.querySelector('[data-scroll="rows"]')).not.toBeNull();
    cleanup(container, root);
  });

  test('every rendered row carries data-row-id equal to its RowAnchor.id', () => {
    const nodes = [nodeOfKind('prompt', 1000), nodeOfKind('assistant', 1100)];
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    const rows = Array.from(container.querySelectorAll('[data-row-id]'));
    const ids = rows.map((r) => r.getAttribute('data-row-id'));
    expect(ids).toContain('1000:0');
    expect(ids).toContain('1100:0');
    cleanup(container, root);
  });

  test('a tool card carries data-state="pending|ok|error" (§12.6)', () => {
    for (const state of ['pending', 'ok', 'error'] as const) {
      const n = nodeOfKind('tool', 1000) as Extract<RenderNode, { k: 'tool' }>;
      const node: RenderNode = { ...n, state, result: state === 'pending' ? null : { r: 'text', body: TEXT, isError: state === 'error', elided: false }, resultAnchor: state === 'pending' ? null : { at: 1000, i: 0 } };
      const { container, root } = renderInto(<RowList nodes={[node]} sessionId="sess-1" agentId={null} />);
      expect(container.querySelector('[data-kind="tool"]')!.getAttribute('data-state')).toBe(state);
      cleanup(container, root);
    }
  });

  test('a tool node renders its result attached to the call; an error result renders with the error token', () => {
    const okTool = nodeOfKind('tool', 1000) as Extract<RenderNode, { k: 'tool' }>;
    const { container, root } = renderInto(<ToolCard node={okTool} />);
    expect(container.textContent).toContain('Bash');       // the call
    expect(container.textContent).toContain('hello world'); // the result attached to it
    cleanup(container, root);

    const errTool: RenderNode = { ...okTool, state: 'error', result: { r: 'text', body: TEXT, isError: true, elided: false } };
    const r2 = renderInto(<ToolCard node={errTool as Extract<RenderNode, { k: 'tool' }>} />);
    expect(r2.container.querySelector('[data-error-token]')).not.toBeNull();
    cleanup(r2.container, r2.root);
  });

  test('an ErrorCard renders with the error token and its status (spec §4)', () => {
    const err = nodeOfKind('error', 1000) as Extract<RenderNode, { k: 'error' }>;
    const { container, root } = renderInto(<ErrorCard node={err} />);
    expect(container.querySelector('[data-error-token]')).not.toBeNull();
    expect(container.textContent).toContain('500');
    cleanup(container, root);
  });

  // --- chips (§7.6): the four kinds, and a null detail renders no detail line ---------------
  test('a prompt with chips: Chip[] renders one element per chip, its kind as a data attribute (§7.6)', () => {
    const prompt = nodeOfKind('prompt', 1000) as Extract<RenderNode, { k: 'prompt' }>;
    const withChips: RenderNode = {
      ...prompt,
      chips: [
        { kind: 'slash-command', label: '/compact', detail: 'now', anchor: { at: 1000, i: 0 } },
        { kind: 'system-reminder', label: 'be brief', detail: null, anchor: { at: 1000, i: 0 } },
        { kind: 'local-command', label: 'ls', detail: 'a\nb', anchor: { at: 1000, i: 0 } },
        { kind: 'ide-context', label: 'App.tsx', detail: 'open', anchor: { at: 1000, i: 0 } },
      ],
    };
    const { container, root } = renderInto(<PromptCard node={withChips as Extract<RenderNode, { k: 'prompt' }>} />);
    const chipEls = Array.from(container.querySelectorAll('[data-chip-kind]'));
    expect(chipEls.map((e) => e.getAttribute('data-chip-kind'))).toEqual([
      'slash-command', 'system-reminder', 'local-command', 'ide-context',
    ]);
    cleanup(container, root);
  });

  test('a chip with detail: null renders no detail line; a chip with detail renders one', () => {
    const withDetail = renderInto(<ChipRow node={nodeOfKind('chip', 1000) as Extract<RenderNode, { k: 'chip' }>} />);
    // the base `chip` node has detail: null
    expect(withDetail.container.querySelector('[data-chip-detail]')).toBeNull();
    cleanup(withDetail.container, withDetail.root);

    const chip = nodeOfKind('chip', 1000) as Extract<RenderNode, { k: 'chip' }>;
    const detailed: RenderNode = { ...chip, detail: 'the args' };
    const r2 = renderInto(<ChipRow node={detailed as Extract<RenderNode, { k: 'chip' }>} />);
    expect(r2.container.querySelector('[data-chip-detail]')).not.toBeNull();
    expect(r2.container.textContent).toContain('the args');
    cleanup(r2.container, r2.root);
  });

  // --- Markdown maps MdToken[] to elements, NO HTML string anywhere (client wall) -----------
  test('Markdown maps MdToken[] to real elements — heading, fenced code, link, strong', () => {
    const tokens: MdToken[] = [
      { t: 'heading', level: 2, c: [{ t: 'text', v: 'Title' }] },
      { t: 'code', v: 'const x = 1;', lang: 'ts' },
      { t: 'link', href: 'https://example.com/a', c: [{ t: 'text', v: 'a link' }] },
      { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
      { t: 'inline-code', v: 'y' },
    ];
    const { container, root } = renderInto(<Markdown tokens={tokens} />);
    expect(container.querySelector('h2')?.textContent).toBe('Title');
    expect(container.querySelector('pre code')?.textContent).toBe('const x = 1;');
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com/a');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')).not.toBeNull();
    cleanup(container, root);
  });

  test('Markdown does not render a javascript: link href (fail-closed href gate)', () => {
    const tokens: MdToken[] = [{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'x' }] }];
    const { container, root } = renderInto(<Markdown tokens={tokens} />);
    const a = container.querySelector('a');
    // the label still renders; the dangerous href is dropped, never emitted as an attribute.
    expect(container.textContent).toContain('x');
    expect(a?.getAttribute('href') ?? null).toBeNull();
    cleanup(container, root);
  });

  // --- follow-the-tail (§8.3): the scroll number, not a screenshot -------------------------
  test('isAtBottom is exactly (scrollHeight - scrollTop - clientHeight) <= 32', () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 968, clientHeight: 0 })).toBe(true);  // delta 32
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 967, clientHeight: 0 })).toBe(false); // delta 33
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 1000, clientHeight: 0 })).toBe(true);
  });

  function mockGeom(el: Element, scrollHeight: number): void {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 0 });
  }

  test('follow-the-tail scrolls to the new bottom on new rows while within the 32-pixel band', () => {
    const nodes = [nodeOfKind('assistant', 1000)];
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    const el = container.querySelector('[data-scroll="rows"]') as HTMLElement;
    mockGeom(el, 1000);
    const before = el.scrollTop;
    act(() => {
      root.render(<RowList nodes={[...nodes, nodeOfKind('assistant', 1100)]} sessionId="sess-1" agentId={null} />);
    });
    expect(el.scrollTop).toBeGreaterThan(before); // the viewport moved to the new bottom
    cleanup(container, root);
  });

  test('follow-the-tail does NOT scroll when the user is outside the band, and shows the follow pill', () => {
    const nodes = [nodeOfKind('assistant', 1000)];
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    const el = container.querySelector('[data-scroll="rows"]') as HTMLElement;
    mockGeom(el, 1000);
    // the user scrolls up out of the band
    act(() => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    expect(container.querySelector('[data-testid="follow-pill"]')).not.toBeNull();
    const frozen = el.scrollTop;
    act(() => {
      root.render(<RowList nodes={[...nodes, nodeOfKind('assistant', 1100)]} sessionId="sess-1" agentId={null} />);
    });
    expect(el.scrollTop).toBe(frozen); // new rows arrived, viewport did NOT move
    cleanup(container, root);
  });

  test('clicking the follow pill resumes following and returns to the bottom', () => {
    const nodes = [nodeOfKind('assistant', 1000)];
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    const el = container.querySelector('[data-scroll="rows"]') as HTMLElement;
    mockGeom(el, 1000);
    act(() => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    const pill = container.querySelector('[data-testid="follow-pill"]') as HTMLElement;
    expect(pill).not.toBeNull();
    act(() => {
      pill.click();
    });
    expect(el.scrollTop).toBeGreaterThan(100);                                   // returned to the bottom
    expect(container.querySelector('[data-testid="follow-pill"]')).toBeNull();   // pill gone, following again
    cleanup(container, root);
  });
});
