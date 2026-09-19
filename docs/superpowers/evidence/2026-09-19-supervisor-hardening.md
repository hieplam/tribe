# Supervisor hardening — before/after evidence

**Card:** `supervisor-hardening`
**Spec:** `docs/superpowers/specs/2026-09-19-supervisor-hardening-design.md`
**Plan:** `docs/superpowers/plans/2026-09-19-supervisor-hardening.md`

Every AFTER block below is a real command's output on this branch. The BEFORE blocks are the
spec §9 reproductions (run against the branch base `7a6a469`). Five defects (G1–G5), each
reproduced end-to-end before its fix and now proven gone by the same oracle.

## The ratchets — none moved in the wrong direction

| Ratchet | Floor / ceiling | Result |
| --- | --- | --- |
| Runner tests | ≥ 1068 pass, 0 fail | **1109 pass, 0 fail** (`cd plugins/tribe/scripts/runner && bun test`) |
| Typecheck | exit 0 | **exit 0** (`bunx tsc --noEmit`) |
| `G-004` fingerprint | 2 → 0 files | **0** (`grep -rln "'code' in err" … --exclude="*.test.ts" \| wc -l`) |
| Context ceilings | may not rise | **empty diff** vs `origin/master` (`git diff origin/master -- …/2026-09-18-supervisor-ratchet.json`) |

Every gated/opt-in suite, 0 failed:

```
test-supervisor-repro.sh   (TRIBE_REPRO=1)   11 passed, 0 failed
test-supervisor-e2e.sh                        40 passed, 0 failed
test-supervisor-ratchet.sh                     8 passed, 0 failed
test-supervisor-docs.sh                       43 passed, 0 failed
test-verify-shipped.sh                        24 passed, 0 failed
test-supervisor-real-e2e.sh (TRIBE_REAL_E2E=1, BILLED)  15 passed, 0 failed
```

## G1 — the park document now shows the question

**BEFORE** (spec §9.1): `NEEDS_OWNER.md` rendered `(not applicable — this park is not about one
card's escalation)`; the escalation's `## Context` marker appeared **0** times; the caller
hardcoded `question: null` (`loop.ts:962`).

**AFTER**:

```
$ grep -c "question: null" plugins/tribe/scripts/runner/core/supervisor/loop.ts
0
$ TRIBE_REPRO=1 bash …/test-supervisor-repro.sh
ok - G1: an owner-only escalation parks
ok - G1: NEEDS_OWNER.md carries the escalation's own Context text
```

The permanent ungated oracle lives in `test-supervisor-e2e.sh`'s owner-only park probe (in the
40/0 run above).

## G2 — an unjustified ceiling raise is refused

**BEFORE** (spec §9.4): a hand-edited raise of `ruling` from `27534` to `999999` with no
`raisedBy` passed every gate.

**AFTER**:

```
$ TRIBE_REPRO=1 bash …/test-supervisor-repro.sh
ok - G2: an unjustified raise is refused
ok - G2: the same raise WITH raisedBy.ruling set is allowed
ok - G2: a lowering is allowed
$ bash …/test-supervisor-ratchet.sh
… case 4: the real committed ratchet passes its own gate (no raise on this branch)
8 passed, 0 failed
```

New edge `plugins/tribe/scripts/ratchet-check.ts` calls the pure `checkRatchetRevision`
(`core/metrics/ratchet-gate.ts`), comparing the working-tree file to its merge base.

## G3 — the closing verdict is the verify-shipped script's own file, checked on disk

**BEFORE** (spec §9.2): `supervise` exited `0` on the model's prose alone; **no** verdict file
existed anywhere under the campaign home; `verifyClosing` returned `{"outcome":"closed"}` for a
report whose body said `BLOCKED`; `SKILL.md` pointed at a non-existent
`~/.claude/skills/verify-shipped/scripts/verify-shipped.sh` (FU-CS-4).

**AFTER** — the billed real Haiku end-to-end run (`TRIBE_REAL_E2E=1`), the card's own G3 oracle
("the real Haiku E2E re-run shows the script executed"):

```
ok - step1: supervise exits 0
ok - step1b: supervisor/verdicts/c1.json exists
card=c1 verdict=PASS
ok - step1b: verdicts/c1.json parses as JSON with card=c1 and a recognised verdict
ledger ok: 2 spawns, kinds=['ruling', 'closing']
15 passed, 0 failed
```

The real closing session ran `verify-shipped.sh` to a script-emitted `PASS` verdict FILE (not
prose); the supervisor's closing postcondition read that file and closed the campaign. The
hermetic fixture stubs ONLY the GitHub network edge (`gh pr view`) so the real script, session and
supervisor all run — see plan note CN-20. The unit + double oracles (`verify.test.ts`,
`test-supervisor-e2e.sh` probes 9/10) are in the runs above:

```
$ TRIBE_REPRO=1 bash …/test-supervisor-repro.sh
ok - G3: a closing session whose verdict file is not PASS does not close the campaign
ok - G3: verify-shipped.sh writes a verdict file per shipped card
ok - G3: the SKILL.md command resolves under a plugin load
ok - G3: verifyClosing does not close a campaign whose report says BLOCKED with no shipped verdicts
$ bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
… SKILL.md no longer references ~/.claude/skills/verify-shipped
24 passed, 0 failed
```

## G4 — `rule-one-parser-per-edge-shape` has no violation left in the runner

**BEFORE** (card §5): 2 files carried `G-004`'s `'code' in err` fingerprint; the bare
`(err as { code?: string }).code` casts spread across `adapters/*-io.adapter.ts`; the supervisor
re-read `campaign-state.json` field-by-field.

**AFTER**:

```
$ grep -rln "'code' in err" plugins/tribe/scripts/runner --include="*.ts" --exclude="*.test.ts" | wc -l
0
$ grep -rn "as { code?: string }" plugins/tribe/scripts/runner/adapters | wc -l
0
$ grep -n "CampaignStateSchema" plugins/tribe/scripts/runner/core/supervisor/loop.ts
(imports and routes both read sites through core/state.ts's schema — Task 16)
```

One named parser `core/errno.ts` (`errorCode`) now backs all fourteen call sites;
`readOwnerOnlyEscalations`/`readCardSpecPlan` route through `CampaignStateSchema`.

## G5 — the closing session reads gap-gate results where the gate writes them

**BEFORE** (spec §9.3): the gate wrote under `<tribe-home>/campaigns/<slug>/reports/`; the
supervisor read `<tribe-home>/reports/` (`resolveTribeHome(repo)`); the reader found nothing.

**AFTER**:

```
$ TRIBE_REPRO=1 bash …/test-supervisor-repro.sh
ok - G5: the gate recorded at least one open id
ok - G5: the closing brief lists the gate's own open ids
```

`readGapGateOpenIds` now joins against `homeDir` (the campaign home it is already given), with no
silent fallback. `SKILL.md` Stage D and `agents/warchief.md` were corrected to name the campaign
home (Task 12).
