import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSessionSignals } from './signals.ts';

const FIXTURES = join(import.meta.dir, '..', '..', 'fixtures', 'watchdog');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

describe('parseSessionSignals — against real captured logs', () => {
  test('the real killed log yields the quota signal with its epoch resetsAt', () => {
    const got = parseSessionSignals(read('quota-real-429.log'));
    expect(got.quota).toEqual({ resetsAtEpochS: 1788392400 });
    expect(got.overload).toBe(null);
    expect(got.lastResultIsError).toBe(true);
  });

  test('allowed and allowed_warning are not quota deaths', () => {
    const got = parseSessionSignals(read('allowed-and-warning.log'));
    expect(got.quota).toBe(null);
    expect(got.overload).toBe(null);
  });

  test('the 529 result line is an overload signal, and not a quota signal', () => {
    const got = parseSessionSignals(read('overload-529.log'));
    expect(got.overload).toEqual({ apiErrorStatus: 529 });
    expect(got.quota).toBe(null);
  });

  test('a 429 is never an overload signal (W-P3)', () => {
    const got = parseSessionSignals(read('quota-real-429.log'));
    expect(got.overload).toBe(null);
  });

  test('last line wins: rejected then allowed means the session recovered', () => {
    const tail = `${read('quota-real-429.log').trim()}\n${read('allowed-and-warning.log').trim()}\n`;
    expect(parseSessionSignals(tail).quota).toBe(null);
  });

  test('a rejected event with no 429 result is still a quota signal (W-P3)', () => {
    const rejected = read('quota-real-429.log')
      .split('\n')
      .filter((l) => l.includes('"type":"rate_limit_event"'))
      .join('\n');
    expect(parseSessionSignals(rejected).quota).toEqual({ resetsAtEpochS: 1788392400 });
  });

  test('a truncated first line (byte-bounded tail) is skipped, never thrown', () => {
    const full = read('quota-real-429.log');
    const tail = full.slice(200); // mid-JSON cut, exactly what a byte tail produces
    expect(() => parseSessionSignals(tail)).not.toThrow();
    expect(parseSessionSignals(tail).quota).toEqual({ resetsAtEpochS: 1788392400 });
  });

  test('a rejected event with a non-numeric resetsAt is no signal', () => {
    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: null },
    });
    expect(parseSessionSignals(line).quota).toBe(null);
  });

  test('empty input and pure noise are no signal, and never throw', () => {
    for (const input of ['', '\n\n', 'not json at all\n{"unclosed":\n']) {
      expect(parseSessionSignals(input)).toEqual({
        quota: null, overload: null, lastResultIsError: false,
      });
    }
  });

  test('a truncated FINAL line surfaces finalLineUnparseable, and quota is not silently ' +
    'reported as clear (F3)', () => {
    const lines = read('quota-real-429.log').trim().split('\n');
    const rejectedIdx = lines.findIndex((l) => l.includes('"type":"rate_limit_event"'));
    const rejectedLine = lines[rejectedIdx] as string;
    const truncated = rejectedLine.slice(0, 60); // byte-bounded tail cut mid-JSON, at the END
    const tail = [...lines.slice(0, rejectedIdx), truncated].join('\n');
    const got = parseSessionSignals(tail);
    expect(got.finalLineUnparseable).toBe(true);
    expect(got.quota).toBe(null);
  });

  test('a truncated FINAL line is caught even at a very short prefix, not just past the ' +
    'first ~25 bytes of the type token (F3b)', () => {
    const lines = read('quota-real-429.log').trim().split('\n');
    const rejectedIdx = lines.findIndex((l) => l.includes('"type":"rate_limit_event"'));
    const rejectedLine = lines[rejectedIdx] as string;
    for (const n of [1, 5, 10, 15, 25, 26, 30]) {
      const truncated = rejectedLine.slice(0, n);
      const tail = [...lines.slice(0, rejectedIdx), truncated].join('\n');
      expect(parseSessionSignals(tail).finalLineUnparseable).toBe(true);
    }
  });

  test('pure noise as the final line is still never flagged, however short (F3b guard)', () => {
    const lines = ['{"type":"result","is_error":false}', '{"unclosed":'];
    expect(parseSessionSignals(lines.join('\n')).finalLineUnparseable).toBeUndefined();
  });

  test('every 5xx overload status is recognized, 429 excluded', () => {
    for (const status of [500, 502, 503, 504, 529]) {
      const line = JSON.stringify({ type: 'result', is_error: true, api_error_status: status });
      expect(parseSessionSignals(line).overload).toEqual({ apiErrorStatus: status });
    }
    const line429 = JSON.stringify({ type: 'result', is_error: true, api_error_status: 429 });
    expect(parseSessionSignals(line429).overload).toBe(null);
  });
});

describe('parseSessionSignals — a permanent API error (card runner-model-support, G3)', () => {
  const EXECUTOR_FIXTURES = join(import.meta.dir, '..', '..', 'fixtures', 'executor');
  const tooOld = readFileSync(join(EXECUTOR_FIXTURES, 'result-claude-code-version-too-old.json'), 'utf8');
  const notFound = readFileSync(join(EXECUTOR_FIXTURES, 'result-model-not-found-404.json'), 'utf8');

  test('the real 2026-10-01 result line is a permanent API error, and neither quota nor overload', () => {
    const got = parseSessionSignals(tooOld);
    expect(got.permanentApiError).toEqual({ status: 400, code: 'claude_code_version_too_old' });
    expect(got.quota).toBe(null);
    expect(got.overload).toBe(null);
    expect(got.lastResultIsError).toBe(true);
  });
  test('an unknown-model 404 carries no code, so no permanent API error', () => {
    expect(parseSessionSignals(notFound).permanentApiError).toBeUndefined();
  });
  test('last result wins: a permanent error followed by a clean result is no longer permanent', () => {
    const clean = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'TASK_DONE T1 b' });
    expect(parseSessionSignals(`${tooOld.trim()}\n${clean}\n`).permanentApiError).toBeUndefined();
  });
});
