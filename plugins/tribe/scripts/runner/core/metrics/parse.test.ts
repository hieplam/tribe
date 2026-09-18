import { describe, expect, test } from 'bun:test';
import { classifyLine } from './parse.ts';

describe('classifyLine (pure, Oracle: fail-closed-edges.md)', () => {
  test('a blank line is its own case, never a skip', () => {
    expect(classifyLine('', 1)).toEqual({ kind: 'blank' });
  });

  test('malformed JSON is counted and skipped with a typed reason naming the line, never a throw', () => {
    const got = classifyLine('{not json', 2);
    expect(got.kind).toBe('skip');
    expect(got.kind === 'skip' && got.reason).toContain('line 2');
    expect(got.kind === 'skip' && got.reason).toContain('invalid JSON');
  });

  test('a bare JSON array is counted and skipped — not a transcript row', () => {
    const got = classifyLine('[1,2,3]', 3);
    expect(got.kind).toBe('skip');
    expect(got.kind === 'skip' && got.reason).toContain('not a JSON object');
  });

  test('a JSON primitive (not an object) is counted and skipped', () => {
    expect(classifyLine('"hello"', 4).kind).toBe('skip');
    expect(classifyLine('42', 5).kind).toBe('skip');
    expect(classifyLine('null', 6).kind).toBe('skip');
  });

  test('a valid JSON object is a row, verbatim', () => {
    const got = classifyLine('{"type":"assistant","message":{"id":"a"}}', 7);
    expect(got).toEqual({ kind: 'row', value: { type: 'assistant', message: { id: 'a' } } });
  });
});
