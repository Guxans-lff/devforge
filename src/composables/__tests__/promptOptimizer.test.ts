import { describe, expect, it, vi, beforeEach } from 'vitest'
import { abortPromptOptimization, iteratePrompt, optimizePrompt } from '@/composables/ai/promptOptimizer'
import type { AiStreamEvent } from '@/types/ai'

const { aiChatStreamMock, aiAbortStreamMock } = vi.hoisted(() => ({
  aiChatStreamMock: vi.fn(),
  aiAbortStreamMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiChatStream: aiChatStreamMock,
  aiAbortStream: aiAbortStreamMock,
}))

describe('promptOptimizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiAbortStreamMock.mockResolvedValue(undefined)
  })

  it('builds prompt optimization request and aggregates text deltas', async () => {
    aiChatStreamMock.mockImplementation(async (request, onEvent: (event: AiStreamEvent) => void) => {
      expect(request.sessionId).toBe('session-1')
      expect(request.providerType).toBe('openai_compat')
      expect(request.model).toBe('gpt-4.1')
      expect(request.apiKey).toBe('secret')
      expect(request.endpoint).toBe('https://example.com')
      expect(request.enableTools).toBe(false)
      expect(request.systemPrompt).toContain('只输出优化后的提示词')
      expect(request.messages).toEqual([{ role: 'user', content: '原始提示词：\n写一个日报生成器' }])

      onEvent({ type: 'TextDelta', delta: '优化后' })
      onEvent({ type: 'TextDelta', delta: '提示词' })
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    const onDelta = vi.fn()
    const onEvent = vi.fn()
    const result = await optimizePrompt({
      prompt: '写一个日报生成器',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      endpoint: 'https://example.com',
      sessionId: 'session-1',
    }, { onDelta, onEvent })

    expect(result).toEqual({
      text: '优化后提示词',
      sessionId: 'session-1',
    })
    expect(onDelta).toHaveBeenNthCalledWith(1, '优化后')
    expect(onDelta).toHaveBeenNthCalledWith(2, '提示词')
    expect(onEvent).toHaveBeenCalledTimes(3)
  })

  it('uses the selected template when templateId is provided', async () => {
    aiChatStreamMock.mockImplementation(async (request, onEvent: (event: AiStreamEvent) => void) => {
      expect(request.systemPrompt).toContain('代码生成提示词优化助手')
      expect(request.messages).toEqual([{ role: 'user', content: '原始代码生成需求：\n写一个 Node.js 重试函数' }])
      onEvent({ type: 'TextDelta', delta: '代码优化版提示词' })
    })

    const result = await optimizePrompt({
      prompt: '写一个 Node.js 重试函数',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      sessionId: 'session-code',
      templateId: 'code-optimize',
    })

    expect(result).toEqual({
      text: '代码优化版提示词',
      sessionId: 'session-code',
    })
  })

  it('uses the selected template when structured output mode is provided', async () => {
    aiChatStreamMock.mockImplementation(async (request, onEvent: (event: AiStreamEvent) => void) => {
      expect(request.systemPrompt).toContain('结构化输出提示词优化助手')
      expect(request.messages).toEqual([{ role: 'user', content: '原始结构化需求：\n整理会议纪要' }])
      onEvent({ type: 'TextDelta', delta: '结构化优化版提示词' })
    })

    const result = await optimizePrompt({
      prompt: '整理会议纪要',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      sessionId: 'session-structured',
      templateId: 'structured-optimize',
    })

    expect(result).toEqual({
      text: '结构化优化版提示词',
      sessionId: 'session-structured',
    })
  })

  it('uses the selected template when polish mode is provided', async () => {
    aiChatStreamMock.mockImplementation(async (request, onEvent: (event: AiStreamEvent) => void) => {
      expect(request.systemPrompt).toContain('翻译润色提示词优化助手')
      expect(request.messages).toEqual([{ role: 'user', content: '原始翻译或润色需求：\n把这段中文翻译成专业英文邮件' }])
      onEvent({ type: 'TextDelta', delta: '润色优化版提示词' })
    })

    const result = await optimizePrompt({
      prompt: '把这段中文翻译成专业英文邮件',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      sessionId: 'session-polish',
      templateId: 'polish-optimize',
    })

    expect(result).toEqual({
      text: '润色优化版提示词',
      sessionId: 'session-polish',
    })
  })

  it('builds iterate request with original prompt, optimized prompt, and feedback', async () => {
    aiChatStreamMock.mockImplementation(async (request, onEvent: (event: AiStreamEvent) => void) => {
      expect(request.sessionId).toBe('iterate-1')
      expect(request.enableTools).toBe(false)
      expect(request.systemPrompt).toContain('继续优化')
      expect(request.messages[0].content).toContain('原始提示词：\n写一个日报生成器')
      expect(request.messages[0].content).toContain('当前优化版本：\n生成结构化日报')
      expect(request.messages[0].content).toContain('反馈要求：\n更适合代码生成')

      onEvent({ type: 'TextDelta', delta: '继续优化后提示词' })
    })

    const result = await iteratePrompt({
      originalPrompt: '写一个日报生成器',
      optimizedPrompt: '生成结构化日报',
      feedback: '更适合代码生成',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      sessionId: 'iterate-1',
    })

    expect(result).toEqual({
      text: '继续优化后提示词',
      sessionId: 'iterate-1',
    })
  })

  it('aborts the remote stream and rejects when signal is cancelled during streaming', async () => {
    let resolveStream: (() => void) | undefined

    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'partial' })
      await new Promise<void>((resolve) => {
        resolveStream = resolve
      })
    })

    const controller = new AbortController()
    const optimizationPromise = optimizePrompt({
      prompt: '优化它',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      sessionId: 'session-stream-abort',
      signal: controller.signal,
    })

    await Promise.resolve()
    controller.abort()
    await Promise.resolve()
    resolveStream?.()

    await expect(optimizationPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(aiAbortStreamMock).toHaveBeenCalledWith('session-stream-abort')
  })


  it('aborts the stream when signal is cancelled before request starts', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'TextDelta', delta: 'partial' })
    })

    const controller = new AbortController()
    controller.abort()

    await expect(optimizePrompt({
      prompt: '优化它',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      sessionId: 'session-abort',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(aiAbortStreamMock).toHaveBeenCalledWith('session-abort')
  })


  it('treats empty final text as an error', async () => {
    aiChatStreamMock.mockImplementation(async (_request, onEvent: (event: AiStreamEvent) => void) => {
      onEvent({ type: 'Done', finish_reason: 'stop' })
    })

    await expect(optimizePrompt({
      prompt: '优化它',
      providerType: 'openai_compat',
      model: 'gpt-4.1',
      apiKey: 'secret',
      sessionId: 'session-empty',
    })).rejects.toThrow('优化结果为空，请重试')
  })

  it('forwards explicit abort calls', async () => {
    await abortPromptOptimization('session-stop')

    expect(aiAbortStreamMock).toHaveBeenCalledWith('session-stop')
  })
})
