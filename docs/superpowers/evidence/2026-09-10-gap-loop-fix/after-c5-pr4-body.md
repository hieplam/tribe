## C2 — add `src/formatter.ts` (fifth module)

Implements `docs/plans/add-formatter-plan.md` against `docs/specs/add-formatter-spec.md`:
a fifth module `formatter(input: string, fallback: string): string` mirroring `src/reader.ts`
line-for-line except the function name — parse `input` as JSON, return its `value`, return
`fallback` on any failure without throwing.

### Scope (spec Non-goals honored)
- New: `src/formatter.ts`, `test/formatter.test.ts`.
- Bookkeeping: `docs/plans/add-formatter-plan.md` checkbox ticks.
- Governance: `.tribe/harness-gaps.jsonl` (opened G-001 — see Harness gaps below).
- No existing module touched (`git diff aa26a8c..964906d -- src/reader.ts src/loader.ts src/parser.ts src/writer.ts` → empty).

### Consistency wall (verified mechanically)
`diff <(sed 's/reader/X/g' src/reader.ts) <(sed 's/formatter/X/g' src/formatter.ts)` → empty:
`formatter.ts` is identical to `reader.ts` after name normalization.

### Before / after evidence

**Before (RED — module missing, test fails for the right reason):**
```
test/formatter.test.ts:
# Unhandled error between tests
error: Cannot find module '../src/formatter.ts'
 5 pass
 1 fail
 1 error
Ran 6 tests across 3 files.
```
(exit 1)

**After (GREEN):**
```
bun test v1.3.14 (d1632b29)
 7 pass
 0 fail
 7 expect() calls
Ran 7 tests across 3 files. [9.00ms]
```
(exit 0)

### Audit
- Tracker (`tracker-C2-final.md`): APPROVE, 0 Blocker/Should-fix — scope, consistency wall, and `bun test` all pass.
- Two independent Skinners: 0 Critical. The one "Important" note (missing-`value` returns `undefined`) is a pre-existing gap inherited from `reader.ts` that C2 cannot fix without violating its own consistency wall + Non-goals; recorded as harness gap G-001 below rather than fixed here.

## Harness gaps

- matched: none
- minted: G-001
- suppressed: 0
- flagged fingerprints: none
- open ids awaiting adjudication: G-001
- unparsed HG-candidate blocks: none
- proposals: pending Scout adjudication

<!-- gap-gate v1 card=C2 base=aa26a8c5035059fdd86e1e82e2a9b7266d9ae939 head=964906df099e0fa6cc99011d2b68fe2396049576 minted=G-001 matched=none debt-delta=0 ledger=3593578821aa5449e0337618a5b9876dacfdc3a04d0265c3b8a4e9f5caae3182 -->

### G-001 — input-validation — proposed: DEBT (Scout adjudication; ratified by the campaign closing pass, not here)
- Fingerprint: `grep -rl "value as string" src/`  (hits at detection: 5; category: input-validation)
- Finding: all five sibling modules (loader, reader, parser, writer, formatter) run
  `return JSON.parse(input).value as string;` inside `try { ... } catch {}`. For JSON that
  parses without throwing but lacks a string `value` (e.g. `'{}'`, `'5'`), `.value` is
  `undefined`; `JSON.parse` does not throw, the `catch` never fires, and the function returns
  `undefined` typed as `string` instead of the caller's `fallback`. The `as string` cast hides
  it from the type checker; the edge fails OPEN, contradicting each module's "bad input yields
  the fallback" contract. No test covers the missing-`value` shape. Confirmed by both Skinners.
- Proposed disposition: DEBT. A rule cannot be enforced now — C2's spec Non-goal ("No changes
  to the existing modules") and the consistency wall ("mirror src/reader.ts line for line") bar
  any in-flight card from clearing the 5 existing violations, so a rule would leave permanent
  standing violations. Not a clean duplicate of machine-global `fail-closed-edges.md` (adjacent,
  but does not name the unvalidated-`as`-cast fail-open shape). The fix is inherently
  cross-module and belongs to a dedicated future card.
- Recorded check command (single grep, no shell metacharacters):
    grep -rl "value as string" src/
  Meter: number of files listed (currently 5). CLOSED when it returns zero files — i.e. every
  module validates the parsed `value` is a string and otherwise returns `fallback` (fails closed).
- Deferred rule candidate (NOT for ratification until the debt is paid; would extend
  `fail-closed-edges.md`): "Never return `JSON.parse(...).<key> as T` directly — a successful
  parse missing that key yields `undefined` and the catch never fires; validate the parsed
  shape and return the fallback/refusal on any non-conforming shape (fail closed, never return
  `undefined`)."
- Constraints honored: proposal only. No `ruled` event, no debt entity / `.c3/documents/debt/`
  file created, no source edited, no self-ratification. Awaiting the campaign closing pass.

