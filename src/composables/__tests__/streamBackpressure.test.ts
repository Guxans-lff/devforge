import { describe, expect, it } from 'vitest'
import { DEFAULT_STREAM_BACKPRESSURE_POLICY, shouldFlushImmediately } from '@/composables/ai/streamBackpressure'

describe('streamBackpressure', () => {
  it('keeps default flush interval in the 50-100ms backpressure range', () => {
    expect(DEFAULT_STREAM_BACKPRESSURE_POLICY.flushIntervalMs).toBeGreaterThanOrEqual(50)
    expect(DEFAULT_STREAM_BACKPRESSURE_POLICY.flushIntervalMs).toBeLessThanOrEqual(100)
  })

  it('forces immediate flush when buffered chars exceed policy', () => {
    expect(shouldFlushImmediately({
      pendingTextDelta: 'a'.repeat(9),
      pendingThinkingDelta: 'b',
      policy: { flushIntervalMs: 50, maxBufferedChars: 10 },
    })).toBe(true)
  })

  it('waits for timer when buffered chars are below threshold', () => {
    expect(shouldFlushImmediately({
      pendingTextDelta: 'hello',
      pendingThinkingDelta: '',
      policy: { flushIntervalMs: 50, maxBufferedChars: 10 },
    })).toBe(false)
  })
})
