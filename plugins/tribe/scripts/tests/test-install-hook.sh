#!/usr/bin/env bash
# test-install-hook.sh — the CLAUDE.md snippet appender never duplicates guidance.
#
# The hook's job: append each claude-md/*.md snippet to the global CLAUDE.md exactly once.
# Its presence check keys on the snippet's FIRST line, which is correct only while that line
# is the one the target already carries. When a snippet grows a NEW top-level heading above
# an existing section, the first-line marker misses, the snippet appends, and the target ends
# up with two copies of the same section — which then drift apart and contradict each other.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="$HERE/../../install.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2 want: $3)"; fi; }

# Builds an isolated plugin dir holding a copy of the hook + the given snippet body, so each
# case controls claude-md/ contents without touching the real plugin.
setup_case() {
  local name="$1" snippet_body="$2" target_body="${3-}"
  local dir="$TMP/$name"
  mkdir -p "$dir/plugin/claude-md" "$dir/claude"
  cp "$HOOK_SRC" "$dir/plugin/install.sh"
  printf '%s' "$snippet_body" > "$dir/plugin/claude-md/rules.md"
  [ -n "$target_body" ] && printf '%s' "$target_body" > "$dir/claude/CLAUDE.md"
  printf '%s' "$dir"
}
run_hook() { CLAUDE_DIR="$1/claude" bash "$1/plugin/install.sh"; }
count_in() { grep -cxF "$2" "$1/claude/CLAUDE.md" || true; }

SECTION='## Review agents — when to use which'
SNIPPET="# NON-NEGOTIABLE RULES

- Always use the C3 skill.

$SECTION

- Boundary: tracker owns rules; skinner owns done-ness.
"

# --- 1. fresh target: the snippet lands ------------------------------------------------
d="$(setup_case fresh "$SNIPPET")"
run_hook "$d" >/dev/null
check "fresh CLAUDE.md receives the snippet" "$(count_in "$d" "$SECTION")" "1"

# --- 2. idempotence: re-running never appends twice ------------------------------------
run_hook "$d" >/dev/null
run_hook "$d" >/dev/null
check "re-running the hook is idempotent" "$(count_in "$d" "$SECTION")" "1"

# --- 3. REGRESSION: marker absent, section already present -----------------------------
# A hand-edited CLAUDE.md carrying an OLDER copy of the section, from before the snippet
# grew its "# NON-NEGOTIABLE RULES" first line. The first-line marker misses here; only a
# heading-overlap check stops the duplicate.
d="$(setup_case stale "$SNIPPET" "# My rules

$SECTION

- Boundary: an older, drifted wording of the same rule.
")"
set +e; out="$(run_hook "$d" 2>&1)"; rc=$?; set -e
check "stale-copy target: section is NOT duplicated" "$(count_in "$d" "$SECTION")" "1"
check "stale-copy target: hook still exits 0" "$rc" "0"
if grep -qi 'reconcile' <<<"$out"; then ok "stale-copy target: warns the owner to reconcile"
else bad "stale-copy target: no reconcile warning (got: $out)"; fi

# --- 4. empty first line: skipped with a warning, target untouched ---------------------
d="$(setup_case emptyfirst "
# Orphan heading
")"
set +e; out="$(run_hook "$d" 2>&1)"; rc=$?; set -e
check "empty-marker snippet: exits 0" "$rc" "0"
check "empty-marker snippet: target stays empty" "$(count_in "$d" "# Orphan heading")" "0"
if grep -qi 'first line empty' <<<"$out"; then ok "empty-marker snippet: warns"
else bad "empty-marker snippet: no warning (got: $out)"; fi

# --- 5. the REAL shipped snippets reach a machine that already has the global rules ------
# A snippet added after install day must land beside an already-installed global-rules.md,
# which means its first line and every heading must be absent from that snippet.
REAL_MD="$HERE/../../claude-md"
BRAINSTORM_MARKER="$(head -n 1 "$REAL_MD/shaman-brainstorm-together.md" 2>/dev/null || true)"
d="$TMP/real"; mkdir -p "$d/plugin/claude-md" "$d/claude"
cp "$HOOK_SRC" "$d/plugin/install.sh"; cp "$REAL_MD"/*.md "$d/plugin/claude-md/"
cp "$REAL_MD/global-rules.md" "$d/claude/CLAUDE.md"
run_hook "$d" >/dev/null; run_hook "$d" >/dev/null
check "real snippets: brainstorm-together lands once on an installed machine" \
  "$(count_in "$d" "$BRAINSTORM_MARKER")" "1"
check "real snippets: global rules are not duplicated" \
  "$(count_in "$d" "$(head -n 1 "$REAL_MD/global-rules.md")")" "1"
dupes="$(cat "$REAL_MD"/*.md | grep -E '^#{1,6} ' | sort | uniq -d)"
check "real snippets: no heading is shared between two snippets" "$dupes" ""

# --- 6. a changed snippet refreshes its installed section in place, with a backup ----------
d="$(setup_case refresh "# Section A

the new wording
" "# Before

keep me

# Section A

the old wording

# After

keep me too
")"
set +e; out="$(run_hook "$d" 2>&1)"; rc=$?; set -e
check "refresh: hook exits 0" "$rc" "0"
check "refresh: the section carries the new wording" "$(count_in "$d" "the new wording")" "1"
check "refresh: the old wording is gone" "$(count_in "$d" "the old wording")" "0"
check "refresh: the section is not duplicated" "$(count_in "$d" "# Section A")" "1"
check "refresh: content before and after the section is kept" "$(count_in "$d" "keep me")$(count_in "$d" "keep me too")" "11"
check "refresh: one backup of the previous CLAUDE.md" "$(find "$d/claude" -name 'CLAUDE.md.bak.*' | wc -l | tr -d ' ')" "1"
check "refresh: the backup holds the old wording" "$(grep -cxF "the old wording" "$d"/claude/CLAUDE.md.bak.*)" "1"
if grep -q 'CLAUDE.md.bak' <<<"$out"; then ok "refresh: the warning names the backup"
else bad "refresh: the warning names the backup (got: $out)"; fi
run_hook "$d" >/dev/null 2>&1
check "refresh: a second run changes nothing and makes no second backup" "$(find "$d/claude" -name 'CLAUDE.md.bak.*' | wc -l | tr -d ' ')" "1"

# --- 7. a snippet with several top headings refreshes all of them, and nothing past them ------
d="$(setup_case multi "# A

a body

# B

b, new
" "
# A

a body

# B

b, old

# C

c body
")"
run_hook "$d" >/dev/null 2>&1
check "multi-heading refresh: the owned heading's body is replaced" "$(count_in "$d" "b, new")$(count_in "$d" "b, old")" "10"
check "multi-heading refresh: the next foreign section is kept" "$(count_in "$d" "c body")" "1"

# --- 8. the REAL snippets, from nothing and over today's installed CLAUDE.md -----------------
# (a) an empty CLAUDE_DIR receives every snippet exactly as shipped.
d="$TMP/real-empty"; mkdir -p "$d/plugin/claude-md" "$d/claude"
cp "$HOOK_SRC" "$d/plugin/install.sh"; cp "$REAL_MD"/*.md "$d/plugin/claude-md/"
run_hook "$d" >/dev/null 2>&1
expected="$(for f in "$REAL_MD"/*.md; do printf '\n'; cat "$f"; done)"
check "real snippets, empty CLAUDE_DIR: CLAUDE.md is the snippets, in order" "$(cat "$d/claude/CLAUDE.md")" "$expected"
# (b) the CLAUDE.md a machine carries today: the three sections as installed from commit
# 632a039, the brainstorm-together section in its old shape. Only that section changes.
d="$TMP/real-installed"; mkdir -p "$d/plugin/claude-md" "$d/claude"
cp "$HOOK_SRC" "$d/plugin/install.sh"; cp "$REAL_MD"/*.md "$d/plugin/claude-md/"
for f in global-rules goal-verify-ratchet shaman-brainstorm-together; do
  printf '\n'; git -C "$HERE" show "632a039:plugins/tribe/claude-md/$f.md"
done > "$d/claude/CLAUDE.md"
old_rules="$(sed -n '/^# NON-NEGOTIABLE RULES$/,/^# Brainstorm together/p' "$d/claude/CLAUDE.md")"
run_hook "$d" >/dev/null 2>&1
check "real snippets, today's CLAUDE.md: the brainstorm section now equals the snippet" \
  "$(sed -n '/^# Brainstorm together/,$p' "$d/claude/CLAUDE.md")" "$(cat "$REAL_MD/shaman-brainstorm-together.md")"
check "real snippets, today's CLAUDE.md: the sections before it are untouched" \
  "$(sed -n '/^# NON-NEGOTIABLE RULES$/,/^# Brainstorm together/p' "$d/claude/CLAUDE.md")" "$old_rules"
check "real snippets, today's CLAUDE.md: one backup" "$(find "$d/claude" -name 'CLAUDE.md.bak.*' | wc -l | tr -d ' ')" "1"
run_hook "$d" >/dev/null 2>&1
check "real snippets, today's CLAUDE.md: a second run makes no second backup" "$(find "$d/claude" -name 'CLAUDE.md.bak.*' | wc -l | tr -d ' ')" "1"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"; [[ "$FAIL" -eq 0 ]]
