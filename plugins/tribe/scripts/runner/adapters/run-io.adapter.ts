// run-io.adapter.ts — the production LoopIO: every real-world primitive the runner touches
// (filesystem, child processes, clock, own pid) lives behind this one adapter leaf. Pure
// modules receive it as the injected `io` parameter and never import these primitives
// themselves (purity wall — enforced by structure.test.ts; ESLint layer deferred per Amendment A3).
import { dirname, join, resolve } from 'node:path';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ExecResult, LockInfo, LoopIO, RunLoopConfig } from '../core/loop.ts';
import type { ExecOptions, ShellRunResult } from '../ports/ports.ts';
import type { SessionMessage, SpawnSessionParams } from '../core/session.ts';
import { reportDirOf } from '../core/paths.ts';
import { sdkSpawnSession } from './session.adapter.ts';

/** Resolve an existing path, or its nearest existing parent plus the missing suffix. A broken
 * symlink is an error rather than a missing path that could be treated as safely contained. */
function canonicalPath(path: string): string {
  const missing: string[] = [];
  let parent = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(parent), ...missing);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      try {
        lstatSync(parent); // a dangling symlink exists but cannot be safely resolved
        throw new Error(`cannot resolve ${parent}`);
      } catch (statErr) {
        if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr;
      }
      const next = dirname(parent);
      if (next === parent) throw new Error(`cannot resolve ${path}`);
      missing.unshift(parent.slice(next.length + (next === '/' ? 0 : 1)));
      parent = next;
    }
  }
}

function assertDoneScratchPath(homeDir: string, scratchPath: string): void {
  const done = resolve(homeDir, 'done');
  if (dirname(resolve(scratchPath)) !== done || resolve(scratchPath) === done) {
    throw new Error(`Done scratch path ${scratchPath} is outside ${done}`);
  }
  const homeReal = realpathSync(homeDir);
  const doneStat = lstatSync(done);
  if (!doneStat.isDirectory() || doneStat.isSymbolicLink() || realpathSync(done) !== join(homeReal, 'done')) {
    throw new Error(`Done scratch directory ${done} is not a real directory under ${homeReal}`);
  }
  if (canonicalPath(dirname(scratchPath)) !== join(homeReal, 'done')) {
    throw new Error(`Done scratch parent for ${scratchPath} leaves ${homeReal}/done`);
  }
  try {
    if (lstatSync(scratchPath).isSymbolicLink()) throw new Error(`Done scratch path ${scratchPath} is a symlink`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function realExec(cmd: string[], opts?: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0] as string, cmd.slice(1), { cwd: opts?.cwd });
    let stdout = '';
    let stderr = '';
    let timeout: ReturnType<typeof setTimeout> | undefined;
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
    if (opts?.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({
          stdout,
          stderr: `${stderr}${stderr && !stderr.endsWith('\n') ? '\n' : ''}timed out after ${opts.timeoutMs} ms`,
          exitCode: 1,
        });
      }, opts.timeoutMs);
    }
  });
}

/** P10 (fix-list): the tribe never authenticates via ANTHROPIC_API_KEY — executor sessions
 * authenticate via Claude Code login. Deletes the variable from `process.env` if present,
 * returning whether it was removed (so the composition root can decide whether to warn).
 * Lives here, not `core/`, because it is a `process.env` side effect — `structure.test.ts`
 * bans an ambient `process.env` read anywhere outside `adapters/`. Called directly by
 * `cli/main.ts` at the very top of `main()`, before `buildRealIo` (and everything else)
 * runs, so an inherited key never reaches a spawned session. */
export function unsetAnthropicApiKeyEnv(): boolean {
  if (process.env.ANTHROPIC_API_KEY === undefined) return false;
  delete process.env.ANTHROPIC_API_KEY;
  return true;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** fail-closed-edges obligations 1 and 3: bounded, never throws, a spawn error is exit 127. Output
 * kept to the last 256 KiB per stream so a chatty test suite cannot exhaust memory. */
export function runShellBounded(
  command: string,
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<ShellRunResult> {
  const cap = 256 * 1024;
  const keep = (acc: string, chunk: Buffer): string => {
    const next = acc + chunk.toString();
    return next.length > cap ? next.slice(next.length - cap) : next;
  };
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // `detached` makes the child a process-group leader, so the timeout can kill the whole group.
    const child = spawn('bash', ['-c', command], { cwd: opts.cwd, env: { ...process.env, ...opts.env }, detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-(child.pid as number), 'SIGKILL'); // the whole group: a pipeline's children too
      } catch {
        child.kill('SIGKILL'); // no group to signal (already gone or never started): the child alone
      }
    }, opts.timeoutMs);
    child.stdout?.on('data', (c: Buffer) => (stdout = keep(stdout, c)));
    child.stderr?.on('data', (c: Buffer) => (stderr = keep(stderr, c)));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, timedOut, durationMs: Date.now() - started, stdout, stderr: `${stderr}${err.message}\n` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? (signal !== null ? 137 : 1), timedOut, durationMs: Date.now() - started, stdout, stderr });
    });
  });
}

/** P11 fix-list follow-up: takes only `{ homeDir }` (a structural `Pick`, not a nominal
 * narrower type) rather than a full `RunLoopConfig` — `homeDir` is the only field this
 * function actually reads (for the lock path below); every other member is a fixed closure.
 * Every existing call site (`main()`'s normal run path) still passes a full `RunLoopConfig`,
 * which trivially satisfies this narrower shape, so this widening is behavior-preserving.
 * Widened specifically so the `reset-card` CLI subcommand — which has no `--repo`/`--model`/
 * `--remote`/... to fabricate — can call this same production adapter with just the one value
 * it actually has, instead of a second bespoke IO builder duplicating fs/lock wiring. */
export function buildRealIo(config: Pick<RunLoopConfig, 'homeDir'>): LoopIO {
  const lockPath = join(reportDirOf(config.homeDir), '.runner.lock');

  return {
    exec: realExec,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // Task 27 (spec §2.1 "Stdout: one human line per action", reused from `LinePort` — same
    // seam `adapters/watchdog-io.adapter.ts` already wires for the watchdog).
    printLine: (line) => console.log(line),

    fileExists: (p) => existsSync(p),
    canonicalPath,
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, content) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    },
    renameFile: (from, to) => {
      renameSync(from, to);
    },

    readLock: () => {
      if (!existsSync(lockPath)) return null;
      return JSON.parse(readFileSync(lockPath, 'utf8')) as LockInfo;
    },
    writeLock: (info) => {
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, JSON.stringify(info));
    },
    removeLock: () => {
      if (existsSync(lockPath)) rmSync(lockPath);
    },
    isProcessAlive,
    currentPid: () => process.pid,
    now: () => new Date().toISOString(),

    spawnSession: (params: SpawnSessionParams): AsyncIterable<SessionMessage> => sdkSpawnSession(params),
    appendLog: (logPath, line) => {
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, `${line}\n`, { flag: 'a' });
    },

    ensureDir: (resolvedPath) => {
      mkdirSync(resolvedPath, { recursive: true });
    },
    assertDoneScratchPath: (resolvedPath) => assertDoneScratchPath(config.homeDir, resolvedPath),
    writeFileAtomic: (resolvedPath, content) => {
      const tmp = `${resolvedPath}.tmp-${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, resolvedPath);
    },
    removeTree: (resolvedPath) => {
      assertDoneScratchPath(config.homeDir, resolvedPath);
      rmSync(resolvedPath, { recursive: true, force: true });
    },
    runShell: runShellBounded,
  };
}
