import { describe, expect, it } from 'vitest'
import { findLastCompactBoundaryIndex, getMessagesAfterCompactBoundary } from '@/composables/useAutoCompact'
import type { AiMessage } from '@/types/ai'

function makeMessage(overrides: Partial<AiMessage>): AiMessage {
  return {
    id: overrides.id ?? 'msg-1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1,
    ...overrides,
  }
}

describe('findLastCompactBoundaryIndex', () => {
  it('returns -1 when no boundary exists', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user' }),
      makeMessage({ id: 'a1', role: 'assistant' }),
    ]
    expect(findLastCompactBoundaryIndex(messages)).toBe(-1)
  })

  it('finds the last compact-boundary', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user' }),
      makeMessage({ id: 'b1', role: 'system', type: 'compact-boundary' }),
      makeMessage({ id: 'u2', role: 'user' }),
      makeMessage({ id: 'b2', role: 'system', type: 'compact-boundary' }),
      makeMessage({ id: 'u3', role: 'user' }),
    ]
    expect(findLastCompactBoundaryIndex(messages)).toBe(3)
  })

  it('finds the only compact-boundary', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user' }),
      makeMessage({ id: 'b1', role: 'system', type: 'compact-boundary' }),
      makeMessage({ id: 'u2', role: 'user' }),
    ]
    expect(findLastCompactBoundaryIndex(messages)).toBe(1)
  })
})

describe('getMessagesAfterCompactBoundary', () => {
  it('returns all messages when no boundary exists', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user' }),
      makeMessage({ id: 'a1', role: 'assistant' }),
    ]
    expect(getMessagesAfterCompactBoundary(messages)).toEqual(messages)
  })

  it('returns messages from boundary onward', () => {
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'old' }),
      makeMessage({ id: 'b1', role: 'system', type: 'compact-boundary' }),
      makeMessage({ id: 's1', role: 'system', content: 'summary' }),
      makeMessage({ id: 'u2', role: 'user', content: 'new' }),
    ]
    const result = getMessagesAfterCompactBoundary(messages)
    expect(result).toHaveLength(3)
    expect(result[0]!.id).toBe('b1')
    expect(result[1]!.id).toBe('s1')
    expect(result[2]!.id).toBe('u2')
  })

  it('handles boundary at the beginning', () => {
    const messages = [
      makeMessage({ id: 'b1', role: 'system', type: 'compact-boundary' }),
      makeMessage({ id: 'u1', role: 'user' }),
    ]
    const result = getMessagesAfterCompactBoundary(messages)
    expect(result).toHaveLength(2)
    expect(result[0]!.id).toBe('b1')
    expect(result[1]!.id).toBe('u1')
  })
})
