## Review scope

- Audited the current worktree at `11b2490`, which is revision 3 despite the brief saying revision 2.
- Read-only throughout; no files were modified, created, staged, or committed.
- `c3x check` and `validate-plan.sh` could not execute because the read-only sandbox denied temporary-file/cache creation. This is unverified environmental evidence, not a spec finding.

## Round-1 closure audit

| # | Round-1 finding | Status | Closure evidence and named proof |
|---|---|---|---|
| B1 | P1 gate weakened | **CLOSED** | The entire build is gated at [plan.md:27](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:27), every phase depends on P1 at [plan.md:102](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:102), and the concrete pre-dispatch gate is [plan.md:119](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:119). This is appropriately a manual authority gate, not a test. |
| B2 | Token interface mismatched candidates | **CLOSED** | The exact shared token schema is fixed in spec §8.2 at [spec.md:1022](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1022); all three candidate files contain those names. `structure.test.ts` and Task 22 mechanically prohibit invented tokens at [plan.md:1062](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1062). |
| B3 | No live tool-result update operation | **CLOSED** | `patch` replacement is defined by spec §6.4 at [spec.md:751](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:751). Named proofs: `core/pair.test.ts`, `core/sse.test.ts`, `rowStore.test.ts`, and `live-tail.e2e.test.ts` at [plan.md:520](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:520) and [plan.md:1527](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1527). |
| B4 | Offset acknowledged partial bytes | **CLOSED by supersession** | D12 removes byte-offset resume; D13 keeps raw-byte tail accounting. See [spec.md:90](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:90) and §6.1. Named proofs: `core/tail.test.ts`, `serve.events.test.ts`, and `live-tail.e2e.test.ts`. Residual SSE contradictions are reported below. |
| B5 | Same/larger rotation undetectable | **CLOSED** | Inode plus size reset triggers are specified at [spec.md:615](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:615). Named proofs: `core/tail.test.ts`, `poller.adapter.test.ts`, and the same-size rotation case in `live-tail.e2e.test.ts` at [plan.md:1540](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1540). |
| B6 | G1/G2/G4/G6 proofs were proxies | **OPEN** | The revision substantially improves the proofs, but G1’s base64 leg, G4’s zero-write wall, and G6’s final gate remain incomplete; see Blocker 1 below. |
| B7 | Stale pre-consolidation viewer reused | **CLOSED** | Deliberate v2 identity and three probe outcomes are specified in §10.4 at [spec.md:1300](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1300). Named proofs: `serve.security.test.ts`, `viewer-launch.test.ts`, and `served-build.e2e.test.ts`. The deliberate breaking behavior is accepted and not reported. |
| S1 | Decisions placed in adapters | **CLOSED** | Complete-line selection, cache policy, tail transitions, and campaign-cap selection are assigned to pure core at [spec.md:511](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:511) and [spec.md:1164](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1164). Named proofs include `window.test.ts`, `cache.test.ts`, `badge.test.ts`, and `poller.adapter.test.ts`. |
| S2 | Symlink containment and narrow catches unproved | **CLOSED for transcript/query paths** | Two-stage lexical and resolved containment is specified in §12.2 at [spec.md:1430](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1430); narrow catches are enforced at [spec.md:1509](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1509). Named proofs: `paths.containment.test.ts` and `adapters/readonly.test.ts`. A separate `~/.tribe` symlink gap is reported below. |
| S3 | B13 unbounded state | **CLOSED** | Every per-stream structure has a numerical bound and behavior at the bound in §6.5 at [spec.md:776](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:776). Named proofs span `tail.test.ts`, `pair.test.ts`, `sse.test.ts`, `rowStore.test.ts`, and `perf.test.ts`. |
| S4 | No mid-stream subagent test | **CLOSED** | `meta` explicitly covers newly appearing sidecars at [spec.md:648](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:648). Named proofs: `poller.adapter.test.ts` and `live-tail.e2e.test.ts` at [plan.md:1521](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1521). |
| S5 | D9 expected-five inventory false | **CLOSED** | Spec §15 and Task 29 now enumerate the real seven sites at [spec.md:1591](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1591) and [plan.md:1373](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1373). The current tree independently produces two `supervisor` plus five `status viewer` hits. |
| S6 | C3 commands used unavailable entry points | **CLOSED in the plan** | All governance tasks use `bunx @c3x/cli@11.6.3 … </dev/null`; see [plan.md:40](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:40). Execution remains unverified in this sandbox because `bunx` returned `PermissionDenied`. |
| S7 | Spec deletion inventory omitted live model files | **CLOSED** | `core/live/model.ts` and its test appear in §11.1 at [spec.md:1349](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1349) and Tasks 2/28. Named proof: `deletion-guard.test.ts`. |
| S8 | E2E teardown could kill unrelated process | **CLOSED** | §16.4 and Task 32 require PID ownership and refusal when port 4399 is occupied at [spec.md:1809](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1809) and [plan.md:1596](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1596). Named proof: `campaign-badge.e2e.test.ts`. |

Result: **14 CLOSED, 1 OPEN**.

## Goal-proof assessment

| Goal | Assessment |
|---|---|
| G1 | **Partly proxy.** `dom-kinds.e2e.test.ts` directly proves almost every listed shape, but its base64-image assertion only checks that an image card exists and that bytes have not yet been fetched; it never expands the card and proves the image is displayed. |
| G2 | **Direct.** Controlled append completion time, browser DOM arrival, actual `scrollTop`, parent and subagent appends, and mid-stream subagent discovery are asserted in `live-tail.e2e.test.ts`. |
| G3 | **Direct.** The real runner is used; both stdout lines are captured, the printed session URL is opened, and the badge itself is clicked. |
| G4 | **Proxy for zero writes.** The source guard bans a finite list of APIs rather than closing all write-capable routes. Containment, Host/Origin, and failure behavior otherwise have direct named proofs. |
| G5 | **Direct.** `deletion-guard.test.ts` plus `git diff --stat` prove deletion and absence. |
| G6 | **Incomplete.** Build serving is directly proved, but the final task omits two commands that the spec itself includes in the definition of “CI green.” |

Proxy goals: **G1’s base64-image leg and G4’s zero-write leg**. G6 is missing part of its declared gate rather than merely using a proxy.

## B1–B16 construction check

| Defect | Construction status | Closing section |
|---|---|---|
| B1 historical/live result loss | Closed | §6.4, §7.5 |
| B2 array prompts | Closed | §7.2 |
| B3 state-derived traversal | Closed | §9, §12.2 |
| B4 stream fixed to current card | Closed | §3.2, §9 |
| B5 blank unresolved campaign shell | Closed | §5.2, §13 |
| B7 auto-scroll | Closed | §8.3 |
| B9 empty thinking cards | Closed | §7.2 named exception |
| B12 truncation/rotation duplication | **At risk on reconnect** | §6.1/§6.2 intend to close it, but the per-stream ID reset contract is incomplete; see Should-fix 1 |
| B13 unbounded connection state | Closed | §6.5 |
| B14 bad arguments | Closed | §13 |
| B16 Host/Origin | Closed | §12.5 |

## Real-transcript normalizer sample

| Real shape | On-disk evidence | Contracted viewer behavior |
|---|---|---|
| Array-content user prompt | [d07c…jsonl:3](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3>) | `prompt` via §7.2; separately asserted in the DOM |
| `tool_result`, `is_error:true` | [d07c…jsonl:19](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19>) | Paired tool card with `state:"error"`, or visible `orphan_result` if the call is outside state |
| Empty thinking block | [agent-ac5…jsonl:3](</Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3>) | No node, explicitly declared and tested |
| Persisted-output marker | [93fe…jsonl:50](</Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50>) | `spill` result retaining preview and basename; lazy `/api/spill` fetch |
| Compaction boundary | [1890…jsonl:2438](</Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2438>) | `divider` labelled “context compacted” |

All five real shapes have an explicit normalizer outcome.

## Findings

### Blocker

1. **[Round-1 B6 remains open] Several goal proofs can still pass without proving the stated goal.**

   - File: [spec.md:129](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:129), [spec.md:1400](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1400), [spec.md:1729](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1729), [plan.md:1635](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1635).
   - Claim: G1 can pass without displaying the base64 image; G4 can pass while a write-capable API remains; G6 can pass its final task without the complete gate set the spec defines.
   - Evidence: E1 only asserts an image node and no pre-expansion fetch. The zero-write guard enumerates `writeFile`, `appendFile`, `mkdir`, `rm`, `rename`, `unlink`, `spawn`, and `exec`, but does not close alternatives such as `Bun.write`, `createWriteStream`, `copyFile`, `truncate`, write-mode `open`, or browser persistence. Separately, spec §16 names `pre-gate.sh` and `gap-gate.ts` as part of “CI green” at [spec.md:1628](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1628), while Task 33 runs neither.
   - Self-refutation: Component tests cover lazy image fetching, and architecture review could catch an unexpected write. Neither makes the named end-user/mechanical proof itself decisive, which is the round-1 requirement.

2. **Task 18 still implements `/api/block` by UUID after revision 3 changed the contract to byte offset plus block index.**

   - File: [plan.md:888](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:888).
   - Claim: The TDD task directs the server to expose a different addressing scheme from the route and client.
   - Evidence: Task 18 requires “by uuid and index.” Spec §4 requires `at+i`, explicitly because all measured attachment rows lack UUIDs at [spec.md:435](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:435); Task 25 sends `at+i` at [plan.md:1212](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1212). A hunter following Task 18 verbatim can make its test green while every client expansion 404s.
   - Self-refutation: Task 18 also says “implement per spec,” but its mandatory failing test is more concrete and the global TDD rule requires the minimum implementation that satisfies that test. The contradiction survives.

3. **The plan reintroduces the row/node ambiguity after the spec declares that window limits count nodes.**

   - File: [plan.md:888](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:888), [spec.md:300](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:300).
   - Claim: Task 18 can implement the initial/back-fill limit in rows rather than rendered nodes.
   - Evidence: Spec §4 says the mapping is not one-to-one and explicitly fixes the window unit as nodes; §6.3 requires the last 500 nodes. Task 18 tests “the last N rows,” and spec’s performance table also retains “last-500-row window” at [spec.md:1573](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1573). A multi-block row makes these observably different.
   - Self-refutation: The endpoint and SSE event retain the legacy name `rows`, but §6.2 explicitly says their payload is nodes. The mismatch therefore cannot be dismissed as naming only.

4. **The new frame-budget test simultaneously requires every frame to be ≤1 MiB and blesses a frame larger than 1 MiB.**

   - File: [plan.md:685](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:685).
   - Claim: `batchFrames` has an impossible acceptance contract for a single oversized node.
   - Evidence: The task says no encoded frame may exceed 1 MiB, then says a single node exceeding the cap is emitted alone. Spec §6.2 and §6.5 require every encoded frame to stay under the cap at [spec.md:679](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:679). Prompt, assistant, and thinking nodes have no general elision field, so an oversized node is representable.
   - Self-refutation: Tool payloads, images, and raw cards are elided, but the plan itself observes that node-level elision does not bound a frame at [plan.md:701](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:701). The oversized-node branch therefore remains real.

### Should-fix

1. **D12’s SSE sequence-ID contract does not say when the client resets its dedupe state.**

   - File: [spec.md:656](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:656), [plan.md:1167](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1167).
   - Claim: Every connection restarts IDs at 1 while the client is told to ignore IDs already processed; without a connection-incarnation/reset rule, reconnect frames can collide with the previous stream.
   - Evidence: No client test explicitly clears the processed-sequence state on `open`/fresh `hello`. Stale prose also calls `ackOffset` the SSE cursor at [spec.md:402](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:402), while §6.1 says it is no longer a wire value; plan lines 138 and 913 still say “resume-by-offset” despite [plan.md:61](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:61) declaring such language wrong.
   - Self-refutation: Clearing the sequence watermark on each EventSource `open` would make the design coherent, and reconnect E2E cases may expose an omission. That transition is not stated or named as an assertion, so the contract is not closed by construction.

2. **Campaign-directory symlinks can escape `~/.tribe` before fixed-layout files are opened.**

   - File: [spec.md:1131](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1131), [spec.md:1199](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1199), [plan.md:811](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:811).
   - Claim: `repoKey`, `slug`, and `runId` are trusted merely because they came from `readdir`; no resolved containment is required before opening `campaign-state.json` or `run.json`.
   - Evidence: A directory entry cannot spell `..`, but it can be a symlink outside the declared root. The design correctly detects this exact class for project directories under `~/.claude/projects` yet gives no equivalent root check to the campaign adapter.
   - Self-refutation: The card’s original G4 wording emphasizes state-file/query-derived paths, and these names are local filesystem entries. The review question asks about every externally sourced path, and the rule requires containment before use; a symlink remains an external path mechanism.

3. **The empty fixture’s exact symlink contract has no matching fixture definition.**

   - File: [plan.md:163](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:163), [plan.md:187](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:187), [spec.md:1689](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1689).
   - Claim: Manual verification expects exactly three symlinks, while the fixture contract names only two and its unit test does not assert the three targets.
   - Evidence: §16.2 describes an escaping spill symlink and one legitimate in-session symlink. The intended third appears to be the real sibling-session sidecar shape, but neither the fixture description nor Task 1 Step 1 says that one sidecar is a symlink.
   - Self-refutation: Tasks 4 and 15 later require the sibling-session shape, so a careful hunter could infer the third link. `fixtures-mirror-reality` requires the foundational fixture itself to say what it builds, not depend on a later inference.

4. **Task 1 uses an unowned, fixed destructive temporary path.**

   - File: [plan.md:177](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:177).
   - Claim: `rm -rf /tmp/vc-fixture` may delete another run’s or user’s directory and makes concurrent verification race.
   - Evidence: The command resolves no ownership and does not allocate a unique directory.
   - Self-refutation: The target is narrow and conventionally temporary, but it is still shared and unverified. `mktemp -d` supplies the same empty-fixture proof without this risk.

5. **The hunter adjudication block omits accepted clauses (e) and (f).**

   - File: [plan.md:76](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:76), [plan.md:1669](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1669).
   - Claim: Every hunter brief carries only clauses (a)–(d), so future auditors are not told in the adjudication section that stale-v1 refusal and non-skipping DOM suites are accepted.
   - Evidence: R8/R9 describe the decisions elsewhere, but `brief-contracts.md` requires pre-refutations in the carried adjudication rule itself.
   - Self-refutation: The relevant task sections and spec risks explain both consequences. That relies on auditors reconstructing an exception from scattered prose, which is the failure mode the brief-contract rule forbids.

6. **The campaign E2E deliberately leaves synthetic state in the user’s real `~/.tribe`.**

   - File: [plan.md:1599](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1599).
   - Claim: Keeping the fixture campaign “as evidence” is persistent external-state mutation beyond what the proof requires.
   - Evidence: Evidence artifacts are already specified under the repository at [spec.md:1839](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1839); the card reserves new external writes/permissions to the owner at [viewer-consolidation.md:77](/Users/hip/.tribe/-Users-hip-repo-tribe/cards/viewer-consolidation.md:77).
   - Self-refutation: G3 necessarily authorizes running a real fixture campaign, which temporarily writes campaign state. It does not require retaining an invented second campaign after teardown, so persistence does not follow from that authorization.

### Optional

1. **The declared single-scan facts were not updated atomically.**

   - File: [spec.md:20](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:20), [spec.md:404](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:404), [spec.md:801](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:801), [plan.md:451](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:451).
   - Claim: Revision 3 says every count comes from one 2026-09-12 scan, but retains “899” timestamp inversions instead of 906, calls §7’s source the 2026-09-11 scan, and retains `8,411-of-17,802` instead of 17,873.
   - Evidence: The conflicting values occur in the current documents.
   - Self-refutation: None of these stale values changes a branch or test threshold. They do weaken the document’s explicitly stated provenance discipline.

## Task-order and scope checklist

- Empty-fixture verification is correctly first, before lifecycle/server implementation.
- Governance is present at every phase end: Tasks 3, 14, 21, 26, 29, and 33.
- Hunter briefs are fenced by intent and carry task text, global constraints, oracle, and adjudication verbatim; accepted clauses (e)/(f) are the omission noted above.
- D9 naming, plugin-level `install.sh` build, both runner stdout lines, c3-215 rows, and the deletion inventory are scheduled.
- No forbidden runner-log or extra `~/.tribe` data source was added.
- D12 legitimately supersedes the original byte-offset-resume design: the current intended reconnect contract is fresh snapshot plus stable-row dedupe, not `Last-Event-ID` resume.

REWORK — close the remaining goal-proof gap, reconcile `/api/block` addressing and row-vs-node limits, define a satisfiable ≤1 MiB frame policy, and remove the SSE/containment/fixture/authority ambiguities above.


sol exit=0
