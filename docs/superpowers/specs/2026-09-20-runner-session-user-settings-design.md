# Spec — runner-session-user-settings: a spawned session loads the same settings a person's session does

**Card:** `~/.tribe/-Users-hip-repo-tribe/cards/runner-session-user-settings.md`
**Author:** Warchief, 2026-09-20
**Base:** `b6b5330` (master)
**Status:** plan-verified — every claim marked **PROVEN** below was produced by running a real
session through the runner's own `buildSessionOptions` + `adapters/session.adapter.ts`, not by
reading the SDK typings.

---

## 1. Problem, grounded in code

`plugins/tribe/scripts/runner/core/session.ts:181` pins:

```ts
settingSources: ['project'], // defaults to []; 'project' loads the target repo's own config
```

The SDK's own typing (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, `settingSources`)
says: *"When omitted, all sources are loaded (matches CLI defaults)."* By naming only `project`,
every runner-spawned session drops the **user** tier — `~/.claude/settings.json` — which is where
`enabledPlugins` lives. The C3 plugin is therefore never registered in a campaign session.

The tier list is pinned at the type level too: `ports/ports.ts:196` declares
`settingSources: ['project']` as a literal tuple, so the value cannot change without the type
changing with it.

### The observed failure chain

The repo's `AGENTS.md:5` still tells every session:

```
File lookup: `c3 lookup <file-or-glob>` maps files/directories to components + refs.
```

There is no `c3` executable anywhere (C3's own SKILL.md: *"There is no `c3` executable"*). A
session obeying that line gets `Unknown skill: c3. Did you mean cd?`, finds nothing on `which`,
guesses the plugin-cache layout wrongly, and escalates to a filesystem-wide `find`. Scanning from
`/` walks Desktop/Documents/Downloads, and macOS raises a folder-consent prompt attributed to the
terminal app.

**Reproduced at plan time (BEFORE evidence).** A real session spawned through the runner's own
option builder with today's `['project']`:

```
SKILL_RESULT=unknown Unknown skill: c3. Did you mean cd?
```

**Measured baselines** (committed counter, §6):

| Metric | Scope | Baseline |
| --- | --- | --- |
| Filesystem-wide scans (`find` rooted at `/`, `~`, `$HOME`) | campaign `supervisor-hardening` | **4** |
| `Unknown skill: c3` | campaign `supervisor-hardening` | 6 |
| `Unknown skill: c3` | all campaigns + transcripts | 124 (card recorded 91; see §9) |
| `Unknown skill: verify-shipped` | all campaigns + transcripts | 43 (card recorded 32; see §9) |

---

## 2. The change

Four coordinated edits, all inside the card's fence:

1. **`core/session.ts:181` + `ports/ports.ts:196`** — `settingSources: ['user', 'project', 'local']`.
   Per the Shaman's ruling, quoted verbatim from the card:
   > "match the CLI default — `['user', 'project', 'local']` — rather than inventing a two-tier
   > variant, unless the plan finds a concrete defect in `local`. Parity is the point; a bespoke
   > subset is a new divergence."

   **The plan found no defect in `local`** (§4.6). The list is written **explicitly** rather than
   by omitting the option, so the pinned-option regression test keeps a value to assert and a
   future SDK default change cannot silently move it.

2. **A fourth PreToolUse hook — `decideScanGuardHook`** (owner ruling R-a). Refuses a `find`
   rooted at `/`, `~`, or `$HOME` in a spawned session, with a message naming the skill to use
   instead. Same shape and same place as the three existing walls
   (`decideBackgroundingHook`, `decideWaitToolHook`, `decideMergeGateHook`).

3. **`AGENTS.md`** (G3) — the C3 lines name only things that exist. No `resolve-c3.sh` is added
   (owner ruling R-b).

4. **The ratchet** — a committed counter (§6) plus a committed evidence document recording
   before → after from that same tool.

### Not doing (owner ruling R-b)

No `resolve-c3.sh`. `/c3` is the entry point once the user tier loads; a second resolver would be
a parallel path to maintain.

---

## 3. Design — pure core, impure edges

Both new pieces follow `~/.claude/rules/pure-core.md`, matching the shape this module already uses.

**The scan guard.** `decideScanGuardHook(input: unknown): HookDecision` is a **pure function**:
same event in, same decision out, no I/O, no clock, no filesystem. It sits beside
`decideBackgroundingHook` and `decideWaitToolHook`, which are pure in exactly the same way. The
only impure member of the family is `decideMergeGateHook`, and only because it must run
`gh pr checks` through the injected `io.execInRepo` seam — the scan guard needs no such seam.

**The ratchet.** Split exactly as the repo's existing ratchet already is
(`scripts/ratchet-check.ts` = thin edge, `runner/core/metrics/ratchet-gate.ts` = pure core):

| Layer | File | Responsibility |
| --- | --- | --- |
| Pure core | `runner/core/metrics/session-hygiene.ts` | Given log **text**, return counts. No `fs`, no `Bun.spawn`, no globbing. |
| Impure edge | `scripts/session-hygiene.ts` | Walk the root, read files, print the report. |

### The counting oracle (settled — this is the contract)

Under-counting is a bug; over-counting is by design. Where a judgment call exists, scan.

- **A filesystem-wide scan** is one Bash `tool_use` whose `command` contains a `find` whose
  **root argument is exactly** `/`, `~`, `$HOME`, or `"$HOME"`. `find /Users/hip/repo/tribe` is a
  scoped scan and is **not** counted — this distinction is what makes the number mean something.
- **An unknown-skill error** is one occurrence of `Unknown skill: <name>` in the log text.
- **The unit is the occurrence, not the line.** One JSONL line can carry several.

**Both definitions are validated against reality, not asserted:** counting `supervisor-hardening`
this way yields **exactly 4** filesystem-wide scans, reproducing the card's independently measured
baseline. The four are the C3 hunt (×2), a log hunt, and — note — a hunt for the **agent SDK
typings**, which is the card's own evidence that removing the C3 motive does not remove the class.

### Two implementation hazards found at plan time (both are requirements, not notes)

1. **The logs are JSON; `grep` truncates at escaped quotes.** A `"command":"[^"]*"` regex stops at
   the first `\"` inside the command and silently loses most of it. The core therefore parses each
   line as JSON and reads `.message.content[].input.command`.
2. **A malformed final line must not abort the run.** Campaign logs can end mid-write after a
   crash. `jq` aborts the whole stream on the first unparseable line; the core must skip a bad
   line and continue (`fail-closed-edges.md` obligation 1: narrow catch, typed refusal, never a
   crash). This cost real debugging time during plan verification and is why the counter is a
   Bun/TypeScript module rather than a shell pipeline — a committed script must not depend on the
   host's interactive `grep` either, which on this machine is a ugrep wrapper whose `-I` flag
   silently skips files it judges binary.

---

## 4. What loading the user tier actually changes — **verified by running**

The card requires an answer to each of five questions, *"verified by running, not by reading."*
Method: spawn a real session through `buildSessionOptions` + the real SDK adapter, once with
`['project']` (control) and once with `['user','project','local']` (treatment), and read the SDK's
own `system/init` message — its report of the model, permission mode, tools, MCP servers and slash
commands actually in force.

### 4.1 Hooks — **harmless, and a failing one cannot break a session (PROVEN)**

`~/.claude/settings.json` registers `/Users/hip/.config/iterm2/cc-status` on nine events. It is a
symlink into `/Applications/iTerm.app/Contents/Resources/utilities/cc-status` — a compiled binary
shipped by iTerm that writes terminal status. It now runs per event in every spawned session.

- Every treatment probe completed successfully with all nine registered. ✅
- **A deliberately failing hook does not break a session.** With
  `{"hooks":{"PreToolUse":[...],"SessionStart":[...]}}` pointing at
  `/nonexistent/definitely-not-here`, a spawned session ran `Bash` and returned
  `DONE=HOOKTEST_OK`, `is_error: false`. ✅

  This matters beyond the test: on a machine without iTerm the symlink dangles, and that is
  exactly the proven-harmless case.

### 4.2 The runner's SDK options vs the user tier — **the SDK option wins (PROVEN)**

The card lists five values to adjudicate. **Grounding correction:** only two of them are actually
runner SDK options; the other three are keys of `~/.claude/settings.json` with no competing SDK
option at all (§9, discrepancy D1). Both groups are answered:

| Value | Source | Result | Evidence |
| --- | --- | --- | --- |
| `model` | SDK option (`session.ts:179`) vs user tier `"opus[1m]"` | **SDK wins** | init reports `claude-haiku-4-5-20251001` |
| `permissionMode: 'bypassPermissions'` | SDK option (`session.ts:183`) vs user tier `permissions.defaultMode: "auto"` | **SDK wins** | init reports `permissionMode: "bypassPermissions"` |
| `permissions.deny: ["ReportFindings"]` | user tier only — **no SDK option** | **now applies** | `ReportFindings` present in control's tool list, **absent** in treatment |
| `outputStyle: "Todd way"` | user tier + local tier — **no SDK option** | **now applies** | both tiers carry it; `/output-style` available |
| `disableClaudeAiConnectors: true` | user tier only — **no SDK option** | **now applies** | control lists 6 `claude.ai` MCP servers (pending/needs-auth); treatment lists **none** |

**The two campaign-killing risks are closed:** an unattended session does not silently become
`opus[1m]` (cost), and does not start prompting for permissions (a dead campaign). Both were
proven, not assumed.

The three user-tier-only keys are genuine new behaviour. None is harmful: `ReportFindings` is not
used by the executor, the output style is the owner's own, and dropping six unauthenticated
`claude.ai` connectors is a small improvement.

### 4.3 The other three plugins — **measured cost (PROVEN)**

`codex`, `playwright` and `superpowers` all become enabled. Measured, control → treatment:

| Surface | Control (`['project']`) | Treatment (`['user','project','local']`) |
| --- | --- | --- |
| Tools | 29 | 53 (`ReportFindings` removed; **+25** `mcp__plugin_playwright_playwright__*`) |
| MCP servers | 6 `claude.ai` (pending / needs-auth) | **1** — `plugin:playwright:playwright`, **connected** |
| Slash commands | 21 | ~55 (`codex:*`, `superpowers:*`, `cowork-plugin-management:*`, `c3-skill:c3`, `verify-shipped`) |

**The context cost is real and is the price of the parity the owner ruled for.** One MCP server
starts per session (playwright). Recorded as a hardening note (§8), not a blocker — the card's
adjudication rule settles the tradeoff.

### 4.4 `/c3` and `verify-shipped` resolve — **G1 and half of G4 PROVEN**

| Tier list | `Skill c3` result |
| --- | --- |
| `['project']` (today) | `SKILL_RESULT=unknown Unknown skill: c3. Did you mean cd?` |
| `['user','project','local']` | `SKILL_RESULT=ok: C3 is your architecture's own vocabulary, frozen into shared truth…` |

The skill resolves by its **bare name `c3`**, and `c3-skill:c3` also appears as a slash command.
`verify-shipped` likewise appears as a slash command only in the treatment — so the same one-line
change addresses **both** halves of G4's baseline, not just the C3 half.

### 4.5 Agent resolution — **both register; the user tier wins the bare name (PROVEN)**

A treatment session reports its available `subagent_type` values as:

```
claude, codex:codex-rescue, Explore, general-purpose, hunter, Plan, scout, shaman,
skinner, statusline-setup, tracker, tribe:hunter, tribe:scout, tribe:shaman,
tribe:skinner, tribe:tracker, tribe:warchief, warchief
```

Every tribe agent registers **twice**: unnamespaced from `~/.claude/agents/*.md` (user tier) and
namespaced `tribe:*` from the local plugin. **A brief saying `subagent_type: hunter` therefore
resolves to the user-tier copy, not the plugin's.**

All six are byte-identical today — verified file-by-file at plan time (6/6 `IDENTICAL`),
confirming the card's claim. Per the card's adjudication rule this drift risk is **a note, not a
defect to fix here** (§8). `tribe:hunter` is the explicit address if it ever matters.

### 4.6 Fresh machine — **degrades to a clear message, and `local` carries no defect**

`fixtures-mirror-reality` requires exercising the bare case during plan verification.

- **No plugin cache.** A session that needs C3 gets exactly today's clear error —
  `Unknown skill: c3. Did you mean cd?` — which the control run reproduces verbatim. It is a
  message, not a scan. The scan guard (§2.2) is what stops the session escalating from that
  message to a disk hunt, which is precisely why R-a ships alongside.
- **Unresolvable plugin config does not block startup.** With `HOME` pointed at a bare fixture
  containing only a `settings.json` that enables a plugin with no cache present, the session still
  reached `system/init`. (It then failed on authentication — credentials are bound to the real
  `HOME` — so this fixture cannot complete a session; the startup half is what it proves.)
- **`local` tier — no defect found.** `.claude/settings.local.json` in this repo contains only
  `{"outputStyle": "Todd way"}`, matching the user tier. It is ignored via the machine-global
  `~/.config/git/ignore`, so it is untracked and absent on a fresh clone and in every worktree
  (verified: neither existing worktree has one). Absent file → no effect. The Shaman's ruling
  therefore stands unamended: `['user', 'project', 'local']`.

---

## 5. Scope fence

**In:** `core/session.ts`, `ports/ports.ts` (the tier list's literal type — `session.ts` cannot
change without it), `core/session.test.ts`, the new scan-guard hook + tests, the new ratchet core +
edge + tests, the E2E test, `AGENTS.md`'s C3 lines, `runner/README.md`'s option documentation, and
the evidence document.

**Out, and untouched:** the supervisor loop, `core/state.ts`, `core/types.ts`, `core/watchdog/**`,
the viewer.

**`core/supervisor/session.ts` is OUT** — it builds a *different* envelope
(`OneShotSessionOptions`, `permissionMode: 'default'`) for supervisor/closing sessions and is
covered by "not the supervisor loop". Its `settingSources` stays as it is. Consequence: this card
fixes `Unknown skill` in **executor** sessions only (§9, discrepancy D3).

**The one changed assertion:** `core/session.test.ts:88` pins `['project']` and becomes wrong under
the ruling. Every other existing assertion stays exactly as it is.

---

## 6. The ratchet tool

`plugins/tribe/scripts/session-hygiene.ts`, invoked over any root of transcripts/campaign logs:

```
bun plugins/tribe/scripts/session-hygiene.ts --root <dir> [--json]
```

Prints (a) `Unknown skill: <name>` counts, broken down by skill name, and (b) the
filesystem-wide-scan count, per §3's oracle. Exit 0; it is a **measurement**, not a gate.

**Baseline is recorded before implementation and re-run after**, into
`docs/superpowers/evidence/2026-09-20-runner-session-hygiene.md`.

**A note the evidence document must carry:** counted over the *historical* corpus this number can
only ever grow, because past logs are immutable and every new session appends to the same
directories. The meaningful ratchet is therefore **per-campaign**, exactly as G2 and G4 state it
("baseline 4 in campaign `supervisor-hardening` → 0 in the next campaign's logs"). The global
total is context, not the target.

---

## 7. Testing strategy

| Level | What it proves | Where |
| --- | --- | --- |
| Unit (pure) | `decideScanGuardHook` denies `find /`, `find ~`, `find $HOME`, home-root globs; **allows** `find .`, `find /Users/hip/repo/tribe`, `find src -name x` | `core/session.test.ts` |
| Unit (pure) | the counting core's two oracles, incl. a JSON-escaped command and a malformed trailing line | `core/metrics/session-hygiene.test.ts` |
| Unit (options) | the pinned block now carries `['user','project','local']` and a **fourth** PreToolUse entry, wired and denying | `core/session.test.ts` |
| Fixture | the counter reproduces **4** against the real `supervisor-hardening` logs | evidence doc |
| **E2E (real model, mandatory)** | **G1** | `core/session.e2e.test.ts` |

### The E2E — the card's G1 oracle (owner's explicit requirement)

It must spawn a session **through the runner's own spawn path** (`runSession` + the real
`adapters/session.adapter.ts`), on a real model, and assert **from the resulting transcript**:

1. `Skill c3` returned a C3 result, and
2. no `Unknown skill` error appears, and
3. no filesystem-wide scan ran.

**A test that only inspects the options object passes on a stub and does not satisfy this** — per
the card, that is a blocker finding. The empty-implementation check is explicit: today's
`['project']` must make this test **fail**, and it must fail with `Unknown skill: c3`, not with a
setup error. It is opt-in behind an env flag (it costs real tokens and needs auth) and is not part
of the default `bun test` gate, with the exact invocation recorded in the evidence document.

---

## 8. Risks, and what is deliberately accepted

| Risk | Disposition |
| --- | --- |
| Reproducibility: a spawned session now depends on the host's `~/.claude/settings.json` | **Accepted — owner-ruled.** Recorded as a hardening note, never a blocker (card adjudication rule). Mitigated in fact by §4.2: the two options that decide cost and headlessness are SDK-pinned and proven to win. |
| Context cost: +25 tools, +~34 slash commands, 1 MCP server per session | **Accepted** — the measured price of parity (§4.3). Now quantified rather than assumed. |
| Agent drift: `~/.claude/agents/*.md` shadows the plugin for the bare name | **Note only** (card adjudication rule). Byte-identical today, 6/6 verified. `install.sh` keeps them synced; `tribe:hunter` is the explicit address. |
| The scan guard over-refuses a legitimate scan | **By design** — the oracle says over-refusing is acceptable, under-refusing is a bug. The deny message names the alternative, so a session is redirected, never merely blocked. |
| `local` tier is untracked and machine-specific | No defect found (§4.6); absent on fresh clones. |
| **An MCP server now connects at startup in every spawned session** (playwright) | **Must be proven to fail OPEN** (Shaman ruling R-c, `fail-closed-edges.md`): an unavailable server must leave the session running with the tools absent — never a hang, never a startup abort. Proven in Task 6; a non-fail-open result is an escalation, not a fix. |

**Rollback:** the behaviour change is one literal in two files. Reverting the commit restores
`['project']` exactly; the ratchet, the guard and the E2E are additive and independently
revertible.

---

## 9. Card-vs-code discrepancies found while grounding

**D1 — three of the five "runner's explicit SDK options" are not runner options.** The card asks
to prove which wins for `model`, `permissionMode`, `outputStyle`, `permissions.defaultMode` and
`permissions.deny`. `buildSessionOptions` (`session.ts:177-197`) sets only the first two;
`outputStyle` and both `permissions.*` keys are `~/.claude/settings.json` keys with **no competing
SDK option**. This inverts the question for them — they are not a precedence contest but *new
behaviour appearing where nothing applied before*. Answered as such in §4.2; it is why
`disableClaudeAiConnectors` (which the card does not mention) is also reported.

**D2 — the `AGENTS.md` `/c3` line was already removed at HEAD.** Commit `b6b5330` (2026-09-20
14:14) changed line 3 to *"For architecture questions, changes, audits, file context, use c3
skills"*. The card's step 2 describes the pre-`b6b5330` text. The **false `c3 lookup` executable
claim on line 5 still stands**, so G3 remains real — it is just narrower than the card describes.

**D3 — G4's `verify-shipped` baseline is partly out of fence. (Shaman ruling R-d: G4's oracle is
SCOPED to executor-kind sessions.** G4 is met when the count originating in **executor** sessions
reaches zero; `core/supervisor/session.ts:113`'s separate envelope is outside this card's fence and
its residual occurrences are **not this card's regression**. Follow-up candidate
**FU-supervisor-settings**. *Do not report a global zero that was not achieved.*) `core/supervisor/session.ts:113`
builds a separate envelope for supervisor sessions. 6 of the 43 `Unknown skill: verify-shipped`
occurrences are in `campaign-supervisor`'s logs, i.e. potentially from supervisor-kind sessions,
which this card does not touch. Executor sessions are fixed and `verify-shipped` does resolve in
them (§4.4); a residual count originating in supervisor sessions would not be regressed by this
card, and is flagged as a follow-up rather than silently absorbed.

**D4 — the global baselines differ from the card's. (Shaman ruling R-e: the baseline of record is
the committed script's output at the merge base, not the card's 91 / 32.)** The card records
91 / 32; the same corpus now counts **124 / 43** occurrences. *The card's missing counting method is
itself the defect, and the committed counter is the fix;* the evidence document records the method
(which pattern, over which roots), the **merge-base** output, and the post-change output. The corpus is append-only and still growing (sessions ran
between the card's measurement and this one), and the card does not record its counting method.
**The per-campaign `supervisor-hardening` scan baseline of 4 reproduces exactly**, which is the
one the card names for G2 and the one the ratchet targets.

**D5 — the tier list is pinned in two files.** `ports/ports.ts:196` types it as the literal tuple
`['project']`, so the card's fence ("`core/session.ts` and its tests") necessarily extends to
`ports/ports.ts`. This is mechanical, not a widening of intent.

---

## 10. Open questions for the Shaman

**Follow-up candidate FU-supervisor-settings** (out of fence, per R-d): supervisor and closing
sessions build a separate envelope at `core/supervisor/session.ts:113` and keep
`settingSources: ['project']` / `[]`. Whether they should load the user tier too is a real question
this card deliberately does not answer.

None blocking. R-a and R-b (owner) and R-c, R-d, R-e (Shaman) are ruled; D1–D5 are grounding corrections the plan already absorbs.
D3 is offered as a **follow-up candidate** (supervisor-kind sessions and `/c3`), explicitly out of
this card's fence.
