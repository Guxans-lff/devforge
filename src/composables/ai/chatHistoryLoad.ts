import { aiGetSession } from '@/api/ai'
import type { AiMessage, AiSession } from '@/types/ai'
import { restoreMessagesFromRecords } from './chatHistoryRestore'

export const HISTORY_RECENT_RECORD_LIMIT = 300
export const HISTORY_LOAD_STEP = 300
export const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000
export const HISTORY_CACHE_MAX_ENTRIES = 24

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

interface HistoryCacheEntry {
  value: LoadedChatHistory
  expiresAt: number
}

const historyCache = new Map<string, HistoryCacheEntry>()
const inflightRequests = new Map<string, Promise<LoadedChatHistory>>()

function cacheKey(sessionId: string, windowSize: number): string {
  return `${sessionId}:${windowSize}`
}

export async function loadChatHistoryWindow(
  sessionId: string,
  windowSize: number,
): Promise<LoadedChatHistory> {
  const key = cacheKey(sessionId, windowSize)
  const cached = readHistoryCache(key)
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
    writeHistoryCache(key, loaded)
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

function readHistoryCache(key: string): LoadedChatHistory | null {
  purgeExpiredHistoryCacheEntries()

  const entry = historyCache.get(key)
  if (!entry) return null

  historyCache.delete(key)
  historyCache.set(key, {
    value: entry.value,
    expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
  })

  return entry.value
}

function writeHistoryCache(key: string, value: LoadedChatHistory): void {
  purgeExpiredHistoryCacheEntries()

  if (historyCache.has(key)) {
    historyCache.delete(key)
  }

  historyCache.set(key, {
    value,
    expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
  })

  while (historyCache.size > HISTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = historyCache.keys().next().value
    if (!oldestKey) break
    historyCache.delete(oldestKey)
  }
}

function purgeExpiredHistoryCacheEntries(now = Date.now()): void {
  for (const [key, entry] of historyCache.entries()) {
    if (entry.expiresAt <= now) {
      historyCache.delete(key)
    }
  }
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
      dividerMeta: {
        kind: 'history-window',
        loadedRecords: metadata.loadedRecords,
        totalRecords: metadata.totalRecords,
        remainingRecords: Math.max(0, metadata.totalRecords - metadata.loadedRecords),
      },
    },
    ...restored,
  ]
}
