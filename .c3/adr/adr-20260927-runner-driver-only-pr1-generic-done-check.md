---
id: adr-20260927-runner-driver-only-pr1-generic-done-check
c3-seal: fd518c2ee9658309a1f6d38e99dcc4497e023a202b4d77fb8b223fae90c78315
title: 'runner-driver-only PR 1: the done check is generic'
type: adr
goal: |-
    Record in C3 that the campaign runner's done check is generic after runner-driver-only PR 1: the
    D3 replay checks six points (merged, mergeShaAncestorOfMaster, checksGreen, worktreeAndBranchGone,
    schemaGuard, localBaseSynced) with a proven-safe fast-forward heal of the runner's own base
    checkout, never a gap-gate stamp or ledger commit; the executor session loads only the owner's
    three settings tiers; and verify-shipped gains an opt-in --skip-gap-gate.
status: accepted
date: "2026-09-27"
---

## Goal

Record in C3 that the campaign runner's done check is generic after runner-driver-only PR 1: the
D3 replay checks six points (merged, mergeShaAncestorOfMaster, checksGreen, worktreeAndBranchGone,
schemaGuard, localBaseSynced) with a proven-safe fast-forward heal of the runner's own base
checkout, never a gap-gate stamp or ledger commit; the executor session loads only the owner's
three settings tiers; and verify-shipped gains an opt-in --skip-gap-gate.

## Context

Tasks 1.2-1.8 of plan docs/superpowers/plans/2026-09-27-runner-driver-only.md removed the
gapGateStamped and ledgerCommitted points from core/verify.ts, added D4's localBaseSynced point and
its fast-forward heal (core/residue.ts#decideBaseSyncHeal, core/loop/card-actions.ts#healSafeResidue),
dropped the runner's explicit tribe plugin load from core/session.ts#buildSessionOptions, and added
--skip-gap-gate to verify-shipped.sh (used by the supervisor's closing brief). c3-215's run.ts
contract row, its Change-Safety row naming "the D3 seven-point replay, incl. gapGateStamped and
ledgerCommitted", and c3-217's verify-shipped.sh contract row (which named the runner's
gapGateStamped point) are now stale.

## Decision

Patch the three rows in place through this change unit, in the same commit as the code
(rule-change-unit-ships-with-code). No new fact, no canvas change.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | run.ts contract row and the verify.ts Change-Safety row describe the old seven-point done check and the plugin injection | c3-215#n2290@v1:sha256:dc6cff4e0f0d6b639ee2d01fb1966a8f2b525fd4249a23fb6497e3028d4b500e "Runner accepts an unshipped card" | Rewrite both rows to the six-point generic check |
| c3-217 | component | verify-shipped.sh contract row lacks --skip-gap-gate and names the runner's removed gapGateStamped point | c3-217#n2339@v1:sha256:f714eefd19e014f819b9c8ef2c27c61418074e746ff40be0a1d05d69fb0ad03f "scripts/verify-shipped.sh" | Add the opt-in flag, drop the stale cross-reference |

## Verification

| Check | Result |
| --- | --- |
| c3x check | ok: true |
| cd plugins/tribe/scripts/runner && bun run check | 0 fail |
