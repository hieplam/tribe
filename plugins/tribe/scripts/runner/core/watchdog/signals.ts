/**
 * Pure parsing of a session log TAIL into the two signals the watchdog acts on (D74-4).
 * The runner appends one JSON SDK message per line (`adapters/run-io.adapter.ts`'s
 * `appendLog`), so this is line-delimited JSON — but the caller passes a byte-bounded tail,
 * so the first line is routinely truncated mid-JSON. That is expected input, not an error:
 * a line that does not parse is skipped (fail-closed-edges obligation 1 — the catch here is
 * the narrowest possible, around one `JSON.parse`, and converts to "no signal", never a throw).
 *
 * W-P4: the LAST rate_limit_event and the LAST result in the tail decide. Real logs carry
 * `allowed` (x3) and `allowed_warning` (x2) before a final `rejected` (fixtures/watchdog/),
 * so a session that was throttled and recovered must report no quota signal.
 */

export interface SessionSignals {
  /** A REJECTED rate limit with a numeric epoch-seconds reset. Whether that reset is still in
   * the future is a clock question, decided by `decide()` (W-P2), never here. */
  quota: { resetsAtEpochS: number } | null;
  overload: { apiErrorStatus: number } | null;
  /** Present only when the LAST result in the tail ended on an allowlisted permanent API error
   * (`../api-error.ts`); absent otherwise, like `finalLineUnparseable` below. */
  permanentApiError?: { status: number | null; code: string };
  lastResultIsError: boolean;
  /**
   * True when the tail's LAST content line looked like it was on track to be a real
   * session-log line (it starts with, or is itself a truncated prefix of, the literal
   * `{"type":"` every such line begins with — matched at ANY length ≥1 byte, not just past the
   * full type token; audit F3b) but failed to parse — almost certainly a byte-bounded tail cut
   * mid-JSON at the END, not the routinely expected cut at the START. Unlike the first-line
   * tolerance this module already has, a dropped FINAL line can hide the newest, most
   * authoritative event and leave `quota`/`overload` above silently stale (audit F3; spec §9
   * amendment 3: "under-detecting quota is the defect"). A caller MUST treat `true` here as
   * "the signals above may be stale, not current" — this field only reports that the newest
   * event was lost; it never invents what that event said. Absent (`undefined`) when the tail's
   * final content line was either absent, or parsed fine, or was unparseable noise that
   * diverges from the `{"type":"` literal and so was never going to carry a signal anyway.
   */
  finalLineUnparseable?: boolean;
}

import { permanentApiErrorOf } from '../api-error.ts';

/** 429 is deliberately absent: it is the quota shape, and the quota path owns it (W-P3). */
const OVERLOAD_STATUSES = new Set([500, 502, 503, 504, 529]);

/** The literal every real session-log line begins with (`adapters/run-io.adapter.ts`'s
 * `appendLog` always writes `{"type":...}`). Matching the FULL type token (e.g.
 * `"type":"rate_limit_event"`) left a hole: a tail cut anywhere inside the first ~25 bytes of a
 * real line silently reported no `finalLineUnparseable` at all (audit F3b). Matching this
 * 9-byte literal instead catches a cut at ANY length ≥1 byte, because every signal-bearing line
 * — and indeed every line this module ever writes to — starts with it. */
const FINAL_LINE_SIGNAL_PREFIX = '{"type":"';

/** True when `line` either starts with, or is itself a truncated prefix of, the literal above —
 * i.e. it was on track to be a real session-log line before the byte-bounded tail cut it off.
 * Pure noise (e.g. `{"unclosed":`) diverges from the literal within its first few characters and
 * so is never caught, which is what keeps it out of `finalLineUnparseable` (F3b). */
function looksLikeTruncatedSignalLine(line: string): boolean {
  return line.startsWith(FINAL_LINE_SIGNAL_PREFIX) || FINAL_LINE_SIGNAL_PREFIX.startsWith(line);
}

export function parseSessionSignals(tail: string): SessionSignals {
  let quota: SessionSignals['quota'] = null;
  let overload: SessionSignals['overload'] = null;
  let permanentApiError: SessionSignals['permanentApiError'];
  let lastResultIsError = false;
  let finalLineUnparseable: boolean | undefined;

  const lines = tail.split('\n');
  let lastContentIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] as string).trim() !== '') { lastContentIdx = i; break; }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] as string;
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof SyntaxError) {
        if (idx === lastContentIdx && looksLikeTruncatedSignalLine(line)) finalLineUnparseable = true;
        continue; // truncated tail line — expected
      }
      throw err;
    }

    if (message['type'] === 'rate_limit_event') {
      const info = message['rate_limit_info'];
      const record = info && typeof info === 'object' ? (info as Record<string, unknown>) : {};
      const resetsAt = record['resetsAt'];
      quota =
        record['status'] === 'rejected' && typeof resetsAt === 'number' && Number.isFinite(resetsAt)
          ? { resetsAtEpochS: resetsAt }
          : null;
      continue;
    }

    if (message['type'] === 'result') {
      lastResultIsError = message['is_error'] === true;
      const permanent = permanentApiErrorOf(message);
      permanentApiError = permanent === null ? undefined : { status: permanent.status, code: permanent.code };
      const status = message['api_error_status'];
      overload =
        typeof status === 'number' && OVERLOAD_STATUSES.has(status)
          ? { apiErrorStatus: status }
          : null;
    }
  }

  return permanentApiError === undefined
    ? { quota, overload, lastResultIsError, finalLineUnparseable }
    : { quota, overload, permanentApiError, lastResultIsError, finalLineUnparseable };
}
