# Goal · Verify · Ratchet (no "done" without all three)
Run this checklist when a card, spec or plan is approved, and again before anyone claims done.
If an item is missing, STOP and fill it in; never guess it, never proceed without it.
1. **Goal** — every "What" line and every artifact the owner ratified (a design, a preview page,
   an API contract, a rule) is a goal row stating the OUTCOME a user sees, against that artifact
   ("the session page matches `preview.html`"), never the means ("styled with the tokens").
   Nothing lives only in a scope fence, a precondition, or a dependency: a ban or a prerequisite
   is satisfied by doing nothing.
2. **Verify** — each goal names its oracle, of the same KIND as the claim: visual → side-by-side
   against the reference; behaviour → end-to-end run; performance → measurement. **Empty-implementation
   test:** would doing nothing, or a stub, pass this check? If yes, it verifies nothing — replace it.
3. **Ratchet** — a committed tool measures the baseline BEFORE building; the done claim shows
   before → after on the same tool, and the number may only move in the good direction.
4. **Owner accepts the output** — what the owner ratified as input, the owner signs off as output,
   by looking at the result next to the reference.
Why: the viewer-consolidation card (2026-09) ratified a beautiful design as a precondition and a
"no invented tokens" fence, never as a goal. Spec, plan, audits and verify-shipped all passed an
empty stylesheet; 69 of 71 component classes shipped with no CSS.
