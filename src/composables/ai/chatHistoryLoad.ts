import { aiGetSession } from '@/api/ai'
import type { AiMessage, AiSession } from '@/types/ai'
import { restoreMessagesFromRecords } from './chatHistoryRestore'

export const HISTORY_RECENT_RECORD_LIMIT = 300
export const HISTORY_LOAD_STEP = 300

export interface ChatHistoryWindow {
  windowSize: number
  loadedRecords: number
  totalRecords: number
}

export interface LoadedChatHistory {
  session: AiSession | null
  messages: AiMessage[]
  window: ChatHistoryWindow
  truncated: boolean
}

const historyCache = new Map<string, LoadedChatHistory>()
const inflightRequests = new Map<string, Promise<LoadedChatHistory>>()

function cacheKey(sessionId: string, windowSize: number): string {
  return `${sessionId}:${windowSize}`
}

export async function loadChatHistoryWindow(
  sessionId: string,
  windowSize: number,
): Promise<LoadedChatHistory> {
  const key = cacheKey(sessionId, windowSize)
  const cached = historyCache.get(key)
  if (cached) return cached

  const inflight = inflightRequests.get(key)
  if (inflight) return inflight

  const request = (async () => {
    const result = await aiGetSession(sessionId, windowSize)

    if (!result) {
      return {
        session: null,
        messages: [],
        window: {
          windowSize,
          loadedRecords: 0,
          totalRecords: 0,
        },
        truncated: false,
      }
    }

    const { session, messages: records, truncated, totalRecords, loadedRecords } = result
    const restored = restoreMessagesFromRecords(records)

    return {
      session,
      messages: buildHistoryMessages(sessionId, restored, {
        truncated,
        loadedRecords,
        totalRecords,
      }),
      window: {
        windowSize,
        loadedRecords,
        totalRecords,
      },
      truncated,
    }
  })()

  inflightRequests.set(key, request)

  try {
    const loaded = await request
    historyCache.set(key, loaded)
    return loaded
  } finally {
    inflightRequests.delete(key)
  }
}

export async function preloadChatHistoryWindow(
  sessionId: string,
  windowSize: number,
): Promise<void> {
  if (!sessionId || windowSize <= 0) return

  try {
    await loadChatHistoryWindow(sessionId, windowSize)
  } catch {
    // Best-effort warmup: ignore cache preloading failures.
  }
}

export function invalidateChatHistoryCache(sessionId?: string): void {
  if (!sessionId) {
    historyCache.clear()
    inflightRequests.clear()
    return
  }

  for (const key of historyCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      historyCache.delete(key)
    }
  }
  for (const key of inflightRequests.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      inflightRequests.delete(key)
    }
  }
}

export function canExpandHistoryWindow(window: ChatHistoryWindow): boolean {
  return window.totalRecords > 0 && window.loadedRecords < window.totalRecords
}

export function getExpandedHistoryWindowSize(currentWindowSize: number): number {
  return currentWindowSize + HISTORY_LOAD_STEP
}

function buildHistoryMessages(
  sessionId: string,
  restored: AiMessage[],
  metadata: {
    truncated: boolean
    loadedRecords: number
    totalRecords: number
  },
): AiMessage[] {
  if (!metadata.truncated) return restored

  return [
    {
      id: `history-window-${sessionId}`,
      role: 'assistant',
      content: '',
      timestamp: restored[0]?.timestamp ?? Date.now(),
      type: 'divider',
      dividerText: `已加载最近 ${metadata.loadedRecords} / ${metadata.totalRecords} 条历史记录`,
    },
    ...restored,
  ]
}
