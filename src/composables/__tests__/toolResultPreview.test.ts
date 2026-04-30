import { describe, expect, it } from 'vitest'
import {
  buildToolResultPreview,
  formatToolPreviewNotice,
  stripReadFileResultHeader,
} from '@/composables/ai/toolResultPreview'

describe('toolResultPreview', () => {
  it('limits preview by lines and reports a user-facing notice', () => {
    const preview = buildToolResultPreview(
      Array.from({ length: 40 }, (_, index) => `line-${index}`).join('\n'),
      { maxLines: 5, maxChars: 1_000 },
    )

    expect(preview.text).toContain('line-0')
    expect(preview.text).toContain('line-4')
    expect(preview.text).not.toContain('line-5')
    expect(preview.truncatedByLines).toBe(true)
    expect(formatToolPreviewNotice(preview)).toContain('已显示前 5 行')
  })

  it('limits preview by chars without scanning the full text into DOM', () => {
    const preview = buildToolResultPreview('x'.repeat(5_000), { maxChars: 120 })

    expect(preview.text).toHaveLength(120)
    expect(preview.originalChars).toBe(5_000)
    expect(preview.truncatedByChars).toBe(true)
  })

  it('strips read_file metadata header when needed', () => {
    expect(stripReadFileResultHeader('[文件: a.ts | 2 行]\nconst a = 1')).toBe('const a = 1')
  })
})
