#!/usr/bin/env bash
# test-install-cli.sh — ./install.sh puts the `tribe` command on PATH.
#
# The shape a user lives through: run the ROOT installer on a clean machine, open a shell in
# some unrelated directory, type `tribe`. The link target is this checkout's real
# scripts/cli/bin/tribe (not a stub), so a broken entry file fails here, not on the user's box.
# TRIBE_BIN_DIR and CLAUDE_DIR keep every write inside $TMP.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd -P)"
TRIBE_CMD_SRC="$REPO_ROOT/plugins/tribe/scripts/cli/bin/tribe"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check()    { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2 want: $3)"; fi; }
contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (got: $2 want substring: $3)"; fi; }

BIN="$TMP/home/.local/bin"
install_tribe() { CLAUDE_DIR="$TMP/home/.claude" TRIBE_BIN_DIR="$BIN" bash "$REPO_ROOT/install.sh" tribe 2>&1; }
mkdir -p "$TMP/home/.claude" "$TMP/elsewhere"

# --- 1. clean machine: the command is linked to this checkout --------------------------
out="$(PATH="$BIN:$PATH" install_tribe)"
contains "install reports the linked command" "$out" "linked  command tribe -> $BIN/tribe"
check "tribe links to scripts/cli/bin/tribe" "$(readlink "$BIN/tribe" 2>/dev/null)" "$TRIBE_CMD_SRC"

# --- 2. a bare `tribe` runs from an unrelated directory ---------------------------------
want_version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO_ROOT/plugins/tribe/.claude-plugin/plugin.json")"
check "bare \`tribe --version\` from another cwd prints the plugin version" \
  "$(cd "$TMP/elsewhere" && PATH="$BIN:$PATH" tribe --version)" "$want_version"
contains "bare \`tribe --help\` describes the viewer" \
  "$(cd "$TMP/elsewhere" && PATH="$BIN:$PATH" tribe --help)" "start the read-only session viewer"

# --- 3. idempotent: a second install keeps the one link ---------------------------------
out="$(PATH="$BIN:$PATH" install_tribe)"
contains "re-install reports the command already linked" "$out" "ok      command tribe (already linked)"
check "re-install leaves no backup" "$(find "$BIN" -name 'tribe.bak.*' | wc -l | tr -d ' ')" "0"

# --- 4. a foreign `tribe` already in the bin dir is backed up, not destroyed ------------
rm "$BIN/tribe"; printf '#!/bin/sh\necho someone else\n' > "$BIN/tribe"
out="$(PATH="$BIN:$PATH" install_tribe)"
check "foreign tribe replaced by the link" "$(readlink "$BIN/tribe" 2>/dev/null)" "$TRIBE_CMD_SRC"
if ls "$BIN"/tribe.bak.* >/dev/null 2>&1; then ok "foreign tribe backed up"; else bad "foreign tribe not backed up (got: $out)"; fi

# --- 5. bin dir missing from PATH: install says how to fix it ---------------------------
out="$(PATH="/usr/bin:/bin:$(dirname "$(command -v bun)")" install_tribe)"
contains "install warns when the bin dir is not on PATH" "$out" "$BIN is not on PATH"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
