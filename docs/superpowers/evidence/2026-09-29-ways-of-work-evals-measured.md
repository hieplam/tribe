# Evals 56–64 — what was measured while planning (card ways-of-work-consolidation)

Owner ruling E1 (2026-09-30): "stop eval, that's enough. commit plan measured then implement." No
eval is run during execution. The cases stay committed in `plugins/tribe/evals/evals.json` for a
later run; this file is the whole measurement, taken while the card was planned (2026-09-29/30).

How it was measured: `scripts/evals/run_evals.py --mode with_skill` on the default model (the
Shaman's `model: inherit`); a case passes when it passes the majority of its graded runs. A run
the account's session limit cut off is a harness failure (UNGRADED or an executor that never
finished) and is not counted. "Today" is `plugins/tribe/agents/shaman.md` at `632a039`. The
"prototype" is the planning prototype of the new `shaman.md`: round 1 = the first draft of the
"Ways of work" section, round 2 = with S1–S3, round 3 = with the campaign harness (D7, D9) and
R3-1, byte-identical to what plan Task 3 writes.

## The committed case versions

| Case | Grades | Today (`632a039`) | Prototype | Text the prototype cell measured |
| --- | --- | --- | --- | --- |
| 56 — an approved subagent-per-task card: the Shaman runs orchestrate-campaign itself | G4, D7, D9, S1, S2 | FAIL 0/1 | PASS 3/3 | round 3 (the three executor runs were first graded against a rubric that demanded a launched harness, which no eval directory can host — 1/3; re-graded against the committed rubric, which accepts the blocked outcome R3-1 requires: 3/3; no executor run was repeated) |
| 57 — picks single-agent | G2 | PASS 1/1 | PASS 1/1 | round 1 |
| 58 — picks subagent-per-task | G2 | PASS 1/1 | PASS 1/1 | round 1 |
| 59 — picks tribe | G2 | FAIL 0/1 | PASS 1/1 | round 1 |
| 60 — asks the owner when the rubric contradicts the owner's wish | G2 | FAIL 0/1 | PASS 1/1 | round 1 |
| 61 — a delegated single-agent card runs through the harness, not an inline build | G4, D7, D9, R3-1 | FAIL 0/3 | PASS 3/3 | round 3 |
| 62 — the Shaman rules a harness escalation after two fix rounds | G4, D9 | PASS 2/2 (1 run cut by the session limit) | PASS 3/3 | round 3 |
| 63 — an approved tribe card becomes a campaign card whose executor acts as the Warchief | G4, D7, D9 | FAIL 0/3 | PASS 3/3 | round 3 |
| 64 — the owner says "don't use the harness": the Shaman builds a delegated single-agent card inline | D7's exception, D2 | PASS 3/3 | PASS 3/3 | round 3 before the R3-1 sentence (the case does not touch it) |

Totals by majority: today 4/9 (57, 58, 62, 64); prototype 9/9 — 56, 61, 62, 63 and 64 on the
round-3 text, 57–60 on the round-1 text.

## Never measured, because of E1

- Cases 57–60 on the round-2 or round-3 text (the rounds after round 1 did not change the rubric
  those cases grade).
- Three runs on today's text for cases 56–60 (each had one run).
- Every case on the text as it will actually be merged, after Task 3 — Task 3 writes the round-3
  prototype byte for byte, so the prototype cells above are that text, but no run happens after the
  build.

## Superseded case versions (history, not the committed cases)

- Round 1 (case 56 as a hand-off to an owner-opened session; 61 as an inline build on delegation;
  62 with no harness; 63 as a Shaman-dispatched full-build Warchief), each fixture fix listed in
  order. Today: 56 FAIL 0/1 (no fixture files), FAIL 0/1 (a card with no goal table), then PASS
  2/2 once the card had one;
  61 FAIL 0/1 (its machine check ran without a shell), then PASS 1/1 through `bash -c`; 62 PASS 1/1;
  63 FAIL 0/1, 0/1, 0/2, 0/2. Round-1 prototype: 56 FAIL 0/1 (no fixture files), then PASS 1/1 and 2/2;
  61 FAIL 0/1 (the same check), then PASS 1/1; 62 PASS 1/1; 63 FAIL 0/1 (no fixture files), FAIL
  0/1 (a card with no goal table, stopped at the plan gate), 1/2, then PASS 2/2 once the fixture
  said the plan review was complete.
- Round 2 (the same case shapes, blocks with S1–S2): round-2 prototype 56 PASS 3/3, 61 PASS 3/3,
  62 PASS 3/3.
- Round 3, first run (cut by the session limit): round-3 prototype before R3-1 — 61 FAIL 0/3 (it
  built inline because the eval directory is no git repository: the gap R3-1 closed), 62 1/2.
