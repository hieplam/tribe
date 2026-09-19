// ratchet-check.ts — the thin edge (spec §3, card supervisor-hardening / G2) that gives the
// context ratchet a caller. It reads two ratchet-file CONTENTS — the merge-base version via git,
// the working-tree version off disk — and hands both to the pure `checkRatchetRevision`. Every
// decision lives there; this file only does I/O.
//
//   bun ratchet-check.ts --repo <dir> --base <ref> [--path <ratchet-path>]
//
// Exit 0 when no ceiling is raised without a `raisedBy` ruling id, 1 (printing each refusal)
// otherwise. IMPURE EDGE ONLY (pure-core.md). fail-closed-edges.md: the git call is bounded
// (obligation 3) and runs with host git config neutralised (obligation 2), and a flag whose value
// is missing refuses with a message rather than consuming the next token (obligation 1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRatchetRevision } from './runner/core/metrics/ratchet-gate.ts';

const DEFAULT_PATH = 'docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json';

class RatchetCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatchetCheckError';
  }
}

interface Options {
  repo: string;
  base: string;
  path: string;
}

function parseArgs(argv: readonly string[]): Options {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0) return undefined;
    const value = argv[idx + 1];
    // A flag whose value is missing or is itself another flag token (`--x`) reads as absent, so the
    // required-flag guard refuses instead of threading e.g. `--base` in as `--repo`'s value.
    if (value === undefined || value.startsWith('--')) return undefined;
    return value;
  };
  const repo = get('--repo');
  const base = get('--base');
  if (repo === undefined || base === undefined) {
    throw new RatchetCheckError('usage: ratchet-check.ts --repo <dir> --base <ref> [--path <ratchet-path>]');
  }
  return { repo, base, path: get('--path') ?? DEFAULT_PATH };
}

/** `git -C <repo> show <base>:<path>` — the base (merge-base) version's contents, or '' when that
 * ref has no such file. '' is the "no prior version" case checkRatchetRevision treats as the
 * initial measurement. Bounded and git-config-isolated (fail-closed-edges obligations 2, 3). */
async function baseVersion(repo: string, base: string, path: string): Promise<string> {
  const proc = Bun.spawn(['git', '-C', repo, 'show', `${base}:${path}`], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return code === 0 ? out : '';
}

function parseArgsOrExit(argv: readonly string[]): Options {
  try {
    return parseArgs(argv);
  } catch (err) {
    console.error(`ratchet-check: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
  const options = parseArgsOrExit(argv);
  const base = await baseVersion(options.repo, options.base, options.path);
  let head: string;
  try {
    head = readFileSync(join(options.repo, options.path), 'utf8');
  } catch {
    head = '';
  }
  const result = checkRatchetRevision(base, head);
  if (result.ok) {
    process.exit(0);
  }
  for (const failure of result.failures) {
    console.error(`ratchet-check: ${failure.kind}: ${failure.reason}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  void main();
}
