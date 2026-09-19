---
id: rule-one-parser-per-edge-shape
c3-seal: 08a8553b6ee8f9d56aa0130411078162e370218a828b50cb2ce27eb4c91d9395
title: one-parser-per-edge-shape
type: rule
goal: |-
    Every external shape the tribe's TypeScript edges read — a persisted JSON file such as
    `campaign-state.json`, `campaign-report.json` or a watchdog `status.json`, or the `code` of a
    caught filesystem error — is narrowed by one named parser that every read site of that shape
    shares. A shape re-derived inline at a second site gets its own, independently chosen rigor: one
    copy rejects a wrong-typed field, the next silently drops it, and the two readers of the same file
    disagree about what it says. The campaign-supervisor card measured this drift in one file family
    (seven hand-rolled JSON readers at different rigor levels, harness gap G-004's duplicated
    error-code narrowing), while `core/state.ts` already shows the shared-parser shape.
---

## Goal

Every external shape the tribe's TypeScript edges read — a persisted JSON file such as
`campaign-state.json`, `campaign-report.json` or a watchdog `status.json`, or the `code` of a
caught filesystem error — is narrowed by one named parser that every read site of that shape
shares. A shape re-derived inline at a second site gets its own, independently chosen rigor: one
copy rejects a wrong-typed field, the next silently drops it, and the two readers of the same file
disagree about what it says. The campaign-supervisor card measured this drift in one file family
(seven hand-rolled JSON readers at different rigor levels, harness gap G-004's duplicated
error-code narrowing), while `core/state.ts` already shows the shared-parser shape.

## Rule

Each external shape an edge reads is narrowed by exactly one named parser that all of that shape's read sites import, never re-derived inline at a second site.

## Golden Example

`plugins/tribe/scripts/runner/core/state.ts` — `campaign-state.json` has ONE schema and ONE
parse entry point; every caller goes through `loadState`/`parseState`.

```ts
import { z } from 'zod';                                   // REQUIRED — the shared validation primitive this package already depends on

export const CampaignStateSchema = z.looseObject({         // REQUIRED — one named schema per persisted shape, exported
  v: z.number().int(),
  campaign: z.string(),
  mergePolicy: z.string(),
  sequence: z.array(z.string()),
  schemaLockPaths: z.array(z.string()),
  docsOnlyPaths: z.array(z.string()),
  ownerOnlyEscalations: z.array(z.string()),
  cards: z.record(z.string(), CardSchema),
});

export function parseState(raw: unknown): CampaignState {  // REQUIRED — the one named parse entry point
  assertKnownVersion(raw);                                 // OPTIONAL — shape-specific checks live inside the one parser
  const state = CampaignStateSchema.parse(raw) as CampaignState;
  assertSequenceReferentialIntegrity(state);
  assertDependsOnReferentialIntegrity(state);
  assertNoDependsOnCycles(state);
```

Compliance questions:

1. Does any function other than the shape's named parser call `JSON.parse` on this file and then read its fields?
2. Is a caught error's `code` narrowed by an inline `'code' in err` expression that also appears at another site?
3. When a second site starts reading a shape, does it import the existing parser rather than write its own?

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| readOwnerOnlyEscalations in core/supervisor/loop.ts runs its own JSON.parse on campaign-state.json and keeps only the string members of ownerOnlyEscalations | Read the file through parseState or a schema derived from CampaignStateSchema | core/state.ts rejects a non-string member; this copy silently drops it, so the runner and the supervisor read different owner-only lists from one file |
| The error-code narrowing err !== null && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'UNKNOWN' copied into adapters/cut.ts (unreadableResult) and cli/main.ts (fsErrorCode) | One exported helper that both files import | Harness gap G-004: the runner package narrows a caught error's code in three different shapes (this guard, bare (err as { code?: string }).code casts, NodeJS.ErrnoException casts) across its adapters and CLI; the next edit to one copy never reaches the others |
| A new reader for a persisted shape written as a try { JSON.parse } catch block followed by an ad hoc typeof chain | Add or reuse a named schema next to the shape's other reader | The same malformed-input defect class must otherwise be re-avoided at every site, and the rigor drifts with each copy |

## Scope

Applies to TypeScript under `plugins/tribe/scripts/` (runner, viewer, gaps): every read of a
persisted JSON file and every narrowing of a caught error at an impure edge. A shape read at
exactly one site may keep its parser inside that site's function; the rule bites the moment a
second site reads the same shape. Test fixtures that build a shape in memory are out of scope.
Existing violations recorded when the rule was adopted (2026-09-19): G-004's two guarded copies
(`adapters/cut.ts`, `cli/main.ts`), the bare error-code casts across `adapters/*-io.adapter.ts`,
and the supervisor loop's own re-reads of `campaign-state.json` (`readOwnerOnlyEscalations`,
`readCardSpecPlan`); their cleanup is scheduled on card `supervisor-hardening`. A Tracker finding
on one of these recorded sites is a `tracked` note, not a Blocker, until that card lands.

## Override

A package with no schema-validation dependency may write its one parser by hand; the rule is
about one parser per shape, not about which library builds it. A deliberate second parser (for
example, a deliberately lenient reader used only for crash recovery) states why in one comment on
its first line and names the strict parser it deviates from.
