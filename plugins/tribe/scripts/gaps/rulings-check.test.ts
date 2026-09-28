// Tests for rulings-check.ts: the ratification classification of answers.md rulings (moved
// verbatim from runner/core/rulings.test.ts) and the CLI a Tribe-style closing task runs.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRulingRatified, unratifiedRulingIds } from './rulings-check.ts';

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

test('CLI: exit 1 naming every unratified id; exit 0 when all are ratified; exit 2 on a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-'));
  try {
    const f = join(dir, 'answers.md');
    writeFileSync(f, '## R1 — a\n\nratified-as: operational\n\n## R2 — b\n\nno disposition\n');
    const bad = spawnSync('bun', [join(import.meta.dir, 'rulings-check.ts'), f], { encoding: 'utf8', timeout: 30_000 });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('R2 — b');
    writeFileSync(f, '## R1 — a\n\nratified-as: operational\n');
    expect(spawnSync('bun', [join(import.meta.dir, 'rulings-check.ts'), f], { encoding: 'utf8', timeout: 30_000 }).status).toBe(0);
    expect(spawnSync('bun', [join(import.meta.dir, 'rulings-check.ts'), join(dir, 'missing.md')], { encoding: 'utf8', timeout: 30_000 }).status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
