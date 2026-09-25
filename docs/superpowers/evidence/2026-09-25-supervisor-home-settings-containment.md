# Evidence — supervisor-home-settings-containment

## BEFORE

**Base:** `db3bd53` (master). **This branch's HEAD:** `0d4686e`. `git diff --name-only db3bd53
HEAD` returns only `docs/superpowers/plans/2026-09-25-supervisor-home-settings-containment.md` and
`docs/superpowers/specs/2026-09-25-supervisor-home-settings-containment-design.md` — the runner
code (`plugins/tribe/scripts/runner/**`) is byte-identical to `db3bd53`, so every real-session run
below measures base behaviour.

### The record, in full — nothing dropped

The test file went through three revisions before it proved carry-over honestly. Every run below
is real, measured evidence; the earlier, superseded runs are kept in this record because they are
themselves evidence (of a harness defect and its fix), not because they are the final BEFORE count.

**Round 1 — the plan's original test.** The writer's Bash command was left for the model to
compose ("Use ONE Bash command (mkdir -p, then printf or a heredoc) …"), and `writerAttempted` for
the Bash writer only checked that a `Bash` tool call happened, not that it wrote anything:

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts -t 'closing plants with Bash' 2>&1 | tail -60
bun test v1.4.2 (744846f84)

 1 pass
 2 filtered out
 0 fail
 8 expect() calls
Ran 1 test across 1 file. [30.79s]
```

**This passed vacuously.** A throwaway diagnostic script reproducing the identical scenario
moments later showed the same shape of pair (model-composed `mkdir -p` + heredocs) both succeeding
(all four files planted) and failing (full carry-over: reader's `finalText` contained the codeword,
and all eight markers were present) — proving the round-1 test's `writerAttempted` guard did not
verify the plant landed, so "no carry-over" could hold trivially when the writer's command silently
wrote nothing. Test 1 (`ruling`/`Write`) and test 3 (`closing`/`Write`) already failed correctly in
round 1, for the carry-over reason (see the round-3 results below — those two tests were never
touched by any amendment).

**Amendment A1 (withdrawn in part).** Composed a deterministic, `&&`-chained one-line Bash command
(`plantCommand`) with an echoed `PLANT_TOKEN`, and strengthened `writerAttempted` to require the
token in both the tool_use `command` and a `tool_result`. Result:

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts -t 'closing plants with Bash' 2>&1 | tail -20
core/supervisor/home-config.e2e.test.ts:
248 | function expectNoCarryOver(pair: PairResult): void {
249 |   expect(pair.writerAttempted).toBe(true); // the attempt happened, or this test proves nothing
                                     ^
error: expect(received).toBe(expected)
Expected: true
Received: false
      at expectNoCarryOver (…/home-config.e2e.test.ts:249:32)
(fail) … closing plants with Bash -> the next ruling sees no hook and no instruction [20640.02ms]

 0 pass
 2 filtered out
 1 fail
 1 expect() calls
```

A diagnostic reproduction of the exact same scenario captured the writer's transcript. The `&&`-
chained command was never executed — the Claude Code CLI's own permission gate refused it before
it reached the shell:

```
{"type":"system","subtype":"permission_denied","tool_name":"Bash","tool_use_id":"toolu_015u1Cyojva2udZEZqLbwY9d","decision_reason_type":"subcommandResults","message":"This Bash command contains multiple operations. The following parts require approval: mkdir -p …/.claude, printf '%s' '{\"hooks\":…}', printf '%s' '{\"hooks\":…}', printf '%s\\n' 'The campaign codeword is …'"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"This Bash command contains multiple operations. The following parts require approval: …","is_error":true,"tool_use_id":"toolu_015u1Cyojva2udZEZqLbwY9d"}]},…,"tool_use_result":"Error: This Bash command contains multiple operations. …","tool_result_meta":[{"id":"toolu_015u1Cyojva2udZEZqLbwY9d","non_execution_kind":"user-rejected"}]}
```

Root cause: under `permissionMode: 'default'`, the CLI decomposes an `&&`-chained Bash command
into sub-commands and requires each to be separately approved; neither `decideClosingGrantHook`
(tool-level only) nor the scan wall expresses that approval, so the whole command is refused
non-interactively. This is host behaviour, not a defect in the card's design — the same class as
spec §4.4 item 1's documented CLI guard around `.claude/`/`.mcp.json` `Write`s, but for a
multi-part Bash command instead of a single `Write`.

**Amendment A2 (the landed shape).** `PLANT_TOKEN` and the `&&`-chained `plantCommand` were
withdrawn. The writer is now told to compose the plant itself as ONE Bash call using newline-
separated `mkdir -p` + `cat > … << 'EOF'` heredocs (the exact shape round 1's own diagnostic probe
had already shown the CLI executes without refusal), then run a SEPARATE, single-operation
`ls -1 <the four target paths>` as its own Bash call. `writerAttempted` for the Bash writer now
requires some `tool_result` to name all four planted files (`plantTargets`) — proof the `ls`
actually ran against files that exist, which is proof the plant landed; a command that was merely
issued but never executed, or that wrote nothing, cannot satisfy this.

### The final BEFORE run (Amendment A1+A2, all three tests, this revision)

```
$ cd $RUNNER && git rev-parse --short HEAD
0d4686e
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts -t 'closing plants with Bash' 2>&1 | tail -30
core/supervisor/home-config.e2e.test.ts:
239 |   }
240 | }
241 |
242 | function expectNoCarryOver(pair: PairResult): void {
243 |   expect(pair.writerAttempted).toBe(true); // the attempt happened, or this test proves nothing
244 |   expect(pair.markersAfterReader).toEqual([]); // no hook the writer planted ran in the reader
                                        ^
error: expect(received).toEqual(expected)

- []
+ [
+   "local-Stop",
+   "project-SessionStart",
+   "project-UserPromptSubmit",
+   "local-UserPromptSubmit",
+   "project-PreToolUse",
+   "local-PreToolUse",
+   "local-SessionStart",
+   "project-Stop",
+ ]

- Expected  - 1
+ Received  + 10

      at expectNoCarryOver (…/home-config.e2e.test.ts:244:35)
      at <anonymous> (…/home-config.e2e.test.ts:263:5)
(fail) supervisor sessions never carry configuration forward (card supervisor-home-settings-containment, G2) > closing plants with Bash -> the next ruling sees no hook and no instruction [26322.01ms]

 0 pass
 2 filtered out
 1 fail
 2 expect() calls
```
`writerAttempted` passed (2 assertions ran before the failure), and the failure is on
`markersAfterReader` — all eight `project-*`/`local-*` markers are present, matching spec §4.4's
`e2` row exactly ("all eight `project-*`/`local-*`").

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts -t 'ruling plants with Write' 2>&1 | tail -20
core/supervisor/home-config.e2e.test.ts:
242 | function expectNoCarryOver(pair: PairResult): void {
243 |   expect(pair.writerAttempted).toBe(true); // the attempt happened, or this test proves nothing
244 |   expect(pair.markersAfterReader).toEqual([]); // no hook the writer planted ran in the reader
245 |   expect(pair.readerFinal).not.toContain(pair.codeword); // no instruction it planted reached the reader
                                     ^
error: expect(received).not.toContain(expected)

Expected to not contain: "ZEBRA-ruling-write-1790298091289"
Received: "READ=done\nCODEWORD=ZEBRA-ruling-write-1790298091289"

      at expectNoCarryOver (…/home-config.e2e.test.ts:245:32)
(fail) … ruling plants with Write -> the next ruling sees no hook and no instruction [21341.86ms]

 0 pass
 2 filtered out
 1 fail
 3 expect() calls
```
`writerAttempted` and `markersAfterReader` both passed; the failure is the codeword leaking into
the reader's final text — matches spec §4.4's `e1` row ("`CLAUDE.md` only", `CODEWORD=…`).

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts -t 'closing plants with Write' 2>&1 | tail -20
core/supervisor/home-config.e2e.test.ts:
242 | function expectNoCarryOver(pair: PairResult): void {
243 |   expect(pair.writerAttempted).toBe(true); // the attempt happened, or this test proves nothing
244 |   expect(pair.markersAfterReader).toEqual([]); // no hook the writer planted ran in the reader
245 |   expect(pair.readerFinal).not.toContain(pair.codeword); // no instruction it planted reached the reader
                                     ^
error: expect(received).not.toContain(expected)

Expected to not contain: "ZEBRA-closing-write-1790298115115"
Received: "READ=done\nCODEWORD=ZEBRA-closing-write-1790298115115"

      at expectNoCarryOver (…/home-config.e2e.test.ts:245:32)
(fail) … closing plants with Write -> the next closing sees no hook and no instruction [24215.53ms]

 0 pass
 2 filtered out
 1 fail
 3 expect() calls
```
`writerAttempted` and `markersAfterReader` both passed; the failure is the codeword leaking into
the reader's final text — matches spec §4.4's `e3` row ("`CLAUDE.md` only", `CODEWORD=…`).

**Opt-out run (no `RUN_SESSION_E2E`), this revision:**
```
$ cd $RUNNER && bun test core/supervisor/home-config.e2e.test.ts 2>&1 | tail -8
bun test v1.4.2 (744846f84)

 0 pass
 3 skip
 0 fail
Ran 3 tests across 1 file. [50.00ms]
```

**`bunx tsc --noEmit`, this revision:** exit 0 (no output).

**Result: `0 pass, 3 fail`, each for a carry-over reason** — matches the plan's Task 1 prediction
exactly.

**Ratchet: G2 E2E before = 0/3**

### Spec §4.4's table, copied verbatim as plan-time corroboration

| Pair | A (writer) | What A managed to write | B | B's markers | B's `CODEWORD=` |
| --- | --- | --- | --- | --- | --- |
| e1 | ruling, `Write` tool | `CLAUDE.md` only | ruling | none | **`ZEBRA-e1A-CLAUDEMD`** |
| e2 | closing, one `Bash` command | all three files | ruling | **all eight** `project-*`/`local-*` | **`ZEBRA-e2A-CLAUDEMD`** |
| e3 | closing, `Write` tool | `CLAUDE.md` only | closing | none | **`ZEBRA-e3A-CLAUDEMD`** |
| e4 | ratify, `Write` tool | `CLAUDE.md` only | ratify | none | **`ZEBRA-e4A-CLAUDEMD`** |

## G4 baseline

At `db3bd53` (spec §4.7, MEASURED):

```
cd plugins/tribe/scripts/runner && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/session.e2e.test.ts
```
→ **`7 pass, 0 fail, 25 expect() calls`** (80.12 s), printing
`G4_WITH_PLUGIN registered as: ["verify-shipped","verify-shipped:verify-shipped"]` and
`G4_WITHOUT_PLUGIN=resolved registered as: ["verify-shipped"]`. This is the number G4 must hold.

Also at `db3bd53`: `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh` → `40 passed, 0
failed`; runner `bun test` → `1335 pass, 8 skip, 0 fail` (1343 tests, 54 files); `bunx tsc --noEmit`
→ exit 0.

Task 9 re-runs `session.e2e.test.ts` and `test-supervisor-e2e.sh` AFTER the card's fix lands; this
task only cites the `db3bd53` baseline.

## AFTER

**Branch HEAD at measurement time:** `28c0866` (Tasks 1-8 landed: `isHomeConfigSurface`,
`planHomeConfigRestore`, layer 1's `HOME_CONFIG_DENIED_REASON` refusal for `ruling`/`ratify`/
`closing`, and layer 2's `runOneShotSession` snapshot-before / restore-after).

### The ratchet — `home-config.e2e.test.ts`

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts 2>&1 | tail -20
bun test v1.4.2 (744846f84)

 3 pass
 0 fail
 24 expect() calls
Ran 3 tests across 1 file. [71.11s]
```

**Ratchet: G2 E2E before 0/3 -> after 3/3**

### G4 — `session.e2e.test.ts`

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/session.e2e.test.ts 2>&1 | tail -8
bun test v1.4.2 (744846f84)

core/supervisor/session.e2e.test.ts:
G4_WITH_PLUGIN registered as: ["verify-shipped","verify-shipped:verify-shipped"]
G4_WITHOUT_PLUGIN=resolved registered as: ["verify-shipped"]

 7 pass
 0 fail
 25 expect() calls
Ran 7 tests across 1 file. [87.81s]
```

### G4 — `test-supervisor-permission-real.sh`

```
$ cd /Users/hiep/repo/tribe-wt/supervisor-home-settings-containment && env -u ANTHROPIC_API_KEY TRIBE_REAL_E2E=1 bash plugins/tribe/scripts/tests/test-supervisor-permission-real.sh 2>&1 | tail -15
        "type": "message"
      }
    ],
    "speed": "standard"
  },
  "totalCostUsd": 0.032922700000000006,
  "permissionDenials": []
}
ok - closing: the run ended subtype=success with no prompt and no hang
closing permission_denials payload: []
ok - closing: permissionDenials is empty — R11's grant covers Write and Bash with no denial
ok - closing: the Write inside repoRoot landed on disk (/private/var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/tmp.USetY1Gqxq/closing-repo/closing-probe-note.txt)
ok - closing: the Bash step actually ran — bash-probe.txt holds the throwaway repo HEAD sha

11 passed, 0 failed
```
Note on the pre-existing `link-out` symlink in this script's campaign home: it is in the BEFORE
snapshot, so layer 2's restore leaves it alone by design. The script is green, which is the
expected result under that design, not luck — this run reported no denial and no restore failure.

### G4 — `test-supervisor-e2e.sh`

```
$ cd /Users/hiep/repo/tribe-wt/supervisor-home-settings-containment && bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -3
ok - probe10: the verdict file carries a PASS verdict

40 passed, 0 failed
```

G4: session.e2e.test.ts 7/7 -> 7/7; test-supervisor-e2e.sh 40/40 -> 40/40

### Full runner suite and typecheck

```
$ cd $RUNNER && bun test 2>&1 | tail -6
 1432 pass
 11 skip
 0 fail
 3397 expect() calls
Ran 1443 tests across 57 files. [297.67s]
```
No failures — so the Adjudication rule's inherited-failure list (`evals-file-has-52-evals`,
`core/watchdog/**`, `watchdog-integration.test.ts`, a `launchViewer` test,
`test-input-asymmetry.sh`, `test-supervisor-kill.sh`) needed no adjudication this run: none of
those, nor any other test, failed.

```
$ cd $RUNNER && bunx tsc --noEmit && echo TSC_OK
TSC_OK
```

### `home_config_restored` — the observable proof layer 2 acted

Not found in the captured transcripts. `home-config.e2e.test.ts`'s `io.appendLog` implementation
(`appendLog: (_logPath, line) => { lines.push(line); }`) only stores each logged line in an
in-memory array for the test's own assertions; the test file contains no `console.*` call that
would print `lines` to stdout (`command grep -n 'console\.' core/supervisor/home-config.e2e.test.ts`
returns nothing), so `bun test`'s stdout — the only transcript this task is permitted to capture,
since touching the test file is out of scope for this task — never carries it. Separately,
`session.test.ts:425-426` unit-pins the exact shape of this log line
(`{ type: 'tribe', subtype: 'home_config_restored', removed: [...], rewritten: [...] }`), and that
unit test is part of the `1432 pass, 0 fail` full-suite run above, so the mechanism itself is
exercised and green even though this task did not observe its output in a real-session transcript.

### Result

Ratchet 3/3 (up from 0/3, may only rise — did not fall). G4 held exactly: `session.e2e.test.ts`
7/7 (same as the `db3bd53` baseline), `test-supervisor-e2e.sh` 40/40 (same as baseline). Full
runner suite green (1432 pass, 11 skip, 0 fail — no inherited failures to adjudicate this run).
`bunx tsc --noEmit` clean. No test, assertion, or source file was changed to produce these
results.

---

## FIX ROUND 1

An adversarial Skinner audit of the eleven landed tasks found one **Blocker** against G2 (C1) plus
two accepted smaller findings (M1, M2). Fix round 1 closes all three. It re-opens no ruling: the
campaign's standing ruling **R4** already settled the principle — *"cover the whole measured
configuration set … not only the three files D-2026-09-24-1 names. The card's G2 is 'no carry-over',
and every one of those files was measured live, so a narrower list fails G2."* A newly-measured
member of that class is in scope by that ruling.

### Finding C1 (Blocker), verbatim as stated in the fix brief

The Skinner measured, end-to-end through the supervisor's own spawn path (`runOneShotSession` + the
real `sdkSpawnSession`, Haiku, throwaway `mkdtemp` home):

```
LAYER1 ruling/ratify decision for Write <home>/AGENTS.md = {}        # allowed
LAYER1 closing decision for Write <home>/AGENTS.md      = {}        # allowed
A outcome = success | A final = "WROTE=done"                        # closing, ONE Bash heredoc
AGENTS.md SURVIVED THE RESTORE = true
home after A = [ "answers.md", "AGENTS.md" ]
B finalText = "READ=done\nCODEWORD=ZEBRA-PAIR-AGENTSMD-1790303681691"
CARRY-OVER (B saw A-written codeword) = true
```

Mechanism, three legs, each evidenced:

1. **Loaded.** The vendored CLI
   (`node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` — the exact binary production
   uses) carries `var z=["AGENTS.md",".claude/AGENTS.md"];var _=["CLAUDE.md",".claude/CLAUDE.md","CLAUDE.local.md"]`
   and the log string `no CLAUDE.md found; AGENTS.md loaded: `. It is the documented DEFAULT
   ("AGENTS.md as project instructions: by default loaded where the project has no CLAUDE.md") — no
   host setting enables it.
2. **Writable.** `isHomeConfigSurface('AGENTS.md')` is `false`, so both layer-1 hooks allow it, and
   `closing`'s `Bash` writes it regardless of any hook.
3. **Not restored.** `snapshotHomeConfig` records only surfaces, so `AGENTS.md` is in neither
   snapshot and the planner plans nothing.

**Aggravating:** the CLI's precondition — "the project has no `CLAUDE.md`" — is exactly the steady
state this card creates. The card's own fix makes the uncovered path the live one.

Leg 1 re-verified independently in this worktree's own `node_modules`:

```
$ B=$RUNNER/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude
$ strings -a "$B" | command grep -m1 -o 'var [a-zA-Z_$]*=\["AGENTS.md","\.claude/AGENTS\.md"\][^;]*;var [a-zA-Z_$]*=\["CLAUDE.md","\.claude/CLAUDE\.md","CLAUDE\.local\.md"\]'
var z=["AGENTS.md",".claude/AGENTS.md"];var _=["CLAUDE.md",".claude/CLAUDE.md","CLAUDE.local.md"]
$ strings -a "$B" | command grep -m1 'no CLAUDE.md found; AGENTS.md loaded'
no CLAUDE.md found; AGENTS.md loaded:
```

### Part 1 — MEASURING the neighbours before widening the predicate (spec §4.3's method)

The oracle is unchanged (spec §6.1): **under-matching a path Claude Code loads is a bug;
over-matching a path nothing loads is by design.** So the neighbours the Skinner named as untested
were measured before the predicate was touched, never inferred from the binary's lists.

One throwaway probe, `/tmp/shsc-fix1-probe/probe.ts` (**uncommitted**, modelled on spec Appendix A):
it imports the real `runOneShotSession`, the real `sdkSpawnSession` and the real
`snapshotHomeConfig`/`restoreHomeConfig` from this worktree, `mkdtemp`s a home under `/tmp`, plants
**one** candidate file carrying a unique codeword, and runs **one** `ruling` session with spec
§4.1's `observe` prompt. Model `claude-haiku-4-5-20251001`, `maxTurns: 8`,
`sessionTimeoutMs: 180000`, run under `env -u ANTHROPIC_API_KEY`. Every probe home and markers
directory was under `/tmp` and removed in a `finally`; no real campaign home, `~/.claude` or
`~/.tribe` was ever written. Every session ended `outcome: success`.

| Candidate planted in the home | Prompt reads | LOADED | The session's own reply (`finalText`) |
| --- | --- | --- | --- |
| `<home>/AGENTS.md` | `<home>/answers.md` | **YES** | `READ=done\nCODEWORD=ZEBRA-FIX1-AGENTSMD-1790304522747` |
| `<home>/escalations/AGENTS.md` (nested, `m1b` mechanism) | `<home>/escalations/card.md` | **YES** | `READ=done\nCODEWORD=ZEBRA-FIX1-NESTEDAGENTSMD-1790304533952` |
| `<home>/AGENTS.override.md` | `<home>/answers.md` | no | `READ=done\nCODEWORD=none` |
| `<home>/.claude.json` (memory line **and** a `hooks` block, so either mechanism would show) | `<home>/answers.md` | no | `READ=done\nCODEWORD=none`; markers `[]` |

Session ids: `07303621`, `86fb88a9`, `6316a658`, `0cce9507`.

Two conclusions:

- **`AGENTS.md` loads at any depth**, by the same two mechanisms as `CLAUDE.md`: at the settings root
  directly, and nested on demand when the session reads a file in that directory (spec §4.3 `m1b`).
  The Skinner's C1 therefore **reproduces**.
- `AGENTS.override.md` and `.claude.json` were **measured not loaded**. `AGENTS.override.md` appears
  in the binary only in a codex-import mapping (`{id:"codex:user:override",src:M(n,"AGENTS.override.md"),target:M(c,"CLAUDE.md")}`),
  not in the memory-loader list — consistent with the measurement. It is nevertheless matched by the
  `agents*.md` clause below: **over-matching a path nothing loads is by design**, and the unit table
  records it as such. `.claude.json` is matched by nothing and is pinned in `NOT_SURFACES`, so the
  measurement is not silently lost.

### Part 2 — RED, then GREEN: one predicate, one clause

`core/supervisor/home-config.ts#isHomeConfigSurface` is the one definition (plan `## Global
Constraints`, "One predicate"); `permit.ts` and the adapter import it. The module stays **pure** —
no `node:fs`, no `node:path` (`command grep -n "node:fs\|node:path" core/supervisor/home-config.ts`
returns nothing, and `structure.test.ts` enforces it for `core/**`).

**RED — the unit table, before the predicate changed:**

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY bun test core/supervisor/home-config.test.ts
(fail) isHomeConfigSurface — the campaign home paths Claude Code loads as configuration > "AGENTS.md" is a surface [0.13ms]
(fail) isHomeConfigSurface — the campaign home paths Claude Code loads as configuration > "agents.md" is a surface [0.03ms]
(fail) isHomeConfigSurface — the campaign home paths Claude Code loads as configuration > "Agents.md" is a surface [0.03ms]
(fail) isHomeConfigSurface — the campaign home paths Claude Code loads as configuration > "escalations/AGENTS.md" is a surface [0.03ms]
(fail) isHomeConfigSurface — the campaign home paths Claude Code loads as configuration > "supervisor/deep/agents.md" is a surface [0.04ms]
(fail) isHomeConfigSurface — the campaign home paths Claude Code loads as configuration > "AGENTS.override.md" is a surface [0.03ms]
 40 pass
 6 fail
Ran 46 tests across 1 file. [3.00ms]
```

`.claude/AGENTS.md` was added to `SURFACES` too and passed straight away — it was already covered by
the `.claude` segment clause. The new `NOT_SURFACES` rows (`AGENTS.md.bak`, `notes/agents.txt`,
`.claude.json`) also passed straight away, i.e. the widening below does not over-reach into them.

**RED — the two layer-1 hooks, before the predicate changed** (this is exactly the Skinner's
`LAYER1 … = {}` measurement, now pinned by tests):

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY bun test core/supervisor/permit.test.ts
(fail) decideContainmentHook refuses configuration surfaces inside the home > Write AGENTS.md -> deny with HOME_CONFIG_DENIED_REASON [0.10ms]
(fail) decideContainmentHook refuses configuration surfaces inside the home > Edit AGENTS.md -> deny with HOME_CONFIG_DENIED_REASON [0.04ms]
(fail) buildHomeConfigWriteHook — closing may not write configuration into the home (spec §6.2) > Write AGENTS.md inside the home -> deny [0.05ms]
 99 pass
 3 fail
Ran 102 tests across 1 file. [5.00ms]
```

**GREEN — the clause added**, mirroring the existing `claude*.md` clause exactly (case-insensitive,
last segment, any depth), each clause carrying its own rule-and-reason comment as the surrounding
code does:

```ts
const isClaudeMemoryFile = name.startsWith('claude') && name.endsWith('.md');
const isAgentsMemoryFile = name.startsWith('agents') && name.endsWith('.md');
```

`HOME_CONFIG_DENIED_REASON` now names `AGENTS*.md` alongside `.claude/`, `CLAUDE*.md` and
`.mcp.json`, so the refusal a session is shown states the actual rule (readable-code.md symptom 6).
Every reference to that constant compares against the constant itself, never its literal text.

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY bun test core/supervisor/home-config.test.ts core/supervisor/permit.test.ts
 148 pass
 0 fail
 191 expect() calls
Ran 148 tests across 2 files. [7.00ms]
```

### Part 3 — the committed G2 E2E gains a fourth pair; the ratchet moves 0/4 -> 4/4

`core/supervisor/home-config.e2e.test.ts`: the planted set became five files (`AGENTS.md` added to
`plantedFiles`, to `plantTargets` — the Bash writer's proof set — and to the Bash writer's prompt),
and a fourth pair was added: **`closing` plants with `Bash` -> `ruling` reads**, the exact pair the
Skinner measured carrying over, asserted with the unchanged `expectNoCarryOver` helper.

**RED — the fourth test, run BEFORE the Part 2 predicate change:**

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts -t "C1"
259 | function expectNoCarryOver(pair: PairResult): void {
260 |   expect(pair.writerAttempted).toBe(true); // the attempt happened, or this test proves nothing
261 |   expect(pair.markersAfterReader).toEqual([]); // no hook the writer planted ran in the reader
262 |   expect(pair.readerFinal).not.toContain(pair.codeword); // no instruction it planted reached the reader
                                     ^
error: expect(received).not.toContain(expected)

Expected to not contain: "ZEBRA-c1-agentsmd-1790304672411"
Received: "READ=done\nCODEWORD=ZEBRA-c1-agentsmd-1790304672411"

(fail) supervisor sessions never carry configuration forward (card supervisor-home-settings-containment, G2) > closing plants with Bash -> the next ruling sees no AGENTS.md instruction (C1) [33737.34ms]

 0 pass
 3 filtered out
 1 fail
 3 expect() calls
Ran 1 test across 1 file. [33.79s]
```

It fails on the codeword, in the reader's own final text — C1 reproduced through the committed
harness, not only through the Skinner's throwaway probe. Note that `writerAttempted` (the guard,
already fixed per M1 below) passed here: the Bash writer genuinely listed all five files, so the
plant really landed and the test is not passing its guard vacuously.

**BEFORE — the ratchet baseline, all four, predicate still unchanged:**

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts
Expected to not contain: "ZEBRA-ruling-write-1790304714195"
(fail) … > ruling plants with Write -> the next ruling sees no hook and no instruction [23074.71ms]
Expected to not contain: "ZEBRA-closing-bash-1790304737270"
(fail) … > closing plants with Bash -> the next ruling sees no hook and no instruction [32112.85ms]
Expected to not contain: "ZEBRA-closing-write-1790304769383"
(fail) … > closing plants with Write -> the next closing sees no hook and no instruction [17896.32ms]
Expected to not contain: "ZEBRA-c1-agentsmd-1790304787280"
(fail) … > closing plants with Bash -> the next ruling sees no AGENTS.md instruction (C1) [32335.07ms]
 0 pass
 4 fail
Ran 4 tests across 1 file. [105.47s]
```

All four carried over, every one on the codeword — `AGENTS.md` alone defeats every pair, because the
restore that had closed the other four planted files left this one in place.

**AFTER — with the Part 2 predicate in place:**

```
$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts
bun test v1.4.2 (744846f84)

 4 pass
 0 fail
 32 expect() calls
Ran 4 tests across 1 file. [109.53s]
```

**Ratchet: G2 E2E before 0/4 -> after 4/4**

(The card's original ratchet was 0/3 -> 3/3 on three pairs; the fourth pair is the C1 regression, so
the same committed tool now measures four. The count only rose.)

### Finding M1 — the Bash-writer guard was satisfiable by an `ls` FAILURE

The guard read `toolResultTexts(...).some((text) => plantTargets(plant).every((target) => text.includes(target)))`.
`ls` names each **missing** path in its stderr, and the `tool_result` carries stderr — so a total
failure to plant satisfied the guard. Reproduced deterministically on a home where **nothing** was
planted:

```
$ ls -1 $H/.claude/settings.json $H/.claude/settings.local.json $H/CLAUDE.md $H/CLAUDE.local.md $H/AGENTS.md
ls: /tmp/shsc-m1/home/.claude/settings.json /tmp/shsc-m1/home/.claude/settings.local.json /tmp/shsc-m1/home/CLAUDE.md /tmp/shsc-m1/home/CLAUDE.local.md /tmp/shsc-m1/home/AGENTS.md: No such file or directory

$ bun -e '<the guard, applied to that text>'
every(target => text.includes(target)) = true          <-- the guard passes on total failure
FIXED guard: every target on a line that is exactly that path = false
```

The same holds for the per-invocation shape the Skinner transcribed
(`ls: …/CLAUDE.md: No such file or directory`, one line per target): `every(includes) = true`,
`FIXED guard = false`. This is the residue of Amendment A2 — A2 required the plant to be *proved*
landed, and path presence is not that proof.

**Fix:** assert on the **listing shape**, not mere path presence. A new `isGenuineListing(text,
targets)` splits the `tool_result` into lines and requires each target to appear on a line that is
**exactly** that path — which `ls -1` produces on success and no `ls:` error line can ever produce.
Its comment cites this measurement. No assertion in `expectNoCarryOver` was weakened or changed.

### Finding M2 — two containment branches that were never proven red

`adapters/home-config.adapter.test.ts` gained two tests. The code was already correct, so both pass
on first run; that green is the point. To prove neither is **vacuous**, each guard was temporarily
mutated (mutations reverted, never committed):

```
=== MUTATION C: the REMOVE loop no longer proves containment ===
   (const target = join(realHome, entry.path);  instead of  containedTarget(realHome, entry.path))
Expected constructor: HomeConfigError
Received function did not throw
(fail) restoreHomeConfig > a plan REMOVE entry that escapes the home is refused before anything is deleted
 13 pass
 1 fail

=== MUTATION B: the parent-real-path guard disabled ===
   (if (false && !isInsideHome) throw …)
(fail) restoreHomeConfig > a write whose parent's real path is outside the home is refused; the outside directory is byte-unchanged
 13 pass
 1 fail

=== REVERTED ===  (git diff --stat adapters/home-config.adapter.ts -> empty)
 14 pass
 0 fail
```

- **`remove` escaping the home.** Only the `write` half of `fail-closed-edges.md` obligation 4 had
  ever been proven, and `remove` is the destructive half (`rmSync` with `recursive: true, force:
  true`). The test plants a real file beside the home, plans `remove ../escape.md`, and asserts both
  the `HomeConfigError` and that the victim is still `OUTSIDE`.
- **`containedTarget`'s "the parent's real path is outside the home" branch.** The test makes
  `<home>/.claude` a symlink to an outside directory — the mid-restore swap — plans a write to
  `.claude/settings.json`, and asserts the refusal plus the outside directory **byte-unchanged**
  (`'OUTSIDE'` intact, `readdirSync(outside) === ['settings.json']`), as the sibling symlink test
  already does. A relative-path check alone cannot see this case; only resolving the parent can,
  which is what mutation B proves.

### Gates

```
$ cd $RUNNER && bun test core/supervisor/ adapters/ cli/ structure.test.ts 2>&1 | tail -4
 11 skip
 0 fail
 1787 expect() calls
Ran 699 tests across 24 files. [12.54s]

$ cd $RUNNER && bunx tsc --noEmit && echo TSC_OK
TSC_OK

$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/home-config.e2e.test.ts 2>&1 | tail -20
 4 pass
 0 fail
 32 expect() calls
Ran 4 tests across 1 file. [109.53s]

$ cd $RUNNER && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/session.e2e.test.ts 2>&1 | tail -12
 7 pass
 0 fail
Ran 7 tests across 1 file

$ cd <worktree> && bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh 2>&1 | tail -3
ok - probe10: the verdict file carries a PASS verdict

40 passed, 0 failed

$ cd $RUNNER && bun test 2>&1 | tail -5
 1447 pass
 12 skip
 0 fail
 3417 expect() calls
Ran 1459 tests across 57 files. [297.00s]
```

The fence, re-verified after every change:

```
$ git diff db3bd53 -- plugins/tribe/scripts/runner/core/supervisor/session.ts | command grep -E "^[-+].*(ALLOWED_TOOLS|DISALLOWED_TOOLS|permissionMode|settingSources|cwd:)" || echo "FENCE_INTACT"
FENCE_INTACT
```

**Observed flake, recorded, not fixed (out of this brief's scope — `session.e2e.test.ts` may not be
changed).** The first run of `session.e2e.test.ts` gave `6 pass, 1 fail`: `closing: Skill c3 returns
C3 content` tripped its `expect(run.transcript).not.toContain('Unknown skill')` assertion. The cause
is in the transcript and is model non-determinism, not a settings-tier regression — the session
guessed a wrong skill name and the CLI told it so:
`<tool_use_error>Unknown skill: c3:c3</tool_use_error>` (the real name is `c3-skill:c3`). The
immediate re-run, unchanged, gave `7 pass, 0 fail`. That assertion is written as a tier-regression
tripwire, but a model typo produces the identical string, so it can fail for a reason that is not a
regression. Recorded for the Warchief; no change made.

### Follow-up recorded, not fixed here

**F3 — finding I1:** the timeout path's second snapshot/restore pass in `runOneShotSession` is
unawaited, so a write landing after a timed-out session can reach the next session's
before-snapshot. The Warchief ruled this a follow-up escalated to the owner: every fix changes
either the typed timeout result (which the plan fences off — "D-2026-09-24-3 is another card") or
the timeout's observable timing, a decision the plan does not make. `runOneShotSession`'s timeout
path is left exactly as it was.

### Result

C1 **FIXED** (reproduced RED through the committed harness, then fixed; ratchet 0/4 -> 4/4).
M1 **FIXED** (reproduced with the measured `No such file or directory` output, then fixed).
M2 **FIXED** (missing-coverage finding: the absence was the reproduction; both new tests
mutation-proven non-vacuous). I1 recorded as follow-up F3, not fixed here. No assertion was
weakened, no gate is red or skipped, and the fence is byte-identical.
