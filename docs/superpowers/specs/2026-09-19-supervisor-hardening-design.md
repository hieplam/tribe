# Supervisor hardening — design

**Card:** `supervisor-hardening` (`~/.tribe/-Users-hip-repo-tribe/cards/supervisor-hardening.md`)
**Author:** Warchief, 2026-09-19 (planning-only dispatch, campaign orchestration Stage A)
**Branch:** `feat/supervisor-hardening`, based on `origin/master` at `7a6a469`
**Plan:** `docs/superpowers/plans/2026-09-19-supervisor-hardening.md`

## 0. What this is

PR #152 shipped the campaign supervisor with every gate green. Five defects survived those
gates, and they share one shape: **a green test proved a part, and nothing proved the wiring.**
The unit test for `renderNeedsOwner` passes a populated question the only production caller never
produces. The unit test for `reviseCeiling` proves the function refuses an unjustified raise, and
no caller ever asks it. The postcondition for a closing session proves a file is non-empty, and
never that the script whose verdict the file claims to carry was ever executed.

This card closes those five. The rule it is built on — the owner's, quoted verbatim from
`~/.claude/CLAUDE.md` — is:

> "Bug fixes start by reproducing the bug in an E2E setting as closely aligned with how an end
> user would experience it as possible — find the real problem so the fix actually solves it."

So every defect below carries a **reproduction I ran myself** against a bare `mktemp` home
(`fixtures-mirror-reality.md` rule 2), its observed output recorded verbatim in §9, before any fix
is designed. The plan's Phase 1 lands those reproductions as failing tests *before* Phase 2 fixes
anything. A fix that makes a test green without changing the wiring the defect lives in is a bug,
not a fix — that is exactly how these five shipped.

**Measurement baseline**, taken on this branch at `7a6a469` with runner dependencies installed
(`bun install` in `plugins/tribe/scripts/runner`):

| Measure | Value | How |
| --- | --- | --- |
| Runner test suite | **1068 pass / 0 fail**, 46 files, 2695 `expect()` calls | `cd plugins/tribe/scripts/runner && bun test` |
| Typecheck | clean, exit `0` | `bunx tsc --noEmit` |
| `G-004` fingerprint | **2 files** | `grep -rln "'code' in err" plugins/tribe/scripts/runner --include="*.ts" --exclude="*.test.ts"` |
| Committed context ceilings | `ruling: 27534`, `ratify: 0`, `closing: 93443`, `doorbell: 0` | `docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json` |

Those four are the card's ratchets. The test count may not fall below 1068; the ceilings may not
rise; the fingerprint must reach 0; the typecheck stays clean.

> **Discrepancy, recorded (card vs. code, code wins):** a fresh worktree reports `796 pass / 5
> fail / 5 errors` until `bun install` is run inside `plugins/tribe/scripts/runner` — the five
> "failures" are one unresolved `zod` import from `core/state.ts`, not defects. Every plan task's
> acceptance command therefore assumes dependencies are installed, and Task 1 installs them.

## 1. The governing constraints this design is built on

Quoted verbatim, with their sources, because a paraphrased constraint is a new claim
(`brief-contracts.md` obligation 3).

**`pure-core.md`**, the design golden standard:

> "core logic never constructs or reaches out for its dependencies; it receives them."

Every new decision in this card is a pure function over strings that the caller has already read.
No new module reads a file, a clock, or a subprocess result; the three that must touch the world
(`verify-shipped.sh`, the ratchet edge script, the supervisor loop) are existing or deliberately
thin edges.

**`fail-closed-edges.md`** obligation 1:

> "Wrap external input in the *specific* exceptions it can raise … and convert each to a typed
> refusal. Never `except Exception`, and never let a traceback escape into a git hook or a CLI."

Every new parser below degrades to a typed absent/`null` value, never a throw reaching the
supervisor's tick loop.

**`fixtures-mirror-reality.md`** rule 2:

> "Before writing lifecycle code, run it against an empty fixture."

§9 is that run, performed before this spec's fixes were designed.

**`rule-one-parser-per-edge-shape`** (C3, `active`; read with
`C3X_MODE=agent bash <c3-skill-dir>/bin/c3x.sh read rule-one-parser-per-edge-shape`), its Rule
section verbatim:

> "Each external shape an edge reads is narrowed by exactly one named parser that all of that
> shape's read sites import, never re-derived inline at a second site."

Its own Golden Example is `plugins/tribe/scripts/runner/core/state.ts`. G4 is the card that pays
this rule's debt, and §5 below is its inventory.

**`orchestrate-campaign/SKILL.md`** Stage D step 2, line 547, verbatim — the sentence G5 proves is
false in a campaign:

> "card, read `<base-home>/reports/<card>-gap-gate.json` (where `<base-home>` is"

**`brief-contracts.md`**, the sequencing rule:

> "governance work belongs at the end of each phase, not the end of the project."

Hence a C3 reconciliation task closes every phase of the plan, rather than one at the end.

## 2. G1 — a card-scoped park never shows the owner the question

### The reproduction (run: §9.1)

A campaign whose single escalated card carries an owner-only reason, run to a park against a bare
`mktemp` home. The escalation file on disk says:

```
**Reason:** needs-a-product-call

## Context
CONTEXT-MARKER-4f2a9b — the owner must see THIS paragraph to rule on the question.
```

`supervise` exits `20` and writes `NEEDS_OWNER.md`, whose question section reads, in full:

```
## The question (when a card is parked)
(not applicable — this park is not about one card's escalation)
```

Occurrences of `CONTEXT-MARKER-4f2a9b` in `NEEDS_OWNER.md`: **0**. The one document a parked
campaign hands the owner does not contain the question.

### Root cause, in the wiring

`core/supervisor/status.ts:227` declares the field correctly:

```ts
  question: { reasonLine: string; context: string } | null;
```

and `renderNeedsOwner` (`status.ts:259-261`) renders it correctly. Its **only** production caller,
`core/supervisor/loop.ts:962`, passes `question: null` — a literal, in the `park` branch, one line
below a `cardIdHint` the same branch has already computed correctly (`loop.ts:955`). So every
card-scoped park renders "(not applicable …)" while the very next section of the same document
says "Rule on `<card>`'s question yourself". The loop already holds everything needed: it reads the
escalation file's content every tick in `buildEscalationFacts` (`loop.ts:368`) and already extracts
its `**Reason:**` line with `extractReasonLine` (`loop.ts:321`). It simply never carries the
result into the park document.

The card's own check confirms the count: `grep -n "question: null" …/loop.ts` → **1 hit**, at line
962.

### The fix

One named parser for the escalation-file shape, and a `park` branch that uses it.

`core/escalation.ts` (new, pure — no fs, no clock) exports:

```ts
export interface EscalationQuestion { reasonLine: string; context: string }
export function parseEscalationQuestion(content: string): EscalationQuestion | null;
```

It returns `null` for content carrying neither a `**Reason:**` line nor a `## Context` section;
otherwise it returns both, with `context` being the `## Context` section body verbatim (the heading
line through the line before the next `## ` heading, or end of content — the same block-partition
convention `verify.ts#blocksById` and `loop.ts#extractRulingBlockVerbatim` already use). It never
throws.

`loop.ts`'s `park` branch reads the escalation file for `cardIdHint`'s card and passes the parsed
result as `question`, `null` only when there is no card-scoped escalation to read.

This module is deliberately placed at `core/escalation.ts`, not under `core/supervisor/`, because
it has **three** read sites, not two, and one of them is outside the supervisor (§5).

### The oracle

`test-supervisor-e2e.sh`'s park path (probe 3) asserts that the rendered `NEEDS_OWNER.md` contains
the escalation's own `## Context` text — the card's G1 row verbatim. Against today's code that
assertion fails; that failing assertion is the plan's Task 2.

### The postcondition

`grep -c "question: null" core/supervisor/loop.ts` → `0`, and probe 3 green.

## 3. G2 — the ratchet does not ratchet

### The reproduction (run: §9.4)

Hand-edit the committed ratchet file, raising `ruling` from `27534` to `999999` with no `raisedBy`
anywhere, and run every gate:

| Gate | Result with the unjustified raise in place |
| --- | --- |
| `bun test core/metrics/ceiling.test.ts` | 12 pass, 0 fail |
| `bunx tsc --noEmit` | clean, exit `0` |
| `test-supervisor-docs.sh` | 43 passed, 0 failed |

Every gate green. `grep -rln "supervisor-ratchet" plugins` names exactly one file:
`core/metrics/ceiling.test.ts` — the function's own test. `reviseCeiling` has **no caller outside
its own test**, so the card's G0 promise that the ceiling "only moves in the good direction" is
enforced by nothing.

### Root cause, in the wiring

`core/metrics/ceiling.ts:57` is a correct pure predicate, and correctly documented as awaiting a
caller: its own module header says the edge that reads the ratchet JSON is *"an edge concern for
whichever later task wires this into the checker"*. That later task never landed. There is no
comparison against a prior version of the file anywhere, so "raising" is not even a concept any
gate can observe — a gate that only reads the current file sees one number and has nothing to
compare it to.

### The fix — pure core, thin edge, fixture-driven gate

**The enforcement point is a new shell test, `plugins/tribe/scripts/tests/test-supervisor-ratchet.sh`,
driving a new thin edge script over a new pure checker.** That test file location is the
enforcement point precisely because `pre-gate.sh` enumerates suites by glob
(`for t in "$TESTS_DIR"/test-*.sh`), so a new `test-*.sh` is swept automatically by the gate every
audit round already runs — no wiring step that can be forgotten.

Three pieces:

1. **Pure core** — `core/metrics/ratchet-gate.ts`:

   ```ts
   export interface RatchetFailure { kind: string; oldValue: number; proposed: number; reason: string }
   export function checkRatchetRevision(baseJson: string, headJson: string):
     { ok: boolean; failures: RatchetFailure[] };
   ```

   Two file **contents** in, a verdict out. No fs, no git, no clock. It parses both (fail-closed:
   an unparseable head is a failure, an unparseable/absent base means "no prior version", which is
   the initial-measurement case `reviseCeiling` already handles with `oldValue === 0`), then calls
   the existing `reviseCeiling(oldValue, proposed, raisedBy)` **once per ceiling kind**. The
   existing function is not modified; this card gives it the caller it was written for.

2. **The `raisedBy` shape.** The ratchet file gains one optional top-level object, keyed by the
   same kind names as `ceilings`:

   ```json
   {
     "v": 1,
     "ceilings": { "ruling": 27534, "ratify": 0, "closing": 93443, "doorbell": 0 },
     "raisedBy": { "ruling": "R7-2026-09-20-context-headroom" }
   }
   ```

   Absent, or absent for a given kind, reads as `null` — exactly the argument `reviseCeiling`
   already refuses a raise on. The card mandates this concept ("a fixture commit that raises
   `ruling` from 27534 with no `raisedBy` must fail"), so it is settled, not an open question. The
   committed file is **not** edited by this card: no ceiling is raised, so no `raisedBy` is needed
   yet, and adding an empty one would be noise.

3. **Thin edge** — `plugins/tribe/scripts/ratchet-check.ts`:

   ```
   bun ratchet-check.ts --repo <dir> --base <ref> [--path <ratchet-path>]
   ```

   Its only jobs are `git -C <repo> show <base>:<path>` (the merge-base version), reading the
   working-tree version, handing both strings to `checkRatchetRevision`, printing failures, and
   exiting `0`/`1`. Per `fail-closed-edges.md` obligation 3 every `git` call carries a timeout, and
   per obligation 2 it neutralises `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` so a host's `commit.gpgsign`
   cannot change a verdict inside the test's own throwaway repo.

**The merge-base version is what it compares against**, not `HEAD~1`: a branch that raises a
ceiling in its first commit and is then rebased must still be caught, and a branch that merely
*contains* master's history must not be flagged for master's own past raises.

### The oracle

`test-supervisor-ratchet.sh`, against a throwaway `mktemp` git repo built from nothing, asserts
three cases:

| Fixture commit | Expected |
| --- | --- |
| base `ruling: 27534` → head `ruling: 999999`, no `raisedBy` | exit `1`, message names `27534`, `999999`, and `raisedBy` |
| base `ruling: 27534` → head `ruling: 999999`, `raisedBy.ruling` set | exit `0` |
| base `ruling: 27534` → head `ruling: 20000` (a lowering) | exit `0` |

Plus one case against the **real** repo and its real merge base, asserting exit `0` — the gate that
now actually protects the committed file.

### The postcondition

`bash plugins/tribe/scripts/tests/test-supervisor-ratchet.sh` green, and a hand-edited raise in the
committed file turns it red. §9.4's exact reproduction, re-run after the fix, must flip from "every
gate green" to "this gate red".

## 4. G3 — the closing verdict is the model's prose

### The reproduction (run: §9.2)

A campaign driven to a closing session against a bare `mktemp` home. `supervise` exits **0** — the
campaign is CLOSED. The entire basis of that verdict is a file the session itself wrote:

```
# Campaign report

Everything shipped. (session double, kind=closing, attempt=2)
```

Verdict files anywhere under the campaign home: **none**. Session logs mentioning `verify-shipped`:
**none**. And the postcondition accepts anything non-empty — called directly:

```
verifyClosing({ finalReport: "# Final report\n\nStatus: BLOCKED — I could not verify anything.\n", answers: "" })
  => {"outcome":"closed","retryable":true}
```

A report that says **BLOCKED** closes the campaign. That is Task 20's real-run defect
(session `5e38144f-7aaa-4505-96c7-d0e7503f6f79`) reproduced mechanically in one call.

**FU-CS-4, same reproduction:** `SKILL.md` lines 41 and 66 tell the model to run
`bash ~/.claude/skills/verify-shipped/scripts/verify-shipped.sh`. That path does not exist when the
skill is loaded as a plugin — which is exactly how the closing session loads it
(`session.ts:133`, `options.plugins = [{ type: 'local', path: config.verifyShippedPluginDir }]`).
The measured `ls` of that path: `No such file or directory`.

### Root cause, in the wiring

`core/supervisor/verify.ts:200-210`, `verifyClosing`, checks exactly two things: the report is
non-empty, and no ruling is unratified. Nothing in the supervisor ever asks whether the script ran.
The closing brief names the skill; the skill's own documented command names a path that does not
exist under a plugin load; and no postcondition notices either failure. Three independent links,
none of which is checked.

### The fix

**The verdict must be an artifact the script produced, never prose the model wrote.**
(`brief-contracts.md`: *"Prose persuades; artifacts get run."*)

**(a) The verdict file — contract.** Per the Shaman's pre-ruling this is a new on-disk shape under
the campaign home, changing neither `campaign-report.json` nor `campaign-state.json`, and therefore
a Shaman call, already made.

- **Path:** `<campaign-home>/supervisor/verdicts/<cardId>.json`, one file per shipped card.
- **Why there:** the supervisor's write surface (S-P5) is `<home>/supervisor/**`,
  `<home>/NEEDS_OWNER.md`, and the escalation rename. `<home>/supervisor/verdicts/` is inside it,
  so `test-supervisor-e2e.sh`'s write-surface probe (probe 6) keeps holding without being widened,
  and the closing session — which carries `Bash` and `Write` in its R11 grant
  (`session.ts:42`, `CLOSING_ALLOWED_TOOLS`) and no containment hook — can write it.
- **Shape:** byte-identical to what `verify-shipped.sh` already prints on stdout. The script gains
  **one flag**, `--verdict-out <path>`, and writes that same JSON there (temp file + rename, so a
  reader never sees a half-written file). Nothing about the four checks, the exit codes, or the
  stdout contract changes.
- **Who writes it:** `verify-shipped.sh` itself, never the model. The model's only job is to invoke
  the script with the path the brief names.

**(b) The postcondition.** `verifyClosing` gains one input and stays pure:

```ts
export interface VerifyClosingInput {
  finalReport: string | null;
  answers: string;
  /** One entry per card the campaign report marks `shipped`: the verdict file's raw contents,
   * or `null` when the file does not exist. Read by the caller; parsed here. */
  shippedVerdicts: Array<{ cardId: string; raw: string | null }>;
}
```

It parses each `raw` narrowly and fail-closed, and returns `failed` with a typed `reason` for:

| Condition | `reason` |
| --- | --- |
| no file for a shipped card | `verdict_missing:<cardId>` |
| unparseable, or missing `card`/`verdict` | `verdict_malformed:<cardId>` |
| `card` does not equal `<cardId>` | `verdict_card_mismatch:<cardId>` |
| `verdict` is not `PASS` | `verdict_fail:<cardId>` |

Only when every shipped card has a present, well-formed, matching, `PASS` verdict does it return
`closed`.

**Why a `FAIL` verdict reuses the ordinary `failed` outcome rather than a new non-retryable one.**
The two integrity outcomes (`history_rewritten`, `ratify_out_of_scope`) exist because a session
*corrupted the ruling trail* — an offence of the session, never retried. A `FAIL` verdict is a true
statement about the *card*, and the honest response is the existing bounded-retry-then-park path:
one retry (cheap, and it genuinely helps for the `verdict_missing` case, which is the common one —
the session forgot to run the script), then `park(closing_failed)`, whose existing owner sentence
already reads *"Review `{home}/supervisor/sessions/` for the closing session's log, finish the
closing report by hand…"*. This keeps `ParkReason`'s frozen 22-value union and `PARK_SENTENCES`
untouched, which is worth more than saving one retry.

**(c) The brief.** `core/supervisor/brief.ts`'s closing template and `ClosingBriefFacts` gain the
per-card verdict path and the exact command to run, so the session is told the path rather than
inventing one. Per `brief-contracts.md` obligation 1 the brief names its oracle: **the verdict file
the script writes is the contract; the session's own prose is not.**

**(d) FU-CS-4.** Follow the repo's own precedent exactly. `plugins/tribe/skills/orchestrate-campaign/`
ships `resolve-runner.sh` beside its `SKILL.md`, and its `SKILL.md` says, verbatim:

> "**Do not hand-write the resolution — run the bundled resolver.** It ships beside this file, so
> `<skill-dir>` is the base directory announced when this skill loaded"

and explains why a script rather than a line of shell: *"the expression this replaced failed
**open**."* So `plugins/verify-shipped/skills/verify-shipped/resolve-verify-shipped.sh` is added
with the same two-tier contract — `$CLAUDE_PLUGIN_ROOT` first (which is exactly what a local-plugin
load sets), then `cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P` to locate itself — printing an
absolute proven path on stdout and exiting `3` with a named diagnostic on stderr otherwise. It
never prints a path it has not proven exists. `SKILL.md`'s two `~/.claude/skills/...` lines are
replaced with the resolver form.

### The oracle

Two, one free and one billed:

- **Free (every run):** `test-supervisor-e2e.sh` grows a closing probe whose double writes a
  `final-report.md` but no verdict file — the supervisor must park rather than exit `0`; and a
  second probe where a well-formed `PASS` verdict file is present, which must exit `0`. Plus unit
  tests over `verifyClosing`'s five rows and over `verify-shipped.sh --verdict-out`.
- **Billed, opt-in (`TRIBE_REAL_E2E=1`):** `test-supervisor-real-e2e.sh` asserts the verdict file
  exists on disk after the real Haiku closing session — i.e. the script actually executed. This is
  the card's "the real Haiku E2E re-run shows the script executed".

### The postcondition

`verifyClosing` with a `BLOCKED`-bodied report and no verdict file returns `failed`, not `closed`;
the free probes green; `resolve-verify-shipped.sh` prints an existing absolute path under a
plugin-style load.

## 5. G4 — `rule-one-parser-per-edge-shape` violations in the runner

### The inventory, measured by me (run: §9.5)

**(a) The recorded fingerprint, `G-004`.** Its own ledger line, verbatim from
`.tribe/harness-gaps.jsonl`:

```
{"id":"G-004","event":"opened","category":"error-handling","paths":["plugins/tribe/scripts/runner","adapters/cut.ts","cli/main.ts","plugins/tribe/scripts/runner/cli/main.ts"],"fingerprint":"grep -rln \"'code' in err\" plugins/tribe/scripts/runner --include=\"*.ts\" --exclude=\"*.test.ts\"","hits_at_detection":2,"first_seen_pr":0}
{"id":"G-004","event":"ruled","disposition":"rule","ref":"rule-one-parser-per-edge-shape","ratified_by":"shaman"}
```

Running that exact fingerprint today: **2 files**, matching `hits_at_detection`.

| # | Location | The duplicated narrowing |
| --- | --- | --- |
| 1 | `cli/main.ts:642` | `err !== null && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'UNKNOWN'` |
| 2 | `adapters/cut.ts:153` | `const code = err !== null && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'UNKNOWN'` |

Two byte-identical copies of the same guarded expression.

**(b) The bare casts across the adapters** — the same shape at a *lower rigor*, which is precisely
the drift the rule names. Every one of these reads `.code` off a value it never narrowed:

| File | Lines |
| --- | --- |
| `adapters/watchdog-io.adapter.ts` | 45, 69, 80, 115, 127, 219 |
| `adapters/supervisor-io.adapter.ts` | 191, 201, 221, 232 |
| `adapters/transcript-io.adapter.ts` | 119, 129 |

Twelve sites, each `(err as { code?: string }).code`. They do not match `G-004`'s fingerprint (they
do not contain `'code' in err`), which is itself the evidence for the rule: the same shape,
narrowed two different ways, so one fingerprint cannot even see both halves.

**(c) The supervisor's own re-reads of `campaign-state.json`** — the card's second G4 clause.
`core/supervisor/loop.ts` parses that file twice, inline, at two different rigors:

| Function | Line | What it re-derives |
| --- | --- | --- |
| `readOwnerOnlyEscalations` | `loop.ts:327` | `ownerOnlyEscalations`, via raw `JSON.parse` + an `Array.isArray` filter |
| `readCardSpecPlan` | `loop.ts:522` | `cards[cardId].spec` / `.plan`, via raw `JSON.parse` + `typeof` checks |

while `core/state.ts:132` already exports `CampaignStateSchema`, a zod schema carrying
`ownerOnlyEscalations: z.array(z.string())` (`state.ts:139`) and `cards` of a `CardSchema` with
`spec`/`plan` as nullable strings (`state.ts:113-114`) — the rule's **own Golden Example**.

**(d) The escalation-file shape**, found while reproducing G1 — three read sites of one shape:

| Site | Line |
| --- | --- |
| `core/report.ts#extractQuestionDigest` | `report.ts:130-135` (both `**Reason:**` and `## Context`) |
| `core/supervisor/loop.ts#extractReasonLine` | `loop.ts:321` (`**Reason:**` only) |
| the G1 fix's new question site | `loop.ts:962` |

This is why §2's parser lands at `core/escalation.ts` and not under `core/supervisor/` — `report.ts`
must be able to import it without a lower layer depending on a higher one.

### The fix

Four named parsers, each with every read site importing it:

1. **`core/errno.ts`** (new, pure) — `export function errorCode(err: unknown): string | null`.
   One narrowing; `cut.ts:153`, `cli/main.ts:642` and all twelve adapter sites import it. The two
   `'UNKNOWN'` callers keep their own `?? 'UNKNOWN'` at the call site, so no behaviour changes.
2. **`core/escalation.ts`** (new, pure) — §2's `parseEscalationQuestion`, plus a `reasonLine`-only
   convenience the two existing callers use. Three read sites collapse to one parser.
3. **`core/state.ts`'s existing `CampaignStateSchema`** — reused read-only, never edited (the fence
   holds). `loop.ts` gains one private `readCampaignState(io, homeDir): CampaignState | null` that
   does `JSON.parse` inside a narrow `try` and then `CampaignStateSchema.safeParse`, returning
   `null` on either failure. `readOwnerOnlyEscalations` and `readCardSpecPlan` both read off that
   one parsed value. `safeParse` is used rather than `parseState` deliberately: `parseState` throws
   referential-integrity errors, and a throw reaching the supervisor's tick loop is exactly what
   `fail-closed-edges.md` forbids.
4. The `raisedBy`/`ceilings` shape from §3 is parsed once, in `checkRatchetRevision`, by
   construction.

**Direction of error, stated for the implementer** (`brief-contracts.md` obligation 1): these are
refactors under a green suite. **A behaviour change is a bug; a call-site that reads differently
but behaves identically is the goal.** Where a bare cast today would read `.code` off `null` and
throw, `errorCode` returns `null` instead — that is a strict improvement and the only intended
behavioural difference, and it must be called out in the task, not discovered.

### The oracle

The card's own ratchet: the `G-004` fingerprint goes **2 → 0**, `readOwnerOnlyEscalations` and
`readCardSpecPlan` go through `core/state.ts`'s schema, the full runner suite stays at or above
1068 passing, and `bunx tsc --noEmit` stays clean.

### The postcondition

```
grep -rln "'code' in err" plugins/tribe/scripts/runner --include="*.ts" --exclude="*.test.ts" | wc -l   # 0
grep -rn "as { code?: string }" plugins/tribe/scripts/runner/adapters                                   # no hits
grep -n "CampaignStateSchema" plugins/tribe/scripts/runner/core/supervisor/loop.ts                       # >= 1 hit
```

> **Fence note.** `plugins/tribe/scripts/viewer/**` also matches the `'code' in err` text (4 sites
> across `serve.ts`, `adapters/poller.adapter.ts`, `adapters/fs.adapter.ts`), and the viewer fence
> is closed by the card. `G-004`'s fingerprint is scoped to `.../runner`, so those sites are
> **outside** both the fingerprint and the fence. Recorded here as a follow-up, not touched.

## 6. G5 — the closing session looks for gap-gate results in the wrong place

### The path truth, measured (run: §9.3)

`gap-gate.ts:149`:

```ts
  const out = options.out ?? join(options.home, 'reports');
```

So the gate writes `<--out>/<card>-gap-gate.{json,md}` when `--out` is given, and
`<--home>/reports/<card>-gap-gate.{json,md}` otherwise. Run for real against a bare `mktemp` home
with `--home <campaign-home>` and no `--out`, it wrote exactly:

```
<tribe-home>/campaigns/repro-g5/reports/c1-gap-gate.json
<tribe-home>/campaigns/repro-g5/reports/c1-gap-gate.md
```

The supervisor reads a **different directory**, `loop.ts:546`:

```ts
  const raw = io.readFileOrEmpty(join(baseHome, 'reports', `${cardId}-gap-gate.json`));
```

where `baseHome` is `io.resolveTribeHome(config.repoRoot)` (`loop.ts:604`) — the base tribe home,
not the campaign-nested one. For the reproduction campaign those two resolve to:

```
writer: <tribe-home>/campaigns/repro-g5/reports/
reader: <tribe-home>/reports/
```

and `ls` at the reader's path: `No such file or directory`. The reader can never find what the
writer wrote, for any campaign card, ever.

**The historical artifact agrees.** This card's own predecessor wrote its gate report to
`~/.tribe/-Users-hip-repo-tribe/campaigns/campaign-supervisor/audit/campaign-supervisor-gap-gate.json`
— a third location again, produced by an explicit `--out`. Meanwhile non-campaign cards
(`gap-gate-scripts`, `evals-track-shipped-gate`, …) did land in `<base-home>/reports/`. So there
are three locations in play and the reader knows only one of them.

### Root cause, in the wiring

Not a typo — a genuine disagreement about which home a campaign card's artifacts live in, written
down in three places that were never reconciled:

- `gap-gate.ts` globs its **inputs** from `<--home>/reports/tracker-<card>-*.md` (`gap-gate.ts:68`),
  and a campaign card's Tracker reports are written under the **campaign** home — `core/brief.ts:43`,
  `reportPathFor(homeDir, cardId) = join(homeDir, 'reports', …)`, with `homeDir` the campaign home.
  So in a campaign the gate **must** be run with `--home <campaign-home>`, or it finds zero Tracker
  reports and exits `2`.
- Therefore the gate's output lands under the campaign home too.
- But `orchestrate-campaign/SKILL.md:547` and `loop.ts:540-546` both say base home, and
  `agents/warchief.md:1188` tells the Warchief to resolve `HOME_DIR` with
  `tribe-home.sh <target-repo>` — the base home — which in a campaign would make the gate find no
  Tracker reports at all.

The writer's location is forced by where the inputs are. **The reader is the side that is wrong.**

### The fix

Make all three agree on the **campaign home**:

1. `loop.ts#readGapGateOpenIds` reads `join(homeDir, 'reports', …)` — the campaign home it is
   already given — and `buildOneShotPrompt` stops calling `io.resolveTribeHome` for this purpose.
   One path, no fallback: a fallback that silently tries a second directory is how a reader ends up
   disagreeing with a writer again.
2. `orchestrate-campaign/SKILL.md`'s Stage D step 2 sentence is corrected to name the campaign home,
   with the reason recorded inline (the gate's inputs live there).
3. `agents/warchief.md`'s gap-gate invocation gains one sentence: inside a campaign, `--home` is the
   campaign home the dispatch named, not `tribe-home.sh`'s base home.

> **Open question, planned under (see §10, Q1):** items 2 and 3 touch
> `plugins/tribe/skills/orchestrate-campaign/SKILL.md` and `plugins/tribe/agents/warchief.md`,
> which the card's scope fence does not name literally; it allows "the spec/ADR/C3 docs these
> touch". **Assumption taken:** correcting a documentation line that the code fix makes false is
> in scope, because leaving it is how this defect reproduces for the next reader. The affected plan
> tasks are marked `[Q1]`.

### The oracle

The card's G5 row: a test writes a gap-gate report **the way `gap-gate.ts` does** and the closing
brief lists its `open_ids`. Concretely: run the real `gap-gate.ts` against a throwaway repo and a
bare campaign home so the report is produced by the real writer, then assert the rendered closing
brief contains the recorded `open_ids`. `readGapGateOpenIds` is exported for that assertion —
the brief is rendered in-process by `renderBrief`, which is already pure and already unit-tested.

> **Reproduction honesty:** my §9.3 run recorded `open_ids: []` because my throwaway Tracker report
> used a plain bullet list, and the real candidate parser requires the
> `HG-candidate N [category]` header shape (`gap-candidates.ts:35`, `HEADER_RE`). The **path**
> measurement — the whole point of §9.3 — is unaffected and exact. The plan's G5 task must build its
> fixture with the real header shape; that is called out in the task brief.

### The postcondition

`grep -n "resolveTribeHome" core/supervisor/loop.ts` shows no remaining gap-gate use, and the new
test asserts a real gate report's `open_ids` reach the rendered brief.

## 7. FU-CS-1 — `autoAnswerRounds`, fix or delete

**Decision: document as vestigial, and make the report say so.** One paragraph of reasoning, as the
Shaman asked.

The field is declared at `core/types.ts:31` (`autoAnswerRounds?: number`) and validated at
`core/state.ts:126` — **both files the card's scope fence marks read-only** ("Never `core/types.ts`,
`core/state.ts`"). The Shaman's pre-ruling settles the consequence in advance: *"if the field lives
there, the answer is 'document as vestigial and make the supervisor's report say so', not an
edit."* It lives there, so deletion is off the table. Fixing it — actually incrementing it — would
mean the runner writing a new value into `campaign-state.json`, which is a change to a persisted
data shape's *meaning*, and that is owner-only decision authority, not mine. What remains is the
honest option, and it is also the useful one: the number is rendered to the owner today at
`core/report.ts:307` as `- Auto-answer rounds: 0`, permanently zero, indistinguishable from "we
tried zero times" when it actually means "nobody counts this". `core/report.ts` is inside the fence,
so that one line is changed to render the field's real status rather than a number that cannot move,
and the two supervisor read sites (`core/supervisor/model.ts:69`, `loop.ts:375`) gain a comment
naming it vestigial with a pointer to this section. No behaviour depends on the value — it is read
into `EscalationFact.autoAnswerRounds` and never consulted by `decide()`.

## 8. Risks, scope fence, and rollback

### Scope fence (what is explicitly out)

- `core/types.ts`, `core/state.ts` — read-only reuse only. §5 reuses `CampaignStateSchema`; nothing
  edits either file.
- `core/watchdog/**` — untouched.
- `plugins/tribe/scripts/viewer/**` — untouched. FU-CS-2's badge chip is **out of this card** by the
  Shaman's pre-ruling; the viewer's own four `'code' in err` sites are outside `G-004`'s fingerprint
  and stay.
- `ParkReason`'s 22-value union and `PARK_SENTENCES` — untouched (§4 explains why G3 does not need a
  new value).
- No ceiling in the committed ratchet file is raised. Raising one without a ruling id is refused in
  advance (`brief-contracts.md` adjudication rule).

### Risks

| Risk | Mitigation |
| --- | --- |
| §5's refactor changes behaviour silently under a green suite | The suite is the ratchet: 1068 passing before and after, `tsc` clean. The one intended behavioural difference (`errorCode` returning `null` where a bare cast would have thrown on `null`) is named in the task brief, not left to be discovered. |
| §4's stricter postcondition parks campaigns that would have closed | That is the intent — but it makes `park(closing_failed)` reachable in a new way. The free e2e probes cover both the park and the pass path, so the new failure mode is exercised, not merely reasoned about. |
| §6's single-path reader breaks the non-campaign case | The supervisor only ever runs against a campaign home (`--home`/`--campaign` both resolve to one); there is no non-campaign supervisor. Verified by `cli/main.ts`'s `supervise` composition root. |
| §3's edge shells out to `git` inside a test | Timeout on every call and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` neutralised (`fail-closed-edges.md` obligations 2 and 3), so a host's git config cannot change a verdict. |
| The billed `TRIBE_REAL_E2E` proof is skipped in ordinary runs | By design, and both real suites already exit `0` with a skip message when the variable is unset. Every G3 claim has a free oracle too; the billed one only proves the *real model* ran the script. |

### Rollback

Every phase lands independently and is independently revertable: the four parsers (§5) are additive
modules plus call-site swaps; the ratchet gate (§3) is two new files plus one new test; G3 is one
new flag, one new resolver script, one widened pure function; G5 is a one-line reader change plus
two doc lines; G1 is one call-site. Reverting the branch restores `7a6a469` exactly — no data
migration, no persisted shape changes to `campaign-report.json` or `campaign-state.json`, and the
new verdict files live only under a campaign home, which is machine-local and disposable.

## 9. Evidence appendix — my own runs, against a bare `mktemp` home

All four reproductions come from one script run on 2026-09-19 against this branch at `7a6a469`,
with `HOME` overridden to a throwaway `mktemp -d` tree, a throwaway `git init` repo as the target,
`TRIBE_SUPERVISOR_SESSION_DOUBLE` pointing at the committed session double, and every campaign home
assembled from nothing. The committed ratchet file was edited only for §9.4 and restored
byte-for-byte (`git status --porcelain` clean afterwards, verified).

### 9.1 G1 — the park document never shows the question

```
supervise exit: 20
--- the escalation file the owner needs to see:
**Reason:** needs-a-product-call

## Context
CONTEXT-MARKER-4f2a9b — the owner must see THIS paragraph to rule on the question.
--- NEEDS_OWNER.md 'The question' section, as actually rendered:
## The question (when a card is parked)
(not applicable — this park is not about one card's escalation)

## What I already did
--- does NEEDS_OWNER.md carry the escalation's own Context marker?
    occurrences of CONTEXT-MARKER-4f2a9b: 0
--- the hardcoded caller (card check: expect exactly 1 hit):
962:          question: null,
```

### 9.2 G3 — a closing verdict nobody checked

```
supervise exit: 0 (0 == the campaign is CLOSED)
--- the whole basis of the 'closed' verdict, written by the session, checked by nobody:
# Campaign report

Everything shipped. (session double, kind=closing, attempt=2)
--- any verify-shipped verdict file anywhere under the campaign home?
    (empty above == none)
--- did verify-shipped.sh run at all? (its own marker never appears in any session log)
--- verifyClosing accepts a report whose body literally says BLOCKED:
{"outcome":"closed","retryable":true}
--- FU-CS-4: the path SKILL.md tells the model to run:
41:bash ~/.claude/skills/verify-shipped/scripts/verify-shipped.sh --pr <number|url> --worktree <path> --card <slug> [--base master] [--repo owner/repo]
66:$ bash ~/.claude/skills/verify-shipped/scripts/verify-shipped.sh --pr 37 --worktree /tmp/wt-card4 --card card4 --repo hieplam/tribe
    ls: .../home/.claude/skills/verify-shipped/scripts/verify-shipped.sh: No such file or directory
```

### 9.3 G5 — writer and reader name different directories

```
gap-gate exit: 0
--- where gap-gate.ts actually wrote (default --out):
    <tribe-home>/campaigns/repro-g5/reports/c1-gap-gate.json
    <tribe-home>/campaigns/repro-g5/reports/c1-gap-gate.md
--- where the supervisor READS it (loop.ts):
546:  const raw = io.readFileOrEmpty(join(baseHome, 'reports', `${cardId}-gap-gate.json`));
--- the two directories, resolved for this campaign:
    writer (--home passed by a campaign Warchief): <tribe-home>/campaigns/repro-g5/reports/
    reader (resolveTribeHome(repo) + /reports):    <tribe-home>/reports/
--- open_ids the gate recorded:
    {"card": "c1", "open_ids": [], "minted": []}
--- what the reader finds at its own path:
    ls: <tribe-home>/reports/c1-gap-gate.json: No such file or directory
```

(`open_ids` is empty because the throwaway Tracker report used the wrong candidate header shape —
see §6's reproduction-honesty note. The two directory paths, which are what this run measures, are
exact.)

### 9.4 G2 — an unjustified raise passes every gate

```
--- committed ratchet, before:
    {'ruling': 27534, 'ratify': 0, 'closing': 93443, 'doorbell': 0}
--- committed ratchet, after a hand-edited raise (27534 -> 999999, no raisedBy):
    {'ruling': 999999, 'ratify': 0, 'closing': 93443, 'doorbell': 0}
--- git sees the edit:
     docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json | 4 ++--
     1 file changed, 2 insertions(+), 2 deletions(-)
--- gate 1: the ceiling unit test
 12 pass
 0 fail
--- gate 2: typecheck
    tsc: clean (exit 0)
--- gate 3: the supervisor docs wall
    43 passed, 0 failed
--- gate 4: anything at all that reads this file outside its own test?
    .../plugins/tribe/scripts/runner/core/metrics/ceiling.test.ts
```

### 9.5 G4 — the fingerprint, measured now

```
--- G-004's own fingerprint from .tribe/harness-gaps.jsonl:
{"id":"G-004","event":"opened","category":"error-handling","paths":[...],"fingerprint":"grep -rln \"'code' in err\" plugins/tribe/scripts/runner --include=\"*.ts\" --exclude=\"*.test.ts\"","hits_at_detection":2,"first_seen_pr":0}
--- run it:
    plugins/tribe/scripts/runner/cli/main.ts
    plugins/tribe/scripts/runner/adapters/cut.ts
    count: 2
--- the second half of G4: campaign-state.json re-parsed inside the supervisor loop:
327:  const raw = io.readFileOrEmpty(campaignStatePathOf(homeDir));
522:  const raw = io.readFileOrEmpty(campaignStatePathOf(homeDir));
```

### 9.6 Baseline, with dependencies installed

```
$ cd plugins/tribe/scripts/runner && bun install && bun test
 1068 pass
 0 fail
 2695 expect() calls
Ran 1068 tests across 46 files. [219.61s]
$ bunx tsc --noEmit    # exit 0, no output
```

## 10. Open questions, and the assumption each is planned under

Neither blocks the plan; both are stated here so the executing Warchief and the Shaman can see what
was assumed rather than discover it.

**Q1 — Are `skills/orchestrate-campaign/SKILL.md` and `agents/warchief.md` inside this card's
fence?** The fence names `plugins/tribe/scripts/runner/**`, the supervisor tests,
`plugins/verify-shipped/**`, `gap-gate.ts` if G5 needs it, and "the spec/ADR/C3 docs these touch".
Those two files are documentation the G5 code fix makes false.
**Assumption planned under:** yes, in scope, limited to the two sentences the fix falsifies.
**Recommendation:** keep it — a code fix that leaves its own instructions contradicting it has not
fixed the defect, it has moved it. Affected tasks are marked `[Q1]`.

**Q2 — Should a `FAIL` verdict from `verify-shipped.sh` park immediately rather than retry once?**
§4 chooses the ordinary retry-then-park path to leave `ParkReason`'s frozen union untouched, at a
cost of one redundant closing session in the `verdict_fail` case.
**Assumption planned under:** retry once, then `park(closing_failed)`.
**Recommendation:** keep it for this card; if real campaigns show the wasted session matters, a
later card can add a dedicated `ParkReason` with its own owner sentence.

## 11. C3 reconciliation

Component **`c3-215`** (`tribe`) owns the delivery-role contracts these files implement. Three
accepted ADRs dated 2026-09-19 describe the supervisor — `adr-20260919-campaign-supervisor-ratchet`,
`adr-20260919-campaign-supervisor-judgment-layer`, `adr-20260919-supervisor-core-change-safety` —
and **every patch in all three change units currently reports `state: drifted`** ("no block of
c3-215 seals to the cited hash; rebase"), independently of this card. `c3x check` on the current
tree is clean (`total: 59, ok: true`); `c3x check --include-adr` reports 331 warnings, 0 errors.

Per `brief-contracts.md`'s sequencing rule, the plan closes **each phase** with a C3 reconciliation
task rather than batching them. The model is only ever read and written through the wrapper —
`C3X_MODE=agent bash <c3-skill-dir>/bin/c3x.sh …` — never by editing `.c3/` instance files.

This card adds one new ADR of its own, `adr-20260919-supervisor-hardening`, recording: the verdict
file's contract (§4a), the ratchet enforcement point (§3), the four named parsers (§5), and the
campaign-home path truth (§6). The pre-existing drift in the three older units is **not** this
card's to repair beyond what its own patches touch; it is recorded here as a follow-up so the next
reader does not mistake it for damage this card caused.
