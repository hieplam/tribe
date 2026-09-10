---
id: adr-20260727-harness-gap-detection
c3-seal: 16586691468db05b0e784a23d554766ae60dd49c049cf93ffd5d08d59608daa9
title: harness-gap-detection
type: adr
goal: |-
    Extend `c3-215`'s (tribe) contract and business flow to cover CU-2's tracker harness-gap
    detection: Tracker's per-diff review gains a read-only, stateless `### Harness gaps` report
    section (a candidate gap is never a Blocker/Should-fix/Optional finding — it is the checkable
    fact "no written rule covers this pattern"), and a new script pair
    `plugins/tribe/scripts/gaps/{gap-reconcile.ts,gap-precision.ts}` becomes the sole write-capable
    sink: `gap-reconcile.ts` is the only writer of a new append-only registry,
    `.tribe/harness-gaps.jsonl`, that lives in the *target* repo (never in this repo, mirroring the
    campaign runner's own state-in-target-repo precedent already in `c3-215`'s Contract). Record this
    as a checkable fact in `c3-215` because nothing in its current Contract or Business Flow
    authorizes a second write-capable script surface or a human ruling loop, and a future agent-prompt
    edit could otherwise silently reintroduce agent-side registry writes with nothing to catch it.
status: superseded
date: "2026-07-27"
---

## Goal

Extend `c3-215`'s (tribe) contract and business flow to cover CU-2's tracker harness-gap
detection: Tracker's per-diff review gains a read-only, stateless `### Harness gaps` report
section (a candidate gap is never a Blocker/Should-fix/Optional finding — it is the checkable
fact "no written rule covers this pattern"), and a new script pair
`plugins/tribe/scripts/gaps/{gap-reconcile.ts,gap-precision.ts}` becomes the sole write-capable
sink: `gap-reconcile.ts` is the only writer of a new append-only registry,
`.tribe/harness-gaps.jsonl`, that lives in the *target* repo (never in this repo, mirroring the
campaign runner's own state-in-target-repo precedent already in `c3-215`'s Contract). Record this
as a checkable fact in `c3-215` because nothing in its current Contract or Business Flow
authorizes a second write-capable script surface or a human ruling loop, and a future agent-prompt
edit could otherwise silently reintroduce agent-side registry writes with nothing to catch it.

## Context

`c3-215`'s current Contract table (`.c3/c3-2-plugins/c3-215-tribe.md`) enumerates every
capability surface Tracker/Warchief/the runner expose — `scripts/runner/run.ts`,
`skills/orchestrate-campaign`, `scripts/doctor.sh`, `scripts/viewer/serve.ts`,
`scripts/migrate-campaign-home.sh` — but has no row for a second registry-owning script, and its
Business Flow table's five rows (Outcome, Primary path, Alternates, Failure behavior, Unattended
path) describe the card-delivery loop only, with no ruling loop for an artifact a human disposes
of outside a PR-merge decision.

CU-2 (`docs/superpowers/specs/2026-07-27-tribe-harness-gap-detection-design.md`,
`docs/superpowers/plans/2026-07-27-tribe-harness-gap-detection.md`, Tasks 1-5, already landed on
this branch — commits `976f733`, `526ed10`, `a975859`, `9d87f21`, `cb85676`) implemented this
surface: `plugins/tribe/scripts/gaps/ledger.ts` (pure event/fold/minting module),
`gap-reconcile.ts` (the CLI: `--registry --changed-files --candidates`; matches an OPEN registry
entry by executing its frozen `grep` fingerprint restricted to the changed files — never by
comparing prose — mints `G-NNN` for unmatched candidates, suppresses anything already `ruled`),
and `gap-precision.ts` (`--registry [--window 20]`, a computed-never-claimed metric). Both are
covered by `gap-reconcile.test.ts`/`gap-precision.test.ts` (`bun test`) per the runner
conventions `c3-215`'s Change Safety row already binds this module to. `plugins/tribe/agents/tracker.md`
(lines ~113-131) now carries the `### Harness gaps` report template with its mandatory
`Not judged` line and the "candidates only, no `G-NNN`, never touches the registry" boundary.
`plugins/tribe/agents/warchief.md` (lines ~1104-1133) now carries the invoke-the-script duty:
resolve `gap-reconcile.ts` from the plugin root (never the shell cwd, mirroring the
`resolve-runner.sh` pattern `c3-215`'s Contract already documents), extract Tracker's candidates
into the structured JSON file the script expects, run it, and carry its output into the PR body
under `## Harness gaps` — Warchief is stated to never edit `.tribe/harness-gaps.jsonl` directly
and never mint/match a `G-NNN` by its own judgment. Three new eval cases exist in
`plugins/tribe/evals/evals.json` (ids 35-37):
`tracker-reports-followed-bad-pattern-as-gap-not-violation`,
`tracker-does-not-report-style-taste-as-gap`, `warchief-reconciles-via-script-never-by-hand`.

`c3-215` is a canonically sealed, frozen fact — none of this is reflected in its Contract or
Business Flow tables today, and direct mutation (`wire`/`set`/hand-edit) is refused by design;
only the change-unit flow (`c3x change new/apply`) is a legal path to record it.

## Decision

Patch `c3-215` via this change-unit's two block patches (`.c3/changes/adr-20260727-harness-gap-detection/`):
(1) Contract gains new rows for `scripts/gaps/gap-reconcile.ts` (the registry's sole writer;
states the `.tribe/harness-gaps.jsonl` append-only-ledger shape and the target-repo-only
instance boundary, mirroring `c3-215`'s existing "instances are CLI-only" precedent for the
campaign runner), `scripts/gaps/gap-precision.ts` (the computed metric), and Tracker's
`### Harness gaps` report section itself (an OUT surface: candidates only, capped, `Not judged`
mandatory, the read-only source gap-reconcile.ts reconciles); (2) Business Flow gains a
"Harness-gap ruling loop" row: gap opened/seen by `gap-reconcile.ts` → carried into the PR body
by Warchief (interim sink until CU-3's Scout adjudication replaces "human reads the PR section")
→ a human rules `rule` / `anti-rule` / `debt` / `dismissed` / `dismissed-duplicate`, appended as
a `ruled` event that suppresses the id forever → ratified `rule`/`anti-rule` rulings feed back
into Tracker's normal rule-checking path once written to a rule source it already loads.

Both patches are `scope: block`, based on the current last row of each section, confirmed fresh
via `c3 read c3-215 --section <name> --cite` — Contract anchors on `c3-215#n1083`
(`scripts/migrate-campaign-home.sh`, sha256
`1a61541efe10a73b572cb707f30b19b51c0639073dbeed30236cc3ea8e54d77b`), Business Flow on
`c3-215#n1061` (`Unattended path`, sha256
`5cab0d63685ee38f3deb8a93272258dee9c326322b000050ced77ead11f6aa7f`) — each patch body is the
cited row byte-identical, followed by the new row(s), so applying is a pure append at the true
end of the table, not a rewrite of any existing content. (An earlier read in this same session,
before the cache had been refreshed by `c3 add adr`, showed only 9 of Contract's 11 rows and
would have anchored one row short of the true end; re-reading after the refresh, and diffing
against a direct file read, confirmed the corrected anchor before either patch was authored.) No
`uses`/Governance patch is authored: spec §5's file-change inventory for this change-unit lists
no new `rule-*` document (unlike the sibling `adr-20260726-stack-agnostic-agent-prompts`, which
did mint `rule-stack-agnostic-agent-prompts` and therefore earned a Governance row) — the new
surface is a script + a target-repo-only data file, not a new checkable standard, so there is
nothing for a Governance row to cite; forcing one would fabricate a rule that does not exist.

`c3x change apply` is deliberately NOT run: this repo's `c3-215-tribe.md` currently has a broken
canonical seal (`c3x check --only c3-215` → `BROKEN_SEAL c3-2-plugins/c3-215-tribe.md`, reproduced
identically on `master`'s own checkout, not just this worktree), which blocks `c3x check`/`c3x repair`
from completing a cache rebuild before `apply`'s two gates (drift + canvas-valid) can even run —
this is the documented c3x v11.0.0 defect class this repo already tracks (project memory:
`c3x-change-apply-defect` — "check/repair delete pending patch material… apply reports 'no
material'"), and eight prior change-units already sit unapplied in `.c3/changes/` for the same
reason. The patches land as a work order for a future session with a working CLI to apply.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Contract gains the gap-report flow + registry surface (gap-reconcile.ts as sole writer, gap-precision.ts, Tracker's Harness-gaps report); its Business Flow gains the ruling loop a human runs outside the PR-merge decision | c3-215#n1037@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command — Shaman (What/Why) → Warchief (How) → Hunter (TDD execution), gated by Tracker (rules review) and Ski" | None — no new rule-* doc created by this change-unit (spec §5 inventory), so no Governance-table row |
| c3-2 | container | Parent of c3-215; no membership or directory-layout change (scripts/gaps/ lives inside the existing tribe plugin, not a new top-level plugin), included for top-down completeness | c3-2#n743@v1:sha256:f92a1cfb53ada54dba5f5c1154ccef3423fe08276ff6ec199cc745be16f8d3d0 "Claude Code runtime content: the 9 installable plugins — agents and skills that, once symlinked into ~/.claude, extend every Claude Code session with delive" | None — no container contract change |
| c3-0 | system | Top-down completeness only: the system ancestor of the affected component. No new component, container, or install-time surface (install.sh needs no change — scripts/gaps/ is repo-invoked like the runner, verified spec §5/Task 7) | c3-0#n2@v1:sha256:d21dc72fe385cb42ca0b79273dbc1b309b5d308a10754974395b20c7fd30fcc0 "Package Todd Lam's personal Claude Code agents and skills as installable plugins, keep the repo the single source of truth via symlink installs, and benchmark e" | None |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-evals-fixture | plugins/tribe/evals/evals.json gained three new agent-kind cases (ids 35-37); the shared fixture format (id/name/agent/prompt/expected_output) is unchanged | ref-evals-fixture#n1260@v1:sha256:f721836fe1202e2368d7d811c32d640cfc55f26882336819d9735bc3a9dbfd04 "One eval fixture format for every skill and agent in the repo, so a single runner can benchmark all of them and results are comparable across plugins. The recur" | comply |
| ref-plugin-layout | plugins/tribe/scripts/gaps/ is a new directory but sits inside the existing tribe plugin's scripts/ area, mirroring scripts/runner/'s zero-runtime-dep shape (package.json/tsconfig.json, no install-time symlink) | ref-plugin-layout#n1269@v1:sha256:7308f9cf6c7b854b298ec94062198be5540c62222a8b3466b2796854039585c5 "Standardize the directory shape of every plugin so the installer, the marketplace manifest, and the eval harness can walk any plugin without per-plugin logic. T" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-bash-strict-mode | No shell script is added or touched by this change-unit's code work (gap-reconcile.ts/gap-precision.ts are bun/TypeScript CLIs, not shell scripts) | rule-bash-strict-mode#n1279@v1:sha256:cf218a707a61ba5ad906d29dec31f9f4eef92e5faeb9db74e3a75451c41c3c1d "Every shell script in the repo fails fast and loud: unset variables, failed commands, and broken pipelines abort the script instead of silently producing half-d" | N.A - no shell script edited |
| rule-no-squash-merge | Delivered as one PR per the plan; merge shape (regular, 2-parent) governs whenever it is merged — no agent merges this change-unit's PR, matching the plan's explicit "never merged by any agent" constraint | rule-no-squash-merge#n1311@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request, or that verifies one was merged," | comply (deferred to merge time, owner-only) |
| rule-stack-agnostic-agent-prompts | plugins/tribe/agents/tracker.md and warchief.md were edited (Tasks 4-5) to add the gap-detection duties; both edits use stack-neutral language (grep as an illustration only, no toolchain-specific commands) | rule-stack-agnostic-agent-prompts#n1333@v1:sha256:f697b8c251caaeb793d90f13035cf18f9d215e8edd5d9bfbe77fe8814bb98625 "Every agent prompt file in this repo (plugins//agents/.md) stays usable against any" | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| .c3/changes/adr-20260727-harness-gap-detection/01-contract-gap-surface.patch.md | Block patch, base c3-215#n1083 (scripts/migrate-campaign-home.sh, the table's true last row): appends 3 Contract rows (gap-reconcile.ts, gap-precision.ts, Tracker's Harness-gaps report) at the end | diff of the file (this change-unit) |
| .c3/changes/adr-20260727-harness-gap-detection/02-business-flow-ruling-loop.patch.md | Block patch, base c3-215#n1061 (Unattended path, the table's last row): appends the "Harness-gap ruling loop" row after it | diff of the file (this change-unit) |
| c3-215 (tribe component doc) | Contract + Business Flow gain the rows above — applied via the change-unit flow (c3x change apply) once the c3x check/repair broken-seal defect is fixed; deferred, not applied by this session | c3x change view adr-20260727-harness-gap-detection (patches listed pending) |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI, validator, schema, template, or help text is touched by this ADR | N.A - it uses the existing change-unit primitives (two block patches to a frozen component's Contract/Business Flow sections) exactly as documented by c3x change --help | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| cd plugins/tribe/scripts/gaps && bun test && bunx tsc --noEmit | Re-runs the nine gap-reconcile.ts scenarios + the gap-precision.ts scenarios (spec §6a); the correctness gate the append-only ledger and every downstream number (dedup, suppression, precision) stand on | run output captured on this branch (Tasks 1-3 commits 976f733, 526ed10, a975859) |
| scripts/evals/run_evals.py --evals plugins/tribe/evals/evals.json --eval-id 5,29,35,36,37 | Confirms Tracker still refuses to invent standards (case 5) and stays read-only (case 29) while the three new gap-detection behaviors pass (spec §6b) | to be captured in the PR description (Task 7) |
| c3x change view adr-20260727-harness-gap-detection | Confirms both patches are recorded as pending change material against c3-215, ready for a future c3x change apply once the broken-seal defect is fixed | command output |
| git status --short -- .c3/ (run immediately after every c3x add in this session) | Confirms no canonical .c3/ content was corrupted as a side effect of authoring this ADR (documented c3x add side effect) | command output captured in this change-unit's Hunter report |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hand-edit c3-215-tribe.md directly with the new Contract/Business-Flow rows instead of authoring patches | c3-215 is a canonically sealed, frozen fact; the spec's "registry writes are script-only" C3 discipline explicitly extends to canonical docs — only c3x change apply may write them, and hand-editing would deepen the file's already-broken seal rather than fix it |
| Force a Governance-table row / uses-frontmatter patch mirroring the sibling stack-agnostic ADR | That ADR minted a new checkable rule (rule-stack-agnostic-agent-prompts); this change-unit's spec §5 file-change inventory creates no new rule-* document — the new surface is a script and a target-repo data file, not a new standard, so a Governance row would cite a rule that does not exist |
| Wait to author the ADR until the c3x check/repair broken-seal defect is fixed and c3x change apply can run in the same session | The plan's Task 6 explicitly requires authoring the ADR + patches as a committed work order now and deferring apply — waiting would block Task 7's PR indefinitely on a pre-existing, already-tracked tooling defect unrelated to this change-unit's own content |
| Trust the first c3 read c3-215 --section Contract --cite in this session (9 of 11 rows, stale cache pre-dating this session's own c3 add adr) and anchor there | Would have anchored one row short of the table's true end (missing scripts/viewer/serve.ts and scripts/migrate-campaign-home.sh, both already committed on this branch). Re-ran the citation after the cache refreshed and diffed it against a direct file read before authoring either patch — do not guess the anchor when a fresh re-read resolves the discrepancy mechanically |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Patches never get applied because the c3x check/repair broken-seal defect is never fixed, so c3-215 permanently drifts from the code it now governs | Same accepted risk this repo already carries for eight prior change-units sitting unapplied in .c3/changes/ for the identical reason; the work order (ADR + patches) is the durable record either way, independent of when/if apply runs | git log -- .c3/changes/ shows the growing backlog; project memory c3x-change-apply-defect names the defect explicitly |
| A patch authored against a stale cache read anchors mid-table instead of at the true end, and the discrepancy goes unnoticed | Re-ran c3 read c3-215 --section Contract --cite after c3 add adr refreshed the cache and diffed the result against a direct file read of .c3/c3-2-plugins/c3-215-tribe.md before authoring either patch; both patches anchor on the table's confirmed-current last row | c3 read c3-215 --section Contract --cite / --section "Business Flow" --cite output captured in this change-unit's Hunter report, showing 11/11 Contract rows and 5/5 Business Flow rows |
| Running c3 check/c3 repair to try to fix the broken seal deletes pending patch material as a documented side effect | Not run in this session; git status --short -- .c3/ was checked immediately after every c3 add per the plan's Global Constraints, and would have caught any stray deletion before commit | git status --short -- .c3/ output captured in this change-unit's Hunter report |

## Verification

| Check | Result |
| --- | --- |
| c3 schema adr (this session's c3() shell function wrapping c3x.sh) | Rendered the ADR canvas contract without error — captured in this session |
| git status --short -- .c3/ && git diff --stat -- .c3/ (run immediately after c3 add adr) | Only the new ADR file appeared as untracked/new; no stray canonical file was modified or deleted — captured in this change-unit's Hunter report |
| c3 read c3-215 --section Contract --cite / --section "Business Flow" --cite | Base anchors used by the two patches (n1083, n1061 — each the table's confirmed-current last row) present and byte-matching current canonical content before authoring either patch |
| c3x change apply adr-20260727-harness-gap-detection | Deliberately NOT run this session (known c3x v11.0.0 defect blocks check/repair from completing before apply's gates can run); deferred to a future session per the plan's Task 6 instruction |
