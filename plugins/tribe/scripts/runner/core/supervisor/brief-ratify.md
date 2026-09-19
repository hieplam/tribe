# Ratify Brief — unratified rulings

**The file to edit is at the absolute path {{ANSWERS_PATH}} — always use this full path,
never a bare `answers.md` and never `/answers.md`.**

## Role and authority

You are ratifying rulings already recorded in `{{ANSWERS_PATH}}`. This is bookkeeping
judgment over a file that already exists — you do not invent new rulings here, only repair
the `ratified-as:` field on the ids named below.

## The oracle

`run.unratifiedRulings` below is the question. A ruling block's own text is the evidence.
Editing a block whose id is NOT named below is out of scope, even if it looks wrong too.

## Unratified ruling ids, verbatim from `run.unratifiedRulings`

{{UNRATIFIED_IDS}}

## Each named ruling's own block, verbatim from `{{ANSWERS_PATH}}`

{{RULING_BLOCKS}}

## Frozen `ratified-as:` vocabulary, and what each value means

- `rule <path>` — a rule or anti-rule file landed in the target repo.
- `debt <id>` — a debt entity recorded in the target repo's debt ledger.
- `roadmap <ref>` — a ROADMAP Decision Log entry.
- `operational` — a campaign-mechanics ruling that dies with the campaign (a sequencing
  tweak, a scope clarification); it names no governance artifact because it durably names
  none.
- `dismissed` — considered and rejected; no artifact.

## Governing quote, verbatim with its source

`SKILL.md`, "Walls this skill exists to hold":

- **The diary and `answers.md` are event logs and operational state, never the resting place of
  a durable convention.** Durable means a governance surface of the target repo — a rule file,
  an anti-rule, a debt entity, a ROADMAP Decision Log entry — reached through a PR. A ruling that
  never leaves `answers.md` is exactly the failure the ratification pass (Stage D) exists to
  catch.

`SKILL.md`, Stage D, the ratification pass:

2. **The ratification pass.** Collect every convention surfaced across the whole campaign. The
   authoritative list per card is **the gate's own JSON**, not a PR body you re-read: for each
   card, read `<base-home>/reports/<card>-gap-gate.json` (where `<base-home>` is
   `$(plugins/tribe/scripts/tribe-home.sh <target-repo>)` — the BASE tribe home the gate writes to,
   NOT the campaign-nested `--home` above) and take its `open_ids` — the gaps the gate
   reconciled and left un-ruled. Add each `shipped` card's `## Harness gaps` PR record (the
   proposals its Warchief landed as reviewable drafts but did not self-ratify, per its brief)
   plus every ruling already in `answers.md`. Every one of them must end this pass
   non-`pending`. Durable dispositions (`rule`, `anti-rule`, `debt`) do not stay as prose in a
   PR body or a diary line — land them as **ONE closing governance PR** on the target repo, and
   land them **through the CLIs, never by hand**: for every ratified proposal that carries a
   `G-NNN`, run `gap-rule.ts` with `--ratified-by shaman` (or `--ratified-by owner` when the
   owner ruled that one) inside that closing PR's worktree, so the registry's `ruled` events —
   and the rule/anti-rule file or debt entity the ruling creates — ride the same PR. Add the
   ROADMAP Decision Log entries, then mark each ruling's `ratified-as:` accordingly; a ruling
   that closes a gap with an id records it as `ratified-as: rule <path> (G-NNN)`. Never
   hand-write a rule file, a debt entity, or a line of `.tribe/harness-gaps.jsonl` — a ruling
   that never reaches `gap-rule.ts` leaves the registry claiming the gap is still open and
   leaves `gap-precision.ts` with nothing to score (this is exactly what the 2026-09-05 closing
   pass did). The runner's `rulings_unratified` exit is the mechanical backstop for skipping
   this step — it is not the primary mechanism, do not rely on it to catch what this pass should
   catch by judgment. A ruling left `pending` means the campaign is **not done**, full stop, no
   matter how many cards shipped.

## The two exits — exactly these, nothing else

- Repair every `ratified-as:` value on the named ids above, in `{{ANSWERS_PATH}}`, so none
  reads `pending`.
- Write a park marker naming the ids you cannot rule on.

Touching a ruling block whose id is not named above is the same offence as rewriting
history — do not do it, even to fix an unrelated typo.
