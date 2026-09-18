# Handoff ledger — campaign-supervisor (single-card wave, 2026-09-18)

| From (spec:line) | Obligation | Receiving spec | Acknowledged at |
| --- | --- | --- | --- |
| (none) | | | |

## Non-obligations

`plugins/tribe/scripts/check-spec-handoffs.sh <wave dir holding the spec and plan>` reported 2 hits,
and the same scan over `docs/superpowers/specs` and `docs/tribe` found no already-shipped spec that
hands an obligation to this card:

- `2026-09-18-campaign-supervisor.md:1170` — a verbatim quote of `plugins/tribe/rules/brief-contracts.md`
  ("if reconciliation is deferred to the end…"), cited to justify per-phase C3 tasks; not an
  obligation on another spec.
- `2026-09-18-campaign-supervisor-design.md:645` — "executor tier handed to `run.ts watchdog --model`":
  a CLI value passed between two components of this design, not an obligation on another spec.

Work this card deliberately leaves out (tripwires, patrol sessions, mid-flight directive delivery)
belongs to the follow-on card `campaign-patrol`, which has no spec yet by the owner's decision D1; the
card file and spec §16 record that boundary, so no spec-to-spec handoff exists to acknowledge.
