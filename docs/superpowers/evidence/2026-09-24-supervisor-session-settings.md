# Evidence — supervisor-session-settings (issue #163)

## BEFORE

**Base SHA:** `4248081c10ed35f9e04ba13be3cdfbacc66dbf4f` (`git rev-parse HEAD`, branch
`feat/supervisor-session-settings`, no code changed yet — the branch carries only the docs
commits for the spec and plan on top of the plan's stated base `d6cad2f`).

Commands run, exactly as Task 1 specifies:

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings
for r in ~/.tribe \
         ~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings \
         ~/.claude/projects/-Users-hiep-repo-tribe; do
  bun plugins/tribe/scripts/session-hygiene.ts --root "$r" --json
done
```

### `--root ~/.tribe`

```json
{
  "root": "/Users/hiep/.tribe",
  "unknownSkills": {
    "c3": 26
  },
  "filesystemWideScans": 0,
  "totalUnknownSkills": 26
}
```

### `--root ~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings`

```json
{
  "root": "/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings",
  "unknownSkills": {
    "c3": 26
  },
  "filesystemWideScans": 0,
  "totalUnknownSkills": 26
}
```

### `--root ~/.claude/projects/-Users-hiep-repo-tribe`

```json
{
  "root": "/Users/hiep/.claude/projects/-Users-hiep-repo-tribe",
  "unknownSkills": {
    "c3": 164,
    "verify-shipped": 7,
    "X": 1
  },
  "filesystemWideScans": 3,
  "totalUnknownSkills": 172
}
```

## Spec §4.3 — Probe 1, the ratchet baseline (G5), copied verbatim

**This machine is fresh.** Which roots, and what each holds:

| Root | Contents | `unknownSkills` | `filesystemWideScans` |
| --- | --- | --- | --- |
| `~/.tribe` | **empty of logs** (0 `*.log`/`*.jsonl` files) | `{}` | 0 |
| `~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings` (this campaign's home; supervisor sessions log to `<home>/supervisor/sessions/`) | **empty** | `{}` | 0 |
| `~/.claude/projects/-Users-hiep-repo-tribe` (interactive + planning transcripts, cwd = repo) | real transcripts | `{c3: 43, verify-shipped: 6}` | 0 |
| `~/.claude/projects` (all) | real transcripts | `{c3: 43, verify-shipped: 6}` | 1 |

Commands: `bun plugins/tribe/scripts/session-hygiene.ts --root <root> --json`, run at `d6cad2f`.

**The supervisor-session root that G5 speaks about is empty on this machine**, so its baseline is
"0 of 0" and proves nothing by itself. The informative baseline is the probe corpus, separated by
envelope (the same tool, `--root /private/tmp/sss-probe/ratchet/<group>`):

| Corpus | Sessions | `Unknown skill` | Filesystem-wide scans |
| --- | --- | --- | --- |
| today's envelope (control) | 6 | **12** (`c3`) | 1 |
| tiers loaded (treatment) | 8 | **0** | 1 |

The scan in each corpus is the **instructed** `find / -maxdepth 1 -name PROBE_NOPE` in the
`closing` grant probe. The counter counts Bash `tool_use` *attempts*, not executions
(`core/metrics/session-hygiene.ts`), which matters for the plan (§7): the G2 refusal test attempts
a scan on purpose, so its log must not sit in the G5 root.

## Note (carried verbatim, Task 1)

> The supervisor-session root G5 speaks about (`<campaign home>/supervisor/sessions/`) is empty on
> this machine, so its before-count of 0 proves nothing on its own. The ratchet that decides G5 is
> Task 7's own sessions, run once with the envelope reverted (`before/`) and once as built
> (`after/`), measured by this same tool in Task 8. Historical totals under `~/.claude/projects`
> can only grow; they are context, not the target.

## AFTER

Commands run, exactly as Task 8 specifies:

```bash
cd /Users/hiep/repo/tribe-wt/supervisor-session-settings
E=~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence
for r in "$E/before/sessions" "$E/after/sessions" "$E/before/adversarial" "$E/after/adversarial"; do
  bun plugins/tribe/scripts/session-hygiene.ts --root "$r" --json
done
```

### `--root $E/before/sessions`

```json
{
  "root": "/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence/before/sessions",
  "unknownSkills": {
    "c3": 12,
    "verify-shipped": 4
  },
  "filesystemWideScans": 0,
  "totalUnknownSkills": 16
}
```

### `--root $E/after/sessions`

```json
{
  "root": "/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence/after/sessions",
  "unknownSkills": {},
  "filesystemWideScans": 0,
  "totalUnknownSkills": 0
}
```

### `--root $E/before/adversarial`

```json
{
  "root": "/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence/before/adversarial",
  "unknownSkills": {},
  "filesystemWideScans": 1,
  "totalUnknownSkills": 0
}
```

### `--root $E/after/adversarial`

```json
{
  "root": "/Users/hiep/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence/after/adversarial",
  "unknownSkills": {},
  "filesystemWideScans": 1,
  "totalUnknownSkills": 0
}
```

### `sessions` — before → after (the G5 gate)

| Corpus | `unknownSkills` | `filesystemWideScans` |
| --- | --- | --- |
| `before/sessions` (envelope reverted to `d6cad2f`) | `{c3: 12, verify-shipped: 4}` — 16 total | 0 |
| `after/sessions` (envelope as built) | `{}` — 0 total | 0 |

**The G5 gate holds exactly:** `after/sessions` reads `"unknownSkills": {}` and
`"filesystemWideScans": 0`, verbatim. `before/sessions` shows `Unknown skill: c3` 12 times (≥ 3,
one per kind, as Task 8 predicted); the `verify-shipped` unknown-skill count in `before/sessions`
(4) is a different skill's before-count, from the two `verify-shipped` probe sessions run at the
reverted envelope — not part of G5's own gate, which names `Unknown skill: c3`/scans only.

### `adversarial` — before → after

| Corpus | `unknownSkills` | `filesystemWideScans` (attempts) |
| --- | --- | --- |
| `before/adversarial` | `{}` | 1 |
| `after/adversarial` | `{}` | 1 |

Both corpora hold the two sessions Task 7 deliberately told to break a wall (`closing-scan.jsonl`,
`closing-grant.jsonl`), logged outside the `sessions/` root by the E2E harness's own
`opts.adversarial` routing so they never dilute G5. The one Bash `find` attempt the counter finds
in each corpus is the SAME instructed command (`find / -maxdepth 1 -name TRIBE_E2E_NOPE`) from the
scan-wall test; `core/metrics/session-hygiene.ts` counts a Bash `tool_use` **attempt**, not an
execution (spec §4.3). In `before/adversarial` the attempt ran (BEFORE chunk 2:
`permission_denials: []`, no scan-wall message). In `after/adversarial` the identical attempt was
refused — Task 7's own assertion on the same run, `expect(deniedTools(run.result)).toContain('Bash')`,
passed (AFTER chunk 2: `1 pass, 0 fail`) — so the attempt-count staying at 1 before → after is not
a regression; it is the same attempt, once let through and once refused.

## E2E

The exact Task 7 commands (four foreground chunks, one `SUPERVISOR_E2E_LOG_DIR` per side, forced
by the 600-second harness wall — see Task 7's report,
`~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/reports/supervisor-session-settings.md`,
section "## Task 7 — the real-session E2E (G1, G2, G4, R1)"), and their pass/fail summaries,
verbatim from that report:

```bash
E=~/.tribe/-Users-hiep-repo-tribe/campaigns/fu-supervisor-settings/evidence
# BEFORE — envelope reverted to d6cad2f (session.ts, permit.ts)
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/before" bun test core/supervisor/session.e2e.test.ts -t "Skill c3 returns C3 content"
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/before" bun test core/supervisor/session.e2e.test.ts -t "is refused by the scan wall"
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/before" bun test core/supervisor/session.e2e.test.ts -t "verify-shipped"
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/before" bun test core/supervisor/session.e2e.test.ts -t "a loaded allow rule for Workflow"
# revert restored, then GREEN — envelope as built
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/after" bun test core/supervisor/session.e2e.test.ts -t "Skill c3 returns C3 content"
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/after" bun test core/supervisor/session.e2e.test.ts -t "is refused by the scan wall"
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/after" bun test core/supervisor/session.e2e.test.ts -t "verify-shipped"
env -u ANTHROPIC_API_KEY RUN_SESSION_E2E=1 SUPERVISOR_E2E_LOG_DIR="$E/after" bun test core/supervisor/session.e2e.test.ts -t "a loaded allow rule for Workflow"
```

**BEFORE (envelope reverted to `d6cad2f`), pass/fail summaries, one per chunk:**

- Chunk 1 (`-t "Skill c3 returns C3 content"`, 3 tests: closing, ruling, ratify): `0 pass, 4
  filtered out, 3 fail, 3 expect() calls`. All three failed
  `expect(received).not.toContain(expected)`, `Expected to not contain: "Unknown skill"`, with
  `Unknown skill: c3. Did you mean cd?` in the received transcript.
- Chunk 2 (`-t "is refused by the scan wall"`, 1 test): `0 pass, 6 filtered out, 1 fail, 2
  expect() calls`. Failed `expect(received).toContain(expected)`,
  `Expected to contain: "Filesystem-wide scans are disabled for campaign sessions"` — the `find /`
  ran (`permission_denials: []`).
- Chunk 3 (`-t "verify-shipped"`, 2 tests): `2 pass, 5 filtered out, 0 fail, 4 expect() calls`.
  Both pass at base (the hand-load already existed). `G4_WITH_PLUGIN registered as:
  ["verify-shipped:verify-shipped"]`; `G4_WITHOUT_PLUGIN=unknown registered as: []`.
- Chunk 4 (`-t "a loaded allow rule for Workflow"`, 1 test): `0 pass, 6 filtered out, 1 fail, 2
  expect() calls`. Failed `expect(received).toContain(expected)`,
  `Expected to contain: "This closing session is not granted this tool"` — at base the `local`
  tier is not loaded, so the SDK's own "Review dynamic workflow before running" gate denied
  `Workflow` instead of the plan's grant-hook message (a same-class, code-shape reason, not a
  setup/auth failure).

Total BEFORE: 3 + 1 + 2 + 1 = **7 tests accounted for; 5 fail (as predicted), 2 pass** (both
`verify-shipped`-with-plugin cases).

**AFTER (envelope as built), pass/fail summaries, one per chunk:**

- Chunk 1 (`-t "Skill c3 returns C3 content"`, 3 tests): `3 pass, 4 filtered out, 0 fail, 16
  expect() calls`.
- Chunk 2 (`-t "is refused by the scan wall"`, 1 test): `1 pass, 6 filtered out, 0 fail, 3
  expect() calls`.
- Chunk 3 (`-t "verify-shipped"`, 2 tests): `2 pass, 5 filtered out, 0 fail, 4 expect() calls`.
  `G4_WITH_PLUGIN registered as: ["verify-shipped","verify-shipped:verify-shipped"]`;
  `G4_WITHOUT_PLUGIN=resolved registered as: ["verify-shipped"]`.
- Chunk 4 (`-t "a loaded allow rule for Workflow"`, 1 test): `1 pass, 6 filtered out, 0 fail, 2
  expect() calls`.

Total AFTER: 3 + 1 + 2 + 1 = **7 pass, 0 fail — all 7 tests green as built.** Together the four
chunks account for all 7 tests, on both sides, as the task brief requires; no chunk's own summary
line was paraphrased into a single "7 pass" the run never printed in one piece.

**Hermetic check** (`bun test`, no `RUN_SESSION_E2E`): `0 pass, 7 skip, 0 fail` — `bun test` stays
hermetic.

## G4 verdict

**Decision: keep the hand-load.** `closing`'s `options.plugins` load of `verify-shipped` is kept
after the user settings tier loaded, per spec §4.4 (Task 3's GREEN step carried this decision into
`session.ts`'s doc comment verbatim).

Spec §4.4's table, copied verbatim:

| Tiers | `options.plugins` | Result | Registered as |
| --- | --- | --- | --- |
| `['project']` (today) | present | `SKILL_RESULT=ok`, base dir `/Users/hiep/repo/tribe/plugins/verify-shipped/skills/verify-shipped` | `verify-shipped:verify-shipped` |
| `user,project,local` | **absent** | `SKILL_RESULT=ok` | `verify-shipped` |
| `user,project,local` | present | `SKILL_RESULT=ok` | `verify-shipped` only — the namespaced copy **dedupes away** |

The two `G4_*` lines Task 7 printed, copied verbatim:

```
G4_WITH_PLUGIN registered as: ["verify-shipped","verify-shipped:verify-shipped"]
G4_WITHOUT_PLUGIN=resolved registered as: ["verify-shipped"]
```

(On this host, `install.sh` has already run, so the user tier alone also resolves
`verify-shipped` — `G4_WITHOUT_PLUGIN=resolved`. That is a host fact, not a code guarantee: a host
that never ran `install.sh` would report `G4_WITHOUT_PLUGIN=unknown`, exactly as `before/`'s
identical probe did.)

The `verify-shipped` hand-load (`options.plugins`) is kept: it resolves the skill from the repo on
every host, where the user tier resolves it only where install.sh ran; with both present the
session registers it once.

## Re-used, not re-derived

Issue #163's "Cost of parity" paragraph, quoted verbatim:

> Loading the user tier took an executor session from 29 to 53 tools (25 of them a Playwright MCP
> server, which was proven to fail open when its command is unresolvable), and ~21 to ~55 slash
> commands. The SDK's `model` and `permissionMode` options were proven to beat the user tier's
> own values, and a deliberately failing user-tier hook was proven not to break a session. Re-use
> that evidence; do not re-derive it.

What this card re-measured for the supervisor envelope specifically, rather than re-deriving the
executor-side numbers above (spec §4.1):

- **`permissionMode`/`model` win here too:** this machine's `~/.claude/settings.json` sets
  `permissions.defaultMode: "auto"` and `model: "opus"`; every treatment init for `ruling`,
  `ratify` and `closing` still reported `permissionMode: "default"` and the haiku model — the
  same SDK-wins-over-user-tier fact §162 measured for the executor, re-confirmed independently for
  the supervisor's three kinds.
- **No MCP server starts on this host, for the supervisor envelope either:** the tool-count delta
  per kind was 25/25 (`ruling`/`ratify`) and 26/26 (`closing`) before vs. after loading the tiers
  — the executor's "+25 Playwright tools" cost (from an MCP server this host's `user` tier
  disables) does not appear here; it is the same host-dependent fact, not a new one.
