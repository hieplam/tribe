#!/usr/bin/env bash
# test-supervisor-docs.sh — the supervisor-path and doorbell walls in orchestrate-campaign/SKILL.md
# (plan Task 22, card scope fence: "orchestrate-campaign/SKILL.md is updated so Stage B/C/D
# describe the supervisor path and the doorbell; the hand-driven path stays documented as the
# fallback").
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$HERE/../../skills/orchestrate-campaign/SKILL.md"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
gate() { if grep -q "$2" "$SKILL"; then ok "$1"; else bad "$1"; fi }

# --- Wall 1: Stage B names the supervisor launch AND keeps the bare watchdog launch --------
gate "Stage B names the supervisor" 'run.ts supervise'
gate "the watchdog launch is still documented" 'run.ts watchdog'

# --- Wall 2: the doorbell section exists, states what it never does, and carries the
# owner-ruling transcription procedure (spec §12.1) including the ruled-by marker and the
# latch deletion. ------------------------------------------------------------------------
gate "the doorbell section exists" 'doorbell'
gate "the doorbell never rules on its own authority" 'never rules on its own authority'
gate "the owner-ruling marker is documented" 'ruled-by: owner'
gate "the latch and its deletion are documented" 'NEEDS_OWNER.md'

# --- Wall 3: the walls are untouched, byte for byte -----------------------------------------
gate "W7 unchanged" 'W7 — bounded auto-answer\.\*\* At most 2 auto-answer rounds per card'
gate "W3 unchanged" 'W3 — judgment stays in sessions'

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
