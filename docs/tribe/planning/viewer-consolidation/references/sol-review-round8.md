## Round-7 closure audit

| Round-7 finding | Status | Revision-10 evidence |
|---|---|---|
| R6-B1 — rendered-count proof is phase-circular | **OPEN** | Plan Task 9 correctly assigns `fixtures/session4.rendered.test.ts` to the real normalizer/pairer ([plan.md:686](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:686)), but spec §16.2 still requires `fixtures/build.test.ts` to assert all three counts using pairing ([spec.md:2392](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2392)). |
| N1 — non-disjoint normalizer partition | **OPEN** | The precedence ladder fixes the previously listed overlaps ([spec.md:1276](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1276)), but it cannot classify a real row containing both a paired `tool_result` and text without either dropping the text or producing two outcomes. Furthermore, Task 8 requires the Patch rung before Task 9 creates `core/pair.ts` ([plan.md:625](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:625), [plan.md:671](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:671)). Named test: `normalize.coverage.test.ts`. |
| N2 — backward snapshot cannot cross oversized rows | **OPEN** | The new algorithm is explicit, but its “contains any newline” stopping condition still leaves no complete row or next anchor when the only newline is the oversized row’s terminator ([spec.md:1052](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1052)). Named test: `serve.reads.test.ts`, but only a 2 MiB case is prescribed. |
| N3 — production E2 cannot access dev-only reconnect hooks | **CLOSED** | D25 makes both hooks production-visible ([spec.md:1630](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1630)); Task 24 asserts their presence in a production build ([plan.md:1593](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1593)). Named tests: `useEventStream.test.ts`, `live-tail.e2e.test.ts`. One stale label remains below as a new Should-fix. |
| R6-S1 — removed offset resume remains in Task 19 | **CLOSED** | A grep of both documents found no affirmative offset-resume instruction outside quoted/removal explanations. Task 19 now explicitly says there is no resume ([plan.md:1268](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1268)) and `serve.events.test.ts` asserts fresh-snapshot reconnect ([plan.md:1298](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1298)). |
| N4 — ambiguity boolean cannot supply a count | **CLOSED** | `SessionSummary.projects: string[]` carries the complete set ([spec.md:467](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:467)). Named tests: `core/scan.test.ts` and `client/src/components/list.test.tsx` ([plan.md:1133](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1133), [plan.md:1507](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1507)). |

## Contract checks

Every G1–G6 goal has a named test or measurement in the plan. Two proofs remain proxies:

- **G1:** `dom-kinds.e2e.test.ts` proves output kinds and selected input shapes, but its fixture omits a real mixed `tool_result`+text row; it can pass while losing the prompt text.
- **G6’s D9 leg:** the zero-hit grep proves words disappeared, not that each surviving consumer was renamed truthfully. The current expected rewrite falsely changes a viewer consumer into a watchdog.

G5’s proof is not a proxy but is currently unsatisfiable because `core/model.ts` is simultaneously required and listed as deleted.

Construction status for the requested historical defects:

- **Not closed:** B1 and B2, because the mixed user row below can lose its text when the paired result claims the whole row.
- **Closed:** B3 (§9, §12.2), B4 (§9), B5 (§3.2, §13), B7 (§8.3), B9 (§7.2), B12 (§6.1), B13 (§6.5), B14 (§13), B16 (§12.5). B12’s duplicate-replay mechanism is closed, although the replacement snapshot still encounters the D24 blocker.

Purity and fail-closed placement is otherwise sound: decision logic is assigned to `core/**`; adapters observe/read; `serve.ts` composes. Transcript, sidecar, spill, project, campaign-directory, `campaign-state.json`, and `run.json` paths receive lexical and resolved containment before opening. State-file `sessionId` is only a lookup key and `statePath` is ignored. Parse and filesystem failures are separated.

The SSE design intentionally follows D12 rather than byte-offset resume: `id:` is per-connection sequence, `Last-Event-ID` is ignored, `retry: 2000` is emitted, and reconnect produces a new generation and fresh snapshot. Rotation/truncation and mid-stream subagent discovery are specified and tested, but the D24 snapshot algorithm remains incoherent across large rows.

The five requested on-disk shapes are individually mapped correctly:

| Real shape | Contracted behavior |
|---|---|
| Array user prompt, [transcript:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3) | `prompt` (§7.2) |
| Error `tool_result`, [transcript:19](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19) | Paired error-state `tool`, otherwise `orphan_result` (§7.5) |
| Empty thinking, [sidecar:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3) | Silent by design (§7.2) |
| Persisted output, [transcript:50](/Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50) | Preview plus contained `/api/spill` expansion (§7.6) |
| Compaction boundary, [transcript:2439](/Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2439) | `divider`, “context compacted” (§7.4) |

Task 1 is the empty-fixture task before implementation. Phase-end governance exists at Tasks 3, 14, 21, 26, 29, and 33. Hunter briefs carry the oracle, governing constraints, and adjudication rule verbatim. D9, the plugin `install.sh` build, runner stdout lines, c3-215 changes, and deletion work are scheduled, subject to the blockers below.

## New findings in revision 10

### Blocker

1. **D22 still has two incompatible owners for the rendered-count proof.**

   - File: [spec.md:179](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:179), [spec.md:2392](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2392), [plan.md:686](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:686)
   - Claim: Revision 10 did not completely apply D22.
   - Evidence: D22 and Task 9 assign the rendered assertion to `fixtures/session4.rendered.test.ts`; §16.2 still assigns it to Task 1’s `fixtures/build.test.ts`, recreating the original dependency cycle.
   - Self-refutation: The implementer could treat the top-level ruling as higher priority, but the spec calls §16.2 the complete evidence contract; silently choosing between them is not a valid plan.

2. **D23’s row-level first-match ladder under-renders a real mixed-content user row.**

   - File: [spec.md:1285](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1285), [agent-a095…jsonl:32](/Users/hip/.claude/projects/-Users-hip-repo-tribe/5f01ddc5-21b5-4249-bcfb-c6d3d368d79d/subagents/agent-a09522dcffd66dd8a.jsonl:32), [agent-a095…jsonl:33](/Users/hip/.claude/projects/-Users-hip-repo-tribe/5f01ddc5-21b5-4249-bcfb-c6d3d368d79d/subagents/agent-a09522dcffd66dd8a.jsonl:33)
   - Claim: “Exactly one outcome per row” is not total over the disk oracle.
   - Evidence: Row 33 contains a paired `tool_result` and a separate user `text` block. Rung 3 claims the row as a Patch before rung 4, dropping the prompt; emitting both a Patch and prompt violates the one-outcome claim.
   - Self-refutation: Classification could be refined so mixed rows reach a composite node-emitting outcome, but neither spec nor fixture defines such an outcome; the current first-match wording explicitly stops at rung 3.

3. **The D23 coverage proof requires pairing before the pairer exists.**

   - File: [plan.md:618](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:618), [plan.md:625](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:625), [plan.md:671](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:671)
   - Claim: Task 8 cannot prove that paired results stop at the Patch rung.
   - Evidence: Task 8 must finish `normalize.coverage.test.ts` green with rung-3 Patch outcomes; `core/pair.ts` and pairing tests are not created until Task 9.
   - Self-refutation: Task 8 could duplicate or prematurely implement pairing, but Task 9 owns that behavior and D22 expressly forbids duplicate pairing logic.

4. **The D24 backward algorithm still cannot advance across the row it was added to handle.**

   - File: [spec.md:1052](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1052), [spec.md:1104](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1104), [plan.md:1197](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1197)
   - Claim: “Slice contains a newline” is not sufficient to identify a previous complete row.
   - Evidence: When `anchor` is the row after a 2 MiB row, the slice contains that large row’s terminating newline at `anchor-1`, so growth stops immediately. Dropping the leading partial row leaves zero rows, making “first complete row” undefined. For a row exceeding 8 MiB, the fallback anchors and emits at `anchor-step`, then repeats, potentially producing multiple raw nodes for one row.
   - Self-refutation: A backward discard state could scan until the true preceding boundary without retaining the whole row, but that mechanism is absent; the stated algorithm and test do not define it.

5. **The G5 deletion guard requires the new wire model not to exist.**

   - File: [spec.md:1917](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1917), [spec.md:1962](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1962), [plan.md:340](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:340), [plan.md:1787](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1787)
   - Claim: `deletion-guard.test.ts` cannot pass while the required architecture exists.
   - Evidence: §11.1 lists `core/model.ts` under “Files deleted outright,” and guard rule 3 requires every listed path to be absent. Task 2 simultaneously creates the replacement at exactly `core/model.ts`.
   - Self-refutation: “Deleted” could mean only the old contents were replaced, but rule 3 checks path nonexistence, not content replacement.

6. **The D9 sweep renames a real viewer responsibility into “watchdog.”**

   - File: [spec.md:1684](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1684), [spec.md:1696](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1696), [spec.md:2235](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2235), [plan.md:1834](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1834)
   - Claim: Sites 3–4 would document the wrong component and contradict G3/D8.
   - Evidence: §9 requires the viewer to read `run.json` and derive `runnerAlive`; §15 instead says “the viewer never reads `run.json` for liveness” and orders those references changed to watchdog.
   - Self-refutation: The watchdog also consumes operational state, but that does not erase the viewer’s explicit `run.json` badge responsibility; D9 retires process names, not truthful references to the viewer.

### Should-fix

1. **One affirmative “dev-only” hook remnant survives.**

   - File: [spec.md:2531](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2531)
   - Claim: E2 still describes `__viewerReconnect()` as dev-only.
   - Evidence: The complete grep across both documents found this sole affirmative remnant; other “dev-only” occurrences explain that the restriction was removed.
   - Self-refutation: D25, §8.4, and Task 24 clearly make the hook production-visible, so the test is executable; this is stale governing prose, not the original blocker.

2. **`raw.text` conflates oversized and unreadable nodes.**

   - File: [spec.md:589](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:589), [spec.md:595](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:595), [spec.md:2169](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2169), [plan.md:709](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:709)
   - Claim: Task 9 requires a `raw`/`unreadable` case that the wire union says is a different node kind.
   - Evidence: `RenderNode` defines `k:"unreadable"` separately, and §13 uses it for parse failures; the new `raw.text` comment and test nevertheless say an unreadable skip count is a `raw` label case.
   - Self-refutation: A synthetic `raw` node with `rowType:"unreadable"` is type-valid, but it would contradict the explicit failure table and make the separate `unreadable` kind redundant.

Read-only note: I made no changes. A concurrent untracked `terra-spec-v10-round3.txt` appeared during the review; I did not read or modify it. The C3 check could not complete because its wrapper attempted an unavailable npm registry lookup.

REWORK — close D22’s surviving Task-1 contradiction, make D23 work for mixed rows and phase ordering, repair the backward oversized-row algorithm, reconcile the deletion guard, and correct the D9 consumer mapping; then remove the two stale wire-contract remnants.


sol exit=0
