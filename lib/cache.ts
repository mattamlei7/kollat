import type { Result } from "./protocols/types";

/**
 * In-process TTL cache with stale-while-revalidate semantics.
 * Server-only. Swap the `store` for Redis when there is more than one instance.
 */

interface Entry<T> {
  value: T;
  fetchedAt: number;
  ttlMs: number;
  inflight?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();
/** Account-keyed entries grow with every address queried; drop the oldest past this. */
const MAX_ENTRIES = 5_000;

export const TTL = {
  markets: 10 * 60_000,
  rates: 60_000,
  account: 30_000,
  /** How long we will keep serving a stale value while refreshes fail. */
  maxStale: 60 * 60_000,
} as const;

/**
 * Returns the cached value if fresh; otherwise refreshes. If the refresh
 * fails and a stale value exists (younger than maxStale), returns it with
 * `stale: true` rather than surfacing the error.
 */
export async function cachedResult<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const now = Date.now();
  const entry = store.get(key) as Entry<Result<T>> | undefined;

  if (entry && entry.value.ok && now - entry.fetchedAt < entry.ttlMs) {
    return entry.value;
  }

  if (entry?.inflight) return entry.inflight;

  const inflight = (async () => {
    const result = await fetcher().catch(
      (e): Result<T> => ({
        ok: false,
        error: { code: "UNKNOWN", message: e instanceof Error ? e.message : String(e), retryable: true },
      }),
    );
    if (result.ok) {
      store.set(key, { value: result, fetchedAt: result.fetchedAt, ttlMs });
      // ponytail: FIFO eviction (Map keeps insertion order); LRU or Redis if hit rate matters.
      while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
      return result;
    }
    // Refresh failed: fall back to a stale-but-recent value if we have one.
    if (entry && entry.value.ok && now - entry.fetchedAt < TTL.maxStale) {
      const stale = { ...entry.value, stale: true };
      store.set(key, { ...entry, value: stale, inflight: undefined });
      return stale;
    }
    store.delete(key);
    return result;
  })();

  store.set(key, { value: entry?.value ?? ({ ok: false } as Result<T>), fetchedAt: entry?.fetchedAt ?? 0, ttlMs, inflight });
  return inflight;
}

export function invalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
