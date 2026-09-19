---
id: adr-20260919-supervisor-core-change-safety
c3-seal: 5cb6d776f232e79fc3a5f029767952c12b9965b6de363929904d5368c1e68a16
title: supervisor-core-change-safety
type: adr
goal: |-
    Record, in c3-215's Change Safety section, that the campaign-supervisor card's pure decision
    core (core/supervisor/**: the decide table, verify postconditions, the brief renderer, and
    state/status shaping — Tasks 1-10 of docs/superpowers/plans/2026-09-18-campaign-supervisor.md,
    already committed) is now a governed architecture fact with a named risk, trigger, detection,
    and required verification — before Phase 2 (the wiring/permission-model tasks) adds anything on
    top of it. The permission model itself is out of scope; it lands with Task 16, in the phase that
    builds it.
status: accepted
date: "2026-09-19"
---

## Goal

Record, in c3-215's Change Safety section, that the campaign-supervisor card's pure decision
core (core/supervisor/**: the decide table, verify postconditions, the brief renderer, and
state/status shaping — Tasks 1-10 of docs/superpowers/plans/2026-09-18-campaign-supervisor.md,
already committed) is now a governed architecture fact with a named risk, trigger, detection,
and required verification — before Phase 2 (the wiring/permission-model tasks) adds anything on
top of it. The permission model itself is out of scope; it lands with Task 16, in the phase that
builds it.

## Context

c3-215's Change Safety table already carries one row per governed risk surface in the tribe
agent ecosystem (role-boundary erosion, broken crash resume, plan validation regression, a
non-idempotent install hook, a runner that accepts an unshipped card, the fresh-machine resolver,
and the watchdog action table). Tasks 1-10 of the campaign-supervisor plan landed a new pure core
under plugins/tribe/scripts/runner/core/supervisor/** — a row-per-case decide() table, disk
postcondition verification, ruling integrity and park markers, a pure brief renderer for the
three session kinds, and persisted state/status publishing — with no corresponding Change Safety
row, so a reader of c3-215 today cannot see that this surface exists or how a change to it is
verified. Per plugins/tribe/rules/brief-contracts.md, "governance work belongs at the end of each
phase, not the end of the project": Phase 1 (the pure core) just closed, so this reconciliation
happens now rather than being deferred to the end of the whole card, where it would compound with
every later Phase-2 task's own drift.

The existing campaign ADR adr-20260919-campaign-supervisor-ratchet already carries a change-unit
(01-contract-transcript-metrics.patch.md) that was accepted and applied against c3-215 in Task 5,
then its body was corrected in place by a Task-5 fix commit. That patch file's own cited base
hash no longer seals against current canonical c3-215 (c3x change view reports
`drift — no block of c3-215 seals to the cited hash; rebase`), and c3x change apply is atomic
per change-unit folder — it gates on every patch file present, not only newly added ones — so
appending a second patch to that same folder blocks on the pre-existing, out-of-scope drift of
patch 01. Rebasing patch 01 is Task 5/fix territory, not this task's fence. A fresh change-unit
avoids re-litigating already-shipped work.

## Decision

Author a new, narrowly-scoped change-unit — adr-20260919-supervisor-core-change-safety — whose
one patch (an insert, scoped to c3-215, anchored on the current last Change Safety row: the
watchdog row) appends exactly one new row naming the risk, trigger, detection, and required
verification for editing core/supervisor/**. This wins over extending the existing ratchet ADR
because that folder cannot pass c3x change apply's atomic drift gate without first rebasing
patch 01, which is out of this task's fence (editing a different, already-shipped fact). It wins
over silence (deferring the row to a later task) because the pure core already exists and is
already a real risk surface; per brief-contracts.md, deferring governance to the end is the exact
cycle this task exists to break.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Change Safety table is the only place the repo records risk/trigger/detection/verification per governed surface; core/supervisor/** is a new governed surface with no row today | c3-215#n1588@v1:sha256:41d6e7aed562043a062e505cecc44e3e6a2e77eefb4dbef4cbab9ae009a3466d "Owns the delivery role contracts: who may talk to whom (Owner ⇄ Shaman ⇄ Warchief ⇄ Hunter, adjacent ranks only), which question each role answers, how qu" | Change Safety table — insert one row, no existing row edited |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash "$C3X_BIN" change apply adr-20260919-supervisor-core-change-safety | applies clean; the new row lands as the last row of c3-215's Change Safety table |
| C3X_MODE=agent bash "$C3X_BIN" check | total: 54, ok: true (this ADR is the one new entity; no new component — core/supervisor/** is covered by the existing c3-215 row) |
