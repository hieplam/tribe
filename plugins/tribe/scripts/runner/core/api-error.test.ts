import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMANENT_API_ERROR_CODES, permanentApiErrorOf } from './api-error.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'executor');
const line = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

describe('permanentApiErrorOf — against real captured result lines', () => {
  test('the 2026-10-01 campaign result line is a permanent API error, code and status kept', () => {
    expect(permanentApiErrorOf(line('result-claude-code-version-too-old.json'))).toEqual({
      status: 400,
      code: 'claude_code_version_too_old',
      text: "API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.",
    });
  });
  test('an unknown model (HTTP 404, no api_error_code) is not on the allowlist', () => {
    expect(permanentApiErrorOf(line('result-model-not-found-404.json'))).toBe(null);
  });
  test('the allowlist holds exactly the observed code', () => {
    expect([...PERMANENT_API_ERROR_CODES]).toEqual(['claude_code_version_too_old']);
  });
});

describe('permanentApiErrorOf — every other shape is not permanent', () => {
  const tooOld = line('result-claude-code-version-too-old.json');
  test.each([
    ['a successful result', { type: 'result', subtype: 'success', is_error: false, result: 'OK' }],
    ['is_error is not exactly true', { ...tooOld, is_error: 'true' }],
    ['a code that is not on the allowlist', { ...tooOld, api_error_code: 'rate_limit_error' }],
    ['a non-string code', { ...tooOld, api_error_code: 400 }],
    ['not a result message', { ...tooOld, type: 'assistant' }],
  ])('%s -> null', (_name, message) => {
    expect(permanentApiErrorOf(message as Record<string, unknown>)).toBe(null);
  });
});
