/**
 * The transcript reading edge (Task 3, spec §15, card `## Measure first`). Streams JSONL
 * line by line — never `readFileSync` (Oracle: `fail-closed-edges.md`; measured, the largest
 * single transcript line is 442,691 bytes and a real session is 4.6 MB). A line that fails to
 * parse is counted and skipped with a typed reason
 * (`core/metrics/parse.ts#classifyLine`) — never a traceback. `process.env` is read here, and
 * only here for this feature — adapters are exactly where it is allowed (`structure.test.ts`).
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { join } from 'node:path';
import { classifyLine } from '../core/metrics/parse.ts';
import type { TranscriptIO } from '../ports/ports.ts';
import { errorCode } from '../core/errno.ts';

const CHUNK_SIZE = 64 * 1024;

/**
 * Streams `path` one '\n'-terminated line at a time, decoding with a stateful
 * `StringDecoder` so a multi-byte UTF-8 character split across a chunk boundary decodes
 * correctly (the same primitive Node's own streams use internally). Peak memory is bounded
 * by `CHUNK_SIZE` plus at most one line's worth of leftover — never the whole file.
 */
export function* readLinesSync(path: string): Generator<string> {
  const fd = openSync(path, 'r');
  const decoder = new StringDecoder('utf8');
  try {
    const chunk = Buffer.alloc(CHUNK_SIZE);
    let leftover = '';
    while (true) {
      const bytesRead = readSync(fd, chunk, 0, CHUNK_SIZE, null);
      if (bytesRead === 0) break;
      leftover += decoder.write(chunk.subarray(0, bytesRead));
      let idx: number;
      while ((idx = leftover.indexOf('\n')) !== -1) {
        yield leftover.slice(0, idx);
        leftover = leftover.slice(idx + 1);
      }
    }
    leftover += decoder.end();
    if (leftover.length > 0) yield leftover;
  } finally {
    closeSync(fd);
  }
}

/**
 * Reads exactly `min(bytes, currentFileSize)` bytes from the start of `path` — never more,
 * never the whole file when a smaller `bytes` is requested (S-P14: this is what makes a
 * reproducible cut possible). Hashes the RAW bytes, not the decoded text, so the pin is exact
 * across any encoding boundary.
 */
export function readPrefixSync(path: string, bytes: number): { text: string; sha256: string; actualBytes: number } {
  const size = statSync(path).size;
  const toRead = Math.max(0, Math.min(bytes, size));
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(toRead);
    let readTotal = 0;
    while (readTotal < toRead) {
      const n = readSync(fd, buf, readTotal, toRead - readTotal, readTotal);
      if (n === 0) break; // shrank mid-read; report what was actually read
      readTotal += n;
    }
    const slice = buf.subarray(0, readTotal);
    return {
      text: slice.toString('utf8'),
      sha256: createHash('sha256').update(slice).digest('hex'),
      actualBytes: readTotal,
    };
  } finally {
    closeSync(fd);
  }
}

export interface ReadTranscriptRowsResult {
  rows: unknown[];
  lines: number;
  skippedLines: number;
  skippedReasons: string[];
}

/**
 * Streams every line of `path`, classifying each (`core/metrics/parse.ts#classifyLine`) — the
 * only function in this file allowed to interpret line content. Never throws on malformed
 * input (fail-closed-edges obligation 1): every JSON.parse failure or non-object row is
 * counted and skipped, not propagated. A blank line is counted in `lines` but is never a row
 * or a skip.
 */
export function readTranscriptRows(path: string): ReadTranscriptRowsResult {
  const rows: unknown[] = [];
  const skippedReasons: string[] = [];
  let skippedLines = 0;
  let lines = 0;

  for (const raw of readLinesSync(path)) {
    lines++;
    const outcome = classifyLine(raw, lines);
    if (outcome.kind === 'row') rows.push(outcome.value);
    else if (outcome.kind === 'skip') {
      skippedLines++;
      skippedReasons.push(outcome.reason);
    }
  }

  return { rows, lines, skippedLines, skippedReasons };
}

export function buildTranscriptIo(): TranscriptIO {
  return {
    readLines: (path) => readLinesSync(path),
    readPrefix: (path, bytes) => readPrefixSync(path, bytes),
    fileExists: (path) => existsSync(path),
    listProjectDirs: (root) => {
      let names: string[];
      try {
        names = readdirSync(root);
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') return [];
        throw err;
      }
      const dirs: string[] = [];
      for (const name of names) {
        const full = join(root, name);
        try {
          if (statSync(full).isDirectory()) dirs.push(full);
        } catch (err) {
          if (errorCode(err) === 'ENOENT') continue; // raced with a delete
          throw err;
        }
      }
      return dirs;
    },
    // viewer README, "## Run it" (verbatim): "$CLAUDE_CONFIG_DIR/projects when
    // CLAUDE_CONFIG_DIR is set and non-empty, else $HOME/.claude/projects. An empty
    // CLAUDE_CONFIG_DIR= is treated as unset."
    projectsRoot: () => {
      const configDir = process.env['CLAUDE_CONFIG_DIR'];
      if (configDir !== undefined && configDir.length > 0) return join(configDir, 'projects');
      return join(process.env['HOME'] ?? '', '.claude', 'projects');
    },
  };
}
