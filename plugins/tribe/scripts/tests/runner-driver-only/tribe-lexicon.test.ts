// Tests for tribe-lexicon.ts's one exclusion (ruling R-PR3-FLAG): the literal `--skip-gap-gate`
// flag is D6's opt-out of the gap-gate, so it is not counted; every other gap-gate mention is.
import { expect, test } from 'bun:test';
import { countTribeMentions } from './tribe-lexicon.ts';

test('the literal --skip-gap-gate flag is not a Tribe mention', () => {
  expect(countTribeMentions('run verify-shipped --skip-gap-gate')).toEqual([]);
});

test('every other gap-gate mention still counts', () => {
  expect(countTribeMentions('run gap-gate.ts')).toEqual([{ id: 'gap-gate', count: 1 }]);
  expect(countTribeMentions('the gap-gate stamp')).toEqual([{ id: 'gap-gate', count: 1 }]);
  expect(countTribeMentions('the gap gate')).toEqual([{ id: 'gap-gate', count: 1 }]);
  expect(countTribeMentions('--SKIP-GAP-GATE')).toEqual([{ id: 'gap-gate', count: 1 }]);
  expect(countTribeMentions('--skip-gap-gate and the gap-gate stamp')).toEqual([{ id: 'gap-gate', count: 1 }]);
});
