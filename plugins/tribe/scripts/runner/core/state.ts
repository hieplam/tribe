// Campaign state schema, load/serialize, next-card selection (Task 2, spec §D2/§D5).
//
// Pure module: every world-touching operation (reading the state file, checking whether a
// path exists on disk) is injected by the caller — this file never imports `fs`,
// `child_process`, or performs network I/O.
import { join } from 'node:path';
import { z } from 'zod';
import type {
  Card,
  CampaignState,
  NextCardOptions,
  NextCardResult,
  ResetCardSummary,
} from './types.ts';
import type { StateIO } from '../ports/ports.ts';
import { escalationPathOf } from './paths.ts';

/** The only major version this runner understands today (D2). v2 (D1) made `cards.<id>.tasks`
 * required, so a v1 file can never be a valid v2 one — it is refused, never migrated. */
export const CURRENT_STATE_VERSION = 2;

/** Thrown by `parseState`/`loadState` when the state file's `v` field is not a version this
 * runner knows how to read. Never silently parsed as a lower/best-effort version. */
export class UnsupportedStateVersionError extends Error {
  readonly version: unknown;

  constructor(version: unknown) {
    const what =
      version === 1 ? 'campaign state v1 has no task index' : `Unsupported campaign state version ${JSON.stringify(version)}`;
    super(
      `${what}: this runner reads v2. A v1 state has no task index (cards.<id>.tasks) — re-author the state with the orchestrate-campaign skill.`,
    );
    this.name = 'UnsupportedStateVersionError';
    this.version = version;
  }
}

/** Thrown by `parseState`/`loadState` when `sequence` names a card id that has no matching
 * entry in `cards` (e.g. a typo in a hand-edited state file). The schema alone can't catch
 * this (`sequence` is `string[]`, `cards` is an open record), so `parseState` checks it
 * explicitly after structural validation. Left unchecked, `nextCard`'s per-card loop would
 * silently skip the dangling id — and report the campaign `done` if it were the last
 * unshipped one, even though that card was never built. */
export class UndefinedSequenceCardError extends Error {
  readonly cardId: string;

  constructor(cardId: string) {
    super(
      `Campaign state's sequence names card id ${JSON.stringify(cardId)}, which has no entry under cards.`,
    );
    this.name = 'UndefinedSequenceCardError';
    this.cardId = cardId;
  }
}

/** Task 1 (spec §O4): thrown by `parseState` when a card's `dependsOn` names a card id that
 * has no matching entry under `cards` — mirrors `UndefinedSequenceCardError` exactly, one
 * level down (per-card dependency references instead of the top-level sequence). Same
 * rationale: `dependsOn` is `string[]` at the schema level, so zod's structural validation
 * can't catch a dangling id; refuse it loudly at load, never let `nextCard`'s dependency walk
 * silently treat a typo'd id as "not shipped" forever. */
export class UndefinedDependencyCardError extends Error {
  readonly cardId: string;
  readonly dependencyId: string;

  constructor(cardId: string, dependencyId: string) {
    super(
      `Campaign state's card ${JSON.stringify(cardId)} declares dependsOn card id ` +
        `${JSON.stringify(dependencyId)}, which has no entry under cards.`,
    );
    this.name = 'UndefinedDependencyCardError';
    this.cardId = cardId;
    this.dependencyId = dependencyId;
  }
}

/** Task 1 (Warchief ruling): `dependsOn` can express a cycle (`A -> B -> A`, or a direct
 * self-dependency `A -> A`). Left undetected, `nextCard`'s per-card fixpoint walk would never
 * see any member of the cycle as satisfied (none of them ever ships), silently parking every
 * card in the cycle forever with no diagnostic. Detected ONCE at the same load-time boundary
 * as `UndefinedSequenceCardError`/`UndefinedDependencyCardError` — malformed state is refused
 * loudly at load, never discovered card-by-card mid-campaign. */
export class CircularDependencyError extends Error {
  /** The cycle, in visit order, with the repeated id at both ends (e.g. `['A', 'B', 'A']`). */
  readonly path: string[];

  constructor(path: string[]) {
    super(`Campaign state's dependsOn graph contains a cycle: ${path.join(' -> ')}.`);
    this.name = 'CircularDependencyError';
    this.path = path;
  }
}

/** P11 fix-list follow-up ("out of scope" note): thrown by `resetCard` when `cardId` names no
 * entry under `cards` — the CLI-level analog of `UndefinedSequenceCardError`/
 * `UndefinedDependencyCardError` above, one level further out (a human's `--card` selection,
 * not a cross-reference inside the state file itself), so it gets its own class rather than
 * reusing either. */
export class CardNotFoundError extends Error {
  readonly cardId: string;

  constructor(cardId: string) {
    super(`Campaign state has no card with id ${JSON.stringify(cardId)}.`);
    this.name = 'CardNotFoundError';
    this.cardId = cardId;
  }
}

const CardStatusSchema = z.enum(['staged', 'running', 'shipped', 'escalated', 'blocked']);

// `looseObject` (zod v4) keeps unknown keys on the parsed object instead of stripping them
// (the default `z.object()` behavior) — required so a load -> serialize round-trip preserves
// fields this runner doesn't itself know about.
const CardSchema = z.looseObject({
  status: CardStatusSchema,
  spec: z.string().nullable(),
  plan: z.string().nullable(),
  branch: z.string().nullable(),
  baseSha: z.string().nullable(),
  pr: z.number().nullable(),
  mergeSha: z.string().nullable(),
  sessionId: z.string().nullable(),
  updatedAt: z.string().nullable(),
  // Task 1: both OPTIONAL with no `.default(...)` — a schema-injected default would appear
  // in a re-serialized state file even when the source JSON never had the key, breaking the
  // v1 byte-identical round-trip contract. Callers apply the conceptual default
  // (`autoAnswerRounds ?? 0`, "no dependsOn" == independent) themselves.
  dependsOn: z.array(z.string()).optional(),
  autoAnswerRounds: z.number().optional(),
  // P4 fix-list item: same optional-with-no-default reasoning as `dependsOn`/`autoAnswerRounds`
  // above — only ever present when `shipCard` actually recorded a heal.
  healedResidue: z.array(z.string()).optional(),
  // D1: the task index — pointers into the plan, at least one per card. `passedSha` and
  // `doneSha` are runner-written progress, absent until a Done run passes.
  tasks: z
    .array(
      z.looseObject({
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'task id must match ^[A-Za-z0-9][A-Za-z0-9._-]*$'),
        heading: z.string().min(1),
        passedSha: z.string().optional(),
      }),
    )
    .min(1),
  doneSha: z.string().optional(),
});

export const CampaignStateSchema = z.looseObject({
  v: z.number().int(),
  campaign: z.string(),
  mergePolicy: z.string(),
  sequence: z.array(z.string()),
  schemaLockPaths: z.array(z.string()),
  docsOnlyPaths: z.array(z.string()),
  ownerOnlyEscalations: z.array(z.string()),
  cards: z.record(z.string(), CardSchema),
});

function assertKnownVersion(raw: unknown): void {
  const v = (raw as { v?: unknown } | null | undefined)?.v;
  if (v !== CURRENT_STATE_VERSION) {
    throw new UnsupportedStateVersionError(v);
  }
}

/** D2 requires every `sequence` entry to resolve to a `cards` entry. zod's structural schema
 * can't express that cross-field constraint, so it's checked here, once, at the same load-time
 * boundary as the version check — refusing the malformed state loudly rather than letting
 * `nextCard` discover (or silently skip) it card-by-card mid-campaign. */
function assertSequenceReferentialIntegrity(state: CampaignState): void {
  for (const cardId of state.sequence) {
    if (!(cardId in state.cards)) {
      throw new UndefinedSequenceCardError(cardId);
    }
  }
}

/** Task 1: extends the same undefined-card validation to `dependsOn` — every id a card
 * declares must resolve to a real entry under `cards`, exactly like `sequence` entries must. */
function assertDependsOnReferentialIntegrity(state: CampaignState): void {
  for (const [cardId, card] of Object.entries(state.cards)) {
    for (const dependencyId of card.dependsOn ?? []) {
      if (!(dependencyId in state.cards)) {
        throw new UndefinedDependencyCardError(cardId, dependencyId);
      }
    }
  }
}

/** D1: a task id names one task within its card; two tasks sharing an id would make every
 * per-task record (`passedSha`, a Done run) ambiguous. zod can't express uniqueness. */
function assertUniqueTaskIds(state: CampaignState): void {
  for (const [cardId, card] of Object.entries(state.cards)) {
    const seen = new Set<string>();
    for (const { id } of card.tasks) {
      if (seen.has(id)) throw new Error(`card ${cardId}: duplicate task id ${id}`);
      seen.add(id);
    }
  }
}

/** Task 1: DFS cycle detection over the `dependsOn` graph, run only after referential
 * integrity has already confirmed every `dependsOn` id resolves to a real card (so this
 * never has to guard against an undefined lookup). Standard "gray/white" DFS: `onStack`
 * tracks the current recursion path; hitting an id already `onStack` means every id from
 * that point in `path` back to the repeat forms the cycle. */
function assertNoDependsOnCycles(state: CampaignState): void {
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const path: string[] = [];

  function visit(cardId: string): void {
    if (onStack.has(cardId)) {
      const cycleStart = path.indexOf(cardId);
      throw new CircularDependencyError([...path.slice(cycleStart), cardId]);
    }
    if (visited.has(cardId)) return;

    visited.add(cardId);
    onStack.add(cardId);
    path.push(cardId);
    for (const dependencyId of state.cards[cardId]?.dependsOn ?? []) {
      visit(dependencyId);
    }
    path.pop();
    onStack.delete(cardId);
  }

  for (const cardId of Object.keys(state.cards)) {
    visit(cardId);
  }
}

/** Validates `raw` (already-parsed JSON) against the D2 schema. Checks the version FIRST,
 * with a dedicated typed error, rather than letting an unknown major version fall through
 * to (or be silently coerced by) the structural zod validation. Then checks that `sequence`
 * and every card's `dependsOn` only name ids `cards` actually defines, and finally that the
 * `dependsOn` graph is acyclic — all at the same load-time boundary, for the same reason. */
export function parseState(raw: unknown): CampaignState {
  assertKnownVersion(raw);
  const state = CampaignStateSchema.parse(raw) as CampaignState;
  assertSequenceReferentialIntegrity(state);
  assertDependsOnReferentialIntegrity(state);
  assertNoDependsOnCycles(state);
  assertUniqueTaskIds(state);
  return state;
}

/** P11 fix-list (ruling R3: a stale base is worse than no base): `status: 'staged'` +
 * `sessionId: null` + `baseSha` set is an impossible combo by invariant — `staged` with no
 * `sessionId` means no world has ever existed for this card, so any `baseSha` it's still
 * carrying can only be stale or hand-authored (the B13 incident's exact shape: a card
 * hand-reset to `staged` that kept its old campaign-start `baseSha`, which then diffed
 * schemaGuard from before a designed change and tripped a false positive on a PR that never
 * touched the locked path). Normalizes `baseSha` to `null` for every card matching the combo
 * and returns one warning string per affected card — never hard-fails, since the fix is
 * deterministic and safe (see `card-actions.ts`'s `recordBaseSha` for the write-time half of
 * this fix, which re-stamps a blind-fresh spawn's base). Mutates `cards` in place, the same
 * style `reconcileBlockedStatuses` already uses; pure otherwise (no I/O) — printing the
 * warnings happens at the edge (`loadState`'s caller), never here. */
function normalizeStaleBaseShas(cards: CampaignState['cards']): string[] {
  const warnings: string[] = [];
  for (const [cardId, card] of Object.entries(cards)) {
    if (card.status === 'staged' && card.sessionId == null && card.baseSha != null) {
      card.baseSha = null;
      warnings.push(`${cardId}: cleared stale baseSha on staged card (R3 invariant)`);
    }
  }
  return warnings;
}

/** Loads and validates campaign state through an injected `readFile` seam — this module
 * never touches `fs` itself. `readFile` returns the raw file contents (sync or async).
 *
 * P11 fix-list: after parsing, normalizes the R3 invariant (see `normalizeStaleBaseShas`)
 * and reports any warnings through the optional `onWarning` out-param — added rather than
 * changing the return shape, since `loadState`'s callers (and `CampaignState`'s own
 * byte-identical round-trip contract via `serializeState`) both depend on it resolving to
 * `CampaignState` directly. `onWarning` stays optional and unused-by-default so every
 * existing call site is unaffected; callers that want the warnings surfaced (`run-loop.ts`,
 * `cli/main.ts`) pass one that prints at their own edge — this module still never imports
 * `console` itself. */
export async function loadState(
  readFile: () => string | Promise<string>,
  onWarning?: (warning: string) => void,
): Promise<CampaignState> {
  const text = await readFile();
  const raw = JSON.parse(text);
  const state = parseState(raw);
  const warnings = normalizeStaleBaseShas(state.cards);
  if (onWarning) {
    for (const warning of warnings) onWarning(warning);
  }
  return state;
}

/** Serializes state back to the exact JSON shape `loadState` reads, including any unknown
 * fields carried through `parseState`'s loose schemas. */
export function serializeState(state: CampaignState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** P11 fix-list follow-up ("out of scope" note): the pure core of the `reset-card` CLI
 * subcommand — "so humans never hand-edit state.json." Resets exactly one card (`cardId`) to
 * a clean, re-runnable `staged` state and returns the NEW state (the input `state` and its
 * card are never mutated — a plain `{ ...spread }` at both the state and card level, so every
 * unknown field `parseState`'s `looseObject` schemas carried through — top-level AND per-card
 * — survives byte-faithfully; see `state.test.ts`'s `resetCard` suite for the round-trip
 * proof). Throws `CardNotFoundError` if `cardId` has no entry under `cards` — never silently
 * a no-op, the same "refuse loudly" precedent `parseState`'s own referential-integrity checks
 * set above.
 *
 * Field-by-field decisions (ruling R3, P11: "a stale base is worse than no base" — the same
 * tiebreak extended to every field below, not just `baseSha`):
 *
 * - `status` -> `'staged'`, `sessionId` -> `null`, `baseSha` -> `null`: the contract's own
 *   three required outcomes. `sessionId: null` is also what `recordBaseSha`'s `blindFresh`
 *   check and this module's own `normalizeStaleBaseShas` treat as "no world exists yet for
 *   this card" — the precondition every other field below is chosen to make TRUE, not just
 *   asserted.
 * - `pr` -> `null`: `actOnCard` (`core/loop/card-actions.ts`) writes a freshly-shipped card's
 *   PR with `card.pr = sessionResult.pr ?? card.pr` — a stale `card.pr` left in place is a
 *   silent fallback target if a future ship ever reports no PR number, attributing a BRAND NEW
 *   ship to a PR from the run this reset is discarding. Exactly R3's shape (a value trusted
 *   directly, with no reality-check, that can silently outlive the run it described) —
 *   `baseSha` had this bug before P11; `pr` still does, so it gets the same treatment here.
 * - `mergeSha` -> `null`: same stale-fallback shape, one line over (`card.mergeSha =
 *   extractMergeSha(verifyResult) ?? card.mergeSha`) — and purely observational once the card
 *   is no longer `shipped`, so nothing legitimate is lost.
 * - `updatedAt` -> `null`: bookkeeping only (`io.now()`, stamped on every card mutation) —
 *   never read to decide anything, so `null` truthfully records "no activity in this
 *   incarnation." (Also: this function takes no clock, by design — a pure `state in -> state
 *   out` transform per the fix-list brief, so it could not fabricate a real timestamp even if
 *   one were wanted here.)
 * - `autoAnswerRounds`, `healedResidue` -> DELETED (become absent), never set to `0`/`[]`: both
 *   fields are schema-optional with NO `.default(...)` specifically so "never happened" means
 *   absent, not a zero/empty value (see `CardSchema`'s own doc comments) — callers already read
 *   them as `autoAnswerRounds ?? 0`. A stale round-count or heal record from the discarded run
 *   would misreport this card's fresh attempt (report.ts surfaces `healedResidue` verbatim).
 * - `branch` -> UNCHANGED (deliberately NOT cleared): unlike every field above, `branch` is
 *   never trusted blindly — `deriveCardPhase` (`core/loop/phase.ts`) re-derives the actual
 *   phase from gh/git reality every time `branch` is non-null, and `recordBranchFromPr` only
 *   ever OVERWRITES it (no stale-fallback). Clearing it would skip that reality-check entirely
 *   (`deriveCardPhase` returns a blind `{ kind: 'fresh' }` the instant `branch` is null),
 *   throwing away the resume-matrix's own residue-cleanup path (`revert_and_redo`) and
 *   reopening exactly the duplicate-PR hazard `phase.ts`'s own "F8" comment documents for a
 *   blind fresh spawn over a branch/PR that still exists. R3 doesn't apply here: a "stale"
 *   `branch` self-heals on the very next read, so leaving it is safe and clearing it is not.
 * - `dependsOn`, `spec`, `plan` -> UNCHANGED: structural (this card's declared dependencies and
 *   spec/plan doc paths), never a per-run/per-attempt value — resetting one card must never
 *   silently rewire the campaign's dependency graph or detach it from its own spec/plan.
 * - Any unknown field (top-level or per-card) the schema doesn't know about -> UNCHANGED.
 *
 * Escalation pointers: NOT a `Card` field at all — an escalation lives in a sibling file
 * (`escalationPathOf(homeDir, cardId)`), tracked purely by presence/absence, never by anything
 * in `state.cards[cardId]`. `resetCard` therefore has nothing to clear here; the CLI edge
 * (`cli/main.ts`'s `performResetCard`) is the layer that can see the filesystem and warns
 * (never auto-archives — archiving is coupled 1:1 to an actual ruling recorded in
 * `answers.md` by the orchestrate-campaign SKILL's ritual, which a plain reset never performs)
 * when a reset card's escalation file is still present. */
export function resetCard(
  state: CampaignState,
  cardId: string,
): { state: CampaignState; summary: ResetCardSummary } {
  const card = state.cards[cardId];
  if (!card) {
    throw new CardNotFoundError(cardId);
  }

  const clearedFields: string[] = [];
  const next: Card = { ...card, status: 'staged' };

  if (next.sessionId !== null) clearedFields.push('sessionId');
  next.sessionId = null;

  if (next.baseSha !== null) clearedFields.push('baseSha');
  next.baseSha = null;

  if (next.pr !== null) clearedFields.push('pr');
  next.pr = null;

  if (next.mergeSha !== null) clearedFields.push('mergeSha');
  next.mergeSha = null;

  if (next.updatedAt !== null) clearedFields.push('updatedAt');
  next.updatedAt = null;

  if ('autoAnswerRounds' in next) {
    clearedFields.push('autoAnswerRounds');
    delete next.autoAnswerRounds;
  }
  if ('healedResidue' in next) {
    clearedFields.push('healedResidue');
    delete next.healedResidue;
  }
  // D1: task progress belongs to the discarded run; the task index itself is structural.
  if (next.tasks.some((task) => 'passedSha' in task)) clearedFields.push('tasks.passedSha');
  next.tasks = next.tasks.map(({ passedSha: _cleared, ...task }) => task);
  if ('doneSha' in next) {
    clearedFields.push('doneSha');
    delete next.doneSha;
  }

  return {
    state: { ...state, cards: { ...state.cards, [cardId]: next } },
    summary: { cardId, previousStatus: card.status, status: 'staged', clearedFields },
  };
}

function resolveMissing(card: Card, repoRoot: string, io: StateIO): Array<'spec' | 'plan'> {
  const missing: Array<'spec' | 'plan'> = [];
  if (!card.spec || !io.fileExists(join(repoRoot, card.spec))) {
    missing.push('spec');
  }
  if (!card.plan || !io.fileExists(join(repoRoot, card.plan))) {
    missing.push('plan');
  }
  return missing;
}

/** Task 1 (spec §O4, Warchief ruling): computes, to a FIXPOINT over every card in the state
 * (never a single pass, and never limited to `sequence` order), the set of card ids that are
 * currently parked-by-dependency: not `shipped` themselves, but declaring a `dependsOn` on a
 * card that is itself `escalated` or (transitively) blocked this same way.
 *
 * A single pass is wrong: for `A escalated`, `B dependsOn A`, `C dependsOn B`, a card-by-card
 * walk in sequence order `[C, B, A]` would see B as merely "not shipped yet" (not yet marked
 * blocked) when evaluating C, and silently leave C unmarked. Iterating to a fixpoint (repeat
 * until a full pass adds nothing new) makes the result independent of both `cards` object key
 * order and `sequence` order.
 *
 * `blocked` is DERIVED, recomputed fresh on every call — a card's stored `status: 'blocked'`
 * from a previous run is never trusted as an input here; only `escalated` (a real, durable
 * status) and this same function's own growing result set count as "parked". */
function computeBlockedCardIds(cards: CampaignState['cards']): Set<string> {
  const blocked = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [cardId, card] of Object.entries(cards)) {
      if (blocked.has(cardId) || card.status === 'shipped' || card.status === 'escalated') {
        continue;
      }
      const isParkedByDependency = (card.dependsOn ?? []).some((dependencyId) => {
        const dependency = cards[dependencyId];
        return dependency?.status === 'escalated' || blocked.has(dependencyId);
      });
      if (isParkedByDependency) {
        blocked.add(cardId);
        changed = true;
      }
    }
  }

  return blocked;
}

/** Task 1 fix (Warchief audit of the initial `nextCard`): `blocked` is DERIVED, so it must be
 * trued up as an OUTPUT on every call, not merely never trusted as an INPUT. The original
 * implementation only ever SET `card.status = 'blocked'` from inside the sequence walk — a
 * card the walk never reaches (because an earlier, independent card made `nextCard` return
 * first) keeps whatever `status` it already had, stale `blocked` included, even after its
 * parking dependency has since shipped. That stale status is exactly what
 * `persistLocalState`/`serializeState` write to disk, and exactly what Task 3's report reads
 * — an incoherent "blocked, blockedOn: X" report line for a card whose blocker X has shipped.
 *
 * Reconciling the WHOLE state against `blockedCardIds` up front, before the sequence walk
 * even starts, makes the invariant total instead of incidental: every card not currently
 * `shipped`/`escalated` ends this call with `status === 'blocked'` if and only if it is in
 * `blockedCardIds`. Only cards whose status actually needs to change are touched (a v1 state
 * file with no `dependsOn`/`blocked` anywhere computes an empty `blockedCardIds` and finds no
 * card already `status: 'blocked'`, so it reconciles zero cards — the byte-identical
 * round-trip contract is unaffected).
 *
 * Reset target is `staged`, never `running`: only `staged`/`running` cards can ever become
 * blocked (§O4), and `running` is re-derived from gh/git by D4 (`deriveCardPhase`) rather
 * than trusted from the file, so resetting to `staged` is the safe, lossless choice — D4 will
 * re-derive `running` itself if that's still true on the next pass. */
function reconcileBlockedStatuses(
  cards: CampaignState['cards'],
  blockedCardIds: ReadonlySet<string>,
): void {
  for (const [cardId, card] of Object.entries(cards)) {
    const shouldBeBlocked = blockedCardIds.has(cardId);
    if (shouldBeBlocked && card.status !== 'blocked') {
      card.status = 'blocked';
    } else if (!shouldBeBlocked && card.status === 'blocked') {
      card.status = 'staged';
    }
  }
}

/** D5/D2/Task-1 §O4: the first PROGRESSABLE card in `sequence` — not `shipped`, not
 * `escalated` (unless `includeEscalated`, OR — P6 fix-list — its escalation has since been
 * ANSWERED: see below), and (new, Task 1) not `blocked` (a status that is now always
 * up-to-date: `reconcileBlockedStatuses` trues up every card in `state.cards` against
 * `computeBlockedCardIds`'s fixpoint before this walk ever starts — see that function's doc
 * comment for why "set on the way in, but never cleared on the way out" was a bug, not merely
 * an unfinished feature). A card whose `dependsOn` includes a card that is merely
 * unshipped-but-healthy (`staged`/`running`) is skipped with its own status left untouched —
 * it is not `blocked` (its dependency isn't parked), and it may still ship later this same
 * pass, once that dependency ships.
 *
 * P6 fix-list (blocker fix): `card.status === 'escalated'` alone is NOT enough to keep
 * excluding a card once `--include-escalated` is absent. `card.status` is durable — nothing
 * ever resets it away from `'escalated'` except the card itself shipping or re-escalating —
 * while the escalation-answered SIGNAL is the escalation file's presence, exactly the same
 * fact `deriveCardPhase`'s own short-circuit (`core/loop/phase.ts`) already keys on. Before
 * this fix, gating on `card.status` alone meant the orchestrate-campaign skill's ruling
 * ritual (append the ruling to answers.md, archive the escalation file) had ZERO effect on
 * whether a flag-less re-trigger could ever reach this card again — it stayed silently
 * skipped forever, the exact B14 "every re-trigger needs --include-escalated" trap this
 * fix-list entry exists to close. Consulting the file here, the same way `deriveCardPhase`
 * does, makes "answered" (file archived) behave identically to "shipped" for selection
 * purposes without ever needing `includeEscalated` — while a genuinely UNANSWERED escalation
 * (file still present) keeps parking exactly as before.
 *
 * A card with no `dependsOn` (or an empty one) is independent, exactly today's behavior. If
 * the next progressable card's `spec`/`plan` are missing or don't exist on disk (checked via
 * the injected `io.fileExists`, resolved against `io.repoRoot`), returns a `PLANNING_NEEDED`
 * marker instead of the card. */
export function nextCard(
  state: CampaignState,
  io: StateIO,
  options: NextCardOptions = {},
): NextCardResult {
  const includeEscalated = options.includeEscalated ?? false;
  const blockedCardIds = computeBlockedCardIds(state.cards);
  reconcileBlockedStatuses(state.cards, blockedCardIds);

  for (const cardId of state.sequence) {
    const card = state.cards[cardId];
    if (!card) continue;
    if (card.status === 'shipped') continue;
    if (card.status === 'escalated' && !includeEscalated) {
      const escalationPath = escalationPathOf(io.homeDir, cardId);
      if (io.fileExists(escalationPath)) continue; // still unanswered — keep parking.
      // The escalation file is gone (archived by the skill's ruling ritual, or by
      // `shipCard`) — the escalation has been answered; fall through and treat this card as
      // progressable, exactly as `deriveCardPhase` already would for a flag-less re-trigger.
    }
    if (card.status === 'blocked') continue;

    const dependsOn = card.dependsOn ?? [];
    const hasUnmetDependency = dependsOn.some((id) => state.cards[id]?.status !== 'shipped');
    if (hasUnmetDependency) continue;

    const missing = resolveMissing(card, io.repoRoot, io);
    if (missing.length > 0) {
      return { kind: 'planning_needed', cardId, missing };
    }
    return { kind: 'card', cardId, card };
  }

  return { kind: 'done' };
}
