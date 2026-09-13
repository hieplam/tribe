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
import { fetchProjects, fetchSessions, type ProjectsResponse, type SessionsResponse } from './api.ts';
import { parseClientPath, type ClientRoute } from './routes.ts';
import { SessionList } from './components/SessionList.tsx';
import { SessionView } from './components/SessionView.tsx';
import { Sidebar } from './components/Sidebar.tsx';

function readRoute(): ClientRoute {
  return parseClientPath(window.location.pathname);
}

/** The list view for `/` and `/p/<dir>` (spec §8.1). Fetches projects for the sidebar, and — only
 * on a project route — that project's sessions for the main pane. `?all=1` (D10) is read from the
 * address bar the `ShowOlderProjects` link sets. */
function ListView({ route }: { route: Extract<ClientRoute, { kind: 'list' | 'project' }> }) {
  const [projects, setProjects] = useState<ProjectsResponse | null>(null);
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);
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
    if (projectDir === null) {
      setSessions(null);
      return;
    }
    let alive = true;
    fetchSessions(projectDir).then((r) => {
      if (alive) setSessions(r);
    });
    return () => {
      alive = false;
    };
  }, [projectDir]);

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects?.projects ?? []}
        olderCount={projects?.olderCount ?? 0}
        campaignFilter={campaignFilter}
        onCampaignFilterChange={setCampaignFilter}
      />
      <main className="app-main">
        {projectDir !== null && sessions !== null && (
          <SessionList sessions={sessions.sessions} campaignFilter={campaignFilter} />
        )}
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
