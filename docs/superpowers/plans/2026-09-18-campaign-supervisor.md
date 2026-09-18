# Plan — Campaign supervisor: judgment without a babysitter (`campaign-supervisor`)

**Card:** `campaign-supervisor` (owner directive 2026-09-18 + issue #142)
**Author:** planning Warchief (How), 2026-09-18. The What/Why is the card; nothing here reopens it.
**This plan lands at:** `docs/superpowers/plans/2026-09-18-campaign-supervisor.md`
**Its spec lands at:** `docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md`
**Base:** `master` @ `4a6bbdb` · **Branch:** `feat/campaign-supervisor`
**Report file:** `~/.tribe/-Users-hip-repo-tribe/reports/campaign-supervisor.md`

---

## 0. The How decision, up front

**The supervisor is a subcommand of the existing runner CLI** — `bun run.ts supervise` — exactly as
the watchdog is, and for the same four reasons the watchdog's own ADR recorded:

| Force | Consequence |
| --- | --- |
| The card's scope fence: "Lands inside the existing runner tree as a subcommand, the way the watchdog did — no second installable, no second resolver" | `run.ts` is already the path `resolve-runner.sh` proves and `test-fresh-machine.sh` asserts. Zero new resolution, zero `install.sh` change |
| `structure.test.ts` (249 lines) enforces layout mechanically | `core/**` may name no `fs`/`child_process`/SDK specifier in any quote form; `process.exit` only in `cli/main.ts`; `process.env` only in `adapters/`; every `interface *IO`/`*Port` only in `ports/ports.ts`. The card's purity requirement is obtained, not re-implemented |
| One suite, one `package.json`, one `node_modules` | `cd plugins/tribe/scripts/runner && bun test` stays the single gate |
| The card's fence: "One-shot sessions spawn through the existing session port (`adapters/session.adapter.ts` stays the only SDK import)" | Satisfied by construction: the supervisor reaches a session through `SessionIO`, which `session.adapter.ts` already implements |

**Vocabulary placement.** The supervisor's own types live in `core/supervisor/model.ts` and the
ratchet's in `core/metrics/model.ts` — never `core/types.ts`. That file is the runner's shared
kernel and is treated here as untouchable, exactly as the watchdog treated it. Every member of the
new `SupervisorIO`/`TranscriptIO` ports is primitive-typed or reuses an interface already declared
in `ports/ports.ts`, so nothing in the kernel needs to move.

**Every edit to an existing file in this plan is additive**: new interfaces appended to
`ports/ports.ts`, two new `if (argv[0] === …)` blocks in `cli/main.ts` mirroring the existing
`watchdog`/`reset-card` blocks. No existing symbol changes shape. The 684 existing tests stay green
with their assertions unchanged.

### 0.1 Frozen How decisions (this plan's own law — resolved from the spec, never invented over it)

Each is a How-level gap the card does not spell out, frozen so a Hunter, a Skinner and a Tracker
read the same oracle. Spec section references are to
`docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md`.

- **S-P1 — first match wins.** `decide()` evaluates the four pre-loop rows, then the 28 main rows,
  top to bottom, returning on the first match (spec §3.4). Row order IS the contract; reordering
  rows is a behavioural change, never a refactor.
- **S-P2 — park is the default.** Any observation that does not positively establish "judgment is
  required" resolves to a `park`. Spawning when none was needed is the bug the card exists to
  remove; parking when a session could have ruled is by design (card Oracle).
- **S-P3 — decisions come from typed disk facts only.** Never from a session's `result` text, never
  from the report's prose `question` digest, never from a log body. The escalation file's
  `**Reason:**` value is admissible because it is a fixed-template field the runner writes from a
  closed vocabulary — `core/report.ts#extractQuestionDigest` already proves that line is machine
  readable.
- **S-P4 — the session rules, the supervisor archives** (spec §5.5). The one-shot session writes
  `answers.md` only; the supervisor performs the `escalations/<card>.md` rename after verifying the
  ruling. W3 is untouched because W3 governs `answers.md`.
- **S-P5 — the supervisor's write surface is exactly three locations**: `<home>/supervisor/**`,
  `<home>/NEEDS_OWNER.md`, and the escalation-file rename. Never `answers.md`, never
  `campaign-state.json`, never anything under `<home>/watchdog/` or `<home>/runs/`. Asserted by a
  test, not promised.
- **S-P6 — `R(card)` increments BEFORE the spawn.** A crash can then only over-count a ruling
  round, which fails closed into a park. Under-counting would risk a double ruling.
- **S-P7 — the supervisor never kills anything.** Not a runner, not a watchdog, not a session. A
  session's only bound is its own `AbortController`, which the SDK owns — the same shape
  `core/session.ts` already uses. This is the deliberate, documented `fail-closed-edges`
  obligation-3 exception, written as a comment at the spawn seam.
- **S-P8 — W7 is counted by the supervisor, in its own state** (spec §7). `autoAnswerRounds` from
  the report is carried for the owner's information and read by no decision row: verified, nothing
  in the runner ever increments it.
- **S-P9 — one-shot sessions set `cwd` to the campaign home**, which is what makes them
  attributable in the consolidated viewer with no viewer change (spec §14). Measured, not assumed.
- **S-P10 — `--campaign` is the owner-facing flag; `--home` is its test-facing alternative**,
  mutually exclusive, exactly one required. The home is derived by executing
  `plugins/tribe/scripts/tribe-home.sh`, which stays the only thing that knows the `~/.tribe` key
  derivation (wall W1); `core/` never spells `.tribe`.
- **S-P11 — de-duplicate transcript turns by `message.id`.** Measured: one API message spans
  several transcript lines, each repeating the full identical `usage` block. Per-line summing
  double-counts. Under-counting turns is a bug; over-reporting a skipped malformed line is by
  design.
- **S-P12 — the containment hook is the ONLY enforcement, so it is impure and it is proven by a
  real session** (spec §5.1, §19.4). Measured: with the hook removed, the same envelope wrote to
  the repo, to `/tmp`, and through a symlink out of the home — `permissionMode: 'default'` confines
  nothing and `additionalDirectories` is not a write boundary. The hook therefore follows
  `decideMergeGateHook(io)`'s existing builder shape (`buildContainmentHook(homeDir, io)`), resolves
  the target's deepest existing ancestor through `io.realpath`, and keeps only
  `containPath(resolved, home)` pure. A unit table alone does not discharge this; Task 13's opt-in
  real-session test does.
- **S-P13 — a ruling never rewrites history, and a violation never retries** (spec §5.2, §5.3,
  §3.4 rows V1-V2). The pre-session `answers.md` must be a byte prefix of the post-session file; a
  ratify session may change only the blocks named in `run.unratifiedRulings`. Measured: a session
  told to "write the exact text" replaced a 46-byte file with 16 bytes and would have passed every
  original postcondition. Retrying cannot undo that, so it parks.
- **S-P14 — the baseline is pinned to a byte cut, never to "the whole file"** (spec §15, §21 D2).
  Measured: the cited transcript was live while being measured (1,443 → 1,507 → 1,509 lines), so an
  unpinned baseline is not reproducible by anyone, including its author. Every entry records
  `cut: {lines, bytes, sha256}` over exactly that prefix; a changed prefix, a short file or a
  missing file is a typed status and exit 1, never a silent re-baseline.
- **S-P15 — the context ratchet is a committed per-kind ceiling, measured not guessed** (spec §15).
  The pinned baseline stays the historical record; the gate reads the ceiling file, whose values
  Task 20 writes as `measured_max × 1.5`. Lowering is free; raising requires a recorded Shaman
  ruling id. Until Task 20 runs, the gate falls back to the baseline and says
  `"ceilingSource": "baseline-fallback"` in its own output.

---

## Global Constraints

- **Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.**
- **Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see
  `plugins/tribe/rules/pure-core.md`).**
- **TDD, one unit of work per task.** Write the failing test, watch it fail, minimal code to green,
  keep the whole suite green, ONE commit. A task that dies mid-flight is discarded
  (`git reset --hard && git clean -fd`) and redone — never salvaged.
- **Commit messages are plain and descriptive and carry NO co-author or "generated with" trailer of
  any kind** (owner's non-negotiable rule). Follow the repo's existing style: a lowercase
  conventional-commit subject, e.g. `feat(supervisor): pure decision table (task 7/24)`.
- **Tick this plan's checkboxes for your task in the SAME commit as the code.** A task commit that
  changes code without ticking its own boxes fails the audit.
- **The 684 existing runner tests stay green and their assertions stay unchanged.** Every edit to an
  existing file is additive. If a task appears to require changing an existing symbol's shape, stop
  and report `NEEDS_CONTEXT` — that is an escalation trigger, not a judgment call.
- **Never touch `core/types.ts` or `core/state.ts`.** The supervisor's and the ratchet's vocabulary
  live in their own `core/supervisor/model.ts` and `core/metrics/model.ts` precisely so they do not.
  If a task seems to need an edit inside either, stop and report `NEEDS_CONTEXT`.
- **Never touch `plugins/tribe/scripts/viewer/**`.** Spec §14 proves G6 needs no viewer change; a
  viewer edit is out of fence and an automatic audit failure.
- **Never touch `core/watchdog/**` or the runner's exit codes, state schema or resume matrix.** The
  supervisor layers on the watchdog and observes it only through `watchdog/status.json` and the
  child's exit code.
- **Never write a real transcript's message text into the repo.** The ratchet commits numbers only
  (card: "Transcripts are machine-local and private").
- **Never write under `/Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/`.** Every test builds its
  own throwaway `HOME` under `mktemp -d` and deletes it. Never touch another worktree.
- **Environment facts.** `bun 1.3.14`, `python3 3.9.6`. **There is no `timeout`, `gtimeout` or
  `setsid` binary on this machine** — never write one into a script or test; bounded waits are
  hand-rolled poll loops, and detachment uses the double-fork one-liner
  `test-watchdog-detached.sh` already proves. Every Bash tool call caps at 600 s.
- **Measured baselines every task must preserve** (re-verified at Setup step 5):
  - `cd plugins/tribe/scripts/runner && bun test` → `684 pass, 0 fail, 26 files`
  - `cd plugins/tribe/scripts/runner && bunx tsc --noEmit` → silent, exit 0
  - `C3X_MODE=agent bash "$C3X_BIN" check` → `total: 52`, `ok: true` (zero errors — a single new
    error is a regression)
  - `bash plugins/tribe/scripts/tests/test-fresh-machine.sh` → green
- **C3 governance is reached only through the skill wrapper** —
  `C3X_BIN=/Users/hip/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3/bin/c3x.sh`,
  invoked as `C3X_MODE=agent bash "$C3X_BIN" <operation>`. `bunx @c3x/cli` is forbidden.
  `.c3/c3-2-plugins/c3-215-tribe.md` carries a `c3-seal:` — hand-editing it breaks the seal; every
  fact edit goes through an ADR plus a change-unit.
- **`brief-contracts.md` is binding on every dispatch.** Each task below carries its own `Oracle`,
  `Fence by intent`, `Governing quote` and `Adjudication rule` block; the Warchief copies that block
  verbatim into the Hunter's brief. A brief without them is a defective dispatch.
- **Known pre-existing red, out of fence, never repaired opportunistically:**
  `plugins/tribe/scripts/tests/test-input-asymmetry.sh` does not parse on `master`
  (`bash -n` → unexpected EOF). Do not run it as a gate, do not fix it.

---

## Setup (the Warchief does this; not a Hunter task)

```sh
# 1. The isolated worktree already exists from planning; a delivering Warchief re-creates it thus:
cd /Users/hip/repo/tribe
git worktree add /Users/hip/repo/tribe-wt/campaign-supervisor -b feat/campaign-supervisor 4a6bbdb

# 2. node_modules is gitignored, so a fresh worktree's runner dir has none and every test
#    fails for the wrong reason.
cd /Users/hip/repo/tribe-wt/campaign-supervisor/plugins/tribe/scripts/runner && bun install

# 3. Record the base sha.
git -C /Users/hip/repo/tribe-wt/campaign-supervisor rev-parse HEAD

# 4. Land the spec and this plan as the branch's first commit.

# 5. Re-verify every baseline BEFORE dispatching Task 1.
cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
cd /Users/hip/repo/tribe-wt/campaign-supervisor
C3X_MODE=agent bash "$C3X_BIN" check
bash plugins/tribe/scripts/tests/test-fresh-machine.sh
```

Expected: worktree created, `107 packages installed`, `684 pass, 0 fail`, `tsc` silent,
`total: 52` with `ok: true`, and `test-fresh-machine.sh` green.

**Waves.** One worktree, one Hunter in flight at a time, five strictly ordered phases. There is no
sub-plan split: every task depends on vocabulary or a file the previous one landed.

**Phase gate.** A phase's C3 reconciliation task is the last task of that phase, per
`brief-contracts.md`'s sequencing rule ("governance work belongs at the end of each phase, not the
end of the project"). The next phase does not start until it is green.

---

# PHASE 1 — The ratchet (G0). Nothing else may land first.

The owner directive is explicit: the baseline tool and its committed numbers land **before** the
supervisor is built. A number nobody can reproduce is not evidence.

## Task 1: Transcript vocabulary and the pure trigger classifier

**Depends on:** Setup. **Model tier: `sonnet`** — mechanical, fully specified below: one pure
function, one type file, a table-driven test whose rows are all given.

**Files:** create `plugins/tribe/scripts/runner/core/metrics/model.ts`,
`core/metrics/classify.ts`, `core/metrics/classify.test.ts`.

**Oracle.** Spec §15's classification rules ARE the contract. A `<task-notification>` whose text
contains `Monitor expired` is `monitor-expiry`; one containing an `<event>` element is
`monitor-event`; one containing neither (the background-command-completion shape) is
`task-notification`; anything else is `human`. Mis-bucketing the no-`<event>` shape is the exact
defect the card's original throw-away script had. Under-classifying is a bug; an extra typed class
is not.

**Fence by intent.** This task adds vocabulary and ONE pure function. It reads no file, sums
nothing, and touches no existing module.

**Governing quote** — the card, `## Measure first`, verbatim:
> "**Oracle for classification — the turn's TRIGGER, nothing subjective.** Each model turn is
> attributed to the most recent non-tool-result user-side message: `human` · `monitor-event` ·
> `monitor-expiry` · `task-notification` (other)."

**Adjudication rule — REFUTED in advance.**
- "the classifier should parse XML properly" — it must not; these are substring facts about a text
  blob, and a real XML parser would refuse the harness's non-XML payloads.
- "`human` is too broad" — by design: anything that is not a task-notification is a human turn.

**Steps**

- [x] **Step 1: Write the failing test.** `core/metrics/classify.test.ts`, table-driven:

```ts
import { describe, expect, test } from 'bun:test';
import { classifyTrigger, isToolResultCarrier, userText } from './classify.ts';

const ROWS: Array<[string, string]> = [
  ['plain prose from the owner', 'human'],
  ['<task-notification><event>[Monitor expired after 30m]</event></task-notification>', 'monitor-expiry'],
  ['<task-notification><event>COMMIT: abc123 update</event></task-notification>', 'monitor-event'],
  ['<task-notification><tool-use-id>t1</tool-use-id><status>completed</status></task-notification>', 'task-notification'],
  ['', 'human'],
];

describe('classifyTrigger', () => {
  for (const [text, want] of ROWS) {
    test(`${JSON.stringify(text).slice(0, 48)} -> ${want}`, () => {
      expect(classifyTrigger(text)).toBe(want);
    });
  }
  test('Monitor expired beats the presence of an event element', () => {
    expect(classifyTrigger('<task-notification><event>Monitor expired</event></task-notification>'))
      .toBe('monitor-expiry');
  });
});

describe('isToolResultCarrier', () => {
  test('an array content whose first block is a tool_result', () => {
    expect(isToolResultCarrier({ content: [{ type: 'tool_result' }] })).toBe(true);
  });
  test('a plain string content is not', () => {
    expect(isToolResultCarrier({ content: 'hello' })).toBe(false);
  });
  test('a malformed message is not, and never throws', () => {
    expect(isToolResultCarrier(null)).toBe(false);
    expect(isToolResultCarrier({ content: [] })).toBe(false);
  });
});

describe('userText', () => {
  test('concatenates text blocks and ignores non-text blocks', () => {
    expect(userText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }))
      .toBe('ab');
  });
  test('a string content is returned as-is', () => {
    expect(userText({ content: 'plain' })).toBe('plain');
  });
});
```

Run it and watch it fail with a module-not-found error — that is the expected red.

- [x] **Step 2: Write `core/metrics/model.ts`** — types only, importing nothing local:
  `TriggerClass = 'human' | 'monitor-event' | 'monitor-expiry' | 'task-notification'`;
  `TokenSums { input: number; cacheRead: number; cacheWrite: number; output: number }`;
  `ClassMetrics { turns: number; tokens: TokenSums }`;
  `SessionMetrics { sessionId, lines, skippedLines, skippedReasons, turns, tokens, perClass,
  firstContext, lastContext, maxContext, monitorArms, monitorExpiries, firstAt, lastAt,
  babysittingShare, sidechain: ClassMetrics }`;
  `BaselineFile { v: 1; tool: string; generatedAt: string; sessions: SessionMetrics[] }`.

- [x] **Step 3: Write `core/metrics/classify.ts`** — three pure functions, no imports:
  `userText(message: unknown): string`, `isToolResultCarrier(message: unknown): boolean`,
  `classifyTrigger(text: string): TriggerClass`. Every one tolerates `null`/`undefined`/wrong
  shapes and returns a value rather than throwing.

- [x] **Step 4: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/metrics/ && bunx tsc --noEmit
```

Expected: the new file's tests pass (11 of them), `tsc` silent. Then `bun test` overall: expected
`695 pass, 0 fail`.

- [x] **Step 5: Commit** — `feat(metrics): transcript trigger vocabulary and classifier (task 1/24)`.

---

## Task 2: Pure accumulation — turns, de-duplication, contexts, babysitting share

**Depends on:** Task 1. **Model tier: `sonnet`** — one pure reducer; every rule and every expected
number is stated below.

**Files:** create `core/metrics/accumulate.ts`, `core/metrics/accumulate.test.ts`.

**Oracle.** Spec §15's metric definitions. **De-duplication by `message.id` is mandatory**: measured
on a real 59-output-token session, one `message.id` appeared on two consecutive assistant lines each
repeating the full identical `usage` block. Double-counting is the defect; skipping a genuinely
distinct turn is the other. Context size for a turn is `input + cache_read + cache_creation`.

**Fence by intent.** Pure reduction over already-parsed row objects. It opens no file. The edge
(Task 3) does all reading.

**Governing quote** — the card, `## Measure first`, verbatim:
> "Turns are de-duplicated by API message id (one transcript line per content block otherwise
> double-counts usage). Sidechain (subagent) rows are excluded from the lead session's totals and
> reported separately."

**Adjudication rule — REFUTED in advance.**
- "rows without `isSidechain` should count as lead rows" — they are `attachment`/`ai-title`/
  `queue-operation`/`last-prompt` rows, which are neither user nor assistant and contribute nothing
  either way. Only `type === "user"` sets the trigger class; only `type === "assistant"` is a turn.
- "a missing usage field should be an error" — it reads as `0`; the assistant key set is measurably
  not fixed across sessions.

**Steps**

- [x] **Step 1: Write the failing test.** `core/metrics/accumulate.test.ts` — build rows as literal
  objects (no file IO) covering, at minimum:

```ts
import { expect, test } from 'bun:test';
import { accumulate } from './accumulate.ts';

const asst = (id: string, usage: Record<string, number>, sidechain = false) => ({
  type: 'assistant', isSidechain: sidechain,
  message: { id, usage },
});
const user = (text: string) => ({ type: 'user', isSidechain: false, message: { content: text } });
const toolResult = () => ({
  type: 'user', isSidechain: false, message: { content: [{ type: 'tool_result' }] },
});

test('one message id spanning two lines counts as ONE turn with ONE usage', () => {
  const m = { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 7 };
  const out = accumulate([user('hi'), asst('msg_1', m), asst('msg_1', m)]);
  expect(out.turns).toBe(1);
  expect(out.tokens).toEqual({ input: 10, cacheRead: 5, cacheWrite: 2, output: 7 });
});

test('a tool_result user row never changes the trigger class', () => {
  const m = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const out = accumulate([
    user('<task-notification><event>COMMIT: x</event></task-notification>'),
    asst('a', m), toolResult(), asst('b', m),
  ]);
  expect(out.perClass['monitor-event'].turns).toBe(2);
  expect(out.perClass.human.turns).toBe(0);
});

test('sidechain turns are excluded from lead totals and reported separately', () => {
  const m = { input_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const out = accumulate([user('hi'), asst('a', m), asst('b', m, true)]);
  expect(out.turns).toBe(1);
  expect(out.sidechain.turns).toBe(1);
});

test('context is input + cache_read + cache_creation; first, last and max are tracked', () => {
  const mk = (r: number) => ({ input_tokens: 1, cache_read_input_tokens: r, cache_creation_input_tokens: 0, output_tokens: 0 });
  const out = accumulate([user('hi'), asst('a', mk(10)), asst('b', mk(99)), asst('c', mk(40))]);
  expect(out.firstContext).toBe(11);
  expect(out.lastContext).toBe(41);
  expect(out.maxContext).toBe(100);
});

test('babysitting share is monitor tokens over total, and is 0 with no monitor turns', () => {
  const m = { input_tokens: 0, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 0 };
  expect(accumulate([user('hi'), asst('a', m)]).babysittingShare).toBe(0);
});

test('a zero-token transcript reports share 0 rather than dividing by zero', () => {
  expect(accumulate([]).babysittingShare).toBe(0);
});

test('Monitor arms are counted from assistant tool_use blocks', () => {
  const out = accumulate([user('hi'), {
    type: 'assistant', isSidechain: false,
    message: { id: 'a', usage: {}, content: [{ type: 'tool_use', name: 'Monitor' }] },
  }]);
  expect(out.monitorArms).toBe(1);
});
```

- [x] **Step 2: Write `core/metrics/accumulate.ts`.** One exported pure function
  `accumulate(rows: unknown[]): SessionMetrics`, walking rows in order, holding the current trigger
  class and a `Set` of seen message ids. No clock, no fs, no throw.

- [x] **Step 3: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/metrics/ && bunx tsc --noEmit
```

Expected: all Task-1 and Task-2 tests pass (about 18), `tsc` silent.

- [x] **Step 4: Commit** — `feat(metrics): pure turn accumulation with message-id de-duplication (task 2/24)`.

---

## Task 3: The reading edge and the `transcript-metrics` subcommand (fail-closed)

**Depends on:** Task 2. **Model tier: `sonnet`** — an adapter plus a CLI block, both mirroring
existing ones in the same repo.

**Files:** create `adapters/transcript-io.adapter.ts`, `adapters/transcript-io.adapter.test.ts`,
`core/metrics/args.ts`, `core/metrics/args.test.ts`; append a `TranscriptIO` interface to
`ports/ports.ts`; append one dispatch block to `cli/main.ts`.

**Oracle.** `fail-closed-edges.md`. A line that fails `JSON.parse`, decodes as invalid UTF-8, or
parses to a non-object is **counted and skipped** with a typed reason — never a traceback, never a
silent undercount. A missing session id is a typed refusal naming it, exit 1. Over-reporting a
skipped line is by design; a traceback reaching the user is a bug.

**Fence by intent.** The edge only reads files line by line and resolves the projects root. Every
decision (classification, sums) already lives in the pure core.

**Governing quote** — `plugins/tribe/rules/fail-closed-edges.md`, verbatim:
> "**Catch narrowly, never bare.** Wrap external input in the *specific* exceptions it can raise —
> `json.JSONDecodeError`, `UnicodeDecodeError`, `re.error`, `OSError` — and convert each to a typed
> refusal."

and the viewer README, `## Run it`, verbatim:
> "**Projects root** (spec §5): `$CLAUDE_CONFIG_DIR/projects` when `CLAUDE_CONFIG_DIR` is set and
> non-empty, else `$HOME/.claude/projects`. An empty `CLAUDE_CONFIG_DIR=` is treated as unset."

**Adjudication rule — REFUTED in advance.**
- "read the file with `readFileSync`" — refused: the largest single measured line is 442,691 bytes
  and a real transcript is 4.6 MB. Stream line by line.
- "`structure.test.ts` will fail because the adapter reads `process.env`" — adapters are exactly
  where `process.env` is allowed; `core/metrics/**` must not name it.

**Steps**

- [ ] **Step 1: Write the failing tests.** `core/metrics/args.test.ts` mirrors
  `core/watchdog/args.test.ts`'s shape: every unknown flag rejected by name, `--session` repeatable
  and required at least once, `--json` boolean, `--project` optional, `--cut-bytes` a bounded
  positive integer, `--verify <path>` mutually exclusive with `--session`.
  `adapters/transcript-io.adapter.test.ts` writes a throwaway JSONL under `mktemp -d` containing:
  two valid rows, one line of `{not json`, one line that is a bare JSON array, and one empty line —
  then asserts `skippedLines === 2` (the array and the malformed line; a blank line is not a skip),
  `skippedReasons` names both kinds, and that no exception escaped.

- [ ] **Step 2: Append `TranscriptIO` to `ports/ports.ts`** — `readLines(path): Iterable<string>`,
  `readPrefix(path, bytes): { text: string; sha256: string; actualBytes: number }`,
  `fileExists(path): boolean`, `listProjectDirs(root): string[]`, `projectsRoot(): string`. Type
  declarations only, as that file requires. `readPrefix` is what makes S-P14's cut possible: it
  reads **exactly** `bytes` bytes and hashes exactly those, never the whole file.

- [ ] **Step 3: Write the adapter and the pure arg parser**, then the `cli/main.ts` dispatch block
  mirroring the `watchdog` one: parse, resolve, run, print, `process.exit`.

- [ ] **Step 4: Write the cut and `--verify`** (S-P14, spec §15). A run with `--cut-bytes n`
  measures only the first `n` bytes and emits a `cut` object. A run with `--verify <baseline.json>`
  re-measures every session at its recorded cut and compares, emitting one typed status per
  session — `verified` / `prefix_mismatch` / `truncated` / `absent` — and exiting `1` if any is not
  `verified`. It **never** rewrites the baseline.

  The failing test that pins the append-only assumption (spec §15, §19.5) — a fixture that GROWS
  between two measurements:

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureAtCut, verifyBaseline } from './cut.ts';

test('a transcript that GROWS still verifies byte-identically at its recorded cut', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    const row = (id: string) => JSON.stringify({
      type: 'assistant', isSidechain: false,
      message: { id, usage: { input_tokens: 1, cache_read_input_tokens: 2,
                              cache_creation_input_tokens: 0, output_tokens: 3 } },
    }) + '\n';
    writeFileSync(p, row('a') + row('b'));
    const first = measureAtCut(p, null);
    expect(first.cut.bytes).toBeGreaterThan(0);

    appendFileSync(p, row('c') + row('d'));           // the session kept running

    const again = measureAtCut(p, first.cut.bytes);
    expect(again.metrics).toEqual(first.metrics);      // the pinned numbers did not move
    expect(again.cut.sha256).toBe(first.cut.sha256);
    expect(verifyBaseline([{ sessionId: 's', path: p, ...first }])[0].status).toBe('verified');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a rewritten prefix is reported, never silently re-baselined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    writeFileSync(p, 'AAAA\n');
    const pinned = measureAtCut(p, null);
    writeFileSync(p, 'BBBB\nmore\n');                  // history rewritten
    const [r] = verifyBaseline([{ sessionId: 's', path: p, ...pinned }]);
    expect(r.status).toBe('prefix_mismatch');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file shorter than the cut is truncated, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cut-'));
  try {
    const p = join(dir, 's.jsonl');
    writeFileSync(p, 'AAAA\nBBBB\n');
    const pinned = measureAtCut(p, null);
    writeFileSync(p, 'AA');
    expect(verifyBaseline([{ sessionId: 's', path: p, ...pinned }])[0].status).toBe('truncated');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing file is absent, not a throw', () => {
  expect(verifyBaseline([{ sessionId: 's', path: '/nope/nope.jsonl',
    cut: { lines: 1, bytes: 1, sha256: 'x' }, metrics: {} as never }])[0].status).toBe('absent');
});
```

- [ ] **Step 5: Gate — run it against a REAL transcript** (`fixtures-mirror-reality.md` rule 2):

```sh
cd plugins/tribe/scripts/runner
bun test core/metrics/ adapters/transcript-io.adapter.test.ts && bunx tsc --noEmit
bun run.ts transcript-metrics --session 6a8a8fe4-f716-43f2-936f-0da47662d9d9 --json | head -40
bun run.ts transcript-metrics --session no-such-session-id-at-all ; echo "exit=$?"
```

Expected: tests green, including all four cut tests; the real session prints JSON carrying a `cut`
object with a `sha256`; the missing session prints one typed line naming the id and `exit=1` with
no stack trace. **Do not expect a particular turn count here** — that transcript is live and moves;
the pinned number is Task 4's business.

- [ ] **Step 6: Commit** — `feat(metrics): transcript reading edge, pinned cuts, and the transcript-metrics subcommand (task 3/24)`.

---

## Task 4: Measure and commit the baseline

**Depends on:** Task 3. **Model tier: `sonnet`** — running a committed tool and writing down what it
printed. Judgment is not required; fidelity is.

**Files:** create `docs/superpowers/evidence/2026-09-18-supervisor-baseline.json` and
`docs/superpowers/evidence/2026-09-18-supervisor-baseline.md`.

**Oracle.** The committed tool's output IS the baseline, **and it is pinned to a cut** (S-P14). Do
not hand-adjust a number to match the card's table or the spec's prose. **Numbers only** — the
baseline file must contain no message text, no prompt text, no file paths from inside a transcript.

**The turn/token totals are expected to differ from the spec's §1.1 table, and that is correct.**
Both cited transcripts were live while being measured during planning, so the numbers moved between
readings (spec §21 D2). Whatever the tool measures at the cut you take **is** the baseline; record
it and move on. The only numbers that must match exactly are the ones `--verify` produces on a
re-run of that same cut.

**Fence by intent.** Three evidence files and nothing else. No source change.

**Governing quote** — the card, `## Measure first`, verbatim:
> "**Only numbers are committed.** Transcripts are machine-local and private: the baseline file
> carries session ids, counts and token sums — never message text."

**Adjudication rule — REFUTED in advance.**
- "the numbers disagree with the card's table, so the tool is wrong" — the card explicitly rules the
  tool right once tested. Record the delta in the `.md` twin.
- "commit the transcripts as fixtures so the baseline is reproducible in CI" — forbidden by the
  quote above. Reproducibility is by session id on the owner's machine.

**Steps**

- [ ] **Step 1: Write the failing check.** Add `core/metrics/baseline.test.ts` asserting the
  baseline file exists, parses, has `v: 1`, carries exactly the two session ids, and that **every
  entry has a `cut` with a positive `bytes`, a positive `lines` and a 64-hex-character `sha256`** —
  an unpinned entry is a failed baseline (S-P14). Also assert its serialized text contains none of
  the strings `"content"`, `"text"`, `"prompt"` (the privacy wall, mechanically enforced). It fails
  now because the file does not exist.

- [ ] **Step 2: Generate the PINNED baseline.** Take the cut at each transcript's current length.

```sh
cd plugins/tribe/scripts/runner
bun run.ts transcript-metrics \
  --session 6a8a8fe4-f716-43f2-936f-0da47662d9d9 \
  --session ba6e93f0-72e4-4e08-9c64-03d7ea6fb917 \
  --json > ../../../../docs/superpowers/evidence/2026-09-18-supervisor-baseline.json
```

Expected: valid JSON, two entries, each carrying a `cut` object. The numbers will be close to the
planning measurements below but need not equal them — both sessions were live during planning:

| Session | turns (planning) | cacheRead (planning) | maxContext (planning) | babysittingShare |
| --- | --- | --- | --- | --- |
| `6a8a8fe4-f716-43f2-936f-0da47662d9d9` | 174 | 26,469,777 | 258,795 | 0.3168 |
| `ba6e93f0-72e4-4e08-9c64-03d7ea6fb917` | 154 | 28,075,416 | 307,375 | 0.5357 |

- [ ] **Step 3: Prove the pin holds.** This is what makes it a ratchet rather than a snapshot:

```sh
bun run.ts transcript-metrics --verify \
  ../../../../docs/superpowers/evidence/2026-09-18-supervisor-baseline.json ; echo "exit=$?"
```

Expected: both sessions report `"status": "verified"` with identical metrics and `exit=0` — even if
either transcript has grown since step 2, because each is re-measured only over its recorded cut.

- [ ] **Step 4: Create the ceiling file** at
  `docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json` with
  `{"v":1,"headroomFactor":1.5,"source":"unmeasured — task 20 writes these","ceilings":
  {"ruling":0,"ratify":0,"closing":0,"doorbell":0}}`. A `0` means "not yet measured": the checker
  falls back to the baseline figure and reports `"ceilingSource":"baseline-fallback"` (S-P15).
  Add `core/metrics/ceiling.test.ts` asserting: a `0` ceiling falls back and says so; a measured
  ceiling is used; **lowering a ceiling is accepted and raising one is refused** unless the entry
  carries a `raisedBy` ruling id — with the refusal naming both the old and the new value.

- [ ] **Step 5: Write the `.md` twin** — the measured table, the per-class breakdown, the cut for
  each session, the ratchet assertion (spec §15), and a "Deltas from the card's table" section
  recording spec §21's discrepancies **with D2's corrected explanation**: the turn/token deltas are
  a moving-file effect, not a classifier error; only the class-bucket deltas were mis-bucketed.

- [ ] **Step 6: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/metrics/ && bunx tsc --noEmit
grep -c '"content"' ../../../../docs/superpowers/evidence/2026-09-18-supervisor-baseline.json
python3 -c "import json;d=json.load(open('../../../../docs/superpowers/evidence/2026-09-18-supervisor-baseline.json'));print(all('cut' in s for s in d['sessions']))"
```

Expected: tests green including the baseline and ceiling tests; `grep -c` prints `0`; the python
line prints `True`.

- [ ] **Step 7: Commit** — `docs(evidence): pinned transcript baseline and the ratchet ceiling file (task 4/24)`.

---

## Task 5: Phase 1 governance reconciliation (C3)

**Depends on:** Task 4. **Model tier: `sonnet`** — a scripted wrapper workflow with every command
given; the judgment (what the ADR says) is supplied below.

**Files:** `.c3/adr/*` and `.c3/changes/<adr-id>/*`, created by the wrapper only.

**Oracle.** The C3 skill's own `references/change.md`. The wrapper is the only legal writer;
`c3-215-tribe.md` carries a `c3-seal:` and a hand edit breaks it. Baseline `check` is
`total: 52`, `ok: true` — a single new error is a regression.

**Fence by intent.** ONE ADR covering the ratchet, plus the minimum patch that makes `c3-215`'s
facts true: one Contract row for the `transcript-metrics` surface. No other entity is touched, and
the supervisor is NOT described yet — it does not exist.

**Governing quote** — `references/change.md`, verbatim:
> "Frozen facts change **only** through a change-unit (SKILL.md §The shared contract — cite it,
> don't re-derive it)."

**Adjudication rule — REFUTED in advance.**
- "fold the supervisor into this ADR too" — it has not been built; an ADR describing unbuilt code is
  a lie the seal will carry.
- "`bunx @c3x/cli` is faster" — forbidden.

**Steps**

- [ ] **Step 1: File-context gate, then author the ADR body outside `.c3/`.**

```sh
cd /Users/hip/repo/tribe-wt/campaign-supervisor
C3X_BIN=/Users/hip/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3/bin/c3x.sh
C3X_MODE=agent bash "$C3X_BIN" lookup plugins/tribe/scripts/runner/cli/main.ts
C3X_MODE=agent bash "$C3X_BIN" schema adr
C3X_MODE=agent bash "$C3X_BIN" add adr campaign-supervisor-ratchet --file adr-ratchet.md
```

The body states: the problem (the card's baseline numbers came from a throw-away script and were
measurably wrong in six ways), the decision (a committed, tested, token-free subcommand plus a
numbers-only baseline file, landing before any supervisor code), and the evidence (the two gate
commands and their measured outputs).

- [ ] **Step 2: Cite, scaffold, patch, apply.**

```sh
C3X_MODE=agent bash "$C3X_BIN" read c3-215 --section Contract --cite
C3X_MODE=agent bash "$C3X_BIN" change new <adr-id>
# author 01-contract-transcript-metrics.patch.md: scope insert, base = last Contract row
C3X_MODE=agent bash "$C3X_BIN" change view <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change accept <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change apply <adr-id>
C3X_MODE=agent bash "$C3X_BIN" check
```

Expected: `change view` shows one pending patch with no drift; `apply` lands it; `check` prints
`total: 53` (the entity count grows by the ADR) with `ok: true`.

- [ ] **Step 3: Commit** — `docs(c3): ADR and c3-215 contract row for the transcript ratchet (task 5/24)`.

---

# PHASE 2 — The pure supervisor core

Every module in this phase is pure: no clock, no filesystem, no spawn, no throw. That is what makes
the decision table testable as data.

## Task 6: Supervisor vocabulary, argument parsing, and home resolution

**Depends on:** Task 5. **Model tier: `sonnet`** — `core/watchdog/args.ts` is a 177-line worked
precedent for exactly this; follow it.

**Files:** create `core/supervisor/model.ts`, `core/supervisor/args.ts`,
`core/supervisor/args.test.ts`.

**Oracle.** `core/watchdog/args.ts`'s contract, applied verbatim: every unknown flag rejected BY
NAME, every required flag with no default, every protocol flag bounded and validated with a plain
decimal-integer literal test, and a value-taking flag refusing another flag's token as its value.
Strictness is the direction; leniency is the bug.

**Fence by intent.** Pure parsing and pure path math. No filesystem: resolving `--campaign` to a
home requires running `tribe-home.sh`, which is the adapter's job (Task 12) — this module produces
the *shape* and validates it.

**Governing quote** — the card, `## Ratified decisions`, item 2, verbatim:
> "**Driver = our own script, started manually by the owner, with a flag naming the campaign to
> watch.** No launchd/cron. The owner types a campaign identifier, not a hand-built home path
> (the home derivation stays owned by `tribe-home.sh`)."

**Adjudication rule — REFUTED in advance.**
- "`--home` should be removed since the owner types `--campaign`" — `--home` stays as the
  test-facing alternative (S-P10); the owner-facing path is unaffected.
- "exit code 0 and 1 collide with the runner's" — by design, spec §10: both existing CLIs already
  give them the same two meanings, and aligning is not colliding. `20`/`21` are the distinct codes.

**Steps**

- [ ] **Step 1: Write the failing test** covering, at minimum: `--campaign` and `--home` mutually
  exclusive; exactly one required; `--repo` and `--model` required; every flag in spec §8 parsed
  with its default and refused outside its bounds; `--max-spawns --repo` refused as
  "requires a value, got flag"; an unknown flag refused by name; and
  `supervisorHomeFromCampaign('/abs/tribe/home', 'slug')` returning `/abs/tribe/home/campaigns/slug`.

- [ ] **Step 2: Write `core/supervisor/model.ts`** — the complete vocabulary from spec §3.2, §3.3,
  §6.2, §8, §11, §13: `SupervisorObservation`, `EscalationFact`, `SupervisorAction`, `SessionKind`,
  `ParkReason` (all 20 values), `ParkMarkerKind` (both values), `SupervisorLimits`,
  `SupervisorState`, `SupervisorStatus`, `LedgerEntry`, and the four exit constants
  `SUPERVISOR_EXIT_DONE = 0`, `SUPERVISOR_EXIT_USAGE = 1`, `SUPERVISOR_EXIT_NEEDS_OWNER = 20`,
  `SUPERVISOR_EXIT_RUNNING = 21`. Imports nothing local.

- [ ] **Step 3: Write `core/supervisor/args.ts`.**

- [ ] **Step 4: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/ && bunx tsc --noEmit
bun test structure.test.ts
```

Expected: the new tests pass (about 30), `tsc` silent, and the structural contract still green —
including "no interface `*IO`/`*Port` declaration outside `ports/`".

- [ ] **Step 5: Commit** — `feat(supervisor): vocabulary, argument parsing and home path math (task 6/24)`.

---

## Task 7: `decide()` — the full decision table

**Depends on:** Task 6. **Model tier: `sonnet`** — the table is fully enumerated in spec §3.4; this
is transcription plus a row-per-test harness. It is the largest task in the plan and the most
mechanical.

**Files:** create `core/supervisor/decide.ts`, `core/supervisor/decide.test.ts`.

**Oracle.** Spec §3.4 IS the table, and **row order is the contract** (S-P1: first match wins). Any
observation not positively establishing "judgment is required" resolves to `park` (S-P2). A decision
derived from any text a model produced is a defect regardless of whether a test catches it (S-P3).

**Fence by intent.** One exported pure function `decide(o: SupervisorObservation): SupervisorAction`.
No clock (`nowMs` arrives on the observation), no fs, no throw, no `Math.random`.

**Governing quote** — the card, `## Oracle`, verbatim:
> "Spawning a session when none was needed = **bug** (that is the waste this card removes).
> Parking for the owner when a session could have ruled = **by design** (when in doubt, park).
> The supervisor deciding anything from an LLM's prose = **bug**. It reads typed disk facts only."

**Adjudication rule — REFUTED in advance.**
- "row 23 is unreachable, delete it" — it is a fail-closed backstop for a contract violation by the
  layer below, exactly like `watch-loop.ts`'s own `--once` attach invariant. Keep it and test it.
- "rows 18-22 are identical, collapse them into one" — they map to five distinct `ParkReason`
  values and five distinct `NEEDS_OWNER.md` sentences. Collapsing loses the owner's diagnosis.
- "the table should read `autoAnswerRounds`" — forbidden (S-P8): nothing increments it.

**Steps**

- [ ] **Step 1: Write the failing test** as ONE table, one case per row of spec §3.4 — 4 pre-loop
  rows plus 28 main rows, plus the tie-break cases below. Build a `base()` observation factory so
  each row states only its own differences:

```ts
import { expect, test } from 'bun:test';
import { decide } from './decide.ts';
import type { SupervisorObservation } from './model.ts';

const base = (over: Partial<SupervisorObservation> = {}): SupervisorObservation => ({
  nowMs: 1_000_000, stopFilePresent: false, needsOwnerPresent: false,
  supervisorLock: null, watchdogLive: null, lastWatchdog: null, report: null,
  escalations: [], ownerOnlyEscalations: [], unratifiedRulings: [], parkMarkers: [],
  state: { rulingRounds: {}, ratifyRounds: 0, spawns: 0, watchdogRuns: 0, seenEscalations: {},
           closingVerified: false, retriggers: {} },
  limits: { maxRulingRounds: 2, maxRatifyRounds: 2, maxSpawns: 8, maxWatchdogRuns: 20,
            sessionRetries: 1 },
  ...over,
});

const terminal = (reason: string) => ({ terminal: { status: 'needs_human', reason, exitCode: 10 }, ownedExitCode: 10 });

test('P1: a live foreign supervisor is refused, never duplicated', () => {
  expect(decide(base({ supervisorLock: { pid: 42, alive: true } })))
    .toEqual({ kind: 'park', reason: 'resume_blocked', detail: expect.any(String) });
});

test('P2: an existing NEEDS_OWNER.md blocks resume', () => {
  expect(decide(base({ needsOwnerPresent: true })).kind).toBe('park');
});

test('P4: a live watchdog is adopted, never a second one spawned', () => {
  expect(decide(base({ watchdogLive: { pid: 7, alive: true } })))
    .toEqual({ kind: 'await_watchdog', pid: 7 });
});

test('row 27: nothing has run yet this invocation', () => {
  expect(decide(base())).toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false });
});

test('row 12: a fresh answerable escalation spawns exactly one ruling session', () => {
  expect(decide(base({
    lastWatchdog: terminal('escalations_pending'),
    escalations: [{ cardId: 'c1', filePresent: true, contentSha256: 'h1',
                    reason: 'needs_direction', autoAnswerRounds: 0 }],
  }))).toEqual({ kind: 'spawn_session', session: 'ruling', cardId: 'c1' });
});

test('row 8: an owner-only trigger parks and never spawns', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    ownerOnlyEscalations: ['data-shape-change'],
    escalations: [{ cardId: 'c1', filePresent: true, contentSha256: 'h1',
                    reason: 'data-shape-change', autoAnswerRounds: 0 }],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'owner_only', detail: expect.any(String) });
});

test('row 10: W7 refuses the third ruling round on one card', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    state: { ...base().state, rulingRounds: { c1: 2 } },
    escalations: [{ cardId: 'c1', filePresent: true, contentSha256: 'h1',
                    reason: 'needs_direction', autoAnswerRounds: 0 }],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'w7_cap', detail: expect.any(String) });
});

test('row 9: the same escalation content after a ruling parks, never re-spawns', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    state: { ...base().state, seenEscalations: { c1: ['h1'] }, rulingRounds: { c1: 1 } },
    escalations: [{ cardId: 'c1', filePresent: true, contentSha256: 'h1',
                    reason: 'needs_direction', autoAnswerRounds: 0 }],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'repeat_escalation', detail: expect.any(String) });
});

test('row 8 outranks row 10: owner-only wins over a spent W7 budget', () => {
  const a = decide(base({
    lastWatchdog: terminal('escalations_pending'),
    ownerOnlyEscalations: ['privacy'],
    state: { ...base().state, rulingRounds: { c1: 2 } },
    escalations: [{ cardId: 'c1', filePresent: true, contentSha256: 'h1',
                    reason: 'privacy', autoAnswerRounds: 0 }],
  }));
  expect(a).toEqual({ kind: 'park', reason: 'owner_only', detail: expect.any(String) });
});

test('row 23: a --once-only reason is a contract violation and parks, never guesses', () => {
  expect(decide(base({ lastWatchdog: terminal('runner_alive') })))
    .toEqual({ kind: 'park', reason: 'unexpected_running', detail: expect.any(String) });
});

test('rows 18-22 each map to their own distinct park reason', () => {
  for (const r of ['quota_cap', 'overloaded', 'stalled', 'lock_conflict', 'error']) {
    expect(decide(base({ lastWatchdog: terminal(r) })))
      .toEqual({ kind: 'park', reason: r, detail: expect.any(String) });
  }
});

test('rows 1-3: runner_done closes, ratifies, or closes-out', () => {
  expect(decide(base({ lastWatchdog: { terminal: { status: 'done', reason: 'runner_done', exitCode: 0 }, ownedExitCode: 0 },
    state: { ...base().state, closingVerified: true } })))
    .toEqual({ kind: 'exit', status: 'done', reason: 'campaign_closed' });
  expect(decide(base({ lastWatchdog: { terminal: { status: 'done', reason: 'runner_done', exitCode: 0 }, ownedExitCode: 0 },
    unratifiedRulings: ['R7'] })))
    .toEqual({ kind: 'spawn_session', session: 'ratify', cardId: null });
  expect(decide(base({ lastWatchdog: { terminal: { status: 'done', reason: 'runner_done', exitCode: 0 }, ownedExitCode: 0 } })))
    .toEqual({ kind: 'spawn_session', session: 'closing', cardId: null });
});

test('the function is pure: the same observation decides the same action every time', () => {
  const o = base({ lastWatchdog: terminal('quota_cap') });
  expect(decide(o)).toEqual(decide(o));
  expect(decide(o)).toEqual(decide(structuredClone(o)));
});
```

Write one such case for **every** row of spec §3.4 — the list above is the shape and the hard cases,
not the whole set.

- [ ] **Step 2: Write `core/supervisor/decide.ts`** as a straight-line reading of spec §3.4, with a
  section comment per group of rows naming the spec row numbers.

- [ ] **Step 3: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/decide.test.ts && bunx tsc --noEmit
grep -nE "readFile|node:fs|child_process|Date\.now|Math\.random" core/supervisor/decide.ts
```

Expected: about 40 tests pass; `tsc` silent; the `grep` prints **nothing** (purity, checked
directly as well as by `structure.test.ts`).

- [ ] **Step 4: Commit** — `feat(supervisor): the pure decision table (task 7/24)`.

---

## Task 8: Postcondition verification and park-marker parsing

**Depends on:** Task 7. **Model tier: `sonnet`** — pure predicates over already-read strings, reusing
`core/rulings.ts` rather than re-implementing it.

**Files:** create `core/supervisor/verify.ts`, `core/supervisor/verify.test.ts`.

**Oracle.** Card guardrail 2: "Trust disk, not the session's word." A ruling counts only when a NEW
`## ` block exists whose `ratified-as:` value passes the EXISTING `isRulingRatified()` — do not write
a second vocabulary. A park marker counts only when it parses and its `kind` is one of the two
allowed values; anything else is `too_hard` plus a counted malformed-marker event.
**And history must be intact (S-P13):** the integrity check runs FIRST and its failure is not
retryable.

**Fence by intent.** Pure. It receives `answers.md`'s content before and after, the park-marker file
contents, and the `git status --porcelain` output — as strings. It reads nothing.

**Governing quote** — the card, `## Guardrails`, item 2, verbatim:
> "After a ruling session the supervisor checks postconditions: a new `R<n>` with a `ratified-as:`
> field AND the escalation file archived to `.resolved-R<n>`, OR an explicit typed park marker
> (owner-only / too-hard). Neither -> failed attempt: one bounded retry, then park."

Note S-P4: the archive half is performed by the supervisor after this check, not by the session.

**Adjudication rule — REFUTED in advance.**
- "the postcondition should also accept the session's `SHIPPED`-style result line" — forbidden
  (S-P3). The result line is recorded in the ledger and read by nothing.
- "a partially ratified `answers.md` is progress" — it is a failed attempt; see the ratify
  postcondition, which requires the unratified list to reach empty.

**Steps**

- [ ] **Step 1: Write the failing test.** Cases: a new ratified block → `ruled` with its id;
  a new block with `ratified-as: pending` → failed (the existing `isRulingRatified` says so);
  a new block with no `ratified-as:` at all → failed; no new block → failed; an unchanged
  `answers.md` plus a valid park marker → `parked` with the marker kind; a park marker with
  `kind: "banana"` → `parked` as `too_hard` and `malformedMarkers === 1`; unparseable marker JSON →
  the same, never a throw; a non-empty `git status --porcelain` → `failed` with reason
  `repo_touched`, **even when a valid ruling landed** (decision 4: a violation is a failed ruling).

- [ ] **Step 2: Write the failing integrity tests** (S-P13, spec §5.2/§5.3) — this is the half the
  original postconditions missed:

```ts
import { expect, test } from 'bun:test';
import { verifyRuling, verifyRatify } from './verify.ts';

const PRE = '# answers\n\n## R1 one\nratified-as: operational\n';
const APPENDED = PRE + '\n## R2 two\nratified-as: operational\n';

test('a legitimate append verifies as ruled', () => {
  expect(verifyRuling({ before: PRE, after: APPENDED, repoStatus: '' }).outcome).toBe('ruled');
});

test('a session that REPLACED the file parks history_rewritten, and is not retryable', () => {
  const clobbered = '## R2 two\nratified-as: operational\n';   // R1 is gone
  const v = verifyRuling({ before: PRE, after: clobbered, repoStatus: '' });
  expect(v.outcome).toBe('history_rewritten');
  expect(v.retryable).toBe(false);
});

test('a session that edited an EARLIER ruling parks history_rewritten', () => {
  const edited = PRE.replace('R1 one', 'R1 one (tidied)') + '\n## R2 two\nratified-as: operational\n';
  expect(verifyRuling({ before: PRE, after: edited, repoStatus: '' }).outcome).toBe('history_rewritten');
});

test('the integrity check runs BEFORE the new-block check: a clobber with a valid new block still parks', () => {
  const v = verifyRuling({ before: PRE, after: '## R2 two\nratified-as: rule docs/x.md\n', repoStatus: '' });
  expect(v.outcome).toBe('history_rewritten');
});

test('ratify may change only the ids it was given', () => {
  const before = '## R1 a\nratified-as: pending\n\n## R2 b\nratified-as: operational\n';
  const okAfter = '## R1 a\nratified-as: operational\n\n## R2 b\nratified-as: operational\n';
  expect(verifyRatify({ before, after: okAfter, named: ['R1 a'] }).outcome).toBe('ratified');

  const badAfter = '## R1 a\nratified-as: operational\n\n## R2 b\nratified-as: dismissed\n';
  const v = verifyRatify({ before, after: badAfter, named: ['R1 a'] });
  expect(v.outcome).toBe('ratify_out_of_scope');
  expect(v.retryable).toBe(false);
});

test('ratify that drops a ruling id entirely parks out_of_scope', () => {
  const before = '## R1 a\nratified-as: pending\n\n## R2 b\nratified-as: operational\n';
  expect(verifyRatify({ before, after: '## R1 a\nratified-as: operational\n', named: ['R1 a'] }).outcome)
    .toBe('ratify_out_of_scope');
});
```

- [ ] **Step 3: Write `core/supervisor/verify.ts`** — `verifyRuling`, `verifyRatify`,
  `verifyClosing`, `parseParkMarker`, all pure, importing `parseRulings`/`isRulingRatified` from
  `../rulings.ts`. Every returned verdict carries a `retryable: boolean`; the two integrity
  outcomes are the only ones that set it `false`.

- [ ] **Step 4: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/ && bunx tsc --noEmit
```

Expected: about 22 new tests pass, including all six integrity cases; everything from Tasks 6-7
still green; `tsc` silent.

- [ ] **Step 5: Commit** — `feat(supervisor): disk postconditions, ruling integrity and park markers (task 8/24)`.

---

## Task 9: The brief renderer

**Depends on:** Task 8. **Model tier: `sonnet`** — deterministic string assembly; every section and
every quote is enumerated in spec §5.2, §5.3, §5.4.

**Files:** create `core/supervisor/brief.ts`, `core/supervisor/brief.test.ts`,
`core/supervisor/brief-ruling.md`, `core/supervisor/brief-ratify.md`,
`core/supervisor/brief-closing.md` (templates beside the code, as `core/brief-template.md` already
is).

**Oracle.** `brief-contracts.md`'s four obligations, applied to a machine-rendered brief: name the
oracle, fence by intent, **quote the governing document verbatim with its section**, and carry the
adjudication rule. A paraphrase of a governing quote is a defect even if it reads better.

**Fence by intent.** Pure rendering from already-read disk facts to a string. It reads no file and
makes no decision; identical inputs render byte-identical output.

**Governing quote** — `plugins/tribe/rules/brief-contracts.md`, verbatim:
> "**Quote the governing document verbatim, with its section number.** A standing constraint that
> paraphrases a plan is a *new* claim, and it will differ from the plan in some case the author did
> not foresee. Cite; do not restate."

**Adjudication rule — REFUTED in advance.**
- "the brief should include the whole `answers.md` so the session has full context" — refused: G3
  (bounded context). The brief carries ruling **ids**, plus only the blocks the task needs.
- "the brief should tell the session to be careful" — prose exhortation is not a fence; the
  permission envelope (Task 13) is.

**Steps**

- [ ] **Step 1: Write the failing test.** Assert, for the `ruling` brief: it contains the escalation
  file content verbatim; it contains the `ownerOnlyEscalations` entries verbatim; it contains the
  W3 and W7 quotes **byte-identical** to the strings in `SKILL.md` (the test reads `SKILL.md` and
  greps its own rendered output for those exact substrings — this is what makes a future
  paraphrase fail); it lists the existing ruling ids; it names both exits; and it never contains the
  words "you may use bash". Assert determinism: two renders of the same facts are `toBe`-equal.
  Assert for the `ratify` brief that it names every unratified id. Assert for the `closing` brief
  that it contains Stage D's four numbered steps.

- [ ] **Step 2: Write the templates and `core/supervisor/brief.ts`** — one exported
  `renderBrief(kind, facts): string`. The governing quotes live in the template files as literal
  text; the test above is what keeps them honest against `SKILL.md`.

- [ ] **Step 3: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/brief.test.ts && bunx tsc --noEmit
```

Expected: about 12 tests pass, including the byte-identical-quote checks against the real
`SKILL.md`; `tsc` silent.

- [ ] **Step 4: Commit** — `feat(supervisor): pure brief renderer for the three session kinds (task 9/24)`.

---

## Task 10: State, status, ledger and exit-code shaping

**Depends on:** Task 9. **Model tier: `sonnet`** — mirrors `core/watchdog/status.ts` almost exactly.

**Files:** create `core/supervisor/state.ts`, `core/supervisor/status.ts`,
`core/supervisor/state.test.ts`, `core/supervisor/status.test.ts`.

**Oracle.** `core/watchdog/status.ts`'s contract: timestamps arrive as arguments, a non-finite
millisecond value renders `(invalid-timestamp)` rather than throwing, and serialization is total.
The `NEEDS_OWNER.md` sentence table is frozen: exactly one "what happened" sentence and one "what
unblocks it" instruction per `ParkReason`, all 20.

**Fence by intent.** Pure shaping. `state.ts` parses, applies one outcome, and serializes; it never
decides anything (that is `decide.ts`).

**Governing quote** — spec §11, `NEEDS_OWNER.md` format, and spec §6.2's 20-value `ParkReason`
union. The `ratified-as:` vocabulary quoted in any rendered text comes verbatim from
`core/rulings.ts`'s own documented set: `rule <path>` | `debt <id>` | `roadmap <ref>` |
`operational` | `dismissed`.

**Adjudication rule — REFUTED in advance.**
- "a `ParkReason` the table has no sentence for should render a generic message" — it must not
  compile: the sentence table is a `Record<ParkReason, …>`, so a missing entry is a type error.
  That is the point.

**Steps**

- [ ] **Step 1: Write the failing tests.** For `state.ts`: an absent state file parses to the zero
  state; an unknown-version file is a typed refusal; applying a `ruling` outcome increments that
  card's round and appends the content hash; serialize→parse round-trips byte-identically.
  For `status.ts`: `exitCodeOf` maps all four terminal shapes; `buildStatus` fills every field of
  spec §13; `renderNeedsOwner` produces a document containing the reason, the campaign home, the
  ledger lines, and a re-run command — and a table-driven case asserts **all 20** `ParkReason`
  values render a non-empty "what unblocks it" instruction.

- [ ] **Step 2: Write both modules.**

- [ ] **Step 3: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/ && bunx tsc --noEmit
```

Expected: about 30 new tests pass; `tsc` silent; the whole suite still green.

- [ ] **Step 4: Commit** — `feat(supervisor): persisted state, status publishing and the owner park document (task 10/24)`.

---

## Task 11: Phase 2 governance reconciliation (C3)

**Depends on:** Task 10. **Model tier: `sonnet`**.

**Files:** `.c3/changes/<adr-id>/*` via the wrapper only.

**Oracle.** As Task 5. Baseline after Task 5 is `total: 53`, `ok: true`.

**Fence by intent.** ONE change-unit recording that the supervisor's pure core exists: a Change
Safety row naming `core/supervisor/**` and its required verification. The permission model is NOT
described yet — it lands in Task 16, with the phase that builds it.

**Governing quote** — `plugins/tribe/rules/brief-contracts.md`, verbatim:
> "**governance work belongs at the end of each phase, not the end of the project.** Every code task
> leaves the architecture model slightly stale; if reconciliation is deferred to the end, the
> *next* task's reviewer flags the staleness as a finding and the cycle repeats."

**Adjudication rule — REFUTED in advance.**
- "wait and do all the C3 work once at the end" — refused by the quote above; that is the exact
  cycle this task exists to break.

**Steps**

- [ ] **Step 1: Cite, scaffold, patch, apply.**

```sh
cd /Users/hip/repo/tribe-wt/campaign-supervisor
C3X_MODE=agent bash "$C3X_BIN" read c3-215 --section 'Change Safety' --cite
C3X_MODE=agent bash "$C3X_BIN" change new <adr-id>
# 02-change-safety-supervisor-core.patch.md: scope insert, base = last Change Safety row.
# Risk: a wrong decision-table row spawns a session that was not needed, or parks one that was.
# Trigger: editing core/supervisor/**. Detection: the row-per-case decide.test.ts table.
# Required verification: cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
C3X_MODE=agent bash "$C3X_BIN" change view <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change accept <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change apply <adr-id>
C3X_MODE=agent bash "$C3X_BIN" check
```

Expected: one pending patch, no drift, `apply` lands it, `check` prints `total: 53` with
`ok: true`.

- [ ] **Step 2: Commit** — `docs(c3): change-safety row for the supervisor core (task 11/24)`.

---

# PHASE 3 — Edges, the loop, and the one-shot session

## Task 12: The `SupervisorIO` port and the real adapter

**Depends on:** Task 11. **Model tier: `sonnet`** — `adapters/watchdog-io.adapter.ts` is the worked
precedent for every primitive here.

**Files:** append `SupervisorIO` to `ports/ports.ts`; create
`adapters/supervisor-io.adapter.ts`, `adapters/supervisor-io.adapter.test.ts`.

**Oracle.** `fail-closed-edges.md`, all four obligations. Every `spawn`/`exec` carries a timeout;
every path from outside is resolved and proven inside the campaign home **before** anything opens,
writes, or renames through it; catches are narrow; the `git` calls that check the repo-untouched
postcondition neutralise host config (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` set to `os.devnull`)
so a host `commit.gpgsign` cannot change a verdict.

**Fence by intent.** The adapter performs; it decides nothing. Its members are exactly what the loop
needs: clock, atomic write, append, read, rename, directory listing, process liveness, the watchdog
child spawn, the `tribe-home.sh` execution, and the `git status --porcelain` probe.

**Governing quote** — `plugins/tribe/rules/fail-closed-edges.md`, verbatim:
> "**A path from outside is contained before it is used.** Any path read from a manifest, config,
> or user input is resolved and proven to sit inside its declared root — no `..` escape, no
> absolute path, no symlink that leaves the tree — *before* anything opens, writes, or deletes
> through it."

**Adjudication rule — REFUTED in advance.**
- "the watchdog child needs no timeout because supervision is unbounded by design" — correct for
  the child's *lifetime*, and it is S-P7's documented exception, written as a comment at the spawn
  seam. Every other subprocess (the `git` probe, `tribe-home.sh`) still carries one.
- "realpath only the home, not the root" — refused: a throwaway `HOME` under `/var/folders` resolves
  to `/private/var/folders`, so a string-prefix test refuses a legitimate home (W-P10, already
  learned once).

**Steps**

- [ ] **Step 1: Write the failing test.** Against a `mktemp -d` tree: an atomic write survives a
  concurrent read (temp-then-rename, never a truncated read); `renameIfPresent` on an absent file is
  a no-op, not a throw; a path containing `..` that escapes the home is refused **before** the file
  is opened; `readFileOrEmpty` on an unreadable file returns `''`; `listEntries` on a missing
  directory returns `[]`; the `git` probe sets both config env vars and carries a timeout.

- [ ] **Step 2: Append the port, write the adapter.** Note in the port's doc comment that
  `spawnWatchdog` returns a handle with no `kill` — S-P7.

- [ ] **Step 3: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test adapters/supervisor-io.adapter.test.ts && bun test structure.test.ts && bunx tsc --noEmit
```

Expected: about 12 new tests pass; the structural contract still green (the adapter is the only new
file naming `node:fs`/`node:child_process`); `tsc` silent.

- [ ] **Step 4: Commit** — `feat(supervisor): the IO seam and its fail-closed adapter (task 12/24)`.

---

## Task 13: Least privilege — the permission model and the one-shot session runner

**Depends on:** Task 12. **Model tier: `sonnet`** — the hook mirrors `core/session.ts`'s three
existing `PreToolUse` hooks exactly; the option block mirrors `buildSessionOptions`.

**Files:** create `core/supervisor/permit.ts`, `core/supervisor/permit.test.ts`,
`core/supervisor/session.ts`, `core/supervisor/session.test.ts`,
`plugins/tribe/scripts/tests/test-supervisor-permission-real.sh`.

**Oracle.** Owner decision 4, verbatim below. A `Write`/`Edit` whose resolved target is not inside
the campaign home is DENIED for a `ruling` or `ratify` session. Over-denying is by design;
one escaped write is the defect. The `closing` session is the named exception and is NOT hooked.

**This hook is the ONLY enforcement there is (S-P12).** Measured during planning (spec §19.4): with
the hook removed, the identical envelope wrote to the repo, to `/tmp`, and through a symlink out of
the home. `permissionMode: 'default'` confines nothing; `additionalDirectories` is a read
convenience, not a write boundary. Treat a defect here as a security defect, not a tidiness one.

**Fence by intent.** The *decision* — `containPath(resolvedTarget, homeDir)` — stays pure and
table-tested in `permit.ts`. The *hook* cannot be pure: catching the symlink case requires
resolving the target, so `buildContainmentHook(homeDir, io)` follows the builder shape
`core/session.ts`'s own `decideMergeGateHook(io)` already established. `session.ts` builds the
option block and consumes the message stream through the existing `SessionIO` seam — it never
imports the SDK.

**Governing quote** — the card, `## Ratified decisions`, item 4, verbatim:
> "**Least privilege for judgment sessions.** A ruling/ratify session may write only under the
> campaign home; the supervisor proves the target repo untouched (before/after) and treats a
> violation as a failed ruling. The closing session legitimately needs repo write (governance PR).
> **This permission model must be documented in C3** via a change-unit on c3-215."

**Adjudication rule — REFUTED in advance.**
- "grant `Bash` with a `mv`-only allowlist so the session can archive the escalation file" —
  refused by S-P4 and spec §5.5: the supervisor archives. A shell allowlist is escaped by a second
  command on the same line.
- "`permissionMode: 'bypassPermissions'` like the executor" — refused: the executor is trusted with
  the repo by design; a judgment session is not. Measured: `'default'` already lets the contained
  write through, so there is no functional reason to reach for it.
- "the hook should allow a write to `/tmp`" — refused: the campaign home is the only writable root.
- "`permit.ts` must be pure, so drop the symlink case" — refused: the symlink escape is one of the
  four shapes the real-session test exercises, and it was the one a lexical-only check would have
  let through. The purity line is drawn at `containPath`, not at the hook.
- "the unit table is enough; the real-session test is redundant" — refused by
  `fixtures-mirror-reality.md`: the unit table only distinguishes deny from not-deny, and cannot
  tell "allowed" from "silently refused by a permission layer with nobody to approve". Only a live
  session answers that, and the session double never exercises the permission layer at all.

**Steps**

- [ ] **Step 1: Write the failing test** for `permit.ts` as a table:

```ts
import { expect, test } from 'bun:test';
import { decideContainmentHook } from './permit.ts';

const HOME = '/abs/home/.tribe/key/campaigns/slug';
const ev = (tool: string, input: Record<string, unknown>) => ({ tool_name: tool, tool_input: input });
const denied = (d: ReturnType<typeof decideContainmentHook>) =>
  d.hookSpecificOutput?.permissionDecision === 'deny';

const ROWS: Array<[string, Record<string, unknown>, boolean]> = [
  ['Write', { file_path: `${HOME}/answers.md` }, false],
  ['Write', { file_path: `${HOME}/supervisor/park/c1.json` }, false],
  ['Write', { file_path: '/abs/repo/src/index.ts' }, true],
  ['Write', { file_path: `${HOME}/../other/answers.md` }, true],
  ['Edit',  { file_path: `${HOME}/../../escape.md` }, true],
  ['Write', { file_path: 'relative/path.md' }, true],
  ['Read',  { file_path: '/abs/repo/src/index.ts' }, false],
  ['Bash',  { command: 'rm -rf /' }, true],
  ['Write', {}, true],
  ['Write', { file_path: `${HOME}-sibling/answers.md` }, true],
];

for (const [tool, input, wantDeny] of ROWS) {
  test(`${tool} ${JSON.stringify(input)} -> ${wantDeny ? 'deny' : 'allow'}`, () => {
    expect(denied(decideContainmentHook(HOME, ev(tool, input)))).toBe(wantDeny);
  });
}

test('a malformed event denies rather than throwing', () => {
  expect(denied(decideContainmentHook(HOME, null))).toBe(true);
});
```

The `${HOME}-sibling` row is the segment-comparison case `containHome` already learned: a string
prefix is not containment. Note these rows drive `containPath` directly — the pure half. The hook
builder gets its own test with an injected fake `realpath`, including the symlink row: a target
under `<home>/link-out/x` whose `link-out` resolves outside the home must DENY, and the same path
whose `link-out` resolves inside must ALLOW. That pair is the one a lexical-only check gets wrong.

- [ ] **Step 2: Write `core/supervisor/permit.ts`** — the pure `containPath` reusing `containHome`'s
  segment logic from `core/watchdog/args.ts` rather than duplicating it, plus
  `buildContainmentHook(homeDir, io)` which resolves the target's deepest existing ancestor through
  `io.realpath` before calling it. A non-absolute path, or one that cannot be resolved at all, is
  denied.

- [ ] **Step 3: Write `core/supervisor/session.ts`** — `buildOneShotOptions(kind, config,
  abortController)` producing spec §5.1's envelope (`cwd` = the campaign home per S-P9,
  `settingSources: []`, `resume` never set, `permissionMode: 'default'`, the `disallowedTools`
  list, the containment hook for `ruling`/`ratify` only), and `runOneShotSession(...)` consuming
  the stream through `SessionIO`, writing `supervisor/sessions/<sessionId>.log`, and returning a
  typed result carrying the session id and the SDK `usage`/`total_cost_usd`/`permission_denials`.
  Test it with a scripted fake `SessionIO` — never the real SDK. Assert: `resume` is never present;
  `cwd` is the campaign home; `closing` gets no containment hook while `ruling`/`ratify` do; a
  spawn that throws resolves to a typed failure rather than rejecting; a timeout resolves to
  `timeout`.

- [ ] **Step 4: Write the opt-in REAL-session test** —
  `plugins/tribe/scripts/tests/test-supervisor-permission-real.sh`, gated behind `TRIBE_REAL_E2E=1`
  so `bun test` never bills anybody. It reproduces spec §19.4 exactly: a throwaway `HOME`, a fake
  repo root, a symlink inside the home pointing out of it, one live Haiku session under the REAL
  envelope, and a prompt asking for four writes in order — insisting each be attempted even if an
  earlier one is refused.

```sh
# (a) <home>/answers.md            MUST succeed  — the ruling path itself
# (b) <repo>/src/touched.txt       MUST be denied
# (c) /tmp/<unique>.txt            MUST be denied
# (d) <home>/link-out/escape.txt   MUST be denied (link-out resolves outside the home)
#
# Assert on DISK, not on what the model said:
#   a) the answers.md byte length changed
#   b,c,d) none of the three files exist
#   result.permission_denials names exactly the three denied calls
#   the run ended subtype=success with no prompt and no hang
```

Expected: `4 passed, 0 failed`, and the script prints the `permission_denials` payload so a reader
can see the three refusals. Skipped with a clear message when `TRIBE_REAL_E2E` is unset.

- [ ] **Step 5: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/ && bun test structure.test.ts && bunx tsc --noEmit
grep -rn "claude-agent-sdk" core/ | grep -v '\.test\.ts'
TRIBE_REAL_E2E=1 bash ../tests/test-supervisor-permission-real.sh
```

Expected: about 30 new tests pass; the structural contract green; `tsc` silent; the `grep` prints
**nothing** — `adapters/session.adapter.ts` remains the only SDK importer, as the card's fence
requires; and the real-session test reports `4 passed, 0 failed`.

- [ ] **Step 6: Commit** — `feat(supervisor): least-privilege permission model, proven against a live session (task 13/24)`.

---

## Task 14: The supervision loop

**Depends on:** Task 13. **Model tier: `sonnet`** — `core/watchdog/watch-loop.ts` is the worked
precedent: impure by injection only, every decision delegated to the pure core.

**Files:** create `core/supervisor/loop.ts`, `core/supervisor/loop.test.ts`.

**Oracle.** Spec §4.2's seven-step tick, in that order. **Step 4 (record the intent) happens before
step 5 (perform it)** — that ordering is what makes a crash diagnosable, and a test asserts it. The
loop carries out decisions; it makes none.

**Fence by intent.** One exported `runSupervisor(config, homeDir, io): Promise<SupervisorTerminal>`.
Every world effect arrives on `io`. It never calls `decide()`'s logic inline and never re-derives a
park reason.

**Governing quote** — the card, `## Scope fence`, verbatim:
> "Every loop step is resumable from disk alone (decision 2 makes manual restart the recovery
> path)."

**Adjudication rule — REFUTED in advance.**
- "increment the ruling round after the session returns so a failed spawn does not waste a round" —
  refused by S-P6: incrementing before means a crash over-counts, which fails closed into a park.
  Under-counting risks a double ruling, which is the harm.
- "the loop should retry a failed park write" — a park write that fails is an unrecoverable edge
  failure: print one typed line and exit `20` anyway, so the owner is never silently unnotified.

**Steps**

- [ ] **Step 1: Write the failing test** with a fully scripted fake `SupervisorIO` (no real fs, no
  real spawn). Assert, at minimum: the happy path `run_watchdog → escalations_pending → ruling
  spawn → verified → archive → run_watchdog → runner_done → closing → exit 0`; that `events.jsonl`
  records the intent line **before** the effect for every action; that the ruling round increments
  before the spawn; that a park writes `NEEDS_OWNER.md` then terminates with exit `20`; that
  `status.json` is published within the first tick with `terminal: null`; that a failed ruling
  retries exactly once and then parks; that the write surface touched by the whole run is exactly
  S-P5's three locations.

- [ ] **Step 2: Write `core/supervisor/loop.ts`.**

- [ ] **Step 3: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/loop.test.ts && bunx tsc --noEmit
```

Expected: about 20 tests pass; `tsc` silent.

- [ ] **Step 4: Commit** — `feat(supervisor): the observe-decide-perform-persist loop (task 14/24)`.

---

## Task 15: The `supervise` subcommand (composition root)

**Depends on:** Task 14. **Model tier: `sonnet`** — mirrors `cli/main.ts`'s existing `watchdog`
block line for line.

**Files:** append one dispatch block to `cli/main.ts`; extend `cli/main.test.ts`.

**Oracle.** The `watchdog` block's own shape: parse, resolve-and-contain the home with a typed
refusal, wrap `runSupervisor` in a narrow try/catch so no I/O failure escapes as a traceback, print
`status: <path>`, and `process.exit` with the mapped code. A traceback reaching the user is a defect
regardless of cause.

**Fence by intent.** One additive `if (argv[0] === 'supervise')` block. No existing block changes.

**Governing quote** — the card's scope fence, verbatim:
> "Lands inside the existing runner tree (`plugins/tribe/scripts/runner/`) as a subcommand, the way
> the watchdog did — no second installable, no second resolver."

**Adjudication rule — REFUTED in advance.**
- "`resolveWatchdogHome` should be renamed now that two subcommands use it" — refused: renaming an
  existing symbol breaks the additive constraint. Export a thin `resolveSupervisorHome` that calls
  it, or reuse it by its current name.

**Steps**

- [ ] **Step 1: Write the failing test** in `cli/main.test.ts`: `resolveSupervisorHome` refuses a
  home outside the tribe root, refuses one with no `campaign-state.json`, and accepts a good one;
  `--campaign` plus `--repo` derives the home through the injected `tribeHome` seam.

- [ ] **Step 2: Write the dispatch block.**

- [ ] **Step 3: Gate — run the real CLI's refusal paths.**

```sh
cd plugins/tribe/scripts/runner
bun test cli/main.test.ts && bunx tsc --noEmit
bun run.ts supervise ; echo "exit=$?"
bun run.ts supervise --repo /tmp --campaign x --model m --nonsense ; echo "exit=$?"
```

Expected: tests green; the first prints `supervise: missing required flag: --repo` with `exit=1`;
the second prints `supervise: unknown flag: --nonsense` with `exit=1`; neither prints a stack trace.

- [ ] **Step 4: Commit** — `feat(supervisor): the supervise subcommand (task 15/24)`.

---

## Task 16: Phase 3 governance — the ADR and the c3-215 least-privilege change-unit

**Depends on:** Task 15. **Model tier: `sonnet`** — the wrapper workflow is scripted; the ADR's
content is specified below.

**Files:** `.c3/adr/*` and `.c3/changes/<adr-id>/*` via the wrapper only.

**Oracle.** As Task 5, plus: **owner decision 4 mandates this change-unit by name.** It is not
optional and not deferrable to Task 24.

**Fence by intent.** ONE ADR for the supervisor itself, plus three patches on `c3-215`: a Contract
row for the `run.ts supervise` surface, a Business Flow amendment for the judgment path, and a
**Change Safety row documenting the least-privilege permission model**.

**Governing quote** — the card, `## Ratified decisions`, item 4, final sentence, verbatim:
> "**This permission model must be documented in C3** via a change-unit on c3-215."

**Adjudication rule — REFUTED in advance.**
- "the permission model is an implementation detail, not a C3 fact" — refused by the quote above;
  the owner named it explicitly.
- "fold this into Task 24's final sync" — refused: decision 4 ties it to the permission model, which
  lands in this phase.

**Steps**

- [ ] **Step 1: File-context gate and author the ADR.**

```sh
cd /Users/hip/repo/tribe-wt/campaign-supervisor
C3X_MODE=agent bash "$C3X_BIN" lookup plugins/tribe/scripts/runner/cli/main.ts
C3X_MODE=agent bash "$C3X_BIN" lookup plugins/tribe/scripts/runner/adapters/session.adapter.ts
C3X_MODE=agent bash "$C3X_BIN" schema adr
C3X_MODE=agent bash "$C3X_BIN" add adr campaign-supervisor-judgment-layer --file adr-supervisor.md
```

The body states: the problem (measured — a third to a half of a campaign's tokens went to wake-ups
that decided nothing; three rulings in 174 turns), the decision (a zero-token L2 loop over the
watchdog, one-shot sessions with rendered briefs, disk-verified postconditions, S-P1..S-P11), the
least-privilege model (`permissionMode: 'default'`, no `Bash` for judgment sessions, the
containment hook, the repo-untouched probe, and the `closing` exception), the consequences (W7
becomes mechanical; `autoAnswerRounds` is documented as vestigial, FU-CS-1), and the alternatives
rejected in spec §17.

- [ ] **Step 2: Cite, scaffold, patch, apply.**

```sh
C3X_MODE=agent bash "$C3X_BIN" read c3-215 --section Contract --cite
C3X_MODE=agent bash "$C3X_BIN" read c3-215 --section 'Business Flow' --cite
C3X_MODE=agent bash "$C3X_BIN" read c3-215 --section 'Change Safety' --cite
C3X_MODE=agent bash "$C3X_BIN" change new <adr-id>
# 01-contract-supervise-surface.patch.md   scope insert — flags, exit codes 0/1/20/21, the files
#                                          under <home>/supervisor/, adopt-never-duplicate
# 02-business-flow-judgment-path.patch.md  scope block  — the unattended row re-authored: judgment
#                                          is now a one-shot session, not a held-open session
# 03-change-safety-least-privilege.patch.md scope insert — THE decision-4 row: a ruling/ratify
#                                          session may write only under the campaign home; the
#                                          hook denies otherwise; the repo-untouched probe fails
#                                          the ruling; the closing session is the named exception
C3X_MODE=agent bash "$C3X_BIN" change view <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change accept <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change apply <adr-id>
C3X_MODE=agent bash "$C3X_BIN" check
```

Expected: three pending patches with no drift; `apply` lands them atomically; `check` prints
`total: 54` with `ok: true` and no new error. If `apply` reports a landing mismatch, re-cite and
re-author — **never hand-edit the sealed doc**; if a seal is already broken, run
`C3X_MODE=agent bash "$C3X_BIN" repair` and re-apply.

- [ ] **Step 3: Commit** — `docs(c3): ADR and c3-215 sync including the least-privilege model (task 16/24)`.

---

# PHASE 4 — Integration proofs

## Task 17: The session-double E2E, from an EMPTY home, both invocation shapes

**Depends on:** Task 16. **Model tier: `sonnet`** — `tests/test-watchdog-e2e.sh` is the worked
precedent for every helper, and the probes are enumerated below.

**Files:** create `plugins/tribe/scripts/tests/test-supervisor-e2e.sh` and
`plugins/tribe/scripts/runner/fixtures/supervisor/session-double.sh`.

**Oracle.** `fixtures-mirror-reality.md` rule 1 and rule 2. The campaign is given **both** the way a
person types it (`--campaign <slug>` with a relative-cwd invocation) and as an absolute `--home`;
the home is built **from nothing** under a throwaway `HOME`. A green run that only ever exercised
one spelling proves the interface works for that spelling.

**Fence by intent.** Real supervisor process, real watchdog, real runner, **fake model**: the
session double is a shell script the `SessionIO` seam is pointed at through an env var the test sets
— no SDK, no network, no tokens.

**Governing quote** — `plugins/tribe/rules/fixtures-mirror-reality.md`, verbatim:
> "**Before writing lifecycle code, run it against an empty fixture.** Any tool that assembles,
> vendors, or migrates a tree must be exercised on a *bare directory* — the layout it claims to
> produce, built from nothing."

**Adjudication rule — REFUTED in advance.**
- "the double should be a TypeScript mock inside `bun test`" — the unit tests already do that. This
  test's value is that real processes, real files and real path resolution are involved.
- "an absolute `--home` is enough" — refused by the quote and by the measured absolute-path blind
  spot that rule records.

**Steps**

- [ ] **Step 1: Write the failing test script.** Structure it exactly like
  `test-watchdog-e2e.sh` (`ok`/`bad`/`check`/`contains` helpers, `export HOME="$TMP/home"`,
  `TMP="$(cd "$TMP" && pwd -P)"` for the macOS symlink). Probes:

```sh
# Probe 1  absolute --home, a card that escalates, a double scripted to write a ratified ruling:
#          supervisor exits 0; ledger has exactly ONE ruling line; the escalation file is archived
#          to .resolved-R<n>; answers.md gained one ## block; NEEDS_OWNER.md does NOT exist.
# Probe 2  the same campaign named the way a person types it: cd into the campaigns dir and pass
#          --campaign <slug>; the resolved home and the verdict are identical to probe 1.
# Probe 3  an owner-only escalation: the double is never invoked at all (its call counter is 0),
#          NEEDS_OWNER.md exists and names park reason owner_only, exit code is 20.
# Probe 4  a double that writes NOTHING: one bounded retry (the counter reads 2), then park
#          ruling_failed, exit 20.
# Probe 5  a double that writes a ruling AND touches the target repo: the ruling is REJECTED as a
#          failed attempt (decision 4), park reason ruling_failed.
# Probe 6  the write surface: every file under the home after the run is one of
#          <home>/supervisor/**, <home>/NEEDS_OWNER.md, the escalation rename, or an artifact the
#          runner/watchdog themselves wrote. answers.md's mtime changed ONLY via the double.
# Probe 7  a second supervisor while the first holds the lock: exit 21, wrote nothing.
# Probe 8  containment: --home outside the tribe root exits 1 with a typed refusal; a home with no
#          campaign-state.json exits 1 with a typed refusal; neither prints a stack trace.
```

- [ ] **Step 2: Write the session double.** It reads a `DOUBLE_PLAN` env var (the same scripting
  shape `fixtures/watchdog/runner-double.sh` already uses), appends a ruling to `answers.md` or
  writes a park marker or does nothing, bumps a counter file **outside** the campaign home, and
  exits. It never spawns anything.

- [ ] **Step 3: Gate.**

```sh
bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh
```

Expected: every probe `ok`, final line `N passed, 0 failed` with `N` at least 24, and the script
exits 0. Run it twice in a row to prove it is repeatable and leaves no state behind.

- [ ] **Step 4: Commit** — `test(supervisor): end-to-end against a session double from an empty home (task 17/24)`.

---

## Task 18: The G4 kill tests

**Depends on:** Task 17. **Model tier: `sonnet`** — three scripted scenarios, each fully specified.

**Files:** create `plugins/tribe/scripts/tests/test-supervisor-kill.sh`.

**Oracle.** Card G4, verbatim below. The property under test is not "it restarts" but "it loses
nothing **and** never double-rules one escalation". A restart that re-rules a question already ruled
is the defect, even if every process exits 0.

**Fence by intent.** Three kills, three restarts, three assertions about disk. No new source code —
if a kill test fails, the fix belongs in the loop, and that is a `NEEDS_CONTEXT` back to the
Warchief, not an edit to the test's expectations.

**Governing quote** — the card, `## Measurable goals`, G4, verbatim:
> "**G4 — stop/start safe.** `kill -9` of the supervisor at any instant (including
> mid-ruling-session) followed by a manual restart loses nothing and never double-rules one
> escalation."

**Adjudication rule — REFUTED in advance.**
- "`kill -9` at an arbitrary instant is untestable, use `SIGTERM`" — refused: `SIGKILL` is the
  stated contract and is exactly what a harness timeout delivers. The three instants below are
  deterministic because the double blocks on a sentinel file the test creates.
- "an extra ruling round consumed after a kill is a failure" — it is not: S-P6 makes over-counting
  the safe direction. Double-*ruling* is the failure.

**Steps**

- [ ] **Step 1: Write the failing test script.** Three scenarios, using the double's sentinel-file
  block so the kill lands at a known instant (there is no `timeout` binary; poll for the sentinel
  in a bounded loop):

```sh
# Kill A  mid-wait: kill -9 while the supervisor is awaiting its watchdog child.
#         Restart. Expect: the watchdog child survived and is ADOPTED (events.jsonl records
#         await_watchdog, never a second run_watchdog while it was alive); the campaign reaches
#         the same terminal state; the double was invoked the same number of times as in the
#         un-killed control run.
# Kill B  mid-ruling-session: the double blocks on a sentinel AFTER writing the ruling to
#         answers.md; kill -9 the supervisor there; remove the sentinel; restart.
#         Expect: answers.md has EXACTLY ONE new ## block (never two); the restart ARCHIVES the
#         escalation rather than spawning a second ruling; the double's counter did not grow.
# Kill C  mid-re-trigger: kill -9 between the archive and the next run_watchdog.
#         Expect: the restart re-observes, sees the archive already done, and re-triggers once;
#         the escalation file is not renamed twice and no .resolved-R<n>.resolved-R<n> exists.
```

Each scenario ends by asserting `grep -c '^## ' answers.md` equals the control run's value.

- [ ] **Step 2: Gate.**

```sh
bash plugins/tribe/scripts/tests/test-supervisor-kill.sh
```

Expected: `N passed, 0 failed` with all three scenarios green, and the explicit "exactly one `## `
block" assertion visible in the output for Kill B.

- [ ] **Step 3: Commit** — `test(supervisor): G4 kill-and-restart safety across three instants (task 18/24)`.

---

## Task 19: The G3 replay fixture — the `viewer-consolidation` escalation history

**Depends on:** Task 18. **Model tier: `sonnet`** — a fixture plus one assertion.

**Files:** create `plugins/tribe/scripts/runner/fixtures/supervisor/viewer-consolidation-replay/`
(a synthesized campaign home) and `core/supervisor/replay.test.ts`.

**Oracle.** Card G3, verbatim below. The number under test is the **spawn count**, not the token
count: the claim is that a campaign whose measured session took 174 turns needs at most 5 one-shot
sessions.

**Fence by intent.** The fixture reproduces the *shape* of the real campaign's escalation history —
three escalations answered as R16, R18, R22, then a closing — with **synthesized** text. It copies
no real escalation body and no real ruling prose into the repo (the same privacy wall as Task 4).

**Governing quote** — the card, `## Measurable goals`, G3, verbatim:
> "**G3 — bounded context.** Every one-shot session starts from a rendered brief, never from a
> resumed conversation; its first-turn context is recorded in the ledger. Replaying the
> `viewer-consolidation` escalation history (R16, R18, R22 + closing) as a fixture yields <= 5
> spawns where the measured session took 168 turns."

(The measured turn count is 174, not 168 — spec §21 D2. The bound of 5 spawns is unaffected.)

**Fence note.** `/Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/viewer-consolidation/` is
**read-only source material**. Never write to it.

**Adjudication rule — REFUTED in advance.**
- "copy the real escalation files in for fidelity" — refused by the privacy wall; the shape is what
  matters, and the shape is a `**Reason:**` line plus a `## Context` section.
- "4 spawns would be better than 5" — the goal is a ceiling, not a target.

**Steps**

- [ ] **Step 1: Write the failing test.** Drive the pure loop with a scripted fake `SupervisorIO`
  over the fixture: three escalation rounds each answered by a ruling, then `runner_done` with one
  unratified ruling (mirroring the real campaign's exit-5 shape), then a closing. Assert:

```ts
expect(spawnLog.length).toBeLessThanOrEqual(5);
expect(spawnLog.map((s) => s.kind)).toEqual(['ruling', 'ruling', 'ruling', 'ratify', 'closing']);
expect(spawnLog.every((s) => s.resume === undefined)).toBe(true);
expect(ledger.every((l) => typeof l.usage.input_tokens === 'number')).toBe(true);
```

- [ ] **Step 2: Build the fixture and make it pass.**

- [ ] **Step 3: Gate.**

```sh
cd plugins/tribe/scripts/runner && bun test core/supervisor/replay.test.ts
grep -rl "viewer-consolidation" fixtures/supervisor/ | head
```

Expected: the replay assertions pass with exactly 5 spawns and no `resume`; the `grep` shows only
the fixture's own directory name, never a copied ruling body.

- [ ] **Step 4: Commit** — `test(supervisor): the viewer-consolidation replay fixture bounds spawns at five (task 19/24)`.

---

## Task 20: The real end-to-end run — G1, G5, G6 — with Haiku as the Shaman model

**Depends on:** Task 19. **Model tier: `sonnet`** — the procedure is scripted; the judgment (what
counts as proof) is fixed below. This is the one task that spends real tokens, and only Haiku's.

**Files:** create `plugins/tribe/scripts/tests/test-supervisor-real-e2e.sh` (opt-in, gated behind
an env var so `bun test` never bills anybody) and
`docs/superpowers/evidence/2026-09-18-campaign-supervisor-e2e.md`.

**Oracle.** Card G1, G5, G6. **"No interactive session open" is the claim being proved**: the whole
run is started from a bare terminal command and reaches its terminal state with no session held.
A run that needed a human to nudge it is a failure even if it ended `done`.

**Fence by intent.** ONE toy campaign, built from nothing, deliberately constructed to escalate
once. Haiku is the Shaman model. The target repo is a throwaway git repo under `mktemp -d`. Nothing
under `/Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/` is read or written.

**Governing quote** — the card, `## Measurable goals`, G1, verbatim:
> "**G1 — no babysitter.** A campaign with >= 1 Shaman-answerable escalation runs from supervisor
> start to the final owner report with **no interactive session open**, proven by a real E2E run."

**Adjudication rule — REFUTED in advance.**
- "Haiku is too weak to rule well" — irrelevant to this card: the proof is that the *mechanism*
  works unattended and that the postconditions are verified on disk. Model quality is guardrail 8's
  configuration question, not this card's.
- "the run should use the real `tribe` repo so the closing session can open a real PR" — refused:
  a throwaway repo keeps the test repeatable and keeps a model away from the real remote. The
  closing session's postcondition is its report file.
- "a screenshot is not reproducible evidence" — for G6 it is the evidence the card asks for, and it
  is accompanied by the project-directory listing, which IS reproducible.

**Steps**

- [ ] **Step 1: Write the opt-in script.** It refuses to run unless `TRIBE_REAL_E2E=1`, prints the
  estimated cost, builds the throwaway repo and campaign home, and runs:

```sh
bun plugins/tribe/scripts/runner/run.ts supervise \
  --repo "$REPO" --home "$HOME_DIR" --model haiku --watchdog-model haiku \
  --max-spawns 4 --session-timeout-seconds 600
echo "exit=$?"
```

Expected: `exit=0`; `NEEDS_OWNER.md` does not exist; `answers.md` gained at least one ratified
`## ` block; the escalation file is archived; `supervisor/final-report.md` exists and is non-empty.

- [ ] **Step 2: Assert the G5 ledger mechanically.**

```sh
python3 - "$HOME_DIR/supervisor/ledger.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
need = {"kind","sessionId","model","startedAt","endedAt","usage","verdict"}
assert rows, "the ledger is empty"
for r in rows:
    assert need <= set(r), f"missing {need - set(r)}"
    assert r["model"] == "haiku", r["model"]
    assert r["verdict"] in {"ruled","ratified","closed","parked","failed","timeout"}
print(f"ledger ok: {len(rows)} spawns, kinds={[r['kind'] for r in rows]}")
PY
```

Expected: `ledger ok:` with between 1 and 4 spawns and no `failed`/`timeout` verdict.

- [ ] **Step 3: Assert the G0 ratchet, and WRITE the measured ceilings** (S-P15). Collect every
  session id from the ledger, measure them, assert the first two ratchet conditions, then turn the
  measured maxima into the committed per-kind ceilings.

```sh
bun plugins/tribe/scripts/runner/run.ts transcript-metrics \
  $(python3 -c 'import json,sys;print(" ".join("--session "+json.loads(l)["sessionId"] for l in open(sys.argv[1]) if l.strip()))' "$HOME_DIR/supervisor/ledger.jsonl") \
  --json > "$TMP/e2e-metrics.json"
python3 - "$TMP/e2e-metrics.json" "$HOME_DIR/supervisor/ledger.jsonl" \
  docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json <<'PY'
import json, math, sys
metrics, ledger, ratchet_path = sys.argv[1], sys.argv[2], sys.argv[3]
m = {s["sessionId"]: s for s in json.load(open(metrics))["sessions"]}
kind = {json.loads(l)["sessionId"]: json.loads(l)["kind"] for l in open(ledger) if l.strip()}
for sid, s in m.items():
    assert s["babysittingShare"] == 0, (sid, s["babysittingShare"])
    assert s["monitorArms"] == 0, (sid, s["monitorArms"])
r = json.load(open(ratchet_path)); f = r["headroomFactor"]
peak = {}
for sid, s in m.items():
    k = kind.get(sid, "ruling")
    peak[k] = max(peak.get(k, 0), s["maxContext"])
for k, v in peak.items():
    r["ceilings"][k] = math.ceil(v * f)
r["source"] = f"measured by task 20 from {len(m)} session(s); factor {f}"
json.dump(r, open(ratchet_path, "w"), indent=2)
print("measured maxima:", peak, "-> ceilings:", r["ceilings"])
PY
```

Expected: every session reports `"babysittingShare": 0` and `"monitorArms": 0`; the script prints
the measured maxima per kind and the ceilings it wrote (each `measured × 1.5`, rounded up). A kind
with no session in this run keeps its `0` and stays on the baseline fallback — do not invent one.

- [ ] **Step 3a: Re-run the ceiling gate against the file just written.**

```sh
cd plugins/tribe/scripts/runner && bun test core/metrics/ceiling.test.ts
git -C /Users/hip/repo/tribe-wt/campaign-supervisor diff --stat docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json
```

Expected: the ceiling tests pass against real values, the diff shows only `ceilings` and `source`
changing, and no ceiling was raised relative to a previously measured value (the first measurement
moves them off `0`, which the test treats as the initial set, not a raise).

- [ ] **Step 4: Prove G6 in the viewer.** Start the viewer, open it, and record BOTH:
  the project directory listing (reproducible) and a screenshot (what the card asks for).

```sh
ls -d ~/.claude/projects/*campaigns-"$SLUG"
ls -1 ~/.claude/projects/*campaigns-"$SLUG"/*.jsonl | wc -l
cd plugins/tribe/scripts/viewer && bun serve.ts --port 4321
```

Expected: exactly one project directory whose name ends in the campaign slug, containing one
`.jsonl` per ledger spawn, and the viewer listing that project with those sessions.

- [ ] **Step 5: Write the evidence file** at
  `docs/superpowers/evidence/2026-09-18-campaign-supervisor-e2e.md`, carrying:
  **BEFORE** — the baseline table from Task 4 (174 turns, 26.5M cache-read, 0.3168 babysitting
  share for one campaign's supervision) with the three rulings it produced.
  **AFTER** — the command line above, `supervisor/status.json`, `events.jsonl`, `ledger.jsonl`
  verbatim, the ratchet assertion output from step 3, the project-directory listing and screenshot
  from step 4, and `final-report.md`.
  Both live in the repo so every PR link resolves from the repo itself.

- [ ] **Step 6: Commit** — `test(supervisor): real unattended end-to-end run on haiku with evidence (task 20/24)`.

---

## Task 21: Phase 4 governance reconciliation (C3)

**Depends on:** Task 20. **Model tier: `sonnet`**.

**Files:** `.c3/changes/<adr-id>/*` via the wrapper only.

**Oracle.** As Task 5. Baseline after Task 16 is `total: 54`, `ok: true`.

**Fence by intent.** ONE change-unit adding the Enforcement Surfaces rows for the three new test
suites. No new ADR — the supervisor's ADR already exists and its decision did not change.

**Governing quote** — as Task 11 (`brief-contracts.md`'s phase-end sequencing rule).

**Adjudication rule — REFUTED in advance.**
- "the real E2E is opt-in so it is not an enforcement surface" — it is one, with its gate recorded
  as `TRIBE_REAL_E2E=1`. Recording it honestly is the point.

**Steps**

- [ ] **Step 1: Patch and apply.**

```sh
cd /Users/hip/repo/tribe-wt/campaign-supervisor
C3X_MODE=agent bash "$C3X_BIN" read c3-215 --section 'Enforcement Surfaces' --cite
C3X_MODE=agent bash "$C3X_BIN" change new <adr-id>
# 04-enforcement-supervisor-tests.patch.md: scope insert — test-supervisor-e2e.sh,
# test-supervisor-kill.sh, and the opt-in test-supervisor-real-e2e.sh with its env gate.
C3X_MODE=agent bash "$C3X_BIN" change view <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change accept <adr-id>
C3X_MODE=agent bash "$C3X_BIN" change apply <adr-id>
C3X_MODE=agent bash "$C3X_BIN" check
```

Expected: one pending patch, no drift, `check` prints `total: 54` with `ok: true`.

- [ ] **Step 2: Commit** — `docs(c3): enforcement-surface rows for the supervisor test suites (task 21/24)`.

---

# PHASE 5 — Documentation

## Task 22: `orchestrate-campaign/SKILL.md` — Stages B, C, D and the doorbell

**Depends on:** Task 21. **Model tier: `sonnet`** — prose editing against an enumerated list of
required changes.

**Files:** edit `plugins/tribe/skills/orchestrate-campaign/SKILL.md`.

**Oracle.** The card's scope fence, verbatim below. **The hand-driven path stays documented as the
fallback** — this is an addition, not a replacement, and deleting the existing Stage B/C wording is
a defect.

**Fence by intent.** Stage B gains the supervisor launch beside the watchdog launch; Stage C gains
"the supervisor does this for you, and here is when it hands back"; Stage D gains "a closing session
may already have run — verify, do not repeat"; a new "The doorbell session" section carrying the
six-step owner-ruling transcription procedure from spec §12.1. Walls W1, W3 and W7 are **not**
reworded.

**The doorbell writes `answers.md` — and that is W3-compliant, by the Shaman's ruling of
2026-09-18.** W3 reads "written only by you (a session) **or the owner**". The doorbell never rules
on its own authority; when the owner states a decision it records that decision verbatim, marked
`ruled-by: owner`, then archives the escalation, deletes the `NEEDS_OWNER.md` latch, and restarts
the supervisor. Document the procedure exactly as spec §12.1 numbers it, including that
`ratified-as: pending` is a legitimate outcome when the owner gives no disposition.

**Governing quote** — the card's scope fence, verbatim:
> "`orchestrate-campaign/SKILL.md` is updated so Stage B/C/D describe the supervisor path and the
> doorbell; the hand-driven path stays documented as the fallback."

**Adjudication rule — REFUTED in advance.**
- "W7's wording should now say the supervisor enforces it" — refused: W7 is a wall the Shaman rules
  (card decision authority). Describe the supervisor as *also* enforcing it mechanically; do not
  edit the wall's text.
- "Stage C can be deleted since the supervisor does it" — refused by the quote: the hand-driven path
  stays.

**Steps**

- [ ] **Step 1: Write the failing check** as a grep gate in the same script style the
  detached-launch test uses — a new `plugins/tribe/scripts/tests/test-supervisor-docs.sh`:

```sh
# Wall 1: SKILL.md names the supervisor launch in Stage B and keeps the bare watchdog launch.
grep -q 'run.ts supervise' "$SKILL" || bad "Stage B names the supervisor"
grep -q 'run.ts watchdog'  "$SKILL" || bad "the watchdog launch is still documented"
# Wall 2: the doorbell section exists, states what it never does, and carries the owner-ruling
# transcription procedure (spec 12.1) including the ruled-by marker and the latch deletion.
grep -q 'doorbell' "$SKILL" || bad "the doorbell section exists"
grep -q 'never rules on its own authority' "$SKILL" || bad "the doorbell never rules on its own authority"
grep -q 'ruled-by: owner' "$SKILL" || bad "the owner-ruling marker is documented"
grep -q 'NEEDS_OWNER.md' "$SKILL" || bad "the latch and its deletion are documented"
# Wall 3: the walls are untouched, byte for byte.
grep -q 'W7 — bounded auto-answer.\*\* At most 2 auto-answer rounds per card' "$SKILL" || bad "W7 unchanged"
grep -q 'W3 — judgment stays in sessions' "$SKILL" || bad "W3 unchanged"
```

- [ ] **Step 2: Make the edits**, including the doorbell procedure from spec §12 with the `until`
  loop pointed at `supervisor/status.json`, and the exit-code table (`0` done, `20` needs owner,
  `21` already running, `1` usage).

- [ ] **Step 3: Gate.**

```sh
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
bash plugins/tribe/scripts/tests/test-watchdog-detached.sh
```

Expected: the docs test reports `N passed, 0 failed`, and the pre-existing detached-launch test —
whose wall 2 greps this same file — is still green, proving the edits did not disturb Stage B's
one-liner.

- [ ] **Step 4: Commit** — `docs(skill): supervisor path and doorbell in Stages B, C and D (task 22/24)`.

---

## Task 23: The runner README and the tribe README

**Depends on:** Task 22. **Model tier: `sonnet`**.

**Files:** edit `plugins/tribe/scripts/runner/README.md` and `plugins/tribe/README.md`.

**Oracle.** The runner README's own "Watchdog" section is the template: a purpose paragraph, the
invocation, a flags table with defaults, an exit-codes table, a files list, the decision table, a
"What it never does" list, and "Known limitations". Every claim must be answerable by the code; a
documented flag that does not exist is a defect.

**Fence by intent.** Two documentation files. No source change.

**Governing quote** — spec §10's exit-code table and §11's on-disk layout, which the README
reproduces rather than reinterprets.

**Adjudication rule — REFUTED in advance.**
- "document `autoAnswerRounds` as the W7 counter" — refused: it is vestigial (spec §21 D1).
  Document the supervisor's own counter, and record the vestigial field under Known limitations with
  follow-up FU-CS-1.

**Steps**

- [ ] **Step 1: Write the failing check** — extend `test-supervisor-docs.sh` with a flags-parity
  wall in the style the watchdog's own docs test uses: every flag the README's table names must be
  accepted by the parser, and every flag the parser accepts must appear in the table.

```sh
for f in $(grep -oE '^\| `--[a-z-]+`' "$RUNNER_README" | tr -d '|` '); do
  bun "$RUNNER/run.ts" supervise "$f" 2>&1 | grep -q "unknown flag" && bad "README documents a nonexistent flag: $f"
done
```

- [ ] **Step 2: Write both sections**, including the Known limitations entries: `autoAnswerRounds`
  is never incremented by the runner (FU-CS-1); a supervisor session gets no viewer badge chip, only
  its own project directory (FU-CS-2); and a crash of the supervisor itself is recovered by
  re-running it, exactly as the watchdog's own limitation reads.

- [ ] **Step 3: Gate.**

```sh
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
bash plugins/tribe/scripts/tests/test-fresh-machine.sh
```

Expected: the docs test green including flags parity, and `test-fresh-machine.sh` unmoved (the
supervisor adds no installable and no resolver).

- [ ] **Step 4: Commit** — `docs(runner): supervisor sections in the runner and tribe READMEs (task 23/24)`.

---

## Task 24: Phase 5 governance reconciliation and the final model sync

**Depends on:** Task 23. **Model tier: `sonnet`**.

**Files:** `.c3/changes/<adr-id>/*` via the wrapper only.

**Oracle.** As Task 5. This is the last reconciliation: after it, `c3x check` must be `ok: true`
with no entity's facts stale with respect to the merged diff.

**Fence by intent.** The Compliance Refs row for `ref-docs-lifecycle` (the spec, plan and evidence
under `docs/superpowers/**`), and any drift the four earlier change-units left. No new ADR.

**Governing quote** — as Task 11.

**Adjudication rule — REFUTED in advance.**
- "`c3x check` was green after Task 21, so this task is a no-op" — then it is a cheap no-op that
  proves it. Run it and record the output; a phase-end reconciliation that finds nothing is a
  success, not a wasted task.

**Steps**

- [ ] **Step 1: Reconcile and verify.**

```sh
cd /Users/hip/repo/tribe-wt/campaign-supervisor
C3X_MODE=agent bash "$C3X_BIN" check
C3X_MODE=agent bash "$C3X_BIN" read c3-215 --section Governance --cite
# Author any remaining patch, then:
C3X_MODE=agent bash "$C3X_BIN" change apply <adr-id>
C3X_MODE=agent bash "$C3X_BIN" check
git status --short .c3
```

Expected: `check` prints `total: 54` with `ok: true` both before and after, and `git status` shows
only the change-unit and document files this plan authored (`.c3/c3.db` is git-ignored).

- [ ] **Step 2: Commit** — `docs(c3): final governance reconciliation for the campaign supervisor (task 24/24)`.

---

## 5. Goal coverage — every goal maps to at least one task

| Goal | Tasks that prove it | Proof artefact |
| --- | --- | --- |
| **G0** ratchet | 1, 2, 3, **4**, 20 step 3 | The **pinned** baseline plus its `.md` twin; `--verify` re-measuring at the cut; the grow-then-remeasure fixture; the measured per-kind ceiling file |
| **Ruling integrity** (S-P13) | **8**, 14, 17 | `history_rewritten` and `ratify_out_of_scope` park without a retry |
| **Enforcement is real** (S-P12) | **13** | `test-supervisor-permission-real.sh`: contained write lands, three escape shapes denied, against a live model |
| **Owner ruling path** (spec §12.1) | **22** | The SKILL.md procedure, grep-gated for `ruled-by: owner` and the latch |
| **G1** no babysitter | 14, 17, **20** | The real E2E evidence file: one command, exit 0, no session held |
| **G2** tokens only for judgment | 13, 14, **20** | `ledger.jsonl` has one line per spawn; the supervisor's loop appears in no transcript |
| **G3** bounded context | 9, 13, **19** | The replay fixture: 5 spawns, no `resume`, against 174 measured turns |
| **G4** stop/start safe | 14, **18** | Three kill scenarios, each asserting exactly one `## ` block |
| **G5** auditable spend | 10, 13, **20** | `ledger.jsonl` asserted field by field in the real E2E |
| **G6** visible in the viewer | 13 (`cwd`), **20** | The project-directory listing plus the viewer screenshot |
| Guardrail 1 (never rules) | 13, 14, **17** probe 6 | The write-surface assertion: `answers.md` changes only via a session |
| Guardrail 2 (trust disk) | 8, **17** probes 4-5 | A double that writes nothing, and one that touches the repo, both rejected |
| Guardrail 3 (W7 mechanical) | 7 (row 10), **17** | `park(w7_cap)` asserted with the round counter at 2 |
| Guardrail 4 (budgets) | 6, 7, **17** | Every cap parsed, bounded, and exercised |
| Guardrail 5 (fail closed) | 3, 8, 12, 15, **17** probe 8 | Typed refusals, exit 1, no stack trace anywhere |
| Guardrail 6 (single instance) | 7 (P1, P4), **17** probe 7 | Exit 21, nothing written |
| Guardrail 7 (least privilege) | **13**, 16, 17 probe 5 | The hook table, the repo-untouched probe, the C3 change-unit |
| Guardrail 8 (model from config) | 13, **20** | Every ledger line carries `model: haiku` |
| Guardrail 9 (briefs obey `brief-contracts`) | **9** | Byte-identical quote assertions against the real `SKILL.md` |

## 6. Verification-step coverage — spec §23, step by step

| Spec §23 step | Where it is satisfied |
| --- | --- |
| 1. `bun test` + `tsc` green | Every task's gate; the decision table lands in Task 7 |
| 2. `test-supervisor-e2e.sh` (empty home, both invocation shapes) | Task 17 |
| 3. `test-supervisor-kill.sh` (three G4 instants) | Task 18 |
| 4. Replay G0 against the committed baseline | Task 4, re-run in Task 20 step 3 |
| 5. Replay G3 (≤ 5 spawns) | Task 19 |
| 6. The real-E2E evidence file | Task 20 |
| 7. `test-fresh-machine.sh` unmoved | Task 23 gate |
| 8. `c3x check` `ok: true`, no new error | Tasks 5, 11, 16, 21, 24 |
| 9. Fence, two skinners, tracker, scout, the ADR and the decision-4 change-unit | §8 below; Task 16 |

## 7. Spec amendments — all ruled, nothing outstanding

The Shaman reviewed this plan on 2026-09-18 and ruled on every open item. Spec §20 carries the full
status. Nothing here awaits a decision, and **none of it is to be re-litigated by an executing
session**:

| Amendment | Status | Tasks built to it |
| --- | --- | --- |
| A1 — the session rules, the supervisor archives | **ACCEPTED** (option a) | 8, 13, 14, 17, 18 |
| A2 — two closed park vocabularies | **ACCEPTED**, extended to 22 supervisor values by A9 | 6, 8, 10 |
| A3 — "use the measured 258,795" | **REPLACED** by A3′ — a bound two orders of magnitude above the expected value is not a ratchet | — |
| A3′ — committed per-kind ceilings, measured, lowerable only | **REQUIRED, built** | 4, 20 |
| A4 — the supervisor owns the W7 counter | **ACCEPTED**; FU-CS-1 out of fence | 7, 10 |
| A5 — exit codes `20`/`21` | **ACCEPTED** | 6, 15 |
| A6 — G6 needs no viewer change | **ACCEPTED**; FU-CS-2 out of fence | 13, 20 |
| A7 — `--home` beside `--campaign` | **ACCEPTED** | 6, 15 |
| A8 — the baseline is pinned to a byte cut | **REQUIRED, built** | 3, 4 |
| A9 — rulings are append-only, mechanically | **REQUIRED, built** | 6, 8, 14, 17 |
| A10 — the hook is the sole enforcement, proven live | **REQUIRED, built** | 13 |
| A11 — the doorbell transcribes an owner ruling | **REQUIRED, built** | 22 |

## 8. Delivery — what the Warchief does after Task 24

1. **All gates run in the worktree and pasted verbatim into the PR body**, with numbers:
   - `cd plugins/tribe/scripts/runner && bun test` (expected: the 684 baseline plus roughly 200 new,
     `0 fail`) and `bunx tsc --noEmit` (silent)
   - `bun test structure.test.ts` (the layout contract still holds with the supervisor inside it)
   - `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh` (`0 failed`)
   - `bash plugins/tribe/scripts/tests/test-supervisor-kill.sh` (`0 failed`)
   - `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh` (`0 failed`)
   - `TRIBE_REAL_E2E=1 bash plugins/tribe/scripts/tests/test-supervisor-permission-real.sh`
     (`4 passed, 0 failed` — the only proof the enforcement layer works against a live model)
   - `bun run.ts transcript-metrics --verify docs/superpowers/evidence/2026-09-18-supervisor-baseline.json`
     (every session `verified`, exit 0 — re-measured at its pinned cut)
   - `bash plugins/tribe/scripts/tests/test-fresh-machine.sh` (unmoved)
   - `C3X_MODE=agent bash "$C3X_BIN" check` (`ok: true`)
   - `bash plugins/tribe/scripts/validate-plan.sh docs/superpowers/plans/2026-09-18-campaign-supervisor.md`
     (verdict `pass`)
   - **There is no CI on this repo** (no `.github/workflows/`), so "CI green" is satisfied by these
     local gates pasted with their output. Say so in the PR body rather than leaving a reader to
     wonder, and never claim a green check that does not exist. `gh run watch` and `timeout` are
     both unusable here.
2. **Before/after evidence in the PR body**, captured by the Warchief, never claimed by a Hunter:
   **BEFORE** is the Task-4 baseline (174 turns, 26.5M cache-read, 0.3168 babysitting share, three
   rulings); **AFTER** is the Task-20 evidence file (one command, exit 0, the ledger, the ratchet
   assertion at share 0, the viewer project directory). Both live under
   `docs/superpowers/evidence/`, so every PR link resolves from the repo itself.
3. **Audit recorded:** two independent skinners dispatched concurrently in one message — the
   contract lens with the spec and plan, the cold lens with a diff **path-scoped to exclude**
   `docs/superpowers/specs/**`, `docs/superpowers/plans/**` and the card — plus the tracker's
   verdict and scout on the open harness gaps, with the disposition ledger for every
   Critical/Important finding.
4. **Follow-ups to report:** FU-CS-1 (`autoAnswerRounds` is never incremented — a runner-core card)
   and FU-CS-2 (a viewer badge chip for supervisor sessions), plus anything the audit records as
   DEBT.

**Scope-fence self-check before opening the PR.** `git diff --name-only master...HEAD` must be a
subset of:
`plugins/tribe/scripts/runner/{core/metrics/**,core/supervisor/**,ports/ports.ts,adapters/supervisor-io.adapter.ts,adapters/supervisor-io.adapter.test.ts,adapters/transcript-io.adapter.ts,adapters/transcript-io.adapter.test.ts,cli/main.ts,cli/main.test.ts,fixtures/supervisor/**,README.md}`,
`plugins/tribe/scripts/tests/{test-supervisor-e2e.sh,test-supervisor-kill.sh,test-supervisor-real-e2e.sh,test-supervisor-docs.sh,test-supervisor-permission-real.sh}`,
`plugins/tribe/skills/orchestrate-campaign/SKILL.md`, `plugins/tribe/README.md`,
`docs/superpowers/{specs,plans,evidence}/**`, `.c3/**`.
Note what is NOT there: `core/types.ts`, `core/state.ts`, `core/watchdog/**`, and the entire
`plugins/tribe/scripts/viewer/` tree. Anything else in the diff is a fence breach — stop and report,
do not tidy it.

## 9. Size and wall-clock estimate

**24 Hunter tasks**, one worktree, five strictly ordered phases.

| Tasks | What | Estimated Hunter wall-clock |
| --- | --- | --- |
| 1-4 | The ratchet: classifier, accumulation, edge, baseline | 2 h 30 min |
| 5 | Phase 1 C3 | 45 min |
| 6-10 | The pure supervisor core (the decision table is the big one) | 5 h |
| 11 | Phase 2 C3 | 30 min |
| 12-15 | Port, adapter, permission model, loop, subcommand | 4 h 30 min |
| 16 | Phase 3 C3 — the ADR plus the decision-4 change-unit | 1 h 15 min |
| 17-19 | Session-double E2E, kill tests, replay fixture | 4 h |
| 20 | The real Haiku E2E and its evidence | 1 h 30 min |
| 21 | Phase 4 C3 | 30 min |
| 22-23 | SKILL.md, the two READMEs | 1 h 30 min |
| 24 | Phase 5 C3 | 30 min |
| — | **Total Hunter time** | **≈ 22 h 30 min** |
| — | Warchief overhead (24 dispatches, 24 pre-gates, dual-skinner rounds, tracker, scout, evidence, PR) | ≈ 8-10 h |
| — | **Total wall-clock to PR OPEN** | **≈ 31-33 h** — two to three working sessions, or one unattended campaign pass |

Expected new test count: roughly **200**, taking the runner suite from `684` to about `880`, plus
four shell suites. Real token spend across the whole card: **one Haiku run** in Task 20.
