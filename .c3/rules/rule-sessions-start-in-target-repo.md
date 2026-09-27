---
id: rule-sessions-start-in-target-repo
c3-seal: b4083bea72daa2d442bffd5da8c09eb08860ce119e8fc1b2b9d236b789f6d417
title: sessions-start-in-target-repo
type: rule
goal: |-
    Every session the tribe spawns starts in the target repo, never under `~/.tribe`, and loads only
    the configuration the owner's own `claude` loads there. Sessions hand over through notes (state
    files), never through configuration.
---

## Goal

Every session the tribe spawns starts in the target repo, never under `~/.tribe`, and loads only
the configuration the owner's own `claude` loads there. Sessions hand over through notes (state
files), never through configuration.

## Rule

A spawn path sets `cwd` to the target repo root and never lists a campaign home in
`additionalDirectories`; handover files are passed by absolute path in the brief.

## Golden Example

`core/supervisor/session.ts` — `buildOneShotOptions`, the `cwd` line:

```ts
export function buildOneShotOptions(
  kind: SessionKind,
  config: OneShotSessionConfig,
  abortController: AbortController,
): OneShotSessionOptions {
  const options: OneShotSessionOptions = {
    // REQUIRED: cwd is the target repo root — never the campaign home, never in additionalDirectories
    cwd: config.repoRoot,
    model: config.model,
```

`core/session.ts` — `buildSessionOptions`, the `cwd` line; the executor path this supervisor path
now matches:

```ts
export function buildSessionOptions(
  input: RunSessionInput,
  config: RunSessionConfig,
  abortController: AbortController,
  io: Pick<SessionIO, 'execInRepo'>,
): PinnedSessionOptions {
  const options: PinnedSessionOptions = {
    // REQUIRED: cwd is the target repo root
    cwd: config.repoRoot, // --repo input
    model: config.model, // --model input
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| additionalDirectories: [home] / absolute paths into the campaign home in the brief | cwd: config.repoRoot; handover files passed by absolute path in the brief | MEASURED 2026-09-27: with the home in additionalDirectories, a session loaded the home's .claude/skills and a planted memory-file codeword reached the context. |
| Guard or restore the campaign folder's configuration surface before/after every spawn | Never start a session there, so nothing needs guarding | PR #171 needed 1,070 lines to guard a folder nothing needs to load. |
| Hand work over by writing CLAUDE.md or a hooks block for the next session to read | Write answers.md, supervisor/verdicts/, reports/* and pass their paths in the next brief | 0 of 194 real supervisor writes needed configuration (card evidence, 2026-09-27). |

## Scope

`core/supervisor/session.ts` and `core/session.ts` spawn paths.

## Override

Owner ruling only.
