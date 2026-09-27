// g2-prompts.ts — the V1 (card G2') measurement: count the Tribe way of working in every prompt the
// runner, watchdog and supervisor hand a session, and prove the driver essentials are still there.
//
// Input: a directory written by `render-prompts.ts` (manifest.json + one .txt per prompt kind).
// This file is the fixed measuring stick — it is identical for the BEFORE and the AFTER tree; only
// the renderer follows the runner's API.
//
// Two halves, because either alone passes an empty implementation:
//   1. NEGATIVE — Tribe-way mentions (tribe-lexicon.ts) summed over every rendered prompt, plus every
//      non-prose injection (a Tribe plugin loaded into the session). Target: 0.
//   2. POSITIVE — every kind in REQUIRED_AFTER_KINDS is rendered, and each carries its essentials
//      (card id, plan path, the task and its Done contract, terminal lines, liveness walls). Deleting
//      the briefs would zero half 1 and fail half 2.
//
// Usage: bun g2-prompts.ts --render-dir <dir> [--json] [--gate] [--negative-only]
//   default: print the measurement, exit 0 (a BEFORE measurement is not a failure).
//   --gate:  exit 1 unless mentions == 0, injections == 0, every required kind present, every
//            essential present. Exit 2 on a usage or input error.
//   --negative-only: skip the positive half (for transcript-prompts.ts output: real transcripts
//            carry no kind names, so only the mention count applies).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countTribeMentions, totalOf, type TermCount } from './tribe-lexicon.ts';
import { FIXTURE } from './fixture-values.ts';

/** The AFTER prompt inventory (spec §6.1). A kind missing from the manifest fails the gate — that is
 * what stops "delete the prompt" from reading as 0. */
export const REQUIRED_AFTER_KINDS: Record<string, readonly string[]> = {
  'executor/brief-fresh': [
    FIXTURE.cardId, FIXTURE.plan, FIXTURE.firstTaskId, FIXTURE.firstTaskHeading, 'Done',
    'TASK_DONE', 'SHIPPED', 'NEEDS_DIRECTION', 'run_in_background', 'timeout: 600000',
    'gh pr checks', `Campaign: ${FIXTURE.campaign}`,
  ],
  'executor/brief-with-digest': [FIXTURE.cardId, FIXTURE.plan, 'TASK_DONE', 'SHIPPED', FIXTURE.firstTaskId],
  'executor/turn-task': [FIXTURE.secondTaskId, FIXTURE.secondTaskHeading, 'TASK_DONE'],
  'executor/turn-done-failed': [FIXTURE.firstTaskId, FIXTURE.failingCommand, 'exit', 'TASK_DONE'],
  'executor/turn-protocol-error': ['TASK_DONE'],
  'executor/turn-deliver': ['SHIPPED', 'gh pr merge --merge', 'gh pr checks'],
  'executor/hook-backgrounding': ['run_in_background'],
  'executor/hook-wait-tool': ['gh pr checks'],
  'executor/hook-scan': ['c3'],
  'executor/hook-merge-forbidden-flag': ['gh pr merge --merge'],
  'executor/hook-merge-checks-error': ['gh pr checks'],
  'executor/hook-merge-not-green': ['gh pr checks'],
  'executor/hook-merge-head-not-done': ['TASK_DONE'],
  'escalation/needs-direction': [FIXTURE.cardId],
  'escalation/planning-needed': [FIXTURE.cardId],
  'escalation/verify-failed-merged': [FIXTURE.cardId, 'merged'],
  'escalation/verify-failed-after-merge': [FIXTURE.cardId],
  'escalation/done-failed': [FIXTURE.cardId, FIXTURE.firstTaskId, FIXTURE.failingCommand],
  'supervisor/ruling': [FIXTURE.cardId, 'answers.md'],
  'supervisor/closing': ['final-report.md', 'verdicts'],
  'report/campaign-report-md': [FIXTURE.campaign],
};

interface Manifest {
  renderer: string;
  files: Array<{ kind: string; file: string; bytes: number }>;
  injections: Array<{ kind: string; detail: string }>;
}

interface KindResult {
  kind: string;
  bytes: number;
  mentions: TermCount[];
  total: number;
  missingEssentials: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

function fail(message: string): never {
  console.error(`g2-prompts: ${message}`);
  process.exit(2);
}

function readManifest(dir: string): Manifest {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) fail(`no manifest.json in ${dir} (run render-prompts.ts --out ${dir} first)`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch (err) {
    fail(`manifest.json is not valid JSON: ${(err as Error).message}`);
  }
}

function main(): void {
  const dir = arg('--render-dir');
  if (dir === undefined) fail('usage: bun g2-prompts.ts --render-dir <dir> [--json] [--gate]');
  const manifest = readManifest(dir);

  const kinds: KindResult[] = manifest.files.map((f) => {
    const text = readFileSync(join(dir, f.file), 'utf8');
    const mentions = countTribeMentions(text);
    const essentials = process.argv.includes('--negative-only') ? [] : REQUIRED_AFTER_KINDS[f.kind] ?? [];
    return {
      kind: f.kind,
      bytes: f.bytes,
      mentions,
      total: totalOf(mentions),
      missingEssentials: essentials.filter((e) => !text.includes(e)),
    };
  });
  const present = new Set(kinds.map((k) => k.kind));
  const negativeOnly = process.argv.includes('--negative-only');
  const missingKinds = negativeOnly ? [] : Object.keys(REQUIRED_AFTER_KINDS).filter((k) => !present.has(k));
  const mentionTotal = kinds.reduce((sum, k) => sum + k.total, 0);
  const injectionTotal = manifest.injections.length;
  const essentialGaps = kinds.filter((k) => k.missingEssentials.length > 0);
  const byTerm: Record<string, number> = {};
  for (const k of kinds) for (const m of k.mentions) byTerm[m.id] = (byTerm[m.id] ?? 0) + m.count;

  const result = {
    renderer: manifest.renderer,
    promptKinds: kinds.length,
    mentionTotal,
    injectionTotal,
    tribeWayTotal: mentionTotal + injectionTotal,
    kindsWithMentions: kinds.filter((k) => k.total > 0).length,
    byTerm,
    injections: manifest.injections,
    missingKinds,
    essentialGaps: essentialGaps.map((k) => ({ kind: k.kind, missing: k.missingEssentials })),
    kinds,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`renderer: ${result.renderer}`);
    console.log(`prompt kinds rendered: ${result.promptKinds}`);
    console.log(`Tribe-way mentions: ${mentionTotal} in ${result.kindsWithMentions} kind(s); injections: ${injectionTotal}`);
    console.log(`TRIBE_WAY_TOTAL=${result.tribeWayTotal}`);
    console.log('| kind | bytes | mentions | terms |');
    console.log('| --- | --- | --- | --- |');
    for (const k of kinds) {
      console.log(`| ${k.kind} | ${k.bytes} | ${k.total} | ${k.mentions.map((m) => `${m.id}×${m.count}`).join(', ')} |`);
    }
    for (const inj of manifest.injections) console.log(`injection: ${inj.kind} — ${inj.detail}`);
    console.log(`MISSING_REQUIRED_KINDS=${missingKinds.length} ${missingKinds.join(',')}`);
    for (const g of essentialGaps) console.log(`ESSENTIALS_MISSING ${g.kind}: ${g.missingEssentials.join(' | ')}`);
  }

  if (process.argv.includes('--gate')) {
    const ok = result.tribeWayTotal === 0 && missingKinds.length === 0 && essentialGaps.length === 0;
    console.log(ok ? 'G2_GATE=PASS' : 'G2_GATE=FAIL');
    process.exit(ok ? 0 : 1);
  }
}

main();
