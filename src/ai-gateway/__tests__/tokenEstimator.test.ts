import { describe, it, expect } from 'vitest'
import {
  estimateTextTokens,
  estimateInputTokens,
  estimateRequestTokens,
  estimateCost,
} from '@/ai-gateway/tokenEstimator'
import type { ChatMessage } from '@/api/ai'
import type { ModelConfig } from '@/types/ai'

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'gpt-test',
    name: 'Test Model',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse: false,
      maxContext: 8192,
      maxOutput: 4096,
      ...overrides.capabilities,
    },
    ...overrides,
  }
}

describe('tokenEstimator', () => {
  describe('estimateTextTokens', () => {
    it('estimates English text', () => {
      const text = 'Hello world, this is a test message.'
      const tokens = estimateTextTokens(text)
      // English ~4 chars per token
      expect(tokens).toBeGreaterThanOrEqual(Math.ceil(text.length / 4))
      expect(tokens).toBeLessThanOrEqual(Math.ceil(text.length / 3))
    })

    it('estimates Chinese text with higher ratio', () => {
      const text = '你好世界，这是一个测试消息。'
      const tokens = estimateTextTokens(text)
      // Chinese ~1.5 chars per token
      expect(tokens).toBeGreaterThanOrEqual(Math.ceil(text.length / 2))
    })

    it('returns 0 for empty string', () => {
      expect(estimateTextTokens('')).toBe(0)
    })
  })

  describe('estimateInputTokens', () => {
    it('counts messages with overhead', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]
      const tokens = estimateInputTokens(messages)
      // 2 messages * 4 overhead + text tokens
      expect(tokens).toBeGreaterThan(8)
    })

    it('adds system prompt overhead', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }]
      const withSystem = estimateInputTokens(messages, 'You are a helpful assistant.')
      const withoutSystem = estimateInputTokens(messages)
      expect(withSystem).toBeGreaterThan(withoutSystem)
    })

    it('adds tools overhead when enabled', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }]
      const withTools = estimateInputTokens(messages, undefined, true)
      const withoutTools = estimateInputTokens(messages, undefined, false)
      expect(withTools).toBeGreaterThan(withoutTools)
      expect(withTools - withoutTools).toBeGreaterThanOrEqual(800)
    })

    it('counts tool calls', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: '1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/tmp/test"}' } },
          ],
        },
      ]
      const tokens = estimateInputTokens(messages)
      expect(tokens).toBeGreaterThan(4) // overhead + tool name + args
    })
  })

  describe('estimateRequestTokens', () => {
    it('marks within budget when under limit', () => {
      const model = makeModel()
      const messages: ChatMessage[] = [{ role: 'user', content: 'Short message' }]
      const result = estimateRequestTokens({ messages, model })
      expect(result.withinBudget).toBe(true)
      expect(result.budgetRemaining).toBeGreaterThan(0)
    })

    it('marks exceeded when over limit', () => {
      const model = makeModel({ capabilities: { streaming: true, vision: false, thinking: false, toolUse: false, maxContext: 30, maxOutput: 10 } })
      const messages: ChatMessage[] = [
        { role: 'user', content: 'This is a very long message that should definitely exceed the small context limit of thirty tokens when combined with overhead and output estimation.' },
      ]
      const result = estimateRequestTokens({ messages, model })
      expect(result.withinBudget).toBe(false)
      expect(result.budgetUsageRatio).toBeGreaterThan(1)
    })

    it('uses targetMaxTokens for output estimate', () => {
      const model = makeModel()
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }]
      const result = estimateRequestTokens({ messages, model, targetMaxTokens: 2048 })
      expect(result.estimatedOutputTokens).toBe(2048)
    })

    it('calculates budget ratio correctly', () => {
      const model = makeModel({ capabilities: { streaming: true, vision: false, thinking: false, toolUse: false, maxContext: 1000, maxOutput: 500 } })
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello world' }]
      const result = estimateRequestTokens({ messages, model })
      expect(result.budgetUsageRatio).toBeGreaterThan(0)
      expect(result.budgetUsageRatio).toBeLessThan(1)
    })
  })

  describe('estimateCost', () => {
    it('returns hasPricing=false when no pricing', () => {
      const model = makeModel()
      const result = estimateCost({ inputTokens: 1000, estimatedOutputTokens: 500, model })
      expect(result.hasPricing).toBe(false)
      expect(result.estimatedTotalCost).toBe(0)
    })

    it('calculates cost with pricing', () => {
      const model = makeModel({
        capabilities: {
          streaming: true, vision: false, thinking: false, toolUse: false, maxContext: 8192, maxOutput: 4096,
          pricing: { inputPer1m: 2.5, outputPer1m: 10, currency: 'USD' },
        },
      })
      const result = estimateCost({ inputTokens: 1_000_000, estimatedOutputTokens: 500_000, model })
      expect(result.hasPricing).toBe(true)
      expect(result.estimatedInputCost).toBe(2.5)
      expect(result.estimatedOutputCost).toBe(5)
      expect(result.estimatedTotalCost).toBe(7.5)
      expect(result.currency).toBe('USD')
    })
  })
})
