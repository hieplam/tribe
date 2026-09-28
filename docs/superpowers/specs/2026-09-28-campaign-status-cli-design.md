# Spec — `tribe campaign status` (card campaign-status-cli)

Contract: `~/.tribe/-Users-hiep-repo-tribe/cards/campaign-status-cli.md` (D1–D4, G1–G4, Ratchet,
Do/Don't, Way of work). Base: master `a203aef`. Oracle: the card. Less than its goals = bug;
extra fields = not required.

## 1. Current state (grounded)

- `plugins/tribe/scripts/cli/core/args.ts:6-10` — `Command` has only `help | version | viewer | refuse`;
  any positional argument is refused at `args.ts:58` ("unknown option"). `main.ts:7-22` is the
  composition root (only file reading `process.argv` / calling `process.exit`).
- The CLI already imports runner modules across packages (`cli/adapters/viewer.adapter.ts:6-7`),
  so reusing runner types is an established pattern.
- Home: `plugins/tribe/scripts/tribe-home.sh:10-19` → `$HOME/.tribe/<main-worktree-path with / → ->`.
  The runner already spawns it with git isolation + 5 s timeout
  (`runner/adapters/supervisor-io.adapter.ts:37-50`). Because it reads `$HOME`, setting `HOME` in a
  test gives a bare `~/.tribe` (the env override the card asks for).
- Campaign dir: `<home>/campaigns/<name>/`. Path helper `campaignStatePathOf`
  (`runner/core/paths.ts:13`) and folder join `supervisorHomeFromCampaign`
  (`runner/core/supervisor/args.ts:144`).
- Types to reuse: `CampaignState`, `Card`, `CardStatus` (`runner/core/types.ts:8,29-84`) and
  `SupervisorStatus` (`runner/core/supervisor/model.ts:286`).
- Existing typed reader `parseState` (`runner/core/state.ts:238`) **cannot be reused as-is**: it
  throws on v1 (`state.ts:29-31`), and 4 of the 5 real campaigns on this machine are `v: 1`
  (`fu-supervisor-settings`, `sessions-in-repo`, both `sir-owner-run-*`); only `post-rdo-followups`
  is v2. A status viewer that refuses most real campaigns fails D1's "most recent" default in
  practice. Decision: a small lenient reader in `cli/core` that validates only the fields it
  renders, typed with `Pick<>` of the runner types (single source of field names).
- Card grounding note: `cards.*.tasks` in `post-rdo-followups` is now populated (not `null`), but
  tasks stay out of scope per D2.
- `sessions-in-repo` has no `supervisor/status.json` → must render card lines with "supervisor:
  not started", not refuse (only campaign-state is mandatory).

## 2. The change

```
tribe campaign status [<name>] [--watch]
```

### Pure core — `cli/core/campaign-status.ts`
- `parseCampaignState(raw: unknown): {ok:true, value} | {ok:false, reason}` — accepts any `v`,
  requires `sequence:string[]` and `cards: Record<string,{status:string, pr?:number|null, dependsOn?:string[]|null}>`;
  `dependsOn` null/absent → `[]` (the real `post-rdo-followups` file has `"dependsOn": null`). Exact
  interfaces, output lines and refusal lines: plan.md "Fixed interfaces" (authoritative). Unknown extra fields ignored.
- `parseSupervisorStatus(raw: unknown)` — same style; requires `state`, `updatedAt`, `lastAction`,
  `currentSession` (object|null), `terminal` (object|null); `counters` optional.
- `pickLatest(candidates: {name, updatedMs}[]): string | null` — D1 default (max `updatedMs`,
  tie → name ascending for determinism).
- `renderStatus(input: {name, state, supervisor | null, nowMs, staleAfterMs}): string[]` — returns
  lines. Contents (card order = `sequence`, then any cards not in sequence, sorted):
  1. `campaign <name> — <supervisor.state | "supervisor: not started">` (+ ` (<terminal.status>: <terminal.reason>)` when terminal)
  2. `cards: <shipped>/<total> shipped`
  3. one line per card: `  <id>  <status>  PR #<pr | —>  waiting on: <unshipped dependsOn ids | —>`
  4. when `currentSession`: `session: <kind> <cardId|-> <sessionId|->`
  5. `last action: <lastAction> (<age> ago)` where age = nowMs − supervisor.updatedAt, formatted `Ns`/`Nm`/`Nh`
  6. D4: when supervisor exists, `terminal` is null/`state !== 'terminal'`, and age > 10 min →
     `WARNING: possibly stuck — supervisor not updated for <age>`.
- No clock, fs, or env: `nowMs` is an argument.

### Edge — `cli/adapters/campaign-status.adapter.ts`
- `resolveHome(cwd)`: spawn `tribe-home.sh` (path from `import.meta.dir`), env with
  `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null`, `timeout 5000`. Non-zero → refusal
  `tribe: not inside a git repository (<cwd>)`.
- `listCampaigns(home)`: readdir `<home>/campaigns` (ENOENT → empty); for each dir, `updatedMs` =
  max(mtime of `campaign-state.json`, mtime of `supervisor/status.json`) ignoring ENOENT.
- `readJson(path)`: catches `ENOENT`, `EACCES`, `EISDIR`, `SyntaxError` narrowly → typed refusal.
- Name containment (fail-closed-edges §4): name must match `^[A-Za-z0-9._-]+$` and not be `.`/`..`;
  checked in the pure parser before any path is built.

### Flow — `cli/core/campaign-status.ts#runCampaignStatus(cmd, io)` over an injected
`CampaignStatusIo {resolveHome, listCampaigns, readJson, now, print, printErr, sleep}` → exit code.
- Unknown name / no campaigns / missing or corrupt `campaign-state.json` → one stderr line, exit 1.
- Corrupt `status.json` → one stderr line, exit 1 (fail closed; do not guess state).
- `--watch`: loop {clear screen (`\x1b[2J\x1b[H`), render, sleep 2 s}; a refusal mid-watch prints and
  exits 1; Ctrl-C = default SIGINT exit. The loop is bounded in tests by an injected `sleep` that
  rejects after N calls.

### Args — `cli/core/args.ts`
New kind `{kind:'campaign-status', name: string|null, watch: boolean}`. `campaign` must be the first
token, followed by `status`; `campaign` with other/no sub-verb → refusal exit 2. Names starting with
`-` are flags. Help text gains the line.

## 3. Scope fence
Out: task-level progress (D2), writing any campaign file, runner/viewer changes, server deps,
listing all campaigns, JSON output, colours.

## 4. Testing
- Unit (bun test): args cases; parsers (valid v1, valid v2, corrupt shapes); `renderStatus` for
  shipped/running/waiting/stale/terminal/no-supervisor; `pickLatest`; `runCampaignStatus` with a fake io.
- E2E (`campaign-status.e2e.test.ts`): bare `tribe` on PATH, `HOME=<tmp>/home` (bare `~/.tribe`),
  cwd = a fresh `git init` repo created in tmp; fixture campaigns written into
  `<tmp>/home/.tribe/<key>/campaigns/`. Cases: empty home → refusal; no-name picks latest;
  relative-name invocation; corrupt JSON → refusal no stack trace (`stderr` has no `at `); stale fixture → WARNING;
  `--watch` prints twice then killed with SIGINT.

## 5. Evidence plan
- BEFORE: `tribe campaign status post-rdo-followups` on master → `unknown option campaign`, exit 2.
- AFTER: same command → real output; compared line-by-line with `jq` over its two files
  (`.sequence`, `.cards[]|{status,pr,dependsOn}`, status `.state/.lastAction/.updatedAt`).
- Ratchet: `time tribe campaign status post-rdo-followups` < 1 s.
- Summaries only committed (owner memory "evidence: summaries only").

## 6. Risk / rollback
Read-only, additive subcommand; rollback = revert the PR. Risk: future v3 state shape — lenient
reader only needs the rendered fields.
