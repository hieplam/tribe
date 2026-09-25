// Tests for home-config.adapter.ts (card supervisor-home-settings-containment, spec §6.3) — the
// real file system, in throwaway homes removed in afterEach (rule-temp-dir-cleanup). Both
// spellings of a macOS temp home are exercised (fixtures-mirror-reality.md): the raw tmpdir path
// (/var/folders/…, itself behind a symlink) and its realpath (/private/var/folders/…).
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotHomeConfig } from './home-config.adapter.ts';

const created: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function plantHome(home: string): void {
  writeFileSync(join(home, 'answers.md'), '# answers\n');
  mkdirSync(join(home, 'runs', 'r1', 'logs'), { recursive: true });
  writeFileSync(join(home, 'runs', 'r1', 'logs', 'claude.log'), 'x');
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'settings.local.json'), '{}');
  writeFileSync(join(home, 'CLAUDE.md'), 'memo');
  mkdirSync(join(home, 'escalations'));
  writeFileSync(join(home, 'escalations', 'CLAUDE.md'), 'nested');
  writeFileSync(join(home, 'escalations', 'card-1.md'), 'q');
  writeFileSync(join(home, '.mcp.json'), '{}');
}

describe('snapshotHomeConfig', () => {
  test('an empty home has an empty snapshot', () => {
    expect(snapshotHomeConfig(tempDir('hc-empty-'))).toEqual([]);
  });

  test('records every surface with its bytes, and nothing else', () => {
    const home = tempDir('hc-plant-');
    plantHome(home);
    expect(snapshotHomeConfig(home)).toEqual([
      { path: '.claude', kind: 'dir', content: '' },
      { path: '.claude/settings.local.json', kind: 'file', content: Buffer.from('{}').toString('base64') },
      { path: '.mcp.json', kind: 'file', content: Buffer.from('{}').toString('base64') },
      { path: 'CLAUDE.md', kind: 'file', content: Buffer.from('memo').toString('base64') },
      { path: 'escalations/CLAUDE.md', kind: 'file', content: Buffer.from('nested').toString('base64') },
    ]);
  });

  test('the raw tmpdir spelling and the realpath spelling of one home give the same snapshot', () => {
    const home = tempDir('hc-spelling-');
    plantHome(home);
    expect(snapshotHomeConfig(home)).toEqual(snapshotHomeConfig(realpathSync(home)));
  });

  test('records every symlink as a symlink and never descends into it', () => {
    const home = tempDir('hc-link-');
    const outside = tempDir('hc-outside-');
    writeFileSync(join(outside, 'CLAUDE.md'), 'outside memo');
    symlinkSync(outside, join(home, 'escalations'));
    symlinkSync(join(outside, 'CLAUDE.md'), join(home, 'CLAUDE.md'));
    expect(snapshotHomeConfig(home)).toEqual([
      { path: 'CLAUDE.md', kind: 'symlink', content: join(outside, 'CLAUDE.md') },
      { path: 'escalations', kind: 'symlink', content: outside },
    ]);
  });

  test('an unreadable home throws a typed HomeConfigError, never a raw fs error', () => {
    const missing = join(tempDir('hc-missing-'), 'nope');
    expect(() => snapshotHomeConfig(missing)).toThrow(/home configuration snapshot failed at .*nope: ENOENT/);
  });
});
