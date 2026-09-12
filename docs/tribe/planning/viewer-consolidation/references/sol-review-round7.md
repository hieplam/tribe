Scope note: the worktree has advanced to revision 9 (`50e3154`), so I reviewed the current files rather than the superseded revision-8 snapshot.

## Round-6 closure audit

| Round-6 finding | Status | Current evidence |
|---|---|---|
| B1 — fixture proves only pre-pairing count | **OPEN** | Task 1 now requires `fixtures/build.test.ts` to obtain the ≥2,300 rendered count by running the production normalizer and pairer ([plan.md:247](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:247)), but those modules are not created until Tasks 7 and 9 ([plan.md:559](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:559), [plan.md:636](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:636)). Task 1 must finish green before either exists. |
| B2 — whole-`homeB` digest conflicts with runner writes | **CLOSED** | The per-suite contract now hashes only `homeB/.claude` after the runner exits and around the viewer-only interval; named proof: `campaign-badge.e2e.test.ts` ([spec.md:2341](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2341), [plan.md:2034](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:2034)). |
| B3 — two incompatible `truncatedBefore` definitions | **CLOSED** | It is now true iff any row precedes the retained anchor, including BOF-reached-plus-trim; named proof: `serve.reads.test.ts` ([spec.md:1024](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1024), [plan.md:1148](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1148)). |
| S1 — removed resume mechanism survives in Task 19 | **OPEN** | See Should-fix S1 below. |

## Contract checks

- G1–G6 all map to named tests or measurements. None is merely a proxy on paper, but G2’s named browser proof is not executable as specified; see Blocker N3.
- B1, B2, B3, B4, B5, B7, B9, B12, B13, B14 and B16 are closed by the intended construction in §§6.3–6.5, 7.2, 7.5, 8.3, 9, 11, 12.2, 12.5 and 13. The findings below concern contradictions in proving or implementing that construction.
- Decision logic is assigned to core; filesystem, clock and process observation stay at adapters/composition. Transcript and campaign paths receive lexical plus resolved containment before opening, including the two state files. Parse failures have narrow, distinct outcomes.
- Under D12, byte-offset resume is intentionally gone: `id:` is per-connection sequence state, `Last-Event-ID` is ignored, and reconnect receives a fresh generation and snapshot. Connected rotation/truncation and mid-stream sidecar discovery are specified, but the reconnect browser harness is presently contradictory.
- Phase-end governance tasks exist at Tasks 3, 14, 21, 26, 29 and 33. Hunter briefs carry the task, oracle, constraints and adjudication rule verbatim. The empty-fixture task is first, but its new production-normalizer assertion creates the circular dependency reported above.
- D9’s seven-site sweep, the plugin `install.sh` build, both runner stdout lines, c3-215 updates and the deletion list are scheduled. The live greps return exactly the seven D9 sites. No forbidden runner-log or additional `~/.tribe` read entered scope.

The five requested real transcript shapes map correctly:

| Disk shape | Contracted rendering |
|---|---|
| Array user prompt ([transcript:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3)) | `prompt` |
| `tool_result` with `is_error:true` ([transcript:19](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19)) | Paired error-state `tool`, otherwise visible `orphan_result` |
| Empty thinking ([sidecar:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3)) | Silent by design; absence asserted |
| Persisted output ([transcript:50](/Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50)) | Preview plus lazy, contained `/api/spill` expansion |
| Compaction boundary ([transcript:2439](/Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2439)) | `divider` labelled “context compacted” |

## Findings

### Blocker

1. **R6-B1 — Task 1’s post-pairing count proof depends on production modules created in later phases.**

   - File: [plan.md:195](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:195), [plan.md:247](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:247), [plan.md:559](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:559), [plan.md:636](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:636)
   - Claim: The round-6 rendered-count blocker remains open because its named Task 1 proof cannot run at Task 1.
   - Evidence: `fixtures/build.test.ts` must run the normalizer and pairing, but `core/normalize.ts` and `core/pair.ts` do not exist until Tasks 7 and 9. Task 1 nevertheless requires its fixture suite green before implementation proceeds.
   - Self-refutation: Task 1 could duplicate pairing logic locally, but that would be an unscheduled proxy rather than the production normalizer-and-pairer proof the plan explicitly requires.

2. **N1 — Revision 8’s “total and disjoint” normalizer partition is internally non-disjoint.**

   - File: [spec.md:1169](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1169), [spec.md:1179](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1179), [spec.md:1193](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1193), [plan.md:596](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:596)
   - Claim: `normalize.coverage.test.ts` cannot enforce the stated exact partition.
   - Evidence: A paired `tool_result` is both outcome (c), “became a Patch,” and outcome (d), because bucket 5 explicitly contains paired results. A title-source row is both folded outcome (b) and bucket-5 outcome (d). Attachment rows produce `attachment` nodes yet are also named under folded outcome (b).
   - Self-refutation: These could be ordered precedence categories, but both documents require “exactly one,” “total and disjoint,” and an exact bucket-5 set—not first-match classification.

3. **N2 — Oversized rows are handled only by the forward tail machine; the backward snapshot algorithm can make no progress across one.**

   - File: [spec.md:830](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:830), [spec.md:857](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:857), [spec.md:988](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:988), [plan.md:479](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:479)
   - Claim: Initial connection, reconnect and reset can hang or omit a row larger than the fixed 256 KiB backward step.
   - Evidence: The backward loop drops a leading partial row and then sets `anchor` to the first complete row. A slice wholly inside the acknowledged real 2 MiB row contains no newline and therefore has no first complete row or next anchor. The discard state and named test exist only in `advanceTail`, while snapshots use §6.3.
   - Self-refutation: An implementation could grow the backward slice or carry fragments between slices, but neither mechanism is specified or tested; adding one would require an implementer-owned algorithmic decision.

4. **N3 — Revision 9’s reconnect proof calls development-only hooks through a server that serves the production build.**

   - File: [spec.md:1521](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1521), [plan.md:1505](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1505), [plan.md:1918](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1918), [plan.md:1940](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1940)
   - Claim: `live-tail.e2e.test.ts`, G2’s named proof, cannot execute its reconnect steps.
   - Evidence: `window.__viewerEventSource` and `window.__viewerReconnect` must be absent from production builds, yet Task 31 serves the fixture through the real fixed-`dist/` server and invokes both hooks. No task starts a Vite development server or defines a development client artifact for E2.
   - Self-refutation: The suite could use a Vite dev server, but that mechanism is absent and would cease to prove behavior through the actual server/built-client path named by the plan.

### Should-fix

1. **R6-S1 — The Task 19 model rationale still names removed offset resume.**

   - File: [plan.md:1196](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1196)
   - Claim: The hunter brief still contradicts D12.
   - Evidence: The complete grep found five relevant occurrences: the quoted ruling at [spec.md:143](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:143) and [plan.md:56](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:56), correct removal statements at [spec.md:782](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:782) and [plan.md:184](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:184), and the sole remnant at `plan.md:1196`. The plan itself says such task text is wrong at [plan.md:96](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:96).
   - Self-refutation: Task 19’s actual assertions implement fresh-snapshot reconnect correctly, so this is stale governing rationale rather than an ambiguous runtime algorithm.

2. **N4 — `ambiguous:boolean` cannot carry the numeric project count the client is required to display.**

   - File: [spec.md:438](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:438), [plan.md:1433](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1433)
   - Claim: The wire contract supplies only a boolean, while Task 23 requires a note naming how many projects contain the ID.
   - Evidence: `/api/session` carries `SessionSummary`, and no count or collision-project list exists in that interface or response contract.
   - Self-refutation: The client could hard-code “2” for today’s measured case or say “multiple,” but neither implements the stated open-world numeric-count requirement.

### Optional

None.

No files were modified; the worktree remained clean.

REWORK — the rendered-count proof is phase-circular, the normalizer partition contradicts its own disjointness claim, oversized rows break backward snapshots, and the G2 reconnect proof cannot access its dev-only seam; the stale Task 19 rationale and ambiguity count also remain.


sol exit=0
