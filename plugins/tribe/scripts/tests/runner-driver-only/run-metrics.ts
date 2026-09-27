// run-metrics.ts — the V2/G6 measurement for one real campaign run (card runner-driver-only).
//
// Reads ONLY what the runner and the supervisor already write under a campaign home — the same
// files for the BEFORE and the AFTER run, so both are measured by one tool:
//   <home>/runs/<runId>/run.json            wall clock per runner invocation
//   <home>/runs/<runId>/logs/*.log          every SDK message of every executor session/turn
//   <home>/runs/<runId>/done.jsonl          the runner's Done-command rows (AFTER only; G4)
//   <home>/supervisor/sessions/*.log        every SDK message of every one-shot supervisor session
// and reports: Tribe agent dispatches (subagent_type in the six agents), mammoth-hunt /
// orchestrate-campaign Skill calls, every other dispatch by type, tokens, cost, and wall clock.
//
// Usage: bun run-metrics.ts --home <campaign-home> [--json]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TRIBE_AGENTS = ['warchief', 'hunter', 'skinner', 'tracker', 'scout', 'shaman'] as const;
export const TRIBE_SKILLS = ['mammoth-hunt', 'orchestrate-campaign'] as const;

/** A plugin-loaded agent or skill can arrive namespaced (`tribe:hunter`); compare the bare name. */
function bareName(name: string): string {
  const i = name.lastIndexOf(':');
  return (i >= 0 ? name.slice(i + 1) : name).toLowerCase();
}

interface Tokens { input: number; cacheWrite: number; cacheRead: number; output: number }

interface SessionLogMetrics {
  file: string;
  source: 'executor' | 'supervisor';
  sessionIds: string[];
  results: number;
  tokens: Tokens;
  costUsd: number;
  durationMs: number;
  dispatches: Record<string, number>;
  skills: Record<string, number>;
}

function emptyTokens(): Tokens {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function measureLog(file: string, source: SessionLogMetrics['source']): SessionLogMetrics {
  const m: SessionLogMetrics = {
    file, source, sessionIds: [], results: 0, tokens: emptyTokens(), costUsd: 0, durationMs: 0,
    dispatches: {}, skills: {},
  };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object') continue;
      msg = parsed as Record<string, unknown>;
    } catch {
      continue; // a torn last line from a killed session is skipped, never fatal
    }
    if (msg.type === 'system' && msg.subtype === 'init' && typeof msg.session_id === 'string') {
      if (!m.sessionIds.includes(msg.session_id)) m.sessionIds.push(msg.session_id);
    }
    if (msg.type === 'system' && msg.subtype === 'task_started' && msg.task_type === 'local_agent') {
      const type = typeof msg.subagent_type === 'string' ? msg.subagent_type : '(unnamed)';
      m.dispatches[type] = (m.dispatches[type] ?? 0) + 1;
    }
    if (msg.type === 'assistant') {
      const content = (msg.message as { content?: unknown } | undefined)?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type?: unknown; name?: unknown; input?: { skill?: unknown } };
          if (b.type === 'tool_use' && b.name === 'Skill' && typeof b.input?.skill === 'string') {
            m.skills[b.input.skill] = (m.skills[b.input.skill] ?? 0) + 1;
          }
        }
      }
    }
    if (msg.type === 'result') {
      m.results += 1;
      const usage = (msg.usage ?? {}) as Record<string, unknown>;
      m.tokens.input += num(usage.input_tokens);
      m.tokens.cacheWrite += num(usage.cache_creation_input_tokens);
      m.tokens.cacheRead += num(usage.cache_read_input_tokens);
      m.tokens.output += num(usage.output_tokens);
      m.costUsd += num(msg.total_cost_usd);
      m.durationMs += num(msg.duration_ms);
    }
  }
  return m;
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(suffix)).sort().map((f) => join(dir, f));
}

function main(): void {
  const i = process.argv.indexOf('--home');
  const home = i >= 0 ? process.argv[i + 1] : undefined;
  if (home === undefined || home.startsWith('--') || !existsSync(home)) {
    console.error('usage: bun run-metrics.ts --home <campaign-home> [--json]');
    process.exit(2);
  }

  const runsDir = join(home, 'runs');
  const runIds = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
  const runs = runIds.map((runId) => {
    const recordPath = join(runsDir, runId, 'run.json');
    let startedAt: string | null = null;
    let endedAt: string | null = null;
    let exitCode: number | null = null;
    let reason: string | null = null;
    if (existsSync(recordPath)) {
      try {
        const r = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
        startedAt = typeof r.startedAt === 'string' ? r.startedAt : null;
        endedAt = typeof r.endedAt === 'string' ? r.endedAt : null;
        exitCode = typeof r.exitCode === 'number' ? r.exitCode : null;
        reason = typeof r.reason === 'string' ? r.reason : null;
      } catch {
        // an unreadable run record contributes no wall clock
      }
    }
    const doneRows = listFiles(join(runsDir, runId), 'done.jsonl')
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== ''));
    return {
      runId, startedAt, endedAt, exitCode, reason,
      wallClockMs: startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null,
      doneRows: doneRows.length,
    };
  });

  const logs = [
    ...runIds.flatMap((runId) => listFiles(join(runsDir, runId, 'logs'), '.log')).map((f) => measureLog(f, 'executor')),
    ...listFiles(join(home, 'supervisor', 'sessions'), '.log').map((f) => measureLog(f, 'supervisor')),
  ];

  const dispatches: Record<string, number> = {};
  const skills: Record<string, number> = {};
  const tokens = emptyTokens();
  let costUsd = 0;
  let sessionMs = 0;
  for (const l of logs) {
    for (const [k, v] of Object.entries(l.dispatches)) dispatches[k] = (dispatches[k] ?? 0) + v;
    for (const [k, v] of Object.entries(l.skills)) skills[k] = (skills[k] ?? 0) + v;
    tokens.input += l.tokens.input;
    tokens.cacheWrite += l.tokens.cacheWrite;
    tokens.cacheRead += l.tokens.cacheRead;
    tokens.output += l.tokens.output;
    costUsd += l.costUsd;
    sessionMs += l.durationMs;
  }
  const tribeDispatches = Object.entries(dispatches)
    .filter(([type]) => (TRIBE_AGENTS as readonly string[]).includes(bareName(type)))
    .reduce((sum, [, n]) => sum + n, 0);
  const tribeSkillCalls = Object.entries(skills)
    .filter(([name]) => (TRIBE_SKILLS as readonly string[]).includes(bareName(name)))
    .reduce((sum, [, n]) => sum + n, 0);
  const starts = runs.map((r) => r.startedAt).filter((s): s is string => s !== null).map(Date.parse);
  const ends = runs.map((r) => r.endedAt).filter((s): s is string => s !== null).map(Date.parse);
  const spanMs = starts.length > 0 && ends.length > 0 ? Math.max(...ends) - Math.min(...starts) : null;

  const result = {
    home, runs, sessionLogs: logs.length, dispatches, skills, tribeDispatches, tribeSkillCalls,
    tokens, tokensTotal: tokens.input + tokens.cacheWrite + tokens.cacheRead + tokens.output,
    costUsd: Math.round(costUsd * 10000) / 10000, sessionMs, wallClockSpanMs: spanMs,
    doneRows: runs.reduce((sum, r) => sum + r.doneRows, 0), perLog: logs,
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`home: ${home}`);
  console.log(`runner invocations: ${runs.length}; session logs: ${logs.length}`);
  for (const r of runs) {
    console.log(`  run ${r.runId}: exit=${r.exitCode} reason=${r.reason} wall=${r.wallClockMs ?? '?'}ms doneRows=${r.doneRows}`);
  }
  console.log(`TRIBE_AGENT_DISPATCHES=${tribeDispatches}`);
  console.log(`TRIBE_SKILL_CALLS=${tribeSkillCalls}`);
  console.log(`dispatches by type: ${JSON.stringify(dispatches)}`);
  console.log(`skill calls: ${JSON.stringify(skills)}`);
  console.log(`tokens: ${JSON.stringify(tokens)} total=${result.tokensTotal}`);
  console.log(`cost_usd=${result.costUsd} session_ms=${sessionMs} wall_clock_span_ms=${spanMs ?? '?'}`);
  console.log(`DONE_ROWS=${result.doneRows}`);
}

main();
