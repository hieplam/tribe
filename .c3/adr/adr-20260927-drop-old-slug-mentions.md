---
id: adr-20260927-drop-old-slug-mentions
c3-seal: 2c1965897e95a40c55d43569a91df93574f3c880b8b9c42665fc5c5df7e18db1
title: drop-old-slug-mentions
type: adr
goal: |-
    Drop the two literal `rule-session-cwd-config-restored` slug mentions left in `c3-215`'s
    Governance row and Change Safety row 103 prose after the rule's retirement, so the G4 ratchet
    (card `supervisor-sessions-in-repo`, guard-footprint identifier count) is not inflated by prose
    referring to a retired rule by its old name.
status: accepted
date: "2026-09-27"
---

## Goal

Drop the two literal `rule-session-cwd-config-restored` slug mentions left in `c3-215`'s
Governance row and Change Safety row 103 prose after the rule's retirement, so the G4 ratchet
(card `supervisor-sessions-in-repo`, guard-footprint identifier count) is not inflated by prose
referring to a retired rule by its old name.

## Context

The prior change-unit (`adr-20260927-cite-sessions-start-in-target-repo`) re-cited both rows to
`rule-sessions-start-in-target-repo` but its authored prose still named the old rule's slug
(`rule-session-cwd-config-restored`) once per row, for historical context. The card's own G4
measurement tool (`plugins/tribe/scripts/tests/sessions-in-repo/g4-guard-footprint.sh`) counts that
exact identifier anywhere under `.c3/`, so those two prose mentions count as live hits even though
the rule itself is retired.

## Decision

Re-author both rows' prose to describe the retirement without repeating the old rule's literal
slug — refer to it as "the retired one-shot config-restore rule" instead.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Governance row and Change Safety row 103 prose name the retired rule's literal slug | c3-215#n2199@v1:sha256:59f7674258812d07ad1dfe83eca18d999b114aa44a550a084cc28e8e83ff21f5 "rule-sessions-start-in-target-repo" | Reword to drop the literal old-rule slug from both rows' prose |

## Verification

| Check | Result |
| --- | --- |
| git grep -c rule-session-cwd-config-restored -- .c3/c3-2-plugins/c3-215-tribe.md | 0 |
| c3x check stays ok: true | ok: true |
