// Task 19 (card `campaign-supervisor`, G3 — bounded context): replays the `viewer-consolidation`
// campaign's own escalation history (three rounds for one card, answered R16/R18/R22, plus one
// ruling left unratified when `runner_done` fires — the shape the real campaign hit at its own
// exit code 5, `rulings_unratified`) as a SYNTHESIZED fixture, and asserts the one-shot SESSION
// spawn count this drives is bounded at 5 — for a history whose real, measured session took 174
// turns (card G3, `## Measurable goals`; spec §21 D2 corrects the card's own "168" to 174 — the
// <= 5 spawn bound is unaffected).
//
// Drives the PURE loop (`runSupervisor`) through a scripted fake `SupervisorIO`, the same seam
// pattern `core/supervisor/loop.test.ts` already uses: no real fs, no real spawn, no real SDK —
// every fixture file is read once off the REAL committed fixture directory
// (`fixtures/supervisor/viewer-consolidation-replay/`, `fixtures-mirror-reality.md`) and served
// back through the fake seam's in-memory filesystem.
//
// PRIVACY WALL: every fixture file under `fixtures/supervisor/viewer-consolidation-replay/` is
// SYNTHESIZED text (see that directory's own README.md) — nothing here is, or was ever, copied
// from `~/.tribe/-Users-hip-repo-tribe/campaigns/viewer-consolidation/` (read-only source
// material, never touched by this test).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runSupervisor, type SupervisorLoopSeam, type SupervisorLoopConfig,
} from './loop.ts';
import { CLOSING_TEMPLATE_PATH, RATIFY_TEMPLATE_PATH, RULING_TEMPLATE_PATH } from './brief.ts';
import type { OneShotSessionOptions, OneShotSpawnParams } from './session.ts';
import type { SessionMessage } from '../session.ts';
import type { WatchdogHandle } from '../../ports/ports.ts';
import type { SupervisorLimits } from './model.ts';

const HOME = '/h/.tribe/k/campaigns/viewer-consolidation';
const REPO = '/repo';
const CARD_ID = 'viewer-consolidation';

const FIXTURE_DIR = join(import.meta.dir, '..', '..', 'fixtures', 'supervisor', 'viewer-consolidation-replay');

function fixture(...parts: string[]): string {
  return readFileSync(join(FIXTURE_DIR, ...parts), 'utf8');
}

// The REAL committed brief templates (Task 9), read off the actual filesystem once — same
// precedent as `loop.test.ts`'s own `REAL_TEMPLATES` (`fixtures-mirror-reality.md`): a fake seam
// serving its own stand-in template text would prove nothing about the real brief rendering.
const REAL_TEMPLATES: Record<string, string> = {
  [RULING_TEMPLATE_PATH]: readFileSync(RULING_TEMPLATE_PATH, 'utf8'),
  [RATIFY_TEMPLATE_PATH]: readFileSync(RATIFY_TEMPLATE_PATH, 'utf8'),
  [CLOSING_TEMPLATE_PATH]: readFileSync(CLOSING_TEMPLATE_PATH, 'utf8'),
};

// R16/R18/R22, in round order — the escalation history's own three ruling ids (card G3).
const ROUND_RULING_IDS = ['R16', 'R18', 'R22'];

function appendRulingBlock(id: string): (answers: string) => string {
  return (answers) => `${answers}\n## ${id} — synthesized ruling for round ${ROUND_RULING_IDS.indexOf(id) + 1}\n\nratified-as: operational\n\nSynthesized ruling body — never the real ruling's own text.\n`;
}

// Fixes ONLY the pre-existing `## R09 ...` block's `ratified-as:` line — every other block
// (R16/R18/R22) stays byte-identical, satisfying `verifyRatify`'s by-id fence.
function ratifyR09(answers: string): string {
  return answers.replace('ratified-as: pending', 'ratified-as: operational');
}

const LIMITS: SupervisorLimits = {
  maxRulingRounds: 3, maxRatifyRounds: 2, maxSpawns: 8, maxWatchdogRuns: 20, sessionRetries: 1,
};

function baseConfig(): SupervisorLoopConfig {
  return {
    repoRoot: REPO,
    model: 'claude-fixture',
    watchdogModel: null,
    campaign: CARD_ID,
    limits: LIMITS,
    sessionTimeoutSeconds: 1800,
    sessionMaxTurns: 60,
    pollSeconds: 30,
    watchdogCommand: ['bun', '/abs/run.ts'],
    rerunCommand: `bun run.ts supervise --repo /repo --campaign ${CARD_ID} --model claude-fixture`,
    // R11 (Task 20): available by default, same convention as `loop.test.ts`'s own `baseConfig`.
    verifyShippedPluginDir: '/abs/plugins/verify-shipped',
  };
}

interface ScriptedWatchdogRun {
  reason: string;
  exitCode: number;
  report: Record<string, unknown>;
  /** Applied at the SAME moment `report` lands (`waitFor()` resolving) — a real watchdog's own
   * child (the runner) is what produces a fresh escalation file between rounds, exactly this
   * moment (mirrors `loop.test.ts`'s own `report`-at-resolution-time comment). Keyed by path
   * relative to `HOME`. */
  escalationWrites?: Record<string, string>;
}

interface ScriptedSession {
  effect: (answers: string) => string;
  subtype?: 'success' | 'error';
}

interface SpawnLogEntry {
  kind: 'ruling' | 'ratify' | 'closing';
  resume: string | undefined;
}

function fakeSeam(opts: { watchdogRuns: ScriptedWatchdogRun[]; sessions: ScriptedSession[] }) {
  const files = new Map<string, string>([
    ...Object.entries(REAL_TEMPLATES),
    [join(HOME, 'escalations', `${CARD_ID}.md`), fixture('escalations', 'round-1-viewer-consolidation.md')],
    [join(HOME, 'answers.md'), fixture('answers.md')],
    [join(HOME, 'campaign-state.json'), fixture('campaign-state.json')],
  ]);
  const answersPath = join(HOME, 'answers.md');
  const watchdogStatusPath = join(HOME, 'watchdog', 'status.json');
  const campaignReportPath = join(HOME, 'campaign-report.json');
  const escalationPath = join(HOME, 'escalations', `${CARD_ID}.md`);
  const deadPids = new Set<number>();
  let nextPid = 5000;
  let nowMs = 1_800_000_000_000;
  const watchdogQueue = [...opts.watchdogRuns];
  const sessionQueue = [...opts.sessions];
  const spawnLog: SpawnLogEntry[] = [];
  let sessionCounter = 0;

  function kindOfPrompt(prompt: string): SpawnLogEntry['kind'] {
    if (prompt.startsWith('# Ruling Brief')) return 'ruling';
    if (prompt.startsWith('# Ratify Brief')) return 'ratify';
    return 'closing';
  }

  function listEntries(dirPath: string): Array<{ name: string; mtimeMs: number; isDir: boolean }> {
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const seen = new Map<string, boolean>();
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (!seen.has(name)) seen.set(name, slash !== -1);
    }
    return [...seen.entries()].map(([name, isDir]) => ({ name, mtimeMs: nowMs, isDir }));
  }

  const io: SupervisorLoopSeam = {
    now: () => new Date(nowMs).toISOString(),
    nowMs: () => nowMs,
    isProcessAlive: (pid) => !deadPids.has(pid),
    currentPid: () => 1,
    appendFile: (p, content) => {
      files.set(p, `${files.get(p) ?? ''}${content}`);
    },
    writeFileAtomic: (p, content) => {
      files.set(p, content);
    },
    readFileOrEmpty: (p) => files.get(p) ?? '',
    renameIfPresent: (from, to) => {
      if (!files.has(from)) return;
      files.set(to, files.get(from) as string);
      files.delete(from);
    },
    listEntries,
    spawnWatchdog: (_argv, _opts): WatchdogHandle => {
      const pid = nextPid++;
      return {
        pid,
        waitFor: async (_waitMs) => {
          const run = watchdogQueue.shift();
          if (run === undefined) throw new Error('fakeSeam: no scripted watchdog run left');
          files.set(watchdogStatusPath, JSON.stringify({
            pid, terminal: { status: 'terminal', reason: run.reason, exitCode: run.exitCode },
          }));
          files.set(campaignReportPath, JSON.stringify(run.report));
          for (const [relPath, content] of Object.entries(run.escalationWrites ?? {})) {
            files.set(join(HOME, relPath), content);
          }
          deadPids.add(pid);
          return run.exitCode;
        },
      };
    },
    resolveTribeHome: async () => ({ ok: true, home: HOME }),
    gitStatusPorcelain: async () => '',
    realpath: (p) => p,
    spawnSession: (params: OneShotSpawnParams): AsyncIterable<SessionMessage> => {
      const options = params.options as OneShotSessionOptions & { resume?: string };
      spawnLog.push({ kind: kindOfPrompt(params.prompt), resume: options.resume });
      async function* gen(): AsyncGenerator<SessionMessage> {
        const sessionId = `sess-${++sessionCounter}`;
        yield { type: 'system', subtype: 'init', session_id: sessionId };
        const script = sessionQueue.shift();
        if (script === undefined) throw new Error('fakeSeam: no scripted session left');
        files.set(answersPath, script.effect(files.get(answersPath) ?? ''));
        yield {
          type: 'result',
          subtype: script.subtype ?? 'success',
          session_id: sessionId,
          result: 'done',
          usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 },
          total_cost_usd: 0.01,
          permission_denials: [],
        };
      }
      return gen();
    },
    onSessionStart: () => {},
    appendLog: (p, line) => {
      files.set(p, `${files.get(p) ?? ''}${line}\n`);
    },
  };

  return { io, files, spawnLog };
}

function reportEscalated(): Record<string, unknown> {
  return {
    run: { reason: 'escalations_pending', unratifiedRulings: [] },
    cards: { [CARD_ID]: { outcome: 'escalated', escalationFile: `escalations/${CARD_ID}.md`, question: null, autoAnswerRounds: 0 } },
    pending: [],
    stats: { shipped: 0, escalated: 1, blocked: 0, notReached: 0 },
  };
}

function reportShipped(): Record<string, unknown> {
  return {
    run: { reason: 'runner_done', unratifiedRulings: [] },
    cards: { [CARD_ID]: { outcome: 'shipped', pr: 144, mergeSha: 'deadbeef' } },
    pending: [],
    stats: { shipped: 1, escalated: 0, blocked: 0, notReached: 0 },
  };
}

describe('replay: the viewer-consolidation escalation history bounds spawns at 5 (G3, task 19)', () => {
  test('ruling, ruling, ruling, ratify, closing — <= 5 spawns, no resume, every ledger entry usage-typed', async () => {
    const seam = fakeSeam({
      watchdogRuns: [
        { reason: 'escalations_pending', exitCode: 12, report: reportEscalated() }, // round 1 (R16)
        {
          reason: 'escalations_pending', exitCode: 12, report: reportEscalated(),
          escalationWrites: { [`escalations/${CARD_ID}.md`]: fixture('escalations', 'round-2-viewer-consolidation.md') },
        }, // round 2 (R18)
        {
          reason: 'escalations_pending', exitCode: 12, report: reportEscalated(),
          escalationWrites: { [`escalations/${CARD_ID}.md`]: fixture('escalations', 'round-3-viewer-consolidation.md') },
        }, // round 3 (R22)
        { reason: 'runner_done', exitCode: 0, report: reportShipped() }, // discovers R09 still unratified
        { reason: 'runner_done', exitCode: 0, report: reportShipped() }, // after ratify — closes
      ],
      sessions: [
        { effect: appendRulingBlock('R16') },
        { effect: appendRulingBlock('R18') },
        { effect: appendRulingBlock('R22') },
        { effect: ratifyR09 },
        { effect: (answers) => { seam.files.set(join(HOME, 'supervisor', 'final-report.md'), '# Final Report\n\nSynthesized closing report for the replay fixture.\n'); return answers; } },
      ],
    });

    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(result).toEqual({
      exitCode: 0, kind: 'done', reason: 'campaign_closed', statusPath: join(HOME, 'supervisor', 'status.json'),
    });

    const spawnLog = seam.spawnLog;
    // Deliberately untyped (`JSON.parse`'s own `any`, never cast to `LedgerEntry`): the oracle's
    // assertion (`l.usage.input_tokens`, no optional-chain) reads every ledger line exactly the
    // way a consumer with no compile-time knowledge of the schema would — proving the FIELD is
    // present at runtime, not merely typeable.
    const ledger = (seam.files.get(join(HOME, 'supervisor', 'ledger.jsonl')) ?? '')
      .trim().split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));

    expect(spawnLog.length).toBeLessThanOrEqual(5);
    expect(spawnLog.map((s) => s.kind)).toEqual(['ruling', 'ruling', 'ruling', 'ratify', 'closing']);
    expect(spawnLog.every((s) => s.resume === undefined)).toBe(true);
    expect(ledger.every((l) => typeof l.usage.input_tokens === 'number')).toBe(true);
  });
});
