/**
 * S-P14 (spec §15): the pinned-cut measurement behind the `transcript-metrics` subcommand's
 * baseline. Lives in `adapters/` — not `core/metrics/`, despite grouping conceptually with the
 * other metrics types in `core/metrics/model.ts` — because `measureAtCut`/`verifyBaseline`
 * open and hash a real file directly, with no injected IO seam: this task's own Oracle is
 * `fail-closed-edges.md`, not `pure-core.md`, for this one surface, and both functions are
 * exercised end to end against real files on disk (never a mock), exactly as
 * `fixtures-mirror-reality.md` asks of a tool whose entire point is "does this hold against a
 * REAL, moving transcript". `core/metrics/accumulate.ts#accumulate` still makes every
 * decision (classification, sums) — this file only reads bytes, hashes them, and classifies
 * lines through the shared pure `core/metrics/parse.ts#classifyLine`.
 *
 * Placement note (disclosed for review): the task brief that produced this file named its
 * location as `core/metrics/cut.ts`. That location is impossible without either (a) `cut.ts`
 * importing `node:fs`/`node:child_process` directly — banned by name, unconditionally, for
 * every file under `core/` (`structure.test.ts`, "core/** never contains a world-touching
 * module specifier, in any form") — or (b) weakening that structural test itself, which is
 * outside this task's fence and one of the 684 pre-existing tests required to stay green with
 * unchanged assertions. The brief's own literal Step 4 test calls `measureAtCut`/
 * `verifyBaseline` directly against real temp files with no injected IO argument at all, which
 * only an adapter (not a pure-core module) can honor. Moving the file to `adapters/` satisfies
 * the literal test verbatim, keeps `structure.test.ts` untouched, and keeps `core/metrics/**`
 * genuinely pure — see this Hunter's report for the full reasoning.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { accumulate } from '../core/metrics/accumulate.ts';
import { classifyLine } from '../core/metrics/parse.ts';
import type { BaselineEntry, CutInfo, SessionMetrics, SkipReason, VerifyResult } from '../core/metrics/model.ts';
import { errorCode } from '../core/errno.ts';

const CHUNK_SIZE = 64 * 1024;

/**
 * Reads exactly `min(requestedBytes ?? currentSize, currentSize)` bytes from the start of
 * `path`, in bounded chunks — never the whole file materialized as one decoded string
 * (measured: the largest single transcript line is 442,691 bytes; a real session is 4.6 MB).
 * Hashes the RAW bytes as they stream (S-P14: the pin is over bytes, not decoded text) and, in
 * the same pass, splits the window into complete '\n'-terminated lines and classifies each
 * (`core/metrics/parse.ts#classifyLine`). A trailing partial line inside the window (no
 * closing '\n' — an artifact of a byte-exact `--cut-bytes` boundary, or of an empty/no-newline
 * file) is dropped, uncounted: it was never a committed transcript row.
 */
function measureWindow(path: string, requestedBytes: number | null): {
  cut: CutInfo;
  rows: unknown[];
  lineCount: number;
  skippedLines: number;
  skippedReasons: SkipReason[];
} {
  const size = statSync(path).size;
  const target = requestedBytes === null ? size : Math.max(0, Math.min(requestedBytes, size));

  const fd = openSync(path, 'r');
  const hash = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  const rows: unknown[] = [];
  const skippedReasons: SkipReason[] = [];
  let skippedLines = 0;
  let lineCount = 0;
  let leftover = '';
  let readTotal = 0;

  try {
    const chunk = Buffer.alloc(CHUNK_SIZE);
    while (readTotal < target) {
      const want = Math.min(CHUNK_SIZE, target - readTotal);
      const n = readSync(fd, chunk, 0, want, readTotal);
      if (n === 0) break; // file shrank mid-read; report what was actually read
      const slice = chunk.subarray(0, n);
      hash.update(slice);
      leftover += decoder.write(slice);
      readTotal += n;

      let idx: number;
      while ((idx = leftover.indexOf('\n')) !== -1) {
        const raw = leftover.slice(0, idx);
        leftover = leftover.slice(idx + 1);
        lineCount++;
        const outcome = classifyLine(raw, lineCount);
        if (outcome.kind === 'row') rows.push(outcome.value);
        else if (outcome.kind === 'skip') {
          skippedLines++;
          skippedReasons.push(outcome.reason);
        }
      }
    }
  } finally {
    closeSync(fd);
  }

  return {
    cut: { lines: lineCount, bytes: readTotal, sha256: hash.digest('hex') },
    rows,
    lineCount,
    skippedLines,
    skippedReasons,
  };
}

/**
 * Measures a session's transcript at a cut: `bytesOrNull === null` pins the file's CURRENT
 * length (the default "measure what's there now" case); a number pins exactly that many
 * bytes. Every call — cut or not — returns a `cut` (S-P14: no baseline entry is ever
 * unpinned).
 */
export function measureAtCut(path: string, bytesOrNull: number | null): { cut: CutInfo; metrics: SessionMetrics } {
  const { cut, rows, lineCount, skippedLines, skippedReasons } = measureWindow(path, bytesOrNull);
  const metrics = accumulate(rows);
  metrics.lines = lineCount;
  metrics.skippedLines = skippedLines;
  metrics.skippedReasons = skippedReasons;
  return { cut, metrics };
}

/**
 * Every `SessionMetrics` field that is an actual MEASUREMENT — `sessionId` is deliberately
 * excluded (Fix 3): it is an identity label the caller (`cli/main.ts#runTranscriptMetrics`)
 * fills in after `accumulate()` returns, never something `measureAtCut` itself measures, and
 * `accumulate()`'s own neutral default (`sessionId: ''`, see `core/metrics/accumulate.ts`) is
 * never what a re-measurement at verify time would naturally reproduce. Order matches
 * `SessionMetrics`'s own declaration in `core/metrics/model.ts`, so "the first differing
 * field" is a stable, reproducible fact, not iteration-order noise.
 */
const COMPARED_METRIC_FIELDS: ReadonlyArray<Exclude<keyof SessionMetrics, 'sessionId'>> = [
  'lines', 'skippedLines', 'skippedReasons', 'turns', 'tokens', 'perClass',
  'firstContext', 'lastContext', 'maxContext', 'monitorArms', 'monitorExpiries',
  'firstAt', 'lastAt', 'babysittingShare', 'sidechain',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The first field (in `COMPARED_METRIC_FIELDS` order) where `remeasured` disagrees with
 * `recorded`, or `null` when every compared field matches. Defense in depth (fail-closed-edges.md
 * obligation 1): `validateBaselineFile` is the primary guard against a non-object `recorded`
 * (deleted/tampered `metrics`), but this function is itself exported and called directly from
 * tests with no validator in front of it, so a non-object `recorded` must be caught HERE too,
 * never crash on `recorded[field]`. */
function firstMismatchedMetricField(remeasured: SessionMetrics, recorded: SessionMetrics): string | null {
  if (!isPlainObject(recorded)) return COMPARED_METRIC_FIELDS[0];
  for (const field of COMPARED_METRIC_FIELDS) {
    if (JSON.stringify(remeasured[field]) !== JSON.stringify(recorded[field])) return field;
  }
  return null;
}

/** Fix 4 (fail-closed-edges.md obligation 1): a real fs failure reading the transcript mid-verify
 * (EISDIR — `entry.path` is a directory; EACCES; an ENOENT race after the exists-check; ELOOP —
 * a symlink cycle) becomes this typed per-entry status, never an escaping traceback. */
function unreadableResult(sessionId: string, path: string, err: unknown): VerifyResult {
  const code = errorCode(err) ?? 'UNKNOWN';
  return { sessionId, status: 'unreadable', detail: `${path} could not be read (${code})` };
}

/**
 * Re-measures every entry's transcript at its RECORDED cut and compares — never re-baselines
 * (S-P14, spec §15). The prefix hash proves the BYTES are unchanged; it says nothing about
 * whether the committed `metrics` were ever hand-edited or drifted from what those bytes
 * actually measure (Fix 3, spec §15's --verify table: "metrics compared field by field"), so a
 * hash match is followed by a full field-by-field re-check before `verified` is returned.
 */
export function verifyBaseline(entries: BaselineEntry[]): VerifyResult[] {
  return entries.map((entry): VerifyResult => {
    let size: number;
    try {
      if (!existsSync(entry.path)) {
        return { sessionId: entry.sessionId, status: 'absent', detail: `transcript not found at ${entry.path}` };
      }
      size = statSync(entry.path).size;
    } catch (err) {
      return unreadableResult(entry.sessionId, entry.path, err);
    }
    if (size < entry.cut.bytes) {
      return {
        sessionId: entry.sessionId,
        status: 'truncated',
        detail: `${entry.path} is now ${size} bytes, shorter than the pinned cut of ${entry.cut.bytes} bytes`,
      };
    }

    let recut: CutInfo;
    let remeasured: SessionMetrics;
    try {
      const measured = measureAtCut(entry.path, entry.cut.bytes);
      recut = measured.cut;
      remeasured = measured.metrics;
    } catch (err) {
      return unreadableResult(entry.sessionId, entry.path, err);
    }

    if (recut.sha256 !== entry.cut.sha256) {
      return {
        sessionId: entry.sessionId,
        status: 'prefix_mismatch',
        detail: `the first ${entry.cut.bytes} bytes of ${entry.path} no longer match the pinned cut — the append-only assumption failed`,
      };
    }

    const mismatchedField = firstMismatchedMetricField(remeasured, entry.metrics);
    if (mismatchedField !== null) {
      return {
        sessionId: entry.sessionId,
        status: 'metrics_mismatch',
        detail: `recorded metric "${mismatchedField}" does not match what the pinned cut re-measures to`,
      };
    }

    return { sessionId: entry.sessionId, status: 'verified' };
  });
}

const CUT_SHA256_HEX = /^[0-9a-f]{64}$/;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Fix 4 (fail-closed-edges.md obligation 1): the `--verify` baseline file is hostile input —
 * arbitrary JSON from disk — and this is the edge that refuses a malformed one with ONE typed
 * message, never a throw (a malformed `cut.lines`/missing `sessionId` would otherwise surface
 * as a TypeError deep inside `verifyBaseline`/`measureAtCut`, not a usage diagnostic). Pure: no
 * I/O — `data` is already-parsed JSON, so this function is unit-testable with plain values.
 */
export function validateBaselineFile(data: unknown): { entries: BaselineEntry[] } | { error: string } {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'baseline file must be a JSON object' };
  }
  const file = data as Record<string, unknown>;

  if (file['v'] !== 1) {
    return { error: `baseline file has unsupported "v" (expected 1, got ${JSON.stringify(file['v'])})` };
  }
  if (typeof file['tool'] !== 'string' || file['tool'].length === 0) {
    return { error: 'baseline file "tool" must be a non-empty string' };
  }
  if (!Array.isArray(file['sessions']) || file['sessions'].length === 0) {
    return { error: 'baseline file "sessions" must be a non-empty array' };
  }

  const entries: BaselineEntry[] = [];
  for (let i = 0; i < file['sessions'].length; i++) {
    const raw = file['sessions'][i];
    if (raw === null || typeof raw !== 'object') {
      return { error: `sessions[${i}] must be an object` };
    }
    const entry = raw as Record<string, unknown>;

    if (typeof entry['sessionId'] !== 'string') {
      return { error: `sessions[${i}].sessionId must be a string` };
    }
    if (typeof entry['path'] !== 'string') {
      return { error: `sessions[${i}].path must be a string` };
    }
    const cut = entry['cut'];
    if (cut === null || typeof cut !== 'object') {
      return { error: `sessions[${i}].cut must be an object` };
    }
    const c = cut as Record<string, unknown>;
    if (!isPositiveInteger(c['lines'])) {
      return { error: `sessions[${i}].cut.lines must be a positive integer` };
    }
    if (!isPositiveInteger(c['bytes'])) {
      return { error: `sessions[${i}].cut.bytes must be a positive integer` };
    }
    if (typeof c['sha256'] !== 'string' || !CUT_SHA256_HEX.test(c['sha256'])) {
      return { error: `sessions[${i}].cut.sha256 must be 64 lowercase hex characters` };
    }
    // Blocker fix (fail-closed-edges.md obligation 1): an entry with `metrics` deleted/
    // non-object used to pass validation, then throw a TypeError deep inside
    // firstMismatchedMetricField (`recorded[field]` on a non-object `recorded`).
    if (!isPlainObject(entry['metrics'])) {
      return { error: `sessions[${i}].metrics must be an object` };
    }

    entries.push(entry as unknown as BaselineEntry);
  }

  return { entries };
}
