// Unit tests for the two guards the G2 ratchet rests on (fix round 2, findings m3 and m2). Each
// decides whether a writer session's plant really happened; a guard that can be satisfied without a
// plant makes every pair in `home-config.e2e.test.ts` pass VACUOUSLY — which is exactly what fix
// round 1's finding M1 measured of `isGenuineListing`'s predecessor. They live in their own file,
// not in the real-session file, so they run on every `bun test` without RUN_SESSION_E2E and without
// spending a token. Importing that file registers its four pairs here too; they are
// `skipIf(!RUN_E2E)`.
import { describe, expect, test } from 'bun:test';
import { isAttemptedWriteToSurface, isGenuineListing } from './home-config.e2e.test.ts';

const HOME = '/private/var/folders/x/T/shsc-e2e-closing-bash-AbCdEf';
const TARGETS = [
  `${HOME}/.claude/settings.json`,
  `${HOME}/.claude/settings.local.json`,
  `${HOME}/CLAUDE.md`,
  `${HOME}/CLAUDE.local.md`,
  `${HOME}/AGENTS.md`,
];

describe('isGenuineListing (the Bash writer plant-landed guard)', () => {
  test("a real `ls -1` listing of every target is genuine", () => {
    expect(isGenuineListing(`${TARGETS.join('\n')}\n`, TARGETS)).toBe(true);
  });

  // Both shapes fix round 1 MEASURED on a home where nothing was planted: `ls` names every missing
  // path in its stderr and the tool_result carries stderr, so substring presence — the guard M1
  // replaced — was `true` for a total planting FAILURE.
  test.each([
    ['one `ls:` line naming every target', `ls: ${TARGETS.join(' ')}: No such file or directory`],
    ['one `ls:` line per target', TARGETS.map((target) => `ls: ${target}: No such file or directory`).join('\n')],
  ])('the MEASURED `ls` failure text (%s) is NOT genuine', (_shape, failure) => {
    expect(TARGETS.every((target) => failure.includes(target))).toBe(true); // the defect, pinned
    expect(isGenuineListing(failure, TARGETS)).toBe(false);
  });

  test('the prompt echoed back is NOT genuine', () => {
    // The prompt itself contains every target on one `ls -1 <paths>` line, and a transcript can
    // echo it; one line holding all five is not five lines each holding one.
    expect(isGenuineListing(`ls -1 ${TARGETS.join(' ')}`, TARGETS)).toBe(false);
  });

  test('one missing target makes the listing not genuine', () => {
    expect(isGenuineListing(TARGETS.slice(1).join('\n'), TARGETS)).toBe(false);
  });

  test('surrounding output and indentation do not defeat a genuine listing', () => {
    const listing = `  ${TARGETS.join('\n  ')}\n\nWROTE=5`;
    expect(isGenuineListing(listing, TARGETS)).toBe(true);
  });
});

// Fix round 2, finding m2: this guard's comment claimed it proved an attempted Write to a SURFACE
// while the code only checked that the path started with the home, so a Write to any ordinary file
// in the home satisfied it — and a Write-writer pair whose only Write went to `<home>/notes.txt`
// would have proven nothing about the refusal it exists to measure.
describe('isAttemptedWriteToSurface (the Write writer attempt guard)', () => {
  test.each([
    ['a settings file in .claude', `${HOME}/.claude/settings.json`],
    ['the root memory file', `${HOME}/CLAUDE.md`],
    ['the default memory file', `${HOME}/AGENTS.md`],
    ['a nested memory file', `${HOME}/escalations/AGENTS.md`],
    ['a project MCP config', `${HOME}/.mcp.json`],
  ])('a Write to a configuration surface in the home counts (%s)', (_what, file) => {
    expect(isAttemptedWriteToSurface(file, HOME)).toBe(true);
  });

  test.each([
    ['an ordinary file in the home', `${HOME}/notes.txt`],
    ['the file every reader reads', `${HOME}/answers.md`],
    ['the home itself', HOME],
    ['a surface OUTSIDE the home', '/Users/somebody/.claude/settings.json'],
  ])('a Write that is not to a surface in the home does NOT count (%s)', (_what, file) => {
    expect(isAttemptedWriteToSurface(file, HOME)).toBe(false);
  });

  // Fix round 3, Scout P4: the row above shares no prefix with the home, so it passed for the
  // WRONG reason — `startsWith` alone rejects `/Users/somebody/...`. A SIBLING directory is the
  // input class that separates a prefix test from containment, and it is the exact case
  // `permit.ts`'s own header comment names: "a string PREFIX is not containment — `<home>-sibling`
  // must DENY". MEASURED by the Scout against these modules: the guard said `true` for
  // `<home>-sibling/.claude/settings.json` while production `containPath` said `false`, so a Write
  // that layer 1 denies for a DIFFERENT reason (outside the home) and layer 2 never touches
  // satisfied `writerAttempted` — a vacuous pass for a home where nothing was planted.
  test('a surface in a SIBLING directory sharing the home name as a string prefix does NOT count', () => {
    const sibling = `${HOME}-sibling/.claude/settings.json`;
    expect(sibling.startsWith(HOME)).toBe(true); // the defect, pinned: the prefix test says inside
    expect(isAttemptedWriteToSurface(sibling, HOME)).toBe(false);
  });
});
