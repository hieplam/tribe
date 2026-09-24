---
id: adr-20260924-supervisor-session-settings
c3-seal: e98252307210d0df229b527bf3ce9a9179f702448e420a3b199127111636d64f
title: supervisor-session-settings
type: adr
goal: |-
    Reconcile the one row of `c3-215`'s Change Safety table that card `supervisor-session-settings`
    (issue #163) falsified — "A ruling/ratify session writes outside the campaign home, or the repo
    is touched by a session that should never write to it" — so it states, as current fact: all
    three one-shot kinds (`ruling`, `ratify`, `closing`) now load `settingSources: ['user', 'project',
    'local']`; `ruling`/`ratify` carry the containment hook AND the scan-wall hook; `closing` carries
    NO containment hook, but does carry the scan-wall hook and the closing-grant hook (ruling R1);
    `ruling`/`ratify`'s `allowedTools` gained `Skill` (owner ruling R2), and the containment hook
    allows it; every other grant is unchanged. Add `core/supervisor/session.e2e.test.ts` (opt-in
    `RUN_SESSION_E2E=1`) to the row's Required Verification cell.
status: accepted
date: "2026-09-24"
---

## Goal

Reconcile the one row of `c3-215`'s Change Safety table that card `supervisor-session-settings`
(issue #163) falsified — "A ruling/ratify session writes outside the campaign home, or the repo
is touched by a session that should never write to it" — so it states, as current fact: all
three one-shot kinds (`ruling`, `ratify`, `closing`) now load `settingSources: ['user', 'project',
'local']`; `ruling`/`ratify` carry the containment hook AND the scan-wall hook; `closing` carries
NO containment hook, but does carry the scan-wall hook and the closing-grant hook (ruling R1);
`ruling`/`ratify`'s `allowedTools` gained `Skill` (owner ruling R2), and the containment hook
allows it; every other grant is unchanged. Add `core/supervisor/session.e2e.test.ts` (opt-in
`RUN_SESSION_E2E=1`) to the row's Required Verification cell.

## Context

`plugins/tribe/scripts/runner/docs/superpowers/plans/2026-09-24-supervisor-session-settings.md`
(Tasks 1-8, already merged onto this branch) fixed two gaps issue #163 named against the
supervisor's own one-shot session envelope (`core/supervisor/session.ts`), fixed a third coupling
found while grounding, and answered two owner-facing questions with rulings:

- **The tier gap.** At base `d6cad2f`, `session.ts:113` set `settingSources: kind === 'closing' ?
['project'] : []`, so `~/.claude/settings.json`'s `enabledPlugins` (the C3 plugin) never
registered in any of the three kinds, and `Skill c3` failed with `Unknown skill: c3` in every
one — MEASURED against a real Haiku session (spec §4.1). Task 3 set the tier list to `['user',
'project', 'local']` for all three kinds, matching the executor path (`core/session.ts:218`).
- **The scan-wall gap.** No supervisor envelope wired `decideScanGuardHook`; a `closing` session's
`find /` ran to completion, unrefused — MEASURED (spec §1, item 2). Task 4 wired the SAME
predicate (`decideScanGuardHook`, imported, never copied — card D3) as its own `PreToolUse`
entry in every kind: alongside the containment hook for `ruling`/`ratify` (defence in depth,
card D2, since that envelope already denies `Bash`), and alone (until Task 5) for `closing`,
which still carries no containment hook — it legitimately writes the repo (R11, spec §5.4).
- **D1 — a settings tier can silently widen `closing`'s grant.** Loading any of the three tiers
means a `permissions.allow` rule in a loaded settings file can auto-approve a tool outside
`CLOSING_ALLOWED_TOOLS` — MEASURED (spec §4.2): with the tiers loaded and no grant hook, an
un-granted tool (`Workflow`) ran. This is the trigger the row's Detection cell did not yet
state. **Ruling R1 (Shaman)** answered it: add `decideClosingGrantHook`, a pure allowlist
predicate (`core/supervisor/permit.ts`) enforcing the unchanged `CLOSING_ALLOWED_TOOLS` itself,
so no loaded tier can extend the grant. This amends D2 ("only the scan-guard hook is added") by
ruling, not by drift: `closing` now carries two hooks of its own, the scan wall and the grant
hook. **Accepted consequence (R1):** `closing` stops running `TaskCreate`, `CronList` and
`ListAgents`, which ran un-granted before and which the closing stage does not use. Task 5 built
it.
- **R2 — the owner ruled `Skill` in for `ruling`/`ratify`.** With the tiers loaded, `c3` registers
in `ruling`/`ratify`, but the containment hook refused the `Skill` tool, so G1's "`Skill c3`
returns C3 content" could not hold for those two kinds. **Owner ruling R2, verbatim "Allow the
Skill tool"**: `JUDGMENT_ALLOWED_TOOLS` gains `Skill`, and only `Skill` — `Bash` stays in
`JUDGMENT_DISALLOWED_TOOLS`, and the containment hook (`decideContainmentHook`) now allows a
`Skill` load at any location alongside `Read`/`Grep`/`Glob`. **Known, accepted limit, not a
defect:** the C3 skill's content loads, but its CLI (`bash <skill-dir>/bin/c3x.sh`) still cannot
run in `ruling`/`ratify` — those sessions have no `Bash` (MEASURED, spec §4.8). Task 6 built it.
- **G4 — the `verify-shipped` hand-load is kept.** `closing`'s `options.plugins` hand-load
(`session.ts:61-64`) predates the tier fix and remains, on purpose: MEASURED (spec §4.4), the
user tier resolves `verify-shipped` only where `install.sh` symlinked it into
`~/.claude/skills/`, a host fact, while the hand-load resolves it from the repo on every host;
where both exist the session registers it once. The two comments in `session.ts` that used to
say "`settingSources` never loads it" were rewritten to state this instead (Task 3).
- **The E2E.** Task 7 added `core/supervisor/session.e2e.test.ts` (opt-in `RUN_SESSION_E2E=1`):
real `claude-haiku-4-5-20251001` sessions through `runOneShotSession` with the real SDK adapter
— never a stub — proving G1 (`Skill c3` returns C3 content in all three kinds), G2 (a real
`find /` refused in `closing`), G4 (the hand-load measured with and without `options.plugins`),
and R1 (a host `permissions.allow` rule for `Workflow` still cannot run it in `closing`). Task 8
measured the G5 ratchet with the committed tool (`session-hygiene.ts`): `after/sessions` reads
0 `Unknown skill`, 0 scans.

None of this touched `core/session.ts` (the executor path, settled by #162), `core/state.ts`,
`core/types.ts`, or `CLOSING_ALLOWED_TOOLS`/`CLOSING_DISALLOWED_TOOLS`/`permissionMode` (issue
#163 scope fence) — `c3-215`'s Change Safety row for "A ruling/ratify session writes outside the
campaign home…" is the only fact this card falsified, and it falsified it in four places at once:
the tier list, the grant list, the hook wiring for every kind, and the Required Verification cell,
which named no E2E suite for this surface at all.

## Decision

Patch the one row through a single `block` patch, so it states, as current fact: the tier parity
(`['user', 'project', 'local']` for all three kinds); `ruling`/`ratify` carrying the containment
hook AND the scan-wall hook; `closing` carrying NO containment hook, but the scan-wall hook and
the closing-grant hook (ruling R1); `ruling`/`ratify`'s `allowedTools` gaining `Skill` by owner
ruling R2 (`Skill` only; the C3 CLI cannot run there without `Bash` — an accepted limit) with the
containment hook allowing it; every other grant unchanged. Add
`core/supervisor/session.e2e.test.ts` (opt-in `RUN_SESSION_E2E=1`) to the Required Verification
cell, alongside the existing unit and real-permission suites. No other row, ADR, or fact is
touched: the executor path, the watchdog, and every other Change Safety row are unaffected by this
card (issue #163's own scope fence).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Change Safety row "A ruling/ratify session writes outside the campaign home…" states the tier list, the grant, and the hook wiring for all three one-shot kinds in their superseded, pre-card form, and names no verification surface for the new E2E suite | c3-215#n2056@v1:sha256:28f22344eac8aeafc892845dc7461500e7c0576a71d68a4c929cc1b17ecad8af "A ruling/ratify session writes outside the campaign home, or the repo is touched by a session that should never write to it" | Patch 01 rewrites that one row: tier parity, hooks per kind, the R2 grant, and the E2E suite added to Required Verification |
| c3-2 | container | Named for top-down completeness only. The container's own responsibilities and membership are unchanged: this card's whole surface lives inside files c3-215 already owns (plugins/tribe/scripts/runner/core/supervisor/**), and no plugin boundary, installable, or component moved | c3-2#n1910@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content: the 2 installable plugins" | Parent Delta: none — no patch; c3-2's Components table is synthesized from parent links and no parentage changed |
| c3-0 | system | Named for top-down completeness only. The delivery outcome the system promises — regular-merged, evidenced, independently re-verified PRs — is unchanged; this card only makes the supervisor's own sessions load the same settings tier the executor already loads and run the same scan wall | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem" | Parent Delta: none — no patch; the system's goal statement is untouched by this card |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash c3x.sh change apply adr-20260924-supervisor-session-settings | applies atomically — one block patch, no drift |
| C3X_MODE=agent bash c3x.sh check | ok: true |
| grep -n "settingSources \['project'\] grants nothing" .c3/c3-2-plugins/c3-215-tribe.md | no match — the stale fact is gone |
| grep -c "session.e2e.test.ts" plugins/tribe/scripts/runner/README.md | at least 2 — the executor's existing mention plus the new supervisor one |
| cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit | green (inherited/refuted failures aside, per the plan's Adjudication rule); exit 0 |
