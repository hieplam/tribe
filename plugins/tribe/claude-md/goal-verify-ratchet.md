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
   **Every plan task carries its own Verify block**, whatever the card's size: **Goal** (the goal
   row it proves), **Red** (the command run before building, and the failure it shows — or "not
   applicable" plus the reason, for a task with no code to go red), **Green**
   (the command after building, and its literal expected output), **Stub check** (why an empty
   implementation fails it). A shared "the suite is green" line is not a Verify block. A task is
   done only when its Green has been run and the output matches.
3. **Ratchet** — a committed tool measures the baseline BEFORE building; the done claim shows
   before → after on the same tool, and the number may only move in the good direction.
4. **Owner accepts the output** — what the owner ratified as input, the owner signs off as output,
   by looking at the result next to the reference.
Why: the viewer-consolidation card (2026-09) ratified a beautiful design as a precondition and a
"no invented tokens" fence, never as a goal. Spec, plan, audits and verify-shipped all passed an
empty stylesheet; 69 of 71 component classes shipped with no CSS.
Why (per task): the campaign-status-cli plan (2026-09-28) ended every task with "Expected: check
command green" and held 9 empty test bodies; it passed the plan checker and the Shaman's review
until the owner asked where each step's verification was.
