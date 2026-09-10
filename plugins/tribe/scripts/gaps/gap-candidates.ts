// gap-candidates.ts — pure parser for the Tracker's `HG-candidate` blocks (card C1, spec §2
// step 2). PURE MODULE: no fs, no subprocess, no clock — the gate's edge reads the files and
// hands the text in. Under-parsing a real report shape is a bug; a block that cannot be mapped
// completely is reported under `unparsed` and never aborts anything (plan Oracle).
import { anyPathOverlap } from './paths.ts';

export interface ParsedCandidate {
  category: string;
  paths: string[];
  fingerprint: string;
  hits: number;
  description: string;
  /** The `<round>` label of the report file this block came from (`task-3`, `wave-2`, `final`). */
  round: string;
  sourceFile: string;
  /** 1-based line of the block's header line, for the `unparsed`/debug trail. */
  sourceLine: number;
}

export interface UnparsedBlock {
  file: string;
  line: number;
  reason: string;
  excerpt: string;
}

export interface ParseResult {
  candidates: ParsedCandidate[];
  unparsed: UnparsedBlock[];
}

// An optional Markdown list marker (`- `, `* `, `+ `) may prefix the header — a real, plausible
// Tracker line shape (audit-fix round 2). The `[-*+]\s+` group is OPTIONAL so the three existing
// F4 shapes (unbulleted, bold-no-bullet, heading-prefixed) still match unchanged.
const HEADER_RE = /^\s*(?:[-*+]\s+)?(?:\*\*)?HG-candidate\s+(\d+)\s*(?:\*\*)?\s*\[([^\]]+)\]\s*(?:\*\*)?/;
const HEADING_RE = /^\s*#{1,6}\s/;
const SUPPRESSED_RE = /^\s*\+\d+\s+more suppressed/;
const LABEL_RE = /(?:^|\s)(Pattern|Evidence|Diff link|Not judged)\s*:/gi;
const HITS_RE = /(\d+)\s+(?:[A-Za-z-]+\s+){0,2}?(?:hits?|occurrences?|matches?|files?)\b/i;
const PATH_TOKEN_RE = /[A-Za-z0-9_.\-*]+(?:\/[A-Za-z0-9_.\-*]+)*\/?/g;
const BACKTICK_SPAN_RE = /`([^`]+)`/;
/** A report that never writes the literal `Evidence:` label (shape B) still quotes the command
 * it ran; these are the command heads seen in the real reports. Under-parsing shape B would be
 * a bug (plan Oracle), so the command is recovered from the block text itself. */
const COMMAND_RE = /(?:^|\s)((?:grep|rg|find|ls|for)\b[^\n]*)/;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Splits the block text into its labelled fields. A label may be line-anchored (shape A) or
 * inline in a prose sentence (shapes B and C) — one scan handles both. */
function splitFields(blockText: string): Map<string, string> {
  const fields = new Map<string, string>();
  const marks: Array<{ key: string; start: number; end: number }> = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(blockText)) !== null) {
    marks.push({ key: m[1]!.toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!;
    const stop = i + 1 < marks.length ? marks[i + 1]!.start : blockText.length;
    if (!fields.has(mark.key)) fields.set(mark.key, blockText.slice(mark.end, stop));
  }
  if (marks.length > 0) fields.set('__preamble', blockText.slice(0, marks[0]!.start));
  else fields.set('__preamble', blockText);
  return fields;
}

/** The command a piece of text quotes: a backticked span first (shape A), else a run starting
 * at a known command head, truncated at the `→` that introduces the hit count (shapes B and C). */
function commandFrom(text: string): string {
  const span = BACKTICK_SPAN_RE.exec(text);
  if (span) return collapse(span[1]!);
  const cmd = COMMAND_RE.exec(text);
  if (cmd) return collapse(cmd[1]!.split(/→|->/)[0] ?? cmd[1]!);
  return '';
}

/** With an `Evidence:` label present, the field is authoritative (and its plain text up to `→`
 * is an accepted last resort). With NO label at all, only a real quoted command counts — prose
 * must never be mistaken for a fingerprint, or a block with no evidence would mint a gap whose
 * fingerprint can never re-fire. */
function fingerprintFrom(evidenceField: string | undefined, blockText: string): string {
  if (evidenceField === undefined) return commandFrom(blockText);
  const direct = commandFrom(evidenceField);
  if (direct.length > 0) return direct;
  return collapse(evidenceField.split(/→|->/)[0] ?? '');
}

function extractHits(evidence: string): number {
  const m = HITS_RE.exec(evidence);
  return m ? Number(m[1]) : 0;
}

function stripLineSuffix(token: string): string {
  return token.replace(/:\d+(?:,\d+)*$/, '');
}

function extractPaths(source: string): string[] {
  const out: string[] = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN_RE.exec(source)) !== null) {
    const raw = stripLineSuffix(m[0].replace(/[`,.)]+$/, ''));
    if (!raw.includes('/')) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/** Parses ONE Tracker report's text. `file`/`round` are carried through onto every candidate so
 * the gate can report where a candidate came from and dedupe by round order. */
export function parseTrackerReport(text: string, file: string, round: string): ParseResult {
  const lines = text.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (HEADER_RE.test(lines[i]!)) starts.push(i);

  const candidates: ParsedCandidate[] = [];
  const unparsed: UnparsedBlock[] = [];

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]!;
    let end = starts[s + 1] ?? lines.length;
    for (let i = start + 1; i < end; i++) {
      if (HEADING_RE.test(lines[i]!) || SUPPRESSED_RE.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    const headerMatch = HEADER_RE.exec(lines[start]!)!;
    const category = headerMatch[2]!.trim().toLowerCase().replace(/[\s/]+/g, '-');
    const headerRemainder = lines[start]!.slice(headerMatch[0].length);
    const blockText = [headerRemainder, ...lines.slice(start + 1, end)].join('\n');
    const excerpt = [lines[start]!, ...lines.slice(start + 1, end)].join('\n').slice(0, 200);

    const fields = splitFields(blockText);
    const evidenceField = fields.get('evidence');
    const fingerprint = fingerprintFrom(evidenceField, blockText);
    if (fingerprint.length === 0) {
      unparsed.push({ file, line: start + 1, reason: 'no Evidence command', excerpt });
      continue;
    }

    const diffLink = fields.get('diff link');
    const paths = extractPaths(diffLink !== undefined && diffLink.trim().length > 0 ? diffLink : blockText);
    if (paths.length === 0) {
      unparsed.push({ file, line: start + 1, reason: 'no path in Diff link or block body', excerpt });
      continue;
    }

    const pattern = fields.get('pattern');
    const preamble = fields.get('__preamble') ?? '';
    const description =
      collapse(pattern ?? '') || collapse(preamble) || category;

    candidates.push({
      category,
      paths,
      fingerprint,
      hits: extractHits(evidenceField ?? blockText),
      description,
      round,
      sourceFile: file,
      sourceLine: start + 1,
    });
  }

  return { candidates, unparsed };
}

/** Freeze-at-first-write (CU-2 M2, spec §2 step 2): candidates from different rounds with the
 * same category and overlapping paths collapse to ONE, keeping the earliest round's fingerprint.
 * `roundOrder` is the gate's report-file order (filename sort order); a candidate from a round
 * that is not in `roundOrder` sorts last. */
export function dedupeCandidates(
  all: readonly ParsedCandidate[],
  roundOrder: readonly string[],
): ParsedCandidate[] {
  const rank = (c: ParsedCandidate): number => {
    const idx = roundOrder.indexOf(c.round);
    return idx === -1 ? roundOrder.length : idx;
  };
  const ordered = [...all]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);

  const kept: ParsedCandidate[] = [];
  for (const candidate of ordered) {
    const duplicate = kept.some(
      (k) => k.category === candidate.category && anyPathOverlap(k.paths, candidate.paths),
    );
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}
