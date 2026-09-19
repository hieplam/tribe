#!/usr/bin/env bash
# test-supervisor-ratchet.sh — card `supervisor-hardening`, Task 7 (G2). The context ratchet's own
# gate oracle: drive the thin edge (`plugins/tribe/scripts/ratchet-check.ts`) over a throwaway git
# repo built from NOTHING, proving `reviseCeiling` finally has a caller that compares a proposed
# ratchet file against its merge-base version. `pre-gate.sh` globs `test-*.sh`, so this suite is
# swept with no wiring step.
#
# UNGATED — it must stay green on every commit: this branch raises no ceiling, so the real-repo
# case (case 4) exits 0. It goes RED the instant a ceiling is raised with no `raisedBy` ruling id.
set -euo pipefail

# Neutralise host git config for EVERY git call in this script (fixture setup and the real-repo
# merge-base lookup alike), so a host `commit.gpgsign`/hooks/template setting cannot change a
# verdict (fail-closed-edges.md obligation 2). The edge sets the same for its own child.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"
RATCHET_CHECK="$REPO_ROOT/plugins/tribe/scripts/ratchet-check.ts"
RATCHET_PATH="docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TMP="$(cd "$TMP" && pwd -P)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check()    { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi }
contains() {
  if [[ -z "$3" ]]; then bad "$1 (empty needle — a vacuous contains check is not an assertion)"
  elif [[ "$2" == *"$3"* ]]; then ok "$1"
  else bad "$1 (got: $2, want substring: $3)"
  fi
}

# --- A throwaway repo, built from nothing, carrying the real committed file's shape and path -----
FIX="$TMP/ratchet-repo"
git init -q -b master "$FIX"
git -C "$FIX" config user.email t@t.test
git -C "$FIX" config user.name t
mkdir -p "$FIX/$(dirname "$RATCHET_PATH")"
cat > "$FIX/$RATCHET_PATH" <<'JSON'
{ "v": 1, "ceilings": { "ruling": 27534, "ratify": 0, "closing": 93443, "doorbell": 0 } }
JSON
git -C "$FIX" add -A
git -C "$FIX" commit -q -m "base: ruling ceiling 27534"
BASE="$(git -C "$FIX" rev-parse HEAD)"

# --- Case 1: an unjustified raise (27534 -> 999999, no raisedBy) -> exit 1, message names all three
cat > "$FIX/$RATCHET_PATH" <<'JSON'
{ "v": 1, "ceilings": { "ruling": 999999, "ratify": 0, "closing": 93443, "doorbell": 0 } }
JSON
set +e
out1="$(bun "$RATCHET_CHECK" --repo "$FIX" --base "$BASE" --path "$RATCHET_PATH" 2>&1)"
rc1=$?
set -e
check "case 1: an unjustified raise exits 1" "$rc1" "1"
contains "case 1: the refusal names the old value 27534" "$out1" "27534"
contains "case 1: the refusal names the proposed value 999999" "$out1" "999999"
contains "case 1: the refusal names raisedBy" "$out1" "raisedBy"

# --- Case 2: the SAME raise, but with raisedBy.ruling set -> exit 0 ------------------------------
cat > "$FIX/$RATCHET_PATH" <<'JSON'
{ "v": 1, "ceilings": { "ruling": 999999, "ratify": 0, "closing": 93443, "doorbell": 0 }, "raisedBy": { "ruling": "R7-2026-09-20-context-headroom" } }
JSON
set +e
bun "$RATCHET_CHECK" --repo "$FIX" --base "$BASE" --path "$RATCHET_PATH" >/dev/null 2>&1
rc2=$?
set -e
check "case 2: the same raise WITH raisedBy.ruling exits 0" "$rc2" "0"

# --- Case 3: a lowering -> exit 0 ---------------------------------------------------------------
cat > "$FIX/$RATCHET_PATH" <<'JSON'
{ "v": 1, "ceilings": { "ruling": 20000, "ratify": 0, "closing": 93443, "doorbell": 0 } }
JSON
set +e
bun "$RATCHET_CHECK" --repo "$FIX" --base "$BASE" --path "$RATCHET_PATH" >/dev/null 2>&1
rc3=$?
set -e
check "case 3: a lowering exits 0" "$rc3" "0"

# --- Case 4: the REAL repo, against its REAL merge base — the gate that now protects the committed
# file. No ceiling is raised on this branch, so it must exit 0.
set +e
MERGE_BASE="$(git -C "$REPO_ROOT" merge-base HEAD master 2>/dev/null)"
[[ -z "$MERGE_BASE" ]] && MERGE_BASE="$(git -C "$REPO_ROOT" merge-base HEAD origin/master 2>/dev/null)"
set -e
if [[ -z "$MERGE_BASE" ]]; then
  bad "case 4: resolved a real merge base for the committed ratchet"
else
  ok "case 4: resolved a real merge base for the committed ratchet"
  set +e
  out4="$(bun "$RATCHET_CHECK" --repo "$REPO_ROOT" --base "$MERGE_BASE" --path "$RATCHET_PATH" 2>&1)"
  rc4=$?
  set -e
  check "case 4: the real committed ratchet passes its own gate (no raise on this branch)" "$rc4" "0"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
