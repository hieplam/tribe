/**
 * The card's two pure truth predicates (spec §2.2, card `supervisor-park-truth`). PURE: no fs,
 * no clock, no spawn, no randomness, no throw — everything arrives on the observation
 * (`pure-core.md`).
 *
 * Oracle (card `## Oracle`, verbatim): "Parking when the disk says the park is false = bug.
 * Refusing to resume while a park is still TRUE = by design." `parkStillHolds` therefore returns
 * `true` for every park reason that is not a runner-liveness claim — this card narrows nothing
 * else, and a predicate that superseded parks liberally would be a worse bug than the one being
 * fixed.
 */
import type { RunFact, SupervisorObservation } from './model.ts';

/** "Does the disk contradict this terminal?" `null` when it does not — every existing `decide()`
 * row then behaves exactly as before. */
export type TerminalContradiction =
  | { kind: 'newer_run_alive'; runId: string }
  | { kind: 'run_finalised'; runId: string; exitCode: number; reason: string | null };

/** §6.1/G3's set of park reasons that are claims about a RUNNER still being alive — the only
 * reasons a disk fact about a run can ever falsify. A small named set so an additive reason is a
 * one-line change, never a broadened predicate. */
const RUNNER_LIVENESS_PARK_REASONS: ReadonlySet<string> = new Set(['stalled']);

export function terminalContradiction(o: SupervisorObservation): TerminalContradiction | null {
  // No terminal published: nothing to contradict.
  if (o.lastWatchdog?.terminal == null) return null;

  // No idea which run the terminal is about: fail closed, nothing can be shown to contradict it.
  const watchdogRunId = o.watchdogRunId;
  if (watchdogRunId === null) return null;

  // Every run that could speak to this terminal: each run strictly NEWER than the one the
  // terminal is about, PLUS the terminal's own run (which may itself have finalised since the
  // terminal was published). Run ids are `<ISO-with-dashes>-<hex>`
  // (core/run-record.ts#generateRunId), so lexicographic comparison IS chronological comparison
  // and `runs` arrives ascending — this list is ascending too.
  //
  // Asking only the NEWEST candidate was a defect (B-F4): a killed relaunch leaves a run
  // directory behind with a dead pid and no `endedAt` — an INCONCLUSIVE record — and that record
  // MASKED a genuinely alive run sitting behind it, so the supervisor parked a campaign whose
  // runner was alive (the Oracle's first sentence). The recorded incident home carries three run
  // directories; multi-run homes are normal, not exotic.
  const candidates = o.runs.filter((r) => r.runId >= watchdogRunId);
  const newestWhere = (matches: (r: RunFact) => boolean): RunFact | undefined => {
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate: RunFact | undefined = candidates[i];
      if (candidate !== undefined && matches(candidate)) return candidate;
    }
    return undefined;
  };

  // LIVENESS WINS over inconclusiveness: a running process is the strongest fact on this disk,
  // and an inconclusive sibling can never outrank it.
  const alive = newestWhere((r) => r.endedAt === null && r.alive);
  if (alive !== undefined) return { kind: 'newer_run_alive', runId: alive.runId };

  const finalised = newestWhere((r) => r.endedAt !== null && typeof r.exitCode === 'number');
  if (finalised !== undefined && finalised.exitCode !== null) {
    return { kind: 'run_finalised', runId: finalised.runId, exitCode: finalised.exitCode, reason: finalised.reason };
  }

  // No candidate is alive and none has finalised (e.g. only dead pids with no record of
  // finishing) — that proves nothing, so the terminal stands.
  return null;
}

/**
 * The two reason vocabularies are NOT the same vocabulary, so a run's own reason is TRANSLATED
 * before any `decide()` row is keyed on it — never substituted raw.
 *
 * - `runs/<runId>/run.json`'s `reason` is `core/report.ts#ExitReason`, whose success value is
 *   `'done'`.
 * - `decide()`'s rows are keyed on the WATCHDOG's terminal-reason vocabulary
 *   (`core/watchdog/decide.ts`), whose success value is `'runner_done'`.
 *
 * Substituting raw made a campaign that had just SUCCEEDED fall past every row into the residual
 * `park('error')` backstop — the card's oracle calls that a bug ("parking when the disk says the
 * park is false"). The map below is the whole of `ExitReason`, read off the type itself: `done`
 * is the one value that is spelled differently; the other five are spelled identically in both
 * vocabularies and map to themselves.
 *
 * PURE and TOTAL: no fs, no clock, no throw.
 */
const RUN_REASON_TO_TERMINAL_REASON: ReadonlyMap<string, string> = new Map([
  // The one genuine translation.
  ['done', 'runner_done'],
  // Spelled identically in both vocabularies — listed explicitly so the map stays exhaustive
  // over `ExitReason` and an added exit reason is a one-line change, never a silent fall-through.
  ['stop_requested', 'stop_requested'],
  ['escalations_pending', 'escalations_pending'],
  ['session_incomplete', 'session_incomplete'],
  ['rulings_unratified', 'rulings_unratified'],
  ['error', 'error'],
]);

/**
 * "What does this finished run's own reason mean in the vocabulary `decide()`'s rows speak?"
 * `null` means **make no substitution** — the caller must then leave the watchdog's own terminal
 * reason in force.
 *
 * FAILS CLOSED on anything unrecognised: an unknown run reason is never passed through, because a
 * silent pass-through is precisely the defect this function exists to prevent. A value the
 * supervisor cannot interpret must never be allowed to decide anything.
 */
export function terminalReasonForRunReason(runReason: string | null): string | null {
  if (runReason === null) return null;
  return RUN_REASON_TO_TERMINAL_REASON.get(runReason) ?? null;
}

/**
 * decide()'s G2 bound — "may the supervisor still re-run the watchdog BECAUSE a newer run is
 * alive?" — written ONCE and read by both callers: the G2 row itself, and `parkStillHolds`
 * below. Spelling this condition twice is how the two halves drifted apart in the first place.
 */
export function staleTerminalRetriggerAvailable(o: SupervisorObservation): boolean {
  const retries = o.state.retriggers['stale_terminal'] ?? 0;
  return o.state.watchdogRuns < o.limits.maxWatchdogRuns && retries < 1;
}

/**
 * "Is this park still true?" `true` for every park reason that is not a runner-liveness claim —
 * refusing to resume while a park is still TRUE is BY DESIGN (the card's oracle).
 *
 * A contradiction alone is not enough to supersede: it must also be ACTIONABLE, meaning the
 * supervisor has a remedy left to apply. Without that test (B-F3) a spent budget turned
 * supersession into infinite churn — the park was superseded, the very next tick re-derived the
 * same `stalled` reason (the budget being gone) and re-parked with a brand-new identical
 * `NEEDS_OWNER.md`, on every restart forever, leaving a trail of `.superseded-<ts>` files and
 * `park_superseded` events that read as "the campaign continued" when nothing was investigated.
 *
 * - `run_finalised` is ALWAYS actionable: it changes the effective terminal reason, so the next
 *   tick decides from a different row than the one that parked.
 * - `newer_run_alive` is actionable only while the G2 re-trigger is still available — the very
 *   condition `decide()` bounds that action with.
 *
 * When the machine has exhausted its own remedies, a human genuinely IS required.
 */
export function parkStillHolds(o: SupervisorObservation): boolean {
  if (o.parkedTerminal === null) return true;
  if (!RUNNER_LIVENESS_PARK_REASONS.has(o.parkedTerminal.reason)) return true;
  const contradiction = terminalContradiction(o);
  if (contradiction === null) return true;
  if (contradiction.kind === 'run_finalised') return false;
  return !staleTerminalRetriggerAvailable(o);
}
