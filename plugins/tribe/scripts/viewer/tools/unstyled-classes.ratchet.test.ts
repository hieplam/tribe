// tools/unstyled-classes.ratchet.test.ts — the committed ceiling. Runs the pure core over the REAL
// client sources and fails if the number of unstyled classes rises above the baseline. As styling
// tasks land they lower UNSTYLED_CEILING toward 0; it may only ever move DOWN.
import { expect, test } from 'bun:test';
import { collectSources, findUnstyledClasses } from './unstyled-classes.ts';

// Today's measured baseline, from `bun tools/unstyled-classes.ts`: unstyled 70 of 74 (2026-09-19).
const UNSTYLED_CEILING = 70;

test('the real client stays at or below the committed unstyled-class ceiling', () => {
  const { tsxSources, cssSources } = collectSources();
  const { used, unstyled } = findUnstyledClasses(tsxSources, cssSources);

  // A scanner that finds nothing must not pass this gate (empty-implementation guard).
  expect(used.length).toBeGreaterThan(0);

  if (unstyled.length > UNSTYLED_CEILING) {
    throw new Error(
      `unstyled ${unstyled.length} exceeds ceiling ${UNSTYLED_CEILING} — lower the ceiling only by ` +
        `STYLING these classes, never by raising it:\n  ${unstyled.join('\n  ')}`,
    );
  }
});
