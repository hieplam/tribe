// gap-candidates.test.ts — the pure Tracker-report parser (card C1, spec §2 step 2).
// Fixtures are the three REAL report shapes of the plan's F4, verbatim: the tracker.md step-5
// template (shape A, also the shape of reports/C1.md:323-337), the bold-header inline form
// (shape B, session 56af20da), and the heading-prefixed em-dash form with a non-grep evidence
// command (shape C, session 93fe0a83).
import { describe, expect, test } from 'bun:test';
import { dedupeCandidates, parseTrackerReport } from './gap-candidates.ts';

const SHAPE_A = [
  'HG-candidate 1  [input-validation]  diff FOLLOWS an undocumented pattern',
  '  Pattern:    `JSON.parse(input).value as string` is a compile-time type assertion, not a',
  '              runtime check. If `input` parses as valid JSON but has no `value` field, no',
  '              exception is thrown and the fallback is never reached.',
  '  Evidence:   `grep -rn "as string" src/` → 4 hits in 4 files (`src/loader.ts:4`,',
  '              `src/parser.ts:4`, `src/reader.ts:4`, `src/writer.ts:4`)',
  '  Diff link:  `src/reader.ts:4` repeats it (copied from `src/loader.ts:4`)',
  '  Not judged: this is a gap in the rule set, not a violation',
  '',
  '+0 more suppressed (only one HG candidate met all four conditions this run)',
].join('\n');

const SHAPE_B =
  '**HG-candidate 1 [error-handling]** — bare catch { } blocks that collapse multiple distinct ' +
  'failure modes into one silent sentinel, e.g. plugins/explaining/skills/explaining/scripts/' +
  'validate-mermaid.ts:180,190,285,314,325. Confirmed via grep -rn "catch {" plugins/ → 10 ' +
  'non-test files / 22 occurrences repo-wide.';

const SHAPE_C = [
  '### Harness gaps',
  'HG-candidate 1 [test-presence] — every file under runner/adapters/ ships with no dedicated',
  '*.test.ts. Evidence: for f in adapters/*.ts; do [ -f "${f%.ts}.test.ts" ]; done → 5 hits in 5 files',
].join('\n');

describe('parseTrackerReport', () => {
  test('shape A maps every field of spec §2 step 2', () => {
    const { candidates, unparsed } = parseTrackerReport(SHAPE_A, 'tracker-C1-final.md', 'final');
    expect(unparsed).toEqual([]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.category).toBe('input-validation');
    expect(c.fingerprint).toBe('grep -rn "as string" src/');
    expect(c.hits).toBe(4);
    expect(c.paths).toEqual(['src/reader.ts', 'src/loader.ts']);
    expect(c.description).toContain('compile-time type assertion');
    expect(c.round).toBe('final');
    expect(c.sourceFile).toBe('tracker-C1-final.md');
    expect(c.sourceLine).toBe(1);
  });

  test('shape B (bold header, inline Evidence, no Diff link) still parses', () => {
    const { candidates, unparsed } = parseTrackerReport(SHAPE_B, 'tracker-C1-task-5.md', 'task-5');
    expect(unparsed).toEqual([]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.category).toBe('error-handling');
    expect(c.fingerprint).toBe('grep -rn "catch {" plugins/');
    expect(c.hits).toBe(10);
    expect(c.paths).toContain('plugins/explaining/skills/explaining/scripts/validate-mermaid.ts');
  });

  test('shape C parses, and its non-grep fingerprint is preserved verbatim for the gate to flag', () => {
    const { candidates, unparsed } = parseTrackerReport(SHAPE_C, 'tracker-C1-wave-2.md', 'wave-2');
    expect(unparsed).toEqual([]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.category).toBe('test-presence');
    expect(c.hits).toBe(5);
    expect(c.fingerprint.startsWith('for f in adapters/*.ts')).toBe(true);
    expect(c.paths).toContain('runner/adapters/');
  });

  test('a header block with no Evidence is reported under unparsed, never dropped and never thrown', () => {
    const text = 'HG-candidate 1  [concurrency-async]  diff FOLLOWS an undocumented pattern\n  Pattern: fire and forget\n';
    const { candidates, unparsed } = parseTrackerReport(text, 'tracker-C1-final.md', 'final');
    expect(candidates).toEqual([]);
    expect(unparsed).toEqual([
      { file: 'tracker-C1-final.md', line: 1, reason: 'no Evidence command', excerpt: expect.any(String) },
    ]);
  });

  test('a header block whose Evidence names no path is reported under unparsed', () => {
    const text = 'HG-candidate 1 [error-handling] — Evidence: `grep -rn "catch" .` → 3 hits in 3 files\n';
    const { unparsed } = parseTrackerReport(text, 'tracker-C1-final.md', 'final');
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]!.reason).toBe('no path in Diff link or block body');
  });

  test('two candidates in one report are both returned, with their own header line numbers', () => {
    const text = `${SHAPE_A}\n\n${SHAPE_B}\n`;
    const { candidates } = parseTrackerReport(text, 'tracker-C1-final.md', 'final');
    expect(candidates).toHaveLength(2);
    expect(candidates[1]!.sourceLine).toBeGreaterThan(candidates[0]!.sourceLine);
  });

  test('a report with no HG-candidate block parses to nothing at all', () => {
    expect(parseTrackerReport('## Review\nVerdict: APPROVE\n', 'tracker-C1-final.md', 'final')).toEqual({
      candidates: [],
      unparsed: [],
    });
  });
});

describe('dedupeCandidates', () => {
  test('same category + overlapping paths collapse to the earliest round, keeping its fingerprint', () => {
    const a = parseTrackerReport(SHAPE_A, 'tracker-C1-task-3.md', 'task-3').candidates;
    const later = parseTrackerReport(
      SHAPE_A.replace('grep -rn "as string" src/', 'grep -rn "as string" src/reader.ts'),
      'tracker-C1-final.md',
      'final',
    ).candidates;
    const kept = dedupeCandidates([...a, ...later], ['task-3', 'final']);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.round).toBe('task-3');
    expect(kept[0]!.fingerprint).toBe('grep -rn "as string" src/');
  });

  test('same category but disjoint paths are two distinct candidates', () => {
    const one = parseTrackerReport(SHAPE_A, 'tracker-C1-task-3.md', 'task-3').candidates;
    const two = parseTrackerReport(
      SHAPE_A.replace(/src\//g, 'lib/').replace(/src/g, 'lib'),
      'tracker-C1-final.md',
      'final',
    ).candidates;
    expect(dedupeCandidates([...one, ...two], ['task-3', 'final'])).toHaveLength(2);
  });

  test('different categories over the same paths never collapse', () => {
    const one = parseTrackerReport(SHAPE_A, 'tracker-C1-task-3.md', 'task-3').candidates;
    const two = parseTrackerReport(
      SHAPE_A.replace('[input-validation]', '[error-handling]'),
      'tracker-C1-final.md',
      'final',
    ).candidates;
    expect(dedupeCandidates([...one, ...two], ['task-3', 'final'])).toHaveLength(2);
  });
});
