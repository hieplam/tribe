#!/usr/bin/env bash
# test-runner-done-negative.sh — V3 (card runner-driver-only, spec §6.4): a task whose Done command
# fails is never marked done, and the card escalates done_failed. The executor double (`implement`)
# writes a real mathx.Double + TestDouble; the plan's Done demands a TestTriple no task writes.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-runner-e2e.sh"
rdo_world double.md <<'EOF'
# Plan — mathx.Double

### Task 1: `mathx.Double`

Write `mathx/double.go` and its test.

#### Done

```bash
test -f mathx/double.go
grep -q 'func TestTriple' mathx/double_test.go
```
EOF
HOME_DIR="$TMP/home"
rdo_home "$HOME_DIR" double.md 'Task 1: `mathx.Double`'
set +e
TRIBE_RUNNER_SESSION_DOUBLE="$DOUBLE" DOUBLE_MODE=implement DOUBLE_REPO="$TMP/repo" DOUBLE_BRANCH=double/C1 DOUBLE_LOG="$TMP/double.log" \
  bounded bun "$RUNNER/run.ts" --repo "$TMP/repo" --model double --home "$HOME_DIR" --no-viewer > "$TMP/runner.out" 2>&1
code=$?
set -e
check "V3: the runner exits 2 (an escalation is pending)" "$code" "2"
check "V3: the escalation reason is done_failed" "$(sed -n 's/^\*\*Reason:\*\* //p' "$HOME_DIR/escalations/C1.md" 2>/dev/null)" "done_failed"
check "V3: the card is escalated, never shipped" "$(rdo_card "$HOME_DIR" 'c["status"]')" "escalated"
check "V3: T1 carries no passedSha" "$(rdo_card "$HOME_DIR" '"passedSha" in c["tasks"][0]')" "False"
check "V3: the card carries no doneSha" "$(rdo_card "$HOME_DIR" '"doneSha" in c')" "False"
check "V3: three Done runs, all failed" "$(rdo_done_runs "$HOME_DIR")" "3 3"
check "V3: the failing command ran in the runner's hands and exited non-zero" \
  "$(cat "$HOME_DIR"/runs/*/done.jsonl | python3 -c 'import json,sys; r=[json.loads(l) for l in sys.stdin if l.strip()]; g=[x for x in r if x["kind"]=="command" and x["command"].startswith("grep -q")]; print(len(g)==3 and all(x["exitCode"]!=0 for x in g))')" "True"
check "V3: the double was asked for T1 three times" "$(grep -c 'turn task=T1' "$TMP/double.log")" "3"
check "V3: nothing but master reached the origin" "$(git -C "$TMP/origin.git" for-each-ref --format='%(refname)' refs/heads | tr '\n' ' ')" "refs/heads/master "
if [[ -n "${RDO_EVIDENCE_DIR:-}" ]]; then
  cp "$HOME_DIR/escalations/C1.md" "$RDO_EVIDENCE_DIR/v3-escalation.md"
  cat "$HOME_DIR"/runs/*/done.jsonl > "$RDO_EVIDENCE_DIR/v3-done.jsonl"
  cp "$HOME_DIR/campaign-state.json" "$RDO_EVIDENCE_DIR/v3-final-state.json"
  cp "$TMP/runner.out" "$RDO_EVIDENCE_DIR/v3-runner.out"
fi
rdo_finish V3
