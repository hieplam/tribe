#!/usr/bin/env bash
# no-live-campaign.sh — the machine-state gate before this card's code reaches master (card
# runner-driver-only, plan Tasks 1.1 and 2.18; Shaman amendment A1). A live watchdog relaunches
# `run.ts` from the master checkout; once PR 2 (state v2, v1 refused) is on master, a campaign still
# running on a v1 state would refuse its own state mid-flight.
#
# Exit 0 only when BOTH hold:
#   1. no live campaign runner, watchdog or supervisor process exists on this machine
#      (any `…/runner/run.ts` process, or `run.ts watchdog` / `run.ts supervise`);
#   2. no campaign home under ~/.tribe/*/campaigns/ holds a v1 campaign-state.json whose
#      .runner.lock names a live pid.
# Exit 1 naming what is live. Exit 2 when a probe itself fails — never a false pass.
#
# The pgrep pattern starts each alternative with a bracket expression (`[r]unner`) so it can never
# match this script's own command line or the `bash -c` that runs it.
set -uo pipefail

live="$(pgrep -fl '[r]unner/run\.ts|[r]un\.ts (watchdog|supervise)')"
code=$?
case "$code" in
  0) printf 'no-live-campaign: live campaign process(es):\n%s\n' "$live"; exit 1 ;;
  1) ;;
  *) echo "no-live-campaign: pgrep failed (exit $code); cannot prove no campaign is live" >&2; exit 2 ;;
esac

python3 - <<'PY'
import glob, json, os, sys
bad = []
for state in sorted(glob.glob(os.path.expanduser('~/.tribe/*/campaigns/*/campaign-state.json'))):
    lock = os.path.join(os.path.dirname(state), '.runner.lock')
    if not os.path.exists(lock):
        continue
    try:
        version = json.load(open(state)).get('v')
    except (OSError, ValueError) as err:
        print(f'no-live-campaign: {state} is unreadable ({err}); cannot rule it out', file=sys.stderr)
        sys.exit(2)
    if version != 1:
        continue
    try:
        pid = int(json.load(open(lock))['pid'])
    except (OSError, ValueError, KeyError, TypeError) as err:
        print(f'no-live-campaign: {lock} is unreadable ({err}); cannot rule it out', file=sys.stderr)
        sys.exit(2)
    try:
        os.kill(pid, 0)
        bad.append(f'{state} (v1) is locked by live pid {pid}')
    except ProcessLookupError:
        pass  # a stale lock: the runner reclaims it; nothing is running
    except PermissionError:
        bad.append(f'{state} (v1) is locked by pid {pid}, alive under another user')
if bad:
    print('no-live-campaign: ' + '; '.join(bad))
    sys.exit(1)
PY
code=$?
[[ "$code" == "0" ]] || exit "$code"
echo 'no-live-campaign: no live campaign process, no live v1 campaign lock'
