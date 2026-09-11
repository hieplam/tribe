// Tests for brief.ts (Task 5a): executor brief rendering from the committed template,
// including the embedded --answers file content (spec §D5). Fixtures are deliberately
// neutral (no repo names, no campaign-specific values) — the stateless-capability wall.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BRIEF_TEMPLATE_PATH, executorBrief, reportPathFor } from './brief.ts';
import type { BriefCard, BriefState } from './brief.ts';

const TEMPLATE = readFileSync(BRIEF_TEMPLATE_PATH, 'utf8');

function fixtureCard(overrides: Partial<BriefCard> = {}): BriefCard {
  return {
    id: 'C7',
    spec: 'docs/superpowers/specs/2026-01-01-c7-spec.md',
    plan: 'docs/superpowers/plans/2026-01-01-c7-plan.md',
    ...overrides,
  };
}

function fixtureState(overrides: Partial<BriefState> = {}): BriefState {
  return {
    campaign: 'sample-campaign',
    mergePolicy: 'merge',
    ownerOnlyEscalations: ['schema-lock-change', 'breaking-change'],
    ...overrides,
  };
}

const FIXTURE_ANSWERS = '## 2026-01-01 -- sample ruling\n\nUse the neutral fixture path for all future sessions.\n';

/** Matches `fixtureState().campaign` — the trailer instruction's slug is the same value the
 * heading already renders via {{CAMPAIGN}}, just carried through its own explicit param. */
const FIXTURE_CAMPAIGN_SLUG = 'sample-campaign';

/** Spec §5.3: the report path is injected by the caller (composed from `resolved.homeDir` via
 * `reportPathFor`, Task 2/3) — never derived here from the campaign name, and never
 * `.claude/state/...`. */
const FIXTURE_REPORT_PATH = '/th/campaigns/sample-campaign/reports/C7.md';

const EXPECTED_BRIEF = `# Executor Brief — card C7 (sample-campaign)

## Executor mode

You are dispatched as the Warchief for exactly one campaign card, running headless inside a
single fresh session with no memory of any other card. Read the spec below silently for
context — you do not re-open design decisions recorded there. Drive the committed plan
test-first, dispatch Hunters per task, audit with the Skinner, and land ONE green,
regular-merged PR on the target repo's master. You never contact the campaign owner
directly, never invent a design decision the plan doesn't already make, and never widen
scope beyond this card.

## Card

- Card: C7
- Spec (target repo, master): docs/superpowers/specs/2026-01-01-c7-spec.md
- Plan (target repo, master): docs/superpowers/plans/2026-01-01-c7-plan.md

## Goal

Ship C7 end-to-end: implement the plan at docs/superpowers/plans/2026-01-01-c7-plan.md against the spec at docs/superpowers/specs/2026-01-01-c7-spec.md, gates green, one regular-merged PR on the target repo's master.

## Walls (non-negotiable)

- Merge policy for this campaign is \`merge\`; land with \`gh pr merge --merge\`.
- The target repo's own CLAUDE.md and \`.claude/rules\` are binding; do not import
  conventions from elsewhere.
- Owner-only items for this campaign (escalate, never decide): schema-lock-change, breaking-change
- Stay inside this card's plan. No scope creep, no adjacent refactors, no speculative
  generality.
- Merge gate: every PR check must have CONCLUDED green BEFORE \`gh pr merge\` — pending is
  not green. A merge attempt with checks not green is blocked at the permission layer; if
  a check is red for reasons outside this card's diff, escalate NEEDS_DIRECTION instead of
  merging.
- After creating a worktree, run the repo's dependency bootstrap (e.g. \`bun install\`)
  before the first commit — repo hooks typically run repo-wide and fail spuriously in a
  worktree without dependencies.

## Session liveness (hard wall — this is what kills runs)

Your session ends the instant you stop calling tools. There is no human to wake you, and no
notification can reach you. A backgrounded job dies with you. Therefore:

- **Never** background anything, and **never** end a turn to wait for something.
- Every Bash call that runs tests/builds/e2e: pass \`timeout: 600000\` (10 min, the maximum)
  and never \`run_in_background\`. A 6-minute foreground e2e run is normal and correct.
- Every Agent/Task call: pass \`run_in_background: false\`. Sub-agents background by DEFAULT,
  which will kill you.
- If a command genuinely cannot fit in 600s, split it by exact spec/test file name and run
  each part in the foreground.
- To wait for CI: \`gh pr checks <pr> --watch\` in the foreground (timeout: 600000), re-run it
  if 10 minutes is not enough. Monitor/ScheduleWakeup are blocked — a notification can never
  wake you.

A tool call that tries to background is blocked at the permission layer and returns an
error — that block is this wall enforcing itself, not a bug to work around.

## Evidence policy

Every task is test-first: a failing test before the code, gates (formatter/linter/
type-checker/tests) green before commit, and a real commit carrying the code, its test, and
the plan's ticked checkboxes together. Claims of done are worthless without the gate output
that proves them — paste gate output verbatim into worker reports.

## Harness gaps and governance (per-card duties)

Your agent Method already carries these; they are walls here because campaigns
starve them silently:

- Dispatch the Tracker at every audit round (Method step 6.0b), and give every dispatch its
  own report-file path under the BASE tribe home's \`reports/\` directory that Method step 6.0b
  names — the one \`gap-gate.ts\` globs, NOT the campaign-nested \`reports/\` of ${FIXTURE_REPORT_PATH} above — named
  \`tracker-C7-<round>.md\` (\`<round>\` = \`task-3\`, \`wave-2\`, \`fix-1\`,
  \`final\`). You never read those files yourself.
- Before \`gh pr create\`, run \`gap-gate.ts\` from the plugin root (Method step 7). It reads
  every one of those Tracker report files, reconciles \`.tribe/harness-gaps.jsonl\`, and runs
  the debt burn-down. Its exit code is a gate: 0 green, 1 red (fix the listed hits and re-run),
  2 setup error (most often: no Tracker report for this card). Paste
  \`C7-gap-gate.md\` verbatim as the PR body's \`## Harness gaps\` section — including
  its \`gap-gate v1\` stamp line, which is what verify-shipped and the runner's D3 replay
  check — and commit the \`.tribe/harness-gaps.jsonl\` append with the trailer
  \`Tribe-Milestone: gap-gate\` BEFORE the PR opens. A merged PR with no valid stamp for its
  card is not shipped.
- \`debt-backfill.ts\` runs on EVERY PR, unconditionally.
- Scout's governance proposals ride THIS card's PR: rule/anti-rule drafts as reviewable
  text, a debt proposal as its recorded check command + description only — the debt
  entity itself is created later, by ratified \`gap-rule.ts\` execution, never here. Do
  not park the card waiting for ratification, do not
  self-ratify, and leave the registry's \`ruled\` events unwritten — the campaign's
  closing pass rules on the whole batch. Record each proposal and its proposed
  disposition in your worker report and under a \`## Harness gaps\` heading in the
  PR body; that record is what the closing pass reads.
- Only a gap needing an owner-only decision (see the owner-only list above)
  escalates NEEDS_DIRECTION.

## Merge order

Land the PR with \`gh pr merge --merge\`.

## Commit trailer (required on every commit)

Every commit you make for this card MUST end with this trailer line, after a blank
line, alongside any other trailers:

    Campaign: sample-campaign

This is the only in-repo record of which commits belong to this campaign — the
campaign's own state lives outside the repo. Recovery is
\`git log --grep="Campaign: sample-campaign"\`. Do NOT add an agent co-author line.

## Worker reports

Every dispatched worker (Hunter, Skinner) writes its report to:
${FIXTURE_REPORT_PATH}

## Answers (committed rulings — read before escalating)

Before raising any question, check whether it is already answered here. If it is, follow
the ruling; do not ask again.

These rulings are a snapshot taken when this session started. A resume never re-sends
this section — you keep this exact snapshot for the life of this session, resumed or
not. Only a brand-new session, never this one, can ever see a ruling added after you
started.

${FIXTURE_ANSWERS}

## Definition of Done (preconditions for SHIPPED)

"Merged" is not "done". You may print the \`SHIPPED\` line only after ALL of:

1. The PR is merged (behind the pre-merge check gate).
2. The remote feature branch is deleted (\`git push origin --delete <branch>\`).
3. The card's worktree is removed (\`git worktree remove <path>\`).
4. Local master is fast-forwarded to origin/master.

Verify each step with a command, not from memory — the runner independently re-verifies
all four and a missing one costs a full escalation round-trip.

*done = the next card starts clean on the latest changes.*

## Terminal contract

End your final message with EXACTLY one of:

- \`SHIPPED <pr> <sha>\` — the PR number and the merge commit sha, once verified merged.
- \`NEEDS_DIRECTION: <question>\` — a specific, answerable question, when you cannot proceed
  without a human ruling. Do not guess an answer to unblock yourself.

No other terminal line is a valid signal.
`;

describe('executorBrief', () => {
  test('renders the committed template with card/state substitutions and the embedded answers content (snapshot)', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(rendered).toBe(EXPECTED_BRIEF);
  });

  test('embeds the answers file content verbatim so a past ruling reaches every future session', () => {
    const distinctiveRuling = '## ruling\n\nAlways use the neutral fixture, never a real repo name.\n';
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      distinctiveRuling,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(rendered).toContain(distinctiveRuling);
  });

  test('warns that the embedded rulings are a spawn-time snapshot (P7 fix-list)', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(rendered).toContain(
      'These rulings are a snapshot taken when this session started.',
    );
  });

  test('states the merge command the executor lands with', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(rendered).toContain('gh pr merge --merge');
  });

  test('states the anti-livelock wall — the 2026-07-17 incident killed 6 workers without it', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(rendered).toContain('Your session ends the instant you stop calling tools');
    expect(rendered).toContain('timeout: 600000');
    expect(rendered).toContain('run_in_background: false');
  });

  test('states the Definition of Done preconditions for SHIPPED (P3: merged is not done)', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(rendered).toContain('## Definition of Done (preconditions for SHIPPED)');
    expect(rendered).toContain('"Merged" is not "done"');
    expect(rendered).toContain('The PR is merged (behind the pre-merge check gate).');
    expect(rendered).toContain('The remote feature branch is deleted (`git push origin --delete <branch>`).');
    expect(rendered).toContain("The card's worktree is removed (`git worktree remove <path>`).");
    expect(rendered).toContain('Local master is fast-forwarded to origin/master.');
    expect(rendered).toContain('done = the next card starts clean on the latest changes.');
    // The DoD section must land before the terminal contract, not after it.
    expect(rendered.indexOf('## Definition of Done')).toBeLessThan(rendered.indexOf('## Terminal contract'));
  });

  test('states the worktree dependency bootstrap wall (P15 remainder)', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(rendered).toContain('After creating a worktree, run the repo\'s dependency bootstrap');
  });

  test('renders a distinct brief per card id and per campaign (no hardcoded values)', () => {
    const otherReportPath = '/th/campaigns/other-campaign/reports/X9.md';
    const rendered = executorBrief(
      fixtureCard({ id: 'X9', spec: 'docs/superpowers/specs/x9.md', plan: 'docs/superpowers/plans/x9.md' }),
      fixtureState({ campaign: 'other-campaign', ownerOnlyEscalations: [] }),
      FIXTURE_ANSWERS,
      TEMPLATE,
      otherReportPath,
      'other-campaign',
    );
    expect(rendered).toContain('card X9 (other-campaign)');
    expect(rendered).toContain(otherReportPath);
    expect(rendered).toContain('(none declared for this campaign)');
  });

  test('reportPathFor composes <home>/reports/<cardId>.md — no .claude/state anywhere (spec §5.3)', () => {
    expect(reportPathFor('/th/campaigns/camp', 'C1')).toBe('/th/campaigns/camp/reports/C1.md');
  });

  test('executorBrief substitutes the injected report path into {{REPORT_PATH}}', () => {
    const brief = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      FIXTURE_CAMPAIGN_SLUG,
    );
    expect(brief).toContain(FIXTURE_REPORT_PATH);
    expect(brief).not.toContain('.claude/state');
  });
});

describe('executorBrief — campaign trailer', () => {
  test('instructs the executor to add a Campaign trailer with the real slug', () => {
    const brief = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      'kanna-session-import',
    );
    expect(brief).toContain('Campaign: kanna-session-import');
  });

  test('the slug is substituted, never left as a placeholder', () => {
    const brief = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_REPORT_PATH,
      'widget-export',
    );
    expect(brief).not.toContain('CAMPAIGN_SLUG');
    expect(brief).toContain('Campaign: widget-export');
  });
});
