import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkRateLimit,
  recordRequest,
  consumeQuota,
  resetRateLimiters,
  getRateLimitStats,
  getAllRateLimitStats,
  DEFAULT_RATE_LIMIT,
} from '@/ai-gateway/rateLimiter'

describe('rateLimiter', () => {
  beforeEach(() => {
    resetRateLimiters()
  })

  describe('checkRateLimit', () => {
    it('allows requests under the limit', () => {
      const result = checkRateLimit('p1')
      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(0)
      expect(result.remaining).toBe(DEFAULT_RATE_LIMIT.maxRequests)
    })

    it('blocks requests over the limit', () => {
      const now = Date.now()
      for (let i = 0; i < DEFAULT_RATE_LIMIT.maxRequests; i++) {
        recordRequest('p1', DEFAULT_RATE_LIMIT, now)
      }
      const result = checkRateLimit('p1', DEFAULT_RATE_LIMIT, now)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('resets after window expires', () => {
      const now = Date.now()
      for (let i = 0; i < DEFAULT_RATE_LIMIT.maxRequests; i++) {
        recordRequest('p1', DEFAULT_RATE_LIMIT, now)
      }
      expect(checkRateLimit('p1', DEFAULT_RATE_LIMIT, now).allowed).toBe(false)
      expect(checkRateLimit('p1', DEFAULT_RATE_LIMIT, now + DEFAULT_RATE_LIMIT.windowMs + 1).allowed).toBe(true)
    })
  })

  describe('consumeQuota', () => {
    it('allows and records on first call', () => {
      const result = consumeQuota('p1')
      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(1)
    })

    it('blocks when limit reached', () => {
      const now = Date.now()
      const config = { windowMs: 60_000, maxRequests: 3 }
      consumeQuota('p1', config, now)
      consumeQuota('p1', config, now)
      consumeQuota('p1', config, now)
      const result = consumeQuota('p1', config, now)
      expect(result.allowed).toBe(false)
    })

    it('tracks throttledCount', () => {
      const config = { windowMs: 60_000, maxRequests: 1 }
      consumeQuota('p1', config)
      consumeQuota('p1', config)
      const stats = getRateLimitStats('p1', config)
      expect(stats.throttledCount).toBe(1)
    })
  })

  describe('getRateLimitStats', () => {
    it('returns correct stats after mixed requests', () => {
      const config = { windowMs: 60_000, maxRequests: 5 }
      recordRequest('p1', config)
      recordRequest('p1', config)
      const stats = getRateLimitStats('p1', config)
      expect(stats.currentCount).toBe(2)
      expect(stats.maxRequests).toBe(5)
      expect(stats.throttledCount).toBe(0)
    })
  })

  describe('getAllRateLimitStats', () => {
    it('returns stats for all tracked providers', () => {
      recordRequest('p1')
      recordRequest('p2')
      const all = getAllRateLimitStats()
      expect(all).toHaveLength(2)
      const ids = all.map(s => s.providerId).sort()
      expect(ids).toEqual(['p1', 'p2'])
    })
  })

  describe('per-provider isolation', () => {
    it('tracks limits independently per provider', () => {
      const config = { windowMs: 60_000, maxRequests: 1 }
      consumeQuota('p1', config)
      const p1 = checkRateLimit('p1', config)
      const p2 = checkRateLimit('p2', config)
      expect(p1.allowed).toBe(false)
      expect(p2.allowed).toBe(true)
    })
  })
})
