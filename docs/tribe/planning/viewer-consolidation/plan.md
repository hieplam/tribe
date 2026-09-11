# Viewer consolidation — build plan

Spec (the contract): `docs/tribe/planning/viewer-consolidation/spec.md`. Read it first; every task
below cites a section of it. Card: `~/.tribe/-Users-hip-repo-tribe/cards/viewer-consolidation.md`.
State: `~/.tribe/-Users-hip-repo-tribe/viewer-consolidation/STATE.md`.

Paths are relative to the repo root. The viewer package is `plugins/tribe/scripts/viewer`
(abbreviated `V` in task bodies); the runner package is `plugins/tribe/scripts/runner` (`R`).

---

## Global Constraints

- **Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.**
- **Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**
- Every commit carries the trailers `Tribe-Card: viewer-consolidation` and `Tribe-Task: N/33` in
  one final paragraph, and ticks this plan's checkboxes for that task **in the same commit** as the
  code.
- TDD is mandatory: write the failing test, run it, watch it fail for the stated reason, then the
  minimum implementation, then green, then commit. A task that reports green without a witnessed
  red is an incomplete deliverable.
- `V/core/**` never imports `node:fs`, `node:child_process`, `node:http`, or reads `process.env`.
  `V/structure.test.ts` enforces this on every `bun test`; do not weaken it.
- **PRECONDITION P1 GATES THE WHOLE BUILD — every phase, not only the client.** The card says
  *"Until P1 is delivered, the spec names tokens; the build does not start"* and STATE.md P1 says
  the Shaman *"must NOT dispatch the build until the owner confirms the design system is done and
  names where it lives"*. Read at its word: **task 1 is not dispatched until the owner has named
  the theme.** Do not reinterpret "the build" as "the Vite build" or "the client phase" — an
  earlier draft of this plan did exactly that and it was overruled.
- No design token, colour, font, radius, or spacing literal is invented by the implementer. The
  client reads `var(--token)` only, using the token names of spec §8.2 **verbatim** from the
  owner's `design/<theme>/tokens.css`. There is no alias layer and no invented scale.
- The viewer reads the Claude transcript only, plus exactly two files under `~/.tribe`
  (`campaign-state.json`, `run.json`). No code path may open anything under `runs/*/logs/`
  (D6).
- Zero writes anywhere outside `V/fixtures/` and `V/e2e/`.
- **C3 has no `c3` or `c3x` executable on this machine's `PATH`.** Every governance task invokes
  `bunx @c3x/cli@11.6.3 <command> </dev/null` — the pinned version, and the stdin redirect, both
  matter: without `</dev/null` the CLI can block waiting on input inside a non-interactive hunter
  session. A task that reports "`c3x` not found" has used the wrong entry point, not found a
  broken repo.
- Work happens in the worktree `~/repo/tribe-wt/viewer-consolidation` on branch
  `docs/viewer-consolidation` (or the branch the Warchief names at dispatch); one PR at the end.

### The oracle (quoted from spec §0, not paraphrased)

> **The Claude Code transcript files on this machine are the oracle.** Kanna's code is a
> reference, never the standard. **Under-rendering** (a row type or content block present on disk
> that the viewer drops silently) **is a bug. Over-rendering** (showing a raw-JSON fallback card
> for an unknown row) **is by design.** File order is the display order — never sort by timestamp.

Claude Code on this machine is 2.1.267. Counts cited in tasks come from the corpus scan recorded in
spec §0; re-measure before disputing one.

### Adjudication rule for every audit on this card (verbatim, inherited by both skinners)

REFUTED in advance: (a) any finding that the viewer should also read the runner log or `~/.tribe`
beyond campaign-state.json and run.json (D6/D8); (b) any finding that a Kanna behaviour is missing
when the transcript on disk does not carry the data (L9 stream-only events); (c) any finding that
colours or fonts are unspecified — tokens are the owner's (P1); (d) any defect inherited verbatim
from the current viewer that the plan schedules for deletion.

### Governing constraints, quoted

- STATE.md D6: "The viewer reads the Claude transcript ONLY. The runner's per-session log stays as
  a watchdog/debug artifact; the viewer never reads it."
- STATE.md D7: "No second transcript store. Every parse/render need resolves in memory from the
  transcript."
- STATE.md D1: "Stack: React + Vite client with a build step (Kanna-style)."
- STATE.md D2: "Liveness of a session = file growth only (mtime within N min or size grew)."
- Card scope fence: "No design tokens invented by the implementer: the client consumes the owner's
  design system (P1). Until P1 is delivered, the spec names tokens; the build does not start."
- `pure-core.md`: "core logic never constructs or reaches out for its dependencies; it receives
  them."
- `fail-closed-edges.md` obligation 4: "A path from outside is contained before it is used."

---

## Phases, dependencies, and concurrency

**Every row's "depends on" column starts with P1.** That is not decoration: no hunter is
dispatched for any task in any phase until the owner has named the theme.

| Phase | Tasks | Depends on | May run concurrently with |
| --- | --- | --- | --- |
| 0 — contract and fixture | 1–3 | **P1** | — |
| 1 — pure core | 4–14 | **P1**, phase 0 | phase 4's task 27 (disjoint files: `R/**`) |
| 2 — server | 15–21 | **P1**, phase 1 | — |
| 3 — client | 22–26 | **P1**, phase 2 | phase 4's task 27 |
| 4 — integration and deletion | 27–29 | task 27: **P1**, phase 0. tasks 28–29: **P1**, phases 1–3 | task 27 is independent of phases 1–3 |
| 5 — evidence | 30–33 | **P1**, phases 1–4 | — |

Concurrency is available but not required. The only genuinely independent bundle is **task 27**
(`R/**` only, touches no viewer file); everything else shares `V/core/**` or `V/client/**` and must
run one hunter at a time per worktree. If the Warchief runs task 27 in a second worktree, its
`owns_files` is exactly `plugins/tribe/scripts/runner/**`.

**The P1 gate, concretely.** Before dispatching task 1, confirm all three:

1. `docs/tribe/planning/viewer-consolidation/design/` holds the candidate themes (it does:
   `matcha/`, `coffee/`, `sea-salt/`, one shared token schema);
2. the owner has **named one** of them, recorded in STATE.md as a ruling;
3. `design/<that-theme>/tokens.css` exists and defines every token in spec §8.2's table.

If any is missing, the Warchief returns `NEEDS_DIRECTION` to the Shaman and dispatches nothing. The
cost of this stricter reading is low — the three candidates share one schema, so nothing in phases
0–2 would change if the owner picked differently — and the benefit is that the owner's handover
rule is honoured literally instead of being reinterpreted by the people it governs.

### Model per hunter

Sonnet by default — every task below states its model. Opus is warranted on exactly four:

- **Task 7 and Task 8** (the normalizer): the oracle-bearing tasks. Getting "nothing is silently
  dropped" right across 30 row types and 8 block shapes is judgment over a measured table, not
  transcription.
- **Task 19** (the SSE poller): resume-by-byte-offset, reset-on-truncate, and the tick caps
  interact; a subtle error here is invisible until a live run.
- **Task 24** (the session view): follow-the-tail, windowed back-fill and incoming frames interact
  in the scroll container; this is the one client task with real state-machine risk.

Everything else is mechanical against a precise brief and runs on Sonnet. The audits run on
GPT-5.6 Sol via Codex (D4); blind reads on GPT-5.6 Terra.

---

## Phase 0 — contract and fixture (before any implementation)

### Task 1: Fixture tree built from nothing

`fixtures-mirror-reality.md` obligation 2: *"Before writing lifecycle code, run it against an empty
fixture."* This task exists so that the discovery contract in spec §5 is verified against a tree
built from nothing **before** the server that reads it is designed into existence.

- Create: `V/fixtures/build.ts`
- Create: `V/fixtures/build.test.ts`
- Delete: `V/fixtures/session-valid.jsonl`, `V/fixtures/session-malformed.jsonl`,
  `V/fixtures/subagent-valid.jsonl`

Model: **Sonnet**. Mechanical authoring against the measured table in spec §7.

- [ ] **Step 1: Write the failing test** `V/fixtures/build.test.ts`. It calls
      `buildFixtureHome(mkdtempSync(...))` and asserts, over the returned tree: two project
      directories exist; session 1's `.jsonl` contains at least one row for **every** `type` listed
      in spec §7.1 and one block for every row of spec §7.2; a `subagents/` directory holds five
      sidecars forming the depth-2 tree, the missing-parent orphan and the self-cycle of spec
      §16.2; a `tool-results/` file exists whose name the `persisted-output` marker in session 1
      points at; and the three empty shapes (`buildEmptyProject`, `buildEmptyProjectsRoot`,
      `buildHomeWithoutClaude`) each produce exactly the directory layout they name and nothing
      else. Expected on first run: `error: Cannot find module './build.ts'`.
- [ ] **Step 2: Implement** `V/fixtures/build.ts`. Pure data plus one `mkdirSync`/`writeFileSync`
      edge; it takes the destination directory as an argument and constructs nothing it was not
      given (`pure-core.md`). Every row it writes is copied in shape from the real corpus — spec
      §7 names the fields, and `~/.claude/projects` is the oracle for any field the spec leaves
      unstated.
- [ ] **Step 3: Verify against an empty target, by hand.** Run the tree builder into a bare
      directory and walk it, proving the layout spec §5.1 expects is what actually lands:

      ```sh
      cd plugins/tribe/scripts/viewer
      rm -rf /tmp/vc-fixture && mkdir -p /tmp/vc-fixture
      bun -e 'import {buildFixtureHome} from "./fixtures/build.ts"; buildFixtureHome("/tmp/vc-fixture")'
      find /tmp/vc-fixture -type f | sort
      ```

      Expected: a listing containing exactly three `<project>/<session>.jsonl` files, five
      `<session>/subagents/agent-*.jsonl` with five matching `.meta.json`, one
      `<session>/tool-results/*.txt` and the two symlinks beside it. No other file. Paste the
      listing (with `find -type l` shown separately) into the task report.
- [ ] **Step 4: Run the suite.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test fixtures/
      ```
      Expected: all new tests pass; the three deleted `.jsonl` fixtures are referenced by nothing
      (`grep -rn 'session-valid\|subagent-valid\|session-malformed' .` returns only history).
- [ ] **Step 5: Commit**

Audit lens (Sol, contract): run the builder into a bare `mkdtemp` yourself, then diff the set of
`type` values actually present in the generated session-1 file against spec §7.1's table. A type in
the table with no row in the fixture is a Critical finding — the whole coverage proof rests on this
file.

### Task 2: Wire contract types and the route parser

- Create: `V/core/model.ts` (replacing the old status-page `core/model.ts` wholesale)
- Create: `V/core/routes.ts`
- Create: `V/core/routes.test.ts`
- Delete: `V/core/live/routes.ts`, `V/core/live/routes.test.ts`, `V/core/live/model.ts`,
  `V/core/live/model.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** `V/core/routes.test.ts`, one case per row of spec §3.2's
      route table plus the refusal matrix: a session id containing `..`, a percent-encoded slash, a
      double-encoded `..%2f`, a NUL byte, an empty id, a 500-character id, an unknown `/api` path,
      and an unknown asset name. Every refusal returns a typed route (`bad_request` with a reason,
      or `not_found`), never a throw. Include `?all=1` on `/` and `/api/projects` (D10, spec §5.6)
      and assert `/healthz` parses to the health route. Expected on first run:
      `Cannot find module './routes.ts'`.
- [ ] **Step 2: Implement** `V/core/routes.ts` and the type-only `V/core/model.ts` (spec §4,
      verbatim — the `RenderNode` union is the contract three later tasks compile against).
      Pure string math: `new URL(...)`, pattern matching, no path joins.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bunx tsc --noEmit && bun test core/routes.test.ts
      ```
      Expected: `tsc` clean, every route case passing.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the refusal matrix yourself against the parser. Verify that no
branch of `routes.ts` returns a value that a later caller could join into a path without passing
through `containedJoin` (task 4). A route that hands back an unvalidated string is a Critical
finding (this is B3's class).

### Task 3: Phase 0 governance — the ADR and the package README scaffold

`rule-change-unit-ships-with-code`: a decided ADR's change-unit patches must reach their target
facts **in the same PR** as the code. Authoring the ADR now, at the start, is what makes that
possible; the patches land in tasks 21 and 29.

- Create: `.c3/adr/adr-20260911-viewer-consolidation.md`
- Modify: `docs/superpowers/specs/2026-09-02-campaign-live-viewer-design.md` (superseded header)
- Modify: `V/README.md` (structure only: the new section headings, marked as being filled in by
  tasks 21 and 26)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing check.** There is no unit test for an ADR; the mechanical gate is
      the C3 toolchain. Run it first and record the failure:

      ```sh
      bunx @c3x/cli@11.6.3 check </dev/null
      ```

      Expected before the ADR exists: `c3x` reports no ADR covering the viewer contract change
      that tasks 21/29 will patch (or, if `c3x` is silent on that, record its actual output
      verbatim — the point is the before/after pair, not a specific message).
- [ ] **Step 2: Author the ADR** with `status: accepted`, `date: "2026-09-11"`,
      `supersedes: [adr-20260903-fix-viewer-launch-docs]`. Its Goal, Context and Decision restate
      spec §0, §3 and §11 — Context cites the measured numbers (83.6% log duplication, B1/B2/B3,
      0 unparsable rows in 126,410). Its Consequences name the two change units tasks 21 and 29
      will apply to `c3-215` rows 76 and 72.
- [ ] **Step 3: Mark the old design spec superseded** — a header note at the top of
      `2026-09-02-campaign-live-viewer-design.md` pointing at this spec and this ADR. Do not delete
      it; it is the record of what the deleted code was for.
- [ ] **Step 4: Run.**

      ```sh
      bunx @c3x/cli@11.6.3 check </dev/null
      ```

      Expected: clean, or the same output as step 1 minus the ADR gap. Record both runs in the task
      report.
- [ ] **Step 5: Commit**

Audit lens (Sol, contract): confirm the ADR's `supersedes` names a real ADR id that exists on disk,
and that the Consequences section names both change units by target (`c3-215` rows 72 and 76). An
ADR with no change units scheduled is the exact failure `rule-change-unit-ships-with-code` was
written for.

---

## Phase 1 — the pure core

### Task 4: Paths and containment

- Create: `V/core/paths.ts` (carrying `sanitizeProjectDirName` verbatim from
  `V/core/live/paths.ts`)
- Create: `V/core/paths.test.ts`
- Create: `V/core/paths.containment.test.ts` — **this exact filename**: the goal map (spec §2)
  names it as G4's proof, and a goal whose named test nobody creates has no proof at all
- Delete: `V/core/live/paths.ts`, `V/core/live/paths.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** `V/core/paths.test.ts`. Carry over every existing
      `sanitizeProjectDirName` case unchanged (the encoding is ported from Claude Code's own and
      must not drift), then add `containedJoin` cases: an empty segment, `.`, `..`, `a/b`,
      `a\\b`, a segment with a NUL byte, an absolute segment, a segment that resolves back inside
      the root after a harmless `.`, and a 300-character segment. Each returns `null` — never a
      throw, never a partial path.

      Then write `V/core/paths.containment.test.ts` for the **resolved** stage that lexical
      containment cannot cover (spec §12.2): `isContainedResolved(root, resolved)` refuses a target
      that resolves to `/etc/passwd`, refuses one resolving into a sibling session's directory,
      refuses one whose resolved path is a prefix-collision (`/root-evil` against root `/root`), and
      **accepts** a target that resolves back inside the root — a check that refuses everything
      proves nothing, so the positive case is mandatory. Expected on first run:
      `Cannot find module './paths.ts'`.
- [ ] **Step 2: Implement** `V/core/paths.ts`: `containedJoin(root, ...segments)` and
      `isContainedResolved(root, resolvedTarget)` per spec §12.2, plus the fixed-layout helpers
      (`transcriptPathOf`, `subagentsDirOf`, `toolResultsDirOf`). Pure string math; `node:path`'s
      `join`/`resolve`/`sep` are pure and permitted, the filesystem is not — `realpath` is the
      adapter's act (task 15), and this module only judges the string it returns.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/paths.test.ts core/paths.containment.test.ts structure.test.ts
      ```

      Expected: all pass, including the positive containment case; the structure wall still reports
      zero world-touching imports under `core/`.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): this is `fail-closed-edges` obligation 4's implementation. Run the
refusal matrix yourself and additionally try three inputs the test does not list, of your own
choosing, that a real attacker would try. Any input that produces a path outside `root` is a
Critical finding.

### Task 5: Records and tail

- Create: `V/core/records.ts`, `V/core/records.test.ts`, `V/core/tail.ts`, `V/core/tail.test.ts`,
  `V/core/window.ts`, `V/core/window.test.ts`
- Delete: `V/core/live/records.ts`, `V/core/live/records.test.ts`, `V/core/live/tail.ts`,
  `V/core/live/tail.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing tests.** For `records.ts`: carry over the existing cases, then
      add one per new field the widened reader must keep (`subtype`, `content`, `attachment`,
      `isMeta`, `isCompactSummary`, `apiErrorStatus`, `isApiErrorMessage`, `agentId`, `parentUuid`)
      plus `raw`, the verbatim line, which the `raw` card needs. Add: a line that is a JSON array,
      a bare scalar, and invalid UTF-8 — each counted in `skipped`, never thrown.

      For `window.ts` (new, and the reason the adapter decides nothing — spec §5.3):
      `completeLines(buffer, dropLeadingPartial)` returns only whole lines; with
      `dropLeadingPartial` it discards bytes before the first newline; a buffer whose boundary lands
      **exactly on** a newline drops nothing; a buffer with no newline at all returns no lines.

      For `tail.ts`, carry over every existing case, then add the four this plan fixes:
      1. `ackOffset` is returned alongside `offset` and equals `offset - byteLengthOf(carry)`; after
         a chunk ending mid-row, `offset` advances past the partial bytes but **`ackOffset` does
         not** (spec §6.1 — this is blocker 4's fix and the single most important assertion here);
      2. `reset` fires on `obs.sizeBytes < state.offset` (truncation);
      3. `reset` fires on `obs.inode !== state.inode` **even when the new file is the same size or
         larger** (rotation), and does **not** fire when `state.inode` is 0 (platform without an
         inode — degrade to trigger 2 alone, never a false reset);
      4. a carry crossing **1 MiB — the single cap, there is no second one** — emits one
         `unreadable` node, drops the carry, and resynchronises at the next newline.

      Expected on first run: all three modules missing.
- [ ] **Step 2: Implement** all three. `tail.ts` keeps its current arithmetic exactly —
      `offset = base.offset + consumedBytes`, never `fileSize`, never `chunk.length` — and gains
      `ackOffset`, the inode trigger and the one carry cap. It takes a `FileObservation` (spec §4),
      not a bare size. Keep the existing doc comments; they encode why (F56).
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/records.test.ts core/tail.test.ts
      ```
      Expected: all pass, including the three new tail cases.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the tail state machine over a real 13 MB transcript in byte-ranged
chunks of varying sizes (including a chunk boundary that splits a multi-byte character and one that
splits a line) and prove the reassembled line set is identical to `readFileSync(...).split('\n')`.
That is the only honest test of this module. Then check the invariant that matters most: **for every
intermediate state, `ackOffset` is a byte index at which the file has a newline.** A single state
where it is not re-opens blocker 4 and is a Critical finding.

### Task 6: Markdown token emitter

- Create: `V/core/markdown.ts`, `V/core/markdown.test.ts`
- Delete: `V/core/live/markdown.ts`, `V/core/live/markdown.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Carry over the **entire** existing `markdown.test.ts`
      corpus, rewriting each assertion from an HTML string to the `MdToken[]` tree of spec §4. Add
      one case per injection shape the old tests covered (script tags, `javascript:` hrefs, unclosed
      fences, angle brackets in code) and assert the token tree contains the raw text as `text`/
      `code` token values with no markup. Expected on first run: `Cannot find module './markdown.ts'`.
- [ ] **Step 2: Implement** the tokenizer. Same segmentation the current file uses (fences first,
      then inline), emitting tokens instead of strings. Keep the href gate (`http:`, `https:`,
      `mailto:` only). No HTML string is produced anywhere in this module.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/markdown.test.ts
      ```
      Expected: every carried-over case passes with token assertions.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): grep the new module for any string containing `<` followed by a letter.
The escape-then-markup property is replaced by a structural one — this module must be incapable of
emitting markup. A single HTML-producing branch is a Critical finding.

### Task 7: Normalizer, part 1 — message rows and content blocks

- Create: `V/core/normalize.ts`, `V/core/normalize.test.ts`

Model: **Opus.** The oracle-bearing task: "nothing on disk is silently dropped" is a judgment over
a measured table, and the failure mode is invisible (a green suite over a lossy normalizer is
exactly today's bug, B1/B2).

- [ ] **Step 1: Write the failing test** `V/core/normalize.test.ts`, one case per row of spec §7.2:
      `message.content` as a bare string (user and assistant); array `text` blocks on a user row
      (B2 — every runner prompt); assistant `text`; `thinking` non-empty; `thinking` empty (asserts
      **no node**, with the measured 8,411-of-17,802 rationale in a comment); `tool_use`;
      `tool_result` in each of its four measured content shapes plus `is_error`; a base64 `image`
      block on a user row. Assert `RowAnchor` is populated (`uuid`, `i`, `at`, `ts`) on every node
      and that node order equals input order. Expected on first run: module missing.
- [ ] **Step 2: Implement** the message-row half of `V/core/normalize.ts`. Signature takes already
      parsed rows plus their byte offsets and returns `RenderNode[]` — no I/O, no clock.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/normalize.test.ts
      ```
      Expected: every §7.2 case passes; the empty-thinking case asserts an empty node list.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): take 1,000 consecutive rows from a real subagent transcript, run them
through the normalizer, and account for every input row in the output. Under-rendering is a bug per
the oracle — a row class present in your sample and absent from the output, other than empty
`thinking`, is a Critical finding.

### Task 8: Normalizer, part 2 — metadata rows, system subtypes, attachments, raw cards

- Modify: `V/core/normalize.ts`, `V/core/normalize.test.ts`
- Create: `V/core/normalize.coverage.test.ts`

Model: **Opus.** Same reason as task 7; this half is where the open-world rule lives.

- [ ] **Step 1: Write the failing tests.** `normalize.coverage.test.ts` is the mechanical proof of
      spec §7.1: it loads the fixture from task 1, normalizes it, and asserts that the set of
      `rowType` values consumed equals the set present in the fixture, with **zero** rows
      unaccounted for. `normalize.test.ts` gains one case per `system` subtype (spec §7.4), the
      `attachment` node with its `attachment.type` label and `rendered` detail, each named
      metadata row type from §7.1, the XML chip extraction of §7.6, the `persisted-output` marker
      (asserting the node keeps only a `basename`, never the absolute path), `apiErrorStatus` rows,
      and an invented row type rendering as `raw`. Expected on first run: unaccounted rows reported
      by the coverage test.
- [ ] **Step 2: Implement** the metadata half. The default branch of the row dispatch is a `raw`
      node — `continue` appears nowhere in this module except for the declared empty-`thinking`
      exception, which carries the spec §7.2 citation in a comment.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/normalize
      ```
      Expected: the coverage test reports 0 unaccounted rows over the fixture; every subtype case
      passes.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the coverage test against a **real** transcript of your choosing
from `~/.claude/projects` (not the fixture) and report the unaccounted-row count. Also verify the
`persisted-output` node carries no absolute path — leaking one is both an information leak and the
seed of a traversal (B3's class).

### Task 9: Tool pairing, orphans, and elision

- Create: `V/core/pair.ts`, `V/core/pair.test.ts`
- Modify: `V/core/normalize.ts` (call into `pair.ts`)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Cases: a call and result in order; a result whose call is
      outside the window (asserts an `orphan_result` node **at the result's file position**, never
      a drop — this is B1's other half); a call with no result (stays `pending`); two calls with the
      same id; a result with `is_error`; a `Task` call whose id matches a sidecar `toolUseId`
      (asserts `agentId` is set); a tool input over 64 KiB (asserts `inputElided: true` and no
      payload in the node); a result over 64 KiB (same).

      Then the **cross-tick** cases, which are the live half of B1 (spec §6.4) and the reason this
      module carries state:
      - a `tool_use` normalized on tick 1 and its `tool_result` on tick 2 produces **no new node**
        on tick 2 and exactly one `Patch` whose `id` is the tick-1 node's `RowAnchor.id`;
      - the replacement node in that patch is complete (`state`, `result`), not a delta;
      - `RowAnchor.id` for a given row is **identical** whether the row is reached by streaming, by
        `/api/rows` back-fill, or by a re-read after reset — it is derived from byte offset and
        block index, never from a counter;
      - the pending map evicts at **512 entries** (spec §6.5), oldest first, and a result whose
        entry was evicted renders as an `orphan_result` rather than growing the map.

      Expected on first run: module missing.
- [ ] **Step 2: Implement** a single forward pass with a bounded `Map<tool_use_id, RowAnchor.id>`
      carried in the normalize state, per spec §7.5 and §6.4. No backward scan, no second pass, and
      no unbounded map.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/pair.test.ts core/normalize
      ```
      Expected: all pass, including the orphan case.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): measure the elision threshold's effect on a real transcript — count how
many nodes carry `inputElided` or an elided result, and confirm no node's serialized size exceeds
the 1 MiB frame budget of spec §14. Then feed the same transcript through the normalizer twice, once
as one batch and once split into 50 arbitrary tick boundaries, and assert the resulting
(nodes + patches) collapse to an identical final state. A `RowAnchor.id` that depends on how the
bytes were chunked is a Critical finding: it silently breaks patching and dedupe.

### Task 10: Title, liveness, and the bounded read window

- Create: `V/core/title.ts`, `V/core/title.test.ts`, `V/core/liveness.ts`, `V/core/liveness.test.ts`
- Create: `V/core/title.measure.ts` (a read-only measurement script, not a test)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** `title.test.ts`: the five-step fallback of spec §5.3 in
      order, each step tested in isolation and in combination; a file with several `ai-title` rows
      (last wins); a file with none of them (falls through to the session id); a tail window whose
      first line is partial (asserts the partial line is dropped, not parsed). `liveness.test.ts`:
      grew-but-old-mtime is live; not-grown-and-mtime-within-10-min is live; neither is not live;
      the first-scan case where no previous size is known. Expected: modules missing.
- [ ] **Step 2: Implement** both. Both are pure: they take already-read head and tail line arrays,
      a size, an mtime and a `nowIso`; they never stat anything.
- [ ] **Step 3: Measure the window over the whole real corpus** — this is the acceptance gate for
      spec §5.3's assumption, and it is a measurement, not a test:

      ```sh
      cd plugins/tribe/scripts/viewer
      bun core/title.measure.ts --head 65536 --tail 262144
      ```

      It reads every file under `~/.claude/projects`, resolves the title twice (windowed vs whole
      file) and prints `matched/total`. Expected: **at least 180 of 181** files agree. If fewer,
      raise the tail window and re-run until the threshold is met, then record the final constant
      in the task report and in spec §5.3.
- [ ] **Step 4: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/title.test.ts core/liveness.test.ts
      ```
      Expected: all pass.
- [ ] **Step 5: Commit**

Audit lens (Sol, contract): re-run the measurement yourself and report the number. A title rule
that is right 90% of the time is a user-visible defect on a list page, and the only way to know is
to run it against all 181 files.

### Task 11: The subagent tree

- Create: `V/core/subagents.ts`, `V/core/subagents.test.ts`
- Delete: `V/core/live/processes.ts`, `V/core/live/processes.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Carry over every existing `processes.test.ts` case that
      concerns tree shape (including the F34 missing-parent and F36 any-length-cycle cases), drop
      the ones about `ProcessNode.status` (that concept is gone), and add: a sidecar with no
      `parentAgentId` (measured: 453 of 813 — the common case, hangs off the session); a sidecar
      whose `.meta.json` is missing entirely; ordering by `birthtimeIso` then `agentId`; a
      `toolUseId` present on 811 of 813 sidecars and absent on the rest. Expected: module missing.
- [ ] **Step 2: Implement** `V/core/subagents.ts` returning `Agent[]` per spec §4. Pure: it takes
      already-read sidecar entries and stats.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/subagents.test.ts
      ```
      Expected: all pass, including both malformed-tree cases.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run this against a real session directory with subagents (116 exist on
this machine) and compare the tree to the `.meta.json` files by hand. Verify no field read from a
`.meta.json` is used to form a path.

### Task 12: The campaign badge (pure half)

- Create: `V/core/badge.ts`, `V/core/badge.test.ts`
- Delete: `V/core/live/campaign.ts`, `V/core/live/campaign.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Build the index from already-read JSON per spec §9:
      a well-formed state file indexes every card with a session id; a card with a null session id
      is skipped; a session id failing the id charset is dropped and counted; a malformed state
      file contributes nothing and does not throw; `runnerAlive` is true only when `endedAt` is
      null **and** the pid probe says alive; the latest run is chosen by `startedAt`. Add the
      security case explicitly: a state file whose `sessionId` is `../../../etc/passwd` produces an
      index entry for nothing and is counted in `skipped`. Expected: module missing.
- [ ] **Step 2: Implement.** The module takes already-read JSON values and a
      `processAlive: (pid: number) => boolean` function — injected, never constructed
      (`pure-core.md`). `statePath` from `run.json` is never read; there is no code path that could.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/badge.test.ts
      ```
      Expected: all pass, including the traversal case.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): this module closes B3. Verify by reading it that no value originating in
a JSON file is ever concatenated into a path, and run the traversal case yourself. Also confirm the
module names neither `logsDir` nor `statePath` anywhere (D6).

### Task 13: SSE frames and `Last-Event-ID`

- Create: `V/core/sse.ts`, `V/core/sse.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Encoding: every frame type of spec §6.2 round-trips,
      **including `patch`**; `id:` is present on every frame and its value is the supplied
      `ackOffset`, never a raw offset (assert by encoding a frame whose state has a non-empty carry
      and checking the id is the smaller number); `retry:` appears exactly once, in the first frame;
      a payload containing a newline, `U+2028`, `U+2029`, a BigInt, a cyclic object and `undefined`
      each produce a well-formed frame (carry over the existing `serializeFrameData` cases and add
      the two Unicode line separators, which the current code leaves unhandled, B24). Parsing:
      `parseLastEventId` accepts a non-negative integer and rejects a float, a negative, a
      non-numeric string, an empty string and a value exceeding a supplied file size. Expected:
      module missing.
- [ ] **Step 2: Implement** `V/core/sse.ts`. Pure.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/sse.test.ts
      ```
      Expected: all pass, including the `U+2028`/`U+2029` cases.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): feed the encoder a frame whose payload contains a literal
`\ndata: injected` sequence and confirm the receiving side sees one frame, not two. Frame-splitting
through a payload is a Critical finding.

### Task 14: Phase 1 governance — the structural wall and the core README section

- Modify: `V/structure.test.ts`
- Modify: `V/README.md`
- Delete: the now-empty `V/core/live/` directory

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Extend `V/structure.test.ts` with the five new rules of
      spec §12.6 that are checkable today (the client rules land in task 22): `process.argv`
      appears only in `serve.ts`; `.tribe` appears only in `adapters/campaign.adapter.ts` (assert
      the rule now, with the adapter not yet existing, so it fails loudly until task 16); the
      package contains no write-family filesystem call outside `fixtures/` and `e2e/`; `core/**`
      value-imports no `.adapter` module; the raw-source `process.env` ban now also covers
      `client/`. Expected: the `.tribe` rule and the write-family rule both fail against the
      current tree (the old `scan.adapter.ts` is still present).
- [ ] **Step 2: Make them pass** by removing what phase 1 has superseded: delete the empty
      `V/core/live/` tree and any now-orphaned import. The `.tribe` rule stays failing only if a
      deleted file survives — if it does, delete it.
- [ ] **Step 3: Update** `V/README.md`'s "Package layout" section to the tree in spec §3.1, and its
      purity paragraph to name the new module set.
- [ ] **Step 4: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bunx tsc --noEmit && bun test
      ```
      Expected: `tsc` clean; the whole suite green; `structure.test.ts` reports every rule passing
      except any whose subject is scheduled for a later phase, and each such exception is named in
      the test's own message.
- [ ] **Step 5: Commit**

Audit lens (Sol, contract): run `bun test structure.test.ts` and read each rule's implementation.
A rule whose matcher can be satisfied by a comment, or that scans a transpiled import list when it
should scan raw source (or the reverse), is a Should-fix — the existing file's doc comments explain
which direction each rule must fail in; that reasoning is the contract.

---

## Phase 2 — the server

### Task 15: The filesystem adapter

- Create: `V/adapters/fs.adapter.ts`, `V/adapters/fs.adapter.test.ts`
- Create: `V/adapters/readonly.test.ts` — **this exact filename**: spec §2 names it as half of G4's
  proof
- Delete: `V/adapters/transcript.adapter.ts`, `V/adapters/transcript.adapter.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** In `fs.adapter.test.ts`, against the task-1 fixture:
      `statOrNull` on a missing file returns null and on a real file returns a **`FileObservation`
      including `inode`** (spec §4 — task 5's rotation trigger is dead without it);
      `listDirOrEmpty` on a missing directory returns `[]`; `readRange` returns exactly the
      requested bytes and throws on a genuine read failure (that throw is load-bearing — the poller
      turns it into a frame); `readHead`/`readTail` return raw byte ranges and **do not** decide
      line boundaries (that is `core/window.ts`, task 5); `readTextCapped` refuses past its cap;
      `realpathOrNull` resolves a symlink and returns null for a broken one.

      In `readonly.test.ts` — G4's proof, so it asserts the properties, not the implementation:
      1. the adapter module's exported surface contains **no** write-family function, and its source
         names none of `writeFile`, `appendFile`, `mkdir`, `rm`, `rename`, `unlink`, `chmod`;
      2. **narrow catches are distinguishable** (`fail-closed-edges` obligation 1): a file whose
         content is malformed JSON yields the "malformed" outcome (counted, `SyntaxError`-derived)
         while a file that cannot be read (`EACCES`, via `chmod 000` in a temp dir, and `ENOENT`)
         yields the "absent" outcome — asserted as two **different** results, because a single
         `catch {}` swallowing both makes a permissions bug look like an empty campaign forever;
      3. the **escaping symlink** in the fixture's `tool-results/` is refused once its `realpath` is
         judged by `isContainedResolved`, and the legitimate symlink beside it is served.

      Expected: both modules missing.
- [ ] **Step 2: Implement.** Carry over the existing adapter's primitives verbatim where they
      apply (`readRange` returning raw `Uint8Array` so a multi-byte character split across ticks is
      the caller's problem to solve with a streaming decoder — keep that doc comment, it is F44),
      and add `readHead`, `readTail`, `readTextCapped`.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test adapters/fs.adapter.test.ts
      ```
      Expected: all pass.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): confirm by reading that every function is read-only, and that the
adapter makes no line-boundary, cache or reset decision — those belong to `core/window.ts`,
`core/cache.ts` and `core/tail.ts` (`pure-core.md`: an adapter that accumulates decisions is a
Should-fix). Run it against the real 13 MB file at several window sizes, including a boundary landing
exactly on a newline. Then verify the inode is genuinely `st.ino` and not a fabricated stand-in —
task 19's rotation test is worthless if it is.

### Task 16: The campaign adapter — the only two `~/.tribe` reads

- Create: `V/adapters/campaign.adapter.ts`, `V/adapters/campaign.adapter.test.ts`
- Create: `V/core/cache.ts`, `V/core/cache.test.ts`
- Delete: `V/adapters/scan.adapter.ts`, `V/adapters/scan.adapter.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Against a fixture `~/.tribe` built in a `mkdtemp`: the
      fixed-depth walk finds campaigns; a campaign with no `runs/` directory yields
      `runnerAlive: false`; a malformed `campaign-state.json` is isolated to its own campaign and is
      reported as **malformed**, while an unreadable one is reported as **absent** (the two-outcome
      rule of task 15); the 200-campaign cap holds; `processAlive` is injected, not called directly.

      Cache policy is **not** the adapter's decision (`pure-core.md`, spec §5.3): write
      `V/core/cache.test.ts` for the pure `decideCache(key, existing, nowMs)` — a hit inside the
      window, a `stale` after the 5 s expiry, a `miss` on an unseen key, and the eviction victim at
      the 500-entry bound — and have the adapter hold the `Map` and obey it. Assert the module's source
      contains neither `logsDir` nor `statePath` (a source-level assertion, deliberately, because
      this is a D6 boundary and not merely behaviour). Expected: module missing.
- [ ] **Step 2: Implement** per spec §9. `process.kill(pid, 0)` lives here, wrapped so `ESRCH` is
      false and `EPERM` is true; it is exposed as the `processAlive` the pure `core/badge.ts`
      receives.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test adapters/campaign.adapter.test.ts structure.test.ts
      ```
      Expected: both pass — including the `structure.test.ts` `.tribe` rule from task 14, which now
      has exactly one file to point at.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run this adapter against the real `~/.tribe` on this machine (17
campaigns exist) and print every path it opens, by instrumenting the adapter temporarily or by
`fs_usage`-style observation. Any path outside the two file names is a Critical finding (D6).

### Task 17: The scan index and the list APIs

- Create: `V/core/scan.ts`, `V/core/scan.test.ts`
- Modify: `V/serve.ts` (routes `/api/projects`, `/api/sessions`, `/api/session/<id>`)
- Create: `V/serve.api.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** `core/scan.test.ts` (pure: takes already-read directory
      listings and stats, returns the index) covers ordering, the
      `size+mtime+inode` cache key, the duplicate-session-id-across-projects case of spec §5.2
      (`ambiguous: true`), and **`partitionProjects` (D10, spec §5.6)**: a project whose newest
      session is 29 days old is `recent`, one at 31 days is `older`, the boundary is evaluated
      against a supplied `nowMs` (never `Date.now()` inside core), and **sessions are never
      partitioned — only projects**.

      `serve.api.test.ts` starts the real server against the task-1 fixture with `HOME` pointed at
      it and asserts each response shape, plus: `/api/projects` returns 2 projects and
      `olderCount: 1`; `/api/projects?all=1` returns 3 and `olderCount: 0`; opening the 90-day-old
      project's own URL lists **all** of its sessions; an empty projects root; a missing `.claude`
      directory; and an unknown session id (404 with a one-line body). Expected: routes 404 before
      implementation.
- [ ] **Step 2: Implement.** The index lives in `core/scan.ts` (pure) and is fed by the adapters at
      the composition root.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/scan.test.ts serve.api.test.ts
      ```
      Expected: all pass; the empty and missing-root cases return an empty list with a note, not an
      error.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the real server against the real `~/.claude/projects` (181 sessions)
and time `/api/projects` cold and warm. Report both numbers against spec §14's budgets. Also confirm
the cache key includes both size and mtime — a size-only key silently serves a stale title.

### Task 18: Row back-fill, block expansion, and spill reads

- Modify: `V/serve.ts` (routes `/api/rows`, `/api/block`, `/api/spill`)
- Create: `V/serve.reads.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** `/api/rows` returns the last N rows by default and a
      window ending at a supplied byte offset when `before` is given; `more` is false at the file
      head; a `before` past EOF or negative is refused with 400. `/api/block` returns one elided
      block by uuid and index, 404s on an unknown uuid, and never returns more than the cap.
      `/api/spill` returns the fixture's spill file, refuses `../etc/passwd`, refuses a name with a
      slash, refuses a name failing the charset, and caps the read at 2 MiB. Expected: routes 404.
- [ ] **Step 2: Implement** per spec §3.2 and §7.6, routing every path through `containedJoin`.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test serve.reads.test.ts
      ```
      Expected: all pass, including all four spill refusals.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): attempt the traversal yourself, with at least these encodings: `..%2f`,
`%2e%2e/`, a NUL byte, a UTF-8 overlong `..`, and an absolute path. Any that reads a file outside
the session's own `tool-results/` directory is a Critical finding.

### Task 19: The poller and the SSE stream

- Create: `V/adapters/poller.adapter.ts` (rewritten), `V/adapters/poller.adapter.test.ts`
- Modify: `V/serve.ts` (route `/events`)
- Create: `V/serve.events.test.ts`

Model: **Opus.** Resume-by-offset, reset-on-truncate and the tick caps interact, and a subtle error
here is invisible until a live campaign — which is precisely how B4 and B12 survived 804 tests.

- [ ] **Step 1: Write the failing test.** `poller.adapter.test.ts` with an injected clock. The
      adapter **observes and emits; it decides nothing** — every branch under test is a call into
      `core/tail.ts` or `core/normalize.ts`, and the test asserts the adapter forwards what core
      returned rather than re-deriving it (`pure-core.md`).
      - a tick that finds growth emits one `rows` frame; a tick with no growth emits nothing;
      - **a `tool_use` on tick 1 and its `tool_result` on tick 3 emits a `patch` frame on tick 3 and
        no new row** (spec §6.4);
      - a truncation emits `reset{reason:"truncated"}` and re-streams from zero **exactly once**
        (B12);
      - **the file is replaced with a same-size file of different content** (the fixture's rotation
        pair from task 1) — emits `reset{reason:"rotated"}` and re-streams; the same with a
        **larger** replacement. Size alone cannot see either; the inode can;
      - **a new `agent-*.jsonl` + `.meta.json` appears while the parent stream is open** — emits a
        `meta` frame containing the new agent, with no reconnect (spec §6.2);
      - a deletion emits `gone`;
      - a delta larger than the 4 MiB tick cap is delivered across two ticks with no byte lost or
        duplicated; `ping` fires at 15 s;
      - **every frame's `id:` is the `ackOffset`**, and after a tick whose read ended mid-row the
        published id is strictly less than the bytes consumed.

      `serve.events.test.ts`: a real connection against the fixture receives `hello` then `rows`;
      **a read that ends mid-row, then a disconnect, then a reconnect with `Last-Event-ID` yields
      that row exactly once** (blocker 4's server-side form); a `Last-Event-ID` past EOF yields
      `reset` plus a windowed restart; the 9th concurrent stream gets 503; closing a connection
      releases its slot (assert by opening, closing and reopening 9 times). Expected: the poller
      module is missing and `/events` 404s.
- [ ] **Step 2: Implement** per spec §6. The clock is injected; this adapter is the package's only
      clock owner.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test adapters/poller.adapter.test.ts serve.events.test.ts
      ```
      Expected: all pass, including the stream-slot accounting.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run a real stream against a file you append to yourself, kill the
connection **mid-row** (write half a line, reconnect, then write the rest), reconnect with the last
`id:` you received, and diff the union of rows received across both connections against the file. A
duplicated, truncated or missing row is a Critical finding — this is the exact defect blocker 4
named. Then replace the file with a same-size file and confirm a `rotated` reset actually fires;
if it does not, the inode is not reaching the transition. Finally, open and abandon 20 connections
and confirm the slot counter returns to zero.

### Task 20: The composition root

- Modify: `V/serve.ts` (argument parsing, `Host` check, CSP, `dist/` allowlist, fail-closed startup)
- Create: `V/serve.security.test.ts`
- Delete: `V/idle-timeout.integration.test.ts` (folded in)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** `V/serve.security.test.ts`, one case per row of spec §13
      that the server owns: `--port abc`, `--port 0`, `--port 70000`, an unknown flag, a port
      already in use, `dist/index.html` missing — each producing one stderr line and the stated
      exit code, never a stack trace. Plus: a `Host` header of `evil.example.com` gets 403; a
      mismatched `Origin` gets 403; `127.0.0.1:PORT` and `localhost:PORT` are accepted; the CSP and
      `nosniff` headers are present on the shell; `/assets/<unknown>` is 404.

      **`/healthz` returns exactly `{"ok":true,"viewer":"tribe-viewer","v":2}`** — assert the exact
      string. This is a deliberate break from the old `{"ok":true,"viewer":"tribe-live-viewer","v":1}`
      and the whole point of spec §10.4: an already-running pre-consolidation viewer does not reload
      its route table, so it must be *unrecognisable* to the new probe rather than reusable by it.
      Assert the old body is **not** produced, so a future refactor cannot quietly restore it.

      Carry over the idle-timeout case. Expected: most cases fail; `--port abc` currently yields a
      random port and `/healthz` still returns the v1 body.
- [ ] **Step 2: Implement.** `HOME` and `process.argv` are read here and nowhere else. `dist/` is
      loaded into a `Map` at boot (spec §12.4).
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bunx tsc --noEmit && bun test
      ```
      Expected: the whole package green; `/healthz` byte-identical.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): curl the running server with a spoofed `Host`, with a path-traversing
asset name, and with 9 simultaneous streams. Then check `/healthz` against spec §10.4's table: the
body must be the v2 one, and the runner-side half (task 27) must reject the v1 body. Confirm the two
halves agree — a v2 server with a probe that still accepts v1 leaves the stale-viewer defect open,
and no viewer-only test can see it.

### Task 21: Phase 2 governance — the viewer README and the c3-215 viewer row

- Modify: `V/README.md`
- Create: `.c3/changes/adr-20260911-viewer-consolidation/01-c3-215-contract-viewer-row.patch.md`
- Modify: `.c3/c3-2-plugins/c3-215-tribe.md` (row 76, applying the change unit)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing check.** Run the C3 gate before touching anything and record its
      output:

      ```sh
      bunx @c3x/cli@11.6.3 check </dev/null
      bunx @c3x/cli@11.6.3 lookup plugins/tribe/scripts/viewer/serve.ts </dev/null
      ```

      Expected before the change: the lookup reports the c3-215 Contract row describing a
      two-surface viewer with `--tribe-root`, which is now false.
- [ ] **Step 2: Rewrite** `V/README.md` in full against spec §3.2, §5, §6, §10.3 and §13: one
      surface, the route table, the discovery algorithm, the SSE contract, the build step, the
      failure table. Delete the status-page and `/live` sections and the `--tribe-root` row.
- [ ] **Step 3: Author the change unit and apply it** to c3-215 row 76. Every literal `|` inside
      the row is escaped as `\|` (`rule-c3-table-cell-no-pipe` — three prior incidents).
- [ ] **Step 4: Run.**

      ```sh
      bunx @c3x/cli@11.6.3 check </dev/null
      ```
      Expected: clean, and `bunx @c3x/cli@11.6.3 lookup plugins/tribe/scripts/viewer/serve.ts` now returns the new
      row. Paste both.
- [ ] **Step 5: Commit**

Audit lens (Sol, contract): run `bunx @c3x/cli@11.6.3 check` yourself and read the new row against the code. A
Contract row that claims a route, a flag or a guarantee the code does not have is a Critical
finding — this row is the architecture record and it was stale before.

---

## Phase 3 — the client (blocked on precondition P1)

P1 gates **every** phase (see Global Constraints), so by the time this phase is reached the theme is
already named and `design/<chosen-theme>/tokens.css` already exists. What is specific to this phase
is the *use* of it: the token names in spec §8.2 are copied **verbatim** from that file, there is no
alias layer, and no component may introduce a name the file does not define.

### Task 22: Vite scaffold, token wiring, and the client half of the structural wall

- Create: `V/vite.config.ts`, `V/index.html`, `V/tsconfig.client.json`,
  `V/client/src/main.tsx`, `V/client/src/App.tsx`, `V/client/src/routes.ts`,
  `V/client/src/styles/app.css`
- Modify: `V/package.json` (react, react-dom, vite, the plugin, the type packages,
  **`playwright-core` pinned at 1.63.0**, the build script), `V/.gitignore` (add `dist/` and
  `client/src/styles/tokens.css`)
- Modify: `V/structure.test.ts` (the three client rules of spec §12.6)
- Delete: `V/client/app.js`, `V/client/app.css`, `V/client/app.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Extend `structure.test.ts`: no file under `client/`
      contains `dangerouslySetInnerHTML`; no file under `client/` other than
      `client/src/styles/tokens.css` contains a literal colour (`#rgb`, `#rrggbb`, `rgb(`, `rgba(`,
      `hsl(`, `oklch(`), a `font-family` value, or a bare `px` length; `client/src/**` value-imports
      nothing from `core/` or `adapters/` (type-only imports are permitted and must still pass).
      Add `V/client/src/routes.test.ts` asserting the four URL shapes of spec §3.2 parse and
      round-trip through `pushState`. Expected: the client rules fail against the old `app.css`,
      which is full of literals.
- [ ] **Step 2: Implement** the scaffold. `vite.config.ts` copies the owner's chosen theme file to
      `client/src/styles/tokens.css` as a pre-build step and sets `build.outDir` to `../dist` with
      `base: '/assets/'`. Pin react and react-dom at 19.2.x and vite at its current major; add
      `playwright-core@1.63.0` as a devDependency (spec §16.0 — **vendored in the package, never
      read from `/tmp/pwshot`**, which is scratch and is cleared); commit `bun.lock`.

      Add `V/e2e/browser.ts`: resolves a Chromium from Playwright's standard registry
      (`~/Library/Caches/ms-playwright`, overridable with `PLAYWRIGHT_BROWSERS_PATH`) and **throws
      with the one-line remedy `bunx playwright install chromium` when none resolves**. It must not
      skip: a user-visible goal that goes green because its browser was missing is exactly the
      proxy-proof failure this revision exists to remove.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer
      bun install --frozen-lockfile && bun run build && bun test structure.test.ts client/
      ```

      Expected: `dist/index.html` and `dist/assets/` exist; every structural rule passes; the old
      client files are gone.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the build from a clean `node_modules` and confirm `dist/` is
produced and git-ignored. Then grep the built bundle for any hex colour outside the token block — a
literal reaching `dist/` from a source file the wall does not cover means the wall has a hole. Then
check the token-name rule against the owner's actual file: every name the client uses must be
defined there, and the names must be the candidates' own (`--space-12`, `--radius-8`,
`--surface-raised`, `--size-14`), not an invented scale.

### Task 23: The list view

- Create: `V/client/src/api.ts`, `V/client/src/components/Sidebar.tsx`, `ProjectList.tsx`,
  `SessionList.tsx`, `SessionRow.tsx`, `CampaignBadge.tsx`, `LiveDot.tsx`, `CampaignFilter.tsx`,
  `ShowOlderProjects.tsx`
- Create: `V/client/src/components/list.test.tsx`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** using `@happy-dom/global-registrator` under `bun test`:
      a project list renders one row per project with its `cwd` label and falls back to the encoded
      directory name when `cwd` is null; a session row shows title, short id, size, relative age,
      subagent count; `LiveDot` renders only when `live`; `CampaignBadge` renders slug, card,
      status and the runner state, and clicking it sets `?campaign=<slug>`; the filter narrows the
      list and the empty result shows a message, not a blank pane.

      D10 (spec §5.6): with `olderCount: 3` the sidebar renders a `show 3 older projects` link whose
      href is `?all=1`; with `olderCount: 0` it renders nothing; and **a project's session list is
      never filtered by age** — assert an old project opened directly shows every session it has.
      Expected: components missing.
- [ ] **Step 2: Implement.** Every visual value is `var(--token)` (spec §8.1 names the token per
      component).
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test client/
      ```
      Expected: all pass; `structure.test.ts` still green (no literal slipped in).
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): render the list against the real server and count the rows against
`ls ~/.claude/projects`. A project silently missing from the list is under-rendering by the oracle's
own definition, one level up from rows.

### Task 24: The session view

- Create: `V/client/src/rowStore.ts`, `V/client/src/useEventStream.ts`,
  `V/client/src/components/SessionView.tsx`,
  `RowList.tsx`, `Markdown.tsx`, `PromptCard.tsx`, `AssistantCard.tsx`, `ThinkingCard.tsx`,
  `ToolCard.tsx`, `Divider.tsx`, `ChipRow.tsx`, `ErrorCard.tsx`, `FollowTail.tsx`,
  `LoadEarlier.tsx`
- Create: `V/client/src/components/session.test.tsx`, `V/client/src/useEventStream.test.ts`,
  `V/client/src/rowStore.test.ts`

Model: **Opus.** Follow-the-tail, windowed back-fill and incoming frames all mutate the same scroll
container; this is the one client task with real state-machine risk, and B7 is the evidence that
getting it wrong is easy and silent.

- [ ] **Step 1: Write the failing test.** `rowStore.test.ts` first, because it is the contract the
      other two rest on (spec §8.4):
      - rows are keyed by `RowAnchor.id` and held in insertion order;
      - **a `rows` node whose id is already present is ignored, not appended** — assert the row
        count is unchanged (this is what makes resume and overlapping back-fill harmless);
      - **a `patch` replaces the node with that id in place**, preserving its position, and the row
        count is unchanged;
      - a `patch` for an id that is absent (evicted, or never sent) is dropped silently, not an
        error;
      - at 2,000 nodes the head is evicted (spec §6.5) and "load earlier" re-fetches.

      `useEventStream.test.ts` against a fake `EventSource`: `hello` then `rows` populates; a second
      `rows` frame appends; a `patch` frame routes to the store's patch path; `meta` updates the
      agent tabs **without** touching rows; `reset` clears and re-populates; `gone` stops
      reconnecting; a dropped connection reconnects passing the last `id` as `Last-Event-ID`.

      `session.test.tsx`: one rendering case per `RenderNode` kind in spec §4; every rendered row
      carries `data-kind` and `data-row-id` and the list carries `data-scroll="rows"` (spec §12.6 —
      these are the addresses the DOM e2e proofs use, so they are contract, not scaffolding); a
      `tool` node renders its result attached to the call and an error result renders with the error
      token; follow-the-tail scrolls on new rows while within 32 px of the bottom, does **not**
      scroll when outside it, shows the pill, and resumes on click (spec §8.3). Expected: modules
      missing.
- [ ] **Step 2: Implement.** `Markdown.tsx` maps `MdToken[]` to elements — there is no HTML string
      anywhere in the client. `rowStore.ts` is the single owner of row identity, dedupe and
      eviction; components read from it and never keep their own copy of a row.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test client/ && bun run build
      ```
      Expected: all pass; the build succeeds.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): drive the scroll state machine yourself through the sequence bottom, new
rows, scroll up, new rows, click pill, new rows — and assert the viewport moves only in states 2
and 6. Then drive the store through the live sequence that B1's second half is about: a `rows` frame
carrying a pending `tool` node, then a `patch` for it, then a **replay of the same `rows` frame**
(what a resume produces). The correct end state is one card, with its result. Two cards, or a card
that lost its result, is a Critical finding. Also confirm `dangerouslySetInnerHTML` appears nowhere
in the built bundle.

### Task 25: Subagent tabs, expansion, attachments, and raw cards

- Create: `V/client/src/components/AgentTabs.tsx`, `OrphanResultCard.tsx`, `ImageCard.tsx`,
  `AttachmentStrip.tsx`, `RawCard.tsx`, `UnreadableNote.tsx`
- Create: `V/client/src/components/agents.test.tsx`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Tabs render from `Agent[]` in tree order with depth
      indentation; selecting a tab navigates to `/s/<id>/a/<agentId>` and opens a new stream; a
      `Task` tool card whose node carries an `agentId` links to that tab; `ImageCard` fetches
      `/api/block` only on expand; `ToolCard` with a spill result fetches `/api/spill` only on
      expand and shows the preview before that; consecutive `attachment` nodes collapse into one
      strip that expands to the individual entries; `RawCard` renders collapsed with the row type
      visible; `UnreadableNote` shows the count. Expected: components missing.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test client/
      ```
      Expected: all pass, including the two lazy-fetch assertions (nothing fetched before expand).
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): open a real session with subagents in a browser and compare the tab set
to `ls` of its `subagents/` directory. A sidecar with no tab is under-rendering.

### Task 26: Phase 3 governance — the build step, doctor, and the client README

- Modify: `plugins/tribe/install.sh` (the viewer build block of spec §10.3)
- Modify: `plugins/tribe/scripts/doctor.sh`
- Create: `plugins/tribe/scripts/tests/test-install-viewer-build.sh`
- Modify: `V/README.md` (the build section)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** `plugins/tribe/scripts/tests/test-install-viewer-build.sh`,
      in the repo's existing test-script style with `set -euo pipefail`
      (`rule-bash-strict-mode`). It runs the plugin hook against a temporary `CLAUDE_DIR`, asserts
      `dist/index.html` exists afterwards, then re-runs it with `bun` masked out of `PATH` and
      asserts the hook still exits 0 and prints the warning. Expected on first run: the hook does
      not build anything, so the first assertion fails.
- [ ] **Step 2: Implement** the build block and the `doctor.sh` check.
- [ ] **Step 3: Run.**

      ```sh
      bash plugins/tribe/scripts/tests/test-install-viewer-build.sh
      bash plugins/tribe/scripts/tests/test-install-hook.sh
      bash plugins/tribe/scripts/doctor.sh
      ```

      Expected: the first two pass; `doctor.sh` reports the viewer client as built.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run `install.sh` on a machine state where `dist/` does not exist and
confirm the viewer then starts. Then delete `dist/` and confirm `serve.ts` refuses with the
one-line message rather than serving a blank page.

---

## Phase 4 — integration and deletion

### Task 27: Runner integration — the two stdout lines

Independent of phases 1–3 (`owns_files`: `plugins/tribe/scripts/runner/**`). May run concurrently
with phase 1 or 3 in its own worktree.

- Modify: `R/core/viewer-launch.ts`, `R/core/viewer-launch.test.ts`, `R/core/types.ts`,
  `R/ports/ports.ts`, `R/adapters/run-io.adapter.ts`, `R/core/loop/card-actions.ts`,
  `R/cli/main.ts`
- Modify: `R/core/loop/card-actions.test.ts`, `R/cli/main.test.ts`

Model: **Sonnet**. Mechanical against a precise brief; the risk is breadth (645 tests construct
`LoopIO`), not depth, and `LinePort` already exists.

- [ ] **Step 1: Write the failing test.** `viewer-launch.test.ts`: `viewerRootUrl(4321, 'my-slug')`
      is exactly `http://127.0.0.1:4321/?campaign=my-slug`; a slug containing `&`, a space and a
      non-ASCII character is percent-encoded; `sessionUrlFor(base, id)` is exactly
      `<base-origin>/s/<id>`; the spawn argv no longer contains `--tribe-root`.

      **The probe's three outcomes (spec §10.4), against a fake server:**
      1. a body of `{"ok":true,"viewer":"tribe-viewer","v":2}` → **reuse**;
      2. nothing listening → **spawn**;
      3. a body of `{"ok":true,"viewer":"tribe-live-viewer","v":1}` (the pre-consolidation viewer),
         or a non-JSON body, or a 200 from something unrelated → **neither reuse nor spawn**, and
         exactly one stderr line:
         `campaign viewer: stale viewer on port 4321, stop it or pass --viewer-port <n> (needs v2, got v1)`.
         Assert no session URL is printed in this case — printing a URL that 404s is worse than
         printing none.
      `card-actions.test.ts`: `onSessionStart` calls `printLine` exactly once with
      `card C1: http://127.0.0.1:4321/s/<sessionId>` when `viewerBaseUrl` is set, and **not at all**
      when it is null. `main.test.ts`: the root line is printed once before the first card, and
      `--no-viewer` and `--dry-run` each print neither line. Expected: `viewerRootUrl` does not
      exist and `LoopIO` has no `printLine`.
- [ ] **Step 2: Implement** per spec §10.2 and §10.4. `LinePort` is added to `LoopIO`'s composition;
      the production wiring is one line in `run-io.adapter.ts`. The probe's accept condition becomes
      `viewer === 'tribe-viewer' && typeof v === 'number' && v >= 2` — a version floor, not an
      equality, so a future v3 viewer is still reusable.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/runner && bunx tsc --noEmit && bun test
      ```
      Expected: the full runner suite green (645 tests today), with the new cases added. Any
      existing test that fails to satisfy the widened `LoopIO` gets the one missing method, never a
      cast.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the runner on `--dry-run` and confirm zero viewer lines; then read
every `LoopIO` mock changed by this task and confirm none was silenced with `as any` or a
`@ts-expect-error`. A widened interface satisfied by a cast is a Should-fix that hides the next
breakage. Then stand up a **real** old-shape responder (a five-line Bun server returning the v1
body) on the probe port and confirm the runner neither reuses nor spawns, and prints the stale line
— that is the actual defect spec §10.4 exists to close, and a mocked probe alone cannot show it.

### Task 28: Deletion and the grep guard

- Create: `V/deletion-guard.test.ts`
- Delete: `V/core/derive.ts`, `V/core/derive.test.ts`, `V/core/render.ts`, `V/core/render.test.ts`,
  and any file listed in spec §11.1 that earlier tasks have not already removed (task 2 already
  removes `V/core/live/model.ts` and its test; §11.1 now lists them, so the two documents agree)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** `V/deletion-guard.test.ts`, implementing the five rules of
      spec §11.4 exactly. Expected on first run: rules 1–3 fail, because `derive.ts` and
      `render.ts` still exist and still name the status page.
- [ ] **Step 2: Delete** everything remaining in spec §11.1 and fix the resulting import errors —
      there should be none, because nothing in the new tree imports them.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bunx tsc --noEmit && bun test
      git -C "$(git rev-parse --show-toplevel)" diff --stat master -- plugins/tribe/scripts/viewer
      ```

      Expected: the suite green; the `diff --stat` shows the deleted line count, which goes into
      the PR body as G5's measurement. Paste it into the task report.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the grep guard's five rules yourself, by hand, with your own
`grep`. A guard that passes because its pattern is subtly wrong is worse than no guard — check rule
1 in particular (no code path may open anything under a runner logs directory, D6).

### Task 29: Phase 4 governance — the D9 sweep, the runner row, and the remaining docs

- Modify: `plugins/tribe/README.md` (lines 225, 249, and the "Status viewer" section)
- Modify: `plugins/tribe/scripts/runner/README.md` (the "Live viewer" section, lines 63–64, 76–77,
  215–216, 814, 860)
- Create: `.c3/changes/adr-20260911-viewer-consolidation/02-c3-215-contract-runner-row.patch.md`
- Modify: `.c3/c3-2-plugins/c3-215-tribe.md` (row 72, applying the change unit)
- Modify: `plugins/tribe/scripts/runner/core/watchdog/watch-loop.ts` (line 81 comment)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing check.** The D9 sweep's gate is a grep, run before and after:

      ```sh
      grep -rn -i 'supervisor' plugins/ .c3/ --include='*.md' --include='*.ts' --include='*.sh'
      grep -rn 'status viewer' plugins/ .c3/ --include='*.md'
      ```

      Expected before: **seven hits, exactly the seven in spec §15's table** — two `supervisor`
      (`plugins/tribe/README.md:249`, `runner/core/watchdog/watch-loop.ts:81`) and five
      `status viewer` (`plugins/tribe/README.md:225`, `runner/README.md:76`, `:129`, `:814`,
      `:860`). Record the real output verbatim; if it is not seven, the inventory is stale and the
      spec's §15 table is corrected in this same task before anything is renamed. Expected after:
      zero.

      The `Monitor` and `ScheduleWakeup` tool names and the `artifact-comment-monitor` row type are
      **not** in scope and must still be present afterwards — assert that too.
- [ ] **Step 2: Apply the seven renames** of spec §15 and rewrite the two README sections against
      the new single surface and the two stdout lines of spec §10.2. Hits 4 and 5
      (`runner/README.md:76`, `:129`) fall inside ranges being rewritten anyway — they still have to
      be in the inventory, because the gate is "the grep returned exactly this set before, and
      returns empty after".
- [ ] **Step 3: Author and apply** the c3-215 row 72 change unit (the runner's viewer sentences),
      escaping every literal `|` as `\|`.
- [ ] **Step 4: Run.**

      ```sh
      bunx @c3x/cli@11.6.3 check </dev/null
      cd plugins/tribe/scripts/runner && bun test
      grep -rn -i 'supervisor' plugins/ .c3/ --include='*.md' --include='*.ts' --include='*.sh'
      grep -rnc 'Monitor' plugins/tribe/scripts/runner/core/session.ts
      ```

      Expected: `bunx @c3x/cli@11.6.3 check` clean; the runner suite green; the supervisor grep empty; `Monitor`
      still present in `session.ts`. This closes follow-up F2.
- [ ] **Step 5: Commit**

Audit lens (Sol, contract): run both greps yourself. Then confirm the D9 rename did **not** touch a
Claude Code tool name or a transcript row type — an over-eager sweep here breaks the wait-tool
denial hook, which no viewer test would catch.

---

## Phase 5 — evidence

### Task 30: Fixture and real-transcript end-to-end, plus the performance numbers

- Create: `V/e2e/dom-kinds.e2e.test.ts`, `V/e2e/url-refusals.e2e.test.ts`,
  `V/e2e/real-transcript.e2e.test.ts`, `V/e2e/served-build.e2e.test.ts`, `V/e2e/perf.test.ts`
  (`V/e2e/browser.ts` already exists from task 22)
- Delete: `V/e2e/harness.ts`, `V/e2e/harness.test.ts`, `V/e2e/live-viewer.e2e.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** per spec §16.2 and §16.5. These are **DOM** proofs in real
      headless Chromium via `e2e/browser.ts`, not API-shape assertions — G1, G4 and G6 are claims
      about what a person sees, so that is where they are observed.

      `dom-kinds.e2e.test.ts`: serve with `HOME` pointed at the task-1 tree and **no `~/.tribe`
      inside it** (G1's precondition); open `/s/<session-1>` in a page; then for **every** `k` in
      spec §4's `RenderNode` union assert `document.querySelectorAll('[data-kind="k"]').length >= 1`
      — iterate the union itself, so a kind added to the model with no component fails here rather
      than vanishing; click a subagent tab and assert it navigates and renders that agent's rows;
      assert the spill card fetches nothing until expanded; assert the sidebar shows two projects
      plus a `show 1 older projects` link and that `?all=1` shows three (D10); assert each of the
      three empty shapes renders the "no sessions found" note rather than an error or a blank pane.

      `url-refusals.e2e.test.ts`: the URL matrix of spec §16.2 over HTTP — a valid id, `..`, a
      percent-encoded `/`, a double-encoded `..%2f`, a NUL byte, an id from the other project, an
      absent id — plus **both symlinks** in the fixture's `tool-results/`: the escaping one refused,
      the legitimate one served.

      `served-build.e2e.test.ts` (G6, spec §16.5): hash every file of a **fresh** `bun run build`,
      then fetch `/` and every asset the shell references from the **running** server and assert the
      hashes are equal. That is what "the runner's spawn serves the built output" actually claims.

      `real-transcript.e2e.test.ts` runs the same DOM assertions read-only against the largest real
      transcript (13 MB) and one real session with subagents. `perf.test.ts` records every budget in
      spec §14 to `perf.json`, including RSS after 8 streams **and again after 10 minutes of
      appends** (the eviction contract of spec §6.5 is a claim about lifetime, not about startup).

      Expected: the e2e files do not exist and the old harness still does.
- [ ] **Step 2: Implement,** carrying the current harness's proven parts: the bounded deadline
      loops, the shell-metacharacter quoting for `commands.md` (F54), and the "a screenshot that
      cannot be captured is recorded, never faked" rule. Screenshots are still taken — they are how
      a human reviews the result — but **no assertion rests on one**. If no browser resolves, these
      suites **fail** with `bunx playwright install chromium`; they never skip.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test e2e/dom-kinds.e2e.test.ts e2e/url-refusals.e2e.test.ts e2e/served-build.e2e.test.ts
      cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/
      ```

      Expected: the fixture DOM suites pass with **no** environment variable and with **zero** side
      effects outside their `mkdtemp` (they spawn no campaign and spend no token — only the Haiku
      suites in tasks 31 and 32 are gated); the opt-in run additionally produces `perf.json` and the
      screenshots, each a real non-trivial PNG. Every budget in spec §14 is met or the shortfall is
      recorded verbatim — never widened to make the test pass.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the DOM suites yourself with `HOME` set to a directory that has no
`.claude` and no `.tribe` at all, and confirm they pass — that is G1's actual claim. Then delete one
component (say `RawCard`) and confirm `dom-kinds` goes **red**: a kind-coverage test that stays green
with a missing renderer is proving nothing, and that is the single most important property of this
task. Confirm a plain `bun test` starts no campaign and spends no token. Finally, rebuild the client
with a trivial change and confirm `served-build` goes red against the still-running old server —
that is G6's claim and the viewer-side half of the stale-viewer defect.

### Task 31: Live-tail end-to-end on Haiku 4.5

- Create: `V/e2e/live-tail.e2e.test.ts`
- Modify: `V/e2e/README.md`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** per spec §16.3. The latency number comes from a
      **controlled writer the test owns**, never from a transcript row's `timestamp` field — that is
      the model's clock, it can precede the write by seconds, and using it makes the measurement a
      proxy for the thing G2 actually claims.

      1. Serve a fixture session and open it in Chromium via `e2e/browser.ts`.
      2. Append one well-formed row, recording `performance.now()` the instant `writeSync` returns,
         together with the `RowAnchor.id` that row will have (`` `${byteOffsetWrittenAt}:0` ``,
         computable before the write).
      3. Poll the page for `[data-row-id="<that id>"]`; the sample is `arrivalMs - writeCompletedMs`,
         both clocks owned by the test.
      4. **40 samples at irregular intervals** so tick boundaries are sometimes hit and sometimes
         missed. **Worst sample ≤ 1000 ms.** `latency.json` records every sample; nothing is clamped
         or discarded.

      Then, in the same run:
      - **the subagent case G2 names**: append to an open `agent-*.jsonl` tab and measure the same
        way;
      - **a subagent appearing mid-stream**: create a new `agent-*.jsonl` + `.meta.json` while the
        **parent** stream is open; a new tab element appears with no reload;
      - **the scroll assertions of spec §8.3, on `scrollTop`**: while following, the second reading
        is greater and the list is within 32 px of the bottom; after scrolling up 400 px, the second
        reading is **byte-identical** to the first and `[data-testid="follow-pill"]` exists; after
        clicking the pill, following resumes on the next append;
      - **the patch case**: write a `tool_use` row, wait for its card, write the matching
        `tool_result` in a later tick; the card gains its result **and**
        `document.querySelectorAll('[data-row-id]').length` is unchanged;
      - **resume**: drop the connection mid-row, reconnect, assert every row appears exactly once;
      - **rotation**: replace the transcript with a **same-size** file of different content and
        assert the view resets and re-renders.

      A real `claude -p` Haiku 4.5 session runs alongside as the realism check (it writes a real
      transcript the page renders), but **no assertion depends on its content** — that is what makes
      the measurement reproducible. Expected: the test file does not exist.
- [ ] **Step 2: Implement,** gated behind `TRIBE_VIEWER_E2E=1` so a plain `bun test` never spawns a
      session or spends a token.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/live-tail.e2e.test.ts
      ```
      Expected: `latency.json` written with all 40 samples; the worst under 1000 ms; every scroll,
      patch, resume, rotation and mid-stream-subagent assertion passing; the screenshots real PNGs.
      If the budget is missed, record the real number — never widen the budget to make the test
      pass.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): re-run this yourself and read `latency.json`. Confirm every sample's
start is the **writer's own** `performance.now()` — if any sample is derived from a row's
`timestamp` field or a file mtime, the measurement has silently reverted to the proxy this revision
removed, and that is a Critical finding. Then check the scroll assertions compare actual `scrollTop`
numbers rather than a React state flag: only the DOM number can show the viewport did not move.

### Task 32: Campaign-badge end-to-end on Haiku 4.5

- Create: `V/e2e/campaign-badge.e2e.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test** per spec §16.4: a throwaway `git init` repo with no
      remote, a campaign home under the real tribe root, one staged card whose spec and plan force
      a `hunter` dispatch, validated with `--dry-run` first, then the real runner on
      `--viewer-port 4399`. Assertions per spec §16.4:
      - both stdout lines captured **verbatim**;
      - the printed session URL is **opened in the browser** and renders that session — a printed
        URL that 404s is a G3 failure however green the unit tests are;
      - the badge is asserted **in the DOM** (slug, card, status, runner state);
      - **the badge element is clicked**, and the resulting session-row count and `location.search`
        are asserted. G3's click leg is a click, not a component test;
      - after the runner exits, a reload shows `runnerAlive: false`;
      - two screenshots.

      **Port ownership is a precondition, not a thing to clear**: if anything is already listening
      on 4399 at start, the test **refuses to run** with a clear message. Expected: the test file
      does not exist.
- [ ] **Step 2: Implement.** Teardown kills **only the pids this test spawned** — the runner's
      process group by the pid the test holds, and the viewer child by the pid the test holds. It
      never kills "whatever holds port 4399": that may be an unrelated process, and terminating one
      is outside this card's authority (the old harness did exactly that and it is being removed,
      not carried over). Delete the throwaway repo; deliberately keep the campaign home as
      evidence.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/campaign-badge.e2e.test.ts
      ```
      Expected: both stdout lines match spec §10.2 character for character; the badge assertions
      pass; `commands.md` records every command actually run.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): confirm the printed session URL actually opens that session in the
running viewer — the test asserts it in the browser, so re-run it and watch. Then read the teardown:
any code path that discovers a pid **from a port** rather than from its own spawn is a Should-fix at
minimum, because it can kill a process this card never owned.

### Task 33: Phase 5 governance — the evidence index and the final gate sweep

- Modify: `V/e2e/README.md`
- Create: `docs/tribe/planning/viewer-consolidation/evidence/README.md`
- Modify: `docs/tribe/planning/viewer-consolidation/spec.md` (only where a measured constant
  replaced an assumption — the title window from task 10 and any budget task 30 revised)

Model: **Sonnet**.

- [ ] **Step 1: Write the failing check.** The gate is the full repo sweep; run it first and record
      every failure:

      ```sh
      cd plugins/tribe/scripts/viewer && bunx tsc --noEmit && bun test
      cd plugins/tribe/scripts/runner && bunx tsc --noEmit && bun test
      bash plugins/tribe/scripts/tests/test-install-viewer-build.sh
      bash plugins/tribe/scripts/tests/test-install-hook.sh
      bunx @c3x/cli@11.6.3 check </dev/null
      ```

      Note the viewer's `bun test` now includes the DOM suites of task 30 (they are **not** gated
      behind an environment variable — only the two Haiku suites are), so a missing browser fails
      this sweep rather than silently reducing it.

      Expected: everything green by this point; anything red here is a real regression and is fixed
      before the index is written.
- [ ] **Step 2: Write the evidence index** — one table mapping each of G1–G6 to the artifact that
      proves it, with the real measured number beside it (latency, line counts, budgets, pass
      counts). No claim without an artifact path. For G1, G2, G4 and G6 the artifact must be the
      **DOM-level** one from spec §16 (`dom-kinds`, `latency.json` + the scroll readings,
      `paths.containment` + `readonly` + `serve.security`, `served-build`) — naming a unit test
      there would re-introduce exactly the proxy-proof gap this revision closed.
- [ ] **Step 3: Reconcile the spec** with what was actually measured. The spec is the contract, so
      a constant that changed during the build is corrected here, in the same PR, with the
      measurement cited.
- [ ] **Step 4: Run.** The command block from step 1, again.
      Expected: identical, all green, and the evidence index resolves every link it names.
- [ ] **Step 5: Commit**

Audit lens (Sol, contract): open every link in the evidence index and confirm it resolves. Then
check each G1–G6 row against the card's own wording — a goal whose artifact proves something
adjacent but not the stated claim is a Critical finding, because that is what a `SHIPPED` report
would rest on.

---

## What the Warchief carries into every hunter brief

1. The task section above, **verbatim**, including its audit lens.
2. The Global Constraints block, the oracle, and the adjudication rule, **verbatim**.
3. The interfaces and decisions earlier tasks produced (module signatures, the `RenderNode` union
   as it actually landed, constants that were measured rather than assumed).
4. The report-file path, and the atomic-commit rules: tick this plan's checkboxes in the same
   commit as the code, and stamp the commit with `Tribe-Card: viewer-consolidation` and
   `Tribe-Task: N/33` in one final paragraph.
5. The toolchain traps: run every command from inside the package directory (`cd
   plugins/tribe/scripts/viewer` or the runner equivalent); `bun run check` is `tsc --noEmit && bun
   test`; the e2e suites are gated behind `TRIBE_VIEWER_E2E=1` and must never run by accident;
   never export a whole `.env` file into the shell.
