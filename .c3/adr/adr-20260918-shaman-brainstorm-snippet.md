---
id: adr-20260918-shaman-brainstorm-snippet
c3-seal: 421778613b7927b10b7fcdd62e54deb9ba38d8991d132ecc5e503707d77b7b68
title: shaman-brainstorm-snippet
type: adr
goal: Ship the short form of the Shaman's Mode 3 (brainstorm together) as a second global CLAUDE.md snippet, `plugins/tribe/claude-md/shaman-brainstorm-together.md`, so every session in every project — including a main chat playing the Shaman without loading `agents/shaman.md` — runs the owner's protocol. Record the second snippet in c3-215.
status: done
date: "2026-09-18"
---

## Goal

Ship the short form of the Shaman's Mode 3 (brainstorm together) as a second global CLAUDE.md snippet, `plugins/tribe/claude-md/shaman-brainstorm-together.md`, so every session in every project — including a main chat playing the Shaman without loading `agents/shaman.md` — runs the owner's protocol. Record the second snippet in c3-215.

## Context

adr-20260918-shaman-brainstorm-mode added Mode 3 to `agents/shaman.md`. The owner then ruled the protocol must also live in the tribe's global CLAUDE.md, not in Claude memory: memory is keyed to the project folder, so the tribe project's `tribe-shaman-workflow` memory did not load in a session started in another repo, and a main-chat session given the Shaman role never reads the agent file. The install hook (`plugins/tribe/install.sh`, claude-md section) appends each `claude-md/*.md` snippet keyed on its FIRST line and refuses when any of the snippet's headings is already in the target. `global-rules.md`'s first line is already installed on the owner's machine, so a section added inside it would never reach that machine.

## Decision

A new snippet file with its own unique top heading and no sub-headings, kept to a trigger line plus one line per obligation, pointing at Mode 3 as the single long form. The file name sorts after `global-rules.md`, so a fresh install appends the global rules first. `test-install-hook.sh` gains a case over the REAL shipped snippets: on a target that already holds `global-rules.md`, the new snippet lands exactly once across two runs, the global rules are not duplicated, and no heading is shared between two snippets. The existing drift between the installed global CLAUDE.md and `global-rules.md` is out of scope and reported to the owner separately.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | The Global CLAUDE.md append contract row and Derived Materials gain the second snippet | c3-215#n1545@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command" | Change Safety row "Non-idempotent CLAUDE.md append": run the hook twice and diff |
| c3-2 | container | Parent of c3-215; its responsibilities and the member's goal contribution are unchanged (Parent Delta: none) | c3-2#n1530@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content" | review only |
| c3-0 | system | Top of the chain; no system-level fact changes | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem" | review only |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-plugin-layout | The new snippet lives in claude-md/, the directory the layout reserves for CLAUDE.md snippets | ref-plugin-layout#n1738@v1:sha256:0282b30a709a0e5b9670cb9130590099375ad4cef2a91521813a7427c3b46c8b "Standardize the directory shape of every plugin" | comply |
| ref-docs-lifecycle | Cited by c3-215; no spec/plan lifecycle change | ref-docs-lifecycle#n1718@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail" | N.A - no lifecycle change |
| ref-evals-fixture | Cited by c3-215; no eval change in this unit | ref-evals-fixture#n1728@v1:sha256:6a45601a3dfa6544d9d24b431ead59db2e530db2158f2f706242f30119a20ec8 "One eval fixture format for every role-behavior and skill-trigger eval" | N.A - no eval change |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-bash-strict-mode | test-install-hook.sh is edited and keeps set -euo pipefail | rule-bash-strict-mode#n1747@v1:sha256:18b71fb29fad608a0bc7d57da5c807b50c9aafcc827cda25f43fa49e03fbb745 "Every shell script in the repo fails fast and loud" | comply |
| rule-marketplace-registration | Reached through c3-0 (cited by c3-101); no plugin is added or registered in this unit | rule-marketplace-registration#n1821@v1:sha256:e2cde94bfc6a62a4c1b79caf53a11a2bc563c82338b88e7cb3c80bf00a936899 "Every plugin that exists in the tree is " | N.A - no plugin registration change |
| rule-no-squash-merge | Cited by c3-215; this PR merges as a regular 2-parent merge | rule-no-squash-merge#n1836@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request" | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add the section inside global-rules.md | Its first line is already installed, so the hook skips the whole file on existing machines |
| Claude memory | Keyed to one project folder; the owner ruled it out |

## Verification

| Check | Result |
| --- | --- |
| test-install-hook.sh (mutation-checked: fails with the snippet removed) | 11 passed, 0 failed |
| Hook run twice on an empty dir and on a copy of the owner's CLAUDE.md | marker present exactly once in both |
