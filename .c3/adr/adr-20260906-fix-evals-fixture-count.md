---
id: adr-20260906-fix-evals-fixture-count
c3-seal: 0202ad5778a2525bd0b74ac564073f20073e986f4d4a49e1356b0d438c17a952
title: fix-evals-fixture-count
type: adr
goal: 'Finish the `ref-evals-fixture` restatement that `adr-20260906-repo-split-tribe-only` left incomplete. That unit rewrote the ref''s Why block to stop crediting a departed plugin for the fixture shape, but left its Goal — both the sealed frontmatter and the rendered `## Goal` section — still saying "four plugins ship eval cases". After the repo split exactly two fixtures remain, both owned by `tribe`: `plugins/tribe/evals/evals.json` and `plugins/tribe/skills/mammoth-hunt/evals/evals.json`. The ref must state the number it is actually justified by.'
status: accepted
date: "2026-09-06"
---

## Goal

Finish the `ref-evals-fixture` restatement that `adr-20260906-repo-split-tribe-only` left incomplete. That unit rewrote the ref's Why block to stop crediting a departed plugin for the fixture shape, but left its Goal — both the sealed frontmatter and the rendered `## Goal` section — still saying "four plugins ship eval cases". After the repo split exactly two fixtures remain, both owned by `tribe`: `plugins/tribe/evals/evals.json` and `plugins/tribe/skills/mammoth-hunt/evals/evals.json`. The ref must state the number it is actually justified by.

## Context

`ref-evals-fixture` exists to justify one shared fixture format instead of a runner per plugin, and its Goal names the count that makes that trade worth it. At the time it was written, four plugins shipped `evals/evals.json`: `check-diff-coverage`, `refactor-for-testability`, `splitting-plans` and `tribe`. Three of those four moved to `hieplam/agent-plugins` in unit u2 of campaign `repo-split` (epic issue #125).

The preceding change-unit patched only the ref's Why section, because that was the block a name-based sweep for departed plugins found — the Goal states a *count*, not a name, so no grep flagged it. `c3x check` reports `ok: true` either way: a stale count is a truth defect, not a structural one, and no mechanical gate in the toolchain can see it. It was found by an adversarial review of the branch diff, which compared the ref's claim against the live tree.

A stale count here is not cosmetic. The ref's whole argument is "N plugins ship cases, so a shared shape beats N runners"; with N misstated as four when it is two, a future reader evaluating whether the shared format still earns its complexity is reasoning from a number that is twice the truth.

## Decision

Restate the Goal to name the two surviving tribe-owned fixtures, in a second change-unit rather than by extending the applied one. `adr-20260906-repo-split-tribe-only` has already been applied; adding a twentieth patch to it and re-running `change apply` would re-run nineteen already-applied patches and be rejected on drift. A follow-up unit is the tool's own idiom for "the previous unit was incomplete", and it keeps the two decisions separately reviewable: one retired the departed components, this one corrects a count they left behind.

Keep the rest of the Goal sentence — the shared-format rationale and the cross-plugin comparability clause — unchanged. The format's justification does not depend on the count being large, and a future plugin adding a fixture walks the same path; only the factual count is wrong.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| ref-evals-fixture | ref | Its Goal, in both the sealed frontmatter and the rendered section, says four plugins ship eval cases; the live tree has exactly two, both under tribe | ref-evals-fixture#n1981@v1:sha256:813517fa60d2f2b54b826ca8f96afc6d5756cf36963113cd294b205564805d59 "One eval fixture format for every role-behavior and skill-trigger eval in the repo" | Restate the count; leave the shared-format rationale intact |
| c3-301 | component | The eval runner cites this ref and discovers fixtures generically; its own text states no count, so it needs no patch — recorded here to show the citer was checked, not skipped | c3-301#n1923@v1:sha256:1e2eb86791640d972d66231acb66c7709dd53074b94011a4ce9e6643d861cf16 "Execute every evals/evals.json fixture in isolated claude -p subprocesses" | No change required |

## Verification

| Check | Result |
| --- | --- |
| c3x change apply adr-20260906-fix-evals-fixture-count | applies atomically, one patch, no drift |
| c3x check | ok: true |
| grep -c 'four plugins ship eval cases' .c3/refs/ref-evals-fixture.md | 0 |
| find plugins -path '*/evals/evals.json' | wc -l |
