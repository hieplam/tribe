import { describe, expect, test } from 'bun:test';
import { normalize, type RowInput } from './normalize.ts';
import { tokenizeMarkdown } from './markdown.ts';
import type { TranscriptRecord } from './records.ts';

// Task 7 is the oracle-bearing half of the normalizer (spec §7.2): message rows and their content
// blocks. The oracle (spec §0) is the transcripts on this machine — UNDER-rendering (a content
// block present on disk that the normalizer drops silently) is a bug; that is precisely B1/B2, the
// defect this replaces. Every block shape below is one measured row of spec §7.2, and each carries
// its measured count so a future reader can re-derive the scan. This half does NO pairing (task 9)
// and NO elision/oversized handling (task 9 / the byte layer); a `tool_result` therefore emits its
// pre-pairing candidate node, an `orphan_result` (spec §7.5: a result with no call in pairing state
// is an orphan — never a drop).

/** Build a TranscriptRecord the way records.ts would, with the fields a message row carries. */
function rec(obj: Record<string, unknown>): TranscriptRecord {
  const raw = JSON.stringify(obj);
  const record: TranscriptRecord = { type: obj.type as string, raw };
  if (typeof obj.uuid === 'string') record.uuid = obj.uuid;
  if (typeof obj.timestamp === 'string') record.timestamp = obj.timestamp;
  if ('message' in obj) record.message = obj.message;
  return record;
}

function input(at: number, obj: Record<string, unknown>): RowInput {
  return { at, record: rec(obj) };
}

/** A user row whose `message.content` is a bare string. */
function userString(at: number, text: string, uuid = 'u-uuid', ts = '2026-09-12T00:00:00.000Z'): RowInput {
  return input(at, { type: 'user', uuid, timestamp: ts, message: { role: 'user', content: text } });
}

/** A user row whose `message.content` is an array of blocks. */
function userBlocks(at: number, blocks: unknown[], uuid = 'u-uuid', ts = '2026-09-12T00:00:00.000Z'): RowInput {
  return input(at, { type: 'user', uuid, timestamp: ts, message: { role: 'user', content: blocks } });
}

/** An assistant row whose `message.content` is an array of blocks. */
function assistantBlocks(
  at: number,
  blocks: unknown[],
  model: string | null = 'claude-opus-4-8',
  uuid = 'a-uuid',
  ts = '2026-09-12T00:00:00.000Z',
): RowInput {
  const message: Record<string, unknown> = { role: 'assistant', content: blocks };
  if (model !== null) message.model = model;
  return input(at, { type: 'assistant', uuid, timestamp: ts, message });
}

describe('normalize — message rows and content blocks (spec §7.2)', () => {
  test('user message.content as a bare string renders one prompt node (1,799 measured)', () => {
    const nodes = normalize([userString(100, 'deploy the widget')]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('prompt');
    if (node.k !== 'prompt') throw new Error('unreachable');
    expect(node.body).toEqual(tokenizeMarkdown('deploy the widget'));
    expect(node.chips).toEqual([]); // XML chip extraction is task 8; not here.
    expect(node.i).toBe(0); // a bare string is the single block "the row itself".
  });

  test('assistant message.content as a bare string is treated as one text block (0 measured, handled anyway)', () => {
    const nodes = normalize([
      input(200, { type: 'assistant', uuid: 'a', timestamp: 't', message: { role: 'assistant', content: 'here you go' } }),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('assistant');
    if (node.k !== 'assistant') throw new Error('unreachable');
    expect(node.body).toEqual(tokenizeMarkdown('here you go'));
  });

  test('array-form text blocks on a USER row are prompts — B2: every runner prompt (402 measured)', () => {
    // B2 is the pre-consolidation bug this task replaces: array-form prompts were DROPPED. This is
    // the regression guard — every runner prompt arrives as `content: [{type:'text', text:…}]`.
    const nodes = normalize([
      userBlocks(300, [
        { type: 'text', text: 'first instruction' },
        { type: 'text', text: 'second instruction' },
      ]),
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.k)).toEqual(['prompt', 'prompt']);
    const first = nodes[0]!;
    const second = nodes[1]!;
    if (first.k !== 'prompt' || second.k !== 'prompt') throw new Error('unreachable');
    expect(first.body).toEqual(tokenizeMarkdown('first instruction'));
    expect(second.body).toEqual(tokenizeMarkdown('second instruction'));
    expect(first.i).toBe(0);
    expect(second.i).toBe(1);
  });

  test('assistant text block renders an assistant node with its model (10,640 measured)', () => {
    const nodes = normalize([assistantBlocks(400, [{ type: 'text', text: 'the answer is 42' }], 'claude-opus-4-8')]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('assistant');
    if (node.k !== 'assistant') throw new Error('unreachable');
    expect(node.body).toEqual(tokenizeMarkdown('the answer is 42'));
    expect(node.model).toBe('claude-opus-4-8');
  });

  test('non-empty thinking renders a thinking node (9,462 measured)', () => {
    const nodes = normalize([
      assistantBlocks(500, [{ type: 'thinking', thinking: 'let me reason about this', signature: 'sig-abc' }]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('thinking');
    if (node.k !== 'thinking') throw new Error('unreachable');
    expect(node.body).toEqual(tokenizeMarkdown('let me reason about this'));
  });

  test('empty thinking renders NO node (8,411 of 17,873 measured are empty — spec §7.2 named exception)', () => {
    // A `thinking` block whose `thinking` is "" carries nothing on disk (it arrives with only a
    // `signature`, B9). Rendering it would produce 8,411 empty cards. Skipping it is NOT
    // under-rendering — there is nothing on disk to render — so this is the ONE content-bearing
    // block type the spec declines to emit a node for. `signature` is never rendered.
    const nodes = normalize([
      assistantBlocks(600, [{ type: 'thinking', thinking: '', signature: 'sig-only' }]),
    ]);
    expect(nodes).toEqual([]);
  });

  test('an assistant row whose ONLY block is empty thinking yields nothing (row not dropped; blocks fell silent)', () => {
    const nodes = normalize([
      assistantBlocks(650, [{ type: 'thinking', thinking: '', signature: 's' }]),
      assistantBlocks(700, [{ type: 'text', text: 'but this survives' }]),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.k).toBe('assistant');
    expect(nodes[0]!.at).toBe(700);
  });

  test('tool_use renders a pending tool card — no pairing yet (33,721 measured, all on assistant rows)', () => {
    const nodes = normalize([
      assistantBlocks(800, [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('tool');
    if (node.k !== 'tool') throw new Error('unreachable');
    expect(node.name).toBe('Bash');
    expect(node.input).toEqual({ command: 'ls' });
    expect(node.state).toBe('pending');
    expect(node.result).toBeNull();
    expect(node.resultAnchor).toBeNull(); // set by pairing (task 9); null while pending.
    expect(node.toolUseId).toBe('toolu_1');
    expect(node.agentId).toBeNull(); // subagent linking is task 9.
    expect(node.call).toEqual({ at: 800, i: 0 });
  });

  test('tool_result with STRING content is an orphan_result carrying r:text (32,608 measured)', () => {
    const nodes = normalize([
      userBlocks(900, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'command output here' }]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('orphan_result'); // no call in pairing state (task 9 pairs); never dropped.
    if (node.k !== 'orphan_result') throw new Error('unreachable');
    expect(node.toolUseId).toBe('toolu_1');
    expect(node.result.r).toBe('text');
    if (node.result.r !== 'text') throw new Error('unreachable');
    expect(node.result.body).toEqual(tokenizeMarkdown('command output here'));
    expect(node.result.isError).toBe(false);
    expect(node.resultAnchor).toEqual({ at: 900, i: 0 });
  });

  test('tool_result with array[text] content is an orphan_result carrying r:text (849 measured)', () => {
    const nodes = normalize([
      userBlocks(1000, [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ],
        },
      ]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    expect(node.result.r).toBe('text');
    if (node.result.r !== 'text') throw new Error('unreachable');
    expect(node.result.body).toEqual(tokenizeMarkdown('line one\nline two'));
  });

  test('tool_result with array[tool_reference] content is an orphan_result carrying r:refs (138 measured)', () => {
    const nodes = normalize([
      userBlocks(1100, [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_3',
          content: [
            { type: 'tool_reference', tool_name: 'WebSearch' },
            { type: 'tool_reference', tool_name: 'WebFetch' },
          ],
        },
      ]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    expect(node.result).toEqual({ r: 'refs', count: 2 });
  });

  test('tool_result with array[image] content is an orphan_result carrying r:images (125 measured)', () => {
    const nodes = normalize([
      userBlocks(1200, [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_4',
          content: [{ type: 'image', source: { type: 'base64', data: 'QUJD' } }],
        },
      ]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    expect(node.result).toEqual({ r: 'images', count: 1 });
  });

  test('tool_result with is_error:true sets isError on the r:text result (993 measured)', () => {
    const nodes = normalize([
      userBlocks(1300, [{ type: 'tool_result', tool_use_id: 'toolu_5', content: 'boom', is_error: true }]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    expect(node.result.r).toBe('text');
    if (node.result.r !== 'text') throw new Error('unreachable');
    expect(node.result.isError).toBe(true);
  });

  test('a base64 image block on a user row renders an image node, expandable, bytes decoded (15 measured)', () => {
    // "QUJD" is base64 for "ABC" — 3 decoded bytes. The node holds mediaType + bytes only; the
    // actual image is fetched on expand (spec §7.2), so `expandable` is true.
    const nodes = normalize([
      userBlocks(1400, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }]),
    ]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('image');
    if (node.k !== 'image') throw new Error('unreachable');
    expect(node.mediaType).toBe('image/png');
    expect(node.bytes).toBe(3);
    expect(node.expandable).toBe(true);
    expect(node.elided).toBe(false);
  });

  test('RowAnchor (id, at, i, uuid, ts) is populated on EVERY node', () => {
    const nodes = normalize([
      assistantBlocks(
        2000,
        [
          { type: 'text', text: 'alpha' },
          { type: 'thinking', thinking: 'beta' },
          { type: 'tool_use', id: 'toolu_x', name: 'Read', input: {} },
        ],
        'claude-opus-4-8',
        'row-uuid-123',
        '2026-09-12T12:34:56.000Z',
      ),
    ]);
    expect(nodes).toHaveLength(3);
    nodes.forEach((node, idx) => {
      expect(node.at).toBe(2000);
      expect(node.i).toBe(idx);
      expect(node.id).toBe(`2000:${idx}`);
      expect(node.uuid).toBe('row-uuid-123');
      expect(node.ts).toBe('2026-09-12T12:34:56.000Z');
    });
  });

  test('uuid and ts are null when the row carries none (never faked)', () => {
    const nodes = normalize([
      input(2100, { type: 'user', message: { role: 'user', content: 'no uuid, no ts' } }),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.uuid).toBeNull();
    expect(nodes[0]!.ts).toBeNull();
  });

  test('node order equals input order across rows and across blocks within a row', () => {
    const nodes = normalize([
      userString(10, 'prompt one'),
      assistantBlocks(20, [
        { type: 'text', text: 'assistant a' },
        { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: {} },
      ]),
      userBlocks(30, [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'result a' }]),
      userString(40, 'prompt two'),
    ]);
    expect(nodes.map((n) => n.k)).toEqual(['prompt', 'assistant', 'tool', 'orphan_result', 'prompt']);
    expect(nodes.map((n) => n.at)).toEqual([10, 20, 20, 30, 40]);
  });
});
