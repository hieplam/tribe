---
id: adr-20260928-shaman-mode-1-plan-way-of-work
c3-seal: 57e8cf584b3f06bca1eac27caccf4c34c5638367802b74d6c0bb403fe28b3b0d
title: shaman-mode-1-plan-way-of-work
type: adr
goal: Make the Shaman's Mode 1 (brainstorm together) execute the way of work its plan declares, and never the tribe's delivery loop (a full-build Warchief, Hunters, the two-lens Skinner audit, Tracker, Scout, the mammoth-hunt or orchestrate-campaign skills) unless the owner explicitly asks for the tribe in their own words, per the owner's ruling of 2026-09-28.
status: done
date: "2026-09-28"
---

## Goal

Make the Shaman's Mode 1 (brainstorm together) execute the way of work its plan declares, and never the tribe's delivery loop (a full-build Warchief, Hunters, the two-lens Skinner audit, Tracker, Scout, the mammoth-hunt or orchestrate-campaign skills) unless the owner explicitly asks for the tribe in their own words, per the owner's ruling of 2026-09-28.

## Context

Mode 1 step 5 told the Shaman to brief the execution session with "the delivery path (the tribe's normal loop, per Mode 3)", and the Shaman ⇄ Warchief contract said work leaves the Shaman only as a Warchief dispatch, with no mode scope. The mammoth-hunt skill also triggered on a bare tribe role assignment ("you are a shaman now"). Together these pulled Mode 1 execution into the full tribe loop even for small, well-defined cards whose plans declared a plain flow (implement, one review, at most one fix round, PR, merge), costing tokens and time the owner did not ask to spend.

## Decision

Add a hard constraint section to Mode 1 in agents/shaman.md that outranks the delivery sections: the plan's way of work is the execution contract; no tribe delivery agent or skill is dispatched unless the owner explicitly asks; the plan gate requires the plan to declare its way of work (default: the plain flow); the hand-off brief quotes it and avoids tribe role phrasing. Scope the Shaman ⇄ Warchief contract to Modes 2–3. Mirror the rule as step 6 of the claude-md snippet, narrow mammoth-hunt's role-assignment trigger to role plus an order to build with the tribe, and pin the behaviour with tribe eval 56 and mammoth-hunt eval 7 (eval 54 updated). c3-215's Owner → Shaman dispatch row carries the constraint.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-215 | component | Owner → Shaman dispatch contract row gains the Mode 1 execution constraint | c3-215#n2165@v1:sha256:f467fd1ec102c55b693524d1b29fda35cba5ac48b31be638a9f6a38cc5b3aef8 "Deliver features through a 5-agent chain of command" | Change Safety row "Role-boundary erosion": agent evals re-run |
| c3-2 | container | Parent of c3-215; unchanged (Parent Delta: none) | c3-2#n1530@v1:sha256:56c57d53533b1e3b4b9ff2aead25deff6371ef8809dcfccc7814a045b78da9a9 "Claude Code runtime content" | review only |
| c3-0 | system | No system-level fact changes | c3-0#n2@v1:sha256:476cc5f8083fd97a5294182fc94b61a08b26120310802a67bb9869380a9ee31a "Package the Tribe agent ecosystem" | review only |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-evals-fixture | Eval 56 and mammoth-hunt eval 7 are added in the fixture shape | ref-evals-fixture#n1728@v1:sha256:6a45601a3dfa6544d9d24b431ead59db2e530db2158f2f706242f30119a20ec8 "One eval fixture format for every role-behavior and skill-trigger eval" | comply |
| ref-plugin-layout | Cited by c3-215; no directory-shape change | ref-plugin-layout#n1738@v1:sha256:0282b30a709a0e5b9670cb9130590099375ad4cef2a91521813a7427c3b46c8b "Standardize the directory shape of every plugin" | N.A - no layout change |
| ref-docs-lifecycle | Cited by c3-215; no lifecycle change | ref-docs-lifecycle#n1718@v1:sha256:a163534e4fbc98d69ae8cd12167eedff5b0840b29f305b2a4d73a5784501ec2c "Give feature work a durable, ordered paper trail" | N.A - no lifecycle change |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-bash-strict-mode | Cited by c3-215; no script change in this unit | rule-bash-strict-mode#n1747@v1:sha256:18b71fb29fad608a0bc7d57da5c807b50c9aafcc827cda25f43fa49e03fbb745 "Every shell script in the repo fails fast and loud" | N.A - no script change |
| rule-marketplace-registration | Reached through c3-0; no plugin registration change | rule-marketplace-registration#n1821@v1:sha256:e2cde94bfc6a62a4c1b79caf53a11a2bc563c82338b88e7cb3c80bf00a936899 "Every plugin that exists in the tree is" | N.A - no plugin registration change |
| rule-sessions-start-in-target-repo | Cited by c3-215; no session-spawning change in this unit | rule-sessions-start-in-target-repo#n2635@v1:sha256:cb99b70f92847ea958cc95b99e86f09c6b1c7f40fdcd90cf4fabcc6224e7cf4d "Every session the tribe spawns starts in the target repo" | N.A - no session-spawn change |
| rule-no-squash-merge | Cited by c3-215; the PR merges as a regular 2-parent merge | rule-no-squash-merge#n1836@v1:sha256:2f5ff61964fe9551d508719ff31ed7514dbdbd8d296ff884a7e952a5334fab6a "Every capability in this repo that merges a pull request" | comply |

## Verification

| Check | Result |
| --- | --- |
| run_evals.py on tribe evals 53 / 54 / 55 / 56 and mammoth-hunt evals 3 / 7 | recorded in the PR |
| test-install-hook.sh | 11 passed, 0 failed |
| c3x check | recorded in the PR |
