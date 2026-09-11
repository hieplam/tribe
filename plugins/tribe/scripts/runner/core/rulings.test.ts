// Tests for rulings.ts: parsing answers.md into ruling blocks and classifying which ones
// are unratified. See rulings.ts's header for the pure-core contract this enforces.
import { describe, expect, test } from 'bun:test';
import { isRulingRatified, parseRulings, unratifiedRulingIds } from './rulings.ts';

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

describe('isRulingRatified — vocabulary classification', () => {
  test('null (field absent) -> not ratified', () => {
    expect(isRulingRatified(null)).toBe(false);
  });

  test('"pending" (explicit) -> not ratified', () => {
    expect(isRulingRatified('pending')).toBe(false);
    expect(isRulingRatified('Pending')).toBe(false);
  });

  test('unrecognized free text -> not ratified (strict by design)', () => {
    expect(isRulingRatified('TBD')).toBe(false);
    expect(isRulingRatified('will decide later')).toBe(false);
  });

  test('empty string (field present, no value) -> not ratified', () => {
    expect(isRulingRatified('')).toBe(false);
  });

  test.each([
    'rule plugins/tribe/rules/foo.md',
    'debt D12',
    'roadmap R3',
    'operational',
    'dismissed',
  ])('recognized vocabulary "%s" -> ratified', (value) => {
    expect(isRulingRatified(value)).toBe(true);
  });

  test('vocabulary words are case-insensitive: "Rule foo.md", "DEBT D1", "Operational"', () => {
    expect(isRulingRatified('Rule foo.md')).toBe(true);
    expect(isRulingRatified('DEBT D1')).toBe(true);
    expect(isRulingRatified('Operational')).toBe(true);
  });

  test('"rule" / "debt" / "roadmap" with no argument -> not ratified', () => {
    expect(isRulingRatified('rule')).toBe(false);
    expect(isRulingRatified('debt')).toBe(false);
    expect(isRulingRatified('roadmap')).toBe(false);
  });
});

describe('unratifiedRulingIds', () => {
  test('null/undefined/empty content -> zero unratified rulings', () => {
    expect(unratifiedRulingIds(null)).toEqual([]);
    expect(unratifiedRulingIds(undefined)).toEqual([]);
    expect(unratifiedRulingIds('')).toEqual([]);
  });

  test('content with rulings but no headings at all -> zero unratified rulings', () => {
    expect(unratifiedRulingIds('# answers\n(none yet)\n')).toEqual([]);
  });

  test('a mix: only the unratified/missing/unrecognized ids are returned, in document order', () => {
    const content = [
      '## R1 — Ratified via rule',
      'ratified-as: rule plugins/tribe/rules/foo.md',
      '',
      '## R2 — Still pending',
      'ratified-as: pending',
      '',
      '## R3 — No field at all',
      'no ratified-as line here',
      '',
      '## R4 — Ratified via debt',
      '- **ratified-as:** debt D9',
      '',
      '## R5 — Unrecognized value',
      'ratified-as: TBD',
    ].join('\n');
    expect(unratifiedRulingIds(content)).toEqual(['R2 — Still pending', 'R3 — No field at all', 'R5 — Unrecognized value']);
  });

  test('every ruling ratified -> empty list', () => {
    const content = [
      '## R1 — a',
      'ratified-as: operational',
      '## R2 — b',
      'ratified-as: dismissed',
    ].join('\n');
    expect(unratifiedRulingIds(content)).toEqual([]);
  });
});

describe('isRulingRatified — a gap id may ride the ratified value (spec §5)', () => {
  test('a rule disposition with a trailing (G-NNN) is ratified', () => {
    expect(isRulingRatified('rule plugins/tribe/rules/no-unbounded-pools.md (G-052)')).toBe(true);
  });

  test('a debt disposition with a trailing (G-NNN) is ratified', () => {
    expect(isRulingRatified('debt debt-idle-conn-no-timeout (G-053)')).toBe(true);
  });

  test('a roadmap disposition with a trailing (G-NNN) is ratified', () => {
    expect(isRulingRatified('roadmap ROADMAP.md#i74 (G-054)')).toBe(true);
  });

  test('a bare operational/dismissed value may carry an id too', () => {
    expect(isRulingRatified('operational (G-055)')).toBe(true);
    expect(isRulingRatified('dismissed (G-056)')).toBe(true);
  });

  test('pending stays unratified even with an id — the explicit spelling of not-yet', () => {
    expect(isRulingRatified('pending (G-057)')).toBe(false);
  });

  test('a malformed id suffix is still free text, and free text is unratified', () => {
    expect(isRulingRatified('rule x.md (G-)')).toBe(false);
    expect(isRulingRatified('rule x.md G-052')).toBe(false);
    expect(isRulingRatified('rule x.md (052)')).toBe(false);
  });

  test('the no-id forms are unchanged', () => {
    expect(isRulingRatified('rule plugins/tribe/rules/x.md')).toBe(true);
    expect(isRulingRatified('operational')).toBe(true);
    expect(isRulingRatified('pending')).toBe(false);
    expect(isRulingRatified('')).toBe(false);
    expect(isRulingRatified(null)).toBe(false);
  });
});
