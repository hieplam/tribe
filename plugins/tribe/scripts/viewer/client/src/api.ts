// client/src/api.ts — typed fetch wrappers over the server's JSON routes (spec §3.2, §4). Each
// function performs exactly one `fetch` + `.json()` and returns the wire shape `serve.ts` sends
// (`core/model.ts`'s `Project`/`SessionSummary`/`Badge`/`Agent`); it decides nothing
// (`pure-core.md`: the network call is the one and only side effect here, and no branching or
// derivation of business meaning happens in this file). These are wired into the running route/
// component tree by `client/src/App.tsx` (the phase-3 assembly): `fetchProjects` feeds the sidebar
// and, aggregated with `fetchSessions` per in-window project, the `/` route's session list;
// `fetchSessions` feeds the `/p/<dir>` route directly.
//
// Type-only import: `client/src/**` never VALUE-imports from `core/` (§12.6.1) — these interfaces
// are erased at compile time, so importing them costs nothing at runtime and the structural wall
// stays clean.
import type { Agent, Badge, Project, SessionSummary } from '../../core/model.ts';
import { fetchJson } from './http.ts';

export interface ProjectsResponse {
  projects: Project[];
  olderCount: number;
  skippedBadges: number;
}

export interface SessionsResponse {
  project: Project;
  sessions: SessionSummary[];
}

export interface SessionResponse {
  session: SessionSummary;
  subagents: Agent[];
  badges: Badge[];
}

// Shape validators (fail-closed-edges): every read goes through the `http.ts` boundary, which
// checks `res.ok` and refuses a non-2xx (a 500's `{error}` body must never reach `projects.map`).
// These predicates gate the 2xx body's SHAPE — the minimum each caller depends on.
function isProjectsResponse(v: unknown): v is ProjectsResponse {
  return typeof v === 'object' && v !== null && Array.isArray((v as ProjectsResponse).projects);
}
function isSessionsResponse(v: unknown): v is SessionsResponse {
  return typeof v === 'object' && v !== null && Array.isArray((v as SessionsResponse).sessions);
}
function isSessionResponse(v: unknown): v is SessionResponse {
  return typeof v === 'object' && v !== null && (v as SessionResponse).session !== undefined;
}

/** `GET /api/projects` (spec §5.6, D10). `all=true` requests every project — the response's
 * `olderCount` comes back `0` in that case; `false` (the default) requests the 30-day window plus
 * the real `olderCount` for the rest. Fails closed through the `http.ts` boundary. */
export async function fetchProjects(all: boolean = false): Promise<ProjectsResponse> {
  return fetchJson(all ? '/api/projects?all=1' : '/api/projects', isProjectsResponse);
}

/** `GET /api/sessions?project=<encodedProjectDir>` (spec §3.2). `projectDir` is the on-disk
 * encoded directory name (`Project.dir`), percent-encoded here exactly once — the same shape
 * `client/src/routes.ts#routeToPath` already uses for `/p/<encodedProjectDir>`. */
export async function fetchSessions(projectDir: string): Promise<SessionsResponse> {
  return fetchJson(`/api/sessions?project=${encodeURIComponent(projectDir)}`, isSessionsResponse);
}

/** `GET /api/session/<sessionId>` (spec §5.2). `sessionId` is validated server-side; this
 * function only shapes the request URL. */
export async function fetchSession(sessionId: string): Promise<SessionResponse> {
  return fetchJson(`/api/session/${encodeURIComponent(sessionId)}`, isSessionResponse);
}
