#!/usr/bin/env bash
# test-verify-shipped.sh — fixture tests for verify-shipped.sh (synthetic git repo, stubbed gh,
# fully offline). Card C1: the fourth check, gap_gate_stamped.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../../skills/verify-shipped/scripts/verify-shipped.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
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

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
exit $((FAIL > 0))
