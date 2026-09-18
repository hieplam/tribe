// client/src/routes.ts — URL <-> the client's own route descriptor (spec §3.2). Pure string
// math, mirroring core/routes.ts's shape on the client side: no DOM access, no import from
// core/ or adapters/ (§12.6.1) — every outside-world dependency (`window.history`) is taken as
// an injected argument, never reached for directly (`pure-core.md`).
//
// The four client-routed shapes (spec §3.2): `/`, `/p/<encodedProjectDir>`, `/s/<sessionId>`,
// `/s/<sessionId>/a/<agentId>`. Everything else the server could ever hand the shell for is not
// one of these four, so it falls back to the list route — the shell owns the address bar, but
// this module only needs to recognize the shapes it renders differently.

export type ClientRoute =
  | { kind: 'list' }
  | { kind: 'project'; projectDir: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'session_agent'; sessionId: string; agentId: string };

/** The one method `navigate` needs from `window.history` — injected so this module never reaches
 * for the global directly (`pure-core.md`). */
export interface HistoryLike {
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** `ClientRoute -> pathname`, the exact four shapes of spec §3.2. */
export function routeToPath(route: ClientRoute): string {
  switch (route.kind) {
    case 'list':
      return '/';
    case 'project':
      return `/p/${encodeURIComponent(route.projectDir)}`;
    case 'session':
      return `/s/${encodeURIComponent(route.sessionId)}`;
    case 'session_agent':
      return `/s/${encodeURIComponent(route.sessionId)}/a/${encodeURIComponent(route.agentId)}`;
  }
}

/** `pathname -> ClientRoute`. Total: a pathname matching none of the four shapes falls back to
 * `list` rather than throwing — the server never hands the shell to a path the client cannot at
 * least fall back to rendering (§3.2's closing rule: client-routed paths are decided by prefix). */
export function parseClientPath(pathname: string): ClientRoute {
  if (pathname === '/' || pathname === '/index.html') return { kind: 'list' };

  const sessionAgent = /^\/s\/([^/]+)\/a\/([^/]+)$/.exec(pathname);
  if (sessionAgent) {
    return {
      kind: 'session_agent',
      sessionId: decodeURIComponent(sessionAgent[1]!),
      agentId: decodeURIComponent(sessionAgent[2]!),
    };
  }

  const session = /^\/s\/([^/]+)$/.exec(pathname);
  if (session) return { kind: 'session', sessionId: decodeURIComponent(session[1]!) };

  const project = /^\/p\/([^/]+)$/.exec(pathname);
  if (project) return { kind: 'project', projectDir: decodeURIComponent(project[1]!) };

  return { kind: 'list' };
}

/** Navigates to `route` via the injected `history` (normally `window.history`), pushing exactly
 * the path `routeToPath` would produce. The one write this module performs, and only through the
 * caller-supplied seam — never `window.history` reached directly. */
export function navigate(history: HistoryLike, route: ClientRoute): void {
  history.pushState(null, '', routeToPath(route));
}
