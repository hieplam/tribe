---
id: adr-20260925-fix2b-ratchet-reconciliation
c3-seal: 204e7abb49187a784e3858d9af93aeee96d8883bc3a7763573300dbf5c954464
title: fix2b-ratchet-reconciliation
type: adr
goal: |-
    Reconcile `c3-215`'s Change Safety row for "A ruling/ratify session writes outside the campaign
    home…" (`c3-215-tribe.md:103`) to fix round 2a of card `supervisor-home-settings-containment`,
    which found the row's `0/3 before -> 3/3 after` ratchet phrase superseded twice over without ever
    being corrected in the frozen fact: fix round 1 (commit `cd029ea`) raised the G2 E2E ratchet to
    `0/4 -> 4/4` by adding a fourth carry-over pair, and fix round 2a (finding m4, same evidence
    document) then found that fourth pair was an exact duplicate of the second and replaced it with a
    genuinely distinct pair — the nested `<home>/escalations/AGENTS.md` on-demand load path. The true,
    current fact is `0/4 -> 4/4` over four DISTINCT mechanisms, and this unit brings the row to state
    exactly that, naming all four. No behavior changes; this is a documentation-only reconciliation.
status: accepted
date: "2026-09-25"
---

## Goal

Reconcile `c3-215`'s Change Safety row for "A ruling/ratify session writes outside the campaign
home…" (`c3-215-tribe.md:103`) to fix round 2a of card `supervisor-home-settings-containment`,
which found the row's `0/3 before -> 3/3 after` ratchet phrase superseded twice over without ever
being corrected in the frozen fact: fix round 1 (commit `cd029ea`) raised the G2 E2E ratchet to
`0/4 -> 4/4` by adding a fourth carry-over pair, and fix round 2a (finding m4, same evidence
document) then found that fourth pair was an exact duplicate of the second and replaced it with a
genuinely distinct pair — the nested `<home>/escalations/AGENTS.md` on-demand load path. The true,
current fact is `0/4 -> 4/4` over four DISTINCT mechanisms, and this unit brings the row to state
exactly that, naming all four. No behavior changes; this is a documentation-only reconciliation.

## Context

`c3-215-tribe.md:103`'s Change Safety row ends its MEASURED clause with the sentence "two real
sessions per test in the SAME campaign home proving a ruling/closing writer's planted hook and
CLAUDE.md instruction never reach the next ruling/closing session, 0/3 before -> 3/3 after". That
sentence was accurate when the row was last patched (change-unit
`adr-20260925-supervisor-home-settings-containment`, this card's Task 11), against the G2 E2E as it
stood at that time (three carry-over pairs: `ruling` plants with `Write` -> `ruling`; `closing`
plants with `Bash` -> `ruling`; `closing` plants with `Write` -> `closing`).

It has since been superseded twice, in the same evidence document
(`docs/superpowers/evidence/2026-09-25-supervisor-home-settings-containment.md`) but never
corrected in this frozen fact:

- **Fix round 1** (`## FIX ROUND 1`, commit `cd029ea`) added a fourth pair — `closing` plants
`<home>/AGENTS.md` with `Bash` -> the next `ruling` reads it — after an adversarial audit found
`<home>/AGENTS.md` uncovered (the Claude Code CLI loads it as project instructions by default
wherever the campaign home has no `CLAUDE.md`, precisely the steady state this card's own
restore creates). The ratchet became `0/4 -> 4/4`. A separate change-unit
(`adr-20260925-fix1b-agentsmd-config-surface`) already reconciled the row's shape enumeration
(`agents*.md`) for this round, but did not touch the row's ratchet-number sentence, which still
read `0/3 -> 3/3`.
- **Fix round 2a** (`## FIX ROUND 2`, finding m4) found that fourth pair —
`carryOverPair('closing', writerBashPrompt, 'Bash', 'ruling', 'c1-agentsmd')` — was the second
pair's exact call with only a different label, so the count had risen from 3 to 4 partly by
repetition rather than by a new mechanism. It was replaced
(`core/supervisor/home-config.e2e.test.ts:348`) by the nested `<home>/escalations/AGENTS.md`
pair — the other on-demand load path spec §4.3 row `m1b` measured — proven non-vacuous by a
mutation that removed the `agents*.md` clause and watched a real `closing` -> `ruling` pair leak
the codeword (RED), then restored it and watched all four pairs pass (GREEN). The ratchet number
is unchanged at this point (`0/4 -> 4/4`); what changed is that the four pairs are now four
genuinely distinct mechanisms, not three plus a repeat.

So the row's `0/3 before -> 3/3 after` sentence both understates the ratchet's current count
(`0/4 -> 4/4`) and, independent of the count, never named which four mechanisms compose it — a gap
this unit closes in one sentence.

## Decision

One block patch, one change-unit, no behavior change:

1. `c3-215`'s Change Safety row (`c3-215-tribe.md:103`, cited fresh): replace the trailing
`0/3 before -> 3/3 after` phrase with `0/4 before -> 4/4 after, over four DISTINCT mechanisms —
(1) a ruling session's own Write-writer refusal (ruling plants with Write -> ruling), (2) the
Bash-writer restore (closing plants with Bash -> ruling), (3) closing -> closing (closing plants
with Write -> closing), and (4) the nested on-demand AGENTS.md path (closing plants
<home>/escalations/AGENTS.md with Bash -> ruling, whose reader reads a file inside that
directory because a nested memory file loads only on demand, spec §4.3 m1b) — pair (4)
superseding fix round 1's duplicate fourth pair (fix round 2, finding m4)`, keeping every other
cell and every other sentence of the row unchanged.

No source file, test, plan, or evidence document is touched by this unit — the code and tests
already landed in fix rounds 1 and 2a; this unit only brings the one frozen governance fact up to
date with them.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Change Safety row for "A ruling/ratify session writes outside the campaign home…" (c3-215-tribe.md:103) still ends with the superseded ratchet phrase 0/3 before -> 3/3 after; the true, current ratchet is 0/4 -> 4/4 over four distinct mechanisms, the fourth having been replaced (fix round 2a, finding m4) after fix round 1 first raised the count | c3-215#n2150@v1:sha256:67cfb5ef94c76964433c440eea6ca981a9c75d8b09f55ac5738eaed72c9d51ae "A ruling/ratify session writes outside the campaign home, or the repo is touched by a session that should never write to it" | Patch 01 (block) replaces the row's trailing ratchet phrase with the current 0/4 -> 4/4 count, naming all four distinct mechanisms, in the row's existing sentence style |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-change-unit-ships-with-code | Fix round 1's and fix round 2a's code and tests already merged to this branch (commits cd029ea, 31f5f3d); this unit is the deferred reconciliation the rule requires to land in the same delivery, not a later pass | rule-change-unit-ships-with-code#n2334@v1:sha256:b6024e72d871662eb34400050e4c977663b0356dceb6c8e2c42b3ea1c4fda085 "The PR that merges a decided ADR's code applies every patch under .c3/changes/<adr-id>/ to its target fact in that same PR, or records the deferral as a debt " | comply — this ADR is flipped to done only after change apply lands the patch and its after-state phrase (0/4 -> 4/4) greps present, in the same commit as this reconciliation |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash c3x.sh change apply adr-20260925-fix2b-ratchet-reconciliation | applies atomically — one block patch, no drift |
| C3X_MODE=agent bash c3x.sh check | ok: true |
| command grep -c "0/4 before -> 4/4 after" .c3/c3-2-plugins/c3-215-tribe.md | >= 1 |
| command grep -c "0/3 before -> 3/3 after" .c3/c3-2-plugins/c3-215-tribe.md | 0 |
