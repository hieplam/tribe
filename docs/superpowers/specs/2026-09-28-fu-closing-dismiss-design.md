# fu-closing-dismiss — design

Campaign `post-rdo-followups`, card 1 of 2. Owner ruling P1 (2026-09-28): "Drop + dismiss".

## Where things stand

Campaign `fu-supervisor-settings` shipped both of its cards (PRs #168 and #171), then parked at its
closing step on 2026-09-25. That closing had drafted two C3 rules and two `ruled` lines for the gap
ledger (`.tribe/harness-gaps.jsonl`, the append-only record of harness gaps found in review and how
each was ruled). The drafts were never committed.

On master `9d22e35` those drafts no longer hold:

- Both rules used `plugins/tribe/scripts/runner/core/supervisor/home-config.e2e.test.ts` as their
  example and eval path. PR #175 deleted that file (commits `0c88ed4`, `f09b82e`).
- Gap G-007's fingerprint (`grep -rn writerAttempted --include=*.test.ts .`) finds 0 files. Gap
  G-008's (`grep -rln subcommandResults .`) finds only two 2026-09-25 docs and the ledger itself.
- On master both gaps are still `opened`, so they stay open with nothing left to find.

## What changes

G-007 and G-008 get a `ruled` event with disposition `dismissed`, ratified by the owner, written by
the ledger's own CLI (`plugins/tribe/scripts/gaps/gap-rule.ts`). The rule drafts are dropped. Nothing
else in the repo changes.

The ledger's `ruled` event has no reason field, so the reason goes in the commit message: the code
each gap's fingerprint pointed at was deleted by PR #175.

## Goal and oracle

| Outcome | Oracle | Before → after |
|---|---|---|
| G-007 and G-008 read as ruled `dismissed`, `ratified_by: owner` | the plan's Done command folds the ledger | `opened` → `ruled dismissed` |
| The PR changes only the ledger, by exactly two appended lines | `git diff --numstat` from the card's base | — → `2 0` on one file |

Doing nothing fails the first row, because both gaps read `opened` on master.

## Out of scope

The parked campaign's own machine-local files (its final report and `NEEDS_OWNER.md`). The Shaman
already closed those by hand on 2026-09-28.
