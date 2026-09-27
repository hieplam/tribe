---
id: adr-20260927-drop-remaining-identifier
c3-seal: a03428cb7224a8d362b249ecf2a7527a0f4e2b6e7d12817646db65819b4a1099
title: drop-remaining-identifier
type: adr
goal: |-
    Row 103's own reworded prose still names `isHomeConfigSurface`, one of the G4 ratchet's tracked
    guard identifiers (card `supervisor-sessions-in-repo`), even after the previous change-unit dropped
    the old rule's slug. Drop that mention too, without changing the row's meaning.
status: accepted
date: "2026-09-27"
---

## Goal

Row 103's own reworded prose still names `isHomeConfigSurface`, one of the G4 ratchet's tracked
guard identifiers (card `supervisor-sessions-in-repo`), even after the previous change-unit dropped
the old rule's slug. Drop that mention too, without changing the row's meaning.

## Context

`plugins/tribe/scripts/tests/sessions-in-repo/g4-guard-footprint.sh` counts `isHomeConfigSurface`
among the deleted guard's identifiers anywhere under `.c3/`. Row 103's Detection cell used that
exact name to say the guard's helper no longer exists, which the script cannot distinguish from a
live reference.

## Decision

Reword the clause "no `isHomeConfigSurface`, no denial reason for a configuration-surface write"
to "no configuration-surface-matching helper, no denial reason for a configuration-surface write" —
same meaning, no tracked identifier.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Change Safety row 103 names a tracked guard identifier in its own prose | c3-215#n2233@v1:sha256:6592a15a08bdb0d3632f1550d4035c4a163dc8f0c567de458bf1abe0d72570a1 "A ruling/ratify session writes" | Reword to drop the identifier |

## Verification

| Check | Result |
| --- | --- |
| git grep -c isHomeConfigSurface -- .c3/c3-2-plugins/c3-215-tribe.md | 0 |
| c3x check stays ok: true | ok: true |
