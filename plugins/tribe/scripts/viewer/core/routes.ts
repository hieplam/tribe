// core/routes.ts — URL -> Route (spec §3.2). Pure string math: `new URL(...)`, pattern matching,
// no path joins, no filesystem access. `fail-closed-edges` obligation 1: every branch below
// returns a typed refusal (`bad_request` with a reason, or `not_found`) — never throws.
//
// `fail-closed-edges` obligation 4: a path from outside is contained before it is used. This
// module is the FIRST gate — it refuses hostile shapes before any value it returns could reach a
// path join. No branch below hands back an unvalidated string a later caller could join into a
// path without ALSO passing through `containedJoin` (task 4) — the charset checks here narrow
// what can reach that stage, they do not replace it.

import type { CampaignRef, Route } from './model.ts';

// sessionId: validated exactly as spec §5.2 states — `^[0-9a-fA-F-]{8,64}$`, no dots, no
// separators. This single pattern is what makes `..`, a NUL byte, a percent-encoded `/` (which
// decodes to a literal `/`, outside this charset), and a 500-char id all fail the SAME check.
const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

// agentId: spec does not pin an exact charset (only the `agent-<id>.jsonl` filename shape, §5.5).
// Chosen conservatively at the routing layer: safe identifier characters only, no `/`, no `..`,
// no NUL, bounded length. `core/paths.ts` (task 4) applies its own containment on top of this.
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// encodedProjectDir / `project` query: matches the alphabet `sanitizeProjectDirName`
// (core/live/paths.ts, carried to core/paths.ts in task 4) can ever produce — NFC-normalized,
// every non-alphanumeric character replaced with `-`, capped at 200 chars plus a short base36
// hash suffix. 300 is a safety margin, not a magic number tied to one measurement.
const PROJECT_DIR_RE = /^[A-Za-z0-9-]{1,300}$/;

// repoKey / slug: real directory entries under the tribe home (§9) — never a value from inside a file.
// Same identifier alphabet the pre-consolidation route parser already used for this purpose.
const REPO_KEY_RE = /^[A-Za-z0-9._-]{1,200}$/;
const SLUG_RE = /^[A-Za-z0-9._-]{1,200}$/;
const DOTS_ONLY_RE = /^\.+$/;

// Asset names: a fixed allowlist is read from `dist/` at boot (§12.4) — this pure module cannot
// know what is actually built, so it only refuses shapes that could never be a real asset name
// (a path separator, `..`, a NUL byte). Whether the name is IN the boot-time allowlist is
// serve.ts's job (task 20), not this parser's.
const ASSET_NAME_RE = /^[A-Za-z0-9._-]+$/;

const DEFAULT_ROWS_LIMIT = 500;
const MAX_ROWS_LIMIT = 2000;

function isValidSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

function isValidAgentId(value: string): boolean {
  return AGENT_ID_RE.test(value) && !DOTS_ONLY_RE.test(value);
}

function isValidProjectDir(value: string): boolean {
  return PROJECT_DIR_RE.test(value) && !DOTS_ONLY_RE.test(value);
}

function isValidAssetName(value: string): boolean {
  return ASSET_NAME_RE.test(value) && !DOTS_ONLY_RE.test(value);
}

/** `?campaign=<repoKey>/<slug>` — the PAIR, never the slug alone (§9). Returns `undefined` when
 * the parameter is absent (not an error), `null` when present but malformed (the caller turns
 * that into `bad_request`). The `/` is the separator; both halves are percent-encoded by the
 * caller, so `searchParams.get` has already undone exactly one layer of percent-encoding. */
function parseCampaignParam(raw: string | null): CampaignRef | null | undefined {
  if (raw === null) return undefined;
  const slashIndex = raw.indexOf('/');
  if (slashIndex <= 0 || slashIndex === raw.length - 1) return null; // no pair, or an empty half
  const repoKey = raw.slice(0, slashIndex);
  const slug = raw.slice(slashIndex + 1);
  if (slug.includes('/')) return null; // more than one separator — not a clean pair
  if (!REPO_KEY_RE.test(repoKey) || DOTS_ONLY_RE.test(repoKey)) return null;
  if (!SLUG_RE.test(slug) || DOTS_ONLY_RE.test(slug)) return null;
  return { repoKey, slug };
}

function parseAllFlag(searchParams: URLSearchParams): boolean {
  return searchParams.get('all') === '1';
}

/** `before`/`at`/`i`: an integer row byte offset or block index. `null`/absent is a distinct,
 * valid state (§3.2: omitting `before` returns the tail window) — only a PRESENT, non-integer, or
 * negative value is refused. */
function parseOptionalNonNegativeInt(raw: string | null): number | null | typeof INVALID {
  if (raw === null || raw === '') return null;
  if (!/^\d+$/.test(raw)) return INVALID;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return INVALID;
  return value;
}

function parseRequiredNonNegativeInt(raw: string | null): number | typeof INVALID {
  const parsed = parseOptionalNonNegativeInt(raw);
  return parsed === null ? INVALID : parsed;
}

const INVALID = Symbol('invalid');

function parseLimit(raw: string | null): number {
  if (raw === null || raw === '') return DEFAULT_ROWS_LIMIT;
  if (!/^\d+$/.test(raw)) return DEFAULT_ROWS_LIMIT;
  const value = Number(raw);
  // `raw` matched `/^\d+$/` above (digits only, no sign), so `Number(raw)` can never be
  // negative — a `|| value < 0` guard here would be dead code (Tracker finding, phase-0 fix).
  // The only way this parse can still be rejected is an unsafe integer (an oversized digit
  // string that overflows to a float or Infinity).
  if (!Number.isSafeInteger(value)) return DEFAULT_ROWS_LIMIT;
  return Math.min(value, MAX_ROWS_LIMIT); // clamped, never refused (§3.2)
}

function parseOrphans(raw: string | null): string[] {
  if (raw === null || raw === '') return [];
  return raw.split(',').filter((s) => s.length > 0);
}

function badRequest(reason: string): Route {
  return { kind: 'bad_request', reason };
}

/** The `session` + `agent` query-param gate shared by `/api/rows`, `/api/block`, `/api/spill`,
 * and `/events` (§3.2). Extracted so a future regex/message change cannot silently miss one of
 * the four call sites (`fail-closed-edges` obligation 1 — dedup, phase-0 fix). Pure string math:
 * refuses with the SAME typed `badRequest` any of the four routes previously returned inline;
 * never throws. */
function parseSessionAndAgent(
  searchParams: URLSearchParams,
): { sessionId: string; agentId: string | null } | Route {
  const sessionRaw = searchParams.get('session');
  if (sessionRaw === null || sessionRaw === '' || !isValidSessionId(sessionRaw)) {
    return badRequest('session must match ^[0-9a-fA-F-]{8,64}$');
  }
  const agentRaw = searchParams.get('agent');
  if (agentRaw !== null && agentRaw !== '' && !isValidAgentId(agentRaw)) {
    return badRequest('agent must be a safe identifier');
  }
  return { sessionId: sessionRaw, agentId: agentRaw === null || agentRaw === '' ? null : agentRaw };
}

function notFound(path: string): Route {
  return { kind: 'not_found', path };
}

/** `decodeURIComponent` throws `URIError` on a malformed percent sequence (e.g. a lone `%`) —
 * `fail-closed-edges` obligation 1 forbids that reaching a caller as an uncaught exception.
 * `null` means "could not decode"; every call site turns that into a typed refusal. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    if (e instanceof URIError) return null;
    throw e;
  }
}

/** `URL -> Route`. Never throws: `new URL(...)` is the only call that could, and every caller of
 * this function passes a value already produced by `new URL(request.url)` at the edge, so a
 * malformed URL string never reaches here. Every OTHER decode in this function (`decodeURIComponent`
 * on a path segment) goes through `safeDecode` instead, so a malformed percent sequence anywhere
 * in the path also can never throw. */
export function parseRoute(url: string): Route {
  const parsed = new URL(url);
  const { pathname, searchParams } = parsed;

  // --- Client-routed: the shell, unconditionally (§3.2 closing rule: "by prefix, not by
  // existence"). These never join a path from the id they carry.
  if (pathname === '/' || pathname === '/index.html') {
    const campaign = parseCampaignParam(searchParams.get('campaign'));
    if (campaign === null) return badRequest('campaign must be the pair <repoKey>/<slug>');
    return { kind: 'shell', campaign: campaign ?? null, all: parseAllFlag(searchParams) };
  }

  const projectMatch = /^\/p\/([^/]+)$/.exec(pathname);
  if (projectMatch) {
    const projectDir = safeDecode(projectMatch[1]!);
    return { kind: 'shell_project', projectDir: projectDir ?? projectMatch[1]! };
  }

  const sessionAgentMatch = /^\/s\/([^/]+)\/a\/([^/]+)$/.exec(pathname);
  if (sessionAgentMatch) {
    return {
      kind: 'shell_session_agent',
      sessionId: safeDecode(sessionAgentMatch[1]!) ?? sessionAgentMatch[1]!,
      agentId: safeDecode(sessionAgentMatch[2]!) ?? sessionAgentMatch[2]!,
    };
  }

  const sessionMatch = /^\/s\/([^/]+)$/.exec(pathname);
  if (sessionMatch) {
    return { kind: 'shell_session', sessionId: safeDecode(sessionMatch[1]!) ?? sessionMatch[1]! };
  }

  if (pathname === '/healthz') {
    return { kind: 'health' };
  }

  const assetMatch = /^\/assets\/([^/]+)$/.exec(pathname);
  if (assetMatch) {
    const name = safeDecode(assetMatch[1]!);
    if (name === null || !isValidAssetName(name)) return badRequest('asset name refused: unsafe shape');
    return { kind: 'asset', name };
  }

  if (pathname === '/api/projects') {
    const campaign = parseCampaignParam(searchParams.get('campaign'));
    if (campaign === null) return badRequest('campaign must be the pair <repoKey>/<slug>');
    return { kind: 'api_projects', all: parseAllFlag(searchParams) };
  }

  if (pathname === '/api/sessions') {
    const project = searchParams.get('project');
    if (project === null || !isValidProjectDir(project)) {
      return badRequest('project must be a non-empty encoded project directory name');
    }
    return { kind: 'api_sessions', project };
  }

  const apiSessionMatch = /^\/api\/session\/([^/]*)$/.exec(pathname);
  if (apiSessionMatch) {
    const raw = apiSessionMatch[1]!;
    if (raw === '') return notFound(pathname); // no id segment supplied at all: a routing miss
    const sessionId = safeDecode(raw);
    if (sessionId === null || !isValidSessionId(sessionId)) {
      return badRequest('sessionId must match ^[0-9a-fA-F-]{8,64}$');
    }
    return { kind: 'api_session', sessionId };
  }

  if (pathname === '/api/rows') {
    const gated = parseSessionAndAgent(searchParams);
    if ('kind' in gated) return gated;
    const before = parseOptionalNonNegativeInt(searchParams.get('before'));
    if (before === INVALID) return badRequest('before must be a non-negative integer row offset');
    return {
      kind: 'api_rows',
      sessionId: gated.sessionId,
      agentId: gated.agentId,
      before,
      limit: parseLimit(searchParams.get('limit')),
      orphans: parseOrphans(searchParams.get('orphans')),
    };
  }

  if (pathname === '/api/block') {
    const gated = parseSessionAndAgent(searchParams);
    if ('kind' in gated) return gated;
    const at = parseRequiredNonNegativeInt(searchParams.get('at'));
    if (at === INVALID) return badRequest('at must be a non-negative integer byte offset');
    const i = parseRequiredNonNegativeInt(searchParams.get('i'));
    if (i === INVALID) return badRequest('i must be a non-negative integer block index');
    return { kind: 'api_block', sessionId: gated.sessionId, agentId: gated.agentId, at, i };
  }

  if (pathname === '/api/spill') {
    const gated = parseSessionAndAgent(searchParams);
    if ('kind' in gated) return gated;
    const name = searchParams.get('name');
    // Name shape only: this parser refuses an unsafe shape, but the actual open goes through
    // `containedJoin` (task 4) regardless — this check narrows what can reach that stage.
    if (name === null || name === '' || !ASSET_NAME_RE.test(name) || DOTS_ONLY_RE.test(name)) {
      return badRequest('spill name refused: unsafe shape');
    }
    return { kind: 'api_spill', sessionId: gated.sessionId, agentId: gated.agentId, name };
  }

  if (pathname === '/events') {
    const gated = parseSessionAndAgent(searchParams);
    if ('kind' in gated) return gated;
    return { kind: 'events', sessionId: gated.sessionId, agentId: gated.agentId };
  }

  // §3.2 closing rule: everything else under /p/ or /s/ (e.g. a malformed segment the patterns
  // above didn't match, such as an extra path level) is still client-routed — the React router
  // owns these addresses and the server never decides their meaning.
  if (pathname.startsWith('/p/')) {
    return { kind: 'shell_project', projectDir: pathname.slice('/p/'.length) };
  }
  if (pathname.startsWith('/s/')) {
    return { kind: 'shell_session', sessionId: pathname.slice('/s/'.length) };
  }

  return notFound(pathname);
}
