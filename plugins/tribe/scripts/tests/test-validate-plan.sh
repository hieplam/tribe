#!/usr/bin/env bash
# test-validate-plan.sh — fixture tests for validate-plan.sh (offline, no network).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../validate-plan.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { # check NAME ACTUAL WANT
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi
}
jget() { # jget FILE DOTTED.PATH — prints the value, or MISSING
  python3 - "$1" "$2" <<'EOF'
import json, sys
try:
    o = json.load(open(sys.argv[1]))
    for k in sys.argv[2].split("."):
        o = o[int(k)] if isinstance(o, list) else o[k]
    print(str(o).lower() if isinstance(o, bool) else o)
except (KeyError, IndexError, ValueError):
    print("MISSING")
EOF
}
find_check() { # find_check FILE CHECK_NAME — prints that check's status, or MISSING
  python3 - "$1" "$2" <<'EOF'
import json, sys
data = json.load(open(sys.argv[1]))
for c in data.get("checks", []):
    if c["name"] == sys.argv[2]:
        print(c["status"]); break
else:
    print("MISSING")
EOF
}

# block_of MODE — the mode's block, read from the one definition (shaman.md "Ways of work"),
# the way a plan author copies it. Fixtures copy it rather than restating it.
block_of() {
  python3 - "$HERE/../../agents/shaman.md" "$1" <<'EOF'
import re, sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
start = next(i for i, l in enumerate(lines) if l == "## Ways of work")
end = next((i for i in range(start + 1, len(lines)) if re.match(r"^#{1,2} ", lines[i])), len(lines))
text = "\n".join(lines[start:end])
for body in re.findall(r"^```markdown\n(.*?)^```$", text, re.S | re.M):
    if body.startswith(f"Executor: {sys.argv[2]}\n"):
        print(body.rstrip("\n"))
        break
else:
    sys.exit(f"no block for {sys.argv[2]}")
EOF
}

good_plan_header() {
  printf '# Fixture Plan\n\n## Global Constraints\n\n- Implementer: dispatch each implementation/fix task to the hunter subagent.\n\n## Way of work\n\n'
  block_of subagent-per-task
  printf '\n'
}

# tribe_plan_header — the one mode with no final review task: its plans may hold a single task.
tribe_plan_header() {
  printf '# Fixture Plan\n\n## Global Constraints\n\n- Implementer: dispatch each implementation/fix task to the hunter subagent.\n\n## Way of work\n\n'
  block_of tribe
  printf '\n'
}

# A complete Verify block: the goal it proves, a Red and a Green that each carry a
# literal command, and why a stub fails it.
verify_block() {
  cat <<'EOF'
#### Verify
- Goal: G1 (the fixture goal).
- Red: `bun test x.test.ts` before building -> `1 fail`.
- Green (expected): `bun test x.test.ts` -> `1 pass`, `0 fail`.
- Stub check: a stub returning nothing fails the `toEqual` assertion.

EOF
}

# review_task N — the light modes' last task, "Task N: Final review", complete.
review_task() {
  printf '### Task %s: Final review\n\n' "$1"; verify_block
  printf '#### Done\n\n```bash\ntrue\n```\n\n- [ ] **Step 2: Commit**\n\n```bash\ngit commit --allow-empty -m "review: pass"\n```\n\n'
}

# fixture: a task that QUOTES a whole file containing a fenced plan — the quoted
# heading, inner fences, and angle tokens are content, not plan structure
F0="$TMP/fenced.md"
{ tribe_plan_header; cat <<'EOF'
### Task 1: Real task quoting a whole test file

- [ ] **Step 1: Write the failing test**

````markdown
### Task 9: Phantom — this heading is quoted content, not a real task

```bash
echo "an <angle-token> stays inside the fence"
```
````

Expected: the quoted file is written verbatim

#### Verify
- Goal: G1.
- Red: `bun test fenced.test.ts` -> `1 fail`.
- Green: `bun test fenced.test.ts` -> `1 pass`.
- Stub check: an empty file fails the verbatim comparison.

#### Done

```bash
bun test fenced.test.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: fenced"
```
EOF
} > "$F0"
bash "$SCRIPT" "$F0" > "$TMP/out0.json"
check "quoted headings are not tasks" "$(jget "$TMP/out0.json" task_count)" "1"
check "fenced angle tokens are not placeholders" "$(find_check "$TMP/out0.json" no_placeholders)" "pass"
check "fenced fixture verdict is pass" "$(jget "$TMP/out0.json" verdict)" "pass"

# fixture: one task, exactly one commit step -> pass
F1="$TMP/single.md"
{ good_plan_header; cat <<'EOF'
### Task 1: One unit

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: one"
```
EOF
} > "$F1"
bash "$SCRIPT" "$F1" > "$TMP/out1.json"
check "single commit step passes" "$(find_check "$TMP/out1.json" tasks_single_commit_step)" "pass"

# fixture: one task with two commit steps -> fail
F2="$TMP/double.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Two units glued together

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: part one"
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: part two"
```
EOF
} > "$F2"
bash "$SCRIPT" "$F2" > "$TMP/out2.json"
check "two commit steps fail" "$(find_check "$TMP/out2.json" tasks_single_commit_step)" "fail"

# fixture: one task with no commit step -> fail
F3="$TMP/none.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Never lands

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL
EOF
} > "$F3"
bash "$SCRIPT" "$F3" > "$TMP/out3.json"
check "zero commit steps fail" "$(find_check "$TMP/out3.json" tasks_single_commit_step)" "fail"

# fixture: one task whose only commit-like step is "Commit and push" -> fail
# (the step title must BE "Commit", not merely start with it)
F4="$TMP/commit-and-push.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Never lands either

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- [ ] **Step 2: Commit and push**

```bash
git commit -m "feat: never lands" && git push
```
EOF
} > "$F4"
bash "$SCRIPT" "$F4" > "$TMP/out4.json"
check "commit-and-push does not count" "$(find_check "$TMP/out4.json" tasks_single_commit_step)" "fail"

# --- P9: --schema-lock-paths (schema-lock opt-outs validated at authoring) ---

LOCK_PATH="packages/app/src/ports.ts"

# fixture: task line touching the lock path, no front-matter -> fail, non-zero exit,
# message names the plan, the matched task line, and the fix (ruling UC-3).
F5="$TMP/lock-no-frontmatter.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Touches the locked port surface

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- Modify: packages/app/src/ports.ts

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: touch ports"
```
EOF
} > "$F5"
set +e
out5="$(bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F5" 2>&1)"
code5=$?
set -e
check "lock path + no front-matter: non-zero exit" "$code5" "1"
if [[ "$out5" == *"$F5"* && "$out5" == *"Modify: packages/app/src/ports.ts"* \
      && "$out5" == *"allowsSchemaChange: true"* && "$out5" == *"UC-3"* ]]; then
  ok "lock path + no front-matter: message names plan, task line, and fix"
else
  bad "lock path + no front-matter: message names plan, task line, and fix (got: $out5)"
fi

# fixture: task line touching the lock path, backtick-wrapped (this repo's own
# writing-plans convention: "- Modify: `path/to/file.ts`"), no front-matter -> fail,
# non-zero exit. A bare-path-only pattern would miss this real-world form entirely.
F5B="$TMP/lock-backtick.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Touches the locked port surface, backtick-wrapped

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- Modify: `packages/app/src/ports.ts`

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: touch ports"
```
EOF
} > "$F5B"
set +e
out5b="$(bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F5B" 2>&1)"
code5b=$?
set -e
check "backtick-wrapped lock path + no front-matter: non-zero exit" "$code5b" "1"

# fixture: task line touching the lock path, backtick-wrapped WITH a trailing
# ":line-range" suffix inside the backticks ("- Modify: `path.ts:12-34`"), no
# front-matter -> fail, non-zero exit.
F5C="$TMP/lock-backtick-linerange.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Touches the locked port surface, backtick-wrapped with line range

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- Modify: `packages/app/src/ports.ts:12-34`

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: touch ports"
```
EOF
} > "$F5C"
set +e
out5c="$(bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F5C" 2>&1)"
code5c=$?
set -e
check "backtick-wrapped + line-range lock path + no front-matter: non-zero exit" "$code5c" "1"

# fixture: task line touching the lock path, plain (no backticks) WITH a trailing
# parenthetical note ("- Modify: path.ts (replace the parse loop)"), no front-matter ->
# fail, non-zero exit.
F5D="$TMP/lock-parenthetical.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Touches the locked port surface, with a trailing note

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- Modify: packages/app/src/ports.ts (replace the parse loop)

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: touch ports"
```
EOF
} > "$F5D"
set +e
out5d="$(bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F5D" 2>&1)"
code5d=$?
set -e
check "plain lock path + trailing parenthetical + no front-matter: non-zero exit" "$code5d" "1"

# fixture: the schema-lock-violation exit path (exit 1) must still print the FULL JSON
# summary to stdout, per the script's own documented output contract ("prints a JSON
# summary on stdout (only). Logs go to stderr.") — capture stdout and stderr SEPARATELY
# (not merged with 2>&1) so a regression that exits before the print cannot hide behind
# a test that only checks the combined stream.
F5E_OUT="$TMP/f5e.stdout"
F5E_ERR="$TMP/f5e.stderr"
set +e
bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F5" >"$F5E_OUT" 2>"$F5E_ERR"
code5e=$?
set -e
check "lock violation: non-zero exit" "$code5e" "1"
stdout_bytes="$(wc -c < "$F5E_OUT" | tr -d ' ')"
if [[ "$stdout_bytes" -gt 0 ]] && python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$F5E_OUT" >/dev/null 2>&1; then
  ok "lock violation: full JSON summary still printed to stdout"
else
  bad "lock violation: full JSON summary still printed to stdout (stdout bytes: $stdout_bytes)"
fi
check "lock violation: JSON summary's schema_lock_declared check recorded as fail" \
  "$(find_check "$F5E_OUT" schema_lock_declared)" "fail"
if [[ -s "$F5E_ERR" ]]; then
  ok "lock violation: error message present on stderr"
else
  bad "lock violation: error message present on stderr"
fi

# fixture: task line touching the lock path, WITH allowsSchemaChange: true front-matter -> pass
F6="$TMP/lock-with-frontmatter.md"
cat <<'EOF' > "$F6"
---
allowsSchemaChange: true
---

# Fixture Plan

## Global Constraints

- Implementer: dispatch each implementation/fix task to the hunter subagent.

### Task 1: Touches the locked port surface, declared

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- Modify: packages/app/src/ports.ts

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: touch ports, declared"
```
EOF
set +e
out6="$(bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F6" 2>&1)"
code6=$?
set -e
check "lock path + allowsSchemaChange: true: zero exit" "$code6" "0"

# fixture: only a PROSE mention of the lock path (no task line) -> pass, no front-matter needed
F7="$TMP/lock-prose-only.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Discusses but does not touch the locked port surface

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL. Note: packages/app/src/ports.ts is the interface this task exercises,
but this task does not modify it.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: prose mention only"
```
EOF
} > "$F7"
set +e
out7="$(bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F7" 2>&1)"
code7=$?
set -e
check "prose-only mention: zero exit" "$code7" "0"

# fixture: same task-line-touching-lock-path plan as F5, but with NO --schema-lock-paths flag
# at all -> check is skipped entirely (legacy invocations unaffected)
set +e
out8="$(bash "$SCRIPT" "$F5" 2>&1)"
code8=$?
set -e
check "no --schema-lock-paths flag: legacy invocation unaffected (zero exit)" "$code8" "0"

# fixture: EXACT-path rule — the lock path packages/app/src/ports.ts must NOT be tripped by
# a task line touching packages/app/src/ports.test.ts (a longer path that merely contains the
# lock path as a substring of its name, not the same path).
F9="$TMP/lock-exact-path.md"
{ good_plan_header; cat <<'EOF'
### Task 1: Touches only the test file, not the locked port surface

- [ ] **Step 1: Write the failing test**

```bash
echo test
```

Expected: FAIL

- Modify: packages/app/src/ports.test.ts

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: touch ports test file only"
```
EOF
} > "$F9"
set +e
out9="$(bash "$SCRIPT" --schema-lock-paths "$LOCK_PATH" "$F9" 2>&1)"
code9=$?
set -e
check "exact-path rule: ports.test.ts does not trip ports.ts lock (zero exit)" "$code9" "0"

# --- Per-task Verify block (Goal · Red · Green · Stub check) ---------------------------
# Oracle: every task carries all four labels outside fences; Red and Green each carry a
# literal command (inline code or a fenced block). "Red: not applicable" + a reason is
# allowed for a task with no code to go red (a baseline measurement).
task_with() { # task_with N BODY-FILE — one task section whose body is the file's content
  printf '### Task %s: Unit %s\n\n' "$1" "$1"; cat "$2"
  printf '\n#### Done\n\n```bash\ntrue\n```\n'
  printf '\n- [ ] **Step 2: Commit**\n\n```bash\ngit commit -m "feat: %s"\n```\n\n' "$1"
}
verify_block > "$TMP/vb.md"

VF1="$TMP/verify-ok.md"
{ good_plan_header; task_with 1 "$TMP/vb.md"; review_task 2; } > "$VF1"
bash "$SCRIPT" "$VF1" > "$TMP/vo1.json"
check "complete Verify block passes" "$(find_check "$TMP/vo1.json" tasks_have_verify_block)" "pass"
check "complete plan verdict is pass" "$(jget "$TMP/vo1.json" verdict)" "pass"

# The shape that slipped through on 2026-09-28: a shared suite line, no Verify block.
printf 'Expected: check command green.\n\n```bash\nbun test\n```\n' > "$TMP/shared.md"
VF2="$TMP/verify-shared.md"
{ good_plan_header; task_with 1 "$TMP/shared.md"; } > "$VF2"
bash "$SCRIPT" "$VF2" > "$TMP/vo2.json"
check "shared 'check command green' line fails" "$(find_check "$TMP/vo2.json" tasks_have_verify_block)" "fail"
check "shared-line plan verdict is fail" "$(jget "$TMP/vo2.json" verdict)" "fail"

# All four labels present, but Green names no command or output.
cat > "$TMP/prose-green.md" <<'EOF'
#### Verify
- Goal: G1.
- Red: `bun test x.test.ts` -> `1 fail`.
- Green: check command green, new tests pass.
- Stub check: a stub fails it.
EOF
VF3="$TMP/verify-prose-green.md"
{ good_plan_header; task_with 1 "$TMP/prose-green.md"; } > "$VF3"
bash "$SCRIPT" "$VF3" > "$TMP/vo3.json"
check "Green with no literal command fails" "$(find_check "$TMP/vo3.json" tasks_have_verify_block)" "fail"

# Green's literal may sit in a fenced block under the label.
cat > "$TMP/fenced-green.md" <<'EOF'
#### Verify
- Goal: G1.
- Red: not applicable, this task only records the baseline.
- Green:
  ```bash
  tribe campaign status; echo "exit=$?"
  ```
- Stub check: an empty baseline file leaves no before value.
EOF
VF4="$TMP/verify-fenced-green.md"
{ good_plan_header; task_with 1 "$TMP/fenced-green.md"; } > "$VF4"
bash "$SCRIPT" "$VF4" > "$TMP/vo4.json"
check "fenced Green + Red not applicable passes" "$(find_check "$TMP/vo4.json" tasks_have_verify_block)" "pass"

# A Verify block quoted inside a fence is content, not this task's Verify.
{ printf '````markdown\n'; cat "$TMP/vb.md"; printf '````\n'; } > "$TMP/quoted-vb.md"
VF5="$TMP/verify-quoted.md"
{ good_plan_header; task_with 1 "$TMP/quoted-vb.md"; } > "$VF5"
bash "$SCRIPT" "$VF5" > "$TMP/vo5.json"
check "Verify labels inside a fence do not count" "$(find_check "$TMP/vo5.json" tasks_have_verify_block)" "fail"

# One good task and one bare task: the bare one is named.
VF6="$TMP/verify-mixed.md"
{ good_plan_header; task_with 1 "$TMP/vb.md"; task_with 2 "$TMP/shared.md"; } > "$VF6"
bash "$SCRIPT" "$VF6" > "$TMP/vo6.json"
check "one bare task fails the plan" "$(find_check "$TMP/vo6.json" tasks_have_verify_block)" "fail"
check "the bare task is named" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print([c['detail'] for c in d['checks'] if c['name']=='tasks_have_verify_block'][0].count('Unit 2'))" "$TMP/vo6.json")" "1"

# --- Way of work: the Executor line, and the single-agent task limit -----------------------
bare_header() { printf '# Fixture Plan\n\n## Global Constraints\n\n- Implementer: the hunter subagent.\n\n'; }

WF1="$TMP/wow-missing.md"
{ bare_header; task_with 1 "$TMP/vb.md"; } > "$WF1"
bash "$SCRIPT" "$WF1" > "$TMP/wo1.json"
check "no Way of work section fails" "$(find_check "$TMP/wo1.json" way_of_work_declared)" "fail"

WF2="$TMP/wow-no-executor.md"
{ bare_header; printf '## Way of work\n\nImplement until checks pass, one review, PR, merge.\n\n'; task_with 1 "$TMP/vb.md"; } > "$WF2"
bash "$SCRIPT" "$WF2" > "$TMP/wo2.json"
check "Way of work with no Executor line fails" "$(find_check "$TMP/wo2.json" way_of_work_declared)" "fail"

WF3="$TMP/wow-single-3.md"
{ bare_header; printf '## Way of work\n\nExecutor: single-agent\n\n'; for n in 1 2 3; do task_with "$n" "$TMP/vb.md"; done; } > "$WF3"
bash "$SCRIPT" "$WF3" > "$TMP/wo3.json"
check "single-agent is declared" "$(find_check "$TMP/wo3.json" way_of_work_declared)" "pass"
check "single-agent with 3 tasks fails" "$(find_check "$TMP/wo3.json" single_agent_within_limit)" "fail"

WF4="$TMP/wow-single-2.md"
{ bare_header; printf '## Way of work\n\nExecutor: single-agent\n\n'; for n in 1 2; do task_with "$n" "$TMP/vb.md"; done; } > "$WF4"
bash "$SCRIPT" "$WF4" > "$TMP/wo4.json"
check "single-agent with 2 tasks passes" "$(find_check "$TMP/wo4.json" single_agent_within_limit)" "pass"

WF5="$TMP/wow-subagent-3.md"
{ bare_header; printf '## Way of work (quoted from the card)\n\n- **Executor:** `subagent-per-task`\n\n'; for n in 1 2 3; do task_with "$n" "$TMP/vb.md"; done; } > "$WF5"
bash "$SCRIPT" "$WF5" > "$TMP/wo5.json"
check "subagent-per-task (formatted) is declared" "$(find_check "$TMP/wo5.json" way_of_work_declared)" "pass"
check "subagent-per-task with 3 tasks passes" "$(find_check "$TMP/wo5.json" single_agent_within_limit)" "pass"

# --- Review round 1 (gpt-6-sol): each over- or under-check it found, pinned --------------
probe() { # probe NAME CHECK WANT BODY-FILE [HEADER-FN]
  local f="$TMP/probe-$RANDOM.md"
  { "${5:-good_plan_header}"; task_with 1 "$4"; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$1" "$(find_check "$f.json" "$2")" "$3"
}
printf -- '- Goal: G1.\n- Red: `bun test x` -> `1 fail`.\n- Green: `bun test x` -> `1 pass`.\n- Stub check: a stub fails.\n' > "$TMP/r1-scattered.md"
probe "labels with no Verify heading fail" tasks_have_verify_block fail "$TMP/r1-scattered.md"
printf '#### Verify\n- Goal: G1.\n- Red: `1 fail`.\n- Green: `1 pass`.\n- Stub check: a stub fails.\n' > "$TMP/r1-output-only.md"
probe "output-only code spans are not commands" tasks_have_verify_block fail "$TMP/r1-output-only.md"
printf '#### Verify\n- Goal: G1.\n- Red: not applicable.\n- Green: `bun test x` -> `1 pass`.\n- Stub check: a stub fails.\n' > "$TMP/r1-na-bare.md"
probe "Red 'not applicable' with no reason fails" tasks_have_verify_block fail "$TMP/r1-na-bare.md"
printf '#### Verify\n1. Goal: G1.\n2. Red: `bun test x` -> `1 fail`.\n3. Green: `bun test x` -> `1 pass`.\n4. Stub check: a stub fails.\n' > "$TMP/r1-numbered.md"
probe "numbered-list Verify block passes" tasks_have_verify_block pass "$TMP/r1-numbered.md"
not_wow_header() { printf '# P\n\n## Global Constraints\n\n- the hunter subagent.\n\n## Not the way of work\n\nExecutor: subagent-per-task\n\n'; }
probe "a heading merely containing 'way of work' does not count" way_of_work_declared fail "$TMP/vb.md" not_wow_header
bad_exec_header() { printf '# P\n\n## Global Constraints\n\n- the hunter subagent.\n\n## Way of work\n\nExecutor: single-agent-per-task\n\n'; }
probe "a longer executor value is not single-agent" way_of_work_declared fail "$TMP/vb.md" bad_exec_header

# --- Review round 2 (gpt-6-sol): owner ruled fix these two, then merge -------------------
printf '#### Verify\n- Goal: G1.\n- Red: `pytest` -> `1 failed`.\n- Green: `pytest` -> `1 passed`.\n- Stub check: a stub fails.\n' > "$TMP/r2-one-word.md"
probe "a one-word command counts" tasks_have_verify_block pass "$TMP/r2-one-word.md"
printf '#### Verify\n- Goal: G1.\n- Red:\n  ```text\n  1 failed\n  ```\n- Green:\n  ```output\n  1 passed\n  ```\n- Stub check: a stub fails.\n' > "$TMP/r2-output-fence.md"
probe "text/output fences are not commands" tasks_have_verify_block fail "$TMP/r2-output-fence.md"

# --- The third mode, and the Hunter line only a tribe plan needs --------------------------
tribe_header() { printf '# P\n\n## Global Constraints\n\n- Implementer: dispatch each implementation/fix task to the `hunter` subagent.\n\n## Way of work\n\nExecutor: tribe\n\n'; }
probe "Executor: tribe is declared" way_of_work_declared pass "$TMP/vb.md" tribe_header
tribe_lite_header() { printf '# P\n\n## Global Constraints\n\n- the hunter subagent.\n\n## Way of work\n\nExecutor: tribe-lite\n\n'; }
probe "a longer value is not tribe" way_of_work_declared fail "$TMP/vb.md" tribe_lite_header
no_hunter_subagent_header() { printf '# P\n\n## Global Constraints\n\n- Each task goes to one fresh general-purpose subagent.\n\n## Way of work\n\nExecutor: subagent-per-task\n\n'; }
probe "a subagent-per-task plan need not name the Hunter" hunter_named_as_implementer pass "$TMP/vb.md" no_hunter_subagent_header
no_hunter_tribe_header() { printf '# P\n\n## Global Constraints\n\n- Each task goes to one fresh general-purpose subagent.\n\n## Way of work\n\nExecutor: tribe\n\n'; }
probe "a tribe plan must name the Hunter" hunter_named_as_implementer fail "$TMP/vb.md" no_hunter_tribe_header

# --- The campaign runner's Done section (runner/core/plan-index.ts is the oracle) ----------
done_probe() { # done_probe NAME WANT-STATUS WANT-PROBLEM DONE-PART — one task: Verify block, then DONE-PART, then Commit
  local f="$TMP/done-$RANDOM.md"
  { good_plan_header; printf '### Task 1: Unit 1\n\n'; cat "$TMP/vb.md"; printf '%s\n' "$4"
    printf '\n- [ ] **Step 2: Commit**\n\n```bash\ngit commit -m "feat: 1"\n```\n'; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$1" "$(find_check "$f.json" tasks_have_done_block)" "$2"
  if [[ -n "$3" ]]; then
    check "$1 — names $3" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print([c['detail'] for c in d['checks'] if c['name']=='tasks_have_done_block'][0].count(sys.argv[2]))" "$f.json" "$3")" "1"
  fi
}
done_probe "a Done section with one command passes" pass "" $'#### Done\n\n```bash\ntrue\n```'
done_probe "a task with no Done section fails" fail missing_done ''
done_probe "a Done block holding only comments fails" fail empty_done $'#### Done\n\n```bash\n# nothing to run\n```'
done_probe "a Done command continued with a backslash fails" fail continuation_not_supported $'#### Done\n\n```bash\nbun test \\\n  x.test.ts\n```'
done_probe "two Done headings in one task fail" fail ambiguous_done $'#### Done\n\n```bash\ntrue\n```\n\n#### Done\n\n```bash\ntrue\n```'
done_probe "a Done heading at the task's own level is not the task's Done" fail missing_done $'### Done\n\n```bash\ntrue\n```'
# Stricter than the runner, by design: a Done heading with no fence of its own would hand the
# runner the Commit step's `git commit` fence as the task's Done commands.
done_probe "a Done heading whose first fence is the Commit step's fails" fail done_block_after_a_step $'#### Done\n\nRun the tests.'
# The runner's own refusals, with the Done section last in the task so no later fence is near.
done_tail_probe() { # done_tail_probe NAME WANT-PROBLEM DONE-PART — Done after the Commit step, at the end of the file
  local f="$TMP/done-tail-$RANDOM.md"
  { good_plan_header; printf '### Task 1: Unit 1\n\n'; cat "$TMP/vb.md"
    printf -- '- [ ] **Step 2: Commit**\n\n```bash\ngit commit -m "feat: 1"\n```\n\n%s\n' "$3"; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$1" "$(find_check "$f.json" tasks_have_done_block)" "fail"
  check "$1 — names $2" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print([c['detail'] for c in d['checks'] if c['name']=='tasks_have_done_block'][0].count(sys.argv[2]))" "$f.json" "$2")" "1"
}
done_tail_probe "a Done heading with no fenced block fails" missing_done_block $'#### Done\n\nRun the tests.'
done_tail_probe "a Done fence that never closes fails" unclosed_done_block $'#### Done\n\n```bash\ntrue'
done_tail_probe "a Done fence indented four spaces is not a fence to the runner" missing_done_block $'#### Done\n\n    ```bash\n    true\n    ```'

# --- The mode's block, copied from shaman.md "Ways of work" -------------------------------
wow_plan() { # wow_plan MODE HUNTER-LINE BLOCK-FILTER — a plan header whose Way of work copies MODE's block through BLOCK-FILTER
  printf '# P\n\n## Global Constraints\n\n- %s\n\n## Way of work\n\nReasons: the card records this mode.\n\n' "$2"
  block_of "$1" | eval "$3"; printf '\n'
}
HUNTER='Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic implementer.'
block_probe() { # block_probe NAME CHECK WANT PLAN-HEADER-ARGS...
  local f="$TMP/block-$RANDOM.md" name="$1" chk="$2" want="$3"; shift 3
  { wow_plan "$@"; task_with 1 "$TMP/vb.md"; review_task 2; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$name" "$(find_check "$f.json" "$chk")" "$want"
}
block_probe "the subagent-per-task block copied verbatim passes" mode_block_copied pass subagent-per-task "$HUNTER" cat
block_probe "one changed word in the copied block fails" mode_block_copied fail subagent-per-task "$HUNTER" "sed 's/in order/in any order/'"
block_probe "the Executor line alone, with no block, fails" mode_block_copied fail subagent-per-task "$HUNTER" "head -n 1"
block_probe "the single-agent block copied verbatim passes" mode_block_copied pass single-agent "$HUNTER" cat
block_probe "the tribe block copied verbatim passes" mode_block_copied pass tribe "$HUNTER" cat
block_probe "a tribe plan without its audit block fails" mode_block_copied fail tribe "$HUNTER" "head -n 1"
block_probe "another mode's block under this Executor line does not count" mode_block_copied fail single-agent "$HUNTER" "{ head -n 1; block_of subagent-per-task | tail -n +2; }"

# --- The light modes end with their final review task ---------------------------------------
review_probe() { # review_probe NAME WANT MODE TASKS... — TASKS are "u" (a unit task) or "r" (the final review)
  local f="$TMP/review-$RANDOM.md" name="$1" want="$2" mode="$3" n=0; shift 3
  { wow_plan "$mode" "$HUNTER" cat
    for kind in "$@"; do n=$((n+1)); if [[ "$kind" == r ]]; then review_task "$n"; else task_with "$n" "$TMP/vb.md"; fi; done; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$name" "$(find_check "$f.json" final_review_task_last)" "$want"
}
review_probe "subagent-per-task ending in its final review passes" pass subagent-per-task u u r
review_probe "subagent-per-task with no final review task fails" fail subagent-per-task u u u
review_probe "a final review that is not the last task fails" fail subagent-per-task u r u
review_probe "single-agent: one task and the final review passes" pass single-agent u r
review_probe "single-agent with no final review task fails" fail single-agent u u
review_probe "a tribe plan needs no final review task" pass tribe u u

# --- A whole plan in each mode passes -------------------------------------------------------
whole_probe() { # whole_probe MODE TASKS...
  local f="$TMP/whole-$RANDOM.md" mode="$1" n=0; shift
  { wow_plan "$mode" "$HUNTER" cat
    for kind in "$@"; do n=$((n+1)); if [[ "$kind" == r ]]; then review_task "$n"; else task_with "$n" "$TMP/vb.md"; fi; done; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "a whole $mode plan passes" "$(jget "$f.json" verdict)" "pass"
}
whole_probe single-agent u r
whole_probe subagent-per-task u u r
whole_probe tribe u u

# --- The runner's duplicate_heading refusal (plan-index.ts resolveOne), mirrored ------------
# The runner resolves a task by its heading text and refuses a text that matches two headings;
# accepting such a plan is the under-read the Done mirror's oracle calls a bug.
dup_probe() { # dup_probe NAME WANT-STATUS TASKS-FN — a subagent-per-task plan whose tasks TASKS-FN prints
  local f="$TMP/dup-$RANDOM.md"
  { wow_plan subagent-per-task "$HUNTER" cat; "$3"; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$1" "$(find_check "$f.json" tasks_have_done_block)" "$2"
  if [[ "$2" == fail ]]; then
    check "$1 — names duplicate_heading" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('duplicate_heading' in [c['detail'] for c in d['checks'] if c['name']=='tasks_have_done_block'][0])" "$f.json")" "True"
  fi
}
dup_adjacent() { task_with 1 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; review_task 4; }
dup_far_apart() { task_with 1 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; task_with 3 "$TMP/vb.md"; task_with 1 "$TMP/vb.md"; review_task 5; }
dup_closing_hashes() { task_with 1 "$TMP/vb.md" | sed '1s/$/ ##/'; task_with 1 "$TMP/vb.md"; review_task 3; }
dup_none() { task_with 1 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; review_task 3; }
dup_probe "two identical task headings side by side fail, as the runner refuses them" fail dup_adjacent
dup_probe "two identical task headings far apart fail too" fail dup_far_apart
dup_probe "a heading that differs only by closing #s is the same heading to the runner" fail dup_closing_hashes
dup_probe "distinct task headings pass" pass dup_none

# --- The one definition must be readable: a declared mode with no source is a setup error ---
ISO="$TMP/iso/scripts"; mkdir -p "$ISO"; cp "$SCRIPT" "$ISO/validate-plan.sh"
set +e; bash "$ISO/validate-plan.sh" "$VF1" > "$TMP/iso.out" 2> "$TMP/iso.err"; code=$?; set -e
check "no ../agents/shaman.md beside the script: exit 2" "$code" "2"
check "no ../agents/shaman.md: stderr names the missing file" "$(grep -c 'agents/shaman.md' "$TMP/iso.err")" "1"
mkdir -p "$TMP/iso/agents"; printf '# Shaman\n\n## Ways of work\n\nNo blocks here.\n' > "$TMP/iso/agents/shaman.md"
set +e; bash "$ISO/validate-plan.sh" "$VF1" > "$TMP/iso2.out" 2> "$TMP/iso2.err"; code=$?; set -e
check "a Ways of work section with no block for the mode: exit 2" "$code" "2"
check "no block for the mode: stderr names the mode" "$(grep -c "Executor: subagent-per-task" "$TMP/iso2.err")" "1"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
exit $((FAIL > 0))
