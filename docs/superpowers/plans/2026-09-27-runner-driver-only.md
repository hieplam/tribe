# Plan — runner-driver-only: the runner, watchdog and supervisor drive the plan and nothing else

**Spec (the contract):** `docs/superpowers/specs/2026-09-27-runner-driver-only-design.md` — read it
first; every design decision below is made there, with its `file:line` grounding.
**Card:** `~/.tribe/-Users-hiep-repo-tribe/cards/runner-driver-only.md`.
**Base:** master **after** campaign `sessions-in-repo` (#173) has merged — Task 1.1 proves it.
**Evidence dir:** `docs/superpowers/evidence/2026-09-27-runner-driver-only/` (`$E` below); the BEFORE
baselines are already there (`baseline.md`).
**Measurement tools (already committed with this plan):** `plugins/tribe/scripts/tests/runner-driver-only/`
(`$T` below): `tribe-lexicon.ts`, `render-prompts.ts`, `g2-prompts.ts`, `fixture-values.ts`,
`transcript-prompts.ts`, `run-metrics.ts`, `g3-verify-replay.ts`, `fixture-reset.sh`, `bypass-audit.ts`,
`no-live-campaign.sh`.
**Sandbox (card D9):** `S` = `/Users/hiep/.claude-sandboxes/runner-driver-only`, a Claude home installed by
`install.sh` with its `agents/` emptied; V2, V3 and V5 (and the BEFORE baseline, spec §6.7) run with
`CLAUDE_CONFIG_DIR=$S`; V4 runs in the real home. Every sandbox run ends with the two D10 bypass-audit
layers (spec §6.8).

## How to work

This plan is written in the **simple style** it introduces (card D7):

- Do the tasks in order. Give each task to **one `general-purpose` subagent**. The subagent writes
  the test, watches it fail, writes the code, runs the task's Done commands, and commits.
- Every task ends with a **Done** section: shell commands, one per line, each run on its own with
  `bash -c` from the repo root of a clean checkout of the task's commit. The task is done when
  every command exits 0. (`cd` does not carry between lines — each line that needs the runner
  directory starts with `cd plugins/tribe/scripts/runner && …`.)
- The tasks land as **four PRs** (owner memory: many-task plans land as several PRs, grouped by
  task). Each PR ends with a governance task (C3 + README) so the architecture record never lags.

| PR | Tasks | Lands |
| --- | --- | --- |
| PR 1 — Tribe out of the executor path | 1.1–1.10 | G3' for the runner; most of V1 on the executor side; D4's `localBaseSynced` |
| PR 2 — the plan drives: task index, runner-run Done commands, turns | 2.1–2.18 | D1, D2, G4, G5, V3, V6 |
| PR 3 — the supervisor and watchdog follow the plan only; plan styles | 3.1–3.10 | D6, D7, V1 gate |
| PR 4 — real runs and evidence | 4.1–4.7 | V2, V3 (sandbox), V4, V5, V7, G3' after, G6, D10 |

Open each PR with `gh pr create`, wait for CI to conclude green in the foreground, and land it with
`gh pr merge --merge` (never squash — `rule-no-squash-merge`) before starting the next PR's first
task on a fresh branch from the updated master. **PR 2 merges only right after
`$T/no-live-campaign.sh` exits 0** (Task 2.18): it makes the runner refuse v1 campaign states.

## Global Constraints

- **Implementer:** each task goes to one `general-purpose` subagent (simple style, card D7 — the
  dispatch brief rules out Tribe agents and duties for this plan). `validate-plan.sh` reports its
  Warchief-only `hunter_named_as_implementer` check as failing on this plan; that is by design.
- **Purity:** core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).
- **Paths:** `R` = `plugins/tribe/scripts/runner`, `T` = `plugins/tribe/scripts/tests/runner-driver-only`,
  `E` = `docs/superpowers/evidence/2026-09-27-runner-driver-only`, `F` = `/Users/hiep/repo/runner-e2e-go`,
  `FH` = `/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns`, `S` = `/Users/hiep/.claude-sandboxes/runner-driver-only`.
- **Locate code by symbol and test title, never by line number.** The spec's `file:line`
  references are master `3194976`; #173 has moved lines since.
- **Where #173 changed a function this plan also changes** (`consumeSession`, `sessionConfigFor`,
  `buildOneShotOptions`, `brief-closing.md`'s G7 sentence, `permit.ts`), keep #173's behaviour and
  apply only this plan's delta.
- **Existing tests:** an existing assertion may change only when the task names it (or it is listed
  in `$E/v7-changed-assertions.md` for the change the task makes). Fixture builders may change.
  Everything else stays byte-identical.
- **The runner suite stays green at every commit:** `cd $R && bunx tsc --noEmit` plus the test files
  the task names. The full `bun run check` (≈5 min) runs at each PR's last task.
- **Fail closed at every edge** (`fail-closed-edges.md`): every new subprocess carries a timeout;
  every path built from a card id is proven to stay inside its root; no bare `catch` around
  external input without a comment saying why.
- **Commits:** conventional messages, no Tribe trailers (this is a simple-style plan). When a
  runner drives this plan, its brief adds the `Campaign:` trailer.
- **Owner-only:** none of these tasks changes a product promise; a finding that seems to needs a
  What/Why answer stops the task with `NEEDS_DIRECTION`.

## Oracle (what decides correctness)

The spec is the contract. For the plan parser, spec §4.3 is the oracle — **CommonMark is not**:
under-reading a Done command is a bug; refusing an ambiguous plan is by design. For "Tribe way of
working", `$T/tribe-lexicon.ts` is the oracle: under-matching is a bug; over-matching (a generic word
such as `audit`, `lens`, `governance`) is by design — a driver-only prompt has no reason to say it.

## Adjudication rule — REFUTED in advance

- Role names in code comments, history notes, identifiers (`SpawnTracker`, `TRIBE_SUPERVISOR_SESSION_DOUBLE`)
  or paths under `plugins/tribe/` — naming, not coupling. Do not rename.
- Tribe agents the owner installed remaining visible to a session through the owner's own settings
  tiers — availability, not coupling (V4 depends on it). The runner's OWN explicit plugin load is the
  one exception (D8), removed by Task 1.7.
- The `SHIPPED <pr> <sha>` line, the merge gate, worktree/branch cleanup, master-sync — generic D4.
- `plugins/tribe/agents/*.md`, `mammoth-hunt` and `validate-plan.sh` still describing the Tribe flow
  and the old runner — out of scope (spec §8).
- A `verify-shipped` default that still checks the gap-gate stamp — deliberate (spec §4.11).
- C3 facts that #173's own reconciliation already covered.

---

## PR 1 — Tribe out of the executor path

### Task 1.1: Preflight — the `sessions-in-repo` campaign has shipped and nothing is running; baselines

**Why:** execution must not start before #173's campaign ships (spec §8). #173 lands in parts (PR #175
already removed `home-config.ts`), so file contents alone cannot prove the campaign is over — its card
must be `shipped` and no campaign process may be alive. The hazard (Shaman amendment A1): once PR 2
(state v2, v1 refused) is on master, a live watchdog that relaunches `run.ts` from the master checkout
loads the new code and refuses its own v1 state. Every ratchet also needs its baseline on the exact
tree this plan builds on.

**Files:** create `$E/base-probe.txt`, `$E/v1-base-prompts.txt`, `$E/v7-base-counts.txt`; modify
`$T/render-prompts.ts` only if an API it calls moved under #173 (keep every kind it renders).

- [ ] **Step 1: Prove the campaign is over and #173 is on master** — run the gate and the probes;
  record everything:

```bash
{ python3 -c "import json,os; c=json.load(open(os.path.expanduser('~/.tribe/-Users-hiep-repo-tribe/campaigns/sessions-in-repo/campaign-state.json')))['cards']['supervisor-sessions-in-repo']; print('sessions_in_repo_card=' + c['status'])"
  bash plugins/tribe/scripts/tests/runner-driver-only/no-live-campaign.sh
  grep -q 'export function supervisorLedgerPathOf' plugins/tribe/scripts/runner/core/paths.ts && echo 'paths=supervisorLedgerPathOf'
  grep -q 'ledgerPath' plugins/tribe/scripts/runner/core/session.ts && echo 'session=ledgerPath'
  test ! -e plugins/tribe/scripts/runner/core/supervisor/home-config.ts && echo 'home_config=gone'
  test -e .c3/rules/rule-sessions-start-in-target-repo.md && echo 'rule=sessions-start-in-target-repo'
  git log -1 --format='base=%H %s'; } | tee docs/superpowers/evidence/2026-09-27-runner-driver-only/base-probe.txt
```

Expected: `sessions_in_repo_card=shipped`, `no-live-campaign: no live campaign process, no live v1
campaign lock`, the four probe lines, and `base=…`. Anything else stops the task: `NEEDS_DIRECTION`
("#173's campaign has not shipped, or a campaign process is still live; this plan must not start").

- [ ] **Step 2: V1 on the base** — `bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile`,
  then `bun $T/render-prompts.ts --out $E/base-prompts && bun $T/g2-prompts.ts --render-dir $E/base-prompts > $E/v1-base-prompts.txt`.
  If `render-prompts.ts` fails to import a symbol #173 removed or renamed (e.g. a `permit.ts`
  reason), adapt only that call and keep the kind name. Expected: `TRIBE_WAY_TOTAL=` near 203
  (#173 does not touch the executor brief).

- [ ] **Step 3: V7 counts on the base** — record the tail of each into `$E/v7-base-counts.txt`:
  `cd $R && bun run check`; `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`;
  `bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`;
  `cd plugins/tribe/scripts/viewer && bun test`. Expected: each ends with 0 failures (planning
  baseline on `3194976`: runner 1351 pass / 14 skip / 0 fail; supervisor E2E 40/40; verify-shipped 26/26).
  Re-run the sweep in `$E/v7-changed-assertions.md` against the new base by grepping each named
  test title; append any title that moved or vanished to that file under `## Re-check on the post-#173 base`.

- [ ] **Step 4: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only plugins/tribe/scripts/tests/runner-driver-only && git commit -m "chore(evidence): runner-driver-only baselines on the post-#173 base"`

#### Done

```bash
python3 -c "import json,os; c=json.load(open(os.path.expanduser('~/.tribe/-Users-hiep-repo-tribe/campaigns/sessions-in-repo/campaign-state.json')))['cards']['supervisor-sessions-in-repo']; assert c['status']=='shipped', 'sessions-in-repo card is ' + c['status']"
bash plugins/tribe/scripts/tests/runner-driver-only/no-live-campaign.sh
grep -q 'export function supervisorLedgerPathOf' plugins/tribe/scripts/runner/core/paths.ts
grep -q 'ledgerPath' plugins/tribe/scripts/runner/core/session.ts
test ! -e plugins/tribe/scripts/runner/core/supervisor/home-config.ts
test -e .c3/rules/rule-sessions-start-in-target-repo.md
grep -q '^TRIBE_WAY_TOTAL=' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-base-prompts.txt
grep -q ' 0 fail' docs/superpowers/evidence/2026-09-27-runner-driver-only/v7-base-counts.txt
```

Expected: every command exits 0. (`no-live-campaign.sh` exits 1 naming the live process or lock, and
2 when it cannot probe — never a false pass; its self-tests are in `$E/d10-scanner-selftest.md`.)

### Task 1.2: `verify-shipped.sh --skip-gap-gate` — opt-in, default unchanged

**Why:** the supervisor's closing oracle is `verify-shipped`, whose check 4 demands the gap-gate
stamp a plain plan never produces (spec §2.2 item 3, MEASURED `FAIL` on PR #2). The Tribe callers
(Shaman Mode 3, mammoth-hunt) keep the default.

**Files:** modify `plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh`,
`plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`,
`plugins/verify-shipped/skills/verify-shipped/SKILL.md`.

- [ ] **Step 1: Failing tests** — append before the final summary block of `test-verify-shipped.sh`:

```bash
# --- --skip-gap-gate: opt-in; check 4 reported skipped, verdict from checks 1-3 ---
repo9="$TMP/r9"; make_repo "$repo9"; bin9="$TMP/bin9"
stub_gh "$bin9" "## Why

a plain plan, no stamp
"
out9="$(run_vs "$repo9" "$bin9" --card C1 --skip-gap-gate || true)"
check "--skip-gap-gate reports check 4 as skipped" "$(printf '%s' "$out9" | jget - checks.gap_gate_stamped.status)" "skipped"
check "--skip-gap-gate with no stamp -> verdict decided by checks 1-3" \
  "$(printf '%s' "$out9" | jget - verdict)" \
  "$(printf '%s' "$out9" | python3 -c 'import json,sys; c=json.load(sys.stdin)["checks"]; print("PASS" if all(c[k]["status"]=="pass" for k in ("pr_merged","master_in_sync","worktree_removed")) else "FAIL")')"
out10="$(run_vs "$repo9" "$bin9" --card C1 || true)"
check "without --skip-gap-gate the stamp is still required (default unchanged)" "$(printf '%s' "$out10" | jget - checks.gap_gate_stamped.status)" "fail"
```

Run `bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`. Expected: the two new
`--skip-gap-gate` checks fail (`unknown arg: --skip-gap-gate`, exit 2 → empty JSON).

- [ ] **Step 2: Implement** — in `verify-shipped.sh`: add `SKIP_GAP_GATE=0` beside the other
  defaults; add the case arm `--skip-gap-gate) SKIP_GAP_GATE=1; shift ;;`; add the flag to the
  usage header (`[--skip-gap-gate]`, one line: "report check 4 as skipped; the verdict is decided
  by checks 1-3 — for callers whose plan does not run the gap-gate"); wrap check 4:

```bash
if [[ "$SKIP_GAP_GATE" == "1" ]]; then
  CHECK4_STATUS="skipped"
  CHECK4_DETAIL="skipped by --skip-gap-gate (the caller's plan does not run the harness-gap gate)"
else
  CHECK4_RAW=$(python3 - "$PR_BODY" "$CARD_ARG" <<'PY'
# (the existing python block, unchanged)
PY
)
  CHECK4_STATUS="${CHECK4_RAW%%$'\t'*}"
  CHECK4_DETAIL="${CHECK4_RAW#*$'\t'}"
fi
```

  and the verdict line becomes
  `if [[ "$CHECK1_STATUS" == "pass" && "$CHECK2_STATUS" == "pass" && "$CHECK3_STATUS" == "pass" && ( "$CHECK4_STATUS" == "pass" || "$CHECK4_STATUS" == "skipped" ) ]]; then`.
  In `SKILL.md`, document the flag in the usage block and one sentence under the four checks.

- [ ] **Step 3: Verify** — `bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`.
  Expected: `29 passed, 0 failed` (26 before + 3 new).

- [ ] **Step 4: Commit** — `git commit -am "feat(verify-shipped): opt-in --skip-gap-gate; default still checks the stamp"`

#### Done

```bash
bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
grep -q -- '--skip-gap-gate' plugins/verify-shipped/skills/verify-shipped/SKILL.md
```

Expected: the test prints `0 failed` and exits 0; the grep exits 0.

### Task 1.3: The closing brief re-verifies with `--skip-gap-gate`

**Why:** D6 — the supervisor does no gap-gate work; its closing oracle must not demand a stamp.

**Files:** modify `plugins/tribe/scripts/runner/core/supervisor/brief.ts` (`renderClosing`'s
`shippedVerdicts` line) and `plugins/tribe/scripts/runner/core/supervisor/brief.test.ts`.

- [ ] **Step 1: Failing test** — in `brief.test.ts`, `describe('renderBrief — closing')`:

```ts
test('every shipped card is re-verified with --skip-gap-gate (D6: no gap-gate demand)', () => {
  const rendered = renderBrief('closing', fixtureClosingFacts());
  const verdictLines = rendered.split('\n').filter((l) => l.includes('--verdict-out'));
  expect(verdictLines.length).toBeGreaterThan(0);
  for (const line of verdictLines) expect(line).toContain('--skip-gap-gate');
});
```

Run `cd $R && bun test core/supervisor/brief.test.ts`. Expected: the new test fails.

- [ ] **Step 2: Implement** — in `renderClosing`, the per-card command gains the flag:
  `` `--pr <${v.cardId}'s PR> --worktree <${v.cardId}'s worktree> --card ${v.cardId} --skip-gap-gate ` ``
  (keep everything else of that template literal, including the `mkdir -p` prefix and `--verdict-out`).

- [ ] **Step 3: Verify** — `cd $R && bun test core/supervisor/brief.test.ts`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(supervisor): closing re-verifies shipped cards with verify-shipped --skip-gap-gate"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/supervisor/brief.test.ts
grep -q -- '--skip-gap-gate' plugins/tribe/scripts/runner/core/supervisor/brief.ts
```

Expected: every command exits 0.

### Task 1.4: The runner's done check stops demanding the gap-gate stamp and ledger

**Why:** G3' — `gapGateStamped`/`ledgerCommitted` are the two points a plain plan cannot pass
(MEASURED: PR #2 `FAILED_POINTS=gapGateStamped,ledgerCommitted`). D4: Tribe-only points leave the runner.

**Files:** modify `$R/core/verify.ts`, `$R/core/verify.test.ts`, `$R/core/loop/card-actions.ts`,
`$R/core/loop.test.ts`, `$T/render-prompts.ts`, `$T/g3-verify-replay.ts` (only if it no longer compiles).

**Changed existing assertions (named; spec §7):** `verify.test.ts` — the import of
`parseGapGateStamp`; `all seven points pass` (`toHaveLength(7)` → `toHaveLength(5)` until Task 1.5
adds its point); every test in `describe('gapGateStamped …')`, `describe('ledgerCommitted …')`,
`describe('parseGapGateStamp')` (deleted with the feature); `every point is still reported even
when this one fails` (the id list loses the two ids). `loop.test.ts` — `buildMockLoopIo`'s
gap-gate `gh pr view … body` handler and `prToCard` option (deleted; nothing reads a PR body any more).

- [ ] **Step 1: Failing test** — in `verify.test.ts`, replace the seven-point test with:

```ts
test('a merged PR with no gap-gate stamp and no ledger ships: the done check names only generic points', async () => {
  const io = buildIo({ prBody: '## Why\n\nno stamp at all\n' });
  const result = await verifyShipped(fixtureCard(), fixtureConfig(), io, 'C1');
  expect(result.shipped).toBe(true);
  expect(result.points.map((p) => p.id)).toEqual([
    'merged', 'mergeShaAncestorOfMaster', 'checksGreen', 'worktreeAndBranchGone', 'schemaGuard',
  ]);
});
```

Run `cd $R && bun test core/verify.test.ts`. Expected: FAIL (`gapGateStamped` fails; 7 ids).

- [ ] **Step 2: Implement** — in `verify.ts` delete `GAP_LEDGER_PATH`, `GAP_GATE_STAMP_RE`,
  `GapGateStamp`, `parseGapGateStamp`, `checkGapGateStamped`, `checkLedgerCommitted`,
  `VerifyConfig.gapLedgerPath`, and the two ids from `VerifyPointId`; `verifyShipped` becomes:

```ts
export async function verifyShipped(card: Card, config: VerifyConfig, io: VerifyIO, cardId: string): Promise<VerifyResult> {
  void cardId; // kept in the signature: Task 2.11's doneAtHead point and the replay tool pass it
  const merged = await checkMerged(card, config, io);
  const ancestor = await checkAncestor(merged.mergeSha, config, io);
  const checks = await checkChecksGreen(card, config, io);
  const worktree = await checkWorktreeAndBranchGone(card, config, io);
  const schema = await checkSchemaGuard(card, config, io, merged.mergeSha);
  const points: VerifyPointResult[] = [merged.point, ancestor, checks, worktree, schema];
  const failedPoints = points.filter((p) => !p.passed).map((p) => p.id);
  return { shipped: failedPoints.length === 0, points, failedPoints };
}
```

  Update the module header comment ("D3 five-point replay"). In `card-actions.ts` delete the
  `gapGateStamped` and `ledgerCommitted` entries of `VERIFY_FAILURE_BULLETS` (the `Record` type
  forces it). In `loop.test.ts` delete the gap-gate body handler and `prToCard` from
  `buildMockLoopIo`. In `$T/render-prompts.ts` drop the two ids from `allPoints`.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/verify.test.ts core/loop.test.ts core/loop/card-actions.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): the done check no longer demands a gap-gate stamp or ledger commit"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/verify.test.ts core/loop.test.ts core/loop/card-actions.test.ts
! grep -n -E 'gapGateStamped|ledgerCommitted|gap-gate v1' plugins/tribe/scripts/runner/core/verify.ts plugins/tribe/scripts/runner/core/loop/card-actions.ts
```

Expected: every command exits 0 (the last one because grep finds nothing).

### Task 1.5: D4's final gate — `localBaseSynced`

**Why:** D4 — "DONE = the feature is merged and local master has the latest". Today the runner never
checks the local base (spec §4.7); the executor brief only asks for it.

**Files:** modify `$R/core/verify.ts`, `$R/core/verify.test.ts`, `$R/core/loop/card-actions.ts`,
`$R/core/loop.test.ts` (default mock handlers only).

- [ ] **Step 1: Failing tests** — in `verify.test.ts`, extend `MockOptions` with
  `localBaseContainsMerge?: boolean` (default `true`) and `localBaseAheadOfRemote?: boolean`
  (default `false`); in `buildIo` add, before the generic `git merge-base` branch:

```ts
if (bin === 'git' && rest[0] === 'fetch') return ok('');
if (bin === 'git' && rest[0] === 'merge-base' && rest[1] === '--is-ancestor' && rest[3] === 'master') {
  // localBaseSynced: <mergeSha> must be in the LOCAL base branch …
  return { stdout: '', stderr: '', exitCode: (opts.localBaseContainsMerge ?? true) ? 0 : 1 };
}
if (bin === 'git' && rest[0] === 'merge-base' && rest[1] === '--is-ancestor' && rest[2] === 'master') {
  // … and the local base must have no commits the remote lacks.
  return { stdout: '', stderr: '', exitCode: (opts.localBaseAheadOfRemote ?? false) ? 1 : 0 };
}
```

  and the tests:

```ts
describe('localBaseSynced (D4: local base has the latest)', () => {
  test('merge in the local base, local not ahead of the remote -> passes', async () => {
    const r = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo(), 'C1');
    expect(r.points.find((p) => p.id === 'localBaseSynced')?.passed).toBe(true);
  });
  test('local base does not contain the merge -> fails and names the fast-forward', async () => {
    const r = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ localBaseContainsMerge: false }), 'C1');
    const p = r.points.find((x) => x.id === 'localBaseSynced');
    expect(p?.passed).toBe(false);
    expect(p?.detail).toContain('does not contain');
    expect(r.shipped).toBe(false);
  });
  test('local base has commits the remote lacks -> fails (diverged, never healed)', async () => {
    const r = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ localBaseAheadOfRemote: true }), 'C1');
    expect(r.points.find((x) => x.id === 'localBaseSynced')?.passed).toBe(false);
  });
  test('no merge sha -> fails closed', async () => {
    const r = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ mergeSha: null }), 'C1');
    expect(r.points.find((x) => x.id === 'localBaseSynced')?.passed).toBe(false);
  });
});
```

  and the Task 1.4 id-list test gains `'localBaseSynced'` after `'schemaGuard'`. Run
  `cd $R && bun test core/verify.test.ts`. Expected: FAIL (no such point).

- [ ] **Step 2: Implement** — in `verify.ts` add `'localBaseSynced'` to `VerifyPointId` and:

```ts
/** D4 (card runner-driver-only): "the feature is merged and local master has the latest". Race-free
 * form of "local == remote": the merge commit is IN the local base branch, and the local base has no
 * commit the remote lacks. Strict equality would fail whenever a concurrent card merged after this
 * card's own sync (`--max-concurrent > 1`) — spec §4.7. */
async function checkLocalBaseSynced(mergeSha: string | null, config: VerifyConfig, io: VerifyIO): Promise<VerifyPointResult> {
  const id = 'localBaseSynced' as const;
  if (!mergeSha) return { id, passed: false, detail: 'no merge sha available (point 1 did not report one); cannot check the local base' };
  const remoteBase = `${config.remote}/${config.baseBranch}`;
  const fetched = await run(io, config.repoRoot, ['git', 'fetch', config.remote, config.baseBranch]);
  if (fetched.exitCode !== 0) return { id, passed: false, detail: `git fetch ${config.remote} ${config.baseBranch} failed (exit ${fetched.exitCode}); cannot compare the local base` };
  const contains = await run(io, config.repoRoot, ['git', 'merge-base', '--is-ancestor', mergeSha, config.baseBranch]);
  if (contains.exitCode !== 0) {
    return { id, passed: false, detail: `local ${config.baseBranch} does not contain merge ${mergeSha}; fast-forward it to ${remoteBase}` };
  }
  const notAhead = await run(io, config.repoRoot, ['git', 'merge-base', '--is-ancestor', config.baseBranch, remoteBase]);
  if (notAhead.exitCode !== 0) {
    return { id, passed: false, detail: `local ${config.baseBranch} has commits ${remoteBase} lacks (diverged); it is never healed automatically` };
  }
  return { id, passed: true, detail: `local ${config.baseBranch} contains ${mergeSha} and is not ahead of ${remoteBase}` };
}
```

  call it in `verifyShipped` after `schema` and append its point. In `card-actions.ts` add to
  `VERIFY_FAILURE_BULLETS`:
  `localBaseSynced: '- localBaseSynced: the local base branch in the runner\'s checkout does not have this merge yet (or has diverged). Fast-forward it (git merge --ff-only <remote>/<base>) with a clean checkout, then re-run.'`.
  In `loop.test.ts`'s `buildMockLoopIo` add default handlers `git fetch` → `ok('')` and
  `git merge-base` → `ok('')` **after** `execHandlers` (so a test's own scripted handler still wins).

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/verify.test.ts core/loop.test.ts core/loop/card-actions.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): D4 final gate checks the local base has the merge"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/verify.test.ts core/loop.test.ts core/loop/card-actions.test.ts
grep -q "'localBaseSynced'" plugins/tribe/scripts/runner/core/verify.ts
```

Expected: every command exits 0.

### Task 1.6: Safe heal — fast-forward the runner's own base checkout

**Why:** a session that merged but forgot the fast-forward should not cost an escalation round
trip when a script can do it safely (spec §4.7; the same shape as P4's residue heal).

**Files:** modify `$R/core/residue.ts`, `$R/core/residue.test.ts`, `$R/core/loop/card-actions.ts`
(`healSafeResidue`), `$R/core/loop/card-actions.test.ts`.

- [ ] **Step 1: Failing tests** — in `residue.test.ts`:

```ts
import { decideBaseSyncHeal } from './residue.ts';

describe('decideBaseSyncHeal (D4 safe heal)', () => {
  const ok = { mergedPassed: true, localBaseFailed: true, checkoutOnBase: true, checkoutClean: true, localIsAncestorOfRemote: true };
  test('merged, checkout on base, clean, strictly behind -> fast-forward', () => {
    expect(decideBaseSyncHeal(ok)).toEqual([{ kind: 'fast_forward_base' }]);
  });
  test.each([
    ['PR not merged', { mergedPassed: false }],
    ['point already passes', { localBaseFailed: false }],
    ['checkout parked on another ref', { checkoutOnBase: false }],
    ['checkout dirty', { checkoutClean: false }],
    ['local base diverged', { localIsAncestorOfRemote: false }],
  ])('%s -> no heal', (_name, patch) => {
    expect(decideBaseSyncHeal({ ...ok, ...patch })).toEqual([]);
  });
});
```

  Run `cd $R && bun test core/residue.test.ts`. Expected: FAIL (no export).

- [ ] **Step 2: Implement** — in `residue.ts`:

```ts
export type BaseSyncHealAction = { kind: 'fast_forward_base' };

export interface DecideBaseSyncHealInput {
  mergedPassed: boolean;
  /** The `localBaseSynced` point failed on the first verify. */
  localBaseFailed: boolean;
  /** `git rev-parse --abbrev-ref HEAD` in `--repo` names the base branch. */
  checkoutOnBase: boolean;
  /** `git status --porcelain` in `--repo` is empty (exit 0) — nothing of the owner's is at risk. */
  checkoutClean: boolean;
  /** The local base is an ancestor of `<remote>/<base>`: a fast-forward is possible and loses nothing. */
  localIsAncestorOfRemote: boolean;
}

/** D4 safe heal: fast-forward the runner's own base checkout only when that can lose nothing. */
export function decideBaseSyncHeal(input: DecideBaseSyncHealInput): BaseSyncHealAction[] {
  const safe = input.mergedPassed && input.localBaseFailed && input.checkoutOnBase
    && input.checkoutClean && input.localIsAncestorOfRemote;
  return safe ? [{ kind: 'fast_forward_base' }] : [];
}
```

  In `card-actions.ts#healSafeResidue`, after the residue heal and before the retry: when the
  `merged` point passed and `localBaseSynced` failed, gather the three facts through `io.exec`
  (`git rev-parse --abbrev-ref HEAD`, `git status --porcelain`, `git merge-base --is-ancestor <base> <remote>/<base>`,
  each with `cwd: resolved.repoRoot`, each requiring `exitCode === 0` for a `true` fact), call
  `decideBaseSyncHeal`, and for `fast_forward_base` run `git merge --ff-only <remote>/<base>`
  (serialized with `serializeRepoGitMutation`); a successful heal appends `(healed: fast_forward_base)`
  to the `localBaseSynced` detail the same way `appendHealedDetail` does for the worktree point.
  Add a `card-actions.test.ts` case: first verify fails only `localBaseSynced`, the facts are all
  true → the mock records `git merge --ff-only origin/master` and the retry ships.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/residue.test.ts core/loop/card-actions.test.ts core/loop.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): safe fast-forward heal for the D4 local-base point"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/residue.test.ts core/loop/card-actions.test.ts core/loop.test.ts
```

Expected: every command exits 0.

### Task 1.7: The executor session stops loading the tribe plugin

**Why:** D8 (card, round 3) — "the runner adds nothing to a session beyond the user's own tiers. The
explicit Tribe plugin load goes." It is V1's one non-prose injection (MEASURED), and in the D9 sandbox
it would bring the removed agents back. Agents the owner installed stay available through the owner's
own tiers (V4 relies on that in the real home).

**Files:** modify `$R/core/session.ts`, `$R/ports/ports.ts` (`PinnedSessionOptions.plugins` removed),
`$R/core/session.test.ts`, `$R/core/session.e2e.test.ts`, `$R/core/supervisor/session.e2e.test.ts`,
`$R/core/supervisor/campaign-home-carryover.e2e.test.ts`, `$T/render-prompts.ts`.

**Changed existing assertions (named):** `session.test.ts` — `passes exactly the pinned §D1 options
to io.spawnSession` (`expect(options.plugins).toEqual([...TRIBE_PLUGIN_DIR])` becomes
`expect('plugins' in options).toBe(false)`); `TRIBE_PLUGIN_DIR is derived from the module location…`
and `TRIBE_PLUGIN_DIR resolves on disk to the real plugins/tribe directory…` (deleted with the export).
The three e2e files import `TRIBE_PLUGIN_DIR` only to locate the repo / `verify-shipped` dir: each
computes it locally instead — `const PLUGINS_DIR = join(import.meta.dir, '..', '..', '..', '..')`
(adjust the `..` count to the file's depth so it ends in `plugins`), keeping every assertion.

- [ ] **Step 1: Failing test** — in `session.test.ts`:

```ts
test('D3: the executor session loads no plugin of its own — only the owner\'s settings tiers', () => {
  const options = buildSessionOptions({ brief: 'b' }, fixtureConfig(), new AbortController(), {});
  expect('plugins' in options).toBe(false);
  expect(options.settingSources).toEqual(['user', 'project', 'local']);
});
```

  (use the file's existing config fixture helper). Run `cd $R && bun test core/session.test.ts`.
  Expected: FAIL.

- [ ] **Step 2: Implement** — delete `TRIBE_PLUGIN_DIR` and its doc comment, the `plugins:` line in
  `buildSessionOptions`, and `plugins` from `PinnedSessionOptions`. Update the three e2e imports as
  named above. In `$T/render-prompts.ts` replace the plugin probe with a check that `options` has no
  `plugins` key (an injection is recorded only if one reappears).

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/session.test.ts`, then
  `bun $T/render-prompts.ts --out /tmp/rdo-1-7 && bun $T/g2-prompts.ts --render-dir /tmp/rdo-1-7 | grep '; injections: 0'`.
  Expected: 0 fail; the grep matches.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): executor sessions load only the owner's settings tiers, no tribe plugin"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/session.test.ts
! grep -rn 'TRIBE_PLUGIN_DIR' plugins/tribe/scripts/runner/core plugins/tribe/scripts/runner/ports
bun plugins/tribe/scripts/tests/runner-driver-only/render-prompts.ts --out /tmp/rdo-done-1-7
bun plugins/tribe/scripts/tests/runner-driver-only/g2-prompts.ts --render-dir /tmp/rdo-done-1-7 | grep -q '; injections: 0'
```

Expected: every command exits 0.

### Task 1.8: The executor brief carries no Tribe way of working

**Why:** V1 — the brief is 45 of the 202 mentions (MEASURED). Spec §4.8 lists every section: the
Tribe ones move to the Tribe-style plan text (Task 3.8), the driver ones stay. This task keeps the
`SHIPPED` protocol (the turn protocol comes in Task 2.12).

**Files:** modify `$R/core/brief-template.md`, `$R/core/brief.ts` (`REPORT_PATH` → `CAMPAIGN_HOME`),
`$R/core/brief.test.ts`, every `executorBrief` caller (`core/loop/card-actions.ts`), `$T/render-prompts.ts`.

**Changed existing assertions (named):** `brief.test.ts` — `renders the committed template … (snapshot)`
(the `EXPECTED_BRIEF` snapshot is replaced by the new text below); `renders a distinct brief per card
id and per campaign` and `executorBrief substitutes the injected report path into {{REPORT_PATH}}`
(now assert the campaign home path appears, since the placeholder is `{{CAMPAIGN_HOME}}`).

- [ ] **Step 1: Failing test** — in `brief.test.ts`:

```ts
import { countTribeMentions } from '../../tests/runner-driver-only/tribe-lexicon.ts';

test('V1: the rendered executor brief carries no Tribe way of working', () => {
  const rendered = executorBrief(FIXTURE_CARD, FIXTURE_STATE, '', readFileSync(BRIEF_TEMPLATE_PATH, 'utf8'), '/home/c', 'camp');
  expect(countTribeMentions(rendered)).toEqual([]);
  for (const kept of ['## Session liveness', 'run_in_background', 'timeout: 600000', 'gh pr checks',
    'Campaign: camp', 'SHIPPED <pr> <sha>', 'NEEDS_DIRECTION: <question>', '## Answers']) {
    expect(rendered).toContain(kept);
  }
});
```

  (use the file's existing card/state fixtures). Run `cd $R && bun test core/brief.test.ts`.
  Expected: FAIL (45 mentions).

- [ ] **Step 2: Implement** — rewrite `brief-template.md`:
  - `## Executor mode` → `## Your job`:
    "You run exactly one campaign card, headless, in a fresh session with no memory of any other card.
    The plan below is your instructions: follow the way of working it prescribes, task by task, and
    add no process it does not ask for. Read the spec silently for context — you do not re-open
    design decisions recorded there. You never contact the campaign owner directly, never invent a
    design decision the plan doesn't already make, and never widen scope beyond this card."
  - `## Card`, `## Goal`, `## Walls`, `## Session liveness`, `## Merge order`, `## Commit trailer`,
    `## Answers`, `## Definition of Done`, `## Terminal contract`: keep verbatim.
  - Delete `## Evidence policy` and `## Harness gaps and governance (per-card duties)` (their text is
    re-homed verbatim by Task 3.8).
  - `## Worker reports` → `## Notes for your plan`: "If your plan asks you to write report or note
    files, the campaign's machine-local home is {{CAMPAIGN_HOME}}; its `reports/` directory is yours to
    use. The runner itself reads nothing you write there."
  In `brief.ts`: `executorBrief(card, state, answersContent, template, campaignHome, campaignSlug)` —
  the fifth parameter is now the campaign home; `REPORT_PATH` → `CAMPAIGN_HOME` in the vars;
  `reportPathFor` stays exported (the report file path is still named by `brief.ts`'s callers that
  need it) or is deleted if nothing else calls it (`grep -rn reportPathFor plugins/tribe/scripts`).
  Callers pass `resolved.homeDir`. Update `$T/render-prompts.ts`'s two `executorBrief` calls.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/brief.test.ts core/loop.test.ts core/loop/card-actions.test.ts`;
  `bun $T/render-prompts.ts --out /tmp/rdo-1-8 && bun $T/g2-prompts.ts --render-dir /tmp/rdo-1-8 | grep '^| executor/brief-fresh'`.
  Expected: 0 fail; the brief row shows `| 0 |` mentions.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): the executor brief drives the plan and prescribes no way of working"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/brief.test.ts core/loop.test.ts core/loop/card-actions.test.ts
bun plugins/tribe/scripts/tests/runner-driver-only/render-prompts.ts --out /tmp/rdo-done-1-8
bun plugins/tribe/scripts/tests/runner-driver-only/g2-prompts.ts --render-dir /tmp/rdo-done-1-8 | grep -q '^| executor/brief-fresh | [0-9]* | 0 |'
```

Expected: every command exits 0.

### Task 1.9: PR 1 measurements — V1 ratchet and G3' on the plain PR

**Why:** the ratchet may only move down; G3' is PR 1's claim.

**Files:** create `$E/v1-pr1-prompts.txt`, `$E/g3-pr1-plain-pr2-replay.txt`.

- [ ] **Step 1: V1** — `bun $T/render-prompts.ts --out $E/pr1-prompts && bun $T/g2-prompts.ts --render-dir $E/pr1-prompts > $E/v1-pr1-prompts.txt`.
  Expected: `TRIBE_WAY_TOTAL` strictly below `$E/v1-base-prompts.txt`'s value; `executor/*` and
  `escalation/*` rows 0; the remaining mentions are all `supervisor/*` and `report/*` (PR 3's work).

- [ ] **Step 2: G3'** — `bun $T/g3-verify-replay.ts --repo $F --home $FH/g3-plain-baseline --card small-helpers | tee $E/g3-pr1-plain-pr2-replay.txt`.
  The home's v1 state still loads here (PR 2 has not bumped the schema). Expected: no
  `gapGateStamped`/`ledgerCommitted` line; `SHIPPED=true` when the fixture's local master contains
  `b32859a` (the plain PR's merge; true while the fixture master descends from it — it does after
  the planning resets), else the only failure is `localBaseSynced` naming the fast-forward.

- [ ] **Step 3: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): PR 1 V1 ratchet and G3' replay"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
test "$(sed -n 's/^TRIBE_WAY_TOTAL=//p' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-pr1-prompts.txt)" -lt "$(sed -n 's/^TRIBE_WAY_TOTAL=//p' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-base-prompts.txt)"
! grep -E '^\| (executor|escalation)/[^|]* \| [0-9]+ \| [1-9]' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-pr1-prompts.txt
! grep -E 'gapGateStamped|ledgerCommitted' docs/superpowers/evidence/2026-09-27-runner-driver-only/g3-pr1-plain-pr2-replay.txt
```

Expected: every command exits 0.

### Task 1.10: PR 1 governance — README, C3, full suite

**Why:** governance per phase (`brief-contracts.md`): the next PR's reviewer must not find stale facts.

**Files:** modify `$R/README.md` (sections "Harness-gap gate and the `gap-gate v1` stamp", "Resume
semantics" mention of D3 points, "Known limitations" verify wording, the session-options paragraph),
`plugins/verify-shipped/skills/verify-shipped/SKILL.md` (if Task 1.2 left anything), `.c3/` through a
change unit on `c3-215` (contract row `scripts/runner/run.ts`; Change-Safety row "Runner accepts an
unshipped card…" which names "the D3 seven-point replay, incl. gapGateStamped and ledgerCommitted")
and `c3-217` (the verify-shipped contract gains `--skip-gap-gate`).

- [ ] **Step 1: README** — replace "Harness-gap gate and the `gap-gate v1` stamp" with a short
  section "The done check (D3 replay)" listing the six points (`merged`, `mergeShaAncestorOfMaster`,
  `checksGreen`, `worktreeAndBranchGone`, `schemaGuard`, `localBaseSynced`), the fast-forward heal,
  and one sentence: "The runner never checks a gap-gate stamp; a plan that wants the harness-gap gate
  runs it as a task's Done command (the orchestrate-campaign skill's Tribe style)." State that the
  executor loads only the owner's three settings tiers (no plugin of its own).

- [ ] **Step 2: C3** — `C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1)`;
  read `$C3/references/change.md`; open a change unit (`C3X_MODE=agent bash "$C3/bin/c3x.sh" change new …`)
  with an ADR "runner-driver-only PR 1: the done check is generic" and patches for the two `c3-215`
  rows and the `c3-217` contract row; apply them in this commit (`rule-change-unit-ships-with-code`).
  Never hand-edit a `c3-seal`.

- [ ] **Step 3: Full suite** — `cd $R && bun run check`; `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`;
  `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh`. Expected: 0 fail each.

- [ ] **Step 4: Commit** — `git commit -am "docs(runner): PR 1 governance — generic done check, no plugin injection"` and open PR 1.

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bun run check
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
! grep -n 'gap-gate v1' plugins/tribe/scripts/runner/README.md
C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1) && C3X_MODE=agent bash "$C3/bin/c3x.sh" check | grep -q 'ok: true'
```

Expected: every command exits 0.

---
## PR 2 — the plan drives: task index, runner-run Done commands, turns

### Task 2.1: `core/plan-index.ts` — read a plan's tasks and Done commands (pure)

**Why:** D1 + D2 — the runner must find each indexed task in the markdown plan and read its Done
commands itself. Spec §4.3 is this parser's oracle (not CommonMark).

**Files:** create `$R/core/plan-index.ts`, `$R/core/plan-index.test.ts`.

- [ ] **Step 1: Failing tests** — `$R/core/plan-index.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { doneCommandsThrough, resolveTaskIndex, type TaskRef } from './plan-index.ts';

const PLAN = [
  '# Plan',
  '',
  '### Task 1: `mathx.Sum`',
  '',
  '```go',
  '### Task 9: not a heading, inside a fence',
  '```',
  '',
  '#### Done',
  '',
  '```bash',
  '# comments and blank lines are skipped',
  'go build ./...',
  '',
  'go test ./...',
  '```',
  '',
  '### Task 2: `mathx.Max`',
  '',
  '#### Done',
  '',
  '````bash',
  'go build ./...',
  "go test -run '^TestMax$' -v ./mathx | grep -q -- '--- PASS: TestMax'",
  '````',
  '',
].join('\n');

const refs = (...headings: string[]): TaskRef[] => headings.map((heading, i) => ({ id: `T${i + 1}`, heading }));

describe('resolveTaskIndex — spec §4.3', () => {
  test('resolves each task and reads its Done commands; comments, blanks and fenced headings ignored', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: `mathx.Sum`', 'Task 2: `mathx.Max`'), PLAN);
    expect(r.issues).toEqual([]);
    expect(r.tasks).toEqual([
      { id: 'T1', heading: 'Task 1: `mathx.Sum`', doneCommands: ['go build ./...', 'go test ./...'] },
      { id: 'T2', heading: 'Task 2: `mathx.Max`', doneCommands: ['go build ./...', "go test -run '^TestMax$' -v ./mathx | grep -q -- '--- PASS: TestMax'"] },
    ]);
  });
  test('a heading that exists only inside a fence is dangling', () => {
    const r = resolveTaskIndex('C1', refs('Task 9: not a heading, inside a fence'), PLAN);
    expect(r.issues.map((i) => i.problem)).toEqual(['dangling_heading']);
  });
  test('a heading that does not exist is dangling, and every issue is collected (never first-fail)', () => {
    const r = resolveTaskIndex('C1', refs('Task 7: nowhere', 'Task 1: `mathx.Sum`', 'Task 8: nowhere'), PLAN);
    expect(r.issues.map((i) => `${i.taskId}:${i.problem}`)).toEqual(['T1:dangling_heading', 'T3:dangling_heading']);
  });
  test('a duplicated heading is refused', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x\n#### Done\n```\ntrue\n```\n### Task 1: x\n');
    expect(r.issues.map((i) => i.problem)).toEqual(['duplicate_heading']);
  });
  test('missing Done, two Done sections, no block, empty block, continuation — each refused by name', () => {
    const cases: Array<[string, string]> = [
      ['### Task 1: x\nno done here\n', 'missing_done'],
      ['### Task 1: x\n#### Done\n```\ntrue\n```\n#### done\n```\ntrue\n```\n', 'ambiguous_done'],
      ['### Task 1: x\n#### Done\nrun the tests\n### Task 2: y\n', 'missing_done_block'],
      ['### Task 1: x\n#### Done\n```bash\n# only a comment\n\n```\n', 'empty_done'],
      ['### Task 1: x\n#### Done\n```bash\ngo test \\\n  ./...\n```\n', 'continuation_not_supported'],
    ];
    for (const [plan, problem] of cases) {
      expect(resolveTaskIndex('C1', refs('Task 1: x'), plan).issues.map((i) => i.problem)).toEqual([problem]);
    }
  });
  test("a Done heading of the SAME level ends the task: it is not the task's Done section", () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x\n### Done\n```\ntrue\n```\n');
    expect(r.issues.map((i) => i.problem)).toEqual(['missing_done']);
  });
  test('the next task heading bounds a Done block: a block after it is not borrowed', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x\n#### Done\n### Task 2: y\n```\ntrue\n```\n');
    expect(r.issues.map((i) => i.problem)).toEqual(['missing_done_block']);
  });
  test('closing hashes and trailing spaces are not part of the heading text', () => {
    const r = resolveTaskIndex('C1', refs('Task 1: x'), '### Task 1: x ###  \n#### Done\n```\ntrue\n```\n');
    expect(r.issues).toEqual([]);
  });
});

describe('doneCommandsThrough — cumulative, deduplicated by exact text, plan order', () => {
  test('tasks 1..k, first occurrence wins, each command lists every task that asks for it', () => {
    const { tasks } = resolveTaskIndex('C1', refs('Task 1: `mathx.Sum`', 'Task 2: `mathx.Max`'), PLAN);
    expect(doneCommandsThrough(tasks, 1)).toEqual([
      { command: 'go build ./...', tasks: ['T1', 'T2'] },
      { command: 'go test ./...', tasks: ['T1'] },
      { command: "go test -run '^TestMax$' -v ./mathx | grep -q -- '--- PASS: TestMax'", tasks: ['T2'] },
    ]);
    expect(doneCommandsThrough(tasks, 0).map((c) => c.command)).toEqual(['go build ./...', 'go test ./...']);
  });
});
```

  Run `cd $R && bun test core/plan-index.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 2: Implement** — `$R/core/plan-index.ts`:

```ts
// core/plan-index.ts — reads a card's markdown plan into its task index (card runner-driver-only,
// spec §4.3, D1/D2). PURE: the plan text arrives as an argument; nothing here touches a file.
//
// Oracle: spec §4.3 is the contract — CommonMark is NOT. Under-reading a Done command (missing one,
// or attributing it to the wrong task) is a bug; refusing an ambiguous plan is by design.

/** One task of `campaign-state.json`'s `cards.<id>.tasks` (D1): a pointer into the plan, never a copy. */
export interface TaskRef {
  id: string;
  /** The exact text of one heading line in the plan, `#`s and surrounding whitespace stripped. */
  heading: string;
  /** Runner-written: the commit at which this task's Done commands last passed. */
  passedSha?: string;
}

export interface ResolvedTask {
  id: string;
  heading: string;
  doneCommands: string[];
}

export type TaskIndexProblem =
  | 'dangling_heading'
  | 'duplicate_heading'
  | 'missing_done'
  | 'ambiguous_done'
  | 'missing_done_block'
  | 'empty_done'
  | 'continuation_not_supported';

export interface TaskIndexIssue {
  cardId: string;
  taskId: string;
  heading: string;
  problem: TaskIndexProblem;
}

export interface PlannedCommand {
  command: string;
  /** Every task id (in plan order) whose Done section lists this exact command. */
  tasks: string[];
}

interface Heading {
  level: number;
  text: string;
  /** 0-based line index. */
  line: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

interface Scan {
  lines: string[];
  headings: Heading[];
  /** For each line: is it a fence line or inside a fenced block? */
  inFence: boolean[];
  /** Line indexes that OPEN a fenced block. */
  fenceOpens: Set<number>;
}

/** Fences are tracked CommonMark-style: a fence opened by N backticks (or tildes) closes only on a
 * line of at least N of the SAME character — the rule validate-plan.sh already implements. A heading
 * inside a fence is content, never structure. */
function scan(markdown: string): Scan {
  const lines = markdown.split('\n');
  const headings: Heading[] = [];
  const inFence: boolean[] = [];
  const fenceOpens = new Set<number>();
  let open: { char: string; length: number } | null = null;
  lines.forEach((line, i) => {
    if (open !== null) {
      inFence.push(true);
      const close = new RegExp(`^ {0,3}${open.char === '`' ? '`' : '~'}{${open.length},}\\s*$`);
      if (close.test(line)) open = null;
      return;
    }
    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      open = { char: marker[0] as string, length: marker.length };
      inFence.push(true);
      fenceOpens.add(i);
      return;
    }
    inFence.push(false);
    const heading = HEADING_RE.exec(line);
    if (heading) headings.push({ level: (heading[1] as string).length, text: (heading[2] as string).trim(), line: i });
  });
  return { lines, headings, inFence, fenceOpens };
}

type TaskResolution = { ok: true; task: ResolvedTask } | { ok: false; problem: TaskIndexProblem };

function resolveOne(s: Scan, ref: TaskRef): TaskResolution {
  const matches = s.headings.filter((h) => h.text === ref.heading);
  if (matches.length === 0) return { ok: false, problem: 'dangling_heading' };
  if (matches.length > 1) return { ok: false, problem: 'duplicate_heading' };
  const task = matches[0] as Heading;
  // The task section ends at the next heading of the same or a higher level (fewer or equal #s).
  const sectionEnd = s.headings.find((h) => h.line > task.line && h.level <= task.level)?.line ?? s.lines.length;
  const inSection = s.headings.filter((h) => h.line > task.line && h.line < sectionEnd);
  const doneHeadings = inSection.filter((h) => h.level > task.level && h.text.toLowerCase() === 'done');
  if (doneHeadings.length === 0) return { ok: false, problem: 'missing_done' };
  if (doneHeadings.length > 1) return { ok: false, problem: 'ambiguous_done' };
  const done = doneHeadings[0] as Heading;
  // The Done block must sit between the Done heading and the next heading of ANY level.
  const blockLimit = inSection.find((h) => h.line > done.line)?.line ?? sectionEnd;
  let openLine = -1;
  for (let i = done.line + 1; i < blockLimit; i++) {
    if (s.fenceOpens.has(i)) {
      openLine = i;
      break;
    }
  }
  if (openLine < 0) return { ok: false, problem: 'missing_done_block' };
  const body: string[] = [];
  for (let i = openLine + 1; i < s.lines.length && s.inFence[i] === true && !s.fenceOpens.has(i); i++) {
    body.push(s.lines[i] as string);
  }
  // The loop above also collects the closing fence line (it is `inFence`); drop it.
  if (body.length > 0 && FENCE_OPEN_RE.test(body[body.length - 1] as string)) body.pop();
  const commands: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.endsWith('\\')) return { ok: false, problem: 'continuation_not_supported' };
    commands.push(line);
  }
  if (commands.length === 0) return { ok: false, problem: 'empty_done' };
  return { ok: true, task: { id: ref.id, heading: ref.heading, doneCommands: commands } };
}

/** Resolves every task of one card against its plan text. Collects EVERY issue (never first-fail),
 * so one refusal names everything the author must fix. */
export function resolveTaskIndex(
  cardId: string,
  refs: readonly TaskRef[],
  planMarkdown: string,
): { tasks: ResolvedTask[]; issues: TaskIndexIssue[] } {
  const s = scan(planMarkdown);
  const tasks: ResolvedTask[] = [];
  const issues: TaskIndexIssue[] = [];
  for (const ref of refs) {
    const r = resolveOne(s, ref);
    if (r.ok) tasks.push(r.task);
    else issues.push({ cardId, taskId: ref.id, heading: ref.heading, problem: r.problem });
  }
  return { tasks, issues };
}

/** The Done commands of tasks 0..`throughIndex` (inclusive), in plan order, deduplicated by exact
 * text — `go build ./...` asked for by four tasks runs once per Done run, recorded against all four. */
export function doneCommandsThrough(tasks: readonly ResolvedTask[], throughIndex: number): PlannedCommand[] {
  const planned: PlannedCommand[] = [];
  const byCommand = new Map<string, PlannedCommand>();
  for (const task of tasks.slice(0, throughIndex + 1)) {
    for (const command of task.doneCommands) {
      const existing = byCommand.get(command);
      if (existing) {
        if (!existing.tasks.includes(task.id)) existing.tasks.push(task.id);
        continue;
      }
      const entry = { command, tasks: [task.id] };
      byCommand.set(command, entry);
      planned.push(entry);
    }
  }
  return planned;
}
```

  Note on the body loop: a block ends at its own closing fence, which `scan` marks `inFence` and
  whose line matches `FENCE_OPEN_RE`'s pattern; the `pop` removes it. The test with a four-backtick
  fence proves a shorter inner fence does not close it.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/plan-index.test.ts`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git add plugins/tribe/scripts/runner/core/plan-index.ts plugins/tribe/scripts/runner/core/plan-index.test.ts && git commit -m "feat(runner): pure plan reader — task index and Done commands (spec §4.3)"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/plan-index.test.ts
cd plugins/tribe/scripts/runner && bun -e "import {readFileSync} from 'node:fs'; import {resolveTaskIndex} from './core/plan-index.ts'; const r=resolveTaskIndex('x',[{id:'A',heading:'Task 2.1: \`core/plan-index.ts\` — read a plan\'s tasks and Done commands (pure)'}], readFileSync('../../../../docs/superpowers/plans/2026-09-27-runner-driver-only.md','utf8')); if (r.issues.length||r.tasks[0].doneCommands.length<3) process.exit(1)"
```

Expected: every command exits 0 (the last one proves the parser reads this very plan's Task 2.1).

### Task 2.2: `campaign-state.json` v2 — the task index lives in the state (D1)

**Why:** D1 — "the work index lives inside `campaign-state.json`", pointers into the plan. `tasks`
is required, so v1 can never be valid v2: `v` becomes `2` and v1 is refused with a re-author
instruction (spec §4.2, the version decision).

**Files:** modify `$R/core/types.ts` (`Card.tasks`, `Card.doneSha`), `$R/core/state.ts`,
`$R/core/state.test.ts`, and every fixture that authors a campaign state:
`$R/core/loop.test.ts` (`fixtureCard`, `fixtureState`), `$R/core/report.test.ts`, `$R/cli/main.test.ts`
(`stateFixture`), `$R/core/loop/card-actions.test.ts`, `$R/watchdog-integration.test.ts`,
`plugins/tribe/scripts/tests/test-supervisor-e2e.sh`, `test-supervisor-kill.sh`, `test-watchdog-e2e.sh`,
`test-watchdog-stall-relaunch.sh`, `test-supervisor-park-truth.sh`, `test-supervisor-repro.sh`,
`test-supervisor-real-e2e.sh`, `plugins/tribe/scripts/viewer/e2e/campaign-badge.e2e.test.ts`.

**Changed existing assertions (named):** `state.test.ts` — `rejects an unknown major version with a
typed error` (`v: 2` is now valid; the case becomes `v: 3`), `a pre-existing v1 state file with none
of the new fields round-trips byte-identical` (becomes the v2 round-trip; the v1 case moves to the
new refusal test). Every other listed test keeps its assertions: only the fixture builders gain
`v: 2` and `tasks`. Loop-test fixture cards are **deliver-ready** — `loop.test.ts`'s `fixtureCard` carries
`tasks: [{ id: 'T1', heading: 'Task 1: Widget', passedSha: 'basesha0' }]` and `doneSha: 'basesha0'` —
so each existing test keeps modelling "one session ships the card" (Task 2.9 adds the auto task turns
for the tests that need them). Other TypeScript fixtures use `tasks: [{ id: 'T1', heading: 'Task 1' }]`.
Shell-test heredocs gain `"v": 2` and `"tasks":[{"id":"T1","heading":"Task 1"}]`; where a test
writes a plan file, that plan gains `### Task 1` + `#### Done` + a fenced `true` block.

- [ ] **Step 1: Failing tests** — `state.test.ts`:

```ts
describe('v2 — the task index (D1)', () => {
  test('a v1 state is refused with the re-author instruction', () => {
    expect(() => parseState({ ...fixtureState(), v: 1 })).toThrow(/v1 has no task index/);
  });
  test('every card must carry at least one task', () => {
    const s = fixtureState();
    (s.cards.C1 as { tasks: unknown }).tasks = [];
    expect(() => parseState(s)).toThrow();
  });
  test('task ids follow the grammar and are unique within a card', () => {
    const bad = fixtureState();
    (bad.cards.C1 as Card).tasks = [{ id: 'T 1', heading: 'Task 1' }];
    expect(() => parseState(bad)).toThrow(/task id/);
    const dup = fixtureState();
    (dup.cards.C1 as Card).tasks = [{ id: 'T1', heading: 'a' }, { id: 'T1', heading: 'b' }];
    expect(() => parseState(dup)).toThrow(/duplicate task id/);
  });
  test('runner-written progress round-trips; an authored v2 file round-trips byte-identical', () => {
    const authored = serializeState(fixtureState());
    expect(serializeState(parseState(JSON.parse(authored)))).toBe(authored);
  });
  test('resetCard clears every passedSha and the doneSha', () => {
    const s = fixtureState();
    const c = s.cards.C1 as Card;
    c.tasks = [{ id: 'T1', heading: 'Task 1', passedSha: 'abc' }];
    c.doneSha = 'abc';
    const { state, summary } = resetCard(s, 'C1');
    expect((state.cards.C1 as Card).tasks).toEqual([{ id: 'T1', heading: 'Task 1' }]);
    expect('doneSha' in (state.cards.C1 as Card)).toBe(false);
    expect(summary.clearedFields).toEqual(expect.arrayContaining(['tasks.passedSha', 'doneSha']));
  });
});
```

  Run `cd $R && bun test core/state.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `types.ts`: `import type { TaskRef } from './plan-index.ts'` is NOT
  allowed (the kernel imports nothing local), so declare `TaskRef` in `types.ts` and have
  `plan-index.ts` import it from there; `Card` gains `tasks: TaskRef[]` and `doneSha?: string`.
  `state.ts`: `CURRENT_STATE_VERSION = 2`; `UnsupportedStateVersionError`'s message:
  `` `Unsupported campaign state version ${JSON.stringify(version)}: this runner reads v2. A v1 state has no task index (cards.<id>.tasks) — re-author the state with the orchestrate-campaign skill.` ``
  (for `v === 1` say "campaign state v1 has no task index"); in `CardSchema` add
  `tasks: z.array(z.looseObject({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'task id must match ^[A-Za-z0-9][A-Za-z0-9._-]*$'), heading: z.string().min(1), passedSha: z.string().optional() })).min(1)`
  and `doneSha: z.string().optional()`; after structural validation add
  `assertUniqueTaskIds(state)` throwing `` `card ${cardId}: duplicate task id ${id}` ``. `resetCard`
  strips `passedSha` from every task and deletes `doneSha`, pushing `'tasks.passedSha'` and
  `'doneSha'` to `clearedFields` when they were present. Migrate every fixture listed above.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/state.test.ts core/loop.test.ts core/report.test.ts cli/main.test.ts core/loop/card-actions.test.ts watchdog-integration.test.ts`;
  `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`; `bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh`;
  `bash plugins/tribe/scripts/tests/test-supervisor-kill.sh`. Expected: 0 fail each.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner)!: campaign state v2 — the task index lives in the state (D1)"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/state.test.ts core/loop.test.ts core/report.test.ts cli/main.test.ts core/loop/card-actions.test.ts watchdog-integration.test.ts
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh
bash plugins/tribe/scripts/tests/test-supervisor-kill.sh
grep -q 'CURRENT_STATE_VERSION = 2' plugins/tribe/scripts/runner/core/state.ts
```

Expected: every command exits 0.

### Task 2.3: Refs are validated at load; a dangling ref refuses the run (D1, V6)

**Why:** D1 — "Refs are validated at load; a dangling ref refuses the run." MEASURED baseline:
master dry-runs a dangling ref as `fresh` (`$E/v6-before-dry-run.txt`).

**Files:** modify `$R/core/types.ts` (`ResolvedConfig.taskIndex`), `$R/core/loop/run-loop.ts`
(`resolveRunContext`, `runDryRun`), `$R/cli/main.ts` (the `refused:` print), `$R/core/loop.test.ts`
(plan fixture served by `buildMockLoopIo`'s `readFile`), `$R/cli/main.test.ts`.

- [ ] **Step 1: Failing tests** — in `loop.test.ts`, `buildMockLoopIo`'s `readFile` serves, for any
  path ending in `.md` under `docs/plans/`, the default plan
  `'### Task 1: Widget\n\n#### Done\n\n```bash\ntrue\n```\n'` unless `opts.planContent` overrides it,
  and `fixtureCard` carries `tasks: [{ id: 'T1', heading: 'Task 1: Widget', passedSha: 'basesha0' }]`.
  New tests:

```ts
describe('runLoop — D1: the task index is validated at load', () => {
  test('a dangling heading refuses the run before any session spawns, naming card, task and heading', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ tasks: [{ id: 'T1', heading: 'Task 9: nowhere' }] }) } });
    const { io, spawnBriefs } = buildMockLoopIo({ stateJson: JSON.stringify(state), spawnQueue: [] });
    await expect(runLoop(baseLoopConfig(), io)).rejects.toThrow(/C1.*T1.*Task 9: nowhere.*dangling_heading/s);
    expect(spawnBriefs).toEqual([]);
  });
  test('--dry-run refuses the same way', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ tasks: [{ id: 'T1', heading: 'Task 9: nowhere' }] }) } });
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state), spawnQueue: [] });
    await expect(runLoop(baseLoopConfig({ dryRun: true }), io)).rejects.toThrow(/dangling_heading/);
  });
  test('a card whose plan is missing is not validated: it stays the planning_needed escalation', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ tasks: [{ id: 'T1', heading: 'Task 9: nowhere' }] }) } });
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state), spawnQueue: [], missingSpecPlan: true });
    const result = await runLoop(baseLoopConfig(), io);
    expect(result.processed.map((o) => o.kind)).toEqual(['escalated']);
  });
  test('a shipped card is not validated (its plan may be gone)', async () => {
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ status: 'shipped', tasks: [{ id: 'T1', heading: 'Task 9: nowhere' }] }) } });
    const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state), spawnQueue: [] });
    expect((await runLoop(baseLoopConfig(), io)).exitCode).toBe(EXIT_OK);
  });
});
```

  In `cli/main.test.ts` (or wherever the CLI's error path is unit-tested), a thrown
  `TaskIndexError` prints `campaign runner: refused: …` (not `unexpected error`) and exits `4`.
  Run the two files. Expected: FAIL.

- [ ] **Step 2: Implement** — add to `plan-index.ts`:

```ts
/** Thrown at load when any eligible card's task index does not resolve (D1). Carries every issue. */
export class TaskIndexError extends Error {
  readonly issues: TaskIndexIssue[];
  constructor(issues: TaskIndexIssue[]) {
    super(`the task index does not resolve against the plan(s): ${issues
      .map((i) => `card ${i.cardId} task ${i.taskId} "${i.heading}": ${i.problem}`).join('; ')}`);
    this.name = 'TaskIndexError';
    this.issues = issues;
  }
}
```

  In `run-loop.ts` add `async function resolveTaskIndexes(state, config, io)`: for every card id in
  the `--cards`-filtered `sequence` whose card is not `shipped` and whose `plan` resolves on disk
  (`io.fileExists(join(repoRoot, plan))`), read the plan (`io.readFile`) and call
  `resolveTaskIndex`; collect all issues; throw `TaskIndexError` when any; return
  `Record<cardId, ResolvedTask[]>`. Call it from `runLoop` after `loadState` (store on
  `resolved.taskIndex`) and from `runDryRun` after `loadState`. In `cli/main.ts`'s thrown path, print
  `campaign runner: refused: ${message}` when `thrown instanceof TaskIndexError || thrown instanceof UnsupportedStateVersionError`,
  else the existing `unexpected error` line; the exit code stays `EXIT_ERROR`.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/loop.test.ts cli/main.test.ts core/plan-index.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): a dangling task ref refuses the run at load (D1)"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/loop.test.ts cli/main.test.ts core/plan-index.test.ts
grep -q 'class TaskIndexError' plugins/tribe/scripts/runner/core/plan-index.ts
```

Expected: every command exits 0.

### Task 2.4: `core/done.ts` — next step, Done-run judgement, rows, budget (pure)

**Why:** D2/G4 — the decisions of the Done run are pure; only spawning a command is an edge.

**Files:** create `$R/core/done.ts`, `$R/core/done.test.ts`.

- [ ] **Step 1: Failing tests** — `$R/core/done.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { MAX_STEP_ATTEMPTS, applyPass, doneRows, judgeDoneRun, nextStep, tailOf, type DoneCommandResult } from './done.ts';
import type { PlannedCommand } from './plan-index.ts';

const t = (id: string, passedSha?: string) => ({ id, heading: `Task ${id}`, ...(passedSha ? { passedSha } : {}) });
const res = (command: string, exitCode: number): DoneCommandResult =>
  ({ command, exitCode, timedOut: false, durationMs: 5, stdoutTail: 'out', stderrTail: 'err' });
const planned: PlannedCommand[] = [
  { command: 'go build ./...', tasks: ['T1', 'T2'] },
  { command: 'go test ./...', tasks: ['T2'] },
];

describe('nextStep', () => {
  test('the first task with no passedSha', () => {
    expect(nextStep({ tasks: [t('T1', 'a'), t('T2'), t('T3')] })).toEqual({ kind: 'task', index: 1, taskId: 'T2' });
  });
  test('deliver once every task passed AND doneSha is set', () => {
    expect(nextStep({ tasks: [t('T1', 'a')], doneSha: 'a' })).toEqual({ kind: 'deliver' });
  });
  test('every task passed but no doneSha (inconsistent) -> redo the last task, never deliver', () => {
    expect(nextStep({ tasks: [t('T1', 'a'), t('T2', 'a')] })).toEqual({ kind: 'task', index: 1, taskId: 'T2' });
  });
});

describe('judgeDoneRun', () => {
  test('all exit 0 -> passed', () => {
    expect(judgeDoneRun(planned, [res('go build ./...', 0), res('go test ./...', 0)])).toEqual({ passed: true, failed: null, notRun: [] });
  });
  test('the first non-zero stops the run; the rest are not run', () => {
    const v = judgeDoneRun(planned, [res('go build ./...', 2)]);
    expect(v.passed).toBe(false);
    expect(v.failed?.result.exitCode).toBe(2);
    expect(v.notRun.map((p) => p.command)).toEqual(['go test ./...']);
  });
  test('fewer results than planned without a failure is not a pass (fail closed)', () => {
    expect(judgeDoneRun(planned, [res('go build ./...', 0)]).passed).toBe(false);
  });
});

describe('doneRows (G4 record)', () => {
  test('one row per executed command plus one summary row', () => {
    const results = [res('go build ./...', 0), res('go test ./...', 1)];
    const rows = doneRows({ at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', planned, results, verdict: judgeDoneRun(planned, results) });
    expect(rows).toEqual([
      { at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', kind: 'command', command: 'go build ./...', tasks: ['T1', 'T2'], exitCode: 0, timedOut: false, durationMs: 5, stdoutTail: 'out', stderrTail: 'err' },
      { at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', kind: 'command', command: 'go test ./...', tasks: ['T2'], exitCode: 1, timedOut: false, durationMs: 5, stdoutTail: 'out', stderrTail: 'err' },
      { at: 'T', cardId: 'C1', stepTask: 'T2', attempt: 1, sha: 's', kind: 'done_run', passed: false, failedCommand: 'go test ./...', notRun: [] },
    ]);
  });
});

describe('applyPass', () => {
  test('tasks 0..k get passedSha; doneSha only when k is the last task', () => {
    expect(applyPass([t('T1'), t('T2'), t('T3')], 1, 'x')).toEqual({ tasks: [t('T1', 'x'), t('T2', 'x'), t('T3')], doneSha: null });
    expect(applyPass([t('T1', 'x'), t('T2', 'x'), t('T3')], 2, 'y')).toEqual({ tasks: [t('T1', 'y'), t('T2', 'y'), t('T3', 'y')], doneSha: 'y' });
  });
});

test('the step budget is three unaccepted turns', () => {
  expect(MAX_STEP_ATTEMPTS).toBe(3);
});

test('tailOf keeps the last 60 lines and at most 4000 characters', () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  expect(tailOf(long).split('\n')[0]).toBe('line 40');
  expect(tailOf('x'.repeat(9000)).length).toBe(4000);
});
```

  Run `cd $R && bun test core/done.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `$R/core/done.ts`:

```ts
// core/done.ts — the runner's Done-run decisions (card runner-driver-only, D2/G4, spec §4.4-§4.5).
// PURE: results of commands arrive as arguments; spawning them is `DonePort` (adapters).
import type { TaskRef } from './types.ts';
import type { PlannedCommand } from './plan-index.ts';

/** Three unaccepted turns per step (failed Done runs and protocol errors both count), then the card
 * escalates `done_failed` (spec §4.4 item 6). A constant, not a flag. */
export const MAX_STEP_ATTEMPTS = 3;

export type Step = { kind: 'task'; index: number; taskId: string } | { kind: 'deliver' };

/** The first task with no `passedSha`; `deliver` only when every task passed AND `doneSha` is set.
 * Every task passed with no `doneSha` cannot be produced by `applyPass`; if a hand edit makes it,
 * the last task is redone rather than delivering unverified work. */
export function nextStep(card: { tasks: readonly TaskRef[]; doneSha?: string }): Step {
  const index = card.tasks.findIndex((task) => task.passedSha === undefined);
  if (index >= 0) return { kind: 'task', index, taskId: (card.tasks[index] as TaskRef).id };
  if (card.doneSha !== undefined) return { kind: 'deliver' };
  const last = card.tasks.length - 1;
  return { kind: 'task', index: last, taskId: (card.tasks[last] as TaskRef).id };
}

export interface DoneCommandResult {
  command: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
}

export interface DoneRunVerdict {
  passed: boolean;
  failed: { planned: PlannedCommand; result: DoneCommandResult } | null;
  notRun: PlannedCommand[];
}

/** `results` are in plan order and stop at the first non-zero exit. A run is passed only when every
 * planned command ran and exited 0 — fewer results with no failure is NOT a pass (fail closed). */
export function judgeDoneRun(planned: readonly PlannedCommand[], results: readonly DoneCommandResult[]): DoneRunVerdict {
  const failedAt = results.findIndex((r) => r.exitCode !== 0 || r.timedOut);
  if (failedAt >= 0) {
    return {
      passed: false,
      failed: { planned: planned[failedAt] as PlannedCommand, result: results[failedAt] as DoneCommandResult },
      notRun: planned.slice(failedAt + 1),
    };
  }
  if (results.length < planned.length) return { passed: false, failed: null, notRun: planned.slice(results.length) };
  return { passed: true, failed: null, notRun: [] };
}

export type DoneRow =
  | ({ at: string; cardId: string; stepTask: string; attempt: number; sha: string; kind: 'command'; tasks: string[] } & DoneCommandResult)
  | { at: string; cardId: string; stepTask: string; attempt: number; sha: string; kind: 'done_run'; passed: boolean; failedCommand: string | null; notRun: string[] };

/** One row per executed command, then one summary row — the G4 record (`runs/<runId>/done.jsonl`). */
export function doneRows(p: {
  at: string; cardId: string; stepTask: string; attempt: number; sha: string;
  planned: readonly PlannedCommand[]; results: readonly DoneCommandResult[]; verdict: DoneRunVerdict;
}): DoneRow[] {
  const head = { at: p.at, cardId: p.cardId, stepTask: p.stepTask, attempt: p.attempt, sha: p.sha };
  const rows: DoneRow[] = p.results.map((r, i) => ({
    ...head, kind: 'command', command: r.command, tasks: [...(p.planned[i] as PlannedCommand).tasks],
    exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs, stdoutTail: r.stdoutTail, stderrTail: r.stderrTail,
  }));
  rows.push({
    ...head, kind: 'done_run', passed: p.verdict.passed,
    failedCommand: p.verdict.failed?.result.command ?? null, notRun: p.verdict.notRun.map((n) => n.command),
  });
  return rows;
}

/** A passing Done run through task `throughIndex` at `sha` passes every task 0..throughIndex (their
 * Done commands all ran green at that commit); `doneSha` is set only when the last task passed. */
export function applyPass(tasks: readonly TaskRef[], throughIndex: number, sha: string): { tasks: TaskRef[]; doneSha: string | null } {
  const next = tasks.map((task, i) => (i <= throughIndex ? { ...task, passedSha: sha } : { ...task }));
  return { tasks: next, doneSha: throughIndex === tasks.length - 1 ? sha : null };
}

/** The last 60 lines, capped at 4000 characters — what a done-failed turn and a row carry. */
export function tailOf(text: string): string {
  const lines = text.split('\n');
  const kept = lines.slice(Math.max(0, lines.length - 60)).join('\n');
  return kept.length > 4000 ? kept.slice(kept.length - 4000) : kept;
}
```

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/done.test.ts`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git add plugins/tribe/scripts/runner/core/done.ts plugins/tribe/scripts/runner/core/done.test.ts && git commit -m "feat(runner): pure Done-run decisions — next step, judgement, rows, budget"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/done.test.ts
```

Expected: every command exits 0.

### Task 2.5: `core/turn-prompts.ts` — every turn prompt, rendered from facts (pure)

**Why:** spec §4.4 item 2 and §6.1 — each turn kind is a required V1 prompt kind with essentials.

**Files:** create `$R/core/turn-prompts.ts`, `$R/core/turn-prompts.test.ts`.

- [ ] **Step 1: Failing tests** — `$R/core/turn-prompts.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { countTribeMentions } from '../../tests/runner-driver-only/tribe-lexicon.ts';
import { deliverTurnPrompt, doneFailedTurnPrompt, progressDigestLines, protocolErrorTurnPrompt, taskTurnPrompt } from './turn-prompts.ts';

const task = { id: 'T2', heading: 'Task 2: `mathx.Max`', doneCommands: ['go build ./...', 'go test ./...'] };

describe('turn prompts', () => {
  test('task turn: machine-readable first line, the task, its Done commands, the terminal line', () => {
    const p = taskTurnPrompt({ task, planPath: 'docs/plans/p.md' });
    expect(p.split('\n')[0]).toBe('## This turn: task T2 — Task 2: `mathx.Max`');
    for (const s of ['docs/plans/p.md', '    go build ./...', '    go test ./...', '`TASK_DONE T2 <branch>`']) expect(p).toContain(s);
  });
  test('done-failed turn: command, exit, output tails, not-run list, attempt counter', () => {
    const p = doneFailedTurnPrompt({ task, branch: 'b', sha: 'abc1234', failed: { command: 'go test ./...', exitCode: 1, timedOut: false, durationMs: 2100, stdoutTail: 'FAIL x', stderrTail: '' }, notRun: ['go vet ./...'], attempt: 1, max: 3 });
    expect(p.split('\n')[0]).toBe('## This turn: task T2 again — its Done commands failed');
    for (const s of ['$ go test ./...', 'exit 1', 'FAIL x', 'not run: go vet ./...', 'attempt 1 of 3', '`TASK_DONE T2 b`']) expect(p).toContain(s);
  });
  test('protocol-error turn names the reason, then repeats the step (task or deliver)', () => {
    const p = protocolErrorTurnPrompt({ reason: 'the runner asked for task T2; you reported T3', stepPrompt: taskTurnPrompt({ task, planPath: 'docs/plans/p.md' }), attempt: 2, max: 3 });
    expect(p.split('\n')[0]).toBe('## This turn: task T2 — the runner could not accept your last turn');
    for (const s of ['you reported T3', 'attempt 2 of 3', '`TASK_DONE T2 <branch>`']) expect(p).toContain(s);
    const d = protocolErrorTurnPrompt({ reason: 'x', stepPrompt: deliverTurnPrompt({ branch: 'b', sha: 's', baseBranch: 'master', remote: 'origin', repoRoot: '/r', lastTaskId: 'T4' }), attempt: 1, max: 3 });
    expect(d.split('\n')[0]).toBe('## This turn: deliver — the runner could not accept your last turn');
    expect(d).toContain('SHIPPED <pr> <merge-sha>');
  });
  test('deliver turn: the D4 sequence and both exits', () => {
    const p = deliverTurnPrompt({ branch: 'b', sha: 'abc1234', baseBranch: 'master', remote: 'origin', repoRoot: '/r', lastTaskId: 'T4' });
    expect(p.split('\n')[0]).toBe('## This turn: deliver');
    for (const s of ['gh pr checks', 'gh pr merge --merge', 'git push origin --delete b', 'git worktree remove', 'git -C /r merge --ff-only origin/master', 'SHIPPED <pr> <merge-sha>', '`TASK_DONE T4 b`']) expect(p).toContain(s);
  });
  test('progress digest names passed tasks, the commit, the branch and the next step', () => {
    const lines = progressDigestLines({ tasks: [{ id: 'T1', heading: 'a', passedSha: 'abc' }, { id: 'T2', heading: 'b' }], branch: 'feat/x', doneSha: undefined });
    expect(lines.join('\n')).toContain('- passed: T1 at abc');
    expect(lines.join('\n')).toContain('- next: task T2');
    expect(lines.join('\n')).toContain('feat/x');
  });
  test('no turn prompt carries the Tribe way of working', () => {
    const all = [taskTurnPrompt({ task, planPath: 'p' }), deliverTurnPrompt({ branch: 'b', sha: 's', baseBranch: 'master', remote: 'origin', repoRoot: '/r', lastTaskId: 'T4' })].join('\n');
    expect(countTribeMentions(all)).toEqual([]);
  });
});
```

  Run `cd $R && bun test core/turn-prompts.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `$R/core/turn-prompts.ts`:

```ts
// core/turn-prompts.ts — every prompt the runner sends between turns (card runner-driver-only, spec
// §4.4). PURE: facts in, text out. The first line of every prompt is machine-readable
// (`## This turn: task <id> …` / `## This turn: deliver`) — tests and doubles key on it.
import type { ResolvedTask } from './plan-index.ts';
import type { TaskRef } from './types.ts';

function commandBlock(commands: readonly string[]): string {
  return commands.map((c) => `    ${c}`).join('\n');
}

export function taskTurnPrompt(p: { task: ResolvedTask; planPath: string }): string {
  return [
    `## This turn: task ${p.task.id} — ${p.task.heading}`,
    '',
    `Do task ${p.task.id} of the plan (${p.planPath}, section "${p.task.heading}"), the way the plan says, and commit it on your card branch.`,
    'The runner will then run these Done commands itself, from a clean checkout of your branch tip, together with the Done commands of every task before this one:',
    '',
    commandBlock(p.task.doneCommands),
    '',
    `End your turn with \`TASK_DONE ${p.task.id} <branch>\`.`,
  ].join('\n');
}

export function doneFailedTurnPrompt(p: {
  task: ResolvedTask; branch: string; sha: string;
  failed: { command: string; exitCode: number; timedOut: boolean; durationMs: number; stdoutTail: string; stderrTail: string };
  notRun: readonly string[]; attempt: number; max: number;
}): string {
  const outcome = p.failed.timedOut ? 'timed out' : `exit ${p.failed.exitCode}`;
  return [
    `## This turn: task ${p.task.id} again — its Done commands failed`,
    '',
    `The runner checked out ${p.sha} (branch ${p.branch}) and ran the Done commands. This one failed:`,
    '',
    `    $ ${p.failed.command}`,
    `    ${outcome} after ${(p.failed.durationMs / 1000).toFixed(1)}s`,
    '',
    '--- stdout (last lines) ---',
    p.failed.stdoutTail || '(empty)',
    '--- stderr (last lines) ---',
    p.failed.stderrTail || '(empty)',
    '',
    p.notRun.length > 0 ? `not run: ${p.notRun.join(' | ')}` : 'every other command ran and passed.',
    '',
    `This was attempt ${p.attempt} of ${p.max} for task ${p.task.id}. Fix it, commit, and end your turn with \`TASK_DONE ${p.task.id} ${p.branch}\`.`,
  ].join('\n');
}

/** Wraps the step's own prompt: the machine-readable first line keeps the step (`task <id>` or
 * `deliver`), then the reason, then the step's instructions again. */
export function protocolErrorTurnPrompt(p: { reason: string; stepPrompt: string; attempt: number; max: number }): string {
  const [first, ...rest] = p.stepPrompt.split('\n');
  const step = /^## This turn: (task \S+|deliver)/.exec(first ?? '')?.[1] ?? 'deliver';
  return [
    `## This turn: ${step} — the runner could not accept your last turn`,
    '',
    `Why: ${p.reason}.`,
    `This was attempt ${p.attempt} of ${p.max} for this step.`,
    ...rest,
  ].join('\n');
}

export function deliverTurnPrompt(p: { branch: string; sha: string; baseBranch: string; remote: string; repoRoot: string; lastTaskId: string }): string {
  return [
    '## This turn: deliver',
    '',
    `Every task passed its Done commands at ${p.sha} on ${p.branch}. Deliver the card now:`,
    `1. push ${p.branch} and open (or reuse) its PR against ${p.baseBranch};`,
    `2. wait in the foreground until every check concludes green: \`gh pr checks <pr> --watch\` (timeout: 600000), re-run if 10 minutes is not enough;`,
    '3. merge with `gh pr merge --merge`;',
    `4. delete the remote branch (\`git push ${p.remote} --delete ${p.branch}\`) and remove your worktree (\`git worktree remove <path>\`);`,
    `5. fast-forward the local base: \`git -C ${p.repoRoot} merge --ff-only ${p.remote}/${p.baseBranch}\`.`,
    '',
    'Then end your turn with `SHIPPED <pr> <merge-sha>`.',
    `If you change any code during delivery, commit and push it, and end your turn with \`TASK_DONE ${p.lastTaskId} ${p.branch}\` instead: the runner re-runs the Done commands and the merge gate only accepts the commit they passed on.`,
  ].join('\n');
}

/** Lines for the fresh-with-digest fallback (spec §4.4 item 9). */
export function progressDigestLines(card: { tasks: readonly TaskRef[]; branch: string | null; doneSha: string | undefined }): string[] {
  const passed = card.tasks.filter((t) => t.passedSha !== undefined);
  const next = card.tasks.find((t) => t.passedSha === undefined);
  return [
    'Task progress (the runner ran these Done commands itself):',
    ...(passed.length > 0 ? passed.map((t) => `- passed: ${t.id} at ${t.passedSha as string}`) : ['- passed: none yet']),
    `- branch: ${card.branch ?? '(none recorded)'}`,
    next ? `- next: task ${next.id} — ${next.heading}` : card.doneSha ? '- next: deliver' : '- next: the last task again',
  ];
}
```

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/turn-prompts.test.ts`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git add plugins/tribe/scripts/runner/core/turn-prompts.ts plugins/tribe/scripts/runner/core/turn-prompts.test.ts && git commit -m "feat(runner): pure turn prompts — task, done-failed, protocol-error, deliver"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/turn-prompts.test.ts
```

Expected: every command exits 0.

### Task 2.6: The Done edge — `DonePort.runShell`, the scratch-worktree path, the record path

**Why:** spec §4.5 — the one place a Done command is spawned: bounded (10 min), output tails
captured, never a shell-string built from anything but the plan line itself.

**Files:** modify `$R/ports/ports.ts` (`ShellRunResult`, `DonePort`, `RunHomePort.removeTree`,
`LoopIO extends DonePort`), `$R/adapters/run-io.adapter.ts`, `$R/core/paths.ts`, `$R/core/paths.test.ts`,
`$R/core/run-record.ts`; create `$R/adapters/run-io.adapter.done.test.ts`; update every hand-built
`LoopIO` mock the compiler names (`runShell`/`removeTree` stubs only).

- [ ] **Step 1: Failing tests** — `paths.test.ts`:

```ts
import { doneWorktreePathOf } from './paths.ts';
test('doneWorktreePathOf stays under <home>/done and refuses a card id that would leave it', () => {
  expect(doneWorktreePathOf('/h', 'small-helpers')).toBe('/h/done/small-helpers');
  for (const bad of ['../x', 'a/../../b', '/abs', '', '.', '..']) expect(() => doneWorktreePathOf('/h', bad)).toThrow(/outside/);
});
```

  `run-io.adapter.done.test.ts` (real `bash`, real timeout — fixtures-mirror-reality):

```ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShellBounded } from './run-io.adapter.ts';

describe('runShellBounded (the Done edge)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rdo-done-'));
  test('exit code, cwd, env and both output streams', async () => {
    const r = await runShellBounded('echo "$RUNNER_CARD_ID in $(pwd)"; echo oops >&2; exit 3', { cwd, env: { RUNNER_CARD_ID: 'C1' }, timeoutMs: 10_000 });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toBe(`C1 in ${realpathSync(cwd)}\n`); // `pwd` resolves /var -> /private/var on macOS
    expect(r.stderr).toBe('oops\n');
  });
  test('a command past its timeout is killed and reported, never awaited forever', async () => {
    const started = Date.now();
    const r = await runShellBounded('sleep 30', { cwd, env: {}, timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
  test('a missing binary is a non-zero exit, not a throw', async () => {
    const r = await runShellBounded('definitely-not-a-binary-xyz', { cwd, env: {}, timeoutMs: 10_000 });
    expect(r.exitCode).toBe(127);
  });
});
```

  Run `cd $R && bun test core/paths.test.ts adapters/run-io.adapter.done.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `ports.ts`:

```ts
/** One Done command's outcome, as the edge observed it. `timedOut` = killed at `timeoutMs`. */
export interface ShellRunResult { exitCode: number; timedOut: boolean; durationMs: number; stdout: string; stderr: string }
/** Card runner-driver-only (D2): the ONLY seam that runs a plan's Done command. */
export interface DonePort {
  runShell(command: string, opts: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<ShellRunResult>;
}
```

  add `removeTree(resolvedPath: string): void` to `RunHomePort` ("recursive delete of a runner-built
  scratch path; the adapter refuses any path without a `/done/` segment") and `DonePort` to
  `LoopIO`'s `extends` list. `run-io.adapter.ts`:

```ts
/** fail-closed-edges obligations 1 and 3: bounded, never throws, a spawn error is exit 127. Output
 * kept to the last 256 KiB per stream so a chatty test suite cannot exhaust memory. */
export function runShellBounded(command: string, opts: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<ShellRunResult> {
  const cap = 256 * 1024;
  const keep = (acc: string, chunk: Buffer) => { const next = acc + chunk.toString(); return next.length > cap ? next.slice(next.length - cap) : next; };
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn('bash', ['-c', command], { cwd: opts.cwd, env: { ...process.env, ...opts.env }, detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-(child.pid as number), 'SIGKILL'); } catch { child.kill('SIGKILL'); } // the whole group: a pipeline's children too
    }, opts.timeoutMs);
    child.stdout?.on('data', (c: Buffer) => (stdout = keep(stdout, c)));
    child.stderr?.on('data', (c: Buffer) => (stderr = keep(stderr, c)));
    child.on('error', (err) => { clearTimeout(timer); resolve({ exitCode: 127, timedOut, durationMs: Date.now() - started, stdout, stderr: `${stderr}${err.message}\n` }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? (signal !== null ? 137 : 1), timedOut, durationMs: Date.now() - started, stdout, stderr });
    });
  });
}
```

  wired as `runShell: runShellBounded` and
  `removeTree: (p) => { if (!p.includes(`${sep}done${sep}`)) throw new Error(`removeTree refuses ${p}: not a runner Done scratch path`); rmSync(p, { recursive: true, force: true }); }`.
  `paths.ts`:

```ts
/** `<home>/done/<cardId>` — the scratch worktree a Done run checks out (spec §4.5). Proven to stay
 * under `<home>/done` before anything is created or deleted there (fail-closed-edges obligation 4). */
export function doneWorktreePathOf(homeDir: string, cardId: string): string {
  const root = resolve(homeDir, 'done');
  const path = resolve(root, cardId);
  if (cardId === '' || cardId === '.' || isAbsolute(cardId) || dirname(path) !== root) {
    throw new Error(`doneWorktreePathOf: card id ${JSON.stringify(cardId)} resolves outside ${root}`);
  }
  return path;
}
```

  `run-record.ts`: `export function doneRecordPathOf(homeDir: string, runId: string): string { return join(runDirOf(homeDir, runId), 'done.jsonl'); }`.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/paths.test.ts adapters/run-io.adapter.done.test.ts core/loop.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): the Done edge — bounded runShell, contained scratch path, done.jsonl path"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/paths.test.ts adapters/run-io.adapter.done.test.ts core/loop.test.ts
```

Expected: every command exits 0.

### Task 2.7: The session's terminal line — `TASK_DONE <task-id> <branch>`

**Why:** spec §4.4 item 3 — three terminal lines; the last matching line decides.

**Files:** modify `$R/core/session.ts` (`SessionOutcome`, `SessionResult`, `parseResultMessage`),
`$R/core/session.test.ts`.

- [ ] **Step 1: Failing tests** — `session.test.ts` (use the file's existing result-message helper):

```ts
describe('parseResultMessage — TASK_DONE (spec §4.4)', () => {
  test('TASK_DONE <task-id> <branch> -> task_done with both fields', async () => {
    const r = await runWithFinalText('Committed.\nTASK_DONE T2 feat/small-helpers');
    expect(r).toMatchObject({ outcome: 'task_done', taskId: 'T2', branch: 'feat/small-helpers' });
  });
  test('the LAST terminal line decides', async () => {
    expect((await runWithFinalText('TASK_DONE T1 b\nlater: SHIPPED 12 abc1234')).outcome).toBe('shipped');
    expect((await runWithFinalText('SHIPPED 12 abc1234 was wrong\nTASK_DONE T1 b')).outcome).toBe('task_done');
    expect((await runWithFinalText('TASK_DONE T1 b\nNEEDS_DIRECTION: which?')).outcome).toBe('needs_direction');
  });
  test('a TASK_DONE missing its branch is not a terminal line', async () => {
    expect((await runWithFinalText('TASK_DONE T1')).outcome).toBe('error');
  });
});
```

  (`runWithFinalText` = the file's existing way to feed one `result/success` message through
  `runSession`; create it as a local helper if the file has none.) Run `cd $R && bun test core/session.test.ts`.
  Expected: FAIL.

- [ ] **Step 2: Implement** — `SessionOutcome` gains `'task_done'`; `SessionResult` gains
  `taskId?: string; branch?: string`; `parseResultMessage` becomes "last matching line wins":

```ts
const TERMINAL_LINE_RE = /^\s*(?:(SHIPPED)\s+#?(\d+)\s+([0-9a-f]{7,40})|(TASK_DONE)\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+(\S+)|(NEEDS_DIRECTION):)/i;

function parseResultMessage(message: SessionMessage): SessionResult {
  const finalText = typeof message.result === 'string' ? message.result : '';
  if (message.subtype !== 'success') {
    return { outcome: 'error', finalText: finalText || `session ended with error subtype "${message.subtype}"` };
  }
  // Spec §4.4: with three terminal lines, the LAST one the session wrote is its answer.
  const lines = finalText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = TERMINAL_LINE_RE.exec(lines[i] as string);
    if (!m) continue;
    if (m[1]) return { outcome: 'shipped', finalText, pr: Number(m[2]), sha: m[3] };
    if (m[4]) return { outcome: 'task_done', finalText, taskId: m[5], branch: m[6] };
    return { outcome: 'needs_direction', finalText };
  }
  return { outcome: 'error', finalText: finalText || 'result message carried no SHIPPED, TASK_DONE or NEEDS_DIRECTION terminal line' };
}
```

  An existing test that relied on `SHIPPED` beating `NEEDS_DIRECTION` when both appear, if any, is a
  named deliberate change: name it in the commit message body.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/session.test.ts core/loop.test.ts`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): TASK_DONE terminal line; the last terminal line decides"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/session.test.ts core/loop.test.ts
```

Expected: every command exits 0.

### Task 2.8: `core/loop/turns.ts` — the turn loop, over injected effects

**Why:** spec §4.4 — the runner walks the plan task by task, accepts a task only when its Done
commands pass in the runner's hands, and delivers only after every task passed. The loop's decisions
are pure-ish over a `TurnDeps` seam, so every branch is unit-testable without a session or git.

**Files:** create `$R/core/loop/turns.ts`, `$R/core/loop/turns.test.ts`.

- [ ] **Step 1: Failing tests** — `$R/core/loop/turns.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { driveCardTurns, type TurnDeps } from './turns.ts';
import type { SessionResult } from '../session.ts';
import type { DoneRunVerdict } from '../done.ts';
import type { Card } from '../types.ts';

const tasks = [
  { id: 'T1', heading: 'Task 1: a', doneCommands: ['go build ./...'] },
  { id: 'T2', heading: 'Task 2: b', doneCommands: ['go test ./...'] },
];
function card(): Card {
  return { status: 'running', spec: 's', plan: 'p', branch: null, baseSha: 'base', pr: null, mergeSha: null,
    sessionId: 'sess', updatedAt: null, tasks: [{ id: 'T1', heading: 'Task 1: a' }, { id: 'T2', heading: 'Task 2: b' }] };
}
const pass: DoneRunVerdict = { passed: true, failed: null, notRun: [] };
const fail: DoneRunVerdict = { passed: false, notRun: [], failed: { planned: { command: 'go test ./...', tasks: ['T2'] },
  result: { command: 'go test ./...', exitCode: 1, timedOut: false, durationMs: 1, stdoutTail: 'FAIL', stderrTail: '' } } };

function harness(turns: SessionResult[], verdicts: DoneRunVerdict[] = [], accept: Array<{ ok: true; tip: string } | { ok: false; reason: string }> = []) {
  const c = card();
  const prompts: string[] = [];
  const events: string[] = [];
  const deps: TurnDeps = {
    runTurn: async (prompt, first) => { prompts.push(prompt); events.push(first ? 'turn:first' : 'turn'); const next = turns.shift(); if (!next) throw new Error('unscripted turn'); return next; },
    acceptTaskDone: async (branch) => accept.shift() ?? { ok: true, tip: `tip-of-${branch}` },
    runDone: async (planned, sha, stepTaskId, attempt) => { events.push(`done:${stepTaskId}:${planned.map((p) => p.command).join('+')}:${sha}:${attempt}`); return { kind: 'verdict', verdict: verdicts.shift() ?? pass }; },
    recordPass: (i, sha, branch) => { events.push(`pass:${i}:${sha}`); c.tasks = c.tasks.map((t, j) => (j <= i ? { ...t, passedSha: sha } : t)); if (i === c.tasks.length - 1) c.doneSha = sha; c.branch ??= branch; },
    finishShipped: async (r) => { events.push(`shipped:${r.pr}`); return { kind: 'shipped', cardId: 'C1' }; },
    escalate: async (reason, detail) => { events.push(`escalate:${reason}`); return { kind: 'escalated', cardId: 'C1', escalationPath: '/e', reason: `${reason}|${detail}` }; },
  };
  return { c, deps, prompts, events };
}
const taskDone = (taskId: string, branch = 'b'): SessionResult => ({ outcome: 'task_done', finalText: '', taskId, branch });
const shipped: SessionResult = { outcome: 'shipped', finalText: '', pr: 7, sha: 'm' };

describe('driveCardTurns — spec §4.4', () => {
  test('happy path: T1, T2 (cumulative Done), deliver, shipped', async () => {
    const h = harness([taskDone('T1'), taskDone('T2'), shipped]);
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('shipped');
    expect(h.events).toEqual([
      'turn:first', 'done:T1:go build ./...:tip-of-b:1', 'pass:0:tip-of-b',
      'turn', 'done:T2:go build ./...+go test ./...:tip-of-b:1', 'pass:1:tip-of-b',
      'turn', 'shipped:7',
    ]);
    expect(h.prompts[0]?.split('\n')[0]).toBe('## This turn: task T1 — Task 1: a');
    expect(h.prompts[2]?.split('\n')[0]).toBe('## This turn: deliver');
  });
  test('a failing Done run re-prompts with the failure; three failures escalate done_failed', async () => {
    const h = harness([taskDone('T1'), taskDone('T1'), taskDone('T1')], [fail, fail, fail]);
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('escalated');
    expect(h.events.filter((e) => e.startsWith('escalate'))).toEqual(['escalate:done_failed']);
    expect(h.prompts[1]?.split('\n')[0]).toBe('## This turn: task T1 again — its Done commands failed');
    expect(h.c.tasks[0]?.passedSha).toBeUndefined();
  });
  test('a pass resets the budget: fail, pass, then the next task starts at attempt 1', async () => {
    const h = harness([taskDone('T1'), taskDone('T1'), taskDone('T2'), shipped], [fail, pass, pass]);
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.events.filter((e) => e.startsWith('done:'))).toEqual([
      'done:T1:go build ./...:tip-of-b:1', 'done:T1:go build ./...:tip-of-b:2', 'done:T2:go build ./...+go test ./...:tip-of-b:1',
    ]);
  });
  test('SHIPPED before every task passed is refused; it never reaches finishShipped', async () => {
    const h = harness([shipped, shipped, shipped]);
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out.kind).toBe('escalated');
    expect(h.events).not.toContain('shipped:7');
    expect(h.prompts[1]).toContain('SHIPPED arrived before every task passed its Done commands');
  });
  test('the wrong task id, or a branch the runner cannot accept, is a protocol error', async () => {
    const h = harness([taskDone('T2'), taskDone('T1'), taskDone('T1'), taskDone('T2'), shipped], [], [{ ok: false, reason: 'branch b does not exist' }]);
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.prompts[1]).toContain('the runner asked for task T1; you reported T2');
    expect(h.prompts[2]).toContain('branch b does not exist');
  });
  test('during delivery, TASK_DONE of the last task re-runs every Done command, then delivers again', async () => {
    const h = harness([taskDone('T1'), taskDone('T2'), taskDone('T2', 'b'), shipped]);
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.events.filter((e) => e.startsWith('done:T2'))).toHaveLength(2);
    expect(h.events.at(-1)).toBe('shipped:7');
  });
  test('NEEDS_DIRECTION escalates; error and timeout stop (retryable only for error)', async () => {
    const nd = harness([{ outcome: 'needs_direction', finalText: 'NEEDS_DIRECTION: which?' }]);
    expect((await driveCardTurns({ cardId: 'C1', card: nd.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, nd.deps)).kind).toBe('escalated');
    const er = harness([{ outcome: 'error', finalText: 'x' }]);
    expect(await driveCardTurns({ cardId: 'C1', card: er.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, er.deps)).toMatchObject({ kind: 'stopped', retryable: true });
    const to = harness([{ outcome: 'timeout', finalText: 'x' }]);
    expect(await driveCardTurns({ cardId: 'C1', card: to.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, to.deps)).toMatchObject({ kind: 'stopped', retryable: false });
  });
  test('a card resumed with every task passed goes straight to delivery', async () => {
    const h = harness([shipped]);
    h.c.tasks = h.c.tasks.map((t) => ({ ...t, passedSha: 'x' }));
    h.c.doneSha = 'x';
    await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(h.prompts[0]?.split('\n')[0]).toBe('## This turn: deliver');
  });
});
```

  Run `cd $R && bun test core/loop/turns.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 2: Implement** — `$R/core/loop/turns.ts`:

```ts
// core/loop/turns.ts — the runner drives ONE card's plan, turn by turn (card runner-driver-only,
// spec §4.4). Every effect (a session turn, git, a Done run, a state write, an escalation) arrives
// through `TurnDeps`; this module only decides what the next turn is and what a turn's answer means.
import type { Card } from '../types.ts';
import type { SessionResult } from '../session.ts';
import type { CardOutcome } from './card-actions.ts';
import { doneCommandsThrough, type PlannedCommand, type ResolvedTask } from '../plan-index.ts';
import { MAX_STEP_ATTEMPTS, nextStep, type DoneRunVerdict, type Step } from '../done.ts';
import { deliverTurnPrompt, doneFailedTurnPrompt, protocolErrorTurnPrompt, taskTurnPrompt } from '../turn-prompts.ts';

export interface TurnDeps {
  /** One session turn. `first` = the card's first turn in this call (the caller composes the full
   * brief or resumes the recorded session); later turns resume the same session. */
  runTurn(prompt: string, first: boolean): Promise<SessionResult>;
  /** Trust the disk: the branch exists, descends from the card's base, and (once known) is the card's branch. */
  acceptTaskDone(branch: string): Promise<{ ok: true; tip: string } | { ok: false; reason: string }>;
  /** Runs `planned` at `sha` in a scratch checkout, stops at the first failure, appends the rows. A
   * failure of the runner's OWN checkout is `infrastructure` — never charged to the session. */
  runDone(planned: PlannedCommand[], sha: string, stepTaskId: string, attempt: number):
    Promise<{ kind: 'verdict'; verdict: DoneRunVerdict } | { kind: 'infrastructure'; reason: string }>;
  /** Tasks 0..throughIndex passed at `sha` on `branch`: record and persist. */
  recordPass(throughIndex: number, sha: string, branch: string): void;
  /** SHIPPED at the deliver step: the existing D4 verify, then ship or escalate. */
  finishShipped(result: SessionResult): Promise<CardOutcome>;
  escalate(reason: string, detail: string): Promise<CardOutcome>;
}

export interface DriveInput {
  cardId: string;
  /** The LIVE state entry — `recordPass` mutates it; `nextStep` reads it every turn. */
  card: Card;
  tasks: readonly ResolvedTask[];
  planPath: string;
  delivery: { baseBranch: string; remote: string; repoRoot: string };
}

function stepPrompt(step: Step, input: DriveInput): string {
  if (step.kind === 'deliver') {
    const last = input.tasks[input.tasks.length - 1] as ResolvedTask;
    return deliverTurnPrompt({
      branch: input.card.branch ?? '(your card branch)', sha: input.card.doneSha ?? '(unknown)',
      baseBranch: input.delivery.baseBranch, remote: input.delivery.remote, repoRoot: input.delivery.repoRoot, lastTaskId: last.id,
    });
  }
  return taskTurnPrompt({ task: input.tasks[step.index] as ResolvedTask, planPath: input.planPath });
}

export async function driveCardTurns(input: DriveInput, deps: TurnDeps): Promise<CardOutcome> {
  let attempts = 0;
  let override: string | null = null;
  let lastProblem = '';
  let first = true;
  for (;;) {
    const step = nextStep(input.card);
    const plain = stepPrompt(step, input);
    const prompt = override ?? plain;
    override = null;
    const result = await deps.runTurn(prompt, first);
    first = false;

    if (result.outcome === 'error' || result.outcome === 'timeout') {
      return {
        kind: 'stopped', cardId: input.cardId,
        reason: `session ended with outcome "${result.outcome}": ${result.finalText}`,
        retryable: result.outcome === 'error',
      };
    }
    if (result.outcome === 'needs_direction') return deps.escalate('needs_direction', result.finalText);

    // A turn the runner cannot accept costs one attempt of THIS step; the fourth escalates.
    const refuse = (reason: string): boolean => {
      attempts += 1;
      lastProblem = reason;
      override = protocolErrorTurnPrompt({ reason, stepPrompt: plain, attempt: attempts, max: MAX_STEP_ATTEMPTS });
      return attempts >= MAX_STEP_ATTEMPTS;
    };
    const stepName = step.kind === 'deliver' ? 'delivery' : `task ${step.taskId}`;
    const budgetSpent = () => deps.escalate('done_failed',
      `${stepName}: ${MAX_STEP_ATTEMPTS} turns the runner could not accept. Last: ${lastProblem}`);

    if (result.outcome === 'shipped') {
      if (step.kind === 'deliver') return deps.finishShipped(result);
      const pending = input.card.tasks.filter((t) => t.passedSha === undefined).map((t) => t.id).join(', ');
      if (refuse(`SHIPPED arrived before every task passed its Done commands (${pending || 'the last Done run'} remaining)`)) return budgetSpent();
      continue;
    }

    // outcome === 'task_done': at a task step it must name that task; during delivery, the last task
    // (re-verify after a code change — spec §4.4 item 2).
    const expectedIndex = step.kind === 'task' ? step.index : input.tasks.length - 1;
    const expected = input.tasks[expectedIndex] as ResolvedTask;
    if (result.taskId !== expected.id) {
      if (refuse(`the runner asked for task ${expected.id}; you reported ${String(result.taskId)}`)) return budgetSpent();
      continue;
    }
    const branch = result.branch as string;
    const accepted = await deps.acceptTaskDone(branch);
    if (!accepted.ok) {
      if (refuse(accepted.reason)) return budgetSpent();
      continue;
    }
    const planned = doneCommandsThrough(input.tasks, expectedIndex);
    const run = await deps.runDone(planned, accepted.tip, expected.id, attempts + 1);
    if (run.kind === 'infrastructure') {
      return { kind: 'stopped', cardId: input.cardId, reason: `the runner could not run the Done commands: ${run.reason}`, retryable: false };
    }
    if (run.verdict.passed) {
      deps.recordPass(expectedIndex, accepted.tip, branch);
      attempts = 0;
      continue;
    }
    attempts += 1;
    const failed = run.verdict.failed;
    lastProblem = failed
      ? `\`${failed.result.command}\` ${failed.result.timedOut ? 'timed out' : `exited ${failed.result.exitCode}`} at ${accepted.tip}\n${failed.result.stdoutTail}\n${failed.result.stderrTail}`
      : `the Done run at ${accepted.tip} did not complete`;
    if (attempts >= MAX_STEP_ATTEMPTS) {
      return deps.escalate('done_failed', `task ${expected.id} (${expected.heading}) did not pass its Done commands after ${MAX_STEP_ATTEMPTS} attempts. Last: ${lastProblem}`);
    }
    override = failed
      ? doneFailedTurnPrompt({ task: expected, branch, sha: accepted.tip, failed: failed.result, notRun: run.verdict.notRun.map((n) => n.command), attempt: attempts, max: MAX_STEP_ATTEMPTS })
      : protocolErrorTurnPrompt({ reason: lastProblem, stepPrompt: plain, attempt: attempts, max: MAX_STEP_ATTEMPTS });
  }
}
```

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/loop/turns.test.ts`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git add plugins/tribe/scripts/runner/core/loop/turns.ts plugins/tribe/scripts/runner/core/loop/turns.test.ts && git commit -m "feat(runner): the turn loop — tasks in order, runner-run Done, deliver last"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/loop/turns.test.ts
```

Expected: every command exits 0.

### Task 2.9: Wire the turn loop into `actOnCard`

**Why:** the runner now drives every card through `driveCardTurns`; the old one-shot session +
`CONTINUE_*` prompts go (spec §4.4 item 9).

**Files:** modify `$R/core/loop/card-actions.ts`, `$R/core/loop/phase.ts` (`buildStateDigest` gains
the progress lines), `$R/core/loop.test.ts`, `$R/core/loop/card-actions.test.ts`, `$R/core/loop.ts`
(barrel: drop the `CONTINUE_*` exports if it re-exports them).

**Changed existing assertions (named):** `loop.test.ts` — the three tests asserting
`spawnBriefs[i]).toBe(CONTINUE_UNKNOWN_STATE_PROMPT)` (the resumed turn is now the next-step
prompt; assert its first line `## This turn: …` instead); tests asserting `spawnBriefs` lengths for a
card that is NOT deliver-ready (a `revert_and_redo` card, whose progress is cleared) gain one
auto task turn each — name each in the commit body. Every other existing test keeps its assertions:
its fixture card is deliver-ready (Task 2.2), so one scripted session still ships it.

- [ ] **Step 1: Failing tests** — in `loop.test.ts`, give `buildMockLoopIo` an **auto task turn**:
  when a spawned prompt's `## This turn:` line is a task step (`/^## This turn: task (\S+)/m`) and
  `opts.autoTaskTurns !== false`, record the prompt in `spawnBriefs` and yield
  `shippedMessages`-style messages whose final text is `TASK_DONE <id> <card branch or 'feat/auto'>`
  **without** consuming a `spawnQueue` entry; a deliver step consumes the queue as today. Add
  defaults: `runShell` → `{ exitCode: 0, timedOut: false, durationMs: 1, stdout: '', stderr: '' }`,
  `removeTree` → no-op, `git rev-parse --verify --quiet refs/heads/*` → `ok('basesha0\n')`,
  `git worktree add` → `ok('')`. Then:

```ts
describe('runLoop — the turn loop drives a fresh card end to end (spec §4.4)', () => {
  test('a fresh card: task turn, runner-run Done, deliver turn, shipped', async () => {
    const card = fixtureCard({ branch: null, tasks: [{ id: 'T1', heading: 'Task 1: Widget' }] });
    delete (card as { doneSha?: string }).doneSha;
    const state = fixtureState({ sequence: ['C1'], cards: { C1: card } });
    const { io, spawnBriefs, calls } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      spawnQueue: [() => messages(shippedMessages(41, 'mergesha41', 'sess-c1'))],
      execHandlers: cleanCommitAndVerifyHandlers('mergesha41'),
    });
    const result = await runLoop(baseLoopConfig(), io);
    expect(result.processed.map((o) => o.kind)).toEqual(['shipped']);
    expect(spawnBriefs[0]).toContain('## This turn: task T1 — Task 1: Widget');
    expect(spawnBriefs[1]).toContain('## This turn: deliver');
    expect((io.runShell as ReturnType<typeof mock>).mock.calls.map((c) => c[0])).toEqual(['true']);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'worktree' && c[2] === 'add')).toBe(true);
  });
  test('revert_and_redo clears the recorded progress: the first turn is a task turn, not delivery', async () => {
    let remoteBranch = true;
    // fixtureCard is deliver-ready (T1 passed, doneSha set); revert_and_redo must throw that away.
    const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ branch: 'feat/c1-widget', sessionId: null }) } });
    const { io, spawnBriefs } = buildMockLoopIo({
      stateJson: JSON.stringify(state),
      spawnQueue: [() => messages(shippedMessages(41, 'mergesha41', 'sess-c1'))],
      execHandlers: [
        (cmd) => (cmd[0] === 'git' && cmd[1] === 'ls-remote' ? ok(remoteBranch ? 'abc\trefs/heads/feat/c1-widget\n' : '') : null),
        (cmd) => {
          if (cmd[0] === 'git' && cmd[1] === 'push' && cmd.includes('--delete')) { remoteBranch = false; return ok(''); }
          return null;
        },
        ...cleanCommitAndVerifyHandlers('mergesha41'),
      ],
    });
    await runLoop(baseLoopConfig(), io);
    expect(spawnBriefs[0]).toContain('## This turn: task T1');
    expect(spawnBriefs[0]).not.toContain('## This turn: deliver');
  });
});
```

  Run `cd $R && bun test core/loop.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — in `card-actions.ts`:
  - `actOnCard`: `verify_only` unchanged. For every other phase: `revert_and_redo` →
    `performRevertAndRedo(ctx)` then clear progress (every task's `passedSha` deleted, `doneSha`
    deleted, persisted); `recordBaseSha(ctx, phase)`; then
    `return driveCardTurns({ cardId, card, tasks: resolved.taskIndex[cardId] ?? [], planPath: card.plan ?? '(missing)', delivery: { baseBranch: resolved.baseBranch, remote: resolved.remote, repoRoot: resolved.repoRoot } }, turnDepsFor(ctx, phase))`.
    A card with no resolved tasks (its plan was missing at load, so it never reached here — nextCard
    escalates `planning_needed` first) is defended anyway: `escalateCard(ctx, 'planning_needed', 'no resolved task index for this card')`.
  - `turnDepsFor(ctx, phase): TurnDeps`:
    - `runTurn(prompt, first)`: not first → `runSession({ brief: prompt, resume: card.sessionId ?? undefined }, …)`;
      first + `phase.kind === 'resume'` → resume with `prompt`, and on an `error` outcome fall back to
      a fresh session whose brief is `executorBrief(…, digest + '\n\n---\n\n' + answers, …) + '\n\n' + prompt`
      (the digest from `buildStateDigest`, now including `progressDigestLines`); first + fresh →
      `executorBrief(…) + '\n\n' + prompt` (a phase digest, when present, prepended to answers as today).
    - `acceptTaskDone(branch)`: refuse a branch that is empty, contains whitespace or starts with `-`;
      `git rev-parse --verify --quiet refs/heads/<branch>` (cwd repoRoot) → else "branch X does not
      exist in the repo"; `card.branch` set and different → "the card's branch is Y"; `card.baseSha`
      null → "no base commit recorded"; `git merge-base --is-ancestor <baseSha> <tip>` → else "tip Z
      does not descend from the card's base W"; ok → `{ ok: true, tip }`.
    - `runDone(planned, sha, stepTaskId, attempt)`: `path = doneWorktreePathOf(home, cardId)`; inside
      `serializeRepoGitMutation`: `git worktree remove --force <path>` (result ignored),
      `if (io.fileExists(path)) io.removeTree(path)`, `git worktree prune`,
      `git worktree add --detach --force <path> <sha>` → non-zero → `{ kind: 'infrastructure', reason }`;
      then each planned command through `io.runShell(command, { cwd: path, env: { RUNNER_CAMPAIGN_HOME: home, RUNNER_CARD_ID: cardId, RUNNER_TASK_ID: stepTaskId, RUNNER_BASE_SHA: card.baseSha ?? '', RUNNER_REPO: repoRoot }, timeoutMs: 600_000 })`,
      stopping at the first non-zero/timeout; map to `DoneCommandResult` with `tailOf`; `judgeDoneRun`;
      append every `doneRows(...)` row as one JSON line to `doneRecordPathOf(home, runId)` through
      `io.appendLog`; finally (serialized) `git worktree remove --force <path>`; return the verdict.
    - `recordPass(i, sha, branch)`: `applyPass`; set/delete `card.doneSha`; `card.branch ??= branch`;
      `card.updatedAt = io.now()`; `persistLocalState(state, resolved, io)`.
    - `finishShipped(result)`: the body of today's `sessionResult.outcome === 'shipped'` branch
      (`card.pr = …`, `recordBranchFromPr`, `verifyThenHealIfNeeded`, `shipCard` / `escalateCard`).
    - `escalate(reason, detail)`: `escalateCard(ctx, reason, detail)`.
  - Delete `CONTINUE_PR_OPEN_PROMPT`, `CONTINUE_BRANCH_PROMPT`, `CONTINUE_UNKNOWN_STATE_PROMPT` and
    fold `runCardSession` into `runTurn`.
  - `escalationOptionsSection`: `done_failed` →
    `['## Options', '- The work is not done yet: a ruling that clarifies the task helps the next attempt — append it to <answers path> and re-run with `--include-escalated`.', '- A Done command in the plan is wrong: fix the plan on the base branch through a PR, then re-run with `--include-escalated`.']`.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/loop.test.ts core/loop/card-actions.test.ts core/loop/turns.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): every card is driven through the turn loop; Done runs recorded in done.jsonl"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/loop.test.ts core/loop/card-actions.test.ts core/loop/turns.test.ts
! grep -n 'CONTINUE_PR_OPEN_PROMPT\|CONTINUE_BRANCH_PROMPT\|CONTINUE_UNKNOWN_STATE_PROMPT' plugins/tribe/scripts/runner/core/loop/card-actions.ts
```

Expected: every command exits 0.

### Task 2.10: The merge gate only accepts the commit the Done commands passed on

**Why:** spec §4.6 — prevention, not only detection: a merge of code the runner never checked is
blocked at the permission layer.

**Files:** modify `$R/core/merge-gate.ts`, `$R/core/merge-gate.test.ts`, `$R/core/session.ts`
(`decideMergeGateHook`), `$R/ports/ports.ts` (`SessionIO.currentDoneSha?`), `$R/core/session.test.ts`,
`$R/core/loop/card-actions.ts` (`buildSessionIOForCard` supplies `currentDoneSha: () => card.doneSha ?? null`),
`$T/render-prompts.ts` (new kind `executor/hook-merge-head-not-done`).

- [ ] **Step 1: Failing tests** — `merge-gate.test.ts`:

```ts
import { MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON } from './merge-gate.ts';
const green = { stdout: JSON.stringify([{ name: 'go', state: 'SUCCESS' }]), exitCode: 0 };
const parsed = { isMerge: true, prRef: '12' };
describe('merge gate — the Done commit (spec §4.6)', () => {
  test('checks green and PR head == doneSha -> allowed', () => {
    expect(buildMergeGateDecision({ parsed, checksExec: green, headSha: 'abc', doneSha: 'abc' })).toEqual({});
  });
  test('head differs from doneSha -> denied, steering to TASK_DONE', () => {
    const d = buildMergeGateDecision({ parsed, checksExec: green, headSha: 'new', doneSha: 'old' });
    expect(d.hookSpecificOutput?.permissionDecisionReason).toBe(MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON('new', 'old'));
    expect(d.hookSpecificOutput?.permissionDecisionReason).toContain('TASK_DONE');
  });
  test('no doneSha or an unreadable head -> denied (fail closed)', () => {
    expect(buildMergeGateDecision({ parsed, checksExec: green, headSha: 'abc', doneSha: null }).hookSpecificOutput).toBeDefined();
    expect(buildMergeGateDecision({ parsed, checksExec: green, headSha: null, doneSha: 'abc' }).hookSpecificOutput).toBeDefined();
  });
  test('a red check still denies first, with the not-green reason', () => {
    const red = { stdout: JSON.stringify([{ name: 'go', state: 'FAILURE' }]), exitCode: 0 };
    expect(buildMergeGateDecision({ parsed, checksExec: red, headSha: 'abc', doneSha: 'abc' }).hookSpecificOutput?.permissionDecisionReason).toContain('not all checks');
  });
});
```

  `session.test.ts`: `decideMergeGateHook` with an `execInRepo` that answers `gh pr checks` green and
  `gh pr view 12 --json headRefOid` with `{"headRefOid":"abc"}`, and `currentDoneSha: () => 'abc'` →
  `{}`; with `() => 'zzz'` → denied. Run both files. Expected: FAIL.

- [ ] **Step 2: Implement** — `MergeGateDecisionInput` gains `headSha?: string | null; doneSha?: string | null`
  (optional so the forbidden-flag path still needs neither). After the checks-green branch of
  `buildMergeGateDecision`: `if (!input.headSha || !input.doneSha || input.headSha !== input.doneSha) return deny(MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON(input.headSha ?? null, input.doneSha ?? null));` with

```ts
export function MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON(headSha: string | null, doneSha: string | null): string {
  return (
    `Merge denied: the PR head (${headSha ?? 'unreadable'}) is not the commit whose Done commands the runner last ` +
    `passed (${doneSha ?? 'none yet'}). End your turn with \`TASK_DONE <last-task-id> <branch>\` so the runner ` +
    're-runs the Done commands on your latest commit, then merge when it sends you back to delivery.'
  );
}
```

  In `decideMergeGateHook`, after `gh pr checks` also run
  `['gh', 'pr', 'view', ...(prRef ? [prRef] : []), '--json', 'headRefOid']` and parse `headRefOid`
  (a non-zero exit or unparseable JSON → `null`); pass `doneSha: io.currentDoneSha?.() ?? null`.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/merge-gate.test.ts core/session.test.ts core/loop.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): the merge gate only accepts the commit the Done commands passed on"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/merge-gate.test.ts core/session.test.ts core/loop.test.ts
```

Expected: every command exits 0.

### Task 2.11: The final gate checks the merged head was the Done commit — `doneAtHead`

**Why:** spec §4.7 — a merge that bypassed the hook (`gh api -X PUT …/merge`, the web UI) must still
fail verification, and a card with no passing Done run can never verify (G5 at the final gate).

**Files:** modify `$R/core/verify.ts` (`checkMerged` also returns `headSha` from the same `gh api`
response; new `checkDoneAtHead`), `$R/core/verify.test.ts`, `$R/core/loop/card-actions.ts` (bullet),
`$R/core/loop.test.ts` (`cleanCommitAndVerifyHandlers`' `gh api` answer gains `head: { sha: 'basesha0' }`, and so
does every other `gh api …/pulls/<pr>` handler in that file — a fixture change, no assertion changes),
`$T/g3-verify-replay.ts` (only if it no longer compiles).

- [ ] **Step 1: Failing tests** — `verify.test.ts`: `buildIo`'s `gh api` answer gains
  `head: { sha: opts.headSha ?? 'donesha1' }`; `fixtureCard` gains `doneSha: 'donesha1'` and a task
  with `passedSha: 'donesha1'`. Tests:

```ts
describe('doneAtHead (spec §4.7)', () => {
  test('merged head == card.doneSha -> passes', async () => {
    const r = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo(), 'C1');
    expect(r.points.find((p) => p.id === 'doneAtHead')?.passed).toBe(true);
  });
  test('merged head differs -> fails and names both commits', async () => {
    const r = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ headSha: 'other' }), 'C1');
    const p = r.points.find((x) => x.id === 'doneAtHead');
    expect(p?.passed).toBe(false);
    expect(p?.detail).toContain('other');
    expect(p?.detail).toContain('donesha1');
  });
  test('a card with no passing Done run can never verify', async () => {
    const r = await verifyShipped(fixtureCard({ doneSha: undefined }), fixtureConfig(), buildIo(), 'C1');
    expect(r.points.find((x) => x.id === 'doneAtHead')?.passed).toBe(false);
    expect(r.shipped).toBe(false);
  });
});
```

  and the id-list test gains `'doneAtHead'` last. Run `cd $R && bun test core/verify.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `checkMerged` parses `head?.sha` into a returned `headSha`;

```ts
/** Spec §4.7: the merged PR's head must be the commit at which the runner last passed every task's
 * Done commands — whatever route the merge took. No doneSha means no Done run ever passed. */
function checkDoneAtHead(card: Card, headSha: string | null): VerifyPointResult {
  const id = 'doneAtHead' as const;
  if (!card.doneSha) return { id, passed: false, detail: 'no passing Done run is recorded for this card (doneSha is unset)' };
  if (!headSha) return { id, passed: false, detail: `the merged PR's head commit could not be read; cannot compare it with ${card.doneSha}` };
  return headSha === card.doneSha
    ? { id, passed: true, detail: `the merged head ${headSha} is the commit the Done commands passed on` }
    : { id, passed: false, detail: `the merged head ${headSha} is not the commit the Done commands passed on (${card.doneSha})` };
}
```

  append it last in `verifyShipped`; `VerifyPointId` gains `'doneAtHead'`; `VERIFY_FAILURE_BULLETS`
  gains `doneAtHead: '- doneAtHead: the PR merged a commit the runner never ran the Done commands on. Revert or verify by hand, re-run the Done commands, and record a ruling before re-running.'`.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/verify.test.ts core/loop.test.ts core/loop/card-actions.test.ts`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): the final gate checks the merged head is the Done commit"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/verify.test.ts core/loop.test.ts core/loop/card-actions.test.ts
grep -q "'doneAtHead'" plugins/tribe/scripts/runner/core/verify.ts
```

Expected: every command exits 0.

### Task 2.12: The executor brief explains the turns; the renderer covers every AFTER prompt kind

**Why:** spec §4.8 — the session must know it is driven task by task, that the runner runs the Done
commands, and the three terminal lines; V1's positive half needs every AFTER kind rendered.

**Files:** modify `$R/core/brief-template.md`, `$R/core/brief.ts` (`BriefCard.tasks`, new vars),
`$R/core/brief.test.ts`, `$R/core/loop/card-actions.ts` (callers), `$T/render-prompts.ts`.

**Changed existing assertions (named):** `brief.test.ts` — the snapshot test's `EXPECTED_BRIEF`
(replaced by the new template rendered for its fixture); `states the Definition of Done
preconditions for SHIPPED` (the DoD section is now the deliver step; the test asserts the four
numbered preconditions still appear before `## Terminal contract`).

- [ ] **Step 1: Failing tests** — `brief.test.ts`:

```ts
test('spec §4.8: the brief lists the tasks and states the turn rule, the runner-run Done, and three terminal lines', () => {
  const rendered = executorBrief(
    { id: 'C1', spec: 's.md', plan: 'p.md', tasks: [{ id: 'T1', heading: 'Task 1: a' }, { id: 'T2', heading: 'Task 2: b' }] },
    FIXTURE_STATE, '', readFileSync(BRIEF_TEMPLATE_PATH, 'utf8'), '/home/c', 'camp',
    { repoRoot: '/repo', baseBranch: 'master', remote: 'origin' },
  );
  for (const s of ['## How the runner drives you', '- T1 — Task 1: a', '- T2 — Task 2: b',
    'from a clean checkout of your branch tip', 'After 3 unaccepted turns on one task',
    '`TASK_DONE <task-id> <branch>`', '`SHIPPED <pr> <sha>`', '`NEEDS_DIRECTION: <question>`',
    'never switch the branch of, stage in, or commit in /repo', 'the commit whose Done commands the runner last passed']) {
    expect(rendered).toContain(s);
  }
  expect(countTribeMentions(rendered)).toEqual([]);
});
```

  Run `cd $R && bun test core/brief.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `brief-template.md` (Task 1.8's text plus):
  - after `## Goal`, a new section:

```markdown
## How the runner drives you

The runner walks the plan's tasks in order, one turn per task:

{{TASK_LIST}}

- Each turn names ONE task (see `## This turn` at the end). Do that task the way the plan says,
  commit it on your card branch, and end your turn with exactly `TASK_DONE <task-id> <branch>`.
- The runner then runs that task's **Done** commands itself — together with the Done commands of
  every task before it — from a clean checkout of your branch tip. A task is done only when every
  one of those commands exits 0. You may run them yourself first; the runner's run is the one
  that counts.
- If a Done command fails, the next turn shows you the command, its exit code and its output. Fix
  it, commit, and end your turn with `TASK_DONE` again. After {{MAX_STEP_ATTEMPTS}} unaccepted
  turns on one task the runner escalates the card.
- When every task is done, the runner sends one more turn: deliver the card (Definition of Done).
```

  - in `## Walls`, add: "- Work on your own card branch in a separate git worktree; never switch the
    branch of, stage in, or commit in {{REPO_ROOT}} itself — the runner reads the plan there." and
    extend the merge-gate bullet: "…and the PR head must be the commit whose Done commands the
    runner last passed; a merge attempt otherwise is blocked at the permission layer."
  - `## Definition of Done` becomes "(the deliver turn)": the five steps of `deliverTurnPrompt`
    (push, PR against {{BASE_BRANCH}}, checks green in the foreground, `gh pr merge --merge`,
    remote branch deleted, worktree removed, local {{BASE_BRANCH}} in {{REPO_ROOT}} fast-forwarded to
    {{REMOTE}}/{{BASE_BRANCH}}), and "If you change any code during delivery, commit and push it, and
    end the turn with `TASK_DONE <last-task-id> <branch>` so the runner re-runs the Done commands".
  - `## Terminal contract`: "End every turn with EXACTLY one of:" `TASK_DONE <task-id> <branch>` (the
    named task is committed on `<branch>`), `SHIPPED <pr> <sha>` (the deliver turn only, after the
    merge, with the merge commit sha), `NEEDS_DIRECTION: <question>`.
  `brief.ts`: `BriefCard` gains `tasks: Array<{ id: string; heading: string }>`; `executorBrief`
  gains a last parameter `driver: { repoRoot: string; baseBranch: string; remote: string }`; vars
  `TASK_LIST` (`- <id> — <heading>` per line), `MAX_STEP_ATTEMPTS` (from `core/done.ts`),
  `REPO_ROOT`, `BASE_BRANCH`, `REMOTE`. `toBriefCard` passes `card.tasks`; callers pass
  `{ repoRoot: resolved.repoRoot, baseBranch: resolved.baseBranch, remote: resolved.remote }`.
  `$T/render-prompts.ts` — render the AFTER inventory (spec §6.1) from the fixture's four tasks
  (`FIXTURE.firstTaskHeading`, `FIXTURE.secondTaskHeading`, and `Task 3: \`textx.Reverse\``,
  `Task 4: \`textx.IsPalindrome\`` with the fixture plan's Done commands):
  `executor/brief-fresh` = brief + `\n\n` + `taskTurnPrompt(T1)`; `executor/brief-with-digest` =
  the same with the digest (incl. `progressDigestLines`) in the answers slot;
  `executor/turn-task` = `taskTurnPrompt(T2)`; `executor/turn-done-failed` = `doneFailedTurnPrompt`
  for T1 with failing command `FIXTURE.failingCommand`; `executor/turn-protocol-error` =
  `protocolErrorTurnPrompt` over the T1 prompt; `executor/turn-deliver`; `executor/hook-merge-head-not-done`
  = `MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON('new1234', 'old5678')`; `escalation/done-failed` =
  `buildEscalationMarkdown(CARD_ID, 'done_failed', DETAIL, resolved)` with
  `DETAIL = 'task T1 (' + FIXTURE.firstTaskHeading + ') did not pass its Done commands after 3 attempts. Last: ' + FIXTURE.failingCommand + ' exited 1'`;
  drop the three `executor/resume-*` kinds (their prompts no longer exist).

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/brief.test.ts core/loop.test.ts`;
  `bun $T/render-prompts.ts --out /tmp/rdo-2-12 && bun $T/g2-prompts.ts --render-dir /tmp/rdo-2-12 | grep -E '^(MISSING_REQUIRED_KINDS=0|ESSENTIALS_MISSING)'`.
  Expected: 0 fail; `MISSING_REQUIRED_KINDS=0` and no `ESSENTIALS_MISSING` line.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner): the brief explains the turns; the V1 renderer covers every prompt kind"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/brief.test.ts core/loop.test.ts
bun plugins/tribe/scripts/tests/runner-driver-only/render-prompts.ts --out /tmp/rdo-done-2-12
bun plugins/tribe/scripts/tests/runner-driver-only/g2-prompts.ts --render-dir /tmp/rdo-done-2-12 | grep -q '^MISSING_REQUIRED_KINDS=0'
! bun plugins/tribe/scripts/tests/runner-driver-only/g2-prompts.ts --render-dir /tmp/rdo-done-2-12 | grep -q '^ESSENTIALS_MISSING'
```

Expected: every command exits 0.

### Task 2.13: The executor session double (test seam for G5 and V3)

**Why:** spec §4.12 — run the real CLI, real git and real Done commands with only the LLM replaced,
exactly as `TRIBE_SUPERVISOR_SESSION_DOUBLE` already does for the supervisor.

**Files:** create `$R/adapters/executor-double.adapter.ts`, `$R/adapters/executor-double.adapter.test.ts`,
`$R/fixtures/executor/session-double.sh`; modify `$R/cli/main.ts` (wire the env var).

- [ ] **Step 1: Failing test** — `executor-double.adapter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnExecutorDouble } from './executor-double.adapter.ts';

const dir = mkdtempSync(join(tmpdir(), 'rdo-exec-double-'));
const script = join(dir, 'double.sh');
writeFileSync(script, '#!/usr/bin/env bash\nset -euo pipefail\nwhile [[ $# -gt 0 ]]; do case "$1" in --prompt-file) f="$2"; shift 2;; *) shift;; esac; done\nhead -1 "$f" | sed "s/^## This turn: task \\([^ ]*\\).*/TASK_DONE \\1 b/"\n');
chmodSync(script, 0o755);
const params = (resume?: string) => ({ prompt: '## This turn: task T4 — x\nbody', options: { resume } as never });

describe('spawnExecutorDouble', () => {
  test('yields init then a success result whose text is the script stdout', async () => {
    const msgs = [];
    for await (const m of spawnExecutorDouble(script, '/home', params())) msgs.push(m);
    expect(msgs[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(msgs[1]).toMatchObject({ type: 'result', subtype: 'success', result: 'TASK_DONE T4 b' });
  });
  test('a resumed turn keeps the resumed session id', async () => {
    const msgs = [];
    for await (const m of spawnExecutorDouble(script, '/home', params('sess-9'))) msgs.push(m);
    expect(msgs[0]).toMatchObject({ session_id: 'sess-9' });
  });
  test('a non-zero exit throws (consumeSession turns it into a typed error)', async () => {
    const failing = join(dir, 'fail.sh');
    writeFileSync(failing, '#!/usr/bin/env bash\nexit 3\n');
    chmodSync(failing, 0o755);
    await expect((async () => { for await (const _ of spawnExecutorDouble(failing, '/home', params())) { /* drain */ } })()).rejects.toThrow(/exited 3/);
  });
});
```

  Run `cd $R && bun test adapters/executor-double.adapter.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `executor-double.adapter.ts`:

```ts
// adapters/executor-double.adapter.ts — card runner-driver-only (spec §4.12): the composition root's
// executor-session double. `TRIBE_RUNNER_SESSION_DOUBLE=<script>` swaps the SDK spawn for a scripted
// process so the hermetic E2Es (V3, G5) drive the REAL runner, git and Done commands with only the
// LLM replaced. Unset (every production run) -> nothing changes. Mirrors session-double.adapter.ts.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionMessage, SpawnSessionParams } from '../core/session.ts';

const DOUBLE_ENV_VAR = 'TRIBE_RUNNER_SESSION_DOUBLE';
const DOUBLE_TIMEOUT_MS = 120_000; // fail-closed-edges obligation 3: a wedged double never hangs a run

export function executorDoubleScriptPath(): string | null {
  const raw = process.env[DOUBLE_ENV_VAR];
  return raw === undefined || raw === '' ? null : raw;
}

export async function* spawnExecutorDouble(
  scriptPath: string, homeDir: string, params: SpawnSessionParams, timeoutMs: number = DOUBLE_TIMEOUT_MS,
): AsyncGenerator<SessionMessage> {
  const sessionId = params.options.resume ?? `double-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = mkdtempSync(join(tmpdir(), 'rdo-double-'));
  const promptFile = join(dir, 'prompt.md');
  writeFileSync(promptFile, params.prompt);
  try {
    const { code, stdout } = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const child = spawn(scriptPath, ['--home', homeDir, '--prompt-file', promptFile], {
        stdio: ['ignore', 'pipe', 'inherit'], env: process.env, timeout: timeoutMs, killSignal: 'SIGKILL',
      });
      let out = '';
      child.stdout?.on('data', (c: Buffer) => (out += c.toString()));
      child.on('error', reject);
      child.on('exit', (c, signal) => resolve({ code: c ?? (signal !== null ? 128 : 1), stdout: out }));
    });
    if (code !== 0) throw new Error(`executor session double "${scriptPath}" exited ${code}`);
    yield { type: 'system', subtype: 'init', session_id: sessionId };
    yield { type: 'result', subtype: 'success', session_id: sessionId, result: stdout.trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

  In `cli/main.ts`, after `const io = buildRealIo(parsed.config)`:
  `const executorDouble = executorDoubleScriptPath(); if (executorDouble !== null) io.spawnSession = (params) => spawnExecutorDouble(executorDouble, parsed.config.homeDir, params);`.
  `$R/fixtures/executor/session-double.sh` (mode by `DOUBLE_MODE`; `chmod +x`):

```bash
#!/usr/bin/env bash
# Executor session double (card runner-driver-only, spec §4.12). Reads the runner's prompt, acts on
# DOUBLE_REPO according to DOUBLE_MODE, prints ONE terminal line. Env: DOUBLE_MODE (do-nothing |
# premature-shipped | implement), DOUBLE_REPO, DOUBLE_BRANCH, DOUBLE_LOG (optional turn log).
set -euo pipefail
prompt_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file) prompt_file="$2"; shift 2 ;;
    --home) shift 2 ;;
    *) shift ;;
  esac
done
[[ -f "$prompt_file" ]] || { echo "session-double: --prompt-file missing" >&2; exit 2; }
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
task="$(sed -n 's/^## This turn: task \([^ ]*\).*/\1/p' "$prompt_file" | head -1)"
printf 'turn task=%s mode=%s\n' "${task:-deliver}" "$DOUBLE_MODE" >> "${DOUBLE_LOG:-/dev/null}"
g() { git -C "$1" -c user.name=double -c user.email=double@invalid "${@:2}"; }
case "$DOUBLE_MODE" in
  do-nothing)
    g "$DOUBLE_REPO" rev-parse --verify --quiet "refs/heads/$DOUBLE_BRANCH" >/dev/null || g "$DOUBLE_REPO" branch "$DOUBLE_BRANCH" HEAD
    echo "TASK_DONE ${task:-T1} $DOUBLE_BRANCH" ;;
  premature-shipped)
    echo "SHIPPED 1 0000000" ;;
  implement)
    wt="$DOUBLE_REPO.double-wt"
    [[ -d "$wt" ]] || g "$DOUBLE_REPO" worktree add -q -b "$DOUBLE_BRANCH" "$wt" HEAD
    mkdir -p "$wt/mathx"
    printf 'package mathx\n\n// Double returns 2*x.\nfunc Double(x int) int { return 2 * x }\n' > "$wt/mathx/double.go"
    printf 'package mathx\n\nimport "testing"\n\nfunc TestDouble(t *testing.T) {\n\tif Double(3) != 6 {\n\t\tt.Fatal("Double(3) != 6")\n\t}\n}\n' > "$wt/mathx/double_test.go"
    g "$wt" add -A
    g "$wt" commit -q -m "feat(mathx): Double" >/dev/null 2>&1 || true   # a later turn has nothing new to commit; stdout carries only the terminal line
    echo "TASK_DONE ${task:-T1} $DOUBLE_BRANCH" ;;
  *) echo "session-double: unknown DOUBLE_MODE=${DOUBLE_MODE:-}" >&2; exit 2 ;;
esac
```

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test adapters/executor-double.adapter.test.ts`;
  `bash -n $R/fixtures/executor/session-double.sh`. Expected: 0 fail; no syntax error.

- [ ] **Step 4: Commit** — `git add -A plugins/tribe/scripts/runner && git commit -m "test(runner): executor session double for the hermetic Done E2Es"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test adapters/executor-double.adapter.test.ts
bash -n plugins/tribe/scripts/runner/fixtures/executor/session-double.sh
test -x plugins/tribe/scripts/runner/fixtures/executor/session-double.sh
```

Expected: every command exits 0.

### Task 2.14: V3 negative control — a failing Done command is never marked done

**Why:** the Shaman's V3: "A fixture task whose Done command fails. Pass: the runner does not mark it
done and escalates. A runner that never runs Done passes V2 but fails V3." Hermetic (spec §6.4):
shell-only Done commands, so the test needs no Go toolchain.

**Files:** create `plugins/tribe/scripts/tests/lib-runner-e2e.sh` (the shared harness Tasks 2.15 and
2.16 reuse) and `plugins/tribe/scripts/tests/test-runner-done-negative.sh`.

- [ ] **Step 1: Write the harness** — `plugins/tribe/scripts/tests/lib-runner-e2e.sh`:

````bash
#!/usr/bin/env bash
# lib-runner-e2e.sh — the hermetic runner E2E harness (card runner-driver-only, spec §6.4). Sourced,
# never run. Builds its world from nothing (fixtures-mirror-reality rule 2): a bare `origin`, a clone
# holding one spec and one plan, and a v2 campaign home — then runs the REAL run.ts. Offline: every
# path these tests drive escalates or refuses before a PR could exist, so no `gh` call is made.
set -euo pipefail
RDO_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$RDO_HERE/../runner"
DOUBLE="$RUNNER/fixtures/executor/session-double.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TMP/repo.double-wt"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
bounded() { perl -e 'alarm shift; exec @ARGV or die "exec: $!"' 300 "$@"; }

# rdo_world <plan-file-name> — reads the plan's markdown on stdin; commits it under docs/plans/ with a
# one-line spec under docs/specs/, pushes master, and points origin/HEAD at it.
rdo_world() {
  git init -q --bare -b master "$TMP/origin.git"
  git clone -q "$TMP/origin.git" "$TMP/repo" 2>/dev/null
  mkdir -p "$TMP/repo/docs/plans" "$TMP/repo/docs/specs"
  cat > "$TMP/repo/docs/plans/$1"
  printf '# Spec\n\nSee the plan.\n' > "$TMP/repo/docs/specs/$1"
  local g=(git -C "$TMP/repo" -c user.name=fixture -c user.email=fixture@invalid)
  "${g[@]}" add -A; "${g[@]}" commit -q -m start; "${g[@]}" push -q origin master; "${g[@]}" remote set-head origin master
}

# rdo_home <home-dir> <plan-file-name> <task-heading> — a v2 state with one card C1 and one task T1.
rdo_home() {
  mkdir -p "$1"; : > "$1/answers.md"
  python3 -c 'import json,sys; home,plan,heading=sys.argv[1:4]; json.dump({"v":2,"campaign":"e2e","mergePolicy":"regular","sequence":["C1"],"schemaLockPaths":[],"docsOnlyPaths":[],"ownerOnlyEscalations":[],"cards":{"C1":{"status":"staged","spec":"docs/specs/"+plan,"plan":"docs/plans/"+plan,"branch":None,"baseSha":None,"pr":None,"mergeSha":None,"sessionId":None,"updatedAt":None,"tasks":[{"id":"T1","heading":heading}]}}}, open(home+"/campaign-state.json","w"), indent=2)' "$1" "$2" "$3"
}

# rdo_card <home-dir> <python-expression over c> — reads card C1 from the home's state.
rdo_card() { python3 -c 'import json,sys; c=json.load(open(sys.argv[1]+"/campaign-state.json"))["cards"]["C1"]; print(eval(sys.argv[2]))' "$1" "$2"; }

# rdo_done_runs <home-dir> — "<failed> <total>" done_run rows across every run of that home.
rdo_done_runs() { cat "$1"/runs/*/done.jsonl 2>/dev/null | python3 -c 'import json,sys; r=[json.loads(l) for l in sys.stdin if l.strip()]; d=[x for x in r if x["kind"]=="done_run"]; print(sum(1 for x in d if x["passed"] is False), len(d))'; }

rdo_finish() { printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"; if [[ "$FAIL" == "0" ]]; then echo "$1=PASS"; else echo "$1=FAIL"; exit 1; fi; }
````

- [ ] **Step 2: Write the E2E** — `plugins/tribe/scripts/tests/test-runner-done-negative.sh`:

````bash
#!/usr/bin/env bash
# test-runner-done-negative.sh — V3 (card runner-driver-only, spec §6.4): a task whose Done command
# fails is never marked done, and the card escalates done_failed. The executor double (`implement`)
# writes a real mathx.Double + TestDouble; the plan's Done demands a TestTriple no task writes.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-runner-e2e.sh"
rdo_world double.md <<'EOF'
# Plan — mathx.Double

### Task 1: `mathx.Double`

Write `mathx/double.go` and its test.

#### Done

```bash
test -f mathx/double.go
grep -q 'func TestTriple' mathx/double_test.go
```
EOF
HOME_DIR="$TMP/home"
rdo_home "$HOME_DIR" double.md 'Task 1: `mathx.Double`'
set +e
TRIBE_RUNNER_SESSION_DOUBLE="$DOUBLE" DOUBLE_MODE=implement DOUBLE_REPO="$TMP/repo" DOUBLE_BRANCH=double/C1 DOUBLE_LOG="$TMP/double.log" \
  bounded bun "$RUNNER/run.ts" --repo "$TMP/repo" --model double --home "$HOME_DIR" --no-viewer > "$TMP/runner.out" 2>&1
code=$?
set -e
check "V3: the runner exits 2 (an escalation is pending)" "$code" "2"
check "V3: the escalation reason is done_failed" "$(sed -n 's/^\*\*Reason:\*\* //p' "$HOME_DIR/escalations/C1.md" 2>/dev/null)" "done_failed"
check "V3: the card is escalated, never shipped" "$(rdo_card "$HOME_DIR" 'c["status"]')" "escalated"
check "V3: T1 carries no passedSha" "$(rdo_card "$HOME_DIR" '"passedSha" in c["tasks"][0]')" "False"
check "V3: the card carries no doneSha" "$(rdo_card "$HOME_DIR" '"doneSha" in c')" "False"
check "V3: three Done runs, all failed" "$(rdo_done_runs "$HOME_DIR")" "3 3"
check "V3: the failing command ran in the runner's hands and exited non-zero" \
  "$(cat "$HOME_DIR"/runs/*/done.jsonl | python3 -c 'import json,sys; r=[json.loads(l) for l in sys.stdin if l.strip()]; g=[x for x in r if x["kind"]=="command" and x["command"].startswith("grep -q")]; print(len(g)==3 and all(x["exitCode"]!=0 for x in g))')" "True"
check "V3: the double was asked for T1 three times" "$(grep -c 'turn task=T1' "$TMP/double.log")" "3"
check "V3: nothing but master reached the origin" "$(git -C "$TMP/origin.git" for-each-ref --format='%(refname)' refs/heads | tr '\n' ' ')" "refs/heads/master "
if [[ -n "${RDO_EVIDENCE_DIR:-}" ]]; then
  cp "$HOME_DIR/escalations/C1.md" "$RDO_EVIDENCE_DIR/v3-escalation.md"
  cat "$HOME_DIR"/runs/*/done.jsonl > "$RDO_EVIDENCE_DIR/v3-done.jsonl"
  cp "$HOME_DIR/campaign-state.json" "$RDO_EVIDENCE_DIR/v3-final-state.json"
  cp "$TMP/runner.out" "$RDO_EVIDENCE_DIR/v3-runner.out"
fi
rdo_finish V3
````

- [ ] **Step 3: Run it** — `bash plugins/tribe/scripts/tests/test-runner-done-negative.sh`.
  Expected: `9 passed, 0 failed` and `V3=PASS`. (It cannot pass a runner that skips the Done run:
  that runner marks T1 passed and reaches delivery, failing the first six checks.)

- [ ] **Step 4: Commit** — `chmod +x plugins/tribe/scripts/tests/test-runner-done-negative.sh && git add plugins/tribe/scripts/tests/lib-runner-e2e.sh plugins/tribe/scripts/tests/test-runner-done-negative.sh && git commit -m "test(runner): V3 negative control — a failing Done command escalates done_failed"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
bash plugins/tribe/scripts/tests/test-runner-done-negative.sh
```

Expected: every command exits 0; the output ends with `V3=PASS`.

### Task 2.15: G5 — a session that does nothing, or claims `SHIPPED` early, never ships

**Why:** card G5 — "a run whose sessions do nothing fails G1 (Done commands fail) even though G2
reads 0". Two doubles: `do-nothing` (branch at the base, `TASK_DONE` every turn) and
`premature-shipped` (`SHIPPED 1 0000000` every turn).

**Files:** create `plugins/tribe/scripts/tests/test-runner-done-empty.sh`.

- [ ] **Step 1: Write the E2E** —

````bash
#!/usr/bin/env bash
# test-runner-done-empty.sh — G5 (card runner-driver-only, spec §6.4): an empty session (do-nothing)
# and a lying one (premature-shipped) never ship; both escalate done_failed.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-runner-e2e.sh"
rdo_world sum.md <<'EOF'
# Plan — mathx.Sum

### Task 1: `mathx.Sum`

#### Done

```bash
test -f mathx/sum.go
grep -q 'func TestSum' mathx/sum_test.go
```
EOF
for mode in do-nothing premature-shipped; do
  HOME_DIR="$TMP/home-$mode"
  rdo_home "$HOME_DIR" sum.md 'Task 1: `mathx.Sum`'
  set +e
  TRIBE_RUNNER_SESSION_DOUBLE="$DOUBLE" DOUBLE_MODE="$mode" DOUBLE_REPO="$TMP/repo" DOUBLE_BRANCH="double/$mode" DOUBLE_LOG="$TMP/double-$mode.log" \
    bounded bun "$RUNNER/run.ts" --repo "$TMP/repo" --model double --home "$HOME_DIR" --no-viewer > "$TMP/runner-$mode.out" 2>&1
  code=$?
  set -e
  check "G5 $mode: runner exits 2" "$code" "2"
  check "G5 $mode: escalated done_failed" "$(sed -n 's/^\*\*Reason:\*\* //p' "$HOME_DIR/escalations/C1.md" 2>/dev/null)" "done_failed"
  check "G5 $mode: never shipped" "$(rdo_card "$HOME_DIR" 'c["status"]')" "escalated"
  check "G5 $mode: no doneSha" "$(rdo_card "$HOME_DIR" '"doneSha" in c')" "False"
done
check "G5 do-nothing: the Done commands ran and failed three times" "$(rdo_done_runs "$TMP/home-do-nothing")" "3 3"
check "G5 premature-shipped: no Done run at all (no task was ever reported)" "$(rdo_done_runs "$TMP/home-premature-shipped")" "0 0"
check "G5 premature-shipped: the escalation names the early SHIPPED" "$(grep -c 'SHIPPED arrived before every task passed' "$TMP/home-premature-shipped/escalations/C1.md")" "1"
rdo_finish G5
````

- [ ] **Step 2: Run it** — `bash plugins/tribe/scripts/tests/test-runner-done-empty.sh`. Expected:
  `11 passed, 0 failed` and `G5=PASS`.

- [ ] **Step 3: Commit** — `chmod +x plugins/tribe/scripts/tests/test-runner-done-empty.sh && git add plugins/tribe/scripts/tests/test-runner-done-empty.sh && git commit -m "test(runner): G5 — an empty or lying session never ships"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
bash plugins/tribe/scripts/tests/test-runner-done-empty.sh
```

Expected: every command exits 0; the output ends with `G5=PASS`.

### Task 2.16: V6 — a dangling task ref is refused at load, by the real CLI

**Why:** D1 / the Shaman's V6. MEASURED baseline: master dry-runs the same state as `fresh`
(`$E/v6-before-dry-run.txt`).

**Files:** create `plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh`.

- [ ] **Step 1: Write the E2E** —

````bash
#!/usr/bin/env bash
# test-runner-task-index-refusal.sh — V6 (card runner-driver-only, spec §6.4): a state whose task ref
# names a heading the plan does not have is refused at load — by --dry-run and by a real run — before
# any session spawns, and nothing is written into the state.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-runner-e2e.sh"
rdo_world sum.md <<'EOF'
# Plan — mathx.Sum

### Task 1: `mathx.Sum`

#### Done

```bash
test -f mathx/sum.go
```
EOF
HOME_DIR="$TMP/home"
rdo_home "$HOME_DIR" sum.md 'Task 9: nowhere'
printf '#!/usr/bin/env bash\ntouch "%s/SPAWNED"\necho "TASK_DONE T1 x"\n' "$TMP" > "$TMP/marker-double.sh"
chmod +x "$TMP/marker-double.sh"
before="$(shasum "$HOME_DIR/campaign-state.json")"
for flag in --dry-run --real-run; do
  args=(); [[ "$flag" == "--dry-run" ]] && args=(--dry-run)
  set +e
  TRIBE_RUNNER_SESSION_DOUBLE="$TMP/marker-double.sh" bounded bun "$RUNNER/run.ts" --repo "$TMP/repo" --model double --home "$HOME_DIR" --no-viewer ${args[@]+"${args[@]}"} > "$TMP/out" 2> "$TMP/err"
  code=$?
  set -e
  check "V6 $flag: exit 4" "$code" "4"
  for needle in 'campaign runner: refused:' 'card C1' 'task T1' 'Task 9: nowhere' 'dangling_heading'; do
    check "V6 $flag: stderr names '$needle'" "$(grep -c -- "$needle" "$TMP/err")" "1"
  done
  if [[ -n "${RDO_EVIDENCE_DIR:-}" ]]; then cp "$TMP/err" "$RDO_EVIDENCE_DIR/v6-refusal${flag}.txt"; fi
done
check "V6: no session was ever spawned" "$([[ -e "$TMP/SPAWNED" ]] && echo yes || echo no)" "no"
check "V6: the state file is byte-identical" "$(shasum "$HOME_DIR/campaign-state.json")" "$before"
check "V6: no escalation was written" "$(ls "$HOME_DIR/escalations" 2>/dev/null | wc -l | tr -d ' ')" "0"
rdo_finish V6
````

  (`${args[@]+"${args[@]}"}` is the empty-array-safe expansion under `set -u` on macOS's bash 3.2.)

- [ ] **Step 2: Run it** — `bash plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh`.
  Expected: `15 passed, 0 failed` and `V6=PASS`.

- [ ] **Step 3: Commit** — `chmod +x plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh && git add plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh && git commit -m "test(runner): V6 — a dangling task ref is refused at load"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
bash plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh
```

Expected: every command exits 0; the output ends with `V6=PASS`.

### Task 2.17: The orchestrate-campaign skill authors the v2 state and Done-complete plans

**Why:** after this PR the runner refuses v1 states and plans without Done sections; the skill that
authors them must say so in the same PR (governance per phase). Plan styles come in Task 3.8.

**Files:** modify `plugins/tribe/skills/orchestrate-campaign/SKILL.md` (Stage A state example and its
bullets; one new Stage A rule).

- [ ] **Step 1: Edit** — the state example becomes `"v": 2` and each card gains
  `"tasks": [{ "id": "T1", "heading": "<the exact heading text of the plan's first task>" }]`; add to
  Stage A: "**Every plan task ends with a Done section** — a `Done` heading one level below the task
  heading, then a fenced block of shell commands, one per line (no `\` continuations). The runner runs
  them itself from a clean checkout of the task's commit, so list any bootstrap (`bun install`) first.
  For every task, add `{ "id", "heading" }` to the card's `tasks` in `campaign-state.json` — the
  heading text exactly as written. `--dry-run` refuses a state whose headings do not resolve
  (`campaign runner: refused: … dangling_heading`)."

- [ ] **Step 2: Verify** — `grep -n '"v": 2' plugins/tribe/skills/orchestrate-campaign/SKILL.md`;
  `bash plugins/tribe/scripts/tests/test-watchdog-detached.sh`; `cd $R && bun test core/supervisor/brief.test.ts`
  (the W3/W7/Stage D quotes are untouched). Expected: the grep matches; 0 fail each.

- [ ] **Step 3: Commit** — `git commit -am "docs(orchestrate-campaign): author the v2 task index and a Done section per task"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
grep -q '"v": 2' plugins/tribe/skills/orchestrate-campaign/SKILL.md
grep -q 'Every plan task ends with a Done section' plugins/tribe/skills/orchestrate-campaign/SKILL.md
bash plugins/tribe/scripts/tests/test-watchdog-detached.sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/brief.test.ts
```

Expected: every command exits 0.

### Task 2.18: PR 2 governance — README, C3, full suites, V1 ratchet

**Files:** modify `$R/README.md`, `.c3/` (change unit on `c3-215`), create `$E/v1-pr2-prompts.txt`.

- [ ] **Step 1: README** — rewrite "State file schema" for v2 (`tasks`, `passedSha`, `doneSha`; the
  v1 refusal; the task-id grammar), add `TaskIndexError` to "Validation errors" (collected, `refused:`,
  exit 4, `--dry-run` too), add a section "Turns and the Done run" (spec §4.4–§4.5: the step order,
  the three terminal lines, the 3-attempt budget, the scratch worktree `<home>/done/<card>`, the
  cumulative deduplicated command set, the five `RUNNER_*` variables, `done.jsonl`), extend "Run
  record" with `done.jsonl`, "Resume semantics" with the next-step prompts and progress in the digest,
  the merge-gate paragraph with the Done commit, the done-check section with `doneAtHead`, and
  "Session options" with `TRIBE_RUNNER_SESSION_DOUBLE`. `--session-timeout` now bounds one turn.

- [ ] **Step 2: C3** — a change unit (ADR "runner-driver-only PR 2: the plan drives") patching
  `c3-215`'s runner Contract row (v2 state, turns, Done run) and its Change-Safety row for
  `verify.ts`/`card-actions.ts` (name `test-runner-done-negative.sh`, `test-runner-done-empty.sh`,
  `test-runner-task-index-refusal.sh` as the required verification); apply in this commit.

- [ ] **Step 3: Suites and V1** — `cd $R && bun run check`; the three new E2Es;
  `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`; `bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh`;
  `bash plugins/tribe/scripts/tests/test-supervisor-kill.sh`; `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh`;
  `bun $T/render-prompts.ts --out $E/pr2-prompts && bun $T/g2-prompts.ts --render-dir $E/pr2-prompts > $E/v1-pr2-prompts.txt`.
  Expected: 0 fail everywhere; `TRIBE_WAY_TOTAL` ≤ PR 1's; `MISSING_REQUIRED_KINDS=0`.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "docs(runner): PR 2 governance — v2 state, turns, runner-run Done"`.

- [ ] **Step 5: Merge PR 2 behind the live-campaign gate** — open PR 2, wait for its checks to
  conclude green in the foreground, then — **immediately before `gh pr merge --merge`** — run `bash plugins/tribe/scripts/tests/runner-driver-only/no-live-campaign.sh`
  and merge only on exit 0 (Shaman amendment A1: this PR makes the runner refuse v1 states, and a
  live watchdog relaunches `run.ts` from the master checkout). Exit 1 or 2 stops the merge:
  `NEEDS_DIRECTION` naming what is live.

#### Done

```bash
bash plugins/tribe/scripts/tests/runner-driver-only/no-live-campaign.sh
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bun run check
bash plugins/tribe/scripts/tests/test-runner-done-negative.sh
bash plugins/tribe/scripts/tests/test-runner-done-empty.sh
bash plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
test "$(sed -n 's/^TRIBE_WAY_TOTAL=//p' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-pr2-prompts.txt)" -le "$(sed -n 's/^TRIBE_WAY_TOTAL=//p' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-pr1-prompts.txt)"
grep -q '^MISSING_REQUIRED_KINDS=0' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-pr2-prompts.txt
C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1) && C3X_MODE=agent bash "$C3/bin/c3x.sh" check | grep -q 'ok: true'
```

Expected: every command exits 0.

---

## PR 3 — the supervisor and watchdog follow the plan only; plan styles

The order below removes every consumer of the `ratified-as:` classification before moving the
classification itself out of the runner (Task 3.6), so the runner never imports Tribe-side code, not
even for one commit.

### Task 3.1: The supervisor loses the `ratify` session kind

**Why:** D6 — "the supervisor does no gap-gate ratification. Removed from `brief-ratify.md` … and
`core/supervisor/loop.ts`." Its only trigger is the runner's rulings gate, which Task 3.4 removes
(spec §4.10–§4.11). Open question Q1 records the alternative.

**Files:** delete `$R/core/supervisor/brief-ratify.md`; modify `$R/core/supervisor/{brief.ts,decide.ts,loop.ts,model.ts,verify.ts,args.ts,state.ts,status.ts,session.ts}`,
`$R/core/ledger.ts` (`SpawnKind` loses `'ratify'`), `$R/cli/main.ts` (limits wiring), their tests,
`$R/fixtures/supervisor/session-double.sh` (drop the `ratify` kind from its comment/usage),
`$R/README.md` Supervisor flag table (`--max-ratify-rounds` row — `test-supervisor-docs.sh` checks parity), `$T/render-prompts.ts`.

**Changed existing assertions (named):** `decide.test.ts` — `rows 1-3: runner_done closes, ratifies,
or closes-out` (drops the ratify case), `row 13`, `row 14`, `row 15`, `V2: an out-of-scope ratify
edit…`, `V5/V6 … ratify_failed` case, `V7: the unratified list reached empty…`, and the `G5 (fix B-F1)`
case's ratify expectation (it now expects `spawn_session(closing)`); `verify.test.ts` — the three
`ratify …` tests; `loop.test.ts` — `spawn_session(ratify) -> …`, the three
`extractRulingBlockVerbatim` tests, `V7 (a verified ratify)…`; `replay.test.ts` — `ruling, ruling,
ruling, ratify, closing` becomes `ruling, ruling, ruling, closing` (≤ 4 spawns); `args.test.ts` — the
defaults test and the four generated `--max-ratify-rounds` rows; `state.test.ts` — the three tests
carrying `ratifyRounds`; `status.test.ts` — the three ratify park reasons and `all 22 values…` (→ 19);
`brief.test.ts` — `describe('renderBrief — ratify')` and the ratify fixtures; `session.test.ts` and
`session.e2e.test.ts` — the `'ratify'` entries of their kind loops.

- [ ] **Step 1: Failing tests** — `decide.test.ts`:

```ts
test('runner_done with rulings in answers.md goes straight to closing: the supervisor never ratifies (D6)', () => {
  const o = base({ watchdog: terminal('runner_done') });
  expect(decide(o)).toEqual({ kind: 'spawn_session', session: 'closing', cardId: null });
});
test('an unknown terminal reason (e.g. a legacy rulings_unratified) parks as error, never a ratify spawn', () => {
  expect(decide(base({ watchdog: terminal('rulings_unratified') }))).toMatchObject({ kind: 'park', reason: 'error' });
});
```

  `state.test.ts`: `a supervisor state written before this change (with ratifyRounds) still loads, and the field is dropped`.
  Run `cd $R && bun test core/supervisor`. Expected: FAIL.

- [ ] **Step 2: Implement** — delete everything spec §4.11 lists for the `ratify` kind: `SessionKind`
  becomes `'ruling' | 'closing'`; `SupervisorObservation.unratifiedRulings` and the loop's
  `unratifiedRulingIds(io.readFileOrEmpty(paths.answers))` read go; decide rows 1–3 become
  `closingVerified ? exit : (verifyShippedPluginAvailable ? spawn closing : park closing_failed)`;
  rows 13–15 go (a `rulings_unratified` terminal falls to the residual `park('error')`);
  `ParkReason` loses `ratify_cap`, `ratify_failed`, `ratify_out_of_scope` (and `PARK_SENTENCES` their
  entries); `LedgerVerdict` loses `'ratified'`; `SupervisorLimits.maxRatifyRounds`,
  `--max-ratify-rounds` (args, defaults, bounds, README row), `SupervisorState.ratifyRounds` (the
  parser ignores a legacy key), status counters `ratifyRounds` go; `buildOneShotPrompt`'s ratify
  branch, `extractRulingBlockVerbatim`, `RATIFY_TEMPLATE_PATH`, `RatifyBriefFacts`,
  `RatifyBlockFact`, `renderRatify`, `verifyRatify`, `blocksById` go. `$T/render-prompts.ts` drops
  the `supervisor/ratify` kind and its `RATIFY_TEMPLATE_PATH` import.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/supervisor cli/main.test.ts core/ledger.test.ts`;
  `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`; `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(supervisor)!: no ratify session — the supervisor does no ratification (D6)"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/supervisor cli/main.test.ts core/ledger.test.ts
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
test ! -e plugins/tribe/scripts/runner/core/supervisor/brief-ratify.md
! grep -rn -i 'ratify' plugins/tribe/scripts/runner/core/supervisor --include='*.ts' --exclude='*.test.ts'
```

Expected: every command exits 0.

### Task 3.2: The ruling session rules on the owner's behalf — no Tribe role, no `ratified-as:`

**Why:** V1 — the ruling brief says "with Shaman authority" and carries the `ratified-as:`
vocabulary (5 mentions, MEASURED); `verifyRuling` fails a plain ruling as `not_ratified`.

**Files:** modify `$R/core/supervisor/brief-ruling.md`, `$R/core/supervisor/verify.ts`
(`verifyRuling`), `$R/core/supervisor/status.ts` (`owner_only` unblock sentence), their tests.

**Changed existing assertions (named):** `verify.test.ts` — `a new block with ratified-as: pending is
a failed attempt, not a ruling` and `a new block with no ratified-as: field at all is a failed
attempt` (both are now `ruled`). The W3/W7 quote tests in `brief.test.ts` stay byte-identical.

- [ ] **Step 1: Failing tests** — `verify.test.ts`:

```ts
test('any new ## block appended after the existing ones is a ruling — no ratified-as: required (D6)', () => {
  const before = '## R1 — a\n\nx\n';
  const v = verifyRuling({ before, after: `${before}\n## R2 — b\n\nMax returns ErrEmpty.\n`, repoStatus: '', marker: null });
  expect(v).toEqual({ outcome: 'ruled', retryable: true, rulingId: 'R2 — b' });
});
```

  `brief.test.ts`: `the ruling brief carries no Tribe way of working` — render the fixture ruling
  facts and assert `countTribeMentions(rendered)` is `[]` and that it still contains `answers.md`,
  the card id, the escalation content and both exits. Run `cd $R && bun test core/supervisor/verify.test.ts core/supervisor/brief.test.ts`.
  Expected: FAIL.

- [ ] **Step 2: Implement** — `brief-ruling.md`: "## Role and authority" → "You are ruling on ONE
  escalation on the owner's behalf, within the authority this campaign grants. You never contact
  the owner. You never write code."; delete the "Frozen `ratified-as:` vocabulary" paragraph; the
  first exit becomes "Append a ruling to `{{ANSWERS_PATH}}`, as a `## R<n> — <title>` block with the
  next free `R<n>`."; the "Adjudication rule (REFUTED in advance)" paragraph becomes "\"This question
  is hard\" is not a reason to park if it is within the authority this campaign grants. A scope
  clarification is a ruling, not a park." Keep the W3/W7/owner-only quotes and everything else verbatim. `verifyRuling`:
  a new block is `ruled` (repo-touched still fails) — drop the `isRulingRatified` branch and the
  `not_ratified` reason. `status.ts` `owner_only.unblock`: "Rule on {card}'s question yourself:
  append a ruling to {home}/answers.md as the next R<n> block, archive {home}/escalations/{card}.md
  to .resolved-R<n>, delete this file, then re-run: {rerun}".

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/supervisor`;
  `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(supervisor): rulings are plain rulings — no Tribe role, no ratified-as"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/supervisor
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
! grep -n -i -E 'shaman|ratified-as' plugins/tribe/scripts/runner/core/supervisor/brief-ruling.md
```

Expected: every command exits 0.

### Task 3.3: The closing session re-verifies and reports — no ratification pass, no gap-gate ids

**Why:** D6 — "Removed from … `brief-closing.md`" (32 mentions, MEASURED). The closing brief quotes
SKILL.md's Stage D verbatim and `brief.test.ts` checks it, so SKILL.md's Stage D changes in this same
commit: the simple Stage D is three steps; the Tribe style's ratification pass moves to Task 3.8.

**Files:** modify `$R/core/supervisor/brief-closing.md`, `$R/core/supervisor/brief.ts` (`renderClosing`,
`ClosingBriefFacts`), `$R/core/supervisor/loop.ts` (`buildOneShotPrompt`'s closing branch,
`readGapGateOpenIds` deleted), `$R/core/supervisor/verify.ts` (`verifyClosing`), their tests,
`plugins/tribe/skills/orchestrate-campaign/SKILL.md` (Stage D), `plugins/tribe/scripts/tests/test-supervisor-repro.sh`
(its G5 closing-open-ids probe), `$T/render-prompts.ts` (its closing facts lose `rulings` and `openIdsByCard`).

**Changed existing assertions (named):** `brief.test.ts` — the Stage D marker list (step 2's
`2. **The ratification pass.**` marker goes; the new markers are the three steps below) and
`contains Stage D's four numbered steps…` (→ three); `loop.test.ts` — `buildOneShotPrompt renders the
closing brief with the CAMPAIGN-home report's open ids…` and `readGapGateOpenIds reads under the home
it is GIVEN…` (deleted with the feature); `verify.test.ts` — `verifyClosing: an unratified ruling
still on disk is a failed attempt` (deleted); `test-supervisor-repro.sh` — `G5: the closing brief
lists the gate's own open ids` (deleted); every `verifyClosing({ … answers: … })` call drops `answers`.
Task 2.2's #173 G7 sentence in `brief-closing.md` stays.

- [ ] **Step 1: Failing tests** — `brief.test.ts`:

```ts
test('the closing brief is Tribe-free: re-verify, trailer recovery, one report (D6)', () => {
  const rendered = renderBrief('closing', fixtureClosingFacts());
  expect(countTribeMentions(rendered)).toEqual([]);
  for (const s of [STAGE_D_STEP_1, STAGE_D_STEP_2, STAGE_D_STEP_3, '--skip-gap-gate', '--verdict-out']) {
    expect(rendered).toContain(s);
  }
});
```

  with `STAGE_D_STEP_2 = '2. **You can also recover which commits belong to this campaign directly from git.**'`
  and `STAGE_D_STEP_3 = '3. **Compose ONE report** to the owner'`. Run `cd $R && bun test core/supervisor/brief.test.ts`.
  Expected: FAIL.

- [ ] **Step 2: Implement** — SKILL.md "## Stage D — The one final owner report" becomes three
  numbered steps: (1) today's step 1 with "Invoke the **`verify-shipped` skill by name** …" gaining
  "with `--skip-gap-gate`" (the Tribe style below re-adds the stamp check); (2) today's step 3
  (trailer recovery), renumbered; (3) today's step 4 without its "Harness-gap rulings" bullet,
  renumbered. Add, right after them: "**Tribe style only:** also run the ratification pass in
  'Tribe style — Stage D additions' below." `brief-closing.md`: "## Role and authority" → "You are
  the closing session for this campaign. You have `Bash` and read access to the target repo: you
  re-verify every shipped card with `verify-shipped` and write the one owner report. You land no PR."
  (keep #173's G7 sentence); "## The oracle": "`SKILL.md` Stage D below is the question. The final
  `campaign-report.json` is the evidence."; the Stage D block is the new three steps, verbatim;
  delete the "Every ruling…" and "Each card's still-open gap ids…" sections and the
  `{{RULINGS}}`/`{{OPEN_IDS_BY_CARD}}` placeholders. `brief.ts`: `ClosingBriefFacts` loses `rulings`
  and `openIdsByCard` (and `ClosingRulingFact`, `ClosingOpenIdsFact`). `loop.ts`: the closing branch
  stops reading rulings and gap-gate JSON; delete `readGapGateOpenIds`. `verify.ts`: `verifyClosing`
  drops the `answers` input and the `rulings_unratified` check.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/supervisor`;
  `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`; `TRIBE_REPRO=1 bash plugins/tribe/scripts/tests/test-supervisor-repro.sh`.
  Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "feat(supervisor): the closing session re-verifies and reports; no ratification pass"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/supervisor
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
! grep -n -i -E 'gap-gate|ratif|governance|warchief' plugins/tribe/scripts/runner/core/supervisor/brief-closing.md
! grep -rn 'readGapGateOpenIds' plugins/tribe/scripts/runner/core
```

Expected: every command exits 0.

### Task 3.4: The runner loses the rulings gate (exit 5)

**Why:** D3 — the runner may not require anything only the Tribe governance produces. MEASURED: one
ordinary ruling turns a finished campaign into exit 5 (`$E/g3-before-rulings-gate-stdout.txt`).

**Files:** modify `$R/core/loop/run-loop.ts` (delete `applyRulingsGate`, `LoopResult.unratifiedRulings`,
the `reachedDone` plumbing that only the gate used), `$R/core/types.ts` (`EXIT_RULINGS_UNRATIFIED`),
`$R/core/report.ts` (reason, field, `renderRulingsUnratifiedNote`), `$R/cli/main.ts` (threading),
`$R/core/loop.test.ts`, `$R/core/report.test.ts`, `$T/render-prompts.ts` (the `report/campaign-report-md`
kind renders an `escalations_pending` report instead).

**Changed existing assertions (named):** `loop.test.ts` — the import of `EXIT_RULINGS_UNRATIFIED`;
`genuine done with an unratified ruling -> EXIT_RULINGS_UNRATIFIED through the pool path (N=2)`; `a
card still in flight … does NOT wrongly gate on rulings`; all six tests of `describe('runLoop —
rulings gate …')` (deleted with the gate); `report.test.ts` — the import;
`EXIT_RULINGS_UNRATIFIED -> rulings_unratified, regardless of hasMessage`; `the unratified ruling ids
and guidance land INSIDE the "## Pending" section…`.

- [ ] **Step 1: Failing test** — `loop.test.ts`:

```ts
test('D3: a finished campaign with a plain owner ruling (no ratified-as:) exits 0 — the runner gates nothing on rulings', async () => {
  const state = fixtureState({ sequence: ['C1'], cards: { C1: fixtureCard({ status: 'shipped' }) } });
  const { io } = buildMockLoopIo({ stateJson: JSON.stringify(state), spawnQueue: [], answers: '## R1 — a ruling\n\nruled-by: owner\n\nDo X.\n' });
  expect((await runLoop(baseLoopConfig(), io)).exitCode).toBe(EXIT_OK);
});
```

  Run `cd $R && bun test core/loop.test.ts`. Expected: FAIL (exit 5).

- [ ] **Step 2: Implement** — delete as listed; `runLoop` returns the pass result directly;
  `ExitReason` loses `'rulings_unratified'`; `ReportRunInfo.unratifiedRulings` goes; `deriveExitReason`
  loses the branch. `run-loop.ts` no longer imports `core/rulings.ts`.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/loop.test.ts core/report.test.ts cli/main.test.ts`.
  Then re-run the MEASURED probe with a v2 copy of its state:
  `python3 -c "import json;s=json.load(open('$FH/g3-rulings-baseline/campaign-state.json'));s['v']=2;s['cards']['small-helpers']['tasks']=[{'id':'T1','heading':'Task 1: \`mathx.Sum\`'}];json.dump(s,open('$FH/g3-rulings-baseline/campaign-state.json','w'),indent=2)"`
  and `bun $R/run.ts --repo $F --model sonnet --home $FH/g3-rulings-baseline --no-viewer; echo "exit $?"`.
  Expected: 0 fail; `exit 0`.

- [ ] **Step 4: Commit** — `git commit -am "feat(runner)!: no rulings gate — the runner requires no ratification (D3)"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/loop.test.ts core/report.test.ts cli/main.test.ts
! grep -rn -E 'EXIT_RULINGS_UNRATIFIED|rulings_unratified|applyRulingsGate' plugins/tribe/scripts/runner/core plugins/tribe/scripts/runner/cli --include='*.ts'
```

Expected: every command exits 0.

### Task 3.5: The watchdog and the supervisor's truth table lose the exit-5 vocabulary

**Why:** the runner never exits 5 now; the mapping is dead Tribe vocabulary in a check.

**Files:** modify `$R/core/watchdog/decide.ts`, `$R/core/watchdog/model.ts` (terminal reason),
`$R/core/supervisor/truth.ts` (`RUN_REASON_TO_TERMINAL_REASON`), `$R/fixtures/watchdog/runner-double.sh`
(the `5)` arm), `$R/core/watchdog/decide.test.ts`, `$R/core/watchdog/watch-loop.test.ts`,
`$R/watchdog-integration.test.ts`, `$R/core/supervisor/truth.test.ts`,
`plugins/tribe/skills/orchestrate-campaign/SKILL.md` (the watchdog reason list and the exit-code
tables lose `5`/`rulings_unratified`).

**Changed existing assertions (named):** `decide.test.ts` — the 8 generated `exit 5 quota=… ->
exit:needs_human:rulings_unratified` rows (an exit 5 is now "no known runner exit": the exit-3-style
crash rows decide it) and `TABLE.length).toBe(48)` → 40; `watch-loop.test.ts` — `runner 5 maps to
watchdog 10:rulings_unratified`; `watchdog-integration.test.ts` — `plan "5:none" ends
10:rulings_unratified`; `truth.test.ts` — `every ExitReason spelled identically…` loses
`'rulings_unratified'`.

- [ ] **Step 1: Failing test** — `watchdog/decide.test.ts`:

```ts
test('the watchdog vocabulary has no rulings_unratified reason any more', () => {
  expect(TERMINAL_REASONS).not.toContain('rulings_unratified');
});
```

  (export `TERMINAL_REASONS` from `watchdog/model.ts` as the readonly array of the terminal reason
  union if it is not already exported). Run `cd $R && bun test core/watchdog`. Expected: FAIL.

- [ ] **Step 2: Implement** — delete the `case 5` arm, the reason from the union/array, the truth-map
  entry, the fixture arm; update the SKILL.md tables.

- [ ] **Step 3: Verify** — `cd $R && bunx tsc --noEmit && bun test core/watchdog core/supervisor/truth.test.ts watchdog-integration.test.ts`;
  `bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git commit -am "refactor(watchdog): drop the dead exit-5 rulings reason"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/watchdog core/supervisor/truth.test.ts watchdog-integration.test.ts
bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh
! grep -rn 'rulings_unratified' plugins/tribe/scripts/runner/core plugins/tribe/scripts/runner/fixtures/watchdog plugins/tribe/skills/orchestrate-campaign/SKILL.md
```

Expected: every command exits 0.

### Task 3.6: Move the ratification check to the Tribe side — `gaps/rulings-check.ts`

**Why:** "moved, not deleted" (spec §5): a Tribe-style plan's closing task runs it as a Done command.

**Files:** create `plugins/tribe/scripts/gaps/rulings-check.ts`, `plugins/tribe/scripts/gaps/rulings-check.test.ts`;
modify `$R/core/rulings.ts` (keeps `RulingBlock` and `parseRulings`; `isRulingRatified`,
`unratifiedRulingIds`, `RATIFIED_VALUE_RE` move), `$R/core/rulings.test.ts` (its classification
tests move, verbatim, to the new test file — named: the describes at `isRulingRatified` and
`unratifiedRulingIds`), `plugins/tribe/scripts/gaps/README.md` (if present) or the gaps directory's
existing doc.

- [ ] **Step 1: Failing test** — `plugins/tribe/scripts/gaps/rulings-check.test.ts`: the moved
  classification tests (import from `./rulings-check.ts`) plus

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('CLI: exit 1 naming every unratified id; exit 0 when all are ratified; exit 2 on a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-'));
  const f = join(dir, 'answers.md');
  writeFileSync(f, '## R1 — a\n\nratified-as: operational\n\n## R2 — b\n\nno disposition\n');
  const bad = spawnSync('bun', [join(import.meta.dir, 'rulings-check.ts'), f], { encoding: 'utf8', timeout: 30_000 });
  expect(bad.status).toBe(1);
  expect(bad.stdout).toContain('R2 — b');
  writeFileSync(f, '## R1 — a\n\nratified-as: operational\n');
  expect(spawnSync('bun', [join(import.meta.dir, 'rulings-check.ts'), f], { encoding: 'utf8', timeout: 30_000 }).status).toBe(0);
  expect(spawnSync('bun', [join(import.meta.dir, 'rulings-check.ts'), join(dir, 'missing.md')], { encoding: 'utf8', timeout: 30_000 }).status).toBe(2);
});
```

  Run `bun test plugins/tribe/scripts/gaps/rulings-check.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** — `rulings-check.ts` imports `parseRulings` from
  `../runner/core/rulings.ts` (the Tribe side depends on the runner, never the reverse), holds the
  moved `RATIFIED_VALUE_RE` / `isRulingRatified` / `unratifiedRulingIds` with their doc comments
  verbatim, and a CLI: `bun rulings-check.ts <answers.md>` → a missing path or a read error prints
  `rulings-check: cannot read <path>: <reason>` and exits 2; unratified ids → one per line on stdout,
  exit 1; none → `rulings-check: every ruling is ratified`, exit 0 (`if (import.meta.main)`).

- [ ] **Step 3: Verify** — `bun test plugins/tribe/scripts/gaps/rulings-check.test.ts`;
  `cd $R && bunx tsc --noEmit && bun test core/rulings.test.ts`. Expected: 0 fail.

- [ ] **Step 4: Commit** — `git add -A plugins/tribe/scripts/gaps plugins/tribe/scripts/runner/core/rulings.ts plugins/tribe/scripts/runner/core/rulings.test.ts && git commit -m "refactor: the ratification check moves to the Tribe side (gaps/rulings-check.ts)"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
bun test plugins/tribe/scripts/gaps/rulings-check.test.ts
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/rulings.test.ts
! grep -n -E 'isRulingRatified|unratifiedRulingIds' plugins/tribe/scripts/runner/core/rulings.ts
```

Expected: every command exits 0.

### Task 3.7: The skill's default plan style is simple (D7)

**Why:** D7 — "When the owner runs `/orchestrate-campaign` without naming a style, plans say: one
subagent per task, each task's Done commands run by the runner. The full Tribe workflow … appears in a
plan only when the owner asks for it."

**Files:** modify `plugins/tribe/skills/orchestrate-campaign/SKILL.md`.

- [ ] **Step 1: Edit** — in this order:
  1. Frontmatter `description`: "This skill assumes Shaman authority for the campaign" → "This skill
     assumes the campaign's decision authority"; "(that stays the Warchief/Hunter path)" → "(that is a
     single-card session)".
  2. "## Assume Shaman authority" → "## Assume the campaign's authority": keep the register sentence;
     replace "cards still go through the Warchief/Hunter chain" with "cards go through whatever way of
     working their plan prescribes (see 'Choose the plan style' in Stage A)"; add "(In the Tribe
     style this is the authority `agents/shaman.md` describes as Mode 3.)".
  3. Stage A, a new step after step 2:

````markdown
2b. **Choose the plan style — the plan, not the runner, decides the way of working.** The runner,
   its watchdog and its supervisor drive whatever the plan says and prescribe nothing themselves.
   - **Simple (the default: the owner named no style).** Every plan opens with this section,
     verbatim, and every task ends with a Done section:

     ```markdown
     ## How to work

     - Do the tasks in order. Give each task to one `general-purpose` subagent; the subagent
       writes the test, writes the code, runs the task's Done commands, and commits.
     - Every task ends with a **Done** section: shell commands, one per line. The task is done
       when every command exits 0 when run from a clean checkout of the task's commit — the
       runner runs them itself.
     - Work on a branch in a separate git worktree.
     ```

     Name `general-purpose`: other agents stay installed on this machine, and an executor told only
     "one subagent per task" could pick one of them by its description. Record `planning.mode` as
     `"self"` (you authored the plans) or `"subagent-fanout"` (one planning subagent per card).
   - **Tribe (only when the owner asks for it).** The plan opens with "Tribe style — plan section"
     below instead, verbatim, and ends with the "Harness-gap gate" task it describes. Record
     `planning.mode` as `"shaman"` or `"warchief-fanout"`.
````

  4. Step 2's authorship modes: "dispatch one **planning-Warchief** per card" → "dispatch one
     planning subagent per card (`general-purpose` in the simple style; a planning-Warchief in the
     Tribe style)".
  5. Stage C step 1: the "Every ruling you append … carries a `ratified-as:` field …" bullet becomes
     "**Tribe style only:** every ruling you append carries a `ratified-as:` field — see 'Tribe style —
     Stage C and D additions'." (its vocabulary text moves there, Task 3.8). The doorbell's transcription
     template drops its `ratified-as:` line (moved the same way).
  6. "## Walls": move the bullet "The diary and `answers.md` are event logs … (Stage D) exists to catch."
     to the Tribe-style section (Task 3.8); W1/W3/W7 stay verbatim (the ruling brief quotes them).

- [ ] **Step 2: Verify** — `cd $R && bun test core/supervisor/brief.test.ts` (W3/W7 quotes still
  byte-identical); `bash plugins/tribe/scripts/tests/test-watchdog-detached.sh`;
  `python3 - <<'EOF'` a check that the text between `2b. **Choose the plan style` and `- **Tribe (only`
  has zero lexicon hits (run `countTribeMentions` via `bun -e`). Expected: 0 fail; zero hits.

- [ ] **Step 3: Commit** — `git commit -am "docs(orchestrate-campaign): the default plan style is simple (D7)"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/supervisor/brief.test.ts
bash plugins/tribe/scripts/tests/test-watchdog-detached.sh
grep -q 'Choose the plan style' plugins/tribe/skills/orchestrate-campaign/SKILL.md
bun -e "import {readFileSync} from 'node:fs'; import {countTribeMentions} from './plugins/tribe/scripts/tests/runner-driver-only/tribe-lexicon.ts'; const s=readFileSync('plugins/tribe/skills/orchestrate-campaign/SKILL.md','utf8'); const a=s.indexOf('2b. **Choose the plan style'); const b=s.indexOf('- **Tribe (only'); if (a<0||b<0||countTribeMentions(s.slice(a,b)).length) process.exit(1)"
```

Expected: every command exits 0.

### Task 3.8: The Tribe style — everything the runner stopped saying, as plan text

**Why:** the scope fence: "What they remove is moved, not deleted: it becomes plan text/sections a
plan includes when the owner asks for the Tribe style (D7), so the Tribe path stays usable by choice."
Spec §5 is the ledger of what lands here.

**Files:** modify `plugins/tribe/skills/orchestrate-campaign/SKILL.md` (two new sections), and
`$R/README.md` (the "done check" section points here for the gap-gate).

- [ ] **Step 1: Write the sections** — append to SKILL.md, before "## A campaign can outlive this session":

````markdown
## Tribe style — plan section (use only when the owner asks for the Tribe style)

Copy this section into the plan, verbatim, as its "How to work", and end the plan with the
"Harness-gap gate" task below.

```markdown
## How to work (Tribe style)

- The executor acts as the Warchief (`agents/warchief.md`) for this card. For each task it dispatches
  one Hunter (`subagent_type: hunter`) and audits the result with the dual-Skinner cell (two
  `skinner` instances — the contract lens and the cold lens — dispatched in one message), running
  the fix loop up to three rounds. The runner still drives the tasks in order and runs each task's
  Done commands itself; end a task's turn only after its audit closed.
- Every task is test-first: a failing test before the code, gates (formatter/linter/type-checker/
  tests) green before commit, and a real commit carrying the code, its test, and the plan's ticked
  checkboxes together. Claims of done are worthless without the gate output that proves them —
  paste gate output verbatim into worker reports.
- Every dispatched worker (Hunter, Skinner) writes its report under the campaign home's `reports/`
  directory (the brief names the campaign home).
- Dispatch the Tracker at every audit round (Warchief Method step 6.0b), each with its own report file
  `<campaign home>/reports/tracker-<card id>-<round>.md` (`<round>` = `task-3`, `wave-2`, `fix-1`,
  `final`). Use the runner's card id as your card slug — in these file names, in `gap-gate.ts --card`,
  and in every `Tribe-Card:` trailer.
- Scout's governance proposals ride this card's PR: rule/anti-rule drafts as reviewable text, a debt
  proposal as its recorded check command + description only — the debt entity itself is created
  later, by ratified `gap-rule.ts` execution. Do not self-ratify; record each proposal and its
  proposed disposition under a `## Harness gaps` heading in the PR body. Only a gap needing an
  owner-only decision escalates NEEDS_DIRECTION.
```

The plan's last task, verbatim except its number:

```markdown
### Task N: Harness-gap gate

Run `gap-gate.ts` (Warchief Method step 7) on the card branch; paste `<card id>-gap-gate.md` verbatim
as the PR body's `## Harness gaps` section, including its `gap-gate v1` stamp line; commit the
`.tribe/harness-gaps.jsonl` append with the trailer `Tribe-Milestone: gap-gate` before the PR opens;
run `debt-backfill.ts`.

#### Done

    T="$(dirname "$(dirname "$(readlink -f ~/.claude/agents/warchief.md)")")/scripts/gaps"; bun "$T/gap-gate.ts" --repo "$PWD" --home "$RUNNER_CAMPAIGN_HOME" --card "$RUNNER_CARD_ID" --base "$RUNNER_BASE_SHA" --head HEAD
```

(In the plan itself, that Done command sits in a fenced `bash` block, as every Done section does.)

## Tribe style — Stage C and D additions

- **Stage C:** every ruling you append to `answers.md` carries a `ratified-as:` field. Frozen
  vocabulary: `rule <path>` | `debt <id>` | `roadmap <ref>` | `operational` | `dismissed` |
  `pending`. (Move here, verbatim, the rest of the former Stage C bullet: `operational` vs durable,
  one value only, the outstanding-17 R7 worked example.) The doorbell transcribes an owner ruling
  with `ruled-by: owner` and `ratified-as: <the owner's disposition, or pending>`.
- **Stage D:** after the three steps above, (a) re-verify each shipped card with `verify-shipped`
  WITHOUT `--skip-gap-gate` (the stamp check applies), and (b) run the ratification pass: (move here,
  verbatim, the former Stage D step 2, "The ratification pass. Collect every convention …"). The
  campaign is not done until
  `bun "$(dirname "$(dirname "$(readlink -f ~/.claude/agents/warchief.md)")")/scripts/gaps/rulings-check.ts" <campaign-home>/answers.md`
  exits 0.
- **Wall:** (move here, verbatim, the former Walls bullet "The diary and `answers.md` are event logs
  and operational state, never the resting place of a durable convention …".)
````

  Fill each "(move here, verbatim, …)" with the exact text Tasks 3.3 and 3.7 removed (recover it
  with `git show HEAD~N:plugins/tribe/skills/orchestrate-campaign/SKILL.md` from before those tasks),
  so nothing Tribe is lost.

- [ ] **Step 2: Verify** — `grep -c 'Tribe style — plan section' plugins/tribe/skills/orchestrate-campaign/SKILL.md`
  (1); every term of spec §5's "Lands in" column that names SKILL.md appears in the new sections
  (`gap-gate.ts`, `debt-backfill.ts`, `Tracker`, `Scout`, `Hunter`, `Skinner`, `test-first`,
  `rulings-check.ts`, `The ratification pass`); `cd $R && bun test core/supervisor/brief.test.ts`.
  Expected: all present; 0 fail.

- [ ] **Step 3: Commit** — `git commit -am "docs(orchestrate-campaign): the Tribe style — everything the runner stopped saying, as plan text"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
grep -q 'Tribe style — plan section' plugins/tribe/skills/orchestrate-campaign/SKILL.md
for t in 'gap-gate.ts' 'debt-backfill.ts' 'Tracker' 'Scout' 'Hunter' 'Skinner' 'test-first' 'rulings-check.ts' 'The ratification pass'; do grep -q -- "$t" plugins/tribe/skills/orchestrate-campaign/SKILL.md || exit 1; done
! grep -n '(move here, verbatim' plugins/tribe/skills/orchestrate-campaign/SKILL.md
cd plugins/tribe/scripts/runner && bun test core/supervisor/brief.test.ts
```

Expected: every command exits 0 (the third proves every "move here" was filled).

### Task 3.9: V1 gate — no prompt carries the Tribe way of working; every essential is there

**Why:** the Shaman's V1, the card's G2'. This is the ratchet's end value: 203 → 0.

**Files:** create `$E/after-prompts/`, `$E/v1-after-prompts.txt`, `$E/v1-after-prompts.json`.

- [ ] **Step 1: Measure** — `bun $T/render-prompts.ts --out $E/after-prompts && bun $T/g2-prompts.ts --render-dir $E/after-prompts --gate | tee $E/v1-after-prompts.txt && bun $T/g2-prompts.ts --render-dir $E/after-prompts --json > $E/v1-after-prompts.json`.
  Expected: `TRIBE_WAY_TOTAL=0`, `MISSING_REQUIRED_KINDS=0`, no `ESSENTIALS_MISSING`, `G2_GATE=PASS`.
  A remaining hit is a finding: remove the Tribe text from the prompt it names (if it is a generic
  word the lexicon over-matches, rephrase the prompt — the lexicon is not edited to pass the gate).

- [ ] **Step 2: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): V1 gate — 0 Tribe-way mentions, every driver essential present"`

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
bun plugins/tribe/scripts/tests/runner-driver-only/render-prompts.ts --out /tmp/rdo-done-3-9
bun plugins/tribe/scripts/tests/runner-driver-only/g2-prompts.ts --render-dir /tmp/rdo-done-3-9 --gate
grep -q '^G2_GATE=PASS' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-after-prompts.txt
```

Expected: every command exits 0.

### Task 3.10: PR 3 governance — README, C3, full suites

**Files:** modify `$R/README.md` (Supervisor: no ratify kind, closing without ratification, the flag
table; delete "Rulings gate"; Exit codes table without 5; Watchdog action table without the exit-5 row;
Report contract without `rulings_unratified`), `.c3/` (change unit on `c3-215`: the `supervise`
Contract row, the Change-Safety rows naming the closing gap-gate ids and ratify sessions, the
orchestrate-campaign Contract row "Assumes Shaman authority" → the new wording and the plan styles).

- [ ] **Step 1: README + C3** — as listed; apply the change unit in this commit.

- [ ] **Step 2: Suites** — `cd $R && bun run check`; `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`;
  `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh`; `bash plugins/tribe/scripts/tests/test-supervisor-kill.sh`;
  `bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh`; the three runner E2Es; `bun test plugins/tribe/scripts/gaps/rulings-check.test.ts`.
  Expected: 0 fail each.

- [ ] **Step 3: Commit** — `git commit -am "docs(runner): PR 3 governance — supervisor and watchdog follow the plan only"`, then open PR 3.

#### Done

```bash
bun install --cwd plugins/tribe/scripts/runner --frozen-lockfile
cd plugins/tribe/scripts/runner && bun run check
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
bash plugins/tribe/scripts/tests/test-supervisor-kill.sh
bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh
bash plugins/tribe/scripts/tests/test-runner-done-negative.sh
bash plugins/tribe/scripts/tests/test-runner-done-empty.sh
bash plugins/tribe/scripts/tests/test-runner-task-index-refusal.sh
! grep -n -E 'Rulings gate|rulings_unratified|--max-ratify-rounds' plugins/tribe/scripts/runner/README.md
C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1) && C3X_MODE=agent bash "$C3/bin/c3x.sh" check | grep -q 'ok: true'
```

Expected: every command exits 0.

---

## PR 4 — real runs and evidence (V2, V3, V4, V5, V7, G3', G6, D10)

Every real run here follows the card's round-3 decisions: **D9** — V2, V3 and V5 run with
`CLAUDE_CONFIG_DIR=/Users/hiep/.claude-sandboxes/runner-driver-only` (`S` below: a Claude home
installed by `install.sh` with its `agents/` emptied) for the runner, the supervisor, the watchdog and
the V5 session; V4 runs in the owner's real home. **D10** — after every sandbox run, both bypass-audit
layers run: `$T/bypass-audit.ts` (deterministic) and the independent auditor subagent (spec §6.8).
The runner code under test is this branch's worktree (identical to what PR 4 merges).

### Task 4.1: V7 — every suite green; the sandbox is ready

**Why:** the Shaman's V7 and D9's precondition (the sandbox is logged in and has no agents).

**Files:** create `$E/v7-after-counts.txt`, `$E/d9-sandbox-ready.txt`.

- [ ] **Step 1: Suites** — record the tail of each into `$E/v7-after-counts.txt`: `cd $R && bun run check`;
  `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh`; `bash plugins/tribe/scripts/tests/test-supervisor-kill.sh`;
  `bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh`; `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh`;
  the three runner E2Es; `bun test plugins/tribe/scripts/gaps/rulings-check.test.ts`;
  `bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`; `cd plugins/tribe/scripts/viewer && bun test`;
  `cd $R && RUN_SESSION_E2E=1 bun test core/session.e2e.test.ts core/supervisor/session.e2e.test.ts`.
  Expected: 0 fail each. Compare with `$E/v7-base-counts.txt`: every count change is explained by a
  named assertion change in this plan (list them in the file).

- [ ] **Step 2: Sandbox ready** —

```bash
S=/Users/hiep/.claude-sandboxes/runner-driver-only
{ echo "agents: $(ls -A $S/agents | wc -l | tr -d ' ') entries"
  cd /Users/hiep/repo/runner-e2e-go && CLAUDE_CONFIG_DIR=$S perl -e 'alarm 120; exec @ARGV' claude -p "Reply with exactly: OK" --model haiku; } | tee docs/superpowers/evidence/2026-09-27-runner-driver-only/d9-sandbox-ready.txt
```

  Expected: `agents: 0 entries` and `OK`. "Not logged in" stops PR 4: `NEEDS_DIRECTION` ("the sandbox
  needs the owner's one interactive login").

- [ ] **Step 3: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): V7 regression counts; the D9 sandbox is ready"`

#### Done

```bash
grep -q '^agents: 0 entries$' docs/superpowers/evidence/2026-09-27-runner-driver-only/d9-sandbox-ready.txt
grep -q '^OK' docs/superpowers/evidence/2026-09-27-runner-driver-only/d9-sandbox-ready.txt
! grep -E ' [1-9][0-9]* fail|[1-9][0-9]* failed' docs/superpowers/evidence/2026-09-27-runner-driver-only/v7-after-counts.txt
```

Expected: every command exits 0.

### Task 4.2: V2 — the same Go plan, through the full stack, in the sandbox

**Why:** the Shaman's V2 (G1, G2, G4, G6): "Same Go plan, same starting tree as the BEFORE run, driven
through the full stack (`supervise` → runner), not the runner alone."

**Files:** create `$E/v2-after-campaign-state.authored.json`, `$E/v2-after-*.txt|json|md`,
`$E/d10-v2-*`, `$E/v2-before-after.md`.

- [ ] **Step 1: Start from S0 and author the campaign** —

```bash
S=/Users/hiep/.claude-sandboxes/runner-driver-only; F=/Users/hiep/repo/runner-e2e-go
FH=/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns; T=plugins/tribe/scripts/tests/runner-driver-only
E=docs/superpowers/evidence/2026-09-27-runner-driver-only
bash $T/fixture-reset.sh $F 9bb6b2253a32453a8ffc2a7c473a0b97ea444498
mkdir -p $FH/go-after && : > $FH/go-after/answers.md
cat > $E/v2-after-campaign-state.authored.json <<'EOF'
{
  "v": 2,
  "campaign": "go-after",
  "planning": { "mode": "self" },
  "mergePolicy": "regular",
  "sequence": ["small-helpers"],
  "schemaLockPaths": [],
  "docsOnlyPaths": [],
  "ownerOnlyEscalations": [],
  "cards": {
    "small-helpers": {
      "status": "staged",
      "spec": "docs/specs/2026-09-27-small-helpers.md",
      "plan": "docs/plans/2026-09-27-small-helpers.md",
      "branch": null, "baseSha": null, "pr": null, "mergeSha": null, "sessionId": null, "updatedAt": null,
      "tasks": [
        { "id": "T1", "heading": "Task 1: `mathx.Sum`" },
        { "id": "T2", "heading": "Task 2: `mathx.Max`" },
        { "id": "T3", "heading": "Task 3: `textx.Reverse`" },
        { "id": "T4", "heading": "Task 4: `textx.IsPalindrome`" }
      ]
    }
  }
}
EOF
cp $E/v2-after-campaign-state.authored.json $FH/go-after/campaign-state.json
bun $T/bypass-audit.ts snapshot --sandbox $S --out $E/d10-v2-sandbox-before.json
CLAUDE_CONFIG_DIR=$S bun plugins/tribe/scripts/runner/run.ts --repo $F --model sonnet --home $FH/go-after --dry-run --no-viewer | tee $E/v2-after-dry-run.txt
```

  Expected: `RESET_OK … tree=86031f3c…`; the dry run prints card `small-helpers`, phase `fresh`.

- [ ] **Step 2: Run the full stack** — `date -u +%FT%TZ > $E/v2-after-start.txt; CLAUDE_CONFIG_DIR=$S perl -e 'alarm 10800; exec @ARGV' bun plugins/tribe/scripts/runner/run.ts supervise --repo $F --model sonnet --home $FH/go-after > $E/v2-after-supervise.txt 2>&1; echo "exit $?" >> $E/v2-after-supervise.txt; date -u +%FT%TZ > $E/v2-after-end.txt`.
  Expected: `exit 0` (campaign closed). A park (`exit 20`) is a finding: record `NEEDS_OWNER.md` in `$E`
  and stop with `NEEDS_DIRECTION`.

- [ ] **Step 3: Measure** —

```bash
bun $T/run-metrics.ts --home $FH/go-after | tee $E/v2-after-run-metrics.txt
bun $T/run-metrics.ts --home $FH/go-after --json > $E/v2-after-run-metrics.json
CLAUDE_CONFIG_DIR=$S bun $T/transcript-prompts.ts --home $FH/go-after --out $E/after-real-prompts
bun $T/g2-prompts.ts --render-dir $E/after-real-prompts --negative-only | tee $E/v1-after-real-prompts.txt
bun $T/g3-verify-replay.ts --repo $F --home $FH/go-after --card small-helpers | tee $E/g3-after-v2-replay.txt
cat $FH/go-after/runs/*/done.jsonl > $E/v2-after-done.jsonl
cp $FH/go-after/campaign-report.md $FH/go-after/supervisor/final-report.md $E/ 2>/dev/null; cp $FH/go-after/supervisor/verdicts/small-helpers.json $E/v2-after-verdict.json
test -f $FH/go-after/supervisor/ledger.jsonl && cp $FH/go-after/supervisor/ledger.jsonl $E/v2-after-ledger.jsonl
git -C $F fetch -q && { echo "master=$(git -C $F rev-parse master) origin=$(git -C $F rev-parse origin/master)"; (cd $F && go test ./...); echo "go test exit $?"; } | tee $E/v2-after-master.txt
```

  Expected: `TRIBE_AGENT_DISPATCHES=0`, `TRIBE_SKILL_CALLS=0`, `DONE_ROWS` ≥ 20 (every task's four
  commands at least once plus a summary row per Done run); real-prompt `TRIBE_WAY_TOTAL=0`; replay
  `SHIPPED=true`; `master=` equals `origin=`; `go test exit 0`. When `v2-after-ledger.jsonl` exists
  (#173's executor rows), no row has an `agentType` among the six agents.

- [ ] **Step 4: D10 — both layers** —
  `CLAUDE_CONFIG_DIR=$S bun $T/bypass-audit.ts scan --home $FH/go-after --claude-home $S --sandbox $S --snapshot-before $E/d10-v2-sandbox-before.json --repo $F | tee $E/d10-v2-scan.txt`
  → `BYPASS_AUDIT=PASS`. Then dispatch ONE fresh `general-purpose` subagent with exactly the auditor
  brief of spec §6.8, filled with the transcript paths the scan listed (the scan's `--json` output
  carries them as `transcripts`) — nothing else; save its full answer, verbatim, to
  `$E/d10-v2-auditor.md`. The Done asserts the line `VERDICT: CLEAN`; a `BYPASS` or `UNSURE` verdict
  (or a malformed verdict line) fails the task and is a finding for the owner — never argued down,
  never re-rolled with a second auditor.

- [ ] **Step 5: Before → after** — write `$E/v2-before-after.md`: one row each for Tribe dispatches
  (by type), Tribe skill calls, runner-run Done rows, executor wall clock, full-stack wall clock
  (`v2-after-start/end`), executor tokens, full-stack tokens, cost — BEFORE from the **sandbox** BEFORE
  run (`$E/v2-before-sandbox-*`, spec §6.7) with the real-home BEFORE run (`$E/v2-before-*`) as a
  supplementary column. Reported, not asserted (G6). Then `bash $T/fixture-reset.sh $F 9bb6b2253a32453a8ffc2a7c473a0b97ea444498`.

- [ ] **Step 6: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): V2 — the Go plan ships through supervise in the sandbox, 0 Tribe dispatches"`

#### Done

```bash
grep -q '^TRIBE_AGENT_DISPATCHES=0$' docs/superpowers/evidence/2026-09-27-runner-driver-only/v2-after-run-metrics.txt
grep -q '^TRIBE_SKILL_CALLS=0$' docs/superpowers/evidence/2026-09-27-runner-driver-only/v2-after-run-metrics.txt
grep -q '^TRIBE_WAY_TOTAL=0$' docs/superpowers/evidence/2026-09-27-runner-driver-only/v1-after-real-prompts.txt
grep -q '^SHIPPED=true' docs/superpowers/evidence/2026-09-27-runner-driver-only/g3-after-v2-replay.txt
grep -q '^go test exit 0$' docs/superpowers/evidence/2026-09-27-runner-driver-only/v2-after-master.txt
grep -q '^BYPASS_AUDIT=PASS$' docs/superpowers/evidence/2026-09-27-runner-driver-only/d10-v2-scan.txt
python3 -c "import json; r=[json.loads(l) for l in open('docs/superpowers/evidence/2026-09-27-runner-driver-only/v2-after-done.jsonl') if l.strip()]; ok={t for x in r if x['kind']=='done_run' and x['passed'] for t in [x['stepTask']]}; assert {'T1','T2','T3','T4'} <= ok, ok"
grep -q '^VERDICT: CLEAN$' docs/superpowers/evidence/2026-09-27-runner-driver-only/d10-v2-auditor.md
```

Expected: every command exits 0.

### Task 4.3: V3 in the sandbox — the deterministic control and a real session

**Why:** the Shaman's V3 and D9. V3a (the hermetic E2E, Task 2.14) is the discriminating check — a
runner that skips the Done run fails it. V3b shows a real sandbox session facing a Done command that
cannot pass: the runner never marks the task done.

**Files:** create `$E/v3-*`, `$E/d10-v3-*`.

- [ ] **Step 1: V3a** — `CLAUDE_CONFIG_DIR=$S RDO_EVIDENCE_DIR=$E bash plugins/tribe/scripts/tests/test-runner-done-negative.sh | tee $E/v3a-e2e.txt`.
  Expected: `V3=PASS`.

- [ ] **Step 2: V3b fixture** — reset `$F` to S0, then commit on `$F` master (and push) this plan as
  `docs/plans/2026-09-27-v3-negative.md`:

````markdown
# Plan — mathx.Double (negative control)

## How to work

- Do the task with one `general-purpose` subagent. Work on a branch in a separate git worktree.

### Task 1: `mathx.Double`

Create `mathx/double.go` with `func Double(x int) int { return 2 * x }` and `mathx/double_test.go`
with a `TestDouble` that checks `Double(3) == 6`.

#### Done

```bash
go build ./...
go test -run '^TestDouble$' -v ./mathx | grep -q -- '--- PASS: TestDouble'
test "$(uname -s)" = Plan9
```
````

  and author `$FH/go-v3-real/campaign-state.json` (v2, card `v3-negative`, spec
  `docs/specs/2026-09-27-small-helpers.md`, plan `docs/plans/2026-09-27-v3-negative.md`, one task
  `{"id":"T1","heading":"Task 1: \`mathx.Double\`"}`) plus an empty `answers.md`; snapshot the sandbox to
  `$E/d10-v3-sandbox-before.json`.

- [ ] **Step 3: V3b run** — `CLAUDE_CONFIG_DIR=$S perl -e 'alarm 5400; exec @ARGV' bun plugins/tribe/scripts/runner/run.ts --repo $F --model sonnet --home $FH/go-v3-real --no-viewer > $E/v3b-runner.txt 2>&1; echo "exit $?" >> $E/v3b-runner.txt`.
  Expected: `exit 2`. Then: the card's `status` is `escalated`, T1 has no `passedSha`, the card has no
  `doneSha`, `escalations/v3-negative.md` exists (reason `done_failed`, or `needs_direction` if the
  session asked instead of claiming the task); if any executor turn ended with `TASK_DONE`
  (`grep -h 'TASK_DONE' $FH/go-v3-real/runs/*/logs/*.log`), `done.jsonl` shows the `uname` command
  with a non-zero exit. Record all of it in `$E/v3b-checks.txt`.

- [ ] **Step 4: D10** — `bypass-audit.ts scan --home $FH/go-v3-real --claude-home $S --sandbox $S --snapshot-before $E/d10-v3-sandbox-before.json --repo $F`
  → `$E/d10-v3-scan.txt` (`BYPASS_AUDIT=PASS`); the auditor subagent (spec §6.8) → `$E/d10-v3-auditor.md`.
  Then `fixture-reset.sh $F 9bb6b2253a32453a8ffc2a7c473a0b97ea444498`.

- [ ] **Step 5: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): V3 — a failing Done command is never marked done (sandbox)"`

#### Done

```bash
grep -q '^V3=PASS$' docs/superpowers/evidence/2026-09-27-runner-driver-only/v3a-e2e.txt
grep -q '^exit 2$' docs/superpowers/evidence/2026-09-27-runner-driver-only/v3b-runner.txt
grep -q '^BYPASS_AUDIT=PASS$' docs/superpowers/evidence/2026-09-27-runner-driver-only/d10-v3-scan.txt
grep -q '^VERDICT: CLEAN$' docs/superpowers/evidence/2026-09-27-runner-driver-only/d10-v3-auditor.md
python3 -c "import json; c=json.load(open('/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/go-v3-real/campaign-state.json'))['cards']['v3-negative']; assert c['status']=='escalated' and 'doneSha' not in c and 'passedSha' not in c['tasks'][0], c"
```

Expected: every command exits 0.

### Task 4.4: G3' after — the done check requires nothing a Tribe agent produces

**Files:** create `$E/g3-after-*.txt`.

- [ ] **Step 1: Replays** — `bun $T/g3-verify-replay.ts --repo $F --home $FH/g3-plain-baseline --card small-helpers | tee $E/g3-after-plain-pr2-replay.txt`
  (convert that home's state to v2 first, exactly as Task 3.4 converted the rulings home: `v: 2` and
  one task `Task 1: \`mathx.Sum\``). Expected: no `gapGateStamped`/`ledgerCommitted` line; the only
  possible failures are `doneAtHead` (PR #2 was made by hand — no runner Done run exists for it, which
  is the runner's own D2 requirement, not a Tribe product) and `localBaseSynced` if the fixture master
  moved past it. `bash plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh --pr 2 --worktree /Users/hiep/repo/runner-e2e-go-plain --card small-helpers --skip-gap-gate`
  run inside `$F` → `$E/g3-after-plain-pr2-verify-shipped.json`, verdict `PASS`. The rulings probe
  (`$FH/g3-rulings-baseline`, Task 3.4) → `$E/g3-after-rulings-probe.txt`, `exit 0`.

- [ ] **Step 2: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): G3' after — no Tribe point, stamp or ratification required"`

#### Done

```bash
! grep -E 'gapGateStamped|ledgerCommitted' docs/superpowers/evidence/2026-09-27-runner-driver-only/g3-after-plain-pr2-replay.txt
python3 -c "import json; assert json.load(open('docs/superpowers/evidence/2026-09-27-runner-driver-only/g3-after-plain-pr2-verify-shipped.json'))['verdict']=='PASS'"
grep -q 'exit 0' docs/superpowers/evidence/2026-09-27-runner-driver-only/g3-after-rulings-probe.txt
```

Expected: every command exits 0.

### Task 4.5: V4 — a Tribe-style plan on the same runner shows Tribe agents (real home)

**Why:** the Shaman's V4: "V2 + V4 together prove the plan, not the runner, decides." D9: V4 runs in
the owner's real home, where the agents exist.

**Files:** create `$E/v4-*`.

- [ ] **Step 1: Fixture** — reset `$F` to S0; commit on `$F` master (and push)
  `docs/plans/2026-09-27-tribe-style.md`: the SKILL.md "Tribe style — plan section" How-to-work block
  (Task 3.8), verbatim, followed by ONE task — Task 1 of the fixture plan (`### Task 1: \`mathx.Sum\``,
  its code and its four-command Done section) — and no gap-gate task (the card says a 1-task plan).
  Author `$FH/go-v4-tribe/campaign-state.json` (v2, card `v4-tribe`, that plan, one task) + empty
  `answers.md`.

- [ ] **Step 2: Run (real home — no `CLAUDE_CONFIG_DIR`)** — `env -u CLAUDE_CONFIG_DIR perl -e 'alarm 7200; exec @ARGV' bun plugins/tribe/scripts/runner/run.ts --repo $F --model sonnet --home $FH/go-v4-tribe --no-viewer > $E/v4-runner.txt 2>&1; echo "exit $?" >> $E/v4-runner.txt`;
  `bun $T/run-metrics.ts --home $FH/go-v4-tribe | tee $E/v4-run-metrics.txt`;
  `bun $T/bypass-audit.ts scan --home $FH/go-v4-tribe > $E/v4-tribe-scan.txt || true` (here the scanner
  is the positive oracle: it must see the dispatches). Then reset `$F` to S0.
  Expected: `TRIBE_AGENT_DISPATCHES` ≥ 1 with `hunter` ≥ 1 in the dispatch list; `BYPASS_TRIBE_DISPATCHES` ≥ 1.

- [ ] **Step 3: Commit** — `git add docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): V4 — a Tribe-style plan on the same runner dispatches Tribe agents"`

#### Done

```bash
python3 -c "import re; t=open('docs/superpowers/evidence/2026-09-27-runner-driver-only/v4-run-metrics.txt').read(); n=int(re.search(r'^TRIBE_AGENT_DISPATCHES=(\d+)', t, re.M).group(1)); assert n >= 1 and '\"hunter\"' in t, t"
grep -q '^BYPASS_TRIBE_DISPATCHES=[1-9]' docs/superpowers/evidence/2026-09-27-runner-driver-only/v4-tribe-scan.txt
```

Expected: every command exits 0.

### Task 4.6: V5 — the owner's shape: `/orchestrate-campaign` Stage A with no style named, in the sandbox

**Why:** the Shaman's V5 (D7). The skill must author a Tribe-free, Done-complete plan and a state the
runner accepts.

**Files:** create `$T/v5-stage-a.sh`, `$T/v5-check.sh`, `$E/v5-*`, `$E/d10-v5-*`.

- [ ] **Step 1: Write the two scripts** — `$T/v5-stage-a.sh`:

```bash
#!/usr/bin/env bash
# v5-stage-a.sh — V5 (card runner-driver-only, spec §6.6): a fresh headless session runs the
# orchestrate-campaign skill through Stage A only, on the Go fixture, naming NO plan style, inside the
# D9 sandbox. The caller sets CLAUDE_CONFIG_DIR. Prints V5_HOME=<new campaign home> and V5_SESSION=<id>.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'usage: v5-stage-a.sh <fixture-clone> <start-sha> <evidence-dir>' >&2; exit 2; }
F="$1"; START="$2"; E="$3"
[[ -n "${CLAUDE_CONFIG_DIR:-}" ]] || { echo 'v5-stage-a: CLAUDE_CONFIG_DIR (the D9 sandbox) is not set' >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$HERE/fixture-reset.sh" "$F" "$START"
HOMES="$(bash "$HERE/../../tribe-home.sh" "$F")/campaigns"
mkdir -p "$HOMES"
before="$(ls "$HOMES" | sort)"
PROMPT='Use the orchestrate-campaign skill (invoke it with the Skill tool). Orchestrate this one card on this repo, Stage A only: author the spec, the plan, campaign-state.json and answers.md, and land the spec and plan the way the skill says. Do NOT launch the runner, the watchdog or the supervisor. The card: add `mathx.Clamp(x, lo, hi int) int` (lo when x < lo, hi when x > hi, else x) with a table-driven test. Campaign slug: go-v5-stage-a.'
( cd "$F" && perl -e 'alarm shift; exec @ARGV' 3600 claude -p "$PROMPT" --model sonnet --permission-mode bypassPermissions --output-format json ) > "$E/v5-session.json"
session="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["session_id"])' "$E/v5-session.json")"
new="$(comm -13 <(printf '%s\n' "$before") <(ls "$HOMES" | sort))"
[[ "$(printf '%s\n' "$new" | grep -c .)" == "1" ]] || { echo "v5-stage-a: expected exactly one new campaign home, got: $new" >&2; exit 1; }
echo "V5_HOME=$HOMES/$new"
echo "V5_SESSION=$session"
```

  `$T/v5-check.sh`:

```bash
#!/usr/bin/env bash
# v5-check.sh — V5's pass condition (spec §6.6): the authored plan and state carry no Tribe
# instruction; every task heading of the plan is in the state's task index and resolves with at least
# one Done command (the runner's own plan-index); the runner's --dry-run accepts the state.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'usage: v5-check.sh <campaign-home> <fixture-clone>' >&2; exit 2; }
H="$1"; F="$2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="$(cd "$HERE/../../runner" && pwd)"
PASS=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; else FAIL=$((FAIL+1)); printf 'not ok - %s (got: %s, want: %s)\n' "$1" "$2" "$3"; fi; }
git -C "$F" fetch -q && git -C "$F" merge -q --ff-only origin/master
card="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sequence"][0])' "$H/campaign-state.json")"
plan="$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print(s["cards"][s["sequence"][0]]["plan"])' "$H/campaign-state.json")"
check "V5: the state is v2" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["v"])' "$H/campaign-state.json")" "2"
check "V5: the plan and state carry no Tribe way of working" "$(bun -e "import {readFileSync} from 'node:fs'; import {countTribeMentions,totalOf} from '$HERE/tribe-lexicon.ts'; console.log(totalOf(countTribeMentions(readFileSync('$H/campaign-state.json','utf8') + readFileSync('$F/$plan','utf8'))))")" "0"
check "V5: every task heading is indexed and resolves with Done commands" "$(bun -e "
import {readFileSync} from 'node:fs'; import {resolveTaskIndex} from '$R/core/plan-index.ts';
const s = JSON.parse(readFileSync('$H/campaign-state.json','utf8')); const c = s.cards[s.sequence[0]];
const md = readFileSync('$F/$plan','utf8');
const heads = md.split('\n').filter((l) => /^#{1,6}\s+Task \d/.test(l)).length;
const r = resolveTaskIndex('$card', c.tasks, md);
console.log(r.issues.length === 0 && heads === c.tasks.length && r.tasks.every((t) => t.doneCommands.length > 0) ? 'ok' : JSON.stringify({ heads, tasks: c.tasks.length, issues: r.issues }));
")" "ok"
set +e
out="$(bun "$R/run.ts" --repo "$F" --model sonnet --home "$H" --dry-run --no-viewer 2>&1)"; code=$?
set -e
check "V5: --dry-run accepts the state" "$code" "0"
check "V5: --dry-run names the card" "$(printf '%s' "$out" | grep -c "\"$card\"")" "1"
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo 'V5=PASS'; else echo 'V5=FAIL'; exit 1; fi
```

- [ ] **Step 2: Run** —

```bash
bun $T/bypass-audit.ts snapshot --sandbox $S --out $E/d10-v5-sandbox-before.json
CLAUDE_CONFIG_DIR=$S bash $T/v5-stage-a.sh $F 9bb6b2253a32453a8ffc2a7c473a0b97ea444498 $E | tee $E/v5-stage-a.txt
H=$(sed -n 's/^V5_HOME=//p' $E/v5-stage-a.txt); SID=$(sed -n 's/^V5_SESSION=//p' $E/v5-stage-a.txt)
bash $T/v5-check.sh "$H" $F | tee $E/v5-check.txt
cp "$H/campaign-state.json" $E/v5-authored-state.json
PLAN=$(python3 -c "import json,sys; s=json.load(open(sys.argv[1])); print(s['cards'][s['sequence'][0]]['plan'])" "$H/campaign-state.json"); cp "$F/$PLAN" $E/v5-authored-plan.md
T_MAIN=$(ls $S/projects/*/"$SID".jsonl)
bun $T/bypass-audit.ts scan --transcript "$T_MAIN" --claude-home $S --sandbox $S --snapshot-before $E/d10-v5-sandbox-before.json --repo $F | tee $E/d10-v5-scan.txt
```

  Expected: `V5=PASS`; `BYPASS_AUDIT=PASS` (the scan's `INFO_ORCHESTRATE_CAMPAIGN_SKILL_CALLS` ≥ 1 is
  expected here — V5 invokes that skill on purpose). Then the auditor subagent (spec §6.8) over the
  V5 transcript and its `subagents/` → `$E/d10-v5-auditor.md`; then reset `$F` to S0.

- [ ] **Step 3: Commit** — `chmod +x $T/v5-stage-a.sh $T/v5-check.sh && git add -A plugins/tribe/scripts/tests/runner-driver-only docs/superpowers/evidence/2026-09-27-runner-driver-only && git commit -m "chore(evidence): V5 — Stage A with no style named authors a simple, Done-complete plan (sandbox)"`

#### Done

```bash
grep -q '^V5=PASS$' docs/superpowers/evidence/2026-09-27-runner-driver-only/v5-check.txt
grep -q '^BYPASS_AUDIT=PASS$' docs/superpowers/evidence/2026-09-27-runner-driver-only/d10-v5-scan.txt
grep -q '^VERDICT: CLEAN$' docs/superpowers/evidence/2026-09-27-runner-driver-only/d10-v5-auditor.md
bash -n plugins/tribe/scripts/tests/runner-driver-only/v5-stage-a.sh
bash -n plugins/tribe/scripts/tests/runner-driver-only/v5-check.sh
```

Expected: every command exits 0.

### Task 4.7: PR 4 governance — the evidence index, README "verified live", C3

**Files:** create `$E/after.md`; modify `$R/README.md` ("What HAS been verified live" gains the V2/V3/V5
sandbox runs and the V4 positive control, with their evidence paths), `.c3/` (a change unit if
`c3-215`'s Change-Safety rows need the new E2E names or the sandbox procedure).

- [ ] **Step 1: `after.md`** — one row per goal/V-row of spec §6 (V1–V7, G3', G5, G6, D10): the
  BEFORE value (from `baseline.md`; the sandbox BEFORE numbers from spec §6.7's run), the AFTER value,
  the evidence file, PASS/FAIL. Every AFTER value is copied from an evidence file, never retyped from
  memory. Then a section `## Where everything is` (Shaman amendment A5 — the Shaman re-runs `go test`,
  the scanner and his own auditor at acceptance): one row per real run — `go-before` (real home),
  `go-before-sandbox`, `go-after` (V2), `go-v3-real` (V3b), `go-v4-tribe` (V4), the V5 home — giving its
  campaign home (absolute path), the Claude home it ran in (`$S` or `~/.claude`), and EVERY transcript
  path of the run (main sessions and `subagents/*.jsonl`), produced by
  `bun $T/bypass-audit.ts scan --home <campaign home> --claude-home <claude home> --json` (field
  `transcripts`; for V5, `--transcript <its main transcript>`) and pasted, not retyped — concrete
  absolute paths only in this section, no globs. Also list the fixture's final master sha and the
  three E2E scripts.

- [ ] **Step 2: README + C3** — as listed; `c3x check` → `ok: true`.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs: runner-driver-only evidence index and verified-live record"`, then open PR 4.

#### Done

```bash
test -s docs/superpowers/evidence/2026-09-27-runner-driver-only/after.md
! grep -n 'FAIL' docs/superpowers/evidence/2026-09-27-runner-driver-only/after.md
grep -q '^## Where everything is' docs/superpowers/evidence/2026-09-27-runner-driver-only/after.md
for h in go-before go-before-sandbox go-after go-v3-real go-v4-tribe; do grep -q "/Users/hiep/.tribe/-Users-hiep-repo-runner-e2e-go/campaigns/$h" docs/superpowers/evidence/2026-09-27-runner-driver-only/after.md || exit 1; done
python3 -c "import re,os; t=open('docs/superpowers/evidence/2026-09-27-runner-driver-only/after.md').read(); sec=t.split('## Where everything is',1)[1]; paths=re.findall(r'(/Users/[^\s\x60|*]+?\.jsonl)', sec); assert paths, 'no transcript path listed'; missing=[p for p in paths if not os.path.exists(p)]; assert not missing, missing"

C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1) && C3X_MODE=agent bash "$C3/bin/c3x.sh" check | grep -q 'ok: true'
```

Expected: every command exits 0.

---

## Verification contract

Spec §6 is the contract — the table there names, for every row, the command, where its output
lands, the pass condition, the MEASURED baseline, and the empty-implementation test. Tasks 1.9, 2.18,
3.9 and 4.1–4.7 execute it; `$E/after.md` (Task 4.7) is the closing record.

## Definition of done (card goal → proof)

| Card row | Proof | Task |
| --- | --- | --- |
| G1 — a plain plan runs to DONE through the runner | `$E/g3-after-v2-replay.txt` `SHIPPED=true`; `$E/v2-after-master.txt` master == origin, `go test` exit 0 | 4.2 |
| G2 — no Tribe agent, no Tribe workflow | `$E/v2-after-run-metrics.txt` 0/0; `$E/d10-v2-scan.txt` PASS; `$E/d10-v2-auditor.md` CLEAN | 4.2 |
| G2' / V1 — prompts carry no Tribe way of working | `$E/v1-after-prompts.txt` `G2_GATE=PASS`; `$E/v1-after-real-prompts.txt` 0 | 3.9, 4.2 |
| G3' — the done check requires nothing Tribe | `$E/g3-after-*` | 1.9, 4.4 |
| G4 — the runner runs each task's Done commands | `$E/v2-after-done.jsonl` | 4.2 |
| G5 — empty implementation never ships | `test-runner-done-empty.sh` `G5=PASS` | 2.15 |
| G6 — before/after dispatches, time, tokens | `$E/v2-before-after.md` | 4.2 |
| V3 / V4 / V5 / V6 / V7 | `$E/v3*`, `$E/v4*`, `$E/v5*`, `test-runner-task-index-refusal.sh`, `$E/v7-after-counts.txt` | 4.3, 4.5, 4.6, 2.16, 4.1 |
| D10 — no bypass | `$E/d10-{v2,v3,v5}-scan.txt` PASS + auditor files | 4.2, 4.3, 4.6 |
| Done = merged + latest | every PR merged regular; local master fast-forwarded; worktree removed | each PR |
