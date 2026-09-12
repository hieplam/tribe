# Round-10 closure check (Claude Opus 5, skinner)

Subject: `spec.md` + `plan.md` **revision 13** (`51efd36`), against round 9
(`claude-audit-round9.md`), the rulings D1–D31/P1 in
`~/.tribe/-Users-hip-repo-tribe/viewer-consolidation/STATE.md`, the idea card, and
`pure-core` / `fail-closed-edges` / `fixtures-mirror-reality` / `brief-contracts`.

Method, per the brief: (1) each round-9 item closed or not, reading only what revision 13 touched
for that purpose — spec §0, §1, §6.1–§6.3, §7.1, §15, §16.2; plan Global Constraints and tasks 1,
5, 8, 9, 18, 19, 28, 29, 30 — driven off `git diff 924d677 51efd36`; (2) regressions **inside those
same places only**. Sections closed in rounds 1–9 and untouched by revision 13 were not re-opened
(noted where I looked and deliberately did not report: §16.2's "pins BOTH counts" heading over a
three-row table, and task 5 step 3's run command, both pre-date revision 13). Every remnant below
was grepped across **both** files and cites every surviving location. Read-only: this file is the
only write.

---

## 1. Round-9 closure table

| Item | Status | Evidence |
| --- | --- | --- |
| **N1** — partial trailing row + snapshot→tail handoff undefined | **OPEN** (rule written, rule is wrong, fixture unbuilt) | D30 is quoted at [spec.md:241–244](spec.md) and [plan.md:132–136](plan.md); `to` redefined at [spec.md:475](spec.md); `windowEnd`/`carrySeed` at [spec.md:1170–1176](spec.md) and prose at [spec.md:1214–1224](spec.md); the §6.2 diagram redrawn at [spec.md:1103–1104](spec.md); the seed block added at [spec.md:907–918](spec.md). Named tests exist: `core/tail.test.ts` case 0 ([plan.md:555–561](plan.md)), `core/window.test.ts` + `serve.reads.test.ts` against `<session-cut>.jsonl` ([plan.md:1350–1356](plan.md)), `poller.adapter.test.ts` ([plan.md:1433–1437](plan.md)). **But** the seed's arithmetic contradicts §6.1's own invariant (**R1, Blocker**) and `<session-cut>.jsonl` is built nowhere (**R2, Blocker**). |
| **N2** — D28's mixed row ruled on, never built, never asserted | **CLOSED** | Corpus count folded into §7.1 ([spec.md:1459–1467](spec.md)); fixture inventory rows at [spec.md:2630](spec.md) and [plan.md:290](plan.md); an explicit build-and-assert step at [plan.md:331–335](plan.md); task 8 asserts both blocks from the one row ([plan.md:713–724](plan.md)); task 9 extends it to "one Patch **plus** one surviving prompt node" ([plan.md:723–724](plan.md)); §16.2 layer-2 DOM row at [spec.md:2702](spec.md); task 30 DOM case at [plan.md:2093–2096](plan.md). Named tests: `fixtures/build.test.ts`, `core/normalize.coverage.test.ts` (tasks 8 **and** 9), `e2e/dom-kinds.e2e.test.ts`. One under-specification remains (**R5, Should-fix**). |
| **N3** — the D26 backward reader has no home, no unit test | **CLOSED** | D31 quoted at [spec.md:242–246](spec.md) and [plan.md:137–140](plan.md); `core/window.ts` re-scoped at [spec.md:410–411](spec.md); the signature and the purity argument at [spec.md:1141–1162](spec.md); task 18's `Modify:` list now carries `V/core/window.ts` + `V/core/window.test.ts` ([plan.md:1267](plan.md)) with the same signature and an enumerated in-memory case list ([plan.md:1318–1334](plan.md)); "one implementation, two entry points" bound to `hello` at [spec.md:1160–1162](spec.md) and [plan.md:1433–1434](plan.md). Named tests: `core/window.test.ts` (in-memory `readBack`: 2 MiB, 9 MiB, exactly-`ROW_CAP`, cut-mid-row), `serve.reads.test.ts` as the integration proof. |
| **S1** — task 5's named test asserted the opposite of D26 for the 2 MiB row | **CLOSED** | The named test now reads "with the **9 MiB** row (over `ROW_CAP`)" ([plan.md:586–589](plan.md)) and a bold correcting paragraph states the 2 MiB row is **not** skipped ([plan.md:591–593](plan.md)). Grep: no surviving "2 MiB … is skipped" anywhere in either file. Named test: `core/tail.test.ts`. |
| **S2** — the row ladder had no rung for a non-message row that emits a node | **CLOSED** | Rung 4 restored in **both** boxes — [spec.md:1474–1481](spec.md) and [plan.md:696–701](plan.md) — with rung 5's guard rewritten to "reachable **ONLY** by a message row whose every block came out silent", plus the "not optional scaffolding" paragraph and its row counts ([spec.md:1489–1497](spec.md), [plan.md:708–711](plan.md)). Named test: `core/normalize.coverage.test.ts` (task 8), whose enum is this box. |
| **S3** — a pre-D26 fixed-slice description inside the task that implements D26 | **PARTLY OPEN** | The plan remnant is gone: [plan.md:1305–1308](plan.md) now names `findWindow` and says "**not** a fixed-slice scan and **not** 'drop the leading partial row': both of those are pre-D26 descriptions and neither survives". The spec hit round 9 also listed is untouched — [spec.md:1251](spec.md) still says "The loop reads whole 256 KiB slices and overshoots" (**R6, Should-fix**). |
| **S4** — the two readers disagreed at exactly `ROW_CAP` | **CLOSED** | Forward: `# strictly greater: == ROW_CAP is a valid row` ([spec.md:986](spec.md)). Backward: `if step > ROW_CAP` with the reasoning inline ([spec.md:1186–1188](spec.md)) and in prose ([spec.md:1277–1282](spec.md)). Fixture row added at [plan.md:288](plan.md); asserted in task 5 ([plan.md:576–578](plan.md)), task 18 ([plan.md:1358–1360](plan.md)) and the `findWindow` unit list ([plan.md:1333](plan.md)). Named tests: `core/tail.test.ts`, `core/window.test.ts`, `serve.reads.test.ts`. One stale restatement survives (**R7, Should-fix**). |
| **S5** — `<session-live>.jsonl` named by three places, built by none | **CLOSED for `<session-live>`** | Now in the `homeA` tree ([spec.md:2608](spec.md)), the §16.2 inventory ([spec.md:2631](spec.md)) and task 1's inventory ([plan.md:291](plan.md)), matching the E2 digest exclusion ([spec.md:2742](spec.md), [plan.md:2130](plan.md), [plan.md:2206](plan.md)). The identical defect is re-created one row below for `<session-cut>.jsonl` (**R2**). |
| **S6** — the D9 sweep missed an eighth site and the gate could not see it | **CLOSED in the spec, OPEN in the plan** | Spec §15 now reads "8 sites — two `supervisor`, **six** `status viewer`" ([spec.md:2484](spec.md)) with site 8 spelled out ([spec.md:2503](spec.md)). The plan's gate did not follow: the executed command still filters `*.md`, the tally still says five, and the rollback trigger still says seven (**R3, Should-fix**). |
| **S7** — the revision-12 guard renumbering left three stale references | **CLOSED** | G4 now cites `deletion-guard.test.ts` **rule 6** ([spec.md:305](spec.md)), which §11.4 confirms is the zero-write wall in a 1–6 list; "Rule 3b" → "Rule 4" ([plan.md:1962](plan.md)); the audit lens now says "the grep guard's **six** rules" ([plan.md:1986](plan.md)). Grep for `rule 5` / `Rule 3b` / `five rules` returns nothing else. |
| **O1** — §4's D19 comment names a field that no longer exists | **OPEN** | Untouched by revision 13. [spec.md:635–637](spec.md) still reads "`result` is the `tool_result` block in its LATER row, filled by pairing, null while pending" on a member declared `resultAnchor: Anchor \| null` ([spec.md:638](spec.md)) — beside a *different* field on the same node, `result: ToolResult \| null` ([spec.md:632](spec.md)). The rest of the document uses `resultAnchor` correctly ([spec.md:659](spec.md), [spec.md:721](spec.md), [spec.md:1583](spec.md), [plan.md:796–801](plan.md)). Optional, as graded in round 9; listed because it was confirmed and is still there. |

**Seven of eleven closed outright; S3 and S6 closed on one side of the pair; N1 closed as a rule but
the rule as written is wrong and its fixture does not exist; O1 untouched.**

---

## 2. Regressions revision 13 introduced

### Blocker

**R1 — D30's seed violates §6.1's own offset invariant, so the first live tick concatenates the
partial row to itself.**

- File: [spec.md:907–918](spec.md) (the seed block), [spec.md:1103–1104](spec.md) (the §6.2
  diagram), [spec.md:241–244](spec.md) (the D30 quote), [plan.md:132–136](plan.md),
  [plan.md:555–561](plan.md) (task 5 case 0), [plan.md:1434–1435](plan.md) (task 19). Contradicted
  by [spec.md:925](spec.md), [spec.md:936–942](spec.md), [spec.md:945–950](spec.md).
- Claim: `offset := to` **together with** `carry := [to, eof)` double-counts the trailing bytes. The
  first tick's `combined` is `<partial><partial><rest>`, which fails `JSON.parse` — the exact
  `unreadable`-card-at-the-tail failure N1 was raised to eliminate, reintroduced by the fix for it.
- Evidence: §6.1 defines the state fields and the transition, and the three statements are
  mutually exclusive with the seed. (a) [spec.md:925](spec.md): "`offset` | every byte read so far,
  **including the raw carry**". (b) [spec.md:936](spec.md): `read := bytes [state.offset, min(fileSize,
  state.offset + 4 MiB))`, then `combined := state.carry ++ read`. (c) [spec.md:945–950](spec.md):
  "The next read starts at `offset`, not at `ackOffset` … the bytes between `ackOffset` and `offset`
  are not re-read, they are already **in `carry`** … Reading from `ackOffset` instead would re-read
  the carry bytes and duplicate them." The invariant those three sentences state is
  `offset == ackOffset + carry.length`. The seed at [spec.md:911–915](spec.md) sets
  `offset := to`, `ackOffset := to`, `carry := [to, eof)` — so `offset - carry.length == to - (eof-to)`,
  which is `ackOffset` only when the carry is empty. Concretely: snapshot at `eof = 1000`,
  `to = 900`, `carry = [900,1000)`. First tick reads `[900, newEof)` — the same 100 bytes that are
  already in `carry` — and `combined = carry ++ read` emits them twice. Note that `ackOffset` is a
  *tested* invariant (task 5 case 1: "for every state the machine passes through, the file has a
  `0x0A` at `ackOffset - 1`", [plan.md:562–565](plan.md)), and the seeded state fails the
  derived form `ack' := offset' - carry'.length` at [spec.md:942](spec.md) on tick one. The same
  wrong pair is restated in four more places, including the §6.2 diagram
  ("offset at to and carry the trailing bytes") and both hunter briefs, and it also governs the
  post-`reset` re-snapshot ([spec.md:964–970](spec.md)), which re-enters the same seeding path.
  Either of two one-word repairs is correct and the document must pick one: `offset := eof`
  (keep the carry — this is what §6.1's own invariant wants), or `carry := empty` (re-read
  `[to, eof)` on the first tick). D30 as quoted takes one half from each.
- Self-refutation attempted: task 19's integration assertion against `<session-cut>.jsonl`
  ([plan.md:1435–1437](plan.md)) would go red on the duplicated row, so a hunter cannot ship this
  silently. Three things stop that from saving it. First, the unit test that owns the rule (task 5
  case 0) supplies `read` by hand rather than deriving it from `offset`, so it passes with the
  broken seed — the brief's own named test cannot see its own defect. Second, the hunter facing a
  red integration test has a spec sentence telling it the seed is right, which is exactly the
  "a correct agent, following its instructions faithfully, produces a wrong artifact" shape
  `brief-contracts` is about; it costs a round on the one ruling issued to stop this. Third — and
  decisive — **D30 is a Shaman ruling quoted verbatim in both documents**; a warchief cannot
  correct it, so this one needs the Shaman's word rather than a revision. Finding stands.

**R2 — `<session-cut>.jsonl` is named by three plan sites, absent from the spec's fixture tree and
inventory, and forbidden by task 1's own by-hand verification.**

- File: [plan.md:292](plan.md), [plan.md:1355](plan.md), [plan.md:1435](plan.md) vs
  [spec.md:2600–2613](spec.md) (the `homeA` tree), [spec.md:2624–2644](spec.md) (the §16.2
  inventory), and [plan.md:362–365](plan.md) (task 1 step 3).
- Claim: N1's entire proof rests on a fixture file the spec never builds and task 1 explicitly
  asserts does not exist. This is S5's defect re-created, one table row below where S5 was fixed.
- Evidence: grep for `session-cut` returns **three hits, all in `plan.md`** — task 1's inventory
  row, task 18's named test ("snapshot `<session-cut>.jsonl` (task 1's file that does not end in
  `\n`) — **no `unreadable` node**"), and task 19's. The spec's §16.2 `homeA` tree
  ([spec.md:2600–2613](spec.md)) lists `<session-1>`, `<session-live>`, `<session-4>`,
  `<session-4>.rotated`, `<session-2>`, `<session-3>` and no cut file; the §16.2 inventory table
  gained rows for the mixed row and for `<session-live>` in this revision and none for the cut
  file — while the plan's own table declares "spec §16.2 carries the full table and this test is
  its enforcement" ([plan.md:268–269](plan.md)), so the two inventories now disagree about what the
  builder builds. Worse, task 1 step 3 is unchanged and still reads: "Expected: … **exactly four**
  `<project>/<session>.jsonl` files … **No other file**" ([plan.md:362–365](plan.md)). Before
  revision 13 that was exactly right (sessions 1, 4, 2, 3). Revision 13 added two session files —
  `<session-live>` (spec tree + both inventories) and `<session-cut>` (plan inventory only) — and
  left the count at four, so the hunter's hand-verification step now **fails by construction** and
  its "No other file" clause forbids both new files. §16.2's own standard applies verbatim: "A
  shape a later task needs but the fixture's test does not pin is a shape that can silently
  disappear" ([spec.md:2622–2623](spec.md)), and `fixtures-mirror-reality` obligation 2 grades a
  scaffolding plan with no matching empty-fixture verification as Should-fix before implementation.
- Self-refutation attempted: task 1's inventory table *is* a build list, so a hunter reading only
  the plan would create the file and the D30 tests would run; and "exactly four" is visibly stale
  the moment you read the row above it. But the hunter is instructed to paste that listing into the
  task report as evidence, and an audit lens is told to diff the generated tree against the spec —
  which does not contain the file — so the contradiction surfaces as a failed gate rather than as a
  build. The fix is three lines: one tree line, one §16.2 inventory row, and "exactly four" →
  "exactly six" with the two new names. Finding stands.

### Should-fix

**R3 — task 29's D9 gate was corrected in prose and not in the command, the tally, or the file
list.**

- File: [plan.md:2004–2017](plan.md), [plan.md:1992–1998](plan.md) (the task's `Modify:` list),
  against [spec.md:2484](spec.md) and [spec.md:2503](spec.md).
- Claim: four half-applications of S6 in one step, and the one that executes is the unfixed one.
- Evidence, each grepped:
  1. The fenced gate at [plan.md:2005](plan.md) still reads
     `grep -rn 'status viewer' plugins/ .c3/ --include='*.md'` — two lines above the prose
     "**Grep every file under `plugins/tribe/`, with NO `--include` filter**" at
     [plan.md:2008](plan.md), which explains that this very filter is what hid site 8. A brief
     carrying the rule and its negation in one step is `brief-contracts`' "fence by form" case; the
     command is the artifact the hunter runs.
  2. [plan.md:2014](plan.md): "two `supervisor` … and **five** `status viewer`" introducing a list
     of **six** (`README.md:225`, `runner/README.md:76`, `:129`, `:814`, `:860`, and the newly added
     `scripts/viewer/package.json:6`). Spec §15 says six ([spec.md:2484](spec.md)).
  3. [plan.md:2016](plan.md): "if it is not **seven**, the inventory is stale" — in a sentence whose
     own "Expected before" was changed to **eight** eight words earlier. The rollback trigger now
     fires on the correct outcome.
  4. The task's `Modify:` list ([plan.md:1992–1998](plan.md)) names `plugins/tribe/README.md`,
     `runner/README.md`, two `.c3/` files and `watch-loop.ts` — **not**
     `plugins/tribe/scripts/viewer/package.json`. Step 2 says "Apply the **eight** renames"
     ([plan.md:2022](plan.md)) but the eighth has no file in the contract, and task 22's
     `package.json` edit is deps-only ([plan.md:1507](plan.md)).
- Self-refutation attempted: the prose at [plan.md:2008–2011](plan.md) is bold, immediately
  adjacent, and names site 8 explicitly, so a careful hunter will drop the filter and reach eight.
  But "eight hits" and "if it is not seven" cannot both be satisfied by any run, the file list is
  the task's file-level contract, and the whole point of S6 was that an "exact list" a filter can
  hide a member from is not exact. Four one-token edits.

**R4 — D29 was quoted into both documents and applied to exactly one of the 33 places it governs.**

- File: [spec.md:245–247](spec.md) and [plan.md:133–134](plan.md) (the D29 quote) vs
  [spec.md:113–115](spec.md), [spec.md:129](spec.md), [spec.md:131–132](spec.md) (D4, quoted),
  [plan.md:235–236](plan.md), and 32 of 33 `Audit lens (Sol, …)` headers.
- Claim: the documents now state the reviewer model two ways, and the version that appears 32 times
  is the retired one.
- Evidence: D29 as added reads "Spec audits on an Opus subagent … blind reads on a Sonnet
  subagent", with the gloss "The roles in §1's opener are unchanged; only the models behind them
  are" ([spec.md:246–247](spec.md)). §1's opener does not separate the two: it defines the role
  *by* the model — "A **skinner** — run on the GPT-5.6 Sol model, hence 'Sol audits'" and "**Terra**
  is a blind reader" ([spec.md:113–115](spec.md)) — and D4 is quoted directly below as settled law:
  "Audit/review lenses run on GPT-5.6 Sol via Codex (`codex exec -m gpt-5.6-sol`); blind-reader page
  reviews on GPT-5.6 Terra" ([spec.md:131–132](spec.md)), with no note that D29 supersedes it. The
  plan is worse: [plan.md:236–237](plan.md) states "The audits run on GPT-5.6 Sol via Codex (D4);
  blind reads on GPT-5.6 Terra" — roughly 100 lines after quoting D29 to the contrary. Revision 13
  changed exactly one audit-lens header, task 28's, to `(Opus, contract)` ([plan.md:1986](plan.md));
  `grep -n 'Audit lens' plan.md` returns 33 headers, the other 32 still `(Sol, contract)`.
- Self-refutation attempted: the reviewer model is a dispatch fact, not a build fact, and no test
  turns on it — the audits will run on whatever the Shaman dispatches regardless of the header. But
  D29 is quoted as settled law in both documents while its predecessor D4 is quoted as settled law
  eight lines away and never marked superseded, and `brief-contracts` grades a governing document
  that contradicts itself as a Should-fix. Two lines (a "D29 supersedes D4's model choices" clause
  and the `plan.md:236` sentence) fix the contradiction; the 32 headers can ride the same pass or
  be left as role names if §1 stops defining the role by the model.

**R5 — the mixed row's `tool_result` has no stated pairing partner, but three assertions require
one.**

- File: [spec.md:2630](spec.md), [plan.md:290](plan.md), [plan.md:331–335](plan.md) vs
  [plan.md:723–724](plan.md), [spec.md:2702](spec.md).
- Claim: N2's fixture row is pinned as a shape but not as a *pairable* shape, and every assertion
  built on it says "Patch".
- Evidence: the three build-side statements say only "one `user` row … whose `message.content` array
  contains **both** a `tool_result` and a `text` block". The three consume-side statements demand
  the paired outcome: task 9 — "**including the mixed row's**, which must come out as one Patch
  **plus** one surviving prompt node" ([plan.md:723–724](plan.md)); §16.2 layer 2 — "the tool card
  gains its result **and** `[data-kind="prompt"]` … is **visible**" ([spec.md:2702](spec.md)); task
  30 repeats it ([plan.md:2093–2096](plan.md)). A Patch exists only when the `tool_result`'s
  `tool_use` is in pairing state, i.e. present and inside the window. Nothing says the builder puts
  the call there; `<session-1>` separately holds a deliberately *orphaned* result
  ([spec.md:2629](spec.md)), so "a `tool_result` in `<session-1>`" is not evidence of a call.
- Self-refutation attempted: a hunter building a row that must yield "one Patch and one prompt node"
  will naturally write the matching `tool_use`, and the DOM assertion would fail loudly otherwise —
  so this is very likely to self-correct on the first red. But it self-corrects in task 9, three
  tasks after the fixture is frozen, and §16.2's rule is that the fixture's own test pins every
  shape a later task consumes. One clause on the inventory row: "…whose `tool_use` is earlier in the
  same window".

**R6 — the pre-D26 fixed-slice sentence survives in the spec (round 9 S3, spec half).**

- File: [spec.md:1251](spec.md) (sole surviving location), contradicted by
  [spec.md:1237](spec.md), [spec.md:1178–1210](spec.md), [plan.md:1305–1308](plan.md).
- Claim: §6.3 explains the whole-row trim by an algorithm §6.3 no longer describes.
- Evidence: "**The trim is by whole rows** … The loop reads whole 256 KiB slices and overshoots"
  ([spec.md:1250–1251](spec.md)) sits fourteen lines below its own correct form — "The loop yields
  whole rows, so it usually overshoots `limit`" ([spec.md:1237](spec.md)) — and below an algorithm
  in which 256 KiB is the *initial newline-search step* ([spec.md:1184](spec.md)), never a unit of
  work. Grep over both files: the plan's twin (round 9's `plan.md:1260–1261`) was rewritten and now
  says the opposite explicitly; §14's "backwards 256 KiB steps" ([spec.md:2466](spec.md)) is the
  shorthand round 9 declared needs no change; §5.3's head/tail read ([spec.md:764](spec.md),
  [spec.md:799](spec.md), [spec.md:808](spec.md)) is a different mechanism. So `spec.md:1251` is the
  last one.
- Self-refutation attempted: the sentence's *conclusion* (overshoot, therefore whole-row trim) is
  correct under D26, so no wrong behaviour follows from believing it. But the reason it gives is the
  algorithm D26 deleted, in the section that defines D26, and the identical sentence in the plan was
  judged a genuine contradiction and fixed. Replace "whole 256 KiB slices" with "whole rows".

**R7 — the S4 row was added to §6.3's named tests and not to §6.1's or to task 5's summary.**

- File: [spec.md:1009](spec.md), [plan.md:595–599](plan.md), against
  [spec.md:1283–1286](spec.md), [plan.md:288](plan.md), [plan.md:576–578](plan.md),
  [plan.md:1333](plan.md), [plan.md:1358–1360](plan.md).
- Claim: the same named-test list is stated with two rows in two places and three rows in three.
- Evidence: §6.3 now reads "Named tests (task 5 forward, task 18 backward) … a **2 MiB row** … a row
  of **exactly `ROW_CAP`** … and a **9 MiB row**" ([spec.md:1283–1286](spec.md)). §6.1's parallel
  sentence — which is the *forward* reader's own section, i.e. task 5's home — still reads "Named
  tests (task 5), against the **two** rows task 1 plants in `<session-4>`" and lists only 2 MiB and
  9 MiB ([spec.md:1009](spec.md)). Task 5 states the exactly-`ROW_CAP` requirement in bullet 4
  ([plan.md:576–578](plan.md)) and then closes with "**Both fixture rows, both outcomes.** … Assert
  **both**" ([plan.md:595–599](plan.md)). The fixture builds three rows ([plan.md:288](plan.md)).
- Self-refutation attempted: bullet 4's bold "a row of EXACTLY `ROW_CAP` bytes is VALID and must
  parse (S4)" is the operative instruction and comes first, so the assertion is unlikely to be
  dropped; and "both" is plainly a leftover next to a three-row inventory. But S4 was raised
  precisely because a boundary the named tests cannot see is a boundary nothing proves, and the
  section that owns the forward reader still tells the hunter there are two cases. Two words.

### Optional

**O-a — the ladder skips rung 3 with no note, while three sites still cite "D23 rung 3".**

[spec.md:1471–1481](spec.md) and [plan.md:694–702](plan.md) number the row level 1, 2, [descend],
**4**, 5 — revision 13 added the 4 and made the gap conspicuous. Three places still refer to the
missing number: [spec.md:477](spec.md) ("after-trim pairing (D23 rung 3)"),
[spec.md:1246](spec.md) ("pairing runs HERE … (D23 rung 3, D28)") and, thirty lines above the box,
[spec.md:1440](spec.md) ("a paired `tool_result` is **rung 3**"). All three are traceable to D23
quoted intact at [spec.md:196–203](spec.md), and D28 ([spec.md:220–229](spec.md)) moved that rung to
block level deliberately — so nothing is wrong, only unfollowable. One line inside the box —
`-- rung 3 (paired tool_result -> Patch) now lives at BLOCK level, below --` — closes it.

**O-b — B14 was inserted out of numeric order in §0's glossary.**

[spec.md:26](spec.md) places B14 between B12 ([spec.md:25](spec.md)) and B13
([spec.md:27](spec.md)). The table is otherwise ascending through B12. The blind reader asked for
B14 to exist, which it now does; one row swap makes it findable.

**O-c — the design's most intricate procedure is now a core module owned by a Sonnet task.**

[spec.md:1152–1154](spec.md) and [plan.md:1329–1332](plan.md) both call `findWindow` "the most
intricate decision procedure in the design — redesigned three times (D20, D24, D26)". Task 18, which
now creates it, is `Model: **Sonnet**` ([plan.md:1271](plan.md)), and the model-allocation section
([plan.md:225–234](plan.md)) lists "Opus is warranted on exactly four" — tasks 7, 8, 19, 24 — a list
written before D31 moved this algorithm into core. Strongly self-refuting: the algorithm is now
given as line-by-line pseudocode in both documents, the four unit cases are enumerated by name, and
`brief-contracts` holds that a fully specified brief is exactly what makes a smaller model correct —
which is the condition here. Listed so the Shaman can decide rather than inherit the old list.

**O-d — task 5 creates `core/window.test.ts` and its run command does not run it.**

[plan.md:532–533](plan.md) creates `V/core/window.ts` + `V/core/window.test.ts`, step 1 specifies
`completeLines` cases, step 2 says "Implement **all three**", and step 3 runs
`bun test core/records.test.ts core/tail.test.ts` ([plan.md:611](plan.md)). Pre-dates revision 13
and is therefore not a regression; recorded only because revision 13 made task 5 the owner of the
D30 seed case and task 18 the owner of the same file's second export, so the gap is now load-bearing
in a way it was not before.

---

## 3. Checked and clean (so the next reviewer does not re-open them)

Within the revision-13 surface: the FU1–FU3 convention and its three applications
([spec.md:10–13](spec.md), [spec.md:2520](spec.md), [spec.md:2987–2988](spec.md),
[spec.md:2995](spec.md), [plan.md:2049](plan.md)) — grep finds no bare `F1`/`F2`/`F3` left meaning a
card; Kanna defined at first use ([spec.md:53–55](spec.md)) without weakening §0's oracle sentence;
the D9 ruling quoted verbatim in §1 ([spec.md:232–236](spec.md)) and matching §15's opener; the D11
reservation note ([spec.md:151–152](spec.md)); `batchFrames` given a named home in `core/sse.ts`
([spec.md:1076–1078](spec.md)); the `findWindow` signature identical in both documents
([spec.md:1146–1150](spec.md) vs [plan.md:1322–1326](plan.md)); §11.4's six rules and G4's rule-6
citation; §15's eight-site table, each `file:line` re-verified against the tree on this worktree,
including `plugins/tribe/scripts/viewer/package.json:6`; the `to` definition consistent across §3.2,
§6.1 and §6.3; the backward algorithm's `windowEnd`/`carrySeed`/`anchor` derivation, including the
no-newline-in-file degenerate case; the mixed row confirmed on disk at
`subagents/agent-a09522dcffd66dd8a.jsonl` row 33 (`type: "user"`, blocks `['tool_result','text']`).

Adjudication clauses (a)–(f) were applied: no finding above rests on the viewer reading more of
`~/.tribe`, on a Kanna behaviour absent from disk (L9), on colours or fonts (P1 = sea salt), on a
defect inherited from the viewer the plan deletes, on §10.4's deliberate stale-viewer break, or on
the DOM suites failing without Chromium.

---

## Verdict

**APPROVE-WITH-FIXES** — **R1** (D30's seed double-counts the carry: pick `offset := eof` **or**
`carry := empty`; this one needs the **Shaman**, since D30 is quoted as settled law in both
documents) and **R2** (build `<session-cut>.jsonl` in spec §16.2's tree and inventory, and change
task 1 step 3's "exactly four … No other file" to match the six session files the inventory now
requires); then **R3** (task 29's gate command, tally, rollback trigger and file list),
**R4** (D29 vs D4 and the 32 "Sol" audit lenses), **R5** (pin the mixed row's `tool_use`),
**R6** (`spec.md:1251`), **R7** (the third named row in §6.1 and task 5), and round 9's **O1**,
still open. Everything except R1 is a statement the documents already imply, written down; R1 is a
ruling that needs one clause repaired before any hunter reads it.
