// gap-stamp.ts — the `gap-gate v1` stamp line and the `## Harness gaps` PR-body section
// (card C1, spec §2 step 6). PURE MODULE: functions of their arguments only.
//
// The stamp is a WIRE FORMAT with three independent readers: this module (writer + reader),
// runner/core/verify.ts's `gapGateStamped` point, and verify-shipped.sh's fourth check. The
// runner and the shell script deliberately do NOT import this file (they are separate bun
// packages / a different language); all three are pinned to the same canonical example line,
// reproduced verbatim in each of their test suites. Change the format here and all three
// suites must change together.

export interface StampFields {
  card: string;
  base: string;
  head: string;
  minted: string[];
  matched: string[];
  /** Sum of every diffDebt entry's delta; may be negative or zero. */
  debtDelta: number;
  /** Lowercase hex sha256 of the registry after this run, or the literal `none`. */
  ledger: string;
}

/** An empty id list renders as this literal, so the stamp always has the same token count and a
 * reader can never mistake `minted= matched=G-001` for a one-token field. */
const EMPTY = 'none';

const STAMP_RE =
  /<!--\s*gap-gate v1\s+card=(\S+)\s+base=(\S+)\s+head=(\S+)\s+minted=(\S+)\s+matched=(\S+)\s+debt-delta=(-?\d+)\s+ledger=(\S+?)\s*-->/;

function renderList(ids: readonly string[]): string {
  return ids.length === 0 ? EMPTY : ids.join(',');
}

function parseList(value: string): string[] {
  return value === EMPTY ? [] : value.split(',').filter((s) => s.length > 0);
}

export function formatStamp(fields: StampFields): string {
  return (
    `<!-- gap-gate v1 card=${fields.card} base=${fields.base} head=${fields.head} ` +
    `minted=${renderList(fields.minted)} matched=${renderList(fields.matched)} ` +
    `debt-delta=${fields.debtDelta} ledger=${fields.ledger} -->`
  );
}

/** Finds the first `gap-gate v1` stamp in `text` (a PR body, a report file, a commit message).
 * Returns null when there is none, or when the line is truncated — a partial stamp is NOT a
 * stamp, because the whole point of the check is that a bypassing session cannot fake it. */
export function parseStamp(text: string): StampFields | null {
  const m = STAMP_RE.exec(text);
  if (!m) return null;
  return {
    card: m[1]!,
    base: m[2]!,
    head: m[3]!,
    minted: parseList(m[4]!),
    matched: parseList(m[5]!),
    debtDelta: Number(m[6]),
    ledger: m[7]!,
  };
}

export interface GapSectionInput {
  matched: string[];
  minted: string[];
  suppressedCount: number;
  flagged: string[];
  openIds: string[];
  unparsed: Array<{ file: string; line: number; reason: string }>;
  debtDelta: number;
  stamp: string;
}

/** The complete `## Harness gaps` PR-body section (spec §2 step 6). The Warchief pastes this
 * verbatim; nothing downstream re-derives it, which is what makes the section auditable. */
export function renderGapSection(input: GapSectionInput): string {
  const list = (ids: readonly string[]): string => (ids.length === 0 ? EMPTY : ids.join(', '));
  const lines: string[] = [
    '## Harness gaps',
    '',
    `- matched: ${list(input.matched)}`,
    `- minted: ${list(input.minted)}`,
    `- suppressed: ${input.suppressedCount}`,
    `- flagged fingerprints: ${list(input.flagged)}`,
    `- open ids awaiting adjudication: ${list(input.openIds)}`,
    `- unparsed HG-candidate blocks: ${input.unparsed.length === 0 ? EMPTY : String(input.unparsed.length)}`,
  ];
  for (const u of input.unparsed) {
    lines.push(`  - ${u.file}:${u.line} — ${u.reason}`);
  }
  if (input.debtDelta < 0) {
    lines.push(`- debt burn-down: net ${-input.debtDelta} fewer hit(s) than base`);
  } else if (input.debtDelta > 0) {
    lines.push(`- debt burn-down: net ${input.debtDelta} MORE hit(s) than base — gate red`);
  }
  lines.push('- proposals: pending Scout adjudication', '', input.stamp, '');
  return lines.join('\n');
}
