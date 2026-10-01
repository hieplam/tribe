import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doubleResultMessage, spawnExecutorDouble as spawnExecutorDoubleWithCard } from './executor-double.adapter.ts';

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

describe('doubleResultMessage — a double can replay a REAL result line (card runner-model-support)', () => {
  const tooOld = readFileSync(join(import.meta.dir, '..', 'fixtures', 'executor', 'result-claude-code-version-too-old.json'), 'utf8');
  test('a whole result line on stdout is passed through as the message, under the double\'s session id', () => {
    const m = doubleResultMessage(tooOld, 'double-1') as Record<string, unknown>;
    expect(m).toMatchObject({ type: 'result', subtype: 'success', is_error: true, api_error_status: 400, api_error_code: 'claude_code_version_too_old', session_id: 'double-1' });
  });
  test('plain text stays the final text of a success result, as before', () => {
    expect(doubleResultMessage('TASK_DONE T1 b\n', 'd')).toEqual({ type: 'result', subtype: 'success', session_id: 'd', result: 'TASK_DONE T1 b' });
  });
  test('JSON that is not a result message, or not JSON at all, stays plain text', () => {
    expect(doubleResultMessage('{"type":"assistant"}', 'd')).toMatchObject({ result: '{"type":"assistant"}' });
    expect(doubleResultMessage('{not json', 'd')).toMatchObject({ result: '{not json' });
  });
});
