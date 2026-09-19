#!/usr/bin/env bash
# session-double.sh (Task 17, card `campaign-supervisor`) — a scripted stand-in for the real
# Claude Agent SDK one-shot judgment session, spawned by
# `adapters/session-double.adapter.ts#spawnSessionDouble` whenever
# `TRIBE_SUPERVISOR_SESSION_DOUBLE` names this script. Mirrors
# `runner/fixtures/watchdog/runner-double.sh`'s own shape (a per-attempt DOUBLE_PLAN, read by
# an attempt counter that lives OUTSIDE the campaign home so a test probe can read "how many
# times was the double invoked" without that count being just another home artifact the
# write-surface probe would have to special-case).
#
# It writes ONLY `<home>/answers.md` (a ruling/ratify session's real target, spec §5.2/§5.3) and
# `<home>/supervisor/final-report.md` (a closing session's real target, spec §5.4 — a location
# already inside the supervisor's own write surface, S-P5) — it NEVER writes anywhere else
# under `<home>/supervisor/**` (that directory is otherwise the supervisor's own exclusive
# write surface) and it NEVER spawns anything.
#
# Args: --home <campaign-home> --kind <ruling|ratify|closing>. `kind` is accepted (and
# recorded, see DOUBLE_LOG below) so the seam's own contract is satisfied, but this script's
# BEHAVIOR is fully described by its own DOUBLE_PLAN entry for this attempt — never re-derived
# from `kind` here. Keeping the two in agreement is the test script's job, the same way it
# already controls which attempt number falls on which real spawn.
#
# Scripted by env:
#   DOUBLE_PLAN   space-separated per-attempt specs, read by ATTEMPT NUMBER (this invocation's
#                 own 1-based ordinal across every kind), one of:
#                   none              - write nothing
#                   rule:<id>         - append a valid ratified "## <id>" block to answers.md
#                   rule-touch:<id>   - same, AND writes one file into $DOUBLE_REPO (the
#                                       decision-4 "touched the target repo" case)
#                   rule-block:<id>   - same write as `rule:<id>`, THEN blocks (polling every
#                                       0.05s) until $DOUBLE_SENTINEL is removed — Task 18's own
#                                       sentinel-file block, so a test can `kill -9` the
#                                       SUPERVISOR at the deterministic instant "the ruling has
#                                       already landed on disk, but this session has not yet
#                                       exited" (card `campaign-supervisor` G4, Kill B).
#                   close             - write a non-empty final-report.md
#                   sleep:<seconds>   - sleep, then write nothing (lets a test hold the
#                                       supervisor's lock open long enough to race a second one)
#   DOUBLE_STATE  path to the attempt-counter file (outside the campaign home)
#   DOUBLE_REPO   the target repo root — only read by a `rule-touch:` spec
#   DOUBLE_SENTINEL  path to a test-created file — only read by a `rule-block:` spec, and
#                    required whenever that spec is selected for the current attempt.
set -euo pipefail

home=""; kind=""
while (( "$#" )); do
  case "$1" in
    --home) home="$2"; shift 2 ;;
    --kind) kind="$2"; shift 2 ;;
    *) printf 'session-double: unknown argument %s\n' "$1" >&2; exit 1 ;;
  esac
done
[[ -n "$home" ]] || { printf 'session-double: --home is required\n' >&2; exit 1; }
[[ -n "$kind" ]] || { printf 'session-double: --kind is required\n' >&2; exit 1; }

state="${DOUBLE_STATE:?session-double: DOUBLE_STATE is required}"
attempt=0
[[ -f "$state" ]] && attempt="$(cat "$state")"
next=$((attempt + 1)); printf '%s' "$next" > "$state"
printf '%s attempt=%s kind=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%S)" "$next" "$kind" >> "${state}.log"

read -r -a plan <<<"${DOUBLE_PLAN:-none}"
spec="${plan[$attempt]:-none}"

case "$spec" in
  none) : ;;
  sleep:*)
    sleep "${spec#sleep:}"
    ;;
  rule:*|rule-touch:*|rule-block:*)
    id="${spec#*:}"
    printf '\n## %s\n\nratified-as: operational\n' "$id" >> "$home/answers.md"
    if [[ "$spec" == rule-touch:* ]]; then
      repo="${DOUBLE_REPO:?session-double: DOUBLE_REPO is required for a rule-touch spec}"
      printf 'touched by session double (kind=%s, attempt=%s)\n' "$kind" "$next" \
        > "$repo/session-double-touch.txt"
    fi
    if [[ "$spec" == rule-block:* ]]; then
      sentinel="${DOUBLE_SENTINEL:?session-double: DOUBLE_SENTINEL is required for a rule-block spec}"
      # The ruling is already durably on disk (the printf above); this process now sits alive,
      # blocked, until the test removes the sentinel — the deterministic instant a Task-18 kill
      # scenario targets ("landed but not yet archived").
      while [[ -f "$sentinel" ]]; do sleep 0.05; done
    fi
    ;;
  close)
    mkdir -p "$home/supervisor"
    printf '# Campaign report\n\nEverything shipped. (session double, kind=%s, attempt=%s)\n' \
      "$kind" "$next" > "$home/supervisor/final-report.md"
    ;;
  *) printf 'session-double: unknown DOUBLE_PLAN spec "%s"\n' "$spec" >&2; exit 1 ;;
esac

exit 0
