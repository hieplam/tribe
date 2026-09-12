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

/** Build a TranscriptRecord the way records.ts would, carrying every field the normalizer reads
 * off the typed record (message-row specials) plus the verbatim `raw` line the metadata half and
 * the `raw` card re-read (spec §4). Metadata fields (mode, operation, prUrl, …) live only in `raw`,
 * exactly as records.ts leaves them. */
function rec(obj: Record<string, unknown>): TranscriptRecord {
  const raw = JSON.stringify(obj);
  const record: TranscriptRecord = { type: obj.type as string, raw };
  if (typeof obj.uuid === 'string') record.uuid = obj.uuid;
  if (typeof obj.timestamp === 'string') record.timestamp = obj.timestamp;
  if ('message' in obj) record.message = obj.message;
  if (typeof obj.subtype === 'string') record.subtype = obj.subtype;
  if ('content' in obj) record.content = obj.content;
  if ('attachment' in obj) record.attachment = obj.attachment;
  if (typeof obj.isCompactSummary === 'boolean') record.isCompactSummary = obj.isCompactSummary;
  if (typeof obj.apiErrorStatus === 'number') record.apiErrorStatus = obj.apiErrorStatus;
  if (typeof obj.isApiErrorMessage === 'boolean') record.isApiErrorMessage = obj.isApiErrorMessage;
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

// Task 8: the METADATA half (spec §7.1 rung 4, §7.4 system subtypes, §7.3 attachment, §7.6 chips /
// spills, the open-world raw card). The oracle (spec §0) still governs: a row on disk this half
// drops silently is a bug; a raw-JSON card for an unknown row is by design.

/** A whole-row (non-message) record, addressed at byte offset `at`. Metadata fields live in `raw`. */
function metaRow(at: number, obj: Record<string, unknown>): RowInput {
  return input(at, obj);
}

/** The single node a whole-row type emits (rung 4). */
function only(nodes: ReturnType<typeof normalize>): (typeof nodes)[number] {
  expect(nodes).toHaveLength(1);
  return nodes[0]!;
}

describe('normalize — system rows by subtype (spec §7.4, B10: payload is top-level `content`)', () => {
  test('turn_duration renders a divider "32.3s · 22 messages" from durationMs/messageCount', () => {
    const node = only(normalize([metaRow(0, { type: 'system', subtype: 'turn_duration', durationMs: 32309, messageCount: 22 })]));
    expect(node.k).toBe('divider');
    if (node.k !== 'divider') throw new Error('unreachable');
    expect(node.label).toBe('32.3s · 22 messages');
  });

  test('compact_boundary renders a "context compacted" divider', () => {
    const node = only(normalize([metaRow(0, { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' })]));
    expect(node.k).toBe('divider');
    if (node.k !== 'divider') throw new Error('unreachable');
    expect(node.label).toBe('context compacted');
  });

  test('away_summary renders a chip with content as detail', () => {
    const node = only(normalize([metaRow(0, { type: 'system', subtype: 'away_summary', content: 'here is the away summary' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.detail).toBe('here is the away summary');
  });

  test('informational renders a chip with content as detail', () => {
    const node = only(normalize([metaRow(0, { type: 'system', subtype: 'informational', content: 'Usage limit reached' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.detail).toBe('Usage limit reached');
  });

  test('stop_hook_summary renders a chip carrying hookCount and stopReason', () => {
    const node = only(normalize([metaRow(0, { type: 'system', subtype: 'stop_hook_summary', hookCount: 2, stopReason: 'done' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.detail).toContain('2');
    expect(node.detail).toContain('done');
  });

  test('local_command renders a chip with the <command-name> parsed out of content (§7.6)', () => {
    const node = only(normalize([
      metaRow(0, {
        type: 'system',
        subtype: 'local_command',
        content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>fable</command-args>',
      }),
    ]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.label).toBe('/model');
    expect(node.detail).toBe('fable');
  });

  test('bridge_status renders a chip', () => {
    const node = only(normalize([metaRow(0, { type: 'system', subtype: 'bridge_status', content: '/remote-control is active' })]));
    expect(node.k).toBe('chip');
  });

  test('scheduled_task_fire renders a chip', () => {
    const node = only(normalize([metaRow(0, { type: 'system', subtype: 'scheduled_task_fire', content: 'resuming wakeup' })]));
    expect(node.k).toBe('chip');
  });

  test('a system row with no subtype renders as raw (0 measured, handled anyway — §7.4)', () => {
    const node = only(normalize([metaRow(0, { type: 'system', content: 'no subtype here' })]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('system');
  });
});

describe('normalize — named metadata rows (spec §7.1)', () => {
  test('attachment renders an attachment node labelled by attachment.type with rendered as detail (§7.3)', () => {
    const node = only(normalize([
      metaRow(0, { type: 'attachment', attachment: { type: 'total_tokens_reminder', rendered: 'Approaching context limit.' } }),
    ]));
    expect(node.k).toBe('attachment');
    if (node.k !== 'attachment') throw new Error('unreachable');
    expect(node.label).toBe('total_tokens_reminder');
    expect(node.detail).toBe('Approaching context limit.'); // rendered shown inline, no fetch
    expect(node.expandable).toBe(false);
  });

  test('an attachment whose whole content is its label is not expandable (§7.3)', () => {
    const node = only(normalize([metaRow(0, { type: 'attachment', attachment: { type: 'batching_reminder_sent' } })]));
    expect(node.k).toBe('attachment');
    if (node.k !== 'attachment') throw new Error('unreachable');
    expect(node.label).toBe('batching_reminder_sent');
    expect(node.detail).toBeNull();
    expect(node.expandable).toBe(false);
  });

  test('mode renders a chip labelled by `mode`', () => {
    const node = only(normalize([metaRow(0, { type: 'mode', mode: 'normal' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.label).toBe('normal');
  });

  test('queue-operation renders a chip labelled by `operation`, with `content` as detail when present', () => {
    const node = only(normalize([metaRow(0, { type: 'queue-operation', operation: 'enqueue', content: '<task-notification/>' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.label).toBe('enqueue');
    expect(node.detail).toBe('<task-notification/>');
  });

  test('permission-mode renders a chip labelled by `permissionMode`', () => {
    const node = only(normalize([metaRow(0, { type: 'permission-mode', permissionMode: 'bypassPermissions' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.label).toBe('bypassPermissions');
  });

  test('pr-link renders a chip whose href is the gated prUrl (§12.5)', () => {
    const node = only(normalize([
      metaRow(0, { type: 'pr-link', prNumber: 7, prUrl: 'https://github.com/o/r/pull/7' }),
    ]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.href).toBe('https://github.com/o/r/pull/7');
  });

  test('pr-link with a non-http(s) prUrl drops the href (gate §12.5) but still renders the chip', () => {
    const node = only(normalize([metaRow(0, { type: 'pr-link', prNumber: 7, prUrl: 'javascript:alert(1)' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.href).toBeNull();
  });

  test('frame-link renders a chip whose href is the gated frameUrl when present', () => {
    const node = only(normalize([
      metaRow(0, { type: 'frame-link', frameUrl: 'https://claude.ai/code/artifact/x', title: 'Artifact' }),
    ]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.href).toBe('https://claude.ai/code/artifact/x');
  });

  test('agent-name renders a chip labelled by `agentName`', () => {
    const node = only(normalize([metaRow(0, { type: 'agent-name', agentName: 'my-agent' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.label).toBe('my-agent');
  });

  test('cost-state renders a chip carrying totalCostUSD and totalDuration', () => {
    const node = only(normalize([metaRow(0, { type: 'cost-state', totalCostUSD: 0.42, totalDuration: 19887 })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.label).toContain('0.42');
    expect(node.detail).toContain('19887');
  });

  test('relocated renders a chip labelled by `relocatedCwd`', () => {
    const node = only(normalize([metaRow(0, { type: 'relocated', relocatedCwd: '/tmp/worktree' })]));
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(node.label).toBe('/tmp/worktree');
  });

  test('a collapsed-raw metadata type (worktree-state) renders a raw card carrying its rowType and JSON', () => {
    const raw = { type: 'worktree-state', sessionId: 's', worktreeSession: { branch: 'x' } };
    const node = only(normalize([metaRow(0, raw)]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('worktree-state');
    expect(node.json).toBe(JSON.stringify(raw));
    expect(node.text).toBeNull(); // `text` is the oversized label ONLY (§6.1); a plain raw card has none.
  });

  test('title-source rows (last-prompt, ai-title, custom-title) are FOLDED — no node (rung 2, §5.3)', () => {
    // A fold is not a drop: §5.3 consumes these into the session title. The coverage test proves it
    // over the fixture; here it is asserted directly so the fold cannot silently become a raw card.
    expect(normalize([metaRow(0, { type: 'last-prompt', lastPrompt: 'x' })])).toEqual([]);
    expect(normalize([metaRow(0, { type: 'ai-title', aiTitle: 'x' })])).toEqual([]);
    expect(normalize([metaRow(0, { type: 'custom-title', customTitle: 'x' })])).toEqual([]);
  });
});

describe('normalize — the open-world raw fallback (spec §7.1 anything-else, bucket D)', () => {
  test('an INVENTED row type from a future Claude Code release renders as a raw card, never dropped', () => {
    const raw = { type: 'row-type-from-the-future-2099', payload: { anything: true } };
    const node = only(normalize([metaRow(0, raw)]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('row-type-from-the-future-2099');
    expect(node.json).toBe(JSON.stringify(raw));
    expect(node.bytes).toBe(new TextEncoder().encode(JSON.stringify(raw)).length);
  });
});

describe('normalize — apiErrorStatus rows render an error node (spec §8.1 ErrorCard)', () => {
  test('an assistant row carrying apiErrorStatus renders ONE error node with status + body', () => {
    const node = only(normalize([
      input(0, {
        type: 'assistant',
        uuid: 'e1',
        timestamp: 't',
        apiErrorStatus: 429,
        isApiErrorMessage: true,
        message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit" }] },
      }),
    ]));
    expect(node.k).toBe('error');
    if (node.k !== 'error') throw new Error('unreachable');
    expect(node.status).toBe(429);
    expect(node.body).toEqual(tokenizeMarkdown("You've hit your session limit"));
    // The error row does NOT ALSO emit its text block as a separate assistant node.
  });
});

describe('normalize — isCompactSummary rows render the compaction divider (spec §7.4)', () => {
  test('a user row with isCompactSummary:true renders ONE divider, not its content', () => {
    const node = only(normalize([
      input(0, { type: 'user', uuid: 'c1', timestamp: 't', isCompactSummary: true, message: { role: 'user', content: 'summary text' } }),
    ]));
    expect(node.k).toBe('divider');
    if (node.k !== 'divider') throw new Error('unreachable');
    expect(node.label).toBe('context compacted');
  });
});

describe('normalize — XML chip extraction on prompts (spec §7.6)', () => {
  test('a <system-reminder> is lifted into the prompt node chips, removed from the body', () => {
    const nodes = normalize([
      userBlocks(0, [{ type: 'text', text: 'before\n<system-reminder>\nThe user named this session "x".\n</system-reminder>\nafter' }]),
    ]);
    const node = only(nodes);
    expect(node.k).toBe('prompt');
    if (node.k !== 'prompt') throw new Error('unreachable');
    expect(node.chips).toHaveLength(1);
    const chip = node.chips[0]!;
    expect(chip.kind).toBe('system-reminder');
    expect(chip.label).toBe('The user named this session "x".');
    expect(chip.anchor).toEqual({ at: 0, i: 0 });
    // The tag XML is gone from the markdown body; the surrounding text survives.
    const bodyText = JSON.stringify(node.body);
    expect(bodyText).not.toContain('system-reminder');
    expect(bodyText).toContain('before');
    expect(bodyText).toContain('after');
  });

  test('a slash command <command-name>/<command-args> becomes a slash-command chip (label=command, detail=args)', () => {
    const nodes = normalize([
      userBlocks(0, [{ type: 'text', text: '<command-name>/deploy</command-name><command-args>--prod</command-args>' }]),
    ]);
    const node = only(nodes);
    if (node.k !== 'prompt') throw new Error('expected prompt');
    expect(node.chips).toHaveLength(1);
    expect(node.chips[0]!.kind).toBe('slash-command');
    expect(node.chips[0]!.label).toBe('/deploy');
    expect(node.chips[0]!.detail).toBe('--prod');
  });

  test('an <ide_opened_file> becomes an ide-context chip', () => {
    const nodes = normalize([
      userBlocks(0, [{ type: 'text', text: '<ide_opened_file>The user opened /a/b.ts in the IDE.</ide_opened_file>' }]),
    ]);
    const node = only(nodes);
    if (node.k !== 'prompt') throw new Error('expected prompt');
    expect(node.chips).toHaveLength(1);
    expect(node.chips[0]!.kind).toBe('ide-context');
  });

  test('an unrecognised or unbalanced tag degrades to plain text, never a throw (§7.6)', () => {
    const nodes = normalize([
      userBlocks(0, [{ type: 'text', text: 'plain <not-a-known-tag>stuff</not-a-known-tag> and <system-reminder>unclosed' }]),
    ]);
    const node = only(nodes);
    if (node.k !== 'prompt') throw new Error('expected prompt');
    expect(node.chips).toEqual([]); // nothing balanced-and-recognised => no chip
    expect(JSON.stringify(node.body)).toContain('not-a-known-tag');
  });
});

describe('normalize — <persisted-output> spill markers (spec §7.6, fail-closed obligation 4)', () => {
  const ABS = '/Users/someone/.claude/projects/-p/sid/tool-results/spill01.txt';

  test('a tool_result carrying a <persisted-output> marker keeps ONLY the basename — never the absolute path', () => {
    const nodes = normalize([
      userBlocks(0, [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_spill',
          content: `<persisted-output>\nOutput too large (2.4KB). Full output saved to: ${ABS}\n\nPreview (first 2KB):\nthe preview text\n</persisted-output>`,
        },
      ]),
    ]);
    const node = only(nodes);
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    expect(node.result.r).toBe('spill');
    if (node.result.r !== 'spill') throw new Error('unreachable');
    expect(node.result.name).toBe('spill01.txt'); // basename ONLY

    // The absolute path (and any directory separator from it) must not survive ANYWHERE on the node
    // — leaking it is both an information leak and a path-traversal seed (B3's class).
    const serialized = JSON.stringify(node);
    expect(serialized).not.toContain(ABS);
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('tool-results');
  });

  test('the spill node keeps the preview text the marker already carries (a refused spill still shows it)', () => {
    const nodes = normalize([
      userBlocks(0, [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_spill',
          content: `<persisted-output>\nFull output saved to: ${ABS}\n\nPreview (first 2KB):\nvisible preview\n</persisted-output>`,
        },
      ]),
    ]);
    const node = only(nodes);
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    if (node.result.r !== 'spill') throw new Error('expected spill');
    expect(JSON.stringify(node.result.previewBody)).toContain('visible preview');
  });

  test('a basename failing the ^[A-Za-z0-9._-]{1,128}$ gate is refused to empty, still no path leak', () => {
    const evil = '/Users/x/tool-results/..%2f..%2fetc%2fpasswd bad name';
    const nodes = normalize([
      userBlocks(0, [
        { type: 'tool_result', tool_use_id: 't', content: `<persisted-output>\nFull output saved to: ${evil}\n\nPreview (first 2KB):\np\n</persisted-output>` },
      ]),
    ]);
    const node = only(nodes);
    if (node.k !== 'orphan_result') throw new Error('expected orphan_result');
    if (node.result.r !== 'spill') throw new Error('expected spill');
    expect(node.result.name).toBe('');
    expect(JSON.stringify(node)).not.toContain('passwd');
  });
});

const enc = (s: string): number => new TextEncoder().encode(s).length;

describe('normalize — D15: the 64 KiB cap holds for the WHOLE emitted node, not just its inner payload', () => {
  test('a boundary tool_result whose inner ToolResult fits but whose complete orphan_result node would exceed 64 KiB is elided so the EMITTED node is ≤ 64 KiB', () => {
    // 65,400 bytes of text: the inner `ToolResult` JSON-encodes to ~65,472 B — UNDER the 65,536 B
    // cap, so an inner-only fit check leaves it unelided — while the COMPLETE `orphan_result` node,
    // with `id`, anchors, `toolUseId` and `resultAnchor` added around it, encodes to ~65,667 B, OVER
    // the cap. D15 (spec §7) requires NO emitted node to exceed 65,536 B; sizing only the inner
    // payload is the defect this guards (Sol: one live instance, orphan_result 65,555 B).
    const nodes = normalize([
      userBlocks(100, [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'a'.repeat(65400) }]),
    ]);
    const node = only(nodes);
    expect(node.k).toBe('orphan_result');
    if (node.k !== 'orphan_result') throw new Error('unreachable');
    // The load-bearing invariant: the WHOLE node, as it is emitted onto the wire, fits the cap.
    expect(enc(JSON.stringify(node))).toBeLessThanOrEqual(64 * 1024);
    // Having been truncated to fit, it must be marked so the client fetches the full body (§7 / D15).
    expect(node.elided).toBe(true);
    expect(node.expandable).toBe(true);
    if (node.result.r !== 'text') throw new Error('unreachable');
    expect(node.result.elided).toBe(true);
  });

  test('a tool_result already under the cap is NOT elided and stays whole (the elision only triggers at the boundary)', () => {
    const nodes = normalize([
      userBlocks(110, [{ type: 'tool_result', tool_use_id: 'toolu_y', content: 'small output' }]),
    ]);
    const node = only(nodes);
    if (node.k !== 'orphan_result') throw new Error('unreachable');
    expect(node.elided).toBe(false);
    if (node.result.r !== 'text') throw new Error('unreachable');
    expect(node.result.elided).toBe(false);
    expect(enc(JSON.stringify(node))).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('normalize — classification is TOTAL (D23/D28): every unmatched message/block shape renders a VISIBLE fallback; silence is reserved STRICTLY for thinking===""', () => {
  test('a user row whose message.content is ABSENT renders a visible raw fallback (bucket D), never a silent drop', () => {
    const node = only(normalize([input(100, { type: 'user', uuid: 'u', timestamp: 't', message: { role: 'user' } })]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('user');
  });

  test('an assistant row whose message.content is a NON-array, non-string value renders a visible raw fallback', () => {
    const node = only(normalize([input(200, { type: 'assistant', message: { role: 'assistant', content: 42 } })]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('assistant');
  });

  test('a user row whose `message` field is absent entirely renders a visible raw fallback', () => {
    const node = only(normalize([input(250, { type: 'user', uuid: 'u', timestamp: 't' })]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('user');
  });

  test('a thinking block whose `thinking` value is MISSING (only a signature) renders a visible raw fallback — silence is NOT for missing, only for ""', () => {
    const node = only(normalize([assistantBlocks(300, [{ type: 'thinking', signature: 'sig-only' }])]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('block:thinking');
  });

  test('a thinking block whose `thinking` value is a NON-string renders a visible raw fallback — never silent', () => {
    const node = only(normalize([assistantBlocks(400, [{ type: 'thinking', thinking: 123, signature: 's' }])]));
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('block:thinking');
  });

  test('the ONE silent block is exactly a thinking block whose `thinking` is "" (spec §7.2 named exception) — the boundary of the contract', () => {
    expect(normalize([assistantBlocks(500, [{ type: 'thinking', thinking: '', signature: 's' }])])).toEqual([]);
  });

  test('an EMPTY content array is NOT in spec §7.1 bucket E — it renders a visible raw fallback, never a silent drop', () => {
    // Bucket E (spec §7.1) lists ONLY an empty `thinking` block and a row whose ONLY block is such a
    // thinking. An array with ZERO blocks is neither, so "Any row that produces no node and is not
    // in this table is a bug" applies: silence here would be an under-render (§0). Sol reproduced the
    // silent drop (0 nodes) — the contract is a raw card (bucket D).
    const nodes = normalize([input(600, { type: 'user', uuid: 'u', timestamp: 't', message: { role: 'user', content: [] } })]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('user');
  });

  test('a SCALAR block inside a content array is NOT silent — it renders a visible raw fallback (bucket D)', () => {
    // Block ladder (spec §7.1): the ONLY silent block is a `thinking` whose text is "". A scalar
    // entry (a number, string, boolean) is not that, so it must not vanish. Sol reproduced the
    // silent skip (`if (isObject(raw))` with no else → 0 nodes).
    const nodes = normalize([assistantBlocks(700, [42])]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('block:number');
    expect(node.i).toBe(0); // the block's TRUE index is preserved (spec §4).
  });

  test('a NULL block inside a content array is NOT silent — it renders a visible raw fallback (bucket D)', () => {
    const nodes = normalize([userBlocks(800, [null])]);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.k).toBe('raw');
    if (node.k !== 'raw') throw new Error('unreachable');
    expect(node.rowType).toBe('block:null');
  });

  test('a scalar block does not swallow its sibling blocks — each block gets exactly one outcome (D28)', () => {
    // A row carrying a scalar block AND a real text block yields BOTH: a raw fallback and a node.
    const nodes = normalize([assistantBlocks(900, [42, { type: 'text', text: 'hello' }])]);
    expect(nodes.map((n) => n.k)).toEqual(['raw', 'assistant']);
    expect(nodes.map((n) => n.i)).toEqual([0, 1]);
  });
});

describe('normalize — D15: the 64 KiB cap holds for the WHOLE node of every text-bearing kind (spec §7, "every node, ANY kind")', () => {
  test('an attachment whose `rendered` text exceeds 64 KiB is elided so the EMITTED node is ≤ 64 KiB (was 70,125 B, unelided)', () => {
    // §7.3 puts `rendered` inline as the detail; without the size guard a ~70 KiB rendered produced a
    // 70,125-byte node marked `elided:false` (Sol). D15 requires no node of ANY kind over 65,536 B.
    const nodes = normalize([metaRow(0, { type: 'attachment', attachment: { type: 'big_reminder', rendered: 'a'.repeat(70 * 1024) } })]);
    const node = only(nodes);
    expect(node.k).toBe('attachment');
    if (node.k !== 'attachment') throw new Error('unreachable');
    expect(enc(JSON.stringify(node))).toBeLessThanOrEqual(64 * 1024);
    expect(node.elided).toBe(true);
    expect(node.expandable).toBe(true); // the full rendered is fetchable at /api/block (§4).
    expect(JSON.stringify(node)).not.toContain('a'.repeat(70 * 1024)); // no full payload survives.
  });

  test('a chip whose `detail` (a `content` field, up to the 8 MiB ROW_CAP) exceeds 64 KiB is elided so the EMITTED node is ≤ 64 KiB', () => {
    // A `queue-operation` row's `content` is arbitrary text bounded only by ROW_CAP (8 MiB); a chip
    // is a text-bearing kind (spec §7 "every node, ANY kind"), so the same guard applies.
    const nodes = normalize([metaRow(0, { type: 'queue-operation', operation: 'enqueue', content: 'b'.repeat(70 * 1024) })]);
    const node = only(nodes);
    expect(node.k).toBe('chip');
    if (node.k !== 'chip') throw new Error('unreachable');
    expect(enc(JSON.stringify(node))).toBeLessThanOrEqual(64 * 1024);
    expect(node.elided).toBe(true);
    expect(node.expandable).toBe(true);
  });
});
