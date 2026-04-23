import { computed, nextTick, onUnmounted, reactive, ref, toRef, watch, type MaybeRef, type Ref } from 'vue'
import { aiAbortStream } from '@/api/ai'
import { useAutoCompact } from '@/composables/useAutoCompact'
import { abortChat } from '@/composables/ai/chatAbort'
import {
  canExpandHistoryWindow,
  getExpandedHistoryWindowSize,
  HISTORY_RECENT_RECORD_LIMIT,
  invalidateChatHistoryCache,
  loadChatHistoryWindow,
  preloadChatHistoryWindow,
} from '@/composables/ai/chatHistoryLoad'
import { runAiChatSessionTurn } from '@/composables/ai/chatSessionRunner'
import { useAiChatObservability } from '@/composables/ai/useAiChatObservability'
import {
  parseAndWriteJournalSections as writeJournalSectionsFromText,
  parseSpawnedTasks as collectSpawnedTasks,
  type SpawnedTask,
} from '@/composables/ai/chatSideEffects'
import {
  handleStreamEvent as applyStreamEvent,
  type AiChatPhaseState,
  type AiChatStreamState,
} from '@/composables/ai/chatStreamEvents'
import { executeToolCalls as runToolCalls } from '@/composables/ai/chatToolExecution'
import { useAiChatStore } from '@/stores/ai-chat'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import type {
  AiMessage,
  FileAttachment,
  ModelConfig,
  ProviderConfig,
  ToolCallInfo,
} from '@/types/ai'
import { ensureErrorString } from '@/types/error'
import { createLogger } from '@/utils/logger'

const log = createLogger('ai.chat')

const MAX_TOOL_LOOPS = 50
const STREAM_WATCHDOG_MS = 90_000
const STREAM_WATCHDOG_WARN_MS = 45_000

export interface UseAiChatOptions {
  sessionId: MaybeRef<string>
  scrollContainer?: Ref<HTMLElement | null>
}

export function useAiChat(options: UseAiChatOptions) {
  const sessionIdRef = toRef(options.sessionId)
  const aiStore = useAiChatStore()
  const memoryStore = useAiMemoryStore()
  const autoCompact = useAutoCompact()
  const observability = useAiChatObservability()
  const filesStore = useWorkspaceFilesStore()

  const messages = ref<AiMessage[]>([])
  const isStreaming = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const userScrolled = ref(false)
  const workDir = ref('')
  const historyLoadedRecords = ref(0)
  const historyTotalRecords = ref(0)
  const historyWindowSize = ref(HISTORY_RECENT_RECORD_LIMIT)
  const historyLoadMorePending = ref(false)
  const historyLoadMoreError = ref<string | null>(null)

  const planGateEnabled = ref(false)
  const planApproved = ref(false)
  const pendingPlan = ref('')
  const awaitingPlanApproval = ref(false)
  const currentPhase = ref<AiChatPhaseState | null>(null)
  const spawnedTasks = ref<SpawnedTask[]>([])

  const streamState = reactive<AiChatStreamState>({
    pendingTextDelta: '',
    pendingThinkingDelta: '',
    pendingToolCalls: [],
    lastFinishReason: '',
    streamingMessageId: '',
    inToolExec: false,
  })

  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  let flushRafId: number | null = null
  let scrollRafId: number | null = null
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null
  let watchdogWarnTimer: ReturnType<typeof setTimeout> | null = null
  let loadSeq = 0
  let lastLoadedHistoryKey = ''
  let streamingMessageIndex = -1

  const toolFailureCounter = new Map<string, number>()

  const availableWorkDirs = computed(() =>
    filesStore.roots.map(root => ({ label: root.name, value: root.path })),
  )

  const totalTokens = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const message = messages.value[i]
      if (message?.role === 'assistant') {
        if (message.totalTokens) return message.totalTokens
        if (message.tokens) return message.tokens
      }
    }
    return 0
  })

  const latestUsage = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const message = messages.value[i]
      if (message?.role === 'assistant' && (
        message.promptTokens
        || message.completionTokens
        || message.totalTokens
      )) {
        return {
          promptTokens: message.promptTokens ?? message.totalTokens ?? message.tokens ?? 0,
          completionTokens: message.completionTokens ?? 0,
          cacheReadTokens: message.cacheReadTokens ?? 0,
          totalTokens: message.totalTokens ?? message.tokens ?? 0,
        }
      }
    }
    return {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
    }
  })

  const canSend = computed(() => !isStreaming.value && !isLoading.value)
  const canLoadMoreHistory = computed(() =>
    canExpandHistoryWindow({
      windowSize: historyWindowSize.value,
      loadedRecords: historyLoadedRecords.value,
      totalRecords: historyTotalRecords.value,
    }),
  )
  const historyRemainingRecords = computed(() =>
    Math.max(0, historyTotalRecords.value - historyLoadedRecords.value),
  )

  watch(
    () => filesStore.roots,
    roots => {
      if (!workDir.value && (aiStore.currentWorkDir || roots.length > 0)) {
        workDir.value = aiStore.currentWorkDir || roots[0]?.path || ''
      }
    },
    { immediate: true },
  )

  function approvePlan(): void {
    planApproved.value = true
    awaitingPlanApproval.value = false
  }

  function rejectPlan(): void {
    planApproved.value = false
    awaitingPlanApproval.value = false
    pendingPlan.value = ''
  }

  function resetSessionEphemeralState(): void {
    pendingPlan.value = ''
    awaitingPlanApproval.value = false
    planApproved.value = false
    currentPhase.value = null
    spawnedTasks.value = []
  }

  function normalizeWorkspacePath(targetPath: string): string {
    return targetPath.replace(/\\/g, '/')
  }

  function isPathInWorkspace(targetPath: string): boolean {
    const normalized = normalizeWorkspacePath(targetPath)
    return filesStore.roots.some(root => normalized === root.path || normalized.startsWith(`${root.path}/`))
  }

  async function refreshWorkspaceDirectoryForToolPath(targetPath: string): Promise<void> {
    const normalized = normalizeWorkspacePath(targetPath)
    if (!isPathInWorkspace(normalized)) return

    const lastSlash = normalized.lastIndexOf('/')
    const parentDir = lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized
    const storeWithOptionalRefresh = filesStore as typeof filesStore & {
      refreshDirectory?: (absolutePath: string) => Promise<void>
      refreshRoot?: (rootId: string) => Promise<void>
    }

    if (typeof storeWithOptionalRefresh.refreshDirectory === 'function') {
      await storeWithOptionalRefresh.refreshDirectory(parentDir)
      return
    }

    const ownerRoot = filesStore.roots.find(root => parentDir === root.path || parentDir.startsWith(`${root.path}/`))
    if (ownerRoot && typeof filesStore.refreshRoot === 'function') {
      await filesStore.refreshRoot(ownerRoot.id)
    }
  }

  function clearWatchdog(): void {
    if (watchdogWarnTimer) {
      clearTimeout(watchdogWarnTimer)
      watchdogWarnTimer = null
    }
    if (watchdogTimer) {
      clearTimeout(watchdogTimer)
      watchdogTimer = null
    }
  }

  function resetWatchdog(): void {
    clearWatchdog()

    watchdogWarnTimer = setTimeout(() => {
      watchdogWarnTimer = null
      if (streamState.inToolExec || !isStreaming.value) return
      log.warn('watchdog_warning', { sessionId: sessionIdRef.value, ms: STREAM_WATCHDOG_WARN_MS })
    }, STREAM_WATCHDOG_WARN_MS)

    watchdogTimer = setTimeout(async () => {
      watchdogTimer = null
      if (streamState.inToolExec || !isStreaming.value) return

      error.value = `娴佸紡鍝嶅簲瓒呮椂锛?{STREAM_WATCHDOG_MS / 1000}s 鏃犳暟鎹級`
      log.warn('watchdog_timeout', { sessionId: sessionIdRef.value, ms: STREAM_WATCHDOG_MS })

      try {
        await aiAbortStream(sessionIdRef.value)
      } catch (err) {
        log.warn('watchdog_abort_failed', { sessionId: sessionIdRef.value }, err)
      }

      flushPendingDelta()
      updateStreamingMessage(message => ({
        ...message,
        content: `${message.content}\n\n[瓒呮椂涓柇]`,
        isStreaming: false,
      }))
      isStreaming.value = false
    }, STREAM_WATCHDOG_MS)
  }

  function cancelFlushTimer(): void {
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
    if (flushRafId !== null) {
      cancelAnimationFrame(flushRafId)
      flushRafId = null
    }
  }

  function scheduleFlush(): void {
    if (flushRafId !== null) return
    flushRafId = requestAnimationFrame(() => {
      flushRafId = null
      flushPendingDelta()
    })
  }

  function flushPendingDelta(): void {
    cancelFlushTimer()

    if (!streamState.pendingTextDelta && !streamState.pendingThinkingDelta) return

    const textChunk = streamState.pendingTextDelta
    const thinkingChunk = streamState.pendingThinkingDelta
    streamState.pendingTextDelta = ''
    streamState.pendingThinkingDelta = ''

    updateStreamingMessage(message => ({
      ...message,
      content: message.content + textChunk,
      thinking: (message.thinking ?? '') + thinkingChunk,
    }))

    if (!userScrolled.value) {
      scrollToBottom()
    }
  }

  function updateStreamingMessage(updater: (msg: AiMessage) => AiMessage): void {
    if (!streamState.streamingMessageId) return
    let index = streamingMessageIndex
    if (
      index < 0
      || index >= messages.value.length
      || messages.value[index]?.id !== streamState.streamingMessageId
    ) {
      index = messages.value.findIndex(message => message.id === streamState.streamingMessageId)
      streamingMessageIndex = index
    }
    if (index !== -1) {
      messages.value[index] = updater(messages.value[index]!)
    }
  }

  function handleIncomingStreamEvent(event: import('@/types/ai').AiStreamEvent): void {
    if (event.type === 'TextDelta' || event.type === 'ThinkingDelta') {
      observability.markFirstToken()
    }
    if (event.type === 'ToolCall') {
      observability.updatePendingToolQueueLength(streamState.pendingToolCalls.length + 1)
    }
    applyStreamEvent({
      event,
      sessionId: sessionIdRef.value,
      log,
      streamState,
      messages,
      error,
      currentPhase,
      planGateEnabled,
      planApproved,
      pendingPlan,
      awaitingPlanApproval,
      resetWatchdog,
      flushPendingDelta,
      scheduleFlush,
      updateStreamingMessage,
    })
    if (event.type === 'ToolCall' || event.type === 'ToolCallDelta' || event.type === 'Done') {
      observability.updatePendingToolQueueLength(streamState.pendingToolCalls.length)
    }
  }

  async function executeToolCalls(toolCalls: ToolCallInfo[], sessionId: string, signal?: AbortSignal) {
    observability.updatePendingToolQueueLength(toolCalls.length)
    const results = await runToolCalls({
      sessionId,
      workDir: workDir.value,
      toolCalls,
      toolFailureCounter,
      log,
      clearWatchdog,
      setInToolExec: value => {
        streamState.inToolExec = value
      },
      updateStreamingMessage,
      refreshWorkspaceDirectoryForToolPath,
      signal,
    })
    observability.recordToolRun(toolCalls, results)
    observability.updatePendingToolQueueLength(0)
    return results
  }

  function parseAndWriteJournalSections(text: string, workDirPath: string): void {
    writeJournalSectionsFromText(text, workDirPath, log)
  }

  function parseSpawnedTasks(text: string): void {
    let sourceMessageId: string | undefined
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const message = messages.value[i]
      if (message?.role === 'assistant') {
        sourceMessageId = message.id
        break
      }
    }
    const tasks = collectSpawnedTasks(text, { sourceMessageId })
    if (tasks.length === 0) return
    spawnedTasks.value = [...spawnedTasks.value, ...tasks]
  }

  async function loadHistory(overrideSessionId?: string, options?: { windowSize?: number }): Promise<void> {
    const seq = ++loadSeq
    observability.markHistoryLoadStart()

    if (isStreaming.value) {
      isStreaming.value = false
      clearWatchdog()
      cancelFlushTimer()
      streamState.streamingMessageId = ''
      streamingMessageIndex = -1
      streamState.pendingTextDelta = ''
      streamState.pendingThinkingDelta = ''
      streamState.pendingToolCalls = []
      streamState.lastFinishReason = ''
      streamState.inToolExec = false
    }

    const sid = overrideSessionId ?? sessionIdRef.value
    const requestedWindowSize = options?.windowSize ?? historyWindowSize.value
    const requestKey = `${sid}:${requestedWindowSize}`
    if (!sid) {
      observability.markHistoryLoadComplete(messages.value.length)
      return
    }
    if (requestKey === lastLoadedHistoryKey && messages.value.length > 0 && !options?.windowSize) {
      observability.markHistoryLoadComplete(messages.value.length)
      return
    }
    isLoading.value = true
    error.value = null

    try {
      const result = await loadChatHistoryWindow(sid, requestedWindowSize)
      if (seq !== loadSeq) return

      log.info('load_history', {
        sessionId: sid,
        hit: !!result.session,
        recordCount: result.window.loadedRecords,
        totalRecords: result.window.totalRecords,
        truncated: result.truncated,
      })

      historyWindowSize.value = result.window.windowSize
      historyLoadedRecords.value = result.window.loadedRecords
      historyTotalRecords.value = result.window.totalRecords
      if (!options?.windowSize) {
        resetSessionEphemeralState()
        workDir.value = result.session?.workDir || aiStore.currentWorkDir || filesStore.roots[0]?.path || ''
      }

      const currentIds = messages.value.map(message => message.id).join('|')
      const nextIds = result.messages.map(message => message.id).join('|')
      if (currentIds !== nextIds) {
        messages.value = result.messages
        streamingMessageIndex = -1
      }
      lastLoadedHistoryKey = requestKey
      observability.markHistoryLoadComplete(result.messages.length)
      scheduleHistoryPreload(sid, result.window)
    } catch (err) {
      error.value = ensureErrorString(err)
      log.error('load_history_failed', { sessionId: sid }, err)
    } finally {
      isLoading.value = false
    }
  }

  function scheduleHistoryPreload(sid: string, window: { loadedRecords: number; totalRecords: number; windowSize: number }): void {
    if (!canExpandHistoryWindow(window)) return
    const nextWindowSize = Math.min(
      getExpandedHistoryWindowSize(window.windowSize),
      window.totalRecords,
    )
    void preloadChatHistoryWindow(sid, nextWindowSize)
  }

  async function send(
    content: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt?: string,
    attachments?: FileAttachment[],
  ): Promise<void> {
    if (!canSend.value || !content.trim()) return

    const sid = sessionIdRef.value
    if (!sid) {
      error.value = '会话 ID 无效，无法发送消息。'
      return
    }

    error.value = null
    invalidateChatHistoryCache(sid)
    observability.markSendStart()
    userScrolled.value = false

    await runAiChatSessionTurn({
      sessionId: sid,
      content,
      provider,
      model,
      apiKey,
      systemPrompt,
      attachments,
      workDir,
      aiStore,
      memoryStore,
      messages,
      isStreaming,
      streamState,
      error,
      planGateEnabled,
      planApproved,
      log,
      maxToolLoops: MAX_TOOL_LOOPS,
      totalTokens: () => totalTokens.value,
      forceCompact: autoCompact.forceCompact,
      checkAndCompact: autoCompact.checkAndCompact,
      clearWatchdog,
      resetWatchdog,
      flushPendingDelta,
      updateStreamingMessage,
      executeToolCalls: (toolCalls, sessionId, signal) => executeToolCalls(toolCalls, sessionId, signal),
      parseAndWriteJournalSections,
      parseSpawnedTasks,
      onStreamEvent: handleIncomingStreamEvent,
      onResponseComplete: () => observability.markResponseComplete(),
      onCompactTriggered: () => observability.markCompactTriggered(),
    })
  }

  async function abort(): Promise<void> {
    await abortChat({
      sessionId: sessionIdRef.value,
      messages,
      isStreaming,
      streamState,
      log,
      clearWatchdog,
      flushPendingDelta,
      updateStreamingMessage,
    })
  }

  async function regenerate(
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt?: string,
  ): Promise<void> {
    if (isStreaming.value) return

    const lastUserMessage = [...messages.value].reverse().find(message => message.role === 'user')
    if (!lastUserMessage) return

    let lastAssistantIndex = -1
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const message = messages.value[i]
      if (message && (message.role === 'assistant' || message.role === 'error')) {
        lastAssistantIndex = i
        break
      }
    }

    if (lastAssistantIndex >= 0) {
      messages.value = messages.value.filter((_, index) => index !== lastAssistantIndex)
    }

    const lastUserIndex = messages.value.lastIndexOf(lastUserMessage)
    if (lastUserIndex >= 0) {
      messages.value = messages.value.filter((_, index) => index !== lastUserIndex)
    }

    await send(lastUserMessage.content, provider, model, apiKey, systemPrompt)
  }

  function removeLastError(): void {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i]?.role === 'error') {
        messages.value = messages.value.filter((_, index) => index !== i)
        break
      }
    }
  }

  function clearMessages(): void {
    messages.value = []
    error.value = null
    isStreaming.value = false
    historyLoadedRecords.value = 0
    historyTotalRecords.value = 0
    historyWindowSize.value = HISTORY_RECENT_RECORD_LIMIT
    lastLoadedHistoryKey = ''
    invalidateChatHistoryCache(sessionIdRef.value)
    streamState.streamingMessageId = ''
    streamingMessageIndex = -1
    streamState.pendingTextDelta = ''
    streamState.pendingThinkingDelta = ''
    streamState.pendingToolCalls = []
    streamState.lastFinishReason = ''
    streamState.inToolExec = false
    cancelFlushTimer()
    clearWatchdog()
    toolFailureCounter.clear()
    autoCompact.resetCircuitBreaker()
    observability.reset()
    resetSessionEphemeralState()
  }

  async function loadMoreHistory(): Promise<void> {
    if (!canLoadMoreHistory.value) return
    if (historyLoadMorePending.value) return
    const expandedWindowSize = getExpandedHistoryWindowSize(historyWindowSize.value)
    historyLoadMorePending.value = true
    historyLoadMoreError.value = null
    const previousError = error.value
    try {
      await loadHistory(sessionIdRef.value, {
        windowSize: historyTotalRecords.value > 0
          ? Math.min(expandedWindowSize, historyTotalRecords.value)
          : expandedWindowSize,
      })
      historyLoadMoreError.value = error.value && error.value !== previousError
        ? error.value
        : null
    } catch (err) {
      historyLoadMoreError.value = ensureErrorString(err)
    } finally {
      historyLoadMorePending.value = false
    }
  }

  async function preloadHistory(overrideSessionId?: string, options?: { windowSize?: number }): Promise<void> {
    const sid = overrideSessionId ?? sessionIdRef.value
    if (!sid) return
    await preloadChatHistoryWindow(sid, options?.windowSize ?? HISTORY_RECENT_RECORD_LIMIT)
  }

  function scrollToBottom(): void {
    const container = options.scrollContainer?.value
    if (!container) return
    nextTick(() => {
      container.scrollTop = container.scrollHeight
    })
  }

  function handleScroll(event: Event): void {
    if (scrollRafId !== null) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      const element = event.target as HTMLElement | null
      if (!element) return
      const threshold = 50
      const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < threshold
      userScrolled.value = !isAtBottom
    })
  }

  onUnmounted(() => {
    cancelFlushTimer()
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId)
      scrollRafId = null
    }
    clearWatchdog()
  })

  return {
    messages,
    isStreaming,
    isLoading,
    error,
    totalTokens,
    latestUsage,
    canSend,
    canLoadMoreHistory,
    historyLoadMorePending,
    historyLoadMoreError,
    workDir,
    historyLoadedRecords,
    historyTotalRecords,
    historyRemainingRecords,
    observability: observability.metrics,
    isCompacting: autoCompact.isCompacting,
    availableWorkDirs,
    isPathInWorkspace,
    planGateEnabled,
    planApproved,
    pendingPlan,
    awaitingPlanApproval,
    approvePlan,
    rejectPlan,
    currentPhase,
    spawnedTasks,
    loadHistory,
    loadMoreHistory,
    preloadHistory,
    send,
    abort,
    regenerate,
    removeLastError,
    clearMessages,
    manualCompact: (provider: ProviderConfig, model: ModelConfig, apiKey: string) =>
      autoCompact.forceCompact(messages.value, sessionIdRef.value ?? '', provider, model, apiKey)
        .then(compacted => {
          if (compacted) {
            messages.value = compacted
            observability.markCompactTriggered()
          }
          return !!compacted
        }),
    handleScroll,
    scrollToBottom,
  }
}
