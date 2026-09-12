/**
 * The normalizer — part 1: message rows and their content blocks (spec §7.2, card B1/B2).
 *
 * PURE core (`pure-core.md`): this module receives ALREADY-PARSED rows plus each row's byte offset
 * and returns `RenderNode[]`. It touches no filesystem, no clock, no environment, no network — the
 * only dependency it names is `tokenizeMarkdown`, itself pure. `structure.test.ts` enforces this.
 *
 * The oracle (spec §0): the transcripts on this machine decide correctness. **Under-rendering** — a
 * content block present on disk that this normalizer drops silently — **is a bug** (that is exactly
 * B1/B2, the defect this replaces). So every measured block shape of spec §7.2 emits a node, with
 * one declared exception: an empty `thinking` block, which carries nothing on disk (spec §7.2 named
 * exception; 8,411 of 17,873 measured).
 *
 * SCOPE — this is PART 1. It handles `user`/`assistant` message rows and their content blocks only.
 * Metadata rows, `system` subtypes, `attachment` rows and the open-world `raw` fallback are task 8;
 * tool pairing, orphan resolution, subagent linking and 64 KiB elision are task 9. Accordingly this
 * half does NO pairing: a `tool_result` block emits its pre-pairing candidate node — an
 * `orphan_result` (spec §7.5: a result with no call in pairing state is an orphan, NEVER a drop) —
 * and task 9 resolves it. Text-bearing nodes are emitted un-elided (`elided: false`); the 64 KiB
 * treatment (D15) arrives in task 9.
 */
import { tokenizeMarkdown } from './markdown.ts';
import type { TranscriptRecord } from './records.ts';
import type { RenderNode, RowAnchor, Sized, ToolResult } from './model.ts';

/** One already-parsed transcript row plus the byte offset of its first byte in the file. `at` is
 * the identity half every node inherits (spec §4) — it is a property of the bytes on disk, so the
 * same row re-normalized on a later tick or a back-fill gets the SAME node id. */
export interface RowInput {
  record: TranscriptRecord;
  at: number;
}

const MESSAGE_TYPES = new Set(['user', 'assistant']);

export function normalize(rows: RowInput[]): RenderNode[] {
  const nodes: RenderNode[] = [];
  for (const row of rows) {
    // PART 1 handles message rows only; every other row type is task 8's raw/chip dispatch.
    if (!MESSAGE_TYPES.has(row.record.type)) continue;
    normalizeMessageRow(row, nodes);
  }
  return nodes;
}

function normalizeMessageRow(row: RowInput, out: RenderNode[]): void {
  const message = asRecord(row.record.message);
  if (message === null) return;
  const content = message.content;
  const model = typeof message.model === 'string' ? message.model : null;

  // A bare string is the single content block "the row itself" — treated as one `text` block, so a
  // string on a user row becomes a prompt and on an assistant row an assistant node (spec §7.2).
  if (typeof content === 'string') {
    const node = blockToNode(row, 0, { type: 'text', text: content }, model);
    if (node !== null) out.push(node);
    return;
  }
  if (!Array.isArray(content)) return;

  // `i` is the block's TRUE index within `message.content` (spec §4 addresses payloads by it), so
  // the raw array is walked directly — a non-object entry is skipped WITHOUT shifting the index.
  content.forEach((raw, i) => {
    if (!isObject(raw)) return;
    const node = blockToNode(row, i, raw, model);
    if (node !== null) out.push(node);
  });
}

/** Exactly one outcome per block (spec §7.1 block-level ladder, D28): a node, or silence (empty
 * `thinking` only). This half never returns a Patch — pairing is task 9. */
function blockToNode(row: RowInput, i: number, block: Record<string, unknown>, model: string | null): RenderNode | null {
  const base = anchorOf(row, i);
  const isUser = row.record.type === 'user';

  switch (block.type) {
    case 'text': {
      const text = typeof block.text === 'string' ? block.text : '';
      return isUser
        ? { ...base, ...sized(), k: 'prompt', body: tokenizeMarkdown(text), chips: [] } // chips: task 8
        : { ...base, ...sized(), k: 'assistant', body: tokenizeMarkdown(text), model };
    }
    case 'thinking': {
      const thinking = typeof block.thinking === 'string' ? block.thinking : '';
      // Named exception (spec §7.2): an empty `thinking` carries nothing on disk (it arrives with a
      // `signature` and nothing else, B9); 8,411 of 17,873 measured are empty. Emitting them would
      // produce 8,411 empty cards, so this is the ONE content-bearing block type declined a node.
      // `signature` is never rendered. Skipping is NOT under-rendering — nothing is on disk.
      if (thinking === '') return null;
      return { ...base, ...sized(), k: 'thinking', body: tokenizeMarkdown(thinking) };
    }
    case 'tool_use': {
      // Pre-pairing candidate: pending, no result, no result anchor. Task 9 pairs it and may set
      // `state`, `result`, `resultAnchor`, `agentId`.
      return {
        ...base,
        ...sized(),
        k: 'tool',
        name: typeof block.name === 'string' ? block.name : 'tool',
        input: 'input' in block ? block.input : undefined,
        state: 'pending',
        result: null,
        toolUseId: typeof block.id === 'string' ? block.id : null,
        agentId: null,
        call: { at: base.at, i: base.i },
        resultAnchor: null,
      };
    }
    case 'tool_result': {
      // No pairing state in part 1, so every result is an orphan_result — never dropped (spec §7.5,
      // B1). Task 9 converts the orphans whose call is in view into completed tool cards + Patches.
      const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
      const isError = block.is_error === true;
      return {
        ...base,
        ...sized(),
        k: 'orphan_result',
        toolUseId,
        result: toToolResult(block.content, isError),
        resultAnchor: { at: base.at, i: base.i },
      };
    }
    case 'image': {
      const source = asRecord(block.source);
      const mediaType = source !== null && typeof source.media_type === 'string' ? source.media_type : 'application/octet-stream';
      const data = source !== null && typeof source.data === 'string' ? source.data : '';
      // An image node holds only mediaType + byte count; the bytes themselves are fetched on expand
      // (spec §7.2), so it is inherently expandable regardless of the 64 KiB elision (task 9).
      return { ...base, elided: false, expandable: true, k: 'image', mediaType, bytes: base64ByteLength(data) };
    }
    default:
      // The five measured message-block types (spec §7.2) are handled above; there is no other in
      // the corpus. An unknown block type is out of part-1 scope.
      return null;
  }
}

/** A `tool_result`'s payload, mapped to its measured `ToolResult` variant (spec §4, §7.5). The
 * four measured content shapes: `string`, `array[text]`, `array[tool_reference]`, `array[image]`. */
function toToolResult(content: unknown, isError: boolean): ToolResult {
  if (typeof content === 'string') {
    return { r: 'text', body: tokenizeMarkdown(content), isError, elided: false };
  }
  if (Array.isArray(content)) {
    const blocks = content.filter(isObject);
    if (blocks.some((b) => b.type === 'tool_reference')) {
      return { r: 'refs', count: blocks.filter((b) => b.type === 'tool_reference').length };
    }
    if (blocks.some((b) => b.type === 'image')) {
      return { r: 'images', count: blocks.filter((b) => b.type === 'image').length };
    }
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
    return { r: 'text', body: tokenizeMarkdown(text), isError, elided: false };
  }
  return { r: 'text', body: tokenizeMarkdown(''), isError, elided: false };
}

function anchorOf(row: RowInput, i: number): RowAnchor {
  return {
    id: `${row.at}:${i}`,
    at: row.at,
    i,
    uuid: row.record.uuid ?? null,
    ts: row.record.timestamp ?? null,
  };
}

/** Un-elided, non-expandable — the default for text-bearing nodes in part 1. The 64 KiB elision
 * (D15) is task 9; `image` overrides `expandable` at its call site. */
function sized(): Sized {
  return { elided: false, expandable: false };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decoded byte length of a base64 string, computed arithmetically (pure — no decode). */
function base64ByteLength(data: string): number {
  const clean = data.replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor(clean.length / 4) * 3 - padding;
}
