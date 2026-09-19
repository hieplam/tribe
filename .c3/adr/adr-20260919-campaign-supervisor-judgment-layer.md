---
id: adr-20260919-campaign-supervisor-judgment-layer
c3-seal: bafdfbeb9f8b357c8fe807fc982429239b8b9fdd97826a6a1d422a43e3845cab
title: campaign-supervisor-judgment-layer
type: adr
goal: |-
    Authorize the campaign-supervisor card's zero-token L2 judgment loop — the `bun run.ts supervise`
    subcommand's pure `decide()` table over one-shot `ruling`/`ratify`/`closing` sessions, verified by
    disk postconditions rather than a session's own claim — and, per the card's ratified decision 4
    ("This permission model must be documented in C3 via a change-unit on c3-215"), record the
    least-privilege model that governs every judgment session: `permissionMode: 'default'` (never
    `bypassPermissions`), no `Bash`/`Task`/`Agent`/network tools, and a `PreToolUse` containment hook
    as the sole write-enforcement layer, with `closing` as the one named exception that legitimately
    gets the full toolset and lands the governance PR.
status: accepted
date: "2026-09-19"
---

## Goal

Authorize the campaign-supervisor card's zero-token L2 judgment loop — the `bun run.ts supervise`
subcommand's pure `decide()` table over one-shot `ruling`/`ratify`/`closing` sessions, verified by
disk postconditions rather than a session's own claim — and, per the card's ratified decision 4
("This permission model must be documented in C3 via a change-unit on c3-215"), record the
least-privilege model that governs every judgment session: `permissionMode: 'default'` (never
`bypassPermissions`), no `Bash`/`Task`/`Agent`/network tools, and a `PreToolUse` containment hook
as the sole write-enforcement layer, with `closing` as the one named exception that legitimately
gets the full toolset and lands the governance PR.

## Context

`docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md` §1.1 measured what a campaign
costs today: an `orchestrate-campaign` run holds a Shaman session open for its whole life, and that
session's only irreplaceable work is judgment — ruling on an escalation, ratifying a ruling,
composing the closing report. Everything else is waiting, billed at full context. On the card's
own measured evidence (session `6a8a8fe4-…`, `viewer-consolidation`, ~24h, re-measured against the
real transcript), **roughly a third to a half of every token (0.3168-0.5357 babysitting share) was
spent on waiting, not deciding — and in that 24-hour session only three escalations were actually
ruled (R16, R18, R22) across 174 model turns**. §17 records the same finding a second way: shortening
the Monitor interval only shrinks the bill (measured 32-54% of every token was a wake-up that
decided nothing), it does not remove it.

Tasks 1-15 of `docs/superpowers/plans/2026-09-18-campaign-supervisor.md` landed the pure decision
core (`core/supervisor/decide.ts`, `verify.ts`, `brief.ts`, `state.ts`, `status.ts`), the least-
privilege session envelope (`core/supervisor/session.ts`, `permit.ts`), the observe-decide-perform-
persist loop (`loop.ts`), and the `bun run.ts supervise` subcommand (`cli/main.ts`) — with no
corresponding c3-215 fact for any of it. `c3-215`'s Contract table describes `run.ts`'s watchdog and
`transcript-metrics` subcommands but has no row for `supervise`; its Business Flow table's
"Unattended path" row still describes the pre-supervisor shape (an orchestrator holding escalations
open, re-triggering capped rounds); its Change Safety table has a row for `core/supervisor/**`'s
decision table (added by `adr-20260919-supervisor-core-change-safety`, task 11) but none naming the
least-privilege write model decision 4 requires. Per `plugins/tribe/rules/brief-contracts.md`,
"governance work belongs at the end of each phase, not the end of the project" — Phase 3 (wiring +
permission model) is the phase that built this surface, so the reconciliation happens here.

## Decision

Author `adr-20260919-campaign-supervisor-judgment-layer` and, under its change-unit, land three
scoped patches against `c3-215`:

1. **Contract — insert** the `supervise` subcommand as a new row, describing its flags
(`--repo`/`--model` required no default; `--campaign` XOR `--home`, exactly one required;
`--watchdog-model`, `--max-ruling-rounds`, `--max-ratify-rounds`, `--max-spawns`,
`--max-watchdog-runs`, `--session-timeout-seconds`, `--session-max-turns`, `--session-retries`,
`--poll-seconds`, every unknown flag rejected by name), its exit codes (0 done, 1 usage error,
20 needs_owner, 21 already_running), and its write surface (`<home>/supervisor/state.json`,
`<home>/supervisor/ledger.jsonl`, `<home>/supervisor/events.jsonl`, `<home>/supervisor/status.json`,
`<home>/supervisor/park/<cardId>.json`, `<home>/supervisor/sessions/<sessionId>.log`,
`<home>/supervisor/final-report.md`, `<home>/supervisor/.supervisor.lock`, plus
`<home>/NEEDS_OWNER.md` and the escalation-file archive rename — never `answers.md`,
`campaign-state.json`, or anything under `<home>/watchdog/` or `<home>/runs/`, S-P5) — a live
holder is adopted, never double-launched.
2. **Business Flow — re-author** the "Unattended path" row: judgment is no longer a held-open
session re-triggering capped rounds; it is a zero-token loop (`decide()`, S-P1/S-P2: first-match-
wins over the frozen table, park is the default) that spawns a one-shot `ruling`/`ratify`/
`closing` session only when a typed disk fact positively establishes judgment is required
(S-P3), verifies its work against disk postconditions rather than the session's own `result`
text, and dies — no session is ever held open across decisions.
3. **Change Safety — insert** the decision-4 row: a `ruling`/`ratify` session may write only under
the campaign home. Facts, verified against `core/supervisor/permit.ts`, `session.ts`, and
`loop.ts`:
All three one-shot kinds run under `permissionMode: 'default'` — never `bypassPermissions`
(that stays `core/session.ts`'s executor envelope; decision 4 draws the trust line at the
executor, not a judgment session).

`ruling`/`ratify` sessions carry `allowedTools: [Read, Grep, Glob, Write, Edit]` and
`disallowedTools: [Bash, Task, Agent, WebFetch, WebSearch, Monitor, ScheduleWakeup]` — no
shell, no subagents, no network, no wait-tool.

**The `PreToolUse` containment hook (`buildContainmentHook`/`decideContainmentHook`, pure
`containPath`) is the ONLY write-enforcement layer (S-P12).** Measured (spec §19.4): with the
hook removed, the identical envelope wrote to the repo, to `/tmp`, and through a symlink out of
the home. `permissionMode: 'default'` confines nothing on its own; `additionalDirectories` is a
READ convenience, never a write boundary. A `Write`/`Edit` whose resolved target is not inside
the campaign home is DENIED — over-denying by design, one escaped write is the defect —
symlink escapes resolved via injected `realpath` (deepest existing ancestor), containment
decided by path SEGMENT, never string prefix (`<home>-sibling` must deny).

`ruling` gets repo READ access via `additionalDirectories: [repoRoot]` (to read the card's
spec/plan); `ratify` gets NO repo access at all — it is bookkeeping over `answers.md` only.

`closing` is the **named exception**: the full Claude Code toolset including `Bash` and repo
write, `settingSources: ['project']`, and **no containment hook** — it legitimately lands the
governance PR (spec §5.4).

The supervisor independently proves the target repo untouched before/after a ruling
(`git -C <repo> status --porcelain`, compared); any change is a failed ruling regardless of
what the hook allowed or denied — the genuine second layer, catching a write the hook let
through.

`autoAnswerRounds` from the report is carried for the owner's information only; no decision
row reads it (S-P8) — documented as vestigial, follow-up `FU-CS-1`.

This wins over silence (leaving the permission model as prose in the spec only) because the card's
own ratified decision 4 names C3 as where it must live, in a phase-3 change-unit, not the spec.
It wins over folding the model into the existing `adr-20260919-supervisor-core-change-safety`
change-unit because that folder's own row already sealed and applied against a different, narrower
scope (the decision table); adding a new fact set is a fresh authored decision, not an edit to an
applied one.

**Consequences.** W7 (bounding runaway auto-answer rounds) becomes mechanical: the supervisor's own
`state.json` counters gate `ruling`/`ratify` spawns, never a model's judgment about whether to keep
going; `autoAnswerRounds` is formally recorded as vestigial (`FU-CS-1`) rather than silently unused.
A reader of `c3-215` can now see the `supervise` surface, its write boundary, its exit codes, and the
exact enforcement layer for decision 4's least-privilege promise — without reading the spec. Any
future change to `core/supervisor/permit.ts`'s containment table is now a Change-Safety-governed
edit: the row this ADR adds names the risk, trigger, detection and required verification for editing
it.

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the Shaman session open, shorten its Monitor interval | Shrinks the bill, does not remove it — measured 32-54% of every token was a wake-up that decided nothing |
| Make the supervisor a session that spawns subagents for rulings | The outer loop still pays per wake-up and its context still grows — the exact cost this card removes |
| Have the watchdog itself spawn ruling sessions (one layer, not two) | Welds a zero-token process to an LLM spawn; the watchdog's whole claim is that it never spawns a model |
| Resume one long-lived ruling session across decisions | Defeats bounded context outright: nothing a decision needs is missing from disk, so nothing needs to be remembered across spawns |
| Let the ruling session drive the whole loop (grant it Bash + the runner CLI) | The babysitter again in a smaller hat — its context grows with every command, and a model deciding when to re-trigger is exactly the prose-driven control the design forbids |
| Fall back to permissionMode: 'bypassPermissions' for judgment sessions | Rejected by decision 4 itself; measured (§19.4) that 'default' plus an allowlisted tool already writes headlessly with no prompt, so no fallback is needed |

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Contract table has no row for the now-committed supervise subcommand; its Business Flow "Unattended path" row still describes the pre-supervisor held-open-session shape; its Change Safety table has no row for decision 4's least-privilege write model | c3-215#n1645@v1:sha256:a923efb6897eabf48b8f7515d8722d2b6c3ed7e91e78f2924656032e173300a9 "scripts/runner/run.ts transcript-metrics (context-budget ratchet)" | Three inserts/one block-replace: Contract row appended, Business Flow "Unattended path" row re-authored, Change Safety row appended naming risk/trigger/detection/verification for core/supervisor/permit.ts |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash "$C3X_BIN" change apply adr-20260919-campaign-supervisor-judgment-layer | applies clean; three patches land atomically (Contract insert, Business Flow block replace, Change Safety insert) |
| C3X_MODE=agent bash "$C3X_BIN" check (fresh detached worktree) | total: 55, ok: true, zero errors — one new entity (this ADR); no new component, core/supervisor/permit.ts is covered by the existing c3-215 row this ADR's Change Safety patch extends |
| cd plugins/tribe/scripts/runner && bun test core/supervisor/permit.test.ts | passes — the containment table this ADR documents is exercised in both directions by a unit table AND (Task 13, opt-in) a real Haiku session |
