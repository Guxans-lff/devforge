import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useAiChat } from '@/composables/useAiChat'
import { invalidateChatHistoryCache } from '@/composables/ai/chatHistoryLoad'
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

vi.mock('@/stores/ai-chat', () => ({
  useAiChatStore: () => ({
    saveSession: vi.fn(),
  }),
}))

vi.mock('@/stores/ai-memory', () => ({
  useAiMemoryStore: () => ({
    recall: vi.fn().mockResolvedValue(''),
    compactRule: {
      p0: '',
      p1: '',
      p2: '',
      ratio: 0.2,
    },
  }),
}))

vi.mock('@/stores/workspace-files', () => ({
  useWorkspaceFilesStore: () => ({
    roots: [],
    activeEditor: null,
  }),
}))

function makeSessionDetail(
  loadedRecords: number,
  totalRecords: number,
  messageLimit: number,
): AiSessionDetail {
  return {
    session: {
      id: 'session-1',
      title: 'Session',
      providerId: 'provider-1',
      model: 'model-1',
      messageCount: totalRecords,
      totalTokens: 0,
      estimatedCost: 0,
      createdAt: 1,
      updatedAt: 2,
      workDir: 'D:/workspace',
    },
    messages: Array.from({ length: loadedRecords }, (_, index) => ({
      id: `record-${messageLimit}-${index}`,
      sessionId: 'session-1',
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
      contentType: 'text',
      tokens: 1,
      cost: 0,
      createdAt: index + 1,
    })),
    totalRecords,
    loadedRecords,
    truncated: loadedRecords < totalRecords,
  }
}

function createScrollableElement(): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'scrollHeight', {
    value: 1000,
    configurable: true,
  })
  Object.defineProperty(element, 'clientHeight', {
    value: 200,
    configurable: true,
  })
  element.scrollTop = 0
  return element
}

describe('useAiChat interaction behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    invalidateChatHistoryCache()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('loads a larger history window when loadMoreHistory is triggered', async () => {
    aiGetSessionMock
      .mockResolvedValueOnce(makeSessionDetail(300, 700, 300))
      .mockResolvedValueOnce(makeSessionDetail(600, 700, 600))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    expect(chat.canLoadMoreHistory.value).toBe(true)
    expect(aiGetSessionMock).toHaveBeenNthCalledWith(1, 'session-1', 300)
    expect(chat.messages.value[0]?.type).toBe('divider')

    await chat.loadMoreHistory()

    expect(aiGetSessionMock).toHaveBeenNthCalledWith(2, 'session-1', 600)
    expect(chat.historyLoadedRecords.value).toBe(600)
    expect(chat.historyTotalRecords.value).toBe(700)
    expect(chat.messages.value[0]?.type).toBe('divider')
    expect(chat.observability.value.historyRestoreCount).toBe(chat.messages.value.length)
    expect(chat.observability.value.loadHistoryDurationMs).not.toBeNull()
  })

  it('does not load more history when the current window is complete', async () => {
    aiGetSessionMock.mockResolvedValueOnce(makeSessionDetail(120, 120, 300))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    expect(chat.canLoadMoreHistory.value).toBe(false)

    await chat.loadMoreHistory()

    expect(aiGetSessionMock).toHaveBeenCalledTimes(1)
  })

  it('reuses cached history for the same session window', async () => {
    aiGetSessionMock.mockResolvedValueOnce(makeSessionDetail(120, 120, 300))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    await chat.loadHistory()

    expect(aiGetSessionMock).toHaveBeenCalledTimes(1)
    expect(chat.messages.value).toHaveLength(120)
  })

  it('scrollToBottom uses the shared scroll container ref', async () => {
    const scrollContainer = ref<HTMLElement | null>(createScrollableElement())
    const chat = useAiChat({ sessionId: ref('session-1'), scrollContainer })

    chat.scrollToBottom()
    await nextTick()

    expect(scrollContainer.value?.scrollTop).toBe(1000)
  })

  it('updates user scroll state through throttled handleScroll without throwing', async () => {
    const element = createScrollableElement()
    const chat = useAiChat({ sessionId: ref('session-1'), scrollContainer: ref(element) })

    element.scrollTop = 100
    chat.handleScroll({ target: element } as unknown as Event)
    await vi.runOnlyPendingTimersAsync()

    element.scrollTop = 800
    chat.handleScroll({ target: element } as unknown as Event)
    await vi.runOnlyPendingTimersAsync()

    expect(element.scrollTop).toBe(800)
  })
})
