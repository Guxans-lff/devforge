import type { ChatMessage } from '@/api/ai'
import type { AiMessage, ToolCallInfo, ToolResultInfo } from '@/types/ai'
import { containsImages, parseContentBlocks } from './chatContentBlocks'
import { tryParseJson } from './chatHelpers'

const INTERRUPTED_ASSISTANT_MESSAGE = '[previous response was interrupted or incomplete]'

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
      const hasHistoryToolSummary = !!m.historyToolSummary
      if (noContent && noToolCalls && !hasHistoryToolSummary) {
        out[i] = {
          ...m,
          role: 'error',
          content: INTERRUPTED_ASSISTANT_MESSAGE,
          isStreaming: false,
        }
      }
      break
    }
  }
  return out
}

function hasValidToolArguments(toolCall: ToolCallInfo): boolean {
  const parsed = tryParseJson(toolCall.arguments)
  return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
}

function resolveToolResult(
  toolCall: ToolCallInfo,
  resultsById: Map<string, ToolResultInfo>,
): ToolResultInfo | null {
  const explicitResult = resultsById.get(toolCall.id)
  if (explicitResult) return explicitResult

  if (toolCall.status === 'success' && toolCall.result) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      success: true,
      content: toolCall.result,
    }
  }

  const failureContent = toolCall.error ?? toolCall.result
  if (toolCall.status === 'error' && failureContent) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      success: false,
      content: failureContent,
    }
  }

  return null
}

function getReplayableToolEntries(msg: AiMessage): Array<{
  toolCall: ToolCallInfo
  toolResult: ToolResultInfo
}> {
  const resultsById = new Map((msg.toolResults ?? []).map(result => [result.toolCallId, result]))

  return (msg.toolCalls ?? [])
    .filter(hasValidToolArguments)
    .map(toolCall => ({
      toolCall,
      toolResult: resolveToolResult(toolCall, resultsById),
    }))
    .filter((entry): entry is { toolCall: ToolCallInfo, toolResult: ToolResultInfo } =>
      entry.toolResult !== null,
    )
}

export function buildChatMessages(msgs: AiMessage[], hasVision = false): ChatMessage[] {
  return buildChatMessagesWithOptions(msgs, {
    hasVision,
    replayToolContext: true,
  })
}

export interface BuildChatMessagesOptions {
  hasVision?: boolean
  replayToolContext?: boolean
}

/**
 * 找到最后一个 compact-boundary 的索引
 */
function findLastContextBoundaryIndex(msgs: AiMessage[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const type = msgs[i]!.type
    if (type === 'compact-boundary' || type === 'rewind-boundary') return i
  }
  return -1
}

export function buildChatMessagesWithOptions(
  msgs: AiMessage[],
  options: BuildChatMessagesOptions = {},
): ChatMessage[] {
  const {
    hasVision = false,
    replayToolContext = true,
  } = options
  const result: ChatMessage[] = []

  // 只使用最后一个 compact-boundary 之后的消息（包含 boundary 后的摘要消息）
  const boundaryIdx = findLastContextBoundaryIndex(msgs)
  const contextMsgs = boundaryIdx === -1 ? msgs : msgs.slice(boundaryIdx + 1)

  for (const msg of contextMsgs) {
    if (msg.role === 'error') continue
    if (msg.type === 'divider') continue
    if (msg.type === 'compact-boundary') continue
    if (msg.type === 'rewind-boundary') continue

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
      continue
    }

    if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content })
      continue
    }

    if (msg.role !== 'assistant') continue

    const hasContent = !!(msg.content && msg.content.trim())
    const replayableToolEntries = replayToolContext ? getReplayableToolEntries(msg) : []
    const hasToolCalls = replayableToolEntries.length > 0
    if (!hasContent && !hasToolCalls) continue

    const chatMsg: ChatMessage = {
      role: 'assistant',
      content: msg.content || null,
    }
    if (msg.thinking && msg.thinking.trim() && hasToolCalls) {
      chatMsg.reasoningContent = msg.thinking
    }

    if (hasToolCalls) {
      chatMsg.toolCalls = replayableToolEntries.map(({ toolCall }) => ({
        id: toolCall.id,
        type: 'function',
        function: { name: toolCall.name, arguments: toolCall.arguments },
      }))
    }

    result.push(chatMsg)

    for (const { toolCall, toolResult } of replayableToolEntries) {
      result.push({
        role: 'tool',
        content: toolResult.content,
        toolCallId: toolCall.id,
        name: toolCall.name,
      })
    }
  }

  return result
}
