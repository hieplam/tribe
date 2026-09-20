# Plan — watchdog-stall-after-quota-relaunch

**Spec:** `docs/tribe/planning/watchdog-stall-after-quota-relaunch/spec.md` (read it first; §1 is
the Oracle, §8 is the adjudication rule)
**Worktree:** `/Users/hip/repo/tribe-wt/watchdog-stall` · **Branch:**
`fix/watchdog-stall-after-relaunch` · **Base:** `0ca94dc`
**Runner dir** (every `bun` command below runs from here):
`/Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner`

5 tasks, one dependency wave (they touch the same files, so they run **sequentially**, one
Hunter at a time in the single worktree).

---

## Global Constraints

**Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
implementer.**

**Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
(database, network, filesystem, clock, random, global state) enters through an abstraction
injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**

Additional constraints binding on every task:

1. **TDD, strictly.** Write the test, RUN it, transcribe the real RED output into your report,
   then write the minimal implementation, RUN it again, transcribe the GREEN output. A report
   with no transcribed RED output is not a report.
2. **`bun install` has already been run** in the runner dir. The **baseline floor measured on the
   untouched tree is `1109 pass, 0 fail` across 49 files.** Your task's final `bun test` must show
   **≥ 1109 pass and 0 fail**. A lower pass count means you deleted or broke coverage.
3. **One commit per task**, plain descriptive message, and **no AI/agent co-author trailer and no
   "generated with" line of any kind**. Every commit carries, in its ONE final paragraph, two
   trailer lines: `Tribe-Card: watchdog-stall-after-quota-relaunch` and `Tribe-Task: N/5`.
   Tick your task's checkbox in this plan file in that SAME commit.
4. **Fence.** You may edit only the files your task names. `core/types.ts`, `core/state.ts`,
   `core/supervisor/**`, `adapters/watchdog-io.adapter*.ts`, the viewer, `SKILL.md` and the real
   runner are OUT. No new CLI flag, no changed default, no new or changed field in
   `status.json` / `events.jsonl`, no changed exit code.
5. **`core/**` is pure** and `structure.test.ts` enforces it: no `node:fs`, no `node:child_process`,
   no clock, no `process.env` in any non-test file under `core/`.
6. **Shell tests:** every subprocess carries a timeout; every `git` invocation sets
   `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null`; every `mktemp -d` is removed
   by a `trap` on `EXIT` (`~/.claude/rules/fail-closed-edges.md` obligations 2 and 3).
7. **Stop and report `NEEDS_CONTEXT`** rather than guessing if a task's stated RED does not
   actually appear — a test that is green before the fix is not proving what the task claims.

### Adjudication rule (settled in advance — see spec §8)

REFUTED before any review: "cf4bf3c already fixed it"; "this is quota-specific"; "editing
`fixtures/watchdog/runner-double.sh` breaks the no-runner-changes fence" (it is a committed
**test double**, not the runner); "`status.json.runId` may not be `null` after a spawn" (the
field is already `string | null` at `model.ts:151`, and naming the PREVIOUS run there is the
defect); and any stale C3 fact that Task 5 reconciles.

---

## Task 1: the end-to-end reproduction and the D2 identity fix

**Files:** `plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh` (new) ·
`plugins/tribe/scripts/runner/core/watchdog/select.ts` ·
`plugins/tribe/scripts/runner/core/watchdog/select.test.ts` ·
`plugins/tribe/scripts/runner/core/watchdog/watch-loop.ts` ·
`plugins/tribe/scripts/runner/core/watchdog/watch-loop.test.ts`

**Oracle:** spec §1. A live runner must never be judged stalled on a log belonging to a run that
already existed when that runner was spawned.

### Step 1.1 — RED, end to end (the owner's reproduce-first rule)

Create `plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh`, executable
(`chmod +x`), modelled on `test-watchdog-e2e.sh`:

```bash
#!/usr/bin/env bash
# test-watchdog-stall-relaunch.sh — card watchdog-stall-after-quota-relaunch, invariant D2:
# "the stall verdict only ever concerns the run the watchdog is supervising right now. A log
# that belongs to any earlier run can never produce a stall."
#
# The field shape, end to end, with the REAL `run.ts watchdog` CLI against a bare mktemp home:
# a previous run finished hours ago and its session log is stale; the watchdog launches a NEW
# runner; before that runner has had time to create its own runs/<id>/ directory, the newest
# directory on disk is still the previous run's. Until this card, the watchdog judged the new
# runner against that old log and exited 10 `stalled` within 1 ms of its own launch.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TMP="$(cd "$TMP" && pwd -P)"   # W-P10: macOS mktemp -d hands back a symlinked path
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi }

export HOME="$TMP/home"; mkdir -p "$HOME"
# fail-closed-edges obligation 2: the host's git config can never change this test's verdict.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

REPO="$TMP/repo"; git init -q -b master "$REPO"
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

H="$HOME/.tribe/key/campaigns/stall-relaunch"; mkdir -p "$H"
cat > "$H/campaign-state.json" <<'JSON'
{"v":1,"campaign":"stall-relaunch","mergePolicy":"regular-merge-only","sequence":["E1"],
 "schemaLockPaths":[],"docsOnlyPaths":[],"ownerOnlyEscalations":[],
 "cards":{"E1":{"status":"staged","spec":"docs/never-authored.md","plan":"docs/never-authored.md",
  "branch":null,"baseSha":null,"pr":null,"mergeSha":null,"sessionId":null,"updatedAt":null}}}
JSON
: > "$H/answers.md"

# --- the PREVIOUS run: finished, and its session log is 2 h old (> --stall-minutes 30) ------
OLD_ID="2026-09-19T05-00-30-073Z-8df1"
OLD="$H/runs/$OLD_ID"; mkdir -p "$OLD/logs"
python3 - "$OLD/run.json" "$OLD_ID" <<'PY'
import json, sys
path, run_id = sys.argv[1], sys.argv[2]
json.dump({"v": 1, "runId": run_id, "pid": 999999,
           "startedAt": "2026-09-19T05:00:30.073Z", "repo": "/repo", "statePath": "",
           "answersPath": "", "escalationsDir": "", "logsDir": "", "argv": [],
           "endedAt": "2026-09-19T05:05:50.000Z", "exitCode": 0, "reason": "done"},
          open(path, "w"))
PY
OLD_LOG="$OLD/logs/E1-11111111-2222-3333-4444-555555555555.log"
printf '{"type":"assistant"}\n' > "$OLD_LOG"
python3 -c 'import os,sys,time;t=time.time()-7200;os.utime(sys.argv[1],(t,t))' "$OLD_LOG"

# --- the real watchdog CLI, default --stall-minutes 30 --------------------------------------
set +e
out="$(cd "$TMP" && timeout 120 bun "$RUNNER/run.ts" watchdog --repo "$REPO" \
  --model stall-relaunch-model --home "$H" --poll-seconds 1 2>&1)"
rc=$?
set -e
printf '%s\n' "$out"

reason="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"]["reason"])' \
  "$H/watchdog/status.json")"
actions="$(python3 - "$H/watchdog/events.jsonl" <<'PY'
import json, sys
with open(sys.argv[1]) as fh:
    print(",".join(json.loads(line)["action"] for line in fh if line.strip()))
PY
)"

# D2, wall 1: no stall event at all — the new runner was alive the whole time.
case ",$actions," in
  *,stall,*) bad "no stall is declared against the previous run's log (actions: $actions)" ;;
  *)         ok  "no stall is declared against the previous run's log" ;;
esac
# D2, wall 2: the terminal reason is the runner's own outcome, never `stalled`.
if [[ "$reason" == "stalled" ]]; then bad "the terminal reason is not 'stalled'"; else ok "the terminal reason is not 'stalled' (got: $reason)"; fi
if [[ "$rc" == "10" && "$reason" == "stalled" ]]; then bad "the watchdog does not exit 10 stalled"; else ok "the watchdog does not exit 10 stalled (rc: $rc)"; fi
# D2, wall 3: nothing the watchdog published may name the PREVIOUS run as the current one.
stall_json="$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))["stall"]))' \
  "$H/watchdog/status.json")"
check "status.json publishes no stall record" "$stall_json" "null"
case "$out" in
  *"$OLD_ID"*) bad "the watchdog never names the previous run id on stdout" ;;
  *)           ok  "the watchdog never names the previous run id on stdout" ;;
esac

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
```

Run it and transcribe the failure:

```bash
bash /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh; echo "exit: $?"
```

**Expected RED** — the reproduction reported in spec §2.3: stdout carries
`stall: no log activity in .../runs/2026-09-19T05-00-30-073Z-8df1/logs/E1-....log since ...`,
the events are `start,launch,stall,exit`, and the script prints `1 passed, 4 failed` with a
non-zero exit. Transcribe the whole block into your report.

### Step 1.2 — RED, deterministic, at the unit level

Append to `core/watchdog/watch-loop.test.ts` (the file's `fakeIo` already models reality: a
spawned pass's directory becomes visible only from the SECOND `listEntries(runsDir)` call after
its spawn):

```ts
describe('runWatchdog — D2: a relaunched runner is never judged on the PREVIOUS run\'s log', () => {
  test('a quota wait longer than --stall-minutes does not turn the relaunch into a stall', async () => {
    // The gap-gate-2026-09-10 shape, in simulated time: the first pass hits a 429 whose reset is
    // ~107 min out (the recorded wait), so by the time the watchdog relaunches, r1's log is far
    // older than --stall-minutes 30. r2's own directory is not visible on the tick right after
    // its spawn, exactly like a real just-forked process.
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2' },
    ]);
    const outcome = await runWatchdog(CONFIG, HOME, io);

    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l) as { action: string });
    expect(events.map((e) => e.action)).not.toContain('stall');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  });

  test('status.json never names the previous run while the new one is being supervised', async () => {
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2' },
    ]);
    const seen: Array<string | null> = [];
    const spy: WatchdogIO = {
      ...io,
      writeFileAtomic: (p, c) => {
        io.writeFileAtomic(p, c);
        if (p.endsWith('status.json')) seen.push((JSON.parse(c) as { runId: string | null }).runId);
      },
    };
    await runWatchdog(CONFIG, HOME, spy);
    // Once the relaunch has happened, 'r1' may never be published again as the current run.
    const afterRelaunch = seen.slice(seen.lastIndexOf('r1') + 1);
    expect(afterRelaunch).not.toContain('r1');
    expect(seen).toContain('r2');
  });
});
```

Run:

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test core/watchdog/watch-loop.test.ts 2>&1 | tail -20
```

**Expected RED:** both new tests fail — the first because the event list contains `stall` and the
outcome is `[10, 'stalled']`, the second because `r1` is still published after the relaunch.

### Step 1.3 — GREEN, the pure predicate

Append to `core/watchdog/select.ts`, immediately after `newestRunId`:

```ts
/**
 * D2 (card watchdog-stall-after-quota-relaunch): the stall verdict only ever concerns the run
 * the watchdog is supervising RIGHT NOW. While this invocation owns a live child, a run
 * directory that already existed at the instant that child was spawned belongs to an EARLIER
 * run — the child's own directory does not exist yet, because a real forked process needs real
 * wall-clock time to create it (63-170 ms in the three recorded field sequences). Judging the
 * new runner against that earlier run's hours-old log is the whole defect: 11 of 11 recorded
 * `stall` events were false, each fired 1-20 ms after a launch/relaunch.
 *
 * `newestRunId`'s own contract already establishes that run ids compare chronologically as
 * strings, so "newer than everything that was present at spawn time" is exactly `>`.
 * `priorNewestRunId === null` means nothing at all preceded this child, so the first directory
 * to appear is necessarily its own.
 */
export function isOwnRunVisible(
  newestRunId: string | null,
  priorNewestRunId: string | null,
): boolean {
  if (newestRunId === null) return false;
  if (priorNewestRunId === null) return true;
  return newestRunId > priorNewestRunId;
}
```

Append its table test to `core/watchdog/select.test.ts`:

```ts
describe('isOwnRunVisible — D2: only a directory newer than everything present at spawn is ours', () => {
  const cases: Array<[newest: string | null, prior: string | null, want: boolean, why: string]> = [
    [null, null, false, 'nothing on disk yet, nothing before: our run is not visible'],
    [null, 'r1', false, 'nothing on disk at all'],
    ['r1', null, true, 'nothing preceded this child, so the one directory present is its own'],
    ['r1', 'r1', false, 'the newest directory is the SAME one that predated the spawn'],
    ['r1', 'r2', false, 'the newest directory is OLDER than what predated the spawn'],
    ['r2', 'r1', true, 'a strictly newer directory appeared after the spawn'],
    ['2026-09-19T20-30-30-069Z-6185', '2026-09-19T19-29-58-328Z-dcb2', true,
      'the recorded supervisor-hardening pair: the new run dir is newer than the old one'],
    ['2026-09-19T19-29-58-328Z-dcb2', '2026-09-19T19-29-58-328Z-dcb2', false,
      'the recorded supervisor-hardening old run, still the newest 2 ms after the relaunch'],
  ];
  for (const [newest, prior, want, why] of cases) {
    test(`newest=${String(newest)} prior=${String(prior)} -> ${want} (${why})`, () => {
      expect(isOwnRunVisible(newest, prior)).toBe(want);
    });
  }
});
```

Add `isOwnRunVisible` to that file's existing import from `./select.ts`.

### Step 1.4 — GREEN, the wiring

In `core/watchdog/watch-loop.ts`:

(a) add `isOwnRunVisible` to the existing `./select.ts` import;

(b) add one field to `LoopState`, beside `trackedRunId`:

```ts
  /** D2: the newest run id present on disk immediately BEFORE the most recent spawn. Anything
   * at or below it predates this invocation's current child and can therefore never be that
   * child's run — see `select.ts`'s `isOwnRunVisible`. `null` until this invocation has spawned
   * anything (and a plain `null` is also the honest answer for an adopted run we never spawned:
   * the suppression only ever applies while we own a live child). */
  priorNewestRunId: string | null;
```

initialise it to `null` in `runWatchdog`'s `state` literal;

(c) in `observe()`, replace the current line 72 with:

```ts
  const newestOnDisk = newestRunId(io.listEntries(runsDir).filter((e) => e.isDir).map((e) => e.name));
  // D2: liveness comes from `state.child` (this invocation's own truth) while the observed run
  // came from whatever directory happened to be newest on disk — and for the 63-170 ms it takes
  // a real forked runner to create its own directory those two name DIFFERENT runs. Whenever we
  // own a live child, a directory that predates its spawn is not it: report the run as
  // not-yet-visible (`runId === null`, the same state the C1 fix below already handles for an
  // empty runs/ directory) rather than attributing the previous run's silence to this one.
  const ownsLiveChild = state.child !== null && state.ownedExitCode === null;
  const runId = (!ownsLiveChild || isOwnRunVisible(newestOnDisk, state.priorNewestRunId))
    ? newestOnDisk
    : null;
```

and replace the existing `const childAlive = state.child !== null && state.ownedExitCode === null;`
(line 146) with `const childAlive = ownsLiveChild;`;

(d) in `spawnRunnerNow()`, immediately **before** `state.child = io.spawnRunner(argv, ...)`:

```ts
    // D2: the newest run directory present at the instant BEFORE this child exists. Read here,
    // and nowhere earlier, because this is the only instant at which the answer is exactly
    // right: anything already on disk cannot belong to a process that does not exist yet.
    state.priorNewestRunId = newestRunId(
      io.listEntries(join(homeDir, 'runs')).filter((e) => e.isDir).map((e) => e.name),
    );
    // D2's second sentence: `status.json.runId` and the stall event's log path must name the
    // same run. The id of a run whose directory does not exist yet is not knowable, so the
    // honest value is `null` — publishing the PREVIOUS run's id here is what made status.json
    // corroborate the false stall. It becomes the real id on the first tick that sees it.
    state.runId = null;
```

**Expected GREEN:**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test 2>&1 | tail -6
bunx tsc --noEmit && echo "tsc: clean"
bash /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh; echo "exit: $?"
bash /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/tests/test-watchdog-e2e.sh 2>&1 | tail -3
```

`bun test` shows **≥ 1117 pass, 0 fail**; `tsc: clean`; the new shell test prints
`5 passed, 0 failed` and `exit: 0`; `test-watchdog-e2e.sh` stays green.

- [ ] **Step 5: Commit**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall && git add -A && \
git -c user.email=lamhiep16@gmail.com -c user.name=hieplam commit -m 'fix(watchdog): never judge a live runner on a run directory that predates its spawn' -m $'Tribe-Card: watchdog-stall-after-quota-relaunch\nTribe-Task: 1/5'
```

**Expected result:** one commit; `git log -1 --format='%(trailers)'` prints both trailer lines.

- [ ] Task 1 complete

---

## Task 2: the silence clock must not restart when the run directory appears

**Files:** `plugins/tribe/scripts/runner/core/watchdog/watch-loop.ts` ·
`plugins/tribe/scripts/runner/core/watchdog/watch-loop.test.ts`

**Oracle:** the card's measurable goal 2, verbatim: "Same fixture, but the relaunched runner never
writes → `stall` fires no earlier than `--stall-minutes` after the relaunch and no later than
`--stall-minutes` + one poll interval." This is the card's **D4(a)** "keep" clause and the
explicit proof that Task 1 suppressed nothing.

### Step 2.1 — RED

After Task 1, `state.noLogSince` is keyed on the observed `runId`. Right after a relaunch that key
is `null` (the directory is not visible yet); one poll interval later the directory appears and
the key becomes the new run id, which **restarts the silence clock**. The genuine stall is then
pushed out by an extra poll interval, past the bound the card allows.

Append to `core/watchdog/watch-loop.test.ts`:

```ts
describe('runWatchdog — D4(a): a relaunched runner that never writes still stalls, on time', () => {
  test('the stall fires within --stall-minutes + ONE poll interval of the relaunch', async () => {
    // r2 is alive and never writes a log line at all. CONFIG: stallMinutes 30, pollSeconds 30.
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2', endedAt: null },
    ]);
    io.isProcessAlive; // the record stays unfinalized, so r2 reads as alive throughout
    const outcome = await runWatchdog(CONFIG, HOME, io);

    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l) as { at: string; action: string });
    const relaunchAt = Date.parse(events.find((e) => e.action === 'relaunch')?.at as string);
    const stallAt = Date.parse(events.find((e) => e.action === 'stall')?.at as string);
    expect([outcome.exitCode, outcome.reason]).toEqual([10, 'stalled']);
    // Not early: the relaunched run gets its full --stall-minutes of its OWN silence.
    expect(stallAt - relaunchAt).toBeGreaterThan(30 * 60_000);
    // Not late: at most one further poll interval to notice it.
    expect(stallAt - relaunchAt).toBeLessThanOrEqual(30 * 60_000 + 30_000);
  });

  test('a relaunched runner is still attaching one minute before its own deadline', async () => {
    const resetAt = 1_800_000_000 + 107 * 60;
    const { io, files } = fakeIo([
      { exitCode: 3, runId: 'r1', logTail: quotaTail(resetAt) },
      { exitCode: 0, runId: 'r2', endedAt: null },
    ]);
    await runWatchdog(CONFIG, HOME, io);
    const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
      .trim().split('\n').map((l) => JSON.parse(l) as { at: string; action: string });
    const relaunchAt = Date.parse(events.find((e) => e.action === 'relaunch')?.at as string);
    const deadline = relaunchAt + 29 * 60_000; // stall-minutes - 1
    const before = events.filter((e) => Date.parse(e.at) <= deadline).map((e) => e.action);
    expect(before).not.toContain('stall');
    expect(before).toContain('attach');
  });
});
```

Run:

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test core/watchdog/watch-loop.test.ts 2>&1 | tail -20
```

**Expected RED:** the first test fails its upper bound — the measured `stallAt - relaunchAt` is
about `30 * 60_000 + 60_000` (two poll intervals), because the clock restarted once. The second
test passes already; keep it, it is goal 1's "still attaching at `stall-minutes − 1`" wall.

### Step 2.2 — GREEN

In `core/watchdog/watch-loop.ts`, change `LoopState.noLogSince`'s shape from
`{ runId: string | null; sinceMs: number } | null` to:

```ts
  /** FIX F-C5, re-keyed for D2: THIS invocation's own clock for "how long has the currently-alive
   * run gone with no log line at all". The key is the SUPERVISION identity, not the run id:
   * while we own a live child that identity is its attempt, because the child's run id is
   * legitimately unknown for the first tick or two and then becomes known — and re-keying on
   * that transition would RESTART the silence clock, pushing a genuine stall a whole poll
   * interval past the bound the card allows ("--stall-minutes + one poll interval"). With no
   * owned child (an adopted run) the run id is the identity, exactly as before. */
  noLogSince: { key: string | null; sinceMs: number } | null;
```

and in `observe()` replace the `if (alive && newest === null)` block with:

```ts
  const silenceKey = ownsLiveChild ? `attempt-${state.attempt}` : runId;
  if (alive && newest === null) {
    if (state.noLogSince === null || state.noLogSince.key !== silenceKey) {
      state.noLogSince = { key: silenceKey, sinceMs: nowMs };
    }
  } else {
    state.noLogSince = null;
  }
```

In `spawnRunnerNow()`, beside the `state.priorNewestRunId` assignment added in Task 1, add
`state.noLogSince = null;` so each new attempt starts a clean clock.

**Expected GREEN:**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test 2>&1 | tail -6
bunx tsc --noEmit && echo "tsc: clean"
```

`bun test` shows **≥ 1119 pass, 0 fail**; `tsc: clean`. The measured
`stallAt - relaunchAt` is now `> 30 * 60_000` and `<= 30 * 60_000 + 30_000`; transcribe the
actual number into your report.

- [ ] **Step 3: Commit**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall && git add -A && \
git -c user.email=lamhiep16@gmail.com -c user.name=hieplam commit -m 'fix(watchdog): key the no-log silence clock on the attempt, not the run id' -m $'Tribe-Card: watchdog-stall-after-quota-relaunch\nTribe-Task: 2/5'
```

**Expected result:** one commit carrying both trailers.

- [ ] Task 2 complete

---

## Task 3: the committed ratchet and the three recorded replays

**Files:** `plugins/tribe/scripts/runner/core/watchdog/replay.ts` (new) ·
`plugins/tribe/scripts/runner/core/watchdog/replay.test.ts` (new) ·
`plugins/tribe/scripts/runner/core/watchdog/watch-loop.test.ts`

**Oracle:** the card's **D5**, verbatim: "Ratchet tool is committed. The count 'stall events
immediately following a launch/relaunch' must be measurable by a committed check (or test)
against an `events.jsonl`, so the baseline above can be re-measured on any campaign home.
Target: 0, and it may never rise again." Plus goal 3: "the THREE recorded sequences replay with
zero `stall` events within 30 min of their `relaunch` events."

### Step 3.1 — RED

Create `core/watchdog/replay.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { countFalseStalls } from './replay.ts';

/** The recorded field shape: a stall 2 ms after a quota relaunch (campaign supervisor-hardening,
 * 2026-09-19T20:30:30.004Z -> .006Z). Numbers only; no owner content. */
const RECORDED_FALSE_STALL = [
  { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
  { at: '2026-09-19T20:30:30.006Z', action: 'stall' },
];

describe('countFalseStalls — the D5 ratchet', () => {
  test('flags a stall that follows a relaunch inside the window', () => {
    const hits = countFalseStalls(RECORDED_FALSE_STALL);
    expect(hits.length).toBe(1);
    expect(hits[0]?.afterAction).toBe('relaunch');
    expect(hits[0]?.gapMs).toBe(2);
  });

  test('flags a stall that follows an initial launch (the 2026-09-17 shape)', () => {
    expect(countFalseStalls([
      { at: '2026-09-17T14:41:33.853Z', action: 'launch' },
      { at: '2026-09-17T14:41:33.856Z', action: 'stall' },
    ]).length).toBe(1);
  });

  test('does NOT flag a stall well outside the window', () => {
    expect(countFalseStalls([
      { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
      { at: '2026-09-19T21:30:30.004Z', action: 'stall' },
    ])).toEqual([]);
  });

  test('does NOT flag a stall with no preceding launch at all', () => {
    expect(countFalseStalls([{ at: '2026-09-19T20:30:30.004Z', action: 'stall' }])).toEqual([]);
  });

  test('an event stream with no stall at all is clean', () => {
    expect(countFalseStalls([
      { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
      { at: '2026-09-19T20:30:31.000Z', action: 'attach' },
      { at: '2026-09-19T22:47:00.000Z', action: 'exit' },
    ])).toEqual([]);
  });

  test('fails closed: an unparseable timestamp is reported, never silently cleared', () => {
    expect(countFalseStalls([
      { at: '2026-09-19T20:30:30.004Z', action: 'relaunch' },
      { at: 'not-a-timestamp', action: 'stall' },
    ]).length).toBe(1);
  });

  test('the window is a parameter, and the boundary is inclusive', () => {
    const events = [
      { at: '2026-09-19T20:00:00.000Z', action: 'relaunch' },
      { at: '2026-09-19T20:01:00.000Z', action: 'stall' },
    ];
    expect(countFalseStalls(events, 60_000).length).toBe(1);
    expect(countFalseStalls(events, 59_999)).toEqual([]);
  });
});
```

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test core/watchdog/replay.test.ts 2>&1 | tail -10
```

**Expected RED:** the run fails to resolve `./replay.ts` — the module does not exist yet.

### Step 3.2 — GREEN

Create `core/watchdog/replay.ts` (pure: no `node:fs`, no clock, no `process`):

```ts
/**
 * The D5 ratchet, pure (card watchdog-stall-after-quota-relaunch). The measured field baseline
 * across the three recorded campaign homes was 11 false stalls out of 11 recorded stalls — every
 * one of them the event immediately after a `launch`/`relaunch`, each naming a log belonging to a
 * PREVIOUS run. The target is 0, and it may never rise again.
 *
 * Pure in, pure out: the caller reads and parses the `events.jsonl`; nothing here touches the
 * filesystem or the clock, so it is table-testable and can be pointed at any campaign home.
 */

export interface ReplayEvent {
  at: string;
  action: string;
  detail?: Record<string, unknown>;
}

export interface FalseStall {
  /** The `stall` event's own timestamp, verbatim. */
  stallAt: string;
  /** `launch` or `relaunch` — the spawn this stall followed. */
  afterAction: string;
  /** That spawn's timestamp, verbatim. */
  afterAt: string;
  /** Milliseconds between the spawn and the stall, or `null` when either timestamp is
   * unparseable (the fail-closed case: reported, never silently cleared). */
  gapMs: number | null;
}

/** Goal 3's window: "zero `stall` events within 30 min of their `relaunch` events." */
export const DEFAULT_WINDOW_MS = 30 * 60_000;

/**
 * Every `stall` that follows a `launch`/`relaunch` within `windowMs` (boundary inclusive).
 *
 * Fail closed (`~/.claude/rules/fail-closed-edges.md`): a `stall` whose own timestamp, or whose
 * preceding spawn's timestamp, cannot be parsed is REPORTED with `gapMs: null` rather than
 * assumed innocent — a stall this function cannot time is not a stall it has cleared.
 */
export function countFalseStalls(
  events: readonly ReplayEvent[],
  windowMs: number = DEFAULT_WINDOW_MS,
): FalseStall[] {
  const hits: FalseStall[] = [];
  let lastSpawn: ReplayEvent | null = null;
  for (const event of events) {
    if (event.action === 'launch' || event.action === 'relaunch') {
      lastSpawn = event;
      continue;
    }
    if (event.action !== 'stall' || lastSpawn === null) continue;
    const spawnMs = Date.parse(lastSpawn.at);
    const stallMs = Date.parse(event.at);
    if (Number.isNaN(spawnMs) || Number.isNaN(stallMs)) {
      hits.push({ stallAt: event.at, afterAction: lastSpawn.action, afterAt: lastSpawn.at, gapMs: null });
      continue;
    }
    const gapMs = stallMs - spawnMs;
    if (gapMs >= 0 && gapMs <= windowMs) {
      hits.push({ stallAt: event.at, afterAction: lastSpawn.action, afterAt: lastSpawn.at, gapMs });
    }
  }
  return hits;
}
```

### Step 3.3 — GREEN, the three recorded replays (goal 3)

Append to `core/watchdog/watch-loop.test.ts` — these drive the CURRENT code through the recorded
timings and assert the ratchet reads zero. Add `import { countFalseStalls } from './replay.ts';`
to that file's imports.

```ts
describe('runWatchdog — goal 3: the three recorded sequences replay with zero false stalls', () => {
  // Numbers copied from the recorded events.jsonl files (offsets and log ages only — no paths,
  // no card names, no owner content):
  //   gap-gate-2026-09-10       relaunch:quota  after a 107 min wait, prior log 107.3 min old
  //   viewer-consolidation      relaunch:crash  prior log 169.9 min old
  //   supervisor-hardening      relaunch:quota  after a 41 min wait, prior log 41.3 min old
  const recorded: Array<[name: string, waitMinutes: number]> = [
    ['gap-gate-2026-09-10 (relaunch:quota, 107 min)', 107],
    ['viewer-consolidation (relaunch, 170 min)', 170],
    ['supervisor-hardening (relaunch:quota, 41 min)', 41],
  ];
  for (const [name, waitMinutes] of recorded) {
    test(`${name}: zero stall events within 30 min of the relaunch`, async () => {
      const resetAt = 1_800_000_000 + waitMinutes * 60;
      const { io, files } = fakeIo([
        { exitCode: 3, runId: 'prev', logTail: quotaTail(resetAt) },
        { exitCode: 0, runId: 'next' },
      ]);
      const outcome = await runWatchdog(CONFIG, HOME, io);
      const events = (files.get(join(HOME, 'watchdog', 'events.jsonl')) as string)
        .trim().split('\n').map((l) => JSON.parse(l) as { at: string; action: string });
      expect(countFalseStalls(events)).toEqual([]);
      expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
    });
  }
});
```

**Expected GREEN:**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test 2>&1 | tail -6
bunx tsc --noEmit && echo "tsc: clean"
```

`bun test` shows **≥ 1129 pass, 0 fail**; `tsc: clean`.

### Step 3.4 — mutation check (prove the ratchet bites)

Confirm the three replays are genuinely red against the pre-fix code, so they are regression
tests rather than decoration:

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && \
git stash push -- core/watchdog/watch-loop.ts core/watchdog/select.ts && \
bun test core/watchdog/watch-loop.test.ts 2>&1 | tail -8; git stash pop
```

**Expected result:** with the fix stashed, the three replay tests FAIL (`countFalseStalls` returns
one entry with a single-digit `gapMs`), and the stash pops cleanly so the tree is restored.
Transcribe both the failure and the clean `git status` after the pop.

- [ ] **Step 5: Commit**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall && git add -A && \
git -c user.email=lamhiep16@gmail.com -c user.name=hieplam commit -m 'test(watchdog): commit the false-stall ratchet and replay the three recorded sequences' -m $'Tribe-Card: watchdog-stall-after-quota-relaunch\nTribe-Task: 3/5'
```

**Expected result:** one commit carrying both trailers; `git status --short` is empty.

- [ ] Task 3 complete

---

## Task 4: real-process reproductions of every launch cause

**Files:** `plugins/tribe/scripts/runner/fixtures/watchdog/runner-double.sh` ·
`plugins/tribe/scripts/runner/watchdog-integration.test.ts`

**Oracle:** the card's **D1**, verbatim: "Scope widened to every launch path. Initial launch,
crash relaunch, quota relaunch, overload relaunch, lock relaunch, and adopt-on-start." These
reproductions run REAL child processes against a REAL filesystem — only the runner's identity is
swapped for the committed double — which is the altitude at which the 63-170 ms race actually
lives.

**Adjudicated in advance (spec §8):** `fixtures/watchdog/runner-double.sh` is a committed test
double ("mirrors the REAL campaign runner's OBSERVABLE contract", its own header), not the
runner. The fence's "no change to the runner itself" protects `run.ts` and `core/` outside
`core/watchdog/`, which this task does not touch. The knob added below is additive and
default-off: every existing double-driven test sets nothing and behaves exactly as before.

### Step 4.1 — RED

Add the delay knob to `fixtures/watchdog/runner-double.sh`. In the header comment block, beside
`DOUBLE_STALE_S`, document:

```bash
#   DOUBLE_RUNDIR_DELAY_S  seconds to wait BEFORE creating runs/<run-id>/ — models the real
#                          wall-clock gap between fork and first write (63-170 ms in the three
#                          recorded field sequences), widened so it is deterministic in a test.
#                          Unset (the default) means no wait, exactly as before.
```

and insert, immediately after the `IFS=: read -r exit_code fixture sleep_seconds <<<"$spec"` /
`sleep_seconds="${sleep_seconds:-0}"` pair and **before** `run_id=` is computed:

```bash
# A real runner does git and lock work before it writes its run record, so its runs/<id>/
# directory does not exist for the first tens of milliseconds of its life. Reproducing that gap
# is the whole point of the watchdog's D2 wall, so it is scriptable here rather than left to
# luck. Computing run_id AFTER the wait also keeps ids chronologically ordered.
[[ -z "${DOUBLE_RUNDIR_DELAY_S:-}" ]] || sleep "$DOUBLE_RUNDIR_DELAY_S"
```

Append to `watchdog-integration.test.ts`:

```ts
/** A finished previous run whose session log is `ageSeconds` old — the stale sibling directory
 * every recorded false stall was judged against. Written directly, never by the double, because
 * in the field it was left behind by an earlier watchdog invocation (or an earlier day). */
function seedStaleRun(home: string, runId: string, ageSeconds: number): void {
  const runDir = join(home, 'runs', runId);
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({
    v: 1, runId, pid: 999_999, startedAt: '2026-09-19T05:00:30.073Z',
    repo: '/repo', statePath: '', answersPath: '', escalationsDir: '', logsDir: '', argv: [],
    endedAt: '2026-09-19T05:05:50.000Z', exitCode: 0, reason: 'done',
  }));
  const logPath = join(runDir, 'logs', 'prev-card-prev-session.log');
  writeFileSync(logPath, '{"type":"assistant"}\n');
  const when = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(logPath, when, when);
}

const actionsOf = (home: string) =>
  events(home).map((e) => e.action).filter((a) => a !== 'wait_slice');

describe('D1/D2 — no launch path is judged on a run directory that predates its spawn', () => {
  test('R3 initial launch over a stale previous run directory', async () => {
    const h = harness('0:none', { DOUBLE_RUNDIR_DELAY_S: '2' });
    seedStaleRun(h.home, '2026-09-19T05-00-30-073Z-8df1', 7200);
    const outcome = await runWatchdog(config(), h.home, h.io);
    expect(actionsOf(h.home)).not.toContain('stall');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  }, 60_000);

  test('R1 quota relaunch over a stale previous run directory', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 3;
    const h = harness('3:quota 0:none', {
      DOUBLE_RESET_S: String(resetAt), DOUBLE_STALE_S: '7200', DOUBLE_RUNDIR_DELAY_S: '2',
    });
    const outcome = await runWatchdog(config(), h.home, h.io);
    const actions = actionsOf(h.home);
    expect(actions).not.toContain('stall');
    expect(actions).toContain('relaunch');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  }, 60_000);

  test('R2 a NON-quota relaunch over a stale previous run directory', async () => {
    // A 429 whose reset is already in the PAST is not a quota signal (decide.ts, W-P2) and 429
    // is deliberately not an overload status (signals.ts:37-38), so this exit-3 pass takes the
    // plain crash-relaunch path — the same defect on a non-quota cause (recorded twice as
    // `relaunch:crash`), with no extra fixture needed.
    const pastReset = Math.floor(Date.now() / 1000) - 3600;
    const h = harness('3:quota 0:none', {
      DOUBLE_RESET_S: String(pastReset), DOUBLE_STALE_S: '7200', DOUBLE_RUNDIR_DELAY_S: '2',
    });
    const outcome = await runWatchdog(config(), h.home, h.io);
    const actions = actionsOf(h.home);
    expect(actions).not.toContain('stall');
    const relaunch = events(h.home).find((e) => e.action === 'relaunch');
    expect(relaunch?.detail.cause).toBe('crash');
    expect([outcome.exitCode, outcome.reason]).toEqual([0, 'runner_done']);
  }, 60_000);
});
```

Add `utimesSync` to that file's `node:fs` import.

Prove they are RED against the pre-fix code (mutation check — the repo's own discipline,
`c3-215` row 98):

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && \
git stash push -- core/watchdog/watch-loop.ts core/watchdog/select.ts && \
bun test watchdog-integration.test.ts 2>&1 | tail -12; git stash pop
```

**Expected RED:** with the fix stashed, R1, R2 and R3 all fail — the actions contain `stall` and
the outcome is `[10, 'stalled']`. Transcribe it, then confirm the stash popped cleanly.

### Step 4.2 — GREEN

No production code changes in this task: Task 1 and Task 2 are the fix. Run the suite unstashed.

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test 2>&1 | tail -6
bunx tsc --noEmit && echo "tsc: clean"
```

**Expected result:** `bun test` shows **≥ 1132 pass, 0 fail** and `tsc: clean`. If any of R1/R2/R3
is green while the fix is stashed, stop and report `NEEDS_CONTEXT` — the test is not reproducing
the defect.

- [ ] **Step 3: Commit**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall && git add -A && \
git -c user.email=lamhiep16@gmail.com -c user.name=hieplam commit -m 'test(watchdog): reproduce the false stall with real processes on every launch cause' -m $'Tribe-Card: watchdog-stall-after-quota-relaunch\nTribe-Task: 4/5'
```

**Expected result:** one commit carrying both trailers.

- [ ] Task 4 complete

---

## Task 5: documentation and the C3 reconciliation

**Files:** `plugins/tribe/scripts/runner/README.md` (Watchdog section only) ·
`.c3/changes/<new-change-unit-dir>/` (new)

**Oracle:** the repo's governance — an architecture fact that no longer matches the code is a
defect, and `.c3/` instances are reconciled by a **change-unit**, never by a hand edit.

### Step 5.1 — the README

In `plugins/tribe/scripts/runner/README.md`, inside the existing Watchdog section, add one
subsection documenting the invariant in the reader's terms (no new flag, no new field):

```markdown
#### Which run a stall is about

The watchdog supervises exactly one run at a time, and a stall verdict only ever concerns *that*
run. This matters because a freshly-spawned runner needs real wall-clock time — tens to hundreds
of milliseconds — to create its own `runs/<run-id>/` directory, and during that gap the newest
directory on disk still belongs to the *previous* run. A run directory that already existed at
the instant the current runner was spawned is therefore never the supervised run: its log is not
read and never judged for staleness, and `status.json.runId` reports `null` rather than naming
the previous run, until the current run's own directory appears.

Nothing is suppressed by this. A runner that goes quiet still reports
`needs_human:stalled` after `--stall-minutes` — measured from its own last log line, or, when it
has never written one, from its own launch.
```

### Step 5.2 — the C3 change-unit

Two facts on component `c3-215` go stale with this change:

- the `scripts/runner/run.ts watchdog` capability row, which describes the tick's inputs but not
  which run the verdict concerns;
- the change-safety row "The watchdog waits forever, relaunches forever, or kills a healthy
  runner", whose verify-points list does not yet include the new end-to-end suite.

Read the component and both rows first, then author the change-unit with the C3 CLI:

```bash
C3X=/Users/hip/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3/bin/c3x.sh
cd /Users/hip/repo/tribe-wt/watchdog-stall && bash "$C3X" --help 2>&1 | head -40
bash "$C3X" lookup c3-215 2>&1 | head -40
```

Author the change-unit under `.c3/changes/<adr-or-card-scoped-dir>/`, following the exact shape
of the committed example `.c3/changes/adr-20260920-c3-215-parser-rule-citation/01-c3-215-gov-rule-one-parser.patch.md`
(YAML frontmatter with `target`, `scope`, and a `base:` node pin of the form
`c3-215#n<line>@v1:sha256:<hash>`, then the replacement row). Add to the watchdog capability row
a clause stating the invariant: the stall verdict only ever concerns the run this invocation is
supervising, a run directory that predates the current spawn is never that run, and a
just-spawned run whose directory is not yet visible is `starting` — bounded by the existing
`--stall-minutes`, never a new flag. Add
`plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh` to the change-safety row's
verify-points.

**Expected result:**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall && bash "$C3X" check 2>&1 | tail -5
```

prints `Checked <N> docs — all clear` and `OK: canonical markdown is in sync`, exactly as it did
on the base commit. If `c3x check` reports an error your change-unit introduced, fix the
change-unit; never hand-edit a file under `.c3/c3-2-plugins/`.

### Step 5.3 — the whole gate sweep

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/runner && bun test 2>&1 | tail -6
bunx tsc --noEmit && echo "tsc: clean"
bash /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh 2>&1 | tail -3
bash /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/tests/test-watchdog-e2e.sh 2>&1 | tail -3
bash /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/tests/test-watchdog-detached.sh 2>&1 | tail -3
bash /Users/hip/repo/tribe-wt/watchdog-stall/plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -3
```

**Expected result:** `bun test` ≥ 1132 pass / 0 fail; `tsc: clean`; each shell suite prints
`N passed, 0 failed`. Transcribe every one of them.

- [ ] **Step 4: Commit**

```bash
cd /Users/hip/repo/tribe-wt/watchdog-stall && git add -A && \
git -c user.email=lamhiep16@gmail.com -c user.name=hieplam commit -m 'docs(watchdog): document which run a stall is about and reconcile c3-215' -m $'Tribe-Card: watchdog-stall-after-quota-relaunch\nTribe-Task: 5/5'
```

**Expected result:** one commit carrying both trailers; `git status --short` empty.

- [ ] Task 5 complete
