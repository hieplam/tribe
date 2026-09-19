/**
 * The context ratchet's pure ceiling logic (S-P15, spec §15).
 *
 * The committed ratchet file (`docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json`)
 * records a per-kind ceiling that starts at `0` ("not yet measured"). This module answers two
 * pure questions a caller (Task 20's checker, not built yet) needs decided:
 *
 *   1. `resolveCeiling` — given a recorded ceiling and the pinned baseline figure for the same
 *      kind, what ceiling applies right now, and where did it come from?
 *   2. `reviseCeiling` — is a proposed new ceiling value allowed to replace the old one?
 *
 * No filesystem, no clock: reading the ratchet JSON off disk is an edge concern for whichever
 * later task wires this into the checker (mirrors Task 3's core/adapter split for `cut.ts`).
 */

export type CeilingSource = 'baseline-fallback' | 'measured';

export interface CeilingResolution {
  ceiling: number;
  ceilingSource: CeilingSource;
}

/**
 * `recorded === 0` means "unmeasured" (S-P15): the gate falls back to the pinned baseline
 * figure for the same kind and reports that it did. Any other recorded value is used as-is.
 */
export function resolveCeiling(recorded: number, baseline: number): CeilingResolution {
  if (recorded === 0) {
    return { ceiling: baseline, ceilingSource: 'baseline-fallback' };
  }
  return { ceiling: recorded, ceilingSource: 'measured' };
}

export interface CeilingRevisionAccepted {
  accepted: true;
  ceiling: number;
}

export interface CeilingRevisionRefused {
  accepted: false;
  ceiling: number;
  reason: string;
}

export type CeilingRevision = CeilingRevisionAccepted | CeilingRevisionRefused;

/**
 * S-P15 / R7: lowering (or leaving unchanged) a recorded ceiling is free. Raising a ceiling
 * that has already been measured (`oldValue !== 0`) is refused unless the caller supplies a
 * `raisedBy` ruling id — the refusal names both the old and the new value so the caller can
 * surface it verbatim. `oldValue === 0` means "never yet measured" (S-P15): the FIRST proposal
 * against an unmeasured ceiling is the INITIAL measurement, not a raise, and is accepted with
 * no `raisedBy` required — a ruling only guards RAISING an already-measured number. A proposed
 * value that is not a non-negative integer is refused unconditionally, checked first, so the
 * initial-measurement exemption can never smuggle through a negative or fractional ceiling.
 */
export function reviseCeiling(oldValue: number, proposed: number, raisedBy: string | null): CeilingRevision {
  if (!Number.isInteger(proposed) || proposed < 0) {
    return {
      accepted: false,
      ceiling: oldValue,
      reason: `refusing a proposed ceiling of ${proposed}: a ceiling must be a non-negative integer`,
    };
  }
  if (oldValue === 0) {
    return { accepted: true, ceiling: proposed }; // initial measurement — not a raise
  }
  if (proposed <= oldValue) {
    return { accepted: true, ceiling: proposed };
  }
  if (raisedBy !== null && raisedBy !== '') {
    return { accepted: true, ceiling: proposed };
  }
  return {
    accepted: false,
    ceiling: oldValue,
    reason:
      `refusing to raise the ceiling from ${oldValue} to ${proposed} with no raisedBy ruling id ` +
      `(S-P15: raising a ceiling requires a recorded Shaman ruling)`,
  };
}
