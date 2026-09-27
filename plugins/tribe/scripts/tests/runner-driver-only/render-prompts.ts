// render-prompts.ts — renders every prompt the runner, the watchdog and the supervisor hand to a
// session, for the Go fixture campaign, into one directory (card runner-driver-only, G2'/V1).
//
// This is the INPUT side of the V1 measurement; `g2-prompts.ts` is the counter and never changes
// between BEFORE and AFTER. This file calls the runner's own rendering functions, so it follows the
// runner's API: this copy renders master @ 3194976 (the BEFORE tree). The build's plan updates it in
// the same commit that changes a rendering API, and its manifest must then carry every kind listed
// in `g2-prompts.ts`'s REQUIRED_AFTER_KINDS.
//
// Usage (from anywhere): bun render-prompts.ts --out <dir>
// Writes <dir>/<kind>.txt per prompt and <dir>/manifest.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BRIEF_TEMPLATE_PATH, executorBrief } from '../../runner/core/brief.ts';
import { buildStateDigest } from '../../runner/core/loop/phase.ts';
import {
  buildEscalationMarkdown, toBriefCard, toBriefState,
} from '../../runner/core/loop/card-actions.ts';
import {
  BACKGROUNDING_DENIED_REASON, SCAN_DENIED_REASON, WAIT_TOOL_DENIED_REASON,
  buildSessionOptions,
} from '../../runner/core/session.ts';
import {
  MERGE_GATE_DENIED_CHECKS_ERROR_REASON, MERGE_GATE_DENIED_FORBIDDEN_FLAG_REASON, mergeGateNotGreenReason,
} from '../../runner/core/merge-gate.ts';
import { renderReportMarkdown, type CampaignReport } from '../../runner/core/report.ts';
import {
  CLOSING_TEMPLATE_PATH, RATIFY_TEMPLATE_PATH, RULING_TEMPLATE_PATH, renderBrief,
} from '../../runner/core/supervisor/brief.ts';
import { decideClosingGrantHook, decideContainmentHook } from '../../runner/core/supervisor/permit.ts';
import { PARK_SENTENCES, renderNeedsOwner } from '../../runner/core/supervisor/status.ts';
import type { CampaignState, Card, ResolvedConfig } from '../../runner/core/types.ts';
import type { VerifyPointId } from '../../runner/core/verify.ts';
import type { ParkReason } from '../../runner/core/supervisor/model.ts';

import { FIXTURE } from './fixture-values.ts';

// ---- the Go fixture campaign (values only; nothing here is read from a live home) ----
const CARD_ID = FIXTURE.cardId;
const CAMPAIGN = FIXTURE.campaign;
const HOME = FIXTURE.home;
const SPEC = FIXTURE.spec;
const PLAN = FIXTURE.plan;
const ANSWERS_PATH = join(HOME, 'answers.md');

function card(): Card {
  return {
    status: 'running', spec: SPEC, plan: PLAN, branch: 'feat/small-helpers', baseSha: '9bb6b22',
    pr: 12, mergeSha: null, sessionId: 'sess-1', updatedAt: null,
    tasks: [{ id: 'T1', heading: 'Task 1' }],
  };
}

function state(): CampaignState {
  return {
    v: 2, campaign: CAMPAIGN, mergePolicy: 'regular', sequence: [CARD_ID],
    schemaLockPaths: [], docsOnlyPaths: [], ownerOnlyEscalations: [], cards: { [CARD_ID]: card() },
  };
}

function hookReason(decision: unknown): string {
  const out = (decision as { hookSpecificOutput?: { permissionDecisionReason?: string } }).hookSpecificOutput;
  return out?.permissionDecisionReason ?? '';
}

interface Rendered { kind: string; text: string }

function renderAll(): { prompts: Rendered[]; injections: Array<{ kind: string; detail: string }> } {
  const prompts: Rendered[] = [];
  const add = (kind: string, text: string) => prompts.push({ kind, text });
  const template = readFileSync(BRIEF_TEMPLATE_PATH, 'utf8');
  const s = state();
  const c = s.cards[CARD_ID] as Card;
  const resolved = { homeDir: HOME } as ResolvedConfig;

  // ---- executor: first prompt, digest prompt (a resumed turn is a turn prompt now) ----
  add('executor/brief-fresh', executorBrief(toBriefCard(CARD_ID, c), toBriefState(s), '', template,
    HOME, CAMPAIGN));
  const digest = buildStateDigest(CARD_ID, c, 'no transcript found for the recorded session');
  add('executor/brief-with-digest', executorBrief(toBriefCard(CARD_ID, c), toBriefState(s),
    `${digest}\n\n---\n\n`, template, HOME, CAMPAIGN));

  // ---- executor: every hook denial reason a session can read ----
  add('executor/hook-backgrounding', BACKGROUNDING_DENIED_REASON);
  add('executor/hook-wait-tool', WAIT_TOOL_DENIED_REASON);
  add('executor/hook-scan', SCAN_DENIED_REASON);
  add('executor/hook-merge-forbidden-flag', MERGE_GATE_DENIED_FORBIDDEN_FLAG_REASON);
  add('executor/hook-merge-checks-error', MERGE_GATE_DENIED_CHECKS_ERROR_REASON);
  add('executor/hook-merge-not-green', mergeGateNotGreenReason('12', ['go: PENDING']));

  // ---- escalation files (a ruling session reads them verbatim; so does the owner) ----
  const needsDirection = buildEscalationMarkdown(CARD_ID, 'needs_direction',
    'NEEDS_DIRECTION: should Max return an error or panic on an empty slice?', resolved);
  add('escalation/needs-direction', needsDirection);
  add('escalation/planning-needed', buildEscalationMarkdown(CARD_ID, 'planning_needed',
    'Missing on disk: plan', resolved));
  const allPoints: VerifyPointId[] = ['merged', 'mergeShaAncestorOfMaster', 'checksGreen',
    'worktreeAndBranchGone', 'schemaGuard'];
  add('escalation/verify-failed-merged', buildEscalationMarkdown(CARD_ID, 'verify_failed_twice',
    '- merged: PR #12 is not merged', resolved, allPoints));
  add('escalation/verify-failed-after-merge', buildEscalationMarkdown(CARD_ID, 'verify_failed_twice',
    '- worktreeAndBranchGone: worktree still present', resolved, allPoints.filter((p) => p !== 'merged')));

  // ---- supervisor: the three one-shot briefs ----
  add('supervisor/ruling', renderBrief('ruling', {
    kind: 'ruling', template: readFileSync(RULING_TEMPLATE_PATH, 'utf8'), cardId: CARD_ID,
    escalationContent: needsDirection, ownerOnlyEscalations: [], existingRulingIds: ['R1'],
    specPath: SPEC, planPath: PLAN, answersPath: ANSWERS_PATH,
    escalationPath: join(HOME, 'escalations', `${CARD_ID}.md`),
  }));
  add('supervisor/ratify', renderBrief('ratify', {
    kind: 'ratify', template: readFileSync(RATIFY_TEMPLATE_PATH, 'utf8'), unratifiedRulingIds: ['R1'],
    rulingBlocks: [{ id: 'R1', content: '## R1 — Max on empty\n\nReturn ErrEmpty.\n' }],
    answersPath: ANSWERS_PATH,
  }));
  const report: CampaignReport = {
    v: 1, campaign: CAMPAIGN,
    run: { startedAt: '2026-09-27T09:00:00.000Z', endedAt: '2026-09-27T09:30:00.000Z', exitCode: 0, reason: 'done' },
    cards: { [CARD_ID]: { outcome: 'shipped', pr: 12, mergeSha: 'abc1234' } }, pending: [],
    stats: { shipped: 1, escalated: 0, blocked: 0, notReached: 0 },
  };
  add('supervisor/closing', renderBrief('closing', {
    kind: 'closing', template: readFileSync(CLOSING_TEMPLATE_PATH, 'utf8'),
    campaignReportContent: JSON.stringify(report, null, 2),
    rulings: [{ id: 'R1', ratifiedAs: 'operational' }],
    openIdsByCard: [{ cardId: CARD_ID, openIds: [] }],
    finalReportPath: join(HOME, 'supervisor', 'final-report.md'),
    shippedVerdicts: [{ cardId: CARD_ID, verdictPath: join(HOME, 'supervisor', 'verdicts', `${CARD_ID}.json`) }],
  }));

  // ---- supervisor: hook denial reasons a one-shot session can read ----
  add('supervisor/hook-containment', hookReason(decideContainmentHook(HOME,
    { tool_name: 'Write', tool_input: { file_path: '/etc/outside-home.md' } })));
  add('supervisor/hook-not-granted', hookReason(decideContainmentHook(HOME,
    { tool_name: 'Bash', tool_input: { command: 'ls' } })));
  add('supervisor/hook-closing-grant', hookReason(decideClosingGrantHook(['Read'],
    { tool_name: 'Workflow', tool_input: {} })));

  // ---- supervisor: NEEDS_OWNER.md, one per park reason (the doorbell session reads it) ----
  for (const reason of Object.keys(PARK_SENTENCES) as ParkReason[]) {
    add(`supervisor/needs-owner/${reason}`, renderNeedsOwner({
      campaignSlug: CAMPAIGN, campaignHome: HOME, reason, atMs: Date.UTC(2026, 8, 27, 9), cardId: CARD_ID,
      question: null, rulingRoundsUsed: [], spawnsUsed: { used: 0, max: 8 }, rulingsLandedThisRun: [],
      watchdogRuns: 1, lastWatchdogTerminalReason: 'escalations_pending', ledgerLines: [],
      rerunCommand: `bun run.ts supervise --repo /repo --campaign ${CAMPAIGN} --model sonnet`,
    }));
  }

  // ---- the campaign report the orchestrating session reads (and the closing brief embeds) ----
  add('report/campaign-report-md', renderReportMarkdown({
    ...report, run: { ...report.run, exitCode: 5, reason: 'rulings_unratified', unratifiedRulings: ['R1'] },
  }));

  // ---- injections that are not prose: the executor's session options ----
  const options = buildSessionOptions({ brief: '' },
    { repoRoot: '/repo', model: 'sonnet', logsDir: '/logs', card: CARD_ID } as never,
    new AbortController(), {});
  const injections: Array<{ kind: string; detail: string }> = [];
  // The runner loads no plugin of its own (card D8): any `plugins` key reappearing is an injection.
  if ('plugins' in options) {
    injections.push({ kind: 'executor/session-options.plugins',
      detail: `loads a plugin of its own: ${JSON.stringify((options as { plugins: unknown }).plugins)}` });
  }
  return { prompts, injections };
}

function main(): void {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (out === undefined || out.startsWith('--')) {
    console.error('usage: bun render-prompts.ts --out <dir>');
    process.exit(2);
  }
  const { prompts, injections } = renderAll();
  const files: Array<{ kind: string; file: string; bytes: number }> = [];
  for (const p of prompts) {
    const file = `${p.kind}.txt`;
    const path = join(out, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, p.text);
    files.push({ kind: p.kind, file, bytes: Buffer.byteLength(p.text) });
  }
  const manifest = {
    renderer: 'render-prompts.ts @ master 3194976 API',
    watchdog: 'no session-facing prompt: the watchdog never spawns an LLM session (runner README, Watchdog, "What it never does")',
    files,
    injections,
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`rendered ${files.length} prompt(s), ${injections.length} injection(s) into ${out}`);
}

main();
