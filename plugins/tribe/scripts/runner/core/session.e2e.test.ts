// core/session.e2e.test.ts — real-session E2E proving `Skill c3` resolves under the user
// settings tier (Task 6, card runner-session-user-settings). This is the card's G1 oracle and
// the owner's explicit requirement: "Remember create e2e test that cover this case."
//
// Non-negotiable properties (plan Task 6):
//   1. Calls `runSession` wired to the REAL `sdkSpawnSession` (adapters/session.adapter.ts) —
//      never `query()` directly, never a hand-built options object, never a stub. The point is
//      to exercise the runner's OWN spawn path, the same one `run-io.adapter.ts` wires in
//      production.
//   2. Real model: haiku.
//   3. Assertions read the captured transcript, collected through the same `io.appendLog` seam
//      production uses — never `result.outcome` (see the note above the assertions below).
//   4. Opt-in via RUN_SESSION_E2E=1 (costs tokens, needs Claude Code login auth) — `bun test`
//      stays hermetic and offline by default.
//
// A test that only inspected the built options object would pass on a stub and prove nothing
// (the owner named this failure mode explicitly) — every assertion below reads the transcript
// a REAL spawned session produced.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { sdkSpawnSession } from '../adapters/session.adapter.ts';
import { isFilesystemWideScan } from './metrics/session-hygiene.ts';
import { TRIBE_PLUGIN_DIR, runSession, type SessionIO, type SessionMessage } from './session.ts';

const RUN_E2E = process.env.RUN_SESSION_E2E === '1';

// TRIBE_PLUGIN_DIR resolves to `<repoRoot>/plugins/tribe` (session.ts) — two levels up is the
// repo root this session's `cwd` should be, derived the same stateless-capability way
// TRIBE_PLUGIN_DIR itself is (never a hardcoded absolute path).
const REPO_ROOT = join(TRIBE_PLUGIN_DIR, '..', '..');

const BRIEF =
  'Invoke the Skill tool with the skill named "c3". Then reply with exactly one line: ' +
  'SKILL_RESULT=<ok|unknown> followed by the first 200 characters the Skill tool returned. ' +
  'Do not use Bash. Do not search the filesystem.';

interface ContentBlock {
  type?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  text?: unknown;
}

/** Every content block (of any block type) across every assistant/user message in the
 * transcript, in stream order. A line that is not valid JSON, or carries no `message.content`
 * array, contributes nothing (mirrors `session-hygiene.ts`'s own narrow-catch shape). */
function allContentBlocks(transcriptLines: string[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const line of transcriptLines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const content = (parsed as { message?: { content?: unknown } })?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) blocks.push(block as ContentBlock);
  }
  return blocks;
}

describe('runSession — real spawned session, Skill c3 resolves under the user tier (G1)', () => {
  test.skipIf(!RUN_E2E)(
    'Skill c3 resolves, its content reaches the transcript, no Unknown skill, no filesystem-wide scan',
    async () => {
      const transcriptLines: string[] = [];
      // The REAL spawn path: io.spawnSession delegates straight to sdkSpawnSession, the same
      // wiring run-io.adapter.ts uses in production (not a stub, not a hand-built options
      // object) — appendLog accumulates in memory instead of touching disk, the seam
      // production itself reads the transcript through.
      const io: SessionIO = {
        spawnSession: (params) => sdkSpawnSession(params),
        onSessionStart: () => {},
        appendLog: (_logPath, line) => {
          transcriptLines.push(line);
        },
      };

      const result = await runSession(
        { brief: BRIEF },
        { repoRoot: REPO_ROOT, model: 'haiku', logsDir: '/tmp', card: 'e2e-session-user-settings' },
        io,
      );

      // Known and expected (plan Task 6): runSession only recognizes a SHIPPED/NEEDS_DIRECTION
      // terminal line; our brief's SKILL_RESULT=... reply is neither, so outcome is always
      // 'error' here BY DESIGN — asserting on it would prove nothing about the tier list.
      // Every assertion below reads the TRANSCRIPT, never `result.outcome`.
      void result;

      const transcript = transcriptLines.join('\n');
      const blocks = allContentBlocks(transcriptLines);

      // 1. The Skill tool was invoked with skill "c3". The SDK namespaces a plugin-provided
      // skill id as "<plugin>:<skill>" (observed live: "c3-skill:c3") — match the skill NAME,
      // not a bare-string equality that a namespace prefix would break.
      const skillInvocations = blocks.filter(
        (b) => b.type === 'tool_use' && b.name === 'Skill',
      );
      expect(skillInvocations.length).toBeGreaterThan(0);
      const invokedC3 = skillInvocations.some((b) => {
        const skill = (b.input as { skill?: unknown } | undefined)?.skill;
        return typeof skill === 'string' && /(^|:)c3$/.test(skill);
      });
      expect(invokedC3).toBe(true);

      // 2. No "Unknown skill" anywhere in the transcript — this is exactly the failure string
      // Task 4 fixed (`settingSources: ['project']` -> "Unknown skill: c3. Did you mean cd?").
      // Asserted BEFORE the content checks below so a regression to the ['project'] tier fails
      // right here, on this exact string, rather than on a downstream symptom.
      expect(transcript).not.toContain('Unknown skill');

      // ...and the invocation returned actual C3 content, not merely "launched" — the loaded
      // skill body (progressive disclosure) carries its own skill-directory path and its own
      // title, both observed live in a real transcript. This is what distinguishes a resolved
      // skill from a stub that only records "the Skill tool was called".
      expect(transcript).toContain('skills/c3');
      expect(transcript).toContain('C3');

      // 3. No filesystem-wide scan ran — every Bash tool_use command in the transcript, checked
      // with the SAME predicate the ratchet counter (Task 1) and the scan-guard hook (Task 3)
      // use. Reused, never re-implemented.
      const bashCommands = blocks
        .filter((b) => b.type === 'tool_use' && b.name === 'Bash')
        .map((b) => (b.input as { command?: unknown } | undefined)?.command)
        .filter((c): c is string => typeof c === 'string');
      for (const command of bashCommands) {
        expect(isFilesystemWideScan(command)).toBe(false);
      }
    },
    120_000,
  );
});
