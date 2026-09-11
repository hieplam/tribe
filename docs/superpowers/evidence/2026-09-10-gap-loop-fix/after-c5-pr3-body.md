## Why
Card C1 (campaign after-c5) adds the fourth module `src/reader.ts` so the module set (loader/parser/writer/reader) is complete and uniform. Spec: `docs/specs/add-reader-spec.md`; plan: `docs/plans/add-reader-plan.md`.

## What changed (scope fence honored)
- **`src/reader.ts`** (new): exports `reader(input: string, fallback: string): string` — parses `input` as JSON, returns its `value` field, and on any failure returns `fallback` without throwing. A **line-for-line mirror** of `src/loader.ts` except the function name and the filename comment (the plan's consistency wall).
- **`test/reader.test.ts`** (new): covers the happy path (`reader('{"value":"ok"}','f')` → `'ok'`) and the fallback path (`reader('nope','f')` → `'f'`), matching the import/style of `test/modules.test.ts`.
- **`docs/plans/add-reader-plan.md`**: Task 1 checkboxes ticked (bookkeeping only).
- The three existing modules are untouched (spec non-goal).

## Before / after evidence
Baseline (`master`): `bun test` → **3 pass, 0 fail**.
After: `bun test` → **5 pass, 0 fail, 5 expect() calls, 2 files** (the 2 new reader tests + 3 pre-existing).

Consistency wall proof: `diff <(sed 's/loader/reader/g' src/loader.ts) src/reader.ts` → identical after rename.

## Gate results
- `gap-gate.ts` (card C1, base `9f63c31`, head `dc7c680`): **exit 0 / verdict pass** — candidates 0, minted none, matched none, suppressed 0, flagged none, debt-delta 0, ledger none.
- `debt-backfill.ts --ref master`: `{"created":[]}` — clean no-op (no open debt entities).

## Review outcome
- **Tracker** (rules conformance, whole-branch diff): APPROVE — no violations; harness gaps: none. Bare `catch {}` noted only as inherited-and-mandated by the consistency wall (fixing in isolation would violate the wall / non-goals).
- **Skinner #1** & **Skinner #2** (independent evidence audits, ran the proof): 0 critical, 0 important. Both confirmed the contract empirically (never throws on bad input, returns value on happy path), the consistency wall, and the scope fence. The spec's "ANY failure" wording vs `JSON.parse('{}').value === undefined` was raised and refuted by both — the behavior is byte-identical to the existing modules the wall mandates.

## Harness gaps
- matched: none
- minted: none
- suppressed: 0
- flagged fingerprints: none
- open ids awaiting adjudication: none
- unparsed HG-candidate blocks: none
- proposals: pending Scout adjudication

<!-- gap-gate v1 card=C1 base=9f63c31a0e5593333c5ead4a39085f51e6d693c4 head=dc7c680e569aa026ee862c52e0b3ce16fd2e5bf1 minted=none matched=none debt-delta=0 ledger=none -->

**Governance proposals (headless campaign executor):** none — the gap gate reconciled zero open ids for this card, so there is nothing for Scout to adjudicate and no rule/anti-rule/debt draft rides this PR.

