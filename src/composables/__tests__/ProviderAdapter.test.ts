import { describe, expect, it, vi } from 'vitest'
import {
  GenericProviderAdapter,
  createProviderStreamEventHandler,
  getProviderAdapter,
} from '@/composables/ai/providers/ProviderAdapter'
import type { AiStreamEvent, ModelConfig, ProviderConfig } from '@/types/ai'

function makeModel(): ModelConfig {
  return {
    id: 'model-1',
    name: 'Model 1',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: true,
      toolUse: true,
      maxContext: 32000,
      maxOutput: 4096,
    },
  }
}

function makeProvider(): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    providerType: 'openai_compat',
    endpoint: 'https://api.example.com',
    models: [makeModel()],
    isDefault: true,
    createdAt: 1,
  }
}

describe('ProviderAdapter', () => {
  it('builds chat stream params from provider and model config', () => {
    const provider = makeProvider()
    const model = makeModel()
    const adapter = getProviderAdapter(provider.providerType)

    const params = adapter.buildChatStreamParams({
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      provider,
      model,
      apiKey: 'api-key',
      maxTokens: 1024,
      systemPrompt: 'system',
      enableTools: true,
      thinkingBudget: 4096,
    })

    expect(params).toMatchObject({
      sessionId: 'session-1',
      providerType: 'openai_compat',
      model: 'model-1',
      apiKey: 'api-key',
      endpoint: 'https://api.example.com',
      maxTokens: 1024,
      systemPrompt: 'system',
      enableTools: true,
      thinkingBudget: 4096,
    })
  })

  it('filters invalid stream events before forwarding to the main loop', () => {
    const adapter = new GenericProviderAdapter('custom')
    const onEvent = vi.fn()
    const onInvalid = vi.fn()
    const handler = createProviderStreamEventHandler(adapter, onEvent, onInvalid)

    const valid: AiStreamEvent = { type: 'TextDelta', delta: 'hello' }
    handler(valid)
    handler({ type: 'TextDelta' } as unknown as AiStreamEvent)

    expect(onEvent).toHaveBeenCalledWith(valid)
    expect(onInvalid).toHaveBeenCalledTimes(1)
  })

  it('reports missing provider config fields', () => {
    const adapter = new GenericProviderAdapter('custom')
    const errors = adapter.validateConfig({
      id: '',
      name: '',
      providerType: 'openai_compat',
      endpoint: '',
      models: [],
      isDefault: false,
      createdAt: 1,
    })

    expect(errors).toEqual([
      'Provider ID is required',
      'Provider name is required',
      'Endpoint is required',
      'At least one model is required',
    ])
  })
})
