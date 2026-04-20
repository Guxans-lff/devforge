import { aiChatStream, aiSaveMessage, type ChatMessage } from '@/api/ai'
import type { AiMessage, AiMessageRecord, AiStreamEvent, ModelConfig, ProviderConfig, ToolCallInfo, ToolResultInfo } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { genId, thinkingEffortToBudget } from './chatHelpers'
import type { AiChatStreamState } from './chatStreamEvents'

export interface StreamWithToolLoopParams {
  sid: string
  chatMessages: ChatMessage[]
  provider: ProviderConfig
  model: ModelConfig
  apiKey: string
  systemPrompt?: string
  enableTools: boolean
  log: Logger
  messages: { value: AiMessage[] }
  isStreaming: { value: boolean }
  workDir: { value: string }
  streamState: AiChatStreamState
  maxToolLoops: number
  resetWatchdog: () => void
  clearWatchdog: () => void
  flushPendingDelta: () => void
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
  onStreamEvent: (event: AiStreamEvent) => void
  executeToolCalls: (toolCalls: ToolCallInfo[], sessionId: string) => Promise<ToolResultInfo[]>
  parseAndWriteJournalSections: (text: string, workDirPath: string) => void
  parseSpawnedTasks: (text: string) => void
}

export async function streamWithToolLoop({
  sid,
  chatMessages,
  provider,
  model,
  apiKey,
  systemPrompt,
  enableTools,
  log,
  messages,
  isStreaming,
  workDir,
  streamState,
  maxToolLoops,
  resetWatchdog,
  clearWatchdog,
  flushPendingDelta,
  updateStreamingMessage,
  onStreamEvent,
  executeToolCalls,
  parseAndWriteJournalSections,
  parseSpawnedTasks,
}: StreamWithToolLoopParams): Promise<void> {
  let loopCount = 0
  log.info('stream_start', { sessionId: sid, model: model.id, enableTools, msgCount: chatMessages.length })

  const disableAnthropicThinkingForToolLoop = provider.providerType === 'anthropic' && enableTools

  while (loopCount <= maxToolLoops) {
    streamState.streamingMessageId = genId()
    streamState.pendingToolCalls = []
    streamState.lastFinishReason = ''
    streamState.pendingTextDelta = ''
    streamState.pendingThinkingDelta = ''

    const assistantMessage: AiMessage = {
      id: streamState.streamingMessageId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      isStreaming: true,
      toolCalls: [],
    }
    messages.value = [...messages.value, assistantMessage]

    resetWatchdog()
    await aiChatStream(
      {
        sessionId: sid,
        messages: chatMessages,
        providerType: provider.providerType,
        model: model.id,
        apiKey,
        endpoint: provider.endpoint,
        maxTokens: model.capabilities.maxOutput > 0 ? model.capabilities.maxOutput : undefined,
        systemPrompt,
        enableTools,
        thinkingBudget: model.capabilities.thinking && !disableAnthropicThinkingForToolLoop
          ? thinkingEffortToBudget(model.thinkingEffort)
          : undefined,
      },
      onStreamEvent,
    )
    clearWatchdog()
    flushPendingDelta()

    const hasCompleteToolCalls =
      streamState.lastFinishReason === 'tool_calls' && streamState.pendingToolCalls.length > 0

    const finalMessageCheck = messages.value.find(message => message.id === streamState.streamingMessageId)
    if (finalMessageCheck && finalMessageCheck.role === 'assistant') {
      const noContent = !finalMessageCheck.content || finalMessageCheck.content.trim() === ''
      const noToolCalls = !hasCompleteToolCalls
      if (noContent && noToolCalls) {
        const hasThinking = !!(finalMessageCheck.thinking && finalMessageCheck.thinking.trim())
        let errMsg: string
        if (streamState.lastFinishReason === 'length') {
          errMsg = `[输出被 max_tokens 截断] 模型 thinking 耗尽了输出预算（${model.capabilities.maxOutput} token）还没开始写正文。请在 Provider 设置里调大该模型的“最大输出”（建议 >= 16384），或换非 reasoning 模型。`
        } else if (hasThinking) {
          errMsg = `[模型 thinking 后 stop 空回] finish_reason=${streamState.lastFinishReason}。MiMo / DeepSeek-R 系在 tool 循环第 2 轮常见此问题，尝试：1) 换模型测试 2) 在 Provider 里关闭该模型的 thinking 能力标志 3) 调大 max_tokens。`
        } else {
          errMsg = `[模型未生成回复] finish_reason=${streamState.lastFinishReason}。可能因异常中断或服务端问题。`
        }

        log.warn('empty_assistant_converted_to_error', {
          sessionId: sid,
          finishReason: streamState.lastFinishReason,
          hasThinking,
          maxOutput: model.capabilities.maxOutput,
        })

        messages.value = messages.value.map(message =>
          message.id === streamState.streamingMessageId
            ? { ...message, role: 'error' as const, content: errMsg, isStreaming: false }
            : message,
        )
      }
    }

    const finalMessage = messages.value.find(message => message.id === streamState.streamingMessageId)
    if (finalMessage && finalMessage.role === 'assistant') {
      const hasToolCalls = hasCompleteToolCalls
      const assistantRecord: AiMessageRecord = {
        id: finalMessage.id,
        sessionId: sid,
        role: 'assistant',
        content: hasToolCalls ? JSON.stringify(streamState.pendingToolCalls) : finalMessage.content,
        contentType: hasToolCalls ? 'tool_calls' : 'text',
        tokens: finalMessage.totalTokens ?? finalMessage.tokens ?? 0,
        cost: 0,
        createdAt: finalMessage.timestamp,
      }

      aiSaveMessage(assistantRecord).catch(error => {
        log.warn('save_assistant_msg_failed', { sessionId: sid }, error)
        const idx = messages.value.findIndex(message => message.id === finalMessage.id)
        if (idx !== -1) {
          messages.value[idx] = { ...messages.value[idx]!, saveStatus: 'error' }
        }
      })
    }

    if (streamState.lastFinishReason !== 'tool_calls' || streamState.pendingToolCalls.length === 0) {
      if (workDir.value) {
        const latestAssistant = messages.value.find(message => message.id === streamState.streamingMessageId)
        if (latestAssistant?.content) {
          parseAndWriteJournalSections(latestAssistant.content, workDir.value)
          parseSpawnedTasks(latestAssistant.content)
        }
      }
      break
    }

    loopCount++
    log.info('tool_loop', { sessionId: sid, loopCount, toolCount: streamState.pendingToolCalls.length })
    if (loopCount > maxToolLoops) {
      log.warn('tool_loop_exceeded', { sessionId: sid, max: maxToolLoops })
      updateStreamingMessage(message => ({
        ...message,
        notice: { kind: 'warn', text: `已达到工具调用上限 ${maxToolLoops} 次，本轮停止。可继续发消息让 AI 接着干。` },
        isStreaming: false,
      }))
      break
    }

    if (!isStreaming.value) break

    updateStreamingMessage(message => ({ ...message, isStreaming: false }))

    log.info('tool_exec_start', { sessionId: sid, tools: streamState.pendingToolCalls.map(tool => tool.name) })
    const toolResults = await executeToolCalls(streamState.pendingToolCalls, sid)
    log.info('tool_exec_done', {
      sessionId: sid,
      resultCount: toolResults.length,
      results: toolResults.map(result => ({
        id: result.toolCallId,
        name: result.toolName,
        len: result.content.length,
      })),
    })

    updateStreamingMessage(message => ({
      ...message,
      toolCalls: streamState.pendingToolCalls,
      toolResults,
    }))

    const assistantTurnMessage: ChatMessage = {
      role: 'assistant',
      content: finalMessage?.content || null,
      toolCalls: streamState.pendingToolCalls.map(toolCall => ({
        id: toolCall.id,
        type: 'function',
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    }
    if (finalMessage?.thinking && finalMessage.thinking.trim()) {
      assistantTurnMessage.reasoningContent = finalMessage.thinking
    }
    chatMessages.push(assistantTurnMessage)

    for (const result of toolResults) {
      chatMessages.push({
        role: 'tool',
        content: result.content,
        toolCallId: result.toolCallId,
        name: result.toolName,
      })

      const toolRecord: AiMessageRecord = {
        id: genId(),
        sessionId: sid,
        role: 'tool',
        content: result.content,
        contentType: 'tool_result',
        tokens: 0,
        cost: 0,
        parentId: result.toolCallId,
        success: result.success,
        toolName: result.toolName,
        createdAt: Date.now(),
      }
      aiSaveMessage(toolRecord).catch(error => log.warn('save_tool_msg_failed', { sessionId: sid }, error))
    }

    streamState.streamingMessageId = ''
    log.info('tool_loop_next', { sessionId: sid, loopCount, newMsgCount: chatMessages.length })
  }
}
