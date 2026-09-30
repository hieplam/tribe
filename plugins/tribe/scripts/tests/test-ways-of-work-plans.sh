#!/usr/bin/env bash
# test-ways-of-work-plans.sh — one plan format, two gates (card ways-of-work-consolidation, G3/G4).
#
# A plan in each of the three modes of shaman.md "Ways of work" is built from nothing — its mode
# block read from that section, never restated here — committed into a hermetic git world, and
# run through BOTH gates a plan must pass: validate-plan.sh and the campaign runner's --dry-run.
# Each mutant must fail with a NAMED reason: the validator's failing check, and for a task with
# no Done section also the runner's own refusal. A three-card campaign, one card per mode, must
# dry-run clean (orchestrate-campaign Stage A step 8). Offline: no card reaches a PR, so no `gh`
# call is made. Needs bun and the runner's node_modules (`bun install` in scripts/runner).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATE="$HERE/../validate-plan.sh"
RUNNER="$HERE/../runner"
SHAMAN="$HERE/../../agents/shaman.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
bounded() { perl -e 'alarm shift; exec @ARGV or die "exec: $!"' 120 "$@"; }

# block_of MODE — the mode's block from shaman.md "Ways of work", as a plan author copies it.
block_of() {
  python3 - "$SHAMAN" "$1" <<'EOF'
import re, sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
start = next(i for i, l in enumerate(lines) if l == "## Ways of work")
end = next((i for i in range(start + 1, len(lines)) if re.match(r"^#{1,2} ", lines[i])), len(lines))
for body in re.findall(r"^```markdown\n(.*?)^```$", "\n".join(lines[start:end]), re.S | re.M):
    if body.startswith(f"Executor: {sys.argv[2]}\n"):
        print(body.rstrip("\n"))
        break
else:
    sys.exit(f"no block for {sys.argv[2]}")
EOF
}

# task N TITLE — one complete task: a step, its Verify block, its Done section, one Commit step.
task() {
  printf '### Task %s: %s\n\n- [ ] **Step 1: Build**\n\n```bash\ntouch unit-%s.txt\n```\n\n' "$1" "$2" "$1"
  printf '#### Verify\n\n- Goal: G3 (fixture).\n- Red: `test -f unit-%s.txt` before building -> exit 1.\n' "$1"
  printf -- '- Green: `test -f unit-%s.txt` -> exit 0.\n- Stub check: an empty commit leaves no file, so the Green fails.\n\n' "$1"
  printf '#### Done\n\n```bash\ntrue\n```\n\n- [ ] **Step 2: Commit**\n\n```bash\ngit commit -m "task %s"\n```\n\n' "$1"
}
HUNTER='Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic implementer.'
# plan MODE BLOCK-FILTER TASK-TITLE... — a plan in MODE whose copied block passes through BLOCK-FILTER.
plan() {
  local mode="$1" filter="$2" n=0; shift 2
  printf '# Fixture plan — %s\n\n## Global Constraints\n\n- %s\n\n## Way of work\n\nReasons: the card records this mode.\n\n' "$mode" "$HUNTER"
  block_of "$mode" | eval "$filter"; printf '\n'
  for title in "$@"; do n=$((n+1)); task "$n" "$title"; done
}

# The world: a bare origin and a clone holding every fixture plan, as the runner needs it.
git init -q --bare -b master "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/repo" 2>/dev/null
mkdir -p "$TMP/repo/docs/plans" "$TMP/repo/docs/specs"
P="$TMP/repo/docs/plans"
plan single-agent cat 'Build' 'Final review' > "$P/single-agent.md"
plan subagent-per-task cat 'Build one' 'Build two' 'Final review' > "$P/subagent-per-task.md"
plan tribe cat 'Build one' 'Build two' > "$P/tribe.md"
plan subagent-per-task cat 'Build one' 'Build two' 'Build three' > "$P/m-no-review.md"
plan single-agent cat 'Build one' 'Build two' 'Final review' > "$P/m-single-three.md"
plan tribe 'head -n 1' 'Build one' 'Build two' > "$P/m-tribe-no-block.md"
plan subagent-per-task 'grep -v "^Executor:"' 'Build one' 'Final review' > "$P/m-undeclared.md"
plan subagent-per-task cat 'Build one' 'Final review' | python3 -c "
import sys
t = sys.stdin.read()
i = t.index('#### Done'); j = t.index('- [ ] **Step 2: Commit**', i)
sys.stdout.write(t[:i] + t[j:])" > "$P/m-no-done.md"
for f in "$P"/*.md; do printf '# Spec\n\nSee the plan.\n' > "$TMP/repo/docs/specs/$(basename "$f")"; done
g=(git -C "$TMP/repo" -c user.name=fixture -c user.email=fixture@invalid)
"${g[@]}" add -A; "${g[@]}" commit -q -m fixtures; "${g[@]}" push -q origin master; "${g[@]}" remote set-head origin master

# home HOME CARD=PLAN... — a v2 campaign state whose cards list every task heading of their plan.
home() {
  local dir="$1"; shift
  mkdir -p "$dir"; : > "$dir/answers.md"
  python3 - "$dir" "$TMP/repo" "$@" <<'EOF'
import json, re, sys
home, repo, cards = sys.argv[1], sys.argv[2], sys.argv[3:]
state = {"v": 2, "campaign": "wow", "mergePolicy": "regular", "sequence": [], "schemaLockPaths": [],
         "docsOnlyPaths": [], "ownerOnlyEscalations": [], "cards": {}}
for card in cards:
    cid, name = card.split("=")
    heads = [m.group(1) for m in re.finditer(r"^### (Task \d+: .*)$", open(f"{repo}/docs/plans/{name}.md").read(), re.M)]
    state["sequence"].append(cid)
    state["cards"][cid] = {"status": "staged", "spec": f"docs/specs/{name}.md", "plan": f"docs/plans/{name}.md",
                           "branch": None, "baseSha": None, "pr": None, "mergeSha": None, "sessionId": None,
                           "updatedAt": None, "tasks": [{"id": f"T{i + 1}", "heading": h} for i, h in enumerate(heads)]}
json.dump(state, open(f"{home}/campaign-state.json", "w"), indent=2)
EOF
}
dry_run() { # dry_run HOME — prints the runner's exit code; its stderr lands in HOME.err
  set +e
  bounded bun "$RUNNER/run.ts" --repo "$TMP/repo" --model fixture --home "$1" --no-viewer --dry-run > "$1.out" 2> "$1.err"
  local code=$?
  set -e
  printf '%s' "$code"
}
verdict() { bash "$VALIDATE" "$P/$1.md" | python3 -c "import json,sys; print(json.load(sys.stdin)['verdict'])"; }
failing() { bash "$VALIDATE" "$P/$1.md" | python3 -c "import json,sys; print(','.join(c['name'] for c in json.load(sys.stdin)['checks'] if c['status'] == 'fail'))"; }

# --- Each mode's plan passes both gates -----------------------------------------------------
for mode in single-agent subagent-per-task tribe; do
  check "$mode plan: validate-plan.sh verdict" "$(verdict "$mode")" "pass"
  home "$TMP/h-$mode" "C1=$mode"
  check "$mode plan: runner --dry-run exit" "$(dry_run "$TMP/h-$mode")" "0"
done

# --- Each mutant fails with a named reason --------------------------------------------------
check "subagent-per-task without a final review task: named check" "$(failing m-no-review)" "final_review_task_last"
check "single-agent with 3 tasks: named check" "$(failing m-single-three)" "single_agent_within_limit"
check "tribe without its audit block: named check" "$(failing m-tribe-no-block)" "mode_block_copied"
check "an undeclared mode: named checks" "$(failing m-undeclared)" "way_of_work_declared,mode_block_copied"
check "a task without the runner's Done section: named check" "$(failing m-no-done)" "tasks_have_done_block"
home "$TMP/h-no-done" "C1=m-no-done"
check "a task without the runner's Done section: runner --dry-run exit" "$(dry_run "$TMP/h-no-done")" "4"
check "a task without the runner's Done section: the runner names missing_done" "$(grep -c 'missing_done' "$TMP/h-no-done.err")" "1"

# --- A three-card campaign, one card per mode, dry-runs clean -------------------------------
home "$TMP/h-campaign" "C1=single-agent" "C2=subagent-per-task" "C3=tribe"
check "three-card campaign (one card per mode): runner --dry-run exit" "$(dry_run "$TMP/h-campaign")" "0"
check "three-card campaign: the next card is the first in sequence" "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['cardId'])" "$TMP/h-campaign.out")" "C1"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo "V-WOW=PASS"; else echo "V-WOW=FAIL"; exit 1; fi
