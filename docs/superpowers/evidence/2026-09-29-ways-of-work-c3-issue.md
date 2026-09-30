# c3: point `c3-215` at the one "Ways of work" definition (and three c3x 11.0.0 defects that blocked it)

> Written on the machine that planned card `ways-of-work-consolidation` (2026-09-30), for a machine
> with the C3 skill installed and no other context. Everything needed is below; the repo at merged
> `master` is the only other input.

## 1. Context — what changed and why this issue exists

The card `ways-of-work-consolidation` (branch `feat/ways-of-work-consolidation`) made the tribe's
three **ways of work** — how an approved plan is executed: `single-agent`, `subagent-per-task`,
`tribe` — defined in exactly one place: the section `## Ways of work` of
`plugins/tribe/agents/shaman.md`. That section holds the campaign harness — every approved plan,
in every mode, runs through `orchestrate-campaign` (the campaign runner, its watchdog and its
supervisor) as an N-card campaign, one card being normal, unless the owner explicitly says not to
use it; in Mode 1 the Shaman runs it on the approved card itself — then the three modes, the
rubric for choosing one, who chooses (the Shaman), the final review task and its 2-round fix cap,
the `## Final review` record in the PR body, who executes on each path, and one block per mode
that plans copy verbatim. Every other live file was changed to point to it: `plugins/tribe/agents/warchief.md`,
`plugins/tribe/skills/orchestrate-campaign/SKILL.md`, `plugins/tribe/scripts/runner/README.md`,
`plugins/tribe/README.md`, `plugins/tribe/claude-md/shaman-brainstorm-together.md`. The card also
extended `plugins/tribe/scripts/validate-plan.sh` (the `tribe` mode, the campaign runner's Done
section, the mode's block, the final review task), added the drift counter
`plugins/tribe/scripts/ways-of-work/drift.ts`, and taught `plugins/tribe/install.sh` to refresh an
installed snippet section in place.

The card made **no `.c3/` change**, by the owner's ruling of 2026-09-29: c3x 11.0.0 could not land
an edit to `c3-215` (section 3). So `.c3/c3-2-plugins/c3-215-tribe.md` still restates the old
rules ("never the tribe's delivery loop … unless the owner explicitly asks", "simple by default,
Tribe only when asked", the retired "Tribe style" section names). The drift counter shows it:

```bash
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --verbose
```

prints, on merged `master`, the lines

```text
restates   .c3/c3-2-plugins/c3-215-tribe.md (6 lines)
canonical  plugins/tribe/agents/shaman.md#Ways of work (11 lines)
ways-of-work definitions: 2
```

followed by the six `c3-215` hit lines. This issue makes `c3-215` point to the section, records
the decision as an ADR, and reports the c3x defects upstream.

## 2. Done when (acceptance)

1. `bun plugins/tribe/scripts/ways-of-work/drift.ts --repo .` prints two lines: the
   `canonical  plugins/tribe/agents/shaman.md#Ways of work (N lines)` line (N was 11 when this was
   written) and `ways-of-work definitions: 1`. No `restates` line remains.
2. `c3x check` reports no error beyond the historical broken seals `master` already reports: 157
   lines `BROKEN_SEAL changes/…` and nothing else (this one-liner prints `157 0`):
   ```bash
   bash "$C3X" check < /dev/null 2>&1 | python3 -c "import sys; b=[l for l in sys.stdin.read().splitlines() if l.startswith('BROKEN_SEAL')]; print(len(b), sum(1 for l in b if not l.startswith('BROKEN_SEAL changes/')))"
   ```
   (157 is the count on `master` @ `632a039`; if `master` has moved, compare with `master` itself.)
3. `git status --short .c3/changes` is empty — no historical change file deleted (defect D2).
4. The ADR `adr-YYYYMMDD-ways-of-work-consolidation` (body in section 5) exists with
   `status: accepted`.

## 3. The c3x 11.0.0 defects (file these upstream)

Resolve c3x as the C3 skill ships it (the plugin-cache install):

```bash
for f in "$HOME"/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3/bin/c3x.sh; do C3X="$f"; done
cat "$(dirname "$C3X")/VERSION"   # 11.0.0
```

Run every c3x command with stdin from `/dev/null`: in one run from a non-interactive shell the
first c3x call stalled until killed; with `< /dev/null` the same script finished in 6 seconds.

- **D1 — every block patch on a `c3-215` table row is rejected with
  `invalid required table: <table>`, a byte-identical patch included.** The rejection is not the
  placeholder-word check: it stays after every placeholder word is removed (step 4 below). The
  same happens on the Business Flow and Change Safety tables. Each patch of a change unit is also
  validated alone against the base, so pre-existing violations spread over several rows can never
  be fixed by one-row patches either.
- **D2 — every successful c3x write deletes all 157 `.c3/changes/**/*.patch.md` files whose seals
  are broken, and any untracked change-unit folder.** Seen with `c3x repair` (step 3 below),
  `c3x add adr` and `c3x set`. They are the repo's decision history and must be restored from git
  after every write (`git checkout -- .c3/changes`).
- **D3 — the canvas placeholder-word check rejects ordinary English.** "each later turn",
  "an optional doorbell session", "the runner's optional flags" fail as placeholder language (the
  words checked are: TBD, TODO, maybe, optional, later, "if applicable"). Five such words in
  `c3-215` make the whole entity invalid, which with D1 blocks every edit to it.

Reproduction — from a clean checkout of merged `master`, the exact script and its exact output
(`<repo>` stands for the checkout's absolute path):

```bash
set -u
for f in "$HOME"/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3/bin/c3x.sh; do C3X="$f"; done
echo "\$ cat \"\$(dirname \"\$C3X\")/VERSION\""; cat "$(dirname "$C3X")/VERSION"; echo
echo '--- 1. c3x repair on merged master (builds the local cache)'
bash "$C3X" repair; echo "exit=$?"
echo "files changed: $(git status --short | wc -l | tr -d ' ')"
echo '--- 2. a byte-identical block patch on one c3-215 Contract row'
bash "$C3X" change new repro-noop-row
H="$(bash "$C3X" read c3-215 --section Contract --cite | grep -o 'c3-215#n[0-9]*@v[0-9]*:sha256:[0-9a-f]* "Status protocol' | cut -d' ' -f1)"
R="$(grep '^| Status protocol |' .c3/c3-2-plugins/c3-215-tribe.md)"
printf -- '---\ntarget: c3-215\nscope: block\nbase: %s\n---\n%s\n' "$H" "$R" > .c3/changes/repro-noop-row/01-same-row.patch.md
bash "$C3X" change apply repro-noop-row --dry-run; echo "exit=$?"
echo '--- 3. remove the five placeholder words (text only), then c3x repair'
sed -i.orig -e 's/an optional "doorbell"/an opt-in "doorbell"/' -e 's/A snippet added later reaches/A snippet added afterwards reaches/' -e 's/each later turn a resume/each subsequent turn a resume/' -e 's/landed by a later consolidation task/landed by a subsequent consolidation task/' -e "s/runner's optional flags/runner's non-required flags/" .c3/c3-2-plugins/c3-215-tribe.md && rm .c3/c3-2-plugins/c3-215-tribe.md.orig
bash "$C3X" repair; echo "exit=$?"
echo "historical patch files deleted: $(git status --short .c3/changes | grep -c '^ D ')"
echo '--- 4. restore them; the same byte-identical row patch again, with no placeholder word left'
git checkout -- .c3/changes
bash "$C3X" change new repro-noop-row
H="$(bash "$C3X" read c3-215 --section Contract --cite | grep -o 'c3-215#n[0-9]*@v[0-9]*:sha256:[0-9a-f]* "Status protocol' | cut -d' ' -f1)"
printf -- '---\ntarget: c3-215\nscope: block\nbase: %s\n---\n%s\n' "$H" "$R" > .c3/changes/repro-noop-row/01-same-row.patch.md
bash "$C3X" change apply repro-noop-row --dry-run; echo "exit=$?"
echo '--- 5. clean up'
git checkout -- .c3 && rm -rf .c3/changes/repro-noop-row && echo "files changed: $(git status --short | wc -l | tr -d ' ')"
```

```text
$ cat "$(dirname "$C3X")/VERSION"
11.0.0

--- 1. c3x repair on merged master (builds the local cache)
Rebuilt local C3 cache from canonical .c3/
Resealed canonical .c3/ tree
Checked 79 docs — 5 errors

  x c3-215: placeholder language in Business Flow row 5 column Detail

  x c3-215: placeholder language in Contract row 5 column Contract

  x c3-215: placeholder language in Contract row 6 column Contract

  x c3-215: placeholder language in Contract row 10 column Contract

  x c3-215: placeholder language in Contract row 13 column Contract

Legend: x = error (fix first)  ! = warning (incomplete, should fix)
check failed: 5 error(s)
exit=1
files changed: 0
--- 2. a byte-identical block patch on one c3-215 Contract row
change-unit repro-noop-row ready at <repo>/.c3/changes/repro-noop-row
drop <seq>-<slug>.patch.md files there, then: c3x change view repro-noop-row
REJECT patch 01-same-row.patch.md: merged c3-215 violates its canvas: error: content validation failed for c3-215
  error: placeholder language in Business Flow row 5 column Detail
    hint: write reviewer-ready docs: Goal, Parent Fit, Purpose, Foundational Flow, Business Flow, Governance, Contract, Change Safety, Derived Materials
  error: invalid required table: Contract
    hint: write reviewer-ready docs: Goal, Parent Fit, Purpose, Foundational Flow, Business Flow, Governance, Contract, Change Safety, Derived Materials

change apply: 1 gate failure(s); fix and retry
exit=1
--- 3. remove the five placeholder words (text only), then c3x repair
Rebuilt local C3 cache from canonical .c3/
Resealed canonical .c3/ tree
Checked 79 docs — all clear
OK: canonical markdown is in sync with <repo>/.c3
exit=0
historical patch files deleted: 157
--- 4. restore them; the same byte-identical row patch again, with no placeholder word left
change-unit repro-noop-row ready at <repo>/.c3/changes/repro-noop-row
drop <seq>-<slug>.patch.md files there, then: c3x change view repro-noop-row
REJECT patch 01-same-row.patch.md: merged c3-215 violates its canvas: error: content validation failed for c3-215
  error: invalid required table: Contract
    hint: write reviewer-ready docs: Goal, Parent Fit, Purpose, Foundational Flow, Business Flow, Governance, Contract, Change Safety, Derived Materials

change apply: 1 gate failure(s); fix and retry
exit=1
--- 5. clean up
files changed: 0
```

## 4. How to land it

**Path A — if your c3x no longer has D1** (a no-op row patch applies): write the ADR (section 5)
with `c3x add adr ways-of-work-consolidation --file adr-body.md`, then one block patch per row of
section 6 (`c3x read c3-215 --section <section> --cite` gives each row's handle; a new row is a
block edit of the row above it, replaced by both rows), `c3x change apply`, and set the ADR
`accepted`. Restore `.c3/changes` from git after every c3x write while D2 exists.

**Path B — with c3x 11.0.0 as it is** (verified end to end on a clone equal to merged `master`,
2026-09-30): the row text is edited directly, then `c3x repair` validates every doc and re-seals
`c3-215`. Save section 5's body as `adr-body.md` and section 6's script as `c3-215-rows.py`, then
from the repo root:

```bash
for f in "$HOME"/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3/bin/c3x.sh; do C3X="$f"; done
bash "$C3X" repair < /dev/null > /dev/null 2>&1   # builds the cache; fails on the five placeholder words and changes no file
bash "$C3X" add adr ways-of-work-consolidation --file adr-body.md < /dev/null
git checkout -- .c3/changes                        # D2
python3 c3-215-rows.py .c3/c3-2-plugins/c3-215-tribe.md
bash "$C3X" repair < /dev/null | tail -n 2         # now all clear: re-seals c3-215
git checkout -- .c3/changes                        # D2
adr="$(python3 -c "import glob,os; print(os.path.basename(glob.glob('.c3/adr/adr-*-ways-of-work-consolidation.md')[0])[:-3])")"
bash "$C3X" set "$adr" status accepted < /dev/null
git checkout -- .c3/changes                        # D2
```

Output of that run:

```text
Created: adr ways-of-work-consolidation (id: adr-20260930-ways-of-work-consolidation)
Checked 80 docs — all clear
OK: canonical markdown is in sync with <repo>/.c3
Updated adr-20260930-ways-of-work-consolidation field "status"
```

Then `git status --short` shows exactly ` M .c3/c3-2-plugins/c3-215-tribe.md` and
`?? .c3/adr/adr-YYYYMMDD-ways-of-work-consolidation.md`, and the acceptance checks of section 2
print `ways-of-work definitions: 1` and `157 0`. Commit both files; merge as a regular 2-parent
merge (`gh pr merge --merge`).

## 5. The ADR body

The Evidence cells cite nodes as they are on `master` @ `632a039` (this card changed nothing under
`.c3/`). If `c3x add adr` rejects a cite as stale, re-read the handle with
`bash "$C3X" read <id> --section Goal --cite < /dev/null` and replace it.

```markdown
## Goal

Define the tribe's three ways of work — single-agent, subagent-per-task and tribe — the rubric for choosing one, who chooses (the Shaman), the final review task and its 2-round fix cap, and the block each plan copies, in exactly one place: the "Ways of work" section of plugins/tribe/agents/shaman.md. Every other live file points there, and one plan format passes both validate-plan.sh and the campaign runner's --dry-run in any mode (card ways-of-work-consolidation, owner rulings D1–D6 and S1–S3 of 2026-09-29). This ADR lands the C3 side: c3-215 stops restating the modes and points to the section.

## Context

Before this change the ways of work were restated in about nine live files that disagreed: Mode 1 of shaman.md knew two executors that both ended in one review and at most one fix round; orchestrate-campaign's Simple style had no review step at all; the heavy tribe loop could only be chosen when the owner asked in their own words; the planning Warchief or the campaign orchestrator picked the mode, never the Shaman. Two plan vocabularies coexisted: Mode 1 plans (Way of work, Executor, Verify blocks) failed the runner's --dry-run with missing_done, and runner plans (How to work, Done sections) failed validate-plan.sh. The committed drift counter (plugins/tribe/scripts/ways-of-work/drift.ts) measured 9 places defining the ways of work at the start of that card. The card merged with no .c3/ change, by the owner's ruling of 2026-09-29, because c3x 11.0.0 could not land a c3-215 row edit; the counter then reported 2 places, the canonical section and c3-215.

## Decision

A "Ways of work" section in agents/shaman.md is the one definition: the campaign harness every approved plan runs through by default (orchestrate-campaign driving the campaign runner, its watchdog and its supervisor; in Mode 1 the Shaman runs it on the approved card itself; only the owner's explicit words turn it off), the three modes with their rubric, the tie-break, who decides (the Shaman, asking the owner only when it judges the call needs the owner), the final review task with at most 2 fix rounds for the two light modes, who executes on each path, and one fenced block per mode that plans copy verbatim. The Shaman's anti-goals 1–2 gain a scoped exception for a delegated single-agent plan. The Executor key keeps its name and gains the value tribe. validate-plan.sh accepts tribe, requires the Hunter line only for tribe, mirrors the runner's Done-section reading, checks that the Way of work carries the declared mode's block verbatim, and checks that a light-mode plan ends with its Final review task; every review round is recorded in the PR body's ## Final review section, which the Shaman's SHIPPED gate checks. warchief.md, orchestrate-campaign, the runner README, the plugin README and the claude-md snippet point to the section. install.sh refreshes an installed snippet section in place, with a backup, so the pointer reaches every installed CLAUDE.md. This ADR updates c3-215's rows to match, as the Work Breakdown lists, so the drift counter reaches 1.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Contract rows (Owner → Shaman dispatch, validate-plan.sh, Global CLAUDE.md append, orchestrate-campaign, rulings-check.ts, a new drift-counter row), the Unattended-path flow row, two Change Safety rows, a new drift Change Safety row and the brainstorm-together snippet derived-material row describe the ways of work | c3-215#n2319@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command" | Change Safety rows re-verified: agent evals, test-validate-plan.sh, test-ways-of-work-plans.sh, test-install-hook.sh, the drift counter |
| c3-2 | container | Parent of c3-215; its responsibilities and boundary do not change (Parent Delta: none) | c3-2#n2304@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content" | review only |
| c3-0 | system | No system-level fact changes | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem" | review only |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-evals-fixture | Evals 57–63 are added and eval 56 is rewritten in the fixture shape | ref-evals-fixture#n2514@v1:sha256:6a45601a3dfa6544d9d24b431ead59db2e530db2158f2f706242f30119a20ec8 "One eval fixture format for every role-behavior and skill-trigger eval" | comply |
| ref-plugin-layout | The drift counter lands under plugins/tribe/scripts/ways-of-work/, inside the standard plugin shape | ref-plugin-layout#n2524@v1:sha256:0282b30a709a0e5b9670cb9130590099375ad4cef2a91521813a7427c3b46c8b "Standardize the directory shape of every plugin" | comply |
| ref-docs-lifecycle | The card's spec, plan and ratchet evidence land under docs/superpowers/ | ref-docs-lifecycle#n2504@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-bash-strict-mode | test-ways-of-work-plans.sh is a new shell script; validate-plan.sh and install.sh change | rule-bash-strict-mode#n2533@v1:sha256:18b71fb29fad608a0bc7d57da5c807b50c9aafcc827cda25f43fa49e03fbb745 "Every shell script in the repo fails fast and loud" | comply |
| rule-marketplace-registration | No plugin is added or removed | rule-marketplace-registration#n2607@v1:sha256:e2cde94bfc6a62a4c1b79caf53a11a2bc563c82338b88e7cb3c80bf00a936899 "Every plugin that exists in the tree is discoverable and installable" | N.A - no plugin registration change |
| rule-sessions-start-in-target-repo | No session-spawning code changes; the runner, watchdog and supervisor are untouched | rule-sessions-start-in-target-repo#n2682@v1:sha256:cb99b70f92847ea958cc95b99e86f09c6b1c7f40fdcd90cf4fabcc6224e7cf4d "Every session the tribe spawns starts in the target repo" | N.A - no session-spawn change |
| rule-no-squash-merge | Every mode's block merges with gh pr merge --merge, and this card's PR merges as a regular 2-parent merge | rule-no-squash-merge#n2622@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request" | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| plugins/tribe/agents/shaman.md | The "Ways of work" section; Mode 1 steps 3–6, its execution section and its definition of done point to it; anti-goals 1–2 and the frontmatter description carry the single-agent exception (D2) | tribe evals 56–63 |
| plugins/tribe/scripts/validate-plan.sh | tribe value, Hunter line only for tribe, runner Done mirror, mode block copy, final review task | plugins/tribe/scripts/tests/test-validate-plan.sh, plugins/tribe/scripts/tests/test-ways-of-work-plans.sh |
| plugins/tribe/scripts/ways-of-work/ | The drift counter, pure core plus a thin git-reading edge | plugins/tribe/scripts/ways-of-work/drift.test.ts |
| plugins/tribe/agents/warchief.md, skills/orchestrate-campaign/SKILL.md, scripts/runner/README.md, plugins/tribe/README.md | Point to the section; the campaign's tribe additions keep only campaign mechanics | the drift counter lists none of them |
| plugins/tribe/claude-md/shaman-brainstorm-together.md, plugins/tribe/install.sh | The snippet points to the section; the hook refreshes an installed snippet section in place with a backup | plugins/tribe/scripts/tests/test-install-hook.sh |
| .c3/c3-2-plugins/c3-215-tribe.md | Twelve rows replaced and two rows added, as the follow-up issue lists; five placeholder words reworded so c3x's canvas check passes | bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . prints ways-of-work definitions: 1 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-215 table rows | Row text only; no c3x command, validator, hint or schema changes | the drift counter prints ways-of-work definitions: 1 and c3x check reports no error beyond the historical broken seals |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| plugins/tribe/scripts/ways-of-work/drift.ts | Lists every live file that states a way-of-work rule; the target is exactly one place, the canonical section | docs/superpowers/evidence/2026-09-29-ways-of-work-drift-baseline.txt |
| plugins/tribe/scripts/validate-plan.sh | Fails a plan whose mode, block copy, Done sections or final review task are missing | plugins/tribe/scripts/tests/test-validate-plan.sh |
| plugins/tribe/scripts/tests/test-ways-of-work-plans.sh | Runs one plan per mode, and its mutants, through validate-plan.sh and the runner's --dry-run | V-WOW=PASS |
| plugins/tribe/evals/evals.json | Evals 56–63 grade the Shaman choosing the mode and executing each one | scripts/evals/run_evals.py output recorded in the PR |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Define the modes in a new shared document outside shaman.md | The owner ruled D1: the Shaman decides the mode, so its own file holds the definition |
| Teach the runner to read Verify blocks instead of Done sections | The runner, watchdog and supervisor are outside this card's fence; the validator mirrors the runner instead |
| A new plan key for the mode | Ruling D5 keeps the Executor key; existing plans stay valid |
| Leave c3-215 stale | The drift counter keeps listing c3-215, so the one-definition goal is never met |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| validate-plan.sh accepts a plan the runner refuses | The Done check mirrors plan-index.ts rule for rule and names the runner's own problems | test-ways-of-work-plans.sh runs every fixture through both gates |
| The install hook overwrites an owner's hand edit of a snippet section | The previous CLAUDE.md is kept as CLAUDE.md.bak.<epoch> and the hook prints a warning naming it | test-install-hook.sh refresh cases |
| The Shaman over-uses the tribe | The rubric names tribe's signals, the tie-break prefers the lighter mode, and evals 57–58 pin the light picks | tribe evals 57–59 |

## Verification

| Check | Result |
| --- | --- |
| bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . | ways-of-work definitions: 1 |
| c3x check | only the historical BROKEN_SEAL changes/ lines that master already reports |
| git status --short .c3/changes | empty: no historical change file deleted |
```

## 6. The `c3-215` row replacements (file `.c3/c3-2-plugins/c3-215-tribe.md`)

Each row is one line of a Markdown table. Old text is exactly as on `master`; new text is final
(it avoids the placeholder words of D3 and every drift-counter signal). Rows R1–R14:

#### R1. Business Flow — replace the row `Unattended path`

Old (exactly as on master):

```text
| Unattended path | One owner directive ("orchestration: do these N ideas") and then no owner intervention until one report. orchestrate-campaign assumes the campaign's decision authority → Stage A authors the specs, plans and campaign state (in the plan style the owner names — simple by default, Tribe only when asked; the plan, not the runner, decides the way of working), landing them as a docs PR → bun run.ts supervise drives judgment as a zero-token loop over a pure decide() table, never a held-open session: on a typed disk fact that positively establishes judgment is required (an escalation, or a done campaign) it spawns exactly one bounded, least-privilege one-shot session (ruling or closing; the supervisor does no ratification), verifies its work against disk postconditions — never the session's own claim — then lets it die; the campaign runner underneath still loops at zero token cost, verifying each card mechanically, and on an escalation PARKS that card and continues to the next progressable one (a dependent of a parked card is blocked, never started) → the supervisor's own bounded round/spawn budget replaces the orchestrator's held-open, capped re-trigger loop; an optional "doorbell" session may watch and relay the final report but never rules on its own authority → ONE consolidated report: every card either shipped (PR and merge sha, independently re-verified rather than agent-claimed) or blocked (the question, and why it needs the owner, in NEEDS_OWNER.md). The sole designed interruption stays an irreversible decision — data shapes, product promises, new permissions, privacy — which parks for the owner (exit 20) rather than being ruled on by any session | N.A - see plugins/tribe/skills/orchestrate-campaign/SKILL.md, docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md |
```

New:

```text
| Unattended path | One owner directive ("orchestration: do these N ideas") — or the owner's approval of a Mode 1 card, which the Shaman runs as a one-card campaign — and then no owner intervention until one report. orchestrate-campaign assumes the campaign's decision authority → Stage A authors the specs, plans and campaign state (each card in the way of work the campaign's Shaman authority chose by the rubric in agents/shaman.md "Ways of work"; the plan, not the runner, decides the way of working), landing them as a docs PR → bun run.ts supervise drives judgment as a zero-token loop over a pure decide() table, never a held-open session: on a typed disk fact that positively establishes judgment is required (an escalation, or a done campaign) it spawns exactly one bounded, least-privilege one-shot session (ruling or closing; the supervisor does no ratification), verifies its work against disk postconditions — never the session's own claim — then lets it die; the campaign runner underneath still loops at zero token cost, verifying each card mechanically, and on an escalation PARKS that card and continues to the next progressable one (a dependent of a parked card is blocked, never started) → the supervisor's own bounded round/spawn budget replaces the orchestrator's held-open, capped re-trigger loop; an opt-in "doorbell" session may watch and relay the final report but never rules on its own authority → ONE consolidated report: every card either shipped (PR and merge sha, independently re-verified rather than agent-claimed) or blocked (the question, and why it needs the owner, in NEEDS_OWNER.md). The sole designed interruption stays an irreversible decision — data shapes, product promises, new permissions, privacy — which parks for the owner (exit 20) rather than being ruled on by any session | N.A - see plugins/tribe/skills/orchestrate-campaign/SKILL.md, docs/superpowers/specs/2026-09-18-campaign-supervisor-design.md |
```

#### R2. Contract — replace the row `Owner → Shaman dispatch`

Old (exactly as on master):

```text
| Owner → Shaman dispatch | IN | Single entry point for all feature work; owner never briefs Warchief/Hunter directly. Three modes: brainstorm together (Mode 1, the default — one problem to ratified decisions recorded in the idea card, a planning-only Warchief spec + plan reviewed by grounding, then the owner's new execution session briefed and guided by the Shaman via SendMessage; that execution follows the way of work the plan declares and never the tribe's delivery loop — full-build Warchief, Hunter, Skinner, Tracker, Scout, mammoth-hunt, orchestrate-campaign — unless the owner explicitly asks), forge a roadmap (Mode 2), and run a campaign (Mode 3) | agent invocation | agents/shaman.md |
```

New:

```text
| Owner → Shaman dispatch | IN | Single entry point for all feature work; owner never briefs Warchief/Hunter directly. Three modes: brainstorm together (Mode 1, the default — one problem to ratified decisions recorded in the idea card, a planning-only Warchief spec + plan reviewed by grounding, then the Shaman runs the approved card itself through the orchestrate-campaign harness — a one-card campaign, the default for every way of work; its one exception is written in the "Ways of work" section of agents/shaman.md), forge a roadmap (Mode 2), and run a campaign (Mode 3). The campaign harness, the three ways of work (single-agent, subagent-per-task, tribe), the rubric for choosing one, who chooses and who executes on each path are defined once, in the "Ways of work" section of agents/shaman.md; every other file points there. The two light modes end in a final review task; every review round is recorded in the PR body's ## Final review section, which the Shaman's SHIPPED gate checks | agent invocation | agents/shaman.md |
```

#### R3. Contract — replace the row `scripts/validate-plan.sh`

Old (exactly as on master):

```text
| scripts/validate-plan.sh | IN | Plan structure validated before Hunters are dispatched | shell script + tests | plugins/tribe/scripts/tests/test-validate-plan.sh |
```

New:

```text
| scripts/validate-plan.sh | IN | Plan structure validated before execution: task sections, a Verify block and a Done section per task (the Done section read exactly as the campaign runner reads it), one Commit step per task, the declared Executor mode with its block copied verbatim from agents/shaman.md "Ways of work", a final review task ending either light mode's plan, and the Hunter implementer line for a tribe plan; a declared mode whose block cannot be read is a setup error (exit 2) | shell script + tests | plugins/tribe/scripts/tests/test-validate-plan.sh; plugins/tribe/scripts/tests/test-ways-of-work-plans.sh |
```

#### R4. Contract — replace the row `Global CLAUDE.md append`

Old (exactly as on master):

```text
| Global CLAUDE.md append | OUT | Install hook appends each claude-md/*.md snippet idempotently, keyed on the snippet's first line and refusing when any of its headings already exists in the target: global-rules.md — the owner's consolidated global standing rules, the authored source of the global CLAUDE.md content — and shaman-brainstorm-together.md, the short form of the Shaman's Mode 1 (its default mode) so any session in any project (including a main chat playing the Shaman without loading agents/shaman.md) runs the owner's brainstorm-together protocol. A snippet added later reaches an already-installed machine only because its first line and headings are new, so each snippet carries its own unique top heading | user's global config | install.sh + claude-md/; plugins/tribe/scripts/tests/test-install-hook.sh |
```

New:

```text
| Global CLAUDE.md append | OUT | Install hook appends each claude-md/*.md snippet once, keyed on the snippet's first line, and refuses when any of its headings already exists in the target under a different first line. When the first line is present, the installed section (up to the first heading at its level or above that the snippet does not own) is compared with the snippet: equal, nothing changes; different, the whole CLAUDE.md is copied to CLAUDE.md.bak.<epoch>, the section is replaced by the snippet, and a warning names the backup — so a reworded snippet reaches every installed machine. Snippets: global-rules.md — the owner's consolidated global standing rules; goal-verify-ratchet.md; and shaman-brainstorm-together.md, the short form of the Shaman's Mode 1, which points to agents/shaman.md "Ways of work" for the ways of work. Each snippet carries its own unique top heading | user's global config | install.sh + claude-md/; plugins/tribe/scripts/tests/test-install-hook.sh |
```

#### R5. Contract — replace the row `scripts/runner/run.ts (campaign runner)`

Old (exactly as on master):

```text
| scripts/runner/run.ts (campaign runner) | IN | Stateless CLI capability: every environment value is an input (--repo, --model, --home, --logs-dir, --session-timeout, --dry-run, --cards, --max-cards, --include-escalated, --remote, --viewer-port, --no-viewer). --repo, --model and --home are the only required flags (no default); --state, --answers and --escalations-dir were deleted as flags — with one campaign per --home, every operational artifact (campaign-state.json, answers.md, escalations/<id>.md) resolves to a fixed name under it via core/paths.ts, so --home alone carries the environment-specific part and an unknown flag (including these three) is rejected by name. --home is the campaign's machine-local operational home under which every non-dry-run invocation writes an atomic run.json record (runId, pid, startedAt, statePath/answersPath/escalationsDir absolute, logsDir, argv, endedAt/exitCode/reason null until finalized) right after the lock is acquired, and finalizes on every exit path that also writes campaign-report.json; --logs-dir now defaults to <home>/runs/<run-id>/logs/. Before the first card's session spawns on a real run, it also starts (or reuses) the read-only viewer (scripts/viewer/serve.ts, one surface, D9) on --viewer-port (default 4321, 1-65535), printing the root URL once (http://127.0.0.1:<port>/?campaign=<repoKey>/<slug>) and a per-card session URL the instant the SDK assigns that card's session id (http://127.0.0.1:<port>/s/<sessionId>), unless --no-viewer is passed or the run is --dry-run. An observable viewer failure (missing entry file, the --no-viewer/--dry-run skip, a thrown launch-path error, or a spawn error event) prints one stderr line and the run proceeds; the port-unavailable case (a detached, stdio-ignored child that starts and then dies to EADDRINUSE) is invisible to the runner — the URL was already printed on stdout and simply will not answer, so the reader's check is to open it or re-run with a different --viewer-port. Either way the campaign run itself is never gated on the viewer. Reads campaign-state.json v2 only: every card carries a required task index (cards.<id>.tasks — {id, heading} pointers to plan headings, id grammar ^[A-Za-z0-9][A-Za-z0-9._-]*$, unique per card; runner-written tasks[i].passedSha and doneSha); a v1 state is refused (UnsupportedStateVersionError names the re-author path), never migrated, and every task ref of every eligible card is resolved against its plan at load (core/plan-index.ts, spec §4.3 is the oracle, not CommonMark) — any failure is one collected TaskIndexError, printed as "campaign runner: refused:" with exit 4, --dry-run included, before any session spawns. The plan drives: one Agent-SDK executor session per card, driven in turns (core/loop/turns.ts#driveCardTurns; each later turn a resume of the same session, --session-timeout bounds one turn) — a task turn per task in order, then a deliver turn; the last of three terminal lines decides (TASK_DONE <task-id> <branch>, SHIPPED <pr> <sha>, NEEDS_DIRECTION:). An accepted TASK_DONE (right task, the branch exists, is the card's, descends from baseSha) triggers the runner-run Done run: the cumulative, exact-text-deduplicated Done commands of tasks 1..k, each bash -c with a 10-minute timeout in a detached scratch worktree <home>/done/<card> (containment-checked, serialized, removed afterwards) with RUNNER_CAMPAIGN_HOME/CARD_ID/TASK_ID/BASE_SHA/REPO set, recorded row by row in <home>/runs/<run-id>/done.jsonl; a pass records passedSha (and doneSha for the last task). At most 3 unaccepted turns per step (failed Done runs and protocol errors; during delivery every turn that does not end in an accepted SHIPPED, a TASK_DONE re-check included), then the card escalates done_failed. SHIPPED is accepted only at the deliver step, and the pre-merge hook denies gh pr merge unless checks are green and the PR head is doneSha. The done check (core/verify.ts#verifyShipped) is generic: seven D3 points — merged, mergeShaAncestorOfMaster, checksGreen, worktreeAndBranchGone, schemaGuard, D4's localBaseSynced (the runner's own --repo base checkout contains the merge and is not ahead of the remote) and doneAtHead (the merged head is doneSha) — with a fast-forward heal of that checkout only when core/residue.ts#decideBaseSyncHeal proves it loses nothing; it never checks a gap-gate stamp or a ledger commit (a plan that wants the harness-gap gate runs it as a task's Done command). The executor session loads only the owner's three settings tiers (user, project, local) and no plugin of the runner's own. The runner makes no git commits of its own — no state is ever committed; the only in-repo trace of a campaign's commits is the Campaign: <slug> trailer the executor session is instructed to add to its own card-PR commits (git log --grep recovers them). D5′ park-and-continue: an escalation writes the escalation file, parks the card, and the pass CONTINUES to the next progressable card — exit 2 means "the pass finished, at least one escalation is pending", never "aborted at the first question"; a card declaring dependsOn a parked card becomes blocked (derived, reconciled to a fixpoint, never hand-authored). Report contract: campaign-report.json plus its .md twin are written under --home on every real exit path — but never on --dry-run (zero side effects is a hard contract) and never on a refused start (another live process owns the campaign). The exit code is a hint; the report is the truth. Zero LLM calls in the loop itself; operational state lives under --home, never in the target repo — only specs and plans stay committed there | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/runner/run.test.ts |
```

New:

```text
| scripts/runner/run.ts (campaign runner) | IN | Stateless CLI capability: every environment value is an input (--repo, --model, --home, --logs-dir, --session-timeout, --dry-run, --cards, --max-cards, --include-escalated, --remote, --viewer-port, --no-viewer). --repo, --model and --home are the only required flags (no default); --state, --answers and --escalations-dir were deleted as flags — with one campaign per --home, every operational artifact (campaign-state.json, answers.md, escalations/<id>.md) resolves to a fixed name under it via core/paths.ts, so --home alone carries the environment-specific part and an unknown flag (including these three) is rejected by name. --home is the campaign's machine-local operational home under which every non-dry-run invocation writes an atomic run.json record (runId, pid, startedAt, statePath/answersPath/escalationsDir absolute, logsDir, argv, endedAt/exitCode/reason null until finalized) right after the lock is acquired, and finalizes on every exit path that also writes campaign-report.json; --logs-dir now defaults to <home>/runs/<run-id>/logs/. Before the first card's session spawns on a real run, it also starts (or reuses) the read-only viewer (scripts/viewer/serve.ts, one surface, D9) on --viewer-port (default 4321, 1-65535), printing the root URL once (http://127.0.0.1:<port>/?campaign=<repoKey>/<slug>) and a per-card session URL the instant the SDK assigns that card's session id (http://127.0.0.1:<port>/s/<sessionId>), unless --no-viewer is passed or the run is --dry-run. An observable viewer failure (missing entry file, the --no-viewer/--dry-run skip, a thrown launch-path error, or a spawn error event) prints one stderr line and the run proceeds; the port-unavailable case (a detached, stdio-ignored child that starts and then dies to EADDRINUSE) is invisible to the runner — the URL was already printed on stdout and simply will not answer, so the reader's check is to open it or re-run with a different --viewer-port. Either way the campaign run itself is never gated on the viewer. Reads campaign-state.json v2 only: every card carries a required task index (cards.<id>.tasks — {id, heading} pointers to plan headings, id grammar ^[A-Za-z0-9][A-Za-z0-9._-]*$, unique per card; runner-written tasks[i].passedSha and doneSha); a v1 state is refused (UnsupportedStateVersionError names the re-author path), never migrated, and every task ref of every eligible card is resolved against its plan at load (core/plan-index.ts, spec §4.3 is the oracle, not CommonMark) — any failure is one collected TaskIndexError, printed as "campaign runner: refused:" with exit 4, --dry-run included, before any session spawns. The plan drives: one Agent-SDK executor session per card, driven in turns (core/loop/turns.ts#driveCardTurns; each subsequent turn a resume of the same session, --session-timeout bounds one turn) — a task turn per task in order, then a deliver turn; the last of three terminal lines decides (TASK_DONE <task-id> <branch>, SHIPPED <pr> <sha>, NEEDS_DIRECTION:). An accepted TASK_DONE (right task, the branch exists, is the card's, descends from baseSha) triggers the runner-run Done run: the cumulative, exact-text-deduplicated Done commands of tasks 1..k, each bash -c with a 10-minute timeout in a detached scratch worktree <home>/done/<card> (containment-checked, serialized, removed afterwards) with RUNNER_CAMPAIGN_HOME/CARD_ID/TASK_ID/BASE_SHA/REPO set, recorded row by row in <home>/runs/<run-id>/done.jsonl; a pass records passedSha (and doneSha for the last task). At most 3 unaccepted turns per step (failed Done runs and protocol errors; during delivery every turn that does not end in an accepted SHIPPED, a TASK_DONE re-check included), then the card escalates done_failed. SHIPPED is accepted only at the deliver step, and the pre-merge hook denies gh pr merge unless checks are green and the PR head is doneSha. The done check (core/verify.ts#verifyShipped) is generic: seven D3 points — merged, mergeShaAncestorOfMaster, checksGreen, worktreeAndBranchGone, schemaGuard, D4's localBaseSynced (the runner's own --repo base checkout contains the merge and is not ahead of the remote) and doneAtHead (the merged head is doneSha) — with a fast-forward heal of that checkout only when core/residue.ts#decideBaseSyncHeal proves it loses nothing; it never checks a gap-gate stamp or a ledger commit (a plan that wants the harness-gap gate runs it as a task's Done command). The executor session loads only the owner's three settings tiers (user, project, local) and no plugin of the runner's own. The runner makes no git commits of its own — no state is ever committed; the only in-repo trace of a campaign's commits is the Campaign: <slug> trailer the executor session is instructed to add to its own card-PR commits (git log --grep recovers them). D5′ park-and-continue: an escalation writes the escalation file, parks the card, and the pass CONTINUES to the next progressable card — exit 2 means "the pass finished, at least one escalation is pending", never "aborted at the first question"; a card declaring dependsOn a parked card becomes blocked (derived, reconciled to a fixpoint, never hand-authored). Report contract: campaign-report.json plus its .md twin are written under --home on every real exit path — but never on --dry-run (zero side effects is a hard contract) and never on a refused start (another live process owns the campaign). The exit code is a hint; the report is the truth. Zero LLM calls in the loop itself; operational state lives under --home, never in the target repo — only specs and plans stay committed there | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/runner/run.test.ts |
```

#### R6. Contract — replace the row `skills/orchestrate-campaign`

Old (exactly as on master):

```text
| skills/orchestrate-campaign | IN | The campaign's entry point, trigger word "orchestration", invocable from ANY session — main chat, a Shaman, or a Warchief already in play — which is why it is a skill rather than an agent. Assumes the campaign's decision authority (ordinary calls itself; only the owner-only register escalates): authors the campaign state file the runner requires as input (nothing else in the system creates it), runs Stage A planning per the authorship policy (author specs and plans itself for few or complex cards; dispatch one planning subagent per card for many trivial ones) and chooses the plan style — simple by default (a "How to work" section giving each task to one general-purpose subagent, every task ending in a Done section the runner runs), Tribe only when the owner asks (the "Tribe style — plan section", ending in a Harness-gap gate task whose Done runs gap-gate.ts, plus the "Tribe style — Stage C and D additions": ratified-as: rulings and a ratification pass checked by scripts/gaps/rulings-check.ts) — because the runner, watchdog and supervisor prescribe no way of working, triggers the runner in the background, reads the report contract on exit, answers within-authority escalations into the committed answers file — never the campaign's owner-only list — re-triggers at most 2 auto-answer rounds per card before parking it for the owner, and composes the ONE owner report, independently re-verifying every card the runner claims shipped. Depends on the runner's documented CLI contract only (flags, exit codes, report file), never its source modules | installed skill (symlinked into the user's config); resolves the runner from the plugin root, never from the shell's cwd | plugins/tribe/skills/orchestrate-campaign/SKILL.md |
```

New:

```text
| skills/orchestrate-campaign | IN | The campaign's entry point, trigger word "orchestration", invocable from ANY session — main chat, a Shaman, or a Warchief already in play — which is why it is a skill rather than an agent. It is the campaign harness every approved plan runs through by default (agents/shaman.md "Ways of work"), a one-card campaign included: a Shaman runs it on a Mode 1 card once the owner approves, and Stage A then skips authorship — it lands the approved spec and plan, writes the state, dry-runs and launches. Assumes the campaign's decision authority (ordinary calls itself; only the owner-only register escalates): authors the campaign state file the runner requires as input (nothing else in the system creates it), runs Stage A planning per the authorship policy (author specs and plans itself for few or complex cards; dispatch one planning subagent per card for many trivial ones) and chooses each card's way of work by the rubric in agents/shaman.md "Ways of work" — every plan copies that mode's block, and every task ends in a Done section the runner runs; a tribe card's plan also carries the "tribe cards — campaign plan additions", ending in a Harness-gap gate task whose Done runs gap-gate.ts, and a campaign holding a tribe card runs the "tribe cards — Stage C and D additions" (ratified-as: rulings and a ratification pass checked by scripts/gaps/rulings-check.ts) — because the runner, watchdog and supervisor prescribe no way of working, triggers the runner in the background, reads the report contract on exit, answers within-authority escalations into the committed answers file — never the campaign's owner-only list — re-triggers at most 2 auto-answer rounds per card before parking it for the owner, and composes the ONE owner report, independently re-verifying every card the runner claims shipped (verify-shipped, and for a single-agent or subagent-per-task card its PR body's ## Final review section, which must end REVIEW: PASS). Depends on the runner's documented CLI contract only (flags, exit codes, report file), never its source modules | installed skill (symlinked into the user's config); resolves the runner from the plugin root, never from the shell's cwd | plugins/tribe/skills/orchestrate-campaign/SKILL.md |
```

#### R7. Contract — replace the row `scripts/viewer/serve.ts (campaign viewer)`

Old (exactly as on master):

```text
| scripts/viewer/serve.ts (campaign viewer) | IN | Read-only, single-surface local HTTP server over ~/.claude/projects (every Claude Code session transcript on the machine), zero writes of any kind anywhere (no lock, no state, no gh/git), binds 127.0.0.1 by default. --port (default 4321, validated 1-65535 — --port abc/--port 0/--port 70000 and an unknown flag all refuse with one stderr line and exit 2) and --host (default 127.0.0.1) are the only flags. --host 0.0.0.0 (what tribe --remote passes, kanna's behaviour, owner-chosen) opens the viewer to every device on the local network with no password, printing each http://<LAN-IP>:<port> URL and a no-password warning; a --host that is not 0.0.0.0, localhost/127.0.0.1, or one of this machine's own IPv4 addresses (IPv6 included) refuses with one stderr line and exit 2 before binding, because Bun reports such a bind as EADDRINUSE; --tribe-root is gone — both the projects root (CLAUDE_CONFIG_DIR/projects when set and non-empty, else $HOME/.claude/projects, D32a) and the tribe root ($HOME/.tribe) are resolved from HOME/CLAUDE_CONFIG_DIR alone, printed on the startup line, and a CLAUDE_CONFIG_DIR naming an unreadable path is a typed refusal, never a silent fall back. Routes: GET /, /index.html, /p/<projectDir>, /s/<sessionId> and /s/<sessionId>/a/<agentId> all serve the same built dist/index.html SPA shell (the React router owns those addresses); GET /healthz returns {"ok":true,"viewer":"tribe-viewer","v":2} (deliberately not the pre-consolidation v1 body, so a stale long-lived process is unrecognisable to the runner's reuse probe); GET /assets/<name> serves a fixed dist/ allowlist loaded into memory once at boot; GET /api/projects[?all=1], /api/sessions?project=, /api/session/<id> return session/project metadata plus badges; GET /api/rows?session=&agent=&before=&limit=&orphans=, GET /api/block?...&at=&i= and GET /api/spill?...&name= serve transcript content, elided blocks and persisted tool output, every path containment-checked (lexical then resolved, D14) before it is opened; GET /events?session=&agent= is one Server-Sent-Events stream per open session view (hello/rows/patch/meta/reset/ping/gone frames, a fresh generation per connection, 250ms poll, capped at 8 concurrent streams with a 503 on the 9th); anything else is a JSON 404. Every request is gated on Host/Origin (DNS-rebinding defense, 403 otherwise, core/net.ts#hostHeaderAllowed): 127.0.0.1/localhost only on the loopback bind; on a network bind also any IPv4 literal and any .local name, while any other DNS name stays refused; every response carries X-Content-Type-Options: nosniff, and the HTML document responses (the SPA shell) additionally carry a CSP. Campaign badges come from exactly two files under ~/.tribe (campaign-state.json, run.json) via adapters/campaign.adapter.ts; every transcript read (stat, readdir, ranged read, realpath) goes through adapters/fs.adapter.ts; adapters/poller.adapter.ts is the sole clock owner. All decision logic — path containment, the window/tail state machines, JSONL parsing, markdown tokenizing, row-to-node normalization and tool-call/result pairing, title/liveness/subagent derivation, badge selection, URL routing and SSE frame encoding — lives entirely in pure core/.ts modules (paths.ts, window.ts, tail.ts, records.ts, markdown.ts, normalize.ts, pair.ts, title.ts, liveness.ts, subagents.ts, badge.ts, routes.ts, sse.ts, cache.ts, scan.ts), never in the two adapters or serve.ts itself, which is the composition root and the only file reading process.env/process.argv. The server serves whatever static bundle sits in dist/ (git-ignored, read into memory once at boot; its absence is a fail-closed startup error, one stderr line, exit 2) — the client toolchain (React 19 + Vite) and the build that emits dist/ are landed by a later consolidation task (task 26), so this phase serves the dist/ bundle as it stands without asserting how it was built | bun HTTP server, repo-invoked (never installed) | plugins/tribe/scripts/viewer/serve.security.test.ts, plugins/tribe/scripts/viewer/serve.api.test.ts, plugins/tribe/scripts/viewer/serve.reads.test.ts, plugins/tribe/scripts/viewer/serve.events.test.ts, plugins/tribe/scripts/viewer/structure.test.ts |
```

New:

```text
| scripts/viewer/serve.ts (campaign viewer) | IN | Read-only, single-surface local HTTP server over ~/.claude/projects (every Claude Code session transcript on the machine), zero writes of any kind anywhere (no lock, no state, no gh/git), binds 127.0.0.1 by default. --port (default 4321, validated 1-65535 — --port abc/--port 0/--port 70000 and an unknown flag all refuse with one stderr line and exit 2) and --host (default 127.0.0.1) are the only flags. --host 0.0.0.0 (what tribe --remote passes, kanna's behaviour, owner-chosen) opens the viewer to every device on the local network with no password, printing each http://<LAN-IP>:<port> URL and a no-password warning; a --host that is not 0.0.0.0, localhost/127.0.0.1, or one of this machine's own IPv4 addresses (IPv6 included) refuses with one stderr line and exit 2 before binding, because Bun reports such a bind as EADDRINUSE; --tribe-root is gone — both the projects root (CLAUDE_CONFIG_DIR/projects when set and non-empty, else $HOME/.claude/projects, D32a) and the tribe root ($HOME/.tribe) are resolved from HOME/CLAUDE_CONFIG_DIR alone, printed on the startup line, and a CLAUDE_CONFIG_DIR naming an unreadable path is a typed refusal, never a silent fall back. Routes: GET /, /index.html, /p/<projectDir>, /s/<sessionId> and /s/<sessionId>/a/<agentId> all serve the same built dist/index.html SPA shell (the React router owns those addresses); GET /healthz returns {"ok":true,"viewer":"tribe-viewer","v":2} (deliberately not the pre-consolidation v1 body, so a stale long-lived process is unrecognisable to the runner's reuse probe); GET /assets/<name> serves a fixed dist/ allowlist loaded into memory once at boot; GET /api/projects[?all=1], /api/sessions?project=, /api/session/<id> return session/project metadata plus badges; GET /api/rows?session=&agent=&before=&limit=&orphans=, GET /api/block?...&at=&i= and GET /api/spill?...&name= serve transcript content, elided blocks and persisted tool output, every path containment-checked (lexical then resolved, D14) before it is opened; GET /events?session=&agent= is one Server-Sent-Events stream per open session view (hello/rows/patch/meta/reset/ping/gone frames, a fresh generation per connection, 250ms poll, capped at 8 concurrent streams with a 503 on the 9th); anything else is a JSON 404. Every request is gated on Host/Origin (DNS-rebinding defense, 403 otherwise, core/net.ts#hostHeaderAllowed): 127.0.0.1/localhost only on the loopback bind; on a network bind also any IPv4 literal and any .local name, while any other DNS name stays refused; every response carries X-Content-Type-Options: nosniff, and the HTML document responses (the SPA shell) additionally carry a CSP. Campaign badges come from exactly two files under ~/.tribe (campaign-state.json, run.json) via adapters/campaign.adapter.ts; every transcript read (stat, readdir, ranged read, realpath) goes through adapters/fs.adapter.ts; adapters/poller.adapter.ts is the sole clock owner. All decision logic — path containment, the window/tail state machines, JSONL parsing, markdown tokenizing, row-to-node normalization and tool-call/result pairing, title/liveness/subagent derivation, badge selection, URL routing and SSE frame encoding — lives entirely in pure core/.ts modules (paths.ts, window.ts, tail.ts, records.ts, markdown.ts, normalize.ts, pair.ts, title.ts, liveness.ts, subagents.ts, badge.ts, routes.ts, sse.ts, cache.ts, scan.ts), never in the two adapters or serve.ts itself, which is the composition root and the only file reading process.env/process.argv. The server serves whatever static bundle sits in dist/ (git-ignored, read into memory once at boot; its absence is a fail-closed startup error, one stderr line, exit 2) — the client toolchain (React 19 + Vite) and the build that emits dist/ are landed by a subsequent consolidation task (task 26), so this phase serves the dist/ bundle as it stands without asserting how it was built | bun HTTP server, repo-invoked (never installed) | plugins/tribe/scripts/viewer/serve.security.test.ts, plugins/tribe/scripts/viewer/serve.api.test.ts, plugins/tribe/scripts/viewer/serve.reads.test.ts, plugins/tribe/scripts/viewer/serve.events.test.ts, plugins/tribe/scripts/viewer/structure.test.ts |
```

#### R8. Contract — replace the row `scripts/runner/run.ts watchdog`

Old (exactly as on master):

```text
| scripts/runner/run.ts watchdog | IN | A subcommand of the existing runner CLI (no new resolver, no new installable): --repo, --model, --home required (no defaults) plus pass-through of the runner's optional flags (--cards, --max-cards, --include-escalated, --session-timeout, --logs-dir, --max-concurrent, --remote) and its own — --follow / --once (default --follow), --stall-minutes (default 30), --max-quota-waits (default 6), --max-crash-relaunches (default 1), --poll-seconds (default 30), --quota-grace-seconds (default 30), --max-overload-backoffs (default 5); --dry-run is rejected. Each tick is a pure decide(observation) -> action over a frozen table — launch / attach / wait_until(resetsAt) / relaunch / stall / exit(done) / exit(needs_human:<reason>) / exit(running) — driven by the run record, the session log tail, the clock and its own counters; a live runner at start is adopted, never double-launched (D74-7), and every wait is capped (quota/crash/overload) so the watchdog itself never kills the runner or a session. The stall verdict only ever concerns the run THIS invocation is supervising right now: while it owns a live child, every run id present on disk at the instant before that spawn is excluded by IDENTITY (set difference, never ordering, so a non-monotonic clock cannot mislead it), because a freshly-spawned runner needs real wall-clock time (63-170 ms measured across three recorded field sequences) to create its own runs/<run-id>/ directory and until then the newest directory on disk is still the PREVIOUS run's. A run directory that predates the current spawn is therefore never the supervised run: its log is neither read nor judged, and status.json.runId reports null rather than naming that earlier run until the current run's own directory appears. Nothing is suppressed — the just-spawned run is bounded by the existing --stall-minutes (no new flag), measured from its own last log line or, when it has never written one, from its own launch. Writes only <home>/watchdog/status.json (current state, rewritten atomically) and <home>/watchdog/events.jsonl (append-only). Exit codes: 0 done, 10 needs_human (reason in status.json), 11 running (--once only), 1 usage error, including a typed refusal when --home realpaths outside $HOME/.tribe | bun CLI subcommand, repo-invoked (never installed) | plugins/tribe/scripts/tests/test-watchdog-e2e.sh, plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh |
```

New:

```text
| scripts/runner/run.ts watchdog | IN | A subcommand of the existing runner CLI (no new resolver, no new installable): --repo, --model, --home required (no defaults) plus pass-through of the runner's non-required flags (--cards, --max-cards, --include-escalated, --session-timeout, --logs-dir, --max-concurrent, --remote) and its own — --follow / --once (default --follow), --stall-minutes (default 30), --max-quota-waits (default 6), --max-crash-relaunches (default 1), --poll-seconds (default 30), --quota-grace-seconds (default 30), --max-overload-backoffs (default 5); --dry-run is rejected. Each tick is a pure decide(observation) -> action over a frozen table — launch / attach / wait_until(resetsAt) / relaunch / stall / exit(done) / exit(needs_human:<reason>) / exit(running) — driven by the run record, the session log tail, the clock and its own counters; a live runner at start is adopted, never double-launched (D74-7), and every wait is capped (quota/crash/overload) so the watchdog itself never kills the runner or a session. The stall verdict only ever concerns the run THIS invocation is supervising right now: while it owns a live child, every run id present on disk at the instant before that spawn is excluded by IDENTITY (set difference, never ordering, so a non-monotonic clock cannot mislead it), because a freshly-spawned runner needs real wall-clock time (63-170 ms measured across three recorded field sequences) to create its own runs/<run-id>/ directory and until then the newest directory on disk is still the PREVIOUS run's. A run directory that predates the current spawn is therefore never the supervised run: its log is neither read nor judged, and status.json.runId reports null rather than naming that earlier run until the current run's own directory appears. Nothing is suppressed — the just-spawned run is bounded by the existing --stall-minutes (no new flag), measured from its own last log line or, when it has never written one, from its own launch. Writes only <home>/watchdog/status.json (current state, rewritten atomically) and <home>/watchdog/events.jsonl (append-only). Exit codes: 0 done, 10 needs_human (reason in status.json), 11 running (--once only), 1 usage error, including a typed refusal when --home realpaths outside $HOME/.tribe | bun CLI subcommand, repo-invoked (never installed) | plugins/tribe/scripts/tests/test-watchdog-e2e.sh, plugins/tribe/scripts/tests/test-watchdog-stall-relaunch.sh |
```

#### R9. Contract — insert a new row `scripts/ways-of-work/drift.ts (ways-of-work drift counter)` directly after the row `scripts/ratchet-check.ts (context-budget ratchet gate)`

New:

```text
| scripts/ways-of-work/drift.ts (ways-of-work drift counter) | IN | bun drift.ts --repo <dir> [--also <file>]... [--json] [--verbose] lists every place that states a way-of-work rule: the "Ways of work" section of agents/shaman.md is one place, and every tracked file outside a fixed allowlist (history, evidence, eval rubrics, the counter's own signals and fixtures) with a line matching a rule signal (the task and line limits, the fix-round cap, the implementer shape, the retired owner-must-ask rule and plan styles, the rubric's own wording) is another; --also adds a file outside the repo, such as the installed ~/.claude/CLAUDE.md. A measurement, not a gate: exit 0 whatever it counts, exit 2 on a usage error, a failed git ls-files or an unreadable --also file. The pure core (drift-core.ts) decides; drift.ts only lists and reads files | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/ways-of-work/drift.test.ts |
```

#### R10. Contract — replace the row `scripts/gaps/rulings-check.ts (ratification check)`

Old (exactly as on master):

```text
| scripts/gaps/rulings-check.ts (ratification check) | IN | The Tribe-side ratification check for a campaign's answers.md, moved out of the campaign runner (runner-driver-only D3/D6: the runner, watchdog and supervisor require no ratification, and the runner never exits 5). bun rulings-check.ts <answers.md>: exit 0 when every ## ruling block carries a recognised ratified-as: value (rule <path> / debt <id> / roadmap <ref> / operational / dismissed, optionally suffixed (G-NNN); pending and any other value stay unratified — strict by design) or there are none, exit 1 printing one unratified ruling id per line, exit 2 on a missing argument or an unreadable file (one typed stderr line, never a stack trace). Parsing reuses the runner's pure core/rulings.ts#parseRulings — the Tribe side depends on the runner, never the reverse. A Tribe-style plan (orchestrate-campaign's "Tribe style — Stage C and D additions") runs it as a Done command | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/gaps/rulings-check.test.ts |
```

New:

```text
| scripts/gaps/rulings-check.ts (ratification check) | IN | The Tribe-side ratification check for a campaign's answers.md, moved out of the campaign runner (runner-driver-only D3/D6: the runner, watchdog and supervisor require no ratification, and the runner never exits 5). bun rulings-check.ts <answers.md>: exit 0 when every ## ruling block carries a recognised ratified-as: value (rule <path> / debt <id> / roadmap <ref> / operational / dismissed, optionally suffixed (G-NNN); pending and any other value stay unratified — strict by design) or there are none, exit 1 printing one unratified ruling id per line, exit 2 on a missing argument or an unreadable file (one typed stderr line, never a stack trace). Parsing reuses the runner's pure core/rulings.ts#parseRulings — the Tribe side depends on the runner, never the reverse. A campaign holding a tribe card runs it (orchestrate-campaign's "tribe cards — Stage C and D additions") | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/gaps/rulings-check.test.ts |
```

#### R11. Change Safety — replace the row `Plan validation regression`

Old (exactly as on master):

```text
| Plan validation regression | Editing validate-plan.sh | Malformed plans reach Hunters | plugins/tribe/scripts/tests/test-validate-plan.sh |
```

New:

```text
| Plan validation regression | Editing validate-plan.sh, or a block in agents/shaman.md "Ways of work" | Malformed plans reach an executor, or a plan the validator passes is refused by the campaign runner | plugins/tribe/scripts/tests/test-validate-plan.sh; plugins/tribe/scripts/tests/test-ways-of-work-plans.sh |
```

#### R12. Change Safety — insert a new row `A way of work defined in two places` directly after the row `Plan validation regression`

New:

```text
| A way of work defined in two places | Editing any file that describes how a plan is executed | The drift counter lists a place other than the canonical section | bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . prints ways-of-work definitions: 1 |
```

#### R13. Change Safety — replace the row `Non-idempotent CLAUDE.md append`

Old (exactly as on master):

```text
| Non-idempotent CLAUDE.md append | Editing the install hook | Duplicate snippet blocks in global CLAUDE.md | Re-run ./install.sh tribe twice and diff the global CLAUDE.md |
```

New:

```text
| Non-idempotent CLAUDE.md append | Editing the install hook | Duplicate snippet blocks in global CLAUDE.md, a refresh that loses content outside its section, or a refresh with no backup | plugins/tribe/scripts/tests/test-install-hook.sh; re-run ./install.sh tribe twice and diff the global CLAUDE.md |
```

#### R14. Derived Materials — replace the row `CLAUDE.md brainstorm-together snippet`

Old (exactly as on master):

```text
| CLAUDE.md brainstorm-together snippet | agents/shaman.md Mode 1 (the long form) and the Contract row Global CLAUDE.md append | A one-line-per-obligation summary; it must never contradict Mode 1, which stays the single long form | plugins/tribe/claude-md/shaman-brainstorm-together.md |
```

New:

```text
| CLAUDE.md brainstorm-together snippet | agents/shaman.md Mode 1 (the long form) and the Contract row Global CLAUDE.md append | A one-line-per-obligation summary that points to the "Ways of work" section for the ways of work; it must never contradict Mode 1, which stays the single long form | plugins/tribe/claude-md/shaman-brainstorm-together.md |
```

The same changes as one script (`python3 c3-215-rows.py .c3/c3-2-plugins/c3-215-tribe.md`; it
refuses if any old text is not found exactly once):

```python
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
def rep(old, new):
    global s
    assert s.count(old) == 1, ("not unique/absent", old[:90])
    s = s.replace(old, new)
def row(first):
    lines = [l for l in s.split("\n") if l.startswith(f"| {first} |")]
    assert len(lines) == 1, first
    return lines[0]

# Contract — Owner → Shaman dispatch.
rep(row("Owner → Shaman dispatch"), """| Owner → Shaman dispatch | IN | Single entry point for all feature work; owner never briefs Warchief/Hunter directly. Three modes: brainstorm together (Mode 1, the default — one problem to ratified decisions recorded in the idea card, a planning-only Warchief spec + plan reviewed by grounding, then the Shaman runs the approved card itself through the orchestrate-campaign harness — a one-card campaign, the default for every way of work; its one exception is written in the "Ways of work" section of agents/shaman.md), forge a roadmap (Mode 2), and run a campaign (Mode 3). The campaign harness, the three ways of work (single-agent, subagent-per-task, tribe), the rubric for choosing one, who chooses and who executes on each path are defined once, in the "Ways of work" section of agents/shaman.md; every other file points there. The two light modes end in a final review task; every review round is recorded in the PR body's ## Final review section, which the Shaman's SHIPPED gate checks | agent invocation | agents/shaman.md |""")

# Contract — validate-plan.sh.
rep(row("scripts/validate-plan.sh"), """| scripts/validate-plan.sh | IN | Plan structure validated before execution: task sections, a Verify block and a Done section per task (the Done section read exactly as the campaign runner reads it), one Commit step per task, the declared Executor mode with its block copied verbatim from agents/shaman.md "Ways of work", a final review task ending either light mode's plan, and the Hunter implementer line for a tribe plan; a declared mode whose block cannot be read is a setup error (exit 2) | shell script + tests | plugins/tribe/scripts/tests/test-validate-plan.sh; plugins/tribe/scripts/tests/test-ways-of-work-plans.sh |""")

# Contract — three placeholder words c3x's canvas check rejects.
rep("each later turn a resume", "each subsequent turn a resume")
rep("landed by a later consolidation task", "landed by a subsequent consolidation task")
rep("runner's optional flags", "runner's non-required flags")

# Contract — the drift counter, a new row after the ratchet gate.
ratchet = row("scripts/ratchet-check.ts (context-budget ratchet gate)")
rep(ratchet, ratchet + """
| scripts/ways-of-work/drift.ts (ways-of-work drift counter) | IN | bun drift.ts --repo <dir> [--also <file>]... [--json] [--verbose] lists every place that states a way-of-work rule: the "Ways of work" section of agents/shaman.md is one place, and every tracked file outside a fixed allowlist (history, evidence, eval rubrics, the counter's own signals and fixtures) with a line matching a rule signal (the task and line limits, the fix-round cap, the implementer shape, the retired owner-must-ask rule and plan styles, the rubric's own wording) is another; --also adds a file outside the repo, such as the installed ~/.claude/CLAUDE.md. A measurement, not a gate: exit 0 whatever it counts, exit 2 on a usage error, a failed git ls-files or an unreadable --also file. The pure core (drift-core.ts) decides; drift.ts only lists and reads files | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/ways-of-work/drift.test.ts |""")

# Change Safety — plan validation, and the drift counter's own row.
rep(row("Plan validation regression"), """| Plan validation regression | Editing validate-plan.sh, or a block in agents/shaman.md "Ways of work" | Malformed plans reach an executor, or a plan the validator passes is refused by the campaign runner | plugins/tribe/scripts/tests/test-validate-plan.sh; plugins/tribe/scripts/tests/test-ways-of-work-plans.sh |
| A way of work defined in two places | Editing any file that describes how a plan is executed | The drift counter lists a place other than the canonical section | bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . prints ways-of-work definitions: 1 |""")

# Business Flow — Unattended path: the campaign's way of work, and one placeholder word.
rep("""(in the plan style the owner names — simple by default, Tribe only when asked; the plan, not the runner, decides the way of working)""",
    """(each card in the way of work the campaign's Shaman authority chose by the rubric in agents/shaman.md "Ways of work"; the plan, not the runner, decides the way of working)""")
rep('an optional "doorbell" session', 'an opt-in "doorbell" session')

# Contract — Global CLAUDE.md append.
rep(row("Global CLAUDE.md append"), """| Global CLAUDE.md append | OUT | Install hook appends each claude-md/*.md snippet once, keyed on the snippet's first line, and refuses when any of its headings already exists in the target under a different first line. When the first line is present, the installed section (up to the first heading at its level or above that the snippet does not own) is compared with the snippet: equal, nothing changes; different, the whole CLAUDE.md is copied to CLAUDE.md.bak.<epoch>, the section is replaced by the snippet, and a warning names the backup — so a reworded snippet reaches every installed machine. Snippets: global-rules.md — the owner's consolidated global standing rules; goal-verify-ratchet.md; and shaman-brainstorm-together.md, the short form of the Shaman's Mode 1, which points to agents/shaman.md "Ways of work" for the ways of work. Each snippet carries its own unique top heading | user's global config | install.sh + claude-md/; plugins/tribe/scripts/tests/test-install-hook.sh |""")

# Contract — orchestrate-campaign: the modes replace the plan styles.
rep("""and chooses the plan style — simple by default (a "How to work" section giving each task to one general-purpose subagent, every task ending in a Done section the runner runs), Tribe only when the owner asks (the "Tribe style — plan section", ending in a Harness-gap gate task whose Done runs gap-gate.ts, plus the "Tribe style — Stage C and D additions": ratified-as: rulings and a ratification pass checked by scripts/gaps/rulings-check.ts) — because the runner, watchdog and supervisor prescribe no way of working,""",
    """and chooses each card's way of work by the rubric in agents/shaman.md "Ways of work" — every plan copies that mode's block, and every task ends in a Done section the runner runs; a tribe card's plan also carries the "tribe cards — campaign plan additions", ending in a Harness-gap gate task whose Done runs gap-gate.ts, and a campaign holding a tribe card runs the "tribe cards — Stage C and D additions" (ratified-as: rulings and a ratification pass checked by scripts/gaps/rulings-check.ts) — because the runner, watchdog and supervisor prescribe no way of working,""")

# Contract — orchestrate-campaign: its final report also reads a light-mode card's review record (S2).
rep("""and composes the ONE owner report, independently re-verifying every card the runner claims shipped.""",
    """and composes the ONE owner report, independently re-verifying every card the runner claims shipped (verify-shipped, and for a single-agent or subagent-per-task card its PR body's ## Final review section, which must end REVIEW: PASS).""")

# Contract — rulings-check.ts: the section it names was renamed.
rep("""A Tribe-style plan (orchestrate-campaign's "Tribe style — Stage C and D additions") runs it as a Done command""",
    """A campaign holding a tribe card runs it (orchestrate-campaign's "tribe cards — Stage C and D additions")""")

# Derived Materials — the snippet points to the section.
rep("""| A one-line-per-obligation summary; it must never contradict Mode 1, which stays the single long form |""",
    """| A one-line-per-obligation summary that points to the "Ways of work" section for the ways of work; it must never contradict Mode 1, which stays the single long form |""")


# Change Safety — the install hook now refreshes a section in place.
rep(row("Non-idempotent CLAUDE.md append"), """| Non-idempotent CLAUDE.md append | Editing the install hook | Duplicate snippet blocks in global CLAUDE.md, a refresh that loses content outside its section, or a refresh with no backup | plugins/tribe/scripts/tests/test-install-hook.sh; re-run ./install.sh tribe twice and diff the global CLAUDE.md |""")

# Business Flow — Unattended path: a Mode 1 approval also starts a (one-card) campaign (D7, D9).
rep("""One owner directive ("orchestration: do these N ideas") and then no owner intervention until one report.""",
    """One owner directive ("orchestration: do these N ideas") — or the owner's approval of a Mode 1 card, which the Shaman runs as a one-card campaign — and then no owner intervention until one report.""")

# Contract — orchestrate-campaign: the default harness, one-card campaigns included (D7, D9).
rep("""invocable from ANY session — main chat, a Shaman, or a Warchief already in play — which is why it is a skill rather than an agent. Assumes""",
    """invocable from ANY session — main chat, a Shaman, or a Warchief already in play — which is why it is a skill rather than an agent. It is the campaign harness every approved plan runs through by default (agents/shaman.md "Ways of work"), a one-card campaign included: a Shaman runs it on a Mode 1 card once the owner approves, and Stage A then skips authorship — it lands the approved spec and plan, writes the state, dry-runs and launches. Assumes""")

open(p, "w", encoding="utf-8").write(s)
```
