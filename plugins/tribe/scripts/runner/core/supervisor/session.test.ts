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
import { SCAN_DENIED_REASON, type HookDecision, type SessionMessage } from '../session.ts';
import type { SessionKind } from './model.ts';

function fixtureConfig(overrides: Partial<OneShotSessionConfig> = {}): OneShotSessionConfig {
  return {
    homeDir: '/abs/home/.tribe/key/campaigns/slug',
    model: 'claude-haiku-fixture',
    maxTurns: 60,
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

  // R11 (owner ruling, Task 20): `settingSources: ['project']` grants NOTHING when the target
  // repo has no committed `.claude/settings.json` (this repo has none), so `closing` could not
  // run headless at all. R11 REPLACES the old "no grant/deny list — the full Claude Code set"
  // shape (the assertion this test used to pin) with an EXPLICIT allowedTools/disallowedTools
  // pair naming exactly the tools Stage D uses — brief-contracts.md: an assertion the governing
  // ruling changed is updated, not preserved.
  test('closing carries R11\'s explicit tool grant — Stage D\'s tools allowed, subagents/network/wait-tool denied', () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash', 'Skill']);
    expect(options.disallowedTools).toEqual([
      'Task', 'Agent', 'WebFetch', 'WebSearch', 'Monitor', 'ScheduleWakeup',
    ]);
  });

  test('closing carries plugins: [{type: local, path}] when verifyShippedPluginDir is set (R11 item 4)', () => {
    const options = buildOneShotOptions(
      'closing', fixtureConfig({ verifyShippedPluginDir: '/abs/plugins/verify-shipped' }), new AbortController(),
    );
    expect(options.plugins).toEqual([{ type: 'local', path: '/abs/plugins/verify-shipped' }]);
  });

  test('closing carries no plugins field when verifyShippedPluginDir is not set', () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    expect(options.plugins).toBeUndefined();
  });

  test('ruling/ratify never carry plugins, even when verifyShippedPluginDir happens to be set', () => {
    for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
      const options = buildOneShotOptions(
        kind, fixtureConfig({ verifyShippedPluginDir: '/abs/plugins/verify-shipped' }), new AbortController(),
      );
      expect(options.plugins).toBeUndefined();
    }
  });

  for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
    test(`${kind} carries a containment hook, and the wired hook actually denies an escape (not merely "present")`, async () => {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.hooks?.PreToolUse).toHaveLength(2);
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

  // Fix 2 (skinner audit): `--session-max-turns` was parsed and bounds-checked in args.ts but
  // wired to nothing — `OneShotSessionOptions` carried no `maxTurns` at all, so the SDK's
  // `query()` never received a turn cap. This is the regression guard.
  test('maxTurns carries the configured OneShotSessionConfig.maxTurns value, for every kind', () => {
    for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig({ maxTurns: 17 }), new AbortController());
      expect(options.maxTurns).toBe(17);
    }
  });

  // Card supervisor-session-settings (G3): the executor path's tier list, for every kind — the
  // 'user' tier is what registers ~/.claude/settings.json's enabledPlugins (the C3 plugin).
  test('settingSources is ["user","project","local"] for every kind (parity with core/session.ts)', () => {
    for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.settingSources).toEqual(['user', 'project', 'local']);
    }
  });

  // Owner ruling R2: JUDGMENT_ALLOWED_TOOLS gains Skill — and ONLY Skill.
  test('ruling and ratify are granted the old five tools plus Skill, and nothing else', () => {
    for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Skill']);
      expect(options.disallowedTools).toContain('Bash');
    }
  });

  for (const kind of ['ruling', 'ratify'] as SessionKind[]) {
    test(`${kind}: through the WIRED hooks, Skill passes while Bash and an out-of-home Write are refused`, async () => {
      const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
      const skill = await wiredDecisions(options, { tool_name: 'Skill', tool_input: { skill: 'c3' } });
      expect(skill.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
      const bash = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command: 'git status' } });
      expect(bash.some((d) => d.hookSpecificOutput?.permissionDecision === 'deny')).toBe(true);
      const write = await wiredDecisions(options, { tool_name: 'Write', tool_input: { file_path: '/abs/repo/src/touched.txt' } });
      expect(write.some((d) => d.hookSpecificOutput?.permissionDecision === 'deny')).toBe(true);
    });
  }
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

// Issue #163's variant list, verbatim in intent: plain, quoted, sh -c, eval, backtick,
// /usr/bin/find and ${HOME}. Every one is denied by isFilesystemWideScan at d6cad2f (spec §4.7).
const SCAN_VARIANTS = [
  'find / -name x',
  "find '/' -name x",
  'find "/" -name x',
  "sh -c 'find / -name x'",
  'bash -c "find / -name x"',
  "eval 'find / -name x'",
  'echo `find / -name x`',
  '/usr/bin/find / -name x',
  'find ${HOME} -name x',
  'find "${HOME}" -name x',
  'find ~ -name x',
  'find $HOME -name x',
];

/** Every decision the envelope's wired PreToolUse hooks return for one event, in order. */
async function wiredDecisions(options: OneShotSessionOptions, event: unknown): Promise<HookDecision[]> {
  const decisions: HookDecision[] = [];
  for (const entry of options.hooks?.PreToolUse ?? []) {
    for (const hook of entry.hooks) decisions.push(await hook(event));
  }
  return decisions;
}

function isScanDenial(d: HookDecision): boolean {
  return d.hookSpecificOutput?.permissionDecision === 'deny'
    && d.hookSpecificOutput?.permissionDecisionReason === SCAN_DENIED_REASON;
}

describe('the scan wall is wired into every supervisor envelope (issue #163, G2)', () => {
  for (const kind of ['ruling', 'ratify', 'closing'] as SessionKind[]) {
    for (const command of SCAN_VARIANTS) {
      test(`${kind}: the wired hooks refuse ${JSON.stringify(command)} with SCAN_DENIED_REASON`, async () => {
        const options = buildOneShotOptions(kind, fixtureConfig(), new AbortController());
        const decisions = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command } });
        expect(decisions.some(isScanDenial)).toBe(true);
      });
    }
  }

  test('closing: a scoped find gets no denial from any wired hook', async () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    const decisions = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command: 'find /abs/repo -name x' } });
    expect(decisions.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
  });

  test('closing still has no write containment — a Write into the repo is not denied (spec §5.4)', async () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    const decisions = await wiredDecisions(options, { tool_name: 'Write', tool_input: { file_path: '/abs/repo/src/touched.txt' } });
    expect(decisions.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
  });

  test('closing: the wired hooks deny an un-granted tool (Workflow) and allow Bash', async () => {
    const options = buildOneShotOptions('closing', fixtureConfig(), new AbortController());
    const denied = await wiredDecisions(options, { tool_name: 'Workflow', tool_input: {} });
    expect(denied.some((d) => d.hookSpecificOutput?.permissionDecision === 'deny')).toBe(true);
    const allowed = await wiredDecisions(options, { tool_name: 'Bash', tool_input: { command: 'git status' } });
    expect(allowed.every((d) => d.hookSpecificOutput?.permissionDecision !== 'deny')).toBe(true);
  });
});
