---
id: adr-20260925-supervisor-home-settings-containment
c3-seal: 187b186cdedbd1fe9dcae99031caeb111d26c158f93a24c5fe715fd7e41678c9
title: supervisor-home-settings-containment
type: adr
goal: |-
    Record, in the architecture model, the contract card `supervisor-home-settings-containment` landed
    on branch `feat/supervisor-home-settings-containment`: a supervisor one-shot session's `cwd` (the
    campaign home) is also the *next* one-shot session's settings root, so `decideContainmentHook` now
    refuses a `ruling`/`ratify` `Write`/`Edit` to a configuration surface inside the home with
    `HOME_CONFIG_DENIED_REASON`, `closing` carries a third `PreToolUse` hook
    (`buildHomeConfigWriteHook`) refusing the same surfaces, and `runOneShotSession` snapshots the
    home's configuration surface before every spawn and restores it after — whoever wrote the change,
    including a `closing` session's `Bash`. `c3-215`'s Change Safety row for "Editing
    `core/supervisor/permit.ts`…" states the old, narrower contract (a `Write`/`Edit` "ONLY under the
    campaign home" with no word of configuration surfaces or of the restore), and the component cites
    no rule for this behaviour. Both are reconciled in this one change-unit, which also authors the
    rule this behaviour is now measured against (`rule-session-cwd-config-restored`, card Task 10).
status: accepted
date: "2026-09-25"
---

## Goal

Record, in the architecture model, the contract card `supervisor-home-settings-containment` landed
on branch `feat/supervisor-home-settings-containment`: a supervisor one-shot session's `cwd` (the
campaign home) is also the *next* one-shot session's settings root, so `decideContainmentHook` now
refuses a `ruling`/`ratify` `Write`/`Edit` to a configuration surface inside the home with
`HOME_CONFIG_DENIED_REASON`, `closing` carries a third `PreToolUse` hook
(`buildHomeConfigWriteHook`) refusing the same surfaces, and `runOneShotSession` snapshots the
home's configuration surface before every spawn and restores it after — whoever wrote the change,
including a `closing` session's `Bash`. `c3-215`'s Change Safety row for "Editing
`core/supervisor/permit.ts`…" states the old, narrower contract (a `Write`/`Edit` "ONLY under the
campaign home" with no word of configuration surfaces or of the restore), and the component cites
no rule for this behaviour. Both are reconciled in this one change-unit, which also authors the
rule this behaviour is now measured against (`rule-session-cwd-config-restored`, card Task 10).

## Context

The card's grounding run (spec §4, MEASURED 2026-09-25) planted configuration in a fresh campaign
home and observed the *next* session in the same home: a `hooks` block in
`<home>/.claude/settings.json` and in `<home>/.claude/settings.local.json` ran at `SessionStart`,
`UserPromptSubmit`, every `PreToolUse` and `Stop` in `ruling`, `ratify` **and** `closing` sessions;
`<home>/CLAUDE.md`, `CLAUDE.local.md`, a nested or lower-case `claude.md`, `.claude/skills` and
`.mcp.json` all loaded into the next session's context; and a `closing` session's single `Bash`
command planted all three files at once and the next session ran every hook (spec §4.4 pair e2) —
a write no `Write`/`Edit` `PreToolUse` hook can ever see. `c3-215-tribe.md:101`'s Change Safety row
for that trigger still says the containment hook permits "a Write/Edit ONLY under the campaign
home", which was true before this card and is now incomplete: it omits the configuration-surface
refusal, the `closing`-only hook, and the after-session restore entirely, and the component's
`uses`/Governance table cites no rule for any of it.

Two decisions the card's spec grounds and this ADR carries forward, so a later reader does not
have to re-derive them from the spec:

- **§4.5 — moving `cwd` was measured and rejected.** A `ruling` session given
`cwd = <home>/supervisor/root` still loaded `<home>/CLAUDE.md` (m4, MEASURED: `CLAUDE.md` is read
from every ancestor of `cwd`), so a different `cwd` inside the home closes nothing the design
below does not already close; a `cwd` outside the home would do nothing for `closing`'s `Bash`,
and it moves the session's `~/.claude/projects/` directory away from the home's own encoded
directory, breaking the viewer's attribution contract (campaign-supervisor spec §14, "Attribution
is the directory"). `cwd` stays the campaign home.
- **§6 — the two-layer design.** Layer 1 (`decideContainmentHook`'s new row for
`ruling`/`ratify`, `buildHomeConfigWriteHook` for `closing`) refuses the write where a tool call
makes it. Layer 2 (`runOneShotSession`'s snapshot-before-spawn / restore-after, backed by
`adapters/home-config.adapter.ts`) does not care who wrote the change — it undoes the difference
between the home's configuration surface before and after every session, which is the only layer
that catches a `closing` session's `Bash` write. Both layers share one pure predicate,
`isHomeConfigSurface` (`core/supervisor/home-config.ts`): a path inside the home is a
configuration surface, case-insensitively, when a path segment is `.claude`, the last segment
matches `claude*.md`, or the last segment is `.mcp.json`.

## Decision

Reconcile `c3-215`'s Change Safety row for "Editing `core/supervisor/permit.ts`…" to state the
after-state exactly: `decideContainmentHook` denies a `ruling`/`ratify` `Write`/`Edit` to a
configuration surface inside the home with its own reason, `HOME_CONFIG_DENIED_REASON` — never the
out-of-home containment reason, which would misstate the fact (readable-code symptom 6); `closing`
carries a third `PreToolUse` hook, `buildHomeConfigWriteHook`, refusing the same surfaces inside the
home only (`closing`'s writes outside the home, e.g. the repo's own `CLAUDE.md`, are unaffected);
and `runOneShotSession` snapshots the home's configuration surface before every spawn — refusing to
spawn at all when it cannot be read — and restores it to that snapshot after the session, whoever
wrote the change, failing the session to `outcome: 'error'` when the home cannot be restored
(`fail-closed-edges.md`). Add `core/supervisor/home-config.test.ts`,
`adapters/home-config.adapter.test.ts` and `core/supervisor/home-config.e2e.test.ts` (opt-in
`RUN_SESSION_E2E=1`) to the row's Required Verification cell.

Cite `rule-session-cwd-config-restored` (authored in this card's Task 10, from this same measured
result) from `c3-215`'s Governance table and `uses` list — the `uses` list is synthesized from the
Governance table's `Reference` column (`edge: uses`), so one `insert` patch on the table row updates
both. The rule's Golden Example is copied literally from the landed code
(`isHomeConfigSurface`, `runOneShotSession`'s snapshot/restore block, the timeout second pass, the
`HOME_CONFIG_DENIED_REASON` row); this ADR does not restate that code, only cites the rule that now
governs it.

This unit carries two block/insert patches against `c3-215` and nothing else: the Change Safety row
(`block`) and the Governance table row (`insert`, after the existing last row).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Change Safety row for "Editing core/supervisor/permit.ts…" (c3-215-tribe.md:101) states the containment hook permits "a Write/Edit ONLY under the campaign home", omitting the configuration-surface refusal, closing's own hook, and the after-session restore this card added | c3-215#n2017@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command — Shaman (What/Why) → Warchief (How) → Hunter (TDD execution), gated by Tracker (rules review) and Ski" | Patch 01 rewrites that one row's Detection and Required Verification cells to the measured after-state (row anchored for the patch itself via read c3-215 --section "Change Safety" --cite, node n2084) |
| c3-215 | component | Its Governance table (and the uses list it synthesizes, c3-215-tribe.md:15) cites no rule for the cwd-is-a-settings-root contract this card's Task 10 rule now states | c3-215#n2017@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command — Shaman (What/Why) → Warchief (How) → Hunter (TDD execution), gated by Tracker (rules review) and Ski" | Patch 02 inserts one new Governance row citing rule-session-cwd-config-restored, binding, scoped to the supervisor's one-shot spawn path (row anchored for the patch itself via read c3-215 --section Governance --cite, node n2050) |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-change-unit-ships-with-code | This unit's two patches must land in the same PR as the card's already-merged code (Tasks 1-9), not deferred to a later reconciliation pass, which is exactly the recurring drift this rule exists to stop | rule-change-unit-ships-with-code#n2268@v1:sha256:b6024e72d871662eb34400050e4c977663b0356dceb6c8e2c42b3ea1c4fda085 "The PR that merges a decided ADR's code applies every patch under .c3/changes/<adr-id>/ to its target fact in that same PR, or records the deferral as a debt " | comply — this ADR is flipped to done only after change apply lands both patches and their after-state phrases (HOME_CONFIG_DENIED_REASON, rule-session-cwd-config-restored) grep present in c3-215-tribe.md, in the same commit as this reconciliation |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash c3x.sh change apply adr-20260925-supervisor-home-settings-containment | applies atomically — two patches (one block, one insert), no drift |
| C3X_MODE=agent bash c3x.sh check | ok: true |
| command grep -c "rule-session-cwd-config-restored" .c3/c3-2-plugins/c3-215-tribe.md | >= 2 (the uses list, synthesized, and the Governance table row) |
| command grep -c "HOME_CONFIG_DENIED_REASON" .c3/c3-2-plugins/c3-215-tribe.md | >= 1 (the reconciled Change Safety row) |
| command grep -c "home-config" plugins/tribe/scripts/runner/README.md | >= 2 |
| cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit | green (inherited failures per the plan's Adjudication rule only), exit 0 |
