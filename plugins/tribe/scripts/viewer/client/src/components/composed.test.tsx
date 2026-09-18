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
import { RENDER_NODE_KINDS, type MdToken, type Project, type RenderNode, type SessionSummary } from '../../../core/model.ts';
import { App } from '../App.tsx';
import { RowList } from './RowList.tsx';
import { shortSessionId } from './SessionRow.tsx';

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

async function clickAndFlush(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
    await flush();
  });
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

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'a1b2c3d4e5f6789000000000',
    projectDir: '-Users-hip-repo-tribe',
    title: 'a session',
    titleSource: 'ai-title',
    sizeBytes: 2048,
    mtimeIso: '2026-09-13T08:00:00.000Z',
    live: false,
    subagentCount: 0,
    badges: [],
    projects: ['-Users-hip-repo-tribe'],
    ...overrides,
  };
}

// A valid RenderNode of every kind (§4) — the same construction session.test.tsx uses.
const BASE = { uuid: null, ts: null, elided: false, expandable: false } as const;
const TEXT: MdToken[] = [{ t: 'text', v: 'hello world' }];

function attachmentNode(id: string, at: number, label: string): Extract<RenderNode, { k: 'attachment' }> {
  return { ...BASE, id, at, i: 0, k: 'attachment', label, detail: null };
}

/** A plain assistant node as the wire delivers it (a `rows` frame payload). */
function assistantWire(at: number): RenderNode {
  return { ...BASE, id: `${at}:0`, at, i: 0, k: 'assistant', body: TEXT, model: null };
}

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
      if (url.includes('/api/sessions')) {
        return new Response(JSON.stringify({ project: makeProject(), sessions: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      for (let i = 0; i < 6; i++) await flush();
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
      es.emit('hello', { generation: 'g1', session: makeSession({ id: 'sess-1', live: false }), agents: [], badges: [], from: 1000, to: 1100, truncatedBefore: false });
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

describe('the "/" list route aggregates in-window sessions across every project (spec §8.1 — <SessionList> on route /)', () => {
  test('the rendered .session-row id SET equals the union of every in-window project\'s sessions (both directions)', async () => {
    window.history.pushState(null, '', '/');
    const p1 = makeProject({ dir: '-proj-a', cwd: '/proj/a' });
    const p2 = makeProject({ dir: '-proj-b', cwd: '/proj/b' });
    const s1 = makeSession({ id: 'aaaaaaaa11111111', projectDir: '-proj-a', title: 'A-one' });
    const s2 = makeSession({ id: 'bbbbbbbb22222222', projectDir: '-proj-a', title: 'A-two' });
    const s3 = makeSession({ id: 'cccccccc33333333', projectDir: '-proj-b', title: 'B-one' });
    const fetched = installFetch((url) => {
      if (url.includes('/api/projects')) {
        return new Response(JSON.stringify({ projects: [p1, p2], olderCount: 0, skippedBadges: 0 }));
      }
      if (url.includes('project=-proj-a')) return new Response(JSON.stringify({ project: p1, sessions: [s1, s2] }));
      if (url.includes('project=-proj-b')) return new Response(JSON.stringify({ project: p2, sessions: [s3] }));
      throw new Error(`unexpected fetch: ${url}`);
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      // projects resolve → aggregate fetches fire → sessions resolve; a handful of macrotasks
      // covers the two-stage fetch chain regardless of exact tick count.
      for (let i = 0; i < 6; i++) await flush();
    });
    const renderedShortIds = Array.from(container.querySelectorAll('.session-row .session-row__id')).map((e) => e.textContent);
    const expectedShortIds = [s1, s2, s3].map((s) => shortSessionId(s.id));
    expect(new Set(renderedShortIds)).toEqual(new Set(expectedShortIds)); // set equality: no missing id, no extra id
    expect(renderedShortIds.length).toBe(3);                              // and no duplicates rendered
    // the sidebar's project list is present alongside the aggregated session list
    expect(container.querySelectorAll('.project-row').length).toBe(2);
    cleanup(container, root);
  });
});

describe('session routes mount the §8.1 composed shell around SessionView (FIX R14.1)', () => {
  test('at "/s/<id>" the session view is mounted INSIDE the shell WITH the Sidebar (not a bare SessionView)', async () => {
    window.history.pushState(null, '', '/s/sess-3');
    installEventSource();
    const fetched = installFetch((url) => {
      if (url.includes('/api/projects')) {
        return new Response(JSON.stringify({ projects: [makeProject()], olderCount: 0, skippedBadges: 0 }));
      }
      return new Response('{}');
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    const es = FakeEventSource.instances[0]!;
    await act(async () => {
      es.emit('open');
      es.emit('hello', { generation: 'g1', session: makeSession({ id: 'sess-3', title: 'Composed session' }), agents: [], badges: [], from: 1000, to: 1100, truncatedBefore: false });
      es.emit('rows', { nodes: [nodeOfKind('assistant', 1000)], from: 1000, to: 1100 });
      for (let i = 0; i < 4; i++) await flush();
    });
    expect(container.querySelector('.app-shell')).not.toBeNull();   // the two-column shell frame
    expect(container.querySelector('.sidebar')).not.toBeNull();     // Sidebar around the session view
    expect(container.querySelector('.session-view')).not.toBeNull();// SessionView inside Main
    expect(container.querySelector('.project-row')).not.toBeNull(); // the sidebar's project list rendered
    expect(FakeEventSource.instances).toHaveLength(1);              // still exactly one stream
    cleanup(container, root);
  });
});

describe('the "/" root list — allSettled union, newest-first sort, campaign pre-fill (FIX R14.2)', () => {
  test('one FAILED project fetch does not blank the list — successful projects still render, with a degraded note', async () => {
    window.history.pushState(null, '', '/');
    const pOk = makeProject({ dir: '-proj-ok', cwd: '/ok' });
    const pBad = makeProject({ dir: '-proj-bad', cwd: '/bad' });
    const sOk = makeSession({ id: 'okokokok11110000', projectDir: '-proj-ok' });
    const fetched = installFetch((url) => {
      if (url.includes('/api/projects')) return new Response(JSON.stringify({ projects: [pOk, pBad], olderCount: 0, skippedBadges: 0 }));
      if (url.includes('project=-proj-ok')) return new Response(JSON.stringify({ project: pOk, sessions: [sOk] }));
      if (url.includes('project=-proj-bad')) return new Response('boom', { status: 500 });
      throw new Error(`unexpected fetch: ${url}`);
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      for (let i = 0; i < 6; i++) await flush();
    });
    expect(container.querySelectorAll('.session-row').length).toBe(1);               // the good project still renders
    expect(container.querySelector('[data-testid="degraded-note"]')).not.toBeNull(); // the failure is reported, not a blank page
    cleanup(container, root);
  });

  test('the union is sorted NEWEST-FIRST by mtimeIso across projects (§5.3 ordering)', async () => {
    window.history.pushState(null, '', '/');
    const pa = makeProject({ dir: '-proj-a' });
    const pb = makeProject({ dir: '-proj-b' });
    const older = makeSession({ id: 'aaaaaaaa11110000', projectDir: '-proj-a', mtimeIso: '2026-09-10T00:00:00.000Z', title: 'older' });
    const newer = makeSession({ id: 'bbbbbbbb22220000', projectDir: '-proj-b', mtimeIso: '2026-09-13T00:00:00.000Z', title: 'newer' });
    const fetched = installFetch((url) => {
      if (url.includes('/api/projects')) return new Response(JSON.stringify({ projects: [pa, pb], olderCount: 0, skippedBadges: 0 }));
      if (url.includes('project=-proj-a')) return new Response(JSON.stringify({ project: pa, sessions: [older] }));
      if (url.includes('project=-proj-b')) return new Response(JSON.stringify({ project: pb, sessions: [newer] }));
      throw new Error(`unexpected fetch: ${url}`);
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      for (let i = 0; i < 6; i++) await flush();
    });
    const ids = Array.from(container.querySelectorAll('.session-row .session-row__id')).map((e) => e.textContent);
    expect(ids).toEqual([shortSessionId(newer.id), shortSessionId(older.id)]); // newest first, across projects
    cleanup(container, root);
  });

  test('?campaign=<repoKey>/<slug> PRE-FILLS the filter on load and narrows the list with no badge click (§3.2 GET /)', async () => {
    const repoKey = '-Users-hip-repo-tribe';
    window.history.pushState(null, '', `/?campaign=${encodeURIComponent(repoKey)}/mycamp`);
    const pa = makeProject({ dir: '-proj-a', cwd: '/proj/a' });
    const withBadge = makeSession({ id: 'matchmatch1111', projectDir: '-proj-a', title: 'has-badge', badges: [{ repoKey, slug: 'mycamp', cardId: 'c', cardStatus: 'x', runnerAlive: true, runId: null }] });
    const without = makeSession({ id: 'otherother2222', projectDir: '-proj-a', title: 'no-badge', badges: [] });
    const fetched = installFetch((url) => {
      if (url.includes('/api/projects')) return new Response(JSON.stringify({ projects: [pa], olderCount: 0, skippedBadges: 0 }));
      if (url.includes('/api/sessions')) return new Response(JSON.stringify({ project: pa, sessions: [withBadge, without] }));
      throw new Error(`unexpected fetch: ${url}`);
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      for (let i = 0; i < 6; i++) await flush();
    });
    const input = container.querySelector('.campaign-filter') as HTMLInputElement;
    expect(input.value).toBe(`${repoKey}/mycamp`);                    // pre-filled on load, not only on click
    const ids = Array.from(container.querySelectorAll('.session-row .session-row__id')).map((e) => e.textContent);
    expect(ids).toEqual([shortSessionId(withBadge.id)]);              // narrowed to the badge-carrying session
    cleanup(container, root);
  });
});

describe('consecutive attachments collapse into ONE strip through RowList (spec §8.1 — <AttachmentStrip> consecutive k=attachment)', () => {
  test('three consecutive attachment nodes render as exactly ONE .attachment-strip, still addressable via data-kind="attachment"', () => {
    const nodes = [attachmentNode('10:0', 10, 'a.txt'), attachmentNode('11:0', 11, 'b.txt'), attachmentNode('12:0', 12, 'c.txt')];
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    expect(container.querySelectorAll('.attachment-strip').length).toBe(1); // the run collapsed into one strip
    const row = container.querySelector('[data-kind="attachment"]');
    expect(row).not.toBeNull();                                             // §16.2 coverage address preserved
    expect(row!.getAttribute('data-row-id')).toBe('10:0');                  // the run's first node id
    expect(row!.querySelector('.attachment-strip')).not.toBeNull();
    // all three entries live inside the single strip
    expect(container.querySelectorAll('[data-attachment-label]').length).toBe(3);
    cleanup(container, root);
  });

  test('a non-attachment node between two attachments splits them into TWO strips', () => {
    const nodes = [attachmentNode('10:0', 10, 'a.txt'), nodeOfKind('assistant', 20), attachmentNode('30:0', 30, 'c.txt')];
    const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);
    expect(container.querySelectorAll('.attachment-strip').length).toBe(2); // not collapsed across the assistant row
    expect(container.querySelector('[data-kind="assistant"]')).not.toBeNull();
    cleanup(container, root);
  });
});

describe('SessionHeader is fed by the hello frame (FIX 2 — §5.2/§8.1)', () => {
  test('at "/s/<id>" the header renders the hello session\'s title and the §5.2 "found in N projects" collision warning', async () => {
    window.history.pushState(null, '', '/s/sess-2');
    installEventSource();
    const fetched = installFetch(() => new Response('{}'));
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    const es = FakeEventSource.instances[0]!;
    await act(async () => {
      es.emit('open');
      es.emit('hello', {
        generation: 'g1',
        session: makeSession({ id: 'sess-2', title: 'Fix the flaky poller', projects: ['-a', '-b', '-c'] }),
        agents: [],
        badges: [],
        from: 1000,
        to: 1100,
        truncatedBefore: false,
      });
      es.emit('rows', { nodes: [nodeOfKind('assistant', 1000)], from: 1000, to: 1100 });
      await flush();
    });
    expect(container.textContent).toContain('Fix the flaky poller');  // title from the hello SessionSummary (was null)
    expect(container.textContent).toContain('found in 3 projects');   // §5.2 collision warning, never silently one
    cleanup(container, root);
  });
});

describe('the browser fetch edge fails closed (FIX 4 — fail-closed-edges.md applied to the client)', () => {
  test('at "/" a rejected fetchProjects renders a visible error note, not a blank pane (and no unhandled rejection)', async () => {
    window.history.pushState(null, '', '/');
    const fetched = installFetch(() => {
      throw new Error('server said 500');
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      for (let i = 0; i < 4; i++) await flush();
    });
    const note = container.querySelector('[data-testid="load-error"]');
    expect(note).not.toBeNull();                                   // a visible refusal, never a blank pane
    expect((container.textContent ?? '').length).toBeGreaterThan(0);
    cleanup(container, root);
  });

  test('at "/" a RESOLVED non-2xx response fails closed — a visible note, never projects.map on an error body (R15.1)', async () => {
    // The gap the existing test above misses: the fetch RESOLVES (a 500 with a JSON body), so the
    // old `(await res.json()) as ProjectsResponse` cast let `{error}` through and `projects.map`
    // threw later. The typed boundary must reject on the non-2xx status instead.
    window.history.pushState(null, '', '/');
    const fetched = installFetch(() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      for (let i = 0; i < 4; i++) await flush();
    });
    expect(container.querySelector('[data-testid="load-error"]')).not.toBeNull();
    cleanup(container, root);
  });

  test('at "/s/<id>" a rejected fetchProjects is STILL visible in the sidebar — a session route is not silent about it (Item D)', async () => {
    // Before the fix, `projectsError` was rendered only in the non-session branch of `<main>`, so a
    // sidebar projects-fetch failure on a SESSION route was silently swallowed — the sidebar just
    // showed an empty project list with no indication anything failed.
    window.history.pushState(null, '', '/s/sess-degraded');
    installEventSource();
    const fetched = installFetch((url) => {
      if (url.includes('/api/projects')) throw new Error('server said 500');
      return new Response('{}');
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    await act(async () => {
      for (let i = 0; i < 4; i++) await flush();
    });
    expect(container.querySelector('.sidebar')).not.toBeNull();           // still the composed shell
    expect(container.querySelector('.session-view')).not.toBeNull();      // session route mounted
    expect(container.querySelector('[data-testid="sidebar-projects-error"]')).not.toBeNull(); // visible in the sidebar
    cleanup(container, root);
  });
});

describe('NewBelowPill is wired to §6.3 (FIX 3)', () => {
  test('newBelow>0 renders the pill; clicking it reloads the tail window via /api/rows (reloadTail seam)', async () => {
    window.history.pushState(null, '', '/s/sess-6');
    installEventSource();
    const rowsCalls: string[] = [];
    const fetched = installFetch((url) => {
      if (url.includes('/api/rows')) {
        rowsCalls.push(url);
        if (url.includes('before=')) {
          // loadEarlier back-fill: one earlier node so the window tips past the 2,000 cap → follow off
          return new Response(JSON.stringify({ nodes: [assistantWire(999)], patches: [], from: 999, to: 1000, truncatedBefore: false }));
        }
        // reloadTail: a fresh tail window (no `before`)
        return new Response(JSON.stringify({ nodes: [assistantWire(9000)], patches: [], from: 9000, to: 9100, truncatedBefore: false }));
      }
      return new Response('{}');
    });
    restoreFetch = fetched.restore;
    const { container, root } = renderInto(<App />);
    const es = FakeEventSource.instances[0]!;
    const many = Array.from({ length: 2000 }, (_, i) => assistantWire(1000 + i));
    await act(async () => {
      es.emit('open');
      es.emit('hello', { generation: 'g1', session: makeSession({ id: 'sess-6' }), agents: [], badges: [], from: 1000, to: 2999, truncatedBefore: true });
      es.emit('rows', { nodes: many, from: 1000, to: 2999 });
      await flush();
    });
    // truncatedBefore → LoadEarlier shows; clicking pushes past the cap and turns follow-live off (§6.3)
    const loadEarlier = container.querySelector('[data-testid="load-earlier"]') as HTMLElement;
    expect(loadEarlier).not.toBeNull();
    await clickAndFlush(loadEarlier);
    // a new live rows frame is now COUNTED, not appended (§6.3), so newBelow becomes > 0
    await act(async () => {
      es.emit('rows', { nodes: [assistantWire(4000)], from: 4000, to: 4100 });
      await flush();
    });
    const pill = container.querySelector('[data-testid="new-below-pill"]') as HTMLElement;
    expect(pill).not.toBeNull();                 // the pill is wired and visible (was imported by nothing)
    expect(pill.textContent).toContain('1');     // "1 new below"
    rowsCalls.length = 0;
    await clickAndFlush(pill);
    // reloadTail fetched the tail window — a /api/rows request with NO `before` (distinct from loadEarlier)
    expect(rowsCalls.some((u) => u.includes('/api/rows') && !u.includes('before='))).toBe(true);
    cleanup(container, root);
  });
});
