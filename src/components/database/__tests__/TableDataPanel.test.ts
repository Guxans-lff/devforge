import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbGetTableDataMock, fetchPrimaryKeysMock } = vi.hoisted(() => ({
  dbGetTableDataMock: vi.fn(),
  fetchPrimaryKeysMock: vi.fn(),
}))

vi.mock('@/plugins/persistence', () => ({
  usePersistence: () => ({
    load: vi.fn().mockResolvedValue(false),
    autoSave: vi.fn(),
    saveImmediate: vi.fn(),
  }),
}))

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      t: (key: string) => key,
      locale: { value: 'zh-CN' },
    },
    install: vi.fn(),
  }),
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/api/database', () => ({
  dbGetTableData: dbGetTableDataMock,
}))

vi.mock('@/composables/usePrimaryKey', () => ({
  fetchPrimaryKeys: fetchPrimaryKeysMock,
}))

vi.mock('@/components/database/QueryResult.vue', () => ({
  default: defineComponent({
    name: 'QueryResultComponent',
    props: [
      'result',
      'loading',
      'loadingMore',
      'hasMoreServerRows',
      'isTableBrowse',
      'connectionId',
      'database',
      'tableName',
      'driver',
      'tableBrowse',
    ],
    emits: ['load-more', 'server-filter', 'server-sort', 'sync-table-browse'],
    setup(props, { emit }) {
      return () => h('div', {
        'data-testid': 'query-result',
        'data-has-more': String(props.hasMoreServerRows),
        onLoadMore: () => emit('load-more'),
        onServerSort: (event: CustomEvent<string>) => emit('server-sort', event.detail),
      })
    },
  }),
}))

vi.mock('lucide-vue-next', () => ({
  RefreshCw: defineComponent({
    name: 'RefreshCw',
    setup() {
      return () => h('svg')
    },
  }),
}))

import TableDataPanel from '@/components/database/TableDataPanel.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { QueryResult } from '@/types/database'

function makeResult(rows: unknown[][], dataType = 'INT', totalCount: number | null = rows.length): QueryResult {
  return {
    columns: [
      { name: 'id', dataType, nullable: false },
      { name: 'name', dataType: 'VARCHAR', nullable: true },
    ],
    rows,
    affectedRows: 0,
    executionTimeMs: 1,
    isError: false,
    error: null,
    totalCount,
    truncated: false,
  }
}

function mountPanel() {
  const store = useDatabaseWorkspaceStore()
  const tab = store.addQueryTab('conn-1')
  store.updateTabContext('conn-1', tab.id, {
    tableBrowse: {
      database: 'demo',
      table: 'users',
      currentPage: 1,
      pageSize: 100,
    },
  })

  return {
    store,
    tabId: tab.id,
    wrapper: mount(TableDataPanel, {
      props: {
        connectionId: 'conn-1',
        tabId: tab.id,
        isConnected: true,
        driver: 'mysql',
      },
      global: {
        stubs: {
          Button: defineComponent({
            name: 'Button',
            emits: ['click'],
            setup(_props, { attrs, slots, emit }) {
              return () => h('button', {
                ...attrs,
                onClick: (event: MouseEvent) => emit('click', event),
              }, slots.default?.())
            },
          }),
          Select: defineComponent({
            name: 'Select',
            props: ['modelValue'],
            emits: ['update:modelValue'],
            setup(_props, { slots }) {
              return () => h('div', slots.default?.())
            },
          }),
          SelectTrigger: defineComponent({
            name: 'SelectTrigger',
            setup(_props, { slots }) {
              return () => h('button', slots.default?.())
            },
          }),
          SelectValue: true,
          SelectContent: defineComponent({
            name: 'SelectContent',
            setup(_props, { slots }) {
              return () => h('div', slots.default?.())
            },
          }),
          SelectItem: defineComponent({
            name: 'SelectItem',
            props: ['value'],
            setup(_props, { slots }) {
              return () => h('div', slots.default?.())
            },
          }),
        },
      },
    }),
  }
}

describe('TableDataPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    fetchPrimaryKeysMock.mockResolvedValue(['id'])
  })

  it('uses a numeric single-column primary key cursor when loading more rows', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult([[1, 'Ada'], [2, 'Linus']], 'INT', 3))
      .mockResolvedValueOnce(makeResult([[3, 'Grace']], 'INT', 4))

    const { store, tabId, wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('load-more')
    await flushPromises()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(1, 'conn-1', 'demo', 'users', 1, 100, null, 'id ASC')
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 2, 100, null, 'id ASC', 'id', 2)
    expect(ctx.tableBrowse.currentPage).toBe(2)
    expect(ctx.tableBrowse.seekOrderBy).toBe('id ASC')
    expect(ctx.tableBrowse.seekColumn).toBe('id')
    expect(ctx.tableBrowse.seekValue).toBe(3)
  })

  it('falls back to offset pagination when a server-side sort is active', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult([[1, 'Ada']], 'INT', 2))
      .mockResolvedValueOnce(makeResult([[2, 'Linus']], 'INT', 2))

    const { wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('server-sort', 'name DESC')
    await flushPromises()
    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('load-more')
    await flushPromises()

    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 1, 100, null, 'name DESC')
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(3, 'conn-1', 'demo', 'users', 2, 100, null, 'name DESC', undefined, undefined)
  })

  it('切换服务端排序时清空旧 seek 状态，避免 offset 与游标分页语义串线', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult([[1, 'Ada'], [2, 'Linus']], 'INT', 4))
      .mockResolvedValueOnce(makeResult([[10, 'Ada']], 'INT', 4))

    const { store, tabId, wrapper } = mountPanel()
    await flushPromises()

    store.updateTabContext('conn-1', tabId, {
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 2,
        pageSize: 100,
        seekOrderBy: 'id ASC',
        seekColumn: 'id',
        seekValue: 2,
      },
    })

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('server-sort', 'name DESC')
    await flushPromises()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 1, 100, null, 'name DESC')
    expect(ctx.tableBrowse.currentPage).toBe(1)
    expect(ctx.tableBrowse.orderBy).toBe('name DESC')
    expect(ctx.tableBrowse.seekOrderBy).toBeUndefined()
    expect(ctx.tableBrowse.seekColumn).toBeUndefined()
    expect(ctx.tableBrowse.seekValue).toBeUndefined()
  })

  it('applies server filter then rewrites tableBrowse paging and filter state', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult([[1, 'Ada'], [2, 'Linus']], 'INT', 4))
      .mockResolvedValueOnce(makeResult([[10, 'Ada']], 'INT', 1))

    const { store, tabId, wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('server-filter', "`name` LIKE '%Ada%'")
    await flushPromises()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 1, 100, "`name` LIKE '%Ada%'", 'id ASC')
    expect(ctx.tableBrowse.currentPage).toBe(1)
    expect(ctx.tableBrowse.whereClause).toBe("`name` LIKE '%Ada%'")
    expect(ctx.tableBrowse.orderBy).toBeUndefined()
    expect(ctx.tableBrowse.seekOrderBy).toBe('id ASC')
    expect(ctx.tableBrowse.seekColumn).toBe('id')
    expect(ctx.tableBrowse.seekValue).toBe(10)
  })

  it('load more 请求返回后若 tableBrowse 已变化则丢弃旧结果，避免旧分页回写污染新状态', async () => {
    let resolveMore!: (value: QueryResult) => void
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult([[1, 'Ada'], [2, 'Linus']], 'INT', 4))
      .mockImplementationOnce(() => new Promise<QueryResult>(resolve => {
        resolveMore = resolve
      }))

    const { store, tabId, wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('load-more')
    await flushPromises()

    store.updateTabContext('conn-1', tabId, {
      tableBrowse: {
        database: 'demo',
        table: 'orders',
        currentPage: 1,
        pageSize: 100,
      },
    })

    resolveMore(makeResult([[3, 'Grace']], 'INT', 4))
    await flushPromises()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(ctx.tableBrowse.table).toBe('orders')
    expect(ctx.tableBrowse.currentPage).toBe(1)
    expect(ctx.result).toBeNull()
  })

  it('changes page size then resets to first page and syncs new size to tableBrowse', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult([[1, 'Ada']], 'INT', 3))
      .mockResolvedValueOnce(makeResult([[1, 'Ada'], [2, 'Linus']], 'INT', 3))

    const { store, tabId, wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', '200')
    await flushPromises()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 1, 200, null, 'id ASC')
    expect(ctx.tableBrowse.currentPage).toBe(1)
    expect(ctx.tableBrowse.pageSize).toBe(200)
  })

  it('结果区切换筛选显示态时回写 tableBrowse，避免重建后丢失显示状态', async () => {
    dbGetTableDataMock.mockResolvedValueOnce(makeResult([[1, 'Ada']], 'INT', 3))

    const { store, tabId, wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('sync-table-browse', { showFilters: true })
    await flushPromises()

    let ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(ctx.tableBrowse.showFilters).toBe(true)

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('sync-table-browse', { showFilters: false })
    await flushPromises()

    ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(ctx.tableBrowse.showFilters).toBe(false)
  })

  it('将最新 tableBrowse 直接透传给 QueryResult，避免结果区维护第二份筛选排序状态', async () => {
    dbGetTableDataMock
      .mockResolvedValueOnce(makeResult([[1, 'Ada']], 'INT', 3))
      .mockResolvedValueOnce(makeResult([[10, 'Ada']], 'INT', 1))
      .mockResolvedValueOnce(makeResult([[10, 'Ada']], 'INT', 1))

    const { wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('server-filter', "`name` LIKE '%Ada%'")
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('server-sort', '`name` ASC')
    await flushPromises()

    const queryResult = wrapper.findComponent({ name: 'QueryResultComponent' })
    expect(queryResult.props('tableBrowse')).toEqual({
      database: 'demo',
      table: 'users',
      currentPage: 1,
      pageSize: 100,
      whereClause: "`name` LIKE '%Ada%'",
      orderBy: '`name` ASC',
      seekOrderBy: undefined,
      seekColumn: undefined,
      seekValue: undefined,
    })
  })
})
