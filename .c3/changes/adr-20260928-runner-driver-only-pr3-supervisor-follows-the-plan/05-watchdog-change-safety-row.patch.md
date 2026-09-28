---
target: c3-215
scope: block
base: c3-215#n2292@v1:sha256:a8274a397b4d7fe810793ba7b56f2ae3800e0c36ea89508bd52a42b99d219830
---
| The watchdog waits forever, relaunches forever, or kills a healthy runner | Editing core/watchdog/* | The 40-row action-table test (5 runner exit codes; the runner never exits 5) plus the double-driven integration tests | cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit; bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh; bash plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh |
