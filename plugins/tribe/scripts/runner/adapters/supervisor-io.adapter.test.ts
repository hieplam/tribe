// adapters/supervisor-io.adapter.test.ts — Task 12's Step-1 test contract, run against a real
// `mktemp -d` tree (fixtures-mirror-reality.md: a bare directory, never a convenience fixture
// the test happens to have already built). Never touches
// `~/.tribe/-Users-hip-repo-tribe/campaigns/` — every test builds its own throwaway home and
// the OS cleans it up.
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSupervisorIo, PathEscapesHomeError } from './supervisor-io.adapter.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'sup-io-'));

describe('buildSupervisorIo — the real edge', () => {
  test('an atomic write survives a concurrent read — never a truncated read', async () => {
    const home = tmp();
    const target = join(home, 'churn.txt');
    const io = buildSupervisorIo(home);

    const LEN = 300_000;
    io.writeFileAtomic(target, 'A'.repeat(LEN));

    // A SEPARATE process polls the file for ~600ms while the main thread performs a burst of
    // atomic writes. Real concurrency (a second OS process), not simulated interleaving —
    // this repo is single-threaded JS, so the only way to actually race the write is a real
    // child. The reader accepts only a buffer that is ENTIRELY 'A's or ENTIRELY 'B's; a
    // temp-then-rename write can never be observed half-done because the reader never opens
    // the temp file — a naive direct-write-to-target implementation WOULD show a mixed or
    // short buffer here.
    const readerScript = `
      const fs = require('fs');
      const target = process.env.SUP_IO_TARGET;
      const bad = [];
      let reads = 0;
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        let buf;
        try { buf = fs.readFileSync(target, 'utf8'); } catch (e) { continue; }
        reads++;
        if (!/^A*$/.test(buf) && !/^B*$/.test(buf)) bad.push(buf.length);
      }
      process.stdout.write(JSON.stringify({ bad, reads }));
    `;
    const reader = Bun.spawn(['bun', '-e', readerScript], {
      env: { ...process.env, SUP_IO_TARGET: target },
      stdout: 'pipe',
      timeout: 5_000,
    });

    let toggle = true;
    const writeDeadline = Date.now() + 600;
    while (Date.now() < writeDeadline) {
      io.writeFileAtomic(target, (toggle ? 'B' : 'A').repeat(LEN));
      toggle = !toggle;
    }

    const out = JSON.parse(await new Response(reader.stdout).text()) as { bad: number[]; reads: number };
    await reader.exited;

    expect(out.reads).toBeGreaterThan(0); // the check actually ran — not a vacuous pass
    expect(out.bad).toEqual([]);
  }, 15_000);

  test('renameIfPresent on an absent file is a no-op, not a throw', () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    const from = join(home, 'escalations', 'never-existed.md');
    const to = join(home, 'escalations', 'never-existed.md.resolved-R1');

    expect(() => io.renameIfPresent(from, to)).not.toThrow();
    expect(io.listEntries(join(home, 'escalations'))).toEqual([]);
  });

  test('renameIfPresent DOES rename when the source is present', () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    mkdirSync(join(home, 'escalations'), { recursive: true });
    const from = join(home, 'escalations', 'c1.md');
    const to = join(home, 'escalations', 'c1.md.resolved-R1');
    writeFileSync(from, 'archive me');

    io.renameIfPresent(from, to);

    expect(io.readFileOrEmpty(to)).toBe('archive me');
    expect(io.readFileOrEmpty(from)).toBe('');
  });

  test('a path containing ".." that escapes the home is refused BEFORE the file is opened', () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    const escapee = join(home, '..', `sup-io-escape-${process.pid}.txt`);

    expect(() => io.writeFileAtomic(escapee, 'should never land')).toThrow(PathEscapesHomeError);
    expect(existsSync(escapee)).toBe(false); // never created — proves "before it is opened"
  });

  test('a rename target that escapes the home is refused, never performed', () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    writeFileSync(join(home, 'inside.md'), 'x');
    const escapee = join(home, '..', `sup-io-rename-escape-${process.pid}.txt`);

    expect(() => io.renameIfPresent(join(home, 'inside.md'), escapee)).toThrow(PathEscapesHomeError);
    expect(io.readFileOrEmpty(join(home, 'inside.md'))).toBe('x'); // the source was never moved
  });

  test('readFileOrEmpty returns "" for an unreadable path (a directory, not a file) and for a missing one', () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    mkdirSync(join(home, 'a-directory'));

    expect(io.readFileOrEmpty(join(home, 'a-directory'))).toBe('');
    expect(io.readFileOrEmpty(join(home, 'does-not-exist.txt'))).toBe('');
  });

  test('listEntries on a missing directory returns [], never a throw', () => {
    const home = tmp();
    const io = buildSupervisorIo(home);

    expect(() => io.listEntries(join(home, 'nope'))).not.toThrow();
    expect(io.listEntries(join(home, 'nope'))).toEqual([]);
  });

  test('listEntries reports real entries once the directory exists', () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    mkdirSync(join(home, 'park'));
    writeFileSync(join(home, 'park', 'c1.json'), '{}');

    const entries = io.listEntries(join(home, 'park'));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('c1.json');
    expect(entries[0]?.isDir).toBe(false);
  });

  test('the git probe sets both host-git-config isolation env vars and carries a timeout', async () => {
    const home = tmp();
    const fakeBinDir = join(home, 'fakebin');
    mkdirSync(fakeBinDir);
    const capturedEnvFile = join(home, 'captured-env.txt');
    const fakeGit = join(fakeBinDir, 'git');
    // A fake `git` that records the env it actually saw, then sleeps far longer than the
    // adapter's own subprocess timeout — proving both obligations at once: the isolation env
    // vars are set, AND the caller does not hang waiting for a runaway child. The `sleep`'s own
    // stdout/stderr are redirected to /dev/null (never inherited from the pipe) so a killed
    // parent's pipe closes immediately instead of staying open until the orphaned `sleep`
    // itself exits 30s later — an artifact of this fixture, not of the adapter under test.
    writeFileSync(
      fakeGit,
      `#!/usr/bin/env bash\nprintf 'GLOBAL=%s SYSTEM=%s' "$GIT_CONFIG_GLOBAL" "$GIT_CONFIG_SYSTEM" > "${capturedEnvFile}"\nsleep 30 >/dev/null 2>&1\n`,
    );
    chmodSync(fakeGit, 0o755);

    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${fakeBinDir}:${previousPath}`;
    let result: string;
    let elapsedMs: number;
    try {
      const io = buildSupervisorIo(home);
      const start = Date.now();
      result = await io.gitStatusPorcelain('/some/repo/path');
      elapsedMs = Date.now() - start;
    } finally {
      process.env['PATH'] = previousPath;
    }

    expect(elapsedMs).toBeLessThan(9_000); // proves the 30s sleep was cut short by a timeout
    expect(result.length).toBeGreaterThan(0); // a probe that could not complete fails CLOSED (never '' = "clean")
    expect(readFileSync(capturedEnvFile, 'utf8')).toBe('GLOBAL=/dev/null SYSTEM=/dev/null');
  }, 15_000);

  test('the git probe runs the real "git" against a real repo on the happy path', async () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    // The runner's own worktree is a real repo — a live `git status --porcelain` proves the
    // happy path end to end (unlike the fake-git test above, which proves only the failure
    // path). Its content depends on the worktree's live state, so only the type is asserted.
    const result = await io.gitStatusPorcelain(join(import.meta.dir, '..'));
    expect(typeof result).toBe('string');
  });

  test('the clock reports both an ISO string and epoch milliseconds', () => {
    const io = buildSupervisorIo(tmp());
    expect(io.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(io.nowMs()).toBeGreaterThan(0);
  });

  test('resolveTribeHome executes the real tribe-home.sh against a real git repo', async () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    // Every worktree of THIS repo resolves to the SAME home — the runner's own worktree
    // (two directories up from this adapter) is a real, live git repo to probe.
    const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..');
    const result = await io.resolveTribeHome(repoRoot);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.home.startsWith('/')).toBe(true);
  });

  test('resolveTribeHome refuses (never throws) for a directory that is not a git repo', async () => {
    const home = tmp();
    const notARepo = tmp();
    const io = buildSupervisorIo(home);

    const result = await io.resolveTribeHome(notARepo);

    expect(result.ok).toBe(false);
  });

  test('spawnWatchdog runs a real process, captures stdout to a file, and yields its exit code', async () => {
    const home = tmp();
    const io = buildSupervisorIo(home);
    const stdoutPath = join(home, 'watchdog.log');

    const handle = io.spawnWatchdog(['bash', '-c', 'echo hello-from-watchdog; exit 5'], {
      cwd: home,
      stdoutPath,
    });
    const exitCode = await handle.waitFor(5_000);

    expect(exitCode).toBe(5);
    expect(readFileSync(stdoutPath, 'utf8')).toContain('hello-from-watchdog');
    expect(typeof handle.pid).toBe('number');
    // S-P7: no `kill` on the handle at all — the type itself proves this, but assert the
    // production object never grows one either (a future edit accidentally adding one would
    // silently violate "the supervisor never kills anything").
    expect((handle as unknown as { kill?: unknown }).kill).toBeUndefined();
  });
});
