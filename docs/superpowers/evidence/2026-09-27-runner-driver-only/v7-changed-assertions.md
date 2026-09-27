# V7 — existing assertions this card changes (read-only sweep of master 3194976, 2026-09-27)

Produced during planning by a read-only sweep of every runner/viewer test, the shell tests under
`plugins/tribe/scripts/tests/` and `plugins/verify-shipped/scripts/tests/`, and the fixtures, against
the change list (a)-(i) below. Task 1.1 re-checks it on the post-#173 base; any assertion a task
changes that is not listed here is a finding.

Change list the sweep was run against: (a) executor brief rewrite + `TASK_DONE`; (b) `plugins:` /
`TRIBE_PLUGIN_DIR` removal; (c) `gapGateStamped`/`ledgerCommitted` out, `localBaseSynced`/`doneAtHead`
in; (d) gap-gate escalation bullets out; (e) rulings gate out (exit 5); (f) state v2 with required
`tasks`; (g) supervisor `ratify` kind out, `ratified-as` out of ruling/closing verification, closing
brief without gap-gate ids; (h) watchdog exit-5 row dead; (i) `verify-shipped.sh --skip-gap-gate`
(opt-in, default unchanged).

I found about 190 existing test assertions that the (a)–(i) change would change or break. Most of them come from three causes, which the per-file tables then break down.

**Legend for the "Kind" column:**
- **BREAK**: fails when the test runs.
- **COND**: fails only if the named symbol, export or branch is deleted rather than left in place unused.
- **TSC**: runs fine, but becomes a type-check error or tests a removed feature (e.g. the old `ratify` session).
- **FIX**: a fixture that needs updating.

## The three main causes

1. **Whole test files fail to load (all tests in the file fail).** Bun refuses a named import of an export that no longer exists, and some files read a removed file when they load:
   - `core/verify.test.ts:15` imports `parseGapGateStamp`.
   - `core/loop.test.ts:26` and `core/report.test.ts:25` import `EXIT_RULINGS_UNRATIFIED`.
   - `core/supervisor/loop.test.ts`:
     - line 9 imports `extractRulingBlockVerbatim` (COND).
     - line 10 imports `readGapGateOpenIds`.
     - lines 13 and 29 import `RATIFY_TEMPLATE_PATH` and read the file with `readFileSync` at load time.
   - `core/supervisor/replay.test.ts:25,46` and `core/supervisor/brief.test.ts:14,26` do the same with `RATIFY_TEMPLATE_PATH`.
   - `core/supervisor/verify.test.ts:5` imports `verifyRatify`.
   - COND, only if the `TRIBE_PLUGIN_DIR` export is deleted along with the `plugins:` option:
     - `core/session.test.ts:13`
     - `core/session.e2e.test.ts:23,30`
     - `core/supervisor/session.e2e.test.ts:12,20`
     - `core/supervisor/campaign-home-carryover.e2e.test.ts:10,16`
   - COND, only if the functions are deleted: `core/rulings.test.ts:4` imports `isRulingRatified` and `unratifiedRulingIds`.
2. **The schema bump to v2 (f).**
   - Every test that sends a `v: 1` state without per-card `tasks` through `parseState`/`loadState` fails with `UnsupportedStateVersionError`. That covers the real runner started as a subprocess from the shell tests.
   - The supervisor reads state through `CampaignStateSchema.safeParse` (`supervisor/loop.ts:425`). It skips the version check, but a card without `tasks` makes the whole file read as absent, so `ownerOnlyEscalations` becomes `[]`.
3. **New verify points (c).**
   - The IO mocks throw on any command they don't know: `verify.test.ts:134` "unmocked exec call", `verify.test.ts:958` (the real-git mock), `loop.test.ts:577` "unscripted exec call", and the `cleanCommitAndVerifyHandlers` helper (`loop.test.ts:2121-2140`).
   - `verifyShipped` turns a thrown error into a failed point. So any git or gh command that `localBaseSynced` or `doneAtHead` issues and these mocks don't cover fails every test that expects a shipped result, unless the mocks are extended.

## Runner TypeScript tests

### plugins/tribe/scripts/runner/core/brief.test.ts (3 BREAK, 1 at risk)
| Line(s) | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 40-194 (snapshot text: 44, 47, 97-102, 104-137, 154-157, 185-192) | `renders the committed template … (snapshot)` (197) | 206 `expect(rendered).toBe(EXPECTED_BRIEF);` | (a): Warchief, Hunters, Skinner, Tracker, gap-gate, Scout, debt-backfill, Harness gaps, Evidence policy, Worker reports, and the terminal contract with no `TASK_DONE` | BREAK |
| 296-306 | `renders a distinct brief per card id and per campaign` (294) | 305 `expect(rendered).toContain(otherReportPath);` | (a): `{{REPORT_PATH}}` only appears in the Harness-gaps and Worker-reports sections | BREAK |
| 313-324 | `executorBrief substitutes the injected report path into {{REPORT_PATH}}` | 322 `expect(brief).toContain(FIXTURE_REPORT_PATH);` | (a) same reason | BREAK |
| 262-280 | `states the Definition of Done preconditions for SHIPPED` | 280 `indexOf('## Definition of Done') < indexOf('## Terminal contract')` | (a) at risk if the DoD or terminal-contract sections are rewritten | COND |

### core/verify.test.ts (whole file fails to load; 17 tests BREAK)
| Line(s) | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 15 | (import) | `import { parseGapGateStamp, … }` | (c) | BREAK |
| 82-84, 102-109, 134 | `buildIo` mock | default gap-gate stamp in the PR body; throws "unmocked exec call" | (c) fixture | FIX |
| 165-170 | `all seven points pass` | 169 `expect(result.points).toHaveLength(7);` (167-168 also expect shipped and no failed points) | (c) | BREAK |
| 239-244 | `plan file gone at verify time … passes without throwing` | 242 `expect(result.shipped).toBe(true);` | (c) new points hit the strict mock | BREAK |
| 636-742 | `describe('gapGateStamped …')`: tests at 640, 651, 658, 664, 695, 706, 718, 729 | e.g. 655 `…detail).toContain('no \`gap-gate v1\` stamp')` | (c) | BREAK ×8 |
| 682-693 | `every point is still reported even when this one fails` | 684-692 `expect(result.points.map((p) => p.id)).toEqual(['merged', …, 'gapGateStamped', 'ledgerCommitted'])` | (c) | BREAK |
| 744-783 | `describe('ledgerCommitted …')`: tests at 748, 754, 765, 770 | 781 `…c[2] === 'origin/master:ops/gaps.jsonl'` (`gapLedgerPath`) | (c) GAP_LEDGER | BREAK ×4 |
| 785-803 | `describe('parseGapGateStamp')`: tests at 786, 799 | 800 `parseGapGateStamp(...)?.minted).toEqual([])` | (c) | BREAK ×2 |
| 953-958 | `runGuard` real-git IO | throws on unmocked `gh` calls | (c) fixture | FIX |

### core/session.test.ts (1 BREAK, 2 COND)
| Line | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 70-96 | `passes exactly the pinned §D1 options to io.spawnSession` | 90 `expect(options.plugins).toEqual([{ type: 'local', path: TRIBE_PLUGIN_DIR }]);` | (b) | BREAK |
| 170-173 | `TRIBE_PLUGIN_DIR is derived from the module location…` | 171 `.not.toContain('ai-dict')` | (b) | COND |
| 175-181 | `TRIBE_PLUGIN_DIR resolves on disk to the real plugins/tribe directory` | 179 `TRIBE_PLUGIN_DIR.endsWith(join('plugins','tribe'))` | (b) | COND |

`ports/ports.ts:197` declares `plugins` as required in `PinnedSessionOptions` (TSC).

### core/loop.test.ts (whole file fails to load; about 60 tests BREAK from (f); 6 from (e))
| Line(s) | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 26 | (import) | `EXIT_RULINGS_UNRATIFIED` | (e) | BREAK |
| 77-91 | `fixtureState()` | `v: 1,` (line 79), cards without `tasks` | (f) | FIX |
| 491-557 | `buildMockLoopIo` gap-gate handler and `prToCard` option | serves a `<!-- gap-gate v1 card=… -->` body | (c) becomes dead | FIX |
| 2808-2825 | `genuine done with an unratified ruling -> EXIT_RULINGS_UNRATIFIED through the pool path (N=2)` | 2824 `…toBe(EXIT_RULINGS_UNRATIFIED)` | (e) | BREAK |
| 2827-2849 | `a card still in flight … does NOT wrongly gate on rulings` | 2848 `toBe(EXIT_OK)`: still passes, only exists to guard the gate | (e) | TSC |
| 2991-3113 | `describe('runLoop — rulings gate …')`: 2999, 3011, 3021, 3033, 3059, 3097 | e.g. 3005 `toBe(EXIT_RULINGS_UNRATIFIED)`; 3006 `unratifiedRulings).toEqual(['R1 — Some convention'])`; 3018/3030/3049/3094/3112 `unratifiedRulings).toBeUndefined()` | (e) | BREAK (2999) / TSC (others) |
| (f) cascade | every runLoop or `--dry-run` test that reaches `loadState`: 680, 742, 762, 779, 800, 853, 888, 982, 1022, 1065, 1114, 1177, 1209, 1222, 1258, 1296, 1334, 1381, 1420, 1467, 1522, 1576, 1631, 1689, 1807, 1842, 1918, 1932, 1952, 1976, 2007, 2055, 2090, 2143, 2181, 2209, 2252, 2286, 2318, 2362, 2386, 2440, 2471, 2513, 2573, 2591, 2622, 2655, 2768, 2810, 2827, 2851, 2914, 2944, 2999, 3011, 3021, 3033, 3059, 3097 | `await runLoop(...)` rejects with `UnsupportedStateVersionError` | (f) | BREAK ×60 |

Not affected by (f): 1161 (STOP at startup), 1195 and 1239 (lock refused), 2608 (STOP with N>1), 1746/1767/1785 (`shipCard` unit tests), 2688 and 2749 (`performRevertAndRedo`).

### core/report.test.ts (whole file fails to load; 3 BREAK)
| Line | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 25 | (import) | `EXIT_RULINGS_UNRATIFIED` | (e) | BREAK |
| 122-131 | `EXIT_RULINGS_UNRATIFIED -> rulings_unratified, regardless of hasMessage` | 123-125 `deriveExitReason({… exitCode: EXIT_RULINGS_UNRATIFIED …})).toBe('rulings_unratified')` | (e) | BREAK |
| 486-515 | `the unratified ruling ids and guidance land INSIDE the "## Pending" section…` | 500 `expect(md).toContain('rulings_unratified');`, 510 `'Unratified rulings (answerable)'` | (e) | BREAK |
| 583-670 | W-F5: `A (missing spec/plan) escalates via PLANNING_NEEDED…` (runs the real `runLoop`) | 659 `expect(loopResult.exitCode).toBe(EXIT_ESCALATED);` | (f): `v: 1` at line 52 | BREAK |
| 517-523 | `no rulings note, and no stray field…` | 521 `.not.toContain('ratified-as')` | (e): still passes | none |

### core/state.test.ts (38 of 39 tests BREAK)
| Line | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 22-66 | `fixtureState()` | `v: 1,` (24), cards without `tasks` | (f) | FIX |
| 103-117 | `parses a well-formed state and round-trips it…` | 106 `expect(state.v).toBe(CURRENT_STATE_VERSION);` | (f) | BREAK |
| 219-223 | `rejects an unknown major version with a typed error` | 221-222 `fixtureState({ v: 2 })` → `.toThrow(UnsupportedStateVersionError)` (v2 becomes valid) | (f) | BREAK |
| 427-439 | `a pre-existing v1 state file with none of the new fields round-trips byte-identical` | 438 `expect(serialized).toBe(originalBytes);` | (f) | BREAK |
| 646-674 | `a caller-authored "planning" metadata field is preserved…` | inline `v: 1` at 649 | (f) | BREAK |
| All other tests (119, 136, 157, 182, 207, 233, 244-360, 376-409, 443-640, 678-786) | each passes the v1 fixture to `parseState`/`loadState` | e.g. 233 `.toThrow(UndefinedSequenceCardError)` now gets the version error instead | (f) | BREAK |
| 225-229 | `rejects a missing version field` | still throws `UnsupportedStateVersionError` | — | passes |

### core/rulings.test.ts (17 COND)
The describes at 91 (6 tests), 133 (4 tests) and 175 (7 tests) test `isRulingRatified` and `unratifiedRulingIds`. They only fail if (e) deletes those functions rather than just their callers.

### core/loop/card-actions.test.ts (0 runtime)
- Line 71-80: the typed `CampaignState` has `v: 1` and no `tasks` (TSC).
- No test covers the `gapGateStamped`/`ledgerCommitted` bullets in `formatVerifyFailure`. Tests 105-183 only cover the `schemaGuard`, `merged` and worktree bullets, so (d) breaks nothing here.

### cli/main.test.ts (5 BREAK)
The `stateFixture` at 395-418 has `v: 1` (line 397) and is used by the `performResetCard` tests:

| Test (line) | Assertion | Kind |
|---|---|---|
| `a DEAD lock does not refuse` (484) | 494 `expect(result).toBe(0)` | BREAK |
| `unknown card id -> exit 1, … naming the id` (519) | 529 `e.includes('does-not-exist')` (the version error comes first) | BREAK |
| `a successful reset writes the updated state…` (533) | 542 `toBe(0)` | BREAK |
| `a still-present escalation file prints a warning…` (563) | expects success | BREAK |
| `no escalation file -> no note printed` (580) | expects success | BREAK |

- 468 (live lock) refuses before loading, so it still passes.
- The supervisor-limits fixture at 1202 still carries `maxRatifyRounds: 2` (TSC).

### core/supervisor/brief.test.ts (whole file fails to load; 3 BREAK, 1 at risk)
| Line | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 14, 26 | (import, load-time read) | `RATIFY_TEMPLATE_PATH`, `readFileSync(RATIFY_TEMPLATE_PATH)` | (g) | BREAK |
| 84-96, 103-104 | fixtures | `fixtureRatifyFacts`; `rulings: [{ratifiedAs}]`, `openIdsByCard` | (g) | TSC |
| 177-195 | `describe('renderBrief — ratify')`: 178, 184, 191 | 180 `toContain('R3')`; 186 deterministic; 193 answers path | (g) | BREAK ×3 |
| 198-204 | `contains Stage D's four numbered steps, byte-identical to SKILL.md` | 201 `toContain('2. **The ratification pass.**')` | (g): breaks if the closing brief's copy of Stage D step 2 (which mentions gap-gate and `open_ids`) is edited | COND |

### core/supervisor/decide.test.ts (8 BREAK)
| Line | Test | Assertion | Pins |
|---|---|---|---|
| 193-202 | `rows 1-3: runner_done closes, ratifies, or closes-out` | 198-199 `unratifiedRulings: ['R7']` → `session: 'ratify'` | (g) rows 1-3 |
| 315-321 | `row 13: the ratify-round cap refuses another ratify attempt` | 320 `reason: 'ratify_cap'` | (g) row 13 |
| 323-329 | `row 14: the total spawn budget also caps a ratify attempt` | 328 `reason: 'spawn_cap'` (for `rulings_unratified`) | (g) row 14 |
| 331-334 | `row 15: rulings_unratified otherwise spawns a ratify session` | 333 `session: 'ratify'` | (g) row 15 |
| 434-454 | `G5 (fix B-F1): a run that finalised SUCCESSFULLY…` | 452-453 `unratifiedRulings: ['R1']` → `session: 'ratify'` | (g) |
| 579-585 | `V2: an out-of-scope ratify edit parks and is never retried` | 584 `reason: 'ratify_out_of_scope'` | (g) |
| 610-630 | `V5/V6: a failed attempt parks once its retry budget is exhausted…` | 623 `reason: 'ratify_failed'` | (g) |
| 633-645 | `V7: the unratified list reached empty re-triggers the watchdog…` | 636 `outcome: 'ratified'`; 640 `terminal('rulings_unratified')` | (g) |

The `base()` fixture at lines 8, 13 and 15 still carries `unratifiedRulings`, `ratifyRounds` and `maxRatifyRounds` (TSC).

### core/supervisor/verify.test.ts (whole file fails to load; 6 BREAK)
| Line | Test | Assertion | Pins |
|---|---|---|---|
| 5 | (import) | `verifyRatify` | (g) |
| 31-36 | `a new block with ratified-as: pending is a failed attempt, not a ruling` | 34 `expect(v.outcome).toBe('failed');` | (g) `not_ratified` |
| 38-42 | `a new block with no ratified-as: field at all is a failed attempt` | 41 `toBe('failed')` | (g) `not_ratified` |
| 113-117 | `verifyClosing: an unratified ruling still on disk is a failed attempt` | 116 `toBe('failed')` | (g) closing `rulings_unratified` |
| 249-258 | `ratify may change only the ids it was given` | 252 `.toBe('ratified')`; 256 `'ratify_out_of_scope'` | (g) |
| 260-264 | `ratify that drops a ruling id entirely parks out_of_scope` | 263 | (g) |
| 270-276 | `ratify that INJECTS a fabricated new ruling block parks ratify_out_of_scope` | 275 | (g) |

The `verifyClosing` calls at 103-196 all pass `answers:` (TSC if that input is removed).

### core/supervisor/loop.test.ts (whole file fails to load; 4 BREAK, 3 COND)
| Line | Test | Assertion | Pins | Kind |
|---|---|---|---|---|
| 9, 10, 13, 29 | (imports, load-time read) | `extractRulingBlockVerbatim`, `readGapGateOpenIds`, `RATIFY_TEMPLATE_PATH` | (g) | BREAK |
| 34 | `LIMITS` | `maxRatifyRounds: 2` | (g) | TSC |
| 620-656 | `spawn_session(ratify) -> [outcome: ratified] -> run_watchdog, with the real brief…` | 644-646 `kinds` sequence; 653 `ratifyPrompt).toContain('## R1')` | (g) | BREAK |
| 780-818 | `describe('extractRulingBlockVerbatim — the ratify brief's…')`: 793, 804, 814 | 796 `expect(block).toBe([...])` | (g) | COND ×3 |
| 820-879 | G5 closing brief: `buildOneShotPrompt renders the closing brief with the CAMPAIGN-home report's open ids…` (863) | 869 `expect(prompt).toContain(CAMPAIGN_OPEN_ID);` | (g) `OPEN_IDS_BY_CARD` | BREAK |
| 873-878 | `readGapGateOpenIds reads under the home it is GIVEN…` | 875 `readGapGateOpenIds(seam.io, HOME, 'c1')).toEqual([CAMPAIGN_OPEN_ID])` | (g) | BREAK |
| 1219-1275 | `V7 (a verified ratify) also returns run_watchdog; …stale_terminal budget…` | 1258 `expect(kinds).toEqual([...,'spawn_session', 'run_watchdog',...])` | (g) | BREAK |
| 259-263, 1048 | `campaignStateFixture` (`v: 1`); status counters `ratifyRounds: 0` | fixtures | (f)/(g) | FIX (no runtime effect: cards are `{}` by default, and the tests at 505 and 548 already use invalid state) |

### core/supervisor/replay.test.ts (whole file fails to load; 1 BREAK)
| Line | Test | Assertion | Pins |
|---|---|---|---|
| 25, 46, 64, 126 | imports, `REAL_TEMPLATES`, `maxRatifyRounds`, `kindOfPrompt` checking for `'# Ratify Brief'` | — | (g) |
| 238-285 | `ruling, ruling, ruling, ratify, closing — <= 5 spawns, no resume…` | 282 `expect(spawnLog.map((s) => s.kind)).toEqual(['ruling','ruling','ruling','ratify','closing']);` | (g) |

### core/supervisor/args.test.ts (5 BREAK)
| Line | Test | Assertion | Pins |
|---|---|---|---|
| 7-25 | `defaults: every budget flag carries its spec §8 default` | 15-21 `limits).toEqual({… maxRatifyRounds: 2 …})` | (g) |
| 102 (BOUNDED row) | 4 generated tests: `--max-ratify-rounds: accepts its lower bound…` (111), `refuses one below…` (144), `refuses one above…` (149), `refuses a non-integer-literal string…` (154) | 146 `got.error).toBe(\`${flag}: must be between…\`)` | (g) `--max-ratify-rounds` |

### core/supervisor/state.test.ts (3 COND: fail if `ratifyRounds` is removed)
| Line | Test | Assertion |
|---|---|---|
| 17-27 | `every counter starts at zero/empty` | 18-26 `zeroState()).toEqual({… ratifyRounds: 0 …})` |
| 58-81 | `every field is read back exactly` | 70-80 `state: {… ratifyRounds: 1 …}` |
| 115-130 | `serialize(parse(x).state) reparsed equals the original state exactly` | 129 `reparsed).toEqual({ kind: 'ok', state })` (state includes `ratifyRounds: 1`, line 118) |

### core/supervisor/status.test.ts (4 BREAK/COND)
| Line | Test | Assertion | Pins |
|---|---|---|---|
| 25-31 | `ALL_PARK_REASONS` includes `ratify_cap`, `ratify_failed`, `ratify_out_of_scope` | 3 tests generated at 208 (`test(reason)`), asserting 216-217 | (g) |
| 221-223 | `all 22 values are covered by this table` | 222 `expect(ALL_PARK_REASONS.length).toBe(22);` | (g) |
| 54, 76, 89 | counters `ratifyRounds: 0` | `toEqual` still passes because of the spread | TSC |

### core/supervisor/truth.test.ts (1 BREAK)
| Line | Test | Assertion | Pins |
|---|---|---|---|
| 352-358 | `every ExitReason spelled identically in both vocabularies maps to itself` | 354-357 `[…, 'rulings_unratified']` → `terminalReasonForRunReason(shared)).toBe(shared)` | (e) |

The fixture at 13-17, 291 and 324 still has `unratifiedRulings`, `ratifyRounds` and `maxRatifyRounds` (TSC).

### core/supervisor/session.test.ts (0 runtime breaks, about 14 TSC)
`session.ts` only branches on `kind === 'closing'`, so the tests that use `kind: 'ratify'` still pass but now cover a removed kind. They are at 77/86, 91, 98 (`test.each`), 108, 115, 150, the loop at 159, 189, 198, 206, the loop at 214, 246/251, 320/326, and the scan-wall loop at 366 (12 generated `ratify:` tests).

### Watchdog and integration tests (exit 5 → `needs_human:rulings_unratified`, (h))
| File | Line | Test | Assertion | Kind |
|---|---|---|---|---|
| core/watchdog/decide.test.ts | 104-111 | 8 generated `exit 5 quota=… -> exit:needs_human:rulings_unratified` (120) | 128 `expect(encode(action)).toBe(want)` | COND (if case 5 is removed); 115-116 `TABLE.length).toBe(48)` still passes |
| core/watchdog/watch-loop.test.ts | 223 | `runner 5 maps to watchdog 10:rulings_unratified` (226) | 229 `toEqual([watchdogExit, reason])` | COND |
| runner/watchdog-integration.test.ts | 123 | `plan "5:none" ends 10:rulings_unratified` (129) | 133 `toEqual([exitCode, reason])` | COND |
| runner/watchdog-integration.test.ts | 38-41 | harness `campaign-state.json` has `v: 1` (only its existence is checked, per the comment) | — | FIX |

### E2E tests (opt-in)
| File | Line | Test | Assertion | Pins | Kind |
|---|---|---|---|---|---|
| viewer/e2e/campaign-badge.e2e.test.ts | 208-219 (`v: 1` at 211); 149, 156 (plan fixture forces the `hunter` subagent) | `a real Haiku 4.5 campaign run…` (378) | 417-419 the runner `--dry-run` must succeed | (f), and (b) because tribe agents are no longer loaded | BREAK |
| core/supervisor/session.e2e.test.ts | 174-185 | the `for kind of ['ruling','ratify']` loop: `${kind}: Skill c3 returns C3 content…` | — | (g) | TSC |

## Shell tests (plugins/tribe/scripts/tests, plugins/verify-shipped/scripts/tests)

| File | Line(s) | Test / check | Pins | Kind |
|---|---|---|---|---|
| test-supervisor-e2e.sh | 65-88 (`"v": 1`), 101 (`unratifiedRulings`) | fixture; the comment at 296-299 confirms the real runner runs | (f) | FIX |
| | 131, 141 | `probe1: absolute --home exits 0`; `NEEDS_OWNER.md does not exist` | (f): the re-run real runner errors | BREAK |
| | 152, 161 | `probe2: --campaign exits 0…`; absent NEEDS_OWNER | (f) | BREAK |
| | 172, 175, 179 | `probe3: the double's own counter file was never created`; `names park reason owner_only`; Context text | (f): a card without `tasks` makes the state unreadable, so `ownerOnlyEscalations` is empty | BREAK |
| | 310 | `probe9: park reason is closing_failed` | (f) | BREAK |
| | 326-331 | `probe10: a PASS verdict file present exits 0` and its verdict checks | (f) | BREAK |
| test-supervisor-kill.sh | 68-91 (`"v": 1`), 104 | fixture | (f) | FIX |
| | 149, 153, 154 | `control: exits 0`; `double was invoked twice`; `reaches campaign_closed` | (f) | BREAK |
| | 239-242 | `killA: …SAME exit code…`, `campaign_closed`, invocation count | (f) | BREAK |
| | 349-359 | `killC: restart exits 0…`, `campaign_closed`, invocation count | (f) | BREAK |
| test-watchdog-e2e.sh | 36-59 (`"v": 1`) | real watchdog and real runner | (f) | FIX |
| | 76, 102, 103, 104, 128 | `status.json reason is escalations_pending`; `runner's own report says escalations_pending`; escalation file exists / `planning_needed`; `relative --home reaches the same verdict` | (f): the reason becomes `error` | BREAK |
| test-watchdog-stall-relaunch.sh | 57-61, 89-93 (`"v":1`) | real runner (it now exits 4); stall and runId checks at 158 and 226 are probably unaffected | (f) | FIX |
| test-supervisor-park-truth.sh | 83-87 (`"v":1`), 107; 239 comment lists `rulings_unratified` | G2/G3 re-launch the watchdog, which runs the real runner; G2's `absent … NEEDS_OWNER.md` and G3's continue-supervising checks may flip | (f), (e) | FIX, possible BREAK |
| test-supervisor-repro.sh (runs only with `TRIBE_REPRO=1`) | 87-110 (`"v": 1`), 123 | fixture | (f) | FIX |
| | 152-153 | `G1: an owner-only escalation parks` | (f) owner-only lost | BREAK |
| | 204-286 | `G5: the closing brief lists the gate's own open ids` (286 `contains … "$g5_open_id"`) | (g) `OPEN_IDS_BY_CARD` | BREAK |
| | 196-200 | G3 `verifyClosing({… answers: "" …})` | (g) | TSC |
| test-supervisor-real-e2e.sh (runs only with `TRIBE_REAL_E2E=1`) | 108-131 (`"v": 1`), 171; 70-82 gh shim with a gap-gate stamp; 255 `verdict in {"ruled","ratified",…}` | 189 `step1: supervise exits 0` | (f); (i) keeps the default | BREAK |
| test-supervisor-docs.sh | 65-86 | flags parity: `README documents a nonexistent supervise flag: $f` / `supervise accepts $f but the Supervisor table omits it` | (g): `--max-ratify-rounds` in `runner/README.md:973` and `args.ts:36,43,105` must be removed together | COND |
| verify-shipped/scripts/tests/test-verify-shipped.sh | 37 (STAMP); 66, 74, 80; 88; 93-95 `"gap_gate_stamped,master_in_sync,pr_merged,worktree_removed"` | pins the default gap-gate behaviour | (i): default unchanged, so these still pass; no test covers `--skip-gap-gate` | none |

## Fixtures

| Path:line | Encodes |
|---|---|
| runner/fixtures/watchdog/runner-double.sh:100 | `5) reason=rulings_unratified ;;` (exit 5); line 60 `"v": 1` is a run record, not campaign state |
| runner/fixtures/supervisor/session-double.sh:11, 18 | `ratify` kind in comments; 28 and 85 write `ratified-as: operational` (harmless after (g)) |
| runner/fixtures/supervisor/viewer-consolidation-replay/answers.md:3, 7-8 | `ratified-as: pending`; mentions exit code 5, `rulings_unratified` and the `ratify` session |
| …/viewer-consolidation-replay/README.md:5-6, 24-25, 34 | exit 5 / `rulings_unratified`; the `ruling, ruling, ruling, ratify, closing` bound |
| …/viewer-consolidation-replay/campaign-state.json:1-9 | no `v` at all (already not a valid runner state) |
| tests/test-supervisor-e2e.sh:67, test-supervisor-kill.sh:70, test-supervisor-repro.sh:89, test-supervisor-real-e2e.sh:110, test-watchdog-e2e.sh:38, test-watchdog-stall-relaunch.sh:58, 90, test-supervisor-park-truth.sh:84 | v1 campaign state whose cards have no `tasks` |
| tests/test-migrate-campaign-home.sh:126 | `{"v":1,"campaign":…}`: the content is never parsed, so unaffected |
| tests/test-supervisor-real-e2e.sh:82; verify-shipped test:37; runner loop.test.ts:553; verify.test.ts:84, 638, 746, 788, 800 | gap-gate v1 stamps |
| test-supervisor-ratchet.sh:41-72; test-supervisor-repro.sh:304-362; metrics/ratchet-gate.test.ts:7-13 | a `"ratify": 0` ceiling key (the gate doesn't care which keys exist, so unaffected) |

## Tests that check exact brief or SKILL.md wording

- **`core/supervisor/brief.test.ts`** is the only test that reads `skills/orchestrate-campaign/SKILL.md` (lines 20-23) and checks the briefs quote it word for word:
  - W3 quote (45-48, test at 127/129) and W7 quote (49-52, test at 132/134) in `brief-ruling.md`. The "Shaman authority" lines (`brief-ruling.md:8, 57`) are outside these quotes, so no test pins that wording.
  - Stage D steps 1-4 in `brief-closing.md` (54-66, test at 198-204). Step 2 is the ratification pass, which mentions gap-gate `open_ids` and `rulings_unratified`.
  - The load-time self-check at 62-66 throws if SKILL.md loses a Stage D marker.
- **`core/brief.test.ts:40-194`**: full snapshot of `brief-template.md`.
- **`core/supervisor/loop.test.ts`**:
  - 531-532 `'- Spec: (missing)'` / `'- Plan: (missing)'` (ruling brief).
  - 653-654 (ratify brief).
  - 869 (closing brief's open ids).
- Replay test's `kindOfPrompt` at 125-126 matches on the `# Ruling Brief` / `# Ratify Brief` headings.
- `test-watchdog-detached.sh:47` checks SKILL.md for `'run.ts" watchdog'` (not affected).

## Checked and not affected
- Tests that mention agent roles only in agent docs or comments: `test-disagreement-routing.sh`, `test-dual-skinner-cell.sh`, `test-review-cell-v3.sh`, `test-context-isolation.sh`, `test-fixer-mandate.sh`, `test-input-asymmetry.sh` (they read `agents/*.md`, not the runner).
- `runner/structure.test.ts` and `viewer/structure.test.ts` (comments only); `supervisor/permit.test.ts:38, 222` (only titles mention ratify).
- `viewer/core/subagents.test.ts:17-39` (`tribe:hunter` is a transcript fixture); `viewer/serve.security.test.ts` (`"v":2` is the healthz body).
- `verifyShippedPluginDir` / `verifyShippedPluginAvailable` tests (the supervisor closing plugin, not (b)): `supervisor/session.test.ts:138-155`, `supervisor/loop.test.ts:742-762`, `cli/main.test.ts:1215-1250`.
- Tests on the SHIPPED / NEEDS_DIRECTION terminal lines: `core/session.test.ts:319-372` doesn't break. Line 361 treats an unrecognised line as `error`, so it only matters if the new `TASK_DONE` line changes how those lines are parsed.
- Viewer campaign fixtures (`viewer/fixtures/build.ts:565`): the viewer reads campaign state loosely, so the v1 shape is fine.

**Untracked files, not in base 3194976.** `plugins/tribe/scripts/tests/runner-driver-only/*.ts` are scripts, not tests. `render-prompts.ts` (lines 15, 22, 30, 102, 116, 155, 164) and `g3-verify-replay.ts` (13) import `RATIFY_TEMPLATE_PATH`, `TRIBE_PLUGIN_DIR` and `BRIEF_TEMPLATE_PATH`, and list `gapGateStamped`/`ledgerCommitted`.

## Count per file

| File | BREAK | COND | TSC / FIX |
|---|---|---|---|
| core/brief.test.ts | 3 | 1 | — |
| core/verify.test.ts | 17 (plus whole file) | — | 2 FIX |
| core/session.test.ts | 1 | 2 (plus whole file) | — |
| core/loop.test.ts | 61 (60 from (f); 2999 overlaps; plus whole file) | — | 6 TSC, 2 FIX |
| core/report.test.ts | 3 (plus whole file) | — | — |
| core/state.test.ts | 38 | — | 1 FIX |
| core/rulings.test.ts | — | 17 | — |
| core/loop/card-actions.test.ts | 0 | — | 1 TSC |
| cli/main.test.ts | 5 | — | 1 TSC |
| supervisor/brief.test.ts | 3 (plus whole file) | 1 | 2 TSC |
| supervisor/decide.test.ts | 8 | — | 1 TSC |
| supervisor/verify.test.ts | 6 (plus whole file) | — | 11 TSC |
| supervisor/loop.test.ts | 4 (plus whole file) | 3 | 2 FIX |
| supervisor/replay.test.ts | 1 (plus whole file) | — | — |
| supervisor/args.test.ts | 5 | — | — |
| supervisor/state.test.ts | — | 3 | — |
| supervisor/status.test.ts | 4 | — | 3 TSC |
| supervisor/truth.test.ts | 1 | — | 3 TSC |
| supervisor/session.test.ts | 0 | — | about 14 TSC |
| supervisor/session.e2e.test.ts | — | whole file (`TRIBE_PLUGIN_DIR`) | 1 TSC |
| supervisor/campaign-home-carryover.e2e.test.ts | — | whole file | — |
| core/session.e2e.test.ts | — | whole file | — |
| watchdog/decide.test.ts | — | 8 | — |
| watchdog/watch-loop.test.ts | — | 1 | — |
| watchdog-integration.test.ts | — | 1 | 1 FIX |
| viewer/e2e/campaign-badge.e2e.test.ts | 1 | — | 1 FIX |
| test-supervisor-e2e.sh | 12 checks | — | 1 FIX |
| test-supervisor-kill.sh | 9 checks | — | 1 FIX |
| test-watchdog-e2e.sh | 5 checks | — | 1 FIX |
| test-supervisor-repro.sh (gated) | 3 checks | — | 1 TSC, 1 FIX |
| test-supervisor-real-e2e.sh (gated) | 1 or more checks | — | 1 FIX |
| test-supervisor-park-truth.sh | possible (G2/G3) | — | 1 FIX |
| test-watchdog-stall-relaunch.sh | 0 likely | — | 2 FIX |
| test-supervisor-docs.sh | — | flags-parity loop | — |
| test-verify-shipped.sh | 0 (default kept by (i)) | — | — |

## Re-check on the post-#173 base

Task 1.1 re-ran this sweep on `9393bb0` (master, after campaign `sessions-in-repo` / #173 merged),
per the file's own instruction ("Task 1.1 re-checks it on the post-#173 base; any assertion a task
changes that is not listed here is a finding"). Method: every file named by a `###` section header
or a table's `File` column above still exists at the same path (checked with `test -f` — none
deleted, none moved to a new path); every backtick-quoted test title, `describe(...)` block name,
generated-test template, and fixture/shell-check string named in the tables above was located with
a literal (or ellipsis-split, for titles abbreviated with `…`) substring search against that file's
current contents on `9393bb0`. Sampled items that a first automated pass reported as "not found"
were re-checked by hand with `grep -n`; every one was a false alarm from the checker's exact-string
matching (a curly em dash, a `describe('...')` vs `describe("...")` quote style, a `test(\`...\`)`
template literal built from the same `BOUNDED` flag table the doc already cites, or a `File` column
value left blank on a continuation row of a merged Markdown cell) — not real drift. Confirmed by
hand, still present verbatim on `9393bb0`, same file, same identifier:
`parseGapGateStamp` (`core/verify.test.ts`, import + `describe('parseGapGateStamp', …)` + both its
`test(...)`s), `fixtureState()` (`core/loop.test.ts:77`), `describe('renderBrief — ratify', …)`
(`core/supervisor/brief.test.ts:177`), `extractRulingBlockVerbatim` import and
`describe('extractRulingBlockVerbatim — the ratify brief's verbatim-block extractor', …)`
(`core/supervisor/loop.test.ts:9,788`), `test('buildOneShotPrompt renders the closing brief with
the CAMPAIGN-home report's open ids, …')` (`core/supervisor/loop.test.ts:871`), the
`--max-ratify-rounds` row of the `BOUNDED` table and its four generated `test(\`${flag}: …\`)` titles
(`core/supervisor/args.test.ts:102`), the `[5, …, 'exit:needs_human:rulings_unratified']` rows and
`TABLE.length).toBe(48)` (`core/watchdog/decide.test.ts:104-116`), `[5, 10, 'rulings_unratified']`
(`core/watchdog/watch-loop.test.ts:223`), `['5:none', 10, 'rulings_unratified']`
(`plugins/tribe/scripts/runner/watchdog-integration.test.ts:123`), the Haiku 4.5 campaign-run test
title (`plugins/tribe/scripts/viewer/e2e/campaign-badge.e2e.test.ts:379`), `TRIBE_PLUGIN_DIR` import
and the `for (const kind of ['ruling', 'ratify'] as const)` loop
(`core/supervisor/session.e2e.test.ts:12,179`), and every named shell check in
`test-supervisor-kill.sh`, `test-watchdog-e2e.sh`, `test-supervisor-repro.sh`,
`test-supervisor-park-truth.sh`, `test-supervisor-real-e2e.sh` and `test-supervisor-docs.sh` listed
in the "Shell tests" table above.

**Result: zero titles moved to a different file, and zero titles vanished.** Only ordinary
line-number drift occurred (expected; Global Constraints already rule line numbers out as a
locator — "#173 has moved lines since"), plus the volume changes `bun run check` itself reports
(1357 pass / 14 skip / 0 fail on `9393bb0`, up from the 1351/14/0 baseline on `3194976` — #173 added
tests, it did not touch any test this sweep names). No entry needs to be added to or removed from
the tables above; the sweep's file:line pins for locating each assertion may be stale by a handful
of lines, but every assertion, `describe` block and fixture string it names is still exactly where
this document says it is, in the same file, on the post-#173 base.