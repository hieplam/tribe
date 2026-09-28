// Postcondition verification (spec §5.2 `ruling`, §5.4 `closing`; card guardrail
// 2: "Trust disk, not the session's word.") Pure predicates over already-read strings — this
// module reads nothing (no `fs`, no `child_process`, no clock, no throw for external input; the
// only exception it can raise, `JSON.parse`'s `SyntaxError`, is caught narrowly in
// `parseParkMarker`). The caller reads `answers.md` before/after, the park-marker file, the
// closing report, and `git status --porcelain`, and passes each in as a string.
//
// A ruling counts when a NEW `## ` block exists (block parsing is `../rulings.ts`'s
// `parseRulings`); its content is not classified — the session rules on the owner's behalf
// (D6). This module adds history integrity (S-P13), the git-repo-untouched check, and the
// two-value park-marker vocabulary.
import { parseRulings } from '../rulings.ts';
import type { ParkMarkerKind } from './model.ts';

/** One postcondition verdict, shared by `verifyRuling` and `verifyClosing`.
 * `retryable` is `false` ONLY for the integrity outcome (`history_rewritten`) — every other outcome (including `failed`) is `true`, because an
 * ordinary failed attempt is retried once before it parks (guardrail 2). `reason` carries a
 * free-form detail for a `failed` verdict (e.g. `repo_touched`); it is not itself a `ParkReason`
 * — an ordinary failed attempt still goes through the session-kind retry/park mapping in the
 * decision core, not straight to a park reason. */
export interface VerifyVerdict {
  outcome: 'ruled' | 'closed' | 'parked' | 'failed' | 'history_rewritten';
  retryable: boolean;
  rulingId?: string | null;
  parkMarkerKind?: ParkMarkerKind;
  /** Set (0 or 1) only on a `parked` verdict produced by a park marker; a `parked` verdict from
   * a ruling session always names exactly the one marker it read. */
  malformedMarkers?: number;
  reason?: string;
}

export interface VerifyRulingInput {
  before: string;
  after: string;
  repoStatus: string;
  /** Raw contents of `<home>/supervisor/park/<cardId>.json`, or `null`/absent when the session
   * wrote no marker. */
  marker?: string | null;
}

/** One shipped card's verify-shipped verdict file (`<home>/supervisor/verdicts/<cardId>.json`),
 * as read by the caller: `raw` is the file's raw contents, or `null` when the file does not
 * exist. Parsed here (pure), never read here (`pure-core.md`). */
export interface ShippedVerdict {
  cardId: string;
  raw: string | null;
}

export interface VerifyClosingInput {
  /** `<home>/supervisor/final-report.md`'s contents, or `null` when the file does not exist. */
  finalReport: string | null;
  /** One entry per card the campaign report marks `shipped` — the verify-shipped script's own
   * verdict file, read by the caller and parsed here (spec §4b). */
  shippedVerdicts: ShippedVerdict[];
}

export interface ParkMarkerParseResult {
  kind: ParkMarkerKind;
  malformed: boolean;
}

const ALLOWED_PARK_KINDS: ReadonlySet<string> = new Set(['owner_only', 'too_hard']);

/** §6.1: a marker counts only when it parses as a JSON object AND its `kind` is one of the two
 * allowed values. Anything else — unparseable JSON, a non-object, a missing or unrecognised
 * `kind` — is `too_hard` and `malformed: true` ("fail closed, never crash", §6.1). `note` is
 * deliberately never inspected here: it is recorded and relayed, never parsed (§6.1). */
export function parseParkMarker(raw: string): ParkMarkerParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) return { kind: 'too_hard', malformed: true };
    throw err;
  }
  const kind = (parsed as { kind?: unknown } | null)?.kind;
  if (typeof kind === 'string' && ALLOWED_PARK_KINDS.has(kind)) {
    return { kind: kind as ParkMarkerKind, malformed: false };
  }
  return { kind: 'too_hard', malformed: true };
}

/** §5.2's four-row postcondition table, in the table's own order, plus the park-marker exit and
 * S-P13's integrity check (which runs FIRST — before any of the table's rows — and is the only
 * check in this function that produces a non-retryable verdict). */
export function verifyRuling(input: VerifyRulingInput): VerifyVerdict {
  const { before, after, repoStatus, marker } = input;

  // S-P13, checked first: every byte in `before` must still be at the front of `after`,
  // unchanged, AND the append must begin at a line boundary. Catches a full replace, an edit to
  // an earlier block, AND the narrower case where `before` does not end in `\n` (spec §5.2 notes
  // the prefix form relies on the file ending in a newline "by convention") and a session
  // extends the tail of `before`'s own final line instead of appending after it — `startsWith`
  // alone is blind to that: it stays true while the last existing ruling's content is altered.
  const atLineBoundary = before === '' || before.endsWith('\n')
    || after.length === before.length || after.charAt(before.length) === '\n';
  if (!after.startsWith(before) || !atLineBoundary) {
    return { outcome: 'history_rewritten', retryable: false };
  }

  const beforeIds = new Set(parseRulings(before).map((block) => block.id));
  const newBlocks = parseRulings(after).filter((block) => !beforeIds.has(block.id));

  if (newBlocks.length > 0) {
    // The append convention (and the prefix check above) means the newest block is last.
    const candidate = newBlocks[newBlocks.length - 1] as (typeof newBlocks)[number];
    if (repoStatus.trim().length > 0) {
      // Decision 4: a repo touch fails the ruling even though a valid block landed.
      return { outcome: 'failed', retryable: true, reason: 'repo_touched' };
    }
    return { outcome: 'ruled', retryable: true, rulingId: candidate.id };
  }

  if (marker !== null && marker !== undefined) {
    const parsedMarker = parseParkMarker(marker);
    return {
      outcome: 'parked',
      retryable: true,
      parkMarkerKind: parsedMarker.kind,
      malformedMarkers: parsedMarker.malformed ? 1 : 0,
    };
  }

  // Neither exit was taken: no new ruling block, no park marker.
  return { outcome: 'failed', retryable: true, reason: 'no_new_block' };
}

/** A closing report that self-declares a blocked/failed status must never close the campaign
 * (spec §4's reproduction: `verifyClosing` was blind to a report whose body said
 * `Status: BLOCKED`). This matches an explicit status DECLARATION line only — not a section
 * heading like `## Escalated / blocked`, which a well-formed successful report legitimately
 * carries (closing brief Stage D step 4). Over-checking here is by design; a real defect it
 * catches is a session that wrote a "could not verify anything" report and expected it to close. */
function finalReportDeclaresBlocked(report: string): boolean {
  return /^[ \t]*#*[ \t]*status:[ \t]*(blocked|failed|fail|error)\b/im.test(report);
}

/** §4b: one shipped card's verdict file. Parses `raw` narrowly and fail-closed
 * (`fail-closed-edges.md` obligation 1 — never throws). Returns the typed `reason` string when
 * the verdict is not an acceptable `PASS`, or `null` when it is. The verdict FILE the
 * verify-shipped script writes is the contract; the session's prose is not (spec §4). */
function checkShippedVerdict(entry: ShippedVerdict): string | null {
  if (entry.raw === null) return `verdict_missing:${entry.cardId}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.raw);
  } catch {
    return `verdict_malformed:${entry.cardId}`;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return `verdict_malformed:${entry.cardId}`;
  }
  const obj = parsed as Record<string, unknown>;
  const card = obj['card'];
  const verdict = obj['verdict'];
  if (typeof card !== 'string' || typeof verdict !== 'string') {
    return `verdict_malformed:${entry.cardId}`;
  }
  if (card !== entry.cardId) return `verdict_card_mismatch:${entry.cardId}`;
  if (verdict !== 'PASS') return `verdict_fail:${entry.cardId}`;
  return null;
}

/** §5.4/§4b's postcondition: the owner-facing report exists and is non-empty, it does not
 * self-declare a blocked/failed status, AND every
 * card the campaign report marks `shipped` has a present, well-formed, matching, `PASS` verdict
 * file the verify-shipped SCRIPT produced. A `FAIL` (or missing/malformed/mismatched) verdict is
 * an ordinary retryable `failed` attempt with a typed `reason` — never a new `ParkReason`: the
 * existing bounded-retry-then-`park(closing_failed)` path handles it (spec §4b). This function
 * reads nothing from disk — the caller reads each file, this function decides (`pure-core.md`). */
export function verifyClosing(input: VerifyClosingInput): VerifyVerdict {
  const { finalReport, shippedVerdicts } = input;

  if (finalReport === null || finalReport.trim().length === 0) {
    return { outcome: 'failed', retryable: true, reason: 'final_report_missing' };
  }
  if (finalReportDeclaresBlocked(finalReport)) {
    return { outcome: 'failed', retryable: true, reason: 'final_report_blocked' };
  }
  for (const entry of shippedVerdicts) {
    const reason = checkShippedVerdict(entry);
    if (reason !== null) return { outcome: 'failed', retryable: true, reason };
  }
  return { outcome: 'closed', retryable: true };
}
