/**
 * Pure CLI parsing for the `supervise` subcommand (spec §10). No I/O, no clock, no ambient env —
 * mirrors `core/watchdog/args.ts`'s contract verbatim: every unknown flag is rejected BY NAME,
 * every required flag has no default, every protocol value carries the spec's own default, and a
 * value-taking flag refuses another flag's token as its value.
 *
 * Resolving `--campaign` to a home requires running `tribe-home.sh` (an fs/subprocess concern) —
 * that is the adapter's job (a later task). This module only produces and validates the *shape*:
 * `--campaign` XOR `--home`, and the pure path math `supervisorHomeFromCampaign`.
 */
import type { SupervisorLimits } from './model.ts';

export interface SupervisorConfig {
  repoRoot: string;
  model: string;
  /** Optional (spec §10): required only once a campaign's own configured value is missing —
   * that check needs to read campaign config (fs), so it is not enforced here. */
  watchdogModel: string | null;
  /** Exactly one of `campaignSlug`/`rawHome` is non-null (mutually exclusive, one required). */
  campaignSlug: string | null;
  /** Exactly as typed on the command line — relative or absolute, resolved/contained by the
   * edge, mirroring `core/watchdog/args.ts`'s `resolveHomeArg`/`containHome`. */
  rawHome: string | null;
  limits: SupervisorLimits;
  sessionTimeoutSeconds: number;
  sessionMaxTurns: number;
  pollSeconds: number;
}

export interface ParseSupervisorArgsResult { config: SupervisorConfig }
export interface ParseSupervisorArgsError { error: string }

const OWN_VALUE_FLAGS = new Set([
  '--repo', '--model', '--watchdog-model', '--campaign', '--home',
  '--max-ruling-rounds', '--max-ratify-rounds', '--max-spawns', '--max-watchdog-runs',
  '--session-timeout-seconds', '--session-max-turns', '--session-retries', '--poll-seconds',
]);

/** Every recognized flag token — used to refuse a value-taking flag being handed another flag's
 * token as its "value" (mirrors watchdog args.ts's audit finding F1): without this,
 * `--max-spawns --repo` would silently swallow `--repo` as the spawn count string. */
const ALL_FLAG_TOKENS = OWN_VALUE_FLAGS;

interface Bound { min: number; max: number }
const BOUNDS: Record<string, Bound> = {
  '--max-ruling-rounds': { min: 0, max: 10 },
  '--max-ratify-rounds': { min: 0, max: 10 },
  '--max-spawns': { min: 0, max: 100 },
  '--max-watchdog-runs': { min: 1, max: 500 },
  '--session-timeout-seconds': { min: 60, max: 21600 },
  '--session-max-turns': { min: 1, max: 500 },
  '--session-retries': { min: 0, max: 3 },
  '--poll-seconds': { min: 1, max: 60 },
};

// A plain non-negative decimal integer literal — no sign, no whitespace, no hex/scientific
// notation, never empty (mirrors watchdog args.ts's audit finding F2: `Number(raw)` alone
// silently coerces "", "0x10", "3e1" and " 5 " into valid integers). Strictness is the
// contract's direction; leniency is the bug.
const INT_LITERAL = /^\d+$/;

function parseBoundedInt(flag: string, raw: string): number | string {
  const bound = BOUNDS[flag] as Bound;
  if (!INT_LITERAL.test(raw)) {
    return `${flag}: must be between ${bound.min} and ${bound.max}, got "${raw}"`;
  }
  const value = Number(raw);
  if (value < bound.min || value > bound.max) {
    return `${flag}: must be between ${bound.min} and ${bound.max}, got "${raw}"`;
  }
  return value;
}

export function parseSupervisorArgs(argv: string[]): ParseSupervisorArgsResult | ParseSupervisorArgsError {
  const own = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (!token.startsWith('--')) return { error: `unexpected argument: ${token}` };

    if (OWN_VALUE_FLAGS.has(token)) {
      const value = argv[i + 1];
      if (value === undefined) return { error: `${token} requires a value` };
      if (ALL_FLAG_TOKENS.has(value)) {
        return { error: `${token} requires a value, got flag "${value}"` };
      }
      own.set(token, value);
      i += 1;
      continue;
    }
    return { error: `unknown flag: ${token}` };
  }

  for (const flag of ['--repo', '--model']) {
    if (!own.has(flag)) return { error: `missing required flag: ${flag}` };
  }
  if (own.has('--campaign') && own.has('--home')) {
    return { error: '--campaign and --home are mutually exclusive' };
  }
  if (!own.has('--campaign') && !own.has('--home')) {
    return { error: 'exactly one of --campaign or --home is required' };
  }

  const numbers: Record<string, number> = {
    '--max-ruling-rounds': 2,
    '--max-ratify-rounds': 2,
    '--max-spawns': 8,
    '--max-watchdog-runs': 20,
    '--session-timeout-seconds': 1800,
    '--session-max-turns': 60,
    '--session-retries': 1,
    '--poll-seconds': 30,
  };
  for (const flag of Object.keys(numbers)) {
    const raw = own.get(flag);
    if (raw === undefined) continue;
    const parsed = parseBoundedInt(flag, raw);
    if (typeof parsed === 'string') return { error: parsed };
    numbers[flag] = parsed;
  }

  return {
    config: {
      repoRoot: own.get('--repo') as string,
      model: own.get('--model') as string,
      watchdogModel: own.get('--watchdog-model') ?? null,
      campaignSlug: own.get('--campaign') ?? null,
      rawHome: own.get('--home') ?? null,
      limits: {
        maxRulingRounds: numbers['--max-ruling-rounds'] as number,
        maxRatifyRounds: numbers['--max-ratify-rounds'] as number,
        maxSpawns: numbers['--max-spawns'] as number,
        maxWatchdogRuns: numbers['--max-watchdog-runs'] as number,
        sessionRetries: numbers['--session-retries'] as number,
      },
      sessionTimeoutSeconds: numbers['--session-timeout-seconds'] as number,
      sessionMaxTurns: numbers['--session-max-turns'] as number,
      pollSeconds: numbers['--poll-seconds'] as number,
    },
  };
}

import { join, normalize, sep } from 'node:path';

/** Pure path math (spec §10, ratified decision 2): "$(tribe-home.sh <repo>)/campaigns/<slug>".
 * `tribeHome` is already resolved by the edge (running `tribe-home.sh` is a subprocess concern,
 * banned from `core/**`); this only joins and normalizes. */
export function supervisorHomeFromCampaign(tribeHome: string, slug: string): string {
  const joined = join(tribeHome, 'campaigns', slug);
  const normalized = normalize(joined);
  return normalized.length > 1 && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized;
}
