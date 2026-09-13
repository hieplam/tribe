// core/cache.test.ts — spec §5.3/§9 (the pure cache/eviction policy), `pure-core.md`.
import { describe, expect, test } from 'bun:test';
import { CACHE_CAPACITY, CACHE_TTL_MS, decideCache, evictionVictim, type CacheEntry } from './cache.ts';

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
