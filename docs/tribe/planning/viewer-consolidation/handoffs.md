# Handoff ledger — viewer-consolidation (single-card wave, 2026-09-12)

| From (spec:line) | Obligation | Receiving spec | Acknowledged at |
| --- | --- | --- | --- |
| (none) | | | |

## Non-obligations

`plugins/tribe/scripts/check-spec-handoffs.sh docs/tribe/planning/viewer-consolidation docs/superpowers/specs`
reported 2 hits, both inside `spec.md` itself and both the verb "handed" describing bytes passed
from the backward reader to the forward tail within this one design (§6.3):

- `spec.md:1317` — "carrySeed := bytes [windowEnd, eof) … handed to the forward tail" — internal
  data flow between two components of the same spec, not an obligation on another spec.
- `spec.md:1365` — "`[to, eof)` is handed to the forward tail" — same internal data flow.

No obligation crosses into an already-shipped spec; the wave launches with an empty ledger.
