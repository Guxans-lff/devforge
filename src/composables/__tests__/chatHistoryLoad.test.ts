import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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
    await loadChatHistoryWindow('session-1', 300)
    await loadChatHistoryWindow('session-1', 300)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(HISTORY_CACHE_TTL_MS + 1)

    await loadChatHistoryWindow('session-1', 300)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used cache entry when capacity is exceeded', async () => {
    for (let index = 0; index < HISTORY_CACHE_MAX_ENTRIES; index += 1) {
      await loadChatHistoryWindow(`session-${index}`, 300)
    }

    await loadChatHistoryWindow('session-0', 300)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES)

    await loadChatHistoryWindow(`session-${HISTORY_CACHE_MAX_ENTRIES}`, 300)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES + 1)

    await loadChatHistoryWindow('session-1', 300)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES + 2)

    await loadChatHistoryWindow('session-0', 300)
    expect(aiGetSessionMock).toHaveBeenCalledTimes(HISTORY_CACHE_MAX_ENTRIES + 2)
  })

  it('invalidates only the requested session cache entries', async () => {
    await loadChatHistoryWindow('session-1', 300)
    await loadChatHistoryWindow('session-2', 300)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(2)

    invalidateChatHistoryCache('session-1')

    await loadChatHistoryWindow('session-1', 300)
    await loadChatHistoryWindow('session-2', 300)

    expect(aiGetSessionMock).toHaveBeenCalledTimes(3)
  })

  it('builds structured divider metadata for truncated history windows', async () => {
    const loaded = await loadChatHistoryWindow('session-1', 300)

    expect(loaded.messages[0]).toMatchObject({
      id: 'history-window-session-1',
      type: 'divider',
      dividerMeta: {
        kind: 'history-window',
        loadedRecords: 2,
        totalRecords: 300,
        remainingRecords: 298,
      },
    })
  })
})
