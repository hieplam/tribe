## Source of truth

- Contract: [idea card](/Users/hip/.tribe/-Users-hip-repo-tribe/cards/viewer-consolidation.md:52), [STATE.md](/Users/hip/.tribe/-Users-hip-repo-tribe/viewer-consolidation/STATE.md:44), [spec.md](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1), and [plan.md](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1).
- Governance loaded: `AGENTS.md`, `pure-core.md`, `fail-closed-edges.md`, `fixtures-mirror-reality.md`, and `brief-contracts.md`.
- Read-only throughout; no files were edited, created, staged, or committed.
- C3 seal/structure is unverified: neither `c3` nor `c3x` is installed on `PATH`; the skill wrapper attempted its network fallback and timed out without output.

## Goal-proof matrix

| Goal | Assessment | Evidence |
|---|---|---|
| G1 | **Proxy / contradictory** | The route table says `/api/session/<id>` returns metadata only ([spec.md:186](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:186)), but E1 expects it to return render nodes ([spec.md:1090](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1090)). The kind-set tests normalization/API output, not React DOM rendering. |
| G2 | **Proxy** | Latency is measured from the transcript row timestamp, not observed file append time ([spec.md:1107](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1107)); screenshots cannot prove that the viewport moved only while following. No explicit live subagent-append assertion exists. |
| G3 | **Mostly direct; click leg partly proxy** | Runner output and badge lifecycle are exercised, but the end-to-end task says only that the filter narrows the list ([plan.md:1154](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1154)); the actual badge click is only a component test. |
| G4 | **Proxy / incomplete** | The goal map names `core/paths.containment.test.ts` and `adapters/readonly.test.ts` ([spec.md:77](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:77)); neither is scheduled under those names, and symlink containment is not tested. |
| G5 | **Direct** | Deletion/non-existence guard plus real `git diff --stat` directly prove the static deletion goal. |
| G6 | **Incomplete** | Build/check/governance proofs are named, but stale-viewer reuse can bypass the new built client, and the documented C3 commands are not callable in the current toolchain. |

Proxy goals: **G1, G2, G4, G6**; **G3’s click-to-filter clause is partially proxy-proved**.

## B1–B16 construction matrix

| Defect | Closed? | Closing section |
|---|---|---|
| B1 historical result loss | Historical snapshot case: yes; incremental live result: no | §6.3, §7.5; missing update wire contract |
| B2 array prompts | Yes | §7.2 |
| B3 state-derived traversal | Yes for `sessionId`/`statePath` | §9, §12.2 |
| B4 stream frozen to current card | Yes | §9 removes current-card binding |
| B5 blank unresolved campaign shell | Yes | §5.2, §13 |
| B7 auto-scroll | Yes | §8.3 |
| B9 empty thinking cards | Yes | §7.2 named exception |
| B12 truncation/rotation duplicates | **No** | §6 handles shrink only; reconnect cursor remains unsafe |
| B13 unbounded connection state | **No** | Carry is bounded inconsistently; row/pairing state has no eviction contract |
| B14 bad arguments | Yes | §13 |
| B16 Host/Origin | Yes | §12.5 |

## Real-transcript coverage sample

All five requested on-disk shapes have an explicit normalizer outcome:

| Real row | On-disk evidence | Spec outcome |
|---|---|---|
| Array user prompt | [d07c…jsonl:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:3) | `prompt` via §7.2 |
| `tool_result`, `is_error:true` | [d07c…jsonl:19](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293.jsonl:19) | Paired error result, or `orphan_result`, via §7.5 |
| Empty thinking | [agent-ac5…jsonl:3](/Users/hip/.claude/projects/-private-var-folders-t2-s0b8z5m947l7kdcvwtrtrt480000gn-T-tribe-e2e-4DT0xF-repo/d07c72de-709d-4643-aad3-b2ef6acad293/subagents/agent-ac5c079aadb484dba.jsonl:3) | Deliberately emits no node via §7.2 |
| Persisted output | [93fe…jsonl:50](/Users/hip/.claude/projects/-Users-hip-repo-todd-skills/93fe0a83-ed16-4198-b1f6-d9581746a377.jsonl:50) | `spill`, basename-only, lazy `/api/spill`, via §7.6 |
| Compaction boundary | [1890…jsonl:2438](/Users/hip/.claude/projects/-Users-hip-repo-tribe/18904cff-934e-4a39-b9b9-0fd3c7210684.jsonl:2438) | `divider` via §7.4 |

## Findings

### Blocker

1. **P1’s owner gate is weakened from “no build starts” to “only client work waits.”**

   - Claim: The plan authorizes phases 0–2 and runner task 27 before P1.
   - Evidence: The card says “Until P1 is delivered … the build does not start” ([card:69](/Users/hip/.tribe/-Users-hip-repo-tribe/cards/viewer-consolidation.md:69)); STATE says not to dispatch the build until the owner confirms P1 ([STATE.md:84](/Users/hip/.tribe/-Users-hip-repo-tribe/viewer-consolidation/STATE.md:84)). The spec and plan explicitly unblock phases 0–2 and runner work ([spec.md:673](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:673), [plan.md:87](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:87)).
   - Self-refutation: “Build” could mean only the Vite build, but STATE expressly calls this a precondition before implementation handover. The narrower interpretation does not survive.

2. **The spec’s P1 token interface does not match any supplied design candidate.**

   - Claim: A hunter following the spec will reference undefined spacing/radius tokens.
   - Evidence: The spec permits only `--space-1…6` and `--radius-1…3` and copies the chosen file unchanged ([spec.md:659](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:659)). All candidates instead define `--space-4/8/12/16/24/32` and `--radius-4/8`; see [matcha/tokens.css:46](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/design/matcha/tokens.css:46). The design README itself demonstrates `var(--space-12)` ([design/README.md:63](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/design/README.md:63)).
   - Self-refutation: Build-time aliases could reconcile the names, but the mechanism mandates copying one owner file and forbids implementer-invented tokens. No alias layer is specified.

3. **Live tool results have no wire operation that can update an already-emitted tool card.**

   - Claim: A `tool_use` emitted on one tick and its `tool_result` arriving later cannot be attached to the existing node.
   - Evidence: §7.5 says pairing “patches that tool node in place” ([spec.md:558](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:558)), but the SSE contract has only append-style `rows`, with no patch/update event ([spec.md:412](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:412)). The client test explicitly says a second `rows` frame appends ([plan.md:888](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:888)).
   - Self-refutation: A replacement node could be sent in `rows`, but neither identity-based replacement nor duplicate suppression exists in the client contract. Delaying the call until its result would violate live rendering and the specified `pending` state.

4. **The byte-offset SSE cursor can acknowledge bytes belonging to an incomplete JSONL row.**

   - Claim: Reconnect can permanently lose the beginning of a row.
   - Evidence: Tail offset advances by all consumed bytes while retaining a partial line ([spec.md:382](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:382)); every frame advertises that current offset as `id:` ([spec.md:423](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:423)). If a read includes complete rows plus the start of the next row, the `rows` frame acknowledges the partial bytes; reconnect resumes after them.
   - Self-refutation: If IDs represented the last completed-newline offset, the problem disappears, but the spec explicitly defines the ID as the consumed/current offset.

5. **Rotation is not detectable when the replacement file is at least as large as the prior offset.**

   - Claim: B12 remains possible after same-size or larger replacement.
   - Evidence: Reset is triggered only by `fileSize < offset` ([spec.md:391](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:391)); reconnect accepts every offset `<= current size` ([spec.md:432](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:432)). Task 19 tests truncation and past-EOF cursors, not inode/file-identity change ([plan.md:708](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:708)).
   - Self-refutation: Claude commonly appends rather than rotates, but the spec explicitly promises rotation handling and emits a `"rotated"` reason. Size alone cannot supply that guarantee.

6. **The named end-to-end proofs do not prove several end-user goals.**

   - Claim: G1/G2/G4/G6 can be declared green while their stated behavior is broken.
   - Evidence: G1’s endpoint contradicts the route table and checks API kinds rather than DOM; G2 uses row timestamps and screenshots instead of controlled append/scroll measurements; G4 names two unscheduled tests and omits symlink containment; G6 can reuse an old viewer instead of serving the new build.
   - Self-refutation: Unit tests across layers provide useful evidence, but the card explicitly asks for end-user-visible E2E behavior. Layer-local assertions are proxies for that claim.

7. **A running pre-consolidation viewer will be reused as though it supports the new routes.**

   - Claim: After upgrade, the runner can print new `/s/<id>` URLs while continuing to serve the old status/`/live` process.
   - Evidence: The spec requires `/healthz` to remain byte-identical `v:1` ([spec.md:183](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:183)) and says the launch adapter changes only spawned argv ([spec.md:739](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:739)). The current probe checks only `viewer === "tribe-live-viewer"`, ignoring `v` ([viewer-launch.adapter.ts:41](/Users/hip/repo/tribe-wt/viewer-consolidation/plugins/tribe/scripts/runner/adapters/viewer-launch.adapter.ts:41)).
   - Self-refutation: The symlinked source updates on disk, but an already-running Bun process does not reload its route table or boot-time static asset map.

### Should-fix

1. **Pure decision logic is assigned to adapters.**

   - Claim: The design contradicts its “pure core decides everything” rule.
   - Evidence: `fs.adapter` drops partial lines ([plan.md:591](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:591)); `campaign.adapter` owns cache expiry and caps ([plan.md:620](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:620)); `poller.adapter` decides growth/reset/deletion/ping/frame emission ([plan.md:708](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:708)). `pure-core.md` explicitly rejects adapters accumulating validation, branching, or domain decisions ([pure-core.md:68](/Users/hip/repo/tribe-wt/viewer-consolidation/plugins/tribe/rules/pure-core.md:68)).
   - Self-refutation: Adapters must own filesystem and clock calls, but line-boundary selection, cache policy, and the tail transition function are deterministic over supplied observations and can remain core.

2. **Symlink containment and narrow parse catches are promises without executable contracts.**

   - Claim: G4 does not mechanically prove every resolved target remains inside its root or that each external parse is narrowly caught.
   - Evidence: The spec promises resolved-target refusal ([spec.md:906](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:906)), but path tests cover lexical segments only ([plan.md:248](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:248)); the filesystem-adapter task has no escaping-symlink case. Failure outcomes are stated, but no test prohibits broad catches or distinguishes `SyntaxError` from filesystem failures.
   - Self-refutation: `containedJoin` blocks textual traversal, but lexical containment cannot detect an in-root symlink pointing outside, exactly the case the spec promises to refuse.

3. **B13 is not closed by construction.**

   - Claim: Pairing state and client rows can grow for the life of a stream.
   - Evidence: §7.5 requires a pairing `Map`; no lifecycle or maximum is specified. The client appends every `rows` frame. The performance table claims a 500-row per-stream window ([spec.md:1001](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1001)) without specifying eviction. The carry is called “capped at 1 MiB” yet may grow to 8 MiB ([spec.md:396](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:396)).
   - Self-refutation: The measured corpus has few unmatched calls and modest row counts, but the oracle is open-world and B13 specifically concerns lifetime growth, not today’s median.

4. **A subagent file appearing mid-stream is not a named test case.**

   - Claim: The `meta` promise can regress without a red test.
   - Evidence: §6 says `meta` fires when agents change ([spec.md:418](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:418)), but Task 19 does not create a new sidecar during an open parent stream. E2 only reconnects during a subagent-spawning run ([spec.md:1115](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/spec.md:1115)).
   - Self-refutation: Static subagent trees and tab tests cover discovery after the file exists; they do not prove discovery while the parent connection remains open.

5. **The D9 “exactly five hits” precondition is false on the current tree.**

   - Claim: Task 29’s expected-before proof cannot match reality.
   - Evidence: The plan expects five total grep hits ([plan.md:1050](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1050)); the stated commands currently return seven: two `supervisor` and five `status viewer`, including unlisted `runner/README.md:76` and `:129`.
   - Self-refutation: Those two lines lie in README ranges already scheduled for rewriting, so the final zero result remains attainable; the defect is the false exact inventory and before-evidence contract.

6. **The C3 commands in every governance phase use unavailable entry points.**

   - Claim: Governance tasks are not executable as written.
   - Evidence: [plan.md:777](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:777) runs `c3x check && c3 lookup`; neither executable exists on `PATH`. The installed C3 skill requires its explicit `bin/c3x.sh` wrapper.
   - Self-refutation: `AGENTS.md` uses `c3` as shorthand, but the live toolchain and current C3 skill explicitly say there is no `c3` executable.

7. **The spec’s deletion list omits files that the plan deletes.**

   - Claim: §11.1 is not the exact deletion inventory it claims to be.
   - Evidence: Task 2 deletes `core/live/model.ts` and its test ([plan.md:164](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:164)); neither appears in spec §11.1 or §11.2.
   - Self-refutation: The implementation plan still names the files, so they are unlikely to survive accidentally; the defect is contract inconsistency, not missing implementation scope.

8. **The E2E teardown authorizes killing an unrelated process.**

   - Claim: “Kill whatever holds port 4399” exceeds the card’s authority.
   - Evidence: [plan.md:1160](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1160) does not require ownership or refuse when the port belongs to another process.
   - Self-refutation: The intended holder is likely the test’s own viewer, but the wording explicitly covers any holder and therefore does not preserve that ownership boundary.

### Optional

None.

## Task-order and brief-contract checks

- Empty-fixture work is correctly first: Phase 0 Task 1 precedes lifecycle/server implementation.
- Governance is correctly placed at each phase end: Tasks 3, 14, 21, 26, 29, and 33.
- Hunter briefs carry the task, oracle, global constraints, and adjudication rule verbatim ([plan.md:1215](/Users/hip/repo/tribe-wt/viewer-consolidation/docs/tribe/planning/viewer-consolidation/plan.md:1215)).
- The adjudication exclusions were respected: no findings were raised for runner-log reads, unavailable L9 events, unspecified colours/fonts, or code scheduled for deletion.
- D1–D8 are otherwise represented; D9 needs the inventory correction above.
- Runner stdout lines, plugin install build, c3-215 changes, and the major deletion work are all explicitly scheduled.

## Unverified claims

- C3 seal and structural integrity could not be verified in the read-only, network-restricted environment.
- No implementation tests were run because this is a pre-code spec/plan review.

REWORK — the P1 authority/token contracts conflict, live tool-result and SSE-resume designs can lose updates, stale viewer reuse defeats the new routes, and G1/G2/G4/G6 lack direct proof.


sol exit=0
