import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fetchWithCacheMock,
  invalidateMock,
  invalidateByPrefixMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  fetchWithCacheMock: vi.fn(),
  invalidateMock: vi.fn(),
  invalidateByPrefixMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: () => computed(() => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
  })),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    error: toastErrorMock,
  }),
}))

vi.mock('@/composables/useAdaptiveOverscan', () => ({
  useAdaptiveOverscan: () => ({
    overscan: ref(20),
    attach: vi.fn(),
  }),
}))

vi.mock('@/composables/useObjectSearch', () => ({
  useObjectSearch: () => ({
    searchQuery: ref(''),
    isSearching: ref(false),
    searchResults: ref([]),
    highlightedNodeId: ref(null),
    navigateToNode: vi.fn(),
  }),
}))

vi.mock('@/composables/useMetadataCache', () => ({
  fetchWithCache: fetchWithCacheMock,
  invalidate: invalidateMock,
  invalidateByPrefix: invalidateByPrefixMock,
}))

vi.mock('@/api/database', () => ({
  dbGetDatabases: vi.fn(),
  dbGetTables: vi.fn(),
  dbGetTablesLight: vi.fn(),
  dbGetViews: vi.fn(),
  dbGetProcedures: vi.fn(),
  dbGetFunctions: vi.fn(),
  dbGetTriggers: vi.fn(),
  dbGetColumns: vi.fn(),
}))

import { useObjectTree } from '@/composables/useObjectTree'
import * as dbApi from '@/api/database'

describe('useObjectTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(dbApi.dbGetDatabases).mockResolvedValue([{ name: 'demo', characterSet: null, collation: null }])
    vi.mocked(dbApi.dbGetTables).mockResolvedValue([{ name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: null }])
    vi.mocked(dbApi.dbGetTablesLight).mockResolvedValue([{ name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: null }])
    vi.mocked(dbApi.dbGetColumns).mockResolvedValue([
      { name: 'id', dataType: 'INT', nullable: false, defaultValue: null, isPrimaryKey: true, comment: null },
    ])

    fetchWithCacheMock.mockImplementation(async (key: string, fetcher: () => Promise<unknown>) => ({
      data: await fetcher(),
      fromCache: false,
    }))
  })

  it('silentRefresh refreshes expanded nodes without invalidating the whole connection prefix', async () => {
    const objectTree = useObjectTree({
      connectionId: ref('conn-1'),
      connecting: ref(false),
      parentRef: ref(null),
      onSelectTable: vi.fn(),
      onSelectDatabase: vi.fn(),
      onSchemaUpdated: vi.fn(),
    })

    objectTree.treeNodes.value = [
      {
        id: 'db-demo',
        label: 'demo',
        type: 'database',
        isExpanded: true,
        isLoading: false,
        meta: { database: 'demo' },
        children: [
          {
            id: 'folder-tables-demo',
            label: 'tables',
            type: 'folder',
            folderType: 'tables',
            isExpanded: true,
            isLoading: false,
            meta: { database: 'demo' },
            children: [
              {
                id: 'tbl-demo-users',
                label: 'users',
                type: 'table',
                isExpanded: true,
                isLoading: false,
                meta: { database: 'demo', table: 'users' },
                children: [],
              },
            ],
          },
        ],
      },
    ]

    await objectTree.silentRefresh()

    expect(invalidateByPrefixMock).not.toHaveBeenCalledWith('conn-1')
    expect(invalidateMock).toHaveBeenCalledWith('conn-1:databases')
    expect(invalidateMock).toHaveBeenCalledWith('conn-1:demo:tables')
    expect(invalidateMock).toHaveBeenCalledWith('conn-1:demo:users:columns')
    expect(dbApi.dbGetTablesLight).toHaveBeenCalledWith('conn-1', 'demo')
    expect(dbApi.dbGetColumns).toHaveBeenCalledWith('conn-1', 'demo', 'users')
  })
})
