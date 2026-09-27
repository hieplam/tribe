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
  scriptPath: string, homeDir: string, params: SpawnSessionParams, timeoutMs: number = DOUBLE_TIMEOUT_MS,
): AsyncGenerator<SessionMessage> {
  const sessionId = params.options.resume ?? `double-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = mkdtempSync(join(tmpdir(), 'rdo-double-'));
  const promptFile = join(dir, 'prompt.md');
  writeFileSync(promptFile, params.prompt);
  try {
    const { code, stdout } = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const child = spawn(scriptPath, ['--home', homeDir, '--prompt-file', promptFile], {
        stdio: ['ignore', 'pipe', 'inherit'], env: process.env, timeout: timeoutMs, killSignal: 'SIGKILL',
      });
      let out = '';
      child.stdout?.on('data', (c: Buffer) => (out += c.toString()));
      child.on('error', reject);
      child.on('exit', (c, signal) => resolve({ code: c ?? (signal !== null ? 128 : 1), stdout: out }));
    });
    if (code !== 0) throw new Error(`executor session double "${scriptPath}" exited ${code}`);
    yield { type: 'system', subtype: 'init', session_id: sessionId };
    yield { type: 'result', subtype: 'success', session_id: sessionId, result: stdout.trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
