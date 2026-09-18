// Postcondition verification (spec §5.2 `ruling`, §5.3 `ratify`, §5.4 `closing`; card guardrail
// 2: "Trust disk, not the session's word.") Pure predicates over already-read strings — this
// module reads nothing (no `fs`, no `child_process`, no clock, no throw for external input; the
// only exception it can raise, `JSON.parse`'s `SyntaxError`, is caught narrowly in
// `parseParkMarker`). The caller reads `answers.md` before/after, the park-marker file, the
// closing report, and `git status --porcelain`, and passes each in as a string.
//
// A ruling counts only when a NEW `## ` block exists whose `ratified-as:` value passes the
// EXISTING `isRulingRatified()` (`../rulings.ts`) — this module does not write a second
// vocabulary for that. It adds exactly the checks `../rulings.ts` does not already do: history
// integrity (S-P13), the git-repo-untouched check, the ratify id-scope fence, and the two-value
// park-marker vocabulary.
import { isRulingRatified, parseRulings, unratifiedRulingIds } from '../rulings.ts';
import type { ParkMarkerKind } from './model.ts';

/** One postcondition verdict, shared by `verifyRuling`, `verifyRatify`, `verifyClosing`.
 * `retryable` is `false` ONLY for the two integrity outcomes (`history_rewritten`,
 * `ratify_out_of_scope`) — every other outcome (including `failed`) is `true`, because an
 * ordinary failed attempt is retried once before it parks (guardrail 2). `reason` carries a
 * free-form detail for a `failed` verdict (e.g. `repo_touched`); it is not itself a `ParkReason`
 * — an ordinary failed attempt still goes through the session-kind retry/park mapping in the
 * decision core, not straight to a park reason. */
export interface VerifyVerdict {
  outcome: 'ruled' | 'ratified' | 'closed' | 'parked' | 'failed' | 'history_rewritten' | 'ratify_out_of_scope';
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

export interface VerifyRatifyInput {
  before: string;
  after: string;
  /** `run.unratifiedRulings` — the ONLY ids this ratify session may touch. */
  named: string[];
}

export interface VerifyClosingInput {
  /** `<home>/supervisor/final-report.md`'s contents, or `null` when the file does not exist. */
  finalReport: string | null;
  answers: string;
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
    if (isRulingRatified(candidate.ratifiedAs)) {
      if (repoStatus.trim().length > 0) {
        // Decision 4: a repo touch fails the ruling even though a valid block landed.
        return { outcome: 'failed', retryable: true, reason: 'repo_touched' };
      }
      return { outcome: 'ruled', retryable: true, rulingId: candidate.id };
    }
    return { outcome: 'failed', retryable: true, reason: 'not_ratified' };
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

/** Splits `content` into `id -> raw block text` (the `## ` heading line through the line before
 * the next heading, or end of content), using the same heading partition `../rulings.ts`'s
 * `parseRulings` uses. Exists only for `verifyRatify`'s byte-identity fence — `parseRulings`
 * exposes `id`/`ratifiedAs`, not the raw bytes a byte-identical comparison needs. */
function blocksById(content: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let currentId: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentId !== null) blocks.set(currentId, currentLines.join('\n'));
  };

  for (const line of content.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      currentId = (heading[1] as string).trim();
      currentLines = [line];
      continue;
    }
    if (currentId !== null) currentLines.push(line);
  }
  flush();

  return blocks;
}

/** §5.3's postcondition table: the fence is by ID, not by prefix (a ratify session legitimately
 * edits the middle of the file). Every block whose id is not in `named` must be byte-identical
 * before/after, and no id may disappear — either violation is `ratify_out_of_scope`, never
 * retried (same class of offence as rewriting ruling history). Only once both hold does the
 * function check the ordinary success condition: zero unratified ids remain. */
export function verifyRatify(input: VerifyRatifyInput): VerifyVerdict {
  const { before, after, named } = input;
  const namedIds = new Set(named);
  const blocksBefore = blocksById(before);
  const blocksAfter = blocksById(after);

  for (const [id, rawBefore] of blocksBefore) {
    const rawAfter = blocksAfter.get(id);
    if (rawAfter === undefined) {
      return { outcome: 'ratify_out_of_scope', retryable: false };
    }
    if (!namedIds.has(id) && rawAfter !== rawBefore) {
      return { outcome: 'ratify_out_of_scope', retryable: false };
    }
  }

  // A brand-new block: present in `after`, absent from `before`. A ratify session never adds
  // rulings — an id with no `before` counterpart is trivially "not in unratifiedRulings" and
  // "not byte-identical" (it did not exist), so it is the same offence as rewriting an existing
  // block (spec §5.3 check 1).
  for (const id of blocksAfter.keys()) {
    if (!blocksBefore.has(id)) {
      return { outcome: 'ratify_out_of_scope', retryable: false };
    }
  }

  if (unratifiedRulingIds(after).length > 0) {
    return { outcome: 'failed', retryable: true };
  }

  return { outcome: 'ratified', retryable: true };
}

/** §5.4's postcondition: the owner-facing report exists and is non-empty, and every ruling in
 * `answers.md` is still ratified. Neither failure is retryable-blocking (`closing`'s own bounded
 * retry, then `park(closing_failed)`, is the decision core's job — this function only reports
 * `failed`/`retryable: true`, same as every other ordinary failed attempt). */
export function verifyClosing(input: VerifyClosingInput): VerifyVerdict {
  const { finalReport, answers } = input;

  if (finalReport === null || finalReport.trim().length === 0) {
    return { outcome: 'failed', retryable: true, reason: 'final_report_missing' };
  }
  if (unratifiedRulingIds(answers).length > 0) {
    return { outcome: 'failed', retryable: true, reason: 'rulings_unratified' };
  }
  return { outcome: 'closed', retryable: true };
}
