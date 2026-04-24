import { aiAbortStream, aiSaveMessage } from '@/api/ai'
import type { AiMessage, AiMessageRecord } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { genId } from './chatHelpers'
import type { AiChatStreamState } from './chatStreamEvents'

const ABORTED_TOOL_RESULT = '[工具调用被用户中断，未执行]'
const ABORTED_MESSAGE_SUFFIX = '[已中断]'

export interface AbortChatParams {
  sessionId: string
  messages: { value: AiMessage[] }
  isStreaming: { value: boolean }
  streamState: AiChatStreamState
  log: Logger
  clearWatchdog: () => void
  flushPendingDelta: () => void
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
}

export async function abortChat({
  sessionId,
  messages,
  isStreaming,
  streamState,
  log,
  clearWatchdog,
  flushPendingDelta,
  updateStreamingMessage,
}: AbortChatParams): Promise<void> {
  if (!isStreaming.value) return

  clearWatchdog()
  try {
    await aiAbortStream(sessionId)
  } catch (error) {
    log.warn('abort_failed', { sessionId }, error)
  }

  flushPendingDelta()

  const streamingMessage = messages.value.find(message => message.id === streamState.streamingMessageId)
  if (streamingMessage?.toolCalls && streamingMessage.toolCalls.length > 0) {
    const existingResults = streamingMessage.toolResults ?? []
    const respondedIds = new Set(existingResults.map(result => result.toolCallId))
    const missingToolCalls = streamingMessage.toolCalls.filter(toolCall => !respondedIds.has(toolCall.id))

    if (missingToolCalls.length > 0) {
      const missingIds = new Set(missingToolCalls.map(toolCall => toolCall.id))
      const patchedResults = [
        ...existingResults,
        ...missingToolCalls.map(toolCall => ({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          content: ABORTED_TOOL_RESULT,
        })),
      ]

      updateStreamingMessage(message => ({
        ...message,
        toolResults: patchedResults,
        toolCalls: (message.toolCalls ?? []).map(toolCall =>
          missingIds.has(toolCall.id)
            ? { ...toolCall, status: 'error', error: ABORTED_TOOL_RESULT }
            : toolCall,
        ),
      }))

      for (const toolCall of missingToolCalls) {
        const toolRecord: AiMessageRecord = {
          id: genId(),
          sessionId,
          role: 'tool',
          content: ABORTED_TOOL_RESULT,
          contentType: 'tool_result',
          tokens: 0,
          cost: 0,
          parentId: toolCall.id,
          success: false,
          toolName: toolCall.name,
          createdAt: Date.now(),
        }
        aiSaveMessage(toolRecord)
          .catch(error => log.warn('save_abort_stub_failed', { sessionId, toolCallId: toolCall.id }, error))
      }
    }
  }

  updateStreamingMessage(message => ({
    ...message,
    content: `${message.content}\n\n${ABORTED_MESSAGE_SUFFIX}`,
    isStreaming: false,
  }))
  streamState.streamingMessageId = ''
  streamState.pendingTextDelta = ''
  streamState.pendingThinkingDelta = ''
  streamState.pendingToolCalls = []
  streamState.lastFinishReason = ''
  streamState.lastErrorRetryable = undefined
  streamState.inToolExec = false
  isStreaming.value = false
}
