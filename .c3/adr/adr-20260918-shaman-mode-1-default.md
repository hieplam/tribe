---
id: adr-20260918-shaman-mode-1-default
c3-seal: 3f1a03f89bd76db40ce7d765ae15c1d913a3886ca8ff93e2c944ec14131bb427
title: shaman-mode-1-default
type: adr
goal: 'Make brainstorm together the Shaman''s Mode 1 and its default mode, per the owner''s ruling of 2026-09-18 ("make it mode 1 (default)"): forge the roadmap becomes Mode 2 and run the campaign becomes Mode 3. Bring c3-215''s mode references in line, and land the Derived Materials row for the brainstorm-together snippet that adr-20260918-shaman-brainstorm-snippet meant to add (its two-row block patch sealed only the first row).'
status: done
date: "2026-09-18"
---

## Goal

Make brainstorm together the Shaman's Mode 1 and its default mode, per the owner's ruling of 2026-09-18 ("make it mode 1 (default)"): forge the roadmap becomes Mode 2 and run the campaign becomes Mode 3. Bring c3-215's mode references in line, and land the Derived Materials row for the brainstorm-together snippet that adr-20260918-shaman-brainstorm-snippet meant to add (its two-row block patch sealed only the first row).

## Context

adr-20260918-shaman-brainstorm-mode added brainstorm together as Mode 3. At the ratification checkpoint the owner ruled it becomes Mode 1 and the default. c3-215's Owner → Shaman dispatch and Global CLAUDE.md append rows name the old numbers.

## Decision

Renumber in every live surface (agents/shaman.md, warchief.md, the claude-md snippet, the orchestrate-campaign skill, the runner README, the plugin README, eval 53) and state the default rule in shaman.md: a request that is neither a backlog ask nor a run-the-approved-cards ask runs Mode 1. Eval 55 pins the default (a single problem with no trigger phrase routes to Mode 1). Historical ADR bodies keep the numbers they were written with.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Two contract rows renumbered; one Derived Materials row added | c3-215#n1545@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command" | Change Safety row "Role-boundary erosion": agent evals re-run |
| c3-2 | container | Parent of c3-215; unchanged (Parent Delta: none) | c3-2#n1530@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content" | review only |
| c3-0 | system | No system-level fact changes | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem" | review only |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-evals-fixture | Eval 53 is renamed and eval 55 added in the fixture shape | ref-evals-fixture#n1728@v1:sha256:6a45601a3dfa6544d9d24b431ead59db2e530db2158f2f706242f30119a20ec8 "One eval fixture format for every role-behavior and skill-trigger eval" | comply |
| ref-plugin-layout | Cited by c3-215; no directory-shape change | ref-plugin-layout#n1738@v1:sha256:0282b30a709a0e5b9670cb9130590099375ad4cef2a91521813a7427c3b46c8b "Standardize the directory shape of every plugin" | N.A - no layout change |
| ref-docs-lifecycle | Cited by c3-215; no lifecycle change | ref-docs-lifecycle#n1718@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail" | N.A - no lifecycle change |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-bash-strict-mode | Cited by c3-215; no script change in this unit | rule-bash-strict-mode#n1747@v1:sha256:18b71fb29fad608a0bc7d57da5c807b50c9aafcc827cda25f43fa49e03fbb745 "Every shell script in the repo fails fast and loud" | N.A - no script change |
| rule-marketplace-registration | Reached through c3-0; no plugin registration change | rule-marketplace-registration#n1821@v1:sha256:e2cde94bfc6a62a4c1b79caf53a11a2bc563c82338b88e7cb3c80bf00a936899 "Every plugin that exists in the tree is" | N.A - no plugin registration change |
| rule-no-squash-merge | Cited by c3-215; the PR merges as a regular 2-parent merge | rule-no-squash-merge#n1836@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request" | comply |

## Verification

| Check | Result |
| --- | --- |
| run_evals.py --eval-id 53 / 54 / 55 on the edited agent; 55 on master's agent | recorded in the PR |
| c3x check | recorded in the PR |
