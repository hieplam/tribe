#!/usr/bin/env bash
# test-runner-done-empty.sh — G5 (card runner-driver-only, spec §6.4): an empty session (do-nothing)
# and a lying one (premature-shipped) never ship; both escalate done_failed.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-runner-e2e.sh"
rdo_world sum.md <<'EOF'
# Plan — mathx.Sum

### Task 1: `mathx.Sum`

#### Done

```bash
test -f mathx/sum.go
grep -q 'func TestSum' mathx/sum_test.go
```
EOF
for mode in do-nothing premature-shipped; do
  HOME_DIR="$TMP/home-$mode"
  rdo_home "$HOME_DIR" sum.md 'Task 1: `mathx.Sum`'
  set +e
  TRIBE_RUNNER_SESSION_DOUBLE="$DOUBLE" DOUBLE_MODE="$mode" DOUBLE_REPO="$TMP/repo" DOUBLE_BRANCH="double/$mode" DOUBLE_LOG="$TMP/double-$mode.log" \
    bounded bun "$RUNNER/run.ts" --repo "$TMP/repo" --model double --home "$HOME_DIR" --no-viewer > "$TMP/runner-$mode.out" 2>&1
  code=$?
  set -e
  check "G5 $mode: runner exits 2" "$code" "2"
  check "G5 $mode: escalated done_failed" "$(sed -n 's/^\*\*Reason:\*\* //p' "$HOME_DIR/escalations/C1.md" 2>/dev/null)" "done_failed"
  check "G5 $mode: never shipped" "$(rdo_card "$HOME_DIR" 'c["status"]')" "escalated"
  check "G5 $mode: no doneSha" "$(rdo_card "$HOME_DIR" '"doneSha" in c')" "False"
done
check "G5 do-nothing: the Done commands ran and failed three times" "$(rdo_done_runs "$TMP/home-do-nothing")" "3 3"
check "G5 premature-shipped: no Done run at all (no task was ever reported)" "$(rdo_done_runs "$TMP/home-premature-shipped")" "0 0"
check "G5 premature-shipped: the escalation names the early SHIPPED" "$(grep -c 'SHIPPED arrived before every task passed' "$TMP/home-premature-shipped/escalations/C1.md")" "1"
rdo_finish G5
