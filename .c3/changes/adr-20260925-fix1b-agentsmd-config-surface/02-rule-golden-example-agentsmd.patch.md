---
target: rule-session-cwd-config-restored
scope: block
base: rule-session-cwd-config-restored#n2450@v1:sha256:4cfe35e1fcfd4681cc3118aab169d838d247258b76716b0328e701297dc5932d
---
ts
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
