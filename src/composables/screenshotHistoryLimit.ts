import type { ScreenshotHistoryItem } from '@/types/screenshot'

export const DEFAULT_SCREENSHOT_HISTORY_LIMIT = 300

export function limitScreenshotHistory(
  items: readonly ScreenshotHistoryItem[],
  limit = DEFAULT_SCREENSHOT_HISTORY_LIMIT,
): ScreenshotHistoryItem[] {
  if (limit <= 0) return []
  if (items.length <= limit) return [...items]

  return [...items]
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
    .slice(0, limit)
}
