---
id: adr-20260928-runner-driver-only-pr3-supervisor-follows-the-plan
c3-seal: 3c2344d36a47d94a6c3827d36f453fb07b3bed7c67fcb2759257ea2167003b4c
title: 'runner-driver-only PR 3: the supervisor and watchdog follow the plan only'
type: adr
goal: 'Record in C3 that after runner-driver-only PR 3 the supervisor and watchdog follow the plan only: the supervisor has no ratify session kind (no --max-ratify-rounds, no ratify rounds), a ruling session rules on the owner''s behalf with no ratified-as: requirement, the closing session re-verifies shipped cards with verify-shipped --skip-gap-gate and reports with no ratification pass and no gap-gate open ids, the runner never exits 5 and the watchdog has no exit-5 row, the ratification check lives on the Tribe side in plugins/tribe/scripts/gaps/rulings-check.ts, and orchestrate-campaign assumes the campaign''s decision authority and picks a plan style (simple by default, Tribe only when the owner asks).'
status: accepted
date: "2026-09-28"
---

## Goal

Record in C3 that after runner-driver-only PR 3 the supervisor and watchdog follow the plan only: the supervisor has no ratify session kind (no --max-ratify-rounds, no ratify rounds), a ruling session rules on the owner's behalf with no ratified-as: requirement, the closing session re-verifies shipped cards with verify-shipped --skip-gap-gate and reports with no ratification pass and no gap-gate open ids, the runner never exits 5 and the watchdog has no exit-5 row, the ratification check lives on the Tribe side in plugins/tribe/scripts/gaps/rulings-check.ts, and orchestrate-campaign assumes the campaign's decision authority and picks a plan style (simple by default, Tribe only when the owner asks).

## Context

Tasks 3.1-3.9 of plan docs/superpowers/plans/2026-09-27-runner-driver-only.md deleted the supervisor's ratify kind (brief-ratify.md, verifyRatify, --max-ratify-rounds), removed the ratified-as: requirement from the ruling brief, cut the closing brief down to re-verify + trailer recovery + one report (readGapGateOpenIds deleted), removed the runner's rulings gate (exit 5, rulings_unratified) and the watchdog's exit-5 row, moved isRulingRatified/unratifiedRulingIds to plugins/tribe/scripts/gaps/rulings-check.ts, and gave orchestrate-campaign a "Choose the plan style" step. c3-215 still describes a ratify session, --max-ratify-rounds, a 48-row watchdog table, a closing brief reading gap-gate open ids, "Shaman authority", and has no row for rulings-check.ts.

## Decision

Patch c3-215 in place through this change unit, in the same commit as the runner README update (rule-change-unit-ships-with-code): the Unattended-path Business Flow row, the orchestrate-campaign and supervise Contract rows, a new Contract row for scripts/gaps/rulings-check.ts (appended at the end of the table: inserting it after the gap-gate.ts row failed in c3x with a node-order UNIQUE constraint), the watchdog Change-Safety row (40-row table), the ruling-session containment Change-Safety row (two kinds, not three), and delete the Change-Safety row about the closing brief's gap-gate open ids (its function and risk no longer exist). No new fact, no canvas change.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Business Flow, Contract and Change-Safety rows describe the ratify session, the exit-5 rulings gate, the closing gap-gate open ids and Shaman authority, and omit rulings-check.ts | c3-215#n2279@v1:sha256:ee97ec88d31b5c4a5ddc919214c33ad616ffb4d8caf17e9830f296a095e038d9 "scripts/runner/run.ts supervise" | Rewrite the five rows, add the rulings-check.ts row, delete the gap-gate open-ids row |

## Verification

| Check | Result |
| --- | --- |
| c3x check | ok: true |
| cd plugins/tribe/scripts/runner && bun run check | 0 fail |
| supervisor, watchdog and runner E2E scripts named by plan Task 3.10 | all pass |
