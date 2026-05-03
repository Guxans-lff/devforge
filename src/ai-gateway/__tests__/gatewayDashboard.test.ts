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
      providerProfileId: 'profile-coding',
      providerId: 'provider-2',
      model: 'model-b',
      primaryProviderId: 'provider-1',
      primaryModel: 'model-a',
      fallbackReason: 'switch_provider',
      fallbackChainId: 'provider-1->provider-2',
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
      providerProfileId: 'profile-coding',
      providerId: 'provider-2',
      providerName: '备用服务',
      model: 'model-b',
      primaryProviderId: 'provider-1',
      primaryModel: 'model-a',
      retryIndex: 1,
      fallbackReason: 'switch_provider',
      fallbackChainId: 'provider-1->provider-2',
      fallback: true,
      promptTokens: 80,
      completionTokens: 20,
      totalTokens: 100,
      totalCost: 0.02,
      currency: 'USD',
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
      providerProfileId: 'profile-coding',
      primaryProviderId: 'provider-1',
      providerName: '备用服务',
      reason: 'switch_provider',
      fallbackChainId: 'provider-1->provider-2',
      retryIndex: 1,
      durationMs: 100,
      promptTokens: 80,
      completionTokens: 20,
      totalTokens: 100,
      totalCost: 0.02,
      currency: 'USD',
    })
    expect(snapshot.profileSummaries).toEqual([
      expect.objectContaining({
        providerProfileId: 'provider-1',
        requestCount: 1,
        successCount: 1,
        errorCount: 0,
        fallbackCount: 0,
        successRate: 1,
        providerCount: 1,
        modelCount: 1,
        totalTokens: 140,
        totalCost: 0.03,
      }),
      expect.objectContaining({
        providerProfileId: 'profile-coding',
        requestCount: 1,
        successCount: 1,
        errorCount: 0,
        fallbackCount: 1,
        successRate: 1,
        providerCount: 1,
        modelCount: 1,
        totalTokens: 100,
        totalCost: 0.02,
      }),
    ])
    expect(snapshot.modelSummaries).toEqual([
      expect.objectContaining({
        key: 'provider-1:model-a',
        providerName: '主服务',
        model: 'model-a',
        requestCount: 1,
        successCount: 1,
        successRate: 1,
        fallbackCount: 0,
        avgDurationMs: 100,
        avgFirstTokenLatencyMs: 30,
        totalTokens: 140,
        totalCost: 0.03,
      }),
      expect.objectContaining({
        key: 'provider-2:model-b',
        providerName: '备用服务',
        model: 'model-b',
        requestCount: 1,
        successCount: 1,
        successRate: 1,
        fallbackCount: 1,
        avgDurationMs: 100,
        avgFirstTokenLatencyMs: 30,
        totalTokens: 100,
        totalCost: 0.02,
      }),
    ])
    expect(snapshot.rateLimits[0]).toMatchObject({
      providerId: 'provider-1',
      providerName: '主服务',
      currentCount: 2,
      throttledCount: 1,
    })
    expect(snapshot.providerSummaries[0]).toMatchObject({
      providerId: 'provider-1',
      providerName: '主服务',
      requestCount: 1,
      successCount: 1,
      errorCount: 0,
      fallbackCount: 0,
      successRate: 1,
      avgDurationMs: 100,
      avgFirstTokenLatencyMs: 30,
      totalTokens: 140,
      totalCost: 0.03,
    })
    expect(snapshot.providerSummaries[1]).toMatchObject({
      providerId: 'provider-2',
      providerName: '备用服务',
      requestCount: 1,
      successCount: 1,
      errorCount: 0,
      fallbackCount: 1,
      successRate: 1,
      avgDurationMs: 100,
      avgFirstTokenLatencyMs: 30,
      totalTokens: 100,
      totalCost: 0.02,
    })
    expect(snapshot.circuitBreakers[0]).toMatchObject({
      providerId: 'provider-2',
      providerName: '备用服务',
      open: true,
      failureCount: 2,
    })
    expect(snapshot.sla).toMatchObject({
      status: 'critical',
      requestCount: 2,
      successRate: 1,
      fallbackRate: 0.5,
      errorRate: 0,
      throttledProviderCount: 1,
      openCircuitCount: 1,
      p95DurationMs: 100,
      p95FirstTokenLatencyMs: 30,
    })
    expect(snapshot.sla.recommendations).toContain('Fallback 比例偏高，建议检查主 Provider 稳定性或调整路由策略。')
    expect(snapshot.sla.recommendations).toContain('存在 Provider 限流命中，建议调整 Profile 限流或降低并发。')
    expect(snapshot.sla.recommendations).toContain('存在熔断打开的 Provider，建议查看最近错误聚合并切换备用模型。')
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

  it('can scope records by provider profile id', () => {
    recordUsage(makeRecord({
      requestId: 'req-profile-a',
      providerId: 'provider-1',
      providerProfileId: 'profile-a',
    }))
    recordUsage(makeRecord({
      requestId: 'req-profile-b',
      providerId: 'provider-2',
      providerProfileId: 'profile-b',
    }))

    const snapshot = buildGatewayDashboardSnapshot({
      providerProfileIds: ['profile-b'],
    })

    expect(snapshot.appliedFilters.providerProfileIds).toEqual(['profile-b'])
    expect(snapshot.summary.requestCount).toBe(1)
    expect(snapshot.currentRoute).toMatchObject({
      requestId: 'req-profile-b',
      providerProfileId: 'profile-b',
      providerId: 'provider-2',
    })
    expect(snapshot.providerSummaries[0]).toMatchObject({
      providerProfileId: 'profile-b',
      providerId: 'provider-2',
    })
  })

  it('filters by provider, source, status, time range and builds cost trend buckets', () => {
    recordUsage(makeRecord({
      requestId: 'req-chat-a',
      sessionId: 'session-a',
      providerId: 'provider-1',
      source: 'chat',
      status: 'success',
      startedAt: 1_000,
      finishedAt: 1_500,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: { inputCost: 0.01, outputCost: 0.02, totalCost: 0.03, currency: 'USD' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-prompt',
      sessionId: 'session-a',
      providerId: 'provider-1',
      source: 'prompt_optimize',
      status: 'success',
      startedAt: 2_000,
      finishedAt: 2_500,
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      cost: { inputCost: 0.02, outputCost: 0.03, totalCost: 0.05, currency: 'USD' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-chat-b',
      sessionId: 'session-a',
      providerId: 'provider-2',
      source: 'chat',
      status: 'error',
      startedAt: 61_000,
      finishedAt: 61_500,
      usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
      cost: { inputCost: 0.03, outputCost: 0.04, totalCost: 0.07, currency: 'USD' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-chat-c',
      sessionId: 'session-a',
      providerId: 'provider-1',
      source: 'chat',
      status: 'success',
      startedAt: 121_000,
      finishedAt: 121_500,
      usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
      cost: { inputCost: 0.04, outputCost: 0.05, totalCost: 0.09, currency: 'USD' },
    }))

    const snapshot = buildGatewayDashboardSnapshot({
      sessionId: 'session-a',
      providerIds: ['provider-1'],
      sources: ['chat'],
      statuses: ['success'],
      from: 1_000,
      to: 122_000,
      trendBucketMs: 60_000,
      maxTrendPoints: 2,
    })

    expect(snapshot.appliedFilters).toMatchObject({
      sessionId: 'session-a',
      providerIds: ['provider-1'],
      sources: ['chat'],
      statuses: ['success'],
      from: 1_000,
      to: 122_000,
    })
    expect(snapshot.summary).toMatchObject({
      requestCount: 2,
      successCount: 2,
      totalTokens: 75,
      totalCost: 0.12,
    })
    expect(snapshot.currentRoute?.requestId).toBe('req-chat-c')
    expect(snapshot.costTrend).toHaveLength(2)
    expect(snapshot.costTrend[0]).toMatchObject({
      bucketStart: 0,
      requestCount: 1,
      totalTokens: 15,
      totalCost: 0.03,
    })
    expect(snapshot.costTrend[1]).toMatchObject({
      bucketStart: 120_000,
      requestCount: 1,
      totalTokens: 60,
      totalCost: 0.09,
    })
  })

  it('summarizes gateway usage by source and error type', () => {
    recordUsage(makeRecord({
      requestId: 'req-chat-success',
      source: 'chat',
      providerId: 'provider-1',
      status: 'success',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: { inputCost: 0.01, outputCost: 0.01, totalCost: 0.02, currency: 'USD' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-chat-fallback-error',
      source: 'chat',
      providerId: 'provider-2',
      primaryProviderId: 'provider-1',
      primaryModel: 'model-a',
      fallbackReason: 'switch_provider',
      retryIndex: 1,
      status: 'error',
      error: new AiGatewayError('provider_error', 'upstream failed', true),
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      cost: { inputCost: 0.02, outputCost: 0.02, totalCost: 0.04, currency: 'USD' },
    }))
    recordUsage(makeRecord({
      requestId: 'req-compact-error',
      source: 'compact',
      kind: 'compact',
      providerId: 'provider-1',
      status: 'error',
      error: new AiGatewayError('context_too_long', 'context exceeded', false),
      usage: { promptTokens: 50, completionTokens: 0, totalTokens: 50 },
      cost: { inputCost: 0.05, outputCost: 0, totalCost: 0.05, currency: 'USD' },
    }))

    const snapshot = buildGatewayDashboardSnapshot({
      providers: [
        makeProvider('provider-1', '主服务'),
        makeProvider('provider-2', '备用服务'),
      ],
    })

    expect(snapshot.sourceSummaries).toEqual([
      expect.objectContaining({
        source: 'chat',
        requestCount: 2,
        errorCount: 1,
        fallbackCount: 1,
        totalTokens: 45,
        totalCost: 0.06,
      }),
      expect.objectContaining({
        source: 'compact',
        requestCount: 1,
        errorCount: 1,
        fallbackCount: 0,
        totalTokens: 50,
        totalCost: 0.05,
      }),
    ])
    expect(snapshot.kindSummaries).toEqual([
      expect.objectContaining({
        kind: 'chat_completions',
        requestCount: 2,
        successCount: 1,
        errorCount: 1,
        fallbackCount: 1,
        successRate: 0.5,
        totalTokens: 45,
        totalCost: 0.06,
      }),
      expect.objectContaining({
        kind: 'compact',
        requestCount: 1,
        successCount: 0,
        errorCount: 1,
        fallbackCount: 0,
        successRate: 0,
        totalTokens: 50,
        totalCost: 0.05,
      }),
    ])
    expect(snapshot.errorSummaries).toEqual([
      expect.objectContaining({
        key: 'provider_error:chat:provider-2',
        errorType: 'provider_error',
        source: 'chat',
        providerName: '备用服务',
        count: 1,
        retryableCount: 1,
        latestMessage: 'upstream failed',
      }),
      expect.objectContaining({
        key: 'context_too_long:compact:provider-1',
        errorType: 'context_too_long',
        source: 'compact',
        providerName: '主服务',
        count: 1,
        retryableCount: 0,
        latestMessage: 'context exceeded',
      }),
    ])
  })
})
