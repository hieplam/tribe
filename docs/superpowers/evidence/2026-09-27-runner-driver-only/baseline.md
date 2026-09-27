# BEFORE baselines — card runner-driver-only (measured 2026-09-27, planning, master `3194976`)

Every number below was produced by a real run or a committed tool during planning, before any
building. Tools: `plugins/tribe/scripts/tests/runner-driver-only/`. Fixture: `hieplam/runner-e2e-go`
(local clone `/Users/hiep/repo/runner-e2e-go`), starting tree `S0 = 9bb6b22` (tree `86031f3c`).

| Row | Measurement | BEFORE value | Evidence |
| --- | --- | --- | --- |
| V1 (G2') | Tribe-way mentions in every prompt the runner/watchdog/supervisor can send (44 kinds) + non-prose injections | **202 mentions in 12 kinds + 1 plugin injection = 203**; watchdog 0 (sends no prompt) | `v1-before-prompts.txt`, `v1-before-prompts.json`, `before-prompts/` |
| V1 (real) | Tribe-way mentions in the prompts a real run actually sent (BEFORE run transcript) | **45** (the one executor brief) | `v1-before-real-prompts.txt`, `before-real-prompts/` |
| V1 essentials | AFTER-only kinds absent today | 6 kinds missing (`turn-*`, `hook-merge-head-not-done`, `escalation/done-failed`); brief lacks task id, heading, `TASK_DONE` | `v1-before-prompts.txt` (tail) |
| **V2 / G6 — ratchet baseline (D9: sandbox)** | Same Go plan on today's runner (`3194976`) with `CLAUDE_CONFIG_DIR=/Users/hiep/.claude-sandboxes/runner-driver-only` (`agents/` empty; auth via the sandbox `settings.json` `CLAUDE_CODE_OAUTH_TOKEN`, owner ruling) | **shipped** PR #3 (runner exit 0) in **912 s**; **7 Tribe dispatches** (4 `tribe:hunter`, 2 `tribe:skinner`, 1 `tribe:tracker` — all from the runner's own plugin load); 0 Tribe skill calls; **0** runner-run Done rows; tokens **3,136,069**; cost **$2.9096**; real-prompt Tribe-way mentions **45**; D10 layer 1 `BYPASS_AUDIT=FAIL` (7 dispatches) with `SANDBOX_AGENTS_EMPTY=yes`, `SANDBOX_SURFACE_CHANGED=0`, 0 agent-file touches (D8 proven: the agents came from the runner, not the sandbox); D10 layer 2 `VERDICT: BYPASS` | `v2-before-sandbox-*`, `v1-before-sandbox-real-prompts.txt`, `d10-before-sandbox-{scan.txt,scan.json,snapshot.json,auditor.md}` |
| V2 / G6 — supplementary (real home) | Same Go plan on today's runner (`run.ts --model sonnet --no-viewer`, campaign `go-before`) | **shipped** PR #1 (merge `6ad5914`) in **607 s**; **6 Tribe dispatches** (4 `hunter`, 1 `skinner`, 1 `tracker`; 0 `general-purpose` although the plan asks for it); **0** Tribe Skill calls; **0** runner-run Done rows; tokens **2,527,210** (input 66, cache-write 70,566, cache-read 2,444,093, output 12,485); cost **$2.1518** | `v2-before-run-metrics.{txt,json}`, `v2-before-subagents-meta.txt`, `v2-before-pr1.json`, `v2-before-campaign-report.md`, `v2-before-runner-stdout.txt` |
| V2 note | The Shaman's expectation "it cannot reach `shipped` without a gap-gate stamp" | **Refuted**: the brief makes the executor dispatch a Tracker and run `gap-gate.ts`, so PR #1 carries a stamp (`v2-before-pr1.json`, body tail) | same |
| G3' | Today's done check (`verifyShipped`) replayed on a plain PR (#2: the same Go code, no Tribe process, CI green, merged) | **`SHIPPED=false FAILED_POINTS=gapGateStamped,ledgerCommitted`** (5 generic points pass) | `g3-before-plain-pr2-replay.txt`, `g3-before-plain-state.json` |
| G3' | Same replay on the Tribe-run PR #1 | 7/7 pass | `g3-before-tribe-pr1-replay.txt` |
| G3' | Supervisor closing oracle: `verify-shipped` on PR #2 | **`FAIL`** (`gap_gate_stamped: fail`; merged, master in sync, worktree removed pass) | `g3-before-plain-pr2-verify-shipped.json` |
| G3' | Runner rulings gate: a finished campaign with one ordinary owner ruling (no `ratified-as:`) | **exit 5**, `reason: rulings_unratified` | `g3-before-rulings-gate-stdout.txt` |
| V6 | A state whose task ref names a heading the plan does not have | **accepted**: `--dry-run` exit 0, phase `fresh` (master never reads task refs) | `v6-before-dry-run.txt`, `v6-before-state.json` |
| V3 / G5 | Runner-run Done commands | **none exist** — the runner never reads the plan (`core/brief.ts:55-84`) | spec §2.4 |
| D10 layer 1 | `bypass-audit.ts` on a transcript known to contain Tribe dispatches (fu-supervisor-settings executor `b3bf06c3…`) | **18** Tribe dispatches, 2 agent-file touches — nonzero, as required; on the real-home BEFORE run **6**; a planted `agents/hunter.md` in a sandbox copy is caught | `d10-scanner-selftest.md`, `d10-scanner-selftest-known-tribe.txt`, `d10-before-realhome-scan.txt` |
| A1 gate | `no-live-campaign.sh` on this machine | **exit 1**: `sessions-in-repo`'s watchdog (pid 15716) and runner (pid 70499) are live, its card is `running`, and its v1 state holds a live `.runner.lock` — execution must not start yet | `d10-scanner-selftest.md` (gate self-tests) |
| V7 | Runner suite and supervisor E2E on a clean clone | runner **1351 pass / 14 skip / 0 fail** (4:58 wall); supervisor E2E **40/40**; verify-shipped **26/26** | `v7-before-runner-check.txt`, `v7-before-supervisor-e2e.txt` |
| V7 | Existing assertions the change touches | ~190 assertions across 30+ files, inventoried | `v7-changed-assertions.md` |

Fixture history created during planning (never rewritten): `9bb6b22` S0 → PR #1 (BEFORE run,
merge `6ad5914`) → `8b76911` reset to S0's tree → PR #2 (plain baseline, merge `b32859a`) →
`791a7d5` reset to S0's tree. The AFTER run starts from `fixture-reset.sh` to S0's tree again.
