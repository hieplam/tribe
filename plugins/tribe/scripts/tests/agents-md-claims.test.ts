import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('AGENTS.md claims', () => {
  test('never claims there is a bare c3 or c3x executable', () => {
    const agentsMdPath = resolve(import.meta.dir, '../../../../AGENTS.md');
    const content = readFileSync(agentsMdPath, 'utf-8');

    // False claim pattern: backticked invocation of c3/c3x as a shell command.
    // Examples: `c3 lookup`, `c3 query`, `which c3`, `c3x`.
    // These should NOT appear in the file.
    // The oracle: match the false CLAIM (backticked shell-style invocation),
    // NOT legitimate uses like "c3 skill", "`c3` skill", ".c3/", "skill name `c3`".

    // Pattern 1: `c3 <subcommand>` — backtick, c3 or c3x, space, word
    // e.g., `c3 lookup`, `c3 query`, `c3 audit`, `c3x`
    const falseClaimPattern = /`c3x?\s+\w+/;
    const match1 = content.match(falseClaimPattern);
    expect(match1).toBe(
      null,
      `Found false claim: ${match1?.[0]}. AGENTS.md should not promise a bare c3/c3x executable invocation.`
    );

    // Pattern 2: `which c3` or `which c3x` — asking which c3
    const whichPattern = /`which\s+c3x?`/;
    const match2 = content.match(whichPattern);
    expect(match2).toBe(
      null,
      `Found false claim: ${match2?.[0]}. AGENTS.md should not promise a bare c3/c3x executable.`
    );
  });
});
