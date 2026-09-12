/**
 * core/liveness.ts — session liveness (spec §5.4, STATE.md D2), verbatim:
 *
 *   live = (sizeBytes grew since the previous scan) || (now - mtime <= 10 min)
 *
 * No pid, no campaign state, no lock file. PURE (`pure-core.md`): takes the current size, the
 * previous scan's size (or `null` on the first scan — there is no "previous" to compare against),
 * an mtime and a `nowIso`; it never stats a file or reads the clock itself. The "grew" half needs
 * the previous scan's size, held by the caller in a bounded map (spec §5.3's cache neighbours
 * this exact identity discipline); on the first scan only the mtime half can fire, which is
 * correct — a file untouched for the last 10 minutes is not live, whatever its size.
 */

const LIVE_WINDOW_MS = 10 * 60 * 1000;

export interface LivenessInput {
  sizeBytes: number;
  /** The same file's size at the previous scan, or `null` when this is the first scan (there is
   * no previous size to compare against, so "grew" cannot fire — it must not default to true). */
  previousSizeBytes: number | null;
  mtimeIso: string;
  nowIso: string;
}

export function isLive(input: LivenessInput): boolean {
  const grew = input.previousSizeBytes !== null && input.sizeBytes > input.previousSizeBytes;
  const withinWindow = Date.parse(input.nowIso) - Date.parse(input.mtimeIso) <= LIVE_WINDOW_MS;
  return grew || withinWindow;
}
