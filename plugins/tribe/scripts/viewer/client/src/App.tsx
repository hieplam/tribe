// client/src/App.tsx — the app shell and route dispatch (spec §8.1). Switches on the route the
// address bar names (kept in sync on back/forward) and mounts the REAL composed views: the list
// view (`Sidebar` + `ProjectList`, and `SessionList` for a project) for `/` and `/p/<dir>`, and
// `SessionView` for `/s/<id>[/a/<agent>]`. The two client-routed data reads enter through the
// `client/src/api.ts` seams (`fetchProjects`/`fetchSessions`) — the network call is the only side
// effect and `routes.ts` stays a pure string/address module (`pure-core.md`).
//
// This file is where the client is assembled: `client/src/api.ts`'s request functions and every
// list/session component built in tasks 23-25 are wired into the running tree here.
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

/** Concatenated sessions with each id kept once, first occurrence wins — a session that lives in
 * two projects (§5.2's "found in N projects") is returned by both projects' `fetchSessions`, and
 * the `/` view lists it once (SET semantics: Task 30 Layer 3 asserts the rendered id SET). Pure. */
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

/** The list view for `/` and `/p/<dir>` (spec §8.1: `<SessionList>` renders on BOTH). The main
 * pane's sessions are aggregated CLIENT-SIDE from the existing `api.ts` seams — there is no
 * all-sessions endpoint and none is added: `/` fetches the in-window projects, then each project's
 * sessions, and lists their union; `/p/<dir>` lists that one project's sessions. `?all=1` (D10) is
 * read from the address bar the `ShowOlderProjects` link sets, so the older-projects view
 * aggregates across every project. The network calls are the only side effects and enter through
 * `api.ts` (`pure-core.md`); `routes.ts` stays the pure address seam. */
function ListView({ route }: { route: Extract<ClientRoute, { kind: 'list' | 'project' }> }) {
  const [projects, setProjects] = useState<ProjectsResponse | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [campaignFilter, setCampaignFilter] = useState('');
  const all = new URLSearchParams(window.location.search).get('all') === '1';
  const projectDir = route.kind === 'project' ? route.projectDir : null;

  useEffect(() => {
    let alive = true;
    fetchProjects(all).then((r) => {
      if (alive) setProjects(r);
    });
    return () => {
      alive = false;
    };
  }, [all]);

  useEffect(() => {
    let alive = true;
    if (projectDir !== null) {
      // project route: exactly that project's sessions.
      fetchSessions(projectDir).then((r) => {
        if (alive) setSessions(r.sessions);
      });
    } else if (projects !== null) {
      // list route: the union of every in-window project's sessions in one list.
      Promise.all(projects.projects.map((p) => fetchSessions(p.dir))).then((pages) => {
        if (alive) setSessions(uniqueById(pages.flatMap((page) => page.sessions)));
      });
    }
    return () => {
      alive = false;
    };
  }, [projectDir, projects]);

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects?.projects ?? []}
        olderCount={projects?.olderCount ?? 0}
        campaignFilter={campaignFilter}
        onCampaignFilterChange={setCampaignFilter}
      />
      <main className="app-main">
        {sessions !== null && <SessionList sessions={sessions} campaignFilter={campaignFilter} />}
      </main>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState<ClientRoute>(() => readRoute());

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (route.kind === 'session' || route.kind === 'session_agent') {
    const agentId = route.kind === 'session_agent' ? route.agentId : null;
    return <SessionView sessionId={route.sessionId} agentId={agentId} />;
  }

  return <ListView route={route} />;
}
