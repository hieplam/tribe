# fu-closing-dismiss — plan

Spec: `docs/superpowers/specs/2026-09-28-fu-closing-dismiss-design.md`.

## How to work

- Do the tasks in order. Give each task to one `general-purpose` subagent; the subagent
  writes the test, writes the code, runs the task's Done commands, and commits.
- Every task ends with a **Done** section: shell commands, one per line. The task is done
  when every command exits 0 when run from a clean checkout of the task's commit — the
  runner runs them itself.
- Work on a branch in a separate git worktree.

## Task 1 — dismiss G-007 and G-008

This task has no test to write: the change is two ledger lines written by the ledger's own CLI, and
the Done commands below are the check.

1. From the worktree root, run the ruling CLI once per gap. Never hand-write a ledger line.

   ```bash
   bun plugins/tribe/scripts/gaps/gap-rule.ts --registry .tribe/harness-gaps.jsonl --gap G-007 --disposition dismissed --ratified-by owner --repo "$PWD"
   bun plugins/tribe/scripts/gaps/gap-rule.ts --registry .tribe/harness-gaps.jsonl --gap G-008 --disposition dismissed --ratified-by owner --repo "$PWD"
   ```

2. Commit only `.tribe/harness-gaps.jsonl`. Change no other file, including this plan. The commit
   body states the reason: the code each gap's fingerprint pointed at
   (`core/supervisor/home-config.e2e.test.ts`) was deleted by PR #175, and the owner ruled "Drop +
   dismiss" on 2026-09-28.

### Done

```bash
python3 -c 'import json; last = {}; [last.__setitem__(e["id"], e) for e in map(json.loads, open(".tribe/harness-gaps.jsonl")) if e.get("id")]; bad = [g for g in ("G-007", "G-008") if (last[g]["event"], last[g].get("disposition"), last[g].get("ratified_by")) != ("ruled", "dismissed", "owner")]; assert not bad, bad'
test "$(git diff --numstat "$RUNNER_BASE_SHA" HEAD)" = "$(printf '2\t0\t.tribe/harness-gaps.jsonl')"
```
