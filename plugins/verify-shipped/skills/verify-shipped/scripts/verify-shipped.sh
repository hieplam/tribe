#!/usr/bin/env bash
# verify-shipped.sh — mechanically check the tribe's Definition of Done.
#
# The owner's global CLAUDE.md defines "done" as: PR merged and ready to
# work on new feature with LATEST CHANGES. How the PR was merged does not
# matter. This script checks that, mechanically, instead of trusting a
# Warchief's prose SHIPPED report.
#
# Four checks, each reported independently:
#   1. pr_merged              — PR state == MERGED
#   2. master_in_sync         — local <base> branch has no divergence from
#                                origin/<base> (0 ahead, 0 behind)
#   3. worktree_removed       — the given worktree path is gone from both
#                                `git worktree list` and disk
#   4. gap_gate_stamped       — the merged PR's body carries a `gap-gate v1`
#                                stamp whose `card=` matches --card
#
# Output: JSON summary on stdout only. Logs go to stderr.
# Exit codes: 0 = ran to completion (regardless of pass/fail); 2 = setup error.
#
# Usage:
#   verify-shipped.sh --pr <number|url> --worktree <path> --card <slug> [--base master] [--repo owner/repo]
#
# Requires: gh (GitHub CLI, authenticated), git, python3.

set -euo pipefail

LOG() { printf '[verify-shipped] %s\n' "$*" >&2; }
DIE() { LOG "ERROR: $*"; exit 2; }

PR_ARG=""
WORKTREE_ARG=""
BASE_BRANCH="master"
REPO_ARG=""
CARD_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)        PR_ARG="$2"; shift 2 ;;
    --worktree)  WORKTREE_ARG="$2"; shift 2 ;;
    --base)      BASE_BRANCH="$2"; shift 2 ;;
    --repo)      REPO_ARG="$2"; shift 2 ;;
    --card)      CARD_ARG="${2:-}"; shift $(( $# >= 2 ? 2 : 1 )) ;;
    -h|--help)   sed -n '2,25p' "$0"; exit 0 ;;
    *)           DIE "unknown arg: $1" ;;
  esac
done

[[ -n "$PR_ARG" ]]       || DIE "--pr <number|url> is required"
[[ -n "$WORKTREE_ARG" ]] || DIE "--worktree <path> is required (all four checks must run)"
[[ -n "$CARD_ARG" ]] || DIE "--card <slug> is required (all four checks must run)"

command -v gh >/dev/null 2>&1      || DIE "gh (GitHub CLI) not found — required for PR checks"
command -v git >/dev/null 2>&1     || DIE "git not found"
command -v python3 >/dev/null 2>&1 || DIE "python3 not found — required to emit JSON"

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || DIE "not in a git repo"

# Canonicalize a possibly-relative --worktree path against the caller's
# original $PWD *before* we cd into REPO_ROOT below. If this isn't done,
# a relative path (e.g. `../mywt`) silently gets re-resolved against
# REPO_ROOT instead of the caller's cwd, causing check 3 to test the wrong
# location and produce a false PASS for a worktree that is still on disk.
WORKTREE_ARG=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$WORKTREE_ARG")

cd "$REPO_ROOT"

# Note: deliberately not using a `REPO_FLAGS=()` array + `"${REPO_FLAGS[@]}"`
# expansion here. Under macOS's default /bin/bash (3.2.57), referencing an
# empty array with `set -u` active throws "unbound variable" and aborts
# before `gh` ever runs — exactly the common case where --repo is omitted
# because we're already inside the target repo's checkout. A plain
# if/else with two literal `gh` invocations sidesteps the bash-version trap.
LOG "resolving PR: $PR_ARG"
if [[ -n "$REPO_ARG" ]]; then
  PR_JSON=$(gh pr view "$PR_ARG" --repo "$REPO_ARG" \
    --json number,url,state,commits,baseRefName,headRefName,mergedAt,body 2>/dev/null) \
    || DIE "gh pr view failed for $PR_ARG (not found, no auth, or not a PR)"
else
  PR_JSON=$(gh pr view "$PR_ARG" \
    --json number,url,state,commits,baseRefName,headRefName,mergedAt,body 2>/dev/null) \
    || DIE "gh pr view failed for $PR_ARG (not found, no auth, or not a PR)"
fi

PR_NUMBER=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["number"])' "$PR_JSON")
PR_STATE=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["state"])' "$PR_JSON")
PR_BODY=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["body"] or "")' "$PR_JSON")

# ---------- check 1: pr_merged ----------
if [[ "$PR_STATE" == "MERGED" ]]; then
  CHECK1_STATUS="pass"; CHECK1_DETAIL="PR #$PR_NUMBER state is MERGED"
else
  CHECK1_STATUS="fail"; CHECK1_DETAIL="PR #$PR_NUMBER state is $PR_STATE, not MERGED"
fi

# ---------- check 2: master_in_sync ----------
git fetch origin "$BASE_BRANCH" >/dev/null 2>&1 || true
if ! git rev-parse --verify --quiet "$BASE_BRANCH" >/dev/null; then
  CHECK2_STATUS="unknown"
  CHECK2_DETAIL="no local branch named $BASE_BRANCH to compare"
elif ! git rev-parse --verify --quiet "origin/$BASE_BRANCH" >/dev/null; then
  CHECK2_STATUS="unknown"
  CHECK2_DETAIL="no origin/$BASE_BRANCH ref found (fetch failed?)"
else
  read -r AHEAD BEHIND <<<"$(git rev-list --left-right --count "$BASE_BRANCH...origin/$BASE_BRANCH")"
  if [[ "$AHEAD" == "0" && "$BEHIND" == "0" ]]; then
    CHECK2_STATUS="pass"
    CHECK2_DETAIL="local $BASE_BRANCH == origin/$BASE_BRANCH"
  else
    CHECK2_STATUS="fail"
    CHECK2_DETAIL="local $BASE_BRANCH is $AHEAD ahead / $BEHIND behind origin/$BASE_BRANCH"
  fi
fi

# ---------- check 3: worktree_removed ----------
WORKTREE_ABS="$WORKTREE_ARG"
REGISTERED=$(git worktree list --porcelain | grep -A0 "^worktree $WORKTREE_ARG$" || true)
if [[ -e "$WORKTREE_ABS" || -n "$REGISTERED" ]]; then
  CHECK3_STATUS="fail"
  DETAIL_BITS=""
  [[ -e "$WORKTREE_ABS" ]] && DETAIL_BITS="path still exists on disk"
  [[ -n "$REGISTERED" ]] && DETAIL_BITS="${DETAIL_BITS:+$DETAIL_BITS; }still registered in git worktree list"
  CHECK3_DETAIL="$WORKTREE_ARG not fully removed — $DETAIL_BITS"
else
  CHECK3_STATUS="pass"
  CHECK3_DETAIL="$WORKTREE_ARG is gone from disk and from git worktree list"
fi

# ---------- check 4: gap_gate_stamped ----------
# The merged PR's body must carry a `gap-gate v1` stamp for THIS card (spec CU-4 §3). This is
# the attended-session backstop for a PR opened by any session that bypassed the Warchief and
# so never ran the gap gate. Sha ancestry is deliberately NOT re-checked here — that is the
# campaign runner's `gapGateStamped` point, which has the merged repo in hand.
CHECK4_RAW=$(python3 - "$PR_BODY" "$CARD_ARG" <<'PY'
import re, sys
body, card = sys.argv[1], sys.argv[2]
m = re.search(
    r"<!--\s*gap-gate v1\s+card=(\S+)\s+base=(\S+)\s+head=(\S+)\s+minted=(\S+)\s+"
    r"matched=(\S+)\s+debt-delta=(-?\d+)\s+ledger=(\S+?)\s*-->",
    body,
)
if not m:
    print("fail\tPR body carries no `gap-gate v1` stamp - the harness-gap gate never ran for this PR")
elif m.group(1) != card:
    print("fail\tPR body carries a gap-gate stamp for card=%s, not %s" % (m.group(1), card))
else:
    print("pass\tgap-gate v1 stamp present for card %s (minted=%s matched=%s)" % (card, m.group(4), m.group(5)))
PY
)
CHECK4_STATUS="${CHECK4_RAW%%$'\t'*}"
CHECK4_DETAIL="${CHECK4_RAW#*$'\t'}"

# ---------- verdict ----------
if [[ "$CHECK1_STATUS" == "pass" && "$CHECK2_STATUS" == "pass" && "$CHECK3_STATUS" == "pass" && "$CHECK4_STATUS" == "pass" ]]; then
  VERDICT="PASS"
else
  VERDICT="FAIL"
fi

# Pass every value as an argv element (not interpolated into the heredoc) so
# that commit titles / branch names containing quotes, backticks or $(...)
# can never be interpreted by the shell or break the JSON.
python3 - \
  "$PR_NUMBER" "$BASE_BRANCH" "$WORKTREE_ARG" "$VERDICT" \
  "$CHECK1_STATUS" "$CHECK1_DETAIL" \
  "$CHECK2_STATUS" "$CHECK2_DETAIL" \
  "$CHECK3_STATUS" "$CHECK3_DETAIL" \
  "$CHECK4_STATUS" "$CHECK4_DETAIL" \
  "$CARD_ARG" \
  <<'PY'
import json, sys

(pr_number, base_branch, worktree, verdict,
 c1_status, c1_detail, c2_status, c2_detail,
 c3_status, c3_detail, c4_status, c4_detail,
 card_slug) = sys.argv[1:14]

print(json.dumps({
    "pr_number": pr_number,
    "base_branch": base_branch,
    "worktree": worktree,
    "card": card_slug,
    "checks": {
        "pr_merged":             {"status": c1_status, "detail": c1_detail},
        "master_in_sync":        {"status": c2_status, "detail": c2_detail},
        "worktree_removed":      {"status": c3_status, "detail": c3_detail},
        "gap_gate_stamped":      {"status": c4_status, "detail": c4_detail},
    },
    "verdict": verdict,
}, indent=2))
PY
