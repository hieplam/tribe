// gap-reconcile.test.ts — the nine spec §6a scenarios (design doc §3 pseudocode + §6a list).
//
// Each test builds a real temp-dir fixture registry file AND a real fixture repo tree on disk
// (spec §6a: "fixture registry + fixture repo tree"), because reconciliation matches by
// EXECUTING the frozen fingerprint via real `grep` (Bun.spawn, no shell) — not by comparing
// strings. Every test cleans up its own temp dir so tests never pollute the real repo or each
// other.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseLedger, type OpenedEvent, type RuledEvent, type Disposition } from './ledger.ts';
import { reconcile, resolveRegistryPath, GapReconcileError, type Candidate } from './gap-reconcile.ts';

/** Creates a fresh temp dir, runs `fn` against it, then always removes it — so a failing
 * assertion never leaks a fixture dir onto the real filesystem. */
async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gap-reconcile-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes `content` to `dir/relPath`, creating parent directories as needed — builds the
 * "fixture repo tree" that real `grep` invocations run against. */
function writeFixtureFile(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/** Writes raw JSONL lines (already-serialized events) as the pre-existing registry — used to
 * seed a registry independent of `ledger.ts`'s own serializer, so these tests exercise
 * `gap-reconcile.ts` against a registry shaped exactly like spec §3's JSONL example. */
function seedRegistry(dir: string, lines: object[]): string {
  const registryPath = join(dir, '.tribe', 'harness-gaps.jsonl');
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  return registryPath;
}

function readRegistryText(registryPath: string): string {
  return readFileSync(registryPath, 'utf8');
}

describe('gap-reconcile — spec §6a scenario 1', () => {
  test('empty registry + one candidate mints G-001, opened event, fingerprint frozen verbatim', async () => {
    await withTmpDir(async (dir) => {
      const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
      const registryPath = join(dir, '.tribe', 'harness-gaps.jsonl'); // does not exist yet
      const candidateFingerprint = `grep -rn 'catch {}' ${join(dir, 'src/handlers')}/`;
      const candidates: Candidate[] = [
        {
          category: 'error-handling',
          paths: [`${join(dir, 'src/handlers')}/`],
          fingerprint: candidateFingerprint,
          hits: 9,
          description: 'handlers swallow errors in a bare catch',
        },
      ];

      const result = await reconcile({ registryPath, changedFiles: [handlerFile], candidates });

      expect(result).toEqual({ matched: [], minted: ['G-001'], suppressed_count: 0, flagged: [] });

      const events = parseLedger(readRegistryText(registryPath));
      expect(events).toHaveLength(1);
      const opened = events[0] as OpenedEvent;
      expect(opened.id).toBe('G-001');
      expect(opened.event).toBe('opened');
      expect(opened.fingerprint).toBe(candidateFingerprint); // frozen verbatim, not re-derived
      expect(opened.category).toBe('error-handling');
      expect(opened.hits_at_detection).toBe(9);
    });
  });
});

describe('gap-reconcile — spec §6a scenario 2', () => {
  test('open entry whose fingerprint fires on a changed file appends seen, mints no new id', async () => {
    await withTmpDir(async (dir) => {
      const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
      const handlersDir = `${join(dir, 'src/handlers')}/`;
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [handlersDir],
          fingerprint: `grep -rn 'catch {}' ${handlersDir}`,
          hits_at_detection: 9,
          first_seen_pr: 61,
        },
      ]);
      const originalBytes = readRegistryText(registryPath);

      const result = await reconcile({ registryPath, changedFiles: [handlerFile], candidates: [] });

      expect(result.matched).toEqual(['G-001']);
      expect(result.minted).toEqual([]);
      expect(result.flagged).toEqual([]);

      const events = parseLedger(readRegistryText(registryPath));
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(parseLedger(originalBytes)[0]);
      expect(events[1]).toMatchObject({ id: 'G-001', event: 'seen' });
    });
  });
});

describe('gap-reconcile — spec §6a scenario 3 (load-bearing)', () => {
  test('same gap re-reported with different prose/regex still matches via the stored fingerprint, never the candidate\'s own', async () => {
    await withTmpDir(async (dir) => {
      const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
      const handlersDir = `${join(dir, 'src/handlers')}/`;
      const storedFingerprint = `grep -rn 'catch {}' ${handlersDir}`;
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [handlersDir],
          fingerprint: storedFingerprint,
          hits_at_detection: 9,
          first_seen_pr: 61,
        },
      ]);

      // A different sighting: different prose AND a different regex that would NOT match this
      // file's content ("catch (err)" never appears) — if reconciliation ran the CANDIDATE's
      // own fingerprint instead of the stored one, or compared prose, this would wrongly mint
      // a duplicate id. Same category + overlapping paths as G-001, on purpose.
      const driftedCandidate: Candidate = {
        category: 'error-handling',
        paths: [handlersDir],
        fingerprint: `grep -rn 'catch \\(err\\)' ${handlersDir}`,
        hits: 11,
        description: 'error handlers discard the caught exception object entirely',
      };

      const result = await reconcile({
        registryPath,
        changedFiles: [handlerFile],
        candidates: [driftedCandidate],
      });

      expect(result.matched).toEqual(['G-001']);
      expect(result.minted).toEqual([]); // NOT a new id, despite the drifted candidate
      expect(result.flagged).toEqual([]);

      const events = parseLedger(readRegistryText(registryPath));
      expect(events).toHaveLength(2); // opened (pre-existing) + seen — no opened for a new id
      expect(events[1]).toMatchObject({ id: 'G-001', event: 'seen' });
    });
  });
});

describe('gap-reconcile — spec §6a scenario 4', () => {
  test('stale fingerprint (no hits on changed files) mints a new id — documented duplicate path', async () => {
    await withTmpDir(async (dir) => {
      // The pattern was refactored away — the file the entry's paths cover no longer contains it.
      const handlerFile = writeFixtureFile(
        dir,
        'src/handlers/payment.ts',
        'try { doWork(); } catch (err) { logger.warn(err); }\n',
      );
      const handlersDir = `${join(dir, 'src/handlers')}/`;
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [handlersDir],
          fingerprint: `grep -rn 'catch {}' ${handlersDir}`, // stale: no longer fires
          hits_at_detection: 9,
          first_seen_pr: 61,
        },
      ]);

      const candidates: Candidate[] = [
        {
          category: 'error-handling',
          paths: [handlersDir],
          fingerprint: `grep -rn 'catch {}' ${handlersDir}`,
          hits: 9,
          description: 'handlers swallow errors in a bare catch',
        },
      ];

      const result = await reconcile({ registryPath, changedFiles: [handlerFile], candidates });

      expect(result.matched).toEqual([]); // stale fingerprint never fired -> no seen
      expect(result.minted).toEqual(['G-002']); // duplicate id, visible & documented
      expect(result.flagged).toEqual([]);

      const events = parseLedger(readRegistryText(registryPath));
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ id: 'G-001', event: 'opened' }); // untouched
      expect(events[1]).toMatchObject({ id: 'G-002', event: 'opened' });
    });
  });
});

describe('gap-reconcile — spec §6a scenario 5', () => {
  const dispositions: Disposition[] = ['rule', 'anti-rule', 'debt', 'dismissed', 'dismissed-duplicate'];

  for (const disposition of dispositions) {
    test(`ruled entry (${disposition}) is suppressed even when its fingerprint still fires`, async () => {
      await withTmpDir(async (dir) => {
        const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
        const handlersDir = `${join(dir, 'src/handlers')}/`;
        const registryPath = seedRegistry(dir, [
          {
            id: 'G-001',
            event: 'opened',
            category: 'error-handling',
            paths: [handlersDir],
            fingerprint: `grep -rn 'catch {}' ${handlersDir}`, // would fire if executed
            hits_at_detection: 9,
            first_seen_pr: 61,
          },
          { id: 'G-001', event: 'ruled', disposition, ref: 'some-ref' } satisfies RuledEvent,
        ]);
        const originalBytes = readRegistryText(registryPath);

        const result = await reconcile({ registryPath, changedFiles: [handlerFile], candidates: [] });

        expect(result.matched).toEqual([]);
        expect(result.minted).toEqual([]);
        expect(result.flagged).toEqual([]);
        expect(result.suppressed_count).toBe(1); // relevant to this diff, but ruled

        // Append-only invariant holds here too: nothing was appended at all for a suppressed id.
        expect(readRegistryText(registryPath)).toBe(originalBytes);
      });
    });
  }
});

describe('gap-reconcile — spec §6a scenario 6', () => {
  test('sequential ids: next id = max existing + 1, including after suppressed/ruled entries', async () => {
    await withTmpDir(async (dir) => {
      const unrelatedFile = writeFixtureFile(dir, 'src/other/thing.ts', 'export const x = 1;\n');
      const handlersDir = `${join(dir, 'src/handlers')}/`;
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [handlersDir],
          fingerprint: `grep -rn 'catch {}' ${handlersDir}`,
          hits_at_detection: 9,
          first_seen_pr: 61,
        },
        { id: 'G-001', event: 'ruled', disposition: 'anti-rule', ref: 'rule-no-bare-catch' } satisfies RuledEvent,
        {
          id: 'G-002',
          event: 'opened',
          category: 'resource-cleanup',
          paths: [handlersDir],
          fingerprint: `grep -rn 'leak' ${handlersDir}`,
          hits_at_detection: 5,
          first_seen_pr: 62,
        },
        { id: 'G-002', event: 'ruled', disposition: 'debt', ref: 'debt-note' } satisfies RuledEvent,
      ]);

      const candidates: Candidate[] = [
        {
          category: 'test-presence',
          paths: [`${join(dir, 'src/other')}/`],
          fingerprint: `grep -rln 'TODO' ${join(dir, 'src/other')}/`,
          hits: 4,
          description: 'new, unrelated pattern',
        },
      ];

      const result = await reconcile({ registryPath, changedFiles: [unrelatedFile], candidates });

      expect(result.minted).toEqual(['G-003']); // skips past both ruled ids
    });
  });
});

describe('gap-reconcile — spec §6a scenario 7 (load-bearing, append-only invariant)', () => {
  test('pre-existing ledger lines stay byte-identical after a run that both matches and mints', async () => {
    await withTmpDir(async (dir) => {
      const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
      const otherFile = writeFixtureFile(dir, 'src/other/thing.ts', 'export const x = 1;\n');
      const handlersDir = `${join(dir, 'src/handlers')}/`;
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [handlersDir],
          fingerprint: `grep -rn 'catch {}' ${handlersDir}`,
          hits_at_detection: 9,
          first_seen_pr: 61,
        },
        { id: 'G-001', event: 'seen', pr: 64, hits_now: 10 },
      ]);
      const originalBytes = readRegistryText(registryPath);

      const candidates: Candidate[] = [
        {
          category: 'test-presence',
          paths: [`${join(dir, 'src/other')}/`],
          fingerprint: `grep -rln 'TODO' ${join(dir, 'src/other')}/`,
          hits: 4,
          description: 'brand new pattern, unrelated to G-001',
        },
      ];

      const result = await reconcile({
        registryPath,
        changedFiles: [handlerFile, otherFile],
        candidates,
      });

      // Sanity: this run really did both append a `seen` (match) and mint+append (new id) —
      // otherwise the prefix check below would be trivially true.
      expect(result.matched).toEqual(['G-001']);
      expect(result.minted).toEqual(['G-002']);

      const newBytes = readRegistryText(registryPath);
      expect(newBytes.length).toBeGreaterThan(originalBytes.length);
      expect(newBytes.slice(0, originalBytes.length)).toBe(originalBytes); // byte-for-byte prefix
    });
  });
});

describe('gap-reconcile — spec §6a scenario 8', () => {
  test('open entry outside the changed files\' scope: its fingerprint never runs (not even validated)', async () => {
    await withTmpDir(async (dir) => {
      const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
      const otherDir = `${join(dir, 'src/other')}/`;
      // Deliberately malformed/malicious fingerprint on an entry whose paths do NOT overlap the
      // changed files — if the path-overlap filter ran AFTER validation (or not at all), this
      // would show up as `flagged`. It must not: the entry is skipped before validation.
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [otherDir],
          fingerprint: `grep -rn 'x' ${otherDir}; rm -rf /tmp/should-never-run`,
          hits_at_detection: 3,
          first_seen_pr: 61,
        },
      ]);
      const originalBytes = readRegistryText(registryPath);

      const result = await reconcile({ registryPath, changedFiles: [handlerFile], candidates: [] });

      expect(result.matched).toEqual([]);
      expect(result.minted).toEqual([]);
      expect(result.flagged).toEqual([]); // never even reached validation, so never flagged either
      expect(result.suppressed_count).toBe(0);
      expect(readRegistryText(registryPath)).toBe(originalBytes); // nothing appended
    });
  });
});

describe('gap-reconcile — spec §6a scenario 9', () => {
  test('fingerprint containing shell metacharacters is rejected, flagged, and never executed', async () => {
    await withTmpDir(async (dir) => {
      const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
      const handlersDir = `${join(dir, 'src/handlers')}/`;
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [handlersDir],
          // in scope this time (paths overlap changed files) — must be rejected on content, not filtered out
          fingerprint: `grep -rn 'catch {}' ${handlersDir}; rm -rf /tmp/should-never-run`,
          hits_at_detection: 9,
          first_seen_pr: 61,
        },
      ]);
      const originalBytes = readRegistryText(registryPath);

      const result = await reconcile({ registryPath, changedFiles: [handlerFile], candidates: [] });

      expect(result.matched).toEqual([]);
      expect(result.minted).toEqual([]);
      expect(result.flagged).toHaveLength(1);
      expect(result.flagged[0]).toContain('G-001');
      expect(readRegistryText(registryPath)).toBe(originalBytes); // never executed -> nothing appended
    });
  });

  test('fingerprint that is not a single grep invocation is rejected, flagged, and never executed', async () => {
    await withTmpDir(async (dir) => {
      const handlerFile = writeFixtureFile(dir, 'src/handlers/payment.ts', "try {} catch {}\n");
      const handlersDir = `${join(dir, 'src/handlers')}/`;
      const registryPath = seedRegistry(dir, [
        {
          id: 'G-001',
          event: 'opened',
          category: 'error-handling',
          paths: [handlersDir],
          fingerprint: `cat ${handlersDir}payment.ts`, // no shell metachars, but not `grep`
          hits_at_detection: 9,
          first_seen_pr: 61,
        },
      ]);
      const originalBytes = readRegistryText(registryPath);

      const result = await reconcile({ registryPath, changedFiles: [handlerFile], candidates: [] });

      expect(result.matched).toEqual([]);
      expect(result.minted).toEqual([]);
      expect(result.flagged).toHaveLength(1);
      expect(result.flagged[0]).toContain('G-001');
      expect(readRegistryText(registryPath)).toBe(originalBytes);
    });
  });
});

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
