/**
 * The supervisor's production IO (card `campaign-supervisor`, Task 12). The ONLY supervisor
 * file allowed to touch the world (structure.test.ts's own `adapters/*.adapter.ts` rule) — it
 * performs; it decides nothing (`pure-core.md`).
 *
 * `adapters/watchdog-io.adapter.ts` is the worked precedent for every primitive here:
 * `readFileOrEmpty`, `writeFileAtomic`, `listEntries` and `spawnWatchdog` mirror that file's
 * `readFile`, `writeFileAtomic`, `listEntries` and `spawnRunner` almost line for line — the
 * same narrow catches, degrading to the same documented empty values instead of a throw
 * (`fail-closed-edges.md` obligation 1).
 *
 * The one thing this file adds beyond that precedent is containment (obligation 4): every
 * caller-supplied path is resolved and proven to sit inside the campaign home BEFORE anything
 * opens, writes, or renames through it. See `containedPath` below.
 */
import { dirname, basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import type { SupervisorIO, WatchdogHandle } from '../ports/ports.ts';

/** `plugins/tribe/scripts/runner/adapters/` -> `../..` -> `plugins/tribe/scripts/` ->
 * `tribe-home.sh` — resolved from THIS file's own location, never from `cwd` (the same wall
 * `watchdog-io.adapter.ts`'s `RUNNER_ENTRYPOINT` already holds). */
const TRIBE_HOME_SCRIPT = join(import.meta.dir, '..', '..', 'tribe-home.sh');

/** fail-closed-edges obligation 2: every subprocess this adapter spawns that shells out to
 * `git` (directly, or transitively through `tribe-home.sh`) gets this env — so an
 * unusual-but-legal host setting (`commit.gpgsign=true` with no usable key, a global hooks
 * path, a template dir) cannot change either subprocess's output. */
const GIT_ISOLATION_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } as const;

/** fail-closed-edges obligation 3: both `tribe-home.sh` and `git status --porcelain` finish in
 * well under a second in the ordinary case — 5s is generous headroom, not a real budget. */
const SUBPROCESS_TIMEOUT_MS = 5_000;

/** Never silently `''` (which `verify.ts` reads as "clean"). A fixed, recognisable, non-empty
 * marker so a probe that could not run — the subprocess never started, timed out, or exited
 * non-zero — fails closed as "touched". */
const GIT_PROBE_FAILED_SENTINEL = '?? <supervisor-io: git status --porcelain probe did not complete>\n';

/** Thrown when a caller-supplied path resolves outside the campaign home — obligation 4's
 * refusal, raised BEFORE anything opens, writes, or renames through the path. Never caught
 * internally: unlike the narrow ENOENT/EACCES/EISDIR degradations below (which mirror
 * `watchdog-io.adapter.ts`'s own catches for genuinely external failure modes), a path escape
 * is a caller bug that must stop the operation, not a recoverable external-input shape. */
export class PathEscapesHomeError extends Error {
  constructor(target: string, homeDir: string) {
    super(`supervisor-io: refused — "${target}" resolves outside the campaign home "${homeDir}"`);
    this.name = 'PathEscapesHomeError';
  }
}

/**
 * Resolves `target`'s deepest EXISTING ancestor through `realpathSync` — the same technique
 * S-P12's containment hook uses for a not-yet-created target — then rejoins the remaining,
 * not-yet-created path segments. A brand-new file under a real directory is therefore checked
 * exactly like an existing one, and a symlinked ancestor can never be used to escape.
 *
 * Both `homeDir` and the resolved target are realpath'd before comparing (W-P10): a throwaway
 * `HOME` created under `/var/folders` on macOS realpaths to `/private/var/folders`, so
 * comparing the resolved target against the UN-realpath'd `homeDir` string would wrongly
 * refuse a perfectly legitimate home.
 */
function containedPath(homeDir: string, target: string): string {
  const realHome = realpathSync(homeDir);
  let cursor = resolve(target);
  const remainder: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break; // reached the filesystem root without finding an ancestor
    remainder.unshift(basename(cursor));
    cursor = parent;
  }
  const realAncestor = realpathSync(cursor);
  const resolved = remainder.length > 0 ? join(realAncestor, ...remainder) : realAncestor;
  const rel = relative(realHome, resolved);
  const escapes = rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
  if (escapes) throw new PathEscapesHomeError(target, homeDir);
  return resolved;
}

/** Mirrors `watchdog-io.adapter.ts`'s own `isProcessAlive` exactly (same C5 guard: a lock
 * whose `pid` is `0`/negative/non-integer must never read back as "alive" — `process.kill`
 * signals a whole process GROUP for those values and never throws). Duplicated rather than
 * imported: each adapter is a self-contained edge per `structure.test.ts`'s own precedent
 * (`viewer-launch.adapter.ts` does not import `watchdog-io.adapter.ts` either). */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function buildSupervisorIo(homeDir: string): SupervisorIO {
  return {
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),

    isProcessAlive,
    currentPid: () => process.pid,

    appendFile: (p, content) => {
      const real = containedPath(homeDir, p);
      mkdirSync(dirname(real), { recursive: true });
      appendFileSync(real, content);
    },

    writeFileAtomic: (p, content) => {
      const real = containedPath(homeDir, p);
      mkdirSync(dirname(real), { recursive: true });
      const tmp = `${real}.tmp-${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, real);
    },

    readFileOrEmpty: (p) => {
      const real = containedPath(homeDir, p);
      try {
        return readFileSync(real, 'utf8');
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR') return '';
        throw err;
      }
    },

    renameIfPresent: (fromPath, toPath) => {
      const realFrom = containedPath(homeDir, fromPath);
      if (!existsSync(realFrom)) return; // already archived by a prior, crashed attempt — no-op
      const realTo = containedPath(homeDir, toPath);
      mkdirSync(dirname(realTo), { recursive: true });
      renameSync(realFrom, realTo);
    },

    listEntries: (dirPath) => {
      const real = containedPath(homeDir, dirPath);
      let names: string[];
      try {
        names = readdirSync(real);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') return [];
        throw err;
      }
      const out: Array<{ name: string; mtimeMs: number; isDir: boolean }> = [];
      for (const name of names) {
        try {
          const stat = statSync(join(real, name));
          out.push({ name, mtimeMs: stat.mtimeMs, isDir: stat.isDirectory() });
        } catch (err) {
          // Raced with a delete between readdir and stat: not an entry, not a crash.
          if ((err as { code?: string }).code === 'ENOENT') continue;
          throw err;
        }
      }
      return out;
    },

    /** No wall-clock kill, on purpose (S-P7 / fail-closed-edges obligation-3's documented
     * exception, written here at the spawn seam): the supervisor never kills anything it
     * spawns, and a campaign supervision run legitimately spans hours. Every WAIT on the
     * returned handle is still bounded (`waitFor(waitMs)`), so a caller never blocks
     * unbounded. The handle itself has no `kill` method at all (see `WatchdogHandle`'s own
     * doc comment in `ports/ports.ts`). */
    spawnWatchdog: (argv, opts): WatchdogHandle => {
      mkdirSync(dirname(opts.stdoutPath), { recursive: true });
      const out = openSync(opts.stdoutPath, 'a');
      const child = spawn(argv[0] as string, argv.slice(1), {
        cwd: opts.cwd,
        stdio: ['ignore', out, out],
        env: opts.env ?? process.env,
      });
      // Mirrors watchdog-io.adapter.ts's own `spawnRunner`: 'error' (the program never
      // started, e.g. ENOENT on argv[0]) is a DIFFERENT event than 'exit', so `closeOut` must
      // be idempotent and reachable from both.
      let closed = false;
      const closeOut = (): void => {
        if (closed) return;
        closed = true;
        closeSync(out);
      };
      let exited: number | null = null;
      const done = new Promise<number>((resolveDone) => {
        child.on('exit', (code, signal) => {
          exited = code ?? (signal ? 128 : 0);
          closeOut();
          resolveDone(exited);
        });
        child.on('error', () => {
          exited = 127; // spawn failed (ENOENT on the program) — a watchdog that never ran
          closeOut();
          resolveDone(127);
        });
      });
      return {
        pid: child.pid ?? -1,
        waitFor: async (waitMs) => {
          if (exited !== null) return exited;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const elapsed = new Promise<null>((resolveElapsed) => {
            timer = setTimeout(() => resolveElapsed(null), waitMs);
          });
          const result = await Promise.race([done, elapsed]);
          if (timer !== undefined) clearTimeout(timer);
          return result;
        },
      };
    },

    resolveTribeHome: async (repoRoot) => {
      try {
        const proc = Bun.spawn(['bash', TRIBE_HOME_SCRIPT, repoRoot], {
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: SUBPROCESS_TIMEOUT_MS,
          env: { ...process.env, ...GIT_ISOLATION_ENV },
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) {
          return { ok: false, error: stderr.trim() || `tribe-home.sh exited ${exitCode}` };
        }
        return { ok: true, home: stdout.trim() };
      } catch (err) {
        // The subprocess never started at all (e.g. `bash` unresolvable) — a typed refusal,
        // never a thrown exception reaching the composition root.
        return { ok: false, error: (err as Error).message };
      }
    },

    gitStatusPorcelain: async (repoRoot) => {
      try {
        const proc = Bun.spawn(['git', '-C', repoRoot, 'status', '--porcelain'], {
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: SUBPROCESS_TIMEOUT_MS,
          env: { ...process.env, ...GIT_ISOLATION_ENV },
        });
        const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        if (exitCode !== 0) return GIT_PROBE_FAILED_SENTINEL;
        return stdout;
      } catch {
        return GIT_PROBE_FAILED_SENTINEL;
      }
    },
  };
}
