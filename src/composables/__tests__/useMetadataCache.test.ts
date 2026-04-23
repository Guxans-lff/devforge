import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildAllColumnsCacheKey,
  clearAllCache,
  fetchWithCache,
  getCached,
  invalidate,
  setCache,
  warmColumnMetadataCache,
} from '@/composables/useMetadataCache'

describe('useMetadataCache', () => {
  beforeEach(() => {
    clearAllCache()
    vi.restoreAllMocks()
  })

  it('dedupes concurrent cold-start fetches for the same key', async () => {
    let resolveFetch!: (value: string[]) => void
    const fetcher = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const first = fetchWithCache('conn-1:demo:tables', fetcher)
    const second = fetchWithCache('conn-1:demo:tables', fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)

    resolveFetch(['users', 'orders'])

    await expect(first).resolves.toEqual({
      data: ['users', 'orders'],
      fromCache: false,
    })
    await expect(second).resolves.toEqual({
      data: ['users', 'orders'],
      fromCache: false,
    })
  })

  it('does not restore stale data after a key is invalidated mid-flight', async () => {
    let resolveFetch!: (value: string[]) => void
    const fetcher = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFetch = resolve
        }),
    )

    setCache('conn-1:demo:tables', ['stale'])

    const pending = fetchWithCache('conn-1:demo:tables', fetcher, { ttl: 0 })
    expect(getCached<string[]>('conn-1:demo:tables')).toEqual(['stale'])

    invalidate('conn-1:demo:tables')
    expect(getCached<string[]>('conn-1:demo:tables')).toBeNull()

    resolveFetch(['fresh'])
    await expect(pending).resolves.toEqual({
      data: ['stale'],
      fromCache: true,
    })

    expect(getCached<string[]>('conn-1:demo:tables')).toBeNull()
  })

  it('warms all-columns and per-table column cache entries together', () => {
    const allColumns = {
      users: [{ name: 'id' }],
      orders: [{ name: 'user_id' }],
    }

    warmColumnMetadataCache('conn-1', 'demo', allColumns)

    expect(getCached(buildAllColumnsCacheKey('conn-1', 'demo'))).toEqual(allColumns)
    expect(getCached('conn-1:demo:users:columns')).toEqual([{ name: 'id' }])
    expect(getCached('conn-1:demo:orders:columns')).toEqual([{ name: 'user_id' }])
  })
})
