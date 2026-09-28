import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnExecutorDouble as spawnExecutorDoubleWithCard } from './executor-double.adapter.ts';

const spawnExecutorDouble = (script: string, home: string, params: Parameters<typeof spawnExecutorDoubleWithCard>[3]) =>
  spawnExecutorDoubleWithCard(script, home, 'C1', params);

const dir = mkdtempSync(join(tmpdir(), 'rdo-exec-double-'));
const script = join(dir, 'double.sh');
writeFileSync(script, '#!/usr/bin/env bash\nset -euo pipefail\nwhile [[ $# -gt 0 ]]; do case "$1" in --prompt-file) f="$2"; shift 2;; *) shift;; esac; done\nhead -1 "$f" | sed "s/^## This turn: task \\([^ ]*\\).*/TASK_DONE \\1 b/"\n');
chmodSync(script, 0o755);
const params = (resume?: string) => ({ prompt: '## This turn: task T4 — x\nbody', options: { resume } as never });

describe('spawnExecutorDouble', () => {
  test('yields init then a success result whose text is the script stdout', async () => {
    const msgs = [];
    for await (const m of spawnExecutorDouble(script, '/home', params())) msgs.push(m);
    expect(msgs[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(msgs[1]).toMatchObject({ type: 'result', subtype: 'success', result: 'TASK_DONE T4 b' });
  });
  test('a resumed turn keeps the resumed session id', async () => {
    const msgs = [];
    for await (const m of spawnExecutorDouble(script, '/home', params('sess-9'))) msgs.push(m);
    expect(msgs[0]).toMatchObject({ session_id: 'sess-9' });
  });
  test('a non-zero exit throws (consumeSession turns it into a typed error)', async () => {
    const failing = join(dir, 'fail.sh');
    writeFileSync(failing, '#!/usr/bin/env bash\nexit 3\n');
    chmodSync(failing, 0o755);
    await expect((async () => { for await (const _ of spawnExecutorDouble(failing, '/home', params())) { /* drain */ } })()).rejects.toThrow(/exited 3/);
  });
  test('passes the card id in argv', async () => {
    const echo = join(dir, 'argv.sh');
    writeFileSync(echo, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
    chmodSync(echo, 0o755);
    const msgs = [];
    for await (const m of spawnExecutorDoubleWithCard(echo, '/home', 'C7', params())) msgs.push(m);
    expect((msgs[1] as { result: string }).result.split('\n')).toContain('--card');
    expect((msgs[1] as { result: string }).result).toMatch(/--card\nC7(?:\n|$)/);
  });
});
