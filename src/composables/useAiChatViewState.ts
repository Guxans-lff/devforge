import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCredential } from '@/api/connection'
import type { FileAttachment, ModelConfig, ProviderConfig } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import { stripMentionMarkers } from '@/composables/useFileAttachment'
import { checkTokenLimit } from '@/utils/file-markers'
import { buildToolGuide } from '@/utils/ai-prompts'
import { setApprovalMode, type ApprovalMode } from '@/composables/useToolApproval'
import { ensureErrorString } from '@/types/error'
import { resolveRuntimeRoute } from '@/composables/ai/chatRuntimeRouting'
import type { AiChatSessionRunnerResult } from '@/composables/ai/chatSessionRunner'

type WorkDirOption = { label: string; value: string }
type ModeConfig = {
  label: string
  desc: string
  icon: unknown
  color: string
  bg: string
}

interface ChatLike {
  workDir: Ref<string>
  totalTokens: Ref<number>
  error: Ref<string | null>
  planGateEnabled?: Ref<boolean>
  planApproved?: Ref<boolean>
  availableWorkDirs?: ComputedRef<WorkDirOption[]>
  send: (
    content: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt?: string,
    attachments?: FileAttachment[],
  ) => Promise<AiChatSessionRunnerResult | undefined>
  regenerate: (
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt?: string,
  ) => Promise<AiChatSessionRunnerResult | undefined>
  removeLastError: () => void
}

export interface ChatResolvedRoute {
  provider: ProviderConfig
  model: ModelConfig
  rerouted: boolean
  reason?: 'provider_circuit_open'
}

export interface SendMessageNowResult {
  route: ChatResolvedRoute
  result: AiChatSessionRunnerResult | undefined
}

interface MemoryStoreLike {
  setWorkspace: (dir: string | null) => void | Promise<void>
}

interface WorkspaceConfigLike {
  preferredModel?: string
  dispatcherPrompt?: string
  dispatcherMaxParallel?: number
  dispatcherAutoRetryCount?: number
  dispatcherDefaultMode?: 'headless' | 'tab'
}

interface AiStoreLike {
  providers: ProviderConfig[]
  defaultProvider: ProviderConfig | null
  currentWorkspaceConfig?: WorkspaceConfigLike | null
  saveProvider: (config: ProviderConfig) => Promise<void>
}

interface WorkspaceFilesStoreLike {
  activeEditor: {
    path: string
    language: string
    cursorLine: number
    selectedText: string
  } | null
}

export interface UseAiChatViewStateOptions {
  sessionId: Ref<string>
  store: AiStoreLike
  chat: ChatLike
  memoryStore: MemoryStoreLike
  wsFiles: WorkspaceFilesStoreLike
  modeConfigs: Record<ChatMode, ModeConfig>
  modeSuffixes?: Partial<Record<ChatMode, string>>
  mapApprovalMode?: (mode: ChatMode) => ApprovalMode
  onModeChanged?: (mode: ChatMode) => void
  onPersistWorkDir?: (dir: string) => Promise<void>
}

const DEFAULT_MODE_SUFFIXES: Record<ChatMode, string> = {
  normal: '',
  plan: '\n\n[Mode: Plan]\nAnalyze first, propose a concrete implementation plan, and wait for confirmation before giving final code or execution steps.',
  auto: '\n\n[Mode: Auto]\nProvide a complete executable solution directly, including implementation details, edge cases, and practical next steps.',
  dispatcher: '\n\n[Mode: Dispatcher]\nBreak the work into independent subtasks that can run in parallel. Output child tasks only with [SPAWN:...] markers. Use depends=... only for real prerequisites. Default to mode=headless and use mode=tab only when human observation, long-running interaction, or visual tracing is necessary. Prefer independent tasks first, then synthesize the final result by source group and dependency tree.',
}

function defaultApprovalMode(mode: ChatMode): ApprovalMode {
  if (mode === 'auto') return 'auto'
  if (mode === 'plan') return 'deny'
  return 'ask'
}

export function useAiChatViewState({
  sessionId,
  store,
  chat,
  memoryStore,
  wsFiles,
  modeConfigs,
  modeSuffixes,
  mapApprovalMode = defaultApprovalMode,
  onModeChanged,
  onPersistWorkDir,
}: UseAiChatViewStateOptions) {
  const { t } = useI18n()
  const selectedProviderId = ref<string | null>(null)
  const selectedModelId = ref<string | null>(null)
  const systemPrompt = ref<string | undefined>(undefined)
  const chatMode = ref<ChatMode>('normal')

  const resolvedModeSuffixes: Record<ChatMode, string> = {
    ...DEFAULT_MODE_SUFFIXES,
    ...modeSuffixes,
  }

  const currentProvider = computed<ProviderConfig | null>(() =>
    store.providers.find(provider => provider.id === selectedProviderId.value) ?? null,
  )

  const currentModel = computed<ModelConfig | null>(() =>
    currentProvider.value?.models.find(model => model.id === selectedModelId.value) ?? null,
  )

  const effectiveSystemPrompt = computed(() => {
    const base = systemPrompt.value ?? ''
    const workspaceDispatcherPrompt = chatMode.value === 'dispatcher'
      ? store.currentWorkspaceConfig?.dispatcherPrompt?.trim()
      : ''
    const suffix = workspaceDispatcherPrompt || resolvedModeSuffixes[chatMode.value]
    const enableTools = currentModel.value?.capabilities.toolUse && !!chat.workDir.value
    const toolGuide = enableTools
      ? buildToolGuide({
          workDir: chat.workDir.value,
          chatMode: chatMode.value,
          modelId: currentModel.value?.id,
          ideContext: wsFiles.activeEditor,
        })
      : ''

    const result = base + (suffix || '') + toolGuide
    return result || undefined
  })

  const hasProviders = computed(() => store.providers.length > 0)

  const workDirDisplay = computed(() => {
    const dir = chat.workDir.value
    if (!dir) return ''
    const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length <= 2) return parts.join('/')
    return `.../${parts.slice(-2).join('/')}`
  })

  const currentModeConfig = computed(() => modeConfigs[chatMode.value])

  function syncDefaultProviderSelection(): void {
    if (store.providers.length === 0 || selectedProviderId.value) return
    const defaultProvider = store.defaultProvider
    if (!defaultProvider) return
    selectedProviderId.value = defaultProvider.id
    const firstModel = defaultProvider.models[0]
    if (firstModel) selectedModelId.value = firstModel.id
  }

  function applyWorkspacePreferredModel(preferredModel?: string): void {
    if (!preferredModel) return
    const foundModel = store.providers.flatMap(provider => provider.models).find(model => model.id === preferredModel)
    if (!foundModel) return
    const ownerProvider = store.providers.find(provider =>
      provider.models.some(model => model.id === foundModel.id),
    )
    if (!ownerProvider) return
    selectedProviderId.value = ownerProvider.id
    selectedModelId.value = foundModel.id
  }

  watch(chatMode, mode => {
    setApprovalMode(mapApprovalMode(mode), sessionId.value)
    onModeChanged?.(mode)
  }, { immediate: true })

  watch(() => store.providers, () => {
    syncDefaultProviderSelection()
  }, { deep: true })

  async function setWorkDir(dir: string): Promise<void> {
    chat.workDir.value = dir
    if (dir) {
      await memoryStore.setWorkspace(dir)
    }
    await onPersistWorkDir?.(dir)
  }

  async function handleSelectWorkDir(): Promise<void> {
    const dir = await openDialog({ directory: true, multiple: false })
    if (dir) await setWorkDir(dir as string)
  }

  async function sendMessageNow(
    content: string,
    attachments: FileAttachment[],
    onSent?: (cleanContent: string) => void | Promise<void>,
  ): Promise<SendMessageNowResult | null> {
    if (!currentProvider.value || !currentModel.value) return null

    const route = resolveRuntimeRoute(
      store.providers,
      currentProvider.value,
      currentModel.value,
    )

    const cleanContent = stripMentionMarkers(content)
    const apiKey = await getCredential(`ai-provider-${route.provider.id}`) ?? ''
    if (!apiKey) {
      chat.error.value = t('ai.messages.apiKeyNotConfigured')
      return null
    }

    if (route.model.capabilities.maxContext > 0) {
      const totalText = cleanContent + attachments.map(file => file.content ?? '').join('')
      const check = checkTokenLimit(totalText, chat.totalTokens.value, route.model.capabilities.maxContext)
      if (check.warn) {
        console.warn(`[AI] Token near limit: estimated ${check.usage} / limit ${check.limit}`)
      }
    }

    const result = await chat.send(
      cleanContent,
      route.provider,
      route.model,
      apiKey,
      effectiveSystemPrompt.value,
      attachments,
    )

    await onSent?.(cleanContent)
    return { route, result }
  }

  async function handleContinue(): Promise<void> {
    if (!currentProvider.value || !currentModel.value) return
    const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
    if (!apiKey) {
      chat.error.value = t('ai.messages.apiKeyNotConfigured')
      return
    }
    await chat.regenerate(
      currentProvider.value,
      currentModel.value,
      apiKey,
      effectiveSystemPrompt.value,
    )
  }

  async function handleBumpMaxOutput(value: number): Promise<void> {
    if (!currentProvider.value || !currentModel.value) return
    const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
    if (!apiKey) {
      chat.error.value = t('ai.messages.apiKeyNotConfigured')
      return
    }

    const provider = currentProvider.value
    const modelId = currentModel.value.id
    const nextProviderConfig: ProviderConfig = {
      ...provider,
      models: provider.models.map(model =>
        model.id === modelId
          ? { ...model, capabilities: { ...model.capabilities, maxOutput: value } }
          : model,
      ),
    }

    await store.saveProvider(nextProviderConfig)
    chat.removeLastError()

    const nextProvider = store.providers.find(candidate => candidate.id === provider.id) ?? nextProviderConfig
    const nextModel = nextProvider.models.find(candidate => candidate.id === modelId) ?? currentModel.value
    await chat.send(
      'The max output budget was increased. Continue the unfinished task from the previous turn without repeating completed steps.',
      nextProvider,
      nextModel,
      apiKey,
      effectiveSystemPrompt.value,
    )
  }

  function setError(error: unknown): void {
    chat.error.value = ensureErrorString(error)
  }

  return {
    selectedProviderId,
    selectedModelId,
    systemPrompt,
    chatMode,
    currentProvider,
    currentModel,
    effectiveSystemPrompt,
    hasProviders,
    workDirDisplay,
    currentModeConfig,
    syncDefaultProviderSelection,
    applyWorkspacePreferredModel,
    setWorkDir,
    handleSelectWorkDir,
    sendMessageNow,
    handleContinue,
    handleBumpMaxOutput,
    setError,
  }
}
