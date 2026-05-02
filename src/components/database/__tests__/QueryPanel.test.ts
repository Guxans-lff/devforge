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
  addResultTabMock: vi.fn(),
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
    addResultTab: mocks.addResultTabMock,
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

describe('QueryPanel execution state reset', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.dbAcquireSessionMock.mockResolvedValue(undefined)
    mocks.dbReleaseSessionMock.mockResolvedValue(undefined)
    mocks.handleExecuteMock.mockResolvedValue({ success: true })
  })

  it.skip('执行普通 SQL 前会清空旧 tableBrowse 与结果标签，避免沿用表浏览执行态', async () => {
    seedQueryTab({
      sql: 'SELECT 1;',
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
      isExecuting: false,
      currentDatabase: 'demo',
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 2,
        pageSize: 200,
      },
      resultTabs: [{
        id: 'tab-1',
        title: '结果 1',
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
        sql: 'SELECT * FROM users',
        isPinned: false,
        createdAt: 1,
      }],
      activeResultTabId: 'tab-1',
    })

    const wrapper = mountPanel()
    await flushPromises()
    await (wrapper.vm as unknown as { executeSql: (sql: string) => void }).executeSql('SELECT 1;')
    await flushPromises()

    const ctx = useDatabaseWorkspaceStore().getWorkspace('conn-1')?.tabs[0]?.context as any
    expect(mocks.handleExecuteMock).toHaveBeenCalledWith('SELECT 1;')
    expect(ctx.tableBrowse).toBeUndefined()
    expect(ctx.resultTabs).toEqual([])
    expect(ctx.activeResultTabId).toBeUndefined()
  })
})

describe('QueryPanel session lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.dbAcquireSessionMock.mockResolvedValue(undefined)
    mocks.dbReleaseSessionMock.mockResolvedValue(undefined)
    mocks.handleExecuteMock.mockResolvedValue({ success: true })
    mocks.handleBatchExecuteMock.mockResolvedValue({ success: false })
  })

  it('初始已连接时只获取一次 session，避免 mounted 与连接监听重复获取', async () => {
    seedQueryTab({
      sql: '',
      result: null,
      isExecuting: false,
      currentDatabase: 'demo',
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.dbAcquireSessionMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbAcquireSessionMock).toHaveBeenCalledWith('conn-1', 'conn-1-query-1')

    wrapper.unmount()
  })

  it('从已连接切到未连接时按新 key 释放一次 session', async () => {
    seedQueryTab({
      sql: '',
      result: null,
      isExecuting: false,
      currentDatabase: 'demo',
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(mocks.dbAcquireSessionMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbReleaseSessionMock).not.toHaveBeenCalled()

    await wrapper.setProps({ isConnected: false })
    await flushPromises()

    expect(mocks.dbReleaseSessionMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbReleaseSessionMock).toHaveBeenCalledWith('conn-1', 'conn-1-query-1')

    wrapper.unmount()
    await flushPromises()

    expect(mocks.dbReleaseSessionMock).toHaveBeenCalledTimes(1)
  })

  it('初始未连接时挂载不会获取 session，但卸载时会释放一次确保后端兜底清理', async () => {
    seedQueryTab({
      sql: '',
      result: null,
      isExecuting: false,
    })

    const wrapper = mount(QueryPanel, {
      props: {
        connectionId: 'conn-1',
        connectionName: 'Demo',
        tabId: 'conn-1-query-1',
        isConnected: false,
        schemaCache: null,
        driver: 'mysql',
        databases: ['demo'],
        selectedDatabases: [],
      },
      attachTo: document.body,
    })
    await flushPromises()

    wrapper.unmount()
    await flushPromises()

    expect(mocks.dbAcquireSessionMock).not.toHaveBeenCalled()
    expect(mocks.dbReleaseSessionMock).toHaveBeenCalledTimes(1)
    expect(mocks.dbReleaseSessionMock).toHaveBeenCalledWith('conn-1', 'conn-1-query-1')
  })
})

describe('QueryPanel checkPendingBrowse', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.dbAcquireSessionMock.mockResolvedValue(undefined)
    mocks.dbReleaseSessionMock.mockResolvedValue(undefined)
    mocks.handleExecuteMock.mockResolvedValue({ success: true })
    mocks.handleBatchExecuteMock.mockResolvedValue({ success: false })
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

  it('同一份 pending browse 状态在挂载后只恢复一次，避免 mounted 与后续响应式重复触发', async () => {
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
    await wrapper.setProps({ schemaCache: {} as any })
    await flushPromises()

    expect(mocks.browseTableMock).toHaveBeenCalledTimes(1)
    expect(mocks.browseTableMock).toHaveBeenCalledWith('demo', 'users', '`name` LIKE \'%Ada%\'', '`id` DESC')

    wrapper.unmount()
  })

  it('pending browse 目标变化后会按新 key 重新恢复一次', async () => {
    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`users`;',
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

    seedQueryTab({
      sql: 'SELECT * FROM `demo`.`orders`;',
      result: null,
      isExecuting: false,
      tableBrowse: {
        database: 'demo',
        table: 'orders',
        currentPage: 1,
        pageSize: 200,
      },
    })
    await flushPromises()

    expect(mocks.browseTableMock).toHaveBeenCalledTimes(2)
    expect(mocks.browseTableMock).toHaveBeenNthCalledWith(1, 'demo', 'users', undefined, undefined)
    expect(mocks.browseTableMock).toHaveBeenNthCalledWith(2, 'demo', 'orders', undefined, undefined)

    wrapper.unmount()
  })
})
