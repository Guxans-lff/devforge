import { describe, expect, it } from 'vitest'
import { limitScreenshotHistory } from '../screenshotHistoryLimit'
import type { ScreenshotHistoryItem } from '@/types/screenshot'

function item(id: string, capturedAt: string): ScreenshotHistoryItem {
  return {
    id,
    filePath: `${id}.png`,
    width: 100,
    height: 100,
    fileSize: 1024,
    capturedAt,
  }
}

describe('screenshotHistoryLimit', () => {
  it('keeps newest screenshots within limit', () => {
    const result = limitScreenshotHistory([
      item('old', '2026-01-01T00:00:00.000Z'),
      item('new', '2026-01-03T00:00:00.000Z'),
      item('mid', '2026-01-02T00:00:00.000Z'),
    ], 2)

    expect(result.map((entry) => entry.id)).toEqual(['new', 'mid'])
  })

  it('returns empty list for disabled limit', () => {
    expect(limitScreenshotHistory([item('a', '2026-01-01T00:00:00.000Z')], 0)).toEqual([])
  })
})
