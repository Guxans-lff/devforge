import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSchemaCache } from '@/composables/useSchemaCache'
import type { DatabaseTreeNode, ForeignKeyRelation } from '@/types/database'

vi.mock('@/api/database', () => ({
  dbGetForeignKeys: vi.fn(),
  dbGetAllColumns: vi.fn(),
}))

vi.mock('@/composables/useMetadataCache', () => ({
  setCache: vi.fn(),
  warmColumnMetadataCache: vi.fn(),
}))

import { dbGetAllColumns, dbGetForeignKeys } from '@/api/database'

function makeTree(databaseNames: string[]): DatabaseTreeNode[] {
  return databaseNames.map((database) => ({
    id: `db-${database}`,
    label: database,
    type: 'database',
    meta: { database },
    children: [
      {
        id: `${database}-users`,
        label: 'users',
        type: 'table',
        meta: { database, table: 'users' },
        children: [],
      },
    ],
  }))
}

describe('useSchemaCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(dbGetAllColumns).mockResolvedValue({
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
    })
    vi.mocked(dbGetForeignKeys).mockImplementation(async (_connectionId: string, database: string) => {
      const row: ForeignKeyRelation = {
        tableName: 'users',
        columnName: 'role_id',
        referencedTableName: `${database}_roles`,
        referencedColumnName: 'id',
      }
      return [row]
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads foreign keys only for the active database', async () => {
    const treeNodes = makeTree(['analytics', 'archive', 'audit'])
    const schema = useSchemaCache(() => treeNodes, () => 'conn-1')

    schema.handleDatabaseSwitch('analytics')
    await vi.advanceTimersByTimeAsync(350)
    await nextTick()

    expect(dbGetForeignKeys).toHaveBeenCalledTimes(1)
    expect(dbGetForeignKeys).toHaveBeenCalledWith('conn-1', 'analytics')
    expect(dbGetAllColumns).toHaveBeenCalledTimes(1)
    expect(dbGetAllColumns).toHaveBeenCalledWith('conn-1', 'analytics')
  })

  it('dedupes in-flight metadata requests and scopes loaded state per connection', async () => {
    const treeNodes = makeTree(['analytics'])

    let releaseForeignKeys!: () => void
    let releaseColumns!: () => void
    vi.mocked(dbGetForeignKeys).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseForeignKeys = () =>
            resolve([
              {
                tableName: 'users',
                columnName: 'role_id',
                referencedTableName: 'roles',
                referencedColumnName: 'id',
              },
            ])
        }),
    )
    vi.mocked(dbGetAllColumns).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseColumns = () =>
            resolve({
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
            })
        }),
    )

    const schema = useSchemaCache(() => treeNodes, () => 'conn-1')
    schema.handleDatabaseSwitch('analytics')
    schema.refreshSchemaCache()
    await vi.advanceTimersByTimeAsync(350)
    await Promise.resolve()
    await nextTick()

    expect(dbGetForeignKeys).toHaveBeenCalledTimes(1)
    expect(dbGetAllColumns).toHaveBeenCalledTimes(1)

    releaseForeignKeys()
    releaseColumns()
    await Promise.resolve()
    await nextTick()

    schema.refreshSchemaCache()
    await vi.advanceTimersByTimeAsync(350)
    await nextTick()

    expect(dbGetForeignKeys).toHaveBeenCalledTimes(1)
    expect(dbGetAllColumns).toHaveBeenCalledTimes(1)

    const schemaOtherConnection = useSchemaCache(() => treeNodes, () => 'conn-2')
    schemaOtherConnection.handleDatabaseSwitch('analytics')
    await vi.advanceTimersByTimeAsync(350)
    await nextTick()

    expect(dbGetForeignKeys).toHaveBeenCalledTimes(2)
    expect(dbGetAllColumns).toHaveBeenCalledTimes(2)
    expect(dbGetForeignKeys).toHaveBeenLastCalledWith('conn-2', 'analytics')
    expect(dbGetAllColumns).toHaveBeenLastCalledWith('conn-2', 'analytics')
  })
})
