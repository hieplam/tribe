---
target: c3-215
scope: insert
base: c3-215#n1639@v1:sha256:41b1f5b3207c5f326025c1ec4ae5d54757efb45ebed7d4f735a3065c4c39f1d6
---
| A wrong decide() row spawns a supervision session that was not needed, or parks one that should have run | Editing core/supervisor/** (the pure decide table, verify postconditions, the brief renderer, state/status shaping) | The row-per-case decide.test.ts table plus the pure verify/state/status suites; a mocked seam validates the logic but the real session is wired only by the Task-14 loop | cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit |
