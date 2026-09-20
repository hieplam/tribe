# Evidence — session-hygiene ratchet (card `runner-session-user-settings`)

Committed tool: `plugins/tribe/scripts/session-hygiene.ts` (Task 2). Pure counting core:
`plugins/tribe/scripts/runner/core/metrics/session-hygiene.ts` (Task 1, 23 tests green).

## Counting method

- Walks the given `--root` recursively for every file whose name ends `.log` or `.jsonl`
  (`walkLogFiles` in `session-hygiene.ts`). Unreadable files/directories are skipped with a
  warning to stderr; the walk never aborts on one bad file (fail-closed-edges obligation 1).
- Each file's raw text is handed whole to `countSessionHygiene` (the pure core from Task 1),
  which counts, per **occurrence** (not per line):
  - `Unknown skill: <name>` — via `/Unknown skill: ([A-Za-z0-9_-]+)/g` over the raw text.
  - filesystem-wide scans — every `Bash` `tool_use` command found in each JSONL line is tested
    with `isFilesystemWideScan` (Task 1's oracle: a `find` rooted at exactly `/`, `~`, `~/`,
    `$HOME`, `"$HOME"`, or `$HOME/`). A line that fails to parse as JSON contributes 0 scans and
    does not abort the file.
- Counts are accumulated (summed) across every file under the root.

This is the **same command** for all three roots below:

```
bun plugins/tribe/scripts/session-hygiene.ts --root <root>
```

Run 2026-09-20 (UTC), on branch `feat/runner-session-user-settings`, against the real,
already-existing logs at each path (no fixture, no synthetic data).

## BEFORE — measured baseline

### `~/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening`

```
$ bun plugins/tribe/scripts/session-hygiene.ts --root ~/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening
session-hygiene report for /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening
Unknown skill: c3: 6
total unknown skills: 6
filesystem-wide scans: 4
```

**This is the card's independently measured G2 baseline (`filesystem-wide scans: 4`), reproduced
exactly by the committed tool.** `Unknown skill: c3` = 6.

### `~/.tribe/-Users-hip-repo-tribe/campaigns` (all campaigns)

```
$ bun plugins/tribe/scripts/session-hygiene.ts --root ~/.tribe/-Users-hip-repo-tribe/campaigns
session-hygiene report for /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns
Unknown skill: c3: 81
Unknown skill: verify-shipped: 6
Unknown skill: c3-skill-marketplace: 2
total unknown skills: 89
filesystem-wide scans: 20
```

### `~/.claude/projects/-Users-hip-repo-tribe`

```
$ bun plugins/tribe/scripts/session-hygiene.ts --root ~/.claude/projects/-Users-hip-repo-tribe
session-hygiene report for /Users/hip/.claude/projects/-Users-hip-repo-tribe
Unknown skill: c3: 269
Unknown skill: verify-shipped: 95
Unknown skill: c3-skill-marketplace: 4
total unknown skills: 368
filesystem-wide scans: 26
```

## These numbers supersede the card's

The card's original `91`/`32` figures were hand-grepped, with no recorded counting method. The
numbers above are produced by a single committed, tested tool (`isFilesystemWideScan` +
`countSessionHygiene`, 23 unit tests) run against the real corpus, with the method stated above.
**These numbers supersede the card's hand-grepped ones.**

> Counted over the historical corpus these totals can only grow: past logs are immutable and every
> new session appends to the same directories. The meaningful ratchet is therefore **per-campaign**
> — G2 and G4 state it that way ("baseline 4 in campaign `supervisor-hardening` → 0 in the next
> campaign's logs"). The global total is context, not the target.

## AFTER

All facts below are from real runs, on branch `feat/runner-session-user-settings` at commit
`4a95d91` (Task 6, HEAD when this section was written), on 2026-09-20.

### (a) The E2E, both directions — the card's G1 oracle

**GREEN**, tier as committed (`['user', 'project', 'local']`):

```
$ cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 bun test core/session.e2e.test.ts
bun test v1.3.14 (d1632b29)

 1 pass
 0 fail
 5 expect() calls
Ran 1 test across 1 file. [23.20s]
```

**RED**, tier temporarily reverted to `['project']` (`core/session.ts:218`, restored immediately
after — no diff left in the tree; confirmed with `git status --porcelain` before recommitting
nothing):

```
$ cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 bun test core/session.e2e.test.ts
core/session.e2e.test.ts:
error: expect(received).not.toContain(expected)

Expected to not contain: "Unknown skill"
Received: ...{"type":"user","message":{"role":"user","content":[{"type":"tool_result",
"content":"<tool_use_error>Unknown skill: c3. Did you mean cd?</tool_use_error>",
"is_error":true,"tool_use_id":"toolu_01DUNczxVdwbmkAWbNt5P58G"}]},...}
...{"result":"SKILL_RESULT=unknown Unknown skill: c3. Did you mean cd?", ...}

      at <anonymous> (core/session.e2e.test.ts:113:30)
(fail) runSession — real spawned session, Skill c3 resolves under the user tier (G1) >
Skill c3 resolves, its content reaches the transcript, no Unknown skill, no
filesystem-wide scan [8295.84ms]

 0 pass
 1 fail
 3 expect() calls
Ran 1 test across 1 file. [8.36s]
```

The test fails at the exact assertion the plan named
(`expect(transcript).not.toContain('Unknown skill')`), on the transcript's own
`<tool_use_error>Unknown skill: c3. Did you mean cd?</tool_use_error>` and the session's final
`result: "SKILL_RESULT=unknown Unknown skill: c3. Did you mean cd?"`.
**Discrepancy from the brief handed to this task:** the brief quoted the final result as
`SKILL_RESULT=unknown Skill "c3" not found. Error: Unknown skill: c3. Did you mean cd?`; the real
run measured above instead produced `SKILL_RESULT=unknown Unknown skill: c3. Did you mean cd?`
(no `Skill "c3" not found. Error:` prefix). The `<tool_use_error>` string itself — the one the
test actually asserts against — matches exactly. Recording what was measured, not the brief's text.

### (b) R-c — the MCP fail-open proof

Reproduced directly (not from a saved artifact) by calling `buildSessionOptions` +
`sdkSpawnSession` — the runner's own real spawn path, committed code, no patching — with `PATH`
forced to `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` so `npx` cannot resolve (confirmed
separately: `env PATH=... which npx` exits 1; `bun` still resolves via `/opt/homebrew/bin`):

```
$ env PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" bun <probe using buildSessionOptions + sdkSpawnSession>
INIT mcp_servers: [{"name":"plugin:playwright:playwright","status":"failed","source":"plugin"}]
has playwright tool: false
RESULT: PROBE_OK is_error: false subtype: success duration_ms: 2379 elapsed_wall_s: 3.22
```

`system/init.mcp_servers` = `[{"name":"plugin:playwright:playwright","status":"failed","source":"plugin"}]`,
`init.tools` contains no playwright tool, and the session completed `subtype: "success"`,
`result: "PROBE_OK"`, `is_error: false` — no hang, no startup abort.
**Discrepancy from the brief:** the brief stated `4.67s`; the real run measured above completed in
`duration_ms: 2379` (2.38s API time, 3.22s wall). Different run, same shape (fails open, no hang);
recording the measured number, not the brief's.

### (c) The ratchet, re-run — same three roots, same committed tool

```
$ bun plugins/tribe/scripts/session-hygiene.ts --root ~/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening
session-hygiene report for /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening
Unknown skill: c3: 6
total unknown skills: 6
filesystem-wide scans: 4

$ bun plugins/tribe/scripts/session-hygiene.ts --root ~/.tribe/-Users-hip-repo-tribe/campaigns
session-hygiene report for /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns
Unknown skill: c3: 81
Unknown skill: verify-shipped: 6
Unknown skill: c3-skill-marketplace: 2
total unknown skills: 89
filesystem-wide scans: 20

$ bun plugins/tribe/scripts/session-hygiene.ts --root ~/.claude/projects/-Users-hip-repo-tribe
session-hygiene report for /Users/hip/.claude/projects/-Users-hip-repo-tribe
Unknown skill: c3: 522
Unknown skill: verify-shipped: 121
Unknown skill: c3-skill-marketplace: 18
total unknown skills: 661
filesystem-wide scans: 26
```

`supervisor-hardening` and `campaigns` (all) are **byte-identical to the BEFORE section above** —
`4` and `20` filesystem-wide scans respectively, unchanged — because no new session has appended
to either directory since Task 2 measured the baseline. `~/.claude/projects/-Users-hip-repo-tribe`
**grew** (269→522 `Unknown skill: c3`, 95→121 `verify-shipped`, 4→18
`c3-skill-marketplace`, 26→26 filesystem-wide scans unchanged) — that directory is this very
Claude Code project's own live session log, and building/verifying this card's own tasks (this
one included) kept appending to it during the campaign. This is exactly the point of the note
below: **this is not a regression**, it is the historical corpus growing, which is expected and
unavoidable.

**This is the part that needs intellectual honesty:**

- The historical totals **do not drop and cannot** — past logs are immutable, and this card does
  not rewrite them. Anyone expecting the global number to fall has misread the ratchet. The
  measurement above proves exactly that: two roots held flat, one grew, none fell.
- The forward ratchet is **per-campaign**: G2/G4's own framing is "baseline **4** in campaign
  `supervisor-hardening` → **0** in the next campaign's logs". That `0` is measured by the *next*
  campaign, not by this PR — no campaign has yet run under the fixed tier list, so there is no
  next-campaign number to report yet.
- What this PR *does* prove now is the mechanism: a session spawned through the runner's own path
  resolves `Skill c3`, emits **no** `Unknown skill`, and runs **no** filesystem-wide scan —
  asserted by the committed E2E (section (a) above), on real transcripts, in both directions.
- Per Shaman ruling **R-d**, G4's oracle is scoped to **executor-kind** sessions.
  `core/supervisor/session.ts:113` builds a separate envelope that this card does not touch, so
  any residual `verify-shipped` count originating there is **not** this card's regression. Follow-up:
  **FU-supervisor-settings**. No global zero is claimed or was achieved.
- Per Shaman ruling **R-e**, the baseline of record is this committed counter's output (BEFORE
  section above: `4` / `20` / `26`), not the card's original hand-grepped `91`/`32`, which had no
  recorded counting method.

### (d) Measured consequences of parity (facts, no action implied)

Loading the user tier makes the owner's own `~/.claude/settings.json` apply inside every spawned
session, same as it does in the owner's own interactive sessions:

- `ReportFindings` disappears from the tool list — `permissions.deny: ["ReportFindings"]` in the
  user tier now applies.
- Six unauthenticated `claude.ai` MCP connectors disappear (`claude.ai Claude Docs`,
  `Atlassian Rovo`, `Mermaid Chart`, `Canva`, `Google Drive`, `Vercel`) —
  `disableClaudeAiConnectors: true` in the user tier now applies.

Both are the owner's own settings finally applying to spawned sessions — that is what parity
means, not a new restriction invented by this card.

Cost of parity, measured live: tool count 29 → 53 (+25 playwright MCP tools, the one new
plugin-provided MCP server the user tier connects); slash commands ~21 → ~55.

### Reproduction commands (all three parts)

```bash
# (a) GREEN / RED
cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 bun test core/session.e2e.test.ts
# RED: temporarily edit core/session.ts:218 to `settingSources: ['project'],`, rerun, then restore.

# (b) R-c fail-open (illustrative — the probe script itself is not committed, it is a throwaway
# harness around the committed buildSessionOptions/sdkSpawnSession functions):
env PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" bun <script calling
  buildSessionOptions(...) and sdkSpawnSession({ prompt, options }), printing
  the system/init message and the result message>

# (c) ratchet
bun plugins/tribe/scripts/session-hygiene.ts --root ~/.tribe/-Users-hip-repo-tribe/campaigns/supervisor-hardening
bun plugins/tribe/scripts/session-hygiene.ts --root ~/.tribe/-Users-hip-repo-tribe/campaigns
bun plugins/tribe/scripts/session-hygiene.ts --root ~/.claude/projects/-Users-hip-repo-tribe
```
