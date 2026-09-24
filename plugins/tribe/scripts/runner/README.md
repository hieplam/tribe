# Campaign runner

A **stateless capability** of the `tribe` plugin: a deterministic script that drives a
roadmap campaign's outer loop — pick the next progressable card, run one fresh executor session,
script-verify it shipped, record state, repeat — so the loop itself burns **zero LLM
tokens** (only the sessions it spawns do). See
[`docs/superpowers/specs/2026-07-16-campaign-runner-design.md`](../../../../docs/superpowers/specs/2026-07-16-campaign-runner-design.md)
for the base design, and
[`docs/superpowers/specs/2026-07-16-campaign-orchestration-design.md`](../../../../docs/superpowers/specs/2026-07-16-campaign-orchestration-design.md)
for the amendments this file also documents (D5′ park-and-continue, the `dependsOn`/`blocked`
schema additions, and the report contract). This file documents what the code in this directory
**actually does** — verified against the code, not asserted from memory.

"Stateless capability" means: this script hardcodes no repo, path, model, or campaign value.
Every environment-specific value — the target repo, the campaign's machine-local home, which
model tier to use — arrives as a CLI input. Campaign artifacts split into two classes, and they
live in two different places:

- **Contracts** — specs and plans — are reviewable, durable, and useful to a human reader with
  no `~/.tribe`, so they stay committed in the **target repo**, in that repo's own discovered
  convention (e.g. `docs/specs/` + `docs/plans/`, or `.c3/adr/`) — never in a namespace this
  plugin invents.
- **Operational state** — `campaign-state.json`, `answers.md`, escalation files,
  `campaign-report.*`, `.runner.lock`, `STOP`, per-card worker reports, run records — is
  machine bookkeeping, never committed, and lives entirely under `--home` (see "Run record"
  below). The runner makes no git commits of its own.

## Campaign commit trailer

Because operational state now lives entirely under `--home` and nothing is committed to the
target repo (see above), git history itself is the only durable, in-repo trace of which commits
belong to a campaign. Every executor brief (`core/brief.ts`, spec §6) instructs the spawned
session to end every commit it makes with:

    Campaign: <campaign-slug>

Recovery is `git log --grep="Campaign: <campaign-slug>"` — no `~/.tribe`, no GitHub API, just git.

**This is instructional, not enforced.** The runner tells the executor session to add the
trailer; nothing mechanically checks that it did. `core/verify.ts`'s D3 five-point SHIPPED
replay does not check for it, and neither does the `verify-shipped` skill — a card can ship
(and this runner will happily record it as `shipped`) without the trailer present on any of its
commits. Enforcing it would mean adding a sixth point to the D3 verify replay — the runner's
highest-risk module — which is deliberate future work, not an oversight.

## Inputs

All paths below that are relative are relative to `--repo` unless noted otherwise.

| Flag | Required | Meaning |
| --- | --- | --- |
| `--repo` | yes | Target repo root — `cwd` for every `gh`/`git` call and the executor session. |
| `--model` | yes | Executor model tier passed to each spawned session. |
| `--home` | yes | The campaign's machine-local operational home (absolute, or resolved against `cwd`). One campaign per home, so every operational artifact resolves to a fixed name under it (`core/paths.ts`) — no separate flag for any of them. Full layout: `campaign-state.json`, `answers.md`, `escalations/<cardId>.md`, `campaign-report.json`, `campaign-report.md`, `.runner.lock`, `STOP`, `reports/<cardId>.md`, `runs/<run-id>/run.json` + `runs/<run-id>/logs/`. Matches the `~/.tribe/<repo-key>/campaigns/<campaign-slug>` convention, but this script never derives that key itself — the caller (normally `orchestrate-campaign`, via `tribe-home.sh`) computes it and passes it in (stateless-capability wall: this is an environment-specific value, not a value worth guessing). |
| `--logs-dir` | no | Session log destination. Default: `<home>/runs/<run-id>/logs/` (i.e. this invocation's own run directory under `--home`). Explicit `--logs-dir` overrides. |
| `--session-timeout` | no | Wall-clock abort per executor session. Accepts `<n>ms`, `<n>s`, `<n>m`, `<n>h`, or a plain millisecond integer (e.g. `3h`, `30m`, `90s`, `5000ms`, `5000`). Default: `3h`. |
| `--dry-run` | no | Derive and print the next action with **zero side effects** — no lock, no writes, no session, no report file (see the report contract below). |
| `--cards` | no | Comma-separated list of card ids — restricts the loop to only these ids, in the state's own `sequence` order. Default: the full sequence. |
| `--max-cards` | no | Positive integer — stop after WORKING this many cards in this run (a card actually `shipped`/`escalated`/`stopped` this pass — see D5′ below; a card merely parked on a prior run's escalation, or skipped as `blocked`, does not consume this budget). Default: unbounded (run until `done` or the budget is spent — an escalation no longer stops the run, see D5′). |
| `--max-concurrent` | no | Integer ≥ 1 — how many cards' executor sessions may be IN FLIGHT at once this pass. Bounds WIDTH only, never ORDER: `dependsOn` still owns ordering (see "Concurrency" below). Default: `1`, i.e. **today's exactly-one-card-at-a-time behavior** — this is a strict opt-in; omitting the flag changes nothing. |
| `--include-escalated` | no | Bypass the escalation-file short-circuit for a card the human has already ruled on, and let `nextCard`/`deriveCardPhase` reconsider it. This is exactly the flag the Stage C round-trip re-triggers with (spec §O6). |
| `--remote` | no | The git remote this repo's canonical upstream/PR-target actually is — resolved once and threaded everywhere the runner queries or pushes to a remote (base-branch resolution, verify-phase ancestry/diff checks, branch-existence checks). Default: `'origin'`. See [`docs/superpowers/specs/2026-07-31-runner-remote-resolution-design.md`](../../../../docs/superpowers/specs/2026-07-31-runner-remote-resolution-design.md). |
| `--viewer-port` | no | Port the auto-started read-only [live viewer](#live-viewer) binds on `127.0.0.1`. Must be an integer between 1 and 65535. Default: `4321`. |
| `--no-viewer` | no | Skip starting the live viewer entirely for this run — no probe, no spawn, no printed URL. See [Live viewer](#live-viewer) below. |

`--repo`, `--model`, and `--home` — the three required flags — have **no default** — this is
deliberate (the stateless-capability wall): omitting any of them is a usage error, not a value
worth guessing. `--state`, `--answers`, and `--escalations-dir` were deleted as flags: with one
campaign per `--home`, every operational artifact now resolves to a fixed name under it, so
those three values are no longer environment-specific. Any flag `parseArgs` doesn't recognize
(including these three) is rejected by name, not silently ignored.

## Run record

Every non-`--dry-run` invocation records itself under `--home` the moment the single-instance
lock (below) is acquired — this is the machine-local audit trail the viewer
(`plugins/tribe/scripts/viewer/`) reads for the badge's runner-alive fact (§9), and the watchdog
reads to decide whether to relaunch — the viewer **does** read `run.json`; what it never reads is
the runner *log* (D6).

```
<home>/
  reports/<cardId>.md            per-CARD worker reports (written by `brief.ts`'s `reportPathFor`;
                                  survive across runs — never cleared by this runner)
  runs/<run-id>/
    run.json                     this invocation's run record (schema below)
    logs/…                       this invocation's session logs (default --logs-dir)
```

`<run-id>` is generated fresh per invocation (`generateRunId`, `core/run-record.ts`): an ISO
timestamp with `:`/`.` mapped to `-`, plus a random hex suffix (e.g.
`2026-07-24T06-13-59-000Z-a1b2`) — collision-safe at human trigger rates, never reused across
runs. `run.json` is written **atomically** (temp file + rename) right after the lock is
acquired, with `endedAt`/`exitCode`/`reason` all `null` (in flight), and finalized (those three
fields filled in) on every exit path that writes `campaign-report.json` (see the report contract
below) — including the best-effort `error` path. It is never deleted: `runs/` is the campaign's
full machine-local history. A run.json left with `endedAt: null` whose `pid` is no longer alive
is exactly how the viewer detects a crash. A refused start (`EXIT_LOCKED`) writes nothing — same
symmetry as the report contract: a refused process never creates artifacts. `--dry-run` also
writes nothing (it returns before the lock is ever acquired).

`run.json` schema (v1, `RunRecord` in `core/run-record.ts`):

```json
{
  "v": 1,
  "runId": "2026-07-24T06-13-59-000Z-a1b2",
  "pid": 27542,
  "startedAt": "2026-07-24T06:13:59.771Z",
  "repo": "/abs/path/to/target-repo",
  "statePath": "/abs/path/to/state.json",
  "answersPath": "/abs/path/to/answers.md",
  "escalationsDir": "/abs/path/to/escalations",
  "logsDir": "/abs/path/to/home/runs/<run-id>/logs",
  "argv": ["--cards", "C1,C2", "--max-cards", "1"],
  "endedAt": null,
  "exitCode": null,
  "reason": null
}
```

`statePath`/`answersPath`/`escalationsDir` are recorded **absolute** (resolved against
`--home`, via `core/paths.ts`) — a reader of `run.json` never has to re-derive them relative to
anything. `argv` is the raw `process.argv.slice(2)` this invocation was started with.

## Live viewer

On every real (non-`--dry-run`) invocation, before the first card's executor session spawns,
the runner starts (or reuses) a **read-only** local web page for watching this campaign's
sessions live — one surface, the same package documented in full at
[`scripts/viewer/README.md`](../viewer/README.md); there is no separate status page any more.
It prints two lines on this process's own stdout:

```
campaign viewer: http://127.0.0.1:4321/?campaign=<repoKey>/<slug> (read-only)
card <cardId>: http://127.0.0.1:4321/s/<sessionId>
```

Line 1 is printed once, before the first card's session, and carries the pair
`<repoKey>/<slug>` (§9: a slug alone does not identify a campaign on this machine) — a campaign
filter pre-fills the list view. Line 2 is printed once per card, the instant the SDK assigns
that card's session id, and opens straight to that session's own tab.

- **Auto-started, not owned.** The root URL is derived from `--home` alone (repo key + campaign
  slug) — nothing new is written to disk or to `campaign-state.json` for this. If a viewer is
  already answering `/healthz` on the target port, the runner reuses it instead of spawning a
  second one.
- **It may outlive the run.** The viewer is spawned detached, so it keeps serving the
  transcripts of a card whose session already finished (or the whole campaign, once it's
  `done`) until something else stops it — the runner never kills it on exit.
- **`--no-viewer` disables it entirely** for that run — no probe, no spawn, no printed URL
  (one `campaign viewer: skipped: --no-viewer` note still goes to stderr). `--viewer-port <n>`
  picks a different port than the default `4321` (1-65535).
- **Never affects the campaign run**, but not every failure is visible the same way. A
  failure the runner can SEE — the viewer entry file missing, the `--no-viewer`/`--dry-run`
  skip, a thrown error in the launch path, or a spawn `error` event (e.g. `bun` unresolvable)
  — prints one `campaign viewer: …` line to stderr and the run proceeds. A failure the runner
  **cannot** see: the target port is already held by some other, non-viewer process, so the
  probe reports "nothing here" and the runner spawns anyway; the detached, `stdio: 'ignore'`
  child then dies to `EADDRINUSE` after the URL has already been printed on stdout, and that
  crash is invisible to the parent. If the printed URL doesn't answer, open it or re-run with
  a different `--viewer-port`. Either way this is observability exhaust, never a gate.
  `--dry-run` skips this step entirely (zero side effects stays a hard contract).

See [`scripts/viewer/README.md`](../viewer/README.md) for what the page actually shows (every
Claude Code session transcript on the machine, tailed live, with campaign badges) and its full
route contract.

## State file schema

`<home>/campaign-state.json` is the one artifact the runner requires but never creates — it must
be authored before the runner is ever invoked (normally by a Shaman-authority session doing Stage
A planning; see `plugins/tribe/agents/shaman.md`'s Mode 3). This section documents the schema
completely enough to author a valid file from this README alone, derived from the authoritative
source: the zod schema in `state.ts`'s `CampaignStateSchema`/`CardSchema` and the TypeScript
types in `types.ts`. Schema version stays `"v": 1` — every field this effort added is optional,
so a pre-existing v1 file with none of them round-trips through a load→save cycle
byte-identical.

### Top-level fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `v` | `number` (int) | yes | Must equal `1` (`CURRENT_STATE_VERSION`). Any other value — including a missing `v` — is rejected before structural validation even runs (see Validation errors below). |
| `campaign` | `string` | yes | Free-form campaign name/id. Echoed verbatim as `campaign` in the report contract. |
| `planning` | `{ mode: "shaman" \| "warchief-fanout" }` | **optional** | Records which Stage-A authorship mode produced this campaign's specs/plans (design §O2) — `"shaman"` when the orchestrating session authored the How docs itself, `"warchief-fanout"` when it dispatched one planning-Warchief per card — so a session resuming the campaign later knows without re-deriving it. Not declared in `state.ts`'s `CampaignStateSchema`/`CardSchema` at all: both use `z.looseObject`, which preserves unknown top-level keys through a load→save cycle instead of stripping them (the same property that keeps the v1 byte-identical round-trip true), so `planning` — and any future campaign metadata a caller invents — survives even though the runner itself never reads or interprets it. |
| `mergePolicy` | `string` | yes | Free-form; carried through into every executor brief, not itself interpreted by this runner. |
| `sequence` | `string[]` | yes | Card ids, in build order. Every id **must** have a matching entry under `cards` — a dangling id is rejected at load (`UndefinedSequenceCardError`). |
| `schemaLockPaths` | `string[]` | yes (`[]` is valid) | Paths whose diff across the card branch's **own commits** must stay empty unless that card's plan front-matter declares `allowsSchemaChange: true` (D3 point 6; see "The schema guard's range" below for exactly what "own commits" means and why it changed from `baseSha`). The plan is read **after** the merge, and a card may delete its own planning docs as part of its work — a plan that is gone by then simply grants no waiver (the guard still passes on an empty diff, and names the missing plan when it fails); it never crashes the finalise step. Campaign config, never hardcoded (W1). |
| `docsOnlyPaths` | `string[]` | yes (`[]` is valid) | Path prefixes that count as "docs-only" for the D6 flake waiver. **Fails CLOSED: an empty list means nothing counts as docs-only, so a code diff never auto-waives a red check.** Campaign config, never hardcoded (W1). |
| `ownerOnlyEscalations` | `string[]` | yes (`[]` is valid) | Trigger names that always escalate to the human owner, regardless of what an executor session claims (D5). Campaign config, never hardcoded (W1). |
| `cards` | `Record<string, Card>` | yes | Every card in the campaign, keyed by its id. |

`schemaLockPaths`/`docsOnlyPaths`/`ownerOnlyEscalations` are worth calling out together: all
three are safety config that a Stage-A author must set deliberately, carried **in** the state
file rather than baked into this capability — an author who leaves `docsOnlyPaths` empty gets
the safe (fails-closed) default, not a silent free pass for code diffs.

#### The schema guard's range: the card branch's own commits, not `baseSha`

The guard used to diff `baseSha..<remote>/<baseBranch>` — literally "every commit the base branch
gained since the card started" — so any concurrent PR that touched a locked path while the card
was in flight failed the guard for every other in-flight card, whether or not that card's own work
went near a locked path (a real incident: PR #160 was flagged for five viewer files it never
touched, because two unrelated master-side PRs had landed on the base branch first). The guard now
diffs `<mergeSha>^1...<mergeSha>^2` instead — the merge commit's own two parents, i.e. exactly the
commits the card branch authored (or absorbed from a sub-branch it merged in), never anything the
base branch moved. This range is derived, not stored: `mergeSha` is read fresh from the card's
own record at verify time and its parents are looked up then, so `baseSha` plays no part in this
check any more.

The guard **fails closed** whenever that range cannot be determined — an unknown `mergeSha`, a
merge commit whose parent count isn't exactly 2 (a squash or a rebase merge leaves no such
anchor), a parent lookup that itself couldn't be read, or a `git diff` that exits non-zero — it
reports the guard as failed with an honest reason rather than silently passing. Under-checking
(missing a real locked-path change) is a bug; over-checking by refusing on an undecidable range is
by design.

### Per-card fields (`cards.<cardId>`)

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `status` | `"staged" \| "running" \| "shipped" \| "escalated" \| "blocked"` | yes | Author every card `staged`. `running`/`shipped`/`escalated` are written by the loop as it works the card. `blocked` is **derived** (see `dependsOn`/`blocked` below) — do not hand-author a card as `blocked`; the next `nextCard` call reconciles it back to `staged` if it has no unmet dependency. |
| `spec` | `string \| null` | yes (nullable) | Path (relative to `--repo`) to the card's spec file. Missing on disk (or `null`) when the card is next up triggers `PLANNING_NEEDED`, which the loop escalates. Resolved against `--repo`'s **working tree**, so if that checkout is parked on another ref (a detached HEAD at a release tag, say) every card reads as missing; the escalation — and `--dry-run`'s `planningNeeded.note` — then names the checkout and the `git -C <repo> checkout <base>` that restores it. |
| `plan` | `string \| null` | yes (nullable) | Same, for the plan file. |
| `branch` | `string \| null` | yes (nullable) | The card's git branch, once work starts. `null` at authoring time — this is exactly what makes the D4 resume matrix classify a freshly-authored card `fresh`. The loop fills it in from the card's own PR (`gh pr view --json headRefName`) as soon as a PR number is known, because the executor session picks the branch name itself and never reports it back. |
| `baseSha` | `string \| null` | yes (nullable) | The commit the card's branch is built from. **No longer where D3's schema-lock diff is taken from** — see "The schema guard's range" below; `baseSha` is still recorded and still used elsewhere (e.g. as the anchor a hand-reset card must not keep stale, per R3 below). `null` at authoring time; the loop records `origin/<baseBranch>` into it immediately **before** spawning the card's session, and never overwrites an existing value (a resumed card keeps the base it originally started from) — except a blind-fresh spawn (no prior session/PR/digest), which always re-stamps it (P11, ruling R3). To retry a card from scratch, use the `reset-card` subcommand below — never hand-edit this field; a hand-reset card that keeps a stale `baseSha` is the exact incident R3 exists to prevent. |
| `pr` | `number \| null` | yes (nullable) | The card's PR number, once opened. `null` at authoring time. |
| `mergeSha` | `string \| null` | yes (nullable) | The merge commit sha, once shipped. `null` until shipped. |
| `sessionId` | `string \| null` | yes (nullable) | The SDK-assigned executor session id, written the instant a session starts (crash-safe write, before anything else). `null` at authoring time. |
| `updatedAt` | `string \| null` | yes (nullable) | ISO timestamp of the card's last loop-written change. `null` at authoring time. |
| `dependsOn` | `string[]` | **optional** | Card ids (each must resolve under `cards`) this card must not start before. Omit entirely for an independent card (the common case) — do not author `[]` as a substitute for omitting it. A dangling id is rejected at load (`UndefinedDependencyCardError`); a cycle — direct (`A -> A`) or indirect (`A -> B -> A`) — is also rejected at load (`CircularDependencyError`). See "`dependsOn` / `blocked`" below for runtime behavior. |
| `autoAnswerRounds` | `number` | **optional** | How many Stage-C auto-answer round-trips this card has been through (wall W7 caps this at 2 — see the runner README's escalation section and `shaman.md`'s Stage C protocol). Omit at authoring time. |

**Why `dependsOn`/`autoAnswerRounds` are optional with no schema-injected default:** a
schema-level default (e.g. `.default(0)`) would appear in a re-serialized file even when the
source JSON never had the key, breaking the v1 byte-identical round-trip contract. Omitting them
at authoring time is correct; callers read the conceptual default themselves
(`card.autoAnswerRounds ?? 0`; "no `dependsOn`" simply means independent).

### Watching campaign sessions

Every card's executor session persists to `~/.claude/projects/<encoded-repo>/<sessionId>.jsonl`.
Watch them through the [live viewer](#live-viewer) the runner auto-starts — open the
`campaign viewer:` URL it prints on stdout and pick the card; it tails those transcripts
read-only, so there is no session id to copy and no way to take over a runner-owned session.

### Worked example (a Shaman could author this from this section alone)

```json
{
  "v": 1,
  "campaign": "widget-export",
  "mergePolicy": "regular-merge-only",
  "sequence": ["A1", "A2", "A3"],
  "schemaLockPaths": ["src/schema/"],
  "docsOnlyPaths": ["docs/"],
  "ownerOnlyEscalations": ["data-shape-change"],
  "cards": {
    "A1": {
      "status": "staged",
      "spec": "docs/cards/A1-spec.md",
      "plan": "docs/cards/A1-plan.md",
      "branch": null,
      "baseSha": null,
      "pr": null,
      "mergeSha": null,
      "sessionId": null,
      "updatedAt": null
    },
    "A2": {
      "status": "staged",
      "spec": "docs/cards/A2-spec.md",
      "plan": "docs/cards/A2-plan.md",
      "branch": null,
      "baseSha": null,
      "pr": null,
      "mergeSha": null,
      "sessionId": null,
      "updatedAt": null,
      "dependsOn": ["A1"]
    },
    "A3": {
      "status": "staged",
      "spec": "docs/cards/A3-spec.md",
      "plan": "docs/cards/A3-plan.md",
      "branch": null,
      "baseSha": null,
      "pr": null,
      "mergeSha": null,
      "sessionId": null,
      "updatedAt": null
    }
  }
}
```

`A2` will not start until `A1` ships; `A3` is independent and can ship in any order relative to
the other two.

### Validation errors (thrown by `parseState`/`loadState`, `state.ts`, at load time)

Checked in this order, on every load — a malformed file is refused loudly before the loop ever
runs, never discovered card-by-card mid-campaign:

| Error | Thrown when |
| --- | --- |
| `UnsupportedStateVersionError` | `v` is not exactly `1` (including a missing `v`). |
| `UndefinedSequenceCardError` | `sequence` names a card id with no matching entry under `cards` (e.g. a typo). |
| `UndefinedDependencyCardError` | A card's `dependsOn` names an id with no matching entry under `cards`. |
| `CircularDependencyError` | The `dependsOn` graph contains a cycle — a direct self-dependency (`A -> A`) or an indirect one (`A -> B -> A`). The error carries the full cycle path. |

### The supervisor's additional input: `runs/<runId>/run.json`

`campaign-state.json` above is not the only state a supervisor pass consults. On every
observation cycle it also lists `<home>/runs/` and reads each `run.json` it finds — the same
schema the "Run record" section above documents in full, written by the plain runner and never by
the supervisor itself — and narrows every record it can parse down to three questions:

| Fields read | What the supervisor concludes |
| --- | --- |
| `endedAt` and `pid` | **Liveness** — `endedAt === null` and the recorded `pid` is still alive (`isProcessAlive`) means this run is still going. |
| `endedAt` and `exitCode` | **Finalisation** — both present means this run is over, and its outcome is on disk whether or not any watchdog was watching when it happened. |
| `reason` | **The run's own exit reason** — `run.json`'s `reason` is spelled in `core/report.ts`'s `ExitReason` vocabulary (success is `done`); when the supervisor needs to act on it, it is translated into the watchdog's own terminal-reason vocabulary first (success there is `runner_done`) rather than substituted raw, and an unrecognised reason is never passed through. |

A `run.json` that is missing, unreadable, or fails to parse degrades to "no entry for this run"
rather than throwing — one bad record never takes down the tick loop. This is how a supervisor
pass tells a watchdog terminal it published earlier apart from what has actually happened on disk
since; see the "Supervisor" section's decision table below, and the doorbell's automatic path in
`orchestrate-campaign/SKILL.md`, for the park-supersession behaviour this observation makes
possible.

## `reset-card` subcommand (P11 fix-list follow-up)

**Never hand-edit `campaign-state.json` to retry a card — use this subcommand.** It exists
because hand-editing was the exact incident (P11, ruling R3, "a stale base is worse than no
base"): a card hand-reset to `status: "staged"` kept its old `baseSha`, and the next verify
diffed from before a designed change and tripped a false-positive schemaGuard failure on a PR
that never touched the locked path. `reset-card` is the front door that makes that hand-edit
unnecessary.

```sh
bun plugins/tribe/scripts/runner/run.ts reset-card \
  --home <path-to-campaign-home> \
  --card <card-id>
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--home` | yes | The same campaign home a normal run uses — `reset-card` operates on `<home>/campaign-state.json`. |
| `--card` | yes | The id of exactly one card (a key under `cards`) to reset. |

No other flag is recognized (`--repo`/`--model`/`--remote`/... are all `unknown flag` errors
here — this subcommand's contract has nothing to do with running a campaign pass).

**Refuses (exit `1`, a diagnostic prefixed `reset-card:` on stderr, nothing written) when:**

- a **live** process holds `.runner.lock` — a reset while a pass is mid-flight on that very
  card is exactly the race this guard exists to prevent (a lock held by a dead process is
  reclaimed the same way `acquireLock` reclaims it — it never blocks a reset);
- `<home>/campaign-state.json` is missing, unreadable, or fails to parse/validate (any of the
  Validation errors above);
- `--card` names an id with no entry under `cards`.

**On success (exit `0`):** writes the reset state back and prints ONE line of JSON to stdout —
`{"cardId":...,"previousStatus":...,"status":"staged","clearedFields":[...]}` — so an
orchestrating session can quote exactly what changed without re-deriving it from a diff.

**What a reset actually changes**, field by field (full rationale — including why `branch`/
`pr`/`dependsOn` are or aren't treated alike — lives on `resetCard`'s doc comment in
`core/state.ts`):

| Field | After reset | Why |
| --- | --- | --- |
| `status` | `"staged"` | The contract. |
| `sessionId` | `null` | The contract — also what marks "no world exists yet" for the two fields below. |
| `baseSha` | `null` | Ruling R3 itself — the incident this subcommand exists to prevent. |
| `pr` | `null` | A stale `pr` is a silent fallback target (`card.pr = sessionResult.pr ?? card.pr` in `card-actions.ts`) if a future ship ever fails to report a fresh PR number — same "trusted without a reality-check" shape `baseSha` had before P11. |
| `mergeSha` | `null` | Same stale-fallback shape, one line over; also purely observational once the card isn't `shipped`. |
| `updatedAt` | `null` | Bookkeeping only, never read to decide anything. |
| `autoAnswerRounds`, `healedResidue` | **deleted** (become absent, not `0`/`[]`) | Both fields are schema-optional specifically so "never happened" means absent — a stale count/record from the discarded attempt would misreport the new one. |
| `branch` | **unchanged** | Never trusted blindly — `deriveCardPhase` re-derives the true phase from live `gh`/`git` every time `branch` is non-null. Clearing it would skip that reality-check and the resume matrix's own residue-cleanup path (`revert_and_redo`), reopening the duplicate-PR hazard a blind fresh spawn over a still-open PR creates. |
| `dependsOn`, `spec`, `plan` | **unchanged** | Structural (this card's declared dependencies and doc paths), not a per-run value — a reset of one card must never rewire the campaign's dependency graph. |
| any unknown field (top-level or per-card) | **unchanged, byte-faithful** | `state.ts`'s `looseObject` schemas already guarantee this for every load→save cycle; `reset-card` is no exception. |

**Escalation files are not touched.** An escalation lives in a sibling file
(`<home>/escalations/<card-id>.md`), never a `Card` field, so `reset-card` has nothing to
clear there — but if that file is still present after a reset, `deriveCardPhase` will keep
short-circuiting this card straight back to `escalation_pending` on the next run (see "Resume
semantics" below), even though the state file now says `staged`. `reset-card` warns about this
(a second stderr line, still exit `0`) rather than silently leaving it inconsistent, and
deliberately does **not** auto-archive the file: archiving is coupled 1:1 to an actual ruling
recorded in `answers.md` (see "Escalation / answers workflow" below) — a plain reset makes no
ruling, so it must not fabricate one. To actually unblock such a card, either rule on it and
archive the file per that section's ritual, or pass `--include-escalated` on the next run.

## How this is normally triggered

The runner is **not meant to be invoked by hand as the normal path.** It is triggered by the
`orchestrate-campaign` tribe skill (installed with `plugins/tribe`; trigger phrases:
"orchestration: do these N ideas", "orchestrate these ideas", "run these N cards"), which
authors the state file per the schema above, runs `--dry-run` first as a sanity check, then
triggers a real run in the background, and round-trips any escalations through Stage C (spec
§O1/§O3/§O6). That skill depends on this capability's **contract only** — the flags, exit
codes, and report file documented in this README — never on this directory's source; if you are
extending the skill or writing something else that drives this campaign runner, do the same.

**Manual invocation remains for debugging** — a scoped run under supervision, or a sanity check
while diagnosing one card:

```sh
bun plugins/tribe/scripts/runner/run.ts \
  --repo <target-repo> \
  --model <model> \
  --home <path-to-campaign-home> \
  --dry-run
```

`--dry-run` derives the next card and its resume phase from live `gh`/`git` state and prints the
plan as JSON, without acquiring the lock, writing anything (no state, no report — see the report
contract below), or spawning a session. Then, to run for real, optionally scoped to one card:

```sh
bun plugins/tribe/scripts/runner/run.ts \
  --repo <target-repo> \
  --model <model> \
  --home <path-to-campaign-home> \
  --cards <card-id> --max-cards 1
```

## Resume semantics (spec §D4)

**The file is data, `gh`/`git` are authority.** On every start, before acting on a card, the
runner re-derives that card's true phase from live GitHub/git state — it never trusts the
state file's own `status` field. The resume matrix, exactly as implemented in
`deriveCardPhase` (`loop.ts`):

| Observed reality | Phase | Action |
| --- | --- | --- |
| Escalation file exists for the card (unless `--include-escalated`) | `escalation_pending` | **Park** — nothing new is attempted or written for this card this pass; the loop records it and moves straight to the next progressable card. The run only exits once no progressable card remains (D5′, below) — this is **not** an immediate abort (`loop.ts:957-965`). |
| No `branch` recorded for the card | `fresh` | Spawn a fresh session (no digest — genuinely no trace). |
| PR found for the branch, `state == "MERGED"` | `verify_only` | Run the D3 verify checks and record — no session spawned. |
| PR found for the branch, `state == "OPEN"`, a `sessionId` is recorded | `resume` (`pr_open`) | Attempt `resume: sessionId` with a "check CI, complete the merge" prompt. |
| PR found for the branch, `state == "OPEN"`, no `sessionId` recorded | `fresh` (carries a digest) | **F8 fix, verified against `loop.ts:170-184`:** spawn fresh, but carrying a state digest that names the open PR and instructs the session to inspect and continue it rather than open a second one. This is explicitly **NOT** "same as no trace" — the in-code comment at `loop.ts:170-174` rebuts that reading directly. |
| No PR, but the branch/worktree still exists, a `sessionId` is recorded | `resume` (`branch_no_pr`) | Attempt `resume: sessionId` with a "continue implementing" prompt. |
| No PR, branch/worktree exists, no `sessionId` recorded | `revert_and_redo` | Delete the worktree + local/remote branch, then spawn fresh. |
| No PR, no branch, no worktree | `fresh` | Spawn a fresh session (no digest — genuinely no trace). |

> **Correction (this doc previously got the fifth row wrong):** an earlier revision of this
> table described "PR found, OPEN, no `sessionId`" as `fresh — nothing to resume — spawn fresh
> (same as "no trace")`. That was the **pre-F8** behavior. F8 was fixed in `cee591d` (merged
> `2c17c26`): the code has spawned fresh-with-digest ever since, precisely so a session never
> silently opens a second PR for a card that already has one open. The row above reflects what
> `loop.ts` actually does today, verified by reading `deriveCardPhase` directly.

A `fresh` phase can carry a state digest (last known status/branch/PR/`baseSha`) in **two**
distinct situations — never blindly:

1. **F8** (the corrected row above): an OPEN PR was found for the branch but no `sessionId` was
   ever recorded — there IS a trace (the PR itself), so a blind fresh session would rebuild the
   card and open a duplicate PR.
2. A `resume` attempt itself surfaced a typed `error` outcome (no transcript, an SDK error —
   never on `timeout`, since the prior session may still be running); the loop falls back to a
   **fresh** session carrying the digest (`loop.ts`'s `runCardSession`).

A `fresh` phase with no digest (the two rows above with no PR/branch/worktree trace at all) means
there really is nothing to report — a blind fresh session is correct there. There is no
session-listing API in the SDK, so resumability is only ever probed by attempting the resume —
never by listing.

## `dependsOn` / `blocked` (spec §O4)

A card may declare `dependsOn: ["<card-id>", ...]` — ids of cards it must not start before (all
must resolve under `cards`; a dangling id or a cycle is rejected at load, see Validation errors
above). A card with no `dependsOn` (or an empty one) is independent — exactly the behavior before
this field existed.

- **Progressable** (`nextCard`, `state.ts`) means: not `shipped`; not `escalated` (unless
  `--include-escalated`); not `blocked`; and every id in its `dependsOn` is currently `shipped`.
  A card whose dependency is merely unshipped-but-healthy (`staged`/`running`) is skipped for now
  — its own status is left untouched, and it may still ship later in the same pass once that
  dependency ships.
- **`blocked`** (a new card status) means: the card is not itself `shipped`/`escalated`, but it
  (transitively) depends on a card that is `escalated` or itself `blocked` this same way — wall
  W6, dependency safety: a card never starts while a dependency it declared is parked.
- **`blocked` is DERIVED, never authored and never trusted from disk.** Every `nextCard` call
  recomputes the full `blocked` set from scratch (a fixpoint over every card in `state.cards`,
  not just `sequence`/`--cards`-filtered ones) and reconciles every card's stored status against
  it before the selection walk even starts: a card that should be blocked but isn't yet is set to
  `blocked`; a card that stores a stale `blocked` but no longer has an unmet dependency is reset
  to `staged`. A card's parking status is therefore always current, even for a card the
  selection walk itself never reaches this pass.

## Concurrency (`--max-concurrent`, P12 follow-up)

**Default (`--max-concurrent 1`, or the flag omitted): exactly one card's session runs at a
time, in `sequence` order, awaited to full completion before the next card is even selected.**
This is the runner's original, unconditional behavior — `--max-concurrent` does not exist yet as
far as a run that never passes it is concerned.

**`--max-concurrent N` (N > 1)** bounds how many cards' executor sessions may be *in flight at
once* this pass — a small worker pool over progressable cards, not a rewrite of card selection:

- **Width only, never order.** `dependsOn` (above) is still the ONLY thing that orders cards. A
  dependent card is never selected while its dependency is mid-flight, for the same reason it's
  never selected while merely `staged`: `nextCard` treats any non-`shipped` status — including a
  card another worker currently has claimed — as "not shipped yet". Declaring `dependsOn` is
  still how you force strict one-by-one ordering (see the previous section and the
  `orchestrate-campaign` skill's own "Serial campaigns" guidance) — `--max-concurrent` never
  substitutes for it; it only bounds how many *independent* cards may overlap.
- **No two workers are ever handed the same card.** Selection (`nextCard`/`filteredNextCard`) is
  synchronous — and mutating (`nextCard` reconciles derived `blocked`/`staged` statuses in place
  on every call), but never touches an in-flight card's status, only cards that do/don't
  transitively depend on an `escalated` one — a card is marked claimed in the SAME synchronous
  step it's selected, with no `await` in between, so concurrent selection can't race.
- **State writes stay consistent.** Every card mutation (`card.status`, `card.pr`, ...) is
  immediately followed, in the same synchronous span, by a full-state write
  (`persistLocalState`) — JS's single-threaded, run-to-completion semantics make each
  mutate-then-flush pair atomic, and because `campaign-state.json` is always serialized WHOLE
  (never a per-card patch) from one shared, in-memory `CampaignState` object, later writes always
  include every mutation any worker had applied by that point — never a lost update, regardless
  of which card's session happens to finish first.
- **Runner-side git worktree/branch mutations are serialized too.** `git worktree add/remove` and
  `git branch -D` mutate git's shared, repo-wide bookkeeping (`.git/worktrees/`, `.git/refs/`),
  not per-card state — REVERT_AND_REDO and residue-heal (`performRevertAndRedo`,
  `executeHealActions`, `gatherWorktreeResidueFacts`, `core/loop/card-actions.ts`) queue behind a
  single in-process promise chain (`serializeRepoGitMutation`) so two cards' calls into that
  shared bookkeeping never interleave. A no-op at N=1 by construction (nothing is ever queued
  ahead of the one caller in flight).
- **One card's crash never takes down the pass.** An uncaught exception anywhere in a card's turn
  is caught and reported as that ONE card's own `stopped`/non-retryable outcome — every other
  in-flight card keeps running to completion; the pass still ends cleanly.
- **`--max-cards` under concurrency is an optimistic ceiling, not an exact stop.** The pool
  cannot know a freshly-claimed card will turn out to be a no-op park
  (`escalation_pending`/answered-and-parked) until it actually checks, so a batch can occasionally
  claim slightly fewer REAL work-units than `--max-cards` allows before recognizing the budget is
  spent — it can never exceed it.
- **Not solved by this flag (two documented limitations):**
  - *Merge races on a shared base branch.* Two cards that both merge to the SAME base branch can
    still contend at the actual `gh pr merge` step — this runner does not add any merge-queue/
    serialization logic beyond what git/GitHub already do (a stale-base merge fails or re-queues
    on the GitHub side). If your cards merge to the same branch and each should build on the
    previous one's merged result, use `dependsOn` to force the ordering `--max-concurrent`
    deliberately does not provide — this was already the prior campaign's own recommendation (see
    the P12 fixlist note) before this flag existed, and it still applies at any `N`.
  - *Each card's own executor session runs its own git commands* (worktree add, checkout, commit,
    push, ...) with the SAME repo root as its `cwd`, independent of the runner-side serialization
    above — this runner has no seam into a session's own spawned process to queue those calls too.
    Git's own locking mostly prevents outright corruption, but a lock-contention failure can
    surface as an ordinary non-zero exit from a git command inside a session — read that as
    transient contention worth a retry, not repo corruption worth escalating on sight. Giving
    every session its own isolated `cwd`/worktree is real future hardening, not done here.

Use `--max-concurrent` when a campaign genuinely wants bounded parallelism (independent cards,
no shared base branch, no ordering requirement) — for anything requiring strict one-by-one
execution, author the full sequential `dependsOn` chain instead, exactly as before this flag
existed.

## Escalation / answers workflow (spec §D5) and D5′ park-and-continue (spec §O4)

The runner escalates instead of deciding whenever: the executor reports
`NEEDS_DIRECTION`, the D3 verify checks fail **twice** in a row for a card, or the next
progressable card's spec/plan files are missing on disk (`PLANNING_NEEDED` — when the `--repo`
checkout is not on the base branch, the escalation says so and how to restore it, since that is
the usual reason files present on the base branch read as missing). On escalation, the
runner:

1. Writes `<home>/escalations/<card-id>.md` (question, context, options) — written **first,
   unconditionally**, before anything else.
2. Marks the card `escalated` in the local state (`<home>/campaign-state.json`; the runner makes
   no git commits of its own).
3. **D5′ (this effort's amendment — replaces the original D5 "exit"):** the loop does **not**
   exit here. It moves on to the next progressable card in the same pass (`loop.ts`'s `runLoop`,
   the `while` loop that turned a `break` into a `continue`). The run exits only once **no
   progressable card remains** — every remaining card is `shipped`, `escalated`, or `blocked` —
   or the `--max-cards` budget is spent. Exit code `2` (`EXIT_ESCALATED`) therefore now means
   "the pass finished; **≥1 escalation is pending**", **not** "aborted at the first question" —
   other cards in the same pass may well have shipped normally. `EXIT_SESSION_INCOMPLETE` (3)
   is the same shape: a card whose session ended `error`/`timeout` with no further D4 fallback is
   recorded and the pass continues past it too.

Within one pass, a card is never selected twice (`loop.ts`'s `attempted` set) — this is what
makes `--include-escalated` (the exact flag Stage C's round-trip re-triggers with) terminate
instead of re-escalating the same card forever.

To resolve an escalation: a human (or, per spec §O6, a Shaman-authority orchestrator session)
appends a ruling to `<home>/answers.md` (every executor brief embeds its full content), then
re-runs the script. A card whose escalation file is still present is skipped
(`escalation_pending`, parked — see the resume matrix above) unless the re-run passes
`--include-escalated`.

**Escalation-file lifecycle (P6 fix-list — "answered/shipped escalations stop haunting
re-triggers"):** the escalation file is never deleted automatically, but it IS archived
(renamed, never removed — the ruling trail stays inspectable) the moment it stops being
relevant, two ways: (1) `shipCard` archives it to `<card-id>.md.resolved-shipped` the instant
a card ships — a shipped card must never re-park; (2) the `orchestrate-campaign` skill's Stage-C
ruling step archives it to `<card-id>.md.resolved-R<n>` in the same atomic step it appends the
ruling to `answers.md`. Once archived, a flag-less re-trigger of that card proceeds normally —
`--include-escalated` is needed only to force a retry of a card whose escalation file is still
present (i.e. genuinely unanswered).

## Rulings gate (harness-gap-wiring PR C)

**Postmortem (campaign outstanding-17):** a ruling appended to `answers.md` that captured a
durable convention was never carried into the target repo's own governance files (a rule, a
debt entry, a roadmap card) — nothing mechanically gated on it, so it was silently dropped.
Every other step in the campaign runner's loop is mechanically forced (the D3 verify replay,
the D2 lock, the report contract below); this was the one step that ran 0% of the time because
nothing checked it. This gate closes that gap.

**When it fires:** only on the pass that would otherwise conclude `EXIT_OK`/`done` — every
requested card `shipped`/`blocked`/`escalated`, nothing left to do. An
`escalations_pending`/`session_incomplete`/`stop_requested` exit is completely unaffected; the
gate never runs on those paths at all (`core/loop/run-loop.ts`'s `applyRulingsGate`, called once,
right before `runLoop` returns).

**What it checks:** every `## `-headed block in `answers.md` is a "ruling" (the outstanding-17
convention is `## R<n> — <title>`, but ANY `## ` heading counts). A ruling is **ratified** once
its block carries a `ratified-as:` line (case-insensitive key; a leading `-`/`*` bullet and
`**bold**` markers around the key are all tolerated) whose value is one of:

| Value | Meaning |
| --- | --- |
| `rule <path>` | Landed as a rule file at `<path>` (e.g. a project rule under `plugins/tribe/rules/` or `.c3/`). |
| `debt <id>` | Recorded as a harness-gap debt entry with that id (`plugins/tribe/scripts/gaps/`). |
| `roadmap <ref>` | Carried forward as a roadmap card (`<ref>` names it). |
| `operational` | A one-off operational decision — deliberately not durable, no governance artifact expected. |
| `dismissed` | Considered and explicitly rejected — no further action. |
| `pending` | Explicitly not yet ratified. Valid vocabulary, but **does not** clear the gate. |

Any other value, and a ruling block with **no** `ratified-as:` line at all, both classify as
unratified — this is strict by design (the gate exists to force the discipline the postmortem
found missing, not to guess intent). The pure classification lives in `core/rulings.ts`
(`parseRulings`/`isRulingRatified`/`unratifiedRulingIds`); the gate itself is `core/loop/
run-loop.ts`'s `applyRulingsGate`, applied to `resolved.answersContent` — the same `answers.md`
read the loop already performs for every executor brief, not a second file read.

**What happens when it fires:** the exit code becomes `5` (`EXIT_RULINGS_UNRATIFIED`) and the
report's `run.reason` becomes `'rulings_unratified'`. This is **campaign-level state, not a
per-card escalation** — no single card owns it, so it is folded into the report's existing
"## Pending (needs the owner)" section (`renderRulingsUnratifiedNote`, `report.ts`) rather than
a per-card `escalations/<card>.md` file in the shape "Escalation / answers workflow" above
describes — `core/loop/card-actions.ts` is untouched by this gate. The note is labeled
**"answerable"** (the same vocabulary the P5 fix-list uses for reasons a ruling alone clears,
as opposed to a mechanical verify failure) and names every unratified ruling id verbatim. To
resolve: add `ratified-as:` to each named block in `answers.md` (or ratify it via the
governance path it names) and re-trigger; nothing else about the campaign's cards is touched by
this gate.

## Harness-gap gate and the `gap-gate v1` stamp (spec CU-4 §2, §3)

Before any card PR is opened, the executor runs the gap gate:

```bash
bun plugins/tribe/scripts/gaps/gap-gate.ts --repo <target-repo> --home <tribe-home> \
    --card <card-slug> --base <merge-base-sha> [--head HEAD] [--pr <n>]
```

It reads every `<home>/reports/tracker-<card>-*.md` (so a candidate found at task 3 and absent
from the final round still reaches reconciliation), reconciles them against
`.tribe/harness-gaps.jsonl` in the target repo, runs the debt burn-down diff, and writes
`<home>/reports/<card>-gap-gate.md` — the complete `## Harness gaps` PR-body section, ending in
one machine-checkable stamp line. Exit 0 = green, 1 = red (positive debt delta, or an unsafe
fingerprint), 2 = setup error (no Tracker report, bad range, unreadable ledger). Zero Tracker
report files is a RED gate, never an empty set.

Under ledger policy A the append is committed on the card branch with the trailer
`Tribe-Milestone: gap-gate`, so the ledger rides the PR onto the base branch.

`verifyShipped` therefore replays **seven** D3 points, not five. The two added by CU-4 §3 are:

- `gapGateStamped` — the merged PR body carries a `gap-gate v1` stamp whose `base=`/`head=` shas
  are commits of the merged branch, and whose `card=` names an identity of this card: either the
  runner's campaign-local card id, OR a `Tribe-Card:` trailer value on the commits the merged PR
  brought in (a card has two names — spec §3a — the runner id and the Warchief's slug used in
  every `Tribe-Card:` trailer). The trailer check runs
  `git log --format=%(trailers:key=Tribe-Card,valueonly) <mergeSha>^1..<mergeSha>` and accepts
  `stamp.card` if it appears among those trailer values. A stamp naming neither still fails.
- `ledgerCommitted` — every id the stamp says was minted is present in the ledger as committed
  on the base branch.

Both are reported like every other point (never short-circuited): a failure escalates the card
instead of recording `shipped`, which is what makes a PR opened by a session that bypassed the
Warchief a red verdict a human must act on.

## Report contract (spec §O5)

On **every** exit path except `--dry-run` (zero side effects, by construction — nothing is
written) and `EXIT_LOCKED` (a refused process must never clobber the live process's in-progress
report), the runner writes `campaign-report.json` and its human-readable twin
`campaign-report.md` into `--home` (`core/paths.ts`'s `reportDirOf`). This is the **one
artifact** a caller needs to read after an invocation — per spec §O3, **the exit code is a hint;
the report is the truth.**

```json
{
  "v": 1,
  "campaign": "widget-export",
  "run": { "startedAt": "…", "endedAt": "…", "exitCode": 2, "reason": "escalations_pending" },
  "cards": {
    "A1": { "outcome": "shipped", "pr": 41, "mergeSha": "…" },
    "A2": { "outcome": "escalated", "escalationFile": "escalations/A2.md",
             "question": "one-line digest", "autoAnswerRounds": 1 },
    "A3": { "outcome": "blocked", "blockedOn": "A2" }
  },
  "pending": ["A2"],
  "stats": { "shipped": 1, "escalated": 1, "blocked": 1, "notReached": 0 }
}
```

- **`run.reason`** — one of `done` | `stop_requested` | `escalations_pending` |
  `session_incomplete` | `error` | `rulings_unratified` (`report.ts`'s `deriveExitReason`).
  `error` covers an unhandled exception thrown after `runLoop` was entered (`run.ts`'s own
  `EXIT_ERROR = 4` — see Exit codes below; not one of `loop.ts`'s `EXIT_*` constants).
  `rulings_unratified` is the rulings gate (see that section above) — its `run` object also
  carries `unratifiedRulings: string[]`, and the `.md` twin renders them inside the existing
  "## Pending (needs the owner)" section (a campaign-level note, not a per-card entry).
- **Per-card `outcome`** is one of `shipped | escalated | blocked | not_reached`, read entirely
  from the final `CampaignState` on disk (never from `loop.ts`'s own `CardOutcome[]`) —
  `main()` reloads state fresh from disk to build the report rather than reusing `runLoop`'s
  in-memory result, so even if the run ends via an unhandled exception mid-pass, the report
  still reflects every card that concluded before the crash: each card's outcome is written to
  disk (`persistLocalState`) the moment that card ships or escalates, independent of whatever
  happens to the rest of the pass afterward.
  - `shipped` carries `pr`/`mergeSha`.
  - `escalated` carries `escalationFile`, a best-effort one-line `question` digest parsed from
    that file, and `autoAnswerRounds` (defaults to `0` if absent).
  - `blocked` carries `blockedOn` — the **first** unmet dependency in the card's own `dependsOn`
    order (a single string, matching this JSON shape, not an array).
  - `not_reached` covers both a card the pass never got to, and a card left `running` by a
    session that stopped mid-flight without concluding (the frozen four-value vocabulary has no
    separate slot for that case; it needs no distinct owner action either way, so it folds in).
- **`pending`** lists every `escalated` card id — the ones that need an answer. A `blocked` card
  is not itself in `pending` (its `blockedOn` names the card that is).
- The `.md` twin is rendered from the exact same report structure the JSON twin serializes
  (`renderReportMarkdown`) — JSON↔md parity is structural, not a maintained-by-hand promise.

**Which exit paths write a report — the complete list:**

| Exit path | Writes report? |
| --- | --- |
| CLI argument error (missing/invalid flag) | **No** — state was never loadable; `run.ts` exits before the report logic is even reached. |
| `--dry-run` | **No**, unconditionally, regardless of exit code. |
| `EXIT_LOCKED` (`.runner.lock` held by a live process) | **No** — would clobber the live process's report. |
| `EXIT_OK` (`done`, or startup `STOP`) | Yes — `reason: 'done'` or `'stop_requested'`. |
| `EXIT_ESCALATED` | Yes — `reason: 'escalations_pending'`. |
| `EXIT_SESSION_INCOMPLETE` | Yes — `reason: 'session_incomplete'`. |
| `EXIT_RULINGS_UNRATIFIED` (the rulings gate overrode a would-be `done`) | Yes — `reason: 'rulings_unratified'`. |
| An unhandled exception after `runLoop` was entered | Yes (best-effort) — `reason: 'error'`, exit code `4`. |

## STOP file and the lock file (spec §D2)

Both live directly under `--home`, alongside `campaign-state.json`:

- **`STOP`** — the owner's soft-stop. If present when a run starts, the runner exits cleanly
  (code `0`) before touching any card. If it appears mid-run, the loop finishes the
  in-flight card and stops before starting the next one. Delete it to resume.
- **`.runner.lock`** — single-instance guard (`{ pid, startedAt }`). A run refuses to start
  (exit code `1`) if a **live** process already holds the lock — two concurrent loops would
  double-spawn sessions and PRs. A lock left behind by a process that is no longer running
  (a crash, `kill -9`) is reclaimed automatically on the next start — liveness is checked via
  an OS-level probe (`process.kill(pid, 0)`), not a time-based guess.

`--dry-run` touches neither file, and writes no report either: it never acquires the lock and
never checks `STOP` — zero side effects by construction, not merely by intent.

## ANTHROPIC_API_KEY guard (fix-list P10)

The tribe **never** authenticates via `ANTHROPIC_API_KEY` — executor sessions authenticate via
Claude Code login only. Two mechanical steps run at the very top of `main()`, before any session
spawn, on **every** invocation (fresh launch and re-trigger), and both are idempotent:

1. **Unset the runner's own process env.** If `process.env.ANTHROPIC_API_KEY` is set,
   `adapters/run-io.adapter.ts`'s `unsetAnthropicApiKeyEnv()` deletes it and `main()` prints one
   warning line to stderr. This is process-local — it happens the same way under `--dry-run`.
2. **Scrub the target repo's `.env.local`.** If `<repoRoot>/.env.local` exists and contains an
   `ANTHROPIC_API_KEY=...` line (with or without a leading `export `), the runner removes that
   line **without asking** (owner ruling) on a real run, and warns-only under `--dry-run`
   (writing nothing — `--dry-run` stays zero side effects by construction). The pure line-removal
   logic lives in `core/env-guard.ts`'s `scrubEnvContent` (preserves every other line
   byte-for-byte, including trailing-newline presence/absence); the edge wiring —
   `cli/main.ts`'s exported `scrubTargetEnvLocal` — reads/writes the file through `io` and is
   **best-effort**: any fs error here (a permission error, a mid-flight delete, a read-only
   mount) is caught and degrades to a console warning rather than crashing the run before
   `runLoop` is even entered (same contract as `tryWriteReport`/`tryFinalizeRunRecord` below).

Accepted risk (owner-accepted, recorded in the P10 spec): a target repo whose application
legitimately needs `ANTHROPIC_API_KEY` in its own `.env.local` would have that line silently
removed on every real run against it. `plugins/tribe/scripts/doctor.sh` reports (never gates on)
both traps: it never claims "ok" credentials when `ANTHROPIC_API_KEY` is the *only* credential
source present (that variable is stripped before every spawn, so it is never actually usable),
and it warns when the target repo's `.env.local` still sets the variable.

## Exit codes

Read from `EXIT_*` in `loop.ts`, plus `run.ts`'s own `EXIT_ERROR`:

| Code | Constant | Meaning |
| --- | --- | --- |
| `0` | `EXIT_OK` | Ran to `done` (every progressable card `shipped`/`blocked`/`escalated`), or `--dry-run` completed, or the `STOP` file was present at startup. |
| `1` | `EXIT_LOCKED` | `.runner.lock` is held by a live process. Also returned for a CLI argument error (missing/invalid flag) before the loop even starts. |
| `2` | `EXIT_ESCALATED` | D5′: the pass finished and **at least one card is `escalated`** — a fresh escalation this pass, or one still parked, unanswered, from a prior run. Not "aborted at the first question"; other cards in the same pass may have shipped. Read `campaign-report.json`'s `pending` for which card(s) need an answer. |
| `3` | `EXIT_SESSION_INCOMPLETE` | D5′: at least one card's session ended `error`/`timeout` with no further D4 fallback (no card in this pass escalated); state was already recorded locally, so the next start resumes it — this is not a human-decision escalation. |
| `4` | `EXIT_ERROR` (`run.ts`, not a `loop.ts` constant) | An unhandled exception surfaced after `runLoop` was entered. The report's `run.reason` is `'error'` — per §O3, treat the report as authoritative over this numeric code. |
| `5` | `EXIT_RULINGS_UNRATIFIED` | The rulings gate (see "Rulings gate" above): the pass would otherwise have concluded `done`, but `answers.md` carries ≥1 ruling with no recognized `ratified-as:` disposition. `campaign-report.json`'s `run.unratifiedRulings` names them. |

## Watchdog (card i74, issue #74)

A **script, not an LLM session**, that supervises one runner pass at **zero token cost**: it
launches or adopts the runner, waits out an account-limit (quota) death until the log's own
`resetsAt`, backs off an overload (HTTP 529) death, relaunches a crash once, detects a stall
from log mtime, and exits **only** when a human must act (D74-2). Because it exits rather than
sleeping forever, the harness's own "background command exited" notification IS the whole
heartbeat — no periodic LLM wake-up is spent watching it. It is a **subcommand of this same
runner CLI**, not a separate installable: `run.ts watchdog …`.

```sh
bun plugins/tribe/scripts/runner/run.ts watchdog \
  --repo <target-repo> --model <model> --home <campaign-home> \
  [--once | --follow] [own flags below] [runner pass-through flags]
```

`--repo`, `--model` and `--home` are required — no defaults, exactly like the runner itself.
`--home` is resolved against `cwd` when relative, symlink-resolved on both sides, and refused
(exit `1`, typed message) unless it sits inside `realpath("$HOME/.tribe")` and already contains
a `campaign-state.json` (a campaign home is authored by `orchestrate-campaign` before either the
runner or the watchdog ever starts).

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--follow` | on (implicit) | Keep supervising until a terminal state; the harness's own detached-launch + exit is the notification. |
| `--once` | off | One observe→decide→act tick, then return — never sleeps. Mutually exclusive with `--follow`. Used from cron/launchd wake-ups (spec D74-6). |
| `--stall-minutes` | `30` | No newest-log mtime change for this many minutes while the runner is alive is a stall. |
| `--max-quota-waits` | `6` | Consecutive quota waits allowed before giving up (`needs_human:quota_cap`). |
| `--max-overload-backoffs` | `5` | Consecutive 529 backoffs allowed before giving up (or one `--fallback-model` relaunch — see the action table). |
| `--max-crash-relaunches` | `1` | Relaunches allowed for an exit `3` with no quota/overload signal before `needs_human:session_incomplete`. |
| `--poll-seconds` | `30` | Wake-up slice for every bounded wait (capped at `60`, spec §7: "it sleeps in small wake-up loops"). |
| `--quota-grace-seconds` | `30` | Added to the log's `resetsAt` before relaunching. |
| `--fallback-model <tier>` | off (`null`) | After the overload cap, relaunch once on this model tier instead of parking `needs_human:overloaded`. |

`--dry-run` is **rejected as an unknown flag** by name: a watchdog over a zero-side-effect run
has nothing to observe. Every optional flag the runner itself accepts — `--cards`,
`--max-cards`, `--session-timeout`, `--logs-dir`, `--max-concurrent`, `--include-escalated`, and
`--remote` — is forwarded verbatim to the runner it spawns.

### Exit codes

| Code | Constant | Meaning |
| --- | --- | --- |
| `0` | `WATCHDOG_EXIT_DONE` | The supervised campaign reached a terminal state that needs no human (`runner_done` or `stop_requested`). |
| `1` | `WATCHDOG_EXIT_USAGE` | A CLI argument error (bad/missing/unknown flag), or `--home` could not be resolved / is outside `$HOME/.tribe` / has no `campaign-state.json`. |
| `10` | `WATCHDOG_EXIT_NEEDS_HUMAN` | A human must act. The exact reason is in `status.json`'s `terminal.reason` (`escalations_pending`, `rulings_unratified`, `error`, `quota_cap`, `overloaded`, `session_incomplete`, `lock_conflict`, `stalled`), or an unexpected internal I/O failure caught at the CLI edge. |
| `11` | `WATCHDOG_EXIT_RUNNING` | `--once` only: the runner is still alive, or a quota/overload wait is pending — `status.json`'s `nextWakeAt` says when to re-invoke. |

### Files (all under `<home>/watchdog/`)

The watchdog writes **nowhere else** in the campaign home — never `campaign-state.json`,
`answers.md`, or an escalation file:

- **`status.json`** — rewritten atomically (write-to-temp then rename) on every state
  transition; the shape a Monitor/`until` loop or the watchdog polls.
- **`events.jsonl`** — append-only, one JSON line per action, each carrying its own ISO
  timestamp (`at`) — a plain audit trail, never truncated or rewritten.
- **`runner-stdout/attempt-<N>.log`** — the stdout+stderr of the `N`th runner process this
  watchdog invocation spawned (attempt numbers start at 1 and never reset within one
  invocation).

### The action table (spec §2.1, as amended by §9 — §9 wins where they differ)

| Observation | Action |
| --- | --- |
| No live runner, no prior run this invocation, no lock held | `launch` |
| Live runner (lock/pid alive) at start, or right after a `launch`/`relaunch` | `attach` — wait on it; **never** a second launch. In `--follow` mode a `launch`/`relaunch` is always followed by an `attach` on the very next tick, since the loop re-observes the child it just spawned rather than spawning a second one (`--once` returns `exit(running)` immediately after the launch itself, before any such re-observe happens). |
| Runner exited `0` | `exit(done:runner_done)` — watchdog exit `0` |
| Runner exited `2` | `exit(needs_human:escalations_pending)` |
| Runner exited `5` | `exit(needs_human:rulings_unratified)` |
| Runner exited `4` | `exit(needs_human:error)` |
| Runner exited `3` (or a crash with no exit code to read), newest log's **last** `rate_limit_event` is `rejected` with a **future** `resetsAt` | `wait_until(resetsAt + --quota-grace-seconds)` then `relaunch`; count a quota wait; at `--max-quota-waits` → `exit(needs_human:quota_cap)` |
| Runner exited `3` (or crash), no quota signal, newest log's **last** `result` line carries an overload/5xx `api_error_status` | backoff-and-`relaunch` (`30s, 60s, 120s, 240s, 480s`, clamped); count an overload backoff; at `--max-overload-backoffs` → one `--fallback-model` relaunch if configured and not yet used, else `exit(needs_human:overloaded)` |
| Runner exited `3` (or crash), no quota or overload signal | `relaunch` once; a second time → `exit(needs_human:session_incomplete)` |
| Runner exited `1` (single-instance lock held) | `attach` if the lock holder is alive; else `relaunch` once, repeat → `exit(needs_human:lock_conflict)` |
| Runner alive, newest log mtime unchanged for `> --stall-minutes` | record `stall`; `--follow` → `exit(needs_human:stalled)`; `--once` → `exit(running:stalled)` |
| `--once`, runner alive, not stalled | `exit(running:runner_alive)` |
| `STOP` file present | suppress only actions that would START work (`launch`/`relaunch`/`wait_until`); `exit(done:stop_requested)` |

**Precedence (W-P1):** a terminal runner exit (`0`/`2`/`4`/`5`) always outranks a `STOP` file —
it is a more informative answer than `stop_requested`. Within exit `3`, a quota signal always
outranks an overload signal (a quota wall has a known reset instant; a 529 is transient).

### What it never does

- **Never kills the runner or a session.** The runner's own `--session-timeout` owns that; the
  watchdog only ever observes, waits and relaunches.
- **Never spawns an LLM session itself** — only the runner CLI, as a plain OS process.
- **Never writes outside `<home>/watchdog/`** — never touches `campaign-state.json`,
  `answers.md`, or an escalation file.
- **Never sleeps past a wake instant without re-checking** — every wait, quota or overload, is
  a loop of `min(remaining, --poll-seconds)` slices (never one long `sleep`), so a `STOP` file or
  a manual relaunch is noticed within one slice.
- **Installs nothing and needs no prerequisite beyond the runner's own** (`bun`, already
  checked by `doctor.sh`; the watchdog shares the runner's `node_modules`) — which is exactly
  why `plugins/tribe/scripts/doctor.sh` is **unchanged** by this card.

### Which run a stall is about

The watchdog supervises exactly one run at a time, and a stall verdict only ever concerns *that*
run. This matters because a freshly-spawned runner needs real wall-clock time — tens to hundreds
of milliseconds — to create its own `runs/<run-id>/` directory, and during that gap the newest
directory on disk still belongs to the *previous* run. So the watchdog records every run id
present at the instant before it spawns a child, and while it owns that live child it treats only
a directory that is **not** one of those as its own run — a question of identity, not of ordering,
so a non-monotonic clock cannot mislead it. A run directory that already existed at the instant
the current runner was spawned is therefore never the supervised run: its log is not read and
never judged for staleness, and `status.json.runId` reports `null` rather than naming the previous
run, until the current run's own directory appears.

Nothing is suppressed by this. A runner that goes quiet still reports
`needs_human:stalled` after `--stall-minutes` — measured from its own last log line, or, when it
has never written one, from its own launch.

### Known limitations (watchdog)

- **A crash of the watchdog itself is not resumed automatically.** `status.json` is left with
  `terminal: null` and a dead `pid` — exactly the shape the watchdog uses to detect a dead
  runner. Relaunching the watchdog is safe and is the intended recovery: adopt-on-start (D74-7)
  attaches to a live runner instead of starting a second one.
- **A runner that dies with NO `answers.md` in the campaign home exits `4`, not `2`.** Measured
  2026-09-03: the runner throws `ENOENT … answers.md` before it can escalate. The watchdog maps
  that faithfully to `needs_human:error`; it does not paper over it. Follow-up FU-i74-1 (runner
  card) is to treat a missing `answers.md` as "no rulings".

## Supervisor (card `campaign-supervisor`)

A **layer above the watchdog**, at zero token cost for its own control loop: it launches or
adopts the watchdog (which launches or adopts the runner), and when the watchdog parks
`needs_human`, the supervisor spawns a small, judgment-only Claude Code session — never the
full executor — to rule on a card's escalation, ratify a harness-gap proposal, or run the
closing report, then resumes the watchdog. It is a **subcommand of this same runner CLI**, not a
separate installable, exactly like `watchdog` above:
[`docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md`](../../../../docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md)
is the design this section reproduces (§10 the CLI surface, §11 the on-disk layout) rather than
reinterprets.

```sh
bun plugins/tribe/scripts/runner/run.ts supervise \
  --repo <target-repo> --model <shaman-model> --campaign <campaign-slug> \
  [budget/session flags below] [--watchdog-model <tier>]
```

`--repo` and `--model` are required, no defaults, exactly like the runner and the watchdog.
Exactly one of `--campaign`/`--home` is required (mutually exclusive) — `--campaign <slug>`
derives the home by **executing** `tribe-home.sh` (`"$(tribe-home.sh <repo>)/campaigns/<slug>"`,
ratified decision 2, spec §10); `--home <path>` is the alternative for tests or a home that
doesn't follow that convention. Either way the resolved home is resolved against `cwd` when
relative, symlink-resolved, and refused (exit `1`) unless it sits inside
`realpath("$HOME/.tribe")` and already contains a `campaign-state.json` — the identical
containment gate `watchdog`'s own `--home` uses (`resolveWatchdogHome`, reused verbatim,
`cli/main.ts`'s `resolveSupervisorHome`). Any flag `parseSupervisorArgs` doesn't recognize is
rejected by name (`unknown flag: …`), never silently ignored (`core/supervisor/args.ts`).

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--repo` | none (required) | Target repo root, threaded to the watchdog it spawns. |
| `--model` | none (required) | The Shaman model for the supervisor's own one-shot ruling/ratify/closing sessions, and the fallback value for `--watchdog-model` below. |
| `--campaign` | none | Card id's slug, e.g. `--campaign widget-export`. Derives `--home` from it (see above). Mutually exclusive with `--home`; one of the two is required. |
| `--home` | none | An explicit campaign home path instead of `--campaign`. Mutually exclusive with `--campaign`. |
| `--watchdog-model` | the `--model` value | Executor tier passed to `run.ts watchdog --model` when the supervisor launches it. **Verified against `core/supervisor/loop.ts` (`config.watchdogModel ?? config.model`):** it always falls back to `--model` itself — never reads a campaign-configured value, despite `args.ts`'s own doc comment describing that as the intent; no code path enforces `--watchdog-model` as required. |
| `--max-ruling-rounds` | `2` | Per-card cap on ruling-session rounds (W7). Bounded `0`-`10`. |
| `--max-ratify-rounds` | `2` | Cap on ratify-session rounds. Bounded `0`-`10`. |
| `--max-spawns` | `8` | Total one-shot session budget for this invocation. Bounded `0`-`100`. |
| `--max-watchdog-runs` | `20` | Cap on how many times this invocation may (re)launch the watchdog. Bounded `1`-`500`. |
| `--session-timeout-seconds` | `1800` | Wall-clock abort for one one-shot session. Bounded `60`-`21600`. |
| `--session-max-turns` | `60` | Turn cap for one one-shot session. Bounded `1`-`500`. |
| `--session-retries` | `1` | Bounded retries for a `failed`/`timeout` one-shot session before it parks. Bounded `0`-`3`. |
| `--poll-seconds` | `30` | Wake-up slice while awaiting a live watchdog. Bounded `1`-`60`. |

Every bounded numeric flag rejects a non-plain-decimal-integer value (no sign, no whitespace, no
`0x`/scientific notation) as well as a value outside its bound, with a typed message naming the
range (`core/supervisor/args.ts`'s `parseBoundedInt`). `--dry-run` is not a recognized flag here
(unlike the runner) — a supervisor pass has no side-effect-free mode to run.

### Exit codes

Read from `SUPERVISOR_EXIT_*` in `core/supervisor/model.ts`:

| Code | Constant | Meaning |
| --- | --- | --- |
| `0` | `SUPERVISOR_EXIT_DONE` | The campaign closed (the closing session ran and its postcondition verified), or the `STOP` file was honoured. |
| `1` | `SUPERVISOR_EXIT_USAGE` | A CLI argument error (bad/missing/unknown flag), or `--home`/`--campaign` failed containment or has no `campaign-state.json`. |
| `20` | `SUPERVISOR_EXIT_NEEDS_OWNER` | A human must act — `NEEDS_OWNER.md` was written; the reason is in it and in `supervisor/status.json`'s `terminal.reason`. Also the fallback for an unexpected internal I/O failure caught at the CLI edge (`cli/main.ts`'s `supervise` block), mirroring the watchdog's own B2 fix. |
| `21` | `SUPERVISOR_EXIT_RUNNING` | A live supervisor already holds this campaign's `.supervisor.lock`; this process refused and wrote nothing. |

`0` and `1` deliberately keep the meanings they already have in both the runner and the watchdog
CLIs; `20`/`21` are chosen to sit clear of the runner's `0/1/2/3/5` and the watchdog's
`0/1/10/11` (spec §10). Stdout carries one human line per action, plus a final `status: <path>`
line — the watchdog's own contract, unchanged, so the same `until` wake-up loop works on both.

### Files (all under `<home>/supervisor/` unless noted)

The supervisor's complete write surface is `<home>/supervisor/**`, `<home>/NEEDS_OWNER.md`, and
an escalation-file *rename* — nothing else (spec §11; a unit test, `loop.test.ts`'s
`assertWriteSurface`, asserts exactly this set, and a second test asserts `answers.md` and
`campaign-state.json`, and anything under `<home>/watchdog/` or `<home>/runs/`, are never
written by the supervisor):

- **`.supervisor.lock`** — `{pid, startedAt}` JSON, the single-instance lock (P1: a live foreign
  holder refuses a second supervisor rather than starting one).
- **`status.json`** — rewritten atomically on every state transition; `terminal === null` while
  running — the doorbell's own wake-up signal (§12), shaped like the watchdog's `status.json` so
  one reader serves both.
- **`events.jsonl`** — append-only, one JSON line per intended action, each carrying its own ISO
  `at`.
- **`ledger.jsonl`** — append-only, one JSON line per one-shot session spawn (G5): kind, cardId,
  sessionId, model, usage, costUsd, permissionDenials, and the disk-verified `verdict` (never the
  session's own words).
- **`state.json`** — the supervisor's own persisted counters: per-card ruling rounds, ratify
  rounds, total spawns, watchdog runs, seen-escalation content hashes (the repeat-escalation
  breaker), `closingVerified`, and per-reason retrigger counts.
- **`park/<cardId>.json`** — a typed park marker (`kind: "owner_only" | "too_hard"`) a one-shot
  *session* wrote for that card (§6.1); an unrecognised `kind` or unparseable JSON is read as
  `too_hard` rather than crashing (`core/supervisor/verify.ts`'s `parseParkMarker`).
- **`sessions/<sessionId>.log`** — the streamed SDK messages for one one-shot session
  (`core/supervisor/session.ts`).
- **`final-report.md`** — written by the closing session itself, per its own brief
  (`core/supervisor/brief-closing.md`'s `{{FINAL_REPORT_PATH}}`), never by the loop.

### The one-shot session envelope (card `supervisor-session-settings`, `buildOneShotOptions`)

All three one-shot kinds — `ruling`, `ratify`, `closing` — load
`settingSources: ['user', 'project', 'local']`, the same three-tier list the executor path loads
(`core/session.ts`): the `user` tier is what registers `~/.claude/settings.json`'s
`enabledPlugins` (the C3 plugin), so `Skill c3` resolves in every kind rather than returning
`Unknown skill: c3`. Each kind's `PreToolUse` hooks:

- **`ruling`/`ratify`** carry the containment hook (`decideContainmentHook` — the ONLY write
  enforcement layer; `additionalDirectories` is a read convenience, never a write boundary) AND
  the scan-wall hook (`decideScanGuardHook`, imported from the executor path, never copied or
  forked — card D3), wired alongside it as defence in depth. Their `allowedTools` is
  `[Read, Grep, Glob, Write, Edit, Skill]` — `Skill` by owner ruling R2, verbatim "Allow the Skill
  tool" — so the C3 skill's content loads, though its CLI still cannot run there (no `Bash`, a
  known, accepted limit); the containment hook allows the `Skill` load at any location alongside
  `Read`/`Grep`/`Glob`.
- **`closing`** carries NO containment hook (it legitimately writes the repo to land the
  governance PR, R11), but carries the scan-wall hook (same predicate, defence in depth) AND the
  closing-grant hook (`decideClosingGrantHook`, ruling R1): a pure allowlist predicate that
  enforces the unchanged `CLOSING_ALLOWED_TOOLS` itself, so a `permissions.allow` rule loaded from
  any of the three settings tiers can never widen the grant beyond it — MEASURED: with the tiers
  loaded and no grant hook, an un-granted tool (`Workflow`) ran. Accepted consequence: `closing`
  stops running `TaskCreate`/`CronList`/`ListAgents`, which ran un-granted before and which the
  closing stage does not use.
- **`verify-shipped`'s hand-load is kept.** `closing`'s `options.plugins` hand-load (pointing at
  the repo's own `verify-shipped` plugin directory) predates the tier fix and stays, on purpose:
  MEASURED, the `user` tier resolves `verify-shipped` only where `install.sh` symlinked it into
  `~/.claude/skills/` — a host fact — while the hand-load resolves it from the repo on every host;
  where both are present the session registers it once.
- **`<home>/NEEDS_OWNER.md`** (home root, **not** under `supervisor/`, for discoverability —
  spec §11) — the owner-facing park artifact: park reason, what happened, the escalated card's
  question (verbatim), what was already tried, what unblocks it, and the run's ledger lines.
  **Deleting it is the owner's explicit "I have handled it" signal** — row P2 refuses to resume
  while it exists *and the park it records still holds*. A runner-liveness park the disk has
  since falsified is superseded by the supervisor itself rather than obeyed, leaving
  `NEEDS_OWNER.md.superseded-<ts>` behind as the trail (see the decision table below).
- **an escalation file renamed** `<home>/escalations/<card>.md` → `.resolved-R<n>` — performed
  by the supervisor only after a ruling is verified against `answers.md` (§5.5), never by a
  session.

### The decision table (spec §3.4, `core/supervisor/decide.ts` — row numbers are that file's own
comments; first match wins)

| Observation | Action |
| --- | --- |
| A live foreign supervisor holds `.supervisor.lock` (P1) | `park(resume_blocked)` — never a second supervisor. |
| `NEEDS_OWNER.md` is present (P2) | The supervisor re-observes before it refuses: a park whose stated condition the disk has already falsified yields `supersede_park` (`park_superseded` in `events.jsonl`, the file renamed to `NEEDS_OWNER.md.superseded-<ts>`, `counters.staleTerminals` incremented, the campaign continuing); a park that still holds yields `park(resume_blocked)` — resume stays blocked until the owner deletes it. A refusal is a refusal to resume the *existing* park, not a new park about a new condition, so it leaves `status.json`'s `terminal.reason` naming the condition the park was originally recorded with (the refusal itself is `lastAction: park:resume_blocked` and a `park` line in `events.jsonl`). That recorded condition is exactly what the NEXT restart re-checks against `runs/`, so a contradiction that only appears after several refused restarts is still detected. |
| `STOP` file present (P3) | `exit(done:stop_requested)`. |
| A watchdog is already live (P4) | `await_watchdog` — adopted, never relaunched. |
| No watchdog has run yet this invocation (row 27) | `run_watchdog` over the whole campaign. |
| Watchdog terminal `runner_done` (rows 1-3) | `spawn_session(ratify)` if `answers.md` carries unratified rulings, else `spawn_session(closing)` (failing closed to `park(closing_failed)` if the `verify-shipped` plugin dir is missing), else `exit(done:campaign_closed)` once `state.json.closingVerified` is true. |
| Watchdog terminal `stop_requested` (row 4) | `exit(done:stop_requested)`. |
| Watchdog terminal `escalations_pending` (rows 5-12) | For the next unanswered card: archive a ruling already landed in `answers.md` but not yet archived; else honour that card's own park marker; else `park(owner_only)` if its trigger is on `ownerOnlyEscalations`; else `park(repeat_escalation)` if this exact body was already ruled; else `park(w7_cap)`/`park(spawn_cap)` if a budget is spent; else `spawn_session(ruling)`. Once every escalated card is answered, `run_watchdog` scoped to just the answered + not-reached cards. |
| Watchdog terminal `rulings_unratified` (rows 13-15) | `spawn_session(ratify)`, gated by `park(ratify_cap)`/`park(spawn_cap)`. |
| Watchdog terminal `session_incomplete` (rows 16-17) | One bounded watchdog re-trigger, then `park(session_incomplete)`. |
| Watchdog terminal `quota_cap` / `overloaded` / `stalled` / `lock_conflict` / `error` (rows 18-22) | `park` with the matching reason — never retried automatically. |
| A one-shot session just returned `failed`/`timeout` (V5/V6) | One bounded retry (`--session-retries`), then `park(<kind>_failed)`. |
| A one-shot session just returned `history_rewritten`/`ratify_out_of_scope` (V1/V2) | `park` immediately — an integrity violation, never retried. |
| The watchdog-run cap is spent (row 28), or an unrecognised terminal reason | `park(watchdog_run_cap)` / `park(error)` — fail closed, never guess. |

### What it never does

- **Never decides from an LLM's own words.** `decide()` is a pure function of typed disk facts
  only — a ruling, a ratify, or a closing verdict is a **postcondition check on disk**
  (`core/supervisor/verify.ts`), never the session's own claim (guardrail 2, "Trust disk, not
  the session's word").
- **Never writes `answers.md` or `campaign-state.json`.** A one-shot session may append to
  `answers.md`; the supervisor loop itself never does (spec §11, `loop.test.ts`).
- **Never writes under `<home>/watchdog/` or `<home>/runs/`** — those stay the watchdog's and
  the runner's own.
- **Never spawns a second live process for the same job.** A live foreign supervisor refuses
  (exit `21`); a live watchdog is only ever `await_watchdog`ed, never relaunched a second time
  (P1/P4 above).
- **Never rules on an owner-only trigger itself.** A card whose escalation reason is on
  `ownerOnlyEscalations` parks with `owner_only` rather than spawning a ruling session.
- **Never retries an integrity violation.** A `history_rewritten` or `ratify_out_of_scope`
  verdict parks immediately, with no retry budget consulted at all.

### Known limitations (supervisor)

- **`autoAnswerRounds` (the state-file field, `campaign-state.json`) is never incremented by the
  runner.** Verified by grep across the runner source: the field the skill once told a session
  to read is permanently `0` (spec §21 D1). The supervisor keeps its **own** counter instead —
  `state.json`'s `rulingRounds`, keyed per card — and W7's cap is enforced against that, not
  against `autoAnswerRounds`. Follow-up **FU-CS-1** is to either wire the runner to increment the
  field or delete it from the schema.
- **A supervisor session gets no viewer badge chip** — the [live viewer](#live-viewer) reads
  `campaign-state.json` and a run's `run.json` for its campaign badge, and the supervisor writes
  neither. A one-shot ruling/ratify/closing session is visible only as its own entry under that
  session's project directory in `~/.claude/projects/`, with no campaign association. Follow-up
  **FU-CS-2**.
- **A crash of the supervisor itself is not resumed automatically** — exactly the watchdog's own
  limitation above. `status.json` is left with `terminal: null` and a dead `pid`. Relaunching the
  supervisor is safe and is the intended recovery: P1's live-lock check only fires against a
  genuinely alive pid, and P4 adopts a still-live watchdog rather than starting a second one.
- **Spec §11 describes a `briefs/<kind>-<n>.md` artifact — the rendered brief saved verbatim as
  evidence — that this implementation does not write.** Verified by grep: no `briefs` path
  exists anywhere in `core/supervisor/` or `adapters/supervisor-io.adapter.ts` outside a test's
  own comment. The rendered brief (`core/supervisor/brief.ts#renderBrief`) is used only as the
  one-shot session's initial prompt; the only durable record of a session's content is its own
  `sessions/<sessionId>.log` above.

## Structure

The directory is a visible hierarchy — `ls runner/` answers "where is the CLI entrypoint,
where are the IO seams, where are the types, where are the adapters" directly from folder
names, no filename convention required — enforced executably by `structure.test.ts`:

- **`cli/main.ts`** — the composition root: the only file allowed to VALUE-import an adapter
  or the orchestrator (`core/loop.ts`). It wires `buildRealIo()` (from
  `adapters/run-io.adapter.ts`) into `runLoop()` and nothing else does that wiring. `main()`
  is exported (unit-tested indirectly through `parseArgs`, its one pure piece) and also run
  directly via `if (import.meta.main)`.
- **`run.ts`** (repo root, one level above `cli/`) — a thin shim, not the entrypoint itself:
  `import { main } from './cli/main.ts'; if (import.meta.main) main();`. It exists only
  because two external contracts prove the runner by this exact path —
  `orchestrate-campaign`'s `resolve-runner.sh` and `test-fresh-machine.sh` both assert
  `scripts/runner/run.ts` exists — so it has to keep resolving even though the real logic
  lives in `cli/main.ts`.
- **`ports/ports.ts`** — the single home of every injected IO seam (`VerifyIO`, `ReportIO`,
  `StateIO`, `SessionIO`, `DerivePhaseIO`, `LockIO`, `LoopIO`, ...) plus the unified
  `ExecResult` (previously defined twice, identically, in two core modules, one of them
  `core/github.ts` — deleted with the state auto-commit path). The bigger seams (`LoopIO`,
  `LockIO`) are composed from small capability ports (`ExecPort`, `TimerPort`, `ClockPort`,
  `FsPort`, `LogPort`, `ProcessPort`, `LockStorePort`, `SessionSpawnPort`, `RunHomePort`) —
  structural typing means every existing mock still satisfies the composed interface.
  `ports/` contains type declarations only: no runtime values, and its only import is a
  type-only one from `core/types.ts`.
- **`core/types.ts`** — the shared kernel: imports nothing local, and is home to ALL shared
  vocabulary, including the `EXIT_*` constants and `RunLoopConfig`/`ResolvedConfig`. Every
  other file may import from it.
- **`core/loop.ts` + `core/loop/`** — the orchestrator. `core/loop.ts` is a pure re-export
  barrel (every symbol it ever exported is still available from that same path); the actual
  logic is split into `core/loop/phase.ts` (the §D4 resume matrix), `core/loop/lock.ts` (the
  §D2 single-instance lock + STOP file), `core/loop/commit-guard.ts` (now holds only
  `persistLocalState` — the runner's own state auto-commit path was deleted entirely, see
  "Known limitations" below), `core/loop/card-actions.ts` (per-card escalate/ship/session
  work), and `core/loop/run-loop.ts` (the pass + `runLoop` entry point).
- **everything else in `core/`** — pure logic: `state.ts`, `verify.ts`, `report.ts`,
  `brief.ts`, `session.ts`, `paths.ts` (pure campaign-home path helpers, spec §4),
  `run-record.ts` (the `run.json` schema), `env-guard.ts` (`scrubEnvContent` — the
  `ANTHROPIC_API_KEY` line-removal logic, fix-list P10; see "ANTHROPIC_API_KEY guard" above),
  and `rulings.ts` (`answers.md` ruling parsing/classification, harness-gap-wiring PR C; see
  "Rulings gate" above).
  Every world-touching effect is reached through a
  `ports/ports.ts` seam, never a direct import; each of these modules re-exports the seam
  type(s) its own tests/importers pull from it (e.g. `verify.ts` re-exports `VerifyIO`).
- **`adapters/*.adapter.ts`** — the only files allowed to import a world-touching module
  (`fs`, `child_process`, `http`/`https`, the Agent SDK). `session.adapter.ts` is the sole
  importer of `@anthropic-ai/claude-agent-sdk`; `run-io.adapter.ts` owns every
  `fs`/`child_process` primitive and assembles the production `LoopIO`.

Import direction is one-way, wired only by `cli/main.ts`:

| Layer | May import |
| --- | --- |
| kernel (`core/types.ts`) | nothing local |
| ports (`ports/ports.ts`) | `core/types.ts` only, and only as types |
| core (everything under `core/` except `types.ts`) | kernel, ports |
| adapters (`adapters/*.adapter.ts`) | kernel, ports, core, and other adapters |
| cli (`cli/main.ts`) / root `run.ts` shim | kernel, ports, core, adapters |

Enforcement is `structure.test.ts` (walks `core/`, `ports/`, `adapters/`, `cli/`, and the
root `run.ts` shim recursively), run via `bun run check` (`tsc --noEmit` + `bun test`) — not
ESLint, which is deferred until typescript-eslint supports TS >= 7.1 (plan Amendment A3,
[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).

## Known limitations

- **Run-record (`run.json`) write/finalize failures are silent by design.** Both the initial
  write (right after the lock is acquired) and the end-of-run finalize are wrapped in a
  best-effort `try`/`catch` that swallows any error (`core/loop/run-loop.ts`,
  `cli/main.ts`'s `tryFinalizeRunRecord`) — same rationale as the report contract: observability
  exhaust must never fail a campaign run (spec §9). A caller relying on `run.json` for liveness
  should treat its absence, or a permanently-unfinalized record with a dead pid, as informative
  rather than assume every invocation always produces one.
- **The verify retry (`verifyThenHealIfNeeded`/`healSafeResidue`, `core/loop/card-actions.ts`)
  has zero delay.** The D3 verify-shipped check is attempted twice back-to-back with no sleep
  between attempts (the second attempt heals whatever residue P4's `decideResidueHeal` proves
  safe first, per spec `docs/tribe/fixlists/2026-08-08-outstanding-17/P4-self-heal-safe-residue.md`).
  This catches a transient `gh`/network blip on the *second* call, but it will **not** catch a
  check that is still settling (e.g. CI still running) — the two attempts happen too close
  together for that.
- **`baseBranch` derivation has a silent fallback.** `resolveBaseBranch` runs
  `git symbolic-ref --short refs/remotes/<remote>/HEAD` (`<remote>` is `--remote`, default
  `origin`) and falls back to the literal string `"master"` if that command fails for any
  reason (not just "unset"). A target repo whose default branch is `main`, hit by a transient
  `git` failure on this one call, would silently target `master` instead and fail loudly later
  at `git fetch`/push — there is no distinguishing "`<remote>`/HEAD really is unset" from "the
  query itself broke".
- **Mocked tests validate logic, not invocations.** All 172 tests (baseline 116 before this
  effort, +56 across `dependsOn`/`blocked`, D5′, and the report contract) mock every seam
  (`exec`, `spawnSession`, the filesystem, the clock, the lock). They prove the loop's *logic*
  against those mocks — not that a real `gh`/`git`/SDK call behaves as assumed. This gap is not
  theoretical: `gh api pulls/<pr>` 404'd against a real PR while the 25 tests covering that
  exact path passed unchanged, and a live `--dry-run` later caught an open-PR resume that
  would have opened a duplicate PR. **Any changed `gh`/`git` command must be executed against
  a real repo before it is trusted.**
- **Session options — the settings tier list and the fourth `PreToolUse` hook** (card
  `runner-session-user-settings`, 2026-09-20). The pinned §D1 options load
  `settingSources: ['user', 'project', 'local']` — the CLI's own default tier list, not
  `['project']` alone — so a spawned session picks up the owner's own `~/.claude/settings.json`
  (its `enabledPlugins`, `permissions.deny`, `disableClaudeAiConnectors`, MCP servers) the same
  way a person's own session does, while `project`/`local` still supply the target repo's
  CLAUDE.md and any repo-local settings. `buildSessionOptions` also wires a **fourth**
  `PreToolUse` hook, `decideScanGuardHook` (owner ruling R-a), after the anti-livelock, wait-tool,
  and merge-gate hooks: it denies any `find` rooted at `/`, `~`, `~/`, `$HOME`, `"$HOME"`, or
  `$HOME/` and redirects the session to the `c3` skill or a scoped directory instead
  (`SCAN_DENIED_REASON`), sharing its predicate (`isFilesystemWideScan`,
  `core/metrics/session-hygiene.ts`) with the `session-hygiene.ts` ratchet counter below so the
  guard and the measurement can never disagree about what a scan is.
- **What HAS been verified live** (smoke run, 2026-07-16, campaign-runner effort): `--dry-run`
  phase derivation against real merged/open PRs; the D3 five-point replay against a real merged PR
  (all five pass) and its correct rejection of an open PR;
  a real Agent-SDK session spawn under the pinned §D1 options, with the SDK-assigned `session_id`
  captured from the `system/init` message; `settingSources: ['user', 'project', 'local']`
  genuinely loading the target repo's CLAUDE.md; a real `resume` recalling prior session context;
  a bogus resume id surfacing as a typed `error` (so the fresh-fallback path is reachable); and
  per-session log files.
- **What HAS been verified live for the user-settings-tier change** (card
  `runner-session-user-settings`, 2026-09-20, real spawned Agent-SDK sessions, `haiku`, through
  `runSession` + the real `sdkSpawnSession`, not a stub — `core/session.e2e.test.ts`, opt-in
  `RUN_SESSION_E2E=1`; see `docs/superpowers/evidence/2026-09-20-runner-session-hygiene.md` for
  full transcripts):
  - `Skill c3` resolves under `settingSources: ['user', 'project', 'local']` — the transcript
    carries a `tool_use` naming skill `c3` and its resolved content (`skills/c3`, a `C3` title) —
    and, with the tier temporarily reverted to `['project']` alone, the same brief instead
    produces `<tool_use_error>Unknown skill: c3. Did you mean cd?</tool_use_error>` and a final
    result of `SKILL_RESULT=unknown Unknown skill: c3. Did you mean cd?`; both transcripts were
    captured from real runs.
  - The supervisor's own one-shot session envelope (card `supervisor-session-settings`,
    `core/supervisor/session.e2e.test.ts`, opt-in `RUN_SESSION_E2E=1`) carries the same fix: real
    `claude-haiku-4-5-20251001` sessions through `runOneShotSession` + the real SDK adapter, never
    a stub, prove `Skill c3` returns C3 content in all three kinds (`ruling`, `ratify`, `closing`),
    a real `find /` is refused by the scan wall in `closing`, the `verify-shipped` hand-load is
    measured with and without `options.plugins`, and a host `permissions.allow` rule for
    `Workflow` still cannot run it in `closing` (ruling R1) — all failing for the stated reason
    with the envelope reverted to base, and all `7 pass, 0 fail` as built.
  - The SDK's own `model` and `permissionMode` options **win** over the user tier's
    `model: "opus[1m]"` and `permissions.defaultMode: "auto"` (`~/.claude/settings.json`): every
    `system/init` message observed reports `model: "claude-haiku-4-5-20251001"` and
    `permissionMode: "bypassPermissions"` — the pinned options, not the user's own tier, decide.
  - A failing user-tier hook (a nonexistent command wired on `PreToolUse` and `SessionStart`)
    does **not** break a session: the session still starts, still runs, and still completes.
  - The newly-connected `plugin:playwright:playwright` MCP server (present only because the
    `user` tier is now loaded) **fails open** when it cannot start: with `npx` unresolvable
    (`PATH` restricted to `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`), `system/init`'s
    `mcp_servers` reports `[{"name":"plugin:playwright:playwright","status":"failed","source":"plugin"}]`,
    no playwright tool appears in `init.tools`, and the session still completes normally
    (`subtype: "success"`, `is_error: false`) in a few seconds — never a hang, never a startup
    abort.
- **What HAS additionally been verified live for this effort's D5′/report-contract changes**
  (campaign-orchestration effort, 2026-07-16, same real-CLI discipline as above, scoped to what
  changed here — not a re-verification of the base runner's surface listed above): `--dry-run`
  writes neither the state file nor a report (byte-identical state on disk, no
  `campaign-report.*` written); the report contract end-to-end on real exit paths (a `STOP`-file
  run, and a real escalation run); and a real 2-card blocked cascade (`A` escalates, `B`
  declares `dependsOn: ["A"]`) producing `### B — blocked` / `- Blocked on: A` in
  `campaign-report.md`, with `pending: ["A"]` and `Stats: 0 shipped, 1 escalated, 1 blocked, 0
  not reached`, exit code `2`.
- **What is still UNVERIFIED against reality:** this runner's own mutating git calls —
  `revert_and_redo`'s worktree/branch deletion and `git push --delete` (`card-actions.ts`) —
  and therefore a full end-to-end card ship (session → verify → next card). `gh pr create`/
  `gh pr merge` for a card's own PR are the executor session's responsibility, not this
  runner's own code (Global Constraints wall — card-PR handling is out of this capability's
  scope), so verifying them is that session's concern, not this runner's. Also unverified:
  `.runner.lock` contention and the STOP file **under a real, in-flight session** (the STOP
  verification above proves the startup-check exit path and its report write; it does not
  exercise a live executor session running when `STOP` appears). Exercising these needs a
  disposable GitHub repo. **Do a scoped `--cards <id> --max-cards 1` run under supervision
  before trusting this against a live campaign.**
