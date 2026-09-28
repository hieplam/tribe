#!/usr/bin/env bash
# owner-run.sh — drives ONE real campaign run of the throwaway card `owner-run-probe` against the
# owner's real checkout, and collects four of card supervisor-sessions-in-repo's goals from it:
# G1 (every session's cwd is the repo), G5 (each session page shows its campaign badge), G7 (the
# owner's checkout is untouched) and G8 (the ledger IS the session tree). Spec §7, plan Task 16.
#
# THREE VERBS, not one script. The executor Warchief that drives this card is capped at 600 s per
# Bash call and may not background anything (runner/core/session.ts `decideBackgroundingHook`),
# while a real campaign run — an executor card, a PR, CI, a ruling, a ratify and a closing — lasts
# far longer. So: `start` returns at once, leaving `supervise` detached and re-parented away from
# the calling session; `wait` is a bounded foreground poll that always returns inside its budget;
# `collect` gathers the evidence. The caller re-invokes `wait` until it prints `terminal`.
#
#   owner-run.sh start   [--repo <path>] --evidence <dir> [--dry-run]
#   owner-run.sh wait    --evidence <dir> [--max-seconds N]
#   owner-run.sh collect --evidence <dir>
#
# This file is ALL edge (~/.claude/rules/fail-closed-edges.md): `set -uo pipefail` deliberately
# WITHOUT `-e`, because `collect` must print a row for EVERY goal — a value or a named refusal —
# even when one step fails. A verification tool that cannot report success is worse than no tool
# (this card already paid for that defect once: g4-guard-footprint.sh died with no output under
# `set -e` at exactly the state it existed to certify, because a legitimate zero-match grep
# exited 1). Same reason every `command grep` below tolerates finding nothing.
set -uo pipefail

DEFAULT_REPO=/Users/hiep/repo/tribe
DEFAULT_WAIT_SECONDS=540
WAIT_CEILING_SECONDS=540   # the caller's Bash call dies at 600 s; 540 leaves it room to print
POLL_SECONDS=10
VIEWER_PORT=4411
LLM_MODEL=claude-haiku-4-5-20251001
PROBE_PLAN=docs/superpowers/plans/2026-09-27-owner-run-probe.md
# Verbatim from plan Task 16 — the same text that measured the G8 baseline, so changing a byte of
# it would invalidate the before/after comparison.
G8_PROMPT="Below is the complete ledger.jsonl of one campaign, one JSON object per line. Using ONLY this file, list every session in the campaign and who spawned it. Output one line per session, exactly in the form 'EDGE <sessionId> <parentSessionId>' or 'ROOT <sessionId>' when it has no parent, and nothing else."

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPTS="$(cd "$HERE/../.." && pwd -P)"   # plugins/tribe/scripts
RUNNER="$SCRIPTS/runner"
VIEWER="$SCRIPTS/viewer"

die() { printf 'owner-run: %s\n' "$*" >&2; exit 2; }

# Every git call in this tool: the host's global/system git config can never change the verdict
# (fail-closed-edges obligation 2 — a global hooks path or `commit.gpgsign` must not decide G7).
git_() { GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git "$@"; }

# --- argv, fail-closed ------------------------------------------------------------------------
# An unknown verb, an unknown flag, a stray positional, or a flag whose value is missing is ONE
# line on stderr and exit 2. A flag NEVER swallows the next token when that token is itself a
# flag: `--repo --evidence x` is a missing value, not a repo literally named "--evidence" (the
# exact defect that shipped in this repo once, `--card --base <sha>` reading `--base` as the card).
EVIDENCE=""
REPO="$DEFAULT_REPO"
DRY_RUN=no
MAX_SECONDS="$DEFAULT_WAIT_SECONDS"

parse_flags() {
  local verb="$1"; shift
  local value_flags="" bool_flags=""
  case "$verb" in
    start)   value_flags="--repo --evidence"; bool_flags="--dry-run" ;;
    wait)    value_flags="--evidence --max-seconds" ;;
    collect) value_flags="--evidence" ;;
  esac
  while (( $# )); do
    local token="$1" value
    if [[ " $value_flags " == *" $token "* ]]; then
      value="${2-}"
      [[ -n "$value" && "$value" != --* ]] || die "$token requires a value"
      case "$token" in
        --repo) REPO="$value" ;;
        --evidence) EVIDENCE="$value" ;;
        --max-seconds) MAX_SECONDS="$value" ;;
      esac
      shift 2
      continue
    fi
    if [[ " $bool_flags " == *" $token "* ]]; then
      DRY_RUN=yes
      shift
      continue
    fi
    die "unknown flag or unexpected argument for verb '$verb': $token"
  done
}

# --- shared readers ---------------------------------------------------------------------------

# `start` records the home it built; `wait`/`collect` take only `--evidence` and read it back.
read_home() {
  local marker="$EVIDENCE/owner-run.home" home
  home="$(cat "$marker" 2>/dev/null)" || die "no $marker — run 'owner-run.sh start --evidence $EVIDENCE' first"
  [[ -n "$home" ]] || die "$marker is empty"
  [[ -d "$home" ]] || die "campaign home named by $marker does not exist: $home"
  printf '%s' "$home"
}

# One line for the supervisor's status file: `terminal <exitCode> <reason>` when it has terminated,
# else `running <state> <lastAction>`. A missing or unparseable file is `running starting` (plan
# Task 16): the supervisor writes its first status only after it boots, so absence means "not yet",
# never "broken". The catches are narrow — json.JSONDecodeError and UnicodeDecodeError are both
# ValueError; a JSON document that is not an object raises AttributeError on `.get`.
status_row() {
  python3 - "$1" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as handle:
        status = json.load(handle)
    terminal = status.get('terminal')
    if isinstance(terminal, dict):
        row = 'terminal %s %s' % (terminal.get('exitCode'), terminal.get('reason'))
    else:
        row = 'running %s %s' % (status.get('state') or 'starting', status.get('lastAction') or 'starting')
except (OSError, ValueError, AttributeError):
    row = 'running starting'
print(row)
PY
}

# G7's three facts about the owner's checkout, before and after the run. The `repo=` line exists
# because `collect` takes only `--evidence` (spec §7): the repo path it must re-read travels in
# the evidence file rather than in a flag the caller would have to remember.
write_g7() {
  local repo="$1" out="$2"
  {
    printf 'repo=%s\n' "$repo"
    printf 'branch=%s\n' "$(git_ -C "$repo" branch --show-current)"
    printf 'head=%s\n' "$(git_ -C "$repo" rev-parse HEAD)"
    printf -- '--- porcelain ---\n'
    git_ -C "$repo" status --porcelain
  } > "$out"
}

field_of() { sed -n "s/^$1=//p" "$2" 2>/dev/null | head -1; }
porcelain_of() { sed -n '/^--- porcelain ---$/,$p' "$1" 2>/dev/null | tail -n +2; }

# --- start ------------------------------------------------------------------------------------

# `origin/HEAD` when the repo has a remote (the owner's checkout); otherwise whichever
# conventional name exists locally, so a throwaway fixture repo with no remote still resolves.
default_branch_of() {
  local repo="$1" remote_head candidate
  remote_head="$(git_ -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
  if [[ -n "$remote_head" ]]; then
    printf '%s' "${remote_head#origin/}"
    return 0
  fi
  for candidate in master main; do
    if git_ -C "$repo" show-ref --verify --quiet "refs/heads/$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  printf '%s' master
}

# One staged card, built from nothing. `updatedAt`, `schemaLockPaths` and `docsOnlyPaths` are not
# in plan Task 16's field list but are REQUIRED by the runner's own schema (runner/core/state.ts
# `CardSchema`/`CampaignStateSchema`): MEASURED — without `updatedAt` the runner's `--dry-run`
# refuses the home with a zod error, so a state file lacking them would never load at all. An
# EMPTY `docsOnlyPaths` fails closed: nothing counts as docs-only, so no diff auto-waives a check.
write_campaign_state() {
  local home="$1" campaign
  campaign="$(basename "$home")"
  cat > "$home/campaign-state.json" <<JSON
{
  "v": 2,
  "campaign": "$campaign",
  "mergePolicy": "regular",
  "sequence": ["owner-run-probe"],
  "schemaLockPaths": [
    "plugins/tribe/scripts/runner/core/state.ts",
    "plugins/tribe/scripts/runner/core/types.ts"
  ],
  "docsOnlyPaths": [],
  "ownerOnlyEscalations": [
    "irreversible-data-shape",
    "product-promise-change",
    "new-permissions",
    "privacy-surface-change"
  ],
  "cards": {
    "owner-run-probe": {
      "status": "staged",
      "spec": "$PROBE_PLAN",
      "plan": "$PROBE_PLAN",
      "branch": null,
      "baseSha": null,
      "pr": null,
      "mergeSha": null,
      "sessionId": null,
      "updatedAt": null,
      "tasks": [{"id": "T1", "heading": "Task 1 — append the line"}]
    }
  }
}
JSON
}

# One pre-seeded ruling whose `ratified-as:` is `pending`, so the run needs a `ratify` session
# (G1 wants one of each supervisor session kind: `ruling`, `ratify`, `closing`).
#
# Its card is `owner-run-seed` — deliberately NOT `owner-run-probe`, and not in the campaign's
# `sequence` at all. Spec §7's expected flow: "The probe plan's first step returns
# NEEDS_DIRECTION (a naming question, not owner-only), so the supervisor starts a `ruling`." That
# escalation is the ONLY path to a `ruling` session (core/supervisor/decide.ts spawns `ruling`
# on exit reason `escalations_pending` and on nothing else), and the probe plan's "Before any
# task — ask first" gate escalates only while its executor brief holds no ruling for card
# `owner-run-probe`. `core/brief.ts#executorBrief` embeds this whole file verbatim, so a pre-seed
# naming `owner-run-probe` answers the question before it is asked and silently costs the entire
# `ruling` row — MEASURED: run sir-owner-run-20260927T092641Z exited 0 `campaign_closed` with
# G1 2/2 kinds=closing,ratify, i.e. 2 supervisor sessions where spec §5 row G8 requires ≥ 3.
# The body says so in a line of its own, so no model has to infer it.
#
# The `ratify` job still lands: `core/rulings.ts#unratifiedRulingIds` classifies by `ratified-as:`
# per `## ` block and never looks at the card, and `pending` deliberately does not count as
# ratified. The `ruling` session's own ruling cannot be relied on for that — `core/supervisor/
# brief-ruling.md` lets it write `operational`, which is already ratified.
write_answers() {
  cat > "$1/answers.md" <<'MD'
# Rulings

## R0 — owner-run pre-seed

**Card:** owner-run-seed
**Ruling:** The ledger is the only evidence this run needs.
**Not a ruling for `owner-run-probe`:** that card is unruled — this campaign's only card must
still ask its own question.
ratified-as: pending
MD
}

cmd_start() {
  local repo_abs
  # A relative `--repo` is resolved against the CALLER's cwd — the shape a person types
  # (`--repo repo`), and the shape that has broken tools in this repo before.
  repo_abs="$(cd "$REPO" 2>/dev/null && pwd -P)" || die "--repo: not a directory: $REPO"
  git_ -C "$repo_abs" rev-parse --git-dir >/dev/null 2>&1 || die "--repo: not a git repository: $repo_abs"

  local porcelain branch default_branch
  porcelain="$(git_ -C "$repo_abs" status --porcelain)"
  [[ -z "$porcelain" ]] || die "$repo_abs is dirty — a dirty checkout fails every ruling (verifyRuling repo_touched); commit or stash first"
  branch="$(git_ -C "$repo_abs" branch --show-current)"
  default_branch="$(default_branch_of "$repo_abs")"
  [[ -n "$branch" && "$branch" == "$default_branch" ]] \
    || die "$repo_abs is on '$branch', not its default branch '$default_branch'"

  local tribe_home home
  tribe_home="$(bash "$SCRIPTS/tribe-home.sh" "$repo_abs")" || die "cannot resolve the tribe home of $repo_abs"
  home="$tribe_home/campaigns/sir-owner-run-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$home/supervisor" || die "cannot create campaign home: $home"

  write_campaign_state "$home"
  write_answers "$home"
  write_g7 "$repo_abs" "$EVIDENCE/g7-main-before.txt"
  printf '%s\n' "$home" > "$EVIDENCE/owner-run.home"

  if [[ "$DRY_RUN" == yes ]]; then
    # The runner's OWN dry run: it proves the home just built actually loads (state schema, the
    # staged card, its spec/plan present in the repo) and has zero side effects by construction
    # (cli/main.ts: no report, no viewer, no session under --dry-run). `--model` is a REQUIRED
    # flag of `parseArgs`, so it is passed even though a dry run never spawns a session with it.
    ( bun "$RUNNER/run.ts" --repo "$repo_abs" --home "$home" --model sonnet --dry-run ) \
      > "$home/supervisor/dry-run.log" 2>&1
    local runner_rc=$?
    # A dry run has nothing to wait on, so `wait` is handed a synthetic terminal status. Nothing
    # was launched: no session, no `supervise` process.
    printf '%s' '{"v":1,"state":"terminal","lastAction":"dry-run","terminal":{"status":"done","reason":"dry_run","exitCode":0}}' \
      > "$home/supervisor/status.json"
    printf 'DRY_RUN=1 runner_rc=%s log=%s\n' "$runner_rc" "$home/supervisor/dry-run.log"
  else
    # Detached, the same double-fork the orchestrate-campaign skill uses for its own supervisor
    # launch (SKILL.md Stage C). This is NOT `run_in_background`: the subshell + `nohup` re-parent
    # the process away from the calling session, so it outlives it by design.
    ( nohup env -u ANTHROPIC_API_KEY bun "$RUNNER/run.ts" supervise --repo "$repo_abs" --home "$home" \
        --model sonnet --watchdog-model sonnet --session-timeout-seconds 1800 --session-max-turns 150 --max-spawns 6 \
        </dev/null >"$home/supervisor/launch.log" 2>&1 & )
  fi
  printf 'HOME_DIR=%s\n' "$home"
}

# --- wait -------------------------------------------------------------------------------------

cmd_wait() {
  [[ "$MAX_SECONDS" =~ ^[0-9]+$ ]] && (( MAX_SECONDS >= 1 )) \
    || die "--max-seconds: expected a positive integer, got \"$MAX_SECONDS\""
  if (( MAX_SECONDS > WAIT_CEILING_SECONDS )); then MAX_SECONDS=$WAIT_CEILING_SECONDS; fi

  local home; home="$(read_home)" || exit 2
  local status_file="$home/supervisor/status.json"
  local deadline=$(( $(date +%s) + MAX_SECONDS ))
  local row left nap
  while :; do
    row="$(status_row "$status_file")"
    if [[ "$row" == terminal* ]]; then
      printf '%s\n' "$row"
      return 0
    fi
    left=$(( deadline - $(date +%s) ))
    (( left <= 0 )) && break
    # The last sleep is shortened to the time left: this verb never sleeps past its budget.
    nap=$POLL_SECONDS
    (( left < nap )) && nap=$left
    sleep "$nap"
  done
  printf '%s\n' "$row"
}

# --- collect ----------------------------------------------------------------------------------
# Every collector returns exactly ONE row on stdout — a measurement or a NAMED refusal — and never
# aborts the verb. Tool output goes to files under `--evidence`, never to this stdout.

collect_g7() {
  local repo="$1"
  local before="$EVIDENCE/g7-main-before.txt" after="$EVIDENCE/g7-main-after.txt"
  local row reasons="" b_branch a_branch b_head a_head
  if [[ ! -s "$before" ]]; then
    row="G7 FAIL no_before_file $before"
  elif [[ -z "$repo" || ! -d "$repo" ]]; then
    row="G7 FAIL repo_unknown (no repo= line in $before)"
  else
    write_g7 "$repo" "$after"
    b_branch="$(field_of branch "$before")"; a_branch="$(field_of branch "$after")"
    b_head="$(field_of head "$before")";     a_head="$(field_of head "$after")"
    [[ "$a_branch" == "$b_branch" ]] || reasons="$reasons branch:$b_branch->$a_branch"
    [[ "$(porcelain_of "$after")" == "$(porcelain_of "$before")" ]] || reasons="$reasons porcelain_changed"
    # The run is allowed to MOVE main forward (the probe card merges one PR), never to rewrite it.
    git_ -C "$repo" merge-base --is-ancestor "$b_head" "$a_head" 2>/dev/null \
      || reasons="$reasons head_not_descendant:$b_head->$a_head"
    if [[ -z "$reasons" ]]; then
      row="G7 PASS branch=$a_branch head=$b_head->$a_head porcelain=clean_as_before"
    else
      row="G7 FAIL$reasons"
    fi
  fi
  printf '%s\n' "$row" > "$EVIDENCE/g7-verdict.txt"
  printf '%s' "$row"
}

collect_g1() {
  local repo="$1" home="$2" out="$EVIDENCE/g1-transcript-cwd.txt" rc row
  bun "$SCRIPTS/tests/sessions-in-repo/g1-transcript-cwd.ts" --home "$home" --repo "$repo" > "$out" 2>&1
  rc=$?
  row="$(command grep -e '^G1 ' "$out" | tail -1)"
  if [[ -n "$row" ]]; then printf '%s' "$row"; else printf 'G1 FAIL tool_rc=%s see %s' "$rc" "$out"; fi
}

collect_g5() {
  local home="$1" slug="$2"
  local shots="$EVIDENCE/g5" badges="$EVIDENCE/g5-badges.jsonl"
  local ids=() id build_rc probe_rc serve_pid waited=0 row
  mkdir -p "$shots"
  # Every session id G1 listed. A session row is recognized by its SHAPE — `<id> <kind> log=…
  # transcript=… PASS|FAIL` — and the id must look like a session id, because `g1-transcript-cwd.txt`
  # also carries G1's own refusal text (its stderr) and its `G1 n/n` summary. MEASURED against an
  # empty campaign home: without both filters, the refusal line "unreadable home: cannot read …"
  # yielded the id `unreadable`, and the probe screenshotted a page for it. Matching nothing here is
  # a legitimate empty result, never a crash. The charset is the viewer's own session-id charset —
  # this id reaches a `--shots/<id8>.png` path, so it is contained before it is used.
  while read -r id; do
    ids+=("$id")
  done < <(awk '$3 ~ /^log=/ && $1 ~ /^[0-9a-fA-F-]+$/ && length($1) >= 8 && length($1) <= 64 { print $1 }' \
    "$EVIDENCE/g1-transcript-cwd.txt" 2>/dev/null)
  if (( ${#ids[@]} == 0 )); then
    : > "$badges"
    printf 'G5 0/0 no_sessions_listed_by_g1'
    return 0
  fi

  ( cd "$VIEWER" && bun run build ) > "$shots/build.log" 2>&1
  build_rc=$?
  if (( build_rc != 0 )); then
    printf 'G5 FAIL viewer_build_rc=%s see %s' "$build_rc" "$shots/build.log"
    return 0
  fi

  ( cd "$VIEWER" && exec bun serve.ts --port "$VIEWER_PORT" ) > "$shots/serve.log" 2>&1 &
  serve_pid=$!
  # The server dies with this collector on every exit path, including a refusal below.
  trap 'kill '"$serve_pid"' 2>/dev/null' EXIT INT TERM
  until curl -sS -o /dev/null "http://127.0.0.1:$VIEWER_PORT/" 2>/dev/null; do
    (( waited >= 20 )) && break
    sleep 1
    waited=$(( waited + 1 ))
  done

  ( cd "$VIEWER" && bun tools/badge-probe.ts --base "http://127.0.0.1:$VIEWER_PORT" --slug "$slug" \
      --shots "$shots" "${ids[@]}" ) > "$badges" 2> "$shots/probe.log"
  probe_rc=$?
  kill "$serve_pid" 2>/dev/null
  trap - EXIT INT TERM

  row="$(command grep -e '^G5 ' "$badges" | tail -1)"
  [[ -n "$row" ]] || row="G5 FAIL probe_rc=$probe_rc see $shots/probe.log"
  printf '%s' "$row"
}

collect_g8() {
  local home="$1"
  local ledger="$home/supervisor/ledger.jsonl"
  local copy="$EVIDENCE/g8-ledger.jsonl" llm="$EVIDENCE/g8-llm-tree.txt" compare="$EVIDENCE/g8-compare.json"
  local tool_err
  cp "$ledger" "$copy" 2>/dev/null || { printf 'G8 FAIL ledger_unreadable %s' "$ledger"; return 0; }
  # The ledger alone, read by an LLM with no tools: G8 asks whether the FILE carries the tree.
  # stderr joins the evidence file on purpose — `treeFromLlmText` ignores every line that is not
  # ROOT/EDGE, so a CLI failure is visible to a human there AND scores zero, which is the honest
  # score for "the model never answered".
  { printf '%s\n\n' "$G8_PROMPT"; cat "$copy"; } | claude -p --model "$LLM_MODEL" --tools "" > "$llm" 2>&1
  tool_err="$( { bun "$SCRIPTS/tests/sessions-in-repo/g8-ledger-tree.ts" --home "$home" --llm "$llm" > "$compare"; } 2>&1 )"
  python3 - "$compare" "$tool_err" <<'PY'
import json, sys
def part(score):
    if not isinstance(score, dict):
        return 'none'
    return '%s/%s,%s/%s' % (score.get('present'), score.get('total'),
                            score.get('edgesCorrect'), score.get('edgesTotal'))
try:
    with open(sys.argv[1], encoding='utf-8') as handle:
        data = json.load(handle)
    sys.stdout.write('G8 ledger=%s llm=%s' % (part(data.get('ledger')), part(data.get('llm'))))
except (OSError, ValueError, AttributeError) as exc:
    sys.stdout.write('G8 FAIL comparator_output_unreadable: %s %s' % (exc, sys.argv[2]))
PY
}

cmd_collect() {
  local home repo slug g1_row g5_row g7_row g8_row terminal
  home="$(read_home)" || exit 2
  repo="$(field_of repo "$EVIDENCE/g7-main-before.txt")"
  slug="$(basename "$home")"

  g7_row="$(collect_g7 "$repo")"
  g1_row="$(collect_g1 "$repo" "$home")"
  g5_row="$(collect_g5 "$home" "$slug")"
  g8_row="$(collect_g8 "$home")"
  terminal="$(status_row "$home/supervisor/status.json")"

  printf '%s\n' "$g1_row" "$g5_row" "$g7_row" "$g8_row"
  if [[ "$terminal" == terminal\ * ]]; then
    printf 'supervise exit %s\n' "${terminal#terminal }"
  else
    printf 'supervise exit ? not_terminal (%s)\n' "$terminal"
  fi
}

# --- dispatch ---------------------------------------------------------------------------------

VERB="${1-}"
case "$VERB" in
  start|wait|collect) shift; parse_flags "$VERB" "$@" ;;
  '') die "usage: owner-run.sh start|wait|collect --evidence <dir> [...]" ;;
  *) die "unknown verb: $VERB (expected start, wait or collect)" ;;
esac

[[ -n "$EVIDENCE" ]] || die "--evidence <dir> is required for every verb"
mkdir -p "$EVIDENCE" || die "cannot create evidence dir: $EVIDENCE"
EVIDENCE="$(cd "$EVIDENCE" && pwd -P)" || die "cannot resolve evidence dir: $EVIDENCE"

case "$VERB" in
  start) cmd_start ;;
  wait) cmd_wait ;;
  collect) cmd_collect ;;
esac
