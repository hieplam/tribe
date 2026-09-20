// Tests for session.ts (Task 5b): the pinned §D1 SDK option set, init-message capture
// ordering, typed result parsing, timeout, and resume-attempt-failure handling.
//
// NEVER hits the real SDK or the network: every test drives `runSession` through a fake
// `io.spawnSession` seam. Fixtures are neutral (no repo names, no campaign values, no
// model names baked in) — the stateless-capability wall.
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MERGE_GATE_DENIED_CHECKS_ERROR_REASON } from './merge-gate.ts';
import {
  BACKGROUNDING_DENIED_REASON,
  TRIBE_PLUGIN_DIR,
  WAIT_TOOL_DENIED_REASON,
  decideBackgroundingHook,
  decideMergeGateHook,
  decideScanGuardHook,
  decideWaitToolHook,
  runSession,
  type HookDecision,
  type PinnedSessionOptions,
  type RunSessionConfig,
  type SessionIO,
  type SessionMessage,
} from './session.ts';

function fixtureConfig(overrides: Partial<RunSessionConfig> = {}): RunSessionConfig {
  return {
    repoRoot: '/fixture/repo',
    model: 'fixture-model',
    logsDir: '/fixture/logs',
    card: 'C7',
    ...overrides,
  };
}

function recordingIo(
  execInRepo?: SessionIO['execInRepo'],
): SessionIO & { calls: string[]; logLines: string[] } {
  const calls: string[] = [];
  const logLines: string[] = [];
  return {
    calls,
    logLines,
    execInRepo,
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

const INIT_MESSAGE: SessionMessage = {
  type: 'system',
  subtype: 'init',
  session_id: 'sess-123',
};

describe('runSession — §D1 option set (regression guard against SDK drift)', () => {
  test('passes exactly the pinned §D1 options to io.spawnSession', async () => {
    let capturedOptions: PinnedSessionOptions | undefined;
    const io = recordingIo();
    io.spawnSession = (params) => {
      capturedOptions = params.options;
      return messages([
        INIT_MESSAGE,
        { type: 'result', subtype: 'success', result: 'SHIPPED 42 abc1234', session_id: 'sess-123' },
      ]);
    };

    const config = fixtureConfig();
    await runSession({ brief: 'do the thing' }, config, io);

    expect(capturedOptions).toBeDefined();
    const options = capturedOptions as PinnedSessionOptions;
    expect(options.cwd).toBe('/fixture/repo');
    expect(options.model).toBe('fixture-model');
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(options.settingSources).toEqual(['project']);
    expect(options.plugins).toEqual([{ type: 'local', path: TRIBE_PLUGIN_DIR }]);
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(options.executable).toBe('bun');
    expect(options.resume).toBeUndefined();
  });

  test('wires the anti-livelock PreToolUse deny-hook into every spawned session', async () => {
    let capturedOptions: PinnedSessionOptions | undefined;
    const io = recordingIo();
    io.spawnSession = (params) => {
      capturedOptions = params.options;
      return messages([
        INIT_MESSAGE,
        { type: 'result', subtype: 'success', result: 'SHIPPED 42 abc1234', session_id: 'sess-123' },
      ]);
    };

    await runSession({ brief: 'do the thing' }, fixtureConfig(), io);

    // Not merely "a hook is present" — invoke the wired hook and prove it actually denies.
    const wired = (capturedOptions as PinnedSessionOptions).hooks.PreToolUse[0]?.hooks[0];
    expect(wired).toBeDefined();
    const decision = await (wired as (i: unknown) => Promise<{ hookSpecificOutput?: { permissionDecision?: string } }>)({
      tool_name: 'Bash',
      tool_input: { command: 'bun run e2e:chrome', run_in_background: true },
    });
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  test('wires the wait-tool deny-hook into every spawned session', async () => {
    let capturedOptions: PinnedSessionOptions | undefined;
    const io = recordingIo();
    io.spawnSession = (params) => {
      capturedOptions = params.options;
      return messages([
        INIT_MESSAGE,
        { type: 'result', subtype: 'success', result: 'SHIPPED 42 abc1234', session_id: 'sess-123' },
      ]);
    };

    await runSession({ brief: 'do the thing' }, fixtureConfig(), io);

    // P1 audit fix-round (should-fix, scout): its own PreToolUse entry, index 1 — never
    // grafted into `decideBackgroundingHook`'s (index 0).
    const wired = (capturedOptions as PinnedSessionOptions).hooks.PreToolUse[1]?.hooks[0];
    expect(wired).toBeDefined();
    const decision = await (wired as (i: unknown) => Promise<{ hookSpecificOutput?: { permissionDecision?: string } }>)({
      tool_name: 'Monitor',
      tool_input: { description: 'watch CI' },
    });
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  test('wires the pre-merge check gate PreToolUse deny-hook into every spawned session', async () => {
    let capturedOptions: PinnedSessionOptions | undefined;
    const io = recordingIo();
    io.spawnSession = (params) => {
      capturedOptions = params.options;
      return messages([
        INIT_MESSAGE,
        { type: 'result', subtype: 'success', result: 'SHIPPED 42 abc1234', session_id: 'sess-123' },
      ]);
    };

    await runSession({ brief: 'do the thing' }, fixtureConfig(), io);

    // Not merely "a hook is present" — invoke the wired hook and prove it actually denies (no
    // execInRepo stub needed: a forbidden-flag merge denies without ever calling out). Index 2:
    // 0 is decideBackgroundingHook, 1 is decideWaitToolHook (P1 audit fix-round split).
    const wired = (capturedOptions as PinnedSessionOptions).hooks.PreToolUse[2]?.hooks[0];
    expect(wired).toBeDefined();
    const decision = await (wired as (i: unknown) => Promise<HookDecision>)({
      tool_name: 'Bash',
      tool_input: { command: 'gh pr merge --admin' },
    });
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  test('TRIBE_PLUGIN_DIR is derived from the module location, never a hardcoded absolute path', () => {
    expect(TRIBE_PLUGIN_DIR).not.toContain('ai-dict');
    expect(TRIBE_PLUGIN_DIR.endsWith('runner')).toBe(false);
  });

  test('TRIBE_PLUGIN_DIR resolves on disk to the real plugins/tribe directory (not counted by eye)', () => {
    // The runner lives at plugins/tribe/scripts/runner/core/ — three levels below plugins/tribe.
    // Prove the resolved path is that exact directory by checking a file that only exists
    // there, not by asserting a string suffix alone.
    expect(TRIBE_PLUGIN_DIR.endsWith(join('plugins', 'tribe'))).toBe(true);
    expect(existsSync(join(TRIBE_PLUGIN_DIR, '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  test('passes options.resume when a resume input is given', async () => {
    let capturedOptions: PinnedSessionOptions | undefined;
    const io = recordingIo();
    io.spawnSession = (params) => {
      capturedOptions = params.options;
      return messages([
        INIT_MESSAGE,
        { type: 'result', subtype: 'success', result: 'SHIPPED 1 aaaaaaa', session_id: 'sess-123' },
      ]);
    };

    await runSession({ brief: 'continue', resume: 'sess-previous' }, fixtureConfig(), io);
    expect((capturedOptions as PinnedSessionOptions).resume).toBe('sess-previous');
  });
});

describe('decideBackgroundingHook — the anti-livelock wall, enforced', () => {
  function deny(toolName: string, toolInput: Record<string, unknown> = {}) {
    return decideBackgroundingHook({ tool_name: toolName, tool_input: toolInput });
  }

  test('denies the exact call that killed 6 workers: a backgrounded Bash e2e run', () => {
    const decision = deny('Bash', { command: 'bun run e2e:chrome', run_in_background: true });
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toBe(BACKGROUNDING_DENIED_REASON);
  });

  test('allows a foreground Bash call, with or without an explicit false', () => {
    expect(deny('Bash', { command: 'bun test', timeout: 600000 })).toEqual({});
    expect(deny('Bash', { command: 'bun test', run_in_background: false })).toEqual({});
  });

  test('denies Agent/Task when run_in_background is OMITTED — those tools background by default', () => {
    expect(deny('Agent', { prompt: 'audit this' }).hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(deny('Task', { prompt: 'audit this' }).hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  test('allows Agent/Task only when it explicitly opts out of backgrounding', () => {
    expect(deny('Agent', { prompt: 'audit this', run_in_background: false })).toEqual({});
    expect(deny('Task', { prompt: 'audit this', run_in_background: false })).toEqual({});
  });

  test('leaves unrelated tools alone', () => {
    expect(deny('Read', { file_path: '/x' })).toEqual({});
    expect(deny('Edit', { file_path: '/x' })).toEqual({});
  });

  test('does not throw on malformed or absent hook input', () => {
    expect(decideBackgroundingHook(undefined)).toEqual({});
    expect(decideBackgroundingHook(null)).toEqual({});
    expect(decideBackgroundingHook({})).toEqual({});
    expect(decideBackgroundingHook({ tool_name: 42, tool_input: 'nonsense' })).toEqual({});
  });

  test('a backgrounded Bash still denies with BACKGROUNDING_DENIED_REASON (unchanged)', () => {
    const decision = deny('Bash', { command: 'bun run e2e:chrome', run_in_background: true });
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toBe(BACKGROUNDING_DENIED_REASON);
  });

  // P1 audit fix-round (should-fix, scout): Monitor/ScheduleWakeup are a DIFFERENT concern
  // (waiting synchronously ends the turn; it is not a backgrounding attempt) and now have
  // their own hook, `decideWaitToolHook` (below) — registered as its own separate PreToolUse
  // entry, the same one-function-per-concern shape `decideMergeGateHook` already established.
  // `decideBackgroundingHook` must stay exactly what its name/docstring says it is.
  test('leaves Monitor/ScheduleWakeup alone — that concern lives in decideWaitToolHook, not here', () => {
    expect(deny('Monitor', { description: 'watch CI' })).toEqual({});
    expect(deny('ScheduleWakeup', { delaySeconds: 300 })).toEqual({});
  });
});

// P1 audit fix-round (should-fix, scout): split out of `decideBackgroundingHook` into its own
// named hook — mirrors the sibling `decideMergeGateHook` pattern (one PreToolUse concern per
// function), so a reader grepping "wait tool" or "backgrounding" finds exactly the function
// that owns that concern, and the next denied tool has an established place to go rather than
// being grafted onto an unrelated function's body.
describe('decideWaitToolHook — wait-tools end a session before a notification can ever reach it', () => {
  function deny(toolName: string, toolInput: Record<string, unknown> = {}) {
    return decideWaitToolHook({ tool_name: toolName, tool_input: toolInput });
  }

  // P1 fix-list: wait-tools end a session's turn without a terminal SHIPPED/NEEDS_DIRECTION
  // line — an armed Monitor/ScheduleWakeup notification can never reach a session that has
  // already died. Deny both, with a steering message that teaches the foreground alternative.
  test('denies Monitor with WAIT_TOOL_DENIED_REASON', () => {
    const decision = deny('Monitor', { description: 'watch CI' });
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toBe(WAIT_TOOL_DENIED_REASON);
  });

  test('denies ScheduleWakeup with WAIT_TOOL_DENIED_REASON', () => {
    const decision = deny('ScheduleWakeup', { delaySeconds: 300 });
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toBe(WAIT_TOOL_DENIED_REASON);
  });

  test('leaves Read/Grep/plain Bash alone (no wait-tool false positive)', () => {
    expect(deny('Read', { file_path: '/x' })).toEqual({});
    expect(deny('Grep', { pattern: 'foo' })).toEqual({});
    expect(deny('Bash', { command: 'bun test', timeout: 600000 })).toEqual({});
  });

  test('does not throw on malformed or absent hook input', () => {
    expect(decideWaitToolHook(undefined)).toEqual({});
    expect(decideWaitToolHook(null)).toEqual({});
    expect(decideWaitToolHook({})).toEqual({});
    expect(decideWaitToolHook({ tool_name: 42, tool_input: 'nonsense' })).toEqual({});
  });
});

describe('runSession — init-message capture ordering (crash-safety guarantee)', () => {
  test('invokes io.onSessionStart on the init message BEFORE the result message is processed', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      messages([
        INIT_MESSAGE,
        { type: 'result', subtype: 'success', result: 'SHIPPED 42 abc1234', session_id: 'sess-123' },
      ]);

    const result = await runSession({ brief: 'do the thing' }, fixtureConfig(), io);

    expect(result.outcome).toBe('shipped');
    expect(io.calls).toEqual([
      'onSessionStart:sess-123',
      'appendLog:/fixture/logs/C7-sess-123.log',
      'appendLog:/fixture/logs/C7-sess-123.log',
    ]);
    expect(io.logLines[0]).toContain('"subtype":"init"');
    expect(io.logLines[1]).toContain('"type":"result"');
  });
});

describe('runSession — typed result parsing', () => {
  test('a SHIPPED <pr> <sha> line -> outcome "shipped" with pr/sha extracted', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      messages([
        INIT_MESSAGE,
        {
          type: 'result',
          subtype: 'success',
          result: 'All tasks landed.\nSHIPPED 42 abc1234def',
          session_id: 'sess-123',
        },
      ]);

    const result = await runSession({ brief: 'x' }, fixtureConfig(), io);
    expect(result).toEqual({
      outcome: 'shipped',
      finalText: 'All tasks landed.\nSHIPPED 42 abc1234def',
      pr: 42,
      sha: 'abc1234def',
    });
  });

  test('a NEEDS_DIRECTION: line -> outcome "needs_direction"', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      messages([
        INIT_MESSAGE,
        {
          type: 'result',
          subtype: 'success',
          result: 'NEEDS_DIRECTION: which schema-lock path applies here?',
          session_id: 'sess-123',
        },
      ]);

    const result = await runSession({ brief: 'x' }, fixtureConfig(), io);
    expect(result.outcome).toBe('needs_direction');
    expect(result.finalText).toBe('NEEDS_DIRECTION: which schema-lock path applies here?');
    expect(result.pr).toBeUndefined();
    expect(result.sha).toBeUndefined();
  });

  test('a malformed terminal line (neither SHIPPED nor NEEDS_DIRECTION) -> outcome "error"', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      messages([
        INIT_MESSAGE,
        { type: 'result', subtype: 'success', result: 'looks done, forgot the contract line', session_id: 'sess-123' },
      ]);

    const result = await runSession({ brief: 'x' }, fixtureConfig(), io);
    expect(result.outcome).toBe('error');
  });

  test('a result message with an error subtype -> outcome "error"', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      messages([INIT_MESSAGE, { type: 'result', subtype: 'error_max_turns', session_id: 'sess-123' }]);

    const result = await runSession({ brief: 'x' }, fixtureConfig(), io);
    expect(result.outcome).toBe('error');
  });
});

describe('runSession — timeout path', () => {
  test('aborts and returns outcome "timeout" when the session exceeds the wall-clock budget', async () => {
    const io = recordingIo();
    let capturedOptions: PinnedSessionOptions | undefined;
    io.spawnSession = (params) => {
      capturedOptions = params.options;
      return (async function* () {
        yield INIT_MESSAGE;
        await new Promise(() => {}); // hang forever — only the timeout should resolve first
      })();
    };

    const result = await runSession(
      { brief: 'x' },
      fixtureConfig({ sessionTimeoutMs: 20 }),
      io,
    );

    expect(result.outcome).toBe('timeout');
    expect((capturedOptions as PinnedSessionOptions).abortController).toBeInstanceOf(AbortController);
    expect((capturedOptions as PinnedSessionOptions).abortController.signal.aborted).toBe(true);
  });
});

describe('runSession — resume-attempt failure (§D4 fallback trigger)', () => {
  test('a failed resume attempt surfaces as a typed error, not a thrown exception', async () => {
    const io = recordingIo();
    io.spawnSession = () => {
      throw new Error('no transcript found for session sess-previous');
    };

    const result = await runSession({ brief: 'continue', resume: 'sess-previous' }, fixtureConfig(), io);
    expect(result.outcome).toBe('error');
    expect(result.finalText).toContain('no transcript found for session sess-previous');
  });

  test('a resume attempt that fails mid-stream (iterator throws) also surfaces as a typed error', async () => {
    const io = recordingIo();
    io.spawnSession = () =>
      (async function* () {
        yield INIT_MESSAGE;
        throw new Error('resume stream rejected');
      })();

    const result = await runSession({ brief: 'continue', resume: 'sess-previous' }, fixtureConfig(), io);
    expect(result.outcome).toBe('error');
    expect(result.finalText).toContain('resume stream rejected');
  });
});

describe('decideMergeGateHook — the pre-merge check gate, enforced (P2 fix-list card)', () => {
  // Calls the exported hook function DIRECTLY (mirrors decideBackgroundingHook's own describe
  // block above) — decoupled from spawnSession/message-parsing machinery and from the wired
  // hook's array position, so reordering the PreToolUse array can never silently make these
  // tests exercise the wrong function. A single wiring smoke test (in the §D1 option set
  // describe above) is the only place that still goes through the real wiring.
  function hookWith(execInRepo: SessionIO['execInRepo']): (input: unknown) => Promise<HookDecision> {
    return decideMergeGateHook({ execInRepo });
  }

  test('denies a merge attempt when gh pr checks reports a red check (A2 replay: format-check red)', async () => {
    const hook = hookWith(async () => ({
      stdout: JSON.stringify([{ name: 'format-check', state: 'FAILURE' }]),
      exitCode: 0,
    }));

    const decision = await hook({ tool_name: 'Bash', tool_input: { command: 'gh pr merge --merge' } });

    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toContain('format-check: FAILURE');
  });

  test('allows a merge attempt when gh pr checks reports every check SUCCESS', async () => {
    const hook = hookWith(async () => ({
      stdout: JSON.stringify([{ name: 'format-check', state: 'SUCCESS' }]),
      exitCode: 0,
    }));

    const decision = await hook({ tool_name: 'Bash', tool_input: { command: 'gh pr merge --merge' } });

    expect(decision).toEqual({});
  });

  test('denies outright on --auto, without ever calling execInRepo', async () => {
    let execCalled = false;
    const hook = hookWith(async () => {
      execCalled = true;
      return { stdout: '[]', exitCode: 0 };
    });

    const decision = await hook({ tool_name: 'Bash', tool_input: { command: 'gh pr merge --auto' } });

    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(execCalled).toBe(false);
  });

  test('denies outright on --admin, without ever calling execInRepo', async () => {
    let execCalled = false;
    const hook = hookWith(async () => {
      execCalled = true;
      return { stdout: '[]', exitCode: 0 };
    });

    const decision = await hook({ tool_name: 'Bash', tool_input: { command: 'gh pr merge --admin' } });

    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(execCalled).toBe(false);
  });

  test('returns an empty decision for a non-merge Bash command, without ever calling execInRepo', async () => {
    let execCalled = false;
    const hook = hookWith(async () => {
      execCalled = true;
      return { stdout: '[]', exitCode: 0 };
    });

    const decision = await hook({ tool_name: 'Bash', tool_input: { command: 'bun test' } });

    expect(decision).toEqual({});
    expect(execCalled).toBe(false);
  });

  test('returns an empty decision for a non-Bash tool call', async () => {
    let execCalled = false;
    const hook = hookWith(async () => {
      execCalled = true;
      return { stdout: '[]', exitCode: 0 };
    });

    const decision = await hook({ tool_name: 'Read', tool_input: { file_path: '/x' } });

    expect(decision).toEqual({});
    expect(execCalled).toBe(false);
  });

  // P2 audit fix (skinnerB): a REJECTING execInRepo (real-world: the `gh` binary missing,
  // ENOENT) must still resolve to the module's own fail-closed deny decision, never a rejected
  // promise — the hook is documented "fail-closed, never crash" and must honor that even when
  // its one injected I/O call misbehaves.
  test('fails closed (denies) when execInRepo REJECTS instead of resolving — never crashes the hook', async () => {
    const hook = hookWith(async () => {
      throw new Error('gh: command not found (ENOENT)');
    });

    const decision = await hook({ tool_name: 'Bash', tool_input: { command: 'gh pr merge --merge' } });

    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toBe(MERGE_GATE_DENIED_CHECKS_ERROR_REASON);
  });
});

describe('decideScanGuardHook (R-a)', () => {
  test('denies a filesystem-wide find and names the alternative', async () => {
    const d = decideScanGuardHook({ tool_name: 'Bash', tool_input: { command: 'find / -maxdepth 4 -iname "*c3x*"' } });
    expect(d.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(d.hookSpecificOutput?.permissionDecisionReason).toContain('c3');
  });

  test('allows a scoped find', () => {
    expect(decideScanGuardHook({ tool_name: 'Bash', tool_input: { command: 'find /Users/hip/repo/tribe -iname "x"' } })).toEqual({});
  });

  test('has no opinion on non-Bash tools', () => {
    expect(decideScanGuardHook({ tool_name: 'Read', tool_input: { command: 'find / -name x' } })).toEqual({});
  });

  test('is wired as the FOURTH PreToolUse entry and actually denies', async () => {
    let captured: PinnedSessionOptions | undefined;
    const io = recordingIo();
    io.spawnSession = (params) => {
      captured = params.options;
      return messages([INIT_MESSAGE, { type: 'result', subtype: 'success', result: 'SHIPPED 42 abc1234', session_id: 'sess-123' }]);
    };
    await runSession({ brief: 'x' }, fixtureConfig(), io);
    const wired = (captured as PinnedSessionOptions).hooks.PreToolUse[3]?.hooks[0];
    expect(wired).toBeDefined();
    const d = await (wired as (i: unknown) => Promise<HookDecision>)({
      tool_name: 'Bash',
      tool_input: { command: 'find $HOME -name "*.log"' },
    });
    expect(d.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
