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
// `/events` are OUT of this task's scope — Task 20 (composition root) and Task 19 (the poller) own
// those.
//
// Task 18 adds `/api/rows`, `/api/block`, `/api/spill` (spec §3.2, §6.3, §7.6): every path this
// file joins for the three routes goes through `containedJoin` + the resolved check of D14
// (`resolveContained`, already used by every other route below), and the only DECISION logic —
// the backward window walk, the per-row candidate conversion, in-window pairing, and the D27
// orphans wire operation — lives in `core/window.ts`/`core/pair.ts` (`pure-core.md`); this file
// performs exactly the reads those pure functions ask for.
import { join } from 'node:path';
import {
  discoverCampaignCandidates,
  processAlive,
  readSelectedCampaigns,
  type CampaignSelector,
} from './adapters/campaign.adapter.ts';
import { listDirOrEmpty, readHead, readRange, readTail, readTextCapped, realpathOrNull, statOrNull } from './adapters/fs.adapter.ts';
import { createPoller, POLL_INTERVAL_MS, type PollerIo, type PollerMeta } from './adapters/poller.adapter.ts';
import { buildBadgeIndex, selectCampaigns } from './core/badge.ts';
import { type CacheEntry, decideCache, evictionVictim } from './core/cache.ts';
import type { Agent, Badge, Patch, SessionSummary } from './core/model.ts';
import { containedJoin, isContainedResolved, subagentsDirOf, toolResultsDirOf, transcriptPathOf } from './core/paths.ts';
import { parseRoute } from './core/routes.ts';
import { buildScanIndex, partitionProjects, sessionCacheKey, type ScannedSessionInput } from './core/scan.ts';
import { deriveAgents, type SubagentEntry } from './core/subagents.ts';
import { applyInWindowPairing, candidatesFromRows, completeLines, findWindow, orphanPatches, type ReadBack } from './core/window.ts';

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
const ROW_READ_CAP = 8 * 1024 * 1024 + 1; // ROW_CAP + 1 (task 18): enough to hold any VALID row plus its terminator
const SPILL_READ_CAP = 2 * 1024 * 1024; // spec §7.6

// spec §6.2/§6.5: at most 8 concurrent SSE streams; the 9th is refused. This counter is the ONLY
// per-stream bound `serve.ts` owns — every other bound lives in the poller/core (§6.5). Bun.serve
// runs the fetch handler to completion on a single thread, so incrementing here (before the
// Response returns) and decrementing exactly once on stream cancel is race-free.
const MAX_STREAMS = 8;
let openStreams = 0;
// D12: a fresh, opaque `generation` per connection so the client knows a reconnect's snapshot
// REPLACES rather than extends what it holds. A monotonic counter satisfies "opaque + fresh".
let eventGeneration = 0;

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

/** Resolves the real, contained transcript file for `sessionId` (+ optional `agentId`) — the
 * MAIN session `.jsonl` when `agentId` is `null`, or its `subagents/agent-<id>.jsonl` sidecar
 * otherwise (spec §5.5, §12.2). `null` means "no such session/agent" — the caller turns that into
 * a 404, never a crash. Shared by `/api/rows`, `/api/block` and `/api/spill` (task 18). */
function resolveTranscriptFile(sessionId: string, agentId: string | null, nowMs: number, nowIso: string): string | null {
  const { projectDirs, sessions } = scanProjectsAndSessions(nowMs);
  const index = buildScanIndex(projectDirs, sessions, new Map(), nowIso);
  const session = index.sessionIndex.get(sessionId);
  if (session === undefined) return null;
  const projectDirAbs = containedJoin(projectsRootResolved, session.projectDir);
  if (projectDirAbs === null) return null;

  let target: string | null;
  if (agentId === null) {
    target = transcriptPathOf(projectDirAbs, sessionId);
  } else {
    const subDir = subagentsDirOf(projectDirAbs, sessionId);
    target = subDir === null ? null : containedJoin(subDir, `agent-${agentId}.jsonl`);
  }
  if (target === null) return null;
  return resolveContained(projectsRootResolved, target);
}

/** Resolves the real, contained `tool-results/` directory for `sessionId` — `/api/spill`'s
 * containment root (spec §7.6, D14). `null` means "no such session", turned into a 404. */
function resolveToolResultsDir(sessionId: string, nowMs: number, nowIso: string): string | null {
  const { projectDirs, sessions } = scanProjectsAndSessions(nowMs);
  const index = buildScanIndex(projectDirs, sessions, new Map(), nowIso);
  const session = index.sessionIndex.get(sessionId);
  if (session === undefined) return null;
  const projectDirAbs = containedJoin(projectsRootResolved, session.projectDir);
  if (projectDirAbs === null) return null;
  const dir = toolResultsDirOf(projectDirAbs, sessionId);
  if (dir === null) return null;
  return resolveContained(projectsRootResolved, dir);
}

/** Reads the row starting at the byte offset `at` in `path` (sized `fileSize`) — `null` means
 * refused: `at` is not a real row boundary (the byte before it is not `0x0A`, and `at` is not 0),
 * `at` is past EOF, or the row is not a COMPLETE, parseable one within `ROW_READ_CAP` (an
 * oversized row has `expandable: false` and is never reached here). Never throws
 * (`fail-closed-edges` obligation 1): a malformed row degrades to `null`, turned into a 404. */
function readRowAt(path: string, at: number, fileSize: number): Record<string, unknown> | null {
  if (at < 0 || at >= fileSize) return null;
  if (at > 0) {
    const prevByte = readRange(path, at - 1, at);
    if (prevByte.length !== 1 || prevByte[0] !== 0x0a) return null; // not a row boundary
  }
  const readLen = Math.min(fileSize - at, ROW_READ_CAP);
  const chunk = readRange(path, at, at + readLen);
  const nlIdx = chunk.indexOf(0x0a);
  if (nlIdx === -1) return null; // no complete row within the cap (oversized, or a genuine tail carry)
  const text = new TextDecoder('utf-8').decode(chunk.subarray(0, nlIdx));
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

/** The row's `i`-th content block, addressed exactly as spec §4 defines `at`+`i` (task 18's
 * `/api/block`): `message.content[i]` for a message row (bucket A), or the row itself (`i` must be
 * `0`) for every other row shape — an `attachment` row's own `attachment` object, or the whole
 * parsed row for anything else. `undefined` means `i` is out of bounds — the caller's 404. */
function blockAt(row: Record<string, unknown>, i: number): unknown {
  const message = row.message;
  if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
    const content = (message as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      return i >= 0 && i < content.length ? content[i] : undefined;
    }
  }
  if (i !== 0) return undefined;
  if (row.type === 'attachment') {
    const attachment = row.attachment;
    return typeof attachment === 'object' && attachment !== null ? attachment : {};
  }
  return row;
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

/** A well-formed placeholder for the vanishingly-rare window between a stream opening (its file
 * confirmed present) and a `readMeta` tick finding the session gone from the index. The poller's
 * own `stat` sees the deletion first and emits `gone`, so this keeps `PollerMeta` total without
 * ever surfacing to a live client. */
function minimalSummary(sessionId: string): SessionSummary {
  return { id: sessionId, projectDir: '', title: sessionId, titleSource: 'session-id', sizeBytes: 0, mtimeIso: new Date(0).toISOString(), live: false, subagentCount: 0, badges: [], projects: [] };
}

/** The `PollerMeta` snapshot for one focused session view (spec §6.2) — the composition root's
 * scan, scoped to a single session. Called on connect (for `hello`) and once per poll tick (so a
 * new sidecar, a badge change, or a liveness flip becomes a `meta` frame); the poller decides
 * whether it CHANGED, this only reads it. `nowMs`/`nowIso` drive the liveness computation exactly
 * as the `/api/session` route's do. */
function readEventMeta(sessionId: string, nowMs: number, nowIso: string): PollerMeta {
  const { projectDirs, sessions } = scanProjectsAndSessions(nowMs);
  const { bySessionId } = computeBadgeIndex(nowMs);
  const index = buildScanIndex(projectDirs, sessions, bySessionId, nowIso);
  const session = index.sessionIndex.get(sessionId);
  if (session === undefined) return { session: minimalSummary(sessionId), agents: [], badges: [], live: false };
  const agents = readSubagentsFor(session.projectDir, session.id, nowIso);
  return { session, agents, badges: session.badges, live: session.live };
}

function jsonNotFound(message: string): Response {
  return Response.json({ error: message }, { status: 404 });
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  // An SSE stream is idle between the 15 s pings; Bun's ~10 s default would close it first. 255 s
  // (Bun's max) keeps `/events` alive between pings. (F55 — the idle-timeout contract is refined in
  // task 20; this is the minimum this task's stream needs to survive.)
  idleTimeout: 255,
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

      case 'api_rows': {
        const path = resolveTranscriptFile(route.sessionId, route.agentId, nowMs, nowIso);
        const obs = path === null ? null : statOrNull(path);
        if (path === null || obs === null) return jsonNotFound(`no session ${route.sessionId} under ~/.claude/projects`);
        if (route.before !== null && route.before > obs.sizeBytes) {
          return Response.json({ error: 'before is past EOF' }, { status: 400 });
        }
        const eofParam = route.before ?? obs.sizeBytes;
        const readBack: ReadBack = (end, len) => readRange(path, end - len, end);
        const result = findWindow(readBack, eofParam, route.limit);
        const nodes = applyInWindowPairing(candidatesFromRows(result.rows, result.from));
        let patches: Patch[] = [];
        if (route.orphans.length > 0 && result.to < obs.sizeBytes) {
          // D27: the range the client already holds — genuinely outside our own [from, to) by
          // construction — is exactly `[to, eof)`.
          const tailBytes = readRange(path, result.to, obs.sizeBytes);
          patches = orphanPatches(tailBytes, result.to, nodes, route.orphans);
        }
        return Response.json({ nodes, patches, from: result.from, to: result.to, truncatedBefore: result.truncatedBefore });
      }

      case 'api_block': {
        const path = resolveTranscriptFile(route.sessionId, route.agentId, nowMs, nowIso);
        const obs = path === null ? null : statOrNull(path);
        if (path === null || obs === null) return jsonNotFound(`no session ${route.sessionId} under ~/.claude/projects`);
        const row = readRowAt(path, route.at, obs.sizeBytes);
        if (row === null) return jsonNotFound('at is not a row boundary');
        const block = blockAt(row, route.i);
        if (block === undefined) return jsonNotFound("i is past the row's block count");
        return Response.json({ block });
      }

      case 'api_spill': {
        const dir = resolveToolResultsDir(route.sessionId, nowMs, nowIso);
        if (dir === null) return jsonNotFound(`no session ${route.sessionId} under ~/.claude/projects`);
        const joined = containedJoin(dir, route.name);
        if (joined === null) return jsonNotFound('spill name refused');
        const resolved = resolveContained(projectsRootResolved, joined);
        if (resolved === null) return jsonNotFound('spill not found');
        const obs = statOrNull(resolved);
        if (obs === null) return jsonNotFound('spill not found');
        const text = new TextDecoder('utf-8').decode(readRange(resolved, 0, Math.min(obs.sizeBytes, SPILL_READ_CAP)));
        return new Response(text, { headers: { 'content-type': 'text/plain' } });
      }

      case 'events': {
        // spec §6.2: one poll loop per open session view. `serve.ts` owns ONLY the socket, the
        // stream-slot count, and the fresh generation; every tail/window/normalize/pair/encode
        // DECISION belongs to the poller + core (`pure-core.md`). This handler stays synchronous,
        // so the slot check/increment is race-free against a concurrent 9th request.
        const path = resolveTranscriptFile(route.sessionId, route.agentId, nowMs, nowIso);
        const obs = path === null ? null : statOrNull(path);
        if (path === null || obs === null) return jsonNotFound(`no session ${route.sessionId} under ~/.claude/projects`);
        if (openStreams >= MAX_STREAMS) return new Response('too many live streams', { status: 503 });

        openStreams += 1;
        eventGeneration += 1;
        const generation = String(eventGeneration);
        const resolvedPath = path;
        const sessionId = route.sessionId;

        let poller: { stop: () => void } | null = null;
        let released = false;
        // Releases the slot EXACTLY once (spec §6.5) and stops the poll loop — on client
        // disconnect (`cancel`) or a failed enqueue. Idempotent so a double-signal cannot
        // double-decrement the counter.
        const release = (): void => {
          if (released) return;
          released = true;
          openStreams -= 1;
          poller?.stop();
        };

        // D6/D12/D32: the poller reads ONLY through these injected primitives. `readMeta` re-scans
        // per tick so a sidecar appearing mid-stream is detected; the containment root the scan
        // uses is already resolved from `CLAUDE_CONFIG_DIR` at boot (D32).
        const pollerIo: PollerIo = {
          stat: (p) => statOrNull(p),
          readRange: (p, s, e) => readRange(p, s, e),
          readMeta: () => readEventMeta(sessionId, Date.now(), new Date().toISOString()),
        };

        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (encoded: string): void => {
              try {
                controller.enqueue(encoder.encode(encoded));
              } catch {
                // The only throw here is enqueueing onto a controller the client already closed —
                // that IS the disconnect signal, so release the slot and stop polling.
                release();
              }
            };
            poller = createPoller({ io: pollerIo, path: resolvedPath, intervalMs: POLL_INTERVAL_MS, generation, emit });
          },
          cancel() {
            release();
          },
        });
        return new Response(body, {
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
        });
      }

      case 'bad_request':
        return Response.json({ error: route.reason }, { status: 400 });

      default:
        // Everything else (the SPA shell, `/healthz`, `/assets/*`) is out of THIS task's scope
        // (Task 20 owns it) — a flat, one-line-body JSON 404, never a crash (`fail-closed-edges`).
        return jsonNotFound('not found');
    }
  },
});

console.log(`tribe viewer: http://127.0.0.1:${server.port} (projects root: ${projectsRootResolved}) — read-only, refresh to update`);
