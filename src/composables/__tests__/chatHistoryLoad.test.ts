import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HISTORY_RECENT_RECORD_LIMIT,
  HISTORY_SAFE_MESSAGE_CHAR_LIMIT,
  HISTORY_SAFE_TOOL_ARGUMENT_CHAR_LIMIT,
  HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT,
  HISTORY_CACHE_MAX_ENTRIES,
  HISTORY_CACHE_TTL_MS,
  invalidateChatHistoryCache,
  loadChatHistoryWindow,
} from '@/composables/ai/chatHistoryLoad'
import type { AiSessionDetail } from '@/types/ai'

const { aiGetSessionMock } = vi.hoisted(() => ({
  aiGetSessionMock: vi.fn(),
}))

vi.mock('@/api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ai')>()
  return {
    ...actual,
    aiGetSession: aiGetSessionMock,
  }
})

function makeSessionDetail(sessionId: string, windowSize: number): AiSessionDetail {
  return {
    session: {
      id: sessionId,
      title: `Session ${sessionId}`,
      providerId: 'provider-1',
      model: 'model-1',
      messageCount: windowSize,
      totalTokens: 0,
      estimatedCost: 0,
      createdAt: 1,
      updatedAt: 2,
    },
    messages: Array.from({ length: Math.min(windowSize, 2) }, (_, index) => ({
      id: `${sessionId}-record-${windowSize}-${index}`,
      sessionId,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
      contentType: 'text',
      tokens: 1,
      cost: 0,
      createdAt: index + 1,
    })),
    totalRecords: windowSize,
    loadedRecords: Math.min(windowSize, 2),
    truncated: windowSize > 2,
  }
}

describe('chatHistoryLoad cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-21T19:30:00Z'))
    invalidateChatHistoryCache()
    aiGetSessionMock.mockImplementation((sessionId: string, windowSize: number) =>
      Promise.resolve(makeSessionDetail(sessionId, windowSize)),
    )
  })

  afterEach(() => {
    invalidateChatHistoryCache()
    vi.useRealTimers()
  })

  it('reuses cached history until the TTL expires', async () => {
    await loadChatHistoryWindow('session-1', HISTORY_RECENT_RECORD_LIMIT)
    await loadChatHistoryWindow('session-1', HISTORY_RECENT_RECORD_LIMIT)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(HISTORY_CACHE_TTL_MS + 1)

    await loadChatHistoryWindow('session-1', HISTORY_RECENT_RECORD_LIMIT)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used cache entry when capacity is exceeded', async () => {
    for (let index = 0; index < HISTORY_CACHE_MAX_ENTRIES; index += 1) {
      await loadChatHistoryWindow(`session-${index}`, HISTORY_RECENT_RECORD_LIMIT)
    }

    await loadChatHistoryWindow('session-0', HISTORY_RECENT_RECORD_LIMIT)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES)

    await loadChatHistoryWindow(`session-${HISTORY_CACHE_MAX_ENTRIES}`, HISTORY_RECENT_RECORD_LIMIT)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES + 1)

    await loadChatHistoryWindow('session-1', HISTORY_RECENT_RECORD_LIMIT)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES + 2)

    await loadChatHistoryWindow('session-0', HISTORY_RECENT_RECORD_LIMIT)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES + 2)
  })

  it('invalidates only the requested session cache entries', async () => {
    await loadChatHistoryWindow('session-1', HISTORY_RECENT_RECORD_LIMIT)
    await loadChatHistoryWindow('session-2', HISTORY_RECENT_RECORD_LIMIT)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(2)

    invalidateChatHistoryCache('session-1')

    await loadChatHistoryWindow('session-1', HISTORY_RECENT_RECORD_LIMIT)
    await loadChatHistoryWindow('session-2', HISTORY_RECENT_RECORD_LIMIT)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(3)
  })

  it('builds structured divider metadata for truncated history windows', async () => {
    const loaded = await loadChatHistoryWindow('session-1', HISTORY_RECENT_RECORD_LIMIT)

    expect(loaded.messages[0]).toMatchObject({
      id: 'history-window-session-1',
      type: 'divider',
      dividerMeta: {
        kind: 'history-window',
        loadedRecords: 2,
        totalRecords: HISTORY_RECENT_RECORD_LIMIT,
        remainingRecords: HISTORY_RECENT_RECORD_LIMIT - 2,
      },
    })
  })

  it('restores persisted compact boundary in lightweight history load', async () => {
    aiGetSessionMock.mockResolvedValueOnce({
      ...makeSessionDetail('session-compact', HISTORY_RECENT_RECORD_LIMIT),
      messages: [
        {
          id: 'compact-boundary-1',
          sessionId: 'session-compact',
          role: 'system',
          content: JSON.stringify({
            trigger: 'auto',
            preTokens: 9000,
            summarizedMessages: 14,
            createdAt: 1700000000000,
            summaryMessageId: 'summary-1',
            source: 'ai',
          }),
          contentType: 'compact_boundary',
          tokens: 9000,
          cost: 0,
          createdAt: 1699999999999,
        },
        {
          id: 'summary-1',
          sessionId: 'session-compact',
          role: 'system',
          content: '压缩摘要',
          contentType: 'text',
          tokens: 1,
          cost: 0,
          createdAt: 1700000000001,
        },
        {
          id: 'user-1',
          sessionId: 'session-compact',
          role: 'user',
          content: '继续',
          contentType: 'text',
          tokens: 1,
          cost: 0,
          createdAt: 1700000000002,
        },
      ],
      totalRecords: 3,
      loadedRecords: 3,
      truncated: false,
    })

    const loaded = await loadChatHistoryWindow('session-compact', HISTORY_RECENT_RECORD_LIMIT)

    expect(loaded.messages[0]).toMatchObject({
      id: 'compact-boundary-1',
      type: 'compact-boundary',
      compactMetadata: {
        trigger: 'auto',
        preTokens: 9000,
        summarizedMessages: 14,
        summaryMessageId: 'summary-1',
      },
    })
    expect(loaded.messages[1]).toMatchObject({
      id: 'summary-1',
      role: 'system',
      content: '压缩摘要',
    })
  })

  it('folds oversized message content before it reaches the UI renderer', async () => {
    const oversized = 'A'.repeat(HISTORY_SAFE_MESSAGE_CHAR_LIMIT + 10_000)
    aiGetSessionMock.mockResolvedValueOnce({
      ...makeSessionDetail('session-large', HISTORY_RECENT_RECORD_LIMIT),
      messages: [{
        id: 'large-message',
        sessionId: 'session-large',
        role: 'assistant',
        content: oversized,
        contentType: 'text',
        tokens: 1,
        cost: 0,
        createdAt: 1,
      }],
      totalRecords: 1,
      loadedRecords: 1,
      truncated: false,
    })

    const loaded = await loadChatHistoryWindow('session-large', HISTORY_RECENT_RECORD_LIMIT)

    expect(loaded.messages[0]?.content.length).toBeLessThan(oversized.length)
    expect(loaded.messages[0]?.content).toContain('历史消息过大，已折叠预览')
  })

  it('folds historical inline image attachments before rendering', async () => {
    const imageData = `data:image/png;base64,${'A'.repeat(390_000)}`
    aiGetSessionMock.mockResolvedValueOnce({
      ...makeSessionDetail('session-image', HISTORY_RECENT_RECORD_LIMIT),
      messages: [{
        id: 'image-message',
        sessionId: 'session-image',
        role: 'user',
        content: `看这个截图\n\n<file name="image.png" path="image.png" size="292537" lines="1" type="image">\n${imageData}\n</file>`,
        contentType: 'text_with_files',
        tokens: 1,
        cost: 0,
        createdAt: 1,
      }],
      totalRecords: 1,
      loadedRecords: 1,
      truncated: false,
    })

    const loaded = await loadChatHistoryWindow('session-image', HISTORY_RECENT_RECORD_LIMIT)

    expect(loaded.messages[0]?.content).toContain('image.png')
    expect(loaded.messages[0]?.content).toContain('285.7 KB')
    expect(loaded.messages[0]?.content).not.toContain('data:image/png;base64')
    expect(loaded.messages[0]?.content.length).toBeLessThan(1_000)
  })

  it('collapses oversized historical tool calls before rendering', async () => {
    const bigArgument = 'x'.repeat(HISTORY_SAFE_TOOL_ARGUMENT_CHAR_LIMIT + 20_000)
    const bigResult = 'y'.repeat(HISTORY_SAFE_TOOL_RESULT_CHAR_LIMIT + 20_000)
    aiGetSessionMock.mockResolvedValueOnce({
      ...makeSessionDetail('session-tools', HISTORY_RECENT_RECORD_LIMIT),
      messages: [
        {
          id: 'tool-calls',
          sessionId: 'session-tools',
          role: 'assistant',
          content: JSON.stringify([{
            id: 'tool-1',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'large.txt', content: bigArgument }),
            status: 'success',
          }]),
          contentType: 'tool_calls',
          tokens: 1,
          cost: 0,
          createdAt: 1,
        },
        {
          id: 'tool-result',
          sessionId: 'session-tools',
          role: 'tool',
          content: bigResult,
          contentType: 'tool_result',
          tokens: 1,
          cost: 0,
          parentId: 'tool-1',
          success: true,
          toolName: 'read_file',
          createdAt: 2,
        },
      ],
      totalRecords: 2,
      loadedRecords: 2,
      truncated: false,
    })

    const loaded = await loadChatHistoryWindow('session-tools', HISTORY_RECENT_RECORD_LIMIT)
    const message = loaded.messages[0]

    expect(message?.toolCalls).toBeUndefined()
    expect(message?.toolResults).toBeUndefined()
    expect(message?.content).toBe('')
    expect(message?.historyToolSummary).toEqual({
      callCount: 1,
      resultCount: 1,
      successCount: 1,
      errorCount: 0,
      pendingCount: 0,
      toolNames: ['read_file'],
      buckets: [
        {
          category: 'read',
          label: '读取',
          count: 1,
          successCount: 1,
          errorCount: 0,
          pendingCount: 0,
          toolNames: ['read_file'],
        },
      ],
      hasWrite: false,
      hasCommand: false,
      hasFailure: false,
    })
  })
})
