// Tests for brief.ts (Task 5a): executor brief rendering from the committed template,
// including the embedded --answers file content (spec §D5). Fixtures are deliberately
// neutral (no repo names, no campaign-specific values) — the stateless-capability wall.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BRIEF_TEMPLATE_PATH, executorBrief, reportPathFor } from './brief.ts';
import type { BriefCard, BriefDriver, BriefState } from './brief.ts';
import { countTribeMentions } from '../../tests/runner-driver-only/tribe-lexicon.ts';

const TEMPLATE = readFileSync(BRIEF_TEMPLATE_PATH, 'utf8');

function fixtureCard(overrides: Partial<BriefCard> = {}): BriefCard {
  return {
    id: 'C7',
    spec: 'docs/superpowers/specs/2026-01-01-c7-spec.md',
    plan: 'docs/superpowers/plans/2026-01-01-c7-plan.md',
    tasks: [{ id: 'T1', heading: 'Task 1: first' }, { id: 'T2', heading: 'Task 2: second' }],
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

/** Where the runner reads the plan and what the card lands on (spec §4.8). */
const FIXTURE_DRIVER: BriefDriver = { repoRoot: '/repo', baseBranch: 'master', remote: 'origin' };

const FIXTURE_ANSWERS = '## 2026-01-01 -- sample ruling\n\nUse the neutral fixture path for all future sessions.\n';

/** Matches `fixtureState().campaign` — the trailer instruction's slug is the same value the
 * heading already renders via {{CAMPAIGN}}, just carried through its own explicit param. */
const FIXTURE_CAMPAIGN_SLUG = 'sample-campaign';

/** Spec §5.3: the campaign home is injected by the caller (`resolved.homeDir`) — never derived
 * here from the campaign name, and never `.claude/state/...`. */
const FIXTURE_CAMPAIGN_HOME = '/th/campaigns/sample-campaign';

const EXPECTED_BRIEF = `# Executor Brief — card C7 (sample-campaign)

## Your job

You run exactly one campaign card, headless, in a fresh session with no memory of any other card.
The plan below is your instructions: follow the way of working it prescribes, task by task, and
add no process it does not ask for. Read the spec silently for context — you do not re-open
design decisions recorded there. You never contact the campaign owner directly, never invent a
design decision the plan doesn't already make, and never widen scope beyond this card.

## Card

- Card: C7
- Spec (target repo, master): docs/superpowers/specs/2026-01-01-c7-spec.md
- Plan (target repo, master): docs/superpowers/plans/2026-01-01-c7-plan.md

## Goal

Ship C7 end-to-end: implement the plan at docs/superpowers/plans/2026-01-01-c7-plan.md against the spec at docs/superpowers/specs/2026-01-01-c7-spec.md, gates green, one regular-merged PR on the target repo's master.

## How the runner drives you

The runner walks the plan's tasks in order, one turn per task:

- T1 — Task 1: first
- T2 — Task 2: second

- Each turn names ONE task (see \`## This turn\` at the end). Do that task the way the plan says,
  commit it on your card branch, and end your turn with exactly \`TASK_DONE <task-id> <branch>\`.
- The runner then runs that task's **Done** commands itself — together with the Done commands of
  every task before it — from a clean checkout of your branch tip. A task is done only when every
  one of those commands exits 0. You may run them yourself first; the runner's run is the one
  that counts.
- If a Done command fails, the next turn shows you the command, its exit code and its output. Fix
  it, commit, and end your turn with \`TASK_DONE\` again.
  After 3 unaccepted turns on one task the runner escalates the card.
- When every task is done, the runner sends one more turn: deliver the card (Definition of Done).
  Delivery has the same limit: every delivery turn that does not end with \`SHIPPED\` — a
  \`TASK_DONE\` re-check included — counts toward it.

## Walls (non-negotiable)

- Merge policy for this campaign is \`merge\`; land with \`gh pr merge --merge\`.
- The target repo's own CLAUDE.md and \`.claude/rules\` are binding; do not import
  conventions from elsewhere.
- Owner-only items for this campaign (escalate, never decide): schema-lock-change, breaking-change
- Stay inside this card's plan. No scope creep, no adjacent refactors, no speculative
  generality.
- Merge gate: every PR check must have CONCLUDED green BEFORE \`gh pr merge\` — pending is
  not green — and the PR head must be the commit whose Done commands the runner last passed;
  a merge attempt otherwise is blocked at the permission layer. If a check is red for reasons
  outside this card's diff, escalate NEEDS_DIRECTION instead of merging.
- Work on your own card branch in a separate git worktree;
  never switch the branch of, stage in, or commit in /repo itself — the runner reads the plan there.
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

## Merge order

Land the PR with \`gh pr merge --merge\`.

## Commit trailer (required on every commit)

Every commit you make for this card MUST end with this trailer line, after a blank
line, alongside any other trailers:

    Campaign: sample-campaign

This is the only in-repo record of which commits belong to this campaign — the
campaign's own state lives outside the repo. Recovery is
\`git log --grep="Campaign: sample-campaign"\`. Do NOT add an agent co-author line.

## Notes for your plan

If your plan asks you to write report or note files, the campaign's machine-local home is
${FIXTURE_CAMPAIGN_HOME}; its \`reports/\` directory is yours to use. The runner itself reads nothing you
write there.

## Answers (committed rulings — read before escalating)

Before raising any question, check whether it is already answered here. If it is, follow
the ruling; do not ask again.

These rulings are a snapshot taken when this session started. A resume never re-sends
this section — you keep this exact snapshot for the life of this session, resumed or
not. Only a brand-new session, never this one, can ever see a ruling added after you
started.

${FIXTURE_ANSWERS}

## Definition of Done (the deliver turn)

"Merged" is not "done". On the deliver turn, you may print the \`SHIPPED\` line only after ALL of:

1. Your card branch is pushed and its PR is open against master.
2. Every PR check has concluded green — wait in the foreground with \`gh pr checks <pr> --watch\`
   (timeout: 600000).
3. The PR is merged with \`gh pr merge --merge\` (behind the pre-merge check gate).
4. The remote feature branch is deleted (\`git push origin --delete <branch>\`) and the card's
   worktree is removed (\`git worktree remove <path>\`).
5. Local master in /repo is fast-forwarded to origin/master.

Verify each step with a command, not from memory — the runner independently re-verifies
them and a missing one costs a full escalation round-trip.

If you change any code during delivery, commit and push it, and end the turn with
\`TASK_DONE <last-task-id> <branch>\` so the runner re-runs the Done commands.

*done = the next card starts clean on the latest changes.*

## Terminal contract

End every turn with EXACTLY one of:

- \`TASK_DONE <task-id> <branch>\` — the named task is committed on \`<branch>\`.
- \`SHIPPED <pr> <sha>\` — the deliver turn only, after the merge: the PR number and the merge
  commit sha, once verified merged.
- \`NEEDS_DIRECTION: <question>\` — a specific, answerable question, when you cannot proceed
  without a human ruling. Do not guess an answer to unblock yourself.

No other terminal line is a valid signal.
`;

describe('executorBrief', () => {
  test('V1: the rendered executor brief carries no Tribe way of working', () => {
    const rendered = executorBrief(fixtureCard(), fixtureState(), '', readFileSync(BRIEF_TEMPLATE_PATH, 'utf8'), '/home/c', 'camp', FIXTURE_DRIVER);
    expect(countTribeMentions(rendered)).toEqual([]);
    for (const kept of ['## Session liveness', 'run_in_background', 'timeout: 600000', 'gh pr checks',
      'Campaign: camp', 'SHIPPED <pr> <sha>', 'NEEDS_DIRECTION: <question>', '## Answers']) {
      expect(rendered).toContain(kept);
    }
  });

  test('renders the committed template with card/state substitutions and the embedded answers content (snapshot)', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
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
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
    );
    expect(rendered).toContain(distinctiveRuling);
  });

  test('warns that the embedded rulings are a spawn-time snapshot (P7 fix-list)', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
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
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
    );
    expect(rendered).toContain('gh pr merge --merge');
  });

  test('states the anti-livelock wall — the 2026-07-17 incident killed 6 workers without it', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
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
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
    );
    // The DoD section is the deliver turn (spec §4.8); the four preconditions still land before
    // the terminal contract, not after it.
    expect(rendered).toContain('## Definition of Done (the deliver turn)');
    expect(rendered).toContain('"Merged" is not "done"');
    const terminal = rendered.indexOf('## Terminal contract');
    for (const precondition of [
      'The PR is merged with `gh pr merge --merge` (behind the pre-merge check gate).',
      'The remote feature branch is deleted (`git push origin --delete <branch>`)',
      "the card's\n   worktree is removed (`git worktree remove <path>`).",
      'Local master in /repo is fast-forwarded to origin/master.',
    ]) {
      expect(rendered).toContain(precondition);
      expect(rendered.indexOf(precondition)).toBeLessThan(terminal);
    }
    expect(rendered).toContain('done = the next card starts clean on the latest changes.');
  });

  test('states the worktree dependency bootstrap wall (P15 remainder)', () => {
    const rendered = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
    );
    expect(rendered).toContain('After creating a worktree, run the repo\'s dependency bootstrap');
  });

  test('renders a distinct brief per card id and per campaign (no hardcoded values)', () => {
    const otherCampaignHome = '/th/campaigns/other-campaign';
    const rendered = executorBrief(
      fixtureCard({ id: 'X9', spec: 'docs/superpowers/specs/x9.md', plan: 'docs/superpowers/plans/x9.md' }),
      fixtureState({ campaign: 'other-campaign', ownerOnlyEscalations: [] }),
      FIXTURE_ANSWERS,
      TEMPLATE,
      otherCampaignHome,
      'other-campaign',
      FIXTURE_DRIVER,
    );
    expect(rendered).toContain('card X9 (other-campaign)');
    expect(rendered).toContain(otherCampaignHome);
    expect(rendered).toContain('(none declared for this campaign)');
  });

  test('spec §4.8: the brief lists the tasks and states the turn rule, the runner-run Done, and three terminal lines', () => {
    const rendered = executorBrief(
      { id: 'C1', spec: 's.md', plan: 'p.md', tasks: [{ id: 'T1', heading: 'Task 1: a' }, { id: 'T2', heading: 'Task 2: b' }] },
      fixtureState(), '', readFileSync(BRIEF_TEMPLATE_PATH, 'utf8'), '/home/c', 'camp',
      { repoRoot: '/repo', baseBranch: 'master', remote: 'origin' },
    );
    for (const s of ['## How the runner drives you', '- T1 — Task 1: a', '- T2 — Task 2: b',
      'from a clean checkout of your branch tip', 'After 3 unaccepted turns on one task',
      '`TASK_DONE <task-id> <branch>`', '`SHIPPED <pr> <sha>`', '`NEEDS_DIRECTION: <question>`',
      'never switch the branch of, stage in, or commit in /repo', 'the commit whose Done commands the runner last passed']) {
      expect(rendered).toContain(s);
    }
    expect(countTribeMentions(rendered)).toEqual([]);
  });

  test('reportPathFor composes <home>/reports/<cardId>.md — no .claude/state anywhere (spec §5.3)', () => {
    expect(reportPathFor('/th/campaigns/camp', 'C1')).toBe('/th/campaigns/camp/reports/C1.md');
  });

  test('executorBrief substitutes the injected campaign home into {{CAMPAIGN_HOME}}', () => {
    const brief = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_CAMPAIGN_HOME,
      FIXTURE_CAMPAIGN_SLUG,
      FIXTURE_DRIVER,
    );
    expect(brief).toContain(FIXTURE_CAMPAIGN_HOME);
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
      FIXTURE_CAMPAIGN_HOME,
      'kanna-session-import',
      FIXTURE_DRIVER,
    );
    expect(brief).toContain('Campaign: kanna-session-import');
  });

  test('the slug is substituted, never left as a placeholder', () => {
    const brief = executorBrief(
      fixtureCard(),
      fixtureState(),
      FIXTURE_ANSWERS,
      TEMPLATE,
      FIXTURE_CAMPAIGN_HOME,
      'widget-export',
      FIXTURE_DRIVER,
    );
    expect(brief).not.toContain('CAMPAIGN_SLUG');
    expect(brief).toContain('Campaign: widget-export');
  });
});
