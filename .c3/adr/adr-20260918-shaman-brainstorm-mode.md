---
id: adr-20260918-shaman-brainstorm-mode
c3-seal: bfeb3d239077fe44dc9d7c392caac55342216223a1a83979bbd369f7e70f2724
title: shaman-brainstorm-mode
type: adr
goal: 'Add a third Shaman mode, "brainstorm together", to `plugins/tribe/agents/shaman.md`: the owner hands the Shaman ONE problem; the Shaman grounds the owner''s claims, converges with the owner on a high-level solution (shape, guardrails, ratchet, ledger, verification, do/don''t), records the ratified decisions in the idea card, has a planning-only Warchief author spec + plan, reviews them by grounding until they are clear, and then briefs and guides the owner''s new execution session via SendMessage. Record the new Owner → Shaman input in c3-215.'
status: done
date: "2026-09-18"
---

## Goal

Add a third Shaman mode, "brainstorm together", to `plugins/tribe/agents/shaman.md`: the owner hands the Shaman ONE problem; the Shaman grounds the owner's claims, converges with the owner on a high-level solution (shape, guardrails, ratchet, ledger, verification, do/don't), records the ratified decisions in the idea card, has a planning-only Warchief author spec + plan, reviews them by grounding until they are clear, and then briefs and guides the owner's new execution session via SendMessage. Record the new Owner → Shaman input in c3-215.

## Context

`shaman.md` had Mode 1 (forge a roadmap of many cards) and Mode 2 (run a campaign). The way the owner actually works most — one problem to a ratified solution with a spec + plan, executed by a fresh session the Shaman drives — existed only as a prompt the owner re-pasted (the third time on 2026-09-18). c3-215's Foundational Flow lists the Owner → Shaman inputs as only "what's next" / "run the roadmap". The worked example of the protocol is the `campaign-supervisor` card and its planning report under `~/.tribe/-Users-hip-repo-tribe/`.

## Decision

Add Mode 3 as a separate section of the Shaman agent, with its trigger phrases in the frontmatter description so it is routable, and keep Modes 1 and 2, the chain of command and the escalation register unchanged. Mode 3 reuses the existing planning-only Warchief dispatch (warchief.md gains one cross-reference paragraph) rather than a new dispatch type. Anti-goal 10 and the Warchief-contract boundary gain a scoped exemption: in Mode 3 step 4 the Shaman reads the planning-only Warchief's spec and plan to check they are true and faithful to the card, never to redesign the How — the same exemption campaign Stage A already exercises. Two agent-kind eval cases pin the new behaviour: routing ("let's brainstorm together" goes to Mode 3, grounds claims first, stays high level) and handoff (brief the new session via SendMessage, never a checklist for the owner).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Owner → Shaman inputs and the Owner → Shaman dispatch contract gain the Mode 3 trigger | c3-215#n1545@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command" | Change Safety row "Role-boundary erosion": agent evals graded for the new cases |
| c3-2 | container | Parent of c3-215; its responsibilities and the member's goal contribution are unchanged (Parent Delta: none) | c3-2#n1530@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content" | review only |
| c3-0 | system | Top of the chain; no system-level fact changes | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem" | review only |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-evals-fixture | Two new agent-kind eval cases are added in the fixture shape | ref-evals-fixture#n1728@v1:sha256:6a45601a3dfa6544d9d24b431ead59db2e530db2158f2f706242f30119a20ec8 "One eval fixture format for every role-behavior and skill-trigger eval" | comply |
| ref-docs-lifecycle | Cited by c3-215; Mode 3 keeps specs/plans/cards as the file-based paper trail | ref-docs-lifecycle#n1718@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail" | review |
| ref-plugin-layout | Cited by c3-215; no directory-shape change in this unit | ref-plugin-layout#n1738@v1:sha256:0282b30a709a0e5b9670cb9130590099375ad4cef2a91521813a7427c3b46c8b "Standardize the directory shape of every plugin" | N.A - no layout change |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-bash-strict-mode | Cited by c3-215; no shell script changes in this unit | rule-bash-strict-mode#n1747@v1:sha256:18b71fb29fad608a0bc7d57da5c807b50c9aafcc827cda25f43fa49e03fbb745 "Every shell script in the repo fails fast and loud" | N.A - no script change |
| rule-marketplace-registration | Reached through c3-0 (cited by c3-101); no plugin is added or registered in this unit | rule-marketplace-registration#n1821@v1:sha256:e2cde94bfc6a62a4c1b79caf53a11a2bc563c82338b88e7cb3c80bf00a936899 "Every plugin that exists in the tree is " | N.A - no plugin registration change |
| rule-no-squash-merge | Cited by c3-215; this PR merges as a regular 2-parent merge | rule-no-squash-merge#n1836@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request" | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Fold the protocol into Mode 1's "ideate together" | Mode 1 yields a ranked backlog of many cards; this yields ONE ratified solution with a spec + plan (owner-settled) |
| A new skill instead of an agent mode | The owner asked for it on the agent itself, so any Shaman session carries it |
| Hard-code Opus 5 as the planning Warchief's model | Model names age; the owner names the model at dispatch time, Opus 5 is recorded as the current default |

## Verification

| Check | Result |
| --- | --- |
| run_evals.py --eval-id 53 / 54 (with_skill) against the edited agent | recorded in the PR |
| c3x check after apply | recorded in the PR |
