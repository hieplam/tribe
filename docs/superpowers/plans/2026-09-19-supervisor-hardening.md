# Supervisor hardening — implementation plan

**Card:** `supervisor-hardening`
**Spec:** `docs/superpowers/specs/2026-09-19-supervisor-hardening-design.md` — read it first; every
task below cites a section of it as its contract.
**Branch:** `feat/supervisor-hardening`, based on `origin/master` at `7a6a469`.

## Global Constraints

**Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
implementer.**

**Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
(database, network, filesystem, clock, random, global state) enters through an abstraction
injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**

### Preconditions, once per session before Task 1

Runner dependencies must be installed or the whole suite reports five phantom failures from one
unresolved `zod` import:

```bash
cd plugins/tribe/scripts/runner && bun install
```

Expected: `107 packages installed`. After it, `bun test` reports **1068 pass / 0 fail** and
`bunx tsc --noEmit` exits `0`. Those two numbers are this card's ratchet floor.

### The oracle (what decides correctness)

- **The spec in this plan is the contract.** Where the card and the code disagree about a fact, the
  code is right; where they disagree about intent, the card wins.
- **A fix that makes a test green without changing the wiring the defect lives in is a bug.** That
  is exactly how all five defects shipped. Every fix task names the wiring it must change.
- **Under-checking is a bug; over-checking is by design.** A new postcondition that refuses a case
  it did not strictly have to refuse is acceptable. One that lets a defective case through is not.
- A test that duplicates an end-to-end assertion is **by design**, not redundancy to be removed.

### Ratchets — none of these may move in the wrong direction

| Ratchet | Floor / ceiling | Command |
| --- | --- | --- |
| Runner tests | at least **1068 passing, 0 failing** | `cd plugins/tribe/scripts/runner && bun test` |
| Typecheck | exit `0` | `cd plugins/tribe/scripts/runner && bunx tsc --noEmit` |
| `G-004` fingerprint | reaches **0** files by Phase 3 | `grep -rln "'code' in err" plugins/tribe/scripts/runner --include="*.ts" --exclude="*.test.ts"` |
| Context ceilings | may **not rise** | `docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json` |

**Raising a ceiling to make a gate pass is forbidden without a recorded ruling id.** If a task
appears to need it, stop and report rather than editing the file.

### Fence — do not touch

- `plugins/tribe/scripts/runner/core/types.ts` and `core/state.ts` — **read-only reuse only.**
  Task 16 imports `CampaignStateSchema` from `core/state.ts`; it does not edit it.
- `plugins/tribe/scripts/runner/core/watchdog/` — untouched.
- `plugins/tribe/scripts/viewer/` — untouched. Its own `'code' in err` sites are outside `G-004`'s
  fingerprint and outside this card.
- `core/supervisor/model.ts`'s `ParkReason` union and `status.ts`'s `PARK_SENTENCES` — untouched.
- The committed ratchet JSON's ceiling values — unchanged by this card.

### Commit discipline, every task

- Tick this plan's checkboxes for your task in the **same commit** as the code.
- Every commit carries two trailers in one final paragraph:
  `Tribe-Card: supervisor-hardening` and `Tribe-Task: N/21`.
- **No AI or agent co-author trailer, and no "generated with" line, of any kind.** This is the
  owner's non-negotiable rule.
- Conventional-commit subject matching the repo's style, e.g. `fix(supervisor): …`.

### Adjudication rule — REFUTED in advance

- *"The green suite already covers it."* The card exists because it did not. A fix with no
  E2E-shaped reproduction is incomplete.
- *"Touch the viewer for the badge chip."* Out of fence (FU-CS-2 is out of this card).
- *"Raise a ceiling so the ratchet passes."* Forbidden without a ruling id.
- *"The architecture model is stale here."* Each phase ends with its own C3 reconciliation task;
  staleness that a scheduled task will fix is not a finding.
- *"`test-supervisor-repro.sh` fails."* It is gated behind `TRIBE_REPRO=1` and is *meant* to fail
  until its matching fix lands. Only an ungated failure is a finding.

### Why the reproductions are gated behind `TRIBE_REPRO=1`

The owner's rule requires every defect to be reproduced end-to-end **before** its fix. A committed
test that fails would turn the branch red and deadlock the audit gate, which refuses to dispatch a
reviewer against a mechanically broken branch. So Phase 1's reproductions live in one new suite
gated behind an env var, exactly the way `test-supervisor-real-e2e.sh` and
`test-supervisor-permission-real.sh` already gate themselves behind `TRIBE_REAL_E2E=1` — an
established precedent in this repo. The suite skips and exits `0` when the variable is unset, so
every commit stays green, while `TRIBE_REPRO=1` runs the real reproductions on demand.

The suite is **permanent**. It is the card's living proof that each defect is gone. Every fix task
must run it with the flag, observe its own defect fail, fix, and observe it pass — **and** add a
permanent ungated assertion in the proper suite so the ordinary gate protects the fix forever.

---

# Phase 1 — Reproduce every defect, before any fix

## Task 1: The reproduction suite, and G1's reproduction

**Contract:** spec §2. **Depends on:** nothing. **Model: `sonnet`** — the file layout, the env
gate, and the campaign fixture are all specified verbatim below; no design judgment is inside this
task.

**Files:** create `plugins/tribe/scripts/tests/test-supervisor-repro.sh`.

- [x] **Step 1: Write the gated suite and G1's failing reproduction.**
  Model the file on `test-supervisor-e2e.sh` (same `ok`/`bad`/`check`/`contains` helpers, same
  `mktemp -d` + `pwd -P` symlink resolution, same `trap` cleanup, same `new_campaign` fixture
  builder, same `printf '\n%s passed, %s failed\n'` tally at the end). Gate it at the top exactly
  the way the two real-E2E suites gate themselves:

  ```bash
  if [[ "${TRIBE_REPRO:-}" != "1" ]]; then
    echo "skipped test-supervisor-repro.sh — set TRIBE_REPRO=1 to run the supervisor-hardening card's defect reproductions"
    exit 0
  fi
  ```

  The G1 case: build a campaign from a bare `mktemp` home whose single escalated card is on
  `ownerOnlyEscalations`, whose `escalations/c1.md` carries a distinctive marker inside its
  `## Context` section, run `bun run.ts supervise` with the session double, and assert **the
  behaviour the fix must produce**:

  ```bash
  check "G1: an owner-only escalation parks" "$rc" "20"
  contains "G1: NEEDS_OWNER.md carries the escalation's own Context text" "$(cat "$H/NEEDS_OWNER.md")" "$MARKER"
  ```

- [x] **Step 2: Observe it fail — this is the red.**

  ```bash
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: the park assertion passes, the Context assertion **fails**, the script exits non-zero,
  and the tally reads `1 passed, 1 failed`. If the Context assertion passes, the fixture is wrong —
  the marker is not reaching the escalation file; fix the fixture, not the assertion.

- [x] **Step 3: Prove the ordinary gate stays green.**

  ```bash
  bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: the skip message, exit `0`.

- [x] **Step 4: Commit** — `test(supervisor): reproduce the park document losing the question`.

## Task 2: G3's reproduction — the unchecked closing verdict

**Contract:** spec §4. **Depends on:** Task 1. **Model: `sonnet`** — the assertions are named
below and the suite already exists.

**Files:** edit `plugins/tribe/scripts/tests/test-supervisor-repro.sh`.

- [x] **Step 1: Add three failing assertions.**
  Drive a campaign to a closing session with the session double (`DOUBLE_PLAN="rule:R1 close"`),
  then assert the behaviour the fix must produce:

  ```bash
  check "G3: a closing session that wrote no verdict file does not close the campaign" "$rc" "20"
  ok_if_file "G3: verify-shipped.sh writes a verdict file per shipped card" "$H/supervisor/verdicts/c1.json"
  contains "G3: the SKILL.md command resolves under a plugin load" "$(bash "$SKILL_DIR/resolve-verify-shipped.sh" 2>&1)" "verify-shipped.sh"
  ```

  Add a fourth, pure assertion proving the postcondition itself is blind today — run it through
  `bun -e` against the real module rather than restating it in prose:

  ```bash
  bun -e 'import { verifyClosing } from "./core/supervisor/verify.ts";
    const v = verifyClosing({ finalReport: "Status: BLOCKED\n", answers: "", shippedVerdicts: [] });
    if (v.outcome === "closed") { console.error("G3: a BLOCKED report still closes"); process.exit(1); }'
  ```

- [x] **Step 2: Observe it fail — the red.**

  ```bash
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: G1's Context assertion still fails, and all four G3 assertions fail — the supervisor
  exits `0` instead of `20`, no verdict file exists, `resolve-verify-shipped.sh` does not exist, and
  `verifyClosing` rejects the unknown `shippedVerdicts` argument or returns `closed`.

- [x] **Step 3: Commit** — `test(supervisor): reproduce the closing verdict nobody checks`.

## Task 3: G5's reproduction — writer and reader name different directories

**Contract:** spec §6, including its reproduction-honesty note. **Depends on:** Task 2.
**Model: `sonnet`** — the candidate header shape is given verbatim below.

**Files:** edit `plugins/tribe/scripts/tests/test-supervisor-repro.sh`.

- [x] **Step 1: Add the failing reproduction.**
  Build a bare campaign home, write a Tracker report at `$H/reports/tracker-c1-final.md` using the
  **real** candidate header shape the parser requires (`gap-candidates.ts` line 35's `HEADER_RE` —
  a plain bullet list does not parse and yields an empty `open_ids`, which would make this
  reproduction prove nothing):

  ```markdown
  ### Harness gaps

  HG-candidate 1 [error-handling]
  Pattern: `grep -rln "REPRO_G5_SENTINEL" plugins/tribe/scripts/runner`
  Evidence: 2 hits in plugins/tribe/scripts/runner/adapters
  ```

  Run the **real** `gap-gate.ts` with `--home "$H"` and no `--out`, confirm it recorded at least one
  id in `open_ids`, then assert the rendered closing brief carries that id:

  ```bash
  check "G5: the gate recorded at least one open id" "$has_ids" "1"
  contains "G5: the closing brief lists the gate's own open ids" "$brief" "$open_id"
  ```

  Render the brief by calling the supervisor's own exported reader and `renderBrief` through
  `bun -e`, so the assertion is about production code and not a re-implementation.

- [x] **Step 2: Observe it fail — the red.**

  ```bash
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: the gate records an id (that assertion passes), and the brief assertion **fails**
  because the reader looks under the base tribe home while the gate wrote under the campaign home.
  If `open_ids` comes back empty, the candidate block shape is wrong — fix the fixture, never the
  assertion.

- [x] **Step 3: Commit** — `test(supervisor): reproduce the gap-gate reader and writer disagreeing`.

> **RW1 (coordinator ruling, mid-task):** calling `readGapGateOpenIds` directly would reproduce
> nothing (the defect is its caller `buildOneShotPrompt`'s choice of home). `buildOneShotPrompt`
> was exported as a test seam in `core/supervisor/loop.ts` (one word, zero behavior change) so
> this reproduction drives it directly with the real `buildSupervisorIo` adapter; Task 11 keeps
> the export and fixes the one line. See this task's commit for the full reasoning.

## Task 4: G2's reproduction — an unjustified ceiling raise passes every gate

**Contract:** spec §3. **Depends on:** Task 3. **Model: `sonnet`** — the three fixture cases and
their expected exit codes are fully specified.

**Files:** edit `plugins/tribe/scripts/tests/test-supervisor-repro.sh`.

- [x] **Step 1: Add the failing reproduction.**
  In a throwaway `mktemp` git repo built from nothing, commit a ratchet file with
  `"ruling": 27534`, then commit a second version raising it to `999999` with no `raisedBy`, and
  assert the gate that must exist refuses it:

  ```bash
  bun plugins/tribe/scripts/ratchet-check.ts --repo "$FIX" --base "$BASE" --path ratchet.json
  check "G2: an unjustified raise is refused" "$?" "1"
  ```

  Add the two companion cases in the same run: the same raise **with** `raisedBy.ruling` set must
  exit `0`, and a lowering must exit `0`.

- [x] **Step 2: Observe it fail — the red.**

  ```bash
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: all three G2 assertions fail because `plugins/tribe/scripts/ratchet-check.ts` does not
  exist yet, so `bun` exits with a module-resolution error rather than `1`, `0`, `0`.

- [x] **Step 3: Commit** — `test(supervisor): reproduce the ratchet accepting an unjustified raise`.

## Task 5: Phase 1 governance reconciliation

**Contract:** spec §11. **Depends on:** Task 4. **Model: `opus`** — authoring an ADR and its
patches is a judgment act, not a mechanical edit.

**Files:** `.c3/` entities, authored **only** through the wrapper CLI. Never open or edit a `.c3/`
instance file by hand.

- [x] **Step 1: Author the card's ADR.**
  Record the four decisions spec §11 names: the verdict file's contract (§4a), the ratchet
  enforcement point (§3), the four named parsers (§5), and the campaign-home path truth (§6).

  ```bash
  C3="$(ls -d ~/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3)"
  C3X_MODE=agent bash "$C3/bin/c3x.sh" schema adr > /tmp/adr-supervisor-hardening.md
  C3X_MODE=agent bash "$C3/bin/c3x.sh" add adr supervisor-hardening --file /tmp/adr-supervisor-hardening.md
  ```

  Expected: the entity is created and reported by id. Do **not** author patches against `c3-215`
  yet — the code they would describe does not exist until Phase 2, and a patch authored against
  absent code is the drift this repo already has three units of.

- [x] **Step 2: Validate.**

  ```bash
  C3X_MODE=agent bash "$C3/bin/c3x.sh" check
  ```

  Expected: `ok: true`. Record the `total:` count. If `ok` is false, the new ADR is malformed —
  repair it through the CLI, never by editing the file.

- [x] **Step 3: Commit** — `docs(c3): record the supervisor-hardening ADR`.

---

# Phase 2 — The five fixes

## Task 6: G1 — one escalation parser, and a park document that shows the question

**Contract:** spec §2 and §5(d). **Depends on:** Task 5. **Model: `opus`** — the block-partition
boundary rule and the three-read-site placement decision are judgment inside the task.

**Files:** create `plugins/tribe/scripts/runner/core/escalation.ts` and
`core/escalation.test.ts`; edit `core/supervisor/loop.ts` and
`plugins/tribe/scripts/tests/test-supervisor-e2e.sh`.

- [x] **Step 1: Write the failing unit test first.**
  `core/escalation.test.ts` covers `parseEscalationQuestion`: a well-formed file returns both the
  `**Reason:**` line and the `## Context` body verbatim; a `## Context` followed by another `## `
  heading stops at the boundary; a file with neither returns `null`; malformed input never throws.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/escalation.test.ts
  ```

  Expected: fails — the module does not exist.

- [x] **Step 2: Write the parser, pure.**
  No fs, no clock, no throw. Signature per spec §2. Use the same heading-partition convention
  `verify.ts`'s `blocksById` and `loop.ts`'s `extractRulingBlockVerbatim` already use, so the repo
  has one boundary rule rather than a third.

- [x] **Step 3: Rewire the two supervisor read sites.**
  `loop.ts`'s private `extractReasonLine` is replaced by a call into the new parser, and the `park`
  branch at `loop.ts:962` stops passing the literal `question: null`: it reads the escalation file
  for `cardIdHint`'s card and passes the parsed result, `null` only when there is no card-scoped
  escalation. **The wiring, not the renderer, is the defect** — `renderNeedsOwner` is already
  correct and must not be changed.

- [x] **Step 4: Add the permanent ungated assertion.**
  In `test-supervisor-e2e.sh`'s probe 3 (the owner-only park), assert the rendered `NEEDS_OWNER.md`
  contains the escalation's own `## Context` text. This is the card's G1 oracle and it must live in
  the ordinary suite, not only in the gated reproduction suite.

- [x] **Step 5: Prove it.**

  ```bash
  grep -c "question: null" plugins/tribe/scripts/runner/core/supervisor/loop.ts
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: the grep prints `0`; `bun test` reports at least 1068 passing and 0 failing; `tsc`
  exits `0`; the e2e suite reports `0 failed`; and in the reproduction suite G1's assertions now
  pass while G2, G3 and G5 still fail.

- [x] **Step 6: Commit** — `fix(supervisor): show the card's own question in NEEDS_OWNER.md`.

## Task 7: G2 — give the ratchet a caller

**Contract:** spec §3. **Depends on:** Task 6. **Model: `opus`** — the merge-base comparison, the
`raisedBy` shape, and the fail-closed edge are design decisions inside the task.

**Files:** create `plugins/tribe/scripts/runner/core/metrics/ratchet-gate.ts` and
`ratchet-gate.test.ts`; create `plugins/tribe/scripts/ratchet-check.ts`; create
`plugins/tribe/scripts/tests/test-supervisor-ratchet.sh`.

- [x] **Step 1: Write the failing unit test first.**
  `ratchet-gate.test.ts` covers `checkRatchetRevision(baseJson, headJson)` over two file contents:
  a raise with no `raisedBy` fails and the failure names the old value, the proposed value and
  `raisedBy`; the same raise with `raisedBy` set passes; a lowering passes; an unchanged file
  passes; an unparseable head fails; an absent base is treated as the initial measurement.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/metrics/ratchet-gate.test.ts
  ```

  Expected: fails — the module does not exist.

- [x] **Step 2: Write the pure checker.**
  Two strings in, `{ ok, failures[] }` out. No fs, no git, no clock. It calls the **existing**
  `reviseCeiling` once per ceiling kind; `reviseCeiling` itself is not modified — this task gives
  it the caller its own module header says it was waiting for.

- [x] **Step 3: Write the thin edge.**
  `ratchet-check.ts` runs `git -C <repo> show <base>:<path>`, reads the working-tree version, hands
  both strings to the checker, prints each failure, and exits `0` or `1`. Every `git` call carries a
  timeout, and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` are set to `/dev/null` so a host's git config
  cannot change a verdict — `fail-closed-edges.md` obligations 2 and 3. A missing flag value must
  refuse with a message, never consume the next argv token as its value.

- [x] **Step 4: Write the gate suite.**
  `test-supervisor-ratchet.sh` drives the edge over a throwaway `mktemp` git repo built from
  nothing, covering the three fixture cases from spec §3, plus one case against the real repo and
  its real merge base which must exit `0`. `pre-gate.sh` enumerates suites by glob, so this file is
  swept automatically with no wiring step.

- [x] **Step 5: Prove it.**

  ```bash
  bash plugins/tribe/scripts/tests/test-supervisor-ratchet.sh
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: the ratchet suite reports `0 failed`; the runner suite stays at or above 1068 passing
  with 0 failing; `tsc` exits `0`; and G2's three reproduction assertions now pass. Then hand-edit
  the committed ratchet file to raise `ruling` to `999999`, re-run the ratchet suite, and confirm it
  now goes **red** — then restore the file with `git checkout --` before committing.

- [x] **Step 6: Commit** — `fix(supervisor): enforce the context ratchet against its merge base`.

## Task 8: G3a — `verify-shipped.sh` writes its own verdict file

**Contract:** spec §4a. **Depends on:** Task 7. **Model: `sonnet`** — one new flag with a fully
specified shape; no design judgment inside.

**Files:** edit `plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh` and
`plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`.

- [x] **Step 1: Write the failing test first.**
  Assert that with `--verdict-out <path>` the script writes a file at that path whose contents are
  byte-identical to its stdout JSON, that the file's `card` field equals `--card`, and that without
  the flag no file is written and stdout is unchanged.

  ```bash
  bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
  ```

  Expected: the new assertions fail; the pre-existing ones still pass.

- [x] **Step 2: Add the flag.**
  Parse `--verdict-out` the same way the existing flags are parsed, and refuse with a message if its
  value is missing rather than consuming the next argv token. Write the JSON to a temp file in the
  target directory and `mv` it into place, so a reader never sees a half-written file. Do not change
  the four checks, the stdout contract, or the exit codes.

- [x] **Step 3: Prove it.**

  ```bash
  bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
  ```

  Expected: `0 failed`.

- [x] **Step 4: Commit** — `feat(verify-shipped): write the verdict JSON to a file on request`.

## Task 9: G3b — the skill resolves its own script path (FU-CS-4)

**Contract:** spec §4d. **Depends on:** Task 8. **Model: `sonnet`** — the pattern is copied from an
existing file in this repo.

**Files:** create `plugins/verify-shipped/skills/verify-shipped/resolve-verify-shipped.sh`; edit
`plugins/verify-shipped/skills/verify-shipped/SKILL.md` and
`plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`.

- [x] **Step 1: Write the failing test first.**
  Assert the resolver prints an absolute path that exists and exits `0` when `CLAUDE_PLUGIN_ROOT`
  points at the plugin directory; that it also resolves with `CLAUDE_PLUGIN_ROOT` unset or pointing
  somewhere stale; that it prints **nothing** on stdout and exits `3` with a diagnostic on stderr
  when it genuinely cannot resolve; and that `SKILL.md` no longer contains the string
  `~/.claude/skills/verify-shipped`.

  ```bash
  bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
  ```

  Expected: the new assertions fail.

- [x] **Step 2: Write the resolver.**
  Copy the contract and the two-tier structure of
  `plugins/tribe/skills/orchestrate-campaign/resolve-runner.sh` exactly: tier 1 honours
  `$CLAUDE_PLUGIN_ROOT` **only when the target file actually exists under it**, tier 2 locates
  itself with `cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P`. It never prints a path it has not
  proven exists, and never prints a relative one. A stale or foreign `CLAUDE_PLUGIN_ROOT` must fall
  through to tier 2 rather than win on presence alone.

- [x] **Step 3: Fix `SKILL.md`.**
  Replace the two `~/.claude/skills/verify-shipped/scripts/verify-shipped.sh` invocations (its
  Usage block and its Example) with the resolver form, and document `--verdict-out` alongside the
  existing flags. Say plainly, as the orchestrate-campaign skill does, that the resolution must not
  be hand-written.

- [x] **Step 4: Prove it.**

  ```bash
  bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
  grep -c "\.claude/skills/verify-shipped" plugins/verify-shipped/skills/verify-shipped/SKILL.md
  ```

  Expected: `0 failed`, and the grep prints `0`.

- [x] **Step 5: Commit** — `fix(verify-shipped): resolve the script path under a plugin load`.

## Task 10: G3c — the supervisor checks the verdict on disk

**Contract:** spec §4b and §4c. **Depends on:** Task 9. **Model: `opus`** — the five failure rows,
the retry-versus-park choice, and the brief's oracle wording are judgment inside the task.

**Files:** edit `plugins/tribe/scripts/runner/core/supervisor/verify.ts`, `verify.test.ts`,
`core/supervisor/brief.ts`, `brief.test.ts`, `core/supervisor/loop.ts`, and
`plugins/tribe/scripts/tests/test-supervisor-e2e.sh`.

- [x] **Step 1: Write the failing unit tests first.**
  Cover all five `verifyClosing` rows from spec §4b: `verdict_missing`, `verdict_malformed`,
  `verdict_card_mismatch`, `verdict_fail`, and the success path where every shipped card has a
  present, well-formed, matching `PASS` verdict. Include the spec's own reproduction — a report
  whose body says `BLOCKED` with no verdict file must return `failed`, never `closed`.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/supervisor/verify.test.ts
  ```

  Expected: fails — `shippedVerdicts` is not a known input.

- [x] **Step 2: Widen the postcondition, keeping it pure.**
  `verifyClosing` takes `shippedVerdicts: Array<{ cardId: string; raw: string | null }>` and parses
  each `raw` narrowly and fail-closed. It reads nothing from disk — the caller reads, this function
  decides. A `FAIL` verdict returns the ordinary retryable `failed` outcome with the typed reason;
  it does **not** introduce a new `ParkReason`, which the fence forbids.

- [x] **Step 3: Wire the loop and the brief.**
  The loop reads `<home>/supervisor/verdicts/<cardId>.json` for every card the campaign report marks
  `shipped` and passes the contents in. `brief.ts`'s closing template and `ClosingBriefFacts` gain
  the per-card verdict path and the exact command to run, and state the oracle in the brief: the
  verdict file the script writes is the contract, the session's own prose is not.

- [x] **Step 4: Add the permanent ungated probes.**
  In `test-supervisor-e2e.sh`, one probe where the double writes a `final-report.md` but no verdict
  file — the supervisor must park, not exit `0` — and one where a well-formed `PASS` verdict file is
  present, which must exit `0`. Both drive the real composition root against a bare home.

- [x] **Step 5: Prove it.**

  ```bash
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: at least 1068 passing and 0 failing; `tsc` exits `0`; the e2e suite reports `0 failed`
  with both new probes passing; and G3's reproduction assertions now pass, leaving only G5 failing.

- [x] **Step 6: Commit** — `fix(supervisor): require verify-shipped's own verdict file to close`.

## Task 11: G5 — the reader reads where the gate writes

**Contract:** spec §6. **Depends on:** Task 10. **Model: `opus`** — choosing the single path with
no fallback, and deciding what to export for the test, is judgment inside the task.

**Files:** edit `plugins/tribe/scripts/runner/core/supervisor/loop.ts` and
`core/supervisor/loop.test.ts`.

- [x] **Step 1: Write the failing unit test first.**
  Export `readGapGateOpenIds` and assert it finds a report written under the **campaign** home, and
  that a report under the base tribe home is **not** consulted. Over-checking here is by design: one
  path, no silent fallback, because a reader that quietly tries a second directory is how this
  defect reproduces.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/supervisor/loop.test.ts
  ```

  Expected: fails — the reader still joins against the base home.

- [x] **Step 2: Fix the reader.**
  `readGapGateOpenIds` joins against `homeDir`, the campaign home it is already given.
  `buildOneShotPrompt` stops calling `io.resolveTribeHome` for this purpose. Update the module doc
  comment, which currently quotes the now-corrected `SKILL.md` sentence, so the code and its own
  citation agree.

- [x] **Step 3: Prove it.**

  ```bash
  grep -n "resolveTribeHome" plugins/tribe/scripts/runner/core/supervisor/loop.ts
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  ```

  Expected: the grep shows no remaining gap-gate use of the base home; at least 1068 passing and 0
  failing; `tsc` exits `0`; and the reproduction suite now reports `0 failed` — every defect on the
  card is reproduced-then-fixed.

- [x] **Step 4: Commit** — `fix(supervisor): read gap-gate results from the campaign home`.

## Task 12: G5 — the two documentation lines the fix falsifies `[Q1]`

**Contract:** spec §6 and §10 Q1. **Depends on:** Task 11. **Model: `sonnet`** — two sentence
edits with their replacement content specified.

> `[Q1]` — the card's fence names "the spec/ADR/C3 docs these touch" and does not name these two
> files literally. The assumption planned under is that correcting a documentation line the code fix
> makes false is in scope. If the Shaman rules otherwise, drop this task; nothing else depends on it.

**Files:** edit `plugins/tribe/skills/orchestrate-campaign/SKILL.md` and
`plugins/tribe/agents/warchief.md`.

- [x] **Step 1: Check the docs wall first.**
  `test-supervisor-docs.sh` holds byte-exact walls over some `SKILL.md` strings. Run it before
  editing and note which strings are walled, so the edit does not break one.

  ```bash
  bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
  ```

  Expected: `43 passed, 0 failed`.

- [x] **Step 2: Correct both sentences.**
  `SKILL.md`'s Stage D step 2 sentence names the **campaign** home, with the reason recorded inline:
  the gate globs its Tracker-report inputs from the same home, and a campaign card's Tracker reports
  are written under the campaign home. `agents/warchief.md`'s gap-gate invocation gains one sentence
  saying that inside a campaign, the home passed to the gate is the campaign home the dispatch
  named, not the base home.

- [x] **Step 3: Prove it.**

  ```bash
  bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
  grep -n "base-home" plugins/tribe/skills/orchestrate-campaign/SKILL.md
  ```

  Expected: still `43 passed, 0 failed`, and the grep no longer reports the gap-gate line.

- [x] **Step 4: Commit** — `docs(campaign): name the campaign home as the gap-gate location`.

## Task 13: Phase 2 governance reconciliation

**Contract:** spec §11. **Depends on:** Task 12. **Model: `opus`** — authoring patches against a
frozen component is judgment.

**Files:** `.c3/` entities, through the wrapper CLI only.

- [x] **Step 1: Author the patches against `c3-215`.**
  Now that Phase 2's code exists, author the change-unit patches the ADR from Task 5 describes.

  ```bash
  C3="$(ls -d ~/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3)"
  C3X_MODE=agent bash "$C3/bin/c3x.sh" change new adr-supervisor-hardening
  C3X_MODE=agent bash "$C3/bin/c3x.sh" change status adr-supervisor-hardening
  ```

  Expected: the unit scaffolds, and `change status` lists each patch with its target and scope. Do
  not repair the three older 2026-09-19 units' pre-existing drift — spec §11 records that as a
  follow-up, and it is not this card's damage.

- [x] **Step 2: Accept, apply, validate.**

  ```bash
  C3X_MODE=agent bash "$C3/bin/c3x.sh" change accept adr-supervisor-hardening
  C3X_MODE=agent bash "$C3/bin/c3x.sh" change apply adr-supervisor-hardening
  C3X_MODE=agent bash "$C3/bin/c3x.sh" check
  ```

  Expected: `ok: true`. If `apply` reports drift on this card's own patches, rebase them through the
  CLI and re-apply.

- [x] **Step 3: Commit** — `docs(c3): reconcile c3-215 with the supervisor-hardening fixes`.

---

# Phase 3 — Pay the `rule-one-parser-per-edge-shape` debt (G4)

## Task 14: One named parser for a caught filesystem error's `code`

**Contract:** spec §5(a) and §5(b). **Depends on:** Task 13. **Model: `sonnet`** — a mechanical
refactor under a green suite, with the one intended behavioural difference named for you below.

**Files:** create `plugins/tribe/scripts/runner/core/errno.ts` and `core/errno.test.ts`; edit
`cli/main.ts`, `adapters/cut.ts`, `adapters/watchdog-io.adapter.ts`,
`adapters/supervisor-io.adapter.ts`, `adapters/transcript-io.adapter.ts`.

> **The one intended behavioural difference:** where a bare `(err as { code?: string }).code` cast
> today would read a property off `null` and throw, `errorCode` returns `null` instead. That is a
> strict improvement and the only behaviour this task may change. Anything else that changes is a
> bug — this is a refactor under a green suite.

- [x] **Step 1: Write the failing unit test first.**
  `errorCode(err)` returns the string code for a real `Error` carrying one, `null` for `null`,
  `undefined`, a plain object with no `code`, a string, and a number. It never throws.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/errno.test.ts
  ```

  Expected: fails — the module does not exist.

- [x] **Step 2: Write the parser and swap all fourteen call sites.**
  Two sites carry `G-004`'s exact fingerprint (`cli/main.ts` line 642, `adapters/cut.ts` line 153);
  twelve carry the lower-rigor bare cast (spec §5(b) lists each file and line). Both groups import
  the one parser. The two `'UNKNOWN'` callers keep their own `?? 'UNKNOWN'` at the call site, so
  their behaviour is unchanged.

- [x] **Step 3: Prove it.**

  ```bash
  grep -rln "'code' in err" plugins/tribe/scripts/runner --include="*.ts" --exclude="*.test.ts" | wc -l
  grep -rn "as { code?: string }" plugins/tribe/scripts/runner/adapters | wc -l
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  ```

  Expected: both greps print `0`; `bun test` reports at least 1068 passing and 0 failing; `tsc`
  exits `0`. The first number reaching `0` is the card's G4 ratchet, measured from 2.

- [x] **Step 4: Commit** — `refactor(runner): narrow a caught error's code in one place`.

## Task 15: The escalation-file shape's third read site

**Contract:** spec §5(d). **Depends on:** Task 14. **Model: `sonnet`** — a single call-site swap
onto a parser Task 6 already built and tested.

**Files:** edit `plugins/tribe/scripts/runner/core/report.ts` and `core/report.test.ts`.

- [x] **Step 1: Confirm the shape is identical, then write the failing test.**
  `report.ts`'s `extractQuestionDigest` (lines 130 to 135) reads the same `**Reason:**` line and
  `## Context` section the new parser reads. Add a test asserting the digest is unchanged for the
  cases the existing tests cover, plus one asserting it goes through `core/escalation.ts` rather
  than its own regexes. If the shapes turn out **not** to be identical, stop and report rather than
  forcing them together — a shared parser over two different shapes is worse than two parsers.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/report.test.ts
  ```

  Expected: the new assertion fails; every existing digest assertion still passes.

- [x] **Step 2: Swap the call site.**
  `extractQuestionDigest` keeps its own signature and its own digest-joining behaviour — only the
  parsing moves. `## Context`'s first line is what the digest uses today; preserve that exactly.

- [x] **Step 3: Prove it.**

  ```bash
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  ```

  Expected: at least 1068 passing, 0 failing, `tsc` exit `0`.

- [x] **Step 4: Commit** — `refactor(runner): read the escalation shape through one parser`.

## Task 16: The supervisor reads `campaign-state.json` through the schema

**Contract:** spec §5(c). **Depends on:** Task 15. **Model: `sonnet`** — the schema to reuse and
the non-throwing entry point are both named.

**Files:** edit `plugins/tribe/scripts/runner/core/supervisor/loop.ts` and
`core/supervisor/loop.test.ts`.

- [x] **Step 1: Write the failing test first.**
  Assert that a `campaign-state.json` whose `ownerOnlyEscalations` holds a non-string entry, and one
  whose `cards.c1.spec` is a number, are both rejected as a whole rather than half-accepted — the
  drift the rule exists to stop. Assert that a malformed or absent file yields empty results and
  **never throws**, because a throw reaching the tick loop is what `fail-closed-edges.md` forbids.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/supervisor/loop.test.ts
  ```

  Expected: fails — today the two inline readers accept each half independently.

- [x] **Step 2: Add one private reader and route both sites through it.**
  `readCampaignState(io, homeDir)` does `JSON.parse` inside a narrow `try` and then
  `CampaignStateSchema.safeParse`, returning `null` on either failure. Use `safeParse`, not
  `parseState`: `parseState` throws referential-integrity errors. `readOwnerOnlyEscalations` (line
  327) and `readCardSpecPlan` (line 522) both read off that one parsed value. **`core/state.ts` is
  imported, never edited** — the fence holds.

- [x] **Step 3: Prove it.**

  ```bash
  grep -n "CampaignStateSchema" plugins/tribe/scripts/runner/core/supervisor/loop.ts
  grep -c "JSON.parse(raw)" plugins/tribe/scripts/runner/core/supervisor/loop.ts
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
  ```

  Expected: the schema is imported; the count of raw parses drops by two; at least 1068 passing and
  0 failing; `tsc` exits `0`; the e2e suite reports `0 failed`.

- [x] **Step 4: Commit** — `refactor(supervisor): read campaign state through its own schema`.

## Task 17: FU-CS-1 — `autoAnswerRounds`, documented as vestigial

**Contract:** spec §7. **Depends on:** Task 16. **Model: `sonnet`** — the decision is already made
in the spec; this task carries it out.

**Files:** edit `plugins/tribe/scripts/runner/core/report.ts`, `core/report.test.ts`,
`core/supervisor/model.ts`, `core/supervisor/loop.ts`.

> The field is declared in `core/types.ts` and `core/state.ts`, which the fence marks read-only, so
> deleting it is off the table and incrementing it is an owner-only data-shape decision. The Shaman
> pre-ruled the remaining option: document it as vestigial and make the report say so.

- [x] **Step 1: Write the failing test first.**
  Assert the rendered campaign report no longer prints a permanently-zero `- Auto-answer rounds: 0`
  line, and instead states the field's real status.

  ```bash
  cd plugins/tribe/scripts/runner && bun test core/report.test.ts
  ```

  Expected: fails — the current line is rendered.

- [x] **Step 2: Render it honestly, and comment the read sites.**
  Change the one line in `core/report.ts` (line 307). Add a comment naming the field vestigial, with
  a pointer to the spec's §7, at `core/supervisor/model.ts` line 69 and `core/supervisor/loop.ts`
  line 375. Change no behaviour — nothing consults the value.

- [x] **Step 3: Prove it.**

  ```bash
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  git diff --name-only | grep -c "core/types.ts\|core/state.ts"
  ```

  Expected: at least 1068 passing, 0 failing, `tsc` exit `0`, and the last grep prints `0` —
  proving the fence held.

- [x] **Step 4: Commit** — `docs(runner): mark autoAnswerRounds vestigial in the report`.

## Task 18: Phase 3 governance reconciliation

**Contract:** spec §11. **Depends on:** Task 17. **Model: `sonnet`** — validating and recording a
parser inventory, against patches Task 13 already shaped.

**Files:** `.c3/` entities, through the wrapper CLI only.

- [x] **Step 1: Record the four named parsers and validate.**

  ```bash
  C3="$(ls -d ~/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3)"
  C3X_MODE=agent bash "$C3/bin/c3x.sh" check --rule rule-one-parser-per-edge-shape
  C3X_MODE=agent bash "$C3/bin/c3x.sh" check
  ```

  Expected: `ok: true` from both. If the rule-scoped check reports entities citing the rule that are
  now stale, patch them through the change unit rather than editing them.

- [x] **Step 2: Commit** — `docs(c3): record the runner's named edge parsers`.

---

# Phase 4 — The real-model proofs, and the evidence

## Task 19: The permission probe asserts the tools were CALLED

**Contract:** card item 6. **Depends on:** Task 18. **Model: `sonnet`** — the defect and the fix
are both fully stated.

**Files:** edit `plugins/tribe/scripts/tests/test-supervisor-permission-real.sh`.

> The current `(e)/(f)` assertion is "Grep and Glob were never denied", which passes when the model
> never calls them at all — a vacuous pass. It must assert they were actually **called**.

- [ ] **Step 1: Make the calls observable.**
  A denial list cannot prove a call happened. Capture the session's tool-use messages — the probe
  already writes the session result JSON — and assert `Grep` and `Glob` each appear as an attempted
  tool use, **and** that neither appears in `permissionDenials`. Both halves are needed: the first
  proves the probe exercised the grant, the second proves the grant held.

- [ ] **Step 2: Prove it, opt-in.**
  This suite is billed and stays gated behind `TRIBE_REAL_E2E=1`.

  ```bash
  bash plugins/tribe/scripts/tests/test-supervisor-permission-real.sh
  TRIBE_REAL_E2E=1 bash plugins/tribe/scripts/tests/test-supervisor-permission-real.sh
  ```

  Expected: the first prints its skip message and exits `0`; the second reports `0 failed` with the
  `(e)/(f)` assertions now proving both halves. If the model genuinely does not call `Grep` or
  `Glob`, that is a real failure of the probe's prompt — strengthen the prompt, never weaken the
  assertion back to a vacuous one.

- [ ] **Step 3: Commit** — `test(supervisor): assert the granted read tools were actually called`.

## Task 20: The real Haiku E2E proves the verdict script executed

**Contract:** card G3's oracle. **Depends on:** Task 19. **Model: `sonnet`** — one assertion added
to an existing gated suite.

**Files:** edit `plugins/tribe/scripts/tests/test-supervisor-real-e2e.sh`.

- [ ] **Step 1: Add the assertion.**
  After the real closing session, assert `<home>/supervisor/verdicts/<card>.json` exists for the
  shipped card, parses as JSON, and carries a `card` field matching that card and a recognised
  `verdict` value. This is the card's "the real Haiku E2E re-run shows the script executed".

- [ ] **Step 2: Prove it, opt-in.**

  ```bash
  bash plugins/tribe/scripts/tests/test-supervisor-real-e2e.sh
  TRIBE_REAL_E2E=1 bash plugins/tribe/scripts/tests/test-supervisor-real-e2e.sh
  ```

  Expected: the first prints its skip message and exits `0`; the second reports `0 failed`, with the
  new verdict-file assertion passing and the existing ratchet step still writing ceilings that do
  not rise. If a ceiling would rise, **stop and report** — raising it is forbidden without a ruling
  id.

- [ ] **Step 3: Commit** — `test(supervisor): assert the closing session ran verify-shipped`.

## Task 21: Final ratchet verification and the evidence document

**Contract:** the Global Constraints ratchet table, and spec §9. **Depends on:** Task 20.
**Model: `opus`** — judging whether every ratchet genuinely held, and writing the before-and-after
the PR body will carry, is judgment.

**Files:** create `docs/superpowers/evidence/2026-09-19-supervisor-hardening.md`.

- [ ] **Step 1: Re-measure every ratchet and record the real output.**

  ```bash
  cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
  cd - && grep -rln "'code' in err" plugins/tribe/scripts/runner --include="*.ts" --exclude="*.test.ts" | wc -l
  git diff origin/master -- docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json
  TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh
  bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
  bash plugins/tribe/scripts/tests/test-supervisor-ratchet.sh
  bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
  bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
  ```

  Expected: at least 1068 passing with 0 failing; `tsc` exit `0`; the fingerprint count `0`; an
  **empty** diff on the ratchet JSON; and `0 failed` from every suite. Paste the real output, not a
  summary of it.

- [ ] **Step 2: Write the before-and-after.**
  For each of G1 through G5, the spec §9 reproduction output as BEFORE and the same command's
  output now as AFTER. This document is what the PR body's evidence section points at, so every
  claim in it must be a command's real output.

- [ ] **Step 3: Commit** — `docs(supervisor): evidence for the supervisor-hardening card`.

---

## Campaign state file — what this card's entry needs

| Field | Value |
| --- | --- |
| `spec` | `docs/superpowers/specs/2026-09-19-supervisor-hardening-design.md` |
| `plan` | `docs/superpowers/plans/2026-09-19-supervisor-hardening.md` |
| `branch` | `feat/supervisor-hardening` |
| `baseSha` | `7a6a46995137fa0bb935dc4f617c567e130796f5` |

**`schemaLockPaths`** — recommend
`plugins/tribe/scripts/runner/core/types.ts,plugins/tribe/scripts/runner/core/state.ts`. Those are
exactly the two files the card's fence marks read-only, and a schema lock turns the fence into a
mechanical preflight check instead of a rule the implementer must remember. This plan declares no
`allowsSchemaChange`, because it changes neither file.

**`docsOnlyPaths`** — recommend `docs/superpowers/`. Tasks 5, 13, 18 and 21 touch documentation and
the architecture model only, and marking the docs tree lets the runner treat those tasks'
verification accordingly without weakening any code task's gates.
