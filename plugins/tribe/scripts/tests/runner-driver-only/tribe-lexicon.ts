// tribe-lexicon.ts — the G2'/V1 oracle's word list (card runner-driver-only), and a pure counter.
//
// What counts: any mention of the Tribe way of working in text a runner, watchdog or supervisor
// hands to a session — the six agents, the mammoth-hunt skill, and their procedures
// (Warchief-dispatches-Hunters, two-lens/dual-Skinner review, Tracker rounds, Scout proposals,
// fix loops, the gap-gate and its stamp/trailers/ratification, and the way-of-work prescriptions
// that come with them: test-first, worker reports, audits, governance proposals).
//
// Direction of error (the card's oracle): under-matching is a bug, over-matching is by design.
// A generic word on this list ("audit", "lens", "governance") is here on purpose: a driver-only
// prompt has no reason to say it, so a hit is worth a human look even when it is innocent.
//
// NOT counted, by the card's adjudication rule (REFUTED in advance): the word "tribe" itself and
// file paths under `plugins/tribe/` (naming, not coupling), `verify-shipped` (generic done
// mechanics, card D4), and the literal `--skip-gap-gate` flag: it is D6's instruction NOT to do
// gap-gate work (spec §4.11), so it is not Tribe way of working (ruling R-PR3-FLAG). Only that exact,
// case-sensitive literal is stripped — every other gap-gate mention still counts.
//
// PURE: text in, counts out. No file system, no clock.

export interface LexiconTerm {
  /** Stable key used in reports. */
  id: string;
  /** Case-insensitive pattern. Every pattern is global so every occurrence counts. */
  pattern: RegExp;
  /** Why this term is Tribe way of working — shown in the evidence table. */
  why: string;
}

export const TRIBE_LEXICON: readonly LexiconTerm[] = [
  { id: 'warchief', pattern: /warchief/gi, why: 'Tribe agent' },
  { id: 'shaman', pattern: /shaman/gi, why: 'Tribe agent' },
  { id: 'hunter', pattern: /hunter/gi, why: 'Tribe agent (matches Hunters)' },
  { id: 'skinner', pattern: /skinner/gi, why: 'Tribe agent (matches Skinners, dual-Skinner)' },
  { id: 'tracker', pattern: /tracker/gi, why: 'Tribe agent (matches Tracker rounds)' },
  { id: 'scout', pattern: /scout/gi, why: 'Tribe agent' },
  { id: 'mammoth', pattern: /mammoth/gi, why: 'the mammoth-hunt skill' },
  { id: 'gap-gate', pattern: /gap[-_ ]?gate/gi, why: 'harness-gap gate, its stamp and report' },
  { id: 'harness-gap', pattern: /harness[- ]gaps?/gi, why: 'harness-gap registry and PR section' },
  { id: 'gap-rule', pattern: /gap-rule/gi, why: 'harness-gap ratification CLI' },
  { id: 'debt', pattern: /debt/gi, why: 'debt entities, debt-backfill, debt burn-down' },
  { id: 'tribe-trailer', pattern: /tribe-(?:card|task|milestone)/gi, why: 'Tribe commit trailers' },
  { id: 'ratify', pattern: /ratif/gi, why: 'ratification (ratify, ratified-as, unratified)' },
  { id: 'lens', pattern: /\blens(?:es)?\b/gi, why: 'two-lens review (over-match by design)' },
  { id: 'audit', pattern: /\baudit/gi, why: 'audit rounds (over-match by design)' },
  { id: 'fix-loop', pattern: /fix[- ](?:loop|round)s?/gi, why: 'fix loop / fix rounds' },
  { id: 'worker-report', pattern: /worker reports?/gi, why: 'Hunter/Skinner worker reports' },
  { id: 'test-first', pattern: /test-first|\btdd\b/gi, why: 'way-of-work prescription (test-first)' },
  { id: 'agent-method', pattern: /agent method|method step/gi, why: "points at an agent's Method" },
  { id: 'governance', pattern: /governance/gi, why: 'governance proposals / closing governance PR' },
];

/** Ruling R-PR3-FLAG: the one literal excluded before counting (see the header). */
const SKIP_GAP_GATE_FLAG = '--skip-gap-gate';

export interface TermCount {
  id: string;
  count: number;
}

/** Counts every lexicon term in `text`. Returns only the terms that occur (count > 0), in lexicon
 * order, so an empty array means "no Tribe way of working in this text". */
export function countTribeMentions(text: string): TermCount[] {
  const counted = text.replaceAll(SKIP_GAP_GATE_FLAG, '');
  const counts: TermCount[] = [];
  for (const term of TRIBE_LEXICON) {
    const matches = counted.match(term.pattern);
    const count = matches === null ? 0 : matches.length;
    if (count > 0) counts.push({ id: term.id, count });
  }
  return counts;
}

export function totalOf(counts: readonly TermCount[]): number {
  return counts.reduce((sum, c) => sum + c.count, 0);
}
