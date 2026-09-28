#!/usr/bin/env bash
# v5-stage-a.sh — V5 (card runner-driver-only, spec §6.6): a fresh headless session runs the
# orchestrate-campaign skill through Stage A only, on the Go fixture, naming NO plan style, inside the
# D9 sandbox. The caller sets CLAUDE_CONFIG_DIR. Prints V5_HOME=<new campaign home> and V5_SESSION=<id>.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'usage: v5-stage-a.sh <fixture-clone> <start-sha> <raw-evidence-dir>' >&2; exit 2; }
F="$1"; START="$2"; X="$3"
[[ -n "${CLAUDE_CONFIG_DIR:-}" ]] || { echo 'v5-stage-a: CLAUDE_CONFIG_DIR (the D9 sandbox) is not set' >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/fixture-reset.sh" "$F" "$START"
HOMES="$(bash "$HERE/../../tribe-home.sh" "$F")/campaigns"
mkdir -p "$HOMES"
before="$(ls "$HOMES" | sort)"
PROMPT='Use the orchestrate-campaign skill (invoke it with the Skill tool). Orchestrate this one card on this repo, Stage A only: author the spec, the plan, campaign-state.json and answers.md, and land the spec and plan the way the skill says. Do NOT launch the runner, the watchdog or the supervisor. The card: add `mathx.Clamp(x, lo, hi int) int` (lo when x < lo, hi when x > hi, else x) with a table-driven test. Campaign slug: go-v5-stage-a.'
( cd "$F" && perl -e 'alarm shift; exec @ARGV' 3600 claude -p "$PROMPT" --model sonnet --permission-mode bypassPermissions --output-format json ) > "$X/v5-session.json"
session="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["session_id"])' "$X/v5-session.json")"
new="$(comm -13 <(printf '%s\n' "$before") <(ls "$HOMES" | sort))"
[[ "$(printf '%s\n' "$new" | grep -c .)" == "1" ]] || { echo "v5-stage-a: expected exactly one new campaign home, got: $new" >&2; exit 1; }
echo "V5_HOME=$HOMES/$new"
echo "V5_SESSION=$session"
