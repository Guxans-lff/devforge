import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveRoute,
  buildFallbackChain,
  isCircuitOpen,
  recordProviderSuccess,
  recordProviderFailure,
  resetCircuitBreakers,
  getCircuitBreakerStats,
} from '@/ai-gateway/router'
import type { ProviderConfig, ModelConfig } from '@/types/ai'

function makeProvider(id: string, name: string, opts: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    name,
    providerType: 'openai_compat',
    endpoint: `https://api.${id}.com`,
    models: [],
    isDefault: false,
    createdAt: Date.now(),
    ...opts,
  }
}

function makeModel(id: string, caps: Partial<ModelConfig['capabilities']> = {}): ModelConfig {
  return {
    id,
    name: id,
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse: false,
      maxContext: 8192,
      maxOutput: 4096,
      ...caps,
    },
  }
}

describe('router', () => {
  beforeEach(() => {
    resetCircuitBreakers()
  })

  describe('resolveRoute', () => {
    it('returns preferred provider when healthy and meets requirements', () => {
      const p1 = makeProvider('p1', 'P1', {
        models: [makeModel('m1', { toolUse: true, maxContext: 128000 })],
      })
      const result = resolveRoute({
        providers: [p1],
        preferredProvider: p1,
        preferredModel: p1.models[0],
        requirements: { toolUse: true },
      })
      expect(result.provider.id).toBe('p1')
      expect(result.model.id).toBe('m1')
      expect(result.rerouted).toBe(false)
      expect(result.fallbackChain.length).toBeGreaterThanOrEqual(0)
    })

    it('auto-routes when preferred provider circuit is open', () => {
      const p1 = makeProvider('p1', 'P1', { models: [makeModel('m1')] })
      const p2 = makeProvider('p2', 'P2', { models: [makeModel('m2', { maxContext: 128000 })] })

      recordProviderFailure('p1')
      recordProviderFailure('p1')
      expect(isCircuitOpen('p1')).toBe(true)

      const result = resolveRoute({
        providers: [p1, p2],
        preferredProvider: p1,
        preferredModel: p1.models[0],
      })
      expect(result.provider.id).toBe('p2')
      expect(result.rerouted).toBe(true)
    })

    it('auto-routes when preferred model does not meet requirements', () => {
      const p1 = makeProvider('p1', 'P1', {
        models: [makeModel('m1', { toolUse: false })],
      })
      const p2 = makeProvider('p2', 'P2', {
        models: [makeModel('m2', { toolUse: true })],
      })

      const result = resolveRoute({
        providers: [p1, p2],
        preferredProvider: p1,
        preferredModel: p1.models[0],
        requirements: { toolUse: true },
      })
      expect(result.provider.id).toBe('p2')
      expect(result.model.id).toBe('m2')
      expect(result.rerouted).toBe(true)
    })

    it('selects cheapest model when strategy is cost', () => {
      const p1 = makeProvider('p1', 'P1', {
        models: [
          makeModel('expensive', { pricing: { inputPer1m: 10, outputPer1m: 20, currency: 'USD' } }),
          makeModel('cheap', { pricing: { inputPer1m: 1, outputPer1m: 2, currency: 'USD' } }),
        ],
      })

      const result = resolveRoute({
        providers: [p1],
        strategy: 'cost',
      })
      expect(result.model.id).toBe('cheap')
    })

    it('prefers provider with better health status', () => {
      const p1 = makeProvider('p1', 'P1', {
        models: [makeModel('m1')],
        health: { status: 'error', checkedAt: Date.now(), latencyMs: 5000, supportsStream: true, supportsTools: true, supportsUsage: true, lastError: 'timeout' },
      })
      const p2 = makeProvider('p2', 'P2', {
        models: [makeModel('m2')],
        health: { status: 'ok', checkedAt: Date.now(), latencyMs: 500, supportsStream: true, supportsTools: true, supportsUsage: true, lastError: null },
      })

      const result = resolveRoute({ providers: [p1, p2] })
      expect(result.provider.id).toBe('p2')
    })

    it('throws when no providers available', () => {
      expect(() => resolveRoute({ providers: [] })).toThrow('No providers available')
    })
  })

  describe('buildFallbackChain', () => {
    it('includes same-provider downgrade models', () => {
      const p1 = makeProvider('p1', 'P1', {
        models: [
          makeModel('thinking', { thinking: true, toolUse: true }),
          makeModel('stable', { thinking: false, toolUse: true }),
        ],
      })

      const chain = buildFallbackChain([p1], p1, p1.models[0])
      expect(chain.length).toBe(1)
      expect(chain[0].model.id).toBe('stable')
      expect(chain[0].reason).toBe('downgrade_model')
    })

    it('includes alternate providers with same type', () => {
      const p1 = makeProvider('p1', 'P1', {
        models: [makeModel('m1', { toolUse: true })],
      })
      const p2 = makeProvider('p2', 'P2', {
        models: [makeModel('m2', { toolUse: true })],
      })

      const chain = buildFallbackChain([p1, p2], p1, p1.models[0])
      const switchEntry = chain.find(c => c.reason === 'switch_provider')
      expect(switchEntry).toBeDefined()
      expect(switchEntry!.provider.id).toBe('p2')
    })

    it('skips providers with open circuit', () => {
      const p1 = makeProvider('p1', 'P1', { models: [makeModel('m1')] })
      const p2 = makeProvider('p2', 'P2', { models: [makeModel('m2')] })

      recordProviderFailure('p2')
      recordProviderFailure('p2')

      const chain = buildFallbackChain([p1, p2], p1, p1.models[0])
      expect(chain.some(c => c.provider.id === 'p2')).toBe(false)
    })
  })

  describe('circuit breaker', () => {
    it('opens after threshold failures', () => {
      expect(isCircuitOpen('p1')).toBe(false)
      recordProviderFailure('p1')
      expect(isCircuitOpen('p1')).toBe(false)
      recordProviderFailure('p1')
      expect(isCircuitOpen('p1')).toBe(true)
    })

    it('closes after success', () => {
      recordProviderFailure('p1')
      recordProviderFailure('p1')
      expect(isCircuitOpen('p1')).toBe(true)
      recordProviderSuccess('p1')
      expect(isCircuitOpen('p1')).toBe(false)
    })

    it('auto-closes after cooldown', () => {
      const now = Date.now()
      recordProviderFailure('p1', now)
      recordProviderFailure('p1', now)
      expect(isCircuitOpen('p1', now)).toBe(true)
      expect(isCircuitOpen('p1', now + 130_000)).toBe(false)
    })

    it('getCircuitBreakerStats returns correct data', () => {
      recordProviderFailure('p1')
      const stats = getCircuitBreakerStats()
      expect(stats).toHaveLength(1)
      expect(stats[0].providerId).toBe('p1')
      expect(stats[0].failureCount).toBe(1)
      expect(stats[0].open).toBe(false)
    })
  })
})
