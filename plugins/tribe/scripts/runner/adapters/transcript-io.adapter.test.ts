import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLinesSync, readPrefixSync, readTranscriptRows } from './transcript-io.adapter.ts';

describe('readTranscriptRows (Oracle: fail-closed-edges.md — counted and skipped, never a throw)', () => {
  test('a malformed line and a bare array are counted and skipped by name; a blank line is not; nothing throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-io-'));
    try {
      const path = join(dir, 'session.jsonl');
      const content =
        [
          JSON.stringify({ type: 'assistant', message: { id: 'a' } }),
          JSON.stringify({ type: 'assistant', message: { id: 'b' } }),
          '{not json',
          JSON.stringify([1, 2, 3]),
          '',
        ].join('\n') + '\n';
      writeFileSync(path, content);

      let result: ReturnType<typeof readTranscriptRows> | undefined;
      expect(() => {
        result = readTranscriptRows(path);
      }).not.toThrow();

      expect(result!.rows.length).toBe(2);
      expect(result!.skippedLines).toBe(2);
      expect(result!.skippedReasons).toHaveLength(2);
      expect(result!.skippedReasons.some((r) => r === 'invalid_json')).toBe(true);
      expect(result!.skippedReasons.some((r) => r === 'not_object')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readLinesSync (streams — never readFileSync)', () => {
  test('a single line larger than the internal chunk size is still read whole, unsplit (measured: the largest real transcript line is 442,691 bytes)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-io-'));
    try {
      const path = join(dir, 'big.jsonl');
      const bigValue = 'x'.repeat(500_000); // bigger than the 64 KiB internal chunk
      const row = JSON.stringify({ type: 'assistant', message: { id: 'a', big: bigValue } });
      writeFileSync(path, `${row}\n`);
      const got = [...readLinesSync(path)];
      expect(got).toEqual([row]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a multi-byte UTF-8 character split across a chunk boundary decodes correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-io-'));
    try {
      const path = join(dir, 'utf8.jsonl');
      // Padding lands the multi-byte character's bytes exactly on the 64 KiB chunk boundary.
      const pad = 'a'.repeat(64 * 1024 - 5);
      const row = JSON.stringify({ type: 'assistant', message: { id: pad + '日本語' } });
      writeFileSync(path, `${row}\n`);
      const got = [...readLinesSync(path)];
      expect(got).toEqual([row]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readPrefixSync (S-P14: exactly N bytes, never the whole file)', () => {
  test('reads exactly the requested prefix and hashes exactly those bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-io-'));
    try {
      const path = join(dir, 'file.txt');
      writeFileSync(path, 'ABCDEFGHIJ');
      const got = readPrefixSync(path, 4);
      expect(got.actualBytes).toBe(4);
      expect(got.text).toBe('ABCD');
      expect(got.sha256).toBe(createHash('sha256').update('ABCD').digest('hex'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a request larger than the file caps at the actual size, never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-io-'));
    try {
      const path = join(dir, 'file.txt');
      writeFileSync(path, 'ABC');
      const got = readPrefixSync(path, 1000);
      expect(got.actualBytes).toBe(3);
      expect(got.text).toBe('ABC');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
