---
id: rule-temp-dir-cleanup
c3-seal: 067420ebd17bd84a0b97a07226e9d6e3ec692b16efbf8e562cb5bb04cc1704e6
title: temp-dir-cleanup
type: rule
goal: |-
    Every test in this repo that materialises a real temporary directory removes it again, even when
    an assertion inside the test fails. A suite that leaks `mkdtemp` trees accumulates thousands of
    stale directories under the system temp dir across a campaign's fix rounds, and on a developer
    machine those survive reboots — so a leak is never noticed until the disk is. This holds across
    all 20 `*.test.ts` files that call `mkdtempSync` in `plugins/tribe/scripts/viewer` today.
---

## Goal

Every test in this repo that materialises a real temporary directory removes it again, even when
an assertion inside the test fails. A suite that leaks `mkdtemp` trees accumulates thousands of
stale directories under the system temp dir across a campaign's fix rounds, and on a developer
machine those survive reboots — so a leak is never noticed until the disk is. This holds across
all 20 `*.test.ts` files that call `mkdtempSync` in `plugins/tribe/scripts/viewer` today.

## Rule

Every `mkdtempSync` directory a test creates is removed by `rmSync(dir, { recursive: true, force: true })` from a cleanup path that still runs when an assertion throws — a `finally` block or an `afterEach`/`afterAll` hook, never a bare trailing statement.

## Golden Example

Two literal shapes, both from `plugins/tribe/scripts/viewer/adapters/fs.adapter.test.ts`.

Suite-scoped fixture — hook pair (`fs.adapter.test.ts:23`):

```ts
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'fs-adapter-'));          // REQUIRED — created in the hook
  buildHomeA(home);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });             // REQUIRED — runs after a failed test too
});
```

Test-scoped fixture — `try`/`finally` (`fs.adapter.test.ts:144`):

```ts
test('returns null for a broken symlink', () => {
  const brokenDir = mkdtempSync(join(tmpdir(), 'fs-adapter-broken-'));   // REQUIRED
  const brokenLink = join(brokenDir, 'broken.jsonl');
  symlinkSync(join(brokenDir, 'does-not-exist.jsonl'), brokenLink);
  try {
    expect(realpathOrNull(brokenLink)).toBeNull();                        // the assertion may throw
  } finally {
    rmSync(brokenDir, { recursive: true, force: true });                  // REQUIRED — the finally
  }
});
```

`recursive: true` (REQUIRED — fixtures are trees, not empty dirs) and `force: true` (REQUIRED — a
test that already removed part of the tree must not fail the cleanup itself). The name prefix
passed to `mkdtempSync` is OPTIONAL but conventionally names the suite.

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| const d = mkdtempSync(...); ...assertions...; rmSync(d, ...) as the last statement | Wrap the assertions in try / finally { rmSync(d, ...) } | The first failing assertion throws past the cleanup line, so exactly the runs that leak are the runs that fail — leaks concentrate in the red builds nobody cleans up after |
| rmSync(d, { recursive: true }) without force | rmSync(d, { recursive: true, force: true }) | A test that removed part of its own fixture makes the cleanup itself throw, converting a passing test into a failing one and STILL leaving the parent dir behind |
| Relying on the OS to reap the system temp dir | Remove the directory the test created | macOS reaps /var/folders only on a schedule measured in days; a campaign's fix rounds create thousands of trees in an afternoon |
| Creating the temp dir at module top level with no hook to remove it | Create it in beforeAll / beforeEach with the matching afterAll / afterEach | A module-level fixture has no cleanup site at all, so it always leaks |

## Scope

Applies to every `*.test.ts` / `*.test.tsx` in the repo that calls `mkdtempSync` (or any other
real-filesystem fixture root it creates). It does not apply to production code: the one runtime
`mkdtempSync` call site, `plugins/tribe/scripts/gaps/gap-rule.ts:166`, already follows the same
`try`/`finally` shape and is covered by the same reasoning. It says nothing about in-memory
fixtures, which need no cleanup.

## Override

A test that deliberately asserts on the *absence* of cleanup, or that hands the directory's
lifetime to a spawned child process outliving the test, may keep the directory — but must name the
owner that removes it in a comment at the creation site. "The suite is short" is not an override.
