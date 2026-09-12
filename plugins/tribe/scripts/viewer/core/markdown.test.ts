import { expect, test } from 'bun:test';
import { tokenizeMarkdown } from './markdown.ts';

// --- carried over verbatim from core/live/markdown.test.ts, re-targeted to MdToken[] ----------
//
// The structural safety property replacing escape-then-markup: this module can only ever emit
// MdToken values whose `v`/`href` fields carry the RAW source text. There is no string
// concatenation step anywhere that could turn transcript content into markup, so every test below
// that used to assert "not a live <script>/<a>" now asserts the raw text survives, byte for byte,
// as a token VALUE.

// injection shape: a raw <script> tag never becomes markup -- it has no special markdown
// character, so it flows through untouched as a single text token.
test('a script tag survives as a single text token, never markup', () => {
  expect(tokenizeMarkdown('<script>alert(1)</script>')).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
});

test('renders the supported subset as tokens', () => {
  expect(tokenizeMarkdown('**bold** and *it* and `code`')).toEqual([
    { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
    { t: 'text', v: ' and ' },
    { t: 'em', c: [{ t: 'text', v: 'it' }] },
    { t: 'text', v: ' and ' },
    { t: 'inline-code', v: 'code' },
  ]);
  expect(tokenizeMarkdown('## Heading')).toEqual([{ t: 'heading', level: 2, c: [{ t: 'text', v: 'Heading' }] }]);
  expect(tokenizeMarkdown('- one\n- two')).toEqual([
    { t: 'li', ordered: false, c: [{ t: 'text', v: 'one' }] },
    { t: 'li', ordered: false, c: [{ t: 'text', v: 'two' }] },
  ]);
  expect(tokenizeMarkdown('[kanna](https://example.test/x)')).toEqual([
    { t: 'link', href: 'https://example.test/x', c: [{ t: 'text', v: 'kanna' }] },
  ]);
});

// injection shape: angle brackets inside a fenced code block stay literal in the token's `v` --
// there is no escaping step to apply and none is needed, because a `code` token is never
// concatenated into a markup string.
test('a fenced block keeps its content verbatim, including angle brackets', () => {
  expect(tokenizeMarkdown('```ts\nconst a = 1 < 2;\n```')).toEqual([
    { t: 'code', v: 'const a = 1 < 2;', lang: 'ts' },
  ]);
});

// injection shape: a javascript: href is rejected by the gate. LINK_RE's href group stops at the
// first `)` (bounded, F23), so the matched span is `[x](javascript:alert(1)` and the trailing `)`
// from the JS call falls outside it -- both halves survive as plain text, never as a `link` token.
test('a javascript: link is rejected: the source text survives as plain text', () => {
  expect(tokenizeMarkdown('[x](javascript:alert(1))')).toEqual([
    { t: 'text', v: '[x](javascript:alert(1)' },
    { t: 'text', v: ')' },
  ]);
});

// injection shape: an unclosed fence is never treated as code -- FENCE_RE requires a closing
// ``` -- so its raw backtick markers survive as plain text, exactly like any other content.
test('an unclosed fence is not treated as code; its markers survive as plain text', () => {
  expect(tokenizeMarkdown('```\nno closing fence here')).toEqual([
    { t: 'text', v: '```' },
    { t: 'br' },
    { t: 'text', v: 'no closing fence here' },
  ]);
});

// F21: a NUL byte (fully reachable from transcript JSON, since JSON.parse decodes an escaped
// NUL character to a real control byte) must never collide with the fence-segmentation
// mechanism. Written as an escape sequence below, never as a raw control byte in the source.
test('F21: a NUL byte in transcript content never collides with fence segmentation', () => {
  const nul = '\x00';
  expect(tokenizeMarkdown(` ${nul}0${nul} `)).toEqual([{ t: 'text', v: `${nul}0${nul}` }]);
  expect(tokenizeMarkdown('```\nfenced\n```\n\n' + nul + '0' + nul)).toEqual([
    { t: 'code', v: 'fenced', lang: null },
    { t: 'text', v: `${nul}0${nul}` },
  ]);
});

// F22: a protocol-relative URL (`//host/...`) has no scheme, so the new http:/https:/mailto:
// gate rejects it outright -- it never becomes a `link` token.
test('F22: a protocol-relative href is rejected, never tokenized as a link', () => {
  expect(tokenizeMarkdown('[click](//evil.example.com/phish)')).toEqual([
    { t: 'text', v: '[click](//evil.example.com/phish)' },
  ]);
});

// F23: link matching must stay roughly linear even over a long run of unmatched `[` (ordinary
// tool-output/code content). The old regex went quadratic: ~2.4s at 80,000 chars. A generous
// bound below still catches a regression while tolerating machine variance.
test('F23: link matching stays bounded under a long run of unmatched brackets', () => {
  const input = '['.repeat(50_000);
  const start = performance.now();
  tokenizeMarkdown(input);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(500);
});

// F24: a CRLF blank line must still separate blocks -- here a heading token followed by a plain
// text token, with no stray \r leaking into either token's value.
test('F24: a CRLF blank line separates blocks with no stray carriage return', () => {
  expect(tokenizeMarkdown('## Heading\r\n\r\nSome text')).toEqual([
    { t: 'heading', level: 2, c: [{ t: 'text', v: 'Heading' }] },
    { t: 'text', v: 'Some text' },
  ]);
});

// F25: combined bold+italic emphasis must nest validly: strong wrapping em, not two independent,
// overlapping tokens.
test('F25: combined bold and italic emphasis nests instead of overlapping', () => {
  expect(tokenizeMarkdown('***text***')).toEqual([{ t: 'strong', c: [{ t: 'em', c: [{ t: 'text', v: 'text' }] }] }]);
});

// F31: a backslash-prefixed or tab-prefixed href has no scheme at all, so the http:/https:/
// mailto: gate rejects both outright.
test('F31: a backslash-prefixed href is rejected, never tokenized as a link', () => {
  expect(tokenizeMarkdown('[x](/\\evil.example.com/phish)')).toEqual([
    { t: 'text', v: '[x](/\\evil.example.com/phish)' },
  ]);
});

test('F31: a tab-prefixed href is rejected, never tokenized as a link', () => {
  expect(tokenizeMarkdown('[x](/\t/evil.com/p)')).toEqual([{ t: 'text', v: '[x](/\t/evil.com/p)' }]);
});

// F31 (narrowed by Task 6, per the plan's explicit gate): under escape-then-markup, a relative
// or site-absolute href (no scheme) was allowed because the gate compared resolved ORIGINS.
// The token gate has no origin concept at all -- it only asks "is this an absolute http(s)/
// mailto URL" -- so a scheme-less reference is now rejected outright, never a `link` token.
test('F31 (narrowed gate): a scheme-less href has no scheme to allow and is rejected', () => {
  expect(tokenizeMarkdown('[x](/local/path)')).toEqual([{ t: 'text', v: '[x](/local/path)' }]);
  expect(tokenizeMarkdown('[x](https://ok.example/x)')).toEqual([
    { t: 'link', href: 'https://ok.example/x', c: [{ t: 'text', v: 'x' }] },
  ]);
});

// F32: the emphasis/inline-code passes must run over the LABEL only, never over the href -- the
// href token field carries the raw source string untouched by `*`/`` ` `` markup passes.
test('F32: a `*` inside an href never turns into a `strong`/`em` token', () => {
  expect(tokenizeMarkdown('[x](https://evil.com/**pwn**)')).toEqual([
    { t: 'link', href: 'https://evil.com/**pwn**', c: [{ t: 'text', v: 'x' }] },
  ]);
});

test('F32: a backtick inside an href never turns into an `inline-code` token', () => {
  expect(tokenizeMarkdown('[x](https://ex.com/a`b`c)')).toEqual([
    { t: 'link', href: 'https://ex.com/a`b`c', c: [{ t: 'text', v: 'x' }] },
  ]);
});

test('F32: an emphasis marker inside an href never leaks an `em` span across the anchor boundary', () => {
  expect(tokenizeMarkdown('see [x](https://ex.com/a*b) and 5*6 stars')).toEqual([
    { t: 'text', v: 'see ' },
    { t: 'link', href: 'https://ex.com/a*b', c: [{ t: 'text', v: 'x' }] },
    { t: 'text', v: ' and 5*6 stars' },
  ]);
});

// F33: the fenced-block trailing-newline strip must remove a CRLF, leaving no stray `\r` in the
// token's `v`.
test('F33: a CRLF-terminated fenced block leaves no stray carriage return', () => {
  expect(tokenizeMarkdown('```\r\ncode\r\n```')).toEqual([{ t: 'code', v: 'code', lang: null }]);
});

// F35 (narrowed by Task 6, per the plan's explicit gate): `https:/evil.com` and `https:evil.com`
// both parse, with NO base at all, to a genuine absolute https URL (`https://evil.com/`) -- there
// is no "resolves to my own origin" trick to exploit because the token gate never resolves
// against a base in the first place. They are ordinary external https links and the gate allows
// them, keeping the raw (unnormalized) source string as the token's href.
test('F35 (narrowed gate): a scheme-relative absolute URL is a real https link and is allowed', () => {
  expect(tokenizeMarkdown('[x](https:/evil.com)')).toEqual([
    { t: 'link', href: 'https:/evil.com', c: [{ t: 'text', v: 'x' }] },
  ]);
  expect(tokenizeMarkdown('[x](https:evil.com)')).toEqual([
    { t: 'link', href: 'https:evil.com', c: [{ t: 'text', v: 'x' }] },
  ]);
});

// F35 (narrowed gate): every href with NO scheme at all is rejected; every genuine absolute
// http(s) URL, however it is spelled, stays allowed.
test('F35 (narrowed gate): scheme-less references are rejected; absolute http(s) links stay allowed', () => {
  expect(tokenizeMarkdown('[x](/local/path)')).toEqual([{ t: 'text', v: '[x](/local/path)' }]);
  expect(tokenizeMarkdown('[x](/)')).toEqual([{ t: 'text', v: '[x](/)' }]);
  expect(tokenizeMarkdown('[x](?q=1)')).toEqual([{ t: 'text', v: '[x](?q=1)' }]);
  expect(tokenizeMarkdown('[x](#frag)')).toEqual([{ t: 'text', v: '[x](#frag)' }]);
  expect(tokenizeMarkdown('[x](relative/path)')).toEqual([{ t: 'text', v: '[x](relative/path)' }]);
  expect(tokenizeMarkdown('[x](https://ok.example/x)')).toEqual([
    { t: 'link', href: 'https://ok.example/x', c: [{ t: 'text', v: 'x' }] },
  ]);
  expect(tokenizeMarkdown('[x](HTTPS://ok.example/x)')).toEqual([
    { t: 'link', href: 'HTTPS://ok.example/x', c: [{ t: 'text', v: 'x' }] },
  ]);
  expect(tokenizeMarkdown('[x](https:///evil.com)')).toEqual([
    { t: 'link', href: 'https:///evil.com', c: [{ t: 'text', v: 'x' }] },
  ]);
});

// new: mailto: is a scheme this gate now explicitly allows (spec §12.5); it was never reachable
// under the old same-origin gate at all.
test('a mailto: href is allowed by the widened scheme gate', () => {
  expect(tokenizeMarkdown('[mail me](mailto:a@b.example)')).toEqual([
    { t: 'link', href: 'mailto:a@b.example', c: [{ t: 'text', v: 'mail me' }] },
  ]);
});

// F37: the fenced-block trailing strip matched only `\r?\n`, so a classic-Mac (lone `\r`, no
// following `\n`) line ending before the closing fence left a stray `\r` inside the token's `v`.
test('F37: a lone trailing carriage return before the closing fence leaves no stray `\\r`', () => {
  expect(tokenizeMarkdown('```\r\ncode\r```')).toEqual([{ t: 'code', v: 'code', lang: null }]);
});
