---
id: adr-20260920-c3-215-parser-rule-citation
c3-seal: fcbdd96d2fce2ad22051ed7c1703b14bf002afce7a0b032a0fcc7f604018ddd1
title: c3-215-parser-rule-citation
type: adr
goal: |-
    Give `rule-one-parser-per-edge-shape` the component citation it has never had, now that the
    runner carries all four named parsers `adr-20260920-supervisor-hardening`'s Decision 3
    authorized: `c3-215`'s Governance table gains one row citing the rule, naming the four parsers
    it governs, so `c3x check --rule rule-one-parser-per-edge-shape` resolves instead of erroring
    "has no citers".
status: accepted
date: "2026-09-20"
---

## Goal

Give `rule-one-parser-per-edge-shape` the component citation it has never had, now that the
runner carries all four named parsers `adr-20260920-supervisor-hardening`'s Decision 3
authorized: `c3-215`'s Governance table gains one row citing the rule, naming the four parsers
it governs, so `c3x check --rule rule-one-parser-per-edge-shape` resolves instead of erroring
"has no citers".

## Context

The rule was adopted 2026-09-19 and `adr-20260920-supervisor-hardening` records, in its own
Compliance Rules table, "comply — Phase 3 (plan Tasks 14 to 18) records the four named parsers
and the fingerprint reaching zero." But an ADR's Compliance Rules table is a `text` column, not
an edge-marked one (`c3x schema adr` — `Rule:text`); only a *component's* Governance table
`Reference` column carries `edge: uses` (`c3x schema component` —
`Reference:reference>uses(ref|rule)`). Citing a rule from an ADR's prose records intent; it does
not wire the graph edge `c3x check --rule` walks. Running the rule-scoped check on the current
tree confirms the gap:

```
$ C3X_MODE=agent bash c3x.sh check --rule rule-one-parser-per-edge-shape
error: rule rule-one-parser-per-edge-shape has no citers
hint: add a component citation through a change-unit …
```

`c3-215` is the component that owns every file the four parsers live in
(`plugins/tribe/scripts/runner/**`), and its Governance table already cites the repo's two other
process rules (`rule-bash-strict-mode`, `rule-no-squash-merge`) the identical way — a `rule` row
naming what it governs. It is missing the third.

The plan's Phase 2 reconciliation task (Task 13) already authored and applied
`adr-20260920-supervisor-hardening`'s four-patch change-unit — the two Contract rows (the
ratchet-check edge, the verify-shipped verdict file) and the two Change Safety rows (the closing
verdict postcondition, the gap-gate read path) for Decisions 1, 2 and 4. It shaped no patch for
Decision 3 (the four named parsers), because that decision's citer lives in a different table
(Governance, not Contract/Change Safety) and was not yet due — Phase 3's code (Tasks 14-16) had
not landed. That change-unit is now fully applied; re-running `change apply` on it would replay
its two already-landed `insert` patches and be rejected — `change apply
adr-20260920-supervisor-hardening --dry-run` confirms: `REJECT error: … merged c3-215 violates
its canvas … repeated boilerplate in Contract row 19 … duplicates Contract row 17`. A follow-up
unit is the tool's own idiom for "the previous unit was incomplete" (precedent:
`adr-20260906-fix-evals-fixture-count`'s Decision, verbatim: "adding a twentieth patch to it and
re-running `change apply` would re-run nineteen already-applied patches and be rejected on
drift").

## Decision

Open a new, narrow change-unit under this ADR's own id and insert exactly one Governance row into
`c3-215`, after the existing `rule-no-squash-merge` row, citing `rule-one-parser-per-edge-shape`.
The `Governs` cell names all four parsers Decision 3 specified and Tasks 14-16 built:
`core/errno.ts#errorCode` (a caught filesystem error's `code`), `core/escalation.ts#parseEscalationQuestion`
(the escalation-file shape, three read sites collapsed to one), `core/state.ts`'s existing
`CampaignStateSchema` reused read-only through `loop.ts`'s private `readCampaignState`, and
`core/metrics/ratchet-gate.ts#checkRatchetRevision`'s `raisedBy`/`ceilings` shape. `Precedence` is
`binding`, matching the component's other two rule rows. No other section of `c3-215` changes —
the Contract and Change Safety rows for Decisions 1, 2 and 4 already landed under the prior unit.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Its Governance table cites the repo's other two process rules (rule-bash-strict-mode, rule-no-squash-merge) but not rule-one-parser-per-edge-shape, even though it owns every file the rule's four now-built parsers live in | c3-215#n1732@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command" | This unit inserts the missing Governance row; no other section changes |
| rule-one-parser-per-edge-shape | N.A - a rule, not a system/container/component | Adopted 2026-09-19 with zero component citers; c3x check --rule cannot resolve a rule no component's body-owned Governance column names | rule-one-parser-per-edge-shape#n2050@v1:sha256:7c7d98b60ae93f515660d7fdbe87041fceae9207eff813d804c79fe892fbd91f "Every external shape the tribe's TypeScript edges read" | c3-215's new row is this rule's first citer |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash c3x.sh change apply adr-20260920-c3-215-parser-rule-citation | applies atomically, one insert patch, no drift |
| C3X_MODE=agent bash c3x.sh check --rule rule-one-parser-per-edge-shape | ok: true — the rule now resolves a citer |
| C3X_MODE=agent bash c3x.sh check | ok: true |
| grep -c "rule-one-parser-per-edge-shape" .c3/c3-2-plugins/c3-215-tribe.md | at least 1 |
