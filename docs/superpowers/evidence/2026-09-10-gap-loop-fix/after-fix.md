# After the fix — empty-fixture end-to-end on a real GitHub repo (2026-09-11)

- Fixture: `build-fixture.sh after-fix git@github.com:hieplam/tribe-gap-e2e.git` → `/tmp/gap-repro-S0PAKh/repo`,
  same planted patterns as the before-run, two cards (C1 add-reader, C2 add-formatter depending on C1).
- Launch: campaign runner + watchdog, `--model opus`, tribe installed from master at 7a2f77c (C1–C3 of
  campaign gap-gate-2026-09-10 merged).
- Account usage limit paused the run 10:11–11:20 local; the watchdog relaunched it (and then false-stalled,
  see card watchdog-stall-after-quota-relaunch); a re-attached watchdog supervised the rest.

## Card 1 (add-reader) — PR hieplam/tribe-gap-e2e#1, merged

Master of the fixture repo after merge:

```
95ad60a Merge pull request #1 from hieplam/add-reader
f51f631 chore: record harness-gap G-001 (gap-gate)
42efebd Add reader module with tests
```

`.tribe/harness-gaps.jsonl` on master:

```
{"id":"G-001","event":"opened","category":"input-validation","paths":["src/reader.ts"],"fingerprint":"grep -rn \"as string\" src/","hits_at_detection":4,"first_seen_pr":0}
```

PR #1 body (saved in `after-fix-pr1-body.md`), `## Harness gaps` section: `minted: G-001`, stamp
`<!-- gap-gate v1 card=C1 base=1d5dcb3… head=42efebd… minted=G-001 matched=none debt-delta=0 ledger=5ba08c2… -->`.

This is the first `opened` event the loop has ever recorded.

Observed nits for the hardening follow-up: `first_seen_pr` is 0 because the PR number does not exist when the
gate runs before `gh pr create`; `paths` carries only the diff-link path, not the four evidence paths.

## Card 2 (add-formatter) — PR hieplam/tribe-gap-e2e#2, merged — ORACLE HALF FAILED

Expected one `seen` on G-001. Got a second `opened`:

```
{"id":"G-002","event":"opened","category":"input-validation","paths":["src/formatter.ts"],"fingerprint":"grep -rn \"as string\" src/","hits_at_detection":5,"first_seen_pr":0}
```

Cause (read from the ledger, not guessed): `gap-candidates.ts` froze `paths` from the `Diff link` line only
(`src/reader.ts`), although the Tracker's Evidence line named the grep scope `src/` and four hit files. Card 2's
changed files (`src/formatter.ts`, `test/formatter.test.ts`) overlap none of `["src/reader.ts"]`, so reconcile
never executed G-001's fingerprint and minted a new id — the duplicate-mint case CU-2 called "loud and rare"
made systematic. Fix card: `gap-candidates-paths-scope` (C5): `paths` = fingerprint target arguments ∪ Evidence hit
paths ∪ Diff-link paths. Oracle re-run required on a fresh fixture after C5 merges.
