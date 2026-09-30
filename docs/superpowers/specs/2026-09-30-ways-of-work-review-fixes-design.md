# Spec — Ways of work: close the final review's findings on PR #202 (card `ways-of-work-review-fixes`)

**Card:** `~/.tribe/-Users-home-repos-tribe/cards/ways-of-work-review-fixes.md` (goal rows G1–G7,
rulings D-F5, D-F7, Amendment A1) · **Parent card:** `ways-of-work-consolidation` (PR #202) ·
**Base:** `master` @ `b90f1c4` · **Branch:** `feat/ways-of-work-review-fixes` · **Plan:**
`docs/superpowers/plans/2026-09-30-ways-of-work-review-fixes.md`

This spec is the How for one card. Every "today" claim below was checked on `b90f1c4`; every
number marked *measured* comes from the planning prototype (section 3), a scratch clone of
`b90f1c4` where each change in this spec was applied and its tests run.

## 1. The problem, grounded

A **way of work** is how an approved plan is executed: which session builds, who reviews, how
many fix rounds. PR #202 moved the one definition into the "Ways of work" section of
`plugins/tribe/agents/shaman.md` (lines 234–372) and added three tools that keep it true: a drift
counter, a plan validator extension, and a two-gate test. Its own final review ended
`REVIEW: PASS` while listing four findings (PR #202 body, `## Final review`), and the planning
prototype for this card found a fifth defect, a test PR #202 broke.

- **F1 — the counter misses the harness default and the "Who executes" table.** The counter's
  signals (`plugins/tribe/scripts/ways-of-work/drift-core.ts:18-31`) cover task limits, fix-round
  caps, the implementer rule, the retired "only when the owner asks" rule, the old plan styles and
  the rubric's wording. None matches "every approved plan, in every mode, runs through the
  campaign harness" (`shaman.md:248`), "only the owner's explicit words turn the harness off"
  (`:251-252`), or the "Who executes, on each path" table (`:329-335`). Live files restate that
  material uncounted: `shaman.md` outside the section (the frontmatter description `:9-20`, `:32`,
  `:49-51`, the Warchief contract scope `:94-97`, anti-goals 1–2 `:380-388`, Mode 1 steps 5–6
  `:533-552`, "Mode 1 executes the plan's way of work" `:563-577`, its Definition of done `:587`),
  `agents/warchief.md:375`, `skills/orchestrate-campaign/SKILL.md:8`, `:62`, `:728`,
  `claude-md/shaman-brainstorm-together.md` steps 6–7 (lines 8–9, and so the installed
  `~/.claude/CLAUDE.md`), and `plugins/tribe/README.md:51`, `:215`, `:221`. The counter reads
  `ways-of-work definitions: 2` on `b90f1c4` (measured) — the canonical section and
  `.c3/c3-2-plugins/c3-215-tribe.md` — so the parent card's G1 ratchet reads "met" while seven
  files restate the rules.
- **F1, second cause — one line at a time.** `hitsIn` (`drift-core.ts:103-112`) tests each line
  alone, and this repo's prose is hard-wrapped at about 100 columns. A rule sentence broken across
  two lines is invisible: anti-goal 1's "said not to / use the campaign harness" (`shaman.md:381-382`)
  is caught only when a line is read together with the next one (measured, section 3).
- **F2 — the validator accepts two identical task headings; the runner refuses them.** The
  runner resolves each task by its heading text and refuses a text that matches two headings
  (`plugins/tribe/scripts/runner/core/plan-index.ts:98-101`, `duplicate_heading`). The
  validator's mirror of that reader (`plugins/tribe/scripts/validate-plan.sh:426-457`,
  `runner_done_problem`) finds the task's heading by line number and never counts duplicates, so
  a plan with a task pasted twice gets `verdict: pass` from the validator and exit 4 from the
  runner's `--dry-run` (both measured).
- **F3 — `single-agent` cannot hold 2 build tasks and its mandatory review.** The rubric's
  `single-agent` row says "At most 2 tasks" (`shaman.md:289`); the `subagent-per-task` row counts
  build tasks only (`:290`, "the final review and phase-end governance tasks do not count"). The
  validator counts every task section (`validate-plan.sh:337`, `:360`), so 2 build tasks plus the
  final review the mode requires are 3 sections and fail `single_agent_within_limit` (measured).
- **F4 — the runner README has no pointer.** `plugins/tribe/scripts/runner/README.md` contains no
  "Ways of work" (0 occurrences); the parent card's D1 says the READMEs point to the section.
- **D-F5 — the verdict is the reviewer's discretion.** The section and both light-mode blocks say
  the reviewer "ends with `REVIEW: PASS` or `REVIEW: FAIL`" (`shaman.md:315`, `:351`, `:360`); no
  rule ties the verdict to the findings. PR #202's review passed with two Should-fix findings.
- **F6 (Amendment A1) — PR #202 broke a supervisor test.** `bun test
  plugins/tribe/scripts/runner/core/supervisor/brief.test.ts` → `18 pass, 1 fail` on `b90f1c4`
  (measured; reproduced by the Shaman): "contains Stage D's three numbered steps, byte-identical to
  SKILL.md". PR #202 added the `## Final review` check to orchestrate-campaign's Stage D step 1
  (`SKILL.md:582-585`), but the supervisor's closing-brief template
  (`plugins/tribe/scripts/runner/core/supervisor/brief-closing.md:17-23`) still quotes the old step,
  so a supervisor closing session never checks a light-mode card's `## Final review` section.
- **D-F7 (Amendment A1) — why F6 shipped.** Nothing ran that test: the repo's only PR check is
  GitGuardian (`gh pr checks 202`: one check), and PR #202's Done commands and final review ran only
  the tasks' own checks. The final review names "every task's Green and the plan's end-to-end check"
  and nothing wider.

## 2. What changes (the shape)

Seven build tasks, one governance task, one final review — all prompt text, one pure-core
counter, one validator, test fixtures and one supervisor text template. No runner, watchdog or
supervisor logic changes; no `.c3/` change; no eval runs.

| # | Change | Goal |
| --- | --- | --- |
| C1 | The counter gains signals for the harness default (`harness-default`, `harness-off`), the "Who executes" table (`who-executes`) and the final review's verdict rule (`review-verdict`); `task-limit` learns "build tasks"; every line is matched joined with the next one. The G1 baseline is measured with them before any rewording. | G1 |
| C2 | `shaman.md` outside the section points to the section instead of restating the harness default or the table. | G1 |
| C3 | `warchief.md`, orchestrate-campaign `SKILL.md`, the claude-md snippet and the tribe README do the same; the runner README gains its pointer; a committed pointer test names every file that must point to the section. | G1, G4 |
| C4 | `validate-plan.sh` mirrors the runner's `duplicate_heading` refusal. | G2 |
| C5 | `single-agent`'s limit counts build tasks, in the rubric and in the validator. | G3 |
| C6 | The supervisor's closing brief quotes Stage D exactly as `SKILL.md` says it. | G6 |
| C7 | The final review's verdict rule (D-F5) and its whole-suite run (D-F7) — in the section's paragraph and both light-mode blocks — and this plan's own block re-copied in the same commit. | G5, G7 |
| C8 | Governance: the tribe README's "Ways of work" section describes the tools as they now are. | — |

## 3. The planning prototype — what was measured

Brief item 1 asks for the G1 baseline measured with the new signals before any rewording. The
prototype did exactly that in a scratch clone of `b90f1c4`, then applied each later change in plan
order and ran its Red and Green. Results, all measured:

| Step | Before | After |
| --- | --- | --- |
| C1 — `drift.test.ts` with the new tests | 16 pass, 3 fail | 19 pass, 0 fail |
| C1 — the counter on the untouched tree (the G1 baseline) | 2 places (old signals) | **7 places**: `c3-215`, the tribe README, the canonical section, `shaman.md` outside it, `warchief.md`, the snippet, `SKILL.md`; 8 with `--also ~/.claude/CLAUDE.md` |
| C1 — hits found only by the two-line join | — | 4 lines, 2 of them outside the section (`shaman.md:15`, `:381`) |
| C2 — the counter after `shaman.md`'s rewording | 7 | 6 |
| C3 — the counter after the other files' rewording | 6 | **2** (canonical + `c3-215`) |
| C4 — `test-validate-plan.sh` / two-gate test | 88 passed, 6 failed / 19 passed, 4 failed | 94 / 23 passed, 0 failed |
| C5 — `test-validate-plan.sh` / two-gate test | 98 passed, 4 failed / 24 passed, 1 failed | 102 / 25 passed, 0 failed |
| C6 — `brief.test.ts`, the template's step 1 copied from `SKILL.md` as it stands | 18 pass, 1 fail | still 18 pass, 1 fail: the byte test passes, and "the closing brief is Tribe-free" now fails (the copied step names `agents/shaman.md`) |
| C6 — `brief.test.ts`, `SKILL.md`'s step 1 pointer reworded first, then copied | 18 pass, 1 fail | **19 pass, 0 fail** |
| C7 — the counter's `review-verdict` hits inside the section | 0 | 4 lines (the paragraph and both blocks); the count stays 2 |

Two false positives surfaced while tuning and are pinned as tests so they cannot come back: an
owner rule's "no local build step: inline the CSS" (`plugins/tribe/rules/html-illustration.md:210`)
and a viewer test comment's "outranks any Should-fix" (`plugins/tribe/scripts/viewer/structure.test.ts:123`).
The runner's `--dry-run` refused both duplicate-heading mutants with exit 4 and
`duplicate_heading` before and after C4 — the runner was always right; the validator now agrees.

## 4. Design

### 4.1 The counter's new signals (C1, G1)

**The oracle.** The card's G1 row is the contract, as the counter's own header already says
(`drift-core.ts:6-8`): a live sentence that restates a mode rule, the harness default or the
who-executes rule and is not counted is a bug (under-check); a pointer that is counted is fixed by
rewording the pointer, never by weakening a signal. Over-check is visible and cheap — except on a
file that is neither a restatement nor a pointer (an unrelated rule, a code comment), which is a
false positive and is fixed by tightening the pattern, pinned by a test.

**What is a restatement, and what is a pointer.** A restatement states a rule's content: that the
harness is the default for every mode, the condition that turns it off, what happens when it
cannot run, or which session or agent executes on a path. A pointer names the section (or one of
its sub-parts, like "Who executes, on each path") and defers the content to it. "Execute the
approved card on the path "Who executes, on each path" in "Ways of work" names" is a pointer;
"only when the owner says not to use the harness does it brief the owner's new session" is a
restatement. Every restatement found on `b90f1c4` is a test case below; every pointer this card
writes is a test case too.

**The signals** (each is one `RegExp`, case-insensitive, no `g` flag):

| Signal | Rule it recognises | Phrasings it matches (all live on `b90f1c4`) |
| --- | --- | --- |
| `harness-default` | the campaign harness drives every approved plan, in every mode | "harness … by default / the default", "default harness", "default for every mode / way of work / approved plan", "every (approved) plan / mode / way of work … harness", "harness … every mode" — never "harness-gap" (the gate), and "the eval harness default" does not match |
| `harness-off` | only the owner's explicit words turn it off; a harness that cannot run blocks the card | "unless / only when / until the owner (or user) … not to / don't", "not to use the (campaign / orchestrate-campaign) harness", "owner's explicit words / no-harness", "harness that cannot run", "never fall back", "fall back to an in-session / step 6 / your own" |
| `who-executes` | the "Who executes, on each path" table | "owner's new (named / execution) session", "owner opens a new", "your / its own session builds / orchestrates / on delegation", "from its own session", "dispatch (its) (one / a) full-build", "executor session acts as / is the Warchief", "build(s / t / ing) … inline" (with no colon between, so "build step: inline the CSS" is not one), "post-merge steps … yourself / itself", "no-harness `single-agent` / … / `tribe`", "`tribe` card run without the (campaign) harness" |
| `review-verdict` | the final review's verdict rule (D-F5, D-F7) | "Should-fix or worse", "any (Blocker or) Should-fix … `REVIEW: FAIL`" (within one clause, so "outranks any Should-fix" is not one), "`REVIEW: PASS` that lists", "at least Should-fix" |
| `task-limit` (extended) | the rubric's task limits | adds "build tasks" and "3 to about 8 … tasks": the canonical row "3 to about 8 build tasks" was invisible to the old pattern |

`review-verdict` is added before its rule exists (Task 7 writes the rule): the baseline is measured
once, with the final signal set, and a restatement of the new rule anywhere else is counted from
the day it could first appear.

**The two-line join.** `hitsIn` matches each line joined with the next line of the same range
(the next line's leading whitespace trimmed, one space between), and a hit belongs to the line its
match starts on: a sentence wholly on the next line is that line's hit, never both. The join never
crosses a range boundary, so the canonical section's hits stay inside it. It only adds hits (every
match inside one line is still found), so it cannot weaken an existing signal. Phrases are at most
about 10 words and lines about 15, so two lines are enough.

**Purity.** All of this lives in the pure core (`drift-core.ts`): text in, places out. The edge
(`drift.ts`) is unchanged.

**The pointer check (G4).** A committed test, `plugins/tribe/scripts/ways-of-work/pointers.test.ts`,
reads each file the parent card's D1 says must point to the section — `agents/warchief.md`,
orchestrate-campaign `SKILL.md`, the claude-md snippet, `plugins/tribe/README.md`, and the runner
README — and asserts it names `"Ways of work"` and `shaman.md`. The counter proves they do not
restate; this proves they point. It lives in the counter's own directory, which the counter never
scans.

### 4.2 Pointers instead of restatements (C2, C3, G1, G4)

Each restating passage is replaced by a pointer that keeps the passage's job and drops the rule's
content. The plan carries every replacement as an exact old → new pair, applied by a script that
refuses unless each old text matches exactly once.

- **`shaman.md`, outside the section (13 passages, Task 2).** The frontmatter description keeps
  what the Shaman does in Mode 1 ("run the approved card on the way of work the Shaman chose …, on
  the path that section's "Who executes" table names") and drops the harness default and the
  no-harness paths. Anti-goals 1–2 keep the owner's scoped exception (ruling D2 of the parent
  card) by naming the table's cell ("the one path where "Who executes, on each path" … names your
  own session as a `single-agent` plan's builder") instead of restating its conditions. Mode 1
  step 5's second paragraph restated the section's "In Mode 1 the Shaman runs the harness itself"
  paragraph (`shaman.md:275-283`) nearly word for word; it becomes a pointer plus the SHIPPED
  re-verification. Step 6 keeps its whole procedure (brief through `SendMessage`, never a
  checklist, tell the owner how to watch) and names its path by pointer. The Warchief contract's
  scope, "Mode 1 executes the plan's way of work" and Mode 1's Definition of done point to the
  table. The canonical section itself is not touched by Task 2 (its Green proves it).
- **The other files (Task 3).** `warchief.md:375` keeps its instruction (a planned `tribe` plan
  copies orchestrate-campaign's campaign additions) and defers the condition to "The campaign
  harness". orchestrate-campaign `SKILL.md` keeps its trigger description and Stage A step 0, both
  pointing to the section, and drops "In this campaign the executor session is the Warchief the
  block names" from the tribe campaign additions — the `tribe` block itself already says it
  (`shaman.md:368`). The snippet's step 6 keeps "execute on the path … names", the
  `orchestrate-campaign` skill's name, "never by checklist" and the viewer; step 7 drops "driven by
  the campaign harness unless the owner said not to". The tribe README's three passages point to
  the section. The runner README gains one paragraph under "Turns and the Done run" naming the
  section as the definition of how the session works inside the turns (G4).
- **The installed `~/.claude/CLAUDE.md`** changes only through `install.sh`, which refreshes a
  changed snippet section in place (PR #202). After merge the orchestrating Shaman session — never
  the headless executor — measures the counter with `--also "$HOME/.claude/CLAUDE.md"` (expected
  3: the installed copy still holds the old step 6), runs `./install.sh tribe`, and measures again
  (expected 2).

### 4.3 The validator refuses what the runner refuses: `duplicate_heading` (C4, G2)

**The oracle** (brief): `runner/core/plan-index.ts` is the contract for what the runner refuses;
CommonMark is not. The validator accepting a plan the runner refuses is a bug; refusing an
ambiguous plan the runner accepts is by design.

The runner's `resolveOne` looks the task's heading text up among every heading in the file, at
any level, outside the runner's own fences, and refuses a text with two matches. The validator's
mirror already builds the runner's heading list (`runner_headings`, `validate-plan.sh:408-424`,
with the runner's heading and fence rules). One line after its `dangling_heading` check counts the
headings whose runner text equals the task's; more than one returns `duplicate_heading`. The
count uses the runner's text (closing `#`s stripped) and the runner's heading list, not the
validator's own section scan, so a heading the validator's fence rule hides but the runner sees
still counts. The refusal lands in the existing `tasks_have_done_block` check, whose detail already
reads "the campaign runner would refuse: […]" with the runner's own problem names; renaming the
check would break its two consumers for no gain.

Fixtures, in the shapes a person produces: a task pasted right after itself (adjacent), an earlier
task pasted again further down (far apart), a copy whose heading differs only by closing `#`s
(the same heading to the runner), and a control with distinct headings. The two-gate test runs the
adjacent and far-apart mutants through both gates: the validator names `duplicate_heading`, and the
runner's `--dry-run` exits 4 naming `duplicate_heading`.

### 4.4 `single-agent` counts build tasks (C5, G3)

**The oracle** (brief): the rubric row and the validator must agree; "build tasks" excludes the
final review task and phase-end governance tasks, as the `subagent-per-task` row already says.

The validator can recognise the final review (`Task N: Final review`, the check `4g` already uses)
but has no way to recognise a governance task: no convention names one. This card adds one, in the
section: a phase-end governance task is headed `Task N: Governance` followed by what it brings up to
date — the form PR #202's own plan already used ("Task 7: Governance for …", "Task 10: Governance
for …"). A short "Build tasks" paragraph after the rubric table defines the term once for both rows;
the `single-agent` row says "At most 2 build tasks" and the `subagent-per-task` row drops its
parenthetical, now said once below the table. The validator counts `single-agent`'s build tasks the
same way (`FINAL_REVIEW_RE` moves up beside a new `GOVERNANCE_TASK_RE`) and names build tasks in its
detail.

The two-gate test's over-limit mutant was 2 build tasks + the review, which this card makes valid on
purpose; it gains a third build task, keeping the assertion's intent (a `single-agent` plan over its
limit fails `single_agent_within_limit`), and a new plan with 2 build tasks and its review passes
both gates.

### 4.5 The supervisor's closing brief quotes Stage D as it is (C6, G6)

`brief.test.ts` holds two rules at once for the closing brief the supervisor hands to a session:
Stage D's three steps appear in it byte-identical to `SKILL.md` (brief-contracts obligation 3), and
the brief is Tribe-free — no word of `plugins/tribe/scripts/tests/runner-driver-only/tribe-lexicon.ts`,
whose list includes "shaman" (runner-driver-only D6). PR #202's new step 1 ends "(the "Ways of work"
section of `agents/shaman.md`)", so no template can satisfy both tests while `SKILL.md` says that:
the prototype copied the step as it stands and the byte test passed while the Tribe-free test failed
(section 3). The fix therefore has two text edits in one task:

1. `SKILL.md` Stage D step 1 points at the rule the card's own plan carries — "end `REVIEW: PASS`
   under the verdict rule of the card's own plan (its `## Way of work`)". That is true for every
   light-mode card: its plan copies the block, and after Task 7 the block states the verdict rule.
   It still names the `## Final review` section, so the Stage D check PR #202 added is unchanged.
2. `brief-closing.md` takes step 1's text from `SKILL.md`, by a script that copies the text between
   the step 1 and step 2 openings.

No runner logic changes: `brief.ts` renders the template as before. This is Amendment A1's
"text only" ruling, with one more text edit than A1 named; see open question Q1.

### 4.6 The verdict rule and the whole-suite run (C7, G5, G7)

**The wording.** In the section's final-review paragraph the reviewer now "rates each finding
Blocker, Should-fix or Optional" — the owner rules' own scale (`~/.claude/rules/*.md`, "how reviewers
grade it") — "and ends its report with `REVIEW: FAIL` when any finding is Should-fix or worse, else
`REVIEW: PASS`", and the paragraph adds: "The ratings decide the verdict, never the reviewer's
discretion: a `REVIEW: PASS` that lists a Should-fix or Blocker finding counts as `REVIEW: FAIL`."
The last sentence makes the executing session, not only the reviewer, apply the rule: a PR #202-style
report is a failed review and opens a fix round. D-F7 adds, before the rating: the reviewer "runs the
repo's whole test suite — its own documented check command — and runs any failing test again on the
base branch; a failure the base branch does not have is at least Should-fix". Both light-mode blocks
carry the same two clauses in their review bullet. The SHIPPED gate (`shaman.md:216-224`) and Stage D
already require the last round to end `REVIEW: PASS`; with the new definition a mislabelled PASS is a
FAIL, so neither gate needs new words.

**This repo's whole suite.** No single documented command covers it: the README's "Development"
block (`README.md:107-123`) names the runner's and the `tribe` command's `bun test`, two of the 39
shell suites, the counter's tests, and an eval run (forbidden here, owner ruling E1). Every package
under `plugins/tribe/scripts/` declares `"test": "bun test"` in its `package.json`, and the repo's own
`pre-gate.sh` sweeps every `test-*.sh` in a tests directory. So this plan's final review runs, as the
whole suite: each package's `bun test` (runner, viewer, `tribe` command, gaps), the remaining bun
tests outside a package (`plugins/tribe/scripts/ways-of-work/`, `plugins/tribe/scripts/tests/`,
`plugins/tribe/scripts/session-hygiene.test.ts`), and every `test-*.sh` under `plugins/*/scripts/tests/`.
Two exclusions, both by ruling: anything under `scripts/evals/` or `plugins/tribe/evals/` (owner ruling
E1 and this card: no eval code runs), and the billed opt-in tests, which skip themselves unless
`TRIBE_REAL_E2E=1` is set. Open question Q2 asks whether to commit this list as one script.

**This plan's own block (brief: "say explicitly how this plan handles it").** `validate-plan.sh`
compares a plan's copy of its mode's block with the block in the section (`mode_block_copied`). This
plan is written today and must pass today's validator, so it carries today's `subagent-per-task`
block. Task 7 changes that block. The same Task 7 script, in the same commit, reads the block before
and after its edit and replaces the old copy in this plan with the new one, refusing unless the old
copy appears exactly once. So at every commit on the branch the plan's copy equals the section's
block, and each task's Done run — which the runner repeats for every earlier task from a clean
checkout of each later commit — sees a consistent pair. The runner itself resolves the task list and
Done commands from the plan file in its `--repo` checkout — the base branch Stage A landed the plan
on — when it loads (`runner/core/loop/run-loop.ts:157-185`), and Task 7 changes no heading and no
Done block, so the edit is invisible to it. The executor, reading the plan in its worktree, runs the final review
(Task 9) under the new block: the rule applies to this card's own review, as the card asks. Task 9
runs `validate-plan.sh` on this plan again and expects `pass`.

### 4.7 Governance (C8)

The tribe README's "Ways of work" section (`plugins/tribe/README.md:219-238`) describes the tools
that keep the definition single: the counter's bullet names what it now counts and the two-line
join; a bullet for the pointer test is added ("Four committed tools"); the validator's bullet adds
"a plan the campaign runner would refuse, duplicate task headings included" and "`single-agent`
over its build-task limit". One task, at the end of the build: every earlier task is one small
phase of the same card, and nothing in between reads the README (the only review is the final one).

## 5. Purity (the golden standard)

The counter's decisions stay in its pure core: `drift-core.ts` takes texts and returns places;
the signals and the join are data and a pure loop. The edge (`drift.ts`: `git ls-files`, file
reads) is unchanged. The pointer test reads repo files — it is a test, at the edge by nature. The
validator's new logic is two pure functions of the plan text (the duplicate count over the runner
headings; the build-task filter over the task titles). The apply scripts in the plan are one-shot
edits, not shipped code.

## 6. Scope fence (from the card, binding) and the adjudication rule

- OUT: runner, watchdog and supervisor **logic**. The one supervisor file this card touches is the
  text template `brief-closing.md` (Amendment A1); `brief.ts` and every `.ts` file under
  `plugins/tribe/scripts/runner/` stay unchanged, and the runner README changes by one paragraph.
- OUT: `.c3/` (#199) — `c3-215` stays the one allowed non-canonical place, so G1's target is 2.
- OUT: reviewer blinding (#198), eval isolation (#203), running evals (owner ruling E1), a test CI
  workflow (Amendment A1: a separate owner call).
- Historical plans, specs and evidence are not rewritten (the parent plan keeps its old block copy).

**REFUTED in advance**, for the final reviewer:

1. Historical files the counter allowlists (`docs/tribe/planning/`, `docs/superpowers/`, `.c3/adr/`,
   `.c3/changes/`, `archive/`, `scripts/evals/baselines/`, `plugins/tribe/evals/`,
   `plugins/tribe/scripts/ways-of-work/`) restating old rules — including the eval fixtures' copies
   of the old blocks in `plugins/tribe/evals/evals.json`, frozen by owner ruling E1.
2. `.c3/c3-2-plugins/c3-215-tribe.md` still restating the rules (#199).
3. Any finding that asks for a runner, watchdog or supervisor logic change — out of the fence; it
   goes to the Shaman as `NEEDS_DIRECTION`, never into a fix round.
4. Test failures that fail identically on `master` @ `b90f1c4` — the D-F7 rule itself counts only
   failures the base branch does not have. Measured while planning: the runner's
   `watchdog-integration.test.ts` "G2 — skip when alive" (2 tests), and the others listed in the
   plan's Global Constraints.
5. The two-gate test's `m-single-three` fixture gaining a third build task (section 4.4: this card
   makes 2 build tasks + the review valid on purpose).
6. `SKILL.md` Stage D step 1 losing its "(the "Ways of work" section of `agents/shaman.md`)" pointer
   (section 4.5: the Tribe-free test forbids the word in the closing brief).

## 7. Evidence plan (before → after, on the same committed tools)

| Goal | Tool | Before (`b90f1c4`) | After |
| --- | --- | --- | --- |
| G1 | `drift.ts --repo .` with the new signals; the baseline is committed by Task 1 as `docs/superpowers/evidence/2026-09-30-ways-of-work-review-fixes-drift-baseline.txt` | 7 places | 2 places (canonical, `c3-215`) |
| G1 | the same with `--also "$HOME/.claude/CLAUDE.md"`, run by the orchestrating Shaman after merge | 8 before merge; 3 after merge, before `./install.sh tribe` | 2 after `./install.sh tribe` |
| G2 | `test-ways-of-work-plans.sh` (the two-gate test) | 15 passed; the duplicate mutants would read validator `pass`, runner exit 4 | 25 passed, 0 failed (the duplicate mutants: validator names `duplicate_heading`, runner exit 4) |
| G3 | `test-validate-plan.sh` | 87 passed; 2 build tasks + review fails | 102 passed, 0 failed |
| G4 | `pointers.test.ts` | the runner README case fails | 5 pass |
| G5, G7 | the section's text, the counter's `review-verdict` hits in the section, this plan's own validator verdict; the real proof is this card's own final review (the whole suite, the verdict rule) and the next card's | 0 hits | 5 hits, the count still 2; `validate-plan.sh` on this plan: `pass` |
| G6 | `brief.test.ts` | 18 pass, 1 fail | 19 pass, 0 fail |

The PR body carries this table with the measured numbers and the `## Final review` section (every
round's `REVIEW:` line and findings). No screenshot applies: every goal is text or a test result.

## 8. Risks and rollback

- **A signal over-matches a future unrelated sentence.** Visible in the counter's report; tightened
  with a pinned test, as the two found while planning were.
- **A signal under-matches a future restatement.** The counter is a heuristic; the final reviewer
  still judges the diff against G1, and the pointer test pins where pointers must be.
- **The Shaman's prompt loses behaviour when restatements become pointers.** Every removed sentence
  has its content in the section of the same file (`shaman.md`), and every pointer names the part it
  defers to. No eval measures it (owner ruling E1); the final reviewer reads each pair.
- **The whole-suite run is long.** Measured on `master`: the runner's `bun test` alone takes about
  5 minutes (1383 tests). The final review splits the suite into bounded commands, each under the
  harness's 10-minute foreground limit.
- **Rollback:** one PR, regular merge; `git revert -m 1 <merge>` restores every file, and
  `./install.sh tribe` then restores the installed snippet (it refreshes the section again).

## 9. Open questions for the Shaman (none blocks the plan; each has a recommendation)

- **Q1 — F6 needs one more text edit than A1 named.** A plain copy of `SKILL.md`'s step 1 into the
  template turns the Tribe-free test red (the word "shaman"). Options: (a) reword step 1's pointer to
  "the verdict rule of the card's own plan (its `## Way of work`)", then copy (planned, Task 6);
  (b) exempt the word from the Tribe-free lexicon (changes the runner-driver-only D6 oracle);
  (c) drop the Final review check from the closing brief (loses PR #202's R2-1 for supervisor-run
  campaigns). Recommendation: (a) — text only, both tests green, the check kept.
- **Q2 — no documented whole-suite command.** Options: (a) this plan's final review runs its own
  41-suite list (planned, Task 9, kept under `$REPORTS`, not committed); (b) commit a `test-all`
  script and name it in the README's "Development" block, so D-F7's "the repo's documented check
  command" exists for every later card. Recommendation: (a) now, (b) as a follow-up paired with the
  owner's test-CI decision (A1).
- **Q3 — slow and unbounded suites.** On `master`, `test-review-cell-v3.sh` ran over 16 minutes
  without finishing (its pass case re-sweeps every shell suite through `pre-gate.sh`), and
  `test-runner-done-negative.sh` took 953 s and failed 3 checks; in both runs `timeout` did not stop
  them at its bound on this machine. The final review's whole-suite step may therefore take long, and
  a suite may outlive its bound. Options: (a) accept, treat both as inherited (Adjudication item 4),
  file a follow-up to make them bounded; (b) exclude them from the whole suite by ruling.
  Recommendation: (a).
- **Q4 — a naming convention for governance tasks.** "Build tasks" is mechanical only if a governance
  task can be recognised; the plan adds "headed `Task N: Governance …`" to the section (the form PR
  #202's plan used). Options: (a) adopt (planned); (b) let `single-agent` exclude only the final
  review. Recommendation: (a).
- **Q5 — inherited failures on `master`, outside this card's fence.** `watchdog-integration.test.ts`
  "G2 — skip when alive" (2 tests), `test-input-asymmetry.sh`, `test-runner-done-negative.sh`,
  `test-review-cell-v3.sh` (Q3). Recommendation: one follow-up issue listing them with their repro
  commands; watchdog and runner code are out of this card.
- **Q6 — signal wording calls made here** (the card gives signal wording to the Shaman): the
  `review-verdict` signal, the two-line join, and `task-limit`'s "build tasks". Recommendation: keep
  all three; the join alone found anti-goal 1's restatement.
