// core/cache.ts — the pure cache/eviction policy (spec §5.3, §9; `pure-core.md`). Every cache used
// by the viewer (the campaign badge scan of §9, the title/cwd summary of §5.3) is a bounded,
// wall-clock-expiring in-memory map keyed on the caller's own identity string. This module decides
// NOTHING about the filesystem, the clock, or the Map's storage — it takes an already-supplied
// `nowMs` and an already-supplied snapshot of the cache's current entries and returns a pure
// verdict. The adapter that actually holds the `Map` (`adapters/campaign.adapter.ts`) reads this
// module's decision and obeys it; it never computes `now - insertedAtMs >= ttl` itself.
//
// Not a store (D7): entries are keyed on the caller's own resource identity, hold only derived
// values, never survive the process, and a miss is always answered by a correct re-read/re-scan.

/** One cached value alongside the two clock readings its lifecycle needs: `insertedAtMs` (when it
 * was written — the TTL clock) and `lastAccessMs` (when it was last read or written — the LRU
 * clock). The two are tracked separately because a value can be HIT many times without ever being
 * re-written: TTL expiry must still fire off the original write time, while eviction must still
 * prefer the least-recently-USED entry, not the least-recently-WRITTEN one. */
export interface CacheEntry<T> {
  readonly value: T;
  readonly insertedAtMs: number;
  readonly lastAccessMs: number;
}

export type CacheDecision<T> = { readonly kind: 'hit'; readonly value: T } | { readonly kind: 'stale' } | { readonly kind: 'miss' };

/** The whole-badge-scan cache (spec §9): "cached for 5 s". */
export const CACHE_TTL_MS = 5000;

/** The file-identity cache bound (spec §5.3): "bounded to 500 entries". Shared by every cache
 * instance this module serves — a single bound, named once. */
export const CACHE_CAPACITY = 500;

/**
 * `decideCache(key, existing, nowMs)` (spec §5.3): looks `key` up in the already-supplied
 * `existing` snapshot and returns:
 * - `miss` — `key` has no entry at all;
 * - `stale` — `key` has an entry, but `nowMs - insertedAtMs >= CACHE_TTL_MS`;
 * - `hit`  — `key` has an entry within the TTL window; its value is returned.
 *
 * Pure: the same `(key, existing, nowMs)` triple yields the same decision on run 1 and run 100.
 * `existing` is read, never mutated — inserting, refreshing, and evicting are the adapter's own
 * `Map` mutations, made in response to this decision, never this function's job.
 */
export function decideCache<T>(key: string, existing: ReadonlyMap<string, CacheEntry<T>>, nowMs: number): CacheDecision<T> {
  const entry = existing.get(key);
  if (entry === undefined) return { kind: 'miss' };
  if (nowMs - entry.insertedAtMs >= CACHE_TTL_MS) return { kind: 'stale' };
  return { kind: 'hit', value: entry.value };
}

/**
 * Which key the adapter should remove before inserting a new one, once `existing` has reached
 * `CACHE_CAPACITY` (spec §5.3: "bounded to 500 entries, LRU"). Picks the entry with the smallest
 * `lastAccessMs` — the least-recently-USED one, not merely the oldest write — ties broken by the
 * smallest `insertedAtMs` so the choice is deterministic regardless of the Map's iteration order.
 * Returns `null` when there is room to insert without evicting anything (including when `existing`
 * is empty) — nothing to evict.
 */
export function evictionVictim<T>(existing: ReadonlyMap<string, CacheEntry<T>>): string | null {
  if (existing.size < CACHE_CAPACITY) return null;
  let victimKey: string | null = null;
  let victimEntry: CacheEntry<T> | null = null;
  for (const [key, entry] of existing) {
    if (
      victimEntry === null ||
      entry.lastAccessMs < victimEntry.lastAccessMs ||
      (entry.lastAccessMs === victimEntry.lastAccessMs && entry.insertedAtMs < victimEntry.insertedAtMs)
    ) {
      victimKey = key;
      victimEntry = entry;
    }
  }
  return victimKey;
}
