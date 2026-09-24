import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, statSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWatchdogIo, withHome } from './watchdog-io.adapter.ts';

// DEBT debt-runner-temp-dir-leak — this temp dir has no cleanup path; see rule-temp-dir-cleanup.
const tmp = () => mkdtempSync(join(tmpdir(), 'wd-adapter-'));

describe('buildWatchdogIo — the real edge', () => {
  test('listEntries reports files, dirs and mtimes; a missing dir is empty, never a throw', () => {
    const io = buildWatchdogIo();
    const dir = tmp();
    mkdirSync(join(dir, 'runs'));
    writeFileSync(join(dir, 'a.log'), 'x');
    utimesSync(join(dir, 'a.log'), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const entries = io.listEntries(dir);
    expect(entries.find((e) => e.name === 'runs')?.isDir).toBe(true);
    expect(entries.find((e) => e.name === 'a.log')?.isDir).toBe(false);
    expect(entries.find((e) => e.name === 'a.log')?.mtimeMs).toBe(1_700_000_000_000);
    expect(io.listEntries(join(dir, 'nope'))).toEqual([]);
  });

  test('readTail returns at most maxBytes, and empty string for a missing file', () => {
    const io = buildWatchdogIo();
    const dir = tmp();
    const file = join(dir, 'big.log');
    writeFileSync(file, 'abcdefghij');
    expect(io.readTail(file, 4)).toBe('ghij');
    expect(io.readTail(file, 100)).toBe('abcdefghij');
    expect(io.readTail(join(dir, 'missing.log'), 10)).toBe('');
  });

  test('realpath resolves symlinks and returns the input unchanged when it does not exist', () => {
    const io = buildWatchdogIo();
    const dir = tmp();
    expect(io.realpath(join(dir, 'does-not-exist'))).toBe(join(dir, 'does-not-exist'));
    expect(io.realpath(dir).endsWith(dir.split('/').pop() as string)).toBe(true);
  });

  test('spawnRunner runs a real process, captures stdout to a file and yields its exit code', async () => {
    const io = buildWatchdogIo();
    const dir = tmp();
    const out = join(dir, 'stdout.log');
    const handle = io.spawnRunner(['bash', '-c', 'echo hello-from-child; exit 7'], {
      cwd: dir, stdoutPath: out,
    });
    expect(handle.pid).toBeGreaterThan(0);
    expect(await handle.waitFor(10_000)).toBe(7);
    expect(io.readTail(out, 1000)).toContain('hello-from-child');
  }, 20_000);

  test('waitFor returns null when the slice elapses first — a bounded wait, never a kill', async () => {
    const io = buildWatchdogIo();
    const dir = tmp();
    const handle = io.spawnRunner(['bash', '-c', 'sleep 5'], {
      cwd: dir, stdoutPath: join(dir, 'o.log'),
    });
    expect(await handle.waitFor(200)).toBe(null);
    expect(io.isProcessAlive(handle.pid)).toBe(true);
    expect(await handle.waitFor(10_000)).toBe(0);
  }, 20_000);

  // C4 (group-C audit round 1, class `agreed`): `child.on('exit')` closes the stdout fd, but a
  // program that never STARTS (e.g. ENOENT on argv[0]) only fires `child.on('error')`, which
  // used to resolve with 127 and never close it — a leaked fd on every failed spawn. Verified
  // the way one of the two Skinner reviewers did: `lsof` on this very process after the
  // failure must show the descriptor gone.
  test('C4: a failed spawn (ENOENT on argv[0]) closes the stdout fd exactly once — no leaked descriptor', async () => {
    const io = buildWatchdogIo();
    const dir = tmp();
    const out = join(dir, 'attempt-1.log');
    const handle = io.spawnRunner(['/nonexistent/binary/for/sure/c4-leak-test', '--x'], {
      cwd: dir, stdoutPath: out,
    });
    expect(await handle.waitFor(10_000)).toBe(127);
    const lsof = spawnSync('lsof', ['-p', String(process.pid)], { encoding: 'utf8' });
    const openForThisFile = (lsof.stdout ?? '').split('\n').filter((line) => line.includes(out));
    expect(openForThisFile).toEqual([]);
  }, 15_000);

  // B1 (rules-gate fix): EPERM means "alive but foreign" (kill(0) reached a real process we
  // just lack permission to signal), never "gone" — conflating the two would let the watchdog
  // treat a live-but-foreign lock holder as dead and launch a competing runner (decide.ts's
  // sole gate on lockHolder.alive). pid 1 (launchd) is always present and always foreign on
  // macOS, so it gives a genuine, deterministic EPERM with no stubbing. For the "really gone"
  // side, a real spawned-and-awaited-to-exit child's pid gives a genuine, deterministic ESRCH
  // (no guessing at an "unused" pid number, which risks collision with a real process).
  test('isProcessAlive: EPERM (alive but foreign, e.g. pid 1) is alive; a reaped child (ESRCH) is dead', async () => {
    const io = buildWatchdogIo();
    expect(io.isProcessAlive(1)).toBe(true);

    const dir = tmp();
    const handle = io.spawnRunner(['bash', '-c', 'exit 0'], {
      cwd: dir, stdoutPath: join(dir, 'o.log'),
    });
    expect(await handle.waitFor(10_000)).toBe(0);
    expect(io.isProcessAlive(handle.pid)).toBe(false);
  }, 20_000);

  // C5 (group-C audit round 1, class `minor`): `process.kill(0, 0)` / `process.kill(-1, 0)`
  // signal a whole process GROUP under POSIX and never throw, so the naive EPERM/ESRCH
  // dispatch above reads them as "alive". No writer in this repo ever produces `pid: 0` or a
  // negative pid, but the watchdog reads a lock file it does not own and cannot trust
  // (`fail-closed-edges`), so an untrusted `pid: 0` must never read back as a live holder.
  test('isProcessAlive: pid 0, a negative pid, and a non-integer pid are never "alive" (untrusted lock input)', () => {
    const io = buildWatchdogIo();
    expect(io.isProcessAlive(0)).toBe(false);
    expect(io.isProcessAlive(-1)).toBe(false);
    expect(io.isProcessAlive(1.5)).toBe(false);
  });

  test('runnerCommand names the real runner entrypoint, resolved from this file, not from cwd', () => {
    const io = buildWatchdogIo();
    expect(io.runnerCommand()[0]).toBe('bun');
    expect((io.runnerCommand()[1] as string).endsWith('/run.ts')).toBe(true);
    expect(io.fileExists(io.runnerCommand()[1] as string)).toBe(true);
  });

  test('appendFile is append-only and creates parents', () => {
    const io = buildWatchdogIo();
    const dir = tmp();
    const events = join(dir, 'watchdog', 'events.jsonl');
    io.appendFile(events, 'one\n');
    io.appendFile(events, 'two\n');
    expect(io.readTail(events, 100)).toBe('one\ntwo\n');
  });

  // W-P9, asserted rather than promised: the watchdog's lock access is read-only — reading it
  // must never mutate the file the runner's own single-instance lock lives in.
  test('readLock (bound by withHome) never writes or removes the runner lock file', () => {
    const home = tmp();
    const lockPath = join(home, '.runner.lock');
    const lockInfo = { pid: 4242, startedAt: '2026-09-04T00:00:00.000Z' };
    writeFileSync(lockPath, JSON.stringify(lockInfo));
    const fixedMtime = new Date(1_700_000_000_000);
    utimesSync(lockPath, fixedMtime, fixedMtime);
    const before = statSync(lockPath);

    const io = withHome(buildWatchdogIo(), home);
    expect(io.readLock()).toEqual(lockInfo);

    const after = statSync(lockPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  // W-P9: the adapter itself must be structurally incapable of writing/removing the lock or
  // touching a campaign-domain path it was never handed — every write path is caller-supplied.
  test('the adapter source never names a file-deletion primitive or a hardcoded campaign path', () => {
    const src = readFileSync(join(import.meta.dir, 'watchdog-io.adapter.ts'), 'utf8');
    for (const forbidden of ['rmSync', 'unlinkSync', 'rmdirSync', 'campaign-state.json', 'answers.md', 'escalat']) {
      expect({ forbidden, present: src.includes(forbidden) }).toEqual({ forbidden, present: false });
    }
  });
});
