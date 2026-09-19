// Postcondition verification (spec §5.2/§5.3, card guardrail 2 + S-P13). Section 1 is the
// plan's Step 1 test skeleton (extended with the Oracle's remaining enumerated cases); section 2
// is the plan's Step 2 integrity skeleton, implemented VERBATIM.
import { expect, test } from 'bun:test';
import { parseParkMarker, verifyClosing, verifyRatify, verifyRuling } from './verify.ts';

// ---------------------------------------------------------------------------------------------
// Section 1 — Step 1: the ruling postcondition, plus park-marker parsing (plan lines 976-982).
// ---------------------------------------------------------------------------------------------

const RULED_BEFORE = '# answers\n\n## R1 one\nratified-as: operational\n';
const RULED_AFTER = RULED_BEFORE + '\n## R2 two\nratified-as: rule docs/x.md\n';

test('a new ratified block verifies as ruled, carrying its id', () => {
  const v = verifyRuling({ before: RULED_BEFORE, after: RULED_AFTER, repoStatus: '' });
  expect(v.outcome).toBe('ruled');
  expect(v.rulingId).toBe('R2 two');
  expect(v.retryable).toBe(true);
});

test('the very first ruling ever, appended to an empty answers.md, still verifies as ruled', () => {
  const v = verifyRuling({
    before: '',
    after: '## R1 one\nratified-as: operational\n',
    repoStatus: '',
  });
  expect(v.outcome).toBe('ruled');
  expect(v.rulingId).toBe('R1 one');
});

test('a new block with ratified-as: pending is a failed attempt, not a ruling', () => {
  const after = RULED_BEFORE + '\n## R2 two\nratified-as: pending\n';
  const v = verifyRuling({ before: RULED_BEFORE, after, repoStatus: '' });
  expect(v.outcome).toBe('failed');
  expect(v.retryable).toBe(true);
});

test('a new block with no ratified-as: field at all is a failed attempt', () => {
  const after = RULED_BEFORE + '\n## R2 two\nsome other line\n';
  const v = verifyRuling({ before: RULED_BEFORE, after, repoStatus: '' });
  expect(v.outcome).toBe('failed');
});

test('no new block and no park marker is a failed attempt', () => {
  const v = verifyRuling({ before: RULED_BEFORE, after: RULED_BEFORE, repoStatus: '' });
  expect(v.outcome).toBe('failed');
  expect(v.retryable).toBe(true);
});

test('an unchanged answers.md plus a valid park marker verifies as parked, carrying the marker kind', () => {
  const marker = JSON.stringify({ v: 1, kind: 'owner_only', cardId: 'c1', trigger: 't', note: 'n' });
  const v = verifyRuling({ before: RULED_BEFORE, after: RULED_BEFORE, repoStatus: '', marker });
  expect(v.outcome).toBe('parked');
  expect(v.parkMarkerKind).toBe('owner_only');
  expect(v.malformedMarkers).toBe(0);
});

test('a park marker with kind "banana" parks as too_hard and counts one malformed-marker event', () => {
  const marker = JSON.stringify({ v: 1, kind: 'banana', cardId: 'c1', trigger: 't', note: 'n' });
  const v = verifyRuling({ before: RULED_BEFORE, after: RULED_BEFORE, repoStatus: '', marker });
  expect(v.outcome).toBe('parked');
  expect(v.parkMarkerKind).toBe('too_hard');
  expect(v.malformedMarkers).toBe(1);
});

test('unparseable marker JSON parks as too_hard, counted, and never throws', () => {
  const marker = '{ this is not json';
  expect(() => verifyRuling({ before: RULED_BEFORE, after: RULED_BEFORE, repoStatus: '', marker }))
    .not.toThrow();
  const v = verifyRuling({ before: RULED_BEFORE, after: RULED_BEFORE, repoStatus: '', marker });
  expect(v.outcome).toBe('parked');
  expect(v.parkMarkerKind).toBe('too_hard');
  expect(v.malformedMarkers).toBe(1);
});

test('a non-empty git status --porcelain fails the ruling, even when a valid ruling landed (decision 4)', () => {
  const v = verifyRuling({
    before: RULED_BEFORE,
    after: RULED_AFTER,
    repoStatus: ' M plugins/tribe/scripts/runner/core/foo.ts\n',
  });
  expect(v.outcome).toBe('failed');
  expect(v.reason).toBe('repo_touched');
  expect(v.retryable).toBe(true);
});

// parseParkMarker, unit-tested directly (Step 3's fourth export).

test('parseParkMarker accepts kind: too_hard', () => {
  const marker = JSON.stringify({ v: 1, kind: 'too_hard', cardId: 'c1', trigger: 't', note: 'n' });
  expect(parseParkMarker(marker)).toEqual({ kind: 'too_hard', malformed: false });
});

test('parseParkMarker treats a missing kind field as malformed, never a throw', () => {
  const marker = JSON.stringify({ v: 1, cardId: 'c1', trigger: 't', note: 'n' });
  expect(() => parseParkMarker(marker)).not.toThrow();
  expect(parseParkMarker(marker)).toEqual({ kind: 'too_hard', malformed: true });
});

// verifyClosing (spec §5.4 postconditions).

test('verifyClosing: a non-empty final report plus zero unratified rulings verifies as closed', () => {
  const v = verifyClosing({ finalReport: '# Final report\n\nAll cards shipped.\n', answers: RULED_BEFORE });
  expect(v.outcome).toBe('closed');
});

test('verifyClosing: a missing final report is a failed attempt', () => {
  const v = verifyClosing({ finalReport: null, answers: RULED_BEFORE });
  expect(v.outcome).toBe('failed');
  expect(v.retryable).toBe(true);
});

test('verifyClosing: an unratified ruling still on disk is a failed attempt', () => {
  const unratified = '## R1 one\nratified-as: pending\n';
  const v = verifyClosing({ finalReport: 'report body', answers: unratified });
  expect(v.outcome).toBe('failed');
});

// ---------------------------------------------------------------------------------------------
// Section 2 — Step 2: the failing integrity tests (S-P13, spec §5.2/§5.3), implemented VERBATIM
// from the plan (docs/superpowers/plans/2026-09-18-campaign-supervisor.md lines 987-1030).
// ---------------------------------------------------------------------------------------------

const PRE = '# answers\n\n## R1 one\nratified-as: operational\n';
const APPENDED = PRE + '\n## R2 two\nratified-as: operational\n';

test('a legitimate append verifies as ruled', () => {
  expect(verifyRuling({ before: PRE, after: APPENDED, repoStatus: '' }).outcome).toBe('ruled');
});

test('a session that REPLACED the file parks history_rewritten, and is not retryable', () => {
  const clobbered = '## R2 two\nratified-as: operational\n'; // R1 is gone
  const v = verifyRuling({ before: PRE, after: clobbered, repoStatus: '' });
  expect(v.outcome).toBe('history_rewritten');
  expect(v.retryable).toBe(false);
});

test('a session that edited an EARLIER ruling parks history_rewritten', () => {
  const edited = PRE.replace('R1 one', 'R1 one (tidied)') + '\n## R2 two\nratified-as: operational\n';
  expect(verifyRuling({ before: PRE, after: edited, repoStatus: '' }).outcome).toBe('history_rewritten');
});

test('the integrity check runs BEFORE the new-block check: a clobber with a valid new block still parks', () => {
  const v = verifyRuling({ before: PRE, after: '## R2 two\nratified-as: rule docs/x.md\n', repoStatus: '' });
  expect(v.outcome).toBe('history_rewritten');
});

// F2 fix: the history-integrity check must not be bypassable by extending the FINAL LINE of a
// `before` that does not end in `\n` — `after.startsWith(before)` alone is blind to a session
// that appends bytes onto the tail of the existing last line rather than after it.
test('extending the final line of a before with no trailing newline is history_rewritten', () => {
  const before = '## R1 one\nratified-as: operational'; // deliberately no trailing \n
  const after = before + ' DESTROYED\n## R2 two\nratified-as: operational\n';
  const v = verifyRuling({ before, after, repoStatus: '' });
  expect(v.outcome).toBe('history_rewritten');
  expect(v.retryable).toBe(false);
});

test('a clean append at a fresh line still verifies ruled even when before lacks a trailing newline', () => {
  const before = '## R1 one\nratified-as: operational'; // no trailing \n, but the append starts with one
  const after = before + '\n## R2 two\nratified-as: operational\n';
  const v = verifyRuling({ before, after, repoStatus: '' });
  expect(v.outcome).toBe('ruled');
  expect(v.rulingId).toBe('R2 two');
});

test('ratify may change only the ids it was given', () => {
  const before = '## R1 a\nratified-as: pending\n\n## R2 b\nratified-as: operational\n';
  const okAfter = '## R1 a\nratified-as: operational\n\n## R2 b\nratified-as: operational\n';
  expect(verifyRatify({ before, after: okAfter, named: ['R1 a'] }).outcome).toBe('ratified');

  const badAfter = '## R1 a\nratified-as: operational\n\n## R2 b\nratified-as: dismissed\n';
  const v = verifyRatify({ before, after: badAfter, named: ['R1 a'] });
  expect(v.outcome).toBe('ratify_out_of_scope');
  expect(v.retryable).toBe(false);
});

test('ratify that drops a ruling id entirely parks out_of_scope', () => {
  const before = '## R1 a\nratified-as: pending\n\n## R2 b\nratified-as: operational\n';
  expect(verifyRatify({ before, after: '## R1 a\nratified-as: operational\n', named: ['R1 a'] }).outcome)
    .toBe('ratify_out_of_scope');
});

// F3 fix: spec §5.3 check 1 — "every ruling block whose id is NOT in unratifiedRulings is
// byte-identical before and after". A brand-new injected block's id is not in `before` at all,
// so it is trivially "not in unratifiedRulings" and not byte-identical (it did not exist); a
// ratify session never adds rulings.
test('ratify that INJECTS a fabricated new ruling block parks ratify_out_of_scope', () => {
  const before = '## R1 a\nratified-as: pending\n\n## R2 b\nratified-as: operational\n';
  const after = '## R1 a\nratified-as: operational\n\n## R2 b\nratified-as: operational\n'
    + '\n## R3 evil\nratified-as: operational\n';
  const v = verifyRatify({ before, after, named: ['R1 a'] });
  expect(v.outcome).toBe('ratify_out_of_scope');
  expect(v.retryable).toBe(false);
});
