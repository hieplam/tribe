/**
 * fixtures/build.ts — builds a complete `~/.claude/projects` tree (plus, for `buildHomeB`, a
 * `.tribe` campaign tree) into an empty `mkdtemp` directory, from nothing
 * (`fixtures-mirror-reality.md` obligation 2). Every shape here is copied IN SHAPE from the real
 * corpus under `~/.claude/projects` (spec §7 names the fields; the corpus is the oracle for any
 * field the spec leaves unstated).
 *
 * Shape (`pure-core.md`): everything above `materialize()` is pure data assembly — building
 * plain objects and strings, deciding nothing about the filesystem. `materialize()` is the ONE
 * thin edge: it takes the destination directory as an argument and writes exactly the file tree
 * it is handed, constructing nothing it was not given.
 */
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// ---------------------------------------------------------------------------------------------
// Constants the test suite (and later tasks) address the fixture by.
// ---------------------------------------------------------------------------------------------

export const ROW_CAP = 8 * 1024 * 1024; // D26 — one row cap, both readers

export const PROJECT_A_DIR = '-Users-fixture-repo-alpha';
export const PROJECT_B_DIR = '-Users-fixture-repo-beta';
export const PROJECT_C_DIR = '-Users-fixture-repo-gamma';

export const SESSION_1_ID = 'a0000000-0000-4000-8000-000000000001';
export const SESSION_LIVE_ID = 'a0000000-0000-4000-8000-000000000002';
export const SESSION_CUT_ID = 'a0000000-0000-4000-8000-000000000003';
export const SESSION_4_ID = 'a0000000-0000-4000-8000-000000000004';
export const SESSION_2_ID = 'b0000000-0000-4000-8000-000000000001';
export const SESSION_3_ID = 'c0000000-0000-4000-8000-000000000001';

export const INVENTED_ROW_TYPE = 'totally-invented-fixture-row-type';

export const TOOL_USE_IDS = {
  pending: 'toolu_fixture_pending01',
  ok: 'toolu_fixture_ok01',
  err: 'toolu_fixture_err01',
  mixed: 'toolu_fixture_mixed01',
  beforeWindow: 'toolu_fixture_before_window',
  spill: 'toolu_fixture_spill01',
} as const;

export const SPILL_FILE_NAME = 'fixturespill01.txt';

export const SUBAGENT_IDS = {
  root: 'root01',
  child: 'child01',
  orphan: 'orphan01',
  cycleA: 'cyclea01',
  cycleB: 'cycleb01',
  sibling: 'sib01',
} as const;

export const CAMPAIGN_SLUG = 'fixture-campaign';
export const REPO_KEY_A = '-tmp-fixture-repo-a';
export const REPO_KEY_B = '-tmp-fixture-repo-b';

export const SESSION_4_MARKERS = {
  fourBlock: 'FIXTURE-FOUR-BLOCK-ROW',
  twoMib: 'FIXTURE-2MIB-ROW',
  exactCap: 'FIXTURE-EXACT-CAP-ROW',
  oversized: 'FIXTURE-OVERSIZED-ROW',
} as const;

const TWO_MIB = 2 * 1024 * 1024;
const NINE_MIB = 9 * 1024 * 1024;

const PROJECT_A_CWD = '/Users/fixture/repo-alpha';
const PROJECT_B_CWD = '/Users/fixture/repo-beta';
const PROJECT_C_CWD = '/Users/fixture/repo-gamma';

// ---------------------------------------------------------------------------------------------
// Pure data model: a Tree is nothing but the bytes and links a target directory should end up
// holding. Building one touches no filesystem.
// ---------------------------------------------------------------------------------------------

interface FileSpec { path: string; content: string }
interface LinkSpec { path: string; target: string }
interface TouchSpec { path: string; mtimeMs: number }
interface Tree { files: FileSpec[]; links: LinkSpec[]; touches: TouchSpec[]; dirs: string[] }

function emptyTree(): Tree {
  return { files: [], links: [], touches: [], dirs: [] };
}

function mergeTrees(...trees: Tree[]): Tree {
  return trees.reduce(
    (acc, t) => ({
      files: [...acc.files, ...t.files],
      links: [...acc.links, ...t.links],
      touches: [...acc.touches, ...t.touches],
      dirs: [...acc.dirs, ...t.dirs],
    }),
    emptyTree(),
  );
}

function jsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** Serializes `withPad('')` first to learn the row's fixed cost, then pads so the final line is
 * exactly `targetBytes` long — used for the 2 MiB / exact-cap / 9 MiB session-4 rows, which must
 * hit precise byte lengths relative to `ROW_CAP` (D26). */
function padLineToBytes(withPad: (pad: string) => unknown, targetBytes: number): string {
  const zeroLen = Buffer.byteLength(JSON.stringify(withPad('')), 'utf8');
  const padLen = targetBytes - zeroLen;
  if (padLen < 0) {
    throw new Error(`fixture row template already exceeds ${targetBytes} bytes before padding`);
  }
  const line = JSON.stringify(withPad('x'.repeat(padLen)));
  const actual = Buffer.byteLength(line, 'utf8');
  if (actual !== targetBytes) {
    throw new Error(`fixture padding drift: wanted ${targetBytes} bytes, got ${actual}`);
  }
  return line;
}

// ---------------------------------------------------------------------------------------------
// session-1.jsonl — "every kind" session (spec §16.2 layer 1 & 2).
// ---------------------------------------------------------------------------------------------

function buildSession1Lines(): string[] {
  const sid = SESSION_1_ID;
  const cwd = PROJECT_A_CWD;
  const ts = (n: number) => `2026-09-01T10:00:${String(n).padStart(2, '0')}.000Z`;
  const uuid = (n: number) => `fixture-s1-r${String(n).padStart(3, '0')}`;

  const objects: unknown[] = [];
  let n = 0;
  const next = () => ++n;

  // 1: string prompt (user)
  objects.push({
    type: 'user', uuid: uuid(next()), sessionId: sid, timestamp: ts(n), cwd,
    message: { role: 'user', content: 'Build the widget exporter fixture.' },
  });
  // 2: non-empty thinking (assistant)
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'thinking', thinking: 'Let me look at the repo layout first.', signature: 'FIXSIG1' }] },
  });
  // 3: assistant row whose ONLY block is empty thinking (bucket E — silent, row not dropped)
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'thinking', thinking: '', signature: 'FIXSIG2' }] },
  });
  // 4: assistant text block
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: "I'll check the repo, then add the exporter." }] },
  });
  // 5: assistant message.content is a BARE STRING (0 measured, "handled anyway" — §7.2)
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: 'Assistant using a bare string content field (defensive path).' },
  });
  // 6: tool_use PENDING — no matching tool_result anywhere in this file
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'tool_use', id: TOOL_USE_IDS.pending, name: 'Bash', input: { command: 'ls' } }] },
  });
  // 7: tool_use for the OK pairing
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'tool_use', id: TOOL_USE_IDS.ok, name: 'Read', input: { file_path: `${cwd}/README.md` } }] },
  });
  // 8: tool_result OK
  objects.push({
    type: 'user', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: TOOL_USE_IDS.ok, content: '# Fixture repo\n', is_error: false }] },
    toolUseResult: { stdout: '# Fixture repo\n' },
  });
  // 9: tool_use for the ERROR pairing
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'tool_use', id: TOOL_USE_IDS.err, name: 'Bash', input: { command: 'false' } }] },
  });
  // 10: tool_result ERROR
  objects.push({
    type: 'user', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: TOOL_USE_IDS.err, content: 'command failed: exit 1', is_error: true }] },
  });
  // 11: tool_use EARLY, the mixed row's pairing target
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'tool_use', id: TOOL_USE_IDS.mixed, name: 'Write', input: { file_path: `${cwd}/exporter.ts`, content: 'export {}\n' } }] },
  });
  // 12: MIXED row — one user row, tool_result (pairs) AND text (D28's per-block ladder)
  objects.push({
    type: 'user', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: TOOL_USE_IDS.mixed, content: 'exporter.ts written', is_error: false },
        { type: 'text', text: 'Also, please keep the exporter under 200 lines.' },
      ],
    },
  });
  // 13: tool_result whose call is BEFORE THE WINDOW — no tool_use anywhere in this file
  objects.push({
    type: 'user', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: TOOL_USE_IDS.beforeWindow, content: 'orphaned result from a call outside this file', is_error: false }] },
  });
  // 14: array-form prompt (user), text block — the B2 case
  objects.push({
    type: 'user', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'user', content: [{ type: 'text', text: 'Array-form prompt: please add tests too.' }] },
  });
  // 15: base64 image block (user)
  objects.push({
    type: 'user', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('FIXTURE-PNG-BYTES-0123456789').toString('base64') } }] },
  });
  // 16: isCompactSummary row (user)
  objects.push({
    type: 'user', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    isCompactSummary: true,
    message: { role: 'user', content: 'Compacted context summary for the fixture session.' },
  });
  // 17: tool_use for the spill
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'tool_use', id: TOOL_USE_IDS.spill, name: 'Bash', input: { command: 'cat huge.log' } }] },
  });
  // 18: tool_result carrying the <persisted-output> marker (§7.6) — the target path is filled
  // in by buildSession1() below, once the spill file's absolute path is known.
  const spillMarkerIndex = objects.length;
  objects.push({ __spillMarkerPlaceholder: true });
  // 19: invented type — the open-world case (bucket D on day one)
  objects.push({ type: INVENTED_ROW_TYPE, uuid: uuid(next()), sessionId: sid, timestamp: ts(n), note: 'an unknown row type from a future Claude Code release' });
  // 20: attachment
  objects.push({
    type: 'attachment', uuid: uuid(next()), sessionId: sid, timestamp: ts(n), cwd,
    attachment: { type: 'total_tokens_reminder', rendered: 'Approaching context limit fixture reminder.' },
  });
  // 21: last-prompt (title source)
  objects.push({ type: 'last-prompt', lastPrompt: 'Build the widget exporter fixture.', leafUuid: uuid(1), sessionId: sid });
  // 22: ai-title (title source)
  objects.push({ type: 'ai-title', aiTitle: 'Build the widget exporter (fixture)', sessionId: sid });
  // 23: queue-operation, with content (1,391/1,996 measured carry it)
  objects.push({
    type: 'queue-operation', operation: 'enqueue', timestamp: ts(next()), sessionId: sid,
    content: '<task-notification>\n<task-id>fixturetask1</task-id>\n<status>completed</status>\n</task-notification>',
  });
  // 24: mode
  objects.push({ type: 'mode', mode: 'normal', sessionId: sid });
  // 25: atis-latch (undocumented; over-render by design)
  objects.push({ type: 'atis-latch', atis: '', sessionId: sid });
  // 26: permission-mode
  objects.push({ type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: sid });
  // 27: system, subtype away_summary — payload is top-level `content`, not `message` (B10)
  objects.push({
    parentUuid: uuid(9), isSidechain: false, type: 'system', subtype: 'away_summary',
    content: 'You asked about the exporter fixture; here is the summary.',
    timestamp: ts(next()), uuid: uuid(n), isMeta: false, userType: 'external', entrypoint: 'cli',
    cwd, sessionId: sid, version: '2.1.267', gitBranch: 'master',
  });
  // 28: pr-link
  objects.push({ type: 'pr-link', sessionId: sid, prNumber: 1, prUrl: 'https://github.com/fixture-org/fixture-repo/pull/1', prRepository: 'fixture-org/fixture-repo', timestamp: ts(next()) });
  // 29: file-history-snapshot
  const snapUuid = uuid(next());
  objects.push({ type: 'file-history-snapshot', messageId: snapUuid, snapshot: { messageId: snapUuid, trackedFileBackups: {}, timestamp: ts(n) }, isSnapshotUpdate: false });
  // 30: frame-link
  objects.push({ type: 'frame-link', sessionId: sid, path: '/tmp/fixture/scratchpad/brief.html', frameUrl: 'https://claude.ai/code/artifact/fixture-artifact-id', title: 'Fixture Artifact', artifactCount: 1, timestamp: ts(next()) });
  // 31: bridge-session
  objects.push({ type: 'bridge-session', sessionId: sid, bridgeSessionId: 'cse_fixture0000000000', lastSequenceNum: 0, ownerAccountUuid: '00000000-0000-0000-0000-000000000000', ownerOrganizationUuid: '00000000-0000-0000-0000-000000000000' });
  // 32: agent-name
  objects.push({ type: 'agent-name', agentName: 'fixture-agent-name', sessionId: sid });
  // 33: file-history-delta
  objects.push({
    type: 'file-history-delta', messageId: uuid(next()), snapshotMessageId: snapUuid, trackingPath: `${cwd}/exporter.ts`,
    backup: { backupFileName: 'fixturebackup@v1', version: 1, backupTime: ts(n), realParentDir: cwd }, timestamp: ts(n),
  });
  // 34: artifact-autoreact-ledger
  objects.push({ type: 'artifact-autoreact-ledger', v: 1, sessionId: sid, accountUuid: '00000000-0000-0000-0000-000000000000', artifacts: {} });
  // 35: custom-title (title source)
  objects.push({ type: 'custom-title', customTitle: 'fixture-custom-title', sessionId: sid });
  // 36: cost-state
  objects.push({ type: 'cost-state', sessionId: sid, totalCostUSD: 0.01, totalAPIDuration: 100, totalAPIDurationWithoutRetries: 100, totalToolDuration: 10, totalLinesAdded: 1, totalLinesRemoved: 0, totalDuration: 200, startTime: 0, modelUsage: {}, hasUnknownModelCost: false });
  // 37: relocated
  objects.push({ type: 'relocated', sessionId: sid, relocatedCwd: `${cwd}-worktree` });
  // 38: worktree-state
  objects.push({
    type: 'worktree-state',
    worktreeSession: { originalCwd: cwd, preEnterOriginalCwd: cwd, worktreePath: `${cwd}-worktree`, worktreeName: 'fixture-worktree', worktreeBranch: 'fixture-branch', sessionId: sid, enteredExisting: false },
    sessionId: sid,
  });
  // 39: artifact-comment-monitor
  objects.push({ type: 'artifact-comment-monitor', v: 1, sessionId: sid, artifacts: {} });
  // 40: fork-context-ref
  objects.push({ type: 'fork-context-ref', agentId: 'fixture-agent-fork01', parentSessionId: sid, parentLastUuid: uuid(1), contextLength: 10 });
  // 41: apiErrorStatus (assistant) — the ErrorCard node (spec §8.1), measured shape: assistant
  // row, status 429 (core/normalize.ts's `normalizeMessageRow`).
  objects.push({
    type: 'assistant', uuid: uuid(next()), parentUuid: uuid(n - 1), sessionId: sid, timestamp: ts(n),
    apiErrorStatus: 429,
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: 'Fixture API error: rate limited (429).' }] },
  });

  return objects.map((o) => JSON.stringify(o));
}

function buildSession1(spillAbsPath: string): { lines: string[]; malformedLine: string } {
  const lines = buildSession1Lines();
  const preview = '=== fixture spill preview ===\nfirst few lines of the fixture spill file...';
  const spillRow = {
    type: 'user', uuid: 'fixture-s1-r018', parentUuid: 'fixture-s1-r017', sessionId: SESSION_1_ID, timestamp: '2026-09-01T10:00:18.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result', tool_use_id: TOOL_USE_IDS.spill, is_error: false,
          content: `<persisted-output>\nOutput too large (2.4KB). Full output saved to: ${spillAbsPath}\n\nPreview (first 2KB):\n${preview}\n</persisted-output>`,
        },
      ],
    },
  };
  const idx = lines.findIndex((l) => l.includes('__spillMarkerPlaceholder'));
  lines[idx] = JSON.stringify(spillRow);

  const malformedLine = '{"type":"broken-fixture-row", this is not valid JSON at all}';
  return { lines: [...lines, malformedLine], malformedLine };
}

// ---------------------------------------------------------------------------------------------
// session-4.jsonl — the >2,000-node session (D20, D21, D22, D26).
// ---------------------------------------------------------------------------------------------

function assistantTextRow(id: string, sessionId: string, n: number, text: string): unknown {
  return {
    type: 'assistant', uuid: id, sessionId, timestamp: `2026-08-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text }] },
  };
}

function assistantTwoBlockRow(id: string, sessionId: string, n: number, text: string): unknown {
  return {
    type: 'assistant', uuid: id, sessionId, timestamp: `2026-08-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
    message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text }, { type: 'thinking', thinking: `fixture thinking for row ${n}`, signature: 'FIXSIG' }] },
  };
}

function buildSession4Lines(): string[] {
  const sid = SESSION_4_ID;
  const lines: string[] = [];
  let n = 0;

  // 197 double-block filler rows (2 candidates each) — kept at the FRONT, far from EOF, so they
  // do not interfere with the 500-node-from-EOF boundary below.
  for (let i = 0; i < 197; i++) {
    n++;
    lines.push(JSON.stringify(assistantTwoBlockRow(`fixture-s4-r${n}`, sid, n, `double-block filler row ${n}`)));
  }

  // 1,703 single-block filler rows (1 candidate each), bringing the cumulative candidate count,
  // counted from EOF, to 496 by the time the four-block row below is reached.
  for (let i = 0; i < 1703; i++) {
    n++;
    lines.push(JSON.stringify(assistantTextRow(`fixture-s4-r${n}`, sid, n, `single-block filler row ${n}`)));
  }

  // The four-block row: 499 (from-EOF cumulative before it) is < 500; including it reaches 503
  // (>= 500) — it genuinely straddles the 500-node window boundary (D20).
  n++;
  lines.push(
    JSON.stringify({
      type: 'assistant', uuid: `fixture-s4-r${n}`, sessionId: sid, timestamp: '2026-08-01T00:05:00.000Z',
      message: {
        role: 'assistant', model: 'claude-fixture',
        content: [
          { type: 'text', text: `${SESSION_4_MARKERS.fourBlock} block 1` },
          { type: 'thinking', thinking: `${SESSION_4_MARKERS.fourBlock} block 2`, signature: 'FIXSIG' },
          { type: 'text', text: `${SESSION_4_MARKERS.fourBlock} block 3` },
          { type: 'thinking', thinking: `${SESSION_4_MARKERS.fourBlock} block 4`, signature: 'FIXSIG' },
        ],
      },
    }),
  );

  // 496 more single-block filler rows, then the three byte-exact special rows, in the middle of
  // the file overall but at the tail of this construction (see notes on placement above).
  for (let i = 0; i < 496; i++) {
    n++;
    lines.push(JSON.stringify(assistantTextRow(`fixture-s4-r${n}`, sid, n, `single-block filler row ${n}`)));
  }

  // A 2 MiB single-line row — UNDER the cap, both readers must PARSE it.
  n++;
  lines.push(
    padLineToBytes(
      (pad) => ({
        type: 'assistant', uuid: `fixture-s4-r${n}`, sessionId: sid, timestamp: '2026-08-01T00:06:00.000Z',
        message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: `${SESSION_4_MARKERS.twoMib}:${pad}` }] },
      }),
      TWO_MIB,
    ),
  );

  // A row of EXACTLY ROW_CAP bytes — a VALID row (oversized is strictly greater).
  n++;
  lines.push(
    padLineToBytes(
      (pad) => ({
        type: 'assistant', uuid: `fixture-s4-r${n}`, sessionId: sid, timestamp: '2026-08-01T00:07:00.000Z',
        message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: `${SESSION_4_MARKERS.exactCap}:${pad}` }] },
      }),
      ROW_CAP,
    ),
  );

  // A 9 MiB single-line row — OVER the cap, must emit exactly one raw oversized node.
  n++;
  lines.push(
    padLineToBytes(
      (pad) => ({
        type: 'assistant', uuid: `fixture-s4-r${n}`, sessionId: sid, timestamp: '2026-08-01T00:08:00.000Z',
        message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: `${SESSION_4_MARKERS.oversized}:${pad}` }] },
      }),
      NINE_MIB,
    ),
  );

  return lines;
}

// ---------------------------------------------------------------------------------------------
// Subagent tree (session-1) + sibling-session sidecar (session-2) — §5.5.
// ---------------------------------------------------------------------------------------------

function subagentJsonl(id: string, sessionId: string): string {
  return jsonl([
    { type: 'user', uuid: `fixture-agent-${id}-1`, sessionId, isSidechain: true, agentId: id, timestamp: '2026-09-01T10:10:00.000Z', message: { role: 'user', content: `Fixture subagent ${id} task.` } },
    { type: 'assistant', uuid: `fixture-agent-${id}-2`, parentUuid: `fixture-agent-${id}-1`, sessionId, isSidechain: true, agentId: id, timestamp: '2026-09-01T10:10:01.000Z', message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: `Fixture subagent ${id} response.` }] } },
  ]);
}

interface SubagentMeta {
  agentType: string;
  description: string;
  spawnDepth: number;
  toolUseId: string | null;
  parentAgentId: string | null;
  model: string | null;
}

function subagentMeta(opts: SubagentMeta): string {
  return JSON.stringify(opts) + '\n';
}

// ---------------------------------------------------------------------------------------------
// Tree assembly (still pure — path/string math only, no I/O).
// ---------------------------------------------------------------------------------------------

function homeATree(): Tree {
  const files: FileSpec[] = [];
  const links: LinkSpec[] = [];
  const touches: TouchSpec[] = [];

  const projectsRoot = 'cfg/projects';
  const projADir = `${projectsRoot}/${PROJECT_A_DIR}`;
  const projBDir = `${projectsRoot}/${PROJECT_B_DIR}`;
  const projCDir = `${projectsRoot}/${PROJECT_C_DIR}`;

  const session1Dir = `${projADir}/${SESSION_1_ID}`;
  const subagentsDir = `${session1Dir}/subagents`;
  const toolResultsDir = `${session1Dir}/tool-results`;
  const spillPath = `${toolResultsDir}/${SPILL_FILE_NAME}`;

  // The escaping symlink's target lives OUTSIDE cfg/projects but still inside the fixture root,
  // so `rm -rf` on the mkdtemp root is sufficient cleanup — no path outside the fixture is ever
  // touched.
  const escapingTargetPath = 'escaping-target.txt';
  files.push({ path: escapingTargetPath, content: 'this file lives outside the projects root\n' });

  // -- session-1: the spill file itself, then the transcript that references it by absolute path.
  const spillContent = '=== fixture spill preview ===\nfirst few lines of the fixture spill file...\n(more content beyond the 2 KiB preview would live here in a real capture)\n';
  files.push({ path: spillPath, content: spillContent });

  const { lines: session1Lines } = buildSession1(`<PROJECT_DIR_ABS>/${SESSION_1_ID}/tool-results/${SPILL_FILE_NAME}`);
  files.push({ path: `${projADir}/${SESSION_1_ID}.jsonl`, content: session1Lines.join('\n') + '\n' });

  // -- session-1 subagents: 5 real sidecars forming the depth-2 tree + orphan + cycle.
  const sub = SUBAGENT_IDS;
  const subagentSpecs: Array<{ id: string; meta: SubagentMeta }> = [
    { id: sub.root, meta: { agentType: 'general-purpose', description: 'Fixture root subagent', spawnDepth: 1, toolUseId: 'toolu_fixture_task_root', parentAgentId: null, model: 'claude-fixture' } },
    { id: sub.child, meta: { agentType: 'general-purpose', description: 'Fixture child subagent', spawnDepth: 2, toolUseId: 'toolu_fixture_task_child', parentAgentId: sub.root, model: 'claude-fixture' } },
    { id: sub.orphan, meta: { agentType: 'general-purpose', description: 'Fixture missing-parent orphan', spawnDepth: 2, toolUseId: 'toolu_fixture_task_orphan', parentAgentId: 'does-not-exist-999', model: 'claude-fixture' } },
    { id: sub.cycleA, meta: { agentType: 'general-purpose', description: 'Fixture cycle member A', spawnDepth: 2, toolUseId: 'toolu_fixture_task_cyclea', parentAgentId: sub.cycleB, model: null } },
    { id: sub.cycleB, meta: { agentType: 'general-purpose', description: 'Fixture cycle member B', spawnDepth: 2, toolUseId: 'toolu_fixture_task_cycleb', parentAgentId: sub.cycleA, model: null } },
  ];
  for (const spec of subagentSpecs) {
    files.push({ path: `${subagentsDir}/agent-${spec.id}.jsonl`, content: subagentJsonl(spec.id, SESSION_1_ID) });
    files.push({ path: `${subagentsDir}/agent-${spec.id}.meta.json`, content: subagentMeta(spec.meta) });
  }

  // -- session-live, session-cut source material, session-4, session-4.rotated
  const sessionLiveLines = jsonl([
    { type: 'user', uuid: 'fixture-live-1', sessionId: SESSION_LIVE_ID, cwd: PROJECT_A_CWD, timestamp: '2026-09-05T09:00:00.000Z', message: { role: 'user', content: 'Watch this session grow.' } },
    { type: 'assistant', uuid: 'fixture-live-2', parentUuid: 'fixture-live-1', sessionId: SESSION_LIVE_ID, timestamp: '2026-09-05T09:00:01.000Z', message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: 'Watching.' }] } },
  ]);
  files.push({ path: `${projADir}/${SESSION_LIVE_ID}.jsonl`, content: sessionLiveLines });

  // session-2 (proj-B) — also the source material session-cut is copied from.
  const session2Rows = [
    { type: 'user', uuid: 'fixture-s2-1', sessionId: SESSION_2_ID, cwd: PROJECT_B_CWD, timestamp: '2026-09-03T08:00:00.000Z', message: { role: 'user', content: 'Second project fixture session.' } },
    { type: 'assistant', uuid: 'fixture-s2-2', parentUuid: 'fixture-s2-1', sessionId: SESSION_2_ID, timestamp: '2026-09-03T08:00:01.000Z', message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: 'Acknowledged the second project fixture session and its long enough closing line to survive a 40-byte trim.' }] } },
  ];
  const session2Content = jsonl(session2Rows);
  files.push({ path: `${projBDir}/${SESSION_2_ID}.jsonl`, content: session2Content });

  // session-2's own subagents dir holds the REAL sidecar the sibling-session symlink points to.
  const session2SubagentsDir = `${projBDir}/${SESSION_2_ID}/subagents`;
  files.push({ path: `${session2SubagentsDir}/agent-${sub.sibling}.jsonl`, content: subagentJsonl(sub.sibling, SESSION_2_ID) });
  files.push({
    path: `${session2SubagentsDir}/agent-${sub.sibling}.meta.json`,
    content: subagentMeta({ agentType: 'general-purpose', description: 'Fixture sibling-session subagent', spawnDepth: 1, toolUseId: null, parentAgentId: null, model: null }),
  });

  // <session-cut>.jsonl — a copy of session-2's bytes, trailing newline removed, last 40 bytes
  // dropped: a genuine partial last row, not a whole row missing only its terminator (D30).
  const withoutTrailingNewline = session2Content.slice(0, -1);
  const cutContent = withoutTrailingNewline.slice(0, withoutTrailingNewline.length - 40);
  files.push({ path: `${projADir}/${SESSION_CUT_ID}.jsonl`, content: cutContent });

  // session-4 + its same-size rotated replacement.
  const session4Lines = buildSession4Lines();
  const session4Content = session4Lines.join('\n') + '\n';
  files.push({ path: `${projADir}/${SESSION_4_ID}.jsonl`, content: session4Content });
  const rotatedContent = session4Lines.slice().reverse().join('\n') + '\n';
  files.push({ path: `${projADir}/${SESSION_4_ID}.rotated`, content: rotatedContent });

  // proj-C: a third project whose only session is 90 days old (D10).
  const session3Rows = [
    { type: 'user', uuid: 'fixture-s3-1', sessionId: SESSION_3_ID, cwd: PROJECT_C_CWD, timestamp: '2026-06-01T08:00:00.000Z', message: { role: 'user', content: 'Third, older project fixture session.' } },
    { type: 'assistant', uuid: 'fixture-s3-2', parentUuid: 'fixture-s3-1', sessionId: SESSION_3_ID, timestamp: '2026-06-01T08:00:01.000Z', message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'text', text: 'Acknowledged.' }] } },
  ];
  const session3Path = `${projCDir}/${SESSION_3_ID}.jsonl`;
  files.push({ path: session3Path, content: jsonl(session3Rows) });
  touches.push({ path: session3Path, mtimeMs: Date.now() - 90 * 24 * 60 * 60 * 1000 });

  // -- the three symlinks (D14).
  links.push({ path: `${toolResultsDir}/escaping.txt`, target: relative(toolResultsDir, escapingTargetPath) });
  links.push({ path: `${toolResultsDir}/in-session.txt`, target: relative(toolResultsDir, spillPath) });
  links.push({ path: `${subagentsDir}/agent-${sub.sibling}.jsonl`, target: relative(subagentsDir, `${session2SubagentsDir}/agent-${sub.sibling}.jsonl`) });

  return { files, links, touches, dirs: [] };
}

/** Replaces the `<PROJECT_DIR_ABS>` placeholder in session-1's spill marker with the real
 * absolute path, once `materialize()` knows the destination root. Pure string substitution. */
function resolveSpillPlaceholder(tree: Tree, dest: string): Tree {
  const abs = join(dest, 'cfg', 'projects', PROJECT_A_DIR);
  return {
    ...tree,
    files: tree.files.map((f) =>
      f.path.endsWith(`${SESSION_1_ID}.jsonl`) ? { ...f, content: f.content.split('<PROJECT_DIR_ABS>').join(abs) } : f,
    ),
  };
}

function tribeExtraTree(): Tree {
  const stateFor = (repoKey: string) => ({
    v: 1,
    campaign: CAMPAIGN_SLUG,
    sequence: ['C1'],
    cards: {
      C1: {
        status: 'shipped',
        spec: 'docs/specs/fixture-spec.md',
        plan: 'docs/plans/fixture-plan.md',
        sessionId: SESSION_1_ID,
        updatedAt: '2026-09-01T12:00:00.000Z',
      },
    },
    repoKeyForFixture: repoKey,
  });
  return {
    files: [
      { path: `.tribe/${REPO_KEY_A}/campaigns/${CAMPAIGN_SLUG}/campaign-state.json`, content: JSON.stringify(stateFor(REPO_KEY_A), null, 2) + '\n' },
      { path: `.tribe/${REPO_KEY_B}/campaigns/${CAMPAIGN_SLUG}/campaign-state.json`, content: JSON.stringify(stateFor(REPO_KEY_B), null, 2) + '\n' },
    ],
    links: [],
    touches: [],
    dirs: [],
  };
}

// ---------------------------------------------------------------------------------------------
// The one thin edge. Every fs call in this module lives here.
// ---------------------------------------------------------------------------------------------

function materialize(dest: string, tree: Tree): void {
  for (const d of tree.dirs) {
    mkdirSync(join(dest, d), { recursive: true });
  }
  for (const f of tree.files) {
    const full = join(dest, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
  }
  for (const l of tree.links) {
    const full = join(dest, l.path);
    mkdirSync(dirname(full), { recursive: true });
    symlinkSync(l.target, full);
  }
  for (const t of tree.touches) {
    const full = join(dest, t.path);
    const when = new Date(t.mtimeMs);
    utimesSync(full, when, when);
  }
}

// ---------------------------------------------------------------------------------------------
// Public builders — each takes its destination directory as an argument and constructs nothing
// it was not given (`pure-core.md`). Every root comes from the caller's own `mkdtemp`.
// ---------------------------------------------------------------------------------------------

export function buildHomeA(dest: string): void {
  const tree = resolveSpillPlaceholder(homeATree(), dest);
  materialize(dest, tree);
}

export function buildHomeB(dest: string): void {
  const tree = mergeTrees(resolveSpillPlaceholder(homeATree(), dest), tribeExtraTree());
  materialize(dest, tree);
}

export function buildEmptyProject(dest: string): void {
  materialize(dest, { files: [], links: [], touches: [], dirs: ['cfg/projects/-Users-fixture-empty-project'] });
}

export function buildEmptyProjectsRoot(dest: string): void {
  materialize(dest, { files: [], links: [], touches: [], dirs: ['cfg/projects'] });
}

export function buildHomeWithoutClaude(_dest: string): void {
  // Intentionally a no-op: the shape this builds IS the absence of `.claude`/`cfg`. `mkdtemp`
  // already gave the caller an existing, empty directory, and nothing is added to it.
}
