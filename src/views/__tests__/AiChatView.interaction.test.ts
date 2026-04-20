import { mount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
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
        AiInputArea: AiInputAreaStub,
        AiMessageListVirtual: AiMessageListVirtualStub,
        AiUsageBadge: true,
        AiProviderConfig: true,
        AiSessionDrawer: true,
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
        AiSpawnedTasksPanel: true,
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
    const provider = makeProvider()
    mocks.state.chat = createChatMock()
    mocks.state.aiStore = {
      providers: [provider],
      defaultProvider: provider,
      sessions: [],
      activeSessionId: null,
      currentWorkspaceConfig: null,
      init: vi.fn().mockResolvedValue(undefined),
      loadWorkspaceConfig: vi.fn().mockResolvedValue(undefined),
      saveProvider: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(undefined),
      removeSession: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
    }
    mocks.state.workspaceStore = {
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
    }
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
