# Plan — owner-run-probe (the throwaway card the sessions-in-repo owner run executes)

**Spec:** this file is both the card's spec and its plan. It exists so the owner run of card
`supervisor-sessions-in-repo` (spec `docs/superpowers/specs/2026-09-27-supervisor-sessions-in-repo-design.md`
§7) drives one real executor card through the real runner and supervisor.
**Campaign:** `sir-owner-run-<stamp>` (throwaway, built by
`plugins/tribe/scripts/tests/sessions-in-repo/owner-run.sh`)

Goal: append one dated line to `docs/tribe/owner-runs.md` and land it as one regular-merged PR.
The run's real value is the sessions it produces (an executor, a Hunter, a Tracker, a ruling, a
ratify and a closing session), not the line.

## Global Constraints

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic implementer.
- Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).
- Execution protocol for this probe: one Hunter per task (`model: haiku`), no Skinners, one Tracker
  at `final` only (for `gap-gate.ts`). Every `Agent` call passes `run_in_background: false`.
- Every commit carries `Tribe-Card: owner-run-probe`, `Tribe-Task: N/1` and `Campaign: <campaign slug>`.

## Before any task — ask first (no code, no Hunter)

Read the "Rulings" section of your executor brief. If it holds **no** ruling for card
`owner-run-probe`, stop immediately and end with exactly this terminal line (the question is
operational, not owner-only):

```text
NEEDS_DIRECTION: owner-run-probe — should the owner-runs line start with the UTC date or the campaign slug?
```

Expected: the runner records the escalation and exits `escalations_pending`. If a ruling for this
card IS present, follow it and continue with Task 1.

## Task 1 — append the line

**Model: `haiku`.** **owns_files:** `docs/tribe/owner-runs.md`.

- [ ] **Step 1: Append** — create `docs/tribe/owner-runs.md` if missing, with the heading `# Owner runs`, then
  append one line in the order the ruling chose, for example:

```markdown
- 2026-09-27 · sir-owner-run-20260927T100000Z · sessions-in-repo owner run
```

- [ ] **Step 2: Verify**


```bash
command grep -c "sessions-in-repo owner run" docs/tribe/owner-runs.md
```

Expected: a count of at least `1`.

- [ ] **Step 3: Commit** — one commit, the Global Constraints trailers, this task's boxes ticked in the same commit.
- [ ] Task 1 complete

## Delivery

Tracker at `final`, `gap-gate.ts`, PR with the gate's `## Harness gaps` section verbatim, merge with
`gh pr merge --merge`, then `SHIPPED #<pr> <merge sha>`.
