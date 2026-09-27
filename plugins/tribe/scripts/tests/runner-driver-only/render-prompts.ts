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
import { MAX_STEP_ATTEMPTS } from '../../runner/core/done.ts';
import {
  deliverTurnPrompt, doneFailedTurnPrompt, protocolErrorTurnPrompt, taskTurnPrompt,
} from '../../runner/core/turn-prompts.ts';
import { buildStateDigest } from '../../runner/core/loop/phase.ts';
import {
  buildEscalationMarkdown, toBriefCard, toBriefState,
} from '../../runner/core/loop/card-actions.ts';
import {
  BACKGROUNDING_DENIED_REASON, SCAN_DENIED_REASON, WAIT_TOOL_DENIED_REASON,
  buildSessionOptions,
} from '../../runner/core/session.ts';
import {
  MERGE_GATE_DENIED_CHECKS_ERROR_REASON, MERGE_GATE_DENIED_FORBIDDEN_FLAG_REASON, MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON,
  mergeGateNotGreenReason,
} from '../../runner/core/merge-gate.ts';
import { renderReportMarkdown, type CampaignReport } from '../../runner/core/report.ts';
import {
  CLOSING_TEMPLATE_PATH, RATIFY_TEMPLATE_PATH, RULING_TEMPLATE_PATH, renderBrief,
} from '../../runner/core/supervisor/brief.ts';
import { decideClosingGrantHook, decideContainmentHook } from '../../runner/core/supervisor/permit.ts';
import { PARK_SENTENCES, renderNeedsOwner } from '../../runner/core/supervisor/status.ts';
import type { CampaignState, Card, ResolvedConfig, ResolvedTask } from '../../runner/core/types.ts';
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
const REPO_ROOT = '/Users/owner/repo/runner-e2e-go';
const BRANCH = 'feat/small-helpers';

/** The fixture plan's Done section for one task — every task runs the same three module-wide
 * commands, then its own test by name (hieplam/runner-e2e-go, docs/plans/2026-09-27-small-helpers.md). */
function doneCommandsFor(test: string, pkg: string): string[] {
  return ['go build ./...', 'go vet ./...', 'go test ./...',
    `go test -run '^${test}$' -v ./${pkg} | grep -q -- '--- PASS: ${test}'`];
}

/** The fixture plan's four tasks, resolved the way `plan-index.ts` resolves them at load. */
const TASKS: ResolvedTask[] = [
  { id: FIXTURE.firstTaskId, heading: FIXTURE.firstTaskHeading, doneCommands: doneCommandsFor('TestSum', 'mathx') },
  { id: FIXTURE.secondTaskId, heading: FIXTURE.secondTaskHeading, doneCommands: doneCommandsFor('TestMax', 'mathx') },
  { id: 'T3', heading: 'Task 3: `textx.Reverse`', doneCommands: doneCommandsFor('TestReverse', 'textx') },
  { id: 'T4', heading: 'Task 4: `textx.IsPalindrome`', doneCommands: doneCommandsFor('TestIsPalindrome', 'textx') },
];

function card(): Card {
  return {
    status: 'running', spec: SPEC, plan: PLAN, branch: BRANCH, baseSha: '9bb6b22',
    pr: 12, mergeSha: null, sessionId: 'sess-1', updatedAt: null,
    tasks: TASKS.map((t) => ({ id: t.id, heading: t.heading })),
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
  const resolved = { homeDir: HOME, repoRoot: REPO_ROOT, baseBranch: 'master', remote: 'origin' } as ResolvedConfig;
  const driver = { repoRoot: resolved.repoRoot, baseBranch: resolved.baseBranch, remote: resolved.remote };
  const [t1, t2, , t4] = TASKS as [ResolvedTask, ResolvedTask, ResolvedTask, ResolvedTask];

  // ---- executor: the first turn is the brief plus the first task's turn prompt; a fresh session
  // after a failed resume carries the state digest (with the task progress) in the answers slot ----
  const firstTurn = taskTurnPrompt({ task: t1, planPath: PLAN });
  add('executor/brief-fresh', `${executorBrief(toBriefCard(CARD_ID, c), toBriefState(s), '', template,
    HOME, CAMPAIGN, driver)}\n\n${firstTurn}`);
  const digest = buildStateDigest(CARD_ID, c, 'no transcript found for the recorded session');
  add('executor/brief-with-digest', `${executorBrief(toBriefCard(CARD_ID, c), toBriefState(s),
    `${digest}\n\n---\n\n`, template, HOME, CAMPAIGN, driver)}\n\n${firstTurn}`);

  // ---- executor: every turn prompt after the first (the session is resumed with these) ----
  add('executor/turn-task', taskTurnPrompt({ task: t2, planPath: PLAN }));
  const failingIndex = t1.doneCommands.indexOf(FIXTURE.failingCommand);
  add('executor/turn-done-failed', doneFailedTurnPrompt({
    task: t1, branch: BRANCH, sha: 'abc1234',
    failed: { command: FIXTURE.failingCommand, exitCode: 1, timedOut: false, durationMs: 2300,
      stdoutTail: '--- FAIL: TestSum (0.00s)\n    sum_test.go:14: Sum(2, 3) = 6, want 5\nFAIL', stderrTail: '' },
    notRun: t1.doneCommands.slice(failingIndex + 1), attempt: 1, max: MAX_STEP_ATTEMPTS,
  }));
  add('executor/turn-protocol-error', protocolErrorTurnPrompt({
    reason: `the runner asked for task ${t1.id}; you reported ${t2.id}`, stepPrompt: firstTurn,
    attempt: 1, max: MAX_STEP_ATTEMPTS,
  }));
  add('executor/turn-deliver', deliverTurnPrompt({
    branch: BRANCH, sha: 'def5678', baseBranch: resolved.baseBranch, remote: resolved.remote,
    repoRoot: resolved.repoRoot, lastTaskId: t4.id,
  }));

  // ---- executor: every hook denial reason a session can read ----
  add('executor/hook-backgrounding', BACKGROUNDING_DENIED_REASON);
  add('executor/hook-wait-tool', WAIT_TOOL_DENIED_REASON);
  add('executor/hook-scan', SCAN_DENIED_REASON);
  add('executor/hook-merge-forbidden-flag', MERGE_GATE_DENIED_FORBIDDEN_FLAG_REASON);
  add('executor/hook-merge-checks-error', MERGE_GATE_DENIED_CHECKS_ERROR_REASON);
  add('executor/hook-merge-not-green', mergeGateNotGreenReason('12', ['go: PENDING']));
  add('executor/hook-merge-head-not-done', MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON('new1234', 'old5678'));

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
  add('escalation/done-failed', buildEscalationMarkdown(CARD_ID, 'done_failed',
    `task ${t1.id} (${FIXTURE.firstTaskHeading}) did not pass its Done commands after ${MAX_STEP_ATTEMPTS} attempts. Last: ${FIXTURE.failingCommand} exited 1`,
    resolved));

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
