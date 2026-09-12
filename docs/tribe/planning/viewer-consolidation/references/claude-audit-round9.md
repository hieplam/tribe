# Round-9 spec-and-plan review (Claude Opus 5, replacing Sol)

Subject: `spec.md` revision 12 + `plan.md` revision 12 (`924d677`), against the idea card,
STATE.md D1–D28/P1, the oracle in spec §0, and `pure-core` / `fail-closed-edges` /
`fixtures-mirror-reality` / `brief-contracts`.

Method: read spec §1 in full, then §3.2, §4, §6.1, §6.3, §6.4, §7.1, §7.5, §8.4, §11, §14, §15,
§16.2–§16.4 and plan Global Constraints + tasks 1, 5, 8, 9, 13, 18, 24, 28, 29; other sections
opened only to check a named claim. Every remnant-style finding below was grepped across **both**
files and cites every surviving location. Read-only: nothing in the repo was edited, staged or
committed; this file is the only write. Ground truth sampled read-only from `~/.claude/projects`
and from `plugins/tribe/**` on the worktree.

---

## 1. Round-8 findings — closure audit

| Round-8 finding | Status | Evidence |
| --- | --- | --- |
| **B1** — D22 has two owners for the rendered-count proof | **CLOSED** | §16.2 now says "Two of the three are asserted by `fixtures/build.test.ts` (task 1); the third is asserted by `fixtures/session4.rendered.test.ts` (task 9) — D22" ([spec.md:2548](spec.md)); Task 1 asserts only rows + candidates ([plan.md:286–295](plan.md)); Task 9 owns the ≥2,300 assertion ([plan.md:736](plan.md)). Named test: `fixtures/session4.rendered.test.ts`. The old §16.2 assignment to `build.test.ts` is gone (grep: no surviving instance). |
| **B2** — the row-level ladder under-renders a mixed `tool_result`+`text` row | **CLOSED as a rule** | D28 ([spec.md:209–216](spec.md)) and the block-level ladder ([spec.md:1368–1384](spec.md)) give that row one Patch **and** one prompt node. *But the rule now has no fixture and no assertion anywhere — see new Blocker N2.* |
| **B3** — the coverage proof needs pairing before the pairer exists | **CLOSED** | Split by D28: Task 8 asserts `pairable` only and is told "Do not reimplement pairing here" ([plan.md:674–679](plan.md)); Task 9 extends the same file ([plan.md:729–734](plan.md)). Named test: `core/normalize.coverage.test.ts`, two stages. |
| **B4** — the backward algorithm cannot cross the row it exists for | **CLOSED for the stated case** | D26 replaces slice-stepping with newline search; the previous row's start is derived from the nearest `\n` strictly before `anchor-1`, and an over-cap row is anchored at its *true* start by an unbounded, non-retaining scan ([spec.md:1099–1147](spec.md)). Named tests: `serve.reads.test.ts` (task 18) and `core/tail.test.ts` (task 5), at 2 MiB **and** 9 MiB. *Two residual defects in the replacement — see N1 and S4.* |
| **B5** — the deletion guard requires the new wire model not to exist | **CLOSED** | §11.1 now lists `core/live/model.ts` (not `core/model.ts`); §11.1b "Files REPLACED in place" plus guard rule 4 assert `core/model.ts` **exists and exports `RENDER_NODE_KINDS`** ([spec.md:2051–2070](spec.md), [spec.md:2103–2115](spec.md)); Task 28 implements the split ([plan.md:1882–1890](plan.md)). Named test: `deletion-guard.test.ts` rules 3 + 4. |
| **B6** — the D9 sweep renames a true viewer reference into "watchdog" | **CLOSED** | §15 now states "D9 retires only the PROCESS NAMES" and rewrites sites 3 and 4 to keep "the viewer reads `run.json`" ([spec.md:2371–2392](spec.md)); Task 29 repeats the distinction and its audit lens checks it ([plan.md:1943–1952](plan.md), [plan.md:1968–1974](plan.md)). I verified all seven `file:line` sites resolve to the quoted text on disk today. *The site list is nonetheless incomplete — see S6.* |
| **S1** — one affirmative "dev-only" hook remnant | **CLOSED** | Grep for `dev-only`/`dev/prod` over both files returns only explanatory instances ([spec.md:219](spec.md), [spec.md:1762](spec.md), [spec.md:2145](spec.md), [plan.md:131](plan.md)); §16.3 step 2 now reads "the entry point of §8.4 (it **ships**, D25)" ([spec.md:2693](spec.md)). |
| **S2** — `raw.text` conflates oversized and unreadable | **CLOSED** | §4 scopes `text` to `rowType:"oversized"` **only** and says an unparsable row "is NOT a raw card at all" ([spec.md:618–625](spec.md)); §6.5 and §13 repeat the distinction ([spec.md:1275](spec.md), [spec.md:2318](spec.md)); Task 9 asserts all three outcomes and Task 5 asserts the kind, not the presence ([plan.md:759–765](plan.md), [plan.md:551–556](plan.md)). |

**All eight round-8 findings are closed at the level they were raised.** Three of the closures
introduced or left uncovered the issues below.

---

## 2. Contract checks (only what revisions 11–12 touched)

**Goals.** G2, G3, G4, G5, G6 each still resolve to a named, end-user-level proof, and G5's
proof is now satisfiable (B5). **G1's proof is still partly a proxy**: `dom-kinds.e2e.test.ts`
covers kind coverage (runtime witness), 12 input shapes and set-equality of the session list, but
the one shape D28 was issued for — a single row carrying both a `tool_result` and a `text` block —
is in neither the fixture inventory nor the layer-2 table (N2).

**Historical defects.** B3, B4, B5, B7, B9, B12, B13, B14, B16 remain closed by construction (§9,
§12.2, §8.3, §7.2, §6.1, §6.5, §13, §12.5) — unchanged by revisions 11–12. B1/B2 are closed for
every shape the fixture builds; they are re-opened only for the mixed row of N2, where the prompt
text is the thing at risk.

**Purity / fail-closed.** Placement is sound everywhere it is stated: decisions in `core/**`,
`serve.ts` composes, two adapters own the world, narrow catches are asserted as *distinguishable*
outcomes (`readonly.test.ts` case 2), and every outside path is lexically and resolved-contained
before use. The one gap is **placement that is never stated**: the D26 backward reader (N3).

**SSE (D12).** Fresh-snapshot reconnect, per-connection sequence ids cleared on `open`, new
`generation` per connection with a store-clearing rule, `retry: 2000`, `Last-Event-ID` asserted
absent by source grep, rotation via inode, mid-stream sidecar via `meta`. Complete — except that
the connect-time handoff from the snapshot to the tail state is undefined (N1).

**Five real row shapes.** Array-content prompt (§7.2 + §16.2 layer 2), `tool_result` with
`is_error` (§7.5 + `[data-state="error"]`), empty thinking (silent by design, absence asserted),
`<persisted-output>` (§7.6 + `/api/spill` containment), compaction boundary (`divider`). All five
map to a fixture row and a DOM or unit assertion.

**Task order / briefs.** Task 1 is the empty-fixture task and runs before any implementation task;
governance closes phases 0–5 at tasks 3, 14, 21, 26, 29, 33; briefs carry the oracle, the quoted
governing constraints and the six-clause adjudication rule verbatim. `install.sh`, `doctor.sh` and
`test-install-viewer-build.sh` are scheduled (task 26), the two runner stdout lines are asserted
verbatim (task 27 + §16.4), and the deletion list is mechanical (task 28).

---

## 3. New findings

### Blocker

**N1 — the snapshot's trailing partial row has no rule, and the snapshot→tail handoff is undefined.**

- File: [spec.md:1105](spec.md), [spec.md:1109–1140](spec.md), [spec.md:1060–1061](spec.md),
  [spec.md:447](spec.md)
- Claim: D26's backward loop assumes the file ends on a row boundary, and nothing says what the
  forward tail's initial `offset`/`carry` are. Both matter on exactly the files the viewer exists
  for: the ones being appended to right now.
- Evidence: the loop starts `anchor := EOF` and treats `anchor-1` as the previous row's terminator.
  When the last byte of the file is **not** `0x0A` — a row caught mid-write — the first iteration
  takes `end := EOF-1`, finds the newline that ends the last *complete* row, and yields
  `row := [start, EOF-1)`: the partial row, minus its final byte, parsed as if it were a record. It
  fails `JSON.parse`, so the user gets an `unreadable` card at the tail of every live session —
  against a corpus §0 measured at **0 parse failures in 127,085 rows**, and §13 calls that path
  "defence, not a hot path". D26 removed the only sentence that had ever handled a partial row
  ("drop the leading partial row unless at BOF", still visible as a remnant at
  [plan.md:1261](plan.md)). The second half compounds it: the only depiction of the handoff is the
  §6.2 sequence diagram — `P->>F: read the window …` then `P->>C: advanceTail on raw bytes`
  ([spec.md:1060–1061](spec.md)) — while §6.1's transition computes
  `offset' := state.offset + read.length`. Feeding the window bytes to `advanceTail` from a zero
  state leaves `offset` at the *window's length*, so the next tick reads from the middle of the
  file and re-emits history. `to` is defined only as "the window's end" ([spec.md:447](spec.md));
  no text says whether that is EOF or the end of the last complete row, and no test pins it.
- Self-refutation attempted: a competent hunter would probably seed `offset := to`, treat the bytes
  after the last `\n` as the initial `carry`, and stop the backward loop at the last newline rather
  than at EOF — §6.1's `combined := carry ++ read` gives that a natural home. But that is an
  inference, not a contract: Terra (the blind reader) cannot derive it from the page, the §6.2
  diagram depicts the wrong thing, no task brief states it, and no named test in tasks 5, 18 or 19
  takes a snapshot of a file whose last byte is not `\n`. Under the oracle a row present on disk
  that renders as `unreadable` is under-rendering, which is a bug. Finding stands.

**N2 — D28's mixed row is ruled on, never built, and never asserted.**

- File: [spec.md:1364](spec.md), [spec.md:213](spec.md), [plan.md:672](plan.md),
  [plan.md:261–278](plan.md), [spec.md:2571–2591](spec.md)
- Claim: the shape that caused D28 is absent from the fixture and from every assertion table, so
  the ladder's per-block behaviour is provable nowhere.
- Evidence: the ruling cites a real row —
  `~/.claude/projects/-Users-hip-repo-tribe/5f01ddc5-.../subagents/agent-a09522dcffd66dd8a.jsonl`
  line 33 — and I confirmed it on disk: `type: "user"`, content block types `['tool_result',
  'text']`; a corpus sweep finds **5 such rows in 5 files** across 127,085 rows. Task 1's inventory
  ([plan.md:261–278](plan.md)) and §16.2's inventory ([spec.md:2511–2528](spec.md)) list no row with
  a `tool_result` **and** another block; §16.2's layer-2 table ([spec.md:2571–2591](spec.md)) has no
  row for it; Task 8 and Task 9 classify "every row and every block **of the fixture**"
  ([plan.md:656](plan.md), [plan.md:729](plan.md)), so with no such row in the fixture a purely
  per-row implementation passes the coverage test green. The failure mode is precisely B2's: the
  `text` block — on the real row, the fork directive — disappears. §16.2's own standard is "A shape
  a later task needs but the fixture's test does not pin is a shape that can silently disappear."
- Self-refutation attempted: the shape is rare (5 rows), and Task 8's audit lens asks Sol to run
  the coverage test against a real transcript, which *might* catch it. But "might, if the auditor
  picks one of 5 files out of 908" is not a proof, the adjudication rule does not refute it (it is
  on disk, so clause (b) does not apply), and the fix is one fixture row plus one DOM assertion.
  Finding stands.

**N3 — the D26 backward reader has no owning module, no unit test, and by default lands in the
composition root.**

- File: [spec.md:383](spec.md), [spec.md:1099–1140](spec.md), [plan.md:1272–1290](plan.md),
  [plan.md:1219–1221](plan.md), [plan.md:1123](plan.md)
- Claim: the most intricate decision procedure in the design — redesigned three times (D20, D24,
  D26) — is assigned to no file, tested at no unit boundary, and can only be implemented at an
  impure edge.
- Evidence: §3.1's layout scopes `core/window.ts` to "complete-line selection over supplied raw
  bytes" ([spec.md:383](spec.md)) — not a read-and-decide loop. The fs adapter is explicitly
  forbidden to decide: Task 15's audit lens says it "makes no line-boundary, cache or reset
  decision — those belong to `core/window.ts`, `core/cache.ts` and `core/tail.ts` (`pure-core.md`:
  an adapter that accumulates decisions is a Should-fix)" ([plan.md:1123](plan.md)). Yet the D26
  loop *is* read-and-decide: doubling slice reads interleaved with newline search, an OVERSIZED
  branch, candidate accumulation and a whole-row trim. The only task that creates it is Task 18,
  whose `Create:`/`Modify:` list is `serve.ts` + `serve.reads.test.ts`
  ([plan.md:1219–1221](plan.md)) — so the loop lands in the composition root, proved only through
  HTTP. §3.2 also requires *one* implementation for two entry points ("one algorithm, two entry
  points", [spec.md:449](spec.md)), and `hello` (task 19) needs the same code, which no task
  exports. §12.6's wall does not catch this: `serve.ts` may call the adapter, so decisions there
  pass every structural rule.
- Self-refutation attempted: `serve.ts` is allowed to touch the world, so nothing *illegal* happens,
  and the algorithm could be read as an elaboration of `core/window.ts` that a hunter will place
  there anyway. But `pure-core` grades complex logic that can only run with a live filesystem as
  Blocker/Should-fix, the seam is trivial (`findWindowStart(readSliceBackward, anchor, limit)` with
  the read injected, unit-tested over an in-memory buffer), and the 2 MiB / 9 MiB / four-block-row
  cases are far cheaper to prove at that seam than through `/api/rows`. A procedure with no home and
  no owner is also how the same defect came back three revisions running. Finding stands.

### Should-fix

**S1 — Task 5's named test asserts the opposite of D26 for the 2 MiB row.**

- File: [plan.md:555](plan.md) (sole surviving location), contradicted by
  [plan.md:560–563](plan.md), [plan.md:276–277](plan.md), [spec.md:967–969](spec.md).
- Claim: the brief names a test that, if written as worded, pins the pre-D26 1 MiB behaviour.
- Evidence: "Named test: **a 2 MiB single-line row is skipped, one `raw` "row too large" node is
  emitted at its offset, and the NEXT row parses normally**" — three lines above "The **2 MiB** row
  is UNDER the cap and must **parse normally** … The **9 MiB** row is over the cap and yields
  exactly one `raw oversized` node." Grep over both files shows every other 2 MiB/9 MiB mention is
  the D26-correct pairing.
- Self-refutation attempted: the correcting paragraph is bold, immediately below, and cites the
  1 MiB draft by name, so the hunter cannot make both assertions green and will resolve it. It
  still costs a red round on the one ruling the Shaman issued to stop exactly this disagreement, and
  the fix is one word ("2 MiB" → "9 MiB"). Finding stands at Should-fix.

**S2 — the row-level ladder has no rung for a non-message row that emits a node.**

- File: [spec.md:1371–1379](spec.md), [plan.md:658–666](plan.md) (both copies identical)
- Claim: as written, the classifier sends every metadata/attachment/unknown row to rung 5 (silent),
  which is B10 restated.
- Evidence: the ladder is rungs 1, 2, "descend to BLOCK level if the row is `user`/`assistant`",
  then "5. silent by design → only if EVERY block came out silent". D23's rung 4 ("rows that emit
  nodes", quoted intact at [spec.md:186](spec.md) and [plan.md:101](plan.md)) appears in neither
  box, and rung 5's guard is vacuously true for a row with no blocks — so `attachment` (14,032
  rows), `system` (1,062), `mode`, `queue-operation`, `pr-link` and the whole open-world `raw`
  bucket have no matching rung. Task 8's coverage test is written from this box.
- Self-refutation attempted: §7.1's five-bucket list sits directly above and assigns a rendering to
  every row type, Task 8 step 2 says the row dispatch's default branch is a `raw` node, and §7.1
  bucket 5 caps the silent set at two entries — so a careful implementer will not drop 24 row types.
  But the box is labelled "the mechanical guarantee" and is the literal source of the coverage
  enum; an enum missing a bucket for ~24 row types is the proof failing, not the code. Restore
  rung 4 to both boxes. Finding stands.

**S3 — a pre-D26 fixed-slice description survives inside the task that implements D26.**

- Grep over both files for `256 KiB` / `leading partial` / `fixed slice` / `backwards-stepping`
  gives three non-ruling hits worth acting on, of which one is a genuine contradiction:
  - [plan.md:1260–1261](plan.md) — "found by spec §6.3's backwards-stepping algorithm — **read
    backwards from EOF in 256 KiB steps, drop the leading partial row unless at BOF**, parse
    complete rows, accumulate the node count, stop at ≥500 nodes or BOF, then trim" — twelve lines
    above [plan.md:1272](plan.md), "walks ONE ROW AT A TIME by newline search (D26), **never by
    fixed slices**". Same task, same step, opposite algorithms.
  - [spec.md:1165](spec.md) — "The loop reads whole 256 KiB slices and overshoots" — under D26 the
    loop reads whole *rows* and overshoots; the slice is now only how a newline is found.
  - [spec.md:2353](spec.md) — §14's "backwards 256 KiB steps" is defensible shorthand for the
    initial step; listed for completeness, no change needed.
  (`spec.md:736/771/780` and `spec.md:1112/1120`, `plan.md:107/110/1275` are §5.3's title read and
  the D26 ruling/algorithm themselves — not remnants.)
- Self-refutation attempted: plan.md:1272 is later, bolder and cites D26, so it wins on any careful
  read. But brief-contracts is explicit that a brief carrying two statements of the same rule is how
  a correct agent produces a wrong artifact, and this pair is inside one bullet of one step.

**S4 — at exactly `ROW_CAP` the two readers still disagree, which is the defect D26 exists to kill.**

- File: [spec.md:944](spec.md) (forward), [spec.md:1112–1120](spec.md) (backward),
  claim at [spec.md:1185–1188](spec.md)
- Claim: "a user reaching that row either way sees the same card" is false for one row length.
- Evidence: forward — `if not skipping and carry.length > ROW_CAP` → oversized iff row length
  **≥ ROW_CAP+1**. Backward — the doubling stops at `step := ROW_CAP`, so `lo = end - 8 MiB` and the
  preceding newline at index `start-1` is inside the scanned range iff row length **≤ ROW_CAP-1**;
  a row of exactly 8,388,608 bytes is therefore parsed by the tail and declared `oversized` by the
  snapshot. The named tests (2 MiB, 9 MiB) cannot see it.
- Self-refutation attempted: the probability of a row landing on exactly 8,388,608 bytes is
  negligible, and an implementer might naturally write `>=` on one side. But D26's entire purpose
  was "one cap, one definition of a row boundary, both readers", the spec states the algorithm to
  the byte, and closing it costs one clause plus one boundary-value case.

**S5 — `<session-live>.jsonl` is named by three places and built by none.**

- File: [spec.md:2624](spec.md), [plan.md:2041](plan.md), [plan.md:2117](plan.md) vs
  [spec.md:2487–2500](spec.md), [plan.md:261–278](plan.md), [plan.md:341–344](plan.md)
- Claim: E2's writer has no defined target and E2's zero-write digest excludes a file that does not
  exist.
- Evidence: the digest table says the live-tail suite hashes "the whole copy **except
  `<session-live>.jsonl`**, the single file its writer appends to", and Task 31 repeats it twice.
  The `homeA` tree and Task 1's inventory build `<session-1>`…`<session-4>` only, and Task 1's
  by-hand verification asserts "**exactly four** `<project>/<session>.jsonl` files … **No other
  file**" ([plan.md:341–344](plan.md)). A grep across both documents finds no builder for it.
- Self-refutation attempted: `<session-live>` may be intended as a placeholder for whichever
  session E2 appends to, and a hunter writing both the writer and the digest will make them agree
  by construction. But `fixtures-mirror-reality` obligation 2 and §16.2's own rule put every shape
  a later task consumes in the fixture's own test, and the four other sessions are named
  concretely; naming the fifth (or re-pointing the exclusion at `<session-1>`) costs one line.

**S6 — the D9 sweep's "exact list" misses an eighth site, and Task 29's gate cannot see it.**

- File: [spec.md:2371](spec.md), [plan.md:1922–1930](plan.md),
  `plugins/tribe/scripts/viewer/package.json:6`
- Claim: after this card the viewer package still describes itself as a "status viewer" that scans
  `~/.tribe` and server-renders HTML — three statements the card falsifies.
- Evidence: `package.json:6` reads
  `"description": "Read-only, refresh-based status viewer for tribe campaign runners (scans ~/.tribe, server-renders HTML; zero writes)."`
  My own sweep of `plugins/tribe` finds **eight** `status viewer`/`supervisor` sites, not seven —
  the seven in §15's table (all verified at the quoted `file:line`) plus this one. Task 29's gate is
  `grep -rn 'status viewer' plugins/ .c3/ --include='*.md'` ([plan.md:1924](plan.md)), fenced by
  file type, so "Expected after: zero" is satisfiable while the falsehood ships; §11.3's doc table
  and Task 22's `package.json` edit (deps only, [plan.md:1507](plan.md)) do not touch it either.
- Self-refutation attempted: a package description is not a "process name", so D9 proper may not
  reach it; but §15 claims to be "the exact list" of `status viewer` occurrences, G6 includes "D9
  applied", and the line is false on three independent counts after the rewrite. Fence by intent
  (drop `--include='*.md'`, or add site 8) rather than by form.

**S7 — the revision-12 renumbering of the deletion guard left three stale references.**

- File: [spec.md:278](spec.md), [plan.md:1884](plan.md), [plan.md:1905](plan.md)
- Claim: G4's named proof now points at the wrong guard rule.
- Evidence: at revision 11 §11.4 was numbered `1, 2, 3, 3b, 4, 5` with **5 = the zero-write wall**
  (`git show f06e43f:…/spec.md`); revision 12 renumbered it to `1…6`, so rule 5 is now
  "`campaign.adapter.ts` is the only file containing `.tribe`" and rule 6 is the wall. §2's G4 row
  still cites "`deletion-guard.test.ts` rule 5" ([spec.md:278](spec.md)). The plan kept the old
  label ("Rule 3b", [plan.md:1884](plan.md)) and its audit lens still says "run the grep guard's
  **five** rules yourself" ([plan.md:1905](plan.md)) against a six-rule guard.
- Self-refutation attempted: both rules are asserted by the same file, so nothing goes untested;
  but the spec's own standard is that a goal map naming the wrong proof is a goal with no proof,
  and an audit lens that counts five will stop one short.

### Optional

**O1 — §4's D19 comment names a field that no longer exists.**

- File: [spec.md:605–611](spec.md)
- The comment on `call`/`resultAnchor` reads "`result` is the `tool_result` block in its LATER row,
  filled by pairing" — but on the same node `result` is `ToolResult | null` (the payload) and the
  anchor is `resultAnchor`. The quoted D19 ruling ([spec.md:167](spec.md)) still says `result` for
  the anchor, which is the ruling stating itself, not a remnant; the comment is a rename the
  revision did not finish. §4's D15 paragraph and Task 9 both use `resultAnchor` correctly.

---

## 4. Nothing to report on

Checked and clean this round, listed so the next reviewer does not re-open them: the `/api/rows`
contract including `orphans=`/`patches` and both ops (§3.2, §7.5, §8.4, tasks 13/18/24 agree
verbatim); the `remove`-not-`result` identity argument; per-connection sequence + generation and the
watermark-cleared-on-open case; eviction bounds (§6.5) and their perf restatement (§14); the D16
allowlist and the `process.kill(pid, 0)` carve-out; path containment for transcript, sidecar, spill,
project, campaign-directory, `campaign-state.json` and `run.json`; the two-badge collision fixture
and the sessionId-copy step in §16.4; the three-project D10 fixture and set-equality session listing;
`install.sh` / `doctor.sh` / `test-install-viewer-build.sh` scheduling; the six-clause adjudication
rule, which correctly refutes (a)–(f) in advance.

Adjudication-rule clauses (a)–(f) were applied: no finding above rests on the viewer reading more of
`~/.tribe`, on a Kanna behaviour absent from disk, on unspecified colours, on an inherited defect the
plan deletes, on `/healthz` v2, or on the DOM suites failing without Chromium.

---

## Verdict

**APPROVE-WITH-FIXES** — N1 (partial trailing row + snapshot→tail handoff), N2 (build and assert the
mixed `tool_result`+`text` row), N3 (give the D26 backward reader a pure home with an injected read
and its own unit test); then S1–S7 (Task 5's 2 MiB named test, the missing rung 4, the fixed-slice
remnant at plan.md:1260, the `ROW_CAP` boundary, `<session-live>`, D9 site 8 + the `*.md` fence, and
the guard renumbering). No ruling needs reopening: every fix is a statement the documents already
imply, written down.
