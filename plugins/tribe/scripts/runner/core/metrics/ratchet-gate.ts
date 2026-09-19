/**
 * The context ratchet's gate — the pure caller `reviseCeiling` was written for (spec §3, card
 * supervisor-hardening / G2). `reviseCeiling` (./ceiling.ts) is a correct per-kind predicate whose
 * own module header notes it awaits "whichever later task wires this into the checker"; this is
 * that checker. It compares two ratchet-file CONTENTS — the merge-base version and the proposed
 * (working-tree) version — and refuses any ceiling raised without a `raisedBy` ruling id.
 *
 * PURE (pure-core.md): two strings in, a verdict out. No fs, no git, no clock — the edge
 * (../../../ratchet-check.ts) reads the two versions and hands them here. FAIL-CLOSED
 * (fail-closed-edges.md): an unparseable HEAD is a failure; an unparseable/absent BASE is "no
 * prior version" — every ceiling is then an initial measurement (reviseCeiling's oldValue===0
 * exemption), which is the honest reading of a file that did not exist at the base ref.
 */
import { reviseCeiling } from './ceiling.ts';

export interface RatchetFailure {
  /** The ceiling kind at fault (`ruling`, `ratify`, …), or `ratchet-file` for a whole-file fault. */
  kind: string;
  oldValue: number;
  proposed: number;
  /** Verbatim from `reviseCeiling` (or the file-level parse failure) — the edge prints it as-is. */
  reason: string;
}

export interface RatchetCheckResult {
  ok: boolean;
  failures: RatchetFailure[];
}

/** JSON.parse fail-closed to `null`; a non-object also reads as `null`. */
function parseObject(json: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function checkRatchetRevision(baseJson: string, headJson: string): RatchetCheckResult {
  const head = parseObject(headJson);
  if (head === null) {
    return {
      ok: false,
      failures: [{ kind: 'ratchet-file', oldValue: 0, proposed: 0, reason: 'the proposed ratchet file is not valid JSON' }],
    };
  }
  const headCeilings = asRecord(head['ceilings']);
  if (headCeilings === null) {
    return {
      ok: false,
      failures: [{ kind: 'ratchet-file', oldValue: 0, proposed: 0, reason: 'the proposed ratchet file has no "ceilings" object' }],
    };
  }
  const headRaisedBy = asRecord(head['raisedBy']) ?? {};

  // An unparseable OR absent base ('' when the file did not exist at the base ref) is "no prior
  // version": every base ceiling reads as 0, which reviseCeiling treats as the initial measurement.
  const base = parseObject(baseJson);
  const baseCeilings = base === null ? {} : (asRecord(base['ceilings']) ?? {});

  const failures: RatchetFailure[] = [];
  for (const kind of Object.keys(headCeilings)) {
    // A non-number proposed becomes NaN so reviseCeiling refuses it (never coerced to 0, which
    // would masquerade as a valid lowering). A non-number base value reads as 0 (no prior).
    const proposed = typeof headCeilings[kind] === 'number' ? (headCeilings[kind] as number) : NaN;
    const oldValue = typeof baseCeilings[kind] === 'number' ? (baseCeilings[kind] as number) : 0;
    const raisedBy = typeof headRaisedBy[kind] === 'string' ? (headRaisedBy[kind] as string) : null;
    const revision = reviseCeiling(oldValue, proposed, raisedBy);
    if (!revision.accepted) {
      failures.push({ kind, oldValue, proposed, reason: revision.reason });
    }
  }
  return { ok: failures.length === 0, failures };
}
