// Rulings: parses a campaign's `answers.md` into ruling blocks and classifies which of them
// are still unratified (harness-gap-wiring PR C, spec: outstanding-17 postmortem — a ruling
// that captured a durable convention was never carried into the target repo's governance files
// because nothing gated on it).
//
// Pure module: no `fs`, no `child_process`, no `process`, no clock. Content arrives as a
// string — the caller (`core/loop/run-loop.ts`, which already reads `answers.md` through its
// injected `LoopIO` for `resolved.answersContent`) reads the file and passes the text in. An
// absent `answers.md` is represented by `null`/`undefined` (the caller's choice, not this
// module's) and classifies as zero rulings, same as an empty string.

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

/** Spec vocabulary (brief): `rule <path>` | `debt <id>` | `roadmap <ref>` | `operational` |
 * `dismissed` each take the ruling out of "unratified". `pending` is a valid vocabulary word
 * but deliberately does NOT count as ratified — it is the explicit spelling of "not yet". Every
 * other value, and a present-but-empty value, falls through to `isRulingRatified`'s default
 * `false` (strict by design — the gate exists to force the discipline, per the brief).
 *
 * A ruling that closes a harness gap may name the gap it closed, as a trailing `(G-NNN)`
 * suffix — `rule plugins/tribe/rules/x.md (G-052)` (harness-gap gate spec, §5: "records it as
 * `ratified-as: rule <path> (G-NNN)`"). The suffix is optional and strictly shaped: `G-` plus
 * at least one digit, in parentheses, at the end. Anything looser stays free text and stays
 * unratified — the id is a cross-reference to the registry, never a licence to relax the
 * vocabulary. `pending` is excluded before this regex is ever reached, so `pending (G-057)` is
 * unratified too. */
const RATIFIED_VALUE_RE =
  /^(rule\s+\S+|debt\s+\S+|roadmap\s+\S+|operational|dismissed)(\s+\(G-\d+\))?$/i;

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

/** Classifies one block's `ratifiedAs` value against the brief's vocabulary. `null` (field
 * absent) and `'pending'` (field present, explicitly not-yet) both classify `false`, same as
 * any unrecognized free text — see `RATIFIED_VALUE_RE`'s doc comment for why that is strict by
 * design rather than a bug.
 *
 * Accepted, deliberate consequence (maintainer ruling, harness-gap-wiring PR C): "missing field
 * -> unratified" is RETROACTIVE. A historical campaign's `answers.md` authored before this gate
 * existed (e.g. outstanding-17's, whose rulings carry no `ratified-as:` field at all) would
 * classify every one of those rulings as unratified if that campaign were ever re-run/
 * re-reported through this gate. This is accepted, not a bug to work around: the gate only
 * fires on the would-be-`done` path of an ACTIVE run (`core/loop/run-loop.ts`'s
 * `applyRulingsGate`) — it never rewrites or re-reports a closed campaign on its own — and
 * retrofitting `ratified-as:` onto old rulings once, by hand, is exactly the discipline this
 * gate exists to establish going forward. */
export function isRulingRatified(ratifiedAs: string | null): boolean {
  if (ratifiedAs === null) return false;
  const value = ratifiedAs.trim();
  if (value.length === 0) return false;
  if (/^pending$/i.test(value)) return false;
  return RATIFIED_VALUE_RE.test(value);
}

/** The gate's one real question: which ruling ids in `content` are still unratified, in
 * document order. Zero rulings (absent/empty content, or content with no `## ` heading)
 * produces an empty list — nothing to gate on. */
export function unratifiedRulingIds(content: string | null | undefined): string[] {
  return parseRulings(content)
    .filter((block) => !isRulingRatified(block.ratifiedAs))
    .map((block) => block.id);
}
