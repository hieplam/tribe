# Plan: supervisor-park-truth

**Spec:** `docs/superpowers/specs/2026-09-20-supervisor-park-truth-design.md`
**Card:** `supervisor-park-truth` · **Base:** `d77cecc` · **Branch:** `fix/supervisor-park-truth`

## Global Constraints

- **Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.**
- **Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**
- **Oracle (the card's, verbatim):** "Parking when the disk says the park is false = bug. Refusing to
  resume while a park is still TRUE = by design. Passing a guard for a branch whose own commits touch
  a locked path = bug." For the schema guard the oracle is **the card branch's OWN commits** — never
  `baseSha...mergeSha`, never `baseSha..<remote>/<baseBranch>`. **Under-checking is a bug;
  over-checking (failing closed on an undecidable range) is by design.**
- **TDD is mandatory.** Write the failing test, RUN it and paste the real failure, then the minimal
  implementation, then re-run. A task that never showed a red test is not done.
- **Every commit** carries the trailers `Tribe-Card: supervisor-park-truth` and
  `Tribe-Task: N/10`, as two lines of the commit message's ONE final paragraph. Tick this plan's
  checkboxes for your task in the SAME commit as the code. **No AI/agent co-author trailer and no
  "generated with" line of any kind** — plain, descriptive commit messages only.
- **Scope fence.** Do not touch `core/types.ts`, `core/state.ts` (read-only reuse only),
  `core/watchdog/**`, `plugins/tribe/scripts/viewer/**`, or `adapters/supervisor-io.adapter*.ts`
  (measured in spec §2.2: `listEntries`, `readFileOrEmpty` and `isProcessAlive` already cover the
  new observation, so no new IO primitive is needed). **Never change the shape of
  `campaign-state.json` or `campaign-report.json`** — that is owner-only; stop and report if your
  task seems to need it.
- **Environment facts, measured (spec §1.3) — they bind every test you write.**
  - This machine has **no `timeout(1)`**. Bound a subprocess in shell test code by running it in the
    background, polling `kill -0`, and killing on expiry. Never introduce a `timeout`/`gtimeout`
    dependency.
  - The default shell here is **zsh**, which does not word-split an unquoted `$VAR`. Pass every git
    pathspec as its own explicit argument; never build a pathspec list in one variable.
  - `supervise` fails closed on a `--home` outside the tribe root. A campaign home in a test must
    live under `"$(bash "$RUNNER/../tribe-home.sh" "$REPO")/campaigns/<slug>"`, exactly as
    `test-supervisor-e2e.sh` already does. This is correct behaviour — never weaken it.
  - Git calls in tests isolate host config: `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` set to
    `/dev/null` (`fail-closed-edges.md` obligation 2).
- **Preconditions before reading any test count:** `cd plugins/tribe/scripts/runner && bun install`.
  The untouched-tree floor measured on base `d77cecc` is **1137 pass / 0 fail**; it is a floor, never
  a target to match.
- **Ratchets:** the committed context ceilings in
  `docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json` may not rise. PR #161's false-stall
  ratchet may not regress. `test-watchdog-e2e.sh` must stay green (this card consumes its output).
- **Adjudication — REFUTED in advance** (do not raise these as findings):
  - "Delete the park file and restart is already documented" — that is the manual path; G3 requires
    the supervisor itself to re-observe. Both paths coexist.
  - "Widen `ParkReason` with a catch-all" — additive, specific entries only; this plan adds none.
  - "Hand-edit `campaign-state.json` to shipped" — forbidden; G4 must be mechanical.
  - `test-input-asymmetry.sh` fails identically on base `d77cecc` (inherited, out of fence). Note it,
    never fix it here.
  - `isProcessAlive` pid reuse — out of fence.
  - A stale C3 fact that Task 10 is scheduled to reconcile.

## Sub-plans and dependency waves

Two sub-plans own disjoint files and run concurrently in wave 1; wave 2 reconciles governance.

```
wave 1:  A (schema guard)  ||  B (park truth)
wave 2:  C (docs, ADR, C3)         [prereqs: A, B]
```

- **Sub-plan A — schema guard.** Tasks 1, 2. `owns_files`:
  `plugins/tribe/scripts/runner/core/verify.ts`, `plugins/tribe/scripts/runner/core/verify.test.ts`.
- **Sub-plan B — park truth.** Tasks 3-8. `owns_files`:
  `plugins/tribe/scripts/runner/core/supervisor/model.ts`,
  `plugins/tribe/scripts/runner/core/supervisor/truth.ts`,
  `plugins/tribe/scripts/runner/core/supervisor/truth.test.ts`,
  `plugins/tribe/scripts/runner/core/supervisor/decide.ts`,
  `plugins/tribe/scripts/runner/core/supervisor/decide.test.ts`,
  `plugins/tribe/scripts/runner/core/supervisor/loop.ts`,
  `plugins/tribe/scripts/runner/core/supervisor/loop.test.ts`,
  `plugins/tribe/scripts/tests/test-supervisor-park-truth.sh`.
- **Sub-plan C — governance.** Tasks 9, 10. `owns_files`:
  `plugins/tribe/skills/orchestrate-campaign/SKILL.md`,
  `plugins/tribe/scripts/runner/README.md`, `docs/superpowers/specs/`, `.c3/`.
  `prereqs: A, B`.

---

## Sub-plan A — the schema guard's real oracle

### Task 1: the guard's failing proof, both directions

- Modify: `plugins/tribe/scripts/runner/core/verify.test.ts` (add a describe block)

Build two REAL git repositories in temp dirs and run the real `checkSchemaGuard` through
`verifyShipped`'s own seam. Direction 1 is the recorded false positive; direction 2 is the
under-check the Oracle forbids. Both must be present or the task is incomplete.

Add this helper and block. `makeRepo` creates master, a card branch off it, then a **master-side**
locked-path commit, then merges master into the branch, then merges the branch into master with
`--no-ff` (a regular merge — the only kind the campaign permits):

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Host git config neutralised (fail-closed-edges obligation 2) and every call bounded. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
           GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.test',
           GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.test' },
  });
}

function commitFile(repo: string, rel: string, body: string, msg: string): void {
  const abs = join(repo, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
  git(repo, 'add', rel);
  git(repo, 'commit', '-q', '-m', msg);
}

/** `branchTouchesLockedPath` selects the DIRECTION under test. Returns the repo root, the
 * card's baseSha, and the merge commit sha. */
function makeRepo(branchTouchesLockedPath: boolean): { repo: string; baseSha: string; mergeSha: string } {
  const repo = mkdtempSync(join(tmpdir(), 'guard-'));
  git(repo, 'init', '-q', '-b', 'master');
  commitFile(repo, 'README.md', 'base\n', 'init');
  const baseSha = git(repo, 'rev-parse', 'HEAD').trim();

  git(repo, 'checkout', '-q', '-b', 'card');
  commitFile(repo, 'src/feature.ts', 'export const a = 1;\n', 'card work');
  if (branchTouchesLockedPath) {
    commitFile(repo, 'locked/schema.ts', 'export type X = 2;\n', 'card edits a locked path');
  }

  git(repo, 'checkout', '-q', 'master');
  commitFile(repo, 'locked/schema.ts', 'export type X = 1;\n', 'master-side locked-path change');

  git(repo, 'checkout', '-q', 'card');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge master into card', 'master');

  git(repo, 'checkout', '-q', 'master');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'card');
  const mergeSha = git(repo, 'rev-parse', 'HEAD').trim();
  return { repo, baseSha, mergeSha };
}
```

Then the two assertions, driving the guard through the same `io` seam the module already uses in
this file (reuse this file's existing `VerifyIO` fake, swapping its `exec` for one that shells out
to real git in `cwd`):

```ts
describe('checkSchemaGuard: the oracle is the card branch OWN commits', () => {
  test('PASSES when only MASTER touched a locked path while the card was in flight', async () => {
    const { repo, baseSha, mergeSha } = makeRepo(false);
    try {
      const result = await runGuard({ repo, baseSha, mergeSha, lockedPaths: ['locked/'] });
      expect(result.passed).toBe(true);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  test('FAILS when the card branch OWN commit touched a locked path', async () => {
    const { repo, baseSha, mergeSha } = makeRepo(true);
    try {
      const result = await runGuard({ repo, baseSha, mergeSha, lockedPaths: ['locked/'] });
      expect(result.passed).toBe(false);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
```

Write `runGuard` as a thin local helper that calls the module's exported guard path with a real-git
`exec`. If the guard is not separately exported, drive it through `verifyShipped` with a `gh` stub
that reports the PR merged with `merge_commit_sha = mergeSha`, and read the `schemaGuard` point out
of `result.points`.

- [x] **Step 1: RED** run the two tests and paste the real output. Test 1 must FAIL (today's guard sees
      master's locked-path commit); test 2 must PASS (it fails for the right reason even today).
      Task 2 is what makes test 1 green **without** breaking test 2.

```bash
cd plugins/tribe/scripts/runner && bun test core/verify.test.ts 2>&1 | tail -25
```

Expected: test 1 fails with the guard reporting that the `locked/` schema-lock path changed since the card base; test 2 passes. Paste both.

- [x] **Step 2: Commit** `test(verify): pin the schema guard oracle to the card branch own commits`

### Task 2: make the guard diff the branch's own commits

- Modify: `plugins/tribe/scripts/runner/core/verify.ts`
- Modify: `plugins/tribe/scripts/runner/core/verify.test.ts`

Add the pure range decision next to `readAllowsSchemaChange`:

```ts
/** The schema guard's oracle (spec §2.1): the card branch's OWN commits. After a regular merge
 * that set is exactly the three-dot diff between the merge commit's two parents — `merge-base(p1,
 * p2)` is the last base-branch commit the branch absorbed, so every base-side change is excluded
 * by construction while all branch-authored work (including a sub-branch the card merged in) is
 * included. PURE: the caller reads the parents, this decides (`pure-core.md`). */
export type SchemaGuardRange =
  | { kind: 'range'; from: string; to: string }
  | { kind: 'refuse'; detail: string };

export function schemaGuardRange(input: { mergeSha: string | null; parents: string[] }): SchemaGuardRange {
  if (input.mergeSha === null) {
    return { kind: 'refuse', detail: 'the merge commit sha is unknown, so the card branch own commits cannot be identified' };
  }
  if (input.parents.length !== 2) {
    return {
      kind: 'refuse',
      detail: `the merge commit ${input.mergeSha} has ${input.parents.length} parent(s), not 2; `
        + 'only a regular merge leaves the two-parent anchor this guard needs (never squash, never rebase-merge)',
    };
  }
  return { kind: 'range', from: input.parents[0] as string, to: input.parents[1] as string };
}
```

Then, inside `checkSchemaGuard` (which gains a `mergeSha: string | null` parameter), replace the
`git diff` range. Read the parents at the edge, decide with the pure function, and **fail closed** on
a refusal:

```ts
const parentsResult = await run(io, config.repoRoot, ['git', 'rev-list', '--parents', '-n', '1', String(mergeSha)]);
const parents = parentsResult.exitCode === 0
  ? parentsResult.stdout.trim().split(/\s+/).slice(1)
  : [];
const range = schemaGuardRange({ mergeSha, parents });
if (range.kind === 'refuse') {
  return { id: 'schemaGuard', passed: false, detail: `cannot evaluate the schema guard: ${range.detail}` };
}
const result = await run(io, config.repoRoot, [
  'git', 'diff', `${range.from}...${range.to}`, '--', ...config.schemaLockPaths,
]);
```

Keep the `allowsSchemaChange` waiver, the empty-`schemaLockPaths` no-op, the missing-plan note and
the `card.baseSha` null check exactly as they are, but update the guard's detail strings so they name
the range actually used rather than `since <baseSha>`. Thread the argument at the call site — the
same pattern `checkGapGateStamped` already uses one line below:

```ts
const schema = await checkSchemaGuard(card, config, io, merged.mergeSha);
```

- [x] **Step 1: GREEN** both Task 1 tests pass, and no existing verify test regresses.

```bash
cd plugins/tribe/scripts/runner && bun test core/verify.test.ts 2>&1 | tail -15 && bunx tsc --noEmit
```

Expected: every test in `core/verify.test.ts` passes, `0 fail`; `tsc --noEmit` prints nothing.

- [x] **Step 2: Commit** `fix(verify): diff the card branch own commits in the schema guard`

---

## Sub-plan B — the park must be true

### Task 3: the supervisor E2E reproduction, committed

- Create: `plugins/tribe/scripts/tests/test-supervisor-park-truth.sh`

Promote the Warchief's grounding harness (archived verbatim at
`~/.tribe/-Users-hip-repo-tribe/reports/park-truth-repro.sh`) into a committed regression suite.
Read that file and follow its structure; it already encodes every environment fact above. Assert the
**fixed** behaviour, so the suite is RED on base:

- **G2 probe** — watchdog terminal `stalled` naming run A, a NEWER run B alive: the supervisor must
  NOT write `NEEDS_OWNER.md`, and `supervisor/events.jsonl` must contain no `"reason":"stalled"`
  park.
- **G5 probe** — run B finalised `exitCode: 2`, `reason: "escalations_pending"`: the supervisor must
  not park `stalled`; its decision must follow the run's own reason.
- **G3 probe** — restart with `NEEDS_OWNER.md` present and the park no longer true: a
  `park_superseded` event is appended, `NEEDS_OWNER.md` is gone, and exactly one
  `NEEDS_OWNER.md.superseded-*` file exists.
- **A negative probe, mandatory** — a park that IS still true (no newer run at all) must still refuse
  with `resume_blocked` and leave `NEEDS_OWNER.md` in place. *Refusing while the park is still TRUE
  is by design*; a suite that does not pin this direction proves nothing.

Use the same `ok`/`bad`/`check` helpers and the same `PASS`/`FAIL` counting as
`test-supervisor-e2e.sh`, exit non-zero when `FAIL > 0`, and `chmod +x` the file.

- [ ] **Step 1: RED** run it on the untouched tree and paste the output.

```bash
bash plugins/tribe/scripts/tests/test-supervisor-park-truth.sh 2>&1 | tail -30
```

Expected: the G2, G5 and G3 probes report `not ok`; the negative probe reports `ok`; the script exits
non-zero.

- [ ] **Step 2: Commit** `test(supervisor): reproduce the stale-park and stale-terminal defects E2E`

### Task 4: observe what `runs/` says

- Modify: `plugins/tribe/scripts/runner/core/supervisor/model.ts`
- Modify: `plugins/tribe/scripts/runner/core/supervisor/loop.ts`
- Modify: `plugins/tribe/scripts/runner/core/supervisor/loop.test.ts`

Add `RunFact` and the three observation fields exactly as spec §2.2 states them, then build them in
`observe()` using ONLY the existing seam methods:

```ts
/** Narrow, fail-closed reader for `<home>/runs/<runId>/run.json` — degrades to `null` on a
 * missing or malformed record, never throws into the tick loop (`fail-closed-edges.md`). */
function parseRunFact(io: SupervisorLoopSeam, raw: string, runId: string): RunFact | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;
  const pid = typeof r.pid === 'number' ? r.pid : null;
  const endedAt = typeof r.endedAt === 'string' ? r.endedAt : null;
  return {
    runId,
    pid,
    alive: endedAt === null && pid !== null && io.isProcessAlive(pid),
    endedAt,
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
    reason: typeof r.reason === 'string' ? r.reason : null,
  };
}
```

In `observe()`, list `join(homeDir, 'runs')` with `io.listEntries`, keep `isDir` entries, read each
`run.json` with `io.readFileOrEmpty` (path via `core/run-record.ts#runRecordPathOf`, imported
read-only), drop nulls, and **sort ascending by `runId`** (run ids are
`<ISO-with-dashes>-<hex>`, so lexicographic order is chronological). Set `watchdogRunId` from the
parsed watchdog status (add `runId` to that file's existing `WatchdogStatusFacts` narrow parser) and
`parkedTerminal` from `supervisor/status.json`'s `terminal` **only when `needsOwnerPresent`**.

No decision changes in this task: `decide()` must behave identically. Add unit tests to
`loop.test.ts` proving the three fields are populated from a fake seam (including a malformed
`run.json` yielding no entry rather than a throw, and an unsorted directory listing coming back
sorted).

- [ ] **Step 1: GREEN**

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/loop.test.ts 2>&1 | tail -12 && bunx tsc --noEmit
```

Expected: `0 fail`, the new observation tests pass, `tsc --noEmit` silent.

- [ ] **Step 2: Commit** `feat(supervisor): observe the runs directory as typed facts`

### Task 5: the two pure truth predicates

- Create: `plugins/tribe/scripts/runner/core/supervisor/truth.ts`
- Create: `plugins/tribe/scripts/runner/core/supervisor/truth.test.ts`

Write the tests first. The module is pure — no fs, no clock, no throw — and answers the card's two
questions:

```ts
export type TerminalContradiction =
  | { kind: 'newer_run_alive'; runId: string }
  | { kind: 'run_finalised'; runId: string; exitCode: number; reason: string | null };

/** "Does the disk contradict this terminal?" `null` when it does not — then every existing
 * decide() row behaves exactly as before. */
export function terminalContradiction(o: SupervisorObservation): TerminalContradiction | null;

/** "Is this park still true?" `true` for every park reason that is not a runner-liveness
 * claim — refusing to resume while a park is still TRUE is BY DESIGN. */
export function parkStillHolds(o: SupervisorObservation): boolean;
```

`terminalContradiction` returns `null` unless the watchdog published a terminal. Otherwise it looks
at the newest `RunFact` strictly newer than `o.watchdogRunId` (and, when none is newer, the run the
terminal is itself about): `newer_run_alive` when that run has `endedAt === null && alive`;
`run_finalised` when it carries both an `endedAt` and a numeric `exitCode`; `null` otherwise.
`watchdogRunId === null` returns `null`.

`parkStillHolds` returns `false` only when `o.parkedTerminal` is non-null, its `reason` is a
runner-liveness claim (`'stalled'`), and `terminalContradiction(o) !== null`. Every other input
returns `true`.

Cover at minimum: no terminal; terminal with no runs; terminal with an older run only; newer run
alive; newer run finalised; newer run neither alive nor finalised; `parkedTerminal` null;
`parkedTerminal` with a non-liveness reason (must hold); `parkedTerminal` stalled with no
contradiction (must hold).

- [ ] **Step 1: GREEN**

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/truth.test.ts 2>&1 | tail -12
```

Expected: every case passes, `0 fail`.

- [ ] **Step 2: Commit** `feat(supervisor): pure predicates for park truth and terminal contradiction`

### Task 6: a superseded park no longer blocks the restart (G3)

- Modify: `plugins/tribe/scripts/runner/core/supervisor/model.ts`
- Modify: `plugins/tribe/scripts/runner/core/supervisor/decide.ts`
- Modify: `plugins/tribe/scripts/runner/core/supervisor/decide.test.ts`

Add the action kind to `SupervisorAction`:

```ts
| { kind: 'supersede_park'; priorReason: string; detail: string }
```

Rewrite row P2 (`decide.ts:119-121`) and nothing else:

```ts
// P2: an unresolved park is never silently resumed — but a park whose stated condition the disk
// has already falsified is SUPERSEDED, not obeyed (G3). `parkStillHolds` is the pure predicate;
// a park that still holds refuses exactly as before.
if (o.needsOwnerPresent) {
  if (!parkStillHolds(o)) {
    return {
      kind: 'supersede_park',
      priorReason: o.parkedTerminal?.reason ?? 'unknown',
      detail: 'the park condition no longer holds on disk; re-observing and continuing',
    };
  }
  return park('resume_blocked', 'NEEDS_OWNER.md is present; resume is blocked until the owner deletes it');
}
```

Add tests both ways: a stale park yields `supersede_park`; a park that still holds yields
`resume_blocked` with the unchanged message. Assert explicitly that rows P1, P3 and P4 still win
where they used to — a live foreign supervisor must still beat a stale park.

- [ ] **Step 1: GREEN**

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/decide.test.ts 2>&1 | tail -12
```

Expected: `0 fail`, including every pre-existing decide row test.

- [ ] **Step 2: Commit** `fix(supervisor): supersede a park the disk has already falsified`

### Task 7: never park on a terminal the disk contradicts (G2, G5)

- Modify: `plugins/tribe/scripts/runner/core/supervisor/decide.ts`
- Modify: `plugins/tribe/scripts/runner/core/supervisor/decide.test.ts`

Immediately after `const reason = w.terminal?.reason ?? null;` (line 141), consult the predicate.
**Insert only this; do not reorder rows 1-28:**

```ts
// G2/G5: the watchdog's terminal is an input, not a fact. When the disk contradicts it, the
// contradiction wins — the supervisor reads the runs directory it can read itself.
const contradiction = terminalContradiction(o);
let reason = w.terminal?.reason ?? null;
if (contradiction !== null) {
  if (contradiction.kind === 'run_finalised') {
    // G5: the run really finished while nobody was watching. Continue from the RUN's own
    // reason, so every row below decides on the truth instead of the stale terminal.
    reason = contradiction.reason ?? reason;
  } else {
    // G2: a newer run is alive. Re-run/attach the watchdog rather than park — bounded by the
    // same run cap and one-shot retrigger rows 16/24 already use, so this can never spin.
    const retries = o.state.retriggers['stale_terminal'] ?? 0;
    if (o.state.watchdogRuns < o.limits.maxWatchdogRuns && retries < 1) {
      return { kind: 'run_watchdog', cards: null, includeEscalated: false };
    }
  }
}
```

When the bound is spent, control falls through and the original terminal's park stands — assert that
explicitly.

Tests: the recorded shape (terminal `stalled`, newer run alive) yields `run_watchdog`, not
`park('stalled')`; the same shape with the retrigger spent yields `park('stalled')`; a finalised run
with `reason: 'escalations_pending'` routes into the escalation rows (rows 5-12) rather than parking;
a terminal with no contradiction yields byte-identical behaviour to today for `stalled`, `quota_cap`,
`overloaded`, `lock_conflict` and `error`.

- [ ] **Step 1: GREEN**

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/decide.test.ts 2>&1 | tail -12
```

Expected: `0 fail`; the pre-existing `stalled` park test still passes in its no-contradiction form.

- [ ] **Step 2: Commit** `fix(supervisor): let the disk overrule a watchdog terminal it contradicts`

### Task 8: perform the supersede at the edge

- Modify: `plugins/tribe/scripts/runner/core/supervisor/loop.ts`
- Modify: `plugins/tribe/scripts/runner/core/supervisor/model.ts`
- Modify: `plugins/tribe/scripts/runner/core/supervisor/loop.test.ts`

Handle the new action in the tick loop's action switch, using only existing seam methods:

1. append a `park_superseded` event to `supervisor/events.jsonl` carrying `priorReason` and the
   superseding fact;
2. `io.renameIfPresent(paths.needsOwner, `${paths.needsOwner}.superseded-${iso}`)` — **rename, never
   delete**, so the trail survives;
3. increment a new `staleTerminals` counter on `SupervisorStatus.counters` (supervisor-owned
   artifact; `campaign-state.json` and `campaign-report.json` are untouched);
4. **continue the loop** — never exit 20.

Add loop tests over the fake seam proving the rename happened, the event was appended, the counter
incremented, and the loop continued to a following tick.

- [ ] **Step 1: GREEN** the whole runner suite and the Task 3 E2E suite.

```bash
cd plugins/tribe/scripts/runner && bun test 2>&1 | tail -6 && bunx tsc --noEmit
bash plugins/tribe/scripts/tests/test-supervisor-park-truth.sh 2>&1 | tail -20
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -8
bash plugins/tribe/scripts/tests/test-watchdog-e2e.sh 2>&1 | tail -8
```

Expected: `bun test` reports `0 fail` with a pass count at or above the 1137 floor; `tsc` silent; the
park-truth suite now all `ok` and exit 0; the supervisor and watchdog E2E suites unchanged and green.

- [ ] **Step 2: Commit** `feat(supervisor): supersede a stale park and continue the campaign`

---

## Sub-plan C — governance (wave 2, prereqs A and B)

### Task 9: document the automatic path

- Modify: `plugins/tribe/skills/orchestrate-campaign/SKILL.md` (doorbell section only)
- Modify: `plugins/tribe/scripts/runner/README.md`

In the doorbell section, **keep the existing manual "delete `NEEDS_OWNER.md`" step exactly as
written** and add the automatic path next to it: on `supervise` start the supervisor re-observes, and
if the park's stated condition no longer holds it records `park_superseded`, renames the file to
`NEEDS_OWNER.md.superseded-<ts>`, and continues. Say plainly what a reader will see on disk.

In the runner README, extend the "State file schema" section with `runs/<runId>/run.json` as an input
the supervisor now reads, and document the schema guard's range as the card branch's own commits
(`<mergeSha>^1...<mergeSha>^2`), including the fail-closed behaviour on a non-two-parent merge. Do not
weaken the existing P11/R3 "never hand-edit `baseSha`" wording.

- [ ] **Step 1: GREEN**

```bash
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh 2>&1 | tail -12
```

Expected: the docs suite passes; exit 0.

- [ ] **Step 2: Commit** `docs(supervisor): document park supersession and the guard real range`

### Task 10: reconcile the architecture model

- Modify: `.c3/` facts for the three 2026-09-19 supervisor ADRs and component `c3-215`
- Modify: the runner's own ADRs covering the schema guard (find them with the c3 skill; do not guess)

The closing change-unit. Using the c3 skill wrapper from the repo root, reconcile every fact this
card changed: the supervisor's observation inputs now include `runs/<runId>/run.json`; `decide()`
gains the `supersede_park` action and the contradiction check; a new pure module
`core/supervisor/truth.ts` exists; the schema guard's oracle is the card branch's own commits. Add an
ADR entry for the guard's range change and for park supersession. Leave no fact describing the old
`baseSha..<remote>/<baseBranch>` range or the unconditional P2 refusal.

- [ ] **Step 1: GREEN**

```bash
cd /Users/hip/repo/tribe-wt/park-truth && c3x check 2>&1 | tail -20
```

Expected: `c3x check` reports ok with no drift against the reconciled facts.

- [ ] **Step 2: Commit** `docs(c3): reconcile supervisor and schema-guard facts for park truth`
