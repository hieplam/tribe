# Design: a park must be TRUE when it is written, and re-checked when it is read

**Card:** `supervisor-park-truth` (`~/.tribe/-Users-hip-repo-tribe/cards/supervisor-park-truth.md`)
**Base:** `d77cecc` (origin/master, contains PR #161's watchdog stall fix, which this card depends on)
**Branch:** `fix/supervisor-park-truth`
**Depends on:** `watchdog-stall-after-quota-relaunch` (PR #161 — removes the most common false
terminal; this card makes the supervisor robust to *any* false or stale terminal).

## Oracle (the card's, verbatim — this is the contract)

> Parking when the disk says the park is false = **bug**. Refusing to resume while a park is still
> TRUE = by design. Passing a guard for a branch whose own commits touch a locked path = **bug**.

For G1 specifically: the guard's oracle is **the card branch's OWN commits** — never
`baseSha...mergeSha`, and never `baseSha..<remote>/<baseBranch>`.

---

## 1. The problem, grounded

Two independent defects, both measured on campaign home
`~/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening/` (the first real supervised
campaign) and both re-measured from scratch for this spec.

### 1.1 G1 — the schema guard diffs master's own movement

`core/verify.ts:353-359`, verbatim:

```ts
const result = await run(io, config.repoRoot, [
  'git',
  'diff',
  `${card.baseSha}..${config.remote}/${config.baseBranch}`,
  '--',
  ...config.schemaLockPaths,
]);
```

The range is `baseSha..origin/master`. That is *every commit master gained since the card's base*,
not the card's work. Any concurrent PR touching a locked path therefore fails the guard for every
card in flight.

**Measured on the real repo** (locked paths = the four this campaign configured; `45acb45` is the
card's `baseSha`, `0ca94dc` the merge commit of PR #160):

| Range | Result on the four locked paths |
| --- | --- |
| `45acb45..0ca94dc^1` — today's guard, master at merge time | **5 viewer files changed → FAIL** |
| `45acb45...0ca94dc` — the shape the card's Why section cites | **5 viewer files changed → FAIL** |
| `0ca94dc^1...0ca94dc^2` — the branch's own commits | **empty → PASS** |

The five files are `plugins/tribe/scripts/viewer/{README.md, core/net.test.ts, core/net.ts,
serve.security.test.ts, serve.ts}`, and every one arrived from master-side PRs #158 (`a2717ea`) and
#159 (`1b961bb`), pulled into the card branch by its merge commit `a0f8ce8`. **No commit authored on
the card branch touched a locked path.** The escalation was a false positive, and the Shaman had to
rule R6 by hand while `campaign-state.json` still said `escalated` for a card `verify-shipped`
proved PASS.

> **Measurement note, recorded because it nearly cost a wrong conclusion.** The first run of the
> table above returned "empty" for all three rows. The cause was the shell, not the code: this
> environment's default shell is `zsh`, which does **not** word-split an unquoted `$VAR`, so a
> space-separated path list collapsed into one nonexistent pathspec and matched nothing. Every
> command in this spec and in the plan is therefore written with each pathspec as its own explicit
> argument. A test that builds a pathspec list from a variable must do the same.

### 1.2 G2 / G3 / G5 — a park outlives the truth

The recorded sequence, read off the campaign home:

- `watchdog/status.json` — `updatedAt: 2026-09-19T20:30:30.006Z`, `runId:
  "2026-09-19T19-29-58-328Z-dcb2"`, `stall.logPath` inside **that** run's `logs/`,
  `terminal: {status: needs_human, reason: stalled, exitCode: 10}`, `runnerPid: 21744`.
- `supervisor/events.jsonl` — `{"at":"2026-09-19T20:30:30.010Z","action":"park",
  "detail":{"kind":"park","reason":"stalled", "detail":"the watchdog observed a stalled runner"}}`.
- `runs/2026-09-19T20-30-30-069Z-6185/run.json` — a **newer** run, `pid: 21744` (the very pid the
  watchdog's own status names as alive), `startedAt: 2026-09-19T20:30:30.074Z`, and later
  `endedAt: 2026-09-19T22:48:45.898Z, exitCode: 2, reason: "escalations_pending"`.

So the supervisor parked `stalled` at 20:30:30Z while the runner it was supervising was alive and
went on to merge PR #160 at 22:47Z. Three artifacts told three different stories and none was the
whole truth.

Three distinct code defects produce that:

- **G2 — `core/supervisor/decide.ts:234`:** `if (reason === 'stalled') return park('stalled', ...)`.
  The watchdog's terminal is trusted with **no cross-check of the disk the supervisor can read
  itself**. `runs/` said a newer run was alive.
- **G3 — `core/supervisor/decide.ts:119-121` (row P2):**
  `if (o.needsOwnerPresent) return park('resume_blocked', 'NEEDS_OWNER.md is present; resume is
  blocked until the owner deletes it')`. Unconditional. A superseded park reads exactly like a live
  one until a human deletes the file.
- **G5 — `core/supervisor/loop.ts:461-463`:** `lastWatchdog` is built from `watchdog/status.json`
  alone. `runs/*/run.json` is never read by the supervisor, so a run that finalises while the
  supervisor is not watching (exit 2, `escalations_pending`) is never observed.

### 1.3 Reproduced E2E, before any fix was designed

Per the owner's bug-fix rule, all three were reproduced against campaign homes assembled from a bare
`mktemp -d`, driving the **real** `run.ts supervise` composition root (no live model: the card is
pre-marked shipped and the watchdog terminal is pre-seeded, so the supervisor reaches its
park/refuse decision without spawning anything). Harness and full output are archived at
`~/.tribe/-Users-hip-repo-tribe/reports/park-truth-repro.sh` and
`park-truth-evidence-before.txt`. Verbatim results on base `d77cecc`:

```
========== G2 — watchdog terminal 'stalled' (run A) while a NEWER run B is ALIVE ==========
<exit:20>
--- supervisor/events.jsonl ---
{"at":"...","action":"park","detail":{"kind":"park","reason":"stalled","detail":"the watchdog observed a stalled runner"}}
--- NEEDS_OWNER.md present? ---   YES
--- supervisor/status.json terminal ---   {'status': 'needs_owner', 'reason': 'stalled', 'exitCode': 20}

========== G5 — the run finalised (exit 2 / escalations_pending) while nobody watched ==========
<exit:20>
{"at":"...","action":"park","detail":{"kind":"park","reason":"stalled","detail":"the watchdog observed a stalled runner"}}
--- supervisor/status.json terminal ---   {'status': 'needs_owner', 'reason': 'stalled', 'exitCode': 20}

========== G3 — restart with NEEDS_OWNER.md present but the park's condition no longer true ==========
--- after run 1: NEEDS_OWNER.md present? ---   YES
--- RESTART (run B still alive; the park is no longer true) ---
<exit:20>
{"at":"...","action":"park","detail":{"kind":"park","reason":"resume_blocked","detail":"NEEDS_OWNER.md is present; resume is blocked until the owner deletes it"}}
--- superseded marker present? ---   (none)
```

That is the card's "Empty-implementation check" column, confirmed: *today it parks*, *today the
run's exit 2 was never observed*, *today it refuses unconditionally*.

Two environment facts the harness discovered, which bind every new test this card adds:

1. **There is no `timeout(1)` on this machine** and no shell suite in this repo uses one. New shell
   test code bounds a subprocess by running it in the background, polling `kill -0`, and killing on
   expiry (the harness above carries the helper). The obligation is "every subprocess in test code
   is bounded", not "call `timeout`".
2. **`supervise` fails closed on a `--home` outside the tribe root.** A campaign home in a test must
   live under `"$(bash tribe-home.sh "$REPO")/campaigns/<slug>"`, exactly as
   `test-supervisor-e2e.sh` already does. This is correct behaviour and must not be weakened.

---

## 2. The change

### 2.1 G1 — the guard's range becomes the branch's own commits

The oracle is the card branch's own commits. After a **regular merge** (the only merge this campaign
permits), that set is exactly the three-dot diff between the merge commit's two parents:

```
git diff <mergeSha>^1...<mergeSha>^2 -- <lockedPath> [<lockedPath> ...]
```

`merge-base(p1, p2)` is the last master commit the branch had absorbed, so **all** master-side
movement is excluded by construction — including movement pulled in by a `Merge origin/master`
commit on the branch — while every commit authored on the branch is included, whether it sits on the
branch's first-parent line or arrived from a sub-branch the card merged in. That last property is
why a parent-diff walk (`git log --first-parent --no-merges`) was rejected: it would silently miss a
locked-path change that reached the branch through a sub-branch merge, which is an **under-check**,
and under-checking is the direction the Oracle calls a bug.

Why not anchor on the moving `origin/master`: after the card merges, `origin/master` *contains* the
PR head, so `merge-base(origin/master, prHead) == prHead` and the diff is unconditionally empty —
the guard would become a silent no-op. The merge commit's own first parent is the correct fixed
anchor for "master as it was immediately before this card landed".

**Purity.** The range decision is a pure function; only the edge runs git:

```ts
// core/verify.ts — PURE
export type SchemaGuardRange =
  | { kind: 'range'; from: string; to: string }
  | { kind: 'refuse'; detail: string };

export function schemaGuardRange(input: { mergeSha: string | null; parents: string[] }): SchemaGuardRange;
```

- `mergeSha === null` → `refuse` ("the merge commit sha is unknown").
- `parents.length !== 2` → `refuse`, naming the count — a squash or rebase merge, or a
  fast-forward, leaves no two-parent anchor. This **fails closed**: the guard reports `passed:
  false` with an honest detail, never a silent pass. It is consistent with the campaign's
  `mergePolicy` ("regular merge only … never squash, never rebase-merge"), so it cannot fire on a
  compliant card.
- otherwise → `{ kind: 'range', from: parents[0], to: parents[1] }`.

The edge reads the parents with `git rev-list --parents -n 1 <mergeSha>` and hands them to the pure
function. `checkSchemaGuard` gains a `mergeSha: string | null` parameter, threaded at
`verify.ts:543` from `merged.mergeSha` — **exactly the pattern `checkGapGateStamped` already uses at
line 544**, so no new plumbing concept is introduced.

Unchanged by this card: the `allowsSchemaChange` front-matter waiver, the empty-`schemaLockPaths`
no-op, the missing-plan note, and the `isDocsOnlyDiff` D6 waiver (a different check, out of the
card's G1 scope — noted, not touched).

### 2.2 G2 / G3 / G5 — the supervisor observes the runs directory

One new primitive fact enters the observation: **what `<home>/runs/` says**. Everything else is a
pure decision over it.

**New types in `core/supervisor/model.ts`** (the supervisor's own vocabulary — deliberately *not*
`core/types.ts`, which is out of fence and stays untouched):

```ts
/** One run under `<home>/runs/<runId>/run.json`, narrowed to the fields a decision needs.
 * `alive` is the edge's `isProcessAlive(pid)` answer, never re-derived by the core. */
export interface RunFact {
  runId: string;
  pid: number | null;
  alive: boolean;
  endedAt: string | null;
  exitCode: number | null;
  reason: string | null;
}
```

`SupervisorObservation` gains three fields:

```ts
/** Every run under `<home>/runs/`, ASCENDING by runId. Run ids are `<ISO-with-dashes>-<hex>`
 * (core/run-record.ts#generateRunId), so lexicographic order IS chronological order. */
runs: RunFact[];
/** `watchdog/status.json`'s own `runId` — which run its terminal is ABOUT. */
watchdogRunId: string | null;
/** When `NEEDS_OWNER.md` is present: the park the supervisor itself recorded in
 * `supervisor/status.json`'s `terminal`. The park's stated condition, as a typed fact —
 * never parsed out of NEEDS_OWNER.md's prose. */
parkedTerminal: { reason: string; atMs: number } | null;
```

**New pure module `core/supervisor/truth.ts`** — the two questions the card names, as pure
functions over an observation (no fs, no clock, no throw):

```ts
/** "Does the disk contradict this terminal?" */
export type TerminalContradiction =
  | { kind: 'newer_run_alive'; runId: string }
  | { kind: 'run_finalised'; runId: string; exitCode: number; reason: string | null };
export function terminalContradiction(o: SupervisorObservation): TerminalContradiction | null;

/** "Is this park still true?" */
export function parkStillHolds(o: SupervisorObservation): boolean;
```

`terminalContradiction` returns non-null only when the watchdog published a terminal AND a run
strictly newer than `watchdogRunId` exists (or the terminal's own run has since finalised):
`newer_run_alive` when that run's `endedAt === null` and `alive`, `run_finalised` when it carries an
`endedAt` + `exitCode`. Absent a newer run, or with `watchdogRunId === null`, it returns `null` and
every existing row behaves exactly as today.

`parkStillHolds` is the G3 predicate: for a park whose recorded reason is a runner-liveness claim
(`stalled`, and the additive entries below), the park is superseded when `terminalContradiction`
reports either kind. For every other park reason it returns `true` — **refusing to resume while a
park is still TRUE is by design**, and this card narrows nothing else.

**`core/supervisor/decide.ts` changes — three edits, each at a named line:**

1. **Row P2 (line 119).** When `needsOwnerPresent` and `parkStillHolds(o) === false`, return the new
   action `{ kind: 'supersede_park', priorReason, detail }` instead of `park('resume_blocked', …)`.
   When the park still holds, the row is byte-for-byte what it is today.
2. **Before the terminal-reason rows (after line 141's `const reason = …`).** Consult
   `terminalContradiction(o)`:
   - `run_finalised` → the **effective terminal reason** becomes the run's own `reason` (the
     recorded case: `escalations_pending`). Every existing row keyed on `reason` then works
     unchanged — G5 needs no new row, only a truthful input. This is the whole design point: the
     supervisor continues *from the report*, never from the stale terminal.
   - `newer_run_alive` → return `{ kind: 'run_watchdog', cards: null, includeEscalated: false }`
     (re-run/attach) instead of parking, **bounded** by the existing idiom used by rows 16/24:
     `o.state.watchdogRuns < o.limits.maxWatchdogRuns` and a `retriggers['stale_terminal'] < 1`
     guard. Once the bound is spent the original park stands, so no tick can loop forever.
3. No other row is touched. Rows 1-28 keep their order and their first-match-wins contract.

**`SupervisorAction` gains one kind** — `{ kind: 'supersede_park'; priorReason: string; detail:
string }`. **`ParkReason` gains nothing**: superseding is an action, not a park. (The card permits
additive `ParkReason` entries; this design does not need one, so it adds none.)

**`SupervisorStatus.counters` gains `staleTerminals: number`** — the card requires G2's re-observation
to be "counted in `counters`". `supervisor/status.json` is the supervisor's own artifact; this is
**not** a change to `campaign-state.json` or `campaign-report.json`, which stay byte-shape identical
(that would be owner-only).

**Edge work in `core/supervisor/loop.ts`:**

- `observe()` reads `<home>/runs/` with the **existing** `io.listEntries`, each `run.json` with the
  existing `io.readFileOrEmpty`, and liveness with the existing `io.isProcessAlive` — through a new
  narrow, fail-closed parser `parseRunFact()` alongside the file's existing
  `parseWatchdogStatusFacts`/`parseCampaignReportFacts`, degrading to "absent" on malformed input
  rather than throwing. Path math reuses `core/run-record.ts#runRecordPathOf` read-only.
- **`adapters/supervisor-io.adapter.ts` is NOT touched.** The card allows an adapter change "only
  for a new primitive observation the pure core needs (say why)" — measured: `listEntries`,
  `readFileOrEmpty` and `isProcessAlive` already cover it, so no new primitive is needed and none is
  added.
- The `supersede_park` action handler: append a `park_superseded` event to
  `supervisor/events.jsonl`, rename `NEEDS_OWNER.md` → `NEEDS_OWNER.md.superseded-<ISO ts>` via the
  existing `io.renameIfPresent`, increment `staleTerminals`, and **continue the loop** (never exit
  20).

**`skills/orchestrate-campaign/SKILL.md`** — the doorbell section gains the automatic path
alongside the manual one. The existing "delete `NEEDS_OWNER.md`" step **stays valid and stays
written**; the addition says the supervisor now re-observes on start and may supersede the park
itself, leaving `NEEDS_OWNER.md.superseded-<ts>` behind as the audit trail.

### 2.3 G4 — mechanical, not a code change

G4 is a **consequence** of G1, verified not built: re-running the recorded `supervisor-hardening`
home with `--include-escalated` must flip the card to `shipped` with `pr 160` / `mergeSha 0ca94dc`,
with no hand edit. `checkMerged` already obtains `0ca94dc` from `gh api`, so the state file's
`mergeSha: null` is not an input. The run is performed against a **`mktemp` copy** of that home —
the real one is read-only evidence — and `campaign-state.json` is never hand-edited (the card
forbids it, and the runner README's P11/R3 forbids hand-editing `baseSha`).

---

## 3. Scope fence

**In:** `core/supervisor/**` (`model.ts`, `decide.ts`, `loop.ts`, new `truth.ts`) and their tests;
`core/verify.ts`'s schema guard and `core/verify.test.ts`;
`plugins/tribe/scripts/tests/test-supervisor-*`; the doorbell section of
`skills/orchestrate-campaign/SKILL.md`; the runner README; this spec, the ADRs and C3.

**Out, and untouched:** `core/types.ts`, `core/state.ts` (read-only reuse only);
`core/watchdog/**` (just shipped in #161 — its `status.json` is consumed as-is);
`adapters/supervisor-io.adapter*.ts` (no new primitive needed — §2.2);
`plugins/tribe/scripts/viewer/**`; `core/merge-gate.ts` (measured: the guard lives in
`core/verify.ts`, not here). No new session kind, no new permission, **no change to the shape of
`campaign-state.json` or `campaign-report.json`** — if G4 could not be met with existing fields the
card requires `NEEDS_DIRECTION` rather than a shape change; measured, it can (§2.3).

**Inherited, noted, not fixed (out of fence):** `test-input-asymmetry.sh` fails identically on base
`d77cecc` (recorded by the previous Warchief); `isProcessAlive` pid reuse.

---

## 4. Testing strategy

Four layers, each proving something the layer below cannot:

1. **Pure unit tests** (`core/supervisor/truth.test.ts`, `decide.test.ts`, `verify.test.ts`) — the
   decision tables. `schemaGuardRange` both directions and every refusal; `terminalContradiction`
   and `parkStillHolds` across newer-alive / finalised / no-newer-run / no-terminal; `decide()`'s
   three edited rows plus a regression assertion that rows 1-28 are otherwise unchanged.
2. **Guard integration against real git** (`core/verify.test.ts`) — a real repository built in a
   temp dir where master gains a locked-path commit *after* the card's base and the card branch
   merges master in: the guard **PASSES**. A second repo where the card branch's own commit edits a
   locked path: the guard **FAILS**. Both directions are mandatory (the card's G1 oracle). Git calls
   isolate host config (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` → `os.devnull`), per
   `fail-closed-edges.md` obligation 2.
3. **Supervisor E2E from a bare home** (`plugins/tribe/scripts/tests/test-supervisor-park-truth.sh`)
   — the §1.3 harness, promoted to a committed regression suite: the same three probes, now
   asserting the *fixed* behaviour, with homes under the real `tribe-home.sh` root and every
   subprocess bounded by the portable helper.
4. **Untouched suites stay green** — `bun test` (floor **1137 pass / 0 fail**, measured on base
   `d77cecc` after `bun install`), `bunx tsc --noEmit`, `test-supervisor-e2e.sh`,
   `test-watchdog-e2e.sh` (consumed, must not regress), `c3x check`.

Ratchets that may not move: the committed context ceilings in
`docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json` may not rise; PR #161's false-stall
ratchet may not regress.

## 5. Evidence plan

Captured by the Warchief, by running the repo's own harness — never a Hunter's claim:

- **G1:** the §1.1 table re-run on base and on the branch, plus the new guard test failing on base
  and passing on the branch.
- **G2/G3/G5:** `park-truth-evidence-before.txt` (already captured, §1.3) paired with an
  `after` run of the same harness on the branch.
- **G4:** `campaign-state.json` before/after from a `mktemp` **copy** of the recorded
  `supervisor-hardening` home, showing `escalated` → `shipped` with `pr 160` / `mergeSha 0ca94dc`,
  produced mechanically by `--include-escalated`.
- All gate outputs pasted into the PR body with their numbers.

## 6. Risk and rollback

| Risk | Mitigation |
| --- | --- |
| The new guard range under-checks and lets a real locked-path change through | Direction 2 of the G1 test is mandatory; the three-dot form includes sub-branch work, which the rejected first-parent walk would have missed |
| A squash/rebase merge makes the guard unable to decide | Fails **closed** with an honest detail; compliant cards cannot hit it (`mergePolicy`) |
| The re-observation loops forever re-running the watchdog | Bounded by the existing `maxWatchdogRuns` + a one-shot `stale_terminal` retrigger; once spent, the original park stands |
| A park is superseded that was actually still true | `parkStillHolds` returns `true` for every reason that is not a runner-liveness claim; the superseded file is renamed, never deleted, so the trail survives |
| Supervisor decisions become impure | `truth.ts` and `schemaGuardRange` are pure; only `observe()` and the action handler touch disk (`pure-core.md`) |

**Rollback:** every change is additive behind new observation fields and one new action kind.
Reverting the merge restores today's behaviour exactly; no persisted data shape changes, so a home
written by the new code is readable by the old code (`staleTerminals` is an unknown counter the old
reader ignores).
