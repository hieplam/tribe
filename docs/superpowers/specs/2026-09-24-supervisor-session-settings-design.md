# Spec — supervisor-session-settings: the supervisor's own sessions load the user tier and run the scan wall

**Card:** `~/.tribe/-Users-hiep-repo-tribe/cards/supervisor-session-settings.md`
**Issue (governing document):** hieplam/tribe#163
**Campaign:** `fu-supervisor-settings`
**Author:** planning-Warchief, 2026-09-24
**Base:** `d6cad2f` (master)
**Status:** plan-verified by 15 real sessions; §10's two questions are **ruled** (R1 Shaman, R2
owner, 2026-09-24) and this spec is amended to both. Every
claim marked **MEASURED** below comes from a real Haiku session spawned through
`runOneShotSession` (`core/supervisor/session.ts:264`) and the real SDK adapter
(`adapters/session.adapter.ts:11`), not from reading the SDK typings.

---

## 1. Problem, grounded in code

`plugins/tribe/scripts/runner/core/supervisor/session.ts:113`:

```ts
settingSources: kind === 'closing' ? ['project'] : [],
```

and the `closing` branch returns at `session.ts:135` before any hook wiring, so a `closing`
session is granted `Bash` (`CLOSING_ALLOWED_TOOLS`, `session.ts:42`) with `hooks: undefined`.
`ruling`/`ratify` carry exactly one hook, the containment hook (`session.ts:147-149`).

Compare the executor path, fixed by PR #162: `core/session.ts:218` passes
`settingSources: ['user', 'project', 'local']` and wires four `PreToolUse` hooks, the fourth being
`decideScanGuardHook` (`core/session.ts:186`, wired at `core/session.ts:233`).

Two gaps (issue #163 "Where"):

1. **No user tier.** `~/.claude/settings.json` carries `enabledPlugins` (on this machine:
   `c3-skill@c3-skill-marketplace: true`). Without the `user` tier the C3 plugin is not
   registered, so `Skill c3` fails. **Reproduced (MEASURED, control runs, §4.1):** every one of
   the three kinds returned `<tool_use_error>Unknown skill: c3. Did you mean cd?</tool_use_error>`.
2. **No scan wall.** `decideScanGuardHook` never runs in a supervisor session. **Reproduced
   (MEASURED):** a `closing` session ran `find / -maxdepth 1 -name PROBE_NOPE` to completion
   (`(Bash completed with no output)`), under both tier lists — nothing refused it.

### A third coupling the issue does not name — found while grounding

`cli/main.ts:612-615`, `inferOneShotKind`, recovers the session kind **from the options object**:

```ts
if (options.settingSources.length > 0) return 'closing';
return options.additionalDirectories !== undefined ? 'ruling' : 'ratify';
```

It is used only when `TRIBE_SUPERVISOR_SESSION_DOUBLE` is set (`cli/main.ts:844-846`), i.e. by
`tests/test-supervisor-e2e.sh`, `test-supervisor-kill.sh` and `test-supervisor-repro.sh`. The moment
`ruling`/`ratify` get a non-empty tier list, every `ruling`/`ratify` spawn is misclassified as
`closing`, and the double is launched with `--kind closing`.

**MEASURED — and silent.** With only the tier literal patched to `['user','project','local']`,
`bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh` still reports `40 passed, 0 failed`
(same as at `d6cad2f`), because `fixtures/supervisor/session-double.sh:18-22` accepts `--kind` but
drives its behaviour from `DOUBLE_PLAN` alone. So nothing would catch the misclassification: it
corrupts the double's `DOUBLE_LOG` record and its error messages, and it leaves a function whose
doc comment ("make the inference exact, not a guess") is false. The discriminator must change
**before** the tier list does, under a unit test it never had (plan Task 2). The only field that
separates the kinds exactly, in every option set this card can produce, is the grant: `closing`
is the only kind whose `allowedTools` contains `Bash` (`session.ts:42` vs `:26`).

---

## 2. The change

1. **`inferOneShotKind` keys on the grant, not the tier list** (`cli/main.ts`). Prerequisite for 2.
2. **Tier parity (G3):** `settingSources: ['user', 'project', 'local']` for all three kinds, written
   explicitly (the precedent's reason, `core/session.ts:213-216`: an explicit list keeps the
   regression test meaningful and survives an SDK default change). **No concrete defect was found
   in any tier for the purpose of G3** (§4.5). Loading a tier that can carry `permissions.allow`
   was the D1 trigger for `closing` (§4.2); ruling R1 answers it with item 4.
3. **The scan wall in all three kinds (G2, D2, D3):** import `decideScanGuardHook` from
   `../session.ts` and add it as its own `PreToolUse` entry. `closing` gets it beside the grant
   hook (item 4); `ruling`/`ratify` get it alongside the containment hook. No second predicate;
   the executor's backgrounding, wait-tool and merge-gate hooks are **not** ported (D2).
4. **`closing`'s grant, enforced (ruling R1, amends D2):** a pure `decideClosingGrantHook` refuses
   any tool outside the unchanged `CLOSING_ALLOWED_TOOLS`, so no host `permissions.allow` rule can
   widen `closing`. **Accepted consequence (R1):** `closing` stops running `TaskCreate`,
   `CronList` and `ListAgents`, which run today un-granted (§4.2) and which the closing stage
   does not use.
5. **`Skill` granted to `ruling`/`ratify` (owner ruling R2, verbatim "Allow the Skill tool"):**
   `JUDGMENT_ALLOWED_TOOLS` gains `Skill`, and `decideContainmentHook`
   (`core/supervisor/permit.ts`) allows it. `Skill` only — `Bash` stays in
   `JUDGMENT_DISALLOWED_TOOLS`, nothing else is added. This is the one owner-ratified exception
   to the fence line "the grants stay as they are". **Known, accepted limit — not a defect:** the
   C3 skill's content loads in `ruling`/`ratify`, but its CLI (`bash <skill-dir>/bin/c3x.sh`)
   cannot run there, because those sessions have no `Bash` (MEASURED, §4.8).
6. **`verify-shipped` hand-load (G4): kept** — decision and evidence in §4.4. The comments that
   say "`settingSources` never loads it" (`session.ts:61-65`, `:128-131`) become false and are
   rewritten to say why it is kept.
7. **The E2E (G1, G2, G4, R1, R2):** a real-model session per kind, through `runOneShotSession` +
   the real adapter, asserting from the transcript; G1 in its original form for all three kinds.
8. **The ratchet (G5):** before → after with `plugins/tribe/scripts/session-hygiene.ts`.
9. **Phase-end governance:** C3 `c3-215-tribe` risk row and the runner README.

---

## 3. Design — pure core, impure edges

- `buildOneShotOptions` stays **pure**: kind + config in, an options object out. The new hook
  entry is a closure over the already-pure `decideScanGuardHook(input): HookDecision`; no new
  effect enters the module.
- The containment hook stays the impure edge it already is (`permit.ts`'s
  `buildContainmentHook(homeDir, { realpath })`, the one injected capability).
- `inferOneShotKind` stays pure (options in, kind out) and gains the unit test its doc comment
  says it never had (`cli/main.ts:610-611`: "deliberately not unit-tested").
- The closing grant hook (R1) is a **pure** predicate
  `decideClosingGrantHook(grantedTools, input): HookDecision` beside `decideContainmentHook` in
  `permit.ts` — an allowlist over `tool_name`, no filesystem, no clock. The grant arrives as an
  argument, so `permit.ts` never imports `session.ts` (which imports it).
- R2's change to `decideContainmentHook` is one more row in its already-pure table: `Skill`
  joins `Read`/`Grep`/`Glob` as allowed without a path check (loading a skill writes nothing).
  Its not-granted message is updated to name `Skill`, so the denial states the actual grant
  (`readable-code.md` symptom 6).
- The E2E is the edge: it constructs the real adapter and a throwaway campaign home, exactly as
  `tests/test-supervisor-permission-real.sh` already does for the same module.

---

## 4. Grounding by running — the three probes the dispatch required

**Method.** One uncommitted probe program (Appendix A) imports the real `runOneShotSession` and the
real `sdkSpawnSession`, builds a campaign home under `/private/tmp/sss-probe/`, and for the
"treatment" runs rewrites **only** `options.settingSources` inside the `spawnSession` seam — every
other field is exactly what `buildOneShotOptions` produced at `d6cad2f`, including the containment
hook and `options.plugins`. Model `claude-haiku-4-5-20251001`, `maxTurns: 12`,
`sessionTimeoutMs: 240000`. 15 real sessions (14 before the rulings, 1 after — §4.8), all `outcome: success`, none timed out.

### 4.1 What the tier change does to each kind (MEASURED)

| Kind | Tiers | init `permissionMode` | init `model` | Tools | Slash cmds | MCP servers | `Skill c3` result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ruling | `[]` (today) | `default` | haiku | 25 | 53 | 0 | `Unknown skill: c3. Did you mean cd?` |
| ruling | `user,project,local` | `default` | haiku | 25 | 65 | 0 | `PreToolUse:Skill hook error: This judgment session is not granted this tool…` |
| ratify | `[]` (today) | `default` | haiku | 25 | 53 | 0 | `Unknown skill: c3. Did you mean cd?` |
| ratify | `user,project,local` | `default` | haiku | 25 | 65 | 0 | `PreToolUse:Skill hook error: …not granted this tool…` |
| closing | `['project']` (today) | `default` | haiku | 26 | 54 | 0 | `Unknown skill: c3. Did you mean cd?` |
| closing | `user,project,local` | `default` | haiku | 26 | 65 | 0 | `Launching skill: c3` + body (`Base directory for this skill: /Users/hiep/.claude/plugins/cache/c3-skill-marketplace/c3-skill/11.6.3/skills/c3`) |

- **The SDK's `permissionMode` and `model` beat the user tier here too.** This machine's
  `~/.claude/settings.json` has `permissions.defaultMode: "auto"` and `model: "opus"`; every
  treatment init still reports `permissionMode: "default"` and the haiku model. This re-confirms
  #162's evidence for the `'default'` mode specifically (#162 proved it for `bypassPermissions`).
- **The tool list is identical per kind across tiers** (25 / 25, 26 / 26). No MCP server starts on
  this machine (its user tier sets `ENABLE_CLAUDEAI_MCP_SERVERS=false` and enables no Playwright
  plugin) — so #162's "+25 Playwright tools" cost does not appear here; it is host-dependent.
- The user tier adds 11–12 slash commands/skills: `mammoth-hunt`, `orchestrate-campaign`,
  `verify-shipped`, `codex:*` (6), `c3-skill:c3`.

### 4.2 Probe 2 — does the user tier widen a grant? (D1)

**`ruling` / `ratify`: no widening, and none is possible.** In both tiers, every tool call outside
`Read/Grep/Glob/Write/Edit` was refused by the containment hook (`ToolSearch`, `Skill`); `Bash`,
`WebFetch`, `Task`/`Agent` are not in the tool list at all (`disallowedTools`). **A synthetic
allow rule cannot widen them either (MEASURED):** with
`{"permissions":{"allow":["Skill","ToolSearch","Bash"]}}` in the probe home's
`.claude/settings.local.json` and the tiers loaded, `Skill c3-skill:c3` was still refused —
`PreToolUse:Skill hook error: This judgment session is not granted this tool`. The `PreToolUse`
hook beats an `allow` rule.

**`closing` on this machine's real settings: no widening.** The same five-call probe and a
second five-call probe (`TaskCreate`, `CronList`, `ListAgents`, `NotebookEdit`, `Workflow`)
behaved identically under both tier lists:

| Call | `['project']` (today) | `user,project,local` |
| --- | --- | --- |
| `Bash echo PROBE_BASH_OK` | ran | ran |
| `WebFetch` | not in tool list | not in tool list |
| `Task`/`Agent` | not in tool list | not in tool list |
| `TaskCreate` | **ran** | **ran** |
| `CronList` | **ran** | **ran** |
| `ListAgents` | **ran** | **ran** |
| `Workflow` | denied (`permission_denials: [Workflow]`) | denied (`permission_denials: [Workflow]`) |

`TaskCreate`, `CronList`, `ListAgents` are outside `CLOSING_ALLOWED_TOOLS` but run **today**,
unprompted — they are tools the CLI does not gate. That is pre-existing and not caused by this
card (follow-up F1, §9).

**`closing` with an allow rule in a loaded tier: WIDENED (MEASURED) — this is D1's named
example.** With `{"permissions":{"allow":["Workflow"]}}` in the campaign home's
`.claude/settings.local.json`:

| Tiers | `Workflow` |
| --- | --- |
| `['project']` (today) | **denied** — `permission_denials: [Workflow]` (the `local` tier is not loaded, the rule never applies) |
| `['user','project','local']` | **ran** — `Workflow launched in background. Task ID: wiid6izbz`, `permission_denials: []` |

The probe used the `local` tier because it is a scratch file under the probe home; a
`permissions.allow` entry in `~/.claude/settings.json` (the `user` tier) is the same mechanism
through a different file. **So:** loading the tiers does not widen `closing` on this machine
today (its user tier carries no `permissions.allow`), but it hands every host's settings files the
power to widen the `closing` grant silently, and `closing` has no hook that would stop it. Per D1
this is an owner decision, not something the executor absorbs → **§10 Q1**.

### 4.3 Probe 1 — the ratchet baseline (G5)

**This machine is fresh.** Which roots, and what each holds:

| Root | Contents | `unknownSkills` | `filesystemWideScans` |
| --- | --- | --- | --- |
| `~/.tribe` | **empty of logs** (0 `*.log`/`*.jsonl` files) | `{}` | 0 |
| `~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings` (this campaign's home; supervisor sessions log to `<home>/supervisor/sessions/`) | **empty** | `{}` | 0 |
| `~/.claude/projects/-Users-hiep-repo-tribe` (interactive + planning transcripts, cwd = repo) | real transcripts | `{c3: 43, verify-shipped: 6}` | 0 |
| `~/.claude/projects` (all) | real transcripts | `{c3: 43, verify-shipped: 6}` | 1 |

Commands: `bun plugins/tribe/scripts/session-hygiene.ts --root <root> --json`, run at `d6cad2f`.

**The supervisor-session root that G5 speaks about is empty on this machine**, so its baseline is
"0 of 0" and proves nothing by itself. The informative baseline is the probe corpus, separated by
envelope (the same tool, `--root /private/tmp/sss-probe/ratchet/<group>`):

| Corpus | Sessions | `Unknown skill` | Filesystem-wide scans |
| --- | --- | --- | --- |
| today's envelope (control) | 6 | **12** (`c3`) | 1 |
| tiers loaded (treatment) | 8 | **0** | 1 |

The scan in each corpus is the **instructed** `find / -maxdepth 1 -name PROBE_NOPE` in the
`closing` grant probe. The counter counts Bash `tool_use` *attempts*, not executions
(`core/metrics/session-hygiene.ts`), which matters for the plan (§7): the G2 refusal test attempts
a scan on purpose, so its log must not sit in the G5 root.

### 4.4 Probe 3 — `verify-shipped` with and without the hand-load (G4)

`closing` session, prompt "invoke Skill `verify-shipped`, do not follow it":

| Tiers | `options.plugins` | Result | Registered as |
| --- | --- | --- | --- |
| `['project']` (today) | present | `SKILL_RESULT=ok`, base dir `/Users/hiep/repo/tribe/plugins/verify-shipped/skills/verify-shipped` | `verify-shipped:verify-shipped` |
| `user,project,local` | **absent** | `SKILL_RESULT=ok` | `verify-shipped` |
| `user,project,local` | present | `SKILL_RESULT=ok` | `verify-shipped` only — the namespaced copy **dedupes away** |

Why the user tier finds it: `install.sh` symlinks
`~/.claude/skills/verify-shipped -> /Users/hiep/repo/tribe/plugins/verify-shipped/skills/verify-shipped`
(verified with `ls -la ~/.claude/skills`). That is a **host install fact**, not something the repo
guarantees.

**Decision (How-level, the Warchief's call): keep the hand-load.** Without it, `closing` resolves
`verify-shipped` only on a host where `install.sh` has run; with it, `closing` resolves it from the
repo itself on every host, and on a host where both exist it costs nothing (one registration —
measured). It also keeps `decide.ts`'s existing fail-closed guard (`verifyShippedPluginAvailable`,
`decide.ts:199`) meaningful. The PR body states this verdict and the table above (G4).

### 4.5 Tier-by-tier defect check (G3)

- `user` — `~/.claude/settings.json`: `enabledPlugins`, `model`, `permissions.defaultMode`, `env`,
  UI keys. `model`/`permissionMode` proven to lose to the SDK (§4.1). Carries no
  `permissions.allow` on this machine. No defect for parity; the allow-rule mechanism is §10 Q1.
- `project` — resolved relative to `cwd`, which for every supervisor session is the **campaign
  home** (`session.ts:109`), not the repo. No campaign home has a `.claude/settings.json`. Note:
  `closing` already loads this tier today, so the allow-rule mechanism of §4.2 already exists for
  it via `<home>/.claude/settings.json`; the tiers widen the set of files that can carry one.
- `local` — `<home>/.claude/settings.local.json`; absent in every real campaign home. No defect.
- `~/.claude/settings.local.json` does not exist on this machine.

**No tier carries a defect that justifies a bespoke subset.** Dropping `local` would not close §10
Q1 (the `user` tier carries `permissions.allow` just the same), and dropping `user` defeats G1.

### 4.6 What G1 could mean for `ruling`/`ratify` before R2 (MEASURED) — §10 Q2

With the tiers loaded, `c3` **resolves** in `ruling`/`ratify` — it is in the init `skills` list as
`c3-skill:c3`, and a `Skill c3` call no longer yields `Unknown skill` — but the call is then
**refused by the containment hook**, because `Skill` is not in `JUDGMENT_ALLOWED_TOOLS`
(`session.ts:26`) and `decideContainmentHook` denies every tool outside Read/Grep/Glob/Write/Edit
(`permit.ts:74-84`). The fence forbids changing that grant. So issue #163's first checkbox —
"asserting from the transcript that `Skill c3` returns C3 content" — **cannot be met for
`ruling`/`ratify` inside the fence.** It can be met for `closing` (§4.1).

Also relevant: the C3 skill's own body says its CLI is invoked as
`C3X_MODE=agent bash "<skill-dir>/bin/c3x.sh" …` (SKILL.md, "CLI invocation") — it needs `Bash`,
which `ruling`/`ratify` are deliberately denied (`JUDGMENT_DISALLOWED_TOOLS`, `session.ts:32`). So
granting `Skill` alone would put the C3 router's text in the session, not a working C3. The
owner ruled (R2) to grant `Skill` with that limit accepted; §4.8 measures it.

### 4.7 The scan predicate already covers every issue variant (MEASURED)

`isFilesystemWideScan` at `d6cad2f` denies `find / -name x`, `find '/' …`, `find "/" …`,
`sh -c 'find / …'`, `bash -c "find / …"`, `eval 'find / …'`, `` echo `find / …` ``,
`$(find / …)`, `/usr/bin/find / …`, `find ${HOME} …`, `find "${HOME}" …`, `find ~ …`,
`find $HOME …`, and allows `find . …` and `find /Users/hiep/repo/tribe …`. Nothing in the
predicate changes; the card needs only the wiring.

### 4.8 Re-probe after R2: a `ruling` session with `Skill` granted (MEASURED)

One more real session, same probe program, `ruling` kind, tiers loaded, with R2 simulated exactly
inside the `spawnSession` seam: `allowedTools` became `['Read','Grep','Glob','Write','Edit','Skill']`
and the containment hook was wrapped to return `{}` for `Skill` and defer to the real hook for
everything else (`GRANT_SKILL=1`, prompt `c3follow`: invoke `Skill c3`, then follow the loaded
skill's CLI instructions to run its `check` command via `Bash`, loading `Bash` with `ToolSearch`
if needed). Transcript, verbatim:

```
USE Skill {"skill": "c3-skill:c3", "args": "check"}
RES Launching skill: c3-skill:c3
USE ToolSearch {"query": "select:Bash", "max_results": 1}
RES PreToolUse:ToolSearch hook error: This judgment session is not granted this tool; only Read, Grep, Glob and Write/Edit under the campaign home are permitted.
FINAL SKILL_RESULT=ok The skill c3-skill:c3 loaded successfully. C3 is your architecture's own vocabulary, frozen into shared truth, that work edits only through reviewed change-units.
      BASH_RESULT=unavailable This judgment session is not granted Bash tool access; only Read, Grep, Glob, and Write/Edit are permitted.
```

- **`Skill c3` loads C3 content** in `ruling`: the transcript carries the skill's own base-directory
  line (`skills/c3`, 2 occurrences) and its opening sentence; no `Unknown skill`.
- **The loaded instructions cannot reach `Bash`.** `Bash` is not in the session's tool list at
  all (`JUDGMENT_DISALLOWED_TOOLS`), and the attempt to load it through `ToolSearch` was refused by
  the containment hook. `permission_denials: [ToolSearch]`; no `Bash` `tool_use` was ever emitted.
  So the C3 CLI does not run there: the accepted limit of R2, measured.
- The C3 skill's `SKILL.md` carries no `allowed-tools` front-matter. Even if some skill did, the
  containment hook runs on every tool call and a `PreToolUse` deny beats an allow (MEASURED §4.2).
  Plan Task 6's unit tests pin `Bash` and an out-of-home `Write` as still refused.

---

## 5. Scope fence (issue #163, verbatim in the card)

**In:** `core/supervisor/session.ts`, `core/supervisor/session.test.ts`, the new
`core/supervisor/session.e2e.test.ts`, `cli/main.ts#inferOneShotKind` + `cli/main.test.ts`, the
evidence document, `runner/README.md`, `.c3/c3-2-plugins/c3-215-tribe.md` (via the `c3` skill),
`core/supervisor/permit.ts` + `permit.test.ts` (R1's grant hook and R2's `Skill` row).

**Fence exception, by owner ruling R2:** `JUDGMENT_ALLOWED_TOOLS` gains `Skill`, and
`decideContainmentHook` allows it. Nothing else in any grant changes.

**Out:** `permissionMode` (stays `'default'`); `JUDGMENT_DISALLOWED_TOOLS`, `CLOSING_ALLOWED_TOOLS`,
`CLOSING_DISALLOWED_TOOLS` (byte-identical), and `JUDGMENT_ALLOWED_TOOLS` except for `Skill`;
the executor path `core/session.ts` (only a value import from it); the predicate in
`core/metrics/session-hygiene.ts`; the executor's other three hooks; the inherited
`evals-file-has-52-evals` failure.

**Schema-locked paths checked:** `campaign-state.json` for this campaign lists
`plugins/tribe/scripts/runner/core/state.ts` and `plugins/tribe/scripts/runner/core/types.ts`. The
plan schedules no change under either, so the plan carries **no** `allowsSchemaChange`
front-matter.

---

## 6. Testing strategy

| Level | Proves | Where |
| --- | --- | --- |
| Unit (pure) | `inferOneShotKind` maps each kind's REAL options to the right kind, with non-empty `settingSources` on all three | `cli/main.test.ts` |
| Unit (options) | all three kinds carry `['user','project','local']`; grants and `permissionMode` unchanged | `core/supervisor/session.test.ts` |
| Unit (wired hooks) | for each kind, invoking the built `PreToolUse` hooks on every issue variant yields a `deny` carrying `SCAN_DENIED_REASON`; a scoped `find` in `closing` gets no deny; `ruling`/`ratify` still deny a Write outside the home (containment unchanged) | `core/supervisor/session.test.ts` |
| Unit (grant hook, R1) | `decideClosingGrantHook` allows exactly `CLOSING_ALLOWED_TOOLS`, denies `Workflow`/`TaskCreate`/`CronCreate`/malformed input | `core/supervisor/permit.test.ts` |
| Unit (Skill grant, R2) | `ruling`/`ratify` `allowedTools` = the old five + `Skill`; `decideContainmentHook` allows `Skill`; **`Bash`, `ToolSearch`, `WebFetch` and a `Write` outside the campaign home are still refused**, directly and through the wired hooks | `permit.test.ts`, `session.test.ts` |
| **E2E, real model** | G1 (content returned) for all three kinds, G2 real refusal in `closing`, G4 with/without hand-load, R1 allow rule cannot widen `closing` | `core/supervisor/session.e2e.test.ts` (opt-in `RUN_SESSION_E2E=1`) |
| Ratchet | G5 before → after, same tool | evidence doc |
| Regression (existing) | `tests/test-supervisor-e2e.sh` stays 40/40 (it cannot detect a misrouted kind — see §1 — which is why Task 2's unit test exists); `tests/test-supervisor-permission-real.sh` (opt-in, real) stays green with the new hooks | Tasks 2-6 |

### The E2E — card G1's oracle, exactly

Through `runOneShotSession` with `io.spawnSession = (p) => sdkSpawnSession(p as never)`, the same
wiring `cli/main.ts:844-845` uses; transcript captured through `io.appendLog`. Per kind:

- **All three kinds (G1 as the issue wrote it, R2):** the transcript shows a `Skill` `tool_use`
  whose skill matches `/(^|:)c3$/`, the text `skills/c3` (the loaded body's own base-directory
  line), **no** `Unknown skill`, and no `Skill` entry in `permissionDenials`.
- `closing` scan wall (G2): a session told to run `find / -maxdepth 1 -name X` records the
  `SCAN_DENIED_REASON` text in its transcript and a `Bash` entry in `permissionDenials`.
- G4: two `closing` sessions invoking `verify-shipped`, one with `verifyShippedPluginDir` set and
  one without; both must show `Launching skill: verify-shipped` and no `Unknown skill`.

**Empty-implementation check (mandatory):** with the tier line reverted to today's value the
G1 tests must fail on `Unknown skill: c3`, and with the scan-guard entry removed the G2 test must
fail because `find` ran. Both failures are captured in the task report.

---

## 7. The ratchet (G5)

Same tool before and after: `bun plugins/tribe/scripts/session-hygiene.ts --root <root> --json`.

- **Before:** §4.3's numbers, copied verbatim into the evidence doc.
- **Before and after, from the same sessions:** when `SUPERVISOR_E2E_LOG_DIR` is set, the E2E
  writes each ordinary session's transcript (the G1 and G4 sessions) to
  `$SUPERVISOR_E2E_LOG_DIR/sessions/<kind>-<label>.jsonl`, and each adversarial session's (the G2
  scan refusal, the Q1 grant probe — sessions *told* to break a wall) to
  `$SUPERVISOR_E2E_LOG_DIR/adversarial/`. The E2E is run twice: once with the envelope temporarily
  reverted to `d6cad2f`'s (the empty-implementation check, `LOG_DIR=…/before`) and once as built
  (`LOG_DIR=…/after`). G5 is measured on `after/sessions` and must read `unknownSkills: {}` and
  `filesystemWideScans: 0`; `before/sessions` is expected to show `Unknown skill: c3` once per
  kind at least. The adversarial roots are reported alongside: `after/adversarial` counts the
  scan *attempts* (≥ 1), every one of which must appear in that session's `permissionDenials` —
  the refusal is G2's evidence, not a G5 regression.
- The global `~/.claude/projects` totals can only grow (immutable history); they are context.

---

## 8. Risks

| Risk | Disposition |
| --- | --- |
| A host `permissions.allow` rule silently widens `closing` (MEASURED, §4.2) | **Closed by R1** — `decideClosingGrantHook`; proven by a real session in the E2E. |
| Granting `Skill` to judgment sessions opens more than `Skill` | **R2 grants `Skill` only.** Unit tests pin `Bash`/`ToolSearch`/out-of-home `Write` as refused; §4.8 measured the loaded C3 instructions unable to reach `Bash`. |
| C3 CLI unusable in `ruling`/`ratify` | **Known, accepted limit of R2** (no `Bash` by decision 4) — not a defect. |
| `inferOneShotKind` misroutes the session double once tiers are non-empty | Fixed first (plan Task 2), with a unit test it never had. |
| Supervisor sessions now depend on host settings (reproducibility) | Accepted by parity (G3), as in #162; `model`/`permissionMode` proven SDK-pinned (§4.1). |
| Context cost (+12 skills; Playwright where a host enables it) | #162's measured price of parity; re-use, not re-derived. |
| A failing user-tier hook breaks a session | #162 proved it does not; re-use. |
| The scan guard over-refuses | By design (the predicate's oracle). |
| `closing` runs `TaskCreate`/`CronList`/`ListAgents` today, un-granted | Pre-existing; **stopped by R1's grant hook, accepted by R1** (the closing stage uses none of them). |

**Rollback:** one commit reverts the tier literal; the hook entries and E2E are additive.

---

## 9. Follow-ups discovered (not in this card)

- **F1** — un-gated CLI tools reached `closing` before this card (`TaskCreate`, `CronList`,
  `ListAgents` MEASURED; `CronCreate`, `SendMessage`, `RemoteTrigger`, `PushNotification`,
  `EnterWorktree` in the same tool list). **Resolved in this card by R1's grant hook**; no
  follow-up remains.
- **F2** — the scan wall's oracle is `find`-only; `ruling`/`ratify` hold `Glob`/`Grep`, which can
  also walk `/` (a `Glob` with `path: "/"`). Out of the card's G2, which names `find`.
- **F3** — `cli/main.ts:607-611`'s doc comment says `inferOneShotKind` is "deliberately not
  unit-tested"; Task 2 changes that and rewrites the comment.

---

## 10. Questions for the Shaman — RULED

**Rulings (2026-09-24; `answers.md` R1/R2, card section "Rulings after planning"):**

- **R1 (Shaman), Q1 = (b).** Add `decideClosingGrantHook`, refusing any tool outside the
  unchanged `CLOSING_ALLOWED_TOOLS`. Amends D2. Plan Task 5 is unconditional. The loss of
  `TaskCreate`/`CronList`/`ListAgents` in `closing` is accepted.
- **R2 (owner), Q2 = (a), verbatim: "Allow the Skill tool".** Fence exception:
  **`JUDGMENT_ALLOWED_TOOLS` gains `Skill` by owner ruling R2**, and `decideContainmentHook` allows
  it. `Skill` only: `Bash` stays in `JUDGMENT_DISALLOWED_TOOLS`, and no other tool is added. G1
  stays as the issue wrote it for all three kinds. The C3 CLI still cannot run in
  `ruling`/`ratify` (no `Bash`) — a known, accepted limit (§4.8). Plan Task 6.

The questions as they were put, kept for the record:

### Q1 — `closing`'s grant becomes extendable by host settings (D1 trigger, owner-only "new permissions")

**Context.** §4.2, MEASURED: with the tiers loaded, a `permissions.allow` rule in a loaded
settings file auto-approves a tool outside `CLOSING_ALLOWED_TOOLS` in `closing` (`Workflow`: denied
today, ran after). This machine's real user tier carries no allow list, so nothing widens today;
the change creates the path. `ruling`/`ratify` are immune (the containment hook beats any allow
rule — MEASURED). D1 says a widened grant stops the card.

**Options.**
- **(a) Accept.** Load the tiers in `closing` as-is; a host allow rule may extend `closing`'s
  grant. Parity-pure, but a standing permission surface the owner does not see.
- **(b) Enforce the grant with a hook (recommended).** Add a pure `decideClosingGrantHook` that
  denies any tool outside `CLOSING_ALLOWED_TOOLS` (the list itself stays byte-identical), wired
  in `closing` beside the scan guard. Host allow rules can then never widen `closing`, exactly as
  the containment hook already guarantees for `ruling`/`ratify`. Cost: it is a second added hook,
  which D2's "Only the scan-guard hook is added" does not permit without a ruling; and it
  **narrows** `closing` from today (`TaskCreate`/`CronList`/`ListAgents` stop running — F1), which
  Stage D does not use.
- **(c) Keep `closing` on its old tier list.** Fails G1 for `closing` (no `/c3`) and G3 parity. Not
  recommended.

**Recommendation: (b).** It is the only option that keeps G1, G3 and the fence's "grants stay as
they are" all true at once. **Ruled (b) — R1.**

### Q2 — G1 for `ruling`/`ratify` cannot show "`Skill c3` returns C3 content" inside the fence

**Context.** §4.6, MEASURED: after the tier change, `c3` resolves in `ruling`/`ratify` (registered,
no `Unknown skill`), but the containment hook refuses the `Skill` tool because
`JUDGMENT_ALLOWED_TOOLS` does not include it, and the fence keeps that grant. Even if `Skill` were
granted, the C3 skill's CLI needs `Bash`, which judgment sessions are denied by decision 4.

**Options.**
- **(a) Grant `Skill` to `ruling`/`ratify`** (add it to `JUDGMENT_ALLOWED_TOOLS` and to the
  containment table's allow set). Owner-only (new permission); yields the C3 router's text but no
  working C3 CLI.
- **(b) Amend G1's oracle for `ruling`/`ratify` (recommended):** "resolves" = the transcript shows
  `c3` registered (init `skills`), a `Skill c3` attempt, **no `Unknown skill`**, and the attempt
  refused by the containment hook's not-granted reason — i.e. the failure chain the issue exists
  to kill (`Unknown skill` → hunt → `find /`) is gone, and the grant is unchanged. `closing` keeps
  the full oracle (content returned).
- **(c) Drop `ruling`/`ratify` from G1.** Loses the no-`Unknown skill` assertion. Not recommended.

**Recommendation was (b). Ruled (a) by the owner — R2.** The plan adds the grant-change task
(Task 6) and its E2E (Task 7) asserts the `closing` oracle for `ruling`/`ratify` too.

---

## Appendix A — the probe program (uncommitted; reproduces every MEASURED row)

Saved at `/private/tmp/sss-probe/probe.ts` during planning. Invocation, from
`plugins/tribe/scripts/runner/` (after `bun install`):

```bash
bun /private/tmp/sss-probe/probe.ts <kind> <baseline|user,project,local> <plugins|noplugins> <grant|extra|vs|allowprobe|c3only>
```

Its core, verbatim:

```ts
const transcript: string[] = [];
const io = {
  spawnSession: (params: any) => {
    if (tiers) params.options.settingSources = tiers;          // the ONLY field changed
    if (pluginsArg === 'noplugins') delete params.options.plugins;
    return sdkSpawnSession(params);                             // the real adapter
  },
  onSessionStart: () => {},
  appendLog: (_p: string, line: string) => { transcript.push(line); },
};
const result = await runOneShotSession(
  { kind, prompt: PROMPTS[promptName],
    config: { homeDir: home, model: 'claude-haiku-4-5-20251001', maxTurns: 12, repoRoot,
              realpath: (p) => { try { return realpathSync(p); } catch { return p; } },
              ...(kind === 'closing' ? { verifyShippedPluginDir: '/Users/hiep/repo/tribe/plugins/verify-shipped' } : {}) },
    sessionTimeoutMs: 240_000 },
  io,
);
```

The allow-rule probes pre-create `<home>/.claude/settings.local.json` with
`{"permissions":{"allow":["Workflow"]}}` (closing) or `{"permissions":{"allow":["Skill","ToolSearch","Bash"]}}`
(ruling) before the run. The §4.8 re-probe sets `GRANT_SKILL=1`, which appends `'Skill'` to
`allowedTools` and wraps `PreToolUse[0]` so `Skill` returns `{}` and every other tool defers to the
real containment hook.
