#!/usr/bin/env bash
# validate-plan.sh — mechanically check a Warchief plan against warchief.md's own plan-step
# requirements (method step 3, "Write the plan"), instead of re-deriving "is this plan actually
# buildable?" by prose reasoning on every dispatch. Plan -> validate -> only then execute.
#
# Checks, against the plan file's Markdown:
#   - at least one task section exists (a heading whose text starts with "Task N", per the
#     writing-plans skill's "### Task N: [Component Name]" template — a heading that merely
#     mentions the word "task" in passing, e.g. an overview heading like "## Task Breakdown",
#     does not count)
#   - a "Global Constraints" section exists and names the hunter subagent as the implementer
#     (the exact line warchief.md's plan step requires)
#   - no placeholder markers survive (TODO, TBD, FIXME, XXX, PLACEHOLDER, "...", "<...>") — the
#     "..." and "<...>" checks both ignore matches written as inline code or inside a fenced
#     code block (e.g. `heartbeat-check.sh <report-file>`, or code using `...args`/`Ellipsis`/
#     `Callable[..., int]`), since those are legitimate code idioms and this repo's own
#     convention for documenting a script's arguments — not unfinished placeholders. The "..."
#     check additionally only fires when the ellipsis trails off the line (nothing but
#     whitespace/punctuation after it) — an ellipsis followed by more prose on the same line is
#     ordinary punctuation (a quoted excerpt or a pause), not a placeholder, and flagging it
#     false-positives on normal writing. TODO/TBD/FIXME/XXX/PLACEHOLDER are still checked
#     everywhere, code or not.
#     Fence tracking is CommonMark-correct: a fence opened by N backticks closes only
#     on >= N of the same character, so nested fenced examples inside a longer outer
#     fence stay inside it, and headings quoted inside any fence are content, not
#     section structure.
#   - each task section carries at least one fenced code block (actual commands/code, not
#     prose-only, whether or not the fence is indented under a list item)
#   - each task section carries its own Verify block — a "Verify" heading holding labelled
#     Goal, Red, Green and Stub check lines outside any fence, with a literal command under
#     Red and under Green (Red may instead say "not applicable" plus the reason, for a task
#     with no code)
#   - a "Way of work" section declares "Executor: single-agent" or
#     "Executor: subagent-per-task", and single-agent is used for at most 2 tasks
#   - each task section carries exactly one "Commit" step (a checkbox step whose title
#     is "Commit", counted outside fences), enforcing the single-unit-of-work sizing
#     rule from the atomic-resume spec
#
# Optional flag --schema-lock-paths <comma-separated-paths> adds one more check, active
# only when given (omitting it leaves every other behavior, including the exit-code
# contract below, unchanged — legacy invocations are unaffected):
#   - a plan "schedules a locked-path change" when a line outside a fenced code block
#     matches ^\s*-?\s*(Modify|Create|Delete):\s*<lockPath>$ for one of the given paths
#     exactly (a prose-only mention of the path, or a task line for a different, merely
#     similarly-named path, does not count) — the path itself may optionally be
#     backtick-wrapped, with an optional trailing ":line-range" inside those backticks,
#     and/or an optional trailing parenthetical note, matching this repo's own
#     writing-plans task-line convention (e.g. "- Modify: `path/to/file.ts:12-34`
#     (rewrite the parse loop)"), not just the bare unwrapped path;
#   - front-matter detection mirrors the campaign runner's own reader exactly
#     (`readAllowsSchemaChange` in `runner/core/verify.ts`): a leading `---` block
#     containing a line `allowsSchemaChange: true` — an absent block or absent key means
#     false;
#   - a plan that schedules such a change without that front-matter FAILS THE WHOLE
#     SCRIPT (exit 1 AFTER the JSON summary is printed to stdout as usual, per the
#     output contract below; the message naming the plan, the matched task line, and the
#     fix — ruling UC-3, 08-08 campaign — goes to stderr) instead of merely recording a
#     failed check in the JSON summary, so this is the one check whose failure changes
#     the exit code.
#
# This does not (and cannot) judge whether the plan is *good* — only whether it is mechanically
# well-formed enough to hand to a Hunter. Judgment stays with the Warchief/Skinner.
#
# Output: prints a JSON summary on stdout (only). Logs go to stderr.
# Exit codes: 0 = ran successfully (regardless of pass/fail on the structural checks);
#   1 = --schema-lock-paths was given and a locked-path change was scheduled undeclared;
#   2 = setup error.
#
# Usage:
#   validate-plan.sh [--schema-lock-paths <comma-separated-paths>] <plan-file-path>

set -euo pipefail

LOG() { printf '[validate-plan] %s\n' "$*" >&2; }
DIE() { LOG "ERROR: $*"; exit 2; }

PLAN_FILE=""
SCHEMA_LOCK_PATHS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,59p' "$0"; exit 0 ;;
    --schema-lock-paths)
      [[ $# -ge 2 ]] || DIE "--schema-lock-paths requires a value"
      SCHEMA_LOCK_PATHS="$2"; shift 2 ;;
    -*)         DIE "unknown flag: $1" ;;
    *)
      if [[ -n "$PLAN_FILE" ]]; then DIE "unexpected extra argument: $1"; fi
      PLAN_FILE="$1"; shift ;;
  esac
done

[[ -n "$PLAN_FILE" ]] || DIE "usage: validate-plan.sh <plan-file-path>"
[[ -f "$PLAN_FILE" ]] || DIE "plan file not found: $PLAN_FILE"
[[ -r "$PLAN_FILE" ]] || DIE "plan file not readable (permission denied?): $PLAN_FILE"
[[ -s "$PLAN_FILE" ]] || DIE "plan file is empty: $PLAN_FILE"
command -v python3 >/dev/null 2>&1 || DIE "python3 is required but not on PATH"

python3 - "$PLAN_FILE" "$SCHEMA_LOCK_PATHS" <<'PY'
import json, re, sys

plan_file = sys.argv[1]
schema_lock_paths_raw = sys.argv[2] if len(sys.argv) > 2 else ""
# The bash wrapper already checked -f/-r, but that's a TOCTOU-prone check, not a guarantee
# (the file can vanish or become unreadable between the check and this open()). Treat any
# I/O failure here as a setup error (exit 2), matching this script family's documented
# contract, instead of letting an unhandled traceback leak to stdout with exit 1.
try:
    with open(plan_file, "r", errors="replace") as f:
        text = f.read()
except OSError as e:
    print(f"[validate-plan] ERROR: cannot read plan file: {e}", file=sys.stderr)
    sys.exit(2)
lines = text.splitlines()

WORD_PLACEHOLDER_RE = re.compile(r"\b(TODO|TBD|FIXME|XXX|PLACEHOLDER)\b")
ELLIPSIS_RE = re.compile(r"\.\.\.(?!\))")
ANGLE_PLACEHOLDER_RE = re.compile(r"<[a-zA-Z_ -]{2,40}>")
INLINE_CODE_RE = re.compile(r"`[^`]*`")

# A real per-task section per the writing-plans skill's "### Task N: [Component Name]"
# template — the title must *start* with "Task <number>", not merely contain the word
# "task" (which would also sweep in an unrelated overview heading like "## Task Breakdown").
TASK_HEADING_RE = re.compile(r"^task\s+\d+\b", re.IGNORECASE)

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")

# CommonMark-correct fence map: for each line, whether it sits inside a fenced code
# block, and whether it OPENS one. A fence opened by N backticks/tildes closes only on
# a line of >= N of the same character and nothing else — so documentation that nests
# fenced examples inside a longer outer fence (this repo's plans quote whole test
# files, which themselves contain fences) no longer desyncs the scanner, and headings
# inside fenced content are body text, not real headings.
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
in_fence_flags, fence_opens = [], []
open_char, open_len = None, 0
for line in lines:
    m = FENCE_RE.match(line)
    if open_char is None:
        if m:
            fence = m.group(1)
            open_char, open_len = fence[0], len(fence)
            in_fence_flags.append(True)
            fence_opens.append(True)
        else:
            in_fence_flags.append(False)
            fence_opens.append(False)
    else:
        in_fence_flags.append(True)
        fence_opens.append(False)
        if m and m.group(1)[0] == open_char and len(m.group(1)) >= open_len \
                and m.group(2).strip() == "":
            open_char, open_len = None, 0

# Split into sections using only REAL headings. Each section spans [line+1, end) in
# 1-based file lines: its own body plus every strictly-deeper subsection, stopping at
# the next heading of the same or shallower level — so a Task whose steps use nested
# subheadings still owns that content.
sections = []
for i, line in enumerate(lines, start=1):
    if in_fence_flags[i - 1]:
        continue
    m = HEADING_RE.match(line)
    if m:
        sections.append({"level": len(m.group(1)), "title": m.group(2).strip(), "line": i})
for idx, s in enumerate(sections):
    end = len(lines) + 1
    for other in sections[idx + 1:]:
        if other["level"] <= s["level"]:
            end = other["line"]
            break
    s["end"] = end
    s["span"] = lines[s["line"]:s["end"] - 1]
if not sections:
    sections = [{"level": 0, "title": "(no headings)", "line": 0,
                 "end": len(lines) + 1, "span": lines}]

task_sections = [s for s in sections if TASK_HEADING_RE.match(s["title"])]

checks = []

# 1. at least one task section
checks.append({
    "name": "has_task_sections",
    "status": "pass" if task_sections else "fail",
    "detail": f"{len(task_sections)} task section(s) found",
})

# 2. Global Constraints section names the hunter subagent
gc_sections = [s for s in sections if re.search(r"global constraints", s["title"], re.IGNORECASE)]
if not gc_sections:
    checks.append({"name": "global_constraints_present", "status": "fail",
                    "detail": "no 'Global Constraints' section found"})
    checks.append({"name": "hunter_named_as_implementer", "status": "fail",
                    "detail": "cannot check — no 'Global Constraints' section"})
else:
    checks.append({"name": "global_constraints_present", "status": "pass",
                    "detail": f"found at line {gc_sections[0]['line']}"})
    gc_text = "\n".join(gc_sections[0]["span"])
    names_hunter = bool(re.search(r"\bhunter\b", gc_text, re.IGNORECASE)) and \
                   bool(re.search(r"\bsubagent\b", gc_text, re.IGNORECASE))
    checks.append({
        "name": "hunter_named_as_implementer",
        "status": "pass" if names_hunter else "fail",
        "detail": "Global Constraints names the hunter subagent as implementer"
                  if names_hunter else
                  "Global Constraints does not name the hunter subagent as implementer",
    })

# 3. no placeholder markers anywhere in the file
# Angle-bracket notation and trailing ellipses are legitimate inside code (inline or
# fenced, per the fence map above) — both checks skip there. The word markers matched
# by WORD_PLACEHOLDER_RE are real placeholders regardless of code formatting, so those
# are still checked everywhere.
placeholder_hits = []
for i, line in enumerate(lines, start=1):
    for m in WORD_PLACEHOLDER_RE.finditer(line):
        placeholder_hits.append({"line": i, "match": m.group(0)})
    if in_fence_flags[i - 1]:
        continue
    stripped = INLINE_CODE_RE.sub("", line)
    for m in ELLIPSIS_RE.finditer(stripped):
        # A "trailing" ellipsis — nothing but whitespace/punctuation after it on this
        # line — reads as content trailing off unfinished, the actual placeholder this
        # check exists to catch. An ellipsis followed by more prose is ordinary
        # punctuation (a quoted excerpt or a pause), not a placeholder.
        tail = stripped[m.end():]
        if re.search(r"[A-Za-z0-9]", tail):
            continue
        placeholder_hits.append({"line": i, "match": m.group(0)})
    for m in ANGLE_PLACEHOLDER_RE.finditer(stripped):
        placeholder_hits.append({"line": i, "match": m.group(0)})
checks.append({
    "name": "no_placeholders",
    "status": "pass" if not placeholder_hits else "fail",
    "detail": f"{len(placeholder_hits)} placeholder marker(s) found" if placeholder_hits else "none found",
})

# 4. each task section carries a fenced code block (actual commands/code, not prose-only)
tasks_missing_code = []
for s in task_sections:
    fence_blocks = sum(1 for j in range(s["line"], s["end"] - 1) if fence_opens[j])
    if fence_blocks < 1:
        tasks_missing_code.append(s["title"])

checks.append({
    "name": "tasks_have_code_blocks",
    "status": "pass" if not tasks_missing_code else "fail",
    "detail": "all task sections carry a fenced code block" if not tasks_missing_code
              else f"missing in: {tasks_missing_code}",
})

# 4b. each task section carries its own Verify block: a heading titled "Verify" inside the
# task, holding four labelled lines outside any fence — Goal (what the task proves), Red (the
# command run before building and the failure it shows), Green (the command after building
# and its literal expected output), Stub check (why an empty implementation fails it). Red
# and Green must each carry a literal command: a fenced block under the label (not one tagged
# `text` or `output`), or an inline code span that reads as a command (a program name, alone
# or with arguments, like `pytest` or `bun test x.test.ts`) — an output-only span like
# `1 fail` is not one. Telling a command from output this way is a guess, so it only catches a
# missing or command-less block; whether the command is real stays with the plan reviewer. A shared "the suite is
# green" line has no command and fails. The one allowed Red with no command is "not
# applicable" plus the reason, for a task with no code to go red (a baseline measurement).
# This checks the block's form; whether its oracle is the right one stays with the plan
# reviewer.
VERIFY_HEADING_RE = re.compile(r"^verify\b", re.IGNORECASE)
VERIFY_LABEL_RE = re.compile(
    r"^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\*\*)?(goal|red|green|stub check)\b[^:\n]{0,30}?\s*:",
    re.IGNORECASE)
# A command: a program name (a letter or path character first, so `1 fail` and `exit=2` don't
# qualify, and `tribe: unknown option` doesn't either), optionally followed by arguments.
COMMAND_SPAN_RE = re.compile(r"`\s*(?:\$\s*)?[A-Za-z./~][\w./~+-]*(?:\s+[^`]+)?`")
# A fence tagged as output holds what a command prints, not the command.
OUTPUT_FENCE_INFO = {"text", "txt", "plaintext", "output", "log"}
def opens_command_fence(k):
    if not fence_opens[k]:
        return False
    info = FENCE_RE.match(lines[k]).group(2).strip().split()
    return not (info and info[0].lower() in OUTPUT_FENCE_INFO)
RED_NOT_APPLICABLE_RE = re.compile(r"\b(?:not applicable|n/a)\b(.*)$", re.IGNORECASE)
REQUIRED_VERIFY_LABELS = ("goal", "red", "green", "stub check")
tasks_missing_verify = []
for s in task_sections:
    verify_sections = [v for v in sections
                       if s["line"] < v["line"] < s["end"] and v["level"] > s["level"]
                       and VERIFY_HEADING_RE.match(v["title"])]
    if not verify_sections:
        tasks_missing_verify.append(f"{s['title']} (no Verify heading)")
        continue
    v = verify_sections[0]
    body = range(v["line"], v["end"] - 1)   # 0-based indexes of the Verify section's lines
    # Each label owns its lines up to the next label or heading outside a fence.
    label_at = {}
    for j in body:
        if in_fence_flags[j]:
            continue
        m = VERIFY_LABEL_RE.match(lines[j])
        if m:
            label_at[j] = m.group(1).lower()
    stops = sorted(set(label_at) | {j for j in body if not in_fence_flags[j]
                                    and HEADING_RE.match(lines[j])} | {v["end"] - 1})
    has_command = {}
    red_not_applicable_with_reason = False
    for j, label in label_at.items():
        end = next(k for k in stops if k > j)
        carries = any(opens_command_fence(k) or (not in_fence_flags[k] and COMMAND_SPAN_RE.search(lines[k]))
                      for k in range(j, end))
        has_command[label] = has_command.get(label, False) or carries
        # The reason is at least two words after the phrase ("not applicable." alone is not one).
        na = RED_NOT_APPLICABLE_RE.search(lines[j]) if label == "red" else None
        if na and len(re.findall(r"[A-Za-z]{2,}", na.group(1))) >= 2:
            red_not_applicable_with_reason = True
    problems = [label for label in REQUIRED_VERIFY_LABELS if label not in has_command]
    if "green" in has_command and not has_command["green"]:
        problems.append("green has no literal command")
    if "red" in has_command and not has_command["red"] and not red_not_applicable_with_reason:
        problems.append("red has no literal command, or 'not applicable' with no reason")
    if problems:
        tasks_missing_verify.append(f"{s['title']} ({', '.join(problems)})")
checks.append({
    "name": "tasks_have_verify_block",
    "status": "pass" if not tasks_missing_verify else "fail",
    "detail": "every task carries a Verify block: Goal, Red, Green and Stub check, with literal "
              "Red/Green commands" if not tasks_missing_verify
              else f"missing or incomplete in: {tasks_missing_verify}",
})

# 4c. the plan declares how it is executed, in a "Way of work" section, on a line
# "Executor: single-agent" or "Executor: subagent-per-task". One agent may build the whole
# plan only when the plan is at most 2 tasks (the owner's rule: fewer than 3 tasks with a
# minimal code change); every larger plan gets one fresh implementer subagent per task.
# The "minimal code change" half is judged by the plan reviewer, not here.
EXECUTOR_RE = re.compile(
    r"^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\*\*)?executor(?:\*\*)?\s*:(?:\*\*)?\s*`?(single-agent|subagent-per-task)(?![\w-])",
    re.IGNORECASE)
SINGLE_AGENT_MAX_TASKS = 2
wow_sections = [s for s in sections if re.match(r"^(?:\d+[.)]\s*)?way of work\b", s["title"], re.IGNORECASE)]
executor = None
for s in wow_sections:
    for j in range(s["line"], s["end"] - 1):
        m = None if in_fence_flags[j] else EXECUTOR_RE.match(lines[j])
        if m:
            executor = m.group(1).lower()
            break
    if executor:
        break
if not wow_sections:
    wow_detail = "no 'Way of work' section found"
elif executor is None:
    wow_detail = "'Way of work' has no line 'Executor: single-agent' or 'Executor: subagent-per-task'"
else:
    wow_detail = f"Executor: {executor}"
checks.append({
    "name": "way_of_work_declared",
    "status": "pass" if executor else "fail",
    "detail": wow_detail,
})
single_agent_over_limit = executor == "single-agent" and len(task_sections) > SINGLE_AGENT_MAX_TASKS
checks.append({
    "name": "single_agent_within_limit",
    "status": "fail" if single_agent_over_limit else "pass",
    "detail": f"single-agent allows at most {SINGLE_AGENT_MAX_TASKS} tasks; this plan has "
              f"{len(task_sections)}" if single_agent_over_limit
              else f"executor {executor or 'undeclared'}, {len(task_sections)} task(s)",
})

# 5. each task is a single unit of work: exactly one "Commit" step per task section.
# The step title must BE "Commit" (writing-plans template: "- [ ] **Step N: Commit**") —
# a step title merely containing the word commit does not count, and quoted steps
# inside fenced examples do not count either. Enforces the tribe's crash-resume
# ruling: one red->green->commit cycle per task, so a discarded half-done task is
# never expensive to redo.
COMMIT_STEP_RE = re.compile(r"^\s*-\s*\[[ xX]\]\s*\*\*Step\s+\d+:\s*Commit\s*\*\*", re.IGNORECASE)
tasks_wrong_commit_count = []
for s in task_sections:
    n_commits = sum(1 for j in range(s["line"], s["end"] - 1)
                    if not in_fence_flags[j] and COMMIT_STEP_RE.match(lines[j]))
    if n_commits != 1:
        tasks_wrong_commit_count.append(f"{s['title']} ({n_commits} commit step(s))")
checks.append({
    "name": "tasks_single_commit_step",
    "status": "pass" if not tasks_wrong_commit_count else "fail",
    "detail": "every task section has exactly one Commit step"
              if not tasks_wrong_commit_count
              else f"wrong commit-step count in: {tasks_wrong_commit_count}",
})

# 6. (optional, only when --schema-lock-paths is given) a scheduled locked-path change
# must be declared via allowsSchemaChange: true front-matter — mirrors the campaign
# runner's own reader (readAllowsSchemaChange, runner/core/verify.ts) exactly: a leading
# `---` block containing a line `allowsSchemaChange: true`; absent block or absent key
# means false. Unlike every check above, a violation here fails the WHOLE SCRIPT (exit 1)
# instead of merely recording a failed entry in the JSON summary — this check exists to
# shift the schema-lock guard left, from verify-time to authoring/preflight-time, so a
# caller (the orchestrate-campaign preflight) can gate on this script's exit code alone.
schema_lock_paths = [p.strip() for p in schema_lock_paths_raw.split(",") if p.strip()]
if schema_lock_paths:
    def read_allows_schema_change(full_text):
        m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", full_text, re.DOTALL)
        if not m:
            return False
        front_matter = m.group(1) or ""
        km = re.search(r"^allowsSchemaChange:\s*(true|false)\s*$", front_matter, re.MULTILINE)
        if not km:
            return False
        return km.group(1) == "true"

    allows_schema_change = read_allows_schema_change(text)

    schema_lock_hits = []
    for i, line in enumerate(lines, start=1):
        if in_fence_flags[i - 1]:
            continue
        for lock_path in schema_lock_paths:
            # Exact-path match, anchored at both ends of the (trimmed) line, so a longer
            # sibling path (e.g. ports.test.ts) never trips a shorter lock path (ports.ts)
            # merely because it shares a prefix. The path itself may optionally be
            # backtick-wrapped (this repo's own writing-plans convention: "- Modify:
            # `path/to/file.ts`"), optionally followed by a ":line-range" suffix inside
            # those backticks ("`path/to/file.ts:12-34`"), and optionally followed by a
            # trailing parenthetical note ("- Modify: `path.ts` (rewrite the parse loop)")
            # — any combination of those, or none of them (the bare "- Modify: path.ts"
            # form), must all match the same exact path.
            pattern = (
                r"^\s*-?\s*(Modify|Create|Delete):\s*"
                r"`?" + re.escape(lock_path) + r"(?::[\d,\-]+)?`?"
                r"(?:\s*\([^)]*\))?"
                r"\s*$"
            )
            if re.match(pattern, line):
                schema_lock_hits.append({"line": i, "text": line.strip(), "path": lock_path})
                break

    schema_lock_violated = bool(schema_lock_hits) and not allows_schema_change
    checks.append({
        "name": "schema_lock_declared",
        "status": "fail" if schema_lock_violated else "pass",
        "detail": f"{len(schema_lock_hits)} schema-lock task line(s) found; "
                  f"allowsSchemaChange={'true' if allows_schema_change else 'false'}",
    })
else:
    schema_lock_violated = False

verdict = "pass" if all(c["status"] == "pass" for c in checks) else "fail"

print(json.dumps({
    "plan_file": plan_file,
    "task_count": len(task_sections),
    "task_titles": [s["title"] for s in task_sections],
    "checks": checks,
    "placeholder_hits": placeholder_hits,
    "verdict": verdict,
}, indent=2))
sys.stdout.flush()

# The exit-code contract (see header) still fails the WHOLE SCRIPT on a schema-lock
# violation, but only AFTER the JSON summary above has been printed to stdout — every
# other check path (1-5, and this one when it passes) reaches this same print, so no
# caller ever gets a truncated/empty stdout on the one path that also changes the exit
# code.
if schema_lock_violated:
    hit = schema_lock_hits[0]
    print(
        f"[validate-plan] ERROR: {plan_file}: task line at line {hit['line']} "
        f"(\"{hit['text']}\") schedules a change to locked path \"{hit['path']}\" — "
        "add `allowsSchemaChange: true` front-matter — designed schema changes must "
        "be declared by the card's own plan (ruling UC-3, 08-08 campaign)",
        file=sys.stderr,
    )
    sys.exit(1)
PY
