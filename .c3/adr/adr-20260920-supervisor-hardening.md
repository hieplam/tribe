---
id: adr-20260920-supervisor-hardening
c3-seal: 4cca28a9c8b753cc1258f62e3a6a8397415c8d0280d013e8d02647bc7913cca9
title: supervisor-hardening
type: adr
goal: |-
    Authorize the `supervisor-hardening` card's four cross-cutting architecture decisions as the fixed
    shape the five fixes (G1 through G5) and the parser-debt paydown (G4) must implement, and record
    that `c3-215` (`tribe`) will gain the matching Contract and Change Safety rows once that code
    exists. The four decisions are: (1) the closing verdict is an on-disk file the `verify-shipped.sh`
    script produces, never prose the model wrote; (2) the context-budget ratchet is enforced by a
    globbed shell suite driving a thin edge over a pure merge-base checker; (3) four named edge parsers
    replace the runner's duplicated inline narrowings; and (4) the gap-gate reader reads the same
    campaign home the gate writes to. This ADR authorizes the decisions only; the `c3-215` patches that
    make its model true again are deferred to the Phase 2 reconciliation task, because the code they
    describe does not exist yet and a patch against absent code is exactly the drift this repo already
    carries.
status: proposed
date: "2026-09-20"
---

## Goal

Authorize the `supervisor-hardening` card's four cross-cutting architecture decisions as the fixed
shape the five fixes (G1 through G5) and the parser-debt paydown (G4) must implement, and record
that `c3-215` (`tribe`) will gain the matching Contract and Change Safety rows once that code
exists. The four decisions are: (1) the closing verdict is an on-disk file the `verify-shipped.sh`
script produces, never prose the model wrote; (2) the context-budget ratchet is enforced by a
globbed shell suite driving a thin edge over a pure merge-base checker; (3) four named edge parsers
replace the runner's duplicated inline narrowings; and (4) the gap-gate reader reads the same
campaign home the gate writes to. This ADR authorizes the decisions only; the `c3-215` patches that
make its model true again are deferred to the Phase 2 reconciliation task, because the code they
describe does not exist yet and a patch against absent code is exactly the drift this repo already
carries.

## Context

The campaign supervisor shipped (PR #152) with five latent defects the `supervisor-hardening` card
exists to fix, each a wiring gap that every green gate passed over:

- **G1** — a card-scoped park renders `NEEDS_OWNER.md` with a literal `question: null`, so the owner
never sees the escalation's own question (`core/supervisor/loop.ts:962`).
- **G2** — `core/metrics/ceiling.ts`'s `reviseCeiling` predicate is correct but has no caller
outside its own test, so the context ceiling "only moves in the good direction" promise is
enforced by nothing; a hand-edited unjustified raise passes every gate.
- **G3** — `verifyClosing` (`core/supervisor/verify.ts:200-210`) closes a campaign on any non-empty
report, so a report whose body says BLOCKED still closes; nothing checks that `verify-shipped`
actually ran, and its `SKILL.md` names a `~/.claude/skills/...` path that does not exist under a
plugin load.
- **G4** — `rule-one-parser-per-edge-shape` is violated in the runner: two byte-identical
`'code' in err` narrowings (G-004 fingerprint, 2 hits), twelve lower-rigor bare `.code` casts, two
inline re-parses of `campaign-state.json`, and three read sites of the escalation-file shape.
- **G5** — the gap-gate writer writes under the campaign home (forced by where its Tracker-report
inputs live) while the reader (`loop.ts:546`) reads under the base tribe home, so the closing
brief never lists the gate's open ids.

The delivery-role contracts these files implement are owned by component `c3-215`. Its Contract
table today documents the `run.ts` runner and the `supervise`/`transcript-metrics` subcommands, but
has no row for the ratchet-check edge, the `verify-shipped` verdict-file surface, or the resolver
this card adds; its Change Safety table has no row for the closing-verdict postcondition or the
gap-gate read-path correction. Three older 2026-09-19 ADR change units already report `state:
drifted` against `c3-215` independently of this card; that pre-existing drift is a recorded
follow-up, not this card's to repair. Per `brief-contracts.md`'s sequencing rule the plan closes
each phase with its own reconciliation task rather than batching them, and the model is read and
written only through the wrapper CLI.

## Decision

Record these four decisions as the authorized shape. Each is settled here so the fix tasks
implement one interpretation, not several.

**1. The verdict file is the closing oracle (spec section 4a).** The closing verdict is an artifact
`verify-shipped.sh` produces, never prose the model wrote. Path:
`<campaign-home>/supervisor/verdicts/<cardId>.json`, one file per shipped card. It lives inside the
supervisor's existing S-P5 write surface (`<home>/supervisor/**`), so no write-surface probe widens.
Its contents are byte-identical to what `verify-shipped.sh` already prints on stdout; the script
gains exactly one flag, `--verdict-out <path>`, and writes that same JSON with a temp-file-then-rename
so a reader never sees a half-written file. The four checks, the exit codes, and the stdout contract
are unchanged. The supervisor's pure `verifyClosing` gains one input, `shippedVerdicts`, parses each
raw entry narrowly and fail-closed, and returns the ordinary retryable `failed` outcome (never a new
`ParkReason`, which the fence freezes) when any shipped card lacks a present, well-formed, matching,
PASS verdict. The closing brief names this file as its oracle: the file the script writes is the
contract, the session's own prose is not.

**2. The ratchet enforcement point is a globbed shell suite over a pure checker (spec section 3).**
The enforcement point is a new shell test, `plugins/tribe/scripts/tests/test-supervisor-ratchet.sh`,
chosen precisely because `pre-gate.sh` enumerates suites by glob, so a new `test-*.sh` is swept every
audit round with no wiring step that can be forgotten. It drives a thin edge,
`plugins/tribe/scripts/ratchet-check.ts`, over a pure core,
`core/metrics/ratchet-gate.ts#checkRatchetRevision(baseJson, headJson)`. The core takes two file
contents and returns a verdict, calling the existing `reviseCeiling` once per ceiling kind; the
existing function is not modified. The comparison is against the merge-base version, never the
previous commit, so a rebased raise is still caught and master's own past raises are not flagged.
Raises are justified by an optional top-level `raisedBy` object keyed by ceiling kind; absent reads
as the null argument `reviseCeiling` already refuses a raise on. The edge isolates every git call per
`fail-closed-edges.md` obligations 2 and 3.

**3. Four named parsers replace the runner's duplicated narrowings (spec section 5).** Each edge
shape is parsed in exactly one place, every read site importing it: `core/errno.ts#errorCode` for a
caught error's `code` (the two G-004 sites plus the twelve bare casts); `core/escalation.ts` for the
escalation-file shape (three read sites collapse to one parser); `core/state.ts`'s existing
`CampaignStateSchema`, reused read-only through a new private `readCampaignState` that does
`JSON.parse` in a narrow try then `safeParse` (not `parseState`, which throws referential-integrity
errors a tick loop must not see); and the `raisedBy`/`ceilings` shape, parsed once in
`checkRatchetRevision` by construction. These are refactors under a green suite: a behaviour change
is a bug, the sole intended difference being that `errorCode` returns null where a bare cast would
have read `.code` off null and thrown.

**4. The gap-gate reader reads the campaign home the writer writes to (spec section 6).** The writer
location is forced by where its inputs live: `gap-gate.ts` globs its Tracker-report inputs from
`<--home>/reports/`, and a campaign card's Tracker reports are written under the campaign home, so in
a campaign the gate must run with `--home <campaign-home>` and its output lands there too. The reader
is the side that is wrong. `loop.ts#readGapGateOpenIds` reads `join(homeDir, 'reports', ...)` — the
campaign home it is already given — and `buildOneShotPrompt` stops resolving the base tribe home for
this purpose. One path, no silent fallback, because a fallback that quietly tries a second directory
is how a reader ends up disagreeing with a writer again. The two documentation lines the code fix
falsifies (`orchestrate-campaign/SKILL.md` Stage D, `agents/warchief.md`'s gap-gate invocation) are
corrected to name the campaign home.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Contract table records the runner CLI surfaces but has no row for the ratchet-check edge, the verify-shipped verdict-file flag and on-disk shape, or the verify-shipped path resolver this card adds; the model goes stale the moment Phase 2 code lands | c3-215#n1765@v1:sha256:a6f5b0e592fa68e4ba8014ad5f62214f41153de6a5d51c78fc6148c54a1d6deb "Contract" | Phase 2 reconciliation (plan Task 13) inserts Contract rows for the new CLI and file surfaces; no existing row edited by this ADR |
| c3-215 | component | Its Change Safety table has no row for the new closing postcondition (a shipped card closes only on its own verify-shipped verdict file) or the gap-gate read-path correction; both are governed surfaces with risk/trigger/detection/verification to record | c3-215#n1784@v1:sha256:a809e4964c497ae1e305200178f46892a76d8d4a735091d2c21c558538c3ef6b "Change Safety" | Phase 2 reconciliation (plan Task 13) inserts a Change Safety row; this ADR authorizes it, the patch is deferred until the code exists |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-plugin-layout | Decision 1's resolve-verify-shipped.sh ships beside its SKILL.md and follows the same two-tier plugin-load resolution as orchestrate-campaign's resolve-runner.sh, so it must honour this layout ref | ref-plugin-layout#n1929@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 "Goal" | comply — the resolver honours $CLAUDE_PLUGIN_ROOT first then locates itself, printing only a proven absolute path |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-one-parser-per-edge-shape | Decision 3 is the direct paydown of this rule's G-004 debt in the runner: one named parser per edge shape, every read site importing it | rule-one-parser-per-edge-shape#n2051@v1:sha256:62845f31a2fe00be3ebaaeb93f5b27af82ab81dfcbaa1871c76f596cd98cf3c9 "Rule" | comply — Phase 3 (plan Tasks 14 to 18) records the four named parsers and the fingerprint reaching zero |
| rule-bash-strict-mode | Decisions 1 and 2 add shell scripts (test-supervisor-ratchet.sh, resolve-verify-shipped.sh) and the verify-shipped.sh flag, all of which this rule governs | rule-bash-strict-mode#n1940@v1:sha256:62845f31a2fe00be3ebaaeb93f5b27af82ab81dfcbaa1871c76f596cd98cf3c9 "Rule" | comply — each new or edited script runs under set -euo pipefail as the rule requires |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| verify-shipped script | Add the --verdict-out flag writing byte-identical JSON via temp-file-then-rename; add the resolve-verify-shipped.sh two-tier resolver and fix SKILL.md's two stale paths | plan Tasks 8 and 9; spec sections 4a and 4d |
| supervisor postcondition | verifyClosing gains shippedVerdicts and parses each fail-closed; the loop reads the per-card verdict file; the closing brief names the file as its oracle | plan Task 10; spec sections 4b and 4c |
| ratchet gate | New pure checkRatchetRevision, thin ratchet-check.ts edge, globbed test-supervisor-ratchet.sh, merge-base comparison, raisedBy shape | plan Task 7; spec section 3 |
| named parsers | Create core/errno.ts and core/escalation.ts, route campaign-state reads through CampaignStateSchema, swap all fourteen error-code sites and three escalation read sites | plan Tasks 6, 14, 15, 16; spec section 5 |
| gap-gate path | readGapGateOpenIds reads the campaign home with no fallback; correct SKILL.md and warchief.md | plan Tasks 11 and 12; spec section 6 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| test-supervisor-ratchet.sh | Swept by pre-gate.sh's glob; a hand-edited unjustified raise in the committed ratchet file turns it red | spec section 3 oracle |
| test-supervisor-e2e.sh probes | A closing session that writes no verdict file must park not exit zero; a well-formed PASS verdict file must exit zero; NEEDS_OWNER.md carries the escalation's own Context text | spec sections 2 and 4 oracles |
| G-004 fingerprint grep | grep for the narrowing text across the runner reaches zero files, measured from two | spec section 5 postcondition |
| core/supervisor/loop.test.ts | readGapGateOpenIds finds a report under the campaign home and does not consult the base tribe home | spec section 6 oracle |
| C3X_MODE=agent c3x check | Validates the ADR and its citations resolve against the current model | this ADR's Verification row |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Author the c3-215 Contract and Change Safety patches in this same Phase 1 task | The code those rows describe does not exist until Phase 2; a patch sealed against absent code is precisely the drift this repo already carries three units of. Deferred to plan Task 13 |
| A new non-retryable ParkReason for a FAIL verdict | The fence freezes ParkReason's 22-value union and PARK_SENTENCES; a FAIL verdict is a true statement about the card, so the honest response is the existing bounded-retry-then-park path |
| Give the gap-gate reader a fallback to the base tribe home | A reader that silently tries a second directory is exactly how the writer and reader drifted apart; one path with no fallback is the only shape that cannot regress |
| Compare the ratchet against the previous commit rather than the merge base | A branch that raises a ceiling then rebases would escape a HEAD~1 check, and a branch merely containing master's history would be flagged for master's own past raises |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Deferring the c3-215 patches lets the model stay stale through Phase 2 | The deferral is a scheduled plan task (Task 13), not an omission; this ADR records the exact rows to insert | c3x change status against this ADR in Phase 2 lists each patch with its target |
| A widened verifyClosing input breaks existing closing behaviour | The new outcome reuses the existing retryable failed path and touches no frozen union; unit tests cover all five verdict rows plus the success path | cd plugins/tribe/scripts/runner and bun test core/supervisor/verify.test.ts |
| The parser refactor silently changes behaviour | Every swap is under a green suite with one named intended difference (errorCode returns null instead of throwing) | cd plugins/tribe/scripts/runner and bun test with the full suite at or above 1068 passing |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash "$C3/bin/c3x.sh" check | ok: true — the new ADR validates and its citations resolve; total entity count recorded in this task's report |
| grep -c "supervisor-hardening" .c3/adr/adr-*.md | at least 1 — the ADR file exists under .c3/adr/ after add |
| cd plugins/tribe/scripts/runner && bun test | at least 1068 passing, 0 failing — the card's ratchet floor, re-measured by plan Task 21 as this ADR's downstream proof |
