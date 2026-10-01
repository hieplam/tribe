// adapters/executor-double.adapter.ts — card runner-driver-only (spec §4.12): the composition root's
// executor-session double. `TRIBE_RUNNER_SESSION_DOUBLE=<script>` swaps the SDK spawn for a scripted
// process so the hermetic E2Es (V3, G5) drive the REAL runner, git and Done commands with only the
// LLM replaced. Unset (every production run) -> nothing changes. Mirrors session-double.adapter.ts.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionMessage, SpawnSessionParams } from '../core/session.ts';

const DOUBLE_ENV_VAR = 'TRIBE_RUNNER_SESSION_DOUBLE';
const DOUBLE_TIMEOUT_MS = 120_000; // fail-closed-edges obligation 3: a wedged double never hangs a run

export function executorDoubleScriptPath(): string | null {
  const raw = process.env[DOUBLE_ENV_VAR];
  return raw === undefined || raw === '' ? null : raw;
}

export async function* spawnExecutorDouble(
  scriptPath: string, homeDir: string, cardId: string,
  // Only the prompt and a resumed session id are read, so the model probe (`run.ts probe-model`,
  // whose options are not the executor's pinned block) can use this double too.
  params: Pick<SpawnSessionParams, 'prompt'> & { options: { resume?: string } },
  timeoutMs: number = DOUBLE_TIMEOUT_MS,
): AsyncGenerator<SessionMessage> {
  const sessionId = params.options.resume ?? `double-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = mkdtempSync(join(tmpdir(), 'rdo-double-'));
  const promptFile = join(dir, 'prompt.md');
  writeFileSync(promptFile, params.prompt);
  try {
    const { code, stdout } = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const child = spawn(scriptPath, ['--home', homeDir, '--card', cardId, '--prompt-file', promptFile], {
        stdio: ['ignore', 'pipe', 'inherit'], env: process.env, timeout: timeoutMs, killSignal: 'SIGKILL',
      });
      let out = '';
      child.stdout?.on('data', (c: Buffer) => (out += c.toString()));
      child.on('error', reject);
      child.on('exit', (c, signal) => resolve({ code: c ?? (signal !== null ? 128 : 1), stdout: out }));
    });
    if (code !== 0) throw new Error(`executor session double "${scriptPath}" exited ${code}`);
    yield { type: 'system', subtype: 'init', session_id: sessionId };
    yield doubleResultMessage(stdout, sessionId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The double's stdout, read as the session's `result` message. A double whose LAST stdout line is
 * a whole `result` message (the JSON a real session emits — e.g. the captured
 * `fixtures/executor/result-claude-code-version-too-old.json`) is passed through as that message,
 * so the runner reads exactly the bytes a real session produced; any other stdout is the session's
 * final text, as before. The session id is the double's own, so the log file and the message agree. */
export function doubleResultMessage(stdout: string, sessionId: string): SessionMessage {
  const lastLine = stdout.trim().split('\n').pop() ?? '';
  if (lastLine.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(lastLine);
      if (parsed !== null && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'result') {
        return { ...(parsed as SessionMessage), session_id: sessionId };
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err; // a line that is not JSON is ordinary final text
    }
  }
  return { type: 'result', subtype: 'success', session_id: sessionId, result: stdout.trim() };
}
