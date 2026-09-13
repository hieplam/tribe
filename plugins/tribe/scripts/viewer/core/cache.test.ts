// core/cache.test.ts — spec §5.3/§9 (the pure cache/eviction policy), `pure-core.md`.
import { describe, expect, test } from 'bun:test';
import { boundedInsert, CACHE_CAPACITY, CACHE_TTL_MS, decideCache, evictionVictim, SESSION_CACHE_TTL_MS, type CacheEntry } from './cache.ts';

function entry<T>(value: T, insertedAtMs: number, lastAccessMs: number = insertedAtMs): CacheEntry<T> {
  return { value, insertedAtMs, lastAccessMs };
}

describe('decideCache', () => {
  test('miss: an unseen key has no entry at all', () => {
    const existing = new Map<string, CacheEntry<string>>();
    expect(decideCache('k', existing, 1000)).toEqual({ kind: 'miss' });
  });

  test('hit: inside the TTL window, the cached value comes back', () => {
    const existing = new Map<string, CacheEntry<string>>([['k', entry('v1', 0)]]);
    expect(decideCache('k', existing, CACHE_TTL_MS - 1)).toEqual({ kind: 'hit', value: 'v1' });
  });

  test('stale: exactly at the 5 s expiry boundary, the entry is stale, not a hit', () => {
    const existing = new Map<string, CacheEntry<string>>([['k', entry('v1', 0)]]);
    expect(decideCache('k', existing, CACHE_TTL_MS)).toEqual({ kind: 'stale' });
  });

  test('stale: well past the 5 s expiry, still stale', () => {
    const existing = new Map<string, CacheEntry<string>>([['k', entry('v1', 0)]]);
    expect(decideCache('k', existing, CACHE_TTL_MS + 60_000)).toEqual({ kind: 'stale' });
  });

  test('one key stale does not affect a DIFFERENT key still inside its own window', () => {
    const existing = new Map<string, CacheEntry<string>>([
      ['old', entry('stale-value', 0)],
      ['fresh', entry('fresh-value', 4000)],
    ]);
    expect(decideCache('old', existing, 5000)).toEqual({ kind: 'stale' });
    expect(decideCache('fresh', existing, 5000)).toEqual({ kind: 'hit', value: 'fresh-value' });
  });

  test('is deterministic: the same (key, existing, nowMs) triple yields the same decision every call', () => {
    const existing = new Map<string, CacheEntry<string>>([['k', entry('v1', 1000)]]);
    const first = decideCache('k', existing, 1500);
    const second = decideCache('k', existing, 1500);
    expect(first).toEqual(second);
  });

  // The two distinct TTLs the composition root uses (spec §5.3 vs §9). `decideCache` takes the
  // window as a parameter so the SAME pure function serves both the 60 s session read cache and the
  // 5 s badge scan — the badge cache passing nothing (the 5 s default), the session cache passing
  // SESSION_CACHE_TTL_MS explicitly. Before this, both were pinned to the single 5 s CACHE_TTL_MS
  // and the session cache knowingly served a shorter-than-spec window (the I2 finding).
  test('the two TTL constants: 5 s for the badge scan (§9), 60 s for the session read cache (§5.3)', () => {
    expect(CACHE_TTL_MS).toBe(5000);
    expect(SESSION_CACHE_TTL_MS).toBe(60000);
  });

  test('default ttl (badge scan, §9): stale exactly at 5 s, unchanged by the new parameter', () => {
    const existing = new Map<string, CacheEntry<string>>([['k', entry('v1', 0)]]);
    expect(decideCache('k', existing, 4999)).toEqual({ kind: 'hit', value: 'v1' });
    expect(decideCache('k', existing, 5000)).toEqual({ kind: 'stale' });
  });

  test('session ttl (§5.3): a hit at 59 999 ms — where the 5 s default would already be stale — and stale exactly at 60 s', () => {
    const existing = new Map<string, CacheEntry<string>>([['k', entry('v1', 0)]]);
    // The whole point of the 60 s window: an entry the 5 s default calls stale is still a hit here.
    expect(decideCache('k', existing, 5000, SESSION_CACHE_TTL_MS)).toEqual({ kind: 'hit', value: 'v1' });
    expect(decideCache('k', existing, 59_999, SESSION_CACHE_TTL_MS)).toEqual({ kind: 'hit', value: 'v1' });
    expect(decideCache('k', existing, SESSION_CACHE_TTL_MS, SESSION_CACHE_TTL_MS)).toEqual({ kind: 'stale' });
  });
});

// boundedInsert — the write half of the bounded lifecycle (spec §5.3/§5.4). Used by BOTH the
// session read cache and the previousSizeByPath map in serve.ts, so neither can grow without bound
// (the I3 finding: previousSizeByPath was an unbounded Map).
describe('boundedInsert', () => {
  test('never grows the map past CACHE_CAPACITY: a fresh key at the bound evicts the LRU victim first', () => {
    const map = new Map<string, CacheEntry<number>>();
    for (let i = 0; i < CACHE_CAPACITY; i++) boundedInsert(map, `key-${i}`, i, i * 10);
    expect(map.size).toBe(CACHE_CAPACITY);
    // key-0 is the least-recently inserted/used; inserting a brand-new key evicts it, keeping the
    // size pinned at the bound.
    boundedInsert(map, 'fresh', 999, CACHE_CAPACITY * 10);
    expect(map.size).toBe(CACHE_CAPACITY);
    expect(map.has('key-0')).toBe(false); // the LRU victim was evicted
    expect(map.get('fresh')!.value).toBe(999);
  });

  test('updating an EXISTING key at the bound evicts nothing (the map does not grow, so nothing is thrown out)', () => {
    const map = new Map<string, CacheEntry<number>>();
    for (let i = 0; i < CACHE_CAPACITY; i++) boundedInsert(map, `key-${i}`, i, i * 10);
    expect(map.size).toBe(CACHE_CAPACITY);
    // Re-writing key-0 (already present) must NOT evict some other entry — the map isn't growing.
    boundedInsert(map, 'key-0', 4242, 999_999);
    expect(map.size).toBe(CACHE_CAPACITY);
    expect(map.get('key-0')!.value).toBe(4242);
    expect(map.has('key-250')).toBe(true); // no innocent bystander evicted
  });
});

describe('evictionVictim', () => {
  function buildFullMap(): Map<string, CacheEntry<number>> {
    const m = new Map<string, CacheEntry<number>>();
    for (let i = 0; i < CACHE_CAPACITY; i++) {
      m.set(`key-${i}`, entry(i, i * 10, i * 10));
    }
    return m;
  }

  test('below capacity: nothing to evict', () => {
    const existing = new Map<string, CacheEntry<number>>([['a', entry(1, 0, 0)]]);
    expect(evictionVictim(existing)).toBeNull();
  });

  test('an empty cache: nothing to evict', () => {
    expect(evictionVictim(new Map<string, CacheEntry<number>>())).toBeNull();
  });

  test('at the 500-entry bound: the least-recently-USED entry is the victim', () => {
    const existing = buildFullMap();
    // key-0 has the smallest lastAccessMs (0) of every entry built above.
    expect(evictionVictim(existing)).toBe('key-0');
  });

  test('LRU, not merely oldest-written: a later write with an EARLIER last access is still evicted first', () => {
    const existing = buildFullMap();
    // key-499 was written LAST (insertedAtMs 4990) but touch it back to the oldest access time —
    // it must still be the victim, proving eviction tracks USE, not write order.
    existing.set('key-499', entry(499, 4990, -1));
    expect(evictionVictim(existing)).toBe('key-499');
  });

  test('a tie on lastAccessMs is broken by the smallest insertedAtMs, deterministically', () => {
    const existing = new Map<string, CacheEntry<number>>();
    existing.set('newer', entry(1, 500, 100));
    existing.set('older', entry(2, 100, 100));
    for (let i = 0; i < CACHE_CAPACITY - 2; i++) existing.set(`filler-${i}`, entry(i, 1000 + i, 1000 + i));
    expect(existing.size).toBe(CACHE_CAPACITY);
    expect(evictionVictim(existing)).toBe('older');
  });
});
