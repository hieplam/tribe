# V2 / G6 — the same Go plan, before → after

Same fixture plan (`docs/plans/2026-09-27-small-helpers.md`, 4 tasks), same starting tree (`86031f3c`),
model `sonnet`. Reported, not asserted (G6).

- **BEFORE (ratchet baseline)** — today's runner at master `3194976`, sandbox `CLAUDE_CONFIG_DIR`
  with `agents/` empty, bare runner (`go-before-sandbox`, spec §6.7). Source: `v2-before-sandbox-run-metrics.txt`;
  raw `$X/v2-before-sandbox-*`.
- **AFTER** — this branch, sandbox, full stack `supervise` → watchdog → runner (`go-after`). Source:
  `v2-after-run-metrics.txt`; raw `$X/v2-after-*`.
- **Supplementary** — today's runner in the owner's real home (`go-before`). Source:
  `v2-before-run-metrics.txt`; raw `$X/v2-before-*`.

| Measure | BEFORE (sandbox) | AFTER (sandbox, full stack) | Supplementary: BEFORE (real home) |
| --- | --- | --- | --- |
| Outcome | shipped fixture PR #3 | shipped fixture PR #4 (merge `e9e3adb`), supervisor `campaign_closed`, exit 0 | shipped fixture PR #1 |
| Tribe agent dispatches, by type | **7** — `tribe:hunter` 4, `tribe:skinner` 2, `tribe:tracker` 1 | **0** — none (no subagent of any type) | 6 — `hunter` 4, `skinner` 1, `tracker` 1 |
| Tribe skill calls | 0 | **0** (other skills: `verify-shipped` 1, closing session) | 0 |
| Runner-run Done rows | **0** | **26** (4 passing `done_run` rows, one per task, each re-running every earlier task's commands) | 0 |
| Executor wall clock (runner span) | 912.7 s | **164.5 s** | 607.0 s |
| Full-stack wall clock | n/a (bare runner) | 249 s (`supervise` start 06:01:29Z → end 06:05:38Z) | n/a (bare runner) |
| Executor tokens | 3,136,069 | **1,957,379** | 2,527,210 |
| Full-stack tokens (executor + supervisor closing) | n/a | 2,796,337 | n/a |
| Cost (executor) | $2.91 | **$2.15** | $2.15 |
| Cost (full stack) | n/a | $2.63 | n/a |

Observation (not a gate): the AFTER executor did the four tasks itself, one commit per task, and
dispatched no subagent although the fixture plan's "How to work" says one `general-purpose`
subagent per task. The runner neither asks for nor forbids a subagent; that choice is the session's
reading of the plan. V4 is the check that a plan asking for Tribe agents gets them.
