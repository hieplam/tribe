/**
 * Markdown-subset tokenizer (spec §4, §12.5; card D6, D9). Pure: takes a string, returns an
 * `MdToken[]` tree, and NEVER a string of HTML. This replaces the old `core/live/markdown.ts`'s
 * escape-then-markup property with a strictly stronger, STRUCTURAL one: this module has no
 * string-concatenation step that assembles markup at all, so it is INCAPABLE of emitting an
 * element or an attribute regardless of input. The client maps tokens to React elements, which
 * React escapes by construction (spec §3, §12.6 bans `dangerouslySetInnerHTML` mechanically).
 *
 * Supported subset and nothing more: fenced code blocks, inline code, bold, italic, ATX headings,
 * bullet and numbered lists, links, paragraphs, hard line breaks. Everything else is a plain
 * `text` token carrying the raw source characters, unmodified.
 *
 * Fenced blocks are segmented out of the input FIRST, each segment is tokenized independently,
 * and the results are concatenated -- carried over from the HTML-era file, which discovered (F21)
 * that writing a placeholder into an assembled string and re-scanning it later lets a fence's own
 * rendered content collide with unrelated content. There is no assembled string here at all, but
 * the segment-first discipline is kept because it is what makes each segment's tokenization
 * independent and order-preserving.
 */

import type { MdToken } from './model.ts';

const FENCE_RE = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_LINE_RE = /^-\s+(.*)$/;
const NUMBERED_LINE_RE = /^\d+\.\s+(.*)$/;
// Bounded (`{0,N}`) and newline-excluding so a run of unmatched `[` cannot force the engine to
// rescan to the end of the string from every start position (F23): each attempt is capped,
// keeping the whole pass linear.
const LINK_RE = /\[([^\]\n]{0,500})\]\(([^)\n]{0,2000})\)/g;

// Combined emphasis first, then bold, then italic, then inline code -- same priority order as the
// HTML-era file (F25: matching `***...***` before the separate bold/italic passes produces valid
// nesting instead of two independent, overlapping passes).
const TRIPLE_RE = /\*\*\*(.+?)\*\*\*/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_RE = /\*(.+?)\*/g;
const INLINE_CODE_RE = /`([^`]+?)`/g;

/**
 * The href gate: `http:`, `https:`, `mailto:` only (spec §12.5, task 6). Unlike the HTML-era
 * gate, this one has no "resolves to my own origin" concept at all -- there is no base to resolve
 * a relative reference against, because a relative reference is simply not one of the three
 * allowed absolute schemes and is rejected outright. That structurally closes the whole class of
 * bug the old two-base trick had to patch by hand (F35): a scheme-relative string like
 * `https:/evil.com` is not being compared against "am I the same origin as the viewer" -- it is
 * just an ordinary, transparent external https link, exactly as visible to the reader as
 * `https://evil.com` would be, and is allowed on that basis alone.
 */
function isAllowedHref(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

interface Segment {
  fenced: boolean;
  text: string;
  lang: string;
}

function segmentFences(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ fenced: false, text: text.slice(lastIndex, match.index), lang: '' });
    }
    segments.push({ fenced: true, text: match[2] ?? '', lang: match[1] ?? '' });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ fenced: false, text: text.slice(lastIndex), lang: '' });
  }
  return segments;
}

interface Pass {
  regex: RegExp;
  build: (inner: string, childrenPassIndex: number) => MdToken;
}

// Each pass's build() recurses into the REMAINING (lower-priority) passes for its own captured
// content -- e.g. bold text can still contain italic or inline code, matched by later passes over
// the same captured string, but never re-matched by triple/bold again.
const PASSES: Pass[] = [
  { regex: TRIPLE_RE, build: (inner, next) => ({ t: 'strong', c: [{ t: 'em', c: runPass(inner, next) }] }) },
  { regex: BOLD_RE, build: (inner, next) => ({ t: 'strong', c: runPass(inner, next) }) },
  { regex: ITALIC_RE, build: (inner, next) => ({ t: 'em', c: runPass(inner, next) }) },
  { regex: INLINE_CODE_RE, build: (inner) => ({ t: 'inline-code', v: inner }) },
];

function runPass(text: string, passIndex: number): MdToken[] {
  if (text.length === 0) return [];
  if (passIndex >= PASSES.length) return [{ t: 'text', v: text }];
  const pass = PASSES[passIndex]!;
  const { regex, build } = pass;
  const out: MdToken[] = [];
  let lastIndex = 0;
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(...runPass(text.slice(lastIndex, match.index), passIndex + 1));
    out.push(build(match[1] ?? '', passIndex + 1));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out.push(...runPass(text.slice(lastIndex), passIndex + 1));
  return out;
}

function emphasisAndCode(text: string): MdToken[] {
  return runPass(text, 0);
}

// Segment on LINK_RE FIRST, then run the emphasis/inline-code passes only over the non-link text
// and over each link's LABEL -- never over the href (F32, carried over): the href token field
// always carries the raw captured string, untouched by any later pass, so a `*` or a backtick
// inside a URL can never turn into a `strong`/`em`/`inline-code` token, and an emphasis span
// opened inside an href can never close outside the link.
function parseInline(raw: string): MdToken[] {
  const out: MdToken[] = [];
  let lastIndex = 0;
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(raw)) !== null) {
    if (match.index > lastIndex) out.push(...emphasisAndCode(raw.slice(lastIndex, match.index)));
    const full = match[0];
    const label = match[1] ?? '';
    const href = match[2] ?? '';
    if (isAllowedHref(href)) {
      out.push({ t: 'link', href, c: emphasisAndCode(label) });
    } else {
      // A disallowed href degrades exactly as before: the original matched text goes through the
      // same path as ordinary content, never as a live link.
      out.push(...emphasisAndCode(full));
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < raw.length) out.push(...emphasisAndCode(raw.slice(lastIndex)));
  return out;
}

function blockToTokens(block: string): MdToken[] {
  const heading = block.match(HEADING_RE);
  if (heading) {
    const level = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
    return [{ t: 'heading', level, c: parseInline(heading[2]!) }];
  }

  const lines = block.split('\n');

  if (lines.every((line) => BULLET_LINE_RE.test(line))) {
    return lines.map((line): MdToken => ({ t: 'li', ordered: false, c: parseInline(line.match(BULLET_LINE_RE)![1]!) }));
  }

  if (lines.every((line) => NUMBERED_LINE_RE.test(line))) {
    return lines.map((line): MdToken => ({ t: 'li', ordered: true, c: parseInline(line.match(NUMBERED_LINE_RE)![1]!) }));
  }

  const out: MdToken[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) out.push({ t: 'br' });
    out.push(...parseInline(line));
  });
  return out;
}

function segmentToTokens(segment: Segment): MdToken[] {
  if (segment.fenced) {
    // Strip a trailing CRLF, bare LF, or bare CR (F33, F37, carried over): stripping only `\n`
    // left a stray `\r` inside the token's `v` for a Windows-style (CRLF) fenced block; matching
    // only `\r?\n` still left a lone trailing `\r` (classic-Mac line ending, no following `\n`).
    const v = segment.text.replace(/\r\n$|\n$|\r$/, '');
    return [{ t: 'code', v, lang: segment.lang || null }];
  }

  const blocks = segment.text
    // Normalize CRLF blank-line separators before splitting so a Windows-style transcript still
    // gets separate blocks, with no stray `\r` left inside any token (F24, carried over).
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks.flatMap(blockToTokens);
}

export function tokenizeMarkdown(text: string): MdToken[] {
  return segmentFences(text).flatMap(segmentToTokens);
}
