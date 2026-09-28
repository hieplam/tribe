#!/usr/bin/env bash
# Executor session double (card runner-driver-only, spec §4.12). Reads the runner's prompt, acts on
# DOUBLE_REPO according to DOUBLE_MODE, prints ONE terminal line. Env: DOUBLE_MODE (do-nothing |
# premature-shipped | implement), DOUBLE_REPO, DOUBLE_BRANCH, DOUBLE_LOG (optional turn log).
set -euo pipefail
prompt_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file) prompt_file="$2"; shift 2 ;;
    --home) shift 2 ;;
    --card) shift 2 ;;
    *) shift ;;
  esac
done
[[ -f "$prompt_file" ]] || { echo "session-double: --prompt-file missing" >&2; exit 2; }
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
task="$(sed -n 's/^## This turn: task \([^ ]*\).*/\1/p' "$prompt_file" | head -1)"
printf 'turn task=%s mode=%s\n' "${task:-deliver}" "$DOUBLE_MODE" >> "${DOUBLE_LOG:-/dev/null}"
g() { git -C "$1" -c user.name=double -c user.email=double@invalid "${@:2}"; }
case "$DOUBLE_MODE" in
  do-nothing)
    g "$DOUBLE_REPO" rev-parse --verify --quiet "refs/heads/$DOUBLE_BRANCH" >/dev/null || g "$DOUBLE_REPO" branch "$DOUBLE_BRANCH" HEAD
    echo "TASK_DONE ${task:-T1} $DOUBLE_BRANCH" ;;
  premature-shipped)
    echo "SHIPPED 1 0000000" ;;
  implement)
    wt="$DOUBLE_REPO.double-wt"
    [[ -d "$wt" ]] || g "$DOUBLE_REPO" worktree add -q -b "$DOUBLE_BRANCH" "$wt" HEAD
    mkdir -p "$wt/mathx"
    printf 'package mathx\n\n// Double returns 2*x.\nfunc Double(x int) int { return 2 * x }\n' > "$wt/mathx/double.go"
    printf 'package mathx\n\nimport "testing"\n\nfunc TestDouble(t *testing.T) {\n\tif Double(3) != 6 {\n\t\tt.Fatal("Double(3) != 6")\n\t}\n}\n' > "$wt/mathx/double_test.go"
    g "$wt" add -A
    g "$wt" commit -q -m "feat(mathx): Double" >/dev/null 2>&1 || true   # a later turn has nothing new to commit; stdout carries only the terminal line
    echo "TASK_DONE ${task:-T1} $DOUBLE_BRANCH" ;;
  *) echo "session-double: unknown DOUBLE_MODE=${DOUBLE_MODE:-}" >&2; exit 2 ;;
esac
