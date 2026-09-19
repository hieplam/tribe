#!/usr/bin/env bash
# test-supervisor-docs.sh — the supervisor-path and doorbell walls in orchestrate-campaign/SKILL.md
# (plan Task 22, card scope fence: "orchestrate-campaign/SKILL.md is updated so Stage B/C/D
# describe the supervisor path and the doorbell; the hand-driven path stays documented as the
# fallback"), plus (plan Task 23) the runner README's own "Supervisor" section and its flags-
# parity wall against the real `supervise` parser.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$HERE/../../skills/orchestrate-campaign/SKILL.md"
RUNNER="$HERE/../runner"
RUNNER_README="$RUNNER/README.md"
SUPERVISOR_ARGS_TS="$RUNNER/core/supervisor/args.ts"
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

# --- Wall 4: the runner README's own "Supervisor" section exists and carries every piece the
# Watchdog section's own template does (plan Task 23's oracle: purpose paragraph, invocation,
# flags table w/ defaults, exit-codes table, files list, decision table, "What it never does",
# Known limitations). Every check below is scoped to THIS section alone (never `grep`ed against
# the whole README) so it cannot pass on a string that only exists in the pre-existing Watchdog
# section — a real red-for-the-right-reason wall, not a shared-string false positive. -----------
if ! grep -q '^## Supervisor' "$RUNNER_README"; then
  bad "the Supervisor section exists"
  SUPERVISOR_SECTION=""
else
  ok "the Supervisor section exists"
  SUPERVISOR_SECTION="$(sed -n '/^## Supervisor /,/^## Structure/p' "$RUNNER_README")"
fi

gate_section() {
  if printf '%s' "$SUPERVISOR_SECTION" | grep -q "$2"; then ok "$1"; else bad "$1"; fi
}

gate_section "the supervise invocation is documented"        'bun plugins/tribe/scripts/runner/run\.ts supervise'
gate_section "a supervisor exit-codes table exists"          'SUPERVISOR_EXIT_NEEDS_OWNER'
gate_section "the supervisor decision table exists"          'A live foreign supervisor'
gate_section "a supervisor files list exists"                '\.supervisor\.lock'
gate_section 'a supervisor "What it never does" list exists' 'What it never does'
gate_section "the FU-CS-1 autoAnswerRounds limitation is documented"     'autoAnswerRounds.*FU-CS-1'
gate_section "the FU-CS-2 no-badge-chip limitation is documented"        'FU-CS-2'
gate_section "the watchdog-style crash-recovery limitation is documented" 'crash of the supervisor itself'

# --- Wall 5: flags parity — every flag the Supervisor table names is accepted by the `supervise`
# parser, and every flag the parser accepts appears in the table (plan Task 23 Step 1's own loop,
# scoped to the Supervisor section alone so the runner's/watchdog's own flag tables elsewhere in
# this same README never leak into this wall). ------------------------------------------------
readme_flags="$(printf '%s\n' "$SUPERVISOR_SECTION" | grep -oE '^\| `--[a-z-]+`' | tr -d '|` ' | sort -u)"

if [[ -z "$readme_flags" ]]; then
  bad "the Supervisor section's flags table lists at least one flag"
else
  for f in $readme_flags; do
    out="$(bun "$RUNNER/run.ts" supervise "$f" 2>&1 || true)"
    if printf '%s' "$out" | grep -q "unknown flag"; then
      bad "README documents a nonexistent supervise flag: $f"
    else
      ok "supervise accepts documented flag $f"
    fi
  done
fi

parser_flags="$(grep -oE "'--[a-z-]+'" "$SUPERVISOR_ARGS_TS" | tr -d "'" | sort -u)"
for f in $parser_flags; do
  if printf '%s\n' "$readme_flags" | grep -qx -- "$f"; then
    ok "parser flag $f is documented in the Supervisor table"
  else
    bad "supervise accepts $f but the Supervisor table omits it"
  fi
done

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
