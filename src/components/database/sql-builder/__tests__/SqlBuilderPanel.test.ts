import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  dbGetAllColumnsMock,
  dbGetColumnsMock,
  dbGetForeignKeysMock,
  dbGetSchemaBundleMock,
  dbGetTablesMock,
  fitViewMock,
} = vi.hoisted(() => ({
  dbGetAllColumnsMock: vi.fn(),
  dbGetColumnsMock: vi.fn(),
  dbGetForeignKeysMock: vi.fn(),
  dbGetSchemaBundleMock: vi.fn(),
  dbGetTablesMock: vi.fn(),
  fitViewMock: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return {
    ...actual,
    defineAsyncComponent: () => actual.defineComponent({
      name: 'AsyncComponentStub',
      props: ['modelValue'],
      setup(props) {
        return () => actual.h('div', { 'data-testid': 'sql-editor' }, props.modelValue ?? '')
      },
    }),
  }
})

vi.mock('@/api/database', () => ({
  dbGetAllColumns: dbGetAllColumnsMock,
  dbGetColumns: dbGetColumnsMock,
  dbGetForeignKeys: dbGetForeignKeysMock,
  dbGetSchemaBundle: dbGetSchemaBundleMock,
  dbGetTables: dbGetTablesMock,
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}))

vi.mock('@vue-flow/core', () => ({
  VueFlow: defineComponent({
    name: 'VueFlow',
    setup(_props, { slots }) {
      return () => h('div', { 'data-testid': 'vue-flow' }, slots.default?.())
    },
  }),
  useVueFlow: () => ({
    fitView: fitViewMock,
  }),
}))

vi.mock('splitpanes', () => ({
  Splitpanes: defineComponent({
    name: 'Splitpanes',
    setup(_props, { slots }) {
      return () => h('div', slots.default?.())
    },
  }),
  Pane: defineComponent({
    name: 'Pane',
    setup(_props, { slots }) {
      return () => h('div', slots.default?.())
    },
  }),
}))

vi.mock('lucide-vue-next', () => ({
  Search: defineComponent({ name: 'Search', setup: () => () => h('svg') }),
  Layout: defineComponent({ name: 'Layout', setup: () => () => h('svg') }),
  Maximize2: defineComponent({ name: 'Maximize2', setup: () => () => h('svg') }),
  Trash2: defineComponent({ name: 'Trash2', setup: () => () => h('svg') }),
  Plus: defineComponent({ name: 'Plus', setup: () => () => h('svg') }),
  Copy: defineComponent({ name: 'Copy', setup: () => () => h('svg') }),
  Play: defineComponent({ name: 'Play', setup: () => () => h('svg') }),
  X: defineComponent({ name: 'X', setup: () => () => h('svg') }),
  ArrowUpDown: defineComponent({ name: 'ArrowUpDown', setup: () => () => h('svg') }),
  Filter: defineComponent({ name: 'Filter', setup: () => () => h('svg') }),
}))

vi.mock('@/components/database/SqlEditorLazy.vue', () => ({
  default: defineComponent({
    name: 'SqlEditorLazy',
    props: ['modelValue', 'readOnly', 'language'],
    setup(props) {
      return () => h('div', { 'data-testid': 'sql-editor' }, props.modelValue ?? '')
    },
  }),
  name: 'SqlEditorLazy',
  __isTeleport: false,
  __isKeepAlive: false,
  __isSuspense: false,
  __v_isVNode: false,
}))

import SqlBuilderPanel from '@/components/database/sql-builder/SqlBuilderPanel.vue'
import { clearAllCache } from '@/composables/useMetadataCache'

const usersColumns = [
  {
    name: 'id',
    dataType: 'INT',
    nullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    comment: null,
  },
]

function mountPanel() {
  return mount(SqlBuilderPanel, {
    props: {
      connectionId: 'conn-1',
      database: 'demo',
    },
    global: {
      stubs: {
        SqlBuilderTableNode: defineComponent({
          name: 'SqlBuilderTableNode',
          setup() {
            return () => h('div')
          },
        }),
        SqlBuilderJoinEdge: defineComponent({
          name: 'SqlBuilderJoinEdge',
          setup() {
            return () => h('div')
          },
        }),
      },
    },
  })
}

describe('SqlBuilderPanel metadata cache', () => {
  beforeEach(() => {
    clearAllCache()
    vi.clearAllMocks()
    dbGetTablesMock.mockResolvedValue([
      { name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: null },
    ])
    dbGetForeignKeysMock.mockResolvedValue([])
    dbGetAllColumnsMock.mockResolvedValue({ users: usersColumns })
    dbGetColumnsMock.mockResolvedValue(usersColumns)
    dbGetSchemaBundleMock.mockResolvedValue({
      tables: [{ name: 'users', tableType: 'BASE TABLE', rowCount: null, comment: null }],
      foreignKeys: [],
      allColumns: { users: usersColumns },
    })
  })

  it('reuses cached schema bundle across remounts', async () => {
    const first = mountPanel()
    await flushPromises()
    first.unmount()

    const second = mountPanel()
    await flushPromises()
    second.unmount()

    expect(dbGetSchemaBundleMock).toHaveBeenCalledTimes(1)
    expect(dbGetTablesMock).not.toHaveBeenCalled()
    expect(dbGetForeignKeysMock).not.toHaveBeenCalled()
    expect(dbGetAllColumnsMock).not.toHaveBeenCalled()
  })

  it('uses warmed column metadata when adding a table', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    const tableEntry = wrapper.findAll('.cursor-pointer').find(node => node.text().includes('users'))
    expect(tableEntry).toBeTruthy()
    await tableEntry!.trigger('dblclick')
    await flushPromises()

    expect(dbGetColumnsMock).not.toHaveBeenCalled()
    expect(dbGetSchemaBundleMock).toHaveBeenCalledTimes(1)
  })
})
