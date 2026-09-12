## Round-3 closure audit

| Finding | Status | Evidence and named proof |
|---|---|---|
| Blocker 1 — goal proofs were proxies | **CLOSED** | Direct goal map at [spec.md:178](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:178); displayed-image assertion at [spec.md:2001](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2001); zero-write hash at [spec.md:2012](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2012); complete final gates at [plan.md:1783](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1783). Named proofs: `dom-kinds.e2e.test.ts`, `adapters/readonly.test.ts`, `served-build.e2e.test.ts`, `pre-gate.sh`, `gap-gate.ts`. |
| Blocker 2 — `/api/block` UUID versus `at+i` | **CLOSED** | One address is defined at [spec.md:423](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:423) and required by Task 18 at [plan.md:977](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:977). Named proofs: `serve.reads.test.ts` and `agents.test.tsx`. A different `at+i` defect is reported below. |
| Blocker 3 — row/node window ambiguity | **CLOSED** | Row and node are distinguished at [spec.md:359](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:359); the window counts exactly 500 nodes at [spec.md:865](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:865); Task 18 asserts the distinction at [plan.md:962](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:962). Named proofs: `window.test.ts`, `serve.reads.test.ts`, `live-tail.e2e.test.ts`. The revised exact-node algorithm has a new boundary defect below. |
| Blocker 4 — impossible frame budget | **CLOSED** | Every node kind is bounded at [spec.md:525](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:525), and batching has no oversized-node escape at [spec.md:805](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:805). Named proofs: `normalize.test.ts`, `pair.test.ts`, property tests in `sse.test.ts`, `perf.test.ts`. |
| Should-fix 1 — reconnect dedupe not reset | **CLOSED** | Generation replacement is specified at [spec.md:778](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:778), while the sequence watermark resets on `open` at [spec.md:1314](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1314). Named proofs: `rowStore.test.ts`, `useEventStream.test.ts`, `live-tail.e2e.test.ts`. |
| Should-fix 2 — campaign-directory symlink escape | **CLOSED** | Resolved containment under `realpath(~/.tribe)` is required before opening either allowed file at [spec.md:1420](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1420). Named proof: `campaign.adapter.test.ts`, including repo-key, slug, and run-id symlinks at [plan.md:886](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:886). |
| Should-fix 3 — third fixture symlink undefined | **OPEN** | Task 1 still says “exactly three symlinks with the targets named in step 1” at [plan.md:209](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:209), but Step 1 names none at [plan.md:180](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:180), while spec §16.2 expressly defines only the two `tool-results` links at [spec.md:1961](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1961). Named proof `fixtures/build.test.ts` therefore does not require the sibling-session sidecar symlink. |
| Should-fix 4 — fixed destructive temp path | **CLOSED** | Task 1 now uses an owned `mktemp -d` path and explains the ownership boundary at [plan.md:194](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:194). Named proof: `fixtures/build.test.ts` plus the manual empty-tree run. |
| Should-fix 5 — adjudication omitted clauses (e)/(f) | **CLOSED** | Both accepted clauses are in the verbatim adjudication block at [plan.md:86](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:86), and every brief must carry it verbatim at [plan.md:1842](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1842). This is a brief-generation contract rather than a runtime test. |
| Should-fix 6 — campaign E2E retains synthetic state | **CLOSED** | Spec teardown deletes both exact campaign-home paths under fake `HOME` at [spec.md:2133](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2133); Task 32 repeats the `finally` cleanup at [plan.md:1741](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1741). Named proof: `campaign-badge.e2e.test.ts`. A remaining real-versus-fake-HOME contradiction is reported below. |
| Optional 1 — inconsistent single-scan facts | **CLOSED** | The single-scan provenance and reconciled counts appear at [spec.md:44](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:44), including 906 inversions and 17,873 thinking blocks. |
| Round-1 B6 — G1/G2/G4/G6 proofs were proxies | **CLOSED** | Same evidence as round-3 Blocker 1. Every goal now names a direct test or measurement; none is merely proxy-proved. |

Result: **10 CLOSED, 1 OPEN**, plus round-1 B6 closed.

## Goal-proof assessment

| Goal | Assessment |
|---|---|
| G1 | **Direct:** real server, real server, runtime kind witness, and per-shape DOM assertions, including expanded image rendering. |
| G2 | **Direct:** controlled append completion time, DOM arrival, actual `scrollTop`, parent/subagent appends, reconnect, and rotation. |
| G3 | **Direct:** real runner, exact stdout, opened session URL, rendered badges, and an actual badge click. |
| G4 | **Direct as ruled by D16:** structural import allowlist, narrow-catch tests, containment tests, Host/Origin tests, and before/after fixture-tree hash. |
| G5 | **Direct:** deletion guard plus actual diff statistics. |
| G6 | **Direct:** built-output hashes served through the real server, installer test, package checks, C3, pre-gate, and gap-gate. |

**Proxy goals: none.** The new blockers below make parts of the plan internally unsatisfiable, but the named goal measurements themselves are no longer proxies.

## B1–B16 construction check

| Defect | Status | Closing section |
|---|---|---|
| B1 historical/live tool-result loss | **OPEN** | §6.4/§7.5 intend to close it, but the post-normalization window trim can remove the paired call and therefore its absorbed result; see Blocker 3. |
| B2 array prompts | Closed | §7.2 and §16.2 |
| B3 state-derived traversal | Closed | §9 and §12.2 |
| B4 stream frozen to current card | Closed | §3.2 and §9 |
| B5 blank unresolved campaign shell | Closed | §3.2 and §13 |
| B7 auto-scroll | Closed | §8.3 |
| B9 empty thinking cards | Closed | §7.2 named exception |
| B12 truncation/rotation duplication | **Not closed by construction** | §6.1 and Task 19 are correct, but §13 still orders byte-zero replay; see Should-fix 2. |
| B13 unbounded connection state | Closed | §6.5 |
| B14 bad arguments | Closed | §13 |
| B16 Host/Origin | Closed | §12.5 |

## New findings

### Blocker

1. **The D16 allowlist makes two required plan tasks impossible to implement.**

   - File: [spec.md:1254](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1254), [spec.md:1734](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1734), [plan.md:580](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:580), [plan.md:760](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:760), [plan.md:1170](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1170).
   - Claim: `structure.test.ts` cannot pass alongside the required corpus-measurement tool and token-copy build step.
   - Evidence: D16 permits filesystem primitives only in `adapters/**`, with `Bun.serve` as the sole named non-adapter exception, and refuses any other world import anywhere outside `fixtures/`/`e2e/`. Task 10 nevertheless requires `tools/title-window.ts` to read the entire real corpus, and Task 22 requires `vite.config.ts` to copy `tokens.css` into `client/src/styles/`. Both require precisely the non-adapter filesystem access the wall must reject.
   - Self-refutation: Vite could import the stylesheet directly, and the measurement could move behind an adapter or gain an explicit tooling exception. Neither is the contracted mechanism; satisfying either task currently makes Task 14 red.

2. **One `at+i` address cannot expand both halves of a paired tool card.**

   - File: [spec.md:423](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:423), [spec.md:474](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:474), [spec.md:538](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:538), [plan.md:534](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:534).
   - Claim: An elided `tool_result` cannot be recovered from the tool node’s address.
   - Evidence: The tool node’s `RowAnchor` points to the `tool_use` block. The paired result is physically in a later user row—confirmed by the real adjacent shapes at [transcript:18](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:18>) and [transcript:19](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19>). Yet `/api/block` accepts only the tool node’s `at+i`, and has no `part`, result-row address, or result locator. If both input and result are elided, the same URL is supposed to recover two different payloads.
   - Self-refutation: Returning a composite payload, adding a `part`/result address, or scanning forward by `tool_use_id` could solve it. None is specified, and “one elided payload” plus one address rules out the first two implicitly.

3. **The exact 500-node window cannot remain lossless with a row-offset-only back-fill cursor.**

   - File: [spec.md:365](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:365), [spec.md:883](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:883), [spec.md:902](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:902), [plan.md:962](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:962).
   - Claim: Trimming to exactly 500 nodes can permanently omit blocks from the boundary row.
   - Evidence: A row may emit several nodes. If the 500-node boundary lands at block `i=2` of a four-block row, the algorithm retains `i=2,3` but records `from` as only that row’s byte offset. “Load earlier” reads `before=<row offset>`, so it reads rows before the boundary row and can never recover `i=0,1`. The same sequencing can reintroduce B1: normalization pairs a result into a call node, the trim removes that earlier call node, and no orphan result remains because the result already produced no node. Task 18 tests that a four-block row changes the row count, but never forces the trim boundary through that row.
   - Self-refutation: Keeping the entire boundary row avoids loss but exceeds the exact-500 contract; making the cursor `at+i` avoids loss but contradicts the byte-offset-only window contract. The present design cannot satisfy all three claims.

### Should-fix

1. **[Round-3 S3 remains open] The empty-fixture proof still does not define its third symlink.**

   - File: [plan.md:180](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:180), [plan.md:209](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:209), [spec.md:1961](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1961).
   - Claim: `fixtures/build.test.ts` can pass without constructing the real sibling-session sidecar symlink required by D14.
   - Evidence: The test lists sidecars and a spill file but no symlink assertions; the manual expectation then refers to three targets supposedly named there. Spec §16.2 names only two `tool-results` symlinks.
   - Self-refutation: Task 15 later describes the sibling-session shape. `fixtures-mirror-reality` requires the foundational fixture and its own test to define that shape before implementation, not leave it for inference.

2. **The rotation failure table contradicts the normative reset contract.**

   - File: [spec.md:1786](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1786), [spec.md:1800](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1800), [plan.md:1021](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1021).
   - Claim: The spec simultaneously requires rotation to reload the normal tail window and to re-stream from byte zero.
   - Evidence: §13 declares its rows to be the named test list. One row correctly says “never the file from byte 0”; the inode-change row later says “re-stream from byte 0.” The latter can reproduce B12’s whole-file redelivery.
   - Self-refutation: §6.1 and Task 19 clearly favor the tail window, so a careful hunter may choose correctly. The contradictory test-list row still prevents closure by construction.

3. **Task 32 still gives conflicting authority about whether campaign state is written under real or fake `HOME`.**

   - File: [plan.md:1712](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1712), [plan.md:1716](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1716), [spec.md:2078](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:2078).
   - Claim: The hunter brief can be read as authorizing writes to the owner’s actual `~/.tribe`.
   - Evidence: Task 32 first says “a campaign home under the real tribe root,” then immediately imports spec §16.4’s fake-`HOME` harness. It later calls one of the two homes “the real one.” The full spec correctly places both under `<tmp>/.tribe`.
   - Self-refutation: The referenced spec and exact invocation are unambiguous and teardown is now correct. The task section is nevertheless carried verbatim into the hunter brief, so its earlier imperative remains live.

### Optional

None.

## Five real-transcript shapes

| Shape | On-disk evidence | Contracted behavior |
|---|---|---|
| Array-content user prompt | [transcript:3](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3>) is `user`, array content, `text` block | `prompt`; separately asserted by text in the DOM (§7.2, §16.2). |
| `tool_result`, `is_error:true` | [transcript:19](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19>) | Paired tool card with `state:"error"`; `orphan_result` if its call is outside pairing state (§7.5). |
| Empty thinking | [sidecar:3](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3>) has `thinking:""` plus a signature | Explicitly emits no node (§7.2); absence asserted in DOM. |
| Persisted output | [transcript:50](</Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50>) | Spill preview plus basename-only lazy `/api/spill` expansion (§7.6). |
| Compaction boundary | [transcript:2438](</Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2438>) is `system/compact_boundary` | `divider` labelled “context compacted” (§7.4). |

All five required shapes have explicit normalizer outcomes.

## Remaining checklist

- Purity placement is otherwise sound: adapters observe/execute; line selection, cache policy, badge caps, tail transitions, normalization and batching are assigned to core.
- Transcript and campaign paths have lexical plus resolved containment; campaign-state `sessionId` is a lookup key only, and `run.json.statePath` is never read.
- Parse failures are narrowly distinguished from filesystem failures and have named adapter tests.
- D12 is coherent for reconnect: no byte-offset resume, `Last-Event-ID` ignored, new `generation`, store replacement, per-connection sequence watermark.
- Mid-stream subagent discovery has both adapter and browser E2E assertions.
- Empty-fixture verification is Task 1, before lifecycle/server implementation.
- Phase-end governance exists at Tasks 3, 14, 21, 26, 29 and 33.
- Hunter briefs carry intent fences, the oracle, quoted constraints and all adjudication clauses.
- D9’s seven-site sweep, plugin `install.sh` build, both runner stdout lines, c3-215 rows and the deletion inventory are scheduled.
- No forbidden runner-log or additional `~/.tribe` source has entered scope.
- C3 seal/structure remains unverified: the required wrapper attempted to fetch `@c3x/cli` and failed with `ENOTFOUND registry.npmjs.org`. This is environmental evidence, not a spec finding.
- The subject files remained unchanged. An unrelated untracked `references/terra-spec-v5-round1.txt` appeared during the review; I did not read or modify it.

REWORK — the D16 wall conflicts with required build/measurement I/O, paired-result expansion has no usable address, and exact node trimming can permanently under-render boundary content.


sol exit=0
