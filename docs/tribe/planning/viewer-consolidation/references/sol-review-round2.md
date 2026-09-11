## Source of truth

- Contract: [idea card](/Users/hip/.tribe/-Users-hip-repo-tribe/cards/viewer-consolidation.md:52), [STATE.md](/Users/hip/.tribe/-Users-hip-repo-tribe/viewer-consolidation/STATE.md:44), [spec.md](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1), and [plan.md](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1).
- Governance: `pure-core.md`, `fail-closed-edges.md`, `fixtures-mirror-reality.md`, `brief-contracts.md`, repository `AGENTS.md`, and applicable READMEs.
- Read-only throughout; no files were edited, created, staged, or committed.
- C3 seal/lookup remains unverified: the cached 11.6.3 binary exists, but the read-only sandbox prevented rebuilding `.c3/c3.db`; lookup then reported the cache unavailable.

## Round-1 closure ledger

| # | Round-1 finding | Status | Revision-2 closure and named proof |
|---|---|---|---|
| B1 | P1 gated only client work | **CLOSED** | Whole-build gate in [spec §8.2](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:927) and [plan Global Constraints/P1 check](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:27). Proof is the named three-part pre-dispatch P1 gate at plan lines 101–108. |
| B2 | Token interface did not match candidates | **CLOSED** | Candidate names are copied verbatim in [spec §8.2](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:875). `structure.test.ts` in Task 22 enforces the interface. Live inspection confirmed all three candidates define the listed names. |
| B3 | No wire operation for late tool results | **CLOSED, narrowly** | `Patch` is defined in [spec §4](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:344), with replacement/dedupe in §§6.4/8.4. Named tests: `core/pair.test.ts`, `poller.adapter.test.ts`, `rowStore.test.ts`, and `live-tail.e2e.test.ts`. Reconnect introduces a separate new blocker below. |
| B4 | SSE acknowledged partial-row bytes | **OPEN** | The new formula still fails when `TextDecoder({stream:true})` withholds an incomplete UTF-8 sequence; details below. The named `core/tail.test.ts` invariant cannot coexist with the specified formula. |
| B5 | Same/larger rotation undetectable | **CLOSED, narrowly** | `FileObservation.inode` and active-stream reset are specified in [§6.1](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:518). Named tests: `core/tail.test.ts`, `poller.adapter.test.ts`, `live-tail.e2e.test.ts`. Replacement while disconnected is a new blocker below. |
| B6 | G1/G2/G4/G6 proofs were proxies | **OPEN** | G2 and G6 materially improve, but G1’s DOM test cannot iterate a TypeScript union at runtime and checks only one element per `k`, not each required input shape. G3/G4 also retain uncovered real-world cases. |
| B7 | Stale v1 viewer reused | **CLOSED** | Deliberate v2 identity and three-way runner behavior in [spec §10.4](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1118). Named tests: `serve.security.test.ts` and `runner/core/viewer-launch.test.ts`. Accepted consequence (e) was not reported. |
| S1 | Decisions remained in adapters | **OPEN** | Line-boundary, cache-expiry, and tail decisions moved to core, but Task 16 still assigns the 200-campaign cap to `campaign.adapter.ts`; details below. |
| S2 | Symlink containment and narrow catches untested | **CLOSED, narrowly** | Named tests now exist: `paths.containment.test.ts`, `adapters/readonly.test.ts`, and `url-refusals.e2e.test.ts`. The chosen containment roots conflict with a real transcript shape, which is a new blocker below. |
| S3 | B13 unbounded stream state | **CLOSED** | Explicit bounds in [spec §6.5](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:651). Named tests: `pair.test.ts`, `rowStore.test.ts`, and ten-minute `perf.test.ts`. The 2,000-node policy introduces a separate access defect. |
| S4 | No mid-stream subagent test | **CLOSED** | `meta` contract in §6.2 and explicit case in [Task 19](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:833) plus `live-tail.e2e.test.ts`. |
| S5 | D9 expected five rather than seven hits | **CLOSED** | Exact seven-site table in [spec §15](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1390) and before/after grep in Task 29. The live grep returned exactly those seven. |
| S6 | C3 commands used unavailable entry points | **CLOSED in the plan** | Governance tasks consistently use `bunx @c3x/cli@11.6.3 … </dev/null`, starting at [plan line 40](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:40). Execution could not be verified in this read-only sandbox. |
| S7 | Deletion inventory omitted old live model | **CLOSED** | `core/live/model.ts` and its test are now in [spec §11.1](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1167), Task 2, Task 28, and `deletion-guard.test.ts`. |
| S8 | E2E teardown could kill unrelated process | **CLOSED** | Ownership refusal and PID-only teardown appear in [spec §16.4](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1572) and Task 32. Named proof: `campaign-badge.e2e.test.ts`. |

## Goal-proof matrix

| Goal | Assessment |
|---|---|
| G1 | **Still proxy/incomplete.** `dom-kinds` checks one DOM element per `RenderNode.k`; both string and array prompts share `k:"prompt"`, and pending/paired/error tool states share `k:"tool"`. It therefore does not prove every required shape passed end-to-end. “Iterate the union itself” is impossible without a runtime exhaustive witness because TypeScript types are erased. |
| G2 | **Direct.** Controlled-writer latency and actual `scrollTop` assertions prove both clauses. |
| G3 | **Incomplete.** The click is direct, but the single-campaign fixture misses repo/slug collisions already present under the real `~/.tribe`. |
| G4 | **Incomplete.** Named tests exist, but containment has no coherent root-by-path contract for discovery symlinks. |
| G5 | **Direct.** Deletion guard plus real diff statistics prove the static goal. |
| G6 | **Direct/compositional.** Fresh-build hashes, real served assets, installer test, runner probe tests, package gates, and C3 reconciliation collectively prove it. |

Proxy goal: **G1**. Partially unproved: **G3 and G4**.

## B1–B16 construction check

| Defect | Result | Construction |
|---|---|---|
| B1 historical results | Closed | §§6.3, 7.5 orphan/pair rules |
| B1 live results | **Not closed across reconnect** | §6.4 works only while pairing state survives |
| B2 array prompts | Closed | §7.2 |
| B3 state-derived traversal | Closed | §§9, 12.2: lookup key only; `statePath` unread |
| B4 current-card freeze | Closed | §9 filters sessions rather than binding a stream to the running card |
| B5 unresolved blank shell | Closed | §§3.2, 13 |
| B7 auto-scroll | Closed | §8.3 |
| B9 empty thinking | Closed | §7.2 declared no-node exception |
| B12 truncation/rotation | **Partial** | Active-stream reset is defined; disconnected replacement remains unsafe |
| B13 unbounded state | Closed | §6.5 |
| B14 bad arguments | Closed | §13 / Task 20 |
| B16 Host/Origin | Closed | §12.5 / `serve.security.test.ts` |

## Real-transcript coverage sample

| Shape observed on disk | Spec outcome |
|---|---|
| Array-content user prompt at [d07c…jsonl:3](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3>) | `prompt` via §7.2 |
| `tool_result`, `is_error:true` at [d07c…jsonl:19](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19>) | Attached error result, otherwise `orphan_result`, via §7.5 |
| Empty thinking at [agent-ac5…jsonl:3](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3>) | Deliberately no node via §7.2 |
| Persisted-output marker at [93fe…jsonl:50](</Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50>) | `spill`, basename-only, lazy `/api/spill`, via §7.6 |
| Compaction boundary at [1890…jsonl:2438](</Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2438>) | `divider` via §7.4 |

All five table outcomes match the real rows.

## Findings

### Blocker

1. **[Round-1 B4 remains open: spec §6.1 does not always produce a newline-boundary `ackOffset`.**

   - File: [spec.md:499](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:499), [plan.md:335](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:335)
   - Claim: `ackOffset = offset - byteLengthOf(carry)` can acknowledge an incomplete UTF-8 code point that the streaming decoder has retained internally.
   - Evidence: The design supplies the core a decoded string plus the raw consumed-byte count. A read of bytes `"{ } \n C3"` decodes to `"{}\n"` while `TextDecoder({stream:true})` holds `C3`; the formula produces `ackOffset=4`, whose preceding byte is `C3`, not newline `0A`. The current adapter explicitly requires that stateful-decoder behavior at [transcript.adapter.ts:25](/Users/hip/repo/tribe-wt/viewer-consolidation/plugins/tribe/scripts/viewer/adapters/transcript.adapter.ts:25). The named Task-5 audit demands every `ackOffset` point after a newline, so the plan’s invariant and formula cannot both pass.
   - Self-refutation: This disappears if decoder-buffered raw bytes are represented separately or offsets are derived from raw newline positions, but neither exists in `TailState` or the specified function inputs.

2. **[Round-1 B6 remains open: G1’s primary test is neither exhaustive nor implementable as written.**

   - File: [spec.md:81](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:81), [plan.md:1301](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1301)
   - Claim: `dom-kinds.e2e.test.ts` can pass while an array prompt or paired result is absent.
   - Evidence: It asserts only at least one DOM element per `k`. String and array prompts both become `prompt`; pending, successful, and error results all become `tool`. A TypeScript union cannot itself be iterated at runtime, and no exhaustive runtime `RENDER_NODE_KINDS` witness is specified. Supporting unit/component tests are layer-local proxies for those end-to-end variants.
   - Self-refutation: An exhaustive runtime map typed as `Record<RenderNode["k"], …>` plus content/state-specific DOM assertions could close this, but Revision 2 specifies neither.

3. **The SSE frame ordering can acknowledge data the browser has not received and permanently lose patches.**

   - File: [spec.md:547](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:547), [spec.md:592](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:592), [spec.md:625](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:625)
   - Claim: Giving `hello`, `rows`, and `patch` the same current `ackOffset` is not resumable.
   - Evidence: If the connection drops after `hello` but before the initial `rows`, the browser reconnects at the end-of-window ID and never receives the window. If it drops after a `rows` frame but before its later `patch`, the cursor is already past the result row, so the patch is never reconstructed. If reconnect occurs between a tool call and result, the new per-stream pending map is empty and the result becomes an orphan. Tests cover row resume, but none disconnects between `hello`/`rows`, between `rows`/`patch`, or between the paired rows.
   - Self-refutation: A full snapshot restart, atomic rows-plus-patches frame, phase-bearing event IDs, or reconstructing pairing state could close this. The present contract requires byte-offset resume and retains none of those mechanisms.

4. **Rotation/truncation remains unsafe when it occurs while disconnected.**

   - File: [spec.md:518](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:518), [spec.md:564](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:564), [plan.md:821](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:821)
   - Claim: A numeric `Last-Event-ID` contains no file identity, so a new stream cannot know the cursor belongs to a replaced file.
   - Evidence: Inode comparison requires the prior stream’s inode. After disconnect, only the byte offset returns. If the replacement—or a truncate-and-regrow—has reached at least that size, the server accepts the cursor and skips the new prefix, possibly starting mid-row. Tests exercise rotation while the prior poller is alive and reconnect without rotation, never the combined case.
   - Self-refutation: A durable generation/fingerprint or identity-bearing cursor could distinguish the files, but §6.5 explicitly retains only per-stream state and the wire ID carries only an offset.

5. **Campaign identity collapses across repository keys, and the collision exists on disk now.**

   - File: [spec.md:974](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:974), [spec.md:1033](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1033), [plan.md:1418](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1418)
   - Claim: `index[sessionId] = Badge` plus `?campaign=<slug>` cannot identify one campaign.
   - Evidence: The real tree contains `followups-2026-09-04` and `gh-issues-2026-09` under both `-Users-hip-repo-tribe` and `-Users-hip-repo-todd-skills.migrated-1788705562`; the duplicated states contain the same session IDs. The singular map overwrites one badge, while slug-only filtering merges different repos. The G3 test creates only one campaign.
   - Self-refutation: The migrated directory might be considered stale, but the scan has no exclusion for migrated keys. Even without duplicated session IDs, identical slugs in two legitimate repo keys still break slug-only filtering.

6. **The 2,000-node eviction policy makes old rows unreachable in real transcripts.**

   - File: [spec.md:614](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:614), [spec.md:651](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:651), [spec.md:955](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:955)
   - Claim: “Load earlier” cannot coexist with unconditional head eviction at 2,000 nodes.
   - Evidence: The initial view loads the last 500. Earlier batches must be prepended to preserve file order, but once the list reaches 2,000, head eviction removes the newly loaded oldest rows; appending them instead renders them out of order. The spec itself measures a 2,515-row transcript, and live inspection found four parent transcripts over 2,000 rows.
   - Self-refutation: Direction-aware eviction could drop the tail during back-fill or replace the visible window, but Revision 2 specifies only head eviction and tests no transcript over the cap.

7. **The containment contract rejects a real Claude sidecar shape while leaving discovery-root policy undefined.**

   - File: [spec.md:388](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:388), [spec.md:1248](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1248), [plan.md:288](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:288)
   - Claim: “Refuse a symlink to a sibling session” contradicts the transcript oracle.
   - Evidence: A real entry at [agent-ae5…jsonl](</Users/hip/.claude/projects/-Users-hip-repo-wiki-harness-analysis/f900f274-fa5f-4618-bb26-458313f843ac/subagents/agent-ae5a58e656fd8191a.jsonl>) is a symlink to the same agent file under sibling session `6c9855d5-…`. Session-root containment drops it; project-root containment accepts it but contradicts the named sibling-refusal test. Meanwhile §5.1 calls `readdir` entries structurally safe without defining resolved containment for project/session candidates.
   - Self-refutation: Treating `~/.claude/projects` as the root would preserve this real row, but then the spec’s sibling-session refusal is wrong and project-directory symlink escapes still need explicit tests.

### Should-fix

1. **[Round-1 S1 remains open: the campaign cap is still an adapter decision.**

   - File: [spec.md:988](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:988), [plan.md:721](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:721)
   - Claim: Task 16 requires `campaign.adapter.ts` itself to enforce the 200-campaign cap.
   - Evidence: Revision 2 moves expiry/eviction into `core/cache.ts`, but no pure core policy selects which 200 directory observations are admitted; the adapter test owns the cap.
   - Self-refutation: The adapter must execute the selected reads, but selecting/capping candidates is deterministic over supplied directory entries and can be decided in core, exactly like cache/window/tail policy.

2. **`core/title.measure.ts` performs filesystem I/O inside the declared pure-core tree.**

   - File: [plan.md:25](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:25), [plan.md:502](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:502)
   - Claim: Task 10 puts a whole-corpus filesystem scanner under `V/core/**`.
   - Evidence: The global wall forbids world access and adapter value imports under `core/**`, while the measurement script is expressly required to read every file beneath `~/.claude/projects`.
   - Self-refutation: It is a measurement rather than production runtime, but neither the purity rule nor `structure.test.ts` declares that filename exempt.

3. **The final hunter-brief instruction reverses Revision 2’s browser-suite ruling.**

   - File: [plan.md:1324](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1324), [plan.md:1474](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1474), [plan.md:1500](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1500)
   - Claim: Every hunter is told “the e2e suites are gated behind `TRIBE_VIEWER_E2E=1`,” contradicting the explicit rule that Task-30 DOM suites run under plain `bun test`.
   - Evidence: Lines 1328–1339 and 1474–1476 say only the two Haiku suites are gated and missing Chromium fails; line 1511 says all e2e suites are gated and “must never run by accident.”
   - Self-refutation: Task-specific text is more detailed, but §“What the Warchief carries into every hunter brief” explicitly requires carrying the contradictory toolchain trap into each brief.

4. **The 1 MiB SSE-frame budget is not enforced at frame level.**

   - File: [spec.md:550](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:550), [spec.md:572](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:572), [spec.md:1376](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1376)
   - Claim: Eliding individual blocks over 64 KiB does not bound the aggregate `rows` frame.
   - Evidence: One tick may read 4 MiB and emits one `rows` frame. Many sub-64-KiB nodes can serialize above 1 MiB. Task 9 tests each node’s size, not the total encoded frame, and no batching operation is specified.
   - Self-refutation: Normal 250 ms growth is usually small, but reconnect catch-up and initial 500-row windows are specifically supported and can aggregate much more.

### Optional

None.

## Task-order, brief, and scope checks

- Empty-fixture verification is correctly Task 1, before lifecycle/server implementation.
- Governance is present at every phase end: Tasks 3, 14, 21, 26, 29, and 33.
- Hunter briefs carry the oracle, intent-based constraints, and adjudication clauses verbatim; the e2e gating contradiction above is the exception.
- Required scope is present: D9 sweep, plugin `install.sh` build, both runner stdout lines, c3-215 rows, and the complete deletion inventory.
- No forbidden runner-log read, second transcript store, sending/resuming behavior, or extra `~/.tribe` source was added.
- Accepted consequences (e) stale-v1 break and (f) missing-Chromium DOM-suite failure were not reported as defects.

REWORK — the cursor still acknowledges unsafe byte positions, SSE frame/pairing state is not resumable, disconnected replacement can skip data, real campaign and symlink shapes violate the model, and the bounded row store makes existing long transcripts partially unreachable.


sol exit=0
