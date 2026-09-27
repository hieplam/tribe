/**
 * tools/badge-probe.ts — G5 (card supervisor-sessions-in-repo, spec §5): a REAL browser reads
 * each session page's `.campaign-badge` element, so G5 is proven by what a person would actually
 * see, not by a stub that could pass with no badge rendered at all. `tools/` sits outside the
 * viewer's D16 purity wall (`structure.test.ts`'s `OUTSIDE` list) — this file freely touches the
 * filesystem and a real browser, exactly what a one-off measurement script is for.
 *
 * Usage:
 *   bun tools/badge-probe.ts --base <url> --slug <slug> [--shots <dir>] <sessionId>...
 *
 * For every session id: navigates to `<base>/s/<id>`, waits up to 5s for `.campaign-badge` to
 * appear, reads every badge's inner text, screenshots the page to `<shots>/<id8>.png`, and prints
 * one JSON line `{"id":…,"badges":[…],"pass":bool}` — `pass` is true when some badge's text
 * contains the `--slug` value AND one of `ruling`/`ratify`/`closing`. The last line is
 * `G5 <passed>/<total>`.
 */
import { chromium, type Locator, type Page } from 'playwright-core';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChromiumExecutable } from '../e2e/browser.ts';

const CHROME_FALLBACK_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KNOWN_FLAGS = new Set(['--base', '--slug', '--shots']);
const STATUS_PATTERN = /ruling|ratify|closing/;
const BADGE_SELECTOR = '.campaign-badge';
const BADGE_WAIT_MS = 5000;

interface Args {
  base: string;
  slug: string;
  shots: string;
  ids: string[];
}

interface BadgeResult {
  id: string;
  badges: string[];
  pass: boolean;
}

/** Prints exactly one stderr line and exits 2 — every refusal in this file goes through this one
 * function (spec's fail-closed-edges obligation: a probe must fail closed, never with a stack
 * trace or an ambiguous crash). */
function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

/** Parses `process.argv` for `--base`/`--slug`/`--shots` plus trailing bare session-id tokens.
 * Never lets a flag's own value be another flag's name — an unknown flag, or a flag whose next
 * token is itself flag-shaped or missing, refuses by name rather than silently consuming the
 * next argv token as a value (`fail-closed-edges.md` obligation 1). */
function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let base: string | undefined;
  let slug: string | undefined;
  let shots: string | undefined;
  const ids: string[] = [];
  let i = 0;
  while (i < args.length) {
    const token = args[i]!;
    if (token.startsWith('--')) {
      if (!KNOWN_FLAGS.has(token)) fail(`badge-probe: unknown flag ${token}`);
      const value = args[i + 1];
      const valueMissing = value === undefined || value.startsWith('--');
      if (valueMissing) fail(`badge-probe: ${token} expects a value`);
      if (token === '--base') base = value;
      else if (token === '--slug') slug = value;
      else shots = value;
      i += 2;
    } else {
      ids.push(token);
      i += 1;
    }
  }
  if (base === undefined) fail('badge-probe: --base is required');
  if (slug === undefined) fail('badge-probe: --slug is required');
  return { base, slug, shots: shots ?? mkdtempSync(join(tmpdir(), 'badge-probe-')), ids };
}

/** Resolves a real, installed Chromium executable: Playwright's own registry
 * (`resolveChromiumExecutable`) first, else the system Google Chrome by `executablePath` when it
 * exists on disk, else exit 2 naming both candidates (spec §5.1: Playwright's own Chromium is not
 * installed on this host, which is exactly why the system-Chrome fallback exists). */
function resolveExecutable(): string {
  try {
    return resolveChromiumExecutable();
  } catch (playwrightError) {
    if (existsSync(CHROME_FALLBACK_PATH)) return CHROME_FALLBACK_PATH;
    const detail = playwrightError instanceof Error ? playwrightError.message : String(playwrightError);
    fail(`badge-probe: no Chromium found — Playwright registry: ${detail}; system Chrome not found at ${CHROME_FALLBACK_PATH}`);
  }
}

/** Waits up to `BADGE_WAIT_MS` for `.campaign-badge` to appear. A session with no badge at all
 * (the honest BEFORE case this probe measures) times out here — that is not a probe defect, so
 * only the timeout is swallowed; any other failure (a crashed page, a closed browser) propagates
 * (`fail-closed-edges.md` obligation 1: catch narrowly, never bare). */
async function waitForBadgeOrTimeout(page: Page): Promise<void> {
  try {
    await page.waitForSelector(BADGE_SELECTOR, { timeout: BADGE_WAIT_MS });
  } catch (e) {
    if (!(e instanceof Error) || e.name !== 'TimeoutError') throw e;
  }
}

async function probeOne(page: Page, base: string, slug: string, id: string, shotsDir: string): Promise<BadgeResult> {
  await page.goto(`${base}/s/${id}`);
  await waitForBadgeOrTimeout(page);
  const badgeLocator: Locator = page.locator(BADGE_SELECTOR);
  const badges = await badgeLocator.allInnerTexts();
  await page.screenshot({ path: join(shotsDir, `${id.slice(0, 8)}.png`) });
  const pass = badges.some((text) => text.includes(slug) && STATUS_PATTERN.test(text));
  return { id, badges, pass };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  mkdirSync(args.shots, { recursive: true });
  const executablePath = resolveExecutable();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    let passed = 0;
    for (const id of args.ids) {
      const result = await probeOne(page, args.base, args.slug, id, args.shots);
      console.log(JSON.stringify(result));
      if (result.pass) passed += 1;
    }
    console.log(`G5 ${passed}/${args.ids.length}`);
  } finally {
    await browser.close();
  }
}

main();
