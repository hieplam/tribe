// core/supervisor/session.e2e.test.ts — real-session E2E for card supervisor-session-settings
// (issue #163). Every session is spawned through the supervisor's OWN path: runOneShotSession ->
// buildOneShotOptions -> the real SDK adapter, wired exactly as cli/main.ts wires it. Opt-in via
// RUN_SESSION_E2E=1 (costs tokens, needs Claude Code login auth).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sdkSpawnSession } from '../../adapters/session.adapter.ts';
import { isFilesystemWideScan } from '../metrics/session-hygiene.ts';
import { TRIBE_PLUGIN_DIR, type SpawnSessionParams } from '../session.ts';
import type { SessionKind } from './model.ts';
import { runOneShotSession, type OneShotSessionResult, type OneShotSessionSeam } from './session.ts';

const RUN_E2E = process.env.RUN_SESSION_E2E === '1';
/** Optional: where Task 8's ratchet reads the transcripts. Unset = keep them in memory only. */
const LOG_DIR = process.env.SUPERVISOR_E2E_LOG_DIR;
const MODEL = 'claude-haiku-4-5-20251001';
const REPO_ROOT = join(TRIBE_PLUGIN_DIR, '..', '..');
const VERIFY_SHIPPED_DIR = join(TRIBE_PLUGIN_DIR, '..', 'verify-shipped');
const SESSION_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 240_000;

const C3_PROMPT =
  'Invoke the Skill tool with the skill named "c3" exactly once. Do not use any other tool. ' +
  'Reply with one line: SKILL_RESULT=<ok|denied|unknown> followed by the first 200 characters the Skill tool returned.';
const VERIFY_SHIPPED_PROMPT =
  'Invoke the Skill tool with the skill named "verify-shipped" exactly once. Do NOT follow its instructions ' +
  'and do not run any other tool. Reply with one line: SKILL_RESULT=<ok|unknown> followed by the first 200 characters the Skill tool returned.';
const SCAN_PROMPT =
  'Run exactly this one Bash command, once, and nothing else: find / -maxdepth 1 -name TRIBE_E2E_NOPE ' +
  'Do not retry it and do not run any variant of it. Reply with one line: SCAN=<ran|refused> followed by the first 200 characters of the tool result.';
const GRANT_PROMPT =
  'Call the Workflow tool exactly once with script "export const meta = { name: \'probe\', description: \'probe\' }; return { ok: true };" ' +
  '(use ToolSearch to load its schema first if you need it). Do not retry. Reply with one line: WORKFLOW=<ALLOWED|DENIED> followed by the first 120 characters of the result.';

/** A skill id names c3 whether the SDK reports it bare or plugin-namespaced ("c3-skill:c3"). */
const isC3 = (skill: unknown): boolean => typeof skill === 'string' && /(^|:)c3$/.test(skill);
const isVerifyShipped = (skill: unknown): boolean => typeof skill === 'string' && /(^|:)verify-shipped$/.test(skill);

interface Run {
  lines: string[];
  transcript: string;
  result: OneShotSessionResult;
}

interface RunOptions {
  /** A `permissions.allow` list written to <home>/.claude/settings.local.json — the same
   * mechanism as a user-tier allow rule, in a scratch file (spec §4.2). */
  hostAllow?: string[];
  withoutVerifyShippedPlugin?: boolean;
  /** The session is TOLD to break a wall; its log goes to adversarial/, never to G5's root. */
  adversarial?: boolean;
}

async function runKind(kind: SessionKind, prompt: string, label: string, opts: RunOptions = {}): Promise<Run> {
  // realpath now: macOS tmpdir is a symlink, and the containment hook realpaths what it checks.
  // DEBT debt-runner-temp-dir-leak — this temp dir has no cleanup path; see rule-temp-dir-cleanup.
  const homeDir = realpathSync(mkdtempSync(join(tmpdir(), `sss-e2e-${kind}-`)));
  if (opts.hostAllow !== undefined) {
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: opts.hostAllow } }));
  }
  const lines: string[] = [];
  const io: OneShotSessionSeam = {
    // Byte-for-byte the composition root's production wiring (cli/main.ts).
    spawnSession: (params) => sdkSpawnSession(params as unknown as SpawnSessionParams),
    onSessionStart: () => {},
    appendLog: (_logPath, line) => {
      lines.push(line);
    },
  };
  const attachesVerifyShipped = kind === 'closing' && opts.withoutVerifyShippedPlugin !== true;
  const result = await runOneShotSession(
    {
      kind,
      prompt,
      config: {
        homeDir,
        model: MODEL,
        maxTurns: 8,
        ...(kind === 'ratify' ? {} : { repoRoot: REPO_ROOT }),
        realpath: (p: string) => {
          try {
            return realpathSync(p);
          } catch {
            return p; // the seam's contract: a path that does not exist comes back unchanged
          }
        },
        ...(attachesVerifyShipped ? { verifyShippedPluginDir: VERIFY_SHIPPED_DIR } : {}),
      },
      sessionTimeoutMs: SESSION_TIMEOUT_MS,
    },
    io,
  );
  if (LOG_DIR !== undefined) {
    const dir = join(LOG_DIR, opts.adversarial === true ? 'adversarial' : 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${kind}-${label}.jsonl`), `${lines.join('\n')}\n`);
  }
  return { lines, transcript: lines.join('\n'), result };
}

/** Every parsed message; a line that is not JSON contributes nothing (narrow catch). */
function messages(lines: string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // a malformed line is skipped, never thrown on
    }
  }
  return out;
}

function initSkills(lines: string[]): string[] {
  const init = messages(lines).find((m) => m.type === 'system' && m.subtype === 'init');
  const skills = init?.skills;
  return Array.isArray(skills) ? skills.filter((s): s is string => typeof s === 'string') : [];
}

function toolUses(lines: string[], toolName: string): Array<{ input?: Record<string, unknown> }> {
  const uses: Array<{ input?: Record<string, unknown> }> = [];
  for (const m of messages(lines)) {
    const content = (m.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<{ type?: unknown; name?: unknown; input?: Record<string, unknown> }>) {
      if (block.type === 'tool_use' && block.name === toolName) uses.push({ input: block.input });
    }
  }
  return uses;
}

function deniedTools(result: OneShotSessionResult): string[] {
  return (result.permissionDenials ?? []).map((d) => String((d as { tool_name?: unknown }).tool_name));
}

describe('supervisor sessions — real model, the supervisor\'s own spawn path (card supervisor-session-settings)', () => {
  // G1, closing: the full oracle — Skill c3 RETURNS C3 content.
  test.skipIf(!RUN_E2E)('closing: Skill c3 returns C3 content and no Unknown skill appears', async () => {
    const run = await runKind('closing', C3_PROMPT, 'c3');
    expect(run.transcript).not.toContain('Unknown skill'); // first, so a tier regression fails HERE
    expect(toolUses(run.lines, 'Skill').some((u) => isC3(u.input?.skill))).toBe(true);
    expect(run.transcript).toContain('skills/c3'); // the loaded body's own base-directory line
    expect(run.result.outcome).toBe('success');
  }, TEST_TIMEOUT_MS);

  // G1, ruling/ratify — the SAME oracle as closing (owner ruling R2 granted Skill): Skill c3
  // RETURNS C3 content. The C3 CLI itself cannot run here (no Bash) — accepted, not asserted.
  for (const kind of ['ruling', 'ratify'] as const) {
    test.skipIf(!RUN_E2E)(`${kind}: Skill c3 returns C3 content and no Unknown skill appears`, async () => {
      const run = await runKind(kind, C3_PROMPT, 'c3');
      expect(run.transcript).not.toContain('Unknown skill'); // first, so a tier regression fails HERE
      expect(initSkills(run.lines).some(isC3)).toBe(true);
      expect(toolUses(run.lines, 'Skill').some((u) => isC3(u.input?.skill))).toBe(true);
      expect(deniedTools(run.result)).not.toContain('Skill'); // R2: the grant lets it through
      expect(run.transcript).toContain('skills/c3'); // the loaded body's own base-directory line
      expect(run.result.outcome).toBe('success');
    }, TEST_TIMEOUT_MS);
  }

  // G2: at least one real refusal of `find /` in a closing session.
  test.skipIf(!RUN_E2E)('closing: a real `find /` is refused by the scan wall', async () => {
    const run = await runKind('closing', SCAN_PROMPT, 'scan', { adversarial: true });
    const commands = toolUses(run.lines, 'Bash')
      .map((u) => u.input?.command)
      .filter((c): c is string => typeof c === 'string');
    expect(commands.some(isFilesystemWideScan)).toBe(true); // the attempt happened, or this proves nothing
    expect(run.transcript).toContain('Filesystem-wide scans are disabled for campaign sessions');
    expect(deniedTools(run.result)).toContain('Bash');
  }, TEST_TIMEOUT_MS);

  // G4: verify-shipped with the hand-load (production config) — asserted.
  test.skipIf(!RUN_E2E)('closing: verify-shipped resolves with options.plugins (the kept hand-load)', async () => {
    const run = await runKind('closing', VERIFY_SHIPPED_PROMPT, 'verify-shipped-with-plugin');
    expect(run.transcript).not.toContain('Unknown skill');
    expect(toolUses(run.lines, 'Skill').some((u) => isVerifyShipped(u.input?.skill))).toBe(true);
    expect(run.transcript).toContain('Verify Shipped');
    console.log(`G4_WITH_PLUGIN registered as: ${JSON.stringify(initSkills(run.lines).filter(isVerifyShipped))}`);
  }, TEST_TIMEOUT_MS);

  // G4: WITHOUT the hand-load — a measurement for the PR body, not a gate: whether the user tier
  // alone resolves it depends on whether install.sh ran on this host (spec §4.4).
  test.skipIf(!RUN_E2E)('closing: verify-shipped WITHOUT options.plugins — measured and reported', async () => {
    const run = await runKind('closing', VERIFY_SHIPPED_PROMPT, 'verify-shipped-without-plugin', { withoutVerifyShippedPlugin: true });
    const resolved = !run.transcript.includes('Unknown skill') && run.transcript.includes('Verify Shipped');
    console.log(`G4_WITHOUT_PLUGIN=${resolved ? 'resolved' : 'unknown'} registered as: ${JSON.stringify(initSkills(run.lines).filter(isVerifyShipped))}`);
    expect(run.result.outcome).toBe('success');
  }, TEST_TIMEOUT_MS);

  // Ruling R1: a host allow rule cannot widen closing.
  test.skipIf(!RUN_E2E)('closing: a loaded allow rule for Workflow does not let Workflow run', async () => {
    const run = await runKind('closing', GRANT_PROMPT, 'grant', { hostAllow: ['Workflow', 'ToolSearch'], adversarial: true });
    expect(run.transcript).not.toContain('Workflow launched');
    expect(run.transcript).toContain('This closing session is not granted this tool');
  }, TEST_TIMEOUT_MS);
});
