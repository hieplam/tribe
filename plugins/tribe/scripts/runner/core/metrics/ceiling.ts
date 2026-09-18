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
 * S-P15: lowering (or leaving unchanged) a recorded ceiling is free. Raising one is refused
 * unless the caller supplies a `raisedBy` ruling id — the refusal names both the old and the
 * new value so the caller can surface it verbatim.
 */
export function reviseCeiling(oldValue: number, proposed: number, raisedBy: string | null): CeilingRevision {
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
