import { describe, expect, it } from 'vitest'
import { normalizeAiErrorMessage, resolveRequestMaxTokens, resolveStreamWatchdogConfig } from '@/composables/ai/chatHelpers'
import type { ModelConfig } from '@/types/ai'

function makeModel(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    id: 'model-1',
    name: 'Model 1',
    capabilities: {
      streaming: true,
      vision: false,
      thinking: false,
      toolUse: true,
      maxContext: 32000,
      maxOutput: 4096,
      ...overrides?.capabilities,
    },
    ...overrides,
  }
}

describe('chatHelpers', () => {
  it('normalizes 429 rate limit errors into a readable Chinese message', () => {
    const message = normalizeAiErrorMessage('rate limit exceeded (429)')
    expect(message).toContain('上游模型服务限流了（429）')
    expect(message).toContain('原始错误: rate limit exceeded (429)')
  })

  it('normalizes transient timeout and upstream overload errors into readable Chinese messages', () => {
    const timeoutMessage = normalizeAiErrorMessage('network timeout while streaming')
    expect(timeoutMessage).toContain('上游模型响应超时了')
    expect(timeoutMessage).toContain('原始错误: network timeout while streaming')

    const overloadMessage = normalizeAiErrorMessage('bad gateway (502)')
    expect(overloadMessage).toContain('上游模型服务当前不稳定')
    expect(overloadMessage).toContain('原始错误: bad gateway (502)')
  })

  it('caps request max tokens for thinking models with tools enabled', () => {
    const model = makeModel({
      capabilities: {
        streaming: true,
        vision: true,
        thinking: true,
        toolUse: true,
        maxContext: 1_000_000,
        maxOutput: 128_000,
      },
    })

    expect(resolveRequestMaxTokens(model, { enableTools: true })).toBe(8192)
    expect(resolveRequestMaxTokens(model, { enableTools: false })).toBe(16384)
  })

  it('caps request max tokens for non-thinking models more aggressively', () => {
    const model = makeModel({
      capabilities: {
        streaming: true,
        vision: true,
        thinking: false,
        toolUse: true,
        maxContext: 400_000,
        maxOutput: 128_000,
      },
    })

    expect(resolveRequestMaxTokens(model, { enableTools: true })).toBe(4096)
    expect(resolveRequestMaxTokens(model, { enableTools: false })).toBe(8192)
  })

  it('uses a longer watchdog window for thinking models', () => {
    const thinkingModel = makeModel({
      capabilities: {
        streaming: true,
        vision: true,
        thinking: true,
        toolUse: true,
        maxContext: 1_000_000,
        maxOutput: 128_000,
      },
    })

    expect(resolveStreamWatchdogConfig(thinkingModel)).toEqual({
      warnMs: 90_000,
      timeoutMs: 180_000,
    })
    expect(resolveStreamWatchdogConfig(makeModel())).toEqual({
      warnMs: 45_000,
      timeoutMs: 90_000,
    })
  })
})
