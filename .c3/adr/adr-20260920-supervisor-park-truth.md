---
id: adr-20260920-supervisor-park-truth
c3-seal: d1e20245da113c920a382e69f06be1c85e05f02c287fd186f609d091f97e28b0
title: supervisor-park-truth
type: adr
goal: |-
    Record, in the architecture model, the two contract changes card `supervisor-park-truth` landed on
    branch `fix/supervisor-park-truth`: (1) the D3 schema guard's oracle is now the **card branch's own
    commits** — `git diff <mergeSha>^1...<mergeSha>^2` — replacing `baseSha..<remote>/<baseBranch>`, and
    it fails closed on any range it cannot determine; and (2) the campaign supervisor now **reads**
    `<home>/runs/<runId>/run.json` as typed observation facts, so a watchdog terminal is an input the
    disk can overrule, and a park whose stated condition the disk has already falsified is **superseded**
    rather than obeyed. `c3-215`'s Contract and Change Safety rows and
    `adr-20260716-add-campaign-runner`'s `verifyShipped` enforcement row state the superseded behaviour
    today and must be reconciled in the same unit that records the decision.
status: accepted
date: "2026-09-20"
---

## Goal

Record, in the architecture model, the two contract changes card `supervisor-park-truth` landed on
branch `fix/supervisor-park-truth`: (1) the D3 schema guard's oracle is now the **card branch's own
commits** — `git diff <mergeSha>^1...<mergeSha>^2` — replacing `baseSha..<remote>/<baseBranch>`, and
it fails closed on any range it cannot determine; and (2) the campaign supervisor now **reads**
`<home>/runs/<runId>/run.json` as typed observation facts, so a watchdog terminal is an input the
disk can overrule, and a park whose stated condition the disk has already falsified is **superseded**
rather than obeyed. `c3-215`'s Contract and Change Safety rows and
`adr-20260716-add-campaign-runner`'s `verifyShipped` enforcement row state the superseded behaviour
today and must be reconciled in the same unit that records the decision.

## Context

Two independent defects were measured on the first real supervised campaign home
(`~/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening/`) and reproduced end-to-end before
any fix was designed; both are written up in full in
`docs/superpowers/specs/2026-09-20-supervisor-park-truth-design.md` §1.

**G1 — the guard diffed the base branch's own movement.** `core/verify.ts`'s schema guard ran
`git diff <baseSha>..<remote>/<baseBranch>` over the configured schema-lock paths. That range is
"every commit the base branch gained since this card started", not "what this card did", so any
concurrent PR touching a locked path failed the guard for every other card in flight. Measured on
the real repo with card base `45acb45` and PR #160's merge commit `0ca94dc`: the old range reported
five changed `plugins/tribe/scripts/viewer/**` files, every one of which arrived from master-side
PRs #158 and #159 and none of which any commit authored on the card branch touched. The
`0ca94dc^1...0ca94dc^2` range reported empty. The escalation was a false positive that a Shaman
ruling had to overturn by hand while `campaign-state.json` still said `escalated` for a card
`verify-shipped` proved PASS.

**G2/G3/G5 — a park outlived the truth.** The supervisor built its whole picture of the runner from
`watchdog/status.json` alone and never read `<home>/runs/`, which it can read. On the recorded home
it parked `stalled` at 20:30:30Z naming run `…19-29-58-328Z-dcb2`, while `runs/…20-30-30-069Z-6185/run.json`
recorded a newer run holding the very pid the watchdog's own status called alive — a run that went
on to merge PR #160 at 22:47Z and finalise `exitCode: 2, reason: "escalations_pending"`. Row P2 of
the decision table then refused every restart unconditionally (`park(resume_blocked)`), so the stale
park read exactly like a live one until a human deleted the file.

The model states both superseded behaviours as current fact. `c3-215`'s Contract row for
`scripts/runner/run.ts supervise` says exit 20 means "NEEDS_OWNER.md written, deleting it is the
owner's resume signal" — now incomplete, because the supervisor may retire the park itself — and its
write-surface sentence predates the `NEEDS_OWNER.md.superseded-<ts>` rename and the new read of
`<home>/runs/`. Its Change Safety row for "Editing core/supervisor/**" names no park-truth
verification surface. `adr-20260716-add-campaign-runner`'s `verifyShipped` row describes the schema
guard without naming its range at all, while separately asserting the 2-parent requirement that the
new range now mechanically enforces.

## Decision

**The guard's oracle is the card branch's own commits.** After a regular merge — the only kind this
campaign's `mergePolicy` permits — that set is exactly the three-dot diff between the merge commit's
two parents: `merge-base(p1, p2)` is the last base-branch commit the branch had absorbed, so every
base-side change is excluded by construction, while every commit authored on the branch is included,
including work that reached the branch through a sub-branch merge. A first-parent walk
(`git log --first-parent --no-merges`) was rejected for exactly that last property: it would miss a
locked-path change arriving through a sub-branch merge, and under-checking is the direction the
card's oracle calls a bug. The range decision is the pure function `schemaGuardRange` in
`core/verify.ts`; the edge reads the parents with `git rev-list --parents -n 1 <mergeSha>` and hands
them in (`pure-core.md`). It **fails closed** — `passed: false` with an honest detail, never a silent
pass — on an unknown `mergeSha`, a parent list the lookup could not read at all (distinguished from
an empty one, so a broken repository is never reported as a merge-policy violation), a parent count
that is not exactly 2, or a `git diff` that itself exits non-zero. Over-checking by refusing on an
undecidable range is by design; under-checking is not.

**The supervisor reads `runs/` and the disk overrules a stale terminal.** `observe()` lists
`<home>/runs/`, reads each `run.json` through a narrow fail-closed parser that degrades a missing or
malformed record to "no entry" rather than throwing, and returns them ascending by `runId`
(run ids are `<ISO-with-dashes>-<hex>`, so lexicographic order is chronological). Nothing new was
added to the IO adapter: `listEntries`, `readFileOrEmpty` and `isProcessAlive` already covered the
observation. The two questions the card asks are answered by a new **pure** module
`core/supervisor/truth.ts` — `terminalContradiction` ("does the disk contradict this terminal?") and
`parkStillHolds` ("is this park still true?") — with no fs, no clock and no throw. `decide()` gains
one action kind, `supersede_park`; `ParkReason` gains nothing, because superseding is an action, not
a park. Row P2 refuses exactly as before whenever the park still holds — **refusing to resume while a
park is still TRUE is by design** — and only a runner-liveness park (`stalled`) can ever be
superseded, and only when the contradiction is *actionable*: a finalised run always is, a still-alive
newer run only while the one-shot `stale_terminal` re-trigger budget is unspent, so a spent budget
parks for a human instead of churning supersessions forever. A finalised run's own reason is
**translated** from `core/report.ts`'s `ExitReason` vocabulary into the watchdog's terminal-reason
vocabulary (`done` → `runner_done`) before any row is keyed on it, failing closed on an unrecognised
value rather than passing it through. The edge records the supersession — a `park_superseded` line in
`supervisor/events.jsonl`, `NEEDS_OWNER.md` **renamed** to `NEEDS_OWNER.md.superseded-<ts>` (never
deleted, so the owner's own document survives as the audit trail), `counters.staleTerminals`
incremented on the supervisor's own `status.json` — and continues the loop instead of exiting 20.
`campaign-state.json` and `campaign-report.json` are untouched; their shape is owner-only.

This unit carries three block patches reconciling the three rows the two changes falsify, and nothing
else: `c3-215`'s Contract row for `supervise`, `c3-215`'s Change Safety row for "Editing
core/supervisor/**", and `adr-20260716-add-campaign-runner`'s `verifyShipped` enforcement row.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Contract row for scripts/runner/run.ts supervise states an exit-20 contract the supervisor no longer keeps unconditionally ("deleting it is the owner's resume signal"), omits the NEEDS_OWNER.md.superseded-<ts> rename from the write surface, and omits <home>/runs/<runId>/run.json from the observation inputs entirely | c3-215#n1960@v1:sha256:a6f5b0e592fa68e4ba8014ad5f62214f41153de6a5d51c78fc6148c54a1d6deb "Contract" | Patch 01 rewrites that one row: reads vs writes stated separately (runs/ and watchdog/ are read, never written), the supersession rename named, exit 20 qualified by the park-still-holds predicate |
| c3-215 | component | Its Change Safety row for "Editing core/supervisor/**" names decide.test.ts and the e2e/kill suites, but not core/supervisor/truth.ts's predicates nor plugins/tribe/scripts/tests/test-supervisor-park-truth.sh — the suite that pins both directions of the card's oracle | c3-215#n1982@v1:sha256:a809e4964c497ae1e305200178f46892a76d8d4a735091d2c21c558538c3ef6b "Change Safety" | Patch 02 rewrites that one row: truth.ts added to the trigger, truth.test.ts to the detection, the park-truth shell suite (including its mandatory negative probe) to the required verification |
| adr-20260716-add-campaign-runner | N.A - a change doc, not a system/container/component | Its Enforcement Surfaces row for verifyShipped says "the schema guard is clean" without naming the range, so a reader cannot tell the stale baseSha..<remote>/<baseBranch> oracle from the new one; the same row already claims the 2-parent requirement that the new range now enforces mechanically | adr-20260716-add-campaign-runner#n191@v1:sha256:6e65cd9051116b1d49161a89c473c2f1eef99360b80f10386e4dbff098ac2edd "Enforcement Surfaces" | Patch 03 rewrites that one row: the range spelled out, the old range named as superseded, the fail-closed directions enumerated, and the stale evidence path corrected to core/verify.test.ts |
| c3-2 | container | Named for top-down completeness only. The container's own responsibilities and membership are unchanged: both changes live inside files c3-215 already owns (plugins/tribe/scripts/runner/**), and no plugin boundary, installable, or component moved | c3-2#n1910@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content: the 2 installable plugins" | Parent Delta: none — no patch; c3-2's Components table is synthesized from parent links and no parentage changed |
| c3-0 | system | Named for top-down completeness only. The delivery outcome the system promises — regular-merged, evidenced, independently re-verified PRs — is unchanged; this card makes the existing guard measure the right commits and the existing park tell the truth | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem" | Parent Delta: none — no patch; the system's goal statement is untouched by both changes |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-docs-lifecycle | This card's What/Why and How live as dated documents under docs/superpowers/ — the design spec and the implementation plan this unit's Context and Decision both cite — so the ref governs where every artifact of the card sits and how a later reader finds them | ref-docs-lifecycle#n2110@v1:sha256:efa0389ac6fce142eaa954880c31388c79313347d00430eeca0bf713cfd84570 "Choice" | comply — docs/superpowers/specs/2026-09-20-supervisor-park-truth-design.md and docs/superpowers/plans/2026-09-20-supervisor-park-truth.md, both carrying the YYYY-MM-DD-<slug> prefix in the filename rather than relying on git history |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-one-parser-per-edge-shape | The supervisor now reads one more external shape at its edge — <home>/runs/<runId>/run.json — and this rule requires exactly one named parser for it, imported by every read site rather than re-derived inline | rule-one-parser-per-edge-shape#n2250@v1:sha256:62845f31a2fe00be3ebaaeb93f5b27af82ab81dfcbaa1871c76f596cd98cf3c9 "Rule" | comply — core/supervisor/loop.ts#parseRunFact is that single narrow reader, sitting alongside the file's existing parseWatchdogStatusFacts and parseCampaignReportFacts, and observe() is its only call site |
| rule-no-squash-merge | The guard's new range IS this rule's enforcement point: it is derived from the merge commit's two parents, so a squash or rebase-merge leaves no anchor and the guard refuses outright. The rule stops being an assertion in an ADR and becomes the precondition of a check that runs on every shipped card | rule-no-squash-merge#n2228@v1:sha256:62845f31a2fe00be3ebaaeb93f5b27af82ab81dfcbaa1871c76f596cd98cf3c9 "Rule" | comply — patch 03 records that the 2-parent requirement is now mechanically enforced by the range decision rather than only by the separate parent-count point |
| rule-bash-strict-mode | The card adds one new shell surface, plugins/tribe/scripts/tests/test-supervisor-park-truth.sh, which patch 02 records as a required verification surface for core/supervisor/** | rule-bash-strict-mode#n2139@v1:sha256:62845f31a2fe00be3ebaaeb93f5b27af82ab81dfcbaa1871c76f596cd98cf3c9 "Rule" | comply — the new suite follows the repo's existing test-supervisor-e2e.sh shape (same strict-mode preamble, same ok/bad/check helpers, same PASS/FAIL counting, non-zero exit when FAIL > 0) |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| schemaGuardRange (core/verify.ts, pure) | Decides the guard's range from { mergeSha, parents } alone and returns refuse — never a range — for a null mergeSha, an unreadable parent list, or a parent count other than 2; the caller turns every refusal into passed: false with the refusal's detail | plugins/tribe/scripts/runner/core/verify.test.ts — both directions on REAL git repositories built in temp dirs: master-side locked-path movement PASSES, a card-branch-authored locked-path commit FAILS |
| terminalContradiction / parkStillHolds (core/supervisor/truth.ts, pure) | Answer the card's two questions over an observation with no fs, clock or throw; parkStillHolds returns true for every park reason that is not a runner-liveness claim, and for a stalled park whose contradiction is no longer actionable | plugins/tribe/scripts/runner/core/supervisor/truth.test.ts — case per input, including a park that still holds and a spent re-trigger budget |
| plugins/tribe/scripts/tests/test-supervisor-park-truth.sh | Drives the real run.ts supervise composition root on real campaign homes for all four directions: G2 (newer run alive must not park), G5 (finalised run decides from its own reason), G3 (a falsified park is superseded, leaving exactly one NEEDS_OWNER.md.superseded-* file) and the mandatory negative probe (a park that IS still true must still refuse with resume_blocked and leave NEEDS_OWNER.md in place) | The suite was RED on base d77cecc — G2/G5/G3 not ok, the negative probe ok, non-zero exit — and is green on the card branch |
| plugins/tribe/scripts/tests/test-supervisor-docs.sh | Keeps the runner README's supervisor sections in step with the CLI's own parser and file layout, so the decision table and the flag tables cannot drift silently | bash plugins/tribe/scripts/tests/test-supervisor-docs.sh — 43 passed, 0 failed |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the guard on baseSha..<remote>/<baseBranch> and let the Shaman overturn the false positives by hand | That is what happened on PR #160, and it cost a hand-authored ruling while campaign-state.json still said escalated for a card verify-shipped had proved PASS. The guard exists to be mechanical; a check whose failures are routinely overturned is worse than no check |
| Anchor the guard on baseSha...mergeSha (the shape the card's own Why section first cited) | Measured on the real repo: it reports the same 5 master-side viewer files as the old range, so it fixes nothing (spec §1.1's table) |
| Anchor on merge-base(<remote>/<baseBranch>, prHead) | After the card merges, the base branch CONTAINS the PR head, so the merge base is the head itself and the diff is unconditionally empty — the guard would become a silent no-op, the worst possible direction for an under-check |
| Walk the branch's own commits with git log --first-parent --no-merges | It silently misses a locked-path change that reached the branch through a sub-branch merge. That is an under-check, and the card's oracle names under-checking as the bug direction |
| Let the supervisor DELETE NEEDS_OWNER.md when it supersedes a park | The file is the owner's own document and the only prose record of what was asked. Renaming to NEEDS_OWNER.md.superseded-<ts> keeps the audit trail and still clears row P2, at the cost of one filename |
| Supersede any park whose watchdog terminal the disk contradicts, regardless of reason | Over-broad in the direction the card's oracle protects: "refusing to resume while a park is still TRUE is by design". Only stalled — a claim about a RUNNER being alive — is a claim a run record can falsify; an owner-only escalation or a spent budget is not |
| Supersede on any contradiction, without the actionability test | Measured during implementation: with the re-trigger budget spent, the next tick re-derived the same stalled reason and re-parked with a fresh NEEDS_OWNER.md, forever — a trail of park_superseded events that read as "the campaign continued" while nothing was investigated |
| Substitute a finalised run's own reason into decide() raw | The two vocabularies differ: run.json spells success done, the watchdog's terminal vocabulary spells it runner_done. Substituting raw made a campaign that had just SUCCEEDED fall past every row into the residual park('error') backstop |
| Widen ParkReason with a catch-all, or add a superseded park reason | The card permits only additive, specific ParkReason entries, and superseding is an ACTION the supervisor takes, not a state it parks in. The union is left untouched |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The new range under-checks and lets a card-authored locked-path change ship | The three-dot diff between the two parents includes every branch-authored commit by construction, including work merged in from a sub-branch — the property that disqualified the first-parent walk | core/verify.test.ts builds a REAL repository whose card branch itself commits to locked/ and asserts the guard FAILS; the sibling test asserts master-side movement PASSES |
| A repository state the guard cannot read silently passes the check | Every undecidable input returns refuse, and the git diff exit code is checked explicitly — a failed three-dot diff leaves stdout empty, which an unchecked exit code would read as "ran and found nothing" | core/verify.test.ts covers null mergeSha, unreadable parents, a non-2 parent count, and a non-zero diff exit |
| Supersession churns: a park is superseded every restart and immediately re-parked | parkStillHolds requires the contradiction to be ACTIONABLE — a finalised run always is, a live newer run only while the one-shot stale_terminal budget is unspent — so an exhausted supervisor parks for a human instead of looping | truth.test.ts pins the spent-budget case as "park still holds"; the park-truth shell suite's negative probe pins that a still-true park still refuses |
| A malformed or partially written run.json takes down the tick loop | parseRunFact is a narrow fail-closed reader: a JSON error, a non-object, or a missing field degrades that record to "no entry", never a throw into the loop | loop.test.ts drives a fake seam with a malformed run.json and asserts no entry and no throw |
| An inconclusive run record (dead pid, no endedAt) masks a genuinely alive run behind it | The contradiction scan takes the newest run that is ALIVE before the newest that has FINALISED, over every candidate at or after the watchdog's own runId — liveness outranks inconclusiveness | truth.test.ts covers a multi-run home where an inconclusive record sits newer than a live one |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash c3x.sh change apply adr-20260920-supervisor-park-truth | applies atomically — three block patches, no drift |
| C3X_MODE=agent bash c3x.sh check | total 63, ok: true |
| grep -rn "baseSha\.\.\$\{\?config\.remote" .c3/ plugins/tribe/scripts/runner/README.md | no match — no doc or fact still describes the old range |
| bash plugins/tribe/scripts/tests/test-supervisor-docs.sh | 43 passed, 0 failed |
| cd plugins/tribe/scripts/runner && bunx tsc --noEmit | exit 0, no output — this unit changes no TypeScript |
