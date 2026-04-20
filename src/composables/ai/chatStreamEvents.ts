import { reactive, type Ref } from 'vue'
import type { AiMessage, AiStreamEvent, ToolCallInfo } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { tryParseJson } from './chatHelpers'

export interface AiChatPhaseState {
  current: number
  total: number
  label: string
}

export interface AiChatStreamState {
  pendingTextDelta: string
  pendingThinkingDelta: string
  pendingToolCalls: ToolCallInfo[]
  lastFinishReason: string
  streamingMessageId: string
  inToolExec: boolean
}

export interface HandleStreamEventParams {
  event: AiStreamEvent
  sessionId: string
  log: Logger
  streamState: AiChatStreamState
  messages: Ref<AiMessage[]>
  error: Ref<string | null>
  currentPhase: Ref<AiChatPhaseState | null>
  planGateEnabled: Ref<boolean>
  planApproved: Ref<boolean>
  pendingPlan: Ref<string>
  awaitingPlanApproval: Ref<boolean>
  resetWatchdog: () => void
  flushPendingDelta: () => void
  scheduleFlush: () => void
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
}

export function handleStreamEvent({
  event,
  sessionId,
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
}: HandleStreamEventParams): void {
  resetWatchdog()

  switch (event.type) {
    case 'TextDelta': {
      streamState.pendingTextDelta += event.delta
      const phaseMatch = streamState.pendingTextDelta.match(/\[PHASE:(\d+)\/(\d+)\s+([^\]]+)\]/)
      if (phaseMatch) {
        currentPhase.value = {
          current: Number(phaseMatch[1]),
          total: Number(phaseMatch[2]),
          label: phaseMatch[3]!.trim(),
        }
      }
      scheduleFlush()
      break
    }

    case 'ThinkingDelta':
      streamState.pendingThinkingDelta += event.delta
      scheduleFlush()
      break

    case 'Usage':
      updateStreamingMessage(msg => ({
        ...msg,
        promptTokens: event.prompt_tokens,
        completionTokens: event.completion_tokens,
        cacheReadTokens: event.cache_read_tokens ?? 0,
        totalTokens: event.prompt_tokens + event.completion_tokens,
        tokens: event.prompt_tokens + event.completion_tokens,
      }))
      break

    case 'Done': {
      flushPendingDelta()
      streamState.lastFinishReason = event.finish_reason
      log.info('stream_done', {
        sessionId,
        finishReason: event.finish_reason,
        pendingToolCalls: streamState.pendingToolCalls.length,
      })

      if (planGateEnabled.value && !planApproved.value && streamState.pendingToolCalls.length === 0) {
        const streamingMsg = messages.value.find(message => message.id === streamState.streamingMessageId)
        if (streamingMsg?.content) {
          pendingPlan.value = streamingMsg.content
          awaitingPlanApproval.value = true
        }
      }
      break
    }

    case 'Error':
      flushPendingDelta()
      error.value = event.message
      if (!event.retryable) {
        updateStreamingMessage(msg => ({
          ...msg,
          content: msg.content + `\n\n[错误] ${event.message}`,
        }))
      }
      break

    case 'ToolCall': {
      const existing = streamState.pendingToolCalls.find(toolCall => toolCall.id === event.id)
      if (existing) {
        existing.name = event.name
        existing.arguments = event.arguments
        existing.parsedArgs = tryParseJson(event.arguments)
        existing.status = 'pending'
        existing.streamingChars = undefined
        existing.streamingIndex = undefined
      } else {
        streamState.pendingToolCalls.push(reactive({
          id: event.id,
          name: event.name,
          arguments: event.arguments,
          parsedArgs: tryParseJson(event.arguments),
          status: 'pending',
        }) as ToolCallInfo)
      }

      updateStreamingMessage(msg => ({
        ...msg,
        toolCalls: [...streamState.pendingToolCalls],
      }))
      break
    }

    case 'ToolCallDelta': {
      let existing = streamState.pendingToolCalls.find(toolCall => toolCall.streamingIndex === event.index)
      if (!existing && event.id && event.name) {
        existing = reactive({
          id: event.id,
          name: event.name,
          arguments: '',
          status: 'streaming',
          streamingChars: 0,
          streamingIndex: event.index,
        }) as ToolCallInfo
        streamState.pendingToolCalls.push(existing)
        updateStreamingMessage(msg => ({
          ...msg,
          toolCalls: [...streamState.pendingToolCalls],
        }))
      }

      if (existing) {
        existing.arguments += event.arguments_delta
        existing.streamingChars = existing.arguments.length
      }
      break
    }
  }
}
