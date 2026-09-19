// The pure ratchet gate (spec §3, card supervisor-hardening / G2): the caller `reviseCeiling`'s
// own module header says it was written for but never got. Two file CONTENTS in — the merge-base
// version and the proposed (working-tree) version — a verdict out. No fs, no git, no clock.
import { expect, test } from 'bun:test';
import { checkRatchetRevision } from './ratchet-gate.ts';

const BASE = '{ "v": 1, "ceilings": { "ruling": 27534, "ratify": 0, "closing": 93443, "doorbell": 0 } }';
const RAISE_NO_JUSTIFY =
  '{ "v": 1, "ceilings": { "ruling": 999999, "ratify": 0, "closing": 93443, "doorbell": 0 } }';
const RAISE_JUSTIFIED =
  '{ "v": 1, "ceilings": { "ruling": 999999, "ratify": 0, "closing": 93443, "doorbell": 0 },' +
  ' "raisedBy": { "ruling": "R7-2026-09-20-context-headroom" } }';
const LOWERING = '{ "v": 1, "ceilings": { "ruling": 20000, "ratify": 0, "closing": 93443, "doorbell": 0 } }';

test('a raise with no raisedBy fails, and the failure names old, proposed, and raisedBy', () => {
  const r = checkRatchetRevision(BASE, RAISE_NO_JUSTIFY);
  expect(r.ok).toBe(false);
  const f = r.failures.find((x) => x.kind === 'ruling');
  expect(f).toBeDefined();
  expect(f!.oldValue).toBe(27534);
  expect(f!.proposed).toBe(999999);
  expect(f!.reason).toContain('27534');
  expect(f!.reason).toContain('999999');
  expect(f!.reason).toContain('raisedBy');
  // Only the raised kind is at fault — the unchanged kinds do not spuriously appear.
  expect(r.failures.map((x) => x.kind)).toEqual(['ruling']);
});

test('the same raise WITH raisedBy set passes', () => {
  expect(checkRatchetRevision(BASE, RAISE_JUSTIFIED)).toEqual({ ok: true, failures: [] });
});

test('a lowering passes', () => {
  expect(checkRatchetRevision(BASE, LOWERING)).toEqual({ ok: true, failures: [] });
});

test('an unchanged file passes', () => {
  expect(checkRatchetRevision(BASE, BASE)).toEqual({ ok: true, failures: [] });
});

test('an unparseable head fails (fail-closed), never throws', () => {
  let r!: ReturnType<typeof checkRatchetRevision>;
  expect(() => { r = checkRatchetRevision(BASE, 'not json at all'); }).not.toThrow();
  expect(r.ok).toBe(false);
  expect(r.failures.length).toBeGreaterThanOrEqual(1);
});

test('a head with no ceilings object fails', () => {
  const r = checkRatchetRevision(BASE, '{ "v": 1 }');
  expect(r.ok).toBe(false);
});

test('a head ceiling value that is not a non-negative integer is refused', () => {
  const r = checkRatchetRevision(BASE, '{ "v": 1, "ceilings": { "ruling": "lots" } }');
  expect(r.ok).toBe(false);
  expect(r.failures.some((x) => x.kind === 'ruling')).toBe(true);
});

test('an absent base is treated as the initial measurement — any head value is accepted', () => {
  // base '' == "no prior version": reviseCeiling's oldValue===0 exemption, so even a large
  // ruling ceiling with no raisedBy is the FIRST measurement, not a raise.
  expect(checkRatchetRevision('', RAISE_NO_JUSTIFY)).toEqual({ ok: true, failures: [] });
});

test('an unparseable base is treated as the initial measurement too', () => {
  expect(checkRatchetRevision('garbage', RAISE_NO_JUSTIFY)).toEqual({ ok: true, failures: [] });
});
