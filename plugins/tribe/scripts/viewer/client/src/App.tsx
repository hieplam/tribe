// client/src/App.tsx — the app shell (plan Task 22). Client-side view components (Sidebar,
// ProjectList, SessionRow, …) are task 23+ (spec §8.1); this task only wires the scaffold: the
// route the current address bar names, kept in sync on back/forward.
import { useEffect, useState } from 'react';
import { parseClientPath, type ClientRoute } from './routes.ts';

function readRoute(): ClientRoute {
  return parseClientPath(window.location.pathname);
}

export function App() {
  const [route, setRoute] = useState<ClientRoute>(() => readRoute());

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div className="app-shell">
      <h1 className="app-shell__title">tribe viewer</h1>
      <p className="app-shell__meta">route: {route.kind}</p>
    </div>
  );
}
