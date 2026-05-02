import { describe, expect, it } from 'vitest'
import { auditGatewayPolicy } from '@/ai-gateway/gatewayPolicyAudit'
import type { ProviderConfig } from '@/types/ai'

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: '主 Provider',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    isDefault: true,
    createdAt: 1,
    models: [{
      id: 'model-1',
      name: '主模型',
      capabilities: {
        streaming: true,
        vision: true,
        thinking: true,
        toolUse: true,
        maxContext: 1000000,
        maxOutput: 128000,
      },
    }],
    ...overrides,
  }
}

describe('gatewayPolicyAudit', () => {
  it('reports disabled fallback with gateway errors as danger', () => {
    const issues = auditGatewayPolicy({
      policy: { fallbackEnabled: false },
      providers: [makeProvider()],
      gatewayErrorCount: 1,
    })

    expect(issues).toContainEqual(expect.objectContaining({
      key: 'fallback-disabled-with-errors',
      level: 'danger',
    }))
  })

  it('reports missing, primary, weak fallback, and aggressive rate limit', () => {
    const primary = makeProvider()
    const weak = makeProvider({
      id: 'provider-2',
      name: '弱 Provider',
      isDefault: false,
      models: [{
        id: 'weak-model',
        name: '弱模型',
        capabilities: {
          streaming: false,
          vision: false,
          thinking: false,
          toolUse: false,
          maxContext: 4096,
          maxOutput: 1024,
        },
      }],
    })

    const issues = auditGatewayPolicy({
      policy: {
        fallbackEnabled: true,
        fallbackProviderIds: ['provider-1', 'provider-2', 'provider-missing'],
        rateLimit: { windowMs: 5000, maxRequests: 100 },
      },
      providers: [primary, weak],
      primaryProviderId: primary.id,
    })

    expect(issues.map(issue => issue.key)).toEqual(expect.arrayContaining([
      'missing-fallback-provider',
      'primary-fallback-provider',
      'weak-fallback-capability',
      'aggressive-rate-limit',
    ]))
  })

  it('allows caller to tune single provider level and primary fallback copy', () => {
    const issues = auditGatewayPolicy({
      policy: {
        fallbackEnabled: true,
        fallbackProviderIds: ['provider-1'],
      },
      providers: [makeProvider()],
      primaryProviderId: 'provider-1',
      singleProviderLevel: 'warning',
      primaryFallbackMessage: '自定义主 Provider 提示',
    })

    expect(issues).toContainEqual(expect.objectContaining({
      key: 'single-provider-fallback',
      level: 'warning',
    }))
    expect(issues).toContainEqual(expect.objectContaining({
      key: 'primary-fallback-provider',
      message: '自定义主 Provider 提示',
    }))
  })
})
