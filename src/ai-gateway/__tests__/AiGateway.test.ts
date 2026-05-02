import { describe, expect, it, vi, beforeEach } from 'vitest'
import { executeGatewayRequest, abortGatewayRequest } from '@/ai-gateway/AiGateway'
import { clearUsageRecords, getRecentFallbackRecords, getUsageRecords } from '@/ai-gateway/usageTracker'
import { clearGatewayOverrides, setGatewayOverride } from '@/ai-gateway/override'
import type { AiGatewayRequest } from '@/ai-gateway/types'
import type { AiStreamEvent, ProviderConfig, ModelConfig } from '@/types/ai'

const { aiChatStreamMock, aiAbortStreamMock } = vi.hoisted(() => ({
  aiChatStreamMock: vi.fn(),
  aiAbortStreamMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiChatStream: aiChatStreamMock,
  aiAbortStream: aiAbortStreamMock,
}))

function makeProvider(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    providerType: 'openai_compat',
    endpoint: 'https://example.com',
    models: [],
    isDefault: false,
    createdAt: Date.now(),
    ...overrides,
  } as ProviderConfig
}

function makeModel(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse: false,
      maxContext: 128000,
      maxOutput: 4096,
    },
    ...overrides,
  } as ModelConfig
}

function makeRequest(overrides?: Partial<AiGatewayRequest>): AiGatewayRequest {
  return {
    requestId: 'req-1',
    sessionId: 'session-1',
    source: 'chat',
    kind: 'chat_completions',
    messages: [{ role: 'user', content: 'hello' }],
    provider: makeProvider(),
    model: makeModel(),
    apiKey: 'secret',
    ...overrides,
  }
}

describe('AiGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearGatewayOverrides()
    clearUsageRecords()
    aiAbortStreamMock.mockResolvedValue(true)
  })

  it('returns success with content when stream completes', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'Hello world' })
      onEvent({ type: 'Done', finish_reason: 'stop' })
      return { content: 'Hello world', model: 'gpt-4.1', finishReason: 'stop', promptTokens: 5, completionTokens: 2 }
    })

    const events: AiStreamEvent[] = []
    const result = await executeGatewayRequest(makeRequest(), (event) => events.push(event))

    expect(result.status).toBe('success')
    expect(result.content).toBe('Hello world')
    expect(result.model).toBe('gpt-4.1')
    expect(result.finishReason).toBe('stop')
    expect(result.usage.promptTokens).toBe(5)
    expect(result.usage.completionTokens).toBe(2)
    expect(events).toHaveLength(2)
  })

  it('aggregates text deltas into content', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'First ' })
      onEvent({ type: 'TextDelta', delta: 'second' })
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    const result = await executeGatewayRequest(makeRequest(), () => {})
    expect(result.content).toBe('First second')
  })

  it('throws AiGatewayError on network timeout', async () => {
    aiChatStreamMock.mockRejectedValue(new Error('network timeout while streaming'))

    await expect(executeGatewayRequest(makeRequest(), () => {})).rejects.toMatchObject({
      type: 'timeout',
      retryable: true,
    })
  })

  it('throws AiGatewayError on auth failure', async () => {
    aiChatStreamMock.mockRejectedValue(new Error('unauthorized: invalid key'))

    await expect(executeGatewayRequest(makeRequest(), () => {})).rejects.toMatchObject({
      type: 'auth',
      retryable: false,
    })
  })

  it('throws AiGatewayError on rate limit', async () => {
    aiChatStreamMock.mockRejectedValue(new Error('rate limit exceeded 429'))

    await expect(executeGatewayRequest(makeRequest(), () => {})).rejects.toMatchObject({
      type: 'rate_limit',
      retryable: true,
    })
  })

  it('throws AiGatewayError on cancellation', async () => {
    aiChatStreamMock.mockRejectedValue(new Error('user_rejected tool approval'))

    await expect(executeGatewayRequest(makeRequest(), () => {})).rejects.toMatchObject({
      type: 'cancelled',
      retryable: false,
    })
  })

  it('preserves structured retryable from backend error object', async () => {
    aiChatStreamMock.mockRejectedValue({ message: 'temporary upstream failure', retryable: true })

    await expect(executeGatewayRequest(makeRequest(), () => {})).rejects.toMatchObject({
      type: 'unknown',
      message: 'temporary upstream failure',
      retryable: true,
    })
  })

  it('handles undefined aiChatStream return value gracefully', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'ok' })
      onEvent({ type: 'Done', finish_reason: 'stop' })
      // no return statement
    })

    const result = await executeGatewayRequest(makeRequest(), () => {})
    expect(result.status).toBe('success')
    expect(result.content).toBe('ok')
  })

  it('uses fallback provider api key when switching provider', async () => {
    const fallbackProvider = makeProvider({ id: 'fallback-provider' })
    const fallbackModel = makeModel({ id: 'fallback-model' })
    aiChatStreamMock
      .mockRejectedValueOnce(new Error('network 502'))
      .mockImplementationOnce(async (_request, onEvent: (event: AiStreamEvent) => void) => {
        onEvent({ type: 'TextDelta', delta: 'fallback ok' })
        onEvent({ type: 'Done', finish_reason: 'stop' })
      })

    const result = await executeGatewayRequest(makeRequest({
      fallbackChain: [{ provider: fallbackProvider, model: fallbackModel, reason: 'switch_provider' }],
      apiKeysByProvider: { 'fallback-provider': 'fallback-secret' },
    }), () => {})

    expect(result.content).toBe('fallback ok')
    expect(aiChatStreamMock.mock.calls[1]?.[0]).toMatchObject({
      providerType: fallbackProvider.providerType,
      model: 'fallback-model',
      apiKey: 'fallback-secret',
    })
  })

  it('records actual fallback provider and original route', async () => {
    const fallbackProvider = makeProvider({ id: 'fallback-provider' })
    const fallbackModel = makeModel({ id: 'fallback-model' })
    aiChatStreamMock
      .mockRejectedValueOnce(new Error('network 502'))
      .mockImplementationOnce(async (_request, onEvent: (event: AiStreamEvent) => void) => {
        onEvent({ type: 'TextDelta', delta: 'fallback ok' })
        onEvent({ type: 'Done', finish_reason: 'stop' })
      })

    await executeGatewayRequest(makeRequest({
      fallbackChain: [{ provider: fallbackProvider, model: fallbackModel, reason: 'switch_provider' }],
    }), () => {})

    expect(getRecentFallbackRecords(1)[0]).toMatchObject({
      providerId: 'fallback-provider',
      model: 'fallback-model',
      primaryProviderId: 'test-provider',
      primaryModel: 'gpt-4.1',
      fallbackReason: 'switch_provider',
      retryIndex: 1,
      status: 'success',
    })
  })

  it('uses provider security config to allow localhost endpoint', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'local ok' })
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    const result = await executeGatewayRequest(makeRequest({
      provider: makeProvider({
        endpoint: 'http://localhost:11434',
        security: { allowLocalhost: true },
      }),
    }), () => {})

    expect(result.content).toBe('local ok')
  })

  it('checks endpoint security after applying endpoint override', async () => {
    setGatewayOverride('endpoint', 'http://127.0.0.1:11434')

    await expect(executeGatewayRequest(makeRequest(), () => {})).rejects.toMatchObject({
      type: 'provider_error',
      retryable: false,
      message: expect.stringContaining('Endpoint security check failed'),
    })
    expect(aiChatStreamMock).not.toHaveBeenCalled()
    expect(getUsageRecords()[0]).toMatchObject({
      requestId: 'req-1',
      providerId: 'test-provider',
      status: 'error',
      error: { type: 'provider_error' },
    })
  })

  it('checks fallback provider endpoint security before streaming', async () => {
    const fallbackProvider = makeProvider({
      id: 'fallback-provider',
      endpoint: 'http://127.0.0.1:11434',
    })
    const fallbackModel = makeModel({ id: 'fallback-model' })
    aiChatStreamMock.mockRejectedValueOnce(new Error('network 502'))

    await expect(executeGatewayRequest(makeRequest({
      fallbackChain: [{ provider: fallbackProvider, model: fallbackModel, reason: 'switch_provider' }],
    }), () => {})).rejects.toMatchObject({
      type: 'provider_error',
      retryable: false,
      message: expect.stringContaining('Endpoint security check failed'),
    })

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1)
    expect(getUsageRecords().at(-1)).toMatchObject({
      providerId: 'fallback-provider',
      model: 'fallback-model',
      primaryProviderId: 'test-provider',
      retryIndex: 1,
      status: 'error',
      error: { type: 'provider_error' },
    })
  })

  it('checks fallback model token budget before streaming', async () => {
    const fallbackProvider = makeProvider({ id: 'fallback-provider' })
    const fallbackModel = makeModel({
      id: 'tiny-context',
      capabilities: {
        streaming: true,
        vision: false,
        thinking: false,
        toolUse: false,
        maxContext: 8,
        maxOutput: 4,
      },
    })
    aiChatStreamMock.mockRejectedValueOnce(new Error('network 502'))

    await expect(executeGatewayRequest(makeRequest({
      messages: [{ role: 'user', content: 'This message is too large for a tiny fallback model context.' }],
      fallbackChain: [{ provider: fallbackProvider, model: fallbackModel, reason: 'switch_provider' }],
    }), () => {})).rejects.toMatchObject({
      type: 'context_too_long',
      retryable: false,
    })

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1)
  })

  it('forwards abort to aiAbortStream', async () => {
    await abortGatewayRequest('session-1')
    expect(aiAbortStreamMock).toHaveBeenCalledWith('session-1')
  })
})
