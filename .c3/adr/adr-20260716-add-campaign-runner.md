---
id: adr-20260716-add-campaign-runner
c3-seal: 0f1dc5be873d62676dead63826b0390dc8291ef4855f159939594661bcc7595c
title: add-campaign-runner
type: adr
goal: |-
    Give the tribe plugin a **campaign runner**: a stateless, zero-token capability at
    `plugins/tribe/scripts/runner/` that executes staged roadmap cards sequentially — one fresh
    Claude Agent SDK executor session per card, script-verified SHIPPED, state committed to the
    target repo's master, resumable after any crash — replacing the Shaman-as-loop. In the same
    unit, correct `c3-215`'s stated delivery outcome from **"squash-merged"** to a regular merge:
    the runner mechanically rejects any merge lacking 2 parents, and the owner's standing rule
    forbids squash merges, so the component's own goal currently contradicts both.
status: accepted
date: "2026-07-16"
---

## Goal

Give the tribe plugin a **campaign runner**: a stateless, zero-token capability at
`plugins/tribe/scripts/runner/` that executes staged roadmap cards sequentially — one fresh
Claude Agent SDK executor session per card, script-verified SHIPPED, state committed to the
target repo's master, resumable after any crash — replacing the Shaman-as-loop. In the same
unit, correct `c3-215`'s stated delivery outcome from **"squash-merged"** to a regular merge:
the runner mechanically rejects any merge lacking 2 parents, and the owner's standing rule
forbids squash merges, so the component's own goal currently contradicts both.

## Context

A campaign (25 cards) run with the Shaman (a large-model session) as the outer loop measured
~400K tokens of a 1M window for **one card**. A chat session's context is append-only, so card
N pays rent on cards 1..N-1 and the campaign dies of context exhaustion around card 3 —
compaction then loses exactly what cannot be lost (owner rulings, schema-lock nuances, wall
exceptions). The loop itself needs zero judgment: pick next card → spawn executor → wait →
verify mechanically → record. That is `gh`/`git` plumbing wearing a language model.

Two constraints shaped where this lands:

- **The owner's skill-authoring anti-goals** forbid a capability baking in its campaign. The
runner therefore hardcodes no repo, path, model, or campaign value — every such value is a
CLI input. The campaign *instance* (state JSON, specs, plans, answers, escalations) lives in
the target repo; the loop belongs to the tribe.
- **`ref-plugin-layout` is binding on this component.** The design spec originally placed the
runner at `plugins/tribe/runner/`, but `install.sh` whitelists only
`agents|skills|claude-md|hooks|.claude-plugin|scripts|evals` and warns
*"unsupported component type — not installed"* on anything else. `scripts/` is already the
ref's documented home for repo-invoked, not-installed code — precisely what the runner is.

The squash drift is independent but touches the same fact: `c3-215`'s Goal and Business Flow
both promise "squash-merged" PRs while the owner's rule and the runner's D3 check both forbid
squashing.

## Decision

Add the runner **inside** `c3-215` (it is tribe machinery, not a new plugin) at
`plugins/tribe/scripts/runner/` — under `scripts/`, complying with `ref-plugin-layout` as
written and requiring no installer change. It is a bun/TypeScript package with a plugin-local
`package.json`; the repo root stays package.json-free.

Architecture: intelligence in throwaway sessions, memory in files, **loop in code**. The loop
process makes zero LLM calls; the only model usage is inside spawned sessions. Every
world-touching call (`gh`, `git`, SDK) goes through an injected seam, so the loop is unit-
testable without touching the network. SDK options are pinned in exactly one module
(`session.ts`) so an SDK upgrade touches one file.

Done is **script-verified, never agent-claimed**: an executor's `SHIPPED <pr> <sha>` line is a
signal only; the runner independently replays six deterministic checks (merged, 2 parents,
ancestor-of-master, checks green, worktree/branch gone, schema guard) and accepts the card only
if all pass. State is data; `gh`/`git` is authority — every card's true phase is re-derived
from GitHub on each start.

The squash correction rides in this unit rather than a later ADR because shipping a capability
that enforces no-squash into a component whose goal promises squash-merges would leave the fact
self-contradictory at rest.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Gains the runner as a new delivery surface (CLI contract + change-safety risk); its Goal and Business Flow are corrected from "squash-merged" to regular merge to match the owner's rule and the runner's own D3 2-parent check | c3-215#n445@v1:sha256:89122979aba82506a2dce8209891c33dc92b09437db4dffbc56347159fe052e3 "Deliver features through a 5-agent chain of command — Shaman (What/Why) → Warchief (How) → Hunter (TDD execution), gated by Tracker (rules review) and Ski" | ref-plugin-layout (directory shape), ref-docs-lifecycle (its spec/plan/evidence), rule-bash-strict-mode (N.A — the runner is TypeScript, not shell) |
| c3-2 | container | Parent of c3-215 and owner of the install contract this decision had to satisfy: the runner is a new subdirectory inside a member plugin, and the location choice (scripts/, not runner/) exists precisely so the container's one-install-code-path property survives. The container's file-based cross-plugin contract is also what the runner extends — it reads/writes the same state, spec, plan and report files. No membership change: the runner is a capability inside c3-215, not a new component | c3-2#n218@v1:sha256:34447fd4a9c82ee7d7480da91fca6e40ce05b07cf4647f6ac8b2b9e22deb6de0 "Cross-plugin contracts stay file-based: tribe writes roadmap/spec/plan/report files; verify-shipped checks git/GitHub state produced by tribe's Warchief — no " | ref-plugin-layout — verified the container's install walk emits no "unsupported component type" warning after the move |
| c3-0 | system | Top-down completeness only: c3-215's system ancestor. The runner adds no component, no container, and no install-time surface — the system topology and the symlink-install source-of-truth property are untouched | c3-0#n2@v1:sha256:d21dc72fe385cb42ca0b79273dbc1b309b5d308a10754974395b20c7fd30fcc0 "Package Todd Lam's personal Claude Code agents and skills as installable plugins, keep the repo the single source of truth via symlink installs, and benchmark e" | None — no system-level contract changes |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-plugin-layout | Binding on c3-215 and it dictates which subdirectories install.sh understands. The originally-specified plugins/tribe/runner/ is NOT on that whitelist and would warn "unsupported component type — not installed" on every install; scripts/ is the ref's documented home for repo-invoked, not-installed code | ref-plugin-layout#n666@v1:sha256:7308f9cf6c7b854b298ec94062198be5540c62222a8b3466b2796854039585c5 "Standardize the directory shape of every plugin so the installer, the marketplace manifest, and the eval harness can walk any plugin without per-plugin logic. T" | comply — runner lands at plugins/tribe/scripts/runner/; the ref needs no change |
| ref-docs-lifecycle | Binding on c3-215 and governs specs/plans/evidence for tribe's own feature work; this runner has both a design spec and a plan under docs/superpowers/ | ref-docs-lifecycle#n647@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail — designs, implementation plans, and proof artifacts must outlive the chat session that produced them. The re" | comply — spec + context + plan already on master, updated to the new path |
| ref-evals-fixture | Cited by c3-215 (its agent-kind eval cases), so this ADR must state its position rather than pass over it silently | ref-evals-fixture#n657@v1:sha256:f721836fe1202e2368d7d811c32d640cfc55f26882336819d9735bc3a9dbfd04 "One eval fixture format for every skill and agent in the repo, so a single runner can benchmark all of them and results are comparable across plugins. The recur" | N.A - the runner adds no eval fixtures. It is not an agent or skill (nothing is symlinked into ~/.claude), so the eval harness has no case to run for it; its proof surface is bun test + tsc --noEmit in its own package. The existing agent-kind cases in plugins/tribe/evals/evals.json are untouched |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-marketplace-registration | Cited by c3-101 (the installer), which this ADR's rejected alternative would have edited; the runner also lands inside an already-registered plugin, so the ADR must state its position rather than pass over it | rule-marketplace-registration#n693@v1:sha256:458830564c7ac131ef95420a16dfb572ec4fbd5c9a24cb1395d641667e5a5a16 "Every plugin that exists in the tree is discoverable and installable: the marketplace manifest is the authoritative registry" | N.A - no new plugin is created. The runner is a subdirectory of the already-registered tribe plugin, so the marketplace manifest is unchanged and no new registry entry is owed. This ADR deliberately does NOT touch c3-101/install.sh — that was the rejected alternative |
| rule-bash-strict-mode | Listed in c3-215's uses and binding on its scripts; the runner lands under scripts/, so the rule's scope must be checked explicitly rather than assumed | rule-bash-strict-mode#n676@v1:sha256:cf218a707a61ba5ad906d29dec31f9f4eef92e5faeb9db74e3a75451c41c3c1d "Every shell script in the repo fails fast and loud: unset variables, failed commands, and broken pipelines abort the script instead of silently producing half-d" | N.A - the runner is a TypeScript/bun package, not a shell script; the rule governs *.sh and is unaffected. The existing shell scripts under scripts/ remain bound by it |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the Shaman (a large-model session) as the outer loop | Measured: one card + setup consumed ~400K of a 1M window. Context is append-only, so cost per card grows and the campaign hits the ceiling around card 3, forcing compaction — which loses the owner rulings and wall exceptions the campaign cannot lose |
| Headless CLI loop (claude -p "<brief>" … from bash) | Same engine, fewer moving parts — the honest fallback, kept as documented plan B. Rejected as primary: it loses typed messages (completion detection degrades to stdout scraping), programmatic resume handles, and abort control |
| Anthropic API + tool runner | Would mean rebuilding file tools, permissions, and subagents — everything Claude Code already is. Wrong layer |
| Managed Agents (Anthropic-hosted loop + sandbox) | The campaign's whole verification story (worktrees, local gh auth, repo conventions) lives on this machine; self-hosting the loop is one small script |
| Place the runner at plugins/tribe/runner/ as the design spec originally specified | install.sh's component whitelist does not include runner, so every ./install.sh tribe would warn "unsupported component type — not installed" and the tree would contradict its own binding ref (ref-plugin-layout) |
| Add runner) to install.sh's whitelist and update ref-plugin-layout to match | Wider blast radius: edits the distribution installer (c3-101, a different component) and a binding ref, to gain nothing scripts/ does not already provide |
| Make the runner its own plugin / component | It is tribe machinery — it dispatches the tribe's own Warchief and consumes the tribe's agent definitions via the SDK plugins option. A separate plugin would split one capability across two components |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| bypassPermissions lets a spawned session run anything the shell can | Owner-ruled and accepted. Contained by: private repos, worktree isolation, script-side verification of every claim, the STOP file, and a wall-clock abort | session.ts pins permissionMode: 'bypassPermissions' + allowDangerouslySkipPermissions in ONE module; --session-timeout drives an AbortController |
| Mocked seams validate the logic but not the commands — a plausible-but-wrong invocation passes every test | Proved real, not theoretical: gh api pulls/<pr> (copied literally from the spec's shorthand) 404s and would have failed verification for EVERY card while 25 tests passed. Now repos/{owner}/{repo}/pulls/<pr>. Every gh/git string was executed against the real CLI before being trusted | gh api repos/{owner}/{repo}/pulls/36 → {"merged":true,...}; gh api pulls/36 → 404. Also verified live: git rev-list --parents, git merge-base --is-ancestor, git worktree list --porcelain, git ls-remote --heads |
| SDK drift silently changes option/message shapes | All query() options pinned in one module (session.ts); an upgrade touches one file. Every §D1 fact was verified against the installed sdk.d.ts rather than memory | session_id confirmed on SDKSystemMessage; SettingSource = 'user' |
| A stale user-global ~/.claude/agents copy shadows the plugin's agent definitions inside executor sessions | Sessions load agents via the SDK plugins: [{type:'local', path: TRIBE_PLUGIN_DIR}] option only, never from user scope. TRIBE_PLUGIN_DIR is derived from import.meta.dir, never hardcoded | Proven post-relocation: resolves to .../plugins/tribe, with .claude-plugin/plugin.json and agents/warchief.md reachable from it |
| The runner auto-waives a red check on a code diff (D6 forbids this absolutely) | github.ts's waiver assumes its diff is docs-only BY CONSTRUCTION, so the loop is constrained to pass it state/escalation files only; verify.ts's docs-only path set is campaign config and an EMPTY list fails closed (nothing counts as docs-only) rather than waiving everything | github.test.ts asserts a non-advisory red returns escalate and that no merge command runs; verify.test.ts asserts the sonar-504 signature does NOT waive a code diff |
| State/reality divergence — the state file lies about what shipped | Structural: "the file is data, gh/git is authority". Every card's phase is re-derived from GitHub on each start (D4); a card is accepted only when the six-point replay passes (D3) | loop.test.ts covers every row of the D4 resume matrix |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| verifyShipped (D3 six-point replay) | Rejects an agent's SHIPPED claim unless the PR is merged, the merge commit has exactly 2 parents (squash/rebase fails — this is what makes the no-squash rule mechanical), the sha is an ancestor of origin/master, checks are green, the worktree/branch are gone, and the schema guard is clean over the CARD BRANCH's OWN commits — git diff <mergeSha>^1...<mergeSha>^2 on the configured schema-lock paths, never baseSha..<remote>/<baseBranch>, which diffed the base branch's own concurrent movement and so failed in-flight cards for locked files they had never touched. That range is also what makes the 2-parent requirement above enforced rather than merely asserted: the guard derives its range from the merge commit's two parents and FAILS CLOSED — passed: false with an honest detail, never a silent pass — on an unknown mergeSha, a parent lookup that could not be read at all, a parent count that is not exactly 2 (a squash or rebase-merge leaves no such anchor), or a git diff that itself exits non-zero. Under-checking is a bug; over-checking by refusing on an undecidable range is by design | plugins/tribe/scripts/runner/core/verify.test.ts — both directions on REAL git repositories: master-side locked-path movement PASSES, a card-branch-authored locked-path commit FAILS |
| bun test in plugins/tribe/scripts/runner/ | 114 tests over the loop, resume matrix, escalation, verification, D6 retry/waiver policy, and CLI; all seams mocked, no network | bun test → 114 pass / 0 fail |
| bunx tsc --noEmit | Type-checks the pinned §D1 option block against the SDK's real Options type — a wrong option shape fails the gate rather than failing at runtime | exit 0 |
| Stateless-capability grep | No repo name, absolute path, model name, or campaign value in the runner source | grep -rniE "ai-dict |
| install.sh component loop | With the runner under scripts/, plugins/tribe/*/ yields only whitelisted names — no "unsupported component type" warning | Simulated over plugins/tribe/*/: agents, claude-md, evals, scripts — all OK |

## Verification

| Check | Result |
| --- | --- |
| cd plugins/tribe/scripts/runner && bun test | 114 pass / 0 fail / 279 expect() calls |
| cd plugins/tribe/scripts/runner && bunx tsc --noEmit | exit 0, no output |
| gh api repos/{owner}/{repo}/pulls/36 vs gh api pulls/36 | {"merged":true,"merge_commit_sha":"48d691e…"} vs {"message":"Not Found","status":"404"} — proves the corrected invocation and the original defect |
| git rev-list --parents -n 1 48d691e | wc -w |
| TRIBE_PLUGIN_DIR resolution post-relocation | resolves to <repo>/plugins/tribe; .claude-plugin/plugin.json and agents/warchief.md both reachable ⇒ executor sessions load the tribe agents |
| install.sh whitelist over plugins/tribe/*/ | agents, claude-md, evals, scripts — zero unsupported-component warnings |
| grep -rn "squash" .c3/ after apply | No surviving claim that the tribe squash-merges |
