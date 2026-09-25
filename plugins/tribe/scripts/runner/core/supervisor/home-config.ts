/**
 * The campaign home's Claude Code configuration surface (card supervisor-home-settings-containment,
 * spec §6). A supervisor session's `cwd` is its campaign home, so whatever Claude Code loads from
 * `cwd` — the `project`/`local` settings tiers, memory files, project skills, MCP servers — is
 * configuration for the NEXT session in that home (MEASURED, spec §4). This module is the one
 * definition of that surface, used by the write-refusal hooks (`permit.ts`) and by the restore
 * that runs after every session (`session.ts`, `adapters/home-config.adapter.ts`).
 *
 * PURE (`pure-core.md`): strings in, a boolean out; no file system.
 */

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
  const isMemoryFile = name.startsWith('claude') && name.endsWith('.md');
  // A project MCP server's command runs at session start (MEASURED, spec §4.3 m3).
  const isMcpConfig = name === '.mcp.json';
  return isInsideDotClaude || isMemoryFile || isMcpConfig;
}
