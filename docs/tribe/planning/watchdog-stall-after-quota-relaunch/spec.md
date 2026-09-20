# Spec — watchdog-stall-after-quota-relaunch

**Card:** `~/.tribe/-Users-hip-repo-tribe/cards/watchdog-stall-after-quota-relaunch.md`
(2026-09-18 revision + Amendment S1 + Amendment S2 + the 2026-09-19 observation)
**Branch:** `fix/watchdog-stall-after-relaunch` · **Base:** `origin/master` `0ca94dc`
**Component:** `c3-215` (tribe plugin), row 81 `scripts/runner/run.ts watchdog`,
ADR `adr-20260904-mechanical-heartbeat-supersedes-p14`

---

## 1. Oracle (this section is the contract; nothing else is)

Taken verbatim from the card's Amendment S1 ruling, which supersedes the 2026-09-11 "Why"
paragraph's mechanism guess:

> "a relaunch of ANY cause (`quota`, `overload`, `crash`, `lock_free`) must not be judged
> stalled on silence that happened before that relaunch."

> "a genuinely silent relaunched runner MUST still be reported stalled after `--stall-minutes`
> of its own silence. Suppressing stalls wholesale after a relaunch is a failed fix."

And S1's invariant **D2**, verbatim:

> "**D2 — Invariant: the stall verdict only ever concerns the run the watchdog is supervising
> right now.** A log that belongs to any earlier run can never produce a `stall`.
> `status.json.runId` and the `stall` event's log path must name the same run."

**Direction of error.** A false stall (a live runner abandoned, exit 10) is the defect this card
removes. A late-but-bounded genuine stall — fired within `--stall-minutes` + one poll interval of
the run's own silence — is **by design**. When in doubt, prefer reporting late over reporting
falsely.

**Not the oracle.** The 2026-09-11 "Why" paragraph's hypothesis ("the stall detector picks
'newest log' from the previous run directory") is a guess the card explicitly leaves open to the
Warchief ("the card does not pin the cause"). Section 3 below confirms it **by measurement**, and
that measurement — not the guess — is what the fix is built against.

---

## 2. The problem, grounded

### 2.1 What happens in the field

Across the three recorded campaign homes (`~/.tribe/-Users-hip-repo-tribe/campaigns/*/watchdog/events.jsonl`,
read-only), **11 of 11** recorded `stall` events are false. Each one is the event immediately
following a `launch` or `relaunch`, and each names a log belonging to a *previous* run:

| home | stall at | follows | gap | log's run | log age at stall |
| --- | --- | --- | --- | --- | --- |
| gap-gate-2026-09-10 | 2026-09-10T18:20:30.052Z | `relaunch:quota` | 20 ms | `2026-09-10T16-19-22-348Z-a5fa` | 119.0 min |
| gap-gate-2026-09-10 | 2026-09-10T23:20:30.016Z | `relaunch:quota` | 9 ms | `2026-09-10T18-20-30-170Z-584d` | 107.3 min |
| viewer-consolidation | 2026-09-12T17:30:30.016Z | `relaunch:quota` | 7 ms | `2026-09-12T12-39-23-572Z-cd0a` | 97.1 min |
| viewer-consolidation | 2026-09-12T22:30:30.012Z | `relaunch:quota` | 6 ms | `2026-09-12T17-30-30-095Z-4c02` | 93.1 min |
| viewer-consolidation | 2026-09-13T03:30:30.014Z | `relaunch:quota` | 7 ms | `2026-09-12T22-30-30-086Z-2d68` | 115.8 min |
| viewer-consolidation | 2026-09-13T09:06:04.626Z | `relaunch:crash` | 3 ms | `2026-09-13T03-30-30-091Z-bbce` | 276.8 min |
| viewer-consolidation | 2026-09-13T18:40:30.011Z | `relaunch:quota` | 3 ms | `2026-09-13T13-40-30-090Z-26d7` | 157.6 min |
| viewer-consolidation | 2026-09-17T14:41:33.856Z | **`launch:initial`** | 3 ms | `2026-09-13T18-43-31-437Z-a0aa` | 5362.7 min |
| viewer-consolidation | 2026-09-17T20:35:42.149Z | `relaunch:crash` | 1 ms | `2026-09-17T14-41-33-902Z-fb66` | 169.9 min |
| viewer-consolidation | 2026-09-18T00:06:01.395Z | **`launch:initial`** | 1 ms | `2026-09-17T20-35-42-197Z-b912` | 204.6 min |
| supervisor-hardening | 2026-09-19T20:30:30.006Z | `relaunch:quota` | 2 ms | `2026-09-19T19-29-58-328Z-dcb2` | 41.3 min |

Genuine stalls ever recorded: **0**. Causes represented: `quota` ×7, `crash` ×2,
`initial launch` ×2 — so the defect is **not quota-specific and not relaunch-specific**; it is
every path that spawns a runner (S1 **D1**).

The decisive timing, which pins the mechanism rather than merely suggesting it: in each case the
*new* run directory is stamped **after** the stall.

| sequence | relaunch/launch | stall | new run dir created |
| --- | --- | --- | --- |
| gap-gate 2026-09-10 | `…18:20:30.032Z` | `…18:20:30.052Z` | `2026-09-10T18-20-30-170Z-584d` (**+118 ms after the stall**) |
| viewer-consolidation | `…17:30:30.009Z` | `…17:30:30.016Z` | `2026-09-12T17-30-30-095Z-4c02` (**+79 ms**) |
| supervisor-hardening | `…20:30:30.004Z` | `…20:30:30.006Z` | `2026-09-19T20-30-30-069Z-6185` (**+63 ms**) |

### 2.2 The mechanism, confirmed in code

`core/watchdog/watch-loop.ts`, `observe()`:

- **`watch-loop.ts:72`** — the supervised run is chosen as *the newest run directory on disk*:
  `const runId = newestRunId(io.listEntries(runsDir).filter((e) => e.isDir).map((e) => e.name));`
- **`watch-loop.ts:146,148`** — liveness comes from a completely different source, this
  invocation's own child: `const childAlive = state.child !== null && state.ownedExitCode === null;`
  … `const alive = childAlive || recordAlive;`
- **`watch-loop.ts:163-165`** — the logs read are the logs of `runId`, i.e. **the newest directory
  on disk**, not the run the live child belongs to.
- **`decide.ts:44-55`** — a live runner is judged stalled purely on that log's age:
  `const stalled = isStale(o.nowMs, mtime, o.limits.stallMinutes, o.run.noLogSinceMs ?? null);`
- **`select.ts:43`** — `if (mtimeMs !== null) return nowMs - mtimeMs > stallMinutes * 60_000;`

The two sources disagree for exactly as long as it takes a freshly-spawned OS process to create
its own `runs/<id>/` directory — 63–170 ms in the field. The loop re-observes **immediately**
after spawning (`watch-loop.ts:356-369`: the `launch`/`relaunch` case ends in `break`, with no
sleep before the next `observe()`), so the very first tick after a spawn lands inside that window
every time. In it: `alive` is `true` (our own brand-new child), while `newestLogPath` and
`newestLogMtimeMs` belong to the **previous** run — whose log is, by construction, old
(it is the run that just died, or the run that was idle through a 2-hour quota wait). `isStale`
says yes, and the watchdog exits 10, abandoning a live runner.

A prior fix already recognised half of this. **`watch-loop.ts:200-208`** (C1, group-C audit round
1) widened the "my child exists but its run dir is not visible yet" case — but **only when the
runs directory is empty** (`runId === null && !childAlive`). When a previous run's directory is
present, `runId` is non-null and points at the wrong run, and none of that protection applies.
That is the whole defect.

### 2.3 Reproduction — real output, captured before any fix was designed

Owner rule: a bug fix starts by reproducing the bug end-to-end as an end user hits it. Run against
a bare `mktemp` home with its own `HOME`, a throwaway git repo, the **real** `run.ts watchdog`
CLI, a finished previous run whose session log is 2 h old, and default `--stall-minutes 30`:

```
prior log mtime: 2026-09-19T23:36:23.109Z (2h old, > --stall-minutes 30)
--- running the REAL watchdog CLI (--stall-minutes 30 default, --poll-seconds 1) ---
launch: starting the campaign runner
stall: no log activity in …/campaigns/repro/runs/2026-09-19T05-00-30-073Z-8df1/logs/E1-11111111-….log since 2026-09-19T23:36:23.109Z
status: …/campaigns/repro/watchdog/status.json
watchdog exit code: 10
--- events.jsonl ---
2026-09-20T01:36:23.271Z start  {}
2026-09-20T01:36:23.272Z launch {"cause": "initial"}
2026-09-20T01:36:23.273Z stall  {"logPath": ".../runs/2026-09-19T05-00-30-073Z-8df1/logs/E1-….log", "lastMtimeMs": 1789860983109.1997}
2026-09-20T01:36:23.274Z exit   {"status": "needs_human", "reason": "stalled", "exitCode": 10}
--- status.json (runId / terminal) ---
runId: 2026-09-19T05-00-30-073Z-8df1
terminal: {'status': 'needs_human', 'reason': 'stalled', 'exitCode': 10}
--- run dirs actually on disk at the end ---
2026-09-19T05-00-30-073Z-8df1
```

`launch` at `.272Z` → `stall` at `.273Z`: **1 ms**, against a run that ended hours earlier, while
the watchdog's own child was alive and had not yet had time to create its directory. This is the
2026-09-17T14:41:33.856Z and 2026-09-19 field shapes, reproduced from nothing.

It also shows D2 violated in the most literal way available: `status.json.runId` is
`2026-09-19T05-00-30-073Z-8df1` — the **previous** run — at the moment the watchdog declares the
current run stalled.

---

## 3. The change

### 3.1 The idea in one sentence

Stop letting "the newest run directory on disk" stand in for "the run I am supervising": while
this invocation owns a live child, a run directory that **already existed at the instant that
child was spawned** belongs to an earlier run and is never the supervised run — so its log is
never read and never judged.

### 3.2 Why this shape and not another

- It states D2 directly, as a rule about *identity*, rather than papering over the symptom with a
  timer. The card's own adjudication list REFUTES "suppress stall for N minutes after any launch"
  unless goal 2 is separately proven; this design never suppresses anything — it simply stops
  attributing another run's silence to this one.
- It reuses machinery already proven in this file. Once the stale directory is excluded, the
  observation collapses into exactly the state `watch-loop.ts:200-208` (C1) and
  `select.ts:26-46` / `decide.ts:46-48` (F-C5) already handle: *a live child whose run id is not
  yet knowable, with no log yet*. That path is already bounded — `noLogSince` starts a silence
  clock and `isStale`'s `sinceMs` fallback converges to `stalled` after `--stall-minutes`. So
  **D3** (grace = the existing `--stall-minutes`, measured from launch) and **D4(a)** (a new run
  that never writes is still caught) fall out of the existing code rather than needing new logic.
- The pure core is untouched in its decision table. `decide()`'s action table (48 frozen rows)
  keeps every row; what changes is that it is handed a *truthful* observation. One small pure
  predicate is added to `select.ts` and one field to the loop's own state.

### 3.3 Purity (`~/.claude/rules/pure-core.md`)

- **Pure core, added:** `select.ts#isOwnRunVisible(newestRunId, priorNewestRunId)` — a total
  function over two `string | null`s, no clock, no fs, no throw. It answers the identity
  question, and is table-testable.
- **Pure core, unchanged:** `decide.ts` and its 48-row table; `isStale`.
- **Impure edge, changed:** `watch-loop.ts`'s `observe()` and `spawnRunnerNow()` — the loop reads
  the world through the injected `io` and carries the answer in `LoopState`. No new effect kind
  is introduced: `io.listEntries` is already a `WatchdogIO` member and is already called on this
  exact directory.
- **No new primitive observation is needed**, so `adapters/watchdog-io.adapter.ts` is **not**
  touched. (The fence permits it "only if the fix needs a new primitive observation" — it does
  not.)

### 3.4 The mechanism, concretely

1. `LoopState` gains `priorNewestRunId: string | null` — the newest run id present **immediately
   before** the most recent spawn. `spawnRunnerNow()` reads it from `io.listEntries` *before*
   calling `io.spawnRunner`, which is the only instant at which the answer is exactly right: any
   directory existing before our child exists cannot be our child's.
2. `spawnRunnerNow()` also clears `state.runId` and `state.noLogSince`. Clearing `state.runId` is
   what makes D2's second sentence literally true: `status.json.runId` never names the previous
   run while the current child is being supervised. It becomes `null` for at most one poll
   interval, then the real new id. (`WatchdogStatus.runId` is already declared `string | null` —
   `model.ts:151` — so this is a value change, never a shape change.)
3. `observe()` computes `newestOnDisk` as today, then:
   `ownRunVisible = !ownsLiveChild || isOwnRunVisible(newestOnDisk, state.priorNewestRunId)`,
   and uses `runId = ownRunVisible ? newestOnDisk : null`. Everything downstream already flows
   from `runId` (the record read at `:76`, the log listing at `:163`, the signal parse at `:189`),
   so nothing else needs rewiring.
4. The silence clock is keyed on the **supervision identity** rather than the run id, so it does
   not restart when the child's directory finally appears mid-supervision. While we own a live
   child the identity is the attempt (`attempt-<n>`); otherwise it is the run id. Without this,
   the clock restarts once and goal 2's upper bound (`--stall-minutes` + **one** poll interval)
   would become two poll intervals.

Lexicographic comparison is the correct chronological comparison here and is the convention this
module already relies on: `select.ts:5-6` — "Run ids are `<iso-with-separators-mapped>-<hex>`
(`core/run-record.ts`'s `generateRunId`), so lexicographic max is chronological max".

### 3.5 What this does NOT change

- No stall is suppressed. A run that is genuinely silent for `--stall-minutes` still reports
  `needs_human:stalled` (exit 10) — via the mtime path when it wrote and stopped (**D4(b)**), and
  via the `noLogSince` clock when it never wrote at all (**D4(a)**).
- The watchdog still never kills a runner.
- `status.json` and `events.jsonl` keep their exact shapes; no field is added, removed or
  retyped. No new CLI flag; no changed default; no changed exit code; no changed action row.
- `core/types.ts`, `core/state.ts`, `core/supervisor/**`, the viewer and `SKILL.md` are untouched.
- The real campaign runner is untouched.

---

## 4. Scope fence

**IN** (the card's fence, verbatim, plus where each lands):

- `plugins/tribe/scripts/runner/core/watchdog/select.ts` + `select.test.ts` — the pure predicate.
- `plugins/tribe/scripts/runner/core/watchdog/watch-loop.ts` + `watch-loop.test.ts` — the wiring.
- `plugins/tribe/scripts/runner/watchdog-integration.test.ts` — double-driven relaunch
  reproductions (real processes, real fs).
- `plugins/tribe/scripts/runner/core/watchdog/replay.ts` + `replay.test.ts` — the pure ratchet
  (§5.3, S1 **D5**) and the three recorded-sequence replays.
- `plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh` — the end-to-end reproduction,
  matching the fence's `test-watchdog-*.sh` glob.
- `plugins/tribe/scripts/runner/fixtures/watchdog/runner-double.sh` — one new optional env knob
  (see the adjudication note in §8).
- `plugins/tribe/scripts/runner/README.md`, Watchdog section only.
- `.c3/` reconciliation, as a change-unit (§6).

**OUT:** `core/types.ts`, `core/state.ts`, `core/supervisor/**`, the viewer, `SKILL.md`, the real
runner, `adapters/watchdog-io.adapter*.ts`, `campaign-state.json`, anything under `<home>/` other
than `<home>/watchdog/` at runtime, `--stall-minutes`'s default, any new flag, any exit code, any
`status.json`/`events.jsonl` field.

If the goal cannot be met inside this fence → `NEEDS_DIRECTION`, never a wider fence.

---

## 5. Testing strategy

Three altitudes, because this defect is invisible at any single one: it needs a *live child* and a
*stale sibling directory* and *real elapsed time between spawn and directory creation*.

### 5.1 Pure (table tests) — `select.test.ts`

`isOwnRunVisible` over every combination of `null` / older / equal / newer, including the two
fence-post cases (equal id → not visible; `priorNewestRunId === null` with any non-null newest →
visible).

### 5.2 Integration with real processes — `watchdog-integration.test.ts`

The established harness (real fs, real spawns, real sleeps, only the runner's *identity* swapped
for `runner-double.sh`). Four scenarios, each red before the fix:

| # | scenario | oracle |
| --- | --- | --- |
| R1 | **quota relaunch** over a pre-seeded stale previous run dir; new runner alive | no `stall` event; the post-relaunch event is `attach`; terminal is `runner_done`, not `stalled` |
| R2 | **crash relaunch**, same shape | same |
| R3 | **initial launch** over a stale previous run dir | same |
| R4 | **D4(a)** — relaunched runner never writes a log at all | `stall` **does** fire; not before `--stall-minutes` after the relaunch, and not after `--stall-minutes` + one poll interval |

R4 is the card's "keep" clause and the explicit refutation of the blanket-suppression
non-fix — the adjudication list REFUTES a suppression fix *unless* this test exists and passes.
It is run with a small `--stall-minutes` so the bound is measurable in seconds, driving the real
clock (no fake timers): the assertion is on the observed interval, not on a mocked instant.

D4(b) (a run that writes and then goes silent) is already covered by the existing suite and must
stay green — it is the mtime path, untouched by this change.

### 5.3 The committed ratchet — S1 **D5**

> "D5 — Ratchet tool is committed. The count 'stall events immediately following a
> launch/relaunch' must be measurable by a committed check (or test) against an `events.jsonl`,
> so the baseline above can be re-measured on any campaign home. Target: 0, and it may never rise
> again."

A pure function `countFalseStalls(events)` in `core/watchdog/replay.ts` — given parsed
`events.jsonl` records, it returns every `stall` that follows a `launch`/`relaunch` within a
window (default 30 min, per goal 3). Pure in, pure out: no fs, so it is table-tested directly and
can be pointed at any home by a one-line edge later without this card growing a CLI (no new flag,
per the fence).

Its tests carry the three recorded sequences (**goal 3**) as fixtures built from **numbers copied
out of the recorded events** — relative offsets, log ages, and the spawn→directory delay — with no
owner-private text, no paths, and no card names. The assertion is goal 3's: **zero `stall` events
within 30 minutes of a `relaunch`**, and it is asserted over the events the *current code*
produces when driven through those recorded timings, not over the recorded (buggy) output.

### 5.4 End to end — `test-watchdog-stall-relaunch.sh`

§2.3's reproduction, committed: a bare `mktemp` home with its own `HOME`, a throwaway git repo,
the **real** `bun run.ts watchdog` CLI, a stale previous run dir, and the assertion that the
watchdog does **not** exit 10 `stalled` and does not name the previous run's log. Red before the
fix (the §2.3 transcript is exactly its failure), green after. Every subprocess carries a timeout;
every `git` call sets `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null`
(`fail-closed-edges.md` obligations 2 and 3); the `mktemp` dir is removed by a trap on EXIT.

This is the fixtures-mirror-reality obligation: the previously-green 1109-test suite proves the
shapes it exercised, and none of them ever put a stale sibling directory next to a live child.

---

## 6. C3 reconciliation

Component `c3-215`, ADR `adr-20260904-mechanical-heartbeat-supersedes-p14`. Two facts go stale
with this change and are reconciled by a **change-unit** under `.c3/changes/`, never by a hand
edit of a `.c3/` instance:

- **row 81** (`scripts/runner/run.ts watchdog`) — its description of the tick says the decision is
  "driven by the run record, the session log tail, the clock and its own counters" and that "a
  live runner at start is adopted, never double-launched (D74-7)". It must additionally carry D2:
  the stall verdict only ever concerns the run this invocation is supervising, and a directory
  that predates the current spawn is never that run.
- **row 99** (change-safety: "The watchdog waits forever, relaunches forever, or kills a healthy
  runner") — its verify-points list gains the new end-to-end suite.

`c3x check` is `ok` on `0ca94dc` (63 docs, all clear) and must still be `ok` before merge.

---

## 7. Evidence plan

| evidence | medium | how |
| --- | --- | --- |
| BEFORE | terminal transcript | `test-watchdog-stall-relaunch.sh` run on the **base** build → fails, printing the §2.3 `stall`/exit-10 shape |
| AFTER | terminal transcript | the same script on the branch → passes |
| the three replays | test output | `bun test core/watchdog/replay.test.ts` → the three recorded sequences, 0 stalls within 30 min of a relaunch |
| gates | pasted output | `bun test` (floor: 1109 pass / 0 fail), `bunx tsc --noEmit`, `test-watchdog-e2e.sh`, `test-watchdog-detached.sh`, `test-supervisor-e2e.sh`, `c3x check` |
| ratchet | test output | `countFalseStalls` on each recorded sequence's replayed output = 0 |

All of it is terminal transcripts, because that is what this repo's harness produces and what a
reader can reproduce from the PR with a single command. Every command in the PR body is runnable
as written.

---

## 8. Adjudication rule (REFUTED in advance)

Per `brief-contracts.md` obligation 4, these are settled before any auditor reads the diff:

- **"Commit cf4bf3c (2026-09-05) already fixed this."** REFUTED by the card's own S1 grounding
  table and by §2.1: every recorded false stall is dated 09-10…09-19, after that commit.
- **"This is a quota bug; the fix should live on the quota path."** REFUTED: §2.1 shows
  `crash` ×2 and `initial launch` ×2. S1 **D1** widened it to every launch path.
- **"Suppress stall for N minutes after any launch."** REFUTED as a *design*; and any fix
  resembling suppression is a **failed ship** unless R4 (§5.2) proves D4(a) holds. R4 exists.
- **"Touching `runner-double.sh` breaks the fence's 'no change to the runner itself'."** REFUTED:
  `fixtures/watchdog/runner-double.sh` is a **test double** — its own header says it "mirrors the
  REAL campaign runner's OBSERVABLE contract" — and it is the committed harness the watchdog's
  integration tests already drive. The fence protects the production runner (`run.ts` and
  `core/` outside `core/watchdog/`), which is untouched. The change is additive and
  default-off: an optional env knob that delays run-directory creation, which is what makes the
  63–170 ms field race reproducible deterministically instead of by luck. Existing double-driven
  tests set nothing and behave exactly as before.
- **A stale C3 fact** that the closing reconciliation task (§6) fixes.
- **`status.json.runId` being `null` for up to one poll interval after a spawn.** By design and
  required by D2: the id of a run whose directory does not exist yet is *not knowable*, and the
  previous behaviour — naming the **previous** run — is the defect. The field is already
  `string | null` (`model.ts:151`); no shape changes.

---

## 9. Risks and rollback

| risk | mitigation |
| --- | --- |
| The suppression window hides a *genuine* stall of the new run | It cannot: the window ends the moment the child's directory appears, and while it is open the `noLogSince` clock is already running from the spawn instant. R4 measures the bound. |
| A runner that never creates a run directory attaches forever | Bounded by the same clock → `stalled` after `--stall-minutes` (D4(a), R4). This is the F-C5 runaway a previous audit round found; the design keeps that guard, keyed so it cannot be reset by the directory appearing. |
| Two watchdogs racing on one home | Out of scope and already prevented by the single-instance lock; unchanged. |
| Lexicographic id comparison wrong for some id shape | `generateRunId` is the only producer and `select.ts:5-6` already depends on this property for `newestRunId`. No new assumption. |
| Regression in the 48-row action table | `decide.ts` is not modified; the table test is a floor. |

**Rollback:** one revert of the merge commit. The change is confined to the watchdog's own
observation path; no data shape, no persisted state, no migration.

---

## 10. Measurable goals → where each is proven

| goal (card, 2026-09-18 revision + S1 + S2) | proof |
| --- | --- |
| 1. before→after regression per cause (`quota`, `crash`, and `initial`); still attaching after the first tick and after `stall-minutes − 1` | R1/R2/R3 (§5.2) + `test-watchdog-stall-relaunch.sh` (§5.4) |
| 2. a silent relaunched runner still stalls, not earlier than `--stall-minutes`, not later than `--stall-minutes` + one poll interval | R4 (§5.2) |
| 3. the **three** recorded sequences replay with 0 `stall` within 30 min of their `relaunch` events | `replay.test.ts` (§5.3) |
| 4. full runner suite + `test-watchdog-e2e.sh` green | gates (§7); floor 1109 pass / 0 fail |
| S1-2. E2E with the real CLI: the post-relaunch event is `attach` with `status.json.runId` = the new run | `test-watchdog-stall-relaunch.sh` asserts it within one poll interval of the relaunch |
| S1-D5. the ratchet is committed and re-measurable | `countFalseStalls` (§5.3) |
