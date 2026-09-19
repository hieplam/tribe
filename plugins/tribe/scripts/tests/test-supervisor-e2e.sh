#!/usr/bin/env bash
# test-supervisor-e2e.sh — Task 17 (card `campaign-supervisor`): the session-double E2E, from an
# EMPTY home, both invocation shapes. Runs the REAL `supervise` composition root against a
# throwaway campaign home built from nothing, with the SDK's own `spawnSession` swapped for a
# REAL scripted subprocess (`runner/fixtures/supervisor/session-double.sh`) via the
# `TRIBE_SUPERVISOR_SESSION_DOUBLE` env seam (`adapters/session-double.adapter.ts`,
# `cli/main.ts`'s `supervise` composition root). No TypeScript mock anywhere in this file — the
# unit tests (`core/supervisor/loop.test.ts`'s `fakeSeam`) already prove the decision plumbing
# in-process; this test's whole value is the REAL disk/process boundary the fake cannot reach
# (Oracle, this task's brief; `fixtures-mirror-reality.md`).
#
# fixtures-mirror-reality rule 1: the campaign is exercised BOTH ways a person invokes it — an
# absolute `--home` (probe 1) and `--campaign <slug>` from inside the campaigns directory,
# resolved the way `tribe-home.sh` really resolves it (probe 2) — reaching an IDENTICAL verdict.
# Rule 2: every campaign home below is assembled by `new_campaign`, from a bare `mktemp -d`
# tree, never a fixture this script happens to already have lying around.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
DOUBLE="$RUNNER/fixtures/supervisor/session-double.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# W-P10 (test-watchdog-e2e.sh's own precedent): resolve TMP's own symlinks NOW — macOS's
# `mktemp -d` hands back a path under `/var/folders/...` that is itself a symlink to
# `/private/var/folders/...`, and the supervisor's own containment gate realpaths `--home`
# before comparing it to the tribe root, so every path this script builds under `$TMP` must
# already be the resolved form or every string comparison against the supervisor's own
# printed/observed paths would spuriously fail on this OS.
TMP="$(cd "$TMP" && pwd -P)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check()    { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi }
contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (got: $2, want substring: $3)"; fi }
absent()   { if [[ ! -e "$2" ]]; then ok "$1"; else bad "$1 (unexpectedly present: $2)"; fi }

# A throwaway machine: its own HOME, so the supervisor's `--home`/`--campaign` containment root
# is this temp tree and nothing here can ever touch the real `~/.tribe`.
export HOME="$TMP/home"; mkdir -p "$HOME"

# A throwaway target repo — real `git`, never a network remote (card c1 is pre-marked `shipped`
# below, so no card work, no `gh`, is ever attempted against it; decision-4's own probe, #5,
# still needs a REAL repo for `git status --porcelain` to observe a real touch).
REPO="$TMP/repo"; git init -q -b master "$REPO"
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

# `tribe-home.sh` is the ONE source of truth for `$(tribe-home) -> campaigns/<slug>` (spec §10,
# ratified decision 2) — run it for real, rather than hand-deriving the `<key>` string, so probe
# 2's `--campaign` shape and probe 1's `--home` shape are guaranteed to name the SAME directory.
TRIBE_HOME="$(bash "$RUNNER/../tribe-home.sh" "$REPO")"
CAMPAIGNS="$TRIBE_HOME/campaigns"

# `new_campaign <slug> <escalation-reason> [owner-only:0|1]` — assembles a campaign home from
# NOTHING: card c1 pre-marked `shipped` (so the one REAL watchdog/runner re-verification pass
# every probe below triggers after a ruling lands finishes in well under a second — no `gh`, no
# session, no network), a pre-seeded `<home>/watchdog/status.json` carrying a terminal
# `escalations_pending` (so the tick machinery goes straight to the ruling/park decision instead
# of first spawning a real watchdog run to discover it), and a matching `campaign-report.json` +
# `escalations/c1.md`. Echoes the home's absolute path.
new_campaign() {
  local slug="$1" reason="$2" owner_only="${3:-0}"
  local home="$CAMPAIGNS/$slug"
  mkdir -p "$home/escalations" "$home/watchdog"
  local owner_list='[]'
  [[ "$owner_only" == "1" ]] && owner_list="[\"$reason\"]"
  cat > "$home/campaign-state.json" <<JSON
{
  "v": 1,
  "campaign": "$slug",
  "mergePolicy": "regular-merge-only",
  "sequence": ["c1"],
  "schemaLockPaths": [],
  "docsOnlyPaths": [],
  "ownerOnlyEscalations": $owner_list,
  "cards": {
    "c1": {
      "status": "shipped",
      "spec": "docs/never-authored-spec.md",
      "plan": "docs/never-authored-plan.md",
      "branch": null,
      "baseSha": null,
      "pr": 1,
      "mergeSha": "deadbeef",
      "sessionId": null,
      "updatedAt": null
    }
  }
}
JSON
  : > "$home/answers.md"
  cat > "$home/escalations/c1.md" <<MD
**Reason:** $reason

## Context
The session double needs to make a call here.
MD
  cat > "$home/watchdog/status.json" <<JSON
{"v":1,"pid":999999,"home":"$home","startedAt":"1970-01-01T00:00:00.000Z","updatedAt":"1970-01-01T00:00:00.000Z","mode":"follow","runnerPid":null,"terminal":{"status":"needs_human","reason":"escalations_pending","exitCode":2}}
JSON
  cat > "$home/campaign-report.json" <<JSON
{
  "run": {"reason": "escalations_pending", "unratifiedRulings": []},
  "cards": {"c1": {"outcome": "escalated", "escalationFile": "escalations/c1.md", "question": "$reason", "autoAnswerRounds": 0}},
  "pending": [],
  "stats": {"shipped": 0, "escalated": 1, "blocked": 0, "notReached": 0}
}
JSON
  printf '%s' "$home"
}

# Every real one-shot spawn below goes to the double (see this file's own doc comment).
export TRIBE_SUPERVISOR_SESSION_DOUBLE="$DOUBLE"
export DOUBLE_REPO="$REPO"

SUPERVISE_ARGS=(--session-timeout-seconds 60 --session-max-turns 5 --poll-seconds 1)

# --- Probe 1: absolute --home, a card that escalates, the double rules and ratifies it ------
H1="$(new_campaign e2e-abs generic-ruling-needed 0)"
export DOUBLE_PLAN="rule:R1 close"
export DOUBLE_STATE="$TMP/double-state-1"
# Sub-second precision (python3, mirroring this suite's own JSON-reading convention below):
# the whole probe1 run typically finishes in well under a second, so a whole-second `stat -f %m`
# mtime can spuriously tie with itself and never prove the file moved at all.
h1_answers_mtime_before="$(python3 -c 'import os,sys; print(os.path.getmtime(sys.argv[1]))' "$H1/answers.md")"
set +e
out1="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$H1" "${SUPERVISE_ARGS[@]}" 2>&1)"
rc1=$?
set -e
check "probe1: absolute --home exits 0" "$rc1" "0"
check "probe1: ledger has exactly one ruling line" \
  "$(grep -c '"kind":"ruling"' "$H1/supervisor/ledger.jsonl" 2>/dev/null || echo 0)" "1"
if [[ -f "$H1/escalations/c1.md.resolved-R1" ]]; then
  ok "probe1: the escalation file is archived to .resolved-R1"
else
  bad "probe1: the escalation file is archived to .resolved-R1"
fi
check "probe1: answers.md gained exactly one ## block" \
  "$(grep -c '^## ' "$H1/answers.md")" "1"
absent "probe1: NEEDS_OWNER.md does not exist" "$H1/NEEDS_OWNER.md"

# --- Probe 2: the SAME campaign shape, but --campaign the way a person types it -------------
H2="$(new_campaign e2e-rel generic-ruling-needed 0)"
export DOUBLE_PLAN="rule:R1 close"
export DOUBLE_STATE="$TMP/double-state-2"
set +e
out2="$(cd "$CAMPAIGNS" && bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model \
  --campaign e2e-rel "${SUPERVISE_ARGS[@]}" 2>&1)"
rc2=$?
set -e
check "probe2: --campaign exits 0, same as --home" "$rc2" "0"
contains "probe2: resolved to the SAME home tribe-home.sh derives" "$out2" "$H2/supervisor/status.json"
check "probe2: ledger has exactly one ruling line" \
  "$(grep -c '"kind":"ruling"' "$H2/supervisor/ledger.jsonl" 2>/dev/null || echo 0)" "1"
if [[ -f "$H2/escalations/c1.md.resolved-R1" ]]; then
  ok "probe2: the escalation file is archived, same as probe 1"
else
  bad "probe2: the escalation file is archived, same as probe 1"
fi
absent "probe2: NEEDS_OWNER.md does not exist, same as probe 1" "$H2/NEEDS_OWNER.md"

# --- Probe 3: an owner-only escalation parks WITHOUT ever invoking the double ----------------
H3="$(new_campaign e2e-owner needs-a-human-call 1)"
export DOUBLE_PLAN="rule:R1 close" # scripted to succeed if ever invoked — it must never be
export DOUBLE_STATE="$TMP/double-state-3"
set +e
out3="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$H3" "${SUPERVISE_ARGS[@]}" 2>&1)"
rc3=$?
set -e
check "probe3: an owner-only escalation exits 20" "$rc3" "20"
absent "probe3: the double's own counter file was never created — zero invocations" "$DOUBLE_STATE"
if [[ -f "$H3/NEEDS_OWNER.md" ]]; then
  ok "probe3: NEEDS_OWNER.md exists"
  contains "probe3: it names park reason owner_only" "$(cat "$H3/NEEDS_OWNER.md")" "**Park reason:** owner_only"
  # G1 oracle (card supervisor-hardening): the park document must carry THIS card's own question —
  # the `## Context` body of its escalation file — not a "(not applicable)" placeholder. The
  # new_campaign fixture writes this exact Context line into escalations/c1.md.
  contains "probe3: NEEDS_OWNER.md carries the escalation's own Context text" \
    "$(cat "$H3/NEEDS_OWNER.md")" "The session double needs to make a call here."
else
  bad "probe3: NEEDS_OWNER.md exists"
  bad "probe3: it names park reason owner_only"
  bad "probe3: NEEDS_OWNER.md carries the escalation's own Context text"
fi

# --- Probe 4: a double that writes NOTHING — one bounded retry, then park -------------------
H4="$(new_campaign e2e-none generic-ruling-needed 0)"
export DOUBLE_PLAN="none none"
export DOUBLE_STATE="$TMP/double-state-4"
set +e
out4="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$H4" "${SUPERVISE_ARGS[@]}" 2>&1)"
rc4=$?
set -e
check "probe4: a silent double exits 20" "$rc4" "20"
check "probe4: exactly one bounded retry — the counter reads 2" "$(cat "$DOUBLE_STATE")" "2"
if [[ -f "$H4/NEEDS_OWNER.md" ]]; then
  contains "probe4: park reason is ruling_failed" "$(cat "$H4/NEEDS_OWNER.md")" "**Park reason:** ruling_failed"
else
  bad "probe4: park reason is ruling_failed"
fi

# --- Probe 5: a double that writes a ruling AND touches the target repo — decision 4 --------
H5="$(new_campaign e2e-touch generic-ruling-needed 0)"
export DOUBLE_PLAN="rule-touch:R1 rule-touch:R2"
export DOUBLE_STATE="$TMP/double-state-5"
set +e
out5="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$H5" "${SUPERVISE_ARGS[@]}" 2>&1)"
rc5=$?
set -e
check "probe5: a repo-touching double exits 20" "$rc5" "20"
if [[ -f "$REPO/session-double-touch.txt" ]]; then
  ok "probe5: the double really did touch the target repo (decision 4's trigger is real)"
else
  bad "probe5: the double really did touch the target repo (decision 4's trigger is real)"
fi
if [[ -f "$H5/NEEDS_OWNER.md" ]]; then
  contains "probe5: rejected as a failed attempt — park reason is ruling_failed, not owner_only" \
    "$(cat "$H5/NEEDS_OWNER.md")" "**Park reason:** ruling_failed"
else
  bad "probe5: rejected as a failed attempt — park reason is ruling_failed, not owner_only"
fi
# Clean up probe 5's repo touch before probe 7 reuses the same $REPO.
rm -f "$REPO/session-double-touch.txt"

# --- Probe 6: the write surface, and answers.md's mtime moved ONLY via the double -----------
# Reuses probe 1's already-completed $H1 (S-P5's write surface + this task's mtime guardrail
# both describe the supervisor's OWN behavior across a whole run, not a single tick).
write_surface_ok=1
while IFS= read -r f; do
  case "$f" in
    "$H1"/supervisor/*|"$H1"/watchdog/*|"$H1"/runs/*|"$H1"/reports/*|"$H1"/escalations/*) ;;
    "$H1/NEEDS_OWNER.md"|"$H1/campaign-state.json"|"$H1/answers.md") ;;
    "$H1"/campaign-report.*) ;;
    *) write_surface_ok=0; printf 'unexpected path: %s\n' "$f" ;;
  esac
done < <(find "$H1" -type f)
check "probe6: every file under the home is supervisor/watchdog/runner-owned, or the original fixture" \
  "$write_surface_ok" "1"
h1_answers_mtime_after="$(python3 -c 'import os,sys; print(os.path.getmtime(sys.argv[1]))' "$H1/answers.md")"
if python3 -c 'import sys; sys.exit(0 if float(sys.argv[2]) > float(sys.argv[1]) else 1)' \
  "$h1_answers_mtime_before" "$h1_answers_mtime_after"; then
  ok "probe6: answers.md's mtime moved during the run"
else
  bad "probe6: answers.md's mtime moved during the run (before: $h1_answers_mtime_before, after: $h1_answers_mtime_after)"
fi
check "probe6: answers.md still carries exactly the one block the double wrote — nothing else touched it" \
  "$(grep -c '^## ' "$H1/answers.md")" "1"

# --- Probe 7: a second supervisor while the first holds the lock ----------------------------
H7="$(new_campaign e2e-lock generic-ruling-needed 0)"
export DOUBLE_PLAN="sleep:6"
export DOUBLE_STATE="$TMP/double-state-7"
bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$H7" "${SUPERVISE_ARGS[@]}" \
  > "$TMP/probe7-first.out" 2>&1 &
FIRST_PID=$!
sleep 2 # long enough for the first invocation to acquire the lock and reach the sleeping double
before7="$(find "$H7" -type f | sort)"
set +e
out7="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$H7" "${SUPERVISE_ARGS[@]}" 2>&1)"
rc7=$?
set -e
after7="$(find "$H7" -type f | sort)"
check "probe7: a second supervisor refuses with exit 21" "$rc7" "21"
check "probe7: the second invocation wrote nothing" "$after7" "$before7"
set +e
wait "$FIRST_PID"
set -e

# --- Probe 8: containment refusals are typed, no stack trace, exit 1 ------------------------
set +e
out8a="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$TMP/outside" 2>&1)"
rc8a=$?
set -e
check "probe8: a --home outside the tribe root exits 1" "$rc8a" "1"
contains "probe8: with a typed refusal naming the root" "$out8a" "is outside the tribe root"
case "$out8a" in
  *"at "*"("*.ts:*) bad "probe8: no stack trace for an outside-root --home" ;;
  *)                ok "probe8: no stack trace for an outside-root --home" ;;
esac

mkdir -p "$CAMPAIGNS/nostate"
set +e
out8b="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model e2e-model --home "$CAMPAIGNS/nostate" 2>&1)"
rc8b=$?
set -e
check "probe8: a --home with no campaign-state.json exits 1" "$rc8b" "1"
contains "probe8: with a typed refusal naming the missing file" "$out8b" "has no campaign-state.json"
case "$out8b" in
  *"at "*"("*.ts:*) bad "probe8: no stack trace for a stateless --home" ;;
  *)                ok "probe8: no stack trace for a stateless --home" ;;
esac

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
