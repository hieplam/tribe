// Tests for run.ts (Task 6): CLI argument parsing. Pure and testable without touching real
// gh/git/fs/the SDK — `main()`'s real-world wiring is not exercised here, matching
// session.ts's `sdkSpawnSession` precedent (option-building/parsing is fully covered without
// hitting the real dependency). Every value is a caller input — no defaults bake in a repo,
// model, or campaign (stateless-capability wall); `--session-timeout`/`--logs-dir` are the
// two protocol-level defaults spec §2 itself documents; `--home` (Task 2, spec §4) is the
// campaign's machine-local operational home — also a REQUIRED input, never derived here.
import { describe, expect, mock, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  announceViewer, parseArgs, parseResetCardArgs, performResetCard, runTranscriptMetrics,
  scrubTargetEnvLocal,
} from './main.ts';
import { campaignStatePathOf, escalationPathOf } from '../core/paths.ts';
import { WATCHDOG_EXIT_NEEDS_HUMAN } from '../core/watchdog/model.ts';
import type { ViewerLaunchDecision } from '../core/viewer-launch.ts';
import { buildTranscriptIo } from '../adapters/transcript-io.adapter.ts';
import { measureAtCut } from '../adapters/cut.ts';
import type { TranscriptMetricsConfig } from '../core/metrics/args.ts';
import type { TranscriptIO } from '../ports/ports.ts';

const RUN_ID = '2026-07-24T00-00-00-000Z-beef';

/** Every REQUIRED flag, once, for a valid parse — the base every test below builds on. */
function validArgv(): string[] {
  return [
    '--repo', '/repo',
    '--model', 'sonnet',
    '--home', '/th/campaigns/camp',
  ];
}

/** `validArgv()` with the given flag (and its value, if any) removed — for
 * missing-required-flag / default-behavior tests. */
function validArgvWithout(flag: string): string[] {
  const argv = validArgv();
  const idx = argv.indexOf(flag);
  if (idx === -1) return argv;
  const isBooleanFlag = flag === '--dry-run' || flag === '--include-escalated';
  return isBooleanFlag
    ? [...argv.slice(0, idx), ...argv.slice(idx + 1)]
    : [...argv.slice(0, idx), ...argv.slice(idx + 2)];
}

describe('parseArgs — required flags', () => {
  test('all required flags present -> parses successfully', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.config.repoRoot).toBe('/repo');
      expect(result.config.model).toBe('sonnet');
      expect(result.config.homeDir).toBe('/th/campaigns/camp');
    }
  });

  for (const missing of ['--repo', '--model', '--home']) {
    test(`missing ${missing} -> error naming it`, () => {
      const result = parseArgs(validArgvWithout(missing), RUN_ID);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain(missing);
      }
    });
  }
});

// Task 3 (spec §3 decision 2): --state/--answers/--escalations-dir are DELETED flags — every
// campaign artifact now resolves to a fixed name under --home (core/paths.ts), so passing any
// of the three former path flags is a usage error naming the offending flag, not a silent
// no-op. Required flags drop 6 -> 3.
describe('parseArgs — the three deleted path flags (--state/--answers/--escalations-dir)', () => {
  for (const deleted of ['--state', '--answers', '--escalations-dir']) {
    test(`${deleted} is rejected as an unknown flag`, () => {
      const result = parseArgs([...validArgv(), deleted, 'whatever'], RUN_ID);
      expect(result).toEqual({ error: `unknown flag: ${deleted}` });
    });
  }
});

describe('parseArgs — --remote', () => {
  test('defaults to "origin" when omitted', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.config.remote).toBe('origin');
    }
  });

  test('--remote overrides the default', () => {
    const result = parseArgs([...validArgv(), '--remote', 'upstream'], RUN_ID);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.config.remote).toBe('upstream');
    }
  });
});

// Task 13 (spec D11): the live viewer's two flags. Additive — every other flag's
// rejected-by-name behaviour is unchanged, asserted directly below alongside them.
describe('parseArgs — --viewer-port / --no-viewer (Task 13, spec D11)', () => {
  test('--viewer-port defaults to 4321 when omitted', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.viewerPort).toBe(4321);
    }
  });

  test('--viewer-port 4399 overrides the default', () => {
    const result = parseArgs([...validArgv(), '--viewer-port', '4399'], RUN_ID);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.viewerPort).toBe(4399);
    }
  });

  test('--viewer-port rejects a non-positive-integer value', () => {
    const result = parseArgs([...validArgv(), '--viewer-port', 'nope'], RUN_ID);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('--viewer-port');
    }
  });

  // F41: an oversized port fails deep inside the detached child (stdio: 'ignore' makes it
  // invisible there) instead of loudly and early in the parser.
  test('--viewer-port rejects a value above 65535 (F41)', () => {
    const result = parseArgs([...validArgv(), '--viewer-port', '70000'], RUN_ID);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('--viewer-port');
    }
  });

  test('--viewer-port accepts the upper bound 65535 (F41)', () => {
    const result = parseArgs([...validArgv(), '--viewer-port', '65535'], RUN_ID);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.viewerPort).toBe(65535);
    }
  });

  test('--no-viewer defaults to false, and disables the viewer when passed', () => {
    const withoutFlag = parseArgs(validArgv(), RUN_ID);
    expect('error' in withoutFlag).toBe(false);
    if (!('error' in withoutFlag)) {
      expect(withoutFlag.viewerDisabled).toBe(false);
    }

    const withFlag = parseArgs([...validArgv(), '--no-viewer'], RUN_ID);
    expect('error' in withFlag).toBe(false);
    if (!('error' in withFlag)) {
      expect(withFlag.viewerDisabled).toBe(true);
    }
  });

  test('an unknown flag is still rejected by name alongside the new viewer flags', () => {
    const result = parseArgs([...validArgv(), '--viewer-port', '4399', '--no-viewer', '--bogus-flag'], RUN_ID);
    expect(result).toEqual({ error: 'unknown flag: --bogus-flag' });
  });
});

describe('parseArgs — --home / runId (Task 2, spec §4)', () => {
  test('--home is required: missing flag is a usage error', () => {
    const result = parseArgs(validArgvWithout('--home'), RUN_ID);
    expect(result).toEqual({ error: 'missing required flag: --home' });
  });

  test('--home and runId land on the config; argv is echoed verbatim', () => {
    const argv = validArgv(); // includes --home /th/campaigns/camp
    const result = parseArgs(argv, RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.homeDir).toBe('/th/campaigns/camp');
    expect(result.config.runId).toBe(RUN_ID);
    expect(result.config.argv).toEqual(argv);
  });

  test('logs default moves under the run dir (spec §5.4)', () => {
    const result = parseArgs(validArgvWithout('--logs-dir'), RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.logsDir).toBe(`/th/campaigns/camp/runs/${RUN_ID}/logs`);
  });

  test('explicit --logs-dir still overrides the default', () => {
    const result = parseArgs([...validArgvWithout('--logs-dir'), '--logs-dir', '/custom/logs'], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.logsDir).toBe('/custom/logs');
  });
});

describe('parseArgs — defaults (spec §2 protocol defaults, never campaign values)', () => {
  test('--session-timeout defaults to 3h in ms', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.sessionTimeoutMs).toBe(3 * 60 * 60 * 1000);
  });

  test('--dry-run / --include-escalated default to false', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.dryRun).toBe(false);
    expect(result.config.includeEscalated).toBe(false);
  });

  test('--cards / --max-cards default to undefined (no filtering, no card limit)', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.cardsFilter).toBeUndefined();
    expect(result.config.maxCards).toBeUndefined();
  });

  // P12 follow-up: unlike --max-cards ("no limit" has no integer), --max-concurrent's natural
  // default IS a concrete integer (1 == today's one-card-at-a-time behavior) — so, unlike
  // maxCards, it is never left `undefined`.
  test('--max-concurrent defaults to 1 (today\'s one-card-at-a-time behavior)', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.maxConcurrent).toBe(1);
  });
});

describe('parseArgs — explicit overrides', () => {
  test('--session-timeout accepts "30m"/"90s"/"5000ms"/plain ms', () => {
    expect(parseSessionTimeout(validArgv(), '30m')).toBe(30 * 60 * 1000);
    expect(parseSessionTimeout(validArgv(), '90s')).toBe(90 * 1000);
    expect(parseSessionTimeout(validArgv(), '5000ms')).toBe(5000);
    expect(parseSessionTimeout(validArgv(), '5000')).toBe(5000);
  });

  function parseSessionTimeout(base: string[], value: string): number {
    const result = parseArgs([...base, '--session-timeout', value], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    return result.config.sessionTimeoutMs as number;
  }

  test('an invalid --session-timeout -> error', () => {
    const result = parseArgs([...validArgv(), '--session-timeout', 'not-a-duration'], RUN_ID);
    expect('error' in result).toBe(true);
  });

  test('--logs-dir overrides the default', () => {
    const result = parseArgs([...validArgv(), '--logs-dir', '/somewhere/else/logs'], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.logsDir).toBe('/somewhere/else/logs');
  });

  test('--dry-run and --include-escalated are boolean presence flags', () => {
    const result = parseArgs([...validArgv(), '--dry-run', '--include-escalated'], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.dryRun).toBe(true);
    expect(result.config.includeEscalated).toBe(true);
  });

  test('--cards splits a comma-separated list, preserving order', () => {
    const result = parseArgs([...validArgv(), '--cards', 'B3,B4,A6'], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.cardsFilter).toEqual(['B3', 'B4', 'A6']);
  });

  test('--max-cards parses to an integer', () => {
    const result = parseArgs([...validArgv(), '--max-cards', '5'], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.maxCards).toBe(5);
  });

  test('a non-numeric --max-cards -> error', () => {
    const result = parseArgs([...validArgv(), '--max-cards', 'not-a-number'], RUN_ID);
    expect('error' in result).toBe(true);
  });

  test('--max-concurrent parses to an integer', () => {
    const result = parseArgs([...validArgv(), '--max-concurrent', '4'], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.maxConcurrent).toBe(4);
  });

  test('--max-concurrent 1 is accepted (the explicit form of the default)', () => {
    const result = parseArgs([...validArgv(), '--max-concurrent', '1'], RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(result.config.maxConcurrent).toBe(1);
  });

  for (const invalid of ['0', '-1', '1.5', 'not-a-number']) {
    test(`--max-concurrent "${invalid}" -> error naming the flag`, () => {
      const result = parseArgs([...validArgv(), '--max-concurrent', invalid], RUN_ID);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('--max-concurrent');
      }
    });
  }
});

describe('parseArgs — stateless-capability wall', () => {
  test('no ai-dict (or any other repo name) is baked into any default', () => {
    const result = parseArgs(validArgv(), RUN_ID);
    if ('error' in result) throw new Error(result.error);
    expect(JSON.stringify(result.config)).not.toContain('ai-dict');
  });
});

// Skinner audit (P10 fix round): the .env.local scrub used to be an unguarded fs read inlined
// directly in main() — a transient fs error (EACCES, a mid-flight delete, a read-only mount)
// threw an uncaught exception that bypassed the file's own report-writing seam entirely.
// Reproduced live before this fix: `bun run.ts --repo <fixture-with-chmod-000-.env.local>
// --model x --home <home>` crashed with an unhandled EACCES stack trace, exit 1, no report,
// no "campaign runner: unexpected error" message — none of the documented EXIT_* paths.
// scrubTargetEnvLocal is the extracted, directly-testable seam that closes that gap.
describe('scrubTargetEnvLocal — best-effort, never throws (P10 fix round)', () => {
  test('an io.readFile that throws does not propagate — it degrades to a console warning', async () => {
    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
    try {
      const io = {
        fileExists: () => true,
        readFile: () => { throw new Error('EACCES: permission denied'); },
        writeFile: () => { throw new Error('writeFile should not be called'); },
      };
      // The assertion IS that this resolves at all — before the fix, the throw inside
      // io.readFile propagated out of scrubTargetEnvLocal (and, in main(), out of main()
      // itself, as an unhandled promise rejection with no .catch() anywhere in the call chain).
      await expect(scrubTargetEnvLocal('/some/repo', false, io)).resolves.toBeUndefined();
      expect(errors.some((line) => line.includes('could not scrub') && line.includes('EACCES'))).toBe(true);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('no .env.local present -> no-op, io.readFile/writeFile never called', async () => {
    const io = {
      fileExists: () => false,
      readFile: () => { throw new Error('should not be called'); },
      writeFile: () => { throw new Error('should not be called'); },
    };
    await expect(scrubTargetEnvLocal('/some/repo', false, io)).resolves.toBeUndefined();
  });

  test('a real run with a key present writes the cleaned content back', async () => {
    const written: Array<{ path: string; content: string }> = [];
    const io = {
      fileExists: () => true,
      readFile: () => 'ANTHROPIC_API_KEY=sk-ant-x\nFOO=bar\n',
      writeFile: (path: string, content: string) => { written.push({ path, content }); },
    };
    await scrubTargetEnvLocal('/some/repo', false, io);
    expect(written).toEqual([{ path: '/some/repo/.env.local', content: 'FOO=bar\n' }]);
  });

  test('--dry-run warns but never calls io.writeFile', async () => {
    const io = {
      fileExists: () => true,
      readFile: () => 'ANTHROPIC_API_KEY=sk-ant-x\nFOO=bar\n',
      writeFile: () => { throw new Error('writeFile must not be called in dry-run'); },
    };
    await expect(scrubTargetEnvLocal('/some/repo', true, io)).resolves.toBeUndefined();
  });
});

// P11 fix-list follow-up: `reset-card` — "so humans never hand-edit state.json." Pure arg
// parsing first (mirrors `parseArgs`'s own required/unknown-flag tests at a smaller scale).
describe('parseResetCardArgs — the reset-card subcommand\'s own tiny flag set', () => {
  test('valid --home + --card parses successfully', () => {
    const result = parseResetCardArgs(['--home', '/th/campaigns/camp', '--card', 'C1']);
    expect(result).toEqual({ homeDir: '/th/campaigns/camp', cardId: 'C1' });
  });

  test('missing --home -> error naming it', () => {
    const result = parseResetCardArgs(['--card', 'C1']);
    expect(result).toEqual({ error: 'missing required flag: --home' });
  });

  test('missing --card -> error naming it', () => {
    const result = parseResetCardArgs(['--home', '/th/campaigns/camp']);
    expect(result).toEqual({ error: 'missing required flag: --card' });
  });

  test('an unrecognized flag (e.g. --repo) is rejected by name', () => {
    const result = parseResetCardArgs(['--home', '/th', '--card', 'C1', '--repo', '/repo']);
    expect(result).toEqual({ error: 'unknown flag: --repo' });
  });

  test('a flag with no following value -> error', () => {
    const result = parseResetCardArgs(['--home', '/th', '--card']);
    expect(result).toEqual({ error: '--card requires a value' });
  });
});

/** A well-formed campaign state fixture (bypasses parseState's schema by hand-authoring
 * every required field) — used only by `performResetCard`'s tests below. Deliberately neutral
 * values, matching this file's own stateless-capability wall. */
function stateFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    campaign: 'sample-campaign',
    mergePolicy: 'merge',
    sequence: ['C1'],
    schemaLockPaths: [],
    docsOnlyPaths: [],
    ownerOnlyEscalations: [],
    cards: {
      C1: {
        status: 'escalated',
        spec: 'docs/x-spec.md',
        plan: 'docs/x-plan.md',
        branch: 'feat/c1',
        baseSha: 'aaaaaaa',
        pr: 10,
        mergeSha: null,
        sessionId: 'sess-c1',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    },
    ...overrides,
  };
}

/** Builds a `performResetCard` io double over an in-memory file map, plus an optional lock.
 * Mirrors `scrubTargetEnvLocal`'s tests: no real fs, everything observable via `written`. */
function resetCardIo(opts: {
  files?: Record<string, string>;
  lock?: { pid: number; startedAt: string } | null;
  alivePids?: number[];
}) {
  const files = { ...(opts.files ?? {}) };
  const written: Array<{ path: string; content: string }> = [];
  return {
    written,
    io: {
      fileExists: (p: string) => p in files,
      readFile: (p: string) => {
        if (!(p in files)) throw new Error(`ENOENT: no such file, open '${p}'`);
        return files[p] as string;
      },
      writeFile: (p: string, content: string) => {
        files[p] = content;
        written.push({ path: p, content });
      },
      readLock: () => opts.lock ?? null,
      isProcessAlive: (pid: number) => (opts.alivePids ?? []).includes(pid),
    },
  };
}

/** Captures console.error/console.log for the duration of `fn`, restoring both afterward
 * even if `fn` throws — same pattern `scrubTargetEnvLocal`'s tests already use for
 * console.error alone. */
async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; errors: string[]; logs: string[] }> {
  const errors: string[] = [];
  const logs: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
  try {
    const result = await fn();
    return { result, errors, logs };
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
}

describe('performResetCard — the reset-card subcommand\'s execution (P11 follow-up)', () => {
  test('a LIVE lock refuses the reset: exit 1, named diagnostic, state file untouched', async () => {
    const home = '/th/camp';
    const statePath = campaignStatePathOf(home);
    const { io, written } = resetCardIo({
      files: { [statePath]: `${JSON.stringify(stateFixture())}\n` },
      lock: { pid: 123, startedAt: '2026-07-15T00:00:00Z' },
      alivePids: [123],
    });

    const { result, errors } = await captureConsole(() => performResetCard(home, 'C1', io));

    expect(result).toBe(1);
    expect(errors.some((e) => e.includes('reset-card') && e.includes('.runner.lock') && e.includes('123'))).toBe(true);
    expect(written).toEqual([]);
  });

  test('a DEAD lock does not refuse (reclaimed, same as acquireLock)', async () => {
    const home = '/th/camp';
    const statePath = campaignStatePathOf(home);
    const { io } = resetCardIo({
      files: { [statePath]: `${JSON.stringify(stateFixture())}\n` },
      lock: { pid: 123, startedAt: '2026-07-15T00:00:00Z' },
      alivePids: [], // 123 is not alive
    });

    const { result } = await captureConsole(() => performResetCard(home, 'C1', io));
    expect(result).toBe(0);
  });

  test('missing state file -> exit 1, named diagnostic, no lock claimed', async () => {
    const home = '/th/camp';
    const { io, written } = resetCardIo({ files: {} });

    const { result, errors } = await captureConsole(() => performResetCard(home, 'C1', io));

    expect(result).toBe(1);
    expect(errors.some((e) => e.includes('reset-card') && e.includes('could not load'))).toBe(true);
    expect(written).toEqual([]);
  });

  test('unparseable state file (bad JSON) -> exit 1, named diagnostic', async () => {
    const home = '/th/camp';
    const statePath = campaignStatePathOf(home);
    const { io } = resetCardIo({ files: { [statePath]: 'not json{' } });

    const { result, errors } = await captureConsole(() => performResetCard(home, 'C1', io));

    expect(result).toBe(1);
    expect(errors.some((e) => e.includes('reset-card') && e.includes('could not load'))).toBe(true);
  });

  test('unknown card id -> exit 1, named diagnostic naming the id, state file untouched', async () => {
    const home = '/th/camp';
    const statePath = campaignStatePathOf(home);
    const { io, written } = resetCardIo({
      files: { [statePath]: `${JSON.stringify(stateFixture())}\n` },
    });

    const { result, errors } = await captureConsole(() => performResetCard(home, 'does-not-exist', io));

    expect(result).toBe(1);
    expect(errors.some((e) => e.includes('reset-card') && e.includes('does-not-exist'))).toBe(true);
    expect(written).toEqual([]);
  });

  test('a successful reset writes the updated state and prints a one-line JSON summary', async () => {
    const home = '/th/camp';
    const statePath = campaignStatePathOf(home);
    const { io, written } = resetCardIo({
      files: { [statePath]: `${JSON.stringify(stateFixture())}\n` },
    });

    const { result, logs } = await captureConsole(() => performResetCard(home, 'C1', io));

    expect(result).toBe(0);
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe(statePath);
    const writtenState = JSON.parse(written[0]?.content as string);
    expect(writtenState.cards.C1.status).toBe('staged');
    expect(writtenState.cards.C1.sessionId).toBeNull();
    expect(writtenState.cards.C1.baseSha).toBeNull();
    expect(writtenState.cards.C1.pr).toBeNull();
    // Structural field survives, per resetCard's own contract.
    expect(writtenState.cards.C1.branch).toBe('feat/c1');

    expect(logs).toHaveLength(1);
    const summary = JSON.parse(logs[0] as string);
    expect(summary).toEqual({
      cardId: 'C1',
      previousStatus: 'escalated',
      status: 'staged',
      clearedFields: ['sessionId', 'baseSha', 'pr', 'updatedAt'],
    });
  });

  test('a still-present escalation file prints a warning note but still succeeds', async () => {
    const home = '/th/camp';
    const statePath = campaignStatePathOf(home);
    const escalationPath = escalationPathOf(home, 'C1');
    const { io } = resetCardIo({
      files: {
        [statePath]: `${JSON.stringify(stateFixture())}\n`,
        [escalationPath]: '# unanswered escalation',
      },
    });

    const { result, errors } = await captureConsole(() => performResetCard(home, 'C1', io));

    expect(result).toBe(0);
    expect(errors.some((e) => e.includes('reset-card') && e.includes(escalationPath))).toBe(true);
  });

  test('no escalation file -> no note printed', async () => {
    const home = '/th/camp';
    const statePath = campaignStatePathOf(home);
    const { io } = resetCardIo({
      files: { [statePath]: `${JSON.stringify(stateFixture())}\n` },
    });

    const { errors } = await captureConsole(() => performResetCard(home, 'C1', io));
    expect(errors).toEqual([]);
  });
});

import { resolveWatchdogHome } from './main.ts';

describe('resolveWatchdogHome — the watchdog subcommand gate (fail-closed)', () => {
  // Anchored at path-START (not a bare first-occurrence replace): a real `realpathSync` is
  // idempotent — realpathing an already-resolved path returns it unchanged — and `io.cwd()`
  // below is itself given already pre-resolved (containing `/private/var/`), the way Node's
  // real `process.cwd()` already is. A non-anchored `.replace('/var/', '/private/var/')`
  // would match that PRE-RESOLVED `/private/var/` substring too and double-prefix the
  // relative-home case, breaking idempotency the real adapter always has.
  const io = {
    realpath: (p: string) => p.replace(/^\/var\//, '/private/var/'),
    userHome: () => '/var/t/home',
    cwd: () => '/private/var/t/home/.tribe/k/campaigns',
    fileExists: (p: string) => p === '/private/var/t/home/.tribe/k/campaigns/c/campaign-state.json',
  };

  test('an absolute home inside the realpathed tribe root is accepted (W-P10)', () => {
    const got = resolveWatchdogHome('/var/t/home/.tribe/k/campaigns/c', io);
    expect(got).toEqual({ homeDir: '/private/var/t/home/.tribe/k/campaigns/c' });
  });

  test('a RELATIVE home resolves against cwd — the shape a person types', () => {
    const got = resolveWatchdogHome('c', io);
    expect(got).toEqual({ homeDir: '/private/var/t/home/.tribe/k/campaigns/c' });
  });

  test('a home outside the tribe root is refused with a typed message, not a throw', () => {
    const got = resolveWatchdogHome('/tmp/elsewhere', io);
    expect('error' in got && got.error).toContain('is outside the tribe root');
  });

  test('a home with no campaign-state.json is refused by name', () => {
    const got = resolveWatchdogHome('/var/t/home/.tribe/k/campaigns/other', io);
    expect('error' in got && got.error).toBe(
      'watchdog: --home "/private/var/t/home/.tribe/k/campaigns/other" has no ' +
        'campaign-state.json — a campaign home is authored by the orchestrate-campaign ' +
        'skill before any runner or watchdog is started',
    );
  });
});

// B2 (rules-gate fix): `main()`'s watchdog dispatch has no try/catch around `await
// runWatchdog(...)`, and `main()` is invoked with no `.catch()` — so a real I/O failure deep
// in the watchdog's edge (`ensureDir`, `appendFile`, `writeFileAtomic` all throw narrow-only,
// never swallow) escapes as an uncaught Bun stack trace instead of the typed
// `watchdog: unexpected error: ...` message the card-loop path already produces for the same
// class of failure (`cli/main.ts`'s `runLoop` try/catch). This is a real subprocess e2e test
// (CLAUDE.md: reproduce a bug the way an end user would experience it) because `main()` wires
// its own real adapters and is deliberately not unit-tested — forcing the failure any other
// way would require restructuring the composition root, which this fix brief forbids.
describe('watchdog subcommand: an I/O failure inside runWatchdog never escapes as a traceback', () => {
  test('a blocked `<home>/watchdog` mkdir produces a typed stderr line and a defined exit code, never a stack trace', () => {
    const homeDir = mkdtempSync(join(homedir(), '.tribe', 'i74-b2-repro-'));
    try {
      writeFileSync(join(homeDir, 'campaign-state.json'), '{}');
      // `ensureDir(paths.dir)` is the FIRST thing `runWatchdog` does (before any observation
      // or spawn) — planting a plain FILE at the directory's own path makes the real
      // `mkdirSync(..., { recursive: true })` throw EEXIST, a genuine I/O failure with no
      // stubbing.
      writeFileSync(join(homeDir, 'watchdog'), 'not a directory');

      const result = spawnSync(
        'bun',
        ['cli/main.ts', 'watchdog', '--repo', '/tmp', '--model', 'x', '--home', homeDir, '--once'],
        { cwd: import.meta.dir + '/..', encoding: 'utf8' },
      );

      const combined = `${result.stdout}${result.stderr}`;
      expect(combined).not.toContain('at ensureDir');
      expect(combined).not.toContain('.ts:');
      expect(combined).not.toContain('Bun v');
      expect(result.stderr).toContain('watchdog: unexpected error:');
      expect(result.status).toBe(WATCHDOG_EXIT_NEEDS_HUMAN);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  }, 20_000);
});

// C2 (group-C audit round 1, class `critical`): `resolveWatchdogHome`'s two `io.realpath(...)`
// calls run BEFORE the B2 try/catch above (they resolve `--home` itself), and the real
// `realpath` adapter only degrades `ENOENT` — every other real I/O failure (`ENOTDIR`,
// `EACCES`, `ELOOP`) still escaped as an uncaught Bun stack trace. This is a real subprocess
// e2e test (CLAUDE.md: reproduce the way an end user would experience it) for the same reason
// B2's is: `main()` wires its own real adapters and is not unit-tested.
describe('watchdog subcommand: a realpath failure resolving --home is a typed usage error, never a traceback (C2)', () => {
  test('a plain FILE where a directory component of --home must be produces a typed "watchdog:" stderr line and exit 1, never a stack trace', () => {
    const homeParent = mkdtempSync(join(homedir(), '.tribe', 'i74-c2-repro-'));
    try {
      // Plant a plain FILE where `--home` needs a directory COMPONENT (not the leaf itself —
      // ENOENT on the leaf is already handled) — `realpathSync` throws ENOTDIR, not ENOENT.
      const fileBlocker = join(homeParent, 'notadir');
      writeFileSync(fileBlocker, '');
      const badHome = join(fileBlocker, 'subdir');

      const result = spawnSync(
        'bun',
        ['cli/main.ts', 'watchdog', '--repo', '/tmp', '--model', 'x', '--home', badHome, '--once'],
        { cwd: import.meta.dir + '/..', encoding: 'utf8' },
      );

      const combined = `${result.stdout}${result.stderr}`;
      expect(combined).not.toContain('at realpath');
      expect(combined).not.toContain('.ts:');
      expect(combined).not.toContain('Bun v');
      expect(result.stderr).toContain('watchdog:');
      expect(result.status).toBe(1);
    } finally {
      rmSync(homeParent, { recursive: true, force: true });
    }
  }, 20_000);
});

// Task 27 (spec §10.2): `announceViewer` is `main()`'s extracted, testable print step — the
// root viewer line is printed once, before the first card's session, and `--no-viewer`/
// `--dry-run` each print neither of the two spec stdout lines. `main()` itself stays
// deliberately NOT unit-tested (this file's own top-of-file convention); this is the same
// extract-and-test shape as `scrubTargetEnvLocal`/`resolveWatchdogHome` above.
describe('announceViewer (Task 27, spec §10.2)', () => {
  const baseConfig = { dryRun: false, viewerDisabled: false, viewerPort: 4321, homeDir: '/th/-r/campaigns/s' };

  function fixtureOut() {
    return { log: mock((_line: string) => {}), error: mock((_line: string) => {}) };
  }

  test('a reuse/spawn decision prints the root line ONCE, before the first card, and returns its url', async () => {
    const decision: ViewerLaunchDecision = {
      kind: 'spawn',
      url: 'http://127.0.0.1:4321/?campaign=my-repo/my-slug',
      argv: ['bun', '/p/serve.ts', '--port', '4321'],
      note: null,
    };
    const launch = mock(async () => decision);
    const out = fixtureOut();

    const result = await announceViewer(baseConfig, launch, out);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(out.log).toHaveBeenCalledTimes(1);
    expect(out.log).toHaveBeenCalledWith('campaign viewer: http://127.0.0.1:4321/?campaign=my-repo/my-slug (read-only)');
    expect(out.error).not.toHaveBeenCalled();
    expect(result).toBe('http://127.0.0.1:4321/?campaign=my-repo/my-slug');
  });

  test('--dry-run prints neither line and never even calls launch (D11: zero side effects)', async () => {
    const launch = mock(async (): Promise<ViewerLaunchDecision> => {
      throw new Error('launch must never be called under --dry-run');
    });
    const out = fixtureOut();

    const result = await announceViewer({ ...baseConfig, dryRun: true }, launch, out);

    expect(launch).not.toHaveBeenCalled();
    expect(out.log).not.toHaveBeenCalled();
    expect(out.error).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  test('--no-viewer (a skip decision) prints no root line and returns null', async () => {
    const decision: ViewerLaunchDecision = { kind: 'skip', url: null, argv: null, note: 'skipped: --no-viewer' };
    const launch = mock(async () => decision);
    const out = fixtureOut();

    const result = await announceViewer({ ...baseConfig, viewerDisabled: true }, launch, out);

    expect(out.log).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // spec §10.4 outcome 3: a stale viewer prints the exact stderr line, no root line, and
  // returns null so card-actions.ts's onSessionStart never prints a session URL either.
  test('a stale decision prints exactly the spec stderr line, no root line, and returns null', async () => {
    const decision: ViewerLaunchDecision = {
      kind: 'stale',
      url: null,
      argv: null,
      note: 'stale viewer on port 4321, stop it or pass --viewer-port <n> (needs v2, got v1)',
    };
    const launch = mock(async () => decision);
    const out = fixtureOut();

    const result = await announceViewer(baseConfig, launch, out);

    expect(out.log).not.toHaveBeenCalled();
    expect(out.error).toHaveBeenCalledTimes(1);
    expect(out.error).toHaveBeenCalledWith('campaign viewer: stale viewer on port 4321, stop it or pass --viewer-port <n> (needs v2, got v1)');
    expect(result).toBeNull();
  });

  test('a thrown launch failure degrades to one stderr line and returns null (viewer failure never gates the run)', async () => {
    const launch = mock(async (): Promise<ViewerLaunchDecision> => {
      throw new Error('boom');
    });
    const out = fixtureOut();

    const result = await announceViewer(baseConfig, launch, out);

    expect(out.log).not.toHaveBeenCalled();
    expect(out.error).toHaveBeenCalledTimes(1);
    expect(String(out.error.mock.calls[0]?.[0])).toContain('campaign viewer: failed to start (continuing): boom');
    expect(result).toBeNull();
  });
});

function baseTranscriptConfig(overrides: Partial<TranscriptMetricsConfig> = {}): TranscriptMetricsConfig {
  return { sessions: [], project: null, json: true, cutBytes: null, verifyPath: null, ...overrides };
}

describe('runTranscriptMetrics — the transcript-metrics subcommand (Task 3, fail-closed)', () => {
  test('a session with no matching transcript is a typed refusal naming it, exit 1', async () => {
    const io: TranscriptIO = {
      readLines: () => [],
      readPrefix: () => ({ text: '', sha256: '', actualBytes: 0 }),
      fileExists: () => false,
      listProjectDirs: () => ['/nowhere/project-a'],
      projectsRoot: () => '/nowhere',
    };
    const { result, errors } = await captureConsole(() =>
      runTranscriptMetrics(baseTranscriptConfig({ sessions: ['no-such-session'] }), io),
    );
    expect(result).toBe(1);
    expect(errors.some((e) => e.includes('transcript-metrics') && e.includes('no-such-session'))).toBe(true);
  });

  test('a found session prints a cut-pinned entry and exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-transcript-'));
    try {
      const sessionId = 'sess-1';
      writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify({ type: 'assistant', message: { id: 'a' } })}\n`);
      const io: TranscriptIO = { ...buildTranscriptIo(), listProjectDirs: () => [dir] };

      const { result, logs } = await captureConsole(() =>
        runTranscriptMetrics(baseTranscriptConfig({ sessions: [sessionId] }), io),
      );

      expect(result).toBe(0);
      const output = JSON.parse(logs.join(''));
      expect(output.sessions).toHaveLength(1);
      expect(output.sessions[0].sessionId).toBe(sessionId);
      expect(output.sessions[0].cut.sha256).toHaveLength(64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--project filters which project directory is searched', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'cli-transcript-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'cli-transcript-b-'));
    try {
      const sessionId = 'sess-2';
      writeFileSync(join(dirB, `${sessionId}.jsonl`), `${JSON.stringify({ type: 'assistant', message: { id: 'a' } })}\n`);
      const io: TranscriptIO = { ...buildTranscriptIo(), listProjectDirs: () => [dirA, dirB] };

      const wrongProject = await captureConsole(() =>
        runTranscriptMetrics(baseTranscriptConfig({ sessions: [sessionId], project: basename(dirA) }), io),
      );
      expect(wrongProject.result).toBe(1);

      const rightProject = await captureConsole(() =>
        runTranscriptMetrics(baseTranscriptConfig({ sessions: [sessionId], project: basename(dirB) }), io),
      );
      expect(rightProject.result).toBe(0);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  test('--verify against a missing baseline file is a typed refusal, exit 1', async () => {
    const io: TranscriptIO = { ...buildTranscriptIo(), fileExists: () => false };
    const { result, errors } = await captureConsole(() =>
      runTranscriptMetrics(baseTranscriptConfig({ verifyPath: '/nope/baseline.json' }), io),
    );
    expect(result).toBe(1);
    expect(errors.some((e) => e.includes('transcript-metrics') && e.includes('/nope/baseline.json'))).toBe(true);
  });

  test('--verify against unparseable JSON is a typed refusal, exit 1, never a throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-transcript-verify-bad-'));
    try {
      const baselinePath = join(dir, 'baseline.json');
      writeFileSync(baselinePath, 'not json{');
      const io = buildTranscriptIo();

      const { result, errors } = await captureConsole(() =>
        runTranscriptMetrics(baseTranscriptConfig({ verifyPath: baselinePath }), io),
      );

      expect(result).toBe(1);
      expect(errors.some((e) => e.includes('transcript-metrics') && e.includes('not valid JSON'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Fix 4 (fail-closed-edges.md obligation 1): three DISTINCT typed messages for three
  // distinct failure classes — a raw fs read error must never be confused with a JSON parse
  // error, and neither with a structural validation error.
  test('--verify against a file that cannot be read (fs error) is a typed refusal, distinct from the JSON/validation messages', async () => {
    const io: TranscriptIO = {
      ...buildTranscriptIo(),
      fileExists: () => true,
      readLines: () => { throw new Error('EACCES: permission denied'); },
    };
    const { result, errors } = await captureConsole(() =>
      runTranscriptMetrics(baseTranscriptConfig({ verifyPath: '/some/baseline.json' }), io),
    );
    expect(result).toBe(1);
    expect(errors.some((e) => e.includes('transcript-metrics') && e.includes('could not be read'))).toBe(true);
    expect(errors.some((e) => e.includes('not valid JSON'))).toBe(false);
    expect(errors.some((e) => e.includes('is invalid'))).toBe(false);
  });

  test('--verify against structurally invalid (but syntactically valid) JSON is a typed refusal, distinct from the read/JSON-syntax messages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-transcript-verify-structural-'));
    try {
      const baselinePath = join(dir, 'baseline.json');
      writeFileSync(baselinePath, JSON.stringify({ v: 2, tool: 'transcript-metrics', generatedAt: 'x', sessions: [] }));
      const io = buildTranscriptIo();

      const { result, errors } = await captureConsole(() =>
        runTranscriptMetrics(baseTranscriptConfig({ verifyPath: baselinePath }), io),
      );

      expect(result).toBe(1);
      expect(errors.some((e) => e.includes('transcript-metrics') && e.includes('is invalid'))).toBe(true);
      expect(errors.some((e) => e.includes('not valid JSON'))).toBe(false);
      expect(errors.some((e) => e.includes('could not be read'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--verify re-measures every entry at its recorded cut and exits 0 only when all verify', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-transcript-verify-'));
    try {
      const transcriptPath = join(dir, 'sess-3.jsonl');
      writeFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { id: 'a' } })}\n`);
      const { cut, metrics } = measureAtCut(transcriptPath, null);
      metrics.sessionId = 'sess-3';
      const baseline = {
        v: 1,
        tool: 'transcript-metrics',
        generatedAt: new Date().toISOString(),
        sessions: [{ sessionId: 'sess-3', path: transcriptPath, cut, metrics }],
      };
      const baselinePath = join(dir, 'baseline.json');
      writeFileSync(baselinePath, JSON.stringify(baseline));
      const io = buildTranscriptIo();

      const { result, logs } = await captureConsole(() =>
        runTranscriptMetrics(baseTranscriptConfig({ verifyPath: baselinePath }), io),
      );

      expect(result).toBe(0);
      expect(JSON.parse(logs.join(''))).toEqual([{ sessionId: 'sess-3', status: 'verified' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** A structurally-valid baseline whose every entry points at a transcript that was never
 * created — each re-measures to `absent`, so the emitted JSON result array is large (one
 * entry's worth of message text per session) without needing a real, large transcript file. */
function bogusAbsentBaseline(dir: string, count: number) {
  const sessions = Array.from({ length: count }, (_, i) => ({
    sessionId: `s${i}`,
    path: join(dir, `never-created-${i}.jsonl`),
    cut: { lines: 1, bytes: 1, sha256: '0'.repeat(64) },
    metrics: {},
  }));
  return { v: 1, tool: 'transcript-metrics', generatedAt: 'x', sessions };
}

// Fix 6: `main()`'s transcript-metrics branch used to call `process.exit(exitCode)`
// immediately after `console.log(...)`, which can truncate a large payload written to a pipe
// (Node/Bun stdout writes to a PIPE are asynchronous; `process.exit()` does not wait for them
// to flush). This is a real subprocess e2e test (CLAUDE.md: reproduce the way an end user
// experiences it, over `bun run.ts ... | consumer`) because `main()` wires its own real
// process.exit and is deliberately not unit-tested (this file's own top-of-file convention).
describe('transcript-metrics subcommand: piped stdout is never truncated (Fix 6)', () => {
  test('a >64KiB --verify JSON result array is captured in full through a pipe, with no entry lost', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-transcript-drain-'));
    try {
      const baselinePath = join(dir, 'baseline.json');
      const ENTRY_COUNT = 900;
      writeFileSync(baselinePath, JSON.stringify(bogusAbsentBaseline(dir, ENTRY_COUNT)));

      const result = spawnSync(
        'bun',
        ['run.ts', 'transcript-metrics', '--verify', baselinePath],
        { cwd: import.meta.dir + '/..', encoding: 'utf8', timeout: 600000, maxBuffer: 10 * 1024 * 1024 },
      );

      expect(result.stdout.length).toBeGreaterThan(64 * 1024); // the truncation this guards against
      const parsed = JSON.parse(result.stdout); // truncated JSON would fail to parse at all
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(ENTRY_COUNT); // every entry present, none lost to truncation
      expect(parsed.every((r: { status: string }) => r.status === 'absent')).toBe(true);
      expect(result.status).toBe(1); // absent is a verify failure
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

// Fix 13 (fixtures-mirror-reality.md: the shape a person actually types — cd somewhere, name
// the file bare). Paired with the absolute-path shape so both are exercised, matching that
// rule's own golden pattern.
describe('transcript-metrics subcommand: --verify accepts BOTH a relative and an absolute path (Fix 13)', () => {
  test('a bare relative filename resolves against the process cwd (not a "file not found")', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-transcript-relative-'));
    try {
      const transcriptPath = join(dir, 'sess-rel.jsonl');
      writeFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { id: 'a' } })}\n`);
      const { cut, metrics } = measureAtCut(transcriptPath, null);
      metrics.sessionId = 'sess-rel';
      const baseline = {
        v: 1, tool: 'transcript-metrics', generatedAt: 'x',
        sessions: [{ sessionId: 'sess-rel', path: transcriptPath, cut, metrics }],
      };
      const relativeName = 'baseline-rel.json';
      writeFileSync(join(dir, relativeName), JSON.stringify(baseline));
      const runnerEntry = join(import.meta.dir, '..', 'run.ts');

      // The shape a person types: relative to their own cwd, not the runner's.
      const relResult = spawnSync('bun', [runnerEntry, 'transcript-metrics', '--verify', relativeName],
        { cwd: dir, encoding: 'utf8', timeout: 600000 });
      expect(relResult.status).toBe(0);
      expect(JSON.parse(relResult.stdout)).toEqual([{ sessionId: 'sess-rel', status: 'verified' }]);

      // Paired absolute-path run — both shapes reach the same result.
      const absResult = spawnSync('bun', [runnerEntry, 'transcript-metrics', '--verify', join(dir, relativeName)],
        { cwd: dir, encoding: 'utf8', timeout: 600000 });
      expect(absResult.status).toBe(0);
      expect(JSON.parse(absResult.stdout)).toEqual([{ sessionId: 'sess-rel', status: 'verified' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

// Blocker fix (fail-closed-edges.md obligation 1): a baseline entry with `metrics` deleted
// (path/cut/sha still valid) used to sail past validateBaselineFile, then reach
// firstMismatchedMetricField(remeasured, recorded) where `recorded` is `undefined`, and
// `recorded[field]` threw an uncaught TypeError that escaped main() as a stack trace. Real
// subprocess e2e (CLAUDE.md: reproduce the way an end user experiences it) because this is
// exactly the way a user would see the crash — through `bun run.ts ...`, not a unit call.
describe('transcript-metrics subcommand: a --verify entry with metrics deleted is fail-closed, not a stack trace', () => {
  test('one typed line, non-zero exit, no TypeError/stack trace in stdout or stderr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-transcript-no-metrics-'));
    try {
      const transcriptPath = join(dir, 'sess-nometrics.jsonl');
      writeFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { id: 'a' } })}\n`);
      const { cut } = measureAtCut(transcriptPath, null);
      const baseline = {
        v: 1, tool: 'transcript-metrics', generatedAt: 'x',
        sessions: [{ sessionId: 'sess-nometrics', path: transcriptPath, cut }], // metrics deleted
      };
      const baselinePath = join(dir, 'baseline.json');
      writeFileSync(baselinePath, JSON.stringify(baseline));
      const runnerEntry = join(import.meta.dir, '..', 'run.ts');

      const result = spawnSync('bun', [runnerEntry, 'transcript-metrics', '--verify', baselinePath],
        { cwd: dir, encoding: 'utf8', timeout: 600000 });

      const stackFramePattern = /\n\s+at /; // Node/Bun stack trace frame, e.g. "\n    at foo (bar.ts:1:1)"
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('TypeError');
      expect(result.stdout).not.toMatch(stackFramePattern);
      expect(result.stderr).not.toContain('TypeError');
      expect(result.stderr).not.toMatch(stackFramePattern);
      expect(result.stderr.includes('metrics')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
