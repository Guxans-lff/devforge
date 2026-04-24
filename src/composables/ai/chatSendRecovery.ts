import type { AiMessage, ModelConfig, ProviderConfig } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { ensureErrorString } from '@/types/error'
import { buildChatMessagesWithOptions } from './chatMessageBuilder'
import { normalizeAiErrorMessage } from './chatHelpers'
import type { AiChatStreamState } from './chatStreamEvents'

export interface HandleSendFailureParams {
  error: unknown
  sessionId: string
  provider: ProviderConfig
  model: ModelConfig
  apiKey: string
  enrichedSystemPrompt: string | undefined
  enableTools: boolean
  hasVisionCapability: boolean
  messages: { value: AiMessage[] }
  errorRef: { value: string | null }
  streamState: AiChatStreamState
  log: Logger
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
  onRecovery?: () => void
  forceCompact: (
    messages: AiMessage[],
    sessionId: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
  ) => Promise<AiMessage[] | null>
  streamWithToolLoop: (
    sid: string,
    chatMessages: import('@/api/ai').ChatMessage[],
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt: string | undefined,
    enableTools: boolean,
  ) => Promise<void>
}

export async function handleSendFailure(params: HandleSendFailureParams): Promise<void> {
  const {
    error,
    sessionId,
    provider,
    model,
    apiKey,
    enrichedSystemPrompt,
    enableTools,
    hasVisionCapability,
    messages,
    errorRef,
    streamState,
    log,
    updateStreamingMessage,
    onRecovery,
    forceCompact,
    streamWithToolLoop,
  } = params

  const errMsg = normalizeAiErrorMessage(ensureErrorString(error))
  const isOverflow = /context_length_exceeded|maximum context length|tokens.*exceed|prompt.*too.*long/i.test(errMsg)

  if (!isOverflow) {
    log.error('send_failed', { sessionId }, error)
    errorRef.value = errMsg
    if (streamState.streamingMessageId) {
      updateStreamingMessage(message => ({
        ...message,
        role: 'error',
        content: errMsg,
        isStreaming: false,
      }))
    }
    return
  }

  log.info('overflow_detected', { sessionId, errMsg: errMsg.slice(0, 200) })
  onRecovery?.()

  if (streamState.streamingMessageId) {
    const failedMessageId = streamState.streamingMessageId
    messages.value = messages.value.filter(message => message.id !== failedMessageId)
    streamState.streamingMessageId = ''
  }

  const compacted = await forceCompact(messages.value, sessionId, provider, model, apiKey)
  if (!compacted) {
    log.error('overflow_compact_failed', { sessionId })
    errorRef.value = `${errMsg}\n已尝试自动压缩但失败，请手动清空历史或切换更大上下文模型。`
    return
  }

  messages.value = compacted
  try {
    const retryMessages = buildChatMessagesWithOptions(messages.value, {
      hasVision: hasVisionCapability,
      replayToolContext: enableTools,
    })
    await streamWithToolLoop(
      sessionId,
      retryMessages,
      provider,
      model,
      apiKey,
      enrichedSystemPrompt,
      enableTools,
    )
    errorRef.value = null
    log.info('overflow_recovered', { sessionId })
  } catch (retryError) {
    const retryMessage = ensureErrorString(retryError)
    log.error('overflow_retry_failed', { sessionId }, retryError)
    errorRef.value = `${retryMessage}\n已尝试自动压缩但仍然超限，请手动清空历史或切换更大上下文模型。`
    if (streamState.streamingMessageId) {
      updateStreamingMessage(message => ({
        ...message,
        role: 'error',
        content: retryMessage,
        isStreaming: false,
      }))
    }
  }
}
