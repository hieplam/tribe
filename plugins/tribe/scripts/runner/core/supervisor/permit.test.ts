// Tests for permit.ts (Task 13, spec §5.1/§19.4): the least-privilege containment hook —
// "the ONLY enforcement there is" (S-P12). Over-denying is by design (Oracle, owner decision 4:
// a `Write`/`Edit` whose resolved target is not inside the campaign home is DENIED for a
// `ruling`/`ratify` session); one escaped write is the defect.
import { expect, test, describe } from 'bun:test';
import { buildContainmentHook, containPath, decideContainmentHook } from './permit.ts';

const HOME = '/abs/home/.tribe/key/campaigns/slug';
const ev = (tool: string, input: Record<string, unknown>) => ({ tool_name: tool, tool_input: input });
const denied = (d: ReturnType<typeof decideContainmentHook>) =>
  d.hookSpecificOutput?.permissionDecision === 'deny';

// Plan Task 13, Step 1 — verbatim table.
const ROWS: Array<[string, Record<string, unknown>, boolean]> = [
  ['Write', { file_path: `${HOME}/answers.md` }, false],
  ['Write', { file_path: `${HOME}/supervisor/park/c1.json` }, false],
  ['Write', { file_path: '/abs/repo/src/index.ts' }, true],
  ['Write', { file_path: `${HOME}/../other/answers.md` }, true],
  ['Edit', { file_path: `${HOME}/../../escape.md` }, true],
  ['Write', { file_path: 'relative/path.md' }, true],
  ['Read', { file_path: '/abs/repo/src/index.ts' }, false],
  ['Bash', { command: 'rm -rf /' }, true],
  ['Write', {}, true],
  ['Write', { file_path: `${HOME}-sibling/answers.md` }, true],
];

for (const [tool, input, wantDeny] of ROWS) {
  test(`${tool} ${JSON.stringify(input)} -> ${wantDeny ? 'deny' : 'allow'}`, () => {
    expect(denied(decideContainmentHook(HOME, ev(tool, input)))).toBe(wantDeny);
  });
}

test('a malformed event denies rather than throwing', () => {
  expect(denied(decideContainmentHook(HOME, null))).toBe(true);
});

test('an undefined event denies rather than throwing', () => {
  expect(denied(decideContainmentHook(HOME, undefined))).toBe(true);
});

// R13.1 (spec §5.1's allowedTools row grants `Grep`/`Glob` to ruling/ratify sessions, verbatim:
// "`Read`, `Grep`, `Glob`, `Write`, `Edit` (ruling/ratify)"). They are read-only — cannot write —
// so, like `Read`, they must be ALLOWED regardless of any `path` argument. Under-granting a
// granted read-only tool is the bug (see this file's header comment on the Oracle direction).
describe('Grep/Glob — granted, read-only tools (R13.1)', () => {
  test('Grep with no path is allowed', () => {
    expect(decideContainmentHook(HOME, ev('Grep', {}))).toEqual({});
  });

  test('Grep with a path OUTSIDE the home is still allowed — it is read-only', () => {
    expect(decideContainmentHook(HOME, ev('Grep', { path: '/abs/repo/src' }))).toEqual({});
  });

  test('Glob with no path is allowed', () => {
    expect(decideContainmentHook(HOME, ev('Glob', {}))).toEqual({});
  });

  test('Glob with a path OUTSIDE the home is still allowed — it is read-only', () => {
    expect(decideContainmentHook(HOME, ev('Glob', { path: '/abs/repo/src' }))).toEqual({});
  });
});

// R13.1 message accuracy: a denial must name the ACTUAL reason. A default-deny (a tool that is
// not granted at all, e.g. Bash) must NOT claim the write-containment reason — the two denial
// paths carry distinct text.
describe('deny() reason accuracy (R13.1)', () => {
  test('a Write/Edit outside the home carries the containment reason', () => {
    const decision = decideContainmentHook(HOME, ev('Write', { file_path: '/abs/repo/src/index.ts' }));
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toMatch(/campaign home/i);
  });

  test('a non-granted tool (Bash) carries a DIFFERENT reason — not the write-containment message', () => {
    const decision = decideContainmentHook(HOME, ev('Bash', { command: 'rm -rf /' }));
    const writeDecision = decideContainmentHook(HOME, ev('Write', { file_path: '/abs/repo/src/index.ts' }));
    expect(decision.hookSpecificOutput?.permissionDecisionReason).not.toBe(
      writeDecision.hookSpecificOutput?.permissionDecisionReason,
    );
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toMatch(/not granted/i);
  });
});

describe('containPath — the pure decision (segment containment, never a string prefix)', () => {
  test('a target under the home is contained', () => {
    expect(containPath(`${HOME}/answers.md`, HOME)).toBe(true);
  });

  test('a sibling directory sharing the home as a STRING PREFIX is not contained', () => {
    // The exact case containHome's segment comparison already learned (watchdog): `<home>-sibling`
    // is not inside `<home>` even though the string starts with it.
    expect(containPath(`${HOME}-sibling/answers.md`, HOME)).toBe(false);
  });

  test('a lexical .. escape is resolved before the containment check runs', () => {
    expect(containPath(`${HOME}/../../escape.md`, HOME)).toBe(false);
  });

  test('a relative target is denied outright — it cannot be judged against an absolute root', () => {
    expect(containPath('relative/path.md', HOME)).toBe(false);
  });
});

describe('buildContainmentHook — the impure edge (injected realpath, the symlink case)', () => {
  function fakeRealpath(map: Record<string, string>): (path: string) => string {
    return (path: string) => map[path] ?? path; // unresolved candidates come back unchanged
  }

  test('a target under <home>/link-out/x whose link-out resolves OUTSIDE the home -> DENY', async () => {
    const hook = buildContainmentHook(HOME, {
      realpath: fakeRealpath({ [`${HOME}/link-out`]: '/outside/escaped' }),
    });
    const decision = await hook(ev('Write', { file_path: `${HOME}/link-out/x` }));
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  test('the SAME path shape whose link-out resolves INSIDE the home -> ALLOW', async () => {
    // The pair a lexical-only check gets wrong: without resolving the symlink, both rows above
    // look identical (`<home>/link-out/x`), so a check that never resolves it cannot tell them
    // apart — this pair is the proof that it did.
    const hook = buildContainmentHook(HOME, {
      realpath: fakeRealpath({ [`${HOME}/link-out`]: `${HOME}/real-dir` }),
    });
    const decision = await hook(ev('Write', { file_path: `${HOME}/link-out/x` }));
    expect(decision).toEqual({});
  });

  test('a plain contained write with no symlink anywhere in the chain -> ALLOW', async () => {
    const hook = buildContainmentHook(HOME, { realpath: fakeRealpath({}) });
    const decision = await hook(ev('Write', { file_path: `${HOME}/answers.md` }));
    expect(decision).toEqual({});
  });

  test('a plain repo write with no symlink anywhere in the chain -> DENY', async () => {
    const hook = buildContainmentHook(HOME, { realpath: fakeRealpath({}) });
    const decision = await hook(ev('Write', { file_path: '/abs/repo/src/index.ts' }));
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  test('Read is allowed anywhere without ever calling realpath (no fs access needed)', async () => {
    let called = false;
    const hook = buildContainmentHook(HOME, {
      realpath: (p: string) => {
        called = true;
        return p;
      },
    });
    const decision = await hook(ev('Read', { file_path: '/abs/repo/src/index.ts' }));
    expect(decision).toEqual({});
    expect(called).toBe(false);
  });

  test('a relative file_path is denied without ever calling realpath', async () => {
    let called = false;
    const hook = buildContainmentHook(HOME, {
      realpath: (p: string) => {
        called = true;
        return p;
      },
    });
    const decision = await hook(ev('Write', { file_path: 'relative/x' }));
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(called).toBe(false);
  });

  test('a realpath that throws (e.g. a broken/unresolvable link) fails closed, never throws', async () => {
    const hook = buildContainmentHook(HOME, {
      realpath: () => {
        throw new Error('ELOOP: too many symbolic links');
      },
    });
    await expect(hook(ev('Write', { file_path: `${HOME}/link-out/x` }))).resolves.toEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }),
      }),
    );
  });

  test('a malformed event denies rather than throwing', async () => {
    const hook = buildContainmentHook(HOME, { realpath: (p: string) => p });
    const decision = await hook(null);
    expect(decision.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
