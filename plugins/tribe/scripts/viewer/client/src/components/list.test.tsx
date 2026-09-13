// client/src/components/list.test.tsx — the list view (plan Task 23, Step 1). Registers a real
// DOM (`@happy-dom/global-registrator`) so these are genuine render + click assertions, not a
// snapshot of JSX. Must be the very first thing this file does — and `react-dom/client` must be
// loaded AFTER it, via a dynamic `import()` rather than a static one.
//
// Why dynamic: ES module `import` DECLARATIONS are hoisted above every other statement in the
// file, so a static `import { createRoot } from 'react-dom/client'` above or below the
// registration call is evaluated first regardless of source order. `react-dom` computes its
// `canUseDOM`/`isInputEventSupported` feature detection ONCE, at that first module evaluation —
// with no `window`/`document` yet, it freezes `isInputEventSupported = false` for the rest of the
// process, silently routing every text-input change through a focus-tracking IE11 polyfill path
// instead of the real one. The symptom is exactly a false negative: `onClick` and `onInput` fire
// (they do not depend on this flag), but a controlled `<input>`'s `onChange` never does — no
// error, no warning, just a "does not narrow" test that would be wrong about the component. A
// dynamic `import()` is a runtime expression, not a hoisted declaration, so it runs exactly where
// it is written: after registration, with a real DOM already in place. Verified by reproducing
// the failure with a static import first (`onChange` silently never fires) and confirming this
// dynamic form fixes it, before writing a single test below.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeEach, describe, expect, test } from 'bun:test';
import { act, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
const { createRoot } = await import('react-dom/client');
import type { Badge, Project, SessionSummary } from '../../../core/model.ts';
import { fetchProjects, fetchSession, fetchSessions } from '../api.ts';
import { CampaignBadge } from './CampaignBadge.tsx';
import { CampaignFilter } from './CampaignFilter.tsx';
import { LiveDot } from './LiveDot.tsx';
import { ProjectList } from './ProjectList.tsx';
import { filterSessionsByCampaign, SessionList } from './SessionList.tsx';
import { formatRelativeAge, formatSize, SessionRow, shortSessionId } from './SessionRow.tsx';
import { ShowOlderProjects } from './ShowOlderProjects.tsx';
import { Sidebar } from './Sidebar.tsx';

// ---------------------------------------------------------------------------------------------
// Render harness: one fresh container per test, mounted with `act` so effects/events flush
// before the assertion. `cleanup` unmounts and detaches the node so one test's tree never leaks
// into the next test's `document.body` query.
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
  // Every test starts from a clean address bar — the campaign-badge click test is the one that
  // mutates it, and a leaked `?campaign=` from a prior test must never bleed into the next.
  window.history.pushState(null, '', '/');
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

function makeBadge(overrides: Partial<Badge> = {}): Badge {
  return {
    repoKey: '-Users-hip-repo-tribe',
    slug: 'viewer-consolidation',
    cardId: 'card-7',
    cardStatus: 'in_progress',
    runnerAlive: true,
    runId: 'run-1',
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'a1b2c3d4e5f6789000000000',
    projectDir: '-Users-hip-repo-tribe',
    title: 'Fix the flaky poller test',
    titleSource: 'ai-title',
    sizeBytes: 2048,
    mtimeIso: '2026-09-13T08:00:00.000Z',
    live: false,
    subagentCount: 2,
    badges: [],
    projects: ['-Users-hip-repo-tribe'],
    ...overrides,
  };
}

describe('ProjectList (spec §4, §8.1)', () => {
  test('renders one row per project with its cwd label, and falls back to the encoded directory name when cwd is null', () => {
    const projects = [
      makeProject({ dir: '-Users-hip-repo-tribe', cwd: '/Users/hip/repo/tribe' }),
      makeProject({ dir: '-private-tmp-scratch', cwd: null }),
    ];
    const { container, root } = renderInto(<ProjectList projects={projects} />);
    try {
      const rows = container.querySelectorAll('.project-row');
      expect(rows.length).toBe(2); // one row per project
      expect(container.textContent).toContain('/Users/hip/repo/tribe'); // real cwd label
      expect(container.textContent).toContain('-private-tmp-scratch'); // fallback: the encoded dir
    } finally {
      cleanup(container, root);
    }
  });
});

describe('SessionRow (spec §4, §8.1)', () => {
  test('shows title, short id, size, relative age, and subagent count', () => {
    const now = new Date('2026-09-13T10:00:00.000Z').getTime(); // exactly 2h after mtimeIso below
    const session = makeSession({
      id: 'a1b2c3d4e5f6789000000000',
      title: 'Fix the flaky poller test',
      sizeBytes: 2048,
      mtimeIso: '2026-09-13T08:00:00.000Z',
      subagentCount: 2,
    });
    const { container, root } = renderInto(<SessionRow session={session} now={now} />);
    try {
      expect(container.textContent).toContain('Fix the flaky poller test');
      expect(container.textContent).toContain(shortSessionId(session.id));
      expect(shortSessionId(session.id).length).toBeLessThan(session.id.length); // truncated, not the whole id
      expect(container.textContent).toContain(formatSize(2048));
      expect(container.textContent).toContain(formatRelativeAge(session.mtimeIso, now));
      expect(formatRelativeAge(session.mtimeIso, now)).toBe('2h ago');
      expect(container.textContent).toContain('2 subagents');
    } finally {
      cleanup(container, root);
    }
  });

  describe('the `projects: string[]` header (spec §4, §5.2)', () => {
    test('projects.length >= 2 renders "found in N projects" using the real length', () => {
      const session = makeSession({ projects: ['-Users-a', '-Users-b', '-Users-c'] });
      const { container, root } = renderInto(<SessionRow session={session} now={Date.now()} />);
      try {
        expect(container.textContent).toContain('found in 3 projects'); // the REAL length, never a guess
      } finally {
        cleanup(container, root);
      }
    });

    test('projects.length === 1 — the ordinary case — renders nothing about it', () => {
      const session = makeSession({ projects: ['-Users-hip-repo-tribe'] });
      const { container, root } = renderInto(<SessionRow session={session} now={Date.now()} />);
      try {
        expect(container.textContent).not.toContain('found in');
      } finally {
        cleanup(container, root);
      }
    });
  });

  test('a session claimed by two campaigns renders two badges (spec §9)', () => {
    const session = makeSession({
      badges: [
        makeBadge({ repoKey: '-Users-hip-repo-tribe', slug: 'followups-2026-09-04' }),
        makeBadge({ repoKey: '-Users-hip-repo-todd-skills.migrated-1788705562', slug: 'followups-2026-09-04' }),
      ],
    });
    const { container, root } = renderInto(<SessionRow session={session} now={Date.now()} />);
    try {
      expect(container.querySelectorAll('.campaign-badge').length).toBe(2);
    } finally {
      cleanup(container, root);
    }
  });
});

describe('LiveDot (spec §5.4, §8.1)', () => {
  test('renders only when live', () => {
    const live = renderInto(<LiveDot live={true} />);
    try {
      expect(live.container.querySelectorAll('.live-dot').length).toBe(1);
    } finally {
      cleanup(live.container, live.root);
    }

    const dead = renderInto(<LiveDot live={false} />);
    try {
      expect(dead.container.querySelectorAll('.live-dot').length).toBe(0);
      expect(dead.container.innerHTML).toBe('');
    } finally {
      cleanup(dead.container, dead.root);
    }
  });
});

describe('CampaignBadge (spec §9)', () => {
  test('renders slug, card, status, and the runner state', () => {
    const badge = makeBadge({
      repoKey: '-Users-hip-repo-tribe',
      slug: 'viewer-consolidation',
      cardId: 'card-23',
      cardStatus: 'in_progress',
      runnerAlive: true,
    });
    const { container, root } = renderInto(<CampaignBadge badge={badge} />);
    try {
      const text = container.textContent ?? '';
      expect(text).toContain('viewer-consolidation');
      expect(text).toContain('card-23');
      expect(text).toContain('in_progress');
      expect(text.toLowerCase()).toContain('runner alive');
    } finally {
      cleanup(container, root);
    }
  });

  test('a dead runner is rendered distinctly from a live one', () => {
    const badge = makeBadge({ runnerAlive: false });
    const { container, root } = renderInto(<CampaignBadge badge={badge} />);
    try {
      expect((container.textContent ?? '').toLowerCase()).toContain('runner dead');
    } finally {
      cleanup(container, root);
    }
  });

  test('clicking a badge sets ?campaign=<repoKey>/<slug>', () => {
    const badge = makeBadge({ repoKey: '-Users-hip-repo-tribe', slug: 'viewer-consolidation' });
    const { container, root } = renderInto(<CampaignBadge badge={badge} />);
    try {
      const el = container.querySelector('.campaign-badge') as HTMLElement;
      expect(el).not.toBeNull();
      act(() => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(window.location.search).toBe(
        `?campaign=${encodeURIComponent('-Users-hip-repo-tribe')}/${encodeURIComponent('viewer-consolidation')}`,
      );
    } finally {
      cleanup(container, root);
    }
  });
});

describe('CampaignFilter (spec §9) and SessionList narrowing', () => {
  test('CampaignFilter is a controlled input that reports its typed value', () => {
    const seen: string[] = [];
    const { container, root } = renderInto(<CampaignFilter value="" onChange={(v) => seen.push(v)} />);
    try {
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input).not.toBeNull();
      act(() => {
        // React wraps the native `value` setter to detect programmatic changes (the plain
        // `input.value = …` assignment above is invisible to it, a well-known RTL/happy-dom
        // gotcha) — going through the PROTOTYPE's setter first is what makes the subsequent
        // `input` event actually reach the component's `onChange`.
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setValue.call(input, '-Users-hip-repo-tribe/viewer-consolidation');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(seen).toContain('-Users-hip-repo-tribe/viewer-consolidation');
    } finally {
      cleanup(container, root);
    }
  });

  test('filterSessionsByCampaign narrows to sessions carrying a badge for the exact (repoKey, slug) pair', () => {
    const match = makeSession({ id: 'a-matches', badges: [makeBadge({ repoKey: 'repoA', slug: 'slugA' })] });
    const other = makeSession({ id: 'b-other', badges: [makeBadge({ repoKey: 'repoB', slug: 'slugA' })] }); // same slug, different repoKey — must NOT match (§9: the pair, never the slug alone)
    const narrowed = filterSessionsByCampaign([match, other], 'repoA/slugA');
    expect(narrowed.map((s) => s.id)).toEqual(['a-matches']);
  });

  test('the filter narrows the list, and an empty result shows a message, not a blank pane', () => {
    const sessions = [makeSession({ id: 's1', badges: [makeBadge({ repoKey: 'repoA', slug: 'slugA' })] })];
    const { container, root } = renderInto(<SessionList sessions={sessions} campaignFilter="repoB/slugB" />);
    try {
      expect(container.querySelectorAll('.session-row').length).toBe(0); // narrowed to nothing
      expect((container.textContent ?? '').length).toBeGreaterThan(0); // NOT a blank pane
      expect(container.textContent).toContain('No sessions match'); // an actual message
    } finally {
      cleanup(container, root);
    }
  });
});

describe('D10 — the default project window (spec §5.6)', () => {
  test('olderCount: 3 renders a "show 3 older projects" link whose href is ?all=1', () => {
    const { container, root } = renderInto(<ShowOlderProjects olderCount={3} />);
    try {
      expect(container.textContent).toContain('show 3 older projects');
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('?all=1');
    } finally {
      cleanup(container, root);
    }
  });

  test('olderCount: 0 renders nothing', () => {
    const { container, root } = renderInto(<ShowOlderProjects olderCount={0} />);
    try {
      expect(container.innerHTML).toBe('');
    } finally {
      cleanup(container, root);
    }
  });

  test('a project\'s session list is NEVER filtered by age — an old project opened directly shows every session it has', () => {
    const veryOld = makeSession({ id: 'ancient', mtimeIso: '2020-01-01T00:00:00.000Z' });
    const { container, root } = renderInto(<SessionList sessions={[veryOld]} />);
    try {
      expect(container.querySelectorAll('.session-row').length).toBe(1); // shown, not filtered out for age
    } finally {
      cleanup(container, root);
    }
  });
});

describe('Sidebar composes ProjectList + CampaignFilter + ShowOlderProjects', () => {
  test('renders projects and the older-projects link together', () => {
    const projects = [makeProject()];
    const { container, root } = renderInto(
      <Sidebar projects={projects} olderCount={2} campaignFilter="" onCampaignFilterChange={() => {}} />,
    );
    try {
      expect(container.querySelectorAll('.project-row').length).toBe(1);
      expect(container.textContent).toContain('show 2 older projects');
    } finally {
      cleanup(container, root);
    }
  });
});

describe('client/src/api.ts — typed fetch wrappers (spec §3.2, §4)', () => {
  const originalFetch = globalThis.fetch;

  function stubFetch(expectedUrl: string, body: unknown): { calls: string[] } {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    return { calls };
  }

  function restoreFetch(): void {
    globalThis.fetch = originalFetch;
  }

  test('fetchProjects(false) requests /api/projects with no query and returns the parsed body', async () => {
    const body = { projects: [makeProject()], olderCount: 0, skippedBadges: 0 };
    const { calls } = stubFetch('/api/projects', body);
    try {
      const result = await fetchProjects(false);
      expect(calls).toEqual(['/api/projects']);
      expect(result).toEqual(body);
    } finally {
      restoreFetch();
    }
  });

  test('fetchProjects(true) requests ?all=1 (spec §5.6/D10)', async () => {
    const body = { projects: [makeProject()], olderCount: 0, skippedBadges: 0 };
    const { calls } = stubFetch('/api/projects?all=1', body);
    try {
      await fetchProjects(true);
      expect(calls).toEqual(['/api/projects?all=1']);
    } finally {
      restoreFetch();
    }
  });

  test('fetchSessions percent-encodes the project directory', async () => {
    const body = { project: makeProject(), sessions: [makeSession()] };
    const { calls } = stubFetch('', body);
    try {
      const result = await fetchSessions('-Users-hip-repo-tribe');
      expect(calls).toEqual(['/api/sessions?project=-Users-hip-repo-tribe']);
      expect(result).toEqual(body);
    } finally {
      restoreFetch();
    }
  });

  test('fetchSession requests /api/session/<id>', async () => {
    const body = { session: makeSession(), subagents: [], badges: [] };
    const { calls } = stubFetch('', body);
    try {
      const result = await fetchSession('a1b2c3d4e5f6789000000000');
      expect(calls).toEqual(['/api/session/a1b2c3d4e5f6789000000000']);
      expect(result).toEqual(body);
    } finally {
      restoreFetch();
    }
  });
});
