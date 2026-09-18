// Tests for session.ts (Task 13, spec §5.1): the one-shot session option block and runner for
// `ruling`/`ratify`/`closing`. NEVER hits the real SDK — every test drives `runOneShotSession`
// through a scripted fake seam (`spawnSession`/`onSessionStart`/`appendLog`), mirroring
// `core/session.test.ts`'s own `recordingIo` pattern.
import { describe, expect, test } from 'bun:test';
import {
  buildOneShotOptions,
  runOneShotSession,
  type OneShotSessionConfig,
  type OneShotSessionOptions,
  type OneShotSpawnParams,
} from './session.ts';
import type { SessionMessage } from '../session.ts';
import type { SessionKind } from './model.ts';

function fixtureConfig(overrides: Partial<OneShotSessionConfig> = {}): OneShotSessionConfig {
  return {
    homeDir: '/abs/home/.tribe/key/campaigns/slug',
    model: 'claude-haiku-fixture',
    repoRoot: '/abs/repo',
    realpath: (p: string) => p,
    ...overrides,
  };
}

function recordingIo(): {
  spawnSession: (params: OneShotSpawnParams) => AsyncIterable<SessionMessage>;
  onSessionStart: (sessionId: string) => void;
  appendLog: (logPath: string, line: string) => void;
  calls: string[];
  logLines: string[];
} {
  const calls: string[] = [];
  const logLines: string[] = [];
  return {
    calls,
    logLines,
    spawnSession: () => {
      throw new Error('spawnSession not stubbed for this test');
    },
    onSessionStart: (sessionId: string) => {
      calls.push(`onSessionStart:${sessionId}`);
    },
    appendLog: (path: string, line: string) => {
      calls.push(`appendLog:${path}`);
      logLines.push(line);
    },
  };
}

async function* messages(list: SessionMessage[]): AsyncGenerator<SessionMessage> {
  for (const m of list) yield m;
}

const INIT_MESSAGE: SessionMessage = { type: 'system', subtype: 'init', session_id: 'sess-abc' };

const RESULT_MESSAGE: SessionMessage = {
  type: 'result',
  subtype: 'success',
  session_id: 'sess-abc',
  result: 'DONE-1: answers.md ✓',
  usage: {
    input_tokens: 100,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
    output_tokens: 20,
  },
  total_cost_usd: 0.0123,
  permission_denials: [{ tool_name: 'Write', tool_input: { file_path: '/abs/repo/src/touched.txt' } }],
};

describe('buildOneShotOptions — spec §5.1 envelope (regression guard)', () => {
  test('resume is never a property of the built options, for any kind', () => {
    for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect('resume' in options).toBe(false);
    }
  });

  test('cwd is the campaign home, for every kind (S-P9 — this is what attributes the transcript)', () => {
    for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.cwd).toBe('/abs/home/.tribe/key/campaigns/slug');
    }
  });

  test('permissionMode is "default" for every kind — never "bypassPermissions" (decision 4)', () => {
    for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.permissionMode).toBe('default');
    }
  });

  test('ruling and ratify carry the disallowedTools wall (no Bash/Task/Agent/network/wait-tools)', () => {
    for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.disallowedTools).toEqual([
        'Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'Monitor', 'ScheduleWakeup',
      ]);
    }
  });

  test('closing gets NO containment hook — the named exception (spec §5.4)', () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    expect(options.hooks).toBeUndefined();
  });

  test('closing carries no disallowedTools wall — the full Claude Code set, Bash included', () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    expect(options.disallowedTools).toBeUndefined();
  });

  for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
    test(`${kind} carries a containment hook, and the wired hook actually denies an escape (not merely "present")`, async () => {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.hooks?.PreToolUse).toHaveLength(1);
      const wired = options.hooks?.PreToolUse[0]?.hooks[0];
      expect(wired).toBeDefined();

      const decision = await (wired as NonNullable<typeof wired>)({
        tool_name: 'Write',
        tool_input: { file_path: '/abs/repo/src/touched.txt' },
      });
      expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');

      const allowed = await (wired as NonNullable<typeof wired>)({
        tool_name: 'Write',
        tool_input: { file_path: '/abs/home/.tribe/key/campaigns/slug/answers.md' },
      });
      expect(allowed).toEqual({});
    });
  }

  test('the abortController passed in is threaded through unchanged', () => {
    const abortController = new AbortController();
    const options = buildOneShotOptions('ruling', fixtureConfig(), abortController);
    expect(options.abortController).toBe(abortController);
  });
});

describe('runOneShotSession — the message stream, log path, and typed result (Task 13, Step 3)', () => {
  test('captures the session id and writes supervisor/sessions/<sessionId>.log', async () => {
    const io = recordingIo();
    io.spawnSession = () => messages([INIT_MESSAGE, RESULT_MESSAGE]);

    const result = await runOneShotSession(
      { kind: 'ruling', prompt: 'rule on this', config: fixtureConfig() },
      io,
    );

    expect(result.outcome).toBe('success');
    expect(result.sessionId).toBe('sess-abc');
    expect(io.calls).toEqual([
      'onSessionStart:sess-abc',
      'appendLog:/abs/home/.tribe/key/campaigns/slug/supervisor/sessions/sess-abc.log',
      'appendLog:/abs/home/.tribe/key/campaigns/slug/supervisor/sessions/sess-abc.log',
    ]);
  });

  test('returns the SDK usage/total_cost_usd/permission_denials verbatim off the result message', async () => {
    const io = recordingIo();
    io.spawnSession = () => messages([INIT_MESSAGE, RESULT_MESSAGE]);

    const result = await runOneShotSession(
      { kind: 'ratify', prompt: 'ratify these ids', config: fixtureConfig() },
      io,
    );

    expect(result.usage).toEqual({
      input_tokens: 100,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
      output_tokens: 20,
    });
    expect(result.totalCostUsd).toBe(0.0123);
    expect(result.permissionDenials).toEqual([
      { tool_name: 'Write', tool_input: { file_path: '/abs/repo/src/touched.txt' } },
    ]);
  });

  test('a spawn that throws resolves to a typed failure, never a rejected promise', async () => {
    const io = recordingIo();
    io.spawnSession = () => {
      throw new Error('no capacity for a new session');
    };

    const result = await runOneShotSession(
      { kind: 'closing', prompt: 'close the campaign', config: fixtureConfig() },
      io,
    );

    expect(result.outcome).toBe('error');
    expect(result.finalText).toContain('no capacity for a new session');
    expect(result.sessionId).toBeNull();
  });

  test('a stream that throws mid-iteration also resolves to a typed failure', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      (async function* () {
        yield INIT_MESSAGE;
        throw new Error('stream rejected');
      })();

    const result = await runOneShotSession(
      { kind: 'ruling', prompt: 'rule on this', config: fixtureConfig() },
      io,
    );

    expect(result.outcome).toBe('error');
    expect(result.finalText).toContain('stream rejected');
  });

  test('exceeding the wall-clock budget resolves to outcome "timeout" and aborts the session', async () => {
    const io = recordingIo();
    let captured: OneShotSessionOptions | undefined;
    io.spawnSession = (params) => {
      captured = params.options;
      return (async function* () {
        yield INIT_MESSAGE;
        await new Promise(() => {}); // hang forever — only the timeout should resolve first
      })();
    };

    const result = await runOneShotSession(
      { kind: 'ruling', prompt: 'rule on this', config: fixtureConfig(), sessionTimeoutMs: 20 },
      io,
    );

    expect(result.outcome).toBe('timeout');
    expect(captured?.abortController.signal.aborted).toBe(true);
  });

  test('a result message with a non-success subtype -> outcome "error"', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      messages([INIT_MESSAGE, { type: 'result', subtype: 'error_max_turns', session_id: 'sess-abc' }]);

    const result = await runOneShotSession(
      { kind: 'ratify', prompt: 'ratify these ids', config: fixtureConfig() },
      io,
    );

    expect(result.outcome).toBe('error');
  });
});
