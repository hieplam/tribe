# Plan C1 — `gap-gate-scripts`: the harness-gap gate and its mechanical checks

**Card:** `gap-gate-scripts` (campaign `gap-gate-2026-09-10`, card C1)
**Spec (the contract):** `docs/superpowers/specs/2026-09-10-tribe-harness-gap-gate-design.md` (CU-4) — §2, §3, §8 govern this card.
**Repo:** `/Users/hip/repo/tribe`, branch base `master` @ `dc011f9`.
**Author:** Warchief (planning-only dispatch), 2026-09-10.

Baselines measured on `master` @ `dc011f9` before any task runs (every "expected" below is relative to these):

- `cd plugins/tribe/scripts/gaps && bun test` → `76 pass, 0 fail` (7 files, ~4 s)
- `cd plugins/tribe/scripts/runner && bun test` → `645 pass, 0 fail` (26 files, ~212 s — budget 4 minutes per run)
- `C3X_MODE=agent bash "$C3X" check` → `total: 47`, `ok: true`

## Global Constraints

Campaign standing constraints (verbatim from the dispatch — do not paraphrase):

- Implementer: every task is dispatched to the `hunter` subagent (Task tool, `subagent_type: hunter`, `model: sonnet` — owner ruling 2026-09-10 "Claude Sonnet do the work"), one task per Hunter, strict TDD, never written inline by the Warchief.
- Audit cell: owner ruling 2026-09-10 — the review/audit work is done by GPT-5.6 Sol through Codex, not by Claude skinners. For every audit round, build the two lens briefs exactly as your dual-skinner law prescribes (contract lens and cold lens, same content rules, same cold-brief walls, each with its own report-file path) and, instead of dispatching `skinner`, run for each lens: `bash /Users/hip/.tribe/-Users-hip-repo-tribe/campaigns/gap-gate-2026-09-10/codex-audit.sh --lens <contract|cold> --worktree <worktree> --brief <brief-file> --report <report-file>` (exit 3 means the audit mutated the tree: reset the worktree with `git checkout -- . && git clean -fd` and re-run). Read the two report files and adjudicate them exactly as you would two skinner reports (routing table, conflict ladder, disposition ledger). The Tracker (step 6.0b) and the Scout survey stay Claude agents (`subagent_type: tracker` / `scout`).
- Tracker report files: every Tracker dispatch in this campaign carries a report-file path `<home>/reports/tracker-<card-slug>-<round>.md` (home = `$(bash plugins/tribe/scripts/tribe-home.sh /Users/hip/repo/tribe)`), and the brief tells the Tracker to write its full report there via Bash heredoc as its last act. (This is the convention the campaign is shipping; it applies to the campaign's own PRs too.)
- Ledger policy A (owner, 2026-09-10): `.tribe/harness-gaps.jsonl` lives in the target repo and is committed.
- Every commit carries `Tribe-Card: gap-gate-scripts`, the task/milestone trailer, and `Campaign: gap-gate-2026-09-10`. Never a Co-Authored-By.
- Tests: `cd plugins/tribe/scripts/gaps && bun test`, `cd plugins/tribe/scripts/runner && bun test`, the verify-shipped test suite, and `bash plugins/tribe/scripts/tests/test-*.sh` (only the suites touched or the pre-gate sweep) green before every commit. Pure core / impure edge per ~/.claude/rules/pure-core.md; edges fail closed per ~/.claude/rules/fail-closed-edges.md (timeouts on every spawn, GIT_CONFIG_GLOBAL/SYSTEM isolation, narrow catches, typed refusals, path containment for the registry path).
- Fixtures mirror reality (~/.claude/rules/fixtures-mirror-reality.md): at least one gate test passes `--repo` as a RELATIVE path from a different cwd; the gate's tests build the fixture from an EMPTY directory, not from a pre-built tree.

Warchief standing lines (verbatim, so this plan carries them even if another orchestrator runs it):

- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic implementer.
- Purity: core logic stays deterministic and side-effect-free; every outside-world dependency (database, network, filesystem, clock, random, global state) enters through an abstraction injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).

Task-specific constraints (added by this plan):

- **The plan is the contract.** Every wire format this card ships (the stamp line, the exit codes, the JSON summary keys, the parser's field-mapping rules) is FROZEN in the "Frozen contracts" section below. A Hunter never re-derives one of them from the spec's prose; where the two could be read differently, the frozen contract wins and the spec sentence it realises is quoted next to it.
- **Trailers.** Each task's commit carries exactly these three trailer lines in ONE final paragraph: `Tribe-Card: gap-gate-scripts`, `Tribe-Task: N/7`, `Campaign: gap-gate-2026-09-10`.
- **Checkbox ticking is atomic with the code.** A task ticks its own `- [ ]` boxes in this plan file in the SAME commit as its code. This plan file lives under `~/.tribe/`, NOT in the repo — so the Hunter ticks it with an ordinary file edit and does not add it to the commit; the commit's trailers are the authoritative done-record (git history is ground truth).
- **Never touch another task's files.** Each task lists its `owns_files`; a Hunter that needs a file outside its list stops and reports `NEEDS_CONTEXT`.
- **`bun test` is the only test runner for TypeScript**; shell suites are plain `bash`. No new dependency may be added to any `package.json`.
- **No `.tribe/harness-gaps.jsonl` is created in this repo by any Hunter.** Tests write ledgers into throwaway temp dirs only. (The card's own PR will commit one only if its gate run actually mints — that is the Warchief's step 7, not a task.)
- **Bash scripts** carry `set -euo pipefail` (`rule-bash-strict-mode`) and must run under macOS `/bin/bash` 3.2 (no `declare -A`, no empty-array expansion under `set -u`).
- **`.c3/` is read and written through the c3x wrapper only** — never `Read`/`Edit` on a `.c3/` instance file. Resolve the wrapper once per shell: `C3X=/Users/hip/.claude/plugins/cache/c3-skill-marketplace/c3-skill/11.6.3/skills/c3/bin/c3x.sh` and invoke `C3X_MODE=agent bash "$C3X" <cmd>`. Authoring patch files under `.c3/changes/<adr-id>/` with an editor IS the sanctioned path (they are change material, not facts).

## Oracle

The spec file named above is the contract for every parser/gate/stamp decision, as narrowed by the "Frozen contracts" section of this plan.

- **Under-parsing a real Tracker report shape (silently missing a candidate that exists) is a bug.**
- **Over-collecting is by design**: a block the parser cannot map completely is reported under `unparsed` with its file and line, and never aborts the gate.
- When in doubt, **the gate runs and reports rather than aborts**, except for the three exit-2 setup conditions frozen below.
- CommonMark, and any external Markdown standard, is NOT the oracle. The three report shapes quoted in "Frozen contracts / the three real HG-candidate shapes" are.

## Adjudication rule — REFUTED in advance (do not plan or perform work for these)

- The five inherited edge-hardening items of spec §9 (timeouts on the other four `Bun.spawn` sites, host-git-config isolation in `debt-tree.ts`, `gap-precision.ts` `main` try/catch, the `hits_now`-vs-`hits_at_detection` scope mismatch) on scripts this card does not otherwise touch. Filed as a separate follow-up card.
- The unapplied CU-2/CU-3 change-unit patches (card C2 reconciles them).
- Any finding that the Tracker prompt still lacks a report-file path (card C2).
- `c3-217`'s pre-existing Purpose / Business Flow wording about a squash-merge check the script no longer performs: pre-existing drift, outside this card's fence (this card patches the Contract row only).
- `plugins/verify-shipped/scripts/tests/test-verify-shipped.sh` is not swept by `pre-gate.sh` (which takes one `--tests-dir`). That is a known pre-gate limitation, recorded as a follow-up; this plan compensates by naming the suite explicitly in the Global Constraints and in every task that touches it.

## Frozen contracts

Everything in this section is decided. A Hunter implements it literally.

### F1 — the stamp line (spec §2 step 6)

Spec §2 step 6's template, quoted verbatim:

```
<!-- gap-gate v1 card=<slug> base=<sha> head=<sha> minted=G-004,G-005 matched=G-001 debt-delta=0 ledger=<sha256 of the ledger after this run> -->
```

Frozen refinements (the spec's example shows only the non-empty case):

- Field order is exactly `card base head minted matched debt-delta ledger`, single-space separated, one leading and one trailing space inside the comment delimiters.
- An EMPTY id list renders as the literal `none` (never an empty value, which would collapse two separators into one).
- `debt-delta` is the **sum** of every `diffDebt` entry's `delta` (may be negative or zero).
- `ledger` is the lowercase hex sha256 of the registry file's bytes **after** this run, or the literal `none` when no registry file exists after the run.
- Canonical example (both the formatter's and every parser's test fixture — reproduce this literal byte-for-byte in Task 3, Task 5 and Task 6):

```
<!-- gap-gate v1 card=gap-gate-scripts base=aaaa111 head=bbbb222 minted=G-004,G-005 matched=G-001 debt-delta=0 ledger=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->
```

- The recognizing regex, identical in intent in all three readers (TypeScript twice, Python once):

```
<!--\s*gap-gate v1\s+card=(\S+)\s+base=(\S+)\s+head=(\S+)\s+minted=(\S+)\s+matched=(\S+)\s+debt-delta=(-?\d+)\s+ledger=(\S+?)\s*-->
```

The lazy `(\S+?)` on `ledger` is load-bearing: a greedy `\S+` swallows a `-->` that follows with no space.

### F2 — `gap-gate.ts` exit codes (spec §2 step 7)

| Exit | Meaning | Triggers |
| --- | --- | --- |
| 0 | green, PR may open | everything else, including zero parsed candidates |
| 1 | red | any `diffDebt` entry with `delta > 0`, **or** any candidate/entry with a rejected (unsafe) fingerprint |
| 2 | setup error | (a) zero `tracker-<card>-*.md` files; (b) the `base...head` range does not resolve in `--repo`; (c) the ledger is unreadable or has a bad line; (d) a missing/invalid required flag; (e) the registry path escapes `--repo` |

Every exit-2 path prints ONE line on stderr of the form `gap-gate: <reason>` and never a stack trace. The exit-2 message for (a) is frozen verbatim by the spec:

> `no Tracker report for card <slug>: step 6.0b never ran, or the report path was wrong`

### F3 — candidate fingerprint validation happens BEFORE `reconcile()`

Spec §2 step 7 makes "a flagged (unsafe) fingerprint on a candidate this diff introduced" a red gate. Frozen consequence: the gate runs `validateFingerprint()` over every parsed candidate first; a candidate whose fingerprint is rejected is **excluded from the `reconcile()` call** (so an unexecutable fingerprint is never frozen into the ledger), is reported under `flagged` with the prefix `candidate:`, and makes the gate exit 1.

### F4 — the three real HG-candidate shapes the parser must handle

Shape A — the `agents/tracker.md` step-5 template, and the real report at `~/.tribe/-private-tmp-gap-repro-0lZQr5-repo/campaigns/repro-before-fix/reports/C1.md:323-337` (labelled fields, hanging indentation):

```
HG-candidate 1  [input-validation]  diff FOLLOWS an undocumented pattern
  Pattern:    `JSON.parse(input).value as string` is a compile-time type assertion, not a
              runtime check. If `input` parses as valid JSON but has no `value` field, no
              exception is thrown and the fallback is never reached.
  Evidence:   `grep -rn "as string" src/` → 4 hits in 4 files (`src/loader.ts:4`,
              `src/parser.ts:4`, `src/reader.ts:4`, `src/writer.ts:4`)
  Diff link:  `src/reader.ts:4` repeats it (copied from `src/loader.ts:4`)
  Not judged: this is a gap in the rule set, not a violation
```

Shape B — the bold-header, inline-prose form (tribe session `56af20da`, quoted in `docs/superpowers/evidence/2026-09-10-gap-loop-fix/verification.md` C5):

```
**HG-candidate 1 [error-handling]** — bare catch { } blocks that collapse multiple distinct failure modes into one silent sentinel, e.g. plugins/explaining/skills/explaining/scripts/validate-mermaid.ts:180,190,285,314,325. Confirmed via grep -rn "catch {" plugins/ → 10 non-test files / 22 occurrences repo-wide.
```

Shape C — the heading-prefixed, em-dash form with a non-`grep` evidence command (Kanna/tribe session `93fe0a83`, quoted in the same verification report C2):

```
### Harness gaps
HG-candidate 1 [test-presence] — every file under runner/adapters/ ships with no dedicated *.test.ts. Evidence: for f in adapters/*.ts; do [ -f "${f%.ts}.test.ts" ]; done → 5 hits in 5 files
```

Shape A and Shape B MUST parse into a candidate. Shape C MUST parse into a candidate too (its fingerprint is not a `grep`, so F3 flags it and the gate goes red — that is the designed behaviour, not a parse failure).

### F5 — the parser's field-mapping rules (spec §2 step 2)

Spec §2 step 2, quoted verbatim:

> `Category`→`category`, `Pattern`→`description`, the `Evidence` grep→`fingerprint`, its quoted hit count→`hits`, `Diff link` paths→`paths`

Frozen mechanics:

1. **Header.** A block starts at a line matching `/^\s*(?:\*\*)?HG-candidate\s+(\d+)\s*(?:\*\*)?\s*\[([^\]]+)\]\s*(?:\*\*)?/`. It ends at the next such line, the next Markdown ATX heading (`/^\s*#{1,6}\s/`), a line matching `/^\s*\+\d+\s+more suppressed/`, or end of text.
2. **Category** = capture group 2, trimmed, lowercased, with runs of whitespace or `/` replaced by a single `-`.
3. **Fields** are found by scanning the block text (the header line's remainder plus the following lines) for `/(?:^|\s)(Pattern|Evidence|Diff link|Not judged)\s*:/gi`; each label owns the text up to the next label or the block end. Labels may be line-anchored (Shape A) or inline (Shapes B and C).
4. **`description`** = the `Pattern` field, whitespace-collapsed. When no `Pattern` label exists, it is the block text before the first label (header remainder included), whitespace-collapsed. When that is also empty, it is the category.
5. **`fingerprint`** = from the `Evidence` field: the FIRST backtick-delimited span if there is one, else the field text up to the first `→` or `->`, else the whole field text. Whitespace-collapsed, trimmed. When there is no `Evidence` field or it yields an empty string, the block is `unparsed` with reason `no Evidence command`.
6. **`hits`** = the first integer in the `Evidence` field followed (after optional words) by `hit`/`hits`/`occurrence`/`occurrences`/`match`/`matches`/`file`/`files`, matched by `/(\d+)\s+(?:[A-Za-z-]+\s+){0,2}?(?:hits?|occurrences?|matches?|files?)\b/i`. No match → `0`.
7. **`paths`** = path-like tokens from the `Diff link` field; when there is no `Diff link` field, from the whole block text. A token is a backtick span or a bare run matching `/[A-Za-z0-9_.\-*]+(?:\/[A-Za-z0-9_.\-*]+)*\/?/` that contains at least one `/`; a trailing `:12` or `:180,190,285` suffix is stripped; results are de-duplicated in first-seen order. Empty → the block is `unparsed` with reason `no path in Diff link or block body`.
8. **`unparsed`** entries carry `{ file, line, reason, excerpt }`, where `line` is the 1-based line number of the header line and `excerpt` is the first 200 characters of the block.
9. **Dedup across rounds** (spec §2 step 2: "Candidates from different rounds with the same category and overlapping paths collapse to one, keeping the earliest round's fingerprint"): candidates are considered in ascending `roundOrder` index (the order the gate passes its report files in, which is `sort()` order of their filenames); a later candidate whose `category` equals an already-kept candidate's and whose `paths` overlap it is dropped. Overlap is `anyPathOverlap` from `paths.ts`.

### F6 — `gap-gate.ts` CLI and JSON summary

```
bun gap-gate.ts --repo <target-repo> --home <tribe-home> --card <card-slug> --base <merge-base-sha> \
                [--head HEAD] [--pr <n>] [--registry .tribe/harness-gaps.jsonl] [--out <home>/reports]
```

`--repo`, `--home`, `--card`, `--base` are required (no default). `--head` defaults to `HEAD`, `--registry` to `.tribe/harness-gaps.jsonl` (resolved against `--repo`), `--out` to `<home>/reports`. The JSON summary is printed as one line on stdout AND written to `<out>/<card>-gap-gate.json`, with exactly these keys:

```json
{"card":"C1","base":"aaaa111","head":"bbbb222","pr":0,"reports":["tracker-C1-final.md"],
 "candidates":[],"unparsed":[],"changed_files":[],"matched":[],"minted":[],
 "suppressed_count":0,"flagged":[],"open_ids":[],"debt_delta":0,"debt_entries":[],
 "ledger":"none","stamp":"<!-- gap-gate v1 ... -->","verdict":"pass","exit":0}
```

`open_ids` = `matched` concatenated with `minted`, de-duplicated, sorted.

### F7 — the `## Harness gaps` section `<out>/<card>-gap-gate.md`

Rendered by a pure function; the Warchief pastes it verbatim into the PR body. Exact shape:

```
## Harness gaps

- matched: G-001
- minted: none
- suppressed: 0
- flagged fingerprints: none
- open ids awaiting adjudication: G-001
- unparsed HG-candidate blocks: none
- proposals: pending Scout adjudication

<!-- gap-gate v1 card=... -->
```

An empty list renders as `none`. A `- debt burn-down:` line is inserted before `- proposals:` ONLY when `debt_delta != 0`: `net N fewer hit(s) than base` for a negative delta, `net N MORE hit(s) than base — gate red` for a positive one. `unparsed` renders one `  - <file>:<line> — <reason>` sub-bullet per entry when non-empty.

## Wave plan

| Wave | Tasks (concurrent) | Why they can share a wave |
| --- | --- | --- |
| 1 | Task 2, Task 3, Task 5, Task 6 | disjoint `owns_files`; none imports another's new module |
| 2 | Task 1 | needs `paths.ts`, created by Task 2 |
| 3 | Task 4 | needs Task 1's parser, Task 2's `--repo`, Task 3's stamp/render |
| 4 | Task 7 | the C3 Contract rows must describe the surfaces exactly as they finally shipped |

Estimated Hunter dispatches: **7** on a clean run (one per task); budget 10 with fix rounds.

## Tasks

### Task 1: `gap-candidates.ts` — the pure Tracker-report parser

`owns_files`: `plugins/tribe/scripts/gaps/gap-candidates.ts`, `plugins/tribe/scripts/gaps/gap-candidates.test.ts`.
Depends on: Task 2 (imports `anyPathOverlap` from `paths.ts`).
Contract: spec §2 step 2, as frozen in F4 and F5.

- [ ] **Step 1: Write the failing test.** Create `plugins/tribe/scripts/gaps/gap-candidates.test.ts` covering, at minimum, one test per numbered item below. Use the THREE literal report shapes of F4 verbatim as fixture strings (copy them out of this plan; do not paraphrase them).

```ts
// gap-candidates.test.ts — the pure Tracker-report parser (card C1, spec §2 step 2).
// Fixtures are the three REAL report shapes of the plan's F4, verbatim: the tracker.md step-5
// template (shape A, also the shape of reports/C1.md:323-337), the bold-header inline form
// (shape B, session 56af20da), and the heading-prefixed em-dash form with a non-grep evidence
// command (shape C, session 93fe0a83).
import { describe, expect, test } from 'bun:test';
import { dedupeCandidates, parseTrackerReport } from './gap-candidates.ts';

const SHAPE_A = [
  'HG-candidate 1  [input-validation]  diff FOLLOWS an undocumented pattern',
  '  Pattern:    `JSON.parse(input).value as string` is a compile-time type assertion, not a',
  '              runtime check. If `input` parses as valid JSON but has no `value` field, no',
  '              exception is thrown and the fallback is never reached.',
  '  Evidence:   `grep -rn "as string" src/` → 4 hits in 4 files (`src/loader.ts:4`,',
  '              `src/parser.ts:4`, `src/reader.ts:4`, `src/writer.ts:4`)',
  '  Diff link:  `src/reader.ts:4` repeats it (copied from `src/loader.ts:4`)',
  '  Not judged: this is a gap in the rule set, not a violation',
  '',
  '+0 more suppressed (only one HG candidate met all four conditions this run)',
].join('\n');

const SHAPE_B =
  '**HG-candidate 1 [error-handling]** — bare catch { } blocks that collapse multiple distinct ' +
  'failure modes into one silent sentinel, e.g. plugins/explaining/skills/explaining/scripts/' +
  'validate-mermaid.ts:180,190,285,314,325. Confirmed via grep -rn "catch {" plugins/ → 10 ' +
  'non-test files / 22 occurrences repo-wide.';

const SHAPE_C = [
  '### Harness gaps',
  'HG-candidate 1 [test-presence] — every file under runner/adapters/ ships with no dedicated',
  '*.test.ts. Evidence: for f in adapters/*.ts; do [ -f "${f%.ts}.test.ts" ]; done → 5 hits in 5 files',
].join('\n');

describe('parseTrackerReport', () => {
  test('shape A maps every field of spec §2 step 2', () => {
    const { candidates, unparsed } = parseTrackerReport(SHAPE_A, 'tracker-C1-final.md', 'final');
    expect(unparsed).toEqual([]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.category).toBe('input-validation');
    expect(c.fingerprint).toBe('grep -rn "as string" src/');
    expect(c.hits).toBe(4);
    expect(c.paths).toEqual(['src/reader.ts', 'src/loader.ts']);
    expect(c.description).toContain('compile-time type assertion');
    expect(c.round).toBe('final');
    expect(c.sourceFile).toBe('tracker-C1-final.md');
    expect(c.sourceLine).toBe(1);
  });

  test('shape B (bold header, inline Evidence, no Diff link) still parses', () => {
    const { candidates, unparsed } = parseTrackerReport(SHAPE_B, 'tracker-C1-task-5.md', 'task-5');
    expect(unparsed).toEqual([]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.category).toBe('error-handling');
    expect(c.fingerprint).toBe('grep -rn "catch {" plugins/');
    expect(c.hits).toBe(10);
    expect(c.paths).toContain('plugins/explaining/skills/explaining/scripts/validate-mermaid.ts');
  });

  test('shape C parses, and its non-grep fingerprint is preserved verbatim for the gate to flag', () => {
    const { candidates, unparsed } = parseTrackerReport(SHAPE_C, 'tracker-C1-wave-2.md', 'wave-2');
    expect(unparsed).toEqual([]);
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.category).toBe('test-presence');
    expect(c.hits).toBe(5);
    expect(c.fingerprint.startsWith('for f in adapters/*.ts')).toBe(true);
    expect(c.paths).toContain('runner/adapters/');
  });

  test('a header block with no Evidence is reported under unparsed, never dropped and never thrown', () => {
    const text = 'HG-candidate 1  [concurrency-async]  diff FOLLOWS an undocumented pattern\n  Pattern: fire and forget\n';
    const { candidates, unparsed } = parseTrackerReport(text, 'tracker-C1-final.md', 'final');
    expect(candidates).toEqual([]);
    expect(unparsed).toEqual([
      { file: 'tracker-C1-final.md', line: 1, reason: 'no Evidence command', excerpt: expect.any(String) },
    ]);
  });

  test('a header block whose Evidence names no path is reported under unparsed', () => {
    const text = 'HG-candidate 1 [error-handling] — Evidence: `grep -rn "catch" .` → 3 hits in 3 files\n';
    const { unparsed } = parseTrackerReport(text, 'tracker-C1-final.md', 'final');
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]!.reason).toBe('no path in Diff link or block body');
  });

  test('two candidates in one report are both returned, with their own header line numbers', () => {
    const text = `${SHAPE_A}\n\n${SHAPE_B}\n`;
    const { candidates } = parseTrackerReport(text, 'tracker-C1-final.md', 'final');
    expect(candidates).toHaveLength(2);
    expect(candidates[1]!.sourceLine).toBeGreaterThan(candidates[0]!.sourceLine);
  });

  test('a report with no HG-candidate block parses to nothing at all', () => {
    expect(parseTrackerReport('## Review\nVerdict: APPROVE\n', 'tracker-C1-final.md', 'final')).toEqual({
      candidates: [],
      unparsed: [],
    });
  });
});

describe('dedupeCandidates', () => {
  test('same category + overlapping paths collapse to the earliest round, keeping its fingerprint', () => {
    const a = parseTrackerReport(SHAPE_A, 'tracker-C1-task-3.md', 'task-3').candidates;
    const later = parseTrackerReport(
      SHAPE_A.replace('grep -rn "as string" src/', 'grep -rn "as string" src/reader.ts'),
      'tracker-C1-final.md',
      'final',
    ).candidates;
    const kept = dedupeCandidates([...a, ...later], ['task-3', 'final']);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.round).toBe('task-3');
    expect(kept[0]!.fingerprint).toBe('grep -rn "as string" src/');
  });

  test('same category but disjoint paths are two distinct candidates', () => {
    const one = parseTrackerReport(SHAPE_A, 'tracker-C1-task-3.md', 'task-3').candidates;
    const two = parseTrackerReport(
      SHAPE_A.replace(/src\//g, 'lib/').replace(/src/g, 'lib'),
      'tracker-C1-final.md',
      'final',
    ).candidates;
    expect(dedupeCandidates([...one, ...two], ['task-3', 'final'])).toHaveLength(2);
  });

  test('different categories over the same paths never collapse', () => {
    const one = parseTrackerReport(SHAPE_A, 'tracker-C1-task-3.md', 'task-3').candidates;
    const two = parseTrackerReport(
      SHAPE_A.replace('[input-validation]', '[error-handling]'),
      'tracker-C1-final.md',
      'final',
    ).candidates;
    expect(dedupeCandidates([...one, ...two], ['task-3', 'final'])).toHaveLength(2);
  });
});
```

Run it (expected: RED — the module does not exist):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test gap-candidates.test.ts
```

Expected output contains `error: Cannot find module './gap-candidates.ts'` and a non-zero exit.

- [ ] **Step 2: Implement `gap-candidates.ts`** — a PURE module (no `node:fs`, no `Bun.spawn`, no clock): every function is a function of its arguments. Implement exactly F5.

```ts
// gap-candidates.ts — pure parser for the Tracker's `HG-candidate` blocks (card C1, spec §2
// step 2). PURE MODULE: no fs, no subprocess, no clock — the gate's edge reads the files and
// hands the text in. Under-parsing a real report shape is a bug; a block that cannot be mapped
// completely is reported under `unparsed` and never aborts anything (plan Oracle).
import { anyPathOverlap } from './paths.ts';

export interface ParsedCandidate {
  category: string;
  paths: string[];
  fingerprint: string;
  hits: number;
  description: string;
  /** The `<round>` label of the report file this block came from (`task-3`, `wave-2`, `final`). */
  round: string;
  sourceFile: string;
  /** 1-based line of the block's header line, for the `unparsed`/debug trail. */
  sourceLine: number;
}

export interface UnparsedBlock {
  file: string;
  line: number;
  reason: string;
  excerpt: string;
}

export interface ParseResult {
  candidates: ParsedCandidate[];
  unparsed: UnparsedBlock[];
}

const HEADER_RE = /^\s*(?:\*\*)?HG-candidate\s+(\d+)\s*(?:\*\*)?\s*\[([^\]]+)\]\s*(?:\*\*)?/;
const HEADING_RE = /^\s*#{1,6}\s/;
const SUPPRESSED_RE = /^\s*\+\d+\s+more suppressed/;
const LABEL_RE = /(?:^|\s)(Pattern|Evidence|Diff link|Not judged)\s*:/gi;
const HITS_RE = /(\d+)\s+(?:[A-Za-z-]+\s+){0,2}?(?:hits?|occurrences?|matches?|files?)\b/i;
const PATH_TOKEN_RE = /[A-Za-z0-9_.\-*]+(?:\/[A-Za-z0-9_.\-*]+)*\/?/g;
const BACKTICK_SPAN_RE = /`([^`]+)`/;
/** A report that never writes the literal `Evidence:` label (shape B) still quotes the command
 * it ran; these are the command heads seen in the real reports. Under-parsing shape B would be
 * a bug (plan Oracle), so the command is recovered from the block text itself. */
const COMMAND_RE = /(?:^|\s)((?:grep|rg|find|ls|for)\b[^\n]*)/;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Splits the block text into its labelled fields. A label may be line-anchored (shape A) or
 * inline in a prose sentence (shapes B and C) — one scan handles both. */
function splitFields(blockText: string): Map<string, string> {
  const fields = new Map<string, string>();
  const marks: Array<{ key: string; start: number; end: number }> = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(blockText)) !== null) {
    marks.push({ key: m[1]!.toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!;
    const stop = i + 1 < marks.length ? marks[i + 1]!.start : blockText.length;
    if (!fields.has(mark.key)) fields.set(mark.key, blockText.slice(mark.end, stop));
  }
  if (marks.length > 0) fields.set('__preamble', blockText.slice(0, marks[0]!.start));
  else fields.set('__preamble', blockText);
  return fields;
}

/** The command a piece of text quotes: a backticked span first (shape A), else a run starting
 * at a known command head, truncated at the `→` that introduces the hit count (shapes B and C). */
function commandFrom(text: string): string {
  const span = BACKTICK_SPAN_RE.exec(text);
  if (span) return collapse(span[1]!);
  const cmd = COMMAND_RE.exec(text);
  if (cmd) return collapse(cmd[1]!.split(/→|->/)[0] ?? cmd[1]!);
  return '';
}

/** With an `Evidence:` label present, the field is authoritative (and its plain text up to `→`
 * is an accepted last resort). With NO label at all, only a real quoted command counts — prose
 * must never be mistaken for a fingerprint, or a block with no evidence would mint a gap whose
 * fingerprint can never re-fire. */
function fingerprintFrom(evidenceField: string | undefined, blockText: string): string {
  if (evidenceField === undefined) return commandFrom(blockText);
  const direct = commandFrom(evidenceField);
  if (direct.length > 0) return direct;
  return collapse(evidenceField.split(/→|->/)[0] ?? '');
}

function extractHits(evidence: string): number {
  const m = HITS_RE.exec(evidence);
  return m ? Number(m[1]) : 0;
}

function stripLineSuffix(token: string): string {
  return token.replace(/:\d+(?:,\d+)*$/, '');
}

function extractPaths(source: string): string[] {
  const out: string[] = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN_RE.exec(source)) !== null) {
    const raw = stripLineSuffix(m[0].replace(/[`,.)]+$/, ''));
    if (!raw.includes('/')) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/** Parses ONE Tracker report's text. `file`/`round` are carried through onto every candidate so
 * the gate can report where a candidate came from and dedupe by round order. */
export function parseTrackerReport(text: string, file: string, round: string): ParseResult {
  const lines = text.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (HEADER_RE.test(lines[i]!)) starts.push(i);

  const candidates: ParsedCandidate[] = [];
  const unparsed: UnparsedBlock[] = [];

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]!;
    let end = starts[s + 1] ?? lines.length;
    for (let i = start + 1; i < end; i++) {
      if (HEADING_RE.test(lines[i]!) || SUPPRESSED_RE.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    const headerMatch = HEADER_RE.exec(lines[start]!)!;
    const category = headerMatch[2]!.trim().toLowerCase().replace(/[\s/]+/g, '-');
    const headerRemainder = lines[start]!.slice(headerMatch[0].length);
    const blockText = [headerRemainder, ...lines.slice(start + 1, end)].join('\n');
    const excerpt = [lines[start]!, ...lines.slice(start + 1, end)].join('\n').slice(0, 200);

    const fields = splitFields(blockText);
    const evidenceField = fields.get('evidence');
    const fingerprint = fingerprintFrom(evidenceField, blockText);
    if (fingerprint.length === 0) {
      unparsed.push({ file, line: start + 1, reason: 'no Evidence command', excerpt });
      continue;
    }

    const diffLink = fields.get('diff link');
    const paths = extractPaths(diffLink !== undefined && diffLink.trim().length > 0 ? diffLink : blockText);
    if (paths.length === 0) {
      unparsed.push({ file, line: start + 1, reason: 'no path in Diff link or block body', excerpt });
      continue;
    }

    const pattern = fields.get('pattern');
    const preamble = fields.get('__preamble') ?? '';
    const description =
      collapse(pattern ?? '') || collapse(preamble) || category;

    candidates.push({
      category,
      paths,
      fingerprint,
      hits: extractHits(evidenceField ?? blockText),
      description,
      round,
      sourceFile: file,
      sourceLine: start + 1,
    });
  }

  return { candidates, unparsed };
}

/** Freeze-at-first-write (CU-2 M2, spec §2 step 2): candidates from different rounds with the
 * same category and overlapping paths collapse to ONE, keeping the earliest round's fingerprint.
 * `roundOrder` is the gate's report-file order (filename sort order); a candidate from a round
 * that is not in `roundOrder` sorts last. */
export function dedupeCandidates(
  all: readonly ParsedCandidate[],
  roundOrder: readonly string[],
): ParsedCandidate[] {
  const rank = (c: ParsedCandidate): number => {
    const idx = roundOrder.indexOf(c.round);
    return idx === -1 ? roundOrder.length : idx;
  };
  const ordered = [...all]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);

  const kept: ParsedCandidate[] = [];
  for (const candidate of ordered) {
    const duplicate = kept.some(
      (k) => k.category === candidate.category && anyPathOverlap(k.paths, candidate.paths),
    );
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}
```

Run it (expected: GREEN):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test && bunx tsc --noEmit
```

Expected: `0 fail` (the file count and pass count grow past the `76 pass` baseline by this task's tests); `tsc --noEmit` prints nothing and exits 0.

- [ ] **Step 3: Commit** — Tick this task's boxes in the plan file (not committed — it lives under `~/.tribe/`), then commit only the two owned files.

```bash
cd /Users/hip/repo/tribe && git add plugins/tribe/scripts/gaps/gap-candidates.ts plugins/tribe/scripts/gaps/gap-candidates.test.ts && \
git commit -m 'feat(gaps): pure parser for Tracker HG-candidate blocks' -m $'Tribe-Card: gap-gate-scripts\nTribe-Task: 1/7\nCampaign: gap-gate-2026-09-10'
```

Expected: one commit; `git log -1 --format='%(trailers)'` prints the three trailer lines and no `Co-Authored-By`.

### Task 2: `paths.ts`, `ledger.ts` typed parse error, `gap-reconcile.ts --repo` + typed refusals

`owns_files`: `plugins/tribe/scripts/gaps/paths.ts`, `plugins/tribe/scripts/gaps/paths.test.ts`, `plugins/tribe/scripts/gaps/ledger.ts`, `plugins/tribe/scripts/gaps/ledger.test.ts`, `plugins/tribe/scripts/gaps/gap-reconcile.ts`, `plugins/tribe/scripts/gaps/gap-reconcile.test.ts`.
Depends on: nothing (wave 1).
Contract: card item 3 + spec §2 step 4 + `~/.claude/rules/fail-closed-edges.md` obligations 1, 3, 4.

**Scope fence for this task, by intent:** every EXISTING test's assertions stay exactly as they are. `reconcile()`'s current behaviour when no `--repo`/`repo` is supplied stays byte-identical (that is what keeps the 76-test baseline green): `repo` is OPTIONAL, and only its presence switches on registry resolution, containment and the grep `cwd`.

- [ ] **Step 1: Write the failing tests.** Create `paths.test.ts`; APPEND to `ledger.test.ts` and `gap-reconcile.test.ts` (never edit an existing test in them).

```ts
// paths.test.ts — pure path-overlap predicates (card C1, extracted from gap-reconcile.ts).
import { describe, expect, test } from 'bun:test';
import { anyPathOverlap, pathsOverlap } from './paths.ts';

describe('pathsOverlap', () => {
  test('identical paths overlap', () => expect(pathsOverlap('src/a.ts', 'src/a.ts')).toBe(true));
  test('a directory contains a file below it, in both argument orders', () => {
    expect(pathsOverlap('src/', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('src/a.ts', 'src/')).toBe(true);
    expect(pathsOverlap('src', 'src/a.ts')).toBe(true);
  });
  test('a shared name prefix that is not a directory boundary does not overlap', () => {
    expect(pathsOverlap('src/a.ts', 'src/ab.ts')).toBe(false);
    expect(pathsOverlap('lib', 'library/a.ts')).toBe(false);
  });
});

describe('anyPathOverlap', () => {
  test('true when any pair overlaps', () =>
    expect(anyPathOverlap(['docs/x.md', 'src/'], ['README.md', 'src/a.ts'])).toBe(true));
  test('false for wholly disjoint lists, and for an empty list', () => {
    expect(anyPathOverlap(['docs/x.md'], ['src/a.ts'])).toBe(false);
    expect(anyPathOverlap([], ['src/a.ts'])).toBe(false);
  });
});
```

Append to `ledger.test.ts` (add `LedgerError` to the existing import from `./ledger.ts`):

```ts
describe('parseLedger typed refusals (card C1)', () => {
  test('a malformed JSON line raises LedgerError naming its 1-based line number', () => {
    const text = `${JSON.stringify(openedFixture)}\n{not json}\n`;
    expect(() => parseLedger(text)).toThrow(LedgerError);
    try {
      parseLedger(text);
    } catch (err) {
      expect((err as LedgerError).line).toBe(2);
      expect((err as LedgerError).message).toContain('ledger line 2');
    }
  });

  test('the reported line number counts blank lines, so it matches the file a human opens', () => {
    const text = `\n\n${JSON.stringify(openedFixture)}\n[]\n`;
    try {
      parseLedger(text);
      throw new Error('expected parseLedger to throw');
    } catch (err) {
      expect((err as LedgerError).line).toBe(4);
    }
  });

  test('a JSON object that is not a gap event is refused, not silently kept', () => {
    expect(() => parseLedger('{"id":"G-001","event":"invented"}\n')).toThrow(LedgerError);
    expect(() => parseLedger('{"event":"opened"}\n')).toThrow(LedgerError);
  });
});
```

Append to `gap-reconcile.test.ts` (extend its existing import to also bring in `GapReconcileError` and `resolveRegistryPath`):

```ts
describe('--repo resolution, containment and grep cwd (card C1, spec §2 step 4)', () => {
  test('a relative registry path resolves against repo, an absolute one inside repo is kept', () => {
    const repo = mkdtempSync(join(tmpdir(), 'gap-repo-'));
    expect(resolveRegistryPath('.tribe/harness-gaps.jsonl', repo)).toBe(join(repo, '.tribe/harness-gaps.jsonl'));
    expect(resolveRegistryPath(join(repo, '.tribe/harness-gaps.jsonl'), repo)).toBe(
      join(repo, '.tribe/harness-gaps.jsonl'),
    );
    rmSync(repo, { recursive: true, force: true });
  });

  test('a registry path that escapes --repo is a typed refusal, never a write outside the tree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'gap-repo-'));
    expect(() => resolveRegistryPath('../escape.jsonl', repo)).toThrow(GapReconcileError);
    rmSync(repo, { recursive: true, force: true });
  });

  test('with repo given, fingerprints run against the repo tree even though cwd is elsewhere', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'gap-repo-'));
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/a.ts'), 'try { x(); } catch {}\n');
    const registry = '.tribe/harness-gaps.jsonl';
    const opened: OpenedEvent = {
      id: 'G-001',
      event: 'opened',
      category: 'error-handling',
      paths: ['src/'],
      fingerprint: 'grep -rn "catch {}"',
      hits_at_detection: 1,
      first_seen_pr: 1,
    };
    mkdirSync(join(repo, '.tribe'), { recursive: true });
    writeFileSync(join(repo, registry), `${JSON.stringify(opened)}\n`);

    const result = await reconcile({
      registryPath: registry,
      repo,
      changedFiles: ['src/a.ts'],
      candidates: [],
    });

    expect(result.matched).toEqual(['G-001']);
    expect(result.minted).toEqual([]);
    const appended = parseLedger(readFileSync(join(repo, registry), 'utf8'));
    expect(appended).toHaveLength(2);
    expect(appended[1]).toMatchObject({ id: 'G-001', event: 'seen' });
    rmSync(repo, { recursive: true, force: true });
  });

  test('an unreadable ledger line surfaces as LedgerError, not as a bare JSON.parse throw', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'gap-repo-'));
    mkdirSync(join(repo, '.tribe'), { recursive: true });
    writeFileSync(join(repo, '.tribe/harness-gaps.jsonl'), 'not json at all\n');
    await expect(
      reconcile({ registryPath: '.tribe/harness-gaps.jsonl', repo, changedFiles: [], candidates: [] }),
    ).rejects.toThrow('ledger line 1');
    rmSync(repo, { recursive: true, force: true });
  });
});
```

Run them (expected: RED):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test
```

Expected: failures naming `Cannot find module './paths.ts'`, `LedgerError` not exported, and `resolveRegistryPath`/`GapReconcileError` not exported.

- [ ] **Step 2: Implement.** Create `paths.ts`; edit `ledger.ts` and `gap-reconcile.ts`.

`plugins/tribe/scripts/gaps/paths.ts` (new, pure — moved verbatim in behaviour from `gap-reconcile.ts`'s private copies, which this step deletes):

```ts
// paths.ts — pure path-overlap predicates for the gap capability (card C1). Extracted from
// gap-reconcile.ts so the candidate parser and the reconciler share ONE definition of "these
// two paths are the same gap's territory". Pure module: no fs, no subprocess, no clock.

/** A directory-comparable form of `p`: exactly one trailing slash. */
export function normalizeDir(p: string): string {
  return p.endsWith('/') ? p : `${p}/`;
}

/** True if `a` and `b` overlap — equal, or one is a directory-prefix of the other. The
 * normalizeDir call is what keeps `lib` from matching `library/a.ts` (spec §3 / §6a scenario 3). */
export function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return b.startsWith(normalizeDir(a)) || a.startsWith(normalizeDir(b));
}

export function anyPathOverlap(pathsA: readonly string[], pathsB: readonly string[]): boolean {
  return pathsA.some((a) => pathsB.some((b) => pathsOverlap(a, b)));
}
```

`ledger.ts` — replace `parseLedger` (and add the error class above it); every other export is untouched:

```ts
/** A ledger line that is not a gap event (card C1, fail-closed-edges obligation 1). Carries the
 * 1-based line number of the offending line, counted over the RAW text including blank lines, so
 * the message names the line a human sees when opening the file. */
export class LedgerError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'LedgerError';
    this.line = line;
  }
}

const KNOWN_EVENTS = new Set(['opened', 'seen', 'ruled']);

/** Parses raw ledger text (one JSON object per line, per spec §3) into typed events, in ledger
 * order. Blank lines are skipped. A line that is not valid JSON, not a JSON object, or not a gap
 * event raises `LedgerError` naming its line number — never a bare `JSON.parse` SyntaxError,
 * which reaches a user as a stack trace with no idea which line is broken (card C1). */
export function parseLedger(text: string): GapEvent[] {
  const events: GapEvent[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    const lineNo = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new LedgerError(
        `ledger line ${lineNo} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        lineNo,
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new LedgerError(`ledger line ${lineNo} is not a JSON object`, lineNo);
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.event !== 'string' ||
      !KNOWN_EVENTS.has(record.event)
    ) {
      throw new LedgerError(
        `ledger line ${lineNo} is not a gap event (needs a string id and event opened|seen|ruled)`,
        lineNo,
      );
    }
    events.push(parsed as GapEvent);
  }
  return events;
}
```

`gap-reconcile.ts` — six edits, nothing else:

1. Replace the private `normalizeDir`/`pathsOverlap`/`anyPathOverlap` definitions with `import { anyPathOverlap, pathsOverlap } from './paths.ts';` (keep every call site as-is).
2. Add the typed error and the registry resolver:

```ts
import { isAbsolute, resolve, sep } from 'node:path';

/** Every external-input failure this CLI can meet, as ONE typed refusal (card C1,
 * fail-closed-edges obligations 1 and 4). `main` converts it to a single stderr line + exit 2;
 * it never reaches a user as a stack trace. */
export class GapReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GapReconcileError';
  }
}

/** Resolves the registry path for a run. WITHOUT `repo` the path is used exactly as given —
 * today's behaviour, unchanged, which is what keeps every pre-existing caller and test working.
 * WITH `repo` (spec §2 step 4: "the registry path resolved against --repo") a relative path is
 * joined onto the repo root and the result must stay inside it — an escaping path is refused
 * before anything is opened or appended (fail-closed-edges obligation 4). */
export function resolveRegistryPath(registryPath: string, repo?: string): string {
  if (repo === undefined) return registryPath;
  const root = resolve(repo);
  const full = isAbsolute(registryPath) ? resolve(registryPath) : resolve(root, registryPath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new GapReconcileError(`registry path escapes --repo (${root}): ${registryPath}`);
  }
  return full;
}
```

3. `runGrep` gains a working directory, a timeout, and host-git-config isolation (obligations 2 and 3):

```ts
async function runGrep(argv: readonly string[], cwd?: string): Promise<{ fired: boolean; hits: number }> {
  const proc = Bun.spawn(argv as string[], {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const hits = stdout.split('\n').filter((line) => line.length > 0).length;
  return { fired: exitCode === 0, hits };
}
```

4. `reconcile`'s options gain `repo?: string`; its body resolves the registry once at the top, reads it through a narrow catch, and passes `repo` to `runGrep`:

```ts
export async function reconcile(options: {
  registryPath: string;
  changedFiles: readonly string[];
  candidates: readonly Candidate[];
  /** Target repo root (spec §2 step 4). Absent = today's behaviour: paths as given, grep in the
   * shell's own cwd. */
  repo?: string;
}): Promise<ReconcileResult> {
  const { registryPath, changedFiles, candidates, repo } = options;
  const resolvedRegistry = resolveRegistryPath(registryPath, repo);

  let registryText = '';
  if (existsSync(resolvedRegistry)) {
    try {
      registryText = readFileSync(resolvedRegistry, 'utf8');
    } catch (err) {
      throw new GapReconcileError(
        `registry is unreadable: ${resolvedRegistry}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const events = parseLedger(registryText);
```

...and every later `registryPath` use inside `reconcile` (the `mkdirSync(dirname(...))` and the `appendFileSync`) becomes `resolvedRegistry`; the `runGrep(argv)` call becomes `runGrep(argv, repo)`.

5. `parseArgs` accepts `--repo` and throws the typed error:

```ts
function parseArgs(argv: readonly string[]): {
  registry: string;
  changedFiles: string[];
  candidatesPath: string;
  repo?: string;
} {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const registry = get('--registry');
  const changedFilesArg = get('--changed-files');
  const candidatesPath = get('--candidates');
  const repo = get('--repo');
  if (!registry || !changedFilesArg || !candidatesPath) {
    throw new GapReconcileError(
      'Usage: gap-reconcile.ts --registry <path> --changed-files <comma-list> --candidates <json-file> [--repo <target-repo>]',
    );
  }
  const changedFiles = changedFilesArg
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { registry, changedFiles, candidatesPath, ...(repo === undefined ? {} : { repo }) };
}
```

6. `main` converts every external-input failure into ONE line + exit 2:

```ts
export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
  try {
    const { registry, changedFiles, candidatesPath, repo } = parseArgs(argv);
    let candidates: unknown;
    try {
      candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
    } catch (err) {
      throw new GapReconcileError(
        `candidates file is unreadable or not JSON: ${candidatesPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!Array.isArray(candidates)) {
      throw new GapReconcileError(`candidates file is not a JSON array: ${candidatesPath}`);
    }
    const result = await reconcile({
      registryPath: registry,
      changedFiles,
      candidates: candidates as Candidate[],
      ...(repo === undefined ? {} : { repo }),
    });
    console.log(JSON.stringify(result));
  } catch (err) {
    const message =
      err instanceof GapReconcileError || err instanceof LedgerError
        ? err.message
        : `unexpected failure: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`gap-reconcile: ${message}`);
    process.exit(2);
  }
}
```

(`LedgerError` is added to the existing `import { ... } from './ledger.ts';` list.)

Run the whole package (expected: GREEN, with the pre-existing 76 tests' assertions untouched):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test && bunx tsc --noEmit
```

Expected: `0 fail`, at least `76` of the passing tests being the pre-existing ones; `tsc --noEmit` silent, exit 0.

Prove the CLI refusal by hand (expected: one line, exit 2, no stack trace):

```bash
cd /tmp && bun /Users/hip/repo/tribe/plugins/tribe/scripts/gaps/gap-reconcile.ts --registry ../escape.jsonl --changed-files a.ts --candidates /nonexistent.json --repo /tmp; echo "exit=$?"
```

Expected: stdout empty; stderr exactly one line starting `gap-reconcile: candidates file is unreadable or not JSON:`; `exit=2`.

- [ ] **Step 3: Commit** — Tick this task's boxes, then commit the six owned files.

```bash
cd /Users/hip/repo/tribe && git add plugins/tribe/scripts/gaps/paths.ts plugins/tribe/scripts/gaps/paths.test.ts plugins/tribe/scripts/gaps/ledger.ts plugins/tribe/scripts/gaps/ledger.test.ts plugins/tribe/scripts/gaps/gap-reconcile.ts plugins/tribe/scripts/gaps/gap-reconcile.test.ts && \
git commit -m 'feat(gaps): --repo resolution, path containment and typed refusals for reconcile' -m $'Tribe-Card: gap-gate-scripts\nTribe-Task: 2/7\nCampaign: gap-gate-2026-09-10'
```

Expected: one commit carrying the three trailers and no `Co-Authored-By`.

### Task 3: `gap-stamp.ts` — the pure stamp formatter/parser and PR-section renderer

`owns_files`: `plugins/tribe/scripts/gaps/gap-stamp.ts`, `plugins/tribe/scripts/gaps/gap-stamp.test.ts`.
Depends on: nothing (wave 1).
Contract: F1 and F7 of this plan (spec §2 step 6).

- [ ] **Step 1: Write the failing test.** Create `plugins/tribe/scripts/gaps/gap-stamp.test.ts`.

```ts
// gap-stamp.test.ts — the stamp line and the PR-body section (card C1, spec §2 step 6).
// The CANONICAL literal below is the same one runner/core/verify.ts and verify-shipped.sh test
// against; the three readers of this wire format are pinned to one example on purpose.
import { describe, expect, test } from 'bun:test';
import { formatStamp, parseStamp, renderGapSection, type StampFields } from './gap-stamp.ts';

const CANONICAL =
  '<!-- gap-gate v1 card=gap-gate-scripts base=aaaa111 head=bbbb222 minted=G-004,G-005 ' +
  'matched=G-001 debt-delta=0 ledger=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->';

const FIELDS: StampFields = {
  card: 'gap-gate-scripts',
  base: 'aaaa111',
  head: 'bbbb222',
  minted: ['G-004', 'G-005'],
  matched: ['G-001'],
  debtDelta: 0,
  ledger: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

describe('formatStamp', () => {
  test('renders the spec §2 step 6 line byte-for-byte', () => {
    expect(formatStamp(FIELDS)).toBe(CANONICAL);
  });

  test('an empty id list renders as none, never as an empty value', () => {
    const line = formatStamp({ ...FIELDS, minted: [], matched: [] });
    expect(line).toContain('minted=none matched=none');
    expect(line).not.toContain('minted= ');
  });

  test('a negative debt delta and an absent ledger both render', () => {
    expect(formatStamp({ ...FIELDS, debtDelta: -3, ledger: 'none' })).toContain('debt-delta=-3 ledger=none');
  });
});

describe('parseStamp', () => {
  test('round-trips the canonical line', () => {
    expect(parseStamp(CANONICAL)).toEqual(FIELDS);
  });

  test('finds the stamp inside a full PR body', () => {
    const body = `## Why\n\ntext\n\n## Harness gaps\n\n- matched: G-001\n\n${CANONICAL}\n\nmore text\n`;
    expect(parseStamp(body)?.card).toBe('gap-gate-scripts');
  });

  test('none round-trips back to an empty list', () => {
    const parsed = parseStamp(formatStamp({ ...FIELDS, minted: [], matched: [] }));
    expect(parsed?.minted).toEqual([]);
    expect(parsed?.matched).toEqual([]);
  });

  test('a body with no stamp, and a truncated stamp, both parse to null', () => {
    expect(parseStamp('## Harness gaps\n\nnothing here\n')).toBeNull();
    expect(parseStamp('<!-- gap-gate v1 card=x base=y -->')).toBeNull();
  });

  test('a stamp written with no space before the closing delimiter still parses', () => {
    const tight = CANONICAL.replace(' -->', '-->');
    expect(parseStamp(tight)?.ledger).toBe(FIELDS.ledger);
  });
});

describe('renderGapSection', () => {
  const base = {
    matched: ['G-001'],
    minted: [] as string[],
    suppressedCount: 0,
    flagged: [] as string[],
    openIds: ['G-001'],
    unparsed: [] as Array<{ file: string; line: number; reason: string }>,
    debtDelta: 0,
    stamp: CANONICAL,
  };

  test('renders the frozen shape and ends with the stamp', () => {
    const md = renderGapSection(base);
    expect(md.startsWith('## Harness gaps\n')).toBe(true);
    expect(md).toContain('- matched: G-001\n');
    expect(md).toContain('- minted: none\n');
    expect(md).toContain('- suppressed: 0\n');
    expect(md).toContain('- flagged fingerprints: none\n');
    expect(md).toContain('- open ids awaiting adjudication: G-001\n');
    expect(md).toContain('- unparsed HG-candidate blocks: none\n');
    expect(md).toContain('- proposals: pending Scout adjudication\n');
    expect(md.trimEnd().endsWith(CANONICAL)).toBe(true);
  });

  test('a zero debt delta adds no burn-down line at all', () => {
    expect(renderGapSection(base)).not.toContain('debt burn-down');
  });

  test('a negative delta becomes exactly one burn-note line', () => {
    const md = renderGapSection({ ...base, debtDelta: -2 });
    expect(md).toContain('- debt burn-down: net 2 fewer hit(s) than base\n');
  });

  test('a positive delta says the gate is red', () => {
    expect(renderGapSection({ ...base, debtDelta: 3 })).toContain(
      '- debt burn-down: net 3 MORE hit(s) than base — gate red\n',
    );
  });

  test('unparsed blocks are listed one sub-bullet each', () => {
    const md = renderGapSection({
      ...base,
      unparsed: [{ file: 'tracker-C1-final.md', line: 12, reason: 'no Evidence command' }],
    });
    expect(md).toContain('- unparsed HG-candidate blocks: 1\n');
    expect(md).toContain('  - tracker-C1-final.md:12 — no Evidence command\n');
  });
});
```

Run it (expected: RED — `Cannot find module './gap-stamp.ts'`):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test gap-stamp.test.ts
```

- [ ] **Step 2: Implement `gap-stamp.ts`** — PURE (no fs, no subprocess, no clock).

```ts
// gap-stamp.ts — the `gap-gate v1` stamp line and the `## Harness gaps` PR-body section
// (card C1, spec §2 step 6). PURE MODULE: functions of their arguments only.
//
// The stamp is a WIRE FORMAT with three independent readers: this module (writer + reader),
// runner/core/verify.ts's `gapGateStamped` point, and verify-shipped.sh's fourth check. The
// runner and the shell script deliberately do NOT import this file (they are separate bun
// packages / a different language); all three are pinned to the same canonical example line,
// reproduced verbatim in each of their test suites. Change the format here and all three
// suites must change together.

export interface StampFields {
  card: string;
  base: string;
  head: string;
  minted: string[];
  matched: string[];
  /** Sum of every diffDebt entry's delta; may be negative or zero. */
  debtDelta: number;
  /** Lowercase hex sha256 of the registry after this run, or the literal `none`. */
  ledger: string;
}

/** An empty id list renders as this literal, so the stamp always has the same token count and a
 * reader can never mistake `minted= matched=G-001` for a one-token field. */
const EMPTY = 'none';

const STAMP_RE =
  /<!--\s*gap-gate v1\s+card=(\S+)\s+base=(\S+)\s+head=(\S+)\s+minted=(\S+)\s+matched=(\S+)\s+debt-delta=(-?\d+)\s+ledger=(\S+?)\s*-->/;

function renderList(ids: readonly string[]): string {
  return ids.length === 0 ? EMPTY : ids.join(',');
}

function parseList(value: string): string[] {
  return value === EMPTY ? [] : value.split(',').filter((s) => s.length > 0);
}

export function formatStamp(fields: StampFields): string {
  return (
    `<!-- gap-gate v1 card=${fields.card} base=${fields.base} head=${fields.head} ` +
    `minted=${renderList(fields.minted)} matched=${renderList(fields.matched)} ` +
    `debt-delta=${fields.debtDelta} ledger=${fields.ledger} -->`
  );
}

/** Finds the first `gap-gate v1` stamp in `text` (a PR body, a report file, a commit message).
 * Returns null when there is none, or when the line is truncated — a partial stamp is NOT a
 * stamp, because the whole point of the check is that a bypassing session cannot fake it. */
export function parseStamp(text: string): StampFields | null {
  const m = STAMP_RE.exec(text);
  if (!m) return null;
  return {
    card: m[1]!,
    base: m[2]!,
    head: m[3]!,
    minted: parseList(m[4]!),
    matched: parseList(m[5]!),
    debtDelta: Number(m[6]),
    ledger: m[7]!,
  };
}

export interface GapSectionInput {
  matched: string[];
  minted: string[];
  suppressedCount: number;
  flagged: string[];
  openIds: string[];
  unparsed: Array<{ file: string; line: number; reason: string }>;
  debtDelta: number;
  stamp: string;
}

/** The complete `## Harness gaps` PR-body section (spec §2 step 6). The Warchief pastes this
 * verbatim; nothing downstream re-derives it, which is what makes the section auditable. */
export function renderGapSection(input: GapSectionInput): string {
  const list = (ids: readonly string[]): string => (ids.length === 0 ? EMPTY : ids.join(', '));
  const lines: string[] = [
    '## Harness gaps',
    '',
    `- matched: ${list(input.matched)}`,
    `- minted: ${list(input.minted)}`,
    `- suppressed: ${input.suppressedCount}`,
    `- flagged fingerprints: ${list(input.flagged)}`,
    `- open ids awaiting adjudication: ${list(input.openIds)}`,
    `- unparsed HG-candidate blocks: ${input.unparsed.length === 0 ? EMPTY : String(input.unparsed.length)}`,
  ];
  for (const u of input.unparsed) {
    lines.push(`  - ${u.file}:${u.line} — ${u.reason}`);
  }
  if (input.debtDelta < 0) {
    lines.push(`- debt burn-down: net ${-input.debtDelta} fewer hit(s) than base`);
  } else if (input.debtDelta > 0) {
    lines.push(`- debt burn-down: net ${input.debtDelta} MORE hit(s) than base — gate red`);
  }
  lines.push('- proposals: pending Scout adjudication', '', input.stamp, '');
  return lines.join('\n');
}
```

Run it (expected: GREEN):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test && bunx tsc --noEmit
```

Expected: `0 fail`; `tsc --noEmit` silent, exit 0.

- [ ] **Step 3: Commit** —

```bash
cd /Users/hip/repo/tribe && git add plugins/tribe/scripts/gaps/gap-stamp.ts plugins/tribe/scripts/gaps/gap-stamp.test.ts && \
git commit -m 'feat(gaps): the gap-gate v1 stamp line and PR-section renderer' -m $'Tribe-Card: gap-gate-scripts\nTribe-Task: 3/7\nCampaign: gap-gate-2026-09-10'
```

Expected: one commit carrying the three trailers and no `Co-Authored-By`.

### Task 4: `gap-gate.ts` — the one pre-PR gate

`owns_files`: `plugins/tribe/scripts/gaps/gap-gate.ts`, `plugins/tribe/scripts/gaps/gap-gate.test.ts`.
Depends on: Task 1 (`gap-candidates.ts`), Task 2 (`paths.ts`, `--repo`, `resolveRegistryPath`, `GapReconcileError`), Task 3 (`gap-stamp.ts`).
Contract: spec §2 steps 1-7, as frozen in F2, F3, F6, F7. Card goals G1, G2, G3.

**Purity wall for this task:** `gap-gate.ts` is the IMPURE EDGE (glob, git, ledger read/append through `reconcile()`, file writes) and nothing else. Every decision it makes — parsing, dedup, stamp text, section text — is delegated to the pure modules of Tasks 1 and 3. No parsing regex and no Markdown string-building belongs in this file.

- [ ] **Step 1: Write the failing test.** Create `plugins/tribe/scripts/gaps/gap-gate.test.ts`. Every fixture is built from an EMPTY directory (`fixtures-mirror-reality`), never from a pre-built tree, and one test invokes the CLI with a RELATIVE `--repo` from a different cwd.

```ts
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
```

Run it (expected: RED — `Cannot find module './gap-gate.ts'`):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test gap-gate.test.ts
```

- [ ] **Step 2: Implement `gap-gate.ts`.**

```ts
// gap-gate.ts — the ONE pre-PR harness-gap gate (card C1, spec §2). Same shape as pre-gate.sh:
// one invocation before any PR is opened, red/green exit code, one Markdown report, one JSON
// summary.
//
//   bun gap-gate.ts --repo <target-repo> --home <tribe-home> --card <card-slug> --base <sha>
//                   [--head HEAD] [--pr <n>] [--registry .tribe/harness-gaps.jsonl] [--out <dir>]
//
// IMPURE EDGE ONLY (pure-core.md): the glob, the git call, the ledger read/append (through
// reconcile()), the file writes. Every decision — parsing, dedup, stamp text, section text —
// lives in the pure modules gap-candidates.ts and gap-stamp.ts and is merely called from here.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dedupeCandidates, parseTrackerReport, type ParsedCandidate, type UnparsedBlock } from './gap-candidates.ts';
import { diffDebt, type DiffEntry } from './debt-count.ts';
import { validateFingerprint } from './fingerprint.ts';
import { formatStamp, renderGapSection } from './gap-stamp.ts';
import { GapReconcileError, reconcile, resolveRegistryPath, type Candidate } from './gap-reconcile.ts';
import { LedgerError } from './ledger.ts';

/** Every setup failure of this gate, as ONE typed refusal: `main` prints it as a single stderr
 * line and exits 2, never a stack trace (fail-closed-edges obligation 1, spec §2 step 7). */
export class GapGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GapGateError';
  }
}

export interface GateOptions {
  repo: string;
  home: string;
  card: string;
  base: string;
  head?: string;
  pr?: number;
  registry?: string;
  out?: string;
}

export interface GateSummary {
  card: string;
  base: string;
  head: string;
  pr: number;
  reports: string[];
  candidates: ParsedCandidate[];
  unparsed: UnparsedBlock[];
  changed_files: string[];
  matched: string[];
  minted: string[];
  suppressed_count: number;
  flagged: string[];
  open_ids: string[];
  debt_delta: number;
  debt_entries: DiffEntry[];
  ledger: string;
  stamp: string;
  verdict: 'pass' | 'fail';
  exit: 0 | 1;
}

const DEFAULT_REGISTRY = '.tribe/harness-gaps.jsonl';

/** Step 1 (spec §2): glob `<home>/reports/tracker-<card>-*.md`. Zero files is a RED GATE, never
 * an empty set — that is what makes skipping the Tracker loud instead of silent (leak L1). */
function collectReports(home: string, card: string): Array<{ path: string; name: string; round: string }> {
  const dir = join(home, 'reports');
  const missing = new GapGateError(
    `no Tracker report for card ${card}: step 6.0b never ran, or the report path was wrong`,
  );
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw missing;
  }
  const prefix = `tracker-${card}-`;
  const found = names.filter((n) => n.startsWith(prefix) && n.endsWith('.md')).sort();
  if (found.length === 0) throw missing;
  return found.map((name) => ({ path: join(dir, name), name, round: name.slice(prefix.length, -3) }));
}

/** Step 3: the changed files, read from git at the edge (the pure core never shells out).
 * Host git config is neutralised and the child is bounded (fail-closed-edges obligations 2, 3). */
async function changedFiles(repo: string, base: string, head: string): Promise<string[]> {
  const proc = Bun.spawn(['git', '-C', repo, 'diff', '--name-only', `${base}...${head}`], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new GapGateError(
      `git diff --name-only ${base}...${head} failed in ${repo}: ${stderr.trim() || `exit ${code}`}`,
    );
  }
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function ledgerDigest(resolvedRegistry: string): string {
  if (!existsSync(resolvedRegistry)) return 'none';
  return createHash('sha256').update(readFileSync(resolvedRegistry)).digest('hex');
}

function toCandidate(parsed: ParsedCandidate, pr: number): Candidate {
  return {
    category: parsed.category,
    paths: parsed.paths,
    fingerprint: parsed.fingerprint,
    hits: parsed.hits,
    description: parsed.description,
    pr,
  };
}

/** Steps 1-7 of spec §2, in order. Every step's result is in the returned summary. */
export async function runGate(options: GateOptions): Promise<GateSummary> {
  const head = options.head ?? 'HEAD';
  const pr = options.pr ?? 0;
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const out = options.out ?? join(options.home, 'reports');

  // 1. Collect.
  const reports = collectReports(options.home, options.card);

  // 2. Parse (pure).
  const allCandidates: ParsedCandidate[] = [];
  const unparsed: UnparsedBlock[] = [];
  for (const report of reports) {
    let text: string;
    try {
      text = readFileSync(report.path, 'utf8');
    } catch (err) {
      throw new GapGateError(
        `Tracker report is unreadable: ${report.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const result = parseTrackerReport(text, report.name, report.round);
    allCandidates.push(...result.candidates);
    unparsed.push(...result.unparsed);
  }
  const candidates = dedupeCandidates(allCandidates, reports.map((r) => r.round));

  // 3. Changed files.
  const changed = await changedFiles(options.repo, options.base, head);

  // 4. Reconcile — but a candidate whose fingerprint would never be executable is flagged and
  // withheld first (plan F3), so an unusable fingerprint is never frozen into the ledger.
  const flagged: string[] = [];
  const safe: ParsedCandidate[] = [];
  for (const candidate of candidates) {
    const validation = validateFingerprint(candidate.fingerprint);
    if (validation.valid) safe.push(candidate);
    else flagged.push(`candidate: ${validation.reason} (fingerprint: ${candidate.fingerprint})`);
  }

  const resolvedRegistry = resolveRegistryPath(registry, options.repo);
  const result = await reconcile({
    registryPath: registry,
    repo: options.repo,
    changedFiles: changed,
    candidates: safe.map((c) => toCandidate(c, pr)),
  });
  flagged.push(...result.flagged);

  // 5. Debt burn-down — the gate is now the one place this runs (spec §2 step 5, CU-3 §4).
  let debtEntries: DiffEntry[];
  try {
    debtEntries = (await diffDebt(options.repo, options.base, head)).entries;
  } catch (err) {
    throw new GapGateError(
      `debt burn-down failed for ${options.base}..${head}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const debtDelta = debtEntries.reduce((sum, entry) => sum + entry.delta, 0);

  // 6. Report (pure rendering).
  const openIds = [...new Set([...result.matched, ...result.minted])].sort();
  const stamp = formatStamp({
    card: options.card,
    base: options.base,
    head,
    minted: result.minted,
    matched: result.matched,
    debtDelta,
    ledger: ledgerDigest(resolvedRegistry),
  });

  // 7. Exit.
  const red = debtEntries.some((entry) => entry.delta > 0) || flagged.length > 0;
  const summary: GateSummary = {
    card: options.card,
    base: options.base,
    head,
    pr,
    reports: reports.map((r) => r.name),
    candidates,
    unparsed,
    changed_files: changed,
    matched: result.matched,
    minted: result.minted,
    suppressed_count: result.suppressed_count,
    flagged,
    open_ids: openIds,
    debt_delta: debtDelta,
    debt_entries: debtEntries,
    ledger: ledgerDigest(resolvedRegistry),
    stamp,
    verdict: red ? 'fail' : 'pass',
    exit: red ? 1 : 0,
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, `${options.card}-gap-gate.md`),
    renderGapSection({
      matched: result.matched,
      minted: result.minted,
      suppressedCount: result.suppressed_count,
      flagged,
      openIds,
      unparsed: unparsed.map((u) => ({ file: u.file, line: u.line, reason: u.reason })),
      debtDelta,
      stamp,
    }),
  );
  writeFileSync(join(out, `${options.card}-gap-gate.json`), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function parseArgs(argv: readonly string[]): GateOptions {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const repo = get('--repo');
  const home = get('--home');
  const card = get('--card');
  const base = get('--base');
  if (!repo || !home || !card || !base) {
    throw new GapGateError(
      'usage: gap-gate.ts --repo <target-repo> --home <tribe-home> --card <slug> --base <sha> [--head HEAD] [--pr <n>] [--registry <path>] [--out <dir>]',
    );
  }
  const prRaw = get('--pr');
  const pr = prRaw === undefined ? undefined : Number(prRaw);
  if (pr !== undefined && !Number.isInteger(pr)) throw new GapGateError(`--pr is not an integer: ${prRaw}`);
  const head = get('--head');
  const registry = get('--registry');
  const out = get('--out');
  return {
    repo,
    home,
    card,
    base,
    ...(head === undefined ? {} : { head }),
    ...(pr === undefined ? {} : { pr }),
    ...(registry === undefined ? {} : { registry }),
    ...(out === undefined ? {} : { out }),
  };
}

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
  try {
    const summary = await runGate(parseArgs(argv));
    console.log(JSON.stringify(summary));
    process.exit(summary.exit);
  } catch (err) {
    const message =
      err instanceof GapGateError || err instanceof GapReconcileError || err instanceof LedgerError
        ? err.message
        : `unexpected failure: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`gap-gate: ${message}`);
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
```

Run the whole package plus the shell sweep (expected: GREEN):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/gaps && bun test && bunx tsc --noEmit && \
bash /Users/hip/repo/tribe/plugins/tribe/scripts/tests/test-fresh-machine.sh
```

Expected: `0 fail` from `bun test`; `tsc --noEmit` silent, exit 0; `test-fresh-machine.sh` ends `29 passed, 0 failed` — the measured baseline, unchanged by this task, because `scripts/` is never installed.

- [ ] **Step 3: Commit** —

```bash
cd /Users/hip/repo/tribe && git add plugins/tribe/scripts/gaps/gap-gate.ts plugins/tribe/scripts/gaps/gap-gate.test.ts && \
git commit -m 'feat(gaps): gap-gate.ts, the one pre-PR harness-gap gate' -m $'Tribe-Card: gap-gate-scripts\nTribe-Task: 4/7\nCampaign: gap-gate-2026-09-10'
```

Expected: one commit carrying the three trailers and no `Co-Authored-By`.

### Task 5: `runner/core/verify.ts` — the sixth and seventh D3 points, and the runner README

`owns_files`: `plugins/tribe/scripts/runner/core/verify.ts`, `plugins/tribe/scripts/runner/core/verify.test.ts`, `plugins/tribe/scripts/runner/core/loop/card-actions.ts`, `plugins/tribe/scripts/runner/core/loop.test.ts`, `plugins/tribe/scripts/runner/README.md`.
Depends on: nothing (wave 1) — the stamp format is frozen by F1 of this plan, and the runner deliberately does NOT import `scripts/gaps` (separate bun package; the wire format is the only coupling).
Contract: spec §3; card goal G4.

**Scope fence for this task, by intent:** no existing test's ASSERTIONS change. The mock IO in `verify.test.ts` and the `verifyShipped(...)` call sites in `loop.test.ts` DO change (a new argument and two new mocked commands) — that is mechanical wiring, not an assertion, and it is expected.

- [ ] **Step 1: Write the failing test.** Extend `verify.test.ts`.

First, three mechanical edits to its existing helpers (not assertions):

1. `MockOptions` gains `prBody?: string` and `ledgerAtBase?: string`.
2. `buildIo` gains three branches, and its `git merge-base` branch learns to discriminate by sha — the stamp check calls `merge-base --is-ancestor` too, and a test that makes the MERGE sha a non-ancestor must not accidentally fail the stamp point as well:

```ts
  const prBody =
    opts.prBody ??
    '## Harness gaps\n\n<!-- gap-gate v1 card=C1 base=base0001 head=head0001 minted=none matched=none debt-delta=0 ledger=none -->\n';
  const ledgerAtBase = opts.ledgerAtBase ?? '';
  // ...inside exec():
      if (bin === 'git' && rest[0] === 'merge-base') {
        // rest = ['merge-base', '--is-ancestor', <sha>, <target>]; only the MERGE sha is governed
        // by ancestorExitCode — the stamp's base/head shas are ancestors unless a test says
        // otherwise, so an unrelated ancestry failure never bleeds into the stamp point.
        return { stdout: '', stderr: '', exitCode: rest[2] === mergeSha ? ancestorExitCode : 0 };
      }
      if (bin === 'gh' && rest[0] === 'pr' && rest[1] === 'view') {
        return ok(JSON.stringify({ body: prBody }));
      }
      if (bin === 'git' && rest[0] === 'show') {
        return ledgerAtBase.length > 0
          ? ok(ledgerAtBase)
          : { stdout: '', stderr: 'fatal: path does not exist', exitCode: 128 };
      }
```

3. Every existing `verifyShipped(card, config, io)` call in this file and in `loop.test.ts` gains a fourth argument `'C1'` (matching the default stamp's `card=C1`). Nothing else in those calls changes.

Then add the new cases:

```ts
describe('gapGateStamped (spec §3, card goal G4)', () => {
  const STAMP =
    '<!-- gap-gate v1 card=C1 base=base0001 head=head0001 minted=G-001 matched=none debt-delta=0 ledger=none -->';

  test('a PR body carrying a matching stamp passes the point', async () => {
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig(),
      buildIo({ prBody: `text\n${STAMP}\n`, ledgerAtBase: '{"id":"G-001","event":"opened"}\n' }),
      'C1',
    );
    const point = result.points.find((p) => p.id === 'gapGateStamped');
    expect(point?.passed).toBe(true);
  });

  test('a PR body with no stamp fails the point, and the card is not shipped', async () => {
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: '## Why\n\nno stamp here\n' }), 'C1');
    expect(result.shipped).toBe(false);
    expect(result.failedPoints).toContain('gapGateStamped');
    expect(result.points.find((p) => p.id === 'gapGateStamped')?.detail).toContain('no `gap-gate v1` stamp');
  });

  test("a stamp for a DIFFERENT card fails the point (a copied PR body is not this card's proof)", async () => {
    const other = STAMP.replace('card=C1', 'card=C9');
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: other }), 'C1');
    expect(result.failedPoints).toContain('gapGateStamped');
  });

  test('a stamp whose base sha is not an ancestor of the base branch fails the point', async () => {
    const io = buildIo({ prBody: STAMP });
    const spy: string[][] = [];
    const wrapped = {
      ...io,
      async exec(cmd: string[], o?: { cwd?: string }) {
        spy.push(cmd);
        if (cmd[0] === 'git' && cmd[1] === 'merge-base' && cmd[3] === 'base0001') {
          return { stdout: '', stderr: '', exitCode: 1 };
        }
        return io.exec(cmd, o);
      },
    };
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), wrapped, 'C1');
    expect(result.failedPoints).toContain('gapGateStamped');
    expect(spy.some((c) => c[1] === 'merge-base' && c[3] === 'base0001')).toBe(true);
  });

  test('every point is still reported even when this one fails (never short-circuited)', async () => {
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: 'nothing' }), 'C1');
    expect(result.points.map((p) => p.id)).toEqual([
      'merged',
      'mergeShaAncestorOfMaster',
      'checksGreen',
      'worktreeAndBranchGone',
      'schemaGuard',
      'gapGateStamped',
      'ledgerCommitted',
    ]);
  });
});

describe('ledgerCommitted (spec §3, ledger policy A)', () => {
  const STAMP =
    '<!-- gap-gate v1 card=C1 base=base0001 head=head0001 minted=G-004,G-005 matched=none debt-delta=0 ledger=none -->';

  test('passes when the merged base tree carries every id the stamp says was minted', async () => {
    const ledger = '{"id":"G-004","event":"opened"}\n{"id":"G-005","event":"opened"}\n';
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo({ prBody: STAMP, ledgerAtBase: ledger }), 'C1');
    expect(result.points.find((p) => p.id === 'ledgerCommitted')?.passed).toBe(true);
  });

  test('fails, naming the missing id, when the ledger was never committed', async () => {
    const result = await verifyShipped(
      fixtureCard(),
      fixtureConfig(),
      buildIo({ prBody: STAMP, ledgerAtBase: '{"id":"G-004","event":"opened"}\n' }),
      'C1',
    );
    expect(result.failedPoints).toContain('ledgerCommitted');
    expect(result.points.find((p) => p.id === 'ledgerCommitted')?.detail).toContain('G-005');
  });

  test('a stamp that minted nothing needs no ledger at all', async () => {
    const result = await verifyShipped(fixtureCard(), fixtureConfig(), buildIo(), 'C1');
    expect(result.points.find((p) => p.id === 'ledgerCommitted')?.passed).toBe(true);
  });

  test('the ledger path is campaign config, defaulting to the capability constant', async () => {
    const io = buildIo({ prBody: STAMP, ledgerAtBase: '{"id":"G-004"}{"id":"G-005"}' });
    const seen: string[][] = [];
    const wrapped = {
      ...io,
      async exec(cmd: string[], o?: { cwd?: string }) {
        seen.push(cmd);
        return io.exec(cmd, o);
      },
    };
    await verifyShipped(fixtureCard(), fixtureConfig({ gapLedgerPath: 'ops/gaps.jsonl' }), wrapped, 'C1');
    expect(seen.some((c) => c[0] === 'git' && c[1] === 'show' && c[2] === 'origin/master:ops/gaps.jsonl')).toBe(true);
  });
});

describe('parseGapGateStamp', () => {
  test('reads the canonical stamp of the gap gate', () => {
    const parsed = parseGapGateStamp(
      '<!-- gap-gate v1 card=gap-gate-scripts base=aaaa111 head=bbbb222 minted=G-004,G-005 matched=G-001 debt-delta=0 ledger=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 -->',
    );
    expect(parsed).toEqual({
      card: 'gap-gate-scripts',
      base: 'aaaa111',
      head: 'bbbb222',
      minted: ['G-004', 'G-005'],
      matched: ['G-001'],
    });
  });

  test('none means an empty list; a truncated stamp is not a stamp', () => {
    expect(parseGapGateStamp('<!-- gap-gate v1 card=C1 base=a head=b minted=none matched=none debt-delta=0 ledger=none -->')?.minted).toEqual([]);
    expect(parseGapGateStamp('<!-- gap-gate v1 card=C1 base=a -->')).toBeNull();
  });
});
```

Run it (expected: RED):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/runner && bun test core/verify.test.ts
```

Expected: failures naming `parseGapGateStamp` (not exported) and the two missing point ids.

- [ ] **Step 2: Implement.**

`core/verify.ts` — five edits:

1. `VerifyPointId` gains the two ids, appended so the reported order is 1-7:

```ts
export type VerifyPointId =
  | 'merged'
  | 'mergeShaAncestorOfMaster'
  | 'checksGreen'
  | 'worktreeAndBranchGone'
  | 'schemaGuard'
  | 'gapGateStamped'
  | 'ledgerCommitted';
```

2. `VerifyConfig` gains one OPTIONAL field (optional on purpose: an absent value must not force every existing caller and fixture to be rewritten, and the default is the tribe capability's OWN artifact path, not the target repo's layout — the stateless-capability wall bans baking in the TARGET's directory shape, not this capability's own):

```ts
  /** Where ledger policy A (spec §4) keeps the gap registry inside the target repo. Campaign
   * config, carried by the caller; defaults to the capability's own constant. */
  gapLedgerPath?: string;
```

3. The stamp reader — pure, exported for its test. It deliberately duplicates `scripts/gaps/gap-stamp.ts`'s regex rather than importing it: the runner is a separate bun package with its own tsconfig, and reaching across package boundaries for one regex would couple the runner's build to the gap capability's. Both copies, and `verify-shipped.sh`'s python copy, are pinned to the same canonical example in their tests.

```ts
/** The tribe's own artifact path under ledger policy A (spec §4) — NOT the target repo's
 * layout, which is what the stateless-capability wall forbids hardcoding. */
export const GAP_LEDGER_PATH = '.tribe/harness-gaps.jsonl';

/** Third reader of the `gap-gate v1` wire format (writer: scripts/gaps/gap-stamp.ts; other
 * reader: verify-shipped.sh). Keep this regex byte-identical to those two. The lazy `\S+?` on
 * `ledger` is load-bearing: a greedy match swallows a `-->` written with no space before it. */
const GAP_GATE_STAMP_RE =
  /<!--\s*gap-gate v1\s+card=(\S+)\s+base=(\S+)\s+head=(\S+)\s+minted=(\S+)\s+matched=(\S+)\s+debt-delta=(-?\d+)\s+ledger=(\S+?)\s*-->/;

export interface GapGateStamp {
  card: string;
  base: string;
  head: string;
  minted: string[];
  matched: string[];
}

export function parseGapGateStamp(text: string): GapGateStamp | null {
  const m = GAP_GATE_STAMP_RE.exec(text);
  if (!m) return null;
  const list = (v: string): string[] => (v === 'none' ? [] : v.split(',').filter((s) => s.length > 0));
  return { card: m[1]!, base: m[2]!, head: m[3]!, minted: list(m[4]!), matched: list(m[5]!) };
}
```

4. The two check functions, written in the same never-throw style as the existing five (a failed check is a reported outcome, never an exception):

```ts
/** D3 point 6 (spec §3): the merged PR's body carries a `gap-gate v1` stamp whose `card=` is
 * THIS card and whose base/head shas are commits of the merged branch. A PR opened by a session
 * that bypassed the Warchief (leak L4) has no stamp, so it cannot record `shipped`. */
async function checkGapGateStamped(
  cardId: string,
  card: Card,
  config: VerifyConfig,
  io: VerifyIO,
): Promise<{ point: VerifyPointResult; stamp: GapGateStamp | null }> {
  const fail = (detail: string): { point: VerifyPointResult; stamp: null } => ({
    point: { id: 'gapGateStamped', passed: false, detail },
    stamp: null,
  });
  if (card.pr == null) return fail('card.pr is not set; cannot read the PR body');

  const result = await run(io, config.repoRoot, ['gh', 'pr', 'view', String(card.pr), '--json', 'body']);
  if (result.exitCode !== 0) {
    return fail(`gh pr view ${card.pr} --json body failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  let body: string;
  try {
    body = String((JSON.parse(result.stdout) as { body?: unknown }).body ?? '');
  } catch {
    return fail(`gh pr view ${card.pr} --json body returned non-JSON output`);
  }

  const stamp = parseGapGateStamp(body);
  if (!stamp) {
    return fail(
      `PR #${card.pr} body carries no \`gap-gate v1\` stamp — the harness-gap gate never ran for this PR`,
    );
  }
  if (stamp.card !== cardId) {
    return fail(`PR #${card.pr} body carries a gap-gate stamp for card=${stamp.card}, not ${cardId}`);
  }

  const target = `${config.remote}/${config.baseBranch}`;
  for (const sha of [stamp.base, stamp.head]) {
    const ancestry = await run(io, config.repoRoot, ['git', 'merge-base', '--is-ancestor', sha, target]);
    if (ancestry.exitCode !== 0) {
      return fail(`gap-gate stamp names ${sha}, which is not a commit of ${target} (exit ${ancestry.exitCode})`);
    }
  }

  return {
    point: {
      id: 'gapGateStamped',
      passed: true,
      detail: `PR #${card.pr} carries a gap-gate v1 stamp for ${cardId} (minted=${stamp.minted.join(',') || 'none'})`,
    },
    stamp,
  };
}

/** D3 point 7 (spec §3, ledger policy A): every id the stamp says was minted is present in the
 * ledger as committed on the merged base branch — the check that the append actually rode the PR
 * instead of dying with the worktree (leak L5). */
async function checkLedgerCommitted(
  stamp: GapGateStamp | null,
  config: VerifyConfig,
  io: VerifyIO,
): Promise<VerifyPointResult> {
  if (!stamp) {
    return { id: 'ledgerCommitted', passed: false, detail: 'no gap-gate stamp available (point 6 did not report one)' };
  }
  if (stamp.minted.length === 0) {
    return { id: 'ledgerCommitted', passed: true, detail: 'the stamp minted no ids; there is nothing to commit' };
  }

  const path = config.gapLedgerPath ?? GAP_LEDGER_PATH;
  const ref = `${config.remote}/${config.baseBranch}:${path}`;
  const result = await run(io, config.repoRoot, ['git', 'show', ref]);
  if (result.exitCode !== 0) {
    return {
      id: 'ledgerCommitted',
      passed: false,
      detail: `${ref} does not exist, but the stamp minted ${stamp.minted.join(',')} — the ledger append never landed`,
    };
  }
  const missing = stamp.minted.filter((id) => !result.stdout.includes(`"id":"${id}"`));
  if (missing.length > 0) {
    return { id: 'ledgerCommitted', passed: false, detail: `${ref} is missing minted id(s): ${missing.join(', ')}` };
  }
  return { id: 'ledgerCommitted', passed: true, detail: `${ref} carries every minted id (${stamp.minted.join(',')})` };
}
```

5. `verifyShipped` takes the card id and appends the two points:

```ts
export async function verifyShipped(
  card: Card,
  config: VerifyConfig,
  io: VerifyIO,
  cardId: string,
): Promise<VerifyResult> {
  const merged = await checkMerged(card, config, io);
  const gapGate = await checkGapGateStamped(cardId, card, config, io);
  const points: VerifyPointResult[] = [
    merged.point,
    await checkAncestor(merged.mergeSha, config, io),
    await checkChecksGreen(card, config, io),
    await checkWorktreeAndBranchGone(card, config, io),
    await checkSchemaGuard(card, config, io),
    gapGate.point,
    await checkLedgerCommitted(gapGate.stamp, config, io),
  ];

  const failedPoints = points.filter((p) => !p.passed).map((p) => p.id);
  return { shipped: failedPoints.length === 0, points, failedPoints };
}
```

`core/loop/card-actions.ts` — two edits:

1. Both `verifyShipped(card, verifyConfig, io)` calls gain `ctx.cardId` (in `healSafeResidue`, `const { state, cardId, io } = ctx;` already destructures it; in `verifyThenHealIfNeeded`, use `ctx.cardId`).
2. `VERIFY_FAILURE_BULLETS` is typed `Record<Exclude<VerifyPointId, 'worktreeAndBranchGone'>, string>`, so the compiler now demands two more entries:

```ts
  gapGateStamped:
    '- gapGateStamped: the merged PR body carries no valid `gap-gate v1` stamp for this card. ' +
    'Run `bun plugins/tribe/scripts/gaps/gap-gate.ts` on the card branch, paste its ' +
    '`<card>-gap-gate.md` into the PR body as the `## Harness gaps` section, and re-run.',
  ledgerCommitted:
    '- ledgerCommitted: the stamp says ids were minted, but the base branch has no ' +
    '`.tribe/harness-gaps.jsonl` carrying them. Commit the gate\'s ledger append on the card ' +
    'branch (trailer `Tribe-Milestone: gap-gate`) so it rides the PR, then re-run.',
```

`README.md` — add one section immediately after `## Rulings gate (harness-gap-wiring PR C)`:

````markdown
## Harness-gap gate and the `gap-gate v1` stamp (spec CU-4 §2, §3)

Before any card PR is opened, the executor runs the gap gate:

```bash
bun plugins/tribe/scripts/gaps/gap-gate.ts --repo <target-repo> --home <tribe-home> \
    --card <card-slug> --base <merge-base-sha> [--head HEAD] [--pr <n>]
```

It reads every `<home>/reports/tracker-<card>-*.md` (so a candidate found at task 3 and absent
from the final round still reaches reconciliation), reconciles them against
`.tribe/harness-gaps.jsonl` in the target repo, runs the debt burn-down diff, and writes
`<home>/reports/<card>-gap-gate.md` — the complete `## Harness gaps` PR-body section, ending in
one machine-checkable stamp line. Exit 0 = green, 1 = red (positive debt delta, or an unsafe
fingerprint), 2 = setup error (no Tracker report, bad range, unreadable ledger). Zero Tracker
report files is a RED gate, never an empty set.

Under ledger policy A the append is committed on the card branch with the trailer
`Tribe-Milestone: gap-gate`, so the ledger rides the PR onto the base branch.

`verifyShipped` therefore replays **seven** D3 points, not five. The two added by CU-4 §3 are:

- `gapGateStamped` — the merged PR body carries a `gap-gate v1` stamp whose `card=` matches this
  card and whose `base=`/`head=` shas are commits of the merged branch.
- `ledgerCommitted` — every id the stamp says was minted is present in the ledger as committed
  on the base branch.

Both are reported like every other point (never short-circuited): a failure escalates the card
instead of recording `shipped`, which is what makes a PR opened by a session that bypassed the
Warchief a red verdict a human must act on.
````

Run the runner suite (expected: GREEN; budget ~4 minutes):

```bash
cd /Users/hip/repo/tribe/plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit
```

Expected: `0 fail`, with at least the pre-existing `645` tests still passing; `tsc --noEmit` silent, exit 0.

- [ ] **Step 3: Commit** —

```bash
cd /Users/hip/repo/tribe && git add plugins/tribe/scripts/runner/core/verify.ts plugins/tribe/scripts/runner/core/verify.test.ts plugins/tribe/scripts/runner/core/loop/card-actions.ts plugins/tribe/scripts/runner/core/loop.test.ts plugins/tribe/scripts/runner/README.md && \
git commit -m 'feat(runner): verify the gap-gate stamp and the committed ledger after merge' -m $'Tribe-Card: gap-gate-scripts\nTribe-Task: 5/7\nCampaign: gap-gate-2026-09-10'
```

Expected: one commit carrying the three trailers and no `Co-Authored-By`.

### Task 6: `verify-shipped.sh` — the fourth check, its test suite, and SKILL.md

`owns_files`: `plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh`, `plugins/verify-shipped/skills/verify-shipped/SKILL.md`, `plugins/verify-shipped/scripts/tests/test-verify-shipped.sh` (new).
Depends on: nothing (wave 1).
Contract: spec §3; card goal G4.

**Frozen scope of the shell check (a decided How, do not widen):** the fourth check grades **stamp present AND `card=` matches `--card`**. It does NOT re-check sha ancestry — that is the runner's `gapGateStamped` point, which has the merged repo in hand; the shell script is the attended-session backstop and must stay offline-testable. `--card` becomes REQUIRED, exactly as `--worktree` already is and for the same stated reason ("a claimed-done state with an unchecked corner is exactly the gap this skill exists to close").

- [ ] **Step 1: Write the failing test.** Create `plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`, following the house harness shape (`ok`/`bad`/`check`, a `N passed, M failed` tally line, exit non-zero on failure). `gh` is stubbed by a PATH shim; `git` and `python3` are real, against a throwaway repo built from an EMPTY directory.

```bash
#!/usr/bin/env bash
# test-verify-shipped.sh — fixture tests for verify-shipped.sh (synthetic git repo, stubbed gh,
# fully offline). Card C1: the fourth check, gap_gate_stamped.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../../skills/verify-shipped/scripts/verify-shipped.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
jget() { python3 - "$1" "$2" <<'EOF'
import json, sys
o = json.loads(sys.stdin.read()) if sys.argv[1] == '-' else json.load(open(sys.argv[1]))
for k in sys.argv[2].split('.'):
    o = o[k]
print(o)
EOF
}

STAMP='<!-- gap-gate v1 card=C1 base=aaaa111 head=bbbb222 minted=G-001 matched=none debt-delta=0 ledger=none -->'

# A throwaway repo built from NOTHING, plus a stub gh whose PR body the caller chooses.
make_repo() { # make_repo DIR
  mkdir -p "$1"; git init -q -b master "$1"
  git -C "$1" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  git -C "$1" remote add origin "$1/../origin.git" 2>/dev/null || true
}
stub_gh() { # stub_gh BIN_DIR BODY
  mkdir -p "$1"
  cat > "$1/gh" <<EOF
#!/usr/bin/env bash
cat <<'JSON'
{"number":42,"url":"u","state":"MERGED","commits":[],"baseRefName":"master","headRefName":"h","mergedAt":"now","body":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$2")}
JSON
EOF
  chmod +x "$1/gh"
}
run_vs() { # run_vs REPO BIN_DIR [extra args] -> prints JSON
  local repo="$1" bin="$2"; shift 2
  ( cd "$repo" && PATH="$bin:$PATH" bash "$SCRIPT" --pr 42 --worktree "$TMP/gone-worktree" "$@" )
}

repo="$TMP/r1"; make_repo "$repo"; bin="$TMP/bin1"
stub_gh "$bin" "## Harness gaps

$STAMP
"
out="$(run_vs "$repo" "$bin" --card C1 || true)"
check "stamp present and card matches -> pass" "$(printf '%s' "$out" | jget - checks.gap_gate_stamped.status)" "pass"

repo2="$TMP/r2"; make_repo "$repo2"; bin2="$TMP/bin2"
stub_gh "$bin2" "## Why

no stamp at all
"
out2="$(run_vs "$repo2" "$bin2" --card C1 || true)"
check "no stamp -> fail" "$(printf '%s' "$out2" | jget - checks.gap_gate_stamped.status)" "fail"
check "no stamp -> overall verdict FAIL" "$(printf '%s' "$out2" | jget - verdict)" "FAIL"

repo3="$TMP/r3"; make_repo "$repo3"; bin3="$TMP/bin3"
stub_gh "$bin3" "$STAMP"
out3="$(run_vs "$repo3" "$bin3" --card C9 || true)"
check "stamp for another card -> fail" "$(printf '%s' "$out3" | jget - checks.gap_gate_stamped.status)" "fail"

repo4="$TMP/r4"; make_repo "$repo4"; bin4="$TMP/bin4"
stub_gh "$bin4" "$STAMP"
set +e
( cd "$repo4" && PATH="$bin4:$PATH" bash "$SCRIPT" --pr 42 --worktree "$TMP/gone-worktree" >/dev/null 2>&1 )
code=$?
set -e
check "--card omitted -> setup error, exit 2" "$code" "2"

repo5="$TMP/r5"; make_repo "$repo5"; bin5="$TMP/bin5"
stub_gh "$bin5" "$STAMP"
out5="$(run_vs "$repo5" "$bin5" --card C1 || true)"
check "the three original checks are still reported" \
  "$(printf '%s' "$out5" | python3 -c 'import json,sys; print(",".join(sorted(json.load(sys.stdin)["checks"])))')" \
  "gap_gate_stamped,master_in_sync,pr_merged,worktree_removed"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
exit $((FAIL > 0))
```

Run it (expected: RED):

```bash
bash /Users/hip/repo/tribe/plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
```

Expected: several `not ok` lines (the `gap_gate_stamped` key does not exist yet, and `--card` is rejected as an unknown arg), and a non-zero exit.

- [ ] **Step 2: Implement.** Edit `verify-shipped.sh` — six edits, nothing else:

1. Header comment: four checks, and the new `--card` flag in the usage line.
2. Argument parsing gains `--card) CARD_ARG="$2"; shift 2 ;;` with `CARD_ARG=""` initialised, plus the required-flag guard next to the existing ones:

```bash
[[ -n "$CARD_ARG" ]] || DIE "--card <slug> is required (all four checks must run)"
```

3. The single `gh pr view` call gains `body` to its `--json` list (one gh call, not two):

```bash
    --json number,url,state,commits,baseRefName,headRefName,mergedAt,body
```

4. Extract the body next to the existing `PR_NUMBER`/`PR_STATE` extraction:

```bash
PR_BODY=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["body"] or "")' "$PR_JSON")
```

5. The fourth check, after check 3. The regex is the third copy of the `gap-gate v1` wire format (writer: `scripts/gaps/gap-stamp.ts`; other reader: `runner/core/verify.ts`) — keep all three byte-identical:

```bash
# ---------- check 4: gap_gate_stamped ----------
# The merged PR's body must carry a `gap-gate v1` stamp for THIS card (spec CU-4 §3). This is
# the attended-session backstop for a PR opened by any session that bypassed the Warchief and
# so never ran the gap gate. Sha ancestry is deliberately NOT re-checked here — that is the
# campaign runner's `gapGateStamped` point, which has the merged repo in hand.
CHECK4_RAW=$(python3 - "$PR_BODY" "$CARD_ARG" <<'PY'
import re, sys
body, card = sys.argv[1], sys.argv[2]
m = re.search(
    r"<!--\s*gap-gate v1\s+card=(\S+)\s+base=(\S+)\s+head=(\S+)\s+minted=(\S+)\s+"
    r"matched=(\S+)\s+debt-delta=(-?\d+)\s+ledger=(\S+?)\s*-->",
    body,
)
if not m:
    print("fail\tPR body carries no `gap-gate v1` stamp - the harness-gap gate never ran for this PR")
elif m.group(1) != card:
    print("fail\tPR body carries a gap-gate stamp for card=%s, not %s" % (m.group(1), card))
else:
    print("pass\tgap-gate v1 stamp present for card %s (minted=%s matched=%s)" % (card, m.group(4), m.group(5)))
PY
)
CHECK4_STATUS="${CHECK4_RAW%%$'\t'*}"
CHECK4_DETAIL="${CHECK4_RAW#*$'\t'}"
```

6. The verdict conjunction gains `&& "$CHECK4_STATUS" == "pass"`, and the JSON emitter gains two argv elements plus the new key:

```bash
        "gap_gate_stamped":      {"status": c4_status, "detail": c4_detail},
```

(with `"card": card_slug,` added next to `"worktree": worktree,`, and the python unpack extended to `sys.argv[1:13]`).

Run the suite (expected: GREEN):

```bash
bash /Users/hip/repo/tribe/plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
```

Expected: every line `ok - ...`, ending `6 passed, 0 failed`, exit 0.

Then update `SKILL.md`: the frontmatter `description` says **four** checks and names the stamp check; the "What it checks" list gains item 4; the Usage block gains `--card <slug>` as required with the sentence "all four checks run every time"; the Example JSON gains the `gap_gate_stamped` line and a `"card"` field. Verify the doc matches the script mechanically:

```bash
cd /Users/hip/repo/tribe && grep -c 'gap_gate_stamped' plugins/verify-shipped/skills/verify-shipped/SKILL.md plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh
```

Expected: both files report a non-zero count (SKILL.md at least 1, the script at least 2).

- [ ] **Step 3: Commit** —

```bash
cd /Users/hip/repo/tribe && git add plugins/verify-shipped/skills/verify-shipped/scripts/verify-shipped.sh plugins/verify-shipped/skills/verify-shipped/SKILL.md plugins/verify-shipped/scripts/tests/test-verify-shipped.sh && \
git commit -m 'feat(verify-shipped): fourth check — the merged PR carries this card gap-gate stamp' -m $'Tribe-Card: gap-gate-scripts\nTribe-Task: 6/7\nCampaign: gap-gate-2026-09-10'
```

Expected: one commit carrying the three trailers and no `Co-Authored-By`.

### Task 7: the CU-4 ADR and its change-unit patches, applied in this PR

`owns_files`: `.c3/adr/` (the new ADR, created only through the CLI), `.c3/changes/<the-new-adr-id>/*.patch.md`, and whatever `c3x change apply` writes under `.c3/` as a result. No source file.
Depends on: Tasks 1-6 all merged into the card branch (wave 4) — the Contract rows must describe the surfaces exactly as they finally shipped.
Contract: card item 7; `rule-change-unit-ships-with-code` (read it with `C3X_MODE=agent bash "$C3X" read rule-change-unit-ships-with-code --full` before authoring).

**The governing rule, quoted verbatim from `rule-change-unit-ships-with-code`'s Rule section:**

> The PR that merges a decided ADR's code applies every patch under `.c3/changes/<adr-id>/` to its target fact in that same PR, or records the deferral as a debt entity in that same PR.

and from its Scope section:

> Does not govern ADRs with no change-unit (pure records), and does not govern which patches an ADR should have — only that the ones it has are applied or explicitly deferred as debt when the code lands.

**Consequence, frozen:** this task authors ONLY the patches this PR applies. The Business-Flow and Governance patches spec §8 assigns to card C2 are NOT authored here — authoring them now and leaving them unapplied would violate the rule above. The ADR body says so explicitly, so C2 knows to extend the same unit.

**Fence note (a deliberate How-decision, in scope):** three patches, not two. The third is `c3-215`'s Change-Safety row whose Trigger is literally "Editing verify.ts (the D3 six-point replay)" — Task 5 edits verify.ts and makes the replay seven points, so leaving that cell would be drift this card itself introduced. Its cell text is the only thing that changes.

- [ ] **Step 1: Read the schema and the target rows, then author the ADR body OUTSIDE `.c3/`.**

```bash
export C3X=/Users/hip/.claude/plugins/cache/c3-skill-marketplace/c3-skill/11.6.3/skills/c3/bin/c3x.sh
cd /Users/hip/repo/tribe
C3X_MODE=agent bash "$C3X" schema adr
C3X_MODE=agent bash "$C3X" read rule-change-unit-ships-with-code --full
C3X_MODE=agent bash "$C3X" read c3-215 --section Contract --cite
C3X_MODE=agent bash "$C3X" read c3-215 --section 'Change Safety' --cite
C3X_MODE=agent bash "$C3X" read c3-217 --section Contract --cite
```

Expected: `schema adr` leads with its `reject_if` list and marks Goal, Context, Decision, Affected Topology and Verification as `req: true`; each `--cite` run prints one handle per citable block, of the form `c3-215#nNNNN@vN:sha256:<64 hex>`. Record the handle of (a) `c3-215`'s LAST Contract row (the `scripts/runner/run.ts watchdog` row), (b) `c3-215`'s Change-Safety row beginning `Runner accepts an unshipped card`, (c) `c3-217`'s Contract row beginning `scripts/verify-shipped.sh` — those three are the patch bases.

Author `/tmp/adr-harness-gap-gate.md` (outside `.c3/`, per the change reference: `.c3/` regenerates and drops stray scratch files). Required sections, each substantive — a thin included section fails the canvas:

- **Goal** — make the middle of the harness-gap loop mechanical: one gate with one durable input (Tracker report files) and one checkable output (a stamp + a committed ledger).
- **Context** — the measured failure: 118 Tracker runs, 7 real candidates, 0 `gap-reconcile.ts` executions across 43 Warchief runs, and no `.tribe/harness-gaps.jsonl` anywhere on the machine; leaks L1-L6 of the spec's table; the 2026-09-10 empty-fixture reproduction.
- **Decision** — `gap-gate.ts` as the single pre-PR gate; ledger policy A (owner ruling 2026-09-10); the stamp verified post-merge by the runner's D3 replay and by `verify-shipped.sh`. Name the C1/C2 split and say that C2 extends THIS unit with the Business-Flow and Governance patches.
- **Affected Topology** — one row per entity with its cite: `c3-215` (component; the tribe plugin ships the gate, the parser, the stamp module and the two new D3 points) and `c3-217` (component; verify-shipped gains the fourth check).
- **Verification** — exact commands with their expected results: `cd plugins/tribe/scripts/gaps && bun test`; `cd plugins/tribe/scripts/runner && bun test`; `bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh`; `bash plugins/tribe/scripts/tests/test-fresh-machine.sh`; `C3X_MODE=agent bash "$C3X" check`; and the empty-fixture end-to-end (`reports/gap-loop-fix/repro/build-fixture.sh`) producing one `opened` event on master.

Create it and capture the id the CLI assigns:

```bash
C3X_MODE=agent bash "$C3X" add adr harness-gap-gate --file /tmp/adr-harness-gap-gate.md --json
```

Expected: JSON naming the created entity, whose `id` is date-stamped by the tool (`adr-20260910-harness-gap-gate` when it stamps today). **Use the id the CLI returns** for every command below and report it back — never re-derive or hand-edit it.

- [ ] **Step 2: Scaffold the unit, author the three patches, apply, and check.**

```bash
C3X_MODE=agent bash "$C3X" change new <the-id-add-adr-returned>
```

Expected: it prints the created folder `.c3/changes/<id>/`.

Author exactly three patch files in that folder (frontmatter, then body; the base handles are the ones recorded in Step 1 — a `block` patch's body is JUST the replacement row, normalized to the stored cells, never the table header):

`01-c3-215-contract-gap-gate-row.patch.md` — `target: c3-215`, `scope: insert`, `base:` the handle of `c3-215`'s LAST Contract row. Body = one new row:

```
scripts/gaps/gap-gate.ts (harness-gap gate) | IN | The single pre-PR gate for the harness-gap loop, same shape as pre-gate.sh: one invocation, red/green exit code, one Markdown report, one JSON summary. bun gap-gate.ts --repo <target-repo> --home <tribe-home> --card <slug> --base <sha> [--head HEAD] [--pr <n>] [--registry .tribe/harness-gaps.jsonl] [--out <dir>]; --repo/--home/--card/--base required, no defaults. Globs every <home>/reports/tracker-<card>-*.md (zero files is a RED gate, never an empty set — that is what makes a skipped Tracker loud), parses each with the pure gap-candidates.ts against the tracker.md step-5 template and the two other real report shapes, collapses same-category overlapping-path candidates across rounds keeping the earliest round's fingerprint, reads the changed files from git at the edge, reconciles through gap-reconcile.ts as a library with the registry resolved against --repo and contained inside it, runs the debt burn-down diff, and writes <out>/<card>-gap-gate.md (the complete ## Harness gaps PR-body section ending in one machine-checkable gap-gate v1 stamp) plus <out>/<card>-gap-gate.json. Exit 0 green, 1 red (positive debt delta, or an unsafe fingerprint on a candidate this diff introduced), 2 setup error (no Tracker report, unresolvable range, unreadable ledger, registry path escaping --repo) — each exit-2 path is one typed stderr line, never a stack trace. gap-reconcile.ts gains --repo for the same resolution; ledger.ts raises a typed LedgerError naming the bad line's number. Under ledger policy A the append is committed on the card branch with the trailer Tribe-Milestone: gap-gate, so the ledger rides the PR | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/gaps/gap-gate.test.ts
```

`02-c3-215-change-safety-verify-points.patch.md` — `target: c3-215`, `scope: block`, `base:` the Change-Safety row handle. Body = that row with `six-point` corrected and the gate named:

```
Runner accepts an unshipped card, or wedges the campaign | Editing verify.ts (the D3 seven-point replay, incl. gapGateStamped and ledgerCommitted), or any gh/git invocation in the runner | Mocked seams validate logic but NOT the commands: gh api pulls/<pr> 404d in reality while 25 tests passed, which would have failed every card forever. A wrong invocation is invisible to the suite | cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit; plus execute any changed gh/git command against a real repo before trusting it
```

`03-c3-217-contract-verify-shipped-row.patch.md` — `target: c3-217`, `scope: block`, `base:` the `scripts/verify-shipped.sh` Contract row handle. Body:

```
scripts/verify-shipped.sh | IN/OUT | Read-only against git/GitHub; prints 4 pass/fail lines + verdict — pr_merged, master_in_sync, worktree_removed, and gap_gate_stamped (the merged PR body carries a gap-gate v1 stamp whose card= matches --card, spec CU-4 §3). --pr, --worktree and --card are all required: a claimed-done state with an unchecked corner is the gap this skill exists to close. Sha ancestry is deliberately not re-checked here — that is the campaign runner's gapGateStamped point, which has the merged repo in hand | shell CLI | plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
```

Preview, record judgment, land, and close:

```bash
C3X_MODE=agent bash "$C3X" change view <the-adr-id>
C3X_MODE=agent bash "$C3X" change status <the-adr-id>
C3X_MODE=agent bash "$C3X" change accept <the-adr-id>
C3X_MODE=agent bash "$C3X" change apply <the-adr-id>
C3X_MODE=agent bash "$C3X" check
```

Expected: `change view` lists three patches with no drift; `change status` reports all three `pending`; `accept` moves the ADR to `accepted`; `apply` reports three writes and lands them atomically (a drift/conflict rejection means a base handle went stale — re-read it with `read <id> --section <name> --cite`, re-author that patch's `base:`, and re-run `apply`; never hand-edit a fact); `check` prints `ok: true` with a total of at least the pre-existing `47`.

Prove the rule's own oracle (grep the after-state phrase in each target fact) rather than trusting `change status`, which the rule says reports `drifted` for applied and unapplied patches alike:

```bash
cd /Users/hip/repo/tribe && \
C3X_MODE=agent bash "$C3X" read c3-215 --full | grep -c 'gap-gate.ts (harness-gap gate)' && \
C3X_MODE=agent bash "$C3X" read c3-215 --full | grep -c 'D3 seven-point replay' && \
C3X_MODE=agent bash "$C3X" read c3-217 --full | grep -c 'gap_gate_stamped'
```

Expected: three counts, each `1` or greater.

- [ ] **Step 3: Commit** — Commit every file `apply` touched under `.c3/` together with the patch folder and the ADR.

```bash
cd /Users/hip/repo/tribe && git add .c3 && \
git commit -m 'docs(c3): ADR for the harness-gap gate, with its Contract-row patches applied' -m $'Tribe-Card: gap-gate-scripts\nTribe-Task: 7/7\nCampaign: gap-gate-2026-09-10'
```

Expected: one commit carrying the three trailers and no `Co-Authored-By`; `git status` clean afterwards.

## Evidence plan (Warchief's Method step 7 — NOT a Hunter task)

The card's own verification section is explicit that unit tests and single-agent evals are **not** evidence for this change: that is what hid the defect twice. The before/after artefact is the empty-fixture end-to-end.

- **BEFORE** — already captured, on `master` @ `dc011f9`: `~/.tribe/-Users-hip-repo-tribe/reports/gap-loop-fix/repro/repro-before.md`. The Tracker reported a four-condition candidate; the Warchief never ran `gap-reconcile.ts`; `find` for `harness-gaps.jsonl` returned nothing.
- **AFTER** — on the card branch, the same fixture, through the same harness:

```bash
bash ~/.tribe/-Users-hip-repo-tribe/reports/gap-loop-fix/repro/build-fixture.sh gap-gate-after
# then, with the card branch checked out, against the printed REPO/CAMP paths:
bun plugins/tribe/scripts/gaps/gap-gate.ts --repo "$REPO" --home "$CAMP" --card C1 --base "$SEED_SHA"
```

The AFTER transcript must show: exit 0; one `opened` event in `$REPO/.tribe/harness-gaps.jsonl`; `$CAMP/reports/C1-gap-gate.md` ending in a `gap-gate v1` stamp naming `minted=G-001`. Card goal G2 is the same command run a second time (one `seen`, no new id); G3 is the same command with the report file removed (exit 2, the frozen message). Run one of them with `--repo` given RELATIVE from a different cwd, per `fixtures-mirror-reality`.

- **G4** is proven by the two unit suites of Tasks 5 and 6 (stubbed `gh`), plus `bash plugins/verify-shipped/scripts/tests/test-verify-shipped.sh` output pasted into the PR.
- Host the transcripts the way this repo hosts evidence and verify every link in the PR body resolves before merging.

## Risk and rollback

| Risk | Detection | Mitigation |
| --- | --- | --- |
| The parser silently drops a real Tracker shape (under-parsing — the Oracle's named bug) | Task 1's three-shape tests; the gate's `unparsed` list is in the JSON summary and the PR section | Every unmappable block is reported with file and line rather than dropped; adding a shape is a new test plus a regex, in `gap-candidates.ts` alone |
| Adding two D3 points turns healthy cards red and wedges a live campaign | Task 5's whole-suite run; `VERIFY_FAILURE_BULLETS` is compiler-enforced against `VerifyPointId` | Both points fail CLOSED with a named remedy bullet; revert is one commit, and `verify.ts` is the only module that decides `shipped` |
| Making `--card` required breaks an existing `verify-shipped.sh` caller | Task 6's `--card`-omitted test asserts exit 2 with a named refusal | The only in-repo callers are prose in SKILL.md (updated in the same task) and the Shaman/mammoth-hunt prompts (card C2) |
| Two cards minting concurrently conflict on the append-only ledger | The gate re-mints against the merged ledger on re-run | Spec §4 already rules this: with the runner's default `--max-concurrent 1` it cannot happen; otherwise drop the ledger lines, rebase, re-run the gate |
| A c3 patch base handle goes stale between Step 1 and `apply` | `change apply`'s drift gate refuses before any write | Re-read the handle, re-author `base:`, re-apply — never hand-edit a frozen fact |

Rollback for the whole card is `git revert` of the merge commit: every task is one commit, no migration, and the only persistent artefact is an append-only ledger file whose absence is already a valid state everywhere.
