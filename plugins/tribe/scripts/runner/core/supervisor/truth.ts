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

  // Run ids are `<ISO-with-dashes>-<hex>` (core/run-record.ts#generateRunId), so lexicographic
  // comparison IS chronological comparison. `runs` arrives ascending; the last strictly-newer
  // entry is the newest one.
  const newerRuns = o.runs.filter((r) => r.runId > watchdogRunId);
  const candidate: RunFact | undefined =
    newerRuns.length > 0
      ? newerRuns[newerRuns.length - 1]
      : o.runs.find((r) => r.runId === watchdogRunId);

  if (candidate === undefined) return null;

  if (candidate.endedAt === null && candidate.alive) {
    return { kind: 'newer_run_alive', runId: candidate.runId };
  }
  if (candidate.endedAt !== null && typeof candidate.exitCode === 'number') {
    return { kind: 'run_finalised', runId: candidate.runId, exitCode: candidate.exitCode, reason: candidate.reason };
  }
  // Neither alive nor finalised (e.g. a dead pid with no record of finishing) proves nothing.
  return null;
}

/** "Is this park still true?" `true` for every park reason that is not a runner-liveness claim —
 * refusing to resume while a park is still TRUE is BY DESIGN (the card's oracle). */
export function parkStillHolds(o: SupervisorObservation): boolean {
  if (o.parkedTerminal === null) return true;
  if (!RUNNER_LIVENESS_PARK_REASONS.has(o.parkedTerminal.reason)) return true;
  return terminalContradiction(o) === null;
}
