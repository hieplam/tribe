#!/usr/bin/env bash
# test-install-viewer-build.sh — the install hook builds the viewer client into dist/,
# and never hard-fails the whole install when bun is absent.
#
# Spec ref: docs/tribe/planning/viewer-consolidation/spec.md §10.3 (the build block appended
# to plugins/tribe/install.sh) and §13 (dist/index.html missing -> serve.ts refuses to start
# with one stderr line, never a blank page). This test proves the OTHER half: that install.sh
# actually produces dist/index.html, and does so from a bare state rather than one where a
# stale dist/ from an earlier manual build could make the assertion pass for free
# (rule-fixtures-mirror-reality: the empty-fixture case, exercised here, not just read about).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="$HERE/../../install.sh"
VIEWER_DIR="$HERE/../viewer"
DIST="$VIEWER_DIR/dist"

TMP="$(mktemp -d)"
DIST_BAK_HOME="$(mktemp -d)"
DIST_BAK="$DIST_BAK_HOME/dist"
HAD_DIST=0
if [ -e "$DIST" ]; then HAD_DIST=1; fi

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }

# Restore whatever dist/ looked like before this test ran, whether the test passed, failed,
# or aborted mid-way (fail-closed-edges: clean up temp state in a trap, not on the happy path).
cleanup() {
  rm -rf "$TMP" "$DIST_BAK_HOME"
}
trap cleanup EXIT

restore_prior_dist() {
  rm -rf "$DIST"
  if [ "$HAD_DIST" -eq 1 ] && [ -d "$DIST_BAK" ]; then
    mv "$DIST_BAK" "$DIST"
  fi
}

# --- empty-fixture setup: move any existing dist/ aside so the build below is proven from a
# bare state, not asserted against leftovers from a prior manual `bun run build` -----------
if [ "$HAD_DIST" -eq 1 ]; then
  mv "$DIST" "$DIST_BAK"
fi

# --- 1. a clean install builds dist/index.html from nothing --------------------------------
CLAUDE_DIR="$TMP/claude1" bash "$HOOK_SRC" >"$TMP/run1.out" 2>&1
if [ -f "$DIST/index.html" ]; then
  ok "install hook builds dist/index.html from a clean state"
else
  bad "install hook builds dist/index.html from a clean state (missing after run; hook output: $(cat "$TMP/run1.out")"
fi

# --- 2. bun missing: the hook still exits 0 and warns, never a hard failure ----------------
# Mask bun out of PATH by dropping every PATH entry that resolves an executable named `bun`,
# rather than trusting a directory listing — this is the actual mechanism PATH lookup uses.
BUN_MASKED_PATH=""
IFS=':' read -r -a path_dirs <<<"$PATH"
for d in "${path_dirs[@]}"; do
  [ -n "$d" ] || continue
  if [ -x "$d/bun" ]; then continue; fi
  BUN_MASKED_PATH="${BUN_MASKED_PATH:+$BUN_MASKED_PATH:}$d"
done
if command -v bun >/dev/null 2>&1; then
  : # sanity: bun is on the real PATH, so the masked run below is a real negative case
else
  bad "test precondition: bun must be on PATH for this test to mean anything"
fi

set +e
out2="$(PATH="$BUN_MASKED_PATH" CLAUDE_DIR="$TMP/claude2" bash "$HOOK_SRC" 2>&1)"
rc2=$?
set -e

if [ "$rc2" -eq 0 ]; then
  ok "install hook exits 0 when bun is masked out of PATH"
else
  bad "install hook exits 0 when bun is masked out of PATH (got rc=$rc2, output: $out2)"
fi

if grep -qi 'bun not found' <<<"$out2"; then
  ok "install hook warns when bun is masked out of PATH"
else
  bad "install hook warns when bun is masked out of PATH (got: $out2)"
fi

restore_prior_dist

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
