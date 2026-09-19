// The report contract (Task 3, spec §O5): `campaign-report.json` + its `.md` twin, the ONLY
// artifact an orchestrating session needs to read after a runner invocation.
//
// Pure module: every world-touching operation (reading an escalation file, writing the report
// files) is injected through `ReportIO` — this file never imports `node:fs` or
// `child_process` (mirrors state.ts's/loop.ts's own purity). The two decisions the brief
// requires NOT to be buried in run.ts's `main()` — "which exit paths write a report" and "what
// does this exit map to as a reason" — live here as small, independently unit-tested pure
// functions (`shouldWriteReport`, `deriveExitReason`), so run.ts's wiring stays thin.
//
// Design choice (Warchief ruling 1): `card.status` is read as authoritative for `shipped` /
// `escalated` / `blocked` — this module NEVER recomputes the `dependsOn` fixpoint that
// state.ts's `nextCard`/`reconcileBlockedStatuses` already own. The per-card outcome is
// derived ENTIRELY from the final `CampaignState` (never from `loop.ts`'s `CardOutcome[]`) —
// `cli/main.ts`'s `tryWriteReport` reloads that state fresh from disk before calling into this
// module, rather than reusing `runLoop`'s own in-memory result, so this module's report stays
// correct even when the run ends via an unhandled exception mid-pass: `loop.ts`'s
// `shipCard`/`escalateCard` both call `persistLocalState` the moment a card concludes, so every
// card that finished before the crash is already durable on disk regardless of what happens to
// the rest of the pass afterward.
import { join } from 'node:path';
import { EXIT_ESCALATED, EXIT_LOCKED, EXIT_RULINGS_UNRATIFIED, EXIT_SESSION_INCOMPLETE } from './types.ts';
import type { Card, CampaignState } from './types.ts';
import type { ReportIO } from '../ports/ports.ts';
import { ESCALATIONS_DIRNAME, escalationPathOf } from './paths.ts';
import { parseEscalationQuestion } from './escalation.ts';

export type { ReportIO };

export const REPORT_JSON_FILENAME = 'campaign-report.json';
export const REPORT_MD_FILENAME = 'campaign-report.md';

/** The only report-schema version this module writes today (independent of state.ts's own
 * `CURRENT_STATE_VERSION` — a different artifact, a different version lineage). */
const REPORT_VERSION = 1;

/** §O5's `run.reason` vocabulary. `error` is new here (not named in the design doc's JSON
 * example) — it covers the plan's "any error after the state was loadable" exit path, which
 * has no `EXIT_*` code of its own in loop.ts (that constant lives in run.ts, the only place an
 * unhandled exception from `runLoop` is caught). `rulings_unratified` is harness-gap-wiring PR
 * C's campaign-level gate (`core/rulings.ts` + `run-loop.ts`'s post-`runPass` check): the pass
 * would otherwise have concluded `done`, but `answers.md` still carries ≥1 unratified ruling. */
export type ExitReason =
  | 'done'
  | 'stop_requested'
  | 'escalations_pending'
  | 'session_incomplete'
  | 'error'
  | 'rulings_unratified';

export interface ReportRunInfo {
  startedAt: string;
  endedAt: string;
  exitCode: number;
  reason: ExitReason;
  /** Only present when `reason === 'rulings_unratified'`: every unratified ruling id
   * (`core/rulings.ts`'s `RulingBlock.id`), so the orchestrating session can act (ratify each
   * one in `answers.md`) without re-parsing `answers.md` itself. */
  unratifiedRulings?: string[];
}

/** Everything this module needs from campaign config, as inputs (W1: nothing environment
 * specific is ever hardcoded here). `homeDir` is `--home` (Task 3, spec §4) — escalation file
 * paths resolve against it via `core/paths.ts`'s `escalationPathOf`, the same absolute path the
 * runner used to write the escalation file in the first place. */
export interface ReportConfig {
  /** `--home` — the campaign's machine-local operational home. */
  homeDir: string;
}

export type CardReportEntry =
  | {
      outcome: 'shipped';
      pr: number | null;
      mergeSha: string | null;
      /** P4 fix-list item: the `HealAction.kind`s `healSafeResidue` actually applied while
       * shipping this card (`card.healedResidue`, set only by `shipCard` — see
       * `core/loop/card-actions.ts`). OPTIONAL and present ONLY when non-empty, so every
       * existing shipped-card fixture/assertion that never healed anything is untouched. */
      healedResidue?: string[];
    }
  | { outcome: 'escalated'; escalationFile: string; question: string; autoAnswerRounds: number }
  | { outcome: 'blocked'; blockedOn: string }
  | { outcome: 'not_reached' };

export interface CampaignReport {
  v: number;
  campaign: string;
  run: ReportRunInfo;
  cards: Record<string, CardReportEntry>;
  pending: string[];
  stats: { shipped: number; escalated: number; blocked: number; notReached: number };
}

/** Design notes (brief): `--dry-run` writes NO report (zero side effects, by construction) and
 * `EXIT_LOCKED` writes NO report (a report from the REFUSED process would clobber the live
 * one's). Every other exit path writes one. Kept as its own pure, unit-tested predicate — per
 * the brief's design note 3 — rather than an inline check buried in run.ts's `main()`. */
export function shouldWriteReport(params: { dryRun: boolean; exitCode: number }): boolean {
  if (params.dryRun) return false;
  if (params.exitCode === EXIT_LOCKED) return false;
  return true;
}

/** Maps a `runLoop` outcome (plus whether `main()` caught an unhandled exception) to the §O5
 * `run.reason` vocabulary. `hasMessage` singles out the ONE `LoopResult` shape that carries a
 * `message` at `EXIT_OK` — the startup STOP-file early return (`loop.ts`'s `isStopRequested`
 * check before the loop even starts); every other `EXIT_OK` return has no message. A mid-pass
 * STOP (the loop's own `break` once processing is under way) is NOT separately distinguishable
 * from `loopResult` alone — see the Hunter's report to the Warchief for why. */
export function deriveExitReason(params: {
  exitCode: number;
  hasMessage: boolean;
  threw: boolean;
}): ExitReason {
  if (params.threw) return 'error';
  if (params.exitCode === EXIT_ESCALATED) return 'escalations_pending';
  if (params.exitCode === EXIT_SESSION_INCOMPLETE) return 'session_incomplete';
  // Checked ahead of `hasMessage`: the rulings-unratified `LoopResult` carries a human-readable
  // `message` too (same convention as the startup-STOP path), but its distinct `EXIT_*` code is
  // unambiguous on its own and must not fall through to the generic `stop_requested` mapping.
  if (params.exitCode === EXIT_RULINGS_UNRATIFIED) return 'rulings_unratified';
  if (params.hasMessage) return 'stop_requested';
  return 'done';
}

/** The digest's own `## Context` extraction (spec §5(d)): the FIRST line after the section's
 * heading line, skipping any purely-blank lines in between — never the full multi-line body
 * `parseEscalationQuestion` returns verbatim. Reproduces the pre-refactor
 * `/## Context\n+([^\n]*)/` regex's exact semantics: `context` always begins with the heading
 * line (`sectionVerbatim`'s own contract), so the first run of newlines anywhere in it is the
 * one ending that heading line, and skipping it lands on the same line the old regex captured.
 * A line of only whitespace and "no such line" both degrade to `undefined`, matching the old
 * regex's own trim-to-empty behaviour. */
function firstVerbatimContextLine(context: string): string | undefined {
  const afterHeading = /\n+([^\n]*)/.exec(context);
  const line = afterHeading?.[1]?.trim();
  return line ? line : undefined;
}

/** Best-effort one-line digest of an escalation markdown file, matching the exact shape
 * `loop.ts`'s `buildEscalationMarkdown` produces (`**Reason:** <reason>` then a `## Context`
 * section). Never throws; unrecognizable content degrades to an honest fallback string rather
 * than inventing a question nobody asked. This is the escalation-file shape's THIRD read site
 * (spec §5(d)) — parsing goes through `core/escalation.ts`'s shared `parseEscalationQuestion`,
 * the same parser `loop.ts`'s reason-line read and park-document question already use; only the
 * join/truncation behaviour below stays local to this module. */
export function extractQuestionDigest(markdown: string): string {
  const parsed = parseEscalationQuestion(markdown);
  const reason = parsed && parsed.reasonLine !== '' ? parsed.reasonLine : undefined;
  const contextLine = parsed ? firstVerbatimContextLine(parsed.context) : undefined;

  let digest: string;
  if (reason && contextLine) {
    digest = `${reason}: ${contextLine}`;
  } else if (reason) {
    digest = reason;
  } else if (contextLine) {
    digest = contextLine;
  } else {
    return '(escalation file present but no recognizable question content)';
  }
  return digest.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Display-only relative path (`escalations/<id>.md`) for the emitted JSON/md — never used to
 * resolve a read (see `buildEscalatedEntry`'s `resolvedPath`, below). */
function escalationFileRelPath(cardId: string): string {
  return `${ESCALATIONS_DIRNAME}/${cardId}.md`;
}

async function buildEscalatedEntry(
  cardId: string,
  card: Card,
  config: ReportConfig,
  io: Pick<ReportIO, 'fileExists' | 'readFile'>,
): Promise<CardReportEntry> {
  const relPath = escalationFileRelPath(cardId);
  const resolvedPath = escalationPathOf(config.homeDir, cardId);

  let question: string;
  if (!io.fileExists(resolvedPath)) {
    question = '(escalation file not found on disk)';
  } else {
    try {
      const content = String(await io.readFile(resolvedPath));
      question = extractQuestionDigest(content);
    } catch (err) {
      question = `(could not read escalation file: ${err instanceof Error ? err.message : String(err)})`;
    }
  }

  return {
    outcome: 'escalated',
    escalationFile: relPath,
    question,
    autoAnswerRounds: card.autoAnswerRounds ?? 0,
  };
}

/** Warchief ruling 1: `blockedOn` is not stored anywhere on disk — derive it from the card's
 * own `dependsOn`, picking the FIRST id whose dependency has not (yet) shipped. Documented
 * choice (the ruling explicitly leaves "first vs all" to this Hunter): §O5's JSON shape shows
 * `blockedOn` as a single string, not an array, so "first" is what keeps the JSON/md twins
 * consistent with the frozen contract. Returns `undefined` only in the (unexpected, defensive)
 * case where a `blocked` card's declared dependencies have ALL since shipped. */
function firstUnmetDependency(card: Card, state: CampaignState): string | undefined {
  for (const dependencyId of card.dependsOn ?? []) {
    if (state.cards[dependencyId]?.status !== 'shipped') {
      return dependencyId;
    }
  }
  return undefined;
}

/** Builds the one shared `CampaignReport` structure both `writeReport`'s JSON and md twins are
 * rendered from — this is what makes JSON<->md parity structural rather than a maintained-by-
 * hand promise (see `renderReportMarkdown`). Walks `state.sequence` (not `Object.keys(cards)`)
 * so card ordering in the report matches the campaign's own declared order, deterministically. */
export async function buildCampaignReport(
  state: CampaignState,
  run: ReportRunInfo,
  config: ReportConfig,
  io: Pick<ReportIO, 'fileExists' | 'readFile'>,
): Promise<CampaignReport> {
  const cards: Record<string, CardReportEntry> = {};
  const stats = { shipped: 0, escalated: 0, blocked: 0, notReached: 0 };
  const pending: string[] = [];

  for (const cardId of state.sequence) {
    const card = state.cards[cardId];
    if (!card) continue; // referential integrity already enforced at load (state.ts); defensive only.

    if (card.status === 'shipped') {
      const healedResidue = card.healedResidue ?? [];
      cards[cardId] = {
        outcome: 'shipped',
        pr: card.pr,
        mergeSha: card.mergeSha,
        ...(healedResidue.length > 0 ? { healedResidue } : {}),
      };
      stats.shipped += 1;
      continue;
    }

    if (card.status === 'escalated') {
      cards[cardId] = await buildEscalatedEntry(cardId, card, config, io);
      stats.escalated += 1;
      pending.push(cardId);
      continue;
    }

    if (card.status === 'blocked') {
      const blockedOn = firstUnmetDependency(card, state);
      cards[cardId] = { outcome: 'blocked', blockedOn: blockedOn ?? '(unknown — no unmet dependency found in state)' };
      stats.blocked += 1;
      continue;
    }

    // 'staged' | 'running': never reached a terminal outcome this pass. A 'running' card here
    // means a session stopped mid-flight without concluding (loop.ts's `CardOutcome.stopped`,
    // which leaves `card.status` untouched) — §O5's four-value vocabulary has no slot for that
    // distinct case, and it needs no owner action (the next run resumes it automatically,
    // exactly like a budget-skipped card), so it is folded into `not_reached` here. Flagged as
    // a design-gap/assumption in the Hunter's report to the Warchief.
    cards[cardId] = { outcome: 'not_reached' };
    stats.notReached += 1;
  }

  return { v: REPORT_VERSION, campaign: state.campaign, run, cards, pending, stats };
}

/** Harness-gap-wiring PR C (maintainer ruling, amending the original brief): the unratified-
 * rulings outcome is CAMPAIGN-LEVEL state, not a per-card escalation — no single card owns it,
 * so it is folded into the "## Pending (needs the owner)" section this module already renders,
 * rather than mimicking `card-actions.ts`'s per-card `# Escalation: <cardId>` markdown (which
 * stays untouched — do not import from or extend it here). The "answerable" framing (P5
 * fix-list's vocabulary: a ruling alone clears this, unlike a mechanical verify failure) is
 * kept as a label, not the per-card Options-block structure. Names every unratified ruling id
 * verbatim so the orchestrating session can act without re-parsing `answers.md` itself (brief
 * requirement). */
function renderRulingsUnratifiedNote(unratifiedRulings: string[]): string[] {
  return [
    '',
    "**Unratified rulings (answerable):** mark each ruling's `ratified-as:` in `answers.md` " +
      '(vocabulary: `rule <path>` | `debt <id>` | `roadmap <ref>` | `operational` | ' +
      '`dismissed` — see the runner README) or ratify via the governance path, then re-trigger.',
    ...unratifiedRulings.map((id) => `- ${id}`),
  ];
}

/** Renders the SAME `CampaignReport` structure `writeReport` also serializes to JSON — the
 * human-readable twin the owner reads straight from the target repo, no session required
 * (design §O5). Never independently re-derives anything from `state`/`io`, which is what makes
 * the JSON<->md parity test in report.test.ts a structural guarantee, not a maintained-by-hand
 * promise. */
export function renderReportMarkdown(report: CampaignReport): string {
  const lines: string[] = [];
  lines.push(`# Campaign report: ${report.campaign}`);
  lines.push('');
  lines.push(`- Run started: ${report.run.startedAt}`);
  lines.push(`- Run ended: ${report.run.endedAt}`);
  lines.push(`- Exit code: ${report.run.exitCode} (${report.run.reason})`);
  lines.push('');
  lines.push(
    `Stats: ${report.stats.shipped} shipped, ${report.stats.escalated} escalated, ` +
      `${report.stats.blocked} blocked, ${report.stats.notReached} not reached.`,
  );
  lines.push('');
  lines.push('## Cards');
  lines.push('');
  for (const [cardId, entry] of Object.entries(report.cards)) {
    lines.push(`### ${cardId} — ${entry.outcome}`);
    if (entry.outcome === 'shipped') {
      lines.push(`- PR: ${entry.pr ?? '(none)'}`);
      lines.push(`- Merge sha: ${entry.mergeSha ?? '(none)'}`);
      if (entry.healedResidue && entry.healedResidue.length > 0) {
        lines.push(`- Healed residue: ${entry.healedResidue.join(', ')}`);
      }
    } else if (entry.outcome === 'escalated') {
      lines.push(`- Escalation file: ${entry.escalationFile}`);
      lines.push(`- Question: ${entry.question}`);
      // FU-CS-1 (spec §7): nothing in the runner ever increments `autoAnswerRounds`, so the
      // number is permanently 0 — indistinguishable from "we tried zero times" when it
      // actually means "nobody counts this". State that honestly rather than a stuck number.
      lines.push('- Auto-answer rounds: not tracked (field is vestigial — see spec §7)');
    } else if (entry.outcome === 'blocked') {
      lines.push(`- Blocked on: ${entry.blockedOn}`);
    }
    lines.push('');
  }

  lines.push('## Pending (needs the owner)');
  lines.push('');
  if (report.pending.length === 0) {
    lines.push('(none)');
  } else {
    for (const cardId of report.pending) {
      lines.push(`- ${cardId}`);
    }
  }
  if (report.run.reason === 'rulings_unratified') {
    lines.push(...renderRulingsUnratifiedNote(report.run.unratifiedRulings ?? []));
  }
  lines.push('');

  return lines.join('\n');
}

/** The Task 3 entry point (spec §O5): builds the ONE shared report structure, then writes both
 * the JSON and md twins into `dir` (the campaign home, per the design doc §4 — the caller,
 * cli/main.ts, derives it via `core/paths.ts`'s `reportDirOf`). Fully unit-tested here with an
 * injected `ReportIO`; cli/main.ts's own wiring stays a thin caller (per the brief's design note 3). */
export async function writeReport(
  state: CampaignState,
  run: ReportRunInfo,
  dir: string,
  config: ReportConfig,
  io: ReportIO,
): Promise<CampaignReport> {
  const report = await buildCampaignReport(state, run, config, io);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const md = renderReportMarkdown(report);
  io.writeFile(join(dir, REPORT_JSON_FILENAME), json);
  io.writeFile(join(dir, REPORT_MD_FILENAME), md);
  return report;
}
