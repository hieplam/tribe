## What & why

Card **C3** (campaign `after-c5`). Adds the sixth module `src/validator.ts` exporting `validator(input: string, fallback: string): string`, matching the existing modules' contract exactly: parse `input` as JSON, return its `.value`, return `fallback` on ANY failure without throwing. Implements `docs/plans/add-validator-plan.md` against `docs/specs/add-validator-spec.md`.

Scope is exactly the two mandated new files plus the plan's own checkbox ticks — no existing module changed.

## Changes

- `src/validator.ts` — new, 7 lines. Byte-for-byte mirror of `src/formatter.ts` except the function name / module-name comment (plan's "Consistency wall").
- `test/validator.test.ts` — new. Covers the happy path and the fallback path.
- `docs/plans/add-validator-plan.md` — Task 1 checkboxes ticked.
- `.tribe/harness-gaps.jsonl` — gap-gate `seen` event for G-001 (separate `Tribe-Milestone: gap-gate` commit).

## Evidence (before / after)

Mirror check — byte-identical to `src/formatter.ts` except the function name:
```
$ diff <(sed 's/validator/formatter/g' src/validator.ts) src/formatter.ts
(no output)
```

Test suite green (was 7 pass before this card's module; 9 after):
```
$ bun test
 9 pass
 0 fail
 9 expect() calls
Ran 9 tests across 4 files.
```

Scope:
```
$ git diff --stat e65a9c5..<code-commit>
 docs/plans/add-validator-plan.md | 8 ++++----
 src/validator.ts                 | 7 +++++++
 test/validator.test.ts           | 4 ++++
```

Audits: Tracker (rules) APPROVE, 0 violations; two independent Skinners APPROVE, 0 blocking findings (both confirmed the mirror, scope, trailers, and green suite by running the proof).

## Harness gaps

gap-gate (`bun gap-gate.ts --card C3`) verdict **pass** (exit 0). The new module repeats the pre-existing `value as string` pattern already tracked as **G-001**, so gap-gate MATCHED G-001 (a `seen` event) rather than minting a new gap. No debt entities exist in this repo, so debt delta is 0.

- matched: G-001
- minted: none
- suppressed: 0
- flagged fingerprints: none
- open ids awaiting adjudication: G-001
- unparsed HG-candidate blocks: none
- proposals: see Scout proposal below (pending closing-pass adjudication)

<!-- gap-gate v1 card=C3 base=e65a9c5569787e3170483d0543532dd697aaba2b head=f791991b28b206a2a5aabb5ba6f0c665619e99ca minted=none matched=G-001 debt-delta=0 ledger=824bc951279db27666cc3537828f76f7b73a30d936ff7b56b10964dae63a34ab -->

### Scout governance proposal — G-001 (draft, NOT ratified; closing pass decides)

**G-001** · `input-validation` · fingerprint `grep -rl "value as string" src/` · 6/6 files · **Proposed disposition: ANTI-RULE (draft) + grandfather existing 6 hits as tracked debt.**

- **Bug shape:** `JSON.parse(input).value as string` inside `try/catch` guards only the throw branch. Valid JSON missing `value` (`validator('{}','f')`) parses fine → returns `undefined`, not the declared-`string` `fallback`. The `as string` cast launders the hole; no test covers this third shape. Present in all six mirror modules (`loader`, `parser`, `writer`, `reader`, `formatter`, `validator`).
- **Governing decision:** spec says "return `fallback` on ANY failure" — a missing key is an unnamed third outcome that violates the contract's spirit. No `.c3/`; nearest rule `fixtures-mirror-reality.md` is path-scoped, so no existing written rule covers it.
- **Proposed anti-rule** `no-cast-masked-missing-key`: a non-nullable-returning function must not return an `as`-cast parsed field without collapsing the absent-field case to the declared fallback. `## This Instead` = drop the cast, use `JSON.parse(input).value ?? fallback` (deletion + one stdlib primitive; mirror-fix across all six). Check = G-001's own fingerprint.
- **Grandfather at adoption:** debt check `test $(grep -rl "value as string" src/ | wc -l) -eq 0` (meter: files carrying the cast, target 0), so C3 does not flip red while the six-file fix is scheduled.
- **Test obligation:** each module test asserts `fn('{}','f') === 'f'`.

This card does not self-ratify and is not parked on ratification — the campaign's closing pass rules on the whole batch.

