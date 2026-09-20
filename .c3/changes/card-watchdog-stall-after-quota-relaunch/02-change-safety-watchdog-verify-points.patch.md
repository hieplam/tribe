---
target: c3-215
scope: block
base: c3-215#n1990@v1:sha256:41b1f5b3207c5f326025c1ec4ae5d54757efb45ebed7d4f735a3065c4c39f1d6
---
| The watchdog waits forever, relaunches forever, or kills a healthy runner | Editing core/watchdog/* | The 48-row action-table test plus the double-driven integration tests | cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit; bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh; bash plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh |
