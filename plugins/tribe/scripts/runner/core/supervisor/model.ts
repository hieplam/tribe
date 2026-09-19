// ---------------------------------------------------------------------------------------
// Campaign supervisor (card `campaign-supervisor`, spec
// docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md §3). The supervisor's own
// vocabulary. Deliberately does NOT live in core/types.ts, for the same reason
// core/watchdog/model.ts does not: nothing in ports/ports.ts needs these types yet, and this
// module, like core/types.ts, imports nothing local.
// ---------------------------------------------------------------------------------------

export const SUPERVISOR_EXIT_DONE = 0;
export const SUPERVISOR_EXIT_USAGE = 1;
export const SUPERVISOR_EXIT_NEEDS_OWNER = 20;
export const SUPERVISOR_EXIT_RUNNING = 21;

/** §5: the three one-shot session kinds. */
export type SessionKind = 'ruling' | 'ratify' | 'closing';

/** §6.1: what a SESSION may write to `<home>/supervisor/park/<cardId>.json`. Closed, two
 * values — an unrecognised `kind` is read as `too_hard` (§6.1), never a third value here. */
export type ParkMarkerKind = 'owner_only' | 'too_hard';

/** §6.1's marker JSON shape, verbatim: `{ "v": 1, "kind": "owner_only", "cardId": "c1",
 * "trigger": "data-shape-change", "note": "one line" }`. `note` is recorded and relayed; it is
 * never parsed and never influences a decision (§6.1). */
export interface ParkMarker {
  v: 1;
  kind: ParkMarkerKind;
  cardId: string;
  trigger: string;
  note: string;
}

/** §6.2: what the SUPERVISOR may write into `NEEDS_OWNER.md`. Twenty-two values (spec §6.2's own
 * count), each produced by exactly one row of §3.4's table or one postcondition failure. The
 * last two (`history_rewritten`, `ratify_out_of_scope`) are the integrity parks added by §5.2 and
 * §5.3 — the only two that bypass the retry budget. */
export type ParkReason =
  | 'owner_only'
  | 'too_hard'
  | 'w7_cap'
  | 'ratify_cap'
  | 'spawn_cap'
  | 'watchdog_run_cap'
  | 'repeat_escalation'
  | 'ruling_failed'
  | 'ratify_failed'
  | 'closing_failed'
  | 'session_incomplete'
  | 'quota_cap'
  | 'overloaded'
  | 'stalled'
  | 'lock_conflict'
  | 'error'
  | 'unexpected_running'
  | 'watchdog_no_terminal'
  | 'watchdog_usage'
  | 'resume_blocked'
  | 'history_rewritten'
  | 'ratify_out_of_scope';

/** §3.2: the typed subset of `campaign-report.json` the observation carries — `run.reason`,
 * `pending[]`, `cards[].outcome`, `cards[].escalationFile`, `cards[].question`, `stats` (§1.2's
 * "Campaign truth" row). Deliberately independent of `core/report.ts`'s `CampaignReport` (this
 * module imports nothing local); a later task narrows the real report into this shape at the
 * edge. */
export interface CampaignReportCardFact {
  outcome: 'shipped' | 'escalated' | 'blocked' | 'not_reached';
  escalationFile: string | null;
  question: string | null;
  // FU-CS-1 (spec §7): vestigial — nothing in the runner ever increments this. Read here for
  // shape parity with `core/report.ts`'s persisted field, never consulted by `decide()`.
  autoAnswerRounds: number | null;
}

export interface CampaignReportFacts {
  run: { reason: string; unratifiedRulings: string[] };
  pending: string[];
  cards: Record<string, CampaignReportCardFact>;
  stats: { shipped: number; escalated: number; blocked: number; notReached: number };
}

/** §3.2: one escalated card's typed facts. `reason` is a typed field read off a fixed template
 * line (`core/report.ts`'s `extractQuestionDigest`), never prose interpretation. */
export interface EscalationFact {
  cardId: string;
  filePresent: boolean;
  contentSha256: string;
  reason: string;
  autoAnswerRounds: number;
  /** §3.4 row 5 / §4.3's crash-recovery guard: the id of a ruling block in `answers.md` that
   * already answers THIS card's current escalation, when the escalation file has not yet been
   * archived (a session wrote the ruling, the supervisor died before archiving it). `null` when
   * no such ruling exists yet. A typed disk fact the edge computes by parsing `answers.md`;
   * `decide()` only reads it, never interprets prose. */
  landedRulingId: string | null;
}

/** §8: the five budget flags `decide()` actually reads (the table's caps). The remaining §8
 * flags — session timeout/turns, poll seconds — govern how a session is spawned and how a live
 * watchdog is awaited, not what `decide()` decides, so they live on the CLI config instead. */
export interface SupervisorLimits {
  maxRulingRounds: number;
  maxRatifyRounds: number;
  maxSpawns: number;
  maxWatchdogRuns: number;
  sessionRetries: number;
}

/** §4/§7: the supervisor's own persisted counters (`<home>/supervisor/state.json`). */
export interface SupervisorState {
  rulingRounds: Record<string, number>;
  ratifyRounds: number;
  spawns: number;
  watchdogRuns: number;
  /** §8's repeat-escalation breaker: every escalation body sha256 already ruled, per card. */
  seenEscalations: Record<string, string[]>;
  closingVerified: boolean;
  /** Row 16's `retriggers(session_incomplete) < 1` — keyed by the watchdog terminal reason that
   * triggered the retrigger. */
  retriggers: Record<string, number>;
}

/** §3.2, verbatim. Everything `decide()` needs, read once per tick by the edge and handed in as
 * data — no clock, no fs, no spawn reachable from here. */
export interface SupervisorObservation {
  nowMs: number;
  /** `<home>/STOP` */
  stopFilePresent: boolean;
  /** `<home>/NEEDS_OWNER.md` from an earlier park. */
  needsOwnerPresent: boolean;
  supervisorLock: { pid: number; alive: boolean } | null;
  /** `status.json` `terminal === null` && pid alive — OR, when the disk has not caught up yet,
   * a spawn this loop itself has in flight (its handle not yet reaped) whose pid is alive. A
   * real watchdog child does not publish `status.json` synchronously at spawn time (Fix 1,
   * `fixtures-mirror-reality.md`), so the in-flight spawn is an equally valid liveness source. */
  watchdogLive: { pid: number; alive: boolean } | null;
  lastWatchdog: {
    terminal: { status: string; reason: string; exitCode: number } | null;
    /** The child's real exit when THIS invocation spawned it. */
    ownedExitCode: number | null;
  } | null;
  /** Parsed `campaign-report.json`, typed fields only. */
  report: CampaignReportFacts | null;
  /** One per card the report marks escalated. */
  escalations: EscalationFact[];
  /** `campaign-state.json`'s `ownerOnlyEscalations`. */
  ownerOnlyEscalations: string[];
  /** `report.run.unratifiedRulings`. */
  unratifiedRulings: string[];
  /** `<home>/supervisor/park/*.json` written by a session. */
  parkMarkers: ParkMarker[];
  /** The supervisor's own persisted counters. */
  state: SupervisorState;
  limits: SupervisorLimits;
  /** §3.4's post-session rows (V1-V5): "the loop records the verdict into the observation as
   * `lastSessionOutcome` and re-enters `decide()`." `null` on every ordinary tick; set for
   * exactly the one re-entrant tick immediately after a one-shot session returns. When set,
   * `decide()` evaluates ONLY the post-session rows and returns — they run "before any other
   * row" (§3.4). */
  lastSessionOutcome: SessionOutcome | null;
  /** R11 (Task 20, spec §5.4 item 4): the composition root resolved the verify-shipped plugin
   * dir from THE RUNNER'S OWN LOCATION (never cwd, never `~/.claude`, never a literal) and it
   * exists on disk. A `closing` spawn without it cannot verify any card — Stage D's
   * `verify-shipped` skill would resolve to nothing, so `decide()` fails closed instead of
   * spawning a session that cannot do its job. */
  verifyShippedPluginAvailable: boolean;
}

/** §3.4's post-session rows (V1-V5): a one-shot session's verdict, decided by the postcondition
 * check on disk (never by the session's own words — S-P3). `rulingId` is set for `'ruled'`
 * (V3); `parkMarkerKind` is set for `'parked'` (V4, the marker a SESSION wrote — §6.1's two
 * values). Neither is meaningful for the other outcome kinds. */
export interface SessionOutcome {
  kind: SessionKind;
  cardId: string | null;
  outcome:
    | 'ruled'
    | 'ratified'
    | 'closed'
    | 'parked'
    | 'failed'
    | 'timeout'
    | 'history_rewritten'
    | 'ratify_out_of_scope';
  rulingId?: string | null;
  parkMarkerKind?: ParkMarkerKind;
}

/** §3.3: exactly one action per tick. */
export type SupervisorAction =
  | { kind: 'run_watchdog'; cards: string[] | null; includeEscalated: boolean }
  | { kind: 'await_watchdog'; pid: number }
  | { kind: 'spawn_session'; session: SessionKind; cardId: string | null }
  | { kind: 'archive_escalation'; cardId: string; rulingId: string }
  | { kind: 'park'; reason: ParkReason; detail: string }
  | { kind: 'exit'; status: 'done'; reason: string };

/** §11: one ledger.jsonl line per spawn (G5) — a session spawn, or an owner ruling transcribed
 * by the doorbell (§12.2, `kind: 'owner'`, no `sessionId`/`usage`). */
export type LedgerVerdict = 'ruled' | 'ratified' | 'closed' | 'parked' | 'failed' | 'timeout';

export interface LedgerEntryUsage {
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
}

export interface LedgerEntry {
  at: string;
  kind: SessionKind | 'owner';
  cardId: string | null;
  sessionId: string | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  usage: LedgerEntryUsage | null;
  costUsd: number | null;
  permissionDenials: number | null;
  verdict: LedgerVerdict;
  rulingId: string | null;
  round: number | null;
}

/** §13, deliberately shaped like `watchdog/status.json` so one reader serves both. */
export interface SupervisorStatus {
  v: 1;
  pid: number;
  home: string;
  campaign: string;
  startedAt: string;
  updatedAt: string;
  state:
    | 'observing'
    | 'running_watchdog'
    | 'awaiting_watchdog'
    | 'session_ruling'
    | 'session_ratify'
    | 'session_closing'
    | 'terminal';
  lastAction: string;
  watchdog: { pid: number | null; lastTerminalReason: string | null };
  currentSession: { kind: SessionKind; cardId: string | null; sessionId: string | null } | null;
  counters: {
    watchdogRuns: number;
    spawns: number;
    rulingRounds: Record<string, number>;
    ratifyRounds: number;
    failures: number;
  };
  terminal: { status: 'done' | 'needs_owner'; reason: string; exitCode: number } | null;
}
