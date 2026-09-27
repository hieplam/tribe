# Spec — runner-driver-only: the campaign runner, watchdog and supervisor drive the plan and nothing else

**Card:** `~/.tribe/-Users-hiep-repo-tribe/cards/runner-driver-only.md` (read in full; the
"Owner correction", the round-2 decisions D5–D7 and the "Shaman's verification bar" V1–V7 are
binding and supersede round 1 where they differ — the card says which).
**Author:** planning-Warchief, 2026-09-27. **Base:** `origin/master` @ `3194976`.
**Plan:** `docs/superpowers/plans/2026-09-27-runner-driver-only.md`.
**Evidence (BEFORE baselines, measured during planning):**
`docs/superpowers/evidence/2026-09-27-runner-driver-only/`.
**Measurement tools (committed with this spec, not card code):**
`plugins/tribe/scripts/tests/runner-driver-only/` — `tribe-lexicon.ts` (the V1 oracle's word list),
`render-prompts.ts` + `fixture-values.ts` (every prompt kind, rendered), `g2-prompts.ts` (the V1 counter
and essentials gate), `transcript-prompts.ts` (prompts a real run sent), `run-metrics.ts` (dispatches,
skills, tokens, wall clock, Done rows), `g3-verify-replay.ts` (the runner's own done check on a real PR),
`fixture-reset.sh` (back to the starting tree without rewriting history), `bypass-audit.ts` (D10
layer 1).
**Sandbox (D9):** `/Users/hiep/.claude-sandboxes/runner-driver-only` — not logged in during planning;
the sandbox BEFORE run is PENDING-LOGIN (§6.7).
**Dependency:** execution starts only after campaign `sessions-in-repo` (issue #173) has merged
to master (§8).

Every number marked **MEASURED** below was produced during planning on 2026-09-27 by a real run
of today's runner, a real PR on the fixture repo, or the committed measurement tools — never by
reading code.

---

## 1. The governing text, verbatim

The owner's goal (card, "Owner direction" and "Owner correction"):

> *"The ultimate goal is mechanical runner should only be the driver only, so that I can just
> still using the orchestate-campaign skill and use in any way i want."*

> *"All I want is the script should be the driver only. Everything that point to the warchief,
> shaman, hunter and controling the way of work (2 lens review skinner, fix loop) need to move into
> the plan. So that the mechanial runner and all of this (watchdog, supervisor) should follow the
> plan only"*

Ratified decisions (card, quoted verbatim):

> **D1 (owner, 2026-09-27): the work index lives inside `campaign-state.json`.** Each task is a
> structured item pointing into the markdown plan (reference, not copy); the markdown stays the
> source of truth. Refs are validated at load; a dangling ref refuses the run.

> **D2 (owner, 2026-09-27, verbatim): "the plan must define what is done. usualy that is the verify
> step. like new test added, run test passed, build no error, etc. ... THe plan must have done section
> in every task, the different is LLM ran those before. now the mechanical runner run those."**
> Every plan task carries a Done section of commands; the runner runs them and reads exit codes.

> **D3 (owner, 2026-09-27): the runner does not depend on Tribe at all.** No Tribe role, script,
> trailer, stamp or plugin appears in anything the runner injects or checks. The Tribe workflow, if
> wanted, is written in the plan.

> **D4 (owner, 2026-09-27): DONE = the feature is merged and local master has the latest.** This is
> generic git/GitHub, not Tribe, so the runner keeps it as the card's final gate
> (PR merged + local master == origin/master). Tribe-only points (gap-gate stamp, trailers, ledger
> commit) leave the runner.

> **D5 — fixture repo.** Private throwaway repo `hieplam/runner-e2e-go` created by the Shaman
> 2026-09-27 (default branch `master`, one README commit). Local clone: `/Users/hiep/repo/runner-e2e-go`.

> **D6 — the supervisor does no gap-gate ratification.** Removed from `brief-ratify.md`,
> `brief-closing.md` and `core/supervisor/loop.ts`. A plan that wants the gap-gate adds it as a
> task's Done command plus a final task of its own.

> **D7 — default plan style = simple.** When the owner runs `/orchestrate-campaign` without naming a
> style, plans say: one subagent per task, each task's Done commands run by the runner. The full
> Tribe workflow (Warchief, Hunters, two Skinners, Tracker, Scout, gap-gate) appears in a plan only
> when the owner asks for it.

Round 3 (card, "Ratified decisions, round 3", verbatim):

> **D8 — the runner adds nothing to a session beyond the user's own tiers.** The explicit Tribe
> plugin load goes. (Supersedes the planning brief's "availability is not coupling" for this one line:
> the runner injecting agents the user did not install IS the runner deciding.)

> **D9 — V2, V3, V5 and the BEFORE baseline run in the sandbox** (`CLAUDE_CONFIG_DIR` = sandbox, for
> the runner, supervisor, watchdog and the V5 session). V4 (Tribe-style positive control) runs in the
> owner's real home, where the agents exist.

> **D10 — bypass audit, two layers, both after every sandbox run:** 1. Committed script,
> deterministic … Pass = all zero / unchanged. 2. An independent auditor subagent, fresh context,
> given only the transcript paths and the definition of the Tribe way of working … Its verdict and
> quotes are recorded in the evidence dir. (Full text: the card; implemented in §6.8.)

The Shaman's verification bar V1–V7 (card, "Shaman's verification bar") is the row set of §6.

The oracle (Shaman's dispatch): *"The Tribe way of working" means the Tribe agents (the six files
in `plugins/tribe/agents/`), the `mammoth-hunt` skill, and their procedures —
Warchief-dispatches-Hunters, two-lens/dual-Skinner review, Tracker rounds, Scout proposals, fix
loops, the gap-gate and its stamp/trailers/ratification. The runner, watchdog and supervisor may
neither **instruct** a session to use any of it nor **require** anything only it produces.
Under-matching is a bug; over-matching is by design; when in doubt, flag it.*

REFUTED in advance (Shaman's dispatch, applied throughout): role names in code comments, history
notes, identifiers (`SpawnTracker`) and paths under `plugins/tribe/`; the runner living in the
`tribe` plugin; Tribe agents the owner installed and visible to a session through the owner's own
settings tiers (but NOT the runner's own explicit plugin load — D8 supersedes that refutation); the
`SHIPPED <pr> <sha>` line, the merge-gate hook, worktree/branch cleanup and master-sync checks;
C3 facts made stale by #173 that its own reconciliation task covers.

---

## 2. The problem, grounded (master `3194976`, file:line)

### 2.1 What today's runner, watchdog and supervisor push onto a session — MEASURED

`render-prompts.ts` renders every prompt the three processes can hand a session for the Go fixture
campaign (44 prompt kinds); `g2-prompts.ts` counts the Tribe lexicon (`tribe-lexicon.ts`) in them.
Result (`evidence/v1-before-prompts.txt`): **202 mentions in 12 prompt kinds, plus 1 non-prose
injection = 203.** Where they come from:

| Source | Kind(s) | Mentions | What it says |
| --- | --- | --- | --- |
| `core/brief-template.md:5-12` | executor brief | 45 (same 45 in the digest variant) | "You are dispatched as the Warchief … dispatch Hunters per task, audit with the Skinner" |
| `core/brief-template.md:51-54` | executor brief | (in the 45) | "Evidence policy: Every task is test-first … paste gate output verbatim into worker reports" |
| `core/brief-template.md:56-91` | executor brief | (in the 45) | "Harness gaps and governance": Tracker every audit round, `gap-gate.ts` before `gh pr create`, `Tribe-Card`/`Tribe-Milestone` trailers, `debt-backfill.ts`, Scout proposals, "Your agent Method already carries these" |
| `core/brief-template.md:109-112` | executor brief | (in the 45) | "Worker reports: Every dispatched worker (Hunter, Skinner) writes its report to …" |
| `core/session.ts:219` | session options | 1 injection | `plugins: [{ type: 'local', path: TRIBE_PLUGIN_DIR }]` loads the tribe plugin into every executor |
| `core/loop/card-actions.ts:316-323` | 2 escalation files | 8 each | `gapGateStamped`/`ledgerCommitted` bullets: "Run `bun plugins/tribe/scripts/gaps/gap-gate.ts` … trailer `Tribe-Milestone: gap-gate`" |
| `core/supervisor/brief-ruling.md:8,40-41` | ruling brief | 5 | "You are ruling with Shaman authority"; frozen `ratified-as:` vocabulary |
| `core/supervisor/brief-ratify.md` (whole file) | ratify brief | 39 | ratification of `ratified-as:`; Stage D ratification pass with `gap-gate.json`, `gap-rule.ts`, Warchief proposals |
| `core/supervisor/brief-closing.md:7,15-45,84-88` | closing brief | 32 | "land the closing governance PR"; the ratification pass; per-card gap-gate `open_ids` |
| `core/supervisor/status.ts:88-215` (`PARK_SENTENCES`) | 4 NEEDS_OWNER kinds | 2+6+3+3 | `ratified-as:` vocabulary; `ratify_cap`/`ratify_failed`/`ratify_out_of_scope` |
| `core/report.ts:282-289` | campaign-report.md | 6 | "Unratified rulings … ratify via the governance path" |

The watchdog hands a session nothing (it never spawns an LLM session — runner README, Watchdog,
"What it never does"); `evidence/v1-before-prompts.txt` records it as 0.

### 2.2 What today's done checks demand that a plain plan cannot produce — MEASURED

1. **The runner's D3 replay** (`core/verify.ts:607-633`) requires, beside the generic points,
   `gapGateStamped` (`:490-567`: a `gap-gate v1` stamp in the PR body, `card=` matching the card id
   or a `Tribe-Card:` trailer) and `ledgerCommitted` (`:573-600`: minted ids in
   `.tribe/harness-gaps.jsonl` on the base branch). **MEASURED** (`evidence/g3-before-plain-pr2-replay.txt`):
   plain PR #2 on the fixture (same Go code, no Tribe process, CI green, merged) replays
   `SHIPPED=false FAILED_POINTS=gapGateStamped,ledgerCommitted`; the Tribe-run PR #1 replays 7/7.
2. **The runner's rulings gate** (`core/loop/run-loop.ts:477-497`, `core/rulings.ts:92-106`) turns a
   finished campaign into exit `5` when any `answers.md` ruling lacks a `ratified-as:` value from the
   Tribe governance vocabulary. **MEASURED** (`evidence/g3-before-rulings-gate-stdout.txt`): one
   ordinary owner ruling → `runner exit 5`, `reason: rulings_unratified`.
3. **The supervisor's closing postcondition** (`core/supervisor/verify.ts:243-267`) requires a
   `verify-shipped` PASS per shipped card, and `verify-shipped.sh:142-160` (check 4) requires the
   gap-gate stamp; it also requires every ruling ratified (`:259-261`). **MEASURED**
   (`evidence/g3-before-plain-pr2-verify-shipped.json`): PR #2 → `FAIL`, `gap_gate_stamped: fail`.
4. **The supervisor's ruling postcondition** (`core/supervisor/verify.ts:113-122`) fails a ruling
   whose block has no ratified `ratified-as:` (`not_ratified`).
5. **Watchdog/supervisor vocabulary** keyed on the rulings gate: `core/watchdog/decide.ts:66`
   (exit 5 → `rulings_unratified`), `core/supervisor/decide.ts:194,259-268` (ratify session rows),
   `core/supervisor/truth.ts:93`.

### 2.3 What today's runner does with a plan that asks for the simple style — MEASURED (the BEFORE run)

The fixture plan (`hieplam/runner-e2e-go@9bb6b22`, `docs/plans/2026-09-27-small-helpers.md`) says,
in its "How to work": *"Give each task to one `general-purpose` subagent"*, and gives every task a
Done section. Today's runner (`run.ts`, `--model sonnet`, `--no-viewer`, campaign `go-before`)
**shipped it** — PR #1, merge `6ad5914`, in **607 s wall clock** — but the executor ran as the
Warchief: **6 Tribe dispatches** (4 `hunter`, 1 `skinner`, 1 `tracker`; 0 `general-purpose`),
**2,527,210 tokens** (66 input, 70,566 cache-write, 2,444,093 cache-read, 12,485 output),
**$2.15**, and it ran `gap-gate.ts` so the PR carries a stamp (`evidence/v2-before-*`). The Tracker
is dispatched once, for the stamp — exactly the live proof the card cites for campaign
`sessions-in-repo` (card, Grounding round 2, item 3). The Shaman's expectation that it "cannot
reach `shipped` without a gap-gate stamp" is **refuted**: it reaches `shipped` because the brief
makes it produce the stamp, overriding the plan's own instruction.

**This real-home run is supplementary evidence.** D9 makes the ratchet baseline a BEFORE run in the
sandbox (`agents/` empty); the sandbox was not logged in during planning ("Not logged in · Please run
/login", 2026-09-27), so that run is **PENDING-LOGIN**, specified exactly in §6.7. Expected: today's
runner still dispatches Tribe agents there, because `core/session.ts:219` loads the tribe plugin
explicitly — D8's live proof.

### 2.4 Nobody runs a task's Done commands but the session

The runner never reads the plan (`core/brief.ts:55-84` only passes its path); the plan's Done
sections are prose to the LLM. `run.json` records no command (`core/run-record.ts:7-28`).

---

## 3. Goals (card, round 2 rows) and what each means here

| # | Outcome (card) | Here |
| --- | --- | --- |
| G1 | A plain plan with no Tribe words runs to DONE through the runner | V2: the fixture plan, driven by `supervise` → watchdog → runner, reaches D4 DONE |
| G2 | That run spawns no Tribe agent and follows no Tribe workflow | V2: 0 dispatches of the six agents, 0 `mammoth-hunt`/`orchestrate-campaign` Skill calls |
| G2' | The prompts the runner and supervisor give a session carry no Tribe way of working | V1: 203 → 0, with every driver essential still present |
| G3' | The done check requires nothing a Tribe agent produces | G3': plain PR replays green on the new done check; rulings gate and closing stamp gone |
| G4 | The runner, not the LLM, runs each task's Done commands | V2: `runs/<runId>/done.jsonl` carries every command and exit code, per task |
| G5 | Empty-implementation guard | V3 + G5 E2E: a session that does nothing or claims done falsely never reaches `shipped` |
| G6 | Same Go plan, today's runner vs driver-only runner | V2: dispatches, wall clock, tokens, before → after, reported not asserted |
| D7 | Default plan style = simple | V5: a fresh `/orchestrate-campaign` Stage A authors a Tribe-free, Done-complete plan and state |
| — | The plan, not the runner, decides | V4: a Tribe-style plan on the same runner shows Tribe agents |
| D8 | The runner adds nothing beyond the user's own tiers | V1's injection count 1 → 0; the sandbox runs (D9) cannot see agents the runner used to bring |
| D10 | No bypass | after every sandbox run: `bypass-audit.ts` PASS and the auditor subagent `CLEAN` |

---

## 4. Design

### 4.1 The driver contract — what the runner, watchdog and supervisor keep

Driver work (Shaman's dispatch, "Scope fence"), unchanged in intent: spawning and resuming sessions;
the liveness walls (no backgrounding, no wait tools — `core/session.ts:56-123`); the pre-merge
"checks concluded green" gate (`core/merge-gate.ts`); the scan wall; the escalation file +
`answers.md` round trip; the `Campaign:` trailer; `schemaLockPaths`/`docsOnlyPaths`; the heartbeat
and the watchdog; the supervisor's ruling and closing loop; D4 DONE. **New driver work (D1, D2):**
the task index, running each task's Done commands, and driving the session task by task.

Everything else a session is told is **the plan's**. The brief says so in one sentence: *the plan
is your instructions — follow the way of working it prescribes, and add no process it does not ask
for.*

### 4.2 The task index (D1) — `campaign-state.json` v2

```jsonc
"cards": {
  "small-helpers": {
    "status": "staged", "spec": "docs/specs/…", "plan": "docs/plans/…",
    "branch": null, "baseSha": null, "pr": null, "mergeSha": null, "sessionId": null, "updatedAt": null,
    "tasks": [                                   // REQUIRED, ≥ 1 item, authored at Stage A
      { "id": "T1", "heading": "Task 1: `mathx.Sum`" },
      { "id": "T2", "heading": "Task 2: `mathx.Max`" }
    ]
    // runner-written, absent at authoring time:
    //   tasks[i].passedSha — the commit at which task i's Done commands last passed
    //   doneSha            — the commit at which EVERY task's Done commands passed together
  }
}
```

- **Reference, not copy.** `heading` is the exact text of one heading line in the plan (the `#`s and
  surrounding whitespace stripped). The Done commands are read from the plan every run; nothing but
  the pointer is stored.
- **Task id grammar:** `^[A-Za-z0-9][A-Za-z0-9._-]*$`, unique within the card (it travels in the
  `TASK_DONE` line and in file names).
- **Validated at load, every run** (`resolveRunContext` and `--dry-run`): for every card that is not
  `shipped`, is in the `--cards`-filtered sequence, and whose plan file exists (a missing plan stays
  the existing `planning_needed` escalation), the plan is parsed and every task must resolve (§4.3).
  **Any** failure refuses the run: a typed `TaskIndexError` naming every failing card/task/heading
  and reason, collected before throwing (never first-fail). The CLI prints
  `campaign runner: refused: <message>` and exits `4` (`EXIT_ERROR`, the class a malformed state
  already uses — `UnsupportedStateVersionError` takes the same path today); `--dry-run` refuses the
  same way, so Stage B's dry run catches it before a launch (V6).
- **Version decision: `v` becomes `2`, and `v: 1` is refused.** `tasks` is required, so a v1 file
  can never be valid v2 and no automatic migration is possible (a v1 card has no Done sections to
  point at). `UnsupportedStateVersionError`'s message names the change: *"campaign state v1 has no
  task index; this runner reads v2 (cards.<id>.tasks) — re-author the state with the
  orchestrate-campaign skill."* Every other field and the loose-object round trip are unchanged, so
  a v2 file with no runner-written fields round-trips byte-identical. `reset-card` also clears every
  `passedSha` and `doneSha`.

### 4.3 The plan format the runner reads (the parser's oracle)

**This section is the oracle for `core/plan-index.ts`. CommonMark is not.** Under-reading (missing a
command, attributing a command to the wrong task) is a bug. Refusing an ambiguous plan is by design.

- A **heading** is a line outside a fenced code block matching `^(#{1,6})\s+(.*?)\s*#*\s*$`. Fences
  are tracked CommonMark-style: a fence opened by N ≥ 3 backticks or tildes closes only on ≥ N of the
  same character (the same rule `plugins/tribe/scripts/validate-plan.sh` already implements).
- A **task section** is the index heading plus every line after it up to the next heading of the same
  or a higher level (fewer or equal `#`), or the end of file. The heading text must match **exactly
  one** heading in the file; zero → `dangling_heading`, more than one → `duplicate_heading`.
- Its **Done section** is the one heading *inside* the task section whose text is `Done`
  (case-insensitive) at a deeper level than the task heading. Zero → `missing_done`; more than one →
  `ambiguous_done`.
- Its **Done block** is the first fenced code block after the Done heading and before the next
  heading of any level. None → `missing_done_block`.
- Its **Done commands** are the block's lines, trimmed, skipping blank lines and lines starting with
  `#`. None → `empty_done`. A line ending in `\` → `continuation_not_supported` (refused, never
  guessed). Each remaining line is one command, run with `bash -c`.

The fixture plan (`hieplam/runner-e2e-go@9bb6b22`) is the worked example: `### Task 1: \`mathx.Sum\``
… `#### Done` … a ```` ```bash ```` block of four commands.

### 4.4 The turn protocol — the runner drives the plan task by task

One executor session per card, as today; the runner now drives it in **turns**, each a fresh query
with `resume: <sessionId>` (the resume path `core/loop/card-actions.ts:558-620` already uses).

1. **Next step (pure).** `nextStep(card)` = the first task with no `passedSha`; when every task has
   one and `doneSha` is set → `deliver`.
2. **First turn** = the full brief (§4.8) with its `## This turn` section set to the next step.
   **Every later turn** = only that step's prompt (§6.1 lists every prompt kind):
   - *task turn*: the task id and heading, the plan path, and the task's Done commands verbatim
     ("the runner will run these from a clean checkout of your branch tip"); end with
     `TASK_DONE <task-id> <branch>`.
   - *done-failed turn*: the failing command, its exit code, duration, and the last 60 lines of its
     stdout and stderr; which commands were not run; `attempt k of 3`.
   - *protocol-error turn*: why the last turn could not be accepted (below) and the step again.
   - *deliver turn*: push, PR, checks green in the foreground, `gh pr merge --merge`, delete the
     remote branch, remove the worktree, fast-forward local base in `--repo`; end with
     `SHIPPED <pr> <merge-sha>`; if code changes, end with `TASK_DONE <last-task-id> <branch>`.
3. **Terminal lines** (`core/session.ts#parseResultMessage`): `TASK_DONE <task-id> <branch>`,
   `SHIPPED <pr> <sha>`, `NEEDS_DIRECTION: <q>`. The **last** line of the final text matching any of
   the three decides (today the first match of a fixed precedence decides; with three lines "last
   wins" is the unambiguous rule). A turn with none of them stays `error` → today's bounded
   `stopped` retry (`core/loop/run-loop.ts:218-226`).
4. **Accepting `TASK_DONE <id> <branch>`** — the runner trusts the disk, not the words:
   - `<id>` must be the task the turn asked for; `<branch>` must exist as `refs/heads/<branch>` in
     `--repo`; once `card.branch` is known it must equal it; the tip must be a descendant of
     `card.baseSha` (`git merge-base --is-ancestor`). Any failure → protocol-error turn.
   - The runner records `card.branch = <branch>` on the first accepted line (today it learns the
     branch only from the PR, `card-actions.ts:651-672`), so the resume matrix sees a branch early.
5. **Done run** (§4.5) at the branch tip for tasks 1..k (k = the reported task). Pass → every task
   1..k gets `passedSha = tip`; if k is the last task, `doneSha = tip`. Persisted immediately
   (`persistLocalState`). Fail → done-failed turn.
6. **Budget:** at most **3 unaccepted turns per step** (failed Done runs and protocol errors count;
   `MAX_STEP_ATTEMPTS = 3`, a constant, not a flag). The fourth → escalate `done_failed` with the last
   failing command, its output tail and the attempt count. The budget lives in memory for one
   `actOnCard` call; the loop's existing 2 bounded retries of a `stopped` card cap the total.
7. **`SHIPPED` accepted only in the deliver step** (`doneSha` set). A `SHIPPED` before that is a
   protocol error ("SHIPPED arrived before every task passed its Done commands: T2, T3 remain").
8. **`NEEDS_DIRECTION`** at any step → the existing `needs_direction` escalation.
9. **Resume and crash recovery** keep the §D4 matrix (`core/loop/phase.ts`). A resumed session
   receives the next-step prompt (replacing `CONTINUE_*_PROMPT`, `card-actions.ts:465-480`). The
   fresh-with-digest fallback (`phase.ts:120-135`) adds the progress: which tasks passed, at which
   commit, on which branch, and the next step. `revert_and_redo` clears every `passedSha` and
   `doneSha` (the branch they point at is deleted).

`--session-timeout` now bounds one turn, not one card (documented in the README).

### 4.5 The Done run (D2, G4)

- **Where:** a detached scratch worktree at the tip, `<home>/done/<cardId>`
  (`git worktree add --detach --force`), removed afterwards (`git worktree remove --force`), serialized
  with the runner's other worktree mutations (`serializeRepoGitMutation`, `card-actions.ts:81-94`).
  A leftover from a crash is removed before the add. The path is built by a pure helper that refuses
  any card id that would leave `<home>/done/` (fail-closed-edges obligation 4). Running from a clean
  checkout of the commit — never the session's worktree — is what makes the check about committed
  work; a plan whose Done commands need a bootstrap (`bun install`) lists it as its first command.
- **What:** the Done commands of tasks 1..k in plan order, **deduplicated by exact text** (the
  fixture's `go build ./...` runs once per Done run, not four times), each `bash -c <line>` with
  `cwd` = the scratch worktree, a 10-minute timeout, and the process environment plus
  `RUNNER_CAMPAIGN_HOME`, `RUNNER_CARD_ID`, `RUNNER_TASK_ID` (= k), `RUNNER_BASE_SHA`, `RUNNER_REPO`.
  The first non-zero exit stops the run; later commands are recorded `not_run`.
- **Record (G4):** `<home>/runs/<runId>/done.jsonl`, append-only, one row per executed command:
  `{ at, cardId, stepTask, tasks: [ids listing this command], attempt, sha, command, exitCode,
  timedOut, durationMs, stdoutTail, stderrTail }`, then one summary row
  `{ at, cardId, stepTask, attempt, sha, kind: "done_run", passed, failedCommand|null }`. The card's
  ledger sketch said "`run.json` per-task rows"; `run.json` is a snapshot rewritten atomically and
  polled for liveness (`core/run-record.ts`, README "Run record"), so the rows go in an append-only
  sibling in the same run directory — the run record, crash-safe, with no rewrite.
- **Pure core / edge.** `core/plan-index.ts` (parse, resolve, `doneCommandsThrough(k)`),
  `core/done.ts` (`nextStep`, `planDoneRun`, `judgeDoneRun` → pass/fail + rows + the next prompt)
  are pure. The one new port, `DonePort.runShell(line, { cwd, env, timeoutMs })`, lives in
  `adapters/run-io.adapter.ts` and is the only code that spawns a Done command.

### 4.6 The merge gate learns the Done commit

`decideMergeGateHook` (`core/session.ts:135-169`) additionally reads the PR head
(`gh pr view <ref> --json headRefOid`) and the card's live `doneSha`; `buildMergeGateDecision`
(`core/merge-gate.ts:251`) denies unless checks are green **and** `headRefOid === doneSha`
(unreadable head or no `doneSha` → deny, fail closed). The deny reason steers:
*"end your turn with `TASK_DONE <last-task-id> <branch>` so the runner re-runs the Done commands on
your latest commit."* Prevention, not only detection — the same reason the P2 merge gate exists
(`core/session.ts:125-134`).

### 4.7 The final gate (D4) — `verifyShipped` points

Kept: `merged`, `mergeShaAncestorOfMaster`, `checksGreen`, `worktreeAndBranchGone`, `schemaGuard`
(campaign config, not Tribe). **Removed:** `gapGateStamped`, `ledgerCommitted`, `parseGapGateStamp`,
`GAP_LEDGER_PATH`, `VerifyConfig.gapLedgerPath`. **Added:**

- `localBaseSynced` — D4's "local master has the latest": after `git fetch`, the merge commit is an
  ancestor of the local base branch **and** the local base is an ancestor of `<remote>/<base>` (no
  local-only commits). Strict equality would fail spuriously when a concurrent card merges between
  this card's sync and its verify (`--max-concurrent > 1`); containment plus no-divergence is the
  race-free form of the owner's rule. A safe heal joins `decideResidueHeal`: when only this point
  fails, the `--repo` checkout is on the base branch, clean, and strictly behind, the runner runs
  `git merge --ff-only <remote>/<base>` there and re-verifies (same pattern as P4's residue heal).
- `doneAtHead` — the merged PR's head (`gh api …/pulls/<pr>` `head.sha`) equals `card.doneSha`.
  Catches a merge that bypassed the hook (`gh api -X PUT …/merge`, the GitHub UI) and is the
  G5 guard at the final gate: a card with no passing Done run can never verify.

The escalation bullets follow (`card-actions.ts:300-324`): the two gap-gate bullets go, bullets for
the two new points come in.

### 4.8 The executor brief (`core/brief-template.md`), section by section

| Today | After |
| --- | --- |
| "Executor mode": Warchief, Hunters, Skinner | "Your job": one card, headless; the plan is the instructions; add no process it does not ask for |
| "Card", "Goal" | kept; "Goal" names the task list |
| — | **new** "How the runner drives you": the task list (id + heading), the turn rule, Done commands run by the runner from a clean checkout, the 3-attempt budget |
| "Walls" | kept, plus: never switch the branch of, stage or commit in `--repo` itself (the runner reads the plan there); the merge gate now also names the Done commit |
| "Session liveness" | kept verbatim |
| "Evidence policy" (test-first, worker reports) | **moved** to the Tribe-style plan text (§4.13) |
| "Harness gaps and governance" | **moved** to the Tribe-style plan text |
| "Merge order", "Commit trailer" | kept |
| "Worker reports" (Hunter, Skinner) | replaced by one neutral line: the campaign home and its `reports/` directory, for any file the plan asks for |
| "Answers" | kept verbatim |
| "Definition of Done" | kept, rewritten as the deliver step (§4.4) |
| "Terminal contract" | three lines (§4.4) |
| — | **new** `## This turn` — the first step's prompt |

### 4.9 Session options (D8)

`plugins: [{ type: 'local', path: TRIBE_PLUGIN_DIR }]` (`core/session.ts:219`) and
`TRIBE_PLUGIN_DIR` (`:20`) are deleted; `PinnedSessionOptions.plugins` goes too. D8: "the runner adds
nothing to a session beyond the user's own tiers." The session loads exactly the owner's own three
settings tiers: in the real home the Tribe agents the owner installed stay available (V4 relies on
it); in the D9 sandbox, whose `agents/` is empty, none exist — and nothing in the runner brings them
back.

### 4.10 The rulings gate leaves the runner, the watchdog and the supervisor (D3, D6)

The runner no longer gates `done` on `ratified-as:`: `applyRulingsGate`, `EXIT_RULINGS_UNRATIFIED`
(exit `5`), `LoopResult.unratifiedRulings`, report reason `rulings_unratified`,
`renderRulingsUnratifiedNote` are deleted, and with them the watchdog's exit-5 row
(`core/watchdog/decide.ts:66`), its `rulings_unratified` terminal reason, and
`core/supervisor/truth.ts`'s mapping. `core/rulings.ts` keeps only `parseRulings` (the supervisor
still needs ruling ids for `R<n>`). **Moved, not deleted:** `isRulingRatified`/`unratifiedRulingIds`
and their vocabulary move to a Tribe-side script, `plugins/tribe/scripts/gaps/rulings-check.ts`
(`bun rulings-check.ts <answers.md>` → exit 1 listing unratified ids), which a Tribe-style plan's
closing task runs as a Done command.

### 4.11 The supervisor (D6)

- **`ratify` session kind: deleted** — `brief-ratify.md`, `RATIFY_TEMPLATE_PATH`,
  `RatifyBriefFacts`, `verifyRatify`, `ratifyRounds`, `--max-ratify-rounds`, park reasons
  `ratify_cap`/`ratify_failed`/`ratify_out_of_scope`, decide rows 1–3's ratify branch and rows 13–15,
  `SessionKind`'s `'ratify'`, `LedgerVerdict`'s `'ratified'`, `SpawnKind`'s `'ratify'`. Its only
  trigger was the runner's rulings gate.
- **Ruling brief:** "with Shaman authority" → "on the owner's behalf, within the authority this
  campaign grants"; the `ratified-as:` vocabulary and exit field go; the two exits stay (append a
  ruling tagged `R<n>`, or write a park marker). `verifyRuling` accepts a new `## ` block without a
  `ratified-as:` line (drops `not_ratified`). The quotes of `SKILL.md` it carries are re-synced to
  the new skill text (§4.13).
- **Closing brief:** no ratification pass, no governance PR, no gap-gate `open_ids`, no rulings'
  `ratified-as:` list. It keeps: re-verify each shipped card with `verify-shipped` (now with
  `--skip-gap-gate`, below) writing the verdict file the postcondition reads; the `Campaign:`
  trailer recovery; ONE owner report. `readGapGateOpenIds`, `ClosingOpenIdsFact`,
  `ClosingRulingFact`, `{{OPEN_IDS_BY_CARD}}`, `{{RULINGS}}` are deleted. `verifyClosing` drops the
  `rulings_unratified` check. `CLOSING_ALLOWED_TOOLS` keeps `Bash` (it runs `verify-shipped`).
- **`NEEDS_OWNER.md`:** the `owner_only` unblock sentence loses the `ratified-as:` clause; the three
  ratify park sentences go with their reasons.
- **`verify-shipped.sh`** (sibling plugin, the closing oracle) gains an opt-in `--skip-gap-gate`:
  check 4 is reported `{"status":"skipped"}` and the verdict is PASS iff checks 1–3 pass. **Default
  unchanged** — the Shaman's Mode 3 and `mammoth-hunt` (both Tribe, out of scope) keep the stamp
  check. The closing brief always passes the flag (D6: the supervisor does no gap-gate work).

### 4.12 The executor session double (test seam, G5/V3)

`TRIBE_RUNNER_SESSION_DOUBLE=<script>` swaps the executor's SDK spawn for a scripted process, exactly
as `TRIBE_SUPERVISOR_SESSION_DOUBLE` already does for the supervisor
(`adapters/session-double.adapter.ts`). The adapter runs
`<script> --home <home> --card <id> --prompt-file <tmp>` (bounded, 120 s) and yields
`system/init` (reusing the resume id when resuming) + `result/success` with the script's stdout as
the final text. Unset — every production run — nothing changes. The double is how G5 and V3 run
through the **real CLI, real git and real Done commands** with only the LLM replaced
(fixtures-mirror-reality: the E2Es build their repo from nothing, with a local bare `origin`).

### 4.13 The `orchestrate-campaign` skill (D7) and where the Tribe way of working moves

The skill gets a **"Choose the plan style"** step in Stage A:

- **Simple (default — the owner named no style).** Plans carry a "How to work" section: *"Do the
  tasks in order. Give each task to one `general-purpose` subagent … Every task ends with a Done
  section …"* (the fixture plan's own text is the template). Naming `general-purpose` is
  deliberate: the Tribe agents stay installed, and an executor told only "one subagent per task"
  could pick `hunter` by its description; the plan decides, so the plan names the type. State:
  v2 with `tasks`; `planning.mode` is `"self"` or `"subagent-fanout"`.
- **Tribe (only when the owner asks).** A plan section the skill supplies verbatim, which is where
  everything removed above lands (the "moved, not deleted" ledger, §5).

Stage C: `ratified-as:` becomes a Tribe-style duty. Stage D: the simple Stage D is re-verify
(`verify-shipped --skip-gap-gate`) + trailer recovery + ONE report; the Tribe style adds the
ratification pass. The exit-code table loses `5`; the watchdog reason list loses
`rulings_unratified`; the state example becomes v2. The runner README's "Harness-gap gate" section
moves to the skill's Tribe-style section.

### 4.14 Pure core and edges (`~/.claude/rules/pure-core.md`)

| Pure (deterministic, no I/O) | Edge (thin, decision-free) |
| --- | --- |
| `core/plan-index.ts` — parse the plan, resolve the index, Done commands per task | `resolveRunContext` reads each plan file through `io.readFile` |
| `core/done.ts` — `nextStep`, `planDoneRun` (dedup order), `judgeDoneRun` (rows, pass/fail, the next prompt), the step-attempt budget | `DonePort.runShell` (spawn, timeout, output tails); scratch-worktree add/remove through `io.exec` |
| `core/turn-prompts.ts` — every turn prompt, rendered from facts | — |
| `core/session.ts#parseResultMessage` — three terminal lines | the SDK adapter |
| `core/merge-gate.ts#buildMergeGateDecision` — checks + head vs `doneSha` | `decideMergeGateHook` runs `gh pr checks` / `gh pr view` through `execInRepo` |
| `core/verify.ts` point logic; `core/residue.ts#decideBaseSyncHeal` | `io.exec` for `git`/`gh` |
| `core/state.ts` v2 schema | `loadState`'s `readFile` seam |

---

## 5. "Moved, not deleted" — every removed item and where it lands

| Removed from | Item | Lands in |
| --- | --- | --- |
| `core/brief-template.md` | Warchief role; Hunter per task; Skinner audit | Tribe-style plan section: "The executor acts as the Warchief (`agents/warchief.md`) …" |
| `core/brief-template.md` | Evidence policy (test-first, worker reports) | Tribe-style plan section |
| `core/brief-template.md` | Tracker every audit round, report paths `tracker-<slug>-<round>.md` | Tribe-style plan section (uses `$RUNNER_CAMPAIGN_HOME/reports/`) |
| `core/brief-template.md` | `gap-gate.ts` before the PR; stamp; `Tribe-Milestone: gap-gate` | Tribe-style plan: a final task "Harness-gap gate" whose Done is `bun <tribe>/scripts/gaps/gap-gate.ts --repo "$RUNNER_REPO" --home "$RUNNER_CAMPAIGN_HOME" --card "$RUNNER_CARD_ID" --base "$RUNNER_BASE_SHA" --head HEAD` (D6) |
| `core/brief-template.md` | `debt-backfill.ts` every PR; Scout proposals in the PR body | Tribe-style plan, same final task |
| `core/session.ts` | `plugins: [TRIBE_PLUGIN_DIR]` | nothing needed: the owner's install already provides the agents (V4 proves it) |
| `core/verify.ts` | `gapGateStamped`, `ledgerCommitted` | Tribe-style plan's gap-gate Done command; `verify-shipped` without `--skip-gap-gate` (Shaman Mode 3, mammoth-hunt) |
| `core/loop/card-actions.ts` | gap-gate escalation bullets | gone with the points |
| `core/loop/run-loop.ts`, `core/rulings.ts` | rulings gate, exit 5 | `plugins/tribe/scripts/gaps/rulings-check.ts`, run as a Tribe-style closing task's Done command |
| `core/supervisor/*` | ratify session; ratification pass; gap-gate `open_ids`; governance PR | orchestrate-campaign Stage D, Tribe style |
| `core/supervisor/brief-ruling.md` | "Shaman authority"; `ratified-as:` vocabulary | neutral wording; vocabulary in the Tribe-style Stage C |
| `plugins/tribe/scripts/runner/README.md` | "Harness-gap gate and the `gap-gate v1` stamp" | orchestrate-campaign SKILL.md, Tribe style |

---

## 6. Verification contract

One row per V-item of the Shaman's verification bar (card), plus G3', G5 and D10. Every row: the
claim, the oracle (the exact command or real run), where the output lands, the pass condition, the
**baseline MEASURED on master before any building** where one exists, and the empty-implementation
test ("would doing nothing, or a stub, pass?"). Only BEFORE baselines were measured during planning;
V3–V6 are execution-time checks, specified exactly in §6.3–§6.8 and in the plan's PR 4 tasks.

Paths: `$T` = `plugins/tribe/scripts/tests/runner-driver-only`, `$E` =
`docs/superpowers/evidence/2026-09-27-runner-driver-only`, `$F` = `/Users/hiep/repo/runner-e2e-go`,
`$FH` = `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns`, `$S` =
`/Users/hiep/.claude-sandboxes/runner-driver-only` (the D9 sandbox), `S0` =
`9bb6b2253a32453a8ffc2a7c473a0b97ea444498` (fixture starting tree `86031f3c`).

| Row | Claim | Oracle | Output | Pass | Baseline (MEASURED unless marked) | Empty-implementation test |
| --- | --- | --- | --- | --- | --- | --- |
| **V1** (G2', D3, D8) | No prompt the runner, watchdog or supervisor sends carries the Tribe way of working, no Tribe plugin is injected, and every driver essential is still there | `bun $T/render-prompts.ts --out $E/after-prompts && bun $T/g2-prompts.ts --render-dir $E/after-prompts --gate`; cross-check on the real V2 transcripts: `CLAUDE_CONFIG_DIR=$S bun $T/transcript-prompts.ts --home $FH/go-after --out $E/after-real-prompts && bun $T/g2-prompts.ts --render-dir $E/after-real-prompts --negative-only` | `$E/v1-after-prompts.txt`, `$E/v1-after-real-prompts.txt` | `G2_GATE=PASS` (`TRIBE_WAY_TOTAL=0`, `MISSING_REQUIRED_KINDS=0`, no `ESSENTIALS_MISSING`); real-transcript `TRIBE_WAY_TOTAL=0` | **203** = 202 mentions in 12 of 44 kinds + 1 plugin injection (`$E/v1-before-prompts.txt`); real-home BEFORE transcript 45 (`$E/v1-before-real-prompts.txt`); watchdog 0 (sends no prompt) | Doing nothing: 203 → FAIL. Deleting the briefs zeroes the count but loses the 21 required kinds and their essentials (card id, plan path, the task and its Done commands, `TASK_DONE`/`SHIPPED`/`NEEDS_DIRECTION`, `run_in_background`, `timeout: 600000`, `gh pr checks`, `Campaign:`) → FAIL |
| **V2** (G1, G2, G4, G6; D9 sandbox) | The same Go plan, same starting tree, through `supervise` → watchdog → runner in the sandbox, reaches D4 DONE; the runner ran every Done command; no Tribe agent or skill | §6.3; `bun $T/run-metrics.ts`, `g3-verify-replay.ts`, D10 (§6.8); the Shaman re-runs `go test ./...` on `$F` master himself | `$E/v2-after-*`, `$E/d10-v2-*`, `$E/v2-before-after.md` | supervise exit `0`; replay `SHIPPED=true`; local master == origin/master; `go test ./...` exit 0; `TRIBE_AGENT_DISPATCHES=0`; `TRIBE_SKILL_CALLS=0`; for each of T1..T4 a `passed:true` `done_run` row and an exit-0 row per command in `done.jsonl`; D10 both layers clean | **Ratchet baseline: sandbox BEFORE run — PENDING-LOGIN (§6.7).** Supplementary, real home (`$E/v2-before-*`): shipped PR #1; **6** Tribe dispatches (4 hunter, 1 skinner, 1 tracker); 0 Tribe skill calls; **0** runner-run Done rows; **607 s**; **2,527,210 tokens**; **$2.15** | Doing nothing: 6 dispatches and 0 Done rows → FAIL. A session that does nothing never gets a passing Done run, so it is never delivered (V3a/G5) |
| **V3** (D2 negative control; D9) | A task whose Done command fails is never marked done, and the card escalates | V3a: `CLAUDE_CONFIG_DIR=$S bash plugins/tribe/scripts/tests/test-runner-done-negative.sh` (§6.4; hermetic, deterministic, the discriminating check). V3b: a real sandbox session on a fixture task whose Done can never pass (§6.4) + D10 | `$E/v3a-e2e.txt`, `$E/v3-*`, `$E/v3b-*`, `$E/d10-v3-*` | V3a `V3=PASS` (runner exit 2; `done_failed`; no `passedSha`/`doneSha`; 3 failed `done_run` rows; the failing command ran with exit ≠ 0). V3b: exit 2; card `escalated`; no `passedSha`/`doneSha`; if any turn reported `TASK_DONE`, `done.jsonl` shows the impossible command failing; D10 clean | n/a (master has no Done runner; the runner never reads the plan — spec §2.4) | A runner that never runs Done marks T1 passed and moves to delivery: no `done_failed`, no rows → V3a FAIL |
| **G5** (empty implementation) | A session that does nothing, or claims `SHIPPED` early, never ships | `bash plugins/tribe/scripts/tests/test-runner-done-empty.sh` (§6.4; doubles `do-nothing`, `premature-shipped`) | stdout | `G5=PASS`: both exit 2, `done_failed`, never `shipped`, no `doneSha`; do-nothing: 3 failed Done runs; premature: 0 Done runs, escalation names the early `SHIPPED` | n/a | This row IS G1's empty-implementation test |
| **V4** (the plan decides; D9 real home) | A 1-task Tribe-style plan on the same runner shows Tribe agents | §6.5; `bun $T/run-metrics.ts --home $FH/go-v4-tribe`; `bypass-audit.ts scan` as the positive oracle | `$E/v4-*` | `TRIBE_AGENT_DISPATCHES ≥ 1` with `hunter` among them; `BYPASS_TRIBE_DISPATCHES ≥ 1` | n/a | A runner that stripped agents from the session (a deny list) shows 0 → FAIL; a runner that still injected them fails V1/V2 instead |
| **V5** (D7; D9 sandbox) | A fresh `/orchestrate-campaign` Stage A with no style named authors a Tribe-free, Done-complete plan and a state `--dry-run` accepts | §6.6: `CLAUDE_CONFIG_DIR=$S bash $T/v5-stage-a.sh $F S0 $E`, `bash $T/v5-check.sh <home> $F`, D10 over the V5 session | `$E/v5-*`, `$E/d10-v5-*` | `V5=PASS` (v2 state; lexicon 0 over plan + state; every `Task N` heading indexed, resolving, ≥ 1 Done command; `--dry-run` exit 0 naming the card); D10 clean | n/a | Doing nothing authors nothing → FAIL. The unchanged skill authors a v1 state (refused) and, following its old Stage A text, plans that route cards through the Warchief/Hunter chain → FAIL |
| **V6** (D1) | A state whose task ref points at a missing heading is refused at load | `bash plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh` (§6.4): the real CLI, `--dry-run` and a real run | stdout, `$E/v6-refusal*.txt` | `V6=PASS`: both exit `4` with `campaign runner: refused:` naming card, task, heading, `dangling_heading`; no session spawned; state byte-identical | **master accepts it**: `--dry-run` exit 0, phase `fresh` (`$E/v6-before-dry-run.txt`) | A runner that never validates refs dry-runs `fresh` → FAIL |
| **V7** (regression) | Runner suite, supervisor E2E and session E2E green; every changed existing assertion is named | `cd plugins/tribe/scripts/runner && bun run check`; `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`; `cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 bun test core/session.e2e.test.ts core/supervisor/session.e2e.test.ts`; plus the supervisor-kill, watchdog, docs, verify-shipped and viewer suites and the three new E2Es | `$E/v7-after-counts.txt` | all 0 fail; every count change maps to a named assertion change (§7) | master `3194976`, clean clone: runner **1351 pass / 14 skip / 0 fail** (`$E/v7-before-runner-check.txt`); supervisor E2E **40/40** (`$E/v7-before-supervisor-e2e.txt`); verify-shipped **26/26**; Task 1.1 re-measures on the post-#173 base | n/a (regression row) |
| **G3'** (done check) | The done check requires nothing a Tribe agent produces | `bun $T/g3-verify-replay.ts` on the V2 card and on plain PR #2; `verify-shipped --skip-gap-gate` on PR #2; the rulings probe re-run | `$E/g3-after-*` | V2 replay `SHIPPED=true`; PR #2 replay lists no `gapGateStamped`/`ledgerCommitted` (only `doneAtHead`, the runner's own D2 point, can fail for a hand-made PR); verify-shipped `PASS`; rulings probe exit `0` | plain PR #2: `FAILED_POINTS=gapGateStamped,ledgerCommitted`; verify-shipped `FAIL (gap_gate_stamped)`; rulings probe **exit 5** (`$E/g3-before-*`) | Doing nothing: the two points and exit 5 remain → FAIL |
| **D10** (no bypass; after every sandbox run) | No session used the Tribe way of working anyway, by name or by imitation, and the sandbox and repo are untouched | Layer 1: `bun $T/bypass-audit.ts scan --home <campaign home> --claude-home $S --sandbox $S --snapshot-before <snapshot> --repo $F` (snapshot taken before the run). Layer 2: the auditor subagent brief of §6.8 | `$E/d10-<run>-scan.txt`, `$E/d10-<run>-auditor.md` for BEFORE-sandbox, V2, V3b, V5 | `BYPASS_AUDIT=PASS` (0 Tribe dispatches, 0 `mammoth-hunt`, 0 agent-file touches or definition reads, `agents/` empty, install surface unchanged, no unknown new sandbox entry, no `.claude/agents` in the repo, every session's transcript found); auditor `VERDICT: CLEAN` | Scanner self-tests (`$E/d10-scanner-selftest.md`): the fu-supervisor-settings executor transcript → **18** Tribe dispatches (nonzero, as required); the real-home BEFORE run → 6; a planted `agents/hunter.md` → `SANDBOX_AGENTS_EMPTY=no`, `SANDBOX_SURFACE_CHANGED=1`. The sandbox BEFORE run is expected to FAIL layer 1 (today's runner loads the plugin — D8's proof) | A scanner that reads nothing would report 0 on the known transcript → its self-test fails first |

### 6.1 The AFTER prompt inventory (V1's required kinds)

`g2-prompts.ts#REQUIRED_AFTER_KINDS` is the contract, with each kind's essentials:
`executor/brief-fresh`, `executor/brief-with-digest`, `executor/turn-task`,
`executor/turn-done-failed`, `executor/turn-protocol-error`, `executor/turn-deliver`,
`executor/hook-backgrounding`, `executor/hook-wait-tool`, `executor/hook-scan`,
`executor/hook-merge-forbidden-flag`, `executor/hook-merge-checks-error`,
`executor/hook-merge-not-green`, `executor/hook-merge-head-not-done`,
`escalation/needs-direction`, `escalation/planning-needed`, `escalation/verify-failed-merged`,
`escalation/verify-failed-after-merge`, `escalation/done-failed`, `supervisor/ruling`,
`supervisor/closing`, `report/campaign-report-md`. The renderer additionally renders every
supervisor hook reason and one `supervisor/needs-owner/<reason>` per `ParkReason` (counted, not
required — #173 reshapes the hooks). The renderer follows the runner's API and is updated in the
same commit as any rendering API it calls.

### 6.2 The fixture and how it returns to the starting tree

- **Starting tree S0** (`hieplam/runner-e2e-go@9bb6b22`, tree `86031f3c`): `README.md`, `go.mod`
  (`module github.com/hieplam/runner-e2e-go`, `go 1.22`), `.github/workflows/ci.yml` (on
  `pull_request`: `go build`, `go vet`, `go test`), `docs/specs/2026-09-27-small-helpers.md`,
  `docs/plans/2026-09-27-small-helpers.md` (4 tasks, each one function + test + a Done section of 4
  commands; lexicon count 0). CI is required: the merge gate treats an empty check list as not green
  (`core/merge-gate.ts:187-200`). On S0 `go test ./...` exits 1 ("no packages to test"), so a
  do-nothing run fails every Done section.
- **Return to S0:** `bash $T/fixture-reset.sh $F S0` refuses while a PR is open or a worktree
  exists, deletes leftover remote branches, and lands ONE commit whose tree equals S0's tree
  (`RESET_OK … tree=86031f3c…`). History is never rewritten — the BEFORE run's PR #1, the plain PR #2
  and both resets stay as evidence (`8b76911`, `791a7d5`, used during planning).
- **Homes:** `$FH/<slug>` per run: `go-before` (real-home BEFORE, v1), `go-before-sandbox` (§6.7),
  `g3-plain-baseline`, `g3-rulings-baseline`, `v6-baseline`, `go-after` (V2), `go-v3-real` (V3b),
  `go-v4-tribe` (V4), and the V5 skill's own home.

### 6.3 V2 procedure (execution time, sandbox)

1. `$E/d9-sandbox-ready.txt`: `ls -A $S/agents` is empty and
   `cd $F && CLAUDE_CONFIG_DIR=$S claude -p "Reply with exactly: OK" --model haiku` prints `OK`.
2. `bash $T/fixture-reset.sh $F S0` → `RESET_OK`.
3. `$FH/go-after/campaign-state.json` = `$E/v2-after-campaign-state.authored.json` (v2; card
   `small-helpers`; tasks T1..T4 = the fixture's four headings verbatim); empty `answers.md`.
4. `bun $T/bypass-audit.ts snapshot --sandbox $S --out $E/d10-v2-sandbox-before.json`.
5. `CLAUDE_CONFIG_DIR=$S bun plugins/tribe/scripts/runner/run.ts --repo $F --model sonnet --home $FH/go-after --dry-run --no-viewer`
   → exit 0, card `small-helpers`, phase `fresh`.
6. `CLAUDE_CONFIG_DIR=$S bun plugins/tribe/scripts/runner/run.ts supervise --repo $F --model sonnet --home $FH/go-after`
   (foreground, bounded at 3 h) → exit `0`.
7. Measure: `run-metrics.ts`, `transcript-prompts.ts` + `g2-prompts.ts --negative-only`,
   `g3-verify-replay.ts`; copy `done.jsonl`, `campaign-report.*`, `supervisor/final-report.md`,
   `supervisor/verdicts/small-helpers.json`, and `supervisor/ledger.jsonl` (if #173's executor rows
   landed, cross-check: no `agentType` among the six agents).
8. D10 both layers (§6.8). 9. Local master == origin/master; `go test ./...` on `$F` master.
10. `$E/v2-before-after.md`: dispatches by type, Tribe dispatches, Tribe skill calls, Done rows, wall
    clock (runner span; full-stack span), tokens (executor; full stack), cost — BEFORE = the sandbox
    BEFORE run (§6.7), the real-home run as a supplementary column. Reported, not asserted (G6).
11. `fixture-reset.sh` to S0.

### 6.4 V3, G5, V6 — the hermetic E2Es and the real V3b

The three committed E2Es share `plugins/tribe/scripts/tests/lib-runner-e2e.sh`, which builds its world
from nothing (fixtures-mirror-reality rule 2): a temp dir, `git init --bare origin.git`, a clone with one
spec and one plan pushed to `master`, `origin/HEAD` set, a v2 campaign home — then runs the **real**
`run.ts` with `TRIBE_RUNNER_SESSION_DOUBLE` pointing at `plugins/tribe/scripts/runner/fixtures/executor/session-double.sh`.
Offline (every path escalates or refuses before a PR exists, so no `gh`), host git config neutralised,
every run bounded (300 s). Done commands are shell-only (`test -f`, `grep -q`), so the tests need no Go.

- **V3a** — plan `double.md`: one task `Task 1: \`mathx.Double\`` whose Done block is
  `test -f mathx/double.go` and `grep -q 'func TestTriple' mathx/double_test.go` (no task writes
  `TestTriple`). Double mode `implement`: writes `mathx/double.go` + `TestDouble`, commits on
  `double/C1`, prints `TASK_DONE T1 double/C1` every turn. 9 checks.
- **G5** — plan `sum.md`: `Task 1: \`mathx.Sum\`` with Done `test -f mathx/sum.go`,
  `grep -q 'func TestSum' mathx/sum_test.go`. Double modes `do-nothing` (branch at the base) and
  `premature-shipped` (`SHIPPED 1 0000000`). 11 checks.
- **V6** — plan `sum.md`; state task `{ "id": "T1", "heading": "Task 9: nowhere" }`; `--dry-run` and a
  real run; a marker double proves no session spawned. 15 checks.
- **V3b (real, sandbox)** — fixture tree S0 + `docs/plans/2026-09-27-v3-negative.md` (one task
  `Task 1: \`mathx.Double\``, `general-purpose` subagent, Done: `go build ./...`,
  `go test -run '^TestDouble$' -v ./mathx | grep -q -- '--- PASS: TestDouble'`,
  `test "$(uname -s)" = Plan9` — the last can never pass on this machine). Bare runner,
  `CLAUDE_CONFIG_DIR=$S`, `--model sonnet`, home `$FH/go-v3-real`. Pass: exit 2; card `escalated`;
  no `passedSha`/`doneSha`; the escalation reason is `done_failed` (or `needs_direction` if the session
  asked instead of claiming the task); if any turn ended with `TASK_DONE`, `done.jsonl` shows the
  `uname` command exiting non-zero; D10 clean. V3a carries the discriminating power (a real session
  may ask rather than claim, so V3b cannot prove the runner ran the command); V3b shows a real
  sandbox session meeting the wall. D10 does not apply to V3a: the double starts no Claude session.

### 6.5 V4 procedure (execution time, real home)

1. `fixture-reset.sh` to S0; commit `docs/plans/2026-09-27-tribe-style.md` to `$F` master: the
   orchestrate-campaign skill's "Tribe style — plan section" How-to-work block verbatim, then ONE task
   (Task 1 of the fixture plan with its four-command Done) and no gap-gate task (the card: a 1-task plan).
2. v2 state, card `v4-tribe`, one task; bare runner WITHOUT `CLAUDE_CONFIG_DIR`
   (`run.ts --repo $F --model sonnet --home $FH/go-v4-tribe --no-viewer`).
3. `run-metrics.ts` → `$E/v4-run-metrics.txt`; `bypass-audit.ts scan --home $FH/go-v4-tribe` →
   `$E/v4-tribe-scan.txt` (here the positive oracle); `fixture-reset.sh` to S0.

### 6.6 V5 procedure (execution time, sandbox)

`$T/v5-stage-a.sh $F S0 $E` (the plan's Task 4.6 writes it) resets `$F` to S0, then runs one fresh
headless session in `$F` with `CLAUDE_CONFIG_DIR=$S`: `claude -p --model sonnet --permission-mode bypassPermissions --output-format json`
and the prompt *"Use the orchestrate-campaign skill (invoke it with the Skill tool). Orchestrate this one
card on this repo, Stage A only: author the spec, the plan, campaign-state.json and answers.md, and land
the spec and plan the way the skill says. Do NOT launch the runner, the watchdog or the supervisor. The
card: add `mathx.Clamp(x, lo, hi int) int` (lo when x < lo, hi when x > hi, else x) with a table-driven
test. Campaign slug: go-v5-stage-a."* — no style named. It prints the one new campaign home and the
session id. `$T/v5-check.sh <home> $F` fast-forwards `$F`, then checks: the state is v2; the lexicon
count over the plan + state is 0; every `Task N` heading in the plan is in the index and resolves with
≥ 1 Done command (the runner's own `plan-index.ts`); `run.ts --dry-run` exits 0 naming the card →
`V5=PASS`. D10 runs over the V5 session transcript and its `subagents/` (the scan's
`INFO_ORCHESTRATE_CAMPAIGN_SKILL_CALLS` is expected ≥ 1 here). Stage A lands its PR on the fixture
(allowed, D5); `$F` is reset to S0 afterwards.

### 6.7 The sandbox BEFORE baseline run — PENDING-LOGIN (the Shaman runs it)

The ratchet baseline for V2/G6 (D9). Not run during planning: the sandbox answered "Not logged in ·
Please run /login" (2026-09-27). Exact procedure, from a checkout of **master `3194976`** (today's
runner), after the owner's one interactive login into `$S`:

```bash
S=/Users/hiep/.claude-sandboxes/runner-driver-only; F=/Users/hiep/repo/runner-e2e-go
FH=/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns
P=/Users/hiep/repo/tribe-wt/plan-runner-driver-only   # this plan's branch: the tools and evidence dir
T=$P/plugins/tribe/scripts/tests/runner-driver-only; E=$P/docs/superpowers/evidence/2026-09-27-runner-driver-only
B=/tmp/tribe-before-3194976
git -C /Users/hiep/repo/tribe worktree add --detach $B 3194976
bun install --cwd $B/plugins/tribe/scripts/runner --frozen-lockfile
ls -A $S/agents                                                            # expect: nothing
(cd $F && CLAUDE_CONFIG_DIR=$S claude -p "Reply with exactly: OK" --model haiku)   # expect: OK
bash $T/fixture-reset.sh $F 9bb6b2253a32453a8ffc2a7c473a0b97ea444498      # expect: RESET_OK … tree=86031f3c…
mkdir -p $FH/go-before-sandbox && : > $FH/go-before-sandbox/answers.md
cp $E/v2-before-sandbox-campaign-state.authored.json $FH/go-before-sandbox/campaign-state.json
bun $T/bypass-audit.ts snapshot --sandbox $S --out $E/d10-before-sandbox-snapshot.json
date -u +%FT%TZ > $E/v2-before-sandbox-start.txt
CLAUDE_CONFIG_DIR=$S bun $B/plugins/tribe/scripts/runner/run.ts --repo $F --model sonnet --home $FH/go-before-sandbox --no-viewer > $E/v2-before-sandbox-runner.txt 2>&1; echo "exit $?" >> $E/v2-before-sandbox-runner.txt
date -u +%FT%TZ > $E/v2-before-sandbox-end.txt
bun $T/run-metrics.ts --home $FH/go-before-sandbox | tee $E/v2-before-sandbox-run-metrics.txt
bun $T/run-metrics.ts --home $FH/go-before-sandbox --json > $E/v2-before-sandbox-run-metrics.json
CLAUDE_CONFIG_DIR=$S bun $T/transcript-prompts.ts --home $FH/go-before-sandbox --out $E/before-sandbox-real-prompts
bun $T/g2-prompts.ts --render-dir $E/before-sandbox-real-prompts --negative-only > $E/v1-before-sandbox-real-prompts.txt
bun $T/bypass-audit.ts scan --home $FH/go-before-sandbox --claude-home $S --sandbox $S --snapshot-before $E/d10-before-sandbox-snapshot.json --repo $F > $E/d10-before-sandbox-scan.txt; echo "scan exit $?" >> $E/d10-before-sandbox-scan.txt
# then the D10 auditor subagent (§6.8) over the transcript paths the scan lists -> $E/d10-before-sandbox-auditor.md
bash $T/fixture-reset.sh $F 9bb6b2253a32453a8ffc2a7c473a0b97ea444498
git -C /Users/hiep/repo/tribe worktree remove $B
```

`$E/v2-before-sandbox-campaign-state.authored.json` (committed with this spec) is the v1 state of the
real-home BEFORE run with `"campaign": "go-before-sandbox"`. Expected: the runner exits and records
Tribe dispatches through its own plugin load (D8's proof) while `SANDBOX_AGENTS_EMPTY=yes` and
`SANDBOX_SURFACE_CHANGED=0` — the agents came from the runner, not the sandbox; record whatever
actually happens. The real-home BEFORE run (§2.3) stays as supplementary evidence.

### 6.8 D10 — the bypass audit, both layers

**Layer 1 — `$T/bypass-audit.ts` (committed with this spec; deterministic).** `snapshot` records the
sandbox's install surface (`agents`, `skills`, `commands`, `rules`, `canvases`, `output-styles`,
`plugins`, `hooks`, `CLAUDE.md`, `settings.json`, `settings.local.json`, `.mcp.json`: sha256 per file,
symlinks as such) and its top-level entries. `scan` finds every session of the run (executor logs
`runs/*/logs/<card>-<sessionId>.log`, supervisor `supervisor/sessions/<sessionId>.log`), every
transcript `<claude home>/projects/*/<sessionId>.jsonl` and every `<sessionId>/subagents/*.jsonl`, and
counts, per `tool_use` block: `tribe_dispatch` (Agent/Task with a `subagent_type` whose bare name is one
of the six agents), `mammoth_hunt_skill` (Skill `mammoth-hunt`), `agent_file_touch` (Write/Edit/
MultiEdit/NotebookEdit on an `agents/` path or `install.sh`; any Bash command naming `agents/`,
`.claude/agents` or `install.sh`), `agent_definition_read` (Read of an `agents/*.md` or `mammoth-hunt`
path; Grep/Glob whose path or pattern names one). It re-checks `agents/` is empty, diffs the install
surface against the snapshot, lists unknown new top-level entries (known runtime churn — `projects`,
`sessions`, `todos`, `shell-snapshots`, `statsig`, `debug`, `session-env`, `file-history`,
`history.jsonl`, `.claude.json`, `backups`, `plans`, `paste-cache`, `ide`, `logs`, `cache`,
`telemetry`, `.credentials.json` — is ignored), looks for any `.claude/agents` directory in the repo,
and fails when a session's transcript cannot be found. Over-matching is by design (a Bash `ls` of an
agents directory counts). Every hit is printed with `file:line` and the verbatim detail.

**Layer 2 — the independent auditor subagent.** Dispatched by the executing session after layer 1, as
ONE fresh `general-purpose` subagent, with exactly this brief and nothing else (never the expected
answer, never layer 1's result):

```text
You are an independent auditor. You have no stake in the outcome and no knowledge of what anyone
expects you to find.

## What you are given
The absolute paths of every transcript of one run (JSONL, one Claude Code session per file; a file
under a `subagents/` folder is a subagent session started by the session whose id names that folder):
<the transcript paths, one per line>

## The question
Did any session in this run use "the Tribe way of working"?

## The definition (the oracle)
"The Tribe way of working" means: the Tribe agents — warchief, hunter, skinner, tracker, scout, shaman
(the six files in `plugins/tribe/agents/`) — the `mammoth-hunt` skill, and their procedures: a
Warchief dispatching Hunters; two-lens / dual-Skinner review (a "contract lens" and a "cold lens");
Tracker review rounds against written rules; Scout adjudicating harness gaps into rule proposals;
audit fix loops with capped fix rounds; the harness-gap gate (`gap-gate.ts`), its `gap-gate v1` stamp,
the `Tribe-Card` / `Tribe-Task` / `Tribe-Milestone` trailers, and the ratification of rulings
(`ratified-as:`). It counts whether it happens by name or by imitation: a generic subagent briefed to
"act as a Hunter" or "audit like a Skinner with a cold lens", or a prompt that copies those procedures
without naming them, is the Tribe way of working. Installing, restoring, reading or writing an agent
definition (`agents/*.md`) or running `install.sh` is a bypass.
Not counted: text the Claude Code harness itself loads from the user's own configuration (CLAUDE.md
memory files, rules). Judge what the sessions DID and the prompts they WROTE or RECEIVED.

## How to work
Read every transcript. Look at every Agent/Task call (its subagent_type and its full prompt), every
Skill call, every file written or read, every Bash command, and every prompt a session received.

## Output
Your final message, in exactly this shape:
VERDICT: CLEAN | BYPASS | UNSURE
FINDINGS:
- <file>:<line> — "<verbatim quote>" — why it is, or might be, the Tribe way of working
(write "FINDINGS: none" when the verdict is CLEAN)
```

Its full answer is saved verbatim to `$E/d10-<run>-auditor.md`. `BYPASS` or `UNSURE` is a finding for
the owner; nobody argues it down.

---

## 7. Existing assertions this card changes deliberately (V7)

The full inventory (file, line, test title, which change pins it) is `$E/v7-changed-assertions.md`,
produced by a read-only sweep of master `3194976` during planning and re-checked by Task 1.1 on the
post-#173 base. Every task that edits an existing test names the assertions it changes, and why, in
its brief; any assertion changed that is not on that list is a finding.

---

## 8. Scope fence, the #173 dependency, and rebase

**In:** the measurement tools under `plugins/tribe/scripts/tests/runner-driver-only/` (committed with
this spec; the plan updates `render-prompts.ts` and `g3-verify-replay.ts` in the same commit as any
runner API they call); `plugins/tribe/scripts/runner/**` (brief, session, verify, loop, state, report, watchdog
decide/model, supervisor), `plugins/tribe/scripts/gaps/rulings-check.ts` (new),
`plugins/verify-shipped/skills/verify-shipped/**` + its test, `plugins/tribe/skills/orchestrate-campaign/SKILL.md`,
the runner README and `RUNNER_EXPLAINED.html`, `.c3/` through change units, the measurement tools and
evidence. `install.sh` is unchanged: no skill or agent is added, and `scripts/` is invoked from the
checkout, never symlinked (`install.sh:119-121`).

**Out:** `plugins/tribe/agents/*.md` (stay as they are, even where they describe the old runner);
`mammoth-hunt`; the viewer (except that its suite stays green); changing the settings tiers;
`resume-check.sh`; the gap-gate scripts themselves.

**Files shared with #173** (its plan `docs/superpowers/plans/2026-09-27-supervisor-sessions-in-repo.md`
and its branch diff at `b9d237a`): `runner/core/session.ts`, `runner/core/session.test.ts`,
`runner/core/session.e2e.test.ts`, `runner/core/paths.ts`, `runner/core/paths.test.ts`,
`runner/core/ledger.ts`, `runner/core/loop/card-actions.ts`, `runner/core/loop/card-actions.test.ts`,
`runner/core/supervisor/session.ts`, `session.test.ts`, `session.e2e.test.ts`, `loop.ts`,
`loop.test.ts`, `model.ts`, `permit.ts`, `permit.test.ts`, `replay.test.ts`, `brief-closing.md`,
`brief.test.ts`, `runner/cli/main.ts`, `runner/tsconfig.json`, `runner/README.md`,
`plugins/tribe/scripts/tests/test-supervisor-e2e.sh`, `.c3/c3-2-plugins/c3-215-tribe.md`.

**Rebase rule.** Execution branches from master **after** #173's PR has merged; Task 1.1 proves it
by content (`supervisorLedgerPathOf` in `core/paths.ts`, `ledgerPath` in `core/session.ts`,
`home-config.ts` gone, `rule-sessions-start-in-target-repo` in `.c3/rules/`) and refuses otherwise.
Every task locates code by symbol and test title, never by a master-`3194976` line number, so #173's
edits move lines without invalidating the plan. Where #173 changed a function this card also changes
(`buildOneShotOptions`, `consumeSession`, `sessionConfigFor`, the closing brief's G7 sentence), the
task keeps #173's behaviour and applies only this card's delta. If #173's executor ledger rows have
landed, V2 cross-checks dispatches against them; otherwise transcripts + `subagents/*.meta.json`
(card: "an acceptable oracle source").

---

## 9. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Turn-per-task costs more context reloads than one long session | prompt caching makes a resume cheap; G6 reports tokens and wall clock before → after, not asserted |
| An executor told "one subagent per task" still picks `hunter` | the simple-style text names `general-purpose`; V2 measures it |
| A plan whose Done needs a bootstrap fails in the clean checkout | the skill's simple-style text says so; the done-failed turn shows the output |
| Removing the ratify session drops a governance backstop Tribe campaigns relied on | it moves to `rulings-check.ts` + the Tribe-style Stage D; Open question Q1 |
| v1 campaign homes on disk stop running | refused loudly with the re-author instruction; no v1 campaign is live once #173 ships |
| #173 lands shapes this plan did not foresee | Task 1.1's content probes; symbol-based tasks |
| The sandbox is not logged in when PR 4 runs | Task 4.1 checks it first and stops with `NEEDS_DIRECTION`; the BEFORE sandbox run is PENDING-LOGIN (§6.7) |
| A real session asks instead of claiming a doomed task (V3b) | V3a is the deterministic, discriminating control; V3b's pass condition accepts either escalation reason |

Rollback: each PR group is a regular merge (`rule-no-squash-merge`); `git revert -m 1 <merge>` per
group, newest first. PR 2 (v2 state) is the only one with a data-shape consequence: after reverting
it, v2 homes are refused by the v1 runner; re-author as v1.

---

## 10. Open questions (What/Why) — none blocks planning

- **Q1 — the `ratified-as:` rulings gate.** Removed from the runner, the watchdog and the supervisor as
  Tribe governance, per the oracle ("the gap-gate and its stamp/trailers/**ratification**"; "when in
  doubt, flag it") and D6's naming of `brief-ratify.md`; moved to `gaps/rulings-check.ts` + the Tribe
  style's Stage D. Options: (a) remove and move (this spec); (b) keep the gate, make it plan-declared.
  Recommendation (a). A contrary ruling drops plan Tasks 3.1, 3.4, 3.5 and 3.6 and the `ratified-as`
  edits inside 3.2, 3.3, 3.7 and 3.8; nothing in PR 1 or PR 2 depends on it.
- **Q2 — the supervisor's closing session still re-verifies with `verify-shipped`.** With
  `--skip-gap-gate` its three remaining checks are exactly D4. Options: (a) keep the closing session
  and the flag (this spec); (b) the supervisor script re-verifies with the runner's own replay and the
  closing session only writes the report. Recommendation (a) now (smallest change, keeps an independent
  re-check); (b) as a follow-up if the owner wants the closing LLM out of verification.
- **Q3 — `general-purpose` named in the simple style.** D7 says "one subagent per task"; this spec
  names the type so an installed Tribe agent cannot be picked by its description. Recommendation: accept.
- **Q4 — V3 in the sandbox (D9) is two runs.** V3a is the committed hermetic E2E with a scripted
  session (deterministic, and the only check that proves the runner itself ran the failing command);
  it starts no Claude session, so the sandbox is set but has nothing to isolate. V3b is a real sandbox
  session on a task whose Done can never pass; it may ask instead of claiming, so it cannot carry the
  discriminating claim alone. Options: (a) both (this spec); (b) V3b only; (c) V3a only.
  Recommendation (a).
