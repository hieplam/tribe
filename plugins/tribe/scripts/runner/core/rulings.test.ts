// Tests for rulings.ts: parsing answers.md into ruling blocks. The ratification classification
// and its tests live on the Tribe side, in plugins/tribe/scripts/gaps/rulings-check.test.ts.
import { describe, expect, test } from 'bun:test';
import { parseRulings } from './rulings.ts';

describe('parseRulings — block boundaries', () => {
  test('null/undefined/empty content -> zero blocks', () => {
    expect(parseRulings(null)).toEqual([]);
    expect(parseRulings(undefined)).toEqual([]);
    expect(parseRulings('')).toEqual([]);
  });

  test('content with no `## ` heading -> zero blocks (a bare `# ` title does not count)', () => {
    expect(parseRulings('# answers\n(none yet)\n')).toEqual([]);
  });

  test('one heading, no ratified-as line -> one block, ratifiedAs null', () => {
    expect(parseRulings('## R1 — Some title\n\nSome prose.\n')).toEqual([
      { id: 'R1 — Some title', ratifiedAs: null },
    ]);
  });

  test('two headings -> two blocks, each keyed by its own heading text', () => {
    const content = [
      '## R1 — First',
      '',
      'prose',
      '',
      '## R2 — Second',
      '',
      'more prose',
      '',
    ].join('\n');
    expect(parseRulings(content)).toEqual([
      { id: 'R1 — First', ratifiedAs: null },
      { id: 'R2 — Second', ratifiedAs: null },
    ]);
  });

  test('a plain `## ` heading (not the R<n> convention) still starts a block', () => {
    expect(parseRulings('## Use snake_case for CLI flags\n')).toEqual([
      { id: 'Use snake_case for CLI flags', ratifiedAs: null },
    ]);
  });
});

describe('parseRulings — ratified-as extraction', () => {
  test('plain, no bullet: "ratified-as: rule <path>"', () => {
    const content = '## R1 — Title\n\nratified-as: rule plugins/tribe/rules/foo.md\n';
    expect(parseRulings(content)).toEqual([
      { id: 'R1 — Title', ratifiedAs: 'rule plugins/tribe/rules/foo.md' },
    ]);
  });

  test('dash-bullet: "- ratified-as: debt D12"', () => {
    const content = '## R1 — Title\n\n- ratified-as: debt D12\n';
    expect(parseRulings(content)[0]).toEqual({ id: 'R1 — Title', ratifiedAs: 'debt D12' });
  });

  test('star-bullet: "* ratified-as: roadmap R3"', () => {
    const content = '## R1 — Title\n\n* ratified-as: roadmap R3\n';
    expect(parseRulings(content)[0]).toEqual({ id: 'R1 — Title', ratifiedAs: 'roadmap R3' });
  });

  test('bold key with colon inside the bold span: "- **ratified-as:** operational"', () => {
    const content = '## R1 — Title\n\n- **ratified-as:** operational\n';
    expect(parseRulings(content)[0]).toEqual({ id: 'R1 — Title', ratifiedAs: 'operational' });
  });

  test('bold key with colon outside the bold span: "**Ratified-As**: dismissed"', () => {
    const content = '## R1 — Title\n\n**Ratified-As**: dismissed\n';
    expect(parseRulings(content)[0]).toEqual({ id: 'R1 — Title', ratifiedAs: 'dismissed' });
  });

  test('case-insensitive key match: "RATIFIED-AS: pending"', () => {
    const content = '## R1 — Title\n\nRATIFIED-AS: pending\n';
    expect(parseRulings(content)[0]).toEqual({ id: 'R1 — Title', ratifiedAs: 'pending' });
  });

  test('first ratified-as line in a block wins; later ones in the same block are ignored', () => {
    const content = '## R1 — Title\n\nratified-as: rule a.md\nratified-as: debt D1\n';
    expect(parseRulings(content)[0]).toEqual({ id: 'R1 — Title', ratifiedAs: 'rule a.md' });
  });

  test('a ratified-as line before any heading is ignored (no block to attach to)', () => {
    const content = 'ratified-as: rule a.md\n\n## R1 — Title\n\nprose\n';
    expect(parseRulings(content)).toEqual([{ id: 'R1 — Title', ratifiedAs: null }]);
  });
});
