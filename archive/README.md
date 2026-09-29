# Archive

Retired plugin content, kept for reference only. Nothing under `archive/` is installed:
the root `install.sh` walks `plugins/` alone, and the eval harness
(`scripts/evals/run_evals.py --all`) discovers fixtures under `plugins/` alone.

| Item | Was | Archived | Why |
|---|---|---|---|
| [`skills/mammoth-hunt/`](skills/mammoth-hunt/SKILL.md) | `plugins/tribe/skills/mammoth-hunt` — a skill that bound phrases such as "Run the Mammoth Hunt" or "full tribe" to the full tribe delivery chain (Warchief, Hunters, two Skinners, Scout, Tracker) on one piece of work | 2026-09-29 | The owner no longer uses it; one piece of work is now completed by a single agent, or by the way of work its plan declares. The tribe agents can still be dispatched directly by name. |

To restore an item, move it back to its original path and re-run `./install.sh`.
