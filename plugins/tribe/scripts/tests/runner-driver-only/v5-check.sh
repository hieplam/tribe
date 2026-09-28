#!/usr/bin/env bash
# v5-check.sh — V5's pass condition (spec §6.6): the authored plan and state carry no Tribe
# instruction; every task heading of the plan is in the state's task index and resolves with at least
# one Done command (the runner's own plan-index); the runner's --dry-run accepts the state.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'usage: v5-check.sh <campaign-home> <fixture-clone>' >&2; exit 2; }
H="$1"; F="$2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="$(cd "$HERE/../../runner" && pwd)"
PASS=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; else FAIL=$((FAIL+1)); printf 'not ok - %s (got: %s, want: %s)\n' "$1" "$2" "$3"; fi; }
git -C "$F" fetch -q && git -C "$F" merge -q --ff-only origin/master
card="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sequence"][0])' "$H/campaign-state.json")"
plan="$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print(s["cards"][s["sequence"][0]]["plan"])' "$H/campaign-state.json")"
check "V5: the state is v2" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["v"])' "$H/campaign-state.json")" "2"
# The bun programs run in plain assignments, never inline in a double-quoted `check` argument: macOS
# /bin/bash 3.2 brace-expands a "..." nested inside "$(...)" there, splitting `{a,b}` into two words.
tribe="$(bun -e "import {readFileSync} from 'node:fs'; import {countTribeMentions,totalOf} from '$HERE/tribe-lexicon.ts'; console.log(totalOf(countTribeMentions(readFileSync('$H/campaign-state.json','utf8') + readFileSync('$F/$plan','utf8'))))")" || true
check "V5: the plan and state carry no Tribe way of working" "$tribe" "0"
index="$(bun -e "
import {readFileSync} from 'node:fs'; import {resolveTaskIndex} from '$R/core/plan-index.ts';
const s = JSON.parse(readFileSync('$H/campaign-state.json','utf8')); const c = s.cards[s.sequence[0]];
const md = readFileSync('$F/$plan','utf8');
const heads = md.split('\n').filter((l) => /^#{1,6}\s+Task \d/.test(l)).length;
const r = resolveTaskIndex('$card', c.tasks, md);
console.log(r.issues.length === 0 && heads === c.tasks.length && r.tasks.every((t) => t.doneCommands.length > 0) ? 'ok' : JSON.stringify({ heads, tasks: c.tasks.length, issues: r.issues }));
")" || true
check "V5: every task heading is indexed and resolves with Done commands" "$index" "ok"
set +e
out="$(bun "$R/run.ts" --repo "$F" --model sonnet --home "$H" --dry-run --no-viewer 2>&1)"; code=$?
set -e
check "V5: --dry-run accepts the state" "$code" "0"
check "V5: --dry-run names the card" "$(printf '%s' "$out" | grep -c "\"$card\"")" "1"
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo 'V5=PASS'; else echo 'V5=FAIL'; exit 1; fi
