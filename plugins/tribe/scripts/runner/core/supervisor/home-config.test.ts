// Tests for home-config.ts (card supervisor-home-settings-containment, spec §6.1). Oracle:
// under-matching a path Claude Code loads is a bug; over-matching a path nothing loads is by
// design. Every SURFACE row below was MEASURED live in a real session (spec §4.2-4.3) or is its
// case variant (the macOS file system is case-insensitive, spec §4.3 m2).
import { describe, expect, test } from 'bun:test';
import { isHomeConfigSurface } from './home-config.ts';

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
