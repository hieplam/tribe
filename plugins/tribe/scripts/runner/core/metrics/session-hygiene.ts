// session-hygiene.ts — PURE core (pure-core.md): text in, counts out. No fs, no spawn, no glob;
// the edge (scripts/session-hygiene.ts) owns every effect.
//
// One definition of "filesystem-wide scan" lives here and is used TWICE: by the ratchet counter
// below and by `core/session.ts`'s decideScanGuardHook. Two definitions would drift.

/** A `find` root that means "the whole filesystem" or "the whole home directory". Ordered
 * longest-first so `$HOME/` is preferred over `$HOME`. */
const SCAN_ROOT = String.raw`(?:"\$HOME"|'\$HOME'|\$HOME\/?|~\/?|\/)`;

/** `find` must sit at a command position — start of string, or after a separator — so that
 * `grep -rn "find /"` (which merely mentions it) does not match. Leading option tokens
 * (`find -L / ...`) are skipped, because under-detecting is a bug. */
const FS_WIDE_SCAN_RE = new RegExp(
  String.raw`(?:^|[;&|(]|\s)find\s+(?:-[A-Za-z]+\s+)*` + SCAN_ROOT + String.raw`(?=\s|$)`,
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
