---
id: adr-20260928-runner-driver-only-pr2-the-plan-drives
c3-seal: 7935ec1753b4051e4393826d00e44ca65770571c8ce3f708f226d06756024ee6
title: 'runner-driver-only PR 2: the plan drives'
type: adr
goal: |-
    Record in C3 that after runner-driver-only PR 2 the plan drives the campaign runner: the runner reads
    campaign-state.json v2 only (a required per-card task index of plan-heading pointers, v1 refused, every
    ref resolved against its plan at load with one collected TaskIndexError, exit 4, --dry-run included),
    drives each card's executor session in turns (task turns in plan order, then a deliver turn; three
    terminal lines, the last one decides), runs every task's Done commands itself in a scratch worktree
    and records them in done.jsonl, caps each step at 3 unaccepted turns, and only lets a card merge and
    verify when the merged head is the commit the Done commands passed on (doneSha).
status: accepted
date: "2026-09-28"
---

## Goal

Record in C3 that after runner-driver-only PR 2 the plan drives the campaign runner: the runner reads
campaign-state.json v2 only (a required per-card task index of plan-heading pointers, v1 refused, every
ref resolved against its plan at load with one collected TaskIndexError, exit 4, --dry-run included),
drives each card's executor session in turns (task turns in plan order, then a deliver turn; three
terminal lines, the last one decides), runs every task's Done commands itself in a scratch worktree
and records them in done.jsonl, caps each step at 3 unaccepted turns, and only lets a card merge and
verify when the merged head is the commit the Done commands passed on (doneSha).

## Context

Tasks 2.1-2.17 of plan docs/superpowers/plans/2026-09-27-runner-driver-only.md added
core/plan-index.ts, core/done.ts, core/turn-prompts.ts and core/loop/turns.ts, bumped the state
schema to v2 (core/state.ts), replaced runCardSession with actOnCard -> driveCardTurns
(core/loop/card-actions.ts), taught the merge gate the Done commit (core/merge-gate.ts,
core/session.ts) and added the doneAtHead point to core/verify.ts. c3-215's run.ts contract row still
says "one fresh Agent-SDK executor session per card" with a six-point done check, and its
Change-Safety row for verify.ts names only the six points and no Done-run verification, so both are
stale.

## Decision

Patch the two c3-215 rows in place through this change unit, in the same commit as the README
update (rule-change-unit-ships-with-code). The Change-Safety row widens its trigger to
card-actions.ts and the turn/Done modules and names the three hermetic E2Es
(test-runner-done-negative.sh, test-runner-done-empty.sh, test-runner-task-index-refusal.sh) as
required verification, because the executor session double lets them drive the real runner, git
and Done commands where mocked seams cannot. No new fact, no canvas change.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | run.ts contract row describes one session per card, the v1 state and the six-point done check; the verify.ts Change-Safety row lacks the Done run and its E2Es | c3-215#n2290@v1:sha256:d69126cd0ebb052640d0938349d7fe7829d8f733f023e111d97bfaaa92cced97 "Runner accepts an unshipped card" | Rewrite both rows to the v2 state, the turn loop, the runner-run Done run and the seven-point check |

## Verification

| Check | Result |
| --- | --- |
| c3x check | ok: true |
| cd plugins/tribe/scripts/runner && bun run check | 0 fail |
| bash plugins/tribe/scripts/tests/test-runner-done-negative.sh; test-runner-done-empty.sh; test-runner-task-index-refusal.sh | all pass |
