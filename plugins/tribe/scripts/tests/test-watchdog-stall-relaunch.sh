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
#
# fixtures-mirror-reality (fix round 1, M2): probed with BOTH an absolute --home and a relative
# one (test-watchdog-e2e.sh's Probe 2 shape — "the shape a person actually types") — an untested
# input SHAPE is a far more common defect source than an untested VALUE.
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

CAMPAIGNS="$HOME/.tribe/key/campaigns"
OLD_ID="2026-09-19T05-00-30-073Z-8df1"

# FC1 (fixer round 2, spec §10 goal S1-2): a pid that is DEFINITELY dead, verified with `kill
# -0` rather than fabricated blindly — required to make the real watchdog CLI relaunch (cause
# `crash`) instead of merely launching once. Tries a few high, unlikely-to-exist pids; refuses
# (fail-closed-edges) rather than silently trusting an unverified guess.
pick_dead_pid() {
  local candidate
  for candidate in 999999 998877 987654 918273; do
    if ! kill -0 "$candidate" 2>/dev/null; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  printf 'pick_dead_pid: could not find a verified-dead pid candidate\n' >&2
  return 1
}
DEAD_PID="$(pick_dead_pid)"

# seed_home <home_dir> — a minimal real campaign home plus a PREVIOUS run, finished, whose
# session log is 2h old (> --stall-minutes 30): the exact shape the field stalls came from.
seed_home() {
  local home="$1"
  mkdir -p "$home"
  cat > "$home/campaign-state.json" <<'JSON'
{"v":1,"campaign":"stall-relaunch","mergePolicy":"regular-merge-only","sequence":["E1"],
 "schemaLockPaths":[],"docsOnlyPaths":[],"ownerOnlyEscalations":[],
 "cards":{"E1":{"status":"staged","spec":"docs/never-authored.md","plan":"docs/never-authored.md",
  "branch":null,"baseSha":null,"pr":null,"mergeSha":null,"sessionId":null,"updatedAt":null}}}
JSON
  : > "$home/answers.md"

  local old="$home/runs/$OLD_ID"; mkdir -p "$old/logs"
  python3 - "$old/run.json" "$OLD_ID" <<'PY'
import json, sys
path, run_id = sys.argv[1], sys.argv[2]
json.dump({"v": 1, "runId": run_id, "pid": 999999,
           "startedAt": "2026-09-19T05:00:30.073Z", "repo": "/repo", "statePath": "",
           "answersPath": "", "escalationsDir": "", "logsDir": "", "argv": [],
           "endedAt": "2026-09-19T05:05:50.000Z", "exitCode": 0, "reason": "done"},
          open(path, "w"))
PY
  local old_log="$old/logs/E1-11111111-2222-3333-4444-555555555555.log"
  printf '{"type":"assistant"}\n' > "$old_log"
  python3 -c 'import os,sys,time;t=time.time()-7200;os.utime(sys.argv[1],(t,t))' "$old_log"
}

# seed_crashed_home <home_dir> — FC1: a minimal real campaign home plus a PREVIOUS run that
# CRASHED — unfinalized (endedAt/exitCode/reason null, exactly as a SIGKILLed process leaves
# it) and whose pid is confirmed dead. The real watchdog CLI's first tick reads this as "a crash
# with no code to read" (`crashSuspected`, `watch-loop.ts`) and relaunches with `cause: crash`
# — a genuine relaunch, driven end-to-end through the REAL `run.ts watchdog` CLI, never a
# fakeIo/unit-test stand-in. Session log is 2h old, same shape as `seed_home`'s stale sibling.
seed_crashed_home() {
  local home="$1"
  mkdir -p "$home"
  cat > "$home/campaign-state.json" <<'JSON'
{"v":1,"campaign":"stall-relaunch","mergePolicy":"regular-merge-only","sequence":["E1"],
 "schemaLockPaths":[],"docsOnlyPaths":[],"ownerOnlyEscalations":[],
 "cards":{"E1":{"status":"staged","spec":"docs/never-authored.md","plan":"docs/never-authored.md",
  "branch":null,"baseSha":null,"pr":null,"mergeSha":null,"sessionId":null,"updatedAt":null}}}
JSON
  : > "$home/answers.md"

  local old="$home/runs/$OLD_ID"; mkdir -p "$old/logs"
  python3 - "$old/run.json" "$OLD_ID" "$DEAD_PID" <<'PY'
import json, sys
path, run_id, pid = sys.argv[1], sys.argv[2], int(sys.argv[3])
json.dump({"v": 1, "runId": run_id, "pid": pid,
           "startedAt": "2026-09-19T05:00:30.073Z", "repo": "/repo", "statePath": "",
           "answersPath": "", "escalationsDir": "", "logsDir": "", "argv": [],
           "endedAt": None, "exitCode": None, "reason": None},
          open(path, "w"))
PY
  local old_log="$old/logs/E1-11111111-2222-3333-4444-555555555555.log"
  printf '{"type":"assistant"}\n' > "$old_log"
  python3 -c 'import os,sys,time;t=time.time()-7200;os.utime(sys.argv[1],(t,t))' "$old_log"
}

# run_probe <label> <home_dir> <cwd> <home_arg> — runs the real watchdog CLI once from <cwd>
# with `--home <home_arg>` (absolute or relative — the caller decides which), against a home
# already seeded by seed_home, and asserts D2 holds.
#
# fail-closed-edges obligation 3: every subprocess carries a timeout, so a hang can never block
# this test forever. There is no `timeout` binary on macOS (same gap already documented in
# test-watchdog-detached.sh and test-supervisor-kill.sh in this same directory), so the bound is
# implemented portably: run the CLI in the background, race it against a watchdog sleep that
# kills it if it outlives 120s, then collect whichever finished first.
run_probe() {
  local label="$1" home="$2" cwd="$3" home_arg="$4"
  local out_file="$TMP/watchdog-cli-$label.out"
  ( cd "$cwd" && bun "$RUNNER/run.ts" watchdog --repo "$REPO" \
    --model stall-relaunch-model --home "$home_arg" --poll-seconds 1 >"$out_file" 2>&1 ) &
  local cli_pid=$!
  ( sleep 120; kill -9 "$cli_pid" 2>/dev/null ) &
  local killer_pid=$!
  set +e
  wait "$cli_pid"
  local rc=$?
  set -e
  kill "$killer_pid" 2>/dev/null || true
  wait "$killer_pid" 2>/dev/null || true
  local out; out="$(cat "$out_file")"
  printf '%s\n' "$out"

  local reason; reason="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"]["reason"])' \
    "$home/watchdog/status.json")"
  local actions; actions="$(python3 - "$home/watchdog/events.jsonl" <<'PY'
import json, sys
with open(sys.argv[1]) as fh:
    print(",".join(json.loads(line)["action"] for line in fh if line.strip()))
PY
)"

  # D2, wall 1: no stall event at all — the new runner was alive the whole time.
  case ",$actions," in
    *,stall,*) bad "$label: no stall is declared against the previous run's log (actions: $actions)" ;;
    *)         ok  "$label: no stall is declared against the previous run's log" ;;
  esac
  # D2, wall 2: the terminal reason is the runner's own outcome, never `stalled`.
  if [[ "$reason" == "stalled" ]]; then bad "$label: the terminal reason is not 'stalled'"; else ok "$label: the terminal reason is not 'stalled' (got: $reason)"; fi
  if [[ "$rc" == "10" && "$reason" == "stalled" ]]; then bad "$label: the watchdog does not exit 10 stalled"; else ok "$label: the watchdog does not exit 10 stalled (rc: $rc)"; fi
  # D2, wall 3: nothing the watchdog published may name the PREVIOUS run as the current one.
  local stall_json; stall_json="$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))["stall"]))' \
    "$home/watchdog/status.json")"
  check "$label: status.json publishes no stall record" "$stall_json" "null"
  case "$out" in
    *"$OLD_ID"*) bad "$label: the watchdog never names the previous run id on stdout" ;;
    *)           ok  "$label: the watchdog never names the previous run id on stdout" ;;
  esac
}

# run_probe_relaunch <label> <home_dir> — FC1: drives a genuine RELAUNCH through the real
# `run.ts watchdog` CLI (spec §10 goal S1-2) against a home seeded by seed_crashed_home, and
# asserts D2 holds across that relaunch: a `relaunch` event IS recorded (otherwise this probe
# proves nothing), no `stall` fires, the terminal reason is never `stalled`, and
# `status.json.runId` never names the crashed previous run — once the new run's own directory
# exists on disk, `status.json.runId` names exactly that new run.
run_probe_relaunch() {
  local label="$1" home="$2"
  local out_file="$TMP/watchdog-cli-$label.out"
  ( bun "$RUNNER/run.ts" watchdog --repo "$REPO" \
    --model stall-relaunch-model --home "$home" --poll-seconds 1 >"$out_file" 2>&1 ) &
  local cli_pid=$!
  ( sleep 120; kill -9 "$cli_pid" 2>/dev/null ) &
  local killer_pid=$!
  set +e
  wait "$cli_pid"
  local rc=$?
  set -e
  kill "$killer_pid" 2>/dev/null || true
  wait "$killer_pid" 2>/dev/null || true
  local out; out="$(cat "$out_file")"
  printf '%s\n' "$out"

  local actions; actions="$(python3 - "$home/watchdog/events.jsonl" <<'PY'
import json, sys
with open(sys.argv[1]) as fh:
    print(",".join(json.loads(line)["action"] for line in fh if line.strip()))
PY
)"

  # FC1 wall 0: the probe must actually exercise a RELAUNCH, or it proves nothing (S1-2).
  case ",$actions," in
    *,relaunch,*) ok  "$label: a relaunch event is recorded (actions: $actions)" ;;
    *)            bad "$label: a relaunch event is recorded (actions: $actions)" ;;
  esac
  # D2, wall 1: no stall event at all — the relaunched runner was alive the whole time.
  case ",$actions," in
    *,stall,*) bad "$label: no stall is declared against the crashed previous run's log (actions: $actions)" ;;
    *)         ok  "$label: no stall is declared against the crashed previous run's log" ;;
  esac
  # D2, wall 2: the terminal reason is the runner's own outcome, never `stalled`.
  local reason; reason="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"]["reason"])' \
    "$home/watchdog/status.json")"
  if [[ "$reason" == "stalled" ]]; then bad "$label: the terminal reason is not 'stalled'"; else ok "$label: the terminal reason is not 'stalled' (got: $reason)"; fi
  if [[ "$rc" == "10" && "$reason" == "stalled" ]]; then bad "$label: the watchdog does not exit 10 stalled"; else ok "$label: the watchdog does not exit 10 stalled (rc: $rc)"; fi

  # S1-2: once the relaunched run's own directory exists, status.json.runId names THAT run — read
  # from disk, never hardcoded, since a real forked process's run id is only known after it writes.
  local new_run_id; new_run_id="$(ls "$home/runs" | grep -v -x "$OLD_ID" || true)"
  if [[ -z "$new_run_id" ]]; then
    bad "$label: a new run directory (not the crashed previous run) was created by the relaunch"
  else
    ok "$label: a new run directory (not the crashed previous run) was created by the relaunch ($new_run_id)"
  fi
  local status_run_id; status_run_id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["runId"])' \
    "$home/watchdog/status.json")"
  if [[ "$status_run_id" == "$OLD_ID" ]]; then
    bad "$label: status.json.runId never names the crashed previous run"
  else
    ok "$label: status.json.runId never names the crashed previous run (got: $status_run_id)"
  fi
  check "$label: status.json.runId names the new run once its directory exists" "$status_run_id" "$new_run_id"
  case "$out" in
    *"$OLD_ID"*) bad "$label: the watchdog never names the crashed previous run id on stdout" ;;
    *)           ok  "$label: the watchdog never names the crashed previous run id on stdout" ;;
  esac
}

# --- Probe 1: the minimal real home (state + answers), ABSOLUTE --home ----------------------
H1="$CAMPAIGNS/stall-relaunch-abs"
seed_home "$H1"
run_probe abs "$H1" "$TMP" "$H1"

# --- Probe 2: the same thing with a RELATIVE --home (the shape a person types) --------------
H2="$CAMPAIGNS/stall-relaunch-rel"
seed_home "$H2"
run_probe rel "$H2" "$CAMPAIGNS" "stall-relaunch-rel"

# --- Probe 3: a genuine RELAUNCH through the real CLI (FC1, spec §10 goal S1-2) --------------
H3="$CAMPAIGNS/stall-relaunch-crash"
seed_crashed_home "$H3"
run_probe_relaunch crash-relaunch "$H3"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
