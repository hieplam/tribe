---
id: adr-20260919-campaign-supervisor-ratchet
c3-seal: 4c0718c39cbb9542299f114f78803c190788a17c9c1c28e80eb93aea4e3aada8
title: campaign-supervisor-ratchet
type: adr
goal: |-
    Authorize the campaign-supervisor card's Phase 1 "ratchet" as the sole context-budget baseline for
    the supervisor: a committed, tested, token-free `transcript-metrics` subcommand of
    `plugins/tribe/scripts/runner/run.ts`, plus a numbers-only, pinned baseline file and a ratchet
    ceiling file, landing before any supervisor code exists. `c3-215`'s Contract section must state
    this new CLI surface so the model is not silently stale the moment Phase 2 starts depending on it.
status: accepted
date: "2026-09-19"
---

## Goal

Authorize the campaign-supervisor card's Phase 1 "ratchet" as the sole context-budget baseline for
the supervisor: a committed, tested, token-free `transcript-metrics` subcommand of
`plugins/tribe/scripts/runner/run.ts`, plus a numbers-only, pinned baseline file and a ratchet
ceiling file, landing before any supervisor code exists. `c3-215`'s Contract section must state
this new CLI surface so the model is not silently stale the moment Phase 2 starts depending on it.

## Context

The campaign-supervisor card's own baseline table (context-budget numbers meant to size the future
supervisor's spawn/park limits) was produced by a throw-away, uncommitted script and turned out to
be measurably wrong in six ways, recorded as spec discrepancies D1-D6
(`docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md` §21):

- D1 — the card's guardrail 3 claims `autoAnswerRounds` is tracked; the field is permanently `0`,
verified by a grep across the runner source and a real campaign home.
- D2 — the card's turn/token counts for session `6a8a8fe4-…` differ from a re-measurement, for two
DIFFERENT reasons conflated in the card's table: the turn/token deltas are a moving-file effect
(the session was still live while measured — 1,443 then 1,507 then 1,509 lines across three
reads), never an error in either measurement; only the four class-bucket counts (37/34 vs 43/42
monitor turns, plus a 23-turn class the card's table has no column for) are a genuine
classification error.
- D3 — `<task-notification>` has two structural shapes (one with an `<event>` element, one — a
background-command completion — without); the throw-away script mis-bucketed the second shape,
which is the classification error D2 isolates.
- D4 — the card's park-reason sketch omits the real watchdog terminal reason `session_incomplete`.
- D5 — the card's sketch also omits the real watchdog terminal reason `stop_requested`.
- D6 — the card's sketch would have the supervisor write its own `run.json`, which corrupts the
watchdog's `newestRunId()` lexicographic-max scan over `runs/`.

Consequence (D2): a baseline measured over a file that is still growing is not reproducible by
anyone, including its own author. `c3-215` (`tribe`'s Contract section, the runner surface row)
currently describes `run.ts`'s CLI capability but has no row for a `transcript-metrics`
subcommand — the fact and the code are already out of sync now that the subcommand is committed
(commit `896af35`, task 3/24 of this campaign).

## Decision

Record this ratchet as the authorized shape for how the supervisor's context-budget numbers are
produced, and add exactly one Contract row to `c3-215` describing the `transcript-metrics`
subcommand as it now ships:

- The subcommand is part of the existing `run.ts` CLI (no new resolver, no new installable),
invoked `bun run.ts transcript-metrics --session <id> [--session <id> ...] [--json] [--cut-bytes
<n>] [--verify <baseline.json>]`.
- It is pure-token-cost: it reads local `~/.claude/projects` transcript files only, never spawns a
model.
- Every baseline entry it emits is pinned to a byte cut of the transcript (lines, bytes, sha256 of
exactly that prefix) rather than "the whole file" (spec §15, §21 D2/A8) — the fix for the
moving-file defect above.
- `--verify <baseline.json>` re-measures each recorded session at exactly its pinned cut and
reports `"status": "verified"` per session with `exit=0`, never re-baselining — this is what
makes it a ratchet (a repeatable proof the pinned numbers still hold) rather than a one-off
snapshot.
- The four trigger classes (`human`, `monitor-event`, `monitor-expiry`, `task-notification`) are
the card's own oracle (spec §21 D3), fixing the second-shape mis-bucketing that caused D2's
class-bucket discrepancy.
- The supervisor itself is explicitly NOT described by this ADR — no supervisor code exists yet
(Phase 2 of the plan starts after this task). Folding it in here would seal a claim about
unbuilt code.

This is the minimum patch that makes `c3-215`'s Contract section true again: one `insert` row for
the `transcript-metrics` surface, landing after the existing `run.ts` runner row. No other entity
is touched.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Contract section documents run.ts's CLI capability but has no row for the now-committed transcript-metrics subcommand; the model is stale the moment a reader checks the code | c3-215#n1594@v1:sha256:e416108e102ee1672a480bf72cfaef6eef73c2afabca8ef137c610ce55d79282 | Contract row added naming the subcommand, its flags, the pinned-cut and --verify behavior, and the four trigger classes |

## Verification

| Check | Result |
| --- | --- |
| cd plugins/tribe/scripts/runner && bun test core/metrics/ | 47 pass, 0 fail, 88 expect() calls — measured 2026-09-19 on this worktree |
| cd plugins/tribe/scripts/runner && bunx tsc --noEmit | Silent (exit 0) — measured 2026-09-19 |
| grep -c '"content"' docs/superpowers/evidence/2026-09-18-supervisor-baseline.json | 0 — the baseline file is numbers-only, no transcript content leaked in, measured 2026-09-19 |
| python3 -c "import json;d=json.load(open('docs/superpowers/evidence/2026-09-18-supervisor-baseline.json'));print(all('cut' in s for s in d['sessions']))" | True — every baseline entry carries a pinned cut, measured 2026-09-19 |
| C3X_MODE=agent bash "$C3X_BIN" check | total: 52, ok: true before this unit; total: 53, ok: true after it applies (the entity count grows by this ADR) |
