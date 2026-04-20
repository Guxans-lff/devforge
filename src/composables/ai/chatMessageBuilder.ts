import type { ChatMessage } from '@/api/ai'
import type { AiMessage } from '@/types/ai'
import { containsImages, parseContentBlocks } from './chatContentBlocks'

export function sanitizeLoadedMessages(msgs: AiMessage[]): AiMessage[] {
  if (msgs.length === 0) return msgs
  const out = msgs.map(m =>
    m.role === 'assistant' && m.isStreaming ? { ...m, isStreaming: false } : m,
  )
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!
    if (m.role === 'assistant') {
      const noContent = !m.content || m.content.trim() === ''
      const noToolCalls = !m.toolCalls || m.toolCalls.length === 0
      if (noContent && noToolCalls) {
        out[i] = {
          ...m,
          role: 'error',
          content: '[上一轮回复未完成或已中断]',
          isStreaming: false,
        }
      }
      break
    }
  }
  return out
}

export function buildChatMessages(msgs: AiMessage[], hasVision = false): ChatMessage[] {
  const result: ChatMessage[] = []

  for (const msg of msgs) {
    if (msg.role === 'error') continue
    if (msg.type === 'divider') continue

    if (msg.role === 'user') {
      if (hasVision && containsImages(msg.content)) {
        const contentBlocks = parseContentBlocks(msg.content)
        result.push({
          role: 'user',
          content: null,
          contentBlocks,
        })
      } else {
        result.push({ role: 'user', content: msg.content })
      }
    } else if (msg.role === 'assistant') {
      const hasContent = !!(msg.content && msg.content.trim())
      const hasToolCalls = !!(msg.toolCalls && msg.toolCalls.length > 0)
      if (!hasContent && !hasToolCalls) continue

      const chatMsg: ChatMessage = {
        role: 'assistant',
        content: msg.content || null,
      }
      if (msg.thinking && msg.thinking.trim() && msg.toolCalls && msg.toolCalls.length > 0) {
        chatMsg.reasoningContent = msg.thinking
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        chatMsg.toolCalls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }))
      }

      result.push(chatMsg)

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const existingResults = msg.toolResults ?? []
        const resultsById = new Map(existingResults.map(tr => [tr.toolCallId, tr]))
        for (const tc of msg.toolCalls) {
          const tr = resultsById.get(tc.id)
          result.push({
            role: 'tool',
            content: tr?.content ?? '[工具调用被用户中断，未执行]',
            toolCallId: tc.id,
            name: tc.name,
          })
        }
      }
    }
  }

  return result
}
