#!/usr/bin/env bash
# lib-runner-e2e.sh — the hermetic runner E2E harness (card runner-driver-only, spec §6.4). Sourced,
# never run. Builds its world from nothing (fixtures-mirror-reality rule 2): a bare `origin`, a clone
# holding one spec and one plan, and a v2 campaign home — then runs the REAL run.ts. Offline: every
# path these tests drive escalates or refuses before a PR could exist, so no `gh` call is made.
set -euo pipefail
RDO_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$RDO_HERE/../runner"
DOUBLE="$RUNNER/fixtures/executor/session-double.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TMP/repo.double-wt"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
bounded() { perl -e 'alarm shift; exec @ARGV or die "exec: $!"' 300 "$@"; }

# rdo_world <plan-file-name> — reads the plan's markdown on stdin; commits it under docs/plans/ with a
# one-line spec under docs/specs/, pushes master, and points origin/HEAD at it.
rdo_world() {
  git init -q --bare -b master "$TMP/origin.git"
  git clone -q "$TMP/origin.git" "$TMP/repo" 2>/dev/null
  mkdir -p "$TMP/repo/docs/plans" "$TMP/repo/docs/specs"
  cat > "$TMP/repo/docs/plans/$1"
  printf '# Spec\n\nSee the plan.\n' > "$TMP/repo/docs/specs/$1"
  local g=(git -C "$TMP/repo" -c user.name=fixture -c user.email=fixture@invalid)
  "${g[@]}" add -A; "${g[@]}" commit -q -m start; "${g[@]}" push -q origin master; "${g[@]}" remote set-head origin master
}

# rdo_home <home-dir> <plan-file-name> <task-heading> — a v2 state with one card C1 and one task T1.
rdo_home() {
  mkdir -p "$1"; : > "$1/answers.md"
  python3 -c 'import json,sys; home,plan,heading=sys.argv[1:4]; json.dump({"v":2,"campaign":"e2e","mergePolicy":"regular","sequence":["C1"],"schemaLockPaths":[],"docsOnlyPaths":[],"ownerOnlyEscalations":[],"cards":{"C1":{"status":"staged","spec":"docs/specs/"+plan,"plan":"docs/plans/"+plan,"branch":None,"baseSha":None,"pr":None,"mergeSha":None,"sessionId":None,"updatedAt":None,"tasks":[{"id":"T1","heading":heading}]}}}, open(home+"/campaign-state.json","w"), indent=2)' "$1" "$2" "$3"
}

# rdo_card <home-dir> <python-expression over c> — reads card C1 from the home's state.
rdo_card() { python3 -c 'import json,sys; c=json.load(open(sys.argv[1]+"/campaign-state.json"))["cards"]["C1"]; print(eval(sys.argv[2]))' "$1" "$2"; }

# rdo_done_runs <home-dir> — "<failed> <total>" done_run rows across every run of that home.
rdo_done_runs() { cat "$1"/runs/*/done.jsonl 2>/dev/null | python3 -c 'import json,sys; r=[json.loads(l) for l in sys.stdin if l.strip()]; d=[x for x in r if x["kind"]=="done_run"]; print(sum(1 for x in d if x["passed"] is False), len(d))'; }

rdo_finish() { printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"; if [[ "$FAIL" == "0" ]]; then echo "$1=PASS"; else echo "$1=FAIL"; exit 1; fi; }
