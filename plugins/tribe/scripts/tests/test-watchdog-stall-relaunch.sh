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
# fail-closed-edges obligation 3: every subprocess carries a timeout, so a hang can never block
# this test forever. There is no `timeout` binary on macOS (same gap already documented in
# test-watchdog-detached.sh and test-supervisor-kill.sh in this same directory), so the bound is
# implemented portably: run the CLI in the background, race it against a watchdog sleep that
# kills it if it outlives 120s, then collect whichever finished first.
OUT_FILE="$TMP/watchdog-cli.out"
( cd "$TMP" && bun "$RUNNER/run.ts" watchdog --repo "$REPO" \
  --model stall-relaunch-model --home "$H" --poll-seconds 1 >"$OUT_FILE" 2>&1 ) &
cli_pid=$!
( sleep 120; kill -9 "$cli_pid" 2>/dev/null ) &
killer_pid=$!
set +e
wait "$cli_pid"
rc=$?
set -e
kill "$killer_pid" 2>/dev/null || true
wait "$killer_pid" 2>/dev/null || true
out="$(cat "$OUT_FILE")"
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
