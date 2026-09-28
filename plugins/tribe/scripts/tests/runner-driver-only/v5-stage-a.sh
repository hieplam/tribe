#!/usr/bin/env bash
# v5-stage-a.sh — V5 (card runner-driver-only, spec §6.6): a fresh headless session runs the
# orchestrate-campaign skill through Stage A only, on the Go fixture, naming NO plan style, inside the
# D9 sandbox. The caller sets CLAUDE_CONFIG_DIR. Prints V5_HOME=<new campaign home> and V5_SESSION=<id>.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'usage: v5-stage-a.sh <fixture-clone> <start-sha> <raw-evidence-dir>' >&2; exit 2; }
F="$1"; START="$2"; X="$3"
[[ -n "${CLAUDE_CONFIG_DIR:-}" ]] || { echo 'v5-stage-a: CLAUDE_CONFIG_DIR (the D9 sandbox) is not set' >&2; exit 2; }
bounded() { local seconds="$1"; shift; perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$seconds" "$@"; }
die() { printf 'v5-stage-a: %s\n' "$*" >&2; exit 1; }
script_dir="$(bounded 120 dirname "${BASH_SOURCE[0]}")" || die 'dirname failed or timed out'
HERE="$(cd "$script_dir" && pwd)" || die 'cannot resolve script directory'
bounded 600 bash "$HERE/fixture-reset.sh" "$F" "$START" || die 'fixture reset failed or timed out'
# Host git config is off for tribe-home's git rev-parse; the claude session keeps the user's environment.
home="$(GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null bounded 120 bash "$HERE/../../tribe-home.sh" "$F")" || die 'tribe-home failed or timed out'
HOMES="$home/campaigns"
bounded 120 mkdir -p "$HOMES" || die 'cannot create campaigns directory'
before="$(bounded 120 ls "$HOMES" | bounded 120 sort)" || die 'listing campaign homes failed or timed out'
PROMPT='Use the orchestrate-campaign skill (invoke it with the Skill tool). Orchestrate this one card on this repo, Stage A only: author the spec, the plan, campaign-state.json and answers.md, and land the spec and plan the way the skill says. Do NOT launch the runner, the watchdog or the supervisor. The card: add `mathx.Clamp(x, lo, hi int) int` (lo when x < lo, hi when x > hi, else x) with a table-driven test. Campaign slug: go-v5-stage-a.'
( cd "$F" && perl -e 'alarm shift; exec @ARGV' 3600 claude -p "$PROMPT" --model sonnet --permission-mode bypassPermissions --output-format json ) > "$X/v5-session.json"
session="$(bounded 120 python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["session_id"])' "$X/v5-session.json")" || die 'reading session id failed or timed out'
after="$(bounded 120 ls "$HOMES" | bounded 120 sort)" || die 'listing campaign homes failed or timed out'
new="$(printf '%s\n' "$after" | bounded 120 comm -13 <(printf '%s\n' "$before") -)" || die 'comparing campaign homes failed or timed out'
count="$(printf '%s\n' "$new" | bounded 120 grep -c .)" || die "expected exactly one new campaign home, got: $new"
[[ "$count" == "1" ]] || die "expected exactly one new campaign home, got: $new"
echo "V5_HOME=$HOMES/$new"
echo "V5_SESSION=$session"
