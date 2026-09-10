// gap-stamp.test.ts — the stamp line and the PR-body section (card C1, spec §2 step 6).
// The CANONICAL literal below is the same one runner/core/verify.ts and verify-shipped.sh test
// against; the three readers of this wire format are pinned to one example on purpose.
import { describe, expect, test } from 'bun:test';
import { formatStamp, parseStamp, renderGapSection, type StampFields } from './gap-stamp.ts';

const CANONICAL =
  '<!-- gap-gate v1 card=gap-gate-scripts base=aaaa111 head=bbbb222 minted=G-004,G-005 ' +
  'matched=G-001 debt-delta=0 ledger=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->';

const FIELDS: StampFields = {
  card: 'gap-gate-scripts',
  base: 'aaaa111',
  head: 'bbbb222',
  minted: ['G-004', 'G-005'],
  matched: ['G-001'],
  debtDelta: 0,
  ledger: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

describe('formatStamp', () => {
  test('renders the spec §2 step 6 line byte-for-byte', () => {
    expect(formatStamp(FIELDS)).toBe(CANONICAL);
  });

  test('an empty id list renders as none, never as an empty value', () => {
    const line = formatStamp({ ...FIELDS, minted: [], matched: [] });
    expect(line).toContain('minted=none matched=none');
    expect(line).not.toContain('minted= ');
  });

  test('a negative debt delta and an absent ledger both render', () => {
    expect(formatStamp({ ...FIELDS, debtDelta: -3, ledger: 'none' })).toContain('debt-delta=-3 ledger=none');
  });
});

describe('parseStamp', () => {
  test('round-trips the canonical line', () => {
    expect(parseStamp(CANONICAL)).toEqual(FIELDS);
  });

  test('finds the stamp inside a full PR body', () => {
    const body = `## Why\n\ntext\n\n## Harness gaps\n\n- matched: G-001\n\n${CANONICAL}\n\nmore text\n`;
    expect(parseStamp(body)?.card).toBe('gap-gate-scripts');
  });

  test('none round-trips back to an empty list', () => {
    const parsed = parseStamp(formatStamp({ ...FIELDS, minted: [], matched: [] }));
    expect(parsed?.minted).toEqual([]);
    expect(parsed?.matched).toEqual([]);
  });

  test('a body with no stamp, and a truncated stamp, both parse to null', () => {
    expect(parseStamp('## Harness gaps\n\nnothing here\n')).toBeNull();
    expect(parseStamp('<!-- gap-gate v1 card=x base=y -->')).toBeNull();
  });

  test('a stamp written with no space before the closing delimiter still parses', () => {
    const tight = CANONICAL.replace(' -->', '-->');
    expect(parseStamp(tight)?.ledger).toBe(FIELDS.ledger);
  });
});

describe('renderGapSection', () => {
  const base = {
    matched: ['G-001'],
    minted: [] as string[],
    suppressedCount: 0,
    flagged: [] as string[],
    openIds: ['G-001'],
    unparsed: [] as Array<{ file: string; line: number; reason: string }>,
    debtDelta: 0,
    stamp: CANONICAL,
  };

  test('renders the frozen shape and ends with the stamp', () => {
    const md = renderGapSection(base);
    expect(md.startsWith('## Harness gaps\n')).toBe(true);
    expect(md).toContain('- matched: G-001\n');
    expect(md).toContain('- minted: none\n');
    expect(md).toContain('- suppressed: 0\n');
    expect(md).toContain('- flagged fingerprints: none\n');
    expect(md).toContain('- open ids awaiting adjudication: G-001\n');
    expect(md).toContain('- unparsed HG-candidate blocks: none\n');
    expect(md).toContain('- proposals: pending Scout adjudication\n');
    expect(md.trimEnd().endsWith(CANONICAL)).toBe(true);
  });

  test('a zero debt delta adds no burn-down line at all', () => {
    expect(renderGapSection(base)).not.toContain('debt burn-down');
  });

  test('a negative delta becomes exactly one burn-note line', () => {
    const md = renderGapSection({ ...base, debtDelta: -2 });
    expect(md).toContain('- debt burn-down: net 2 fewer hit(s) than base\n');
  });

  test('a positive delta says the gate is red', () => {
    expect(renderGapSection({ ...base, debtDelta: 3 })).toContain(
      '- debt burn-down: net 3 MORE hit(s) than base — gate red\n',
    );
  });

  test('unparsed blocks are listed one sub-bullet each', () => {
    const md = renderGapSection({
      ...base,
      unparsed: [{ file: 'tracker-C1-final.md', line: 12, reason: 'no Evidence command' }],
    });
    expect(md).toContain('- unparsed HG-candidate blocks: 1\n');
    expect(md).toContain('  - tracker-C1-final.md:12 — no Evidence command\n');
  });
});
