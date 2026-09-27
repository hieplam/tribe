/**
 * core/badge.ts — the campaign badge, pure half (spec §9). Closes B3 of
 * `tribe-viewer-research.md` (a session id read out of a state file being used as a path).
 *
 * PURE (`pure-core.md`): takes already-read JSON values (already-parsed `campaign-state.json`
 * and `run.json` bodies, already discovered by the adapter's `readdir`/containment walk) and an
 * injected `processAlive` predicate — nothing here touches the filesystem, spawns a process, or
 * reads the clock.
 *
 * Containment (B3, D6): a `sessionId` read out of a state file OR a ledger row is used ONLY as a
 * `Map` key and ONLY after it passes the id charset `^[0-9a-fA-F-]{8,64}$` — it is never
 * concatenated, joined, or otherwise turned into a path. This module never imports a
 * path-joining function and never touches any of the absolute-path fields a `run.json` body
 * carries (the one today's code reads verbatim is B3's other half) nor the runner-log directory
 * field (D6: the viewer never reads a runner log) — this module reads exactly `runId`,
 * `startedAt`, `endedAt`, `pid` off a run body and nothing else. A `sessionId` of
 * `../../../etc/passwd` therefore indexes nothing: it fails the charset check like any other
 * malformed id and is only ever counted, never opened.
 */

const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

/** `pid` bound from spec §9: `Number.isInteger && > 0 && < 2**22`. */
const PID_MAX = 2 ** 22;

/** A ledger row's `kind` values that name a supervisor session (spec §4.5). `subagent` and any
 * other kind are not a supervisor session and get no badge. */
type SupervisorSessionKind = 'ruling' | 'ratify' | 'closing';

function isSupervisorSessionKind(kind: unknown): kind is SupervisorSessionKind {
  return kind === 'ruling' || kind === 'ratify' || kind === 'closing';
}

export interface Badge {
  repoKey: string;
  slug: string;
  /** `null` for a supervisor session (`sessionKind !== 'card'`) — those come from the ledger,
   * which has no card of its own (spec §4.5). */
  cardId: string | null;
  cardStatus: string;
  sessionKind: 'card' | SupervisorSessionKind;
  runnerAlive: boolean;
  runId: string | null;
}

/** One campaign's already-read inputs: `state` is the already-`JSON.parse`d body of
 * `campaign-state.json` (or whatever a failed parse produced — this module treats any shape
 * that isn't the expected one as "malformed, contributes nothing"), and `runs` is every
 * already-`JSON.parse`d `runs/<runId>/run.json` body found under this campaign. */
export interface CampaignScan {
  repoKey: string;
  slug: string;
  state: unknown;
  runs: readonly unknown[];
  /** Every parsed row of `<campaignDir>/supervisor/ledger.jsonl`, in file order (spec §4.5, card
   * D1). `unknown` because the file is append-only JSONL written by another process: this core
   * validates each row's shape itself and never trusts the adapter to have done it. `[]` covers
   * all three "nothing to read" cases indistinguishably — no ledger yet, a refused (escaping or
   * oversized) one, or one whose every line was malformed — because none of them changes what a
   * badge index may contain. */
  ledger: readonly unknown[];
}

export interface BuildBadgeIndexResult {
  index: Map<string, Badge[]>;
  skippedBadges: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface LatestRun {
  runId: string | null;
  endedAt: unknown;
  pid: unknown;
}

/** The run with the max `startedAt` across every already-read `run.json` body (spec §9 step 4).
 * Malformed entries (not an object, or missing/non-string `startedAt`) are dropped before
 * picking — they can never win, and this never throws on garbage input. */
function pickLatestRun(runs: readonly unknown[]): LatestRun | null {
  let bestStartedAt: string | null = null;
  let best: LatestRun | null = null;
  for (const raw of runs) {
    if (!isPlainObject(raw)) continue;
    const startedAt = raw.startedAt;
    if (typeof startedAt !== 'string') continue;
    if (bestStartedAt === null || startedAt > bestStartedAt) {
      bestStartedAt = startedAt;
      best = {
        runId: typeof raw.runId === 'string' ? raw.runId : null,
        endedAt: raw.endedAt,
        pid: raw.pid,
      };
    }
  }
  return best;
}

/** `runnerAlive` per spec §9 step 4: true only when the latest run's `endedAt` is null AND the
 * injected `processAlive` probe says the (validated) pid is alive. A missing/invalid pid, or no
 * run at all, is never alive — this never calls `processAlive` on an out-of-range value. */
function computeRunnerAlive(latest: LatestRun | null, processAlive: (pid: number) => boolean): boolean {
  if (latest === null) return false;
  if (latest.endedAt !== null && latest.endedAt !== undefined) return false;
  const pid = latest.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || pid >= PID_MAX) return false;
  return processAlive(pid);
}

/** Builds `Map<sessionId, Badge[]>` from already-read campaign scans (spec §9). One session id
 * claimed by two campaigns yields TWO badges in that session's list — the map is keyed for
 * lookup by session id but a campaign is identified by the pair `(repoKey, slug)`, carried on
 * every badge; scan order never causes one entry to overwrite another. */
export function buildBadgeIndex(
  campaigns: readonly CampaignScan[],
  processAlive: (pid: number) => boolean,
): BuildBadgeIndexResult {
  const index = new Map<string, Badge[]>();
  let skippedBadges = 0;

  for (const { repoKey, slug, state, runs, ledger } of campaigns) {
    const latest = pickLatestRun(runs);
    const runnerAlive = computeRunnerAlive(latest, processAlive);
    const runId = latest?.runId ?? null;

    const addBadge = (sessionId: string, badge: Badge): void => {
      const existing = index.get(sessionId);
      if (existing) existing.push(badge);
      else index.set(sessionId, [badge]);
    };

    // --- state loop: one badge per card with a valid sessionId (executor badges, spec §9). ---
    if (isPlainObject(state) && Array.isArray(state.sequence) && isPlainObject(state.cards)) {
      const cards = state.cards;
      for (const cardId of state.sequence) {
        if (typeof cardId !== 'string') continue;
        const card = cards[cardId];
        if (!isPlainObject(card)) continue;

        const sessionId = card.sessionId;
        if (sessionId === null || sessionId === undefined) continue; // no session id: skipped, not counted

        if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
          // Fails the id charset — dropped AND counted (B3: this is also where a traversal
          // string like `../../../etc/passwd` is refused; it is never used as a path).
          skippedBadges += 1;
          continue;
        }

        addBadge(sessionId, {
          repoKey,
          slug,
          cardId,
          cardStatus: typeof card.status === 'string' ? card.status : 'unknown',
          sessionKind: 'card',
          runnerAlive,
          runId,
        });
      }
    }
    // A malformed state file contributes nothing to the state loop and never throws (spec §9).

    // --- ledger loop: one badge per supervisor session (ruling/ratify/closing), spec §4.5. ---
    // The ledger is not a second source for executor badges — only these three kinds count.
    const badgedSessionIdsThisCampaign = new Set<string>();
    for (const row of ledger) {
      if (!isPlainObject(row)) continue;
      const kind = row.kind;
      if (!isSupervisorSessionKind(kind)) continue; // e.g. `subagent`: not a supervisor session

      const sessionId = row.sessionId;
      if (sessionId === null || sessionId === undefined) continue; // no session id: skipped, not counted

      if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
        // Fails the id charset — dropped AND counted, same rule as the state loop above.
        skippedBadges += 1;
        continue;
      }

      // Spawn rows and legacy end rows for the SAME session, in the SAME campaign, collapse to
      // one badge — the first row seen for a session wins; later rows for it are ignored.
      if (badgedSessionIdsThisCampaign.has(sessionId)) continue;
      badgedSessionIdsThisCampaign.add(sessionId);

      addBadge(sessionId, {
        repoKey,
        slug,
        cardId: typeof row.cardId === 'string' ? row.cardId : null,
        cardStatus: kind,
        sessionKind: kind,
        runnerAlive,
        runId,
      });
    }
  }

  return { index, skippedBadges };
}

/** One campaign directory candidate for the 200-cap (spec §9): `mtimeMs` is the already-`stat`ed
 * mtime of `campaigns/<slug>` — this module never stats anything itself. */
export interface CampaignDirEntry {
  repoKey: string;
  slug: string;
  mtimeMs: number;
}

/** Which `cap` campaign directories are admitted per scan (spec §9): a pure decision over the
 * supplied listing, deterministic regardless of the order it arrives in — newest
 * `campaigns/<slug>` mtime first, ties broken by the full `(repoKey, slug)` identity so two
 * same-mtime entries are ordered the same way every time, even when their slugs collide across
 * repo keys (§9's measured 2-of-17 collision). The adapter performs the reads this names; it
 * chooses nothing (`pure-core.md`). */
export function selectCampaigns(entries: readonly CampaignDirEntry[], cap: number): CampaignDirEntry[] {
  return [...entries]
    .sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
      const aName = `${a.repoKey}/${a.slug}`;
      const bName = `${b.repoKey}/${b.slug}`;
      return aName < bName ? -1 : aName > bName ? 1 : 0;
    })
    .slice(0, Math.max(0, cap));
}
