#!/usr/bin/env bash
# test-supervisor-park-truth.sh — card `supervisor-park-truth`, Task 3: the committed E2E
# reproduction of G2, G5 and G3, plus the mandatory negative probe.
#
# ORACLE (the card's, verbatim): "Parking when the disk says the park is false = bug. Refusing to
# resume while a park is still TRUE = by design." BOTH directions are pinned below. Probes G2, G5
# and G3 prove the supervisor stops parking against a disk that contradicts the watchdog's
# terminal; the NEGATIVE probe proves that a park which IS still true is still obeyed. A suite
# carrying only the first three probes would be satisfied by a supervisor that simply never parks
# — which is the opposite bug, and just as wrong.
#
# Every probe drives the REAL `run.ts supervise` composition root against a campaign home
# assembled from a bare `mktemp -d`, seeded with the RECORDED 2026-09-19 supervisor-hardening
# shape (spec §1.2): a watchdog terminal `stalled` naming run A while a NEWER run B carried the
# campaign. No live model and no network: card c1 is pre-marked `shipped` and the watchdog
# terminal is pre-seeded, so the supervisor reaches its park/refuse decision without spawning a
# session (`fixtures-mirror-reality.md` rule 2 — the home is built from nothing, every time).
#
# Environment facts this file is built around (spec §1.3, all measured):
#   - There is NO `timeout(1)` on this machine and no shell suite in this repo uses one. Every
#     subprocess here is bounded by running it in the background, polling `kill -0`, and killing
#     on expiry (`run_supervise`). Never introduce a `timeout`/`gtimeout` dependency.
#   - `supervise` fails closed on a `--home` outside the tribe root, so every campaign home lives
#     under `$(tribe-home.sh "$REPO")/campaigns/<slug>`, exactly as `test-supervisor-e2e.sh` does.
#     That refusal is correct behaviour and is never weakened here.
#   - macOS's `mktemp -d` returns a symlinked path; it is resolved with `pwd -P` immediately,
#     because the supervisor realpaths `--home` before comparing it to the tribe root.
#   - `--session-timeout-seconds` is validated to the range 60..21600.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
TMP="$(mktemp -d)"; TMP="$(cd "$TMP" && pwd -P)"
KIDS=()
cleanup() {
  for p in "${KIDS[@]:-}"; do kill -9 "$p" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check()   { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi }
present() { if [[ -e "$2" ]]; then ok "$1"; else bad "$1 (missing: $2)"; fi }
absent()  { if [[ ! -e "$2" ]]; then ok "$1"; else bad "$1 (unexpectedly present: $2)"; fi }
has()     { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (want substring: $3, got: $2)"; fi }
hasnt()   { if [[ "$2" != *"$3"* ]]; then ok "$1"; else bad "$1 (unwanted substring: $3, got: $2)"; fi }
section() { printf '\n========== %s ==========\n' "$1"; }

# Host git config neutralised for every git call this suite (and the supervisor it spawns) makes
# — `fail-closed-edges.md` obligation 2: an unusual-but-legal host setting must never change a
# verdict here.
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null

# A throwaway machine: its own HOME, so the supervisor's containment root is this temp tree and
# nothing here can reach the real `~/.tribe`.
export HOME="$TMP/home"; mkdir -p "$HOME"

# A throwaway target repo — real `git`, never a network remote (card c1 is pre-marked `shipped`,
# so no card work and no `gh` is ever attempted against it).
REPO="$TMP/repo"; git init -q -b master "$REPO"
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

# `tribe-home.sh` is the ONE source of truth for `$(tribe-home) -> campaigns/<slug>`; run it for
# real rather than hand-deriving the key, so the homes below are the ones `supervise` accepts.
TRIBE_HOME="$(bash "$RUNNER/../tribe-home.sh" "$REPO")"
CAMPAIGNS="$TRIBE_HOME/campaigns"
mkdir -p "$CAMPAIGNS"

RUN_A="2026-09-19T19-29-58-328Z-dcb2"   # the run the watchdog's stall is ABOUT (recorded id)
RUN_B="2026-09-19T20-30-30-069Z-6185"   # the NEWER run that really carried the campaign

# `new_campaign <slug>` — assembles a campaign home from NOTHING, in the state the recorded
# incident was in at the moment the watchdog published its terminal: run A started and never
# finalised, a watchdog terminal `stalled` about run A's log, and NO run B yet. Sets the global
# `CAMPAIGN_HOME` rather than echoing its path: `add_run_b alive` below starts a background
# process, and a `$(...)` substitution would block until that process released the pipe.
new_campaign() {
  local slug="$1"
  local home="$CAMPAIGNS/$slug"
  mkdir -p "$home/escalations" "$home/watchdog" "$home/runs/$RUN_A/logs"
  cat > "$home/campaign-state.json" <<JSON
{"v":1,"campaign":"$slug","mergePolicy":"regular-merge-only","sequence":["c1"],
 "schemaLockPaths":[],"docsOnlyPaths":[],"ownerOnlyEscalations":[],
 "cards":{"c1":{"status":"shipped","spec":"docs/s.md","plan":"docs/p.md","branch":null,
   "baseSha":null,"pr":1,"mergeSha":"deadbeef","sessionId":null,"updatedAt":null}}}
JSON
  : > "$home/answers.md"
  : > "$home/runs/$RUN_A/logs/session.log"
  # Run A: started, never finalised, its pid long gone (999999 is above macOS's pid ceiling, so
  # it can never be alive) — exactly the recorded shape.
  cat > "$home/runs/$RUN_A/run.json" <<JSON
{"v":1,"runId":"$RUN_A","pid":999999,"startedAt":"2026-09-19T19:29:58.328Z","repo":"$REPO",
 "endedAt":null,"exitCode":null,"reason":null}
JSON
  # The watchdog's terminal: `stalled`, about run A's log — the recorded 20:30:30Z shape. Its own
  # pid (999997) is dead, so the "adopt a live watchdog" row cannot fire and the decision under
  # test is reached.
  cat > "$home/watchdog/status.json" <<JSON
{"v":1,"pid":999997,"home":"$home","startedAt":"2026-09-19T16:29:58.210Z",
 "updatedAt":"2026-09-19T20:30:30.006Z","mode":"follow","runId":"$RUN_A","runnerPid":999999,
 "stall":{"logPath":"$home/runs/$RUN_A/logs/session.log","lastMtime":"2026-09-19T19:49:13.218Z"},
 "terminal":{"status":"needs_human","reason":"stalled","exitCode":10}}
JSON
  cat > "$home/campaign-report.json" <<JSON
{"run":{"reason":"escalations_pending","unratifiedRulings":[]},
 "cards":{"c1":{"outcome":"shipped","escalationFile":null,"question":null,"autoAnswerRounds":0}},
 "pending":[],"stats":{"shipped":1,"escalated":0,"blocked":0,"notReached":0}}
JSON
  CAMPAIGN_HOME="$home"
}

# `add_run_b <home> alive|finalised` — the fact that falsifies the watchdog's terminal, written
# to `runs/` and NOWHERE else. `watchdog/status.json` is deliberately left stale: that asymmetry
# IS the defect (spec §1.2 — three artifacts, three stories), and the fix must read `runs/` for
# itself rather than trust the terminal it was handed.
#   alive     : run B present, pid ALIVE, not finalised                  (G2, G3)
#   finalised : run B present, endedAt + exitCode 2 escalations_pending  (G5)
add_run_b() {
  local home="$1" mode="$2" b_pid b_end
  mkdir -p "$home/runs/$RUN_B/logs"
  if [[ "$mode" == "alive" ]]; then
    # A REAL live process, so `isProcessAlive` answers from the OS rather than from a fixture.
    # Its fds are redirected so it can never hold open a pipe this suite is reading.
    sleep 300 </dev/null >/dev/null 2>&1 &
    b_pid=$!
    KIDS[${#KIDS[@]}]="$b_pid"
    # Disowned so the shell does not print a job notice when `cleanup` kills it — that notice
    # lands AFTER this suite's own "N passed, N failed" summary line and reads like a failure.
    # The pid stays killable either way; `cleanup` still reaps it.
    disown "$b_pid" 2>/dev/null || true
    b_end='"endedAt":null,"exitCode":null,"reason":null'
  else
    b_pid=999998
    b_end='"endedAt":"2026-09-19T22:48:45.898Z","exitCode":2,"reason":"escalations_pending"'
  fi
  cat > "$home/runs/$RUN_B/run.json" <<JSON
{"v":1,"runId":"$RUN_B","pid":$b_pid,"startedAt":"2026-09-19T20:30:30.074Z","repo":"$REPO",$b_end}
JSON
}

SUPERVISE_ARGS=(--session-timeout-seconds 60 --session-max-turns 5 --poll-seconds 1)

# `run_supervise <home> [limit-seconds]` — runs the real composition root, bounded portably (see
# this file's header). Sets `RC` to the exit code, or to the literal `TIMEOUT` when the bound was
# spent; sets `OUT` to the combined output. `TIMEOUT` is asserted against explicitly by every
# probe, so a run that is merely killed by the bound can never be mistaken for a passing probe.
RC=""; OUT=""
run_supervise() {
  local home="$1" limit="${2:-120}" out="$TMP/supervise.$$.$RANDOM.out" pid waited=0 rc
  set +e
  bun "$RUNNER/run.ts" supervise --repo "$REPO" --model park-truth-model --home "$home" \
    "${SUPERVISE_ARGS[@]}" > "$out" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$limit" ]; then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      set -e
      OUT="$(cat "$out")"; RC="TIMEOUT"
      return 0
    fi
    sleep 1; waited=$((waited+1))
  done
  wait "$pid"; rc=$?
  set -e
  OUT="$(cat "$out")"; RC="$rc"
}

not_timeout() { if [[ "$RC" != "TIMEOUT" ]]; then ok "$1"; else bad "$1 (the suite's bound killed the run)"; fi }

# The supervisor's own decision trail, minus the `await_watchdog` heartbeat noise.
event_lines() { grep -v '"action":"await_watchdog"' "$1/supervisor/events.jsonl" 2>/dev/null || true; }
event_count() { event_lines "$1" | grep -c . | tr -d ' '; }
# Only the decisions a LATER invocation appended, so a restart probe can never read run 1's trail.
events_after() { event_lines "$1" | tail -n "+$(( $2 + 1 ))"; }
# `supervisor/status.json`'s terminal, compact JSON, `null` when unreadable.
terminal_of() {
  python3 -c 'import json,sys
print(json.dumps(json.load(open(sys.argv[1])).get("terminal"), separators=(",",":")))' \
    "$1/supervisor/status.json" 2>/dev/null || printf 'null'
}
superseded_count() {
  find "$1" -maxdepth 1 -name 'NEEDS_OWNER.md.superseded-*' | grep -c . | tr -d ' '
}

# --- Probe G2: a terminal `stalled` about run A while a NEWER run B is ALIVE -----------------
# The disk says the park is false, so parking is a bug (Oracle, direction 1).
section "G2 — terminal 'stalled' about run A while a NEWER run B is ALIVE"
new_campaign g2; H_G2="$CAMPAIGN_HOME"
add_run_b "$H_G2" alive
run_supervise "$H_G2"
printf 'exit: %s\n' "$RC"
printf -- '--- supervisor/events.jsonl ---\n%s\n' "$(event_lines "$H_G2")"
printf -- '--- supervisor/status.json terminal ---\n%s\n' "$(terminal_of "$H_G2")"
not_timeout "G2: the supervise run finished on its own, inside the suite's bound"
absent "G2: the supervisor did not write NEEDS_OWNER.md" "$H_G2/NEEDS_OWNER.md"
hasnt "G2: no park with reason stalled was recorded" "$(event_lines "$H_G2")" '"reason":"stalled"'
hasnt "G2: the supervisor's own terminal is not a stalled park" "$(terminal_of "$H_G2")" '"reason":"stalled"'

# --- Probe G5: run B finalised (exit 2, escalations_pending) while nobody watched ------------
# The run's own record carries the truth; the decision must follow THAT reason, never the stale
# terminal. Pinned here as "the supervisor does not park `stalled`" — which row the run's real
# reason then routes into is the decision table's business, and asserting a specific downstream
# row would couple this E2E to internals it cannot see.
section "G5 — run B finalised (exit 2 / escalations_pending) while nobody watched"
new_campaign g5; H_G5="$CAMPAIGN_HOME"
add_run_b "$H_G5" finalised
run_supervise "$H_G5"
printf 'exit: %s\n' "$RC"
printf -- '--- supervisor/events.jsonl ---\n%s\n' "$(event_lines "$H_G5")"
printf -- '--- supervisor/status.json terminal ---\n%s\n' "$(terminal_of "$H_G5")"
not_timeout "G5: the supervise run finished on its own, inside the suite's bound"
hasnt "G5: no park with reason stalled was recorded" "$(event_lines "$H_G5")" '"reason":"stalled"'
hasnt "G5: the supervisor's own terminal is not a stalled park" "$(terminal_of "$H_G5")" '"reason":"stalled"'

# --- Probe G3: a restart whose park the disk has already falsified ---------------------------
# The recorded sequence exactly: the supervisor parks while the park is TRUE (run 1 — no run B
# exists yet), then the world moves on (run B starts and is alive), then the supervisor is
# restarted. The park document on disk now describes a condition that no longer holds.
section "G3 — restart with NEEDS_OWNER.md present and the park no longer true"
new_campaign g3; H_G3="$CAMPAIGN_HOME"
run_supervise "$H_G3"
printf 'run 1 exit: %s\n' "$RC"
not_timeout "G3: run 1 finished on its own, inside the suite's bound"
present "G3: run 1 parked, writing NEEDS_OWNER.md (the probe's precondition)" "$H_G3/NEEDS_OWNER.md"
before_g3="$(event_count "$H_G3")"
add_run_b "$H_G3" alive   # the park's stated condition is now false on disk
run_supervise "$H_G3"
printf 'run 2 exit: %s\n' "$RC"
printf -- '--- events appended by run 2 ---\n%s\n' "$(events_after "$H_G3" "$before_g3")"
printf -- '--- superseded markers ---\n%s\n' "$(find "$H_G3" -maxdepth 1 -name 'NEEDS_OWNER.md.superseded-*' -print)"
not_timeout "G3: run 2 finished on its own, inside the suite's bound"
has "G3: run 2 appended a park_superseded event" "$(events_after "$H_G3" "$before_g3")" 'park_superseded'
absent "G3: NEEDS_OWNER.md no longer blocks the campaign" "$H_G3/NEEDS_OWNER.md"
check "G3: exactly one NEEDS_OWNER.md.superseded-* marker (renamed, never deleted)" \
  "$(superseded_count "$H_G3")" "1"

# --- Negative probe: a park that IS still true is still obeyed -------------------------------
# Oracle, direction 2, BY DESIGN: refusing to resume while the park still holds is correct. No
# run B is ever added here, so nothing on disk contradicts the terminal the park was written
# from. This probe is GREEN today and must STAY green: it is what stops the G2/G5/G3 fixes from
# being "satisfied" by a supervisor that stopped parking altogether.
section "NEGATIVE — a park that is STILL TRUE (no newer run at all) must still refuse"
new_campaign neg; H_NEG="$CAMPAIGN_HOME"
run_supervise "$H_NEG"
printf 'run 1 exit: %s\n' "$RC"
not_timeout "negative: run 1 finished on its own, inside the suite's bound"
check "negative: run 1 parks — the terminal is uncontradicted, so exit 20 is correct" "$RC" "20"
present "negative: run 1 wrote NEEDS_OWNER.md (the probe's precondition)" "$H_NEG/NEEDS_OWNER.md"
before_neg="$(event_count "$H_NEG")"
run_supervise "$H_NEG"   # restart, with the world UNCHANGED: the park still holds
printf 'run 2 exit: %s\n' "$RC"
printf -- '--- events appended by run 2 ---\n%s\n' "$(events_after "$H_NEG" "$before_neg")"
not_timeout "negative: run 2 finished on its own, inside the suite's bound"
check "negative: run 2 refuses to resume — exit 20" "$RC" "20"
has "negative: run 2 recorded a resume_blocked park" "$(events_after "$H_NEG" "$before_neg")" '"reason":"resume_blocked"'
present "negative: NEEDS_OWNER.md is left exactly where the owner must find it" "$H_NEG/NEEDS_OWNER.md"
check "negative: nothing was superseded — the park still holds" "$(superseded_count "$H_NEG")" "0"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
