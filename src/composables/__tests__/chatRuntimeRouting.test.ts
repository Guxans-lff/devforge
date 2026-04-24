import { beforeEach, describe, expect, it } from 'vitest'
import type { ModelConfig, ProviderConfig } from '@/types/ai'
import {
  recordProviderTransientFailure,
  resolveRetryableFailureFallback,
  resolveRuntimeRoute,
  resetProviderRuntimeRoutingForTests,
} from '@/composables/ai/chatRuntimeRouting'

function makeModel(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    id: 'model-thinking',
    name: 'Thinking',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: true,
      toolUse: true,
      maxContext: 200000,
      maxOutput: 8192,
      ...overrides?.capabilities,
    },
    ...overrides,
  }
}

function makeProvider(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    models: [
      makeModel(),
      makeModel({
        id: 'model-stable',
        name: 'Stable',
        capabilities: {
          streaming: true,
          vision: false,
          thinking: false,
          toolUse: true,
          maxContext: 200000,
          maxOutput: 4096,
        },
      }),
    ],
    isDefault: true,
    createdAt: 1,
    ...overrides,
  }
}

describe('chatRuntimeRouting', () => {
  beforeEach(() => {
    resetProviderRuntimeRoutingForTests()
  })

  it('downgrades to a stable non-thinking model after retryable failures', () => {
    const provider = makeProvider()
    const currentModel = provider.models[0]!

    const fallback = resolveRetryableFailureFallback([provider], provider, currentModel)

    expect(fallback).toMatchObject({
      rerouted: true,
      provider,
      model: expect.objectContaining({ id: 'model-stable' }),
      reason: 'downgrade_model',
    })
  })

  it('reroutes away from a provider with an open runtime circuit', () => {
    const providerA = makeProvider({ id: 'provider-a', name: 'Provider A' })
    const providerB = makeProvider({ id: 'provider-b', name: 'Provider B' })
    const now = 10_000

    recordProviderTransientFailure(providerA.id, now)
    recordProviderTransientFailure(providerA.id, now + 1)

    const route = resolveRuntimeRoute([providerA, providerB], providerA, providerA.models[0]!, now + 2)

    expect(route).toMatchObject({
      rerouted: true,
      provider: expect.objectContaining({ id: 'provider-b' }),
      model: expect.objectContaining({ id: 'model-thinking' }),
      reason: 'provider_circuit_open',
    })
  })
})
