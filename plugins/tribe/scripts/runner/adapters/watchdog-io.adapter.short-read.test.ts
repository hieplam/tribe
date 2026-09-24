// FIX S5 (audit round, final): readSync's return value (the number of bytes actually read)
// was discarded - readTail always stringified the FULL Buffer.alloc(length), so a short read
// left the untouched tail as NUL bytes baked into the string. A short read is not a
// theoretical worry here: readTail's own `length` is computed from a statSync taken BEFORE
// the read, so a file that shrinks between the two calls (log rotation, concurrent truncate)
// reproduces it exactly. The newest (most authoritative) log line then fails JSON.parse and
// is silently skipped - the same quota under-detection this card exists to remove.
//
// This lives in its OWN file (not watchdog-io.adapter.test.ts) because mock.module must
// replace node:fs BEFORE watchdog-io.adapter.ts's own `import { readSync } from 'node:fs'`
// resolves - the sibling file already imports the adapter statically at its top, so the mock
// would install too late to affect that binding.
import { afterAll, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `rule-temp-dir-cleanup`: every dir `tmp()` hands out is recorded here and removed in the
// afterAll below, so a failing assertion never leaks the tree it created.
const tmpDirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wd-adapter-short-read-'));
  tmpDirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('buildWatchdogIo.readTail - a short readSync (S5)', () => {
  test('a readSync that returns fewer bytes than requested never NUL-pads the result', async () => {
    const real = require('node:fs') as typeof import('node:fs');
    // `mock.module` replaces 'node:fs' in the GLOBAL module registry for the whole `bun test`
    // process, not just this file — every other suite sharing the run would silently start
    // seeing "short" reads too. The try/finally below is load-bearing: it MUST restore the
    // real module before this test returns, mocked or not.
    mock.module('node:fs', () => ({
      ...real,
      // Simulate the OS returning fewer bytes than asked for (a short read: log rotation /
      // concurrent truncate between readTail's own statSync and this call, or simply a read
      // interrupted before completion) - real behaviour readSync is legally allowed to
      // exhibit, and the adapter must not assume otherwise.
      readSync: (
        fd: number, buffer: Buffer, offset: number, length: number, position: number,
      ): number => {
        const shortLength = Math.max(0, length - 5);
        real.readSync(fd, buffer, offset, shortLength, position);
        return shortLength;
      },
    }));

    try {
      const { buildWatchdogIo } = await import(
        `./watchdog-io.adapter.ts?s5-short-read-probe=${Date.now()}`
      );
      const io = buildWatchdogIo();
      const dir = tmp();
      const file = join(dir, 'card-sid.log');
      writeFileSync(file, 'ABCDEFGHIJ'); // 10 bytes; the short read yields only the first 5

      const out = io.readTail(file, 10);

      // Before the fix: buffer.toString('utf8') stringifies the FULL allocated buffer, so the
      // untouched tail (bytes readSync never wrote) surfaces as literal NUL characters baked
      // into the string - corrupting/truncating the newest log line mid-parse.
      expect(out).toBe('ABCDE');
    } finally {
      mock.module('node:fs', () => real);
    }
  });
});
