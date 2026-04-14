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
} from '@/types/ai'
import { aiChatStream, aiAbortStream, aiSaveMessage, aiGetSession } from '@/api/ai'
import { useAiChatStore } from '@/stores/ai-chat'
import { ensureErrorString } from '@/types/error'
import type { ChatMessage } from '@/api/ai'

/** 生成唯一 ID */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
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

      const [, records] = result
      messages.value = records.map(r => ({
        id: r.id,
        role: r.role as AiMessage['role'],
        content: r.content,
        timestamp: r.createdAt,
        tokens: r.tokens,
      }))
    } catch (e) {
      error.value = ensureErrorString(e)
    } finally {
      isLoading.value = false
    }
  }

  // ─────────────────────── 发送消息 ───────────────────────

  /**
   * 发送消息并开始流式接收
   */
  async function send(
    content: string,
    provider: ProviderConfig,
    model: ModelConfig,
    apiKey: string,
    systemPrompt?: string,
  ): Promise<void> {
    if (!canSend.value || !content.trim()) return

    const sid = sessionIdRef.value
    if (!sid) {
      error.value = '会话 ID 无效'
      return
    }
    error.value = null

    // 1. 添加用户消息到列表
    const userMsg: AiMessage = {
      id: genId(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }
    messages.value = [...messages.value, userMsg]

    // 持久化用户消息
    const userRecord: AiMessageRecord = {
      id: userMsg.id,
      sessionId: sid,
      role: 'user',
      content: userMsg.content,
      contentType: 'text',
      tokens: 0,
      cost: 0,
      createdAt: userMsg.timestamp,
    }
    aiSaveMessage(userRecord).catch(e => console.warn('[AI] 保存用户消息失败:', e))

    // 2. 创建助手占位消息
    streamingMessageId = genId()
    const assistantMsg: AiMessage = {
      id: streamingMessageId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      isStreaming: true,
    }
    messages.value = [...messages.value, assistantMsg]
    isStreaming.value = true
    userScrolled.value = false

    // 3. 构建发送给 API 的消息列表
    const chatMessages: ChatMessage[] = messages.value
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .filter(m => m.id !== streamingMessageId)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    // 4. 流式对话
    try {
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
        },
        (event: AiStreamEvent) => handleStreamEvent(event),
      )

      // 流结束后刷新最后的缓冲
      flushPendingDelta()

      // 持久化助手消息
      const finalMsg = messages.value.find(m => m.id === streamingMessageId)
      if (finalMsg) {
        const assistantRecord: AiMessageRecord = {
          id: finalMsg.id,
          sessionId: sid,
          role: 'assistant',
          content: finalMsg.content,
          contentType: 'text',
          tokens: finalMsg.tokens ?? 0,
          cost: 0,
          createdAt: finalMsg.timestamp,
        }
        aiSaveMessage(assistantRecord).catch(e => console.warn('[AI] 保存助手消息失败:', e))
      }
    } catch (e) {
      const errMsg = ensureErrorString(e)
      error.value = errMsg

      updateStreamingMessage(msg => ({
        ...msg,
        role: 'error' as const,
        content: errMsg,
        isStreaming: false,
      }))
    } finally {
      updateStreamingMessage(msg => ({
        ...msg,
        isStreaming: false,
      }))
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
      }
      aiStore.saveSession(session).catch(e => console.warn('[AI] 保存会话失败:', e))
    }
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
        // V4 再实现
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
