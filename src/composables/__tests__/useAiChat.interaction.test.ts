import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useAiChat } from '@/composables/useAiChat'
import {
  HISTORY_LOAD_STEP,
  HISTORY_RECENT_RECORD_LIMIT,
  invalidateChatHistoryCache,
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
    roots: [{ id: 'root-1', path: 'D:/Project/DevForge/devforge', name: 'devforge' }],
    activeEditor: null,
  }),
}))

function makeSessionDetail(
  loadedRecords: number,
  totalRecords: number,
  messageLimit: number,
  options?: { sessionId?: string; workDir?: string },
): AiSessionDetail {
  const sessionId = options?.sessionId ?? 'session-1'
  return {
    session: {
      id: sessionId,
      title: 'Session',
      providerId: 'provider-1',
      model: 'model-1',
      messageCount: totalRecords,
      totalTokens: 0,
      estimatedCost: 0,
      createdAt: 1,
      updatedAt: 2,
      workDir: options?.workDir,
    },
    messages: Array.from({ length: loadedRecords }, (_, index) => ({
      id: `record-${messageLimit}-${index}`,
      sessionId,
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
    const expandedLimit = HISTORY_RECENT_RECORD_LIMIT + HISTORY_LOAD_STEP
    aiGetSessionMock
      .mockResolvedValueOnce(makeSessionDetail(HISTORY_RECENT_RECORD_LIMIT, 700, HISTORY_RECENT_RECORD_LIMIT))
      .mockResolvedValueOnce(makeSessionDetail(expandedLimit, 700, expandedLimit))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    expect(chat.canLoadMoreHistory.value).toBe(true)
    expect(aiGetSessionMock).toHaveBeenNthCalledWith(1, 'session-1', HISTORY_RECENT_RECORD_LIMIT)
    expect(chat.messages.value[0]?.type).toBe('divider')

    await chat.loadMoreHistory()

    expect(aiGetSessionMock).toHaveBeenNthCalledWith(2, 'session-1', expandedLimit)
    expect(chat.historyLoadedRecords.value).toBe(expandedLimit)
    expect(chat.historyTotalRecords.value).toBe(700)
    expect(chat.historyRemainingRecords.value).toBe(700 - expandedLimit)
    expect(chat.messages.value[0]?.type).toBe('divider')
    expect(chat.messages.value[0]?.dividerMeta).toMatchObject({
      kind: 'history-window',
      loadedRecords: expandedLimit,
      totalRecords: 700,
      remainingRecords: 700 - expandedLimit,
    })
    expect(chat.observability.value.historyRestoreCount).toBe(chat.messages.value.length)
    expect(chat.observability.value.loadHistoryDurationMs).not.toBeNull()
  })

  it('does not automatically preload a larger history window after restoring a truncated session', async () => {
    aiGetSessionMock.mockResolvedValueOnce(
      makeSessionDetail(HISTORY_RECENT_RECORD_LIMIT, 700, HISTORY_RECENT_RECORD_LIMIT),
    )

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    await Promise.resolve()

    expect(aiGetSessionMock).toHaveBeenCalledTimes(1)
    expect(aiGetSessionMock).toHaveBeenNthCalledWith(1, 'session-1', HISTORY_RECENT_RECORD_LIMIT)
  })

  it('ignores duplicate loadMoreHistory calls while a manual expansion is pending', async () => {
    const expandedLimit = HISTORY_RECENT_RECORD_LIMIT + HISTORY_LOAD_STEP
    let resolveWarmup: ((value: AiSessionDetail) => void) | null = null
    aiGetSessionMock
      .mockResolvedValueOnce(makeSessionDetail(HISTORY_RECENT_RECORD_LIMIT, 700, HISTORY_RECENT_RECORD_LIMIT))
      .mockImplementationOnce(() => new Promise<AiSessionDetail>((resolve) => {
        resolveWarmup = resolve
      }))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    await Promise.resolve()

    const loadMorePromise = chat.loadMoreHistory()
    const secondLoadMorePromise = chat.loadMoreHistory()
    await secondLoadMorePromise
    expect(aiGetSessionMock).toHaveBeenCalledTimes(2)

    resolveWarmup?.(makeSessionDetail(expandedLimit, 700, expandedLimit))
    await loadMorePromise

    expect(aiGetSessionMock).toHaveBeenCalledTimes(2)
    expect(aiGetSessionMock).toHaveBeenLastCalledWith('session-1', expandedLimit)
    expect(chat.historyLoadedRecords.value).toBe(expandedLimit)
    expect(chat.messages.value[0]?.type).toBe('divider')
  })

  it('does not load more history when the current window is complete', async () => {
    aiGetSessionMock.mockResolvedValueOnce(makeSessionDetail(120, 120, HISTORY_RECENT_RECORD_LIMIT))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    expect(chat.canLoadMoreHistory.value).toBe(false)

    await chat.loadMoreHistory()

    expect(aiGetSessionMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the current history window intact when loadMoreHistory fails', async () => {
    aiGetSessionMock
      .mockResolvedValueOnce(makeSessionDetail(HISTORY_RECENT_RECORD_LIMIT, 700, HISTORY_RECENT_RECORD_LIMIT))
      .mockRejectedValueOnce(new Error('load more failed'))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    const beforeIds = chat.messages.value.map(message => message.id)

    await chat.loadMoreHistory()

    expect(chat.historyLoadMorePending.value).toBe(false)
    expect(chat.historyLoadMoreError.value).toBe('load more failed')
    expect(chat.historyLoadedRecords.value).toBe(HISTORY_RECENT_RECORD_LIMIT)
    expect(chat.historyTotalRecords.value).toBe(700)
    expect(chat.messages.value.map(message => message.id)).toEqual(beforeIds)
  })

  it('reuses cached history for the same session window', async () => {
    aiGetSessionMock.mockResolvedValueOnce(makeSessionDetail(120, 120, HISTORY_RECENT_RECORD_LIMIT))

    const chat = useAiChat({ sessionId: ref('session-1') })

    await chat.loadHistory()
    await chat.loadHistory()

    expect(aiGetSessionMock).toHaveBeenCalledTimes(1)
    expect(chat.messages.value).toHaveLength(120)
  })

  it('does not preload history for another session', async () => {
    const chat = useAiChat({ sessionId: ref('session-1') })
    chat.messages.value = [{
      id: 'existing',
      role: 'assistant',
      content: 'keep current state',
      timestamp: 1,
    }]

    await chat.preloadHistory('session-2')

    expect(aiGetSessionMock).not.toHaveBeenCalled()
    expect(chat.messages.value).toEqual([{
      id: 'existing',
      role: 'assistant',
      content: 'keep current state',
      timestamp: 1,
    }])
  })

  it('clears session-scoped runtime state when restoring another session', async () => {
    aiGetSessionMock
      .mockResolvedValueOnce(makeSessionDetail(2, 2, HISTORY_RECENT_RECORD_LIMIT, { sessionId: 'session-1', workDir: 'D:/workspace-a' }))
      .mockResolvedValueOnce(makeSessionDetail(1, 1, HISTORY_RECENT_RECORD_LIMIT, { sessionId: 'session-2', workDir: undefined }))

    const sessionId = ref('session-1')
    const chat = useAiChat({ sessionId })

    await chat.loadHistory()
    expect(chat.workDir.value).toBe('D:/workspace-a')

    chat.planApproved.value = true
    chat.pendingPlan.value = 'old plan'
    chat.awaitingPlanApproval.value = true
    chat.spawnedTasks.value = [{
      id: 'task-1',
      description: 'old task',
      status: 'pending',
      createdAt: 1000,
      retryCount: 0,
    }]

    sessionId.value = 'session-2'
    await chat.loadHistory('session-2')

    expect(chat.workDir.value).toBe('D:/Project/DevForge/devforge')
    expect(chat.planApproved.value).toBe(false)
    expect(chat.pendingPlan.value).toBe('')
    expect(chat.awaitingPlanApproval.value).toBe(false)
    expect(chat.spawnedTasks.value).toEqual([])
    expect(chat.messages.value).toHaveLength(1)
  })

  it('falls back to the current workspace root when restored session has no saved work directory', async () => {
    aiGetSessionMock.mockResolvedValueOnce(
      makeSessionDetail(1, 1, HISTORY_RECENT_RECORD_LIMIT, { sessionId: 'session-empty-workdir', workDir: undefined }),
    )

    const chat = useAiChat({ sessionId: ref('session-empty-workdir') })

    await chat.loadHistory()

    expect(chat.workDir.value).toBe('D:/Project/DevForge/devforge')
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
