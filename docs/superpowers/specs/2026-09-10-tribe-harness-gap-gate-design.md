# CU-4 — Harness-gap gate: make the self-improvement loop's middle mechanical (design)

**Status:** decided 2026-09-10 (owner rulings inline). Governs campaign `gap-gate-2026-09-10` — a
campaign is a batch of cards (one card = one PR-sized unit of work) the campaign runner delivers
unattended; this one has two cards, C1 and C2 (§8).
**Inherits:** CU-2 (`2026-07-27-tribe-harness-gap-detection-design.md`) and CU-3
(`2026-07-29-tribe-scout-ruling-loop-design.md`) in full. Nothing below reopens a decision
those specs ratified; every threshold, writer-exclusivity rule, and ratification gate stays.

## Problem

The harness-gap loop (the "self-improvement loop" of the title) is the tribe's mechanism for
turning a risky pattern the Tracker sees in a diff into a written rule, an anti-rule, or a
tracked debt entity. It has never recorded one ledger event. Vocabulary used throughout: an
**HG-candidate** is a Tracker report entry that meets CU-2's four conditions — (1) the diff
itself follows or breaks the pattern, (2) the pattern is in one of five risk categories: error
handling, concurrency/async, resource cleanup, input validation/security, test presence, (3) it
appears in at least 3 files, proven by a grep the Tracker ran and quoted, (4) no written rule
covers it. **Step 6.0b** and **step 7** are the Warchief's audit and delivery steps in
`plugins/tribe/agents/warchief.md`. The **ledger** is `.tribe/harness-gaps.jsonl`, an append-only
JSONL file of `opened` / `seen` / `ruled` events keyed by ids `G-NNN`. As of 2026-09-10 no `.tribe/harness-gaps.jsonl` exists in any repo on this
machine, and no transcript shows `gap-reconcile.ts` running with candidates. Detection works:
of 118 Tracker runs recorded since 2026-08-20, 7 returned a real four-condition HG-candidate in
their final message. Across 43 Warchief runs, `gap-reconcile.ts` — the script that mints or matches ids — was
executed 0 times (12 mention it, either in an `ls` of the scripts directory or in prose such as
"gap-reconcile can be skipped"). This is the second time the loop has been found dead (PR #91,
2026-08-13, found the same symptom and fixed a different link).

The loop is a chain of two script-owned segments joined by prose hand-offs:

```
Tracker report (returned text)            ── prose: "carry forward verbatim"
  → Warchief memory                       ── prose: "when the FINAL report contains…"
  → Warchief hand-maps fields to JSON     ── LLM field mapping
  → bun gap-reconcile.ts (script)         ── writes .tribe/harness-gaps.jsonl (relative path)
  → PR body section                       ── prose
  → Scout proposals → ratification → gap-rule.ts (script)
```

(Scout is the tribe's analysis agent; it proposes a disposition per gap. Ratification is a
human or Shaman approving that proposal. `gap-rule.ts` records the approved ruling as a
`ruled` event and creates the rule or debt artifact.)

Where each candidate died (evidence in `docs/superpowers/evidence/2026-09-10-gap-loop-fix/verification.md`):

| Leak | What happens | Instance |
| --- | --- | --- |
| L1 | Only the *final* whole-branch Tracker report feeds step 7. Per-task and per-wave Tracker runs are discarded. 6 of the 7 candidates came from non-final runs. | session 56af20da, PR #103: the Task 5 Tracker found silent `catch {}` in 11 files; the final Tracker returned none; PR body says "zero qualifying candidates". |
| L2 | "No ledger yet" is read as "nothing to reconcile", so bootstrap never happens. The script already treats a missing file as empty. | PR #123: "there is no registry to reconcile against and no G-NNN ids have been minted". |
| L3 | A candidate noted mid-card lives only in report prose and is lost across resumes. | session 93fe0a83: 3rd resume records "1 harness-gap candidate recorded for step-7"; the 7th resume opened the PR with no reconcile call. |
| L4 | A session that is not the Warchief opens the PR, so step 7 never runs. | Session ae4731e3 on a separate target repo (`cuongtranba/kanna`, a desktop app the tribe was run against): the orchestrating main session itself ran `gh pr create` (its PR #825); the three candidates its Trackers had reported vanished. |
| L5 | Even a written ledger would not survive: the path is relative to the card's worktree, nothing commits it, and the worktree is deleted after merge. | By construction; no instruction in warchief.md, brief-template.md, or the specs says to commit it. |
| L6 | The Warchief resolves the script against the *target* repo and concludes the tooling does not exist. | Empty-fixture reproduction 2026-09-10 (`docs/superpowers/evidence/2026-09-10-gap-loop-fix/repro-before.md`): Tracker reported a four-condition candidate in 4 files; the Warchief wrote "No `.c3/`, no gap-reconcile script — the tooling doesn't exist in this fixture" and shipped a prose section. |

Meanwhile a second, prose-only path *did* produce rules: the campaign closing pass on
2026-09-05 (commit 036c5cc) ratified proposals from PR bodies through `answers.md` (the campaign's ruling file, written only
by the Shaman session) and its `ratified-as:` lines, with no G-NNN id, no `gap-rule.ts`, and no debt entity. So the two halves never
meet in one ledger, and `gap-precision.ts` has nothing to score.

**Root cause.** Every link between the Tracker's report and the ledger is a prose instruction
to an LLM, and nothing mechanical observes whether the link fired. CU-3's own law M3 —
"scripts own everything decidable; LLM judgment only where unavoidable, and every remaining
judgment gets an adversarial eval" — was applied to the two ends (reconcile, rule) and not to
the middle. Evals 44–47 test each agent's prompt in isolation, so they pass while the chain
between agents leaks. The `debt-count.ts --diff` gate, also invoked by prose ("unconditional on
every PR"), ran in roughly 5 of 43 Warchief runs — the same failure shape, confirming that
"a script the agent is told to run" is not a gate.

## Non-negotiable boundary (inherited, restated)

- Thresholds are frozen and owner-only: ≥ 3 files, ≤ 3 gaps per review, the five categories
  listed in the Problem section, precision ≥ 50 % over the trailing 20 ruled gaps (CU-2 D4).
- Writer exclusivity and the ratification gate, as named in the Inherits line at the top, are the
  next two bullets.
- No autonomous rule adoption: a rule reaches enforcement only through a PR a human can reject
  (CU-3 AG-1, CU-2 D6).
- No agent hand-writes the ledger, a debt file, or an issue. `gap-reconcile.ts` (opened/seen),
  `gap-rule.ts` (ruled), and `debt-backfill.ts` (issues) stay the only writers (CU-2 D3).
- The Tracker stays read-only and stateless with respect to the repo and the registry.

## Design

The middle of the loop becomes one script gate with one durable input and one checkable
output. What is decidable moves into scripts; what needs judgment (detection, adjudication,
ratification) stays where it is.

### 1. Tracker reports become files (fixes L1, L3)

Every Tracker dispatch carries a report-file path, exactly as Hunter and Skinner dispatches do
today: `<home>/reports/tracker-<card-slug>-<round>.md`, where `<home>` is the machine-local
tribe home (`tribe-home.sh`) and `<round>` is a monotonically increasing audit-round label
(`task-3`, `wave-2`, `final`, `fix-1`…). The Tracker writes its full report there as its last
act, in the exact format of tracker.md step 5 — the report file is the same text it returns.
A report file under `~/.tribe/` is not the repo and not a registry, so the Tracker's read-only
wall is intact.

The Warchief no longer "carries forward" anything. The gate below reads every
`tracker-<card-slug>-*.md` on disk, so a candidate found at task 3 and absent from the final
whole-branch run still reaches reconciliation, and a candidate found before a crash survives the
resume because the file survives.

### 2. `gap-gate.ts` — the one pre-PR gate (fixes L1, L2, L3; makes L4 detectable)

New script, `plugins/tribe/scripts/gaps/gap-gate.ts`, same shape as `pre-gate.sh`: one
invocation before any PR is opened, red/green exit code, one Markdown report, one JSON summary.

```
bun gap-gate.ts --repo <target-repo> --home <tribe-home> --card <card-slug> \
                --base <merge-base-sha> [--head HEAD] [--pr <n>] \
                [--registry .tribe/harness-gaps.jsonl] [--out <home>/reports]
```

Steps, in order; every step's result is in the JSON summary:

1. **Collect.** Glob `<home>/reports/tracker-<card>-*.md`. Zero files → exit 2 with the message
   `no Tracker report for card <slug>: step 6.0b never ran, or the report path was wrong`. A
   missing input is a red gate, never an empty set — this is what makes skipping the Tracker
   loud instead of silent.
2. **Parse.** Extract every `HG-candidate N [category]` block from every report with a pure
   parser (`gap-candidates.ts`), mapping exactly the fields warchief.md step 7 sub-step 1 maps
   by hand today: `Category`→`category`, `Pattern`→`description`, the `Evidence` grep→
   `fingerprint`, its quoted hit count→`hits`, and `paths` = the fingerprint's own target
   arguments (the grep's non-flag, non-pattern tokens, e.g. `src/`) ∪ the `Evidence` hit paths ∪
   the `Diff link` paths (amendment 2026-09-11, card C5: the first end-to-end run froze only the
   diff-link file, so the next card's files never overlapped the entry and a duplicate id was
   minted instead of a `seen`). A block the parser
   cannot map is reported under `unparsed` with the file and line; it never aborts the gate
   (under-parsing is a visible defect, over-strictness would recreate L1). Candidates from
   different rounds with the same category and overlapping paths collapse to one, keeping the
   earliest round's fingerprint (the freeze-at-first-write rule, CU-2 M2).
3. **Changed files.** `git diff --name-only <base>...<head>` in `--repo` (edge; the pure core
   never shells out).
4. **Reconcile.** Call `reconcile()` from `gap-reconcile.ts` as a library with the registry path
   resolved against `--repo` (a missing file is an empty ledger — already the script's
   behaviour, now stated), the changed files, the parsed candidates, and `--pr` when given.
   The gate is the only new caller; `gap-reconcile.ts`'s CLI contract is unchanged and gains
   `--repo` so its greps resolve against the target tree, not the shell's cwd.
5. **Debt burn-down.** Call `diffDebt(repo, base, head)`, already exported by `debt-count.ts`
   (no change to that file); any positive delta is red, exactly as CU-3 §4 already specifies.
   The gate is now the one place this runs.
6. **Report.** Write `<out>/<card>-gap-gate.md` — the complete `## Harness gaps` PR-body section
   (matched ids, minted ids, suppressed count, flagged fingerprints, the debt delta line or
   nothing, every proposal slot left for Scout) ending in one machine-checkable stamp line:

   ```
   <!-- gap-gate v1 card=<slug> base=<sha> head=<sha> minted=G-004,G-005 matched=G-001 debt-delta=0 ledger=<sha256 of the ledger after this run> -->
   ```

   and `<out>/<card>-gap-gate.json` with the same fields plus `candidates`, `unparsed`, and
   `open_ids` (the ids Scout must adjudicate).
7. **Exit.** 0 = green (PR may open). 1 = red: positive debt delta, or a flagged fingerprint
   on a candidate this diff introduced — "flagged" is `fingerprint.ts`'s existing verdict that a
   stored grep is not a single shell-free `grep` invocation (it contains a pipe, `$(`, `;` or
   similar), so the gate refuses to execute it and reports it instead of guessing. 2 = setup error (no reports, bad range,
   unreadable ledger — each with a one-line typed refusal, never a stack trace,
   per `fail-closed-edges`).

Pure core: parsing, dedup, stamp formatting, PR-section rendering — all functions of their
arguments, tested without a repo. Impure edge: the glob, the git call, the ledger read/append
(through `reconcile()`), the file writes. Every subprocess carries a timeout and
`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` set to `/dev/null`.

### 3. The stamp is verified after merge (makes L4 loud)

A gate an agent is told to run is still prose. The mechanical backstop is post-hoc and
channel-independent: a PR whose body lacks a valid `gap-gate v1` stamp for its card is **not
shipped**.

- **Runner D3 replay** (`runner/core/verify.ts`, the runner's five mechanical post-merge checks:
  merged, merge sha on master, checks green, worktree and branch gone, schema guard) gains a
  sixth point, `gapGateStamped`: the
  merged PR's body carries a stamp whose `card=` matches and whose `base=`/`head=` shas are
  commits of the merged branch. A failed point is reported like every other D3 point — the card
  escalates instead of recording `shipped`.
- **`verify-shipped.sh`** gains the same check as its fourth verdict line, so an attended
  Shaman session, or a Mammoth Hunt (the single-card tribe workflow), applying "verify before repeating SHIPPED" catches a PR opened
  by any session that bypassed the Warchief (L4).
- **`ledger_committed`** (only under ledger policy A below): the merged master tree contains
  every id the stamp says was minted.

Neither check can stop a bypassing session from opening a PR. Both make the bypass a red
verdict the Shaman must act on, which is the strongest guarantee available without a server-side
hook, and it satisfies the definition of fixed in the Verification section below: the merged
master must carry the ledger event, and the PR body must carry the reconcile output.

#### 3a. Card identity in the stamp (amendment 2026-09-11, ruling R3)

A card has two names: the runner's campaign-local id (`C2`) and the slug the Warchief uses in
its state file, its report files, and every `Tribe-Card:` commit trailer (`gap-gate-wiring`).
The first campaign run of this design (PR #129) stamped the slug while the runner's point 6
compared against the id, so a correctly gated, merged PR was refused as not shipped. The rule:
**the stamp carries the Warchief's card slug**, and every reader accepts it as follows.

- `gap-gate.ts --card` is the slug; the Tracker report files are `tracker-<slug>-<round>.md`;
  the campaign brief says so and never asks for the runner id.
- Runner point 6 (`gapGateStamped`) passes when `stamp.card` equals the runner's card id **or**
  equals a `Tribe-Card:` trailer value on the commits the merged PR brought in (the second-parent
  side of the merge commit, `git log <mergeSha>^1..<mergeSha>`). That range also includes the
  merge commit itself; this is deliberate and inert, because a `gh pr merge --merge` commit
  carries no `Tribe-Card:` trailer (ruling R8, 2026-09-11). Ancestry of `base`/`head` is
  checked as before. A stamp naming neither is still a failure.
- `verify-shipped.sh --card` takes the slug, unchanged.

### 4. Where the ledger lives — owner decision, ruled 2026-09-10: Option A

CU-2 wrote `.tribe/harness-gaps.jsonl in the target repo`, citing the runner's state-in-repo
precedent. That precedent has since reversed: the runner now keeps all operational state under
`~/.tribe/<repo-key>/` and commits nothing. The ledger is therefore the last relative-path,
never-committed artifact in the loop, and it dies with the worktree (L5). Two options; the
choice changes data shape and is the owner's:

**Option A — committed, in the target repo (recommended).** `.tribe/harness-gaps.jsonl` stays
where CU-2 put it. The gate appends to it inside the card's worktree, and the Warchief commits
the append with the trailer `Tribe-Milestone: gap-gate` before opening the PR; the ledger lines
ride the PR and land on master with the merge. `ruled` events from `gap-rule.ts` ride the
closing governance PR the same way. Pros: durable across worktrees and machines; the ids that
rules and debt entities reference are in the same tree as those artifacts; reviewable in the PR
diff; `gap-precision.ts` scores from a clone. Cons: one small commit per reconciling PR; two
cards minting concurrently conflict on the append-only file (with the runner's default
`--max-concurrent 1` this cannot happen; otherwise the second branch drops its ledger lines,
rebases, and re-runs the gate — the gate re-mints against the merged ledger).

**Option B — machine-local, never committed.** `~/.tribe/<repo-key>/harness-gaps.jsonl`,
next to the campaign homes. Pros: zero repo noise, no merge conflicts, matches the runner's
current state policy. Cons: a rule or debt entity committed to the repo references a G-NNN that
exists only on one machine; a fresh clone starts from an empty ledger and re-mints; precision
data is per machine; the ledger is invisible in code review.

**Ruling (owner, 2026-09-10): Option A.** The ledger stays at `.tribe/harness-gaps.jsonl` in
the target repo and is committed. Option B is recorded only as the rejected alternative.

### 5. Rulings go through `gap-rule.ts` on both channels (closes the prose-only path)

- **Campaign closing pass** (`orchestrate-campaign` Stage D, item 2): for every card, read
  `<home>/reports/<card>-gap-gate.json`'s `open_ids` and, for each ratified proposal, run
  `gap-rule.ts` with `--ratified-by shaman` in the closing governance PR's worktree, so the
  `ruled` events ride that PR. A ruling in `answers.md` for a gap that has an id records it as
  `ratified-as: rule <path> (G-NNN)`. Today `core/rulings.ts` accepts `rule <path>` with nothing
  after the path; card C2 (§8) tests whether a trailing `(G-NNN)` already passes `RATIFIED_VALUE_RE`
  and, if it does not, extends the pattern to accept it.
- **Attended channel** (Shaman session, Mammoth Hunt): shaman.md's ratification duty and
  mammoth-hunt SKILL.md step 4 state the same thing: a ratified proposal that carries a G-NNN is
  executed through Scout running `gap-rule.ts`, never by editing a rule file directly. This is
  already CU-3 §6's flow; the change is that mammoth-hunt names it, because cards run outside a
  campaign had no closing pass at all (PR #115's five proposals, PR #123's five, none landed).

### 6. Agent-prompt changes (the prose that remains, now thin)

| File | Change |
| --- | --- |
| `agents/tracker.md` | Dispatch carries a report-file path; the Tracker writes its report there as its final act. |
| `agents/warchief.md` step 6.0b | Every Tracker dispatch names `<home>/reports/tracker-<card>-<round>.md`. The "carry forward verbatim" bullet is replaced by "the gate reads the files". |
| `agents/warchief.md` step 7 | Sub-steps 1–3 and the debt-count bullet are replaced by one bullet: run `gap-gate.ts` (resolved from the plugin root), treat its exit like the pre-gate, paste `<card>-gap-gate.md` verbatim as the PR body's `## Harness gaps` section, commit the ledger append (policy A). Sub-step 4 (Scout dispatch on `open_ids`) and the backfill/closable bullets stay. |
| `runner/core/brief-template.md` | The per-card duties block names the gate and the stamp. |
| `skills/orchestrate-campaign/SKILL.md` | Stage D item 2 per §5. |
| `skills/mammoth-hunt/SKILL.md` | Step 4 per §5. |
| `skills/verify-shipped` | Fourth check per §3. |
| `plugins/tribe/README.md`, `runner/README.md` | Describe the gate, the stamp, the ledger policy. |

### 7. Evals (adversarial, per M3)

The coverage of the existing cases 37 and 44–47 stays; their prompts and rubrics track the shipped behaviour (ruling R1, 2026-09-11). New cases:

- Warchief at step 7 with three Tracker report files on disk, only the final one empty: the
  written-out sequence runs `gap-gate.ts` and never inspects the reports itself, never says
  "no candidates".
- Warchief whose target repo has no ledger: proceeds to run the gate; never says "no registry
  to reconcile against".
- Warchief resuming with `RESUME_DELIVERY`: runs the gate before `gh pr create`, does not
  re-derive candidates from the state file or memory.
- Tracker dispatched with a report-file path: writes the file and returns the same text.
- Shaman reading a `verify-shipped` result whose fourth line is red: refuses the SHIPPED claim.

These cases are single-agent by nature, so they are necessary and not sufficient; the
definition of done below is the sufficient part.

### 8. Cards and file-change inventory

Two cards, one PR each, in dependency order. Per `rule-change-unit-ships-with-code`, each PR
applies the change-unit patches whose after-state it realises.

- **C1 `gap-gate-scripts`** — the scripts and the mechanical checks: `gap-candidates.ts`,
  `gap-gate.ts`, `gap-reconcile.ts --repo` + typed refusals, `ledger.ts` typed parse error,
  `runner/core/verify.ts` sixth/seventh points, `verify-shipped.sh` fourth check, their tests,
  runner README + verify-shipped SKILL.md. Authors the CU-4 ADR and its patches; applies the
  Contract-row patches (script surfaces) in this PR.
- **C2 `gap-gate-wiring`** — the prompts, skills, evals and docs of §6–§7, plus the remaining
  CU-4 patches (Business Flow, Governance) and the reconciliation of the inherited CU-2/CU-3
  change-units, whose patches were never applied to `c3-215` (the fact mentions none of
  `gap-reconcile`, `harness-gaps.jsonl`, `debt-count`): CU-4's patches carry the union after-state
  and CU-2/CU-3 are closed as superseded by CU-4 in the same PR, so `c3x check` is green and no
  ADR is left `proposed` with drifted patches.

| Path | Change |
| --- | --- |
| `scripts/gaps/gap-candidates.ts` (+test) | new — pure parser + dedup |
| `scripts/gaps/gap-gate.ts` (+test) | new — the gate (edge + pure render/stamp core) |
| `scripts/gaps/gap-reconcile.ts` (+test) | `--repo` flag; registry/grep paths resolve against it; typed refusals in `main` |
| `scripts/gaps/ledger.ts` (+test) | `parseLedger` raises a typed `LedgerError` on a bad line instead of a bare `JSON.parse` throw |
| `runner/core/verify.ts` (+test) | sixth point `gapGateStamped` (+ `ledgerCommitted` under A) |
| `plugins/verify-shipped/.../verify-shipped.sh` (+test) | fourth check |
| agents, skills, READMEs, brief template | per §6 |
| `evals/evals.json` | per §7 |
| `.c3/` | ADR CU-4 + change-unit patching `c3-215` (contract + business flow + governance) and `c3-217`; C1 applies the script-surface rows, C2 the rest and the CU-2/CU-3 supersession |
| `install.sh` | no change expected — `scripts/gaps/` is installed as a directory; the card verifies on an empty `~/.claude` fixture (`test-fresh-machine.sh`) |

### 9. Out of scope (recorded, not fixed here)

Script-edge hardening beyond what the gate itself needs: timeouts on the other four
`Bun.spawn` sites, host-git-config isolation in `debt-tree.ts`, `gap-precision.ts` `main`
try/catch, and a scope mismatch in the ledger's two hit counts (`hits_at_detection` on an
`opened` event is repo-wide; `hits_now` on a `seen` event counts only the changed files, so the
two are not comparable). These are real and are
filed as one follow-up card; none blocks the wiring fix.

## Verification (definition of done)

Unit tests and single-agent evals passing is **not** evidence for this change — that is
exactly what hid the defect twice. Done means all of:

1. Every new and changed script test passes (`bun test` in `scripts/gaps` and `runner`);
   `test-fresh-machine.sh` and the verify-shipped suite pass.
2. **Empty-fixture end-to-end, before and after.** The reproduction script at
   `docs/superpowers/evidence/2026-09-10-gap-loop-fix/build-fixture.sh` builds a bare
   repo with one planted gap (silent `catch {}` in 3 files, error-handling, no rule) and one
   card whose plan adds a 4th file following it. Run through the real campaign runner with the
   same model tier real campaigns use:
   - **Before** (done, `docs/superpowers/evidence/2026-09-10-gap-loop-fix/repro-before.md`): the Tracker reported a
     four-condition candidate; the Warchief never ran `gap-reconcile.ts`; no ledger appeared.
   - **After**, on a throwaway GitHub repo so the PR can actually merge: master contains
     `.tribe/harness-gaps.jsonl` with one `opened` event (policy A), the PR body carries the
     stamp, `verify-shipped` is green on all four lines, and the runner recorded `shipped`.
   - **Second card** on the same fixture touching the same pattern: one `seen` event on the
     same id, no new G-NNN.
3. The fixture is exercised the way a person invokes it: `--repo` given as a relative path
   from a different cwd at least once (`fixtures-mirror-reality`).
