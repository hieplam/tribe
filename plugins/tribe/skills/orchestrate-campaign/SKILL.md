---
name: orchestrate-campaign
description: >-
  Turns one owner directive into ONE final consolidated report, with zero owner intervention
  in between except the irreversible few. Trigger on "orchestration", "orchestrate these ideas",
  "run these N cards", "do these tasks in orchestration", or any request to run a batch of
  roadmap cards unattended end-to-end from any session — the main chat, a Shaman, or a
  Warchief. Use this whenever the ask is "kick off N cards and tell me when they're all
  shipped or blocked", not "build this one card" (that stays the Warchief/Hunter path) and not
  "what should we build" (that's roadmap authorship, What/Why — a different job). This skill
  assumes Shaman authority for the campaign, authors the campaign state file the campaign
  runner requires as input, triggers the runner's CLI in the background, answers its
  escalations into answers.md within Shaman authority (never touching what only the owner may
  decide), re-triggers up to a bounded auto-answer cap, and composes the one owner-facing
  report — independently re-verifying every card the runner claims shipped before repeating
  that claim.
---

# Orchestrate Campaign

This skill is **instructions, not code** — it directs *you*, the invoking session, through the
loop the owner wants: say "orchestration: do these N ideas" once, and get back one report that
accounts for every card as shipped or blocked. You do the judgment (planning, answering,
reporting); the campaign runner (a separate CLI, invoked only through its documented flags and
exit codes below — never by reading its source) does the deterministic, zero-token looping.

## Assume Shaman authority

For the duration of this campaign you act with the authority `agents/shaman.md` describes as
"Mode 2 — run the campaign": you make the ordinary calls yourself and escalate to the owner only
the register (irreversible data shapes, product-promise changes, new permissions/trust surface,
privacy-surface changes). You never write source code and never design How yourself — cards still
go through the Warchief/Hunter chain; your job is running the campaign's outer loop around that.

## Inputs — nothing here is ever hardcoded (wall W1)

Every value below is environment-specific and MUST come from the owner's directive or the
campaign's own docs — never invent or reuse a value from a previous campaign:

| Placeholder | What it is |
| --- | --- |
| `<target-repo>` | The repo root the campaign runs against. |
| `<model>` | The executor model tier passed to each card's session. |
| `<campaign-slug>` | The campaign's own identifier, used inside the state file. |

`--home` (below) is **computed**, never one of the placeholders above: it is always
`"$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<campaign-slug>"` — `tribe-home.sh`
is the only place that knows the `~/.tribe` key derivation (wall W1: this skill never re-derives
it, and never types a literal `~/.tribe/...` path).

If you catch yourself writing a real repo name, a real path, or a real model name into this
skill's own instructions (as opposed to a value you filled into a live invocation), stop — that
value belongs in the campaign's own docs, not here.

## The loop, stage by stage

### Stage A — Planning (you author the handoff)

1. **Confirm/ideate the cards** (What/Why) with the owner if anything is unclear — this is the
   one part of the loop where the owner may still be present; the zero-intervention objective
   starts at the trigger below, not before.
2. **Choose the authorship mode** for the How docs (specs/plans), per the owner-ruled policy:
   - **Few cards (≲3) or genuinely complex work** → you author the specs+plans yourself. Dispatch
     overhead isn't worth it when the thinking itself is the value.
   - **Many trivial cards (~10–20)** → dispatch one **planning-Warchief** per card (a `warchief`
     dispatch whose job is "author this one card's spec+plan and return them — no
     implementation"), then review and stage what comes back.
   - Record which mode you used as `planning.mode: "shaman"` or `planning.mode: "warchief-fanout"`
     inside the state file (see schema below) — a resuming session needs to know how the docs
     were produced without re-deriving it.
3. **Author `campaign-state.json` yourself, under the campaign home** (`--home`, computed above —
   never inside `<target-repo>`). Nothing else in the system creates this file — the runner
   requires it as an input but never authors it, and Stage A owns planning artifacts. See "The
   campaign state file" below for the exact schema to write.
4. **Author the `answers.md` scaffold, also under the campaign home** — an empty (or header-only)
   markdown file. Only you (or the owner) ever append rulings to this file, in every stage below —
   the runner never writes to it (wall W3: judgment stays in sessions, never migrates into the
   runner).
5. **Cross-check inherited obligations before landing.** Batch-authored specs are written blind
   to each other — a spec finished today can hand an obligation to a card whose own spec is
   authored the same day, and the receiving spec never sees it. Run
   `plugins/tribe/scripts/check-spec-handoffs.sh <wave's spec dir> <dir of already-shipped
   specs>` over the wave's own spec dir and the repo's existing (already-shipped) specs dir; for
   every candidate hit, confirm the receiving spec acknowledges it and produce/refresh a
   `handoffs.md` ledger (one row per hit, or a listed non-obligation with a reason) committed
   next to the wave's specs — see
   `docs/tribe/fixlists/2026-08-08-outstanding-17/P8-inherited-obligations-check.md` for the
   ledger format. A wave with unacknowledged handoffs does not launch.
6. **Land specs/plans ONLY** — into the host repo's **existing, discovered** convention (e.g.
   `docs/specs/` + `docs/plans/` where present, or `.c3/adr/`) — as a normal PR to
   `<target-repo>`'s master via `gh pr merge --merge`. Cards are now `staged`. Never invent a
   `docs/tribe/planning/`-style namespace of your own: look for what this repo already uses for
   specs/plans and use that. Campaign state and `answers.md` are never committed — they live only
   under `--home`, per step 3/4 above. `handoffs.md` DOES land in the repo, alongside the specs
   it covers.

#### The campaign state file (`campaign-state.json`, under `--home`)

The runner README's own `## State file schema` section is the **authoritative** contract for
this schema (field-by-field types, required/optional, and the load-time validation errors) —
this skill depends on that documentation, never on the runner's source, per the owner's rule to
depend on a capability's contract rather than keep a private copy of it. The shape looks like
this — a short worked example for this skill's own convenience, not a competing specification;
every optional field may simply be omitted rather than written as `null`/`[]` when unused:

```json
{
  "v": 1,
  "campaign": "<campaign-slug>",
  "planning": { "mode": "shaman" },
  "mergePolicy": "<e.g. \"regular\" — the merge strategy card PRs must use>",
  "sequence": ["<card-id>", "<card-id>", "..."],
  "schemaLockPaths": ["<path whose diff must stay empty unless a card's plan opts out>"],
  "docsOnlyPaths": ["<path prefix treated as docs-only for the runner's flake waiver>"],
  "ownerOnlyEscalations": ["<trigger name that must always escalate to the owner>"],
  "cards": {
    "<card-id>": {
      "status": "staged",
      "spec": "<path to the card's spec.md, or null>",
      "plan": "<path to the card's plan.md, or null>",
      "branch": null,
      "baseSha": null,
      "pr": null,
      "mergeSha": null,
      "sessionId": null,
      "updatedAt": null,
      "dependsOn": ["<other-card-id-this-one-must-not-start-before>"],
      "autoAnswerRounds": 0
    }
  }
}
```

- `sequence` is the dependency-ordered card order; every id in it (and every id named in a
  `dependsOn`) must have a matching entry under `cards`.
- Every card you write starts `"status": "staged"`, `"autoAnswerRounds": 0`, and no `dependsOn`
  unless that card genuinely must not start before another one ships.

#### The runner's concurrency model (P12 / P12 follow-up)

**By default (`--max-concurrent` never passed, or passed as `1`) the runner never spawns two
sessions concurrently — it runs exactly one card's session at a time, awaiting it to full
completion before selecting the next**
(`docs/superpowers/specs/2026-07-16-campaign-runner-design.md`'s non-goals;
`docs/superpowers/specs/2026-07-16-campaign-orchestration-design.md` §O7: "never runs two cards
concurrently" — both describe the DEFAULT, not an absolute ceiling; see below). What an undeclared
dependency risks under the default is ORDER, not concurrency: absent parking, the runner walks
`sequence` top to bottom and ships cards in exactly that order — but park-and-continue means a
card ahead in `sequence` that escalates or gets blocked is skipped rather than halting the run, so
a later card with no `dependsOn` on it can ship before that earlier, now-parked card does.
`sequence` position alone does not guarantee card A completes before card B; only `dependsOn`
does. So only declare one you mean.

**`--max-concurrent N` (N > 1)** is an explicit opt-in that bounds how many cards' sessions may
run at once — WIDTH only, never ORDER. `dependsOn` is still the only thing that orders cards at
any `N`: a dependent card is never selected while its dependency is mid-flight, exactly like it's
never selected while merely `staged` today. Passing this flag does not change how you author
`dependsOn` — it changes how many *independent*, undeclared-dependency cards the runner is allowed
to work on at once.

- **Serial campaigns:** when the owner's directive is one-card-at-a-time (or cards merge to the
  same branch and each should build on the previous card's merged master), author the full
  sequential chain — every card `dependsOn` its sequence predecessor — REGARDLESS of whether
  `--max-concurrent` is passed. Default to the chain when in doubt: relying on `sequence` position
  alone to guarantee ordering is the trap this note exists to close, not a safe shortcut, and
  `--max-concurrent` does not close it either — it bounds width, it does not order. Only reach for
  `--max-concurrent N` (N > 1) when the owner's directive genuinely wants bounded parallelism over
  cards that are actually independent and don't share a base branch (the runner does not add any
  merge-queue serialization beyond what git/GitHub already do — see the runner README's
  "Concurrency" section for the full contract and its documented limitations).
- `ownerOnlyEscalations` is *your* Stage-A authored list — carry over the roadmap's own
  Escalation register verbatim (irreversible data shapes, product-promise changes, new
  permissions, privacy). A trigger name on this list escalates to the owner unconditionally in
  Stage C, no matter how confident you are that you could rule on it yourself.
- `planning.mode` and any other field beyond the ones shown above are preserved by the runner
  across every read/write, so it is safe to carry extra campaign bookkeeping in the state file if
  you need it.

### Stage B — Trigger the runner (background)

The runner is a CLI in the same plugin; you compose with it **only through its documented flags
and exit codes** — never by reading or naming its source files.

**First, resolve the runner's own location — never assume a bare relative path resolves.** This
skill can be triggered from ANY session (§O1), whose working directory is normally
`<target-repo>` — the campaign you're running, not wherever this skill's own plugin happens to
live. A bare relative script path only works by accident, when your shell's cwd happens to be
this plugin's own repo; it fails everywhere else.

**Do not hand-write the resolution — run the bundled resolver.** It ships beside this file, so
`<skill-dir>` is the base directory announced when this skill loaded:

```sh
runner_dir="$(bash "<skill-dir>/resolve-runner.sh")" || exit 1
```

- On success it prints the runner directory's **absolute** path and exits 0, having already proven
  `run.ts` exists there. It checks `$CLAUDE_PLUGIN_ROOT` first (a native/marketplace-cached
  install, where `scripts/` is a sibling of `skills/`), then locates itself through the symlink a
  local install creates — covering both install shapes.
- On failure it prints **nothing** to stdout and exits 3 with a named diagnostic on stderr. Take
  that exit at face value: surface the diagnostic to the owner and stop. **Never substitute a
  guess or a bare relative path** — that is the one failure this resolver exists to make
  impossible, so re-introducing it by hand defeats the purpose.

Why a script rather than a line of shell here: the expression this replaced failed *open*. On a
machine where the skill was not installed under `~/.claude/skills`, `readlink -f` printed nothing
and exited 1; `$(…)` swallowed the exit code, `dirname ""` returned `.`, and the whole thing
collapsed to `./scripts/runner` — resolved against the target repo. `scripts/tests/test-fresh-machine.sh`
holds that wall.

This never touches your own working directory and never requires a `cd` — `--repo <target-repo>`
(unchanged, below) is what points every run at its actual target; the runner sets its own `cwd`
for every `git`/`gh` call from that flag, never from your shell's cwd. Use `$runner_dir/run.ts` as
the script path in every invocation that follows.

**Then preflight the machine — once per campaign, before the first real run.** The runner shells
out to `bun` and `gh` and drives the Agent SDK; each is provisioned per machine, so a fresh clone
can install cleanly and still fail hours into a run:

```sh
bash "$(dirname "$(dirname "$runner_dir")")/scripts/doctor.sh"
```

It exits 0 when every prerequisite is present, or exits 1 naming each gap and its remedy. On a
non-zero exit, relay the gaps to the owner and stop — do not start a campaign on a machine that
cannot finish it.

**Also validate every card's plan against the campaign's schema-lock paths — once per campaign,
before the first launch.** This shifts the schema guard left, from verify-time (post-merge) to
authoring/preflight-time: a plan that schedules a locked-path change without declaring
`allowsSchemaChange: true` front-matter fails here, before any session spawns, instead of being
discovered by the runner's `schemaGuard` verify check after the card's PR already merged. Run it
for EVERY card in the state file's `sequence`, over that card's own `plan` path, passing the state
file's own `schemaLockPaths` (comma-joined):

```sh
bash "$(dirname "$(dirname "$runner_dir")")/scripts/validate-plan.sh" \
  --schema-lock-paths <campaign schemaLockPaths, comma-joined> \
  <card's plan path>
```

It exits 0 when the plan either does not touch a locked path or declares
`allowsSchemaChange: true`, or non-zero naming the plan, the matched task line, and the fix. Run
this over **every** card before judging anything — same as `doctor.sh` above, this check is
additive and never fatal-on-first-miss: a non-zero exit on card 2 of 17 is not a reason to skip
checking cards 3-17, it is one entry to collect and keep going. Only once every card has been
checked, relay the FULL consolidated list of violating cards (plan, matched task line, and fix
for each) to the owner in one message and stop — do not launch a campaign that will only fail
this same guard later, post-merge, one card at a time, after PR #185's incident (08-08 campaign,
ruling UC-3).

1. **Always `--dry-run` first** — zero side effects (no lock acquired, nothing written, no
   session spawned). Sanity-check the derived next action before committing to a real run:

   ```sh
   bun "$runner_dir/run.ts" \
     --repo <target-repo> \
     --model <model> \
     --home "$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<campaign-slug>" \
     --dry-run
   ```

2. **Then launch the WATCHDOG in the background** (the runner's `watchdog` subcommand, same
   flags, no `--dry-run`). The watchdog supervises one runner pass at **zero token cost**: on an
   account-limit death it waits until the recorded reset and relaunches; on an upstream-overload
   death it backs off and relaunches; on a crash it relaunches once; and it exits ONLY when a
   human decision is needed, and no `/loop` heartbeat is needed while a watchdog is attached —
   that 15-minute LLM tick is exactly what this replaces (issue #74, fixlist P14).

   Launch it **detached**, with this one-liner. The parenthesised subshell double-forks so the
   process is reparented to pid 1 and survives both this shell and the harness's tool timeout;
   `nohup` detaches it from the terminal; stdin comes from `/dev/null` so it can never block on
   a read. (This double-fork is the portable form of process detachment on this stack — do not
   substitute a process-group tool that may not be present on every machine.)

   ```sh
   ( nohup bun "$runner_dir/run.ts" watchdog \
       --repo <target-repo> \
       --model <model> \
       --home "$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<campaign-slug>" \
       </dev/null >"$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<campaign-slug>/watchdog/launch.log" 2>&1 & )
   ```

   Record the exact command, the start time, and the campaign home in your working notes — you
   will need them if this session ends before the watchdog does.

   Then arm a wake-up loop on the watchdog's own status file — it writes `status.json` within 5
   seconds of starting, and fills in `terminal` only when it is done:

   ```sh
   until [ "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["terminal"] is not None)' \
     "<campaign-home>/watchdog/status.json" 2>/dev/null)" = "True" ]; do sleep 60; done
   ```

   `status.json` answers "what is it doing right now" (including `nextWakeAt` while it is
   waiting out an account limit) without costing a token; the harness's own "background command
   exited" notification for the one-liner above is not the signal to act on — the wake-up loop
   finishing is.

   Before the first card's session spawns, the runner (running under the watchdog's supervision)
   still prints its read-only live-viewer URL (`campaign viewer: http://127.0.0.1:4321/live?...`)
   so the owner can watch the running card's transcript — now captured in the watchdog's own
   `runner-stdout/<attempt>.log` under the campaign home rather than this shell's terminal, since
   the launch above is detached; pass `--no-viewer` above to skip starting it.

   The **bare runner** launch is still available when you deliberately want a single
   unsupervised pass (a scoped `--cards … --max-cards 1` smoke run, say) — no watchdog, no
   detachment, plain foreground-background as before:

   ```sh
   bun "$runner_dir/run.ts" \
     --repo <target-repo> \
     --model <model> \
     --home "$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<campaign-slug>"
   ```

   The harness notifies you when this bare-runner background command exits — treat that
   notification itself as the "report is ready" signal for this fallback path. Do not poll or
   guess; wait for it.

3. **On the wake-up, read `<campaign-home>/watchdog/status.json` FIRST, then
   `campaign-report.json`.** The watchdog's `terminal.reason` says why supervision ended
   (`runner_done` · `escalations_pending` · `rulings_unratified` · `session_incomplete` ·
   `quota_cap` · `overloaded` · `stalled` · `lock_conflict` · `error` · `stop_requested`) and its
   `counters` say what it already absorbed for you (quota waits, overload backoffs, crash
   relaunches). Then read `campaign-report.json` for the campaign truth: **the exit code is a
   hint, the report is the truth** — always read the report before deciding what to do next, even
   if the exit code alone looks final.

   | Watchdog exit | Meaning |
   | --- | --- |
   | `0` | Reached `done` (or `STOP` was honoured) — read the report and go to Stage D. |
   | `10` | A human decision is needed; `status.json`'s `terminal.reason` names which. Go to Stage C. |
   | `11` | `--once` only: a pass is still in flight (or was just started). Not used by Stage B. |
   | `1` | Usage error — the message on stderr names the flag or the refused `--home`. |

#### The runner's CLI contract (flags, exit codes — the only interface this skill uses)

| Flag | Required | Meaning |
| --- | --- | --- |
| `--repo` | yes | Target repo root. |
| `--model` | yes | Executor model tier. |
| `--home` | yes | The campaign's machine-local operational home — always computed as `"$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<campaign-slug>"`, **never** typed literally (`tribe-home.sh` is the only place that knows the `~/.tribe` key derivation). Every operational artifact (`campaign-state.json`, `answers.md`, `escalations/`, `campaign-report.*`, `.runner.lock`, `STOP`) resolves to a fixed name under it — one campaign per home, so there is no separate flag for any of them. |
| `--logs-dir` | no | Session log destination. |
| `--session-timeout` | no | Wall-clock abort per executor session. |
| `--dry-run` | no | Derive and print the next action with zero side effects. |
| `--cards` | no | Comma-separated card ids — restrict the loop to only these. |
| `--max-cards` | no | Stop after processing this many cards this run. |
| `--max-concurrent` | no | Integer ≥ 1 — how many cards' sessions may run at once this pass. Default `1` (today's one-card-at-a-time behavior); bounds WIDTH only, never ORDER — `dependsOn` still owns ordering (see "The runner's concurrency model" below). Only pass this when the owner's directive genuinely wants bounded parallelism; the default is correct for every other campaign. |
| `--include-escalated` | no | Reconsider a card whose escalation file already exists. |
| `watchdog` (subcommand) | — | `bun "$runner_dir/run.ts" watchdog <same flags>` supervises one runner pass at zero token cost: `--follow` (default) or `--once`, plus `--stall-minutes` (30), `--max-quota-waits` (6), `--max-overload-backoffs` (5), `--max-crash-relaunches` (1), `--quota-grace-seconds` (30), `--poll-seconds` (30), `--fallback-model <tier>`. Writes `<home>/watchdog/status.json` and `events.jsonl`; exits `0` done · `10` needs_human · `11` running (`--once`) · `1` usage. See `scripts/runner/README.md`'s "Watchdog" section. |

The three required flags have **no default** — omitting any of them is a usage error, not a value
worth guessing. An unrecognized flag (including the deleted `--state`/`--answers`/
`--escalations-dir`) is rejected by name.

| Exit code | Meaning |
| --- | --- |
| `0` | Ran to done, or `--dry-run` completed, or `STOP` was present at startup. |
| `1` | `.runner.lock` is held by a live process, or a CLI argument error. |
| `2` | The pass finished; **at least one escalation is pending.** This is NOT "aborted at the first question" — the runner parks the escalated card and keeps going, and only exits once nothing else is progressable. |
| `3` | A spawned session ended incomplete (no further resume path); state was already recorded, so the next run resumes it automatically — this is not a human-decision escalation. |
| `5` | The pass would otherwise have concluded `done`, but `answers.md` carries ≥1 ruling with no recognized `ratified-as:` disposition (harness-gap-wiring PR C, `core/rulings.ts`). Report `run.reason` is `rulings_unratified`; this is answerable by YOU (Shaman authority) — see the report's "Pending (needs the owner)" section for the unratified ruling ids and how to clear it, never a crash and never a reason to re-trigger unchanged. |

`campaign-report.json` (+ its human-readable `campaign-report.md` twin) is written under the
campaign home on **every** real exit path above — but **not** on `--dry-run` (zero side effects)
and **not** on a refused start (exit `1` from a held lock). Its per-card `outcome` is one of
`shipped | escalated | blocked | not_reached`; a `shipped` card carries `pr`/`mergeSha`; an
`escalated` card carries `escalationFile`, a one-line `question` digest, and `autoAnswerRounds`;
a `blocked` card carries `blockedOn`. Top-level `pending` lists every card still needing the
owner, and `stats` totals each outcome; a `rulings_unratified` exit (code `5`) additionally
names every unratified ruling id under "Pending (needs the owner)". Treat this JSON (never the
exit code alone, never your own memory of what you dispatched) as the single source of truth
for "what happened."

`.runner.lock` (also under the campaign home) makes a double-trigger safe — a second instance
refuses to start rather than double-spawning sessions. `STOP` (also under the campaign home) is
the owner's manual brake: drop it there to have the next run exit cleanly before touching a card,
or to have an in-flight run finish its current card and stop before starting the next.

### Stage C — Round-trip: answer, re-trigger, cap (per design §O6)

On every exit notification where the report shows `pending` cards:

1. **For each `escalated` card**, read its `escalationFile`. Two outcomes:
   - **Within your Shaman authority** (scope clarifications, How tradeoffs, sequencing) — rule on
     it as ONE atomic ritual, not a bare `answers.md` write: append your ruling to `answers.md`
     (under the campaign home, tagged `R<n>`) yourself (this is the only writer of that file
     besides the owner; the runner itself never writes there — wall W3), **then archive the
     escalation file in the same step** by renaming it to `<card>.md.resolved-R<n>` (never
     delete it — the ruling trail stays inspectable):

     ```sh
     mv "<home>/escalations/<card>.md" "<home>/escalations/<card>.md.resolved-R<n>"
     ```
     An escalation file left in place is exactly what makes the runner's own `deriveCardPhase`
     short-circuit any FUTURE flag-less re-trigger of this card straight back to
     `escalation_pending` (the B14 trap, P6 fix-list) — archiving it the moment you rule is what
     lets the re-trigger below skip `--include-escalated` for this card. Note the card as
     answered.
   - **Owner-only** (anything on the state file's own `ownerOnlyEscalations` list — data shapes,
     product promises, new permissions, privacy) **or genuinely too hard to call** — leave it
     parked (escalation file untouched, unanswered). Never rule on an owner-only trigger
     yourself, no matter how confident you are.
   - **Every ruling you append to `answers.md` carries a `ratified-as:` field** — this applies
     whether the ruling answers an `escalated` card's ordinary question or adjudicates a
     harness-gap proposal, surfaced either by an escalation or by a `shipped` card's
     `## Harness gaps` PR record. Frozen vocabulary: `rule <path>` | `debt <id>` |
     `roadmap <ref>` | `operational` | `dismissed` | `pending`. `operational` is for
     campaign-mechanics rulings that die with the campaign (a sequencing tweak, a scope
     clarification); anything durable — a rule, an anti-rule, a debt entity — names its
     governance artifact instead. A single ruling can fan out to MORE than one artifact
     (the worked example: outstanding-17's R7 became both a ROADMAP Decision Log entry
     and a new roadmap card) — the field names the PRIMARY artifact, one value only (that
     is what the runner's gate parses); reference every additional artifact in the ruling
     body itself.

   `answers.md` is read once, at the START of a runner invocation (`resolveRunContext`,
   `core/loop/run-loop.ts`) — that single read serves every card the invocation touches, so a
   card spawned fresh later in the SAME `--cards` batch still sees whatever `answers.md` held
   when the batch started, not a ruling added mid-batch. And within one card's own session, a
   ruling reaches the executor ONLY on a freshly-rendered brief (a blind spawn, a digest-
   carrying spawn, or the fresh-session fallback after a failed resume) — never on a successful
   `resume`, which sends nothing but a short continuation prompt with no Answers section at all
   (`core/loop/card-actions.ts`'s `runCardSession`). The card you just ruled on above needs none
   of this: its prior session already ended (that is what produced the escalation), so step 2's
   re-trigger below spawns it fresh against today's `answers.md` unconditionally. This matters
   only for a DIFFERENT card still mid-flight in the same batch, or for the owner editing
   `answers.md` directly while a multi-card run is active: either let the rule land on that
   card's own next fresh spawn (the normal case — e.g. a phrasing clarification that is fine to
   arrive next cycle), or stop the run and re-trigger once the rule is load-bearing for
   correctness — e.g. a scope or data-shape ruling an in-flight card would otherwise ship
   without, the same class of stakes as the B14 trap cited above.
2. **If you answered at least one card**, re-trigger THROUGH THE WATCHDOG, scoped to exactly the
   cards that can now progress — the ones you just answered plus every `not_reached` card from
   the report (so the rest of the sequence keeps moving, not just the answered card). Every card
   you just archived above needs no flag at all now; `--include-escalated` is needed ONLY when
   this batch also includes a card whose escalation file you deliberately left in place (still
   unanswered) and you are choosing to force a retry of it anyway. Same detached one-liner as
   Stage B step 2, plus `--cards` — Stage C re-triggers go through the watchdog too, so an
   account limit hit mid-round-trip costs a wait instead of a dead campaign:

   ```sh
   ( nohup bun "$runner_dir/run.ts" watchdog \
       --repo <target-repo> \
       --model <model> \
       --home "$(plugins/tribe/scripts/tribe-home.sh <target-repo>)/campaigns/<campaign-slug>" \
       --cards <answered-card-id>,<...>,<not-reached-card-id>,<...> \
       </dev/null >>"<campaign-home>/watchdog/launch.log" 2>&1 & )
   ```
   (`$runner_dir` — resolved once in Stage B; re-use it here rather than re-resolving. `--home`
   resolves to the SAME campaign home every time — it is re-computed rather than cached because
   `tribe-home.sh` is a pure function of `<target-repo>`, so this is not a fresh value.) The
   bare-runner form from Stage B step 2 still works for a deliberate single unsupervised pass.

3. **Track `autoAnswerRounds` per card and enforce the cap of 2** (wall W7). Before answering an
   escalation, check that card's `autoAnswerRounds` in the latest report: if it is already `2`,
   do NOT answer it again — leave it parked for the owner unconditionally. Repeated escalation on
   the same card means the question is harder than you judged the first time; a third
   auto-answer attempt is exactly the runaway loop this cap exists to prevent (an unattended
   orchestrator that keeps guessing at a question it doesn't understand, burning tokens
   overnight against the runner with nobody awake to notice).
4. **Repeat Stage B → Stage C** until an exit notification's report shows nothing you can answer
   and nothing progressable remains (every card is `shipped`, or parked as `escalated`/`blocked`
   with no further auto-answer round available).

## Stage D — The one final owner report

Once nothing more is answerable or progressable, read the **last** `campaign-report.json` and
build the single message the owner reads:

1. **For every card the report marks `shipped`, independently re-verify it before repeating the
   claim.** Invoke the **`verify-shipped` skill by name** (never by reading or calling its script
   path directly — depend on its contract, not its implementation) with that card's `pr` and its
   worktree path. This is the design's no-cascade read: the runner's own claim that a card
   shipped is not evidence on its own. Treat a `verify-shipped` failure as `blocked`, not
   `shipped`, in your final report.
2. **The ratification pass.** Collect every convention surfaced across the whole campaign. The
   authoritative list per card is **the gate's own JSON**, not a PR body you re-read: for each
   card, read `<home>/reports/<card>-gap-gate.json` and take its `open_ids` — the gaps the gate
   reconciled and left un-ruled. Add each `shipped` card's `## Harness gaps` PR record (the
   proposals its Warchief landed as reviewable drafts but did not self-ratify, per its brief)
   plus every ruling already in `answers.md`. Every one of them must end this pass
   non-`pending`. Durable dispositions (`rule`, `anti-rule`, `debt`) do not stay as prose in a
   PR body or a diary line — land them as **ONE closing governance PR** on the target repo, and
   land them **through the CLIs, never by hand**: for every ratified proposal that carries a
   `G-NNN`, run `gap-rule.ts` with `--ratified-by shaman` (or `--ratified-by owner` when the
   owner ruled that one) inside that closing PR's worktree, so the registry's `ruled` events —
   and the rule/anti-rule file or debt entity the ruling creates — ride the same PR. Add the
   ROADMAP Decision Log entries, then mark each ruling's `ratified-as:` accordingly; a ruling
   that closes a gap with an id records it as `ratified-as: rule <path> (G-NNN)`. Never
   hand-write a rule file, a debt entity, or a line of `.tribe/harness-gaps.jsonl` — a ruling
   that never reaches `gap-rule.ts` leaves the registry claiming the gap is still open and
   leaves `gap-precision.ts` with nothing to score (this is exactly what the 2026-09-05 closing
   pass did). The runner's `rulings_unratified` exit is the mechanical backstop for skipping
   this step — it is not the primary mechanism, do not rely on it to catch what this pass should
   catch by judgment. A ruling left `pending` means the campaign is **not done**, full stop, no
   matter how many cards shipped.
3. **You can also recover which commits belong to this campaign directly from git.** Every
   commit a card's executor session made should carry a `Campaign: <campaign-slug>` git trailer
   — the runner's executor brief instructs it (see the runner README's "Campaign commit
   trailer" section). `git log --grep="Campaign: <campaign-slug>"` in `<target-repo>` lists
   them. **This is instructional, not verified**: neither the D3 checks the runner replays nor
   `verify-shipped` confirm the trailer is present, so a missing trailer is a documentation gap
   worth noting, never proof a card didn't ship — `verify-shipped` (item 1) stays the actual
   acceptance gate.
4. **Compose ONE report** to the owner, covering every card in the campaign:
   - **Shipped** — PR number, merge sha, and the `verify-shipped` verdict.
   - **Escalated / blocked** — the question (or `blockedOn` dependency), why it needs the owner,
     and how many auto-answer rounds it already used.
   - **Harness-gap rulings** — every ruling the ratification pass closed, each with where it was
     ratified to (the rule/debt/roadmap reference, or `operational`/`dismissed`).
   - Overall `stats` (shipped / escalated / blocked / not-reached counts) and pointers to the
     report files and escalation files, so the owner can go deeper without you re-deriving
     anything.

This is the ONE message the owner reads — no partial status updates in between beyond the
irreversible escalations the register requires.

## A campaign can outlive this session

A multi-card campaign can run for hours; the session that triggered it may not still be open
when it finishes. That is fine by design — **every piece of state lives on disk, under the
campaign home**: the state JSON, the report, the escalation files, `answers.md`, and the session
logs. If you are a *new* session picking this up cold, do not try to reconstruct anything from a
prior conversation: re-enter through this same skill, read the latest `campaign-report.json`
under the campaign home, and continue from Stage C (or Stage B, if nothing has been triggered
yet). You are always a *viewer and answerer* of state that lives on disk — the running process
and its memory never live inside you.

## Walls this skill exists to hold

- **W1 — stateless.** No repo, path, model, or campaign value is ever written into this file
  itself; every one of those is a placeholder filled in at invocation time.
- **W3 — judgment stays in sessions.** `answers.md` is written only by you (a session) or the
  owner — never by the runner. If you ever see the runner's own commits touching that file,
  something is badly wrong; stop and report it rather than continuing the loop.
- **The diary and `answers.md` are event logs and operational state, never the resting place of
  a durable convention.** Durable means a governance surface of the target repo — a rule file,
  an anti-rule, a debt entity, a ROADMAP Decision Log entry — reached through a PR. A ruling that
  never leaves `answers.md` is exactly the failure the ratification pass (Stage D) exists to
  catch.
- **W7 — bounded auto-answer.** At most 2 auto-answer rounds per card. A card still escalating
  after that parks for the owner, full stop — do not attempt a third ruling.
