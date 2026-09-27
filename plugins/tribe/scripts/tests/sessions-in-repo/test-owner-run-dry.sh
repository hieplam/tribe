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
# The pre-seeded ruling has TWO jobs, and spec §7's expected flow needs BOTH — so both are
# pinned here, separately:
#   (1) an unratified (`pending`) ruling exists from the start, so the runner exits
#       `rulings_unratified` and the supervisor spawns a `ratify` session;
#   (2) the campaign's own card `owner-run-probe` is left UNRULED, so the probe plan's
#       "Before any task — ask first" gate fires, the runner exits `escalations_pending`, and
#       the supervisor spawns a `ruling` session. `ruling` is reachable on NO other path, so a
#       pre-seed whose `Card:` field says `owner-run-probe` answers the question before it is
#       asked and silently costs the whole `ruling` session (measured: run
#       sir-owner-run-20260927T092641Z scored G1 2/2 kinds=closing,ratify — 2 supervisor
#       sessions where spec §5 row G8 requires ≥ 3).
command grep -q 'ratified-as: pending' "$home/answers.md"
if command grep -n -i -e '^[*[:space:]]*Card:[*[:space:]]*`\{0,1\}owner-run-probe' "$home/answers.md"; then
  echo "not ok - answers.md pre-seeds a ruling FOR card owner-run-probe: the probe plan's ask-first gate would not fire, so no 'ruling' session is ever spawned (spec §7)"; exit 1
fi
command grep -q -e 'Not a ruling for .*owner-run-probe' "$home/answers.md" \
  || { echo "not ok - answers.md never states that card owner-run-probe is unruled"; exit 1; }
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
