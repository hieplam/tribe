---
target: rule-session-cwd-config-restored
scope: block
base: rule-session-cwd-config-restored#n2445@v1:sha256:a1cf667b5fd809cff4d6858bb8111b9bc774a13a514bf8fc59ef27b3a07b8126
---
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
