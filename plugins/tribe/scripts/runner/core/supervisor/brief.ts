// Supervisor brief rendering — the three one-shot session kinds (spec §5.2-§5.4, plan Task 9).
//
// Pure: `renderBrief` reads no file and makes no decision; identical `facts` render a
// byte-identical string every time. The three committed templates (`brief-ruling.md`,
// `brief-ratify.md`, `brief-closing.md`, beside this module, same shape as
// `core/brief-template.md` + `core/brief.ts`) carry the governing quotes (SKILL.md W3, W7,
// the Stage C owner-only paragraph, the "durable convention" wall, and Stage D) as literal
// text — quoted, per `brief-contracts.md` obligation 3, never re-typed or paraphrased here.
// This module never reads them itself (`pure-core.md`: core never reaches for its own
// dependencies) — only path-joins are exported; the CALLER reads the committed asset through
// its own IO and hands the content in via `facts.template`, exactly as `core/brief.ts`'s
// `executorBrief` already does for its one template.
import { dirname, join } from 'node:path';
import type { SessionKind } from './model.ts';

export const RULING_TEMPLATE_PATH = join(import.meta.dir, 'brief-ruling.md');
export const RATIFY_TEMPLATE_PATH = join(import.meta.dir, 'brief-ratify.md');
export const CLOSING_TEMPLATE_PATH = join(import.meta.dir, 'brief-closing.md');

/** §5.2's rendered brief: everything a `ruling` session needs, already read off disk by the
 * caller. `existingRulingIds` are the `## ` headings already in `answers.md` — read, never
 * guessed — so the session picks the next `R<n>` without collision. */
export interface RulingBriefFacts {
  kind: 'ruling';
  /** The committed asset at `RULING_TEMPLATE_PATH`, already read by the caller. */
  template: string;
  cardId: string;
  /** `escalations/<cardId>.md`, verbatim. */
  escalationContent: string;
  /** `campaign-state.json`'s `ownerOnlyEscalations`, verbatim. */
  ownerOnlyEscalations: string[];
  existingRulingIds: string[];
  specPath: string | null;
  planPath: string | null;
  /** R13.2: the ABSOLUTE on-disk path the session must Read/append `answers.md` at — never a
   * bare `answers.md` (Haiku's first two attempts against a bare name were `Read /answers.md`
   * and `Write /answers.md`, i.e. filesystem root). */
  answersPath: string;
  /** R13.2: the ABSOLUTE on-disk path of `escalations/<cardId>.md` — same reason as
   * `answersPath` above; a bare relative name leaves the session guessing its cwd. */
  escalationPath: string;
}

/** §5.3: one unratified ruling's own block, verbatim from `answers.md`, keyed by its id — the
 * ratify session's whole job is repairing `ratified-as:` inside exactly these named blocks. */
export interface RatifyBlockFact {
  id: string;
  content: string;
}

export interface RatifyBriefFacts {
  kind: 'ratify';
  /** The committed asset at `RATIFY_TEMPLATE_PATH`, already read by the caller. */
  template: string;
  /** `run.unratifiedRulings`, verbatim. */
  unratifiedRulingIds: string[];
  rulingBlocks: RatifyBlockFact[];
  /** R13.2: the ABSOLUTE on-disk path the session must Read/edit `answers.md` at — never a
   * bare `answers.md`; see `RulingBriefFacts.answersPath` for the measured defect. */
  answersPath: string;
}

/** §5.4: one ruling's disposition, for the closing session's context. */
export interface ClosingRulingFact {
  id: string;
  ratifiedAs: string;
}

/** §5.4: one card's still-open gap ids from its gap-gate report. */
export interface ClosingOpenIdsFact {
  cardId: string;
  openIds: string[];
}

/** §4c: one shipped card's verify-shipped verdict artifact. `verdictPath` is the ABSOLUTE
 * `<home>/supervisor/verdicts/<cardId>.json` the closing session must have the script write with
 * `--verdict-out` — the file the supervisor's closing postcondition then reads. The session's own
 * prose is never the contract; this file is (spec §4, `brief-contracts.md` obligation 1). */
export interface ClosingVerdictFact {
  cardId: string;
  verdictPath: string;
}

export interface ClosingBriefFacts {
  kind: 'closing';
  /** The committed asset at `CLOSING_TEMPLATE_PATH`, already read by the caller. */
  template: string;
  /** The final `campaign-report.json`, verbatim. */
  campaignReportContent: string;
  rulings: ClosingRulingFact[];
  openIdsByCard: ClosingOpenIdsFact[];
  /** `<home>/supervisor/final-report.md` — where Stage D step 4's report is written. */
  finalReportPath: string;
  /** §4c: one entry per card the campaign report marks `shipped` — the verdict path the closing
   * session must have `verify-shipped` write with `--verdict-out`. The postcondition reads these
   * files; a `shipped` claim with no verdict file will not close the campaign. */
  shippedVerdicts: ClosingVerdictFact[];
}

export type BriefFacts = RulingBriefFacts | RatifyBriefFacts | ClosingBriefFacts;

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw new Error(`supervisor brief template: unknown placeholder {{${key}}}`);
    }
    return vars[key] as string;
  });
}

function bulletList(items: string[], whenEmpty: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : whenEmpty;
}

function renderRuling(facts: RulingBriefFacts): string {
  return renderTemplate(facts.template, {
    CARD_ID: facts.cardId,
    ESCALATION_CONTENT: facts.escalationContent,
    OWNER_ONLY_ESCALATIONS: bulletList(
      facts.ownerOnlyEscalations,
      '(none declared for this campaign)',
    ),
    EXISTING_RULING_IDS: bulletList(
      facts.existingRulingIds,
      '(none yet — this will be the first ruling)',
    ),
    SPEC_PATH: facts.specPath ?? '(missing)',
    PLAN_PATH: facts.planPath ?? '(missing)',
    ANSWERS_PATH: facts.answersPath,
    ESCALATION_PATH: facts.escalationPath,
  });
}

function renderRatify(facts: RatifyBriefFacts): string {
  const blocks = facts.rulingBlocks
    .map((block) => `### ${block.id}\n\n${block.content}`)
    .join('\n\n');
  return renderTemplate(facts.template, {
    UNRATIFIED_IDS: bulletList(facts.unratifiedRulingIds, '(none)'),
    RULING_BLOCKS: blocks.length > 0 ? blocks : '(no ruling blocks supplied)',
    ANSWERS_PATH: facts.answersPath,
  });
}

function renderClosing(facts: ClosingBriefFacts): string {
  const rulings = bulletList(
    facts.rulings.map((r) => `${r.id}: ratified-as: ${r.ratifiedAs}`),
    '(no rulings recorded this campaign)',
  );
  const openIds = bulletList(
    facts.openIdsByCard.map(
      (c) => `${c.cardId}: ${c.openIds.length > 0 ? c.openIds.join(', ') : '(none open)'}`,
    ),
    '(no cards)',
  );
  // The verdict dir (`<home>/supervisor/verdicts/`) is this command's OWN output location, and
  // `verify-shipped.sh` fail-closes (refuses, never creates) on a missing `--verdict-out` dir —
  // so the command must create it, or a closing session run against a bare home dies before it
  // can write a verdict the supervisor then reads as `verdict_missing`. `mkdir -p` is idempotent
  // and safe to repeat per card even when several share the one dir.
  const shippedVerdicts = bulletList(
    facts.shippedVerdicts.map(
      (v) => `${v.cardId}: mkdir -p "${dirname(v.verdictPath)}" && bash "$script_path" `
        + `--pr <${v.cardId}'s PR> --worktree <${v.cardId}'s worktree> --card ${v.cardId} `
        + `--verdict-out ${v.verdictPath}`,
    ),
    '(no shipped cards — no verdict files to write)',
  );
  return renderTemplate(facts.template, {
    CAMPAIGN_REPORT_CONTENT: facts.campaignReportContent,
    RULINGS: rulings,
    OPEN_IDS_BY_CARD: openIds,
    FINAL_REPORT_PATH: facts.finalReportPath,
    SHIPPED_VERDICTS: shippedVerdicts,
  });
}

/** §5: renders the committed brief template for one of the three one-shot session kinds.
 * Pure — everything it needs arrives in `facts` (including the already-read template text);
 * the same `facts` renders the same string on every call. `kind` and `facts.kind` must
 * agree — a caller that mismatches them made a bug a wrong brief would otherwise hide. */
export function renderBrief(kind: SessionKind, facts: BriefFacts): string {
  if (facts.kind !== kind) {
    throw new Error(`renderBrief: kind mismatch — asked for ${kind}, facts are ${facts.kind}`);
  }
  switch (facts.kind) {
    case 'ruling':
      return renderRuling(facts);
    case 'ratify':
      return renderRatify(facts);
    case 'closing':
      return renderClosing(facts);
  }
}
