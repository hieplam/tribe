# Plan — C4 `evals-track-shipped-gate`: evals 37/45/46 grade the shipped gate behaviour

Spec: `docs/superpowers/specs/2026-09-10-tribe-harness-gap-gate-design.md` §7 (as amended: "the coverage of the existing cases 37 and 44–47 stays; their prompts and rubrics track the shipped behaviour"). Rulings R1/R4 in the campaign's `answers.md`.

## Global Constraints

**Standing constraints (campaign `gap-gate-2026-09-10`) — verbatim:**

- Implementer: every task is dispatched to the `hunter` subagent (Task tool, `subagent_type: hunter`, `model: sonnet` — owner ruling 2026-09-10 "Claude Sonnet do the work"), one task per Hunter, strict TDD (the "test" here is the eval harness run the task names), never written inline by the Warchief.
- Audit cell: owner ruling 2026-09-10 — the review/audit work is done by GPT-5.6 Sol through Codex, not by Claude skinners. For every audit round, build the two lens briefs exactly as your dual-skinner law prescribes (contract lens and cold lens, same content rules, same cold-brief walls, each with its own report-file path) and, instead of dispatching `skinner`, run for each lens: `bash /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/gap-gate-2026-09-10/codex-audit.sh --lens <contract|cold> --worktree <worktree> --brief <brief-file> --report <report-file>` (exit 3 means the audit mutated the tree: reset the worktree with `git checkout -- . && git clean -fd` and re-run). Read the two report files and adjudicate them exactly as you would two skinner reports. The Tracker (step 6.0b) and the Scout survey stay Claude agents.
- Tracker report files: `<home>/reports/tracker-evals-track-shipped-gate-<round>.md` (home = `$(bash plugins/tribe/scripts/tribe-home.sh /Users/hip/repo/tribe)`); use the slug `evals-track-shipped-gate` for the report files, for `gap-gate.ts --card`, and for every `Tribe-Card:` trailer.
- Ledger policy A (owner, 2026-09-10): `.tribe/harness-gaps.jsonl` lives in the target repo and is committed.
- Every commit carries `Tribe-Card: evals-track-shipped-gate`, the task trailer, and `Campaign: gap-gate-2026-09-10`. Never a Co-Authored-By.
- Gates green before every commit: `bash plugins/tribe/scripts/tests/test-input-asymmetry.sh` (it pins the eval count, which does not change here) and the eval harness run named in Task 1. Existing cases 44, 47, 48–52 stay byte-identical; case ids and names of 37/45/46 stay.

## Oracle
Spec §7 is the contract. A rubric that still rewards hand-mapping candidates, calling `gap-reconcile.ts --candidates`, or running `debt-count.ts --diff` as a standalone gate is the bug; a rubric that grades "runs `gap-gate.ts` resolved from the plugin root, never hand-reconciles, treats its exit code as the PR gate" is correct. Cases 48–50 are the shape to copy (the "repo is NOT available — write out the sequence" device).

## Adjudication rule (REFUTED in advance)
- Case 47 (Shaman over-elaboration): not this card's; leave untouched.
- Any change to the agent prompts or scripts: out of fence.

### Task 1: rewrite cases 37 and 45, reshape case 46

Files: `plugins/tribe/evals/evals.json`.

- [x] Step 1: Read cases 37, 45, 46 and 48–50 in `plugins/tribe/evals/evals.json`; note 48–50's prompt device ("the repo is NOT available in this environment — write out, in order, the exact commands and dispatches you would run") and their rubric phrasing.
- [x] Step 2: Establish the RED baseline by running the harness on the three cases as they are (`--mode with_skill` skips the no-skill baseline arm; the grader and executor use the configured default model):

```bash
scripts/evals/run_evals.py --evals plugins/tribe/evals/evals.json --eval-id 37,45,46 --mode with_skill 2>&1 | tail -20
```

  (expected: 37 and 45 FAIL — the grader reports the agent ran `gap-gate.ts` and refused to hand-reconcile; 46 fails or is ungraded for the non-executable delivery.)
- [x] Step 3: Rewrite case 37 (keep `"id": 37` and its `name`): prompt = Method step 7 with three Tracker report files on disk under the tribe home (`tracker-<card>-task-2.md`, `-wave-1.md`, `-final.md`), the final one carrying no candidate, repo NOT available — write out the sequence; `expected_output` = the Warchief resolves `gap-gate.ts` from the plugin root, runs it with `--repo --home --card --base --head`, never reads the report files itself, never says "no candidates", never invokes `gap-reconcile.ts` or maps fields by hand, treats exit 0/1/2 as the gate, pastes `<card>-gap-gate.md` verbatim as `## Harness gaps`, commits the ledger append before `gh pr create`.
- [x] Step 4: Rewrite case 45 (keep id and name): prompt = the final Tracker report file carries no `### Harness gaps` section at all, repo NOT available — write out the sequence; `expected_output` = the Warchief still runs `gap-gate.ts` unconditionally, states its exit code decides whether the PR may open, does not run `debt-count.ts --diff` or `gap-reconcile.ts` by itself (the gate runs the burn-down), still runs `debt-backfill.ts` and closes `closable` entries, and pastes the gate's section (stamp with `minted=none`) into the PR body.
- [x] Step 5: Reshape case 46: keep its scenario and `expected_output` substance (headless channel; no `NEEDS_DIRECTION`; no self-ratification; drafts land in the PR; registry `ruled` events left unwritten) but change the prompt's framing to the 48–50 device so the agent writes out the sequence instead of attempting delivery.
- [x] Step 6: Validate and run: `python3 -c "import json;d=json.load(open('plugins/tribe/evals/evals.json'));print(len(d['evals']))"` (expected: `52`), then

```bash
scripts/evals/run_evals.py --evals plugins/tribe/evals/evals.json --eval-id 37,44,45,46,48,49,50,51,52 --mode with_skill 2>&1 | tail -30
```

  (expected: every listed case passes; paste the roll-up in the worker report.)
- [x] Step 7: `bash plugins/tribe/scripts/tests/test-input-asymmetry.sh` (expected: PASS).
- [x] **Step 8: Commit** — `git add plugins/tribe/evals/evals.json docs/superpowers/plans/2026-09-11-evals-track-shipped-gate.md && git commit -m "test(evals): cases 37/45/46 grade the shipped gap-gate behaviour (CU-4 §7, ruling R1)" -m $'Tribe-Card: evals-track-shipped-gate\nTribe-Task: 1/1\nCampaign: gap-gate-2026-09-10'` (expected: one commit with the trailers).

## Card acceptance
The Task 1 Step 6 harness run passes for every listed id; the gate runs on this card's diff with `--card evals-track-shipped-gate` and the PR body carries its stamp.
