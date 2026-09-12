/**
 * Tolerant JSONL transcript reader (spec §1.1, card D7; widened per spec §11.2 for the
 * consolidation). Pure: takes already-read lines and turns them into records, never touching the
 * filesystem itself. A line that fails to parse — including a JSON array, a bare scalar, or a
 * line already carrying UTF-8 replacement characters from an upstream non-fatal decode — is never
 * thrown; it is counted in `skipped` and dropped.
 */

export interface TranscriptRecord {
  type: string;
  uuid?: string;
  parentUuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  message?: unknown;
  toolUseResult?: unknown;
  isSidechain?: boolean;
  agentId?: string;
  subtype?: string;         // spec §7.4 — `system` rows dispatch on it
  content?: unknown;        // spec §7.4 — a `system` row's payload is top-level `content` (B10)
  attachment?: unknown;     // spec §7.3 — the attachment object payload
  isMeta?: boolean;
  isCompactSummary?: boolean; // spec §7.4 — the compaction divider
  apiErrorStatus?: number;
  isApiErrorMessage?: boolean;
  /** The verbatim source line, byte-for-byte as read. The `raw` card (spec §4, bucket D) needs
   * the exact original text — re-serializing the parsed object could reorder keys or reformat
   * whitespace, which would no longer be what is actually on disk. */
  raw: string;
}

const MESSAGE_TYPES = new Set(['assistant', 'user', 'system']);

export function parseRecordLines(lines: string[]): { records: TranscriptRecord[]; skipped: number } {
  const records: TranscriptRecord[] = [];
  let skipped = 0;
  for (const line of lines) {
    const record = parseLine(line);
    if (record === null) {
      skipped += 1;
      continue;
    }
    records.push(record);
  }
  return { records, skipped };
}

function parseLine(line: string): TranscriptRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  // A JSON array or a bare scalar (number, string, boolean, null) parses without throwing but is
  // not a transcript row — reject both here, the same way as any other malformed shape.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== 'string') return null;

  const record: TranscriptRecord = { type: obj.type, raw: line };
  const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : obj.session_id;
  if (typeof sessionId === 'string') record.sessionId = sessionId;
  if (typeof obj.uuid === 'string') record.uuid = obj.uuid;
  if (typeof obj.parentUuid === 'string') record.parentUuid = obj.parentUuid;
  if (typeof obj.timestamp === 'string') record.timestamp = obj.timestamp;
  if (typeof obj.cwd === 'string') record.cwd = obj.cwd;
  if ('message' in obj) record.message = obj.message;
  if ('toolUseResult' in obj) record.toolUseResult = obj.toolUseResult;
  if (typeof obj.isSidechain === 'boolean') record.isSidechain = obj.isSidechain;
  if (typeof obj.agentId === 'string') record.agentId = obj.agentId;
  if (typeof obj.subtype === 'string') record.subtype = obj.subtype;
  if ('content' in obj) record.content = obj.content;
  if ('attachment' in obj) record.attachment = obj.attachment;
  if (typeof obj.isMeta === 'boolean') record.isMeta = obj.isMeta;
  if (typeof obj.isCompactSummary === 'boolean') record.isCompactSummary = obj.isCompactSummary;
  if (typeof obj.apiErrorStatus === 'number') record.apiErrorStatus = obj.apiErrorStatus;
  if (typeof obj.isApiErrorMessage === 'boolean') record.isApiErrorMessage = obj.isApiErrorMessage;
  return record;
}

export function isMessageRecord(record: TranscriptRecord): boolean {
  return MESSAGE_TYPES.has(record.type);
}
