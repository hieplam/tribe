import { describe, expect, test } from 'bun:test';
import { parseSupervisorArgs, supervisorHomeFromCampaign } from './args.ts';

const REQUIRED = ['--repo', '/repo', '--model', 'opus', '--campaign', 'my-campaign'];

describe('parseSupervisorArgs', () => {
  test('defaults: every budget flag carries its spec §8 default', () => {
    const got = parseSupervisorArgs(REQUIRED);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.repoRoot).toBe('/repo');
    expect(got.config.model).toBe('opus');
    expect(got.config.campaignSlug).toBe('my-campaign');
    expect(got.config.rawHome).toBe(null);
    expect(got.config.watchdogModel).toBe(null);
    expect(got.config.limits).toEqual({
      maxRulingRounds: 2,
      maxRatifyRounds: 2,
      maxSpawns: 8,
      maxWatchdogRuns: 20,
      sessionRetries: 1,
    });
    expect(got.config.sessionTimeoutSeconds).toBe(1800);
    expect(got.config.sessionMaxTurns).toBe(60);
    expect(got.config.pollSeconds).toBe(30);
  });

  test('--campaign and --home are mutually exclusive', () => {
    const got = parseSupervisorArgs([
      '--repo', '/repo', '--model', 'opus', '--campaign', 'slug', '--home', '/h/.tribe/k/campaigns/c',
    ]);
    expect('error' in got && got.error).toBe('--campaign and --home are mutually exclusive');
  });

  test('exactly one of --campaign or --home is required', () => {
    const got = parseSupervisorArgs(['--repo', '/repo', '--model', 'opus']);
    expect('error' in got && got.error).toBe('exactly one of --campaign or --home is required');
  });

  test('--home is accepted as the alternative to --campaign (S-P10)', () => {
    const got = parseSupervisorArgs(['--repo', '/repo', '--model', 'opus', '--home', '/h/.tribe/k/campaigns/c']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.rawHome).toBe('/h/.tribe/k/campaigns/c');
    expect(got.config.campaignSlug).toBe(null);
  });

  test('--repo is required, by name', () => {
    const got = parseSupervisorArgs(['--model', 'opus', '--campaign', 'slug']);
    expect('error' in got && got.error).toBe('missing required flag: --repo');
  });

  test('--model is required, by name', () => {
    const got = parseSupervisorArgs(['--repo', '/repo', '--campaign', 'slug']);
    expect('error' in got && got.error).toBe('missing required flag: --model');
  });

  test('--watchdog-model is carried, off by default', () => {
    const got = parseSupervisorArgs([...REQUIRED, '--watchdog-model', 'sonnet']);
    if ('error' in got) throw new Error(got.error);
    expect(got.config.watchdogModel).toBe('sonnet');
  });

  test('an unknown flag is rejected by name, never ignored', () => {
    const got = parseSupervisorArgs([...REQUIRED, '--dry-run']);
    expect('error' in got && got.error).toBe('unknown flag: --dry-run');
  });

  test('a stray positional token is rejected, never silently dropped', () => {
    const got = parseSupervisorArgs([...REQUIRED, 'stray']);
    expect('error' in got && got.error).toBe('unexpected argument: stray');
  });

  test('a flag with no value at the end of argv is rejected', () => {
    const got = parseSupervisorArgs(['--repo', '/repo', '--model', 'opus', '--campaign']);
    expect('error' in got && got.error).toBe('--campaign requires a value');
  });

  test('a value-taking flag refuses another flag token as its value (F1)', () => {
    const got = parseSupervisorArgs([...REQUIRED, '--max-spawns', '--repo']);
    expect('error' in got && got.error).toBe('--max-spawns requires a value, got flag "--repo"');
  });

  // F5 fix: refusing only KNOWN flag tokens lets an unrecognised `--`-prefixed token slip
  // through as a value — a real value never begins with `--`, so the guard must reject the
  // SHAPE, not a fixed list of names.
  test('a value-taking flag refuses an UNKNOWN --prefixed token as its value, not just a known flag', () => {
    const got = parseSupervisorArgs([...REQUIRED, '--model', '--typo']);
    expect('error' in got && got.error).toBe('--model requires a value, got flag "--typo"');
  });

  test('--repo also refuses an unknown --prefixed token as its value', () => {
    const got = parseSupervisorArgs(['--repo', '--oops', '--model', 'opus', '--campaign', 'slug']);
    expect('error' in got && got.error).toBe('--repo requires a value, got flag "--oops"');
  });

  test('a normal value still parses (not every string is refused)', () => {
    const got = parseSupervisorArgs(REQUIRED);
    expect('error' in got).toBe(false);
  });

  const BOUNDED = [
    ['--max-ruling-rounds', 0, 10, 2],
    ['--max-ratify-rounds', 0, 10, 2],
    ['--max-spawns', 0, 100, 8],
    ['--max-watchdog-runs', 1, 500, 20],
    ['--session-timeout-seconds', 60, 21600, 1800],
    ['--session-max-turns', 1, 500, 60],
    ['--session-retries', 0, 3, 1],
    ['--poll-seconds', 1, 60, 30],
  ] as const;

  for (const [flag, min, max, def] of BOUNDED) {
    test(`${flag}: accepts its lower bound, its upper bound, and defaults to ${def}`, () => {
      const atDefault = parseSupervisorArgs(REQUIRED);
      if ('error' in atDefault) throw new Error(atDefault.error);
      const atMin = parseSupervisorArgs([...REQUIRED, flag, String(min)]);
      const atMax = parseSupervisorArgs([...REQUIRED, flag, String(max)]);
      if ('error' in atMin) throw new Error(atMin.error);
      if ('error' in atMax) throw new Error(atMax.error);
      const camel = flag
        .slice(2)
        .split('-')
        .map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
        .join('');
      const field = ['maxRulingRounds', 'maxRatifyRounds', 'maxSpawns', 'maxWatchdogRuns', 'sessionRetries'].includes(
        camel,
      )
        ? (atMin.config.limits as unknown as Record<string, number>)
        : (atMin.config as unknown as Record<string, number>);
      const fieldMax = ['maxRulingRounds', 'maxRatifyRounds', 'maxSpawns', 'maxWatchdogRuns', 'sessionRetries'].includes(
        camel,
      )
        ? (atMax.config.limits as unknown as Record<string, number>)
        : (atMax.config as unknown as Record<string, number>);
      const fieldDefault = ['maxRulingRounds', 'maxRatifyRounds', 'maxSpawns', 'maxWatchdogRuns', 'sessionRetries'].includes(
        camel,
      )
        ? (atDefault.config.limits as unknown as Record<string, number>)
        : (atDefault.config as unknown as Record<string, number>);
      expect(field[camel]).toBe(min);
      expect(fieldMax[camel]).toBe(max);
      expect(fieldDefault[camel]).toBe(def);
    });

    test(`${flag}: refuses one below its lower bound`, () => {
      const got = parseSupervisorArgs([...REQUIRED, flag, String(min - 1)]);
      expect('error' in got && got.error).toBe(`${flag}: must be between ${min} and ${max}, got "${min - 1}"`);
    });

    test(`${flag}: refuses one above its upper bound`, () => {
      const got = parseSupervisorArgs([...REQUIRED, flag, String(max + 1)]);
      expect('error' in got && got.error).toBe(`${flag}: must be between ${min} and ${max}, got "${max + 1}"`);
    });

    test(`${flag}: refuses a non-integer-literal string (empty, hex, scientific, padded, negative)`, () => {
      for (const bad of ['', '0x10', '3e1', ' 5 ', '-1']) {
        const got = parseSupervisorArgs([...REQUIRED, flag, bad]);
        expect('error' in got && got.error.startsWith(`${flag}:`)).toBe(true);
      }
    });
  }
});

describe('supervisorHomeFromCampaign (pure path math, no fs)', () => {
  test('joins the tribe home, the campaigns dir, and the slug', () => {
    expect(supervisorHomeFromCampaign('/abs/tribe/home', 'slug')).toBe('/abs/tribe/home/campaigns/slug');
  });

  test('normalizes a trailing separator on the tribe home', () => {
    expect(supervisorHomeFromCampaign('/abs/tribe/home/', 'slug')).toBe('/abs/tribe/home/campaigns/slug');
  });
});
