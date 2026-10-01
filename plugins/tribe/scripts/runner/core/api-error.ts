// core/api-error.ts — the ONE parser of "this session ended on a permanent API error"
// (rule-one-parser-per-edge-shape): the runner's own result parsing (`session.ts`) and the
// watchdog's log-tail parsing (`watchdog/signals.ts`) both read a session `result` message, and
// both ask it here, so the two layers can never disagree about which errors are permanent.
//
// PURE (`pure-core.md`): a value in, a value out; imports nothing local.

/** The allowlist (card runner-model-support, ruling D3). An API error whose `api_error_code` is
 * listed here can never succeed on a retry, so the campaign stops on its first occurrence.
 *
 * Oracle: treating a transient error as permanent parks a healthy campaign — the worse error —
 * so a code earns a place here only when a REAL session was seen returning it, and any code not
 * listed keeps the ordinary retry path. Observed codes:
 * - `claude_code_version_too_old` — HTTP 400; the runner's bundled Claude Code is older than the
 *   model requires (captured 2026-10-01: `fixtures/executor/result-claude-code-version-too-old.json`).
 * An unknown model id carries NO code at all (HTTP 404 only, captured 2026-10-01:
 * `fixtures/executor/result-model-not-found-404.json`), so it is not on this list; `doctor.sh
 * --model` refuses it before launch instead. */
export const PERMANENT_API_ERROR_CODES: ReadonlySet<string> = new Set(['claude_code_version_too_old']);

export interface PermanentApiError {
  /** `api_error_status` — the HTTP status, or `null` when the message carries none. */
  status: number | null;
  /** `api_error_code` — always one of `PERMANENT_API_ERROR_CODES`. */
  code: string;
  /** The message's `result` text: the API's own words (e.g. "...version 2.1.280 or newer is required..."). */
  text: string;
}

/** A session `result` message -> the permanent API error it carries, or `null` for every other
 * message: a non-result, a result that is not an error (`is_error` not exactly `true`), or an
 * error whose code is absent or not on the allowlist. */
export function permanentApiErrorOf(message: Record<string, unknown>): PermanentApiError | null {
  if (message['type'] !== 'result' || message['is_error'] !== true) return null;
  const code = message['api_error_code'];
  if (typeof code !== 'string' || !PERMANENT_API_ERROR_CODES.has(code)) return null;
  const status = message['api_error_status'];
  const text = message['result'];
  return {
    status: typeof status === 'number' ? status : null,
    code,
    text: typeof text === 'string' ? text : '',
  };
}
