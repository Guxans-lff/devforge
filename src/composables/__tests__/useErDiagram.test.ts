import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useErDiagram } from '@/composables/useErDiagram'
import { buildAllColumnsCacheKey, clearAllCache, getCached } from '@/composables/useMetadataCache'

vi.mock('@/api/database', () => ({
  dbGetAllColumns: vi.fn(),
  dbGetForeignKeys: vi.fn(),
  dbGetSchemaBundle: vi.fn(),
  dbGetTables: vi.fn(),
}))

import { dbGetAllColumns, dbGetForeignKeys, dbGetSchemaBundle, dbGetTables } from '@/api/database'

const allColumnsFixture = {
  users: [
    {
      name: 'id',
      dataType: 'INT',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: true,
      comment: null,
    },
  ],
  orders: [
    {
      name: 'user_id',
      dataType: 'INT',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: false,
      comment: null,
    },
  ],
}

describe('useErDiagram', () => {
  beforeEach(() => {
    clearAllCache()
    vi.clearAllMocks()
    vi.mocked(dbGetTables).mockResolvedValue([
      { name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: null },
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
        { name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: null },
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

  it('loads table columns in one batch when building the diagram', async () => {
    const diagram = useErDiagram('conn-1', 'demo')

    await diagram.loadDiagram()

    expect(dbGetSchemaBundle).toHaveBeenCalledTimes(1)
    expect(dbGetSchemaBundle).toHaveBeenCalledWith('conn-1', 'demo')
    expect(dbGetTables).not.toHaveBeenCalled()
    expect(dbGetForeignKeys).not.toHaveBeenCalled()
    expect(dbGetAllColumns).not.toHaveBeenCalled()
    expect(getCached(buildAllColumnsCacheKey('conn-1', 'demo'))).toEqual(allColumnsFixture)
    expect(getCached('conn-1:demo:users:columns')).toEqual(allColumnsFixture.users)
    expect(diagram.nodes.value).toHaveLength(2)
    expect(diagram.nodes.value.find(node => node.id === 'users')?.data?.columns).toHaveLength(1)
    expect(diagram.edges.value).toHaveLength(1)
  })

  it('reuses cached metadata across repeated diagram loads', async () => {
    const diagram = useErDiagram('conn-1', 'demo')

    await diagram.loadDiagram()
    await diagram.loadDiagram()

    expect(dbGetSchemaBundle).toHaveBeenCalledTimes(1)
  })
})
