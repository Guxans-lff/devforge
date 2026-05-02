import { computed, nextTick, onUnmounted, reactive, ref, shallowRef, toRef, triggerRef, watch, type MaybeRef, type Ref } from 'vue'
import { useAutoCompact } from '@/composables/useAutoCompact'
import { abortChat } from '@/composables/ai/chatAbort'
import {
  canExpandHistoryWindow,
  getExpandedHistoryWindowSize,
  HISTORY_RECENT_RECORD_LIMIT,
  invalidateChatHistoryCache,
  loadChatHistoryWindow,
} from '@/composables/ai/chatHistoryLoad'
import { runAiChatSessionTurn, type AiChatSessionRunnerResult } from '@/composables/ai/chatSessionRunner'
import { createAgentRuntime } from '@/composables/ai/AgentRuntime'
import { createAgentRuntimeTranscriptBridge } from '@/composables/ai-agent/transcript/agentRuntimeTranscriptBridge'
import { createTranscriptStore } from '@/composables/ai-agent/transcript/transcriptStore'
import {
  aiAppendTranscriptEvent,
  aiExportTranscriptEvents,
  aiListTranscriptEvents,
  aiQueryTranscriptEvents,
} from '@/api/ai/transcript'
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
import { resolveStreamWatchdogConfig } from '@/composables/ai/chatHelpers'
import { buildPermissionRuleSet, type PermissionRuleConfig } from '@/ai-gui/permissionRules'
import {
  buildAdvancedAgentRuntimeContext,
  buildAdvancedAgentRuntimePayload,
  createAdvancedAgentRuntimePayloadSignature,
} from '@/ai-gui/advancedAgentRuntime'
import { buildAdvancedAgentGovernanceSnapshot } from '@/ai-gui/advancedAgentGovernance'
import type { ParsedVerificationReport } from '@/ai-gui/verificationReport'
import { useAiChatStore } from '@/stores/ai-chat'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useSettingsStore } from '@/stores/settings'
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

const MAX_TOOL_LOOPS = 30
const HISTORY_LOAD_TIMEOUT_MS = 8_000

export interface UseAiChatOptions {
  sessionId: MaybeRef<string>
  scrollContainer?: Ref<HTMLElement | null>
  scrollToBottom?: () => void
  getVerificationReport?: () => ParsedVerificationReport | null
  isVerificationRunning?: () => boolean
}

export interface AiChatRequestOptions {
  responseFormat?: 'json_object'
  prefixCompletion?: boolean
  prefixContent?: string
}

export function useAiChat(options: UseAiChatOptions) {
  const sessionIdRef = toRef(options.sessionId)
  const aiStore = useAiChatStore()
  const memoryStore = useAiMemoryStore()
  const settingsStore = useSettingsStore()
  const autoCompact = useAutoCompact()
  const observability = useAiChatObservability()
  const filesStore = useWorkspaceFilesStore()
  const transcriptEventsVersion = ref(0)
  const transcriptStore = createTranscriptStore({
    persist: true,
    autoLoad: true,
    backend: {
      appendEvent: aiAppendTranscriptEvent,
      listEvents: aiListTranscriptEvents,
      queryEvents: query => aiQueryTranscriptEvents({
        sessionId: query.sessionId,
        limit: query.limit,
        offset: query.offset,
        eventTypes: query.types,
        turnId: query.turnId,
        startTime: query.startTime,
        endTime: query.endTime,
      }),
      onError: (err, context) => {
        log.warn('transcript_backend_sync_failed', {
          operation: context.operation,
          sessionId: context.sessionId,
          error: ensureErrorString(err),
        })
      },
    },
  })
  const transcriptBridge = createAgentRuntimeTranscriptBridge({
    sessionId: () => sessionIdRef.value,
    transcriptStore,
    log,
  })
  const agentRuntime = createAgentRuntime({
    log,
    onTransition: transition => {
      transcriptBridge.appendTransition(transition)
      transcriptEventsVersion.value += 1
    },
  })

  const messages = shallowRef<AiMessage[]>([])
  const isStreaming = ref(false)
  const isLoading = ref(false)
  const isHistoryLoading = ref(false)
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
  let programmaticScrollUntil = 0
  let streamWatchdogMs = 90_000
  let streamWatchdogWarnMs = 45_000
  let loadSeq = 0
  let lastLoadedHistoryKey = ''
  let streamingMessageIndex = -1
  let lastAdvancedRuntimeContextSignature = ''

  const toolFailureCounter = new Map<string, number>()
  const sessionPermissionRules = ref<PermissionRuleConfig[]>([])

  function addSessionPermissionRule(rule: PermissionRuleConfig): void {
    sessionPermissionRules.value = [...sessionPermissionRules.value, rule]
  }

  function removeSessionPermissionRule(index: number): void {
    if (index < 0 || index >= sessionPermissionRules.value.length) return
    sessionPermissionRules.value = sessionPermissionRules.value.filter((_, itemIndex) => itemIndex !== index)
  }

  function clearSessionPermissionRules(): void {
    sessionPermissionRules.value = []
  }

  const availableWorkDirs = computed(() =>
    filesStore.roots.map(root => ({ label: root.name, value: root.path })),
  )
  const transcriptEvents = computed(() => {
    void transcriptEventsVersion.value
    const sid = sessionIdRef.value
    return sid ? transcriptStore.getRecentEvents(sid, 200) : []
  })
  const transcriptEventCount = computed(() => {
    void transcriptEventsVersion.value
    const sid = sessionIdRef.value
    return sid ? transcriptStore.getEventCount(sid) : 0
  })
  const latestAgentRuntimeContextEvent = computed(() => {
    void transcriptEventsVersion.value
    const sid = sessionIdRef.value
    return sid ? transcriptStore.getLatestEvent(sid, 'agent_runtime_context') : undefined
  })
  const agentRuntimeGovernance = computed(() => {
    void transcriptEventsVersion.value
    const sid = sessionIdRef.value
    const events = sid ? transcriptStore.getEventsByType(sid, ['agent_runtime_context']) : []
    return buildAdvancedAgentGovernanceSnapshot(events.map(event => ({
      timestamp: event.timestamp,
      assignmentCount: event.payload.data.assignmentCount,
      blockedCount: event.payload.data.blockedCount,
      warningCount: event.payload.data.warningCount,
      verificationRisk: event.payload.data.verificationRisk,
      verificationCommandCount: event.payload.data.verificationCommandCount,
      verificationGateStatus: event.payload.data.verificationGateStatus,
      verificationSafeToComplete: event.payload.data.verificationSafeToComplete,
      verificationMissingCommandCount: event.payload.data.verificationMissingCommandCount,
      verificationFailedCommandCount: event.payload.data.verificationFailedCommandCount,
      isolationBoundaryCount: event.payload.data.isolationBoundaryCount,
      isolationMergeRequiredCount: event.payload.data.isolationMergeRequiredCount,
      isolationBlockedCount: event.payload.data.isolationBlockedCount,
      isolationWorktreeCount: event.payload.data.isolationWorktreeCount,
      isolationTemporaryWorkspaceCount: event.payload.data.isolationTemporaryWorkspaceCount,
      isolationReviewRequiredCount: event.payload.data.isolationReviewRequiredCount,
      isolationConfirmationRequiredCount: event.payload.data.isolationConfirmationRequiredCount,
      isolationGateStatus: event.payload.data.isolationGateStatus,
      isolationSafeToAutoRun: event.payload.data.isolationSafeToAutoRun,
      lspDiagnosticCount: event.payload.data.lspDiagnosticCount,
      lspSummary: event.payload.data.lspSummary,
      warnings: event.payload.data.warnings,
    })))
  })
  const exportFullTranscript = () => {
    const sid = sessionIdRef.value
    return sid ? aiExportTranscriptEvents(sid) : Promise.resolve([])
  }

  function appendCompactTranscriptEvent(compacted: AiMessage[]): void {
    const sid = sessionIdRef.value
    if (!sid) return
    const boundary = compacted.find(message => message.type === 'compact-boundary')
    const metadata = boundary?.compactMetadata
    if (!boundary || !metadata) return
    transcriptStore.appendEvent({
      sessionId: sid,
      turnId: agentRuntime.state.value.turnId || undefined,
      type: 'compact',
      timestamp: metadata.createdAt,
      payload: {
        type: 'compact',
        data: {
          trigger: metadata.trigger,
          originalMessageCount: metadata.summarizedMessages,
          originalTokens: metadata.preTokens,
          summaryLength: compacted.find(message => message.id === metadata.summaryMessageId)?.content.length ?? 0,
          source: metadata.source,
        },
      },
    })
    transcriptEventsVersion.value += 1
  }

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

  watch(sessionIdRef, (sessionId) => {
    if (!sessionId) return
    void transcriptStore.loadBackend?.(sessionId, 500).then(loaded => {
      if (loaded) transcriptEventsVersion.value += 1
    })
  }, { immediate: true })

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

  function configureStreamWatchdog(model?: ModelConfig): void {
    const { warnMs, timeoutMs } = resolveStreamWatchdogConfig(model)
    streamWatchdogWarnMs = warnMs
    streamWatchdogMs = timeoutMs
  }

  function resetWatchdog(): void {
    clearWatchdog()

    watchdogWarnTimer = setTimeout(() => {
      watchdogWarnTimer = null
      if (streamState.inToolExec || !isStreaming.value) return
      log.warn('watchdog_warning', { sessionId: sessionIdRef.value, ms: streamWatchdogWarnMs })
    }, streamWatchdogWarnMs)

    watchdogTimer = setTimeout(async () => {
      watchdogTimer = null
      if (streamState.inToolExec || !isStreaming.value) return

      error.value = `流式响应超时（${streamWatchdogMs / 1000}s），已自动中断。`
      log.warn('watchdog_timeout', { sessionId: sessionIdRef.value, ms: streamWatchdogMs })

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
    }, streamWatchdogMs)
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
      triggerRef(messages)
    }
  }

  function handleIncomingStreamEvent(event: import('@/types/ai').AiStreamEvent): void {
    if (event.type === 'TextDelta' || event.type === 'ThinkingDelta') {
      observability.markFirstToken()
    }
    if (event.type === 'Usage') {
      transcriptStore.appendEvent({
        sessionId: sessionIdRef.value,
        turnId: agentRuntime.state.value.turnId || undefined,
        type: 'usage',
        timestamp: Date.now(),
        payload: {
          type: 'usage',
          data: {
            promptTokens: event.prompt_tokens,
            completionTokens: event.completion_tokens,
            cacheReadTokens: event.cache_read_tokens,
            totalTokens: event.prompt_tokens + event.completion_tokens,
          },
        },
      })
      transcriptEventsVersion.value += 1
    }
    if (event.type === 'Error') {
      transcriptStore.appendEvent({
        sessionId: sessionIdRef.value,
        turnId: agentRuntime.state.value.turnId || undefined,
        type: 'stream_error',
        timestamp: Date.now(),
        payload: {
          type: 'stream_error',
          data: {
            error: event.message.length > 500 ? `${event.message.slice(0, 500).trimEnd()}...` : event.message,
            retryable: event.retryable,
          },
        },
      })
      transcriptEventsVersion.value += 1
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

  async function executeToolCalls(
    toolCalls: ToolCallInfo[],
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    signal?: AbortSignal,
  ) {
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
      turnId: agentRuntime.state.value.turnId || undefined,
      transcriptStore,
      permissionContext: {
        provider,
        model,
        permissionRules: buildPermissionRuleSet({
          user: settingsStore.settings.aiPermissionRules,
          project: aiStore.currentWorkspaceConfig?.permissionRules,
          session: sessionPermissionRules.value,
        }),
      },
      workspaceIsolation: aiStore.currentWorkspaceConfig?.workspaceIsolation,
    })
    observability.recordToolRun(toolCalls, results)
    transcriptEventsVersion.value += results.length
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
    void appendAdvancedRuntimeContextEvent()
  }

  function extractRuntimeContextChangedFiles(): string[] {
    const fromTasks = spawnedTasks.value
      .flatMap(task => task.description.match(/(?:src|docs|src-tauri|tests|packages|apps)\/[A-Za-z0-9_./*-]+/g) ?? [])
    const fromOperations = messages.value
      .flatMap(message => message.toolCalls ?? [])
      .filter(toolCall => (toolCall.name === 'write_file' || toolCall.name === 'edit_file') && typeof toolCall.parsedArgs?.path === 'string')
      .map(toolCall => String(toolCall.parsedArgs?.path))
    return [...new Set([...fromTasks, ...fromOperations].map(path => path.replace(/\\/g, '/')))]
  }

  async function appendAdvancedRuntimeContextEvent(): Promise<void> {
    const sid = sessionIdRef.value
    if (!sid || spawnedTasks.value.length === 0) return

    try {
      const context = await buildAdvancedAgentRuntimeContext({
        sessionId: sid,
        tasks: spawnedTasks.value,
        changedFiles: extractRuntimeContextChangedFiles(),
        workspaceIsolation: aiStore.currentWorkspaceConfig?.workspaceIsolation,
        verificationReport: options.getVerificationReport?.() ?? null,
        verifying: options.isVerificationRunning?.() ?? false,
        maxAgents: aiStore.currentWorkspaceConfig?.dispatcherMaxParallel,
      })
      const payload = buildAdvancedAgentRuntimePayload(context)
      const signature = createAdvancedAgentRuntimePayloadSignature(payload)
      if (signature === lastAdvancedRuntimeContextSignature) return
      lastAdvancedRuntimeContextSignature = signature

      transcriptStore.appendEvent({
        sessionId: sid,
        turnId: agentRuntime.state.value.turnId || undefined,
        type: 'agent_runtime_context',
        timestamp: Date.now(),
        payload: {
          type: 'agent_runtime_context',
          data: payload,
        },
      })
      transcriptEventsVersion.value += 1
    } catch (error) {
      log.warn('advanced_runtime_context_failed', { sessionId: sid }, error)
    }
  }

  function refreshAdvancedRuntimeContext(): void {
    void appendAdvancedRuntimeContextEvent()
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
      streamState.lastErrorRetryable = undefined
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
      const result = await withTimeout(
        loadChatHistoryWindow(sid, requestedWindowSize),
        HISTORY_LOAD_TIMEOUT_MS,
        '历史会话加载超时，已停止本次恢复。请重启应用后再试，或清理该会话历史。',
      )
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
        isHistoryLoading.value = true
        streamingMessageIndex = -1

        // isHistoryLoading=true 期间 groupedMessages 短路返回空数组，
        // 所以这里一次性赋值不会触发 DOM 渲染
        messages.value = result.messages

        // 让出主线程，确保 loading 状态的 UI 先绘制
        await nextTick()

        // 解除 loading → groupedMessages 重算 → 一次性渲染所有可见消息
        isHistoryLoading.value = false
        await nextTick()
      }
      lastLoadedHistoryKey = requestKey
      observability.markHistoryLoadComplete(result.messages.length)
    } catch (err) {
      error.value = ensureErrorString(err)
      log.error('load_history_failed', { sessionId: sid }, err)
    } finally {
      isLoading.value = false
    }
  }

  async function send(
    content: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt?: string,
    attachments?: FileAttachment[],
    requestOptions?: AiChatRequestOptions,
  ): Promise<AiChatSessionRunnerResult | undefined> {
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
    const appendUserMessageEvent = (turnId?: string) => {
      transcriptStore.appendEvent({
        sessionId: sid,
        turnId,
        type: 'user_message',
        timestamp: Date.now(),
        payload: {
          type: 'user_message',
          data: {
            contentPreview: content.length > 200 ? `${content.slice(0, 200).trimEnd()}...` : content,
            attachmentCount: attachments?.length ?? 0,
            attachmentNames: attachments && attachments.length > 0
              ? attachments.map(attachment => attachment.name)
              : undefined,
          },
        },
      })
      transcriptEventsVersion.value += 1
    }

    configureStreamWatchdog(model)
    let userMessageRecorded = false
    let startedTurnId: string | undefined
    try {
      const result = await runAiChatSessionTurn({
        sessionId: sid,
        content,
        provider,
        model,
        apiKey,
        systemPrompt,
        attachments,
        requestOptions,
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
        checkAndCompact: async (...args) => {
          const compacted = await autoCompact.checkAndCompact(...args)
          if (compacted) appendCompactTranscriptEvent(compacted)
          return compacted
        },
        clearWatchdog,
        resetWatchdog,
        flushPendingDelta,
        updateStreamingMessage,
        executeToolCalls: (toolCalls, sessionId, signal) => executeToolCalls(toolCalls, sessionId, provider, model, signal),
        parseAndWriteJournalSections,
        parseSpawnedTasks,
        onStreamEvent: handleIncomingStreamEvent,
        onPrepareComplete: () => observability.markPrepareComplete(),
        onRequestStart: () => observability.markRequestStart(),
        onRecovery: () => observability.markRecovery(),
        onResponseComplete: () => observability.markResponseComplete(),
        onCompactTriggered: () => observability.markCompactTriggered(),
        onTurnStart: (turnId) => {
          startedTurnId = turnId
          appendUserMessageEvent(turnId)
          userMessageRecorded = true
        },
        agentRuntime,
      })
      const latestAssistant = [...messages.value].reverse().find(message => message.role === 'assistant' && message.content.trim())
      if (latestAssistant) {
        transcriptStore.appendEvent({
          sessionId: sid,
          turnId: agentRuntime.state.value.turnId || undefined,
          type: 'assistant_message',
          timestamp: Date.now(),
          payload: {
            type: 'assistant_message',
            data: {
              contentPreview: latestAssistant.content.length > 200
                ? `${latestAssistant.content.slice(0, 200).trimEnd()}...`
                : latestAssistant.content,
              tokens: latestAssistant.totalTokens ?? latestAssistant.tokens,
              finishReason: streamState.lastFinishReason || undefined,
            },
          },
        })
        transcriptEventsVersion.value += 1
      }
      return result
    } finally {
      if (!userMessageRecorded) {
        appendUserMessageEvent(startedTurnId)
      }
      configureStreamWatchdog()
    }
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
  ): Promise<AiChatSessionRunnerResult | undefined> {
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

    return await send(lastUserMessage.content, provider, model, apiKey, systemPrompt)
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
    lastAdvancedRuntimeContextSignature = ''
    invalidateChatHistoryCache(sessionIdRef.value)
    streamState.streamingMessageId = ''
    streamingMessageIndex = -1
    streamState.pendingTextDelta = ''
    streamState.pendingThinkingDelta = ''
    streamState.pendingToolCalls = []
    streamState.lastFinishReason = ''
    streamState.lastErrorRetryable = undefined
    streamState.inToolExec = false
    cancelFlushTimer()
    clearWatchdog()
    toolFailureCounter.clear()
    autoCompact.resetCircuitBreaker()
    observability.reset()
    resetSessionEphemeralState()
    clearSessionPermissionRules()
  }

  async function loadMoreHistory(): Promise<void> {
    if (!canLoadMoreHistory.value) return
    if (historyLoadMorePending.value) return
    if (isStreaming.value || isLoading.value) {
      historyLoadMoreError.value = '当前正在生成回复，请等待结束后再加载更多历史。'
      return
    }
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
    void overrideSessionId
    void options
  }

  function scrollToBottom(): void {
    programmaticScrollUntil = Date.now() + 250
    if (options.scrollToBottom) {
      nextTick(() => {
        options.scrollToBottom?.()
      })
      return
    }

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
      if (Date.now() < programmaticScrollUntil) return
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
    isHistoryLoading,
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
    recordRuntimeRouting: observability.recordRuntimeRouting,
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
    agentRuntime,
    turnState: agentRuntime.state,
    runtimeSnapshot: agentRuntime.snapshot,
    transcriptEvents,
    transcriptEventCount,
    latestAgentRuntimeContextEvent,
    agentRuntimeGovernance,
    exportFullTranscript,
    refreshAdvancedRuntimeContext,
    sessionPermissionRules,
    addSessionPermissionRule,
    removeSessionPermissionRule,
    clearSessionPermissionRules,
    loadHistory,
    loadMoreHistory,
    preloadHistory,
    send,
    abort,
    regenerate,
    removeLastError,
    clearMessages,
    manualCompact: (provider: ProviderConfig, model: ModelConfig, apiKey: string) =>
      autoCompact.forceCompact(messages.value, sessionIdRef.value ?? '', provider, model, apiKey, 'manual')
        .then(compacted => {
          if (compacted) {
            messages.value = compacted
            appendCompactTranscriptEvent(compacted)
            observability.markCompactTriggered()
          }
          return !!compacted
        }),
    handleScroll,
    scrollToBottom,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
