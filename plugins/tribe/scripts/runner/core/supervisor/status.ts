/** Pure shaping of the supervisor's status publication and its owner-facing park document (spec
 * §10, §11, §13). Timestamps arrive as arguments — this module never reads a clock — mirroring
 * `core/watchdog/status.ts`'s own contract verbatim, down to the non-finite-ms guard. */
import {
  SUPERVISOR_EXIT_DONE, SUPERVISOR_EXIT_NEEDS_OWNER, SUPERVISOR_EXIT_RUNNING,
  SUPERVISOR_EXIT_USAGE,
  type ParkReason, type SupervisorStatus,
} from './model.ts';

/** `core/watchdog/status.ts`'s G1 guard, reused verbatim: a millisecond value arriving from the
 * edge is not guaranteed finite by the type system alone — surface a non-finite value as a
 * clearly invalid marker rather than letting `new Date(x).toISOString()` throw an uncaught
 * `RangeError`, which would defeat the whole point of a process meant to survive crashes. */
function isoOrInvalid(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '(invalid-timestamp)';
}

/** Spec §10's four exit codes, as the four terminal SHAPES the CLI edge can reach: the campaign
 * closed; the arguments were unusable; `NEEDS_OWNER.md` was written; a live supervisor already
 * held the lock and this process wrote nothing (P1). `park`'s reason lives in the rendered
 * document, not in the exit code — every `needs_owner` exit is the same code `20` regardless of
 * WHICH `ParkReason` caused it (spec §10's table). */
export type SupervisorTerminalKind = 'done' | 'usage' | 'needs_owner' | 'already_running';

export function exitCodeOf(kind: SupervisorTerminalKind): number {
  switch (kind) {
    case 'done': return SUPERVISOR_EXIT_DONE;
    case 'usage': return SUPERVISOR_EXIT_USAGE;
    case 'needs_owner': return SUPERVISOR_EXIT_NEEDS_OWNER;
    case 'already_running': return SUPERVISOR_EXIT_RUNNING;
  }
}

export interface BuildStatusInput {
  pid: number;
  home: string;
  campaign: string;
  startedAtMs: number;
  updatedAtMs: number;
  state: SupervisorStatus['state'];
  lastAction: string;
  watchdog: SupervisorStatus['watchdog'];
  currentSession: SupervisorStatus['currentSession'];
  counters: SupervisorStatus['counters'];
  terminal: SupervisorStatus['terminal'];
}

/** Spec §13, verbatim shape. Every field the caller hands in is copied (never re-derived, never
 * defaulted) except the two timestamps, which go through `isoOrInvalid`. */
export function buildStatus(input: BuildStatusInput): SupervisorStatus {
  return {
    v: 1,
    pid: input.pid,
    home: input.home,
    campaign: input.campaign,
    startedAt: isoOrInvalid(input.startedAtMs),
    updatedAt: isoOrInvalid(input.updatedAtMs),
    state: input.state,
    lastAction: input.lastAction,
    watchdog: { ...input.watchdog },
    currentSession: input.currentSession === null ? null : { ...input.currentSession },
    counters: { ...input.counters, rulingRounds: { ...input.counters.rulingRounds } },
    terminal: input.terminal === null ? null : { ...input.terminal },
  };
}

export function serializeStatus(status: SupervisorStatus): string {
  return `${JSON.stringify(status, null, 2)}\n`;
}

interface ParkSentence {
  /** Spec §11: "one rendered sentence per park reason — from a frozen table, never free text."
   * Static; never interpolates a session's or `decide()`'s own free-form `detail` string. */
  what: string;
  /** Spec §11: "one rendered instruction per park reason, from the same frozen table." May
   * reference the `{home}`, `{card}`, `{rerun}` placeholders, filled in by `renderNeedsOwner`
   * from typed context. */
  unblock: string;
}

/** Spec §6.2's frozen `ParkReason` union (22 values, model.ts's own count — spec §6.2: "Twenty-two
 * values... The last two are the integrity parks added by §5.2 and §5.3"), each mapped to exactly
 * one `NEEDS_OWNER.md` sentence pair. **A `ParkReason` this table has no entry for is a TYPE
 * ERROR** (`Record<ParkReason, ParkSentence>`) — no generic fallback is added for a missing entry;
 * that is the point (Task 10's adjudication rule, REFUTED in advance). `what`/`unblock` text below
 * is grounded in `decide.ts`'s own row-by-row comments and spec §3.4's decision table — the same
 * facts that produced the park, restated for the owner instead of for a reviewer. */
export const PARK_SENTENCES: Record<ParkReason, ParkSentence> = {
  owner_only: {
    what: "A card's escalation reason is on the owner-only list, or is one of the register's "
      + 'four owner-reserved classes — no session may rule on it.',
    unblock: "Rule on {card}'s question yourself: append a ruling to {home}/answers.md tagged "
      + 'with the next R<n> id and a `ratified-as:` value (rule <path> | debt <id> | roadmap '
      + '<ref> | operational | dismissed), archive {home}/escalations/{card}.md to '
      + '.resolved-R<n>, delete this file, then re-run: {rerun}',
  },
  too_hard: {
    what: 'A ruling session judged the question genuinely undecidable on the facts it was given '
      + '(a valid typed park marker, not a failure).',
    unblock: "Rule on {card}'s question yourself (see {home}/escalations/{card}.md for the full "
      + 'context), append the ruling to {home}/answers.md, archive the escalation file, delete '
      + 'this file, then re-run: {rerun}',
  },
  w7_cap: {
    what: "A card used its full ruling-round budget (W7) without landing an acceptable ruling.",
    unblock: "Rule on {card}'s open question yourself, append the ruling to {home}/answers.md, "
      + 'archive {home}/escalations/{card}.md, delete this file, then re-run: {rerun}',
  },
  ratify_cap: {
    what: 'The ratify-round budget was spent without every ruling reaching a ratified '
      + '`ratified-as:` value.',
    unblock: 'Repair the remaining `ratified-as:` fields in {home}/answers.md by hand (rule '
      + '<path> | debt <id> | roadmap <ref> | operational | dismissed), delete this file, then '
      + 're-run: {rerun}',
  },
  spawn_cap: {
    what: 'The total one-shot session budget for this campaign is spent.',
    unblock: 'Raise --max-spawns for the next run, or finish the remaining judgment by hand in '
      + '{home}/answers.md, then delete this file and re-run: {rerun}',
  },
  watchdog_run_cap: {
    what: 'The watchdog was re-triggered as many times as this run allows without the campaign '
      + 'reaching a terminal state.',
    unblock: 'Investigate {home}/watchdog/status.json and the runner logs under {home}/runs/ for '
      + 'what is preventing progress, then delete this file and re-run: {rerun}',
  },
  repeat_escalation: {
    what: 'A card re-escalated with the exact same question body already ruled once this run — '
      + 'the prior ruling did not land as expected.',
    unblock: 'Check {home}/answers.md and {home}/escalations/{card}.md by hand, resolve the '
      + 'mismatch, delete this file, then re-run: {rerun}',
  },
  ruling_failed: {
    what: 'A ruling session failed or timed out and the retry budget for it is exhausted.',
    unblock: "Rule on {card}'s open question yourself, append the ruling to {home}/answers.md, "
      + 'archive {home}/escalations/{card}.md, delete this file, then re-run: {rerun}',
  },
  ratify_failed: {
    what: 'A ratify session failed or timed out and the retry budget for it is exhausted.',
    unblock: 'Repair the remaining `ratified-as:` fields in {home}/answers.md by hand, delete '
      + 'this file, then re-run: {rerun}',
  },
  closing_failed: {
    what: 'The closing session failed or timed out and the retry budget for it is exhausted.',
    unblock: "Review {home}/supervisor/sessions/ for the closing session's log, finish the "
      + 'closing report by hand at {home}/supervisor/final-report.md, delete this file, then '
      + 're-run: {rerun}',
  },
  session_incomplete: {
    what: 'The watchdog reported an incomplete executor session and the one-shot retrigger '
      + 'budget is spent.',
    unblock: 'Investigate why the executor session never completed (see {home}/runs/ and the '
      + "card's own log), delete this file, then re-run: {rerun}",
  },
  quota_cap: {
    what: 'The watchdog exhausted its quota-wait budget.',
    unblock: "Wait for the account's quota to reset (or switch accounts), delete this file, then "
      + 're-run: {rerun}',
  },
  overloaded: {
    what: 'The watchdog exhausted its overload-backoff budget.',
    unblock: 'Wait for upstream overload to clear, delete this file, then re-run: {rerun}',
  },
  stalled: {
    what: 'The watchdog observed a stalled runner (no log activity within its stall window).',
    unblock: 'Inspect the stalled card\'s log under {home}/runs/, decide whether to resume or '
      + 'reset it, delete this file, then re-run: {rerun}',
  },
  lock_conflict: {
    what: 'The watchdog could not resolve a runner lock conflict.',
    unblock: 'Check {home}/.runner.lock for a stale or foreign pid, clear it by hand if needed, '
      + 'delete this file, then re-run: {rerun}',
  },
  error: {
    what: 'The watchdog reported an unrecoverable error.',
    unblock: "Read {home}/watchdog/status.json and the watchdog's own log for the error, resolve "
      + 'it, delete this file, then re-run: {rerun}',
  },
  unexpected_running: {
    what: 'The watchdog reported a --once-only terminal reason while the supervisor was running '
      + 'it --follow — a contract violation by the layer below.',
    unblock: 'Report this as a bug (the watchdog and supervisor have disagreed on invocation '
      + 'mode); once fixed, delete this file and re-run: {rerun}',
  },
  watchdog_no_terminal: {
    what: 'The watchdog child exited without ever publishing a terminal reason, and the one '
      + 'bounded retry is spent.',
    unblock: "Inspect {home}/watchdog/status.json and the watchdog's own log for why it exited "
      + 'silently, delete this file, then re-run: {rerun}',
  },
  watchdog_usage: {
    what: "The watchdog child exited with its own usage error (exit code 1).",
    unblock: 'Check the watchdog invocation\'s flags (see {home}/supervisor/events.jsonl for the '
      + 'exact command), fix the misconfiguration, delete this file, then re-run: {rerun}',
  },
  resume_blocked: {
    what: 'A previous run already parked this campaign — NEEDS_OWNER.md was present at start, or '
      + "a foreign supervisor still held the lock — and resume is refused until the owner acts.",
    unblock: 'Handle the prior park described in the rest of this file, delete this file once '
      + 'resolved, then re-run: {rerun}',
  },
  history_rewritten: {
    what: 'A one-shot session rewrote or deleted a prior ruling in answers.md — the ruling trail '
      + 'is no longer trustworthy. This never retries.',
    unblock: 'Restore {home}/answers.md from version control to the last known-good ruling '
      + 'trail, investigate the session that rewrote it, delete this file, then re-run: {rerun}',
  },
  ratify_out_of_scope: {
    what: 'A ratify session edited a ruling block outside the ids it was asked to ratify. This '
      + 'never retries.',
    unblock: 'Review {home}/answers.md by hand for any unintended edit, restore from version '
      + 'control if needed, delete this file, then re-run: {rerun}',
  },
};

export interface NeedsOwnerInput {
  campaignSlug: string;
  campaignHome: string;
  reason: ParkReason;
  /** When this file is written (arrives as an argument — never read from a clock). */
  atMs: number;
  /** The card this park is about, when it is about one card's escalation; `null` for a
   * campaign-wide park (a budget cap, a watchdog condition, `resume_blocked`, …). */
  cardId: string | null;
  /** The escalation file's own `**Reason:**` line and `## Context` section, verbatim — `null`
   * when this park is not about a specific card's escalation. */
  question: { reasonLine: string; context: string } | null;
  rulingRoundsUsed: Array<{ cardId: string; used: number; max: number }>;
  spawnsUsed: { used: number; max: number };
  rulingsLandedThisRun: string[];
  watchdogRuns: number;
  lastWatchdogTerminalReason: string | null;
  /** The `ledger.jsonl` lines for this run, verbatim. */
  ledgerLines: string[];
  /** The exact `supervise` command that re-runs this campaign (composed by the CLI edge from its
   * own argv — this module never assembles a command line itself). */
  rerunCommand: string;
}

function fillPlaceholders(template: string, ctx: NeedsOwnerInput): string {
  return template
    .replaceAll('{home}', ctx.campaignHome)
    .replaceAll('{card}', ctx.cardId ?? '(the affected card)')
    .replaceAll('{rerun}', ctx.rerunCommand);
}

/** Spec §11's `NEEDS_OWNER.md` format, rendered from typed disk facts only — never from an LLM's
 * prose (card Oracle). Every section below matches the spec's own template verbatim, section by
 * section. */
export function renderNeedsOwner(ctx: NeedsOwnerInput): string {
  const sentence = PARK_SENTENCES[ctx.reason];
  const at = isoOrInvalid(ctx.atMs);
  const roundsLine = ctx.rulingRoundsUsed.length > 0
    ? ctx.rulingRoundsUsed.map((r) => `${r.cardId} ${r.used}/${r.max}`).join(', ')
    : '(no ruling rounds used this run)';
  const rulingsLanded = ctx.rulingsLandedThisRun.length > 0
    ? ctx.rulingsLandedThisRun.join(', ')
    : '(none landed this run)';
  const question = ctx.question === null
    ? "(not applicable — this park is not about one card's escalation)"
    : `${ctx.question.reasonLine}\n\n${ctx.question.context}`;
  const ledger = ctx.ledgerLines.length > 0
    ? ctx.ledgerLines.join('\n')
    : '(no spawns this run)';

  return `# Campaign needs the owner: ${ctx.campaignSlug}

**Park reason:** ${ctx.reason}
**At:** ${at}          **Supervisor exit:** ${SUPERVISOR_EXIT_NEEDS_OWNER}
**Campaign home:** ${ctx.campaignHome}

## What happened
${sentence.what}

## The question (when a card is parked)
${question}

## What I already did
- Ruling rounds used: ${roundsLine}   · Spawns used: ${ctx.spawnsUsed.used}/${ctx.spawnsUsed.max}
- Rulings landed this run: ${rulingsLanded}
- Watchdog runs: ${ctx.watchdogRuns}; last terminal reason: ${ctx.lastWatchdogTerminalReason ?? '(none)'}

## What unblocks it
${fillPlaceholders(sentence.unblock, ctx)}

## Ledger
${ledger}
`;
}
