import { expect, test } from 'bun:test';
import { resolveTitle } from './title.ts';

// spec §5.3 — the five-step fallback, in order:
//   last `custom-title`, else last `ai-title`, else `last-prompt`, else the first user message,
//   else the session id. `custom-title`/`ai-title`/`last-prompt` are read from the TAIL window;
//   the first user message is read from the HEAD window (spec §5.3).

const customTitleRow = (t: string) => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: 's1' });
const aiTitleRow = (t: string) => JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: 's1' });
const lastPromptRow = (t: string) => JSON.stringify({ type: 'last-prompt', lastPrompt: t, sessionId: 's1' });
const userTextRow = (t: string) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: t }] } });
const userStringRow = (t: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: t } });

// --- Step 1 in isolation: last `custom-title` wins over everything else. ---

test('step 1: a lone custom-title (tail) resolves as custom-title', () => {
  const result = resolveTitle([], [customTitleRow('My Title')], 'session-abc');
  expect(result).toEqual({ title: 'My Title', titleSource: 'custom-title' });
});

test('step 1: several custom-title rows — the LAST one wins', () => {
  const tail = [customTitleRow('first'), customTitleRow('second'), customTitleRow('third')];
  expect(resolveTitle([], tail, 'session-abc')).toEqual({ title: 'third', titleSource: 'custom-title' });
});

// --- Step 2 in isolation: last `ai-title` wins when no custom-title exists. ---

test('step 2: a lone ai-title (tail) resolves as ai-title', () => {
  const result = resolveTitle([], [aiTitleRow('AI Title')], 'session-abc');
  expect(result).toEqual({ title: 'AI Title', titleSource: 'ai-title' });
});

test('step 2: several ai-title rows in the tail — the LAST one wins', () => {
  const tail = [aiTitleRow('one'), aiTitleRow('two'), aiTitleRow('three')];
  expect(resolveTitle([], tail, 'session-abc')).toEqual({ title: 'three', titleSource: 'ai-title' });
});

// --- Step 3 in isolation: last-prompt wins when neither of the above exists. ---

test('step 3: a lone last-prompt (tail) resolves as last-prompt', () => {
  const result = resolveTitle([], [lastPromptRow('do the thing')], 'session-abc');
  expect(result).toEqual({ title: 'do the thing', titleSource: 'last-prompt' });
});

test('step 3: several last-prompt rows — the LAST one wins', () => {
  const tail = [lastPromptRow('first prompt'), lastPromptRow('second prompt')];
  expect(resolveTitle([], tail, 'session-abc')).toEqual({ title: 'second prompt', titleSource: 'last-prompt' });
});

// --- Step 4 in isolation: the first user message (head), string content and array content. ---

test('step 4: the first user message (array text block, head) is used when tail has nothing', () => {
  const head = [userTextRow('hello there')];
  expect(resolveTitle(head, [], 'session-abc')).toEqual({ title: 'hello there', titleSource: 'first-user' });
});

test('step 4: the first user message (bare string content, head) is used when tail has nothing', () => {
  const head = [userStringRow('plain string prompt')];
  expect(resolveTitle(head, [], 'session-abc')).toEqual({ title: 'plain string prompt', titleSource: 'first-user' });
});

// --- Step 5 in isolation: falls through to the session id when none of the above resolve. ---

test('step 5: none of the four sources present anywhere — falls through to the session id', () => {
  const head = [JSON.stringify({ type: 'system', subtype: 'mode' })];
  const tail = [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } })];
  expect(resolveTitle(head, tail, 'session-xyz')).toEqual({ title: 'session-xyz', titleSource: 'session-id' });
});

test('step 5: empty head and tail arrays fall through to the session id', () => {
  expect(resolveTitle([], [], 'session-xyz')).toEqual({ title: 'session-xyz', titleSource: 'session-id' });
});

// --- Combination: the priority order holds when several sources are present at once. ---

test('combination: custom-title beats ai-title, last-prompt, and first-user, all present at once', () => {
  const head = [userTextRow('the first user message')];
  const tail = [aiTitleRow('an ai title'), lastPromptRow('a last prompt'), customTitleRow('the custom title')];
  expect(resolveTitle(head, tail, 'session-abc')).toEqual({ title: 'the custom title', titleSource: 'custom-title' });
});

test('combination: with no custom-title, ai-title beats last-prompt and first-user', () => {
  const head = [userTextRow('the first user message')];
  const tail = [lastPromptRow('a last prompt'), aiTitleRow('an ai title')];
  expect(resolveTitle(head, tail, 'session-abc')).toEqual({ title: 'an ai title', titleSource: 'ai-title' });
});

test('combination: with no custom-title or ai-title, last-prompt beats first-user', () => {
  const head = [userTextRow('the first user message')];
  const tail = [lastPromptRow('a last prompt')];
  expect(resolveTitle(head, tail, 'session-abc')).toEqual({ title: 'a last prompt', titleSource: 'last-prompt' });
});

test('combination: with none of the first three, first-user is used', () => {
  const head = [userTextRow('the first user message')];
  expect(resolveTitle(head, [], 'session-abc')).toEqual({ title: 'the first user message', titleSource: 'first-user' });
});

// --- A tail window whose first line is partial: the fragment is DROPPED, not parsed. ---
//
// A 256 KiB tail window very often starts mid-row (spec §5.3): the caller hands title.ts the
// raw text of that first, truncated fragment as-is (title.ts does no byte-level line splitting
// itself — that decision lives in core/window.ts#completeLines, called by the adapter). A parser
// that tried to salvage a title out of that fragment (e.g. a naive substring search for
// `"lastPrompt"`) would report a WRONG title lifted out of truncated JSON; the correct behaviour
// is to fail closed on the unparsable fragment and read the next, WHOLE row instead.
test('a partial (truncated) first tail line is dropped, not parsed, for a phantom title', () => {
  const partialFragment = '"lastPrompt":"a title salvaged from garbage","sessionId":"s1"}';
  // Sanity: this fragment is not valid JSON on its own — proves the case is real, not vacuous.
  expect(() => JSON.parse(partialFragment)).toThrow();

  const tail = [partialFragment, lastPromptRow('the real prompt')];
  expect(resolveTitle([], tail, 'session-abc')).toEqual({ title: 'the real prompt', titleSource: 'last-prompt' });
});
