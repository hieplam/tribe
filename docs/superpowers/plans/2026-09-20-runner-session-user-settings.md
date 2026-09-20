# Plan — runner-session-user-settings

**Spec:** `docs/superpowers/specs/2026-09-20-runner-session-user-settings-design.md`
**Card:** `~/.tribe/-Users-hip-repo-tribe/cards/runner-session-user-settings.md`
**Branch:** `feat/runner-session-user-settings` (base `b6b5330`)
**Worktree:** `/Users/hip/repo/tribe-wt/runner-session-user-settings`

Seven tasks, executed **sequentially** — tasks 1, 3, 4 and 6 all touch
`core/session.ts` / `core/session.test.ts`, so their `owns_files` are not disjoint and there is no
concurrency to be had. One wave, one branch, one PR.

---

## Global Constraints

- **Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.**
- **Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**
- Run everything from `plugins/tribe/scripts/runner/` unless a task says otherwise.
- **TDD is mandatory:** write the failing test, run it, *see it fail for the stated reason*, then
  implement. A task whose test never failed first is not done.
- **Every commit** carries, in ONE final paragraph:
  `Tribe-Card: runner-session-user-settings` and `Tribe-Task: N/7`.
  Tick this plan's checkboxes in the SAME commit as the code.
- **Do not touch:** the supervisor loop, `core/supervisor/**`, `core/state.ts`, `core/types.ts`,
  `core/watchdog/**`, the viewer.
- **`command grep`, never bare `grep`,** in any shell you run: this machine's interactive `grep` is
  a ugrep wrapper whose `-I` flag silently skips files it judges binary, which produces empty
  output and false "no matches" conclusions. This cost real time during plan verification.

## Oracle (the contract — no external standard overrides it)

- **A filesystem-wide scan** = one Bash command containing a `find` whose **root argument is
  exactly** `/`, `~`, `$HOME`, `"$HOME"`, `~/` or `$HOME/`. `find /Users/hip/repo/tribe`,
  `find .`, `find src` are **scoped** and must **not** match.
- **Under-detecting is a bug; over-detecting is by design.** When in doubt, match.
- **Validation:** counting the real `supervisor-hardening` logs with this rule yields **exactly 4**.
  That number is the card's independently measured baseline and is the acceptance test for the
  detector (Task 2).

## Adjudication rule — REFUTED in advance, do not raise as findings

- "Loading the user tier hurts reproducibility" — owner-ruled; hardening note only.
- The six `~/.claude/agents/*.md` duplicating the plugin's agents — byte-identical today (6/6
  verified at plan time); a note, not a defect to fix here.
- The macOS consent popups — a symptom, not a bug in this repo.
- "The guard also ought to cover `ls -R /` / `grep -r /`" — out of scope; the oracle names `find`.
- "`settingSources` could simply be omitted to get the CLI default" — deliberately rejected: an
  explicit list keeps the regression test meaningful and survives an SDK default change.

---

## Task 1 — the pure counting core (and the one shared scan predicate)

**Model: `sonnet`.** Pure logic with a subtle, fully-specified oracle; no judgment calls left open.

**Owns:** `plugins/tribe/scripts/runner/core/metrics/session-hygiene.ts` (new),
`core/metrics/session-hygiene.test.ts` (new).

`isFilesystemWideScan` is exported and becomes the **single** definition of a filesystem-wide scan
— Task 3's guard hook imports this exact function. The counter and the guard must never be able to
disagree about what a scan is.

### RED — write this test first, run it, watch it fail

`core/metrics/session-hygiene.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { countSessionHygiene, isFilesystemWideScan } from './session-hygiene.ts';

describe('isFilesystemWideScan — the oracle', () => {
  test.each([
    'find / -maxdepth 4 -iname "*c3x*"',
    'find / -path /proc -prune -o -iname x -print',
    'cd /tmp && ls; find / -maxdepth 8 -iname "claude-agent-sdk" -type d 2>/dev/null',
    'find ~ -name "*.log"',
    'find ~/ -name "*.log"',
    'find $HOME -name x',
    'find "$HOME" -name x',
    'find $HOME/ -name x',
    'find -L / -name x',
    'echo hi | find / -name x',
  ])('refuses %p', (cmd) => {
    expect(isFilesystemWideScan(cmd)).toBe(true);
  });

  test.each([
    'find . -name "*.ts"',
    'find /Users/hip/repo/tribe -iname "c3x.sh"',
    'find ~/repo/tribe -name x',
    'find $HOME/repo -name x',
    'find src -name x',
    'find plugins/tribe -maxdepth 2',
    'grep -rn "find /" src',          // mentions it, does not run it
    'echo "find / -name x"',          // quoted text, not a command position
  ])('allows %p', (cmd) => {
    expect(isFilesystemWideScan(cmd)).toBe(false);
  });
});

describe('countSessionHygiene', () => {
  test('counts Unknown skill occurrences per name, not per line', () => {
    const text = '{"a":"Unknown skill: c3. Did you mean cd?"}\n' +
      '{"b":"Unknown skill: c3 and Unknown skill: verify-shipped"}\n';
    const r = countSessionHygiene(text);
    expect(r.unknownSkills).toEqual({ c3: 2, 'verify-shipped': 1 });
  });

  test('counts a scan inside a JSON-escaped Bash tool_use command', () => {
    // The real log shape: the command carries escaped quotes, which a naive
    // "command":"[^"]*" regex truncates.
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'find / -maxdepth 8 -iname "x" -type d' } }] },
    });
    expect(countSessionHygiene(line).filesystemWideScans).toBe(1);
  });

  test('a scoped find in a tool_use is not counted', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'find /Users/hip/repo/tribe -iname "x"' } }] },
    });
    expect(countSessionHygiene(line).filesystemWideScans).toBe(0);
  });

  test('a malformed line never aborts the run — later lines still count', () => {
    const good = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'find / -name x' } }] },
    });
    const text = '{"truncated": mid-writ\n' + good + '\n';
    expect(countSessionHygiene(text).filesystemWideScans).toBe(1);
  });

  test('is additive, so an edge can accumulate across files', () => {
    const a = countSessionHygiene('Unknown skill: c3');
    const b = countSessionHygiene('Unknown skill: c3');
    expect(a.unknownSkills.c3 + b.unknownSkills.c3).toBe(2);
  });
});
```

Expected failure: `Cannot find module './session-hygiene.ts'`.

### GREEN — implement

```ts
// session-hygiene.ts — PURE core (pure-core.md): text in, counts out. No fs, no spawn, no glob;
// the edge (scripts/session-hygiene.ts) owns every effect.
//
// One definition of "filesystem-wide scan" lives here and is used TWICE: by the ratchet counter
// below and by `core/session.ts`'s decideScanGuardHook. Two definitions would drift.

/** A `find` root that means "the whole filesystem" or "the whole home directory". Ordered
 * longest-first so `$HOME/` is preferred over `$HOME`. */
const SCAN_ROOT = String.raw`(?:"\$HOME"|'\$HOME'|\$HOME\/?|~\/?|\/)`;

/** `find` must sit at a command position — start of string, or after a separator — so that
 * `grep -rn "find /"` (which merely mentions it) does not match. Leading option tokens
 * (`find -L / ...`) are skipped, because under-detecting is a bug. */
const FS_WIDE_SCAN_RE = new RegExp(
  String.raw`(?:^|[;&|(]|\s)find\s+(?:-[A-Za-z]+\s+)*` + SCAN_ROOT + String.raw`(?=\s|$)`,
);

/** PURE. True when this shell command runs a `find` rooted at the filesystem or home root.
 * Over-matching is by design; under-matching is a bug (plan Oracle). */
export function isFilesystemWideScan(command: string): boolean {
  // A quoted echo of the command is not a command position; strip double-quoted spans first so
  // `echo "find / -name x"` does not match, while `find / -iname "x"` still does.
  const withoutQuotedSpans = command.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return FS_WIDE_SCAN_RE.test(withoutQuotedSpans);
}

const UNKNOWN_SKILL_RE = /Unknown skill: ([A-Za-z0-9_-]+)/g;

export interface SessionHygieneCounts {
  unknownSkills: Record<string, number>;
  filesystemWideScans: number;
}

/** PURE. Counts both metrics over one chunk of log text (one file, or many concatenated).
 * Occurrence-based, never line-based: one JSONL line can carry several. */
export function countSessionHygiene(text: string): SessionHygieneCounts {
  const unknownSkills: Record<string, number> = {};
  for (const m of text.matchAll(UNKNOWN_SKILL_RE)) {
    const name = m[1] as string;
    unknownSkills[name] = (unknownSkills[name] ?? 0) + 1;
  }

  let filesystemWideScans = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    for (const command of bashCommands(line)) {
      if (isFilesystemWideScan(command)) filesystemWideScans += 1;
    }
  }
  return { unknownSkills, filesystemWideScans };
}

/** Every Bash tool_use command in one JSONL line. A line that is not valid JSON is SKIPPED, never
 * thrown on: campaign logs can end mid-write after a crash, and one truncated line must not cost
 * the whole measurement (fail-closed-edges.md obligation 1 — narrow catch, no crash). */
function bashCommands(line: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  const content = (parsed as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; name?: unknown; input?: { command?: unknown } };
    if (b?.type === 'tool_use' && b?.name === 'Bash' && typeof b?.input?.command === 'string') {
      out.push(b.input.command);
    }
  }
  return out;
}
```

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test core/metrics/session-hygiene.test.ts
```
Expected: all tests pass, 0 fail.

- [x] **Step 4: Commit** — stage this task's files and commit, with the trailers from
  Global Constraints (`Tribe-Card: runner-session-user-settings`, `Tribe-Task: 1/7`) in the
  commit's ONE final paragraph, ticking this task's boxes in that SAME commit.
- [x] Task 1 complete

---

## Task 2 — the ratchet edge + the measured BEFORE baseline

**Model: `sonnet`.** Mirrors an existing file closely, but must reproduce a specific real number.

**Owns:** `plugins/tribe/scripts/session-hygiene.ts` (new),
`docs/superpowers/evidence/2026-09-20-runner-session-hygiene.md` (new).

Follow `plugins/tribe/scripts/ratchet-check.ts` exactly for shape: thin impure edge, `parseArgs`
that **refuses a flag whose value is missing rather than consuming the next token**
(`fail-closed-edges.md` obligation 1), a named error class, no logic.

### Requirements

```
bun plugins/tribe/scripts/session-hygiene.ts --root <dir> [--json]
```

- Walks `<root>` recursively for `*.log` and `*.jsonl`, reads each, accumulates via
  `countSessionHygiene`. **A single unreadable file is skipped with a warning to stderr, never a
  crash** (obligation 1).
- Prints a stable report: each `Unknown skill: <name>` count (descending), the total, and the
  filesystem-wide-scan count. `--json` prints the same data as JSON.
- **Exit 0 always** — this is a measurement, not a gate.

### Verify — the acceptance test IS the real-world number

```bash
bun plugins/tribe/scripts/session-hygiene.ts \
  --root ~/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening
```
**Expected: `filesystem-wide scans: 4`** and `Unknown skill: c3` = 6. The `4` is the card's
independently measured G2 baseline; **if the script prints anything else, the detector is wrong —
fix it, do not adjust the expectation.**

Then record the baseline into the evidence doc, from real runs, for **three** roots:
`.../campaigns/supervisor-hardening`, `.../campaigns` (all), and
`~/.claude/projects/-Users-hip-repo-tribe`.

The evidence doc must carry this note verbatim:

> Counted over the historical corpus these totals can only grow: past logs are immutable and every
> new session appends to the same directories. The meaningful ratchet is therefore **per-campaign**
> — G2 and G4 state it that way ("baseline 4 in campaign `supervisor-hardening` → 0 in the next
> campaign's logs"). The global total is context, not the target.

- [x] **Step 4: Commit** — stage this task's files and commit, with the trailers from
  Global Constraints (`Tribe-Card: runner-session-user-settings`, `Tribe-Task: 2/7`) in the
  commit's ONE final paragraph, ticking this task's boxes in that SAME commit.
- [x] Task 2 complete

---

## Task 3 — the scan-guard hook (owner ruling R-a)

**Model: `sonnet`.** Pure, but the deny message is load-bearing and the wiring has an exact index.

**Owns:** `core/session.ts`, `core/session.test.ts`, `ports/ports.ts` (the hook count only).

Import `isFilesystemWideScan` from Task 1 — **do not re-implement the predicate.**

### RED

Add to `core/session.test.ts`:

```ts
describe('decideScanGuardHook (R-a)', () => {
  test('denies a filesystem-wide find and names the alternative', async () => {
    const d = decideScanGuardHook({ tool_name: 'Bash', tool_input: { command: 'find / -maxdepth 4 -iname "*c3x*"' } });
    expect(d.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(d.hookSpecificOutput?.permissionDecisionReason).toContain('c3');
  });

  test('allows a scoped find', () => {
    expect(decideScanGuardHook({ tool_name: 'Bash', tool_input: { command: 'find /Users/hip/repo/tribe -iname "x"' } })).toEqual({});
  });

  test('has no opinion on non-Bash tools', () => {
    expect(decideScanGuardHook({ tool_name: 'Read', tool_input: { command: 'find / -name x' } })).toEqual({});
  });

  test('is wired as the FOURTH PreToolUse entry and actually denies', async () => {
    let captured: PinnedSessionOptions | undefined;
    const io = recordingIo();
    io.spawnSession = (params) => {
      captured = params.options;
      return messages([INIT_MESSAGE, { type: 'result', subtype: 'success', result: 'SHIPPED 42 abc1234', session_id: 'sess-123' }]);
    };
    await runSession({ brief: 'x' }, fixtureConfig(), io);
    const wired = (captured as PinnedSessionOptions).hooks.PreToolUse[3]?.hooks[0];
    expect(wired).toBeDefined();
    const d = await (wired as (i: unknown) => Promise<HookDecision>)({
      tool_name: 'Bash',
      tool_input: { command: 'find $HOME -name "*.log"' },
    });
    expect(d.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
```

### GREEN

```ts
/** The reason a denied filesystem-wide scan reports back. Phrased as an INSTRUCTION, not just a
 * refusal (same contract as BACKGROUNDING_DENIED_REASON) — a session that is only blocked will
 * try the next variant of the same hunt; a session that is redirected stops hunting. */
export const SCAN_DENIED_REASON =
  'Filesystem-wide scans are disabled for campaign sessions: scanning from / or $HOME walks ' +
  'Desktop/Documents/Downloads and triggers an OS folder-consent prompt that nobody is present ' +
  'to answer. You almost never need one. For architecture, components or file->component ' +
  'lookup, invoke the `c3` skill (Skill tool, skill name "c3") — it resolves its own tooling. ' +
  'For anything else, scan a specific directory you already know (e.g. the repo root or a ' +
  'package directory), not / or $HOME.';

/** PURE: denies one PreToolUse event that would run a `find` rooted at the filesystem or home
 * root (owner ruling R-a). The predicate itself lives in `core/metrics/session-hygiene.ts` and is
 * shared with the ratchet counter, so the guard and the measurement can never disagree about what
 * a scan is. Bash-only; every other tool gets no opinion. */
export function decideScanGuardHook(input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown; tool_input?: unknown };
  if (event.tool_name !== 'Bash') return {};
  const command = ((event.tool_input ?? {}) as { command?: unknown }).command;
  if (typeof command !== 'string' || !isFilesystemWideScan(command)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: SCAN_DENIED_REASON,
    },
  };
}
```

Wire it as the **fourth** entry in `buildSessionOptions`, after the merge gate:

```ts
// Filesystem-wide scan wall (owner ruling R-a) — decideScanGuardHook.
{ hooks: [(hookInput: unknown) => Promise.resolve(decideScanGuardHook(hookInput))] },
```

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test core/session.test.ts && bunx tsc --noEmit
```
Expected: all pass, including the three pre-existing hook-wiring tests at indices 0-2 **unchanged**.

- [x] **Step 4: Commit** — stage this task's files and commit, with the trailers from
  Global Constraints (`Tribe-Card: runner-session-user-settings`, `Tribe-Task: 3/7`) in the
  commit's ONE final paragraph, ticking this task's boxes in that SAME commit.
- [x] Task 3 complete

---

## Task 4 — load the user tier (the card's one-line ruling)

**Model: `haiku`.** Two literals and one assertion; the brief leaves nothing to decide.

**Owns:** `core/session.ts:181`, `ports/ports.ts:196`, `core/session.test.ts:88`.

1. `ports/ports.ts` — `settingSources: ['project'];` → `settingSources: ['user', 'project', 'local'];`
2. `core/session.ts` — the value, and replace the comment with:

```ts
    // Parity with a person's session (owner ruling 2026-09-20): the CLI's own default tier list.
    // 'user' is what carries ~/.claude/settings.json's enabledPlugins, so the C3 plugin is
    // registered and `Skill c3` resolves; with 'project' alone it returned "Unknown skill: c3".
    // Written explicitly rather than by omitting the option, so the pinned-option regression test
    // below keeps a value to assert and an SDK default change cannot move it silently.
    // PROVEN by real sessions (spec §4.2): the SDK's own `model` and `permissionMode` above still
    // WIN over this tier's `model` / `permissions.defaultMode`.
    settingSources: ['user', 'project', 'local'],
```

3. `core/session.test.ts:88` — the **one** assertion the ruling makes wrong:

```ts
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
```

**Change nothing else in that test file.**

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
```
Expected: the whole runner suite green.

- [x] **Step 4: Commit** — stage this task's files and commit, with the trailers from
  Global Constraints (`Tribe-Card: runner-session-user-settings`, `Tribe-Task: 4/7`) in the
  commit's ONE final paragraph, ticking this task's boxes in that SAME commit.
- [x] Task 4 complete

---

## Task 5 — AGENTS.md names only things that exist (G3)

**Model: `haiku`.** Mechanical text change plus one grep test.

**Owns:** `AGENTS.md`, `plugins/tribe/scripts/tests/agents-md-claims.test.ts` (new).

`AGENTS.md:5` still promises a binary that does not exist:

```markdown
File lookup: `c3 lookup <file-or-glob>` maps files/directories to components + refs.
```

(C3's own SKILL.md: *"There is no `c3` executable"*.) Line 3's `/c3` mention was already removed in
`b6b5330`; **only line 5 is wrong now.**

Replace the two C3 lines (3 and 5) with text naming the **skill**, which is what actually resolves
(`Skill` tool, name `c3` — proven at plan time):

```markdown
For architecture questions, changes, audits or file context, invoke the `c3` skill (Skill tool,
skill name `c3`); it resolves its own tooling — there is no `c3` executable on PATH.
Operations: query, audit, change, ref, rule, sweep.
File lookup: ask the `c3` skill to map a file or glob to its components + refs.
```

### The gate (G3's "a test or gate greps for the false claim")

A test asserting `AGENTS.md` never promises a bare `c3`/`c3x` executable. It must fail on the
current text and pass after. Match the false *claim* — a backticked `c3 <subcommand>` invocation or
a `which c3` style promise — not merely the string `c3`, which legitimately appears throughout.

### Verify

```bash
cd /Users/hip/repo/tribe-wt/runner-session-user-settings && bun test plugins/tribe/scripts/tests/agents-md-claims.test.ts
command grep -n "c3 lookup" AGENTS.md || echo "false claim gone"
```
Expected: test passes; `false claim gone`.

- [x] **Step 4: Commit** — stage this task's files and commit, with the trailers from
  Global Constraints (`Tribe-Card: runner-session-user-settings`, `Tribe-Task: 5/7`) in the
  commit's ONE final paragraph, ticking this task's boxes in that SAME commit.
- [x] Task 5 complete

---

## Task 6 — the E2E, on a real model, through the runner's own spawn path

**Model: `sonnet`.** Judgment about transcript assertions; the failure mode (a stub-passing test)
is the one the owner explicitly called out.

**Owns:** `core/session.e2e.test.ts` (new).

**This is the card's G1 oracle and the owner's explicit requirement.** Non-negotiable properties:

1. It calls **`runSession`** with the **real** `sdkSpawnSession` from
   `adapters/session.adapter.ts`. Not `query()` directly, not a hand-built options object, not a
   stub.
2. It runs a **real model** (`haiku` — cheapest that can call a tool).
3. It asserts **from the captured transcript**, via the same `io.appendLog` seam production uses:
   - the `Skill` tool was invoked with skill `c3` and returned C3 content;
   - **no `Unknown skill`** appears anywhere in the transcript;
   - **no filesystem-wide scan** ran — assert with `isFilesystemWideScan` over every Bash
     `tool_use` command in the transcript (reuse Task 1's predicate; do not re-implement).
4. **Opt-in**, behind `RUN_SESSION_E2E=1`, skipped otherwise (it costs tokens and needs auth), so
   `bun test` stays hermetic. Use `test.skipIf(process.env.RUN_SESSION_E2E !== '1')`.

### R-c — the MCP server must fail OPEN (Shaman ruling, load-bearing)

Loading the user tier connects one MCP server (`plugin:playwright:playwright`) at session startup
in **every** spawned session. That is an outside-world dependency on the startup path, and
`~/.claude/rules/fail-closed-edges.md` governs it:

> "An **impure edge** ... must fail *closed*: refuse with a clear message, never crash, never
> hang, never reach outside its root."

**Prove by running** that a spawned session still starts and completes a trivial action when that
MCP server is **unavailable** — browser binary missing, server command absent, or otherwise made
to fail. Force the failure (e.g. point the plugin's server command at a nonexistent binary, or
run with a `PATH`/env that cannot resolve it); do not simulate it with a stub.

**Required outcome:** the session **starts anyway**, with the playwright tools simply absent from
its tool list, and the trivial action completes. Never a hang, never a startup abort.

**If it does NOT fail open — if the session hangs or refuses to start — STOP and report
`NEEDS_CONTEXT` immediately.** Do not work around it. A campaign that dies because a browser is
missing is strictly worse than the bug this card fixes, and that outcome needs a ruling, not a fix.

Record the transcript (or the init message showing the server absent and the session live) in the
task report; Task 7 carries it into the evidence doc.

**The empty-implementation check, and it is mandatory:** on `settingSources: ['project']` this test
**must fail**, and fail with `Unknown skill: c3` — not with a setup or auth error. Prove it:
temporarily revert Task 4's literal, run the test, capture the failure, restore. **Paste both
transcripts into the task report.** A test that passes both before and after Task 4 proves nothing
and is a blocker finding.

Suggested brief for the spawned session (keep it tool-forcing and scan-free):

> Invoke the Skill tool with the skill named "c3". Then reply with exactly one line:
> `SKILL_RESULT=<ok|unknown>` followed by the first 200 characters the Skill tool returned.
> Do not use Bash. Do not search the filesystem.

Note `runSession` parses the final result for `SHIPPED`/`NEEDS_DIRECTION` and will report
`outcome: 'error'` for any other text. **That is expected here — assert on the transcript, not on
`outcome`.**

### Verify

```bash
cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 bun test core/session.e2e.test.ts
cd plugins/tribe/scripts/runner && bun test   # E2E skipped, suite still hermetic and green
```
Expected: the E2E passes with the tier list in place, the default suite stays green with it
skipped, and the R-c probe shows a live session whose tool list simply lacks the playwright tools.


- [ ] **Step 4: Commit** — stage this task's files and commit, with the trailers from
  Global Constraints (`Tribe-Card: runner-session-user-settings`, `Tribe-Task: 6/7`) in the
  commit's ONE final paragraph, ticking this task's boxes in that SAME commit.
- [ ] Task 6 complete

---

## Task 7 — documentation and the AFTER evidence

**Model: `sonnet`.** Must describe measured reality without overclaiming.

**Owns:** `plugins/tribe/scripts/runner/README.md`,
`docs/superpowers/evidence/2026-09-20-runner-session-hygiene.md`.

1. **README** — update the option documentation for the new tier list and the fourth hook, and add
   to the *"What HAS been verified live"* list (~line 1161, which currently states
   `settingSources: ['project']` genuinely loading the target repo's CLAUDE.md):
   - `Skill c3` resolving in a real spawned session under `['user','project','local']`, and
     returning `Unknown skill: c3. Did you mean cd?` under `['project']`;
   - the SDK's `model` and `permissionMode` proven to win over the user tier's `model` /
     `permissions.defaultMode`;
   - a failing user-tier hook proven not to break a session.
2. **Evidence doc** — add the AFTER section: the ratchet re-run on the same three roots, the E2E
   before/after transcripts, and the exact commands to reproduce each. Keep the BEFORE numbers from
   Task 2 **unedited**.

State plainly that the historical totals do not drop (past logs are immutable) and that the
**forward** ratchet is the next campaign's own logs — G2/G4's own framing.

### Verify

```bash
cd /Users/hip/repo/tribe-wt/runner-session-user-settings && bun test plugins/tribe/scripts/runner/ && command grep -c "user', 'project', 'local'" plugins/tribe/scripts/runner/README.md
```
Expected: the runner suite green, and a non-zero count proving the README documents the new tier list.

- [ ] **Step 4: Commit** — stage this task's files and commit, with the trailers from
  Global Constraints (`Tribe-Card: runner-session-user-settings`, `Tribe-Task: 7/7`) in the
  commit's ONE final paragraph, ticking this task's boxes in that SAME commit.
- [ ] Task 7 complete

---

## Definition of done

- [ ] `bun test` green in `plugins/tribe/scripts/runner/`; `bunx tsc --noEmit` clean
- [ ] `RUN_SESSION_E2E=1 bun test core/session.e2e.test.ts` green, **and proven to fail on `['project']`**
- [ ] The ratchet reproduces **4** on `supervisor-hardening`
- [ ] Evidence doc carries BEFORE and AFTER from the same committed tool
- [ ] PR body carries the before/after transcripts and the ratchet numbers
