// Rulings: parses a campaign's `answers.md` into ruling blocks. Classifying which of them are
// still unratified is Tribe way of working, not the runner's: it lives in
// `plugins/tribe/scripts/gaps/rulings-check.ts`, which imports this parser (the Tribe side
// depends on the runner, never the reverse).
//
// Pure module: no `fs`, no `child_process`, no `process`, no clock. Content arrives as a
// string; the caller reads the file and passes the text in. An absent `answers.md` is
// represented by `null`/`undefined` (the caller's choice, not this module's) and parses as zero
// rulings, same as an empty string.

/** One `## `-headed block of `answers.md`. `id` is the full heading text (the outstanding-17
 * convention is `## R<n> — <title>`, but this module parses ANY `## ` heading as a block —
 * the heading text, whatever it is, becomes the ruling id). `ratifiedAs` is the raw value
 * captured after the block's first `ratified-as:` line (case-insensitive key, leading `-`/`*`
 * bullet and `**bold**` markers tolerated) — `null` when the block carries no such line at all,
 * DISTINCT from an empty string (the line is present but its value is blank), which is also
 * unratified. */
export interface RulingBlock {
  id: string;
  ratifiedAs: string | null;
}

const HEADING_RE = /^##\s+(.+?)\s*$/;

/** Matches a `ratified-as:` line after markdown bold markers have been stripped (see
 * `parseRulings` below) — an optional leading bullet, the key (case-insensitive), then the
 * value. Stripping `**` first means the colon can fall either inside or outside the bold span
 * (`**ratified-as:**` or `**ratified-as**:`) without needing two separate patterns. */
const RATIFIED_AS_RE = /^(?:[-*]\s*)?ratified-as\s*:\s*(.*)$/i;

/** Parses `content` into ruling blocks, one per `## ` heading. Absent content (`null`/
 * `undefined`) and content with no `## ` heading at all both produce zero blocks — there is
 * nothing to ratify either way. Within a block, only the FIRST `ratified-as:` line is read;
 * later ones are ignored (documented behavior, not validated — this module classifies, it does
 * not lint `answers.md`'s authoring). */
export function parseRulings(content: string | null | undefined): RulingBlock[] {
  if (!content) return [];

  const blocks: RulingBlock[] = [];
  let current: RulingBlock | null = null;

  for (const rawLine of content.split('\n')) {
    const heading = HEADING_RE.exec(rawLine);
    if (heading) {
      current = { id: (heading[1] as string).trim(), ratifiedAs: null };
      blocks.push(current);
      continue;
    }
    if (!current || current.ratifiedAs !== null) continue;

    const stripped = rawLine.replace(/\*\*/g, '').trim();
    const ratified = RATIFIED_AS_RE.exec(stripped);
    if (ratified) {
      current.ratifiedAs = (ratified[1] as string).trim();
    }
  }

  return blocks;
}
