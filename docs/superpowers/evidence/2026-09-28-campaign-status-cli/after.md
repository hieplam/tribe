# Ratchet after-measurement — card campaign-status-cli, Task 5

Before values come from `baseline.md` in this directory, measured on master before any code.
Measured here from `<worktree>/plugins` with `bun tribe/scripts/cli/main.ts …` (the `tribe` on
PATH runs the main checkout, not this branch), on 2026-09-28. Summary only — raw run output stays
outside the repo.

## Before → after

| Measure | Before (Task 0, master) | After (this branch) |
| --- | --- | --- |
| `tribe campaign status post-rdo-followups` | `tribe: unknown option campaign (see tribe --help)`, `exit=2` | the five status lines below, `exit=0` |
| commands to get the facts | 2 (`jq` twice, over 2 files) | 1 |
| must know the `~/.tribe` repo-key path | yes | no — the repo you stand in decides it |
| wall time | 0.038 s (the jq pair) | `real 0m0.024s`, well under the 1.00 s bound |

Every number moved in the good direction or held: 2 commands → 1, `exit=2` → `exit=0`, and the
path knowledge requirement is gone. Wall time was never the point — both routes are far under a
second — so the bound is stated as a guard, not as a win.

## 1. The one command, and its output

```sh
cd <worktree>/plugins
bun tribe/scripts/cli/main.ts campaign status post-rdo-followups; echo "exit=$?"
```

```
campaign post-rdo-followups — terminal (done: campaign_closed)
cards: 2/2 shipped
  fu-closing-dismiss  shipped  tasks 1/1  PR #190  waiting on: —
  rdo-cleanup  shipped  tasks 3/3  PR #191  waiting on: —
last action: exit:campaign_closed (1h ago)
exit=0
```

## 2. G1 + D2 oracle: every field checked against the files it came from

The same two files read directly, one line per card:

```sh
C=~/.tribe/-Users-hiep-repo-tribe/campaigns/post-rdo-followups
jq -r '.sequence[] as $id | .cards[$id] as $c | "\($id) \($c.status) \($c.pr) \($c.dependsOn) \([($c.tasks // [])[] | select((.passedSha? // "") != "")] | length)/\(($c.tasks // []) | length)"' $C/campaign-state.json
jq -r '"\(.state) \(.lastAction) \(.terminal.status):\(.terminal.reason)"' $C/supervisor/status.json
```

```
fu-closing-dismiss shipped 190 null 1/1
rdo-cleanup shipped 191 ["fu-closing-dismiss"] 3/3
terminal exit:campaign_closed done:campaign_closed
```

Field for field against the rendered lines above:

| From the files | On the `tribe` line |
| --- | --- |
| `fu-closing-dismiss shipped 190 … 1/1` | `fu-closing-dismiss  shipped  tasks 1/1  PR #190` |
| `rdo-cleanup shipped 191 … 3/3` | `rdo-cleanup  shipped  tasks 3/3  PR #191` |
| `dependsOn` `null` (fu-closing-dismiss) | `waiting on: —` |
| `dependsOn ["fu-closing-dismiss"]`, and that card is `shipped` | `waiting on: —` (only unshipped dependencies are outstanding) |
| `state terminal`, `terminal done:campaign_closed` | `campaign post-rdo-followups — terminal (done: campaign_closed)` |
| `lastAction exit:campaign_closed` | `last action: exit:campaign_closed (1h ago)` |
| both cards `shipped`, 2 in `sequence` | `cards: 2/2 shipped` |

## 3. Ratchet timing

```sh
time bun tribe/scripts/cli/main.ts campaign status post-rdo-followups >/dev/null
```

```
real	0m0.024s
```

## 4. Q1 on a real v1 campaign (no task index on disk)

`fu-supervisor-settings` is a `"v": 1` campaign whose cards have `"tasks": null`:

```sh
bun tribe/scripts/cli/main.ts campaign status fu-supervisor-settings; echo "exit=$?"
```

```
campaign fu-supervisor-settings — terminal (needs_owner: closing_failed)
cards: 2/2 shipped
  supervisor-session-settings  shipped  tasks 0/0  PR #168  waiting on: —
  supervisor-home-settings-containment  shipped  tasks 0/0  PR #171  waiting on: —
last action: park:closing_failed (82h ago)
exit=0
```

Read leniently, not refused: a v1 file renders, and `tasks: null` shows as `tasks 0/0` — exactly
what the file records, no task index.
