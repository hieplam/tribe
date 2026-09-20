import { describe, expect, test } from 'bun:test';
import { countSessionHygiene, isFilesystemWideScan } from './session-hygiene.ts';

describe('isFilesystemWideScan — the oracle', () => {
  test.each([
    'find / -maxdepth 4 -iname "*c3x*"',
    'find / -path /proc -prune -o -iname x -print',
    'cd /tmp && ls; find / -maxdepth 8 -iname "claude-agent-sdk" -type d 2>/dev/null',
    'find ~ -name "*.log"',
    'find ~/ -name "*.log"',
    'find $HOME -name x',
    'find "$HOME" -name x',
    'find $HOME/ -name x',
    'find -L / -name x',
    'echo hi | find / -name x',
    // F1 reproduced bypasses: quoted/braced roots and executing wrapper forms.
    "find '/' -name x",
    'find "/" -name x',
    "find '~' -name x",
    'find "~" -name x',
    "find '~/' -name x",
    'find "~/" -name x',
    'find ${HOME} -name x',
    'sh -c "find / -name x"',
    'bash -c "find / -name x"',
    'eval "find / -name x"',
    '`find / -name x`',
    '/usr/bin/find / -name x',
    // G3 reproduced bypasses: non-shell interpreters running find via an inline program string.
    `python3 -c "import os; os.system('find / -name x')"`,
    `node -e "require('child_process').execSync('find / -name x')"`,
    `perl -e 'system("find / -name x")'`,
    // G4: find invoked via an absolute path outside /usr/bin and /bin (this repo's own documented
    // session PATH: /opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin).
    '/usr/local/bin/find / -name x',
    '/opt/homebrew/bin/find / -name x',
  ])('refuses %p', (cmd) => {
    expect(isFilesystemWideScan(cmd)).toBe(true);
  });

  test.each([
    'find . -name "*.ts"',
    'find /Users/hip/repo/tribe -iname "c3x.sh"',
    'find ~/repo/tribe -name x',
    'find $HOME/repo -name x',
    'find src -name x',
    'find plugins/tribe -maxdepth 2',
    'grep -rn "find /" src',          // mentions it, does not run it
    'echo "find / -name x"',          // quoted text, not a command position
  ])('allows %p', (cmd) => {
    expect(isFilesystemWideScan(cmd)).toBe(false);
  });
});

describe('countSessionHygiene', () => {
  test('counts Unknown skill occurrences per name, not per line', () => {
    const text = '{"a":"Unknown skill: c3. Did you mean cd?"}\n' +
      '{"b":"Unknown skill: c3 and Unknown skill: verify-shipped"}\n';
    const r = countSessionHygiene(text);
    expect(r.unknownSkills).toEqual({ c3: 2, 'verify-shipped': 1 });
  });

  test('counts a scan inside a JSON-escaped Bash tool_use command', () => {
    // The real log shape: the command carries escaped quotes, which a naive
    // "command":"[^"]*" regex truncates.
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'find / -maxdepth 8 -iname "x" -type d' } }] },
    });
    expect(countSessionHygiene(line).filesystemWideScans).toBe(1);
  });

  test('a scoped find in a tool_use is not counted', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'find /Users/hip/repo/tribe -iname "x"' } }] },
    });
    expect(countSessionHygiene(line).filesystemWideScans).toBe(0);
  });

  test('a malformed line never aborts the run — later lines still count', () => {
    const good = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'find / -name x' } }] },
    });
    const text = '{"truncated": mid-writ\n' + good + '\n';
    expect(countSessionHygiene(text).filesystemWideScans).toBe(1);
  });

  test('is additive, so an edge can accumulate across files', () => {
    const a = countSessionHygiene('Unknown skill: c3');
    const b = countSessionHygiene('Unknown skill: c3');
    expect(a.unknownSkills.c3 + b.unknownSkills.c3).toBe(2);
  });
});
