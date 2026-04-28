import type { AiMessage, AiMessageRecord } from '@/types/ai'

export interface RewindConversationResult {
  messages: AiMessage[]
  boundary: AiMessage
  hiddenMessages: number
}

function createRewindBoundary(target: AiMessage, hiddenMessages: number, now: number): AiMessage {
  return {
    id: `rewind-${now}-${target.id}`,
    role: 'system',
    type: 'rewind-boundary',
    content: `已回退到消息 ${target.id}，后续上下文将从这里重新开始。`,
    timestamp: now,
    rewindMetadata: {
      targetMessageId: target.id,
      targetMessageRole: target.role,
      hiddenMessages,
      createdAt: now,
    },
  }
}

export function rewindConversationToMessage(
  messages: AiMessage[],
  targetMessageId: string,
  now = Date.now(),
): RewindConversationResult {
  const targetIndex = messages.findIndex(message => message.id === targetMessageId)
  if (targetIndex === -1) {
    throw new Error('未找到要回退的消息。')
  }

  const target = messages[targetIndex]!
  if (target.type === 'divider' || target.type === 'compact-boundary' || target.type === 'rewind-boundary') {
    throw new Error('不能回退到系统边界消息。')
  }

  const keptMessages = messages.slice(0, targetIndex + 1)
  const hiddenMessages = messages.length - keptMessages.length
  const boundary = createRewindBoundary(target, hiddenMessages, now)

  return {
    messages: [...keptMessages, boundary],
    boundary,
    hiddenMessages,
  }
}

export function createRewindMessageRecord(params: {
  boundary: AiMessage
  sessionId: string
  parentId?: string
}): AiMessageRecord {
  return {
    id: params.boundary.id,
    sessionId: params.sessionId,
    role: 'system',
    content: params.boundary.content,
    contentType: 'text',
    tokens: 0,
    cost: 0,
    parentId: params.parentId,
    createdAt: params.boundary.timestamp,
    type: 'rewind-boundary',
    rewindMetadata: params.boundary.rewindMetadata,
  }
}
