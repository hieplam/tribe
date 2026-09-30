// pointers.test.ts — every live file that must point to the one definition of the ways of work
// names it (card ways-of-work-review-fixes, G4; the list is card ways-of-work-consolidation's D1:
// the Warchief, orchestrate-campaign, the global CLAUDE.md snippet and the READMEs). The drift
// counter proves these files do not restate the section; this proves they point to it.
// `.c3/c3-2-plugins/c3-215-tribe.md` is left out on purpose: its pointer is issue #199's work.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const MUST_POINT = [
  'plugins/tribe/agents/warchief.md',
  'plugins/tribe/skills/orchestrate-campaign/SKILL.md',
  'plugins/tribe/claude-md/shaman-brainstorm-together.md',
  'plugins/tribe/README.md',
  'plugins/tribe/scripts/runner/README.md',
];

test.each(MUST_POINT)('%s names the "Ways of work" section of shaman.md', (path) => {
  const text = readFileSync(join(REPO_ROOT, path), 'utf8');
  expect(text).toContain('"Ways of work"');
  expect(text).toContain('shaman.md');
});
