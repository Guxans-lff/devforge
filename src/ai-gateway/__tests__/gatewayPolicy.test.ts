import { describe, expect, it } from 'vitest'
import {
  buildPolicyFallbackChain,
  describeGatewayPolicyValue,
  normalizeGatewayPolicy,
  resolveGatewayRateLimit,
} from '@/ai-gateway/gatewayPolicy'
import type { ModelConfig, ProviderConfig } from '@/types/ai'

function makeModel(id: string, overrides: Partial<ModelConfig['capabilities']> = {}): ModelConfig {
  return {
    id,
    name: id,
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse: true,
      maxContext: 128000,
      maxOutput: 4096,
      ...overrides,
    },
  }
}

function makeProvider(id: string, models: ModelConfig[]): ProviderConfig {
  return {
    id,
    name: id,
    providerType: 'openai_compat',
    endpoint: `https://api.${id}.com`,
    models,
    isDefault: false,
    createdAt: 1,
  }
}

describe('gatewayPolicy', () => {
  it('normalizes fallback and clamps rate limit policy', () => {
    const policy = normalizeGatewayPolicy({
      fallbackProviderIds: [' p2 ', 'p2', ''],
      routingStrategy: 'speed',
      rateLimit: { windowMs: 10, maxRequests: 0 },
    })

    expect(policy).toMatchObject({
      fallbackEnabled: true,
      fallbackProviderIds: ['p2'],
      routingStrategy: 'speed',
      rateLimit: { windowMs: 1000, maxRequests: 1 },
    })
    expect(resolveGatewayRateLimit(policy)).toEqual({ windowMs: 1000, maxRequests: 1 })
  })

  it('can disable fallback chain completely', () => {
    const primary = makeProvider('p1', [makeModel('m1'), makeModel('m2')])
    const fallback = makeProvider('p2', [makeModel('m3')])

    const chain = buildPolicyFallbackChain({
      providers: [primary, fallback],
      primaryProvider: primary,
      primaryModel: primary.models[0]!,
      policy: { fallbackEnabled: false },
    })

    expect(chain).toEqual([])
  })

  it('filters fallback providers and sorts by capability policy', () => {
    const primary = makeProvider('p1', [makeModel('m1')])
    const weaker = makeProvider('p2', [makeModel('small', { maxContext: 128000, maxOutput: 4096 })])
    const stronger = makeProvider('p3', [makeModel('large', { maxContext: 1000000, maxOutput: 128000, vision: true })])

    const chain = buildPolicyFallbackChain({
      providers: [primary, weaker, stronger],
      primaryProvider: primary,
      primaryModel: primary.models[0]!,
      policy: {
        fallbackProviderIds: ['p2', 'p3'],
        routingStrategy: 'capability',
      },
    })

    expect(chain.map(candidate => candidate.provider.id)).toEqual(['p3', 'p2'])
  })

  it('formats policy values for preview', () => {
    expect(describeGatewayPolicyValue({
      fallbackEnabled: false,
      fallbackProviderIds: ['p2'],
      routingStrategy: 'cost',
      rateLimit: { windowMs: 30000, maxRequests: 5 },
    }, 'fallbackEnabled')).toBe('关闭')
    expect(describeGatewayPolicyValue({
      rateLimit: { windowMs: 30000, maxRequests: 5 },
    }, 'rateLimit')).toBe('30000ms / 5 次')
  })
})
