// deletion-guard.test.ts — the mechanical G5 proof (spec §11.4, plan Task 28).
//
// "Mechanical, so G5 is a test and not a claim." Six rules, run over the real tree on disk:
//   1. no code path can open a runner log (D6) — no `runs/` adjacent to `logs`;
//   2. none of the deleted status page's names/routes survive as a literal;
//   3. every §11.1 path (deleted outright) is ABSENT;
//   4. every §11.1b path (replaced in place) is PRESENT and carries its content marker;
//   5. `adapters/campaign.adapter.ts` is the only file naming `.tribe`;
//   6. the zero-write wall of §12.6 is an allowlist, not a denylist.
//
// Deferred by THIS task's brief, not by this file: `e2e/harness.ts`, `e2e/harness.test.ts` and
// `e2e/live-viewer.e2e.test.ts` are §11.1 paths task 30 deletes and rewrites against the new
// routes (§14) — they are excluded below, by name, everywhere that exclusion is needed, never
// silently. Task 28's own brief is explicit that these three staying red/present is the ONLY
// carve-out; nothing else in this file is exempted.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dir;

/** Files task 30 owns (deletes + rewrites against the new routes, §14). Not this task's to
 * delete (this task's brief: "The ONLY tsc/test red still allowed is `e2e/harness.ts`/
 * `e2e/harness.test.ts`") — so every rule below that would otherwise flag their CURRENT,
 * pre-rewrite content excludes them by name, with the reason recorded at each use site. */
const DEFERRED_TO_TASK_30 = ['e2e/harness.ts', 'e2e/harness.test.ts', 'e2e/live-viewer.e2e.test.ts'];

function rawSourceOf(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively — the scope §11.4 rules 1/2 name
 * ("over every non-test .ts/.tsx file in the package"). Same filter shape as `structure.test.ts`'s
 * own `walk` (skip `node_modules`, skip anything not `.ts`/`.tsx`, skip `.test.ts`/`.test.tsx`) —
 * duplicated rather than imported: `structure.test.ts` is itself a `*.test.ts` file that `bun
 * test` already discovers and loads on its own, and importing it as a module here would re-run
 * its top-level `describe`/`test` calls a SECOND time under this file's module instance, silently
 * double-registering roughly 150 assertions. A handful of small, pure, well-understood helpers
 * (this walker, the two comment scanners below) are duplicated instead — the alternative, a
 * shared non-test module both files import, would be a larger refactor than this task's brief
 * asks for (`Create: V/deletion-guard.test.ts` is the only file it names). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === 'node_modules') continue;
    const rel = dir === '.' ? entry : `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      out.push(...walk(rel));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(rel);
  }
  return out;
}

/** Every non-test `.ts`/`.tsx` file in the whole package — rules 1 and 2's scope, literally. */
function walkAll(): string[] {
  return walk('.');
}

/** `source` with every line comment and block comment removed, but every string/template literal
 * PRESERVED verbatim (identical algorithm to `structure.test.ts`'s `stripComments`, hardened
 * there against a `;` or a quote hiding inside a comment — F26/F27). A prose comment that
 * EXPLAINS a name's removal (e.g. `serve.ts`'s own `// --tribe-root is deleted (spec §10.2)`)
 * must not itself trip a guard about that name's reintroduction as CODE; a string literal that
 * spells a banned route as a real value should still be caught, so strings are kept. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          out += source[i];
          i++;
        }
        out += source[i];
        i++;
      }
      if (i < n) out += source[i];
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** `source` with comments AND strings blanked to a single space (identical algorithm to
 * `structure.test.ts`'s `stripCommentsAndStrings`) — used only by rule 6's `Bun`/`process.kill`
 * member scans, which must not fire on a capability name mentioned in prose (`core/paths.ts:29`
 * describes `Bun.hash/wyhash` in a comment) or inside an unrelated string. */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// Rule 1 (§11.4.1): no code path can open a runner log — D6 ("The viewer reads the Claude
// transcript ONLY... the viewer never reads it"). The runner's own log path is always built from
// two literal path segments, `runs` and `logs`, around a run-id
// (`plugins/tribe/scripts/runner/cli/main.ts:132`: `join(homeDir, 'runs', runId, 'logs')`); this
// checks for that shape reappearing anywhere in the viewer, LINE by line (a real path expression
// is always constructed on one line in this codebase — every existing runner call site is), over
// comment-stripped source so an explanatory mention (like this very paragraph, if it lived in the
// package) can't trip its own guard.

function runnerLogViolationLines(source: string): string[] {
  return stripComments(source)
    .split('\n')
    .filter((line) => line.includes('runs/') && line.includes('logs'));
}

describe('rule 1 (§11.4.1, D6): no code path opens a runner log — no runs/ adjacent to logs', () => {
  test('no non-test file in the package contains it', () => {
    for (const f of walkAll()) {
      expect({ file: f, bad: runnerLogViolationLines(rawSourceOf(f)) }).toEqual({ file: f, bad: [] });
    }
  });

  test('prove rule 1 bites: a reconstructed runner-log path is flagged', () => {
    const probe = 'const p = `${home}/runs/${runId}/logs/${file}`;\n';
    expect(runnerLogViolationLines(probe)).not.toEqual([]);
  });

  test('rule 1 does not fire on a doc comment discussing the SAME two words, once stripped', () => {
    const probe = '// never build a path through runs/ and logs — see D6\nexport const x = 1;\n';
    expect(runnerLogViolationLines(probe)).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// Rule 2 (§11.4.2): none of the deleted status page's names/routes survive as a literal.
//
// Two of the seven need more than a bare substring test, because the exact same characters
// legitimately occur in code this task must NOT touch or flag:
//   - `/live` is also the first five characters of `core/liveness.ts` and every file that
//     imports it (`./liveness.ts`) or mentions it in a comment — a REAL, kept module (D2), not
//     the deleted `/live` route. The check requires the next character NOT be a letter, so
//     `/live?repo=` (the old route) matches and `/liveness.ts` does not.
//   - `app.css` is also the last seven characters of the NEW client's real stylesheet import,
//     `./styles/app.css` (`client/src/main.tsx`) — no boundary on either side distinguishes a
//     bare basename from one nested under a directory (both end the string/token identically).
//     The old code always spelled it as a STANDALONE quoted literal (`io.readAsset('app.css')`,
//     `Record<'app.js' | 'app.css', string>`); the check requires the quoted string to be
//     EXACTLY `app.css` — nothing else inside the quotes — which is true of the old spelling and
//     false of `'./styles/app.css'`.
// `--tribe-root` is comment-only today (`serve.ts:52` explains its removal); scanning
// comment-stripped source is what keeps that explanatory sentence from tripping this same rule.
const BANNED: { name: string; test: (stripped: string) => boolean }[] = [
  { name: 'scanTribeRoot', test: (s) => /\bscanTribeRoot\b/.test(s) },
  { name: 'sessionTail', test: (s) => /\bsessionTail\b/.test(s) },
  { name: 'newestLog', test: (s) => /\bnewestLog\b/.test(s) },
  { name: '--tribe-root', test: (s) => /--tribe-root\b/.test(s) },
  { name: '/live', test: (s) => /\/live(?![A-Za-z])/.test(s) },
  { name: '/api/processes', test: (s) => /\/api\/processes\b/.test(s) },
  { name: 'app.css', test: (s) => /(['"`])app\.css\1/.test(s) },
];

describe('rule 2 (§11.4.2): none of the deleted status page names/routes survive as a literal', () => {
  for (const token of BANNED) {
    test(`no non-test file contains ${token.name} (deferred: ${DEFERRED_TO_TASK_30.join(', ')})`, () => {
      for (const f of walkAll()) {
        if (DEFERRED_TO_TASK_30.includes(f)) continue; // task 30's own scope — see file header
        const bad = token.test(stripComments(rawSourceOf(f)));
        expect({ file: f, bad }).toEqual({ file: f, bad: false });
      }
    });
  }

  test('prove rule 2 bites: each banned name/route is flagged when it actually appears as code', () => {
    expect(BANNED[0]!.test('scanTribeRoot(home);')).toBe(true);
    expect(BANNED[1]!.test('return status.sessionTail;')).toBe(true);
    expect(BANNED[2]!.test('const x = snapshot.newestLog;')).toBe(true);
    expect(BANNED[3]!.test("if (arg === '--tribe-root') fail();")).toBe(true);
    expect(BANNED[4]!.test('`/live?repo=${r}`')).toBe(true);
    expect(BANNED[5]!.test('`/api/processes?repo=${r}`')).toBe(true);
    expect(BANNED[6]!.test("io.readAsset('app.css')")).toBe(true);
  });

  test('rule 2 does not false-positive on kept code that merely shares characters with a banned token', () => {
    // core/liveness.ts and every file importing it — a REAL, kept module (D2), not the /live route.
    expect(BANNED[4]!.test(stripComments("import { isLive } from './liveness.ts';\n"))).toBe(false);
    // the NEW client's real stylesheet, nested under styles/ — not the old top-level asset key.
    expect(BANNED[6]!.test(stripComments("import './styles/app.css';\n"))).toBe(false);
    // serve.ts's own comment explaining --tribe-root was deleted, not reintroducing it.
    expect(BANNED[3]!.test(stripComments('// `--tribe-root` is deleted (spec §10.2)\n'))).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// Rule 3 (§11.4.3, §11.1): every path deleted outright is ABSENT. `core/model.ts` is
// deliberately NOT in this list — it is replaced in place (§11.1b), and rule 3 must never be
// applied to it (a guard asserting "the path does not exist" would fail on the CORRECT outcome).
// `e2e/harness.ts`/`.test.ts`/`live-viewer.e2e.test.ts` are also not in this list: task 30 deletes
// them (this task's brief carve-out; see file header).
const DELETED_PATHS = [
  'core/derive.ts',
  'core/derive.test.ts',
  'core/render.ts',
  'core/render.test.ts',
  'core/live/model.ts',
  'core/live/model.test.ts',
  'adapters/scan.adapter.ts',
  'adapters/scan.adapter.test.ts',
  'core/live/page.ts',
  'core/live/page.test.ts',
  'core/live/campaign.ts',
  'core/live/campaign.test.ts',
  'client/app.js',
  'client/app.css',
  'client/app.test.ts',
  'fixtures/session-valid.jsonl',
  'fixtures/session-malformed.jsonl',
  'fixtures/subagent-valid.jsonl',
  'idle-timeout.integration.test.ts',
];

describe('rule 3 (§11.4.3, §11.1): every deleted-outright path is absent', () => {
  test('core/model.ts (replaced in place, §11.1b) is never in the deleted-outright list', () => {
    expect(DELETED_PATHS).not.toContain('core/model.ts');
  });

  test('the e2e harness trio (task 30\'s scope) is not asserted absent by THIS task', () => {
    for (const f of DEFERRED_TO_TASK_30) expect(DELETED_PATHS).not.toContain(f);
  });

  for (const path of DELETED_PATHS) {
    test(`${path} does not exist`, () => {
      expect(existsSync(join(ROOT, path))).toBe(false);
    });
  }
});

// -------------------------------------------------------------------------------------------
// Rule 4 (§11.4.4, §11.1b): every replaced-in-place path is PRESENT and carries its content
// marker. `core/model.ts` forces the split from rule 3: the old 69-line status-page model is
// gone and a NEW `core/model.ts` sits at the same path carrying §4's wire contract — proved by
// what it now EXPORTS at runtime, never by the path's mere existence (which the old file would
// also have satisfied) and never by its absence (which rule 3 would wrongly assert).
const REPLACED_PATHS = [{ path: 'core/model.ts', marker: 'RENDER_NODE_KINDS' }];

describe('rule 4 (§11.4.4, §11.1b): every replaced-in-place path is present and carries its content marker', () => {
  for (const { path, marker } of REPLACED_PATHS) {
    test(`${path} exists and exports ${marker}`, () => {
      expect(existsSync(join(ROOT, path))).toBe(true);
    });

    test(`${path} really exports ${marker} at runtime (the witness itself, not a text match)`, async () => {
      const mod = (await import(`./${path}`)) as Record<string, unknown>;
      expect(mod[marker]).not.toBeUndefined();
    });
  }
});

// -------------------------------------------------------------------------------------------
// Rules 5 and 6 share the wall's own scope (§12.6 (7a) / D18): `core/**`, `adapters/**`,
// `serve.ts`, `client/src/**` — runtime code. Both mirror `structure.test.ts`'s already-audited
// precedent for the SAME two claims, scoped identically (COVERED, not "every file in the
// package") — `fixtures/**`/`e2e/**`/`tools/**` are test scaffolding that legitimately builds a
// `.tribe`-shaped fixture tree and is explicitly OUTSIDE the wall.
const COVERED_DIRS = ['core', 'adapters', 'client/src'];
const COVERED_FILES = ['serve.ts'];

function coveredFiles(): string[] {
  const files: string[] = [];
  for (const dir of COVERED_DIRS) {
    if (existsSync(join(ROOT, dir))) files.push(...walk(dir));
  }
  for (const f of COVERED_FILES) {
    if (existsSync(join(ROOT, f))) files.push(f);
  }
  return files;
}

// -------------------------------------------------------------------------------------------
// Rule 5 (§11.4.5, §9): `adapters/campaign.adapter.ts` is the only COVERED file naming `.tribe`.
function tribeViolation(file: string, source: string): boolean {
  return file !== 'adapters/campaign.adapter.ts' && source.includes('.tribe');
}

describe('rule 5 (§11.4.5, §9): adapters/campaign.adapter.ts is the only file naming .tribe', () => {
  test('no other COVERED file contains it', () => {
    for (const f of coveredFiles()) {
      expect({ file: f, bad: tribeViolation(f, rawSourceOf(f)) }).toEqual({ file: f, bad: false });
    }
  });

  test('prove rule 5 bites: a .tribe mention outside campaign.adapter.ts is flagged, inside it is not', () => {
    expect(tribeViolation('core/probe.ts', 'const root = join(home, ".tribe");')).toBe(true);
    expect(tribeViolation('adapters/campaign.adapter.ts', 'const root = join(home, ".tribe");')).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// Rule 6 (§11.4.6, §12.6 (7), D16): the zero-write wall is an ALLOWLIST — only the reads §12.6
// (7b) names are permitted; everything else on `node:fs`/`Bun`/`process.kill` is refused, by
// construction, rather than by a denylist of remembered call names. This is a lighter,
// independent re-check of the SAME claim `structure.test.ts` already enforces exhaustively
// (including aliasing/indirection hardening); it is not a replacement for that file, which
// remains the canonical, fully-hardened wall.
const ALLOWED_FS_READS = new Set(['readFileSync', 'openSync', 'readSync', 'closeSync', 'statSync', 'lstatSync', 'readdirSync', 'realpathSync']);
const BUN_FILE_READS = new Set(['text', 'arrayBuffer', 'bytes', 'stream', 'json']);
const BANNED_IMPORT_SPECIFIERS = [
  'node:fs/promises', 'fs/promises', 'node:child_process', 'child_process',
  'node:net', 'net', 'node:http', 'http', 'node:https', 'https', 'node:crypto', 'crypto',
];
// The `node:fs` write surface (spec §12.6 (7c)) — a defence-in-depth scan for a known write
// member reached as a literal call, regardless of import form. `close`/`open`/`write`/`exists`
// collide with unrelated DOM/JS APIs in general, but nothing under `COVERED` uses those bare
// names outside a `.test.ts` file today (client/src/useEventStream.ts already reaches
// `EventSource#close` through a computed key for exactly this reason — see its own comment).
const FS_WRITE_MEMBERS = [
  'writeFileSync', 'writeFile', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync',
  'rmdir', 'rmdirSync', 'rm', 'rmSync', 'rename', 'renameSync', 'unlink', 'unlinkSync',
  'copyFile', 'copyFileSync', 'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync',
  'chmod', 'chmodSync', 'chown', 'chownSync', 'symlink', 'symlinkSync', 'link', 'linkSync',
  'utimes', 'utimesSync', 'watch', 'watchFile', 'unwatchFile', 'createWriteStream',
  'write', 'writeSync', 'open', 'close', 'exists', 'existsSync', 'access', 'accessSync',
];

function loaderForLabel(label: string): 'ts' | 'tsx' {
  return label.endsWith('.tsx') ? 'tsx' : 'ts';
}

function importsOfSource(source: string, loader: 'ts' | 'tsx'): string[] {
  return new Bun.Transpiler({ loader }).scanImports(source).map((i) => i.path);
}

/** Every refused allowlist member `label`'s `source` reaches (spec §12.6 (7), D16) — the
 * self-contained re-check rule 6 asserts over every COVERED file. */
function wallViolations(label: string, source: string): string[] {
  const bad: string[] = [];
  const loader = loaderForLabel(label);
  const imports = importsOfSource(source, loader);

  for (const spec of imports) {
    if (BANNED_IMPORT_SPECIFIERS.includes(spec)) bad.push(`banned import: ${spec}`);
  }

  const importsFs = imports.includes('node:fs') || imports.includes('fs');
  if (importsFs && !label.startsWith('adapters/')) bad.push('node:fs imported outside adapters/**');

  const noComments = stripComments(source);
  const stmtRe = /\b(import|export)\b([^;]*?)\bfrom\s*['"`](?:node:)?fs['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(noComments))) {
    const keyword = m[1];
    const clause = m[2]!.trim();
    if (keyword === 'export') {
      bad.push('fs re-export (a re-exported member is not verifiable)');
      continue;
    }
    if (/^type\b/.test(clause)) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    if (!named) {
      bad.push('fs import is not a plain named import (namespace/default forms are refused)');
      continue;
    }
    for (const part of named[1]!.split(',')) {
      const t = part.trim();
      if (!t || /^type\b/.test(t)) continue;
      const asMatch = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      const original = asMatch ? asMatch[1]! : t;
      if (!ALLOWED_FS_READS.has(original)) bad.push(`refused fs member: ${original}`);
    }
  }
  for (const imp of new Bun.Transpiler({ loader }).scanImports(source)) {
    if ((imp.path === 'node:fs' || imp.path === 'fs') && imp.kind !== 'import-statement') {
      bad.push(`fs reached via ${imp.kind} (only a static named import is verifiable)`);
    }
  }

  for (const name of FS_WRITE_MEMBERS) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(source)) bad.push(`refused fs member: ${name}`);
  }

  const openRe = /\bopenSync\s*\(([^)]*)\)/g;
  while ((m = openRe.exec(source))) {
    const flag = m[1]!.match(/,\s*['"`]([^'"`]*)['"`]\s*$/);
    if (!flag || flag[1] !== 'r') bad.push(`openSync not read-only: ${m[0]}`);
  }

  const s = stripCommentsAndStrings(source);

  const bunMemberRe = /\bBun\s*\.\s*([A-Za-z_$][\w$]*)/g;
  while ((m = bunMemberRe.exec(s))) {
    const member = m[1]!;
    if (member === 'serve') {
      if (label !== 'serve.ts') bad.push('Bun.serve outside serve.ts');
      continue;
    }
    if (member === 'file') continue;
    bad.push(`refused Bun capability: Bun.${member}`);
  }

  const fileRe = /\bBun\s*\.\s*file\s*\(/g;
  while ((m = fileRe.exec(s))) {
    let depth = 1;
    let i = fileRe.lastIndex;
    while (i < s.length && depth > 0) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      i++;
    }
    const rest = s.slice(i).replace(/^\s+/, '');
    const mm = rest.match(/^\.\s*([A-Za-z_$][\w$]*)/);
    if (mm && !BUN_FILE_READS.has(mm[1]!)) bad.push(`refused Bun.file(...) method: ${mm[1]}`);
  }

  const killRe = /\bprocess\s*\.\s*kill\s*\(([^)]*)\)/g;
  while ((m = killRe.exec(s))) {
    const args = m[1]!.split(',').map((a) => a.trim());
    const isZeroSignal = args.length === 2 && args[1] === '0';
    if (label !== 'adapters/campaign.adapter.ts' || !isZeroSignal) bad.push(`refused process.kill: ${m[0]}`);
  }

  return bad;
}

describe('rule 6 (§11.4.6, §12.6 (7), D16): the zero-write wall is an allowlist, not a denylist', () => {
  test('every COVERED file stays inside the read-only allowlist', () => {
    for (const f of coveredFiles()) {
      expect({ file: f, bad: wallViolations(f, rawSourceOf(f)) }).toEqual({ file: f, bad: [] });
    }
  });

  test('prove rule 6 bites: a namespace-import fs write is flagged', () => {
    const probe = "import * as fs from 'node:fs';\nfs.writeFileSync('/tmp/x', 'y');\n";
    expect(wallViolations('adapters/probe.ts', probe)).not.toEqual([]);
  });

  test('prove rule 6 bites: node:fs/promises is a banned import wholesale', () => {
    expect(wallViolations('adapters/probe.ts', "import { writeFile } from 'node:fs/promises';\n")).not.toEqual([]);
  });

  test('prove rule 6 bites: Bun.write is refused everywhere', () => {
    expect(wallViolations('adapters/probe.ts', "await Bun.write('/tmp/x', 'y');\n")).not.toEqual([]);
  });

  test('prove rule 6 bites: a write-mode openSync is refused', () => {
    const probe = "import { openSync } from 'node:fs';\nopenSync('/tmp/x', 'w');\n";
    expect(wallViolations('adapters/probe.ts', probe)).not.toEqual([]);
  });

  test('prove rule 6 bites: child_process is a banned import wholesale', () => {
    expect(wallViolations('adapters/probe.ts', "import { spawn } from 'node:child_process';\n")).not.toEqual([]);
  });

  test('prove rule 6 bites: process.kill with a non-zero signal is refused even in campaign.adapter.ts', () => {
    expect(wallViolations('adapters/campaign.adapter.ts', 'process.kill(pid, 9);')).not.toEqual([]);
  });

  test('process.kill(pid, 0) is permitted ONLY in adapters/campaign.adapter.ts', () => {
    expect(wallViolations('adapters/campaign.adapter.ts', 'process.kill(pid, 0);')).toEqual([]);
    expect(wallViolations('adapters/other.adapter.ts', 'process.kill(pid, 0);')).not.toEqual([]);
  });

  test('Bun.serve is permitted ONLY in serve.ts', () => {
    expect(wallViolations('serve.ts', 'Bun.serve({ fetch() {} });')).toEqual([]);
    expect(wallViolations('adapters/probe.ts', 'Bun.serve({ fetch() {} });')).not.toEqual([]);
  });

  test('a read-only openSync and a Bun.file(...) read method both pass clean', () => {
    const probe = "import { openSync } from 'node:fs';\nopenSync('/tmp/x', 'r');\nawait Bun.file('/tmp/y').text();\n";
    expect(wallViolations('adapters/probe.ts', probe)).toEqual([]);
  });

  test('a Bun capability mentioned only in a doc comment does not trip the wall', () => {
    const probe = '// e.g. Bun.hash/wyhash for cross-runtime parity\nexport const x = 1;\n';
    expect(wallViolations('core/probe.ts', probe)).toEqual([]);
  });
});
