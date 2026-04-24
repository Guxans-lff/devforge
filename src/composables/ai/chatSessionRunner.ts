import { aiAbortStream, type ChatMessage } from '@/api/ai'
import type { useAiChatStore } from '@/stores/ai-chat'
import type { useAiMemoryStore } from '@/stores/ai-memory'
import type { AiMessage, AiStreamEvent, FileAttachment, ModelConfig, ProviderConfig, ToolCallInfo, ToolResultInfo } from '@/types/ai'
import { ensureErrorString, readStructuredRetryable } from '@/types/error'
import type { Logger } from '@/utils/logger'
import { finalizeSend } from './chatSendFinalize'
import { prepareSendContext } from './chatSendPreparation'
import { handleSendFailure } from './chatSendRecovery'
import type { AiChatStreamState } from './chatStreamEvents'
import { streamWithToolLoop as runStreamWithToolLoop } from './chatToolLoop'

type AiChatStore = ReturnType<typeof useAiChatStore>
type AiMemoryStore = ReturnType<typeof useAiMemoryStore>

export interface AiChatSessionRunnerResult {
  status: 'done' | 'error' | 'cancelled'
  summary?: string
  error?: string
  sessionId: string
  startedAt: number
  finishedAt: number
  retryable: boolean
}

export interface AiChatSessionRunnerParams {
  sessionId: string
  content: string
  provider: ProviderConfig
  model: ModelConfig
  apiKey: string
  systemPrompt?: string
  attachments?: FileAttachment[]
  workDir: { value: string }
  aiStore: AiChatStore
  memoryStore: AiMemoryStore
  messages: { value: AiMessage[] }
  isStreaming: { value: boolean }
  streamState: AiChatStreamState
  error: { value: string | null }
  planGateEnabled: { value: boolean }
  planApproved: { value: boolean }
  log: Logger
  maxToolLoops: number
  totalTokens: () => number
  forceCompact: (
    messages: AiMessage[],
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
  ) => Promise<AiMessage[] | null>
  checkAndCompact: (
    messages: AiMessage[],
    totalTokens: number,
    maxContext: number,
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
  ) => Promise<AiMessage[] | null>
  clearWatchdog: () => void
  resetWatchdog: () => void
  flushPendingDelta: () => void
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
  executeToolCalls: (toolCalls: ToolCallInfo[], sessionId: string, signal?: AbortSignal) => Promise<ToolResultInfo[]>
  parseAndWriteJournalSections: (text: string, workDirPath: string) => void
  parseSpawnedTasks: (text: string) => void
  onStreamEvent: (event: AiStreamEvent) => void
  onFirstToken?: () => void
  onPendingToolQueueLength?: (length: number) => void
  onResponseComplete?: () => void
  onCompactTriggered?: () => void
  onPrepareComplete?: () => void
  onRequestStart?: () => void
  onRecovery?: () => void
  signal?: AbortSignal
  summaryMode?: 'brief' | 'normal'
}

const RETRYABLE_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /connection (reset|closed|refused|aborted)/i,
  /fetch failed/i,
  /temporarily unavailable/i,
  /rate limit/i,
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
]

const NON_RETRYABLE_ERROR_PATTERNS = [
  /cancel/i,
  /abort/i,
  /user_rejected/i,
  /approval/i,
  /denied/i,
  /forbidden/i,
  /\b401\b/,
  /\b403\b/,
]

export async function runAiChatSessionTurn(params: AiChatSessionRunnerParams): Promise<AiChatSessionRunnerResult> {
  const startedAt = Date.now()
  const sid = params.sessionId
  let abortListener: (() => void) | undefined
  const onStreamEvent = (event: AiStreamEvent) => {
    if (event.type === 'TextDelta' || event.type === 'ThinkingDelta') {
      params.onFirstToken?.()
    }
    if (event.type === 'ToolCall') {
      params.onPendingToolQueueLength?.(params.streamState.pendingToolCalls.length + 1)
    }
    params.onStreamEvent?.(event)
  }

  if (params.signal?.aborted) {
    return {
      status: 'cancelled',
      error: 'Task cancelled',
      sessionId: sid,
      startedAt,
      finishedAt: Date.now(),
      retryable: false,
    }
  }

  if (params.signal) {
    abortListener = () => {
      aiAbortStream(sid).catch(error => params.log.warn('runner_abort_failed', { sessionId: sid }, error))
    }
    params.signal.addEventListener('abort', abortListener, { once: true })
  }

  let prepared: Awaited<ReturnType<typeof prepareSendContext>> | null = null

  try {
    params.error.value = null
    prepared = await prepareSendContext({
      content: params.content,
      provider: params.provider,
      model: params.model,
      systemPrompt: params.systemPrompt,
      attachments: params.attachments,
      sessionId: sid,
      messages: params.messages,
      workDir: params.workDir.value,
      planGateEnabled: params.planGateEnabled.value,
      planApproved: params.planApproved.value,
      aiStore: params.aiStore,
      memoryStore: params.memoryStore,
      log: params.log,
    })
    params.onPrepareComplete?.()

    params.isStreaming.value = true

    const streamWithToolLoop = (
      streamSessionId: string,
      chatMessages: ChatMessage[],
      provider: ProviderConfig,
      model: ModelConfig,
      apiKey: string,
      systemPrompt: string | undefined,
      enableTools: boolean,
    ) => runStreamWithToolLoop({
      sid: streamSessionId,
      chatMessages,
      provider,
      model,
      apiKey,
      systemPrompt,
      enableTools,
      log: params.log,
      messages: params.messages,
      isStreaming: params.isStreaming,
      workDir: params.workDir,
      streamState: params.streamState,
      maxToolLoops: params.maxToolLoops,
      resetWatchdog: params.resetWatchdog,
      clearWatchdog: params.clearWatchdog,
      flushPendingDelta: params.flushPendingDelta,
      updateStreamingMessage: params.updateStreamingMessage,
      onStreamEvent,
      onRequestStart: params.onRequestStart,
      executeToolCalls: (toolCalls, toolSessionId) =>
        params.executeToolCalls(toolCalls, toolSessionId, params.signal),
      parseAndWriteJournalSections: params.parseAndWriteJournalSections,
      parseSpawnedTasks: params.parseSpawnedTasks,
    })

    await streamWithToolLoop(
      sid,
      prepared.chatMessages,
      params.provider,
      params.model,
      params.apiKey,
      prepared.enrichedSystemPrompt,
      prepared.enableTools,
    )
  } catch (error) {
    const structuredRetryable = readStructuredRetryable(error)
    if (structuredRetryable !== undefined) {
      params.streamState.lastErrorRetryable = structuredRetryable
    }

    if (params.signal?.aborted) {
      params.error.value = 'Task cancelled'
    } else if (prepared) {
      await handleSendFailure({
        error,
        sessionId: sid,
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        enrichedSystemPrompt: prepared.enrichedSystemPrompt,
        enableTools: prepared.enableTools,
        hasVisionCapability: prepared.hasVisionCapability,
        messages: params.messages,
        errorRef: params.error,
        streamState: params.streamState,
        log: params.log,
        updateStreamingMessage: params.updateStreamingMessage,
        onRecovery: params.onRecovery,
        forceCompact: params.forceCompact,
        streamWithToolLoop: (
          retrySessionId,
          chatMessages,
          provider,
          model,
          apiKey,
          systemPrompt,
          enableTools,
        ) => runStreamWithToolLoop({
          sid: retrySessionId,
          chatMessages,
          provider,
          model,
          apiKey,
          systemPrompt,
          enableTools,
          log: params.log,
          messages: params.messages,
          isStreaming: params.isStreaming,
          workDir: params.workDir,
          streamState: params.streamState,
          maxToolLoops: params.maxToolLoops,
          resetWatchdog: params.resetWatchdog,
          clearWatchdog: params.clearWatchdog,
          flushPendingDelta: params.flushPendingDelta,
          updateStreamingMessage: params.updateStreamingMessage,
          onStreamEvent,
          onRequestStart: params.onRequestStart,
          executeToolCalls: (toolCalls, toolSessionId) =>
            params.executeToolCalls(toolCalls, toolSessionId, params.signal),
          parseAndWriteJournalSections: params.parseAndWriteJournalSections,
          parseSpawnedTasks: params.parseSpawnedTasks,
        }),
      })
    } else {
      params.error.value = ensureErrorString(error)
    }
  } finally {
    if (params.signal && abortListener) {
      params.signal.removeEventListener('abort', abortListener)
    }
    const latestError = [...params.messages.value].reverse().find(message => message.role === 'error')
    const completed = !params.signal?.aborted && !params.error.value && !latestError
    if (completed) {
      params.onResponseComplete?.()
    }
    finalizeSend({
      sessionId: sid,
      provider: params.provider,
      model: params.model,
      systemPrompt: params.systemPrompt,
      apiKey: params.apiKey,
      messages: params.messages,
      isStreaming: params.isStreaming,
      streamState: params.streamState,
      workDir: params.workDir.value,
      totalTokens: params.totalTokens(),
      clearWatchdog: params.clearWatchdog,
      updateStreamingMessage: params.updateStreamingMessage,
      aiStore: params.aiStore,
      autoCompact: {
        checkAndCompact: async (...args) => {
          const compacted = await params.checkAndCompact(...args)
          if (compacted) params.onCompactTriggered?.()
          return compacted
        },
      },
      log: params.log,
    })
  }

  return buildRunnerResult({
    sessionId: sid,
    messages: params.messages.value,
    error: params.error.value,
    startedAt,
    finishedAt: Date.now(),
    cancelled: Boolean(params.signal?.aborted),
    streamRetryable: params.streamState.lastErrorRetryable,
    summaryMode: params.summaryMode,
  })
}

function buildRunnerResult(params: {
  sessionId: string
  messages: AiMessage[]
  error: string | null
  startedAt: number
  finishedAt: number
  cancelled: boolean
  streamRetryable?: boolean
  summaryMode?: 'brief' | 'normal'
}): AiChatSessionRunnerResult {
  const summary = summarizeMessages(params.messages, params.summaryMode)
  if (params.cancelled) {
    return {
      status: 'cancelled',
      summary,
      error: params.error ?? 'Task cancelled',
      sessionId: params.sessionId,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
      retryable: false,
    }
  }

  const latestError = [...params.messages].reverse().find(message => message.role === 'error')
  const error = params.error ?? latestError?.content
  if (error) {
    const retryable = params.streamRetryable
      ?? readStructuredRetryable(error)
      ?? isRetryableRunnerError(error)
    return {
      status: 'error',
      summary,
      error,
      sessionId: params.sessionId,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
      retryable,
    }
  }

  return {
    status: 'done',
    summary,
    sessionId: params.sessionId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    retryable: false,
  }
}

function summarizeMessages(messages: AiMessage[], mode: 'brief' | 'normal' = 'normal'): string | undefined {
  const latest = [...messages]
    .reverse()
    .find(message => message.role === 'assistant' && message.content.trim())
  if (!latest) return undefined

  const limit = mode === 'brief' ? 240 : 1200
  const content = latest.content.trim()
  return content.length > limit ? `${content.slice(0, limit).trimEnd()}...` : content
}

function isRetryableRunnerError(error: string): boolean {
  if (NON_RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(error))) return false
  return RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(error))
}
