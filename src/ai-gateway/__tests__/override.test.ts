import { describe, it, expect, beforeEach } from 'vitest'
import {
  setGatewayOverride,
  setGatewayOverrides,
  clearGatewayOverride,
  clearGatewayOverrides,
  getGatewayOverrides,
  hasActiveOverrides,
  applyGatewayOverrides,
  OVERRIDE_KEYS,
} from '@/ai-gateway/override'

describe('override', () => {
  beforeEach(() => {
    clearGatewayOverrides()
  })

  describe('setGatewayOverride', () => {
    it('sets a single override', () => {
      setGatewayOverride('endpoint', 'https://override.example.com')
      const overrides = getGatewayOverrides()
      expect(overrides.endpoint).toBe('https://override.example.com')
    })

    it('clears override when value is undefined', () => {
      setGatewayOverride('endpoint', 'https://override.example.com')
      setGatewayOverride('endpoint', undefined)
      const overrides = getGatewayOverrides()
      expect(overrides.endpoint).toBeUndefined()
    })
  })

  describe('setGatewayOverrides', () => {
    it('sets multiple overrides', () => {
      setGatewayOverrides({
        endpoint: 'https://override.example.com',
        model: 'gpt-4-override',
        maxTokens: 4096,
      })
      const overrides = getGatewayOverrides()
      expect(overrides.endpoint).toBe('https://override.example.com')
      expect(overrides.model).toBe('gpt-4-override')
      expect(overrides.maxTokens).toBe(4096)
    })
  })

  describe('clearGatewayOverrides', () => {
    it('clears all overrides', () => {
      setGatewayOverrides({ endpoint: 'https://a.com', model: 'm1' })
      clearGatewayOverrides()
      expect(hasActiveOverrides()).toBe(false)
      expect(getGatewayOverrides()).toEqual({})
    })
  })

  describe('hasActiveOverrides', () => {
    it('returns false when no overrides', () => {
      expect(hasActiveOverrides()).toBe(false)
    })

    it('returns true when overrides exist', () => {
      setGatewayOverride('model', 'test-model')
      expect(hasActiveOverrides()).toBe(true)
    })
  })

  describe('applyGatewayOverrides', () => {
    const baseRequest = {
      provider: { id: 'openai', providerType: 'openai', endpoint: 'https://api.openai.com' },
      model: { id: 'gpt-4', name: 'GPT-4', maxTokens: 8192 },
      apiKey: 'sk-original',
      maxTokens: 2048,
      temperature: 0.7,
      systemPrompt: 'You are a helpful assistant.',
    }

    it('returns original request when no overrides', () => {
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toEqual([])
      expect(result.overridden.provider.endpoint).toBe('https://api.openai.com')
      expect(result.overridden.model.id).toBe('gpt-4')
    })

    it('applies endpoint override', () => {
      setGatewayOverride('endpoint', 'https://proxy.example.com')
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toContain('endpoint')
      expect(result.overridden.provider.endpoint).toBe('https://proxy.example.com')
    })

    it('applies model override', () => {
      setGatewayOverride('model', 'claude-3-opus')
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toContain('model')
      expect(result.overridden.model.id).toBe('claude-3-opus')
      // Keep other model properties
      expect(result.overridden.model.name).toBe('GPT-4')
    })

    it('applies apiKey override', () => {
      setGatewayOverride('apiKey', 'sk-override')
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toContain('apiKey')
      expect(result.overridden.apiKey).toBe('sk-override')
    })

    it('applies maxTokens override', () => {
      setGatewayOverride('maxTokens', 4096)
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toContain('maxTokens')
      expect(result.overridden.maxTokens).toBe(4096)
    })

    it('applies temperature override', () => {
      setGatewayOverride('temperature', 1.0)
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toContain('temperature')
      expect(result.overridden.temperature).toBe(1.0)
    })

    it('applies systemPrompt override', () => {
      setGatewayOverride('systemPrompt', 'Override prompt')
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toContain('systemPrompt')
      expect(result.overridden.systemPrompt).toBe('Override prompt')
    })

    it('applies multiple overrides at once', () => {
      setGatewayOverrides({
        endpoint: 'https://proxy.example.com',
        model: 'gpt-3.5-turbo',
        maxTokens: 1024,
      })
      const result = applyGatewayOverrides(baseRequest)
      expect(result.applied).toEqual(['endpoint', 'model', 'maxTokens'])
    })

    it('does not mutate original request', () => {
      setGatewayOverride('endpoint', 'https://proxy.example.com')
      const originalEndpoint = baseRequest.provider.endpoint
      applyGatewayOverrides(baseRequest)
      expect(baseRequest.provider.endpoint).toBe(originalEndpoint)
    })

    it('reports all overridable keys', () => {
      expect(OVERRIDE_KEYS).toContain('endpoint')
      expect(OVERRIDE_KEYS).toContain('model')
      expect(OVERRIDE_KEYS).toContain('apiKey')
      expect(OVERRIDE_KEYS).toContain('maxTokens')
      expect(OVERRIDE_KEYS).toContain('temperature')
      expect(OVERRIDE_KEYS).toContain('systemPrompt')
    })
  })
})
