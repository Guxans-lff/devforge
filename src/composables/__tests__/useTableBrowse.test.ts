import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTableBrowse } from '@/composables/useTableBrowse'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { QueryResult } from '@/types/database'

vi.mock('@/plugins/persistence', () => ({
  usePersistence: () => ({
    load: vi.fn().mockResolvedValue(false),
    autoSave: vi.fn(),
    saveImmediate: vi.fn(),
  }),
}))

vi.mock('@/api/database', () => ({
  dbGetTableData: vi.fn(),
}))

vi.mock('@/composables/usePrimaryKey', () => ({
  fetchPrimaryKeys: vi.fn(),
}))

import { dbGetTableData } from '@/api/database'
import { fetchPrimaryKeys } from '@/composables/usePrimaryKey'

function makeResult(rows: unknown[][], totalCount: number | null): QueryResult {
  return {
    columns: [{ name: 'id', dataType: 'INT', nullable: false }],
    rows,
    affectedRows: 0,
    executionTimeMs: 1,
    isError: false,
    error: null,
    totalCount,
    truncated: false,
  }
}

describe('useTableBrowse', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(fetchPrimaryKeys).mockResolvedValue([])
  })

  it('continues loading rows when totalCount is only a has-more upper bound', async () => {
    const store = useDatabaseWorkspaceStore()
    const workspace = store.getOrCreate('conn-1')
    const tabId = workspace.activeTabId

    store.updateTabContext('conn-1', tabId, {
      type: 'query',
      sql: '',
      result: null,
      isExecuting: false,
    })

    vi.mocked(dbGetTableData)
      .mockResolvedValueOnce(makeResult([[1], [2]], 3))
      .mockResolvedValueOnce(makeResult([[3], [4]], 5))

    const tableBrowse = useTableBrowse({
      connectionId: ref('conn-1'),
      tabId: ref(tabId),
      isConnected: ref(true),
      isExecuting: computed(() => false),
      tabContext: computed(() => store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any),
    })

    await tableBrowse.browseTable('demo', 'users')
    await tableBrowse.loadMoreRows()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(dbGetTableData).toHaveBeenNthCalledWith(1, 'conn-1', 'demo', 'users', 1, 200, undefined, undefined)
    expect(dbGetTableData).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 2, 200, undefined, undefined, undefined, undefined)
    expect(ctx.result.rows).toEqual([[1], [2], [3], [4]])
    expect(ctx.result.totalCount).toBe(5)
    expect(ctx.tableBrowse.currentPage).toBe(2)
  })

  it('reuses cached pages instead of re-querying the backend', async () => {
    const store = useDatabaseWorkspaceStore()
    const workspace = store.getOrCreate('conn-1')
    const tabId = workspace.activeTabId

    vi.mocked(dbGetTableData)
      .mockResolvedValueOnce(makeResult([[1]], 2))
      .mockResolvedValueOnce(makeResult([[2]], 2))

    const tableBrowse = useTableBrowse({
      connectionId: ref('conn-1'),
      tabId: ref(tabId),
      isConnected: ref(true),
      isExecuting: computed(() => false),
      tabContext: computed(() => store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any),
    })

    await tableBrowse.browseTable('demo', 'users')
    await tableBrowse.loadMoreRows()

    let ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    store.updateTabContext('conn-1', tabId, {
      result: makeResult([[1]], 2),
      tableBrowse: { ...ctx.tableBrowse, currentPage: 1 },
    })

    await tableBrowse.loadMoreRows()

    ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(dbGetTableData).toHaveBeenCalledTimes(2)
    expect(ctx.result.rows).toEqual([[1], [2]])
    expect(ctx.tableBrowse.currentPage).toBe(2)
  })

  it('uses a numeric single-column primary key cursor for sequential table browsing', async () => {
    const store = useDatabaseWorkspaceStore()
    const workspace = store.getOrCreate('conn-1')
    const tabId = workspace.activeTabId

    vi.mocked(fetchPrimaryKeys).mockResolvedValue(['id'])
    vi.mocked(dbGetTableData)
      .mockResolvedValueOnce(makeResult([[1], [2]], 3))
      .mockResolvedValueOnce(makeResult([[3], [4]], 5))

    const tableBrowse = useTableBrowse({
      connectionId: ref('conn-1'),
      tabId: ref(tabId),
      isConnected: ref(true),
      isExecuting: computed(() => false),
      tabContext: computed(() => store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any),
    })

    await tableBrowse.browseTable('demo', 'users')
    await tableBrowse.loadMoreRows()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(dbGetTableData).toHaveBeenNthCalledWith(1, 'conn-1', 'demo', 'users', 1, 200, undefined, 'id ASC')
    expect(dbGetTableData).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 2, 200, undefined, 'id ASC', 'id', 2)
    expect(ctx.tableBrowse.orderBy).toBeUndefined()
    expect(ctx.tableBrowse.seekOrderBy).toBe('id ASC')
    expect(ctx.tableBrowse.seekColumn).toBe('id')
    expect(ctx.tableBrowse.seekValue).toBe(4)
  })

  it('does not use keyset pagination when a custom sort is active', async () => {
    const store = useDatabaseWorkspaceStore()
    const workspace = store.getOrCreate('conn-1')
    const tabId = workspace.activeTabId

    vi.mocked(fetchPrimaryKeys).mockResolvedValue(['id'])
    vi.mocked(dbGetTableData)
      .mockResolvedValueOnce(makeResult([[1]], 2))
      .mockResolvedValueOnce(makeResult([[2]], 2))

    const tableBrowse = useTableBrowse({
      connectionId: ref('conn-1'),
      tabId: ref(tabId),
      isConnected: ref(true),
      isExecuting: computed(() => false),
      tabContext: computed(() => store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any),
    })

    await tableBrowse.browseTable('demo', 'users', undefined, 'name DESC')
    await tableBrowse.loadMoreRows()

    expect(dbGetTableData).toHaveBeenNthCalledWith(1, 'conn-1', 'demo', 'users', 1, 200, undefined, 'name DESC')
    expect(dbGetTableData).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 2, 200, undefined, 'name DESC', undefined, undefined)
  })
})
