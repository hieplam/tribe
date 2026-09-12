/**
 * The normalizer (spec §7). Part 1 (task 7) handled `user`/`assistant` message rows and their
 * content blocks; part 2 (task 8) adds the whole-row half: named metadata rows, `system` subtypes,
 * `attachment` rows, XML chips, `<persisted-output>` spills, and the OPEN-WORLD `raw` fallback.
 *
 * PURE core (`pure-core.md`): this module receives ALREADY-PARSED rows plus each row's byte offset
 * and returns `RenderNode[]`. It touches no filesystem, no clock, no environment, no network — its
 * only dependency is `tokenizeMarkdown`, itself pure. `structure.test.ts` enforces this wall. The
 * metadata half re-parses each row's verbatim `raw` line (JSON.parse — pure, deterministic) to read
 * the type-specific fields records.ts does not carry as typed members.
 *
 * The oracle (spec §0): the transcripts on this machine decide correctness. **Under-rendering** — a
 * row present on disk that this normalizer drops silently — **is a bug** (that is B1/B2/B10). So
 * the row dispatch has NO silent skip: every non-message, non-folded row emits a node, and an
 * UNKNOWN row type falls to a `raw` card (spec §7.1 bucket D) — over-rendering an unknown row is by
 * design. The ONLY `continue` in this module is the empty-`thinking` exception (spec §7.2).
 *
 * SCOPE — still no tool pairing (task 9): a `tool_result` block emits its pre-pairing candidate, an
 * `orphan_result` (spec §7.5: a result with no call in pairing state is an orphan, NEVER a drop).
 * No 64 KiB elision yet (D15, task 9); text-bearing nodes are emitted un-elided. Oversized-row
 * handling (D26 rung 1) lives in the byte readers, not here — a parsed row is under the cap.
 */
import { tokenizeMarkdown } from './markdown.ts';
import type { TranscriptRecord } from './records.ts';
import type { Anchor, Chip, RenderNode, RowAnchor, Sized, ToolResult } from './model.ts';

/** One already-parsed transcript row plus the byte offset of its first byte in the file. `at` is
 * the identity half every node inherits (spec §4) — it is a property of the bytes on disk, so the
 * same row re-normalized on a later tick or a back-fill gets the SAME node id. */
export interface RowInput {
  record: TranscriptRecord;
  at: number;
}

/** Rung 2 (D23): these fold into the session title (§5.3). They are consumed, not dropped — the
 * title reader reads them; the transcript view shows no node of their own. */
const TITLE_SOURCE_TYPES = new Set(['last-prompt', 'ai-title', 'custom-title']);

/** Rung 4 (D23) chip rows and the field each is labelled by (spec §7.1). `content` (when present)
 * becomes the chip detail for the operation-style rows. */
const CHIP_LABEL_FIELD: Record<string, string> = {
  mode: 'mode',
  'permission-mode': 'permissionMode',
  'queue-operation': 'operation',
  'agent-name': 'agentName',
  relocated: 'relocatedCwd',
};

export function normalize(rows: RowInput[]): RenderNode[] {
  const out: RenderNode[] = [];
  for (const row of rows) normalizeRow(row, out);
  return out;
}

/** The ROW-level dispatch (spec §7.1 ladder, D23/D28). No `continue` here: a skipped row is exactly
 * the B1/B10 under-rendering bug this replaces. */
function normalizeRow(row: RowInput, out: RenderNode[]): void {
  const type = row.record.type;

  // Rung 2: title-source rows are folded into the title (§5.3) — no node, and NOT a raw card.
  if (TITLE_SOURCE_TYPES.has(type)) return;

  // Bucket A: message rows descend to the block level (D28).
  if (type === 'user' || type === 'assistant') {
    normalizeMessageRow(row, out);
    return;
  }

  // Rung 4: every other row emits exactly one node — a chip, divider, attachment, or (default) the
  // open-world `raw` card. A future Claude Code row type renders as raw on day one, never dropped.
  out.push(normalizeMetadataRow(row));
}

function normalizeMessageRow(row: RowInput, out: RenderNode[]): void {
  const record = row.record;

  // A compaction summary (measured: 1, on a user row) renders as ONE divider, not its content
  // blocks (spec §7.4). A `system compact_boundary` row reaches the same divider via rung 4.
  if (record.isCompactSummary === true) {
    out.push({ ...anchorOf(row, 0), ...sized(), k: 'divider', label: 'context compacted' });
    return;
  }

  // An API-error row (isApiErrorMessage / apiErrorStatus) renders as ONE error node carrying the
  // status and the error text (spec §8.1 ErrorCard). Measured shape: assistant row, status 429.
  if (typeof record.apiErrorStatus === 'number') {
    out.push({ ...anchorOf(row, 0), ...sized(), k: 'error', status: record.apiErrorStatus, body: tokenizeMarkdown(messageText(record)) });
    return;
  }

  const message = asRecord(record.message);
  if (message === null) return;
  const content = message.content;
  const model = typeof message.model === 'string' ? message.model : null;

  // A bare string is the single content block "the row itself" — treated as one `text` block, so a
  // string on a user row becomes a prompt and on an assistant row an assistant node (spec §7.2).
  if (typeof content === 'string') {
    out.push(blockToNode(row, 0, { type: 'text', text: content }, model));
    return;
  }
  if (!Array.isArray(content)) return;

  // `i` is the block's TRUE index within `message.content` (spec §4 addresses payloads by it), so
  // the raw array is walked directly — a non-object entry consumes its index WITHOUT emitting.
  for (let i = 0; i < content.length; i++) {
    const raw = content[i];
    if (isObject(raw)) {
      // Named exception (spec §7.2): a `thinking` block whose text is "" carries nothing on disk (it
      // arrives with a `signature` and nothing else, B9; 8,411 of 17,873 measured). Emitting them
      // would produce 8,411 empty cards, so this is the ONE block type declined a node — the single
      // `continue` in this module. Skipping is NOT under-rendering: there is nothing on disk.
      if (raw.type === 'thinking' && !(typeof raw.thinking === 'string' && raw.thinking !== '')) continue;
      out.push(blockToNode(row, i, raw, model));
    }
  }
}

/** Exactly one node per (kept) block (spec §7.1 block-level ladder, D28). Empty `thinking` is
 * filtered by its caller, so every block that reaches here emits a node. This half never returns a
 * Patch — pairing is task 9. */
function blockToNode(row: RowInput, i: number, block: Record<string, unknown>, model: string | null): RenderNode {
  const base = anchorOf(row, i);
  const isUser = row.record.type === 'user';

  switch (block.type) {
    case 'text': {
      const text = typeof block.text === 'string' ? block.text : '';
      if (isUser) {
        // §7.6: lift recognised XML tags OUT of the prompt text into `chips` (never left as markup).
        const { chips, remaining } = extractChips(text, { at: base.at, i });
        return { ...base, ...sized(), k: 'prompt', body: tokenizeMarkdown(remaining), chips };
      }
      return { ...base, ...sized(), k: 'assistant', body: tokenizeMarkdown(text), model };
    }
    case 'thinking': {
      const thinking = typeof block.thinking === 'string' ? block.thinking : '';
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
      // No pairing state in this half, so every result is an orphan_result — never dropped (spec
      // §7.5, B1). Task 9 converts the orphans whose call is in view into completed tool cards.
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
      // An unknown block type (never measured in 127,085 rows) is still on disk, so it is never
      // dropped: it becomes a raw card carrying the block's JSON (open-world rule, spec §7.1).
      return { ...base, ...sized(), k: 'raw', rowType: `block:${String(block.type)}`, json: JSON.stringify(block), bytes: utf8Bytes(JSON.stringify(block)), text: null };
  }
}

// ---------------------------------------------------------------------------------------------
// Rung 4 — the whole-row (non-message) half (spec §7.1, §7.3, §7.4).
// ---------------------------------------------------------------------------------------------

function normalizeMetadataRow(row: RowInput): RenderNode {
  const type = row.record.type;
  const obj = parseRaw(row.record.raw);

  switch (type) {
    case 'attachment':
      return attachmentNode(row, obj);
    case 'system':
      return systemNode(row, obj);
    case 'pr-link':
      return chipNode(row, prLabel(obj), null, gateHref(field(obj, 'prUrl')));
    case 'frame-link':
      return chipNode(row, frameLabel(obj), null, gateHref(field(obj, 'frameUrl')));
    case 'cost-state':
      return chipNode(row, `$${field(obj, 'totalCostUSD')}`, `${field(obj, 'totalDuration')} ms`, null);
    default: {
      const labelField = CHIP_LABEL_FIELD[type];
      if (labelField !== undefined) {
        const content = field(obj, 'content');
        return chipNode(row, field(obj, labelField), content !== '' ? content : null, null);
      }
      // Bucket D: the open-world raw card — every unknown or collapsed-raw row type (atis-latch,
      // file-history-*, bridge-session, worktree-state, fork-context-ref, and anything a future
      // release invents). Never a drop.
      return rawNode(row);
    }
  }
}

function systemNode(row: RowInput, obj: Record<string, unknown> | null): RenderNode {
  const subtype = field(obj, 'subtype');
  const content = field(obj, 'content');
  switch (subtype) {
    case 'turn_duration': {
      const seconds = (numField(obj, 'durationMs') / 1000).toFixed(1);
      return dividerNode(row, `${seconds}s · ${numField(obj, 'messageCount')} messages`);
    }
    case 'compact_boundary':
      return dividerNode(row, 'context compacted');
    case 'local_command': {
      // §7.6: the chip is the `<command-name>` parsed out of `content`.
      const cmd = parseCommandChip(content);
      return chipNode(row, cmd?.label ?? 'local command', cmd?.detail ?? null, null);
    }
    case 'stop_hook_summary':
      return chipNode(row, 'stop hooks', `${numField(obj, 'hookCount')} hook(s) · ${field(obj, 'stopReason')}`, null);
    case 'away_summary':
    case 'informational':
    case 'bridge_status':
    case 'scheduled_task_fire':
      return chipNode(row, subtype.replace(/_/g, ' '), content !== '' ? content : null, null);
    default:
      // Absent or unknown subtype (0 measured) — the open-world raw card (spec §7.4 last row).
      return rawNode(row);
  }
}

function attachmentNode(row: RowInput, obj: Record<string, unknown> | null): RenderNode {
  const att = isObject(obj?.attachment) ? (obj!.attachment as Record<string, unknown>) : {};
  const label = typeof att.type === 'string' ? att.type : 'attachment';
  const rendered = typeof att.rendered === 'string' ? att.rendered : null;
  // §7.3: `rendered` (5,817 measured) becomes the inline detail, so no fetch is needed. With no
  // `rendered` and nothing beyond the label, there is nothing to expand into (`expandable: false`);
  // with other content present, the full object is fetchable via /api/block.
  const hasMore = Object.keys(att).some((k) => k !== 'type' && k !== 'rendered');
  const expandable = rendered === null && hasMore;
  return { ...anchorOf(row, 0), elided: false, expandable, k: 'attachment', label, detail: rendered };
}

function chipNode(row: RowInput, label: string, detail: string | null, href: string | null): RenderNode {
  return { ...anchorOf(row, 0), ...sized(), k: 'chip', label, detail, href };
}

function dividerNode(row: RowInput, label: string): RenderNode {
  return { ...anchorOf(row, 0), ...sized(), k: 'divider', label };
}

/** Bucket D (spec §7.1): a collapsed raw card carrying the row's own JSON verbatim. `text` is the
 * oversized label ONLY (§6.1); a plain raw card has none. */
function rawNode(row: RowInput): RenderNode {
  const json = row.record.raw;
  return { ...anchorOf(row, 0), ...sized(), k: 'raw', rowType: row.record.type, json, bytes: utf8Bytes(json), text: null };
}

// ---------------------------------------------------------------------------------------------
// §7.6 — XML chip extraction and <persisted-output> spills.
// ---------------------------------------------------------------------------------------------

const CHIP_HEAD = 4096; // §7.6: a bounded regex over the FIRST 4 KiB of the text.
const SLASH_RE = /<command-name>([\s\S]*?)<\/command-name>(?:\s*<command-message>[\s\S]*?<\/command-message>)?(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/g;
const REMINDER_RE = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
const LOCAL_STDOUT_RE = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g;
const IDE_RE = /<ide_opened_file>([\s\S]*?)<\/ide_opened_file>|<ide_selection>([\s\S]*?)<\/ide_selection>/g;

/** Lift the recognised XML tag families (spec §7.6) out of a prompt's text into `Chip` values,
 * returning the text with those spans removed. `label` is the command or the first line; `detail`
 * is the args / stdout / trailing lines, `null` when the label is the whole of it. Any other tag —
 * or an unbalanced one — stays in the text (never matched), so it degrades to plain text and never
 * throws. Parsing is bounded to the first 4 KiB; tags beyond it stay as text. */
function extractChips(text: string, anchor: Anchor): { chips: Chip[]; remaining: string } {
  const head = text.slice(0, CHIP_HEAD);
  const tail = text.slice(CHIP_HEAD);
  const found: { index: number; length: number; chip: Chip }[] = [];

  const collect = (re: RegExp, make: (m: RegExpMatchArray) => Chip): void => {
    for (const m of head.matchAll(re)) {
      found.push({ index: m.index ?? 0, length: m[0].length, chip: make(m) });
    }
  };

  collect(SLASH_RE, (m) => {
    const args = (m[2] ?? '').trim();
    return { kind: 'slash-command', label: (m[1] ?? '').trim(), detail: args !== '' ? args : null, anchor };
  });
  collect(REMINDER_RE, (m) => textChip('system-reminder', m[1] ?? '', anchor));
  collect(LOCAL_STDOUT_RE, (m) => textChip('local-command', m[1] ?? '', anchor));
  collect(IDE_RE, (m) => textChip('ide-context', m[1] ?? m[2] ?? '', anchor));

  found.sort((a, b) => a.index - b.index);

  let remaining = '';
  let cursor = 0;
  for (const f of found) {
    remaining += head.slice(cursor, f.index);
    cursor = f.index + f.length;
  }
  remaining += head.slice(cursor) + tail;
  return { chips: found.map((f) => f.chip), remaining };
}

/** A chip whose inner text splits into a first-line label and the remaining lines as detail. */
function textChip(kind: Chip['kind'], inner: string, anchor: Anchor): Chip {
  const trimmed = inner.trim();
  const nl = trimmed.indexOf('\n');
  if (nl === -1) return { kind, label: trimmed, detail: null, anchor };
  const rest = trimmed.slice(nl + 1).trim();
  return { kind, label: trimmed.slice(0, nl).trim(), detail: rest !== '' ? rest : null, anchor };
}

/** The `<command-name>` (+ optional `<command-args>`) chip fields, for a `system local_command`
 * row (§7.4). null when no `<command-name>` is present. */
function parseCommandChip(content: string): { label: string; detail: string | null } | null {
  const m = new RegExp(SLASH_RE.source).exec(content);
  if (m === null) return null;
  const args = (m[2] ?? '').trim();
  return { label: (m[1] ?? '').trim(), detail: args !== '' ? args : null };
}

/** A `tool_result`'s payload, mapped to its measured `ToolResult` variant (spec §4, §7.5). The
 * measured content shapes: `string`, `array[text]`, `array[tool_reference]`, `array[image]`, plus
 * the `<persisted-output>` spill marker inside a string (§7.6). */
function toToolResult(content: unknown, isError: boolean): ToolResult {
  if (typeof content === 'string') {
    const spill = parseSpill(content);
    if (spill !== null) return spill;
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

/** A `<persisted-output>` marker (spec §7.6, `fail-closed-edges` obligation 4). The marker carries
 * an ABSOLUTE path, which is NEVER used as given: the node keeps `basename()` only, and only when it
 * matches `^[A-Za-z0-9._-]{1,128}$` (else empty — refused). The absolute path, and every directory
 * separator from it, is dropped: leaking one is an information leak AND a traversal seed. The
 * preview text the marker already carries is kept, so a refused spill still shows something. */
function parseSpill(content: string): ToolResult | null {
  if (!content.includes('<persisted-output>')) return null;
  const pathMatch = /saved to:\s*(.+)/.exec(content);
  const rawPath = pathMatch !== null ? pathMatch[1]!.trim() : '';
  const lastSlash = Math.max(rawPath.lastIndexOf('/'), rawPath.lastIndexOf('\\'));
  const base = lastSlash === -1 ? rawPath : rawPath.slice(lastSlash + 1);
  const name = /^[A-Za-z0-9._-]{1,128}$/.test(base) ? base : '';
  const previewMatch = /Preview[^\n]*:\s*\n([\s\S]*?)<\/persisted-output>/.exec(content);
  const preview = previewMatch !== null ? previewMatch[1]!.trim() : '';
  return { r: 'spill', name, note: 'output spilled to a file', previewBody: tokenizeMarkdown(preview) };
}

// ---------------------------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------------------------

/** The plain text of a message row (bare string, or the concatenated `text` blocks). */
function messageText(record: TranscriptRecord): string {
  const message = asRecord(record.message);
  if (message === null) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObject)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function prLabel(obj: Record<string, unknown> | null): string {
  const n = field(obj, 'prNumber');
  return n !== '' ? `PR #${n}` : 'pull request';
}

function frameLabel(obj: Record<string, unknown> | null): string {
  const title = field(obj, 'title');
  return title !== '' ? title : 'frame';
}

/** The href gate (spec §12.5): `http:`, `https:`, `mailto:` only — anything else (or an unparsable
 * value) drops to null. Mirrors `markdown.ts`'s gate; kept local because that one is not exported. */
function gateHref(value: string): string | null {
  if (value === '') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? value : null;
  } catch {
    return null;
  }
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

/** Un-elided, non-expandable — chips, dividers, raw cards, error cards and text-bearing part-1
 * nodes. The 64 KiB elision (D15) is task 9; `image`/`attachment` override `expandable` at their
 * call sites. */
function sized(): Sized {
  return { elided: false, expandable: false };
}

/** Re-parse the verbatim row line. records.ts already parsed it once, so this cannot throw for a
 * real record; the guard is defensive and pure. */
function parseRaw(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A string field, else its stringified scalar, else '' — the label/detail source for chips. */
function field(obj: Record<string, unknown> | null, key: string): string {
  if (obj === null) return '';
  const v = obj[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function numField(obj: Record<string, unknown> | null, key: string): number {
  const v = obj === null ? undefined : obj[key];
  return typeof v === 'number' ? v : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** UTF-8 byte length of a string, computed without decoding into a Buffer (pure, no Node global). */
function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Decoded byte length of a base64 string, computed arithmetically (pure — no decode). */
function base64ByteLength(data: string): number {
  const clean = data.replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor(clean.length / 4) * 3 - padding;
}
