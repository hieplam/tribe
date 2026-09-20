// session-hygiene.ts — PURE core (pure-core.md): text in, counts out. No fs, no spawn, no glob;
// the edge (scripts/session-hygiene.ts) owns every effect.
//
// One definition of "filesystem-wide scan" lives here and is used TWICE: by the ratchet counter
// below and by `core/session.ts`'s decideScanGuardHook. Two definitions would drift.

/** A `find` root that means "the whole filesystem" or "the whole home directory" — unquoted, or
 * wrapped in a matching pair of single or double quotes (a real caller can spell either: `find /`,
 * `find '/'`, `find "$HOME"`). Each alternative starts with a distinct literal ('"', "'", '$',
 * '~', '/'), so match order is not load-bearing here. */
const ROOT_INNER = String.raw`(?:\$HOME\/?|\$\{HOME\}\/?|~\/?|\/)`;
const SCAN_ROOT = String.raw`(?:"${ROOT_INNER}"|'${ROOT_INNER}'|${ROOT_INNER})`;

/** A shell that EXECUTES the string it is handed, rather than merely mentioning `find` in text —
 * with an optional quote between the wrapper and the command (`sh -c "find / ..."`,
 * `eval 'find / ...'`). This is what distinguishes `sh -c "find / -name x"` (must match: it runs
 * find) from `echo "find / -name x"` (must not: it only echoes text) — both have a `"` right
 * before `find`, so the wrapper keyword before that quote is the only thing telling them apart. */
const SHELL_EXEC_WRAPPER = String.raw`(?:(?:sh|bash|zsh)\s+-c\s+|eval\s+)['"]?`;

/** Leading `NAME=value` environment assignments before the command (`FOO=bar find / ...`). */
const ENV_ASSIGNMENTS = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*`;

/** `find`, optionally invoked by its absolute path (`/usr/bin/find`, `/bin/find`). */
const FIND_BIN = String.raw`(?:\/usr\/bin\/|\/bin\/)?find`;

// The command-position separator includes a backtick, for command substitution
// (`` `find / -name x` ``). A literal backtick can't be written inside this file's OWN
// backtick-delimited `String.raw` templates without ending them, so this one piece is a plain
// string instead.
const COMMAND_SEPARATOR = '(?:^|[;&|(`]|\\s)';

/** `find` (optionally via a shell-executing wrapper and/or leading env assignments) must sit at a
 * command position — start of string, after a separator, or after a wrapper like `sh -c "` — so
 * that `grep -rn "find /"` (which merely mentions it) does not match. Leading option tokens
 * (`find -L / ...`) are skipped, because under-detecting is a bug. */
const FS_WIDE_SCAN_RE = new RegExp(
  COMMAND_SEPARATOR +
    String.raw`(?:${SHELL_EXEC_WRAPPER})?` +
    ENV_ASSIGNMENTS +
    FIND_BIN +
    String.raw`\s+(?:-[A-Za-z]+\s+)*` +
    SCAN_ROOT +
    String.raw`(?=\s|$)`,
);

/** PURE. True when this shell command runs a `find` rooted at the filesystem or home root.
 * Over-matching is by design; under-matching is a bug (plan Oracle).
 *
 * A quoted echo of the command (`echo "find / -name x"`) is NOT a command position: `find` there
 * is preceded by the opening `"`, not by a separator or whitespace, so the command-position
 * anchor in FS_WIDE_SCAN_RE already excludes it — no quote-stripping is needed, and stripping
 * would be wrong here anyway: it would also destroy a *real* quoted root argument
 * (`find "$HOME" -name x`), which must still match. */
export function isFilesystemWideScan(command: string): boolean {
  return FS_WIDE_SCAN_RE.test(command);
}

const UNKNOWN_SKILL_RE = /Unknown skill: ([A-Za-z0-9_-]+)/g;

export interface SessionHygieneCounts {
  unknownSkills: Record<string, number>;
  filesystemWideScans: number;
}

/** PURE. Counts both metrics over one chunk of log text (one file, or many concatenated).
 * Occurrence-based, never line-based: one JSONL line can carry several. */
export function countSessionHygiene(text: string): SessionHygieneCounts {
  const unknownSkills: Record<string, number> = {};
  for (const m of text.matchAll(UNKNOWN_SKILL_RE)) {
    const name = m[1] as string;
    unknownSkills[name] = (unknownSkills[name] ?? 0) + 1;
  }

  let filesystemWideScans = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    for (const command of bashCommands(line)) {
      if (isFilesystemWideScan(command)) filesystemWideScans += 1;
    }
  }
  return { unknownSkills, filesystemWideScans };
}

/** Every Bash tool_use command in one JSONL line. A line that is not valid JSON is SKIPPED, never
 * thrown on: campaign logs can end mid-write after a crash, and one truncated line must not cost
 * the whole measurement (fail-closed-edges.md obligation 1 — narrow catch, no crash). */
function bashCommands(line: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  const content = (parsed as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; name?: unknown; input?: { command?: unknown } };
    if (b?.type === 'tool_use' && b?.name === 'Bash' && typeof b?.input?.command === 'string') {
      out.push(b.input.command);
    }
  }
  return out;
}
