# Runner — run the newest model, and fail closed when a model is unsupported (design)

**Card:** `~/.tribe/-Users-home-repos-tribe/cards/runner-model-support.md` (issue hieplam/tribe#207;
goals G1–G5, rulings D1–D4) · **Base:** `master` @ `d3edaf0` · **Branch:** `feat/runner-model-support`
· **Plan:** `docs/superpowers/plans/2026-10-01-runner-model-support.md`

## 1. The problem, grounded

On 2026-10-01 the campaign `llm-wiki` (repo hieplam/Cabal) was launched with
`--model claude-opus-5-5`. Every executor session died in about 0.6 s, and the campaign parked
`session_incomplete` after 23 spawns. Three gaps, each checked against code and a real run:

1. **The SDK is too old for the newest model.** `plugins/tribe/scripts/runner/package.json` pins
   `@anthropic-ai/claude-agent-sdk` `^0.3.278`; `bun.lock` freezes 0.3.278, whose bundled Claude Code
   is 2.1.278. The API refuses Opus 5.5 below 2.1.280. The latest published SDK is 0.3.286 (bundled
   Claude Code 2.1.286). The SDK is imported only by `adapters/session.adapter.ts`
   (`structure.test.ts`: "only adapters/session.adapter.ts imports the Agent SDK").
2. **Nothing checks a model before launch.** `plugins/tribe/scripts/doctor.sh` checks bun, gh,
   the Claude Code login, the runner's `node_modules` and the viewer build — no model. `--dry-run`
   is the runner's zero-LLM check and must stay one (ruling D2).
3. **A permanent API error is retried as an ordinary crash, three layers deep.** The real `result`
   line has `subtype: "success"`, `is_error: true`, `api_error_status: 400`,
   `api_error_code: "claude_code_version_too_old"`, and no terminal line, so:
   - the runner: `core/session.ts` `parseResultMessage` → outcome `error`; `core/loop/turns.ts`
     returns `stopped` with `retryable: result.outcome === 'error'` (true); `core/loop/run-loop.ts`
     `runCardTurn` retries twice, and each retry resumes the session and then falls back to a fresh
     one (`core/loop/card-actions.ts` `runTurn`) — **5 spawns per card per run**; the pass then moves
     to the next card;
   - the watchdog: `core/watchdog/signals.ts` keeps only `is_error` and the overload statuses from the
     result line; `core/watchdog/decide.ts` section 4 relaunches on `crash` until
     `--max-crash-relaunches`, then exits `session_incomplete`;
   - the supervisor: `core/supervisor/decide.ts` rows 16–17 retrigger the watchdog once, then park
     `session_incomplete` ("Investigate why the executor session never completed").

### Measured (planning experiments, 2026-10-01, all re-runnable)

| Experiment | Result |
| --- | --- |
| Real SDK `query()`, `claude-opus-5-5`, SDK 0.3.278 | `result`: `is_error: true`, `api_error_status: 400`, `api_error_code: "claude_code_version_too_old"`, 553 ms. The SDK iterator **throws** ("Claude Code returned an error result") after delivering that result. |
| Same, SDK 0.3.286 | `init` `claude_code_version: 2.1.286`; `result` `is_error: false`, `result: "OK"`, 1.8 s, $0.115 with the default prompt; **$0.0069** with the probe shape (`systemPrompt` one line, `tools: []`, `settingSources: []`, `maxTurns: 1`). |
| Real `runSession` (the executor's own pinned options) on `claude-opus-5-5`, 0.3.286 / 0.3.278 | outcome `needs_direction`, result `is_error: false` / `is_error: true`, `api_error_code: claude_code_version_too_old`. |
| Unknown model `claude-nonexistent-9` and `not a model!`, 0.3.286 | `is_error: true`, `api_error_status: 404`, **no `api_error_code` field**, `result: "There's an issue with the selected model (…). It may not exist or you may not have access to it. …"` |
| The real Cabal result line replayed through the runner's executor double, today's code | one `run.ts` pass over 3 cards: **15** spawns; `--max-concurrent 2`: **15**; `watchdog --follow`, 1 card: **11** spawns, terminal `session_incomplete`; `supervise`, 1 card: **23** spawns, park `session_incomplete` — the Cabal number exactly. |
| D4: after that park, `reset-card`, delete `NEEDS_OWNER.md`, re-run `supervise` | **Reproduced.** Exit 20 at once, 0 new spawns, no `run_watchdog` event, park `session_incomplete` again. |

**D4 root cause.** At start the supervisor reads `watchdog/status.json` as `lastWatchdog`
(`core/supervisor/loop.ts` `observe`), whose terminal is still the old `session_incomplete`, and
`supervisor/state.json` still holds `retriggers.session_incomplete: 1`. Rows 16–17 therefore park
before any watchdog runs. The same holds for every park decided from the watchdog's terminal
(`quota_cap`, `overloaded`, `stalled`, `lock_conflict`, `error`, … — rows 18–22 park on the stale
terminal unconditionally). Deleting `NEEDS_OWNER.md` is documented as the owner's "I have handled
it" signal (`skills/orchestrate-campaign/SKILL.md`, doorbell step 5), but nothing reads it as one.

**A defect found on the way (out of fence, reported).** `decide.ts`'s G5 rule replaces the
watchdog's terminal reason with the run's own `run.json` reason whenever the terminal's own run has
finalised (`truth.ts` `terminalContradiction` counts the terminal's own run). The run's reason for
exit 3 is always `session_incomplete`, so an `overloaded` or `quota_cap` terminal is re-read as
`session_incomplete` — and because the retrigger counter is keyed on the raw terminal, the supervisor
then re-runs the watchdog until `--max-watchdog-runs` (20). Measured with a one-off `decide()` call
on today's code: `overloaded`, `quota_cap` → `run_watchdog`. This card exempts only
`permanent_api_error` (§3.5); the overload/quota case is retry policy, which the card's fence keeps
out — a follow-up issue.

## 2. Goals (from the card) and how each is proven

| # | Goal | Oracle | Ratchet |
| --- | --- | --- | --- |
| G1 | A campaign on `claude-opus-5-5` runs its executor session | END-TO-END: `RUN_SESSION_E2E=1 bun test core/model-support.e2e.test.ts` — the runner's own `runSession` + real `sdkSpawnSession` → non-error result; on 0.3.278 the same test fails with `claude_code_version_too_old` (measured, §1) | probe on `claude-opus-5-5`: refused → ok |
| G2 | `doctor.sh --model <id>` refuses a model the runner's SDK cannot run, naming model, the API's reason, and the fix; a supported model reports ok | END-TO-END: the real `doctor.sh --model` against the real API (before and after the bump), plus `tests/test-doctor-model.sh` (hermetic, real captured result lines) for exit codes | — |
| G3 | A permanent API error parks the campaign on the FIRST occurrence with the exact `api_error_code` in the reason and owner text, and spawns nothing more | `tests/test-runner-permanent-api-error.sh` (real `run.ts` runner / watchdog / supervise, executor double printing the real Cabal line) + unit tables on the pure decide functions | supervise spawns before park: **23 → 1**; runner pass (3 cards): 15 → 1; pool: 15 → 2; watchdog: 11 → 1 |
| G4 | The documented recovery resumes the campaign | the same tool's `recovery` probe: after reset-card + deleting `NEEDS_OWNER.md`, `supervise` runs a fresh watchdog and the runner spawns again | recovery spawns: 0 → ≥ 1 |
| G5 | The orchestrate-campaign preflight runs `doctor.sh --model` for every campaign model | the skill's preflight text names it; `test-supervisor-docs.sh`, `brief.test.ts`, the ways-of-work counter stay green | — |

## 3. The change

### 3.1 The ratchet tool comes first (Task 1)

- `adapters/executor-double.adapter.ts` gains `doubleResultMessage(stdout, sessionId)`: when the
  double's last stdout line is a whole `result` message, it is yielded as that message (session id
  overridden to the double's own); any other stdout stays the final text, exactly as today.
- `fixtures/executor/session-double.sh` gains `DOUBLE_MODE=result-line` (prints
  `$DOUBLE_RESULT_FILE`).
- Two fixtures, real bytes: `fixtures/executor/result-claude-code-version-too-old.json` (the Cabal
  line, byte for byte) and `fixtures/executor/result-model-not-found-404.json` (captured today), with
  a provenance README.
- `plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh`: builds its world from nothing
  (bare origin, clone, cards, campaign home under its own `HOME`), runs the real `run.ts` at each
  layer, and either asserts the targets or (`--measure`) prints the numbers. The supervisor's own
  sessions point at `/usr/bin/false` and `--max-spawns 0`, so no real model is ever called.
- The baseline is committed: `docs/superpowers/evidence/2026-10-01-runner-model-support-g3-baseline.txt`.

### 3.2 The model probe and `doctor.sh --model` (Task 2) — G2, D2

- **Pure core** `core/model-probe.ts`: `buildProbeOptions` (the probe's own option block: one
  turn, no tools, no settings, a one-line system prompt — not the executor's pinned block),
  `classifyProbe` (ok only for `subtype: success` and `is_error` not true), `remedyFor` (the fix,
  chosen from typed facts: the SDK bump for `claude_code_version_too_old`; "check the model id" for
  404; "re-run when the network and login work" for no result), `renderProbeLines`
  (`ok: …` / `refused: …` + `fix: …`), `parseProbeArgs` (fail-closed), and `runModelProbe`, which
  stops at the **first** result (the SDK throws after an error result) and is bounded by a timeout
  that also aborts the session.
- **Edge:** `sdkSpawnProbe` in `adapters/session.adapter.ts` (the only SDK importer stays the
  only one); `run.ts probe-model --model <id> [--timeout-seconds N]` in `cli/main.ts`, which removes
  `ANTHROPIC_API_KEY` first (P10), honours `TRIBE_RUNNER_SESSION_DOUBLE` like every runner spawn, and
  exits 0 / 1 / 2.
- **`doctor.sh --model <id>`** (repeatable): a fail-closed argument loop (exit 2 on an unknown
  argument or a missing id — never swallowing the next flag), then one probe per model, bounded by
  `perl -e alarm` at 180 s (this machine has no `timeout(1)`), run with `env -u ANTHROPIC_API_KEY`.
  Doctor only relays the probe's lines: `ok …`, or `MISSING …` + `-> fix`. Without `--model` doctor
  behaves exactly as today.

### 3.3 The SDK bump (Task 3) — G1, D1

`package.json` `^0.3.286`, `bun.lock` refreshed by `bun install`. Nothing else changes (the SDK
touches only `session.adapter.ts`). The full runner suite after the bump was measured at
1368 pass / 2 fail — the 2 are the inherited `watchdog-integration.test.ts` "G2 — skip when alive"
failures, present on master.

### 3.4 The runner stops on a permanent API error (Task 4) — G3

- **Pure core** `core/api-error.ts`: `PERMANENT_API_ERROR_CODES` (the allowlist, ruling D3) and
  `permanentApiErrorOf(message)` — the ONE parser of that question
  (`rule-one-parser-per-edge-shape`); the runner and the watchdog both call it.
- `session.ts` `parseResultMessage` checks it first → `{ outcome: 'error', permanentApiError }`.
- `turns.ts`: a permanent error → `stopped`, `retryable: false`, `permanentApiErrorCode`.
- `card-actions.ts`: a resumed session that ends on a permanent error is returned as is — no fresh
  fallback session.
- `run-loop.ts`: the serial pass breaks after such a card; the pool launches no further card (the
  ones in flight finish). The runner still exits 3.

**The allowlist holds only `claude_code_version_too_old`.** It is the only code a real run returned;
an unknown model returns no code (§1). Treating a transient error as permanent is the worse error
(card D3), so an unknown model stays on the ordinary path and `doctor.sh --model` refuses it before
launch. (This is the open question in §7.)

### 3.5 The watchdog (Task 5) and the supervisor (Task 6) park on the first occurrence — G3

- `watchdog/signals.ts`: `permanentApiError` — present only when the LAST result in the tail is
  permanent (absent otherwise, so every existing `toEqual` assertion stays as written).
- `watchdog/decide.ts` section 4, first: a permanent error on a run **this invocation tracked**
  (`lastExitCodeProvenanced`) → `exit(needs_human:permanent_api_error)` with `apiErrorCode`. It
  outranks quota, overload, the crash budget and STOP (W-P1: a terminal fact, not a request to start
  work). An older run's log, read again by a fresh watchdog after the owner's fix, launches instead —
  without the provenance gate the recovery (§3.6) would re-park inside the watchdog.
- `watch-loop.ts` passes the signal and writes `apiErrorCode` into `status.json`'s terminal and the
  `exit` event — only on that terminal; every other terminal keeps its shape.
- Supervisor: `ParkReason` gains `permanent_api_error` (20 values); `loop.ts` reads
  `terminal.apiErrorCode` (string only, fail closed); `decide.ts` parks at once with the code in the
  detail; the G5 run-reason substitution is skipped for a `permanent_api_error` terminal about the
  watchdog's OWN run (a newer finalised run still substitutes, as before); `status.ts` gains the
  frozen sentence pair and renders `**Park reason:** permanent_api_error (<code>)` plus
  ``API error code: `<code>` `` — a typed fact, never prose.

### 3.6 The documented recovery resumes the campaign (Task 7) — G4, D4

- At start, `loop.ts` already snapshots the previous run's park (`priorParkedTerminal`). If
  `NEEDS_OWNER.md` is already gone at that moment, the snapshot becomes `acknowledgedPark` — the
  owner deleted it, which the skill documents as "I have handled it".
- `decide.ts` row **P5** (after P4, before the main rows): an acknowledged park whose reason was
  decided from the watchdog's terminal (`session_incomplete`, `permanent_api_error`, `quota_cap`,
  `overloaded`, `stalled`, `lock_conflict`, `error`, `unexpected_running`, `watchdog_no_terminal`,
  `watchdog_usage`) → `run_watchdog` with retrigger `owner_resume`, still under
  `--max-watchdog-runs`. Escalation and session parks are left out: their rows re-read the escalation
  files and `answers.md` the owner just edited, which is already their recovery.
- The loop, carrying out `owner_resume`: `clearWatchdogRetriggers` (pure, `state.ts`) resets the
  three watchdog one-shot keys — `session_incomplete`, `watchdog_no_terminal`, `stale_terminal` —
  and keeps every other counter (spawns, ruling rounds, the repeat-escalation breaker, session
  retries); the acknowledgement is cleared so it decides at most one tick.
- A `NEEDS_OWNER.md` still present is refused exactly as before (P2).

### 3.7 Docs (Task 8 — G5) and governance (Task 9)

- `orchestrate-campaign/SKILL.md`: the preflight runs `doctor.sh --model <executor> --model
  <watchdog>`; the watchdog reason list names `permanent_api_error`; doorbell step 6 says deleting
  the file lets a watchdog-terminal park resume.
- Runner README: a "Permanent API errors and the model probe" section, a watchdog table row, the
  exit-10 reason list, two supervisor table rows (P5, `permanent_api_error`).
- C3 (`c3-215`): the doctor, watchdog and supervise contract rows, through a change-unit
  (`c3x change`), never by hand.

## 4. Purity (pure-core.md)

| Logic | Pure core | Effects (edge), through |
| --- | --- | --- |
| Which errors are permanent | `core/api-error.ts` | — |
| Probe verdict, fix, output lines, args | `core/model-probe.ts` | the SDK via the injected `ProbeSpawn` (`sdkSpawnProbe` / the double), wired in `cli/main.ts` |
| Runner stop | `session.ts`, `turns.ts`, `run-loop.ts` decisions | spawns via `SessionIO` (unchanged) |
| Watchdog exit | `decide.ts`, `signals.ts` | log tail via `WatchdogIO.readTail`; status via `writeFileAtomic` |
| Supervisor park / resume | `decide.ts`, `state.ts` | `NEEDS_OWNER.md` presence and the status snapshot read once in `runSupervisor` |
| doctor | none — it only relays the probe's lines | `bun run.ts probe-model`, bounded, `env -u ANTHROPIC_API_KEY` |

## 5. Scope fence (the card's, honoured)

IN: `plugins/tribe/scripts/runner/**` (package.json, bun.lock, session/turns/run-loop/card-actions,
watchdog and supervisor signal + decide + status text, adapters, fixtures), `doctor.sh`, the
orchestrate-campaign preflight text, the runner README, the C3 rows this makes stale, new tests.
OUT: the default models; the local CLI binary (D1); any probe in `--dry-run` (D2); overload/quota
retry policy (the G5 substitution defect in §1 is reported, not fixed); the live Cabal campaign home
(never touched — its result line was read once and copied into a fixture). Every new subprocess has
a timeout; the probe never reads `ANTHROPIC_API_KEY`.

## 6. Risk and rollback

- **A transient error mistaken for permanent** parks a healthy campaign. Bounded by the allowlist
  (one observed code) and by the recovery (§3.6), which resumes with one owner action.
- **SDK bump regressions.** The full runner suite was run on 0.3.286 during planning (§3.3). Rollback:
  revert `package.json` + `bun.lock`.
- **P5 resuming a park it should not.** Bounded to watchdog-terminal parks, to one tick per
  supervisor start, to the watchdog-run cap, and to a deliberately deleted `NEEDS_OWNER.md`.
- Every change is additive in shape (optional fields, a new reason, a new subcommand); reverting the
  merge restores today's behaviour.

## 7. Open question for the Shaman (ruling D3's list contents)

An unknown model id returns HTTP 404 with **no `api_error_code`**. D3 asked for "whatever the SDK
emits for an unknown/invalid model"; it emits a status, not a code. Options: (a) the allowlist stays
`claude_code_version_too_old` only — an unknown model keeps today's retry path and is refused before
launch by `doctor.sh --model` (the plan as written); (b) also treat `is_error` + HTTP 404 with no code
as permanent, under a synthesized label. Recommendation: (a) — it is the oracle's safe direction, the
preflight covers the case, and (b) is a one-row change to `permanentApiErrorOf` later if a real
campaign shows it is needed.

## 8. Evidence plan

Before/after, all through committed tools: the G3 tool's `--measure` output (baseline committed in
Task 1, the final review re-runs it: 23 → 1, 15 → 1, 15 → 2, 11 → 1, recovery 0 → ≥ 1); the real
`run.ts probe-model --model claude-opus-5-5` (refused on 0.3.278 → ok on 0.3.286); the G1 e2e test
(fails on 0.3.278 → passes); the real `doctor.sh --model claude-opus-5-5 --model claude-nonexistent-9`
output; the rendered `NEEDS_OWNER.md` from the tool's supervise probe.
