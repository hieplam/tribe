---
id: adr-20260730-scout-ruling-loop
c3-seal: 38cfb4514f82eda52975f13b24910067ffcc6d0274a25ac2425c8c171f78aeb6
title: scout-ruling-loop
type: adr
goal: |-
    Extend `c3-215`'s (tribe) Contract and Business Flow to record CU-3's scout ruling loop: five new
    capability surfaces — `plugins/tribe/scripts/gaps/gap-rule.ts` (the sole writer of `ruled` events
    and debt entities, five ordered crash-safe steps), `plugins/tribe/scripts/gaps/debt-count.ts` (a
    STRONG PR gate: `--diff <base>` exits non-zero on any positive delta), `plugins/tribe/scripts/gaps/debt-backfill.ts`
    (idempotent post-merge issue creation), the debt entity instance location
    (`.c3/documents/debt/debt-<slug>.md`, target-repo-only), and the shipped canvas
    `plugins/tribe/canvases/debt.md` (Scout self-provisions it) — plus the closed ruling loop itself
    as a Business Flow row: gap → Scout proposal → owner/Shaman ratification → rule/anti-rule/debt →
    grandfathered enforcement → burn-down to zero. Record this as a checkable fact in `c3-215` because
    nothing in its current Contract or Business Flow names any of these five surfaces or the closed
    loop — CU-2's own ADR (`adr-20260727-harness-gap-detection`, patches still pending) only reached
    "a human reads the PR body"; without this record a later prompt edit could silently reintroduce
    agent-side ruling writes, or the debt burn-down gate could be removed with nothing in the
    component's canonical doc to catch it.
status: superseded
date: "2026-07-30"
---

## Goal

Extend `c3-215`'s (tribe) Contract and Business Flow to record CU-3's scout ruling loop: five new
capability surfaces — `plugins/tribe/scripts/gaps/gap-rule.ts` (the sole writer of `ruled` events
and debt entities, five ordered crash-safe steps), `plugins/tribe/scripts/gaps/debt-count.ts` (a
STRONG PR gate: `--diff <base>` exits non-zero on any positive delta), `plugins/tribe/scripts/gaps/debt-backfill.ts`
(idempotent post-merge issue creation), the debt entity instance location
(`.c3/documents/debt/debt-<slug>.md`, target-repo-only), and the shipped canvas
`plugins/tribe/canvases/debt.md` (Scout self-provisions it) — plus the closed ruling loop itself
as a Business Flow row: gap → Scout proposal → owner/Shaman ratification → rule/anti-rule/debt →
grandfathered enforcement → burn-down to zero. Record this as a checkable fact in `c3-215` because
nothing in its current Contract or Business Flow names any of these five surfaces or the closed
loop — CU-2's own ADR (`adr-20260727-harness-gap-detection`, patches still pending) only reached
"a human reads the PR body"; without this record a later prompt edit could silently reintroduce
agent-side ruling writes, or the debt burn-down gate could be removed with nothing in the
component's canonical doc to catch it.

## Context

`c3-215`'s current Contract table (`.c3/c3-2-plugins/c3-215-tribe.md`, 11 rows ending at
`scripts/migrate-campaign-home.sh`) and Business Flow table (5 rows ending at `Unattended path`)
still reflect only what has actually been *applied* to the canonical doc: CU-2's detection surface
(`gap-reconcile.ts`, `gap-precision.ts`, Tracker's `### Harness gaps` report) exists only as an
unapplied work order (`adr-20260727-harness-gap-detection`) — the canonical file itself has no
`gap-reconcile.ts` row and no ruling-loop row. The one change-unit that HAS actually landed on
`c3-215` since (`adr-20260730-global-rules-snippet`, commit `784309b`) only touched the
`Global CLAUDE.md append` Contract row and the Governance/Derived-Materials sections; it did not
touch Contract's or Business Flow's true last rows, so their content — and therefore their
sha256 — is unchanged from what CU-2's own ADR cited, confirmed fresh this session (see Decision).

CU-3 (`docs/superpowers/specs/2026-07-29-tribe-scout-ruling-loop-design.md`, plan
`docs/superpowers/plans/2026-07-30-tribe-scout-ruling-loop.md`, Tasks 1-8 already committed on
this branch — `5cc1837`, `05aad43`, `1af6a44`, `b151521`, `bee78f2`, `4c557b4`, `0d73f2e`,
`94be9af`) closes the loop CU-2 left dead-ended: no writer existed for `ruled` events, no entity
type recorded "debt", no countdown, no grandfathering. Implemented on this branch:
`ledger.ts` gained `ratified_by`; `debt-entity.ts` (pure parser: frontmatter + `## Meter` table
row → `DebtEntity`) and `debt-tree.ts` (git-tree IO: `listDebtEntities`, `runCheck` via validated
`git grep`) modules; `gap-rule.ts` (CLI: sole ruling writer, refuses on an unknown gap, an
already-ruled gap, `rule`/`anti-rule`/`debt` without an existing `--ref` rule file, a `--check`
containing shell metacharacters, a zero-hit or erroring check, or any stray `.c3/` file changed by
the `c3` CLI it drives — appends the `ruled` event only after entity creation succeeds, so a
crash mid-ruling never leaves an event with no entity); `debt-count.ts` (snapshot `+` `--diff`
burn-down gate: `now > baseline` → `harness-leak`, `now == 0` → `closable`, **exit 1 iff any delta

> 0**); `debt-backfill.ts` (`selectMissing`/`issueBody` pure core; `gh issue create` at the thin
> edge; `--gh-bin` absent → no-op, exit 0); `plugins/tribe/canvases/debt.md` (shipped canvas
> definition) plus `install.sh`/`plugins/tribe/install.sh` wiring that mirrors the `rules/` shipping
> `adr-20260728-purity-golden-standard` added (root `install.sh`'s case whitelist now reads
> `agents|skills|claude-md|hooks|rules|canvases|.claude-plugin`; the plugin hook symlinks
> `canvases/*.md` into `$CLAUDE_DIR/canvases/` the same way it symlinks `rules/*.md`);
> `scout.md` gained the write role (governance artifacts only — rules and rulings via CLIs; never
> edits, stages, or commits source code, never hand-writes a registry line or a
> `.c3/documents/debt/` file) and an `## Adjudication duty` (owner ratifies attended sessions;
> unattended campaigns escalate to the Shaman — Scout never self-ratifies, never contacts the
> owner); `warchief.md` gained the debt gate (`debt-count.ts --diff <merge-base>`: non-zero exit
> blocks the PR and routes `new_hits` to a Hunter, never argued down), the backfill step, the
> closable-close step (`c3 set <id> status closed`), and a planning-time debt read (a plan that
> designs in a blacklisted pattern is defective); `tracker.md` gained the grandfathering read
> (`.c3/documents/debt/`, read-only) and the `tracked in <debt-id>` non-blocking note format for a
> pre-existing occurrence inside a debt entry's recorded scope, vs. an ordinary Blocker for a new
> one. Six new adversarial eval cases (38-43) plus case 21's stack-neutral rewrite exist in
> `plugins/tribe/evals/evals.json` (43 cases total, verified `python3 -c "import json; ..."` →
> `43 43`).

`c3-215` is a canonically sealed, frozen fact — direct mutation (`wire`/`set`/hand-edit) is
refused by design; only the change-unit flow (`c3x change new/apply`) is a legal path to record
any of this.

## Decision

Patch `c3-215` via this change-unit's two block patches
(`.c3/changes/adr-20260730-scout-ruling-loop/`): (1) Contract gains rows for `gap-rule.ts` (sole
ruling writer; the five ordered crash-safe steps; every refusal named), `debt-count.ts`
(burn-down snapshot + `--diff` gate; STRONG — non-zero exit on any positive delta blocks the PR),
`debt-backfill.ts` (idempotent post-merge issue creation; `gh`-absent no-op), the debt entity
instance location (`.c3/documents/debt/debt-<slug>.md`, target-repo-only, mirroring the
"instances are CLI-only" precedent Contract already states for the campaign runner and CU-2's
own registry), and the shipped canvas `plugins/tribe/canvases/debt.md` + Scout's self-provision
step (`c3 canvas add debt --file <plugin-root>/canvases/debt.md`); (2) Business Flow gains a
"Scout ruling loop, closed" row: gap opened/seen by `gap-reconcile.ts` (unchanged) → Scout
adjudicates into a disposition proposal (`rule`/`anti-rule`/`debt`/`dismissed`/
`dismissed-duplicate`) → owner ratifies attended, Shaman ratifies unattended (Scout never
self-ratifies, never contacts the owner) → Scout executes `gap-rule.ts`, now the sole ruling
writer (supersedes CU-2's own pending row, which only reached "a human reads the PR body") → a
ratified `rule`/`anti-rule` feeds Tracker's normal rule-checking path; a ratified `debt` entry
becomes a blacklist entry Tracker grandfathers (a pre-existing occurrence inside its recorded
scope gets one non-blocking `tracked in <id>` note, a new occurrence stays an ordinary violation)
while `debt-count.ts --diff` blocks any PR that grows a debt entry's hit count and
`debt-backfill.ts` opens a tracking issue post-merge → the entity closes
(`c3 set <id> status closed`) when its count reaches zero, completing the burn-down the owner's
target image describes.

Both patches are `scope: block`, based on the current true last row of each section, confirmed
fresh via `c3 read c3-215 --section <name> --cite` in this session: Contract anchors on
`c3-215#n1271` (`scripts/migrate-campaign-home.sh`, sha256
`1a61541efe10a73b572cb707f30b19b51c0639073dbeed30236cc3ea8e54d77b`), Business Flow on
`c3-215#n1249` (`Unattended path`, sha256
`5cab0d63685ee38f3deb8a93272258dee9c326322b000050ced77ead11f6aa7f`) — both shas are byte-identical
to the anchors CU-2's own (still-unapplied) ADR cited, confirming neither row's content has
drifted even though the underlying node numbers were renumbered by the one intervening apply
(`adr-20260730-global-rules-snippet`, commit `784309b`, which touched only the `Global CLAUDE.md
append` Contract row). Each patch body is the cited row byte-identical, followed by the new
row(s), so applying remains a pure append at the table's true end, never a rewrite of existing
content.

No `ref-plugin-layout` patch is authored in this change-unit even though
`plugins/tribe/canvases/` is a new shipped component directory (mirroring `rules/`, and root
`install.sh`'s whitelist already carries `canvases` alongside `rules`): the brief and plan Task 9
scope this change-unit's patches to `c3-215` only — two files, mirroring CU-2's own two-file
precedent — not the wider topology. `ref-plugin-layout` already carries an equivalent,
still-unapplied gap for `rules/` from `adr-20260728-purity-golden-standard`'s patches 01-03;
`canvases/` joins that same deferred backlog rather than being patched piecemeal by this
change-unit (recorded below under Compliance Refs and Affected Topology, not forced into a patch
file that would exceed this task's scope).

`c3x change apply` is deliberately NOT run: this repo's known c3x v11.0.0 defect (project memory
`c3x-change-apply-defect` — `check`/`repair` delete pending patch material before `apply`'s
drift/canvas-valid gates can run) is the same defect class CU-2's and the purity-golden-standard
ADRs already accepted; ten of the eleven pre-existing `.c3/changes/*/` change-units still sit
unapplied for the identical reason (only `adr-20260730-global-rules-snippet` has been applied).
The patches land as a work order for a future session with a working CLI to apply.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Contract gains 4 new IN/OUT rows (gap-rule.ts, debt-count.ts, debt-backfill.ts, the debt-entity location + shipped canvas); Business Flow's ruling-loop row is superseded by the closed loop | c3-215#n1225@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command — Shaman (What/Why) → Warchief (How) → Hunter (TDD execution), gated by Tracker (rules review) and Ski" | Parent Delta: updated — this change-unit's two block patches (below); rule-bash-strict-mode + rule-stack-agnostic-agent-prompts + rule-no-squash-merge reviewed below |
| c3-2 | container | Parent of c3-215; no membership or directory-layout change — scripts/gaps/{gap-rule,debt-count,debt-backfill,debt-tree}.ts and canvases/debt.md live inside the existing tribe plugin, not a new top-level plugin. Included for top-down completeness | c3-2#n931@v1:sha256:f92a1cfb53ada54dba5f5c1154ccef3423fe08276ff6ec199cc745be16f8d3d0 "Claude Code runtime content: the 9 installable plugins — agents and skills that, once symlinked into ~/.claude, extend every Claude Code session with delive" | Parent Delta: none — no new plugin, no container-contract change |
| c3-101 | component | Root install.sh's component-type whitelist gained canvases alongside the already-pending rules (case statement now agents | skills | claude-md |
| c3-0 | system | Top-down completeness only: the system ancestor of the affected component. No new top-level installable surface (canvases ship through the existing tribe plugin's install hook, the same mechanism rules/ already uses) | c3-0#n2@v1:sha256:d21dc72fe385cb42ca0b79273dbc1b309b5d308a10754974395b20c7fd30fcc0 "Package Todd Lam's personal Claude Code agents and skills as installable plugins, keep the repo the single source of truth via symlink installs, and benchmark e" | None |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-evals-fixture | plugins/tribe/evals/evals.json gained six new agent-kind cases (ids 38-43) plus case 21's rewrite; the shared fixture format (id/name/agent/prompt/expected_output) is unchanged | ref-evals-fixture#n1448@v1:sha256:f721836fe1202e2368d7d811c32d640cfc55f26882336819d9735bc3a9dbfd04 "One eval fixture format for every skill and agent in the repo, so a single runner can benchmark all of them and results are comparable across plugins. The recur" | comply |
| ref-plugin-layout | plugins/tribe/canvases/ is a new shipped component directory, extending the ref's closed list exactly as rules/ did — but that extension (adr-20260728-purity-golden-standard's patches 01-03) is itself still unapplied to the ref's canonical Choice/Why/How text; this change-unit does not author a further patch here (scoped to c3-215 only, per brief/plan Task 9) | ref-plugin-layout#n1459@v1:sha256:746cee9fc8b862ca0c7baf82b2f1b47b0cd7295737bee04abfb69a030adb353d "A plugin is a directory under plugins/<name>/ containing .claude-plugin/plugin.json (name, description, version) plus any of exactly these component directo" | review — no patch authored this change-unit; canvases/ joins rules/'s existing deferred gap, a named follow-up |
| ref-docs-lifecycle | This ADR plus its committed patch files are the durable work order (c3x change apply deferred, see Risks); the spec + plan files are already the paper trail for the code work | ref-docs-lifecycle#n1438@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail — designs, implementation plans, and proof artifacts must outlive the chat session that produced them. The re" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-bash-strict-mode | install.sh and plugins/tribe/install.sh were edited (Task 5, canvases mirroring rules/) and plugins/tribe/scripts/tests/test-install-canvases.sh was added — all shell, all keep the set -euo pipefail preamble | rule-bash-strict-mode#n1469@v1:sha256:7a8c286269da63a2ba7b7362b72631a2491addb28a1a4266304605106dbaba9a "All shell scripts start with #!/usr/bin/env bash followed by set -euo pipefail." | comply |
| rule-stack-agnostic-agent-prompts | scout.md, warchief.md, tracker.md were edited (Tasks 6-7) to add the write role, adjudication duty, debt gate, backfill, and grandfathering read; all edits use stack-neutral language (grep/git grep as illustration only, no toolchain-specific commands) | rule-stack-agnostic-agent-prompts#n1523@v1:sha256:a1a20b05de21d6ac887a4e6fcc020b0fde876fc17aed7fabaad35e79ece9cb2e "Agent prompt files (plugins//agents/.md) never hardcode a language name, toolchain command," | comply |
| rule-no-squash-merge | Delivered as one PR per the plan; merge shape (regular, 2-parent) governs whenever it is merged — no agent merges this change-unit's PR | rule-no-squash-merge#n1501@v1:sha256:de99ab791d8de56b2db0a2df30884e92d9f70603716a1384a6965aa0c922273a "A merged PR's merge commit has exactly 2 parents; no capability merges with --squash or" | comply (deferred to merge time, owner-only) |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| .c3/changes/adr-20260730-scout-ruling-loop/01-contract-ruling-surface.patch.md | Block patch, base c3-215#n1271 (scripts/migrate-campaign-home.sh, the table's true last row): appends 4 Contract rows (gap-rule.ts, debt-count.ts, debt-backfill.ts, debt-entity location + shipped canvas) at the end | diff of the file (this change-unit) |
| .c3/changes/adr-20260730-scout-ruling-loop/02-business-flow-closed-loop.patch.md | Block patch, base c3-215#n1249 (Unattended path, the table's last row): appends the "Scout ruling loop, closed" row after it | diff of the file (this change-unit) |
| c3-215 (tribe component doc) | Contract + Business Flow gain the rows above — applied via the change-unit flow (c3x change apply) once the c3x check/repair broken-material defect is fixed; deferred, not applied by this session | c3x change view adr-20260730-scout-ruling-loop (patches listed pending) |
| plugins/tribe/scripts/gaps/{gap-rule,debt-count,debt-backfill,debt-tree,debt-entity}.ts + tests | Already implemented and committed (Tasks 1-4: 5cc1837, 05aad43, 1af6a44, b151521) — this ADR records the fact, does not implement it | cd plugins/tribe/scripts/gaps && bun test && bunx tsc --noEmit |
| plugins/tribe/canvases/debt.md + install wiring | Already implemented and committed (Task 5: bee78f2) | bash plugins/tribe/scripts/tests/test-install-canvases.sh |
| plugins/tribe/agents/{scout,warchief,tracker}.md | Already implemented and committed (Tasks 6-7: 4c557b4, 0d73f2e) | grep evidence per each task's own verify step |
| plugins/tribe/evals/evals.json | Already implemented and committed (Task 8: 94be9af) | python3 -c "import json; d=json.load(open(...)); ..." → 43 43 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI, validator, schema, template, or help text is touched by this ADR | N.A - it uses the existing change-unit primitives (two block patches to a frozen component's Contract/Business-Flow sections) exactly as documented by c3x change --help | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| cd plugins/tribe/scripts/gaps && bun test && bunx tsc --noEmit | Re-runs all §10a scenarios (gap-rule.ts: 11, debt-count.ts: 8, debt-backfill.ts: 4, plus Task 1's ledger/debt-entity/fingerprint scenarios) — the correctness gate every downstream ruling and burn-down number stands on | run output captured on this branch (Tasks 1-4 commits 5cc1837, 05aad43, 1af6a44, b151521) |
| bash plugins/tribe/scripts/tests/test-install-canvases.sh | Confirms the shipped canvas lands where install puts shipped assets, mirroring test-install-rules.sh's assertions | Task 5 commit bee78f2 |
| scripts/evals/run_evals.py --evals plugins/tribe/evals/evals.json --eval-id 5,21,29,35,36,37,38,39,40,41,42,43 | Confirms Tracker/Warchief/Scout regressions stay green (cases 5, 21, 29, 35-37) alongside the six new adjudication-loop behaviors (38-43) | to be captured in the PR description (Task 9's final verification step) |
| c3x change view adr-20260730-scout-ruling-loop | Confirms both patches are recorded as pending change material against c3-215, ready for a future c3x change apply once the broken-material defect is fixed | command output |
| git status --short -- .c3/ (run immediately after every c3 add in this session) | Confirms no canonical .c3/ content was corrupted as a side effect of authoring this ADR (documented c3x add side effect) | command output captured in this change-unit's Hunter report |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hand-edit c3-215-tribe.md directly with the new Contract/Business-Flow rows instead of authoring patches | c3-215 is a canonically sealed, frozen fact; direct mutation is refused by design — only c3x change apply may write it, and hand-editing would fabricate a canonical state no change-unit ever recorded |
| Also patch ref-plugin-layout for canvases/ in this same change-unit, since it mirrors rules/'s still-pending patches | The brief and plan Task 9 explicitly scope this change-unit's patches to c3-215 (two files, mirroring CU-2's own two-file precedent); widening scope to a second target document is exactly the over-building the Hunter contract forbids — recorded instead as a named, deferred gap under Compliance Refs |
| Force a debt canvas c3 entity or a Governance-table row for a new rule-* doc | Neither is created by this change-unit's spec §9 file-change inventory: the canvas is a plugin-shipped markdown asset (already committed, Task 5), not a c3 canvas/rule the ADR's own Governance section would cite — forcing one would fabricate a rule/canvas that does not exist in .c3/ |
| Wait to author the ADR until the c3x check/repair broken-material defect is fixed and c3x change apply can run in the same session | The plan's Task 9 explicitly requires authoring the ADR + patches as a committed work order now and deferring apply — waiting would block the PR indefinitely on a pre-existing, already-tracked tooling defect unrelated to this change-unit's own content |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Patches never get applied because the c3x check/repair broken-material defect is never fixed, so c3-215 permanently drifts from the code it now governs | Same accepted risk this repo already carries for ten prior change-units sitting unapplied in .c3/changes/ for the identical reason (only adr-20260730-global-rules-snippet has landed); the work order (ADR + patches) is the durable record either way, independent of when/if apply runs | git log -- .c3/changes/ shows the growing backlog; project memory c3x-change-apply-defect names the defect explicitly |
| A patch authored against a stale cache read anchors mid-table instead of at the true end, and the discrepancy goes unnoticed | Re-ran c3 read c3-215 --section Contract --cite / --section "Business Flow" --cite fresh in this session (after the intervening adr-20260730-global-rules-snippet apply, commit 784309b, had already renumbered every node) and confirmed both anchors' sha256 are byte-identical to the values CU-2's own ADR cited before authoring either patch | c3 read c3-215 --section Contract --cite / --section "Business Flow" --cite output captured in this change-unit's Hunter report, showing 11/11 Contract rows (n1271 last) and 5/5 Business Flow rows (n1249 last) |
| Running c3 check/c3 repair to try to fix the broken-material defect deletes pending patch material as a documented side effect | Not run in this session; git status --short -- .c3/ was checked immediately after every c3 add per the plan's Global Constraints, and would have caught any stray deletion before commit | git status --short -- .c3/ output captured in this change-unit's Hunter report |

## Verification

| Check | Result |
| --- | --- |
| c3 schema adr (this session's c3() shell function wrapping c3x.sh) | Rendered the ADR canvas contract without error — captured in this session |
| git status --short -- .c3/ && git diff --stat -- .c3/ (run immediately after c3 add adr) | Only the new ADR file appeared as untracked/new; no stray canonical file was modified or deleted — captured in this change-unit's Hunter report |
| c3 read c3-215 --section Contract --cite / --section "Business Flow" --cite | Base anchors used by the two patches (n1271, n1249 — each the table's confirmed-current last row) present and byte-matching current canonical content before authoring either patch |
| c3x change apply adr-20260730-scout-ruling-loop | Deliberately NOT run this session (known c3x v11.0.0 defect blocks check/repair from completing before apply's gates can run); deferred to a future session per the plan's Task 9 instruction |
