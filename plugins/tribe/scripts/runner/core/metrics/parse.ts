/**
 * Pure per-line classification for a raw transcript JSONL line (spec §15, card `## Measure
 * first`). Oracle: `fail-closed-edges.md` — a line that fails `JSON.parse` or parses to
 * anything other than a plain object (an array, a string, a number, `null`) is a typed SKIP,
 * never a throw. A blank line is its own case, explicitly NOT a skip (Task 3's Oracle): it
 * carries no data to lose, so counting it as a defect would just be noise.
 *
 * Fix 12: the skip `reason` is a CLOSED code (`SkipReason`), never the parser's own exception
 * text or any transcript content — a `SyntaxError` message can echo back bytes from the line it
 * failed to parse, and this reason is committed verbatim into the numbers-only baseline file.
 * `line` is a plain line number, safe to carry as-is.
 *
 * Pure: no imports, no I/O. Shared by `adapters/transcript-io.adapter.ts` (the plain
 * streaming reader) and `adapters/cut.ts` (the byte-cut reader) so the "is this line usable"
 * decision is made in exactly one place.
 */
import type { SkipReason } from './model.ts';

export type LineOutcome =
  | { kind: 'blank' }
  | { kind: 'row'; value: Record<string, unknown> }
  | { kind: 'skip'; reason: SkipReason; line: number };

export function classifyLine(raw: string, lineNo: number): LineOutcome {
  if (raw.length === 0) return { kind: 'blank' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'skip', reason: 'invalid_json', line: lineNo };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'skip', reason: 'not_object', line: lineNo };
  }

  return { kind: 'row', value: parsed as Record<string, unknown> };
}
