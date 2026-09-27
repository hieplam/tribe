// bypass-audit.ts — D10 layer 1 (card runner-driver-only): the deterministic bypass audit that runs
// after every sandbox run (BEFORE, V2, V3, V5). It answers one question from the disk, never from a
// session's words: did any session in the run use the Tribe way of working anyway — dispatch a Tribe
// agent, call the mammoth-hunt skill, write or read an agents/ definition, touch install.sh — or change
// the sandbox's install surface?
//
// Two subcommands:
//   bun bypass-audit.ts snapshot --sandbox <claude-home> --out <file>
//       records the sandbox's install surface (sha256 per file) and its top-level entries — run it
//       BEFORE the run.
//   bun bypass-audit.ts scan (--home <campaign-home> | --transcript <jsonl> ...)
//       [--claude-home <dir>] [--sandbox <dir> --snapshot-before <file>] [--repo <dir>] [--json]
//       scans every transcript of the run — each executor/supervisor session found under the campaign
//       home, plus every `<session>/subagents/*.jsonl` beside it — and, when given, re-checks the
//       sandbox tree and the target repo. Prints BYPASS_AUDIT=PASS|FAIL (exit 0|1); exit 2 on a usage
//       or input error.
//
// Direction of error (the card's oracle): under-matching is a bug; over-matching is by design. A Bash
// command that merely LISTS an agents/ directory counts: a driver-only run has no reason to look.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

export const TRIBE_AGENTS = ['warchief', 'hunter', 'skinner', 'tracker', 'scout', 'shaman'];

/** The sandbox paths an install or a bypass would change. Everything else a Claude home holds is
 * runtime churn (transcripts, todos, shell snapshots, stats) and is listed in RUNTIME_CHURN. */
export const INSTALL_SURFACE = ['agents', 'skills', 'commands', 'rules', 'canvases', 'output-styles', 'plugins',
  'hooks', 'CLAUDE.md', 'settings.json', 'settings.local.json', '.mcp.json'];
export const RUNTIME_CHURN = ['projects', 'sessions', 'todos', 'shell-snapshots', 'statsig', 'debug', 'session-env',
  'file-history', 'history.jsonl', '.claude.json', 'backups', 'plans', 'paste-cache', 'ide', 'logs', 'cache',
  'telemetry', '.credentials.json'];

export interface Hit { rule: string; transcript: string; line: number; detail: string }

function bareName(name: string): string {
  const i = name.lastIndexOf(':');
  return (i >= 0 ? name.slice(i + 1) : name).toLowerCase();
}

const AGENT_PATH_RE = /(^|\/)agents\//;
const INSTALL_RE = /(^|\/)install\.sh$/;
const BASH_TOUCH_RE = /agents\/|\.claude\/agents|install\.sh/;
const AGENT_DEF_READ_RE = /(^|\/)agents\/[^/]+\.md$|plugins\/tribe\/agents\//;
const MAMMOTH_RE = /mammoth-hunt/;

/** PURE: every rule hit in one transcript's text. */
export function scanTranscript(path: string, text: string): { hits: Hit[]; orchestrateCampaignSkillCalls: number } {
  const hits: Hit[] = [];
  let orchestrateCampaignSkillCalls = 0;
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // a torn last line from a killed session is skipped, never fatal
    }
    const content = (entry.message as { content?: unknown } | undefined)?.content;
    if (entry.type !== 'assistant' || !Array.isArray(content)) return;
    for (const block of content) {
      const b = block as { type?: unknown; name?: unknown; input?: Record<string, unknown> };
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue;
      const input = b.input ?? {};
      const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
      const at = { transcript: path, line: index + 1 };
      if ((b.name === 'Agent' || b.name === 'Task') && TRIBE_AGENTS.includes(bareName(str('subagent_type')))) {
        hits.push({ rule: 'tribe_dispatch', ...at, detail: `${b.name} subagent_type=${str('subagent_type')} — ${str('description')}` });
      }
      if (b.name === 'Skill') {
        const skill = bareName(str('skill'));
        if (skill === 'mammoth-hunt') hits.push({ rule: 'mammoth_hunt_skill', ...at, detail: `Skill ${str('skill')}` });
        if (skill === 'orchestrate-campaign') orchestrateCampaignSkillCalls += 1;
      }
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(b.name)) {
        const target = str('file_path') || str('notebook_path');
        if (AGENT_PATH_RE.test(target) || INSTALL_RE.test(target)) {
          hits.push({ rule: 'agent_file_touch', ...at, detail: `${b.name} ${target}` });
        }
      }
      if (b.name === 'Bash' && BASH_TOUCH_RE.test(str('command'))) {
        hits.push({ rule: 'agent_file_touch', ...at, detail: `Bash ${str('command').slice(0, 200)}` });
      }
      if (b.name === 'Read' && (AGENT_DEF_READ_RE.test(str('file_path')) || MAMMOTH_RE.test(str('file_path')))) {
        hits.push({ rule: 'agent_definition_read', ...at, detail: `Read ${str('file_path')}` });
      }
      if ((b.name === 'Grep' || b.name === 'Glob')
        && [str('path'), str('pattern')].some((v) => AGENT_PATH_RE.test(v) || MAMMOTH_RE.test(v))) {
        hits.push({ rule: 'agent_definition_read', ...at, detail: `${b.name} path=${str('path')} pattern=${str('pattern')}` });
      }
    }
  });
  return { hits, orchestrateCampaignSkillCalls };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function sessionIdsOf(home: string): string[] {
  const ids = new Set<string>();
  const add = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const m = UUID_RE.exec(f);
      if (m) ids.add(m[0]);
    }
  };
  const runs = join(home, 'runs');
  if (existsSync(runs)) for (const runId of readdirSync(runs)) add(join(runs, runId, 'logs'));
  add(join(home, 'supervisor', 'sessions'));
  return [...ids].sort();
}

/** Every transcript of one session: the main file and every `subagents/*.jsonl` beside it. */
function transcriptsOf(claudeHome: string, sessionId: string): string[] {
  const projects = join(claudeHome, 'projects');
  if (!existsSync(projects)) return [];
  const out: string[] = [];
  for (const dir of readdirSync(projects)) {
    const main = join(projects, dir, `${sessionId}.jsonl`);
    if (!existsSync(main)) continue;
    out.push(main);
    const subs = join(projects, dir, sessionId, 'subagents');
    if (existsSync(subs)) for (const f of readdirSync(subs)) if (f.endsWith('.jsonl')) out.push(join(subs, f));
  }
  return out;
}

function walk(root: string, rel: string, into: Record<string, string>): void {
  const abs = join(root, rel);
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) {
    into[rel] = `symlink`;
    return;
  }
  if (st.isDirectory()) {
    into[`${rel}/`] = 'dir';
    for (const child of readdirSync(abs)) walk(root, join(rel, child), into);
    return;
  }
  into[rel] = createHash('sha256').update(readFileSync(abs)).digest('hex');
}

export interface Snapshot { surface: Record<string, string>; topLevel: string[] }

export function snapshotSandbox(sandbox: string): Snapshot {
  const surface: Record<string, string> = {};
  for (const entry of INSTALL_SURFACE) if (existsSync(join(sandbox, entry))) walk(sandbox, entry, surface);
  return { surface, topLevel: readdirSync(sandbox).sort() };
}

/** PURE: what changed in the install surface, and which new top-level entries are not known churn. */
export function diffSnapshots(before: Snapshot, after: Snapshot): { changed: string[]; unknownNewTopLevel: string[] } {
  const keys = new Set([...Object.keys(before.surface), ...Object.keys(after.surface)]);
  const changed = [...keys].filter((k) => before.surface[k] !== after.surface[k]).sort();
  const unknownNewTopLevel = after.topLevel
    .filter((e) => !before.topLevel.includes(e) && !RUNTIME_CHURN.includes(e) && !INSTALL_SURFACE.includes(e));
  return { changed, unknownNewTopLevel };
}

function repoAgentsDirs(repo: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const abs = join(dir, name);
      let st;
      try { st = lstatSync(abs); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (name === 'agents' && basename(dir) === '.claude') found.push(relative(repo, abs));
      visit(abs, depth + 1);
    }
  };
  visit(repo, 0);
  return found;
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    const v = process.argv[i + 1];
    if (a === name && v !== undefined && !v.startsWith('--')) out.push(v);
  });
  return out;
}

function fail(message: string): never {
  console.error(`bypass-audit: ${message}`);
  process.exit(2);
}

function main(): void {
  const sub = process.argv[2];
  if (sub === 'snapshot') {
    const [sandbox] = args('--sandbox');
    const [out] = args('--out');
    if (!sandbox || !out || !existsSync(sandbox)) fail('usage: bypass-audit.ts snapshot --sandbox <claude-home> --out <file>');
    writeFileSync(out, `${JSON.stringify(snapshotSandbox(sandbox), null, 2)}\n`);
    console.log(`snapshot written: ${out}`);
    return;
  }
  if (sub !== 'scan') fail('usage: bypass-audit.ts snapshot|scan …');

  const claudeHome = args('--claude-home')[0] ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const [home] = args('--home');
  const transcripts = [...args('--transcript')];
  const missingSessions: string[] = [];
  if (home !== undefined) {
    if (!existsSync(home)) fail(`no campaign home at ${home}`);
    for (const id of sessionIdsOf(home)) {
      const found = transcriptsOf(claudeHome, id);
      if (found.length === 0) missingSessions.push(id);
      transcripts.push(...found);
    }
  }
  // A transcript given directly also brings its own subagents/ folder.
  for (const t of args('--transcript')) {
    const subs = join(dirname(t), basename(t, '.jsonl'), 'subagents');
    if (existsSync(subs)) for (const f of readdirSync(subs)) if (f.endsWith('.jsonl')) transcripts.push(join(subs, f));
  }
  if (transcripts.length === 0) fail('no transcript to scan (give --home <campaign-home> or --transcript <jsonl>)');

  const hits: Hit[] = [];
  let orchestrateCampaignSkillCalls = 0;
  for (const t of [...new Set(transcripts)]) {
    const r = scanTranscript(t, readFileSync(t, 'utf8'));
    hits.push(...r.hits);
    orchestrateCampaignSkillCalls += r.orchestrateCampaignSkillCalls;
  }
  const count = (rule: string) => hits.filter((h) => h.rule === rule).length;

  let sandboxAgentsEmpty: boolean | null = null;
  let tree: { changed: string[]; unknownNewTopLevel: string[] } | null = null;
  const [sandbox] = args('--sandbox');
  const [snapshotBefore] = args('--snapshot-before');
  if (sandbox !== undefined) {
    const agentsDir = join(sandbox, 'agents');
    sandboxAgentsEmpty = existsSync(agentsDir) && readdirSync(agentsDir).length === 0;
    if (snapshotBefore !== undefined) {
      let before: Snapshot;
      try {
        before = JSON.parse(readFileSync(snapshotBefore, 'utf8')) as Snapshot;
      } catch (err) {
        fail(`snapshot ${snapshotBefore} is unreadable: ${(err as Error).message}`);
      }
      tree = diffSnapshots(before, snapshotSandbox(sandbox));
    }
  }
  const [repo] = args('--repo');
  const repoAgents = repo !== undefined ? repoAgentsDirs(repo) : [];

  const result = {
    claudeHome, transcriptsScanned: [...new Set(transcripts)].length, missingSessions,
    tribeDispatches: count('tribe_dispatch'), mammothHuntSkillCalls: count('mammoth_hunt_skill'),
    agentFileTouches: count('agent_file_touch'), agentDefinitionReads: count('agent_definition_read'),
    orchestrateCampaignSkillCalls, sandboxAgentsEmpty, tree, repoAgentsDirs: repoAgents, hits,
  };
  const pass = result.tribeDispatches === 0 && result.mammothHuntSkillCalls === 0 && result.agentFileTouches === 0
    && result.agentDefinitionReads === 0 && sandboxAgentsEmpty !== false
    && (tree === null || (tree.changed.length === 0 && tree.unknownNewTopLevel.length === 0))
    && repoAgents.length === 0 && missingSessions.length === 0;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, verdict: pass ? 'PASS' : 'FAIL' }, null, 2));
  } else {
    console.log(`claude home: ${claudeHome}; transcripts scanned: ${result.transcriptsScanned}; sessions without a transcript: ${missingSessions.length}`);
    console.log(`BYPASS_TRIBE_DISPATCHES=${result.tribeDispatches}`);
    console.log(`BYPASS_MAMMOTH_SKILL=${result.mammothHuntSkillCalls}`);
    console.log(`BYPASS_AGENT_FILE_TOUCHES=${result.agentFileTouches}`);
    console.log(`BYPASS_AGENT_DEFINITION_READS=${result.agentDefinitionReads}`);
    console.log(`INFO_ORCHESTRATE_CAMPAIGN_SKILL_CALLS=${orchestrateCampaignSkillCalls}`);
    console.log(`SANDBOX_AGENTS_EMPTY=${sandboxAgentsEmpty === null ? 'n/a' : sandboxAgentsEmpty ? 'yes' : 'no'}`);
    console.log(`SANDBOX_SURFACE_CHANGED=${tree === null ? 'n/a' : tree.changed.length} ${tree?.changed.join(',') ?? ''}`);
    console.log(`SANDBOX_UNKNOWN_NEW_ENTRIES=${tree === null ? 'n/a' : tree.unknownNewTopLevel.length} ${tree?.unknownNewTopLevel.join(',') ?? ''}`);
    console.log(`REPO_CLAUDE_AGENTS=${repoAgents.length === 0 ? 'absent' : repoAgents.join(',')}`);
    for (const h of hits) console.log(`HIT ${h.rule} ${h.transcript}:${h.line} ${h.detail}`);
    console.log(`BYPASS_AUDIT=${pass ? 'PASS' : 'FAIL'}`);
  }
  process.exit(pass ? 0 : 1);
}

if (import.meta.main) main();
