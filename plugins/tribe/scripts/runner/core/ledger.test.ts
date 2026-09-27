import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptySpawnTracker, observeSpawns, rootSpawnRow } from './ledger.ts';
import type { SessionMessage } from './session.ts';

const ROOT = 'cbb8d223-8d62-4eea-97a5-50f42ea2091b';
const AT = '2026-09-27T00:00:00.000Z';
const stream = readFileSync(join(import.meta.dir, '..', 'fixtures', 'ledger', 'depth2-stream.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l) as SessionMessage);

function replay(messages: SessionMessage[]) {
  let tracker = emptySpawnTracker(ROOT, 'card-1');
  const rows = [];
  for (const m of messages) { const r = observeSpawns(tracker, m, AT); tracker = r.tracker; rows.push(...r.rows); }
  return rows;
}

describe('observeSpawns over a real depth-2 stream', () => {
  test('one row per local_agent task, parents as meta.json records them (parentAgentId)', () => {
    expect(replay(stream)).toEqual([
      { at: AT, event: 'spawn', kind: 'subagent', sessionId: 'ab1b0abc8ab4adca7', parentSessionId: ROOT, rootSessionId: ROOT, agentType: 'outer', cardId: 'card-1' },
      { at: AT, event: 'spawn', kind: 'subagent', sessionId: 'a1ffb9a81990abbda', parentSessionId: 'ab1b0abc8ab4adca7', rootSessionId: ROOT, agentType: 'general-purpose', cardId: 'card-1' },
    ]);
  });
  test('a local_bash task is not a session and emits nothing', () => {
    expect(replay(stream.slice(5))).toEqual([]);
  });
  test('a depth-2 task whose Agent call was never seen: parent null and parentUnresolved, never guessed', () => {
    const rows = replay([stream[4]]);
    expect(rows[0]).toMatchObject({ sessionId: 'a1ffb9a81990abbda', parentSessionId: null, parentUnresolved: true });
  });
  test('a depth-1 task whose call was never seen still resolves to the root', () => {
    expect(replay([stream[2]])[0]).toMatchObject({ parentSessionId: ROOT });
  });
  test('the tracker is not mutated in place', () => {
    const t0 = emptySpawnTracker(ROOT, null);
    const snapshot = JSON.stringify(t0);
    observeSpawns(t0, stream[1], AT);
    expect(JSON.stringify(t0)).toBe(snapshot);
  });
});

test('rootSpawnRow: a root has no parent and is its own root', () => {
  expect(rootSpawnRow({ kind: 'executor', sessionId: ROOT, cardId: 'c', at: AT, resumed: true })).toEqual(
    { at: AT, event: 'spawn', kind: 'executor', sessionId: ROOT, parentSessionId: null, rootSessionId: ROOT, agentType: null, cardId: 'c', resumed: true });
});
