import { describe, expect, test } from 'bun:test';
import { parseTranscriptMetricsArgs } from './args.ts';

describe('parseTranscriptMetricsArgs', () => {
  test('a single --session is accepted, --project/--cut-bytes/--verify default to null, --json defaults false', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'abc']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.sessions).toEqual(['abc']);
    expect(got.config.project).toBe(null);
    expect(got.config.cutBytes).toBe(null);
    expect(got.config.verifyPath).toBe(null);
    expect(got.config.json).toBe(false);
  });

  test('--session is repeatable, in argv order', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'a', '--session', 'b', '--session', 'c']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.sessions).toEqual(['a', 'b', 'c']);
  });

  test('neither --session nor --verify is a missing-required-flag error, named', () => {
    const got = parseTranscriptMetricsArgs([]);
    expect('error' in got && got.error).toBe('missing required flag: --session (or --verify)');
  });

  test('--session and --verify are mutually exclusive', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'a', '--verify', '/tmp/baseline.json']);
    expect('error' in got && got.error).toBe('--session and --verify are mutually exclusive');
  });

  test('--verify alone is valid, no --session required', () => {
    const got = parseTranscriptMetricsArgs(['--verify', '/tmp/baseline.json']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.verifyPath).toBe('/tmp/baseline.json');
    expect(got.config.sessions).toEqual([]);
  });

  test('--json is a boolean presence flag', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'a', '--json']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.json).toBe(true);
  });

  test('--project is carried verbatim', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'a', '--project', 'my-proj']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.project).toBe('my-proj');
  });

  test('--cut-bytes accepts a positive integer', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'a', '--cut-bytes', '4096']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.cutBytes).toBe(4096);
  });

  test('--cut-bytes rejects zero, negative, and out-of-bound values by name', () => {
    for (const bad of ['0', '-1', '99999999999']) {
      const got = parseTranscriptMetricsArgs(['--session', 'a', '--cut-bytes', bad]);
      expect('error' in got && got.error.startsWith('--cut-bytes:')).toBe(true);
    }
  });

  test('--cut-bytes rejects a non-integer-literal string: empty, hex, scientific, padded (F2)', () => {
    for (const bad of ['', '0x10', '3e1', ' 5 ']) {
      const got = parseTranscriptMetricsArgs(['--session', 'a', '--cut-bytes', bad]);
      expect('error' in got && got.error.startsWith('--cut-bytes:')).toBe(true);
    }
  });

  test('an unknown flag is rejected by name, never ignored', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'a', '--bogus']);
    expect('error' in got && got.error).toBe('unknown flag: --bogus');
  });

  test('a value flag with no value is rejected', () => {
    const got = parseTranscriptMetricsArgs(['--session']);
    expect('error' in got && got.error).toBe('--session requires a value');
  });

  test('a value flag refuses a flag-shaped value instead of swallowing it (F1)', () => {
    const got = parseTranscriptMetricsArgs(['--session', '--json']);
    expect('error' in got && got.error).toBe('--session requires a value, got flag "--json"');
  });

  test('a stray positional token is rejected, never silently dropped', () => {
    const got = parseTranscriptMetricsArgs(['--session', 'a', 'stray']);
    expect('error' in got && got.error).toBe('unexpected argument: stray');
  });
});
