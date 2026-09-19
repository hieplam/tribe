---
id: adr-20260919-tribe-cli
c3-seal: 8b529792d19f8b2622e801de328b4ef82673cf766609187a2d8103acb3022b36
title: tribe-cli
type: adr
goal: Give the owner one command, `tribe`, that starts the read-only session viewer from any directory and opens it in the browser, and have `./install.sh` put that command on PATH. The command is the tribe's CLI entry point, so later options and subcommands land in the same place.
status: accepted
date: "2026-09-19"
---

## Goal

Give the owner one command, `tribe`, that starts the read-only session viewer from any directory and opens it in the browser, and have `./install.sh` put that command on PATH. The command is the tribe's CLI entry point, so later options and subcommands land in the same place.

## Context

Starting the viewer today means `cd plugins/tribe/scripts/viewer && bun serve.ts --port 4321`: the owner must remember the checkout path, and a port already in use is a refusal (exit 1). The campaign runner already starts the viewer itself, but a plain look at session transcripts has no short path. `ref-plugin-layout` says `scripts/` is repo-invoked and never installed, so no tribe script is on PATH. The owner asked to copy kanna's CLI: one bare command, sensible default port, next port when taken, `--strict-port`, `--no-open`, `--help`, `--version`, browser opened automatically.

## Decision

Add `plugins/tribe/scripts/cli/`, a bun + TS package: `bin/tribe` (a shebang and one import of `main.ts`), `main.ts` (composition root), pure `core/args.ts` and `core/viewer.ts`, and one adapter. `tribe` probes the port: a current tribe viewer is reused (browser opened, nothing started); a free port starts `serve.ts` in the foreground and opens the browser once `/healthz` answers; a port held by anything else moves to the next port, up to 20 (kanna's limit), unless `--strict-port`. The `/healthz` probe and its classification are the runner's (`buildViewerPort`, `classifyProbe`, now exported) so the runner and the CLI share one reader of that shape. The tribe plugin's install hook links `bin/tribe` to `$TRIBE_BIN_DIR/tribe` (default `~/.local/bin`) with the same idempotent link/backup behaviour as `rules/`, and warns when the directory is not on PATH. The serve.ts contract is unchanged.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | Parent system of both touched components; the tribe gains a command-line surface | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem — the chain-of-command delivery agents and the mechanical done-ness checker that grades their claims — as installable Clau" | Review only: no system goal change |
| c3-1 | container | Parent of c3-101; distribution now also places one command on PATH, through the plugin hook | c3-1#n1657@v1:sha256:7bc343b4bead419fd4f2a8369661aafd15cd6f32e5acd55c3b6c29cb859046b1 "Install-time distribution: register every plugin in the marketplace manifest and symlink plugin content into ~/.claude, keeping this repo the single source of" | Review only: linking stays symlink-based, never a copy |
| c3-2 | container | Parent of c3-215; the plugin's runtime content gains the tribe command | c3-2#n1717@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content: the 2 installable plugins — agents and skills that, once symlinked into ~/.claude, extend every Claude Code session with delive" | Review only: no new plugin, no new component directory |
| c3-215 | component | Gains a new IN surface (the tribe command) and its install hook gains a fourth job | c3-215#n1732@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command — Shaman (What/Why) → Warchief (How) → Hunter (TDD execution), gated by Tracker (rules review) and Ski" | Contract row added; comply with rule-one-parser-per-edge-shape and rule-temp-dir-cleanup |
| c3-101 | component | Runs the plugin hook that now links the command; root installer code unchanged | c3-101#n1669@v1:sha256:8a9563d459545b56a385862bad44876587d4521828684a4ea81c2f950d7b65de "Symlink every plugin's agents and skills into ~/.claude idempotently, and expose the marketplace manifest that registers what exists." | Review only: hook failure stays a WARN, no new component-type directory |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-docs-lifecycle | c3-215 cites it for durable paper trail; this change's record is this ADR plus the cli README | ref-docs-lifecycle#n1910@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail — designs, implementation plans, and proof artifacts must outlive the chat session that produced them. The re" | comply |
| ref-evals-fixture | c3-215 cites it; the CLI adds no role-behavior or skill-trigger eval | ref-evals-fixture#n1920@v1:sha256:6a45601a3dfa6544d9d24b431ead59db2e530db2158f2f706242f30119a20ec8 "One eval fixture format for every role-behavior and skill-trigger eval in the repo — cases shaped as a prompt plus a prose grading rubric — so a single runn" | N.A - no eval fixture added |
| ref-plugin-layout | Its Choice says scripts/ is never installed; one entry file under scripts/cli is now linked onto PATH by the hook | ref-plugin-layout#n1930@v1:sha256:0282b30a709a0e5b9670cb9130590099375ad4cef2a91521813a7427c3b46c8b "Standardize the directory shape of every plugin so the installer, the marketplace manifest, and the eval harness can walk any plugin without per-plugin logic. T" | update-ref |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-marketplace-registration | c3-101 cites it; no plugin directory is added, so the manifest is unchanged | rule-marketplace-registration#n2013@v1:sha256:e2cde94bfc6a62a4c1b79caf53a11a2bc563c82338b88e7cb3c80bf00a936899 "Every plugin that exists in the tree is discoverable and installable: the marketplace manifest is the authoritative registry, and it must never drift from the " | comply (no change needed) |
| rule-no-squash-merge | c3-215 cites it; this PR itself lands by regular merge | rule-no-squash-merge#n2028@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request, or that verifies one was merged," | comply |
| rule-one-parser-per-edge-shape | The CLI reads the viewer's /healthz body, which the runner already parses | rule-one-parser-per-edge-shape#n2050@v1:sha256:7c7d98b60ae93f515660d7fdbe87041fceae9207eff813d804c79fe892fbd91f "Every external shape the tribe's TypeScript edges read — a persisted JSON file such as" | comply: import the runner's classifyProbe and probe adapter |
| rule-temp-dir-cleanup | The e2e test builds a temp PATH dir and HOME fixture | rule-temp-dir-cleanup#n2109@v1:sha256:07c2cffc9bac7195e8f27d6736d323b2833d903277c7e7a3ad4b934b29f4f60d "Every test in this repo that materialises a real temporary directory removes it again, even when" | comply: afterAll rmSync recursive force |
| rule-bash-strict-mode | New shell test test-install-cli.sh | rule-bash-strict-mode#n1939@v1:sha256:18b71fb29fad608a0bc7d57da5c807b50c9aafcc827cda25f43fa49e03fbb745 "Every shell script in the repo fails fast and loud: unset variables, failed commands, and broken pipelines abort the script instead of silently producing half-d" | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| CLI package | scripts/cli/{bin/tribe,main.ts,core/args.ts,core/viewer.ts,adapters/viewer.adapter.ts,README.md} | plugins/tribe/scripts/cli/ |
| Runner | export classifyProbe from core/viewer-launch.ts | plugins/tribe/scripts/runner/core/viewer-launch.ts |
| Install hook | link bin/tribe into TRIBE_BIN_DIR, warn when off PATH | plugins/tribe/install.sh |
| Tests | hook tests that run the real hook now isolate TRIBE_BIN_DIR | test-fresh-machine.sh, test-install-viewer-build.sh |
| Docs | root README, plugin README, viewer README, cli README | README.md files |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A shell alias the owner adds by hand | Not installed by ./install.sh, breaks when the checkout moves, and has no room for future subcommands |
| bun install -g like kanna | tribe is a private checkout, not a published package; a global install is a copy that goes stale, while the symlink follows git pull like every other tribe install |
| Import serve.ts in-process | serve.ts parses process.argv and exits at import time by design (it is a composition root); a child process keeps the viewer contract untouched |
| A second /healthz parser in the CLI | Violates rule-one-parser-per-edge-shape; the runner and the CLI could disagree on what a running viewer is |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Tests that run the real hook write into the developer's ~/.local/bin | Every such test sets TRIBE_BIN_DIR inside its temp dir | ls ~/.local/bin/tribe absent after running the hook suites from a worktree |
| Another tool named tribe already on the machine | Backed up to tribe.bak.<epoch>, never deleted | test-install-cli.sh case 4 |

## Verification

| Check | Result |
| --- | --- |
| cd plugins/tribe/scripts/cli && bun test | 19 pass, including tribe.e2e.test.ts: bare tribe on PATH via symlink from another cwd starts the real viewer, second tribe reuses it, Ctrl-C exits 0, taken port moves on, --strict-port exits 1 |
| bash plugins/tribe/scripts/tests/test-install-cli.sh | 9 passed |
| cd plugins/tribe/scripts/runner && bun test | 1068 pass |
| test-fresh-machine.sh, test-install-viewer-build.sh, test-install-rules.sh, test-install-hook.sh, test-install-canvases.sh | all pass |
