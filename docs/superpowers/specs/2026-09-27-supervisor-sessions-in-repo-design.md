# Spec — supervisor-sessions-in-repo: every session the tribe spawns starts in the target repo, and the ledger is the campaign's session tree

**Card:** `~/.tribe/-Users-hiep-repo-tribe/cards/supervisor-sessions-in-repo.md` (issue #173; where
the card and the issue differ, the card wins — its "Grounding" section corrects the issue)
**Campaign:** `sessions-in-repo`, one card, driven by the runner's `watchdog` (card D4)
**Author:** planning-Warchief, 2026-09-27
**Base:** `daf4f9c` (master)
**Plan:** `docs/superpowers/plans/2026-09-27-supervisor-sessions-in-repo.md`
**Probe card for the owner run (§7):** `docs/superpowers/plans/2026-09-27-owner-run-probe.md`

Every claim marked **MEASURED** was produced during planning on 2026-09-27 by a real session
(`@anthropic-ai/claude-agent-sdk@0.3.278`, Claude Code `2.1.283`), a real `supervise` run, or a real
viewer served to a real Chrome — never by reading code. The probe programs are in Appendix A.

---

## 1. The governing text, verbatim

From the card, "Goal · Verify · Ratchet":

> | G1 | `ruling`, `ratify`, `closing` start in the target repo root | real `supervise` run; read `cwd` from each supervisor transcript | 0/5 → all |
> | G2 | Nothing written in the campaign folder ever loads as config | #171's real-session planting E2E (hook, CLAUDE.md, .mcp.json), kept and re-pointed | 0/4 effect, stays 0/4 with guards deleted |
> | G3 | `ruling`/`ratify` still cannot write into the repo | test: `ruling` Write to `<repo>/CLAUDE.md` and `<repo>/.claude/settings.local.json` refused | refused → refused |
> | G4 | #171's guards, tests and rule removed; rule rewritten (via C3 CLI) to the true invariant (D2) | grep + line count | 1,070 guard lines → 0 |
> | G5 | Owner sees each supervisor session badged to its campaign in the viewer | real viewer run, `/s/<sessionId>` for each supervisor session | 5/5 today → 5/5 after (a cwd-only change drops to 0) |
> | G6 | Nothing regresses | `session.e2e.test.ts`, `test-supervisor-e2e.sh` | 7/7, 40/40 → same |
> | G7 | The owner's main checkout is untouched by a supervisor run | branch + `git status --porcelain` before/after the real run | unchanged |
> | G8 | Owner asks "draw this campaign's session flow" and gets the full chain from the ledger alone | real campaign run; an LLM given only `ledger.jsonl` draws the tree; compare against the transcripts/`subagents/` on disk: every session present, every parent edge correct | `fu-supervisor-settings` today: 4 of ≥24 sessions, 0 parent edges → all sessions, all edges |

> **D1 — G5 attribution (owner, 2026-09-27): "Read ledger as 3rd file".** The viewer reads
> `supervisor/ledger.jsonl` as a third file per campaign. Session ids from it are charset-checked
> and used only as lookup keys, never as paths (same containment as `badge.ts`). The viewer README's
> two-files wall is rewritten to three files, naming this one.

> **D1 amended** Outcome: `supervisor/ledger.jsonl` is the campaign's complete session tree. Every
> session spawned in the campaign — supervisor one-shots, executor sessions, and the subagents inside
> them (warchief, hunter, skinner, tracker, scout) — gets one appended row at spawn carrying at least
> its own id and the id of the session that spawned it (root rows have none). An LLM given only that
> file can draw the campaign's session flow.

> **D2 — rule wording:** the rewritten rule states "Every session the tribe spawns starts in the
> target repo, never under `~/.tribe`, and loads only the configuration the owner's own `claude` loads
> there. Sessions hand over through notes (state files), never through configuration." No new guard on
> `closing`; its repo-write trust equals the executor's (F1/F2).

> **D5 — fence amendment for G8.** The executor path's cwd, settings tiers and grants stay
> untouched; adding ledger recording (the executor row and a `SubagentStart` hook) to it is in scope.

> **D6 — W3 idea stays out of scope; the `fu-supervisor-settings` closing pass is a separate card
> after this ships.**

Scope fence (card, and the Shaman's dispatch): grants unchanged (R1, R2, `JUDGMENT_ALLOWED_TOOLS`,
`CLOSING_ALLOWED_TOOLS`, `permissionMode: 'default'`); the executor's `cwd`, settings tiers and
grants unchanged; the containment root of `ruling`/`ratify` stays the campaign folder, only `cwd`
moves; #171's guards, their tests and `rule-session-cwd-config-restored` are removed/rewritten; out:
the W3 idea, the closing 60-turn cap, the restart-ignores-staged-cards gap, the
`fu-supervisor-settings` closing pass.

---

## 2. The problem, grounded in code (master `daf4f9c`)

Paths below are relative to `plugins/tribe/scripts/`.

- `runner/core/supervisor/session.ts:121` — `cwd: config.homeDir` for all three one-shot kinds, so
  the campaign home is each session's settings root (`project`/`local` tiers, memory files, project
  skills, `.mcp.json`) **and** its write root.
- #171 answered that with two layers, all of which exist only because of line 121:
  - layer 1 — `runner/core/supervisor/permit.ts:104-105` (the `isHomeConfigSurface` clause of
    `decideContainmentHook`), `permit.ts` `buildHomeConfigWriteHook` wired at `session.ts:165`,
    `HOME_CONFIG_DENIED_REASON` at `permit.ts:46`;
  - layer 2 — `session.ts:319` (`snapshotHomeConfig` before the spawn) and `session.ts:332-334`
    (`restoreHomeAfterSession`), backed by `runner/adapters/home-config.adapter.ts` and wired at
    `runner/cli/main.ts:860-861`;
  - the predicate `runner/core/supervisor/home-config.ts`, its tests, the real-session E2E
    `home-config.e2e.test.ts`, its guard test `home-config.e2e-guard.test.ts`, the rule
    `.c3/rules/rule-session-cwd-config-restored.md` and its eval binding.
- `session.ts:147` and `:178` hand the repo to `closing`/`ruling` as `additionalDirectories`,
  because the repo is not their `cwd`.
- The executor already runs in the repo root: `runner/core/session.ts:208` `cwd: config.repoRoot`.
- The ledger (`runner/core/supervisor/loop.ts:1103`) is written **once, after** a one-shot session
  ends, only by the supervisor, only for one-shots. A session that times out is recorded with
  `sessionId: null` (`session.ts` `raceWallClock`), and a session whose supervisor dies mid-run is
  never recorded at all (MEASURED below: 2 of the 5 real supervisor sessions of
  `fu-supervisor-settings` are unattributable from the ledger).
- The viewer badges a session only from `campaign-state.json` card `sessionId`s
  (`viewer/core/badge.ts:121`) and reads exactly two files per campaign (`viewer/README.md:149`);
  supervisor sessions are attributed today only by their transcript **folder** name, which contains
  the campaign slug because their `cwd` is the campaign home.

---

## 3. Measurements made during planning (MEASURED)

### 3.1 M1 — what a `SubagentStart` hook really receives (G8 design input)

A real Haiku session (`/tmp/sir-exp/g8c.ts`, Appendix A) with programmatic agents `outer` (tools
`[Agent]`) and `inner`, `permissionMode: 'bypassPermissions'` (the executor's), hooks on
`SubagentStart`, `SubagentStop`, `PreToolUse`. The main thread ran `outer`; `outer` ran a
depth-2 subagent. The two `SubagentStart` payloads, verbatim:

```json
{"session_id":"7a9983f8-f69d-467e-ab7b-77613387cd2b","transcript_path":"/Users/hiep/.claude/projects/-private-tmp-sir-exp-g8cwd/7a9983f8-f69d-467e-ab7b-77613387cd2b.jsonl","cwd":"/private/tmp/sir-exp/g8cwd","prompt_id":"f062cca1-8e71-494e-afcc-79539d7f5166","agent_id":"acc78d12a304f3a1d","agent_type":"outer","hook_event_name":"SubagentStart"}
{"session_id":"7a9983f8-f69d-467e-ab7b-77613387cd2b","transcript_path":"/Users/hiep/.claude/projects/-private-tmp-sir-exp-g8cwd/7a9983f8-f69d-467e-ab7b-77613387cd2b.jsonl","cwd":"/private/tmp/sir-exp/g8cwd","prompt_id":"f062cca1-8e71-494e-afcc-79539d7f5166","agent_id":"ad7f0fbe91c5e9133","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```

Findings:

1. `session_id` is the **root** session's id at every depth; `agent_id`/`agent_type` are the **new**
   subagent's. The depth-2 payload carries **no parent agent id and no `tool_use_id`**: the
   `BaseHookInput.agent_id` of the spawning context is overwritten by the event's own `agent_id`.
   The hook callback's second argument is a random UUID (`cbb6ea89-…`), not the Agent tool-use id.
2. The on-disk `subagents/agent-<id>.meta.json` does carry the parent
   (`"parentAgentId":"acc78d12a304f3a1d","spawnDepth":2`) — but it is **absent** when
   `SubagentStart` fires (checked from inside the hook: `META@HOOK: ABSENT` for both).
3. The SDK **message stream** carries everything, in order:
   - the assistant message holding the `Agent` `tool_use` block, whose `parent_tool_use_id` is the
     tool-use id of the subagent that issued it (`null` on the main thread);
   - then `{"type":"system","subtype":"task_started","task_id":<agent id>,"tool_use_id":<that Agent
     call>,"subagent_type":…,"spawn_depth":…,"task_type":"local_agent"}`.
   So `parent(task) = caller === null ? rootSessionId : agentIdOf(caller)`. Run over the captured
   stream it yields `ab1b0abc8ab4adca7 outer depth 1 parent <root>` and
   `a1ffb9a81990abbda general-purpose depth 2 parent ab1b0abc8ab4adca7` — identical to the
   `parentAgentId` in `meta.json`.
4. Validated against real history: in the executor logs of `fu-supervisor-settings`
   (`runs/*/logs/<card>-<session>.log`, the runner's own copy of the stream), the set of
   `task_started`/`local_agent` `task_id`s is **byte-identical** to the set of
   `subagents/agent-*.meta.json` on disk: 16/16 for `39a316ee…`, 18/18 for `b3bf06c3…`. The stream
   also carries `task_type: "local_bash"` tasks (`owned_by_subagent: true`), which are not sessions
   and must be filtered out.

**How-ruling (mine):** spawn rows for subagents are derived from the executor's message stream, not
from a `SubagentStart` hook. D5 permits the hook; it does not require it, and the hook cannot supply
the parent edge G8 demands at depth ≥ 2. The stream is already consumed by
`runner/core/session.ts` `consumeSession`, so no new hook, no new SDK option, no change to the
executor's `cwd`, tiers or grants.

### 3.2 M2 — the new envelope: `cwd` = repo, campaign home NOT in `additionalDirectories`

`/tmp/sir-exp/g2.ts` (Appendix A): a temp git repo as `cwd`, a temp campaign home planted with
`.claude/settings.json` + `settings.local.json` hook blocks (touching markers at `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `Stop`), `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`,
`escalations/AGENTS.md`, `.claude/skills/zebra/SKILL.md`, `.mcp.json`; the ruling envelope
(`settingSources: ['user','project','local']`, `permissionMode: 'default'`, the judgment tool lists).
The session reads `<home>/answers.md` and `<home>/escalations/card-1.md`, then `Edit`s
`<home>/answers.md`.

| Variant | Markers | `.mcp.json` server | zebra skill registered | codeword in transcript | Edit to `<home>/answers.md` |
|---|---|---|---|---|---|
| no `additionalDirectories` | `[]` | not started | no | no (`CODEWORD=none`) | landed |
| `additionalDirectories: [home]` | `[]` | not started | **yes** | **yes** | landed |

Design consequences: (a) the home must **never** be in `additionalDirectories` — it loads the
home's `.claude/skills` and leaks planted text into the context; (b) it is not needed: an
allowlisted `Write`/`Edit` lands outside `cwd` under `permissionMode: 'default'`.

### 3.3 M3 — `closing` still writes the home from the repo `cwd`

`/tmp/sir-exp/closing.ts`: closing envelope, `cwd` = temp repo, no `additionalDirectories`: a
`Bash` `mkdir -p <home>/supervisor/verdicts`, a `Bash` `printf … > <home>/supervisor/verdicts/card-1.json`
and a `Write` of `<home>/supervisor/final-report.md` all landed (`verdicts: true, final: true`).

### 3.4 M4 — a G3 probe that does not read first proves nothing

`/tmp/sir-exp/g3-probe.ts` on master: a real `ruling` session told to `Write` an existing
`<repo>/CLAUDE.md` and `<repo>/.claude/settings.local.json` was refused by **the Write tool's own
read-before-write check** (`File has not been read yet`), not by the containment hook —
`permission_denials: []`. With "Read each file first", both writes were refused by the hook
(`PreToolUse:Write hook error: Writes are confined to the campaign home …`), both appear in
`permission_denials`, both files byte-identical. G3's check therefore requires the prompt to read
first and asserts the hook's reason text, not merely "file unchanged".

### 3.5 M5 — Haiku cannot land a ruling in the verified format

The master baseline `supervise` run (§5 G7) used Haiku for the one-shots: both ruling sessions
wrote `**Ratified as:** operational` instead of `ratified-as:`, `verifyRuling` failed them, the run
parked `ruling_failed`. Pre-existing and out of scope; the owner run (§7) uses Sonnet for the
supervisor's own sessions.

---

## 4. The design

### 4.1 One-shot envelope (`runner/core/supervisor/session.ts` `buildOneShotOptions`)

- `cwd: config.repoRoot` for all three kinds. `OneShotSessionConfig.repoRoot` becomes **required**
  (today optional; `ratify` never received it). `homeDir` stays: it is the containment root, the
  log directory and the ledger's home.
- `additionalDirectories` is **removed** from every kind: the repo is now `cwd`; the home must
  never be added (M2).
- Unchanged, byte-for-byte: `settingSources`, `permissionMode`, `JUDGMENT_ALLOWED_TOOLS`,
  `JUDGMENT_DISALLOWED_TOOLS`, `CLOSING_ALLOWED_TOOLS`, `CLOSING_DISALLOWED_TOOLS`, `plugins`,
  `maxTurns`, the grant hook (`decideClosingGrantHook`), the scan wall.
- `ruling`/`ratify` keep `buildContainmentHook(config.homeDir, …)` — the root stays the campaign
  folder, so a write into the repo is still denied (G3). `closing` loses
  `buildHomeConfigWriteHook`.
- Read access note: `ratify` now reads the repo by `cwd`. Its `Read` was never restricted
  (`decideContainmentHook` allows `Read`/`Grep`/`Glob` anywhere), so no capability changes.

### 4.2 What is deleted (G4)

`home-config.ts`, `home-config.test.ts`, `adapters/home-config.adapter.ts`, its test,
`home-config.e2e.test.ts`, `home-config.e2e-guard.test.ts` (1,070 lines, MEASURED);
`isHomeConfigSurface`'s clause and `HOME_CONFIG_DENIED_REASON` in `permit.ts`;
`buildHomeConfigWriteHook`; `snapshotHomeConfig`/`restoreHomeConfig` on `OneShotSessionSeam` and
their wiring in `cli/main.ts`; `restoreHomeAfterSession`; the `home_config_restored` log line; the
rule `rule-session-cwd-config-restored` and its eval binding (through the C3 CLI). The re-pointed
carry-over E2E (§6) replaces `home-config.e2e.test.ts` with a new file that imports none of it.
Historical documents (`docs/superpowers/**`, `.c3/adr/**`, `.c3/changes/**`) and
`.tribe/harness-gaps.jsonl` are history and are not edited.

### 4.3 The closing brief gains one line (G7)

`closing` now starts inside the owner's own checkout, with `Bash`. D2 adds no guard; the brief
(`runner/core/supervisor/brief-closing.md`, "Role and authority") gains one sentence: "Your working
directory is the owner's own checkout of the target repo: never switch its branch, stage, commit
or edit files in it — land any repo change from a separate `git worktree`." G7's real run is what
proves it.

### 4.4 The ledger becomes the campaign's session tree (G8, and G5's data source)

One file, `<home>/supervisor/ledger.jsonl`, append-only. Two row types:

**Spawn row (new)** — appended the moment a session's id is known:

```json
{"at":"2026-09-27T10:00:00.000Z","event":"spawn","kind":"executor","sessionId":"b3bf06c3-…","parentSessionId":null,"rootSessionId":"b3bf06c3-…","agentType":null,"cardId":"owner-run-probe","resumed":false}
{"at":"2026-09-27T10:03:12.000Z","event":"spawn","kind":"subagent","sessionId":"ab1b0abc8ab4adca7","parentSessionId":"b3bf06c3-…","rootSessionId":"b3bf06c3-…","agentType":"hunter","cardId":"owner-run-probe"}
{"at":"2026-09-27T10:40:00.000Z","event":"spawn","kind":"ruling","sessionId":"6cd0db64-…","parentSessionId":null,"rootSessionId":"6cd0db64-…","agentType":null,"cardId":"owner-run-probe"}
```

- `kind`: `executor` | `ruling` | `ratify` | `closing` | `subagent`.
- `sessionId`: the session's own id — the SDK `session_id` for a root, the agent id (`task_id`) for
  a subagent.
- `parentSessionId`: `null` for a root (an executor or supervisor session is started by a process,
  not a session); for a subagent, the root's id at depth 1 or the spawning subagent's agent id at
  depth ≥ 2 (M1 item 3). When the spawning call was never seen in the stream, the row carries
  `parentSessionId: null` **and** `parentUnresolved: true` — never a guess.
- `rootSessionId`: the top-level session whose transcript folder holds the subagent
  (`<projects>/<dir>/<rootSessionId>/subagents/agent-<sessionId>.jsonl`).
- `resumed: true` on an executor row written by a resumed session (same id, second row).

**End row (existing `LedgerEntry`)** — unchanged fields, plus `event: "end"`. Legacy rows without
`event` are read as end rows.

**Writers** — each through the existing `appendLog(path, line)` seam, never a new effect:

- executor: `runner/core/session.ts` `consumeSession` appends the executor row on `system/init`
  (right after `io.onSessionStart`) and one subagent row per `task_started`/`local_agent` message.
  `RunSessionConfig` gains `ledgerPath`, set by `core/loop/card-actions.ts` `sessionConfigFor` from
  `resolved.homeDir` via a new `core/paths.ts` `supervisorLedgerPathOf(homeDir)` (the supervisor's
  `supervisorPathsOf` uses the same helper). Written whether or not a supervisor runs (D4's
  watchdog-only campaigns get the tree too).
- supervisor: `runOneShotSession`'s `consumeOneShot` appends the spawn row on `system/init`;
  `RunOneShotInput` gains `cardId` and `ledgerPath`. The spawn row lands even when the session later
  times out — which closes today's `sessionId: null` gap for attribution. `loop.ts` keeps writing
  the end row.

**Pure core** — new `runner/core/ledger.ts`, no I/O: `rootSpawnRow(...)`,
`emptySpawnTracker(rootSessionId, cardId)`, and `observeSpawns(tracker, message, at) → { tracker,
rows }`, a reducer over one SDK message: an assistant message's `Agent`/`Task` `tool_use` blocks
record `callerOf[toolUseId] = message.parent_tool_use_id ?? null`; a `task_started` with
`task_type === 'local_agent'` records `agentOf[tool_use_id] = task_id` and emits one row whose
parent is `callerOf === null ? root : agentOf[caller]` (or `spawn_depth === 1 → root` when the call
was unseen). The clock value (`at`) arrives as an argument.

**Concurrency** — the runner (executor rows) and the supervisor (one-shot rows) are two processes
appending to one file. Each row is one `appendFileSync` with flag `a` (O_APPEND), well under a page;
POSIX positions each append atomically. The viewer and the comparator skip a malformed line rather
than fail.

### 4.5 The viewer reads the ledger as its third file (G5, card D1)

- `viewer/adapters/campaign.adapter.ts` `readOneCampaign` also reads
  `<campaignDir>/supervisor/ledger.jsonl`: the `supervisor` directory and the file are each
  `resolveContained` against the tribe root before opening (the existing D14 pattern); a file over
  8 MiB is not read (one stderr line, counted in `skippedBadges`); each line is `JSON.parse`d
  separately and a malformed line is dropped. `CampaignScan` gains `ledger: readonly unknown[]`.
- `viewer/core/badge.ts` `buildBadgeIndex` adds one badge per ledger row whose `kind` is `ruling`,
  `ratify` or `closing` and whose `sessionId` passes `^[0-9a-fA-F-]{8,64}$` — used only as a `Map`
  key, never joined into a path. Spawn rows and legacy end rows both count; duplicates
  (same session, same campaign) collapse to one badge. Executor badges still come from
  `campaign-state.json` only (the ledger is not a second source for them).
- `Badge` (`viewer/core/model.ts`) gains `sessionKind: 'card' | 'ruling' | 'ratify' | 'closing'`
  and `cardId` becomes `string | null`. `CampaignBadge.tsx` renders
  `slug · <card, when present> · <cardStatus for a card badge, else the kind> · runner alive|dead`.
- `viewer/README.md`: "exactly two files per campaign" becomes three, naming
  `supervisor/ledger.jsonl`, with its containment and size cap.

### 4.6 The rule (card D2), through the C3 CLI

A new rule `rule-sessions-start-in-target-repo` authored with `c3x add rule`, its Rule section the
D2 sentence verbatim, Golden Example from the landed `buildOneShotOptions` (`cwd: config.repoRoot`,
no `additionalDirectories`) and `core/session.ts:208`; Not This: "add the campaign home to
`additionalDirectories`" (M2), "guard the campaign folder's configuration instead of not loading it"
(#171), "hand work over through a configuration file". The old rule is removed with
`c3x delete rule-session-cwd-config-restored`; `c3-215-tribe`'s rows that cite it or describe the
guards are rewritten through a `c3x change` change-unit. `c3x check` stays `ok: true`.

### 4.7 Pure core, impure edges

| Logic | Where | Pure? | Outside world enters through |
|---|---|---|---|
| envelope per kind | `buildOneShotOptions` | yes | — |
| containment decision | `decideContainmentHook` | yes | `realpath` injected into `buildContainmentHook` |
| spawn rows, parent resolution | `core/ledger.ts` | yes | message and `at` passed in |
| writing a row | `consumeSession`/`consumeOneShot` | edge | the existing `appendLog` seam |
| badges from ledger rows | `viewer/core/badge.ts` | yes | rows already read by the adapter |
| reading the ledger | `viewer/adapters/campaign.adapter.ts` | edge | `fs`, contained, capped |

### 4.8 What does not change (the fence)

Grants and `permissionMode` (§4.1); the executor's `cwd`, tiers, grants and hooks
(`core/session.ts` `buildSessionOptions` — only `consumeSession` gains the ledger append); the
containment root; `answers.md` handling (W3); the closing turn cap; decide rows.

---

## 5. Verification contract

Run by the executor Warchief itself after the last Hunter task (plan "Execution protocol").
Every row names a committed tool or a real run; every output lands under
`docs/superpowers/evidence/2026-09-27-supervisor-sessions-in-repo/` (below: `$EV`). `$S` =
`plugins/tribe/scripts`. Baselines were MEASURED on master `daf4f9c` during planning.

| # | Command / real run (kind) | Output lands in | Pass condition (read the output) | BASELINE measured on master | Empty-implementation test |
|---|---|---|---|---|---|
| G1 | Owner run (§7), then `bun $S/tests/sessions-in-repo/g1-transcript-cwd.ts --home <run home> --repo /Users/hiep/repo/tribe` — reads each `<home>/supervisor/sessions/<id>.log`'s `system/init` `cwd` **and** the first `cwd` of `~/.claude/projects/*/<id>.jsonl` (behaviour: real sessions, real transcripts) | `$EV/g1-transcript-cwd.txt` | one line per supervisor session; every `ruling`, `ratify` and `closing` session present, each with both cwds = `/Users/hiep/repo/tribe`; last line `G1 <n>/<n>`, n ≥ 3, all three kinds listed. G1 reads only each session's `system/init` `cwd`, which exists from the session's first message: a `closing` that later fails (turn cap, verify failure) still counts for G1, and its failure is reported separately in `$EV/README.md`, never hidden | `fu-supervisor-settings`: **0/5** (all five `cwd` = `~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings`); planning run `sir-baseline-master`: **0/2** ruling sessions in the repo | Leaving `session.ts:121` alone reports every cwd = the campaign home → `G1 0/n` |
| G2 | `cd $S/runner && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/campaign-home-carryover.e2e.test.ts` — four real writer→reader pairs (ruling-Write→ruling, closing-Bash→ruling, closing-Write→closing, closing-Bash nested `escalations/AGENTS.md`→ruling), writer plants into the campaign home, reader runs through `runOneShotSession` with `cwd` = a temp git repo; plus one negative control (behaviour: real sessions) | `$EV/g2-carryover-e2e.txt` | `5 pass, 0 fail`; each pair asserts the plant **landed on disk** (fs check after the writer), zero markers and no codeword after the reader, and the reader's init `cwd` = the fixture repo; the negative control asserts the codeword **is** seen when a reader is started with `cwd` = the home | `home-config.e2e.test.ts` **4 pass / 0 fail** = 0/4 carry-over, with the guards in place | Deleting the guards without moving `cwd` makes pairs load the plant (the negative control proves the probe sees loading); a stub reader that never runs fails the "reader cwd" and "plant landed" assertions |
| G3 | Same file, test `ruling cannot write into the repo`: a real ruling session (cwd = temp repo) told to Read then Write `<repo>/CLAUDE.md` and `<repo>/.claude/settings.local.json` (behaviour: real session) | `$EV/g2-carryover-e2e.txt` (same run) | both paths in `permission_denials`; the transcript carries `Writes are confined to the campaign home`; both files byte-identical to their seeds | **2/2 refused** by the containment hook, files unchanged (planning probe M4, with read-first) | Moving the containment root to `cwd`, or dropping the hook, lets both writes land → the byte-identity assertion fails; a prompt without read-first is refused by the Write tool and would pass vacuously, hence the hook-reason assertion |
| G4 | `bash $S/tests/sessions-in-repo/g4-guard-footprint.sh` (measurement) | `$EV/g4-footprint.txt` | `guard_files_lines=0 identifier_hits=0 old_rule=absent new_rule=present c3_check=ok` | `guard_files_lines=1070 identifier_hits=149 old_rule=present new_rule=absent` | Doing nothing prints 1070 / 149 / present / absent |
| G5 | Owner run (§7); `bun $S/viewer/serve.ts --port 4411` from the branch build, then `bun $S/viewer/tools/badge-probe.ts --base http://127.0.0.1:4411 --slug <slug> --shots $EV/g5 <every supervisor session id from G1>` — real Chrome, `/s/<id>`, reads `.campaign-badge` text and screenshots (visual + behaviour) | `$EV/g5-badges.jsonl`, `$EV/g5/*.png` | every id has a badge whose text contains the slug and its kind (`ruling`/`ratify`/`closing`); last line `G5 <n>/<n>` | `fu-supervisor-settings`: **0/5 badged** (API `badges: []` for all five; attributed only by the project folder name); executor session `b3bf06c3` badged 1/1 | A cwd-only change puts the transcripts in the repo's folder with no badge → `0/n`; historical cross-check: the same tool on `fu-supervisor-settings` must read **3/5** after the change (the three legacy end rows with ids), proving the reader, not only the writer |
| G6 | `cd $S/runner && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/session.e2e.test.ts`; `bash $S/tests/test-supervisor-e2e.sh`; `cd $S/runner && bun test && bunx tsc --noEmit`; `cd $S/viewer && bun test && bunx tsc --noEmit` (behaviour: real sessions + real disk) | `$EV/g6-*.txt` | `7 pass 0 fail`; `40 passed, 0 failed`; runner `0 fail`, tsc exit 0; viewer failures ⊆ the baseline list | **7/7; 40/40**; runner **1466 pass / 12 skip / 0 fail**, tsc 0; viewer **872 pass / 3 skip / 8 fail** (pre-existing: `e2e/served-build.e2e.test.ts`, `e2e/url-refusals.e2e.test.ts` home-hash asserts) and **21 tsc errors** (pre-existing, DOM lib in `e2e/visual-contract.e2e.test.ts`, `e2e/visual-parity.ts`) | Not applicable as a ratchet (a regression row); it guards the other rows' changes |
| G7 | Owner run (§7): `owner-run.sh` snapshots `/Users/hiep/repo/tribe` (`branch --show-current`, `rev-parse HEAD`, `status --porcelain`) before and after (behaviour: real run) | `$EV/g7-main-before.txt`, `$EV/g7-main-after.txt`, `$EV/g7-verdict.txt` | same branch; porcelain identical (both empty); `HEAD` before is an ancestor of `HEAD` after (a fast-forward is allowed, nothing else) | planning run `sir-baseline-master` (master code, two real ruling sessions against the main checkout): **unchanged** (`master`, `daf4f9c`, porcelain empty before and after) | A closing session that checks out a branch in its new `cwd` changes the branch line → fail; doing nothing still requires the run to have happened, because the verdict file is written only by the run |
| G8 | Owner run (§7), then (a) `bun $S/tests/sessions-in-repo/g8-ledger-tree.ts --home <run home> --projects ~/.claude/projects` compares ledger rows with truth from disk: roots from `<home>/runs/*/logs/<card>-<id>.log` and `<home>/supervisor/sessions/<id>.log`, subagents and their parents from `<projects>/*/<root>/subagents/agent-*.meta.json` (`parentAgentId`, else the root); (b) `claude -p --model claude-haiku-4-5-20251001 --tools ""` given **only** the ledger's text outputs `ROOT <id>` / `EDGE <child> <parent>` lines; (c) the same tool scores that output with `--llm <file>` (behaviour: real run + real LLM) | `$EV/g8-ledger.jsonl`, `$EV/g8-llm-tree.txt`, `$EV/g8-compare.json` | `ledger.sessionsPresent == truth.sessions`, `ledger.edgesCorrect == truth.edges`, `ledger.extra == 0`; and the same three for `llm`; truth has ≥ 1 executor, ≥ 1 subagent, ≥ 3 supervisor sessions | `fu-supervisor-settings`: truth **41 sessions** (2 executor, 5 supervisor, 34 subagents) and **34 edges**; ledger **3/41 present** (4 rows, one `sessionId: null`), **0/34 edges**; Haiku given only that ledger listed 3 sessions and answered "the ledger does not contain parent-child relationship information" (`/tmp/sir-exp/llm/g8-master-llm.txt`) | A ledger without spawn rows scores 3/41, 0/34; a writer that records ids but no parents scores `edgesCorrect = 0` |

### 5.1 Pre-existing failures (REFUTED in advance, not fixed here)

Viewer `bun test` 8 failures in `e2e/served-build.e2e.test.ts` and `e2e/url-refusals.e2e.test.ts`
(a home-hash assertion, reproduced on untouched master) and 21 `tsc` errors in
`e2e/visual-contract.e2e.test.ts`/`e2e/visual-parity.ts`. Playwright's own Chromium is not
installed on this host (`~/Library/Caches/ms-playwright` absent), so `badge-probe.ts` launches the
system Google Chrome by `executablePath`.

---

## 6. Testing strategy

- **Acceptance first (plan Task 4):** `core/supervisor/campaign-home-carryover.e2e.test.ts`
  (G2, G3, negative control), opt-in `RUN_SESSION_E2E=1`, Haiku, every session through
  `runOneShotSession` + the real `sdkSpawnSession`, `cwd` = a temp git repo (never the owner's
  checkout, so test transcripts do not land in the owner's project folder), home = a temp dir under
  `tmpdir()`, both removed in `finally`. RED on base (reader `cwd` is the home; Write plants are
  refused by layer 1; Bash plants are undone by layer 2), GREEN once Tasks 5–7 land.
- `session.e2e.test.ts` (G6) is re-pointed: the R1 host allow rule moves from
  `<home>/.claude/settings.local.json` (no longer a loaded tier) to
  `<fixture repo>/.claude/settings.local.json` (the `cwd`'s local tier), so the test still proves
  "a loaded allow rule cannot widen `closing`".
- Unit: `session.test.ts` (envelope per kind, spawn row on init, no snapshot/restore),
  `permit.test.ts` (containment table without the surface clause; repo `CLAUDE.md` and
  `.claude/settings.local.json` denied), `core/ledger.test.ts` (the real depth-2 fixture from M1,
  a `local_bash` task, an unseen caller), `core/session.test.ts` (executor rows via a fake
  `SessionIO`), `loop.test.ts` (end row carries `event: "end"`), viewer `badge.test.ts`,
  `campaign.adapter.test.ts` (third file: contained, capped, malformed line dropped, symlink
  escape refused), client `list.test.tsx`/`CampaignBadge`.
- `fixtures-mirror-reality.md`: the owner run is the empty-tree/real-caller check — a campaign home
  built from nothing by `owner-run.sh`, the runner invoked exactly as a person invokes it, against
  the owner's real checkout. `owner-run.sh --dry-run` is itself tested on an empty `HOME`.

## 7. The owner run (one run, four goals)

`plugins/tribe/scripts/tests/sessions-in-repo/owner-run.sh` (plan Task 16), run once by the
executor Warchief after every Hunter task, from the branch's runner code, against the owner's main
checkout.

**Why three verbs.** The executor Warchief that runs this card is capped at 600 s per `Bash` call
(`runner/core/brief-template.md`, "Session liveness"), and the runner denies
`run_in_background: true` (`runner/core/session.ts:72-92`, `decideBackgroundingHook`). The owner run
(an executor card, a PR, CI, a ruling, a ratify and a closing) lasts far longer than 600 s. So the
script is split into three verbs, each of which returns well inside one call:

1. **`owner-run.sh start [--repo <path>] [--evidence <dir>] [--dry-run]`**
   - Preconditions: `--repo` (default `/Users/hiep/repo/tribe`) is clean (`status --porcelain`
     empty) and on its default branch; otherwise exit 2 with one line. A dirty checkout would fail
     every ruling anyway (`verifyRuling` `repo_touched`).
   - Builds a campaign home from nothing under the real tribe home:
     `campaigns/sir-owner-run-<UTC stamp>/`, with `campaign-state.json` holding one staged card
     `owner-run-probe` (spec and plan = `docs/superpowers/plans/2026-09-27-owner-run-probe.md`,
     landed on master with this docs PR). `answers.md` is pre-seeded with one ruling `R0` whose
     `ratified-as:` is `pending` (the owner may write `answers.md`, W3), so the run needs a `ratify`
     session.
   - Writes G7 "before" (`branch --show-current`, `rev-parse HEAD`, `status --porcelain`) to
     `<ev>/g7-main-before.txt` and records the home path in `<ev>/owner-run.home`.
   - Launches `supervise` **detached**, with the same double-fork the orchestrate-campaign skill
     uses for its own supervisor launch (`plugins/tribe/skills/orchestrate-campaign/SKILL.md`, Stage
     C): `( nohup env -u ANTHROPIC_API_KEY bun <branch>/plugins/tribe/scripts/runner/run.ts supervise --repo <repo> --home <home> --model sonnet --watchdog-model sonnet --session-timeout-seconds 1800 --session-max-turns 150 --max-spawns 6 </dev/null ><home>/supervisor/launch.log 2>&1 & )`.
     This form is not `run_in_background`: the process is re-parented away from the session and
     outlives it by design. `start` prints `HOME_DIR=<home>` and returns immediately.
   - `--dry-run` builds the home and runs the runner's own `--dry-run`, but launches nothing.
2. **`owner-run.sh wait [--evidence <dir>] [--max-seconds N]`** (default and ceiling 540)
   - A bounded foreground poll of `<home>/supervisor/status.json` every 10 s. It prints
     `terminal <exitCode> <reason>` and exits 0 as soon as `terminal` is non-null. It prints
     `running <state> <lastAction>` and exits 0 when the budget runs out first. Missing or
     unparseable status is reported as `running starting`.
   - The Warchief re-invokes `wait` until it prints `terminal`.
3. **`owner-run.sh collect [--evidence <dir>]`**
   - Writes G7 "after" and `<ev>/g7-verdict.txt`.
   - Runs the G1 tool; serves the branch-built viewer on port 4411 and badge-probes every
     supervisor session id G1 listed.
   - Copies the ledger and asks Haiku for the tree from the ledger alone. Runs the G8 comparator
     against both.
   - Prints `G1 …`, `G5 …`, `G7 …`, `G8 …`, plus `supervise exit <code> <reason>` from the
     terminal status.
   - Each step is bounded: the Haiku call and the browser probe take seconds to a few minutes.

**Expected flow of the detached run.** The runner starts the executor (a Warchief) for
`owner-run-probe`. The probe plan's first step returns `NEEDS_DIRECTION` (a naming question, not
owner-only), so the supervisor starts a `ruling`. The runner then resumes the card with the ruling:
one Hunter subagent appends one line to `docs/tribe/owner-runs.md`, one Tracker runs at `final`,
then gap-gate, PR and merge. The runner exits `rulings_unratified` (because of R0), which starts a
`ratify`. The runner then exits `done`, which starts `closing` (`verify-shipped` on the probe PR, the
final report). The supervisor exits 0.

**`--session-max-turns 150` is a run parameter, not a code change.** `closing` hit the default
60-turn cap on both `fu-supervisor-settings` runs (issue #173, harness gap 1; the fix for the cap
itself stays out of scope). G1 needs only each supervisor session's `system/init` `cwd`, so a
`closing` that still fails yields G1 evidence. Its failure, and any park, is reported in the
evidence README next to the four goals.

**Cost and by-product.** Cost: one Sonnet executor card (a one-line docs PR), three Sonnet one-shot
sessions and one Haiku call, single-digit dollars. By-product, by the Q1 ruling (§10): one real
merged PR on master per owner run, appending one dated line to `docs/tribe/owner-runs.md`.

## 8. Risks and rollback

- **The closing session in the owner's checkout** (G7): mitigated by the brief line (§4.3) and
  proven by the owner run; residual trust is D2's accepted F1/F2 exposure.
- **Two writers on one ledger file**: O_APPEND single-line writes; readers skip malformed lines.
- **Runner writes under `<home>/supervisor/`**: the supervisor's own write-surface test
  (`loop.test.ts` `assertWriteSurface`) is about the supervisor process only; the runner gains one
  write target, `supervisor/ledger.jsonl`, documented in the runner README.
- **SDK stream shape drift** (`task_started` fields): `core/ledger.ts` reads four fields
  defensively; an unrecognised message emits no row; G8's comparator catches a silent loss.
- **Rollback**: revert the one merge commit; no persisted data changes shape except additive
  ledger rows, which older code ignores (the only reader, `renderNeedsOwner`, embeds lines as
  text).

## 9. Follow-ups discovered (not this card)

1. Haiku lands rulings as `**Ratified as:**`, which `verifyRuling` rejects (M5): the ruling brief
   could show the exact line to write.
2. The viewer's 8 pre-existing test failures and 21 `tsc` errors (§5.1).
3. `SubagentStart` does not expose the parent agent (M1) — worth an upstream report; this card does
   not depend on it.

## 10. Questions — all ruled

- **Q1 — RULED (a), Shaman, 2026-09-27.** Each owner run merges one real one-line PR on master that
  appends to `docs/tribe/owner-runs.md`, which becomes a dated log of owner runs. This keeps "G1,
  G5, G7 and G8 read off ONE run": `closing` only runs once every card has shipped, and G8 needs an
  executor with subagents in the same run. The rejected alternative split the evidence across two
  runs.

No open What/Why question remains.

---

## Appendix A — planning probes (uncommitted, in `/tmp/sir-exp/`)

- `g8.ts`, `g8b.ts`, `g8c.ts` — M1: `SubagentStart`/`PreToolUse`/`SubagentStop` payloads, meta
  presence at hook time, raw stream capture (`depth2-stream.fixture.jsonl`, copied into the plan's
  Task 8 fixture).
- `g2.ts none|home` — M2.
- `closing.ts` — M3.
- `g3-probe.ts` — M4 / G3 baseline, through master's `runOneShotSession`.
- `g5-probe.ts` — G5 baseline in system Chrome; screenshots `g5-*.png`.
- `g7/run.sh` — the master `supervise` baseline (`sir-baseline-master`, parked `ruling_failed`).
- `llm/g8-master-llm.txt` — G8 LLM baseline over `fu-supervisor-settings`'s ledger.
- `baseline/*.txt` — G2, G6 and unit/tsc baselines.
