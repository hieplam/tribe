// transcript-prompts.ts — extracts, from REAL session transcripts, every prompt the runner and the
// supervisor actually sent (card runner-driver-only, V1 cross-check on the V2 real runs).
//
// The static renderer (render-prompts.ts) covers every prompt kind the code CAN send; this covers
// what a real run DID send, and it reads the same transcript format for the BEFORE and the AFTER
// run, so it needs no change between them.
//
// A runner- or supervisor-sent prompt is a top-level (`isSidechain` not true), non-meta
// (`isMeta` not true) `user` entry whose content is a string or carries `text` blocks — the
// initial brief and every resume/turn prompt. Tool results, subagent conversations and
// harness-injected meta entries are excluded: those are not something the runner wrote.
//
// Session ids come from the campaign home: executor logs are named `<card>-<sessionId>.log`, and
// supervisor one-shot logs `supervisor/sessions/<sessionId>.log`. Transcripts are found under
// <claude home>/projects/*/<sessionId>.jsonl (any project dir — a session's cwd decides which). The
// Claude home is `--claude-home`, else `$CLAUDE_CONFIG_DIR` (the D9 sandbox runs), else ~/.claude.
//
// Usage: bun transcript-prompts.ts --home <campaign-home> --out <dir> [--claude-home <dir>]
// Writes <dir>/real/<sessionId>/<n>.txt and a manifest.json that g2-prompts.ts reads with
// --negative-only (the positive half needs rendered kinds, which real transcripts do not name).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v === undefined || v.startsWith('--') ? undefined : v;
}

function sessionIdsOf(home: string): string[] {
  const ids = new Set<string>();
  const runs = join(home, 'runs');
  if (existsSync(runs)) {
    for (const runId of readdirSync(runs)) {
      const logs = join(runs, runId, 'logs');
      if (!existsSync(logs)) continue;
      for (const f of readdirSync(logs)) {
        const m = UUID.exec(f);
        if (m) ids.add(m[0]);
      }
    }
  }
  const sup = join(home, 'supervisor', 'sessions');
  if (existsSync(sup)) {
    for (const f of readdirSync(sup)) {
      const m = UUID.exec(f);
      if (m) ids.add(m[0]);
    }
  }
  return [...ids].sort();
}

function claudeHome(): string {
  return arg('--claude-home') ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

function transcriptOf(sessionId: string): string | null {
  const projects = join(claudeHome(), 'projects');
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const path = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
}

function promptsIn(transcript: string): string[] {
  const out: string[] = [];
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== 'user' || entry.isSidechain === true || entry.isMeta === true) continue;
    const content = (entry.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string') {
      out.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    const texts = content
      .filter((b): b is { type: string; text: string } => (b as { type?: unknown }).type === 'text'
        && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text);
    if (texts.length > 0) out.push(texts.join('\n'));
  }
  return out;
}

function main(): void {
  const home = arg('--home');
  const out = arg('--out');
  if (home === undefined || out === undefined) {
    console.error('usage: bun transcript-prompts.ts --home <campaign-home> --out <dir>');
    process.exit(2);
  }
  const files: Array<{ kind: string; file: string; bytes: number }> = [];
  const missing: string[] = [];
  for (const sessionId of sessionIdsOf(home)) {
    const transcript = transcriptOf(sessionId);
    if (transcript === null) {
      missing.push(sessionId);
      continue;
    }
    promptsIn(transcript).forEach((text, n) => {
      const file = join('real', sessionId, `${n}.txt`);
      mkdirSync(dirname(join(out, file)), { recursive: true });
      writeFileSync(join(out, file), text);
      files.push({ kind: `real/${sessionId}/${n}`, file, bytes: Buffer.byteLength(text) });
    });
  }
  const manifest = {
    renderer: `transcript-prompts.ts over ${home}`,
    transcriptsMissing: missing,
    files,
    injections: [],
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`extracted ${files.length} prompt(s) from ${sessionIdsOf(home).length - missing.length} transcript(s); missing: ${missing.length}`);
}

main();
