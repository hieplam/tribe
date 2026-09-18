/**
 * Pure per-line classification for a raw transcript JSONL line (spec §15, card `## Measure
 * first`). Oracle: `fail-closed-edges.md` — a line that fails `JSON.parse` or parses to
 * anything other than a plain object (an array, a string, a number, `null`) is a typed SKIP,
 * never a throw. A blank line is its own case, explicitly NOT a skip (Task 3's Oracle): it
 * carries no data to lose, so counting it as a defect would just be noise.
 *
 * Pure: no imports, no I/O. Shared by `adapters/transcript-io.adapter.ts` (the plain
 * streaming reader) and `adapters/cut.ts` (the byte-cut reader) so the "is this line usable"
 * decision is made in exactly one place.
 */

export type LineOutcome =
  | { kind: 'blank' }
  | { kind: 'row'; value: Record<string, unknown> }
  | { kind: 'skip'; reason: string };

export function classifyLine(raw: string, lineNo: number): LineOutcome {
  if (raw.length === 0) return { kind: 'blank' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof SyntaxError ? err.message : 'invalid JSON';
    return { kind: 'skip', reason: `line ${lineNo}: invalid JSON (${message})` };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'skip', reason: `line ${lineNo}: not a JSON object` };
  }

  return { kind: 'row', value: parsed as Record<string, unknown> };
}
