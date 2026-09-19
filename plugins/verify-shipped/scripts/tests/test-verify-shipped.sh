#!/usr/bin/env bash
# test-verify-shipped.sh — fixture tests for verify-shipped.sh (synthetic git repo, stubbed gh,
# fully offline). Card C1: the fourth check, gap_gate_stamped.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../../skills/verify-shipped/scripts/verify-shipped.sh"
PLUGIN_ROOT="$(cd "$HERE/../.." && pwd)"
SKILL_DIR="$PLUGIN_ROOT/skills/verify-shipped"
RESOLVER="$SKILL_DIR/resolve-verify-shipped.sh"
SKILL_MD="$SKILL_DIR/SKILL.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
contains() { # contains NAME HAYSTACK NEEDLE
  if [[ -z "$3" ]]; then bad "$1 (empty needle — a vacuous \"contains\" check is not a valid assertion)"
  elif [[ "$2" == *"$3"* ]]; then ok "$1"
  else bad "$1 (got: $2, want substring: $3)"
  fi
}
# NOTE: `python3 -c '...' "$@"` (not `python3 - ... <<'EOF'`) — a heredoc attached to
# `python3 -` is consumed as the SCRIPT SOURCE (that's what `-` means to python3), which
# leaves stdin empty by the time `sys.stdin.read()` runs and defeats every `pipe | jget -`
# caller below. `-c` keeps the script on argv so the piped JSON still reaches stdin.
jget() { python3 -c '
import json, sys
o = json.loads(sys.stdin.read()) if sys.argv[1] == "-" else json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."):
    o = o[k]
print(o)
' "$1" "$2"
}

STAMP='<!-- gap-gate v1 card=C1 base=aaaa111 head=bbbb222 minted=G-001 matched=none debt-delta=0 ledger=none -->'

# A throwaway repo built from NOTHING, plus a stub gh whose PR body the caller chooses.
make_repo() { # make_repo DIR
  mkdir -p "$1"; git init -q -b master "$1"
  git -C "$1" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  git -C "$1" remote add origin "$1/../origin.git" 2>/dev/null || true
}
stub_gh() { # stub_gh BIN_DIR BODY
  mkdir -p "$1"
  cat > "$1/gh" <<EOF
#!/usr/bin/env bash
cat <<'JSON'
{"number":42,"url":"u","state":"MERGED","commits":[],"baseRefName":"master","headRefName":"h","mergedAt":"now","body":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$2")}
JSON
EOF
  chmod +x "$1/gh"
}
run_vs() { # run_vs REPO BIN_DIR [extra args] -> prints JSON
  local repo="$1" bin="$2"; shift 2
  ( cd "$repo" && PATH="$bin:$PATH" bash "$SCRIPT" --pr 42 --worktree "$TMP/gone-worktree" "$@" )
}

repo="$TMP/r1"; make_repo "$repo"; bin="$TMP/bin1"
stub_gh "$bin" "## Harness gaps

$STAMP
"
out="$(run_vs "$repo" "$bin" --card C1 || true)"
check "stamp present and card matches -> pass" "$(printf '%s' "$out" | jget - checks.gap_gate_stamped.status)" "pass"

repo2="$TMP/r2"; make_repo "$repo2"; bin2="$TMP/bin2"
stub_gh "$bin2" "## Why

no stamp at all
"
out2="$(run_vs "$repo2" "$bin2" --card C1 || true)"
check "no stamp -> fail" "$(printf '%s' "$out2" | jget - checks.gap_gate_stamped.status)" "fail"
check "no stamp -> overall verdict FAIL" "$(printf '%s' "$out2" | jget - verdict)" "FAIL"

repo3="$TMP/r3"; make_repo "$repo3"; bin3="$TMP/bin3"
stub_gh "$bin3" "$STAMP"
out3="$(run_vs "$repo3" "$bin3" --card C9 || true)"
check "stamp for another card -> fail" "$(printf '%s' "$out3" | jget - checks.gap_gate_stamped.status)" "fail"

repo4="$TMP/r4"; make_repo "$repo4"; bin4="$TMP/bin4"
stub_gh "$bin4" "$STAMP"
set +e
( cd "$repo4" && PATH="$bin4:$PATH" bash "$SCRIPT" --pr 42 --worktree "$TMP/gone-worktree" >/dev/null 2>&1 )
code=$?
set -e
check "--card omitted -> setup error, exit 2" "$code" "2"

repo5="$TMP/r5"; make_repo "$repo5"; bin5="$TMP/bin5"
stub_gh "$bin5" "$STAMP"
out5="$(run_vs "$repo5" "$bin5" --card C1 || true)"
check "the three original checks are still reported" \
  "$(printf '%s' "$out5" | python3 -c 'import json,sys; print(",".join(sorted(json.load(sys.stdin)["checks"])))')" \
  "gap_gate_stamped,master_in_sync,pr_merged,worktree_removed"

repo6="$TMP/r6"; make_repo "$repo6"; bin6="$TMP/bin6"
stub_gh "$bin6" "$STAMP"
set +e
( cd "$repo6" && PATH="$bin6:$PATH" bash "$SCRIPT" --pr 42 --worktree "$TMP/gone-worktree" --card >/dev/null 2>&1 )
code=$?
set -e
check "valueless --card (no following value) -> setup error, exit 2 (not an unbound-variable crash)" "$code" "2"

# --- --verdict-out: writes a byte-identical verdict file on request ---

repo7="$TMP/r7"; make_repo "$repo7"; bin7="$TMP/bin7"
stub_gh "$bin7" "$STAMP"
verdict7="$TMP/verdict7.json"
out7="$(run_vs "$repo7" "$bin7" --card C1 --verdict-out "$verdict7" || true)"
check "--verdict-out writes a file at the given path" "$([[ -f "$verdict7" ]] && echo yes || echo no)" "yes"
check "--verdict-out file is byte-identical to stdout" "$(cat "$verdict7")" "$out7"
check "--verdict-out file's card field equals --card" "$(jget "$verdict7" card)" "C1"

repo8="$TMP/r8"; make_repo "$repo8"; bin8="$TMP/bin8"
stub_gh "$bin8" "$STAMP"
verdict8="$TMP/verdict8.json"
out5_again="$(run_vs "$repo5" "$bin5" --card C1 || true)"
out8="$(run_vs "$repo8" "$bin8" --card C1 || true)"
check "without --verdict-out, no file is written" "$([[ -e "$verdict8" ]] && echo yes || echo no)" "no"
check "without --verdict-out, stdout is unchanged (same as a prior no-flag run)" "$out8" "$out5_again"

repo9="$TMP/r9"; make_repo "$repo9"; bin9="$TMP/bin9"
stub_gh "$bin9" "$STAMP"
set +e
( cd "$repo9" && PATH="$bin9:$PATH" bash "$SCRIPT" --pr 42 --worktree "$TMP/gone-worktree" --card C1 --verdict-out >/dev/null 2>&1 )
code9=$?
set -e
check "valueless --verdict-out (no following value) -> setup error, exit 2 (not an unbound-variable crash)" "$code9" "2"

# --- resolve-verify-shipped.sh: the skill resolves its own script path (FU-CS-4) ---

if [[ -x "$RESOLVER" ]]; then
  # Tier 1: CLAUDE_PLUGIN_ROOT points at the real plugin root.
  set +e
  out_t1="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$RESOLVER" 2>"$TMP/resolver-err-t1")"
  rc_t1=$?
  set -e
  check "resolver: CLAUDE_PLUGIN_ROOT set -> exit 0" "$rc_t1" "0"
  case "$out_t1" in
    /*) ok "resolver: CLAUDE_PLUGIN_ROOT set -> absolute path" ;;
    *)  bad "resolver: CLAUDE_PLUGIN_ROOT set -> absolute path (got: $out_t1)" ;;
  esac
  check "resolver: CLAUDE_PLUGIN_ROOT set -> resolved path exists" "$([[ -f "$out_t1" ]] && echo yes || echo no)" "yes"

  # Tier 2: CLAUDE_PLUGIN_ROOT unset, resolver locates itself.
  set +e
  out_unset="$(env -u CLAUDE_PLUGIN_ROOT bash "$RESOLVER" 2>"$TMP/resolver-err-unset")"
  rc_unset=$?
  set -e
  check "resolver: CLAUDE_PLUGIN_ROOT unset -> exit 0" "$rc_unset" "0"
  check "resolver: CLAUDE_PLUGIN_ROOT unset -> resolved path exists" "$([[ -f "$out_unset" ]] && echo yes || echo no)" "yes"

  # A stale/foreign CLAUDE_PLUGIN_ROOT must fall through to tier 2, not win on presence alone.
  set +e
  out_stale="$(CLAUDE_PLUGIN_ROOT="$TMP/not-a-plugin-root" bash "$RESOLVER" 2>"$TMP/resolver-err-stale")"
  rc_stale=$?
  set -e
  check "resolver: stale CLAUDE_PLUGIN_ROOT falls through -> exit 0" "$rc_stale" "0"
  check "resolver: stale CLAUDE_PLUGIN_ROOT falls through -> resolved path exists" \
    "$([[ -f "$out_stale" ]] && echo yes || echo no)" "yes"

  # Genuine failure: the resolver copied somewhere its target script does not exist alongside it.
  BROKEN="$TMP/broken-skill"; mkdir -p "$BROKEN"
  cp "$RESOLVER" "$BROKEN/resolve-verify-shipped.sh"   # no scripts/verify-shipped.sh beside it
  set +e
  out_broken="$(env -u CLAUDE_PLUGIN_ROOT bash "$BROKEN/resolve-verify-shipped.sh" 2>"$TMP/resolver-err-broken")"
  rc_broken=$?
  set -e
  check "resolver: genuine failure -> exit 3" "$rc_broken" "3"
  check "resolver: genuine failure -> nothing on stdout" "$out_broken" ""
  contains "resolver: genuine failure -> named diagnostic on stderr" "$(cat "$TMP/resolver-err-broken")" "verify-shipped"
else
  bad "resolve-verify-shipped.sh exists and is executable (missing: $RESOLVER)"
fi

check "SKILL.md no longer references ~/.claude/skills/verify-shipped" \
  "$(grep -c '~/\.claude/skills/verify-shipped' "$SKILL_MD" 2>/dev/null || true)" "0"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
exit $((FAIL > 0))
