// Tests for state.ts (Task 2): schema, load/serialize round-trip, version rejection,
// nextCard selection. Fixture values are deliberately neutral (no repo names, no
// campaign-specific values) — the stateless-capability wall.
import { describe, expect, test } from 'bun:test';
import {
  CURRENT_STATE_VERSION,
  CardNotFoundError,
  CircularDependencyError,
  UndefinedDependencyCardError,
  UndefinedSequenceCardError,
  UnsupportedStateVersionError,
  loadState,
  parseState,
  resetCard,
  serializeState,
  nextCard,
} from './state.ts';
import type { Card, CampaignState } from './types.ts';
import type { StateIO } from '../ports/ports.ts';
import { escalationPathOf } from './paths.ts';

function fixtureState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    campaign: 'sample-campaign',
    mergePolicy: 'merge',
    sequence: ['C1', 'C2', 'C3'],
    schemaLockPaths: ['packages/app/src/domain/sample-types.ts'],
    docsOnlyPaths: ['docs/'],
    ownerOnlyEscalations: ['breaking-change'],
    cards: {
      C1: {
        status: 'shipped',
        spec: 'docs/superpowers/specs/2026-01-01-c1-spec.md',
        plan: 'docs/superpowers/plans/2026-01-01-c1-plan.md',
        branch: 'feat/c1-widget',
        baseSha: 'aaaaaaa',
        pr: 10,
        mergeSha: 'bbbbbbb',
        sessionId: 'sess-c1',
        updatedAt: '2026-01-02T00:00:00Z',
        tasks: [{ id: 'T1', heading: 'Task 1' }],
      },
      C2: {
        status: 'staged',
        spec: 'docs/superpowers/specs/2026-01-01-c2-spec.md',
        plan: 'docs/superpowers/plans/2026-01-01-c2-plan.md',
        branch: null,
        baseSha: null,
        pr: null,
        mergeSha: null,
        sessionId: null,
        updatedAt: null,
        tasks: [{ id: 'T1', heading: 'Task 1' }],
      },
      C3: {
        status: 'staged',
        spec: null,
        plan: null,
        branch: null,
        baseSha: null,
        pr: null,
        mergeSha: null,
        sessionId: null,
        updatedAt: null,
        tasks: [{ id: 'T1', heading: 'Task 1' }],
      },
    },
    ...overrides,
  };
}

function io(existingPaths: string[], repoRoot = '/repo', homeDir = '/th'): StateIO {
  const existing = new Set(existingPaths);
  return {
    repoRoot,
    homeDir,
    fileExists: (resolvedPath: string) => existing.has(resolvedPath),
  };
}

/** A minimal, fully-formed card (all D2 fields present) for tests that only care about
 * `status`/`dependsOn` — avoids repeating every nullable field at every call site. */
function cardFixture(overrides: Partial<Card> = {}): Card {
  return {
    status: 'staged',
    spec: 'docs/superpowers/specs/2026-01-01-x-spec.md',
    plan: 'docs/superpowers/plans/2026-01-01-x-plan.md',
    branch: null,
    baseSha: null,
    pr: null,
    mergeSha: null,
    sessionId: null,
    updatedAt: null,
    tasks: [{ id: 'T1', heading: 'Task 1' }],
    ...overrides,
  };
}

/** An `io` that reports every card's recorded spec/plan as present on disk, so `nextCard`
 * tests below exercise only the dependsOn/blocked logic, never the PLANNING_NEEDED path. */
function allFilesExistIo(repoRoot = '/repo', homeDir = '/th'): StateIO {
  return { repoRoot, homeDir, fileExists: () => true };
}

describe('parseState / serializeState round-trip', () => {
  test('parses a well-formed state and round-trips it byte-for-byte reparseable', () => {
    const raw = fixtureState();
    const state = parseState(raw);
    expect(state.v).toBe(CURRENT_STATE_VERSION);
    expect(state.campaign).toBe('sample-campaign');
    expect(state.sequence).toEqual(['C1', 'C2', 'C3']);
    expect(state.schemaLockPaths).toEqual(['packages/app/src/domain/sample-types.ts']);
    expect(state.docsOnlyPaths).toEqual(['docs/']);
    expect(state.ownerOnlyEscalations).toEqual(['breaking-change']);
    expect(state.cards.C1?.status).toBe('shipped');

    const serialized = serializeState(state);
    const reparsed = parseState(JSON.parse(serialized));
    expect(reparsed).toEqual(state);
  });

  test('preserves unknown top-level and per-card fields across a load -> serialize cycle', async () => {
    const raw = fixtureState({ note: 'unknown-top-level-field' });
    (raw.cards as Record<string, Record<string, unknown>>).C2.reviewer = 'unknown-per-card-field';

    const loaded = await loadState(() => JSON.stringify(raw));
    // Unknown fields must survive parsing, not be stripped by the schema.
    expect((loaded as unknown as Record<string, unknown>).note).toBe('unknown-top-level-field');
    expect((loaded.cards.C2 as unknown as Record<string, unknown>).reviewer).toBe(
      'unknown-per-card-field',
    );

    const serialized = serializeState(loaded);
    const reparsed = JSON.parse(serialized);
    expect(reparsed.note).toBe('unknown-top-level-field');
    expect(reparsed.cards.C2.reviewer).toBe('unknown-per-card-field');
  });

  test('loadState reads through the injected readFile seam only (no fs)', async () => {
    const raw = fixtureState();
    let calls = 0;
    const state = await loadState(() => {
      calls += 1;
      return JSON.stringify(raw);
    });
    expect(calls).toBe(1);
    expect(state.campaign).toBe('sample-campaign');
  });
});

// P11 fix-list (ruling R3: a stale base is worse than no base): `status: 'staged'` +
// `sessionId: null` + `baseSha` set is an impossible combo by invariant — `staged` +
// `sessionId: null` means no world exists yet for this card, so any `baseSha` it's still
// carrying can only be stale or hand-authored (the exact shape of the B13 incident: a
// hand-reset-to-`staged` card that kept its old campaign-start `baseSha`). `loadState`
// normalizes it to `null` on every load and reports a warning through the optional
// `onWarning` out-param (never a hard fail: the fix is deterministic and safe) — the actual
// printing happens at the edge (`run-loop.ts`/`cli/main.ts`), never inside this pure module.
describe('loadState — R3 invariant: staged + sessionId null + baseSha set is normalized on load', () => {
  test('status staged + sessionId null + baseSha set -> baseSha nulled and a warning is emitted', async () => {
    const raw = fixtureState({
      cards: {
        ...(fixtureState().cards as Record<string, unknown>),
        C2: {
          status: 'staged',
          spec: 'docs/superpowers/specs/2026-01-01-c2-spec.md',
          plan: 'docs/superpowers/plans/2026-01-01-c2-plan.md',
          branch: null,
          baseSha: 'stale-hand-reset-sha',
          pr: null,
          mergeSha: null,
          sessionId: null,
          updatedAt: null,
          tasks: [{ id: 'T1', heading: 'Task 1' }],
        },
      },
    });

    const warnings: string[] = [];
    const state = await loadState(() => JSON.stringify(raw), (w) => warnings.push(w));

    expect(state.cards.C2?.baseSha).toBeNull();
    expect(warnings).toEqual(['C2: cleared stale baseSha on staged card (R3 invariant)']);
  });

  test('a running card with baseSha set is left untouched (only staged + sessionId-null qualifies)', async () => {
    const raw = fixtureState({
      cards: {
        ...(fixtureState().cards as Record<string, unknown>),
        C2: {
          status: 'running',
          spec: 'docs/superpowers/specs/2026-01-01-c2-spec.md',
          plan: 'docs/superpowers/plans/2026-01-01-c2-plan.md',
          branch: 'feat/c2-widget',
          baseSha: 'legit-running-base',
          pr: null,
          mergeSha: null,
          sessionId: 'sess-c2',
          updatedAt: null,
          tasks: [{ id: 'T1', heading: 'Task 1' }],
        },
      },
    });

    const warnings: string[] = [];
    const state = await loadState(() => JSON.stringify(raw), (w) => warnings.push(w));

    expect(state.cards.C2?.baseSha).toBe('legit-running-base');
    expect(warnings).toEqual([]);
  });

  test('a staged card with baseSha already null is left untouched and emits no warning', async () => {
    // fixtureState()'s own C2 is already status: 'staged', sessionId: null, baseSha: null.
    const raw = fixtureState();

    const warnings: string[] = [];
    const state = await loadState(() => JSON.stringify(raw), (w) => warnings.push(w));

    expect(state.cards.C2?.baseSha).toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe('version rejection', () => {
  test('rejects an unknown major version with a typed error, not a silent parse', () => {
    const raw = fixtureState({ v: 3 });
    expect(() => parseState(raw)).toThrow(UnsupportedStateVersionError);
  });

  test('rejects a missing version field', () => {
    const raw = fixtureState();
    delete (raw as Record<string, unknown>).v;
    expect(() => parseState(raw)).toThrow(UnsupportedStateVersionError);
  });
});

describe('sequence/cards referential integrity', () => {
  test('rejects a sequence entry naming a card id absent from cards, instead of letting it be silently skipped as done', () => {
    // A hand-edited state file with a typo'd sequence id ('C4' has no entry under `cards`).
    // Before this check existed, parseState accepted this, and nextCard's `if (!card)
    // continue;` silently skipped C4 — if C4 were the only unshipped id, the campaign loop
    // would report `{ kind: 'done' }` even though C4 was never built.
    const raw = fixtureState({ sequence: ['C1', 'C2', 'C4'] });
    expect(() => parseState(raw)).toThrow(UndefinedSequenceCardError);
  });
});

describe('nextCard', () => {
  test('returns the first non-shipped card in sequence order when spec/plan exist on disk', () => {
    const state = parseState(fixtureState()) as CampaignState;
    const result = nextCard(
      state,
      io([
        '/repo/docs/superpowers/specs/2026-01-01-c2-spec.md',
        '/repo/docs/superpowers/plans/2026-01-01-c2-plan.md',
      ]),
    );
    expect(result).toEqual({ kind: 'card', cardId: 'C2', card: state.cards.C2 });
  });

  test('skips escalated cards by default', () => {
    const state = parseState(
      fixtureState({
        cards: {
          ...fixtureState().cards as Record<string, unknown>,
          C2: {
            status: 'escalated',
            spec: 'docs/superpowers/specs/2026-01-01-c2-spec.md',
            plan: 'docs/superpowers/plans/2026-01-01-c2-plan.md',
            branch: null,
            baseSha: null,
            pr: null,
            mergeSha: null,
            sessionId: null,
            updatedAt: null,
            tasks: [{ id: 'T1', heading: 'Task 1' }],
          },
        },
      }),
    ) as CampaignState;

    // The escalation file is still present on disk (`escalationPathOf('/th', 'C2')`) — this
    // is what an UNANSWERED escalation actually looks like (P6 fix-list: `nextCard` now
    // consults the file, not merely `card.status`, so this fixture must model "unanswered"
    // explicitly rather than relying on an absent path meaning the same thing by accident).
    const fakeIo = io([
      '/repo/docs/superpowers/specs/2026-01-01-c2-spec.md',
      '/repo/docs/superpowers/plans/2026-01-01-c2-plan.md',
      escalationPathOf('/th', 'C2'),
    ]);

    const skipped = nextCard(state, fakeIo);
    expect(skipped.kind).toBe('planning_needed'); // C3 has no spec/plan on disk
    expect((skipped as { cardId: string }).cardId).toBe('C3');

    const included = nextCard(state, fakeIo, { includeEscalated: true });
    expect(included).toEqual({ kind: 'card', cardId: 'C2', card: state.cards.C2 });
  });

  // P6 audit fix-round (blocker, skinnerA + scout): `deriveCardPhase` was already
  // file-driven (`core/loop/phase.ts`), but `nextCard` gated an `escalated` card on
  // `card.status` ALONE — a status nothing ever resets except the card shipping or
  // re-escalating. That meant the orchestrate-campaign skill's ruling ritual (append the
  // ruling, archive the escalation file) had ZERO effect on a flag-less re-trigger: the card
  // stayed silently skipped forever, exactly the B14 "every re-trigger needs
  // --include-escalated" trap this fix-list entry exists to close. This test reproduces that
  // exact defect: `card.status === 'escalated'`, but the escalation FILE has already been
  // archived (does not exist at its original path) — `nextCard` must now select the card
  // without `includeEscalated`, matching `deriveCardPhase`'s own file-driven short-circuit.
  test('an escalated card whose escalation file has already been archived (answered) becomes eligible again WITHOUT --include-escalated', () => {
    const state = parseState(
      fixtureState({
        sequence: ['C2'],
        cards: {
          C2: {
            status: 'escalated',
            spec: 'docs/superpowers/specs/2026-01-01-c2-spec.md',
            plan: 'docs/superpowers/plans/2026-01-01-c2-plan.md',
            branch: null,
            baseSha: null,
            pr: null,
            mergeSha: null,
            sessionId: null,
            updatedAt: null,
            tasks: [{ id: 'T1', heading: 'Task 1' }],
          },
        },
      }),
    ) as CampaignState;

    // The escalation file is deliberately ABSENT — `escalationPathOf('/th', 'C2')` is not in
    // the existing-paths list — simulating the skill having archived it (renamed away) as
    // part of writing its ruling, exactly as `plugins/tribe/skills/orchestrate-campaign/
    // SKILL.md`'s ritual now does.
    const fakeIo = io([
      '/repo/docs/superpowers/specs/2026-01-01-c2-spec.md',
      '/repo/docs/superpowers/plans/2026-01-01-c2-plan.md',
    ]);

    const result = nextCard(state, fakeIo); // no includeEscalated flag at all
    expect(result).toEqual({ kind: 'card', cardId: 'C2', card: state.cards.C2 });
  });

  test('returns PLANNING_NEEDED when the next card has no spec/plan recorded', () => {
    const state = parseState(fixtureState()) as CampaignState;
    // C2's spec/plan exist on disk in this io, but skip it to reach C3 by marking it shipped.
    const shippedC2 = {
      ...(fixtureState().cards as Record<string, Record<string, unknown>>).C2,
      status: 'shipped',
    };
    const withC2Shipped = parseState(
      fixtureState({
        cards: { ...(fixtureState().cards as Record<string, unknown>), C2: shippedC2 },
      }),
    ) as CampaignState;

    const result = nextCard(withC2Shipped, io([]));
    expect(result).toEqual({ kind: 'planning_needed', cardId: 'C3', missing: ['spec', 'plan'] });
  });

  test('returns PLANNING_NEEDED when spec/plan are recorded but missing on disk', () => {
    const state = parseState(fixtureState()) as CampaignState;
    const result = nextCard(state, io([])); // nothing exists on disk
    expect(result).toEqual({ kind: 'planning_needed', cardId: 'C2', missing: ['spec', 'plan'] });
  });

  test('returns done when every card is shipped or escalated-and-excluded', () => {
    const allShipped = parseState(
      fixtureState({
        cards: Object.fromEntries(
          Object.entries(fixtureState().cards as Record<string, Record<string, unknown>>).map(
            ([id, card]) => [id, { ...card, status: 'shipped' }],
          ),
        ),
      }),
    ) as CampaignState;

    expect(nextCard(allShipped, io([]))).toEqual({ kind: 'done' });
  });
});

describe('dependsOn / blocked / autoAnswerRounds — schema (Task 1)', () => {
  test('accepts an optional dependsOn array and autoAnswerRounds on a card, and the new `blocked` status', () => {
    const raw = fixtureState({
      cards: {
        ...(fixtureState().cards as Record<string, unknown>),
        C2: { ...cardFixture({ status: 'blocked' }), dependsOn: ['C1'], autoAnswerRounds: 1 },
      },
    });
    const state = parseState(raw) as CampaignState;
    expect(state.cards.C2?.status).toBe('blocked');
    expect(state.cards.C2?.dependsOn).toEqual(['C1']);
    expect(state.cards.C2?.autoAnswerRounds).toBe(1);
  });

  test('rejects a dependsOn entry naming a card id absent from cards', () => {
    const raw = fixtureState({
      cards: {
        ...(fixtureState().cards as Record<string, unknown>),
        C2: { ...cardFixture(), dependsOn: ['does-not-exist'] },
      },
    });
    expect(() => parseState(raw)).toThrow(UndefinedDependencyCardError);
  });

  test('rejects a direct self-dependency as a circular dependency', () => {
    const raw = fixtureState({
      cards: {
        ...(fixtureState().cards as Record<string, unknown>),
        C2: { ...cardFixture(), dependsOn: ['C2'] },
      },
    });
    expect(() => parseState(raw)).toThrow(CircularDependencyError);
  });

  test('rejects a transitive cycle (A -> B -> A), naming the cycle path', () => {
    const raw = fixtureState({
      cards: {
        C1: { ...cardFixture(), dependsOn: ['C2'] },
        C2: { ...cardFixture(), dependsOn: ['C1'] },
        C3: cardFixture(),
      },
    });
    let caught: unknown;
    try {
      parseState(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CircularDependencyError);
    expect((caught as CircularDependencyError).path).toEqual(['C1', 'C2', 'C1']);
  });

  test('a v2 state file with none of the optional fields round-trips byte-identical', async () => {
    // No card anywhere declares dependsOn/autoAnswerRounds, and no status is "blocked" — the
    // optional fields stay absent after a load -> serialize cycle (the v1 case is refused: see
    // 'a v1 state is refused with the re-author instruction').
    const raw = fixtureState();
    const originalBytes = `${JSON.stringify(raw, null, 2)}\n`;

    const loaded = await loadState(() => originalBytes);
    expect(loaded.cards.C2?.dependsOn).toBeUndefined();
    expect(loaded.cards.C2?.autoAnswerRounds).toBeUndefined();

    const serialized = serializeState(loaded);
    expect(serialized).toBe(originalBytes);
  });
});

describe('nextCard — progressable rule (dependsOn / blocked, spec §O4/W6, Task 1)', () => {
  test('no dependsOn on a card ⇒ independent, unchanged behavior', () => {
    const raw = fixtureState({
      sequence: ['A'],
      cards: { A: cardFixture() },
    });
    const state = parseState(raw) as CampaignState;
    expect(nextCard(state, allFilesExistIo())).toEqual({ kind: 'card', cardId: 'A', card: state.cards.A });
  });

  test('an empty dependsOn array behaves the same as no dependsOn ⇒ independent', () => {
    const raw = fixtureState({
      sequence: ['A'],
      cards: { A: { ...cardFixture(), dependsOn: [] } },
    });
    const state = parseState(raw) as CampaignState;
    expect(nextCard(state, allFilesExistIo())).toEqual({ kind: 'card', cardId: 'A', card: state.cards.A });
  });

  test('a merely-unshipped-but-healthy dependency (staged) skips the dependent WITHOUT marking it blocked', () => {
    const raw = fixtureState({
      sequence: ['B', 'A'],
      cards: {
        A: cardFixture({ status: 'staged' }),
        B: { ...cardFixture(), dependsOn: ['A'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    // B is skipped (A hasn't shipped yet); A is the progressable card. B's own status must be
    // left completely alone — it may still ship later THIS SAME pass once A ships.
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'card', cardId: 'A', card: state.cards.A });
    expect(state.cards.B?.status).toBe('staged');
  });

  test('a running (not yet shipped) dependency also merely skips the dependent, not blocks it', () => {
    // A is deliberately NOT in `sequence` (it's mid-flight, being resumed elsewhere) — this
    // isolates "B's only unmet dependency is running" from "A itself is also a candidate".
    const raw = fixtureState({
      sequence: ['B'],
      cards: {
        A: cardFixture({ status: 'running' }),
        B: { ...cardFixture(), dependsOn: ['A'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'done' });
    expect(state.cards.B?.status).toBe('staged');
  });

  test('an escalated dependency marks the dependent blocked (W6) — the dependent never starts', () => {
    const raw = fixtureState({
      sequence: ['B', 'A'],
      cards: {
        A: cardFixture({ status: 'escalated' }),
        B: { ...cardFixture(), dependsOn: ['A'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'done' }); // A is escalated+excluded, B is blocked: nothing progressable
    expect(state.cards.B?.status).toBe('blocked');
  });

  test('an already-blocked dependency also blocks its dependent (direct block propagation)', () => {
    const raw = fixtureState({
      sequence: ['C', 'B', 'A'],
      cards: {
        A: cardFixture({ status: 'escalated' }),
        B: { ...cardFixture({ status: 'blocked' }), dependsOn: ['A'] },
        C: { ...cardFixture(), dependsOn: ['B'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'done' });
    expect(state.cards.B?.status).toBe('blocked');
    expect(state.cards.C?.status).toBe('blocked');
  });

  test('unblocks when re-evaluated after the dependency has since shipped (blocked is recomputed, never trusted from disk)', () => {
    const raw = fixtureState({
      sequence: ['B', 'A'],
      cards: {
        A: cardFixture({ status: 'shipped' }),
        // B's status is stale 'blocked' from a previous run, but A has since shipped.
        B: { ...cardFixture({ status: 'blocked' }), dependsOn: ['A'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'card', cardId: 'B', card: state.cards.B });
  });

  // Warchief audit fix (task-1 reopened): `nextCard` was SETTING `blocked` but never
  // CLEARING a stale one for a card the sequence walk's early return never reaches — the
  // stored status disagreed with the derived truth, and that wrong status is exactly what
  // gets persisted and what Task 3's report would render. These two tests assert the
  // `.status` field directly (not merely object-reference equality via `state.cards.X`,
  // which the test above doesn't actually prove anything about the VALUE of `.status`).
  test('reconciles a stale blocked status back to staged once its dependency has shipped, even when an earlier card in sequence makes nextCard return before ever visiting it (Warchief audit probe)', () => {
    const raw = fixtureState({
      sequence: ['C', 'B'],
      cards: {
        A: cardFixture({ status: 'shipped' }),
        B: { ...cardFixture({ status: 'blocked' }), dependsOn: ['A'] },
        C: cardFixture({ status: 'staged' }), // independent; nextCard returns C immediately
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());

    expect(result).toEqual({ kind: 'card', cardId: 'C', card: state.cards.C });
    // The defect: B is never visited by the sequence walk (C is returned first), but its
    // dependency A has shipped — B must no longer read `blocked` once reality has moved on.
    expect(state.cards.B?.status).toBe('staged');

    // And the corrected status must actually be what gets persisted, not just what's held
    // in memory — the report (Task 3) reads the state file, not this in-memory object.
    const serialized = serializeState(state);
    expect(JSON.parse(serialized).cards.B.status).toBe('staged');
  });

  test('reconciliation is TOTAL, not walk-order dependent: a card that newly becomes blocked is marked even when an earlier independent card makes nextCard return before the walk ever reaches it', () => {
    const raw = fixtureState({
      sequence: ['D', 'X', 'Y'],
      cards: {
        D: cardFixture({ status: 'staged' }), // independent; nextCard returns D immediately
        X: { ...cardFixture({ status: 'staged' }), dependsOn: ['Y'] },
        Y: cardFixture({ status: 'escalated' }),
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());

    expect(result).toEqual({ kind: 'card', cardId: 'D', card: state.cards.D });
    // X is never visited by the sequence walk (D is returned first), but its dependency Y is
    // escalated — X must be marked blocked regardless, so Task 3's report is coherent.
    expect(state.cards.X?.status).toBe('blocked');
  });

  test('a dependency with two deps, one shipped one merely staged, still only skips (not blocks)', () => {
    const raw = fixtureState({
      sequence: ['C', 'A', 'B'],
      cards: {
        A: cardFixture({ status: 'shipped' }),
        B: cardFixture({ status: 'staged' }),
        C: { ...cardFixture(), dependsOn: ['A', 'B'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'card', cardId: 'B', card: state.cards.B });
    expect(state.cards.C?.status).toBe('staged');
  });

  test('a dependency with two deps, one shipped one escalated, gets blocked', () => {
    const raw = fixtureState({
      sequence: ['C', 'A', 'B'],
      cards: {
        A: cardFixture({ status: 'shipped' }),
        B: cardFixture({ status: 'escalated' }),
        C: { ...cardFixture(), dependsOn: ['A', 'B'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'done' });
    expect(state.cards.C?.status).toBe('blocked');
  });

  test('transitive blocked cascade computes to a fixpoint REGARDLESS of sequence order: A escalated -> B blocked -> C blocked, sequence deliberately worst-case [C, B, A]', () => {
    const raw = fixtureState({
      sequence: ['C', 'B', 'A'],
      cards: {
        A: cardFixture({ status: 'escalated' }),
        B: { ...cardFixture(), dependsOn: ['A'] },
        C: { ...cardFixture(), dependsOn: ['B'] },
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'done' });
    expect(state.cards.B?.status).toBe('blocked');
    expect(state.cards.C?.status).toBe('blocked');
  });

  test('an independent card (no dependsOn) still ships amid an unrelated blocked cascade', () => {
    const raw = fixtureState({
      sequence: ['C', 'B', 'A', 'D'],
      cards: {
        A: cardFixture({ status: 'escalated' }),
        B: { ...cardFixture(), dependsOn: ['A'] },
        C: { ...cardFixture(), dependsOn: ['B'] },
        D: cardFixture(), // no dependsOn: independent, unaffected by the A/B/C chain
      },
    });
    const state = parseState(raw) as CampaignState;
    const result = nextCard(state, allFilesExistIo());
    expect(result).toEqual({ kind: 'card', cardId: 'D', card: state.cards.D });
  });
});

describe('loadState/serializeState — unknown top-level keys survive a round trip', () => {
  test('a caller-authored "planning" metadata field is preserved (not stripped) by loadState + serializeState', async () => {
    const input = {
      v: 2,
      campaign: 'x',
      planning: { mode: 'shaman' },
      mergePolicy: 'regular',
      sequence: ['a'],
      schemaLockPaths: [],
      docsOnlyPaths: [],
      ownerOnlyEscalations: [],
      cards: {
        a: {
          status: 'staged', spec: null, plan: null, branch: null,
          baseSha: null, pr: null, mergeSha: null, sessionId: null, updatedAt: null,
          tasks: [{ id: 'T1', heading: 'Task 1' }],
        },
      },
    };
    const state = await loadState(() => JSON.stringify(input));
    expect((state as unknown as { planning?: unknown }).planning).toEqual({ mode: 'shaman' });
    const roundTripped = JSON.parse(serializeState(state));
    expect(roundTripped.planning).toEqual({ mode: 'shaman' });
  });
});

// P11 fix-list "out of scope" note: `resetCard` is the pure core transform behind the
// `reset-card` CLI subcommand — "so humans never hand-edit state.json." Field-by-field
// decisions (see the doc comment on `resetCard` in state.ts for the full rationale):
// status -> staged, sessionId/baseSha/pr/mergeSha/updatedAt -> null, autoAnswerRounds/
// healedResidue -> deleted (absent, matching their own schema default). `branch`, `pr`'s
// sibling `dependsOn`/`spec`/`plan`, and every unknown field are left exactly as they were.
describe('resetCard — pure core transform (P11 follow-up)', () => {
  test('unknown card id throws CardNotFoundError, naming the id', () => {
    const raw = fixtureState();
    const state = parseState(raw) as CampaignState;
    expect(() => resetCard(state, 'does-not-exist')).toThrow(CardNotFoundError);
    try {
      resetCard(state, 'does-not-exist');
    } catch (err) {
      expect((err as CardNotFoundError).cardId).toBe('does-not-exist');
    }
  });

  test('a fully-populated escalated card resets to staged with every per-run field cleared', () => {
    const raw = fixtureState({
      cards: {
        ...(fixtureState().cards as Record<string, unknown>),
        C1: {
          status: 'escalated',
          spec: 'docs/superpowers/specs/2026-01-01-c1-spec.md',
          plan: 'docs/superpowers/plans/2026-01-01-c1-plan.md',
          branch: 'feat/c1-widget',
          baseSha: 'aaaaaaa',
          pr: 10,
          mergeSha: 'bbbbbbb',
          sessionId: 'sess-c1',
          updatedAt: '2026-01-02T00:00:00Z',
          tasks: [{ id: 'T1', heading: 'Task 1' }],
          dependsOn: ['C2'],
          autoAnswerRounds: 2,
          healedResidue: ['remove_worktree'],
        },
        C2: cardFixture(),
      },
    });
    const state = parseState(raw) as CampaignState;

    const { state: next, summary } = resetCard(state, 'C1');
    const card = next.cards.C1 as Card;

    expect(card.status).toBe('staged');
    expect(card.sessionId).toBeNull();
    expect(card.baseSha).toBeNull();
    expect(card.pr).toBeNull();
    expect(card.mergeSha).toBeNull();
    expect(card.updatedAt).toBeNull();
    expect(card.autoAnswerRounds).toBeUndefined();
    expect(card.healedResidue).toBeUndefined();
    expect('autoAnswerRounds' in card).toBe(false);
    expect('healedResidue' in card).toBe(false);

    // Structural / reality-checked fields survive untouched — see doc comment for why.
    expect(card.branch).toBe('feat/c1-widget');
    expect(card.spec).toBe('docs/superpowers/specs/2026-01-01-c1-spec.md');
    expect(card.plan).toBe('docs/superpowers/plans/2026-01-01-c1-plan.md');
    expect(card.dependsOn).toEqual(['C2']);

    expect(summary).toEqual({
      cardId: 'C1',
      previousStatus: 'escalated',
      status: 'staged',
      clearedFields: ['sessionId', 'baseSha', 'pr', 'mergeSha', 'updatedAt', 'autoAnswerRounds', 'healedResidue'],
    });
  });

  test('an already-clean staged card resets idempotently with an empty clearedFields list', () => {
    const raw = fixtureState({
      cards: { ...(fixtureState().cards as Record<string, unknown>), C1: cardFixture() },
    });
    const state = parseState(raw) as CampaignState;

    const { state: next, summary } = resetCard(state, 'C1');

    expect(next.cards.C1).toEqual(cardFixture());
    expect(summary).toEqual({
      cardId: 'C1',
      previousStatus: 'staged',
      status: 'staged',
      clearedFields: [],
    });
  });

  test('unknown top-level and per-card fields survive resetCard byte-faithfully', () => {
    const raw = fixtureState({ note: 'unknown-top-level-field' }) as Record<string, unknown>;
    (raw.cards as Record<string, Record<string, unknown>>).C1 = {
      ...(raw.cards as Record<string, Record<string, unknown>>).C1,
      status: 'escalated',
      sessionId: 'sess-c1',
      reviewer: 'unknown-per-card-field',
    };
    const state = parseState(raw) as CampaignState;

    const { state: next } = resetCard(state, 'C1');

    expect((next as unknown as Record<string, unknown>).note).toBe('unknown-top-level-field');
    expect((next.cards.C1 as unknown as Record<string, unknown>).reviewer).toBe(
      'unknown-per-card-field',
    );

    const reparsed = JSON.parse(serializeState(next));
    expect(reparsed.note).toBe('unknown-top-level-field');
    expect(reparsed.cards.C1.reviewer).toBe('unknown-per-card-field');
  });

  test('does not mutate the input state (new object returned)', () => {
    const raw = fixtureState({
      cards: {
        ...(fixtureState().cards as Record<string, unknown>),
        C1: { ...cardFixture(), status: 'escalated', sessionId: 'sess-c1' },
      },
    });
    const state = parseState(raw) as CampaignState;
    const originalCard = state.cards.C1 as Card;

    const { state: next } = resetCard(state, 'C1');

    expect(originalCard.status).toBe('escalated');
    expect(originalCard.sessionId).toBe('sess-c1');
    expect(next).not.toBe(state);
    expect(next.cards.C1).not.toBe(originalCard);
  });
});

describe('v2 — the task index (D1)', () => {
  // `fixtureState()` is untyped JSON (as read from disk); these views let a test reach one card.
  const cardsOf = (s: Record<string, unknown>) => s.cards as Record<string, Card>;

  test('a v1 state is refused with the re-author instruction', () => {
    expect(() => parseState({ ...fixtureState(), v: 1 })).toThrow(/v1 has no task index/);
  });
  test('every card must carry at least one task', () => {
    const s = fixtureState();
    (cardsOf(s).C1 as { tasks: unknown }).tasks = [];
    expect(() => parseState(s)).toThrow();
  });
  test('task ids follow the grammar and are unique within a card', () => {
    const bad = fixtureState();
    (cardsOf(bad).C1 as Card).tasks = [{ id: 'T 1', heading: 'Task 1' }];
    expect(() => parseState(bad)).toThrow(/task id/);
    const dup = fixtureState();
    (cardsOf(dup).C1 as Card).tasks = [{ id: 'T1', heading: 'a' }, { id: 'T1', heading: 'b' }];
    expect(() => parseState(dup)).toThrow(/duplicate task id/);
  });
  test('runner-written progress round-trips; an authored v2 file round-trips byte-identical', () => {
    const authored = serializeState(fixtureState() as unknown as CampaignState);
    expect(serializeState(parseState(JSON.parse(authored)))).toBe(authored);
  });
  test('resetCard clears every passedSha and the doneSha', () => {
    const s = fixtureState();
    const c = cardsOf(s).C1 as Card;
    c.tasks = [{ id: 'T1', heading: 'Task 1', passedSha: 'abc' }];
    c.doneSha = 'abc';
    const { state, summary } = resetCard(parseState(s), 'C1');
    expect((state.cards.C1 as Card).tasks).toEqual([{ id: 'T1', heading: 'Task 1' }]);
    expect('doneSha' in (state.cards.C1 as Card)).toBe(false);
    expect(summary.clearedFields).toEqual(expect.arrayContaining(['tasks.passedSha', 'doneSha']));
  });
});
