import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useErModeling } from '@/composables/useErModeling'
import { buildAllColumnsCacheKey, clearAllCache, getCached } from '@/composables/useMetadataCache'

vi.mock('@/api/database', () => ({
  dbGetAllColumns: vi.fn(),
  dbGetForeignKeys: vi.fn(),
  dbGetSchemaBundle: vi.fn(),
  dbGetTables: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))

import { dbGetAllColumns, dbGetForeignKeys, dbGetSchemaBundle, dbGetTables } from '@/api/database'

const allColumnsFixture = {
  users: [
    {
      name: 'id',
      dataType: 'bigint(20)',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: true,
      comment: null,
    },
  ],
  orders: [
    {
      name: 'user_id',
      dataType: 'bigint(20)',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: false,
      comment: null,
    },
  ],
}

describe('useErModeling', () => {
  beforeEach(() => {
    clearAllCache()
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid') })

    vi.mocked(dbGetTables).mockResolvedValue([
      { name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: 'users table' },
      { name: 'orders', tableType: 'BASE TABLE', rowCount: null, comment: null },
    ])
    vi.mocked(dbGetForeignKeys).mockResolvedValue([
      {
        tableName: 'orders',
        columnName: 'user_id',
        referencedTableName: 'users',
        referencedColumnName: 'id',
      },
    ])
    vi.mocked(dbGetAllColumns).mockResolvedValue(allColumnsFixture)
    vi.mocked(dbGetSchemaBundle).mockResolvedValue({
      tables: [
        { name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: 'users table' },
        { name: 'orders', tableType: 'BASE TABLE', rowCount: null, comment: null },
      ],
      foreignKeys: [
        {
          tableName: 'orders',
          columnName: 'user_id',
          referencedTableName: 'users',
          referencedColumnName: 'id',
        },
      ],
      allColumns: allColumnsFixture,
    })
  })

  it('imports schema data with a single batched column request', async () => {
    const modeling = useErModeling()

    await modeling.importFromDatabase('conn-1', 'demo')

    expect(dbGetSchemaBundle).toHaveBeenCalledTimes(1)
    expect(dbGetSchemaBundle).toHaveBeenCalledWith('conn-1', 'demo')
    expect(dbGetTables).not.toHaveBeenCalled()
    expect(dbGetForeignKeys).not.toHaveBeenCalled()
    expect(dbGetAllColumns).not.toHaveBeenCalled()
    expect(getCached(buildAllColumnsCacheKey('conn-1', 'demo'))).toEqual(allColumnsFixture)
    expect(getCached('conn-1:demo:orders:columns')).toEqual(allColumnsFixture.orders)
    expect(modeling.project.value.tables).toHaveLength(2)
    expect(modeling.project.value.tables[0]?.columns).toHaveLength(1)
  })

  it('reuses cached metadata across repeated imports for the same database', async () => {
    const modeling = useErModeling()

    await modeling.importFromDatabase('conn-1', 'demo')
    await modeling.importFromDatabase('conn-1', 'demo')

    expect(dbGetSchemaBundle).toHaveBeenCalledTimes(1)
  })
})
