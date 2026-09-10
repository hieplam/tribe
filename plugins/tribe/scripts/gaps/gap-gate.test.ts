// gap-gate.test.ts — the pre-PR gate (card C1, spec §2 steps 1-7; card goals G1, G2, G3).
// Every fixture is built from an EMPTY directory and a bare `git init` — the shape a real target
// repo has on its first campaign — and one case invokes the CLI the way a person does, with a
// RELATIVE --repo from a different cwd (fixtures-mirror-reality).
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { runGate } from './gap-gate.ts';
import { parseLedger } from './ledger.ts';
import { parseStamp } from './gap-stamp.ts';

const GATE = join(import.meta.dir, 'gap-gate.ts');
const trash: string[] = [];
afterEach(() => {
  for (const dir of trash.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, args: string[]): string {
  const proc = Bun.spawnSync(
    ['git', '-C', repo, '-c', 'user.email=t@t.test', '-c', 'user.name=t', ...args],
    { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } },
  );
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

/** Builds the card's fixture FROM NOTHING: an empty dir, `git init`, three modules that share one
 * unwritten pattern, then a fourth module repeating it — exactly the shape build-fixture.sh
 * produces for the end-to-end reproduction. */
function buildFixture(): { repo: string; home: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'gap-gate-'));
  trash.push(root);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, ['init', '-q', '-b', 'master']);
  for (const m of ['loader', 'parser', 'writer']) {
    writeFileSync(
      join(repo, `src/${m}.ts`),
      `export function ${m}(input: string, fallback: string): string {\n  try {\n    return JSON.parse(input).value as string;\n  } catch {}\n  return fallback;\n}\n`,
    );
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'seed: three modules']);
  const base = git(repo, ['rev-parse', 'HEAD']);

  writeFileSync(
    join(repo, 'src/reader.ts'),
    'export function reader(input: string, fallback: string): string {\n  try {\n    return JSON.parse(input).value as string;\n  } catch {}\n  return fallback;\n}\n',
  );
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'feat: add the fourth module']);

  const home = join(root, 'home');
  mkdirSync(join(home, 'reports'), { recursive: true });
  return { repo, home, base };
}

const CANDIDATE_BLOCK = [
  'HG-candidate 1  [input-validation]  diff FOLLOWS an undocumented pattern',
  '  Pattern:    `JSON.parse(input).value as string` is a compile-time type assertion, not a',
  '              runtime check.',
  '  Evidence:   `grep -rn "as string" src/` → 4 hits in 4 files (`src/loader.ts:4`,',
  '              `src/reader.ts:4`)',
  '  Diff link:  `src/reader.ts:4` repeats it',
  '  Not judged: this is a gap in the rule set, not a violation',
].join('\n');

function writeReport(home: string, card: string, round: string, body: string): void {
  writeFileSync(join(home, 'reports', `tracker-${card}-${round}.md`), `## Review\nVerdict: APPROVE\n\n### Harness gaps\n\n${body}\n`);
}

describe('gap-gate (spec §2)', () => {
  test('G1: one Tracker report with one candidate mints G-001, appends one opened event, stamps the report', async () => {
    const { repo, home, base } = buildFixture();
    writeReport(home, 'C1', 'final', CANDIDATE_BLOCK);

    const summary = await runGate({ repo, home, card: 'C1', base, head: 'HEAD', pr: 7 });

    expect(summary.exit).toBe(0);
    expect(summary.verdict).toBe('pass');
    expect(summary.minted).toEqual(['G-001']);
    expect(summary.matched).toEqual([]);
    expect(summary.unparsed).toEqual([]);
    expect(summary.changed_files).toEqual(['src/reader.ts']);

    const ledger = parseLedger(readFileSync(join(repo, '.tribe/harness-gaps.jsonl'), 'utf8'));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ id: 'G-001', event: 'opened', category: 'input-validation', first_seen_pr: 7 });

    const md = readFileSync(join(home, 'reports/C1-gap-gate.md'), 'utf8');
    expect(md.startsWith('## Harness gaps')).toBe(true);
    const stamp = parseStamp(md);
    expect(stamp).not.toBeNull();
    expect(stamp!.card).toBe('C1');
    expect(stamp!.minted).toEqual(['G-001']);
    expect(stamp!.base).toBe(base);
    // F1 (spec §3): the stamp freezes RESOLVED COMMIT SHAs, never the literal `HEAD` a
    // post-merge runner would re-resolve at verify time instead of binding to the gated commit.
    expect(stamp!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(stamp!.head).not.toBe('HEAD');
    expect(stamp!.base).toMatch(/^[0-9a-f]{40}$/);
    expect(stamp!.ledger).toMatch(/^[0-9a-f]{64}$/);
    expect(md.trimEnd().endsWith('-->')).toBe(true);

    const json = JSON.parse(readFileSync(join(home, 'reports/C1-gap-gate.json'), 'utf8'));
    expect(json.open_ids).toEqual(['G-001']);
  });

  test('G2: a second run over the same range records one seen on G-001 and mints no new id', async () => {
    const { repo, home, base } = buildFixture();
    writeReport(home, 'C1', 'final', CANDIDATE_BLOCK);
    await runGate({ repo, home, card: 'C1', base, head: 'HEAD', pr: 7 });

    const second = await runGate({ repo, home, card: 'C1', base, head: 'HEAD', pr: 8 });

    expect(second.exit).toBe(0);
    expect(second.matched).toEqual(['G-001']);
    expect(second.minted).toEqual([]);
    const ledger = parseLedger(readFileSync(join(repo, '.tribe/harness-gaps.jsonl'), 'utf8'));
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({ id: 'G-001', event: 'seen', pr: 8 });
  });

  test('G3: zero Tracker report files is exit 2 with the spec §2 step 1 message', async () => {
    const { repo, home, base } = buildFixture();
    await expect(runGate({ repo, home, card: 'C1', base, head: 'HEAD' })).rejects.toThrow(
      'no Tracker report for card C1: step 6.0b never ran, or the report path was wrong',
    );
  });

  test('reports from every round are read, not only the final one (leak L1)', async () => {
    const { repo, home, base } = buildFixture();
    writeReport(home, 'C1', 'task-3', CANDIDATE_BLOCK);
    writeReport(home, 'C1', 'final', 'no candidates this round');

    const summary = await runGate({ repo, home, card: 'C1', base, head: 'HEAD' });

    expect(summary.reports).toEqual(['tracker-C1-final.md', 'tracker-C1-task-3.md']);
    expect(summary.minted).toEqual(['G-001']);
  });

  test('the same gap seen in two rounds collapses to one candidate, keeping the earliest round', async () => {
    const { repo, home, base } = buildFixture();
    writeReport(home, 'C1', 'task-3', CANDIDATE_BLOCK);
    writeReport(home, 'C1', 'wave-9', CANDIDATE_BLOCK);

    const summary = await runGate({ repo, home, card: 'C1', base, head: 'HEAD' });

    expect(summary.candidates).toHaveLength(1);
    expect(summary.minted).toEqual(['G-001']);
  });

  test('an unmappable block is reported under unparsed and the gate still runs green', async () => {
    const { repo, home, base } = buildFixture();
    writeReport(home, 'C1', 'final', 'HG-candidate 1  [error-handling]  diff FOLLOWS an undocumented pattern\n  Pattern:    something with no evidence at all\n');

    const summary = await runGate({ repo, home, card: 'C1', base, head: 'HEAD' });

    expect(summary.exit).toBe(0);
    expect(summary.minted).toEqual([]);
    expect(summary.unparsed).toEqual([
      { file: 'tracker-C1-final.md', line: 6, reason: 'no Evidence command', excerpt: expect.any(String) },
    ]);
    expect(readFileSync(join(home, 'reports/C1-gap-gate.md'), 'utf8')).toContain('- unparsed HG-candidate blocks: 1');
  });

  test('an unsafe candidate fingerprint is red (exit 1), flagged, and never minted into the ledger', async () => {
    const { repo, home, base } = buildFixture();
    writeReport(
      home,
      'C1',
      'final',
      [
        'HG-candidate 1  [test-presence]  diff FOLLOWS an undocumented pattern',
        '  Pattern:    modules ship with no sibling test',
        '  Evidence:   `for f in src/*.ts; do test -f "${f%.ts}.test.ts"; done` → 4 hits in 4 files',
        '  Diff link:  `src/reader.ts:1` repeats it',
      ].join('\n'),
    );

    const summary = await runGate({ repo, home, card: 'C1', base, head: 'HEAD' });

    expect(summary.exit).toBe(1);
    expect(summary.verdict).toBe('fail');
    expect(summary.minted).toEqual([]);
    expect(summary.flagged).toHaveLength(1);
    expect(summary.flagged[0]).toContain('candidate:');
    expect(existsSync(join(repo, '.tribe/harness-gaps.jsonl'))).toBe(false);
  });

  test('an unresolvable base is exit 2 with a one-line typed refusal', async () => {
    const { repo, home } = buildFixture();
    writeReport(home, 'C1', 'final', CANDIDATE_BLOCK);
    await expect(
      runGate({ repo, home, card: 'C1', base: '0000000000000000000000000000000000000000', head: 'HEAD' }),
    ).rejects.toThrow('gap-gate');
  });
});

describe('gap-gate CLI', () => {
  test('runs with --repo given RELATIVE from a different cwd (the shape a person types)', async () => {
    const { repo, home, base } = buildFixture();
    writeReport(home, 'C1', 'final', CANDIDATE_BLOCK);

    const proc = Bun.spawnSync(
      ['bun', GATE, '--repo', basename(repo), '--home', home, '--card', 'C1', '--base', base],
      { cwd: dirname(repo), env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } },
    );

    expect(proc.exitCode).toBe(0);
    const summary = JSON.parse(proc.stdout.toString().trim());
    expect(summary.minted).toEqual(['G-001']);
    expect(existsSync(join(repo, '.tribe/harness-gaps.jsonl'))).toBe(true);
  });

  test('a missing required flag exits 2 with one stderr line and no stack trace', () => {
    const proc = Bun.spawnSync(['bun', GATE, '--card', 'C1']);
    expect(proc.exitCode).toBe(2);
    const err = proc.stderr.toString();
    expect(err.trim().split('\n')).toHaveLength(1);
    expect(err.startsWith('gap-gate: ')).toBe(true);
    expect(err).not.toContain('at ');
  });
});
