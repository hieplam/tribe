// Shared types for the campaign runner (Task 2).

/** D2: a card's lifecycle. `staged` (spec+plan on master, not started) -> `running`
 * (executor session in flight) -> `shipped` | `escalated` (terminal). `blocked` (Task 1,
 * spec §O4/W6) is DERIVED state — never written by a session, only computed fresh by
 * `nextCard` on every call from a card's `dependsOn` and its dependencies' current
 * statuses. A stored `blocked` on disk is a hint from a prior run, never trusted as-is. */
export type CardStatus = 'staged' | 'running' | 'shipped' | 'escalated' | 'blocked';

/** D2 per-card record. Nullable fields are unset until the loop (Task 6) fills them in;
 * `baseSha` is REQUIRED (present, but nullable) because D3's schema guard diffs from it. */
export interface Card {
  status: CardStatus;
  spec: string | null;
  plan: string | null;
  branch: string | null;
  baseSha: string | null;
  pr: number | null;
  mergeSha: string | null;
  sessionId: string | null;
  updatedAt: string | null;
  /** Task 1 (spec §O4): card ids (must all resolve under `cards`) this card must not start
   * before. OPTIONAL and absent by default — no `dependsOn` means independent, exactly
   * today's sequential behavior. Never defaulted to `[]` at the schema layer (see state.ts's
   * `CardSchema`) so an old v1 state file round-trips byte-identical. */
  dependsOn?: string[];
  /** Task 1 (spec §O6/W7): how many auto-answer round-trips this card has been through.
   * OPTIONAL, conceptually defaults to 0 when absent — callers read `card.autoAnswerRounds
   * ?? 0`, never relying on a schema-injected default (same byte-identical reasoning as
   * `dependsOn`). */
  autoAnswerRounds?: number;
  /** P4 fix-list item (spec: "Every heal performed is recorded ... so the report shows ...
   * instead of silently passing"): the `HealAction.kind`s `healSafeResidue` actually applied
   * (never merely attempted — see `card-actions.ts`'s `executeHealActions`) the run this card
   * last shipped. OPTIONAL and absent by default (same byte-identical round-trip reasoning as
   * `dependsOn`/`autoAnswerRounds`) — only ever set by `shipCard` when a heal actually
   * happened; report.ts reads it to surface the heal on the ONE artifact a human/orchestrating
   * session reads after a run. */
  healedResidue?: string[];
}

/** D2 campaign state root. `schemaLockPaths` (D3 point 6) and `ownerOnlyEscalations` (D5)
 * are campaign config carried IN the state file — never hardcoded in this capability. */
export interface CampaignState {
  v: number;
  campaign: string;
  mergePolicy: string;
  sequence: string[];
  /** Paths whose diff from a card's baseSha must stay empty unless that card's plan
   * front-matter declares `allowsSchemaChange: true` (D3 point 6). */
  schemaLockPaths: string[];
  /** Path prefixes that count as "docs-only" for the D6 flake waiver (D3 point 4's
   * `checksGreen` check) — campaign config, never hardcoded (stateless-capability wall). An
   * EMPTY list fails closed: nothing counts as docs-only, so a code diff never auto-waives. */
  docsOnlyPaths: string[];
  /** Trigger names that always escalate to the human owner, regardless of what an
   * executor session claims (D5). */
  ownerOnlyEscalations: string[];
  cards: Record<string, Card>;
}

export interface NextCardOptions {
  /** Include `escalated` cards as eligible "next" candidates (`--include-escalated`). */
  includeEscalated?: boolean;
}

/** Every remaining card is shipped (or escalated and excluded). */
export interface NoCardResult {
  kind: 'done';
}

/** D5 trigger: the next eligible card is missing its spec and/or plan on disk. */
export interface PlanningNeededResult {
  kind: 'planning_needed';
  cardId: string;
  missing: Array<'spec' | 'plan'>;
}

export interface CardResult {
  kind: 'card';
  cardId: string;
  card: Card;
}

export type NextCardResult = NoCardResult | PlanningNeededResult | CardResult;

/** P11 fix-list follow-up ("out of scope" note: a `reset-card` CLI subcommand "so humans
 * never hand-edit state.json"). Return shape of `state.ts`'s `resetCard` — a one-line-JSON-
 * printable digest of what a reset actually changed, so an orchestrating session (or a human)
 * can quote it instead of re-deriving it from a diff of state.json before/after. `status` is
 * always `'staged'` (the only status a reset ever produces); `clearedFields` names exactly the
 * fields whose value changed (nulled or, for the two optional/absent-by-default fields,
 * deleted) — a field already at its reset value contributes nothing, so a reset of an
 * already-clean staged card reports an empty list. */
export interface ResetCardSummary {
  cardId: string;
  previousStatus: CardStatus;
  status: 'staged';
  clearedFields: string[];
}

/** The orchestrator's (`core/loop/`) full config, assembled by `cli/main.ts`'s `parseArgs`
 * from CLI flags. Homed in the kernel (not `core/loop/run-loop.ts`) because every
 * `core/loop/*` module needs it — `phase.ts`, `lock.ts`, and `commit-guard.ts` would
 * otherwise have to import it from the orchestrator's own entry module, a type-only cycle. */
export interface RunLoopConfig {
  /** `--repo` */
  repoRoot: string;
  /** `--logs-dir` */
  logsDir: string;
  /** `--home` — the campaign's machine-local operational home (spec §4). REQUIRED input;
   * the runner never derives `~/.tribe` itself (wall W1) — its caller injects it. */
  homeDir: string;
  /** Unique per invocation (sessionId-style), generated by the composition root. */
  runId: string;
  /** Raw argv echo, recorded in run.json for the viewer/audit trail. */
  argv: string[];
  /** `--model` */
  model: string;
  /** `--session-timeout`, in ms */
  sessionTimeoutMs?: number;
  /** `--cards` */
  cardsFilter?: string[];
  /** `--max-cards` */
  maxCards?: number;
  /** `--include-escalated` */
  includeEscalated: boolean;
  /** `--max-concurrent` (P12 follow-up): bounds how many cards' executor sessions may be in
   * flight AT ONCE this pass — it bounds WIDTH, never ORDER (`dependsOn` still owns ordering;
   * see `core/loop/run-loop.ts`'s `runPassPool` doc comment). OPTIONAL, and reads as `?? 1`
   * everywhere it's consumed (never a bare field access) so every existing `RunLoopConfig`
   * literal — every test fixture, every other caller — that omits it keeps behaving exactly
   * like today's one-card-at-a-time pass with zero code changes. `1` (omitted or explicit) is
   * the default AND must stay behaviorally identical to the pre-P12-follow-up runner: N=1
   * always takes the original serial `runPass` code path, never `runPassPool`. */
  maxConcurrent?: number;
  /** `--dry-run` */
  dryRun: boolean;
  /** `--remote` — the git remote name this repo's PR-target/canonical-upstream actually is.
   * Default `'origin'` (a protocol-level default, spec §2 shape — not a campaign value).
   * Threaded everywhere the runner previously hardcoded the literal string `'origin'`. */
  remote: string;
  /** Task 27 (spec §10.2): the root viewer URL's own origin, set by `cli/main.ts`'s
   * `announceViewer` once the launch decision is known — `null` under `--no-viewer`,
   * `--dry-run`, a missing viewer entry, or a stale (unrecognized) port occupant. OPTIONAL,
   * same reasoning as `maxConcurrent` above: every existing `RunLoopConfig`/`ResolvedConfig`
   * literal that omits it keeps compiling and behaving exactly as before (read as `?? null`
   * — see `core/loop/card-actions.ts`'s `onSessionStart`, which never prints a card's session
   * line when this is absent or null: printing a URL nothing can serve is worse than silence). */
  viewerBaseUrl?: string | null;
}

/** `RunLoopConfig` plus everything `core/loop/run-loop.ts`'s `resolveRunContext` loads
 * through the io seam before a pass starts (the base branch, the committed --answers
 * rulings, the committed brief template) — threaded through `core/loop/card-actions.ts` and
 * `core/loop/commit-guard.ts` too, so it lives in the kernel alongside `RunLoopConfig`
 * rather than in any one of those sibling modules. */
export interface ResolvedConfig extends RunLoopConfig {
  baseBranch: string;
  answersContent: string;
  briefTemplate: string;
}

/** Process exit codes — the runner's shared vocabulary, homed in the kernel so leaf modules
 * (report.ts) import them from here, never from the orchestrator (lesson L5: anything used
 * by 2+ modules lives in the kernel). */
export const EXIT_OK = 0;
export const EXIT_LOCKED = 1;
export const EXIT_ESCALATED = 2;
export const EXIT_SESSION_INCOMPLETE = 3;
/** "An unhandled exception surfaced after `runLoop` was entered" — consumed only by run.ts's
 * `main()`; the exit code is a hint, the report is the truth (§O3). */
export const EXIT_ERROR = 4;
/** Harness-gap-wiring PR C: the pass would otherwise have concluded `done` (every requested
 * card `shipped`/`blocked`/`escalated`, nothing pending), but `answers.md` carries ≥1 ruling
 * (a `## ` block) with no recognized `ratified-as:` disposition (`core/rulings.ts`). Modeled
 * as its own `EXIT_*` code — not folded into `EXIT_ESCALATED` — because it is a campaign-level
 * gate on the FINAL state, not a per-card outcome `computeExitCode` (run-loop.ts) can see; see
 * that module's own doc comment for exactly where this is checked. */
export const EXIT_RULINGS_UNRATIFIED = 5;
