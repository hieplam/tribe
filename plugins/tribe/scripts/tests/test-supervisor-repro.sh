#!/usr/bin/env bash
# test-supervisor-repro.sh — card `supervisor-hardening`, Task 1 (plan
# docs/superpowers/plans/2026-09-19-supervisor-hardening.md). The permanent, gated reproduction
# suite for this card's five defects (G1-G5): each defect gets a real E2E reproduction against a
# bare `mktemp` campaign home, run BEFORE its fix lands, per the owner's rule (quoted in the
# spec, `~/.claude/CLAUDE.md`): "Bug fixes start by reproducing the bug in an E2E setting as
# closely aligned with how an end user would experience it as possible."
#
# Modeled on test-supervisor-e2e.sh: same ok/bad/check/contains helpers, same `mktemp -d` +
# `pwd -P` symlink resolution, same `trap` cleanup, same `new_campaign` fixture-builder shape,
# same tally line. The session double (`TRIBE_SUPERVISOR_SESSION_DOUBLE`,
# `runner/fixtures/supervisor/session-double.sh`) stands in for the real Claude Agent SDK
# one-shot, exactly as it does there.
#
# Gated behind TRIBE_REPRO=1 (spec §2, plan Task 1) — unlike test-supervisor-e2e.sh, some of
# this suite's assertions are DESIGNED to fail until their matching fix task lands (plan's
# adjudication rule: "`test-supervisor-repro.sh` fails. It is gated behind TRIBE_REPRO=1 and is
# *meant* to fail until its matching fix lands. Only an ungated failure is a finding."). Gating
# it means every ordinary commit on this branch stays green while the reproductions remain live
# and runnable on demand — the same precedent test-supervisor-real-e2e.sh and
# test-supervisor-permission-real.sh already established for TRIBE_REAL_E2E=1.
if [[ "${TRIBE_REPRO:-}" != "1" ]]; then
  echo "skipped test-supervisor-repro.sh — set TRIBE_REPRO=1 to run the supervisor-hardening card's defect reproductions"
  exit 0
fi

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
DOUBLE="$RUNNER/fixtures/supervisor/session-double.sh"
# test-supervisor-real-e2e.sh's own precedent for deriving the repo root from this same HERE.
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"
SKILL_DIR="$REPO_ROOT/plugins/verify-shipped/skills/verify-shipped"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# W-P10 (test-supervisor-e2e.sh's own precedent): resolve TMP's own symlinks NOW — macOS's
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
ok_if_file() { if [[ -f "$2" ]]; then ok "$1"; else bad "$1 (missing: $2)"; fi }

# A throwaway machine: its own HOME, so the supervisor's `--home`/`--campaign` containment root
# is this temp tree and nothing here can ever touch the real `~/.tribe`.
export HOME="$TMP/home"; mkdir -p "$HOME"

# A throwaway target repo — real `git`, never a network remote (card c1 is pre-marked `shipped`
# below, so no card work, no `gh`, is ever attempted against it).
REPO="$TMP/repo"; git init -q -b master "$REPO"
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

# `tribe-home.sh` is the ONE source of truth for `$(tribe-home) -> campaigns/<slug>` — run it for
# real, exactly as test-supervisor-e2e.sh does, rather than hand-deriving the `<key>` string.
TRIBE_HOME="$(bash "$RUNNER/../tribe-home.sh" "$REPO")"
CAMPAIGNS="$TRIBE_HOME/campaigns"

# `new_campaign <slug> <reason> [owner-only:0|1] [context]` — assembles a campaign home from
# NOTHING (fixtures-mirror-reality rule 2): card c1 pre-marked `shipped`, a pre-seeded
# `<home>/watchdog/status.json` carrying a terminal `escalations_pending` (so the tick machinery
# goes straight to the ruling/park decision instead of first spawning a real watchdog run to
# discover it), and a matching `campaign-report.json` + `escalations/c1.md` whose `## Context`
# body is the caller-supplied `context` (defaulting to a generic line) — this is how each G-case
# below plants its own distinctive marker inside the escalation file the fix must surface.
# Echoes the home's absolute path.
new_campaign() {
  local slug="$1" reason="$2" owner_only="${3:-0}" context="${4:-The session double needs to make a call here.}"
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
$context
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

# --- G1: a card-scoped park never shows the owner the question (spec §2) --------------------
# The escalation's own `## Context` carries a distinctive marker; a park caused by that same
# card's owner-only escalation must show the owner that exact marker in NEEDS_OWNER.md. Today
# `loop.ts`'s `park` branch passes the literal `question: null`, so this assertion fails — that
# is the intended red (spec §2's root-cause section, `loop.ts:962`).
MARKER="CONTEXT-MARKER-4f2a9b"
G1_HOME="$(new_campaign g1-owner-only needs-a-product-call 1 \
  "$MARKER — the owner must see THIS paragraph to rule on the question.")"
export DOUBLE_PLAN="rule:R1 close" # scripted to succeed if ever invoked — an owner-only park must never invoke it
export DOUBLE_STATE="$TMP/double-state-g1"
set +e
out_g1="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model repro-model --home "$G1_HOME" "${SUPERVISE_ARGS[@]}" 2>&1)"
rc_g1=$?
set -e
check "G1: an owner-only escalation parks" "$rc_g1" "20"
contains "G1: NEEDS_OWNER.md carries the escalation's own Context text" "$(cat "$G1_HOME/NEEDS_OWNER.md" 2>/dev/null)" "$MARKER"

# --- G3: the closing verdict is the model's prose, and nothing checks the script ran (spec §4) -
# A campaign driven to a closing session with the double: attempt 1 lands ruling R1, attempt 2
# writes `supervisor/final-report.md` and NOTHING else (the double's own `close` spec — see this
# file's doc comment / session-double.sh). Today `verifyClosing` accepts any non-empty report, so
# the campaign closes (`supervise` exits 0) with no verdict file ever written, no check that
# `verify-shipped.sh` ran, and no check its own path even resolves under a plugin load — three
# independent unchecked links, per spec §4's root-cause section.
G3_HOME="$(new_campaign g3-closing generic-ruling-needed 0)"
export DOUBLE_PLAN="rule:R1 close"
export DOUBLE_STATE="$TMP/double-state-g3"
set +e
out_g3="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --model repro-model --home "$G3_HOME" "${SUPERVISE_ARGS[@]}" 2>&1)"
rc_g3=$?
set -e
check "G3: a closing session that wrote no verdict file does not close the campaign" "$rc_g3" "20"
ok_if_file "G3: verify-shipped.sh writes a verdict file per shipped card" "$G3_HOME/supervisor/verdicts/c1.json"

# FU-CS-4, same reproduction (spec §4d): the resolver `verify-shipped.sh`'s own `SKILL.md`
# documents does not exist yet, so resolving it must fail today. A bare substring match on
# "verify-shipped.sh" is not a safe oracle here — bash's own "No such file or directory" error
# for the MISSING resolver script `resolve-verify-shipped.sh` itself contains that exact
# substring (it is the resolver's own filename's suffix), which would make this assertion pass
# today for the wrong reason. Gate the substring check on the resolver actually having
# succeeded (rc 0), so a missing resolver — the real defect — is what fails this assertion.
set +e
resolve_out="$(bash "$SKILL_DIR/resolve-verify-shipped.sh" 2>&1)"
resolve_rc=$?
set -e
if [[ "$resolve_rc" == "0" && "$resolve_out" == *"verify-shipped.sh"* ]]; then
  ok "G3: the SKILL.md command resolves under a plugin load"
else
  bad "G3: the SKILL.md command resolves under a plugin load (rc: $resolve_rc, out: $resolve_out)"
fi

# The pure postcondition itself, called directly against the real module (spec §4's own
# reproduction line, and this task's brief) — proving `verifyClosing` is blind to a BLOCKED
# report with no shipped verdicts today. `shippedVerdicts` is not yet a known input, so it is
# silently ignored by the current implementation; this call exits 1 (spec-defined failure) when
# the postcondition wrongly returns `closed`, and will exit 0 once Task 10 widens it.
set +e
g3_verifyclosing_out="$(cd "$RUNNER" && bun -e 'import { verifyClosing } from "./core/supervisor/verify.ts";
  const v = verifyClosing({ finalReport: "Status: BLOCKED\n", answers: "", shippedVerdicts: [] });
  if (v.outcome === "closed") { console.error("G3: a BLOCKED report still closes"); process.exit(1); }' 2>&1)"
g3_verifyclosing_rc=$?
set -e
check "G3: verifyClosing does not close a campaign whose report says BLOCKED with no shipped verdicts" \
  "$g3_verifyclosing_rc" "0"
[[ -n "$g3_verifyclosing_out" ]] && echo "$g3_verifyclosing_out"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
