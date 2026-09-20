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

_(left empty for Task 7 — the ratchet re-run on the same three roots once the user tier is loaded,
plus the E2E before/after transcripts and reproduction commands)_
