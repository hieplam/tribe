// core/model.ts — the shared wire contract (spec §4) and the route contract (spec §3.2).
//
// This file is PURE and types-only, with exactly one runtime export: `RENDER_NODE_KINDS` (the
// compiler-checked runtime witness for `RenderNode["k"]`, spec §4). Nothing here touches the
// filesystem, the clock, ambient process environment variables, or the network — every
// dependency below is a plain data shape, never a side effect (`pure-core.md`).

/** One on-disk project directory under the resolved projects root (§5.1). */
export interface Project {
  dir: string;            // on-disk encoded directory name under ~/.claude/projects
  cwd: string | null;     // real cwd read from inside a transcript; null => label with `dir`
  sessionCount: number;
  newestMtimeIso: string | null;
  live: boolean;          // any session live (§5.4)
}

/** A campaign's claim on one session. A session can carry more than one badge (§9): identity is
 * the PAIR `(repoKey, slug)`, never the slug alone. */
export interface Badge {
  repoKey: string;
  slug: string;
  cardId: string;
  cardStatus: string;
  runnerAlive: boolean;
  runId: string | null;
}

export interface SessionSummary {
  id: string;             // <sessionId>, the .jsonl basename
  projectDir: string;
  title: string;          // §5.3
  titleSource: 'custom-title' | 'ai-title' | 'last-prompt' | 'first-user' | 'session-id';
  sizeBytes: number;
  mtimeIso: string;
  live: boolean;
  subagentCount: number;
  badges: Badge[];          // usually 0 or 1; 2+ on a real collision (§9)
  /** EVERY encoded project directory that holds a session file with this id (§5.2). */
  projects: string[];
}

export interface Agent {
  id: string;             // agentId, from agent-<id>.jsonl
  parentId: string | null;// from .meta.json parentAgentId, when it resolves in the same batch
  depth: number;          // spawnDepth, default 1
  agentType: string | null;
  label: string;          // description, else `agent <id>`
  toolUseId: string | null;
  model: string | null;
  sizeBytes: number;
  mtimeIso: string | null;
  birthtimeIso: string | null;
  live: boolean;
}

export type MdToken =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string; lang: string | null }   // fenced block
  | { t: 'inline-code'; v: string }
  | { t: 'strong' | 'em'; c: MdToken[] }
  | { t: 'link'; href: string; c: MdToken[] }       // href gated exactly as today
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; c: MdToken[] }
  | { t: 'li'; ordered: boolean; c: MdToken[] }
  | { t: 'br' };

/** THE address of a node and of its payload — one scheme, used everywhere (§4). */
export interface Anchor {
  at: number; // byte offset of the ROW's first byte
  i: number;  // 0-based index of this node's content block within that row's message.content
}

/** An inline marker lifted OUT of a prompt's text rather than left as XML in the markdown (§7.6).
 * The four kinds are exactly the tag families measured on this machine. */
export interface Chip {
  kind: 'slash-command'      // <command-name> + <command-message> + <command-args>
      | 'system-reminder'    // <system-reminder>
      | 'local-command'      // <local-command-stdout>
      | 'ide-context';       // <ide_opened_file>, <ide_selection>
  label: string;             // the command, or the reminder's first line
  detail: string | null;     // args, stdout, or the file name; null when the label is the whole of it
  anchor: Anchor;
}

export interface RowAnchor {
  id: string;             // `${at}:${i}` — the two fields below, joined
  at: number;             // byte offset of the ROW's first byte
  i: number;              // index of the block within message.content; 0 for a whole-row node
  uuid: string | null;    // the row's own uuid, when it has one; NEVER the identity
  ts: string | null;      // the row's timestamp, verbatim; NEVER used for ordering
}

/** D15: EVERY node kind carries these two fields — there is no exception. */
export interface Sized {
  elided: boolean;     // true when the node holds a truncated prefix of its payload
  expandable: boolean; // true when the full payload is fetchable at /api/block?at=&i=
}

export type RenderNode = RowAnchor & Sized & (
  | { k: 'prompt'; body: MdToken[]; chips: Chip[] }
  | { k: 'assistant'; body: MdToken[]; model: string | null }
  | { k: 'thinking'; body: MdToken[] }
  | {
      k: 'tool';
      name: string;
      input: unknown;
      state: 'pending' | 'ok' | 'error';
      result: ToolResult | null;
      toolUseId: string | null;
      agentId: string | null;
      /** D19: a tool card is TWO payloads in two different rows. `call` is this node's own
       * `{at, i}` — the `tool_use` block. `resultAnchor` is the expansion address of the paired
       * result, set by pairing and null while pending. */
      call: Anchor;
      resultAnchor: Anchor | null;
    }
  | { k: 'orphan_result'; toolUseId: string; result: ToolResult; resultAnchor: Anchor }
  | { k: 'image'; mediaType: string; bytes: number }
  | { k: 'attachment'; label: string; detail: string | null }
  | { k: 'chip'; label: string; detail: string | null; href: string | null }
  | { k: 'divider'; label: string }
  | { k: 'error'; status: number | null; body: MdToken[] }
  | {
      k: 'raw';
      rowType: string;
      json: string;
      bytes: number;
      /** The human label for `rowType: "oversized"` ONLY — "row too large (N bytes)" (§6.1).
       * null for every other raw card, whose content is `json`. */
      text: string | null;
    }
  | { k: 'unreadable'; count: number }
);

/** A tool call's result, once it has one (§4). */
export type ToolResult =
  | { r: 'text'; body: MdToken[]; isError: boolean; elided: boolean }
  | { r: 'spill'; name: string; note: string; previewBody: MdToken[] } // <persisted-output>
  | { r: 'images'; count: number }
  | { r: 'refs'; count: number };                                     // array[tool_reference]

/** The runtime witness for `RenderNode["k"]`. TypeScript types are erased, so a test cannot
 * iterate the union — it iterates THIS, and the `Record<RenderNode["k"], true>` annotation makes
 * the compiler reject the file the moment a kind is added to the union without being added here. */
export const RENDER_NODE_KINDS: Record<RenderNode['k'], true> = {
  prompt: true,
  assistant: true,
  thinking: true,
  tool: true,
  orphan_result: true,
  image: true,
  attachment: true,
  chip: true,
  divider: true,
  error: true,
  raw: true,
  unreadable: true,
};

/** A later-arriving fact about a node the client has already rendered (D27). */
export type Patch =
  | { op: 'result'; id: string; node: RenderNode }   // replace the node at `id`, in place
  | { op: 'remove'; id: string };                    // delete the node at `id`; nothing replaces it

/** What a stat must report for the tail transition to be correct (§6.1). */
export interface FileObservation {
  sizeBytes: number;
  mtimeMs: number;
  inode: number;              // st.ino; 0 when the platform cannot supply one
  birthtimeMs: number;
}

// --- Route (spec §3.2) -------------------------------------------------------------------

/** A campaign is identified by the PAIR `(repoKey, slug)`, never the slug alone (§9). */
export interface CampaignRef {
  repoKey: string;
  slug: string;
}

/** `URL -> Route`, spec §3.2's route table as a closed union. `core/routes.ts#parseRoute` is the
 * only producer. Every refusal is a value in this union (`bad_request` | `not_found`) — there is
 * no throwing branch anywhere in the parser (`fail-closed-edges` obligation 1). */
export type Route =
  // Client-routed: the server returns the SPA shell (200, index.html) unconditionally for these
  // — "by prefix, not by existence" (§3.2's closing rule). The shell never joins a path from the
  // id it carries; the client re-resolves everything through the /api/* routes below.
  | { kind: 'shell'; campaign: CampaignRef | null; all: boolean } // GET / and GET /index.html
  | { kind: 'shell_project'; projectDir: string }                // GET /p/<encodedProjectDir>
  | { kind: 'shell_session'; sessionId: string }                 // GET /s/<sessionId>
  | { kind: 'shell_session_agent'; sessionId: string; agentId: string } // GET /s/<sessionId>/a/<agentId>
  | { kind: 'health' }                                           // GET /healthz
  | { kind: 'asset'; name: string }                              // GET /assets/<name>
  | { kind: 'api_projects'; all: boolean }                       // GET /api/projects
  | { kind: 'api_sessions'; project: string }                    // GET /api/sessions
  | { kind: 'api_session'; sessionId: string }                   // GET /api/session/<sessionId>
  | {
      kind: 'api_rows';
      sessionId: string;
      agentId: string | null;
      before: number | null;
      limit: number;
      orphans: string[];
    } // GET /api/rows
  | { kind: 'api_block'; sessionId: string; agentId: string | null; at: number; i: number } // GET /api/block
  | { kind: 'api_spill'; sessionId: string; agentId: string | null; name: string }          // GET /api/spill
  | { kind: 'events'; sessionId: string; agentId: string | null }                           // GET /events
  | { kind: 'bad_request'; reason: string }
  | { kind: 'not_found'; path: string };
