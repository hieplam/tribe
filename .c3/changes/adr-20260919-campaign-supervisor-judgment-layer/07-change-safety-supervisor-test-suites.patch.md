---
target: c3-215
scope: block
base: c3-215#n1694@v1:sha256:c7706f0508c54de4744a4334577931e7eeb45ee99fe61cc45d16c514c43b649a
---
| A wrong decide() row spawns a supervision session that was not needed, or parks one that should have run | Editing core/supervisor/** (the pure decide table, verify postconditions, the brief renderer, state/status shaping) | The row-per-case decide.test.ts table plus the pure verify/state/status suites; a mocked seam validates the logic but the real session is wired only by the Task-14 loop — the empty-home end-to-end and kill/restart suites drive that wiring on a real filesystem | cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit; plus the loop driven end-to-end on an empty home: plugins/tribe/scripts/tests/test-supervisor-e2e.sh (both invocation shapes, --campaign and --home, G1/G4) and plugins/tribe/scripts/tests/test-supervisor-kill.sh (three kill/restart adoption instants, G4); and the opt-in billed real run plugins/tribe/scripts/tests/test-supervisor-real-e2e.sh, an enforcement surface gated on TRIBE_REAL_E2E=1 (a real unattended Haiku supervise loop, run only when that env var is set) |
