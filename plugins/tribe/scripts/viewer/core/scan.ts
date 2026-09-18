/**
 * core/scan.ts — the project/session index (spec §5, §5.6/D10). PURE (`pure-core.md`): every
 * function here takes already-read directory listings and already-`stat`ed observations (plus, for
 * title/`cwd` resolution, already-read HEAD/TAIL line arrays — the same bounded-window discipline
 * `core/title.ts` already uses) and returns a plain data index. Nothing here calls `readdir`,
 * `stat`, opens a file, or reads the clock (`nowIso`/`nowMs` always arrive as a parameter, never
 * `Date.now()`) — every one of those is the composition root's job, feeding this module through
 * `fs.adapter.ts` and `campaign.adapter.ts`.
 *
 * Reuses the existing pure modules rather than re-deciding anything they already own:
 * `core/title.ts#resolveTitle` for the title, `core/records.ts#parseRecordLines` to read `cwd` out
 * of an already-read HEAD window (§5.1 step 4: "the first non-null `cwd` field seen in any of a
 * project's sessions' head reads" — "first" means the order `sessions` arrives in, which is the
 * composition root's own `readdir` order), and `core/liveness.ts#isLive` for D2.
 */

import { isLive } from './liveness.ts';
import type { Badge, Project, SessionSummary } from './model.ts';
import { parseRecordLines } from './records.ts';
import { resolveTitle } from './title.ts';

const DEFAULT_WINDOW_DAYS = 30;

/** One already-scanned session file, exactly as `fs.adapter.ts` + a `readdir` of its
 * `subagents/` sibling would produce it — no decision made yet. `previousSizeBytes` is the
 * previous scan's size for THIS exact `(projectDir, id)` pair, or `null` on the first scan (D2,
 * `core/liveness.ts`) — held by the composition root's own bounded map, not by this module. */
export interface ScannedSessionInput {
  id: string; // sessionId, the .jsonl basename
  projectDir: string; // the encoded on-disk directory name holding this file
  sizeBytes: number;
  mtimeIso: string;
  headLines: readonly string[]; // already-read, already-decoded first 64 KiB, split into lines
  tailLines: readonly string[]; // already-read, already-decoded last 256 KiB, split into lines
  previousSizeBytes: number | null;
  subagentCount: number;
}

export interface ScanIndex {
  /** Every project directory the walk found (spec §5.1 step 1) — including one with ZERO session
   * files, which still appears with `sessionCount: 0` (the walk found the directory; it never
   * hides an empty one). Ordered by `newestMtimeIso` descending (§5.1); a project with no sessions
   * has no `newestMtimeIso` and sorts as the oldest. */
  projects: Project[];
  /** Every project's OWN session list, ordered `mtimeIso` descending (§5.1). Sessions are never
   * filtered by the project's age (D10) — this map always carries every session a project has,
   * regardless of `partitionProjects` below. */
  sessionsByProject: Map<string, SessionSummary[]>;
  /** `sessionId -> the canonical SessionSummary for that id` — resolved to the copy with the
   * newest `mtimeIso` when the same id appears under more than one project directory (spec §5.2,
   * a `relocated` row). `projects` on every returned `SessionSummary` (canonical or per-project)
   * names EVERY holder, not just the one this map or list happens to return. */
  sessionIndex: Map<string, SessionSummary>;
}

function isoToMs(iso: string | null): number {
  if (iso === null) return -Infinity; // no timestamp at all sorts as the oldest possible (never a Date.now() read)
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** The first non-null `cwd` field found by scanning `headLines` in order (§5.1 step 4) — reuses
 * `core/records.ts#parseRecordLines`, the same tolerant parse the normalizer uses, rather than
 * re-implementing line parsing here. */
function cwdFromHead(headLines: readonly string[]): string | null {
  const { records } = parseRecordLines([...headLines]);
  for (const record of records) {
    if (typeof record.cwd === 'string' && record.cwd.length > 0) return record.cwd;
  }
  return null;
}

/** Builds one `SessionSummary` from an already-scanned input (spec §4/§5.3/§5.4): title/`titleSource`
 * via `core/title.ts`, `live` via `core/liveness.ts` (D2), `badges` via the injected index (spec §9
 * — usually 0 or 1, 2+ on a real cross-repo-key collision), and `projects` via the caller-supplied
 * full holder list (spec §5.2 — every encoded directory that has a file with this session id). */
function buildSummary(
  input: ScannedSessionInput,
  nowIso: string,
  badgesBySessionId: ReadonlyMap<string, readonly Badge[]>,
  projectsHoldingId: readonly string[],
): SessionSummary {
  const { title, titleSource } = resolveTitle([...input.headLines], [...input.tailLines], input.id);
  const live = isLive({
    sizeBytes: input.sizeBytes,
    previousSizeBytes: input.previousSizeBytes,
    mtimeIso: input.mtimeIso,
    nowIso,
  });
  return {
    id: input.id,
    projectDir: input.projectDir,
    title,
    titleSource,
    sizeBytes: input.sizeBytes,
    mtimeIso: input.mtimeIso,
    live,
    subagentCount: input.subagentCount,
    badges: [...(badgesBySessionId.get(input.id) ?? [])],
    projects: [...projectsHoldingId],
  };
}

/** Builds the whole scan index (spec §5.1/§5.2/§5.3/§5.4/§9). `projectDirs` is every directory a
 * directory listing of the projects root found (§5.1 step 1) — including ones with no session
 * file at all;
 * `sessions` is every session file found under any of them (§5.1 step 2-3). Neither list is
 * derived from the other here: the composition root supplies both from its own two-step walk, so
 * this function never has to guess which directories exist versus which merely hold a session. */
export function buildScanIndex(
  projectDirs: readonly string[],
  sessions: readonly ScannedSessionInput[],
  badgesBySessionId: ReadonlyMap<string, readonly Badge[]>,
  nowIso: string,
): ScanIndex {
  // Every encoded directory that holds a file with a given session id (spec §5.2), sorted for a
  // deterministic `projects` field regardless of scan/input order.
  const holdersById = new Map<string, string[]>();
  for (const s of sessions) {
    const holders = holdersById.get(s.id);
    if (holders) {
      if (!holders.includes(s.projectDir)) holders.push(s.projectDir);
    } else {
      holdersById.set(s.id, [s.projectDir]);
    }
  }
  for (const holders of holdersById.values()) holders.sort();

  const summaries = sessions.map((input) =>
    buildSummary(input, nowIso, badgesBySessionId, holdersById.get(input.id) ?? [input.projectDir]),
  );

  // Group by project, ordered mtimeIso descending, ties broken by id for a stable order (§5.1).
  const sessionsByProject = new Map<string, SessionSummary[]>();
  for (const dir of projectDirs) sessionsByProject.set(dir, []);
  for (const summary of summaries) {
    const list = sessionsByProject.get(summary.projectDir);
    if (list) list.push(summary);
    else sessionsByProject.set(summary.projectDir, [summary]); // a session under a dir the caller didn't list (defensive; never drop data)
  }
  for (const list of sessionsByProject.values()) {
    list.sort((a, b) => {
      const byMtime = isoToMs(b.mtimeIso) - isoToMs(a.mtimeIso);
      return byMtime !== 0 ? byMtime : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  // One Project per directory the walk found — including a zero-session one (§5.1 step 1).
  const projects: Project[] = [...sessionsByProject.keys()].map((dir) => {
    const own = sessionsByProject.get(dir) ?? [];
    const ownInputOrder = sessions.filter((s) => s.projectDir === dir); // original order, for `cwd` (§5.1 step 4)
    let cwd: string | null = null;
    for (const s of ownInputOrder) {
      const found = cwdFromHead(s.headLines);
      if (found !== null) { cwd = found; break; }
    }
    let newestMtimeIso: string | null = null;
    for (const s of own) {
      if (newestMtimeIso === null || isoToMs(s.mtimeIso) > isoToMs(newestMtimeIso)) newestMtimeIso = s.mtimeIso;
    }
    return {
      dir,
      cwd,
      sessionCount: own.length,
      newestMtimeIso,
      live: own.some((s) => s.live),
    };
  });
  projects.sort((a, b) => {
    const byMtime = isoToMs(b.newestMtimeIso) - isoToMs(a.newestMtimeIso);
    return byMtime !== 0 ? byMtime : (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0);
  });

  // The canonical summary per session id: the copy with the newest mtime (spec §5.2). Ties are
  // broken by `projectDir` so the choice is deterministic rather than "whichever the walk visited
  // last".
  const sessionIndex = new Map<string, SessionSummary>();
  for (const summary of summaries) {
    const existing = sessionIndex.get(summary.id);
    if (!existing) { sessionIndex.set(summary.id, summary); continue; }
    const byMtime = isoToMs(summary.mtimeIso) - isoToMs(existing.mtimeIso);
    if (byMtime > 0 || (byMtime === 0 && summary.projectDir < existing.projectDir)) {
      sessionIndex.set(summary.id, summary);
    }
  }

  return { projects, sessionsByProject, sessionIndex };
}

export interface PartitionedProjects {
  recent: Project[];
  older: Project[];
}

/**
 * `partitionProjects(projects, nowMs, windowDays)` (D10, spec §5.6, verbatim): "the sidebar shows
 * by default only projects whose newest session is within 30 days" — the rest are revealed only by
 * the `?all=1` URL (a client concern; this function only ever returns the two lists). A project
 * with no sessions at all (no `newestMtimeIso`) has no "newest session within the window" to
 * satisfy — it partitions as `older`, exactly like one whose newest session is stale. Never reads
 * the clock itself: `nowMs` is the caller's own reading (`fail-closed-edges`/`pure-core.md` —
 * never `Date.now()` in core).
 */
export function partitionProjects(
  projects: readonly Project[],
  nowMs: number,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): PartitionedProjects {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const recent: Project[] = [];
  const older: Project[] = [];
  for (const project of projects) {
    const newestMs = project.newestMtimeIso === null ? null : Date.parse(project.newestMtimeIso);
    const isRecent = newestMs !== null && !Number.isNaN(newestMs) && nowMs - newestMs <= windowMs;
    (isRecent ? recent : older).push(project);
  }
  return { recent, older };
}

/**
 * The title/`cwd` summary cache identity (spec §5.3, verbatim): `path + ':' + sizeBytes + ':' +
 * mtimeMs + ':' + inode`. Deliberately carries BOTH `sizeBytes` AND `mtimeMs` (plus `inode`) — a
 * size-only key would silently serve a stale title for a same-size rewrite within the same
 * millisecond a naive key could miss otherwise; the object shape below is exactly what
 * `core/model.ts#FileObservation` (minus `birthtimeMs`, which the cache identity does not need)
 * already supplies, so a caller never has to build a second, parallel struct just for this call.
 */
export function sessionCacheKey(path: string, obs: { sizeBytes: number; mtimeMs: number; inode: number }): string {
  return `${path}:${obs.sizeBytes}:${obs.mtimeMs}:${obs.inode}`;
}
