/**
 * The supervisor's PURE decision core (spec §3.4, frozen — S-P1): `(observation) -> action`. No
 * clock (`nowMs` arrives on the observation), no fs, no spawn, no throw, no randomness.
 *
 * Oracle (card `## Oracle`, verbatim): "Spawning a session when none was needed = bug (that is
 * the waste this card removes). Parking for the owner when a session could have ruled = by
 * design (when in doubt, park). The supervisor deciding anything from an LLM's prose = bug. It
 * reads typed disk facts only."
 *
 * Row order is the contract (S-P1: first match wins). Every branch below is written in the exact
 * order spec §3.4 lists it, with the row number(s) it implements named in a comment.
 */
import type { EscalationFact, ParkReason, SupervisorAction, SupervisorObservation } from './model.ts';
import { parkStillHolds } from './truth.ts';

function park(reason: ParkReason, detail: string): SupervisorAction {
  return { kind: 'park', reason, detail };
}

/** "The next unanswered card" (§3.4 rows 5-12): the first escalation whose file has not yet been
 * archived. `escalations` order is the report's own order — decide() never reorders it. */
function nextUnanswered(escalations: EscalationFact[]): EscalationFact | null {
  return escalations.find((e) => e.filePresent) ?? null;
}

/** §3.4 row 23: these five terminal reasons are `--once`-only (the watchdog's own `decide()`
 * only ever returns them when invoked with `mode: 'once'`); the supervisor always runs
 * `--follow`, so observing one here is a contract violation by the layer below, never a case to
 * guess at. */
const ONCE_ONLY_REASONS = new Set([
  'runner_alive',
  'quota_wait_pending',
  'overload_backoff_pending',
  'launched',
  'relaunched',
]);

export function decide(o: SupervisorObservation): SupervisorAction {
  // --- Post-session rows V1-V8 (§3.4): "the loop records the verdict into the observation as
  // `lastSessionOutcome` and re-enters `decide()`" — these run BEFORE any other row, whenever a
  // session just returned. V7/V8 are handled explicitly here, same as V1-V6; only a MALFORMED
  // outcome (a 'ruled'/'parked' verdict missing its required id/kind — a contract violation by
  // the layer below) falls through to the ordinary pre-loop/main rows, rather than being
  // silently swallowed.
  if (o.lastSessionOutcome !== null) {
    const outcome = o.lastSessionOutcome;

    // V1: an integrity violation — never a retry, whatever the retry budget says.
    if (outcome.outcome === 'history_rewritten') {
      return park(
        'history_rewritten',
        `the ${outcome.kind} session for card ${String(outcome.cardId)} rewrote or deleted a `
          + 'prior ruling in answers.md; the ruling trail is no longer trustworthy and this is '
          + 'never retried',
      );
    }
    // V2: same class of violation as V1 — never a retry.
    if (outcome.outcome === 'ratify_out_of_scope') {
      return park(
        'ratify_out_of_scope',
        `the ratify session for card ${String(outcome.cardId)} touched a ruling block outside `
          + 'the ids it was asked to ratify; never retried',
      );
    }
    // V3: a verified ruling — the supervisor (not the session) performs the archive (§5.5).
    if (outcome.outcome === 'ruled' && outcome.cardId !== null && outcome.rulingId != null) {
      return { kind: 'archive_escalation', cardId: outcome.cardId, rulingId: outcome.rulingId };
    }
    // V4: a valid typed park marker the session itself wrote (§6.1).
    if (outcome.outcome === 'parked' && outcome.parkMarkerKind !== undefined) {
      return park(
        outcome.parkMarkerKind,
        `the ${outcome.kind} session for card ${String(outcome.cardId)} parked with marker `
          + `kind ${outcome.parkMarkerKind}`,
      );
    }
    // V5/V6: a failed attempt — one bounded retry, then park. The retry count is keyed by
    // session kind + card (no dedicated state field; the dispatch ruling names this exact key).
    if (outcome.outcome === 'failed' || outcome.outcome === 'timeout') {
      const retryKey = `${outcome.kind}:${outcome.cardId}`;
      const retries = o.state.retriggers[retryKey] ?? 0;
      if (retries < o.limits.sessionRetries) {
        return { kind: 'spawn_session', session: outcome.kind, cardId: outcome.cardId };
      }
      const failedReason: ParkReason = outcome.kind === 'ruling'
        ? 'ruling_failed'
        : outcome.kind === 'ratify'
          ? 'ratify_failed'
          : 'closing_failed';
      return park(
        failedReason,
        `the ${outcome.kind} session for card ${String(outcome.cardId)} ${outcome.outcome} `
          + `and the retry budget (${o.limits.sessionRetries}) is exhausted`,
      );
    }
    // V7: the unratified list reached empty. "Same scope" resolves to the base scope
    // (`{cards: null, includeEscalated: false}`) — the SAME literal used for rows 16/24 above:
    // a fresh watchdog run over the whole campaign, not a card-scoped re-run.
    if (outcome.outcome === 'ratified') {
      return { kind: 'run_watchdog', cards: null, includeEscalated: false };
    }
    // V8: the final report exists and nothing is unratified — the campaign closes.
    if (outcome.outcome === 'closed') {
      return { kind: 'exit', status: 'done', reason: 'campaign_closed' };
    }
    // outcome.outcome is a 'ruled'/'parked' outcome missing its required id/kind (a contract
    // violation by the layer below) — not a row this block owns; fall through and let the
    // ordinary rows below decide from the rest of the observation.
  }

  // --- Pre-loop rows P1-P4 (§3.4): evaluated before any watchdog is run.
  // P1: a live foreign supervisor — refused, never a second one (D74-7).
  if (o.supervisorLock !== null && o.supervisorLock.alive) {
    return park(
      'resume_blocked',
      `a live supervisor (pid ${o.supervisorLock.pid}) already holds this campaign's lock`,
    );
  }
  // P2: an unresolved park is never silently resumed — but a park whose stated condition the disk
  // has already falsified is SUPERSEDED, not obeyed (G3). `parkStillHolds` is the pure predicate;
  // a park that still holds refuses exactly as before.
  if (o.needsOwnerPresent) {
    if (!parkStillHolds(o)) {
      return {
        kind: 'supersede_park',
        priorReason: o.parkedTerminal?.reason ?? 'unknown',
        detail: 'the park condition no longer holds on disk; re-observing and continuing',
      };
    }
    return park('resume_blocked', 'NEEDS_OWNER.md is present; resume is blocked until the owner deletes it');
  }
  // P3: a STOP file honoured immediately, every tick.
  if (o.stopFilePresent) {
    return { kind: 'exit', status: 'done', reason: 'stop_requested' };
  }
  // P4: a live watchdog is adopted, never a second one spawned.
  if (o.watchdogLive !== null && o.watchdogLive.alive) {
    return { kind: 'await_watchdog', pid: o.watchdogLive.pid };
  }

  // --- Main rows 1-28 (§3.4), keyed on the watchdog's terminal reason.
  const w = o.lastWatchdog;

  // Row 27: nothing has run yet this invocation. (Checking this first rather than last is
  // behaviourally identical to the table's own row order: every row below implicitly requires
  // `lastWatchdog !== null`, so none of them can match while this one does.)
  if (w === null) {
    return { kind: 'run_watchdog', cards: null, includeEscalated: false };
  }

  const reason = w.terminal?.reason ?? null;

  // Rows 1-3: runner_done.
  if (reason === 'runner_done') {
    if (o.state.closingVerified) return { kind: 'exit', status: 'done', reason: 'campaign_closed' };
    if (o.unratifiedRulings.length > 0) return { kind: 'spawn_session', session: 'ratify', cardId: null };
    // R11 (Task 20, spec §5.4 item 4): fail closed rather than spawn a `closing` session that
    // cannot verify any card — checked BEFORE the spawn, never after (a session with no
    // verify-shipped plugin loaded would fail `Unknown skill` mid-brief instead of parking with
    // a reason an owner can act on).
    if (!o.verifyShippedPluginAvailable) {
      return park(
        'closing_failed',
        'the verify-shipped plugin dir was not found at the runner-resolved location; a closing '
          + 'session cannot verify any card (R11)',
      );
    }
    return { kind: 'spawn_session', session: 'closing', cardId: null };
  }

  // Row 4: stop_requested.
  if (reason === 'stop_requested') {
    return { kind: 'exit', status: 'done', reason: 'stop_requested' };
  }

  // Rows 5-12: escalations_pending.
  if (reason === 'escalations_pending') {
    const next = nextUnanswered(o.escalations);
    // Row 6: every escalated card has been answered this round.
    if (next === null) {
      const answered = o.escalations.filter((e) => !e.filePresent).map((e) => e.cardId);
      const notReached = o.report === null
        ? []
        : Object.entries(o.report.cards)
          .filter(([, c]) => c.outcome === 'not_reached')
          .map(([cardId]) => cardId);
      return { kind: 'run_watchdog', cards: [...answered, ...notReached], includeEscalated: false };
    }
    // Row 5: crash-recovery guard (§4.3) — a ruling already landed in answers.md for this card
    // but the escalation file was never archived; archive it rather than re-ruling. This is
    // checked BEFORE rows 7-12 so an un-archived landed ruling can never be mistaken for a fresh
    // escalation needing a park or a new ruling session.
    if (next.landedRulingId !== null) {
      return { kind: 'archive_escalation', cardId: next.cardId, rulingId: next.landedRulingId };
    }
    // Row 7: the next unanswered card carries a park marker a session already wrote.
    const marker = o.parkMarkers.find((m) => m.cardId === next.cardId);
    if (marker !== undefined) {
      return park(marker.kind, `card ${next.cardId} carries a park marker: ${marker.kind} (${marker.note})`);
    }
    // Row 8: the trigger is on the owner-only list.
    if (o.ownerOnlyEscalations.includes(next.reason)) {
      return park('owner_only', `card ${next.cardId}'s escalation reason "${next.reason}" is owner-only`);
    }
    // Row 9: this exact content has already been ruled once (the repeat-escalation breaker).
    if ((o.state.seenEscalations[next.cardId] ?? []).includes(next.contentSha256)) {
      return park('repeat_escalation', `card ${next.cardId} re-escalated with a body already ruled`);
    }
    // Row 10 (W7): the per-card ruling-round cap is spent.
    if ((o.state.rulingRounds[next.cardId] ?? 0) >= o.limits.maxRulingRounds) {
      return park('w7_cap', `card ${next.cardId} has used its ${o.limits.maxRulingRounds} auto-answer rounds`);
    }
    // Row 11: the total spawn budget is spent.
    if (o.state.spawns >= o.limits.maxSpawns) {
      return park('spawn_cap', `the total spawn budget (${o.limits.maxSpawns}) is spent`);
    }
    // Row 12: otherwise, rule on it.
    return { kind: 'spawn_session', session: 'ruling', cardId: next.cardId };
  }

  // Rows 13-15: rulings_unratified.
  if (reason === 'rulings_unratified') {
    if (o.state.ratifyRounds >= o.limits.maxRatifyRounds) {
      return park('ratify_cap', `the ratify-round cap (${o.limits.maxRatifyRounds}) is spent`);
    }
    if (o.state.spawns >= o.limits.maxSpawns) {
      return park('spawn_cap', `the total spawn budget (${o.limits.maxSpawns}) is spent`);
    }
    return { kind: 'spawn_session', session: 'ratify', cardId: null };
  }

  // Rows 16-17: session_incomplete.
  if (reason === 'session_incomplete') {
    const retries = o.state.retriggers['session_incomplete'] ?? 0;
    if (o.state.watchdogRuns < o.limits.maxWatchdogRuns && retries < 1) {
      return { kind: 'run_watchdog', cards: null, includeEscalated: false };
    }
    return park('session_incomplete', 'the watchdog reported an incomplete session and the one-shot retrigger is spent');
  }

  // Rows 18-22: five distinct terminal reasons, five distinct park reasons.
  if (reason === 'quota_cap') return park('quota_cap', 'the watchdog exhausted its quota-wait budget');
  if (reason === 'overloaded') return park('overloaded', 'the watchdog exhausted its overload-backoff budget');
  if (reason === 'stalled') return park('stalled', 'the watchdog observed a stalled runner');
  if (reason === 'lock_conflict') return park('lock_conflict', 'the watchdog could not resolve a lock conflict');
  if (reason === 'error') return park('error', 'the watchdog reported an unrecoverable error');

  // Row 23: a `--once`-only reason is a contract violation by the layer below — fail closed.
  if (reason !== null && ONCE_ONLY_REASONS.has(reason)) {
    return park('unexpected_running', `watchdog reported --once-only reason "${reason}" while running --follow`);
  }

  // Rows 24-25: the watchdog child exited without ever publishing a terminal.
  if (w.terminal === null) {
    const retries = o.state.retriggers['watchdog_no_terminal'] ?? 0;
    if (o.state.watchdogRuns < o.limits.maxWatchdogRuns && retries < 1) {
      return { kind: 'run_watchdog', cards: null, includeEscalated: false };
    }
    return park('watchdog_no_terminal', 'the watchdog child exited without ever publishing a terminal reason');
  }

  // Row 26: the watchdog child's own exit code was a usage error.
  if (w.ownedExitCode === 1) {
    return park('watchdog_usage', 'the watchdog child exited with usage code 1');
  }

  // Row 28: the watchdog-run cap is spent — a standalone guard keyed only on the run-cap knob,
  // never conflated with the residual "unrecognised reason" backstop below (that is a different
  // failure with its own honest reason).
  if (o.state.watchdogRuns >= o.limits.maxWatchdogRuns) {
    return park('watchdog_run_cap', `the watchdog was re-triggered its maximum ${o.limits.maxWatchdogRuns} times`);
  }

  // Residual backstop: an unrecognised terminal reason, under the run cap — every row above
  // (1-28) failed to match. Fail closed with the honest 'error' reason; never guess.
  return park('error', `unrecognised watchdog terminal reason "${String(reason)}"`);
}
