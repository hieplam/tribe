// g3-verify-replay.ts — replays the runner's OWN done check (`core/verify.ts#verifyShipped`, the
// function the loop calls before it records a card `shipped`) against a real merged PR, and prints
// every point (card runner-driver-only, G1/G3'/V2).
//
// The same file measures BEFORE and AFTER: it imports whatever `verifyShipped` the checked-out tree
// has, so on master it replays the seven points (incl. gapGateStamped/ledgerCommitted) and on the
// built tree it replays the driver-only points. The card record comes from a real campaign-state
// file, never from flags, so the replay sees exactly what the loop would see.
//
// Usage: bun g3-verify-replay.ts --repo <target-repo> --home <campaign-home> --card <id> [--json]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyShipped, type VerifyIO } from '../../runner/core/verify.ts';
import type { CampaignState } from '../../runner/core/types.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v === undefined || v.startsWith('--') ? undefined : v;
}

/** Every subprocess is bounded (fail-closed-edges obligation 3) and never inherits host git config
 * that could change a verdict (obligation 2). */
async function exec(cmd: string[], options?: { cwd?: string }) {
  const proc = Bun.spawn(cmd, {
    cwd: options?.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const timer = setTimeout(() => proc.kill(), 120_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  clearTimeout(timer);
  return { stdout, stderr, exitCode };
}

async function main(): Promise<void> {
  const repo = arg('--repo');
  const home = arg('--home');
  const cardId = arg('--card');
  if (repo === undefined || home === undefined || cardId === undefined) {
    console.error('usage: bun g3-verify-replay.ts --repo <target-repo> --home <campaign-home> --card <id> [--json]');
    process.exit(2);
  }
  const statePath = join(home, 'campaign-state.json');
  if (!existsSync(statePath)) {
    console.error(`g3-verify-replay: no campaign-state.json under ${home}`);
    process.exit(2);
  }
  let state: CampaignState;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8')) as CampaignState;
  } catch (err) {
    console.error(`g3-verify-replay: campaign-state.json is not valid JSON: ${(err as Error).message}`);
    process.exit(2);
  }
  const card = state.cards[cardId];
  if (card === undefined) {
    console.error(`g3-verify-replay: no card ${cardId} in ${statePath}`);
    process.exit(2);
  }
  await exec(['git', 'fetch', 'origin'], { cwd: repo });
  const io: VerifyIO = {
    exec,
    fileExists: (p) => existsSync(p),
    readFile: (p) => readFileSync(p, 'utf8'),
  };
  const result = await verifyShipped(card, {
    repoRoot: repo, remote: 'origin', baseBranch: 'master',
    schemaLockPaths: state.schemaLockPaths ?? [], docsOnlyPaths: state.docsOnlyPaths ?? [],
  }, io, cardId);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const p of result.points) console.log(`${p.passed ? 'PASS' : 'FAIL'} ${p.id}: ${p.detail}`);
  console.log(`SHIPPED=${result.shipped} FAILED_POINTS=${result.failedPoints.join(',') || '(none)'}`);
}

await main();
