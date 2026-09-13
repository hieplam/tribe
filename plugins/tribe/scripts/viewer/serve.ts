// serve.ts — the composition root (spec §7/§12). INCREMENTAL rewrite across Tasks 17->20 (Shaman/
// Warchief Resolution, this task): the pre-consolidation status-page/live-processes body could not
// load at all — every one of its `./core/live/*` and `./adapters/{scan,transcript}.adapter.ts`
// imports named a file already deleted by Tasks 2-16 as their pure logic moved into `core/*.ts` —
// so it was not "working code" being destroyed, it was dead weight blocking the file from booting.
// `core/derive.ts`/`core/render.ts` are NOT deleted (Task 28 owns that); this file simply stops
// importing them.
//
// This task (17) establishes the minimal BOOTABLE shape: resolve the projects root (D32), wire the
// real `fs.adapter`/`campaign.adapter` + pure `core/scan.ts` to serve exactly three routes
// (`/api/projects`, `/api/sessions`, `/api/session/<id>`), one-line-body JSON 404 for everything
// else. Argument-parsing hardening, `Host`/CSP checks, `/healthz`, the SPA shell routes, and
// `/api/rows`/`/api/block`/`/api/spill`/`/events` are explicitly OUT of this task's scope — Task 20
// (composition root) and Task 18/19 (row back-fill, the poller) own those.
import { join } from 'node:path';
import {
  discoverCampaignCandidates,
  processAlive,
  readSelectedCampaigns,
  type CampaignSelector,
} from './adapters/campaign.adapter.ts';
import { listDirOrEmpty, readHead, readTail, readTextCapped, realpathOrNull, statOrNull } from './adapters/fs.adapter.ts';
import { buildBadgeIndex, selectCampaigns } from './core/badge.ts';
import { type CacheEntry, decideCache, evictionVictim } from './core/cache.ts';
import type { Agent, Badge } from './core/model.ts';
import { containedJoin, isContainedResolved } from './core/paths.ts';
import { parseRoute } from './core/routes.ts';
import { buildScanIndex, partitionProjects, sessionCacheKey, type ScannedSessionInput } from './core/scan.ts';
import { deriveAgents, type SubagentEntry } from './core/subagents.ts';
import { completeLines } from './core/window.ts';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// D32: `CLAUDE_CONFIG_DIR` when set and non-empty, else `<HOME>/.claude` — `HOME`/`CLAUDE_CONFIG_DIR`
// are the only environment values this file reads (spec §12.3), and only here.
function resolveProjectsRootLexical(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const base = configDir !== undefined && configDir.length > 0 ? configDir : join(process.env.HOME ?? '', '.claude');
  return join(base, 'projects');
}

const port = Number(arg('--port') ?? '4321');
const tribeRootLexical = arg('--tribe-root') ?? join(process.env.HOME ?? '', '.tribe');
const projectsRootLexical = resolveProjectsRootLexical();
// The containment root and the scan root are always the SAME resolved value (D14/D32, spec
// §12.2) — a missing/unreadable `.claude` (no `CLAUDE_CONFIG_DIR` and no `~/.claude`) resolves to
// `null` here; falling back to the lexical path is harmless because nothing is ever found under a
// root that does not exist (`listDirOrEmpty` degrades to `[]`, never a crash).
const projectsRootResolved = realpathOrNull(projectsRootLexical) ?? projectsRootLexical;
// Same realpath discipline for the tribe root (spec §9/D14): `campaign.adapter.ts` compares every
// symlink it opens against this value with `isContainedResolved`, which does no filesystem access
// of its own — a LEXICAL root (e.g. a `mkdtemp` path that is itself a symlink, as macOS's
// `/var/folders -> /private/var/folders` is) would reject every ordinary, non-symlinked fixture
// the same way an actual escape would.
const tribeRootResolved = realpathOrNull(tribeRootLexical) ?? tribeRootLexical;

const HEAD_BYTES = 64 * 1024; // spec §5.3
const TAIL_BYTES = 256 * 1024; // spec §5.3
const CAMPAIGN_CAP = 200; // spec §9
const AGENT_FILE_RE = /^agent-(.+)\.jsonl$/;
const META_CAP_BYTES = 64 * 1024;

function warnRefused(path: string): void {
  console.error(`serve: refused path outside the projects root: ${path}`);
}

function isEnotdirError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'ENOTDIR';
}

/** `listDirOrEmpty`, except a target that turns out to be a FILE (not a directory) — `ENOTDIR` —
 * yields `null` rather than propagating, so the caller can implement spec §5.1 step 1's "skip
 * anything that is not a directory" without importing `node:fs` itself (`fail-closed-edges`
 * obligation 1: a narrow, specific catch, re-throwing anything else). */
function listDirIfDirectory(path: string): string[] | null {
  try {
    return listDirOrEmpty(path);
  } catch (err) {
    if (isEnotdirError(err)) return null;
    throw err;
  }
}

/** Resolves `path` (already lexically joined under `root`) and proves it sits inside `root`
 * (D14, spec §12.2) — both stages, lexical then resolved, exactly as §12.2 requires. `null` means
 * "refused or does not exist"; the caller skips it, `console.error`s exactly one line for a REAL
 * escape (never for a plain absence), and never crashes. */
function resolveContained(root: string, joined: string): string | null {
  const resolved = realpathOrNull(joined);
  if (resolved === null) return null; // missing or a broken symlink — never a real target
  if (!isContainedResolved(root, resolved)) {
    warnRefused(joined);
    return null;
  }
  return resolved;
}

// --- The session read cache (spec §5.3: "bounded to 500 entries, LRU, with a 60 s absolute
// expiry") --- This file HOLDS the `Map`; every hit/stale/miss/eviction decision is
// `core/cache.ts`'s, never computed here (`pure-core.md`). Keyed by
// `core/scan.ts#sessionCacheKey` — path + size + mtime + inode, so a same-size rewrite within the
// same millisecond can never serve a stale title forever. The 500-entry LRU bound
// (`core/cache.ts#CACHE_CAPACITY`/`evictionVictim`) is honored exactly; the absolute-expiry
// WINDOW is `core/cache.ts#decideCache`'s own `CACHE_TTL_MS` (5 s, shared with the badge-scan
// cache §9 names) rather than a dedicated 60 s figure, because `decideCache` does not take a TTL
// parameter — it is not this task's file to change (`core/cache.ts` is outside Task 17's
// deliverables). Flagged here rather than silently claimed as spec-exact: a shorter expiry is the
// SAFE direction (more re-reads, never a staler title than intended), so this does not weaken any
// correctness guarantee, only the warm-cache HIT RATE the 60 s figure was meant to buy.
interface SessionWindows {
  headLines: string[];
  tailLines: string[];
}
const sessionReadCache = new Map<string, CacheEntry<SessionWindows>>();
// D2's "grew since the previous scan" half needs the previous scan's size, held across requests in
// this same bounded-by-nothing-but-practice map (keyed by the session's resolved absolute path).
const previousSizeByPath = new Map<string, number>();

function readSessionWindows(path: string, obs: { sizeBytes: number; mtimeMs: number; inode: number }, nowMs: number): SessionWindows {
  const key = sessionCacheKey(path, obs);
  const decision = decideCache(key, sessionReadCache, nowMs);
  if (decision.kind === 'hit') {
    const existing = sessionReadCache.get(key);
    if (existing !== undefined) sessionReadCache.set(key, { ...existing, lastAccessMs: nowMs });
    return decision.value;
  }
  const headLines = completeLines(readHead(path, HEAD_BYTES), false);
  const tailLines = completeLines(readTail(path, TAIL_BYTES), true);
  const value: SessionWindows = { headLines, tailLines };
  const victim = evictionVictim(sessionReadCache);
  if (victim !== null) sessionReadCache.delete(victim);
  sessionReadCache.set(key, { value, insertedAtMs: nowMs, lastAccessMs: nowMs });
  return value;
}

/** spec §5.1: walks `projectsRoot` two levels deep (candidate project dirs, then each one's own
 * `*.jsonl` session files), containment-checking every directory and file before it is opened
 * (§12.2) — never a crash on a symlink escape, a broken symlink, or a stray non-directory entry. */
function scanProjectsAndSessions(nowMs: number): { projectDirs: string[]; sessions: ScannedSessionInput[] } {
  const projectDirs: string[] = [];
  const sessions: ScannedSessionInput[] = [];

  for (const entry of listDirOrEmpty(projectsRootLexical)) {
    const joined = containedJoin(projectsRootLexical, entry);
    if (joined === null) continue;
    const resolvedProjectDir = resolveContained(projectsRootResolved, joined);
    if (resolvedProjectDir === null) continue;

    const projectEntries = listDirIfDirectory(resolvedProjectDir);
    if (projectEntries === null) continue; // not a directory (spec §5.1 step 1)
    projectDirs.push(entry);

    for (const sessionEntry of projectEntries) {
      const match = /^(.+)\.jsonl$/.exec(sessionEntry);
      if (!match) continue;
      const sessionId = match[1]!;

      const sessionJoined = containedJoin(resolvedProjectDir, sessionEntry);
      if (sessionJoined === null) continue;
      const resolvedSessionFile = resolveContained(projectsRootResolved, sessionJoined);
      if (resolvedSessionFile === null) continue;

      const obs = statOrNull(resolvedSessionFile);
      if (obs === null) continue;

      const { headLines, tailLines } = readSessionWindows(resolvedSessionFile, obs, nowMs);

      // subagentCount (spec §5.1 step 3): a plain readdir + regex count, never a content read —
      // the session-id directory sits inside an already-contained project directory and its name
      // (`sessionId`) is a slash-free basename captured from a real `readdir` entry above, so a
      // plain join cannot escape lexically; no file content is opened to produce this number.
      const subagentsDir = join(resolvedProjectDir, sessionId, 'subagents');
      const subagentCount = listDirOrEmpty(subagentsDir).filter((n) => AGENT_FILE_RE.test(n)).length;

      const previousSizeBytes = previousSizeByPath.get(resolvedSessionFile) ?? null;
      previousSizeByPath.set(resolvedSessionFile, obs.sizeBytes);

      sessions.push({
        id: sessionId,
        projectDir: entry,
        sizeBytes: obs.sizeBytes,
        mtimeIso: new Date(obs.mtimeMs).toISOString(),
        headLines,
        tailLines,
        previousSizeBytes,
        subagentCount,
      });
    }
  }

  return { projectDirs, sessions };
}

/** Parses an already-read `agent-<id>.meta.json` body, tolerantly: malformed JSON degrades to
 * `null` (treated exactly like a missing meta.json, spec §5.5), anything else propagates
 * (`fail-closed-edges` obligation 1 — a narrow, discriminating catch that unconditionally
 * re-throws on its fall-through, never a bare `catch {}`). */
function parseMetaOrNull(text: string): SubagentEntry['meta'] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as SubagentEntry['meta']) : null;
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

/** Reads every `agent-*.jsonl` sidecar under `<projectDir>/<sessionId>/subagents/` (spec §5.5) and
 * turns it into the `Agent[]` tree via `core/subagents.ts#deriveAgents` (pure). `meta.json` is
 * untrusted input: read as bounded text only, parsed tolerantly via `parseMetaOrNull` above (a
 * parse failure degrades to `meta: null`, never a crash), and NONE of its fields are ever joined
 * into a path — the only path-forming value is `agentId`, captured by the regex below from a real
 * `readdir` entry. */
function readSubagentsFor(projectDir: string, sessionId: string, nowIso: string): Agent[] {
  const resolvedProjectDir = containedJoin(projectsRootResolved, projectDir);
  if (resolvedProjectDir === null) return [];
  const subagentsDir = join(resolvedProjectDir, sessionId, 'subagents');

  const entries: SubagentEntry[] = [];
  for (const name of listDirOrEmpty(subagentsDir)) {
    const match = AGENT_FILE_RE.exec(name);
    if (!match) continue;
    const agentId = match[1]!;
    const jsonlPath = join(subagentsDir, name);
    const obs = statOrNull(jsonlPath);
    const metaPath = join(subagentsDir, `agent-${agentId}.meta.json`);
    const metaText = readTextCapped(metaPath, META_CAP_BYTES);
    const meta = metaText === null ? null : parseMetaOrNull(metaText);
    entries.push({
      agentId,
      meta,
      sizeBytes: obs?.sizeBytes ?? 0,
      mtimeIso: obs === null ? null : new Date(obs.mtimeMs).toISOString(),
      birthtimeIso: obs === null ? null : new Date(obs.birthtimeMs).toISOString(),
      previousSizeBytes: previousSizeByPath.get(jsonlPath) ?? null,
    });
  }
  return deriveAgents({ subagents: entries, nowIso });
}

/** spec §9: discover -> cap-select (200) -> read -> index. `readSelectedCampaigns` already holds
 * its own 5s cache (task 16); this file adds no second one on top of it. */
function computeBadgeIndex(nowMs: number): { bySessionId: Map<string, Badge[]>; skippedBadges: number } {
  const candidates = discoverCampaignCandidates(tribeRootResolved);
  const selection: CampaignSelector[] = selectCampaigns(candidates, CAMPAIGN_CAP);
  const { scans, skippedBadges: adapterSkipped } = readSelectedCampaigns(tribeRootResolved, selection, nowMs);
  const { index, skippedBadges: badgeSkipped } = buildBadgeIndex(scans, processAlive);
  return { bySessionId: index, skippedBadges: adapterSkipped + badgeSkipped };
}

function jsonNotFound(message: string): Response {
  return Response.json({ error: message }, { status: 404 });
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(req) {
    const route = parseRoute(req.url);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    switch (route.kind) {
      case 'api_projects': {
        const { projectDirs, sessions } = scanProjectsAndSessions(nowMs);
        const { bySessionId, skippedBadges } = computeBadgeIndex(nowMs);
        const index = buildScanIndex(projectDirs, sessions, bySessionId, nowIso);
        const { recent, older } = partitionProjects(index.projects, nowMs);
        const projects = route.all ? index.projects : recent;
        const olderCount = route.all ? 0 : older.length;
        return Response.json({ projects, olderCount, skippedBadges });
      }

      case 'api_sessions': {
        const { projectDirs, sessions } = scanProjectsAndSessions(nowMs);
        const { bySessionId } = computeBadgeIndex(nowMs);
        const index = buildScanIndex(projectDirs, sessions, bySessionId, nowIso);
        const project = index.projects.find((p) => p.dir === route.project);
        if (project === undefined) return jsonNotFound(`no project ${route.project} under the projects root`);
        return Response.json({ project, sessions: index.sessionsByProject.get(route.project) ?? [] });
      }

      case 'api_session': {
        const { projectDirs, sessions } = scanProjectsAndSessions(nowMs);
        const { bySessionId } = computeBadgeIndex(nowMs);
        const index = buildScanIndex(projectDirs, sessions, bySessionId, nowIso);
        const session = index.sessionIndex.get(route.sessionId);
        if (session === undefined) {
          // spec §5.2's exact message.
          return jsonNotFound(`no session ${route.sessionId} under ~/.claude/projects`);
        }
        const subagents = readSubagentsFor(session.projectDir, session.id, nowIso);
        return Response.json({ session, subagents, badges: session.badges });
      }

      default:
        // Everything else (the SPA shell, `/healthz`, `/assets/*`, `/api/rows` and friends,
        // `bad_request` shapes) is out of THIS task's scope (Tasks 18-20 own it) — a flat,
        // one-line-body JSON 404, never a crash (`fail-closed-edges`).
        return jsonNotFound('not found');
    }
  },
});

console.log(`tribe viewer: http://127.0.0.1:${server.port} (projects root: ${projectsRootResolved}) — read-only, refresh to update`);
