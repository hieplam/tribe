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

export type HomeConfigEntryKind = 'dir' | 'file' | 'symlink';

/** One entry of a snapshot. `path` is relative to the campaign home, `/`-separated. `content` is a
 * file's bytes as base64, a symlink's target verbatim (never resolved), or `''` for a directory. */
export interface HomeConfigEntry {
  path: string;
  kind: HomeConfigEntryKind;
  content: string;
}

/** Every entry the adapter's walk records (`adapters/home-config.adapter.ts#snapshotHomeConfig`). */
export type HomeConfigSnapshot = readonly HomeConfigEntry[];

/** `remove` runs first, deepest first; `write` runs second, shallowest first. */
export interface HomeConfigRestorePlan {
  remove: HomeConfigEntry[];
  write: HomeConfigEntry[];
}

const depthOf = (entry: HomeConfigEntry): number => entry.path.split('/').length;

/** PURE (spec §6.3). What undoes the difference between the snapshot taken before a session and
 * the one taken after it. An entry that is new, or whose kind changed, is removed; an entry of
 * `before` that is missing, or whose kind or content changed, is written back. So anything that
 * existed before the session — placed by a person or a test — is left exactly as it was. */
export function planHomeConfigRestore(before: HomeConfigSnapshot, after: HomeConfigSnapshot): HomeConfigRestorePlan {
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.map((entry) => [entry.path, entry]));

  const remove = after.filter((entry) => {
    const previous = beforeByPath.get(entry.path);
    const isNewOrReplaced = previous === undefined || previous.kind !== entry.kind;
    return isNewOrReplaced;
  });
  const write = before.filter((entry) => {
    const current = afterByPath.get(entry.path);
    const isMissingOrChanged = current === undefined || current.kind !== entry.kind || current.content !== entry.content;
    return isMissingOrChanged;
  });

  remove.sort((a, b) => depthOf(b) - depthOf(a)); // a new directory goes after its contents
  write.sort((a, b) => depthOf(a) - depthOf(b)); // a directory exists before its files
  return { remove, write };
}

export function isEmptyRestorePlan(plan: HomeConfigRestorePlan): boolean {
  return plan.remove.length === 0 && plan.write.length === 0;
}
