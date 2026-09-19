/**
 * Pure CLI parsing for the `transcript-metrics` subcommand (card `## Measure first`, spec
 * §15). Mirrors `core/watchdog/args.ts`'s contract: every unknown flag is rejected BY NAME
 * (M2), a value-taking flag never silently swallows another flag's token as its value (F1),
 * and a numeric flag never silently coerces an empty/hex/scientific/padded string (F2). No
 * I/O, no clock, no ambient env.
 */

export interface TranscriptMetricsConfig {
  sessions: string[];
  project: string | null;
  json: boolean;
  cutBytes: number | null;
  verifyPath: string | null;
}

export interface ParseTranscriptMetricsArgsResult { config: TranscriptMetricsConfig }
export interface ParseTranscriptMetricsArgsError { error: string }

const VALUE_FLAGS = new Set(['--session', '--project', '--cut-bytes', '--verify']);
const BOOLEAN_FLAGS = new Set(['--json']);
/** Every recognized flag, value-taking or boolean — used to refuse a value-taking flag being
 * handed another flag's token as its "value" (F1, same lesson as watchdog/args.ts). */
const ALL_FLAG_TOKENS = new Set<string>([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);

// S-P14: a cut is a deliberate, bounded prefix. Zero/negative is never a valid prefix length;
// the ceiling is generous (1 GiB) — far past any real transcript measured so far (4.6 MB) —
// so it only ever refuses a typo, never a legitimate value.
const CUT_BYTES_MIN = 1;
const CUT_BYTES_MAX = 1024 * 1024 * 1024;

// A plain non-negative decimal integer literal — no sign, no whitespace, no hex/scientific
// notation, never empty (F2: `Number(raw)` alone silently coerces "", "0x10", "3e1" and " 5 "
// into valid integers; the contract's direction is strictness, never leniency).
const INT_LITERAL = /^\d+$/;

// Fix 5 (fail-closed-edges.md obligation 4): `cli/main.ts#findTranscriptPath` builds
// `join(dir, sessionId + '.jsonl')` from this value with no further check — a bare TOKEN is
// the only shape that can never escape `dir` (no '/', no '\', never '.'/'..', never empty).
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function isSafeSessionId(id: string): boolean {
  return id.length > 0 && id !== '.' && id !== '..' && SESSION_ID_PATTERN.test(id);
}

function containsPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

export function parseTranscriptMetricsArgs(
  argv: string[],
): ParseTranscriptMetricsArgsResult | ParseTranscriptMetricsArgsError {
  const sessions: string[] = [];
  let project: string | null = null;
  let json = false;
  let cutBytesRaw: string | null = null;
  let verifyPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (!token.startsWith('--')) return { error: `unexpected argument: ${token}` };

    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--json') json = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) return { error: `unknown flag: ${token}` };

    const value = argv[i + 1];
    if (value === undefined) return { error: `${token} requires a value` };
    if (ALL_FLAG_TOKENS.has(value)) {
      return { error: `${token} requires a value, got flag "${value}"` };
    }
    i += 1;

    if (token === '--session') {
      if (!isSafeSessionId(value)) {
        return { error: `--session: "${value}" is not a valid session id (expected letters, digits, '.', '_', '-' only, no '/' or '\\')` };
      }
      sessions.push(value);
    } else if (token === '--project') {
      if (containsPathSeparator(value)) {
        return { error: `--project: "${value}" must not contain a path separator ('/' or '\\')` };
      }
      project = value;
    } else if (token === '--cut-bytes') cutBytesRaw = value;
    else if (token === '--verify') verifyPath = value;
  }

  if (sessions.length > 0 && verifyPath !== null) {
    return { error: '--session and --verify are mutually exclusive' };
  }
  if (sessions.length === 0 && verifyPath === null) {
    return { error: 'missing required flag: --session (or --verify)' };
  }

  let cutBytes: number | null = null;
  if (cutBytesRaw !== null) {
    if (!INT_LITERAL.test(cutBytesRaw)) {
      return { error: `--cut-bytes: must be between ${CUT_BYTES_MIN} and ${CUT_BYTES_MAX}, got "${cutBytesRaw}"` };
    }
    const value = Number(cutBytesRaw);
    if (value < CUT_BYTES_MIN || value > CUT_BYTES_MAX) {
      return { error: `--cut-bytes: must be between ${CUT_BYTES_MIN} and ${CUT_BYTES_MAX}, got "${cutBytesRaw}"` };
    }
    cutBytes = value;
  }

  return { config: { sessions, project, json, cutBytes, verifyPath } };
}
