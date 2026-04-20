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

export async function loadChatHistoryWindow(
  sessionId: string,
  windowSize: number,
): Promise<LoadedChatHistory> {
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
      dividerText: `已仅加载最近 ${metadata.loadedRecords} / ${metadata.totalRecords} 条历史记录`,
    },
    ...restored,
  ]
}
