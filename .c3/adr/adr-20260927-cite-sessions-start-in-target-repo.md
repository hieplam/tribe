---
id: adr-20260927-cite-sessions-start-in-target-repo
c3-seal: bb78fae31a4604cd8f0d33274dc3f54bc9fbb69bb646537a9c63cbcd952044cc
title: cite-sessions-start-in-target-repo
type: adr
goal: |-
    Re-cite `c3-215` (tribe) from the retired rule `rule-session-cwd-config-restored` to the new rule
    `rule-sessions-start-in-target-repo`, and rewrite the Change Safety row that described the deleted
    snapshot/restore guard so it names the envelope card `supervisor-sessions-in-repo` actually landed
    (cwd = the target repo, no `additionalDirectories`, no configuration hooks, no snapshot/restore).
status: accepted
date: "2026-09-27"
---

## Goal

Re-cite `c3-215` (tribe) from the retired rule `rule-session-cwd-config-restored` to the new rule
`rule-sessions-start-in-target-repo`, and rewrite the Change Safety row that described the deleted
snapshot/restore guard so it names the envelope card `supervisor-sessions-in-repo` actually landed
(cwd = the target repo, no `additionalDirectories`, no configuration hooks, no snapshot/restore).

## Context

Card `supervisor-sessions-in-repo` deleted the 1,070-line guard (`isHomeConfigSurface`,
`snapshotHomeConfig`/`restoreHomeAfterSession`, `home-config.ts`, `HOME_CONFIG_DENIED_REASON`) that
`rule-session-cwd-config-restored` mandated, because the card's D2 ruling makes the guard
unnecessary: sessions now start with `cwd` set to the target repo root (never the campaign home),
so the home is never loaded as configuration and nothing needs snapshotting or restoring. The old
rule's Golden Example (`isHomeConfigSurface`, the snapshot/restore block) no longer exists in the
codebase, so the rule is stale and must be replaced, not merely re-worded. `c3-215` (tribe)'s
Governance table (front-matter `uses:` list and the row at line 65) and its Change Safety table
(row 103, "A ruling/ratify session writes outside the campaign home...") both cite or describe the
deleted mechanism.

## Decision

Replace the citation in both places in `c3-215`: the front-matter `uses:` list entry
`rule-session-cwd-config-restored` becomes `rule-sessions-start-in-target-repo`, and the Governance
table row that cited the old rule is re-authored to cite the new one. Row 103 of the Change Safety
table is rewritten so its Detection cell describes the new envelope (cwd = the target repo, no
`additionalDirectories`, no configuration-write hook, no snapshot/restore, handover through note
files) instead of the deleted guard, and its Required Verification cell names
`campaign-home-carryover.e2e.test.ts` (card `supervisor-sessions-in-repo`'s real-session proof)
alongside the still-live unit suites. The old rule and its eval binding are deleted through the CLI
in the same task, once this change-unit lands the re-citation (the destruction gate would otherwise
refuse the delete while `c3-215` still cites it).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Cites the rule being retired in its front-matter uses: list, its Governance table row, and describes the deleted guard in its Change Safety row 103 | c3-215#n2199@v1:sha256:1e5b6ef777edd18cb1df641aaab38202e36bebfbb2d16c2258348b16c93340f7 "rule-session-cwd-config-restored" | Re-cite to rule-sessions-start-in-target-repo; rewrite row 103's Detection/Required Verification cells to the new envelope |

## Verification

| Check | Result |
| --- | --- |
| c3x change apply lands the patches atomically | change apply exits with the patches applied, no drift/conflict |
| c3x check stays ok: true after apply | ok: true |
| rule-session-cwd-config-restored has no remaining citer, so its later delete is not refused | c3x delete rule-session-cwd-config-restored succeeds |
