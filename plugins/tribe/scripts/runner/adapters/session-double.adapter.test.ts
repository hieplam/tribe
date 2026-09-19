// adapters/session-double.adapter.test.ts — the session-double seam's bounded-subprocess
// guarantee (fail-closed-edges.md obligation 3). The E2E shell suites already exercise the happy
// path against a real double; this unit test pins the one thing they cannot show deterministically:
// a WEDGED double is killed at the wall-clock cap and surfaces as a throw (which consumeOneShot
// turns into a typed 'failed'), never an unbounded hang stalling a supervisor tick.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSessionDouble } from './session-double.adapter.ts';

let tmp: string;
let fastScript: string;
let wedgeScript: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'session-double-adapter-'));
  fastScript = join(tmp, 'fast.sh');
  writeFileSync(fastScript, '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(fastScript, 0o755);
  wedgeScript = join(tmp, 'wedge.sh');
  writeFileSync(wedgeScript, '#!/usr/bin/env bash\nsleep 30\n'); // never exits within the test cap
  chmodSync(wedgeScript, 0o755);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('spawnSessionDouble', () => {
  test('a double that exits 0 yields the init + success pair consumeOneShot needs', async () => {
    const messages = [];
    for await (const m of spawnSessionDouble(fastScript, tmp, 'ruling')) {
      messages.push(m);
    }
    expect(messages.map((m) => `${m.type}/${(m as { subtype?: string }).subtype}`)).toEqual([
      'system/init',
      'result/success',
    ]);
  });

  test('a wedged double is killed at timeoutMs and throws (bounded, obligation 3)', async () => {
    const start = Date.now();
    const drain = async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _m of spawnSessionDouble(wedgeScript, tmp, 'ruling', 300)) {
        // the wedge never yields a message — the timeout kill throws before the first yield
      }
    };
    await expect(drain()).rejects.toThrow(/exited/);
    // Proof the bound (not the 30s sleep) ended it: well under the wedge's own runtime.
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
