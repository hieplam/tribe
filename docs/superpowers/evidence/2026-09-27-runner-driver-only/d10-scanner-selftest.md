# D10 layer 1 — bypass-audit.ts self-tests (planning, 2026-09-27)

The scanner must report nonzero on a transcript known to contain Tribe dispatches before it is relied on.

| Input | Result | Evidence |
| --- | --- | --- |
| `~/.claude/projects/-Users-hiep-repo-tribe/b3bf06c3-8e61-4fd0-ade3-e6bdb542c788.jsonl` (fu-supervisor-settings executor, + its 18 `subagents/*.jsonl`) | `BYPASS_TRIBE_DISPATCHES=18`, `BYPASS_AGENT_FILE_TOUCHES=2`, `BYPASS_AUDIT=FAIL`, exit 1 — **nonzero, as required** | `d10-scanner-selftest-known-tribe.txt` |
| BEFORE run in the real home (`campaigns/go-before`, 1 executor + 6 subagent transcripts) | `BYPASS_TRIBE_DISPATCHES=6` (4 hunter, 1 skinner, 1 tracker) — agrees with `run-metrics.ts` and `subagents/*.meta.json` | `d10-before-realhome-scan.txt` |
| Sandbox tree check, sandbox unchanged (snapshot then scan) | `SANDBOX_AGENTS_EMPTY=yes`, `SANDBOX_SURFACE_CHANGED=0`, `SANDBOX_UNKNOWN_NEW_ENTRIES=0` | this file |
| Sandbox tree check on a copy with a planted `agents/hunter.md` symlink and a new `weird-new/` dir | `SANDBOX_AGENTS_EMPTY=no`, `SANDBOX_SURFACE_CHANGED=1 agents/hunter.md`, `SANDBOX_UNKNOWN_NEW_ENTRIES=1 weird-new` | this file |

## `no-live-campaign.sh` (Shaman amendment A1) — self-tests, planning, 2026-09-27

| Situation | Result |
| --- | --- |
| This machine while campaign `sessions-in-repo` runs (watchdog pid 15716, runner pid 70499) | exit 1, names both processes — the gate holds execution back |
| A fake home with a v1 `campaign-state.json` and a `.runner.lock` naming a live pid (pgrep shimmed to "no process") | exit 1, "`…/campaign-state.json (v1) is locked by live pid …`" |
| Same, the lock's pid dead (stale lock) | exit 0 |
| Same, the state is v2 | exit 0 |
| `pgrep` itself fails (shimmed to exit 3) | exit 2, "cannot prove no campaign is live" — never a false pass |
