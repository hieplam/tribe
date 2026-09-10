---
id: c3-217
c3-seal: ae208eb7b18d8e390e56370d2373239efea31846a5c0476f7b99bdd210a8f3ba
title: verify-shipped
type: component
category: feature
parent: c3-2
goal: 'Mechanically verify a SHIPPED claim against the owner''s Definition of Done: PR merged, a regular 2-parent merge (never squashed), local master in sync with origin, worktree removed.'
uses:
    - ref-plugin-layout
    - rule-bash-strict-mode
    - rule-no-squash-merge
---

## Goal

Mechanically verify a SHIPPED claim against the owner's Definition of Done: PR merged, a regular 2-parent merge (never squashed), local master in sync with origin, worktree removed.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 plugins — Claude Code runtime content |
| Category | Feature — done-ness verification |
| Role in parent | Skill + one script (verify-shipped.sh) running four git/GitHub checks |
| Depends on siblings | Consumes the state tribe's Warchief produces; complements the Skinner's audit with pure mechanics |

## Purpose

Owns the executable form of "PR squash-merged and ready to work on new feature with LATEST CHANGES": four pass/fail checks instead of trusting a prose report. Non-goals: judging whether the work itself is correct (Skinner's question) — only whether it truly landed.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | git + gh authenticated; a PR number or branch identifying the claimed-shipped work | N.A - see SKILL.md description |
| Inputs | The SHIPPED claim (PR reference, worktree path) | N.A - see scripts/verify-shipped.sh |
| State | None persisted — read-only checks, printed verdict | N.A - see script |
| Shared dependencies | Plugin layout | ref-plugin-layout |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Per-check pass/fail verdict — merged, squash, master synced, worktree gone — on the delivery state the tribe's Warchief produced | c3-215 |
| Primary path | Query GitHub for PR state + merge strategy → compare local master to origin/master → check worktree removal → print verdict table | N.A - see scripts/verify-shipped.sh |
| Alternates | Any single check failing still runs the rest, so the report is complete | N.A - see script design |
| Failure behavior | A failing check means the claim is not trusted; caller must fix and re-verify, not argue | N.A - see SKILL.md description |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-plugin-layout | ref | Directory shape | binding | — |
| rule-bash-strict-mode | rule | verify-shipped.sh preamble | binding | — |
| rule-no-squash-merge | rule | Check 2 (merge_strategy_no_squash) — the parent-count assertion this skill exists to make | binding | This skill asserted the INVERSE (exactly 1 parent = squash) and failed the owner's own correctly-merged PR #37; the rule is the single source of the merge shape it must check |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Skill trigger | IN | Fires on "is this actually shipped? / verify SHIPPED / confirm done" | Claude Code skill system | SKILL.md frontmatter |
| scripts/verify-shipped.sh | IN/OUT | Read-only against git/GitHub; prints 4 pass/fail lines + verdict — pr_merged, master_in_sync, worktree_removed, and gap_gate_stamped (the merged PR body carries a gap-gate v1 stamp whose card= matches --card, spec CU-4 §3). --pr, --worktree and --card are all required: a claimed-done state with an unchecked corner is the gap this skill exists to close. Sha ancestry is deliberately not re-checked here — that is the campaign runner's gapGateStamped point, which has the merged repo in hand | shell CLI | plugins/verify-shipped/scripts/tests/test-verify-shipped.sh |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| False PASS (claim trusted when not landed) | Weakening any of the 4 checks | Roadmap cards marked shipped while master lacks the commit | Run plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh against a known-unmerged PR and confirm FAIL |
| Definition-of-Done drift | Owner's DoD changes without updating the script | Script verdict disagrees with owner expectations | Diff the 4 checks against the DoD wording in plugins/verify-shipped/skills/verify-shipped/SKILL.md |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| The 4 checks in the script | Purpose section (the executable DoD) and Contract section (script surface) | The script IS the DoD — no variance | plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh |
