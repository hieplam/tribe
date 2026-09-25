---
id: adr-20260925-fix1b-agentsmd-config-surface
c3-seal: 5138b25140b7b346d9f10556ffc0fde31bfeea66f279a248e59f21fb55e61da2
title: fix1b-agentsmd-config-surface
type: adr
goal: |-
    Reconcile the architecture model to fix round 1 of card `supervisor-home-settings-containment`,
    which widened `isHomeConfigSurface` to also match `agents*.md` after an adversarial audit measured
    that the Claude Code CLI loads `<home>/AGENTS.md` as project instructions by default wherever the
    campaign home has no `CLAUDE.md` — precisely the steady state this card's own restore creates —
    and neither layer 1 nor layer 2 covered it, so a `closing` session's `Bash` write of
    `<home>/AGENTS.md` carried a codeword into the next `ruling` session. `c3-215`'s Change Safety row
    for "A ruling/ratify session writes outside the campaign home…" (`c3-215-tribe.md:103`) still
    enumerates the surface as `.claude/**, CLAUDE*.md, .mcp.json` only, and the C3 rule this behaviour
    is measured against (`rule-session-cwd-config-restored`) carries a Golden Example that quotes the
    pre-fix-round-1 `isHomeConfigSurface` body verbatim and a Goal that never mentions `AGENTS.md`.
    Both facts are reconciled in this one change-unit; no behaviour changes.
status: accepted
date: "2026-09-25"
---

## Goal

Reconcile the architecture model to fix round 1 of card `supervisor-home-settings-containment`,
which widened `isHomeConfigSurface` to also match `agents*.md` after an adversarial audit measured
that the Claude Code CLI loads `<home>/AGENTS.md` as project instructions by default wherever the
campaign home has no `CLAUDE.md` — precisely the steady state this card's own restore creates —
and neither layer 1 nor layer 2 covered it, so a `closing` session's `Bash` write of
`<home>/AGENTS.md` carried a codeword into the next `ruling` session. `c3-215`'s Change Safety row
for "A ruling/ratify session writes outside the campaign home…" (`c3-215-tribe.md:103`) still
enumerates the surface as `.claude/**, CLAUDE*.md, .mcp.json` only, and the C3 rule this behaviour
is measured against (`rule-session-cwd-config-restored`) carries a Golden Example that quotes the
pre-fix-round-1 `isHomeConfigSurface` body verbatim and a Goal that never mentions `AGENTS.md`.
Both facts are reconciled in this one change-unit; no behaviour changes.

## Context

Fix round 1's own record (`## FIX ROUND 1`,
`docs/superpowers/evidence/2026-09-25-supervisor-home-settings-containment.md`) measured, through
the supervisor's own spawn path (`runOneShotSession` + the real `sdkSpawnSession`, Haiku, a
throwaway `mkdtemp` home): `<home>/AGENTS.md` loaded (a `ruling` session's `finalText` carried the
codeword a `closing` session had planted with one `Bash` heredoc), and a nested
`<home>/escalations/AGENTS.md` loaded too, by the same on-demand mechanism as spec §4.3's `m1b`
row. `AGENTS.override.md` and a `.claude.json` carrying both a memory line and a `hooks` block were
measured **not** loaded. The vendored CLI binary itself
(`node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`) carries
`var z=["AGENTS.md",".claude/AGENTS.md"];var _=["CLAUDE.md",".claude/CLAUDE.md","CLAUDE.local.md"]`
and the log string `no CLAUDE.md found; AGENTS.md loaded: `. The fix widened the one predicate,
`core/supervisor/home-config.ts#isHomeConfigSurface`, with one more clause mirroring the existing
`claude*.md` clause exactly (`isAgentsMemoryFile`, case-insensitive, last segment, any depth), and
the committed G2 E2E (`core/supervisor/home-config.e2e.test.ts`) gained a fourth pair; the ratchet
moved `0/4 -> 4/4` (the before-run showed `AGENTS.md` alone defeating all four pairs). The
authorising ruling is the campaign's standing **R4**: "cover the whole measured configuration
set … a narrower list fails G2" — a newly-measured member of that already-ruled class, not a new
principle.

Two architecture facts now understate the landed code:

- `c3-215-tribe.md:103`'s Change Safety row states `isHomeConfigSurface`'s shapes as
`.claude/**, CLAUDE*.md, .mcp.json` — `agents*.md` is missing, so a reader of the component's own
safety contract would not know the predicate also refuses `AGENTS.md`.
- `rule-session-cwd-config-restored`'s Golden Example (`.c3/rules/rule-session-cwd-config-restored.md`)
quotes `isHomeConfigSurface`, whole function, but the quoted body is the fix-round-0 shape (three
local variables: `isInsideDotClaude`, `isMemoryFile`, `isMcpConfig`) — the landed function has four
(`isClaudeMemoryFile`, `isAgentsMemoryFile` replacing `isMemoryFile`). A Golden Example must be
literal code from the real file (`rule` canvas `reject_if`: "'Golden Example' is paraphrased...
instead of literal code copied from a real file"); a stale copy fails that test the moment the two
diverge, which they now do. The rule's Goal enumerates the measured shapes a `cwd`-rooted session
loads and never names `AGENTS.md`.

The rule's one-line **Rule** statement ("A spawn path that loads the `project` or `local` tier
restores its `cwd`'s configuration surface to the pre-session snapshot before the next session can
start") is shape-independent — it says nothing about which files compose the surface — so it needs
no edit; this unit does not touch it.

## Decision

Three block patches, one change-unit, no behaviour change:

1. `c3-215`'s Change Safety row (`c3-215-tribe.md:103`, cited fresh): add `or agents*.md` to the
shape enumeration next to `claude*.md`, and record the fix-round-1 measurement (AGENTS.md's
default-load behaviour, the `closing`/`Bash` carry-over it caused, and that the predicate now
closes it) in the same sentence style as the row's existing MEASURED clause. No other cell
changes.
2. `rule-session-cwd-config-restored`'s Golden Example, the `isHomeConfigSurface` code block: replace
the quoted function with the current landed body (`isAgentsMemoryFile`), copied literally from
`core/supervisor/home-config.ts`, and update the `// REQUIRED` annotation line to name the fourth
shape (`AGENTS*.md`).
3. `rule-session-cwd-config-restored`'s Goal section: append the fix-round-1 measurement (AGENTS.md
loads by default wherever `cwd` has no `CLAUDE.md`, at any depth, and the `closing`/`Bash` carry-
over it caused before the predicate widened) to the existing MEASURED sentence, so the Goal's own
enumeration of measured shapes stays complete.

No source file, test, or evidence document is touched by this unit — the code and tests already
landed in fix round 1; this unit only brings the two frozen governance facts up to date with them.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Change Safety row for "A ruling/ratify session writes outside the campaign home…" (c3-215-tribe.md:103) enumerates isHomeConfigSurface's shapes as .claude/**, CLAUDE*.md, .mcp.json only; fix round 1 added a fourth shape, agents*.md, that the row never names | c3-215#n2150@v1:sha256:dd121326943a972ac8ac76895f293ddc49f2b9da7dc447062a95459d8f818f35 "A ruling/ratify session writes outside the campaign home, or the repo is touched by a session that should never write to it" | Patch 01 (block) adds agents*.md to the row's shape enumeration and records the fix-round-1 measurement, in the row's existing sentence style |
| rule-session-cwd-config-restored | rule | Its Golden Example quotes isHomeConfigSurface, whole function, but the quoted body is the pre-fix-round-1 three-clause shape while the landed function has a fourth clause (isAgentsMemoryFile); a rule canvas Golden Example must be literal code from the real file, and a stale copy is an explicit reject_if once the two diverge | rule-session-cwd-config-restored#n2450@v1:sha256:4cfe35e1fcfd4681cc3118aab169d838d247258b76716b0328e701297dc5932d "// REQUIRED: the case-insensitive compare and the three shapes (.claude/**" | Patch 02 (block) replaces the quoted isHomeConfigSurface body with the current landed function, copied literally from core/supervisor/home-config.ts |
| rule-session-cwd-config-restored | rule | Its Goal section enumerates the measured shapes a cwd-rooted session loads (hooks, CLAUDE.md, project skills, .mcp.json) and never names AGENTS.md, though fix round 1 measured it live through the same rule's own spawn path | rule-session-cwd-config-restored#n2445@v1:sha256:a1cf667b5fd809cff4d6858bb8111b9bc774a13a514bf8fc59ef27b3a07b8126 "Every agent session this repo spawns with the project or local settings tier treats its cwd" | Patch 03 (block) appends the fix-round-1 AGENTS.md measurement to the Goal's existing MEASURED sentence |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-change-unit-ships-with-code | Fix round 1's code and tests already merged to this branch (commit cd029ea); this unit is the deferred reconciliation the rule requires to land in the same delivery, not a later pass | rule-change-unit-ships-with-code#n2334@v1:sha256:b6024e72d871662eb34400050e4c977663b0356dceb6c8e2c42b3ea1c4fda085 "The PR that merges a decided ADR's code applies every patch under .c3/changes/<adr-id>/ to its target fact in that same PR, or records the deferral as a debt " | comply — this ADR is flipped to done only after change apply lands all three patches and their after-state phrases (agents*.md, isAgentsMemoryFile) grep present, in the same commit as this reconciliation |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash c3x.sh change apply adr-20260925-fix1b-agentsmd-config-surface | applies atomically — three block patches, no drift |
| C3X_MODE=agent bash c3x.sh check | ok: true |
| command grep -c -i agents .c3/rules/rule-session-cwd-config-restored.md | >= 1 |
| command grep -c -i AGENTS .c3/c3-2-plugins/c3-215-tribe.md | >= 1 |
| Golden Example literal-substring check (isHomeConfigSurface block against core/supervisor/home-config.ts) | LITERAL |
| cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit | green (inherited failures per the fix brief's Adjudication rule only), exit 0 |
