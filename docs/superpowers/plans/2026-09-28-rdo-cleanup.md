# rdo-cleanup — plan

Spec: `docs/superpowers/specs/2026-09-28-rdo-cleanup-design.md`. The spec's "By design" list names
what this card deliberately leaves alone.

## How to work

- Do the tasks in order. Give each task to one `general-purpose` subagent; the subagent
  writes the test, writes the code, runs the task's Done commands, and commits.
- Every task ends with a **Done** section: shell commands, one per line. The task is done
  when every command exits 0 when run from a clean checkout of the task's commit — the
  runner runs them itself.
- Work on a branch in a separate git worktree.

Standing rules for every task:

- Never run `plugins/tribe/scripts/tests/test-supervisor-park-truth.sh`. It leaves detached
  watchdog processes behind. Edit it, and check it with `bash -n` only.
- Existing test assertions stay unchanged, except where a task below names the deliberate change.
- Write new comments about today's behaviour only: the supervisor has two one-shot session kinds,
  `ruling` and `closing`. Do not describe the removed step. The task 2 check greps for its words.

## Task 1 — stop parsing the dead `run.unratifiedRulings` field

No test is written first: this removes a field nothing reads, and the type check plus the existing
supervisor suite are the check.

1. `plugins/tribe/scripts/runner/core/supervisor/model.ts`: `CampaignReportFacts.run` becomes
   `{ reason: string }`.
2. `plugins/tribe/scripts/runner/core/supervisor/loop.ts` (around line 359): delete the
   `unratifiedRulings` parse, and return `run: { reason: run['reason'] }`.
3. Remove `unratifiedRulings: []` from every report fixture that still writes it:
   `core/supervisor/decide.test.ts:245`, `core/supervisor/loop.test.ts:277` and `:286`,
   `core/supervisor/replay.test.ts:213` and `:222`, and the JSON in
   `plugins/tribe/scripts/tests/test-supervisor-park-truth.sh:107` (it becomes
   `{"run":{"reason":"escalations_pending"},`).
4. Commit.

### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/supervisor
bash -n plugins/tribe/scripts/tests/test-supervisor-park-truth.sh
test -f plugins/tribe/scripts/runner/core/supervisor/loop.ts && test "$(grep -rn --include='*.ts' --include='*.sh' --exclude-dir=node_modules unratifiedRulings plugins/tribe/scripts | wc -l)" -eq 0
```

## Task 2 — rewrite the stale ratify-step text

Paths below are relative to `plugins/tribe/scripts/`.

1. `tests/sessions-in-repo/owner-run.sh`
   - Line 9: the list of what a real run involves becomes "an executor card, a PR, CI, a ruling and
     a closing".
   - `write_answers` writes `answers.md` holding only the line `# Rulings`: no seeded ruling.
   - Replace the comment block above `write_answers` (lines 201–219) with a short one stating the
     rule and its reason: `answers.md` starts with no ruling, so card `owner-run-probe` is unruled,
     its plan's ask-first gate fires, the runner exits `escalations_pending`, and the supervisor
     spawns its `ruling` session — the only path to that session
     (`core/supervisor/decide.ts`). A ruling for `owner-run-probe` placed in this file would answer
     the question before it is asked, and the run would have no `ruling` session.
2. `tests/sessions-in-repo/test-owner-run-dry.sh`: a deliberate assertion change. Delete the
   `ratified-as: pending` assertion and the "Not a ruling for … owner-run-probe" assertion, and
   replace the comment above them. Keep the check that no ruling names card `owner-run-probe`. Add:
   `answers.md` exists, and has no `## ` ruling heading.
3. `tests/test-supervisor-park-truth.sh:239`: the runner's exit-reason list becomes
   `done | escalations_pending | session_incomplete | stop_requested | error` (the `ExitReason`
   type in `runner/core/report.ts`).
4. `runner/fixtures/supervisor/viewer-consolidation-replay/answers.md`: R09 stays, as a
   pre-existing synthesized ruling. Delete its `ratified-as:` line and rewrite its body: a ruling
   recorded before the replay's three rounds begin, which the replay leaves as it is.
5. `runner/fixtures/supervisor/viewer-consolidation-replay/README.md`: describe the fixture as it
   is today. Three escalation rounds plus one pre-existing ruling (R09). `replay.test.ts` asserts
   exactly four one-shot sessions: `ruling, ruling, ruling, closing`.
6. `runner/core/supervisor/replay.test.ts`: the header comment (lines 1–7) says the spawn count is
   bounded at 4 and describes R09 as a pre-existing ruling. Change no code or assertion.
7. Commit.

### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/supervisor/replay.test.ts
bash -n plugins/tribe/scripts/tests/sessions-in-repo/owner-run.sh
bash plugins/tribe/scripts/tests/sessions-in-repo/test-owner-run-dry.sh
bash -n plugins/tribe/scripts/tests/test-supervisor-park-truth.sh
S=plugins/tribe/scripts; fs="$S/tests/sessions-in-repo/owner-run.sh $S/tests/sessions-in-repo/test-owner-run-dry.sh $S/tests/test-supervisor-park-truth.sh $S/runner/fixtures/supervisor/viewer-consolidation-replay/README.md $S/runner/fixtures/supervisor/viewer-consolidation-replay/answers.md $S/runner/core/supervisor/replay.test.ts"; for f in $fs; do test -f "$f" || exit 1; done; test "$(cat $fs | grep -c -i -e ratify -e unratified -e 'ratified-as: pending' -e 'bounded at 5')" -eq 0
```

## Task 3 — the runner README's `planning` row

1. `plugins/tribe/scripts/runner/README.md`, the `planning` row of the state-file table
   (line 197). Type: `{ mode: "self" | "subagent-fanout" | "shaman" | "warchief-fanout" }`.
   Meaning: the simple style writes `"self"` (the orchestrating session wrote the plans) or
   `"subagent-fanout"` (one planning subagent per card), and the Tribe style writes `"shaman"` or
   `"warchief-fanout"` (the `orchestrate-campaign` skill, Stage A step 2b). Keep the rest of the
   row: the runner never reads the field, and the loose schema preserves it.
2. Commit.

### Done

```bash
grep '^| `planning` |' plugins/tribe/scripts/runner/README.md | grep -q '"subagent-fanout"'
grep '^| `planning` |' plugins/tribe/scripts/runner/README.md | grep -q '"self"'
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
```
