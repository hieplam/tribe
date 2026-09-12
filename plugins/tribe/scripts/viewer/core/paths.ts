// core/paths.ts — the containment primitive (spec §12.2, `fail-closed-edges` obligation 4) plus
// the fixed on-disk layout Claude Code writes under `~/.claude/projects` (spec §5.1, §7.6). Pure
// string math only: `node:path`'s `join`/`resolve`/`sep` never touch the filesystem or follow
// symlinks. `realpath` — the ONLY step that touches disk — is the adapter's act (task 15); this
// module judges only the strings it is handed.

import { join, resolve, sep } from 'node:path';

const MAX_SANITIZED_LENGTH = 200;

// The largest a single path COMPONENT (not a whole path) can be on any POSIX filesystem this
// server runs on. A segment longer than this can never be a real project/session/agent name
// Claude Code wrote, so `containedJoin` refuses it defensively — over-checking a shape that could
// never legitimately arrive is by design (spec §0's oracle), never a bug.
const NAME_MAX = 255;

function djb2Hash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function hashSuffix(name: string): string {
  // Mirror claude-code/src/utils/sessionStoragePortable.ts: prefer Bun.hash (wyhash) when
  // running under Bun, fall back to djb2 elsewhere. Both encode base36. Cross-runtime stability
  // matters only for paths >200 chars.
  const globalWithBun: { Bun?: { hash: (s: string) => number | bigint } } = globalThis as never;
  const maybeBun = globalWithBun.Bun;
  if (maybeBun && typeof maybeBun.hash === 'function') {
    return maybeBun.hash(name).toString(36);
  }
  return Math.abs(djb2Hash(name)).toString(36);
}

/**
 * Ported verbatim from Kanna's src/server/claude-pty/jsonl-path.adapter.ts:26-41
 * (sanitizePath + encodeCwd), minus the realpath call — that filesystem read
 * belongs to the Task 12 adapter. This module is pure string math only (D1).
 */
export function sanitizeProjectDirName(absPath: string): string {
  const normalized = absPath.normalize('NFC');
  const sanitized = normalized.replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= MAX_SANITIZED_LENGTH) return sanitized;
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hashSuffix(normalized)}`;
}

// --- Fixed on-disk layout (spec §5.1 diagram, §7.6): projectDir/session.jsonl,
// projectDir/session/subagents/agent-*.jsonl(+.meta.json), projectDir/session/tool-results/*. ---

export function transcriptPathOf(projectDir: string, sessionId: string): string {
  return join(projectDir, `${sessionId}.jsonl`);
}

export function subagentsDirOf(projectDir: string, sessionId: string): string {
  return join(projectDir, sessionId, 'subagents');
}

export function toolResultsDirOf(projectDir: string, sessionId: string): string {
  return join(projectDir, sessionId, 'tool-results');
}

function isSafeSegment(segment: string): boolean {
  if (segment.length === 0 || segment.length > NAME_MAX) return false;
  if (segment === '.' || segment === '..') return false;
  return !(segment.includes('/') || segment.includes('\\') || segment.includes('\x00'));
}

/**
 * Stage 1 — LEXICAL containment (spec §12.2). Pure string math: `path.resolve`, no filesystem
 * access, no symlink following. Refuses (returns `null`, never throws, never a partial path)
 * when any segment is empty, is exactly `.`/`..`, contains `/`, `\`, or a NUL byte, is longer
 * than a single POSIX path component can be, or when the lexically normalised join does not
 * start with `root + sep`. "Normalised" here means only that `.`/`..` segments are collapsed
 * textually — the OTHER sense of resolved (`realpath`, which follows symlinks and touches disk)
 * belongs to stage 2, `isContainedResolved`, deliberately a different function.
 */
export function containedJoin(root: string, ...segments: string[]): string | null {
  if (segments.some((segment) => !isSafeSegment(segment))) return null;
  const normalizedRoot = resolve(root);
  const joined = resolve(normalizedRoot, ...segments);
  if (joined !== normalizedRoot && !joined.startsWith(normalizedRoot + sep)) return null;
  return joined;
}

/**
 * Stage 2 — RESOLVED containment (D14/D32). `root` is the resolved projects directory, taken as
 * a PARAMETER — never derived here, because a containment root that could disagree with the scan
 * root is a hole with a configuration switch attached. `resolvedTarget` is the `realpath` the
 * adapter already computed (task 15); this function does no filesystem access itself. A target
 * that does not start with `root + sep` (or equal `root` exactly) is refused, whatever the
 * lexical stage decided. A `startsWith` WITHOUT the separator is the classic prefix-collision bug
 * (`/root-evil` reading as inside `/root`), so the separator is never optional here.
 */
export function isContainedResolved(root: string, resolvedTarget: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(resolvedTarget);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + sep);
}
