import { describe, expect, test } from 'bun:test';
import { classifyLine } from './parse.ts';

describe('classifyLine (pure, Oracle: fail-closed-edges.md)', () => {
  test('a blank line is its own case, never a skip', () => {
    expect(classifyLine('', 1)).toEqual({ kind: 'blank' });
  });

  test('malformed JSON is counted and skipped with the CLOSED "invalid_json" code, carrying the line number, never a throw', () => {
    const got = classifyLine('{not json', 2);
    expect(got.kind).toBe('skip');
    expect(got.kind === 'skip' && got.reason).toBe('invalid_json');
    expect(got.kind === 'skip' && got.line).toBe(2);
  });

  test('a bare JSON array is counted and skipped with the CLOSED "not_object" code — not a transcript row', () => {
    const got = classifyLine('[1,2,3]', 3);
    expect(got.kind).toBe('skip');
    expect(got.kind === 'skip' && got.reason).toBe('not_object');
    expect(got.kind === 'skip' && got.line).toBe(3);
  });

  test('a JSON primitive (not an object) is counted and skipped with "not_object"', () => {
    for (const [raw, lineNo] of [['"hello"', 4], ['42', 5], ['null', 6]] as const) {
      const got = classifyLine(raw, lineNo);
      expect(got.kind).toBe('skip');
      expect(got.kind === 'skip' && got.reason).toBe('not_object');
    }
  });

  test('the skip reason never embeds parser exception text or transcript bytes (fail-closed-edges.md)', () => {
    const got = classifyLine('{not json, "secret":"leak-me"', 9);
    expect(got.kind).toBe('skip');
    expect(got.kind === 'skip' && got.reason).toBe('invalid_json'); // closed code, not the SyntaxError message
  });

  test('a valid JSON object is a row, verbatim', () => {
    const got = classifyLine('{"type":"assistant","message":{"id":"a"}}', 7);
    expect(got).toEqual({ kind: 'row', value: { type: 'assistant', message: { id: 'a' } } });
  });
});
