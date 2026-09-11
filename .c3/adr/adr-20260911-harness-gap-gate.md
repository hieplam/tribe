---
id: adr-20260911-harness-gap-gate
c3-seal: 65a1ef29e6c676e734843a701355eec441047c10d9d7f47987cb232ced256716
title: harness-gap-gate
type: adr
goal: |-
    Make the middle of the harness-gap loop mechanical: one gate with one durable input (Tracker
    report files) and one checkable output (a stamp plus a committed ledger). Today the loop is
    Tracker (writes candidates) → Warchief (reads them, decides) → ledger (records the decision),
    and the middle link is a human-in-the-loop step that nobody runs. This ADR authorizes
    `scripts/gaps/gap-gate.ts` as the single pre-PR command that closes that middle link
    mechanically, with a stamp the runner and `verify-shipped.sh` can both check after merge.
status: accepted
date: "2026-09-11"
supersedes:
    - adr-20260727-harness-gap-detection
    - adr-20260730-scout-ruling-loop
---

# ADR: the harness-gap gate

## Goal

Make the middle of the harness-gap loop mechanical: one gate with one durable input (Tracker
report files) and one checkable output (a stamp plus a committed ledger). Today the loop is
Tracker (writes candidates) → Warchief (reads them, decides) → ledger (records the decision),
and the middle link is a human-in-the-loop step that nobody runs. This ADR authorizes
`scripts/gaps/gap-gate.ts` as the single pre-PR command that closes that middle link
mechanically, with a stamp the runner and `verify-shipped.sh` can both check after merge.

## Context

Measured failure, from the 2026-09-10 audit of every campaign report on this machine: 118
Tracker runs produced 7 real harness-gap candidates across their reports, `gap-reconcile.ts`
was executed 0 times across 43 Warchief runs that had a candidate available to reconcile, and
`find` for `.tribe/harness-gaps.jsonl` returned nothing anywhere on the machine — the ledger the
loop depends on has never once been written by a real campaign. The spec's leak table names six
concrete leaks (L1-L6): the Tracker's candidate block has three real shapes and no single
parser handles all three; nothing forces `gap-reconcile.ts` to run before a PR merges; the
runner's D3 replay never re-checks that a gap decision was recorded; `verify-shipped.sh` has no
fourth check for it; a relative `--repo` resolves against the wrong cwd; and the reconcile
script had no `--repo`-scoped containment for the ledger path it writes. The 2026-09-10
empty-fixture reproduction (`~/.tribe/-Users-hip-repo-tribe/reports/gap-loop-fix/repro/repro-before.md`)
confirms the failure end-to-end on a bare fixture, not just by code reading: the Tracker
reported a four-condition candidate, the Warchief never ran `gap-reconcile.ts`, and the ledger
file was absent afterward.

The affected topology is the tribe plugin's campaign machinery (`c3-215`, which already owns the
runner, the watchdog, the Tracker-facing contract surfaces) and the `verify-shipped` skill
(`c3-217`), which is the mechanical "is this actually shipped" check a Hunter or Warchief runs
before trusting a card is done.

## Decision

Ship `scripts/gaps/gap-gate.ts` as the single pre-PR gate for the harness-gap loop: one
invocation, a red/green exit code, one Markdown report and one JSON summary, built from a pure
parser (`gap-candidates.ts`) that handles all three real Tracker report shapes, a
`gap-reconcile.ts` library call with `--repo`-contained ledger resolution, and a debt
burn-down diff. Ledger policy A (owner ruling, 2026-09-10) is adopted: the ledger append is
committed on the card branch itself, tagged with the `Tribe-Milestone: gap-gate` trailer, so the
ledger travels with the PR rather than living in an out-of-band operational home. The gate emits
a `gap-gate v1` stamp that two independent downstream checks verify post-merge: the campaign
runner's D3 replay (now seven points, up from six — the two new points are `gapGateStamped` and
`ledgerCommitted`) and `verify-shipped.sh`'s new fourth check, `gap_gate_stamped`, which confirms
the merged PR body actually carries the stamp for the card being verified.

This ADR's change-unit is split across two PRs by card. **C1** (this PR) ships the gate itself,
the parser, the stamp module, the two new runner D3 points, and the `verify-shipped.sh` fourth
check — and applies only the Contract-row and Change-Safety patches that describe those shipped
surfaces exactly. **C2** extends this SAME change-unit with the Business-Flow and Governance
patches (the loop's narrative description and the ledger-policy governance rows), once C2's code
is what makes those sections true. Authoring the C2 patches here, before C2's code ships, would
leave them unapplied against `rule-change-unit-ships-with-code` — so they are deliberately left
for C2 to author and apply in the same PR as its own code, per that rule's Scope section.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Ships the gate CLI, the pure Tracker-shape parser, the gap-gate v1 stamp module, and the two new D3 replay points (gapGateStamped, ledgerCommitted) the runner checks post-merge | c3-215#n1542@v1:sha256:6fb1b418a589a6e469686c9651a414d7f22c530816260e036d785e11616de5f4 | Contract row added for the new CLI surface; Change-Safety row corrected from six-point to seven-point replay, naming the gate |
| c3-217 | component | verify-shipped.sh gains a fourth pass/fail check, gap_gate_stamped, that the merged PR body carries this card's gap-gate v1 stamp | c3-217#n1594@v1:sha256:32e5600a83f4ff3c24a3769f94ec70b414c964bce2c954f8e4c6afc391c1f191 | Contract row's Contract cell rewritten to name all four checks explicitly |

## Verification

| Check | Result |
| --- | --- |
| cd plugins/tribe/scripts/gaps && bun test | All gap-parsing, reconcile, ledger and gate-CLI unit tests pass |
| cd plugins/tribe/scripts/runner && bun test | Runner suite green, including the seven-point D3 replay with the two new points mocked |
| bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh | All four checks (pr_merged, master_in_sync, worktree_removed, gap_gate_stamped) covered, including the new one's pass and fail cases |
| bash plugins/tribe/scripts/tests/test-fresh-machine.sh | Fresh-machine doctor/resolver suite unaffected, still green |
| C3X_MODE=agent bash "$C3X" check | Prints ok: true with a total at least the pre-existing 47 |
| Empty-fixture end-to-end (reports/gap-loop-fix/repro/build-fixture.sh) | Producing exactly one opened event on master, replacing the before-state where the ledger was never written |
