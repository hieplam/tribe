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
