# Round-11 closure check (Claude Opus 5, skinner)

Subject: `spec.md` + `plan.md` **revision 14** (`0394d51`), against round 10
(`claude-audit-round10.md`), the three Sonnet blind-reader BLOCKs of round 10, the rulings D1–D31/P1 in
`~/.tribe/-Users-hip-repo-tribe/viewer-consolidation/STATE.md` (with **D30 corrected 09:20**), the
idea card, and `pure-core` / `fail-closed-edges` / `fixtures-mirror-reality` / `brief-contracts`.

Method, per the brief: (1) each round-10 item and each Sonnet BLOCK closed or not, reading only what
revision 14 touched, driven off `git diff 51efd36 HEAD` — spec §0, §1 (roles + the whole rulings
block), §4's `ToolResult` comment, §6.1's seed, §6.2's diagram, §6.3's `carrySeed`/trim/cap prose,
§7.1's ladder, §16.2's tree and inventory; plan Global Constraints, "Model per hunter", tasks 1, 5,
8, 18, 19, 29, and all 33 audit-lens headers. (2) Regressions **inside those same places only**.
D30's seed was re-derived arithmetically against §6.1's invariant and its transition, not read.
Task 29's gate was **executed** against this worktree. Every remnant below was grepped across
**both** files and cites every surviving location; a phrase inside a quoted ruling was not reported.
Read-only: this file is the only write.

---

## 1. Round-10 closure table

| Item | Status | Evidence |
| --- | --- | --- |
| **R1** — D30's seed double-counts the carry (Blocker) | **CLOSED — verified by arithmetic, not by reading** | The Shaman's corrected D30 is now quoted at [spec.md:281–285](spec.md) and [plan.md:134–138](plan.md); the seed block at [spec.md:960–966](spec.md) reads `ackOffset := to`, `carry := [to, eof)`, `offset := eof`; a new paragraph at [spec.md:968–973](spec.md) states *why* (`offset := eof`, not `to`); the §6.2 diagram at [spec.md:1163](spec.md) now says "ackOffset at to and offset at eof"; §6.3's pseudocode comment at [spec.md:1235](spec.md) and its prose at [spec.md:1282–1284](spec.md) agree; task 5 case 0 at [plan.md:570–584](plan.md) and task 19 at [plan.md:1461–1464](plan.md) agree. **Check:** invariant `offset == ackOffset + carry.length` → `eof == to + (eof − to)` ✔. Transition tick 1 ([spec.md:993–1000](spec.md)): `read := [offset, …) = [eof, …)` — no byte re-read; `combined := carry ++ read = <partial> ++ <new>` ✔; `offset' = eof + read.length` ✔; `ack' = offset' − carry'.length` ✔. Degenerate cases hold too: file ends in `\n` → `to = eof`, carry empty, `eof == eof + 0` ✔; file with **no** newline → `to = 0`, carry = whole file, `eof == 0 + eof` ✔. The post-`reset` re-snapshot ([spec.md:1015–1024](spec.md)) re-enters §6.3 and therefore inherits the corrected seed ✔. Grep: `offset := to` survives in exactly three places, all of which are the correction *stating the old value is wrong* ([spec.md:968](spec.md), [spec.md:971](spec.md), [plan.md:577](plan.md)). Named tests: `core/tail.test.ts` case 0 — and the round-10 blind spot is closed explicitly, [plan.md:582–584](plan.md): "**Derive the next read from `offset`; do not hand it to the test.** … a test that supplies the range itself proves nothing." |
| **R2** — `<session-cut>.jsonl` unbuilt; task 1 "exactly four" (Blocker) | **CLOSED** | The file is now in the spec's `homeA` tree ([spec.md:2672](spec.md)), in the §16.2 inventory with its build recipe ([spec.md:2696](spec.md)), in task 1's inventory ([plan.md:304](plan.md)), and task 1 step 3 now reads "**exactly six** `<project>/<session>.jsonl` files — `<session-1>`, `<session-live>`, `<session-cut>`, `<session-4>`, `<session-2>`, `<session-3>` — and no other", with the `<session-4>.rotated` carve-out spelled out ([plan.md:374–381](plan.md)). Count against the tree: proj-A 4 + proj-B 1 + proj-C 1 = **6** ✔. The recipe is better than the round-10 ask — "a copy of `<session-2>` with the final row's trailing newline removed **and its last 40 bytes dropped**" — which is the difference between a genuine partial row and a whole row missing its terminator, i.e. the shape D30 is actually about (`fixtures-mirror-reality` §1). One *adjacent* count did not follow (**F1, Should-fix**). |
| **R3** — task 29's gate: command, tally, trigger, file list (Should-fix) | **CLOSED — verified by running it** | Command ([plan.md:2032–2033](plan.md)) is now `grep -rn -i 'supervisor' plugins/tribe .c3/` and `grep -rn 'status viewer' plugins/tribe .c3/` — no `--include`, matching the prose two lines below. Tally ([plan.md:2049–2054](plan.md)): "two `supervisor` and **six** `status viewer`", enumerated. Trigger ([plan.md:2056–2058](plan.md)): "**If it is not eight, STOP**". File list ([plan.md:2026–2027](plan.md)) gained `plugins/tribe/scripts/viewer/package.json`. **I ran both greps on this worktree:** 2 + 6 = **8 hits, byte-for-byte the eight the plan lists** (`plugins/tribe/README.md:249`, `runner/core/watchdog/watch-loop.ts:81`; `plugins/tribe/README.md:225`, `runner/README.md:76/129/814/860`, `scripts/viewer/package.json:6`). The old `--include='*.md' --include='*.ts' --include='*.sh'` form returns 2 — the filter that hid site 8 is gone. |
| **R4** — D29 vs D4; 32 "Sol" audit-lens headers (Should-fix) | **CLOSED** | D4 is now marked at source: "(**superseded by D29** for the two review roles; its hunter clause stands)" ([spec.md:141](spec.md)); D29 carries the reciprocal clause ([spec.md:276–280](spec.md)); §1's opener now names **roles** and puts the model in a parenthetical ([spec.md:115–126](spec.md)), and adds the honest note that D29 "made every one of those names wrong in a single ruling". Plan: [plan.md:245–249](plan.md) replaces the contradicting sentence. `grep -c 'Audit lens' plan.md` = **34**; `grep 'Audit lens (' | grep -v skinner` returns **nothing** — all 33 headers are `(skinner, contract)` and the 34th hit is the new sentence naming the convention. Surviving `Sol`/`Terra` hits are four: two inside the **verbatim D3 and D4 quotes** ([spec.md:139](spec.md), [spec.md:142–143](spec.md)) and two in the sentences that explain the supersession ([spec.md:124](spec.md), [plan.md:247](plan.md)). |
| **R5** — the mixed row's `tool_use` has no stated partner (Should-fix) | **CLOSED** | Both inventory rows now carry the clause: [spec.md:2695](spec.md) ("whose `tool_use` is **earlier in the same window** (so the `tool_result` pairs rather than orphaning, and the `text` block is what a per-row rule would drop)") and [plan.md:302](plan.md). This is exactly the remedy round 10 named, and it lands in the table that *is* the test contract — the table sits under "**Build and assert EVERY shape a later task consumes … this test is its enforcement**" ([plan.md:281–283](plan.md)). Named tests: `fixtures/build.test.ts`, `core/normalize.coverage.test.ts` (tasks 8 and 9), `e2e/dom-kinds.e2e.test.ts`. One prose echo was left behind (**F7, Optional**). |
| **R6** — "whole 256 KiB slices" in §6.3 (Should-fix) | **CLOSED** | [spec.md:1312](spec.md) now reads "The loop **yields whole rows** and overshoots". Grep for `256 KiB` over both files returns 9 hits, every one legitimate: the doubling **step**'s initial value ([spec.md:230](spec.md), [spec.md:1244](spec.md), [plan.md:110](plan.md), [plan.md:1366](plan.md)), §5.3's head+tail title read ([spec.md:815](spec.md), [spec.md:850](spec.md), [spec.md:859](spec.md)), and §14's two budget rows ([spec.md:2527](spec.md), [spec.md:2529](spec.md)) that round 9 declared need no change. No "slices of work" sense survives. |
| **R7** — the third named row missing from §6.1 and task 5 (Should-fix) | **CLOSED** | §6.1 now reads "against the **three** rows task 1 plants in `<session-4>` … a **2 MiB row** … a row of **exactly `ROW_CAP`** … and a **9 MiB row**" ([spec.md:1067–1071](spec.md)); task 5's closer is "**All THREE fixture rows, three outcomes** … Assert all three" ([plan.md:619–624](plan.md)). Three rows in the fixture ([plan.md:299–301](plan.md)), three in §6.3 ([spec.md:1343](spec.md)), three in task 18 ([plan.md:1384–1389](plan.md)). Grep: no surviving "both fixture rows" / "the two rows". Named tests: `core/tail.test.ts`, `core/window.test.ts`, `serve.reads.test.ts`. |
| **O1** — §4's D19 comment names a field that no longer exists | **OPEN** (untouched) | Revision 14 rewrote the `ToolResult` comment twelve lines below ([spec.md:706–710](spec.md)) and left the D19 comment alone: [spec.md:684–688](spec.md) still says "`result` is the `tool_result` block in its LATER row, filled by pairing, null while pending" on a member declared `resultAnchor: Anchor \| null` ([spec.md:689](spec.md)), beside a *different* field of the same node, `result: ToolResult \| null` ([spec.md:682](spec.md)). Optional, as graded in rounds 9 and 10. Now mildly worse: the two comments in the same code block name the same address two ways (**F5, Optional**). |
| **O-a** — the ladder skips rung 3 with no note | **CLOSED** | The note is in **both** boxes: "`-- (there is no row-level rung 3: pairing is a BLOCK outcome, D28) --`" ([spec.md:1536](spec.md), [plan.md:722](plan.md)) — the one line round 10 asked for. Three "D23 rung 3" citations survive ([spec.md:527](spec.md), [spec.md:1307](spec.md), [spec.md:1501](spec.md)); the first two cite D23's own numbering, which is quoted intact at [spec.md:246–252](spec.md). The third is a flat assertion (**F8, Optional**). |
| **O-b** — B14 out of numeric order | **CLOSED** | [spec.md:25–28](spec.md) now ascends B10, B12, B13, B14. |
| **O-c** — `findWindow` is a Sonnet task | **CLOSED by ruling, and the ruling is recorded** | The Shaman ruled task 18 stays Sonnet; the plan now carries the *reasoning* rather than just the model — [plan.md:231–237](plan.md): "spec §6.3 gives the algorithm as **line-by-line pseudocode**, and D31 gives it a pure signature with four named unit cases … transcription against a spelled-out contract with a mechanical oracle". That is the `brief-contracts` argument stated in the brief itself, which is the right place for it. One formatting defect buries it (**F6, Optional**). |
| **O-d** — task 5 creates `core/window.test.ts` and its run command does not run it | **OPEN** (untouched) | Task 5's `Create:` list still names `V/core/window.ts`, `V/core/window.test.ts` ([plan.md:546–547](plan.md)); step 1 still specifies four `completeLines` cases ([plan.md:560–563](plan.md)); step 3 still runs `bun test core/records.test.ts core/tail.test.ts` ([plan.md:636](plan.md)). Optional, as graded in round 10 — but the gap is now load-bearing in a second way: task 18 adds `findWindow` to the **same file**, so nothing in task 5 proves `window.ts` compiles. |

## 1b. The three Sonnet blind-reader BLOCKs

| BLOCK | Status | Evidence |
| --- | --- | --- |
| **Rulings lead-in count** ("Three further rulings" over a list of nineteen) | **CLOSED — count verified** | [spec.md:160–163](spec.md): "**Nineteen further rulings** were issued across review rounds 2–10". Counted from the six new group headings: Transport (D12, D13, D27) 3 + Containment (D14, D16, D18) 3 + Bounds (D15, D20, D21, D26) 4 + Identity (D19, D23, D28) 3 + Fixtures/proofs/process (D22, D25, D29, D30, D31) 5 + Naming (D9) 1 = **19** ✔, and every heading's parenthetical matches the bullets beneath it ([spec.md:166](spec.md), [189](spec.md), [208](spec.md), [237](spec.md), [262](spec.md), [292](spec.md)). The regrouping is a real readability gain — "a reader looking for 'how big can a row be' should not have to scan every one" is the right justification. Two costs came with it (**F2, Should-fix**; **F9, Optional**). |
| **D29 supersedes D4** | **CLOSED** | See R4 above: the supersession is stated at both ends ([spec.md:141](spec.md), [spec.md:276–280](spec.md)) and in the plan ([plan.md:245–249](plan.md)). |
| **"(S4)" review-finding ids in the spec's own argument** | **CLOSED in the spec; three survive in the plan** | A convention was added at [spec.md:41–44](spec.md): "**Review-finding ids** (`N1`, `S4`, `R3`, …) appear only in `references/claude-audit-round*.md` and in the planning report, never in this document's own argument". Both spec hits were removed ([spec.md:1252](spec.md), [spec.md:1336](spec.md) — grep for `(S1)`…`(S7)`, `(N1)`…`(N3)`, `(R1)`…`(R7)` over spec.md returns nothing outside §0's own example and §17's risk ids). Three survive in `plan.md` ([300](plan.md), [601](plan.md), [1386](plan.md)) under the undefined carve-out "the planning report" (**F4, Should-fix**), and the new rule collides with §17's namespace (**F3, Should-fix**). |

**Twelve of fifteen closed outright; two (O1, O-d) were untouched and were Optional before; the
third — R2 — closed at the fixture and left one adjacent count behind.** R1, R3 and the nineteen-count
were verified mechanically (arithmetic, an executed grep, an enumeration) rather than read.

---

## 2. Regressions revision 14 introduced

### Blocker

None. No hunter is blocked; task 1 can start on this revision.

### Should-fix

**F1 — the fixture grew a fourth proj-A session and G1 layer 3's expected set still says two.**

- File: [spec.md:2781](spec.md) and [plan.md:2147–2148](plan.md), against the tree at
  [spec.md:2665–2676](spec.md) and task 1 step 3 at [plan.md:374–381](plan.md).
- Claim: revision 14 fixed the count in task 1 and left the same count wrong one section later, in
  the assertion that *consumes* the fixture. This is R2's shape, moved up a layer.
- Evidence: §16.2's `homeA` tree now holds **four** proj-A sessions — `<session-1>`
  ([spec.md:2665](spec.md)), `<session-live>` ([spec.md:2671](spec.md)), `<session-cut>`
  ([spec.md:2672](spec.md), added by this revision), `<session-4>` ([spec.md:2673](spec.md)) — plus
  `<session-4>.rotated`, which is not a `.jsonl` and is correctly excluded by task 1 step 3's own
  carve-out. G1 layer 3's pass 1 still reads "the set equals every session in the projects inside
  D10's 30-day window (**`<proj-A>`'s two sessions** and `<proj-B>`'s one)"
  ([spec.md:2780–2781](spec.md)), and the plan repeats it verbatim ("`<proj-A>`'s **two** and
  `<proj-B>`'s one", [plan.md:2147–2148](plan.md)). The correct gloss is four and one, five rows.
  Grepped: these are the only two surviving statements of the count; task 1's own count
  ([plan.md:374](plan.md)) is right, and §16.2's inventory rows are right.
- Self-refutation attempted, and it lands harder than for R2: the assertion as written is **set
  equality against "the set of session ids `fixtures/build.ts` wrote"**
  ([spec.md:2777–2778](spec.md)) — the builder is the oracle, the parenthetical is a gloss, and the
  test therefore *cannot* go red because of it. That is why this is Should-fix and not a Blocker.
  But the gloss is also the only place the document says **which** sessions the default view should
  contain, and a hunter who reads "two" and counts three extra rows has two readings available: fix
  the gloss, or conclude the list page must filter `<session-live>` and `<session-cut>` out. The
  second reading is a product decision made by accident, and §16.2's own standard —
  "A shape a later task needs but the fixture's test does not pin is a shape that can silently
  disappear" ([spec.md:2686](spec.md)) — is about exactly this. Two words in two files.

**F2 — the D11 reservation note was deleted, and D11 now appears nowhere in either document.**

- File: deleted from `spec.md` between [spec.md:159](spec.md) and [spec.md:160](spec.md) (it was
  `spec.md:151–152` in revision 13, inside the hunk this revision rewrote).
- Claim: the rulings block now runs D10 → D12 with no explanation, in a document whose blind reader
  has already BLOCKed twice on exactly this class ("D9 not quoted", "B14 missing").
- Evidence: `grep -n 'D11' spec.md plan.md` returns **nothing**. The deleted text read
  "(**D11 is reserved for the owner's approval of this spec** and is therefore absent from this list
  — the numbering skips it deliberately rather than by oversight.)" Round 10 listed it under
  "checked and clean", i.e. it was doing work. STATE.md has no `D11` row either, so the gap is now
  unexplained in the two documents *and* in the ledger a reader would check next; STATE's own log
  line ("if clean → present spec.html to the owner for approval (D11)") is the only surviving trace.
  The regrouping that replaced it was otherwise pure gain, which is what makes this easy to lose:
  the note sat between the old lead-in and the old first bullet, and the rewrite took both.
- Self-refutation attempted: nothing in the build depends on D11, the gap is cosmetic, and a reader
  who does not count the rulings will never notice. But the whole reason the note existed is that a
  blind reader *does* count, and the next blind read is the last gate before the owner sees this
  page. One sentence, restored where the new lead-in ends.

**F3 — §0's new "review-finding ids" rule collides with §17's risk ids, and the spec cites one in
its own argument.**

- File: [spec.md:41–44](spec.md) (the new convention) vs [spec.md:3032–3044](spec.md) (§17's
  `R1`–`R7` risk table) and [spec.md:1880](spec.md).
- Claim: the paragraph added to close the "(S4)" BLOCK reserves a prefix the document already uses
  for something else — the same defect that produced the round-9 `F`-prefix BLOCK and its
  `FU1`–`FU3` fix.
- Evidence: the new rule names `R3` as an example of a banned id ([spec.md:41](spec.md)); §17
  "Risks, assumptions, and what is deliberately left out" ([spec.md:3028](spec.md)) has a risk
  **R3** ([spec.md:3036](spec.md)) and six siblings R1, R2, R4–R7
  ([spec.md:3034–3044](spec.md)); and §8.2 cites one in prose — "see **§17 R1** and plan.md's Global
  Constraints" ([spec.md:1880](spec.md)) — which the new rule, read literally, forbids. Grepped:
  §17's table and that one cross-reference are the only `R<n>` uses in either document.
- Self-refutation attempted: §17's table is headed `# | Risk | Mitigation`, and [spec.md:1880](spec.md)
  says "§17 R1", so a careful reader disambiguates from context and no build fact turns on it. But
  the round-9 blind reader BLOCKed on a prefix collision that was equally resolvable from context,
  and this one is *self-inflicted by the sentence written to prevent collisions*. Cheapest fix: drop
  `R3` from §0's example list (`N1`, `S4`, …) and say "audit-finding ids", leaving §17's risk ids
  alone.

**F4 — three `(S4)` ids survive in `plan.md` under a carve-out the spec never defines.**

- File: [plan.md:300](plan.md), [plan.md:601](plan.md), [plan.md:1386](plan.md), against
  [spec.md:41–44](spec.md).
- Claim: the new rule exempts "the planning report", and nothing says whether `plan.md` is that
  document.
- Evidence: the surviving hits are the fixture inventory row ("tasks 5, 18 **(S4)**"), task 5
  bullet 4 ("a row of EXACTLY `ROW_CAP` bytes is VALID and must parse **(S4)**") and task 18's named
  tests ("is still valid and parses **(S4)** — the backward search grows one byte *past* the cap").
  `plan.md` is the implementation plan; "the planning report" more naturally names the warchief's
  report to the Shaman. If `plan.md` is exempt, say so in the same sentence; if not, three ids
  should read "a row of exactly `ROW_CAP` is valid" with no ticket, which costs nothing since each
  already states its own rule inline.
- Self-refutation attempted: a hunter reading "(S4)" loses nothing — the adjacent clause always
  states the rule, which is precisely what the spec's own convention paragraph demands ("a rule that
  needs a review ticket to justify it is a rule this page has failed to state"). So no reader is
  misled. But the rule was added *this revision* and is ambiguous about its own scope at the moment
  of writing, which is `brief-contracts` "fence by intent, never by form" applied to a convention.

### Optional

**F5 — the D19 comment and the `ToolResult` comment now name the same address two ways.**
[spec.md:684–688](spec.md) calls the result's address `result`; [spec.md:706–710](spec.md), rewritten
this revision, calls it "**`resultAnchor`** — never its `call`, and never the node's own `at`+`i`".
Both are in the same fenced block, twenty lines apart. This is round 9's O1, unfixed, with a new
neighbour that contradicts it. The rest of the document uses `resultAnchor` correctly
([spec.md:689](spec.md), [spec.md:691](spec.md), [plan.md:822–827](plan.md)). Two words in the D19
comment.

**F6 — the "task 18 stays Sonnet" paragraph is a lazy continuation inside the Opus bullet.**
[plan.md:231](plan.md) follows [plan.md:230](plan.md) with **no blank line**, so in Markdown the
whole Task-18 paragraph renders *inside* the "Task 7 and Task 8" list item — under the heading
"Opus is warranted on exactly four" ([plan.md:226](plan.md)). Its own sentence "The tasks below are
on Opus" ([plan.md:235](plan.md)) then points forward past tasks 7 and 8, which are above it. The
O-c ruling's value is that it is *visible*; this hides it in the list it contradicts. One blank line
at [plan.md:231](plan.md).

**F7 — task 1's mixed-row assert paragraph did not get R5's clause the inventory row got.**
[plan.md:343–347](plan.md) still reads "Assert the **mixed row** specifically: one `user` row in
`<session-1>` whose `message.content` array contains **both** a `tool_result` and a `text` block",
with no mention of the `tool_use`. The table twelve lines above ([plan.md:302](plan.md)) now carries
it, and the table is the enforcing contract ([plan.md:281–283](plan.md)), so R5 is closed; this is
the redundant prose restatement, now the less complete of the two. Delete it or append the clause.

**F8 — "a paired `tool_result` is rung 3" now sits 35 lines above "there is no row-level rung 3".**
[spec.md:1501](spec.md) states it flatly; [spec.md:1536](spec.md), added this revision, says the
row-level ladder has no rung 3 because pairing is a block outcome. Both are true under D28 at
different levels, and D23 is quoted intact at [spec.md:246–252](spec.md) with its original
numbering, so nothing is *wrong*. Adding "at **block** level" to [spec.md:1501](spec.md) makes the
pair readable in one pass. ([spec.md:527](spec.md) and [spec.md:1307](spec.md) cite "D23 rung 3",
which is the ruling's own numbering and is not reported.)

**F9 — "issued across review rounds 2–10" is false for one of the nineteen.**
[spec.md:160](spec.md). D9 is an **owner** ruling of 2026-09-11 ("lets use the term watchdog from
now on"), STATE.md line 55 — not a review-round ruling, which is why it needed its own group. The
count of nineteen is right; the provenance clause is off by one. "Issued after the original design,
across the owner's later rulings and review rounds 2–10" is accurate.

**F10 — D30 is presented as a verbatim quote in both documents and is verbatim in neither.**
[spec.md:281–285](spec.md) and [plan.md:134–138](plan.md) differ from STATE.md's corrected D30
(line 75) and, slightly, from each other — the plan folds "A file whose last byte is not `\n`:" into
the quotation and the spec keeps it as a bold lead-in outside it; both drop STATE's closing sentence
("The earlier `offset := to` double-counted the carry"), which both then state in their own prose.
§1 claims "the rulings are quoted, never paraphrased" ([spec.md:128](spec.md)) and `brief-contracts`
grades a paraphrased governing rule as Should-fix. Graded **Optional** here only because I checked
the arithmetic rather than the wording: the operative content — `ackOffset := to`,
`carry := [to, eof)`, `offset := eof`, invariant `offset == ackOffset + carry.length` — is
**identical** in all three, so no reader can be led to a different implementation. Paste STATE's
sentence and put the gloss outside the quotation marks.

---

## 3. Checked and clean (so the next reviewer does not re-open them)

Within the revision-14 surface: the §1 role paragraph reads correctly with the models removed and
does not weaken any role's definition ([spec.md:115–126](spec.md)); all six ruling-group headings
match their contents and no ruling was dropped in the regrouping (D12–D31 minus D17 and D24, plus
D9 — the same nineteen as revision 13, in a different order; D24's absence is explained at
[spec.md:226](spec.md) and [spec.md:311](spec.md), D17's is pre-existing and untouched); the
`ToolResult` comment's new "never the node's own `at`+`i`, which IS the call" is correct against
[spec.md:685–689](spec.md); §6.3's `carrySeed` comment, prose and §6.1's seed block agree word for
word on all three fields; the §6.2 sequence diagram still parses as valid mermaid syntax by
inspection (one changed participant line, no structural edit); task 1 step 3's `<session-4>.rotated`
carve-out is true against the tree; task 29's eight sites each re-verified as real `file:line` pairs
on this worktree; the eight-vs-seven contradiction round 10 found is gone in every one of its four
forms; every `Audit lens` header is role-named; B10/B12/B13/B14 ascend.

Adjudication clauses (a)–(f) were applied: no finding above rests on the viewer reading more of
`~/.tribe` than `campaign-state.json` and `run.json`, on a Kanna behaviour absent from disk (L9), on
colours or fonts (P1 = sea salt), on a defect inherited from the viewer the plan deletes, on §10.4's
deliberate stale-viewer break, or on the DOM suites failing without Chromium. No phrase inside a
quoted ruling was reported as a remnant (D3's "Sol audits", D4's model names, D23's rung 3).

---

## Verdict

**APPROVE-WITH-FIXES** — **F1** (G1 layer 3's "`<proj-A>`'s two sessions" → four, in
[spec.md:2781](spec.md) and [plan.md:2147–2148](plan.md)), **F2** (restore the D11 reservation
note), **F3** (drop `R3` from §0's example list — §17 already owns `R1`–`R7`), **F4** (say whether
`plan.md` is "the planning report", or drop its three `(S4)` ids); then the Optionals F5–F10 and
round 10's still-open **O1** and **O-d**.

**Nothing blocks a hunter.** Round 10's two Blockers are both closed and both were checked
mechanically — D30's seed re-derived against §6.1's invariant and its transition (including the
empty-carry and no-newline degenerate cases), and task 29's gate executed on this worktree, returning
exactly the eight hits the plan now predicts. All four Should-fix items above are one- or two-line
edits to statements the documents already imply; none changes a design decision, and none needs the
Shaman. Task 1 can start on revision 14 as it stands.
