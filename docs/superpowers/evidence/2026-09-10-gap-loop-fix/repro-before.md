# Reproduction — before the fix (2026-09-10)

Empty-fixture run of the real campaign runner, same model tier as real campaigns (`--model opus`).

- Fixture: `build-fixture.sh repro-before-fix` → `/tmp/gap-repro-0lZQr5/repo` (bare `git init`, 3 modules
  each with a silent `catch {}` and an unchecked `JSON.parse(input).value as string`, one card whose plan
  adds a 4th module mirroring them; local bare `origin`, no GitHub).
- Launch: `bun plugins/tribe/scripts/runner/run.ts --repo /tmp/gap-repro-0lZQr5/repo --model opus --home
  ~/.tribe/-private-tmp-gap-repro-0lZQr5-repo/campaigns/repro-before-fix --session-timeout 75m --max-cards 1 --no-viewer`
- Result: runner exit 3 (session_incomplete); 3 executor sessions (`af31f1be`, `9fd9a948`, `4c0d4d77`), 14 min total.

## What the first session (af31f1be) did

Subagents dispatched: hunter, tracker, skinner ×2, scout (from `~/.claude/projects/-private-tmp-gap-repro-0lZQr5-repo/af31f1be-*/subagents/*.meta.json`).

The Tracker reported a genuine four-condition candidate (worker report `reports/C1.md:323-337`):

```
HG-candidate 1  [input-validation]  diff FOLLOWS an undocumented pattern
  Pattern:    `JSON.parse(input).value as string` is a compile-time type assertion, not a runtime check ...
  Evidence:   `grep -rn "as string" src/` → 4 hits in 4 files (src/loader.ts:4, src/parser.ts:4, src/reader.ts:4, src/writer.ts:4)
  Diff link:  `src/reader.ts:4` repeats it
  Not judged: this is a gap in the rule set, not a violation
```

(The planted `catch {}` was NOT reported as a gap: the Tracker judged it covered by the machine-global
`fail-closed-edges.md` obligation 1. Condition 4 worked as designed.)

The Warchief then:
- never ran `gap-reconcile.ts`, `debt-count.ts`, or `debt-backfill.ts` — zero Bash commands in the session
  or its subagents mention them;
- reasoned (its own transcript): *"No `.c3/`, no gap-reconcile script — the tooling doesn't exist in this
  fixture, so HG-candidates get recorded as reviewable text under `## Harness gaps` in the PR body"* — it
  resolved the script against the TARGET repo, not the plugin root, despite step 7's instruction;
- with no GitHub remote, merged the branch into `master` itself with `git merge --no-ff` and reported
  SHIPPED with a prose `## Harness gaps` section (5 items, none with a G-NNN id) in the merge commit body.

Outcome: `find /tmp/gap-repro-0lZQr5 -name harness-gaps.jsonl` → nothing. Master has no ledger.

## Leaks observed in this single run

- L2 (no ledger → nothing to do) and a new variant **L6: script resolved against the target repo instead of
  the plugin root** ("the tooling doesn't exist in this fixture").
- L4 variant: the Warchief itself bypassed the PR path and merged locally when `gh` could not be used.
- Prose sink worked as designed (the closing pass would read the PR body) — but nothing minted an id.
