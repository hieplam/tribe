# Fixture: the `viewer-consolidation` replay (card `campaign-supervisor`, Task 19, G3)

A **synthesized** campaign home, shaped like the real `viewer-consolidation` campaign's
escalation history (three escalation rounds for the same card, answered R16/R18/R22, plus one
ruling left unratified when `runner_done` fires — the same shape the real campaign hit at its
own exit code 5, `rulings_unratified`).

**Privacy wall (same as Task 4).** Nothing here is copied from
`~/.tribe/-Users-hip-repo-tribe/campaigns/viewer-consolidation/` (read-only source material).
Every escalation body, every ruling's prose, and the final report are **synthesized text** for
this fixture only — the SHAPE is what is reproduced (a `**Reason:**` line plus a `## Context`
section per escalation), never a real escalation's or a real ruling's own words.

## Layout

- `escalations/round-1-viewer-consolidation.md`, `round-2-viewer-consolidation.md`,
  `round-3-viewer-consolidation.md` — three synthesized escalations for the SAME card
  (`viewer-consolidation`), one per round. `core/supervisor/replay.test.ts` loads each in turn
  at `escalations/viewer-consolidation.md` (the one path `escalationPathOf` resolves to for
  this card) — round 1 as the campaign home's initial state, rounds 2 and 3 written back by the
  test's scripted watchdog runs, mirroring a real watchdog's own child producing a fresh
  escalation between rounds.
- `answers.md` — one pre-existing, synthesized ruling (`## R09 — ...`) recorded
  `ratified-as: pending` before this replay's own three rounds begin — the "one unratified
  ruling" G3's oracle names, requiring a `ratify` session before the campaign can close.
- `campaign-state.json` — `ownerOnlyEscalations: []` plus the one card's spec/plan paths (the
  real repo-relative paths already committed at `docs/tribe/planning/viewer-consolidation/`,
  which is public path information, not private ruling content).

## What the replay test proves

`core/supervisor/replay.test.ts` drives `runSupervisor` over this fixture with a scripted fake
`SupervisorIO` (the same seam pattern `core/supervisor/loop.test.ts` already uses) and asserts
the one-shot session spawn count is bounded at 5 — `ruling, ruling, ruling, ratify, closing` —
for a history the real campaign's own measured session took 174 turns to produce (card G3,
`## Measurable goals`).
