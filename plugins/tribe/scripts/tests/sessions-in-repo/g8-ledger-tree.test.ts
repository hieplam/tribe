import { describe, expect, test } from 'bun:test';
import { scoreTree, treeFromLedgerLines, treeFromLlmText } from './g8-ledger-tree.ts';

const ROOT = '11111111-1111-1111-1111-111111111111';
const truth = { sessions: new Set([ROOT, 'aaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbb']),
  edges: new Map([['aaaaaaaaaaaaaaaaa', ROOT], ['bbbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaaa']]) };

describe('scoreTree', () => {
  test('a ledger with every session and every edge scores full', () => {
    const lines = [
      JSON.stringify({ event: 'spawn', kind: 'executor', sessionId: ROOT, parentSessionId: null }),
      JSON.stringify({ event: 'spawn', kind: 'subagent', sessionId: 'aaaaaaaaaaaaaaaaa', parentSessionId: ROOT }),
      JSON.stringify({ event: 'spawn', kind: 'subagent', sessionId: 'bbbbbbbbbbbbbbbbb', parentSessionId: 'aaaaaaaaaaaaaaaaa' }),
    ];
    expect(scoreTree(truth, treeFromLedgerLines(lines))).toMatchObject({ total: 3, present: 3, edgesTotal: 2, edgesCorrect: 2, extra: [] });
  });
  test('a depth-2 child pointed at the root is a WRONG edge, not a correct one', () => {
    const lines = [ROOT, 'aaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbb'].map((id, i) =>
      JSON.stringify({ event: 'spawn', sessionId: id, parentSessionId: i === 0 ? null : ROOT }));
    expect(scoreTree(truth, treeFromLedgerLines(lines)).edgesCorrect).toBe(1);
  });
  test('legacy end rows (no event) count as sessions with no edge; null ids and malformed lines are skipped', () => {
    const lines = [JSON.stringify({ kind: 'closing', sessionId: ROOT, verdict: 'failed' }),
      JSON.stringify({ kind: 'closing', sessionId: null }), '{not json'];
    expect(scoreTree(truth, treeFromLedgerLines(lines))).toMatchObject({ present: 1, edgesCorrect: 0 });
  });
  test('an id the truth does not know is reported as extra', () => {
    const s = scoreTree(truth, treeFromLedgerLines([JSON.stringify({ event: 'spawn', sessionId: 'ccccccccccccccccc', parentSessionId: null })]));
    expect(s.extra).toEqual(['ccccccccccccccccc']);
  });
  test('LLM text: ROOT/EDGE lines parse, prose is ignored', () => {
    const t = treeFromLlmText(`Here you go:\nROOT ${ROOT}\nEDGE aaaaaaaaaaaaaaaaa ${ROOT}\nEDGE bbbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaaa\n`);
    expect(scoreTree(truth, t)).toMatchObject({ present: 3, edgesCorrect: 2 });
  });
});
