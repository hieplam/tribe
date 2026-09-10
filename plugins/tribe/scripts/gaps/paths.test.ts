// paths.test.ts — pure path-overlap predicates (card C1, extracted from gap-reconcile.ts).
import { describe, expect, test } from 'bun:test';
import { anyPathOverlap, pathsOverlap } from './paths.ts';

describe('pathsOverlap', () => {
  test('identical paths overlap', () => expect(pathsOverlap('src/a.ts', 'src/a.ts')).toBe(true));
  test('a directory contains a file below it, in both argument orders', () => {
    expect(pathsOverlap('src/', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('src/a.ts', 'src/')).toBe(true);
    expect(pathsOverlap('src', 'src/a.ts')).toBe(true);
  });
  test('a shared name prefix that is not a directory boundary does not overlap', () => {
    expect(pathsOverlap('src/a.ts', 'src/ab.ts')).toBe(false);
    expect(pathsOverlap('lib', 'library/a.ts')).toBe(false);
  });
});

describe('anyPathOverlap', () => {
  test('true when any pair overlaps', () =>
    expect(anyPathOverlap(['docs/x.md', 'src/'], ['README.md', 'src/a.ts'])).toBe(true));
  test('false for wholly disjoint lists, and for an empty list', () => {
    expect(anyPathOverlap(['docs/x.md'], ['src/a.ts'])).toBe(false);
    expect(anyPathOverlap([], ['src/a.ts'])).toBe(false);
  });
});
