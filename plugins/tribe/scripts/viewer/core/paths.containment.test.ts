import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isContainedResolved } from './paths.ts';

// The RESOLVED containment stage (D14/D32) — the stage lexical containment cannot cover, because
// a symlink INSIDE root can still point outside it. Built against a REAL filesystem shape rather
// than hand-typed strings (fixtures mirror reality): the one symlink measured on this machine
// (spec §0, §12.2) is a subagent sidecar pointing at the same agent file under a SIBLING session
// in the same projects root — that exact shape is reproduced here and must be ACCEPTED, while
// every path resolving outside the root must be REFUSED. `isContainedResolved` does no
// filesystem access itself; every `realpathSync` call below stands in for the adapter (task 15).

describe('isContainedResolved — resolved stage', () => {
  let tmp: string;
  let root: string; // the resolved projects root — taken as a PARAMETER, per D14/D32
  let evilDir: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'paths-containment-'));
    mkdirSync(join(tmp, 'projects'), { recursive: true });
    mkdirSync(join(tmp, 'evil'), { recursive: true });
    root = realpathSync(join(tmp, 'projects'));
    evilDir = realpathSync(join(tmp, 'evil'));

    // proj-A/session-1/subagents/agent-real.jsonl — an ordinary, non-symlinked file.
    const session1Subagents = join(root, 'proj-A', 'session-1', 'subagents');
    mkdirSync(session1Subagents, { recursive: true });
    writeFileSync(join(session1Subagents, 'agent-real.jsonl'), '{}');

    // proj-A/session-2/subagents/agent-real2.jsonl — the target of the sibling-session symlink.
    const session2Subagents = join(root, 'proj-A', 'session-2', 'subagents');
    mkdirSync(session2Subagents, { recursive: true });
    writeFileSync(join(session2Subagents, 'agent-real2.jsonl'), '{}');

    // The real measured shape (spec §0/§12.2): session-1's sidecar symlinks to session-2's agent
    // file — a SIBLING session inside the SAME projects root. Accept.
    symlinkSync(join(session2Subagents, 'agent-real2.jsonl'), join(session1Subagents, 'agent-sidecar.jsonl'));

    // A file symlinked to somewhere entirely outside the root. Refuse.
    symlinkSync(evilDir, join(root, 'proj-A', 'escaping-link'));

    // A symlinked PROJECT DIRECTORY whose target is outside the root. Refuse — this is why
    // resolved containment covers directory discovery, not only file reads (spec §12.2).
    symlinkSync(evilDir, join(root, 'proj-evil'));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('accepts a sidecar symlinked to a sibling session inside the projects root (the real shape)', () => {
    const resolved = realpathSync(join(root, 'proj-A', 'session-1', 'subagents', 'agent-sidecar.jsonl'));
    expect(isContainedResolved(root, resolved)).toBe(true);
  });

  test('refuses a symlink resolving outside the root ("/tmp/evil")', () => {
    const resolved = realpathSync(join(root, 'proj-A', 'escaping-link'));
    expect(isContainedResolved(root, resolved)).toBe(false);
  });

  test('refuses a prefix-collision: root-evil is not inside root despite sharing a string prefix', () => {
    const collidingSibling = `${root}-evil`;
    expect(isContainedResolved(root, join(collidingSibling, 'file.jsonl'))).toBe(false);
  });

  test('refuses a symlinked project directory whose target is outside the root', () => {
    const resolved = realpathSync(join(root, 'proj-evil'));
    expect(isContainedResolved(root, resolved)).toBe(false);
  });

  test('accepts an ordinary non-symlinked file inside the root — a check that refuses everything proves nothing', () => {
    const resolved = realpathSync(join(root, 'proj-A', 'session-1', 'subagents', 'agent-real.jsonl'));
    expect(isContainedResolved(root, resolved)).toBe(true);
  });
});
