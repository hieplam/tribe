## What

Adds a fourth module `src/reader.ts` exporting `reader(input: string, fallback: string): string`, matching the existing modules' contract exactly (parses `input` as JSON, returns its `.value`; on ANY failure returns `fallback` without throwing). Implements card C1 per docs/specs/add-reader-spec.md and docs/plans/add-reader-plan.md.

Consistency wall honoured: `src/reader.ts` mirrors `src/loader.ts` line-for-line except the function name. The three existing modules (loader/parser/writer) are untouched.

## Evidence (before / after)

**Before** — `test/reader.test.ts` fails, module missing:
```
error: Cannot find module '../src/reader.ts'
```

**After** — `bun test` green:
```
bun test v1.3.14 (d1632b29)
 5 pass
 0 fail
 5 expect() calls
Ran 5 tests across 2 files.
```

## Audits

- **Tracker** (rules conformance): APPROVE, 0 violations. One harness-gap candidate surfaced (unchecked `JSON.parse(...).value as string` assertion).
- **Skinner** (adversarial done-audit): tests genuinely green (5/5), reader.ts mirrors loader.ts line-for-line, existing modules untouched, trailers correct. Flagged that the commit also flips plan checkboxes vs the plan's "No other files" fence — resolved: the campaign Evidence policy mandates the plan's ticked checkboxes ride in the commit, which supersedes the source-scope fence (zero behavioural impact, not scope creep).

## Harness gaps

- matched: none
- minted: G-001
- suppressed: 0
- flagged fingerprints: none
- open ids awaiting adjudication: G-001
- unparsed HG-candidate blocks: none
- proposals: pending Scout adjudication

<!-- gap-gate v1 card=C1 base=1d5dcb334697d10926f06e081467abcbe0331be4 head=42efebd4f129304f9f5d5ebd6e19ef9723bbb8ba minted=G-001 matched=none debt-delta=0 ledger=5ba08c22beea5337df08ea3a199f056844ea69f79869a498f8bdc65629e809f8 -->
