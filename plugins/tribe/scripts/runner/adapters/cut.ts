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
import type { BaselineEntry, CutInfo, SessionMetrics, VerifyResult } from '../core/metrics/model.ts';

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
  skippedReasons: string[];
} {
  const size = statSync(path).size;
  const target = requestedBytes === null ? size : Math.max(0, Math.min(requestedBytes, size));

  const fd = openSync(path, 'r');
  const hash = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  const rows: unknown[] = [];
  const skippedReasons: string[] = [];
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
 * Re-measures every entry's transcript at its RECORDED cut and compares — never re-baselines
 * (S-P14, spec §15). A hash match implies byte-identical content, which implies identical
 * `accumulate()` output by construction, so `verified` never re-checks metrics field by
 * field.
 */
export function verifyBaseline(entries: BaselineEntry[]): VerifyResult[] {
  return entries.map((entry): VerifyResult => {
    if (!existsSync(entry.path)) {
      return { sessionId: entry.sessionId, status: 'absent', detail: `transcript not found at ${entry.path}` };
    }
    const size = statSync(entry.path).size;
    if (size < entry.cut.bytes) {
      return {
        sessionId: entry.sessionId,
        status: 'truncated',
        detail: `${entry.path} is now ${size} bytes, shorter than the pinned cut of ${entry.cut.bytes} bytes`,
      };
    }
    const recut = measureWindow(entry.path, entry.cut.bytes).cut;
    if (recut.sha256 !== entry.cut.sha256) {
      return {
        sessionId: entry.sessionId,
        status: 'prefix_mismatch',
        detail: `the first ${entry.cut.bytes} bytes of ${entry.path} no longer match the pinned cut — the append-only assumption failed`,
      };
    }
    return { sessionId: entry.sessionId, status: 'verified' };
  });
}
