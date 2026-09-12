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

/** The module specifiers that name `node:fs` under the two spellings a caller can write. Every
 * OTHER world module is refused wholesale (`BANNED_IMPORT_SPECIFIERS`); `node:fs`/`fs` are the one
 * partially-permitted module, so they alone need the strict-shape analysis in `fsViolations`. */
const FS_SPECIFIERS = ['node:fs', 'fs'];

/** The ONLY methods permitted on a `Bun.file(...)` result (spec §12.6 (7b)): bounded reads. Every
 * other method (`write`, `writer`, `delete`, `unlink`, …) is a write capability and is refused, and
 * so is ANY computed access (`Bun.file(x)[expr]`) — a computed member is not statically verifiable
 * as a read, so it fails closed, the same safe direction as every other rule in this file. */
const BUN_FILE_READS = new Set(['text', 'arrayBuffer', 'bytes', 'stream', 'json']);

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

/** Every refused `node:fs`/`fs` access in `source` — a TRUE allowlist for the covered set, total
 * across import/access FORM rather than a denylist of remembered spellings (spec §12.6 (7c), D16).
 * Enumerating bad forms failed twice; this instead permits exactly ONE form and refuses all else,
 * so a form nobody anticipated fails closed by default.
 *
 * The ONLY permitted way a covered file may touch fs is a STATIC NAMED import whose every name is
 * an allowlisted read: `import { readFileSync, statSync } from 'node:fs'`. The reasoning: a name
 * reached any other way is not statically verifiable as read-only.
 *   (a) `require(...)`, dynamic `import(...)`, and TS `import fs = require(...)` — reported by
 *       `scanImports` as `require-call`/`dynamic-import` kinds — are refused: what a runtime
 *       binding resolves to, and how it is later indexed, cannot be read off the source.
 *   (b) Every `import`/`export … from 'fs'` STATEMENT is classified. A re-export
 *       (`export { … } from 'fs'`), a namespace import (`* as fs`), a default import
 *       (`import fs from 'fs'`), or a default+named combo is refused — each hands out the whole
 *       module or a binding whose member access (including computed `fs['writeFileSync']`) cannot
 *       be verified. A plain `{ … }` named import is permitted only when every ORIGINAL name is an
 *       allowlisted read; `openSync` additionally may not be ALIASED, because its read-only-flag
 *       check (`openSyncFlagViolations`) scans the literal call `openSync(` and an alias would hide
 *       the call site from it.
 *   (c) A bare side-effect import (`import 'node:fs'`) is refused: it is not a named import.
 *   (d) Defence in depth: the original universe scan still flags any KNOWN non-read member reached
 *       as `<name>(` or `<x>.<name>(`, even with no resolvable import — so a global or injected
 *       binding cannot smuggle one past the shape rules above.
 * `import type … from 'fs'` is erased at compile time and never a runtime dependency, so it is
 * skipped (matching `scanImports`). Every layer fails toward false positives — the philosophy
 * stated in `rawSourceOf`'s comment above. */
function fsViolations(source: string): string[] {
  const bad: string[] = [];
  // (a) non-static-import forms of fs — require / dynamic import / TS import-equals.
  for (const imp of new Bun.Transpiler({ loader: 'ts' }).scanImports(source)) {
    if (FS_SPECIFIERS.includes(imp.path) && imp.kind !== 'import-statement') {
      bad.push(`fs reached via ${imp.kind} (only a static named import is verifiable)`);
    }
  }
  // (b) every `import`/`export … from 'fs'` statement, classified. `[^;]*?` keeps the match inside
  // one (semicolon-terminated) statement so a distant `from 'fs'` cannot swallow an earlier import.
  const stmtRe = /\b(import|export)\b([^;]*?)\bfrom\s*['"`](?:node:)?fs['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(source))) {
    const keyword = m[1];
    const clause = m[2].trim();
    if (keyword === 'export') { bad.push('fs re-export (a re-exported member is not verifiable)'); continue; }
    if (/^type\b/.test(clause)) continue; // `import type … from 'fs'` — erased, not a runtime dep
    const named = clause.match(/^\{([^}]*)\}$/);
    if (!named) { bad.push('fs import is not a plain named import (namespace/default forms are refused)'); continue; }
    for (const part of named[1].split(',')) {
      const t = part.trim();
      if (!t || /^type\b/.test(t)) continue; // inline `{ type Stats }` — erased
      const asMatch = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      const original = asMatch ? asMatch[1] : t;
      if (!ALLOWED_FS_READS.has(original)) { bad.push(`refused fs member: ${original}`); continue; }
      if (original === 'openSync' && asMatch) bad.push('openSync may not be aliased (its read-flag check scans the literal call site)');
    }
  }
  // (c) a bare side-effect import of fs — not a named import.
  if (/\bimport\s*['"`](?:node:)?fs['"`]/.test(source)) bad.push('fs side-effect import (not a named import)');
  // (d) defence-in-depth universe scan: any known non-read member reached as a call.
  for (const name of FS_MEMBER_UNIVERSE) {
    if (ALLOWED_FS_READS.has(name)) continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(source)) bad.push(`refused fs member: ${name}`);
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

/** `process.kill(pid, 0)` — signal `0`, LITERALLY — is the ONE permitted form, and ONLY inside
 * `adapters/campaign.adapter.ts` (spec §12.6 (7b), a liveness probe: the kernel performs only the
 * permission-and-existence check and sends nothing). The wall must be able to tell that probe from
 * a real signal, so it refuses every way of reaching `process.kill` that hides the signal argument
 * or the identity of the callee from this scanner:
 *   - a COMPUTED access on `process` (`process['kill'](pid, 9)`) — the member is not a literal, so
 *     the callee cannot be identified; refused everywhere;
 *   - `process.kill` referenced WITHOUT an immediate call (`const k = process.kill`) — the real
 *     call happens through a binding this scanner cannot follow; refused everywhere;
 *   - a literal `process.kill(...)` call with anything other than exactly two args ending in `0`,
 *     or from any file other than `campaign.adapter.ts`. */
function processKillViolations(label: string, source: string): string[] {
  const bad: string[] = [];
  if (/\bprocess\s*\[/.test(source)) bad.push('computed process[...] access (callee not a literal)');
  if (/\bprocess\s*\.\s*kill\b(?!\s*\()/.test(source)) bad.push('process.kill referenced without an immediate call (alias/assignment)');
  const re = /\bprocess\s*\.\s*kill\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const args = m[1].split(',').map((a) => a.trim());
    const isZeroSignal = args.length === 2 && args[1] === '0';
    if (label !== 'adapters/campaign.adapter.ts' || !isZeroSignal) bad.push(m[0]);
  }
  return bad;
}

/** Every refused `Bun` global access in `source` — total across access FORM (spec §12.6 (7b)/(7c)).
 *   - ANY COMPUTED access on the `Bun` global (`Bun['write']`) is refused everywhere: a computed
 *     member is not statically verifiable, so it fails closed.
 *   - `Bun.write` (a literal write) is refused everywhere.
 *   - `Bun.serve` is permitted ONLY in `serve.ts` — the single place the process binds a socket and
 *     the composition root, not an adapter.
 *   - On a `Bun.file(...)` result, only the literal READ methods in `BUN_FILE_READS` are permitted;
 *     any write method (`.write`/`.writer`/`.delete`/`.unlink`) or ANY computed access on the result
 *     is refused. */
function bunViolations(label: string, source: string): string[] {
  const bad: string[] = [];
  if (/\bBun\s*\[/.test(source)) bad.push('computed Bun[...] access');
  if (/\bBun\s*\.\s*write\b/.test(source)) bad.push('Bun.write');
  if (label !== 'serve.ts' && /\bBun\s*\.\s*serve\b/.test(source)) bad.push('Bun.serve outside serve.ts');
  // `Bun.file(...)` chains: inspect the member accessed on the result.
  const fileRe = /\bBun\s*\.\s*file\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(source))) {
    let depth = 1;
    let i = fileRe.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    const rest = source.slice(i).replace(/^\s+/, '');
    if (rest.startsWith('[')) { bad.push('computed access on a Bun.file(...) result'); continue; }
    const mm = rest.match(/^\.\s*([A-Za-z_$][\w$]*)/);
    if (mm && !BUN_FILE_READS.has(mm[1])) bad.push(`refused Bun.file(...) method: ${mm[1]}`);
  }
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

  for (const v of fsViolations(source)) bad.push(v);
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

/** `source` with every line comment, block comment, and string/template literal replaced by a
 * single space — so a `throw`, `instanceof`, or `;` that appears only INSIDE one of those cannot
 * be mistaken for code. A prior version of the catch rule text-scanned for a trailing `throw`
 * token and was satisfiable by a `throw` word buried in a comment or a string literal; stripping
 * them first closes that. The scanner honours backslash escapes inside quotes so an escaped quote
 * does not end the literal early; a template literal's `${…}` interior is stripped along with the
 * rest, which can only ever HIDE a real `throw` (making a catch look barer, a false positive) —
 * the safe direction this whole file takes. */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { // line comment
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') { // block comment
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { // string / template literal
      const quote = c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i++; // skip the char after a backslash
        i++;
      }
      i++; // skip the closing quote
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** A `catch` is bare unless its FALL-THROUGH re-throws UNCONDITIONALLY — the body's last statement
 * is a bare `throw <ident>;` (`fail-closed-edges` obligation 1). Presence of `instanceof` alone is
 * not enough: a catch may discriminate a known error and `return`, but any UNRECOGNISED error must
 * reach a `throw` on the fall-through, and the only way that is guaranteed is if the terminal
 * statement is itself an unconditional `throw` — not one guarded by an `if`, and not a `throw`
 * token that lives only in a comment or a string.
 *
 * So: strip comments and string literals first (`stripCommentsAndStrings`), then require the LAST
 * top-level statement (split on `;`) to be exactly `throw <ident>` — which is `false` for a
 * conditional `if (retryable) throw e;` (the last statement is the whole `if (…) throw e`, not a
 * bare `throw`) and for `return null;`. This passes the real core/** pattern
 * `if (e instanceof X) return null; throw e;` and flags every satisfiable-by-accident shape. It
 * fails toward false positives (an inverted-but-safe `if (!(e instanceof X)) throw e; return null;`
 * is flagged even though it re-throws first) — the same safe direction every rule here takes. */
function rethrowsOnFallThrough(body: string): boolean {
  const stripped = stripCommentsAndStrings(body);
  const statements = stripped.split(';');
  let last = '';
  for (let k = statements.length - 1; k >= 0; k--) {
    const t = statements[k].trim();
    if (t) { last = t; break; }
  }
  return /^throw\s+[A-Za-z_$][\w$]*$/.test(last);
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

  // The catch wall must not be satisfiable by a `throw` token that never runs. Three ways to write
  // one (fail-closed-edges obligation 1): the token inside a comment, inside a string literal, or
  // inside a CONDITIONAL that the unrecognised-error path can skip. Each must be flagged.
  test('prove the catch wall bites: a `throw` that appears ONLY inside a line comment is flagged', () => {
    const probe = 'try { risky(); } catch (e) {\n  return null; // throw e\n}\n';
    expect(bareCatchCount(probe)).toBeGreaterThan(0);
  });

  test('prove the catch wall bites: a `throw` that appears ONLY inside a string literal is flagged', () => {
    const probe = 'try { risky(); } catch (e) {\n  logger("please throw e");\n}\n';
    expect(bareCatchCount(probe)).toBeGreaterThan(0);
  });

  test('prove the catch wall bites: a CONDITIONAL throw as the last statement (the unmatched path can skip it) is flagged', () => {
    const probe = 'try { risky(); } catch (e) {\n  if (e instanceof SyntaxError) return null;\n  if (retryable) throw e;\n}\n';
    expect(bareCatchCount(probe)).toBeGreaterThan(0);
  });

  test('the real core/** pattern (discriminate, then an UNCONDITIONAL bare `throw e;`) still passes clean', () => {
    const probe = 'try { risky(); } catch (e) {\n  if (e instanceof SyntaxError) return null;\n  throw e;\n}\n';
    expect(bareCatchCount(probe)).toBe(0);
    // ...and with a comment mentioning throw ABOVE the real unconditional throw, still clean.
    const withComment = 'try { risky(); } catch (e) {\n  // fall through: re-throw anything we do not recognise\n  if (e instanceof SyntaxError) return null;\n  throw e;\n}\n';
    expect(bareCatchCount(withComment)).toBe(0);
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

    // -------------------------------------------------------------------------------------------
    // TOTALITY (§12.6 (7c), D16): the allowlist must be a TRUE allowlist for the covered set — it
    // fails CLOSED for EVERY way of reaching a world capability, not the common spellings only.
    // The only permitted fs shape is a STATIC NAMED import of read members; every other import or
    // access form of a world capability is refused, alias-/syntax-independent. Each probe below is
    // a bypass a fresh audit proved still open; the wall must flag all of them.

    test('prove the wall bites: a re-export of a world fs member is flagged', () => {
      const probe = "export { writeFileSync } from 'node:fs';\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a destructuring require of node:fs is flagged', () => {
      const probe = "const { writeFileSync } = require('node:fs');\nwriteFileSync('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a namespace require of node:fs is flagged', () => {
      const probe = "const fs = require('node:fs');\nfs.writeFileSync('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a dynamic import() of node:fs is flagged', () => {
      const probe = "const fs = await import('node:fs');\nfs.writeFileSync('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a COMPUTED member access on an fs namespace binding is flagged', () => {
      const probe = "import * as fs from 'node:fs';\nfs['writeFileSync']('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a TypeScript import-equals require of node:fs is flagged', () => {
      const probe = "import fs = require('node:fs');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: aliasing openSync (which hides its write-flag call from the flag scanner) is flagged', () => {
      const probe = "import { openSync as raw } from 'node:fs';\nraw('/tmp/x', 'w');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a COMPUTED Bun global access (Bun[...]) is flagged', () => {
      const probe = "Bun['write']('/tmp/x', 'y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a write method on a Bun.file(...) result (.delete) is flagged', () => {
      const probe = "Bun.file('/tmp/x').delete();\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a writer on a Bun.file(...) result (.writer) is flagged', () => {
      const probe = "Bun.file('/tmp/x').writer();\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a COMPUTED member access on a Bun.file(...) result is flagged', () => {
      const probe = "Bun.file('/tmp/x')['write']('y');\n";
      expect(allowlistViolations('adapters/probe.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: an ALIASED process.kill (assigned to a binding) is flagged even in campaign.adapter.ts', () => {
      const probe = "const k = process.kill;\nk(pid, 9);\n";
      expect(allowlistViolations('adapters/campaign.adapter.ts', probe)).not.toEqual([]);
    });

    test('prove the wall bites: a COMPUTED process["kill"] is flagged even in campaign.adapter.ts', () => {
      const probe = "process['kill'](pid, 9);\n";
      expect(allowlistViolations('adapters/campaign.adapter.ts', probe)).not.toEqual([]);
    });

    // Legitimate current shapes that must STAY clean under the stricter rule (a rule that refuses
    // everything proves nothing):
    test('a Bun.file(...) READ method (.text) in an adapter passes clean', () => {
      expect(allowlistViolations('adapters/fs.adapter.ts', "const s = await Bun.file('/x').text();\n")).toEqual([]);
    });

    test('a static named import of a read member (readFileSync) in an adapter passes clean', () => {
      expect(allowlistViolations('adapters/fs.adapter.ts', "import { readFileSync } from 'node:fs';\nreadFileSync('/x', 'utf8');\n")).toEqual([]);
    });

    test('an UNALIASED read-flag openSync in an adapter passes clean', () => {
      expect(allowlistViolations('adapters/fs.adapter.ts', "import { openSync } from 'node:fs';\nopenSync('/x', 'r');\n")).toEqual([]);
    });
  });
});
