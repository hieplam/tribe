# AFTER — card runner-driver-only: the closing record (Task 4.7, 2026-09-28)

One row per row of spec §6 (the verification contract). BEFORE comes from `baseline.md` (the sandbox
BEFORE numbers from spec §6.7's run); AFTER is copied from the evidence file named in the row.
`$E` = this folder; `$X` = `/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only`
(machine-local, not committed).

**How to read the verdicts.** A BEFORE-side failure, and the run-1 failure of V5, are written in
lowercase words ("did not pass", "failed", "refused"), so the uppercase verdict token marks only an
AFTER verdict — and no AFTER verdict failed. Where an evidence file prints that token for an expected
reason (V4's positive control, the plain-PR `doneAtHead` point), the row says so in words.

| Row | BEFORE | AFTER | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| **V1** (G2', D3, D8) — no prompt carries the Tribe way of working; every driver essential kept | **203** = 202 mentions in 12 of 44 kinds + 1 plugin injection (`v1-before-prompts.txt`); real prompts of the sandbox BEFORE run: **45** (`v1-before-sandbox-real-prompts.txt`) | **0**: 43 kinds, `TRIBE_WAY_TOTAL=0`, injections 0, `MISSING_REQUIRED_KINDS=0`, `G2_GATE=PASS`; real V2 prompts (6): `TRIBE_WAY_TOTAL=0`. **Disclosure:** of that 0, exactly 2 literals were excluded by ruling R-PR3-FLAG — both `--skip-gap-gate` in the supervisor closing prompt (the flag of D6's gap-gate opt-out, which the lexicon strips; no other text is excluded) | `$E/v1-after-prompts.txt`, `$E/v1-after-real-prompts.txt`; raw `$X/after-prompts/`, `$X/after-real-prompts/`, `$X/v1-after-prompts.json` | PASS |
| **V2** (G1, G2, G4; D9 sandbox) — the Go plan ships through `supervise` → watchdog → runner with no Tribe agent | Sandbox BEFORE run (master `3194976`, bare runner): shipped fixture PR #3; **7** Tribe dispatches (`tribe:hunter` 4, `tribe:skinner` 2, `tribe:tracker` 1); 0 Tribe skill calls; **0** runner-run Done rows | supervise `exit 0` (`campaign_closed`); fixture PR #4 merged (`e9e3adb`); **G1**: replay `SHIPPED=true`, all 7 points pass incl. `localBaseSynced` and `doneAtHead`; master == origin `e9e3adb0ab394aa196ba6b1d1b86e73d619bda01`, `go test exit 0` (Shaman's own A5 re-run: 4 passed, exit 0); **G2**: `TRIBE_AGENT_DISPATCHES=0`, `TRIBE_SKILL_CALLS=0` (no subagent of any type); **G4**: 26 Done rows — T1..T4 each a `passed:true` `done_run`, all 22 command rows exit 0 | `$E/v2-after-run-metrics.txt`, `$E/g3-after-v2-replay.txt`, `$E/v2-after-master.txt`, `$E/v2-before-after.md`; raw `$X/v2-after-done.jsonl`, `$X/v2-after-supervise.txt`, `$X/a5-shaman-go-test-v2.txt` | PASS |
| **G6** — before/after dispatches, time, tokens (reported, not asserted) | Sandbox BEFORE: 912.7 s executor, **3,136,069** tokens, **$2.91** (real-home supplementary: 607.0 s, 2,527,210 tokens, $2.15) | Executor **164.5 s**, **1,957,379** tokens, **$2.15**; full stack 249 s, 2,796,337 tokens, $2.63 | `$E/v2-before-after.md` | PASS (reported) |
| **V3** (D2 negative control; D9) — a task whose Done fails is never marked done | none: the runner never read the plan (spec §2.4) | V3a: 9 passed, 0 failed, `V3=PASS`. V3b (real sandbox session): runner exit 2; card `escalated`; no `passedSha`/`doneSha`; the session reported `TASK_DONE`, the runner ran the Done set — `go build` exit 0, `TestDouble` exit 0, `test "$(uname -s)" = Plan9` exit 1 — and recorded `done_run passed=False`; the session then asked `NEEDS_DIRECTION` rather than fake a pass; D10 scan `BYPASS_AUDIT=PASS`, auditor `VERDICT: CLEAN` | `$E/v3a-e2e.txt`, `$E/v3b-checks.txt`, `$E/d10-v3-scan.txt`, `$E/d10-v3-auditor.md`; raw `$X/v3-*`, `$X/v3b-runner.txt` | PASS |
| **V4** (the plan decides; D9 real home) — a Tribe-style plan on the same runner gets Tribe agents | n/a | runner exit 0 (fixture PR #5); `TRIBE_AGENT_DISPATCHES=4` (`hunter` 1, `skinner` 2, `tracker` 1); positive scanner oracle `BYPASS_TRIBE_DISPATCHES=4` — the scan's overall audit verdict does not pass, which is exactly what a positive control must show; 5 Done rows | `$E/v4-run-metrics.txt`, `$E/v4-tribe-scan.txt`; raw `$X/v4-runner.txt`, `$X/v4-tribe-style-plan.md` | PASS |
| **V5** (D7; D9 sandbox) — Stage A with no style named authors a Tribe-free, Done-complete plan and a state `--dry-run` accepts | **Run 1** (skill at master `6e3274e`): 3 passed, 2 failed — plan and state Tribe-free and fully indexed, but the authored state omitted the required `schemaLockPaths`/`docsOnlyPaths`/`ownerOnlyEscalations`, so `--dry-run` refused it (exit 4); D10 run 1: scan passed, auditor `VERDICT: CLEAN`. Owner ruling R-PR4-V5 fixed the skill: `9191c80` (SKILL.md names the required state fields; Stage A step 8 dry-runs the state it wrote) and `f2627e1` (the nullable card fields are `spec`..`updatedAt`, not `tasks`) | **Run 2** (the fixed skill): 5 passed, 0 failed, `V5=PASS` — state v2, lexicon 0 over plan + state, every task heading indexed with Done commands, `--dry-run` accepts and names the card; fixture PR #7. For run 2 the sandbox's `skills/orchestrate-campaign` symlink pointed at this branch's skill (master's would not carry the fix), set before the D10 snapshot and restored after the scan | `$E/v5-stage-a.txt`, `$E/v5-check.txt` (run history included); raw `$X/v5-*`, `$X/v5-run2-skill-link.txt` | PASS |
| **V6** (D1) — a state whose task ref names a missing heading is refused at load | master accepts it: `--dry-run` exit 0, phase `fresh` | 15 passed, 0 failed, `V6=PASS` (`test-runner-task-index-refusal.sh`: `--dry-run` and a real run both exit 4 with `refused:`, no session, state byte-identical) | `$E/v6-before-dry-run.txt`, `$E/v7-after-counts.txt` | PASS |
| **V7** (regression) — every suite green; every count change named | master `3194976`: runner 1351 pass / 14 skip / 0 fail, supervisor E2E 40/40, verify-shipped 26/26; post-#173 base `9393bb0`: runner 1357 / 14 / 0 (`v7-base-counts.txt`) | runner `bun run check` 1370 pass / 13 skip / 0 fail; supervisor E2E 40, kill 35, watchdog E2E 19, docs 41; V3 9, G5 11, V6 15; rulings-check 23; verify-shipped 29; session E2E 7 pass / 0 fail; viewer 925 pass / 3 skip and the same three pre-existing, environment-caused failures as the base (Bun's cache writing into a fixture HOME). Every count change is explained in the file | `$E/v7-after-counts.txt`, `$E/v7-base-counts.txt`, `$E/v7-changed-assertions.md`; raw `$X/v7-after/` | PASS |
| **G3'** — the done check requires nothing a Tribe agent produces | plain PR #2 replay: `SHIPPED=false`, failed points `gapGateStamped`, `ledgerCommitted`; `verify-shipped` on PR #2 did not pass (`gap_gate_stamped`); rulings probe exit 5 (`rulings_unratified`) | V2 card replay `SHIPPED=true`; plain PR #2 replay lists no `gapGateStamped`/`ledgerCommitted` — 6 points pass, only `doneAtHead` (the runner's own D2 point, which a hand-made PR has no Done run for) does not pass, as the spec's pass condition allows; `verify-shipped --skip-gap-gate` on PR #2 verdict `PASS`; rulings probe exit 0 | `$E/g3-after-v2-replay.txt`, `$E/g3-after-plain-pr2-replay.txt`, `$E/g3-before-plain-pr2-replay.txt`; raw `$X/g3-after-plain-pr2-verify-shipped.json`, `$X/g3-after-rulings-probe.txt` | PASS |
| **G5** — an empty implementation never ships | n/a (this row is G1's empty-implementation test) | 11 passed, 0 failed, `G5=PASS` (`test-runner-done-empty.sh`: do-nothing and premature-`SHIPPED` both exit 2, `done_failed`, never shipped, no `doneSha`) | `$E/v7-after-counts.txt` | PASS |
| **D10** (no bypass, both layers, after every sandbox run) | Sandbox BEFORE run: layer 1 did not pass — 7 Tribe dispatches, scan exit 1, with `SANDBOX_AGENTS_EMPTY=yes` and `SANDBOX_SURFACE_CHANGED=0` (the agents came from the runner's own plugin load, D8); layer 2 `VERDICT: BYPASS` — the expected baseline | V2, V3b, V5 run 2 and V5 run 1: every scan `BYPASS_AUDIT=PASS` (0 Tribe dispatches, 0 `mammoth-hunt`, 0 agent-file touches or definition reads, `agents/` empty, surface unchanged, no unknown entry, no repo `.claude/agents`, every transcript found); every auditor `VERDICT: CLEAN` | `$E/d10-before-sandbox-scan.txt`, `$E/d10-before-sandbox-auditor.md`, `$E/d10-v2-*`, `$E/d10-v3-*`, `$E/d10-v5-*`; raw `$X/d10-v5-scan.run1.txt`, `$X/d10-v5-auditor.run1.md` | PASS |

**Tool fix during PR 4 (`65993e9`).** `fixture-reset.sh` and `g3-verify-replay.ts` switch the host git
configuration off (`fail-closed-edges.md`); Homebrew git keeps its macOS keychain credential helper in
exactly that system configuration, so both tools could no longer fetch the private fixture. They now
name `gh auth git-credential` as the helper for their own calls; the host configuration stays off.
The runner's own git calls were never affected.

## Where everything is

Shaman amendment A5: everything needed to re-run `go test`, the scanner and an independent auditor at
acceptance. Transcript lists are the `transcripts` field of
`bun plugins/tribe/scripts/tests/runner-driver-only/bypass-audit.ts scan --home <campaign home> --claude-home <claude home> --json`
(for the two V5 runs, which have no runner session: `--transcript <main transcript>`), pasted.

### go-before — supplementary BEFORE run (today's runner, real home)

- Campaign home: `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-before`
- Claude home: `/Users/hiep/.claude` (the owner's real home)
- Transcripts:
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/ee176c4c-44d7-4dde-b1d7-e7e561c9525f.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/ee176c4c-44d7-4dde-b1d7-e7e561c9525f/subagents/agent-a00c47a74127d444f.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/ee176c4c-44d7-4dde-b1d7-e7e561c9525f/subagents/agent-a1aa9b77071c2d78a.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/ee176c4c-44d7-4dde-b1d7-e7e561c9525f/subagents/agent-a306fbe5eeb1cdfcc.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/ee176c4c-44d7-4dde-b1d7-e7e561c9525f/subagents/agent-aba45d812325475d9.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/ee176c4c-44d7-4dde-b1d7-e7e561c9525f/subagents/agent-abdaa0886a78c71c3.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/ee176c4c-44d7-4dde-b1d7-e7e561c9525f/subagents/agent-abfadc933cf8f8fe5.jsonl`

### go-before-sandbox — the ratchet BEFORE run (spec §6.7, today's runner, sandbox)

- Campaign home: `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-before-sandbox`
- Claude home: `/Users/hiep/.claude-sandboxes/runner-driver-only` (the D9 sandbox)
- Transcripts:
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2/subagents/agent-a309a9d6b2a973b10.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2/subagents/agent-a3e981ec11c13e6f0.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2/subagents/agent-a3f1ab2be9649a7ce.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2/subagents/agent-a46265eab0196bfa9.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2/subagents/agent-a69403f9b5e17e9e3.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2/subagents/agent-ab76aee9c8637b2bd.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/d42d3d64-fba0-48c6-84cc-81923c5756b2/subagents/agent-aeb6a6c631df8ab08.jsonl`

### go-after — V2 (this branch, full stack, sandbox)

- Campaign home: `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-after`
- Claude home: `/Users/hiep/.claude-sandboxes/runner-driver-only`
- Transcripts (executor, then the supervisor's closing session; no subagents):
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/69c3cddc-8199-41df-998a-cda2125a826a.jsonl`
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/a38559d6-d8df-4a3f-a846-02afb9f14e8e.jsonl`

### go-v3-real — V3b (this branch, bare runner, sandbox)

- Campaign home: `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-v3-real`
- Claude home: `/Users/hiep/.claude-sandboxes/runner-driver-only`
- Transcripts:
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/53b7da65-56e0-4449-ada7-f4b7bc3f5a23.jsonl`

### go-v4-tribe — V4, the positive control (this branch, real home)

- Campaign home: `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-v4-tribe`
- Claude home: `/Users/hiep/.claude`
- Transcripts:
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/d2865f4d-4128-4897-97c2-2757dc5cd56c.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/d2865f4d-4128-4897-97c2-2757dc5cd56c/subagents/agent-a029f03c979db069e.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/d2865f4d-4128-4897-97c2-2757dc5cd56c/subagents/agent-a5fddb40c2b785e10.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/d2865f4d-4128-4897-97c2-2757dc5cd56c/subagents/agent-a98ffff37f1c4f88a.jsonl`
  - `/Users/hiep/.claude/projects/-Users-hiep-repo-runner-e2e-go/d2865f4d-4128-4897-97c2-2757dc5cd56c/subagents/agent-aa1e682cdb8dc3152.jsonl`

### go-v5-stage-a — V5 run 2 (the fixed skill, sandbox)

- Campaign home: `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-v5-stage-a`
- Claude home: `/Users/hiep/.claude-sandboxes/runner-driver-only` (its `skills/orchestrate-campaign` link
  pointed at this branch's skill for the run, restored after; `$X/v5-run2-skill-link.txt`)
- Transcripts (one Stage A session, no subagents):
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/2a4fd242-4bb9-4982-85d4-8562d124bd7e.jsonl`

### go-v5-stage-a-run1 — V5 run 1 (the skill at master `6e3274e`, sandbox)

- Campaign home: `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-v5-stage-a-run1`
- Claude home: `/Users/hiep/.claude-sandboxes/runner-driver-only`
- Transcripts (one Stage A session, no subagents):
  - `/Users/hiep/.claude-sandboxes/runner-driver-only/projects/-Users-hiep-repo-runner-e2e-go/9f2c11e8-7eb5-47e1-af8e-5f3beb63cd27.jsonl`

### Planning-time homes (no transcripts)

`/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/g3-plain-baseline`,
`/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/g3-rulings-baseline`,
`/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/v6-baseline`.

### The fixture

- Local clone `/Users/hiep/repo/runner-e2e-go` (`hieplam/runner-e2e-go`); final `origin/master`
  `374ae711dd1fdcc86542cd368e733b22970c21c6` — the reset to S0's tree (`86031f3c`) after V5 run 2.
- V2 shipped merge: `e9e3adb0ab394aa196ba6b1d1b86e73d619bda01` (re-run `go test ./...` there).

### The three E2E scripts

- `plugins/tribe/scripts/tests/test-runner-done-negative.sh` (V3a)
- `plugins/tribe/scripts/tests/test-runner-done-empty.sh` (G5)
- `plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh` (V6)

### Every raw evidence file in `$X`

All under `/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/` (machine-local, not
committed). Rendered-prompt and log folders are listed as folders.

Folders:
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/after-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/after-real-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/base-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/before-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/before-real-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/before-sandbox-real-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/pr1-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/pr2-prompts/`,
`/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/v7-after/`.

Files (prefix `/Users/hiep/.tribe/-Users-hiep-repo-tribe/evidence/runner-driver-only/` on each):
`a5-shaman-go-test-v2.txt`, `campaign-report.md`, `d10-before-sandbox-scan.json`,
`d10-before-sandbox-snapshot.json`, `d10-v2-sandbox-before.json`, `d10-v2-scan.json`,
`d10-v3-sandbox-before.json`, `d10-v3-scan.json`, `d10-v5-auditor.run1.md`,
`d10-v5-sandbox-before.json`, `d10-v5-scan.json`, `d10-v5-scan.run1.json`, `d10-v5-scan.run1.txt`,
`final-report.md`, `g3-after-plain-pr2-verify-shipped.json`, `g3-after-rulings-probe.txt`,
`g3-before-plain-pr2-verify-shipped.json`, `g3-before-plain-state.json`,
`g3-before-plain-state.v1.json`, `g3-before-rulings-gate-stdout.txt`, `v1-after-prompts.json`,
`v1-before-prompts.json`, `v2-after-campaign-state.authored.json`, `v2-after-done.jsonl`,
`v2-after-end.txt`, `v2-after-ledger.jsonl`, `v2-after-run-metrics.json`, `v2-after-start.txt`,
`v2-after-supervise.txt`, `v2-after-verdict.json`, `v2-before-campaign-report.md`,
`v2-before-campaign-state.json`, `v2-before-pr1.json`, `v2-before-run-metrics.json`,
`v2-before-runner-stdout.txt`, `v2-before-sandbox-campaign-state.authored.json`,
`v2-before-sandbox-end.txt`, `v2-before-sandbox-run-metrics.json`, `v2-before-sandbox-runner.txt`,
`v2-before-sandbox-start.txt`, `v2-before-subagents-meta.txt`, `v3-campaign-state.authored.json`,
`v3-campaign-state.final.json`, `v3-done.jsonl`, `v3-escalation.md`, `v3-final-state.json`,
`v3-negative-plan.md`, `v3-runner.out`, `v3b-end.txt`, `v3b-runner.txt`, `v3b-start.txt`,
`v4-campaign-state.authored.json`, `v4-end.txt`, `v4-runner.txt`, `v4-start.txt`,
`v4-tribe-style-plan.md`, `v5-authored-plan.md`, `v5-authored-plan.run1.md`,
`v5-authored-state.json`, `v5-authored-state.run1.json`, `v5-end.txt`, `v5-run2-skill-link.txt`,
`v5-session.json`, `v5-session.run1.json`, `v5-stage-a.run1.txt`, `v5-start.txt`,
`v5-check.run1.txt` (V5 run 1's check output), `v6-before-state.json`.
