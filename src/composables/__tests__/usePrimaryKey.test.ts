import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/database', () => ({
  dbGetColumns: vi.fn(),
}))

import { dbGetColumns } from '@/api/database'
import { clearAllCache, setCache } from '@/composables/useMetadataCache'
import { clearPrimaryKeyCache, fetchPrimaryKeys } from '@/composables/usePrimaryKey'

const columns = [
  {
    name: 'id',
    dataType: 'INT',
    nullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    comment: null,
  },
  {
    name: 'name',
    dataType: 'VARCHAR',
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    comment: null,
  },
]

describe('usePrimaryKey', () => {
  beforeEach(() => {
    clearAllCache()
    clearPrimaryKeyCache()
    vi.clearAllMocks()
  })

  it('reuses warmed column metadata instead of querying columns again', async () => {
    setCache('conn-1:demo:users:columns', columns)

    await expect(fetchPrimaryKeys('conn-1', 'demo', 'users')).resolves.toEqual(['id'])

    expect(dbGetColumns).not.toHaveBeenCalled()
  })

  it('dedupes concurrent cold primary-key lookups through metadata cache', async () => {
    let resolveColumns!: () => void
    vi.mocked(dbGetColumns).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveColumns = () => resolve(columns)
        }),
    )

    const first = fetchPrimaryKeys('conn-1', 'demo', 'users')
    const second = fetchPrimaryKeys('conn-1', 'demo', 'users')

    expect(dbGetColumns).toHaveBeenCalledTimes(1)

    resolveColumns()
    await expect(first).resolves.toEqual(['id'])
    await expect(second).resolves.toEqual(['id'])
  })
})
