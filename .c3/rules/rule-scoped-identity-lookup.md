---
id: rule-scoped-identity-lookup
c3-seal: ec6afbe08860218fd1b9ec1e184845956bc5bcb5c9d046b2b6b81daa830399ff
title: scoped-identity-lookup
type: rule
goal: 'Every check that accepts an alternate identity sourced from mutable metadata (a commit trailer, a branch name, a PR label) scopes its lookup to the exact artifact under audit, so widening what a check accepts never widens what it audits. The recurring need: the runner''s post-merge gap-gate stamp check (`gapGateStamped`) learned to accept a card''s slug from `Tribe-Card:` trailers in 2026-09-11 (PR #131); read from an unbounded `git log`, any slug that ever appeared on the branch would have passed, silently reopening the bypass the check exists to catch.'
---

## Goal

Every check that accepts an alternate identity sourced from mutable metadata (a commit trailer, a branch name, a PR label) scopes its lookup to the exact artifact under audit, so widening what a check accepts never widens what it audits. The recurring need: the runner's post-merge gap-gate stamp check (`gapGateStamped`) learned to accept a card's slug from `Tribe-Card:` trailers in 2026-09-11 (PR #131); read from an unbounded `git log`, any slug that ever appeared on the branch would have passed, silently reopening the bypass the check exists to catch.

## Rule

An identity-widening lookup reads only the artifact under audit — for a merged PR, the commits of its own merge range — never an unbounded or branch-wide history.

## Golden Example

Literal, from `plugins/tribe/scripts/runner/core/verify.ts` (`checkGapGateStamped`):

```ts
    const trailerResult = await run(io, config.repoRoot, [
      'git',
      'log',
      '--format=%(trailers:key=Tribe-Card,valueonly)',   // REQUIRED: git's native trailer parser, not a body regex
      `${mergeSha}^1..${mergeSha}`,                        // REQUIRED: bounded to this PR's own merge range
    ]);
    if (trailerResult.exitCode !== 0) {
      return fail(                                          // REQUIRED: a failed read fails the check, never passes it
        `PR #${card.pr}: reading the merged commits' Tribe-Card trailers failed (git log exit ${trailerResult.exitCode}); cannot confirm card=${stamp.card}`,
      );
    }
    const trailerValues = trailerResult.stdout
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    const trailerSet = new Set(trailerValues);            // OPTIONAL: any exact-match container
```

Compliance question: is the revision range (or equivalent selector) bound to the audited artifact's own identity (its merge sha, PR number, or run id), and does a failed read fail closed?

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| git log --format=%(trailers:...) with no range, or origin/master..HEAD | <mergeSha>^1..<mergeSha> | Any trailer ever committed on the branch (or on master) becomes an accepted identity; a bypassing session's PR passes on someone else's slug. |
| Extracting the trailer with a regex over %B | %(trailers:key=Tribe-Card,valueonly) | Git's parser applies the trailer-block rules (last paragraph only); a body regex matches quoted or prose mentions. |
| Treating a failed git log as "no alternate identities, fall through to pass" | Fail the check with the exit code in the detail | A read error is not evidence of anything; passing on it is fail-open. |

## Scope

Applies to every mechanical check in `plugins/tribe/scripts/runner/core/verify.ts`, `plugins/verify-shipped/`, and `plugins/tribe/scripts/gaps/` that accepts an identity it did not compute itself. Does not apply to purely informational listings.
