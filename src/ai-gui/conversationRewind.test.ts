import { describe, expect, it } from 'vitest'
import { createRewindMessageRecord, rewindConversationToMessage } from './conversationRewind'
import type { AiMessage } from '@/types/ai'

function message(overrides: Partial<AiMessage>): AiMessage {
  return {
    id: overrides.id ?? 'msg-1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1,
    ...overrides,
  }
}

describe('conversationRewind', () => {
  it('keeps messages up to target and appends a rewind boundary', () => {
    const result = rewindConversationToMessage([
      message({ id: 'u1', role: 'user' }),
      message({ id: 'a1', role: 'assistant' }),
      message({ id: 'u2', role: 'user' }),
    ], 'a1', 100)

    expect(result.messages.map(item => item.id)).toEqual(['u1', 'a1', 'rewind-100-a1'])
    expect(result.hiddenMessages).toBe(1)
    expect(result.boundary.type).toBe('rewind-boundary')
    expect(result.boundary.rewindMetadata).toEqual({
      targetMessageId: 'a1',
      targetMessageRole: 'assistant',
      hiddenMessages: 1,
      createdAt: 100,
    })
  })

  it('rejects missing or boundary targets', () => {
    expect(() => rewindConversationToMessage([], 'missing', 100)).toThrow('未找到')
    expect(() => rewindConversationToMessage([
      message({ id: 'boundary', role: 'system', type: 'compact-boundary' }),
    ], 'boundary', 100)).toThrow('不能回退')
  })

  it('creates a persistable message record for the boundary', () => {
    const { boundary } = rewindConversationToMessage([
      message({ id: 'u1', role: 'user', content: 'hello' }),
    ], 'u1', 100)

    expect(createRewindMessageRecord({ boundary, sessionId: 'session-1', parentId: 'u1' })).toMatchObject({
      id: 'rewind-100-u1',
      sessionId: 'session-1',
      role: 'system',
      contentType: 'text',
      type: 'rewind-boundary',
      rewindMetadata: boundary.rewindMetadata,
    })
  })
})
