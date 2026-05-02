import { beforeEach, describe, expect, it } from 'vitest'
import { buildGatewayDashboardSnapshot } from '@/ai-gateway/gatewayDashboard'
import { consumeQuota, resetRateLimiters } from '@/ai-gateway/rateLimiter'
import { recordProviderFailure, resetCircuitBreakers } from '@/ai-gateway/router'
import { clearUsageRecords, recordUsage, type AiGatewayUsageRecord } from '@/ai-gateway/usageTracker'
import type { ProviderConfig } from '@/types/ai'
import { AiGatewayError } from '@/ai-gateway/types'

function makeProvider(id: string, name: string): ProviderConfig {
  return {
    id,
    name,
    providerType: 'openai_compat',
    endpoint: `https://api.${id}.example.com`,
    models: [],
    isDefault: false,
    createdAt: 1,
  }
}

function makeRecord(overrides: Partial<AiGatewayUsageRecord> = {}): AiGatewayUsageRecord {
  return {
    requestId: 'req-1',
    sessionId: 'session-1',
    source: 'chat',
    kind: 'chat_completions',
    providerId: 'provider-1',
    model: 'model-1',
      startedAt: 100,
      firstTokenAt: 130,
      finishedAt: 200,
    status: 'success',
    ...overrides,
  }
}

describe('gatewayDashboard', () => {
  beforeEach(() => {
    clearUsageRecords()
    resetRateLimiters()
    resetCircuitBreakers()
  })

  it('summarizes current route, cost, tokens, fallback, rate limit and circuit breaker', () => {
    const providers = [
      makeProvider('provider-1', '主服务'),
      makeProvider('provider-2', '备用服务'),
    ]

    recordUsage(makeRecord({
      requestId: 'req-primary',
      providerId: 'provider-1',
      model: 'model-a',
      usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      cost: { inputCost: 0.01, outputCost: 0.02, totalCost: 0.03, currency: 'USD' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-fallback',
      providerId: 'provider-2',
      model: 'model-b',
      primaryProviderId: 'provider-1',
      primaryModel: 'model-a',
      fallbackReason: 'switch_provider',
      retryIndex: 1,
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
      cost: { inputCost: 0.01, outputCost: 0.01, totalCost: 0.02, currency: 'USD' },
    }))

    const now = Date.now()
    consumeQuota('provider-1', { windowMs: 60_000, maxRequests: 2 }, now)
    consumeQuota('provider-1', { windowMs: 60_000, maxRequests: 2 }, now)
    consumeQuota('provider-1', { windowMs: 60_000, maxRequests: 2 }, now)
    recordProviderFailure('provider-2')
    recordProviderFailure('provider-2')

    const snapshot = buildGatewayDashboardSnapshot({ providers, sessionId: 'session-1' })

    expect(snapshot.currentRoute).toMatchObject({
      requestId: 'req-fallback',
      providerName: '备用服务',
      model: 'model-b',
    })
    expect(snapshot.summary).toMatchObject({
      requestCount: 2,
      successCount: 2,
      promptTokens: 180,
      completionTokens: 60,
      totalTokens: 240,
      totalCost: 0.05,
      successRate: 1,
    })
    expect(snapshot.recentFallbacks[0]).toMatchObject({
      requestId: 'req-fallback',
      primaryProviderId: 'provider-1',
      providerName: '备用服务',
      reason: 'switch_provider',
      retryIndex: 1,
      durationMs: 100,
    })
    expect(snapshot.rateLimits[0]).toMatchObject({
      providerId: 'provider-1',
      providerName: '主服务',
      currentCount: 2,
      throttledCount: 1,
    })
    expect(snapshot.circuitBreakers[0]).toMatchObject({
      providerId: 'provider-2',
      providerName: '备用服务',
      open: true,
      failureCount: 2,
    })
  })

  it('extracts SSRF/security block reason from gateway errors', () => {
    recordUsage(makeRecord({
      requestId: 'req-security',
      providerId: 'provider-1',
      status: 'error',
      error: new AiGatewayError(
        'provider_error',
        'Endpoint security check failed: Private IP is not allowed',
        false,
      ),
    }))

    const snapshot = buildGatewayDashboardSnapshot({
      providers: [makeProvider('provider-1', '主服务')],
    })

    expect(snapshot.securityBlocks).toHaveLength(1)
    expect(snapshot.securityBlocks[0]).toMatchObject({
      requestId: 'req-security',
      providerName: '主服务',
      reason: 'Private IP is not allowed',
      errorType: 'provider_error',
    })
    expect(snapshot.summary.errorCount).toBe(1)
  })

  it('projects route latency and error detail for failed requests', () => {
    recordUsage(makeRecord({
      requestId: 'req-error',
      status: 'error',
      error: new AiGatewayError('rate_limit', 'Rate limit exceeded', true),
      startedAt: 100,
      firstTokenAt: undefined,
      finishedAt: 180,
    }))

    const snapshot = buildGatewayDashboardSnapshot()

    expect(snapshot.currentRoute).toMatchObject({
      requestId: 'req-error',
      durationMs: 80,
      firstTokenLatencyMs: null,
      fallback: false,
      errorType: 'rate_limit',
      errorMessage: 'Rate limit exceeded',
    })
  })

  it('can scope records by session', () => {
    recordUsage(makeRecord({ requestId: 'req-1', sessionId: 'session-1' }))
    recordUsage(makeRecord({ requestId: 'req-2', sessionId: 'session-2' }))

    const snapshot = buildGatewayDashboardSnapshot({ sessionId: 'session-2' })

    expect(snapshot.summary.requestCount).toBe(1)
    expect(snapshot.currentRoute?.requestId).toBe('req-2')
  })
})
