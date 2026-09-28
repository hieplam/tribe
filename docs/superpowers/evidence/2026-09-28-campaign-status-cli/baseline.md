# Ratchet baseline — card campaign-status-cli, Task 0

Measured on master `69e5680` (the plan's base `a203aef` plus the plan's own doc merge; no code
differs in `plugins/tribe/scripts/cli/`), from `/tmp`, against the installed CLI
`/Users/hiep/.local/bin/tribe`, on 2026-09-28. No code was written for this task — the
measurement is the artifact.

## 1. What `tribe` answers today

```sh
cd /tmp
tribe campaign status post-rdo-followups; echo "exit=$?"
```

Literal output, both lines:

```
tribe: unknown option campaign (see tribe --help)
exit=2
```

So: **0 tribe commands answer "what is my campaign doing".**

## 2. What the owner must do instead today

The same facts (`sequence`, per-card `status` / `pr` / `dependsOn`, supervisor `state` /
`lastAction` / `updatedAt` / `currentSession` / `terminal`) are only reachable by reading the
campaign's two state files by hand with `jq` — and by first knowing the repo-key path
`~/.tribe/-Users-hiep-repo-tribe/campaigns/<name>/`, which nothing prints.

The recipe, verbatim:

```sh
C=~/.tribe/-Users-hiep-repo-tribe/campaigns/post-rdo-followups
time ( jq '{sequence, cards: (.cards|map_values({status,pr,dependsOn}))}' $C/campaign-state.json; \
       jq '{state,lastAction,updatedAt,currentSession,terminal}' $C/supervisor/status.json )
```

It exits 0 and prints two JSON objects (23 lines and 11 lines of raw JSON — summarised here,
not pasted: the raw run output stays outside the repo). `real` time: **0.038 s** for the pair.

## 3. The baseline count

**today: 0 tribe commands answer it; 2 jq commands over 2 files (plus knowing the repo-key path)**

## 4. What Task 5 compares against

| Measure | Before (this file) | After (Task 5 `after.md`) |
| --- | --- | --- |
| `tribe campaign status post-rdo-followups` | `tribe: unknown option campaign (see tribe --help)`, `exit=2` | the rendered status, `exit=0` |
| commands to get the facts | 2 (`jq` × 2, over 2 files) | 1 |
| must know the `~/.tribe` repo-key path | yes | no |
| wall time | 0.038 s (jq pair) | measured `real`, must stay under 1.00 s |

The number may only move in the good direction: commands 2 → 1, exit 2 → 0.
