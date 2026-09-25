---
id: adr-20260925-fix3-layer1-required-annotations
c3-seal: a54e79c6aaf3b79f5abf97c026542bf52cb019e8e75bb73cdeb56e598175e9e8
title: fix3-layer1-required-annotations
type: adr
goal: |-
    Correct `rule-session-cwd-config-restored`'s Golden Example annotations so they say what the card's
    own measurements support. Two changes, no behaviour change and not one character of TypeScript moved:
    (1) the **layer-1 write refusal** (the `HOME_CONFIG_DENIED_REASON` row of `decideContainmentHook`,
    `plugins/tribe/scripts/runner/core/supervisor/permit.ts`) stops being annotated
    `OPTIONAL: refusing the write early is defence in depth; the restore above is the rule.` and becomes
    **REQUIRED**, with the window that makes it required named in the annotation and argued in the prose
    above it — layer 2 (the snapshot/restore around `runOneShotSession`) runs **after** the session, so it
    structurally cannot reach two **intra-session** mechanisms this card's spec MEASURED (§4.4 item 3's
    mid-session settings reload and §4.3 row `m1b`'s on-demand nested memory load); and (2) the two
    annotations that wrap onto a second and third line are joined into one line each, so every one of the
    four blocks carries exactly one annotation line and the Golden Example's literality is mechanically
    checkable.
status: done
date: "2026-09-25"
---

## Goal

Correct `rule-session-cwd-config-restored`'s Golden Example annotations so they say what the card's
own measurements support. Two changes, no behaviour change and not one character of TypeScript moved:
(1) the **layer-1 write refusal** (the `HOME_CONFIG_DENIED_REASON` row of `decideContainmentHook`,
`plugins/tribe/scripts/runner/core/supervisor/permit.ts`) stops being annotated
`OPTIONAL: refusing the write early is defence in depth; the restore above is the rule.` and becomes
**REQUIRED**, with the window that makes it required named in the annotation and argued in the prose
above it — layer 2 (the snapshot/restore around `runOneShotSession`) runs **after** the session, so it
structurally cannot reach two **intra-session** mechanisms this card's spec MEASURED (§4.4 item 3's
mid-session settings reload and §4.3 row `m1b`'s on-demand nested memory load); and (2) the two
annotations that wrap onto a second and third line are joined into one line each, so every one of the
four blocks carries exactly one annotation line and the Golden Example's literality is mechanically
checkable.

## Context

Fix round 3 of card `supervisor-home-settings-containment` acts on a Scout survey finding (P5) that an
artifact **this card itself produced** records a justification weaker than the card's own evidence.
The recorded justification, verbatim:

> `// OPTIONAL: refusing the write early is defence in depth; the restore above is the rule.`

"Defence in depth" claims layer 2 subsumes layer 1. It does not, because layer 2 runs after the
session and both mechanisms below fire **inside** it:

1. **Mid-session settings reload.** Spec §4.4 item 3, verbatim: *"**Settings reload mid-session.**
e2's writer A itself left `project-Stop` and `local-Stop` markers: the hooks it wrote with `Bash`
were picked up by A's own `Stop` event."* The spec dismisses it with *"`closing` already holds
`Bash`, so it gains nothing"* — true for `closing`, and **false for `ruling`/`ratify`**, which hold
`Write`/`Edit` while `Bash` sits in `JUDGMENT_DISALLOWED_TOOLS` (`core/supervisor/session.ts`).
With layer 1 deleted, a deliberately shell-less judgment session can write
`<home>/.claude/settings.json` with a `hooks` block and have its own `Stop` event run that shell
command — arbitrary shell execution inside a session that was granted none, before any restore can
run.
2. **On-demand nested memory load.** Spec §4.3 row `m1b`, MEASURED: a nested memory file loads when
the session reads a file in its directory (`CODEWORD=ZEBRA-m1b-NESTED`), and fix round 1's probe
`f2` re-measured the same mechanism for `AGENTS.md`. A `ruling` session that writes
`<home>/escalations/AGENTS.md` and then reads `<home>/escalations/card.md` joins its own planted
instruction to its own context, in the same session.

So layer 1 is not redundancy; for that window it is the only control there is.

**The failure mode of leaving the annotation as it stands** is concrete: a future simplifier reads
`OPTIONAL … the restore above is the rule`, deletes the refusal rows, sees every test stay green —
*including* the real-session G2 E2E — and re-opens a `Bash`-less session's path to a shell. The E2E
stays green because no test distinguishes the two layers: the `Write`-writer pairs assert an
*attempted* Write plus no carry-over, which holds if **either** layer works, and no pair plants and
reads within one session.

**Honest limit, carried deliberately.** §4.4 item 3 measured the reload after a **`Bash`** write.
Whether the Claude Code CLI's settings reload keys on the *writing tool* is **UNMEASURED**, and
nothing in the measurement suggests it does. That is an argument for keeping layer 1, stated as a
burden of proof: the measurement is owed by whoever proposes the deletion, not by whoever keeps the
control.

**The second, mechanical half.** The rule canvas requires Golden Example code to be literal and each
structural element to be annotated `// REQUIRED` vs `// OPTIONAL`. Two of the four blocks carry an
annotation wrapped over 2 and 3 lines, and a continuation line (`// wrote the change.`) is
indistinguishable from the quoted file's own comments to any probe that strips annotation lines by
their prefix. MEASURED at `af53a86`, before this round changed anything, by a probe that strips lines
matching `^\s*//\s*(REQUIRED|OPTIONAL)` and asserts the remainder is a substring of
`core/supervisor/home-config.ts`, `session.ts` or `permit.ts`:

```
LITERAL     home-config.ts
NOT-LITERAL // wrote the change.
NOT-LITERAL // pass (see the `void sessionPromise.then(...)` line in the block abo
LITERAL     permit.ts
```

The Golden Example is **not** paraphrased — re-measured with every leading `//` line stripped instead
of only the prefixed one, all four blocks' code is literal (`annotation_lines=1,2,3,1`,
`code_literal=YES` for all four). The defect is the annotation's shape, and its cost is exactly the
ambiguity annotations exist to remove: a reader grading which structural elements are REQUIRED — the
other half of this unit — cannot tell where the annotation ends and the quoted code begins.

## Decision

Four `block` patches on the Golden Example, one change-unit, no behaviour change:

1. **Patch 01** replaces the prose lead-in above the `permit.ts` block with a paragraph that states
why the layer is required, cites spec §4.4 item 3 and §4.3 `m1b` for the two intra-session windows,
carries the unmeasured-reload-keying limit as a burden on any future deletion, and names the gap
that is deliberately **not** built here.
2. **Patch 02** replaces the `permit.ts` code block, changing **only** its annotation line, from
`// OPTIONAL: refusing the write early is defence in depth; the restore above is the rule.` to a
one-line `// REQUIRED (not defence in depth): …` naming the intra-session window and its two spec
citations.
3. **Patch 03** joins the two-line annotation on the `runOneShotSession` snapshot/restore block into
one line, same words, same order.
4. **Patch 04** joins the three-line annotation on the `raceWallClock` block into one line, same
words, same order.

Every patch body is authored by reading the target block out of the landed rule, replacing only its
leading comment lines, and **asserting the code remainder is still a substring of the file it quotes**
before the patch is staged. The bodies are authored **unfenced**: the code node owns its fence, so a
body carrying its own ```` ```ts ```` fence is stored as content and the renderer then wraps it in a
longer fence — measured on a first attempt in this round, which produced a seven-backtick opening
fence and was rolled back with `git checkout` + `c3x repair` before anything was committed.

The annotations are kept to **one line each** rather than prefixing continuation lines with
`// REQUIRED:`: one annotation per structural element is what the canvas asks for, and several
prefixed lines read as several annotations.

**Deliberately out of scope, recorded so the next reader does not mistake silence for completeness:**

- **The layer-distinguishing test is NOT built.** An E2E that fails when layer 1 alone is deleted
needs a measurement nobody has taken: does a judgment session's own written `hooks` block fire
inside its own session, when the write arrived via `Write` rather than `Bash`? Until that is
measured, such a test would encode a guess. Named here and in the card's evidence document
(`## FIX ROUND 3`) as the open gap, with the measurement it requires.
- **The rule's `Rule`/`Scope`/`Goal` breadth is untouched.** The Scout also observed that the `Rule`
line obliges only a restore while the `Goal` is class-wide and the `Scope` is one function, so a
third spawn path is governed by nothing. That widens the rule's contract; it rides to the campaign's
closing pass with the Scout's other proposals rather than being smuggled in here.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| rule-session-cwd-config-restored | rule | Its Golden Example marks the layer-1 write refusal OPTIONAL on the ground that the restore subsumes it; the restore runs after the session and cannot reach the two intra-session mechanisms the card's spec measured (§4.4 item 3, §4.3 m1b), so the annotation licenses deleting the only control over that window | rule-session-cwd-config-restored#n2485@v1:sha256:01d50476d1f95e107e3e605a88db6c807fd0cfde5abd72daa41ca55bc8c54e11 "// OPTIONAL: refusing the write early is defence in depth; the restore above is the rule." | Patch 02 (block) flips the annotation to REQUIRED with the window it covers; patch 01 (block) replaces the prose lead-in with the two spec citations, the unmeasured-reload caveat as a burden on deletion, and the named unbuilt gap. The TypeScript below the annotation is byte-identical, so the Golden Example stays literal |
| rule-session-cwd-config-restored | rule | Two of its four Golden Example blocks carry an annotation wrapped over 2 and 3 lines, so a probe that strips annotation lines by their REQUIRED/OPTIONAL prefix reads the continuation lines as quoted code and reports the blocks NOT-LITERAL even though the TypeScript is byte-identical to session.ts | rule-session-cwd-config-restored#n2481@v1:sha256:1fd128c131aefa3ea2430ad3b0429c50de5d75762b1590a9932310b4913127d2 "// REQUIRED: snapshot before spawn, fail closed if it cannot be read; restore after, whatever" | Patches 03 and 04 (block) join each wrapped annotation into one line; the TypeScript below every annotation stays byte-identical, proved by the literality probe printing LITERAL for all four blocks |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-change-unit-ships-with-code | Fix round 3's code change (the E2E guard's containment half, Scout P4) lands in the same commit as this reconciliation, so the patches may not be deferred to a later pass | rule-change-unit-ships-with-code#n2409@v1:sha256:b6024e72d871662eb34400050e4c977663b0356dceb6c8e2c42b3ea1c4fda085 "The PR that merges a decided ADR's code applies every patch under" | comply — this ADR flips to done only after change apply lands all four patches and the after-state phrase "REQUIRED (not defence in depth)" greps present, in the same commit as the guard fix |
| rule-session-cwd-config-restored | It is this unit's target: the unit changes how its own Golden Example grades the layer-1 refusal, from OPTIONAL to REQUIRED, and normalises its annotation lines | rule-session-cwd-config-restored#n2485@v1:sha256:01d50476d1f95e107e3e605a88db6c807fd0cfde5abd72daa41ca55bc8c54e11 "// OPTIONAL: refusing the write early is defence in depth; the restore above is the rule." | update-rule — annotations and one prose lead-in only; the Rule, Not This, Scope and Override sections are untouched |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The REQUIRED annotation rests on a mechanism measured only for a Bash write (spec §4.4 item 3): whether the CLI's settings reload keys on the writing tool is unmeasured, so a reader could call the annotation over-claimed | Patch 01 states the limit in the rule text itself and assigns the burden of measurement to the deletion, not to the control — the rule does not claim the Write-tool case was measured | command grep -c UNMEASURED .c3/rules/rule-session-cwd-config-restored.md >= 1 |
| No test fails if layer 1 alone is deleted, so the newly-REQUIRED annotation is the only thing defending it — documentation guarding code | The gap is named, with the exact measurement it needs, in this ADR and in the card's evidence document under ## FIX ROUND 3, rather than being closed by a test that would encode a guess | command grep -c "FIX ROUND 3" docs/superpowers/evidence/2026-09-25-supervisor-home-settings-containment.md >= 1 |
| Re-authoring a fenced code block can corrupt its fence — measured in this very round, where a body carrying its own ```ts fence produced a seven-backtick opening fence | Bodies are authored unfenced, each one asserted to be a literal substring of the file it quotes before staging, and the landed file is re-probed after apply | the literality probe prints LITERAL four times, and grep -c '```' on the rule returns 8 (four balanced fences) |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash c3x.sh change apply adr-20260925-fix3-layer1-required-annotations | applies atomically — four block patches, no drift |
| C3X_MODE=agent bash c3x.sh check | ok: true |
| command grep -c "REQUIRED (not defence in depth)" .c3/rules/rule-session-cwd-config-restored.md | >= 1 |
| command grep -c "OPTIONAL: refusing the write early" .c3/rules/rule-session-cwd-config-restored.md | 0 |
| python3 probe extracting every ts block from the rule, stripping lines matching ^\s*//\s*(REQUIRED\|OPTIONAL), asserting each remainder is a substring of home-config.ts, session.ts or permit.ts | LITERAL x4 (was LITERAL, NOT-LITERAL, NOT-LITERAL, LITERAL at af53a86) |
| cd plugins/tribe/scripts/runner && bun test core/supervisor/ adapters/ cli/ structure.test.ts | 0 fail |
