---
id: adr-20260927-retire-rule-session-cwd-config-restored
c3-seal: 5c9abd43a3a7605a145386c3866747a825f63c7c656c0c92fd0137e81996fed7
title: retire-rule-session-cwd-config-restored
type: adr
goal: |-
    Retire `rule-session-cwd-config-restored`: card `supervisor-sessions-in-repo` deleted the
    1,070-line guard (`isHomeConfigSurface`, `snapshotHomeConfig`/`restoreHomeAfterSession`,
    `home-config.ts`) this rule mandated, and `rule-sessions-start-in-target-repo` (adopted in change-
    unit `adr-20260927-cite-sessions-start-in-target-repo`) now states the invariant the card actually
    established. `c3-215` no longer cites the old rule.
status: accepted
date: "2026-09-27"
---

## Goal

Retire `rule-session-cwd-config-restored`: card `supervisor-sessions-in-repo` deleted the
1,070-line guard (`isHomeConfigSurface`, `snapshotHomeConfig`/`restoreHomeAfterSession`,
`home-config.ts`) this rule mandated, and `rule-sessions-start-in-target-repo` (adopted in change-
unit `adr-20260927-cite-sessions-start-in-target-repo`) now states the invariant the card actually
established. `c3-215` no longer cites the old rule.

## Context

The old rule's Golden Example functions (`isHomeConfigSurface`, the snapshot/restore block in
`runOneShotSession`) no longer exist in the codebase — sessions now start with `cwd` set to the
target repo root, so the campaign home is never loaded as configuration and there is nothing to
snapshot or restore. `c3-215`'s Governance table and Change Safety row 103 were already re-cited
to `rule-sessions-start-in-target-repo` in the prior change-unit, so this rule has no remaining
citer and its retire cannot orphan or dangle anything.

## Decision

Retire `rule-session-cwd-config-restored` with a `retire` scope patch. Its eval binding
(`.c3/eval/rule-session-cwd-config-restored.yaml`) is removed directly afterward — the eval spec is
an ordinary editable file, never a change-carrier (`references/eval.md`).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| rule-session-cwd-config-restored | N.A - rule, not a system/container/component | The fact being retired | rule-session-cwd-config-restored@v1:sha256:7d5668d841ecd8dc49ea67b4e08d79f596a655d613587e4969fb22ad6a77b41b | Retire; no remaining citer per the reverse graph |

## Verification

| Check | Result |
| --- | --- |
| c3x change apply retires the fact, gated (no orphaned child, no dangling citer) | retire lands, c3x check stays ok: true |
| c3x read rule-session-cwd-config-restored reports not found after apply | not found |
