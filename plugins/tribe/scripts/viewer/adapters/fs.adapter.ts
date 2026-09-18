// adapters/fs.adapter.ts — the filesystem adapter for `~/.claude/projects` (spec §4/§5, D13, D14).
// Every function here is a plain, bounded READ; nothing is ever written, renamed, deleted, locked,
// or executed (card G4). This is an impure EDGE (`pure-core.md`): it performs exactly the two acts
// spec §5.3 grants it — `stat` and "read bytes `[a, b)`" — and decides nothing. Which bytes form a
// complete line (`core/window.ts#completeLines`), the tail state transition
// (`core/tail.ts#advanceTail`), cache policy (`core/cache.ts`), and whether a resolved path is
// contained (`core/paths.ts#isContainedResolved`) all live elsewhere; this file never imports any
// of them.
//
// D13 — the adapter decodes NOTHING on the transcript byte-range path: `readRange`, `readHead` and
// `readTail` return raw `Uint8Array`s, never a decoded string. A multi-byte UTF-8 character can
// straddle two calls while the file is still being appended (F44); decoding each range
// independently would turn the split character into `U+FFFD` on both sides and lose it
// permanently. Decoding — with a streaming, stateful decoder that carries the incomplete trailing
// byte sequence forward — is the CALLER's job, because only the caller (the poller, one tracked
// transcript per tailed file) holds the per-file state such a decoder must live alongside.
//
// `readTextCapped` is the one function here that DOES decode — deliberately, because it is never
// used on a live-tailed transcript path: it reads a small, fully-written, bounded artifact (a
// subagent `.meta.json` sidecar, a title/cwd fallback) whole, refusing outright past its cap
// rather than ever returning a partial prefix that could be mistaken for the whole file.
//
// Every `*OrNull`/`OrEmpty` primitive narrows its catch to exactly the two filesystem outcomes
// that mean "this artifact is not there to read" — `ENOENT` (missing) and `EACCES` (present but
// unreadable) — and re-throws anything else (`fail-closed-edges` obligation 1): a permissions bug
// must never look identical to an empty campaign. `readRange` alone does NOT catch: a genuine read
// failure there is load-bearing (the poller turns it into an `error` SSE frame), so it must
// propagate, never be silently swallowed into an empty read.
import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { FileObservation } from '../core/model.ts';

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** `true` only for the two codes that mean "not there to read" — missing (`ENOENT`) or present
 * but unreadable (`EACCES`). Anything else is a genuine, unexpected failure and must propagate. */
function isAbsent(err: unknown): boolean {
  return isErrnoException(err) && (err.code === 'ENOENT' || err.code === 'EACCES');
}

/** The errno codes a `realpath` RESOLUTION can legitimately fail with when the path does not name a
 * real, reachable target — a missing entry (`ENOENT`), a symlink loop (`ELOOP`), a non-directory
 * component (`ENOTDIR`), an unreadable ancestor (`EACCES`), or an over-long name (`ENAMETOOLONG`).
 * Every one of these means "this is not a real target to contain" and must FAIL CLOSED to `null`,
 * never crash a request: a hostile symlink loop under a session directory would otherwise throw a
 * traceback straight through the HTTP handler (C1, `fail-closed-edges` obligation 4). The catch
 * stays NARROW (obligation 1): a code outside this set is genuinely unexpected and still propagates. */
const REALPATH_FAILURE_CODES = new Set(['ENOENT', 'ELOOP', 'ENOTDIR', 'EACCES', 'ENAMETOOLONG']);
function isRealpathFailure(err: unknown): boolean {
  return isErrnoException(err) && typeof err.code === 'string' && REALPATH_FAILURE_CODES.has(err.code);
}

/** Missing -> `null`. Real file -> a `FileObservation` whose `inode` is genuinely `st.ino` (never
 * a fabricated stand-in — the rotation trigger of `core/tail.ts#advanceTail` is unsound without
 * the real value). */
export function statOrNull(path: string): FileObservation | null {
  try {
    const st = statSync(path);
    return {
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
      inode: st.ino,
      birthtimeMs: st.birthtimeMs,
    };
  } catch (err) {
    if (isAbsent(err)) return null;
    throw err;
  }
}

/** Missing directory -> `[]`. Real entries, unresolved — a symlinked entry's name is returned
 * as-is; whether it may be READ is a later, separate decision (D14, `core/paths.ts`). */
export function listDirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if (isAbsent(err)) return [];
    throw err;
  }
}

/** `true` iff `path` is a readable directory. A single `readdir` distinguishes a valid, readable
 * directory (`true`) from missing / not-a-directory (`ENOTDIR`) / unreadable (`EACCES`) — all
 * `false`. This is the DELIBERATE OPPOSITE of `listDirOrEmpty`, which folds missing/unreadable into
 * an empty result: validating a user-supplied config root at boot (D32a) must REFUSE all three
 * failure modes rather than silently treat them as "empty" and hand a sandboxed user someone else's
 * sessions. Lives in the adapter (never in `serve.ts`) so the composition root names no `node:fs`
 * import of its own (D16). The catch stays narrow (obligation 1): only a real filesystem errno is
 * `false`; anything else propagates. */
export function isReadableDir(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch (err) {
    if (isErrnoException(err)) return false;
    throw err;
  }
}

/** Reads exactly the bytes in `[start, end)` of `path`, RAW — never decoded here. Throws on a
 * genuine read failure: callers (the poller) catch it and turn it into an `error` frame — that
 * throw is load-bearing, never swallowed here (F44 — see the module doc comment above). */
export function readRange(path: string, start: number, end: number): Uint8Array {
  const length = Math.max(0, end - start);
  if (length === 0) return new Uint8Array(0);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    const bytesRead = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

/** The first `maxBytes` of `path`, raw. A missing file degrades to an empty read (the ordinary
 * race between a directory listing and a bounded title/cwd read) rather than throwing — unlike
 * `readRange`, which the poller calls only after its own `stat` has already confirmed the file is
 * there. Decides no line boundary: a window landing mid-line comes back mid-line (`core/window.ts`
 * decides that, not this function). */
export function readHead(path: string, maxBytes: number): Uint8Array {
  const obs = statOrNull(path);
  if (obs === null) return new Uint8Array(0);
  return readRange(path, 0, Math.min(obs.sizeBytes, maxBytes));
}

/** The last `maxBytes` of `path`, raw. Same missing-file degradation as `readHead`, same
 * no-line-boundary-decision discipline. */
export function readTail(path: string, maxBytes: number): Uint8Array {
  const obs = statOrNull(path);
  if (obs === null) return new Uint8Array(0);
  const start = Math.max(0, obs.sizeBytes - maxBytes);
  return readRange(path, start, obs.sizeBytes);
}

/** Reads a small, fully-materialized text file whole, refusing (returning `null`) rather than
 * truncating when its size exceeds `capBytes` — never on a live-tailed transcript path (see module
 * doc comment; D13 is about `readRange`/`readHead`/`readTail`, not this function).
 *
 * Distinguishes exactly two outcomes and never conflates them (`fail-closed-edges` obligation 1):
 * the file is absent or unreadable (`null`, from THIS function's own narrow catch on the stat and
 * the read) versus the file read successfully but its CONTENT is malformed — that second outcome
 * never originates here, because this function never parses anything; a caller's own `JSON.parse`
 * (or whatever this text is fed to) fails on its own, separately, with its own distinguishable
 * error. One catch-all wrapping both the read and a parse together is exactly the anti-pattern
 * this split rules out. */
export function readTextCapped(path: string, capBytes: number): string | null {
  const obs = statOrNull(path);
  if (obs === null) return null;
  if (obs.sizeBytes > capBytes) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (isAbsent(err)) return null;
    throw err;
  }
}

/** Resolves a symlink — or an ordinary path — to its real, canonical form. `null` for any
 * resolution failure that means "not a real, reachable target": a broken symlink or missing path
 * (`ENOENT`), a symlink LOOP (`ELOOP`), a non-directory component (`ENOTDIR`), an unreadable
 * ancestor (`EACCES`), or an over-long name (`ENAMETOOLONG`) — refused WITHOUT a read, before any
 * containment check runs (D14). Failing closed here is what keeps a hostile symlink loop from
 * throwing a traceback through the HTTP handler (C1). The catch stays narrow (obligation 1): a code
 * outside `REALPATH_FAILURE_CODES` is genuinely unexpected and propagates. */
export function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (err) {
    if (isRealpathFailure(err)) return null;
    throw err;
  }
}
