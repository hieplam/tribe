// serve.ts — the composition root (spec §7/§12). INCREMENTAL rewrite across Tasks 17->20 (Shaman/
// Warchief Resolution, this task): the pre-consolidation status-page/live-processes body could not
// load at all — every one of its `./core/live/*` and `./adapters/{scan,transcript}.adapter.ts`
// imports named a file already deleted by Tasks 2-16 as their pure logic moved into `core/*.ts` —
// so it was not "working code" being destroyed, it was dead weight blocking the file from booting.
// `core/derive.ts`/`core/render.ts` are NOT deleted (Task 28 owns that); this file simply stops
// importing them.
//
// Task 17 established the minimal BOOTABLE shape: resolve the projects root (D32), wire the real
// `fs.adapter`/`campaign.adapter` + pure `core/scan.ts` to serve exactly three routes
// (`/api/projects`, `/api/sessions`, `/api/session/<id>`), one-line-body JSON 404 for everything
// else. Task 18 added `/api/rows`, `/api/block`, `/api/spill` (spec §3.2, §6.3, §7.6): every path
// joined for those routes goes through `containedJoin` + the resolved check of D14
// (`resolveContained`, used by every route below), and the only DECISION logic — the backward
// window walk, the per-row candidate conversion, in-window pairing, and the D27 orphans wire
// operation — lives in `core/window.ts`/`core/pair.ts` (`pure-core.md`); this file performs
// exactly the reads those pure functions ask for. Task 19 added `/events` (one poll loop per
// stream, `adapters/poller.adapter.ts` the only clock owner).
//
// Task 20 (this task) finishes the composition root: strict argument parsing (no flag ever
// consumes a following flag's own name as its value, `fail-closed-edges` obligation 1), the
// `Host`/`Origin` DNS-rebinding gate (spec §12.5), `X-Content-Type-Options: nosniff` on EVERY
// response (via `withNosniff`) plus the CSP on the HTML document responses (the SPA shell), the
// `dist/` static-asset allowlist loaded into a `Map` once at boot (spec
// §12.4), fail-closed startup (a bad `--port`, an unknown flag, a port already bound, or a
// missing `dist/index.html` all refuse with one stderr line and the table's exit code — spec
// §13 — never a stack trace), `CLAUDE_CONFIG_DIR` validated and resolved exactly once at boot
// (D32a), the v2 `/healthz` body (spec §10.4), and the one routing rule for a path outside the
// table (spec §3.2's closing paragraph: the SPA shell for `/`, `/index.html`, `/p/*`, `/s/*`;
// JSON 404 — `{"error":"not found","path":"<path>"}` — for everything else). `HOME` and
// `process.argv` are read ONLY in this file (spec §12.3/§12.6.5, `pure-core.md`).
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import {
  discoverCampaignCandidates,
  processAlive,
  readSelectedCampaigns,
  tribeRootUnder,
  type CampaignSelector,
} from './adapters/campaign.adapter.ts';
import { isReadableDir, listDirOrEmpty, readHead, readRange, readTail, readTextCapped, realpathOrNull, statOrNull } from './adapters/fs.adapter.ts';
import { createPoller, POLL_INTERVAL_MS, type PollerIo, type PollerMeta } from './adapters/poller.adapter.ts';
import { buildBadgeIndex, selectCampaigns } from './core/badge.ts';
import { boundedInsert, type CacheEntry, decideCache, SESSION_CACHE_TTL_MS } from './core/cache.ts';
import type { Agent, Badge, Patch, SessionSummary } from './core/model.ts';
import { containedJoin, isContainedResolved, subagentsDirOf, toolResultsDirOf, transcriptPathOf } from './core/paths.ts';
import { bindHostRefusal, hostHeaderAllowed, isLoopbackHost, isWildcardHost, lanIPv4Addresses, type NetAddress } from './core/net.ts';
import { parseRoute } from './core/routes.ts';
import { buildScanIndex, partitionProjects, sessionCacheKey, type ScannedSessionInput } from './core/scan.ts';
import { deriveAgents, type SubagentEntry } from './core/subagents.ts';
import { applyInWindowPairing, candidatesFromRows, completeBackfillOrphans, completeLines, findWindow, type ReadBack } from './core/window.ts';

// --- Argument parsing (spec §13, `fail-closed-edges` obligation 1) ---------------------------
// `--tribe-root` is deleted (spec §10.2): the viewer resolves both roots from `HOME`/
// `CLAUDE_CONFIG_DIR` alone. `--host` (default 127.0.0.1) opens the viewer to the local network
// when the owner asks for it — the `tribe --remote` flag, modelled on kanna's.
const KNOWN_FLAGS = new Set(['--port', '--host']);

/** Prints exactly one stderr line and exits — every refusal in this file's boot sequence goes
 * through this one function, so "one line, never a stack trace" (spec §13) is enforced in one
 * place rather than at each call site. */
function fail(exitCode: number, message: string): never {
  console.error(message);
  process.exit(exitCode);
}

/** Walks `process.argv` (skipping the interpreter and script path) recognizing `--port` and `--host`.
 * Never lets a flag's value be another flag's name — `--port --foo` is a MISSING value, not
 * `--port` reading `"--foo"` as its argument (the exact class of bug `fail-closed-edges`
 * obligation 1 names: `--card --base <sha>` reading `--base` as the card's name, campaign
 * gap-gate-2026-09-10). An unrecognized token — flag-shaped or not — is refused by name. */
function parseArgv(argv: string[]): { portRaw: string | undefined; host: string } {
  const args = argv.slice(2);
  let portRaw: string | undefined;
  let host = '127.0.0.1';
  let i = 0;
  while (i < args.length) {
    const token = args[i]!;
    if (!KNOWN_FLAGS.has(token)) fail(2, `viewer: unknown flag ${token}`);
    const value = args[i + 1];
    const valueMissing = value === undefined || KNOWN_FLAGS.has(value) || value.startsWith('--');
    if (token === '--port') {
      if (valueMissing) fail(2, `viewer: --port expects an integer 1-65535, got ${JSON.stringify(value ?? '')}`);
      portRaw = value;
    } else {
      if (valueMissing || value === '') fail(2, `viewer: --host expects an address, got ${JSON.stringify(value ?? '')}`);
      host = value;
    }
    i += 2;
  }
  return { portRaw, host };
}

/** `--port abc`, `--port 0`, `--port 70000` all refuse with the SAME message (spec §13) — today
 * (B14) `Number('abc')` is `NaN`, which `Bun.serve` silently turns into a random port; this
 * refuses all three before `Bun.serve` is ever called. */
function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 4321;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > 65535) {
    fail(2, `viewer: --port expects an integer 1-65535, got ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

const parsedArgs = parseArgv(process.argv);
const port = parsePort(parsedArgs.portRaw);
const bindHost = parsedArgs.host;
const localAddresses: NetAddress[] = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
const bindRefusal = bindHostRefusal(bindHost, localAddresses);
if (bindRefusal !== null) fail(2, bindRefusal);
/** Bound to anything but loopback: reachable from other devices, so the Host gate widens. */
const networkBound = !isLoopbackHost(bindHost);

// D32a: `CLAUDE_CONFIG_DIR` when set and non-empty, else `<HOME>/.claude` — `HOME`/
// `CLAUDE_CONFIG_DIR` are the only environment values this file reads (spec §12.3), and only
// here. An empty string is treated as unset (spec §13); a SET, non-empty, invalid value is a
// typed refusal, never a silent fall back to `~/.claude` (D32a). The readable-directory check is
// `fs.adapter.ts#isReadableDir` — the DELIBERATE opposite of `listDirOrEmpty`'s missing/unreadable
// folding — so this composition root names no `node:fs` import of its own (D16).
function resolveProjectsRootLexical(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir !== undefined && configDir.length > 0) {
    if (!isReadableDir(configDir)) {
      fail(2, `viewer: CLAUDE_CONFIG_DIR=${configDir} is not a readable directory`);
    }
    return join(configDir, 'projects');
  }
  return join(process.env.HOME ?? '', '.claude', 'projects');
}

// The tribe root under HOME is resolved through `campaign.adapter.ts#tribeRootUnder` — the one
// place in the package that spells the tribe-root directory name (§9/§11.4), so this composition
// root names no such literal itself (structure.test.ts keeps that fact inside the campaign adapter).
const tribeRootLexical = tribeRootUnder(process.env.HOME ?? '');
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
// D27's forward orphan scan reads the range the client already holds — `[to, eof)` — to find a
// specific orphan's result row. That range grows with the whole remaining transcript, so the read
// is CAPPED (spec §6.5: nothing a request holds is proportional to transcript size): an orphan whose
// result sits beyond the cap simply stays an orphan, exactly as one further back than the window does.
const ORPHAN_SCAN_CAP = 4 * 1024 * 1024;

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

/** A genuine Node filesystem error (an errno), the one class the request-level boundary fails
 * closed on (`fail-closed-edges` obligation 1) — anything else propagates as an unexpected bug. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
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
// same millisecond can never serve a stale title forever. The 500-entry LRU bound and the
// evict-then-insert are `core/cache.ts#boundedInsert`'s; the absolute-expiry WINDOW is the spec's
// own 60 s (`SESSION_CACHE_TTL_MS`), passed explicitly to `decideCache` — DISTINCT from the §9
// badge scan's 5 s.
interface SessionWindows {
  headLines: string[];
  tailLines: string[];
}
const sessionReadCache = new Map<string, CacheEntry<SessionWindows>>();
// D2's "grew since the previous scan" half needs the previous scan's size, kept across requests
// keyed by the session's resolved absolute path — with the SAME bounded/evicted lifecycle as the
// session read cache (spec §5.4: "held in the same bounded map"), never an unbounded `Map`.
const previousSizeByPath = new Map<string, CacheEntry<number>>();

function rememberPreviousSize(path: string, sizeBytes: number, nowMs: number): number | null {
  const previous = previousSizeByPath.get(path)?.value ?? null;
  boundedInsert(previousSizeByPath, path, sizeBytes, nowMs);
  return previous;
}

function readSessionWindows(path: string, obs: { sizeBytes: number; mtimeMs: number; inode: number }, nowMs: number): SessionWindows {
  const key = sessionCacheKey(path, obs);
  const decision = decideCache(key, sessionReadCache, nowMs, SESSION_CACHE_TTL_MS);
  if (decision.kind === 'hit') {
    const existing = sessionReadCache.get(key);
    if (existing !== undefined) sessionReadCache.set(key, { ...existing, lastAccessMs: nowMs });
    return decision.value;
  }
  const headLines = completeLines(readHead(path, HEAD_BYTES), false);
  const tailLines = completeLines(readTail(path, TAIL_BYTES), true);
  const value: SessionWindows = { headLines, tailLines };
  boundedInsert(sessionReadCache, key, value, nowMs);
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

      // subagentCount (spec §5.1 step 3): a regex count over the subagents directory listing, never
      // a content read. The `sessionId` basename cannot escape lexically, but the `subagents`
      // directory itself CAN be a symlink pointing outside the projects root (D14), so it is
      // realpath-resolved and proven contained BEFORE it is listed — an escaping one counts 0, never
      // leaks an out-of-root directory's entries (C1). `listDirOrEmpty` is called only on the
      // already-resolved, already-contained real directory.
      const resolvedSubagentsDir = resolveContainedSubagentsDir(resolvedProjectDir, sessionId);
      const subagentCount = resolvedSubagentsDir === null ? 0 : listDirOrEmpty(resolvedSubagentsDir).filter((n) => AGENT_FILE_RE.test(n)).length;

      const previousSizeBytes = rememberPreviousSize(resolvedSessionFile, obs.sizeBytes, nowMs);

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

/** Resolves the real, CONTAINED `<projectDir>/<sessionId>/subagents/` directory (D14, C1) — or
 * `null` when it does not exist, is a broken/looping symlink, or resolves OUTSIDE the projects root.
 * A hostile `subagents` symlink — or a symlink loop — must never be listed or read through: it is
 * realpath-resolved and proven contained here first, and `realpathOrNull` (fixed to fail closed on
 * `ELOOP`/`ENOTDIR`) turns a symlink loop into `null` rather than a thrown traceback. */
function resolveContainedSubagentsDir(resolvedProjectDir: string, sessionId: string): string | null {
  const joined = subagentsDirOf(resolvedProjectDir, sessionId);
  if (joined === null) return null;
  return resolveContained(projectsRootResolved, joined);
}

/** Reads every `agent-*.jsonl` sidecar under `<projectDir>/<sessionId>/subagents/` (spec §5.5) and
 * turns it into the `Agent[]` tree via `core/subagents.ts#deriveAgents` (pure). `meta.json` is
 * untrusted input: read as bounded text only, parsed tolerantly via `parseMetaOrNull` above (a
 * parse failure degrades to `meta: null`, never a crash), and NONE of its fields are ever joined
 * into a path — the only path-forming value is `agentId`, captured by the regex below from a real
 * `readdir` entry. D14/C1: the `subagents` directory AND every `agent-<id>.jsonl` / `.meta.json`
 * sidecar is realpath-resolved and proven contained BEFORE it is stat'd or read — a sidecar that is
 * a symlink escaping the projects root contributes nothing, never surfaces its outside content. */
function readSubagentsFor(projectDir: string, sessionId: string, nowIso: string): Agent[] {
  const resolvedProjectDir = containedJoin(projectsRootResolved, projectDir);
  if (resolvedProjectDir === null) return [];
  const subagentsDir = resolveContainedSubagentsDir(resolvedProjectDir, sessionId);
  if (subagentsDir === null) return [];

  const entries: SubagentEntry[] = [];
  for (const name of listDirOrEmpty(subagentsDir)) {
    const match = AGENT_FILE_RE.exec(name);
    if (!match) continue;
    const agentId = match[1]!;
    const jsonlJoined = containedJoin(subagentsDir, name);
    const jsonlPath = jsonlJoined === null ? null : resolveContained(projectsRootResolved, jsonlJoined);
    const obs = jsonlPath === null ? null : statOrNull(jsonlPath);
    const metaJoined = containedJoin(subagentsDir, `agent-${agentId}.meta.json`);
    const metaResolved = metaJoined === null ? null : resolveContained(projectsRootResolved, metaJoined);
    const metaText = metaResolved === null ? null : readTextCapped(metaResolved, META_CAP_BYTES);
    const meta = metaText === null ? null : parseMetaOrNull(metaText);
    entries.push({
      agentId,
      meta,
      sizeBytes: obs?.sizeBytes ?? 0,
      mtimeIso: obs === null ? null : new Date(obs.mtimeMs).toISOString(),
      birthtimeIso: obs === null ? null : new Date(obs.birthtimeMs).toISOString(),
      previousSizeBytes: jsonlPath === null ? null : previousSizeByPath.get(jsonlPath)?.value ?? null,
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

function jsonBadRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function routeNotFound(path: string): Response {
  // spec §3.2 closing rule's exact body — distinct from `jsonNotFound` above (used by the API
  // routes' own messages, already asserted by `serve.api.test.ts`/`serve.reads.test.ts`): a path
  // outside the whole route table carries the path that missed, not a route-specific message.
  return Response.json({ error: 'not found', path }, { status: 404 });
}

// --- Static assets (spec §12.4) ----------------------------------------------------------------
// `dist/` is read into memory ONCE at boot into a `Map<name, {body, contentType}>` — a request for
// `/assets/<name>` is a map lookup, never a path join (no traversal surface at this route at all).
// `dist/` has no override flag (no `--dist`): an overridable asset root is a security surface for
// a read-only viewer that a fixed, boot-time-loaded location is not.
const DIST_DIR = join(import.meta.dir, 'dist');

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

interface DistAsset {
  body: Uint8Array;
  contentType: string;
}

/** A whole small file's bytes, or `null` if it is absent — built from the already-imported
 * `statOrNull`/`readRange` (task 17/18's own primitives), so no new adapter export is needed for
 * this bounded, boot-time read. */
function readWholeFileOrNull(path: string): Uint8Array | null {
  const obs = statOrNull(path);
  if (obs === null) return null;
  return readRange(path, 0, obs.sizeBytes);
}

/** Builds the boot-time `dist/` map (spec §12.4). `null` means `dist/index.html` is absent — the
 * caller refuses to start (spec §10.3): never a blank page, never a stack trace. An unknown
 * extension in `dist/assets/` is silently excluded from the map (spec §12.4: "an unknown extension
 * is not served"), and a file that vanishes between the `readdir` and the read is skipped rather
 * than crashing the boot sequence over a single stale entry. */
function loadDistOrNull(): { indexHtml: Uint8Array; assets: Map<string, DistAsset> } | null {
  const indexHtml = readWholeFileOrNull(join(DIST_DIR, 'index.html'));
  if (indexHtml === null) return null;
  const assets = new Map<string, DistAsset>();
  for (const name of listDirOrEmpty(join(DIST_DIR, 'assets'))) {
    const ext = name.slice(name.lastIndexOf('.'));
    const contentType = ASSET_CONTENT_TYPES[ext];
    if (contentType === undefined) continue;
    const body = readWholeFileOrNull(join(DIST_DIR, 'assets', name));
    if (body === null) continue;
    assets.set(name, { body, contentType });
  }
  return { indexHtml, assets };
}

const distOrNull = loadDistOrNull();
if (distOrNull === null) {
  fail(2, 'viewer: client not built — run ./install.sh (or: cd plugins/tribe/scripts/viewer && bun run build)');
}
const dist = distOrNull;

function shellResponse(): Response {
  // spec §12.5: the CSP applies to the SPA shell; `X-Content-Type-Options` is added to every
  // response uniformly by `withNosniff`, below.
  return new Response(dist.indexHtml, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
    },
  });
}

function assetResponse(name: string): Response {
  const entry = dist.assets.get(name);
  if (entry === undefined) return jsonNotFound('asset not found');
  return new Response(entry.body, { status: 200, headers: { 'content-type': entry.contentType } });
}

// --- Host/Origin (spec §12.5, DNS rebinding, B16) ----------------------------------------------

/** `new URL(origin).host` — or `null` if `origin` does not parse as a URL at all, which is itself
 * a mismatch (never a match by accident). `URL`'s constructor throws only `TypeError` on a
 * malformed input; that is the one exception this narrows on, re-throwing anything else
 * (`fail-closed-edges` obligation 1). */
function originHostOrNull(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
}

/** `true` when the request must be refused with `403`, BEFORE routing (spec §12.5): `Host` must
 * be `127.0.0.1[:port]` or `localhost[:port]`; when `Origin` is present it is held to the same
 * set. A DNS-rebinding attacker controls neither. */
function hostOrOriginRefused(req: Request): boolean {
  const host = req.headers.get('host');
  if (host === null || !hostHeaderAllowed(host, networkBound)) return true;
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  const originHost = originHostOrNull(origin);
  return originHost === null || !hostHeaderAllowed(originHost, networkBound);
}

/** Every response leaves this file through here (spec §12.5: "on every response"). */
function withNosniff(res: Response): Response {
  res.headers.set('x-content-type-options', 'nosniff');
  return res;
}

/** The full route table (spec §3.2), everything AFTER the `Host`/`Origin` gate above. Extracted
 * from `fetch` so `withNosniff` wraps every outcome from ONE call site rather than each `case`
 * needing its own wrapping — the same "one seam" discipline `withNosniff` itself follows. */
function routeResponse(req: Request): Response {
  const route = parseRoute(req.url);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  switch (route.kind) {
    case 'shell':
    case 'shell_project':
    case 'shell_session':
    case 'shell_session_agent':
      // spec §3.2 closing rule: the React router owns these addresses; the server never probes
      // the filesystem to decide between them, so all four addresses get the same shell.
      return shellResponse();

    case 'health':
      // spec §10.4: deliberately NOT the pre-consolidation `{"ok":true,"viewer":"tribe-live-viewer","v":1}` —
      // an already-running old viewer must be unrecognisable to the new runner probe.
      return Response.json({ ok: true, viewer: 'tribe-viewer', v: 2 });

    case 'asset':
      return assetResponse(route.name);

    case 'not_found':
      return routeNotFound(route.path);

    case 'bad_request':
      return Response.json({ error: route.reason }, { status: 400 });

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
        let nodes = applyInWindowPairing(candidatesFromRows(result.rows, result.from));
        let patches: Patch[] = [];
        if (route.orphans.length > 0 && result.to < obs.sizeBytes) {
          // D27: the range the client already holds — genuinely outside our own [from, to) by
          // construction — is `[to, eof)`, read here BOUNDED at `ORPHAN_SCAN_CAP` so this read is
          // independent of how large the remaining transcript is (spec §6.5). The completion itself
          // is a PURE decision over these bytes (`completeBackfillOrphans`) — this edge only reads.
          const orphanScanEnd = Math.min(obs.sizeBytes, result.to + ORPHAN_SCAN_CAP);
          const tailBytes = readRange(path, result.to, orphanScanEnd);
          const completed = completeBackfillOrphans(tailBytes, result.to, nodes, route.orphans);
          nodes = completed.nodes; // pending back-fill calls now COMPLETE at the call's anchor (§0/§16)
          patches = completed.patches;
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
        // R8: both containment refusals — lexical (joined === null) and resolved
        // (resolved === null) — are 400 "spill name refused". Only a contained name whose
        // file is absent is a 404 "spill not found" (below).
        if (joined === null) return jsonBadRequest('spill name refused');
        const resolved = resolveContained(projectsRootResolved, joined);
        if (resolved === null) return jsonBadRequest('spill name refused');
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
        // disconnect (`cancel`), a failed enqueue, OR the poller's own terminal path (I1, below).
        // Idempotent so a double-signal cannot double-decrement the counter.
        const release = (): void => {
          if (released) return;
          released = true;
          openStreams -= 1;
          poller?.stop();
        };

        // The poller's TERMINAL callback (I1): when the poll loop reaches a terminal state — the
        // file was deleted (`gone`) or a mid-stream filesystem error — the slot MUST be released, or
        // a dead/errored stream (which stopped polling but was previously only released on
        // `cancel`/enqueue-failure) permanently consumes one of the 8, and eight such streams
        // exhaust the allowance. `release` is that release, invoked exactly once. The producerless
        // ReadableStream that remains is reaped by Bun's `idleTimeout` (255 s) — the composition root
        // does NOT explicitly close the controller here, because the structural wall (§12.6 (7c))
        // refuses a bare stream-close call on any receiver as a write-capability, exactly as it
        // refuses a bare stream-write call; releasing the slot is the load-bearing guarantee the
        // 8-stream cap actually rests on.
        const onTerminal = release;

        // D6/D12/D32: the poller reads ONLY through these injected primitives. `readMeta` re-scans
        // per tick so a sidecar appearing mid-stream is detected; the containment root the scan
        // uses is already resolved from `CLAUDE_CONFIG_DIR` at boot (D32).
        const pollerIo: PollerIo = {
          statFile: (p) => statOrNull(p),
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
            poller = createPoller({ io: pollerIo, path: resolvedPath, intervalMs: POLL_INTERVAL_MS, generation, emit, onClose: onTerminal });
          },
          cancel() {
            release();
          },
        });
        return new Response(body, {
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
        });
      }

      default:
        // Unreachable: every `Route` kind is handled above (a closed union, `core/routes.ts`).
        // Kept as a fail-closed safety net rather than removed outright — never a crash.
        return jsonNotFound('not found');
    }
}

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: bindHost,
    port,
    // An SSE stream is idle between the 15 s pings; Bun's ~10 s default would close it first. 255 s
    // (Bun's max) keeps `/events` alive between pings (F55; carried over from task 17, verified by
    // this task's own `serve.security.test.ts`).
    idleTimeout: 255,
    fetch(req) {
      if (hostOrOriginRefused(req)) return withNosniff(new Response('forbidden', { status: 403 }));
      // Request-level fail-closed boundary (C1, `fail-closed-edges` obligation 1): a residual
      // filesystem error from a synchronous route (a `realpath`/`stat`/`readRange` failure the
      // per-read guards did not already absorb) becomes a typed 500 refusal with one stderr line —
      // never a thrown stack escaping into the HTTP server. The catch stays NARROW: only an errno
      // error is treated as a filesystem failure; anything else is an unexpected bug and re-throws.
      try {
        return withNosniff(routeResponse(req));
      } catch (err) {
        if (isErrnoException(err)) {
          console.error(`serve: filesystem error handling ${req.url}: ${err.code ?? err.message}`);
          return withNosniff(new Response('internal error', { status: 500 }));
        }
        throw err;
      }
    },
  });
} catch (err) {
  if (err instanceof Error && (err as { code?: unknown }).code === 'EADDRINUSE') {
    fail(1, `viewer: port ${port} is already in use`);
  }
  throw err;
}

// A specific LAN address does not answer on 127.0.0.1; the wildcard and loopback binds do.
const localHost = isWildcardHost(bindHost) || isLoopbackHost(bindHost) ? '127.0.0.1' : bindHost;
console.log(`tribe viewer: http://${localHost}:${server.port} (projects root: ${projectsRootResolved}) — read-only, refresh to update`);
if (networkBound) {
  const networkHosts = isWildcardHost(bindHost) ? lanIPv4Addresses(localAddresses) : [bindHost];
  for (const host of networkHosts) console.log(`tribe viewer: on your network at http://${host}:${server.port}`);
  console.log('tribe viewer: no password — any device on this network can read every session transcript');
}
