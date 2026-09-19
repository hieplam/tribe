/**
 * tools/unstyled-classes.ts — V1's measuring tool: how many CSS classes the client puts on a
 * `className` are NOT styled by any rule in the client stylesheets. It is a read-only corpus
 * measurement, NOT runtime code (D18): `tools/` sits outside the D16 purity wall, is never
 * imported by any file under `core/`, `adapters/`, `serve.ts` or `client/src/**`, and touches the
 * filesystem freely (only in the impure edge below) — that is exactly what a measurement script is
 * for. The styling plan ratchets against the number this prints.
 *
 * ORACLE (this file's own contract — no external standard governs it):
 *   - USED  = every class token that appears in a `className` attribute of the tsx sources.
 *       * `className="a b"`         -> `a`, `b`
 *       * `className={'a'}` / `{cond ? 'a' : 'b'}` -> every whitespace-separated token of every
 *         string literal in the expression.
 *       * `` className={`tool tool--${state}`} `` -> `tool` only: a static segment token that abuts
 *         a `${…}` interpolation (no whitespace between them) is a *partial*, not a class name, and
 *         is skipped — the dynamic modifier is not a class name either.
 *       * `className` appearing inside a JS string, a template, or a comment is NOT an attribute.
 *     Every token must match /^[A-Za-z_][\w-]*$/; anything else is dropped.
 *   - STYLED = the class appears as `.name` in the CSS, where the next character is a
 *     non-identifier char (`[^\w-]`) or the end of input — anywhere in a selector list or compound
 *     selector. So `.tool` does NOT style `tool__name`, and `.a.b` styles both `a` and `b`. CSS
 *     comments are stripped first so a class named only in a comment does not count as styled.
 *   - UNSTYLED = USED classes with no STYLED match.
 *
 * Usage:  bun tools/unstyled-classes.ts
 *   Prints `unstyled N of M` (N unstyled, M used) then one unstyled class per line; exit 0.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A class token: a CSS identifier that starts with a letter or underscore. Its charset
 * (`[A-Za-z0-9_-]`) contains no regex-special character, so tokens are safe to splice into a
 * RegExp below without escaping. */
const CLASS_TOKEN = /^[A-Za-z_][\w-]*$/;

const CLASSNAME = 'className';

// ── Pure core ──────────────────────────────────────────────────────────────────────────────────

export interface UnstyledReport {
  /** Every used class, de-duplicated and sorted. */
  used: string[];
  /** The used classes with no styling rule, de-duplicated and sorted. */
  unstyled: string[];
}

/** PURE: given the tsx sources and css sources as strings, report which used classes are unstyled.
 * No filesystem, clock, env, or network — everything it needs arrives as arguments. */
export function findUnstyledClasses(tsxSources: string[], cssSources: string[]): UnstyledReport {
  const used = new Set<string>();
  for (const tsx of tsxSources) {
    for (const cls of extractUsedClasses(tsx)) used.add(cls);
  }
  const css = cssSources.map(stripCssComments).join('\n');
  const usedArr = [...used].sort();
  const unstyled = usedArr.filter((cls) => !isStyled(cls, css));
  return { used: usedArr, unstyled };
}

/** A class is styled when `.name` occurs with a non-identifier char (or end of input) after it, so
 * `.tool` never matches inside `.tool__name`. The class charset guarantees no regex escaping is
 * needed (see CLASS_TOKEN). */
function isStyled(cls: string, css: string): boolean {
  return new RegExp('\\.' + cls + '(?![\\w-])').test(css);
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// ── Extraction (pure) ────────────────────────────────────────────────────────────────────────

/** Walk a tsx source once and collect every class token used in a `className` attribute. Strings,
 * templates, and comments are skipped so a stray `className=` inside any of them is never read as
 * an attribute. */
function extractUsedClasses(tsx: string): string[] {
  const out = new Set<string>();
  const n = tsx.length;
  let i = 0;
  while (i < n) {
    const c = tsx[i];
    if (c === '/' && tsx[i + 1] === '/') {
      i = skipLineComment(tsx, i);
    } else if (c === '/' && tsx[i + 1] === '*') {
      i = skipBlockComment(tsx, i);
    } else if (c === '"' || c === "'") {
      i = readString(tsx, i).end; // a string that is not a className value — skip it
    } else if (c === '`') {
      i = skipTemplate(tsx, i);
    } else if (c === 'c' && isClassNameAttrStart(tsx, i)) {
      i = consumeClassNameValue(tsx, i, out);
    } else {
      i += 1;
    }
  }
  return [...out];
}

/** True when `className` starts exactly at `i` (identifier boundaries on both sides), so
 * `myClassName` and `classNames` do not match. */
function isClassNameAttrStart(src: string, i: number): boolean {
  if (!src.startsWith(CLASSNAME, i)) return false;
  const before = i > 0 ? src[i - 1] : '';
  const after = src[i + CLASSNAME.length] ?? '';
  return !isIdentChar(before) && !isIdentChar(after);
}

/** Read the value of the `className` attribute that starts at `i`, adding its class tokens to
 * `out`, and return the index just past the value. Handles both `="…"` and `={…}` forms; if what
 * follows is neither, nothing is added and we advance past the keyword. */
function consumeClassNameValue(src: string, i: number, out: Set<string>): number {
  let j = skipWs(src, i + CLASSNAME.length);
  if (src[j] !== '=') return i + CLASSNAME.length;
  j = skipWs(src, j + 1);
  const q = src[j];
  if (q === '"' || q === "'") {
    const { content, end } = readString(src, j);
    for (const tok of splitWs(content)) addToken(out, tok);
    return end;
  }
  if (q === '{') {
    const { expr, end } = readBraced(src, j);
    for (const tok of extractFromExpression(expr)) addToken(out, tok);
    return end;
  }
  return i + CLASSNAME.length;
}

/** Pull class tokens out of a `className={…}` expression body: every string literal contributes
 * its whitespace-separated tokens; every template literal contributes its static-segment tokens
 * with interpolation-abutting partials dropped. Everything else (identifiers, operators) is
 * ignored. */
function extractFromExpression(expr: string): string[] {
  const out: string[] = [];
  const n = expr.length;
  let i = 0;
  while (i < n) {
    const c = expr[i];
    if (c === '/' && expr[i + 1] === '/') {
      i = skipLineComment(expr, i);
    } else if (c === '/' && expr[i + 1] === '*') {
      i = skipBlockComment(expr, i);
    } else if (c === '"' || c === "'") {
      const { content, end } = readString(expr, i);
      for (const tok of splitWs(content)) out.push(tok);
      i = end;
    } else if (c === '`') {
      const { tokens, end } = readTemplate(expr, i);
      for (const tok of tokens) out.push(tok);
      i = end;
    } else {
      i += 1;
    }
  }
  return out;
}

// ── Low-level scanners (pure) ─────────────────────────────────────────────────────────────────

/** Read a single- or double-quoted string starting at `i` (src[i] is the quote). Returns the raw
 * inner content and the index just past the closing quote. Backslash escapes are honoured so an
 * escaped quote does not end the string early. */
function readString(src: string, i: number): { content: string; end: number } {
  const quote = src[i];
  let out = '';
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') {
      out += src[j + 1] ?? '';
      j += 2;
      continue;
    }
    if (ch === quote) return { content: out, end: j + 1 };
    out += ch;
    j += 1;
  }
  return { content: out, end: src.length };
}

/** Read a template literal starting at `i` (src[i] is a backtick), returning its complete class
 * tokens. A static run's first token is dropped when the run directly follows a `${…}` (a
 * continuation), and its last token is dropped when the run directly precedes a `${…}` (a prefix);
 * a token is complete only when bounded by whitespace or by the template's own delimiters. */
function readTemplate(src: string, i: number): { tokens: string[]; end: number } {
  const tokens: string[] = [];
  let seg = '';
  let precededByInterp = false; // does the current static run begin right after a `${…}`?
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') {
      seg += (src[j] ?? '') + (src[j + 1] ?? '');
      j += 2;
      continue;
    }
    if (ch === '`') {
      pushSegmentTokens(tokens, seg, precededByInterp, false);
      return { tokens, end: j + 1 };
    }
    if (ch === '$' && src[j + 1] === '{') {
      pushSegmentTokens(tokens, seg, precededByInterp, true);
      seg = '';
      precededByInterp = true;
      j = skipInterpolation(src, j + 2);
      continue;
    }
    seg += ch;
    j += 1;
  }
  pushSegmentTokens(tokens, seg, precededByInterp, false); // unterminated template
  return { tokens, end: src.length };
}

/** Split one static run of a template into complete class tokens, dropping the partials that abut
 * an interpolation. */
function pushSegmentTokens(
  tokens: string[],
  seg: string,
  precededByInterp: boolean,
  followedByInterp: boolean,
): void {
  if (seg === '') return;
  const parts = splitWs(seg);
  if (parts.length === 0) return;
  const leftComplete = /^\s/.test(seg) || !precededByInterp;
  const rightComplete = /\s$/.test(seg) || !followedByInterp;
  if (!leftComplete) parts.shift(); // first token continues the preceding `${…}`
  if (parts.length > 0 && !rightComplete) parts.pop(); // last token prefixes the next `${…}`
  for (const p of parts) tokens.push(p);
}

/** Skip a `{…}` block starting at `i` (src[i] is `{`), returning the inner body and the index just
 * past the matching `}`. Strings, templates, and comments inside are skipped so their braces do not
 * affect the depth count. */
function readBraced(src: string, i: number): { expr: string; end: number } {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '/' && src[j + 1] === '/') {
      j = skipLineComment(src, j);
    } else if (ch === '/' && src[j + 1] === '*') {
      j = skipBlockComment(src, j);
    } else if (ch === '"' || ch === "'") {
      j = readString(src, j).end;
    } else if (ch === '`') {
      j = skipTemplate(src, j);
    } else if (ch === '{') {
      depth += 1;
      j += 1;
    } else if (ch === '}') {
      depth -= 1;
      j += 1;
      if (depth === 0) return { expr: src.slice(i + 1, j - 1), end: j };
    } else {
      j += 1;
    }
  }
  return { expr: src.slice(i + 1), end: src.length };
}

/** Skip an entire template literal (src[i] is a backtick), handling its own `${…}` interpolations,
 * and return the index just past the closing backtick. Used when we do not need the template's
 * tokens (e.g. a template that is not a className value). */
function skipTemplate(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') {
      j += 2;
    } else if (ch === '`') {
      return j + 1;
    } else if (ch === '$' && src[j + 1] === '{') {
      j = skipInterpolation(src, j + 2);
    } else {
      j += 1;
    }
  }
  return src.length;
}

/** Skip a template interpolation body starting at `j` (just past `${`), returning the index just
 * past its matching `}`. Nested strings, templates, and braces are all consumed. */
function skipInterpolation(src: string, j: number): number {
  let depth = 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '"' || ch === "'") {
      j = readString(src, j).end;
    } else if (ch === '`') {
      j = skipTemplate(src, j);
    } else if (ch === '{') {
      depth += 1;
      j += 1;
    } else if (ch === '}') {
      depth -= 1;
      j += 1;
      if (depth === 0) return j;
    } else {
      j += 1;
    }
  }
  return src.length;
}

function skipLineComment(src: string, i: number): number {
  const nl = src.indexOf('\n', i + 2);
  return nl === -1 ? src.length : nl;
}

function skipBlockComment(src: string, i: number): number {
  const close = src.indexOf('*/', i + 2);
  return close === -1 ? src.length : close + 2;
}

function skipWs(src: string, i: number): number {
  let j = i;
  while (j < src.length && isWs(src[j])) j += 1;
  return j;
}

function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function isIdentChar(ch: string): boolean {
  return /[\w$]/.test(ch);
}

function splitWs(s: string): string[] {
  return s.split(/\s+/).filter((t) => t.length > 0);
}

function addToken(out: Set<string>, tok: string): void {
  if (CLASS_TOKEN.test(tok)) out.add(tok);
}

// ── Impure edge: read the real client sources ─────────────────────────────────────────────────

export interface ClientSources {
  tsxSources: string[];
  cssSources: string[];
  tsxPaths: string[];
  cssPaths: string[];
}

/** EDGE: read the client tsx and css from disk. `*.test.tsx` files are excluded — the ratchet
 * measures shipped UI classes, and test files reference class names in descriptions and CSS-selector
 * strings that are not `className` attributes at all. `viewerRoot` defaults to this tool's parent
 * directory, so the measurement is independent of the caller's cwd. */
export function collectSources(viewerRoot: string = join(import.meta.dir, '..')): ClientSources {
  const tsxPaths = globPaths(viewerRoot, ['client/src/*.tsx', 'client/src/**/*.tsx']).filter(
    (p) => !p.endsWith('.test.tsx'),
  );
  const cssPaths = globPaths(viewerRoot, ['client/src/styles/*.css']);
  const read = (p: string) => readFileSync(join(viewerRoot, p), 'utf8');
  return {
    tsxSources: tsxPaths.map(read),
    cssSources: cssPaths.map(read),
    tsxPaths,
    cssPaths,
  };
}

/** Union of the given glob patterns under `root`, de-duplicated and sorted for a stable order. */
function globPaths(root: string, patterns: string[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const rel of new Bun.Glob(pattern).scanSync({ cwd: root })) found.add(rel);
  }
  return [...found].sort();
}

function main(): void {
  const { tsxSources, cssSources } = collectSources();
  const { used, unstyled } = findUnstyledClasses(tsxSources, cssSources);
  console.log(`unstyled ${unstyled.length} of ${used.length}`);
  for (const cls of unstyled) console.log(cls);
}

if (import.meta.main) main();
