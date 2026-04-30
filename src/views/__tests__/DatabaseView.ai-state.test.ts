import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { computed, defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  providers: [
    {
      id: 'provider-1',
      name: 'Provider 1',
      isDefault: true,
      models: [
        {
          id: 'model-1',
          name: 'Model 1',
          capabilities: {
            streaming: true,
            toolUse: false,
            vision: false,
            thinking: true,
            maxContext: 32000,
            maxOutput: 4096,
          },
        },
      ],
    },
  ],
  aiInitMock: vi.fn(),
  loadWorkspaceConfigMock: vi.fn(),
  getCredentialMock: vi.fn(),
  restoreStateMock: vi.fn(),
  enableAutoSaveMock: vi.fn(),
  updateConnectionStatusMock: vi.fn(),
  dbConnectMock: vi.fn(),
  dbDisconnectMock: vi.fn(),
  registerSchemaMock: vi.fn(),
  unregisterSchemaMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  queryPanelBrowseTableMocks: new Map<string, ReturnType<typeof vi.fn>>(),
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

vi.mock('splitpanes/dist/splitpanes.css', () => ({}))

vi.mock('@/components/database/ObjectTree.vue', () => ({
  default: defineComponent({
    name: 'ObjectTree',
    setup(_props, { expose }) {
      expose({
        treeNodes: [],
        selectedDatabases: [],
        clearTree: vi.fn(),
        loadDatabases: vi.fn().mockResolvedValue(undefined),
        silentRefresh: vi.fn(),
      })
      return () => h('div', { class: 'object-tree-stub' })
    },
  }),
}))

vi.mock('@/components/database/InnerTabBar.vue', () => ({
  default: defineComponent({
    name: 'InnerTabBar',
    setup() {
      return () => h('div', { class: 'inner-tab-bar-stub' })
    },
  }),
}))

vi.mock('@/components/database/QueryPanel.vue', () => ({
  default: defineComponent({
    name: 'QueryPanel',
    props: ['tabId'],
    emits: ['open-ai-config'],
    setup(props, { expose }) {
      const tabId = String(props.tabId ?? '')
      const browseTable = vi.fn()
      mocks.queryPanelBrowseTableMocks.set(tabId, browseTable)
      const executeSql = vi.fn()
      expose({
        browseTable,
        executeSql,
      })
      return () => h('div', {
        class: 'query-panel-stub',
        'data-tab-id': tabId,
      })
    },
  }),
}))

vi.mock('@/components/database/TableEditorPanel.vue', () => ({
  default: defineComponent({
    name: 'TableEditorPanel',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/components/database/ImportPanel.vue', () => ({
  default: defineComponent({
    name: 'ImportPanel',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/components/ai/AiProviderConfig.vue', () => ({
  default: defineComponent({
    name: 'AiProviderConfig',
    props: ['currentProviderId', 'currentModelId'],
    emits: ['back', 'applyProfile'],
    setup(props) {
      return () => h('div', {
        class: 'ai-provider-config-stub',
        'data-provider-id': props.currentProviderId ?? '',
        'data-model-id': props.currentModelId ?? '',
      })
    },
  }),
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: defineComponent({
    name: 'Sheet',
    props: ['open'],
    emits: ['update:open'],
    setup(_props, { slots }) {
      return () => h('div', { class: 'sheet-stub' }, slots.default?.())
    },
  }),
  SheetContent: defineComponent({
    name: 'SheetContent',
    setup(_props, { slots }) {
      return () => h('div', { class: 'sheet-content-stub' }, slots.default?.())
    },
  }),
  SheetHeader: defineComponent({
    name: 'SheetHeader',
    setup(_props, { slots }) {
      return () => h('div', { class: 'sheet-header-stub' }, slots.default?.())
    },
  }),
  SheetTitle: defineComponent({
    name: 'SheetTitle',
    setup(_props, { slots }) {
      return () => h('div', { class: 'sheet-title-stub' }, slots.default?.())
    },
  }),
}))

vi.mock('@/components/ui/confirm-dialog/ConfirmDialog.vue', () => ({
  default: defineComponent({
    name: 'ConfirmDialog',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/components/database/EnvironmentBanner.vue', () => ({
  default: defineComponent({
    name: 'EnvironmentBanner',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/components/database/BreadcrumbNav.vue', () => ({
  default: defineComponent({
    name: 'BreadcrumbNav',
    setup() {
      return () => h('div')
    },
  }),
}))

vi.mock('@/stores/ai-chat', () => ({
  useAiChatStore: () => ({
    providers: mocks.providers,
    get defaultProvider() {
      return mocks.providers[0] ?? null
    },
    init: mocks.aiInitMock,
    loadWorkspaceConfig: mocks.loadWorkspaceConfigMock,
    loadProviders: vi.fn(),
  }),
}))

vi.mock('@/stores/schema-registry', () => ({
  useSchemaRegistryStore: () => ({
    registerSchema: mocks.registerSchemaMock,
    unregisterSchema: mocks.unregisterSchemaMock,
  }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: mocks.toastSuccessMock,
    error: mocks.toastErrorMock,
  }),
}))

vi.mock('@/composables/useNotification', () => ({
  useNotification: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/composables/useSchemaCache', () => ({
  useSchemaCache: () => ({
    schemaCache: ref(null),
    isLoadingSchema: ref(false),
    refreshSchemaCache: vi.fn(),
    handleDatabaseSwitch: vi.fn(),
    clearSchemaCache: vi.fn(),
    dispose: vi.fn(),
  }),
}))

vi.mock('@/composables/usePoolStatusPolling', () => ({
  usePoolStatusPolling: () => ({
    poolStatus: ref(null),
    activate: vi.fn(),
    deactivate: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
  }),
}))

vi.mock('@/api/connection', () => ({
  getConfirmDanger: () => false,
  getEnvironment: () => 'development',
  getReadOnly: () => false,
  getCredential: mocks.getCredentialMock,
}))

vi.mock('@/api/database', () => ({
  dbConnect: mocks.dbConnectMock,
  dbDisconnect: mocks.dbDisconnectMock,
}))

vi.mock('@/composables/useDatabaseConnectionLifecycle', () => ({
  useDatabaseConnectionLifecycle: () => ({
    isConnected: ref(true),
    isConnecting: ref(false),
    ensureConnected: vi.fn().mockResolvedValue(true),
    mount: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn(),
    unmount: vi.fn().mockResolvedValue(undefined),
    resetDisconnectedState: vi.fn(),
  }),
}))

import DatabaseView from '@/views/DatabaseView.vue'
import { useConnectionStore } from '@/stores/connections'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'

function mountView() {
  const connectionStore = useConnectionStore()
  connectionStore.connections.set('conn-1', {
    record: {
      id: 'conn-1',
      name: 'Demo',
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      passwordId: 'cred-1',
      configJson: '{}',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    parsedConfig: {
      driver: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      database: 'demo',
    },
    status: 'connected',
  } as any)

  return mount(DatabaseView, {
    props: {
      connectionId: 'conn-1',
      connectionName: 'Demo',
    },
    global: {
      stubs: {
        KeepAlive: defineComponent({
          name: 'KeepAlive',
          setup(_props, { slots }) {
            return () => slots.default?.()
          },
        }),
      },
    },
  })
}

describe('DatabaseView AI 状态初始化', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.aiInitMock.mockResolvedValue(undefined)
    mocks.loadWorkspaceConfigMock.mockResolvedValue(undefined)
    mocks.getCredentialMock.mockResolvedValue('sk-test')
    mocks.dbConnectMock.mockResolvedValue({ databases: [] })
    mocks.dbDisconnectMock.mockResolvedValue(undefined)
  })

  it('激活 query tab 时自动回填默认 provider、model 和 API Key 状态', async () => {
    const workspaceStore = useDatabaseWorkspaceStore()
    const queryTab = workspaceStore.getOrCreate('conn-1').tabs[0]

    const wrapper = mountView()
    await flushPromises()

    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === queryTab.id)?.context as any
    expect(mocks.aiInitMock).toHaveBeenCalled()
    expect(mocks.getCredentialMock).toHaveBeenCalledWith('ai-provider-provider-1')
    expect(ctx.aiProviderId).toBe('provider-1')
    expect(ctx.aiModelId).toBe('model-1')
    expect(ctx.aiHasApiKey).toBe(true)

    wrapper.unmount()
  })

  it('打开 AI 配置前先完成状态 hydration，避免首屏显示未配置', async () => {
    const workspaceStore = useDatabaseWorkspaceStore()
    workspaceStore.getOrCreate('conn-1')

    const wrapper = mountView()
    await flushPromises()

    mocks.getCredentialMock.mockResolvedValue('sk-test-2')
    await (wrapper.vm as unknown as { openAiConfig: () => Promise<void> }).openAiConfig()
    await flushPromises()

    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs[0]?.context as any
    const config = wrapper.find('.ai-provider-config-stub')

    expect(mocks.loadWorkspaceConfigMock).toHaveBeenCalledWith('D:/Project/DevForge/devforge')
    expect(ctx.aiProviderId).toBe('provider-1')
    expect(ctx.aiModelId).toBe('model-1')
    expect(ctx.aiHasApiKey).toBe(true)
    expect(config.attributes('data-provider-id')).toBe('provider-1')
    expect(config.attributes('data-model-id')).toBe('model-1')

    wrapper.unmount()
  })
})

describe('DatabaseView 表浏览入口统一', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.queryPanelBrowseTableMocks.clear()
    mocks.aiInitMock.mockResolvedValue(undefined)
    mocks.loadWorkspaceConfigMock.mockResolvedValue(undefined)
    mocks.getCredentialMock.mockResolvedValue('sk-test')
    mocks.dbConnectMock.mockResolvedValue({ databases: [] })
    mocks.dbDisconnectMock.mockResolvedValue(undefined)
  })

  it('选择表时优先复用处于 tableBrowse 模式的 query tab 并回填统一上下文', async () => {
    const workspaceStore = useDatabaseWorkspaceStore()
    const queryTab = workspaceStore.getOrCreate('conn-1').tabs[0]
    workspaceStore.updateTabContext('conn-1', queryTab.id, {
      sql: 'SELECT * FROM `demo`.`old_users`;',
      tableBrowse: {
        database: 'demo',
        table: 'old_users',
        currentPage: 3,
        pageSize: 50,
        whereClause: '`id` > 10',
        orderBy: '`id` DESC',
      },
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
      resultTabs: [{ id: 'stale', title: '旧结果', type: 'single' } as any],
      activeResultTabId: 'stale',
    })

    const wrapper = mountView()
    await flushPromises()

    ;(wrapper.vm as unknown as { handleSelectTable: (database: string, table: string) => void }).handleSelectTable('demo', 'users')
    await flushPromises()

    const reusedTab = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === queryTab.id)
    const ctx = reusedTab?.context as any

    expect(workspaceStore.getWorkspace('conn-1')?.activeTabId).toBe(queryTab.id)
    expect(ctx.sql).toBe('SELECT * FROM `demo`.`users`;')
    expect(ctx.currentDatabase).toBe('demo')
    expect(ctx.tableBrowse).toEqual({
      database: 'demo',
      table: 'users',
      currentPage: 1,
      pageSize: 200,
    })
    expect(ctx.result).toBeNull()
    expect(ctx.resultTabs).toEqual([])
    expect(ctx.activeResultTabId).toBeUndefined()
    expect(wrapper.find('.query-panel-stub').attributes('data-tab-id')).toBe(queryTab.id)

    wrapper.unmount()
  })

  it('当前 query tab 有手写 SQL 时切表会新建 query tab，避免覆盖用户输入', async () => {
    const workspaceStore = useDatabaseWorkspaceStore()
    const queryTab = workspaceStore.getOrCreate('conn-1').tabs[0]
    workspaceStore.updateTabContext('conn-1', queryTab.id, {
      sql: 'SELECT now();',
      currentDatabase: 'demo',
      tableBrowse: undefined,
    })

    const wrapper = mountView()
    await flushPromises()

    ;(wrapper.vm as unknown as { handleSelectTable: (database: string, table: string) => void }).handleSelectTable('demo', 'orders')
    await flushPromises()

    const ws = workspaceStore.getWorkspace('conn-1')
    expect(ws?.tabs).toHaveLength(2)

    const originalCtx = ws?.tabs.find(tab => tab.id === queryTab.id)?.context as any
    const newTab = ws?.tabs.find(tab => tab.id !== queryTab.id)
    const newCtx = newTab?.context as any

    expect(originalCtx.sql).toBe('SELECT now();')
    expect(ws?.activeTabId).toBe(newTab?.id)
    expect(newCtx.sql).toBe('SELECT * FROM `demo`.`orders`;')
    expect(newCtx.currentDatabase).toBe('demo')
    expect(newCtx.tableBrowse).toEqual({
      database: 'demo',
      table: 'orders',
      currentPage: 1,
      pageSize: 200,
    })

    wrapper.unmount()
  })

  it('复用 query tab 切表时只触发一次 browseTable，避免 handleSelectTable 与 pending browse 重复执行', async () => {
    const workspaceStore = useDatabaseWorkspaceStore()
    const queryTab = workspaceStore.getOrCreate('conn-1').tabs[0]
    workspaceStore.updateTabContext('conn-1', queryTab.id, {
      sql: 'SELECT * FROM `demo`.`old_users`;',
      tableBrowse: {
        database: 'demo',
        table: 'old_users',
        currentPage: 2,
        pageSize: 100,
      },
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
    })

    const wrapper = mountView()
    await flushPromises()

    const initialBrowseMock = mocks.queryPanelBrowseTableMocks.get(queryTab.id)
    expect(initialBrowseMock).toBeTruthy()

    ;(wrapper.vm as unknown as { handleSelectTable: (database: string, table: string) => void }).handleSelectTable('demo', 'users')
    await flushPromises()

    const activeTabId = workspaceStore.getWorkspace('conn-1')?.activeTabId ?? ''
    const activeBrowseMock = mocks.queryPanelBrowseTableMocks.get(activeTabId)
    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === activeTabId)?.context as any

    expect(activeBrowseMock).toBeTruthy()
    expect(ctx.sql).toBe('SELECT * FROM `demo`.`users`;')
    expect(ctx.currentDatabase).toBe('demo')
    expect(ctx.tableBrowse).toEqual({
      database: 'demo',
      table: 'users',
      currentPage: 1,
      pageSize: 200,
    })

    wrapper.unmount()
  })

  it('恢复到失效 activeTabId 时自动回退到可用 query tab，再切表仍保留单一 tableBrowse 状态', async () => {
    const workspaceStore = useDatabaseWorkspaceStore()
    const queryTab = workspaceStore.getOrCreate('conn-1').tabs[0]
    workspaceStore.updateTabContext('conn-1', queryTab.id, {
      sql: 'SELECT * FROM `demo`.`users`;',
      currentDatabase: 'demo',
      tableBrowse: {
        database: 'demo',
        table: 'users',
        currentPage: 1,
        pageSize: 200,
      },
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
    })
    workspaceStore.setActiveInnerTab('conn-1', 'missing-tab')

    const wrapper = mountView()
    await flushPromises()

    expect(workspaceStore.getWorkspace('conn-1')?.activeTabId).toBe(queryTab.id)

    ;(wrapper.vm as unknown as { handleSelectTable: (database: string, table: string) => void }).handleSelectTable('demo', 'orders')
    await flushPromises()

    const activeBrowseMock = mocks.queryPanelBrowseTableMocks.get(queryTab.id)
    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === queryTab.id)?.context as any

    expect(activeBrowseMock).toBeTruthy()
    expect(ctx.sql).toBe('SELECT * FROM `demo`.`orders`;')
    expect(ctx.tableBrowse).toEqual({
      database: 'demo',
      table: 'orders',
      currentPage: 1,
      pageSize: 200,
    })

    wrapper.unmount()
  })
})
