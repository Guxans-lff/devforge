import { mount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  browseTableMock: vi.fn(),
  handleDatabaseSelectMock: vi.fn(),
  handleExecuteMock: vi.fn(),
  handleBatchExecuteMock: vi.fn(),
  handleExplainMock: vi.fn(),
  handleRefreshMock: vi.fn(),
  clearSqlErrorAnalysisMock: vi.fn(),
  loadMoreRowsMock: vi.fn(),
  handleServerFilterMock: vi.fn(),
  handleServerSortMock: vi.fn(),
  applyFixedSqlMock: vi.fn(),
  closeContextMenuMock: vi.fn(),
  setActiveResultTabMock: vi.fn(),
  closeResultTabMock: vi.fn(),
  closeOtherResultTabsMock: vi.fn(),
  closeAllResultTabsMock: vi.fn(),
  togglePinResultTabMock: vi.fn(),
  showContextMenuMock: vi.fn(),
  setActiveSubResultMock: vi.fn(),
  dbAcquireSessionMock: vi.fn().mockResolvedValue(undefined),
  dbReleaseSessionMock: vi.fn().mockResolvedValue(undefined),
  aiInitMock: vi.fn().mockResolvedValue(undefined),
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

vi.mock('splitpanes', () => ({
  Splitpanes: defineComponent({
    name: 'Splitpanes',
    setup(_props, { slots }) {
      return () => h('div', { class: 'splitpanes-stub' }, slots.default?.())
    },
  }),
  Pane: defineComponent({
    name: 'Pane',
    setup(_props, { slots }) {
      return () => h('div', { class: 'pane-stub' }, slots.default?.())
    },
  }),
}))

vi.mock('@/components/database/SqlEditorLazy.vue', () => ({
  default: defineComponent({
    name: 'SqlEditor',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(_props, { expose }) {
      expose({
        getSelectedText: vi.fn(() => ''),
        formatDocument: vi.fn(),
      })
      return () => h('div', { class: 'sql-editor-stub' })
    },
  }),
}))

vi.mock('@/components/database/SqlSnippetPanel.vue', () => ({
  default: defineComponent({
    name: 'SqlSnippetPanel',
    setup() {
      return () => h('div', { class: 'sql-snippet-panel-stub' })
    },
  }),
}))

vi.mock('@/components/database/SqlToolbar.vue', () => ({
  default: defineComponent({
    name: 'SqlToolbar',
    setup() {
      return () => h('div', { class: 'sql-toolbar-stub' })
    },
  }),
}))

vi.mock('@/components/database/QueryResultSection.vue', () => ({
  default: defineComponent({
    name: 'QueryResultSection',
    setup() {
      return () => h('div', { class: 'query-result-section-stub' })
    },
  }),
}))

vi.mock('@/components/database/DangerConfirmDialog.vue', () => ({
  default: defineComponent({
    name: 'DangerConfirmDialog',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/components/database/ParamInputDialog.vue', () => ({
  default: defineComponent({
    name: 'ParamInputDialog',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/stores/ai-chat', () => ({
  useAiChatStore: () => ({
    providers: [],
    init: mocks.aiInitMock,
  }),
}))

vi.mock('@/composables/useResultTabs', () => ({
  useResultTabs: () => ({
    displayResult: ref(null),
    resultTabs: ref([]),
    activeResultTabId: ref(undefined),
    subResults: ref([]),
    isMultiResultTab: ref(false),
    activeSubResultIndex: ref(0),
    addResultTab: vi.fn(),
    closeContextMenu: mocks.closeContextMenuMock,
    setActiveResultTab: mocks.setActiveResultTabMock,
    closeResultTab: mocks.closeResultTabMock,
    closeOtherResultTabs: mocks.closeOtherResultTabsMock,
    closeAllResultTabs: mocks.closeAllResultTabsMock,
    togglePinResultTab: mocks.togglePinResultTabMock,
    showContextMenu: mocks.showContextMenuMock,
    contextMenu: ref(null),
    setActiveSubResult: mocks.setActiveSubResultMock,
  }),
}))

vi.mock('@/composables/useQueryExecution', () => ({
  useQueryExecution: () => ({
    browseTable: mocks.browseTableMock,
    handleDatabaseSelect: mocks.handleDatabaseSelectMock,
    handleExecute: mocks.handleExecuteMock,
    handleBatchExecute: mocks.handleBatchExecuteMock,
    handleExplain: mocks.handleExplainMock,
    handleRefresh: mocks.handleRefreshMock,
    clearSqlErrorAnalysis: mocks.clearSqlErrorAnalysisMock,
    clearLongRunningNotify: vi.fn(),
    loadMoreRows: mocks.loadMoreRowsMock,
    handleServerFilter: mocks.handleServerFilterMock,
    handleServerSort: mocks.handleServerSortMock,
    applyFixedSql: mocks.applyFixedSqlMock,
    toggleErrorStrategy: vi.fn(),
    handleBeginTransaction: vi.fn(),
    handleCommit: vi.fn(),
    handleRollback: vi.fn(),
    handleCancel: vi.fn(),
    analyzeSqlError: vi.fn(),
    pendingExecuteSql: ref(null),
    isExecuting: ref(false),
    isExplaining: ref(false),
    isInTransaction: ref(false),
    showExplain: ref(false),
    queryTimeout: ref(30),
    errorStrategy: ref('continue'),
    executionTimer: {
      isRunning: ref(false),
      elapsed: ref(0),
    },
    explainResult: ref(null),
    explainTableRows: computed(() => []),
    dangerConfirmOpen: ref(false),
    dangerStatements: ref([]),
    dangerNeedInput: ref(false),
    dangerInputTarget: ref(''),
    dangerConfirmInput: ref(''),
    dangerCanConfirm: ref(false),
    handleDangerConfirm: vi.fn(),
    paramDialogOpen: ref(false),
    paramNames: ref([]),
    paramValues: ref({}),
    executeWithParams: vi.fn(),
    isLoadingMore: ref(false),
  }),
}))

vi.mock('@/api/database', () => ({
  dbAcquireSession: (...args: unknown[]) => mocks.dbAcquireSessionMock(...args),
  dbReleaseSession: (...args: unknown[]) => mocks.dbReleaseSessionMock(...args),
}))

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import QueryPanel from '@/components/database/QueryPanel.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'

function seedQueryTab(context: Record<string, unknown>) {
  const store = useDatabaseWorkspaceStore()
  store.getOrCreate('conn-1')
  store.updateTabContext('conn-1', 'conn-1-query-1', context as any)
}

function mountPanel() {
  return mount(QueryPanel, {
    props: {
      connectionId: 'conn-1',
      connectionName: 'Demo',
      tabId: 'conn-1-query-1',
      isConnected: true,
      schemaCache: null,
      driver: 'mysql',
      databases: ['demo'],
      selectedDatabases: [],
    },
    attachTo: document.body,
  })
}

describe('QueryPanel checkPendingBrowse', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.dbAcquireSessionMock.mockResolvedValue(undefined)
    mocks.dbReleaseSessionMock.mockResolvedValue(undefined)
  })

  it('存在 tableBrowse 且 SQL 与表浏览目标一致时挂载后自动执行 browseTable', async () => {
    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`users`;',
      result: null,
      isExecuting: false,
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
        whereClause: '`name` LIKE \'%Ada%\'',
        orderBy: '`id` DESC',
      },
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.browseTableMock).toHaveBeenCalledTimes(1)
    expect(mocks.browseTableMock).toHaveBeenCalledWith('demo', 'users', '`name` LIKE \'%Ada%\'', '`id` DESC')

    wrapper.unmount()
  })

  it('已有 result 时不会重复执行 browseTable', async () => {
    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`users`;',
      isExecuting: false,
      result: {
        columns: [{ name: 'id', dataType: 'INT', nullable: false }],
        rows: [[1]],
        affectedRows: 0,
        executionTimeMs: 1,
        isError: false,
        error: null,
        totalCount: 1,
        truncated: false,
      },
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
      },
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.browseTableMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('正在执行时不会触发 pending browse', async () => {
    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`users`;',
      result: null,
      isExecuting: true,
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
      },
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.browseTableMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('SQL 已被手工改写时不会按旧 tableBrowse 自动恢复 browseTable', async () => {
    seedQueryTab({
      sql: 'SELECT now();',
      result: null,
      isExecuting: false,
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
      },
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.browseTableMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('tableBrowse 目标变化但 SQL 未同步时不会误触发 browseTable', async () => {
    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`users`;',
      result: null,
      isExecuting: false,
      tableBrowse: {
        database: 'demo',
        table: 'orders',
        currentPage: 1,
        pageSize: 200,
      },
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.browseTableMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('currentDatabase 与 tableBrowse.database 不一致时不会按旧浏览态自动恢复', async () => {
    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`users`;',
      result: null,
      isExecuting: false,
      currentDatabase: 'analytics',
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
      },
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.browseTableMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('currentDatabase 为空时允许按 tableBrowse 恢复明确的浏览态', async () => {
    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`users`;',
      result: null,
      isExecuting: false,
      currentDatabase: '',
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
      },
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.browseTableMock).toHaveBeenCalledTimes(1)
    expect(mocks.browseTableMock).toHaveBeenCalledWith('demo', 'users', undefined, undefined)

    wrapper.unmount()
  })
})
