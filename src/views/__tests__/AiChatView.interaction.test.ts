import { mount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiMessage, ModelConfig, ProviderConfig } from '@/types/ai'
import AiChatView from '@/views/AiChatView.vue'

const mocks = vi.hoisted(() => ({
  state: {
    chat: null as any,
    aiStore: null as any,
    workspaceStore: null as any,
    workspaceFilesStore: null as any,
    memoryStore: null as any,
    settingsStore: null as any,
    fileAttachment: null as any,
    shellDraft: '',
  },
  getCredentialMock: vi.fn(),
  setApprovalModeMock: vi.fn(),
  setActiveSessionIdMock: vi.fn(),
}))

vi.mock('@/composables/useAiChat', () => ({
  useAiChat: () => mocks.state.chat,
}))

vi.mock('@/stores/ai-chat', () => ({
  useAiChatStore: () => mocks.state.aiStore,
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => mocks.state.workspaceStore,
}))

vi.mock('@/stores/workspace-files', () => ({
  useWorkspaceFilesStore: () => mocks.state.workspaceFilesStore,
}))

vi.mock('@/stores/ai-memory', () => ({
  useAiMemoryStore: () => mocks.state.memoryStore,
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => mocks.state.settingsStore,
}))

vi.mock('@/composables/useFileAttachment', () => ({
  useFileAttachment: () => mocks.state.fileAttachment,
  stripMentionMarkers: (text: string) => text.replace(/@\S+/g, '').replace(/\s{2,}/g, ' ').trim(),
}))

vi.mock('@/api/connection', () => ({
  getCredential: mocks.getCredentialMock,
}))

vi.mock('@/composables/useToolApproval', () => ({
  setApprovalMode: mocks.setApprovalModeMock,
  setActiveSessionId: mocks.setActiveSessionIdMock,
}))

vi.mock('@/utils/file-markers', () => ({
  checkTokenLimit: () => ({ warn: false, usage: 0, limit: 0 }),
}))

vi.mock('@/utils/ai-prompts', () => ({
  buildToolGuide: () => '',
}))

const AiInputAreaStub = defineComponent({
  name: 'AiInputArea',
  emits: [
    'send',
    'abort',
    'clear-session',
    'update:selected-provider-id',
    'update:selected-model-id',
    'update:chat-mode',
    'open-config',
    'select-files',
    'drop-files',
    'drop-file-path',
    'remove-attachment',
    'mention-file',
    'compact',
  ],
  setup(_props, { emit }) {
    return () => h('div', { class: 'ai-input-area-stub' }, [
      h('button', { class: 'send-first', onClick: () => emit('send', 'first request') }, 'send-first'),
      h('button', { class: 'send-second', onClick: () => emit('send', 'second request') }, 'send-second'),
    ])
  },
})

const AiMessageListVirtualStub = defineComponent({
  name: 'AiMessageListVirtual',
  emits: ['continue', 'bumpMaxOutput', 'loadMoreHistory'],
  setup(_props, { emit, expose }) {
    expose({ scrollContainer: document.createElement('div') })
    return () => h('div', { class: 'ai-message-list-stub' }, [
      h('button', { class: 'emit-continue', onClick: () => emit('continue') }, 'continue'),
      h('button', { class: 'emit-bump', onClick: () => emit('bumpMaxOutput', 4096) }, 'bump'),
      h('button', { class: 'emit-history', onClick: () => emit('loadMoreHistory') }, 'history'),
    ])
  },
})

const AiSessionDrawerStub = defineComponent({
  name: 'AiSessionDrawer',
  emits: ['select', 'create', 'delete', 'preload', 'update:open'],
  setup(_props, { emit }) {
    return () => h('div', { class: 'ai-session-drawer-stub' }, [
      h('button', { class: 'select-session', onClick: () => emit('select', 'session-2') }, 'select-session'),
      h('button', { class: 'preload-session', onMouseenter: () => emit('preload', 'session-2') }, 'preload-session'),
      h('button', { class: 'create-session', onClick: () => emit('create') }, 'create-session'),
    ])
  },
})

const AiSpawnedTasksPanelStub = defineComponent({
  name: 'AiSpawnedTasksPanel',
  emits: ['run', 'run-batch', 'retry', 'retry-batch', 'open', 'complete', 'cancel', 'cancel-batch', 'synthesize'],
  setup(_props, { emit }) {
    return () => h('div', { class: 'ai-spawned-tasks-panel-stub' }, [
      h('button', { class: 'run-task', onClick: () => emit('run', 'task-1') }, 'run-task'),
      h('button', { class: 'run-task-batch', onClick: () => emit('run-batch', ['task-1', 'task-2']) }, 'run-task-batch'),
      h('button', { class: 'retry-task-batch', onClick: () => emit('retry-batch', ['task-1', 'task-2']) }, 'retry-task-batch'),
      h('button', { class: 'open-task', onClick: () => emit('open', 'task-1') }, 'open-task'),
      h('button', { class: 'complete-task', onClick: () => emit('complete', 'task-1') }, 'complete-task'),
      h('button', { class: 'cancel-task', onClick: () => emit('cancel', 'task-1') }, 'cancel-task'),
      h('button', { class: 'cancel-task-batch', onClick: () => emit('cancel-batch', ['task-1', 'task-2']) }, 'cancel-task-batch'),
      h('button', { class: 'synthesize-tasks', onClick: () => emit('synthesize') }, 'synthesize-tasks'),
    ])
  },
})

const AiChatShellStub = defineComponent({
  name: 'AiChatShell',
  emits: [
    'update:showSessionDrawer',
    'update:showMemoryDrawer',
    'update:showFilePicker',
    'primaryAction',
    'secondaryAction',
    'openConfig',
    'selectWorkDir',
    'setWorkDir',
    'continue',
    'bumpMaxOutput',
    'loadMoreHistory',
    'scrollMessages',
    'send',
    'abort',
    'clearSession',
    'update:selectedProviderId',
    'update:selectedModelId',
    'update:chatMode',
    'dropFiles',
    'dropFilePath',
    'removeAttachment',
    'mentionFile',
    'compact',
    'selectSession',
    'createSession',
    'deleteSession',
    'preloadSession',
    'filePickerConfirm',
    'exitImmersive',
  ],
  setup(_props, { emit, expose, slots }) {
    expose({
      scrollContainer: document.createElement('div'),
      setInputDraft: (value: string) => {
        mocks.state.shellDraft = value
      },
      focusInput: vi.fn(),
    })
    return () => h('div', { class: 'ai-chat-shell-stub' }, [
      h('button', { class: 'select-session', onClick: () => emit('selectSession', 'session-2') }, 'select-session'),
      h('button', { class: 'preload-session', onMouseenter: () => emit('preloadSession', 'session-2') }, 'preload-session'),
      h('button', { class: 'create-session', onClick: () => emit('createSession') }, 'create-session'),
      h('button', { class: 'send-first', onClick: () => emit('send', 'first request') }, 'send-first'),
      h('button', { class: 'send-second', onClick: () => emit('send', 'second request') }, 'send-second'),
      h('button', { class: 'emit-continue', onClick: () => emit('continue') }, 'continue'),
      h('button', { class: 'emit-bump', onClick: () => emit('bumpMaxOutput', 4096) }, 'bump'),
      h('button', { class: 'emit-history', onClick: () => emit('loadMoreHistory') }, 'history'),
      slots['empty-state-extra']?.(),
      slots['after-compact']?.(),
      slots['before-input']?.(),
    ])
  },
})

const GenericStub = defineComponent({
  name: 'GenericStub',
  setup(_props, { slots }) {
    return () => h('div', slots.default?.())
  },
})

function makeModel(): ModelConfig {
  return {
    id: 'model-1',
    name: 'Model 1',
    capabilities: {
      stream: true,
      toolUse: false,
      vision: false,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

function makeProvider(): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    providerType: 'openai',
    endpoint: 'https://api.example.com',
    models: [makeModel()],
    isDefault: true,
    createdAt: 1,
  }
}

function makeMessage(id: string, role: AiMessage['role'] = 'assistant'): AiMessage {
  return {
    id,
    role,
    content: `${role}-${id}`,
    timestamp: Date.now(),
  }
}

function createChatMock(messages: AiMessage[] = []) {
  return {
    messages: ref(messages),
    isStreaming: ref(false),
    isLoading: ref(false),
    canLoadMoreHistory: ref(false),
    historyRemainingRecords: ref(0),
    historyLoadMorePending: ref(false),
    historyLoadMoreError: ref(null),
    workDir: ref(''),
    error: ref<string | null>(null),
    totalTokens: ref(0),
    observability: ref({
      sessionStartedAt: null,
      firstTokenAt: null,
      firstTokenLatencyMs: 120,
      responseCompletedAt: null,
      responseDurationMs: 840,
      loadHistoryStartedAt: null,
      loadHistoryDurationMs: 60,
      historyRestoreCount: messages.length,
      compactTriggeredCount: 0,
      pendingToolQueueLength: 0,
      lastToolRun: {
        totalCalls: 0,
        successCount: 0,
        errorCount: 0,
        cancelledCount: 0,
        timeoutCount: 0,
        retryCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        averageDurationMs: 0,
      },
      trend: {
        sampleCount: 0,
        firstTokenAverageMs: null,
        responseAverageMs: null,
        toolRunAverageMs: null,
        lastFirstTokenDeltaMs: null,
        lastResponseDeltaMs: null,
        lastToolRunDeltaMs: null,
      },
    }),
    latestUsage: ref({
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
    }),
    isCompacting: ref(false),
    currentPhase: ref(null),
    awaitingPlanApproval: ref(false),
    pendingPlan: ref(''),
    spawnedTasks: ref([]),
    availableWorkDirs: computed(() => []),
    planGateEnabled: ref(false),
    planApproved: ref(false),
    loadHistory: vi.fn().mockResolvedValue(undefined),
    loadMoreHistory: vi.fn().mockResolvedValue(undefined),
    preloadHistory: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    regenerate: vi.fn().mockResolvedValue(undefined),
    removeLastError: vi.fn(),
    clearMessages: vi.fn(),
    manualCompact: vi.fn().mockResolvedValue(false),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    handleScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    isPathInWorkspace: vi.fn().mockReturnValue(false),
  }
}

function mountView() {
  return mount(AiChatView, {
    global: {
      stubs: {
        AiChatShell: AiChatShellStub,
        AiInputArea: AiInputAreaStub,
        AiMessageListVirtual: AiMessageListVirtualStub,
        AiUsageBadge: true,
        AiProviderConfig: true,
        AiSessionDrawer: AiSessionDrawerStub,
        AiMemoryDrawer: true,
        AiCompactBanner: true,
        AiDiagnosticsPanel: defineComponent({
          name: 'AiDiagnosticsPanel',
          setup() {
            return () => h('div', { class: 'ai-diagnostics-panel-stub' }, 'diagnostics')
          },
        }),
        AiPlanGateBar: true,
        AiPhaseBar: true,
        AiSpawnedTasksPanel: AiSpawnedTasksPanelStub,
        WorkspaceFilePicker: true,
        Button: GenericStub,
        Tooltip: GenericStub,
        TooltipContent: GenericStub,
        TooltipProvider: GenericStub,
        TooltipTrigger: GenericStub,
        DropdownMenu: GenericStub,
        DropdownMenuContent: GenericStub,
        DropdownMenuItem: GenericStub,
        DropdownMenuLabel: GenericStub,
        DropdownMenuSeparator: GenericStub,
        DropdownMenuTrigger: GenericStub,
        Bot: true,
        Settings: true,
        History: true,
        Plus: true,
        Minimize2: true,
        Sparkles: true,
        Zap: true,
        MessageSquareText: true,
        FolderOpen: true,
        Brain: true,
        Check: true,
      },
    },
  })
}

describe('AiChatView interaction', () => {
  beforeEach(() => {
    mocks.state.shellDraft = ''
    const provider = makeProvider()
    mocks.state.chat = createChatMock()
    mocks.state.aiStore = {
      providers: [provider],
      defaultProvider: provider,
      sessions: [{ id: 'session-2', title: 'Session 2' }],
      activeSessionId: null,
      currentWorkspaceConfig: null,
      init: vi.fn().mockResolvedValue(undefined),
      loadWorkspaceConfig: vi.fn().mockResolvedValue(undefined),
      saveProvider: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(undefined),
      removeSession: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    }
    mocks.state.workspaceStore = reactive({
      activeTabId: 'ai-tab-1',
      tabs: [
        {
          id: 'ai-tab-1',
          type: 'ai-chat',
          title: 'Chat Tab',
          closable: true,
          meta: { sessionId: 'session-1' },
        },
      ],
      panelState: { immersiveMode: false },
      updateTabTitle: vi.fn(),
      updateTabMeta: vi.fn(),
      addTab: vi.fn(),
      setActiveTab: vi.fn(),
    })
    mocks.state.workspaceFilesStore = {
      roots: [],
      activeEditor: null,
    }
    mocks.state.memoryStore = {
      setWorkspace: vi.fn(),
    }
    mocks.state.settingsStore = {
      settings: {
        devMode: true,
      },
    }
    mocks.state.fileAttachment = {
      attachments: ref([]),
      getReadyAttachments: vi.fn(() => []),
      clearAttachments: vi.fn(),
      handleDomDrop: vi.fn(),
      removeAttachment: vi.fn(),
    }
    mocks.getCredentialMock.mockResolvedValue('test-api-key')
    mocks.setApprovalModeMock.mockReset()
    mocks.setActiveSessionIdMock.mockReset()
  })

  it('queues a second send while streaming and dispatches it after the first finishes', async () => {
    let releaseFirstSend!: () => void
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve
    })

    mocks.state.chat.send.mockImplementationOnce(async () => {
      mocks.state.chat.isStreaming.value = true
      await firstSendGate
      mocks.state.chat.isStreaming.value = false
    })
    mocks.state.chat.send.mockResolvedValueOnce(undefined)

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.send-first').trigger('click')
    await nextTick()

    expect(mocks.state.chat.send).toHaveBeenCalledTimes(1)
    expect(mocks.state.chat.send).toHaveBeenNthCalledWith(
      1,
      'first request',
      expect.objectContaining({ id: 'provider-1' }),
      expect.objectContaining({ id: 'model-1' }),
      'test-api-key',
      undefined,
      [],
    )

    await wrapper.find('.send-second').trigger('click')
    await nextTick()

    expect(mocks.state.chat.send).toHaveBeenCalledTimes(1)

    releaseFirstSend()
    await flushPromises()

    expect(mocks.state.chat.send).toHaveBeenCalledTimes(2)
    expect(mocks.state.chat.send).toHaveBeenNthCalledWith(
      2,
      'second request',
      expect.objectContaining({ id: 'provider-1' }),
      expect.objectContaining({ id: 'model-1' }),
      'test-api-key',
      undefined,
      [],
    )
  })

  it('forwards the shared message list loadMoreHistory event to chat.loadMoreHistory', async () => {
    mocks.state.chat.messages.value = [makeMessage('assistant-1')]
    mocks.state.chat.canLoadMoreHistory.value = true

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.emit-history').trigger('click')

    expect(mocks.state.chat.loadMoreHistory).toHaveBeenCalledTimes(1)
  })

  it('loads history once when selecting another session', async () => {
    const wrapper = mountView()
    await flushPromises()

    mocks.state.chat.loadHistory.mockClear()

    await wrapper.find('.select-session').trigger('click')
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-tab-1', { sessionId: 'session-2' })
    expect(mocks.state.aiStore.setActiveSession).toHaveBeenCalledWith('session-2')
    expect(mocks.state.chat.loadHistory).toHaveBeenCalledTimes(1)
    expect(mocks.state.chat.loadHistory).toHaveBeenCalledWith('session-2')
  })

  it('preloads a session when the session drawer requests it', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.preload-session').trigger('mouseenter')

    expect(mocks.state.chat.preloadHistory).toHaveBeenCalledWith('session-2')
  })

  it('dispatches spawned tasks into tabs and marks them complete explicitly', async () => {
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'inspect scheduler',
      status: 'pending',
      createdAt: 1000,
      retryCount: 0,
    }]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.run-task').trigger('click')

    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringContaining('ai-task-task-1-'),
      type: 'ai-chat',
      title: '[Task] inspect scheduler',
      meta: expect.objectContaining({
        initialMessage: 'inspect scheduler',
        sourceTaskId: 'task-1',
      }),
    }))
    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({
      status: 'running',
      taskTabId: expect.stringContaining('ai-task-task-1-'),
      taskSessionId: expect.stringContaining('session-task-task-1-'),
    })

    const taskTabId = mocks.state.chat.spawnedTasks.value[0].taskTabId
    await wrapper.find('.open-task').trigger('click')
    expect(mocks.state.workspaceStore.setActiveTab).toHaveBeenCalledWith(taskTabId)

    await wrapper.find('.complete-task').trigger('click')
    expect(mocks.state.chat.spawnedTasks.value[0].status).toBe('done')
    expect(mocks.state.chat.spawnedTasks.value[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('runs spawned tasks in batch from the dispatcher panel', async () => {
    mocks.state.chat.spawnedTasks.value = [
      {
        id: 'task-1',
        description: 'inspect scheduler',
        status: 'pending',
        createdAt: 1000,
        retryCount: 0,
      },
      {
        id: 'task-2',
        description: 'collect logs',
        status: 'pending',
        createdAt: 1001,
        retryCount: 0,
      },
    ]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.run-task-batch').trigger('click')

    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledTimes(2)
    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({ status: 'running' })
    expect(mocks.state.chat.spawnedTasks.value[1]).toMatchObject({ status: 'running' })
  })

  it('synthesizes spawned task results into the parent input draft', async () => {
    mocks.state.chat.spawnedTasks.value = [
      {
        id: 'task-1',
        description: 'inspect scheduler',
        status: 'done',
        createdAt: 1000,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
        lastSummary: 'Scheduler queue is healthy after retry.',
      },
      {
        id: 'task-2',
        description: 'collect logs',
        status: 'cancelled',
        createdAt: 1001,
        retryCount: 1,
        sourceMessageId: 'assistant-1',
        dependsOn: ['task-1'],
        lastError: 'cancelled by user',
        lastSummary: 'Collected the latest worker logs before failure.',
      },
    ]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.synthesize-tasks').trigger('click')

    expect(mocks.state.shellDraft).toContain('Please synthesize the spawned task results')
    expect(mocks.state.shellDraft).toContain('Source Group #1')
    expect(mocks.state.shellDraft).toContain('inspect scheduler')
    expect(mocks.state.shellDraft).toContain('Scheduler queue is healthy after retry.')
    expect(mocks.state.shellDraft).toContain('Depends on: inspect scheduler')
    expect(mocks.state.shellDraft).toContain('cancelled by user')
  })

  it('does not run a task whose explicit dependency is unresolved', async () => {
    mocks.state.chat.spawnedTasks.value = [
      {
        id: 'task-1',
        description: 'inspect scheduler',
        status: 'running',
        createdAt: 1000,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
      },
      {
        id: 'task-2',
        description: 'collect logs',
        status: 'pending',
        createdAt: 1001,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
        dependsOn: ['task-1'],
      },
    ]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.run-task-batch').trigger('click')

    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledTimes(1)
    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({ status: 'running' })
    expect(mocks.state.chat.spawnedTasks.value[1]).toMatchObject({ status: 'pending' })
  })

  it('requests cancellation for a running spawned task tab', async () => {
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'inspect scheduler',
      status: 'running',
      createdAt: 1000,
      startedAt: 1200,
      taskTabId: 'ai-task-task-1',
      taskSessionId: 'session-task-task-1',
      retryCount: 0,
      lastSummary: 'Collected partial scheduler info',
    }]
    mocks.state.workspaceStore.tabs.push({
      id: 'ai-task-task-1',
      type: 'ai-chat',
      title: '[Task] inspect scheduler',
      closable: true,
      meta: {
        sessionId: 'session-task-task-1',
        sourceTaskId: 'task-1',
        taskStatus: 'running',
      },
    })

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.cancel-task').trigger('click')

    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-task-task-1', {
      taskCancelRequested: true,
      taskStatus: 'cancelled',
      taskError: 'ai.tasks.taskCancelled',
      taskSummary: 'Collected partial scheduler info',
    })
  })

  it('requests cancellation for all running spawned task tabs in batch', async () => {
    mocks.state.chat.spawnedTasks.value = [
      {
        id: 'task-1',
        description: 'inspect scheduler',
        status: 'running',
        createdAt: 1000,
        startedAt: 1200,
        taskTabId: 'ai-task-task-1',
        taskSessionId: 'session-task-task-1',
        retryCount: 0,
        lastSummary: 'Collected partial scheduler info',
      },
      {
        id: 'task-2',
        description: 'collect logs',
        status: 'running',
        createdAt: 1001,
        startedAt: 1250,
        taskTabId: 'ai-task-task-2',
        taskSessionId: 'session-task-task-2',
        retryCount: 0,
      },
    ]
    mocks.state.workspaceStore.tabs.push(
      {
        id: 'ai-task-task-1',
        type: 'ai-chat',
        title: '[Task] inspect scheduler',
        closable: true,
        meta: {
          sessionId: 'session-task-task-1',
          sourceTaskId: 'task-1',
          taskStatus: 'running',
        },
      },
      {
        id: 'ai-task-task-2',
        type: 'ai-chat',
        title: '[Task] collect logs',
        closable: true,
        meta: {
          sessionId: 'session-task-task-2',
          sourceTaskId: 'task-2',
          taskStatus: 'running',
        },
      },
    )

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.cancel-task-batch').trigger('click')

    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-task-task-1', {
      taskCancelRequested: true,
      taskStatus: 'cancelled',
      taskError: 'ai.tasks.taskCancelled',
      taskSummary: 'Collected partial scheduler info',
    })
    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-task-task-2', {
      taskCancelRequested: true,
      taskStatus: 'cancelled',
      taskError: 'ai.tasks.taskCancelled',
      taskSummary: undefined,
    })
  })

  it('aborts and marks a task tab as cancelled when cancellation is requested', async () => {
    mocks.state.chat.isStreaming.value = true
    mocks.state.workspaceStore.tabs = [{
      id: 'ai-tab-1',
      type: 'ai-chat',
      title: 'Task Tab',
      closable: true,
      meta: {
        sessionId: 'session-task-task-1',
        sourceTaskId: 'task-1',
        taskCancelRequested: true,
      },
    }]

    mountView()
    await flushPromises()

    expect(mocks.state.chat.abort).toHaveBeenCalledTimes(1)
    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-tab-1', {
      taskStatus: 'cancelled',
      taskError: 'ai.tasks.taskCancelled',
      taskSummary: undefined,
    })
  })

  it('marks running spawned tasks as closed when their task tab disappears', async () => {
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'inspect scheduler',
      status: 'running',
      createdAt: 1000,
      startedAt: 1200,
      taskTabId: 'ai-task-task-1',
      taskSessionId: 'session-task-task-1',
      retryCount: 0,
      lastSummary: 'Collected partial scheduler info',
    }]
    mocks.state.workspaceStore.tabs = [
      {
        id: 'ai-tab-1',
        type: 'ai-chat',
        title: 'Chat Tab',
        closable: true,
        meta: { sessionId: 'session-1' },
      },
      {
        id: 'ai-task-task-1',
        type: 'ai-chat',
        title: '[Task] inspect scheduler',
        closable: true,
        meta: {
          sessionId: 'session-task-task-1',
          sourceTaskId: 'task-1',
          taskStatus: 'running',
          taskSummary: 'Collected partial scheduler info',
        },
      },
    ]

    mountView()
    await flushPromises()

    mocks.state.workspaceStore.tabs = mocks.state.workspaceStore.tabs.filter((tab: any) => tab.id !== 'ai-task-task-1')
    await nextTick()
    await flushPromises()

    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({
      status: 'error',
      lastError: 'ai.tasks.taskClosed',
      lastSummary: 'Collected partial scheduler info',
    })
  })

  it('forwards the shared message list continue event to chat.regenerate', async () => {
    mocks.state.chat.messages.value = [makeMessage('assistant-1')]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.emit-continue').trigger('click')
    await flushPromises()

    expect(mocks.state.chat.regenerate).toHaveBeenCalledTimes(1)
    expect(mocks.state.chat.regenerate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-1' }),
      expect.objectContaining({ id: 'model-1' }),
      'test-api-key',
      undefined,
    )
  })

  it('renders the diagnostics panel with observability metrics', async () => {
    mocks.state.chat.messages.value = [makeMessage('assistant-1')]

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.ai-diagnostics-panel-stub').exists()).toBe(true)
  })

  it('hides the diagnostics panel outside developer mode', async () => {
    mocks.state.settingsStore.settings.devMode = false
    mocks.state.chat.messages.value = [makeMessage('assistant-1')]

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.ai-diagnostics-panel-stub').exists()).toBe(false)
  })
})
