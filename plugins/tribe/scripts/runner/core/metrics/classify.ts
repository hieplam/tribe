import type { TriggerClass } from './model.ts';

/**
 * Pure trigger classifier for a transcript turn (spec §15, card `## Measure first`).
 *
 * These are SUBSTRING facts about a text blob — not XML parsing. `Monitor expired`
 * beats the presence of an `<event>` element (see the plan's Task 1 Oracle).
 */

/**
 * Extracts the visible text of a message's content, tolerating any shape.
 * - A string content is returned as-is.
 * - An array content has its `type: 'text'` blocks concatenated; other block
 *   types (e.g. images, tool_use) are ignored.
 * - Anything else (null, undefined, missing/malformed content) yields ''.
 */
export function userText(message: unknown): string {
  if (message === null || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string') out += text;
    }
  }
  return out;
}

/**
 * True when a message's content is an array whose first block is a tool_result.
 * Tolerates null/undefined/wrong shapes — never throws.
 */
export function isToolResultCarrier(message: unknown): boolean {
  if (message === null || typeof message !== 'object') return false;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  const first = content[0];
  return first !== null && typeof first === 'object' && (first as { type?: unknown }).type === 'tool_result';
}

/**
 * Classifies a turn's trigger text (Oracle, spec §15, plan Task 1 Oracle): a monitor class
 * requires the `<task-notification>` wrapper — `Monitor expired` or `<event>` appearing OUTSIDE
 * that wrapper is ordinary human prose that happens to contain those substrings, not a
 * synthetic trigger (Fix 8).
 * - no `<task-notification>` anywhere in the text -> `human`, regardless of what substrings
 *   the text otherwise contains.
 * - text containing `<task-notification>` AND `Monitor expired` -> `monitor-expiry` (checked
 *   first: it beats the presence of an `<event>` element even when both are true of the same
 *   text).
 * - text containing `<task-notification>` AND an `<event>` element -> `monitor-event`.
 * - text containing `<task-notification>` with neither -> `task-notification` (the
 *   background-command-completion shape).
 */
export function classifyTrigger(text: string): TriggerClass {
  if (typeof text !== 'string') return 'human';
  if (!text.includes('<task-notification>')) return 'human';
  if (text.includes('Monitor expired')) return 'monitor-expiry';
  if (text.includes('<event>')) return 'monitor-event';
  return 'task-notification';
}
