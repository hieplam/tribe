// adapters/session-double.adapter.ts — Task 17 (card `campaign-supervisor`,
// `fixtures-mirror-reality.md`): the composition root's session-double seam. Lets
// `tests/test-supervisor-e2e.sh` substitute a scripted, real shell process for the real Claude
// Agent SDK one-shot spawn (`core/supervisor/session.ts`'s `spawnSession`), so the supervisor's
// own tick machinery — spawn, wait, read disk, run the postcondition check
// (`core/supervisor/verify.ts`) — is exercised against REAL subprocesses and REAL files, never
// a TypeScript mock. The in-process fake (`core/supervisor/loop.test.ts`'s `fakeSeam`) already
// proves the decision plumbing; this seam's whole value is the real disk/process boundary the
// fake cannot reach.
//
// Env-var seam, mirroring `run-io.adapter.ts`'s `unsetAnthropicApiKeyEnv` precedent for reading
// `process.env` only inside an adapter (`structure.test.ts`: "no ambient process.env read
// outside adapters/"). Unset (every ordinary, production invocation) -> `spawnSession` stays
// wired to the real SDK in `cli/main.ts`, byte-identical to today.
import { spawn } from 'node:child_process';
import type { SessionMessage } from '../core/session.ts';
import type { SessionKind } from '../core/supervisor/model.ts';

const DOUBLE_ENV_VAR = 'TRIBE_SUPERVISOR_SESSION_DOUBLE';

/** fail-closed-edges.md obligation 3 (every spawned subprocess is bounded): the default wall-clock
 * cap on a session-double child. A double is a fast scripted stand-in, so two minutes is far more
 * than any real double needs — it exists only so a WEDGED double can never hang a supervisor tick
 * forever. Injectable via `spawnSessionDouble`'s last parameter so the bound itself is testable. */
const DOUBLE_TIMEOUT_MS = 120_000;

/** The absolute path to a session-double script (e.g.
 * `runner/fixtures/supervisor/session-double.sh`), or `null` when unset — the ordinary,
 * production case. A blank value is treated the same as unset (mirrors the shell convention
 * `[[ -n "$VAR" ]]`), so an accidentally-exported-but-empty variable never silently swaps in a
 * double that does not exist. */
export function sessionDoubleScriptPath(): string | null {
  const raw = process.env[DOUBLE_ENV_VAR];
  return raw === undefined || raw === '' ? null : raw;
}

/** Spawns `scriptPath` with the campaign home and session kind as argv (`--home`/`--kind`) —
 * everything else the double needs (`DOUBLE_PLAN`, `DOUBLE_STATE`, `DOUBLE_REPO`) arrives
 * through this process's OWN inherited environment, exactly as `runner-double.sh`'s own
 * precedent (`runner/fixtures/watchdog/runner-double.sh`) already establishes for the watchdog
 * E2E suite — the test script's job to set, never this adapter's.
 *
 * Waits for the child to exit, then yields the minimal two-message stream
 * `core/supervisor/session.ts#consumeOneShot` needs to terminate cleanly: a `system`/`init`
 * message (so `onSessionStart` fires and the session log path is set) and a `result`/`success`
 * message (so the loop's own disk-postcondition check — `verify.ts` — runs next, on whatever
 * the double actually left on disk; the SDK-level "success" here says nothing about whether the
 * ATTEMPT succeeded, exactly like a real session that talks calmly while writing garbage).
 *
 * A nonzero exit or a spawn failure (ENOENT on `scriptPath`, ...) throws mid-iteration —
 * `consumeOneShot`'s own try/catch around its `for await` turns that into a typed `'failed'`
 * outcome, never an uncaught crash reaching the supervisor loop (`fail-closed-edges.md`
 * obligation 1). A double that wedges is bounded by `timeoutMs` (obligation 3): Node kills it
 * with `SIGKILL` at the cap, the `exit` event fires with that signal, and the nonzero-exit branch
 * below throws it into that same typed `'failed'` outcome — a hung double can never stall a tick. */
export async function* spawnSessionDouble(
  scriptPath: string,
  homeDir: string,
  kind: SessionKind,
  timeoutMs: number = DOUBLE_TIMEOUT_MS,
): AsyncGenerator<SessionMessage> {
  const sessionId = `double-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(scriptPath, ['--home', homeDir, '--kind', kind], {
      stdio: 'ignore',
      env: process.env,
      timeout: timeoutMs, // fail-closed-edges obligation 3: kill a wedged double at the cap
      killSignal: 'SIGKILL',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolveExit(code ?? (signal !== null ? 128 : 1)));
  });
  if (exitCode !== 0) {
    throw new Error(`session double "${scriptPath}" exited ${exitCode} for a "${kind}" session`);
  }
  yield { type: 'system', subtype: 'init', session_id: sessionId };
  yield {
    type: 'result',
    subtype: 'success',
    session_id: sessionId,
    result: 'session double: see disk for the real outcome',
    usage: null,
    total_cost_usd: null,
    permission_denials: [],
  };
}
