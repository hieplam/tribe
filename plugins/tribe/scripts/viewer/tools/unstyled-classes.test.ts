// tools/unstyled-classes.test.ts — unit tests for the PURE core `findUnstyledClasses` over inline
// strings (no filesystem). Each test pins one extraction or matching shape from the Task-1 oracle:
// what counts as a *used* class in a `className`, and what counts as a class being *styled* in CSS.
import { expect, test, describe } from 'bun:test';
import { findUnstyledClasses } from './unstyled-classes.ts';

/** Convenience: run the core over one tsx source + one css source. */
function run(tsx: string, css: string) {
  return findUnstyledClasses([tsx], [css]);
}

describe('used-class extraction', () => {
  test('a static className string yields every whitespace-separated token', () => {
    const { used } = run('<div className="a b c" />', '');
    expect(used).toEqual(['a', 'b', 'c']);
  });

  test('a template literal keeps static segments and skips the dynamic modifier', () => {
    // The trailing `tool--` is a *prefix* of a `${…}` interpolation, not a complete class name.
    const { used } = run('<div className={`tool tool--${state}`} />', '');
    expect(used).toEqual(['tool']);
  });

  test('a ternary in className={…} yields both branch strings', () => {
    const { used } = run("<div className={cond ? 'a' : 'b'} />", '');
    expect(used).toEqual(['a', 'b']);
  });

  test('a string literal inside className={…} splits on whitespace', () => {
    const { used } = run("<div className={'x y'} />", '');
    expect(used).toEqual(['x', 'y']);
  });

  test('a fully dynamic className={expr} yields no class tokens', () => {
    const { used } = run('<div className={classes} />', '');
    expect(used).toEqual([]);
  });

  test('tokens that fail /^[A-Za-z_][\\w-]*$/ are dropped', () => {
    // `1bad` starts with a digit; `-bad` starts with a hyphen; both are rejected.
    const { used } = run('<div className="1bad -bad ok_1 ok-2" />', '');
    expect(used).toEqual(['ok-2', 'ok_1']);
  });

  test('`className` inside a JS string or a comment is NOT an attribute', () => {
    const src =
      "// never render <span className=\"ghost\">\n" +
      "const label = 'inline <span className=\"phantom\">';\n" +
      '<div className="real" />';
    const { used } = run(src, '');
    expect(used).toEqual(['real']);
  });

  test('classes are de-duplicated and sorted across sources', () => {
    const { used } = findUnstyledClasses(['<div className="b a" />', '<p className="a c" />'], ['']);
    expect(used).toEqual(['a', 'b', 'c']);
  });
});

describe('styled-class matching', () => {
  test('a selector list styles every class it names', () => {
    const { used, unstyled } = run('<div className="a b" />', '.a, .b { color: red }');
    expect(used).toEqual(['a', 'b']);
    expect(unstyled).toEqual([]);
  });

  test('a compound selector styles each class in the compound', () => {
    const { unstyled } = run('<div className="a b x" />', '.a.b {} .x .a:hover {}');
    expect(unstyled).toEqual([]);
  });

  test('prefix trap: .tool does NOT style tool__name, and vice versa', () => {
    // `.tool` present, `.tool__name` absent -> `tool__name` is unstyled.
    const a = run('<div className="tool tool__name" />', '.tool { color: red }');
    expect(a.unstyled).toEqual(['tool__name']);

    // `.tool__name` present, `.tool` absent -> `tool` is unstyled.
    const b = run('<div className="tool tool__name" />', '.tool__name { color: red }');
    expect(b.unstyled).toEqual(['tool']);
  });

  test('an empty stylesheet leaves every used class unstyled', () => {
    const { used, unstyled } = run('<div className="a b c" />', '');
    expect(unstyled).toEqual(used);
  });

  test('a class named only inside a CSS comment is NOT styled', () => {
    const { unstyled } = run('<div className="ghost" />', '/* the .ghost panel */ .other {}');
    expect(unstyled).toEqual(['ghost']);
  });
});
