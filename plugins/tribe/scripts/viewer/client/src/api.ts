// client/src/api.ts — typed fetch wrappers over the server's JSON routes (spec §3.2, §4). Each
// function performs exactly one `fetch` + `.json()` and returns the wire shape `serve.ts` sends
// (`core/model.ts`'s `Project`/`SessionSummary`/`Badge`/`Agent`); it decides nothing
// (`pure-core.md`: the network call is the one and only side effect here, and no branching or
// derivation of business meaning happens in this file). Wiring these into the route/component
// tree at runtime is a later task (plan Task 30 — the end-to-end wiring); this task only needs
// importable, individually-testable request functions with the right shape.
//
// Type-only import: `client/src/**` never VALUE-imports from `core/` (§12.6.1) — these interfaces
// are erased at compile time, so importing them costs nothing at runtime and the structural wall
// stays clean.
import type { Agent, Badge, Project, SessionSummary } from '../../core/model.ts';

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

/** `GET /api/projects` (spec §5.6, D10). `all=true` requests every project — the response's
 * `olderCount` comes back `0` in that case; `false` (the default) requests the 30-day window plus
 * the real `olderCount` for the rest. */
export async function fetchProjects(all: boolean = false): Promise<ProjectsResponse> {
  const res = await fetch(all ? '/api/projects?all=1' : '/api/projects');
  // `Response#json()` returns `Promise<unknown>` — this function's OWN contract is the shape
  // (no runtime re-validation here, matching every other call in this file); serve.ts is the
  // producer of this exact wire shape (spec §4).
  return (await res.json()) as ProjectsResponse;
}

/** `GET /api/sessions?project=<encodedProjectDir>` (spec §3.2). `projectDir` is the on-disk
 * encoded directory name (`Project.dir`), percent-encoded here exactly once — the same shape
 * `client/src/routes.ts#routeToPath` already uses for `/p/<encodedProjectDir>`. */
export async function fetchSessions(projectDir: string): Promise<SessionsResponse> {
  const res = await fetch(`/api/sessions?project=${encodeURIComponent(projectDir)}`);
  return (await res.json()) as SessionsResponse;
}

/** `GET /api/session/<sessionId>` (spec §5.2). `sessionId` is validated server-side; this
 * function only shapes the request URL. */
export async function fetchSession(sessionId: string): Promise<SessionResponse> {
  const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
  return (await res.json()) as SessionResponse;
}
