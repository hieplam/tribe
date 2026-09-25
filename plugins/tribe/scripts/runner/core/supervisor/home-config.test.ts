// Tests for home-config.ts (card supervisor-home-settings-containment, spec §6.1). Oracle:
// under-matching a path Claude Code loads is a bug; over-matching a path nothing loads is by
// design. Every SURFACE row below was MEASURED live in a real session (spec §4.2-4.3) or is its
// case variant (the macOS file system is case-insensitive, spec §4.3 m2).
import { describe, expect, test } from 'bun:test';
import { isEmptyRestorePlan, isHomeConfigSurface, planHomeConfigRestore, type HomeConfigEntry } from './home-config.ts';

const SURFACES = [
  '.claude',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/CLAUDE.md',
  '.claude/skills/probeskill/SKILL.md',
  '.claude/agents/x.md',
  '.CLAUDE/settings.json',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'claude.md',
  'Claude.Local.md',
  'escalations/CLAUDE.md',
  'supervisor/deep/claude.md',
  // AGENTS.md is the CLI's memory file when the project has no CLAUDE.md — which is exactly the
  // steady state this card creates (MEASURED, card supervisor-home-settings-containment fix round 1).
  'AGENTS.md',
  'agents.md',
  'Agents.md',
  '.claude/AGENTS.md',
  'escalations/AGENTS.md',
  'supervisor/deep/agents.md',
  // MEASURED not loaded, matched anyway: `agents*.md` mirrors `claude*.md`, and over-matching a
  // path nothing loads is by design (Oracle, spec §6.1).
  'AGENTS.override.md',
  '.mcp.json',
  '.MCP.json',
  'runs/r1/.mcp.json',
  'escalations/.claude/settings.json',
];

const NOT_SURFACES = [
  '',
  'answers.md',
  'escalations/card-1.md',
  'supervisor/park/c1.json',
  'supervisor/sessions/sess-1.log',
  'final-report.md',
  'verdicts/card-1.json',
  'CLAUDE.md.bak',
  'notes/claude.txt',
  'claude-notes.json',
  'AGENTS.md.bak',
  'notes/agents.txt',
  // MEASURED not loaded (fix round 1): a `.claude.json` in the home reached neither the session's
  // context nor ran a hook it carried, and it is not inside a `.claude` segment.
  '.claude.json',
  'mcp.json',
  'runs/r1/logs/claude.log',
];

describe('isHomeConfigSurface — the campaign home paths Claude Code loads as configuration', () => {
  for (const path of SURFACES) {
    test(`${JSON.stringify(path)} is a surface`, () => {
      expect(isHomeConfigSurface(path)).toBe(true);
    });
  }
  for (const path of NOT_SURFACES) {
    test(`${JSON.stringify(path)} is not a surface`, () => {
      expect(isHomeConfigSurface(path)).toBe(false);
    });
  }
});

const file = (path: string, content: string): HomeConfigEntry => ({ path, kind: 'file', content });
const dir = (path: string): HomeConfigEntry => ({ path, kind: 'dir', content: '' });
const link = (path: string, target: string): HomeConfigEntry => ({ path, kind: 'symlink', content: target });
const paths = (entries: HomeConfigEntry[]): string[] => entries.map((e) => e.path);

describe('planHomeConfigRestore — undo every change a session made to the surface (spec §6.3)', () => {
  test('an unchanged snapshot plans nothing', () => {
    const snapshot = [dir('.claude'), file('.claude/settings.local.json', 'e30=')];
    const plan = planHomeConfigRestore(snapshot, snapshot);
    expect(isEmptyRestorePlan(plan)).toBe(true);
  });

  test('a new file is removed', () => {
    const plan = planHomeConfigRestore([], [file('CLAUDE.md', 'eA==')]);
    expect(paths(plan.remove)).toEqual(['CLAUDE.md']);
    expect(plan.write).toEqual([]);
  });

  test('a new directory is removed AFTER its contents (deepest first)', () => {
    const plan = planHomeConfigRestore([], [dir('.claude'), file('.claude/settings.json', 'eA==')]);
    expect(paths(plan.remove)).toEqual(['.claude/settings.json', '.claude']);
  });

  test('a changed pre-existing file is rewritten with its old content', () => {
    const plan = planHomeConfigRestore([file('CLAUDE.md', 'b2xk')], [file('CLAUDE.md', 'bmV3')]);
    expect(plan.remove).toEqual([]);
    expect(plan.write).toEqual([file('CLAUDE.md', 'b2xk')]);
  });

  test('a deleted pre-existing file is rewritten, its directory first (shallowest first)', () => {
    const plan = planHomeConfigRestore([dir('.claude'), file('.claude/settings.local.json', 'e30=')], []);
    expect(paths(plan.write)).toEqual(['.claude', '.claude/settings.local.json']);
  });

  test('a directory replaced by a symlink: the symlink is removed, the directory and file rewritten', () => {
    const before = [dir('.claude'), file('.claude/settings.local.json', 'e30=')];
    const after = [link('.claude', '/Users/someone/.claude')];
    const plan = planHomeConfigRestore(before, after);
    expect(paths(plan.remove)).toEqual(['.claude']);
    expect(paths(plan.write)).toEqual(['.claude', '.claude/settings.local.json']);
  });

  test('a pre-existing symlink that is unchanged is left alone; a new one is removed', () => {
    const before = [link('link-out', '/tmp/outside')];
    const after = [link('link-out', '/tmp/outside'), link('escalations', '/tmp/evil')];
    const plan = planHomeConfigRestore(before, after);
    expect(paths(plan.remove)).toEqual(['escalations']);
    expect(plan.write).toEqual([]);
  });
});
