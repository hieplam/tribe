#!/usr/bin/env bash
# test-supervisor-kill.sh — Task 18 (card `campaign-supervisor`, G4): `kill -9` of the
# supervisor at three distinct, deterministic instants, each followed by a manual restart from
# the SAME `--home`, against the REAL `supervise` composition root and a REAL session double —
# no TypeScript mock (`fixtures-mirror-reality.md`: the unit tests already prove the decision
# plumbing; this file's whole value is the real process/disk boundary a mock cannot reach).
#
# Oracle (card G4, verbatim): "kill -9 of the supervisor at any instant (including
# mid-ruling-session) followed by a manual restart loses nothing and never double-rules one
# escalation." The property under test is NOT "it restarts" — it is "loses nothing AND never
# double-rules one escalation." A restart that re-rules an already-ruled question is the defect,
# even if every process exits 0.
#
# Adjudication rule — REFUTED in advance:
#   - "kill -9 at an arbitrary instant is untestable, use SIGTERM" — refused: SIGKILL is the
#     stated contract and exactly what a harness timeout delivers. All three instants below are
#     deterministic (a sentinel file, or — where no double seam reaches — a test-local process
#     shim), never a timing race.
#   - "an extra ruling ROUND consumed after a kill is a failure" — it is NOT: S-P6 makes
#     over-counting the safe direction. Double-RULING (a second `## ` block for the SAME
#     escalation) is the failure.
#
# R6 amendment (Warchief ruling, 2026-09-19, on this task's own BLOCKED report): Kill B's
# original plan wording ("the restart ARCHIVES the escalation") exceeds card G4 and is
# infeasible without a new persisted field (`landedRulingId`) through `core/state.ts`, which is
# FROZEN/fenced — accepted debt, not built by this task. G4's literal contract is "loses nothing
# AND never double-rules"; a restart that PARKS with `repeat_escalation` (data intact, no second
# ruling session) satisfies both. See `docs/superpowers/plans/2026-09-18-campaign-supervisor.md`
# Task 18, Kill B, for the amended oracle this file's Kill-B scenario asserts.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
DOUBLE="$RUNNER/fixtures/supervisor/session-double.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# W-P10 (test-watchdog-e2e.sh's own precedent, mirrored by test-supervisor-e2e.sh): resolve
# TMP's own symlinks NOW — macOS's `mktemp -d` hands back a path under `/var/folders/...` that
# is itself a symlink to `/private/var/folders/...`.
TMP="$(cd "$TMP" && pwd -P)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check()    { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi }
contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (got: $2, want substring: $3)"; fi }

# A throwaway machine: its own HOME, so the supervisor's --home/--campaign containment root is
# this temp tree and nothing here can ever touch the real ~/.tribe.
export HOME="$TMP/home"; mkdir -p "$HOME"

# A throwaway target repo — real git, never a network remote (card c1 is pre-marked `shipped`
# below, so no card work, no `gh`, is ever attempted against it).
REPO="$TMP/repo"; git init -q -b master "$REPO"
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

TRIBE_HOME="$(bash "$RUNNER/../tribe-home.sh" "$REPO")"
CAMPAIGNS="$TRIBE_HOME/campaigns"

# `new_campaign <slug>` — assembles a campaign home from NOTHING (fixtures-mirror-reality rule
# 2), mirroring `test-supervisor-e2e.sh`'s own `new_campaign` exactly: card c1 pre-marked
# `shipped` (so the real watchdog/runner re-verification pass every scenario below triggers
# finishes in well under a second — no `gh`, no session, no network), a pre-seeded
# `<home>/watchdog/status.json` carrying a terminal `escalations_pending` (so the FIRST tick
# goes straight to the ruling decision instead of first spawning a real watchdog to discover
# it), and a matching `campaign-report.json` + `escalations/c1.md`. Echoes the home's absolute
# path.
new_campaign() {
  local slug="$1" home="$CAMPAIGNS/$1"
  mkdir -p "$home/escalations" "$home/watchdog"
  cat > "$home/campaign-state.json" <<JSON
{
  "v": 1,
  "campaign": "$slug",
  "mergePolicy": "regular-merge-only",
  "sequence": ["c1"],
  "schemaLockPaths": [],
  "docsOnlyPaths": [],
  "ownerOnlyEscalations": [],
  "cards": {
    "c1": {
      "status": "shipped",
      "spec": "docs/never-authored-spec.md",
      "plan": "docs/never-authored-plan.md",
      "branch": null,
      "baseSha": null,
      "pr": 1,
      "mergeSha": "deadbeef",
      "sessionId": null,
      "updatedAt": null
    }
  }
}
JSON
  : > "$home/answers.md"
  cat > "$home/escalations/c1.md" <<'MD'
**Reason:** generic-ruling-needed

## Context
The session double needs to make a call here.
MD
  cat > "$home/watchdog/status.json" <<JSON
{"v":1,"pid":999999,"home":"$home","startedAt":"1970-01-01T00:00:00.000Z","updatedAt":"1970-01-01T00:00:00.000Z","mode":"follow","runnerPid":null,"terminal":{"status":"needs_human","reason":"escalations_pending","exitCode":2}}
JSON
  cat > "$home/campaign-report.json" <<JSON
{
  "run": {"reason": "escalations_pending", "unratifiedRulings": []},
  "cards": {"c1": {"outcome": "escalated", "escalationFile": "escalations/c1.md", "question": "generic-ruling-needed", "autoAnswerRounds": 0}},
  "pending": [],
  "stats": {"shipped": 0, "escalated": 1, "blocked": 0, "notReached": 0}
}
JSON
  printf '%s' "$home"
}

export TRIBE_SUPERVISOR_SESSION_DOUBLE="$DOUBLE"
export DOUBLE_REPO="$REPO"
SUPERVISE_ARGS=(--session-timeout-seconds 60 --session-max-turns 5 --poll-seconds 1)

# `poll_until <max-iters> <sleep-seconds> <check-fn> [args...]` — there is no `timeout` binary;
# every deterministic instant below is reached by polling a disk fact in a BOUNDED loop, never a
# fixed sleep guess. `check-fn` is a shell function so this stays a plain `if` (safe under
# `set -e`/`pipefail` — never a raw `&&`/`||` chain at statement level).
poll_until() {
  local max="$1" slp="$2"; shift 2
  local i=0
  while (( i < max )); do
    if "$@"; then return 0; fi
    sleep "$slp"
    i=$((i + 1))
  done
  return 1
}

run_watchdog_count() { grep -c '"action":"run_watchdog"' "$1/supervisor/events.jsonl" 2>/dev/null || echo 0; }
await_watchdog_count() { grep -c '"action":"await_watchdog"' "$1/supervisor/events.jsonl" 2>/dev/null || echo 0; }
answers_block_count() { grep -c '^## ' "$1/answers.md" 2>/dev/null || echo 0; }
last_event() { tail -n1 "$1/supervisor/events.jsonl" 2>/dev/null || echo ''; }

# =================================================================================================
# Control run: the SAME campaign shape, no kill — the comparison values every scenario below
# asserts against ("the double was invoked the SAME number of times as an un-killed control run",
# "grep -c '^## ' answers.md equals the control run's value").
# =================================================================================================
HCTL="$(new_campaign kill-control)"
export DOUBLE_PLAN="rule:R1 close-pass"
export DOUBLE_STATE="$TMP/double-state-control"
set +e
outctl="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$HCTL" "${SUPERVISE_ARGS[@]}" 2>&1)"
rcctl=$?
set -e
check "control: exits 0" "$rcctl" "0"
CONTROL_ANSWERS_BLOCKS="$(answers_block_count "$HCTL")"
CONTROL_DOUBLE_COUNT="$(cat "$TMP/double-state-control" 2>/dev/null || echo 0)"
check "control: exactly one ## block" "$CONTROL_ANSWERS_BLOCKS" "1"
check "control: the double was invoked twice (one ruling, one closing)" "$CONTROL_DOUBLE_COUNT" "2"
contains "control: reaches campaign_closed" "$(last_event "$HCTL")" "campaign_closed"

# =================================================================================================
# Kill A — mid-wait: kill -9 while the supervisor awaits its watchdog child. Restart. Expect: the
# watchdog child SURVIVED and is ADOPTED (events.jsonl records await_watchdog, never a second
# run_watchdog while it was alive); the campaign reaches the SAME terminal state; the double was
# invoked the SAME number of times as the control run.
#
# No env-var double seam reaches the WATCHDOG's own real runner-spawn (TRIBE_SUPERVISOR_SESSION_
# DOUBLE covers only the supervisor's OWN one-shot judgment sessions — session-double.adapter.ts's
# own doc comment) — so this scenario builds a test-local `bun` PATH shim (generated fresh into
# $TMP, never committed, never touching any production file) that blocks the REAL watchdog's
# runner-spawn on a sentinel: `watch-loop.ts` spawns the runner as `bun <entrypoint> --repo ...`
# with NO subcommand token (`adapters/watchdog-io.adapter.ts`'s own `runnerCommand: () => ['bun',
# RUNNER_ENTRYPOINT]`), distinguishable from the WATCHDOG's own spawn (`... watchdog --repo ...`)
# and the outer `supervise` invocation (`... supervise ...`) by that one positional token — both
# of which the shim `exec`s straight through, unblocked. Because the watchdog spawn passes
# through via `exec` (same pid preserved) and publishes `watchdog/status.json` with a live pid
# and `terminal: null` as "the FIRST thing that happens, before any observation, spawn or sleep"
# (`watch-loop.ts`), by the time the runner-spawn blocks, the on-disk watchdog status is already
# a genuine "alive, non-terminal" fact — exactly what a restarted supervisor's P4 adoption needs.
# =================================================================================================
HA="$(new_campaign kill-a)"
export DOUBLE_PLAN="rule:R1 close-pass"
export DOUBLE_STATE="$TMP/double-state-a"

FAKE_BIN="$TMP/fakebin-a"; mkdir -p "$FAKE_BIN"
REAL_BUN="$(command -v bun)"
KILL_A_SENTINEL="$TMP/killA.sentinel"; : > "$KILL_A_SENTINEL"
cat > "$FAKE_BIN/bun" <<SHIM
#!/usr/bin/env bash
if [[ "\${1:-}" == *run.ts ]] && [[ "\${2:-}" != "watchdog" ]] && [[ "\${2:-}" != "supervise" ]]; then
  while [[ -f "$KILL_A_SENTINEL" ]]; do sleep 0.05; done
fi
exec "$REAL_BUN" "\$@"
SHIM
chmod +x "$FAKE_BIN/bun"

killA_ready() {
  grep -q '"action":"await_watchdog"' "$1/supervisor/events.jsonl" 2>/dev/null || return 1
  [[ -f "$1/watchdog/status.json" ]] || return 1
  python3 -c "
import json, sys
d = json.load(open('$1/watchdog/status.json'))
sys.exit(0 if d.get('terminal') is None and isinstance(d.get('pid'), int) else 1)
" 2>/dev/null
}

PATH="$FAKE_BIN:$PATH" bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$HA" "${SUPERVISE_ARGS[@]}" \
  > "$TMP/killA-sup1.out" 2>&1 &
SUP1=$!

if poll_until 400 0.02 killA_ready "$HA"; then
  ok "killA: the supervisor reached await_watchdog with a live, non-terminal watchdog on disk"
else
  bad "killA: the supervisor reached await_watchdog with a live, non-terminal watchdog on disk (timed out polling)"
fi
check "killA: exactly one run_watchdog recorded before the kill" "$(run_watchdog_count "$HA")" "1"

WD_PID="$(python3 -c "import json;print(json.load(open('$HA/watchdog/status.json'))['pid'])" 2>/dev/null || echo 0)"

kill -9 "$SUP1" 2>/dev/null || true
sleep 0.3
if kill -0 "$SUP1" 2>/dev/null; then bad "killA: the supervisor process is actually dead after kill -9"; else ok "killA: the supervisor process is actually dead after kill -9"; fi
if kill -0 "$WD_PID" 2>/dev/null; then ok "killA: the watchdog child SURVIVED the supervisor's death"; else bad "killA: the watchdog child SURVIVED the supervisor's death"; fi

# Restart WHILE the watchdog (and its sentinel-blocked runner grandchild) are still alive — this
# is what proves ADOPTION, not merely "it eventually finished on its own."
PATH="$FAKE_BIN:$PATH" bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$HA" "${SUPERVISE_ARGS[@]}" \
  > "$TMP/killA-sup2.out" 2>&1 &
SUP2=$!

killA_adopted() { [[ "$(await_watchdog_count "$HA")" -ge 2 ]]; }
if poll_until 400 0.02 killA_adopted; then
  ok "killA: restart records a SECOND await_watchdog — adoption, not a re-spawn"
else
  bad "killA: restart records a SECOND await_watchdog — adoption, not a re-spawn"
fi
check "killA: still exactly one run_watchdog in the whole trail — never a second spawn while the watchdog was alive" \
  "$(run_watchdog_count "$HA")" "1"

rm -f "$KILL_A_SENTINEL"
set +e
wait "$SUP2"; rcA=$?
set -e
check "killA: the restarted supervisor reaches the SAME exit code as the control run" "$rcA" "0"
contains "killA: reaches campaign_closed, the same terminal state as control" "$(last_event "$HA")" "campaign_closed"
check "killA: answers.md matches the control run's block count" "$(answers_block_count "$HA")" "$CONTROL_ANSWERS_BLOCKS"
check "killA: the double was invoked the SAME number of times as the control run" \
  "$(cat "$TMP/double-state-a" 2>/dev/null || echo 0)" "$CONTROL_DOUBLE_COUNT"

# =================================================================================================
# Kill B — mid-ruling-session: the double blocks on a sentinel AFTER writing the ruling to
# answers.md; kill -9 the supervisor there; remove the sentinel; restart.
#
# R6-amended expectation (see this file's own header): answers.md has EXACTLY ONE new ## block
# (never two — no double-ruling); no data is lost (the ruling stays durable in answers.md AND the
# escalation file is still present, never silently dropped); the restart PARKS with reason
# repeat_escalation — the accepted safe-but-manual outcome for the ruling-landed-pre-archive
# crash window, NOT a second ruling session; the double's counter did NOT grow across the kill.
# =================================================================================================
HB="$(new_campaign kill-b)"
export DOUBLE_PLAN="rule-block:R1 close-pass"
export DOUBLE_STATE="$TMP/double-state-b"
export DOUBLE_SENTINEL="$TMP/killB.sentinel"
: > "$DOUBLE_SENTINEL"

bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$HB" "${SUPERVISE_ARGS[@]}" \
  > "$TMP/killB-sup1.out" 2>&1 &
SUPB1=$!

killB_landed() { [[ "$(answers_block_count "$HB")" == "1" ]]; }
if poll_until 400 0.02 killB_landed; then
  ok "killB: the ruling landed in answers.md before the kill"
else
  bad "killB: the ruling landed in answers.md before the kill"
fi
check "killB: exactly one ## block landed (never two) before the kill" "$(answers_block_count "$HB")" "1"
if [[ -f "$HB/escalations/c1.md" ]]; then
  ok "killB: the escalation file is still present at kill time (not yet archived)"
else
  bad "killB: the escalation file is still present at kill time (not yet archived)"
fi

kill -9 "$SUPB1" 2>/dev/null || true
sleep 0.3
if kill -0 "$SUPB1" 2>/dev/null; then bad "killB: the supervisor is actually dead after kill -9"; else ok "killB: the supervisor is actually dead after kill -9"; fi

# No data lost: the ruling is STILL durable, and the escalation file was never renamed/dropped.
check "killB: no data lost — answers.md still carries exactly one ## block after the kill" \
  "$(answers_block_count "$HB")" "1"
if [[ -f "$HB/escalations/c1.md" ]]; then
  ok "killB: no data lost — the escalation file survives the kill untouched"
else
  bad "killB: no data lost — the escalation file survives the kill untouched"
fi

rm -f "$DOUBLE_SENTINEL"
set +e
outB2="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$HB" "${SUPERVISE_ARGS[@]}" 2>&1)"
rcB2=$?
set -e
check "killB: restart exits needs_owner (20) — the accepted safe-but-manual outcome, not a silent done" "$rcB2" "20"
contains "killB: restart PARKS with reason repeat_escalation (R6-amended oracle), never a second ruling" \
  "$(last_event "$HB")" '"reason":"repeat_escalation"'
if [[ -f "$HB/NEEDS_OWNER.md" ]]; then
  contains "killB: NEEDS_OWNER.md names the repeat_escalation park reason" \
    "$(cat "$HB/NEEDS_OWNER.md")" "**Park reason:** repeat_escalation"
else
  bad "killB: NEEDS_OWNER.md names the repeat_escalation park reason"
fi
check "killB: NEVER a second ruling session — the double's counter did not grow past 1" \
  "$(cat "$TMP/double-state-b" 2>/dev/null || echo 0)" "1"
check "killB: answers.md matches the control run's block count — no double-ruling, ever" \
  "$(answers_block_count "$HB")" "$CONTROL_ANSWERS_BLOCKS"

# =================================================================================================
# Kill C — mid-re-trigger: kill -9 between the archive and the next run_watchdog. Expect: the
# restart re-observes, sees the archive already done, and re-triggers once; the escalation file
# is not renamed twice and no .resolved-R<n>.resolved-R<n> exists.
# =================================================================================================
HC="$(new_campaign kill-c)"
export DOUBLE_PLAN="rule:R1 close-pass"
export DOUBLE_STATE="$TMP/double-state-c"

bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$HC" "${SUPERVISE_ARGS[@]}" \
  > "$TMP/killC-sup1.out" 2>&1 &
SUPC1=$!

killC_archived() { grep -q '"action":"archive_escalation"' "$HC/supervisor/events.jsonl" 2>/dev/null; }
if poll_until 800 0.005 killC_archived; then
  ok "killC: archive_escalation was recorded before the kill"
else
  bad "killC: archive_escalation was recorded before the kill"
fi

kill -9 "$SUPC1" 2>/dev/null || true
sleep 0.3
if kill -0 "$SUPC1" 2>/dev/null; then bad "killC: the supervisor is actually dead after kill -9"; else ok "killC: the supervisor is actually dead after kill -9"; fi

if [[ -f "$HC/escalations/c1.md.resolved-R1" ]]; then
  ok "killC: the escalation file was archived exactly once (single .resolved-R1 suffix)"
else
  bad "killC: the escalation file was archived exactly once (single .resolved-R1 suffix)"
fi
if [[ -f "$HC/escalations/c1.md.resolved-R1.resolved-R1" ]]; then
  bad "killC: never a double-suffixed .resolved-R1.resolved-R1 before restart"
else
  ok "killC: never a double-suffixed .resolved-R1.resolved-R1 before restart"
fi

set +e
outC2="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$HC" "${SUPERVISE_ARGS[@]}" 2>&1)"
rcC2=$?
set -e
check "killC: restart exits 0 — re-observes, re-triggers, and completes" "$rcC2" "0"
contains "killC: reaches campaign_closed, same terminal state as control" "$(last_event "$HC")" "campaign_closed"
if [[ -f "$HC/escalations/c1.md.resolved-R1.resolved-R1" ]]; then
  bad "killC: still never a double-suffixed archive after restart"
else
  ok "killC: still never a double-suffixed archive after restart"
fi
check "killC: never a second run_watchdog for the SAME re-trigger across the kill+restart" \
  "$(run_watchdog_count "$HC")" "1"
check "killC: answers.md matches the control run's block count" "$(answers_block_count "$HC")" "$CONTROL_ANSWERS_BLOCKS"
check "killC: the double was invoked the SAME number of times as the control run" \
  "$(cat "$TMP/double-state-c" 2>/dev/null || echo 0)" "$CONTROL_DOUBLE_COUNT"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
