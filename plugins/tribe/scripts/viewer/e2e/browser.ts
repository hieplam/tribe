// e2e/browser.ts — resolves a real, installed Chromium executable from Playwright's standard
// registry (spec §16.0). EDGE code (outside the D16 wall, like the rest of `e2e/`): it reads the
// filesystem and a package dependency's own resolution logic, never core/adapters/serve.ts.
//
// Fails CLOSED, never silently: a DOM e2e suite that goes green because its browser was missing
// would be exactly the proxy-proof failure this revision exists to remove (spec §16.0). This
// module therefore never returns a path it has not verified exists on disk, and never skips —
// every caller either gets a real executable path or an Error naming the one-line remedy.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const INSTALL_REMEDY = 'bunx playwright install chromium';

function noBrowserError(detail: string): Error {
  return new Error(`no Chromium executable found in Playwright's registry (${detail}) — run: ${INSTALL_REMEDY}`);
}

/** The absolute path to a real, installed Chromium executable. `playwright-core` computes this
 * from its own bundled registry metadata, honouring `PLAYWRIGHT_BROWSERS_PATH` when set and
 * falling back to the standard location (`~/Library/Caches/ms-playwright` on this machine) —
 * `playwright-core` deliberately never downloads a browser itself, which is why it (not the full
 * `playwright` package) is the dependency here. Throws with the one-line remedy, rather than
 * returning `null`/`undefined`, when nothing is installed there: a caller that forgot to check a
 * falsy return is exactly how a "browser missing" case turns into a silent skip. */
export function resolveChromiumExecutable(): string {
  let path: string;
  try {
    path = chromium.executablePath();
  } catch (e) {
    throw noBrowserError(e instanceof Error ? e.message : String(e));
  }
  if (!path || !existsSync(path)) {
    throw noBrowserError(`expected at ${path || '(empty path)'}`);
  }
  return path;
}
