import type { AiMessage, AiMessageRecord, ToolCallInfo, ToolResultInfo } from '@/types/ai'
import { sanitizeLoadedMessages } from './chatMessageBuilder'
import { tryParseJson } from './chatHelpers'

interface AssistantToolFrame {
  message: AiMessage
  toolCalls: ToolCallInfo[]
  attachedCount: number
}

function normalizeToolCalls(content: string): ToolCallInfo[] {
  const parsed = JSON.parse(content) as unknown
  if (!Array.isArray(parsed)) return []

  return parsed.map((item, index) => {
    const raw = (item ?? {}) as Partial<ToolCallInfo>
    const args = typeof raw.arguments === 'string' ? raw.arguments : ''
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : `restored-tool-${index}`,
      name: typeof raw.name === 'string' ? raw.name : 'unknown',
      arguments: args,
      parsedArgs: raw.parsedArgs ?? tryParseJson(args),
      status: raw.status ?? 'pending',
      streamingChars: raw.streamingChars,
      streamingIndex: raw.streamingIndex,
      result: raw.result,
      error: raw.error,
      approvalState: raw.approvalState,
    }
  })
}

function findToolFrame(
  record: AiMessageRecord,
  framesByToolCallId: Map<string, AssistantToolFrame>,
  openFrames: AssistantToolFrame[],
): AssistantToolFrame | null {
  if (record.parentId) {
    return framesByToolCallId.get(record.parentId) ?? null
  }

  return openFrames[openFrames.length - 1] ?? null
}

function attachToolResult(frame: AssistantToolFrame, record: AiMessageRecord): void {
  const toolResults = frame.message.toolResults ?? []
  const matchedToolCall = record.parentId
    ? frame.toolCalls.find(toolCall => toolCall.id === record.parentId)
    : frame.toolCalls.find(toolCall => !toolResults.some(result => result.toolCallId === toolCall.id))

  const success = record.success ?? true
  const result: ToolResultInfo = {
    toolCallId: matchedToolCall?.id ?? record.parentId ?? record.id,
    toolName: record.toolName ?? matchedToolCall?.name ?? 'unknown',
    success,
    content: record.content,
  }

  toolResults.push(result)
  frame.message.toolResults = toolResults
  frame.attachedCount += 1

  if (!matchedToolCall) return

  matchedToolCall.parsedArgs = matchedToolCall.parsedArgs ?? tryParseJson(matchedToolCall.arguments)
  matchedToolCall.status = success ? 'success' : 'error'
  matchedToolCall.result = record.content
  if (!success) {
    matchedToolCall.error = record.content
  }
}

export function restoreMessagesFromRecords(records: AiMessageRecord[]): AiMessage[] {
  const restored: AiMessage[] = []
  const framesByToolCallId = new Map<string, AssistantToolFrame>()
  const openFrames: AssistantToolFrame[] = []

  for (const record of records) {
    if (record.role === 'assistant' && record.contentType === 'tool_calls') {
      const toolCalls = normalizeToolCalls(record.content)
      const assistantMessage: AiMessage = {
        id: record.id,
        role: 'assistant',
        content: '',
        timestamp: record.createdAt,
        tokens: record.tokens,
        totalTokens: record.tokens,
        toolCalls,
        toolResults: [],
      }
      const frame: AssistantToolFrame = {
        message: assistantMessage,
        toolCalls,
        attachedCount: 0,
      }
      restored.push(assistantMessage)
      openFrames.push(frame)
      for (const toolCall of toolCalls) {
        framesByToolCallId.set(toolCall.id, frame)
      }
      continue
    }

    if (record.role === 'tool' && record.contentType === 'tool_result') {
      const frame = findToolFrame(record, framesByToolCallId, openFrames)
      if (frame) {
        attachToolResult(frame, record)
        if (frame.attachedCount >= frame.toolCalls.length) {
          const last = openFrames[openFrames.length - 1]
          if (last === frame) {
            openFrames.pop()
          }
        }
      }
      continue
    }

    restored.push({
      id: record.id,
      role: record.role as AiMessage['role'],
      content: record.content,
      timestamp: record.createdAt,
      tokens: record.tokens,
      totalTokens: record.tokens,
    })
  }

  return sanitizeLoadedMessages(restored)
}
