// Run record (spec §4): one run.json per runner invocation under <home>/runs/<run-id>/.
// Pure module — no fs/clock imports; the caller injects pid/now and performs the writes
// through the RunHomePort seam (ports/ports.ts).
import { join } from 'node:path';
import { answersPathOf, campaignStatePathOf, escalationsDirOf } from './paths.ts';

export interface RunRecord {
  v: 1;
  runId: string;
  pid: number;
  startedAt: string;
  repo: string;
  /** Absolute — resolved against the campaign home (`--home`) so the viewer never guesses a
   * path (spec §4). Field names/absoluteness are unchanged from before the campaign-home
   * migration; only the directory they resolve under moved from the target repo to `--home`. */
  statePath: string;
  answersPath: string;
  escalationsDir: string;
  /** Exactly as configured (already absolute under the default; see cli/main.ts). */
  logsDir: string;
  argv: string[];
  endedAt: string | null;
  exitCode: number | null;
  reason: string | null;
}

/** Filesystem-safe run id: ISO timestamp with `:`/`.` mapped to `-`, plus a random hex
 * suffix (collision guard at human trigger rates). The caller supplies both parts — this
 * stays pure and deterministic under test. */
export function generateRunId(nowIso: string, randomHex: string): string {
  return `${nowIso.replace(/[:.]/g, '-')}-${randomHex}`;
}

export function runDirOf(homeDir: string, runId: string): string {
  return join(homeDir, 'runs', runId);
}

export function runRecordPathOf(homeDir: string, runId: string): string {
  return join(runDirOf(homeDir, runId), 'run.json');
}

/** `<home>/runs/<runId>/done.jsonl` — one row per Done command the runner ran (spec §4.5). */
export function doneRecordPathOf(homeDir: string, runId: string): string {
  return join(runDirOf(homeDir, runId), 'done.jsonl');
}

export function reportsDirOf(homeDir: string): string {
  return join(homeDir, 'reports');
}

export function buildRunRecord(
  config: {
    homeDir: string; runId: string; argv: string[]; repoRoot: string; logsDir: string;
  },
  io: { currentPid(): number; now(): string },
): RunRecord {
  return {
    v: 1,
    runId: config.runId,
    pid: io.currentPid(),
    startedAt: io.now(),
    repo: config.repoRoot,
    statePath: campaignStatePathOf(config.homeDir),
    answersPath: answersPathOf(config.homeDir),
    escalationsDir: escalationsDirOf(config.homeDir),
    logsDir: config.logsDir,
    argv: config.argv,
    endedAt: null,
    exitCode: null,
    reason: null,
  };
}

export function finalizeRunRecord(
  record: RunRecord,
  end: { endedAt: string; exitCode: number; reason: string },
): RunRecord {
  return { ...record, endedAt: end.endedAt, exitCode: end.exitCode, reason: end.reason };
}

export function serializeRunRecord(record: RunRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
