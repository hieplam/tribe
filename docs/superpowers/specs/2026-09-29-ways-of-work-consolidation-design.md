# Spec — Ways of work: one definition, owned by the Shaman (card `ways-of-work-consolidation`)

Status: spec for review, round 2 (planning-only Warchief, 2026-09-30) · base `master` @ `632a039`
Card: `~/.tribe/-Users-home-repos-tribe/cards/ways-of-work-consolidation.md` (goals G1–G4,
rulings D1–D6, scope fence; round-1 rulings N1–N6 and amendments S1–S3) · Plan:
`docs/superpowers/plans/2026-09-29-ways-of-work-consolidation.md` · C3 follow-up issue body:
`docs/superpowers/evidence/2026-09-29-ways-of-work-c3-issue.md`

> Round 2 applies the card's rulings: N1, N2, N4 and N6 as recommended; N3 (owner) — the hook
> refreshes, and the execution session runs `./install.sh tribe` after merge; N5 (owner) — **no
> `.c3/` change and no c3x call in this card**, the C3 side is a self-contained GitHub issue body;
> G1's in-repo target becomes 2 places (the canonical section and `c3-215`); S1 — the reviewer
> judges the diff against every goal row and the scope fence; S2 — the PR body carries a
> `## Final review` section and the SHIPPED gate checks it; S3 — the rubric counts build tasks only.

> Base note: the card was grounded at `dbb0124`; `master` has since moved to `632a039` (PR #196,
> "archive the mammoth-hunt skill"), which edited `shaman.md`, the brainstorm-together snippet and
> eval 56. This spec and its plan are built on `632a039`. Every line number below is at `632a039`.

---

## 1. The problem, grounded

A "way of work" is how an approved plan gets executed: who writes the code, how many reviews, how
many fix rounds, how it reaches a merged PR. Today three facts make it drift and make the wrong
actor choose it.

**1a. The rules are restated in nine live files, and they disagree.** A committed counter did not
exist yet; the one built in this plan's Task 1 (prototyped during planning, §5) lists these nine
places at `632a039`:

| File | What it restates (line) |
| --- | --- |
| `plugins/tribe/agents/shaman.md` | two executors, "at most 2 tasks", "roughly 50 changed lines", "one fresh implementer subagent per task", "one review, at most one fix round", "no tribe delivery loop unless the owner asks for it in their own words" (`:15`, `:398-407`) |
| `plugins/tribe/agents/warchief.md` | the planning Warchief writes the `Executor:` line: single-agent "only for a plan of at most 2 tasks … roughly 50 changed lines" (`:368-371`) |
| `plugins/tribe/skills/orchestrate-campaign/SKILL.md` | a second vocabulary: "Simple" (`## How to work`, one `general-purpose` subagent per task, **no review step**) and "Tribe" ("only when the owner asks") plan styles (`:72-93`, `:718-767`) |
| `plugins/tribe/scripts/validate-plan.sh` | "single-agent is used for at most 2 tasks", "the owner's rule: fewer than 3 tasks" (`:33-34`, `:327-330`) |
| `plugins/tribe/scripts/tests/test-validate-plan.sh` | "single-agent only for at most 2 tasks" (`:519`) |
| `plugins/tribe/scripts/runner/README.md` | "simple style" / "Tribe style" (`:197`, `:797-799`) |
| `plugins/tribe/README.md` | "one review, at most one fix round … unless the owner explicitly asks" (`:51`) |
| `plugins/tribe/claude-md/shaman-brainstorm-together.md` | step 7 restates the whole Mode 1 flow (`:9-13`) — and so does the installed `~/.claude/CLAUDE.md` (lines 54-58 there, byte-identical to the snippet) |
| `.c3/c3-2-plugins/c3-215-tribe.md` | "simple by default, Tribe only when asked", "never the tribe's delivery loop … unless the owner explicitly asks" (`:53`, `:71`, `:77`, `:90`) |

**1b. The wrong actor picks the mode.** The planning Warchief writes the `Executor:` line
(`warchief.md:368`); orchestrate-campaign picks Simple or Tribe (`SKILL.md:72-93`); the Shaman only
checks the line exists (`shaman.md:415-418`). The heavy mode cannot be chosen at all in Mode 1
unless the owner says so in their own words (`shaman.md:407-414`, eval 56).

**1c. Two plan formats, each refused by the other gate.** Measured, not read (§3): a Mode 1 plan
(`## Way of work` + `Executor:` + per-task Verify blocks) passes `validate-plan.sh` and is refused by
the campaign runner's `--dry-run` (`missing_done`); a runner plan (`## How to work` + per-task Done
sections) dry-runs clean and fails `validate-plan.sh` (no Way of work, no Hunter line).

## 2. What changes (the shape)

| # | Change | Card row |
| --- | --- | --- |
| C1 | A `## Ways of work` section in `shaman.md` is the one definition: the three modes with the rubric (build tasks only, S3), the tie-break, who decides, the final review (judged against every goal row and the scope fence, S1; recorded in the PR body's `## Final review`, S2) and its 2-round fix cap, who executes on each path, and one fenced block per mode that plans copy verbatim. | G1, D1, D3, D4, D6, S1–S3 |
| C2 | `shaman.md` Mode 1 points to it: step 3 records the mode and its rubric reasons in the card; the plan gate checks the plan carries that mode's block; delegation and hand-off follow the "who executes" table; anti-goals 1–2 and the frontmatter description carry a scoped exception for a delegated `single-agent` plan; the SHIPPED gate checks the PR body's `## Final review` section (S2). | G2, G4, D2, D3, S2 |
| C3 | `Executor:` keeps its key and gains the value `tribe`. | D5 |
| C4 | One plan format, accepted by both gates: `## Way of work` (the card's reasons, then the mode's block) + per task a Verify block, a **Done** section (the runner's format), exactly one Commit step + for the two light modes a last `Task N: Final review`. `validate-plan.sh` checks all of it; the runner is untouched. | G3, D4, D5 |
| C5 | A committed drift counter measures G1 before anything else is edited. | G1 ratchet |
| C6 | Every other live file points to the section by name: `warchief.md`, orchestrate-campaign `SKILL.md`, the runner README, the plugin README, the claude-md snippet (and through `install.sh`, the installed `~/.claude/CLAUDE.md`). `c3-215` is left as it is (N5): the follow-up issue carries its exact rows. | G1, G4, N5 |
| C7 | `install.sh` refreshes an already-installed snippet section in place (with a backup), so the snippet's new wording reaches the installed `CLAUDE.md` — today it never can. | G1 (installed copy) |
| C8 | Evals 57–63 are added and eval 56 is rewritten to D3 (and S1–S2). | G2, G4 |
| C9 | A self-contained C3 follow-up issue body, committed at `docs/superpowers/evidence/2026-09-29-ways-of-work-c3-issue.md`: context, the c3x 11.0.0 defects with exact reproduction and output, the ADR body, the exact `c3-215` row replacements, acceptance. | N5 |

## 3. The gating experiment (brief item 2) — what each gate accepts

Run on 2026-09-29, before the plan format was designed. A hermetic world (a bare `origin`, a clone
holding the fixture plans, pushed `master`) and one scratch campaign home per case; the runner is
`bun plugins/tribe/scripts/runner/run.ts --repo <clone> --model double --home <home> --no-viewer
--dry-run`, exactly the Stage A step 8 / Stage B step 1 invocation.

| Plan | Runner `--dry-run` | `validate-plan.sh` (today) |
| --- | --- | --- |
| (a) Mode 1 format: `## Way of work` + `Executor: subagent-per-task` + Verify blocks, **no Done** | **exit 4** — `campaign runner: refused: … card A task T1 "Task 1: Add sum": missing_done; card A task T2 "Task 2: Add product": missing_done` | verdict `pass` |
| (b) `docs/superpowers/plans/2026-09-28-campaign-status-cli.md` (runner format: `## How to work`, Verify **and** Done) — also run against the real repo as `--repo` | **exit 0** — `{"cardId":"B","phase":{"kind":"fresh"}}` | verdict `fail`: `hunter_named_as_implementer`, `way_of_work_declared` |
| (c) prototype of the unified format: (a) + a Done section per task + a last `Task 3: Final review` | **exit 0** | verdict `pass` |
| all three in one campaign | exit 4 — the runner collects every card's issues, so (a) refuses the whole state | — |

What the runner reads is only: the task headings the state names, and per task exactly one deeper
`Done` heading followed by one closed fence of one-line commands (`runner/core/plan-index.ts`
`resolveOne`). It ignores `## Way of work`, `Executor:` and Verify blocks entirely. **So the one
plan format is the Mode 1 format plus a Done section per task** (C4) — no runner change, and the
runner accepts a valid plan in every mode (§4.4 proves it per mode). No `NEEDS_DIRECTION` on the
runner is needed.

One hazard the experiment surfaced, fixed in the validator (§4.4): the runner takes the *first*
fence after the Done heading. A Done heading with no fence of its own, placed before the Commit
step (the natural order), hands the runner the Commit step's `git commit` as the task's Done
command, and the runner accepts it.

## 4. Design

### 4.1 The canonical section (C1)

`## Ways of work` is inserted in `shaman.md` between "The Goal · Verify · Ratchet gate" and the
anti-goals, so it sits outside every mode's section and every mode can point to it. Its full text
is Task 3 of the plan (verbatim). Its parts:

- **The three modes** table — mode (`Executor:` value), the rubric (the card's draft, refined:
  single-agent "at most 2 tasks, roughly 50 changed lines outside tests, one component, and an
  obvious oracle"; subagent-per-task "the design and requirements are settled …, 3 to about 8 build
  tasks done in order (the final review and phase-end governance tasks do not count), and every
  defect would surface in some task's Green or in the plan's end-to-end
  check"; tribe "a bug could pass every Verify block we can write in advance: concurrency,
  crash/resume, state machines, permission surfaces, parsers of hostile input, data migration,
  cross-component contracts, multi-PR work, or a past bug that escaped a single review. Very heavy —
  use it rarely"), and how each runs.
- **Tie-break**: pick the lighter mode and write down what would justify the heavier one.
- **Who decides** (D3): the Shaman — or the session holding the Shaman's authority for a campaign.
  The owner's words are quoted verbatim. The mode and its reasons are recorded where the work is
  ratified (the card in Mode 1; the card's plan in a campaign). It asks the owner to ratify when it
  judges the call needs the owner — two named examples: the rubric contradicts a way of work the
  owner asked for; `tribe` for work the owner framed as small or urgent. `tribe` needs no owner
  request. The planning Warchief never chooses; it returns `NEEDS_DIRECTION` when the card records
  no mode. A mode changes only by a new recorded decision, never at hand-off.
- **The final review** (D4, D6, S1, S2): the plan's last task `Task N: Final review`; a fresh
  `general-purpose` reviewer gets the card, the plan and the diff, judges the diff against every
  goal row and the scope fence of the card, re-runs every Green and the end-to-end check, ends with
  `REVIEW: PASS` or `REVIEW: FAIL` plus evidence-backed findings; a
  failed review gets a fix round (subagent-per-task: one fresh fix subagent; single-agent: the
  executing session fixes inline) and a fresh re-review, at most 2 fix rounds, then the Shaman. The
  review task's one Commit step commits the fixes, or an empty commit recording `REVIEW: PASS`. That
  commit alone proves nothing ran, so the PR body carries a `## Final review` section — every
  round's `REVIEW:` line with its findings, in order, ending `REVIEW: PASS` — and the Shaman's
  SHIPPED gate checks it (S2; the record is also data for #198). Plain review now; blinding is #198. `tribe` keeps the Warchief's own audit and cap, unchanged.
- **Who executes, on each path** (G4):

  | Path | `single-agent` | `subagent-per-task` | `tribe` |
  | --- | --- | --- | --- |
  | Mode 1, owner approves | the owner's new session, briefed by the Shaman | same | the Shaman dispatches one full-build `warchief` — no execution session |
  | Mode 1, owner delegates | the Shaman's own session builds inline | the Shaman's session orchestrates | the Shaman dispatches one full-build `warchief` |
  | Campaign | the runner's executor session builds inline | the executor session orchestrates | the executor session acts as the Warchief |

  The `tribe` column keeps the chain of command intact: a full-build Warchief reports only to the
  Shaman (`warchief.md`, contract), so the Shaman dispatches it; an owner-opened session briefed to
  dispatch a Warchief would become an unranked relay between them. (Ruling N2.)
- **The blocks**: three fenced ` ```markdown ` blocks whose first line is `Executor: <mode>`. A plan
  copies one into its `## Way of work`, after the card's reasons. `general-purpose` is named in the
  light blocks for the reason `SKILL.md` 2b gives today (other installed agents could otherwise be
  picked by description), kept as a note in the section.

### 4.2 The Shaman's amendments (C2)

Exact replacements are plan Task 3. Summary: frontmatter description (never code, except a
delegated single-agent plan; execution on the chosen mode); the opening paragraph; the
Shaman ⇄ Warchief contract's scope gains "a Mode 1 card whose way of work is `tribe`"; anti-goals 1
and 2 each gain the D2 scoped exception; Mode 1 step 3 records the mode; step 4's gate checks the
block; step 5 drives on the chosen mode; step 6 notes `tribe` has no session to brief; the section
"Mode 1 executes the plan's way of work — never the tribe's delivery loop" becomes "Mode 1 executes
the plan's way of work" and keeps only pointers plus the still-true brief-wording rule; Mode 1's
definition of done; campaign Stage A chooses each card's mode by the same rubric; and the
"Goal · Verify · Ratchet" SHIPPED gate (item 3) now also applies before every Mode 1
`verified-SHIPPED` and, for a light-mode card, opens the PR body's `## Final review` section: it
must exist, carry every round, and end `REVIEW: PASS` (S2).

### 4.3 The drift counter (C5, G1)

`plugins/tribe/scripts/ways-of-work/`:

- `drift-core.ts` — **pure core**. `findPlaces(files, policy)` takes file texts and returns every
  *place* that states a way-of-work rule: the canonical section is one place (`canonical: true`),
  the rest of the canonical file is a second place if it holds any hit, and every other file with a
  hit is a place. A hit is a line matching one of seven **signals** — the sentences a way-of-work
  definition is made of: `task-limit`, `line-limit`, `fix-round-cap`, `implementer-rule`,
  `owner-must-ask` (the retired rule), `plan-style` (the retired vocabulary), `rubric`. Section
  finding is fence-aware. No filesystem, git, clock or environment in the core.
- `drift.ts` — **thin edge**: `git ls-files -z` (bounded, host git config neutralised), reads each
  tracked text file, adds `--also <file>` files (the installed `~/.claude/CLAUDE.md`), calls the
  core, prints the report (or `--json`, `--verbose` for hit lines). A measurement: exit 0 whatever it
  counts; exit 2 on a usage error, a failed `git ls-files` or an unreadable `--also` file (a scan
  that read nothing must never look clean). The policy (canonical path + heading + allowlist) is a
  constant here, at the composition root.
- **Allowlist** (never scanned): the card's historical paths `docs/tribe/planning/`,
  `docs/superpowers/` (specs, plans, evidence), `.c3/adr/`, `.c3/changes/`, `archive/`; plus
  `scripts/evals/baselines/` (recorded eval runs — evidence), `plugins/tribe/evals/` (eval rubrics
  must state the behaviour they grade) and `plugins/tribe/scripts/ways-of-work/` (the signals and
  their test sentences). The Shaman approved the last three (ruling N4). `.c3/c3-2-plugins/` is
  deliberately NOT allowlisted: `c3-215` restates the modes, and hiding it would hide real drift.
- **Oracle**: the card's G1 row. A live restating line the counter misses is a bug (under-check); a
  pointer the counter lists is fixed by rewording the pointer so it defers to the section, never by
  weakening a signal (over-check is visible and cheap). Signals were tuned against the real tree:
  one false positive found and removed (`~50 lines of prompt removed` in an ideas doc — `line-limit`
  now requires "50 changed lines").
- **Baseline, measured** (prototype on `632a039` + this spec/plan): `ways-of-work definitions: 9`
  in the repo; **10** with `--also ~/.claude/CLAUDE.md`. Target in this card (ruling N5): **2** —
  exactly `canonical  plugins/tribe/agents/shaman.md#Ways of work (N lines)` and
  `restates   .c3/c3-2-plugins/c3-215-tribe.md (6 lines)`, nothing else; **2** as well with
  `--also` on the installed copy once `./install.sh tribe` has run (measured on a scratch copy of
  today's installed file: the refreshed file adds no place). The C3 follow-up issue's acceptance
  is **1**; applying its row replacements to a scratch copy of the final tree gives 1 (plan
  Task 10).

### 4.4 One plan format and the validator (C3, C4, G3)

`validate-plan.sh` changes (exact code: plan Tasks 4–5). Oracle for every check: the card's G3 row
is the contract, CommonMark is not; under-checking (accepting any G3 mutant, or a plan the runner
refuses) is a bug, over-checking an ambiguous plan is by design.

| Check | New behaviour |
| --- | --- |
| `way_of_work_declared` | also accepts `Executor: tribe`; `tribe-lite` and other longer values still fail |
| `hunter_named_as_implementer` | required only when the Executor is `tribe`; the two light modes dispatch no Hunter |
| `tasks_have_done_block` (new) | mirrors `plan-index.ts` `scan` + `resolveOne` rule for rule, reporting the runner's own problem names (`dangling_heading`, `missing_done`, `ambiguous_done`, `missing_done_block`, `unclosed_done_block`, `empty_done`, `continuation_not_supported`) — plus one stricter, validator-only refusal, `done_block_after_a_step`: the Done fence must open before any `- [ ]` step line (the hazard in §3) |
| `mode_block_copied` (new) | the Way of work section, outside fences, contains the declared mode's block as one contiguous run of lines (trailing spaces and blank lines ignored), read from `../agents/shaman.md` "Ways of work"; a declared mode whose source file or block is missing is a **setup error, exit 2** (fail closed) |
| `final_review_task_last` (new) | for `single-agent` and `subagent-per-task`, the last task's title is `Task N: Final review`; not required for `tribe` |
| JSON output | gains `"executor"` |

The validator locates `shaman.md` beside itself (`$(dirname script)/../agents/shaman.md`, `pwd -P`),
which holds for the symlink install (it resolves to the repo) and the plugin-cache install (the
whole tree is copied).

**The two-gate test** (`plugins/tribe/scripts/tests/test-ways-of-work-plans.sh`, Task 6) builds its
plans from nothing — each mode's block read from `shaman.md`, never restated — in a hermetic git
world, and runs every plan through both gates:

| Plan | `validate-plan.sh` | runner `--dry-run` |
| --- | --- | --- |
| single-agent, subagent-per-task, tribe | verdict `pass` each | exit 0 each |
| subagent-per-task without a final review task | fails `final_review_task_last` | exit 0 (by design: the runner reads only Done) |
| single-agent with 3 tasks | fails `single_agent_within_limit` | exit 0 |
| tribe without its audit block | fails `mode_block_copied` | exit 0 |
| undeclared mode | fails `way_of_work_declared,mode_block_copied` | exit 0 |
| a task without its Done section | fails `tasks_have_done_block` | **exit 4**, names `missing_done` |
| a 3-card campaign, one card per mode (G4, Stage A step 8) | — | exit 0, next card `C1` |

Measured in the planning replay: `15 passed, 0 failed`, `V-WOW=PASS`; the same test on the tree
after Task 3 (before the validator changes) gives `10 passed, 5 failed` — exactly the card's G3
stub check (today's validator rejects `tribe` and accepts a subagent-per-task plan with no review).
`test-validate-plan.sh`: 44 → 67 (Task 4) → 87 (Task 5) passed, 0 failed; the 44 existing
assertions are unchanged — only two fixtures gain the parts the new format requires (a Done section;
F0 becomes a one-task `tribe` plan so its "quoted headings are not tasks" count stays 1).

**This plan and the chicken-and-egg.** This card's own plan must pass today's validator (which
requires the Hunter line in every plan and knows no `tribe`, no Done check, no review task) and the
new one. It does both: its Global Constraints names the Hunter (only to exclude it — ruling N1),
and it already carries the subagent-per-task block (as amended by S1–S2), a Done section per task
and a last `Task 11: Final review`. Task 5's Done section and the final review run the new
validator on this plan. By S3 it has 8 build tasks (1–6, 8, 9), two phase-end governance tasks (7,
10) and the final review (11).

### 4.5 Pointers (C6)

Exact replacements: plan Tasks 7–10 (no `.c3/` file, ruling N5). `warchief.md` step 3 copies the recorded mode's block and
never chooses (a full-build dispatch is the `tribe` block; a card with no mode is
`NEEDS_DIRECTION`), and every plan gains Done sections; the Hunter line is required only in `tribe`
plans. `SKILL.md` Stage A step 2b becomes "Choose each card's way of work" by the rubric; the
Simple/Tribe plan sections are replaced by "tribe cards — campaign plan additions" (only the
campaign mechanics: executor-as-Warchief, report paths, Tracker file names, Scout drafts; the fix
loop is no longer restated) and "tribe cards — Stage C and D additions" (renamed, unchanged); the
`general-purpose` naming stays in the block; and Stage D's re-verification of each shipped card
also reads the PR body's `## Final review` section for a light-mode card (S2 on the campaign path —
see R2-1 in §9). Runner README: two wording fixes (docs only, no code).
Plugin README: the Shaman paragraph points to the section, a new "Ways of work" section lists the
three tools that keep it true. Root README: the new tests, and the hook's refresh behaviour.

### 4.6 The install path (C7) — the empty-fixture check (brief item 3)

`plugins/tribe/install.sh` keys a snippet on its first line and skips it when that line is present
(`install.sh:115-125`). The brainstorm-together snippet's first line does not change, so **today
the new wording would never reach an installed `CLAUDE.md`** — and the fence forbids editing that
file by hand. The hook therefore learns to refresh: when the marker line is present, the installed
section (from the marker to the first heading at its level or above that the snippet does not own,
fence-aware) is compared with the snippet; equal → skip; different → copy the whole file to
`CLAUDE.md.bak.<epoch>`, replace only that section, warn naming the backup. python3 missing → warn,
leave as is (fail closed). The existing heading-overlap refusal (marker absent, another heading
present) is unchanged.

Verified during planning against a scratch `CLAUDE_DIR`, never `~/.claude`:

| Fixture | Result |
| --- | --- |
| (a) empty `CLAUDE_DIR` | 3 × `added`; `CLAUDE.md` = the three snippets in order; a re-run prints 3 × `ok … (already present)` |
| (b) a copy of today's installed `~/.claude/CLAUDE.md` | `global-rules.md` and `goal-verify-ratchet.md` `ok`; `shaman-brainstorm-together.md` `updated`; `diff` shows only the brainstorm section's lines 52 and 54-58 changed; exactly one `CLAUDE.md.bak.*`; a re-run prints `ok` and makes no second backup; the counter's `--also` on the result finds no hit |

The committed test (`test-install-hook.sh`, Task 9) reproduces both, the real case built from
`git show 632a039:plugins/tribe/claude-md/<snippet>` (the installed copy is byte-identical to that
commit's snippets): 11 → 27 passed; the new cases against today's hook: `17 passed, 10 failed`.

The owner's real `~/.claude/CLAUDE.md` changes only after merge: the execution session runs
`./install.sh tribe` once from the updated `master` (owner ruling N3), then
`bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --also ~/.claude/CLAUDE.md`, whose last
line must read `ways-of-work definitions: 2` (measured on a scratch copy of today's installed file:
3 before the refresh — the repo's 2 plus the old installed section — and 2 after).

### 4.7 Governance (READMEs, `install.sh` wiring, and the C3 follow-up issue)

- **No install wiring is needed**: the counter and the new test are repo-invoked scripts under
  `plugins/tribe/scripts/`, never installed (the same status `doctor.sh` and the runner have);
  `install.sh` gains behaviour, not a new artifact.
- **READMEs, at the end of each phase** (brief item 7): Task 7 (definition + format phase) — the
  plugin README's Shaman paragraph and a new "Ways of work" section, and the root README's list of
  tests; Task 10 (pointer + install phase) — the root README's note on the hook's refresh.
- **C3 — no change in this card (owner ruling N5)**: no ADR, no `c3-215` edit, no c3x call. The
  measured reason: with c3x 11.0.0, (D1) every block patch on any `c3-215` table row is rejected by
  `change apply` with `invalid required table: <table>` — a byte-identical no-op patch included,
  and still after the five pre-existing placeholder words are removed; (D2) every successful c3x
  write (`repair`, `add adr`, `set`) deletes the 157 historical patch files under `.c3/changes/`
  whose seals are broken on `master`, and any untracked change-unit folder; (D3) the canvas
  placeholder-word check rejects ordinary words ("each later turn", "optional flags"), which with D1
  blocks every edit to `c3-215`.
- **The follow-up issue body** — `docs/superpowers/evidence/2026-09-29-ways-of-work-c3-issue.md`,
  written and committed in this planning round for the owner to file; a reader on another machine
  with only the merged repo and c3 installed can do the work from it alone. It carries: (a) the
  context — what this card changed and where the canonical section lives; (b) D1–D3 with the exact
  reproduction script and its exact output, captured on a clone equal to merged `master` (fileable
  upstream); (c) the full ADR body; (d) the 14 exact `c3-215` row changes (12 replacements, 2 new
  rows), old text as on `master` and new text in the final wording (S1–S3 included — the Owner →
  Shaman row names the `## Final review` record), plus one script applying them; (e) acceptance —
  the counter prints `ways-of-work definitions: 1` and `c3x check` reports only `master`'s 157
  historical broken seals. It gives two ways to land the change: a change unit once c3x no longer
  has D1, or the path verified with c3x 11.0.0 on a merged-`master` clone (ADR via `c3x add adr`,
  history restored after every write, rows edited as text, `c3x repair` re-sealing `c3-215` once no
  placeholder word is left, ADR set `accepted`) — end state `157 0` and counter 1.
- **Task 10 keeps the issue honest**: it applies the issue's row script to a scratch worktree of the
  branch head (no c3x, nothing under the real `.c3/` touched) and requires the counter there to
  print `ways-of-work definitions: 1`; a row whose "old" text no longer matches `c3-215` stops the
  script on its `assert`.

### 4.8 Evals (C8, G2, G4)

In `plugins/tribe/evals/evals.json`, the existing agent-fixture shape (`ref-evals-fixture`):

| Id | Goal | Case | Machine check |
| --- | --- | --- | --- |
| 56 (rewritten) | G4 approval path, S1, S2 | hand-off of a `subagent-per-task` card: brief quotes the block — the final review judged against the goals and scope fence, ≤2 fix rounds, the PR's `## Final review` section — and never changes the mode | — |
| 57 | G2 | picks `single-agent` for a 2-task, ~20-line card | `grep -Eq 'Executor: *`?single-agent' cards/tribe-version.md` |
| 58 | G2 | picks `subagent-per-task` for a settled 6-task card | `grep … subagent-per-task …` |
| 59 | G2 | picks `tribe` for a crash/resume state machine with a past escaped bug | `grep … tribe …` |
| 60 | G2 (ask) | the owner asked for a light mode, the rubric says tribe (data migration) → asks for ratification with options + recommendation | — |
| 61 | G4 delegation | a delegated `single-agent` plan: the Shaman builds Task 1 inline, no implementer dispatch | `bash -c 'test "$(bash hello.sh)" = hello'` |
| 62 | G4 delegation | `subagent-per-task`, the review failed after fix round 2 → no third round | — |
| 63 | G4 | an approved `tribe` card → the Shaman dispatches one full-build `warchief` | — |

Checks run with `shlex` and **no shell** (`run_evals.py:618-626`), hence `bash -c` in eval 61.
Fixture cards/plans are real files in the eval's working directory: an early draft that pointed at
non-existent `~/.tribe/demo/…` paths failed for that reason alone (the Shaman correctly refused to
brief from memory), and a card without a goal table was correctly stopped at the plan gate.

**Measured during planning** (`--mode with_skill`, the default model, `--runs 1` unless noted):

| Eval | Today's `shaman.md` | Prototype of the new `shaman.md` |
| --- | --- | --- |
| 56 | PASS 2/2 (with real fixture files) | PASS 2/2 |
| 57 | PASS | PASS |
| 58 | PASS | PASS |
| 59 | **FAIL** (machine check: no `tribe` recorded) | PASS |
| 60 | **FAIL** (records a final light mode, never asks) | PASS |
| 61 | PASS (the plan's own block tells it to build) | PASS |
| 62 | PASS | PASS |
| 63 | **FAIL 3/3** ("the owner never said use the tribe"; 1 + 2 runs) | PASS 2/2 with the final fixture (the prompt states the Shaman's plan review is complete; a thinner fixture was correctly stopped at the plan gate) |

Round 2 (after S1–S3 changed the section and both light blocks, and eval 56's expectation gained
S1–S2; the fixture plans of 56 and 61 re-copied the new blocks) re-ran only the cases the wording
could flip, against the round-2 prototype of `shaman.md`, `--runs 3`: **56 PASS 3/3, 61 PASS 3/3,
62 PASS 3/3**. 57–60 and 63 grade the mode choice and the `tribe` dispatch, which S1–S3 did not
touch; they were not re-run.

The discriminating cases are 59, 60 and 63 — exactly the card's stub checks (today's Mode 1 cannot
pick or run `tribe`, and never asks). 56, 57, 58, 61 and 62 already pass today; they are kept as
regression guards for the rewrite, not counted as ratchet movement. The plan's Red/Green use
`--runs 3` and a majority rule per case (one sample cannot separate a regression from model variance,
`scripts/evals/README.md`).

## 5. Purity (the golden standard)

| Logic | Pure core | Edge (effects) |
| --- | --- | --- |
| Drift counter | `drift-core.ts`: signals, section finding, place listing, report text | `drift.ts`: `git ls-files`, file reads, stdout, exit code |
| Plan validator | the Python check functions operate on the plan's lines already read (existing shape) | `validate-plan.sh` bash wrapper, file reads, the one `shaman.md` read (fail closed, exit 2) |
| Install refresh | the Python section-compare-and-replace on lists of lines | the bash hook: backup copy, `mv`, messages |
| Two-gate test | — (test) | git world, runner process, validator process |

## 6. Scope fence (from the card, binding) and the adjudication rule

- OUT: runner loop, watchdog and supervisor **code** — untouched (the runner README gets two
  wording fixes only). The experiment found no mode the runner refuses, so no runner question.
- OUT: the tribe loop's internals — the `tribe` block points at `warchief.md` Method steps 4–8 and
  its cap, unchanged.
- OUT: blinding the final reviewer (#198). OUT: rewriting historical plans, specs, ADRs, evidence.
  OUT: editing `~/.claude/CLAUDE.md` by hand. OUT (owner ruling N5): any `.c3/` change or c3x call —
  the C3 side is the follow-up issue body (§4.7).
- PINNED: `single-agent` | `subagent-per-task` | `tribe` on `Executor:`; fix-round cap 2; the Shaman
  decides.
- REFUTED in advance (for every reviewer of this work): historical files restating the old modes
  (the allowlist); any runner/watchdog/supervisor code change; the tribe loop's internals; the
  counter listing `c3-215` (N5: G1's in-repo target is 2).

## 7. Evidence plan (before → after)

| Goal | Before (measured by the committed tool) | After (target) |
| --- | --- | --- |
| G1 | drift counter: 9 (10 with `--also ~/.claude/CLAUDE.md`) — `docs/superpowers/evidence/2026-09-29-ways-of-work-drift-baseline.txt` (Task 1) | 2 in the repo — the canonical section and `c3-215`, nothing else (ruling N5); 2 with `--also` on the installed copy after `./install.sh tribe`; 1 once the C3 follow-up lands (Task 10 proves it on a scratch copy) |
| G2 | evals 57–60 majority pass count — `docs/superpowers/evidence/2026-09-29-ways-of-work-evals-baseline.txt` (Task 2) | 4/4 |
| G3 | `test-validate-plan.sh` 44 passed; the two-gate test 10/15 on the Task 3 tree | 87 passed, 0 failed; 15 passed, `V-WOW=PASS` |
| G4 | evals 56, 61–63 majority pass count (Task 2); the 3-card campaign dry-run (in the two-gate test) | 4/4; exit 0 |

The PR body carries each before → after with the command that measured it.

## 8. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| The validator accepts a plan the runner refuses | Done check mirrors `plan-index.ts`; the two-gate test runs every fixture through both |
| A block's wording is edited in `shaman.md` and every open plan fails `mode_block_copied` | By design (a plan copies the current block); the fix is re-copying, the failure names it |
| The hook overwrites the owner's hand edit of a snippet section | Backup + warning naming it; covered by the refresh tests |
| The Shaman over-picks `tribe` | Rubric + tie-break to the lighter mode; evals 57–58 pin the light picks |
| LLM eval variance flips a case | `--runs 3`, majority rule; a flip below majority is investigated, not waved through |

Rollback: every change is prompt text, one script, two tests and docs — `git revert` of the merge
commit restores today's behaviour; the installed `CLAUDE.md` is restored from its
`CLAUDE.md.bak.<epoch>`.

## 9. Rulings and open questions

Round 1's questions N1–N6 are ruled in the card ("Spec amendments … and rulings on the planning
round-1 questions (2026-09-29)"), with S1–S3; this round applies them. One How-level call made in
round 2, for the Shaman to confirm or overturn:

- **R2-1 — S2 on the campaign path.** Context: S2 says the Shaman's SHIPPED gate checks the PR
  body's `## Final review` section. Mode 1 goes through `shaman.md`'s gate (Task 3); a campaign's
  shipped cards are re-verified in orchestrate-campaign Stage D, by the session holding the
  Shaman's authority, which did not look at the PR body. Options: (a) Stage D step 1 also reads the
  section for a light-mode card and reports a missing or failing one as `blocked` (one sentence,
  Task 8 — what the plan does); (b) leave campaigns out, so a campaign card could ship with no
  review record. Recommendation: (a) — G4 says the mode is followed on every path, and S2's reason
  (an empty `REVIEW: PASS` commit proves nothing) holds for a runner-driven card too.
