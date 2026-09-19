// Tests for brief.ts (Task 9, spec §5.2-§5.4): pure rendering of the three one-shot session
// briefs (`ruling`, `ratify`, `closing`).
//
// Oracle (brief-contracts.md's four obligations, applied to a machine-rendered brief): the
// spec in the plan/brief is the contract for WHAT a rendered brief must carry. For the
// governing quotes specifically, `SKILL.md` is the oracle for their exact bytes — this file
// reads `SKILL.md` itself and asserts the rendered brief carries those bytes byte-identical,
// so a future paraphrase of the template fails here rather than only in a spec review.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOSING_TEMPLATE_PATH,
  RATIFY_TEMPLATE_PATH,
  RULING_TEMPLATE_PATH,
  renderBrief,
} from './brief.ts';
import type { ClosingBriefFacts, RatifyBriefFacts, RulingBriefFacts } from './brief.ts';

const SKILL_MD = readFileSync(
  join(import.meta.dir, '../../../../skills/orchestrate-campaign/SKILL.md'),
  'utf8',
);

const RULING_TEMPLATE = readFileSync(RULING_TEMPLATE_PATH, 'utf8');
const RATIFY_TEMPLATE = readFileSync(RATIFY_TEMPLATE_PATH, 'utf8');
const CLOSING_TEMPLATE = readFileSync(CLOSING_TEMPLATE_PATH, 'utf8');

/** Extracts the exact substring of `SKILL.md` bounded by two literal, unique anchors —
 * never a hardcoded line number, so this stays honest even if unrelated text moves around
 * it. Throws if either anchor is missing, which is itself a useful failure: it means
 * `SKILL.md`'s wording changed under this test. */
function skillMdQuote(startMarker: string, endMarker: string): string {
  const start = SKILL_MD.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`SKILL.md oracle: start marker not found: ${JSON.stringify(startMarker)}`);
  }
  const endAt = SKILL_MD.indexOf(endMarker, start);
  if (endAt === -1) {
    throw new Error(`SKILL.md oracle: end marker not found: ${JSON.stringify(endMarker)}`);
  }
  return SKILL_MD.slice(start, endAt + endMarker.length);
}

const W3_QUOTE = skillMdQuote(
  '- **W3 — judgment stays in sessions.**',
  'continuing the loop.',
);
const W7_QUOTE = skillMdQuote(
  '- **W7 — bounded auto-answer.**',
  'do not attempt a third ruling.',
);

const STAGE_D_STEP_1 = '1. **For every card the report marks `shipped`';
const STAGE_D_STEP_2 = '2. **The ratification pass.**';
const STAGE_D_STEP_3 =
  '3. **You can also recover which commits belong to this campaign directly from git.**';
const STAGE_D_STEP_4 = '4. **Compose ONE report** to the owner';

// Self-check: fail loudly, not silently, if SKILL.md ever stops containing one of the Stage D
// step openings this test relies on — the same "oracle honesty" the W3/W7 markers give above.
for (const marker of [STAGE_D_STEP_1, STAGE_D_STEP_2, STAGE_D_STEP_3, STAGE_D_STEP_4]) {
  if (!SKILL_MD.includes(marker)) {
    throw new Error(`SKILL.md oracle: Stage D marker not found: ${JSON.stringify(marker)}`);
  }
}

function fixtureRulingFacts(overrides: Partial<RulingBriefFacts> = {}): RulingBriefFacts {
  return {
    kind: 'ruling',
    template: RULING_TEMPLATE,
    cardId: 'widget-export',
    escalationContent: '# Escalation: widget-export\n\nShould the export button be primary or secondary?\n',
    ownerOnlyEscalations: ['schema-lock-change', 'breaking-change'],
    existingRulingIds: ['R1', 'R2'],
    specPath: 'docs/superpowers/specs/2026-01-01-widget-export.md',
    planPath: 'docs/superpowers/plans/2026-01-01-widget-export.md',
    answersPath: '/tmp/campaign-home/answers.md',
    escalationPath: '/tmp/campaign-home/escalations/widget-export.md',
    ...overrides,
  };
}

function fixtureRatifyFacts(overrides: Partial<RatifyBriefFacts> = {}): RatifyBriefFacts {
  return {
    kind: 'ratify',
    template: RATIFY_TEMPLATE,
    unratifiedRulingIds: ['R3', 'R5'],
    rulingBlocks: [
      { id: 'R3', content: '## R3 -- scope\n\nratified-as: pending\n' },
      { id: 'R5', content: '## R5 -- sequencing\n\nratified-as: pending\n' },
    ],
    answersPath: '/tmp/campaign-home/answers.md',
    ...overrides,
  };
}

function fixtureClosingFacts(overrides: Partial<ClosingBriefFacts> = {}): ClosingBriefFacts {
  return {
    kind: 'closing',
    template: CLOSING_TEMPLATE,
    campaignReportContent: '{"run":{"reason":"done"},"stats":{"shipped":3}}',
    rulings: [{ id: 'R1', ratifiedAs: 'operational' }],
    openIdsByCard: [{ cardId: 'widget-export', openIds: ['G-101'] }],
    finalReportPath: '/th/campaigns/widget-campaign/supervisor/final-report.md',
    shippedVerdicts: [
      { cardId: 'widget-export', verdictPath: '/th/campaigns/widget-campaign/supervisor/verdicts/widget-export.json' },
    ],
    ...overrides,
  };
}

describe('renderBrief — ruling', () => {
  test('contains the escalation file content verbatim', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts());
    expect(rendered).toContain(
      '# Escalation: widget-export\n\nShould the export button be primary or secondary?\n',
    );
  });

  test('contains every ownerOnlyEscalations entry verbatim', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts());
    expect(rendered).toContain('schema-lock-change');
    expect(rendered).toContain('breaking-change');
  });

  test('carries the W3 quote byte-identical to SKILL.md — a future paraphrase fails here', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts());
    expect(rendered).toContain(W3_QUOTE);
  });

  test('carries the W7 quote byte-identical to SKILL.md — a future paraphrase fails here', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts());
    expect(rendered).toContain(W7_QUOTE);
  });

  test('lists the existing ruling ids so the session picks the next R<n> without guessing', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts());
    expect(rendered).toContain('R1');
    expect(rendered).toContain('R2');
  });

  test('names both exits, and only those two', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts());
    expect(rendered).toContain('Append a ruling to `/tmp/campaign-home/answers.md`');
    expect(rendered).toContain('Write a park marker');
  });

  // R13.2: the rendered brief must name the ABSOLUTE path of `answers.md` — Haiku's first two
  // attempts against a bare `answers.md` were `Read /answers.md` and `Write /answers.md`
  // (filesystem root), because nothing in the brief said where the file actually is.
  test('R13.2: contains the absolute path of answers.md, never a bare name', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts({ answersPath: '/tmp/campaign-home/answers.md' }));
    expect(rendered).toContain('/tmp/campaign-home/answers.md');
  });

  // R13.2: the escalation file, likewise, must be named by its absolute path.
  test('R13.2: contains the absolute path of the escalation file, never a bare name', () => {
    const rendered = renderBrief(
      'ruling',
      fixtureRulingFacts({ escalationPath: '/tmp/campaign-home/escalations/widget-export.md' }),
    );
    expect(rendered).toContain('/tmp/campaign-home/escalations/widget-export.md');
  });

  test('never contains the words "you may use bash" — a ruling session has no shell', () => {
    const rendered = renderBrief('ruling', fixtureRulingFacts());
    expect(rendered.toLowerCase()).not.toContain('you may use bash');
  });

  test('is deterministic: two renders of the same facts are byte-identical', () => {
    const facts = fixtureRulingFacts();
    expect(renderBrief('ruling', facts)).toBe(renderBrief('ruling', facts));
  });
});

describe('renderBrief — ratify', () => {
  test('names every unratified id', () => {
    const rendered = renderBrief('ratify', fixtureRatifyFacts());
    expect(rendered).toContain('R3');
    expect(rendered).toContain('R5');
  });

  test('is deterministic: two renders of the same facts are byte-identical', () => {
    const facts = fixtureRatifyFacts();
    expect(renderBrief('ratify', facts)).toBe(renderBrief('ratify', facts));
  });

  // R13.2: the ratify brief must also name the absolute path of `answers.md` — it is the file
  // the session is repairing `ratified-as:` fields inside of.
  test('R13.2: contains the absolute path of answers.md, never a bare name', () => {
    const rendered = renderBrief('ratify', fixtureRatifyFacts({ answersPath: '/tmp/campaign-home/answers.md' }));
    expect(rendered).toContain('/tmp/campaign-home/answers.md');
  });
});

describe('renderBrief — closing', () => {
  test("contains Stage D's four numbered steps, byte-identical to SKILL.md", () => {
    const rendered = renderBrief('closing', fixtureClosingFacts());
    expect(rendered).toContain(STAGE_D_STEP_1);
    expect(rendered).toContain(STAGE_D_STEP_2);
    expect(rendered).toContain(STAGE_D_STEP_3);
    expect(rendered).toContain(STAGE_D_STEP_4);
  });

  test('is deterministic: two renders of the same facts are byte-identical', () => {
    const facts = fixtureClosingFacts();
    expect(renderBrief('closing', facts)).toBe(renderBrief('closing', facts));
  });

  // Task 10 (spec §4c): the closing brief must name the per-card verdict path AND the exact
  // command, and state the oracle — the verdict FILE the script writes is the contract, the
  // session's own prose is not.
  test('names each shipped card\'s verdict-file path and its --verdict-out command', () => {
    const rendered = renderBrief('closing', fixtureClosingFacts({
      shippedVerdicts: [
        { cardId: 'widget-export', verdictPath: '/th/campaigns/wc/supervisor/verdicts/widget-export.json' },
      ],
    }));
    expect(rendered).toContain('/th/campaigns/wc/supervisor/verdicts/widget-export.json');
    expect(rendered).toContain('--card widget-export');
    expect(rendered).toContain('--verdict-out');
    expect(rendered).toContain('resolve-verify-shipped.sh');
    // The command creates its OWN output dir — verify-shipped.sh refuses (never creates) a
    // missing --verdict-out dir, so a closing session run against a bare home would otherwise
    // die before writing the verdict the supervisor reads.
    expect(rendered).toContain('mkdir -p "/th/campaigns/wc/supervisor/verdicts"');
  });

  test('states the oracle: the verdict file is the contract, the prose is not', () => {
    const rendered = renderBrief('closing', fixtureClosingFacts());
    expect(rendered.toLowerCase()).toContain('the verdict file');
    expect(rendered.toLowerCase()).toContain('not');
  });
});

describe('renderBrief — kind/facts mismatch fails closed', () => {
  test('throws rather than silently rendering the wrong kind', () => {
    expect(() => renderBrief('closing', fixtureRulingFacts())).toThrow();
  });
});
