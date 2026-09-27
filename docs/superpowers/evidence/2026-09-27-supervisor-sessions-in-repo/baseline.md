# Baseline — supervisor-sessions-in-repo (Task 1, run on base)

Card: `supervisor-sessions-in-repo` (issue #173). Base for the plan is `daf4f9c`; this worktree's
branch tip when this baseline was recorded is `7c7172f` (master with only the spec/plan docs added
on top of `daf4f9c` — no code changed in between, so these numbers are the real BEFORE state for
Task 1's two ratchets).

## G4 — guard footprint (`g4-guard-footprint.sh`)

The script excludes its own path from the `git grep` scan (it names the identifiers it hunts, so
without the exclusion it would count itself and the ratchet's `identifier_hits=0` floor at the end
of the campaign would be unreachable). This number is measured with the script TRACKED (`git add`)
— `git grep` only sees tracked files, and the untracked number is 2 higher (151) purely from the
script's own `IDS=`/`old=absent` lines, not from any real guard code.

```
$ bash $S/tests/sessions-in-repo/g4-guard-footprint.sh
guard_files_lines=1070 identifier_hits=149 old_rule=present new_rule=absent c3_check=ok
```

Matches the plan's stated expectation exactly (`guard_files_lines=1070 identifier_hits=149
old_rule=present new_rule=absent c3_check=ok`), even though the plan flagged that the branch tip
had moved past the measured base — the docs-only commits between `daf4f9c` and `7c7172f` touched
neither `plugins/tribe/scripts/runner` guard files nor the `.c3` surfaces the identifier scan
covers, so the footprint is unchanged.

## G1 — transcript vs. log cwd (`g1-transcript-cwd.ts`), against the real prior campaign

```
$ bun $S/tests/sessions-in-repo/g1-transcript-cwd.ts --home ~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings --repo /Users/hiep/repo/tribe
148705ea-963b-4717-bb90-ee69a24079b1 ? log=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings transcript=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings FAIL
1bf2bdf3-c96d-499b-826f-0932f09bd3e3 closing log=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings transcript=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings FAIL
3d0f1f07-1d79-4c44-8e9c-cc84c303d1a1 ratify log=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings transcript=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings FAIL
755daa23-83b4-4031-8210-4f59975fc435 ? log=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings transcript=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings FAIL
789e9dea-ca0b-4274-8860-0c5eb400208f closing log=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings transcript=/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings FAIL
G1 0/5 kinds=?,closing,ratify
```

All five of the prior campaign's supervisor sessions (`ratify`, two `closing`, two unattributed —
`?`, no matching ledger row) recorded `cwd` = the campaign home in BOTH the SDK transcript and the
session log — the exact defect this card fixes. Matches the plan's stated expectation
(`G1 0/5 kinds=?,closing,ratify`) exactly.

## G1 — fail-closed edge, missing `--home`

```
$ bun $S/tests/sessions-in-repo/g1-transcript-cwd.ts --repo /Users/hiep/repo/tribe; echo "rc=$?"
usage: g1-transcript-cwd.ts --home <campaign home> --repo <repo root> [--projects <dir>]
rc=2
```

One stderr line, `rc=2` — matches the plan's stated expectation exactly.

---

# Baseline — Task 2 (the G8 comparator, run on the real prior campaign)

## G8 — ledger tree vs. truth on disk (`g8-ledger-tree.ts`)

```
$ bun $S/tests/sessions-in-repo/g8-ledger-tree.ts --home ~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings
{"truth":{"sessions":41,"edges":34},"ledger":{"total":41,"present":3,"edgesTotal":34,"edgesCorrect":0,"extra":[],"missing":["148705ea-963b-4717-bb90-ee69a24079b1","39a316ee-5998-4d46-b7ee-edb6758a7b3f","755daa23-83b4-4031-8210-4f59975fc435","a010d8d5990b5fe05","a04ddd89d89cfddbb","a10655532f4134b46","a11ec89e727992f32","a246d139dcbaa80e7","a27dca034a8743d34","a36903cd7d75f1989","a39d827494a7bcf70","a3a2dd54adb5f4a4c","a3a8f8cb1b441157b","a4133ccce22a7e93f","a5432ee30b4f5605a","a60e3065aa76b5c9a","a6554f0db6d489d3d","a6eb9472b691f8a4a","a7f5a0270cf4f4ec4","a7f86830ecf9aab33","a84de93778296b9d9","a84e9bc90c1162bfe","a89d2e93038c88e49","a91a5adec9df2948a","a97d42153281bf5ec","aa8b0abe28ea271fa","aabe5c204d9bb6939","ab7d9b518159221c7","ac89519e01d7445db","acec54c225c41dd89","ad2e8ad5dc5479bed","ad316fa1a4725f997","aeeb4e8f871800a24","af547729fc03a2e06","af5ef6427a6270b0d","afc8f06e7193aff3e","afd662d18f3012db2","b3bf06c3-8e61-4fd0-ade3-e6bdb542c788"],"wrongEdges":["a010d8d5990b5fe05 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a04ddd89d89cfddbb claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a10655532f4134b46 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a11ec89e727992f32 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a246d139dcbaa80e7 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a27dca034a8743d34 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a36903cd7d75f1989 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a39d827494a7bcf70 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a3a2dd54adb5f4a4c claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a3a8f8cb1b441157b claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a4133ccce22a7e93f claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a5432ee30b4f5605a claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a60e3065aa76b5c9a claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a6554f0db6d489d3d claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a6eb9472b691f8a4a claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a7f5a0270cf4f4ec4 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a7f86830ecf9aab33 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a84de93778296b9d9 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a84e9bc90c1162bfe claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","a89d2e93038c88e49 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a91a5adec9df2948a claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","a97d42153281bf5ec claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","aa8b0abe28ea271fa claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","aabe5c204d9bb6939 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","ab7d9b518159221c7 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","ac89519e01d7445db claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","acec54c225c41dd89 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","ad2e8ad5dc5479bed claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","ad316fa1a4725f997 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788","aeeb4e8f871800a24 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","af547729fc03a2e06 claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","af5ef6427a6270b0d claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","afc8f06e7193aff3e claimed=none truth=39a316ee-5998-4d46-b7ee-edb6758a7b3f","afd662d18f3012db2 claimed=none truth=b3bf06c3-8e61-4fd0-ade3-e6bdb542c788"]},"llm":null}
```

Matches the plan's and the spec's (§5, row G8) stated expectation exactly:
`"truth":{"sessions":41,"edges":34}`, ledger `"present":3`, `"edgesCorrect":0`, `"extra":[]`.

How the two truth numbers are composed on disk, verified by hand while writing the tool:

- **41 sessions** = 2 executor roots (`runs/*/logs/<card>-<uuid>.log` — `39a316ee-…` and
  `b3bf06c3-…`; `b3bf06c3-…` appears in two run folders, the same resumed session, so it is one
  id) + 5 supervisor roots (`supervisor/sessions/<uuid>.log`) + 34 subagents
  (`~/.claude/projects/*/<root>/subagents/agent-*.meta.json`: 16 under `39a316ee-…`, 18 under
  `b3bf06c3-…`).
- **34 edges** = one per subagent. Every one of the 34 `meta.json` files records
  `spawnDepth: 1` and carries **no** `parentAgentId` key at all, so each subagent's parent is the
  root that owns its transcript folder. There is no depth ≥ 2 subagent in this campaign — the
  depth-2 parent path (`parentAgentId`) is implemented but is not exercised by this baseline; the
  owner run is what will exercise it.
- **ledger `present: 3`** — the ledger has 4 rows, all legacy end rows (no `event` field), and one
  of them carries `sessionId: null` (the `closing` timeout, today's attribution gap). 3 usable ids,
  all 3 known to the truth, hence `extra: []`. No row carries any parent information, so
  `edgesCorrect: 0` out of 34.

`wrongEdges` lists all 34 as `claimed=none truth=<root>`; it is diagnostic only and is never
counted.

## G8 — fail-closed edges (not a plan Verify row; recorded because the tool is an edge)

```
$ bun g8-ledger-tree.ts
usage: g8-ledger-tree.ts --home <campaign home> [--projects <dir>] [--llm <file>]
rc=2
$ bun g8-ledger-tree.ts --home --projects /tmp
--home needs a value
rc=2
$ bun g8-ledger-tree.ts --home /tmp/nope-17304
unreadable ledger: /tmp/nope-17304/supervisor/ledger.jsonl: ENOENT: no such file or directory, open '/tmp/nope-17304/supervisor/ledger.jsonl'
rc=2
$ cd ~/.tribe/-Users-hiep-repo-tribe/campaigns && bun <abs path>/g8-ledger-tree.ts --home fu-supervisor-settings
{'sessions': 41, 'edges': 34} 3 0      # a RELATIVE --home gives the same answer (fields extracted)
```

A missing `--home`, a flag whose value was swallowed by the next flag, and a home with no ledger
each refuse with one stderr line and `rc=2` — a missing ledger is a refusal, never a score of zero.

---

# Baseline — Task 3 (the G5 badge probe, run on the base build)

## Chromium resolution

Playwright's own bundled Chromium is NOT installed on this host (spec §5.1), confirmed directly:

```
$ bun -e "import { resolveChromiumExecutable } from './e2e/browser.ts'; resolveChromiumExecutable();"
playwright failed: no Chromium executable found in Playwright's registry (expected at
/Users/hiep/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for
Testing.app/Contents/MacOS/Google Chrome for Testing) — run: bunx playwright install chromium
```

So `badge-probe.ts` fell through to the system Google Chrome fallback,
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, which exists on this host.

## G5 — badge probe against the base build (`bun run build`, `serve.ts --port 4411`)

```
$ cd $S/viewer && bun run build
✓ built in 287ms
$ (bun serve.ts --port 4411 &)
tribe viewer: http://127.0.0.1:4411 (projects root: /Users/hiep/.claude/projects) — read-only, refresh to update
$ bun tools/badge-probe.ts --base http://127.0.0.1:4411 --slug fu-supervisor-settings --shots /tmp/g5-base \
  3d0f1f07-1d79-4c44-8e9c-cc84c303d1a1 789e9dea-ca0b-4274-8860-0c5eb400208f 755daa23-83b4-4031-8210-4f59975fc435 \
  148705ea-963b-4717-bb90-ee69a24079b1 1bf2bdf3-c96d-499b-826f-0932f09bd3e3 | tail -1
G5 0/5
$ pkill -f 'serve.ts --port 4411'
```

Full per-session output (before `tail -1`):

```
{"id":"3d0f1f07-1d79-4c44-8e9c-cc84c303d1a1","badges":[],"pass":false}
{"id":"789e9dea-ca0b-4274-8860-0c5eb400208f","badges":[],"pass":false}
{"id":"755daa23-83b4-4031-8210-4f59975fc435","badges":[],"pass":false}
{"id":"148705ea-963b-4717-bb90-ee69a24079b1","badges":[],"pass":false}
{"id":"1bf2bdf3-c96d-499b-826f-0932f09bd3e3","badges":[],"pass":false}
G5 0/5
```

Matches the plan's stated expectation exactly (`G5 0/5`): none of the five prior supervisor
sessions render a `.campaign-badge` at all on base, so `badges` is `[]` for every one and `pass`
is `false` for every one — the honest BEFORE number.

## G5 — fail-closed argument handling (not a plan Verify row; recorded because the probe is an edge)

```
$ bun tools/badge-probe.ts --help
badge-probe: unknown flag --help
rc=2
$ bun tools/badge-probe.ts --base http://x --slug s --unknownflag
badge-probe: unknown flag --unknownflag
rc=2
$ bun tools/badge-probe.ts --base --slug s abc
badge-probe: --base expects a value
rc=2
$ bun tools/badge-probe.ts --base http://x abc
badge-probe: --slug is required
rc=2
```

An unknown flag and a flag whose value would otherwise be swallowed by the next flag's name each
refuse with one stderr line and `rc=2`, never silently consuming the next argv token as a value.

---

# Baseline — Task 4 RED: the acceptance E2E (G2 + G3) on base

`core/supervisor/campaign-home-carryover.e2e.test.ts` is the acceptance test for this whole card
(spec §6, "Acceptance first"). It is written now and is EXPECTED to be RED until Tasks 5–7 land.
This section is its BEFORE state: the G2 and G3 rows of the spec's §5 Verification contract,
measured on base with no production code changed (branch tip `c6a970a`, which added only the
Task 1–3 measurement tools).

## The RED run, verbatim

```
$ cd $S/runner && env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 bun test core/supervisor/campaign-home-carryover.e2e.test.ts
bun test v1.4.2 (744846f84)

core/supervisor/campaign-home-carryover.e2e.test.ts:
79 |   const w = makeWorld(label);
80 |   try {
81 |     const plants = nested ? nestedPlants(w) : rootPlants(w);
82 |     await run(writer, how === 'Write' ? writePrompt(w, plants) : bashPrompt(w, plants), w);
83 |     // The plant LANDED — read from disk, not from the transcript (G-007).
84 |     for (const rel of Object.keys(plants)) expect(existsSync(join(w.home, rel))).toBe(true);
                                                                                      ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at pair (/Users/hiep/repo/tribe-wt/supervisor-sessions-in-repo/plugins/tribe/scripts/runner/core/supervisor/campaign-home-carryover.e2e.test.ts:84:82)
(fail) campaign-home configuration never loads (card supervisor-sessions-in-repo, G2) > ruling plants with Write -> ruling [17.45ms]
79 |   const w = makeWorld(label);
80 |   try {
81 |     const plants = nested ? nestedPlants(w) : rootPlants(w);
82 |     await run(writer, how === 'Write' ? writePrompt(w, plants) : bashPrompt(w, plants), w);
83 |     // The plant LANDED — read from disk, not from the transcript (G-007).
84 |     for (const rel of Object.keys(plants)) expect(existsSync(join(w.home, rel))).toBe(true);
                                                                                      ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at pair (/Users/hiep/repo/tribe-wt/supervisor-sessions-in-repo/plugins/tribe/scripts/runner/core/supervisor/campaign-home-carryover.e2e.test.ts:84:82)
(fail) campaign-home configuration never loads (card supervisor-sessions-in-repo, G2) > closing plants with Bash -> ruling [11.91ms]
79 |   const w = makeWorld(label);
80 |   try {
81 |     const plants = nested ? nestedPlants(w) : rootPlants(w);
82 |     await run(writer, how === 'Write' ? writePrompt(w, plants) : bashPrompt(w, plants), w);
83 |     // The plant LANDED — read from disk, not from the transcript (G-007).
84 |     for (const rel of Object.keys(plants)) expect(existsSync(join(w.home, rel))).toBe(true);
                                                                                      ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at pair (/Users/hiep/repo/tribe-wt/supervisor-sessions-in-repo/plugins/tribe/scripts/runner/core/supervisor/campaign-home-carryover.e2e.test.ts:84:82)
(fail) campaign-home configuration never loads (card supervisor-sessions-in-repo, G2) > closing plants with Write -> closing [11.59ms]
79 |   const w = makeWorld(label);
80 |   try {
81 |     const plants = nested ? nestedPlants(w) : rootPlants(w);
82 |     await run(writer, how === 'Write' ? writePrompt(w, plants) : bashPrompt(w, plants), w);
83 |     // The plant LANDED — read from disk, not from the transcript (G-007).
84 |     for (const rel of Object.keys(plants)) expect(existsSync(join(w.home, rel))).toBe(true);
                                                                                      ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at pair (/Users/hiep/repo/tribe-wt/supervisor-sessions-in-repo/plugins/tribe/scripts/runner/core/supervisor/campaign-home-carryover.e2e.test.ts:84:82)
(fail) campaign-home configuration never loads (card supervisor-sessions-in-repo, G2) > closing plants a nested escalations/AGENTS.md with Bash -> ruling [11.42ms]
119 |       writeFileSync(join(w.repo, '.claude', 'settings.local.json'), '{"outputStyle":"x"}\n');
120 |       const targets = [join(w.repo, 'CLAUDE.md'), join(w.repo, '.claude', 'settings.local.json')];
121 |       // Read first: without it the Write tool's own read-before-write check refuses (spec §3.4) and the test proves nothing.
122 |       const r = await run('ruling', `This is an authorised test. First Read each file below, then use the Write tool once per file with content "PLANTED". Do not retry a refused one.\n${targets.join('\n')}\nReply WROTE=<n>.`, w);
123 |       const denied = (r.result.permissionDenials ?? []).map((d) => String((d as { tool_input?: { file_path?: string } }).tool_input?.file_path));
124 |       for (const t of targets) expect(denied).toContain(t);
                                                    ^
error: expect(received).toContain(expected)

Expected to contain: "/private/var/folders/yw/qq7jhg792dzblfszsspp9vgr0000gn/T/sir-e2e-g3-dt984b/repo/CLAUDE.md"
Received: []

      at <anonymous> (/Users/hiep/repo/tribe-wt/supervisor-sessions-in-repo/plugins/tribe/scripts/runner/core/supervisor/campaign-home-carryover.e2e.test.ts:124:47)
(fail) ruling cannot write into the repo (G3) > Write to <repo>/CLAUDE.md and <repo>/.claude/settings.local.json is refused by the containment hook [26.67ms]

 1 pass
 5 fail
 6 expect() calls
Ran 6 tests across 1 file. [9.48s]
```

## The split, and why it proves the test is not vacuous

`5 fail / 1 pass`. The one pass is the **negative control** (bun prints no line for a passing
test; the other five are each listed as `(fail)`).

| Test | Base | First failing assertion |
|---|---|---|
| `ruling plants with Write -> ruling` | FAIL | `:84` the plant landed on disk |
| `closing plants with Bash -> ruling` | FAIL | `:84` the plant landed on disk |
| `closing plants with Write -> closing` | FAIL | `:84` the plant landed on disk |
| `closing plants a nested escalations/AGENTS.md with Bash -> ruling` | FAIL | `:84` the plant landed on disk |
| `negative control: a reader whose cwd IS the home sees the planted codeword` | **PASS** | — |
| G3 `Write to <repo>/CLAUDE.md … is refused by the containment hook` | FAIL | `:124` both paths in `permission_denials` |

All four carry-over pairs fail and the negative control passes — the exact split that makes the
four pairs meaningful. The negative control is the proof that the probe **can** see the campaign
home loading; measured directly (diagnostic probe, uncommitted, same plants and same envelope with
`cwd` = the home) it fires on every channel at once, not on a technicality:

```
{"codewordInTranscript": true,
 "markers": ["local-Stop","mcp-started","project-SessionStart","project-UserPromptSubmit",
             "local-UserPromptSubmit","project-PreToolUse","local-PreToolUse","local-SessionStart",
             "project-Stop"],
 "initCwd": "/private/var/folders/…/sir-probe-control-Riazm5/home"}
```

So each of `pair()`'s three assertions is a real discriminator: with the home loaded, the reader's
init `cwd` IS the home, nine hook markers fire, the `.mcp.json` server starts, and the planted
codeword reaches the transcript.

## DEVIATION from the plan's predicted RED — G3 fails on base, and why

The plan's Task 4 says "the negative control **and G3** pass". Measured, **G3 fails on base**, and
the four pairs fail earlier than the plan predicted. One single cause, mechanically confirmed —
`runOneShotSession` on base never spawns a session at all through this test's seam:

```
$ bun -e 'runOneShotSession({kind:"ruling",…}, {spawnSession, onSessionStart, appendLog})'
{"outcome": "error",
 "finalText": "refusing to spawn: the campaign home's configuration could not be read
               (io.snapshotHomeConfig is not a function. …)",
 "permissionDenials": null}
```

`OneShotSessionSeam.snapshotHomeConfig`/`restoreHomeConfig` (layer 2) are **required, not
optional** members on base, deliberately so — `session.ts`: "Required, never optional: an optional
member would let a caller skip the restore silently". The Task 4 test supplies the three-member
seam that exists only after Task 6, so `runOneShotSession` fails closed before any spawn. Hence
every test routed through the `run()` helper fails in ~12–27 ms with no real session:

- the four pairs fail at their FIRST assertion, "the plant landed on disk" — the plan's predicted
  cause ("layer 1 refuses the Write, layer 2 undoes the Bash") is never reached, but its predicted
  EFFECT is exactly what is observed: the plant does not land;
- G3 gets `permissionDenials: null` → `[]`, so `expect(denied).toContain(target)` fails.

The negative control passes because it is the one test that bypasses `runOneShotSession` entirely
— it calls `buildOneShotOptions` + `sdkSpawnSession` directly.

Consequence for the plan's sequencing: **Task 6** (which deletes the layer-2 seam members) is what
lets G3 and the four pairs run a real session at all. The plan's Task 7 Verify note ("the four
pairs are expected to pass now") should be read as covering G3 as well — on base G3 is RED, so its
`refused → refused` ratchet is re-established by Tasks 6–7 rather than held green throughout.

## Task 4 Verify, verbatim

```
$ cd $S/runner && bunx tsc --noEmit && bun test core/supervisor/campaign-home-carryover.e2e.test.ts 2>&1 | tail -3
tsc rc=0
 0 pass
 6 skip
 0 fail
```

The `tsc` exit 0 depends on the `exclude` entry this task adds to `runner/tsconfig.json`; that
exclusion is load-bearing, measured by removing it:

```
$ bunx tsc --noEmit          # with "exclude": []
core/supervisor/campaign-home-carryover.e2e.test.ts(61,19): error TS2353: Object literal may only
  specify known properties, and 'cardId' does not exist in type 'RunOneShotInput'.
```

Task 10 adds `cardId`/`ledgerPath` to `RunOneShotInput` and removes the exclusion.
