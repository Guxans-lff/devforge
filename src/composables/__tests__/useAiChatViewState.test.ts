import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { useAiChatViewState } from '@/composables/useAiChatViewState'
import { clearApprovalStateForTests } from '@/composables/useToolApproval'
import type { FileAttachment, ModelConfig, ProviderConfig } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'

const { getCredentialMock } = vi.hoisted(() => ({
  getCredentialMock: vi.fn(),
}))

vi.mock('@/api/connection', () => ({
  getCredential: getCredentialMock,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

const modeConfigs: Record<ChatMode, {
  label: string
  desc: string
  icon: unknown
  color: string
  bg: string
}> = {
  normal: { label: 'Normal', desc: '', icon: null, color: '', bg: '' },
  plan: { label: 'Plan', desc: '', icon: null, color: '', bg: '' },
  auto: { label: 'Auto', desc: '', icon: null, color: '', bg: '' },
  dispatcher: { label: 'Dispatcher', desc: '', icon: null, color: '', bg: '' },
}

const model: ModelConfig = {
  id: 'model-1',
  name: 'Model 1',
  capabilities: {
    contextWindow: 1000,
    maxContext: 1000,
    maxOutput: 100,
    vision: false,
    toolUse: true,
    reasoning: false,
  },
}

const provider: ProviderConfig = {
  id: 'provider-1',
  name: 'Provider 1',
  type: 'openai',
  baseUrl: 'https://example.com',
  models: [model],
  enabled: true,
}

function makeHarness(overrides: Partial<{
  providers: ProviderConfig[]
  defaultProvider: ProviderConfig | null
  workDir: string
}> = {}) {
  const chat = {
    workDir: ref(overrides.workDir ?? 'D:/workspace'),
    totalTokens: ref(0),
    error: ref<string | null>(null),
    send: vi.fn().mockResolvedValue(undefined),
    regenerate: vi.fn().mockResolvedValue(undefined),
    removeLastError: vi.fn(),
  }
  const store = {
    providers: overrides.providers ?? [provider],
    defaultProvider: overrides.defaultProvider ?? provider,
    currentWorkspaceConfig: null,
    saveProvider: vi.fn().mockResolvedValue(undefined),
  }
  const memoryStore = {
    setWorkspace: vi.fn().mockResolvedValue(undefined),
  }
  const onPersistWorkDir = vi.fn().mockResolvedValue(undefined)

  const state = useAiChatViewState({
    sessionId: ref('session-1'),
    store,
    chat,
    memoryStore,
    wsFiles: { activeEditor: null },
    modeConfigs,
    onPersistWorkDir,
  })

  return {
    state,
    chat,
    store,
    memoryStore,
    onPersistWorkDir,
  }
}

describe('useAiChatViewState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearApprovalStateForTests()
    getCredentialMock.mockResolvedValue('api-key')
  })

  it('syncs default provider and model selection', () => {
    const { state } = makeHarness()

    state.syncDefaultProviderSelection()

    expect(state.selectedProviderId.value).toBe('provider-1')
    expect(state.selectedModelId.value).toBe('model-1')
    expect(state.currentProvider.value?.id).toBe('provider-1')
    expect(state.currentModel.value?.id).toBe('model-1')
  })

  it('maps chat mode to approval mode and calls mode change hook', async () => {
    const onModeChanged = vi.fn()
    const { chatMode } = useAiChatViewState({
      sessionId: ref('session-1'),
      store: {
        providers: [provider],
        defaultProvider: provider,
        saveProvider: vi.fn().mockResolvedValue(undefined),
      },
      chat: {
        workDir: ref(''),
        totalTokens: ref(0),
        error: ref<string | null>(null),
        send: vi.fn(),
        regenerate: vi.fn(),
        removeLastError: vi.fn(),
      },
      memoryStore: { setWorkspace: vi.fn() },
      wsFiles: { activeEditor: null },
      modeConfigs,
      onModeChanged,
    })

    chatMode.value = 'auto'
    await Promise.resolve()

    expect(onModeChanged).toHaveBeenLastCalledWith('auto')
  })

  it('sends a cleaned message with attachments and clears them through callback', async () => {
    const { state, chat } = makeHarness()
    const attachment: FileAttachment = {
      id: 'file-1',
      name: 'a.ts',
      path: 'D:/workspace/a.ts',
      content: 'const a = 1',
      size: 10,
      status: 'ready',
    }
    const onSent = vi.fn()

    state.syncDefaultProviderSelection()
    await state.sendMessageNow('please check @[a.ts](file://D:/workspace/a.ts)', [attachment], onSent)

    expect(getCredentialMock).toHaveBeenCalledWith('ai-provider-provider-1')
    expect(chat.send).toHaveBeenCalledWith(
      'please check',
      provider,
      model,
      'api-key',
      expect.stringContaining('Working directory: `D:/workspace`.'),
      [attachment],
    )
    expect(onSent).toHaveBeenCalledWith('please check')
  })

  it('sets an error instead of sending when API key is missing', async () => {
    const { state, chat } = makeHarness()
    getCredentialMock.mockResolvedValue('')

    state.syncDefaultProviderSelection()
    await state.sendMessageNow('hello', [])

    expect(chat.send).not.toHaveBeenCalled()
    expect(chat.error.value).toContain('API key is not configured')
  })

  it('persists work directory changes and updates memory workspace', async () => {
    const { state, chat, memoryStore, onPersistWorkDir } = makeHarness({ workDir: '' })

    await state.setWorkDir('D:/workspace')

    expect(chat.workDir.value).toBe('D:/workspace')
    expect(memoryStore.setWorkspace).toHaveBeenCalledWith('D:/workspace')
    expect(onPersistWorkDir).toHaveBeenCalledWith('D:/workspace')
    expect(state.workDirDisplay.value).toBe('D:/workspace')
  })
})
