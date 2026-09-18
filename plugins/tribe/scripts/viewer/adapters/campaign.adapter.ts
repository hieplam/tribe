// adapters/campaign.adapter.ts — the campaign adapter (spec §9). This is the ONLY file in the
// package that reads under `~/.tribe`, and it reads exactly two FILE types there:
// `campaign-state.json` and `run.json` (D6/D8) — one of each per campaign/run, never a third
// kind. A `run.json` body's `repo`, `answersPath`, `escalationsDir` fields, and — the one D6
// specifically forbids — the runner-LOG-directory field, are never opened; the absolute path a
// run body carries for its sibling campaign state is never read either (`campaign-state.json` is
// always found by fixed layout next to its campaign, never by a path *named inside* a run body).
// This module's own source spells out neither of those two field names anywhere
// (`campaign.adapter.test.ts` asserts this at the source-text level, deliberately, because it is a
// D6 boundary and not merely a behaviour).
//
// Containment (D14, spec §9, §12.2): a `readdir` entry cannot spell `..`, but it CAN be a symlink
// pointing anywhere, so every `repoKey`/`slug`/`runId` DIRECTORY and every
// `campaign-state.json`/`run.json` FILE is `realpath`-resolved and proven inside the resolved
// tribe root — via `core/paths.ts#isContainedResolved`, the same pure primitive task 15
// uses for the transcript side — before it is opened. An escaping one is refused: it contributes
// no badge, is counted in `skippedBadges`, and exactly one line goes to stderr naming the path.
// Never a crash, never a silent skip (`fail-closed-edges`).
//
// `process.kill(pid, 0)` — the ONE permitted call site in this whole package (structure.test.ts)
// — lives in `processAlive` below: signal 0 delivers nothing, it only asks the kernel whether
// `pid` exists. `ESRCH` (does not exist) -> false; `EPERM` (exists, not ours to signal) -> true.
// It is exposed here for the composition root to inject into `core/badge.ts#buildBadgeIndex` —
// this file never calls it itself, because aliveness is a PURE decision made there, over an
// already-read `run.json` body, not here.
//
// Cache policy is NOT this file's decision (`pure-core.md`, spec §5.3, §9: "the whole badge scan
// is cached for 5 s"). A module-level `Map` holds the last scan per `(tribeRoot, selection)`
// identity; every read of it goes through `core/cache.ts#decideCache`/`evictionVictim` — this file
// never computes a TTL expiry or an LRU choice itself.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import type { CampaignDirEntry, CampaignScan } from '../core/badge.ts';
import { type CacheEntry, decideCache, evictionVictim } from '../core/cache.ts';
import { isContainedResolved } from '../core/paths.ts';

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** `true` only for the two codes that mean "not there to read" — missing (`ENOENT`) or present
 * but unreadable (`EACCES`). Anything else is a genuine, unexpected failure and must propagate
 * (`fail-closed-edges` obligation 1). Used by `listDirOrEmpty`, where a THIRD code — `ELOOP` —
 * must still throw: a symlink-looped directory is not "absent", so a caller listing it should see
 * the failure rather than silently getting `[]`. */
function isAbsent(err: unknown): boolean {
  return isErrnoException(err) && (err.code === 'ENOENT' || err.code === 'EACCES');
}

/** Every `realpath` errno that means "not a real, reachable target" — mirrors
 * `fs.adapter.ts#REALPATH_FAILURE_CODES` exactly. Deliberately a SEPARATE set from `isAbsent`
 * above: `realpathOrNull` (below) must also degrade on `ELOOP`/`ENOTDIR`/`ENAMETOOLONG`, which
 * `isAbsent` intentionally excludes for `listDirOrEmpty`'s different contract. Any OTHER errno is
 * still a genuine, unexpected failure and propagates (`fail-closed-edges` obligation 1). */
const REALPATH_FAILURE_CODES = new Set(['ENOENT', 'ELOOP', 'ENOTDIR', 'EACCES', 'ENAMETOOLONG']);
function isRealpathFailure(err: unknown): boolean {
  return isErrnoException(err) && typeof err.code === 'string' && REALPATH_FAILURE_CODES.has(err.code);
}

/** Missing/unreadable directory -> `[]` (the normal "nothing here yet" case). Any other read
 * failure propagates. */
function listDirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if (isAbsent(err)) return [];
    throw err;
  }
}

/** Resolves `path` to its real, canonical form. `null` for EVERY errno that means "not a real
 * reachable target" — missing, a broken symlink, a symlink LOOP, a non-directory path component,
 * or a name too long (`REALPATH_FAILURE_CODES`, mirroring `fs.adapter.ts`) — refused WITHOUT a
 * read, before any containment check runs (D14). Any other errno is unexpected and propagates
 * (`fail-closed-edges` obligation 1). */
function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (err) {
    if (isRealpathFailure(err)) return null;
    throw err;
  }
}

/** One line to stderr naming the refused path — never a crash, never a silent skip. */
function warnRefused(path: string): void {
  console.error(`campaign.adapter: refused path outside the tribe root: ${path}`);
}

type Containment = { kind: 'ok'; resolved: string } | { kind: 'missing' } | { kind: 'escaped'; resolved: string };

/** Resolves `path` and proves it sits inside `root` before it may be used at all (D14, spec §9).
 * `missing` covers both "does not exist" and "broken symlink" — neither was ever a real target, so
 * neither is worth counting or warning about. `escaped` means a REAL, resolvable target was found
 * but it falls outside `root` — that is the security-relevant case: refused, counted, warned. */
function resolveContained(root: string, path: string): Containment {
  const resolved = realpathOrNull(path);
  if (resolved === null) return { kind: 'missing' };
  if (!isContainedResolved(root, resolved)) return { kind: 'escaped', resolved };
  return { kind: 'ok', resolved };
}

/** Sentinel `state` value for a `campaign-state.json` that read successfully but failed to
 * `JSON.parse` — distinguishable from the plain-absent case (`state: null`), per the two-outcome
 * rule (`fail-closed-edges` obligation 1, task 15's `readonly.test.ts`): a permissions/missing bug
 * must never look identical to a genuinely malformed file. */
export const MALFORMED_STATE = Symbol('campaign-state:malformed');

/** Reads `<campaignDir>/campaign-state.json`, already proven to sit inside `root` at the directory
 * level by the caller. Three, and only three, outcomes: `state` is the parsed JSON body (the
 * ordinary case); `null` for "not there to read" (missing or unreadable — never counted, this is
 * the normal shape of a campaign whose state hasn't been written yet); `MALFORMED_STATE` for "read
 * fine, parsed as garbage" (also never counted — its own campaign is simply skipped downstream by
 * `core/badge.ts`, never thrown). `skippedBadges` here counts ONLY a symlink escape — the one
 * outcome that is a security refusal rather than an ordinary absence. */
function readCampaignState(root: string, campaignDir: string): { state: unknown; skippedBadges: number } {
  const campaignStateFile = join(campaignDir, 'campaign-state.json');
  const containment = resolveContained(root, campaignStateFile);
  if (containment.kind === 'missing') return { state: null, skippedBadges: 0 };
  if (containment.kind === 'escaped') {
    warnRefused(campaignStateFile);
    return { state: null, skippedBadges: 1 };
  }

  let raw: string;
  try {
    raw = readFileSync(containment.resolved, 'utf8');
  } catch (err) {
    if (isAbsent(err)) return { state: null, skippedBadges: 0 };
    throw err;
  }

  try {
    return { state: JSON.parse(raw) as unknown, skippedBadges: 0 };
  } catch (err) {
    if (err instanceof SyntaxError) return { state: MALFORMED_STATE, skippedBadges: 0 };
    throw err;
  }
}

/** Reads every `<campaignDir>/runs/<runId>/run.json`, already-parsed, for `core/badge.ts` to pick
 * the latest from (spec §9 step 4). A campaign with no `runs/` directory yields `runs: []`, which
 * is exactly what makes `core/badge.ts#buildBadgeIndex` compute `runnerAlive: false` for it — this
 * function decides nothing about liveness itself. Each `runId` directory and each `run.json` file
 * is independently containment-checked (D14): an escaping one is refused, counted, and warned; a
 * missing or malformed one is silently dropped from the list (badge.ts already tolerates a `runs`
 * array with gaps — it never throws on a malformed entry, per task 12). */
function readCampaignRuns(root: string, campaignDir: string): { runs: unknown[]; skippedBadges: number } {
  const runsDir = join(campaignDir, 'runs');
  const runs: unknown[] = [];
  let skippedBadges = 0;

  for (const runId of listDirOrEmpty(runsDir)) {
    const runDir = join(runsDir, runId);
    const dirContainment = resolveContained(root, runDir);
    if (dirContainment.kind === 'missing') continue;
    if (dirContainment.kind === 'escaped') {
      warnRefused(runDir);
      skippedBadges += 1;
      continue;
    }

    let isDir = false;
    try {
      isDir = statSync(dirContainment.resolved).isDirectory();
    } catch (err) {
      if (isAbsent(err)) continue;
      throw err;
    }
    if (!isDir) continue;

    const runJsonPath = join(dirContainment.resolved, 'run.json');
    const fileContainment = resolveContained(root, runJsonPath);
    if (fileContainment.kind === 'missing') continue;
    if (fileContainment.kind === 'escaped') {
      warnRefused(runJsonPath);
      skippedBadges += 1;
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(fileContainment.resolved, 'utf8');
    } catch (err) {
      if (isAbsent(err)) continue;
      throw err;
    }

    try {
      runs.push(JSON.parse(raw) as unknown);
    } catch (err) {
      if (err instanceof SyntaxError) continue;
      throw err;
    }
  }

  return { runs, skippedBadges };
}

/** One (`repoKey`, `slug`) candidate to read — exactly what `core/badge.ts#selectCampaigns` (the
 * 200-cap, task 12) admitted. This adapter reads ONLY what `selection` names here; the cap
 * decision is not this file's to make (`pure-core.md`, spec §9). */
export interface CampaignSelector {
  readonly repoKey: string;
  readonly slug: string;
}

/** Reads one selected campaign end to end: the `repoKey` directory and the `campaigns/<slug>`
 * directory are each containment-checked BEFORE `campaign-state.json` is ever opened (spec §9) —
 * an escaping one is refused, counted, and warned, and the whole campaign contributes nothing
 * further (its `runs/` is never even listed). */
function readOneCampaign(root: string, repoKey: string, slug: string): { scan: CampaignScan | null; skippedBadges: number } {
  const repoKeyDir = join(root, repoKey);
  const repoKeyContainment = resolveContained(root, repoKeyDir);
  if (repoKeyContainment.kind === 'missing') return { scan: null, skippedBadges: 0 };
  if (repoKeyContainment.kind === 'escaped') {
    warnRefused(repoKeyDir);
    return { scan: null, skippedBadges: 1 };
  }

  const campaignDir = join(root, repoKey, 'campaigns', slug);
  const campaignContainment = resolveContained(root, campaignDir);
  if (campaignContainment.kind === 'missing') return { scan: null, skippedBadges: 0 };
  if (campaignContainment.kind === 'escaped') {
    warnRefused(campaignDir);
    return { scan: null, skippedBadges: 1 };
  }

  const { state, skippedBadges: stateSkipped } = readCampaignState(root, campaignContainment.resolved);
  const { runs, skippedBadges: runsSkipped } = readCampaignRuns(root, campaignContainment.resolved);

  return { scan: { repoKey, slug, state, runs }, skippedBadges: stateSkipped + runsSkipped };
}

/** Discovers every `(repoKey, slug)` candidate under `tribeRoot` (spec §9 steps 1–2), with the
 * `campaigns/<slug>` directory's own mtime — the input `core/badge.ts#selectCampaigns` needs to
 * pick the newest-first 200 (task 12).
 *
 * Containment BEFORE any stat/list (D14, plan task 16): a `readdir` entry cannot spell `..`, but it
 * CAN be a symlink pointing anywhere, so every `repoKey`, `campaigns`, and `<slug>` DIRECTORY is
 * realpath-resolved and proven inside `tribeRoot` before it is `statSync`'d or listed — otherwise a
 * symlinked `repoKey` (or `<slug>`) leaks out-of-root directory entries and mtimes into the
 * candidate list. Discovery counts nothing, so an escape is silently skipped here; the security
 * accounting (`skippedBadges`, one stderr line) is `readSelectedCampaigns`'s, which independently
 * re-proves containment for everything it actually reads. Non-directory entries at either level are
 * skipped; a missing/unreadable `tribeRoot` yields `[]`, never a throw. */
export function discoverCampaignCandidates(tribeRoot: string): CampaignDirEntry[] {
  const entries: CampaignDirEntry[] = [];
  for (const repoKey of listDirOrEmpty(tribeRoot)) {
    const repoKeyC = resolveContained(tribeRoot, join(tribeRoot, repoKey));
    if (repoKeyC.kind !== 'ok') continue; // missing, broken, or escaping — never a candidate
    let repoKeyIsDir = false;
    try {
      repoKeyIsDir = statSync(repoKeyC.resolved).isDirectory();
    } catch (err) {
      if (isAbsent(err)) continue;
      throw err;
    }
    if (!repoKeyIsDir) continue;

    const campaignsC = resolveContained(tribeRoot, join(repoKeyC.resolved, 'campaigns'));
    if (campaignsC.kind !== 'ok') continue;
    for (const slug of listDirOrEmpty(campaignsC.resolved)) {
      const slugC = resolveContained(tribeRoot, join(campaignsC.resolved, slug));
      if (slugC.kind !== 'ok') continue;
      let st: Stats;
      try {
        st = statSync(slugC.resolved);
      } catch (err) {
        if (isAbsent(err)) continue;
        throw err;
      }
      if (!st.isDirectory()) continue;
      entries.push({ repoKey, slug, mtimeMs: st.mtimeMs });
    }
  }
  return entries;
}

/** The tribe root under a given HOME (`$HOME/.tribe`, spec §9/§11.4). The ONLY place in the package
 * that spells `.tribe`: the composition root resolves the tribe root through here so the literal
 * never leaks into `serve.ts` (structure.test.ts's `.tribe` rule keeps every `~/.tribe` fact inside
 * this adapter). Pure string math over the supplied HOME — no filesystem access. */
export function tribeRootUnder(home: string): string {
  return join(home, '.tribe');
}

/** `process.kill(pid, 0)` (spec §9): signal 0 sends no signal, it only asks the kernel whether
 * `pid` exists. `ESRCH` means it genuinely does not (dead); `EPERM` means it DOES exist but this
 * process may not signal it (a different uid) — that is a LIVE process, so `true`, not `false`.
 * Any other error is a genuine, unexpected failure and propagates rather than guessing. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ESRCH') return false;
    if (isErrnoException(err) && err.code === 'EPERM') return true;
    throw err;
  }
}

export interface CampaignAdapterResult {
  readonly scans: CampaignScan[];
  readonly skippedBadges: number;
}

/** The module-level `Map` this adapter HOLDS (spec §5.3/§9, `pure-core.md`): every decision about
 * it — hit/stale/miss, eviction victim — is made by `core/cache.ts`, never computed here. */
const scanCache = new Map<string, CacheEntry<CampaignAdapterResult>>();

/** A cache identity stable under reordering: the same set of selected campaigns, handed in any
 * order, hits the same cache slot. */
function selectionCacheKey(tribeRoot: string, selection: readonly CampaignSelector[]): string {
  const identities = selection.map((s) => `${s.repoKey}/${s.slug}`).sort();
  return `${tribeRoot} ${identities.join(' ')}`;
}

/** Reads exactly the campaigns `selection` names (spec §9 steps 3–4) — nothing else is ever
 * opened, whatever else exists under `tribeRoot`. Cached for the whole scan for `CACHE_TTL_MS`
 * (spec §9: "cached for 5 s") — a repeat call with the same `(tribeRoot, selection)` inside the
 * window returns the prior result without touching disk again; obeying `core/cache.ts#decideCache`
 * and `#evictionVictim` is this function's entire cache policy, it decides nothing extra. */
export function readSelectedCampaigns(tribeRoot: string, selection: readonly CampaignSelector[], nowMs: number): CampaignAdapterResult {
  const key = selectionCacheKey(tribeRoot, selection);
  const decision = decideCache(key, scanCache, nowMs);
  if (decision.kind === 'hit') {
    const existing = scanCache.get(key);
    if (existing !== undefined) scanCache.set(key, { ...existing, lastAccessMs: nowMs });
    return decision.value;
  }

  const scans: CampaignScan[] = [];
  let skippedBadges = 0;
  for (const { repoKey, slug } of selection) {
    const { scan, skippedBadges: campaignSkipped } = readOneCampaign(tribeRoot, repoKey, slug);
    if (scan !== null) scans.push(scan);
    skippedBadges += campaignSkipped;
  }

  const value: CampaignAdapterResult = { scans, skippedBadges };
  const victim = evictionVictim(scanCache);
  if (victim !== null) scanCache.delete(victim);
  scanCache.set(key, { value, insertedAtMs: nowMs, lastAccessMs: nowMs });
  return value;
}
