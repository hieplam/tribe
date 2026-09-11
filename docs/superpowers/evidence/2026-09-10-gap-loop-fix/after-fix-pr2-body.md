## What & why

Card **C2** (campaign `after-fix`): add a fifth config-loading module, `src/formatter.ts`, exporting `formatter(input: string, fallback: string): string`, matching the existing modules' contract exactly (parse `input` as JSON, return its `.value`, return `fallback` on ANY failure without throwing).

Spec: `docs/specs/add-formatter-spec.md` · Plan: `docs/plans/add-formatter-plan.md`.

## Changes

- `src/formatter.ts` — new; mirrors `src/reader.ts` line-for-line except the function name / header comment (plan consistency wall).
- `test/formatter.test.ts` — new; covers happy path (`{"value":"ok"}` → `ok`) and fallback path (`nope` → `f`).
- `docs/plans/add-formatter-plan.md` — Task 1 checkboxes ticked.
- `.tribe/harness-gaps.jsonl` — gap-gate open event for G-002 (recorded before this PR opened).

No existing source module was touched (spec non-goal honored).

## Evidence

**Before** (master, 5 tests):
```
$ bun test
 5 pass
 0 fail
Ran 5 tests across 2 files.
```

**After** (this branch, 7 tests — +2 for formatter):
```
$ bun test
bun test v1.3.14 (d1632b29)
 7 pass
 0 fail
 7 expect() calls
Ran 7 tests across 3 files.
```

`src/formatter.ts` vs `src/reader.ts` is identical modulo the function name and header comment (verified with `diff`).

## Audit

- **Skinner A:** SHIP — no findings; contract, mirror fidelity, scope, and trailers all independently verified by running the proof.
- **Skinner B:** SHIP — no findings; additionally exercised `formatter` on malformed/`null`/array/empty input via `bun -e`, confirmed never-throws + fallback.
- **Tracker (`tracker-C2-final.md`):** APPROVE — 0 rule violations, diff rules-clean. `bun test` green.

## Harness gaps

- matched: none
- minted: G-002
- suppressed: 0
- flagged fingerprints: none
- open ids awaiting adjudication: G-002
- unparsed HG-candidate blocks: none
- proposals: pending Scout adjudication

<!-- gap-gate v1 card=C2 base=95ad60a554e366b666cc0fe7a8e7d244e84d30b3 head=199c6980999dd13023de0e007021088dfafd4d62 minted=G-002 matched=none debt-delta=0 ledger=fecfb0f4825e446dec23981b298a1bee500dc15a5ce89990c6e69c4964bb0974 -->

### Scout governance proposals (for closing-pass ratification — not yet ruled)

**G-002 → dismissed-duplicate of G-001.** G-002 shares G-001's exact fingerprint
(`grep -rn "as string" src/`) and exact category (`input-validation`). It is not a
new defect class — `src/formatter.ts` is the 5th hit on the identical unchecked-cast
wall G-001 already meters; `hits_at_detection` 4→5 is a cumulative meter of one
spreading pattern, not a distinct issue. Proposed: dedupe/merge G-002 into G-001 and
treat G-001's meter as standing at 5.

**Debt (home for the deduped G-001/G-002 pair) — created later by ratified gap-rule.ts, not now:**
- Check command: `grep -rn "as string" src/`
- Description: All 5 `src/` modules (`loader`, `parser`, `writer`, `reader`, `formatter`)
  return `JSON.parse(input).value as string` under an empty `catch {}`. The cast is
  runtime-unchecked and the catch only guards parse failures, so the "bad input yields
  fallback" contract breaks on shape/type failures — verified: `formatter("5","f")`,
  `formatter("{}","f")`, `formatter("[]","f")` return `undefined` (not `"f"`), and
  `formatter('{"value":7}','f')` returns number `7` typed as `string`. Meter = fingerprint
  hit count (5). Subsumes G-001 and the deduped G-002.

**No new rule / anti-rule proposed for this PR.** The pattern is deliberate (plan's
Consistency wall) and pre-existing across all 5 modules; an enforceable rule would fire
on shipped/ratified code and contradict that decision. Recorded as a gated Tracker
candidate for after the debt is scheduled for a fix.

Campaign: after-fix

