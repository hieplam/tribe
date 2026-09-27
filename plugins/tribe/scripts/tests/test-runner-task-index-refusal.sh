#!/usr/bin/env bash
# test-runner-task-index-refusal.sh — V6 (card runner-driver-only, spec §6.4): a state whose task ref
# names a heading the plan does not have is refused at load — by --dry-run and by a real run — before
# any session spawns, and nothing is written into the state.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-runner-e2e.sh"
rdo_world sum.md <<'EOF'
# Plan — mathx.Sum

### Task 1: `mathx.Sum`

#### Done

```bash
test -f mathx/sum.go
```
EOF
HOME_DIR="$TMP/home"
rdo_home "$HOME_DIR" sum.md 'Task 9: nowhere'
printf '#!/usr/bin/env bash\ntouch "%s/SPAWNED"\necho "TASK_DONE T1 x"\n' "$TMP" > "$TMP/marker-double.sh"
chmod +x "$TMP/marker-double.sh"
before="$(shasum "$HOME_DIR/campaign-state.json")"
for flag in --dry-run --real-run; do
  args=(); [[ "$flag" == "--dry-run" ]] && args=(--dry-run)
  set +e
  TRIBE_RUNNER_SESSION_DOUBLE="$TMP/marker-double.sh" bounded bun "$RUNNER/run.ts" --repo "$TMP/repo" --model double --home "$HOME_DIR" --no-viewer ${args[@]+"${args[@]}"} > "$TMP/out" 2> "$TMP/err"
  code=$?
  set -e
  check "V6 $flag: exit 4" "$code" "4"
  for needle in 'campaign runner: refused:' 'card C1' 'task T1' 'Task 9: nowhere' 'dangling_heading'; do
    check "V6 $flag: stderr names '$needle'" "$(grep -c -- "$needle" "$TMP/err")" "1"
  done
  if [[ -n "${RDO_EVIDENCE_DIR:-}" ]]; then cp "$TMP/err" "$RDO_EVIDENCE_DIR/v6-refusal${flag}.txt"; fi
done
check "V6: no session was ever spawned" "$([[ -e "$TMP/SPAWNED" ]] && echo yes || echo no)" "no"
check "V6: the state file is byte-identical" "$(shasum "$HOME_DIR/campaign-state.json")" "$before"
check "V6: no escalation was written" "$(ls "$HOME_DIR/escalations" 2>/dev/null | wc -l | tr -d ' ')" "0"
rdo_finish V6
