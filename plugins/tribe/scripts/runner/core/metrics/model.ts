/**
 * Transcript metrics vocabulary for the context ratchet (spec §15).
 *
 * Types only — no imports, no logic. This file, like `core/supervisor/model.ts`,
 * is deliberately kept apart from the runner's shared kernel (`core/types.ts`),
 * which stays untouched by this plan (see plan `0.1` and `Global Constraints`).
 */

/**
 * The turn's TRIGGER — the most recent non-tool-result user-side message that
 * produced the turn. Oracle: spec §15.
 */
export type TriggerClass = 'human' | 'monitor-event' | 'monitor-expiry' | 'task-notification';

/** Token counts summed over some set of turns. */
export interface TokenSums {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Metrics accumulated for a single `TriggerClass` bucket. */
export interface ClassMetrics {
  turns: number;
  tokens: TokenSums;
}

/** Metrics accumulated for a single transcript/session. */
export interface SessionMetrics {
  sessionId: string;
  lines: number;
  skippedLines: number;
  skippedReasons: string[];
  turns: number;
  tokens: TokenSums;
  perClass: Record<TriggerClass, ClassMetrics>;
  firstContext: number;
  lastContext: number;
  maxContext: number;
  monitorArms: number;
  monitorExpiries: number;
  firstAt: string;
  lastAt: string;
  babysittingShare: number;
  sidechain: ClassMetrics;
}

/**
 * S-P14 (spec §15): the exact byte range a baseline entry's metrics were measured over —
 * never "the whole file", because a live transcript moves under you (measured: the same
 * session read 1,443 -> 1,507 -> 1,509 lines across three readings during planning, spec
 * §21 D2). `sha256` is over exactly `bytes` bytes, from the start of the file.
 */
export interface CutInfo {
  lines: number;
  bytes: number;
  sha256: string;
}

/**
 * One row of the committed baseline (Task 3/4, spec §15): the session id, the transcript
 * path it was measured from, the cut it is pinned to, and the metrics measured at that cut.
 */
export interface BaselineEntry {
  sessionId: string;
  path: string;
  cut: CutInfo;
  metrics: SessionMetrics;
}

/** `--verify`'s per-session outcome (spec §15's table) — never a silent difference. */
export type VerifyStatus = 'verified' | 'prefix_mismatch' | 'truncated' | 'absent';

export interface VerifyResult {
  sessionId: string;
  status: VerifyStatus;
  detail?: string;
}

/**
 * The committed baseline file's shape (spec §15, §21 D2). `sessions` carries the CUT each
 * entry is pinned to (Task 3, S-P14) — a bare `SessionMetrics[]` cannot be re-verified,
 * since verification needs the transcript path and the exact byte/hash it was pinned at.
 */
export interface BaselineFile {
  v: 1;
  tool: string;
  generatedAt: string;
  sessions: BaselineEntry[];
}
