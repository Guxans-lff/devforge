import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  runAiChatSessionTurnMock: vi.fn(),
  createChatTaskDispatcherMock: vi.fn(),
  dispatcher: null as any,
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

vi.mock('@/composables/ai/chatSessionRunner', () => ({
  runAiChatSessionTurn: (...args: unknown[]) => mocks.runAiChatSessionTurnMock(...args),
}))

vi.mock('@/composables/ai/chatTaskDispatcher', () => ({
  createChatTaskDispatcher: (...args: unknown[]) => mocks.createChatTaskDispatcherMock(...args),
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
  props: {
    showSideRailToggle: Boolean,
    sideRailOpen: Boolean,
    sideRailCount: Number,
    sideRailLabel: String,
  },
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
    'toggleSideRail',
  ],
  setup(props, { emit, expose, slots }) {
    const localSideRailOpen = ref(Boolean(props.sideRailOpen))

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
      h('button', {
        class: 'toggle-task-rail',
        onClick: () => {
          localSideRailOpen.value = !localSideRailOpen.value
          emit('toggleSideRail')
        },
      }, 'toggle-task-rail'),
        h('button', { class: 'emit-continue', onClick: () => emit('continue') }, 'continue'),
        h('button', { class: 'emit-bump', onClick: () => emit('bumpMaxOutput', 4096) }, 'bump'),
        h('button', { class: 'emit-history', onClick: () => emit('loadMoreHistory') }, 'history'),
        slots['empty-state']?.(),
        slots['empty-state-extra']?.(),
        slots['after-compact']?.(),
        (props.sideRailOpen || localSideRailOpen.value) ? slots['side-rail']?.() : null,
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
  const wrapper = mount(AiChatView, {
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
  mountedWrappers.push(wrapper)
  return wrapper
}

const mountedWrappers: VueWrapper[] = []

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
      roots: [
        { id: 'root-1', name: 'devforge', path: 'D:/Project/devforge' },
        { id: 'root-2', name: 'other', path: 'D:/Project/other' },
      ],
      flatNodes: [],
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
    mocks.runAiChatSessionTurnMock.mockReset()
    const projectTask = (task: any, allTasks: any[]) => ({
      ...task,
      executionMode: task.executionMode ?? 'headless',
      dispatchStatus: task.dispatchStatus ?? (() => {
        if (task.status === 'running' || task.status === 'done' || task.status === 'error' || task.status === 'cancelled') {
          return task.status
        }
        const dependsOn = task.dependsOn ?? []
        if (dependsOn.length === 0) return 'ready'
        const unresolved = dependsOn.some((dependencyId: string) => {
          const dependency = allTasks.find((candidate: any) => candidate.id === dependencyId)
          return dependency?.status !== 'done'
        })
        return unresolved ? 'queued' : 'ready'
      })(),
    })

    mocks.dispatcher = {
      enqueue: vi.fn((tasks: any[]) => tasks),
      syncTasks: vi.fn((tasks: any[]) => tasks),
      runTask: vi.fn().mockResolvedValue(undefined),
      runReadyTasks: vi.fn().mockResolvedValue(undefined),
      cancelTask: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn(() => mocks.state.chat.spawnedTasks.value.map((task: any) => projectTask(task, mocks.state.chat.spawnedTasks.value))),
      getStats: vi.fn(() => ({
        running: 0,
        ready: 0,
        queued: 0,
        blocked: 0,
        done: 0,
        error: 0,
        cancelled: 0,
        runnable: 0,
      })),
    }
    mocks.createChatTaskDispatcherMock.mockReset()
    mocks.createChatTaskDispatcherMock.mockImplementation((options: any) => {
      const classifyStatus = (task: any, allTasks: any[]) => projectTask(task, allTasks).dispatchStatus

      mocks.dispatcher.enqueue.mockImplementation((tasks: any[]) => {
        options.setTasks(tasks)
        return tasks
      })
      mocks.dispatcher.syncTasks.mockImplementation((tasks: any[]) => {
        options.setTasks(tasks)
        return tasks
      })
      mocks.dispatcher.runTask.mockImplementation(async (taskId: string, runOptions?: { startedByDispatcher?: boolean }) => {
        const allTasks = mocks.state.chat.spawnedTasks.value
        const task = allTasks.find((item: any) => item.id === taskId)
        if (!task) return
        if (classifyStatus(task, allTasks) !== 'ready') return
        const executionMode = task.executionMode ?? 'headless'
        const executor = options.executors[executionMode]
        const prepared = executor.prepare?.(task) ?? {}
        const runningTask = {
          ...task,
          ...prepared,
          status: 'running',
          executionMode,
          startedByDispatcher: runOptions?.startedByDispatcher ?? true,
        }
        mocks.state.chat.spawnedTasks.value = mocks.state.chat.spawnedTasks.value.map((item: any) =>
          item.id === taskId ? runningTask : item,
        )
        const result = await executor.run(runningTask)
        mocks.state.chat.spawnedTasks.value = mocks.state.chat.spawnedTasks.value.map((item: any) =>
          item.id !== taskId
            ? item
            : {
                ...item,
                status: result.status === 'done' ? 'done' : result.status,
                lastError: result.error,
                lastSummary: result.summary,
                resultSummary: result.summary,
                resultSessionId: result.sessionId,
                taskSessionId: result.sessionId ?? item.taskSessionId,
                finishedAt: result.finishedAt,
              },
        )
      })
      mocks.dispatcher.runReadyTasks.mockImplementation(async (taskIds?: string[]) => {
        const ids = (taskIds ?? mocks.state.chat.spawnedTasks.value.map((task: any) => task.id))
          .filter((taskId: string) => {
            const task = mocks.state.chat.spawnedTasks.value.find((item: any) => item.id === taskId)
            return task && classifyStatus(task, mocks.state.chat.spawnedTasks.value) === 'ready'
          })
        await Promise.all(ids.map((taskId: string) =>
          mocks.dispatcher.runTask(taskId, { startedByDispatcher: true }),
        ))
      })
      mocks.dispatcher.drain.mockImplementation(async () => {
        await mocks.dispatcher.runReadyTasks()
      })
      mocks.dispatcher.cancelTask.mockImplementation(async (taskId: string, reason: string) => {
        const task = mocks.state.chat.spawnedTasks.value.find((item: any) => item.id === taskId)
        if (!task) return null
        const executionMode = task.executionMode ?? 'headless'
        const executor = options.executors[executionMode]
        await executor.cancel?.(task, reason)
        mocks.state.chat.spawnedTasks.value = mocks.state.chat.spawnedTasks.value.map((item: any) =>
          item.id === taskId ? { ...item, status: 'cancelled', lastError: reason } : item,
        )
        return mocks.state.chat.spawnedTasks.value.find((item: any) => item.id === taskId) ?? null
      })
      return mocks.dispatcher
    })
    mocks.setApprovalModeMock.mockReset()
    mocks.setActiveSessionIdMock.mockReset()
  })

  afterEach(() => {
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount()
    }
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
      executionMode: 'tab',
      createdAt: 1000,
      retryCount: 0,
    }]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.toggle-task-rail').trigger('click')
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

  it('auto-starts a task tab from its initial message metadata on mount', async () => {
    mocks.state.workspaceStore.activeTabId = 'ai-task-task-1'
    mocks.state.workspaceStore.tabs = [{
      id: 'ai-task-task-1',
      type: 'ai-chat',
      title: '[Task] inspect scheduler',
      closable: true,
      meta: {
        sessionId: 'session-task-task-1',
        sourceTaskId: 'task-1',
        initialMessage: 'inspect scheduler',
        taskAutoStarted: true,
        taskExecutionMode: 'tab',
      },
    }]

    mountView()
    await flushPromises()

    expect(mocks.state.chat.send).toHaveBeenCalledWith(
      'inspect scheduler',
      expect.objectContaining({ id: 'provider-1' }),
      expect.objectContaining({ id: 'model-1' }),
      'test-api-key',
      undefined,
      [],
    )
    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-task-task-1', {
      initialMessage: undefined,
      taskAutoStarted: false,
      taskStatus: 'running',
      taskError: undefined,
      taskSummary: undefined,
    })
  })

  it('runs headless spawned tasks in the background and writes back result session metadata', async () => {
    mocks.state.chat.send.mockImplementation(async () => {
      mocks.state.chat.spawnedTasks.value = [{
        id: 'task-1',
        description: 'inspect scheduler',
        status: 'pending',
        executionMode: 'headless',
        createdAt: 1000,
        retryCount: 0,
      }]
    })
    mocks.runAiChatSessionTurnMock.mockResolvedValue({
      status: 'done',
      summary: 'Headless child completed successfully with enough detail to summarize.',
      sessionId: 'session-headless-task-1-123',
      startedAt: 1000,
      finishedAt: 1200,
      retryable: false,
    })

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.send-first').trigger('click')
    await flushPromises()
    await nextTick()
    await flushPromises()

    expect(mocks.state.workspaceStore.addTab).not.toHaveBeenCalled()

    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({
      status: 'done',
      executionMode: 'headless',
      resultSessionId: expect.stringContaining('session-headless-task-1-'),
      taskSessionId: expect.stringContaining('session-headless-task-1-'),
    })
    expect(mocks.state.chat.spawnedTasks.value[0].resultSummary).toContain('Headless child completed successfully')
  })

  it('returns from parent send without waiting for background dispatcher completion', async () => {
    let releaseHeadless!: () => void
    const headlessGate = new Promise<void>((resolve) => {
      releaseHeadless = resolve
    })

    mocks.state.chat.send.mockImplementation(async (content: string) => {
      if (content === 'first request') {
        mocks.state.chat.spawnedTasks.value = [{
          id: 'task-1',
          description: 'inspect scheduler',
          status: 'pending',
          executionMode: 'headless',
          createdAt: 1000,
          retryCount: 0,
        }]
        return
      }
    })
    mocks.runAiChatSessionTurnMock.mockImplementation(async () => {
      await headlessGate
      return {
        status: 'done',
        summary: 'Background dispatcher result.',
        sessionId: 'session-headless-task-1-456',
        startedAt: 1000,
        finishedAt: 1400,
        retryable: false,
      }
    })

    const wrapper = mountView()
    await flushPromises()

    const sendPromise = wrapper.find('.send-first').trigger('click')
    await flushPromises()

    expect(mocks.state.chat.send).toHaveBeenCalledWith(
      'first request',
      expect.objectContaining({ id: 'provider-1' }),
      expect.objectContaining({ id: 'model-1' }),
      'test-api-key',
      undefined,
      [],
    )

    await sendPromise
    await nextTick()
    await flushPromises()
    expect(mocks.state.chat.spawnedTasks.value[0]?.status).toBe('running')

    releaseHeadless()
    await flushPromises()

    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({
      status: 'done',
      resultSummary: expect.stringContaining('Background dispatcher result.'),
    })
  })

  it('toggles repository focus from right-rail spawned task cards', async () => {
    mocks.state.workspaceStore.updateTabMeta.mockImplementation((tabId: string, meta: Record<string, unknown>) => {
      const tab = mocks.state.workspaceStore.tabs.find((item: any) => item.id === tabId)
      if (tab) {
        tab.meta = { ...tab.meta, ...meta }
      }
    })
    mocks.state.chat.workDir.value = 'D:/Project/devforge'
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'tighten src/views/AiChatView.vue task rail',
      status: 'done',
      executionMode: 'headless',
      resultSummary: 'Updated src/components/layout/panels/FilesPanel.vue.',
      createdAt: 1000,
      retryCount: 0,
    }]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.toggle-task-rail').trigger('click')

    const taskCard = wrapper.findAll('article').find(card => card.text().includes('AiChatView.vue'))
    expect(taskCard).toBeTruthy()

    await taskCard!.trigger('click')

    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-tab-1', {
      focusedTaskId: 'task-1',
      focusedTaskPaths: [
        'D:/Project/devforge/src/views/AiChatView.vue',
        'D:/Project/devforge/src/components/layout/panels/FilesPanel.vue',
      ],
      focusedTaskLabel: 'tighten src/views/AiChatView.vue task rail',
    })
    expect(mocks.state.workspaceStore.tabs[0].meta.focusedTaskId).toBe('task-1')

    await taskCard!.trigger('click')

    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenLastCalledWith('ai-tab-1', {
      focusedTaskId: null,
      focusedTaskPaths: [],
      focusedTaskLabel: null,
    })
  })

  it('opens the first task context file directly from the right rail', async () => {
    mocks.state.workspaceStore.updateTabMeta.mockImplementation((tabId: string, meta: Record<string, unknown>) => {
      const tab = mocks.state.workspaceStore.tabs.find((item: any) => item.id === tabId)
      if (tab) {
        tab.meta = { ...tab.meta, ...meta }
      }
    })
    mocks.state.chat.workDir.value = 'D:/Project/devforge'
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'tighten src/views/AiChatView.vue task rail',
      status: 'done',
      executionMode: 'headless',
      resultSummary: 'Updated src/components/layout/panels/FilesPanel.vue.',
      createdAt: 1000,
      retryCount: 0,
    }]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.toggle-task-rail').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '展开')!.trigger('click')

    const pathButton = wrapper.findAll('.task-context-open').find(button => button.text().includes('src/views/AiChatView.vue'))
    expect(pathButton).toBeTruthy()

    await pathButton!.trigger('click')

    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-tab-1', {
      focusedTaskId: 'task-1',
      focusedTaskPaths: [
        'D:/Project/devforge/src/views/AiChatView.vue',
        'D:/Project/devforge/src/components/layout/panels/FilesPanel.vue',
      ],
      focusedTaskLabel: 'tighten src/views/AiChatView.vue task rail',
    })
    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledWith({
      id: 'file-editor:D:/Project/devforge/src/views/AiChatView.vue',
      type: 'file-editor',
      title: 'AiChatView.vue',
      closable: true,
      meta: { absolutePath: 'D:/Project/devforge/src/views/AiChatView.vue' },
    })
  })

  it('opens working set files directly from the main workspace list', async () => {
    mocks.state.workspaceStore.updateTabMeta.mockImplementation((tabId: string, meta: Record<string, unknown>) => {
      const tab = mocks.state.workspaceStore.tabs.find((item: any) => item.id === tabId)
      if (tab) {
        tab.meta = { ...tab.meta, ...meta }
      }
    })
    mocks.state.chat.workDir.value = 'D:/Project/devforge'

    const wrapper = mountView()
    await flushPromises()

    const workingFileButton = wrapper.findAll('.working-file-open')
      .find(button => button.text().includes('MainLayout.vue'))
    expect(workingFileButton).toBeTruthy()

    await workingFileButton!.trigger('click')

    expect(mocks.state.workspaceStore.updateTabMeta).toHaveBeenCalledWith('ai-tab-1', {
      focusedFilePaths: ['D:/Project/devforge/src/views/MainLayout.vue'],
      focusedFileLabel: 'MainLayout.vue',
    })
    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledWith({
      id: 'file-editor:D:/Project/devforge/src/views/MainLayout.vue',
      type: 'file-editor',
      title: 'MainLayout.vue',
      closable: true,
      meta: { absolutePath: 'D:/Project/devforge/src/views/MainLayout.vue' },
    })
  })

  it('keeps the repository-centric empty-state layout structure stable', async () => {
    mocks.state.chat.workDir.value = 'D:/Project/devforge'
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'inspect scheduler',
      status: 'running',
      executionMode: 'headless',
      createdAt: 1000,
      retryCount: 0,
    }]

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-ui="ai-empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-ui="workspace-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-ui="workspace-summary"]').exists()).toBe(true)
    expect(wrapper.find('[data-ui="roots-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-ui="working-files-panel"]').exists()).toBe(true)
    expect(wrapper.findAll('.working-file-open').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-ui="task-rail"]').exists()).toBe(true)
  })

  it('keeps finished task rail collapsed until explicitly opened', async () => {
    mocks.state.chat.workDir.value = 'D:/Project/devforge'
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'inspect scheduler',
      status: 'done',
      executionMode: 'headless',
      createdAt: 1000,
      retryCount: 0,
    }]

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-ui="task-rail"]').exists()).toBe(false)

    await wrapper.find('.toggle-task-rail').trigger('click')

    expect(wrapper.find('[data-ui="task-rail"]').exists()).toBe(true)
  })

  it('prefers the active workspace root when resolving relative file paths', async () => {
    mocks.state.workspaceStore.updateTabMeta.mockImplementation((tabId: string, meta: Record<string, unknown>) => {
      const tab = mocks.state.workspaceStore.tabs.find((item: any) => item.id === tabId)
      if (tab) {
        tab.meta = { ...tab.meta, ...meta }
      }
    })
    mocks.state.chat.workDir.value = 'D:/Project/devforge/packages/agent'
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'patch views/MainLayout.vue and src/views/AiChatView.vue',
      status: 'done',
      executionMode: 'headless',
      resultSummary: 'Adjusted components/layout/panels/FilesPanel.vue.',
      createdAt: 1000,
      retryCount: 0,
    }]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.toggle-task-rail').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '展开')!.trigger('click')

    const pathButton = wrapper.findAll('.task-context-open').find(button => button.text().includes('views/MainLayout.vue'))
    expect(pathButton).toBeTruthy()

    await pathButton!.trigger('click')

    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledWith({
      id: 'file-editor:D:/Project/devforge/packages/agent/views/MainLayout.vue',
      type: 'file-editor',
      title: 'MainLayout.vue',
      closable: true,
      meta: { absolutePath: 'D:/Project/devforge/packages/agent/views/MainLayout.vue' },
    })
  })

  it('runs spawned tasks in batch from the dispatcher panel', async () => {
    mocks.state.chat.spawnedTasks.value = [
      {
        id: 'task-1',
        description: 'inspect scheduler',
        status: 'pending',
        executionMode: 'tab',
        createdAt: 1000,
        retryCount: 0,
      },
      {
        id: 'task-2',
        description: 'collect logs',
        status: 'pending',
        executionMode: 'tab',
        createdAt: 1001,
        retryCount: 0,
      },
    ]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.toggle-task-rail').trigger('click')
    await wrapper.find('.run-task-batch').trigger('click')

    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledTimes(2)
    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({ status: 'running' })
    expect(mocks.state.chat.spawnedTasks.value[1]).toMatchObject({ status: 'running' })
  })

  it('auto-dispatches tab tasks by opening task tabs without blocking the parent send', async () => {
    let releaseTabTask!: () => void
    const tabTaskGate = new Promise<void>((resolve) => {
      releaseTabTask = resolve
    })

    mocks.state.chat.send.mockImplementation(async (content: string) => {
      if (content === 'first request') {
        mocks.state.chat.spawnedTasks.value = [{
          id: 'task-1',
          description: 'inspect scheduler',
          status: 'pending',
          executionMode: 'tab',
          createdAt: 1000,
          retryCount: 0,
        }]
        return
      }
      if (content === 'inspect scheduler') {
        await tabTaskGate
      }
    })

    const wrapper = mountView()
    await flushPromises()

    const sendPromise = wrapper.find('.send-first').trigger('click')
    await flushPromises()
    await sendPromise
    await nextTick()
    await flushPromises()

    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ai-chat',
      title: '[Task] inspect scheduler',
      meta: expect.objectContaining({
        initialMessage: 'inspect scheduler',
        taskAutoStarted: true,
      }),
    }))
    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({
      status: 'running',
      executionMode: 'tab',
      taskTabId: expect.stringContaining('ai-task-task-1-'),
    })

    releaseTabTask()
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

    await wrapper.find('.toggle-task-rail').trigger('click')
    await wrapper.find('.synthesize-tasks').trigger('click')

    expect(mocks.state.shellDraft).toContain('ai.tasks.dispatcher.synthesis.intro')
    expect(mocks.state.shellDraft).toContain('ai.tasks.dispatcher.synthesis.sourceGroupTitle')
    expect(mocks.state.shellDraft).toContain('inspect scheduler')
    expect(mocks.state.shellDraft).toContain('ai.tasks.dispatcher.synthesis.summary')
    expect(mocks.state.shellDraft).toContain('ai.tasks.dispatcher.synthesis.dependsOn')
    expect(mocks.state.shellDraft).toContain('ai.tasks.dispatcher.synthesis.cancelledReason')
  })

  it('does not run a task whose explicit dependency is unresolved', async () => {
    mocks.state.chat.spawnedTasks.value = [
      {
        id: 'task-1',
        description: 'inspect scheduler',
        status: 'running',
        executionMode: 'tab',
        createdAt: 1000,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
      },
      {
        id: 'task-2',
        description: 'collect logs',
        status: 'pending',
        executionMode: 'tab',
        createdAt: 1001,
        retryCount: 0,
        sourceMessageId: 'assistant-1',
        dependsOn: ['task-1'],
      },
    ]

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.run-task-batch').trigger('click')

    expect(mocks.state.workspaceStore.addTab).toHaveBeenCalledTimes(0)
    expect(mocks.state.chat.spawnedTasks.value[0]).toMatchObject({ status: 'running' })
    expect(mocks.state.chat.spawnedTasks.value[1]).toMatchObject({ status: 'pending' })
  })

  it('requests cancellation for a running spawned task tab', async () => {
    mocks.state.chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'inspect scheduler',
      status: 'running',
      executionMode: 'tab',
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
        executionMode: 'tab',
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
        executionMode: 'tab',
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
      executionMode: 'tab',
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
