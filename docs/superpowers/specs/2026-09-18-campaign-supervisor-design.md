# Spec — Campaign supervisor: judgment without a babysitter

**Card:** `campaign-supervisor` · **Source:** owner directive 2026-09-18 + issue #142 · **Date:** 2026-09-18
**Author:** planning Warchief (How). The What/Why is the card, ratified by the owner on 2026-09-18
(four decisions); nothing here reopens it.
**Status:** contract for the implementation card. Its plan is
`docs/superpowers/plans/2026-09-18-campaign-supervisor.md`.
**Builds on:** ADR `adr-20260904-mechanical-heartbeat-supersedes-p14` (the L1 watchdog).
**Followed by:** card `campaign-patrol` (out of this fence; §16 states how this design stays open to it).

---

## 1. Problem, grounded

### 1.1 What a campaign costs today

An `orchestrate-campaign` run needs an interactive Shaman session held open for its whole life.
That session's only irreplaceable work is judgment: ruling on an escalation, ratifying a ruling,
composing the closing report. Everything else is waiting — and waiting, in a session, is billed
at full context.

The card's measured evidence is session `6a8a8fe4-f716-43f2-936f-0da47662d9d9` (campaign
`viewer-consolidation`, ~24 h, `claude-opus-5`). **Re-measured for this spec** by an
implementation of the card's own classification oracle, run over the real transcript
(§19 records the method and the deltas):

| Fact | Card's table | Measured (this spec) |
| --- | --- | --- |
| Model turns (deduped by `message.id`) | 168 | **174** |
| Cache-read tokens | 24.9M | **26,469,777** |
| Cache-write tokens | 0.93M | **934,272** |
| Output tokens | 100K | **102,960** |
| First-turn context | 41K | **41,693** |
| Last-turn / max context | 254K | **258,795** |
| Turns woken by a Monitor event | 43 turns / 5.7M | **37 turns / 4,512,184** |
| Turns woken by Monitor expiry | 42 turns / 5.5M | **34 turns / 4,201,130** |
| Turns woken by another task-notification | (not in the table) | **23 turns / 4,039,638** |
| Monitor arms / expiries | 10 expiries | **8 arms / 8 expiries** |
| Babysitting share | — | **0.3168** |

Issue #142's session `ba6e93f0-72e4-4e08-9c64-03d7ea6fb917` (`claude-fable-5-1`, 4 days) measures
**154 turns / 28,075,416 cache-read** — reproducing the card's "154 turns, 28.1M" exactly, which is
the evidence that the classifier above is sound and that the session-1 deltas belong to the
throw-away script, not to the oracle. Its babysitting share is **0.5357** and its max context
**307,375**.

Two facts matter more than the totals:

1. **Roughly a third to a half of every token was spent on waiting, not deciding.** In the
   24-hour session only **three** escalations were actually ruled (R16, R18, R22).
2. **Nothing the session remembered was needed by the next decision.** Every decision it made is
   already on disk: `answers.md` rulings `R<n>` with their `ratified-as:` fields, and
   `escalations/<card>.md.resolved-R<n>` archives. Verified on the real campaign home: 22 rulings,
   all carrying `ratified-as:`, and three escalation files, all archived.

### 1.2 The facts a judgment wake-up reacts to are all typed, and all on disk

Every one of these was read off the real campaign home or reproduced in a throwaway home (§19):

| Fact | Where it is, verified |
| --- | --- |
| Why supervision ended | `<home>/watchdog/status.json` → `terminal.{status,reason,exitCode}` |
| Campaign truth | `<home>/campaign-report.json` → `run.reason`, `pending[]`, `cards[].outcome`, `cards[].escalationFile`, `cards[].question`, `stats` |
| The question being escalated | `<home>/escalations/<cardId>.md` → `**Reason:**` line, `## Context`, `## Options` |
| That a ruling happened | `<home>/answers.md` → a `## R<n>` block with a `ratified-as:` value in the frozen vocabulary, parsed by the existing pure `core/rulings.ts` |
| That a ruling was consumed | `<home>/escalations/<cardId>.md.resolved-R<n>` (the file is renamed, never deleted) |
| Which triggers only the owner may rule | `<home>/campaign-state.json` → `ownerOnlyEscalations[]` |
| Which rulings are still unratified | `campaign-report.json` → `run.unratifiedRulings[]` (runner exit 5) |
| Runner liveness | `<home>/runs/<runId>/run.json` (`pid`, `endedAt`) and `<home>/.runner.lock` |

**None of this is prose.** That is the whole reason a zero-token outer loop is possible: the
supervisor never reads an LLM's sentences to decide anything (card Oracle).

### 1.3 Why the watchdog is not already enough

The L1 watchdog (ADR `adr-20260904-…`) already absorbs quota, overload, crash and stall at zero
tokens — and then **exits**, by design (D74-2: "the notification IS this process's exit"). Its
whole contract is to stop when a human must act. Ten of its thirteen terminal reasons mean exactly
that, and today a session is what catches them.

So the gap is not "keep the runner alive" — that is solved. The gap is: **who catches the
watchdog's exit, decides whether judgment is genuinely required, and — when it is — pays for that
one decision only.**

---

## 2. The change (What), in one picture

```
L0 runner       (exists)  executes cards, spawns executor sessions
L1 watchdog     (exists)  keeps L0 alive through quota/overload/crash; exits with a typed reason
L2 supervisor   (NEW)     observe disk -> pure decide -> ONE action -> persist; repeat
```

The supervisor is a **script, not a session**. Its loop spends zero tokens. It spawns a model only
when a typed disk fact says judgment is required, and that model runs as a **one-shot session**: a
brief rendered by pure code from disk, no resumed conversation, no memory carried to the next
decision. The session dies; the supervisor verifies its work **on disk**; the loop continues.

**It layers ON the watchdog.** It does not re-implement quota/overload/crash handling, does not
change `decide()`'s frozen 48-row action table, and does not observe session logs. Its only view of
L1 is `watchdog/status.json`'s `terminal` plus the watchdog child's exit code.

---

## 3. The supervisor's core

### 3.1 Purity split (`pure-core.md`)

| Layer | Module | Contains |
| --- | --- | --- |
| Pure core | `core/supervisor/model.ts` | the vocabulary: observation, action, park reasons, session kinds, limits, status/ledger shapes |
| Pure core | `core/supervisor/decide.ts` | `decide(observation) -> action` — the whole table in §3.4, no clock, no fs, no spawn, no throw |
| Pure core | `core/supervisor/verify.ts` | `verifyPostconditions(kind, diskFacts) -> Verdict` — typed, over already-read content |
| Pure core | `core/supervisor/brief.ts` | `renderBrief(kind, facts) -> string` — deterministic text from disk facts |
| Pure core | `core/supervisor/state.ts` | the persisted decision state: parse, apply an outcome, serialize |
| Pure core | `core/supervisor/args.ts` | CLI parsing, `--campaign`→home path math, containment |
| Pure core | `core/supervisor/status.ts` | status/event/ledger shaping and exit-code mapping |
| Pure core | `core/supervisor/loop.ts` | observe→decide→perform→persist, impure **by injection only** |
| Seam | `ports/ports.ts` | `SupervisorIO` (additive), composed from the existing capability ports |
| Edge | `adapters/supervisor-io.adapter.ts` | fs, clock, spawn of the watchdog child, `tribe-home.sh` |
| Edge | `adapters/session.adapter.ts` | **unchanged** — still the only SDK import |
| Root | `cli/main.ts` | one additive `if (argv[0] === 'supervise')` block, mirroring `watchdog` |

`structure.test.ts` enforces all of it mechanically — no new discipline to invent.

`plugins/tribe/scripts/runner/core/types.ts` and `core/state.ts` are untouched: the supervisor's
vocabulary lives in `core/supervisor/model.ts`, exactly as the watchdog's lives in
`core/watchdog/model.ts` and for the same reason.

### 3.2 The observation (pure input)

Everything the decision needs, read once per tick by the edge and handed in as data:

```ts
interface SupervisorObservation {
  nowMs: number;
  stopFilePresent: boolean;               // <home>/STOP
  needsOwnerPresent: boolean;             // <home>/NEEDS_OWNER.md from an earlier park
  supervisorLock: { pid: number; alive: boolean } | null;
  watchdogLive: { pid: number; alive: boolean } | null;   // status.json terminal===null && pid alive
  lastWatchdog: {
    terminal: { status: string; reason: string; exitCode: number } | null;
    ownedExitCode: number | null;         // the child's real exit when this invocation spawned it
  } | null;
  report: CampaignReportFacts | null;     // parsed campaign-report.json, typed fields only
  escalations: EscalationFact[];          // one per card the report marks escalated
  ownerOnlyEscalations: string[];         // campaign-state.json
  unratifiedRulings: string[];            // report.run.unratifiedRulings
  parkMarkers: ParkMarker[];              // <home>/supervisor/park/*.json written by a session
  state: SupervisorState;                 // the supervisor's own persisted counters
  limits: SupervisorLimits;
}

interface EscalationFact {
  cardId: string;
  filePresent: boolean;                   // escalations/<cardId>.md still there == unanswered
  contentSha256: string;                  // the repeat-escalation breaker's key
  reason: string;                         // the file's own **Reason:** value, verbatim
  autoAnswerRounds: number;               // from the report (see §7 — advisory only)
}
```

`EscalationFact.reason` is a **typed field read off a fixed template line**, not prose
interpretation: `core/report.ts` already proves that line's shape is machine-readable
(`extractQuestionDigest`), and the runner writes it from a closed vocabulary
(`planning_needed`, `needs_direction`, …).

### 3.3 The action (pure output) — exactly one per tick

```ts
type SupervisorAction =
  | { kind: 'run_watchdog'; cards: string[] | null; includeEscalated: boolean }
  | { kind: 'await_watchdog'; pid: number }                      // adopt a live one, never a second
  | { kind: 'spawn_session'; session: SessionKind; cardId: string | null }
  | { kind: 'archive_escalation'; cardId: string; rulingId: string }
  | { kind: 'park'; reason: ParkReason; detail: string }         // writes NEEDS_OWNER.md, then exits
  | { kind: 'exit'; status: 'done'; reason: string };

type SessionKind = 'ruling' | 'ratify' | 'closing';
```

### 3.4 The decision table (frozen)

Rows are evaluated **top to bottom; the first match wins**. Every row is keyed on typed disk facts
only. `R` = the supervisor's own per-card ruling-round count (§7).

**Pre-loop rows — evaluated once, before any watchdog is run:**

| # | Condition | Action |
| --- | --- | --- |
| P1 | `supervisorLock` held by a LIVE pid that is not us | `exit`-equivalent refusal, exit code `21` (§10) — never a second supervisor |
| P2 | `needsOwnerPresent` | `park(resume_blocked)` → exit `20`. An unresolved park is never silently resumed |
| P3 | `stopFilePresent` | `exit(done, "stop_requested")` |
| P4 | `watchdogLive` | `await_watchdog(pid)` — adopt (D74-7, one layer up); never spawn a second |

**Main rows — keyed on the watchdog's terminal reason:**

| # | `terminal.reason` | Additional disk state | Action |
| --- | --- | --- | --- |
| 1 | `runner_done` | closing session already verified (state) | `exit(done, "campaign_closed")` → exit `0` |
| 2 | `runner_done` | `unratifiedRulings` non-empty | `spawn_session(ratify)` |
| 3 | `runner_done` | otherwise | `spawn_session(closing)` |
| 4 | `stop_requested` | — | `exit(done, "stop_requested")` → exit `0` |
| 5 | `escalations_pending` | a ruling landed but its escalation file is still present | `archive_escalation(card, R<n>)` |
| 6 | `escalations_pending` | every escalated card has been answered this round | `run_watchdog(cards = answered + not_reached, includeEscalated = false)` |
| 7 | `escalations_pending` | the next unanswered card carries a park marker | `park(marker.kind)` |
| 8 | `escalations_pending` | its `reason` is on `ownerOnlyEscalations` | `park(owner_only)` |
| 9 | `escalations_pending` | its `contentSha256` was already seen after a ruling | `park(repeat_escalation)` |
| 10 | `escalations_pending` | `R(card) >= maxRulingRounds` | `park(w7_cap)` |
| 11 | `escalations_pending` | total spawns `>= maxSpawns` | `park(spawn_cap)` |
| 12 | `escalations_pending` | otherwise | `spawn_session(ruling, card)` |
| 13 | `rulings_unratified` | `ratifyRounds >= maxRatifyRounds` | `park(ratify_cap)` |
| 14 | `rulings_unratified` | total spawns `>= maxSpawns` | `park(spawn_cap)` |
| 15 | `rulings_unratified` | otherwise | `spawn_session(ratify)` |
| 16 | `session_incomplete` | `watchdogRuns < maxWatchdogRuns` and `retriggers(session_incomplete) < 1` | `run_watchdog(same scope)` — a fresh watchdog resets its own crash budget |
| 17 | `session_incomplete` | otherwise | `park(session_incomplete)` |
| 18 | `quota_cap` | — | `park(quota_cap)` |
| 19 | `overloaded` | — | `park(overloaded)` |
| 20 | `stalled` | — | `park(stalled)` |
| 21 | `lock_conflict` | — | `park(lock_conflict)` |
| 22 | `error` | — | `park(error)` |
| 23 | `runner_alive`, `quota_wait_pending`, `overload_backoff_pending`, `launched`, `relaunched` | — | `park(unexpected_running)` — these are `--once` reasons; the supervisor only ever runs `--follow`, so observing one means a contract violation. Fail closed, never guess |
| 24 | `terminal === null` and the watchdog child exited | `watchdogRuns < maxWatchdogRuns` and this is the first time | `run_watchdog(same scope)` — one bounded retry |
| 25 | `terminal === null` | otherwise | `park(watchdog_no_terminal)` |
| 26 | watchdog child exit code `1` (usage) | — | `park(watchdog_usage)` |
| 27 | no watchdog has run yet this invocation | — | `run_watchdog(null, false)` |
| 28 | `watchdogRuns >= maxWatchdogRuns` | — | `park(watchdog_run_cap)` |

**Oracle direction, restated as a rule the table obeys (card Oracle):** every row whose facts do
not *positively* establish that a session is required resolves to `park`. Rows 7-11, 13-14, 17-26
are all parks. Spawning when none was needed is the bug; parking when a session could have ruled is
by design.

**Never in this table:** anything derived from the text of a model's answer, from a session's
`result` line, from a report's prose `question` digest, or from a log file's contents.

---

## 4. Tick, persist, resume — how G4 is proved

**G4 — `kill -9` at any instant, including mid-ruling-session, followed by a manual restart, loses
nothing and never double-rules one escalation.**

### 4.1 The invariant

> Every action is **either** idempotent **or** guarded by a disk fact that the action itself
> creates. Nothing is remembered in memory across a tick.

### 4.2 The tick

```
1. acquire/reclaim <home>/supervisor/.supervisor.lock        (atomic create; a dead pid is reclaimed)
2. observe()   — read every fact in §3.2 fresh from disk
3. decide()    — pure; one action
4. record the INTENT in events.jsonl (append, fsync-ordered before the effect)
5. perform()   — carry out exactly that action
6. persist()   — rewrite state.json atomically (temp + rename), append to ledger.jsonl
7. publish()   — rewrite status.json atomically
8. goto 2
```

Step 4 before step 5 is what makes a crash diagnosable: `events.jsonl` always shows the last
*intended* action, and `state.json` shows only what actually completed.

### 4.3 Why each action survives `kill -9`

| Action | Crash window | Why nothing is lost or doubled |
| --- | --- | --- |
| `run_watchdog` | child spawned, supervisor dies | The watchdog is a detached child with its own lock; it keeps supervising. On restart, row P4 sees it live and **adopts** it. The runner is never double-launched (D74-7). |
| `spawn_session(ruling)` — before any write | nothing on disk changed | Restart re-observes the same escalation, `R(card)` unchanged, and spawns again. One wasted spawn, never a double ruling. |
| `spawn_session(ruling)` — session wrote the ruling, supervisor died | `answers.md` has `R<n>`, escalation file still present | Restart observes the ruling (row 5) and **archives** rather than re-ruling. The ruling itself is the guard. |
| `spawn_session(ruling)` — session died mid-write | `answers.md` has a partial/unratified block | `core/rulings.ts` classifies it unratified → row 15 spawns a **ratify** session, which repairs it. Never a second ruling on the same question. |
| `archive_escalation` | rename is atomic | A rename of an already-renamed file is detected as "already archived" and skipped. |
| `park` | `NEEDS_OWNER.md` written, then death | Restart hits row P2 and refuses to resume — the owner's decision is not bypassed by a restart. |
| `spawn_session(closing)` | report written, supervisor died | Restart sees the closing postcondition satisfied in `state.json` **or**, if that write was lost, re-verifies from disk (`final-report.md` exists, `unratifiedRulings` empty) and exits `done` without re-spawning. |

**The one thing that is NOT idempotent is a model spawn**, and that is precisely why the guard is
always a disk fact the *session* creates (a ruling block, a park marker), never a fact the
*supervisor* remembers. `R(card)` is incremented **before** the spawn, not after, so a crash can
only ever *over*-count a round — which fails closed into a park.

---

## 5. The one-shot sessions

Three kinds. All three share one machinery: render a brief by pure code → spawn through the
existing `SessionIO` seam → stream to a per-session log → verify **typed disk postconditions** →
write one ledger line → let the session die.

### 5.1 Common envelope

| Property | Value | Why |
| --- | --- | --- |
| `model` | `state.supervisor.model`, fixed in campaign config before the run | Guardrail 8; recorded per spawn in the ledger |
| `cwd` | **the campaign home** | §14 — this is what makes the transcript attributable in the viewer with no viewer change at all |
| `settingSources` | `[]` | The campaign home is not a repo; no project settings to load. The repo's governance reaches the brief as **quoted text**, not as ambient config |
| `resume` | never set | G3: every session starts from a rendered brief, never a resumed conversation |
| `abortController` + wall-clock timeout | `--session-timeout-seconds`, default **1800** | `fail-closed-edges` obligation 3 |
| `maxTurns` | `--session-max-turns`, default **60** | A bounded budget; exceeding it is a failed attempt, not a hang |
| `permissionMode` | `'default'` | **Not** `bypassPermissions`. Least privilege (decision 4) |
| `disallowedTools` | `Bash`, `Task`, `Agent`, `WebFetch`, `WebSearch`, `Monitor`, `ScheduleWakeup` | No shell, no subagents, no network, and no wait-tool (a one-shot session that arms a Monitor dies before the notification arrives — the same wall `core/session.ts` already holds for executors) |
| `hooks.PreToolUse` | the containment hook below | Enforcement, not prose |

**The containment hook** (pure, in `core/supervisor/permit.ts`, tested as a table): a `Write`/`Edit`
whose resolved target is not inside the campaign home is **denied** with a typed reason. This is
`fail-closed-edges` obligation 4 applied at the permission layer, and it is what makes decision 4's
"may write only under the campaign home" mechanically true rather than merely briefed.

Verified by experiment (§19.2): a session spawned through `query()` with
`permissionMode: 'default'`, `allowedTools: []` and an explicit `disallowedTools` list runs to a
clean `result` without hanging on a permission prompt, and its `result` message carries
`usage.{input_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens}`,
`total_cost_usd` and `permission_denials` — so the G5 ledger needs no transcript parsing.

### 5.2 `ruling`

**Fires when:** row 12 — a card is escalated, its reason is not owner-only, `R(card) < 2`, the
content is new, and the spawn budget allows it.

**Tools:** `Read`, `Grep`, `Glob`, `Write`, `Edit`. Read access to the target repo is granted via
`additionalDirectories: [repoRoot]` so the session can read the card's spec and plan; **writes to
the repo are denied by the hook** (decision 4: the repo is read-only for a ruling session).

**Rendered brief contains, in this order** (every item pure-rendered from disk; `brief-contracts.md`
shape):

1. **Role and authority.** "You are ruling with Shaman authority on ONE escalation. You never
   contact the owner. You never write code."
2. **The oracle.** "The escalation file below is the question. `answers.md` is the only place a
   ruling lives. Under-ruling (parking something you could have answered) is by design;
   ruling on an owner-only trigger is a bug."
3. **The escalation file, verbatim** (`escalations/<cardId>.md`).
4. **The owner-only list, verbatim** from `campaign-state.json` `ownerOnlyEscalations`.
5. **Governing quotes, verbatim with their source** — `SKILL.md` §"Walls this skill exists to
   hold" W3 and W7, and Stage C step 1's owner-only paragraph. Quoted, never paraphrased
   (`brief-contracts.md` obligation 3).
6. **The existing ruling ids** (the `## ` headings already in `answers.md`) so the session picks
   the next `R<n>` without guessing, plus the frozen `ratified-as:` vocabulary.
7. **The card's spec and plan paths** (from `campaign-state.json`), for context.
8. **The adjudication rule** — what is REFUTED in advance: "this question is hard" is not a reason
   to park if it is within Shaman authority; a scope clarification is `operational`.
9. **The two exits, exactly.** Either append a ruling, or write a park marker. Nothing else.

**Postconditions, checked on disk, in this order:**

| Check | How |
| --- | --- |
| A new `## ` block exists in `answers.md` that was not there before | set difference of `parseRulings()` ids, before vs after |
| Its `ratified-as:` value is in the frozen vocabulary | `isRulingRatified()` — the existing pure function, reused |
| The target repo is untouched | `git -C <repo> status --porcelain` compared before/after; any change is a **failed ruling** (decision 4) |

**OR** a typed park marker at `<home>/supervisor/park/<cardId>.json`. **Neither** → failed attempt:
**one** bounded retry with the same brief, then `park(ruling_failed)` (guardrail 2).

On success the supervisor — not the session — performs `archive_escalation` (§5.5).

### 5.3 `ratify`

**Fires when:** rows 2/15 — `campaign-report.json` says `rulings_unratified` and names the ids.

**Tools:** `Read`, `Grep`, `Glob`, `Write`, `Edit`, scoped to the campaign home. No repo access at
all: ratifying is a bookkeeping judgment over `answers.md`.

**Brief contains:** the unratified ruling ids verbatim from `run.unratifiedRulings`, each ruling's
own block verbatim from `answers.md`, the frozen `ratified-as:` vocabulary with what each value
means, the `SKILL.md` Stage D ratification-pass paragraph verbatim, and the rule that a durable
convention may not stay as prose. The two exits: repair every `ratified-as:`, or write a park
marker naming the ids it cannot rule on.

**Postcondition:** `unratifiedRulingIds(answers.md)` is empty — computed by the existing pure
`core/rulings.ts`, over the file the session just wrote. Partial progress (some ids cleared) is a
failed attempt, not a success; one bounded retry, then `park(ratify_failed)`.

### 5.4 `closing`

**Fires when:** row 3 — the runner reached `done` and no ruling is unratified.

**Tools:** the full Claude Code set **including `Bash`** and repo write. This session legitimately
needs them: it runs `verify-shipped` per card and lands the closing governance PR (decision 4
names this exception explicitly). The containment hook is **not** applied; `settingSources` is
`['project']` and `cwd` is the campaign home with `additionalDirectories: [repoRoot]`.

**Brief contains:** `SKILL.md` Stage D verbatim (all four numbered steps), the final
`campaign-report.json` verbatim, every `answers.md` ruling id with its `ratified-as:` value, the
campaign's `<base-home>/reports/<card>-gap-gate.json` `open_ids` per card, and the instruction to
write the owner-facing report to `<home>/supervisor/final-report.md`.

**Postconditions:** `<home>/supervisor/final-report.md` exists and is non-empty, **and**
`unratifiedRulingIds(answers.md)` is still empty. One bounded retry, then `park(closing_failed)`.

`maxClosingAttempts` is **1** (plus the one retry): a closing session that cannot close is exactly
the case a human should see.

### 5.5 Who archives the escalation file

**The supervisor does, after verifying the ruling — not the session.**

The card's guardrail 2 describes the postcondition as "a new `R<n>` with a `ratified-as:` field AND
the escalation file archived". This spec splits those: the **session** produces the ruling (that is
judgment, W3), and the **supervisor** performs the rename (that is bookkeeping). Three reasons,
recorded here because it is a deliberate deviation (§20, amendment A1):

1. **Least privilege.** Renaming a file needs `Bash`. Giving a judgment session a shell — even
   behind a command allowlist — is a far larger trust surface than giving it none. Shell
   allowlists are routinely escaped by a second command on the same line.
2. **Crash-safety.** If the session owns both writes, a crash between them leaves an ambiguous
   state. With the supervisor owning the rename, the sequence is strictly ordered and every
   prefix of it is recoverable (§4.3, row 3).
3. **W3 is untouched.** W3 governs `answers.md` — "written only by you (a session) or the owner".
   `answers.md` is still written only by the session. The escalation archive is not `answers.md`.

The observable end state is identical to the card's: a ratified `R<n>` **and**
`escalations/<cardId>.md.resolved-R<n>` on disk before the campaign is re-triggered.

---

## 6. The typed park-marker vocabulary

Two audiences, two vocabularies. Both are closed sets; neither is free text.

### 6.1 What a SESSION may write (`<home>/supervisor/park/<cardId>.json`)

```json
{ "v": 1, "kind": "owner_only", "cardId": "c1", "trigger": "data-shape-change", "note": "one line" }
```

`kind` is exactly one of:

| `kind` | Means |
| --- | --- |
| `owner_only` | The question's trigger is on `ownerOnlyEscalations`, or is one of the register's four classes. `trigger` names it |
| `too_hard` | Within Shaman authority in principle, but the session judged it genuinely undecidable on the facts it was given |

`note` is recorded and relayed; it is **never** parsed and never influences a decision. An
unrecognised `kind`, a malformed file, or an unreadable one is treated as `too_hard` **and** counted
as a malformed-marker event — fail closed, never crash.

### 6.2 What the SUPERVISOR may write (the `ParkReason` union, into `NEEDS_OWNER.md`)

`owner_only` · `too_hard` · `w7_cap` · `ratify_cap` · `spawn_cap` · `watchdog_run_cap` ·
`repeat_escalation` · `ruling_failed` · `ratify_failed` · `closing_failed` · `session_incomplete` ·
`quota_cap` · `overloaded` · `stalled` · `lock_conflict` · `error` · `unexpected_running` ·
`watchdog_no_terminal` · `watchdog_usage` · `resume_blocked`

Twenty values, each produced by exactly one row of §3.4's table, each mapping to one sentence of
`NEEDS_OWNER.md`. **Decision authority:** the card gives the Shaman the ruling on this vocabulary;
§20 amendment A2 submits it for ratification.

---

## 7. W7, made mechanical

The card's guardrail 3 says the cap "today lives in an LLM's memory". **It is worse than that, and
this is a verified card-vs-code discrepancy** (§21, D1):

`Card.autoAnswerRounds` exists in the schema, is reported by `core/report.ts`, and is *deleted* by
`resetCard` — but **no code path in the runner ever increments it**. Verified by exhaustive grep
over `core/`, `ports/`, `cli/`, `adapters/`, and corroborated on the real `viewer-consolidation`
campaign home: three ruling rounds were performed (R16, R18, R22) and the card entry carries no
`autoAnswerRounds` key at all.

So W7 has **no mechanical basis today in either place**. Consequently:

- The supervisor keeps its **own** counter, `state.rulingRounds[cardId]`, in
  `<home>/supervisor/state.json`, incremented **before** each `ruling` spawn.
- `maxRulingRounds` defaults to **2**, matching W7 verbatim ("At most 2 auto-answer rounds per
  card"). Row 10 refuses the third and parks. This is the guardrail's test.
- `EscalationFact.autoAnswerRounds` (from the report) is carried into the observation and into
  `NEEDS_OWNER.md` for the owner's information, but **no row of §3.4 reads it** — it is not
  trustworthy as a count.
- The supervisor does **not** write `campaign-state.json` to fix this. Teaching the runner to
  increment `autoAnswerRounds` is a runner-core change, out of this fence — recorded as follow-up
  **FU-CS-1**.

---

## 8. Budgets and circuit breakers (guardrail 4)

Every one is a flag with a concrete default, bounded and validated at the edge the way
`core/watchdog/args.ts` already validates its own.

| Flag | Default | Bounds | What it stops |
| --- | --- | --- | --- |
| `--max-ruling-rounds` | `2` | 0-10 | W7: a third ruling attempt on one card |
| `--max-ratify-rounds` | `2` | 0-10 | A ratify loop that never converges |
| `--max-spawns` | `8` | 0-100 | Total one-shot sessions this campaign. 2 rounds × 2 cards + 2 ratify + 1 closing + 1 retry ≈ 8 |
| `--max-watchdog-runs` | `20` | 1-500 | An outer loop that re-triggers forever |
| `--session-timeout-seconds` | `1800` | 60-21600 | A hung session |
| `--session-max-turns` | `60` | 1-500 | A session that talks instead of deciding |
| `--session-retries` | `1` | 0-3 | Guardrail 2's "one bounded retry, then park" |
| `--poll-seconds` | `30` | 1-60 | The wake-up slice while adopting a live watchdog (same cap and reason as the watchdog's own) |

**The repeat-escalation breaker** is not a count but a content check (guardrail 4, final clause):
`state.seenEscalations[cardId]` holds the sha256 of every escalation body this supervisor has
already had ruled. If a card re-escalates with a body whose hash is already in that set, row 9
parks — the ruling did not land, and a second identical attempt would be the runaway. A *different*
body is a genuinely new question and is allowed (subject to `maxRulingRounds`).

---

## 9. Single instance; adopt, never duplicate

D74-7 verbatim, applied one layer up:

> "adopt, never duplicate: a live runner at start is attached, never double-launched"

| Layer | Mechanism |
| --- | --- |
| Supervisor vs supervisor | `<home>/supervisor/.supervisor.lock` = `{pid, startedAt}`. A **live** holder → refuse, exit `21`, one typed line. A **dead** holder → reclaim (the same `isProcessAlive` probe the runner's lock already uses). Never two supervisors on one home |
| Supervisor vs watchdog | Row P4: if `watchdog/status.json` has `terminal === null` and its `pid` is alive, the supervisor **awaits** that watchdog (bounded `--poll-seconds` slices) instead of spawning one |
| Watchdog vs runner | Inherited unchanged. The supervisor never touches `.runner.lock` and never spawns the runner directly — only `run.ts watchdog`, which already adopts |

The supervisor **never kills** anything: not a runner, not a watchdog, not a session. A session's
only bound is its own `abortController` (which the SDK owns), exactly as `core/session.ts` already
does.

---

## 10. The CLI surface

```sh
bun plugins/tribe/scripts/runner/run.ts supervise \
  --repo <target-repo> --campaign <campaign-slug> --model <shaman-model> \
  [budget flags from §8] [--watchdog-model <tier>]
```

**Subcommand name:** `supervise` (the noun `supervisor` names the layer; the verb names the command,
matching `watchdog`'s and `reset-card`'s existing style).

**The campaign-naming flag (ratified decision 2).** The owner types `--campaign <slug>`, never a
hand-built home path. The home is derived as
`"$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<slug>"` — by **executing
`tribe-home.sh`**, which stays the only thing that knows the `~/.tribe` key derivation (wall W1).
That execution is an adapter concern (`supervisor-io.adapter.ts`); `core/` never spells `.tribe`.
`--home` is accepted as an **alternative** to `--campaign` (mutually exclusive, one required), for
the tests and for a home that does not follow the convention — the same containment refusal the
watchdog already applies then guards it.

`--model` is the Shaman model for one-shot sessions (guardrail 8). `--watchdog-model` is the
executor tier handed to `run.ts watchdog --model`; it defaults to the campaign's own configured
value only if one exists, otherwise it is **required** — no environment-specific value is ever
guessed (wall W1).

**Exit codes.**

| Code | Meaning |
| --- | --- |
| `0` | The campaign closed: the closing session ran and its postconditions verified — or `STOP` was honoured |
| `1` | Usage error (bad/missing/unknown flag, a `--home`/`--campaign` that fails containment or has no `campaign-state.json`) |
| `20` | `needs_owner` — `NEEDS_OWNER.md` was written; the reason is in it and in `supervisor/status.json` |
| `21` | `supervisor_running` — a live supervisor already holds this campaign's lock; this process refused and wrote nothing |

`20` and `21` are chosen to sit clear of the runner's `0/1/2/3/5` and the watchdog's `0/1/10/11`.
`0` and `1` deliberately keep the meanings they already have in **both** existing CLIs
("succeeded" and "you typed it wrong"); aligning them is the opposite of a collision, and a caller
that must distinguish layers reads `supervisor/status.json`, never a shared exit code.

**Stdout:** one human line per action, plus a final `status: <path>` line — the watchdog's contract,
unchanged, so the same `until` wake-up loop works on both.

---

## 11. On-disk layout

```
<home>/supervisor/
  .supervisor.lock          {pid, startedAt}
  status.json               current state; terminal===null while running (the doorbell's wake-up signal)
  events.jsonl              append-only, one JSON line per intended action, ISO `at`
  ledger.jsonl              G5: one line per spawn
  state.json                the persisted decision state (rounds, spawn count, seen hashes)
  briefs/<kind>-<n>.md      the rendered brief, verbatim — evidence that the brief was mechanical
  sessions/<sessionId>.log  the streamed SDK messages for that spawn
  park/<cardId>.json        typed park markers written BY a one-shot session
  final-report.md           written by the closing session
<home>/NEEDS_OWNER.md       the owner-facing park artifact
<home>/escalations/<card>.md.resolved-R<n>   renamed by the supervisor after a verified ruling
```

**The supervisor's complete write surface is those three locations and nothing else** —
`<home>/supervisor/**`, `<home>/NEEDS_OWNER.md`, and the escalation *rename*. It never writes
`answers.md` (W3), never writes `campaign-state.json`, never writes under `<home>/watchdog/` or
`<home>/runs/`. A test asserts exactly this set, the way the watchdog's own W-P9 test does.

`NEEDS_OWNER.md` sits at the home root rather than under `supervisor/` because it is the owner's
interface, and the doorbell relays it by path. That is the one deliberate departure from the
watchdog's "writes only under its own directory" symmetry, taken for discoverability.

### `ledger.jsonl` — the G5 record

One line per spawn, every field a typed disk or SDK fact:

```json
{"at":"2026-09-18T15:00:00Z","kind":"ruling","cardId":"c1","sessionId":"c46501a8-…",
 "model":"claude-haiku-4-5","startedAt":"…","endedAt":"…",
 "usage":{"input_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":18323,"output_tokens":59},
 "costUsd":0.0031,"permissionDenials":0,"verdict":"ruled","rulingId":"R7","round":1}
```

`verdict` is one of `ruled` · `ratified` · `closed` · `parked` · `failed` · `timeout`, decided by
the **postcondition check on disk**, never by the session's own words. `usage` and `costUsd` come
straight off the SDK's `result` message (proven present in §19.2).

### `NEEDS_OWNER.md` — the format

```markdown
# Campaign needs the owner: <campaign-slug>

**Park reason:** <one of the 20 ParkReason values>
**At:** <ISO>          **Supervisor exit:** 20
**Campaign home:** <abs path>

## What happened
<one rendered sentence per park reason — from a frozen table, never free text>

## The question (when a card is parked)
<the escalation file's own **Reason:** line and ## Context section, verbatim>

## What I already did
- Ruling rounds used: <card> <n>/<max>   · Spawns used: <n>/<max>
- Rulings landed this run: <R ids>
- Watchdog runs: <n>; last terminal reason: <reason>

## What unblocks it
<one rendered instruction per park reason, from the same frozen table — e.g. for `owner_only`:
 "Append a ruling to <home>/answers.md tagged R<n+1> with a `ratified-as:` value, archive
  <home>/escalations/<card>.md to .resolved-R<n+1>, delete this file, then re-run: <the exact
  supervise command>">

## Ledger
<the ledger.jsonl lines for this run, verbatim>
```

Deleting `NEEDS_OWNER.md` is the owner's explicit "I have handled it" signal — row P2 refuses to
resume while it exists, so the file is a latch, not a notice.

---

## 12. The doorbell session (optional, decision 3)

A procedure documented in `SKILL.md`, **not code**. The owner opens a small session that:

1. Starts the supervisor **detached**, with the same double-fork one-liner Stage B already uses and
   `test-watchdog-detached.sh` already proves (there is no `setsid` on this machine).
2. Blocks on the supervisor's own status file — the identical `until` loop Stage B arms on the
   watchdog's:

   ```sh
   until [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"] is not None)' \
     "<campaign-home>/supervisor/status.json" 2>/dev/null)" = "True" ]; do sleep 60; done
   ```

3. On wake: reads `NEEDS_OWNER.md` (or `supervisor/final-report.md`) and relays it verbatim.

**The doorbell never rules.** It never writes `answers.md`, never writes a park marker, never arms
a Monitor on campaign files. Its entire cost is bounded to one start plus one wake (the card's
adjudication rule accepts this cost in advance). **The supervisor behaves identically with no
session at all** — `NEEDS_OWNER.md` plus the exit code are the truth; the doorbell is a convenience.

---

## 13. `supervisor/status.json`

Deliberately shaped like `watchdog/status.json` so one reader serves both:

```json
{ "v": 1, "pid": 0, "home": "", "campaign": "", "startedAt": "", "updatedAt": "",
  "state": "observing|running_watchdog|awaiting_watchdog|session_ruling|session_ratify|session_closing|terminal",
  "lastAction": "", "watchdog": { "pid": null, "lastTerminalReason": null }, "currentSession": null,
  "counters": { "watchdogRuns": 0, "spawns": 0, "rulingRounds": {}, "ratifyRounds": 0, "failures": 0 },
  "terminal": { "status": "done|needs_owner", "reason": "", "exitCode": 0 } }
```

`terminal === null` while running is the doorbell's wake-up condition. It is written within 5
seconds of start, before any observation — the same rule the watchdog follows so a wake-up loop
always has something to read.

---

## 14. G6 — a one-shot session, attributable in the consolidated viewer, with no third `~/.tribe` read

### The wall, verbatim (`viewer/README.md` §"On-disk discovery")

> "`adapters/campaign.adapter.ts` is the *only* code that reads `~/.tribe`, and it reads exactly
> two files per campaign — `campaign-state.json` and `run.json` — never a third."

**The wall holds, untouched, and no viewer code changes.** Here is why.

### The mechanism

The viewer's primary surface is not badges — it is **every transcript on the machine**, discovered
by walking `~/.claude/projects` two levels deep (§"On-disk discovery" steps 1-2). A session's
project directory is decided by its `cwd`.

**Measured** (§19.2): a session spawned with
`cwd = <tmp>/fakehome/.tribe/key/campaigns/probe` landed its transcript at

```
~/.claude/projects/-private-var-folders-…-fakehome--tribe-key-campaigns-probe/<session-id>.jsonl
```

The encoding is: every `/` and every `.` in the absolute `cwd` becomes `-` (hence `/.tribe` →
`--tribe`). Corroborated by this machine's own `-Users-hip-repo-art-web` directory.

So: **spawning every one-shot session with `cwd` = the campaign home puts all of that campaign's
supervision transcripts into one project directory whose name literally contains the campaign slug**
— `…--tribe-<repo-key>-campaigns-<campaign-slug>`. The owner opens the viewer, sees that project in
the sidebar, and watches each ruling/ratify/closing session live inside it. Attribution is the
directory. No badge, no state-file write, no third read, no viewer code.

This also satisfies §5.1's `settingSources: []` choice naturally: the campaign home is not a repo,
so there is no project config to load, and the repo's governance reaches the session as **quoted
text in the brief** — which is what `brief-contracts.md` obligation 3 wants anyway.

### What this does NOT give, and the follow-up

The viewer's `?campaign=<repoKey>/<slug>` filter and the per-session badge chips are built from
`campaign-state.json`'s `cards[*].sessionId` (`viewer/core/badge.ts#buildBadgeIndex`). A supervisor
session is not a card, so it gets **no badge chip** — only its own clearly-named project.

Making it a first-class badge would mean recording the session ids somewhere the adapter already
reads and teaching `core/badge.ts` to index them. Both candidate homes were examined and both are
**rejected for this card**:

| Candidate | Rejected because |
| --- | --- |
| A new top-level `supervisor.sessions[]` in `campaign-state.json` (unknown keys DO survive the runner's round-trip — verified: `looseObject`, and the live `planning` key on the real campaign) | It makes the supervisor a writer of the runner's own state file, and it needs a `badge.ts` change — a viewer change this card's fence excludes |
| A supervisor-written `run.json` under `<home>/runs/<id>/` | **Actively dangerous.** `core/watchdog/select.ts#newestRunId` takes the lexicographic max of every directory under `runs/`, so a supervisor-written record would be read by the watchdog as "the newest run" and corrupt its observation |

Recorded as follow-up **FU-CS-2** (a viewer-side card): index `campaign-state.json`'s
`supervisor.sessions[]` in `badge.ts`, once something writes it. G6 as the card states it — "the
owner watches each one-shot session live in the consolidated viewer, attributable to its campaign" —
is met today by the project-directory mechanism, and the E2E proves it by opening the viewer and
naming the directory.

---

## 15. G0 — the ratchet: the baseline tool and its committed baseline

Lands as **phase 1 of the plan, before any supervisor code**, per the owner directive.

### Surface

```sh
bun plugins/tribe/scripts/runner/run.ts transcript-metrics \
  --session <session-id> [--session <session-id> …] [--project <project-dir-name>] [--json]
```

A subcommand for the same reasons the watchdog is one: no second installable, no second resolver,
and `structure.test.ts` enforces its purity for free. It spawns nothing and reads nothing but
transcript files. **Token-free by construction.**

### The oracle (card §"Measure first", restated as code)

- A **turn** is one distinct `message.id` on a `type: "assistant"` row. De-duplication is
  mandatory, not an optimisation: **measured**, a single trivial 59-output-token session emitted the
  same `message.id` on two consecutive lines, each repeating the full identical `usage` block
  (§19.2). Per-line summing double-counts.
- A turn's **trigger class** is the most recent user-side row that is not a `tool_result` carrier:
  `human` · `monitor-event` · `monitor-expiry` · `task-notification` (other).
- **Sidechain** (`isSidechain === true`) rows are excluded from lead totals and reported separately.
- **Metrics:** turns and input/cache-read/cache-write/output tokens per class; first-turn, last-turn
  and max context (`input + cache_read + cache_creation`); Monitor arms and expiries; wall-clock
  span; **babysitting share** = (monitor-event + monitor-expiry tokens) / total.

### Structural facts the tests are built from (all measured, §19.1)

| Fact | Consequence for the implementation |
| --- | --- |
| One `message.id` spans several lines, `usage` byte-identical on each | Dedupe by id, first occurrence wins |
| `type` is also `attachment`, `ai-title`, `last-prompt`, `queue-operation`, `mode`, `cost-state`, … | Only `type === "user"` sets the trigger class; only `type === "assistant"` is a turn |
| `isSidechain` is present on every `user`/`assistant` row and absent on the others | Absence is not `false`-by-accident; classify on the row types that carry it |
| The assistant key set is **not** fixed (session 2 carries `apiErrorStatus`, `error`, `quotaLimits`; session 1 does not) | Every field optional; missing usage field reads as `0` |
| `<task-notification>` has **two** shapes: one with an `<event>` element, one with `<tool-use-id>`/`<status>` and no `<event>` at all | The no-`<event>` shape is `task-notification` (other). Conflating it with `monitor-event` is what the card's original table did |
| Largest single line measured: **442,691 bytes** | Line-at-a-time streaming; never `readFileSync` the whole transcript (4.6 MB / 1,507 lines for session 1) |
| 0 malformed lines in 2,987 real lines | The malformed-line path still needs its own synthetic fixture |

### `fail-closed-edges` applies (card §"Measure first", final bullet)

The tool reads arbitrary JSONL from outside its control. A line that fails `JSON.parse`, decodes as
invalid UTF-8, or parses to a non-object is **counted and skipped** with a typed note in the output
(`skippedLines`, `skippedReasons`) — never a traceback, never a silent undercount. A missing session
id is a typed refusal naming it. Pure core (classification, sums) over an edge that only reads files.

### The committed baseline

`docs/superpowers/evidence/2026-09-18-supervisor-baseline.json` — **numbers only**: session ids,
counts, token sums, the tool's own version. **Never message text** (card: "Transcripts are
machine-local and private"). A human-readable `.md` twin sits beside it.

### The ratchet assertion

Checked in the real E2E (G1) and usable on any later campaign, over **all** of a supervised
campaign's supervision transcripts (doorbell + every one-shot session):

1. **babysitting share == 0** — no turn is attributed to `monitor-event` or `monitor-expiry`;
2. **no Monitor arm on campaign files** — zero `Monitor` tool_use blocks;
3. **every one-shot session's max context < 258,795** — the measured session-1 last-turn/max context
   (the card says "the baseline's 254K last-turn context is the number to beat, **per decision**").
   The measured figure supersedes the card's rounded one (§21, D2). A ruling session is expected to
   land two orders of magnitude below this; the bound is a ceiling, not a target.

---

## 16. Staying open to `campaign-patrol` (required by the card's adjudication rule)

`campaign-patrol` adds tripwires, patrol sessions and mid-flight directive delivery. It must land
**without redesigning** anything here. Concretely:

| What patrol needs | Why nothing here blocks it |
| --- | --- |
| Tripwire predicates over disk facts | `SupervisorObservation` is an open record. Patrol adds fields (report line counts, commit subjects, watchdog events since the last patrol). No existing field changes shape, so no existing row of §3.4 is touched |
| A tripwire to outrank a terminal reason | §3.4 is already a two-stage table: pre-loop rows (P1-P4) evaluated before the terminal-reason switch. Patrol inserts its tripwire rows as a third stage between them — a **new stage**, not an edit to an existing row |
| A fourth session kind | `SessionKind` is a string union; `'patrol'` extends it. The whole one-shot machinery (§5) is already kind-parameterised: render → spawn → verify typed postconditions → ledger. Patrol supplies a brief renderer and a postcondition checker and reuses everything else |
| New park reasons | `ParkReason` is a union with a frozen `NEEDS_OWNER.md` sentence table (§11). Patrol adds entries to both; no existing entry changes |
| Its own spend class in the ledger | `ledger.jsonl`'s `kind` field already discriminates. Patrol's G4 ("patrol spend reported as its own class") is a `group by kind` over the file this card writes |
| A controlled restart (patrol G3) | The supervisor already owns `run_watchdog` as an action with a `cards` scope. Patrol adds a `restart_executor` action beside it. It does **not** need the supervisor to learn how to kill anything — §9's "never kills" stays true because patrol's restart waits for a clean worktree and stops the session through the runner's own `STOP` mechanism |

The one thing patrol must **not** be forced into: reading a stream of commit events with a model.
Nothing here creates that pressure — every observation is a disk read.

---

## 17. Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Keep the Shaman session open, shorten its Monitor interval | Shrinks the bill, does not remove it. Measured: 32-54% of every token was a wake-up that decided nothing. The owner directive rejects the framing outright |
| Make the supervisor a session that spawns subagents for rulings | The outer loop would still pay per wake-up, and its context would still grow — the exact cost this card removes. A script's loop is free |
| Have the watchdog itself spawn ruling sessions (one layer, not two) | Breaks the card's scope fence ("does not change `decide()`'s frozen action table") and welds a zero-token process to an LLM spawn. The watchdog's whole claim is that it never spawns a model; keeping that true is what makes it auditable |
| Resume one long-lived ruling session across decisions (cheaper cache) | Defeats G3 outright: context would grow across decisions, which is the disease. A rendered brief is the cure, and §1.1 proves nothing needs to be remembered |
| Let the ruling session drive the whole loop (give it Bash and the runner CLI) | That is the babysitter again, wearing a smaller hat: its context grows with every command it runs, and a model deciding *when* to re-trigger is exactly the prose-driven control the Oracle forbids |
| Decide from the session's typed `result` line instead of disk | The Oracle forbids it, and §4.3 shows why it is also fragile: a session that dies after writing `answers.md` but before returning has done the work, and a result-line check would miss it |
| Put the supervisor in its own `scripts/supervisor/` directory | A second dependency tree, a second resolver, and a re-implementation of the purity discipline `structure.test.ts` gives for free inside the runner tree. Same reasoning the watchdog's ADR already recorded |
| launchd/cron driver | Ratified out by the owner (decision 2). The design stays resumable from disk alone so a driver remains possible later without redesign |

---

## 18. Risks

| Risk | Mitigation | Verified by |
| --- | --- | --- |
| The supervisor spawns a session when none was needed (the card's named bug) | Every row that does not positively establish "judgment required" parks. The whole table is a pure function tested row by row | The decision-table test |
| A ruling is applied twice after a crash | The guard is the ruling itself, on disk, not a supervisor memory; `R(card)` increments **before** the spawn so a crash over-counts, never under-counts | The kill tests (mid-wait, mid-ruling, mid-re-trigger) |
| A ruling session writes into the target repo | Denied at the permission layer by the containment hook, **and** independently proven by a `git status --porcelain` before/after comparison that fails the ruling | The least-privilege test + the real E2E |
| A one-shot session hangs | Wall-clock `abortController` timeout + `maxTurns`; every subprocess carries a timeout (`fail-closed-edges` obligation 3) | The session-double E2E |
| Two supervisors on one home | `.supervisor.lock` with a liveness probe; a live holder is refused with exit `21` | The single-instance test |
| The supervisor and the runner both write `campaign-state.json` | The supervisor never writes it at all (§11) | The write-surface test |
| A supervisor record confuses the watchdog | Nothing is ever written under `<home>/runs/` or `<home>/watchdog/` (§14 records why this was a real, rejected design) | The write-surface test |
| A malformed park marker crashes the loop | Unreadable/unrecognised → treated as `too_hard` and counted; narrow catches only, never `except Exception` | The fail-closed table test |
| The campaign's Shaman model is wrong or unavailable | Fixed in config before the run, recorded per spawn in the ledger; a spawn failure is a failed attempt → one retry → park, never a crash | The session-double E2E |
| `answers.md` grows unboundedly across rounds | Out of scope; the brief renders only the ruling **ids** plus the blocks it needs, never the whole file, so session context does not grow with campaign age | G3's replay fixture |

---

## 19. Evidence appendix — commands run and real outputs

All of these were executed by the planning Warchief on 2026-09-18 during plan verification, per
`fixtures-mirror-reality.md` rule 2 ("before writing lifecycle code, run it against an empty
fixture"). Every throwaway directory was deleted afterwards.

### 19.1 Baselines on the planning worktree (`4a6bbdb`)

```
$ cd plugins/tribe/scripts/runner && bun install
107 packages installed [355.00ms]

$ bun test
684 pass · 0 fail · 1697 expect() calls · 26 files

$ bunx tsc --noEmit
(silent, exit 0)

$ C3X_MODE=agent bash <c3-skill>/bin/c3x.sh check
total: 52
ok: true
```

Machine facts: `bun 1.3.14`, `python3 3.9.6`, and **no `timeout`, `gtimeout` or `setsid` binary**
(`command -v` finds none) — bounded waits must be hand-rolled poll loops.

The transcript measurements in §1.1 and the structural facts in §15 come from an implementation of
the card's classification oracle run over the two named transcripts; the session-2 figures
reproduce the card's table exactly, which is the check that the classifier is sound.

### 19.2 The watchdog's real exit codes and artifacts, from an EMPTY home

A throwaway `HOME` under `mktemp -d`, a throwaway git repo, and a campaign home built from nothing
(`campaign-state.json` + an empty `answers.md`, one card whose spec/plan do not exist):

```
$ bun run.ts watchdog --repo <tmp-repo> --model exp-model --home <tmp-home> --once --poll-seconds 1
launch: starting the campaign runner
status: <tmp-home>/watchdog/status.json
exit=11
  status.json: state="terminal", lastAction="exit:running:launched",
               terminal={"status":"running","reason":"launched","exitCode":11},
               runnerPid=13804, runId=null, nextWakeAt=null

$ bun run.ts watchdog --repo <tmp-repo> --model exp-model --home <tmp-home2> --poll-seconds 1
launch: starting the campaign runner
attach: runner pid 14141 is already live — waiting on it
exit: needs_human:escalations_pending
status: <tmp-home2>/watchdog/status.json
exit=10
  status.json: terminal={"status":"needs_human","reason":"escalations_pending","exitCode":10}
  events.jsonl actions: start,launch,attach,exit
```

Artifacts the run produced, i.e. exactly what the supervisor observes:

```
<home>/answers.md
<home>/campaign-report.json          run.reason="escalations_pending", exitCode=2
<home>/campaign-report.md            pending=["E1"], stats={shipped:0,escalated:1,blocked:0,notReached:0}
<home>/campaign-state.json           cards.E1.outcome -> "escalated"
<home>/escalations/E1.md             **Reason:** planning_needed / ## Context / ## Options
<home>/runs/2026-09-18T15-02-29-974Z-548d/run.json
<home>/watchdog/events.jsonl
<home>/watchdog/runner-stdout/attempt-1.log
<home>/watchdog/status.json
```

`campaign-report.json`'s escalated entry, verbatim:

```json
"E1": { "outcome": "escalated", "escalationFile": "escalations/E1.md",
        "question": "planning_needed: Missing on disk: spec, plan", "autoAnswerRounds": 0 }
```

This confirms every fact §3.2's observation depends on, and confirms that a home with an empty
`answers.md` reaches `escalations_pending` rather than the runner's `ENOENT` exit-4 path (the
pre-existing FU-i74-1 shape, still unfixed and still out of fence).

### 19.3 The SDK envelope and where a one-shot transcript lands

A throwaway `query()` call — `model: 'haiku'`, one-line prompt, `settingSources: []`,
`permissionMode: 'default'`, `allowedTools: []`, an explicit `disallowedTools` list, and
`cwd = <tmp>/fakehome/.tribe/key/campaigns/probe`:

```
INIT session_id=c46501a8-fb7f-47c3-88f9-695f627ce3d5
RESULT subtype=success
RESULT text="PROBE_OK"
RESULT usage={"input_tokens":10,"cache_creation_input_tokens":18323,
               "cache_read_input_tokens":0,"output_tokens":59, …,"total_cost_usd":…}
RESULT keys=[type,subtype,is_error,api_error_status,duration_ms,…,session_id,total_cost_usd,
             usage,modelUsage,permission_denials,terminal_reason,uuid]
```

Transcript landed at:

```
~/.claude/projects/-private-var-folders-…-T-tmp-TIMKSZcTB3-fakehome--tribe-key-campaigns-probe/
  c46501a8-fb7f-47c3-88f9-695f627ce3d5.jsonl        (9 lines, 12,782 bytes)
```

Findings that this experiment settles:

1. **`cwd` decides the project directory**, encoded by replacing every `/` and `.` with `-`. This is
   the whole of §14's G6 mechanism.
2. **A restrictive envelope runs headless** — no permission prompt, no hang, clean `result`.
3. **The `result` message carries `usage`, `total_cost_usd` and `permission_denials`**, so the G5
   ledger needs no transcript parsing.
4. **One `message.id` appeared on two consecutive assistant lines** with byte-identical `usage` —
   the de-duplication requirement of §15, reproduced on a 59-token session.
5. Non-message row types (`queue-operation`, `attachment`, `ai-title`, `last-prompt`) carry no
   `isSidechain` and no `message`.

The throwaway project directory and both `mktemp` trees were deleted.

### 19.4 Document gates

`plugins/tribe/scripts/validate-plan.sh` is run against this spec's plan (verdict must be `pass`)
and `check-spec-handoffs.sh` against the spec directory; §20 records their outputs at planning time.

---

## 20. Amendments proposed to the card (for the Shaman)

None changes What or Why. Each is a How-level gap the card's text does not settle, resolved here
and listed so a later reader is not left re-deriving it.

- **A1 — guardrail 2's postcondition splits.** The **session** writes the ruling; the **supervisor**
  archives the escalation file. Reasons in §5.5 (least privilege, crash-safety, W3 untouched). The
  observable end state is the card's, exactly.
- **A2 — the park-marker vocabulary is two closed sets, not one** (§6): two values a session may
  write (`owner_only`, `too_hard`) and twenty the supervisor may write. The card gives the Shaman
  the ruling on this vocabulary.
- **A3 — G0's context bound is the measured 258,795, not the card's rounded 254K** (§15, §21 D2).
- **A4 — W7 has no mechanical basis anywhere today**, so the supervisor owns the counter (§7). The
  runner-side fix is follow-up FU-CS-1, out of fence.
- **A5 — exit codes `20`/`21`**, with `0`/`1` deliberately keeping their shared meanings (§10).
- **A6 — G6 needs no viewer change at all** (§14); the badge-chip enhancement is follow-up FU-CS-2.
- **A7 — `--home` is accepted alongside `--campaign`** (mutually exclusive), for tests and for a
  non-conventional home. The owner-facing path stays `--campaign` exactly as decision 2 requires.

---

## 21. Card-vs-code discrepancies found while grounding

Recorded per the dispatch's oracle: where the card and the code disagree about a **fact**, the code
is right.

- **D1 — `autoAnswerRounds` is never incremented by anything.** The card's guardrail 3 says W7's cap
  "today lives in an LLM's memory"; in fact the field the skill tells a session to read is
  permanently `0`. Verified by grep across the runner source and on the real `viewer-consolidation`
  home (3 ruling rounds, no key). Consequence: §7; follow-up FU-CS-1.
- **D2 — the card's baseline table for session `6a8a8fe4…` is off.** Measured: 174 turns (not 168),
  26.47M cache-read (not 24.9M), 258,795 max context (not 254K), 37/34 monitor turns (not 43/42), 8
  expiries (not 10), plus a 23-turn `task-notification` class the table omits. Session
  `ba6e93f0…` reproduces exactly. Consequence: §1.1, §15's bound, amendment A3.
- **D3 — `<task-notification>` has two structural shapes**, one with an `<event>` element and one
  (background-command completion) without. The card's oracle names four classes, which is right; the
  original script appears to have mis-bucketed the second shape.
- **D4 — the card's L2 sketch omits `session_incomplete` from the park list.** It is a real watchdog
  terminal reason. Resolved as rows 16-17: one bounded re-trigger (a fresh watchdog resets its own
  crash budget), then park.
- **D5 — `stop_requested` is a watchdog terminal reason the card's sketch also omits.** Resolved as
  row 4: `exit(done)`, never a park — the owner asked for the stop.
- **D6 — a supervisor-written `run.json` would corrupt the watchdog**, because
  `newestRunId()` is a lexicographic max over every directory under `runs/`. Recorded in §14 so the
  idea is not re-proposed.

---

## 22. Acceptance — every goal, its proof

| Goal | Evidence the PR must carry | Gate |
| --- | --- | --- |
| **G0** ratchet | The tool, its tests, and the committed baseline JSON for both sessions — landed in phase 1, before any supervisor code | green, baseline committed |
| **G1** no babysitter | One real E2E: a toy campaign built to escalate, Haiku as the Shaman model, reaching `done` with no interactive session open; transcript of the whole run in the evidence file | present, reproducible |
| **G2** tokens only for judgment | The spend ledger shows one line per spawn and nothing else; the supervisor's own loop appears nowhere in any transcript | ledger asserted in the E2E |
| **G3** bounded context | Every spawn's brief is rendered (the `briefs/` directory is the proof) and no session sets `resume`; the `viewer-consolidation` replay fixture (R16, R18, R22 + closing) yields **≤ 5** spawns where the measured session took 174 turns | green, replay asserted |
| **G4** stop/start safe | Kill tests: mid-wait, mid-ruling-session, mid-re-trigger — each followed by a manual restart, each losing nothing and never double-ruling | green, three tests |
| **G5** auditable spend | `<home>/supervisor/events.jsonl` + `ledger.jsonl` with kind, session id, model, start/end, usage, disk-verified verdict | asserted in the E2E |
| **G6** visible in the viewer | The real E2E run watched in the consolidated viewer; before/after screenshots or a transcript listing naming the project directory | present in the evidence file |

---

## 23. Verification steps (what the Shaman runs before merging)

1. `cd plugins/tribe/scripts/runner && bun test` — green, including the pure decision-table test and
   the transcript-metrics tests. `bunx tsc --noEmit` — silent.
2. `bash plugins/tribe/scripts/tests/test-supervisor-e2e.sh` — the session-double E2E from an empty
   home, with the campaign named both the way a person types it and as an absolute path.
3. `bash plugins/tribe/scripts/tests/test-supervisor-kill.sh` — the three G4 kill tests.
4. Replay G0: run `transcript-metrics` on both baseline sessions and diff against the committed
   baseline file — byte-identical.
5. Replay G3: the `viewer-consolidation` replay fixture — ≤ 5 spawns.
6. Read the real-E2E evidence file: the ledger, the `NEEDS_OWNER.md`-free path to `done`, and the
   viewer's project directory naming the campaign.
7. `bash plugins/tribe/scripts/tests/test-fresh-machine.sh` — unmoved.
8. `C3X_MODE=agent bash <c3-skill>/bin/c3x.sh check` — `ok: true`, no new error.
9. Diff ⊆ scope fence; two independent skinner reports; tracker + scout; the ADR and the c3-215
   change-unit documenting the least-privilege permission model (decision 4).

---

## 24. Non-goals

Tripwires, patrol sessions, mid-flight directive delivery (card `campaign-patrol`); launchd/cron;
any viewer redesign; any change to what only the owner may decide; any change to the runner's exit
codes, state schema, or the watchdog's frozen action table; teaching the runner to increment
`autoAnswerRounds` (FU-CS-1); a badge chip for supervisor sessions (FU-CS-2).
