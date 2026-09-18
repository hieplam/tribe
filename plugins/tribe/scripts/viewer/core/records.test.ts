import { expect, test } from 'bun:test';
import { isMessageRecord, parseRecordLines } from './records.ts';

// --- carried over from core/live/records.test.ts (card D7, F11, F11b) ------------------------

test('accepts camelCase sessionId and snake_case session_id alike (card D7)', () => {
  const lineA = JSON.stringify({ type: 'user', sessionId: 'a', message: { role: 'user', content: 'hi' } });
  const lineB = JSON.stringify({ type: 'user', session_id: 'b', message: { role: 'user', content: 'yo' } });
  const { records } = parseRecordLines([lineA, lineB]);
  expect(records.map((r) => r.sessionId)).toEqual(['a', 'b']);
  expect(records.map((r) => r.raw)).toEqual([lineA, lineB]);
});

test('a wrong-typed sessionId does not mask a good session_id fallback (F11)', () => {
  const line = JSON.stringify({ type: 'user', sessionId: 123, session_id: 'fallback' });
  const { records } = parseRecordLines([line]);
  expect(records).toEqual([{ type: 'user', sessionId: 'fallback', raw: line }]);
});

test('a null sessionId still falls back to session_id (F11)', () => {
  const line = JSON.stringify({ type: 'user', sessionId: null, session_id: 'fallback2' });
  const { records } = parseRecordLines([line]);
  expect(records).toEqual([{ type: 'user', sessionId: 'fallback2', raw: line }]);
});

test('an unparseable line is counted and skipped, never thrown', () => {
  const { records, skipped } = parseRecordLines(['{not json', JSON.stringify({ type: 'user' })]);
  expect(skipped).toBe(1);
  expect(records).toHaveLength(1);
});

test('bookkeeping row types parse but are not messages', () => {
  const noise = ['attachment', 'queue-operation', 'last-prompt', 'ai-title', 'mode', 'pr-link'];
  const { records } = parseRecordLines(noise.map((type) => JSON.stringify({ type })));
  expect(records.map(isMessageRecord)).toEqual(noise.map(() => false));
});

// The original fixture (fixtures/session-malformed.jsonl) was deleted with the rest of the old
// fixture set (spec §11.1); its exact content is inlined here so the scenario it proved — bad
// lines skipped, one good line kept, never a throw — survives the fixture's own deletion.
test('a malformed session is tolerated: bad lines skipped, good line kept (F11b)', () => {
  const lines = [
    '{not valid json at all',
    JSON.stringify({
      type: 'user',
      uuid: '22222222-0000-0000-0000-000000000001',
      sessionId: 'sess-fixture-2',
      timestamp: '2026-09-02T10:05:00.000Z',
      message: { role: 'user', content: 'still readable' },
    }),
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"truncated mid-object"',
  ];
  expect(() => parseRecordLines(lines)).not.toThrow();
  const { records, skipped } = parseRecordLines(lines);
  expect(skipped).toBeGreaterThan(0);
  expect(records).toHaveLength(1);
  expect(records[0]?.sessionId).toBe('sess-fixture-2');
});

test('assistant, user and system rows are messages', () => {
  const { records } = parseRecordLines(
    ['assistant', 'user', 'system'].map((type) => JSON.stringify({ type })),
  );
  expect(records.map(isMessageRecord)).toEqual([true, true, true]);
});

// --- new for the consolidation: the widened reader (spec §11.2) -------------------------------
// one test per field the widened reader must keep: subtype, content, attachment, isMeta,
// isCompactSummary, apiErrorStatus, isApiErrorMessage, agentId, parentUuid, plus `raw`.

test('keeps `subtype` (spec §7.4 — system rows dispatch on it)', () => {
  const line = JSON.stringify({ type: 'system', subtype: 'turn_duration' });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.subtype).toBe('turn_duration');
});

test('keeps `content` (spec §7.4 — a system row\'s payload is top-level `content`, not `message`, B10)', () => {
  const line = JSON.stringify({ type: 'system', subtype: 'informational', content: 'hello from content' });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.content).toBe('hello from content');
});

test('keeps `attachment` (spec §7.3 — the attachment object payload)', () => {
  const line = JSON.stringify({ type: 'attachment', attachment: { type: 'output_style', rendered: 'x' } });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.attachment).toEqual({ type: 'output_style', rendered: 'x' });
});

test('keeps `isMeta`', () => {
  const line = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'hi' } });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.isMeta).toBe(true);
});

test('keeps `isCompactSummary` (spec §7.4 — the compaction divider)', () => {
  const line = JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'x' } });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.isCompactSummary).toBe(true);
});

test('keeps `apiErrorStatus` (§8.1 ErrorCard)', () => {
  const line = JSON.stringify({ type: 'assistant', apiErrorStatus: 529 });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.apiErrorStatus).toBe(529);
});

test('keeps `isApiErrorMessage`', () => {
  const line = JSON.stringify({ type: 'assistant', isApiErrorMessage: true });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.isApiErrorMessage).toBe(true);
});

test('keeps `agentId` (already supported; asserted explicitly now that the reader is widened)', () => {
  const line = JSON.stringify({ type: 'assistant', agentId: 'agent-fixture-01' });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.agentId).toBe('agent-fixture-01');
});

test('keeps `parentUuid` (already supported; asserted explicitly now that the reader is widened)', () => {
  const line = JSON.stringify({ type: 'assistant', uuid: 'child-1', parentUuid: 'parent-1' });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.parentUuid).toBe('parent-1');
});

test('keeps `raw`, the verbatim source line, on every record — the `raw` card needs it (spec §4)', () => {
  const line = JSON.stringify({ type: 'totally-invented-fixture-row-type', foo: 'bar' });
  const { records } = parseRecordLines([line]);
  expect(records[0]?.raw).toBe(line);
});

// --- new for the consolidation: three more shapes counted in `skipped`, never thrown -----------

test('a JSON array line is skipped, never thrown', () => {
  const { records, skipped } = parseRecordLines(['[1,2,3]', JSON.stringify({ type: 'user' })]);
  expect(() => parseRecordLines(['[1,2,3]'])).not.toThrow();
  expect(skipped).toBe(1);
  expect(records).toHaveLength(1);
});

test('a bare scalar line is skipped, never thrown', () => {
  const lines = ['42', '"just a string"', 'true', 'null', JSON.stringify({ type: 'user' })];
  expect(() => parseRecordLines(lines)).not.toThrow();
  const { records, skipped } = parseRecordLines(lines);
  expect(skipped).toBe(4);
  expect(records).toHaveLength(1);
});

test('invalid UTF-8 (already decoded to its replacement-character form by the upstream reader) is skipped, never thrown', () => {
  // A line ending mid multi-byte character (a lone 0xC3 continuation start with nothing after
  // it) is exactly what a non-fatal `TextDecoder` hands upstream when the underlying bytes were
  // invalid UTF-8 (spelled as a Uint8Array, never a literal control byte in source). The
  // replacement character breaks JSON syntax here (trailing non-whitespace after a complete
  // value), which is what proves this is actually exercised rather than silently accepted.
  const goodLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } });
  const invalidTail = new Uint8Array([...new TextEncoder().encode(goodLine), 0xc3]);
  const decoded = new TextDecoder('utf-8').decode(invalidTail); // goodLine + U+FFFD
  expect(decoded).not.toBe(goodLine); // sanity: the replacement character really is present

  const { records, skipped } = parseRecordLines([decoded, goodLine]);
  expect(() => parseRecordLines([decoded])).not.toThrow();
  expect(skipped).toBe(1);
  expect(records).toHaveLength(1);
});
