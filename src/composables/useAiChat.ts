/**
 * AI 对话核心 composable
 *
 * 管理单个会话的消息列表、流式发送/接收、中断控制、
 * 50ms 节流批量 DOM 更新、自动滚动等。
 */

import { ref, computed, nextTick, onUnmounted, toRef, type MaybeRef } from 'vue'
import type { Ref } from 'vue'
import type {
  AiMessage,
  AiStreamEvent,
  AiMessageRecord,
  AiSession,
  ModelConfig,
  ProviderConfig,
  FileAttachment,
  ToolCallInfo,
  ToolResultInfo,
} from '@/types/ai'
import { aiChatStream, aiAbortStream, aiSaveMessage, aiGetSession, aiExecuteTool } from '@/api/ai'
import { useAiChatStore } from '@/stores/ai-chat'
import { ensureErrorString } from '@/types/error'
import { buildFileMarkedContent } from '@/utils/file-markers'
import type { ChatMessage } from '@/api/ai'

/** 生成唯一 ID */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 安全解析 JSON */
function tryParseJson(str: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(str)
  } catch {
    return undefined
  }
}

/**
 * 从 AiMessage 列表构建完整的 ChatMessage 链
 *
 * 包含 user / assistant（携带 toolCalls）/ tool 消息，
 * 确保 API 看到完整的工具调用上下文。
 */
function buildChatMessages(msgs: AiMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []

  for (const msg of msgs) {
    if (msg.role === 'error') continue

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      const chatMsg: ChatMessage = {
        role: 'assistant',
        content: msg.content || null,
      }

      // 携带 toolCalls（如果有）
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        chatMsg.toolCalls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }))
      }

      result.push(chatMsg)

      // 展开 toolResults 为独立的 tool 消息
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          result.push({
            role: 'tool',
            content: tr.content,
            toolCallId: tr.toolCallId,
          })
        }
      }
    }
  }

  return result
}

export interface UseAiChatOptions {
  /** 会话 ID（支持响应式） */
  sessionId: MaybeRef<string>
  /** 滚动容器 ref（用于自动滚动） */
  scrollContainer?: Ref<HTMLElement | null>
}

export function useAiChat(options: UseAiChatOptions) {
  const sessionIdRef = toRef(options.sessionId)
  const aiStore = useAiChatStore()

  // ─────────────────────── 状态 ───────────────────────

  const messages = ref<AiMessage[]>([])
  const isStreaming = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  /** 用户是否手动滚动（暂停自动滚动） */
  const userScrolled = ref(false)

  /** 当前流式消息的累积文本（节流缓冲） */
  let pendingTextDelta = ''
  let pendingThinkingDelta = ''
  let throttleTimer: ReturnType<typeof setTimeout> | null = null

  /** 当前流式助手消息的 ID */
  let streamingMessageId = ''

  /** 工作目录（Tool Use 安全边界） */
  const workDir = ref('')

  /** Tool Use 循环最大次数 */
  const MAX_TOOL_LOOPS = 10

  /** 流式期间收集的 ToolCall 事件 */
  let pendingToolCalls: ToolCallInfo[] = []
  /** 流式结束原因 */
  let lastFinishReason = ''

  // ─────────────────────── 计算属性 ───────────────────────

  /** 总 token 数 */
  const totalTokens = computed(() =>
    messages.value.reduce((sum, m) => sum + (m.tokens ?? 0), 0),
  )

  /** 是否可以发送（非流式 + 非加载中） */
  const canSend = computed(() => !isStreaming.value && !isLoading.value)

  // ─────────────────────── 加载历史消息 ───────────────────────

  /** 从后端加载会话历史消息（可传入指定 sessionId，解决响应式延迟问题） */
  async function loadHistory(overrideSessionId?: string): Promise<void> {
    // 先清理流式状态，防止从正在流式的会话切换过来时出现数据混乱
    if (isStreaming.value) {
      isStreaming.value = false
      streamingMessageId = ''
      pendingTextDelta = ''
      pendingThinkingDelta = ''
      if (throttleTimer) {
        clearTimeout(throttleTimer)
        throttleTimer = null
      }
    }

    const sid = overrideSessionId ?? sessionIdRef.value
    isLoading.value = true
    error.value = null
    try {
      const result = await aiGetSession(sid)
      if (!result) {
        messages.value = []
        return
      }

      const [session, records] = result
      // 恢复工作目录
      if (session.workDir) {
        workDir.value = session.workDir
      }

      // 还原消息链（处理 tool_calls / tool_result 类型）
      const restored: AiMessage[] = []
      for (const r of records) {
        if (r.role === 'assistant' && r.contentType === 'tool_calls') {
          // assistant 消息携带 tool_calls，content 是 ToolCallInfo[] JSON
          const toolCalls: ToolCallInfo[] = tryParseJson(r.content) as ToolCallInfo[] ?? []
          restored.push({
            id: r.id,
            role: 'assistant',
            content: '',
            timestamp: r.createdAt,
            tokens: r.tokens,
            toolCalls,
            toolResults: [],
          })
        } else if (r.role === 'tool' && r.contentType === 'tool_result') {
          // tool 结果消息 → 附加到最近的 assistant 消息的 toolResults
          const lastAssistant = [...restored].reverse().find(
            m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0,
          )
          if (lastAssistant) {
            // 找到对应的 toolCall 获取 toolCallId
            const matchedTc = lastAssistant.toolCalls?.find(tc => {
              // 按名称和顺序匹配（tool 消息无 toolCallId 字段存储）
              return !lastAssistant.toolResults?.some(tr => tr.toolCallId === tc.id)
            })
            if (!lastAssistant.toolResults) lastAssistant.toolResults = []
            lastAssistant.toolResults.push({
              toolCallId: matchedTc?.id ?? r.id,
              toolName: matchedTc?.name ?? 'unknown',
              success: !r.content.startsWith('工具执行异常'),
              content: r.content,
            })
            // 更新对应 toolCall 的状态和结果
            if (matchedTc) {
              matchedTc.status = r.content.startsWith('工具执行异常') ? 'error' : 'success'
              matchedTc.result = r.content
              matchedTc.parsedArgs = matchedTc.parsedArgs ?? tryParseJson(matchedTc.arguments)
            }
          }
          // tool 消息不单独显示在列表中（已内嵌到 assistant）
        } else {
          // 普通 user / assistant / error 消息
          restored.push({
            id: r.id,
            role: r.role as AiMessage['role'],
            content: r.content,
            timestamp: r.createdAt,
            tokens: r.tokens,
          })
        }
      }
      messages.value = restored
    } catch (e) {
      error.value = ensureErrorString(e)
    } finally {
      isLoading.value = false
    }
  }

  // ─────────────────────── 发送消息 ───────────────────────

  /**
   * 发送消息并开始流式接收
   *
   * @param content 用户输入文本
   * @param provider Provider 配置
   * @param model 模型配置
   * @param apiKey API Key
   * @param systemPrompt 系统提示词
   * @param attachments 文件附件列表（可选）
   */
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
      error.value = '会话 ID 无效'
      return
    }
    error.value = null

    // 构建最终消息内容（拼接文件标签）
    const readyFiles = (attachments ?? []).filter(f => f.status === 'ready' && f.content)
    const finalContent = readyFiles.length > 0
      ? buildFileMarkedContent(content.trim(), readyFiles.map(f => ({
          name: f.name,
          path: f.path,
          size: f.size,
          content: f.content!,
          lines: f.lines ?? 0,
        })))
      : content.trim()

    // 判断 contentType
    const contentType = readyFiles.length > 0 ? 'text_with_files' : 'text'

    // 是否启用 Tool Use（模型支持 + 有工作目录）
    const enableTools = model.capabilities.toolUse && !!workDir.value

    // 1. 添加用户消息到列表
    const userMsg: AiMessage = {
      id: genId(),
      role: 'user',
      content: finalContent,
      timestamp: Date.now(),
    }
    messages.value = [...messages.value, userMsg]

    // 持久化用户消息
    const userRecord: AiMessageRecord = {
      id: userMsg.id,
      sessionId: sid,
      role: 'user',
      content: finalContent,
      contentType,
      tokens: 0,
      cost: 0,
      createdAt: userMsg.timestamp,
    }
    aiSaveMessage(userRecord).catch(e => console.warn('[AI] 保存用户消息失败:', e))

    // 2. 构建发送给 API 的消息列表（包含 tool 消息链）
    const chatMessages: ChatMessage[] = buildChatMessages(messages.value)

    // 3. 开始流式对话（可能包含 Tool Use 循环）
    isStreaming.value = true
    userScrolled.value = false

    try {
      await streamWithToolLoop(
        sid, chatMessages, provider, model, apiKey, systemPrompt, enableTools,
      )
    } catch (e) {
      const errMsg = ensureErrorString(e)
      error.value = errMsg
      // 如果有正在流式的消息，标记为错误
      if (streamingMessageId) {
        updateStreamingMessage(msg => ({
          ...msg,
          role: 'error' as const,
          content: errMsg,
          isStreaming: false,
        }))
      }
    } finally {
      if (streamingMessageId) {
        updateStreamingMessage(msg => ({ ...msg, isStreaming: false }))
      }
      isStreaming.value = false
      streamingMessageId = ''

      // 更新会话统计
      const now = Date.now()
      const session: AiSession = {
        id: sid,
        title: messages.value.find(m => m.role === 'user')?.content.slice(0, 50) ?? '新对话',
        providerId: provider.id,
        model: model.id,
        systemPrompt,
        messageCount: messages.value.filter(m => m.role !== 'error').length,
        totalTokens: totalTokens.value,
        estimatedCost: 0,
        createdAt: messages.value[0]?.timestamp ?? now,
        updatedAt: now,
        workDir: workDir.value || undefined,
      }
      aiStore.saveSession(session).catch(e => console.warn('[AI] 保存会话失败:', e))
    }
  }

  // ─────────────────────── Tool Use 循环 ───────────────────────

  /**
   * 流式对话 + Tool Use 自动循环
   *
   * 当 AI 返回 finish_reason === 'tool_calls' 时，执行工具并将结果追加到消息链，重新调用 AI。
   * 最多循环 MAX_TOOL_LOOPS 次。
   */
  async function streamWithToolLoop(
    sid: string,
    chatMessages: ChatMessage[],
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt: string | undefined,
    enableTools: boolean,
  ): Promise<void> {
    let loopCount = 0

    while (loopCount <= MAX_TOOL_LOOPS) {
      // 创建助手占位消息
      streamingMessageId = genId()
      pendingToolCalls = []
      lastFinishReason = ''
      pendingTextDelta = ''
      pendingThinkingDelta = ''

      const assistantMsg: AiMessage = {
        id: streamingMessageId,
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: Date.now(),
        isStreaming: true,
        toolCalls: [],
      }
      messages.value = [...messages.value, assistantMsg]

      // 流式对话
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
        },
        (event: AiStreamEvent) => handleStreamEvent(event),
      )

      // 刷新最后的缓冲
      flushPendingDelta()

      // 持久化助手消息
      const finalMsg = messages.value.find(m => m.id === streamingMessageId)
      if (finalMsg) {
        const hasToolCalls = pendingToolCalls.length > 0
        const assistantRecord: AiMessageRecord = {
          id: finalMsg.id,
          sessionId: sid,
          role: 'assistant',
          content: hasToolCalls ? JSON.stringify(pendingToolCalls) : finalMsg.content,
          contentType: hasToolCalls ? 'tool_calls' : 'text',
          tokens: finalMsg.tokens ?? 0,
          cost: 0,
          createdAt: finalMsg.timestamp,
        }
        aiSaveMessage(assistantRecord).catch(e => console.warn('[AI] 保存助手消息失败:', e))
      }

      // 检查是否需要 Tool Use 循环
      if (lastFinishReason !== 'tool_calls' || pendingToolCalls.length === 0) {
        // 正常结束
        break
      }

      // ── 进入 Tool Use 循环 ──
      loopCount++
      if (loopCount > MAX_TOOL_LOOPS) {
        updateStreamingMessage(msg => ({
          ...msg,
          content: msg.content + '\n\n[AI 工具调用次数超限，已停止]',
          isStreaming: false,
        }))
        break
      }

      // 如果被中断，退出循环
      if (!isStreaming.value) break

      // 标记当前助手消息结束流式
      updateStreamingMessage(msg => ({ ...msg, isStreaming: false }))

      // 执行所有工具调用
      const toolResults = await executeToolCalls(pendingToolCalls)

      // 更新 UI 中的工具调用状态
      updateStreamingMessage(msg => ({
        ...msg,
        toolCalls: pendingToolCalls,
        toolResults,
      }))

      // 构建下一轮的消息链：追加 assistant(tool_calls) + tool(results)
      // assistant 消息（携带 tool_calls）
      chatMessages.push({
        role: 'assistant',
        content: finalMsg?.content || null,
        toolCalls: pendingToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      // 每个工具调用对应一条 tool 消息
      for (const result of toolResults) {
        const toolMessage: ChatMessage = {
          role: 'tool',
          content: result.content,
          toolCallId: result.toolCallId,
        }
        chatMessages.push(toolMessage)

        // 持久化 tool 消息
        const toolRecord: AiMessageRecord = {
          id: genId(),
          sessionId: sid,
          role: 'tool',
          content: result.content,
          contentType: 'tool_result',
          tokens: 0,
          cost: 0,
          createdAt: Date.now(),
        }
        aiSaveMessage(toolRecord).catch(e => console.warn('[AI] 保存工具消息失败:', e))
      }

      // 重置 streamingMessageId 以便下一轮创建新的助手消息
      streamingMessageId = ''
    }
  }

  /**
   * 并行执行一组工具调用
   */
  async function executeToolCalls(toolCalls: ToolCallInfo[]): Promise<ToolResultInfo[]> {
    // 更新状态为 running
    for (const tc of toolCalls) {
      tc.status = 'running'
    }
    updateStreamingMessage(msg => ({ ...msg, toolCalls: [...toolCalls] }))

    const results: ToolResultInfo[] = []

    // 并行执行
    const promises = toolCalls.map(async (tc) => {
      try {
        const result = await aiExecuteTool(tc.name, tc.arguments, workDir.value)
        tc.status = result.success ? 'success' : 'error'
        tc.result = result.content
        if (!result.success) tc.error = result.content

        results.push({
          toolCallId: tc.id,
          toolName: tc.name,
          success: result.success,
          content: result.content,
        })
      } catch (e) {
        const errMsg = ensureErrorString(e)
        tc.status = 'error'
        tc.error = errMsg

        results.push({
          toolCallId: tc.id,
          toolName: tc.name,
          success: false,
          content: `工具执行异常: ${errMsg}`,
        })
      }
    })

    await Promise.all(promises)

    // 更新 UI
    updateStreamingMessage(msg => ({ ...msg, toolCalls: [...toolCalls] }))

    return results
  }

  // ─────────────────────── 流事件处理 ───────────────────────

  /** 处理单个流式事件 */
  function handleStreamEvent(event: AiStreamEvent): void {
    switch (event.type) {
      case 'TextDelta':
        pendingTextDelta += event.delta
        scheduleFlush()
        break

      case 'ThinkingDelta':
        pendingThinkingDelta += event.delta
        scheduleFlush()
        break

      case 'Usage':
        updateStreamingMessage(msg => ({
          ...msg,
          tokens: event.prompt_tokens + event.completion_tokens,
        }))
        break

      case 'Done':
        flushPendingDelta()
        lastFinishReason = event.finish_reason
        break

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

      case 'ToolCall':
        // 收集工具调用（后端已完成增量拼接，这里收到的是完整的 ToolCall）
        pendingToolCalls.push({
          id: event.id,
          name: event.name,
          arguments: event.arguments,
          parsedArgs: tryParseJson(event.arguments),
          status: 'pending',
        })
        // 更新 UI
        updateStreamingMessage(msg => ({
          ...msg,
          toolCalls: [...pendingToolCalls],
        }))
        break
    }
  }

  // ─────────────────────── 50ms 节流 ───────────────────────

  /** 调度一次 50ms 后的刷新 */
  function scheduleFlush(): void {
    if (throttleTimer) return
    throttleTimer = setTimeout(() => {
      throttleTimer = null
      flushPendingDelta()
    }, 50)
  }

  /** 将缓冲区的增量合并到消息中 */
  function flushPendingDelta(): void {
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }

    if (!pendingTextDelta && !pendingThinkingDelta) return

    const textChunk = pendingTextDelta
    const thinkingChunk = pendingThinkingDelta
    pendingTextDelta = ''
    pendingThinkingDelta = ''

    updateStreamingMessage(msg => ({
      ...msg,
      content: msg.content + textChunk,
      thinking: (msg.thinking ?? '') + thinkingChunk,
    }))

    // 自动滚动
    if (!userScrolled.value) {
      scrollToBottom()
    }
  }

  // ─────────────────────── 消息更新 ───────────────────────

  /** 不可变更新当前流式消息 */
  function updateStreamingMessage(updater: (msg: AiMessage) => AiMessage): void {
    if (!streamingMessageId) return
    messages.value = messages.value.map(m =>
      m.id === streamingMessageId ? updater(m) : m,
    )
  }

  // ─────────────────────── 中断 ───────────────────────

  /** 中断当前流式生成 */
  async function abort(): Promise<void> {
    if (!isStreaming.value) return
    try {
      await aiAbortStream(sessionIdRef.value)
    } catch (e) {
      console.warn('[AI] 中断请求失败:', e)
    }
    flushPendingDelta()
    updateStreamingMessage(msg => ({
      ...msg,
      content: msg.content + '\n\n[已中断]',
      isStreaming: false,
    }))
    isStreaming.value = false
  }

  // ─────────────────────── 重新生成 ───────────────────────

  /**
   * 重新生成最后一条助手回复
   */
  async function regenerate(
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt?: string,
  ): Promise<void> {
    if (isStreaming.value) return

    const lastUserMsg = [...messages.value].reverse().find(m => m.role === 'user')
    if (!lastUserMsg) return

    // 移除最后一条助手消息
    let lastAssistantIdx = -1
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const msg = messages.value[i]
      if (msg && (msg.role === 'assistant' || msg.role === 'error')) {
        lastAssistantIdx = i
        break
      }
    }
    if (lastAssistantIdx >= 0) {
      messages.value = messages.value.filter((_, i) => i !== lastAssistantIdx)
    }

    // 移除最后一条用户消息（send 会重新添加）
    const lastUserIdx = messages.value.lastIndexOf(lastUserMsg)
    if (lastUserIdx >= 0) {
      messages.value = messages.value.filter((_, i) => i !== lastUserIdx)
    }

    // 重新发送
    await send(lastUserMsg.content, provider, model, apiKey, systemPrompt)
  }

  // ─────────────────────── 清空对话 ───────────────────────

  function clearMessages(): void {
    messages.value = []
    error.value = null
    isStreaming.value = false
    streamingMessageId = ''
    pendingTextDelta = ''
    pendingThinkingDelta = ''
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
  }

  // ─────────────────────── 自动滚动 ───────────────────────

  function scrollToBottom(): void {
    const container = options.scrollContainer?.value
    if (!container) return
    nextTick(() => {
      container.scrollTop = container.scrollHeight
    })
  }

  /**
   * 处理用户滚动事件
   */
  function handleScroll(event: Event): void {
    const el = event.target as HTMLElement
    if (!el) return
    const threshold = 50
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    userScrolled.value = !isAtBottom
  }

  // ─────────────────────── 清理 ───────────────────────

  onUnmounted(() => {
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
  })

  return {
    // 状态
    messages,
    isStreaming,
    isLoading,
    error,
    totalTokens,
    canSend,
    /** 工作目录（Tool Use 安全边界） */
    workDir,
    // 操作
    loadHistory,
    send,
    abort,
    regenerate,
    clearMessages,
    // 滚动
    handleScroll,
    scrollToBottom,
  }
}
