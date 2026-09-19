// The one named parser for the escalation-file shape (`rule-one-parser-per-edge-shape`, spec §5(d)).
// Three read sites share this module rather than re-deriving the shape inline: the supervisor loop's
// reason-line read (`core/supervisor/loop.ts`), the park document's question (also `loop.ts`), and
// the campaign report's question digest (`core/report.ts`, swapped in a later task). It lives at
// `core/` — not under `core/supervisor/` — because `core/report.ts` must import it without a lower
// layer depending on a higher one.
//
// PURE (`pure-core.md`): no fs, no clock, no globals — a string in, a value out. FAIL-CLOSED
// (`fail-closed-edges.md`): every shape degrades to `null` / `''`; it never throws into the caller.

/** The escalation file's machine-readable question (S-P3: fixed-template fields, never prose
 * interpretation). */
export interface EscalationQuestion {
  /** The value after `**Reason:**`, trimmed; `''` when the file has no reason line. */
  reasonLine: string;
  /** The `## Context` section body verbatim — the heading line through the line before the next
   * `## ` heading, or end of content; `''` when the file has no `## Context` section. */
  context: string;
}

/** The `**Reason:**` field — the same regex the two read sites this parser replaces already used,
 * so the reason value is byte-for-byte what they extracted before. */
const REASON_RE = /\*\*Reason:\*\*\s*(.+)/;

/** Extracts the `## <id>` section verbatim: the heading line through the line before the next `## `
 * heading, or end of content. This is the SAME heading partition `core/supervisor/verify.ts`'s
 * `blocksById` and `loop.ts`'s `extractRulingBlockVerbatim` use — one boundary rule for the repo,
 * never a third. A `### ` subheading is not a boundary (`/^##\s+/` requires whitespace after
 * exactly two hashes). `null` when no such heading exists. */
function sectionVerbatim(content: string, id: string): string | null {
  const lines = content.split('\n');
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const heading = /^##\s+(.+?)\s*$/.exec(lines[i] as string);
    if (heading !== null && (heading[1] as string).trim() === id) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] as string)) {
      endLine = i;
      break;
    }
  }
  return lines.slice(startLine, endLine).join('\n');
}

/** Parses the escalation-file shape. Returns `null` only when the content carries neither a
 * `**Reason:**` line nor a `## Context` section; otherwise returns both, each verbatim, with the
 * missing one as `''`. Never throws. */
export function parseEscalationQuestion(content: string): EscalationQuestion | null {
  const reasonLine = REASON_RE.exec(content)?.[1]?.trim() ?? '';
  const context = sectionVerbatim(content, 'Context') ?? '';
  if (reasonLine === '' && context === '') return null;
  return { reasonLine, context };
}

/** The `**Reason:**` value only, trimmed; `''` when absent — the reason-only convenience the
 * supervisor loop's `buildEscalationFacts` uses, so it and the park branch share this one parser
 * instead of two regex copies. Behaviour is identical to the private `extractReasonLine` it
 * replaced: absent reason (with or without a Context section) reads as `''`. */
export function extractReasonLine(content: string): string {
  return parseEscalationQuestion(content)?.reasonLine ?? '';
}
