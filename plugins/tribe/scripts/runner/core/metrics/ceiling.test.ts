// ceiling.test.ts — Task 4, S-P15: the context ratchet reads a committed per-kind ceiling.
// Pure decision logic only (no fs) — reading `2026-09-18-supervisor-ratchet.json` off disk is
// an edge concern (Task 12+); this module decides what a recorded ceiling value MEANS. The
// fixture-loading test below reads the committed file directly (tests are exempt from the
// pure-core fs ban, `structure.test.ts`: "Tests are exempt everywhere").
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  test('0 -> X (the INITIAL measurement) is accepted with NO raisedBy (R7)', () => {
    const got = reviseCeiling(0, 258795, null);
    expect(got.accepted).toBe(true);
    expect(got.ceiling).toBe(258795);
  });

  test('0 -> 0 (still unmeasured) is accepted', () => {
    const got = reviseCeiling(0, 0, null);
    expect(got.accepted).toBe(true);
    expect(got.ceiling).toBe(0);
  });

  test('a negative proposed ceiling is refused, naming the reason', () => {
    const got = reviseCeiling(400000, -100, null);
    expect(got.accepted).toBe(false);
    if (got.accepted) throw new Error('expected the negative proposal to be refused');
    expect(got.reason.length).toBeGreaterThan(0);
  });

  test('a non-integer proposed ceiling is refused, naming the reason', () => {
    const got = reviseCeiling(400000, 300000.5, null);
    expect(got.accepted).toBe(false);
    if (got.accepted) throw new Error('expected the non-integer proposal to be refused');
    expect(got.reason.length).toBeGreaterThan(0);
  });

  test('a negative INITIAL (0 -> negative) proposal is still refused — the non-negative-integer rule applies before the 0-is-initial exemption', () => {
    const got = reviseCeiling(0, -1, null);
    expect(got.accepted).toBe(false);
  });
});

describe('reviseCeiling against the COMMITTED ratchet fixture (R7)', () => {
  test('one of the fixture\'s 0 ceilings accepts an initial measurement; an already-measured ceiling then refuses a further raise with no raisedBy', () => {
    const path = join(import.meta.dir, '../../../../../../docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json');
    const ratchet = JSON.parse(readFileSync(path, 'utf8')) as { ceilings: Record<string, number> };
    const recorded = ratchet.ceilings['ruling'];
    expect(recorded).toBe(0); // the fixture is genuinely unmeasured, as the brief asserts

    const initial = reviseCeiling(recorded, 258795, null);
    expect(initial.accepted).toBe(true);
    expect(initial.ceiling).toBe(258795);

    // Now the ceiling IS measured (258795): raising it further with no raisedBy is refused.
    const furtherRaise = reviseCeiling(initial.ceiling, 400000, null);
    expect(furtherRaise.accepted).toBe(false);
  });
});
