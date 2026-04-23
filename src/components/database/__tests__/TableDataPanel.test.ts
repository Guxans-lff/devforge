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
    ],
    emits: ['load-more', 'server-filter', 'server-sort'],
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
  store.openTableData('conn-1', 'demo', 'users')

  return {
    store,
    wrapper: mount(TableDataPanel, {
      props: {
        connectionId: 'conn-1',
        tabId: 'conn-1-table-data-demo-users',
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

    const { store, wrapper } = mountPanel()
    await flushPromises()

    await wrapper.findComponent({ name: 'QueryResultComponent' }).vm.$emit('load-more')
    await flushPromises()

    const ctx = store.getWorkspace('conn-1')?.tabs.find(tab => tab.id === 'conn-1-table-data-demo-users')?.context as any
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(1, 'conn-1', 'demo', 'users', 1, 100, null, 'id ASC')
    expect(dbGetTableDataMock).toHaveBeenNthCalledWith(2, 'conn-1', 'demo', 'users', 2, 100, null, 'id ASC', 'id', 2)
    expect(ctx.page).toBe(2)
    expect(ctx.seekOrderBy).toBe('id ASC')
    expect(ctx.seekColumn).toBe('id')
    expect(ctx.seekValue).toBe(3)
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
})
