// Tests for residue.ts (P4 fix-list item): the pure decision of which SHIPPED-verification
// residue is safe to self-heal between the first failed verify and the retry. No I/O here —
// every input arrives as a plain argument (pure-core rule); the edge (`healSafeResidue` in
// `core/loop/card-actions.ts`) is where the real `git`/`gh` calls live.
import { describe, expect, test } from 'bun:test';
import { decideBaseSyncHeal, decideResidueHeal } from './residue.ts';
import type { DecideResidueHealInput } from './residue.ts';

function fixtureInput(overrides: Partial<DecideResidueHealInput> = {}): DecideResidueHealInput {
  return {
    mergedPassed: true,
    detail: 'feat/c1-widget: remote branch still present',
    worktreePath: null,
    worktreeStatusClean: false,
    tipIsAncestorOfBase: false,
    branch: 'feat/c1-widget',
    ...overrides,
  };
}

describe('decideResidueHeal', () => {
  test('merged did NOT pass -> no heal at all, regardless of detail', () => {
    const actions = decideResidueHeal(
      fixtureInput({
        mergedPassed: false,
        detail: 'feat/c1-widget: remote branch still present and worktree still present',
        worktreePath: '/wt/c1',
        worktreeStatusClean: true,
        tipIsAncestorOfBase: true,
      }),
    );
    expect(actions).toEqual([]);
  });

  test('merged passed + detail names remote branch residue -> delete_remote_branch', () => {
    const actions = decideResidueHeal(
      fixtureInput({ detail: 'feat/c1-widget: remote branch still present' }),
    );
    expect(actions).toEqual([{ kind: 'delete_remote_branch', branch: 'feat/c1-widget' }]);
  });

  test('merged passed + worktree residue + clean + ancestor -> includes remove_worktree', () => {
    const actions = decideResidueHeal(
      fixtureInput({
        detail: 'feat/c1-widget: worktree still present',
        worktreePath: '/wt/c1',
        worktreeStatusClean: true,
        tipIsAncestorOfBase: true,
      }),
    );
    expect(actions).toEqual([{ kind: 'remove_worktree', path: '/wt/c1', branch: 'feat/c1-widget' }]);
  });

  test('dirty worktree -> no remove_worktree even though ancestor holds', () => {
    const actions = decideResidueHeal(
      fixtureInput({
        detail: 'feat/c1-widget: worktree still present',
        worktreePath: '/wt/c1',
        worktreeStatusClean: false,
        tipIsAncestorOfBase: true,
      }),
    );
    expect(actions).toEqual([]);
  });

  test('non-ancestor tip -> no remove_worktree even though worktree is clean', () => {
    const actions = decideResidueHeal(
      fixtureInput({
        detail: 'feat/c1-widget: worktree still present',
        worktreePath: '/wt/c1',
        worktreeStatusClean: true,
        tipIsAncestorOfBase: false,
      }),
    );
    expect(actions).toEqual([]);
  });

  test('null worktreePath -> no remove_worktree even if clean+ancestor flags are true', () => {
    const actions = decideResidueHeal(
      fixtureInput({
        detail: 'feat/c1-widget: worktree still present',
        worktreePath: null,
        worktreeStatusClean: true,
        tipIsAncestorOfBase: true,
      }),
    );
    expect(actions).toEqual([]);
  });

  test('both residues present and all-safe -> both actions, remote branch first', () => {
    const actions = decideResidueHeal(
      fixtureInput({
        detail: 'feat/c1-widget: worktree still present and remote branch still present',
        worktreePath: '/wt/c1',
        worktreeStatusClean: true,
        tipIsAncestorOfBase: true,
      }),
    );
    expect(actions).toEqual([
      { kind: 'delete_remote_branch', branch: 'feat/c1-widget' },
      { kind: 'remove_worktree', path: '/wt/c1', branch: 'feat/c1-widget' },
    ]);
  });
});

describe('decideBaseSyncHeal (D4 safe heal)', () => {
  const ok = { mergedPassed: true, localBaseFailed: true, checkoutOnBase: true, checkoutClean: true, localIsAncestorOfRemote: true };
  test('merged, checkout on base, clean, strictly behind -> fast-forward', () => {
    expect(decideBaseSyncHeal(ok)).toEqual([{ kind: 'fast_forward_base' }]);
  });
  test.each([
    ['PR not merged', { mergedPassed: false }],
    ['point already passes', { localBaseFailed: false }],
    ['checkout parked on another ref', { checkoutOnBase: false }],
    ['checkout dirty', { checkoutClean: false }],
    ['local base diverged', { localIsAncestorOfRemote: false }],
  ])('%s -> no heal', (_name, patch) => {
    expect(decideBaseSyncHeal({ ...ok, ...patch })).toEqual([]);
  });
});
