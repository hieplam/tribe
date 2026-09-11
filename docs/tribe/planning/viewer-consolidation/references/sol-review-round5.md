## Round-4 closure audit

| Round-4 finding | Status | Revision-6 evidence and named proof |
|---|---|---|
| Blocker 1 — D16 wall conflicts with tooling/token build | **OPEN** | D18 scopes the wall correctly in [spec.md:1827](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1827) and [plan.md:803](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:803), but Task 14 then again refuses filesystem imports “anywhere else in the package” except fixtures/e2e at [plan.md:817](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:817), which includes `tools/`. The named `structure.test.ts` therefore still has contradictory scope. The copy step is gone, but the replacement import is broken; see new Blocker 1. |
| Blocker 2 — one address cannot expand both tool halves | **CLOSED** | D19 gives `tool` nodes `call` and `resultAnchor` at [spec.md:503](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:503). Task 9 asserts distinct addresses in `pair.test.ts` at [plan.md:576](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:576); Task 18 exercises `/api/block` in `serve.reads.test.ts`; Task 25 asserts both client fetches in `agents.test.tsx` at [plan.md:1414](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1414). |
| Blocker 3 — exact 500-node trim loses part of a row | **CLOSED** | D20’s whole-row algorithm and post-trim pairing are explicit at [spec.md:925](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:925). `serve.reads.test.ts` forces a four-block boundary row at [plan.md:1022](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1022), and `rowStore.test.ts` asserts orphan re-pairing after back-fill at [plan.md:1351](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1351). |
| Should-fix 1 — third fixture symlink undefined | **CLOSED** | Task 1 now names and asserts all three symlinks—escaping, in-session, sibling-session—in `fixtures/build.test.ts` at [plan.md:213](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:213). |
| Should-fix 2 — rotation says both tail window and byte zero | **CLOSED** | Both normative locations now require the normal tail window: [spec.md:782](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:782) and [spec.md:1883](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1883). Named proofs are `tail.test.ts`, `poller.adapter.test.ts`, and `live-tail.e2e.test.ts` at [plan.md:1085](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1085). |
| Should-fix 3 — real versus fake campaign HOME | **OPEN** | Task 32 correctly declares `homeB` fake at [plan.md:1802](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1802), but its implementation step still orders deletion of homes created “under `~/.tribe`” and discusses mutation of the owner’s real state at [plan.md:1837](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1837). Because the entire task is copied verbatim into the hunter brief, `campaign-badge.e2e.test.ts` still has conflicting authority. |

## Goal-proof assessment

| Goal | Assessment |
|---|---|
| G1 | **Proxy in one clause.** `dom-kinds.e2e.test.ts` directly proves rendering, but checks projects and kinds—not that every fixture session is listed. |
| G2 | **Direct.** Controlled writer clock, DOM arrival, actual `scrollTop`, parent/subagent append, reconnect, rotation. |
| G3 | **Direct but unsafe brief.** Real runner, exact stdout, opened URL, DOM badges and click. The fake-HOME contradiction remains above. |
| G4 | **Proxy in one clause.** Containment, no-write, catches and headers are direct; no named test proves that the socket binds only to `127.0.0.1`. |
| G5 | **Direct.** Deletion guard plus actual diff statistics. |
| G6 | **Direct in intent, currently unexecutable.** Served hashes, installer test, package gates and C3 are correct proof forms, but the prescribed CSS import cannot resolve. |

**Proxy goals: G1 and G4.**

## B1–B16 construction check

| Defect | Status | Closing section |
|---|---|---|
| B1 historical/live tool-result loss | Closed | §6.3 post-trim pairing, §6.4 patches, §7.5 orphan results |
| B2 array prompts | Closed | §7.2 and §16.2 |
| B3 state-derived traversal | Closed | §9 and §12.2 |
| B4 stream frozen to current card | Closed | §3.2 standalone session routes and §9 badge-only campaigns |
| B5 blank unresolved campaign shell | Closed | `/live` deletion and §3.2 client-routed missing-session behavior |
| B7 auto-scroll | Closed | §8.3 |
| B9 empty thinking cards | Closed | §7.2 named exception |
| B12 truncation/rotation duplication | Closed | §6.1 and §13 |
| B13 unbounded connection state | Closed | §6.5 |
| B14 bad arguments | Closed | §13 |
| B16 Host/Origin | Closed | §12.5 |

## Five real-transcript shapes

| Shape | On-disk evidence | Contracted behavior |
|---|---|---|
| Array-content prompt | [transcript:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3) | `prompt`; text asserted separately in the DOM |
| `tool_result`, `is_error:true` | [transcript:19](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19) | Paired `tool` with `state:"error"`; otherwise `orphan_result` |
| Empty thinking | [sidecar:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3) | No node; absence asserted |
| Persisted output | [transcript:50](/Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50) | Preview plus lazy, contained `/api/spill` expansion |
| Compaction boundary | [transcript:2438](/Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2438) | `divider` labelled “context compacted” |

All five normalizer outcomes match the real row shapes.

## Purity, SSE, order, and fence

- Decision logic is assigned to core; adapters observe/execute. No core I/O is specified.
- Transcript and campaign paths receive lexical and resolved containment before reads. External JSON identifiers used only as lookup keys never become paths.
- Parse errors and filesystem errors have narrow, distinct outcomes and named tests.
- The prompt’s byte-offset-resume premise is superseded by D12: `id:` is a per-connection sequence, `Last-Event-ID` is ignored, and reconnect replaces the store with a fresh generation. Connected rotation resets to a new tail window; disconnected rotation needs no special handling. `retry: 2000` and mid-stream subagent `meta` are coherent and tested.
- Task 1 precedes lifecycle implementation, but its revision-6 fixture inventory is now incomplete—new Blocker 2.
- Governance closes every phase: Tasks 3, 14, 21, 26, 29, 33.
- Hunter briefs carry the task, intent fences, oracle, and adjudication block verbatim.
- D9, `install.sh`, both runner stdout lines, c3-215 rows, and the deletion inventory are scheduled. The live D9 grep currently has eight hits rather than the claimed seven because `## Status viewer` is also a hit; Task 29 explicitly requires correcting the inventory if the live grep differs, so this is self-refuted as an omission.
- No forbidden runner-log or additional `~/.tribe` read has entered scope.

## New findings against revision 6

### Blocker

1. **The prescribed Sea Salt import resolves to a nonexistent path.**

   - File: [spec.md:1340](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1340), [plan.md:1215](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1215), [plan.md:1235](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1235)
   - Claim: Task 22 cannot pass its build gate as written.
   - Evidence: From `V/client/src/styles/index.css`, `../../../../docs/...` resolves to `plugins/tribe/scripts/docs/...`, which does not exist. The real file requires seven parent traversals to reach repo-root `docs/`. Task 22’s create list also omits `client/src/styles/index.css`.
   - Self-refutation: Vite can import CSS outside its client root, so the architecture is viable. It cannot make an incorrect relative path resolve to the real file.

2. **Revision 6 removed the foundational fixture inventory while downstream tasks still depend on it.**

   - File: [spec.md:2032](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2032), [spec.md:2062](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2062), [plan.md:208](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:208), [plan.md:1089](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1089), [plan.md:1755](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1755)
   - Claim: Task 1 no longer defines fixtures required by Tasks 18, 19 and 31.
   - Evidence: The spec now says “`homeA` writes:” and immediately begins describing the E2E test. Task 1 asserts four transcript files but defines only session 1’s content. Later tasks refer to “the fixture’s rotation pair” and “task 1’s fourth fixture session” containing over 2,000 nodes; neither is created or asserted in Task 1. The boundary-straddling four-block corpus is likewise not required there.
   - Self-refutation: Downstream tasks describe how they intend to use those shapes. That is too late for the `fixtures-mirror-reality` requirement: the foundational fixture must define and verify them before lifecycle implementation.

3. **The plan still gives the image proof mutually exclusive network assertions.**

   - File: [spec.md:2091](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2091), [plan.md:1411](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1411), [plan.md:1643](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1643)
   - Claim: `dom-kinds.e2e.test.ts` cannot implement both its task and the corrected spec.
   - Evidence: The spec requires zero requests before expansion and exactly one `/api/block` request on expansion. Task 25 agrees. Task 30 instead requires the expanded image while its browser request log shows “no network fetch for those bytes.”
   - Self-refutation: A `data:` image causes no subsequent image-resource request, but the bytes first arrive through `/api/block`; that request is precisely what the plan denies.

4. **G1’s named proof does not prove that every fixture session is listed.**

   - File: [spec.md:212](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:212), [spec.md:2096](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2096), [plan.md:1625](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1625)
   - Claim: The “lists every session” clause is proxy-proved.
   - Evidence: The DOM test asserts rendered node kinds, two projects, the older-project link, and one opened session. It never compares the rendered `SessionRow` set/count with all sessions created in the fixture.
   - Self-refutation: Tasks 17 and 23 test API/list components. The spec explicitly requires user-visible goals to be proved through the real browser, so those are supporting proxies for this clause.

5. **G4’s named proof does not prove loopback-only binding.**

   - File: [spec.md:217](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:217), [spec.md:1722](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1722), [plan.md:1137](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1137)
   - Claim: `serve.security.test.ts` proves header filtering, not that `Bun.serve` binds only to `127.0.0.1`.
   - Evidence: The task asserts accepted/rejected `Host` and `Origin` values but never asserts the configured hostname or attempts access through a non-loopback interface. A server bound to `0.0.0.0` would pass every named assertion.
   - Self-refutation: Host checking reduces the exposure, but it is not equivalent to the goal’s explicit network-binding guarantee.

### Should-fix

1. **Task 19’s hunter rationale still says byte-offset resume is part of the design.**

   - File: [plan.md:164](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:164), [plan.md:1069](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1069)
   - Claim: The verbatim hunter brief contradicts D12.
   - Evidence: It says Task 19’s complexity is “resume-by-byte-offset” while [plan.md:87](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:87) says any such mention is wrong.
   - Self-refutation: Task 19’s actual assertions correctly require fresh-snapshot reconnect and ignored `Last-Event-ID`, so this is misleading authority rather than a missing runtime test.

### Optional

1. **The revision-6 edit left two unfinished evidence bullets.**

   - File: [spec.md:2163](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2163)
   - Claim: The reconnect bullet ends in a dangling em dash, and the rotation bullet has trailing whitespace.
   - Evidence: `git diff --check 502ce0e..4b29ea5` reports both lines.
   - Self-refutation: Task 31 restates both assertions completely, so behavior remains decidable.

No files were modified. A concurrent untracked `references/terra-spec-v5-round2.txt` was present at final status; I did not read or alter it.

REWORK — round-4 D16/fake-HOME contradictions remain open; G1 and G4 are proxy-proved; the token import, fixture inventory, and image-request contracts are currently unsatisfiable.


sol exit=0
