// core/model-support.e2e.test.ts — card runner-model-support, G1: a campaign executor session on
// the newest model runs through the runner's OWN spawn path (`runSession` wired to the real
// `sdkSpawnSession`, the pinned executor options, the runner's own node_modules) and gets a
// non-error result. On SDK 0.3.278 the same session ends `claude_code_version_too_old`.
//
// Opt-in, like core/session.e2e.test.ts: RUN_SESSION_E2E=1 (costs tokens, needs the Claude Code
// login; ANTHROPIC_API_KEY is removed first — the runner's P10 rule). The model is
// RUN_SESSION_E2E_MODEL, default claude-opus-5-5.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { sdkSpawnSession } from '../adapters/session.adapter.ts';
import { runSession, type SessionIO, type SessionMessage } from './session.ts';

const RUN_E2E = process.env.RUN_SESSION_E2E === '1';
const MODEL = process.env.RUN_SESSION_E2E_MODEL ?? 'claude-opus-5-5';
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..');
const BRIEF = 'Do not use any tool. Reply with exactly this one line and nothing else: NEEDS_DIRECTION: model support probe';

describe.skipIf(!RUN_E2E)(`G1 — an executor session on ${MODEL} through the runner's own spawn path`, () => {
  test('the session ends with a non-error result', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const logged: SessionMessage[] = [];
    const io: SessionIO = {
      spawnSession: sdkSpawnSession,
      onSessionStart: () => {},
      appendLog: (_path, line) => { logged.push(JSON.parse(line) as SessionMessage); },
    };
    const result = await runSession(
      { brief: BRIEF },
      { repoRoot: REPO_ROOT, model: MODEL, sessionTimeoutMs: 180_000, logsDir: '/dev/null/unused', card: 'g1', ledgerPath: '/dev/null/unused' },
      io,
    );
    const resultLine = logged.find((m) => m.type === 'result') as Record<string, unknown> | undefined;
    expect({ is_error: resultLine?.['is_error'], api_error_code: resultLine?.['api_error_code'] ?? null })
      .toEqual({ is_error: false, api_error_code: null });
    expect(result.outcome).toBe('needs_direction');
  }, 200_000);
});
