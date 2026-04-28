import { describe, expect, it, beforeEach } from 'vitest'
import {
  recordUsage,
  getUsageRecords,
  getUsageRecordsBySession,
  getSessionUsageSummary,
  getProviderUsageSummary,
  clearUsageRecords,
} from '@/ai-gateway/usageTracker'
import type { AiGatewayUsageRecord } from '@/ai-gateway/usageTracker'

function makeRecord(overrides?: Partial<AiGatewayUsageRecord>): AiGatewayUsageRecord {
  return {
    requestId: 'req-1',
    sessionId: 'session-1',
    source: 'chat',
    kind: 'chat_completions',
    providerId: 'provider-1',
    model: 'model-1',
    startedAt: Date.now(),
    finishedAt: Date.now(),
    status: 'success',
    ...overrides,
  }
}

describe('usageTracker', () => {
  beforeEach(() => {
    clearUsageRecords()
  })

  it('records usage and retrieves all records', () => {
    recordUsage(makeRecord({ requestId: 'req-1' }))
    recordUsage(makeRecord({ requestId: 'req-2' }))

    expect(getUsageRecords()).toHaveLength(2)
    expect(getUsageRecords()[0]!.requestId).toBe('req-1')
    expect(getUsageRecords()[1]!.requestId).toBe('req-2')
  })

  it('filters records by session', () => {
    recordUsage(makeRecord({ requestId: 'req-1', sessionId: 'session-a' }))
    recordUsage(makeRecord({ requestId: 'req-2', sessionId: 'session-b' }))
    recordUsage(makeRecord({ requestId: 'req-3', sessionId: 'session-a' }))

    const records = getUsageRecordsBySession('session-a')
    expect(records).toHaveLength(2)
    expect(records.map(r => r.requestId)).toEqual(['req-1', 'req-3'])
  })

  it('summarizes session usage', () => {
    recordUsage(makeRecord({
      requestId: 'req-1',
      sessionId: 'session-a',
      status: 'success',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-2',
      sessionId: 'session-a',
      status: 'error',
      usage: { promptTokens: 20, completionTokens: 0, totalTokens: 20 },
    }))

    const summary = getSessionUsageSummary('session-a')
    expect(summary.requestCount).toBe(2)
    expect(summary.promptTokens).toBe(30)
    expect(summary.completionTokens).toBe(5)
    expect(summary.totalTokens).toBe(35)
    expect(summary.totalCost).toBe(0.003)
    expect(summary.currency).toBe('USD')
    expect(summary.errorCount).toBe(1)
  })

  it('summarizes provider usage', () => {
    recordUsage(makeRecord({
      requestId: 'req-1',
      providerId: 'provider-x',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      cost: { inputCost: 0.01, outputCost: 0.02, totalCost: 0.03, currency: 'CNY' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-2',
      providerId: 'provider-y',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }))

    const summary = getProviderUsageSummary('provider-x')
    expect(summary.requestCount).toBe(1)
    expect(summary.promptTokens).toBe(100)
    expect(summary.completionTokens).toBe(50)
    expect(summary.totalTokens).toBe(150)
    expect(summary.totalCost).toBe(0.03)
    expect(summary.currency).toBe('CNY')
  })

  it('returns zero summary for unknown session', () => {
    const summary = getSessionUsageSummary('unknown')
    expect(summary.requestCount).toBe(0)
    expect(summary.promptTokens).toBe(0)
    expect(summary.totalCost).toBe(0)
    expect(summary.currency).toBe('USD')
  })

  it('clears all records', () => {
    recordUsage(makeRecord())
    clearUsageRecords()
    expect(getUsageRecords()).toHaveLength(0)
  })
})
