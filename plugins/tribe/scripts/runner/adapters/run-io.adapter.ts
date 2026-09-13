// run-io.adapter.ts — the production LoopIO: every real-world primitive the runner touches
// (filesystem, child processes, clock, own pid) lives behind this one adapter leaf. Pure
// modules receive it as the injected `io` parameter and never import these primitives
// themselves (purity wall — enforced by structure.test.ts; ESLint layer deferred per Amendment A3).
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ExecResult, LockInfo, LoopIO, RunLoopConfig } from '../core/loop.ts';
import type { SessionMessage, SpawnSessionParams } from '../core/session.ts';
import { reportDirOf } from '../core/paths.ts';
import { sdkSpawnSession } from './session.adapter.ts';

function realExec(cmd: string[], opts?: { cwd?: string }): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0] as string, cmd.slice(1), { cwd: opts?.cwd });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    child.on('error', (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));
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
    writeFileAtomic: (resolvedPath, content) => {
      const tmp = `${resolvedPath}.tmp-${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, resolvedPath);
    },
  };
}
