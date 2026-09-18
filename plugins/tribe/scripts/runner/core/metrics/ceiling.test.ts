// ceiling.test.ts — Task 4, S-P15: the context ratchet reads a committed per-kind ceiling.
// Pure decision logic only (no fs) — reading `2026-09-18-supervisor-ratchet.json` off disk is
// an edge concern (Task 12+); this module decides what a recorded ceiling value MEANS.
import { describe, expect, test } from 'bun:test';
import { resolveCeiling, reviseCeiling } from './ceiling.ts';

describe('resolveCeiling (S-P15: 0 means unmeasured -> fall back to the baseline)', () => {
  test('a 0 recorded ceiling falls back to the baseline figure and says so', () => {
    const got = resolveCeiling(0, 258795);
    expect(got.ceiling).toBe(258795);
    expect(got.ceilingSource).toBe('baseline-fallback');
  });

  test('a measured (non-zero) ceiling is used as-is, not the baseline', () => {
    const got = resolveCeiling(400000, 258795);
    expect(got.ceiling).toBe(400000);
    expect(got.ceilingSource).toBe('measured');
  });
});

describe('reviseCeiling (S-P15: lowering is free; raising needs a recorded ruling id)', () => {
  test('lowering a ceiling is accepted with no ruling id', () => {
    const got = reviseCeiling(400000, 300000, null);
    expect(got.accepted).toBe(true);
    expect(got.ceiling).toBe(300000);
  });

  test('an unchanged ceiling is accepted', () => {
    const got = reviseCeiling(400000, 400000, null);
    expect(got.accepted).toBe(true);
    expect(got.ceiling).toBe(400000);
  });

  test('raising a ceiling with no raisedBy is REFUSED, naming both the old and the new value', () => {
    const got = reviseCeiling(400000, 500000, null);
    expect(got.accepted).toBe(false);
    expect(got.ceiling).toBe(400000);
    if (got.accepted) throw new Error('expected the raise to be refused');
    expect(got.reason).toContain('400000');
    expect(got.reason).toContain('500000');
  });

  test('raising a ceiling WITH a raisedBy ruling id is accepted', () => {
    const got = reviseCeiling(400000, 500000, 'ruling-2026-09-20-context-headroom');
    expect(got.accepted).toBe(true);
    expect(got.ceiling).toBe(500000);
  });
});
