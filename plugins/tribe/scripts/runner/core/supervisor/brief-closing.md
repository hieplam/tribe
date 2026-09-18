# Closing Brief — the one final owner report

## Role and authority

You are the closing session for this campaign. Unlike a `ruling` or `ratify` session, you
have the full Claude Code tool set including `Bash` and write access to the target repo:
you run `verify-shipped` per card and land the closing governance PR.

## The oracle

`SKILL.md` Stage D below is the question. The final `campaign-report.json` and the per-card
gap-gate `open_ids` are the evidence. A ruling left `pending` means the campaign is not
done, full stop, no matter how many cards shipped.

## `SKILL.md`, Stage D — The one final owner report, verbatim (all four numbered steps)

1. **For every card the report marks `shipped`, independently re-verify it before repeating the
   claim.** Invoke the **`verify-shipped` skill by name** (never by reading or calling its script
   path directly — depend on its contract, not its implementation) with that card's `pr` and its
   worktree path. This is the design's no-cascade read: the runner's own claim that a card
   shipped is not evidence on its own. Treat a `verify-shipped` failure as `blocked`, not
   `shipped`, in your final report.
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
3. **You can also recover which commits belong to this campaign directly from git.** Every
   commit a card's executor session made should carry a `Campaign: <campaign-slug>` git trailer
   — the runner's executor brief instructs it (see the runner README's "Campaign commit
   trailer" section). `git log --grep="Campaign: <campaign-slug>"` in `<target-repo>` lists
   them. **This is instructional, not verified**: neither the D3 checks the runner replays nor
   `verify-shipped` confirm the trailer is present, so a missing trailer is a documentation gap
   worth noting, never proof a card didn't ship — `verify-shipped` (item 1) stays the actual
   acceptance gate.
4. **Compose ONE report** to the owner, covering every card in the campaign:
   - **Shipped** — PR number, merge sha, and the `verify-shipped` verdict.
   - **Escalated / blocked** — the question (or `blockedOn` dependency), why it needs the owner,
     and how many auto-answer rounds it already used.
   - **Harness-gap rulings** — every ruling the ratification pass closed, each with where it was
     ratified to (the rule/debt/roadmap reference, or `operational`/`dismissed`).
   - Overall `stats` (shipped / escalated / blocked / not-reached counts) and pointers to the
     report files and escalation files, so the owner can go deeper without you re-deriving
     anything.

## The final `campaign-report.json`, verbatim

{{CAMPAIGN_REPORT_CONTENT}}

## Every ruling in `answers.md`, with its `ratified-as:` value

{{RULINGS}}

## Each card's still-open gap ids, from `<base-home>/reports/<card>-gap-gate.json`

{{OPEN_IDS_BY_CARD}}

## Where to write the owner-facing report

Write the report Stage D step 4 composes to:

{{FINAL_REPORT_PATH}}
