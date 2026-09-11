# Plan — C3 `gap-gate-card-identity`: one card identity for the stamp, accepted by every reader

Spec: `docs/superpowers/specs/2026-09-10-tribe-harness-gap-gate-design.md` §3a (amendment, ruling R3).
Why: PR #129 (card C2) was correctly gated and merged, then refused by the runner's point 6 because
the stamp said `card=gap-gate-wiring` (the Warchief's slug) and the runner compared against `C2`.

## Global Constraints

**Standing constraints (campaign `gap-gate-2026-09-10`) — verbatim:**

- Implementer: every task is dispatched to the `hunter` subagent (Task tool, `subagent_type: hunter`, `model: sonnet` — owner ruling 2026-09-10 "Claude Sonnet do the work"), one task per Hunter, strict TDD, never written inline by the Warchief.
- Audit cell: owner ruling 2026-09-10 — the review/audit work is done by GPT-5.6 Sol through Codex, not by Claude skinners. For every audit round, build the two lens briefs exactly as your dual-skinner law prescribes (contract lens and cold lens, same content rules, same cold-brief walls, each with its own report-file path) and, instead of dispatching `skinner`, run for each lens: `bash /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/gap-gate-2026-09-10/codex-audit.sh --lens <contract|cold> --worktree <worktree> --brief <brief-file> --report <report-file>` (exit 3 means the audit mutated the tree: reset the worktree with `git checkout -- . && git clean -fd` and re-run). Read the two report files and adjudicate them exactly as you would two skinner reports (routing table, conflict ladder, disposition ledger). The Tracker (step 6.0b) and the Scout survey stay Claude agents (`subagent_type: tracker` / `scout`).
- Tracker report files: every Tracker dispatch carries a report-file path `<home>/reports/tracker-<card-slug>-<round>.md` (home = `$(bash plugins/tribe/scripts/tribe-home.sh /Users/hip/repo/tribe)`), and the brief tells the Tracker to write its full report there via Bash heredoc as its last act. Use the slug `gap-gate-card-identity` for the report files, for `gap-gate.ts --card`, and for every `Tribe-Card:` trailer.
- Ledger policy A (owner, 2026-09-10): `.tribe/harness-gaps.jsonl` lives in the target repo and is committed.
- Every commit carries `Tribe-Card: gap-gate-card-identity`, the task/milestone trailer, and `Campaign: gap-gate-2026-09-10`. Never a Co-Authored-By.
- Gates green before every commit: `cd plugins/tribe/scripts/runner && bun test`, and `bash plugins/tribe/scripts/tests/test-input-asymmetry.sh` (it pins the brief template). Pure core / impure edge (`~/.claude/rules/pure-core.md`): the trailer read goes through the existing `VerifyIO.exec` seam, never a direct subprocess.
- Existing tests' ASSERTIONS stay unchanged except the ones a task names (the brief snapshot in `brief.test.ts`).

## Oracle
Spec §3a is the contract. A stamp naming the runner id OR a `Tribe-Card:` trailer value of the merged commits passes; a stamp naming neither fails. Under-accepting (refusing a slug the commits carry) is the bug this card fixes; over-accepting (a stamp for a slug no commit carries) is a bug too.

## Adjudication rule (REFUTED in advance)
- Anything about the stamp format, `gap-gate.ts`, or `verify-shipped.sh` (C1's contract; unchanged here).
- The parked C2 escalation itself: it clears when the runner re-verifies PR #129 with this card's code, which is the Shaman's step, not this card's.

## Waves
One wave, two tasks, sequential (Task 2 edits the brief template whose snapshot test Task 1 does not touch; kept sequential for simplicity).

### Task 1: `verify.ts` point 6 accepts the merged commits' `Tribe-Card` slug

Files: `plugins/tribe/scripts/runner/core/verify.ts`, `plugins/tribe/scripts/runner/core/verify.test.ts`, `plugins/tribe/scripts/runner/README.md`.

- [ ] Step 1: Read `checkGapGateStamped` in `plugins/tribe/scripts/runner/core/verify.ts` and the `gapGateStamped` describe block in `verify.test.ts`; note how `buildIo` stubs `exec` and how point 1 returns `mergeSha`.
- [ ] Step 2: Write the failing tests in the `gapGateStamped` describe block (keep every existing assertion):

```ts
test('a stamp naming the Tribe-Card slug of the merged commits passes (runner id differs)', async () => {
  const slugStamp = STAMP.replace('card=C1', 'card=gap-gate-wiring');
  const io = buildIo({ prBody: slugStamp, ledgerAtBase: '{"id":"G-001","event":"opened"}\n' });
  const wrapped = { ...io, async exec(cmd: string[], o?: { cwd?: string }) {
    if (cmd[0] === 'git' && cmd[1] === 'log') return { stdout: 'gap-gate-wiring\ngap-gate-wiring\n', stderr: '', exitCode: 0 };
    return io.exec(cmd, o);
  } };
  const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
  expect(result.points.find((p) => p.id === 'gapGateStamped')?.passed).toBe(true);
});

test('a stamp naming a slug that NO merged commit carries still fails', async () => {
  const slugStamp = STAMP.replace('card=C1', 'card=some-other-card');
  const io = buildIo({ prBody: slugStamp });
  const wrapped = { ...io, async exec(cmd: string[], o?: { cwd?: string }) {
    if (cmd[0] === 'git' && cmd[1] === 'log') return { stdout: 'gap-gate-wiring\n', stderr: '', exitCode: 0 };
    return io.exec(cmd, o);
  } };
  const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
  expect(result.failedPoints).toContain('gapGateStamped');
  expect(result.points.find((p) => p.id === 'gapGateStamped')?.detail).toContain('some-other-card');
});
```

  Run `cd plugins/tribe/scripts/runner && bun test core/verify.test.ts` (expected: the first new test FAILS with "not C1", the second passes; all pre-existing tests still pass).
- [ ] Step 3: Implement in `verify.ts`: in `checkGapGateStamped`, when `stamp.card !== cardId`, run through the io seam `['git', 'log', '--format=%(trailers:key=Tribe-Card,valueonly)', `${mergeSha}^1..${mergeSha}`]` in `config.repoRoot` (thread `mergeSha` from point 1 into the function as a parameter; when it is `null`, fall back to the pre-existing failure whose detail ends in `, not ` followed by the runner card id). Split stdout on newlines, trim, drop empties; if `stamp.card` is in that set, continue to the ancestry checks; otherwise fail with the detail `PR #<pr> body carries a gap-gate stamp for card=<stamp.card>, which is neither <cardId> nor a Tribe-Card trailer of its merged commits (<comma-joined values or 'none'>)`. The pass detail names which identity matched. Keep the function's shape (pure decision on strings after the one exec).
- [ ] Step 4: Run `cd plugins/tribe/scripts/runner && bun test` (expected: all tests pass, count = previous count + 2).
- [ ] Step 5: Update `plugins/tribe/scripts/runner/README.md` `gapGateStamped` bullet (around line 623) to say the stamp's `card=` must match this card's id or a `Tribe-Card:` trailer of the merged commits, quoting the git command.
- [ ] **Step 6: Commit** — `git add plugins/tribe/scripts/runner/core/verify.ts plugins/tribe/scripts/runner/core/verify.test.ts plugins/tribe/scripts/runner/README.md docs/superpowers/plans/2026-09-11-gap-gate-card-identity.md && git commit -m "fix(runner): gapGateStamped accepts the merged commits' Tribe-Card slug (CU-4 §3a)" -m $'Tribe-Card: gap-gate-card-identity\nTribe-Task: 1/2\nCampaign: gap-gate-2026-09-10'` (expected: one commit, trailers present in `git log -1 --format=%(trailers)`).

### Task 2: the campaign brief names one identity — the card slug

Files: `plugins/tribe/scripts/runner/core/brief-template.md`, `plugins/tribe/scripts/runner/core/brief.test.ts`.

- [ ] Step 1: In `brief-template.md`, make exactly these two substitutions and one insertion, keeping every other line byte-identical:

```text
tracker-{{CARD_ID}}-<round>.md      ->  tracker-<your card slug>-<round>.md
{{CARD_ID}}-gap-gate.md             ->  <your card slug>-gap-gate.md
insert after the sentence ending "You never read those files yourself.":
  Your card slug is the value you put in every `Tribe-Card:` trailer (the runner accepts that
  slug in the stamp, and also the id {{CARD_ID}} above); use the same slug for the Tracker
  report files, `gap-gate.ts --card`, and the trailers.
```
- [ ] Step 2: Update the `EXPECTED_BRIEF` string in `brief.test.ts` to the new rendered text (this is the one assertion this plan changes). Run `cd plugins/tribe/scripts/runner && bun test core/brief.test.ts` (expected: pass).
- [ ] Step 3: Run `bash plugins/tribe/scripts/tests/test-input-asymmetry.sh` (expected: PASS) and `cd plugins/tribe/scripts/runner && bun test` (expected: all pass).
- [ ] **Step 4: Commit** — `git add plugins/tribe/scripts/runner/core/brief-template.md plugins/tribe/scripts/runner/core/brief.test.ts docs/superpowers/plans/2026-09-11-gap-gate-card-identity.md && git commit -m "fix(runner): the executor brief names the card slug as the one stamp identity (CU-4 §3a)" -m $'Tribe-Card: gap-gate-card-identity\nTribe-Task: 2/2\nCampaign: gap-gate-2026-09-10'` (expected: one commit, trailers present).

## Card acceptance — run before opening the PR

```bash
cd plugins/tribe/scripts/runner && bun test            # expected: all pass
bash plugins/tribe/scripts/tests/test-input-asymmetry.sh   # expected: PASS
grep -c 'Tribe-Card' plugins/tribe/scripts/runner/core/verify.ts   # expected: >= 1
grep -c 'your card slug' plugins/tribe/scripts/runner/core/brief-template.md   # expected: >= 1
```

The gate then runs on this card's own diff with `--card gap-gate-card-identity`, and the PR body carries its stamp.
