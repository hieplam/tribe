/**
 * The watchdog's production IO. The ONLY watchdog file allowed to touch the world
 * (structure.test.ts). Every method is an effect with no decision in it (pure-core.md);
 * every catch is the narrowest one the call can raise and degrades to a documented empty
 * value rather than a throw (fail-closed-edges obligation 1) — a watchdog that dies with a
 * stack trace because a directory vanished mid-scan would be strictly worse than the LLM
 * heartbeat it replaces.
 */
import { dirname, join } from 'node:path';
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import type { LockInfo, RunnerHandle, WatchdogIO } from '../ports/ports.ts';
import { errorCode } from '../core/errno.ts';

/** The real runner entrypoint, resolved from THIS file's location — never from cwd. This
 * adapter lives at `<runner>/adapters/`, so `run.ts` is one level up: the exact path
 * `resolve-runner.sh` and `test-fresh-machine.sh` already prove. */
const RUNNER_ENTRYPOINT = join(import.meta.dir, '..', 'run.ts');

function isProcessAlive(pid: number): boolean {
  // C5 (group-C audit round 1, class `minor`): `process.kill(0, 0)` and `process.kill(-1, 0)`
  // signal a whole process GROUP under POSIX and never throw — so without this guard, a lock
  // file this process does not own/trust reporting `pid: 0` would read back as "alive"
  // forever. Any pid that is not a positive integer is never a real process id.
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH (gone) is dead; EPERM reached a real process we just lack permission to signal —
    // that is alive but foreign, never dead. Mirrors adapters/run-io.adapter.ts's isProcessAlive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function buildWatchdogIo(): WatchdogIO {
  return {
    fileExists: (p) => existsSync(p),
    readFile: (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR') return '';
        throw err;
      }
    },
    appendFile: (p, content) => {
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, content);
    },
    ensureDir: (p) => {
      mkdirSync(p, { recursive: true });
    },
    writeFileAtomic: (p, content) => {
      mkdirSync(dirname(p), { recursive: true });
      const tmp = `${p}.tmp-${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, p);
    },

    listEntries: (dirPath) => {
      let names: string[];
      try {
        names = readdirSync(dirPath);
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') return [];
        throw err;
      }
      const out: Array<{ name: string; mtimeMs: number; isDir: boolean }> = [];
      for (const name of names) {
        try {
          const stat = statSync(join(dirPath, name));
          out.push({ name, mtimeMs: stat.mtimeMs, isDir: stat.isDirectory() });
        } catch (err) {
          // Raced with a delete between readdir and stat: not an entry, not a crash.
          if (errorCode(err) === 'ENOENT') continue;
          throw err;
        }
      }
      return out;
    },

    /**
     * Raw, byte-bounded read to the file's true EOF — this is already correct as the signal
     * parser's input, no wrapping needed. Because the window always ends at EOF (never at some
     * earlier point this adapter chose), the tail's final line is always complete; the only
     * possible cut is at the window's START, which can truncate the LEADING line when it falls
     * mid-file. `parseSessionSignals` (`core/watchdog/signals.ts`) tolerates that truncated
     * leading line BY DESIGN — "the first line is routinely truncated mid-JSON. That is
     * expected input, not an error" — a line that fails to parse is simply skipped. See
     * `core/watchdog/watch-loop.ts`'s call site for why the caller's window (`LOG_TAIL_BYTES`)
     * is floored at 64 KiB.
     */
    readTail: (filePath, maxBytes) => {
      let fd: number | null = null;
      try {
        const size = statSync(filePath).size;
        const start = Math.max(0, size - maxBytes);
        const length = size - start;
        if (length === 0) return '';
        fd = openSync(filePath, 'r');
        const buffer = Buffer.alloc(length);
        // FIX S5 (audit round, final): `readSync` returns the NUMBER OF BYTES actually read,
        // which can be less than `length` (a short read — e.g. the file shrank between the
        // `statSync` above and this call). Stringifying the full, untouched `Buffer.alloc`
        // baked the unwritten tail in as literal NUL bytes, corrupting/truncating whatever
        // fell there — including the newest, most authoritative log line.
        const bytesRead = readSync(fd, buffer, 0, length, start);
        return buffer.subarray(0, bytesRead).toString('utf8');
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR') return '';
        throw err;
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },

    realpath: (p) => {
      try {
        return realpathSync(p);
      } catch (err) {
        if (errorCode(err) === 'ENOENT') return p;
        throw err;
      }
    },

    readLock: () => {
      // Only the runner's own lock path (`reportDirOf(home)/.runner.lock`) is ever read, and
      // the home is supplied by the caller through the closure below in `watch-loop.ts`; this
      // method is bound per-home by `withHome` there.
      return null as LockInfo | null;
    },

    isProcessAlive,
    currentPid: () => process.pid,
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    runnerCommand: () => ['bun', RUNNER_ENTRYPOINT],

    /** No wall-clock kill, on purpose (W-P7, card G4): a campaign pass legitimately runs for
     * hours, and killing it is the runner's own --session-timeout's job. Every WAIT on this
     * handle is bounded (`waitFor(waitMs)`), so the watchdog itself never blocks unbounded and
     * still notices a STOP file within one poll slice. */
    spawnRunner: (argv, opts): RunnerHandle => {
      mkdirSync(dirname(opts.stdoutPath), { recursive: true });
      const out = openSync(opts.stdoutPath, 'a');
      const child = spawn(argv[0] as string, argv.slice(1), {
        cwd: opts.cwd,
        stdio: ['ignore', out, out],
        env: opts.env ?? process.env,
      });
      // C4 (group-C audit round 1, class `agreed`): `'error'` (the program never started, e.g.
      // ENOENT on argv[0]) is a DIFFERENT event than `'exit'` — under Bun, `'exit'` never
      // fires once `'error'` has — so closing `out` only on `'exit'` leaked the fd on every
      // failed spawn. `closeOut` is idempotent (guarded by `closed`) so it is safe no matter
      // which event(s) fire, and in which order, on any runtime.
      let closed = false;
      const closeOut = (): void => {
        if (closed) return;
        closed = true;
        closeSync(out);
      };
      let exited: number | null = null;
      const done = new Promise<number>((resolve) => {
        child.on('exit', (code, signal) => {
          exited = code ?? (signal ? 128 : 0);
          closeOut();
          resolve(exited);
        });
        child.on('error', () => {
          exited = 127; // spawn failed (ENOENT on the program) — a runner that never ran
          closeOut();
          resolve(127);
        });
      });
      return {
        pid: child.pid ?? -1,
        waitFor: async (waitMs) => {
          if (exited !== null) return exited;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const elapsed = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), waitMs);
          });
          const result = await Promise.race([done, elapsed]);
          if (timer !== undefined) clearTimeout(timer);
          return result;
        },
      };
    },

    userHome: () => process.env['HOME'] ?? '',
    cwd: () => process.cwd(),
    printLine: (line) => {
      console.log(line);
    },
  };
}

/** Binds the per-home methods the seam cannot know at construction time: the runner's lock
 * path lives under the campaign home. Called once by `cli/main.ts` after containment. */
export function withHome(io: WatchdogIO, homeDir: string): WatchdogIO {
  const lockPath = join(homeDir, '.runner.lock');
  return {
    ...io,
    readLock: () => {
      try {
        if (!existsSync(lockPath)) return null;
        return JSON.parse(readFileSync(lockPath, 'utf8')) as LockInfo;
      } catch (err) {
        // A half-written or corrupt lock is "no readable holder", never a crash.
        if (err instanceof SyntaxError) return null;
        const code = errorCode(err);
        if (code === 'ENOENT' || code === 'EACCES') return null;
        throw err;
      }
    },
  };
}
