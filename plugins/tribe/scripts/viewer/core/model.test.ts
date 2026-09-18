// core/model.test.ts — the runtime witness for spec §4's `RenderNode` union.
//
// TypeScript types are erased at runtime, so a test cannot iterate `RenderNode["k"]` directly.
// `RENDER_NODE_KINDS: Record<RenderNode["k"], true>` makes the compiler reject this file the
// moment a kind joins the union without joining the witness (spec §4). This test exists only to
// prove the witness is importable and iterable at runtime — exactly what task 30's DOM coverage
// proof needs.
import { describe, expect, test } from 'bun:test';
import { RENDER_NODE_KINDS } from './model.ts';

describe('RENDER_NODE_KINDS — the runtime witness for RenderNode["k"]', () => {
  test('is non-empty', () => {
    expect(Object.keys(RENDER_NODE_KINDS).length).toBeGreaterThan(0);
  });

  test('every key is a string', () => {
    for (const key of Object.keys(RENDER_NODE_KINDS)) {
      expect(typeof key).toBe('string');
    }
  });

  test('every value is literally true (a witness, not a lookup table)', () => {
    for (const value of Object.values(RENDER_NODE_KINDS)) {
      expect(value).toBe(true);
    }
  });

  test('carries exactly the 12 kinds named in spec §4', () => {
    expect(Object.keys(RENDER_NODE_KINDS).sort()).toEqual(
      [
        'prompt', 'assistant', 'thinking', 'tool', 'orphan_result',
        'image', 'attachment', 'chip', 'divider', 'error', 'raw', 'unreadable',
      ].sort(),
    );
  });
});
