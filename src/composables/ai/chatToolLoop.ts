import { aiSaveMessage, type ChatMessage } from '@/api/ai'
import { executeGatewayRequest } from '@/ai-gateway/AiGateway'
import type { FallbackCandidate } from '@/ai-gateway/router'
import type { AiMessage, AiMessageRecord, AiStreamEvent, ModelConfig, ProviderConfig, ToolCallInfo, ToolResultInfo } from '@/types/ai'
import type { Logger } from '@/utils/logger'
import { genId, hashArgs, resolveRequestMaxTokens, thinkingEffortToBudget } from './chatHelpers'
import type { AiChatStreamState } from './chatStreamEvents'

export interface StreamWithToolLoopParams {
  sid: string
  chatMessages: ChatMessage[]
  provider: ProviderConfig
  model: ModelConfig
  apiKey: string
  apiKeysByProvider?: Record<string, string | undefined>
  fallbackChain?: FallbackCandidate[]
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
  onRequestStart?: () => void
  signal?: AbortSignal
  executeToolCalls: (toolCalls: ToolCallInfo[], sessionId: string) => Promise<ToolResultInfo[]>
  parseAndWriteJournalSections: (text: string, workDirPath: string) => void
  parseSpawnedTasks: (text: string) => void
  requestOptions?: {
    responseFormat?: 'json_object'
    prefixCompletion?: boolean
    prefixContent?: string
  }
}

const MAX_CONSECUTIVE_EXPLORATORY_TOOL_ONLY_TURNS = 5
const EXPLORATORY_TOOL_NAMES = new Set([
  'read_file',
  'read_tool_result',
  'list_files',
  'list_directory',
  'search_files',
])
const EXPLORATORY_TOOL_SYNTHESIS_PROMPT = [
  '[系统收敛指令]',
  '你已经连续多轮只调用读取/搜索工具但没有输出正文。',
  '现在不要再调用任何工具，也不要继续探索文件。',
  '请只基于上面已经返回的工具结果，直接用中文回答用户：',
  '1. 已确认的信息；',
  '2. 当前结论；',
  '3. 还缺什么信息或需要用户确认什么；',
  '4. 如果任务可以继续，给出下一步执行建议。',
].join('\n')
const SYNTHESIS_TOOL_RESULT_MAX_CHARS = 12_000
const SYNTHESIS_TOOL_RESULT_ITEM_CHARS = 2_000

export async function streamWithToolLoop({
  sid,
  chatMessages,
  provider,
  model,
  apiKey,
  apiKeysByProvider,
  fallbackChain,
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
  onRequestStart,
  signal,
  executeToolCalls,
  parseAndWriteJournalSections,
  parseSpawnedTasks,
  requestOptions,
}: StreamWithToolLoopParams): Promise<void> {
  let loopCount = 0
  let lastExecutedToolSignature = ''
  let lastExecutedResultSignature = ''
  let repeatedExecutionStreak = 0
  let consecutiveExploratoryToolOnlyTurns = 0
  let forceSynthesisWithoutTools = false
  let exploratoryToolResultBuffer: ToolResultInfo[] = []
  log.info('stream_start', { sessionId: sid, model: model.id, enableTools, msgCount: chatMessages.length })

  while (loopCount <= maxToolLoops) {
    const currentEnableTools = enableTools && !forceSynthesisWithoutTools
    const disableAnthropicThinkingForToolLoop = provider.providerType === 'anthropic' && currentEnableTools

    streamState.streamingMessageId = genId()
    streamState.pendingToolCalls = []
    streamState.lastFinishReason = ''
    streamState.lastErrorRetryable = undefined
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
    onRequestStart?.()
    await executeGatewayRequest(
      {
        sessionId: sid,
        messages: chatMessages,
        provider,
        model,
        apiKey,
        apiKeysByProvider,
        fallbackChain,
        maxTokens: resolveRequestMaxTokens(model, { enableTools: currentEnableTools }),
        systemPrompt,
        enableTools: currentEnableTools,
        source: 'chat',
        kind: 'chat_completions',
        signal,
        thinkingBudget: model.capabilities.thinking && !disableAnthropicThinkingForToolLoop
          ? thinkingEffortToBudget(model.thinkingEffort)
          : undefined,
        responseFormat: requestOptions?.responseFormat,
        prefixCompletion: requestOptions?.prefixCompletion,
        prefixContent: requestOptions?.prefixContent,
      },
      onStreamEvent,
    )
    clearWatchdog()
    flushPendingDelta()

    const validToolCalls = streamState.pendingToolCalls.filter(toolCall =>
      !!toolCall.parsedArgs && typeof toolCall.parsedArgs === 'object' && !Array.isArray(toolCall.parsedArgs),
    )
    const currentToolSignature = buildToolCallSignature(validToolCalls)
    const hasCompleteToolCalls =
      streamState.lastFinishReason === 'tool_calls' && validToolCalls.length > 0

    const finalMessageCheck = messages.value.find(message => message.id === streamState.streamingMessageId)
    if (finalMessageCheck && finalMessageCheck.role === 'assistant') {
      const noContent = !finalMessageCheck.content || finalMessageCheck.content.trim() === ''
      const noToolCalls = !hasCompleteToolCalls
      const hasInvalidToolCalls =
        streamState.lastFinishReason === 'tool_calls'
        && streamState.pendingToolCalls.length !== validToolCalls.length
      if (hasInvalidToolCalls) {
        const errMsg = '[工具调用参数不完整] 模型输出了不完整的工具参数 JSON，本轮已中止，避免执行半成品工具调用。请重试，或要求模型重新整理后再调用工具。'
        log.warn('invalid_tool_call_filtered', {
          sessionId: sid,
          totalToolCalls: streamState.pendingToolCalls.length,
          validToolCalls: validToolCalls.length,
        })
        messages.value = messages.value.map(message =>
          message.id === streamState.streamingMessageId
            ? { ...message, role: 'error' as const, content: errMsg, isStreaming: false }
            : message,
        )
        streamState.pendingToolCalls = []
      } else if (noContent && noToolCalls) {
        const hasThinking = !!(finalMessageCheck.thinking && finalMessageCheck.thinking.trim())
        let errMsg: string
        if (streamState.lastFinishReason === 'length') {
          errMsg = `[输出被 max_tokens 截断] 模型 thinking 耗尽了输出预算（${model.capabilities.maxOutput} token）还没开始写正文。请在 Provider 设置里调大该模型的“最大输出”（建议 >= 16384），或换非 reasoning 模型。`
        } else if (hasThinking) {
          errMsg = `[模型 thinking 后 stop 空回] finish_reason=${streamState.lastFinishReason}。本轮未产出正文，已安全停止。可点击“继续生成”恢复，或切换非 thinking 模型 / 调大 max_tokens 后重试。`
        } else {
          errMsg = `[模型未生成回答] finish_reason=${streamState.lastFinishReason}。可能因异常中断或服务端问题。本轮已安全停止，可点击“继续生成”恢复。`
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
    const canContinueToolLoop =
      finalMessage?.role === 'assistant'
      && streamState.lastFinishReason === 'tool_calls'
      && validToolCalls.length > 0
    let shouldTrackExploratoryToolResults = false
    let shouldSynthesizeAfterToolResults = false

    if (forceSynthesisWithoutTools && canContinueToolLoop) {
      log.warn('tool_loop_synthesis_ignored_no_tools', {
        sessionId: sid,
        tools: validToolCalls.map(toolCall => toolCall.name),
      })
      updateStreamingMessage(message => ({
        ...message,
        role: 'assistant',
        content: '已停止继续调用工具。模型在总结模式下仍尝试调用工具，本轮已安全结束；请直接追问我基于已有结果总结。',
        notice: {
          kind: 'warn',
          code: 'runtime_warning',
          title: '模型未按总结模式输出',
          text: '系统已禁用工具并要求直接总结，但模型仍尝试继续调用工具。为避免再次空转，本轮已停止。',
          actionHint: '可以发送“直接总结已有结果”，系统会基于当前上下文继续。',
        },
        isStreaming: false,
        toolCalls: [],
      }))
      streamState.pendingToolCalls = []
      break
    }

    if (canContinueToolLoop) {
      const hasAssistantText = !!finalMessage.content?.trim()
      const isExploratoryOnly = validToolCalls.every(toolCall => EXPLORATORY_TOOL_NAMES.has(toolCall.name))

      if (!hasAssistantText && isExploratoryOnly) {
        consecutiveExploratoryToolOnlyTurns += 1
        shouldTrackExploratoryToolResults = true
      } else {
        consecutiveExploratoryToolOnlyTurns = 0
        exploratoryToolResultBuffer = []
      }

      if (consecutiveExploratoryToolOnlyTurns >= MAX_CONSECUTIVE_EXPLORATORY_TOOL_ONLY_TURNS) {
        shouldSynthesizeAfterToolResults = true
        log.warn('tool_loop_exploratory_tool_only_synthesis', {
          sessionId: sid,
          count: consecutiveExploratoryToolOnlyTurns,
          tools: validToolCalls.map(toolCall => toolCall.name),
        })
      }
    } else {
      consecutiveExploratoryToolOnlyTurns = 0
      forceSynthesisWithoutTools = false
      exploratoryToolResultBuffer = []
    }

    if (finalMessage && finalMessage.role === 'assistant') {
      const hasToolCalls = hasCompleteToolCalls
      const assistantRecord: AiMessageRecord = {
        id: finalMessage.id,
        sessionId: sid,
        role: 'assistant',
        content: hasToolCalls ? JSON.stringify(validToolCalls) : finalMessage.content,
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

    if (!canContinueToolLoop) {
      repeatedExecutionStreak = 0
      lastExecutedToolSignature = ''
      lastExecutedResultSignature = ''
      if (workDir.value) {
        const latestAssistant = messages.value.find(message => message.id === streamState.streamingMessageId)
        if (latestAssistant?.role === 'assistant' && latestAssistant.content) {
          parseAndWriteJournalSections(latestAssistant.content, workDir.value)
          parseSpawnedTasks(latestAssistant.content)
        }
      }
      break
    }

    if (
      repeatedExecutionStreak >= 1
      && currentToolSignature
      && currentToolSignature === lastExecutedToolSignature
    ) {
      const errMsg = '[工具循环疑似卡住] 模型连续两轮输出了相同的工具调用，且先前工具结果未变化。为避免空转，本轮已中止。请重试，或调整提示词/工具返回格式。'
      log.warn('tool_loop_repeated_signature', {
        sessionId: sid,
        toolSignature: currentToolSignature,
        repeatedExecutionStreak,
      })
      updateStreamingMessage(message => ({
        ...message,
        role: 'error',
        content: errMsg,
        isStreaming: false,
        toolCalls: validToolCalls,
      }))
      break
    }

    loopCount++
    log.info('tool_loop', { sessionId: sid, loopCount, toolCount: validToolCalls.length })
    if (loopCount > maxToolLoops) {
      log.warn('tool_loop_exceeded', { sessionId: sid, max: maxToolLoops })
      updateStreamingMessage(message => ({
        ...message,
        notice: {
          kind: 'warn',
          code: 'tool_loop_limit',
          title: 'AI 已暂停继续探索',
          text: `本轮已经连续执行 ${maxToolLoops} 轮工具操作。为避免模型反复搜索或修改同一批内容，系统已先暂停。`,
          actionHint: '如果结果已经够用，可以让 AI 总结当前结论；如果还需要继续，直接发送“继续”即可基于当前结果接着执行。',
        },
        isStreaming: false,
      }))
      break
    }

    if (!isStreaming.value) break

    updateStreamingMessage(message => ({ ...message, isStreaming: false }))

    log.info('tool_exec_start', { sessionId: sid, tools: validToolCalls.map(tool => tool.name) })
    const toolResults = await executeToolCalls(validToolCalls, sid)
    const currentResultSignature = buildToolResultSignature(toolResults)
    log.info('tool_exec_done', {
      sessionId: sid,
      resultCount: toolResults.length,
      results: toolResults.map(result => ({
        id: result.toolCallId,
        name: result.toolName,
        len: result.content.length,
      })),
    })

    if (toolResults.length < validToolCalls.length) {
      const errMsg = `[工具执行结果缺失] 预期 ${validToolCalls.length} 个工具结果，但只收到 ${toolResults.length} 个。为避免 tool loop 空转或协议失配，本轮已中止。请重试。`
      log.warn('tool_result_missing', {
        sessionId: sid,
        expectedResults: validToolCalls.length,
        actualResults: toolResults.length,
      })
      updateStreamingMessage(message => ({
        ...message,
        role: 'error',
        content: errMsg,
        isStreaming: false,
        toolCalls: validToolCalls,
        toolResults,
      }))
      break
    }

    updateStreamingMessage(message => ({
      ...message,
      toolCalls: validToolCalls,
      toolResults,
    }))
    if (shouldTrackExploratoryToolResults) {
      exploratoryToolResultBuffer = [...exploratoryToolResultBuffer, ...toolResults].slice(-12)
    }

    if (
      currentToolSignature
      && currentToolSignature === lastExecutedToolSignature
      && currentResultSignature === lastExecutedResultSignature
    ) {
      repeatedExecutionStreak += 1
    } else {
      repeatedExecutionStreak = 0
    }
    lastExecutedToolSignature = currentToolSignature
    lastExecutedResultSignature = currentResultSignature

    const assistantTurnMessage: ChatMessage = {
      role: 'assistant',
      content: finalMessage?.content || null,
      toolCalls: validToolCalls.map(toolCall => ({
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

    if (shouldSynthesizeAfterToolResults) {
      const synthesisPrompt = buildExploratoryToolSynthesisPrompt(exploratoryToolResultBuffer)
      updateStreamingMessage(message => ({
        ...message,
        content: '已读取到足够上下文，正在基于已有工具结果整理结论。',
        notice: {
          kind: 'info',
          code: 'runtime_warning',
          title: '已自动停止继续探索',
          text: `模型连续 ${consecutiveExploratoryToolOnlyTurns} 轮只读取/搜索但没有输出正文。系统已切换为总结模式，避免继续空转。`,
          actionHint: '下一条回复会基于已有工具结果直接总结，不再继续调用读取/搜索工具。',
        },
        isStreaming: false,
      }))
      chatMessages.push({
        role: 'user',
        content: synthesisPrompt,
      })
      streamState.pendingToolCalls = []
      streamState.streamingMessageId = ''
      consecutiveExploratoryToolOnlyTurns = 0
      repeatedExecutionStreak = 0
      lastExecutedToolSignature = ''
      lastExecutedResultSignature = ''
      forceSynthesisWithoutTools = true
      log.info('tool_loop_synthesis_next', { sessionId: sid, newMsgCount: chatMessages.length })
      continue
    }

    streamState.streamingMessageId = ''
    log.info('tool_loop_next', { sessionId: sid, loopCount, newMsgCount: chatMessages.length })
  }
}

function buildExploratoryToolSynthesisPrompt(toolResults: ToolResultInfo[]): string {
  let remainingChars = SYNTHESIS_TOOL_RESULT_MAX_CHARS
  const sections: string[] = []

  for (const [index, result] of toolResults.entries()) {
    if (remainingChars <= 0) break
    const rawContent = result.content.trim()
    const content = rawContent.length > SYNTHESIS_TOOL_RESULT_ITEM_CHARS
      ? `${rawContent.slice(0, SYNTHESIS_TOOL_RESULT_ITEM_CHARS)}\n……该工具结果已截断……`
      : rawContent
    const section = [
      `### 工具结果 ${index + 1}: ${result.toolName}（${result.success ? '成功' : '失败'}）`,
      content || '（空结果）',
    ].join('\n')
    if (section.length > remainingChars) {
      sections.push(section.slice(0, remainingChars))
      break
    }
    sections.push(section)
    remainingChars -= section.length
  }

  const resultSummary = sections.length
    ? sections.join('\n\n')
    : '没有可用工具结果。'

  return [
    EXPLORATORY_TOOL_SYNTHESIS_PROMPT,
    '',
    '[已有工具结果摘要]',
    resultSummary,
    '',
    '请直接输出面向用户的正文，不要提到“系统收敛指令”或内部工具循环。'
  ].join('\n')
}

function buildToolCallSignature(toolCalls: ToolCallInfo[]): string {
  return toolCalls
    .map(toolCall => `${toolCall.name}:${toolCall.arguments.length}:${hashArgs(toolCall.arguments)}`)
    .join('|')
}

function buildToolResultSignature(toolResults: ToolResultInfo[]): string {
  return toolResults
    .map(result => `${result.toolName}:${result.success ? 'ok' : 'err'}:${result.content.length}:${hashArgs(result.content)}`)
    .join('|')
}
