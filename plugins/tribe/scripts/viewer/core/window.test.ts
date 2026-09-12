import { expect, test } from 'bun:test';
import { completeLines } from './window.ts';

const enc = new TextEncoder();

test('returns only whole lines; a trailing partial line (no terminating 0x0A) is dropped', () => {
  const bytes = enc.encode('one\ntwo\nthre'); // "thre" never sees a 0x0A
  expect(completeLines(bytes, false)).toEqual(['one', 'two']);
});

test('dropLeadingPartial discards the bytes before the first 0x0A', () => {
  const bytes = enc.encode('lea\ntwo\nthree\n'); // "lea" pretends to be a mid-row read start
  expect(completeLines(bytes, true)).toEqual(['two', 'three']);
  // without the flag, the same bytes keep the leading segment.
  expect(completeLines(bytes, false)).toEqual(['lea', 'two', 'three']);
});

test('a buffer whose boundary lands EXACTLY on a 0x0A drops nothing', () => {
  const bytes = enc.encode('one\ntwo\n'); // ends exactly on a 0x0A — no partial trailing segment
  expect(completeLines(bytes, false)).toEqual(['one', 'two']);
  // even with dropLeadingPartial, only the FIRST segment is affected — the exact boundary at the
  // end still drops nothing extra.
  expect(completeLines(bytes, true)).toEqual(['two']);
});

test('a buffer with no 0x0A at all returns no lines, however dropLeadingPartial is set', () => {
  const bytes = enc.encode('no newline anywhere in here');
  expect(completeLines(bytes, false)).toEqual([]);
  expect(completeLines(bytes, true)).toEqual([]);
});
