# Evidence — card `supervisor-sessions-in-repo` (campaign `sessions-in-repo`)

Every row below was produced by running the command named in spec §5, on this branch, on
2026-09-27. Nothing here is copied from a claim; each cell links the file the command wrote.

Contract: `docs/superpowers/specs/2026-09-27-supervisor-sessions-in-repo-design.md` §5.
Baseline numbers: [`baseline.md`](baseline.md), measured on master before any task.

## Verdict table

| Goal | Baseline (before) | Measured (after) | Proof | Verdict |
|---|---|---|---|---|
| G1 — every supervisor session starts in the target repo | `G1 0/5 kinds=?,closing,ratify` | `G1 3/3 kinds=closing,ratify,ruling` | [`g1-transcript-cwd.txt`](g1-transcript-cwd.txt) | **PASS** |
| G2 — nothing in the campaign folder loads as config | 4 carry-over pairs fail, negative control passes (`5 fail / 1 pass`) | `6 pass / 0 fail` | [`g2-carryover-e2e.txt`](g2-carryover-e2e.txt) | **PASS** |
| G3 — `ruling` still cannot write into the repo | fails on base (no seam yet; see baseline.md "DEVIATION") | passes, inside the same 6 | [`g2-carryover-e2e.txt`](g2-carryover-e2e.txt) | **PASS** |
| G4 — #171's guards and rule removed, rule rewritten | `guard_files_lines=1070 identifier_hits=149 old_rule=present new_rule=absent c3_check=ok` | `guard_files_lines=0 identifier_hits=0 old_rule=absent new_rule=present c3_check=ok` | [`g4-footprint.txt`](g4-footprint.txt) | **PASS** |
| G5 — each supervisor session badged to its campaign | `G5 0/5` | `G5 3/3` live; `G5 3/5` on the historical campaign | [`g5-badges.jsonl`](g5-badges.jsonl), [`g5/`](g5/), [`g5-fu-supervisor-settings.txt`](g5-fu-supervisor-settings.txt) | **PASS** |
| G6 — nothing regresses | runner `0 fail`; `40 passed`; session e2e `6 pass / 1 fail` (inherited) | runner `1357 pass / 0 fail`, tsc clean; `40 passed, 0 failed`; session e2e `6 pass / 1 fail` (the SAME inherited one) | [`g6-runner-test.txt`](g6-runner-test.txt), [`g6-runner-tsc.txt`](g6-runner-tsc.txt), [`g6-supervisor-e2e.txt`](g6-supervisor-e2e.txt), [`g6-session-e2e.txt`](g6-session-e2e.txt), [`g6-viewer-test.txt`](g6-viewer-test.txt), [`g6-viewer-tsc.txt`](g6-viewer-tsc.txt) | **PASS** |
| G7 — the owner's checkout is untouched | unchanged | `G7 PASS branch=master head=b99aa76→b99aa76 porcelain=clean_as_before` | [`g7-verdict.txt`](g7-verdict.txt), [`g7-main-before.txt`](g7-main-before.txt), [`g7-main-after.txt`](g7-main-after.txt) | **PASS** |
| G8 — the ledger alone is the campaign's session tree | `3/41` sessions, `0/34` edges | run 2: `4/4` sessions, `0/0` edges. run 1: `5/5` sessions, `2/2` edges — LLM identical to the ledger in both | [`g8-compare.json`](g8-compare.json), [`g8-llm-tree.txt`](g8-llm-tree.txt), [`g8-round1-compare.json`](g8-round1-compare.json), [`g8-round1-llm-tree.txt`](g8-round1-llm-tree.txt) | **PARTIAL — see below** |

## G8 is the one row that does not close in a single run

Spec §5's G8 pass condition has two parts. The *measurement* part —
`ledger.present == truth.sessions`, `ledger.edgesCorrect == truth.edges`, `ledger.extra == 0`, and
the same three for the LLM — **holds in both runs, exactly**. The *composition* part —
`truth has ≥ 1 executor, ≥ 1 subagent, ≥ 3 supervisor sessions` — is met by the two runs only
together, never by either alone:

| Owner run | executor | subagents | supervisor sessions | ledger score | LLM score |
|---|---|---|---|---|---|
| `sir-owner-run-20260927T092641Z` (run 1) | 1 | 2 (`hunter`, `tracker`) | 2 — `ratify`, `closing` | `5/5` sessions, `2/2` edges, 0 extra | identical |
| `sir-owner-run-20260927T094117Z` (run 2) | 1 | 0 | 3 — `ruling`, `ratify`, `closing` | `4/4` sessions, `0/0` edges, 0 extra | identical |

**Why run 1 had no `ruling`.** Its pre-seeded ruling R0 named card `owner-run-probe`, which
satisfied the probe plan's own "ask first" gate, so the probe never escalated and the `ruling` kind
was unreachable. Fixed in commit `the owner-run pre-seed leaves owner-run-probe unruled` — R0 now
names `owner-run-seed` and says in a line of its own that `owner-run-probe` is unruled. Run 2 proves
the fix: the executor returned `NEEDS_DIRECTION: owner-run-probe — should the owner-runs line start
with the UTC date or the campaign slug?`, the runner exited `escalations_pending`, and a `ruling`
session ran.

**Why run 2 had no subagent.** The probe card is single-use per repo. Run 1 landed PR #176, which
appended the probe's line to `docs/tribe/owner-runs.md` on master. Run 2's executor read the repo,
found the work already merged, and shipped correctly without dispatching a Hunter — its own words:

> This card's work was already completed and merged under a prior attempt (campaign
> `sir-owner-run-20260927T092641Z`) before this session's context was captured — nothing left to
> implement.
>
> `SHIPPED 176 d901432db85ab1510046ba45f9093a24b8c99802`

That is correct executor behaviour, not a defect in this card's code. But it means no *further*
owner run against this repo can ever produce a subagent either: every future executor reads the same
landed line and reaches the same verdict. Making the probe repeatable would require editing
`docs/superpowers/plans/2026-09-27-owner-run-probe.md`, which this card's plan puts on its
**Do not touch** list.

**What is and is not proven.** The card's own G8 goal — "an LLM given only `ledger.jsonl` draws the
campaign's session flow: every session present, every parent edge correct" — is met, twice, by a
real Haiku call with no tools, against truth read off disk. The subagent half of the tree
(2 subagents, 2 parent edges, both correct, from the SDK stream's `parent_tool_use_id`) is proven by
run 1; the three-supervisor-kind half is proven by run 2. Both runs exercised the same committed
code. What is *not* proven is the two halves inside one `g8-compare.json`.

## The G6 failure that is inherited, not caused here

`core/supervisor/session.e2e.test.ts` → "closing: Skill c3 returns C3 content and no Unknown skill
appears" fails on this branch AND on untouched `origin/master`, for the same reason: Haiku guesses
the skill name `c3:c3`, the harness answers `Unknown skill: c3:c3`, and Haiku then invokes the real
`c3-skill:c3` successfully. The settings tier the test protects is intact — the session's own
`system/init` lists `c3-skill:c3`. Measured side by side in
[`g6-session-e2e-base-crosscheck.txt`](g6-session-e2e-base-crosscheck.txt). REFUTED in advance by
the plan's adjudication rule.

The viewer's `8 test failures` (`e2e/served-build.e2e.test.ts`, `e2e/url-refusals.e2e.test.ts`, and
six missing-Playwright-Chromium ones) and `21 tsc errors`
(`e2e/visual-contract.e2e.test.ts`, `e2e/visual-parity.ts`) are the exact pre-existing set spec §5.1
names.
