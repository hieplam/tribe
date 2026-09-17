// e2e/campaign-badge.e2e.test.ts — G3, spec §16.4 (E3). The one proof that a REAL campaign
// runner run, on real Haiku 4.5, prints the two stdout lines character-for-character, that the
// printed session URL actually renders in a real browser, and that a session claimed by TWO
// campaigns (the same shape spec §9 measures on this machine: two repo keys sharing one slug)
// renders TWO badges and both filter correctly. Nothing here is stubbed or simulated — this test
// authors a throwaway git repo, drives `bun plugins/tribe/scripts/runner/run.ts` for real, and
// drives a real headless Chromium against the runner's own auto-spawned viewer.
//
// Opt-in behind `TRIBE_VIEWER_E2E=1` (`test.skipIf(!ENABLED)`, the same pattern
// `live-tail.e2e.test.ts`/`perf.test.ts` use) so a plain `bun test` never spawns a runner, a
// session, or a browser.
//
// Task 27 already wired the runner's viewer integration (the two stdout lines, `--viewer-port`);
// the client already renders badges/filters (core/badge.ts, CampaignBadge.tsx, SessionList.tsx).
// This file authors ONLY the end-to-end proof against that already-shipped system — no production
// code changes.
//
// Roots (spec §16.4 step 2, D32c): `.tribe` comes from the fake `HOME` (`homeB`) this test
// `mkdtemp`s — the owner's real `~/.tribe` is never written, read, or touched. `.claude` is the
// REAL config dir: the runner's real Haiku session must write where its credentials live, so the
// runner subprocess is spawned with `HOME=<homeB>` (for `.tribe`) AND `CLAUDE_CONFIG_DIR=<real
// .claude>` (for credentials/session storage) — both explicit on the child's own env, never
// inherited implicitly. This suite takes NO digest of the real config dir (D32c) and asserts only
// against the session id the runner itself created.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { resolveChromiumExecutable } from './browser.ts';

const ENABLED = process.env.TRIBE_VIEWER_E2E === '1';

const VIEWER_DIR = join(import.meta.dir, '..');
const RUN_TS = join(VIEWER_DIR, '..', 'runner', 'run.ts');
const TRIBE_HOME_SH = join(VIEWER_DIR, '..', 'tribe-home.sh');
const EVIDENCE_DIR = join(VIEWER_DIR, '..', '..', '..', '..', 'docs', 'tribe', 'planning', 'viewer-consolidation', 'evidence');

const VIEWER_PORT = 4399; // spec §16.4 step 4 — never the default 4321.
const MODEL = 'claude-haiku-4-5-20251001';
const SESSION_TIMEOUT = '6m';
const CAMPAIGN_SLUG = 'e2e-campaign-badge';
// Any second key (spec §16.4 step 2: "any second key the test writes directly") — never derived
// from a real repo, unlike repoKeyA.
const REPO_KEY_B = '-e2e-campaign-badge-fixture-repo-b';
const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

const GIT_FIXTURE_IDENTITY = ['-c', 'user.email=e2e-fixture@example.com', '-c', 'user.name=E2E Fixture'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T | null> | T | null, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== null && v !== undefined && v !== false) return v as T;
    last = v;
    await sleep(200);
  }
  throw new Error(`${label}: timed out after ${timeoutMs}ms (last observed: ${JSON.stringify(last)})`);
}

/** Isolates THIS test's own `git` subprocess calls from the host's global/system config
 * (fail-closed-edges.md obligation 2) — an unusual-but-legal host setting (`commit.gpgsign=true`
 * with no usable key, a global hooks path) must never change whether the fixture repo commits
 * cleanly or a test's verdict. */
function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  return env;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, env: gitEnv(), timeout: 15_000, encoding: 'utf8' });
}

/** Refuses (never clears) an occupied port — spec §16.4 step 4: "Port ownership is a
 * precondition, not a thing to clear." */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', (err: NodeJS.ErrnoException) => {
      srv.close();
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`refusing to run: port ${port} is already in use — free it or stop whatever is bound there (this suite never kills an occupant, spec §16.4 step 4)`));
      } else {
        reject(err);
      }
    });
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve());
    });
  });
}

/** Spec §16.4 step 1: a throwaway target repo — `mkdtemp`, `git init`, one trivial file, a
 * fixture identity, and the card's spec+plan (whose Global Constraints force a `hunter`
 * dispatch, spec §16.4 step 3). `git remote -v` is asserted empty by the caller. */
function buildThrowawayRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'vc-badge-repo-'));
  runGit(['init', '-q', '-b', 'master'], repo);

  writeFileSync(join(repo, 'README.md'), '# E2E fixture repo\n\nThrowaway target repo for campaign-badge.e2e.test.ts (spec §16.4).\n');
  writeFileSync(
    join(repo, 'spec.md'),
    [
      '# E2E fixture spec — campaign-badge (viewer-consolidation Task 32)',
      '',
      'This is a throwaway target repository, created solely to drive one real Haiku 4.5',
      'executor session for `campaign-badge.e2e.test.ts` (spec §16.4). It exists for exactly one',
      'run and is deleted immediately afterward.',
      '',
      '## Goal',
      '',
      'Append exactly one line to `README.md` (documenting that the fixture line was added) and',
      'commit it. Nothing else.',
      '',
      '## Note on the pull request wall',
      '',
      'This repo has **no git remote at all** (`git remote -v` is empty, deliberately — spec',
      '§16.4). A pull request can never be opened here. Once the one line is committed locally,',
      'stop and report `NEEDS_DIRECTION: no git remote configured on this throwaway fixture repo',
      '— a PR can never be opened here by design (spec §16.4)`. Do not attempt to add a remote,',
      'and do not spend further turns retrying `gh pr create`.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(repo, 'plan.md'),
    [
      '# Plan — campaign-badge fixture card C1',
      '',
      '## Global Constraints',
      '',
      '- Dispatch each implementation/fix task to the `hunter` subagent — never a generic',
      '  implementer.',
      '- This one-line documentation change needs no test suite of its own; keep the diff to',
      '  exactly the line described below.',
      '',
      '## Task 1: Append the fixture line',
      '',
      '- [ ] Dispatch a `hunter` subagent (via the `Task` tool) to append the line',
      '      `E2E fixture: campaign-badge (Task 32).` to the end of `README.md`, then have it',
      '      commit that change locally with a normal commit message. No remote exists — never',
      '      attempt to add one or to open a pull request for this card (see spec.md).',
      '',
    ].join('\n'),
  );

  runGit(['add', '-A'], repo);
  runGit([...GIT_FIXTURE_IDENTITY, 'commit', '-q', '-m', 'init fixture repo (campaign-badge e2e, task 32)'], repo);

  const remotes = runGit(['remote', '-v'], repo).trim();
  expect(remotes).toBe(''); // spec §16.4 step 1: no remote, deliberately — a PR can never open here.

  return repo;
}

/** `<repoKeyA>` is EXACTLY what `tribe-home.sh <repo>` prints for the throwaway repo, run with
 * `HOME=<homeB>` so its own printed root matches this suite's fake HOME (spec §16.4 step 2) — the
 * script always prints `$HOME/.tribe/<key>`; the trailing path segment is the key this suite
 * needs. Never hardcoded. */
function resolveRepoKeyA(repoDir: string, homeB: string): string {
  const printed = execFileSync('bash', [TRIBE_HOME_SH, repoDir], {
    env: { ...gitEnv(), HOME: homeB },
    timeout: 15_000,
    encoding: 'utf8',
  }).trim();
  const expectedPrefix = join(homeB, '.tribe') + '/';
  if (!printed.startsWith(expectedPrefix)) {
    throw new Error(`tribe-home.sh printed an unexpected root: ${printed} (expected it to start with ${expectedPrefix})`);
  }
  return basename(printed);
}

interface CardRecord {
  status: string;
  spec: string | null;
  plan: string | null;
  branch: string | null;
  baseSha: string | null;
  pr: number | null;
  mergeSha: string | null;
  sessionId: string | null;
  updatedAt: string | null;
}

function stagedCardA(): CardRecord {
  return { status: 'staged', spec: 'spec.md', plan: 'plan.md', branch: null, baseSha: null, pr: null, mergeSha: null, sessionId: null, updatedAt: null };
}

/** Campaign A's state — the shape the runner's own zod schema requires (`core/state.ts`,
 * `runner/`), so the real `--dry-run`/real pass can load it (spec §16.4 step 2/step 4). */
function writeCampaignAHome(homeADir: string): void {
  mkdirSync(homeADir, { recursive: true });
  const state = {
    v: 1,
    campaign: CAMPAIGN_SLUG,
    mergePolicy: 'merge',
    sequence: ['C1'],
    schemaLockPaths: [],
    docsOnlyPaths: [],
    ownerOnlyEscalations: [],
    cards: { C1: stagedCardA() },
  };
  writeFileSync(join(homeADir, 'campaign-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(join(homeADir, 'answers.md'), '# Answers\n\n(no rulings recorded for this fixture campaign)\n');
}

/** Campaign B's state — campaign B's collision twin (spec §16.4 step 2): the shape the VIEWER's
 * badge scan needs (`core/badge.ts`'s loose `CampaignScan`, never the runner's strict schema —
 * the runner is never invoked against B). `sessionId` starts `null` and is filled in later, once
 * the real id exists (spec §16.4's numbered "how B comes to list the same session id" steps). */
function writeCampaignBHome(homeBDir: string): void {
  mkdirSync(homeBDir, { recursive: true });
  const state = {
    v: 1,
    campaign: CAMPAIGN_SLUG,
    sequence: ['C1'],
    cards: {
      C1: {
        status: 'shipped', // distinct from A's live status, purely for readability in a screenshot
        spec: 'spec.md',
        plan: 'plan.md',
        sessionId: null as string | null,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  writeFileSync(join(homeBDir, 'campaign-state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function readCardASessionId(stateAPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(stateAPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { cards?: Record<string, { sessionId?: unknown }> };
    const sid = parsed.cards?.C1?.sessionId;
    return typeof sid === 'string' && SESSION_ID_RE.test(sid) ? sid : null;
  } catch {
    return null; // mid-write (atomic rename should prevent this, but never throw on a race)
  }
}

/** Copies A's REAL, runner-assigned session id into B's own fixture file (spec §16.4's "how B
 * comes to list the same session id" — one write, by the test, to its own fixture; never a
 * fabricated id). */
function copySessionIdIntoB(stateBPath: string, sessionId: string): void {
  const raw = readFileSync(stateBPath, 'utf8');
  const parsed = JSON.parse(raw) as { cards: Record<string, { sessionId: string | null }> };
  parsed.cards.C1.sessionId = sessionId;
  writeFileSync(stateBPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function realConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.length > 0
    ? process.env.CLAUDE_CONFIG_DIR
    : join(homedir(), '.claude');
}

interface RunnerHandle {
  proc: ChildProcess;
  stdoutLines: string[];
  stderrLines: string[];
  exited: Promise<number | null>;
}

/** Spawns the real runner (`bun run.ts`), NOT detached-from-us but with its OWN process group
 * (`detached: true`) so teardown can kill the group by pid — spec §16.4 step 6. Every stdout/
 * stderr line is captured verbatim, as it arrives, into an array this test can grep. */
function spawnRunner(args: string[], env: Record<string, string | undefined>): RunnerHandle {
  const fullEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) fullEnv[k] = v;

  const proc = spawn('bun', [RUN_TS, ...args], { env: fullEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let stdoutBuf = '';
  let stderrBuf = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const parts = stdoutBuf.split('\n');
    stdoutBuf = parts.pop() ?? '';
    for (const line of parts) stdoutLines.push(line);
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const parts = stderrBuf.split('\n');
    stderrBuf = parts.pop() ?? '';
    for (const line of parts) stderrLines.push(line);
  });

  const exited = new Promise<number | null>((resolve) => {
    proc.on('exit', (code) => {
      if (stdoutBuf) stdoutLines.push(stdoutBuf);
      if (stderrBuf) stderrLines.push(stderrBuf);
      resolve(code);
    });
  });

  return { proc, stdoutLines, stderrLines, exited };
}

/** Best-effort discovery of the viewer's own detached child pid — spec §16.4 step 6 forbids
 * finding it "by whatever holds port 4399"; this instead walks the real process tree (`pgrep -P
 * <runnerPid>`) while the runner is still its parent (the viewer is spawned within the first
 * moments of `main()`, well before any card session starts). `null` on a genuine failure to find
 * it (never thrown) — teardown simply has nothing to kill in that case. */
async function findViewerChildPid(runnerPid: number, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync('pgrep', ['-P', String(runnerPid), '-f', 'serve.ts'], { timeout: 5000, encoding: 'utf8' }).trim();
      if (out) {
        const pid = Number(out.split('\n')[0]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
    } catch {
      // pgrep exits 1 when nothing (yet) matches — keep polling.
    }
    await sleep(300);
  }
  return null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function captureScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  try {
    await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: true });
  } catch (e) {
    console.error(`campaign-badge: screenshot ${name} could not be captured: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function rowCount(page: Page): Promise<number> {
  return page.$$eval('.session-row', (els) => els.length);
}

let browser: Browser | null = null;

beforeAll(async () => {
  if (!ENABLED) return;
  browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
});

afterAll(async () => {
  if (browser) await browser.close();
});

describe('campaign-badge.e2e — G3, spec §16.4', () => {
  test.skipIf(!ENABLED)(
    'a real Haiku 4.5 campaign run: both stdout lines, the printed session URL, two badges, the click leg, the filter, and runnerAlive:false after exit',
    async () => {
      if (browser === null) throw new Error('browser was not launched (ENABLED guard bug)');
      const b = browser;

      await assertPortFree(VIEWER_PORT); // spec §16.4 step 4 — a precondition, never cleared.

      const commands: string[] = [];
      const repo = buildThrowawayRepo();
      commands.push(`mkdtemp + git init -b master ${repo}`);

      const homeB = mkdtempSync(join(tmpdir(), 'vc-badge-home-'));
      const repoKeyA = resolveRepoKeyA(repo, homeB);
      const repoKeyB = REPO_KEY_B;
      const homeADir = join(homeB, '.tribe', repoKeyA, 'campaigns', CAMPAIGN_SLUG);
      const homeBDir = join(homeB, '.tribe', repoKeyB, 'campaigns', CAMPAIGN_SLUG);
      const stateAPath = join(homeADir, 'campaign-state.json');
      const stateBPath = join(homeBDir, 'campaign-state.json');

      writeCampaignAHome(homeADir);
      writeCampaignBHome(homeBDir);

      const cfgDir = realConfigDir();
      if (!existsSync(cfgDir)) {
        throw new Error(`campaign-badge e2e: no real Claude config dir at ${cfgDir} — this suite needs a real, logged-in Claude Code install (D32c)`);
      }
      const runnerEnv = { ...process.env, HOME: homeB, CLAUDE_CONFIG_DIR: cfgDir };

      let runnerHandle: RunnerHandle | null = null;
      let viewerPid: number | null = null;
      let page: Page | null = null;

      try {
        // -----------------------------------------------------------------------------------
        // A `--dry-run` validation pass FIRST (spec §16.4 step 4).
        // -----------------------------------------------------------------------------------
        const dryRunArgs = ['--repo', repo, '--model', MODEL, '--home', homeADir, '--session-timeout', SESSION_TIMEOUT, '--viewer-port', String(VIEWER_PORT), '--dry-run'];
        commands.push(`HOME=${homeB} CLAUDE_CONFIG_DIR=${cfgDir} bun ${RUN_TS} ${dryRunArgs.join(' ')}`);
        const dryRun = execFileSync('bun', [RUN_TS, ...dryRunArgs], { env: runnerEnv, timeout: 30_000, encoding: 'utf8' });
        const dryRunPlan = JSON.parse(dryRun) as { cardId?: string };
        expect(dryRunPlan.cardId).toBe('C1');

        // -----------------------------------------------------------------------------------
        // The real run (spec §16.4 step 4).
        // -----------------------------------------------------------------------------------
        const realArgs = ['--repo', repo, '--model', MODEL, '--home', homeADir, '--session-timeout', SESSION_TIMEOUT, '--viewer-port', String(VIEWER_PORT)];
        commands.push(`HOME=${homeB} CLAUDE_CONFIG_DIR=${cfgDir} bun ${RUN_TS} ${realArgs.join(' ')}`);
        runnerHandle = spawnRunner(realArgs, runnerEnv);
        const runnerPid = runnerHandle.proc.pid;
        if (runnerPid === undefined) throw new Error('campaign runner: spawn did not report a pid');

        viewerPid = await findViewerChildPid(runnerPid, 20_000);
        if (viewerPid === null) {
          console.warn('campaign-badge e2e: could not discover the viewer child pid via pgrep — teardown will not be able to kill it directly');
        }

        const rootLine = await waitFor(
          () => runnerHandle!.stdoutLines.find((l) => l.startsWith('campaign viewer: ')) ?? null,
          30_000,
          'the "campaign viewer: ..." stdout line never appeared',
        );
        const expectedRootLine = `campaign viewer: http://127.0.0.1:${VIEWER_PORT}/?campaign=${encodeURIComponent(repoKeyA)}/${encodeURIComponent(CAMPAIGN_SLUG)} (read-only)`;
        expect(rootLine).toBe(expectedRootLine); // spec §16.4 step 5 — verbatim.
        const rootUrl = rootLine.slice('campaign viewer: '.length, rootLine.length - ' (read-only)'.length);

        // A direct, OS-level proof that this is a real, running process (never stubbed) — taken
        // BEFORE waiting for it to finish, decoupled from any DOM/badge state.
        await waitFor(() => readCardASessionId(stateAPath), 120_000, 'cards.C1.sessionId never became non-null in campaign A\'s state file');
        expect(processAlive(runnerPid)).toBe(true);

        // Haiku 4.5 can retry a `stopped`/retryable outcome (`core/loop/run-loop.ts`'s
        // `runCardTurn`, up to 2 retries) — each retry re-derives the phase and can be handed a
        // DIFFERENT session id by the SDK, so `cards.C1.sessionId` is NOT stable the instant it
        // first appears. Spec §16.4's "poll until non-null, then copy" is safe only once the id
        // has settled — which is guaranteed the moment the runner process itself exits (nothing
        // can write to campaign-state.json after that). So: wait for the full run to finish
        // first, THEN read the FINAL id and copy that into B — the id this suite asserts against
        // really is the one the runner settled on, never a transient mid-retry one B could never
        // have raced correctly anyway.
        const exitCode = await runnerHandle.exited;
        commands.push(`(runner exited with code ${exitCode})`);
        const sessionId = readCardASessionId(stateAPath);
        if (sessionId === null) throw new Error('campaign A\'s state file has no sessionId even after the runner exited');
        copySessionIdIntoB(stateBPath, sessionId);

        // The LAST `card C1: ...<this id>` line — the one that describes the id the run actually
        // settled on (a retry can print the same shape for an earlier, discarded id too).
        const cardLine = [...runnerHandle.stdoutLines].reverse().find((l) => l === `card C1: http://127.0.0.1:${VIEWER_PORT}/s/${sessionId}`);
        if (cardLine === undefined) {
          throw new Error(`no "card C1: ..." stdout line matches the final sessionId ${sessionId}; captured lines: ${JSON.stringify(runnerHandle.stdoutLines)}`);
        }
        const expectedCardLine = `card C1: http://127.0.0.1:${VIEWER_PORT}/s/${sessionId}`;
        expect(cardLine).toBe(expectedCardLine); // spec §16.4 step 5 — verbatim.

        // -----------------------------------------------------------------------------------
        // The printed session URL, opened for real (spec §16.4 step 5).
        // -----------------------------------------------------------------------------------
        page = await b.newPage();
        await page.setViewportSize({ width: 1100, height: 700 });
        const sessionUrl = cardLine.slice('card C1: '.length);
        await page.goto(sessionUrl);
        await waitFor(() => (page!.$('[data-testid="session-load-error"]').then((el) => (el === null ? true : null))), 15_000, 'the printed session URL rendered a load error (a 404-shaped failure)');
        await waitFor(() => page!.$$eval('[data-row-id]', (els) => (els.length > 0 ? els.length : null)), 20_000, 'the printed session URL never rendered any row');

        // -----------------------------------------------------------------------------------
        // The badged list (spec §16.4 step 5): navigate to the EXACT printed root URL. The
        // runner has already exited by this point, so both badges' runner state is already
        // "runner dead" here — the SAME fact spec §16.4 step 5's "after the runner exits, a
        // reload shows runnerAlive: false" names, checked at its first opportunity rather than a
        // second time redundantly.
        // -----------------------------------------------------------------------------------
        await page.goto(rootUrl);
        await waitFor(() => rowCount(page!).then((n) => (n > 0 ? n : null)), 20_000, 'the badged list never rendered any session row');
        expect(await rowCount(page)).toBe(1); // exactly the one collision session (spec §16.4 step 2).
        const badgeCount = await page.$$eval('.campaign-badge', (els) => els.length);
        expect(badgeCount).toBe(2); // neither badge dropped (spec §16.4 step 5).

        const badgeTexts = await page.$$eval('.campaign-badge', (els) =>
          els.map((el) => ({
            slug: el.querySelector('.campaign-badge__slug')?.textContent ?? '',
            card: el.querySelector('.campaign-badge__card')?.textContent ?? '',
            status: el.querySelector('.campaign-badge__status')?.textContent ?? '',
            runner: el.querySelector('.campaign-badge__runner')?.textContent ?? '',
          })),
        );
        for (const t of badgeTexts) {
          expect(t.slug).toBe(CAMPAIGN_SLUG);
          expect(t.card).toBe('C1');
          expect(t.runner).toBe('runner dead'); // spec §16.4 step 5 — after the runner exits.
        }

        await captureScreenshot(page, 'campaign-badge-list.png');

        // -----------------------------------------------------------------------------------
        // The click leg (spec §16.4 step 5): a REAL click on the DOM element, not a component
        // test. Clicking writes `?campaign=<repoKey>/<slug>` via `history.pushState` — `App`
        // only listens to `popstate`, so the visible row count is unaffected by the click alone;
        // that the URL updated at all is the proof a real click happened.
        // -----------------------------------------------------------------------------------
        const rowCountBeforeClick = await rowCount(page);
        await page.click('.campaign-badge');
        // No literal `location` TYPE name: this package's tsconfig carries no DOM lib (client/src
        // is the only place that does — see `live-tail.e2e.test.ts`'s `scrollTopOf` for the same
        // note), so `globalThis`'s structural shape is read instead.
        const searchAfterClick = await page.evaluate(() => (globalThis as unknown as { location: { search: string } }).location.search);
        const expectedSearchA = `?campaign=${encodeURIComponent(repoKeyA)}/${encodeURIComponent(CAMPAIGN_SLUG)}`;
        const expectedSearchB = `?campaign=${encodeURIComponent(repoKeyB)}/${encodeURIComponent(CAMPAIGN_SLUG)}`;
        expect([expectedSearchA, expectedSearchB]).toContain(searchAfterClick);
        expect(await rowCount(page)).toBe(rowCountBeforeClick); // pushState alone never re-filters.

        // -----------------------------------------------------------------------------------
        // The filter leg (spec §16.4 step 5): a real navigation with each pair, proving the
        // filter matches on (repoKey, slug), never the slug alone.
        // -----------------------------------------------------------------------------------
        await page.goto(`${rootUrl.split('?')[0]}?campaign=${encodeURIComponent(repoKeyA)}/${encodeURIComponent(CAMPAIGN_SLUG)}`);
        await waitFor(() => rowCount(page!).then((n) => (n > 0 ? n : null)), 20_000, 'campaign A\'s filter never rendered the collision session');
        expect(await rowCount(page)).toBe(1);
        await captureScreenshot(page, 'campaign-badge-filtered.png');

        await page.goto(`${rootUrl.split('?')[0]}?campaign=${encodeURIComponent(repoKeyB)}/${encodeURIComponent(CAMPAIGN_SLUG)}`);
        await waitFor(() => rowCount(page!).then((n) => (n > 0 ? n : null)), 20_000, 'campaign B\'s filter never rendered the collision session');
        expect(await rowCount(page)).toBe(1);

        // Negative control: a correct repoKey with the WRONG slug must exclude the session
        // entirely — proving the filter really is a (repoKey, slug) PAIR match, not repoKey alone.
        await page.goto(`${rootUrl.split('?')[0]}?campaign=${encodeURIComponent(repoKeyA)}/${encodeURIComponent('no-such-slug')}`);
        await waitFor(() => page!.$('.session-list__empty'), 20_000, 'a mismatched-slug filter never showed the empty-list message');
        expect(await rowCount(page)).toBe(0);

        // -----------------------------------------------------------------------------------
        // Evidence (spec §16.4 step 6 / §16.6).
        // -----------------------------------------------------------------------------------
        mkdirSync(EVIDENCE_DIR, { recursive: true });
        writeFileSync(
          join(EVIDENCE_DIR, 'campaign-badge-commands.md'),
          [
            '# campaign-badge.e2e.test.ts — commands actually run (Task 32, spec §16.4)',
            '',
            ...commands.map((c) => `    ${c}`),
            '',
            '## Captured stdout lines (verbatim)',
            '',
            `    ${rootLine}`,
            `    ${cardLine}`,
            '',
            `sessionId: ${sessionId}`,
            `repoKeyA: ${repoKeyA}`,
            `repoKeyB: ${repoKeyB}`,
            `runner exit code: ${exitCode}`,
            '',
          ].join('\n'),
        );
      } finally {
        // Teardown (spec §16.4 step 6), all of it here: kill ONLY the pids this test spawned —
        // never "whatever holds port 4399".
        if (page) await page.close().catch(() => {});
        if (viewerPid !== null && processAlive(viewerPid)) {
          try {
            process.kill(viewerPid, 'SIGTERM');
          } catch {
            // Already gone — nothing to do.
          }
        }
        if (runnerHandle) {
          const runnerPid = runnerHandle.proc.pid;
          if (runnerPid !== undefined && processAlive(runnerPid)) {
            try {
              process.kill(-runnerPid, 'SIGTERM'); // the runner's own process GROUP (detached: true above).
            } catch {
              // Already gone — nothing to do.
            }
          }
        }
        rmSync(repo, { recursive: true, force: true });
        rmSync(homeB, { recursive: true, force: true }); // both campaign homes live under here — exact path, never a glob.
      }
    },
    540_000,
  );
});
