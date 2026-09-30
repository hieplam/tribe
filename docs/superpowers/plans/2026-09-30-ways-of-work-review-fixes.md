# Plan — Ways of work: close the final review's findings on PR #202 (card `ways-of-work-review-fixes`)

> **For the executing session.** This plan is your only instructions. Its `## Way of work` below
> is the `subagent-per-task` block, copied verbatim from the "Ways of work" section of
> `plugins/tribe/agents/shaman.md` — follow it exactly. Task 7 changes that block and re-copies it
> here in the same commit; from then on follow the new copy. Every task ends with a Verify block
> (Goal · Red · Green · Stub check) and a Done section; re-run each Green yourself before starting
> the next task.

**Goal:** the drift counter sees the harness default, the "Who executes" table and the verdict rule,
and no live file outside the canonical section restates them (G1); the runner README points to the
section (G4); `validate-plan.sh` refuses duplicate task headings like the runner (G2); `single-agent`
counts build tasks (G3); the supervisor's closing brief quotes Stage D as `SKILL.md` says it (G6);
the final review's verdict follows its findings' ratings (G5) and it runs the repo's whole test suite
(G7).

**Architecture:** prompt text (pointers, the section's rubric and final-review wording), one pure-core
counter (`drift-core.ts`) and a pointer test, one validator (`validate-plan.sh`) and its two test
suites, one supervisor text template (`brief-closing.md`). No runner, watchdog or supervisor logic
changes; no `.c3/` change; no eval runs.

**Card:** `~/.tribe/-Users-home-repos-tribe/cards/ways-of-work-review-fixes.md` (G1–G7; rulings D-F5,
D-F7, Amendment A1) · **Spec:** `docs/superpowers/specs/2026-09-30-ways-of-work-review-fixes-design.md`
· **Base:** `master` @ `b90f1c4` · **Branch:** `feat/ways-of-work-review-fixes`

## Global Constraints

- Implementer: each task goes to one fresh `general-purpose` subagent, as the Way of work block below
  says — never a tribe agent (`hunter`, `warchief`, `skinner`, `tracker`, `scout`).
- Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).
- This plan runs through the campaign harness as a one-card campaign the Shaman launches with
  `orchestrate-campaign` (card, "Way of work for THIS card"). The runner's executor session works on
  its own card branch in a separate git worktree created from the base branch, and runs every command
  from that worktree's root. The spec and this plan are already on the base branch (Stage A lands
  them). Commits carry no agent co-author line and carry the runner's `Campaign:` trailer. Merge with
  `gh pr merge --merge` (a regular 2-parent merge), on the runner's deliver turn.
- `REPORTS` below means the campaign home's `reports/` directory, which the executor's brief names
  (outside the harness: `~/.tribe/-Users-home-repos-tribe/reports`). Set it once per session:
  `export REPORTS=` followed by that path.
- Once per worktree, before Task 4: `cd plugins/tribe/scripts/runner && bun install --frozen-lockfile`
  (the runner's `node_modules` is gitignored; the two-gate test and `brief.test.ts` run the real
  runner code). Task 9 installs the other packages it tests.
- Shell: this machine's interactive shell wraps `grep`, `ls`, `find` and `git diff`; the plan's
  Green commands use `python3`, `bun` and `bash` scripts where a literal output matters. Done commands
  run under `bash -c`, where every tool is the system one.
- Evals — owner ruling E1, carried by the card: no task runs an eval (no `run_evals.py` call in any
  Red, Green or Done), and nothing under `scripts/evals/` or `plugins/tribe/evals/` is run.
- Every apply script in this plan refuses (exits non-zero, writes nothing more) unless each text it
  replaces matches exactly the stated number of times. If one refuses, the tree is not what this plan
  was written against: stop and end the turn with `NEEDS_DIRECTION:` naming the script and its message.
- Scope fence (card, binding): no runner, watchdog or supervisor logic change — under
  `plugins/tribe/scripts/runner/` only `README.md` and the text template
  `core/supervisor/brief-closing.md` change (Amendment A1); no `.c3/` change (#199); no blinding
  (#198); no eval work (#203, E1); no test CI workflow (A1). Historical plans and specs are not
  rewritten.
- Oracles (brief-contracts.md): for the counter, the card's G1 row — a live sentence restating a
  mode rule, the harness default or the who-executes rule that is not counted is a bug; a pointer that
  is counted is fixed by rewording the pointer, never by weakening a signal. For the validator,
  `runner/core/plan-index.ts` is the contract, CommonMark is not — the validator accepting a plan the
  runner refuses is a bug; refusing an ambiguous plan the runner accepts is by design. For
  `single-agent`, the rubric row and the validator agree: build tasks exclude the final review and
  phase-end governance tasks (`Task N: Governance …`).

## Adjudication (REFUTED in advance, for the final reviewer)

1. Historical files the counter allowlists restating old rules — including the old block copies in
   `plugins/tribe/evals/evals.json` (frozen by owner ruling E1) and PR #202's own plan.
2. `.c3/c3-2-plugins/c3-215-tribe.md` still restating the rules (#199) — G1's target is 2 because of it.
3. A finding that asks for a runner, watchdog or supervisor logic change: out of the fence; it goes to
   the Shaman as `NEEDS_DIRECTION`, never into a fix round.
4. A suite failure that fails the same way on the base branch — D-F7 counts only failures the base
   branch does not have. Measured on `master` @ `b90f1c4` while planning: `watchdog-integration.test.ts`
   "G2 — skip when alive" (2 tests, runner `bun test`); `test-input-asymmetry.sh` (its
   `evals-file-has-52-evals` count); `test-review-cell-v3.sh` does not finish within the 540-second
   bound (its pass case sweeps every shell suite through `pre-gate.sh`). The whole-suite step re-checks
   every failure against the base branch itself; this list only saves time.
5. The two-gate test's `m-single-three` fixture gaining a third build task (Task 5, spec §4.4).
6. `SKILL.md` Stage D step 1 no longer naming `agents/shaman.md` (Task 6, spec §4.5).

## Way of work

Quoted from the card: "`Executor: subagent-per-task` — design settled here, about 5 build tasks in
order (counter signals + rewording, validator duplicate_heading, single-agent count, README pointer,
verdict rule), every defect shows in a task's Green or the two-gate test; no tribe signal (the
validator/runner contract is covered by the two-gate test). Runs through the campaign harness (D7).
Heavier mode would need: none here." Amendment A1 adds G6 and G7.

Against the rubric as the section words it (build tasks only): 7 build tasks in order — Tasks 1–7;
Task 8 is phase-end governance and Task 9 is the final review, neither counted. It runs through the
campaign harness as a one-card campaign the Shaman launches: the runner's executor session is the
orchestrating session the block names, one turn per task, and the runner runs each task's Done
commands itself. The block, copied verbatim from the "Ways of work" section of
`plugins/tribe/agents/shaman.md` (Task 7 replaces this copy with the block it writes, in the same
commit):

Executor: subagent-per-task

- One fresh `general-purpose` subagent per task, in order: it runs the task's Red and sees the stated failure, builds, runs the Green and matches the literal expected output, runs the Done commands, and commits. Never dispatch a tribe agent (`hunter`, `warchief`, `skinner`) for a task. Under the campaign harness the runner's executor session is the orchestrating session, one turn per task, each turn ended with `TASK_DONE <task-id> <branch>`.
- The orchestrating session re-runs each task's Green itself before starting the next task; a Green that does not reproduce sends the task back.
- The last task is the final review: a fresh `general-purpose` reviewer gets the card, this plan and the branch diff, judges the diff against every goal row and the scope fence of the card, re-runs every task's Green and the end-to-end check, and ends with `REVIEW: PASS` or `REVIEW: FAIL` plus findings with evidence. On `REVIEW: FAIL`, dispatch one fresh fix subagent with the findings, re-run the Verify of every task the fix touches, and review again with a fresh reviewer — at most 2 fix rounds, all inside the review task's turn; still failing, stop and escalate to the Shaman (under the harness: end the turn with `NEEDS_DIRECTION:` and the findings). Write every round's report to disk — under the harness, the campaign home's `reports/` directory.
- Then open the PR (under the harness, on the runner's deliver turn) — its body carries a `## Final review` section with every round's `REVIEW:` line and its findings, in order, read from those reports — wait for every check to conclude green, and merge with `gh pr merge --merge`.

Card-specific post-merge steps. The orchestrating Shaman session runs them, after the runner reports
the card shipped and it has re-verified it (`verify-shipped`, then the SHIPPED gate) — never the
headless executor session. From the updated `master` checkout: first run
`bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --also "$HOME/.claude/CLAUDE.md"` and expect
its last line to read `ways-of-work definitions: 3` (the installed copy still holds the old snippet
wording); then run `./install.sh tribe`, which refreshes the snippet's section in `~/.claude/CLAUDE.md`
in place and backs the previous file up to a `CLAUDE.md.bak.` file; then run the counter with `--also`
again and expect `ways-of-work definitions: 2` — the canonical section and `c3-215`, the installed
copy adding no place. The PR body carries the `## Final review` section Task 9 assembles; the Shaman's
SHIPPED gate checks it.

**The block this plan carries, stated** (brief: "say explicitly how this plan handles it"). This plan
passes today's `validate-plan.sh`: it carries today's block. Task 7 rewrites the block in the section;
its script, in the same commit, replaces this plan's copy with the new block, so at every commit on
the branch the copy equals the section and every Done run of an earlier task stays green. The runner
resolved this plan's headings and Done commands from the base branch when it loaded, and Task 7
changes neither. Task 9 runs the validator on this plan again.

## File map

| File | Task | Change |
| --- | --- | --- |
| `plugins/tribe/scripts/ways-of-work/drift-core.ts`, `drift.test.ts` | 1 | the new signals, the extended `task-limit`, the two-line join, and their tests |
| `docs/superpowers/evidence/2026-09-30-ways-of-work-review-fixes-drift-baseline.txt` | 1 | create — the G1 baseline, measured before any rewording |
| `plugins/tribe/agents/shaman.md` (outside "Ways of work") | 2 | 13 restating passages become pointers |
| `plugins/tribe/agents/warchief.md`, `plugins/tribe/skills/orchestrate-campaign/SKILL.md` (lines 8, 62, 728), `plugins/tribe/claude-md/shaman-brainstorm-together.md`, `plugins/tribe/README.md` (lines 51, 215, 221), `plugins/tribe/scripts/runner/README.md` | 3 | pointers; the runner README's pointer (G4) |
| `plugins/tribe/scripts/ways-of-work/pointers.test.ts` | 3 | create — the G4 pointer check |
| `plugins/tribe/scripts/validate-plan.sh`, `plugins/tribe/scripts/tests/test-validate-plan.sh`, `plugins/tribe/scripts/tests/test-ways-of-work-plans.sh` | 4, 5 | `duplicate_heading`; the build-task limit |
| `plugins/tribe/agents/shaman.md` ("Ways of work": the rubric) | 5 | "At most 2 build tasks"; the "Build tasks" paragraph |
| `plugins/tribe/skills/orchestrate-campaign/SKILL.md` (Stage D step 1), `plugins/tribe/scripts/runner/core/supervisor/brief-closing.md` | 6 | the step's pointer reworded; the template's step 1 synced (G6) |
| `plugins/tribe/agents/shaman.md` ("Ways of work": the final review and both light blocks), this plan's `## Way of work` | 7 | the verdict rule and the whole-suite run; the block re-copied |
| `plugins/tribe/README.md` ("Ways of work" section) | 8 | governance — the tools as they now are |
| — | 9 | the final review |

### Task 1: The G1 ratchet — the counter's new signals, and the baseline before any rewording

**Files:** modify `plugins/tribe/scripts/ways-of-work/drift-core.ts` and
`plugins/tribe/scripts/ways-of-work/drift.test.ts`; create
`docs/superpowers/evidence/2026-09-30-ways-of-work-review-fixes-drift-baseline.txt`.

Spec §4.1. The counter gains `harness-default`, `harness-off`, `who-executes` and `review-verdict`,
`task-limit` learns "build tasks", and `hitsIn` matches each line joined with the next one. Then
the counter measures the untouched tree: that output is the G1 baseline, committed before any
rewording (Tasks 2–3 bring it to 2).

- [ ] **Step 1: Write the failing tests** — append them to the test file:

```bash
cat >> plugins/tribe/scripts/ways-of-work/drift.test.ts <<'EOF'

// --- Card ways-of-work-review-fixes (G1): the harness default, who executes, the verdict rule ---
// Oracle: that card's G1 row. Every restating sentence below was live on master @ b90f1c4 and went
// uncounted; every pointer below is the rewording that replaces one of them.

test('the harness, who-executes and verdict signals catch the rule sentences they name', () => {
  const cases: [string, string][] = [
    ['Every approved plan, in every mode, runs through the campaign harness', 'harness-default'],
    ['the campaign harness every approved plan runs through by default, including ONE approved card', 'harness-default'],
    ['a one-card campaign, the default for every way of work', 'harness-default'],
    ['one consolidated report; the default harness for every approved plan', 'harness-default'],
    ['execution follows the block exactly, driven by the campaign harness unless the owner said not to', 'harness-off'],
    ['only when the owner says not to use the harness does it brief', 'harness-off'],
    ['a harness that cannot run blocks the card — never fall back on your own', 'harness-off'],
    ["| No harness, the owner's explicit words only — Mode 1, the owner delegates |", 'harness-off'],
    ["it brief the owner's new session via SendMessage", 'who-executes'],
    ['drive the work from its own session on delegation', 'who-executes'],
    ['or dispatch a full-build Warchief for `tribe`', 'who-executes'],
    ["| the runner's executor session builds inline |", 'who-executes'],
    ['building a `single-agent` plan inline when the owner delegated it', 'who-executes'],
    ['- In this campaign the executor session is the Warchief the block names.', 'who-executes'],
    ["then run the card's own post-merge steps yourself", 'who-executes'],
    ['beyond a delegated no-harness `single-agent` plan', 'who-executes'],
    ['and a Mode 1 `tribe` card run without the campaign harness', 'who-executes'],
    ['| `single-agent` | At most 2 build tasks, roughly 50 changed lines |', 'task-limit'],
    ['3 to about 8 build tasks done in order', 'task-limit'],
    ['ends with `REVIEW: FAIL` when any finding is Should-fix or worse', 'review-verdict'],
    ['a `REVIEW: PASS` that lists a Should-fix finding counts as `REVIEW: FAIL`', 'review-verdict'],
    ['a failure the base branch does not have is at least Should-fix', 'review-verdict'],
  ];
  for (const [line, signal] of cases) expect([line, signalOf(line)]).toEqual([line, expect.arrayContaining([signal])]);
});

test('a pointer to "Ways of work", and a harness that is not the campaign harness, state no rule', () => {
  const pointers = [
    'execute the approved card on the path "Who executes, on each path" in "Ways of work" names, as "The campaign harness" there describes',
    'This step is the no-harness path of "Who executes, on each path" in "Ways of work".',
    'Where that table names a full-build `warchief` instead, it runs under the Shaman ⇄ Warchief contract',
    'the campaign harness of the "Ways of work" section of `agents/shaman.md`, for ONE approved card too',
    '**Scope: Modes 2–3, and every full-build Warchief "Ways of work" has you dispatch in Mode 1.**',
    'on the one path where "Who executes, on each path" in "Ways of work" names your own session as a `single-agent` plan\'s builder',
    'the harness-gap gate runs by default on every PR',
    'resolves to the eval harness default (no `--model` flag passed)',
    'One file that renders correctly with no local build step: inline the CSS and JS',
    '**Should-fix** — the validator does not mirror the runner',
    'D18 is a settled decision that outranks any Should-fix to the contrary',
  ];
  for (const line of pointers) expect([line, signalOf(line)]).toEqual([line, []]);
});

test('a rule sentence wrapped across two lines is caught, on the line it starts on', () => {
  const text = ['intro', 'when the owner delegated the plan and said not to', 'use the campaign harness, you write it', 'end'].join('\n');
  const report = findPlaces([{ path: 'README.md', text }], POLICY);
  expect(report.places[0]?.hits.map((h) => [h.line, h.signal])).toEqual([[2, 'harness-off']]);
});

test('a rule sentence wholly on the next line is that line\'s hit, never counted twice', () => {
  const report = findPlaces([{ path: 'README.md', text: 'intro\na harness that cannot run blocks the card\n' }], POLICY);
  expect(report.places[0]?.hits.map((h) => [h.line, h.signal])).toEqual([[2, 'harness-off']]);
});

test('the join never crosses the canonical section boundary', () => {
  const text = ['## Ways of work', 'this applies to every approved plan', '## The harness', 'nothing'].join('\n');
  const report = findPlaces([{ path: 'agents/shaman.md', text }], POLICY);
  expect(report).toEqual({ count: 0, places: [] });
});
EOF
```

- [ ] **Step 2: Run them and see them fail**

```bash
bun test plugins/tribe/scripts/ways-of-work/drift.test.ts 2>&1 | tail -n 5
```

Expected: ` 16 pass` and ` 3 fail` — the signal test, the wrapped-sentence test and the next-line
test fail; the pointer test and the boundary test pass today (nothing matches yet).

- [ ] **Step 3: Write the new core** — replace the whole file:

```bash
cat > plugins/tribe/scripts/ways-of-work/drift-core.ts <<'EOF'
// drift-core.ts — the PURE core of the ways-of-work drift counter (card ways-of-work-consolidation,
// G1; card ways-of-work-review-fixes, G1). Given file texts and a policy, it lists every place that
// states a way-of-work rule: a mode's rules, the campaign harness default, who executes on each
// path, and the final review's verdict rule. Nothing here touches the filesystem, git, the clock or
// the environment (pure-core.md): drift.ts reads the files and hands their text in.
//
// Oracle: the cards' G1 rows are the contract. A live file that restates a mode's rule, the harness
// default or the who-executes rule and is not listed is a bug (under-check). A pointer that gets
// listed is fixed by rewording the pointer so it defers to the canonical section, never by
// weakening a signal (over-check is visible and cheap).

/** One kind of rule sentence. Each pattern is matched against one line joined with the next one
 * (see `hitsIn`), so a sentence hard-wrapped across two lines is still caught. A pattern carries no
 * `g` flag: `exec` must search each joined line from its start. */
export interface Signal {
  name: string;
  pattern: RegExp;
}

/** The rule sentences a way-of-work definition is made of. A line matching any of these states a
 * mode's rule; outside the canonical section that is a second definition. */
export const SIGNALS: readonly Signal[] = [
  // When to use a mode: the task-count and change-size thresholds.
  { name: 'task-limit', pattern: /\b(?:at most|up to|no more than|fewer than|less than)\s*(?:2|two|3|three)\s+(?:build\s+)?tasks\b|[≤<]=?\s*(?:2|3)\s+(?:build\s+)?tasks\b|\b3\s*(?:to|-|–)\s*(?:~\s*|about\s+)?8\s+(?:build\s+)?tasks\b/i },
  { name: 'line-limit', pattern: /\b50\s+changed\s+lines\b/i },
  // How a light mode runs: its review and fix-round cap, and who implements each task.
  { name: 'fix-round-cap', pattern: /\b(?:at most|up to|no more than)\s+(?:one|1|two|2)\s+fix[- ]rounds?\b|[≤<]=?\s*(?:1|2)\s+fix[- ]rounds?\b|\bfix[- ]round cap\s+(?:of\s+)?(?:1|2|one|two)\b/i },
  { name: 'implementer-rule', pattern: /\b(?:one|a)\s+(?:fresh\s+)?(?:implementer|`?general-purpose`?)(?:\s+subagent)?\s+per\s+task\b|\bone\s+fresh\s+subagent\s+per\s+task\b|\bgiv(?:e|ing)\s+each\s+task\s+to\s+one\b|\bbuilds?\s+(?:every|each)\s+task\s+itself\b/i },
  // Who may choose the heavy mode: the retired "only when the owner asks" rule.
  { name: 'owner-must-ask', pattern: /\bunless\s+the\s+owner\s+(?:explicitly\s+)?(?:asks|says)\b|\bonly\s+when\s+the\s+owner\s+asks\b|\bthe\s+owner\s+named\s+no\s+style\b/i },
  // The retired second vocabulary: the campaign's plan styles.
  { name: 'plan-style', pattern: /\b(?:simple|tribe)\s+style\b|\bsimple\s+by\s+default\b|\bHow to work\b/i },
  // The rubric's own wording for the heavy mode and the tie-break.
  { name: 'rubric', pattern: /\bcould\s+pass\s+every\s+Verify\s+block\b|\bpick\s+the\s+lighter\s+mode\b/i },
  // The campaign harness, the default for every mode (never the eval harness, never the
  // harness-gap gate).
  { name: 'harness-default', pattern: /\bharness\b(?!-)[^.;]{0,80}?\b(?:by\s+default|the\s+default)\b|\bdefault\s+harness\b|\bdefault\s+for\s+every\s+(?:mode|way\s+of\s+work|approved\s+plan)\b|\bevery\s+(?:approved\s+)?(?:plan|mode|way\s+of\s+work)\b[^.;]{0,60}?\bharness\b(?!-)|\bharness\b(?!-)[^.;]{0,60}?\bevery\s+(?:mode|way\s+of\s+work|approved\s+plan)\b/i },
  // Only the owner's explicit words turn the harness off; a harness that cannot run blocks the card
  // and never falls back to an in-session path.
  { name: 'harness-off', pattern: /\b(?:unless|only\s+when|until)\s+the\s+(?:owner|user)\b[^.;]{0,50}?\b(?:not\s+to|don't|do\s+not)\b|\b(?:not\s+to|don't|do\s+not)\s+use\s+the\s+(?:campaign\s+|`?orchestrate-campaign`?\s+)?harness\b|\bowner's\s+explicit\s+(?:words|no-harness)\b|\bharness\s+that\s+cannot\s+run\b|\bnever\s+fall\s+back\b|\bfall(?:s|ing)?\s+back\s+(?:to|on)\s+(?:an?\s+in-session|step\s+6|your\s+own)\b/i },
  // Who executes, on each path: the runner's executor session, the owner's new session, the
  // Shaman's own session, the full-build Warchief the Shaman dispatches, who runs the post-merge
  // steps — and a mode named together with the no-harness path, which names one cell of that table.
  { name: 'who-executes', pattern: /\bowner's\s+new\s+(?:named\s+|execution\s+)?session\b|\bowner\s+opens\s+a\s+new\b|\b(?:your|its)\s+own\s+session\s+(?:builds|orchestrates|on\s+delegation)\b|\bfrom\s+(?:your|its)\s+own\s+session\b|\bdispatch(?:es)?\s+(?:its\s+)?(?:one\s+|a\s+)?full-build\b|\bexecutor\s+session\s+(?:acts\s+as|is)\s+(?:that|the)\s+Warchief\b|\bbuil(?:d|ds|t|ding)\s+(?:(?:a|the|every|each)\s+[^.;:]{0,30}?\s+)?inline\b|\bpost-merge\s+steps\b[^.;]{0,40}?\b(?:yourself|itself)\b|\bno-harness\s+`?(?:single-agent|subagent-per-task|tribe)\b|\b(?:single-agent|subagent-per-task|tribe)`?\s+(?:card|plan)\s+(?:run\s+)?without\s+the\s+(?:campaign\s+)?harness\b/i },
  // The final review's verdict rule: the ratings decide it, never the reviewer's discretion.
  { name: 'review-verdict', pattern: /\bShould-fix\s+or\s+worse\b|\bany\s+(?:Blocker\s+or\s+)?Should-fix\b[^.;]{0,60}?\bREVIEW:\s*FAIL\b|\bREVIEW:\s*PASS`?\s+that\s+lists\b|\bat\s+least\s+(?:a\s+)?Should-fix\b/i },
];

export interface FileText {
  /** Repo-relative path, forward slashes. */
  path: string;
  text: string;
}

export interface DriftPolicy {
  /** The one file allowed to define the ways of work. */
  canonicalPath: string;
  /** The heading text of the defining section inside that file. */
  canonicalHeading: string;
  /** Path prefixes never scanned: history, evidence, and the counter's own signals + fixtures. */
  allowPrefixes: readonly string[];
}

export interface Hit {
  line: number;
  signal: string;
  text: string;
}

/** A place that states way-of-work rules: a whole file, or the canonical section of the canonical file. */
export interface Place {
  path: string;
  /** true only for the canonical section itself — the one allowed definition. */
  canonical: boolean;
  hits: Hit[];
}

export interface DriftReport {
  /** Number of places that define the ways of work. The goal is exactly 1: the canonical section. */
  count: number;
  places: Place[];
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/** 0-based [start, end) line range of the section whose heading text is `heading`, or null when the
 * file has no such heading. Fence-aware: a heading inside a fenced block is content, not structure. */
export function sectionRange(lines: readonly string[], heading: string): [number, number] | null {
  let open: { ch: string; len: number } | null = null;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = FENCE_RE.exec(line);
    if (open !== null) {
      if (fence && (fence[1] as string)[0] === open.ch && (fence[1] as string).length >= open.len && (fence[2] as string).trim() === '') open = null;
      continue;
    }
    if (fence) {
      open = { ch: (fence[1] as string)[0] as string, len: (fence[1] as string).length };
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (!h) continue;
    const hLevel = (h[1] as string).length;
    if (start < 0) {
      if ((h[2] as string) === heading) {
        start = i;
        level = hLevel;
      }
    } else if (hLevel <= level) {
      return [start, i];
    }
  }
  return start < 0 ? null : [start, lines.length];
}

/** The hits of lines [from, to). Prose is hard-wrapped, so a rule sentence can break across two
 * lines: each line is matched joined with the next line of the same range, and a hit belongs to the
 * line its match starts on — a sentence wholly on the next line is that line's hit, never both. */
function hitsIn(lines: readonly string[], from: number, to: number): Hit[] {
  const hits: Hit[] = [];
  for (let i = from; i < to; i++) {
    const text = lines[i] as string;
    const joined = i + 1 < to ? `${text} ${(lines[i + 1] as string).trimStart()}` : text;
    for (const signal of SIGNALS) {
      const match = signal.pattern.exec(joined);
      if (match !== null && match.index < text.length) hits.push({ line: i + 1, signal: signal.name, text: text.trim() });
    }
  }
  return hits;
}

/** Lists every place that states a way-of-work rule. Allowlisted paths are skipped; in the
 * canonical file, the canonical section is its own place, and everything outside it is a second one. */
export function findPlaces(files: readonly FileText[], policy: DriftPolicy): DriftReport {
  const places: Place[] = [];
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    if (policy.allowPrefixes.some((prefix) => file.path.startsWith(prefix))) continue;
    const lines = file.text.split('\n');
    const range = file.path === policy.canonicalPath ? sectionRange(lines, policy.canonicalHeading) : null;
    if (range === null) {
      const hits = hitsIn(lines, 0, lines.length);
      if (hits.length > 0) places.push({ path: file.path, canonical: false, hits });
      continue;
    }
    const inside = hitsIn(lines, range[0], range[1]);
    const outside = [...hitsIn(lines, 0, range[0]), ...hitsIn(lines, range[1], lines.length)];
    if (inside.length > 0) places.push({ path: `${file.path}#${policy.canonicalHeading}`, canonical: true, hits: inside });
    if (outside.length > 0) places.push({ path: file.path, canonical: false, hits: outside });
  }
  return { count: places.length, places };
}

/** The human-readable report: one line per place, then the count. */
export function renderReport(report: DriftReport): string {
  const lines = report.places.map((p) => `${p.canonical ? 'canonical ' : 'restates  '} ${p.path} (${p.hits.length} line${p.hits.length === 1 ? '' : 's'})`);
  lines.push(`ways-of-work definitions: ${report.count}`);
  return lines.join('\n');
}
EOF
```

- [ ] **Step 4: Measure the baseline on the untouched tree and commit it as evidence**

```bash
mkdir -p docs/superpowers/evidence
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --verbose > docs/superpowers/evidence/2026-09-30-ways-of-work-review-fixes-drift-baseline.txt
head -n 8 docs/superpowers/evidence/2026-09-30-ways-of-work-review-fixes-drift-baseline.txt
```

Expected, exactly:

```text
restates   .c3/c3-2-plugins/c3-215-tribe.md (7 lines)
restates   plugins/tribe/README.md (5 lines)
canonical  plugins/tribe/agents/shaman.md#Ways of work (32 lines)
restates   plugins/tribe/agents/shaman.md (23 lines)
restates   plugins/tribe/agents/warchief.md (2 lines)
restates   plugins/tribe/claude-md/shaman-brainstorm-together.md (3 lines)
restates   plugins/tribe/skills/orchestrate-campaign/SKILL.md (3 lines)
ways-of-work definitions: 7
```

#### Verify

- Goal: G1's ratchet — the counter with the new signals, measured on `b90f1c4` before any
  rewording (the card: "expected > 2").
- Red: `bun test plugins/tribe/scripts/ways-of-work/drift.test.ts` before Step 3 → ` 16 pass`,
  ` 3 fail` (Step 2).
- Green: `bun test plugins/tribe/scripts/ways-of-work/drift.test.ts 2>&1 | tail -n 5` →
  ` 19 pass`, ` 0 fail`, exit 0; and Step 4's `head -n 8` prints the eight lines above, the last
  `ways-of-work definitions: 7`.
- Stub check: with the old core (or an empty `SIGNALS` entry for each new name) the three failing
  tests stay red, and the counter reads `ways-of-work definitions: 2` — the number that hid F1.

#### Done

```bash
bun test plugins/tribe/scripts/ways-of-work/drift.test.ts
python3 -c "import sys; t=open('docs/superpowers/evidence/2026-09-30-ways-of-work-review-fixes-drift-baseline.txt', encoding='utf-8').read().splitlines(); sys.exit(0 if t[7] == 'ways-of-work definitions: 7' and t[3].startswith('restates   plugins/tribe/agents/shaman.md ') else 1)"
```

- [ ] **Step 5: Commit**

```bash
git add plugins/tribe/scripts/ways-of-work/drift-core.ts plugins/tribe/scripts/ways-of-work/drift.test.ts docs/superpowers/evidence/2026-09-30-ways-of-work-review-fixes-drift-baseline.txt
git commit -m "feat(ways-of-work): count the harness default, who executes and the verdict rule; G1 baseline 7"
```

### Task 2: `shaman.md` outside "Ways of work" points to the section

**Files:** modify `plugins/tribe/agents/shaman.md` — only outside its "Ways of work" section.

Spec §4.2. Thirteen passages that restate the harness default or the "Who executes" table become
pointers; each keeps its job (the description still says what Mode 1 does, anti-goals 1–2 keep the
owner's scoped exception, step 6 keeps its whole procedure). The section itself does not change.

- [ ] **Step 1: See the restating place**

```bash
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo .
```

Expected: the seven places of Task 1's baseline, among them
`restates   plugins/tribe/agents/shaman.md (23 lines)`.

- [ ] **Step 2: Apply the rewording** — save the script and run it:

```bash
mkdir -p "$REPORTS"
cat > "$REPORTS/wowrf-task2.py" <<'PY'
# Task 2: shaman.md outside "Ways of work" points to that section instead of restating the
# harness default and the "Who executes" table. Each pair must match exactly once.
path = "plugins/tribe/agents/shaman.md"
PAIRS = [
    (  # frontmatter description: the scoped exception
        "  never code (one scoped exception: building a `single-agent` plan inline when the owner\n"
        "  delegated its execution without the campaign harness). Three modes.",
        "  never code (one scoped exception: the one path its \"Ways of work\" section's \"Who executes\"\n"
        "  table gives the Shaman's own session). Three modes.",
    ),
    (  # frontmatter description: Mode 1's execution
        "  run the approved card itself through the orchestrate-campaign harness, a one-card campaign and\n"
        "  the default for every way of work, on the way of work the Shaman chose from the rubric in its\n"
        "  \"Ways of work\" section (`single-agent`, `subagent-per-task` or `tribe`), answering the runner's\n"
        "  escalations and re-verifying the result; only when the owner says not to use the harness does\n"
        "  it brief the owner's new session via SendMessage, drive the work from its own session on\n"
        "  delegation, or dispatch a full-build Warchief for `tribe`. Mode 2",
        "  run the approved card on the way of work the Shaman chose from the rubric in its \"Ways of\n"
        "  work\" section (`single-agent`, `subagent-per-task` or `tribe`), on the path that section's\n"
        "  \"Who executes\" table names, answering escalations and re-verifying the result. Mode 2",
    ),
    (  # frontmatter description: the NOT-for clause
        "How, writing source code (beyond a delegated no-harness `single-agent` plan), or reviewing",
        "How, writing source code (beyond the one exception its \"Ways of work\" section names), or reviewing",
    ),
    (  # opening: Mode 1 delivery
        "starts, dispatch the Warchief, rule on its questions, and keep the roadmap true; in Mode 1 the\n"
        "work runs through the campaign harness on the way of work you chose for the card (see \"Ways of\n"
        "work\"). You never design the **How**, and you write source code only when you build a delegated\n"
        "`single-agent` plan without the harness (anti-goal 2).",
        "starts, dispatch the Warchief, rule on its questions, and keep the roadmap true; in Mode 1 the\n"
        "work runs on the way of work you chose for the card, on the path \"Ways of work\" names. You\n"
        "never design the **How**, and you write source code only on the one path anti-goal 2 names.",
    ),
    (  # the Shaman ⇄ Warchief contract's scope
        "**Scope: Modes 2–3, and a Mode 1 `tribe` card run without the campaign harness.** This contract\n"
        "governs roadmap cards run as a campaign, and the full-build Warchief a no-harness `tribe` card\n"
        "runs on. Otherwise Mode 1 dispatches only a planning-only Warchief, and its execution runs through\n"
        "the campaign harness (see \"Ways of work\").",
        "**Scope: Modes 2–3, and every full-build Warchief \"Ways of work\" has you dispatch in Mode 1.**\n"
        "This contract governs roadmap cards run as a campaign, and each such full-build Warchief.\n"
        "Otherwise Mode 1 dispatches only a planning-only Warchief, and its execution follows \"Ways of\n"
        "work\".",
    ),
    (  # anti-goal 1's scoped exception
        "(Scoped exception, owner ruling\n"
        "   2026-09-29: when the owner delegated a `single-agent` plan's execution to you and said not to\n"
        "   use the campaign harness, you write its code exactly as the plan's tasks say — the plan holds\n"
        "   the How, you design none of it.)",
        "(Scoped exception, owner ruling\n"
        "   2026-09-29: on the one path where \"Who executes, on each path\" in \"Ways of work\" names your\n"
        "   own session as a `single-agent` plan's builder, you write its code exactly as the plan's tasks\n"
        "   say — the plan holds the How, you design none of it.)",
    ),
    (  # anti-goal 2's scoped exception
        "(The same scoped exception:\n"
        "   a delegated `single-agent` plan run without the campaign harness is built inline by the\n"
        "   executing session, which is yours — see \"Ways of work\".)",
        "(The same scoped exception,\n"
        "   and only on that one path of \"Who executes, on each path\" in \"Ways of work\".)",
    ),
    (  # Mode 1 step 5: running the approved card
        "On the owner's go, or on delegation, run the approved card yourself through the campaign harness\n"
        "(\"The campaign harness\" in \"Ways of work\"): the `orchestrate-campaign` skill on this one card. The\n"
        "plan is already approved, so Stage A skips authorship: it lands the spec and plan on the base\n"
        "branch, writes the campaign state and the `answers.md` scaffold, dry-runs and launches. Answer the\n"
        "runner's escalations within your authority, re-verify the card SHIPPED (`verify-shipped` first,\n"
        "then \"The Goal · Verify · Ratchet gate\"), then run the card's own post-merge steps yourself. The\n"
        "owner watches in the viewer. Step 6 applies only when the owner has said explicitly not to use\n"
        "the harness; a harness that cannot run blocks the card — tell the owner what is missing, never\n"
        "fall back to step 6 on your own.",
        "On the owner's go, or on delegation, execute the approved card on the path \"Who executes, on\n"
        "each path\" in \"Ways of work\" names, as \"The campaign harness\" there describes, and re-verify it\n"
        "SHIPPED (`verify-shipped` first, then \"The Goal · Verify · Ratchet gate\"). Step 6 is that\n"
        "table's no-harness path.",
    ),
    (  # Mode 1 step 6: when it applies, and who runs the plan
        "Only when the owner has said explicitly not to use the campaign harness. The owner opens a new\n"
        "named session to run the plan. You brief and guide that session through\n"
        "`SendMessage`:",
        "This step is the no-harness path of \"Who executes, on each path\" in \"Ways of work\". You brief\n"
        "and guide the execution session that table names through\n"
        "`SendMessage`:",
    ),
    (  # Mode 1 step 6: a tribe plan
        "(`verify-shipped` first). A `tribe` plan has no execution session to brief: on the owner's go you\n"
        "dispatch its one full-build `warchief` yourself, under the Shaman ⇄ Warchief contract (see\n"
        "\"Ways of work\"), and tell the owner how to watch it.",
        "(`verify-shipped` first). Where that table names a full-build `warchief` instead, it runs under\n"
        "the Shaman ⇄ Warchief contract, and you tell the owner how to watch it.",
    ),
    (  # "Mode 1 executes the plan's way of work": opening
        "copied from \"Ways of work\", driven by the campaign harness unless the owner said not to, on the\n"
        "path that section's \"Who executes\" table names. This outranks every section of this file that\n"
        "describes delivery for Modes 2–3.",
        "copied from \"Ways of work\", on the path that section's \"Who executes\" table names. This\n"
        "outranks every section of this file that describes delivery for Modes 2–3.",
    ),
    (  # "Mode 1 executes the plan's way of work": what you dispatch
        "- **Run the harness; dispatch nothing else.** Beyond the planning-only Warchief of step 4, you\n"
        "  run `orchestrate-campaign` on the approved card, and the runner spawns the executor session\n"
        "  that follows the block. Only on the owner's explicit no-harness path do you brief a session\n"
        "  (step 6), build a `single-agent` plan yourself (on delegation), or dispatch one full-build\n"
        "  `warchief` for a `tribe` card — and even then every Hunter, Skinner, Tracker or Scout stays\n"
        "  inside that Warchief's loop, never dispatched by you.",
        "- **Run only what the \"Who executes\" table names.** Beyond the planning-only Warchief of step 4,\n"
        "  you run what that table names for the card's path and mode, and nothing else: every Hunter,\n"
        "  Skinner, Tracker or Scout stays inside a full-build Warchief's loop, never dispatched by you.",
    ),
    (  # Definition of done (Mode 1)
        "the owner approved execution or delegated it in their own words; the\n"
        "card ran through the campaign harness you launched — or, on the owner's explicit no-harness path,\n"
        "the path \"Ways of work\" names — until its result is verified-`SHIPPED` and its post-merge steps\n"
        "have run.",
        "the owner approved execution or delegated it in their own words; the\n"
        "card ran on the path \"Who executes, on each path\" in \"Ways of work\" names until its result is\n"
        "verified-`SHIPPED` and its post-merge steps have run.",
    ),
]
text = open(path, encoding="utf-8").read()
for old, new in PAIRS:
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {text.count(old)}: {old[:60]!r}")
    text = text.replace(old, new)
open(path, "w", encoding="utf-8").write(text)
print(f"{path}: {len(PAIRS)} replacements")
PY
python3 "$REPORTS/wowrf-task2.py"
```

Expected: `plugins/tribe/agents/shaman.md: 13 replacements`.

#### Verify

- Goal: G1 — `shaman.md` outside the canonical section no longer restates the harness default or
  the who-executes rules.
- Red: `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo .` before Step 2 lists
  `restates   plugins/tribe/agents/shaman.md (23 lines)` and ends `ways-of-work definitions: 7`.
- Green: `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --json | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['count'], any(p['path'] == 'plugins/tribe/agents/shaman.md' for p in r['places']))"`
  → `6 False`; and `python3 -c "import subprocess; head=subprocess.run(['git','show','HEAD:plugins/tribe/agents/shaman.md'],capture_output=True,text=True,check=True,timeout=30).stdout; now=open('plugins/tribe/agents/shaman.md',encoding='utf-8').read(); sec=lambda t: t[t.index('## Ways of work'):t.index('## Anti-goals')]; print('section unchanged:', sec(head) == sec(now))"`
  → `section unchanged: True`.
- Stub check: without the rewording the counter still lists `plugins/tribe/agents/shaman.md` and
  prints `7 True`; deleting the passages instead of rewording them would pass the counter but break
  the file's meaning — the final review reads each pair (spec §4.2).

#### Done

```bash
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --json | python3 -c "import json,sys; r=json.load(sys.stdin); sys.exit(1 if any(p['path'] == 'plugins/tribe/agents/shaman.md' for p in r['places']) else 0)"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/tribe/agents/shaman.md
git commit -m "docs(shaman): point to Ways of work for the harness default and who executes"
```

### Task 3: The other live files point to the section; the runner README gains its pointer

**Files:** modify `plugins/tribe/agents/warchief.md`, `plugins/tribe/skills/orchestrate-campaign/SKILL.md`,
`plugins/tribe/claude-md/shaman-brainstorm-together.md`, `plugins/tribe/README.md`,
`plugins/tribe/scripts/runner/README.md`; create `plugins/tribe/scripts/ways-of-work/pointers.test.ts`.

Spec §4.2. The last restating passages outside the section become pointers (G1), and the runner
README gains one paragraph naming the section (G4). The pointer test pins every file that must point.

- [ ] **Step 1: Write the pointer test**

```bash
cat > plugins/tribe/scripts/ways-of-work/pointers.test.ts <<'EOF'
// pointers.test.ts — every live file that must point to the one definition of the ways of work
// names it (card ways-of-work-review-fixes, G4; the list is card ways-of-work-consolidation's D1:
// the Warchief, orchestrate-campaign, the global CLAUDE.md snippet and the READMEs). The drift
// counter proves these files do not restate the section; this proves they point to it.
// `.c3/c3-2-plugins/c3-215-tribe.md` is left out on purpose: its pointer is issue #199's work.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const MUST_POINT = [
  'plugins/tribe/agents/warchief.md',
  'plugins/tribe/skills/orchestrate-campaign/SKILL.md',
  'plugins/tribe/claude-md/shaman-brainstorm-together.md',
  'plugins/tribe/README.md',
  'plugins/tribe/scripts/runner/README.md',
];

test.each(MUST_POINT)('%s names the "Ways of work" section of shaman.md', (path) => {
  const text = readFileSync(join(REPO_ROOT, path), 'utf8');
  expect(text).toContain('"Ways of work"');
  expect(text).toContain('shaman.md');
});
EOF
bun test plugins/tribe/scripts/ways-of-work/pointers.test.ts 2>&1 | tail -n 5
```

Expected: ` 4 pass`, ` 1 fail` — the runner README names no "Ways of work".

- [ ] **Step 2: Apply the rewording** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task3.py" <<'PY'
# Task 3: the other live files point to "Ways of work" instead of restating the harness default
# and the "Who executes" table; the runner README gains its pointer (G4). Each pair must match
# exactly once.
EDITS = {
    "plugins/tribe/agents/warchief.md": [
        (
            "Every approved plan runs through the campaign harness unless the owner said not to, so a planned\n"
            "`tribe` plan also copies orchestrate-campaign's \"tribe cards — campaign plan additions\" after its\n"
            "block and ends with the Harness-gap gate task given there.",
            "A planned `tribe` plan also copies orchestrate-campaign's \"tribe cards — campaign plan additions\"\n"
            "after its block and ends with the Harness-gap gate task given there, as \"The campaign harness\" in\n"
            "that section requires.",
        ),
    ],
    "plugins/tribe/skills/orchestrate-campaign/SKILL.md": [
        (
            "  the campaign harness every approved plan runs through by default, including ONE approved card:",
            "  the campaign harness of the \"Ways of work\" section of `agents/shaman.md`, for ONE approved card too:",
        ),
        (
            "0. **A card whose spec and plan are already approved** — a Shaman's Mode 1 card, run through this\n"
            "   harness by default (\"The campaign harness\" in `agents/shaman.md` \"Ways of work\") — skips",
            "0. **A card whose spec and plan are already approved** — a Shaman's Mode 1 card, run through this\n"
            "   harness as \"The campaign harness\" in `agents/shaman.md` \"Ways of work\" says — skips",
        ),
        (
            "- In this campaign the executor session is the Warchief the block names. The runner still drives\n"
            "  the tasks in order and runs each task's Done commands itself; end a task's turn only after its\n"
            "  audit closed.",
            "- The runner still drives the tasks in order and runs each task's Done commands itself; end a\n"
            "  task's turn only after its audit closed.",
        ),
    ],
    "plugins/tribe/claude-md/shaman-brainstorm-together.md": [
        (
            "6. **Run it through the campaign harness, never by checklist.** On the owner's go, or on delegation, run the approved card yourself with the `orchestrate-campaign` skill — a one-card campaign; answer its escalations within your authority, re-verify the result, then run the card's post-merge steps yourself; a harness that cannot run blocks the card — tell the owner what is missing, never fall back on your own. Never give the owner shell commands to run or a directive to paste. Tell the owner how to WATCH the work: the consolidated campaign viewer (`plugins/tribe/scripts/viewer`, session page `/s/<sessionId>`). Only when the owner says explicitly not to use the harness: the owner opens a new named session and you brief and guide it via `SendMessage` (a `tribe` plan: you dispatch its full-build `warchief` yourself).",
            "6. **Execute it on the path \"Ways of work\" names, never by checklist.** On the owner's go, or on delegation, execute the approved card on the path \"Who executes, on each path\" in the \"Ways of work\" section of `~/.claude/agents/shaman.md` names, as \"The campaign harness\" there describes (the `orchestrate-campaign` skill); answer escalations within your authority and re-verify the result. Never give the owner shell commands to run or a directive to paste. Tell the owner how to WATCH the work: the consolidated campaign viewer (`plugins/tribe/scripts/viewer`, session page `/s/<sessionId>`).",
        ),
        (
            "and execution follows the block exactly, driven by the campaign harness unless the owner said not to. What each mode does, when to use it, the harness and the fix-round cap are defined in that section only.",
            "and execution follows the block exactly. What each mode does, when to use it, the harness, who executes and the fix-round cap are defined in that section only.",
        ),
    ],
    "plugins/tribe/README.md": [
        (
            "then runs the approved card itself through the `orchestrate-campaign` harness — a one-card campaign, the default for every way of work — answers the runner's escalations and re-verifies the result; only when the owner says not to use the harness does it brief the owner's new execution session, drive the execution itself, or dispatch a full-build Warchief. The three ways of work — `single-agent`, `subagent-per-task` and `tribe` — the rubric for choosing one and who chooses are defined once, in the \"Ways of work\" section of `agents/shaman.md`;",
            "then executes the approved card on the path the \"Ways of work\" section of `agents/shaman.md` names, answers escalations and re-verifies the result. The campaign harness, the three ways of work — `single-agent`, `subagent-per-task` and `tribe` — the rubric for choosing one, who chooses and who executes are defined once, in that section;",
        ),
        (
            "one consolidated report; the default harness for every approved plan |",
            "one consolidated report; the campaign harness of the \"Ways of work\" section |",
        ),
        (
            "How an approved plan is executed — the campaign harness every plan runs through by default,\n"
            "`single-agent`, `subagent-per-task` or `tribe`, the rubric for choosing one, and who chooses — is\n"
            "defined in exactly one place:",
            "How an approved plan is executed — the campaign harness, `single-agent`, `subagent-per-task` or\n"
            "`tribe`, the rubric for choosing one, who chooses and who executes — is\n"
            "defined in exactly one place:",
        ),
    ],
    "plugins/tribe/scripts/runner/README.md": [
        (
            "`actOnCard`). The session keeps its own context across turns, so the next task knows what the\n"
            "previous one did.\n",
            "`actOnCard`). The session keeps its own context across turns, so the next task knows what the\n"
            "previous one did.\n"
            "\n"
            "How the session works inside those turns — the plan's mode, who builds and who reviews — is the\n"
            "plan's own `## Way of work`, defined in the \"Ways of work\" section of\n"
            "[`agents/shaman.md`](../../agents/shaman.md). The runner reads only the task headings and the\n"
            "Done sections below.\n",
        ),
    ],
}
for path, pairs in EDITS.items():
    text = open(path, encoding="utf-8").read()
    for old, new in pairs:
        if text.count(old) != 1:
            raise SystemExit(f"{path}: expected exactly one match, found {text.count(old)}: {old[:60]!r}")
        text = text.replace(old, new)
    open(path, "w", encoding="utf-8").write(text)
    print(f"{path}: {len(pairs)} replacement(s)")
PY
python3 "$REPORTS/wowrf-task3.py"
```

Expected: five lines, `plugins/tribe/agents/warchief.md: 1 replacement(s)`, `…/SKILL.md: 3 replacement(s)`,
`…/shaman-brainstorm-together.md: 2 replacement(s)`, `plugins/tribe/README.md: 3 replacement(s)`,
`plugins/tribe/scripts/runner/README.md: 1 replacement(s)`.

#### Verify

- Goal: G1 — no live file outside the canonical section restates the harness default or the
  who-executes rules, except `c3-215` (#199); G4 — the runner README points to the section.
- Red: `bun test plugins/tribe/scripts/ways-of-work/pointers.test.ts` → ` 4 pass`, ` 1 fail`
  (Step 1); `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo .` ends `ways-of-work definitions: 6`.
- Green: `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo .` prints exactly
  `restates   .c3/c3-2-plugins/c3-215-tribe.md (7 lines)`,
  `canonical  plugins/tribe/agents/shaman.md#Ways of work (32 lines)` and
  `ways-of-work definitions: 2`; `bun test plugins/tribe/scripts/ways-of-work/ 2>&1 | tail -n 5` →
  ` 24 pass`, ` 0 fail`.
- Stub check: an empty commit leaves the counter at 6 and the runner README case red; adding the
  words "Ways of work" to the runner README without the other rewording leaves the counter at 6.

#### Done

```bash
bun test plugins/tribe/scripts/ways-of-work/
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --json | python3 -c "import json,sys; r=json.load(sys.stdin); p=sorted((x['path'], x['canonical']) for x in r['places']); sys.exit(0 if r['count'] == 2 and p == [('.c3/c3-2-plugins/c3-215-tribe.md', False), ('plugins/tribe/agents/shaman.md#Ways of work', True)] else 1)"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/tribe/agents/warchief.md plugins/tribe/skills/orchestrate-campaign/SKILL.md plugins/tribe/claude-md/shaman-brainstorm-together.md plugins/tribe/README.md plugins/tribe/scripts/runner/README.md plugins/tribe/scripts/ways-of-work/pointers.test.ts
git commit -m "docs(tribe): every live file points to Ways of work; the runner README too (G1 2, G4)"
```

### Task 4: `validate-plan.sh` refuses two identical task headings, as the runner does

**Files:** modify `plugins/tribe/scripts/validate-plan.sh`, `plugins/tribe/scripts/tests/test-validate-plan.sh`,
`plugins/tribe/scripts/tests/test-ways-of-work-plans.sh`.

Spec §4.3. Oracle: `runner/core/plan-index.ts` `resolveOne` — a heading text matching two headings
is `duplicate_heading`. Fixtures in the shapes a copy-paste produces: adjacent, far apart, and a copy
differing only by closing `#`s; the two-gate test sends the adjacent and far-apart mutants through
both gates.

- [ ] **Step 1: Write the failing tests** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task4-tests.py" <<'PY'
# Task 4 tests: the duplicate_heading probes (validator suite) and the two mutants (two-gate test).
VALIDATOR_TEST = "plugins/tribe/scripts/tests/test-validate-plan.sh"
TWO_GATE_TEST = "plugins/tribe/scripts/tests/test-ways-of-work-plans.sh"

VALIDATOR_ANCHOR = "whole_probe tribe u u\n"
VALIDATOR_PROBES = r'''
# --- The runner's duplicate_heading refusal (plan-index.ts resolveOne), mirrored ------------
# The runner resolves a task by its heading text and refuses a text that matches two headings;
# accepting such a plan is the under-read the Done mirror's oracle calls a bug.
dup_probe() { # dup_probe NAME WANT-STATUS TASKS-FN — a subagent-per-task plan whose tasks TASKS-FN prints
  local f="$TMP/dup-$RANDOM.md"
  { wow_plan subagent-per-task "$HUNTER" cat; "$3"; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$1" "$(find_check "$f.json" tasks_have_done_block)" "$2"
  if [[ "$2" == fail ]]; then
    check "$1 — names duplicate_heading" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('duplicate_heading' in [c['detail'] for c in d['checks'] if c['name']=='tasks_have_done_block'][0])" "$f.json")" "True"
  fi
}
dup_adjacent() { task_with 1 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; review_task 4; }
dup_far_apart() { task_with 1 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; task_with 3 "$TMP/vb.md"; task_with 1 "$TMP/vb.md"; review_task 5; }
dup_closing_hashes() { task_with 1 "$TMP/vb.md" | sed '1s/$/ ##/'; task_with 1 "$TMP/vb.md"; review_task 3; }
dup_none() { task_with 1 "$TMP/vb.md"; task_with 2 "$TMP/vb.md"; review_task 3; }
dup_probe "two identical task headings side by side fail, as the runner refuses them" fail dup_adjacent
dup_probe "two identical task headings far apart fail too" fail dup_far_apart
dup_probe "a heading that differs only by closing #s is the same heading to the runner" fail dup_closing_hashes
dup_probe "distinct task headings pass" pass dup_none
'''

TWO_GATE_FIXTURE_ANCHOR = '''sys.stdout.write(t[:i] + t[j:])" > "$P/m-no-done.md"
'''
TWO_GATE_FIXTURES = r'''# Two identical task headings, the shapes a copy-paste produces: a task pasted right after itself,
# and an earlier task pasted again further down.
plan subagent-per-task cat 'Build one' 'Build two' 'Final review' | python3 -c "
import sys
t = sys.stdin.read()
i = t.index('### Task 2: '); j = t.index('### Task 3: ', i)
sys.stdout.write(t[:j] + t[i:j] + t[j:])" > "$P/m-dup-adjacent.md"
plan subagent-per-task cat 'Build one' 'Build two' 'Final review' | python3 -c "
import sys
t = sys.stdin.read()
i = t.index('### Task 1: '); j = t.index('### Task 2: ', i); k = t.index('### Task 3: ', j)
sys.stdout.write(t[:k] + t[i:j] + t[k:])" > "$P/m-dup-far-apart.md"
'''

TWO_GATE_CHECK_ANCHOR = '''check "a task without the runner's Done section: the runner names missing_done" "$(grep -c 'missing_done' "$TMP/h-no-done.err")" "1"
'''
TWO_GATE_CHECKS = r'''for shape in adjacent far-apart; do
  check "two identical task headings ($shape): named check" "$(failing "m-dup-$shape")" "tasks_have_done_block"
  check "two identical task headings ($shape): the validator names duplicate_heading" "$(bash "$VALIDATE" "$P/m-dup-$shape.md" | grep -c 'duplicate_heading')" "1"
  home "$TMP/h-dup-$shape" "C1=m-dup-$shape"
  check "two identical task headings ($shape): runner --dry-run exit" "$(dry_run "$TMP/h-dup-$shape")" "4"
  check "two identical task headings ($shape): the runner names duplicate_heading" "$(grep -c 'duplicate_heading' "$TMP/h-dup-$shape.err")" "1"
done
'''

def replace_once(path, old, new):
    text = open(path, encoding="utf-8").read()
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {text.count(old)}: {old[:60]!r}")
    open(path, "w", encoding="utf-8").write(text.replace(old, new))
    print(f"{path}: replaced {old.splitlines()[0][:50]!r}")

def insert_after(path, anchor, addition):
    text = open(path, encoding="utf-8").read()
    if text.count(anchor) != 1:
        raise SystemExit(f"{path}: expected the anchor exactly once, found {text.count(anchor)}: {anchor[:60]!r}")
    open(path, "w", encoding="utf-8").write(text.replace(anchor, anchor + addition))
    print(f"{path}: inserted after {anchor.splitlines()[0][:50]!r}")

insert_after(VALIDATOR_TEST, VALIDATOR_ANCHOR, VALIDATOR_PROBES)
insert_after(TWO_GATE_TEST, TWO_GATE_FIXTURE_ANCHOR, TWO_GATE_FIXTURES)
insert_after(TWO_GATE_TEST, TWO_GATE_CHECK_ANCHOR, TWO_GATE_CHECKS)
replace_once(
    TWO_GATE_TEST,
    "# Each mutant must fail with a NAMED reason: the validator's failing check, and for a task with\n"
    "# no Done section also the runner's own refusal. A three-card campaign, one card per mode, must\n",
    "# Each mutant must fail with a NAMED reason: the validator's failing check, and for a task with\n"
    "# no Done section, or two identical task headings, also the runner's own refusal. A three-card\n"
    "# campaign, one card per mode, must\n",
)
PY
python3 "$REPORTS/wowrf-task4-tests.py"
bash plugins/tribe/scripts/tests/test-validate-plan.sh | tail -n 1
bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh | tail -n 2
```

Expected: `88 passed, 6 failed`; then `19 passed, 4 failed` and `V-WOW=FAIL` — every validator-side
duplicate check fails (the validator passes the plan); the runner-side checks already pass (exit 4,
`duplicate_heading`).

- [ ] **Step 2: Mirror the refusal** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task4.py" <<'PY'
# Task 4: validate-plan.sh mirrors the runner's duplicate_heading refusal (plan-index.ts resolveOne).
path = "plugins/tribe/scripts/validate-plan.sh"
PAIRS = [
    (
        "#   - each task section carries the campaign runner's Done section, read exactly the way\n"
        "#     runner/core/plan-index.ts reads it, so the same plan also passes the runner's --dry-run\n",
        "#   - each task section resolves the way the campaign runner resolves it (runner/core/plan-index.ts):\n"
        "#     its heading matches no other heading in the file, and its Done section is read exactly the\n"
        "#     way the runner reads it, so the same plan also passes the runner's --dry-run\n",
    ),
    (
        "# names are the runner's own, so a failure here reads the same as the runner's refusal:\n"
        "#   - the task's heading must be a heading to the runner too (else dangling_heading);\n",
        "# names are the runner's own, so a failure here reads the same as the runner's refusal:\n"
        "#   - the task's heading must be a heading to the runner too (else dangling_heading), and its\n"
        "#     text — the runner's text, closing #s stripped — must match no other heading in the file,\n"
        "#     at any level, outside the runner's fences (else duplicate_heading: the runner cannot tell\n"
        "#     which of the two sections is the task);\n",
    ),
    (
        "    if task is None:\n"
        "        return \"dangling_heading\"\n",
        "    if task is None:\n"
        "        return \"dangling_heading\"\n"
        "    if sum(1 for h in runner_headings if h[\"text\"] == task[\"text\"]) > 1:\n"
        "        return \"duplicate_heading\"\n",
    ),
]
text = open(path, encoding="utf-8").read()
for old, new in PAIRS:
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {text.count(old)}: {old[:60]!r}")
    text = text.replace(old, new)
open(path, "w", encoding="utf-8").write(text)
print(f"{path}: {len(PAIRS)} replacements")
PY
python3 "$REPORTS/wowrf-task4.py"
```

Expected: `plugins/tribe/scripts/validate-plan.sh: 3 replacements`.

#### Verify

- Goal: G2 — `validate-plan.sh` refuses a plan with two identical task headings, naming
  `duplicate_heading`, exactly as the runner does.
- Red: `bash plugins/tribe/scripts/tests/test-validate-plan.sh | tail -n 1` → `88 passed, 6 failed`;
  `bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh | tail -n 2` → `19 passed, 4 failed`,
  `V-WOW=FAIL` (Step 1).
- Green: `bash plugins/tribe/scripts/tests/test-validate-plan.sh | tail -n 1` → `94 passed, 0 failed`;
  `bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh | tail -n 2` → `23 passed, 0 failed`
  and `V-WOW=PASS`.
- Stub check: today's validator passes both duplicate mutants (`verdict: pass`), so the six validator
  probes and the four validator-side two-gate checks stay red.

#### Done

```bash
bash plugins/tribe/scripts/tests/test-validate-plan.sh
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh
```

- [ ] **Step 3: Commit**

```bash
git add plugins/tribe/scripts/validate-plan.sh plugins/tribe/scripts/tests/test-validate-plan.sh plugins/tribe/scripts/tests/test-ways-of-work-plans.sh
git commit -m "fix(validate-plan): refuse duplicate task headings, as the runner does (G2)"
```

### Task 5: `single-agent` counts build tasks, in the rubric and in the validator

**Files:** modify `plugins/tribe/scripts/validate-plan.sh`, `plugins/tribe/scripts/tests/test-validate-plan.sh`,
`plugins/tribe/scripts/tests/test-ways-of-work-plans.sh`, and the rubric in the "Ways of work" section
of `plugins/tribe/agents/shaman.md`.

Spec §4.4. Oracle: the rubric row and the validator agree — build tasks exclude the final review
(`Task N: Final review`) and phase-end governance tasks (`Task N: Governance …`). The two-gate test's
over-limit mutant gains a third build task: this card makes 2 build tasks + the review valid on purpose.

- [ ] **Step 1: Write the failing tests** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task5-tests.py" <<'PY'
# Task 5 tests: single-agent counts build tasks (validator suite, two-gate test).
def replace_once(path, old, new):
    text = open(path, encoding="utf-8").read()
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {text.count(old)}: {old[:60]!r}")
    open(path, "w", encoding="utf-8").write(text.replace(old, new))
    print(f"{path}: replaced {old.splitlines()[0][:60]!r}")

VALIDATOR_TEST = "plugins/tribe/scripts/tests/test-validate-plan.sh"
TWO_GATE_TEST = "plugins/tribe/scripts/tests/test-ways-of-work-plans.sh"

# The validator suite: a governance task helper, and the single-agent limit counted in build tasks.
replace_once(VALIDATOR_TEST, "whole_probe tribe u u\n", r'''whole_probe tribe u u

# --- single-agent counts build tasks: the final review and governance tasks do not count -------
# gov_task N — a phase-end governance task, complete: its heading starts "Task N: Governance".
gov_task() {
  printf '### Task %s: Governance — the READMEs\n\n' "$1"; verify_block
  printf '#### Done\n\n```bash\ntrue\n```\n\n- [ ] **Step 2: Commit**\n\n```bash\ngit commit -m "docs: %s"\n```\n\n' "$1"
}
limit_probe() { # limit_probe NAME WANT TASKS... — a single-agent plan; TASKS are u (build), g (governance), r (final review)
  local f="$TMP/limit-$RANDOM.md" name="$1" want="$2" n=0; shift 2
  { wow_plan single-agent "$HUNTER" cat
    for kind in "$@"; do n=$((n+1))
      case "$kind" in r) review_task "$n" ;; g) gov_task "$n" ;; *) task_with "$n" "$TMP/vb.md" ;; esac
    done; } > "$f"
  bash "$SCRIPT" "$f" > "$f.json"
  check "$name" "$(find_check "$f.json" single_agent_within_limit)" "$want"
  check "$name — verdict" "$(jget "$f.json" verdict)" "$want"
}
limit_probe "single-agent: 2 build tasks and the final review pass" pass u u r
limit_probe "single-agent: 3 build tasks and the final review fail" fail u u u r
limit_probe "single-agent: 2 build tasks, a governance task and the final review pass" pass u u g r
limit_probe "single-agent: 3 build tasks, a governance task and the final review fail" fail u u u g r
''')

# The two-gate test: the over-limit mutant gains its third build task (the plan changes that
# behaviour on purpose: 2 build tasks + the review is now within the limit), and a single-agent
# plan with 2 build tasks and its review passes both gates.
replace_once(TWO_GATE_TEST,
    "plan single-agent cat 'Build one' 'Build two' 'Final review' > \"$P/m-single-three.md\"\n",
    "plan single-agent cat 'Build one' 'Build two' 'Final review' > \"$P/single-agent-two.md\"\n"
    "plan single-agent cat 'Build one' 'Build two' 'Build three' 'Final review' > \"$P/m-single-three.md\"\n")
replace_once(TWO_GATE_TEST,
    "check \"single-agent with 3 tasks: named check\" \"$(failing m-single-three)\" \"single_agent_within_limit\"\n",
    "check \"single-agent with 3 build tasks and its final review: named check\" \"$(failing m-single-three)\" \"single_agent_within_limit\"\n")
replace_once(TWO_GATE_TEST,
    "# --- Each mutant fails with a named reason --------------------------------------------------\n",
    "# --- single-agent's limit counts build tasks: 2 of them and the final review pass both gates --\n"
    "check \"single-agent plan, 2 build tasks and its final review: validate-plan.sh verdict\" \"$(verdict single-agent-two)\" \"pass\"\n"
    "home \"$TMP/h-single-agent-two\" \"C1=single-agent-two\"\n"
    "check \"single-agent plan, 2 build tasks and its final review: runner --dry-run exit\" \"$(dry_run \"$TMP/h-single-agent-two\")\" \"0\"\n"
    "\n"
    "# --- Each mutant fails with a named reason --------------------------------------------------\n")
PY
python3 "$REPORTS/wowrf-task5-tests.py"
bash plugins/tribe/scripts/tests/test-validate-plan.sh | tail -n 1
bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh | tail -n 2
```

Expected: `98 passed, 4 failed` (both passing shapes fail today, each on the limit and the verdict);
then `24 passed, 1 failed` and `V-WOW=FAIL` (the 2-build-task plan's validator verdict).

- [ ] **Step 2: Count build tasks** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task5.py" <<'PY'
# Task 5: single-agent's limit counts build tasks, in the validator and in the rubric row.
def replace_once(path, old, new, count=1):
    text = open(path, encoding="utf-8").read()
    if text.count(old) != count:
        raise SystemExit(f"{path}: expected {count} match(es), found {text.count(old)}: {old[:60]!r}")
    open(path, "w", encoding="utf-8").write(text.replace(old, new))
    print(f"{path}: replaced {old.splitlines()[0][:60]!r}")

VALIDATOR = "plugins/tribe/scripts/validate-plan.sh"
replace_once(VALIDATOR,
    "#     or \"Executor: tribe\" (the modes of shaman.md \"Ways of work\"), and single-agent stays within\n"
    "#     its task limit (SINGLE_AGENT_MAX_TASKS below)\n",
    "#     or \"Executor: tribe\" (the modes of shaman.md \"Ways of work\"), and single-agent stays within\n"
    "#     its build-task limit (SINGLE_AGENT_MAX_BUILD_TASKS below; the final review and phase-end\n"
    "#     governance tasks do not count)\n")
replace_once(VALIDATOR,
    "# definition of the modes and their rubric — this check reads only the declaration). The\n"
    "# single-agent task limit below mirrors that section's rubric; the change-size half of the\n"
    "# rubric is judged by the plan reviewer, not here.\n",
    "# definition of the modes and their rubric — this check reads only the declaration). The\n"
    "# single-agent limit below mirrors that section's rubric, which counts build tasks: every task\n"
    "# except the final review (\"Task N: Final review\") and a phase-end governance task (\"Task N:\n"
    "# Governance ...\"). The change-size half of the rubric is judged by the plan reviewer, not here.\n")
replace_once(VALIDATOR,
    "SINGLE_AGENT_MAX_TASKS = 2\n",
    "SINGLE_AGENT_MAX_BUILD_TASKS = 2\n"
    "FINAL_REVIEW_RE = re.compile(r\"^task\\s+\\d+\\s*[:.\\u2013\\u2014-]\\s*final review\\b\", re.IGNORECASE)\n"
    "GOVERNANCE_TASK_RE = re.compile(r\"^task\\s+\\d+\\s*[:.\\u2013\\u2014-]\\s*governance\\b\", re.IGNORECASE)\n")
replace_once(VALIDATOR,
    "single_agent_over_limit = executor == \"single-agent\" and len(task_sections) > SINGLE_AGENT_MAX_TASKS\n"
    "checks.append({\n"
    "    \"name\": \"single_agent_within_limit\",\n"
    "    \"status\": \"fail\" if single_agent_over_limit else \"pass\",\n"
    "    \"detail\": f\"single-agent allows at most {SINGLE_AGENT_MAX_TASKS} tasks; this plan has \"\n"
    "              f\"{len(task_sections)}\" if single_agent_over_limit\n"
    "              else f\"executor {executor or 'undeclared'}, {len(task_sections)} task(s)\",\n"
    "})\n",
    "build_tasks = [s for s in task_sections\n"
    "               if not FINAL_REVIEW_RE.match(s[\"title\"]) and not GOVERNANCE_TASK_RE.match(s[\"title\"])]\n"
    "single_agent_over_limit = executor == \"single-agent\" and len(build_tasks) > SINGLE_AGENT_MAX_BUILD_TASKS\n"
    "checks.append({\n"
    "    \"name\": \"single_agent_within_limit\",\n"
    "    \"status\": \"fail\" if single_agent_over_limit else \"pass\",\n"
    "    \"detail\": f\"single-agent allows at most {SINGLE_AGENT_MAX_BUILD_TASKS} build tasks (the final review \"\n"
    "              f\"and governance tasks do not count); this plan has {len(build_tasks)}\" if single_agent_over_limit\n"
    "              else f\"executor {executor or 'undeclared'}, {len(build_tasks)} build task(s) of \"\n"
    "                   f\"{len(task_sections)} task(s)\",\n"
    "})\n")
replace_once(VALIDATOR,
    "# no such task — the Warchief's own audit reviews it.\n"
    "FINAL_REVIEW_RE = re.compile(r\"^task\\s+\\d+\\s*[:.\\u2013\\u2014-]\\s*final review\\b\", re.IGNORECASE)\n",
    "# no such task — the Warchief's own audit reviews it. FINAL_REVIEW_RE is defined with the\n"
    "# single-agent limit (4c).\n")

SHAMAN = "plugins/tribe/agents/shaman.md"
replace_once(SHAMAN,
    "| `single-agent` | At most 2 tasks, roughly 50 changed lines outside tests,",
    "| `single-agent` | At most 2 build tasks, roughly 50 changed lines outside tests,")
replace_once(SHAMAN,
    "3 to about 8 build tasks done in order (the final review and phase-end governance tasks do not count), and every defect",
    "3 to about 8 build tasks done in order, and every defect")
replace_once(SHAMAN,
    "**Tie-break.** When two modes fit,",
    "**Build tasks.** Both task limits count build tasks: every task except the final review\n"
    "(`Task N: Final review`) and a phase-end governance task, headed `Task N: Governance` followed by\n"
    "what it brings up to date. `validate-plan.sh` counts the `single-agent` limit this way.\n"
    "\n"
    "**Tie-break.** When two modes fit,")
PY
python3 "$REPORTS/wowrf-task5.py"
```

Expected: eight `replaced` lines, five for `validate-plan.sh` and three for `shaman.md`.

#### Verify

- Goal: G3 — a `single-agent` plan with 2 build tasks plus its final review passes validation; 3
  build tasks plus the review fail; the rubric row says build tasks, like the `subagent-per-task` row.
- Red: `bash plugins/tribe/scripts/tests/test-validate-plan.sh | tail -n 1` → `98 passed, 4 failed`;
  `bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh | tail -n 2` → `24 passed, 1 failed`,
  `V-WOW=FAIL` (Step 1).
- Green: `bash plugins/tribe/scripts/tests/test-validate-plan.sh | tail -n 1` → `102 passed, 0 failed`;
  `bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh | tail -n 2` → `25 passed, 0 failed`,
  `V-WOW=PASS`; `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . | tail -n 1` →
  `ways-of-work definitions: 2`.
- Stub check: a rubric-only edit leaves the validator counting 3 sections (the two passing shapes
  stay red); a validator that skips only the final review fails the governance shape.

#### Done

```bash
bash plugins/tribe/scripts/tests/test-validate-plan.sh
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
bash plugins/tribe/scripts/tests/test-ways-of-work-plans.sh
python3 -c "import sys; t=open('plugins/tribe/agents/shaman.md', encoding='utf-8').read(); sys.exit(0 if 'At most 2 build tasks, roughly 50 changed lines' in t and '**Build tasks.**' in t else 1)"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/tribe/scripts/validate-plan.sh plugins/tribe/scripts/tests/test-validate-plan.sh plugins/tribe/scripts/tests/test-ways-of-work-plans.sh plugins/tribe/agents/shaman.md
git commit -m "fix(ways-of-work): single-agent counts build tasks, in the rubric and the validator (G3)"
```

### Task 6: The supervisor's closing brief quotes Stage D as `SKILL.md` says it

**Files:** modify `plugins/tribe/skills/orchestrate-campaign/SKILL.md` (Stage D step 1) and
`plugins/tribe/scripts/runner/core/supervisor/brief-closing.md` (a text template — no `.ts` file changes).

Spec §4.5, Amendment A1 (F6). `brief.test.ts` requires the closing brief to quote Stage D byte for
byte AND to stay Tribe-free (no word of `tests/runner-driver-only/tribe-lexicon.ts`, "shaman"
included). PR #202's step 1 names `agents/shaman.md`, so the step first points at the rule the card's
own plan carries; then the template takes the step's text.

- [ ] **Step 1: See the test fail**

```bash
(cd plugins/tribe/scripts/runner && bun install --frozen-lockfile) && bun test plugins/tribe/scripts/runner/core/supervisor/brief.test.ts 2>&1 | tail -n 5
```

Expected: ` 18 pass`, ` 1 fail` — "contains Stage D's three numbered steps, byte-identical to SKILL.md".

- [ ] **Step 2: Reword the step's pointer and sync the template** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task6.py" <<'PY'
# Task 6 (G6, Amendment A1): the supervisor's closing brief quotes orchestrate-campaign's Stage D step 1 byte for
# byte (brief.test.ts is the oracle), and that brief must stay Tribe-free (the same test file: no
# word of tests/runner-driver-only/tribe-lexicon.ts, "shaman" included). PR #202's step 1 names
# `agents/shaman.md`, so a plain copy breaks the second test: the step first points at the rule the
# card's own plan carries, then the template takes the step's text. Text only — no runner logic.
SKILL = "plugins/tribe/skills/orchestrate-campaign/SKILL.md"
BRIEF = "plugins/tribe/scripts/runner/core/supervisor/brief-closing.md"
START = "1. **For every card the report marks `shipped`"
END = "2. **You can also recover which commits belong to this campaign directly from git.**"
POINTER_OLD = (
    "   the PR body (`gh pr view <pr> --json body`): its `## Final review` section must exist and end\n"
    "   `REVIEW: PASS` (the \"Ways of work\" section of `agents/shaman.md`); a missing or failing section\n"
    "   is reported as `blocked`, not `shipped`.\n"
)
POINTER_NEW = (
    "   the PR body (`gh pr view <pr> --json body`): its `## Final review` section must exist and end\n"
    "   `REVIEW: PASS` under the verdict rule of the card's own plan (its `## Way of work`); a missing\n"
    "   or failing section is reported as `blocked`, not `shipped`.\n"
)

def step_one(text, path):
    if text.count(START) != 1 or text.count(END) != 1:
        raise SystemExit(f"{path}: expected Stage D's step 1 and step 2 openings exactly once")
    return text[text.index(START):text.index(END)]

skill = open(SKILL, encoding="utf-8").read()
if skill.count(POINTER_OLD) != 1:
    raise SystemExit(f"{SKILL}: expected Stage D step 1's pointer exactly once")
skill = skill.replace(POINTER_OLD, POINTER_NEW)
brief = open(BRIEF, encoding="utf-8").read()
current, stale = step_one(skill, SKILL), step_one(brief, BRIEF)
open(SKILL, "w", encoding="utf-8").write(skill)
open(BRIEF, "w", encoding="utf-8").write(brief.replace(stale, current))
print(f"{SKILL}: Stage D step 1 points at the card's plan; {BRIEF}: step 1 synced")
PY
python3 "$REPORTS/wowrf-task6.py"
```

Expected: `plugins/tribe/skills/orchestrate-campaign/SKILL.md: Stage D step 1 points at the card's plan; plugins/tribe/scripts/runner/core/supervisor/brief-closing.md: step 1 synced`.

#### Verify

- Goal: G6 — the supervisor's closing brief quotes Stage D exactly as `SKILL.md` says it, the Final
  review check included.
- Red: `bun test plugins/tribe/scripts/runner/core/supervisor/brief.test.ts` → ` 18 pass`, ` 1 fail`
  (Step 1).
- Green: `bun test plugins/tribe/scripts/runner/core/supervisor/brief.test.ts 2>&1 | tail -n 5` →
  ` 19 pass`, ` 0 fail`; `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh | tail -n 1` →
  `41 passed, 0 failed`; `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . | tail -n 1` →
  `ways-of-work definitions: 2`.
- Stub check: an empty commit keeps ` 1 fail`; copying the step without rewording its pointer turns
  the byte test green and the Tribe-free test red (measured while planning) — still ` 1 fail`.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
bun test plugins/tribe/scripts/runner/core/supervisor/brief.test.ts
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
```

- [ ] **Step 3: Commit**

```bash
git add plugins/tribe/skills/orchestrate-campaign/SKILL.md plugins/tribe/scripts/runner/core/supervisor/brief-closing.md
git commit -m "fix(supervisor): the closing brief quotes Stage D as SKILL.md says it (G6)"
```

### Task 7: The final review's verdict follows the ratings, and it runs the whole suite

**Files:** modify the "Ways of work" section of `plugins/tribe/agents/shaman.md` (the final-review
paragraph and the review bullet of both light-mode blocks), and this plan's `## Way of work` copy of
the `subagent-per-task` block — in the same commit.

Spec §4.6. D-F5: each finding is rated Blocker, Should-fix or Optional, and any Should-fix or worse
makes the verdict `REVIEW: FAIL`; a `REVIEW: PASS` that lists one counts as `REVIEW: FAIL`. D-F7: the
reviewer runs the repo's whole test suite and runs any failing test again on the base branch; a
failure the base branch does not have is at least Should-fix. The script reads the block before and
after its edit and re-copies it into this plan, so `validate-plan.sh` passes on this plan at every
commit.

- [ ] **Step 1: See the rule missing**

```bash
python3 -c "t=open('plugins/tribe/agents/shaman.md', encoding='utf-8').read(); s=t[t.index('## Ways of work'):t.index('## Anti-goals')]; print(s.count('when any finding is Should-fix or worse'), s.count('Blocker finding counts as'), s.count('whole test suite'))"
```

Expected: `0 0 0`.

- [ ] **Step 2: Write the rule and re-copy the block** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task7.py" <<'PY'
# Task 7: the final review's verdict rule and whole-suite run (card ways-of-work-review-fixes, G5 and
# G7, rulings D-F5 and D-F7) — in the "Ways of work" paragraph and in both light-mode blocks — and,
# in the same commit, this plan's own
# copy of the subagent-per-task block re-copied from the changed section, so validate-plan.sh keeps
# passing on this plan at every commit.
import re

SHAMAN = "plugins/tribe/agents/shaman.md"
PLAN = "docs/superpowers/plans/2026-09-30-ways-of-work-review-fixes.md"

def block_of(text, mode):
    """The mode's block from the "Ways of work" section, as a plan copies it (the lines between
    the ```markdown fence and its close)."""
    lines = text.splitlines()
    start = lines.index("## Ways of work")
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^#{1,2} ", lines[i])), len(lines))
    for body in re.findall(r"^```markdown\n(.*?)^```$", "\n".join(lines[start:end]), re.S | re.M):
        if body.startswith(f"Executor: {mode}\n"):
            return body.rstrip("\n")
    raise SystemExit(f"no {mode} block in {SHAMAN}")

PAIRS = [  # (old, new, expected match count)
    (
        "plan's end-to-end check, and ends its report with `REVIEW: PASS` or `REVIEW: FAIL` followed by its\n"
        "findings, each with evidence (a `file:line` or a command's output). On `REVIEW: FAIL` the executing\n"
        "session runs a fix round — `subagent-per-task` dispatches one fresh fix subagent with the findings,\n",
        "plan's end-to-end check, runs the repo's whole test suite — its documented check command, or the\n"
        "list the plan names — and runs any failing test again on the base branch, rates each finding\n"
        "Blocker, Should-fix or Optional (a failure the base branch does not have is at least Should-fix),\n"
        "and ends its report with `REVIEW: FAIL` when any finding is Should-fix or worse, else\n"
        "`REVIEW: PASS`, followed by its findings, each with its rating and evidence (a `file:line` or a\n"
        "command's output). The ratings decide the verdict, never the reviewer's discretion: a\n"
        "`REVIEW: PASS` that lists a Should-fix or Blocker finding counts as `REVIEW: FAIL`. On\n"
        "`REVIEW: FAIL` the executing session runs a fix round — `subagent-per-task` dispatches one\n"
        "fresh fix subagent with the findings,\n",
        1,
    ),
    (
        "re-runs every task's Green and the end-to-end check, and ends with `REVIEW: PASS` or `REVIEW: FAIL` plus findings with evidence. On `REVIEW: FAIL`,",
        "re-runs every task's Green and the end-to-end check, runs the repo's whole test suite — its documented check command, or the list this plan names — and runs any failing test again on the base branch, rates each finding Blocker, Should-fix or Optional (a failure the base branch does not have is at least Should-fix), and ends with `REVIEW: FAIL` when any finding is Should-fix or worse, else `REVIEW: PASS`, plus the findings with their ratings and evidence; a `REVIEW: PASS` that lists a Should-fix or Blocker finding counts as `REVIEW: FAIL`. On `REVIEW: FAIL`,",
        2,  # the single-agent block and the subagent-per-task block
    ),
]

shaman = open(SHAMAN, encoding="utf-8").read()
old_block = block_of(shaman, "subagent-per-task")
for old, new, count in PAIRS:
    if shaman.count(old) != count:
        raise SystemExit(f"{SHAMAN}: expected {count} match(es), found {shaman.count(old)}: {old[:60]!r}")
    shaman = shaman.replace(old, new)
new_block = block_of(shaman, "subagent-per-task")
plan = open(PLAN, encoding="utf-8").read()
if plan.count(old_block) != 1:
    raise SystemExit(f"{PLAN}: expected this plan to carry the old subagent-per-task block once, found {plan.count(old_block)}")
open(SHAMAN, "w", encoding="utf-8").write(shaman)
open(PLAN, "w", encoding="utf-8").write(plan.replace(old_block, new_block))
print(f"{SHAMAN}: the final review paragraph and both light blocks carry the verdict rule")
print(f"{PLAN}: the subagent-per-task block re-copied")
PY
python3 "$REPORTS/wowrf-task7.py"
```

Expected: `plugins/tribe/agents/shaman.md: the final review paragraph and both light blocks carry the verdict rule`
and `docs/superpowers/plans/2026-09-30-ways-of-work-review-fixes.md: the subagent-per-task block re-copied`.

#### Verify

- Goal: G5 — a final review with any Should-fix (or worse) finding ends `REVIEW: FAIL` and triggers a
  fix round; G7 — the final review runs the repo's whole test suite and a new failure fails it. The
  real proof is this card's own Task 9 and the next card's review (no eval run, owner ruling E1).
- Red: `python3 -c "t=open('plugins/tribe/agents/shaman.md', encoding='utf-8').read(); s=t[t.index('## Ways of work'):t.index('## Anti-goals')]; print(s.count('when any finding is Should-fix or worse'), s.count('Blocker finding counts as'), s.count('whole test suite'))"` → `0 0 0` (Step 1).
- Green: the same command → `3 3 3` (the paragraph and both blocks); `bash plugins/tribe/scripts/validate-plan.sh docs/superpowers/plans/2026-09-30-ways-of-work-review-fixes.md | python3 -c "import json,sys; print(json.load(sys.stdin)['verdict'])"`
  → `pass`; `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . | tail -n 1` →
  `ways-of-work definitions: 2`.
- Stub check: an empty commit prints `0 0 0`; editing the section without re-copying the block makes
  `validate-plan.sh` on this plan fail `mode_block_copied`.

#### Done

```bash
python3 -c "import sys; t=open('plugins/tribe/agents/shaman.md', encoding='utf-8').read(); s=t[t.index('## Ways of work'):t.index('## Anti-goals')]; sys.exit(0 if (s.count('when any finding is Should-fix or worse'), s.count('Blocker finding counts as'), s.count('whole test suite')) == (3, 3, 3) else 1)"
bash plugins/tribe/scripts/validate-plan.sh docs/superpowers/plans/2026-09-30-ways-of-work-review-fixes.md | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin)['verdict'] == 'pass' else 1)"
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --json | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin)['count'] == 2 else 1)"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/tribe/agents/shaman.md docs/superpowers/plans/2026-09-30-ways-of-work-review-fixes.md
git commit -m "feat(ways-of-work): the review verdict follows the ratings and the whole suite runs (G5, G7)"
```

### Task 8: Governance — the tribe README describes the tools as they now are

**Files:** modify `plugins/tribe/README.md` (its "Ways of work" section only).

Spec §4.7. Phase-end governance for the whole build: the counter's bullet names what it counts and
the two-line join, the pointer test gets its bullet, and the validator's bullet adds the runner's
refusals and the build-task limit — without restating any rule (the counter proves it).

- [ ] **Step 1: See the section out of date**

```bash
python3 -c "t=open('plugins/tribe/README.md', encoding='utf-8').read(); s=t[t.index('## Ways of work'):]; s=s[:s.index('---')]; print('pointers.test.ts' in s, 'identical task headings' in s, 'reading each line together with the next' in s)"
```

Expected: `False False False`.

- [ ] **Step 2: Update the section** — save the script and run it:

```bash
cat > "$REPORTS/wowrf-task8.py" <<'PY'
# Task 8: governance — the tribe README's "Ways of work" section describes the tools as they now are.
path = "plugins/tribe/README.md"
PAIRS = [
    (
        "`## Way of work`. Three committed tools keep that true:\n"
        "\n"
        "- [`scripts/ways-of-work/drift.ts`](scripts/ways-of-work/drift.ts) lists every live file that\n"
        "  states a way-of-work rule (`bun plugins/tribe/scripts/ways-of-work/drift.ts --repo .`;\n",
        "`## Way of work`. Four committed tools keep that true:\n"
        "\n"
        "- [`scripts/ways-of-work/drift.ts`](scripts/ways-of-work/drift.ts) lists every live file that\n"
        "  states a way-of-work rule — a mode's rules, the campaign harness, who executes on each path,\n"
        "  the final review's verdict rule — reading each line together with the next, so a sentence\n"
        "  wrapped across two lines still counts (`bun plugins/tribe/scripts/ways-of-work/drift.ts --repo .`;\n",
    ),
    (
        "  — it lists that file too, so the count is 2.\n"
        "- [`scripts/validate-plan.sh`](scripts/validate-plan.sh) fails a plan whose mode, block copy,\n"
        "  Done sections or final review task are missing.\n",
        "  — it lists that file too, so the count is 2.\n"
        "- [`scripts/ways-of-work/pointers.test.ts`](scripts/ways-of-work/pointers.test.ts) checks that\n"
        "  each file that must point here — the Warchief, orchestrate-campaign, the global CLAUDE.md\n"
        "  snippet, this README and the runner's README — names this section.\n"
        "- [`scripts/validate-plan.sh`](scripts/validate-plan.sh) fails a plan whose mode, block copy,\n"
        "  Done sections or final review task are missing, a plan the campaign runner would refuse (two\n"
        "  identical task headings included), and a `single-agent` plan over its build-task limit.\n",
    ),
]
text = open(path, encoding="utf-8").read()
for old, new in PAIRS:
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {text.count(old)}: {old[:60]!r}")
    text = text.replace(old, new)
open(path, "w", encoding="utf-8").write(text)
print(f"{path}: {len(PAIRS)} replacements")
PY
python3 "$REPORTS/wowrf-task8.py"
```

Expected: `plugins/tribe/README.md: 2 replacements`.

#### Verify

- Goal: governance for G1–G4 (brief item 5: READMEs at the end of the phase they follow).
- Red: `python3 -c "t=open('plugins/tribe/README.md', encoding='utf-8').read(); s=t[t.index('## Ways of work'):]; s=s[:s.index('---')]; print('pointers.test.ts' in s, 'identical task headings' in s, 'reading each line together with the next' in s)"`
  → `False False False` (Step 1).
- Green: the same command → `True True True`; `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . | tail -n 1`
  → `ways-of-work definitions: 2`; `bun test plugins/tribe/scripts/ways-of-work/ 2>&1 | tail -n 5` →
  ` 24 pass`, ` 0 fail`.
- Stub check: an empty commit prints `False False False`; a README that restated the rules instead of
  describing the tools would raise the counter to 3.

#### Done

```bash
python3 -c "import sys; t=open('plugins/tribe/README.md', encoding='utf-8').read(); s=t[t.index('## Ways of work'):]; s=s[:s.index('---')]; sys.exit(0 if 'pointers.test.ts' in s and 'identical task headings' in s and 'reading each line together with the next' in s else 1)"
bun test plugins/tribe/scripts/ways-of-work/
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --json | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin)['count'] == 2 else 1)"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/tribe/README.md
git commit -m "docs(tribe): the README describes the ways-of-work tools as they now are"
```
