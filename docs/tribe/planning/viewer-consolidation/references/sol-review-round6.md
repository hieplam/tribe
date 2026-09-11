## Round-5 closure audit

| Round-5 item | Status | Revision-7 evidence and named proof |
|---|---|---|
| R4 open — D16 wall incorrectly covered `tools/` | **CLOSED** | Task 14 now defines `COVERED` and `OUTSIDE` explicitly and prevents runtime imports from `tools/`; proved by `structure.test.ts` ([plan.md:846](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:846)). |
| R4 open — campaign E2E ambiguously touched real `~/.tribe` | **CLOSED** | Task 32 confines both campaigns and teardown to synthetic `homeB`; proved by `campaign-badge.e2e.test.ts` ([plan.md:1902](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1902), [plan.md:1937](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1937)). |
| B1 — Sea Salt import path nonexistent | **CLOSED** | Seven-parent path is specified and `index.css` is in Task 22’s create list; `bun run build`, `served-build.e2e.test.ts`, and `test-install-viewer-build.sh` prove it resolves ([plan.md:1290](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1290), [plan.md:1311](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1311)). |
| B2 — foundational fixture inventory missing | **CLOSED** | Task 1 now enumerates every downstream shape, exact session-4 counts, rotation pair, three projects, symlinks and campaigns; proved before implementation by `fixtures/build.test.ts` ([plan.md:204](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:204), [plan.md:216](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:216)). A new count-unit defect remains below. |
| B3 — image proof required mutually exclusive requests | **CLOSED** | Task 30 now requires zero payload requests before expansion, exactly one `/api/block` request on expansion, then a displayed data URL; proved by `dom-kinds.e2e.test.ts` ([plan.md:1724](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1724)). |
| B4 — G1 did not prove every fixture session was listed | **CLOSED** | Task 30 compares DOM session IDs by set equality in default and `?all=1` views; proved by `dom-kinds.e2e.test.ts` ([plan.md:1738](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1738)). |
| B5 — G4 did not prove loopback-only binding | **CLOSED** | Task 20 asserts configured hostname and refusal through a non-loopback interface; proved by `serve.security.test.ts` ([plan.md:1207](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1207)). |
| S1 — Task 19 rationale says byte-offset resume | **OPEN** | A grep of both subject files finds one surviving occurrence: [plan.md:1138](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1138). The earlier model-selection occurrence was corrected, but the verbatim Task 19 brief was not. |
| O1 — unfinished reconnect/rotation evidence bullets | **CLOSED** | Both bullets are complete and point to fresh-generation replacement and tail-window rotation; proved by `live-tail.e2e.test.ts` ([spec.md:2280](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2280)). `git diff --check` reports no whitespace error. |

## Contract checks

All G1–G6 now map to direct named tests or measurements. **No goal remains proxy-proved.** G1 uses DOM kind/shape coverage and complete session-set equality; G2 uses the writer’s clock and actual `scrollTop`; G3 runs the real runner; G4 combines containment, structural enforcement, runtime hashing and network binding; G5 uses a grep guard plus actual diff statistics; G6 hashes the real built-and-served `dist/`, exercises `install.sh`, and runs package/C3 gates.

The requested current-viewer defects are closed by construction:

| Defect | Closing spec section |
|---|---|
| B1 | Post-trim pairing and visible orphans in §6.3/§7.5; live replacement in §6.4 |
| B2 | String and array prompts in §7.2 |
| B3 | State identifiers remain lookup keys in §9; two-stage containment in §12.2 |
| B4 | Standalone session routes in §3.2 and badge-only campaign filtering in §9 |
| B5 | `/live` removed in §3.2 and §11 |
| B7 | Numeric follow-tail state in §8.3 |
| B9 | Explicit empty-thinking exception in §7.2 |
| B12 | Inode/truncation reset to a tail window in §6.1 |
| B13 | Numeric bounds for every per-stream structure in §6.5 |
| B14 | Typed CLI/startup refusals in §13 |
| B16 | Host/Origin gate in §12.5 |

Purity and fail-closed placement are otherwise sound: decisions reside in core; adapters observe/read and execute returned decisions. Transcript and campaign paths receive lexical plus resolved containment before opening. File JSON, filesystem errors, pid probes and argument errors have distinct narrow outcomes and named tests.

The SSE contract is coherent under D12, which supersedes byte-offset resume: `id:` is per-connection sequence state, `Last-Event-ID` is ignored, and reconnect installs a fresh generation and snapshot. Connected truncation/rotation sends `reset` plus the normal tail window; disconnected rotation is covered by the new snapshot. A sidecar appearing mid-stream produces `meta`. The only contradiction is the stale Task 19 rationale reported above.

The five requested real shapes agree with the normalizer contract:

| Real row | Contracted result |
|---|---|
| Array user prompt ([transcript:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3)) | `prompt`, with its array text asserted in the DOM |
| Error `tool_result` ([transcript:19](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19)) | Paired `tool` in error state, otherwise visible `orphan_result` |
| Empty thinking ([sidecar:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3)) | No node; absence explicitly asserted |
| Persisted-output marker ([transcript:50](/Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50)) | Preview plus contained, lazy `/api/spill` expansion |
| Compaction boundary ([transcript:2439](/Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2439)) | `divider` labelled “context compacted” |

Task ordering also conforms: Task 1 builds and manually verifies the empty fixture before lifecycle implementation; Tasks 3, 14, 21, 26, 29 and 33 close their phases with governance; hunter briefs carry the task, intent fence, oracle and adjudication rule verbatim. D9, `install.sh`, both runner stdout lines, c3-215 rows and the deletion inventory are scheduled. No forbidden runner-log or additional `~/.tribe` read entered scope.

## New findings against revision 7

### Blocker

1. **The new D21 fixture count does not prove that the 2,000-rendered-node client cap is crossed.**

   - File: [spec.md:2152](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2152), [spec.md:2157](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2157), [plan.md:233](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:233), [plan.md:243](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:243)
   - Claim: Task 1’s named fixture proof can pass while Tasks 24 and 31 cannot exercise tail eviction or the “N new below” pill.
   - Evidence: Revision 7 pins 2,600 **pre-pairing candidates** and concludes this exceeds the 2,000-node client cap. D21 explicitly says post-pairing rendered count may be lower, while the client cap applies to rendered nodes ([spec.md:1082](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1082)). Enough paired results can reduce 2,600 candidates below 2,001 rendered nodes. `fixtures/build.test.ts` is told to assert only the pre-pair count.
   - Self-refutation: The fixture author could choose session-4 rows that do not pair, making both counts 2,600. Nothing in the fixture contract or its named test requires that choice or asserts the post-pair rendered count, so the claimed downstream reachability is not guaranteed.

2. **The new `homeB` hash wording makes the campaign DOM suite’s required writes look like a G4 failure.**

   - File: [spec.md:2219](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2219), [spec.md:2302](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2302), [plan.md:1902](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1902)
   - Claim: The spec now requires a byte-identical whole-`homeB` digest across “every DOM suite,” while Task 32 deliberately runs the real runner inside `homeB`.
   - Evidence: The runner must create/update campaign state and `run.json` during `campaign-badge.e2e.test.ts`; the badge’s session assignment and alive/dead transition depend on those mutations. Consequently a digest including `homeB/.tribe` cannot remain byte-identical across that suite. The plan schedules the hash only in Task 30 over `homeA`, so spec and plan now disagree.
   - Self-refutation: A viewer-only hash could be taken after runner setup and around an isolated browser-read interval. Neither document defines that interval; the current language says before/after the suite, while Task 32 requires runner mutations throughout.

3. **Task 18 gives `truncatedBefore` two incompatible definitions.**

   - File: [plan.md:1096](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1096), [plan.md:1099](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1099), compared with [spec.md:993](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:993)
   - Claim: `serve.reads.test.ts` cannot implement both assertions, and the wrong one can hide reachable history.
   - Evidence: The task first says the flag is true iff any row precedes the retained anchor, then says it is true iff the backward scan did not reach BOF. When a scan reaches BOF but whole-row trimming removes a prefix, BOF was reached and rows still precede the retained anchor. The spec explicitly includes that case.
   - Self-refutation: The second sentence could have intended “the retained window starts after BOF,” but it expressly says “BOF was not reached,” the opposite condition. This line predates revision 7 but remains a current, newly detected blocker.

### Should-fix

1. **Task 19 still describes a removed resume mechanism.**

   - File: [plan.md:1138](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1138)
   - Claim: The verbatim hunter brief still contradicts D12.
   - Evidence: Grepping both subject files for `resume-by-byte-offset`, `resume-by-offset`, and `resume by byte offset` found this single surviving occurrence.
   - Self-refutation: Task 19’s actual assertions correctly require ignored `Last-Event-ID` and fresh-snapshot reconnect, so runtime behavior remains decidable; only the governing rationale is stale.

No files were modified. Final status shows only the concurrently created, unread untracked `references/terra-spec-v7-round3.txt`.

REWORK — pre/post-pair fixture counts, the impossible `homeB` whole-suite hash, and contradictory `truncatedBefore` semantics are blockers; remove the stale Task 19 resume rationale.


sol exit=0
