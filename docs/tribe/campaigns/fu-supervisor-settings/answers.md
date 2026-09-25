# Campaign answers — fu-supervisor-settings

Rulings appended by the orchestrating session (Shaman authority) or the owner. The runner never
writes here.

Campaign: one card, `supervisor-session-settings`, shipped as PR #168 (merge sha `7af10a4`).
Closing pass ratified 2026-09-24 by the closing session under Shaman authority.

## Rulings carried from the card (already recorded in the campaign home's `answers.md`)

- **R1 — `closing`'s grant can be widened by a host allow rule** (spec §10 Q1). Ruled by Shaman.
  Option (b): a narrow `PreToolUse` hook on `closing` refuses any tool outside the existing
  `CLOSING_ALLOWED_TOOLS`; the list itself does not change. Amends card decision D2. The hook adds
  no permission — it enforces a grant the owner already ratified. Accepted consequence: `closing`
  stops running `TaskCreate`, `CronList` and `ListAgents`, none of which is in its grant and none
  of which the closing stage uses. **ratified-as: operational** (lives in the card's spec as a
  design decision; dies with this campaign's decisions).
- **R2 — `ruling`/`ratify` cannot run `Skill c3`** (spec §10 Q2). Ruled by **owner**: allow the
  `Skill` tool. `JUDGMENT_ALLOWED_TOOLS` gains `Skill` and only `Skill`; `Bash` stays in
  `JUDGMENT_DISALLOWED_TOOLS`. **ratified-as: roadmap D-2026-09-24-6** (disposition given by the owner on
  2026-09-24: "Record it in the Decision Log").

## Harness-gap rulings (registry `.tribe/harness-gaps.jsonl`, written only by `gap-rule.ts`)

- **G-006 — `mkdtempSync` without a teardown in `plugins/tribe/scripts/runner`.**
  **ratified-as: dismissed-duplicate, ref `rule-temp-dir-cleanup` (G-006)**, ruled by Shaman.

  The convention G-006 detects is already the ratified rule `rule-temp-dir-cleanup`, minted from
  **G-002** against `plugins/tribe/scripts/viewer`; that rule's own Scope section already reads
  "applies to every `*.test.ts` / `*.test.tsx` in the repo that calls `mkdtempSync`". G-006 is the
  same convention re-detected in a different directory, so it warrants no second rule — but the
  violations it found were real, so they were **closed rather than recorded as debt**:

  | Measurement (same tool before and after: leftover `$TMPDIR` fixture dirs over the same 31 tests) | Leaked dirs | Tests |
  | --- | --- | --- |
  | before (`origin/master`) | 31 | 31 pass |
  | after (this PR) | **0** | 31 pass |

  `dismissed-duplicate` is the correct disposition and not a scoring dodge: `gap-precision.ts`
  excludes `dismissed-duplicate` from the precision ratio on **both** sides (it is neither a hit
  nor a miss), so a duplicate detection neither inflates nor deflates the detector's score.
  Precision after this ruling: `{"window":20,"ruled_considered":3,"precision":1}`.

- **Not this campaign's gaps.** `G-001` (`opened`) and `G-005` (`seen`) are still un-ruled in the
  registry. Neither appears in this card's `supervisor-session-settings-gap-gate.json`
  `open_ids` (`["G-006"]`); both predate this campaign and are left untouched here.

## Scout governance proposals (P1–P8) — every one ruled non-`pending`

Source: `reports/scout-supervisor-session-settings.md`, recorded as reviewable drafts in PR #168's
`## Harness gaps` section and explicitly **not** self-ratified by the Warchief. Each was re-grounded
against the merged code before ruling; two of the Scout's claims were corrected.

| # | Scout proposed | **Ratified as** | Ground |
| --- | --- | --- | --- |
| P1 | `rule` | **roadmap** (not a rule yet) | Exposure confirmed; exploitability unmeasured — see below |
| P2 | `debt` | **roadmap** | Confirmed in code; `debt` is unreachable on this toolchain — see below |
| P3 | `anti-rule` | **roadmap** (severity corrected) | Confirmed, but its only caller is the test double |
| P4 | `rule` ×3 | **item 1 fixed in this PR; items 2–3 dismissed** | Item 1 verified; 2–3 unproven prevalence |
| P5 | `debt` | **roadmap** | Confirmed at `session.ts:309-317` |
| P6 | `debt` | **roadmap** | Confirmed: 6 import sites past line 40 |
| P7 | `dismissed` | **dismissed** | Concur — D2 justifies the redundancy |
| P8 | `dismissed-duplicate` | **dismissed-duplicate** | Concur — verified `readable-code.md` symptom 2 |

### P1 + P2 — the supervisor home is its own settings root

**The exposure is confirmed, mechanically, on the merged code**: `core/supervisor/session.ts:121`
sets `cwd: config.homeDir`, `:130` sets `settingSources: ['user','project','local']`, and
`core/supervisor/permit.ts:85-88` permits `Write`/`Edit` anywhere under that same `homeDir` with no
exclusion for `.claude/**` or `CLAUDE.md`. A judgment session can therefore write the settings and
instruction files that the *next* session in that home loads, and no `PreToolUse` hook can see it
because neither arrives as a tool call.

**Not ratified as a repo-wide rule, for two grounded reasons.** First, the escalation mechanism is
unmeasured — nobody has yet shown that a `local`-tier `hooks` block actually executes inside an SDK
session; the Scout says so itself ("a fix session must first MEASURE that..."). A rule is a
standard for the whole repo, and this one would generalize an unverified mechanism from a single
instance. Second, this campaign's own standing thresholds (carried from `cu3-scout-ruling-loop`)
set prevalence at **≥ 3 files**; this is one. **The ordering is therefore: measure first, then
rule** — recorded in the Decision Log with that gate named.

### P3 — `carry-the-discriminator`: the Scout's severity was too high

The defect is real and confirmed: `cli/main.ts:611-616`'s `inferOneShotKind` re-derives a `kind`
the caller already held, and the derivation is not total (`additionalDirectories` is optional, so a
`ruling` built without `repoRoot` returns `'ratify'`).

**But the Scout graded it against its own "decides security posture → Blocker" tier, and that tier
does not apply here.** `inferOneShotKind` has exactly one caller, `cli/main.ts:846`, and it sits on
the **test-double** branch (`spawnSessionDouble`); the real path at `:845` calls `sdkSpawnSession`
directly and never consults it. No production grant, envelope or routing depends on the inference.
Recorded as a known limitation with a named revisit trigger, not as an anti-rule.

### P4 — a security grant must not be reachable as a mutable array

**Item 1 is confirmed and fixed in this PR.** `JUDGMENT_ALLOWED_TOOLS`, `JUDGMENT_DISALLOWED_TOOLS`,
`CLOSING_ALLOWED_TOOLS` and `CLOSING_DISALLOWED_TOOLS` were plain `string[]` assigned **by
reference** into `options.allowedTools?: string[]`, so a single `push` anywhere would have widened
the grant for every later session in the process. They are now `as const`, and the option fields are
`readonly string[]`. Verified: `bunx tsc --noEmit` exit 0, `bun test` 1335 pass / 8 skip / 0 fail —
identical to the card's own gate.

**Items 2–3 dismissed** (tests should import constants rather than retype them; E2E-asserted strings
should be exported constants). Both are reasonable, but neither has measured prevalence, and both
overlap ground `readable-code.md` already covers. Re-propose with a count if they recur.

### P7, P8 — dismissed, and the dismissals were checked rather than taken on trust

- **P7**: two hooks can deny one event with two different reasons in `ruling`/`ratify`. Real, but
  card decision D2 justifies the redundancy as defence in depth. Worth a one-line comment on the
  next card that touches `session.ts:172`; not worth a rules file.
- **P8**: `withoutVerifyShippedPlugin?: boolean` read as `!== true` is a negatively-named
  three-state flag. Confirmed duplicate — `plugins/tribe/rules/readable-code.md` carries
  "### 2. Three-state logic hiding inside a two-state check" verbatim.

## Finding raised BY this closing pass — the `debt` disposition is unreachable

`gap-rule.ts --disposition debt` **cannot succeed on the toolchain this repo actually runs.** The
CLI shells out to `c3 add debt <slug>`, and the resolved binary (`bunx @c3x/cli@11.6.3`, the only
working invocation on this machine — there is no `c3`/`c3x` on PATH) answers:

```
error: unknown entity type 'debt'
hint: run c3x canvas list
```

`c3x canvas list` on 11.6.3 returns 10 built-in canvases — `adr`, `atomic-design-change`,
`component`, `container`, `pm-requirement`, `prd`, `ref`, `rule`, `system`, `user-story` — and no
`debt`. The CU-3 design froze the debt schema against **c3x 11.0.0**; the canvas is not present on
11.6.3. Corroborating evidence that this path has never once run: `.c3/documents/debt/` does not
exist, and no registry event has ever carried `"disposition":"debt"`.

**Consequence:** of the five dispositions, `debt` is currently a dead branch, which is precisely why
P2, P5 and P6 above land as roadmap entries rather than as metered debt entities that burn down.
This is an owner-facing harness gap, recorded in the Decision Log.

**One thing this proved in passing:** `gap-rule.ts`'s "artifacts first, ruling last" ordering works.
The failed `debt` run threw at step 4 and left `.tribe/harness-gaps.jsonl` byte-unchanged and
`git status` clean — no ruling was ever written pointing at an entity that does not exist.
