# Tribe roadmap

`plugins/tribe/README.md` describes `docs/tribe/` as holding the repo's durable contracts —
"specs, plans, Decision Log, ideas, `ROADMAP.md`". This file is that `ROADMAP.md`; it was created
by the `fu-supervisor-settings` closing pass (2026-09-24), which needed a durable home for rulings
that are neither a rule file nor a registry event.

## Decision Log

Append-only. One row per ruling: date · card/campaign · question · ruling · `ratified-as`.
A ruling not written down was never made.

### 2026-09-24 · campaign `fu-supervisor-settings` · card `supervisor-session-settings`

Each entry below stands alone. The campaign's working notes (`answers.md`) lived in its campaign
home, `~/.tribe/<repo-key>/campaigns/fu-supervisor-settings/`, and are not tracked in the repo.

#### D-2026-09-24-1 — The supervisor's campaign home is also its own settings root

**Question (Scout P1/P2).** A one-shot supervisor session runs with `cwd: <campaign home>` and
`settingSources: ['user','project','local']`, while `decideContainmentHook` permits `ruling`/
`ratify` to write anywhere under that same home. `project`/`local` resolve to
`<home>/.claude/settings.json`, `<home>/.claude/settings.local.json` and `<home>/CLAUDE.md` — all
three are executable configuration for the *next* session in that directory, and none arrives as a
tool call, so no `PreToolUse` hook can see the write.

**Ruling (Shaman).** The exposure is **accepted as confirmed** — verified against the merged code
at `core/supervisor/session.ts:121,130` and `core/supervisor/permit.ts:85-88`. It is **not**
ratified as a repo-wide rule yet, because the mechanism that would make it exploitable is
unmeasured: nobody has shown that a `local`-tier `hooks` block actually executes inside an SDK
session. Repo thresholds also require prevalence ≥ 3 files; this is one.

**The order of work is fixed:** a future card must (1) MEASURE whether a `local`-tier `hooks` block
runs in an SDK session, then (2) close the exposure by separating the settings root from the write
root, or by refusing `<home>/.claude/**` and `<home>/CLAUDE.md` in the containment hook, then
(3) author the rule from the measured result. Grants are out of scope — R1 and R2 stand.

**Owner ruling (2026-09-24), which supersedes the timing above:** "Fix now as a follow-up card".
This is a trust-surface question, so it belongs to the owner. The same three steps run as the
next card of this campaign, `supervisor-home-settings-containment`, instead of waiting on the
roadmap.

`ratified-as: roadmap D-2026-09-24-1`

#### D-2026-09-24-2 — `inferOneShotKind` re-derives a discriminator, non-totally

**Question (Scout P3).** `cli/main.ts:611-616` reconstructs a session `kind` the caller already
held, and the derivation is not total: `additionalDirectories` is optional, so a `ruling` built
without `repoRoot` infers `'ratify'`.

**Ruling (Shaman).** Confirmed, and **accepted as a known limitation** rather than an anti-rule.
The Scout graded it at its "decides security posture → Blocker" tier; that grading is **corrected
here**. The function has exactly one caller, `cli/main.ts:846`, on the **test-double** branch
(`spawnSessionDouble`). The production branch at `:845` calls `sdkSpawnSession` directly and never
consults it, so no real grant, envelope or routing depends on the inference.

**Revisit trigger, named so this is falsifiable:** if `inferOneShotKind` ever acquires a caller on
the real spawn path, it must be deleted and the `kind` carried through `OneShotSpawnParams` instead.

`ratified-as: roadmap D-2026-09-24-2`

#### D-2026-09-24-3 — A timed-out one-shot session is unattributable

**Question (Scout P5).** `core/supervisor/session.ts:309-317`'s timeout branch resolves
`{sessionId: null, usage: null, totalCostUsd: null, permissionDenials: null}` even though
`io.onSessionStart(sessionId)` already fired and a transcript exists on disk. `loop.ts` writes
those nulls into the ledger, so the campaign under-reports the cost of exactly the sessions that
burned the full turn budget, and the viewer cannot reach a timed-out session's transcript.

**Ruling (Shaman).** Confirmed; accepted as scheduled work. Fix by letting the timer only
`abort()` and having `consumeOneShot` return the typed timeout result with the identity it already
holds. Would have been a metered debt entity but for D-2026-09-24-5.

`ratified-as: roadmap D-2026-09-24-3`

#### D-2026-09-24-4 — `cli/main.test.ts` grows imports mid-file

**Question (Scout P6).** The file carries `import` statements at five depths, one per card that
touched it, and the pattern is now being written into plans as an instruction to follow.

**Ruling (Shaman).** Confirmed — measured at 6 import sites past line 40 on the merged tree.
Accepted as scheduled work: hoist every import to the header and add a check so a seventh site
cannot appear. Would have been a metered debt entity but for D-2026-09-24-5.

`ratified-as: roadmap D-2026-09-24-4`

#### D-2026-09-24-5 — The `debt` disposition is unreachable on the current toolchain

**Question (raised by the closing pass itself, not by any report).** Ruling a gap as `debt` requires
`gap-rule.ts` to create a `debt` C3 entity via `c3 add debt <slug>`.

**Finding.** That command fails on the toolchain this repo actually runs. There is no `c3`/`c3x` on
PATH; the only working invocation is `bunx @c3x/cli@11.6.3`, and it answers `error: unknown entity
type 'debt'`. `c3x canvas list` on 11.6.3 returns 10 built-in canvases (`adr`,
`atomic-design-change`, `component`, `container`, `pm-requirement`, `prd`, `ref`, `rule`, `system`,
`user-story`) and no `debt`. The CU-3 design froze the debt schema against **c3x 11.0.0**.
Corroboration that the path has never run: `.c3/documents/debt/` does not exist, and no registry
event has ever carried `"disposition":"debt"`.

**Ruling (Shaman).** Recorded as an **open harness gap for the owner**. Until it is closed, one of
the five dispositions is a dead branch, and debt-shaped findings degrade to roadmap entries with no
burn-down meter — which is exactly what happened to D-2026-09-24-1, -3 and -4 above. Closing it
means either registering a `debt` canvas on 11.6.3 or pinning the C3 CLI to a version that has one.

**Noted in passing:** the failure also *validated* `gap-rule.ts`'s "artifacts first, ruling last"
ordering — it threw at step 4 and left the registry byte-unchanged and `git status` clean.

`ratified-as: roadmap D-2026-09-24-5`

#### D-2026-09-24-6 — `ruling`/`ratify` sessions may use the `Skill` tool (owner ruling R2)

**Question (spec §10 Q2).** Once the user settings tier loads, `c3` is registered in `ruling`/
`ratify`, but their grant refused the `Skill` tool, so `Skill c3` could not return C3 content.

**Ruling (owner, verbatim):** "Allow the Skill tool". `JUDGMENT_ALLOWED_TOOLS` gains `Skill` and
nothing else; `Bash` stays in `JUDGMENT_DISALLOWED_TOOLS`. Known and accepted limit: the C3
command-line tool still cannot run in these sessions, because they have no `Bash`. Landed in
PR #168; the architecture decision record is `adr-20260924-supervisor-session-settings`.
Disposition given by the owner: "Record it in the Decision Log".

`ratified-as: roadmap D-2026-09-24-6`
