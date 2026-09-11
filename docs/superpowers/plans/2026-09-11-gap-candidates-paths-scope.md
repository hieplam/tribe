# Plan — C5 `gap-candidates-paths-scope`: a candidate's frozen `paths` cover the fingerprint's scope

Spec: `docs/superpowers/specs/2026-09-10-tribe-harness-gap-gate-design.md` §2 step 2 (as amended 2026-09-11).
Why: on the throwaway fixture (hieplam/tribe-gap-e2e), card 1 minted `G-001` with `paths=["src/reader.ts"]`; card 2 changed `src/formatter.ts`, overlapped nothing, and minted `G-002` for the same pattern. Evidence: `docs/superpowers/evidence/2026-09-10-gap-loop-fix/after-fix.md` (landed with this plan).

## Global Constraints

**Standing constraints (campaign `gap-gate-2026-09-10`) — verbatim:**

- Implementer: every task is dispatched to the `hunter` subagent (Task tool, `subagent_type: hunter`, `model: sonnet` — owner ruling 2026-09-10 "Claude Sonnet do the work"), one task per Hunter, strict TDD, never written inline by the Warchief.
- Audit cell: owner ruling 2026-09-10 — the review/audit work is done by GPT-5.6 Sol through Codex, not by Claude skinners. For every audit round, build the two lens briefs exactly as your dual-skinner law prescribes (contract lens and cold lens, same content rules, same cold-brief walls, each with its own report-file path) and, instead of dispatching `skinner`, run for each lens: `bash /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/gap-gate-2026-09-10/codex-audit.sh --lens <contract|cold> --worktree <worktree> --brief <brief-file> --report <report-file>` (exit 3 means the audit mutated the tree: reset the worktree with `git checkout -- . && git clean -fd` and re-run). Read the two report files and adjudicate them exactly as you would two skinner reports. The Tracker (step 6.0b) and the Scout survey stay Claude agents.
- Tracker report files: `<home>/reports/tracker-gap-candidates-paths-scope-<round>.md` (home = `$(bash plugins/tribe/scripts/tribe-home.sh /Users/hip/repo/tribe)`); use the slug `gap-candidates-paths-scope` for the report files, for `gap-gate.ts --card`, and for every `Tribe-Card:` trailer.
- Ledger policy A (owner, 2026-09-10): `.tribe/harness-gaps.jsonl` lives in the target repo and is committed.
- Every commit carries `Tribe-Card: gap-candidates-paths-scope`, the task trailer, and `Campaign: gap-gate-2026-09-10`. Never a Co-Authored-By.
- Gates green before every commit: `cd plugins/tribe/scripts/gaps && bun test`. Pure core: `gap-candidates.ts` stays free of fs/subprocess; the fingerprint's target tokens come from `fingerprint.ts`'s `tokenize`.
- Existing tests' ASSERTIONS stay unchanged except the one this plan names (shape A's `paths` equality).

## Oracle
Spec §2 step 2 as amended. A candidate whose `paths` omit the fingerprint's target scope is the bug (a later change inside that scope will not re-execute the fingerprint). Over-inclusion of a path that is in the Evidence line is by design. A bare `.` or `./` target is not a path: drop it (the Evidence/diff-link paths carry the scope).

## Adjudication rule (REFUTED in advance)
- Existing `opened` events on any ledger keep their frozen `paths` (M2: freeze at first write); this card changes only what NEW candidates freeze.
- `reconcile()`'s overlap rule and `paths.ts` are unchanged.

### Task 1: `paths` = fingerprint targets ∪ Evidence hit paths ∪ Diff-link paths

Files: `plugins/tribe/scripts/gaps/gap-candidates.ts`, `plugins/tribe/scripts/gaps/gap-candidates.test.ts`.

- [x] Step 1: Read `parseTrackerReport` and `extractPaths` in `gap-candidates.ts`, the `SHAPE_A`/`SHAPE_B`/`SHAPE_C` fixtures and the shape-A test in `gap-candidates.test.ts`, and `tokenize` in `fingerprint.ts`.
- [x] Step 2: Write the failing tests (add to `describe('parseTrackerReport')`; change ONLY the shape-A `paths` assertion as shown):

```ts
// shape A: replace  expect(c.paths).toEqual(['src/reader.ts', 'src/loader.ts']);  with:
expect(c.paths).toContain('src/');            // the fingerprint's target scope
expect(c.paths).toContain('src/reader.ts');   // diff link
expect(c.paths).toContain('src/loader.ts');   // evidence hit

test('paths include the fingerprint target so a later change in scope re-fires it (e2e regression, hieplam/tribe-gap-e2e#2)', () => {
  const report = [
    'HG-candidate 1  [input-validation]  diff FOLLOWS an undocumented pattern',
    '  Pattern:    `JSON.parse(input).value as string` type-asserts with no runtime check.',
    '  Evidence:   `grep -rn "as string" src/` → 4 hits in 4 files (`src/loader.ts:4`, `src/parser.ts:4`,',
    '              `src/writer.ts:4`, `src/reader.ts:4`)',
    '  Diff link:  src/reader.ts:4 repeats it (the diff\'s own new file follows the pattern)',
    '  Not judged: this is a gap in the rule set, not a violation',
  ].join('\n');
  const { candidates } = parseTrackerReport(report, 'tracker-C1-final.md', 'final');
  expect(candidates[0]!.paths).toEqual(expect.arrayContaining(['src/', 'src/loader.ts', 'src/parser.ts', 'src/writer.ts', 'src/reader.ts']));
});

test('a bare "." grep target is not a path', () => {
  const report = [
    'HG-candidate 1  [error-handling]  diff FOLLOWS an undocumented pattern',
    '  Pattern:    silent catch',
    '  Evidence:   `grep -rn "catch {}" .` → 3 hits in 3 files (`lib/a.ts:1`, `lib/b.ts:1`, `lib/c.ts:1`)',
    '  Diff link:  lib/c.ts:1 repeats it',
    '  Not judged: this is a gap in the rule set, not a violation',
  ].join('\n');
  const { candidates } = parseTrackerReport(report, 'tracker-X-final.md', 'final');
  expect(candidates[0]!.paths).not.toContain('.');
  expect(candidates[0]!.paths).toEqual(expect.arrayContaining(['lib/a.ts', 'lib/b.ts', 'lib/c.ts']));
});
```

  Run `cd plugins/tribe/scripts/gaps && bun test gap-candidates.test.ts` (expected: the three new/changed assertions FAIL — `src/` absent; everything else passes).
- [x] Step 3: Implement in `gap-candidates.ts`: add a pure helper `fingerprintTargets(fingerprint: string): string[]` that calls `tokenize`, drops argv[0], every token starting with `-`, and the first remaining token (the pattern), then keeps the rest minus `.`/`./`. In `parseTrackerReport`, compute `paths` as the de-duplicated union, in this order: `fingerprintTargets(fingerprint)`, then `extractPaths(evidenceField ?? '')`, then `extractPaths(diffLink ?? '')`, then (only if all three are empty) `extractPaths(blockText)`. Keep the existing `unparsed` reason when the union is empty.
- [x] Step 4: Run `cd plugins/tribe/scripts/gaps && bun test` (expected: all pass; count = previous count + 2). Also run the gate's own tests to prove dedup across rounds still collapses (`gap-gate.test.ts` unchanged, green).
- [x] Step 5: Prove the reconcile behaviour end to end in a scratch dir (no repo files touched): create `/tmp/c5-probe` with `src/a.ts`,`src/b.ts` containing `as string`; write a candidates JSON `[{"category":"input-validation","paths":["src/","src/a.ts"],"fingerprint":"grep -rn \"as string\" src/","hits":2,"description":"probe"}]`; run `bun plugins/tribe/scripts/gaps/gap-reconcile.ts --repo /tmp/c5-probe --registry .tribe/harness-gaps.jsonl --changed-files src/a.ts --candidates /tmp/c5-probe/c.json` (expected: `minted:["G-001"]`); then add `src/c.ts` with the pattern and run again with `--changed-files src/c.ts --candidates /tmp/c5-probe/empty.json` where `empty.json` is `[]` (expected: `matched:["G-001"]`, a `seen` line appended, nothing minted). Paste both outputs in the worker report.
- [x] **Step 6: Commit** — `git add plugins/tribe/scripts/gaps/gap-candidates.ts plugins/tribe/scripts/gaps/gap-candidates.test.ts docs/superpowers/plans/2026-09-11-gap-candidates-paths-scope.md && git commit -m "fix(gaps): a candidate's frozen paths cover the fingerprint's scope, so a later change re-fires it (CU-4 §2 step 2)" -m $'Tribe-Card: gap-candidates-paths-scope\nTribe-Task: 1/1\nCampaign: gap-gate-2026-09-10'` (expected: one commit with the trailers).

## Card acceptance
`bun test` in `scripts/gaps` green; the Step 5 probe shows mint-then-seen; the gate runs on this card's diff with `--card gap-candidates-paths-scope` and the PR body carries its stamp. The Shaman re-runs the two-card fixture on a fresh throwaway repo after merge: card 2 must append `seen` on `G-001`.
