import { describe, expect, test } from 'bun:test';
import { classifyTrigger, isToolResultCarrier, userText } from './classify.ts';
import type { TriggerClass } from './model.ts';

// `want` is typed as `TriggerClass` (not `string`) so this table stays type-checked
// against `classifyTrigger`'s return type under `bunx tsc --noEmit` — a typo in an
// expected bucket name is a compile error, not a silent runtime pass. This does not
// change what any row asserts.
const ROWS: Array<[string, TriggerClass]> = [
  ['plain prose from the owner', 'human'],
  ['<task-notification><event>[Monitor expired after 30m]</event></task-notification>', 'monitor-expiry'],
  ['<task-notification><event>COMMIT: abc123 update</event></task-notification>', 'monitor-event'],
  ['<task-notification><tool-use-id>t1</tool-use-id><status>completed</status></task-notification>', 'task-notification'],
  ['', 'human'],
];

describe('classifyTrigger', () => {
  for (const [text, want] of ROWS) {
    test(`${JSON.stringify(text).slice(0, 48)} -> ${want}`, () => {
      expect(classifyTrigger(text)).toBe(want);
    });
  }
  test('Monitor expired beats the presence of an event element', () => {
    expect(classifyTrigger('<task-notification><event>Monitor expired</event></task-notification>'))
      .toBe('monitor-expiry');
  });

  test('a bare "Monitor expired" substring OUTSIDE the <task-notification> wrapper is human (Fix 8)', () => {
    expect(classifyTrigger('the deploy failed — Monitor expired earlier')).toBe('human');
  });

  test('a bare <event> element OUTSIDE the <task-notification> wrapper is human (Fix 8)', () => {
    expect(classifyTrigger('<event>COMMIT: x</event>')).toBe('human');
  });
});

describe('isToolResultCarrier', () => {
  test('an array content whose first block is a tool_result', () => {
    expect(isToolResultCarrier({ content: [{ type: 'tool_result' }] })).toBe(true);
  });
  test('a plain string content is not', () => {
    expect(isToolResultCarrier({ content: 'hello' })).toBe(false);
  });
  test('a malformed message is not, and never throws', () => {
    expect(isToolResultCarrier(null)).toBe(false);
    expect(isToolResultCarrier({ content: [] })).toBe(false);
  });
});

describe('userText', () => {
  test('concatenates text blocks and ignores non-text blocks', () => {
    expect(userText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }))
      .toBe('ab');
  });
  test('a string content is returned as-is', () => {
    expect(userText({ content: 'plain' })).toBe('plain');
  });
});
