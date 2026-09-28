// rulings-check.ts — the ratification check for a campaign's `answers.md` (Tribe way of
// working; moved out of the runner, which no longer gates on it — card D3). A Tribe-style plan's
// closing task runs it as a Done command:
//
//   bun rulings-check.ts <answers.md>
//
// Exit 0: every ruling is ratified (or there are none). Exit 1: one unratified ruling id per line
// on stdout. Exit 2: the file cannot be read (one `rulings-check: cannot read …` line on stderr).
//
// Parsing stays in the runner's pure `core/rulings.ts`; this file imports it (the Tribe side
// depends on the runner, never the reverse). Everything above `main` is pure.
import { readFileSync } from 'node:fs';
import { parseRulings } from '../runner/core/rulings.ts';

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

/** Classifies one block's `ratifiedAs` value against the brief's vocabulary. `null` (field
 * absent) and `'pending'` (field present, explicitly not-yet) both classify `false`, same as
 * any unrecognized free text — see `RATIFIED_VALUE_RE`'s doc comment for why that is strict by
 * design rather than a bug.
 *
 * Accepted, deliberate consequence (maintainer ruling, harness-gap-wiring PR C): "missing field
 * -> unratified" is RETROACTIVE. A historical campaign's `answers.md` authored before this gate
 * existed (e.g. outstanding-17's, whose rulings carry no `ratified-as:` field at all) would
 * classify every one of those rulings as unratified if that campaign were ever re-run/
 * re-reported through this check. This is accepted, not a bug to work around: the runner no
 * longer gates on it (card D3), the check never rewrites or re-reports a closed campaign on
 * its own, and retrofitting `ratified-as:` onto old rulings once, by hand, is exactly the discipline this
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

function main(): void {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('usage: bun rulings-check.ts <answers.md>');
    process.exit(2);
  }
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (err) {
    // readFileSync raises only filesystem errors (missing file, a directory, no permission).
    console.error(`rulings-check: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const unratified = unratifiedRulingIds(content);
  if (unratified.length > 0) {
    for (const id of unratified) console.log(id);
    process.exit(1);
  }
  console.log('rulings-check: every ruling is ratified');
}

if (import.meta.main) {
  main();
}
