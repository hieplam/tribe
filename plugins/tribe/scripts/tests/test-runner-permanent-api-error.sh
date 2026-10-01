#!/usr/bin/env bash
# test-runner-permanent-api-error.sh — card runner-model-support (G3, G4): the end-to-end proof
# that a permanent API error stops a campaign on its FIRST occurrence, and that the documented
# recovery (reset-card, delete NEEDS_OWNER.md, re-run supervise) resumes it.
#
# The world is built from nothing (fixtures-mirror-reality rule 2): a bare `origin`, a clone
# holding independent one-task cards (three where the runner's pass is probed, one where the
# campaign is — the shape of the 2026-10-01 incident), and a v2 campaign home under this test's own HOME.
# The REAL run.ts runs every layer — runner, watchdog, supervisor; only the LLM is replaced, by
# the executor double printing the REAL `result` line a 2026-10-01 campaign received
# (runner/fixtures/executor/result-claude-code-version-too-old.json). No session ever reaches the
# real SDK: the supervisor's own one-shot sessions are pointed at a double that always fails,
# and `--max-spawns 0` parks before one could be spawned.
#
# Usage:
#   test-runner-permanent-api-error.sh                 assert every probe (the card's targets)
#   test-runner-permanent-api-error.sh --only NAME     assert one probe: runner | pool | watchdog
#                                                      | supervise | recovery
#   test-runner-permanent-api-error.sh --measure       print the measured numbers, assert nothing
#                                                      (the G3 ratchet: before -> after)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
RESULT_LINE="$RUNNER/fixtures/executor/result-claude-code-version-too-old.json"
MODE=assert; ONLY=""
case "${1:-}" in
  "") ;;
  --measure) MODE=measure ;;
  --only) ONLY="${2:?--only needs a probe name: runner | pool | watchdog | supervise | recovery}" ;;
  *) echo "usage: test-runner-permanent-api-error.sh [--measure | --only NAME]" >&2; exit 2 ;;
esac
case "$ONLY" in ""|runner|pool|watchdog|supervise|recovery) ;; *) echo "unknown probe: $ONLY" >&2; exit 2 ;; esac
want() { [[ -z "$ONLY" || "$ONLY" == "$1" ]]; }

TMP="$(mktemp -d)"; TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset ANTHROPIC_API_KEY
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
has()   { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (want substring: $3, got: ${2:0:300})"; fi; }
bounded() { perl -e 'alarm shift; exec @ARGV or die "exec: $!"' 300 "$@"; }

# The executor double for every probe: prints the captured result line (DOUBLE_MODE=result-line).
export TRIBE_RUNNER_SESSION_DOUBLE="$RUNNER/fixtures/executor/session-double.sh"
export DOUBLE_MODE=result-line DOUBLE_RESULT_FILE="$RESULT_LINE" DOUBLE_BRANCH=double/pae
# The supervisor's one-shot sessions never reach the real SDK: this double always fails.
export TRIBE_SUPERVISOR_SESSION_DOUBLE=/usr/bin/false

# world <name> <cards> — a fresh repo (bare origin + clone, <cards> independent one-task cards:
# C1, C2, …) and a campaign home under this HOME's tribe root. Sets REPO and H.
world() {
  local base="$TMP/$1" ids=()
  for ((i = 1; i <= $2; i++)); do ids+=("C$i"); done
  git init -q --bare -b master "$base/origin.git"
  git clone -q "$base/origin.git" "$base/repo" 2>/dev/null
  mkdir -p "$base/repo/docs/plans" "$base/repo/docs/specs"
  for c in "${ids[@]}"; do
    printf '# Plan %s\n\n### Task 1: %s\n\n#### Done\n\n```bash\ntest -f never-built-%s\n```\n' "$c" "$c" "$c" > "$base/repo/docs/plans/$c.md"
    printf '# Spec %s\n' "$c" > "$base/repo/docs/specs/$c.md"
  done
  local g=(git -C "$base/repo" -c user.name=fixture -c user.email=fixture@invalid)
  "${g[@]}" add -A; "${g[@]}" commit -q -m start; "${g[@]}" push -q origin master; "${g[@]}" remote set-head origin master
  REPO="$base/repo"
  H="$(bash "$RUNNER/../tribe-home.sh" "$REPO")/campaigns/$1"
  mkdir -p "$H"; : > "$H/answers.md"
  python3 - "$H" "${ids[@]}" <<'PY'
import json, sys
cards = {c: {"status": "staged", "spec": f"docs/specs/{c}.md", "plan": f"docs/plans/{c}.md", "branch": None,
             "baseSha": None, "pr": None, "mergeSha": None, "sessionId": None, "updatedAt": None,
             "tasks": [{"id": "T1", "heading": f"Task 1: {c}"}]} for c in sys.argv[2:]}
json.dump({"v": 2, "campaign": "pae", "mergePolicy": "regular", "sequence": sys.argv[2:],
           "schemaLockPaths": [], "docsOnlyPaths": [], "ownerOnlyEscalations": [], "cards": cards},
          open(sys.argv[1] + "/campaign-state.json", "w"), indent=2)
PY
}
spawns() { grep -c '"event":"spawn"' "$1/supervisor/ledger.jsonl" 2>/dev/null || true; }
park_reason() { sed -n 's/^\*\*Park reason:\*\* //p' "$1/NEEDS_OWNER.md" 2>/dev/null; }
terminal() { python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["terminal"] or {}; print(t.get("reason"), t.get("apiErrorCode"))' "$1/watchdog/status.json" 2>/dev/null; }
supervise() { bounded bun "$RUNNER/run.ts" supervise --repo "$REPO" --model claude-opus-5-5 --home "$H" --poll-seconds 1 --max-spawns 0 > "$TMP/supervise-$1.out" 2>&1 || true; }

if want runner; then
  world runner 3
  bounded bun "$RUNNER/run.ts" --repo "$REPO" --model claude-opus-5-5 --home "$H" --no-viewer > "$TMP/runner.out" 2>&1 || true
  n="$(spawns "$H")"
  if [[ "$MODE" == measure ]]; then echo "runner_serial_spawns=$n"; else check "runner (serial, 3 cards): one spawn, then the pass stops" "$n" "1"; fi
fi

if want pool; then
  world pool 3
  bounded bun "$RUNNER/run.ts" --repo "$REPO" --model claude-opus-5-5 --home "$H" --no-viewer --max-concurrent 2 > "$TMP/pool.out" 2>&1 || true
  n="$(spawns "$H")"
  if [[ "$MODE" == measure ]]; then echo "runner_pool_spawns=$n"; else check "runner (--max-concurrent 2, 3 cards): only the two in-flight cards spawn" "$n" "2"; fi
fi

if want watchdog; then
  world watchdog 1
  bounded bun "$RUNNER/run.ts" watchdog --repo "$REPO" --model claude-opus-5-5 --home "$H" --follow --poll-seconds 1 > "$TMP/watchdog.out" 2>&1 || true
  n="$(spawns "$H")"; t="$(terminal "$H")"
  if [[ "$MODE" == measure ]]; then echo "watchdog_spawns=$n watchdog_terminal=$t"
  else
    check "watchdog: one spawn" "$n" "1"
    check "watchdog: terminal names the permanent API error and its code" "$t" "permanent_api_error claude_code_version_too_old"
  fi
fi

if want supervise || want recovery; then
  world supervise 1
  supervise 1
  n="$(spawns "$H")"; r="$(park_reason "$H")"
  if [[ "$MODE" == measure ]]; then echo "supervise_spawns_before_park=$n park_reason=$r"
  elif want supervise; then
    check "supervise: exactly one spawn before the park" "$n" "1"
    check "supervise: the park reason carries the API error code" "$r" "permanent_api_error (claude_code_version_too_old)"
    has "supervise: NEEDS_OWNER.md names the code in its owner-facing text" "$(cat "$H/NEEDS_OWNER.md" 2>/dev/null)" '`claude_code_version_too_old`'
  fi
  if want recovery; then
    # The owner fixes the cause (here: the double stops failing), then runs the documented recovery.
    export DOUBLE_MODE=do-nothing DOUBLE_REPO="$REPO"
    bun "$RUNNER/run.ts" reset-card --home "$H" --card C1 > /dev/null
    rm -f "$H/NEEDS_OWNER.md"
    before="$(spawns "$H")"; events_before="$(wc -l < "$H/supervisor/events.jsonl")"
    supervise 2
    added=$(( $(spawns "$H") - before ))
    ran_watchdog="$(tail -n +$((events_before + 1)) "$H/supervisor/events.jsonl" | grep -c '"action":"run_watchdog"' || true)"
    if [[ "$MODE" == measure ]]; then echo "recovery_new_spawns=$added recovery_run_watchdog=$ran_watchdog recovery_park_reason=$(park_reason "$H")"
    else
      check "recovery: the re-run supervisor runs a fresh watchdog" "$([[ "$ran_watchdog" -ge 1 ]] && echo yes || echo no)" "yes"
      check "recovery: the campaign reaches a launch (new executor spawns)" "$([[ "$added" -ge 1 ]] && echo yes || echo no)" "yes"
    fi
  fi
fi

[[ "$MODE" == measure ]] && exit 0
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo "PAE=PASS"; else echo "PAE=FAIL"; exit 1; fi
