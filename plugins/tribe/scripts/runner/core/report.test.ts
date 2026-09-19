// Tests for report.ts (Task 3, spec §O5): the report contract. Pure module — every test
// drives a fully mocked `ReportIO`; the one exception (the "commit failed" describe block)
// exercises the REAL `runLoop` (already fully covered in loop.test.ts) purely to produce a
// realistic post-run `CampaignState`, proving report.ts's own claim: it reads persisted state
// only, never a commit outcome, so a failed state-commit PR never hides a real ship/escalation.
import { describe, expect, mock, test } from 'bun:test';
import {
  buildCampaignReport,
  deriveExitReason,
  extractQuestionDigest,
  renderReportMarkdown,
  shouldWriteReport,
  writeReport,
  type CardReportEntry,
  type ReportConfig,
  type ReportIO,
  type ReportRunInfo,
} from './report.ts';
import {
  runLoop,
  type ExecResult,
  type LoopIO,
  type RunLoopConfig,
} from './loop.ts';
import { EXIT_ESCALATED, EXIT_LOCKED, EXIT_OK, EXIT_RULINGS_UNRATIFIED, EXIT_SESSION_INCOMPLETE } from './types.ts';
import { BRIEF_TEMPLATE_PATH } from './brief.ts';
import { parseState } from './state.ts';
import type { Card, CampaignState } from './types.ts';

// ---------------------------------------------------------------------------------------
// Shared fixtures (deliberately neutral — no repo names, no absolute paths beyond the
// generic `/repo` test convention already used throughout loop.test.ts — stateless wall).
// ---------------------------------------------------------------------------------------

function fixtureCard(overrides: Partial<Card> = {}): Card {
  return {
    status: 'staged',
    spec: 'docs/specs/c1.md',
    plan: 'docs/plans/c1.md',
    branch: 'feat/c1-widget',
    baseSha: null,
    pr: null,
    mergeSha: null,
    sessionId: null,
    updatedAt: null,
    ...overrides,
  };
}

function fixtureState(overrides: Partial<CampaignState> = {}): CampaignState {
  return {
    v: 1,
    campaign: 'sample-campaign',
    mergePolicy: 'merge',
    sequence: ['A1'],
    schemaLockPaths: [],
    docsOnlyPaths: ['docs/'],
    ownerOnlyEscalations: [],
    cards: { A1: fixtureCard() },
    ...overrides,
  };
}

function fixtureRun(overrides: Partial<ReportRunInfo> = {}): ReportRunInfo {
  return {
    startedAt: '2026-07-17T00:00:00Z',
    endedAt: '2026-07-17T00:05:00Z',
    exitCode: EXIT_OK,
    reason: 'done',
    ...overrides,
  };
}

function fixtureConfig(overrides: Partial<ReportConfig> = {}): ReportConfig {
  return {
    homeDir: '/home/c',
    ...overrides,
  };
}

function ioWith(overrides: Partial<ReportIO> = {}): ReportIO {
  return {
    fileExists: () => false,
    readFile: () => {
      throw new Error('unexpected readFile call in this fixture');
    },
    writeFile: () => {},
    ...overrides,
  };
}

// ===========================================================================================
// deriveExitReason — pure mapping from a run outcome to the §O5 reason vocabulary
// ===========================================================================================

describe('deriveExitReason — maps a run outcome to the §O5 report reason vocabulary', () => {
  test('a thrown error always wins, regardless of exit code or message', () => {
    expect(deriveExitReason({ threw: true, exitCode: EXIT_OK, hasMessage: false })).toBe('error');
    expect(deriveExitReason({ threw: true, exitCode: EXIT_ESCALATED, hasMessage: true })).toBe('error');
  });

  test('EXIT_ESCALATED -> escalations_pending', () => {
    expect(deriveExitReason({ threw: false, exitCode: EXIT_ESCALATED, hasMessage: false })).toBe(
      'escalations_pending',
    );
  });

  test('EXIT_SESSION_INCOMPLETE -> session_incomplete', () => {
    expect(deriveExitReason({ threw: false, exitCode: EXIT_SESSION_INCOMPLETE, hasMessage: false })).toBe(
      'session_incomplete',
    );
  });

  test('EXIT_OK with a message (the startup-STOP early return carries one) -> stop_requested', () => {
    expect(deriveExitReason({ threw: false, exitCode: EXIT_OK, hasMessage: true })).toBe('stop_requested');
  });

  test('EXIT_OK with no message -> done', () => {
    expect(deriveExitReason({ threw: false, exitCode: EXIT_OK, hasMessage: false })).toBe('done');
  });

  test('EXIT_RULINGS_UNRATIFIED -> rulings_unratified, regardless of hasMessage (harness-gap-wiring PR C)', () => {
    expect(deriveExitReason({ threw: false, exitCode: EXIT_RULINGS_UNRATIFIED, hasMessage: false })).toBe(
      'rulings_unratified',
    );
    // The gate's LoopResult carries a human-readable message (same as the STOP-file path) —
    // it must not be misclassified as `stop_requested` the way a bare `hasMessage` check would.
    expect(deriveExitReason({ threw: false, exitCode: EXIT_RULINGS_UNRATIFIED, hasMessage: true })).toBe(
      'rulings_unratified',
    );
  });
});

// ===========================================================================================
// shouldWriteReport — the two exit paths (design notes 1) that must NEVER write a report
// ===========================================================================================

describe('shouldWriteReport — --dry-run and EXIT_LOCKED never write; every other path does', () => {
  test('--dry-run never writes, regardless of exit code', () => {
    expect(shouldWriteReport({ dryRun: true, exitCode: EXIT_OK })).toBe(false);
    expect(shouldWriteReport({ dryRun: true, exitCode: EXIT_ESCALATED })).toBe(false);
    expect(shouldWriteReport({ dryRun: true, exitCode: EXIT_LOCKED })).toBe(false);
  });

  test('EXIT_LOCKED never writes (another live process owns the campaign — see design note 1)', () => {
    expect(shouldWriteReport({ dryRun: false, exitCode: EXIT_LOCKED })).toBe(false);
  });

  test('EXIT_OK / EXIT_ESCALATED / EXIT_SESSION_INCOMPLETE / a generic error code all write', () => {
    expect(shouldWriteReport({ dryRun: false, exitCode: EXIT_OK })).toBe(true);
    expect(shouldWriteReport({ dryRun: false, exitCode: EXIT_ESCALATED })).toBe(true);
    expect(shouldWriteReport({ dryRun: false, exitCode: EXIT_SESSION_INCOMPLETE })).toBe(true);
    expect(shouldWriteReport({ dryRun: false, exitCode: 4 })).toBe(true);
  });
});

// ===========================================================================================
// extractQuestionDigest — best-effort one-line digest from an escalation markdown file
// ===========================================================================================

describe('extractQuestionDigest — best-effort one-line digest (Warchief ruling 4)', () => {
  test('reason + first context line, the exact shape loop.ts\'s buildEscalationMarkdown produces', () => {
    const markdown = [
      '# Escalation: B4',
      '',
      '**Reason:** needs_direction',
      '',
      '## Context',
      'Which schema-lock path applies to the new report fields?',
      '',
      '## Options',
      '- Append a ruling to `answers.md` and re-run with `--include-escalated`.',
      '',
    ].join('\n');
    expect(extractQuestionDigest(markdown)).toBe(
      'needs_direction: Which schema-lock path applies to the new report fields?',
    );
  });

  test('multi-line context (verify_failed_twice\'s bullet list) still yields ONE line', () => {
    const markdown = [
      '# Escalation: B8',
      '',
      '**Reason:** verify_failed_twice',
      '',
      '## Context',
      '- checksGreen: 1 check(s) not successful: ci',
      '- schemaGuard: schema-lock paths changed since abc123',
      '',
      '## Options',
      '',
    ].join('\n');
    const digest = extractQuestionDigest(markdown);
    expect(digest).toContain('verify_failed_twice');
    expect(digest).not.toContain('\n');
  });

  test('unrecognizable content -> a plain, honest fallback, never an invented digest', () => {
    expect(extractQuestionDigest('not an escalation file at all')).toBe(
      '(escalation file present but no recognizable question content)',
    );
  });

  // Task 15 (spec §5(d)): this is the escalation-file shape's THIRD read site — the other two
  // (`loop.ts`'s reason-line read and its park-document question) already go through
  // `core/escalation.ts`'s `parseEscalationQuestion`, whose heading matcher
  // (`/^##\s+(.+?)\s*$/`) accepts ANY run of whitespace after `##`. The pre-refactor digest found
  // its `## Context` section with a literal-substring regex (`/## Context\n+.../`, one space,
  // exactly) that a heading with EXTRA whitespace does not satisfy. Feeding that shape proves the
  // parse now goes through the shared parser rather than the old regex: only `escalation.ts`'s
  // matcher can find this heading. Before the swap this is RED — the old regex finds no `##
  // Context` substring in this markdown at all, so the digest falls back to the reason alone.
  test('a heading with extra whitespace after "##" parses via core/escalation.ts\'s matcher, not the old literal-substring regex', () => {
    const markdown = [
      '**Reason:** needs_direction',
      '',
      '##  Context', // two spaces after the hashes
      'a loosely-formatted heading line still carries a real question',
      '',
    ].join('\n');
    expect(extractQuestionDigest(markdown)).toBe(
      'needs_direction: a loosely-formatted heading line still carries a real question',
    );
  });
});

// ===========================================================================================
// buildCampaignReport — per-card outcome derivation (Warchief rulings 1/2/4)
// ===========================================================================================

describe('buildCampaignReport — shipped', () => {
  test('carries pr + mergeSha straight from state; v/campaign set; empty pending', async () => {
    const state = fixtureState({
      sequence: ['A1'],
      cards: { A1: fixtureCard({ status: 'shipped', pr: 41, mergeSha: 'deadbeef' }) },
    });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), ioWith());
    expect(report.v).toBe(1);
    expect(report.campaign).toBe('sample-campaign');
    expect(report.cards.A1).toEqual({ outcome: 'shipped', pr: 41, mergeSha: 'deadbeef' });
    expect(report.stats).toEqual({ shipped: 1, escalated: 0, blocked: 0, notReached: 0 });
    expect(report.pending).toEqual([]);
  });
});

describe('buildCampaignReport — escalated', () => {
  test('escalationFile + question digest (read from disk) + autoAnswerRounds; lands in pending', async () => {
    const state = fixtureState({
      sequence: ['B4'],
      cards: { B4: fixtureCard({ status: 'escalated', autoAnswerRounds: 1 }) },
    });
    const markdown = ['**Reason:** needs_direction', '', '## Context', 'Which repo owns this?', ''].join('\n');
    const io = ioWith({
      fileExists: (p) => p === '/home/c/escalations/B4.md',
      readFile: (p) => (p === '/home/c/escalations/B4.md' ? markdown : Promise.reject(new Error('no fixture'))),
    });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), io);
    expect(report.cards.B4).toEqual({
      outcome: 'escalated',
      escalationFile: 'escalations/B4.md',
      question: 'needs_direction: Which repo owns this?',
      autoAnswerRounds: 1,
    });
    expect(report.pending).toEqual(['B4']);
    expect(report.stats.escalated).toBe(1);
  });

  test('autoAnswerRounds absent from state defaults to 0 (W7 accounting)', async () => {
    const state = fixtureState({ sequence: ['B4'], cards: { B4: fixtureCard({ status: 'escalated' }) } });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), ioWith());
    expect((report.cards.B4 as CardReportEntry & { outcome: 'escalated' }).autoAnswerRounds).toBe(0);
  });

  test('escalation file missing on disk -> honest fallback, never invented', async () => {
    const state = fixtureState({ sequence: ['B4'], cards: { B4: fixtureCard({ status: 'escalated' }) } });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), ioWith({ fileExists: () => false }));
    expect((report.cards.B4 as CardReportEntry & { outcome: 'escalated' }).question).toBe(
      '(escalation file not found on disk)',
    );
  });

  test('escalation file present but unreadable -> honest fallback naming the failure, never a crash', async () => {
    const state = fixtureState({ sequence: ['B4'], cards: { B4: fixtureCard({ status: 'escalated' }) } });
    const io = ioWith({
      fileExists: () => true,
      readFile: () => {
        throw new Error('EACCES');
      },
    });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), io);
    expect((report.cards.B4 as CardReportEntry & { outcome: 'escalated' }).question).toContain(
      'could not read escalation file',
    );
  });

  // Ruling 4: loop.ts's CardOutcome.escalation_pending (a PRIOR run's unanswered escalation)
  // leaves card.status === 'escalated' from whenever it FIRST fired, and its escalation file
  // already exists on disk from that same earlier run — report.ts reads only final state, so
  // this reports identically to a fresh-this-pass escalation. There is no separate signal to
  // consult (CardOutcome itself is never passed to report.ts — see the report to the Warchief).
  test('a prior-run pending escalation (nothing written THIS pass) reports identically to a fresh one', async () => {
    const state = fixtureState({
      sequence: ['B4'],
      cards: { B4: fixtureCard({ status: 'escalated', autoAnswerRounds: 2 }) },
    });
    const markdown = ['**Reason:** needs_direction', '', '## Context', 'still unanswered', ''].join('\n');
    const io = ioWith({ fileExists: () => true, readFile: () => markdown });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), io);
    expect(report.cards.B4).toEqual({
      outcome: 'escalated',
      escalationFile: 'escalations/B4.md',
      question: 'needs_direction: still unanswered',
      autoAnswerRounds: 2,
    });
  });
});

describe('buildCampaignReport — blocked (Warchief ruling 1: derived status, blockedOn derived from dependsOn)', () => {
  test('blockedOn is the FIRST unmet (non-shipped) dependency, in dependsOn order (documented choice)', async () => {
    const state = fixtureState({
      sequence: ['A1', 'B2', 'B8'],
      cards: {
        A1: fixtureCard({ status: 'escalated' }),
        B2: fixtureCard({ status: 'escalated' }),
        B8: fixtureCard({ status: 'blocked', dependsOn: ['A1', 'B2'] }),
      },
    });
    const io = ioWith({ fileExists: () => true, readFile: () => '**Reason:** x\n\n## Context\ny\n' });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), io);
    expect(report.cards.B8).toEqual({ outcome: 'blocked', blockedOn: 'A1' });
  });

  test('a dependency that already shipped is never reported as the blocker', async () => {
    const state = fixtureState({
      sequence: ['A1', 'B2', 'B8'],
      cards: {
        A1: fixtureCard({ status: 'shipped', pr: 1, mergeSha: 'sha1' }),
        B2: fixtureCard({ status: 'escalated' }),
        B8: fixtureCard({ status: 'blocked', dependsOn: ['A1', 'B2'] }),
      },
    });
    const io = ioWith({ fileExists: () => true, readFile: () => '**Reason:** x\n\n## Context\ny\n' });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), io);
    expect(report.cards.B8).toEqual({ outcome: 'blocked', blockedOn: 'B2' });
  });

  test('degrades gracefully (never crashes/invents) when a blocked card has no unmet dependency on record', async () => {
    // Not expected in practice (nextCard's reconciliation would have unblocked it), but
    // report.ts must never crash or fabricate a blocker id on a stale/inconsistent read.
    const state = fixtureState({
      sequence: ['A1', 'B8'],
      cards: {
        A1: fixtureCard({ status: 'shipped', pr: 1, mergeSha: 'sha1' }),
        B8: fixtureCard({ status: 'blocked', dependsOn: ['A1'] }),
      },
    });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), ioWith());
    expect(report.cards.B8).toEqual({
      outcome: 'blocked',
      blockedOn: '(unknown — no unmet dependency found in state)',
    });
  });
});

describe('buildCampaignReport — not_reached', () => {
  test('a staged card never selected this pass (e.g. --max-cards budget spent elsewhere)', async () => {
    const state = fixtureState({ sequence: ['A6'], cards: { A6: fixtureCard({ status: 'staged' }) } });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), ioWith());
    expect(report.cards.A6).toEqual({ outcome: 'not_reached' });
    expect(report.stats.notReached).toBe(1);
  });

  // Design gap flagged to the Warchief: loop.ts's CardOutcome has a `stopped` kind (a session
  // errored/timed out mid-flight) that §O5's four-value vocabulary has no slot for. A stopped
  // card's status is left at 'running' (never reset) — see `actOnCard`'s 'stopped' branch in
  // loop.ts. Since it needs no owner action (the next run resumes it automatically, exactly
  // like a not_reached card), this Hunter folds it into `not_reached` rather than inventing a
  // 5th outcome value the frozen JSON contract doesn't name. Flagged as an assumption to
  // challenge in the Hunter's report.
  test('a card whose session stopped mid-flight (status stuck at "running") also reports not_reached', async () => {
    const state = fixtureState({ sequence: ['A6'], cards: { A6: fixtureCard({ status: 'running', sessionId: 'x' }) } });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), ioWith());
    expect(report.cards.A6).toEqual({ outcome: 'not_reached' });
  });
});

describe('buildCampaignReport — mixed campaign matches the §O5 worked example shape', () => {
  test('stats/pending/cards over shipped+escalated+blocked+not_reached', async () => {
    const state = fixtureState({
      sequence: ['B3', 'B4', 'B8', 'A6'],
      cards: {
        B3: fixtureCard({ status: 'shipped', pr: 41, mergeSha: 'sha-b3' }),
        B4: fixtureCard({ status: 'escalated', autoAnswerRounds: 1 }),
        B8: fixtureCard({ status: 'blocked', dependsOn: ['B4'] }),
        A6: fixtureCard({ status: 'staged' }),
      },
    });
    const io = ioWith({ fileExists: () => true, readFile: () => '**Reason:** needs_direction\n\n## Context\nq\n' });
    const report = await buildCampaignReport(
      state,
      fixtureRun({ exitCode: EXIT_ESCALATED, reason: 'escalations_pending' }),
      fixtureConfig(),
      io,
    );
    expect(report.stats).toEqual({ shipped: 1, escalated: 1, blocked: 1, notReached: 1 });
    expect(report.pending).toEqual(['B4']);
    expect(Object.keys(report.cards)).toEqual(['B3', 'B4', 'B8', 'A6']);
  });
});

// ===========================================================================================
// renderReportMarkdown — JSON<->MD parity (both twins derived from the SAME report object)
// ===========================================================================================

describe('renderReportMarkdown — JSON<->MD parity', () => {
  test('every JSON-observable value surfaces as a substring in the md twin', async () => {
    const state = fixtureState({
      sequence: ['B3', 'B4', 'B8', 'A6'],
      cards: {
        B3: fixtureCard({ status: 'shipped', pr: 41, mergeSha: 'sha-b3' }),
        B4: fixtureCard({ status: 'escalated', autoAnswerRounds: 1 }),
        B8: fixtureCard({ status: 'blocked', dependsOn: ['B4'] }),
        A6: fixtureCard({ status: 'staged' }),
      },
    });
    const io = ioWith({
      fileExists: () => true,
      readFile: () => '**Reason:** needs_direction\n\n## Context\nwhich repo?\n',
    });
    const report = await buildCampaignReport(
      state,
      fixtureRun({ exitCode: EXIT_ESCALATED, reason: 'escalations_pending' }),
      fixtureConfig(),
      io,
    );
    const md = renderReportMarkdown(report);

    expect(md).toContain(report.campaign);
    expect(md).toContain(String(report.run.exitCode));
    expect(md).toContain(report.run.reason);

    for (const [cardId, entry] of Object.entries(report.cards)) {
      expect(md).toContain(cardId);
      expect(md).toContain(entry.outcome);
      if (entry.outcome === 'shipped') {
        expect(md).toContain(String(entry.pr));
        expect(md).toContain(String(entry.mergeSha));
      }
      if (entry.outcome === 'escalated') {
        expect(md).toContain(entry.escalationFile);
        expect(md).toContain(entry.question);
        expect(md).toContain(String(entry.autoAnswerRounds));
      }
      if (entry.outcome === 'blocked') {
        expect(md).toContain(entry.blockedOn);
      }
    }
    for (const cardId of report.pending) {
      expect(md).toContain(cardId);
    }
    expect(md).toContain(String(report.stats.shipped));
    expect(md).toContain(String(report.stats.escalated));
    expect(md).toContain(String(report.stats.blocked));
    expect(md).toContain(String(report.stats.notReached));
  });
});

// ===========================================================================================
// renderReportMarkdown — rulings_unratified (harness-gap-wiring PR C): the P5 "answerable"
// framing (ruling path leads, same as needs_direction) and the unratified ruling ids
// ===========================================================================================

describe('renderReportMarkdown — rulings_unratified (maintainer ruling: campaign-level state, folded into "Pending")', () => {
  test('the unratified ruling ids and guidance land INSIDE the "## Pending" section, not a separate per-card-style block', async () => {
    const state = fixtureState({ sequence: ['A1'], cards: { A1: fixtureCard({ status: 'shipped' }) } });
    const report = await buildCampaignReport(
      state,
      fixtureRun({
        exitCode: EXIT_RULINGS_UNRATIFIED,
        reason: 'rulings_unratified',
        unratifiedRulings: ['R2 — Still pending', 'R5 — Unrecognized value'],
      }),
      fixtureConfig(),
      ioWith(),
    );
    const md = renderReportMarkdown(report);

    expect(md).toContain('rulings_unratified');
    expect(md).toContain('ratified-as');
    expect(md).toContain('R2 — Still pending');
    expect(md).toContain('R5 — Unrecognized value');

    // Placement: the note (and both ruling ids) must appear AFTER the "## Pending" heading —
    // never as its own top-level "## Options" section, and never inside "## Cards" (no single
    // card owns this condition — see report.ts's renderRulingsUnratifiedNote doc comment).
    const pendingIdx = md.indexOf('## Pending (needs the owner)');
    const cardsIdx = md.indexOf('## Cards');
    const noteIdx = md.indexOf('Unratified rulings (answerable)');
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(pendingIdx);
    expect(md).not.toContain('## Options');
    expect(md.indexOf('R2 — Still pending')).toBeGreaterThan(cardsIdx);
  });

  test('no rulings note, and no stray field, when the reason is not rulings_unratified', async () => {
    const state = fixtureState({ sequence: ['A1'], cards: { A1: fixtureCard({ status: 'shipped' }) } });
    const report = await buildCampaignReport(state, fixtureRun(), fixtureConfig(), ioWith());
    const md = renderReportMarkdown(report);
    expect(md).not.toContain('ratified-as');
    expect(md).not.toContain('Unratified rulings');
  });
});

// ===========================================================================================
// writeReport — the injected seam
// ===========================================================================================

describe('writeReport — writes BOTH twins into `dir`, both derived from ONE built report', () => {
  test('writes campaign-report.json and campaign-report.md; JSON parses back to the built report', async () => {
    const state = fixtureState({
      sequence: ['A1'],
      cards: { A1: fixtureCard({ status: 'shipped', pr: 1, mergeSha: 'sha1' }) },
    });
    const written = new Map<string, string>();
    const io = ioWith({
      writeFile: (p, content) => {
        written.set(p, content);
      },
    });

    const report = await writeReport(state, fixtureRun(), '/repo/docs/campaign', fixtureConfig(), io);

    expect(written.has('/repo/docs/campaign/campaign-report.json')).toBe(true);
    expect(written.has('/repo/docs/campaign/campaign-report.md')).toBe(true);
    const parsedJson = JSON.parse(written.get('/repo/docs/campaign/campaign-report.json') as string);
    expect(parsedJson).toEqual(report);
    const md = written.get('/repo/docs/campaign/campaign-report.md') as string;
    expect(md).toContain('A1');
    expect(md).toContain('shipped');
  });

  test('one report per exit-path in the matrix: reason/exitCode round-trip into the written JSON', async () => {
    const state = fixtureState({ sequence: ['A1'], cards: { A1: fixtureCard({ status: 'staged' }) } });
    const cases: ReportRunInfo[] = [
      fixtureRun({ exitCode: EXIT_OK, reason: 'done' }),
      fixtureRun({ exitCode: EXIT_OK, reason: 'stop_requested' }),
      fixtureRun({ exitCode: EXIT_ESCALATED, reason: 'escalations_pending' }),
      fixtureRun({ exitCode: EXIT_SESSION_INCOMPLETE, reason: 'session_incomplete' }),
      fixtureRun({ exitCode: 4, reason: 'error' }),
    ];
    for (const run of cases) {
      const written = new Map<string, string>();
      const io = ioWith({
        writeFile: (p, content) => {
          written.set(p, content);
        },
      });
      await writeReport(state, run, '/repo/state-dir', fixtureConfig(), io);
      const parsed = JSON.parse(written.get('/repo/state-dir/campaign-report.json') as string);
      expect(parsed.run).toEqual(run);
    }
  });
});

// ===========================================================================================
// W-F5: the owner-visible half of the bug — a card blocked by the LAST tick's reconciliation
// must reach the report as "blocked", never "not_reached".
// ===========================================================================================

describe('writeReport — W-F5: last-tick blocked reconciliation reaches the report as blocked, not not_reached', () => {
  test('A (missing spec/plan) escalates via PLANNING_NEEDED on the only tick; B (dependsOn A) is ' +
    'reconciled to blocked on the very next tick, which then discovers `done` — the report built ' +
    'from the REAL runLoop\'s persisted state must show B as blocked on A (never not_reached), ' +
    'with stats/pending correctly accounting for it', async () => {
    const state = fixtureState({
      sequence: ['A', 'B'],
      cards: {
        A: fixtureCard({ branch: null, spec: null, plan: null }),
        B: fixtureCard({ branch: null, dependsOn: ['A'] }),
      },
    });
    const written = new Map<string, string>();
    written.set('/th/campaign-state.json', JSON.stringify(state));
    written.set('/th/answers.md', '');

    const loopIo: LoopIO = {
      exec: mock(async (cmd: string[]): Promise<ExecResult> => {
        if (cmd[0] === 'git' && cmd[1] === 'symbolic-ref') return { stdout: 'origin/master\n', stderr: '', exitCode: 0 };
        // C2: the planning_needed escalation asks where the main checkout is; on the base branch here.
        if (cmd[0] === 'git' && cmd[1] === 'rev-parse' && cmd.includes('--abbrev-ref'))
          return { stdout: 'master\n', stderr: '', exitCode: 0 };
        if (cmd[0] === 'git' && cmd[1] === 'fetch') return { stdout: '', stderr: '', exitCode: 0 };
        if (cmd[0] === 'git' && cmd[1] === 'checkout') return { stdout: '', stderr: '', exitCode: 0 };
        if (cmd[0] === 'git' && cmd[1] === 'add') return { stdout: '', stderr: '', exitCode: 0 };
        if (cmd[0] === 'git' && cmd[1] === 'commit') return { stdout: '', stderr: '', exitCode: 0 };
        if (cmd[0] === 'git' && cmd[1] === 'push') return { stdout: '', stderr: '', exitCode: 0 };
        if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'create')
          return { stdout: 'https://example.invalid/o/r/pull/1\n', stderr: '', exitCode: 0 };
        if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'checks')
          return { stdout: JSON.stringify([{ name: 'ci', bucket: 'pass' }]), stderr: '', exitCode: 0 };
        if (cmd[0] === 'gh' && cmd[1] === 'pr' && cmd[2] === 'merge') return { stdout: '', stderr: '', exitCode: 0 };
        if (cmd[0] === 'git' && cmd[1] === 'pull') return { stdout: '', stderr: '', exitCode: 0 };
        throw new Error(`unscripted exec: ${cmd.join(' ')}`);
      }),
      sleep: async () => {},
      fileExists: (p) => !p.endsWith('STOP') && !p.includes('/escalations/'),
      readFile: (p) => {
        if (p === BRIEF_TEMPLATE_PATH) return '# Executor brief for {{CARD_ID}}\n{{ANSWERS_CONTENT}}';
        const c = written.get(p);
        if (c === undefined) throw new Error(`no fixture for ${p}`);
        return c;
      },
      writeFile: (p, content) => {
        written.set(p, content);
      },
      renameFile: () => {},
      readLock: () => null,
      writeLock: () => {},
      removeLock: () => {},
      isProcessAlive: () => false,
      currentPid: () => 4321,
      now: () => '2026-07-17T00:00:00Z',
      // Task 27: LoopIO gained printLine (LinePort) — this fixture has nothing to assert
      // about the viewer's session line.
      printLine: () => {},
      spawnSession: () => {
        throw new Error('no session should ever be spawned in this test — B is only reconciled, never attempted');
      },
      appendLog: () => {},
      ensureDir: () => {},
      writeFileAtomic: () => {},
    };

    const config: RunLoopConfig = {
      repoRoot: '/repo',
      logsDir: '/logs',
      homeDir: '/th',
      runId: 'fixture-run',
      argv: [],
      model: 'fixture-model',
      includeEscalated: false,
      dryRun: false,
      remote: 'origin',
    };

    const loopResult = await runLoop(config, loopIo);
    expect(loopResult.exitCode).toBe(EXIT_ESCALATED);
    expect(loopResult.processed).toHaveLength(1);
    expect(loopResult.processed[0]).toMatchObject({ kind: 'escalated', cardId: 'A' });

    // The bug this guards: without loop.ts persisting the final-tick reconciliation, B would
    // still read "staged" here, and the report below would show B as not_reached instead of
    // blocked.
    const finalState = parseState(JSON.parse(written.get('/th/campaign-state.json') as string));
    expect(finalState.cards.A.status).toBe('escalated');
    expect(finalState.cards.B.status).toBe('blocked');

    const report = await buildCampaignReport(
      finalState,
      fixtureRun({
        exitCode: loopResult.exitCode,
        reason: deriveExitReason({ threw: false, exitCode: loopResult.exitCode, hasMessage: false }),
      }),
      fixtureConfig(),
      ioWith({
        fileExists: () => true,
        readFile: () => '**Reason:** planning_needed\n\n## Context\nMissing on disk: spec, plan\n',
      }),
    );

    expect(report.cards.B).toEqual({ outcome: 'blocked', blockedOn: 'A' });
    expect(report.stats).toEqual({ shipped: 0, escalated: 1, blocked: 1, notReached: 0 });
    // `pending` (needs the owner) still names only A — B needs no owner ruling of its own, it
    // will unblock automatically once A is answered and re-run; A is what the owner must act on.
    expect(report.pending).toEqual(['A']);
  });
});
