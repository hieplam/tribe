#!/usr/bin/env bash
# runner-double.sh — mirrors the REAL campaign runner's OBSERVABLE contract, nothing more:
#   * writes <home>/runs/<run-id>/run.json (schema: runner README "Run record"), in flight
#     first (endedAt/exitCode/reason null), then finalized on exit;
#   * creates <home>/runs/<run-id>/logs/ and, when the scripted pass says so, one session log
#     named <card>-<session-id>.log carrying REAL fixture lines;
#   * exits with the scripted code (runner README "Exit codes").
# It never writes under <home>/watchdog/ (that directory belongs to the watchdog alone) and it
# never spawns anything. Its own attempt counter lives in $DOUBLE_STATE, outside the home.
#
# Scripted by env:
#   DOUBLE_PLAN     space-separated per-attempt specs: "<exit>:<fixture>[:<sleep-seconds>]"
#                   fixture is one of: none | quota | overload
#   DOUBLE_STATE    path to the attempt-counter file (outside the campaign home)
#   DOUBLE_RESET_S  epoch seconds to substitute for the quota fixture's resetsAt
#   DOUBLE_STALE_S  when set with a sleeping pass, back-date the session log by this many
#                   seconds (stall simulation)
#   DOUBLE_RUNDIR_DELAY_S  seconds to wait BEFORE creating runs/<run-id>/ — models the real
#                          wall-clock gap between fork and first write (63-170 ms in the three
#                          recorded field sequences), widened so it is deterministic in a test.
#                          Unset (the default) means no wait, exactly as before.
set -euo pipefail

home=""; args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[$i]}" == "--home" ]] && home="${args[$((i + 1))]}"
done
[[ -n "$home" ]] || { printf 'runner-double: --home is required\n' >&2; exit 1; }

state="${DOUBLE_STATE:?runner-double: DOUBLE_STATE is required}"
attempt=0
[[ -f "$state" ]] && attempt="$(cat "$state")"
next=$((attempt + 1)); printf '%s' "$next" > "$state"

read -r -a plan <<<"${DOUBLE_PLAN:-0:none}"
spec="${plan[$attempt]:-0:none}"
IFS=: read -r exit_code fixture sleep_seconds <<<"$spec"
sleep_seconds="${sleep_seconds:-0}"

# A real runner does git and lock work before it writes its run record, so its runs/<id>/
# directory does not exist for the first tens of milliseconds of its life. Reproducing that gap
# is the whole point of the watchdog's D2 wall, so it is scriptable here rather than left to
# luck. Computing run_id AFTER the wait also keeps ids chronologically ordered.
[[ -z "${DOUBLE_RUNDIR_DELAY_S:-}" ]] || sleep "$DOUBLE_RUNDIR_DELAY_S"

# GM1 (audit round 3): zero-padded to 3 digits so the id's tail stays lexicographically ordered
# past attempt 9 (unpadded, "d10" < "d2") — this module's own convention is that run ids sort
# lexicographically (`select.ts`'s `newestRunId`/`newestRunIdExcluding`), so this fixture double
# must honour it too, past a single digit of attempts.
next_padded="$(printf '%03d' "$next")"
run_id="$(date -u +%Y-%m-%dT%H-%M-%S-000Z)-d$next_padded"
run_dir="$home/runs/$run_id"
mkdir -p "$run_dir/logs"

write_record() { # write_record <endedAt-or-null> <exitCode-or-null> <reason-or-null>
  python3 - "$run_dir/run.json" "$run_id" "$$" "$1" "$2" "$3" <<'PY'
import json, os, sys
path, run_id, pid, ended, code, reason = sys.argv[1:7]
record = {
    "v": 1, "runId": run_id, "pid": int(pid),
    "startedAt": "1970-01-01T00:00:00.000Z",
    "repo": "/repo", "statePath": "", "answersPath": "", "escalationsDir": "",
    "logsDir": os.path.join(os.path.dirname(path), "logs"), "argv": [],
    "endedAt": None if ended == "null" else ended,
    "exitCode": None if code == "null" else int(code),
    "reason": None if reason == "null" else reason,
}
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(record, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
PY
}

write_record null null null   # in flight, exactly like the real runner right after the lock

log="$run_dir/logs/i-card-0000-$next.log"
fixtures="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$fixture" in
  quota)
    sed "s/\"resetsAt\":1788392400/\"resetsAt\":${DOUBLE_RESET_S:-0}/" \
      "$fixtures/quota-real-429.log" > "$log" ;;
  overload) cp "$fixtures/overload-529.log" "$log" ;;
  none)     : ;;
  *) printf 'runner-double: unknown fixture %s\n' "$fixture" >&2; exit 1 ;;
esac

if [[ -n "${DOUBLE_STALE_S:-}" && -f "$log" ]]; then
  python3 -c 'import os,sys,time;t=time.time()-float(sys.argv[2]);os.utime(sys.argv[1],(t,t))' \
    "$log" "$DOUBLE_STALE_S"
fi

[[ "$sleep_seconds" == "0" ]] || sleep "$sleep_seconds"

case "$exit_code" in
  0) reason=done ;;
  2) reason=escalations_pending ;;
  3) reason=session_incomplete ;;
  5) reason=rulings_unratified ;;
  *) reason=error ;;
esac
write_record "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$exit_code" "$reason"
exit "$exit_code"
