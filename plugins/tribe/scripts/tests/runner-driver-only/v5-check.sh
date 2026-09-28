#!/usr/bin/env bash
# v5-check.sh — V5's pass condition (spec §6.6): the authored plan and state carry no Tribe
# instruction; every task heading of the plan is in the state's task index and resolves with at least
# one Done command (the runner's own plan-index); the runner's --dry-run accepts the state.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'usage: v5-check.sh <campaign-home> <fixture-clone>' >&2; exit 2; }
H="$1"; F="$2"
bounded() { local seconds="$1"; shift; perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$seconds" "$@"; }
HERE="$(cd "$(bounded 120 dirname "${BASH_SOURCE[0]}")" && pwd)"
R="$(cd "$HERE/../../runner" && pwd)"
PASS=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; else FAIL=$((FAIL+1)); printf 'not ok - %s (got: %s, want: %s)\n' "$1" "$2" "$3"; fi; }
bounded 120 git -C "$F" fetch -q || { echo 'v5-check: fixture fetch failed or timed out' >&2; exit 1; }
bounded 120 git -C "$F" merge -q --ff-only origin/master || { echo 'v5-check: fixture merge failed or timed out' >&2; exit 1; }
# Refuse a plan outside the fixture before either check opens it. Emit its resolved path so a
# symlink inside the fixture cannot redirect the later read through its original spelling.
selection="$(bounded 120 python3 -c '
import json, pathlib, sys
try:
    state = json.loads(pathlib.Path(sys.argv[1]).read_text())
    card = state["sequence"][0]
    plan = state["cards"][card]["plan"]
    root = pathlib.Path(sys.argv[2]).resolve(strict=True)
except (OSError, UnicodeError, ValueError, KeyError, IndexError, TypeError) as error:
    sys.exit(f"v5-check: cannot select plan: {error}")
if not isinstance(card, str) or not isinstance(plan, str) or not plan or "\n" in card or "\n" in plan or pathlib.Path(plan).is_absolute():
    sys.exit("v5-check: invalid card or plan path")
try:
    resolved = (root / plan).resolve(strict=True)
except (OSError, RuntimeError) as error:
    sys.exit(f"v5-check: cannot resolve plan: {error}")
if not resolved.is_relative_to(root) or not resolved.is_file():
    sys.exit("v5-check: plan leaves fixture clone or is not a file")
print(card)
print(resolved)
' "$H/campaign-state.json" "$F")" || { echo 'v5-check: refusing unreadable or uncontained plan' >&2; exit 2; }
card="${selection%%$'\n'*}"
plan="${selection#*$'\n'}"
check "V5: the state is v2" "$(bounded 120 python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["v"])' "$H/campaign-state.json")" "2"
# The bun programs run in plain assignments, never inline in a double-quoted `check` argument: macOS
# /bin/bash 3.2 brace-expands a "..." nested inside "$(...)" there, splitting `{a,b}` into two words.
tribe="$(bounded 120 bun -e '
import {readFileSync} from "node:fs";
const {countTribeMentions, totalOf} = await import(process.argv[3]);
console.log(totalOf(countTribeMentions(readFileSync(process.argv[1], "utf8") + readFileSync(process.argv[2], "utf8"))));
' -- "$H/campaign-state.json" "$plan" "$HERE/tribe-lexicon.ts")" || true
check "V5: the plan and state carry no Tribe way of working" "$tribe" "0"
index="$(bounded 120 bun -e '
import {readFileSync} from "node:fs";
const {resolveTaskIndex} = await import(process.argv[4]);
const s = JSON.parse(readFileSync(process.argv[1], "utf8")); const c = s.cards[s.sequence[0]];
const md = readFileSync(process.argv[2], "utf8");
const heads = md.split("\n").filter((l) => /^#{1,6}\s+Task \d/.test(l)).length;
const r = resolveTaskIndex(process.argv[3], c.tasks, md);
console.log(r.issues.length === 0 && heads === c.tasks.length && r.tasks.every((t) => t.doneCommands.length > 0) ? "ok" : JSON.stringify({ heads, tasks: c.tasks.length, issues: r.issues }));
' -- "$H/campaign-state.json" "$plan" "$card" "$R/core/plan-index.ts")" || true
check "V5: every task heading is indexed and resolves with Done commands" "$index" "ok"
set +e
dry_run_timeout="${V5_CHECK_DRY_RUN_TIMEOUT:-300}"
[[ "$dry_run_timeout" =~ ^[1-9][0-9]*$ ]] || { echo 'v5-check: invalid dry-run timeout' >&2; exit 2; }
out="$(bounded "$dry_run_timeout" bun "$R/run.ts" --repo "$F" --model sonnet --home "$H" --dry-run --no-viewer 2>&1)"; code=$?
set -e
check "V5: --dry-run accepts the state" "$code" "0"
check "V5: --dry-run names the card" "$(printf '%s' "$out" | bounded 120 grep -c "\"$card\"")" "1"
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo 'V5=PASS'; else echo 'V5=FAIL'; exit 1; fi
