import type { useAiChatStore } from '@/stores/ai-chat'
import type { AiMessage, ModelConfig, ProviderConfig } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { saveFinalSession } from './chatSessionPersistence'
import type { AiChatStreamState } from './chatStreamEvents'

type AiChatStore = ReturnType<typeof useAiChatStore>

export interface FinalizeSendParams {
  sessionId: string
  provider: ProviderConfig
  model: ModelConfig
  systemPrompt: string | undefined
  apiKey: string
  messages: { value: AiMessage[] }
  isStreaming: { value: boolean }
  streamState: AiChatStreamState
  workDir: string
  totalTokens: number
  clearWatchdog: () => void
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
  aiStore: AiChatStore
  autoCompact: {
    checkAndCompact: (
      messages: AiMessage[],
      totalTokens: number,
      maxContext: number,
      sessionId: string,
      provider: ProviderConfig,
      model: ModelConfig,
      apiKey: string,
    ) => Promise<AiMessage[] | null>
  }
  log: Logger
}

export function finalizeSend(params: FinalizeSendParams): void {
  const {
    sessionId,
    provider,
    model,
    systemPrompt,
    apiKey,
    messages,
    isStreaming,
    streamState,
    workDir,
    totalTokens,
    clearWatchdog,
    updateStreamingMessage,
    aiStore,
    autoCompact,
    log,
  } = params

  clearWatchdog()
  streamState.inToolExec = false
  if (streamState.streamingMessageId) {
    updateStreamingMessage(message => ({ ...message, isStreaming: false }))
  }
  isStreaming.value = false
  streamState.streamingMessageId = ''

  saveFinalSession({
    store: aiStore,
    sessionId,
    titleSource: messages.value.find(message => message.role === 'user')?.content ?? '',
    provider,
    model,
    systemPrompt,
    messageCount: messages.value.filter(message => message.role !== 'error').length,
    totalTokens,
    createdAt: messages.value[0]?.timestamp ?? Date.now(),
    workDir,
    log,
  })

  const effectiveMaxContext = model.capabilities.maxContext > 0 ? model.capabilities.maxContext : 0
  if (effectiveMaxContext <= 0) return

  autoCompact.checkAndCompact(
    messages.value,
    totalTokens,
    effectiveMaxContext,
    sessionId,
    provider,
    model,
    apiKey,
  ).then(compacted => {
    if (compacted) {
      messages.value = compacted
      log.info('background_compact_applied', { sessionId, newCount: compacted.length })
    }
  }).catch(error => log.warn('background_compact_failed', { sessionId }, error))
}
