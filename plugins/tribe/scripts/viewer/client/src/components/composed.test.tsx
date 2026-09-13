// client/src/components/composed.test.tsx — the ASSEMBLED client, exercised through the COMPOSED
// tree a real browser lands on, not the isolated single-component renders of list.test.tsx /
// session.test.tsx / agents.test.tsx (`fixtures-mirror-reality.md`: the convenient isolated
// construction is not the shape a user hits). This is the proof the phase-3 audit found missing:
// App never rendered anything it built, RowList dispatched only 7 of 12 kinds to their real
// components, and sessionId/agentId were never threaded down. Each block below mounts the real
// composition (`<App/>` on a route, or `<RowList/>` with every kind) and asserts the REAL child
// component is what mounts — never a placeholder shell.
//
// happy-dom must be registered BEFORE `react-dom/client` is evaluated, and the import is therefore
// dynamic — see list.test.tsx's header for the full failure this avoids. Guarded against
// double-registration because `bun test` runs every file in one process.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!(globalThis as { happyDOM?: unknown }).happyDOM) {
  GlobalRegistrator.register({ url: 'http://localhost/' });
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
const { createRoot } = await import('react-dom/client');
import { RENDER_NODE_KINDS, type MdToken, type Project, type RenderNode } from '../../../core/model.ts';
import { App } from '../App.tsx';
import { RowList } from './RowList.tsx';

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

/** One macrotask — after every microtask a mocked `fetch` chain queues, so it flushes both
 * `await fetch(...)` and `await res.json()` regardless of tick count (same helper agents.test.tsx
 * uses). */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// --- a recording, scriptable fake `fetch` (the api.ts seam performs the real one) ------------
function installFetch(handler: (url: string) => Response): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// --- a fake EventSource so the COMPOSED session view can be driven with real frames ----------
// useEventStream supplies the global `EventSource` as its injected constructor, so replacing the
// global lets the assembled App → SessionView → useEventStream → RowList tree run against scripted
// `hello`/`rows` frames with no live server.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data?: unknown): void {
    const ev = { data: data === undefined ? '' : JSON.stringify(data), lastEventId: '' };
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
}

let restoreFetch: (() => void) | null = null;
let restoreEventSource: (() => void) | null = null;

function installEventSource(): void {
  const original = (globalThis as { EventSource?: unknown }).EventSource;
  FakeEventSource.instances = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  restoreEventSource = () => {
    (globalThis as { EventSource?: unknown }).EventSource = original;
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState(null, '', '/');
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  restoreEventSource?.();
  restoreEventSource = null;
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    dir: '-Users-hip-repo-tribe',
    cwd: '/Users/hip/repo/tribe',
    sessionCount: 3,
    newestMtimeIso: '2026-09-12T10:00:00.000Z',
    live: false,
    ...overrides,
  };
}

// A valid RenderNode of every kind (§4) — the same construction session.test.tsx uses.
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

describe('the ASSEMBLED client — App routes to real composed views (B1, B4)', () => {
  test('at "/" App mounts the list view with REAL project rows from fetched data — not the old "route: list" shell', async () => {
    window.history.pushState(null, '', '/');
    const fetched = installFetch((url) => {
      if (url.includes('/api/projects')) {
        return new Response(JSON.stringify({ projects: [makeProject()], olderCount: 0, skippedBadges: 0 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      await flush();
    });
    // the real ProjectList mounts one .project-row per project, with the real cwd label
    expect(container.querySelector('.project-row')).not.toBeNull();
    expect(container.textContent).toContain('/Users/hip/repo/tribe');
    // and the dead scaffold is gone — App no longer renders only the route label
    expect(container.textContent).not.toContain('route: list');
    cleanup(container, root);
  });

  test('at "/s/<id>" App mounts the session view through the composed tree and a REAL card renders from stream rows (B1, B3)', async () => {
    window.history.pushState(null, '', '/s/sess-1');
    installEventSource();
    const fetched = installFetch(() => new Response('{}'));
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    // the composed SessionView opened exactly one stream via useEventStream
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toContain('session=sess-1');

    await act(async () => {
      es.emit('open');
      es.emit('hello', { generation: 'g1', session: { live: false }, agents: [], badges: [], from: 1000, to: 1100, truncatedBefore: false });
      es.emit('rows', { nodes: [nodeOfKind('assistant', 1000)], from: 1000, to: 1100 });
      await flush();
    });

    const card = container.querySelector('[data-kind="assistant"]');
    expect(card).not.toBeNull();
    expect(container.textContent).toContain('hello world');
    expect(container.textContent).not.toContain('route: session');
    cleanup(container, root);
  });
});

describe('per-kind coverage THROUGH the composed RowList — every kind dispatches to its REAL component (B2, B3)', () => {
  // The distinguishing markers below only appear when the REAL dedicated component mounts; the
  // pre-fix placeholder `<span className="...">`s carried none of them. This is the proof B2 was
  // missing: kind coverage alone (a [data-kind] wrapper) stayed green while five kinds rendered
  // dead shells.
  const REAL_COMPONENT_MARKER: Record<RenderNode['k'], (row: Element) => Element | null> = {
    prompt: (r) => r.querySelector('.prompt, [data-chip-kind], .prompt-card') ?? r.querySelector('div'),
    assistant: (r) => r.querySelector('.assistant, .assistant-card') ?? r.querySelector('div'),
    thinking: (r) => r.querySelector('.thinking, .thinking-card') ?? r.querySelector('div'),
    tool: (r) => r.querySelector('.tool'),
    chip: (r) => r.querySelector('.chip-row, [data-chip-kind]') ?? r.querySelector('div'),
    divider: (r) => r.querySelector('.divider') ?? r.querySelector('div'),
    error: (r) => r.querySelector('[data-error-token]'),
    // the five formerly-placeholder kinds — each marker is emitted ONLY by its real component:
    orphan_result: (r) => r.querySelector('[data-testid="orphan-expand"]'),
    image: (r) => r.querySelector('[data-testid="image-expand"]'),
    attachment: (r) => r.querySelector('.attachment-strip'),
    raw: (r) => r.querySelector('.raw__type'),
    unreadable: (r) => r.querySelector('div.unreadable'),
  };

  test('each of the 12 kinds mounts its real dedicated component (not an inline placeholder span)', () => {
    const kinds = Object.keys(RENDER_NODE_KINDS) as RenderNode['k'][];
    const nodes = kinds.map((k, idx) => nodeOfKind(k, 1000 + idx * 100));
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    for (const k of kinds) {
      const row = container.querySelector(`[data-kind="${k}"]`);
      expect({ kind: k, rowPresent: row !== null }).toEqual({ kind: k, rowPresent: true });
      const marker = REAL_COMPONENT_MARKER[k](row!);
      expect({ kind: k, realComponentMounted: marker !== null }).toEqual({ kind: k, realComponentMounted: true });
    }
    cleanup(container, root);
  });

  test('the `image` kind mounts the real ImageCard (its expand affordance), never an inline <span className="image">', () => {
    const { container, root } = renderInto(<RowList nodes={[nodeOfKind('image', 3000)]} sessionId="sess-1" agentId={null} />);
    const row = container.querySelector('[data-kind="image"]')!;
    expect(row.querySelector('[data-testid="image-expand"]')).not.toBeNull(); // real ImageCard
    expect(row.querySelector('span.image')).toBeNull();                        // not the dead shell
    cleanup(container, root);
  });

  test('the `raw` kind mounts the real RawCard (.raw__type), never an inline <span className="raw">', () => {
    const { container, root } = renderInto(<RowList nodes={[nodeOfKind('raw', 4000)]} sessionId="sess-1" agentId={null} />);
    const row = container.querySelector('[data-kind="raw"]')!;
    expect(row.querySelector('.raw__type')).not.toBeNull();
    expect(row.querySelector('span.raw')).toBeNull();
    cleanup(container, root);
  });
});
