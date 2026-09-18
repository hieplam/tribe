/**
 * core/title.ts — session title resolution (spec §5.3). PURE (`pure-core.md`): this module takes
 * already-read HEAD and TAIL line arrays (produced elsewhere — e.g.
 * `core/window.ts#completeLines` over a bounded byte read), a session id, and decides the title.
 * It never stats or reads a file itself.
 *
 * Title rule (Shaman ruling, spec §5.3, in order): last `custom-title`, else last `ai-title`,
 * else `last-prompt`, else the first user message, else the session id.
 *
 * `custom-title` / `ai-title` / `last-prompt` are read from the TAIL window (they are appended to
 * the file, so the newest — and therefore last-wins-relevant — copy lives near the end); the
 * first user message is read from the HEAD window (it is, structurally, near the start of the
 * file). A caller that hands both windows the whole file (task 10's `tools/title-window.ts`
 * baseline) gets the same answer a whole-file read would, because "last in tailLines" and "first
 * in headLines" are both still correct over the complete line set.
 *
 * Line parsing here is deliberately tolerant, the same discipline `core/records.ts` uses: a line
 * that fails to parse as a JSON object — including a truncated fragment from a tail window that
 * started mid-row — is silently skipped, never thrown, and never salvaged by a heuristic. That is
 * what makes the "partial first tail line" case (title.test.ts) correct: the fragment simply
 * never matches any of the three title-source shapes, so scanning continues to the next, whole
 * line.
 */

export type TitleSource = 'custom-title' | 'ai-title' | 'last-prompt' | 'first-user' | 'session-id';

export interface TitleResult {
  title: string;
  titleSource: TitleSource;
}

export function resolveTitle(headLines: string[], tailLines: string[], sessionId: string): TitleResult {
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let lastPrompt: string | null = null;

  // Forward scan, always overwriting on a further match — this is what makes "the LAST one wins"
  // correct without a second pass or an explicit index comparison.
  for (const line of tailLines) {
    const row = parseJsonObject(line);
    if (row === null || typeof row.type !== 'string') continue;
    if (row.type === 'custom-title' && typeof row.customTitle === 'string') {
      customTitle = row.customTitle;
    } else if (row.type === 'ai-title' && typeof row.aiTitle === 'string') {
      aiTitle = row.aiTitle;
    } else if (row.type === 'last-prompt' && typeof row.lastPrompt === 'string') {
      lastPrompt = row.lastPrompt;
    }
  }

  if (customTitle !== null) return { title: customTitle, titleSource: 'custom-title' };
  if (aiTitle !== null) return { title: aiTitle, titleSource: 'ai-title' };
  if (lastPrompt !== null) return { title: lastPrompt, titleSource: 'last-prompt' };

  const firstUser = firstUserMessageText(headLines);
  if (firstUser !== null) return { title: firstUser, titleSource: 'first-user' };

  return { title: sessionId, titleSource: 'session-id' };
}

/** The FIRST `user` row's message text — a bare string, or the first `text` content block. Only
 * the first `user` row in `headLines` is consulted (spec §5.3 names "the first user message",
 * singular): a first `user` row whose content carries no extractable text yields `null`, falling
 * through to the session id, rather than searching further rows for one that does. */
function firstUserMessageText(headLines: string[]): string | null {
  for (const line of headLines) {
    const row = parseJsonObject(line);
    if (row === null || row.type !== 'user') continue;
    const message = row.message;
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return null;
    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string') return content.length > 0 ? content : null;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) return b.text;
      }
    }
    return null;
  }
  return null;
}

/** A tolerant, throw-free JSON-object parse: malformed JSON, a bare scalar, an array, and `null`
 * all yield `null` rather than a thrown exception — the same tolerance `core/records.ts` applies
 * to a transcript line (`fail-closed-edges.md` obligation 1). */
function parseJsonObject(line: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
