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

/** The committed baseline file's shape (spec §15, §21 D2). */
export interface BaselineFile {
  v: 1;
  tool: string;
  generatedAt: string;
  sessions: SessionMetrics[];
}
