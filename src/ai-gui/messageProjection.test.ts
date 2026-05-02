import { describe, expect, it } from 'vitest'
import { createAiMessageProjectionCache } from './messageProjection'
import type { AiMessage } from '@/types/ai'

function msg(overrides: Partial<AiMessage>): AiMessage {
  return {
    id: overrides.id ?? `msg-${Math.random()}`,
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? 1,
    ...overrides,
  }
}

describe('messageProjection', () => {
  it('reuses projected item references when messages are unchanged', () => {
    const cache = createAiMessageProjectionCache()
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'hello' }),
      msg({ id: 'a1', role: 'assistant', content: 'hi' }),
    ]

    const first = cache.project(messages, 'u1')
    const second = cache.project(messages, 'u1')

    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })

  it('rebuilds only the changed message item', () => {
    const cache = createAiMessageProjectionCache()
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'hello' }),
      msg({ id: 'a1', role: 'assistant', content: 'hi' }),
    ]
    const first = cache.project(messages, 'u1')

    const changed = [messages[0]!, msg({ id: 'a1', role: 'assistant', content: 'hi again' })]
    const second = cache.project(changed, 'u1')

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
  })

  it('groups consecutive assistant messages and breaks on user or compact boundary', () => {
    const cache = createAiMessageProjectionCache()
    const items = cache.project([
      msg({ id: 'a1', role: 'assistant', content: 'one' }),
      msg({ id: 'a2', role: 'assistant', content: 'two' }),
      msg({ id: 'b1', role: 'system', type: 'compact-boundary', content: '' }),
      msg({ id: 'a3', role: 'assistant', content: 'three' }),
      msg({ id: 'u1', role: 'user', content: 'ok' }),
    ], 'u1')

    expect(items.map(item => ({
      id: item.message.id,
      hideHeader: item.hideHeader,
      isGroupEnd: item.isGroupEnd,
      inGroup: item.inGroup,
      stickyCompact: item.stickyCompact,
    }))).toEqual([
      { id: 'a1', hideHeader: false, isGroupEnd: false, inGroup: true, stickyCompact: false },
      { id: 'a2', hideHeader: true, isGroupEnd: true, inGroup: true, stickyCompact: false },
      { id: 'b1', hideHeader: false, isGroupEnd: true, inGroup: false, stickyCompact: false },
      { id: 'a3', hideHeader: false, isGroupEnd: true, inGroup: false, stickyCompact: false },
      { id: 'u1', hideHeader: false, isGroupEnd: true, inGroup: false, stickyCompact: true },
    ])
  })

  it('breaks groups on rewind boundary without dropping later messages', () => {
    const cache = createAiMessageProjectionCache()
    const items = cache.project([
      msg({ id: 'a1', role: 'assistant', content: 'one' }),
      msg({
        id: 'r1',
        role: 'system',
        type: 'rewind-boundary',
        content: '已回退',
        rewindMetadata: {
          targetMessageId: 'a1',
          targetMessageRole: 'assistant',
          hiddenMessages: 2,
          createdAt: 100,
        },
      }),
      msg({ id: 'a2', role: 'assistant', content: 'two' }),
    ], null)

    expect(items.map(item => item.message.id)).toEqual(['a1', 'r1', 'a2'])
    expect(items.map(item => item.isGroupEnd)).toEqual([true, true, true])
  })

  it('rebuilds boundary items when compact metadata changes', () => {
    const cache = createAiMessageProjectionCache()
    const first = cache.project([
      msg({
        id: 'b1',
        role: 'system',
        type: 'compact-boundary',
        compactMetadata: {
          trigger: 'auto',
          preTokens: 1000,
          summarizedMessages: 10,
          createdAt: 100,
          summaryMessageId: 's1',
          source: 'ai',
        },
      }),
    ], null)

    const second = cache.project([
      msg({
        id: 'b1',
        role: 'system',
        type: 'compact-boundary',
        compactMetadata: {
          trigger: 'auto',
          preTokens: 2000,
          summarizedMessages: 20,
          createdAt: 100,
          summaryMessageId: 's1',
          source: 'ai',
        },
      }),
    ], null)

    expect(second[0]).not.toBe(first[0])
  })

  it('rebuilds boundary items when rewind metadata changes', () => {
    const cache = createAiMessageProjectionCache()
    const first = cache.project([
      msg({
        id: 'r1',
        role: 'system',
        type: 'rewind-boundary',
        rewindMetadata: {
          targetMessageId: 'a1',
          targetMessageRole: 'assistant',
          hiddenMessages: 1,
          createdAt: 100,
        },
      }),
    ], null)

    const second = cache.project([
      msg({
        id: 'r1',
        role: 'system',
        type: 'rewind-boundary',
        rewindMetadata: {
          targetMessageId: 'a1',
          targetMessageRole: 'assistant',
          hiddenMessages: 3,
          createdAt: 100,
        },
      }),
    ], null)

    expect(second[0]).not.toBe(first[0])
  })
})
