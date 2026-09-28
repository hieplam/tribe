// adapters/campaign-status.adapter.ts — the world `tribe campaign status` reads: the repo's tribe
// home (resolved by the one script that owns that rule), the campaign directories under it, their
// two JSON files, the clock, and this terminal. Every hostile thing a file can be — absent,
// unreadable, not JSON, a directory — becomes a typed value here, so the flow in core/ never
// sees an exception (fail-closed-edges.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignStatusIo, Parsed, ReadJson } from '../core/campaign-status.ts';

/** The single source of truth for `~/.tribe/<repo-key>`; `tribe` must not re-derive that rule. */
const TRIBE_HOME_SH = join(import.meta.dir, '..', '..', 'tribe-home.sh');

const HOME_TIMEOUT_MS = 5_000;

/** Erase the screen and park the cursor at the top-left, so `--watch` redraws in place. */
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

export function buildCampaignStatusIo(cwd: string): CampaignStatusIo {
  return {
    home: () => resolveHome(cwd),
    listCampaigns,
    readJson,
    now: () => Date.now(),
    print: (lines) => console.log(lines.join('\n')),
    printErr: (line) => console.error(line),
    clear: () => process.stdout.write(CLEAR_SCREEN),
    // The real watch never stops itself: Ctrl-C kills the process. Only tests answer 'stop'.
    sleep: async (ms) => {
      await Bun.sleep(ms);
      return 'continue';
    },
  };
}

/** tribe-home.sh exits non-zero for exactly one reason a user can hit: `cwd` is not in a repo. */
function resolveHome(cwd: string): Parsed<string> {
  const result = Bun.spawnSync(['bash', TRIBE_HOME_SH], {
    cwd,
    // The host's git config must not change what this command reports (fail-closed-edges.md §2).
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    timeout: HOME_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return { ok: false, reason: `tribe: not inside a git repository (${cwd})` };
  return { ok: true, value: result.stdout.toString().trim() };
}

/** Campaign directories, newest first is the caller's business — this only reports each one's
 * mtime: the later of its two state files, so a campaign whose supervisor just wrote counts as
 * updated. A campaign with neither file readable sorts last with 0. */
function listCampaigns(home: string): { name: string; updatedMs: number }[] {
  const campaignsDir = join(home, 'campaigns');
  let entries;
  try {
    entries = readdirSync(campaignsDir, { withFileTypes: true });
  } catch (error) {
    // No campaigns directory yet is not a failure: this repo has simply never run a campaign.
    if (isErrnoCode(error, 'ENOENT')) return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      updatedMs: Math.max(
        mtimeMs(join(campaignsDir, entry.name, 'campaign-state.json')),
        mtimeMs(join(campaignsDir, entry.name, 'supervisor', 'status.json')),
      ),
    }));
}

/** 0 when the file is not there — an absent file is simply no evidence of an update. */
function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return 0;
    throw error;
  }
}

/** Reads and decodes one JSON file. Only the four things that happen to real campaign files are
 * converted; anything else rethrows rather than being reported as a well-understood refusal. */
function readJson(path: string): ReadJson {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return { kind: 'missing' };
    if (isErrnoCode(error, 'EACCES')) return { kind: 'unreadable', reason: 'permission denied' };
    if (isErrnoCode(error, 'EISDIR')) return { kind: 'unreadable', reason: 'is a directory' };
    throw error;
  }

  try {
    return { kind: 'ok', value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: 'unreadable', reason: 'not valid JSON' };
    throw error;
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
