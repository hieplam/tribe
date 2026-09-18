import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEmptyProject,
  buildEmptyProjectsRoot,
  buildHomeA,
  buildHomeB,
  buildHomeWithoutClaude,
  CAMPAIGN_SLUG,
  INVENTED_ROW_TYPE,
  PROJECT_A_DIR,
  PROJECT_B_DIR,
  PROJECT_C_DIR,
  REPO_KEY_A,
  REPO_KEY_B,
  ROW_CAP,
  SESSION_1_ID,
  SESSION_2_ID,
  SESSION_3_ID,
  SESSION_4_ID,
  SESSION_4_MARKERS,
  SESSION_CUT_ID,
  SESSION_LIVE_ID,
  SPILL_FILE_NAME,
  SUBAGENT_IDS,
  TOOL_USE_IDS,
} from './build.ts';

/** The 23 top-level `type` values §7.1 tables, transcribed verbatim from the spec (the oracle for
 * this test), NOT reused from build.ts's own constants — a shared typo between builder and test
 * must not be able to hide behind a shared source of truth. */
const SPEC_7_1_KNOWN_ROW_TYPES = [
  'assistant',
  'user',
  'attachment',
  'last-prompt',
  'ai-title',
  'queue-operation',
  'mode',
  'atis-latch',
  'permission-mode',
  'system',
  'pr-link',
  'file-history-snapshot',
  'frame-link',
  'bridge-session',
  'agent-name',
  'file-history-delta',
  'artifact-autoreact-ledger',
  'custom-title',
  'cost-state',
  'relocated',
  'worktree-state',
  'artifact-comment-monitor',
  'fork-context-ref',
];

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'vc-fixture-build-test-'));
}

function readLines(path: string): string[] {
  const raw = readFileSync(path, 'utf8');
  return raw.length === 0 ? [] : raw.split('\n').filter((l) => l.length > 0);
}

/** Parses every line, tolerating the one malformed line the fixture deliberately carries. */
function parseRowsTolerant(lines: string[]): { row: any; line: string }[] {
  const out: { row: any; line: string }[] = [];
  for (const line of lines) {
    try {
      out.push({ row: JSON.parse(line), line });
    } catch {
      // the deliberate malformed line — not a parseable row
    }
  }
  return out;
}

function allFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      out.push(full);
    }
  };
  walk(root);
  return out;
}

function allSymlinks(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) { out.push(full); continue; }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out;
}

/** Independent re-derivation of D21's pre-pairing candidate count — the builder counts these as
 * it writes the bytes; this walks the bytes it actually wrote, with no production module
 * involved (D22). A `tool_result` block counts as one candidate node, same as any other block;
 * an empty `thinking` block counts as zero (§7.2's named exception); a row whose raw byte length
 * exceeds ROW_CAP counts as exactly one node regardless of its content (D26). */
function candidatesForLine(line: string): number {
  if (Buffer.byteLength(line, 'utf8') > ROW_CAP) return 1;
  let row: any;
  try {
    row = JSON.parse(line);
  } catch {
    return 1;
  }
  if (row.type !== 'user' && row.type !== 'assistant') return 1;
  const content = row.message?.content;
  if (typeof content === 'string') return 1;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content) {
    if (block && block.type === 'thinking' && block.thinking === '') continue;
    n += 1;
  }
  return n;
}

describe('fixtures/build.ts — homeA', () => {
  test('cfg/projects holds exactly six <session>.jsonl files, three projects', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const projectsRoot = join(dest, 'cfg', 'projects');
      const projectDirs = readdirSync(projectsRoot).sort();
      expect(projectDirs).toEqual([PROJECT_A_DIR, PROJECT_B_DIR, PROJECT_C_DIR].sort());

      const sessionJsonlFiles = allFiles(projectsRoot).filter((f) => {
        const base = f.slice(f.lastIndexOf('/') + 1);
        return base.endsWith('.jsonl') && !f.includes(`${SESSION_1_ID}/subagents`) && !f.includes(`${SESSION_2_ID}/subagents`);
      });
      const expectedIds = [SESSION_1_ID, SESSION_LIVE_ID, SESSION_CUT_ID, SESSION_4_ID, SESSION_2_ID, SESSION_3_ID].sort();
      const actualIds = sessionJsonlFiles.map((f) => f.slice(f.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')).sort();
      expect(actualIds).toEqual(expectedIds);

      // `<session-4>.rotated` is a fixture input, not a served session: no `.jsonl` extension.
      expect(existsSync(join(projectsRoot, PROJECT_A_DIR, `${SESSION_4_ID}.rotated`))).toBe(true);
      expect(existsSync(join(projectsRoot, PROJECT_A_DIR, `${SESSION_4_ID}.rotated.jsonl`))).toBe(false);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('proj-C session is 90 days old, proj-A and proj-B sessions are recent (D10)', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const session3 = join(dest, 'cfg', 'projects', PROJECT_C_DIR, `${SESSION_3_ID}.jsonl`);
      const session1 = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_1_ID}.jsonl`);
      const ageMs = Date.now() - statSync(session3).mtimeMs;
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(ageMs).toBeGreaterThan(thirtyDaysMs);
      expect(ageMs).toBeGreaterThan(ninetyDaysMs - 5 * 60 * 1000); // within 5 min of "90 days old"
      expect(Date.now() - statSync(session1).mtimeMs).toBeLessThan(thirtyDaysMs);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('session-1 carries one row of every §7.1 type, plus the invented type, plus one malformed line', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_1_ID}.jsonl`);
      const lines = readLines(path);
      const parsed = parseRowsTolerant(lines);

      // at least one line failed to parse (the deliberate malformed line)
      expect(parsed.length).toBeLessThan(lines.length);

      const typesPresent = new Set(parsed.map((p) => p.row.type));
      for (const t of SPEC_7_1_KNOWN_ROW_TYPES) {
        expect({ type: t, present: typesPresent.has(t) }).toEqual({ type: t, present: true });
      }
      expect(typesPresent.has(INVENTED_ROW_TYPE)).toBe(true);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('session-1 carries every §7.2 content-block shape task 30 needs', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_1_ID}.jsonl`);
      const rows = parseRowsTolerant(readLines(path)).map((p) => p.row);

      // string prompt (user)
      expect(rows.some((r) => r.type === 'user' && typeof r.message?.content === 'string' && !r.isCompactSummary)).toBe(true);

      // array-form prompt with a text block (user) — the B2 case
      expect(
        rows.some(
          (r) =>
            r.type === 'user' &&
            Array.isArray(r.message?.content) &&
            r.message.content.some((b: any) => b.type === 'text'),
        ),
      ).toBe(true);

      // assistant bare-string content (0 measured, "handled anyway")
      expect(rows.some((r) => r.type === 'assistant' && typeof r.message?.content === 'string')).toBe(true);

      // tool_use pending (no matching tool_result anywhere in the file)
      const toolUseIds = new Set<string>();
      const toolResultIds = new Set<string>();
      for (const r of rows) {
        if (!Array.isArray(r.message?.content)) continue;
        for (const b of r.message.content) {
          if (b.type === 'tool_use') toolUseIds.add(b.id);
          if (b.type === 'tool_result') toolResultIds.add(b.tool_use_id);
        }
      }
      expect(toolUseIds.has(TOOL_USE_IDS.pending)).toBe(true);
      expect(toolResultIds.has(TOOL_USE_IDS.pending)).toBe(false);

      // tool_use paired ok / paired error
      expect(toolUseIds.has(TOOL_USE_IDS.ok)).toBe(true);
      expect(toolResultIds.has(TOOL_USE_IDS.ok)).toBe(true);
      expect(toolUseIds.has(TOOL_USE_IDS.err)).toBe(true);
      expect(toolResultIds.has(TOOL_USE_IDS.err)).toBe(true);
      const errResult = rows
        .flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : []))
        .find((b: any) => b.type === 'tool_result' && b.tool_use_id === TOOL_USE_IDS.err);
      expect(errResult.is_error).toBe(true);

      // a tool_result whose call is before the window: no matching tool_use anywhere in the file
      expect(toolResultIds.has(TOOL_USE_IDS.beforeWindow)).toBe(true);
      expect(toolUseIds.has(TOOL_USE_IDS.beforeWindow)).toBe(false);

      // the MIXED row: one user row with BOTH a tool_result and a text block, call earlier in file
      const mixedRowIndex = rows.findIndex(
        (r) =>
          r.type === 'user' &&
          Array.isArray(r.message?.content) &&
          r.message.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === TOOL_USE_IDS.mixed) &&
          r.message.content.some((b: any) => b.type === 'text'),
      );
      expect(mixedRowIndex).toBeGreaterThanOrEqual(0);
      const callRowIndex = rows.findIndex(
        (r) =>
          r.type === 'assistant' &&
          Array.isArray(r.message?.content) &&
          r.message.content.some((b: any) => b.type === 'tool_use' && b.id === TOOL_USE_IDS.mixed),
      );
      expect(callRowIndex).toBeGreaterThanOrEqual(0);
      expect(callRowIndex).toBeLessThan(mixedRowIndex); // earlier in the same window

      // empty thinking (silent) AND non-empty thinking (rendered)
      const thinkingBlocks = rows
        .flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : []))
        .filter((b: any) => b.type === 'thinking');
      expect(thinkingBlocks.some((b: any) => b.thinking === '')).toBe(true);
      expect(thinkingBlocks.some((b: any) => typeof b.thinking === 'string' && b.thinking.length > 0)).toBe(true);
      // an assistant row whose ONLY block is an empty thinking (bucket E)
      expect(
        rows.some(
          (r) =>
            r.type === 'assistant' &&
            Array.isArray(r.message?.content) &&
            r.message.content.length === 1 &&
            r.message.content[0].type === 'thinking' &&
            r.message.content[0].thinking === '',
        ),
      ).toBe(true);

      // base64 image block
      const imageBlock = rows
        .flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : []))
        .find((b: any) => b.type === 'image');
      expect(imageBlock?.source?.type).toBe('base64');
      expect(typeof imageBlock?.source?.data).toBe('string');
      expect(imageBlock.source.data.length).toBeGreaterThan(0);

      // isCompactSummary row
      expect(rows.some((r) => r.type === 'user' && r.isCompactSummary === true)).toBe(true);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('the <persisted-output> marker and its spill file are both present and consistent', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_1_ID}.jsonl`);
      const rows = parseRowsTolerant(readLines(path)).map((p) => p.row);
      const spillResult = rows
        .flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : []))
        .find((b: any) => b.type === 'tool_result' && typeof b.content === 'string' && b.content.includes('<persisted-output>'));
      expect(spillResult).toBeTruthy();
      expect(spillResult.content).toContain('</persisted-output>');

      const spillPath = join(dest, 'cfg', 'projects', PROJECT_A_DIR, SESSION_1_ID, 'tool-results', SPILL_FILE_NAME);
      expect(existsSync(spillPath)).toBe(true);
      const spillBytes = readFileSync(spillPath, 'utf8');
      expect(spillBytes.length).toBeGreaterThan(0);
      // the marker names this file's absolute path
      expect(spillResult.content).toContain(spillPath);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('the depth-2 subagent tree: root, child, missing-parent orphan, and a two-node cycle (5 sidecars)', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const subagentsDir = join(dest, 'cfg', 'projects', PROJECT_A_DIR, SESSION_1_ID, 'subagents');
      const entries = readdirSync(subagentsDir, { withFileTypes: true });
      const realJsonl = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
      const realMeta = entries.filter((e) => e.isFile() && e.name.endsWith('.meta.json'));
      expect(realJsonl.length).toBe(5);
      expect(realMeta.length).toBe(5);

      const metaFor = (id: string) => JSON.parse(readFileSync(join(subagentsDir, `agent-${id}.meta.json`), 'utf8'));
      const root = metaFor(SUBAGENT_IDS.root);
      const child = metaFor(SUBAGENT_IDS.child);
      const orphan = metaFor(SUBAGENT_IDS.orphan);
      const cycleA = metaFor(SUBAGENT_IDS.cycleA);
      const cycleB = metaFor(SUBAGENT_IDS.cycleB);

      expect(root.spawnDepth).toBe(1);
      expect(root.parentAgentId ?? null).toBeNull();
      expect(child.spawnDepth).toBe(2);
      expect(child.parentAgentId).toBe(SUBAGENT_IDS.root);
      expect(orphan.parentAgentId).toBe('does-not-exist-999'); // names no entry in this batch
      expect(cycleA.parentAgentId).toBe(SUBAGENT_IDS.cycleB);
      expect(cycleB.parentAgentId).toBe(SUBAGENT_IDS.cycleA); // mutual cycle
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('exactly three symlinks: escaping (outside root), in-session, and the sibling-session sidecar', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const projectsRoot = join(dest, 'cfg', 'projects');
      const links = allSymlinks(dest);
      expect(links.length).toBe(3);

      const escapingPath = join(projectsRoot, PROJECT_A_DIR, SESSION_1_ID, 'tool-results', 'escaping.txt');
      const inSessionPath = join(projectsRoot, PROJECT_A_DIR, SESSION_1_ID, 'tool-results', 'in-session.txt');
      const siblingPath = join(projectsRoot, PROJECT_A_DIR, SESSION_1_ID, 'subagents', `agent-${SUBAGENT_IDS.sibling}.jsonl`);

      for (const p of [escapingPath, inSessionPath, siblingPath]) {
        expect(lstatSync(p).isSymbolicLink()).toBe(true);
      }

      const escapingRoot = realpathSync(projectsRoot);
      const escapingTarget = realpathSync(escapingPath);
      expect(escapingTarget.startsWith(escapingRoot + '/')).toBe(false);

      const inSessionTarget = realpathSync(inSessionPath);
      expect(inSessionTarget).toBe(realpathSync(join(projectsRoot, PROJECT_A_DIR, SESSION_1_ID, 'tool-results', SPILL_FILE_NAME)));

      const siblingTarget = realpathSync(siblingPath);
      const expectedSiblingReal = realpathSync(
        join(projectsRoot, PROJECT_B_DIR, SESSION_2_ID, 'subagents', `agent-${SUBAGENT_IDS.sibling}.jsonl`),
      );
      expect(siblingTarget).toBe(expectedSiblingReal);
      expect(siblingTarget.startsWith(escapingRoot + '/')).toBe(true); // inside the projects root (D14)
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('<session-cut>.jsonl ends mid-row: no trailing newline, genuine partial last row (D30)', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_CUT_ID}.jsonl`);
      const raw = readFileSync(path, 'utf8');
      expect(raw.endsWith('\n')).toBe(false);
      const lastLine = raw.slice(raw.lastIndexOf('\n') + 1);
      expect(lastLine.length).toBeGreaterThan(0);
      expect(() => JSON.parse(lastLine)).toThrow(); // a genuine partial row, not a whole row missing only \n
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('<session-4>: exactly 2,400 rows and 2,600 pre-pairing candidate blocks (D22)', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.jsonl`);
      const raw = readFileSync(path, 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
      const lines = raw.slice(0, -1).split('\n');
      expect(lines.length).toBe(2400);

      const total = lines.reduce((sum, line) => sum + candidatesForLine(line), 0);
      expect(total).toBe(2600);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('<session-4> carries the four-block boundary row, the 2 MiB row, the exact-cap row, and the 9 MiB oversized row', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const path = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.jsonl`);
      const raw = readFileSync(path, 'utf8');
      const lines = raw.slice(0, -1).split('\n');

      const fourBlockLine = lines.find((l) => l.includes(SESSION_4_MARKERS.fourBlock));
      expect(fourBlockLine).toBeTruthy();
      expect(candidatesForLine(fourBlockLine as string)).toBe(4);

      const twoMibLine = lines.find((l) => l.includes(SESSION_4_MARKERS.twoMib));
      expect(twoMibLine).toBeTruthy();
      const twoMibBytes = Buffer.byteLength(twoMibLine as string, 'utf8');
      expect(twoMibBytes).toBeGreaterThanOrEqual(2 * 1024 * 1024);
      expect(twoMibBytes).toBeLessThan(ROW_CAP);

      const exactCapLine = lines.find((l) => l.includes(SESSION_4_MARKERS.exactCap));
      expect(exactCapLine).toBeTruthy();
      expect(Buffer.byteLength(exactCapLine as string, 'utf8')).toBe(ROW_CAP); // valid: length <= cap, not >

      const oversizedLine = lines.find((l) => l.includes(SESSION_4_MARKERS.oversized));
      expect(oversizedLine).toBeTruthy();
      expect(Buffer.byteLength(oversizedLine as string, 'utf8')).toBeGreaterThan(ROW_CAP);
      expect(candidatesForLine(oversizedLine as string)).toBe(1); // one raw oversized node, nothing retained
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('<session-4>.rotated is the same size as <session-4>.jsonl but different content', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      const original = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.jsonl`);
      const rotated = join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_4_ID}.rotated`);
      const originalBytes = readFileSync(original);
      const rotatedBytes = readFileSync(rotated);
      expect(rotatedBytes.length).toBe(originalBytes.length);
      expect(Buffer.compare(originalBytes, rotatedBytes)).not.toBe(0);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe('fixtures/build.ts — homeB', () => {
  test('adds exactly the two same-slug campaign-state.json files under .tribe and nothing else', () => {
    const dest = tmp();
    try {
      buildHomeB(dest);
      const tribeRoot = join(dest, '.tribe');
      const files = allFiles(tribeRoot).sort();
      const expected = [
        join(tribeRoot, REPO_KEY_A, 'campaigns', CAMPAIGN_SLUG, 'campaign-state.json'),
        join(tribeRoot, REPO_KEY_B, 'campaigns', CAMPAIGN_SLUG, 'campaign-state.json'),
      ].sort();
      expect(files).toEqual(expected);

      const stateA = JSON.parse(readFileSync(expected[0] === files[0] ? files[0] : files[0], 'utf8'));
      const a = JSON.parse(readFileSync(join(tribeRoot, REPO_KEY_A, 'campaigns', CAMPAIGN_SLUG, 'campaign-state.json'), 'utf8'));
      const b = JSON.parse(readFileSync(join(tribeRoot, REPO_KEY_B, 'campaigns', CAMPAIGN_SLUG, 'campaign-state.json'), 'utf8'));
      expect(a.campaign).toBe(CAMPAIGN_SLUG);
      expect(b.campaign).toBe(CAMPAIGN_SLUG);
      expect(a.cards.C1.sessionId).toBe(SESSION_1_ID);
      expect(b.cards.C1.sessionId).toBe(SESSION_1_ID); // same session id, two repo keys — the collision
      expect(stateA).toBeTruthy();
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('homeB also carries every homeA shape (it is homeA plus .tribe)', () => {
    const dest = tmp();
    try {
      buildHomeB(dest);
      expect(existsSync(join(dest, 'cfg', 'projects', PROJECT_A_DIR, `${SESSION_1_ID}.jsonl`))).toBe(true);
      expect(existsSync(join(dest, 'cfg', 'projects', PROJECT_B_DIR, `${SESSION_2_ID}.jsonl`))).toBe(true);
      expect(existsSync(join(dest, 'cfg', 'projects', PROJECT_C_DIR, `${SESSION_3_ID}.jsonl`))).toBe(true);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe('fixtures/build.ts — homeA has no .tribe at all (G1 precondition)', () => {
  test('buildHomeA never creates a .tribe directory', () => {
    const dest = tmp();
    try {
      buildHomeA(dest);
      expect(existsSync(join(dest, '.tribe'))).toBe(false);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe('fixtures/build.ts — the three standalone empties', () => {
  test('buildEmptyProject: one project directory with zero sessions, nothing else', () => {
    const dest = tmp();
    try {
      buildEmptyProject(dest);
      const projectsRoot = join(dest, 'cfg', 'projects');
      const projectDirs = readdirSync(projectsRoot);
      expect(projectDirs.length).toBe(1);
      const projectDir = join(projectsRoot, projectDirs[0]);
      expect(readdirSync(projectDir).length).toBe(0);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('buildEmptyProjectsRoot: the projects root exists and is itself empty', () => {
    const dest = tmp();
    try {
      buildEmptyProjectsRoot(dest);
      const projectsRoot = join(dest, 'cfg', 'projects');
      expect(existsSync(projectsRoot)).toBe(true);
      expect(readdirSync(projectsRoot).length).toBe(0);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  test('buildHomeWithoutClaude: no .claude / cfg directory at all', () => {
    const dest = tmp();
    try {
      buildHomeWithoutClaude(dest);
      expect(existsSync(join(dest, 'cfg'))).toBe(false);
      expect(existsSync(join(dest, '.claude'))).toBe(false);
      expect(readdirSync(dest).length).toBe(0);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});
