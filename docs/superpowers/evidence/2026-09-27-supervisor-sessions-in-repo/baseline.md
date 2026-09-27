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
