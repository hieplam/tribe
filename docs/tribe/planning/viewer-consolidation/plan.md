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
  client reads `var(--token)` only, using the token names of spec §8.2 **verbatim** from
  **`design/sea-salt/tokens.css`** (the owner's choice, STATE.md D17). `matcha/` and `coffee/`
  remain in the repo as the rejected candidates and are **never imported**. There is no alias layer
  and no invented scale.
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

### The three rulings that arrived with review round 2 (quoted, not paraphrased)

- **D12** — "Drop byte-offset resume entirely: `id:` on frames is a per-stream monotonic sequence
  used only for client-side dedupe; `Last-Event-ID` is ignored by the server; on reconnect the
  client receives `hello` + the current window + current pairing state rebuilt from the file, and
  dedupes by stable row id. Rotation/inode handling stays for the live stream."
- **D13** — "The pure tail transition takes the raw byte chunk and the file observation; it finds
  the last `0x0A` in the raw bytes itself, carries raw bytes (not a decoded string), and decodes
  only complete lines. The adapter does no decoding."
- **D14** — "Containment root for all transcript reads is the resolved `~/.claude/projects`
  directory, not the session directory. Symlinks that resolve inside that root are accepted;
  anything resolving outside is refused."
- **D15** — "Text-bearing nodes (prompt, assistant text, thinking, raw card) whose encoded size
  exceeds 64 KiB are elided the same way tool payloads are, with `expandable` and
  `/api/block?at=&i=` for the full body. Therefore no single node can exceed the frame cap and
  `batchFrames` has no 'emit oversized alone' branch."
- **D16** — "`structure.test.ts` permits only these world-touching imports in adapters (`node:fs`
  readFile / open with read flags / stat / lstat / readdir / realpath / read; `Bun.file` read;
  `Bun.serve`) and fails on any other `node:fs`, `fs/promises`, `Bun.write`, `child_process` or
  `node:net` import or member."

- **D18** — "The allowlist applies to `core/**`, `adapters/**`, `serve.ts` and `client/src/**`
  (runtime code). `tools/**` (measurement scripts, never imported by runtime code;
  `structure.test.ts` asserts no runtime import of `tools/`) and `fixtures/**`, `e2e/**` are outside
  the wall. Token delivery: no fs copy step; Vite imports
  `../../docs/tribe/planning/viewer-consolidation/design/sea-salt/tokens.css` by path from
  `client/src/styles/index.css` (`@import`), so the build reads it and nothing copies it."
- **D19** — "A tool node carries two anchors: `call: {at,i}` (the `tool_use` block) and
  `result: {at,i} | null` (the `tool_result` block in its later row, set by pairing). `/api/block`
  stays `at`+`i`. The client expands the call payload with `call` and the result payload with
  `result`. Orphan results carry only `result`."
- **D20** — "Window boundaries are whole rows. The backward read trims from the front by whole rows
  only, stopping at the largest prefix removal that still leaves ≥500 nodes; the window may
  therefore exceed 500 by at most one row's nodes. `from` = the first retained row's offset. Pairing
  runs AFTER trimming, on retained rows only: a result whose call is outside the window renders as
  `orphan_result` with label 'call is above the window'."

**There is no `Last-Event-ID` handling anywhere in this plan.** If a task brief or a test name
mentions resuming by byte offset, it predates D12 and is wrong.

### The oracle (quoted from spec §0, not paraphrased)

> **The Claude Code transcript files on this machine are the oracle.** Kanna's code is a
> reference, never the standard. **Under-rendering** (a row type or content block present on disk
> that the viewer drops silently) **is a bug. Over-rendering** (showing a raw-JSON fallback card
> for an unknown row) **is by design.** File order is the display order — never sort by timestamp.

Claude Code on this machine is 2.1.267. Every count cited in a task comes from the **single** corpus
scan recorded in spec §0 (2026-09-12). The corpus is live, so scans minutes apart legitimately
disagree — if a number is disputed, re-run the whole scan and replace all of them together, never
one in isolation.

### Adjudication rule for every audit on this card (verbatim, inherited by both skinners)

REFUTED in advance: (a) any finding that the viewer should also read the runner log or `~/.tribe`
beyond campaign-state.json and run.json (D6/D8); (b) any finding that a Kanna behaviour is missing
when the transcript on disk does not carry the data (L9 stream-only events); (c) any finding that
colours or fonts are unspecified — tokens are the owner's (P1); (d) any defect inherited verbatim
from the current viewer that the plan schedules for deletion; **(e) any finding that the `/healthz`
v2 identity change is a breaking change — it is deliberate (spec §10.4, R9): a pre-consolidation
viewer does not reload its route table, so it must be unrecognisable rather than reusable, and the
runner degrades to one clear stderr line; (f) any finding that the DOM e2e suites should skip when
no Chromium resolves — they fail by design (spec §16.0, R8), because a user-visible goal must never
go green because its browser was missing.**

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

**The P1 gate, concretely — and it is now SATISFIED.** Before dispatching task 1, confirm all three:

1. `docs/tribe/planning/viewer-consolidation/design/` holds the candidate themes — it does:
   `matcha/`, `coffee/`, `sea-salt/`, one shared token schema;
2. the owner has **named one**, recorded in STATE.md as a ruling — **D17, 2026-09-12: sea salt**;
3. `design/<that-theme>/tokens.css` exists and defines every token in spec §8.2's table —
   `design/sea-salt/tokens.css` does, all 38, verified 2026-09-12.

All three hold, so the gate is **open** and task 1 may be dispatched. **The check is not retired by
being satisfied**: re-run it at dispatch. A theme decision that later changes STATE.md without
adding the matching `tokens.css` (or the reverse) is exactly the drift this gate catches, and a
check that is only written down after it fails is not a check. If any condition stops holding, the
Warchief returns `NEEDS_DIRECTION` to the Shaman and dispatches nothing.

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

- [ ] **Step 1: Write the failing test** `V/fixtures/build.test.ts`.

      **The builder produces exactly TWO fake HOMEs** (spec §16.2), because one directory cannot
      both hold a populated `.claude/projects` and have no `.claude`:
      - `buildHomeA(mkdtempSync(...))` → `.claude/projects/...` and **no `.tribe`** — G1, G2, G4;
      - `buildHomeB(mkdtempSync(...))` → everything in A **plus** `.tribe/` with the two same-slug
        campaigns of spec §16.4 — G3.

      Plus three standalone empties, each its own directory and **not** a variant of A:
      `buildEmptyProject()`, `buildEmptyProjectsRoot()`, `buildHomeWithoutClaude()`. Every one comes
      from `mkdtemp`, never a fixed path.

      Assert over `homeA`: two project directories; session 1's `.jsonl` contains at least one row
      for **every** `type` in spec §7.1 and one block for every row of spec §7.2; a `subagents/`
      directory holds five sidecars forming the depth-2 tree, the missing-parent orphan and the
      self-cycle; a `tool-results/` file exists whose name the `persisted-output` marker points at.

      **Assert all three symlinks by name** — each exists, each is a symlink
      (`lstatSync(...).isSymbolicLink()`), and each `realpathSync` resolves to the stated target:
      `escaping.txt` **outside** the projects root, `in-session.txt` inside the same session, and the
      **sibling-session sidecar** inside `<session-2>`. A fixture whose own test does not pin these
      three cannot support tasks 4, 15 and 30, which all assert behaviour against them.

      Assert `homeB` adds exactly the two `campaign-state.json` files and nothing else. Assert each
      empty shape produces exactly the layout it names and nothing else.

      Expected on first run: `error: Cannot find module './build.ts'`.
- [ ] **Step 2: Implement** `V/fixtures/build.ts`. Pure data plus one `mkdirSync`/`writeFileSync`
      edge; it takes the destination directory as an argument and constructs nothing it was not
      given (`pure-core.md`). Every row it writes is copied in shape from the real corpus — spec
      §7 names the fields, and `~/.claude/projects` is the oracle for any field the spec leaves
      unstated.
- [ ] **Step 3: Verify against an empty target, by hand.** Run the tree builder into a bare
      directory and walk it, proving the layout spec §5.1 expects is what actually lands:

      ```sh
      cd plugins/tribe/scripts/viewer
      FIX="$(mktemp -d)"
      bun -e 'import {buildHomeA} from "./fixtures/build.ts"; buildHomeA(process.argv[1])' "$FIX"
      find "$FIX" -type f | sort
      find "$FIX" -type l -ls
      rm -rf "$FIX"
      ```

      `mktemp -d` allocates a fresh, owned directory: a fixed path like `/tmp/vc-fixture` is shared,
      makes concurrent verification race, and turns a stray `rm -rf` into someone else's data loss.

      Expected: every path under `$FIX/.claude/projects/`; exactly four
      `<project>/<session>.jsonl` files; five `<session>/subagents/agent-*.jsonl` with five matching
      `.meta.json`; one real `<session>/tool-results/*.txt`; and exactly three symlinks with the
      targets named in step 1. No other file. Paste both listings into the task report.
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
      or `not_found`), never a throw. Include `?all=1` on `/` and `/api/projects` (D10, spec §5.6),
      `?campaign=<repoKey>/<slug>` (spec §9 — the **pair**; assert a bare slug with no `/` is
      rejected, because a slug-only filter merges two campaigns that really exist on this machine),
      and assert `/healthz` parses to the health route.

      Add `V/core/model.test.ts` for the runtime witness of spec §4:
      `Object.keys(RENDER_NODE_KINDS)` is non-empty and every key is a string. The compiler does the
      real work — `RENDER_NODE_KINDS: Record<RenderNode["k"], true>` fails to typecheck the moment a
      kind joins the union without joining the witness — so this test exists to make the witness
      **importable and iterable at runtime**, which is exactly what task 30's DOM proof needs (a
      TypeScript union is erased and cannot be iterated).

      Expected on first run: `Cannot find module './routes.ts'`.
- [ ] **Step 2: Implement** `V/core/routes.ts` and `V/core/model.ts` (spec §4, verbatim — the
      `RenderNode` union is the contract three later tasks compile against). `model.ts` is
      types-only **except** `RENDER_NODE_KINDS`, the one runtime value it exports. Routes are pure
      string math: `new URL(...)`, pattern matching, no path joins.
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
      0 unparsable rows in 127,085). Its Consequences name the two change units tasks 21 and 29
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
      containment cannot cover. **The root is the resolved `~/.claude/projects` directory (D14), not
      the session directory** — that is decided by the oracle: the one real symlink on this machine
      is a sidecar pointing at the same agent file under a **sibling session**, and a session-rooted
      check would refuse a row Claude Code itself wrote, which is under-rendering. Cases:
      - **accept** a target resolving to a sibling session inside the projects root (the real shape);
      - **refuse** a target resolving to `/tmp/evil`, i.e. anywhere outside the root;
      - **refuse** a prefix-collision (`/root-evil` against root `/root`) — a `startsWith` without
        the separator is the classic bug here;
      - **refuse** a symlinked project directory whose target is outside the root;
      - **accept** an ordinary non-symlinked file inside the root — a check that refuses everything
        proves nothing, so the positive cases are mandatory.

      Expected on first run: `Cannot find module './paths.ts'`.
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
      `completeLines(bytes, dropLeadingPartial)` takes **raw bytes** and returns only whole lines;
      with `dropLeadingPartial` it discards bytes before the first `0x0A`; a buffer whose boundary
      lands **exactly on** a `0x0A` drops nothing; a buffer with no `0x0A` returns no lines.

      For `tail.ts`, carry over every existing case, then add the four this plan fixes. **D13 is the
      shape and it must be honoured literally: `advanceTail` takes the raw `Uint8Array` and the
      `FileObservation`, finds the last `0x0A` in those bytes itself, carries RAW BYTES, and decodes
      only complete lines.** A signature that accepts an already-decoded string is wrong, whatever
      it then computes.
      1. `ackOffset` is one byte past the last `0x0A` the transition found. The property to assert
         is the one that matters: **for every state the machine passes through, the file has a
         `0x0A` at `ackOffset - 1`.** Feed a chunk ending mid-row and assert `offset` advances past
         the partial bytes while `ackOffset` does not;
      2. **the UTF-8 case that the old decoded-string design got wrong**: a chunk whose final bytes
         are an incomplete multi-byte sequence (e.g. a lone `0xC3`) after a complete line — the
         complete line decodes, the partial bytes are carried raw, `ackOffset` still points after
         the newline, and the character reassembles correctly when the next chunk arrives. Under
         D13 there is no decoder state to hide bytes in, which is what makes this pass;
      3. `reset` fires on `obs.sizeBytes < state.offset` (truncation), and on
         `obs.inode !== state.inode` **even when the new file is the same size or larger**
         (rotation), and does **not** fire when `state.inode` is 0 (a platform with no inode —
         degrade to the truncation trigger alone, never a false reset);
      4. a carry crossing **1 MiB — the single cap, there is no second one** — emits one
         `unreadable` node, drops the carry, and resynchronises at the next `0x0A`.

      Expected on first run: all three modules missing.
- [ ] **Step 2: Implement** all three. `tail.ts` keeps its current arithmetic exactly —
      `offset = base.offset + consumedBytes`, never `fileSize`, never `chunk.length` — and gains
      `ackOffset`, the inode trigger and the one carry cap, over raw bytes per D13. It takes a
      `FileObservation` (spec §4), not a bare size. Keep the existing doc comments; they encode why
      (F56), and add one naming D13 so a later refactor does not reintroduce a decoded-string
      signature.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/records.test.ts core/tail.test.ts
      ```
      Expected: all pass, including the three new tail cases.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): run the tail state machine over a real 13 MB transcript in byte-ranged
chunks of varying sizes — including boundaries that split a multi-byte character and that split a
line — and prove the reassembled line set is identical to `readFileSync(...).split('\n')`. That is
the only honest test of this module. Then check the invariant directly: **for every intermediate
state, `readFileSync(path)[ackOffset - 1] === 0x0A`.** A single state where it is not means the
transition is deriving the offset by arithmetic rather than by finding the byte, and is a Critical
finding. Confirm by reading the signature that no decoded string enters this module (D13).

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
      **no node**, with the measured 8,411-of-17,873 rationale in a comment); `tool_use`;
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
      (asserts `agentId` is set); a tool input over 64 KiB (asserts the node's `elided: true`,
      `expandable: true`, and no full payload in the node); a result over 64 KiB (same, with the
      `ToolResult`'s own `elided` set so the client knows which half it is expanding).

      **D19 — a tool node carries TWO anchors, and this is the case a single address cannot serve.**
      `call` is the `tool_use` block's `{at,i}` (always this node's own); `resultAnchor` is the
      `tool_result` block's `{at,i}` in its **later row**, filled by pairing and `null` while
      pending. Assert: a paired node's `resultAnchor.at` is **greater than** its `call.at` (the
      result is physically a later row — verified on the real corpus, where every `tool_use` is on
      an assistant row and every `tool_result` on a following user row); both halves elided at once
      yields two distinct addresses; an `orphan_result` carries `resultAnchor` and no `call`. One
      address for a two-payload card would make one of the two unreachable.

      **Then D15, which is what makes the frame budget satisfiable:** every *text-bearing* kind
      gets the same treatment. A **2 MiB assistant text row** produces **one node under 64 KiB**
      with `elided: true` and `expandable: true`, and its full body is reachable at
      `/api/block?at=&i=`. Same for an oversized prompt, an oversized thinking block, an oversized
      error body and a `raw` card over the JSON cap. Assert the encoded size of the emitted node,
      not just the flag — the flag without the truncation is the bug. After this task **no node of
      any kind can exceed 64 KiB**, which is the precondition task 13's batching relies on.

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
many nodes carry `elided: true`, and confirm no node's serialized size exceeds
the 1 MiB frame budget of spec §14. Then feed the same transcript through the normalizer twice, once
as one batch and once split into 50 arbitrary tick boundaries, and assert the resulting
(nodes + patches) collapse to an identical final state. A `RowAnchor.id` that depends on how the
bytes were chunked is a Critical finding: it silently breaks patching and dedupe.

### Task 10: Title, liveness, and the bounded read window

- Create: `V/core/title.ts`, `V/core/title.test.ts`, `V/core/liveness.ts`, `V/core/liveness.test.ts`
- Create: `V/tools/title-window.ts` (a read-only corpus measurement. **`tools/` is outside the D16 wall by D18** — it is not runtime code, is never imported by runtime code, and `structure.test.ts` asserts that last point. Putting it under `core/` or `adapters/` would either break the purity wall or force an exception into the allowlist; putting it in `tools/` needs neither)

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
      bun tools/title-window.ts --head 65536 --tail 262144
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
      index entry for nothing and is counted in `skipped`.

      Then the identity cases, which are measured facts on this machine, not hypotheticals — 17
      campaigns, of which **2 slugs exist under two repo keys** and **6 session ids appear under
      both** (spec §9):
      - the index is `Map<sessionId, Badge[]>`: one session id claimed by two campaigns yields
        **two** badges, and neither overwrites the other whatever order the directories are scanned
        in;
      - a campaign is identified by the pair `(repoKey, slug)`: filtering by
        `<repoKeyA>/<slug>` returns A's sessions only, and a bare slug matches nothing (the filter
        takes a pair, and a slug-only filter would merge two unrelated campaigns);
      - **no repo key is excluded**, including a `.migrated-*` one — guessing which is stale is a
        product judgment the viewer has no standing to make.

      Also write the cap as a **pure selection** (`pure-core.md`, spec §9):
      `selectCampaigns(entries, cap)` picks which 200 campaign directories are admitted —
      deterministic over supplied directory listings, newest `campaigns/<slug>` mtime first, ties by
      name — so the adapter performs the reads the selection names and chooses nothing.

      Expected: module missing.
- [ ] **Step 2: Implement.** The module takes already-read JSON values and a
      `processAlive: (pid: number) => boolean` function — injected, never constructed
      (`pure-core.md`), plus `selectCampaigns`. `statePath` from `run.json` is never read; there is
      no code path that could.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/badge.test.ts
      ```
      Expected: all pass, including the traversal case.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): this module closes B3. Verify by reading it that no value originating in
a JSON file is ever concatenated into a path, and run the traversal case yourself. Also confirm the
module names neither `logsDir` nor `statePath` anywhere (D6).

### Task 13: SSE frames, sequence ids, and frame batching

- Create: `V/core/sse.ts`, `V/core/sse.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Encoding: every frame type of spec §6.2 round-trips,
      **including `patch`**; `id:` is present on every frame and is a **per-stream monotonic
      sequence** starting at 1 on `hello` and incrementing by one per frame, of any type (D12) —
      assert a `hello`/`rows`/`patch`/`meta`/`ping` sequence carries ids 1,2,3,4,5; **`hello` carries a
      `generation`** and two connections to the same session produce **different** generations
      (spec §6.2 — it is what tells the client to clear rather than merge); `retry:` appears
      exactly once, in the first frame; a payload containing a newline, `U+2028`, `U+2029`, a
      BigInt, a cyclic object and `undefined` each produce a well-formed frame (carry over the
      existing `serializeFrameData` cases and add the two Unicode line separators, which the
      current code leaves unhandled).

      **There is no `parseLastEventId`, and no test for one.** D12: the server ignores
      `Last-Event-ID` entirely. Assert that absence the only way it can be asserted — the module
      exports no such function and its source does not contain the string `Last-Event-ID` — so a
      later revival is a red test rather than a silent regression.

      Add the batching helper: `batchFrames(nodes, maxBytes)` splits a tick's nodes into as many
      `rows` frames as needed so **no encoded frame exceeds 1 MiB** (spec §6.2). Cases: many small
      nodes summing past the cap split into several frames, each under it, with every node present
      exactly once and order preserved; a single node near the cap sits alone in its frame.

      **There is no "oversized node" branch, and adding one would be a defect.** D15 (task 9) bounds
      every node at 64 KiB, so a node larger than the frame cap cannot exist. An earlier draft asked
      for both "every frame stays under 1 MiB" and "an oversized node is emitted alone", which is a
      contradiction, not a policy. Assert the invariant instead: for **any** input this function
      accepts, every emitted frame is under the cap — property-tested over randomly sized node
      lists, never a single happy path.

      Expected: module missing.
- [ ] **Step 2: Implement** `V/core/sse.ts`. Pure.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test core/sse.test.ts
      ```
      Expected: all pass, including the `U+2028`/`U+2029` cases.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): feed the encoder a frame whose payload contains a literal
`\ndata: injected` sequence and confirm the receiving side sees one frame, not two. Frame-splitting
through a payload is a Critical finding. Then serialize a real 500-node window from the largest
transcript on this machine and confirm every emitted frame is under 1 MiB — node-level elision does
not bound a frame, and the initial window is exactly where the aggregate bites.

### Task 14: Phase 1 governance — the structural wall and the core README section

- Modify: `V/structure.test.ts`
- Modify: `V/README.md`
- Delete: the now-empty `V/core/live/` directory

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Extend `V/structure.test.ts` with the five new rules of
      spec §12.6 that are checkable today (the client rules land in task 22): `process.argv`
      appears only in `serve.ts`; `.tribe` appears only in `adapters/campaign.adapter.ts` (assert
      the rule now, with the adapter not yet existing, so it fails loudly until task 16); the
      `core/**` value-imports no `.adapter` module; the raw-source `process.env` ban now also covers
      `client/`.

      **The zero-write wall becomes an ALLOWLIST (D16), scoped to runtime code (D18).**

      **Scope first**, because an allowlist applied to the wrong set of files blocks work it was
      never meant to govern: the wall covers `core/**`, `adapters/**`, `serve.ts` and
      `client/src/**`. **Outside it:** `tools/**` (measurement scripts — task 10's corpus reader
      lives there precisely so it needs no exception) and `fixtures/**`, `e2e/**` (scaffolding that
      must write, or it could not build a fixture). Add the rule that stops the scope becoming a
      loophole: **no file under the wall may import from `tools/`**, asserted the same mechanical
      way as the rest.

      Then the allowlist itself, replacing the denylist of call names. A
      denylist is only as good as its author's memory: the previous shape listed `writeFile`,
      `appendFile`, `mkdir`, `rm`, `rename`, `unlink`, `spawn`, `exec` — and left `Bun.write`,
      `createWriteStream`, `copyFile`, `truncate`, a write-mode `open` and all of `fs/promises` wide
      open. Inverted, the rule is total. **Permitted, in `adapters/**` only:** from `node:fs` —
      `readFileSync`, `openSync` (read flags only), `readSync`, `closeSync`, `statSync`, `lstatSync`,
      `readdirSync`, `realpathSync`; `Bun.file` read methods; `Bun.serve` (in `serve.ts`).
      **Refused anywhere else in the package** (outside `fixtures/` and `e2e/`): any other `node:fs`
      member, any `fs/promises` import, `Bun.write`, `node:child_process`, `node:net`, `node:http`,
      `node:https`. Resolve imports with Bun's transpiler as the existing wall does, **and** scan
      member expressions, so `fs.writeFileSync` reached through a namespace import is caught as well
      as a named import.

      **Prove the wall bites**: add a throwaway file under `adapters/` that calls `Bun.write`,
      assert the rule goes red, then delete it. Do the same for a runtime file importing from
      `tools/`. A wall never seen to fail is not known to work.

      Also add: **no bare `catch` under `core/**` or `adapters/**`** (`fail-closed-edges`
      obligation 1) — every `catch` names the error classes it handles or re-throws what it does
      not recognise.

      Expected: the `.tribe` rule and the allowlist rule both fail against the current tree (the old
      `scan.adapter.ts` is still present).
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
Then **try to defeat the allowlist**: write `import * as fs from 'node:fs'; fs.writeFileSync(...)`,
a `fs/promises` import, a `Bun.write`, and an `openSync(path, 'w')`, and confirm each one goes red.
Any that slips through means the wall is still a denylist wearing an allowlist's name, and G4 rests
on it. A rule whose matcher can be satisfied by a comment, or that scans a transpiled import list
when it should scan raw source (or the reverse), is a Should-fix — the existing file's doc comments
explain which direction each rule must fail in; that reasoning is the contract.

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
      requested bytes **as a `Uint8Array`** and throws on a genuine read failure (that throw is
      load-bearing — the poller turns it into a frame); `readHead`/`readTail` return raw byte ranges
      and **do not** decide line boundaries (that is `core/window.ts`, task 5); `readTextCapped`
      refuses past its cap; `realpathOrNull` resolves a symlink and returns null for a broken one.

      **Assert the adapter decodes nothing (D13):** its source contains no `TextDecoder` and no
      `readFileSync(..., 'utf8')` on a transcript path. Decoding complete lines is core's job, and
      an adapter that decodes is what made the old `ackOffset` formula unsound.

      In `readonly.test.ts` — G4's proof, so it asserts the properties, not the implementation:
      1. the adapter module's exported surface contains **no** write-capable function, and its
         source satisfies task 14's D16 **allowlist** — only the permitted read primitives appear,
         and none of `Bun.write`, `createWriteStream`, `copyFile`, `truncate`, a write-mode
         `openSync`, or any `fs/promises` import;
      2. **narrow catches are distinguishable** (`fail-closed-edges` obligation 1): a file whose
         content is malformed JSON yields the "malformed" outcome (counted, `SyntaxError`-derived)
         while a file that cannot be read (`EACCES`, via `chmod 000` in a temp dir, and `ENOENT`)
         yields the "absent" outcome — asserted as two **different** results, because a single
         `catch {}` swallowing both makes a permissions bug look like an empty campaign forever;
      3. the three symlink shapes of D14, judged against the resolved **`~/.claude/projects`** root
         (never the session directory): the one resolving outside the root is refused, the one
         resolving to a **sibling session inside** the root is served, and the broken one is refused
         without a read. A session-rooted check would refuse the sibling case, which is a real shape
         Claude Code writes on this machine.

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
      rule of task 15); `processAlive` is injected, not called directly.

      **The 200-campaign cap is not tested here, because it is not decided here.** Task 12's pure
      `selectCampaigns` chooses which directories are admitted; this adapter's test asserts only
      that it *reads exactly what the selection named and nothing else* — hand it a selection of two
      out of five fixture campaigns and assert three were never opened.

      **Resolved containment applies here too, with `realpath(~/.tribe)` as the root** (spec §9).
      A `readdir` entry cannot spell `..`, but it **can be a symlink** pointing anywhere, and that
      is the same class the project-directory check already closes on the transcript side. Assert:
      a fixture `~/.tribe/<repoKey>` that is a symlink to a directory outside the tribe root is
      refused and counted **before** `campaign-state.json` is opened; the same for a symlinked
      `campaigns/<slug>` and a symlinked `runs/<runId>`; and an ordinary non-symlinked campaign is
      still read (the positive case, so the check is not merely refusing everything).

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

- [ ] **Step 1: Write the failing test.**

      **`/api/rows` counts NODES, never rows** (spec §4's vocabulary: a row is a transcript line, a
      node is a rendered unit, and one row can yield several nodes or none). It returns the **last
      500 nodes** by default, found by spec §6.3's backwards-stepping algorithm — read backwards
      from EOF in 256 KiB steps, drop the leading partial row unless at BOF, parse complete rows,
      accumulate the node count, stop at ≥500 nodes or BOF, then trim.

      **The trim is by WHOLE ROWS (D20), and "exactly 500 nodes" is deliberately NOT the contract.**
      Drop the largest prefix of whole rows that still leaves ≥500 nodes; the window may exceed 500
      by at most one row's nodes. `from` is the **first retained row's** offset.

      Assert the case that makes this load-bearing, because an exact-500 trim passes every other
      test and loses data here: on a **four-block row straddling the boundary**, an exact trim would
      keep blocks 2 and 3 and record `from` as that row's offset — so `before=from` reads rows
      *before* it and blocks 0 and 1 become unreachable by any request, permanently. Assert instead
      that the whole row is retained, that `from` is its offset, and that a `before=from` back-fill
      returns the rows immediately preceding it with **no block missing at the seam**.

      `truncatedBefore` is true iff **any row precedes the anchor**. Also assert on a fixture row
      carrying four blocks that a 500-node window spans **fewer than 500 rows**: that is the one assertion that
      distinguishes a correct implementation from a row-counting one. `from` is the first row's byte
      offset; `truncatedBefore` is **true iff BOF was not reached**; `before` past EOF or negative is
      refused with 400; a `before` window is contiguous with the one it precedes.

      **`/api/block` is addressed by `at` + `i`, never by uuid.** `at` is the row's byte offset and
      `i` the block index (spec §4). A tool card sends its `call` anchor to expand the input and its
      `resultAnchor` to expand the result (D19) — the route itself is unchanged and takes no `part`
      parameter; the client simply has two addresses for a two-payload card. Uuid addressing is impossible
      here: 14,032 measured `attachment` rows carry none, and neither do `last-prompt`, `ai-title`
      or `custom-title` rows. Assert: a valid `at`+`i` returns the full payload; an `at` that is not
      a row boundary 404s; an `i` past the row's block count 404s; the response never exceeds the
      cap; and **an attachment row with no uuid expands successfully**, which is the case that
      proves the addressing choice.

      `/api/spill` returns the fixture's spill file, refuses `../etc/passwd`, refuses a name with a
      slash, refuses a name failing the charset, and caps the read at 2 MiB. Expected: routes 404.
- [ ] **Step 2: Implement** per spec §3.2, §6.3 and §7.6, routing every path through
      `containedJoin` and the resolved check of D14.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && bun test serve.reads.test.ts
      ```

      Expected: all pass, including the four spill refusals, the fewer-than-500-rows node assertion,
      and the uuid-less attachment expansion.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): attempt the traversal yourself, with at least these encodings: `..%2f`,
`%2e%2e/`, a NUL byte, a UTF-8 overlong `..`, and an absolute path. Any that reads a file outside the
**resolved `~/.claude/projects` root** (D14 — that is the root, not the session directory) is a
Critical finding. Then grep the implementation for `uuid`: `/api/block` must not accept or look one
up, because the client never sends one and 14,032 real attachment rows do not have one.

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
      - a truncation emits `reset{reason:"truncated"}` **followed by the normal tail window** — the
        last 500 nodes per spec §6.3, **never the file from byte 0** (a rotated 13 MB file would
        otherwise re-deliver everything through a 1 MiB-framed pipe). Assert the first `rows` frame
        after a `reset` starts at the tail anchor, not at offset 0, and that it happens exactly once;
      - **the file is replaced with a same-size file of different content** (the fixture's rotation
        pair from task 1) — emits `reset{reason:"rotated"}` then the same tail window; the same with
        a **larger** replacement. Size alone cannot see either; the inode can;
      - **a new `agent-*.jsonl` + `.meta.json` appears while the parent stream is open** — emits a
        `meta` frame containing the new agent, with no reconnect (spec §6.2);
      - a deletion emits `gone`;
      - a delta larger than the 4 MiB tick cap is delivered across two ticks with no byte lost or
        duplicated; `ping` fires at 15 s;
      - **every frame's `id:` is the next per-stream sequence number** (D12), incrementing across
        frame types, never an offset, and `hello` carries a fresh `generation`;
      - **a tick whose nodes exceed 1 MiB encoded is split into several `rows` frames**, each under
        the cap, every node present exactly once and in order — drive it with a 4 MiB tick of many
        small nodes, which is the realistic catch-up shape.

      `serve.events.test.ts`: a real connection against the fixture receives `hello` then `rows`;
      **a reconnect is a fresh snapshot (D12)** — the server ignores the `Last-Event-ID` the browser
      sends, replies with `hello` **carrying a new `generation`** plus the current window, and the
      pairing state is rebuilt from the file, so a `tool_use`/`tool_result` pair that straddled the
      disconnect arrives **already paired** rather than as an orphan; the 9th concurrent stream gets 503; closing a connection
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

Audit lens (Sol, contract): run a real stream against a file you append to yourself and kill the
connection **between a `tool_use` row and its `tool_result`**; reconnect and confirm the tool card
arrives complete, with no orphan and no duplicate. Then do the same **between a `rows` frame and its
`patch`**. Those two are the cases an offset cursor could not express and the reason D12 exists.
Confirm the server never reads `Last-Event-ID` (grep it in the handler; the browser will send one).
Then replace the file with a same-size file while connected and confirm a `rotated` reset fires — if
it does not, the inode is not reaching the transition. Finally, open and abandon 20 connections and
confirm the slot counter returns to zero.

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

P1 gates **every** phase (see Global Constraints) and is satisfied: the theme is **sea salt**
(STATE.md D17) and `design/sea-salt/tokens.css` defines all 38 tokens spec §8.2 names. What is
specific to this phase is the *use* of it: the token names are copied **verbatim** from that one
file, there is no alias layer, and no component may introduce a name the file does not define.

### Task 22: Vite scaffold, token wiring, and the client half of the structural wall

- Create: `V/vite.config.ts`, `V/index.html`, `V/tsconfig.client.json`,
  `V/client/src/main.tsx`, `V/client/src/App.tsx`, `V/client/src/routes.ts`,
  `V/client/src/styles/app.css`
- Modify: `V/package.json` (react, react-dom, vite, the plugin, the type packages,
  **`playwright-core` pinned at 1.63.0**, the build script), `V/.gitignore` (add `dist/`)
- Modify: `V/structure.test.ts` (the three client rules of spec §12.6)
- Delete: `V/client/app.js`, `V/client/app.css`, `V/client/app.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Extend `structure.test.ts`: no file under `client/`
      contains `dangerouslySetInnerHTML`; **no file under `client/` at all** contains a literal
      colour (there is no `tokens.css` under `client/` to exempt — D18 delivers tokens by `@import`
      from the owner's file, so the only exempt file is `design/sea-salt/tokens.css` itself, which
      is outside `client/`) (`#rgb`, `#rrggbb`, `rgb(`, `rgba(`,
      `hsl(`, `oklch(`), a `font-family` value, or a bare `px` length; `client/src/**` value-imports
      nothing from `core/` or `adapters/` (type-only imports are permitted and must still pass).
      Add `V/client/src/routes.test.ts` asserting the four URL shapes of spec §3.2 parse and
      round-trip through `pushState`. Expected: the client rules fail against the old `app.css`,
      which is full of literals.
- [ ] **Step 2: Implement** the scaffold. **Tokens arrive by `@import`, not by a copy step (D18).**
      `client/src/styles/index.css` carries
      `@import "../../../../docs/tribe/planning/viewer-consolidation/design/sea-salt/tokens.css";`
      (STATE.md D17) and Vite resolves it at build time. Do **not** add a copy step to
      `vite.config.ts`: that would need a filesystem write from runtime-adjacent build code, which
      the D16 wall forbids, and inventing an exception for it would weaken the wall to save a line.
      `matcha/` and `coffee/` are never imported. `vite.config.ts` sets `build.outDir` to `../dist`
      with `base: '/assets/'`. Pin react and react-dom at 19.2.x and vite at its current major; add
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
confirm there is **no copy** of `tokens.css` under `client/` at all — the `@import` means the
owner's file is the only copy in the repo — and that no file imports from `design/matcha/` or
`design/coffee/`. Then confirm the built bundle actually contains the sea-salt values, which is what
proves the import resolved rather than silently failing. Finally check every
`var(--name)` the client uses is defined in that file, with the candidates' own names
(`--space-12`, `--radius-8`, `--surface-raised`, `--size-14`), not an invented scale.

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
      status and the runner state; a session claimed by two campaigns renders **two** badges (spec §9);
      clicking one sets `?campaign=<repoKey>/<slug>`; the filter narrows the
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
      other two rest on (spec §8.4). The store holds **one contiguous window** of nodes,
      `[first, last]` in byte offsets — never a sparse set of ranges:
      - nodes are keyed by `RowAnchor.id` and held in file order;
      - **a `rows` node whose id is already present is ignored, not appended** — assert the node
        count is unchanged. This is what makes D12's reconnect-as-fresh-snapshot invisible: the
        overlap between the old window and the new one is dropped rather than duplicating cards;
      - **a `patch` replaces the node with that id in place**, preserving position, node count
        unchanged;
      - a `patch` for an id outside the window is dropped silently, not an error;
      - **back-fill prepends**: nodes from `/api/rows?before=<first>` go on the front, `first` moves
        backwards, order is preserved by concatenation because the range is contiguous;
      - **at the 2,000-node cap, eviction is from the TAIL and following switches off in the same
        operation** (spec §6.3). Assert both, and assert the oldest back-filled node survives —
        head eviction would delete the history the user just requested and cap "load earlier" at
        2,000 nodes forever, on four transcripts that already exceed it;
      - **while at the cap with follow-live off, an incoming `rows` frame is COUNTED, NOT
        APPENDED** (spec §6.3) — assert the node count is unchanged and a counter increments;
        appending during tail eviction would put a hole in the middle of the window;
      - **clicking the "N new below" pill, or scrolling back to the bottom, reloads the tail
        window** (a fresh fetch with no `before`), replaces the store's contents, re-enables
        following and zeroes the counter;
      - **the store clears on `reset`** and then applies the window that follows (spec §6.1);
      - **the store clears when `hello` carries a different `generation`** than the one it holds,
        then applies the snapshot; ids seen under the previous generation mean nothing (spec §6.2).
        Assert the failing shape directly: hold a window under generation A, deliver a `hello` with
        generation B carrying nodes with the **same ids**, and assert the store ends holding B's
        nodes — a merge here would silently keep stale content from a file that may have rotated;
      - **the window is always one contiguous range** — assert it as an invariant after every
        operation above, not just at the end;
      - **back-fill re-pairs an orphan into a complete card (D20)**: hold a window whose first node
        is an `orphan_result` labelled "call is above the window", load earlier so the call's row
        enters the window, and assert the orphan is **replaced in place** by a paired `tool` card —
        not that a second card appears beside it. This is the user-visible half of "pairing runs
        after trimming".

      `useEventStream.test.ts` against a fake `EventSource`: `hello` then `rows` populates; a second
      `rows` frame appends; a `patch` frame routes to the store's patch path; `meta` updates the
      agent tabs **without** touching nodes; `reset` clears and re-populates; `gone` stops
      reconnecting; **a dropped connection reconnects and processes a fresh `hello` + window,
      discarding its previous window rather than merging** (D12), and the user sees no duplicate
      card because the store dedupes by id. The hook **never sets or reads `Last-Event-ID`** — the
      browser may send one, and the server ignores it; assert the hook's source does not mention it.

      **The sequence watermark is cleared on every `EventSource` `open`** — assert it directly, with
      the sequence that breaks without it: process frames with ids 1..5, force a reconnect, deliver
      a fresh `hello` with **id 1**, and assert it is processed rather than discarded as
      already-seen. Frame ids restart at 1 per connection (spec §6.2), so a watermark carried across
      a reconnect silently swallows the entire new window — the page would go blank and stay blank,
      with no error anywhere.

      `session.test.tsx`: one rendering case per `RenderNode` kind in spec §4; every rendered row
      carries `data-kind` and `data-row-id`, a `tool` card also carries
      `data-state="pending|ok|error"`, and the list carries `data-scroll="rows"` (spec §12.6 — these
      are the addresses the DOM e2e proofs use, so they are contract, not scaffolding); a `tool`
      node renders its result attached to the call and an error result renders with the error
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
nodes, scroll up, new nodes, click pill, new nodes — and assert the viewport moves only in states 2
and 6. Then drive the store through the sequence D12 makes routine: a `rows` frame carrying a
pending `tool` node, a `patch` for it, then a **whole fresh window replayed** (what a reconnect
produces), overlapping the existing one. The correct end state is one card, with its result, in its
original position. Two cards, a lost result, or a window that is no longer one contiguous range is a
Critical finding. Then back-fill past 2,000 nodes and confirm the oldest requested node is still
present and the follow pill is off. Also confirm `dangerouslySetInnerHTML` appears nowhere in the
built bundle.

### Task 25: Subagent tabs, expansion, attachments, and raw cards

- Create: `V/client/src/components/AgentTabs.tsx`, `OrphanResultCard.tsx`, `ImageCard.tsx`,
  `AttachmentStrip.tsx`, `RawCard.tsx`, `UnreadableNote.tsx`, `NewBelowPill.tsx`
- Create: `V/client/src/components/agents.test.tsx`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** Tabs render from `Agent[]` in tree order with depth
      indentation; selecting a tab navigates to `/s/<id>/a/<agentId>` and opens a new stream; a
      `Task` tool card whose node carries an `agentId` links to that tab; `ImageCard` fetches
      `/api/block?at=<RowAnchor.at>&i=<RowAnchor.i>` only on expand — **addressed by the node's own
      `at`+`i`, never a uuid** (an `attachment` row has no `message.content`, so its `i` is 0).
      **A `ToolCard` has two expansions and two addresses (D19)**: the input expands with `call`,
      the result with `resultAnchor`; assert each fetch carries the right one, and that a pending
      card offers no result expansion because `resultAnchor` is null. An `OrphanResultCard` expands
      with its `resultAnchor` and renders the label **"call is above the window"** — not an error
      style, because it is not an error: loading earlier re-pairs it into a complete card (spec §4: 14,032 measured `attachment` rows carry no uuid, which
      is why one addressing scheme covers every expandable node); `ToolCard` with a spill result
      fetches `/api/spill` only on expand and shows the preview before that; consecutive
      `attachment` nodes collapse into one strip whose entries expand the same way, and an
      `attachment` node with `expandable: false` renders **no** affordance rather than one that
      would return nothing; `RawCard` renders collapsed with the row type
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

- [ ] **Step 1: Write the failing test.** `viewer-launch.test.ts`:
      `viewerRootUrl(4321, 'my-repo', 'my-slug')` is exactly
      `http://127.0.0.1:4321/?campaign=my-repo/my-slug` — the **pair**, because a slug alone does
      not identify a campaign on this machine (spec §9); a repo key or slug containing `&`, a space
      or a non-ASCII character has **each half** percent-encoded with the `/` between them left
      literal; `sessionUrlFor(base, id)` is exactly `<base-origin>/s/<id>`; the spawn argv no longer
      contains `--tribe-root`.

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

      `dom-kinds.e2e.test.ts`: build **`homeA`** (task 1 — populated `.claude/projects`, **no
      `.tribe` at all**, which is G1's precondition) into a fresh `mkdtemp` directory and start the
      real server with `HOME=<that directory>`. The three empty shapes are **separate** directories
      from their own builders, not variants of `homeA`, and each is served and asserted on its own.
      Open `/s/<session-1>` in a page. Two layers:

      **Layer 1 — kind coverage, driven by the runtime witness.** Iterate
      `Object.keys(RENDER_NODE_KINDS)` (task 2) and assert
      `document.querySelectorAll('[data-kind="k"]').length >= 1` for each. Iterate the **witness**,
      never the TypeScript union — a union is erased at runtime and cannot be iterated; the witness's
      `Record<RenderNode["k"], true>` annotation is what makes the compiler reject a kind added to
      the model without a witness entry, so this test cannot drift from the union.

      **Layer 2 — one assertion per distinguishable input shape**, because several real on-disk
      shapes collapse to one `k` and kind coverage alone would pass while the array-prompt path (the
      defect that hid every runner prompt) is broken. One case each, per spec §16.2's table: string
      prompt; **array prompt**; `tool` pending (`[data-state="pending"]`); `tool` ok with its result
      text; `tool` error (`[data-state="error"]`); `orphan_result`; **empty thinking asserted
      absent**; non-empty thinking present; **`image` displayed**: on expand an `<img>` exists whose `src` is a `data:` URL of the expected
      byte length, and the browser's request log shows **no network fetch** for those bytes — G1
      says the image renders, so a node that merely claims one is not the proof; compaction
      `divider`; spill link with `/api/spill` not called before expand; unknown row type as a
      collapsed `raw` card.

      Also: click a subagent tab and assert it navigates and renders that agent's nodes; assert the
      sidebar shows two projects plus a `show 1 older projects` link and that `?all=1` shows the
      rest (D10); assert each of the three empty shapes renders the "no sessions found" note rather
      than an error or a blank pane.

      **The zero-write proof is a hash (D16/G4), not an inspection.** Take a recursive digest of the
      whole fixture HOME — every path, size and content hash under it — before the DOM suites run,
      run them, digest again, and assert the two are **byte-identical**. Task 14's allowlist proves
      no write call is *reachable in the source*; this proves none *happened in a real run*, which is
      the claim G4 makes. Both are required; neither implies the other.

      `url-refusals.e2e.test.ts`: the URL matrix of spec §16.2 over HTTP — a valid id, `..`, a
      percent-encoded `/`, a double-encoded `..%2f`, a NUL byte, an id from the other project, an
      absent id — **each with the expected outcome named** (spec §16.2's table), including the two a
      reader might get wrong: **an id belonging to the OTHER project renders `200`**, because §5.2
      resolves session ids globally with no project in the URL, and **an absent id returns the index
      shell**, not a 404, because `/s/*` is client-routed (§3.2) while `/api/session/<id>` is what
      404s. Plus the **three symlinks task 1 built**: `escaping.txt` refused, `in-session.txt`
      served, and the **sibling-session sidecar** served (D14's root is the projects directory, so a
      link to a sibling session is inside it).

      `served-build.e2e.test.ts` (G6, spec §16.5). The server serves its **fixed** `dist/` and gains
      **no `--dist` flag** — an overridable asset root is a security surface for a read-only viewer,
      and a proof that needs the server to serve somewhere else proves nothing about what it does.
      The real mechanism, in order: move any existing `dist/` aside; `bun run build` into the real
      `dist/`; hash every produced file; start the server on an ephemeral port; fetch `/` and every
      asset the shell references and hash each body; assert `hash(GET /index.html)` equals
      `hash(dist/index.html)` and likewise for every asset; stop the server; **restore the prior
      `dist/` in a `finally`**, so a failing assertion cannot leave the tree half-built.

      `real-transcript.e2e.test.ts` runs the same DOM assertions read-only against the largest real
      transcript (13 MB) and one real session with subagents. `perf.test.ts` records every budget in
      spec §14 to `perf.json`, including RSS after 8 streams **and again after 10 minutes of
      appends** (the eviction contract of spec §6.5 is a claim about lifetime, not about startup),
      and the initial-window frame sizes for the largest real transcript (every encoded frame under
      1 MiB).

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
      effects outside their `mkdtemp` and the `dist/` they restore (they spawn no campaign and spend
      no token — only the Haiku suites in tasks 31 and 32 are gated); the opt-in run additionally
      produces `perf.json` and the screenshots, each a real non-trivial PNG. Every budget in spec §14 is met or the shortfall is
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
      - **reconnect between a row and its patch (D12)**: write a `tool_use` row, wait for the card,
        drop the connection, write the matching `tool_result`, reconnect — assert the card shows its
        result **exactly once** and no duplicate row exists. This is the case an offset cursor could
        not express, and it is the single most important assertion in this task;
      - **reconnect between a call and its result**: drop the connection after the `tool_use` row
        and before the `tool_result` is written, reconnect, then write the result — assert the card
        completes rather than orphaning (the reconnected stream rebuilds pairing from the file);
      - **window on a >2,000-node transcript** (task 1's fourth fixture session): load earlier past
        the cap, assert the oldest requested nodes are present and the follow pill is off, then
        scroll to the bottom and assert the tail window reloads and following resumes;
      - **rotation**: replace the transcript with a **same-size** file of different content while
        connected, and assert the view **clears and re-renders the tail window** — not the file from
        byte 0, and not a merge of old and new nodes (spec §6.1);
      - **generation**: after any reconnect, assert the store was cleared because `hello` carried a
        new `generation`, by loading earlier nodes first and confirming they are gone after the
        reconnect rather than silently merged with the new window.

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
      patch, reconnect, window, rotation and mid-stream-subagent assertion passing; the screenshots
      real PNGs.
      If the budget is missed, record the real number — never widen the budget to make the test
      pass.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): re-run this yourself and read `latency.json`. Confirm every sample's
start is the **writer's own** `performance.now()` — a sample derived from a row's `timestamp` field
or a file mtime means the measurement has reverted to a proxy, and that is a Critical finding. Check
the scroll assertions compare actual `scrollTop` numbers rather than a React state flag: only the
DOM number can show the viewport did not move. Then run the two reconnect cases by hand with the
browser open and watch the card: a duplicated card, a card that never gains its result, or an
`orphan_result` where a paired card belongs, each means D12's fresh-snapshot path is not actually
rebuilding pairing from the file.

### Task 32: Campaign-badge end-to-end on Haiku 4.5

- Create: `V/e2e/campaign-badge.e2e.test.ts`

Model: **Sonnet**.

- [ ] **Step 1: Write the failing test.** **Spec §16.4 states this harness in full** — the throwaway
      repo, the fake `HOME`, both campaign-home layouts, the card whose plan forces one `Task`-tool
      subagent dispatch, the exact runner invocation, every assertion and the teardown. Build it from
      that section; nothing here is "carried over" from a harness the reader cannot see.

      **Both campaign homes live under the fake HOME's `.tribe/` (`homeB` from task 1). This test
      never writes to the owner's real `~/.tribe`, and the runner is invoked with `HOME=<homeB>`
      precisely so it cannot.** Neither home is "the real one" — both are synthetic, one under
      `<repoKeyA>` and one under `<repoKeyB>` sharing a slug.

      In outline: a throwaway `git init` repo with no remote; one staged card whose spec and plan
      force a `hunter` dispatch; a `--dry-run` validation pass first; then the real runner on
      `--viewer-port 4399`. Assertions per spec §16.4:

      The fixture authors **two** campaign homes under `homeB`, both synthetic: one under
      `<repoKeyA>` and a second with the **same slug under `<repoKeyB>`** listing the same session id — the collision that exists on this
      machine today (2 slugs and 6 session ids are shared across two repo keys, spec §9).

      - both stdout lines captured **verbatim**;
      - the session row renders **two** badges, not one, and neither is dropped whatever order the
        directory scan returns;
      - `?campaign=<repoKeyA>/<slug>` filters to A's sessions and `?campaign=<repoKeyB>/<slug>` to
        B's — a slug-only filter would merge them, which is what this case exists to catch;
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
      not carried over).

      **Teardown also removes both synthetic campaign homes it created under `~/.tribe`**, in a
      `finally`, by the exact paths it recorded when creating them — never a glob, never a pattern.
      An earlier draft kept them "as evidence"; that is persistent mutation of the owner's real
      state, and the card reserves writes outside the repo to the owner. The evidence lives under
      `docs/tribe/planning/viewer-consolidation/evidence/`: the captured stdout lines, the assertion
      output and the screenshots. Delete the throwaway repo too.
- [ ] **Step 3: Run.**

      ```sh
      cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/campaign-badge.e2e.test.ts
      ```
      Expected: both stdout lines match spec §10.2 character for character; the badge assertions
      pass; `commands.md` records every command actually run.
- [ ] **Step 4: Commit**

Audit lens (Sol, contract): confirm the printed session URL actually opens that session in the
running viewer — the test asserts it in the browser, so re-run it and watch. Then point the viewer
at the **real** `~/.tribe` on this machine and confirm a session under both
`-Users-hip-repo-tribe/followups-2026-09-04` and
`-Users-hip-repo-todd-skills.migrated-1788705562/followups-2026-09-04` shows two badges — the
fixture proves the code path, the real tree proves the model matches reality. Then read the
teardown: any code path that discovers a pid **from a port** rather than from its own spawn is a
Should-fix at minimum, because it can kill a process this card never owned.

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
      bash plugins/tribe/scripts/pre-gate.sh <base-sha>..HEAD
      bun plugins/tribe/scripts/gaps/gap-gate.ts --repo . --home "$(bash plugins/tribe/scripts/tribe-home.sh .)" --card viewer-consolidation --base <base-sha> --head HEAD
      python3 - <<'FENCE'
      import re,sys
      F=re.compile(r'^(\s*)(`{3,}|~{3,})(.*)$')
      for path in ('docs/tribe/planning/viewer-consolidation/spec.md',
                   'docs/tribe/planning/viewer-consolidation/plan.md'):
          ch=None; n=0
          for l in open(path).read().split('\n'):
              m=F.match(l)
              if ch is None:
                  if m: ch,n=m.group(2)[0],len(m.group(2))
              elif m and m.group(2)[0]==ch and len(m.group(2))>=n and m.group(3).strip()=='':
                  ch=None
          print(path, 'FENCES OK' if ch is None else 'UNCLOSED FENCE'); assert ch is None
      FENCE
      ```

      Two of these are easy to skip and both are mandatory. **`pre-gate.sh` and `gap-gate.ts` are
      named in spec §16 as part of what "CI green" means here** — this repo has no GitHub Actions,
      so the gate set *is* the CI, and a final task that runs everything except the two tribe gates
      would let the card reach `SHIPPED` without the `## Harness gaps` section its PR body requires.
      **The fence-parity check** is the third: revision 3 of this spec shipped with one unclosed
      code fence, which silently swallowed four whole sections into a code block and reduced three
      Mermaid diagrams to one. Nothing else in the gate set can see that — `tsc`, `bun test` and
      `c3x` are all blind to Markdown — and a blind reader lost half the document to it.

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
   test`; **only the two Haiku suites (`live-tail.e2e.test.ts`, `campaign-badge.e2e.test.ts`) are
   gated behind `TRIBE_VIEWER_E2E=1`** — the DOM suites from task 30 run under a plain `bun test`
   and *fail* rather than skip when no Chromium resolves, which is deliberate (spec §16.0);
   C3 is reached only as `bunx @c3x/cli@11.6.3 <cmd> </dev/null`; never export a whole `.env` file
   into the shell.
