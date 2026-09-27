#!/usr/bin/env bash
# owner-run.sh start --dry-run then wait, from nothing: a throwaway HOME and repo (fixtures-mirror-reality rule 2).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
REPO="$TMP/repo"; git init -q -b master "$REPO"
mkdir -p "$REPO/docs/superpowers/plans" && cp "$HERE/../../../../../docs/superpowers/plans/2026-09-27-owner-run-probe.md" "$REPO/docs/superpowers/plans/"
GIT_CONFIG_GLOBAL=/dev/null git -C "$REPO" -c user.email=t@t.test -c user.name=t add -A
GIT_CONFIG_GLOBAL=/dev/null git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q -m init
EV="$TMP/ev"
out="$(cd "$TMP" && bash "$HERE/owner-run.sh" start --repo repo --evidence "$EV" --dry-run)"   # RELATIVE --repo, the way a person types it
home="$(printf '%s\n' "$out" | sed -n 's/^HOME_DIR=//p')"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["cards"]["owner-run-probe"]["status"]=="staged"' "$home/campaign-state.json"
command grep -q 'ratified-as: pending' "$home/answers.md"
[[ -s "$EV/g7-main-before.txt" ]]
t0=$SECONDS
w="$(bash "$HERE/owner-run.sh" wait --evidence "$EV")"
(( SECONDS - t0 <= 540 )) || { echo "not ok - wait exceeded 540 s"; exit 1; }
[[ "$w" == "terminal 0 dry_run" ]] || { echo "not ok - wait printed: $w"; exit 1; }
# A running status and a short budget: wait must return "running" on time, never block.
printf '{"v":1,"state":"observing","lastAction":"x","terminal":null}' > "$home/supervisor/status.json"
t0=$SECONDS; w="$(bash "$HERE/owner-run.sh" wait --evidence "$EV" --max-seconds 3)"
(( SECONDS - t0 <= 5 )) && [[ "$w" == running* ]] || { echo "not ok - bounded wait: $w"; exit 1; }
echo "dirty" > "$REPO/x"
if bash "$HERE/owner-run.sh" start --repo "$REPO" --evidence "$TMP/ev2" --dry-run 2>/dev/null; then echo "not ok - dirty repo accepted"; exit 1; fi
echo "ok - owner-run start/wait dry run"
