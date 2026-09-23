# Plan — supervisor-session-settings

**Spec:** `docs/superpowers/specs/2026-09-24-supervisor-session-settings-design.md`
**Card:** `~/.tribe/-Users-hiep-repo-tribe/cards/supervisor-session-settings.md` (issue #163)
**Campaign:** `fu-supervisor-settings`
**Base:** `d6cad2f` (master)
**Execution worktree:** `/Users/hiep/repo/tribe-wt/supervisor-session-settings` (branch
`feat/supervisor-session-settings`); every absolute path below assumes it.

> **Rulings (spec §10; `answers.md` R1/R2):** **R1 (Shaman), Q1 = (b)** — `closing`'s grant is
> enforced by `decideClosingGrantHook` (Task 5). **R2 (owner), Q2 = (a), "Allow the Skill tool"** —
> `JUDGMENT_ALLOWED_TOOLS` gains `Skill` and the containment hook allows it, `Skill` only (Task 6);
> G1 holds as the issue wrote it for all three kinds (Task 7).

Nine tasks, **sequential, one wave, one branch, one PR.** Tasks 3, 4, 5 and 6 all edit
`core/supervisor/session.ts` and its test, so no two tasks have disjoint `owns_files` worth a
second worktree.

**Schema-locked paths checked:** this campaign's `campaign-state.json` locks
`plugins/tribe/scripts/runner/core/state.ts` and `plugins/tribe/scripts/runner/core/types.ts`.
No task touches either, so this plan carries no `allowsSchemaChange` front-matter.

---

## Global Constraints

- **Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic implementer.**
- **Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**
- Run runner commands from `plugins/tribe/scripts/runner/` unless a task says otherwise; run
  `bun install` there once if `node_modules/` is missing.
- **TDD is mandatory:** write the failing test, run it, see it fail **for the stated reason**, then
  implement. A test that never failed first proves nothing.
- **Every commit** carries, in its ONE final paragraph, these lines in this order:
  `Tribe-Card: supervisor-session-settings`, `Tribe-Task: N/9`, `Campaign: fu-supervisor-settings`,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tick this plan's checkboxes for the
  task in the SAME commit as the code.
- **The grants stay byte-identical, with ONE owner-ruled exception:** `JUDGMENT_DISALLOWED_TOOLS`,
  `CLOSING_ALLOWED_TOOLS`, `CLOSING_DISALLOWED_TOOLS` (`core/supervisor/session.ts:26-47`) and
  `permissionMode: 'default'` do not change in any task (issue #163 scope fence).
  **`JUDGMENT_ALLOWED_TOOLS` gains `Skill` by owner ruling R2** (Task 6) — `Skill` only; `Bash`
  stays in `JUDGMENT_DISALLOWED_TOOLS` and no other tool is added anywhere.
- **One predicate (card D3):** import `decideScanGuardHook` / `isFilesystemWideScan`; never copy,
  wrap with new logic, or fork them.
- **Do not touch:** `core/session.ts` (value-import only), `core/metrics/session-hygiene.ts`,
  `core/state.ts`, `core/types.ts`, the executor's other three hooks (card D2).
- **Shell hygiene on this machine:** use `command grep`, never bare `grep`; there is **no
  `timeout` binary** (macOS) — bound real sessions with `sessionTimeoutMs` and bun's per-test
  timeout, never with `timeout`. Real-session commands run with `env -u ANTHROPIC_API_KEY`
  (sessions authenticate via Claude Code login, as `tests/test-supervisor-permission-real.sh`
  already does).
- **Real sessions cost tokens:** only Tasks 5, 6 and 7 spawn them, only behind `RUN_SESSION_E2E=1`
  or `TRIBE_REAL_E2E=1`, always on `claude-haiku-4-5-20251001`.

## Oracle (the contract — no external standard overrides it)

- Issue #163's "What done looks like" checklist, as quoted in the card, is the goal; the card's
  per-goal Oracle section says how each row is proven. **An options-object assertion alone never
  satisfies G1** — only a real session's transcript does (Task 7).
- **Scan detection:** `isFilesystemWideScan` at `d6cad2f` is the oracle for what a scan is
  (under-detecting is a bug, over-detecting is by design); this card does not change it.
- **Grant enforcement (Task 5, R1):** a tool name absent from `CLOSING_ALLOWED_TOOLS`, or a
  malformed event, is denied. Over-denying a tool nothing in Stage D uses is by design (R1 accepts
  losing `TaskCreate`/`CronList`/`ListAgents`); letting one un-granted tool through is the bug.
- **`Skill` in judgment sessions (Task 6, R2):** `Skill` is allowed; every tool that was denied
  before R2 is still denied. Granting anything besides `Skill` is the bug.

## Adjudication rule — REFUTED in advance (copied verbatim from the card)

- The inherited `evals-file-has-52-evals` failure (red on untouched master).
- The intermittent real-subprocess timing tests PR #166 measured as inherited: `core/watchdog/**`,
  `watchdog-integration.test.ts`, a `launchViewer` test, `test-input-asymmetry.sh`, and
  `test-supervisor-kill.sh` inside a loaded full sweep. Each is refuted only if it also fails on base.
- Findings about the executor path (`core/session.ts`) that #162 already settled.

Also settled by the spec and the rulings, so not findings: the hand-load of `verify-shipped` is
**kept** on purpose (spec §4.4); `closing` losing `TaskCreate`/`CronList`/`ListAgents` is accepted
by R1; `Skill` in `JUDGMENT_ALLOWED_TOOLS` is owner ruling R2, not a fence breach; the C3 CLI not
running in `ruling`/`ratify` (no `Bash`) is R2's known, accepted limit (spec §4.8); the scan wall
is `find`-only by its oracle (spec §9 F2).

---

## Task 1 — record the BEFORE baseline with the committed ratchet tool

**Model: `haiku`.** Runs one committed tool and writes numbers down; no judgment.

**owns_files:** `docs/superpowers/evidence/2026-09-24-supervisor-session-settings.md` (new).

### RED — the check that fails first

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -q '^## BEFORE' docs/superpowers/evidence/2026-09-24-supervisor-session-settings.md
```
Expected: exit 2 / "No such file or directory" — the evidence document does not exist yet.

### GREEN

Run, at the branch base (no code changed yet), exactly:

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings
for r in ~/.tribe \
         ~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings \
         ~/.claude/projects/-Users-hiep-repo-tribe; do
  bun plugins/tribe/scripts/session-hygiene.ts --root "$r" --json
done
```

Create the evidence document with a `## BEFORE` section holding: the base SHA
(`git rev-parse HEAD`), each command above with its JSON output verbatim, and spec §4.3's two
tables copied verbatim (the plan-time measurement: `~/.tribe` empty; the probe corpus control 12
`Unknown skill: c3` → treatment 0). Carry this note verbatim:

> The supervisor-session root G5 speaks about (`<campaign home>/supervisor/sessions/`) is empty on
> this machine, so its before-count of 0 proves nothing on its own. The ratchet that decides G5 is
> Task 7's own sessions, run once with the envelope reverted (`before/`) and once as built
> (`after/`), measured by this same tool in Task 8. Historical totals under `~/.claude/projects`
> can only grow; they are context, not the target.

### Verify

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -c '"filesystemWideScans"' docs/superpowers/evidence/2026-09-24-supervisor-session-settings.md
```
Expected: `3` or more (one JSON block per root), and the RED command above now exits 0.

- [x] **Step 4: Commit** — stage the evidence document and commit with the Global Constraints
  trailers (`Tribe-Task: 1/9`), ticking this task's boxes in the SAME commit.
- [x] Task 1 complete

---

## Task 2 — `inferOneShotKind` keys on the grant, never on the tier list

**Model: `sonnet`.** Small, but it is the one coupling the issue did not name (spec §1).

**owns_files:** `plugins/tribe/scripts/runner/cli/main.ts` (only `inferOneShotKind` and its doc
comment, ~lines 600-616), `plugins/tribe/scripts/runner/cli/main.test.ts`.

### RED — why it fails today

Today `inferOneShotKind` returns `'closing'` for ANY options whose `settingSources` is non-empty
(`cli/main.ts:613`), so real `ruling` options carrying a tier list infer `'closing'`.

Append to `cli/main.test.ts` (the file already imports from `./main.ts` mid-file; follow that):

```ts
import { inferOneShotKind } from './main.ts';
import { buildOneShotOptions, type OneShotSessionConfig } from '../core/supervisor/session.ts';

describe('inferOneShotKind — keys on the grant, never on the tier list (card supervisor-session-settings)', () => {
  const config: OneShotSessionConfig = {
    homeDir: '/abs/home/.tribe/key/campaigns/slug',
    model: 'claude-haiku-fixture',
    maxTurns: 5,
    repoRoot: '/abs/repo',
    realpath: (p: string) => p,
    verifyShippedPluginDir: '/abs/plugins/verify-shipped',
  };
  const TIER_LISTS: string[][] = [[], ['project'], ['user', 'project', 'local']];

  for (const kind of ['ruling', 'ratify', 'closing'] as const) {
    test(`the REAL ${kind} options infer "${kind}" whatever settingSources holds`, () => {
      const options = buildOneShotOptions(kind, config, new AbortController());
      for (const settingSources of TIER_LISTS) {
        expect(inferOneShotKind({ ...options, settingSources })).toBe(kind);
      }
    });
  }
});
```

Run: `bun test cli/main.test.ts -t inferOneShotKind`
Expected failure (dry-run at plan time, `0 pass, 3 fail`): `ruling` and `ratify` fail with
`Expected: "ruling"` / `"ratify"`, `Received: "closing"` (a non-empty tier list), and `closing` fails
with `Expected: "closing"`, `Received: "ruling"` (an empty tier list).

### GREEN

Replace the body and doc comment of `inferOneShotKind`:

```ts
/** Task 17 (card `campaign-supervisor`, `fixtures-mirror-reality.md`): infers which of the
 * three one-shot kinds a spawn is for, FROM THE OPTIONS THEMSELVES — `OneShotSpawnParams`
 * (`core/supervisor/session.ts`) carries only `prompt`/`options`, no `kind` field. The inference
 * keys on the GRANT, which is fixed per kind, never on `settingSources`, which is the same
 * `['user','project','local']` for all three (card supervisor-session-settings, G3):
 * `closing` is the only kind granted `Bash` (`CLOSING_ALLOWED_TOOLS`); of the other two, only
 * `ruling` carries `additionalDirectories` (repo read access, §5.2) — `ratify` never does
 * (§5.3: "no repo access at all"). Unit-tested in `cli/main.test.ts` against the real
 * `buildOneShotOptions` output for every kind. */
export function inferOneShotKind(options: OneShotSessionOptions): SessionKind {
  const isGrantedShell = options.allowedTools?.includes('Bash') === true;
  if (isGrantedShell) return 'closing';
  const hasRepoReadAccess = options.additionalDirectories !== undefined;
  return hasRepoReadAccess ? 'ruling' : 'ratify';
}
```

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test cli/main.test.ts && bunx tsc --noEmit
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -1
```
Expected: all `cli/main.test.ts` tests pass, `tsc` exit 0, and the double suite prints
`40 passed, 0 failed`.

- [x] **Step 4: Commit** — stage the two files and commit with the Global Constraints trailers
  (`Tribe-Task: 2/9`), ticking this task's boxes in the SAME commit.
- [x] Task 2 complete

---

## Task 3 — tier parity: `['user', 'project', 'local']` for all three kinds (G3)

**Model: `haiku`.** One literal, one new assertion, comment rewrites whose text is given below.

**owns_files:** `plugins/tribe/scripts/runner/core/supervisor/session.ts`,
`plugins/tribe/scripts/runner/core/supervisor/session.test.ts`.

### RED — why it fails today

`session.ts:113` sets `['project']` for `closing` and `[]` for `ruling`/`ratify`.

Add inside `describe('buildOneShotOptions — spec §5.1 envelope (regression guard)', …)`:

```ts
  // Card supervisor-session-settings (G3): the executor path's tier list, for every kind — the
  // 'user' tier is what registers ~/.claude/settings.json's enabledPlugins (the C3 plugin).
  test('settingSources is ["user","project","local"] for every kind (parity with core/session.ts)', () => {
    for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.settingSources).toEqual(['user', 'project', 'local']);
    }
  });
```

Run: `bun test core/supervisor/session.test.ts -t settingSources`
Expected failure: `Expected: ["user","project","local"]`, `Received: []` (ruling first).

### GREEN

1. Replace `session.ts:111-113` with:

```ts
    // Parity with the executor path (card supervisor-session-settings, G3; core/session.ts has
    // the same list): 'user' carries ~/.claude/settings.json's enabledPlugins, so the C3 plugin
    // registers and `Skill c3` no longer returns "Unknown skill: c3". Written explicitly, never by
    // omitting the option, so the regression test keeps a value to assert. MEASURED (spec §4.1):
    // the SDK's own `model` and `permissionMode: 'default'` still win over the user tier's. For a
    // supervisor session `cwd` is the campaign home, so 'project'/'local' read
    // <home>/.claude/settings(.local).json, which no campaign home carries.
    settingSources: ['user', 'project', 'local'],
```

2. Rewrite every comment in `session.ts` that states `settingSources: ['project']` as current
   fact (the Verify grep below must find no `['project']` left), keeping every list literal
   byte-identical. The three places, with the replacement text:
   - lines 21-25 (above `JUDGMENT_ALLOWED_TOOLS`): replace
     "because `settingSources: ['project']` alone grants nothing when the target repo has no
     committed `.claude/settings.json` (this repo has none)" with
     "because no loaded settings tier grants `closing` anything by itself (spec §5.4, R11)".
   - lines 34-41 (above `CLOSING_ALLOWED_TOOLS`): change "relying on `settingSources: ['project']`
     to load the target repo's own `.claude/settings.json` for a grant; but that file grants
     NOTHING when the target repo has none committed (this repo has none)" to
     "relying on a loaded settings tier for a grant; but no settings tier supplies one for this
     envelope".
   - lines 120-124 (inside the `closing` branch): replace
     "`settingSources: ['project']` above grants nothing when the target repo has no committed
     `.claude/settings.json` (this repo has none), so without this grant the session could not
     run headless" with
     "the settings tiers above grant nothing to this envelope, so without this grant the session
     could not run headless".

3. Rewrite the `verify-shipped` comments (G4 decision, spec §4.4):
   - lines 61-64 (the `plugins` field doc) become:

```ts
  /** R11 (Task 20, spec §5.4 item 4): the SDK's local-plugin option, set on `closing` only, so
   * `verify-shipped` resolves BY NAME inside the session from the repo itself. Kept after the
   * user tier loaded (card supervisor-session-settings, G4, MEASURED): the user tier finds
   * `verify-shipped` only where install.sh symlinked it into ~/.claude/skills — a host fact — while
   * this load works on every host, and where both exist the session registers it once.
   * `ruling`/`ratify` never carry this field. */
```

   - lines 128-131 (inside the `closing` branch) become:

```ts
    // R11 item 4, kept by card supervisor-session-settings (G4): load `verify-shipped` from the
    // repo so it resolves on a host that never ran install.sh. Absent only when the edge
    // (`decide.ts`) has already fail-closed the spawn itself; see its
    // `verifyShippedPluginAvailable` guard.
```

**Change no existing assertion in `session.test.ts`.**

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/ cli/main.test.ts && bunx tsc --noEmit
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -1
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -n "\['project'\]" plugins/tribe/scripts/runner/core/supervisor/session.ts || echo "no stale tier claim"
```
Expected: all pass, `tsc` exit 0, `40 passed, 0 failed`, and `no stale tier claim`.

- [x] **Step 4: Commit** — stage the two files and commit with the Global Constraints trailers
  (`Tribe-Task: 3/9`), ticking this task's boxes in the SAME commit.
- [x] Task 3 complete

---

## Task 4 — the scan wall in all three kinds (G2, D2, D3)

**Model: `sonnet`.** Wiring with exact indices; two existing assertions change on purpose.

**owns_files:** `plugins/tribe/scripts/runner/core/supervisor/session.ts`,
`plugins/tribe/scripts/runner/core/supervisor/session.test.ts`.

### The assertions this task deliberately changes (brief-contracts: fence by intent)

- `'closing gets NO containment hook — the named exception (spec §5.4)'` asserts
  `options.hooks` is `undefined`. Its INTENT (no write containment in `closing`) survives; its
  FORM cannot, because `closing` now carries the scan guard. It is replaced by the
  "closing still has no write containment" test below.
- The per-kind containment test asserts `toHaveLength(1)`; it becomes `toHaveLength(2)`, with the
  containment hook still at index 0 and still denying the repo write. Every other assertion in
  that test stays exactly as it is.

### RED — why it fails today

No supervisor envelope wires `decideScanGuardHook`; `closing` has no hooks at all
(`session.ts:119-135` returns first).

Add to `session.test.ts` (extend the existing import from `'../session.ts'` to also bring in
`SCAN_DENIED_REASON` and the `HookDecision` type):

```ts
// Issue #163's variant list, verbatim in intent: plain, quoted, sh -c, eval, backtick,
// /usr/bin/find and ${HOME}. Every one is denied by isFilesystemWideScan at d6cad2f (spec §4.7).
const SCAN_VARIANTS = [
  'find / -name x',
  "find '/' -name x",
  'find "/" -name x',
  "sh -c 'find / -name x'",
  'bash -c "find / -name x"',
  "eval 'find / -name x'",
  'echo `find / -name x`',
  '/usr/bin/find / -name x',
  'find ${HOME} -name x',
  'find "${HOME}" -name x',
  'find ~ -name x',
  'find $HOME -name x',
];

/** Every decision the envelope's wired PreToolUse hooks return for one event, in order. */
async function wiredDecisions(options: OneShotSessionOptions, event: unknown): Promise<HookDecision[]> {
  const decisions: HookDecision[] = [];
  for (const entry of options.hooks?.PreToolUse ?? []) {
    for (const hook of entry.hooks) decisions.push(await hook(event));
  }
  return decisions;
}

function isScanDenial(d: HookDecision): boolean {
  return d.hookSpecificOutput?.permissionDecision === 'deny'
    && d.hookSpecificOutput?.permissionDecisionReason === SCAN_DENIED_REASON;
}

describe('the scan wall is wired into every supervisor envelope (issue #163, G2)', () => {
  for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
    for (const command of SCAN_VARIANTS) {
      test(`${kind}: the wired hooks refuse ${JSON.stringify(command)} with SCAN_DENIED_REASON`, async () => {
        const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
        const decisions = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command } });
        expect(decisions.some(isScanDenial)).toBe(true);
      });
    }
  }

  test('closing: a scoped find gets no denial from any wired hook', async () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    const decisions = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command: 'find /abs/repo -name x' } });
    expect(decisions.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
  });

  test('closing still has no write containment — a Write into the repo is not denied (spec §5.4)', async () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    const decisions = await wiredDecisions(options, { tool_name: 'Write', tool_input: { file_path: '/abs/repo/src/touched.txt' } });
    expect(decisions.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
  });
});
```

Then make the two deliberate edits listed above (delete the `hooks` toBeUndefined test; change
`toHaveLength(1)` to `toHaveLength(2)`).

Run: `bun test core/supervisor/session.test.ts`
Expected failure: every `SCAN_VARIANTS` case fails `expect(false).toBe(true)` (36 cases — for
`ruling`/`ratify` the containment hook denies `Bash` with its NOT-granted reason, never
`SCAN_DENIED_REASON`; for `closing` there are no hooks), and the `toHaveLength(2)` assertion fails
with `Received length: 1`.

### GREEN

In `session.ts`, change the import on line 16 to
`import { decideScanGuardHook, type HookDecision, type SessionMessage } from '../session.ts';` and
add below the grant constants:

```ts
/** The scan wall (issue #163; card D2/D3): the executor's own `decideScanGuardHook`, reused —
 * never a second predicate — as its own PreToolUse entry. A supervisor session is the unattended
 * case the wall exists for: a `find /` there raises an OS folder-consent prompt nobody is present
 * to answer. Only this hook is added; the executor's backgrounding, wait-tool and merge-gate
 * hooks are deliberately NOT ported (card D2). */
const SCAN_GUARD_ENTRY = {
  hooks: [(hookInput: unknown) => Promise.resolve(decideScanGuardHook(hookInput))],
};
```

In the `closing` branch, immediately before `return options;`:

```ts
    // Still NO containment hook — `closing` legitimately writes the repo (§5.4). The scan wall is
    // not containment: it refuses only a filesystem- or home-rooted `find`.
    options.hooks = { PreToolUse: [SCAN_GUARD_ENTRY] };
```

For `ruling`/`ratify`, replace the `options.hooks = {…}` block with:

```ts
  // "The ONLY enforcement there is" (S-P12) — permit.ts's buildContainmentHook, the impure edge —
  // stays first; the scan wall runs alongside it as defence in depth (card D2), since this
  // envelope already denies Bash.
  options.hooks = {
    PreToolUse: [
      { hooks: [buildContainmentHook(config.homeDir, { realpath: config.realpath })] },
      SCAN_GUARD_ENTRY,
    ],
  };
```

Update the `hooks?` field's doc comment in `OneShotSessionOptions` if it says anything about
`closing` having none (it currently has no comment; add none if so).

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/ cli/main.test.ts && bunx tsc --noEmit
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -1
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -c "isFilesystemWideScan\|function decideScanGuardHook" plugins/tribe/scripts/runner/core/supervisor/session.ts
```
Expected: all pass, `tsc` exit 0, `40 passed, 0 failed`, and the last count `0` (the predicate is
imported by name via `decideScanGuardHook`, never re-declared here).

- [x] **Step 4: Commit** — stage the two files and commit with the Global Constraints trailers
  (`Tribe-Task: 4/9`), ticking this task's boxes in the SAME commit.
- [x] Task 4 complete

---

## Task 5 — enforce `closing`'s grant with a hook (ruling R1)

**Accepted consequence (R1):** `closing` stops running `TaskCreate`, `CronList` and `ListAgents`
(spec §4.2); the closing stage uses none of them.

**Model: `sonnet`.** A pure allowlist predicate plus wiring.

**owns_files:** `plugins/tribe/scripts/runner/core/supervisor/permit.ts`,
`plugins/tribe/scripts/runner/core/supervisor/permit.test.ts`,
`plugins/tribe/scripts/runner/core/supervisor/session.ts`,
`plugins/tribe/scripts/runner/core/supervisor/session.test.ts`.

**Why (spec §4.2, MEASURED):** once the tiers load, a `permissions.allow` rule in any loaded
settings file auto-approves a tool outside `CLOSING_ALLOWED_TOOLS` (`Workflow` was denied under
`['project']` and ran under the three tiers). The containment hook already makes `ruling`/`ratify`
immune; this makes `closing` immune the same way. `CLOSING_ALLOWED_TOOLS` itself stays
byte-identical.

### RED — why it fails today

`decideClosingGrantHook` does not exist, and `closing`'s only hook (after Task 4) is the scan
guard, which has no opinion on `Workflow`.

Add to `permit.test.ts`:

```ts
import { decideClosingGrantHook } from './permit.ts';

describe('decideClosingGrantHook — closing\'s grant, enforced (card supervisor-session-settings, R1)', () => {
  const GRANT = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash', 'Skill'];

  for (const tool of GRANT) {
    test(`allows granted tool ${tool}`, () => {
      expect(decideClosingGrantHook(GRANT, { tool_name: tool, tool_input: {} })).toEqual({});
    });
  }

  for (const tool of ['Workflow', 'TaskCreate', 'CronCreate', 'SendMessage', 'ToolSearch', 'WebFetch', 'mcp__x__y']) {
    test(`denies un-granted tool ${tool}, naming the grant`, () => {
      const d = decideClosingGrantHook(GRANT, { tool_name: tool, tool_input: {} });
      expect(d.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(d.hookSpecificOutput?.permissionDecisionReason).toContain('Read, Grep, Glob, Write, Edit, Bash, Skill');
    });
  }

  for (const malformed of [undefined, null, {}, { tool_name: 42 }, { tool_name: '' }]) {
    test(`denies malformed input ${JSON.stringify(malformed)} (fail closed)`, () => {
      expect(decideClosingGrantHook(GRANT, malformed).hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  }
});
```

Add to `session.test.ts`, inside the scan-wall `describe` from Task 4:

```ts
  test('closing: the wired hooks deny an un-granted tool (Workflow) and allow Bash', async () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    const denied = await wiredDecisions(options, { tool_name: 'Workflow', tool_input: {} });
    expect(denied.some((d) => d.hookSpecificOutput?.permissionDecision === 'deny')).toBe(true);
    const allowed = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command: 'git status' } });
    expect(allowed.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
  });
```

Run: `bun test core/supervisor/permit.test.ts core/supervisor/session.test.ts`
Expected failure: `SyntaxError: Export named 'decideClosingGrantHook' not found` for
`permit.test.ts`, and the new `session.test.ts` case fails `expect(false).toBe(true)`.

### GREEN

In `permit.ts`, below `decideContainmentHook`:

```ts
/** PURE (card supervisor-session-settings, ruling R1): enforces `closing`'s explicit grant. `closing`
 * loads the user/project/local settings tiers, and any of them may carry a `permissions.allow`
 * rule that would auto-approve a tool outside the grant (MEASURED: `Workflow` ran once such a
 * rule was loaded). A PreToolUse deny beats an allow rule, so this hook is what keeps the grant
 * exactly the listed tools on every host. Fails CLOSED: a malformed or unnamed tool denies. The
 * grant arrives as an argument so this module never imports session.ts (which imports it). */
export function decideClosingGrantHook(grantedTools: readonly string[], input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown };
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
  const isGranted = toolName !== '' && grantedTools.includes(toolName);
  if (isGranted) return {};
  return deny(
    `This closing session is not granted this tool; only ${grantedTools.join(', ')} are ` +
      'permitted, and a settings-file allow rule cannot extend that grant.',
  );
}
```

In `session.ts`, import it alongside `buildContainmentHook`, and make the `closing` hooks line:

```ts
    options.hooks = {
      PreToolUse: [
        // The grant, enforced (card supervisor-session-settings, ruling R1): a host allow rule in a
        // loaded settings tier can never add a tool to CLOSING_ALLOWED_TOOLS.
        { hooks: [(hookInput: unknown) => Promise.resolve(decideClosingGrantHook(CLOSING_ALLOWED_TOOLS, hookInput))] },
        SCAN_GUARD_ENTRY,
      ],
    };
```

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/ cli/main.test.ts && bunx tsc --noEmit
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -1
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && env -u ANTHROPIC_API_KEY TRIBE_REAL_E2E=1 bash plugins/tribe/scripts/tests/test-supervisor-permission-real.sh 2>&1 | tail -1
```
Expected: all pass, `tsc` exit 0, `40 passed, 0 failed`, and the real permission test ends
`N passed, 0 failed` — its `closing` probe (Write + `git rev-parse` via Bash, empty
`permissionDenials`) must stay green, proving the grant hook does not deny Stage D's own tools.

- [x] **Step 4: Commit** — stage the four files and commit with the Global Constraints trailers
  (`Tribe-Task: 5/9`), ticking this task's boxes in the SAME commit.
- [x] Task 5 complete

---

## Task 6 — grant `Skill` to `ruling`/`ratify`, and only `Skill` (owner ruling R2)

**Model: `sonnet`.** A one-word grant change whose whole risk is opening something else; the tests
pin that nothing else opened.

**owns_files:** `plugins/tribe/scripts/runner/core/supervisor/session.ts`,
`plugins/tribe/scripts/runner/core/supervisor/session.test.ts`,
`plugins/tribe/scripts/runner/core/supervisor/permit.ts`,
`plugins/tribe/scripts/runner/core/supervisor/permit.test.ts`.

**Why (spec §4.6, §4.8; owner ruling R2, verbatim "Allow the Skill tool"):** with the tiers
loaded, `c3` is registered in `ruling`/`ratify`, but the containment hook refuses the `Skill` tool,
so G1's "`Skill c3` returns C3 content" cannot hold. R2 grants `Skill` only. The C3 CLI still
cannot run there (no `Bash`) — a known, accepted limit, not a defect; do not try to fix it.

### RED — why it fails today

`JUDGMENT_ALLOWED_TOOLS` is `['Read', 'Grep', 'Glob', 'Write', 'Edit']` (`session.ts:26`) and
`decideContainmentHook` sends `Skill` to its not-granted default-deny (`permit.ts:84`).

Add to `permit.test.ts`:

```ts
// Owner ruling R2 (card supervisor-session-settings): "Allow the Skill tool" — Skill ONLY.
describe('Skill is granted to ruling/ratify, and nothing else opened (R2)', () => {
  test('Skill is allowed, with or without args', () => {
    expect(decideContainmentHook(HOME, ev('Skill', { skill: 'c3' }))).toEqual({});
    expect(decideContainmentHook(HOME, ev('Skill', { skill: 'c3-skill:c3', args: 'check' }))).toEqual({});
  });

  for (const tool of ['Bash', 'ToolSearch', 'WebFetch', 'Task', 'Agent', 'Workflow', 'NotebookEdit']) {
    test(`${tool} is still refused with the not-granted reason`, () => {
      const d = decideContainmentHook(HOME, ev(tool, { command: 'find / -name x' }));
      expect(denied(d)).toBe(true);
      expect(d.hookSpecificOutput?.permissionDecisionReason).toMatch(/not granted/i);
    });
  }

  test('a Write outside the campaign home is still refused', () => {
    expect(denied(decideContainmentHook(HOME, ev('Write', { file_path: '/abs/repo/src/index.ts' })))).toBe(true);
  });

  test('the not-granted reason names the actual grant, Skill included', () => {
    const d = decideContainmentHook(HOME, ev('Bash', { command: 'ls' }));
    expect(d.hookSpecificOutput?.permissionDecisionReason).toContain('Skill');
  });
});
```

Add to `session.test.ts`, inside `describe('buildOneShotOptions — spec §5.1 envelope (regression guard)', …)`
(`wiredDecisions` is the helper Task 4 added):

```ts
  // Owner ruling R2: JUDGMENT_ALLOWED_TOOLS gains Skill — and ONLY Skill.
  test('ruling and ratify are granted the old five tools plus Skill, and nothing else', () => {
    for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Skill']);
      expect(options.disallowedTools).toContain('Bash');
    }
  });

  for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
    test(`${kind}: through the WIRED hooks, Skill passes while Bash and an out-of-home Write are refused`, async () => {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      const skill = await wiredDecisions(options, { tool_name: 'Skill', tool_input: { skill: 'c3' } });
      expect(skill.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
      const bash = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command: 'git status' } });
      expect(bash.some((d) => d.hookSpecificOutput?.permissionDecision === 'deny')).toBe(true);
      const write = await wiredDecisions(options, { tool_name: 'Write', tool_input: { file_path: '/abs/repo/src/touched.txt' } });
      expect(write.some((d) => d.hookSpecificOutput?.permissionDecision === 'deny')).toBe(true);
    });
  }
```

Run: `bun test core/supervisor/permit.test.ts core/supervisor/session.test.ts`
Expected failure: `Skill is allowed` fails (`Received` a deny decision); the reason-names-Skill test
fails (`Expected to contain: "Skill"`); the `allowedTools` test fails
(`Received: ["Read","Grep","Glob","Write","Edit"]`); both wired-hook tests fail on the `Skill`
assertion. The `Bash`/`ToolSearch`/`WebFetch`/`Task`/`Agent`/`Workflow`/`NotebookEdit` and
out-of-home `Write` cases PASS already — they pin behaviour that must not change.

### GREEN

1. `session.ts:26`:

```ts
const JUDGMENT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Skill'];
```

   and add one sentence to its doc comment: "`Skill` by owner ruling R2 (card
   supervisor-session-settings), so `/c3` loads its content here; its CLI still cannot run,
   because this envelope has no `Bash` (`JUDGMENT_DISALLOWED_TOOLS`) — a known, accepted limit."

2. `permit.ts`: in `decideContainmentHook`, name the case and allow it, right after the
   `Read`/`Grep`/`Glob` line:

```ts
  // Owner ruling R2: loading a skill's content writes nothing, so Skill needs no path check. A
  // tool the loaded skill then asks for still comes through THIS table and is judged on its own.
  const isSkillLoad = toolName === 'Skill';
  if (isSkillLoad) return {};
```

   and change `NOT_GRANTED_REASON` to:

```ts
const NOT_GRANTED_REASON =
  'This judgment session is not granted this tool; only Read, Grep, Glob, Skill and Write/Edit ' +
  'under the campaign home are permitted.';
```

   Update the `decideContainmentHook` doc comment's list of allowed shapes to include `Skill`.

### Verify

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/ cli/main.test.ts && bunx tsc --noEmit
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -1
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && env -u ANTHROPIC_API_KEY TRIBE_REAL_E2E=1 bash plugins/tribe/scripts/tests/test-supervisor-permission-real.sh 2>&1 | tail -1
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && git diff d6cad2f -- plugins/tribe/scripts/runner/core/supervisor/session.ts | command grep -E "^[-+]const (JUDGMENT|CLOSING)_"
```
Expected: all pass; `tsc` exit 0; `40 passed, 0 failed`; the real permission test ends
`N passed, 0 failed` (its `ruling` probe still refuses the repo, `/tmp` and symlink writes); and
the last command prints exactly two lines — the old and new `JUDGMENT_ALLOWED_TOOLS` — proving no
other grant constant changed since the base.

- [ ] **Step 4: Commit** — stage the four files and commit with the Global Constraints trailers
  (`Tribe-Task: 6/9`), ticking this task's boxes in the SAME commit.
- [ ] Task 6 complete

---


## Task 7 — the E2E: real sessions through the supervisor's own spawn path (G1, G2, G4, R1)

**Model: `sonnet`.** Transcript assertions on a real model; the failure mode the issue names (a
stub-passing test) is the one to avoid.

**owns_files:** `plugins/tribe/scripts/runner/core/supervisor/session.e2e.test.ts` (new).

**Non-negotiable properties (card G1 oracle):**
1. Every session goes through `runOneShotSession` with `spawnSession` wired to the REAL
   `sdkSpawnSession`, cast exactly as the composition root does (`cli/main.ts:845`). Never
   `query()` directly, never a hand-built options object, never a stub.
2. Real model `claude-haiku-4-5-20251001`; `maxTurns: 8`; `sessionTimeoutMs: 180000`; bun test
   timeout `240000` per test.
3. Assertions read the transcript captured through `io.appendLog` (the seam production writes
   `<home>/supervisor/sessions/<id>.log` through) and the typed `OneShotSessionResult`.
4. Opt-in: `test.skipIf(process.env.RUN_SESSION_E2E !== '1')`, so `bun test` stays hermetic.
5. When `SUPERVISOR_E2E_LOG_DIR` is set, each transcript is also written to
   `$SUPERVISOR_E2E_LOG_DIR/sessions/<kind>-<label>.jsonl` (ordinary sessions) or
   `$SUPERVISOR_E2E_LOG_DIR/adversarial/<kind>-<label>.jsonl` (sessions told to break a wall) —
   Task 8's ratchet reads these.

### RED — write the file

```ts
// core/supervisor/session.e2e.test.ts — real-session E2E for card supervisor-session-settings
// (issue #163). Every session is spawned through the supervisor's OWN path: runOneShotSession ->
// buildOneShotOptions -> the real SDK adapter, wired exactly as cli/main.ts wires it. Opt-in via
// RUN_SESSION_E2E=1 (costs tokens, needs Claude Code login auth).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sdkSpawnSession } from '../../adapters/session.adapter.ts';
import { isFilesystemWideScan } from '../metrics/session-hygiene.ts';
import { TRIBE_PLUGIN_DIR, type SpawnSessionParams } from '../session.ts';
import type { SessionKind } from './model.ts';
import { runOneShotSession, type OneShotSessionResult, type OneShotSessionSeam } from './session.ts';

const RUN_E2E = process.env.RUN_SESSION_E2E === '1';
/** Optional: where Task 8's ratchet reads the transcripts. Unset = keep them in memory only. */
const LOG_DIR = process.env.SUPERVISOR_E2E_LOG_DIR;
const MODEL = 'claude-haiku-4-5-20251001';
const REPO_ROOT = join(TRIBE_PLUGIN_DIR, '..', '..');
const VERIFY_SHIPPED_DIR = join(TRIBE_PLUGIN_DIR, '..', 'verify-shipped');
const SESSION_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 240_000;

const C3_PROMPT =
  'Invoke the Skill tool with the skill named "c3" exactly once. Do not use any other tool. ' +
  'Reply with one line: SKILL_RESULT=<ok|denied|unknown> followed by the first 200 characters the Skill tool returned.';
const VERIFY_SHIPPED_PROMPT =
  'Invoke the Skill tool with the skill named "verify-shipped" exactly once. Do NOT follow its instructions ' +
  'and do not run any other tool. Reply with one line: SKILL_RESULT=<ok|unknown> followed by the first 200 characters the Skill tool returned.';
const SCAN_PROMPT =
  'Run exactly this one Bash command, once, and nothing else: find / -maxdepth 1 -name TRIBE_E2E_NOPE ' +
  'Do not retry it and do not run any variant of it. Reply with one line: SCAN=<ran|refused> followed by the first 200 characters of the tool result.';
const GRANT_PROMPT =
  'Call the Workflow tool exactly once with script "export const meta = { name: \'probe\', description: \'probe\' }; return { ok: true };" ' +
  '(use ToolSearch to load its schema first if you need it). Do not retry. Reply with one line: WORKFLOW=<ALLOWED|DENIED> followed by the first 120 characters of the result.';

/** A skill id names c3 whether the SDK reports it bare or plugin-namespaced ("c3-skill:c3"). */
const isC3 = (skill: unknown): boolean => typeof skill === 'string' && /(^|:)c3$/.test(skill);
const isVerifyShipped = (skill: unknown): boolean => typeof skill === 'string' && /(^|:)verify-shipped$/.test(skill);

interface Run {
  lines: string[];
  transcript: string;
  result: OneShotSessionResult;
}

interface RunOptions {
  /** A `permissions.allow` list written to <home>/.claude/settings.local.json — the same
   * mechanism as a user-tier allow rule, in a scratch file (spec §4.2). */
  hostAllow?: string[];
  withoutVerifyShippedPlugin?: boolean;
  /** The session is TOLD to break a wall; its log goes to adversarial/, never to G5's root. */
  adversarial?: boolean;
}

async function runKind(kind: SessionKind, prompt: string, label: string, opts: RunOptions = {}): Promise<Run> {
  // realpath now: macOS tmpdir is a symlink, and the containment hook realpaths what it checks.
  const homeDir = realpathSync(mkdtempSync(join(tmpdir(), `sss-e2e-${kind}-`)));
  if (opts.hostAllow !== undefined) {
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: opts.hostAllow } }));
  }
  const lines: string[] = [];
  const io: OneShotSessionSeam = {
    // Byte-for-byte the composition root's production wiring (cli/main.ts).
    spawnSession: (params) => sdkSpawnSession(params as unknown as SpawnSessionParams),
    onSessionStart: () => {},
    appendLog: (_logPath, line) => {
      lines.push(line);
    },
  };
  const attachesVerifyShipped = kind === 'closing' && opts.withoutVerifyShippedPlugin !== true;
  const result = await runOneShotSession(
    {
      kind,
      prompt,
      config: {
        homeDir,
        model: MODEL,
        maxTurns: 8,
        ...(kind === 'ratify' ? {} : { repoRoot: REPO_ROOT }),
        realpath: (p: string) => {
          try {
            return realpathSync(p);
          } catch {
            return p; // the seam's contract: a path that does not exist comes back unchanged
          }
        },
        ...(attachesVerifyShipped ? { verifyShippedPluginDir: VERIFY_SHIPPED_DIR } : {}),
      },
      sessionTimeoutMs: SESSION_TIMEOUT_MS,
    },
    io,
  );
  if (LOG_DIR !== undefined) {
    const dir = join(LOG_DIR, opts.adversarial === true ? 'adversarial' : 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${kind}-${label}.jsonl`), `${lines.join('\n')}\n`);
  }
  return { lines, transcript: lines.join('\n'), result };
}

/** Every parsed message; a line that is not JSON contributes nothing (narrow catch). */
function messages(lines: string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // a malformed line is skipped, never thrown on
    }
  }
  return out;
}

function initSkills(lines: string[]): string[] {
  const init = messages(lines).find((m) => m.type === 'system' && m.subtype === 'init');
  const skills = init?.skills;
  return Array.isArray(skills) ? skills.filter((s): s is string => typeof s === 'string') : [];
}

function toolUses(lines: string[], toolName: string): Array<{ input?: Record<string, unknown> }> {
  const uses: Array<{ input?: Record<string, unknown> }> = [];
  for (const m of messages(lines)) {
    const content = (m.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<{ type?: unknown; name?: unknown; input?: Record<string, unknown> }>) {
      if (block.type === 'tool_use' && block.name === toolName) uses.push({ input: block.input });
    }
  }
  return uses;
}

function deniedTools(result: OneShotSessionResult): string[] {
  return (result.permissionDenials ?? []).map((d) => String((d as { tool_name?: unknown }).tool_name));
}

describe('supervisor sessions — real model, the supervisor\'s own spawn path (card supervisor-session-settings)', () => {
  // G1, closing: the full oracle — Skill c3 RETURNS C3 content.
  test.skipIf(!RUN_E2E)('closing: Skill c3 returns C3 content and no Unknown skill appears', async () => {
    const run = await runKind('closing', C3_PROMPT, 'c3');
    expect(run.transcript).not.toContain('Unknown skill'); // first, so a tier regression fails HERE
    expect(toolUses(run.lines, 'Skill').some((u) => isC3(u.input?.skill))).toBe(true);
    expect(run.transcript).toContain('skills/c3'); // the loaded body's own base-directory line
    expect(run.result.outcome).toBe('success');
  }, TEST_TIMEOUT_MS);

  // G1, ruling/ratify — the SAME oracle as closing (owner ruling R2 granted Skill): Skill c3
  // RETURNS C3 content. The C3 CLI itself cannot run here (no Bash) — accepted, not asserted.
  for (const kind of ['ruling', 'ratify'] as const) {
    test.skipIf(!RUN_E2E)(`${kind}: Skill c3 returns C3 content and no Unknown skill appears`, async () => {
      const run = await runKind(kind, C3_PROMPT, 'c3');
      expect(run.transcript).not.toContain('Unknown skill'); // first, so a tier regression fails HERE
      expect(initSkills(run.lines).some(isC3)).toBe(true);
      expect(toolUses(run.lines, 'Skill').some((u) => isC3(u.input?.skill))).toBe(true);
      expect(deniedTools(run.result)).not.toContain('Skill'); // R2: the grant lets it through
      expect(run.transcript).toContain('skills/c3'); // the loaded body's own base-directory line
      expect(run.result.outcome).toBe('success');
    }, TEST_TIMEOUT_MS);
  }

  // G2: at least one real refusal of `find /` in a closing session.
  test.skipIf(!RUN_E2E)('closing: a real `find /` is refused by the scan wall', async () => {
    const run = await runKind('closing', SCAN_PROMPT, 'scan', { adversarial: true });
    const commands = toolUses(run.lines, 'Bash')
      .map((u) => u.input?.command)
      .filter((c): c is string => typeof c === 'string');
    expect(commands.some(isFilesystemWideScan)).toBe(true); // the attempt happened, or this proves nothing
    expect(run.transcript).toContain('Filesystem-wide scans are disabled for campaign sessions');
    expect(deniedTools(run.result)).toContain('Bash');
  }, TEST_TIMEOUT_MS);

  // G4: verify-shipped with the hand-load (production config) — asserted.
  test.skipIf(!RUN_E2E)('closing: verify-shipped resolves with options.plugins (the kept hand-load)', async () => {
    const run = await runKind('closing', VERIFY_SHIPPED_PROMPT, 'verify-shipped-with-plugin');
    expect(run.transcript).not.toContain('Unknown skill');
    expect(toolUses(run.lines, 'Skill').some((u) => isVerifyShipped(u.input?.skill))).toBe(true);
    expect(run.transcript).toContain('Verify Shipped');
    console.log(`G4_WITH_PLUGIN registered as: ${JSON.stringify(initSkills(run.lines).filter(isVerifyShipped))}`);
  }, TEST_TIMEOUT_MS);

  // G4: WITHOUT the hand-load — a measurement for the PR body, not a gate: whether the user tier
  // alone resolves it depends on whether install.sh ran on this host (spec §4.4).
  test.skipIf(!RUN_E2E)('closing: verify-shipped WITHOUT options.plugins — measured and reported', async () => {
    const run = await runKind('closing', VERIFY_SHIPPED_PROMPT, 'verify-shipped-without-plugin', { withoutVerifyShippedPlugin: true });
    const resolved = !run.transcript.includes('Unknown skill') && run.transcript.includes('Verify Shipped');
    console.log(`G4_WITHOUT_PLUGIN=${resolved ? 'resolved' : 'unknown'} registered as: ${JSON.stringify(initSkills(run.lines).filter(isVerifyShipped))}`);
    expect(run.result.outcome).toBe('success');
  }, TEST_TIMEOUT_MS);

  // Ruling R1: a host allow rule cannot widen closing.
  test.skipIf(!RUN_E2E)('closing: a loaded allow rule for Workflow does not let Workflow run', async () => {
    const run = await runKind('closing', GRANT_PROMPT, 'grant', { hostAllow: ['Workflow', 'ToolSearch'], adversarial: true });
    expect(run.transcript).not.toContain('Workflow launched');
    expect(run.transcript).toContain('This closing session is not granted this tool');
  }, TEST_TIMEOUT_MS);
});
```

### The empty-implementation check — mandatory, and it IS the RED

The code under test already exists (Tasks 3-6), so RED is proven by reverting it: with the
envelope back at `d6cad2f`'s, these tests must fail **for the stated reasons**, and that same run
produces Task 8's BEFORE corpus.

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings
E=~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence
git show d6cad2f:plugins/tribe/scripts/runner/core/supervisor/session.ts > plugins/tribe/scripts/runner/core/supervisor/session.ts
git show d6cad2f:plugins/tribe/scripts/runner/core/supervisor/permit.ts > plugins/tribe/scripts/runner/core/supervisor/permit.ts
cd plugins/tribe/scripts/runner && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/before" bun test core/supervisor/session.e2e.test.ts 2>&1 | tee /tmp/sss-e2e-before.txt | tail -40
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && git checkout -- plugins/tribe/scripts/runner/core/supervisor/session.ts plugins/tribe/scripts/runner/core/supervisor/permit.ts && git status --short
```
Expected (BEFORE): the `closing` c3 test and both `ruling`/`ratify` c3 tests FAIL on
`expect(received).not.toContain(expected)` with `Unknown skill` in the received text; the scan
test FAILS on the `Filesystem-wide scans are disabled` assertion (the `find` ran); the R1 grant
test FAILS on `toContain('This closing session is not granted this tool')` (at base the `local`
tier is not loaded, so the SDK itself denies `Workflow` — spec §4.2 already MEASURED that with the
tiers loaded and no grant hook, `Workflow` runs); the with-plugin `verify-shipped` test PASSES
(the hand-load existed at base). `git status --short` afterwards shows only the new e2e file.
**If a test fails for a setup or auth reason instead, stop and report `NEEDS_CONTEXT`.**

### GREEN — run as built

```bash
cd plugins/tribe/scripts/runner && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR=~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence/after bun test core/supervisor/session.e2e.test.ts 2>&1 | tee /tmp/sss-e2e-after.txt | tail -20
cd plugins/tribe/scripts/runner && bun test core/supervisor/session.e2e.test.ts 2>&1 | tail -3
```
Expected: `7 pass, 0 fail` as built (the two `G4_*` lines are printed — copy them into the task
report); and the second, un-flagged run shows `7 skip`, proving `bun test` stays hermetic.
Paste both transcripts' failure/pass summaries (`/tmp/sss-e2e-before.txt`,
`/tmp/sss-e2e-after.txt`) into the task report.

- [ ] **Step 4: Commit** — stage ONLY `core/supervisor/session.e2e.test.ts` (the revert was
  restored, and the evidence corpora live under `~/.tribe`, outside the repo) and commit with the
  Global Constraints trailers (`Tribe-Task: 7/9`), ticking this task's boxes in the SAME commit.
- [ ] Task 7 complete

---

## Task 8 — the ratchet AFTER, on the same tool (G5), plus the G4 verdict

**Model: `sonnet`.** Must report measured numbers without overclaiming.

**owns_files:** `docs/superpowers/evidence/2026-09-24-supervisor-session-settings.md`.

### RED — the check that fails first

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -q '^## AFTER' docs/superpowers/evidence/2026-09-24-supervisor-session-settings.md
```
Expected: exit 1 — Task 1 wrote only `## BEFORE`.

### GREEN

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings
E=~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence
for r in "$E/before/sessions" "$E/after/sessions" "$E/before/adversarial" "$E/after/adversarial"; do
  bun plugins/tribe/scripts/session-hygiene.ts --root "$r" --json
done
```

Expected (the G5 gate): `after/sessions` reads `"unknownSkills": {}` and
`"filesystemWideScans": 0`. `before/sessions` shows `Unknown skill: c3` at least 3 times (one per
kind). `after/adversarial` shows `filesystemWideScans` ≥ 1 — every one an attempt the Task 7 scan
test proved refused (its `permissionDenials` contains `Bash`). **If `after/sessions` is not
exactly 0/0, stop and report — do not adjust the expectation.**

Add to the evidence document:
1. `## AFTER` — the four commands and their JSON verbatim, a before → after table for
   `sessions` (unknown skills, scans) and for `adversarial` (scan attempts, refusals).
2. `## E2E` — the exact Task 7 commands and the pass/fail summaries of the before and after
   runs, verbatim from the task report.
3. `## G4 verdict` — the kept hand-load, spec §4.4's table, and the two `G4_*` lines Task 7
   printed, ending with the sentence the PR body will carry: "The `verify-shipped` hand-load
   (`options.plugins`) is kept: it resolves the skill from the repo on every host, where the user
   tier resolves it only where install.sh ran; with both present the session registers it once."
4. `## Re-used, not re-derived` — issue #163's "Cost of parity" paragraph quoted verbatim, then
   one line each for what this card re-measured for the supervisor envelope (spec §4.1:
   `permissionMode: 'default'` and `model` win; no MCP server on this host).

### Verify

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && for h in '## BEFORE' '## AFTER' '## E2E' '## G4 verdict' '## Re-used, not re-derived'; do command grep -q "^$h" docs/superpowers/evidence/2026-09-24-supervisor-session-settings.md && echo "ok $h"; done
```
Expected: five `ok` lines.

- [ ] **Step 4: Commit** — stage the evidence document and commit with the Global Constraints
  trailers (`Tribe-Task: 8/9`), ticking this task's boxes in the SAME commit.
- [ ] Task 8 complete

---

## Task 9 — phase-end governance: C3 and README facts this card made stale

**Model: `sonnet`.** Reconciliation through the C3 CLI, following the precedent change-unit.

**owns_files:** `.c3/c3-2-plugins/c3-215-tribe.md` (via the CLI only), the new change-unit files
the CLI creates under `.c3/` (ADR `adr-20260924-supervisor-session-settings` and its patches),
`plugins/tribe/scripts/runner/README.md`.

**Precedent to copy the shape of:** commit `fd25bec` ("docs(c3): reconcile supervisor and
schema-guard facts for park truth") — an ADR plus block patches, with seals recomputed by the CLI.
The C3 CLI is the skill-local wrapper (there is no `c3` executable):

```bash
C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1)
C3X_MODE=agent bash "$C3/bin/c3x.sh" check
```
Read `$C3/SKILL.md` and `$C3/references/change.md` for the change-unit procedure; never hand-edit
a frozen fact or a `c3-seal`.

### RED — the stale facts, found mechanically

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -n "settingSources \['project'\] grants nothing\|full Stage-D toolset and no containment hook" .c3/c3-2-plugins/c3-215-tribe.md
```
Expected: at least one match — the `c3-215` Change Safety row "A ruling/ratify session writes
outside the campaign home…" still states `closing` loads `settingSources ['project']` and carries
no hook.

### GREEN

1. Through one change-unit, patch the `c3-215` Change Safety row named above so it states: all
   three kinds load `['user','project','local']`; `ruling`/`ratify` carry the containment hook
   and the scan-wall hook; `closing` carries no containment hook, but the scan-wall hook and (if
   the closing grant hook (R1); `ruling`/`ratify` carry allowedTools
   [Read, Grep, Glob, Write, Edit, Skill] by owner ruling R2 (`Skill` only; the C3 CLI cannot run
   there without `Bash` — an accepted limit), and the containment hook allows `Skill`; every
   other grant is unchanged. Add
   `core/supervisor/session.e2e.test.ts` (opt-in `RUN_SESSION_E2E=1`) to its Required
   Verification cell. Record the ADR with the card's decisions (the D1 finding, rulings R1
   and R2, D2 as amended by R1, D3, the G4 kept-hand-load decision).
2. `runner/README.md`: in the supervisor section, add the one-shot envelope's facts where the
   session files are described (near "`sessions/<sessionId>.log`"): the three-tier list, the
   hooks per kind, the kept `verify-shipped` hand-load and why, and add the new E2E to the
   "What HAS been verified live" list next to the executor's `Skill c3` entry (~line 1224).
3. Do not edit ADRs other than the new one; history stays history.

### Verify

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1) && C3X_MODE=agent bash "$C3/bin/c3x.sh" check | tail -2
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -n "settingSources \['project'\] grants nothing" .c3/c3-2-plugins/c3-215-tribe.md || echo "stale fact gone"
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings && command grep -c "session.e2e.test.ts" plugins/tribe/scripts/runner/README.md
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings/plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
```
Expected: `ok: true`; `stale fact gone`; a count of at least `2` (the executor's existing E2E
mention plus the new supervisor one); the whole runner suite green (inherited failures per the
Adjudication rule only if they also fail on base) and `tsc` exit 0.

- [ ] **Step 4: Commit** — stage the `.c3/` change-unit files and the README and commit with the
  Global Constraints trailers (`Tribe-Task: 9/9`), ticking this task's boxes in the SAME commit.
- [ ] Task 9 complete

---

## Definition of done (issue #163 checklist → proof)

- [ ] G1 — Task 7: `Skill c3` returns C3 content in all three kinds (R2 granted `Skill` to
  `ruling`/`ratify`, Task 6); all three
  proven to FAIL on `Unknown skill` with the envelope reverted.
- [ ] G2 — Task 4 unit test over every variant for every kind, and Task 7's real `find /`
  refusal in `closing`; `decideScanGuardHook` imported, never copied.
- [ ] R1 — Task 5 unit tests + Task 7's real allow-rule session: `closing` cannot be widened.
- [ ] R2 — Task 6: `Skill` only; `Bash` and an out-of-home `Write` still refused (unit tests).
- [ ] G3 — Task 3: `['user','project','local']` for every kind; no tier defect found (spec §4.5).
- [ ] G4 — Task 7 measurement + Task 8 verdict ("kept"), copied into the PR body.
- [ ] G5 — Task 8: `after/sessions` reads 0 `Unknown skill`, 0 scans, on
  `plugins/tribe/scripts/session-hygiene.ts`, next to Task 1's and `before/`'s numbers.
- [ ] `bun test` + `bunx tsc --noEmit` green in `plugins/tribe/scripts/runner/`;
  `test-supervisor-e2e.sh` 40/40; `c3x check` ok.
