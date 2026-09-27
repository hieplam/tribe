#!/usr/bin/env bash
# test-watchdog-e2e.sh — G5: ONE end-to-end run of the REAL campaign runner under the REAL
# watchdog, against a throwaway campaign home built from nothing. No double, no mock, no gh,
# no session spawn (the card's spec/plan do not exist, so the runner escalates
# planning_needed and never starts a session — zero tokens).
#
# fixtures-mirror-reality: the watchdog is invoked BOTH ways a person can invoke it — with an
# absolute --home and with a relative one from inside the campaigns directory.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# W-P10: resolve TMP's own symlinks NOW (macOS's mktemp -d hands back a path under
# /var/folders/... that is itself a symlink to /private/var/folders/...). The watchdog's
# resolveWatchdogHome realpaths --home before comparing it to the tribe root, so every path
# this script builds under $TMP must already be the resolved form or every string comparison
# against the watchdog's own printed/observed paths would spuriously fail on this OS.
TMP="$(cd "$TMP" && pwd -P)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check()    { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi }
contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (got: $2, want substring: $3)"; fi }

# A throwaway machine: its own HOME, so the watchdog's --home containment root is this
# temp tree and nothing here can touch the real ~/.tribe.
export HOME="$TMP/home"; mkdir -p "$HOME"

# A throwaway target repo (the runner runs git in it; it never needs a remote for this path).
REPO="$TMP/repo"; git init -q -b master "$REPO"
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

CAMPAIGNS="$HOME/.tribe/key/campaigns"
new_home() { # new_home <slug> [--with-answers]
  local home="$CAMPAIGNS/$1"; mkdir -p "$home"
  cat > "$home/campaign-state.json" <<'JSON'
{
  "v": 2,
  "campaign": "watchdog-e2e",
  "mergePolicy": "regular-merge-only",
  "sequence": ["E1"],
  "schemaLockPaths": [],
  "docsOnlyPaths": [],
  "ownerOnlyEscalations": [],
  "cards": {
    "E1": {
      "status": "staged",
      "spec": "docs/never-authored-spec.md",
      "plan": "docs/never-authored-plan.md",
      "branch": null,
      "baseSha": null,
      "pr": null,
      "mergeSha": null,
      "sessionId": null,
      "updatedAt": null,
      "tasks":[{"id":"T1","heading":"Task 1"}]
    }
  }
}
JSON
  [[ "${2:-}" == "--with-answers" ]] && : > "$home/answers.md"
  printf '%s' "$home"
}

# --- Probe 1: the minimal real home (state + answers), ABSOLUTE --home ------------------
H1="$(new_home abs --with-answers)"
set +e
out_abs="$(bun "$RUNNER/run.ts" watchdog --repo "$REPO" --model e2e-model --home "$H1" \
  --poll-seconds 1 2>&1)"
rc_abs=$?
set -e
check "absolute --home: the watchdog exits 10 (needs_human)" "$rc_abs" "10"
contains "and its last stdout line names the status file" "$out_abs" "status: $H1/watchdog/status.json"

reason="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"]["reason"])' \
  "$H1/watchdog/status.json")"
check "status.json reason is escalations_pending" "$reason" "escalations_pending"

actions="$(python3 - "$H1/watchdog/events.jsonl" <<'PY'
import json, sys
with open(sys.argv[1]) as fh:
    print(",".join(json.loads(line)["action"] for line in fh if line.strip()))
PY
)"
# Measured on this repo: a follow-mode watchdog observes the freshly-spawned child as ALIVE
# on the very next tick (before its exit lands), so decide() attaches to it before the
# terminal exit is observed — start,launch,attach,exit, not start,launch,exit. Both "launch"
# and "exit" are present and in order, matching the governing quote ("launch then exit"); the
# attach in between is a real, deterministic observation of the live runner, not a defect.
check "events.jsonl records start,launch,attach,exit" "$actions" "start,launch,attach,exit"

# Zero sessions spawned: the real runner never created a logs/ dir for this pass.
if [[ -z "$(find "$H1/runs" -type d -name logs 2>/dev/null)" ]]; then
  ok "zero session logs: the runner spawned no session (zero tokens)"
else
  bad "zero session logs (found: $(find "$H1/runs" -type d -name logs))"
fi

# The runner's own report agrees with the watchdog's verdict (exit code is a hint, the report
# is the truth — runner README).
runner_reason="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["run"]["reason"])' \
  "$H1/campaign-report.json")"
check "the runner's own report says escalations_pending" "$runner_reason" "escalations_pending"
if [[ -f "$H1/escalations/E1.md" ]]; then ok "the escalation file exists"; else bad "the escalation file exists"; fi
contains "and names the planning_needed reason" "$(cat "$H1/escalations/E1.md")" "planning_needed"

# W-P9: the watchdog wrote nothing outside <home>/watchdog/.
wd_only=1
while IFS= read -r f; do
  case "$f" in
    "$H1"/watchdog/*) ;;
    "$H1"/campaign-state.json|"$H1"/answers.md|"$H1"/campaign-report.*|"$H1"/escalations/*|"$H1"/runs/*|"$H1"/reports/*) ;;
    *) wd_only=0; printf 'unexpected path: %s\n' "$f" ;;
  esac
done < <(find "$H1" -type f)
check "no path outside home/watchdog or the runner's own artifacts" "$wd_only" "1"

# --- Probe 2: the same thing with a RELATIVE --home (the shape a person types) ----------
H2="$(new_home rel --with-answers)"
set +e
out_rel="$(cd "$CAMPAIGNS" && bun "$RUNNER/run.ts" watchdog --repo "$REPO" --model e2e-model \
  --home rel --poll-seconds 1 2>&1)"
rc_rel=$?
set -e
check "relative --home: the watchdog exits 10 too" "$rc_rel" "10"
contains "and resolved it to the same absolute campaign home" "$out_rel" "$H2/watchdog/status.json"
reason_rel="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"]["reason"])' \
  "$H2/watchdog/status.json")"
check "relative --home reaches the same verdict" "$reason_rel" "escalations_pending"

# --- Probe 3: a home with NO answers.md — the pre-existing runner ENOENT (FU-i74-1) -----
# Documented, not fixed here (runner-core changes are outside this card's fence). The
# watchdog must still report a clean typed outcome rather than a stack trace of its own.
H3="$(new_home bare)"
set +e
out_bare="$(bun "$RUNNER/run.ts" watchdog --repo "$REPO" --model e2e-model --home "$H3" \
  --poll-seconds 1 2>&1)"
rc_bare=$?
set -e
check "a home with no answers.md still ends in a clean watchdog exit 10" "$rc_bare" "10"
reason_bare="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"]["reason"])' \
  "$H3/watchdog/status.json")"
check "and the reason is the runner's exit-4 mapping, not a crash" "$reason_bare" "error"
case "$out_bare" in
  *"at "*"("*.ts:*) bad "the watchdog never prints a stack trace" ;;
  *)                ok "the watchdog never prints a stack trace" ;;
esac

# --- Probe 4: containment refusals are typed, one line, exit 1 --------------------------
set +e
out_out="$(bun "$RUNNER/run.ts" watchdog --repo "$REPO" --model e2e-model --home "$TMP/outside" 2>&1)"
rc_out=$?
set -e
check "a --home outside the tribe root exits 1" "$rc_out" "1"
contains "with a typed refusal naming the root" "$out_out" "is outside the tribe root"

set +e
mkdir -p "$CAMPAIGNS/nostate"
out_nostate="$(bun "$RUNNER/run.ts" watchdog --repo "$REPO" --model e2e-model \
  --home "$CAMPAIGNS/nostate" 2>&1)"
rc_nostate=$?
set -e
check "a --home with no campaign-state.json exits 1" "$rc_nostate" "1"
contains "with a typed refusal naming the missing file" "$out_nostate" "has no campaign-state.json"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
