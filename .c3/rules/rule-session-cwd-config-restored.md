---
id: rule-session-cwd-config-restored
c3-seal: 2e9858548dfd2c293685cc0a9a1470c420b0bc6c2c5e7b64d283aa1c17a7a0cd
title: session-cwd-config-restored
type: rule
goal: |-
    Every agent session this repo spawns with the `project` or `local` settings tier treats its `cwd`
    as a settings root: configuration one session writes there — `hooks` that run shell commands,
    `CLAUDE.md` text that joins the context, project skills, `.mcp.json` servers — must never take
    effect in the next session. MEASURED on 2026-09-25 (card supervisor-home-settings-containment,
    spec §4): with `cwd` = the campaign home, a `hooks` block in `.claude/settings.json` and in
    `.claude/settings.local.json` ran at `SessionStart`, `UserPromptSubmit`, `PreToolUse` and `Stop`
    in `ruling`, `ratify` and `closing` sessions; `CLAUDE.md`, `CLAUDE.local.md`, a nested or
    lower-case `claude.md`, `.claude/skills` and `.mcp.json` all loaded; and a `closing` session's
    single `Bash` command planted hooks that ran in the next session. RE-MEASURED in fix round 1
    (same card, 2026-09-25): `AGENTS.md` — the memory file Claude Code loads BY DEFAULT wherever
    `cwd` has no `CLAUDE.md`, the exact steady state this rule's own restore creates — loads at any
    depth by the same two mechanisms as `CLAUDE.md`, and a `closing` session's single `Bash` command
    planted `<home>/AGENTS.md` whose codeword reached the next `ruling` session before the predicate
    was widened to cover it.
---

## Goal

Every agent session this repo spawns with the `project` or `local` settings tier treats its `cwd`
as a settings root: configuration one session writes there — `hooks` that run shell commands,
`CLAUDE.md` text that joins the context, project skills, `.mcp.json` servers — must never take
effect in the next session. MEASURED on 2026-09-25 (card supervisor-home-settings-containment,
spec §4): with `cwd` = the campaign home, a `hooks` block in `.claude/settings.json` and in
`.claude/settings.local.json` ran at `SessionStart`, `UserPromptSubmit`, `PreToolUse` and `Stop`
in `ruling`, `ratify` and `closing` sessions; `CLAUDE.md`, `CLAUDE.local.md`, a nested or
lower-case `claude.md`, `.claude/skills` and `.mcp.json` all loaded; and a `closing` session's
single `Bash` command planted hooks that ran in the next session. RE-MEASURED in fix round 1
(same card, 2026-09-25): `AGENTS.md` — the memory file Claude Code loads BY DEFAULT wherever
`cwd` has no `CLAUDE.md`, the exact steady state this rule's own restore creates — loads at any
depth by the same two mechanisms as `CLAUDE.md`, and a `closing` session's single `Bash` command
planted `<home>/AGENTS.md` whose codeword reached the next `ruling` session before the predicate
was widened to cover it.

## Rule

A spawn path that loads the `project` or `local` tier restores its `cwd`'s configuration surface
to the pre-session snapshot before the next session can start.

## Golden Example

`core/supervisor/home-config.ts` — `isHomeConfigSurface`, whole function:

```ts
// REQUIRED: the case-insensitive compare and the four shapes (.claude/**, CLAUDE*.md, AGENTS*.md, .mcp.json)
/** PURE. Is `relativePath` (relative to the campaign home) a configuration surface?
 * Oracle (spec §6.1): under-matching a path Claude Code loads is a bug; over-matching a path
 * nothing loads is by design. Compared case-insensitively, because the macOS file system is:
 * `claude.md` IS `CLAUDE.md` there (MEASURED, spec §4.3 m2). The home itself (`''`) is not a
 * surface. */
export function isHomeConfigSurface(relativePath: string): boolean {
  const segments = relativePath
    .split(/[\\/]/)
    .filter((segment) => segment !== '' && segment !== '.')
    .map((segment) => segment.toLowerCase());
  if (segments.length === 0) return false;

  const name = segments[segments.length - 1];
  // `.claude/` holds settings, memory, skills, agents and commands — the whole tree loads.
  const isInsideDotClaude = segments.includes('.claude');
  // CLAUDE.md, CLAUDE.local.md: memory files; a nested one loads when the session reads a file
  // in its directory (MEASURED, spec §4.3 m1b).
  const isClaudeMemoryFile = name.startsWith('claude') && name.endsWith('.md');
  // AGENTS.md is the memory file Claude Code loads BY DEFAULT wherever the project has no
  // CLAUDE.md — which is precisely the steady state this card's own restore creates, so the
  // aggravation is that the fix makes this path the live one. MEASURED (card
  // supervisor-home-settings-containment, fix round 1): a `closing` session wrote `<home>/AGENTS.md`
  // and the next `ruling` session in that home read the codeword out of it; a nested
  // `<home>/escalations/AGENTS.md` loaded too, by the same on-demand mechanism as spec §4.3 m1b.
  const isAgentsMemoryFile = name.startsWith('agents') && name.endsWith('.md');
  // A project MCP server's command runs at session start (MEASURED, spec §4.3 m3).
  const isMcpConfig = name === '.mcp.json';
  return isInsideDotClaude || isClaudeMemoryFile || isAgentsMemoryFile || isMcpConfig;
}
```

`core/supervisor/session.ts` — `runOneShotSession`'s snapshot-before-spawn block and the
`restoreHomeAfterSession` call:

```ts
// REQUIRED: snapshot before spawn, fail closed if it cannot be read; restore after, whatever
// wrote the change.
export async function runOneShotSession(input: RunOneShotInput, io: OneShotSessionSeam): Promise<OneShotSessionResult> {
  const homeDir = input.config.homeDir;
  // A home whose configuration cannot be read cannot be restored afterwards, so no session is
  // spawned into it (fail closed).
  let before: HomeConfigSnapshot;
  try {
    before = io.snapshotHomeConfig(homeDir);
  } catch (err) {
    return errorResult(new Error(`refusing to spawn: the campaign home's configuration could not be read (${messageOf(err)})`));
  }

  const abortController = new AbortController();
  const options = buildOneShotOptions(input.kind, input.config, abortController);
  const sessionPromise = consumeOneShot(input, io, options);
  const result = await raceWallClock(sessionPromise, input.sessionTimeoutMs, abortController);

  if (result.outcome === 'timeout') {
    // The race resolved before the aborted stream ended, so a write can still land after the pass
    // below: restore once more when the stream settles (`consumeOneShot` never rejects).
    void sessionPromise.then(() => restoreHomeAfterSession(io, homeDir, before, result.sessionId));
  }
  const restoreFailure = restoreHomeAfterSession(io, homeDir, before, result.sessionId);
  if (restoreFailure === null) return result;
  return {
    ...result,
    outcome: 'error',
    finalText: `the campaign home's configuration could not be restored after the session (${restoreFailure})`,
  };
}
```

`core/supervisor/session.ts` — the timeout second pass (`raceWallClock`), REQUIRED where a
wall-clock bound exists:

```ts
// REQUIRED: on a timeout, the aborted stream's own eventual settlement still triggers a restore
// pass (see the `void sessionPromise.then(...)` line in the block above) — a write that lands
// after the race resolves is not left unrestored.
async function raceWallClock(
  sessionPromise: Promise<OneShotSessionResult>,
  timeoutMs: number | undefined,
  abortController: AbortController,
): Promise<OneShotSessionResult> {
  if (timeoutMs === undefined) return sessionPromise;
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<OneShotSessionResult>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve({
        outcome: 'timeout',
        sessionId: null,
        finalText: `session exceeded the ${timeoutMs}ms wall-clock timeout`,
        usage: null,
        totalCostUsd: null,
        permissionDenials: null,
      });
    }, timeoutMs);
  });
  try {
    return await Promise.race([sessionPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
```

`core/supervisor/permit.ts` — the `HOME_CONFIG_DENIED_REASON` row in `decideContainmentHook`:

```ts
// OPTIONAL: refusing the write early is defence in depth; the restore above is the rule.
  if (toolName === 'Write' || toolName === 'Edit') {
    const toolInput = (event.tool_input ?? {}) as { file_path?: unknown };
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    const isInsideHome = filePath !== '' && containPath(filePath, homeDir);
    if (!isInsideHome) return deny();
    // The home is also the next session's settings root (spec §6.2): a configuration surface
    // written here would load as that session's configuration.
    const isConfigSurface = isHomeConfigSurface(relative(homeDir, normalize(filePath)));
    return isConfigSurface ? deny(HOME_CONFIG_DENIED_REASON) : {};
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| Refuse Write/Edit to .claude/** and call it closed | Also restore after the session | A Bash write never arrives as a Write/Edit tool call (MEASURED: spec §4.4 e2). |
| Rely on the Claude Code CLI's own refusal of .claude/ writes | Refuse and restore in this repo's code | It is host-version behaviour and does not cover CLAUDE.md (MEASURED: spec §4.4 item 1). |
| Move cwd to a subdirectory of the write root | Keep cwd; restore its surface | CLAUDE.md is read from every ancestor of cwd (MEASURED: spec §4.5 m4). |
| Delete every configuration file found in cwd | Undo only the session's own changes | A person's or a test's pre-existing file (the R1 fixture) is legitimate configuration. |

## Scope

Applies to `core/supervisor/session.ts#runOneShotSession` (the supervisor's
`ruling`/`ratify`/`closing` sessions). Does NOT apply to the executor's card sessions
(`core/session.ts`): decision 4 trusts the executor with the repo, and anything it writes in its
worktree is reviewed in the card's PR (spec §10 F2). Configuration outside `cwd` that a session
with `Bash` can write (ancestors' `CLAUDE.md`, `~/.claude`) is outside this rule (spec §10 F1).

## Override

None without an owner ruling; changing it changes what a supervisor session may do.
