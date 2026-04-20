/**
 * Metadata cache with stale-while-revalidate support.
 *
 * `fetchWithCache` still returns stale data immediately when available. Callers
 * can pass `onRefresh` to react to a successful background refresh.
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
}

interface CacheOptions<T = unknown> {
  ttl?: number
  onRefresh?: (freshData: T) => void
}

const DEFAULT_TTL = 60_000

const cache = new Map<string, CacheEntry<unknown>>()
const inflightRefreshes = new Map<string, Promise<unknown>>()

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  return entry?.data ?? null
}

export function isFresh(key: string, ttl: number = DEFAULT_TTL): boolean {
  const entry = cache.get(key)
  if (!entry) return false
  return Date.now() - entry.timestamp < ttl
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
}

export function invalidate(key: string): void {
  cache.delete(key)
  inflightRefreshes.delete(key)
}

export function invalidateByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
  for (const key of inflightRefreshes.keys()) {
    if (key.startsWith(prefix)) inflightRefreshes.delete(key)
  }
}

export function clearAllCache(): void {
  cache.clear()
  inflightRefreshes.clear()
}

function refreshInBackground<T>(
  key: string,
  fetcher: () => Promise<T>,
  onRefresh?: (freshData: T) => void,
): void {
  const existing = inflightRefreshes.get(key) as Promise<T> | undefined
  if (existing) {
    existing.then(onRefresh).catch(() => {})
    return
  }

  const refresh = fetcher()
    .then((freshData) => {
      setCache(key, freshData)
      onRefresh?.(freshData)
      return freshData
    })
    .finally(() => {
      inflightRefreshes.delete(key)
    })

  inflightRefreshes.set(key, refresh)
  refresh.catch(() => {
    // Keep stale data when background refresh fails.
  })
}

export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: CacheOptions<T>,
): Promise<{ data: T; fromCache: boolean }> {
  const ttl = options?.ttl ?? DEFAULT_TTL
  const cached = getCached<T>(key)

  if (cached !== null && isFresh(key, ttl)) {
    return { data: cached, fromCache: true }
  }

  if (cached !== null) {
    refreshInBackground(key, fetcher, options?.onRefresh)
    return { data: cached, fromCache: true }
  }

  const data = await fetcher()
  setCache(key, data)
  return { data, fromCache: false }
}
