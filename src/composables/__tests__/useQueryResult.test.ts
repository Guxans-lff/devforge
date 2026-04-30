import { computed, ref, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  saveMock,
  writeTextFileMock,
  dbGenerateScriptMock,
  dbGetTableDataMock,
  toastSuccessMock,
  toastErrorMock,
  primaryKeysState,
  pkLoadingState,
} = vi.hoisted(() => ({
  saveMock: vi.fn(),
  writeTextFileMock: vi.fn(),
  dbGenerateScriptMock: vi.fn(),
  dbGetTableDataMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  primaryKeysState: { value: ['id'] as string[] },
  pkLoadingState: { value: false },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: saveMock,
}))

vi.mock('@tanstack/vue-table', () => ({
  createColumnHelper: () => ({
    accessor: vi.fn((_key, def) => def),
  }),
  getCoreRowModel: () => vi.fn(),
  getSortedRowModel: () => vi.fn(),
  useVueTable: () => ({
    getRowModel: () => ({ rows: [] }),
    getFlatHeaders: () => [],
  }),
}))

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: () => ({
    value: {
      getVirtualItems: () => [],
      getTotalSize: () => 0,
    },
  }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}))

vi.mock('@/composables/useAdaptiveOverscan', () => ({
  useAdaptiveOverscan: () => ({
    overscan: ref(20),
    attach: vi.fn(),
  }),
}))

vi.mock('@/utils/exportData', () => ({
  formatData: vi.fn(() => 'export-content'),
  getFilters: vi.fn(() => []),
}))

vi.mock('@/composables/usePrimaryKey', async () => {
  const { computed } = await import('vue')
  return {
    usePrimaryKeys: vi.fn(() => ({
      primaryKeys: computed(() => primaryKeysState.value),
      pkLoading: computed(() => pkLoadingState.value),
    })),
  }
})

vi.mock('@/api/database', () => ({
  writeTextFile: writeTextFileMock,
  dbExecuteQueryInDatabase: vi.fn(),
  dbGenerateScript: dbGenerateScriptMock,
  dbGetTableData: dbGetTableDataMock,
}))

import { useQueryResult } from '@/composables/useQueryResult'

function makeResult(rows: unknown[][], totalCount = rows.length): {
  columns: Array<{ name: string; dataType: string; nullable: boolean }>
  rows: unknown[][]
  affectedRows: number
  executionTimeMs: number
  isError: boolean
  error: null
  totalCount: number | null
  truncated: boolean
  tableName: string
} {
  return {
    columns: [
      { name: 'id', dataType: 'INT', nullable: false },
      { name: 'name', dataType: 'VARCHAR', nullable: true },
    ],
    rows,
    affectedRows: 0,
    executionTimeMs: 1,
    isError: false,
    error: null,
    totalCount,
    truncated: false,
    tableName: 'users',
  }
}

function makeRows(start: number, count: number): unknown[][] {
  return Array.from({ length: count }, (_, index) => {
    const id = start + index
    return [id, `name-${id}`]
  })
}

function createUseQueryResult(options?: {
  tableBrowse?: {
    database: string
    table: string
    currentPage: number
    pageSize: number
    whereClause?: string
    orderBy?: string
    filterOperators?: Record<string, string>
    seekOrderBy?: string
    seekColumn?: string
    seekValue?: number
  }
}) {
  const result = ref(makeResult([[1, 'a'], [2, 'b']]))
  const tableBrowse = ref(options?.tableBrowse)
  return useQueryResult({
    result,
    loading: computed(() => false),
    loadingMore: computed(() => false),
    hasMoreServerRows: computed(() => true),
    showReconnect: computed(() => false),
    connectionId: ref('conn-1'),
    database: ref('demo'),
    tableName: ref('users'),
    driver: ref('mysql'),
    isTableBrowse: computed(() => true),
    tableScrollRef: ref(null),
    onReconnect: vi.fn(),
    onLoadMore: vi.fn(),
    onRefresh: vi.fn(),
    onServerFilter: vi.fn(),
    onServerSort: vi.fn(),
    tableBrowse,
  })
}

describe('useQueryResult table browse state restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primaryKeysState.value = ['id']
    pkLoadingState.value = false
  })

  it('从 tableBrowse 恢复服务端筛选、操作符和排序状态', async () => {
    const qr = createUseQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` LIKE '%Ada%' AND `id` >= '10'",
        orderBy: '`id` DESC',
        filterOperators: { name: 'LIKE', id: '>=' },
      },
    })

    await nextTick()

    expect(qr.serverColumnFilters.value).toEqual({
      name: 'Ada',
      id: '10',
    })
    expect(qr.activeColumnFilters.value).toEqual({
      name: 'Ada',
      id: '10',
    })
    expect(qr.filterOperators.value).toEqual({
      name: 'LIKE',
      id: '>=',
    })
    expect(qr.serverSortCol.value).toBe('id')
    expect(qr.serverSortDir.value).toBe('DESC')
  })

  it('缺少显式 filterOperators 时从 whereClause 推导操作符', async () => {
    const qr = createUseQueryResult({
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: "`name` IN ('Ada', 'Linus') AND `deleted_at` IS NULL",
      },
    })

    await nextTick()

    expect(qr.serverColumnFilters.value).toEqual({
      name: 'Ada, Linus',
      deleted_at: '',
    })
    expect(qr.filterOperators.value).toEqual({
      name: 'IN',
      deleted_at: 'IS NULL',
    })
    expect(qr.serverSortCol.value).toBeNull()
    expect(qr.serverSortDir.value).toBeNull()
  })
})

describe('useQueryResult export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveMock.mockResolvedValue('D:/exports/users.csv')
    dbGenerateScriptMock.mockResolvedValue('CREATE TABLE users (...)')
    writeTextFileMock.mockResolvedValue(undefined)
    primaryKeysState.value = ['id']
    pkLoadingState.value = false
  })

  it('uses keyset pagination when exporting remaining table rows with a numeric single-column primary key', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult(makeRows(1, 1000)))
      .mockResolvedValueOnce(makeResult(makeRows(1001, 1000)))
      .mockResolvedValueOnce(makeResult(makeRows(2001, 1)))

    const qr = createUseQueryResult()

    await qr.handleExport('csv')

    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(1, 'conn-1', 'demo', 'users', 1, 1000, null, 'id ASC', 'id', undefined)
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 2, 1000, null, 'id ASC', 'id', 1000)
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(3, 'conn-1', 'demo', 'users', 3, 1000, null, 'id ASC', 'id', 2000)
    expect(writeTextFileMock).toHaveBeenCalled()
  })

  it('falls back to offset pagination when a server-side sort is active', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult(makeRows(1, 1000), 1001))
      .mockResolvedValueOnce(makeResult(makeRows(1001, 1)))

    const qr = createUseQueryResult()
    qr.serverSortCol.value = 'name'
    qr.serverSortDir.value = 'DESC'

    await qr.handleExport('csv')

    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(1, 'conn-1', 'demo', 'users', 1, 1000, null, 'name DESC', undefined, undefined)
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 2, 1000, null, 'name DESC', undefined, undefined)
  })
})
