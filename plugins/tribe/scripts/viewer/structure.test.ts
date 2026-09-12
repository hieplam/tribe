import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = import.meta.dir;
const WORLD = ['fs', 'node:fs', 'node:fs/promises', 'child_process', 'node:child_process', 'http', 'node:http', 'https', 'node:https'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === 'node_modules') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) { out.push(...walk(rel)); continue; }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    out.push(rel);
  }
  return out;
}

/** `walk`, but returns `[]` instead of throwing when `dir` does not exist yet — `client/src/**`
 * is scanned by several rules below before task 22 has created it. */
function walkIfExists(dir: string): string[] {
  return existsSync(join(ROOT, dir)) ? walk(dir) : [];
}

/** Raw source of `file`, byte for byte — no comment-stripping. Used ONLY for the `process.env`
 * ban below: two prior rounds each hardened a hand-rolled comment stripper against one
 * adversarial input and left an adjacent one open (a glob string masquerading as a block
 * comment, F27; a quote inside a regex literal desynchronizing the scanner for the rest of the
 * file, F26). Scanning raw source instead fails in the SAFE direction: a `process.env` mention
 * inside a comment becomes a loud false POSITIVE — trivially resolved by rewording the comment
 * — rather than a silent false negative, which is what a comment-stripping scanner risks every
 * time it meets a new adversarial input it wasn't hardened against. */
function rawSourceOf(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

/** Every module specifier `source` actually depends on at runtime, found by asking Bun's own
 * transpiler to parse it (`Bun.Transpiler#scanImports`) instead of re-deriving JS/TS grammar by
 * hand. A hand-rolled scanner is a partial JS lexer forever one step behind the next adversarial
 * input (comment-in-string, F27; quote-in-regex-literal, F26) — a real parser has none of those
 * blind spots: static `import`, side-effect `import '…'`, dynamic `import(…)`, and `require(…)`
 * are all reported, in any quote form (single/double/backtick), regardless of what other syntax
 * (a regex literal, a comment, a nested string) surrounds them elsewhere in the file.
 * `import type { … } from '…'` is erased at compile time and is never a runtime dependency —
 * `scanImports` does not report it, which matches this wall's existing semantics. Takes raw
 * source directly (not a file path) so the SAME extraction the real-file rules use can also run
 * against a synthetic probe string below — "prove the wall bites" exercises this function, not a
 * copy of it. */
function importsOfSource(source: string, loader: 'ts' | 'js'): string[] {
  return new Bun.Transpiler({ loader }).scanImports(source).map((i) => i.path);
}

function importsOf(file: string, loader: 'ts' | 'js'): string[] {
  return importsOfSource(rawSourceOf(file), loader);
}

// -------------------------------------------------------------------------------------------
// PENDING_DELETION (Shaman Resolution B; plan Task 14 Step 4). Phase 1 cannot hard-green a rule
// whose subject is legacy code a LATER, NAMED task deletes or rewrites — these six files are
// exactly that, and each carries the task that ends its exception:
const PENDING_DELETION: string[] = [
  'serve.ts', // task 20 rewrite — becomes the Bun.serve composition root over fs.adapter/campaign.adapter
  'core/render.ts', // task 28 deletes the status-page renderer
  'core/derive.ts', // task 28 deletes the status-page renderer's decision core
  'adapters/scan.adapter.ts', // task 15 replaces with fs.adapter.ts + campaign.adapter.ts
  'adapters/poller.adapter.ts', // phase 2 rewrite — one poll loop per SSE stream (spec §6.2)
  'adapters/transcript.adapter.ts', // task 15 replaces with fs.adapter.ts
];
// The `.tribe` rule and the fs-allowlist wall exclude these files from their scan (the two rules
// the plan names explicitly). The no-bare-catch rule below ALSO excludes them: every one of the
// six already contains a bare `catch` predating this rule (`scan.adapter.ts` x4 — lines 67, 73,
// 86, 270; `poller.adapter.ts` x5 — `catch (err)` with no `instanceof`/re-throw; `transcript.
// adapter.ts` x4; `core/derive.ts` x1, line 65) — narrowing dead-end-in-weeks code that a NAMED
// task is about to delete wholesale would be effort spent on code with no future, and is outside
// this task's file scope besides. Every OTHER rule in this file (process.argv, process.env,
// no-`.adapter`-import, no-tools-import) applies to these six exactly like any other COVERED
// file — none of them currently violates any of those, so no further exception is needed.

/** §12.6 (7a): the wall's own scope, written as data so it is inspectable rather than implied. A
 * trailing slash marks a directory (walked recursively, `.ts` non-test files only, matching
 * `walk()`'s existing semantics); no slash marks one top-level file. */
const COVERED = ['core/', 'adapters/', 'serve.ts', 'client/src/'];
// Outside the wall entirely: `tools/` (one-off measurement scripts, never shipped in a request
// path) and `fixtures/`, `e2e/` (test scaffolding, which must write or it could not build a
// fixture). Not scanned by any rule below — the mechanical guard that keeps that honest is the
// separate "no import from tools/" rule.
const OUTSIDE = ['tools/', 'fixtures/', 'e2e/'];

/** Every runtime file `COVERED` names on this tree today. */
function coveredFiles(): string[] {
  const files: string[] = [];
  for (const entry of COVERED) {
    if (entry.endsWith('/')) {
      const dir = entry.slice(0, -1);
      if (existsSync(join(ROOT, dir))) files.push(...walk(dir));
    } else if (existsSync(join(ROOT, entry))) {
      files.push(entry);
    }
  }
  return files;
}

/** `files` with every `PENDING_DELETION` entry removed. */
function nonDoomed(files: string[]): string[] {
  return files.filter((f) => !PENDING_DELETION.includes(f));
}

// -------------------------------------------------------------------------------------------
// The allowlist wall (§12.6 (7), D16) — replaces the old zero-write denylist of eight call
// names, which left `Bun.write`, `createWriteStream`, `copyFile`, `truncate`, a write-mode
// `open`, and all of `fs/promises` open. Inverted, the rule is total: everything in
// `FS_MEMBER_UNIVERSE` that is not in `ALLOWED_FS_READS` is refused, so a new legitimate read
// primitive is added by extending `ALLOWED_FS_READS` deliberately — growth is a decision someone
// makes, never an omission nobody notices.

/** `node:fs` members `adapters/**` may call (spec §12.6 (7b)): bounded reads only. `openSync` is
 * allowed at the NAME level here; its read-only-FLAGS requirement is enforced separately by
 * `openSyncFlagViolations`, because the same name is legitimate for a read and refused for a
 * write depending on an argument, not on which module it came from. */
const ALLOWED_FS_READS = new Set(['readFileSync', 'openSync', 'readSync', 'closeSync', 'statSync', 'lstatSync', 'readdirSync', 'realpathSync']);

/** The known `node:fs` API surface, read and write members together — this is what makes the
 * refusal side of the allowlist total rather than a denylist of "the eight calls someone
 * remembered": any member of `node:fs` this file has never heard of does not reach this list
 * either way, but growth on the READ side is exactly `ALLOWED_FS_READS`, and everything else here
 * is refused unconditionally, regardless of import form (bare name or `fs.<member>`). */
const FS_MEMBER_UNIVERSE = [
  'readFileSync', 'openSync', 'readSync', 'closeSync', 'statSync', 'lstatSync', 'readdirSync', 'realpathSync',
  'writeFileSync', 'writeFile', 'readFile', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync',
  'rmdir', 'rmdirSync', 'rm', 'rmSync', 'rename', 'renameSync', 'unlink', 'unlinkSync',
  'copyFile', 'copyFileSync', 'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync',
  'chmod', 'chmodSync', 'chown', 'chownSync', 'symlink', 'symlinkSync', 'link', 'linkSync',
  'utimes', 'utimesSync', 'watch', 'watchFile', 'unwatchFile', 'createWriteStream', 'createReadStream',
  'write', 'writeSync', 'open', 'close', 'exists', 'existsSync', 'access', 'accessSync',
  'stat', 'lstat', 'readdir', 'realpath', 'mkdtemp', 'mkdtempSync',
];

/** A whole module refused everywhere in `COVERED`, regardless of which member is used —
 * importing it at all is the violation (spec §12.6 (7c)). `node:crypto`/`crypto` are here for a
 * different reason than the I/O modules: they are a non-deterministic RANDOMNESS source, and
 * `pure-core.md` bans randomness reached directly from core logic — a covered file that wants a
 * uuid or a random value must receive it as an injected input at the edge, never import the
 * generator itself. */
const BANNED_IMPORT_SPECIFIERS = ['node:fs/promises', 'fs/promises', 'node:child_process', 'child_process', 'node:net', 'net', 'node:http', 'http', 'node:https', 'https', 'node:crypto', 'crypto'];

/** The LOCAL names an `import … from 'node:fs'|'fs'` introduces, split by whether they are refused
 * outright. This is what makes the allowlist TOTAL rather than a denylist of remembered names, and
 * closes the two bypasses a raw-source universe scan leaves open:
 *   - an ALIAS (`import { writeFileSync as persist }`) — the raw call is `persist(`, a name the
 *     universe scan never heard of, so the binding is resolved to its ORIGINAL member instead; and
 *   - an UNLISTED member (`import { cpSync }`) — never in the enumerated universe, but refused here
 *     the moment its original name is not an allowlisted read.
 * `refusedLocals` are named/aliased bindings whose ORIGINAL member is not in `ALLOWED_FS_READS` —
 * importing one at all is the violation, independent of how (or whether) it is later called.
 * `namespaces` are `* as ns` and default (`import fs from 'node:fs'`) bindings — the whole module,
 * checked via `ns.<member>` member expressions by the caller. `import type …` is erased at compile
 * time and never a runtime dependency, so it is skipped entirely (matching `scanImports`). */
function fsImportBindings(source: string): { refusedLocals: string[]; namespaces: string[] } {
  const refusedLocals: string[] = [];
  const namespaces: string[] = [];
  const importRe = /import\s+([^;]*?)\s+from\s*['"`](?:node:)?fs['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source))) {
    const clause = m[1];
    if (/^\s*type\b/.test(clause)) continue; // `import type … from 'node:fs'` — erased, not a dep
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) namespaces.push(ns[1]);
    const braces = clause.match(/\{([^}]*)\}/);
    // A default import binds the whole module (fs's default export IS the namespace): a leading
    // identifier before any `{` or `*`.
    const def = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def && !ns && !braces) namespaces.push(def[1]);
    else if (def && (braces || ns) && clause.trimStart()[0] !== '{' && clause.trimStart()[0] !== '*') {
      namespaces.push(def[1]); // `import fs, { readFileSync } from 'node:fs'`
    }
    if (braces) {
      for (const part of braces[1].split(',')) {
        const t = part.trim();
        if (!t || /^type\b/.test(t)) continue; // inline `{ type Stats }` — erased
        const asMatch = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        const original = asMatch ? asMatch[1] : t;
        const local = asMatch ? asMatch[2] : t;
        if (!ALLOWED_FS_READS.has(original)) refusedLocals.push(local);
      }
    }
  }
  return { refusedLocals, namespaces };
}

/** Every refused fs access in `source`, by three complementary layers, all failing toward false
 * positives (this file's whole philosophy, stated in `rawSourceOf`'s comment above):
 *   (i)  a named/aliased import binding whose ORIGINAL member is not an allowlisted read — refused
 *        outright, so an alias or an unlisted member can no longer hide;
 *   (ii) a namespace/default fs binding's `ns.<member>` access whose member is not allowlisted —
 *        the member-expression scan spec §12.6 (7c) demands, now driven by the actual binding name
 *        rather than a hard-coded `fs.`; and
 *   (iii) the original defence-in-depth universe scan: any KNOWN non-read member reached as
 *        `<name>(` or `<x>.<name>(`, even absent a resolvable import binding above. */
function fsMemberViolations(source: string): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!seen.has(name)) { seen.add(name); bad.push(name); }
  };
  const { refusedLocals, namespaces } = fsImportBindings(source);
  for (const local of refusedLocals) push(local); // (i)
  for (const ns of namespaces) { // (ii)
    const re = new RegExp(`\\b${ns}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(source))) {
      if (!ALLOWED_FS_READS.has(mm[1])) push(mm[1]);
    }
  }
  for (const name of FS_MEMBER_UNIVERSE) { // (iii)
    if (ALLOWED_FS_READS.has(name)) continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(source)) push(name);
  }
  return bad;
}

/** `openSync` is allowlisted ONLY for a literal read-only flag (`'r'`) — spec §12.6 (7b). Any
 * other flag (`'w'`, `'a'`, `'r+'`, …) is refused, and so is a flags argument this raw-source
 * scanner cannot itself prove is `'r'` (a variable, a computed expression): the safe direction is
 * to flag what cannot be shown safe, never to trust it. */
function openSyncFlagViolations(source: string): string[] {
  const bad: string[] = [];
  const re = /\bopenSync\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const flag = m[1].match(/,\s*['"`]([^'"`]*)['"`]\s*$/);
    if (!flag || flag[1] !== 'r') bad.push(m[0]);
  }
  return bad;
}

/** `process.kill(pid, 0)` — signal `0`, literally — is the ONE permitted call, and ONLY inside
 * `adapters/campaign.adapter.ts` (spec §12.6 (7b), a liveness probe: the kernel performs only the
 * permission-and-existence check and sends nothing). Any other signal, or the same call from any
 * other file, is refused: the wall must be able to tell a probe from a real signal. */
function processKillViolations(label: string, source: string): string[] {
  const bad: string[] = [];
  const re = /\bprocess\.kill\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const args = m[1].split(',').map((a) => a.trim());
    const isZeroSignal = args.length === 2 && args[1] === '0';
    if (label !== 'adapters/campaign.adapter.ts' || !isZeroSignal) bad.push(m[0]);
  }
  return bad;
}

/** `Bun.write` is refused everywhere in `COVERED` (spec §12.6 (7c)); `Bun.serve` is permitted
 * ONLY in `serve.ts` — the single place the process binds a socket, and the composition root
 * rather than an adapter, so "adapters only" would be the wrong home for it (spec §12.6 (7b)). */
function bunViolations(label: string, source: string): string[] {
  const bad: string[] = [];
  if (/\bBun\.write\b/.test(source)) bad.push('Bun.write');
  if (label !== 'serve.ts' && /\bBun\.serve\b/.test(source)) bad.push('Bun.serve outside serve.ts');
  return bad;
}

/** Every allowlist violation `label` commits, given its `source` (spec §12.6 (7b)/(7c), D16).
 * Pure function of (path label, raw text) so the SAME matcher runs against a real file on disk
 * (via `rawSourceOf`) AND against a synthetic probe string below — "prove the wall bites"
 * exercises exactly this function, not a reimplementation of its logic. */
function allowlistViolations(label: string, source: string): string[] {
  const bad: string[] = [];
  const imports = importsOfSource(source, 'ts');

  for (const spec of imports) {
    if (BANNED_IMPORT_SPECIFIERS.includes(spec)) bad.push(`banned import: ${spec}`);
  }

  const importsFs = imports.includes('node:fs') || imports.includes('fs');
  if (importsFs && !label.startsWith('adapters/')) {
    bad.push('node:fs imported outside adapters/**');
  }

  for (const name of fsMemberViolations(source)) bad.push(`refused fs member: ${name}`);
  for (const call of openSyncFlagViolations(source)) bad.push(`openSync not read-only: ${call}`);
  for (const call of bunViolations(label, source)) bad.push(call);
  for (const call of processKillViolations(label, source)) bad.push(call);

  return bad;
}

/** Every module `source` imports from `tools/` — the rule that keeps the wall's OUTSIDE scope
 * from becoming a loophole (spec §12.6 (7a)): a measurement script the shipped server could
 * reach at runtime would be inside the wall in every sense that matters. */
function importsFromTools(source: string): boolean {
  return importsOfSource(source, 'ts').some((s) => s.includes('tools/'));
}

// -------------------------------------------------------------------------------------------
// fail-closed-edges obligation 1: no bare catch under core/** or adapters/**.

/** Every `catch` clause's body text in `source`, found by matching `catch`/`catch (ident)`
 * followed by `{` and depth-counting braces to the matching close. A body is only ever used to
 * check for the PRESENCE of `instanceof`/`throw`, so a false split inside a nested brace would
 * only make the rule MORE eager to flag — the same safe-direction philosophy as every other rule
 * in this file. */
function catchBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    bodies.push(source.slice(re.lastIndex, i - 1));
  }
  return bodies;
}

/** A `catch` is bare unless its FALL-THROUGH re-throws — i.e. the last statement of its body is a
 * `throw` (`fail-closed-edges` obligation 1). Presence of `instanceof` alone is not enough: a
 * catch may discriminate a known error and `return`, but any UNRECOGNISED error must reach a
 * `throw`, and the only way that path is guaranteed to re-throw is if the body's terminal
 * statement is itself a `throw`. So the rule is: the trimmed body must END with a `throw …`
 * statement. This flags `catch (e) { if (e instanceof X) return null; return null; }` — which
 * completes without re-throwing on an unmatched error — while passing the real core/** pattern
 * `if (e instanceof X) return null; throw e;`. It fails toward false positives (an inverted but
 * still-safe `if (!(e instanceof X)) throw e; return null;` is flagged even though it re-throws
 * first) — the same safe direction every rule in this file takes. */
function rethrowsOnFallThrough(body: string): boolean {
  return /\bthrow\b[^;{}]*;?\s*$/.test(body);
}

function bareCatchCount(source: string): number {
  return catchBodies(source).filter((body) => !rethrowsOnFallThrough(body)).length;
}

describe('viewer structural contract', () => {
  test('core/** never names a world-touching module, in any quote form or import form', () => {
    for (const f of walk('core')) {
      const imports = importsOf(f, 'ts');
      const bad = WORLD.filter((m) => imports.includes(m));
      expect({ file: f, bad }).toEqual({ file: f, bad: [] });
    }
  });

  test('adapters are value-imported only by serve.ts or other adapters, in any import form', () => {
    for (const f of walk('core')) {
      expect({ file: f, bad: importsOf(f, 'ts').filter((s) => s.includes('.adapter')) }).toEqual({ file: f, bad: [] });
    }
  });

  test('no ambient process.env read outside adapters/ and serve.ts', () => {
    // Extended (§12.6, task 14) to also cover client/src/** once it exists (task 22 creates it) —
    // today that adds nothing to walk('core'), because the directory is not there yet.
    for (const f of [...walk('core'), ...walkIfExists('client/src')]) {
      expect({ file: f, bad: /process\.env\b/.test(rawSourceOf(f)) }).toEqual({ file: f, bad: false });
    }
  });

  test('the browser client imports nothing at all, in any import form', () => {
    expect(importsOf('client/app.js', 'js')).toEqual([]);
  });

  test('process.argv appears only in serve.ts, across every file the wall covers (§12.6.5)', () => {
    for (const f of coveredFiles()) {
      const bad = f !== 'serve.ts' && /process\.argv\b/.test(rawSourceOf(f));
      expect({ file: f, bad }).toEqual({ file: f, bad: false });
    }
  });

  test('.tribe appears in source only inside adapters/campaign.adapter.ts (§9, §11.4) — PENDING_DELETION excepted', () => {
    for (const f of nonDoomed(coveredFiles())) {
      const bad = f !== 'adapters/campaign.adapter.ts' && rawSourceOf(f).includes('.tribe');
      expect({ file: f, bad }).toEqual({ file: f, bad: false });
    }
  });

  test('no file under the wall imports from tools/ (§12.6 (7a) — the scope fence, not a loophole)', () => {
    for (const f of nonDoomed(coveredFiles())) {
      expect({ file: f, bad: importsFromTools(rawSourceOf(f)) }).toEqual({ file: f, bad: false });
    }
  });

  test('no bare catch under core/** or adapters/** — every catch names its error or re-throws (fail-closed-edges obligation 1) — PENDING_DELETION excepted', () => {
    for (const f of nonDoomed([...walk('core'), ...walk('adapters')])) {
      expect({ file: f, bad: bareCatchCount(rawSourceOf(f)) }).toEqual({ file: f, bad: 0 });
    }
  });

  test('prove the catch wall bites: a discriminating catch that returns for the UNMATCHED path (no re-throw) is flagged (fail-closed-edges obligation 1)', () => {
    // Contains `instanceof`, so the old presence-of-a-keyword rule let it pass — yet an
    // unrecognised error completes this catch WITHOUT re-throwing. The fall-through must re-throw.
    const probe = 'try { risky(); } catch (e) {\n  if (e instanceof SyntaxError) return null;\n  return null;\n}\n';
    expect(bareCatchCount(probe)).toBeGreaterThan(0);
  });

  test('a discriminating catch whose fall-through re-throws passes clean (the real core/** pattern stays green)', () => {
    const probe = 'try { risky(); } catch (e) {\n  if (e instanceof SyntaxError) return null;\n  throw e;\n}\n';
    expect(bareCatchCount(probe)).toBe(0);
  });

  describe('the structural allowlist wall (§12.6 (7), D16) — replaces the old zero-write denylist', () => {
    test('every COVERED file (minus PENDING_DELETION) stays inside the read-only allowlist', () => {
      for (const f of nonDoomed(coveredFiles())) {
        expect({ file: f, bad: allowlistViolations(f, rawSourceOf(f)) }).toEqual({ file: f, bad: [] });
      }
    });

    test('process.kill(pid, 0) is permitted only in adapters/campaign.adapter.ts, and only with a literal 0', () => {
      expect(allowlistViolations('adapters/campaign.adapter.ts', 'process.kill(pid, 0);')).toEqual([]);
      expect(allowlistViolations('adapters/campaign.adapter.ts', 'process.kill(pid, 9);')).not.toEqual([]);
      expect(allowlistViolations('adapters/scan.adapter.ts', 'process.kill(pid, 0);')).not.toEqual([]);
    });

    test('Bun.serve is permitted only in serve.ts', () => {
      expect(allowlistViolations('serve.ts', 'Bun.serve({ fetch() {} });')).toEqual([]);
      expect(allowlistViolations('adapters/campaign.adapter.ts', 'Bun.serve({ fetch() {} });')).not.toEqual([]);
    });

    test('a read-only openSync passes clean', () => {
      const probe = "import { openSync } from 'node:fs';\nopenSync('/tmp/x', 'r');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).toEqual([]);
    });

    // "Prove the wall bites" (plan Task 14 Step 1): a wall never seen to fail is not known to
    // work. Each probe below is a REAL violation the allowlist must flag — the audit-lens set the
    // brief names, plus the two end-to-end, real-temp-file cases (Bun.write under a real
    // `adapters/`-labelled file; a tools/ import) written to `os.tmpdir()` and removed in
    // `finally`, so nothing under the real `COVERED` tree is ever touched.

    test('prove the wall bites: a namespace-import fs write is flagged', () => {
      const probe = "import * as fs from 'node:fs';\nfs.writeFileSync('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a node:fs/promises import is flagged', () => {
      const probe = "import { writeFile } from 'node:fs/promises';\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: Bun.write is flagged', () => {
      const probe = "await Bun.write('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a write-mode openSync is flagged', () => {
      const probe = "import { openSync } from 'node:fs';\nopenSync('/tmp/x', 'w');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: node:fs imported outside adapters/** is flagged even for a read-only member', () => {
      const probe = "import { readFileSync } from 'node:fs';\n";
      expect(allowlistViolations('core/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites, end to end: a real file on disk calling Bun.write is flagged, then removed', () => {
      const dir = mkdtempSync(join(tmpdir(), 'wall-probe-'));
      const file = join(dir, 'evil.ts');
      try {
        writeFileSync(file, "export function evil() { Bun.write('/tmp/x', 'y'); }\n");
        const source = readFileSync(file, 'utf8');
        expect(allowlistViolations('adapters/evil.ts', source)).not.toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('prove the wall bites: an ALIASED fs write import is flagged (the allowlist binds the local name, not the raw call text)', () => {
      // The old rule searched raw source for a finite universe of member names; renaming the
      // binding hid the write entirely. A true allowlist binds `persist` to `writeFileSync` and
      // refuses it because the ORIGINAL member is not a read.
      const probe = "import { writeFileSync as persist } from 'node:fs';\npersist('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: an UNLISTED fs member import is flagged (the allowlist is total, not a denylist of remembered names)', () => {
      // `cpSync` was never in the enumerated universe, so it slipped through. Under a true
      // allowlist, any imported fs member that is not an allowlisted read is refused.
      const probe = "import { cpSync } from 'node:fs';\ncpSync('/a', '/b');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: an UNLISTED namespace-member fs write under a non-fs alias is flagged', () => {
      const probe = "import * as sys from 'node:fs';\nsys.cpSync('/a', '/b');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a COVERED file importing node:crypto (a randomness source, pure-core.md) is flagged', () => {
      const probe = "import { randomUUID } from 'node:crypto';\n";
      expect(allowlistViolations('core/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites, end to end: a real file on disk importing from tools/ is flagged, then removed', () => {
      const dir = mkdtempSync(join(tmpdir(), 'wall-probe-'));
      const file = join(dir, 'evil.ts');
      try {
        writeFileSync(file, "import { measure } from '../tools/title-window.ts';\n");
        const source = readFileSync(file, 'utf8');
        expect(importsFromTools(source)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
