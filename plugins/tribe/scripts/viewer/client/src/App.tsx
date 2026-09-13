// client/src/App.tsx — the app shell and route dispatch (spec §8.1). The shell is composed ONCE and
// always: `<Sidebar>` + `<Main>` inside `.app-shell`, and `<Main>` switches on the route the address
// bar names (kept in sync on back/forward) between the list view (`SessionList`) and the session
// view (`SessionView`). A session route is NOT a bare `<SessionView>` — it mounts inside the same
// shell, with the sidebar beside it, exactly as §8.1's tree draws it.
//
// The two client-routed data reads enter through the `client/src/api.ts` seams
// (`fetchProjects`/`fetchSessions`), which now go through the ONE fail-closed `http.ts` boundary; the
// network call is the only side effect and `routes.ts` stays a pure string/address module
// (`pure-core.md`).
import { useEffect, useState } from 'react';
import { fetchProjects, fetchSessions, type ProjectsResponse } from './api.ts';
import type { SessionSummary } from '../../core/model.ts';
import { parseClientPath, type ClientRoute } from './routes.ts';
import { SessionList } from './components/SessionList.tsx';
import { SessionView } from './components/SessionView.tsx';
import { Sidebar } from './components/Sidebar.tsx';

function readRoute(): ClientRoute {
  return parseClientPath(window.location.pathname);
}

/** The campaign filter pre-fill from the address bar (spec §3.2: `?campaign=<repoKey>/<slug>` — the
 * PAIR, §9). Read on load AND on back/forward so a link or a shared URL narrows the list without a
 * badge click. Empty when absent. */
function readCampaignFilter(): string {
  return new URLSearchParams(window.location.search).get('campaign') ?? '';
}

/** Concatenated sessions with each id kept once, first occurrence wins — a session that lives in
 * two projects (§5.2's "found in N projects") is returned by both projects' `fetchSessions`, and
 * the `/` view lists it once (SET semantics). Pure. */
function uniqueById(sessions: SessionSummary[]): SessionSummary[] {
  const seen = new Set<string>();
  const out: SessionSummary[] = [];
  for (const s of sessions) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** The aggregated `/` list, ordered NEWEST-FIRST by `mtimeIso` (§5.3 ordering) across every project.
 * Pure: a data transformation over the deduped union, no side effect. ISO-8601 strings sort
 * lexicographically in time order, so `localeCompare` descending is the whole of it. */
function orderNewestFirst(sessions: SessionSummary[]): SessionSummary[] {
  return uniqueById(sessions).slice().sort((a, b) => b.mtimeIso.localeCompare(a.mtimeIso));
}

export function App() {
  const [route, setRoute] = useState<ClientRoute>(() => readRoute());
  const [campaignFilter, setCampaignFilter] = useState<string>(() => readCampaignFilter());
  const [projects, setProjects] = useState<ProjectsResponse | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [degradedProjects, setDegradedProjects] = useState(0);

  const all = new URLSearchParams(window.location.search).get('all') === '1';
  const isSession = route.kind === 'session' || route.kind === 'session_agent';
  const projectDir = route.kind === 'project' ? route.projectDir : null;

  useEffect(() => {
    const onPopState = () => {
      setRoute(readRoute());
      setCampaignFilter(readCampaignFilter()); // a shared `?campaign=` URL pre-fills on navigation too
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // The sidebar's project list — fetched on every route (the shell is always present). Fails closed
  // through the `http.ts` boundary: a note, never a blank pane or an unhandled rejection.
  useEffect(() => {
    let alive = true;
    setProjectsError(null);
    fetchProjects(all)
      .then((r) => {
        if (alive) setProjects(r);
      })
      .catch(() => {
        if (alive) setProjectsError('could not load projects — the viewer could not reach the server');
      });
    return () => {
      alive = false;
    };
  }, [all]);

  // The main pane's session list — only on the list/project routes (a session route reads its rows
  // over `/events`, never here).
  useEffect(() => {
    if (isSession) return;
    let alive = true;
    setSessionsError(null);
    setDegradedProjects(0);
    if (projectDir !== null) {
      fetchSessions(projectDir)
        .then((r) => {
          if (alive) setSessions(r.sessions);
        })
        .catch(() => {
          if (alive) setSessionsError('could not load sessions — the viewer could not reach the server');
        });
    } else if (projects !== null) {
      // The `/` union across every in-window project. `Promise.allSettled` (not `Promise.all`): one
      // failed project fetch must NOT blank every row — the successful projects still render and the
      // failures are reported as a degraded count (§9 GET /).
      Promise.allSettled(projects.projects.map((p) => fetchSessions(p.dir))).then((results) => {
        if (!alive) return;
        const pages: SessionSummary[] = [];
        let failed = 0;
        for (const r of results) {
          if (r.status === 'fulfilled') pages.push(...r.value.sessions);
          else failed += 1;
        }
        setSessions(orderNewestFirst(pages)); // newest-first across projects (§5.3)
        setDegradedProjects(failed);
      });
    }
    return () => {
      alive = false;
    };
  }, [isSession, projectDir, projects]);

  const agentId = route.kind === 'session_agent' ? route.agentId : null;

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects?.projects ?? []}
        olderCount={projects?.olderCount ?? 0}
        campaignFilter={campaignFilter}
        onCampaignFilterChange={setCampaignFilter}
        projectsError={projectsError}
      />
      <main className="app-main">
        {isSession && (route.kind === 'session' || route.kind === 'session_agent') ? (
          <SessionView sessionId={route.sessionId} agentId={agentId} />
        ) : projectsError !== null || sessionsError !== null ? (
          <p className="app-error" data-testid="load-error" style={{ color: 'var(--warn)' }}>
            {projectsError ?? sessionsError}
          </p>
        ) : (
          <>
            {degradedProjects > 0 && (
              <p className="app-degraded" data-testid="degraded-note" style={{ color: 'var(--warn)' }}>
                {degradedProjects} project{degradedProjects === 1 ? '' : 's'} could not be loaded
              </p>
            )}
            {sessions !== null && <SessionList sessions={sessions} campaignFilter={campaignFilter} />}
          </>
        )}
      </main>
    </div>
  );
}
