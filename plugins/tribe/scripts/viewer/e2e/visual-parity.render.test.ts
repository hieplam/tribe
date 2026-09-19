// e2e/visual-parity.render.test.ts — unit test for the ONE piece of pure logic in the
// visual-parity capture script: assembling the side-by-side comparison index.html from a list
// of already-captured screenshot descriptors (pure core; everything else in visual-parity.ts is
// impure edge — spawning the server, driving Chromium, writing PNGs — and is proved by actually
// running the script, not here). Importing the script must NOT start a capture: the script guards
// its entry point behind `import.meta.main`, so this import only pulls in the pure function.
import { describe, expect, test } from 'bun:test';
import { renderIndexHtml, type SchemeBlock } from './visual-parity.ts';

const BLOCKS: SchemeBlock[] = [
  {
    scheme: 'light',
    rows: [
      { caption: 'Session list', livePng: 'live-list-light.png', refPng: 'ref-c-light.png' },
      { caption: 'Project page', livePng: 'live-project-light.png', refPng: null },
    ],
  },
  {
    scheme: 'dark',
    rows: [{ caption: 'One session', livePng: 'live-session-dark.png', refPng: 'ref-d-dark.png' }],
  },
];

describe('renderIndexHtml — the side-by-side comparison page', () => {
  test('is a complete standalone HTML document', () => {
    const html = renderIndexHtml(BLOCKS);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  test('has a heading per colour scheme', () => {
    const html = renderIndexHtml(BLOCKS);
    expect(html).toMatch(/>\s*light\s*</i);
    expect(html).toMatch(/>\s*dark\s*</i);
  });

  test('a row with both live and reference shots pairs them and carries its caption', () => {
    const html = renderIndexHtml(BLOCKS);
    expect(html).toContain('src="live-list-light.png"');
    expect(html).toContain('src="ref-c-light.png"');
    expect(html).toContain('Session list');
  });

  test('a row with no reference shot still renders the live shot and says the reference is absent', () => {
    const html = renderIndexHtml(BLOCKS);
    expect(html).toContain('src="live-project-light.png"');
    // No fabricated reference image for a live screen the preview does not show.
    expect(html).not.toContain('src="ref-project');
    expect(html).toMatch(/no preview reference/i);
  });

  test('every image is referenced relatively — no leading slash, no file:// URL', () => {
    const html = renderIndexHtml(BLOCKS);
    const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src.startsWith('/')).toBe(false);
      expect(src.startsWith('file:')).toBe(false);
      expect(src.includes('://')).toBe(false);
    }
  });

  test('is labelled BEFORE by default and AFTER when asked — the page never claims the wrong set', () => {
    const before = renderIndexHtml(BLOCKS);
    expect(before).toContain('— BEFORE');
    expect(before).toContain('live (before)');
    const after = renderIndexHtml(BLOCKS, 'after');
    expect(after).toContain('— AFTER');
    expect(after).toContain('live (after)');
    expect(after).not.toMatch(/before/i);
  });
});
