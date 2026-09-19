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

# --- G5: the closing session looks for gap-gate results in the wrong place (spec §6) -----------
# RW1 (coordinator ruling): calling `readGapGateOpenIds` directly would reproduce nothing — the
# defect is its CALLER's choice of which home to pass it (`buildOneShotPrompt`,
# `core/supervisor/loop.ts`: `io.resolveTribeHome(config.repoRoot)`, the BASE home, instead of
# `homeDir`, the campaign home already in hand). `buildOneShotPrompt` is now exported as a test
# seam (see its own doc comment in loop.ts) for exactly this reason, and this reproduction MUST
# flip red -> green precisely at Task 11's fix to that one line.
GAP_GATE="$HERE/../gaps/gap-gate.ts"
G5_HOME="$(new_campaign g5-gate generic-ruling-needed 0)"
mkdir -p "$G5_HOME/reports"
# The real `HG-candidate N [category]` header shape gap-candidates.ts's HEADER_RE requires
# (fixtures-mirror-reality: a plain bullet list does not parse and proves nothing). Reproduction
# honesty (spec §6's own note): the plan's literal Evidence line ("Evidence: 2 hits in ...", no
# backticked command) was verified BY RUNNING it through the real gate below — it parses into a
# candidate but the candidate's FINGERPRINT ("2 hits in ...") is not a `grep` invocation, so
# `validateFingerprint` flags and withholds it, and `open_ids` comes back EMPTY, proving nothing
# (confirmed by direct measurement before writing this fixture — fixtures-mirror-reality.md: "fix
# the fixture, never the assertion"). The Evidence field below instead carries the real backticked
# grep command shape A requires, so the candidate validates and mints a real open id.
cat > "$G5_HOME/reports/tracker-c1-final.md" <<'MD'
### Harness gaps

HG-candidate 1 [error-handling]
Pattern: `grep -rln "REPRO_G5_SENTINEL" plugins/tribe/scripts/runner`
Evidence: `grep -rln "REPRO_G5_SENTINEL" plugins/tribe/scripts/runner` -> 2 hits
MD
G5_BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"
set +e
gate_out="$(bun "$GAP_GATE" --repo "$REPO" --home "$G5_HOME" --card c1 --base "$G5_BASE_SHA" 2>&1)"
gate_rc=$?
set -e
G5_GATE_JSON="$G5_HOME/reports/c1-gap-gate.json"
has_ids="$(python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(1 if len(d.get('open_ids', [])) > 0 else 0)
except Exception:
    print(0)
" "$G5_GATE_JSON" 2>/dev/null || echo 0)"
check "G5: the gate recorded at least one open id" "$has_ids" "1"
g5_open_id="$(python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    ids = d.get('open_ids', [])
    print(ids[0] if ids else '')
except Exception:
    print('')
" "$G5_GATE_JSON" 2>/dev/null || echo '')"

# Render the REAL closing brief: the REAL production io adapter (`buildSupervisorIo`, the same
# one `cli/main.ts`'s `supervise` composition root constructs), the REAL exported
# `buildOneShotPrompt`, over the campaign home the gate just wrote into for real — never a
# re-implementation of the reader logic.
export G5_HOME_ENV="$G5_HOME"
export G5_REPO_ENV="$REPO"
set +e
brief_out="$(cd "$RUNNER" && bun -e '
import { join } from "node:path";
import { buildSupervisorIo } from "./adapters/supervisor-io.adapter.ts";
import { buildOneShotPrompt } from "./core/supervisor/loop.ts";

const homeDir = process.env.G5_HOME_ENV;
const repoRoot = process.env.G5_REPO_ENV;
const io = buildSupervisorIo(homeDir);
// Only `config.repoRoot` is read by the closing branch (`io.resolveTribeHome(config.repoRoot)`)
// — every other SupervisorLoopConfig field is untouched by that branch, so this minimal object
// is faithful, not a shortcut.
const config = { repoRoot: repoRoot };
// `SupervisorPaths` is a private type in loop.ts; only `.campaignReport`/`.finalReport` are read
// by the closing branch, built the SAME way `supervisorPathsOf` builds them in production.
const paths = {
  campaignReport: join(homeDir, "campaign-report.json"),
  finalReport: join(homeDir, "supervisor", "final-report.md"),
};
// Only the `cards` keys are consulted by the closing branch (it iterates card ids to look up
// each one'\''s gap-gate result) — the rest of `CampaignReportFacts` is irrelevant here.
const observation = { report: { cards: { c1: {} } } };
const action = { session: "closing", cardId: null };
const prompt = await buildOneShotPrompt(io, config, homeDir, paths, observation, action, "");
console.log(prompt);
' 2>&1)"
brief_rc=$?
set -e
if [[ "$brief_rc" != "0" ]]; then
  printf 'G5: buildOneShotPrompt invocation failed (rc=%s):\n%s\n' "$brief_rc" "$brief_out"
fi
contains "G5: the closing brief lists the gate's own open ids" "$brief_out" "$g5_open_id"

# --- G2: the ratchet does not ratchet (spec §3) --------------------------------------------
# `reviseCeiling` (core/metrics/ceiling.ts) is a correct, already-unit-tested pure predicate with
# NO CALLER outside its own test — there is no edge anywhere that compares a proposed ratchet
# file against its prior (merge-base) version, so "raising" is not a concept any gate can
# observe today. `plugins/tribe/scripts/ratchet-check.ts` (the thin edge Task 7 builds) does not
# exist yet; this reproduces "the gate is absent" by invoking it directly — never
# re-implementing `checkRatchetRevision`/`reviseCeiling` in this script, which would only prove
# the pure function works (already covered) and miss the actual defect (no caller).
G2_FIX="$TMP/g2-ratchet-repo"
mkdir -p "$G2_FIX"
git init -q -b master "$G2_FIX"
# Mirrors the real committed file's shape verbatim
# (docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json).
cat > "$G2_FIX/ratchet.json" <<'JSON'
{
  "v": 1,
  "ceilings": { "ruling": 27534, "ratify": 0, "closing": 93443, "doorbell": 0 }
}
JSON
git -C "$G2_FIX" -c user.email=t@t.test -c user.name=t add ratchet.json
git -C "$G2_FIX" -c user.email=t@t.test -c user.name=t commit -q -m "base: ruling ceiling 27534"
G2_BASE_SHA="$(git -C "$G2_FIX" rev-parse HEAD)"
RATCHET_CHECK="$REPO_ROOT/plugins/tribe/scripts/ratchet-check.ts"

# Case 1: an unjustified raise (999999, no raisedBy anywhere) — committed, mirroring the plan's
# literal wording ("commit a second version raising it…"), even though the edge only reads the
# WORKING TREE for the head version (spec §3's thin-edge description: "reading the working-tree
# version") — a real PR branch would carry this as a commit, so committing it here is the
# faithful shape.
cat > "$G2_FIX/ratchet.json" <<'JSON'
{
  "v": 1,
  "ceilings": { "ruling": 999999, "ratify": 0, "closing": 93443, "doorbell": 0 }
}
JSON
git -C "$G2_FIX" -c user.email=t@t.test -c user.name=t commit -q -am "raise ruling ceiling to 999999, no raisedBy"

set +e
g2_case1_out="$(bun "$RATCHET_CHECK" --repo "$G2_FIX" --base "$G2_BASE_SHA" --path ratchet.json 2>&1)"
g2_case1_rc=$?
set -e
# Verified by direct measurement before writing this assertion: `bun` itself exits 1 with
# "error: Module not found …" when `ratchet-check.ts` is absent (today's real state) — the SAME
# code case 1 expects from a genuine refusal. A bare `check ... "1"` would spuriously PASS today
# for the wrong reason (the script is missing, not "the raise was refused") — exactly the
# collision Task 2's resolver check hit. Exclude it explicitly so this assertion fails for the
# real reason until Task 7 lands the gate.
if [[ "$g2_case1_rc" == "1" && "$g2_case1_out" != *"Module not found"* ]]; then
  ok "G2: an unjustified raise is refused"
else
  bad "G2: an unjustified raise is refused (rc: $g2_case1_rc, out: $g2_case1_out)"
fi

# Case 2: the SAME raise, but with raisedBy.ruling set — no collision risk (module-not-found is
# rc 1, this case wants rc 0), so a plain `check` is the correct, sufficient oracle. The edge
# reads the WORKING TREE for the head version, so overwriting the file (no new commit) is the
# real shape it compares.
cat > "$G2_FIX/ratchet.json" <<'JSON'
{
  "v": 1,
  "ceilings": { "ruling": 999999, "ratify": 0, "closing": 93443, "doorbell": 0 },
  "raisedBy": { "ruling": "R7-2026-09-20-context-headroom" }
}
JSON
set +e
g2_case2_out="$(bun "$RATCHET_CHECK" --repo "$G2_FIX" --base "$G2_BASE_SHA" --path ratchet.json 2>&1)"
g2_case2_rc=$?
set -e
check "G2: the same raise WITH raisedBy.ruling set is allowed" "$g2_case2_rc" "0"

# Case 3: a lowering — also no collision risk.
cat > "$G2_FIX/ratchet.json" <<'JSON'
{
  "v": 1,
  "ceilings": { "ruling": 20000, "ratify": 0, "closing": 93443, "doorbell": 0 }
}
JSON
set +e
g2_case3_out="$(bun "$RATCHET_CHECK" --repo "$G2_FIX" --base "$G2_BASE_SHA" --path ratchet.json 2>&1)"
g2_case3_rc=$?
set -e
check "G2: a lowering is allowed" "$g2_case3_rc" "0"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
